
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

// ── N1b (MISSION_MODEL_V2 §17) — physics fidelity + the ONE body-set builder ─
// Every propagation body list is constructed here, so "contextual" has a
// single auditable definition and "full" is one switch. The recipes below
// reproduce the pre-N1b ad-hoc lists BYTE-IDENTICALLY (including array order —
// physAccel sums in list order, so order changes would move float rounding).
const PHYS_FIDELITY_FULL_BODIES = ['Sun', 'Mercury', 'Venus', 'Earth', 'Mars',
  'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Moon', 'Titan'];
let _physFidelity = 'contextual';   // 'contextual' | 'full' — session-persisted (455)
function physFidelity() { return _physFidelity; }
/** Set the fidelity mode. Returns true if it CHANGED (callers recompute).
 *  A change invalidates the shooter caches — cached solves flew a different
 *  force model. */
function physSetFidelity(mode) {
  const next = mode === 'full' ? 'full' : 'contextual';
  if (next === _physFidelity) return false;
  _physFidelity = next;
  try {
    for (const k of Object.keys(_physShootCache)) delete _physShootCache[k];
    for (const k of Object.keys(_physNrhoShootCache)) delete _physNrhoShootCache[k];
  } catch (err) { /* caches not yet defined during load — nothing to clear */ }
  return true;
}
/**
 * The one body-set resolver. ctx = { center, dest?, kind } with kind:
 *   'interplanetary' — Earth-departure cruise to a planet: ['Sun', center, dest]
 *   'moon'           — transfer to a moon: [parent(dest), dest, 'Sun']
 *   'cislunar'       — Earth-Moon problem (free return, NRHO): ['Earth','Moon','Sun']
 *   'local'          — settle/burn around one body (MNODE, gizmo full pass):
 *                      [center, parent(center)||'Sun', 'Sun', +Moon if Earth]
 * fidelity (optional) overrides the module mode. 'full' = the contextual set
 * unioned with Sun + all 8 planets + Moon + Titan (order: contextual first,
 * so the contextual rounding-order prefix is preserved).
 * Deliberate NON-consumers (audited, N1): the samebody Kepler leg and 566's
 * gap-coast hold ([center] — the model there IS two-body); 5745's cheap drag
 * tier ([node.body] — the explicit truncation opt-in of the fidelity ladder);
 * 425's catalog seeds (offline-corrected against their own pinned body list).
 */
function physBodySetFor(ctx, fidelity) {
  ctx = ctx || {};
  const center = ctx.center || 'Earth';
  let list;
  switch (ctx.kind) {
    case 'interplanetary': list = ['Sun', center, ctx.dest]; break;
    case 'moon': list = [physParentOf(ctx.dest) || 'Sun', ctx.dest, 'Sun']; break;
    case 'cislunar': list = ['Earth', 'Moon', 'Sun']; break;
    case 'local':
    default:
      list = [center, physParentOf(center) || 'Sun', 'Sun', center === 'Earth' ? 'Moon' : null];
      break;
  }
  list = [...new Set(list.filter(Boolean))];
  const mode = fidelity || _physFidelity;
  if (mode === 'full') list = [...new Set([...list, ...PHYS_FIDELITY_FULL_BODIES])];
  return list;
}

// ── N1 (§17) — explicit encounter-scale constants (km) ───────────────────────
// The OLD SOI-termed solver acceptance values with honest units. These are
// numerically the classical SOI radii (a·(mu/mu_parent)^(2/5)) at the current
// 360/385 constants, written out as literals: physSoiRadius itself is demoted
// to bookkeeping (rendering/LOD seam markers, frame-CENTER selection, and
// display-horizon classification) and no longer appears in solver acceptance
// terms. Gate-pinned against physSoiRadius (tests/math.test.js) so a body-
// constant change can't silently detach the two.
const PHYS_ENCOUNTER_SCALE_KM = {
  Moon: 66182.92233068068, Titan: 43322.31349190931,
  Mercury: 112411.16264977797, Venus: 616277.3296226036,
  Earth: 924646.795104645, Mars: 577227.4885111795,
  Jupiter: 48215441.1894899, Saturn: 54806443.0343865,
  Uranus: 51794655.77859839, Neptune: 86598220.57602063,
  Pluto: 3148947.8172211857,
};

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
 * altitude, in the orbit's AUTHORED plane (R3): elements {a=r1, e=0,
 * i=fromOrbit.inclination, Ω=0 convention — the SAME orbit the R2 ring
 * renderer draws} via physElementsToState. The burn POINT is chosen by
 * analytic phasing (physPhaseBurnAngle) so a Hohmann-style transfer arriving
 * after the schematic TOF meets the destination's railed position at arrival;
 * note theta is now the IN-PLANE true anomaly ν, not an ecliptic angle —
 * acceptable, the shooter refines aim. Burn VECTOR is prograde (v̂ of the
 * inclined state).
 *
 * Returns { state:{r,v} (post-burn, center-relative), center, bodies,
 *           coastTof_s, dvVec, dest, kind:'moon'|'interplanetary'|'samebody' }
 * or null when no model applies (e.g. surface-to-surface).
 */
