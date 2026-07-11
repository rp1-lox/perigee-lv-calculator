
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
  const bodies = destPlanet ? ['Sun', 'Earth', destPlanet]
    : (destMoon ? [PROG_MOON_ORBITS[destMoon].parent, destMoon, 'Sun'] : [fromBody]);
  return {
    state: { r: bs.r, v: bs.v }, center: fromBody, bodies, dvVec: bs.dvVec,
    coastTof_s: coastTof, dest: destMoon || destPlanet || toOrbit.body,
    kind: destMoon ? 'moon' : (destPlanet ? 'interplanetary' : 'samebody'),
  };
}

// ── P4: targeting — generic differential corrector + leg aim ─────────────────
//
// ΔV ACCOUNTING PARITY (sacred): the shooter adjusts WHERE the burn happens
// (anomaly theta on the parking orbit) and its DIRECTION (in-plane pitch off
// prograde; R3 adds out-of-plane yaw toward ĥ) — NEVER the magnitude.
// |Δv| is always the engine-supplied value. If the fixed magnitude cannot
// reach the target, we return converged:false and the renderer keeps the
// schematic arc (MATH.md §7g/§7h).

/** Burn state on a circular parking ring in its AUTHORED plane (R3):
 *  position at true anomaly `theta` on the orbit {a:r1, e:0, i:incRad,
 *  Ω=0, ω=0} (Ω=0 convention — same orbit the R2 ring renderer draws),
 *  velocity = circular + dv_kms along a unit vector pitched `pitch` rad off
 *  prograde toward radial-out and yawed `yaw` rad toward the orbit normal ĥ:
 *  d̂v = cos(yaw)·(cos(pitch)·v̂ + sin(pitch)·r̂) + sin(yaw)·ĥ — exactly unit
 *  length (v̂ ⊥ r̂ ⊥ ĥ on a circular orbit), so |dvVec| = dv_kms always.
 *  incRad/yaw omitted → the pre-R3 planar behavior, bit-identical.
 *  Pure. Returns {r, v, dvVec, rHat, vHat, hHat}. */
function physAimBurnState(fromBody, r1, theta, pitch, dv_kms, incRad, yaw, raanRad) {
  const mu = PROG_BODIES[fromBody].mu;
  const st = physElementsToState({ a: r1, e: 0, i: incRad || 0, raan: raanRad || 0, argp: 0, nu: theta }, mu);
  const rHat = physScale(st.r, 1 / physMag(st.r));
  const vHat = physScale(st.v, 1 / physMag(st.v));
  const hV = physCross(st.r, st.v);
  const hHat = physScale(hV, 1 / physMag(hV));
  const p = pitch || 0, yw = yaw || 0;
  const inPlane = physAdd(physScale(vHat, Math.cos(p)), physScale(rHat, Math.sin(p)));
  const dvDir = physAdd(physScale(inPlane, Math.cos(yw)), physScale(hHat, Math.sin(yw)));
  const dvVec = physScale(dvDir, dv_kms);
  return { r: st.r, v: physAdd(st.v, dvVec), dvVec, rHat, vHat, hHat };
}

/** Closest approach of a propagation result to body `dest`: exact periapsis
 *  events in the dest frame win; otherwise the (decimated) sample minimum.
 *  Returns {dKm, t, dz} — dz (R3) is the out-of-plane (world z) component of
 *  the dest-relative miss vector at the SAMPLE minimum (events carry no
 *  vector), the 3rd miss component for the shooter's yaw DOF. Body positions
 *  via physBodyStateAt (one position source). */
function physClosestApproachKm(res, dest, overrides) {
  let best = Infinity, tBest = null;
  (res.events || []).forEach(ev => {
    if (ev.type === 'periapsis' && ev.frame === dest && ev.rMag < best) { best = ev.rMag; tBest = ev.t; }
  });
  let sBest = Infinity, dz = 0;
  (res.samples || []).forEach(s => {
    let d, dzS;
    if (s.frame === dest) { d = physMag(s.r); dzS = s.r[2]; }
    else {
      const fHelio = s.frame === 'Sun' ? [0, 0, 0] : physBodyStateAt(s.frame, s.t, overrides).r;
      const delta = physSub(physAdd(s.r, fHelio), physBodyStateAt(dest, s.t, overrides).r);
      d = physMag(delta); dzS = delta[2];
    }
    if (d < sBest) { sBest = d; dz = dzS; }
    if (d < best) { best = d; tBest = s.t; }
  });
  return { dKm: best, t: tBest, dz };
}

/** R3.1: osculating plane of a converged leg's actual arrival, for the
 *  STATE-DERIVED orbit ring (MATH.md §7f-R2/§7h/§7i). The propagator only
 *  records POSITION samples (no velocity) plus periapsis events (rMag + t,
 *  no vector) — so the arrival velocity is reconstructed by a central finite
 *  difference of the two dest-frame samples bracketing the arrival periapsis
 *  event's time, and the arrival radius vector is that same bracket's linear
 *  position interpolation rescaled onto the event's exact rMag. This is an
 *  approximation (decimated samples, not a re-integration) — good enough for
 *  RING ORIENTATION (i, raan, argp), which is all this phase consumes; it is
 *  NOT precise enough for a targeting residual. Deterministic given fixed
 *  samples/events (same propagation -> same bracket -> same result).
 *  Returns osculating {a,e,i,raan,argp,nu,hVec} (physStateToElements' full
 *  return) or null if no periapsis event was recorded in `dest`'s frame. */
