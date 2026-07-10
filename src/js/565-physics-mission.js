
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

// ── P4: targeting — generic differential corrector + leg aim ─────────────────
//
// ΔV ACCOUNTING PARITY (sacred): the shooter adjusts WHERE the burn happens
// (anomaly theta on the parking orbit) and its in-plane DIRECTION (pitch off
// prograde) — NEVER the magnitude. |Δv| is always the engine-supplied value.
// If the fixed magnitude cannot reach the target, we return converged:false
// and the renderer keeps the schematic arc (MATH.md §7g).

/** Burn state on a circular parking ring: position at anomaly `theta`
 *  (radius r1, km), velocity = circular + dv_kms along a unit vector pitched
 *  `pitch` rad off prograde toward radial-out (in-plane; normal is a P5/3D
 *  concern). Pure. Returns {r, v, dvVec}. */
function physAimBurnState(fromBody, r1, theta, pitch, dv_kms) {
  const mu = PROG_BODIES[fromBody].mu;
  const pro = [-Math.sin(theta), Math.cos(theta), 0];
  const radOut = [Math.cos(theta), Math.sin(theta), 0];
  const p = pitch || 0;
  const dvDir = physAdd(physScale(pro, Math.cos(p)), physScale(radOut, Math.sin(p)));
  const dvVec = physScale(dvDir, dv_kms);
  return { r: physScale(radOut, r1), v: physAdd(physScale(pro, Math.sqrt(mu / r1)), dvVec), dvVec };
}

/** Closest approach of a propagation result to body `dest`: exact periapsis
 *  events in the dest frame win; otherwise the (decimated) sample minimum.
 *  Returns {dKm, t}. Body positions via physBodyStateAt with the caller's
 *  calibration overrides (one position source). */
function physClosestApproachKm(res, dest, overrides) {
  let best = Infinity, tBest = null;
  (res.events || []).forEach(ev => {
    if (ev.type === 'periapsis' && ev.frame === dest && ev.rMag < best) { best = ev.rMag; tBest = ev.t; }
  });
  (res.samples || []).forEach(s => {
    let d;
    if (s.frame === dest) d = physMag(s.r);
    else {
      const fHelio = s.frame === 'Sun' ? [0, 0, 0] : physBodyStateAt(s.frame, s.t, overrides).r;
      d = physMag(physSub(physAdd(s.r, fHelio), physBodyStateAt(dest, s.t, overrides).r));
    }
    if (d < best) { best = d; tBest = s.t; }
  });
  return { dKm: best, t: tBest };
}

/**
 * Generic n-DOF (n = 1 or 2) differential corrector.
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
    } else {
      const det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
      if (!isFinite(det) || Math.abs(det) < 1e-15) return { converged: false, x, missKm: norm(miss), iters: it, propagations: props };
      dx = [
        (-miss[0] * J[1][1] + miss[1] * J[1][0]) / det,
        (miss[0] * J[0][1] - miss[1] * J[0][0]) / det,
      ];
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
 * Aim an existing node MANEUVER's injection burn with the corrector: 1-DOF on
 * the burn anomaly theta first (cheap, usually enough for moon legs), then
 * escalating to 2-DOF (theta + pitch) if 1-DOF stalls. Target: closest
 * approach to the destination body equals the destination-orbit radius
 * (targetRadiusKm); the 2-DOF variant adds an arrival-timing component
 * (closest-approach time vs. the schematic TOF, scaled to km — see MATH.md
 * §7g) so the Jacobian is full-rank. |Δv| = dv_kms, FIXED throughout.
 * Returns { converged, theta, pitch, missKm, iters, propagations, dof } or
 * null (no n-body leg model for this pair).
 */
