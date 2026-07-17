// ─────────────────────────────────────────────────────────────────────────────
// 565-physics-targeting.js — P4 generic differential corrector + leg-aim shooter
//
// OWNS: the burn-state aim builder (physAimBurnState), closest-approach / arrival
//   state + osculating elements evaluation (physClosestApproachKm, physArrivalStateAt,
//   physArrivalOsculatingElements), the generic differential-corrector shooter
//   (physShootToTarget) and the leg-aim solver that drives it (physShootLegAim), plus
//   the per-leg shooter-solution cache (_physShootCache).
// CONTRACT (unchanged): physShootLegAim is a CLAUDE.md invariant (solved-RAAN shooter);
//   solved-burn MAGNITUDE still flows through progNmComputeEdgeDv/dvOverride, never
//   recomputed here. No numbers/tolerances/iteration limits were altered by the split.
// Does NOT own: the LEO->NRHO transfer (565-physics-nrho.js), solved node burn / mission
//   rebuild / side-tables (residual 565-physics-mission.js), or the integrator (386).
// Split out of 565-physics-mission.js (behavior-preserving move). Definitions/decls
//   only (no load-time execution); load order among the 565* def-only modules is
//   irrelevant (this file loads after the 565 core and before 566).
// ─────────────────────────────────────────────────────────────────────────────
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
  // R6.2' Phase B step 5: expose the PRE-burn velocity too (st.v, before dv
  // added) so callers can stamp the exact departure state the dv vector was
  // applied to — the basis-fix fields (leg.burnState / e.burnState) below.
  return { r: st.r, v: physAdd(st.v, dvVec), vPre: st.v, dvVec, rHat, vHat, hHat };
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

/** R3.1 / MISSION_MODEL_V2 Phase 2 S2: raw arrival {r,v,t} of a converged leg's
 *  actual encounter, for BOTH the state-derived ring orientation
 *  (physArrivalOsculatingElements, below) and the F1 arrival-burn construction
 *  (physRebuildMissionTrajectories' 'arrival' leg branch). The propagator only
 *  records POSITION samples (no velocity) plus periapsis events (rMag + t, no
 *  vector) — so the arrival velocity is reconstructed by a central finite
 *  difference of the two dest-frame samples bracketing the arrival periapsis
 *  event's time, and the arrival radius vector is that same bracket's linear
 *  position interpolation rescaled onto the event's exact rMag. This is an
 *  approximation (decimated samples, not a re-integration) — good enough for
 *  RING ORIENTATION and for sizing an arrival Δv, NOT precise enough for a
 *  targeting residual. Deterministic given fixed samples/events.
 *  Returns {r, v, t} or null if no periapsis event was recorded in `dest`'s
 *  frame (or fewer than 2 dest-frame samples exist to bracket it). */
function physArrivalStateAt(res, dest) {
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
  return { r, v, t: ev.t };
}

/** R3.1: osculating plane of a converged leg's actual arrival, for the
 *  STATE-DERIVED orbit ring (MATH.md §7f-R2/§7h/§7i). This phase only
 *  consumes (i, raan, argp) — NOT precise enough for a targeting residual.
 *  Returns osculating {a,e,i,raan,argp,nu,hVec} (physStateToElements' full
 *  return) or null if physArrivalStateAt found nothing to bracket. */