function physArrivalOsculatingElements(res, dest, mu) {
  const peris = (res.events || []).filter(ev => ev.type === 'periapsis' && ev.frame === dest);
  if (!peris.length) return null;
  const ev = peris[peris.length - 1];   // last = the post-encounter periapsis nearest actual arrival
  const destSamples = (res.samples || []).filter(s => s.frame === dest).sort((a, b) => a.t - b.t);
  if (destSamples.length < 2) return null;
  let idx = destSamples.findIndex(s => s.t >= ev.t);
  if (idx <= 0) idx = 1;
  if (idx >= destSamples.length) idx = destSamples.length - 1;
  const s0 = destSamples[idx - 1], s1 = destSamples[idx];
  const dt = s1.t - s0.t;
  if (!(dt > 0)) return null;
  const v = physScale(physSub(s1.r, s0.r), 1 / dt);
  const frac = (ev.t - s0.t) / dt;
  const rInterp = physAdd(s0.r, physScale(physSub(s1.r, s0.r), frac));
  const rMagInterp = physMag(rInterp);
  if (!(rMagInterp > 0)) return null;
  const rDir = physScale(rInterp, 1 / rMagInterp);
  const r = physScale(rDir, ev.rMag != null ? ev.rMag : rMagInterp);
  return physStateToElements(r, v, mu);
}

/**
 * Generic n-DOF (n = 1, 2 or 3) differential corrector.
 *   burnSolveFn(x) -> initial state {r,v} (or null)
 *   targetFn(propagatedResult, x) -> miss vector (length n, km-scaled) or null
 *   x0: initial guess array; opts = { propagate (REQUIRED: state -> result via
 *   physPropagateSegment), maxIter=12, tolKm=500, eps (scalar or per-component
 *   array, default 1e-3), maxProps=40 }.
 * Finite-difference Jacobian, Newton steps with step-halving damping (a step
 * whose miss grows or goes non-finite is halved, up to 4 times). Terminates
 * cleanly on singular Jacobian / non-finite miss / propagation budget:
 * {converged:false}. Deterministic (no randomness, fixed eval order).
 * Returns { converged, x, missKm, iters, propagations }.
 */
function physShootToTarget(burnSolveFn, targetFn, x0, opts) {
  opts = opts || {};
  const maxIter = opts.maxIter != null ? opts.maxIter : 12;
  const tolKm = opts.tolKm != null ? opts.tolKm : 500;
  const maxProps = opts.maxProps != null ? opts.maxProps : 40;
  const propagate = opts.propagate;
  const n = x0.length;
  const eps = Array.isArray(opts.eps) ? opts.eps : x0.map(() => (opts.eps || 1e-3));
  let props = 0;
  const evalMiss = x => {
    if (props >= maxProps) return null;
    props++;
    const st = burnSolveFn(x);
    if (!st) return null;
    const res = propagate(st, x);
    if (!res) return null;
    const miss = targetFn(res, x);
    if (!miss || miss.length !== n || miss.some(v => !isFinite(v))) return null;
    return miss;
  };
  const norm = mv => Math.hypot.apply(null, mv);
  let x = x0.slice();
  let miss = evalMiss(x);
  if (!miss) return { converged: false, x, missKm: Infinity, iters: 0, propagations: props };
  let it = 0;
  for (; it < maxIter; it++) {
    if (norm(miss) <= tolKm) return { converged: true, x, missKm: norm(miss), iters: it, propagations: props };
    // finite-difference Jacobian columns (J[j][k] = dmiss_k/dx_j)
    const J = [];
    let jacBad = false;
    for (let j = 0; j < n; j++) {
      const xp = x.slice(); xp[j] += eps[j];
      const mp = evalMiss(xp);
      if (!mp) { jacBad = true; break; }
      J.push(mp.map((v, k) => (v - miss[k]) / eps[j]));
    }
    if (jacBad) return { converged: false, x, missKm: norm(miss), iters: it, propagations: props };
    // Newton step: solve M dx = -miss with M[k][j] = J[j][k]
    let dx;
    if (n === 1) {
      if (!isFinite(J[0][0]) || Math.abs(J[0][0]) < 1e-12) return { converged: false, x, missKm: norm(miss), iters: it, propagations: props };
      dx = [-miss[0] / J[0][0]];
    } else if (n === 2) {
      const det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
      if (!isFinite(det) || Math.abs(det) < 1e-15) return { converged: false, x, missKm: norm(miss), iters: it, propagations: props };
      dx = [
        (-miss[0] * J[1][1] + miss[1] * J[1][0]) / det,
        (miss[0] * J[0][1] - miss[1] * J[0][0]) / det,
      ];
    } else {
      // n === 3 (R3): Cramer's rule on M[k][j] = J[j][k], solve M dx = -miss
      const M = [
        [J[0][0], J[1][0], J[2][0]],
        [J[0][1], J[1][1], J[2][1]],
        [J[0][2], J[1][2], J[2][2]],
      ];
      const det3 = m3 =>
        m3[0][0] * (m3[1][1] * m3[2][2] - m3[1][2] * m3[2][1]) -
        m3[0][1] * (m3[1][0] * m3[2][2] - m3[1][2] * m3[2][0]) +
        m3[0][2] * (m3[1][0] * m3[2][1] - m3[1][1] * m3[2][0]);
      const det = det3(M);
      if (!isFinite(det) || Math.abs(det) < 1e-15) return { converged: false, x, missKm: norm(miss), iters: it, propagations: props };
      const b = [-miss[0], -miss[1], -miss[2]];
      const col = (m3, j, v) => m3.map((row, k) => row.map((c, jj) => jj === j ? v[k] : c));
      dx = [det3(col(M, 0, b)) / det, det3(col(M, 1, b)) / det, det3(col(M, 2, b)) / det];
      if (dx.some(v => !isFinite(v))) return { converged: false, x, missKm: norm(miss), iters: it, propagations: props };
    }
    // damped acceptance: halve the step while the miss grows / breaks
    let accepted = null, mNew = null, scale = 1;
    for (let h = 0; h < 4; h++) {
      const xt = x.map((v, j) => v + dx[j] * scale);
      const mt = evalMiss(xt);
      if (mt && norm(mt) < norm(miss)) { accepted = xt; mNew = mt; break; }
      scale /= 2;
    }
    if (!accepted) return { converged: norm(miss) <= tolKm, x, missKm: norm(miss), iters: it + 1, propagations: props };
    x = accepted; miss = mNew;
  }
  return { converged: norm(miss) <= tolKm, x, missKm: norm(miss), iters: it, propagations: props };
}

