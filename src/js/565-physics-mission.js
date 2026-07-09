
// ─── PHYSICS MISSION BRIDGE (P2) — solved node burns + propagated legs ────────
//
// Connects the P0/P1 physics stack (385/386) to the mission model (570).
// See PHYSICS_PLAN.md (P2) and MATH.md §7e.
//
// DOM-FREE ON PURPOSE: this module is loaded by tests/math.test.js's vm harness
// (which stubs only document.getElementById) — keep it free of DOM access and
// free of top-level references to later modules (570/430 functions are only
// touched inside functions, at call time).
//
// Hard rules honored here:
//   - Results live in the module side-table `_physTrajByMission`, keyed by
//     missionId — NEVER on the mission object `m` (autosave/undo serialize m
//     wholesale; the m._checks leak class).
//   - Burn MAGNITUDE always comes from the existing ΔV engine
//     (progNmComputeEdgeDv / e.dvOverride) so ΔV accounting and propellant
//     totals are byte-identical with physics on vs off. P2 does NOT retarget —
//     a propagated leg that misses the Moon records converged:false and that
//     is fine (P4's shooter refines aim).
//   - All body positions via physBodyStateAt/progBodyAngleAt (rails), all
//     numeric propagation via physPropagateSegment. Pure two-body legs skip
//     the integrator and sample physKeplerPropagate instead (perf budget).

const PHYS_ENABLED = true;

// side-tables: current legs (written by the latest rebuild) and the previous
// rebuild's legs (consulted DURING replay for physics-TOF duration precedence —
// durations are consumed while replaying but legs are built after, so the
// physics TOF is always stale-by-one; see physMissionRecomputeBegin +
// the convergence pass at the bottom of physRebuildMissionTrajectories).
let _physTrajByMission = {};
let _physPrevTrajByMission = {};
let _physRecomputePass = false;   // guards the one-extra-recompute convergence pass

/** Accessor: leg record for an authored log index, or null. */
function physMissionLeg(missionId, authIdx) {
  const t = _physTrajByMission[missionId];
  if (!t || !t.legs) return null;
  return t.legs.find(L => L.authIdx === authIdx) || null;
}

/** Called at the TOP of missionRecompute (570): the current table becomes the
 *  "previous rebuild" consulted for durations during this replay; the current
 *  slot is cleared so a failed rebuild can't leave stale legs behind. */
function physMissionRecomputeBegin(m) {
  if (!m) return;
  if (_physTrajByMission[m.missionId]) _physPrevTrajByMission[m.missionId] = _physTrajByMission[m.missionId];
  delete _physTrajByMission[m.missionId];
}

// ── pure phasing geometry (gate-tested) ──────────────────────────────────────
/** Burn-point angle for a Hohmann-style transfer that must ARRIVE at
 *  targetAngleAtArrival (rad): the transfer spans π of true anomaly, so the
 *  departure point sits diametrically opposite the arrival point (same
 *  geometry as 574's _trajArcRotationForTarget). Normalized to [0, 2π). */