function physSolveNodeBurn(fromOrbit, toOrbit, tDepart_s, dv_kms, overrides) {
  overrides = overrides || {};
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
    // heliocentric equivalent: destination planet's REAL ephemeris angle at
    // arrival (R1 — the calibration-offset threading retired with the real
    // rails; `overrides` is signature-compat only). The LEO burn point is
    // placed at the same schematic angle in the Earth frame (departure
    // asymptote roughly opposite the arrival point). Deliberately coarse —
    // P4's shooter refines.
    theta = physPhaseBurnAngle(progBodyAngleAt(destPlanet, tDepart_s + coastTof));
  }

  // R3: departure state in the authored orbit plane (Ω=0 convention, same as
  // the R2 ring rendering); prograde unit = v̂ of the inclined state.
  const incRad = ((fromOrbit.inclination || 0) * Math.PI) / 180;
  // R3.2: an authored departure plane (lan_deg) is fixed geometry, not a
  // solve target — physShootLegAim's raan solve is skipped entirely for an
  // authored fromOrbit (see there); this single-burn (samebody) construction
  // just needs to honor the same authored raan for consistency.
  const raanFixed = fromOrbit.lan_deg != null ? (fromOrbit.lan_deg * Math.PI) / 180 : 0;
  const bs = physAimBurnState(fromBody, r1, theta, 0, dv_kms, incRad, 0, raanFixed);
  // N1b: body set through the one resolver (contextual = the old ad-hoc lists
  // verbatim; 'full' unions the whole system). Samebody keeps [fromBody] —
  // its leg model is analytic Kepler (documented exemption, physBodySetFor).
  const bodies = destPlanet ? physBodySetFor({ center: fromBody, dest: destPlanet, kind: 'interplanetary' })
    : (destMoon ? physBodySetFor({ center: fromBody, dest: destMoon, kind: 'moon' }) : [fromBody]);
  return {
    state: { r: bs.r, v: bs.v }, center: fromBody, bodies, dvVec: bs.dvVec,
    // R6.2' Phase B step 5: the PRE-burn state (dv NOT applied) — the exact
    // departure state the burn's dv vector is applied to, for basis-fixed
    // decomposition downstream (leg.burnState).
    preState: { r: bs.r, v: bs.vPre },
    coastTof_s: coastTof, dest: destMoon || destPlanet || toOrbit.body,
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
// R3.5.3: dynamic full-orbit horizon for post-escape heliocentric arcs. The
// flat 90-day horizon (R3.5.2) only ever showed a quarter-orbit at 1 AU —
// this scans a propagated leg's samples for the SOI handoff into the Sun
// frame, estimates the heliocentric orbit there (numerically, since
// physPropagateSegment's decimated samples carry {t,r,frame} but not v — see
// 386's return-shape comment; v is estimated by finite difference between
// the first two consecutive Sun-frame samples, which is plenty accurate for
// sizing a re-propagation horizon), and returns a horizon (measured from the
// LEG START, i.e. samples[0].t) long enough to show one full solar orbit
// plus 5% margin. Shared by 565 (committed legs) and 5745 (gizmo preview).
//   - no Sun-frame samples (or only one — can't finite-difference a
//     velocity) -> fallbackS unchanged.
//   - elliptical about the Sun -> (tSunEntry - tLegStart) + 1.05 * period.
//   - hyperbolic/parabolic/degenerate -> max(fallbackS, 2 solar years) (a
//     generous interstellar-departure window; there's no "one orbit" to wait
//     for).
//   - capped at 5 solar years either way so a Jupiter-crossing ellipse can't
//     demand a decades-long integration.
function physEscapeHorizonS(samples, fallbackS) {
  const CAP_S = 5 * 365.25 * 86400;
  if (!samples || !samples.length) return fallbackS;
  const idx = samples.findIndex(s => s.frame === 'Sun');
  if (idx < 0) return fallbackS;
  let jdx = -1;
  for (let k = idx + 1; k < samples.length; k++) { if (samples[k].frame === 'Sun') { jdx = k; break; } }
  if (jdx < 0) return fallbackS; // only one Sun-frame sample recorded — can't estimate v
  const s0 = samples[idx], s1 = samples[jdx];
  const dt = s1.t - s0.t;
  if (!(dt > 0)) return fallbackS;
  const v = [(s1.r[0] - s0.r[0]) / dt, (s1.r[1] - s0.r[1]) / dt, (s1.r[2] - s0.r[2]) / dt];
  const muSun = (typeof PROG_MU_SUN !== 'undefined') ? PROG_MU_SUN : 1.32712440018e11;
  const el = (typeof physStateToElements === 'function') ? physStateToElements(s0.r, v, muSun) : null;
  let result;
  if (el && el.a > 0 && isFinite(el.period)) {
    result = (s0.t - samples[0].t) + 1.05 * el.period;
  } else {
    result = Math.max(fallbackS, 2 * 365.25 * 86400);
  }
  return Math.min(result, CAP_S);
}

/** R6.2′ (round-3 item 5): MET of the next MNODE authored after log index
 *  `idx`, or null. Used to cap a covering leg's propagation horizon so it
 *  doesn't render past a mid-leg maneuver placed inside it (the new node's
 *  own leg continues the trajectory from there). Pure log scan. */
function physNextMnodeMetAfter(m, idx) {
  const log = (m && m.log) || [];
  for (let j = idx + 1; j < log.length; j++) {
    const ev2 = log[j];
    if (!ev2 || ev2.type !== 'MNODE') continue;
    const t2 = (ev2.at && ev2.at.value_s != null) ? ev2.at.value_s : (ev2.metStart != null ? ev2.metStart : null);
    if (t2 != null) return t2;
  }
  return null;
}

/** R6.2′ (round-3 item 5): exact state at an arbitrary query MET inside a leg
 *  the mission already propagated — the machinery mid-leg maneuver placement
 *  builds on. RE-DERIVES from the SAME initial post-burn state + propagation
 *  context physRebuildMissionTrajectories captured on the leg record
 *  (leg.initState/center/bodies/dtMax — one source of truth, not duplicated
 *  here) via ONE extra physPropagateSegment call to tQuery. Returns
 *  {r, v, frame} or null when the leg/state is missing or tQuery falls
 *  outside [legStart, last sample]. Pure (DOM-free), side-table read only. */
function physLegStateAt(missionId, authIdx, tQuery) {
  const leg = physMissionLeg(missionId, authIdx);
  if (!leg || !leg.initState || !leg.samples || !leg.samples.length) return null;
  const legStart = leg.met;
  const legEnd = leg.samples[leg.samples.length - 1].t;
  const EPS = 1e-6;
  if (tQuery == null || tQuery < legStart - EPS || tQuery > legEnd + EPS) return null;
  const res = physPropagateSegment(leg.initState, legStart, tQuery,
    { center: leg.center, bodies: leg.bodies, overrides: {}, dtMax: leg.dtMax }, { maxSamples: 8 });
  if (!res || !res.stateF) return null;
  return { r: res.stateF.r, v: res.stateF.v, frame: res.frame };
}

function physRebuildMissionTrajectories(m) {
  if (typeof PHYS_ENABLED === 'undefined' || !PHYS_ENABLED || !m) return;
  // R1: planet-phase calibration retired — real ephemeris rails need no
  // per-mission overrides. Kept as an empty map so downstream signatures
  // (physSolveNodeBurn/physPropagateSegment ctx) stay unchanged.
  const calOverrides = {};
  const legs = [];
  let lastTransit = null;   // pending injection leg (kind moon/interplanetary), for the exiting leg
  // destination-orbit mean altitude for a leg's dest body, from the first
  // later arrival MANEUVER into an orbit of that body (shooter target radius).
  // R3.1: same search, but returning the actual {peri, apo} pair (not just the
  // mean) for arrivalElements' AUTHORED SIZE (§7i) — the leg's own `toO` is
  // the TRANSIT/corridor node (no perigee/apogee of its own), so the real
  // destination orbit's shape has to come from this downstream lookahead,
  // same target the shooter already searches for its radius.
  const destOrbitFor = (dest, fromIdx) => {
    for (let j = fromIdx + 1; j < (m.log || []).length; j++) {
      const ev = m.log[j];
      if (!_evIsSolvedManeuver(ev) || !ev.toNode) continue;
      const tn = _missionNmNodeById(ev.toNode);
      const o = tn && tn.orbit;
      if (o && o.body === dest && (o.type === 'circular' || o.type === 'elliptic'))
        return { peri: o.perigee ?? o.apogee ?? 100, apo: o.apogee ?? o.perigee ?? 100 };
    }
    return { peri: 100, apo: 100 };
  };
  const destAltFor = (dest, fromIdx) => {
    const o = destOrbitFor(dest, fromIdx);
    return (o.peri + o.apo) / 2;
  };
  // MISSION_MODEL_V2 §15 5a: the same downstream lookahead as destOrbitFor,
  // but for a NODE bound to a SEEDED propagated ref-orbit (the NRHO) instead
  // of a Keplerian orbit — the injection leg needs to know it's flying
  // toward the NRHO (not a generic Moon orbit) before it picks its shooter.
  const nrhoRefAfter = (dest, fromIdx) => {
    for (let j = fromIdx + 1; j < (m.log || []).length; j++) {
      const ev = m.log[j];
      if (!_evIsSolvedManeuver(ev) || !ev.toNode) continue;
      const tn = _missionNmNodeById(ev.toNode);
      if (tn && tn.orbitRefId && tn.orbit && tn.orbit.body === dest) return tn.orbitRefId;
    }
    return null;
  };
  // BUG FIX (feedback item 6): canonical node-map dwell templates (PROG_NM_NODES,
  // 'leo'/'tlc'/etc, 430) carry a FIXED inclination and NO lan_deg at all —
  // they are shared visual anchors, not per-mission state. A solved-maneuver
  // leg's fromO/toO used to come straight from those templates, so editing a
  // LAUNCH's authored inc/LAN never reached physSolveNodeBurn/physShootLegAim
  // — the trajectory ring and the maneuver node silently kept flying the
  // template's inc=28.5/lan=0 plane no matter what the launch card said. Fix:
  // track the most recently AUTHORED plane (from the LAUNCH event, then from
  // each subsequent solved maneuver's own toO when IT authored one) and
  // overlay it onto a same-body canonical fromO/toO before solving, so the
  // authored plane actually threads through the whole leg chain.
  let lastAuthoredPlane = null;
  for (let i = 0; i < (m.log || []).length; i++) {
    const e = m.log[i];
    if (e.type === 'LAUNCH' && e.orbit && e.orbit.body && e.orbit.inc_deg != null) {
      lastAuthoredPlane = { body: e.orbit.body, inclination: e.orbit.inc_deg, lan_deg: e.orbit.lan_deg ?? 0 };
    }
    // ── P4: MNODE — a vector burn propagated from the vehicle's node-map
    // orbit at its MET (orbitAtBurn cached by 570's replay). The burn point
    // sits at anomaly theta = n·MET on the mean-altitude circular ring in the
    // orbit's AUTHORED plane (R3, Ω=0 convention; mean-motion phase — same
    // convention physFreeReturnSolve solves in); Δv is applied in the orbit's
    // local frame: pro·v̂ + rad·r̂ + nrm·ĥ — the Normal component is live
    // since R3 (MATH.md §7h).
    if (e.type === 'MNODE' && !_evIsSolvedManeuver(e)) {
      // manual burn (mode:'manual', or a classic vector MNODE with no target
      // at all) — vehicle-relative vector propagated from orbitAtBurn.
      const o = e.orbitAtBurn;
      const burnMet = (e.at && e.at.value_s != null) ? e.at.value_s : (e.metStart || 0);
      const oValid = o && !o.transit && !o.surface && PROG_BODIES[o.body];
      // R6.2″ (round-3 item 5): a mid-leg MNODE placed via the leg placement
      // menu carries a stamped e.burnState/e.burnFrame but has NO orbitAtBurn
      // context at all (it wasn't authored from the vehicle's settled orbit —
      // it was authored from a point mid-transfer). Previously that meant
      // `!o` and this leg bailed with the "no propagable orbit at burn" note
      // — the deliberate R6.2.1 withholding this round replaces with real
      // support: when e.burnState/e.burnFrame are present, use them directly
      // as the burn body/state, skipping the mean-motion reconstruction
      // entirely (there is no "orbit" to reconstruct from at a mid-transfer
      // point). oValid still takes precedence when present (detach-fidelity
      // path, R6.2' Phase B step 5, unchanged).
      const hasBurnState = e.burnState && e.burnState.r && e.burnState.v && e.burnFrame && PROG_BODIES[e.burnFrame];
      const bodyForBurn = oValid ? o.body : (hasBurnState ? e.burnFrame : null);
      if (!bodyForBurn) {
        legs.push({ authIdx: i, met: burnMet, samples: [], events: [], tof_s: 0, tofPhysics: null,
          dvVec: null, frames: [], converged: false, kind: 'mnode',
          note: 'no propagable orbit at burn (transit corridor / surface / unknown body)' });
        continue;
      }
      const mu = PROG_BODIES[bodyForBurn].mu;
      let rBase, vBase, vHat, rHat, hHat;
      if (oValid) {
        const rMean = PROG_BODIES[o.body].R + ((o.perigee ?? o.apogee ?? 0) + (o.apogee ?? o.perigee ?? 0)) / 2;
        const nMean = Math.sqrt(mu / (rMean * rMean * rMean));
        const theta = (nMean * burnMet) % (2 * Math.PI);
        const incMn = ((o.inclination || 0) * Math.PI) / 180;
        // R3.2: if the vehicle's current orbit (orbitAtBurn) authored a plane,
        // the MNODE builder reconstructs the burn frame in THAT plane too —
        // same precedence thread as the departure/arrival cases above.
        const raanMn = o.lan_deg != null ? (o.lan_deg * Math.PI) / 180 : 0;
        const bs = physAimBurnState(o.body, rMean, theta, 0, 0, incMn, 0, raanMn);
        // R6.2' Phase B step 5 (detach fidelity): if this manual MNODE carries
        // a stamped burnState (from detaching a solved maneuver — see 5745's
        // _trajGizmoDetachManeuverIfNeeded), apply the dv vector in THAT exact
        // recorded state's basis instead of the mean-motion reconstruction
        // above, so the detached leg tracks the original solved leg's real
        // path. Falls back to the mean-motion basis (bs) for ordinary
        // hand-authored MNODEs, which never carry a burnState.
        let axes = null;
        if (e.burnState && e.burnState.r && e.burnState.v && typeof _trajGizmoAxes === 'function')
          axes = _trajGizmoAxes(e.burnState.r, e.burnState.v);
        rBase = axes ? e.burnState.r : bs.r;
        vBase = axes ? e.burnState.v : bs.v;
        vHat = axes ? axes.vHat : bs.vHat; rHat = axes ? axes.rHat : bs.rHat; hHat = axes ? axes.hHat : bs.hHat;
      } else {
        // mid-leg placement: the burn point IS the recorded state — no
        // reconstruction needed or possible (no authored orbit at this MET).
        const axes = _trajGizmoAxes(e.burnState.r, e.burnState.v);
        rBase = e.burnState.r; vBase = e.burnState.v;
        vHat = axes.vHat; rHat = axes.rHat; hHat = axes.hHat;
      }
      const dvVec = physAdd(physAdd(
        physScale(vHat, (e.dvPro_ms || 0) / 1000),
        physScale(rHat, (e.dvRad_ms || 0) / 1000)),
        physScale(hHat, (e.dvNrm_ms || 0) / 1000));
      const state = { r: rBase, v: physAdd(vBase, dvVec) };
      // N1b: local n-body set through the one resolver (same recipe as before).
      const bodies = physBodySetFor({ center: bodyForBurn, kind: 'local' });
      // horizon: 30 days, or 3 post-burn periods when the new orbit stays
      // comfortably inside this body's SOI (shows the settled orbit without
      // integrating 500 LEO revs)
      let horizon = 30 * 86400;
      const el = physStateToElements(state.r, state.v, mu);
      // N1 audit note: this ×0.8 encounter-scale comparison selects a DISPLAY
      // horizon (3 periods vs 90 days), not a solver acceptance or a dynamics
      // change — explicit-constant phrasing, bookkeeping only.
      const boundLimitKm = (PHYS_ENCOUNTER_SCALE_KM[bodyForBurn] || Infinity) * 0.8;
      if (el && el.a > 0 && isFinite(el.period) && el.ra < boundLimitKm)
        horizon = Math.min(horizon, Math.max(3 * el.period, 3600));
      // R3.5.2: escapes get 90 days so the committed heliocentric arc matches
      // what the gizmo's full-fidelity preview showed before commit.
      else if (el && (el.a < 0 || el.ra >= boundLimitKm)) horizon = 90 * 86400;
      // R6.2″ (round-3 item 5): cap the horizon at the NEXT authored MNODE's
      // MET so a covering leg's rendered polyline stops at a mid-leg node
      // instead of drawing a phantom continuation past the new burn.
      const nextMnodeMet = physNextMnodeMetAfter(m, i);
      if (nextMnodeMet != null && nextMnodeMet > burnMet) horizon = Math.min(horizon, nextMnodeMet - burnMet);
      let res = physPropagateSegment(state, burnMet, burnMet + horizon,
        { center: bodyForBurn, bodies, overrides: calOverrides }, { maxSamples: 256 });
      // R3.5.3: if the 90-day pass reached heliocentric space, re-propagate
      // once to a full-orbit horizon (physEscapeHorizonS) so the committed
      // arc shows at least one full solar orbit instead of a quarter-orbit.
      // Skipped when a next-node cap is already in force (that cap is a hard
      // authored bound, not a display convenience — never overrun it).
      const fullHorizon = (nextMnodeMet != null && nextMnodeMet > burnMet) ? horizon : physEscapeHorizonS(res.samples, horizon);
      if (fullHorizon > horizon) {
        res = physPropagateSegment(state, burnMet, burnMet + fullHorizon,
          { center: bodyForBurn, bodies, overrides: calOverrides }, { maxSamples: 512 });
      }
      // R6.2' Phase C: classify the SETTLED orbit (final propagated state,
      // in its final frame after any SOI handoff) against the mission's
      // known node-map nodes, for the node-map edge/chip closure + card
      // readout (570/430). Display-only — never touches ΔV accounting.
      let settleInfo = null;
      if (typeof _nmClassifySettledOrbit === 'function' && res.stateF) {
        const nodes = (typeof _missionNmNodes === 'function') ? _missionNmNodes() : [];
        const fromNode = (oValid && typeof _nmMatchOrbitToNode === 'function')
          ? _nmMatchOrbitToNode(o.body, o.perigee ?? o.apogee ?? 0, o.apogee ?? o.perigee ?? 0, o.inclination || 0, nodes)
          : null;
        // A frame change away from the departure body (including a handoff
        // into a body our node set doesn't track, e.g. heliocentric 'Sun')
        // is itself the unambiguous escape signal — no elements needed. Only
        // when the frame is unchanged do we need physStateToElements to tell
        // a settled bound orbit from an unbound one that hasn't crossed the
        // SOI boundary within the propagated horizon.
        const bodyMeta = PROG_BODIES[res.frame];
        let escaped = (res.frame !== bodyForBurn) || !bodyMeta;
        let elF = null;
        if (!escaped) {
          elF = physStateToElements(res.stateF.r, res.stateF.v, bodyMeta.mu);
          if (elF.e >= 1 || !isFinite(elF.a) || elF.a <= 0) escaped = true;
        }
        if (escaped) {
          settleInfo = { kind: 'escape', body: bodyForBurn, fromNodeId: fromNode ? fromNode.id : null };
        } else {
          const node = _nmClassifySettledOrbit(elF, res.frame, nodes);
          settleInfo = node
            ? { kind: 'node', nodeId: node.id, body: res.frame, fromNodeId: fromNode ? fromNode.id : null }
            : { kind: 'orbit', body: res.frame,
                periKm: elF.rp - bodyMeta.R,
                apoKm: isFinite(elF.ra) ? elF.ra - bodyMeta.R : Infinity,
                incDeg: elF.i * 180 / Math.PI,
                fromNodeId: fromNode ? fromNode.id : null };
        }
      }
      legs.push({ authIdx: i, met: burnMet, samples: res.samples, events: res.events,
        tof_s: 0, tofPhysics: null, dvVec, frames: [...new Set(res.samples.map(s => s.frame))],
        converged: true, kind: 'mnode', homeFrame: bodyForBurn, settleInfo,
        // R6.2″ (round-3 item 5): initial post-burn state + propagation
        // context, captured so physLegStateAt can re-derive an exact
        // mid-leg state later without duplicating any of the construction
        // above — one source of truth for "how this leg's state was built".
        initState: state, center: bodyForBurn, bodies, dtMax: undefined,
        dv_ms: Math.sqrt(Math.pow(e.dvPro_ms || 0, 2) + Math.pow(e.dvRad_ms || 0, 2) + Math.pow(e.dvNrm_ms || 0, 2)) });
      continue;
    }
    if (!_evIsSolvedManeuver(e) || !e.fromNode || !e.toNode) continue;
    const fromN = _missionNmNodeById(e.fromNode), toN = _missionNmNodeById(e.toNode);
    let fromO = fromN && fromN.orbit, toO = toN && toN.orbit;
    if (!fromO || !toO) continue;
    // Overlay the last-authored plane onto a canonical (lan_deg-less) fromO
    // that shares its body — see lastAuthoredPlane note above.
    if (lastAuthoredPlane && fromO.body === lastAuthoredPlane.body && fromO.lan_deg == null) {
      fromO = { ...fromO, inclination: lastAuthoredPlane.inclination, lan_deg: lastAuthoredPlane.lan_deg };
    }
    if (toO.lan_deg != null && toO.body) lastAuthoredPlane = { body: toO.body, inclination: toO.inclination || 0, lan_deg: toO.lan_deg };

    // burn magnitude from the EXISTING engine (identical to _missionApplyManeuver)
    const edge = progNmComputeEdgeDv(e.fromNode, e.toNode);
    const dv_ms = (e.dvOverride != null) ? e.dvOverride : (edge ? edge.dv : 0);
    const met = e.metStart != null ? e.metStart : 0;

    // exiting-corridor leg: carries the coast; no propagation of its own —
    // the injection leg already flew it. Physics TOF from that propagation.
    if (fromO.type === 'transit') {
      let tofPhysics = null, converged = false;
      // MISSION_MODEL_V2 Phase 2 S2 (F1 — real arrival burns, critique 58): the
      // exiting leg of a transit corridor carries no propagation of its own
      // (the injection leg already flew the whole trajectory) — but under D5/
      // §11.1 the arrival burn is now a real state-delta, not pure bookkeeping.
      // CONVENTION (documented per the task): at the injection leg's actual
      // arrival state (physArrivalStateAt — last periapsis event in the dest
      // frame, reconstructed by finite difference), the arrival Δv VECTOR is
      // (target dwell-orbit velocity at that position) − (corridor arrival
      // velocity). The target velocity is built from `toO` (this edge's own
      // toNode — the real destination orbit, not the transit corridor): vis-
      // viva magnitude from toO's authored (peri,apo) semi-major axis at the
      // arrival radius, DIRECTION = ĥ_target × r̂_arr (tangential, in the
      // authored target plane; Ω=0-convention normal, same formula as
      // planeMissKm above) — i.e. this assumes the arrival radius already
      // sits in the target plane and targets a near-periapsis/circular
      // insertion, consistent with how the corridor was aimed (§7i). This
      // will generally NOT equal V1's schematic dv_actual for this edge — see
      // MISSION_MODEL_V2.md §11.1/§11.5 and MATH.md for the measured delta.
      let arrivalBurn = null;
      // MISSION_MODEL_V2 §15 5a: an injection leg solved by physSolveNrhoTransfer
      // already carries its own insertion burn (perilune-proximity target, not
      // the generic vis-viva construction below) — use it directly.
      if (lastTransit && lastTransit.kind === 'nrho' && lastTransit.nrhoInsertion &&
          toO.body === lastTransit.dest) {
        converged = lastTransit.converged;
        tofPhysics = lastTransit.tof_s || null;
        arrivalBurn = lastTransit.nrhoInsertion;
      } else
      if (lastTransit && lastTransit.dest && (toO.body === lastTransit.dest || toO.destination === lastTransit.dest)) {
        converged = lastTransit.converged;
        if (converged) {
          const soi = lastTransit.events.find(ev => ev.type === 'soi' && ev.to === lastTransit.dest);
          const peri = lastTransit.events.find(ev => ev.type === 'periapsis' && ev.frame === lastTransit.dest && (!soi || ev.t >= soi.t));
          const tArr = (peri && peri.t) || (soi && soi.t);
          if (tArr != null) tofPhysics = tArr - lastTransit.met;
          const muDest = PROG_BODIES[lastTransit.dest] && PROG_BODIES[lastTransit.dest].mu;
          const arrSt = muDest ? physArrivalStateAt(lastTransit, lastTransit.dest) : null;
          if (arrSt) {
            const rMag = physMag(arrSt.r);
            const rp = PROG_BODIES[lastTransit.dest].R + (toO.perigee ?? toO.apogee ?? 0);
            const ra = PROG_BODIES[lastTransit.dest].R + (toO.apogee ?? toO.perigee ?? 0);
            const aTarget = (rp + ra) / 2;
            const vTargetMag = (aTarget > 0 && rMag > 0) ? Math.sqrt(Math.max(0, muDest * (2 / rMag - 1 / aTarget))) : null;
            const incT = (toO.inclination || 0) * Math.PI / 180;
            const raanT = toO.lan_deg != null ? (toO.lan_deg * Math.PI / 180) : 0;
            const hHatT = [Math.sin(raanT) * Math.sin(incT), -Math.cos(raanT) * Math.sin(incT), Math.cos(incT)];
            const rHat = rMag > 0 ? physScale(arrSt.r, 1 / rMag) : null;
            const vDirRaw = rHat ? physCross(hHatT, rHat) : null;
            const vDirMag = vDirRaw ? physMag(vDirRaw) : 0;
            if (vTargetMag != null && isFinite(vTargetMag) && vDirMag > 1e-9) {
              const vTargetVec = physScale(vDirRaw, vTargetMag / vDirMag);
              arrivalBurn = { t: arrSt.t, frame: lastTransit.dest, r: arrSt.r, vPre: arrSt.v,
                dvVec: physSub(vTargetVec, arrSt.v) };
            }
          }
        }
      }
      legs.push({ authIdx: i, fromNode: e.fromNode, toNode: e.toNode, met,
        samples: [], events: [], tof_s: e.durationUsed != null ? e.durationUsed : 0,
        tofPhysics, dvVec: null, frames: [], converged, kind: 'arrival', arrivalBurn });
      continue;
    }

    const burn = physSolveNodeBurn(fromO, toO, met, dv_ms / 1000, calOverrides);
    if (!burn) continue;

    if (burn.kind === 'samebody') {
      // pure two-body: analytic Kepler samples at ~64 even time steps (no integrator)
      const mu = PROG_BODIES[burn.center].mu;
      const N = 64, samples = [];
      // R6.2″ (round-3 item 5): cap the analytic coast at the next authored
      // MNODE's MET so this leg's samples (and rendered polyline) stop at a
      // mid-leg maneuver instead of coasting past it.
      const nextMnodeMetSb = physNextMnodeMetAfter(m, i);
      const tof = (nextMnodeMetSb != null && nextMnodeMetSb > met)
        ? Math.min(burn.coastTof_s || 0, nextMnodeMetSb - met) : (burn.coastTof_s || 0);
      let bad = false;
      for (let k = 0; k <= N; k++) {
        const dt = tof * k / N;
        const st = physKeplerPropagate(burn.state.r, burn.state.v, dt, mu);
        if (!st) { bad = true; break; }   // physKeplerPropagate can return null
        samples.push({ t: met + dt, r: st.r, frame: burn.center });
      }
      legs.push({ authIdx: i, fromNode: e.fromNode, toNode: e.toNode, met,
        samples: bad ? [] : samples, events: [], tof_s: tof, tofPhysics: tof || null,
        dvVec: burn.dvVec, frames: [burn.center], converged: !bad, kind: burn.kind,
        // R6.2' Phase B step 5: the PRE-burn departure state the dv vector
        // was actually applied to — basis for correct decomposition/replay.
        burnState: burn.preState,
        // R6.2″ (round-3 item 5): initial post-burn state + propagation
        // context for physLegStateAt (one source of truth with the samples
        // built above — same burn.state/burn.center this loop already used).
        initState: burn.state, center: burn.center, bodies: [burn.center], dtMax: undefined });
      // R6.2' Phase B (step 2/5): display-only dv-component mirror, decomposed
      // against the leg's REAL burn state (not a mean-motion reconstruction).
      if (e.type === 'MNODE' && burn.dvVec && typeof _trajGizmoAxes === 'function' && typeof _trajGizmoDecomposeDv === 'function') {
        const axes = _trajGizmoAxes(burn.preState.r, burn.preState.v);
        const d = axes ? _trajGizmoDecomposeDv(burn.dvVec, axes) : null;
        if (d) { e.dvPro_ms = d.pro; e.dvRad_ms = d.rad; e.dvNrm_ms = d.nrm; }
      }
      continue;
    }

    // MISSION_MODEL_V2 §15 5a: an injection leg headed toward a node bound to
    // a SEEDED propagated ref-orbit (the NRHO) uses the dedicated solver
    // instead of the generic moon-leg shooter below — the NRHO isn't a
    // Keplerian target, it's a specific propagated trajectory phased to the
    // arrival epoch. physSolveNrhoTransfer owns its own solve cache.
    const nrhoRef = burn.kind === 'moon' ? nrhoRefAfter(burn.dest, i) : null;
    if (nrhoRef) {
      let nsol;
      try { nsol = physSolveNrhoTransfer(fromO, nrhoRef, met, { dv_kms: dv_ms / 1000 }); }
      catch (err) { nsol = { converged: false, note: 'exception: ' + (err && err.message) }; }
      const leg = { authIdx: i, fromNode: e.fromNode, toNode: e.toNode, met,
        samples: nsol.samples || [], events: nsol.events || [],
        tof_s: nsol.tof_s || burn.coastTof_s, tofPhysics: null,
        dvVec: nsol.dvDepartVec || burn.dvVec,
        frames: nsol.samples ? [...new Set(nsol.samples.map(s => s.frame))] : [burn.center],
        converged: !!nsol.converged, kind: 'nrho', dest: burn.dest,
        missKm: nsol.missKm, note: nsol.note, nrhoInsertion: nsol.insertionBurn,
        mccBurn: nsol.mccBurn || null, nrhoRefId: nrhoRef,
        burnState: burn.preState, initState: burn.state, center: burn.center, bodies: burn.bodies, dtMax: undefined };
      legs.push(leg);
      lastTransit = leg;
      if (e.type === 'MNODE' && leg.dvVec && typeof _trajGizmoAxes === 'function' && typeof _trajGizmoDecomposeDv === 'function') {
        const axes = _trajGizmoAxes(burn.preState.r, burn.preState.v);
        const d = axes ? _trajGizmoDecomposeDv(leg.dvVec, axes) : null;
        if (d) { e.dvPro_ms = d.pro; e.dvRad_ms = d.rad; e.dvNrm_ms = d.nrm; }
      }
      continue;
    }

    // n-body leg (moon / interplanetary): P4 — refine the analytic aim with
    // the differential corrector (burn anomaly ± pitch; |Δv| FIXED), cached
    // by leg signature so a warm recompute costs ~one propagation per leg.
    let st0 = burn.state, dvVec = burn.dvVec, st0Pre = burn.preState;
    const r1 = physMag(burn.state.r);
    const incLeg = (fromO.inclination || 0);
    let raanUsed = 0;
    {
      // R3: signature includes the departure inclination AND lan/raan —
      // editing a node's inclination OR LAN must re-shoot the leg. The
      // lan_deg term was MISSING here (bug fix, feedback item 6): a LAN edit
      // changed fromO.lan_deg but left this signature identical, so the
      // differential-corrector cache kept returning the shot solved under
      // the OLD plane — the trajectory ring/maneuver node visibly stuck to
      // the previous LAN despite the authored orbit having changed.
      const lanLeg = (fromO.lan_deg != null) ? fromO.lan_deg : 0;
      const sig = `${e.fromNode}|${e.toNode}|${met.toFixed(0)}|${dv_ms.toFixed(1)}|i${incLeg}|o${lanLeg}`;
      let aim = _physShootCache[sig];
      if (!aim) {
        let sol = null;
        try { sol = physShootLegAim(fromO, toO, met, dv_ms / 1000, calOverrides, { destAltKm: destAltFor(burn.dest, i) }); }
        catch (err) { sol = null; }
        aim = sol ? { theta: sol.theta, pitch: sol.pitch, yaw: sol.yaw || 0, raan: sol.raan || 0, shot: sol.converged, missKm: sol.missKm, iters: sol.iters }
                  : { shot: false };
        _physShootCache[sig] = aim;
      }
      if (aim.theta != null) {
        // even an unconverged shoot's best x beats the raw analytic seed
        raanUsed = aim.raan || 0;
        const bs = physAimBurnState(burn.center, r1, aim.theta, aim.pitch || 0, dv_ms / 1000,
          incLeg * Math.PI / 180, aim.yaw || 0, raanUsed);
        st0 = { r: bs.r, v: bs.v }; dvVec = bs.dvVec;
        // R6.2' Phase B step 5: the shooter's actual PRE-burn departure state
        // (bs.vPre) — this is the real basis the corrector flew, distinct
        // from the mean-motion reconstruction 5745's fallback uses.
        st0Pre = { r: bs.r, v: bs.vPre };
      }
    }
    let cutoff = met + 1.5 * Math.max(burn.coastTof_s, 3600);
    // R6.2″ (round-3 item 5): cap at the next authored MNODE's MET so this
    // covering leg's polyline stops at a mid-leg maneuver placed inside it.
    const nextMnodeMetNb = physNextMnodeMetAfter(m, i);
    if (nextMnodeMetNb != null && nextMnodeMetNb > met && nextMnodeMetNb < cutoff) cutoff = nextMnodeMetNb;
    const nbDtMax = burn.kind === 'interplanetary' ? 16384 : undefined;
    const res = physPropagateSegment(st0, met, cutoff,
      { center: burn.center, bodies: burn.bodies, overrides: calOverrides,
        dtMax: nbDtMax }, { maxSamples: 256 });
    const converged = res.events.some(ev => ev.type === 'soi' && ev.to === burn.dest);
    // R3.1 (MATH.md §7i): departure/arrival ORIENTATION for the state-derived
    // ring (574 consumes these; the ΔV-engine's authored {peri,apo,inc} stay
    // untouched — orientation is geometry only in this phase). Departure is
    // the exact circular-ring plane the corrector actually flew (tier 2a);
    // arrival is the osculating plane of the real arrival state, with SIZE
    // pinned to the authored target orbit (tier 2b — accounting truth vs
    // flight truth, see the module doc comment above).
    let departElements = null, arrivalElements = null;
    if (converged) {
      departElements = { a: r1, e: 0, i: incLeg * Math.PI / 180, raan: raanUsed, argp: 0 };
      const muDest = PROG_BODIES[burn.dest] && PROG_BODIES[burn.dest].mu;
      const oscul = muDest ? physArrivalOsculatingElements(res, burn.dest, muDest) : null;
      if (oscul && PROG_BODIES[burn.dest]) {
        const Rd = PROG_BODIES[burn.dest].R;
        // AUTHORED target size (§7i split: size is accounting truth) — the
        // leg's own `toO` is the transit/corridor node and has no perigee of
        // its own, so look ahead to the real destination-orbit MANEUVER
        // (same lookahead the shooter's destAltFor already performs).
        const destO = destOrbitFor(burn.dest, i);
        const rp = Rd + Math.min(destO.peri, destO.apo);
        const ra = Rd + Math.max(destO.peri, destO.apo);
        if (ra > 0) {
          arrivalElements = { a: (rp + ra) / 2, e: (ra - rp) / (ra + rp), i: oscul.i, raan: oscul.raan, argp: oscul.argp };
        }
      }
    }
    const leg = { authIdx: i, fromNode: e.fromNode, toNode: e.toNode, met,
      samples: res.samples, events: res.events, tof_s: burn.coastTof_s,
      tofPhysics: null,   // injection is impulsive under the corridor rule — no coast of its own
      dvVec, frames: [...new Set(res.samples.map(s => s.frame))],
      converged, kind: burn.kind, dest: burn.dest, departElements, arrivalElements,
      // R6.2' Phase B step 5 (basis fix): the ACTUAL departure state the dv
      // vector was applied to — the shooter's refined state when it
      // converged (st0Pre), else the analytic seed's pre-burn state
      // (burn.preState). Consumers (5745 gizmo, this file's own dv-mirror
      // below) decompose against THIS basis instead of a mean-motion
      // reconstruction — fixes the Phase A known limitation (PHYSICS_PLAN
      // R6.2': Apollo TLI read pro -2085/rad +2151/nrm +950 for what is
      // physically a ~pure-prograde burn).
      burnState: st0Pre,
      // R6.2″ (round-3 item 5): initial post-burn state + propagation
      // context for physLegStateAt — st0/burn.center/burn.bodies/nbDtMax are
      // the EXACT values this leg's own res = physPropagateSegment(...) call
      // above just used (one source of truth, not duplicated).
      initState: st0, center: burn.center, bodies: burn.bodies, dtMax: nbDtMax };
    legs.push(leg);
    lastTransit = leg;
    // R6.2' Phase B (step 2/5): mirror the solved leg's real dvVec onto the
    // unified MNODE's dv components — DISPLAY ONLY (the gizmo/card handle
    // readout), never the accounting source (that stays dvVec's magnitude
    // via progNmComputeEdgeDv above, e.dvRequired/e.dv_actual). Decomposed
    // against the RECORDED burn state's local (v̂,r̂,ĥ) basis (leg.burnState —
    // the shooter's actual departure state for a moon/interplanetary leg, not
    // the mean-motion reconstruction). No-op for a legacy MANEUVER entry (no
    // dv fields to refresh) or if 5745 hasn't loaded yet (guarded, never a
    // hard dependency).
    if (e.type === 'MNODE' && dvVec && typeof _trajGizmoAxes === 'function' && typeof _trajGizmoDecomposeDv === 'function') {
      const axes = _trajGizmoAxes(leg.burnState.r, leg.burnState.v);
      const d = axes ? _trajGizmoDecomposeDv(dvVec, axes) : null;
      if (d) { e.dvPro_ms = d.pro; e.dvRad_ms = d.rad; e.dvNrm_ms = d.nrm; }
    }
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
 *  dvNrm_ms }. Same push→recompute→render pattern as missionExecManeuver.
 *  `opts` (R6.2″, round-3 item 5, mid-leg placement):
 *    - afterAuthIdx: insert right after this log index instead of appending
 *      at the end (a mid-leg node must sit between the covering leg's own
 *      authored event and any later event, not after everything — array
 *      order IS execution order, see missionRecompute).
 *    - burnState {r,v} / burnFrame: stamped onto the entry so 565's MNODE
 *      leg builder (above) uses this EXACT pre-burn state instead of trying
 *      to reconstruct one from orbitAtBurn (there is none, mid-transfer).
 *  Returns the entry's final index in m.log. */
function missionExecManeuverNode(id, spec, opts) {
  const m = _missionGet(id);
  if (!m || !spec) return;
  const actFv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  const entry = {
    type: 'MNODE',
    at: { kind: 'met', value_s: spec.value_s || 0 },
    dvPro_ms: spec.dvPro_ms || 0, dvRad_ms: spec.dvRad_ms || 0, dvNrm_ms: spec.dvNrm_ms || 0,
    activeKey: actFv ? actFv._originKey : null,
    activeName: actFv ? _missionVehicleDisplayName(actFv) : null,
  };
  if (opts && opts.burnState && opts.burnState.r && opts.burnState.v && opts.burnFrame) {
    entry.burnState = { r: opts.burnState.r.slice(), v: opts.burnState.v.slice() };
    entry.burnFrame = opts.burnFrame;
  }
  let insertAt = m.log.length;
  if (opts && opts.afterAuthIdx != null && opts.afterAuthIdx >= 0 && opts.afterAuthIdx < m.log.length)
    insertAt = opts.afterAuthIdx + 1;
  m.log.splice(insertAt, 0, entry);
  missionRecompute(m);
  missionRenderDetail();
  return insertAt;
}