/**
 * Aim an existing node MANEUVER's injection burn with the corrector,
 * escalating DOF only when the previous stage stalls above tolerance:
 *   1-DOF: burn anomaly theta (cheap, usually enough for moon legs)
 *   2-DOF: theta + in-plane pitch, with an arrival-timing miss component
 *          (closest-approach time vs. the schematic TOF × 0.5 km/s) so the
 *          2×2 Jacobian is full-rank (MATH.md §7g)
 *   3-DOF (R3): theta + pitch + out-of-plane yaw toward ĥ, third miss
 *          component = out-of-plane (z) miss at closest approach — the DOF
 *          that closes plane-mismatched encounters (28.5° LEO → 5.145° Moon).
 * The departure ring carries fromOrbit's AUTHORED inclination (Ω=0
 * convention, §7h). Target: closest approach to the destination body equals
 * the destination-orbit radius. |Δv| = dv_kms, FIXED throughout — direction
 * only. Moon-leg acceptance tightened by R3 to min(SOI/3, 25,000 km), with a
 * 5,000 km solver tolerance driving the Newton loop itself.
 * Propagation budget ≤ 58 per leg (12 + 16 + 30).
 * Returns { converged, theta, pitch, yaw, missKm, iters, propagations, dof }
 * or null (no n-body leg model for this pair).
 */