function physPhaseBurnAngle(targetAngleAtArrival) {
  let a = (targetAngleAtArrival - Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a;
}

/** Schematic coast TOF (s) that the injection leg's transfer physically spans —
 *  progTransferTOF conventions WITHOUT the corridor zero (the corridor rule
 *  charges the coast on the EXITING leg, but the injected trajectory itself
 *  still flies the full transfer starting at the injection burn). */
function physSchematicCoastTof(fromO, toO) {
  if (!fromO || !toO) return 0;
  const dest = toO.destination || (PROG_MOON_ORBITS[toO.body] ? toO.body : null) ||
    (PROG_HELIO_R[toO.body] && toO.body !== 'Earth' ? toO.body : null);
  // moon-type destination: half-ellipse from the parking radius to the moon's rail
  if (dest && PROG_MOON_ORBITS[dest]) {
    const parent = PROG_MOON_ORBITS[dest].parent;
    const altA = fromO.type === 'surface' ? 0 :
      (fromO.type === 'transit' ? 185 : ((fromO.perigee ?? fromO.apogee ?? 185) + (fromO.apogee ?? fromO.perigee ?? 185)) / 2);
    return progHohmannTOF(parent, altA, PROG_MOON_ORBITS[dest].r - PROG_BODIES[parent].R);
  }
  // interplanetary: selected launch window is authoritative, else heliocentric Hohmann
  if (dest && PROG_HELIO_R[dest]) {
    const lw = (typeof PROG_ACTIVE_PROGRAM !== 'undefined' && PROG_ACTIVE_PROGRAM && PROG_ACTIVE_PROGRAM.launchWindow) || null;
    if (lw && lw.tof_days != null && (lw.destination === dest || !lw.destination)) return lw.tof_days * 86400;
    const a = (PROG_HELIO_R.Earth + PROG_HELIO_R[dest]) / 2;
    return Math.PI * Math.sqrt(a * a * a / PROG_MU_SUN);
  }
  // same-body orbit -> orbit
  if (fromO.body === toO.body && PROG_BODIES[fromO.body]) {
    const altA = fromO.type === 'surface' ? 0 : ((fromO.perigee ?? fromO.apogee ?? 0) + (fromO.apogee ?? fromO.perigee ?? 0)) / 2;
    const altB = toO.type === 'surface' ? 0 : ((toO.perigee ?? toO.apogee ?? 0) + (toO.apogee ?? toO.perigee ?? 0)) / 2;
    if (Math.abs(altA - altB) < 1) return 0;
    return progHohmannTOF(fromO.body, altA, altB);
  }
  return 0;
}

// ── solved node burn ─────────────────────────────────────────────────────────
/**
 * Construct the departure state + burn for an existing node MANEUVER.
 *   fromOrbit/toOrbit: node orbit specs {type:'circular'|'elliptic'|'transit'|
 *   'surface'|'escape', body, perigee, apogee, c3, destination}.
 *   tDepart_s: mission MET of the burn (seconds).
 *   dv_kms:    burn magnitude in km/s — MUST come from the existing ΔV engine
 *              (progNmComputeEdgeDv / dvOverride), never recomputed here.
 *
 * Departure state = circular parking orbit around fromOrbit.body at its mean
 * altitude; the burn POINT is chosen by analytic phasing (physPhaseBurnAngle)
 * so a Hohmann-style transfer arriving after the schematic TOF meets the
 * destination's railed position at arrival. Burn VECTOR is prograde.
 *
 * Returns { state:{r,v} (post-burn, center-relative), center, bodies,
 *           coastTof_s, dvVec, dest, kind:'moon'|'interplanetary'|'samebody' }
 * or null when no model applies (e.g. surface-to-surface).
 */
function physSolveNodeBurn(fromOrbit, toOrbit, tDepart_s, dv_kms) {
  if (!fromOrbit || !toOrbit || !(dv_kms > 0)) return null;
  const fromBody = fromOrbit.body || 'Earth';
  if (!PROG_BODIES[fromBody]) return null;
  const altFrom = fromOrbit.type === 'surface' ? 0 :
    (fromOrbit.type === 'transit' ? 185 : ((fromOrbit.perigee ?? fromOrbit.apogee ?? 185) + (fromOrbit.apogee ?? fromOrbit.perigee ?? 185)) / 2);
  const r1 = PROG_BODIES[fromBody].R + altFrom;
  const mu = PROG_BODIES[fromBody].mu;
  const coastTof = physSchematicCoastTof(fromOrbit, toOrbit);

  // classify the destination
  const destMoon = (toOrbit.destination && PROG_MOON_ORBITS[toOrbit.destination] && toOrbit.destination) ||
    (PROG_MOON_ORBITS[toOrbit.body] && toOrbit.body !== fromBody && toOrbit.body) || null;
  const destPlanet = !destMoon ? ((toOrbit.destination && PROG_HELIO_R[toOrbit.destination] && toOrbit.destination) || null) : null;
  const sameBody = !destMoon && !destPlanet && toOrbit.body === fromBody &&
    (toOrbit.type === 'circular' || toOrbit.type === 'elliptic' || toOrbit.type === 'escape');
  if (!destMoon && !destPlanet && !sameBody) return null;

  // burn-point angle by analytic phasing
  let theta = 0; // same-body: arbitrary (periapsis of the transfer at angle 0)
  if (destMoon) {
    // moon's railed angle (parent-centered) at arrival; burn diametrically opposite
    theta = physPhaseBurnAngle(progBodyAngleAt(destMoon, tDepart_s + coastTof));
  } else if (destPlanet) {
    // heliocentric equivalent: destination planet's railed angle at arrival;
    // the LEO burn point is placed at the same schematic angle in the Earth
    // frame (departure asymptote roughly opposite the arrival point). This is
    // deliberately coarse — P4's shooter refines it.
    theta = physPhaseBurnAngle(progBodyAngleAt(destPlanet, tDepart_s + coastTof));
  }

  const r = [r1 * Math.cos(theta), r1 * Math.sin(theta), 0];
  const vCirc = Math.sqrt(mu / r1);
  const pro = [-Math.sin(theta), Math.cos(theta), 0];           // prograde unit
  const dvVec = physScale(pro, dv_kms);
  const v = physAdd(physScale(pro, vCirc), dvVec);
  const bodies = destPlanet ? ['Sun', 'Earth', destPlanet]
    : (destMoon ? [PROG_MOON_ORBITS[destMoon].parent, destMoon, 'Sun'] : [fromBody]);
  return {
    state: { r, v }, center: fromBody, bodies,
    coastTof_s: coastTof, dvVec, dest: destMoon || destPlanet || toOrbit.body,
    kind: destMoon ? 'moon' : (destPlanet ? 'interplanetary' : 'samebody'),
  };
}

// ── duration precedence hook (called from 570's MANEUVER replay) ─────────────
/** Physics TOF for an authored MANEUVER, from the PREVIOUS rebuild's legs
 *  (stale-by-one; the convergence pass re-replays once when it matters).
 *  Returns seconds or null (fall back to progTransferTOF). Only legs whose
 *  identity (from/to nodes) and departure MET still match are trusted. */
function physLegTofFor(m, e, metNow) {
  if (typeof PHYS_ENABLED === 'undefined' || !PHYS_ENABLED || !m) return null;
  const t = _physPrevTrajByMission[m.missionId];
  if (!t || !t.legs) return null;
  const leg = t.legs.find(L => L.authIdx === e._authIdx && L.fromNode === e.fromNode && L.toNode === e.toNode);
  if (!leg || leg.tofPhysics == null) return null;
  if (metNow != null && leg.met != null && Math.abs(leg.met - metNow) > 1) return null; // upstream durations changed
  return leg.tofPhysics;
}

// ── mission-wide rebuild ─────────────────────────────────────────────────────
/**
 * Rebuild the propagated-trajectory side-table for mission m. Called from the
 * tail of missionRecompute (before autosave/undo/checks). Walks m.log; every
 * MANEUVER with a computable leg gets a leg record:
 *   { authIdx, fromNode, toNode, met, samples, events, tof_s, tofPhysics,
 *     dvVec, frames, converged, kind }
 * Injection legs (to a transit corridor) carry the propagation; the EXITING
 * leg (transit -> destination orbit) carries the coast duration (corridor
 * rule) — its tofPhysics is derived from the injection leg's propagated
 * SOI-entry/periapsis timing when the trajectory actually reaches the
 * destination SOI, else the schematic Hohmann time.
 */
function physRebuildMissionTrajectories(m) {
  if (typeof PHYS_ENABLED === 'undefined' || !PHYS_ENABLED || !m) return;
  const legs = [];
  let lastTransit = null;   // pending injection leg (kind moon/interplanetary), for the exiting leg
  for (let i = 0; i < (m.log || []).length; i++) {
    const e = m.log[i];
    if (e.type !== 'MANEUVER' || !e.fromNode || !e.toNode) continue;
    const fromN = _missionNmNodeById(e.fromNode), toN = _missionNmNodeById(e.toNode);
    const fromO = fromN && fromN.orbit, toO = toN && toN.orbit;
    if (!fromO || !toO) continue;

    // burn magnitude from the EXISTING engine (identical to _missionApplyManeuver)
    const edge = progNmComputeEdgeDv(e.fromNode, e.toNode);
    const dv_ms = (e.dvOverride != null) ? e.dvOverride : (edge ? edge.dv : 0);
    const met = e.metStart != null ? e.metStart : 0;

    // exiting-corridor leg: carries the coast; no propagation of its own —
    // the injection leg already flew it. Physics TOF from that propagation.
    if (fromO.type === 'transit') {
      let tofPhysics = null, converged = false;
      if (lastTransit && lastTransit.dest && (toO.body === lastTransit.dest || toO.destination === lastTransit.dest)) {
        converged = lastTransit.converged;
        if (converged) {
          const soi = lastTransit.events.find(ev => ev.type === 'soi' && ev.to === lastTransit.dest);
          const peri = lastTransit.events.find(ev => ev.type === 'periapsis' && ev.frame === lastTransit.dest && (!soi || ev.t >= soi.t));
          const tArr = (peri && peri.t) || (soi && soi.t);
          if (tArr != null) tofPhysics = tArr - lastTransit.met;
        }
      }
      legs.push({ authIdx: i, fromNode: e.fromNode, toNode: e.toNode, met,
        samples: [], events: [], tof_s: e.durationUsed != null ? e.durationUsed : 0,
        tofPhysics, dvVec: null, frames: [], converged, kind: 'arrival' });
      continue;
    }

    const burn = physSolveNodeBurn(fromO, toO, met, dv_ms / 1000);
    if (!burn) continue;

    if (burn.kind === 'samebody') {
      // pure two-body: analytic Kepler samples at ~64 even time steps (no integrator)
      const mu = PROG_BODIES[burn.center].mu;
      const N = 64, samples = [];
      const tof = burn.coastTof_s || 0;
      let bad = false;
      for (let k = 0; k <= N; k++) {
        const dt = tof * k / N;
        const st = physKeplerPropagate(burn.state.r, burn.state.v, dt, mu);
        if (!st) { bad = true; break; }   // physKeplerPropagate can return null
        samples.push({ t: met + dt, r: st.r, frame: burn.center });
      }
      legs.push({ authIdx: i, fromNode: e.fromNode, toNode: e.toNode, met,
        samples: bad ? [] : samples, events: [], tof_s: tof, tofPhysics: tof || null,
        dvVec: burn.dvVec, frames: [burn.center], converged: !bad, kind: burn.kind });
      continue;
    }

    // n-body leg (moon / interplanetary): propagate until 1.5× the schematic TOF
    const cutoff = met + 1.5 * Math.max(burn.coastTof_s, 3600);
    const res = physPropagateSegment(burn.state, met, cutoff,
      { center: burn.center, bodies: burn.bodies }, { maxSamples: 256 });
    const converged = res.events.some(ev => ev.type === 'soi' && ev.to === burn.dest);
    const leg = { authIdx: i, fromNode: e.fromNode, toNode: e.toNode, met,
      samples: res.samples, events: res.events, tof_s: burn.coastTof_s,
      tofPhysics: null,   // injection is impulsive under the corridor rule — no coast of its own
      dvVec: burn.dvVec, frames: [...new Set(res.samples.map(s => s.frame))],
      converged, kind: burn.kind, dest: burn.dest };
    legs.push(leg);
    lastTransit = leg;
  }
  _physTrajByMission[m.missionId] = { legs };

  // ── convergence pass (stale-by-one TOF; see MATH.md §7e) ──
  // If any leg's physics TOF differs >1% from the duration this replay actually
  // used (and the user hasn't overridden it), re-replay ONCE so the MET chain
  // absorbs the physics timing. Depth-guarded — never loops.
  if (!_physRecomputePass && typeof missionRecompute === 'function') {
    const stale = legs.some(L => {
      if (L.tofPhysics == null) return false;
      const auth = m.log[L.authIdx];
      if (!auth || auth.durationOverride != null) return false;
      const used = auth.durationUsed || 0;
      return Math.abs(L.tofPhysics - used) > 0.01 * Math.max(1, used);
    });
    if (stale) {
      _physRecomputePass = true;
      try { missionRecompute(m); } finally { _physRecomputePass = false; }
    }
  }
}

// ── MNODE authoring (no dock UI yet — P4; console/API entry point) ───────────
/** Push a vector maneuver node: spec = { value_s (MET), dvPro_ms, dvRad_ms,
 *  dvNrm_ms }. Same push→recompute→render pattern as missionExecManeuver. */
function missionExecManeuverNode(id, spec) {
  const m = _missionGet(id);
  if (!m || !spec) return;
  const actFv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  m.log.push({
    type: 'MNODE',
    at: { kind: 'met', value_s: spec.value_s || 0 },
    dvPro_ms: spec.dvPro_ms || 0, dvRad_ms: spec.dvRad_ms || 0, dvNrm_ms: spec.dvNrm_ms || 0,
    activeKey: actFv ? actFv._originKey : null,
    activeName: actFv ? _missionVehicleDisplayName(actFv) : null,
  });
  missionRecompute(m);
  missionRenderDetail();
}