function physShootLegAim(fromOrbit, toOrbit, tDepart_s, dv_kms, overrides, opts) {
  overrides = overrides || {}; opts = opts || {};
  const burn0 = physSolveNodeBurn(fromOrbit, toOrbit, tDepart_s, dv_kms, overrides);
  if (!burn0 || (burn0.kind !== 'moon' && burn0.kind !== 'interplanetary')) return null;
  const dest = burn0.dest, fromBody = burn0.center;
  const r1 = physMag(burn0.state.r);
  let theta0 = Math.atan2(burn0.state.r[1], burn0.state.r[0]);
  if (theta0 < 0) theta0 += 2 * Math.PI;
  const soi = physSoiRadius(dest);
  const targetR = PROG_BODIES[dest].R + (opts.destAltKm != null ? opts.destAltKm : 100);
  // R1: the burn is still in the ecliptic plane (z = 0) while real targets are
  // INCLINED (Moon 5.15°, Mars 1.85°) — the closest approach can't go below
  // the target's out-of-plane offset at encounter (up to sin(i)·r ≈ 34,000 km
  // for the Moon). Tolerance = SOI/3 accepts the best a coplanar burn can do;
  // R3's normal-direction DOF tightens this again.
  const tolKm = soi / 3;
  const cutoff = tDepart_s + 1.5 * Math.max(burn0.coastTof_s, 3600);
  // heliocentric cruise: cap the step ladder so the encounter can't be
  // stepped over (see physStepFor ctx.dtMax) — fixed constant, deterministic
  const ctx = { center: fromBody, bodies: burn0.bodies, overrides,
    dtMax: burn0.kind === 'interplanetary' ? 16384 : undefined };
  const propagate = st => physPropagateSegment({ r: st.r, v: st.v }, tDepart_s, cutoff, ctx, { maxSamples: 128 });
  const tArrSched = tDepart_s + burn0.coastTof_s;
  // 1-DOF: burn anomaly only
  const sol1 = physShootToTarget(
    x => physAimBurnState(fromBody, r1, x[0], 0, dv_kms),
    res => [physClosestApproachKm(res, dest, overrides).dKm - targetR],
    [theta0], { propagate, tolKm, eps: [1e-3], maxIter: opts.maxIter || 12, maxProps: 26 });
  if (sol1.converged) {
    return { converged: true, theta: sol1.x[0], pitch: 0, missKm: sol1.missKm, iters: sol1.iters, propagations: sol1.propagations, dof: 1 };
  }
  // 2-DOF escalation: theta + pitch; second miss component pins the
  // closest-approach TIME to the schematic arrival (seconds -> km at a
  // transfer-speed scale, 0.5 km/s) so the 2x2 Jacobian is full-rank.
  const sol2 = physShootToTarget(
    x => physAimBurnState(fromBody, r1, x[0], x[1], dv_kms),
    res => {
      const ca = physClosestApproachKm(res, dest, overrides);
      return [ca.dKm - targetR, ca.t != null ? (ca.t - tArrSched) * 0.5 : 1e9]; // seconds × 0.5 km/s → km scale
    },
    [sol1.x[0], 0], { propagate, tolKm: Math.max(tolKm, soi / 3), eps: [1e-3, 1e-3], maxIter: opts.maxIter || 12, maxProps: 40 });
  return { converged: sol2.converged, theta: sol2.x[0], pitch: sol2.x[1] || 0,
    missKm: sol2.missKm, iters: sol1.iters + sol2.iters, propagations: sol1.propagations + sol2.propagations, dof: 2 };
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
 * Returns { converged, met_s, dv_ms, periAlt_km, missKm, iters } or a
 * converged:false record.
 */
function physFreeReturnSolve(leoAltKm, tDepart_s, overrides) {
  overrides = overrides || {};
  const muE = PROG_BODIES.Earth.mu, RE_ = PROG_BODIES.Earth.R;
  const rp = RE_ + (leoAltKm || 185);
  const nMean = Math.sqrt(muE / (rp * rp * rp));
  const t0 = tDepart_s || 0;
  // seed energy + burn angle from the R1 golden, re-scanned against the REAL
  // (eccentric, 5.145°-inclined) Moon on 2026-07-09: apogee 445,000 km, burn
  // angle 4.98 rad at t=0/default epoch, return perigee ≈ 201 km. (Old
  // circular-rail P1 golden was apo 455,000 km / 4.5379 rad / ~62 km.)
  // Rotated with the Moon's in-plane ephemeris angle at departure.
  const aSeed = (rp + 445000) / 2;
  const dvSeed = Math.sqrt(muE * (2 / rp - 1 / aSeed)) - Math.sqrt(muE / rp);
  const twoPi = 2 * Math.PI;
  let thetaSeed = (4.98 + (progBodyAngleAt('Moon', t0) - progBodyAngleAt('Moon', 0))) % twoPi;
  if (thetaSeed < 0) thetaSeed += twoPi;
  const phase = (((thetaSeed - nMean * t0) % twoPi) + twoPi) % twoPi;
  const metSeed = t0 + phase / nMean;
  const ctx = { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'], overrides };
  const mkState = x => {
    const bs = physAimBurnState('Earth', rp, (x[0] * nMean) % twoPi, 0, x[1]);
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
  const destAltFor = (dest, fromIdx) => {
    for (let j = fromIdx + 1; j < (m.log || []).length; j++) {
      const ev = m.log[j];
      if (ev.type !== 'MANEUVER' || !ev.toNode) continue;
      const tn = _missionNmNodeById(ev.toNode);
      const o = tn && tn.orbit;
      if (o && o.body === dest && (o.type === 'circular' || o.type === 'elliptic'))
        return ((o.perigee ?? o.apogee ?? 100) + (o.apogee ?? o.perigee ?? 100)) / 2;
    }
    return 100;
  };
  for (let i = 0; i < (m.log || []).length; i++) {
    const e = m.log[i];
    // ── P4: MNODE — a vector burn propagated from the vehicle's node-map
    // orbit at its MET (orbitAtBurn cached by 570's replay). The burn point
    // sits at anomaly theta = n·MET on the mean-altitude circular ring (mean
    // motion phase — same convention physFreeReturnSolve solves in); Δv is
    // applied in the orbit's local frame: prograde + radial-out (normal is a
    // no-op until the P5 3D world — documented in MATH.md §7g).
    if (e.type === 'MNODE') {
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
      const bs = physAimBurnState(o.body, rMean, theta, 0, 0);
      const pro = [-Math.sin(theta), Math.cos(theta), 0], radOut = [Math.cos(theta), Math.sin(theta), 0];
      const dvVec = physAdd(physScale(pro, (e.dvPro_ms || 0) / 1000), physScale(radOut, (e.dvRad_ms || 0) / 1000));
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
      const res = physPropagateSegment(state, burnMet, burnMet + horizon,
        { center: o.body, bodies, overrides: calOverrides }, { maxSamples: 256 });
      legs.push({ authIdx: i, met: burnMet, samples: res.samples, events: res.events,
        tof_s: 0, tofPhysics: null, dvVec, frames: [...new Set(res.samples.map(s => s.frame))],
        converged: true, kind: 'mnode', homeFrame: o.body,
        dv_ms: Math.sqrt(Math.pow(e.dvPro_ms || 0, 2) + Math.pow(e.dvRad_ms || 0, 2) + Math.pow(e.dvNrm_ms || 0, 2)) });
      continue;
    }
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
      continue;
    }

    // n-body leg (moon / interplanetary): P4 — refine the analytic aim with
    // the differential corrector (burn anomaly ± pitch; |Δv| FIXED), cached
    // by leg signature so a warm recompute costs ~one propagation per leg.
    let st0 = burn.state, dvVec = burn.dvVec;
    {
      const sig = `${e.fromNode}|${e.toNode}|${met.toFixed(0)}|${dv_ms.toFixed(1)}`;
      let aim = _physShootCache[sig];
      if (!aim) {
        let sol = null;
        try { sol = physShootLegAim(fromO, toO, met, dv_ms / 1000, calOverrides, { destAltKm: destAltFor(burn.dest, i) }); }
        catch (err) { sol = null; }
        aim = sol ? { theta: sol.theta, pitch: sol.pitch, shot: sol.converged, missKm: sol.missKm, iters: sol.iters }
                  : { shot: false };
        _physShootCache[sig] = aim;
      }
      if (aim.theta != null) {
        // even an unconverged shoot's best x beats the raw analytic seed
        const bs = physAimBurnState(burn.center, physMag(burn.state.r), aim.theta, aim.pitch || 0, dv_ms / 1000);
        st0 = { r: bs.r, v: bs.v }; dvVec = bs.dvVec;
      }
    }
    const cutoff = met + 1.5 * Math.max(burn.coastTof_s, 3600);
    const res = physPropagateSegment(st0, met, cutoff,
      { center: burn.center, bodies: burn.bodies, overrides: calOverrides,
        dtMax: burn.kind === 'interplanetary' ? 16384 : undefined }, { maxSamples: 256 });
    const converged = res.events.some(ev => ev.type === 'soi' && ev.to === burn.dest);
    const leg = { authIdx: i, fromNode: e.fromNode, toNode: e.toNode, met,
      samples: res.samples, events: res.events, tof_s: burn.coastTof_s,
      tofPhysics: null,   // injection is impulsive under the corridor rule — no coast of its own
      dvVec, frames: [...new Set(res.samples.map(s => s.frame))],
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