function physShootLegAim(fromOrbit, toOrbit, tDepart_s, dv_kms, overrides, opts) {
  overrides = overrides || {}; opts = opts || {};
  const burn0 = physSolveNodeBurn(fromOrbit, toOrbit, tDepart_s, dv_kms, overrides);
  if (!burn0 || (burn0.kind !== 'moon' && burn0.kind !== 'interplanetary')) return null;
  const dest = burn0.dest, fromBody = burn0.center;
  const r1 = physMag(burn0.state.r);
  const incRad = ((fromOrbit.inclination || 0) * Math.PI) / 180;
  // in-plane anomaly of the analytic seed (physSolveNodeBurn placed it at ν=theta)
  let theta0 = physPhaseBurnAngle(progBodyAngleAt(dest, tDepart_s + burn0.coastTof_s));
  const soi = physSoiRadius(dest);
  const targetR = PROG_BODIES[dest].R + (opts.destAltKm != null ? opts.destAltKm : 100);
  // R3 acceptance: the yaw DOF lets the burn leave the departure plane, so
  // plane-mismatched encounters can now close for real — moon legs tighten
  // from the R1 SOI/3 (which absorbed the coplanar out-of-plane floor) to
  // ACCEPTANCE min(SOI/3, 25,000 km), and the Newton loop itself drives
  // toward a tighter 5,000 km SOLVER tolerance so accepted moon legs actually
  // arrive near the destination-orbit radius instead of stopping the moment
  // they duck under the acceptance bar. Interplanetary keeps SOI/3
  // (encounter stepping and mean-element rails dominate there, §7g).
  const acceptKm = burn0.kind === 'moon' ? Math.min(soi / 3, 25000) : soi / 3;
  const tolKm = burn0.kind === 'moon' ? Math.min(5000, acceptKm) : acceptKm;
  const cutoff = tDepart_s + 1.5 * Math.max(burn0.coastTof_s, 3600);
  // heliocentric cruise: cap the step ladder so the encounter can't be
  // stepped over (see physStepFor ctx.dtMax) — fixed constant, deterministic
  const ctx = { center: fromBody, bodies: burn0.bodies, overrides,
    dtMax: burn0.kind === 'interplanetary' ? 16384 : undefined };
  const propagate = st => physPropagateSegment({ r: st.r, v: st.v }, tDepart_s, cutoff, ctx, { maxSamples: 128 });
  const tArrSched = tDepart_s + burn0.coastTof_s;
  // Solved RAAN for moon legs (R3.0.1, 2026-07-10 — R3.1's tier-3 rule pulled
  // forward because physics NEEDS it): with Ω pinned to 0, a 28.5° parking
  // plane can sit up to ~34° from the Moon's plane and a fixed-|Δv| TLI
  // physically cannot cross that gap (yaw redirects, it can't buy plane
  // change) — the live Apollo seed stalled at ~1e5 km. Real missions launch
  // into the right plane; we solve the same thing: choose Ω so the ring's
  // plane CONTAINS the target's position at scheduled arrival. Plane normal
  // n(Ω) = [sinΩ·sin i, −cosΩ·sin i, cos i]; n·m̂ = 0 is a·sinΩ + b·cosΩ = c
  // with a = m̂x·sin i, b = −m̂y·sin i, c = −m̂z·cos i → two roots (ascending /
  // descending geometry), both tried in the seed grid. No solution (i smaller
  // than the target's latitude) or interplanetary legs keep Ω = 0.
  // R3.2 tier 1: an AUTHORED departure plane (fromOrbit.lan_deg) is fixed
  // geometry — it IS the orbit, not a target for the solve. Skip the raan
  // solve entirely (raanRoots = [authored], single root, no ascending/
  // descending ambiguity to try) so a plane the fixed |Δv| genuinely cannot
  // reach honestly reports converged:false downstream rather than silently
  // being re-aimed onto a different plane the user didn't author.
  const raanAuthored = fromOrbit.lan_deg != null;
  const raanRoots = raanAuthored ? [(fromOrbit.lan_deg * Math.PI) / 180] : [0];
  if (!raanAuthored && burn0.kind === 'moon' && incRad > 1e-6) {
    const mSt = physPatchState(physBodyStateAt(dest, tArrSched), 'Sun', fromBody, tArrSched, overrides);
    const mMag = physMag(mSt.r);
    if (mMag > 0) {
      const mHat = physScale(mSt.r, 1 / mMag);
      const a = mHat[0] * Math.sin(incRad), b = -mHat[1] * Math.sin(incRad), c = -mHat[2] * Math.cos(incRad);
      const R = Math.hypot(a, b);
      if (R > 1e-12 && Math.abs(c) <= R) {
        const delta = Math.atan2(b, a);
        const s = Math.asin(Math.max(-1, Math.min(1, c / R)));
        raanRoots.length = 0;
        raanRoots.push(s - delta, Math.PI - s - delta);
      }
    }
  }
  // Coarse seed scan: the analytic phase angle is an ECLIPTIC angle while ν
  // is measured IN the (inclined, now RAAN-solved) orbit plane — Newton needs
  // the right basin. Deterministic 16-point θ grid × each Ω root.
  let raan0 = raanRoots[0];
  {
    // CHEAP propagation for the scan (shorter cutoff, coarse step cap, few
    // samples — only the closest-approach magnitude matters, not a drawable
    // trajectory): keeps the 16×roots grid from dominating cold recompute.
    const cheapCutoff = tDepart_s + 1.1 * Math.max(burn0.coastTof_s, 3600);
    const cheapProp = st => physPropagateSegment({ r: st.r, v: st.v }, tDepart_s, cheapCutoff,
      Object.assign({}, ctx, { dtMax: ctx.dtMax || 4096, stepsPerOrbit: 90 }), { maxSamples: 8 });
    let bestTheta = theta0, bestMiss = Infinity;
    for (const rn of raanRoots) {
      for (let k = 0; k < 16; k++) {
        const th = theta0 + (2 * Math.PI * k) / 16;
        const st = physAimBurnState(fromBody, r1, th, 0, dv_kms, incRad, 0, rn);
        const res = cheapProp(st);
        const miss = Math.abs(physClosestApproachKm(res, dest, overrides).dKm - targetR);
        if (miss < bestMiss) { bestMiss = miss; bestTheta = th; raan0 = rn; }
      }
    }
    theta0 = bestTheta;
  }
  // R3.2: an AUTHORED arrival plane (toOrbit.lan_deg + .inclination) adds a
  // plane-alignment component to the miss vector — insertion into "LLO i=90
  // Ω=X" is a genuinely different target than "any 100 km LLO" (spec, R3.2).
  // Conditioning: angle between the arrival h-vector (osculating, via the
  // existing physArrivalOsculatingElements helper) and the authored target
  // plane's normal, scaled to km by angle_rad × SOI — a hand-tuned scale that
  // puts a full-turn plane miss (π rad) at the same order of magnitude as the
  // SOI-scale radial/timing misses already in the vector, so no single
  // component dominates the Newton step. Documented here per the plan's
  // "document the constant as hand-tuned" instruction.
  const toAuthoredPlane = (toOrbit.lan_deg != null && toOrbit.inclination != null)
    ? { i: (toOrbit.inclination * Math.PI) / 180, raan: (toOrbit.lan_deg * Math.PI) / 180 } : null;
  const planeMissKm = res => {
    if (!toAuthoredPlane) return 0;
    const muDest = PROG_BODIES[dest] && PROG_BODIES[dest].mu;
    if (!muDest) return 0;
    const osc = physArrivalOsculatingElements(res, dest, muDest);
    if (!osc) return soi; // no captured arrival yet -> large residual, keeps escalation honest
    const nA = [Math.sin(osc.raan) * Math.sin(osc.i), -Math.cos(osc.raan) * Math.sin(osc.i), Math.cos(osc.i)];
    const nT = [Math.sin(toAuthoredPlane.raan) * Math.sin(toAuthoredPlane.i), -Math.cos(toAuthoredPlane.raan) * Math.sin(toAuthoredPlane.i), Math.cos(toAuthoredPlane.i)];
    const dot = Math.max(-1, Math.min(1, nA[0] * nT[0] + nA[1] * nT[1] + nA[2] * nT[2]));
    return Math.acos(dot) * soi;
  };
  // 1-DOF: burn anomaly only. An authored arrival plane is NOT checked by
  // this stage (no yaw DOF to satisfy it yet) — skip its early-converged
  // return so the ladder always escalates to the plane-aware 3-DOF stage.
  const sol1 = physShootToTarget(
    x => physAimBurnState(fromBody, r1, x[0], 0, dv_kms, incRad, 0, raan0),
    res => [physClosestApproachKm(res, dest, overrides).dKm - targetR],
    [theta0], { propagate, tolKm, eps: [1e-3], maxIter: opts.maxIter || 12, maxProps: 12 });
  if (sol1.converged && !toAuthoredPlane) {
    return { converged: true, theta: sol1.x[0], pitch: 0, yaw: 0, raan: raan0, missKm: sol1.missKm, iters: sol1.iters, propagations: sol1.propagations, dof: 1 };
  }
  // 2-DOF escalation: theta + pitch; second miss component pins the
  // closest-approach TIME to the schematic arrival (seconds -> km at a
  // transfer-speed scale, 0.5 km/s) so the 2x2 Jacobian is full-rank.
  const sol2 = physShootToTarget(
    x => physAimBurnState(fromBody, r1, x[0], x[1], dv_kms, incRad, 0, raan0),
    res => {
      const ca = physClosestApproachKm(res, dest, overrides);
      return [ca.dKm - targetR, ca.t != null ? (ca.t - tArrSched) * 0.5 : 1e9]; // seconds × 0.5 km/s → km scale
    },
    [sol1.x[0], 0], { propagate, tolKm, eps: [1e-3, 1e-3], maxIter: opts.maxIter || 12, maxProps: 16 });
  if (sol2.converged && !toAuthoredPlane) {
    return { converged: true, theta: sol2.x[0], pitch: sol2.x[1] || 0, yaw: 0, raan: raan0, missKm: sol2.missKm,
      iters: sol1.iters + sol2.iters, propagations: sol1.propagations + sol2.propagations, dof: 2 };
  }
  // 3-DOF escalation (R3): theta + pitch + yaw; third miss component is the
  // out-of-plane miss at closest approach (R3) UNLESS the arrival target
  // authored its own plane (R3.2), in which case that component becomes the
  // plane-alignment residual above — same DOF, same slot, different target.
  const sol3 = physShootToTarget(
    x => physAimBurnState(fromBody, r1, x[0], x[1], dv_kms, incRad, x[2], raan0),
    res => {
      const ca = physClosestApproachKm(res, dest, overrides);
      const thirdMiss = toAuthoredPlane ? planeMissKm(res) : (ca.dz || 0);
      return [ca.dKm - targetR, ca.t != null ? (ca.t - tArrSched) * 0.5 : 1e9, thirdMiss];
    },
    [sol2.x[0], sol2.x[1] || 0, 0],
    { propagate, tolKm, eps: [1e-3, 1e-3, 1e-3], maxIter: opts.maxIter || 12, maxProps: 30 });
  // best stage wins (a stalled higher-DOF stage can't undo a better earlier x);
  // converged = within ACCEPTANCE (the solver tolerance is stricter on purpose)
  const stages = [
    { s: sol1, dof: 1, pitch: 0, yaw: 0 },
    { s: sol2, dof: 2, pitch: sol2.x[1] || 0, yaw: 0 },
    { s: sol3, dof: 3, pitch: sol3.x[1] || 0, yaw: sol3.x[2] || 0 },
  ];
  // R3.2: when the arrival plane is authored, only sol3's residual actually
  // CHECKS the plane (its 3rd component is the plane-alignment miss) — a
  // lower-DOF stage that happens to have a small radial/timing miss says
  // nothing about whether the authored plane was reached, so it must not win
  // the "best stage" comparison (that would report converged:true for a leg
  // that silently missed the authored plane).
  const eligible = toAuthoredPlane ? [stages[2]] : stages;
  let bestStage = eligible[0];
  for (const st of eligible) if (st.s.missKm < bestStage.s.missKm) bestStage = st;
  return { converged: bestStage.s.converged || bestStage.s.missKm <= acceptKm,
    theta: bestStage.s.x[0], pitch: bestStage.pitch, yaw: bestStage.yaw, raan: raan0,
    missKm: bestStage.s.missKm, iters: sol1.iters + sol2.iters + sol3.iters,
    propagations: sol1.propagations + sol2.propagations + sol3.propagations, dof: bestStage.dof };
}