function physArrivalOsculatingElements(res, dest, mu) {
  const st = physArrivalStateAt(res, dest);
  if (!st) return null;
  return physStateToElements(st.r, st.v, mu);
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
  // §20 OBLIQUITY seam: fromOrbit.inclination/.lan_deg are AUTHORED in
  // fromBody's EQUATOR frame (user convention unchanged). incRad stays
  // equatorial for the whole function (it's the ring's inclination
  // MAGNITUDE, frame-invariant under a pure re-basing, and the RAAN-solve
  // cone-axis equation just below is deliberately done IN the equatorial
  // basis to match it). Only at the point a ring is actually turned into a
  // world-frame state (physAimBurnState -> physElementsToState) does the
  // equatorial (inc, raan) pair get rotated into world/ecliptic via
  // progEqToWorldElements — see aimBurnEq below. This is the ONE seam
  // application for this function; MATH.md §7al lists it in the audit.
  const incRad = ((fromOrbit.inclination || 0) * Math.PI) / 180;
  const _eqBasis = (typeof physEqBasis === 'function') ? physEqBasis(fromBody) : { xEq: [1, 0, 0], yEq: [0, 1, 0], zEq: [0, 0, 1] };
  function toWorldPlane(iEqRad, raanEqRad) {
    if (typeof orbitWorldElements !== 'function') return { inc: iEqRad, raan: raanEqRad };
    const w = orbitWorldElements({ body: fromBody, inc_deg: iEqRad * 180 / Math.PI, lan_deg: raanEqRad * 180 / Math.PI });
    return { inc: w.incDeg * Math.PI / 180, raan: w.lanDeg * Math.PI / 180 };
  }
  function aimBurnEq(bodyName, r1v, theta, pitch, dvv, iEqRad, yaw, raanEqRad) {
    const w = toWorldPlane(iEqRad, raanEqRad);
    return physAimBurnState(bodyName, r1v, theta, pitch, dvv, w.inc, yaw, w.raan);
  }
  // in-plane anomaly of the analytic seed (physSolveNodeBurn placed it at ν=theta)
  let theta0 = physPhaseBurnAngle(progBodyAngleAt(dest, tDepart_s + burn0.coastTof_s));
  // N1: encounter length scale — explicit km constant (numerically the old
  // physSoiRadius(dest); see PHYS_ENCOUNTER_SCALE_KM). Pure acceptance/
  // conditioning scale, not a dynamical boundary.
  const soi = PHYS_ENCOUNTER_SCALE_KM[dest];
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
      const mHatWorld = physScale(mSt.r, 1 / mMag);
      // §20: this cone-axis equation (n·m̂=0) assumes m̂'s components are
      // already in the frame whose z-axis is the ring's inclination cone
      // axis. incRad is EQUATORIAL, so m̂ must be rotated into the equatorial
      // basis here too (not left in world/ecliptic) — otherwise the solved
      // raan0 would target a cone around world-z instead of fromBody's pole,
      // which is exactly the pre-§20 bug for this solver.
      const mHat = [physDot(mHatWorld, _eqBasis.xEq), physDot(mHatWorld, _eqBasis.yEq), physDot(mHatWorld, _eqBasis.zEq)];
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
        const st = aimBurnEq(fromBody, r1, th, 0, dv_kms, incRad, 0, rn);
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
  // §20: toOrbit.inclination/.lan_deg are authored in `dest`'s equator frame
  // (same convention as fromOrbit) — rotate into world before comparing
  // against the world-frame osculating arrival elements below.
  const toAuthoredPlane = (toOrbit.lan_deg != null && toOrbit.inclination != null)
    ? (() => {
        const w = (typeof orbitWorldElements === 'function')
          ? orbitWorldElements({ body: dest, inclination: toOrbit.inclination, lan_deg: toOrbit.lan_deg, frame: toOrbit.frame })
          : { incDeg: toOrbit.inclination, lanDeg: toOrbit.lan_deg };
        return { i: (w.incDeg * Math.PI) / 180, raan: (w.lanDeg * Math.PI) / 180 };
      })()
    : null;
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
    x => aimBurnEq(fromBody, r1, x[0], 0, dv_kms, incRad, 0, raan0),
    res => [physClosestApproachKm(res, dest, overrides).dKm - targetR],
    [theta0], { propagate, tolKm, eps: [1e-3], maxIter: opts.maxIter || 12, maxProps: 12 });
  if (sol1.converged && !toAuthoredPlane) {
    return { converged: true, theta: sol1.x[0], pitch: 0, yaw: 0, raan: raan0, missKm: sol1.missKm, iters: sol1.iters, propagations: sol1.propagations, dof: 1 };
  }
  // 2-DOF escalation: theta + pitch; second miss component pins the
  // closest-approach TIME to the schematic arrival (seconds -> km at a
  // transfer-speed scale, 0.5 km/s) so the 2x2 Jacobian is full-rank.
  const sol2 = physShootToTarget(
    x => aimBurnEq(fromBody, r1, x[0], x[1], dv_kms, incRad, 0, raan0),
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
    x => aimBurnEq(fromBody, r1, x[0], x[1], dv_kms, incRad, x[2], raan0),
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