// shooter solution cache: re-shoot only when the leg's signature changes —
// cached solves make a warm recompute cost ~one propagation per leg.
const _physShootCache = {};

/**
 * Free-return template solve (authoring aid, NOT re-aiming an accounted burn —
 * here the magnitude IS free because the user is authoring a NEW burn).
 * 2-DOF shoot on x = [burn MET (s), |Δv| (km/s)] from a circular Earth orbit
 * at leoAltKm; the burn anomaly follows the MNODE convention theta = n·MET
 * (mean motion phase), so the solved MET round-trips exactly through the
 * MNODE leg builder. Targets: lunar SOI transit at the seed trajectory's
 * flyby distance AND Earth return perigee inside [30, 500] km (aimed at the
 * seed's own value when already in band). Seeded from the P1 golden (apogee
 * 455,000 km energy; burn angle 4.5379 rad rotated with the Moon's rail).
 * R3: solves from an INCLINED parking orbit (incDeg, default 28.5 — pass the
 * active vehicle's authored inclination; 0 for equatorial). The MNODE
 * builder honors the same inclination + theta = n·MET convention, so the
 * solved MET/Δv round-trips exactly.
 * Returns { converged, met_s, dv_ms, periAlt_km, missKm, iters } or a
 * converged:false record.
 */
function physFreeReturnSolve(leoAltKm, tDepart_s, overrides, incDeg) {
  overrides = overrides || {};
  const incRad = ((incDeg == null ? 28.5 : incDeg) * Math.PI) / 180;
  const muE = PROG_BODIES.Earth.mu, RE_ = PROG_BODIES.Earth.R;
  const rp = RE_ + (leoAltKm || 185);
  const nMean = Math.sqrt(muE / (rp * rp * rp));
  const t0 = tDepart_s || 0;
  const twoPi = 2 * Math.PI;
  const ctx = { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'], overrides };
  const mkState = x => {
    const bs = physAimBurnState('Earth', rp, (x[0] * nMean) % twoPi, 0, x[1], incRad, 0);
    return { r: bs.r, v: bs.v, met: x[0] };
  };
  const propagate = st => physPropagateSegment({ r: st.r, v: st.v }, st.met, st.met + 12 * 86400, ctx, { maxSamples: 128 });
  const measure = res => {
    const soiOut = res.events.find(ev => ev.type === 'soi' && ev.from === 'Moon');
    const moonPeri = res.events.filter(ev => ev.type === 'periapsis' && ev.frame === 'Moon');
    const dMoonKm = moonPeri.length ? Math.min.apply(null, moonPeri.map(ev => ev.rMag))
      : physClosestApproachKm(res, 'Moon', overrides).dKm;
    let periAlt = null;
    if (soiOut) {
      const per = res.events.filter(ev => ev.type === 'periapsis' && ev.frame === 'Earth' && ev.t > soiOut.t);
      if (per.length) periAlt = per[0].rMag - RE_;
      else {
        let best = Infinity;
        res.samples.forEach(s => { if (s.frame === 'Earth' && s.t > soiOut.t) best = Math.min(best, physMag(s.r)); });
        if (isFinite(best)) periAlt = best - RE_;
      }
    }
    return { dMoonKm, periAlt };
  };
  // ── R3 seed selection (2026-07-10): the rotated-golden shortcut alone no
  // longer seeds reliably from an INCLINED parking orbit (the R1 golden apo
  // 445,000 km / phi 4.98 rad is an ecliptic solution; from a 28.5° ring it
  // never re-enters the return band — measured, scratchpad r3_scan.js; the
  // 28.5° grid optimum is apo 435,000 km / phi 5.96 rad → perigee ≈ 48 km).
  // Deterministic candidate scan instead: the rotated R1 golden PLUS a coarse
  // apo × phi grid (2 × 24, fixed order), scored by "return perigee near 200
  // km", falling back to "reached/entered the Moon SOI, closest first".
  const phiToMet = phi => {
    let th = phi % twoPi; if (th < 0) th += twoPi;
    const phase = (((th - nMean * t0) % twoPi) + twoPi) % twoPi;
    return t0 + phase / nMean;
  };
  const dvForApo = apo => { const aS = (rp + apo) / 2; return Math.sqrt(muE * (2 / rp - 1 / aS)) - Math.sqrt(muE / rp); };
  const moonRot = progBodyAngleAt('Moon', t0) - progBodyAngleAt('Moon', 0);
  // apogee candidates track the Moon's REAL geocentric distance at the
  // estimated encounter (~4.7 d out) — the eccentric Moon spans 363k–405k km
  // over the month, so fixed apogees strand the seed at unfavorable phases
  // (measured: t0 = 2 d failed with the fixed 435k/445k pair). The winning
  // t0 = 0 apogees sit ~65k–75k km past the Moon (far-side wraparound).
  const mArr = physBodyStateAt('Moon', t0 + 4.7 * 86400, overrides);
  const eArr = physBodyStateAt('Earth', t0 + 4.7 * 86400, overrides);
  const rMoonArr = physMag(physSub(mArr.r, eArr.r));
  const cands = [[4.98 + moonRot, 445000]];
  for (const apo of [rMoonArr + 60000, rMoonArr + 75000]) {
    for (let k = 0; k < 24; k++) cands.push([k * twoPi / 24 + moonRot, apo]);
  }
  // score: any trajectory that comes BACK (measurable Earth return perigee)
  // beats any that doesn't, ranked by |periAlt − 200 km| — even an out-of-band
  // or sub-surface perigee is a better corrector seed than a tight flyby that
  // never returns (measured: a 46,000 km flyby with an 84,000 km "perigee"
  // strands the 2-DOF Newton; a −1,600 km crash seed converges).
  const scoreOf = mm => (mm.periAlt != null)
    ? Math.abs(mm.periAlt - 200)
    : 1e6 + (isFinite(mm.dMoonKm) ? mm.dMoonKm : 1e9);
  let bestPhi = cands[0][0], bestApo = cands[0][1], bestScore = Infinity;
  for (const [phi, apo] of cands) {
    const mm = measure(propagate(mkState([phiToMet(phi), dvForApo(apo)])));
    const score = scoreOf(mm);
    if (score < bestScore) { bestScore = score; bestPhi = phi; bestApo = apo; }
  }
  // two-level local phi refinement around the grid winner (±1 coarse step at
  // 1/8 steps, then ±1 fine step at 1/64 steps) — the free-return corridor is
  // ~0.01 rad wide in burn anomaly, far narrower than the coarse grid, and a
  // seed stranded half a step out leaves the corrector nothing to damp toward
  const step = twoPi / 24;
  for (const div of [8, 64]) {
    const localStep = step / div, reach = div === 8 ? 7 : 4;
    const centre = bestPhi;
    for (let k = -reach; k <= reach; k++) {
      if (!k) continue;
      const phi = centre + k * localStep;
      const mm = measure(propagate(mkState([phiToMet(phi), dvForApo(bestApo)])));
      const score = scoreOf(mm);
      if (score < bestScore) { bestScore = score; bestPhi = phi; }
    }
  }
  // apogee refinement around the winner (the dv dimension): ±8k/±16k km,
  // re-checking the fine phi neighbours — the corridor is a narrow curve in
  // (phi, apo) and the corrector's damping needs a seed ON it, not beside it
  {
    const cPhi = bestPhi, cApo = bestApo;
    for (const dApo of [-16000, -8000, 8000, 16000]) {
      for (const dPhi of [-step / 64, 0, step / 64]) {
        const mm = measure(propagate(mkState([phiToMet(cPhi + dPhi), dvForApo(cApo + dApo)])));
        const score = scoreOf(mm);
        if (score < bestScore) { bestScore = score; bestPhi = cPhi + dPhi; bestApo = cApo + dApo; }
      }
    }
  }
  const metSeed = phiToMet(bestPhi), dvSeed = dvForApo(bestApo);
  const seedM = measure(propagate(mkState([metSeed, dvSeed])));
  const dTgt = (isFinite(seedM.dMoonKm) && seedM.dMoonKm < physSoiRadius('Moon')) ? seedM.dMoonKm : physSoiRadius('Moon') * 0.15;
  const pTgt = (seedM.periAlt != null && seedM.periAlt >= 30 && seedM.periAlt <= 500) ? seedM.periAlt : 265;
  const sol = physShootToTarget(mkState,
    res => { const mm = measure(res); return [mm.dMoonKm - dTgt, mm.periAlt == null ? 1e9 : mm.periAlt - pTgt]; },
    [metSeed, dvSeed],
    { propagate, tolKm: 100, eps: [1e-3 / nMean, 1e-4], maxIter: 12, maxProps: 40 });
  const finalM = measure(propagate(mkState(sol.x)));
  const inBand = finalM.periAlt != null && finalM.periAlt >= 30 && finalM.periAlt <= 500;
  return { converged: !!(sol.converged && inBand) || inBand, met_s: sol.x[0], dv_ms: sol.x[1] * 1000,
    periAlt_km: finalM.periAlt, missKm: sol.missKm, iters: sol.iters };
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
  for (let i = 0; i < (m.log || []).length; i++) {
    const e = m.log[i];
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
      if (!o || o.transit || o.surface || !PROG_BODIES[o.body]) {
        legs.push({ authIdx: i, met: burnMet, samples: [], events: [], tof_s: 0, tofPhysics: null,
          dvVec: null, frames: [], converged: false, kind: 'mnode',
          note: 'no propagable orbit at burn (transit corridor / surface / unknown body)' });
        continue;
      }
      const mu = PROG_BODIES[o.body].mu;
      const rMean = PROG_BODIES[o.body].R + ((o.perigee ?? o.apogee ?? 0) + (o.apogee ?? o.perigee ?? 0)) / 2;
      const nMean = Math.sqrt(mu / (rMean * rMean * rMean));
      const theta = (nMean * burnMet) % (2 * Math.PI);
      const incMn = ((o.inclination || 0) * Math.PI) / 180;
      // R3.2: if the vehicle's current orbit (orbitAtBurn) authored a plane,
      // the MNODE builder reconstructs the burn frame in THAT plane too —
      // same precedence thread as the departure/arrival cases above.
      const raanMn = o.lan_deg != null ? (o.lan_deg * Math.PI) / 180 : 0;
      const bs = physAimBurnState(o.body, rMean, theta, 0, 0, incMn, 0, raanMn);
      const dvVec = physAdd(physAdd(
        physScale(bs.vHat, (e.dvPro_ms || 0) / 1000),
        physScale(bs.rHat, (e.dvRad_ms || 0) / 1000)),
        physScale(bs.hHat, (e.dvNrm_ms || 0) / 1000));
      const state = { r: bs.r, v: physAdd(bs.v, dvVec) };
      const parent = physParentOf(o.body);
      const bodies = [...new Set([o.body, parent || 'Sun', 'Sun', o.body === 'Earth' ? 'Moon' : null].filter(Boolean))];
      // horizon: 30 days, or 3 post-burn periods when the new orbit stays
      // comfortably inside this body's SOI (shows the settled orbit without
      // integrating 500 LEO revs)
      let horizon = 30 * 86400;
      const el = physStateToElements(state.r, state.v, mu);
      if (el && el.a > 0 && isFinite(el.period) && el.ra < physSoiRadius(o.body) * 0.8)
        horizon = Math.min(horizon, Math.max(3 * el.period, 3600));
      // R3.5.2: escapes get 90 days so the committed heliocentric arc matches
      // what the gizmo's full-fidelity preview showed before commit.
      else if (el && (el.a < 0 || el.ra >= physSoiRadius(o.body) * 0.8)) horizon = 90 * 86400;
      let res = physPropagateSegment(state, burnMet, burnMet + horizon,
        { center: o.body, bodies, overrides: calOverrides }, { maxSamples: 256 });
      // R3.5.3: if the 90-day pass reached heliocentric space, re-propagate
      // once to a full-orbit horizon (physEscapeHorizonS) so the committed
      // arc shows at least one full solar orbit instead of a quarter-orbit.
      const fullHorizon = physEscapeHorizonS(res.samples, horizon);
      if (fullHorizon > horizon) {
        res = physPropagateSegment(state, burnMet, burnMet + fullHorizon,
          { center: o.body, bodies, overrides: calOverrides }, { maxSamples: 512 });
      }
      legs.push({ authIdx: i, met: burnMet, samples: res.samples, events: res.events,
        tof_s: 0, tofPhysics: null, dvVec, frames: [...new Set(res.samples.map(s => s.frame))],
        converged: true, kind: 'mnode', homeFrame: o.body,
        dv_ms: Math.sqrt(Math.pow(e.dvPro_ms || 0, 2) + Math.pow(e.dvRad_ms || 0, 2) + Math.pow(e.dvNrm_ms || 0, 2)) });
      continue;
    }
    if (!_evIsSolvedManeuver(e) || !e.fromNode || !e.toNode) continue;
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

    const burn = physSolveNodeBurn(fromO, toO, met, dv_ms / 1000, calOverrides);
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
      // R6.2' Phase B (step 2): same display-only dv-component mirror as the
      // n-body branch below, for the same-body (analytic Kepler) leg kind.
      if (e.type === 'MNODE' && burn.dvVec && typeof _trajGizmoAxes === 'function' && typeof _trajGizmoDecomposeDv === 'function') {
        const axes = _trajGizmoAxes(burn.state.r, burn.state.v);
        const d = axes ? _trajGizmoDecomposeDv(burn.dvVec, axes) : null;
        if (d) { e.dvPro_ms = d.pro; e.dvRad_ms = d.rad; e.dvNrm_ms = d.nrm; }
      }
      continue;
    }

    // n-body leg (moon / interplanetary): P4 — refine the analytic aim with
    // the differential corrector (burn anomaly ± pitch; |Δv| FIXED), cached
    // by leg signature so a warm recompute costs ~one propagation per leg.
    let st0 = burn.state, dvVec = burn.dvVec;
    const r1 = physMag(burn.state.r);
    const incLeg = (fromO.inclination || 0);
    let raanUsed = 0;
    {
      // R3: signature includes the departure inclination — editing a node's
      // inclination must re-shoot the leg
      const sig = `${e.fromNode}|${e.toNode}|${met.toFixed(0)}|${dv_ms.toFixed(1)}|i${incLeg}`;
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
      }
    }
    const cutoff = met + 1.5 * Math.max(burn.coastTof_s, 3600);
    const res = physPropagateSegment(st0, met, cutoff,
      { center: burn.center, bodies: burn.bodies, overrides: calOverrides,
        dtMax: burn.kind === 'interplanetary' ? 16384 : undefined }, { maxSamples: 256 });
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
      converged, kind: burn.kind, dest: burn.dest, departElements, arrivalElements };
    legs.push(leg);
    lastTransit = leg;
    // R6.2' Phase B (step 2): mirror the solved leg's real dvVec onto the
    // unified MNODE's dv components — DISPLAY ONLY (the gizmo/card handle
    // readout), never the accounting source (that stays dvVec's magnitude
    // via progNmComputeEdgeDv above, e.dvRequired/e.dv_actual). Decomposed
    // against the departure state's local (v̂,r̂,ĥ) basis — same convention
    // 5745's _trajGizmoManeuverSolvedDv already uses for a legacy MANEUVER's
    // handle readout (Phase B doesn't change that convention; the basis fix
    // is a separate later pass per PHYSICS_PLAN R6.2' Phase B note). No-op
    // for a legacy MANEUVER entry (no dv fields to refresh) or if 5745
    // hasn't loaded yet (guarded, never a hard dependency).
    if (e.type === 'MNODE' && dvVec && typeof _trajGizmoAxes === 'function' && typeof _trajGizmoDecomposeDv === 'function') {
      const axes = _trajGizmoAxes(st0.r, st0.v);
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
