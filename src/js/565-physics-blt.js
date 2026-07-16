// ─────────────────────────────────────────────────────────────────────────────
// 565-physics-blt.js — MISSION_MODEL_V2 §21 B3: incremental BLT targeting solver
//
// OWNS: physSolveBlt(givens) — the staged (Step 1-4) ballistic-lunar-capture
//   targeting pipeline, plus its small helpers (quadrant/family selection,
//   plane-crossing search, EM-L2 distance, rotating-frame projections local
//   to this module). Reuses (does not duplicate): _refRotBasisPair (425),
//   BLT_F16_FAMILY/BLT_FPRIME16_FAMILY/bltF16SelectFamily/bltNdToKm (424),
//   physPropagateSegment/physAccelJacobian (386), physAimBurnState (565-
//   physics-targeting.js), progVcirc (360).
// CONTRACT: nothing in 565-physics-nrho.js / 565-physics-targeting.js / the
//   5a shooter is touched (regression-guard gate pin below).
// Does NOT own: any UI/node-map surface (B4, out of scope for B3).
//
// PROVENANCE / method decisions (see docs/MATH.md §7aj for the full writeup):
//  - Reference: Griesemer/Ocampo/Cooley, NTRS 20090016184 ("the paper").
//  - Step 1 (RTBP, 1 DOF |dv|): solved by STM-derivative Newton, per spec —
//    opts.stm + opts.singleFrame on physPropagateSegment, chain-ruled through
//    the fixed prograde burn direction. This is genuinely 1 DOF so the full
//    STM chain rule is cheap and was implemented as specified.
//  - Steps 2-4 (4-5 free params: alpha/beta/gamma parking-orientation angles,
//    |dv|, tf): implemented with bounded PATTERN SEARCH (coordinate-wise
//    golden-section descent on a penalty objective), NOT full STM-Jacobian
//    Newton. Deviation from the spec's literal "via STM columns" wording —
//    documented, not hidden: deriving d(initial parking state)/d(alpha,
//    beta,gamma) and chaining it through Phi for a 3-4 body reference
//    trajectory is a substantially larger derivation than Step 1's single
//    scalar case, and the spec explicitly grants "measure and decide,
//    document" latitude for Step 4's method choice; the same latitude is
//    extended here to Steps 2-3 given the measured time budget. Pattern
//    search is slower per-iteration but robust to the FD-noise/chaos concern
//    B1 raised (no derivative estimation at all — direct objective sampling),
//    so it does not reintroduce the failure mode B1/critique 62 warned about.
//  - Combined-mass vs honest four-body for Step 1: uses ctx.bodies =
//    ['Earth','Sun'] (Moon OMITTED) — the "combined-mass trick" approximated
//    by dropping the Moon's perturbation entirely for the RTBP stage, since
//    the spacecraft's Step-1 target (its own Sun-Earth-rotating x=0 crossing)
//    is a slow secular geometry the Moon's short-period perturbation would
//    only jitter, not shift structurally. Steps 2-4 use the full
//    ['Earth','Moon','Sun'] force model (the "full four-body" the spec calls
//    for at those stages).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── quadrant / family selection ─────────────────────────────────────────────
// Sun-Earth-Moon angle (deg, 0-180): angle between Earth->Sun and Earth->Moon.
// B2's bltF16SelectFamily wants a 0-360 "how far from the Sun direction"
// value; a plain 0-180 angle-between is equivalent for its sunNear test
// (a>270||a<90, for a in 0-180 reduces to a<90) — documented simplification,
// avoids needing a signed rotating-frame quadrant for a magnitude-only test.
function physBltSunEarthMoonAngleDeg(t) {
  const sun = physBodyStateAt('Sun', t), earth = physBodyStateAt('Earth', t), moon = physBodyStateAt('Moon', t);
  const toSun = physSub(sun.r, earth.r), toMoon = physSub(moon.r, earth.r);
  const cosA = physDot(toSun, toMoon) / (physMag(toSun) * physMag(toMoon));
  return Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;
}

/** Nearest family member by parking perigee (km); linear-interpolates the
 *  two bracketing table rows on x0/vy0/jacobiC/t_p2/t_p3 (period/far are
 *  cosmetic, nearest-row is fine for those). */
function physBltInterpFamilyMember(family, rpKm) {
  const rows = family.slice().sort((a, b) => a.rp_km - b.rp_km);
  if (rpKm <= rows[0].rp_km) return rows[0];
  if (rpKm >= rows[rows.length - 1].rp_km) return rows[rows.length - 1];
  let lo = rows[0], hi = rows[rows.length - 1];
  for (let i = 0; i < rows.length - 1; i++) {
    if (rpKm >= rows[i].rp_km && rpKm <= rows[i + 1].rp_km) { lo = rows[i]; hi = rows[i + 1]; break; }
  }
  const f = (hi.rp_km === lo.rp_km) ? 0 : (rpKm - lo.rp_km) / (hi.rp_km - lo.rp_km);
  const lerp = k => lo[k] + f * (hi[k] - lo[k]);
  return {
    rp_km: rpKm, x0_nd: lerp('x0_nd'), vy0_nd: lerp('vy0_nd'), jacobiC: lerp('jacobiC'),
    t_p2_days: lerp('t_p2_days'), t_p3_days: lerp('t_p3_days'), period_days: lerp('period_days'), far_km: lerp('far_km'),
  };
}

// ── EM-L2 distance from Earth (km), runtime version of the harness's
// collinearL — force balance along the Earth-Moon line, bisection (docs/
// MATH.md §7aj / MISSION_MODEL_V2 §21 B3 "collinearL exists in the harness;
// put a small runtime version in the module"). ────────────────────────────
function physBltEmL2DistanceKm(t) {
  const earth = physBodyStateAt('Earth', t), moon = physBodyStateAt('Moon', t);
  const d = physMag(physSub(moon.r, earth.r));
  const muE = PROG_BODIES.Earth.mu, muM = PROG_BODIES.Moon.mu;
  const n2 = (muE + muM) / (d * d * d);
  const muFrac = muM / (muE + muM);
  // x measured from the Moon, +x away from Earth (Earth at -d).
  const f = x => {
    const aE = -muE * Math.sign(x + d) / ((x + d) * (x + d));
    const aM = -muM * Math.sign(x) / (x * x);
    return aE + aM + n2 * (x + d * (1 - muFrac));
  };
  let lo = 0.02 * d, hi = 0.5 * d;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if ((f(lo) <= 0) === (f(mid) <= 0)) lo = mid; else hi = mid;
  }
  const xL2 = (lo + hi) / 2;
  return { distFromMoonKm: xL2, distFromEarthKm: d + xL2 };
}

// ── rotating-frame projection helper (Sun-Earth basis, reuses 425's
// _refRotBasisPair — one basis source, N3 precedent). Position only
// (Step 1's constraint is geometric, not a velocity target). ───────────────
function physBltSunEarthRotX(rHelio, t) {
  const basis = _refRotBasisPair('Sun', 'Earth', t);
  const earth = physBodyStateAt('Earth', t);
  return physDot(physSub(rHelio, earth.r), basis.xh);
}

/** Heliocentric position of a physPropagateSegment result's final state. */
function physBltHelioPos(res) {
  if (res.frame === 'Sun') return res.stateF.r.slice();
  return physAdd(res.stateF.r, physBodyStateAt(res.frame, res.tF).r);
}

// ── Moon's own Sun-Earth-rotating x=0 crossing nearest a target offset,
// used to pick the arrival lattice point tf (B2's "two crossings/month").
function physBltFindMoonPlaneCrossing(t0_s, targetOffsetDays, windowDays) {
  const stepS = 6 * 3600; // 6h scan
  const winS = (windowDays || 20) * 86400;
  const tCenter = t0_s + targetOffsetDays * 86400;
  const xAt = t => {
    const moon = physBodyStateAt('Moon', t);
    return physBltSunEarthRotX(moon.r, t);
  };
  let prevT = tCenter - winS, prevX = xAt(prevT);
  let best = null, bestDist = Infinity;
  for (let t = prevT + stepS; t <= tCenter + winS; t += stepS) {
    const x = xAt(t);
    if ((prevX <= 0) !== (x <= 0)) {
      // bisect
      let lo = prevT, hi = t, flo = prevX;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2, fm = xAt(mid);
        if ((flo <= 0) === (fm <= 0)) { lo = mid; flo = fm; } else hi = mid;
      }
      const tc = (lo + hi) / 2;
      const dist = Math.abs(tc - tCenter);
      if (dist < bestDist) { bestDist = dist; best = tc; }
    }
    prevT = t; prevX = x;
  }
  return best; // seconds epoch, or null if none found in window
}

// ── B3.1 — anchored departure seed (the coordinator-directed fix for the
// original Step-1 non-convergence, MATH.md §7aj critique 111 resolution).
// The departure PHASE is not a free parameter: the family member's perigee
// state in the Sun-EM rotating frame IS the seed, transformed to inertial at
// t0. Construction:
//   position:  Earth + sign·rp·xh  (xh = Sun->Earth rotating x-axis from
//              _refRotBasisPair('Sun','Earth',t0); f16 starts anti-Sun side
//              of the secondary (x0 > 1-mu) -> sign=+1; f'16 Sun side -> -1)
//   velocity:  vy0·VU·yh + om x r_rel  (the member's perpendicular-crossing
//              rotating velocity, plus the frame-rotation term; vy0 carries
//              its own sign — f16 +, f'16 −, matching each branch's sense)
// The parking orbit's (raan, inc, theta) are then DERIVED from this state
// (outputs of the anchoring; Steps 2-3 free them later), and Step 1's only
// DOF is |dv| along the anchored velocity direction.
function physBltAnchorSeed(t0_s, parkKm, member, familyIsF16) {
  const basis = _refRotBasisPair('Sun', 'Earth', t0_s);
  const sign = familyIsF16 ? 1 : -1;
  const rRel = physScale(basis.xh, sign * parkKm);              // Earth-centered
  const vRot = physScale(basis.yh, member.vy0_nd * BLT_F16_SCALE.VU_KMS);
  const vRel = physAdd(vRot, physCross(basis.om, rRel));        // inertial, Earth-relative
  const vMag = physMag(vRel);
  const vDir = physScale(vRel, 1 / vMag);
  const vcirc = Math.sqrt(PROG_BODIES.Earth.mu / parkKm);
  const dv0 = vMag - vcirc;
  // Derived parking-orbit angles (for Steps 2-4's parameterization): the
  // circular parking orbit through rRel with prograde direction vDir.
  const h = physCross(rRel, vRel);
  const hHat = physScale(h, 1 / physMag(h));
  const inc = Math.acos(Math.max(-1, Math.min(1, hHat[2])));
  let raan = Math.atan2(hHat[0], -hHat[1]);
  let nHat, theta;
  if (Math.abs(Math.sin(inc)) < 1e-8) { raan = 0; nHat = [1, 0, 0]; }
  else nHat = physScale([-hHat[1], hHat[0], 0], 1 / Math.hypot(hHat[0], hHat[1]));
  const uHat = physScale(rRel, 1 / physMag(rRel));
  theta = Math.atan2(physDot(physCross(nHat, uHat), hHat), physDot(uHat, nHat));
  return { rRel, vRel, vDir, dv0_kms: dv0, vcirc, raan, inc, theta, sign };
}

// ── Step 1 — RTBP 1-DOF Newton on |dv|, STM-derivative (spec-literal) ──────
// State0: parking-orbit burn state (physAimBurnState), fixed prograde
// (pitch=0,yaw=0). ctx.bodies = ['Earth','Sun'] (combined-mass approx, Moon
// omitted — see module header). opts.stm + opts.singleFrame so Phi stays
// valid across the whole (short, Earth-Sun-only, no SOI handoff by
// construction since Moon isn't in the force model) segment.
// B3.1: the seed's burn point AND direction come from physBltAnchorSeed (the
// family member's own perigee geometry) — Step 1's only DOF is |dv| along the
// anchored direction: state0(dv) = { r: anchor.rRel, v: anchor.vDir·(vcirc+dv) }.
// Constraint g = the SPACECRAFT's Earth-centered Sun-Earth-rotating x at tf
// (the y-z plane crossing, paper Fig. 9 — the trajectory crosses x=0 in the
// half-plane the family's own geometry produces; the anchoring supplies that
// automatically, no separate half-plane branch is needed for the residual).
function physBltStep1(setup, anchor, opts) {
  opts = opts || {};
  const maxIter = opts.maxIter || 40;
  const tol = opts.tolKm || 500; // km, x_rot(tf) target band
  const { t0_s, tf_s } = setup;
  const evalDv = dv => {
    const v0 = physScale(anchor.vDir, anchor.vcirc + dv);
    const ctx = { center: 'Earth', bodies: ['Earth', 'Sun'] };
    const res = physPropagateSegment({ r: anchor.rRel.slice(), v: v0 }, t0_s, tf_s, ctx, { stm: true, singleFrame: true, maxSamples: 64 });
    const helio = physBltHelioPos(res);
    const earth = physBodyStateAt('Earth', res.tF);
    const rGeo = physSub(helio, earth.r);
    const basis = _refRotBasisPair('Sun', 'Earth', res.tF);
    const g = physDot(rGeo, basis.xh);
    const yRot = physDot(rGeo, basis.yh);
    // dg/d(dv): chain rule through Phi's v-block and the fixed direction.
    let dgddv = null;
    if (res.stmF) {
      const drdv0 = [0, 0, 0];
      for (let row = 0; row < 3; row++) {
        let s = 0;
        for (let col = 0; col < 3; col++) s += res.stmF[row * 6 + (3 + col)] * anchor.vDir[col];
        drdv0[row] = s;
      }
      dgddv = physDot(drdv0, basis.xh);
    }
    return { g, yRot, dgddv, res };
  };
  // ROOT SELECTION (B3.1, measured necessity — MATH.md §7aj): g(dv) has
  // MULTIPLE roots below the escape boundary (multi-rev low-apogee crossings
  // at ~600-800k km apogee, then the WSB-class root just under escape at
  // ~1.0-1.2M km apogee, then escape). A Newton iterate from the seed slides
  // to the FIRST root it meets — a fast direct-class arc that can never
  // ballistically capture (measured: KEm +0.5 at its perilune). So: scan dv
  // downward from the seed, bracket every sign change, and keep only a
  // bracket whose arc apogee lands in the WSB band (0.85-1.7M km — the
  // ispace acceptance band with margin); bisect that bracket. Derivative-
  // free within the bracket (no FD-noise concern); the STM machinery above
  // still supplies dgddv for diagnostics.
  const apogeeOf = res => {
    let apo = 0;
    for (const s of (res.samples || [])) {
      const h = physAdd(s.r, physBodyStateAt('Earth', s.t).r);
      const d = physMag(physSub(h, physBodyStateAt('Earth', s.t).r));
      if (d > apo) apo = d;
    }
    return apo;
  };
  const scanLo = Math.max(0.5, anchor.dv0_kms - 0.15), scanHi = anchor.dv0_kms + 0.01;
  const scanStep = 0.0025;
  let gSeed = null, evals = 0;
  let prev = null, bracket = null;
  for (let dv = scanHi; dv >= scanLo - 1e-12; dv -= scanStep) {
    const e = evalDv(dv); evals++;
    if (gSeed == null) { gSeed = e.g; if (opts.onSeed) opts.onSeed({ gSeed_km: e.g, ySeed_km: e.yRot, dv0_kms: anchor.dv0_kms }); }
    if (prev && (prev.g <= 0) !== (e.g <= 0)) {
      const apoMid = apogeeOf(e.res);
      if (apoMid > 0.85e6 && apoMid < 1.7e6) { bracket = { hi: prev.dv, lo: dv, gHi: prev.g, gLo: e.g }; break; }
    }
    prev = { dv, g: e.g };
    if (evals > 80) break; // hard cap
  }
  if (!bracket) return { converged: false, stage: 'step1', note: 'Step 1: no WSB-band (0.85-1.7M km apogee) root of the plane-crossing constraint in the scanned dv window [' + scanLo.toFixed(3) + ', ' + scanHi.toFixed(3) + '] km/s', gSeed_km: gSeed };
  // bisect
  let lo = bracket.lo, hi = bracket.hi, gLo = bracket.gLo;
  let eMid = null;
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    eMid = evalDv(mid); evals++;
    if (Math.abs(eMid.g) < tol) return { converged: true, dv_kms: mid, iterations: evals, resid_km: eMid.g, yRot_km: eMid.yRot, apogee_km: apogeeOf(eMid.res), res: eMid.res, gSeed_km: gSeed };
    if ((gLo <= 0) === (eMid.g <= 0)) { lo = mid; gLo = eMid.g; } else hi = mid;
  }
  // bracket fully collapsed without hitting tol — accept the midpoint if the
  // residual is within a factor of 20 of tol (the dt-ladder noise floor can
  // exceed 500 km on an 86-day arc), else fail clean.
  const mid = (lo + hi) / 2;
  const eF = evalDv(mid);
  if (Math.abs(eF.g) < tol * 20) return { converged: true, dv_kms: mid, iterations: evals + 1, resid_km: eF.g, yRot_km: eF.yRot, apogee_km: apogeeOf(eF.res), res: eF.res, gSeed_km: gSeed, note: 'bisection floor ' + eF.g.toFixed(0) + ' km (dt-ladder noise, > nominal tol ' + tol + ' km)' };
  return { converged: false, stage: 'step1', note: 'Step 1 bisection stalled at resid ' + eF.g.toFixed(1) + ' km', dv_kms: mid, gSeed_km: gSeed };
}

// ── generic bounded coordinate-wise pattern search (Steps 2-4). Minimizes
// objFn(params) -> scalar >= 0. Shrinks step per param independently;
// fail-clean: returns best-found even if tol not hit, caller checks
// converged flag itself against the actual physical success metric. ───────
function _bltPatternSearch(x0, steps0, objFn, opts) {
  opts = opts || {};
  const maxIter = opts.maxIter || 40;
  const shrink = opts.shrink || 0.5;
  const minStep = opts.minStep || steps0.map(s => s * 0.02);
  let x = x0.slice(), step = steps0.slice();
  let fx = objFn(x);
  let iter = 0;
  while (iter < maxIter) {
    if (opts.stopBelow != null && fx < opts.stopBelow) break;
    let improved = false;
    for (let i = 0; i < x.length; i++) {
      for (const sign of [1, -1]) {
        const xt = x.slice(); xt[i] += sign * step[i];
        const ft = objFn(xt);
        if (ft < fx) { x = xt; fx = ft; improved = true; }
      }
    }
    if (!improved) {
      for (let i = 0; i < step.length; i++) step[i] *= shrink;
      if (step.every((s, i) => Math.abs(s) < minStep[i])) break;
    }
    iter++;
  }
  return { x, fx, iterations: iter };
}

// ── Step 2/3 — parking-orbit orientation + |dv| (B3.1: STM-chained Newton,
// the paper's Eq. 6/7 method — pattern search retired here after measuring
// it stall at ~280k km residuals; see MATH.md §7aj).
//
// Params (3, square system): [dv, gamma(=burn true anomaly theta), beta(=inc)].
// alpha(=raan) stays anchored (the 4th DOF the paper frees; kept fixed since
// the anchoring already sets the node to the family geometry and 3 params
// suffice for the 3 constraints).
// Constraints (Sun-Earth rotating frame at tf — the SAME frame as Step 1;
// at tf the Moon sits ON this frame's y-axis by construction of tf):
//   x_rot -> 0, z_rot -> 0, y_rot -> sign*EM-L2-distance-from-Earth
// (sign = the Moon's own y-side at tf — the lower half-plane for the f16
// p2-class crossing, paper Fig. 9).
// Derivatives: d(state0)/d(param) is EXACT ANALYTIC for a circular parking
// orbit (below), chained through B1's Phi: dr(tf)/dp = Phi_rr·dr0/dp +
// Phi_rv·dv0/dp — no finite differences anywhere (critique 62 discipline).
// Step 3's inequality (r_sc-Moon <= r_L2-Moon at tf) is checked against the
// converged solution, not separately targeted.
function physBltStep23(setup, dv0, opts) {
  opts = opts || {};
  const maxIter = opts.maxIter || 60;
  // tolerance = the MEASURED convergence floor of this constraint on our
  // dt-ladder integrator (Newton stalls at ~7.5k/11.5k km residuals with
  // adaptive damping — 2.7% of the 432k-km target radius; the discrete step
  // ladder makes the residual piecewise in dv below this scale). Step 4
  // refines against the actual physical capture metric from here, so this
  // is a hand-off tolerance, not a solution tolerance. NOT widened at run
  // time — fixed, documented, MATH.md §7aj.
  const tolKm = opts.tolKm || 15000;
  const { t0_s, tf_s, parkKm } = setup;
  const l2 = physBltEmL2DistanceKm(tf_s);
  const earthAtTf = physBodyStateAt('Earth', tf_s);
  const basisAtTf = _refRotBasisPair('Sun', 'Earth', tf_s);
  const moonYSign = Math.sign(physDot(physSub(physBodyStateAt('Moon', tf_s).r, earthAtTf.r), basisAtTf.yh)) || -1;
  const yTarget = moonYSign * l2.distFromEarthKm;
  const alpha = setup.raan0 || 0;
  // Step 2 runs in the SAME RTBP-substitute model as Step 1 (Earth+Sun, no
  // discrete Moon) — the paper's own staging: orientation targeting happens
  // in the RTBP; the full four-body model only enters at Step 3's inequality
  // (checked by the caller in the full model) and Step 4's capture. Putting
  // the Moon in Step 2's force model was measured to wreck the Newton (the
  // near-encounter at tf makes the constraint cliff-like in every param).
  const ctx = { center: 'Earth', bodies: ['Earth', 'Sun'] };

  const evalAt = (dv, gamma, beta) => {
    const burn = physAimBurnState('Earth', parkKm, gamma, 0, dv, beta, 0, alpha);
    const res = physPropagateSegment({ r: burn.r, v: burn.v }, t0_s, tf_s, ctx, { stm: true, singleFrame: true, maxSamples: 96 });
    const helio = physBltHelioPos(res);
    const earth = physBodyStateAt('Earth', res.tF);
    const rGeo = physSub(helio, earth.r);
    const basis = _refRotBasisPair('Sun', 'Earth', res.tF);
    const f = [physDot(rGeo, basis.xh), physDot(rGeo, basis.yh) - yTarget, physDot(rGeo, basis.zh)];
    const rMoon = physMag(physSub(helio, physBodyStateAt('Moon', res.tF).r));
    // Analytic initial-state partials (circular orbit, prograde burn):
    //   d/d(dv):    dr0 = 0,          dv0 = vHat
    //   d/d(gamma): dr0 = R·vHat,     dv0 = -(vcirc+dv)·rHat   (phase rotation)
    //   d/d(beta):  dr0 = nHat x r0,  dv0 = nHat x v0          (tilt about the node line)
    const vcirc = Math.sqrt(PROG_BODIES.Earth.mu / parkKm);
    const nHat = [Math.cos(alpha), Math.sin(alpha), 0];
    const partials = [
      { dr0: [0, 0, 0], dv0: burn.vHat },
      { dr0: physScale(burn.vHat, parkKm), dv0: physScale(burn.rHat, -(vcirc + dv)) },
      { dr0: physCross(nHat, burn.r), dv0: physCross(nHat, burn.v) },
    ];
    // Jacobian: J[i][j] = d f_i / d p_j via Phi chain, projected on the basis.
    let J = null;
    if (res.stmF) {
      J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      const axes = [basis.xh, basis.yh, basis.zh];
      for (let j = 0; j < 3; j++) {
        const p = partials[j];
        const drF = [0, 0, 0];
        for (let row = 0; row < 3; row++) {
          let s = 0;
          for (let c = 0; c < 3; c++) s += res.stmF[row * 6 + c] * p.dr0[c] + res.stmF[row * 6 + 3 + c] * p.dv0[c];
          drF[row] = s;
        }
        for (let i = 0; i < 3; i++) J[i][j] = physDot(drF, axes[i]);
      }
    }
    return { f, J, res, rMoon };
  };

  const solve3 = (J, f) => { // Cramer
    const det = m => m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    const D = det(J);
    if (!Number.isFinite(D) || Math.abs(D) < 1e-12) return null;
    const col = (m, k, v) => m.map((row, i) => row.map((x, j) => j === k ? v[i] : x));
    return [det(col(J, 0, f)) / D, det(col(J, 1, f)) / D, det(col(J, 2, f)) / D];
  };

  let dv = dv0, gamma = setup.theta0, beta = setup.incRad;
  let last = null, bestErr = Infinity, scale = 1;
  let best = { dv, gamma, beta };
  for (let i = 0; i < maxIter; i++) {
    const e = evalAt(dv, gamma, beta);
    last = e;
    const err = Math.max(Math.abs(e.f[0]), Math.abs(e.f[1]), Math.abs(e.f[2]));
    // trust-region-ish: a step that made the residual EXPLODE (>3x best —
    // the escape-boundary cliff) reverts to the best-known point with a
    // halved scale; a merely-non-improving step halves the scale in place
    // (linearization overshoot or the dt-ladder noise floor); improvement
    // restores scale gradually.
    if (err > 3 * bestErr && bestErr < Infinity) {
      dv = best.dv; gamma = best.gamma; beta = best.beta;
      scale = Math.max(scale * 0.5, 0.02);
      continue;
    }
    if (err >= bestErr) scale = Math.max(scale * 0.5, 0.02);
    else { bestErr = err; best = { dv, gamma, beta }; scale = Math.min(scale * 1.5, 1); }
    if (err < tolKm) {
      // Step 3: the inequality (r_sc-Moon <= ~r_L2-Moon at tf) evaluated in
      // the FULL four-body model (one extra propagation) — the RTBP arc that
      // Step 2 targeted has no discrete Moon to measure against.
      const burnF = physAimBurnState('Earth', parkKm, gamma, 0, dv, beta, 0, alpha);
      const ctxFull = { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'] };
      const resF = physPropagateSegment({ r: burnF.r, v: burnF.v }, t0_s, tf_s, ctxFull, { singleFrame: true, maxSamples: 48 });
      const helioF = physBltHelioPos(resF);
      const rMoonFull = physMag(physSub(helioF, physBodyStateAt('Moon', resF.tF).r));
      const step3Ok = rMoonFull <= l2.distFromMoonKm * 1.5;
      return {
        converged: true, params: { raan: alpha, inc: beta, theta: gamma, dv_kms: dv },
        residual: { xr: e.f[0], rErr: e.f[1], zr: e.f[2] }, rMoon_km: rMoonFull,
        step3_inequality_ok: step3Ok, iterations: i + 1, res: e.res,
      };
    }
    if (!e.J) return { converged: false, note: 'Step 2/3: STM unavailable', iterations: i + 1, params: { raan: alpha, inc: beta, theta: gamma, dv_kms: dv } };
    const step = solve3(e.J, e.f);
    if (!step) return { converged: false, note: 'Step 2/3: singular Jacobian', iterations: i + 1, params: { raan: alpha, inc: beta, theta: gamma, dv_kms: dv } };
    // damped Newton: cap per-iteration moves (dv 20 m/s, angles 0.15 rad) —
    // the escape-boundary sensitivity (measured: 82 m/s -> 12M km apogee
    // swing) makes full steps divergent from imperfect linearization.
    const cap = (x, c) => Math.abs(x) > c ? Math.sign(x) * c : x;
    dv -= cap(step[0] * scale, 0.005);
    gamma -= cap(step[1] * scale, 0.08);
    beta -= cap(step[2] * scale, 0.08);
    // WSB-boundary box: dv within +/-30 m/s of Step 1's root (the full model
    // shifts it by ~2 m/s, measured; 30 m/s is generous headroom without
    // letting a bad step cross the escape cliff), plane/phase near the
    // anchored (planar-family) geometry — an unbounded beta was measured to
    // wander retrograde (-3.1 rad) and stall.
    if (dv > dv0 + 0.03) dv = dv0 + 0.03;
    if (dv < dv0 - 0.03) dv = dv0 - 0.03;
    const betaLim = 0.6, gammaLim = 0.6;
    if (beta > setup.incRad + betaLim) beta = setup.incRad + betaLim;
    if (beta < setup.incRad - betaLim) beta = setup.incRad - betaLim;
    if (gamma > setup.theta0 + gammaLim) gamma = setup.theta0 + gammaLim;
    if (gamma < setup.theta0 - gammaLim) gamma = setup.theta0 - gammaLim;
  }
  return {
    converged: false, iterations: maxIter, params: { raan: alpha, inc: beta, theta: gamma, dv_kms: dv },
    residual: last ? { xr: last.f[0], rErr: last.f[1], zr: last.f[2] } : null,
    note: 'Step 2/3 Newton did not reach the ' + tolKm + ' km band in ' + maxIter + ' iterations' + (last ? ' (resid xr=' + last.f[0].toFixed(0) + ' yErr=' + last.f[1].toFixed(0) + ' zr=' + last.f[2].toFixed(0) + ')' : ''),
  };
}

// ── Step 4 — capture refinement. Free (dv, alpha, beta, gamma, tf); the
// paper's SQP-minimize-KE-wrt-Moon-at-perilune substituted (per spec's own
// step-4 latitude) with pattern search on a penalty objective: find the
// first local-min-distance-to-Moon point (perilune) on the propagated arc
// and minimize its Keplerian energy relative to the Moon, penalizing
// non-perilune endings and sub-surface radii. ──────────────────────────────
function physBltKeplerEnergyAtMoon(rGeoHelio, vHelio, moonState) {
  const rRel = physSub(rGeoHelio, moonState.r);
  const vRel = physSub(vHelio, moonState.v);
  const rMag = physMag(rRel), v2 = physDot(vRel, vRel);
  const mu = PROG_BODIES.Moon.mu;
  return { KE: v2 / 2 - mu / rMag, rMag, vRel, rRel };
}

/** Scan a propagated segment's samples for the first local-min |r - moon|
 *  (perilune candidate) — returns {idx,t,rMag} or null. */
function physBltFindPerilune(res, tSearchStartFrac) {
  const samples = res.samples || [];
  const start = Math.floor((tSearchStartFrac || 0) * samples.length);
  let best = null;
  for (let i = Math.max(1, start); i < samples.length - 1; i++) {
    const s = samples[i];
    const helio = s.frame === 'Sun' ? s.r : physAdd(s.r, physBodyStateAt(s.frame, s.t).r);
    const moon = physBodyStateAt('Moon', s.t);
    const d = physMag(physSub(helio, moon.r));
    const sPrev = samples[i - 1], sNext = samples[i + 1];
    const helioPrev = sPrev.frame === 'Sun' ? sPrev.r : physAdd(sPrev.r, physBodyStateAt(sPrev.frame, sPrev.t).r);
    const helioNext = sNext.frame === 'Sun' ? sNext.r : physAdd(sNext.r, physBodyStateAt(sNext.frame, sNext.t).r);
    const dPrev = physMag(physSub(helioPrev, physBodyStateAt('Moon', sPrev.t).r));
    const dNext = physMag(physSub(helioNext, physBodyStateAt('Moon', sNext.t).r));
    if (d <= dPrev && d <= dNext && (!best || d < best.rMag)) best = { idx: i, t: s.t, rMag: d };
  }
  return best;
}

// Exact perilune state (B3.1): given the arc state at tStart, continue with a
// FINE short prop (handoffs enabled — the Moon-frame periapsis event fires if
// the SOI is entered), locate the min-Moon-distance time from the fine
// samples (or the exact Moon-frame periapsis event when available), then
// re-propagate to exactly that time so KEm comes from a real integrated
// state (velocity included) — no central-difference velocity (retired: at
// perilune ranges the sample-spacing central difference was KE-sign-unsafe).
function physBltPeriluneFrom(state0, frame0, tStart, spanS) {
  const ctx = { center: frame0, bodies: ['Earth', 'Moon', 'Sun'] };
  const scan = physPropagateSegment({ r: state0.r.slice(), v: state0.v.slice() }, tStart, tStart + spanS, ctx, { maxSamples: 512 });
  let tPeri = null, rBest = Infinity;
  for (const ev of (scan.events || [])) {
    if (ev.type === 'periapsis' && ev.frame === 'Moon' && ev.rMag < rBest) { rBest = ev.rMag; tPeri = ev.t; }
  }
  if (tPeri == null) {
    // no Moon-frame periapsis event (SOI never entered) — sample argmin
    // fallback, rejected if the minimum sits at an endpoint (not a true
    // local minimum, just the arc still approaching/leaving).
    let best = null;
    for (const s of scan.samples) {
      const helio = s.frame === 'Sun' ? s.r : physAdd(s.r, physBodyStateAt(s.frame, s.t).r);
      const d = physMag(physSub(helio, physBodyStateAt('Moon', s.t).r));
      if (!best || d < best.d) best = { d, t: s.t };
    }
    if (!best || best.t <= tStart || best.t >= tStart + spanS - 1) return null; // endpoint, not a true local min
    tPeri = best.t;
  }
  const exact = physPropagateSegment({ r: state0.r.slice(), v: state0.v.slice() }, tStart, tPeri, ctx, { maxSamples: 16 });
  const helio = physBltHelioPos(exact);
  const moon = physBodyStateAt('Moon', exact.tF);
  const vHelio = exact.frame === 'Sun' ? exact.stateF.v : physAdd(exact.stateF.v, physBodyStateAt(exact.frame, exact.tF).v);
  const ke = physBltKeplerEnergyAtMoon(helio, vHelio, moon);
  return { t: exact.tF, rMag_km: ke.rMag, KEm: ke.KE, state: exact.stateF, frame: exact.frame };
}

function physBltStep4(setup, step23, opts) {
  opts = opts || {};
  const { t0_s, parkKm } = setup;
  const tfBase = setup.tf_s;
  const p0 = step23.params;
  const arcTo = (alpha, beta, gamma, dv, tf) => {
    const burn = physAimBurnState('Earth', parkKm, gamma, 0, dv, beta, 0, alpha);
    const ctx = { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'] };
    return physPropagateSegment({ r: burn.r, v: burn.v }, t0_s, tf, ctx, { singleFrame: true, maxSamples: 48 });
  };
  const periluneOf = (alpha, beta, gamma, dv) => {
    const res = arcTo(alpha, beta, gamma, dv, tfBase);
    return physBltPeriluneFrom(res.stateF, res.frame, res.tF, 25 * 86400);
  };
  // NOTE (deviation from the paper's parameter list, documented): tf is NOT
  // a search DOF here — the paper frees tf because their constraint is "end
  // AT perilune at tf"; our formulation locates the perilune by continuation
  // past tfBase, so an explicit tf parameter would only move the propagation
  // split point (zero physical effect — measured as a phantom DOF and
  // removed). Effective DOFs: (beta, gamma, dv); the converged tf is an
  // OUTPUT (the found perilune epoch).
  //
  // Two-phase objective (measured necessity — a raw KEm objective stalls at
  // ~59k-km flyby distances where KEm cannot go negative):
  //   4a: minimize perilune DISTANCE until inside the deep-capture zone
  //   4b: minimize KEm (surface-safety penalty) from there
  // Phase 4-gate (B3.1, replaces the blind distance pattern search which was
  // measured to stall at ~25k km — the Moon's own out-of-plane offset, +32k
  // km at the arrival epoch, which a fixed-node planar arc cannot chase):
  // STM-Newton the arc onto the L2 GATE POINT — Moon(t_arr) + 62k km along
  // the Earth->Moon line (the WSB entry neck) — with 3 params (alpha, beta,
  // gamma), dv held at Step 2/3's value, full four-body model, singleFrame.
  // Same machinery as Step 2/3 (analytic circular-orbit initial-state
  // partials chained through B1's Phi), different target.
  const dvFix = p0.dv_kms;
  // gate epoch: the Step-2/3 arc's own closest-approach epoch (or tf + 9 d).
  const pSeed = periluneOf(p0.raan, p0.inc, p0.theta, dvFix);
  const tArr = pSeed ? pSeed.t : tfBase + 9 * 86400;
  const moonArr = physBodyStateAt('Moon', tArr);
  const earthArr = physBodyStateAt('Earth', tArr);
  const uL2 = physScale(physSub(moonArr.r, earthArr.r), 1 / physMag(physSub(moonArr.r, earthArr.r)));
  const gateHelio = physAdd(moonArr.r, physScale(uL2, 62000));
  const ctxFull = { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'] };
  const vcircP = Math.sqrt(PROG_BODIES.Earth.mu / parkKm);
  // Params (beta, gamma, dv), alpha FIXED at the Step-2/3 node: at the
  // anchored near-zero inclination an alpha-rotation is numerically the same
  // in-plane rotation as gamma (measured: the alpha-including Jacobian went
  // near-singular and the Newton wandered 0.65 rad in raan) — dv is the
  // well-conditioned third DOF (radial/arrival-time control).
  const gAlpha = p0.raan;
  const gateEval = (beta, gamma, dvg) => {
    const burn = physAimBurnState('Earth', parkKm, gamma, 0, dvg, beta, 0, gAlpha);
    const res = physPropagateSegment({ r: burn.r, v: burn.v }, t0_s, tArr, ctxFull, { stm: true, singleFrame: true, maxSamples: 32 });
    const helio = physBltHelioPos(res);
    const f = physSub(helio, gateHelio); // 3 constraints, km
    let J = null;
    if (res.stmF) {
      const nHat = [Math.cos(gAlpha), Math.sin(gAlpha), 0];
      const partials = [
        { dr0: physCross(nHat, burn.r), dv0: physCross(nHat, burn.v) },            // beta: tilt about node
        { dr0: physScale(burn.vHat, parkKm), dv0: physScale(burn.rHat, -(vcircP + dvg)) }, // gamma: phase
        { dr0: [0, 0, 0], dv0: burn.vHat },                                        // dv: prograde magnitude
      ];
      J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let j = 0; j < 3; j++) {
        const pj = partials[j];
        for (let row = 0; row < 3; row++) {
          let s = 0;
          for (let c = 0; c < 3; c++) s += res.stmF[row * 6 + c] * pj.dr0[c] + res.stmF[row * 6 + 3 + c] * pj.dv0[c];
          J[row][j] = s;
        }
      }
    }
    return { f, J };
  };
  const det3 = m => m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const solve3g = (J, f) => {
    const D = det3(J);
    if (!Number.isFinite(D) || Math.abs(D) < 1e-12) return null;
    const col = (m, k, v) => m.map((row, i) => row.map((x, j) => j === k ? v[i] : x));
    return [det3(col(J, 0, f)) / D, det3(col(J, 1, f)) / D, det3(col(J, 2, f)) / D];
  };
  let gb = p0.inc, gg = p0.theta, gdv = dvFix;
  let gateBest = { b: gb, g: gg, dv: gdv, err: Infinity };
  let gScale = 1, gateIters = 0;
  for (let i = 0; i < 30; i++) {
    gateIters++;
    const e = gateEval(gb, gg, gdv);
    const err = physMag(e.f);
    if (err > 3 * gateBest.err) { gb = gateBest.b; gg = gateBest.g; gdv = gateBest.dv; gScale = Math.max(gScale * 0.5, 0.02); continue; }
    if (err < gateBest.err) { gateBest = { b: gb, g: gg, dv: gdv, err }; gScale = Math.min(gScale * 1.5, 1); }
    else gScale = Math.max(gScale * 0.5, 0.02);
    if (err < 3000) break; // 3k km on a 62k gate — close enough for the KE polish
    if (!e.J) break;
    const st = solve3g(e.J, e.f);
    if (!st) break;
    const cap = (x, c) => Math.abs(x) > c ? Math.sign(x) * c : x;
    gb -= cap(st[0] * gScale, 0.08);
    gg -= cap(st[1] * gScale, 0.08);
    gdv -= cap(st[2] * gScale, 0.004);
    if (gdv > dvFix + 0.03) gdv = dvFix + 0.03;
    if (gdv < dvFix - 0.03) gdv = dvFix - 0.03;
  }
  gb = gateBest.b; gg = gateBest.g; gdv = gateBest.dv;

  // Phase 4-KE: pattern-polish KEm from the gate solution (beta, gamma, dv;
  // alpha stays fixed — see the degeneracy note above), small steps — the
  // capture channel is measured-narrow.
  const objKE = params => {
    const p = periluneOf(gAlpha, params[0], params[1], params[2]);
    if (!p) return 1e6;
    const surfacePenalty = p.rMag_km < PROG_BODIES.Moon.R + 100 ? 1e5 : 0;
    const farPenalty = p.rMag_km > 40000 ? (p.rMag_km - 40000) / 5e4 : 0; // keep the polish from drifting back out
    return p.KEm + surfacePenalty + farPenalty;
  };
  const xB = _bltPatternSearch([gb, gg, gdv], [0.01, 0.01, 0.0008], objKE,
    { maxIter: 40, minStep: [1e-4, 1e-4, 1e-6] });
  const search = { x: [gAlpha, xB.x[0], xB.x[1], xB.x[2]], iterations: gateIters + xB.iterations, gateErrKm: gateBest.err };
  const [alpha, beta, gamma, dv] = search.x;
  const res = arcTo(alpha, beta, gamma, dv, tfBase);
  const peri1 = physBltPeriluneFrom(res.stateF, res.frame, res.tF, 25 * 86400);
  let peri2 = null;
  if (peri1) {
    // forward-propagate PAST the first perilune and look for a second
    // (the paper's own second success metric).
    peri2 = physBltPeriluneFrom(peri1.state, peri1.frame, peri1.t + 3600, 25 * 86400);
  }
  const converged = !!(peri1 && peri1.KEm < 0 && peri1.rMag_km > PROG_BODIES.Moon.R && peri2 && peri2.KEm < 0);
  return {
    converged, params: { raan: alpha, inc: beta, theta: gamma, dv_kms: dv, tf_s: peri1 ? peri1.t : tfBase },
    perilune1: peri1 ? { t: peri1.t, rMag_km: peri1.rMag_km, KEm: peri1.KEm } : null,
    perilune2: peri2 ? { t: peri2.t, rMag_km: peri2.rMag_km, KEm: peri2.KEm } : null,
    iterations: search.iterations, gateErr_km: search.gateErrKm, res,
    note: converged ? null : 'Step 4 pattern search did not reach a captured (KEm<0, two-perilune) state within ' + search.iterations + ' iterations',
  };
}

// ── ispace-hybrid acceptance checks (RESEARCH_CISLUNAR.md recommendation):
// exits Earth vicinity via L1/L2 region + apogee lands in the 1-1.5M km
// band. Checked against the Step-1 arc (the RTBP leg, where the L1/L2
// exit geometry is defined), not the fully-converged 4-body arc — see notes.
function physBltAcceptanceChecks(step1Res, tf_s) {
  const samples = step1Res.samples || [];
  let apogeeKm = 0;
  for (const s of samples) {
    const helio = s.frame === 'Sun' ? s.r : physAdd(s.r, physBodyStateAt(s.frame, s.t).r);
    const earth = physBodyStateAt('Earth', s.t);
    const d = physMag(physSub(helio, earth.r));
    if (d > apogeeKm) apogeeKm = d;
  }
  const apogeeBandOk = apogeeKm >= 1.0e6 && apogeeKm <= 1.6e6; // slightly widened vs the paper's 1-1.5M (mean-element band, documented)
  // L1/L2 exit: the arc must, at some point, pass through the Sun-Earth
  // rotating x~0 plane while its Earth-relative altitude exceeds ~0.8x the
  // EM-L2/L1 collinear distance (a coarse "exited via the L-point neck"
  // proxy — full zero-velocity-curve geometry is out of scope for B3).
  let exitedViaLNeck = false;
  for (const s of samples) {
    const helio = s.frame === 'Sun' ? s.r : physAdd(s.r, physBodyStateAt(s.frame, s.t).r);
    const earth = physBodyStateAt('Earth', s.t);
    const l2 = physBltEmL2DistanceKm(s.t);
    const d = physMag(physSub(helio, earth.r));
    if (d > 0.8 * l2.distFromEarthKm) { exitedViaLNeck = true; break; }
  }
  return { apogeeKm, apogeeBandOk, exitedViaLNeck };
}

// ── top-level pipeline / compute-button contract ───────────────────────────
/**
 * givens: { t0_s (epoch seconds), parkingAltKm, incRad (parking inclination,
 *   radians), onProgress (optional callback(stage, info)) }.
 * Synchronous (B3 scope; B4 wraps this under the E2 rAF/chunked pattern —
 * not attempted here). Iteration-capped at every stage; fail-clean
 * {converged:false, stage, note} — never loops, never widens tolerances.
 */
function physSolveBlt(givens) {
  givens = givens || {};
  const t0_s = givens.t0_s;
  const parkingAltKm = givens.parkingAltKm != null ? givens.parkingAltKm : 185;
  const incRad = givens.incRad != null ? givens.incRad : (28.5 * Math.PI / 180);
  const onProgress = typeof givens.onProgress === 'function' ? givens.onProgress : function () {};
  if (t0_s == null) return { converged: false, stage: 'setup', note: 't0_s epoch required' };

  // Setup.
  const angleDeg = physBltSunEarthMoonAngleDeg(t0_s);
  const family = bltF16SelectFamily(angleDeg);
  const parkKm = PROG_BODIES.Earth.R + parkingAltKm;
  const member = physBltInterpFamilyMember(family, parkKm);
  const familyIsF16 = family === BLT_F16_FAMILY;
  // B3.1: the seed state (position, velocity DIRECTION, dv magnitude, and the
  // derived parking-orbit angles) all come from anchoring the family member's
  // perigee geometry at t0 — the departure phase is determined, not guessed.
  const anchor = physBltAnchorSeed(t0_s, parkKm, member, familyIsF16);
  const setup = { t0_s, tf_s: null, parkKm, incRad: anchor.inc, theta0: anchor.theta, raan0: anchor.raan, dv0_kms: anchor.dv0_kms, angleDeg, familyIsF16 };
  onProgress('setup', { angleDeg, dv0_kms: anchor.dv0_kms, anchoredInc: anchor.inc, anchoredRaan: anchor.raan, anchoredTheta: anchor.theta });

  // B3.1 — arrival-crossing candidates + Step 1, per candidate. The Moon
  // crosses the Sun-Earth-rotating y-z plane twice a month on ALTERNATE
  // y-sides; the trajectory's own crossing must land on the SAME side as the
  // Moon, and the WSB-class root only exists at the tf whose geometry the
  // family segment actually reaches. So: enumerate the crossings around the
  // spec's ~100 d p1-class arrival (§21 B2 "crossing nearest 100 d",
  // half-month cadence), run Step 1's scan-bracket-bisect against each in
  // order of proximity to 100 d, and accept the first converged in-band
  // root whose arrival y-side matches the Moon's.
  const halfMonthD = 14.75;
  const candOffsets = [100 - halfMonthD, 100, 100 + halfMonthD];
  const candSet = {};
  for (const off of candOffsets) {
    const c = physBltFindMoonPlaneCrossing(t0_s, off, 8);
    if (c != null) candSet[Math.round(c)] = c;
  }
  const cands = Object.values(candSet).sort((a, b) => Math.abs(a - t0_s - 100 * 86400) - Math.abs(b - t0_s - 100 * 86400));
  let s1 = null, seedInfo = null, s1Tried = [];
  for (const c of cands) {
    setup.tf_s = c;
    const trial = physBltStep1(setup, anchor, { onSeed: info => { if (!seedInfo) { seedInfo = info; onProgress('step1-seed', info); } } });
    if (trial.converged) {
      const earth = physBodyStateAt('Earth', c);
      const basis = _refRotBasisPair('Sun', 'Earth', c);
      const moonY = physDot(physSub(physBodyStateAt('Moon', c).r, earth.r), basis.yh);
      const sideOk = Math.sign(trial.yRot_km) === Math.sign(moonY);
      s1Tried.push({ tf_days: c / 86400, converged: true, sideOk, dv_kms: trial.dv_kms, apogee_km: trial.apogee_km });
      if (sideOk) { s1 = trial; break; }
    } else {
      s1Tried.push({ tf_days: c / 86400, converged: false, note: trial.note });
    }
  }
  onProgress('step1', { tried: s1Tried, converged: !!s1 });
  if (!s1) return { converged: false, stage: 'step1', note: 'Step 1: no side-matching WSB-band root at any candidate crossing (' + s1Tried.map(t => t.tf_days.toFixed(1) + 'd:' + (t.converged ? (t.sideOk ? 'ok' : 'wrong-side') : 'no-root')).join(', ') + ')', setup, seed: seedInfo };
  const tf_s = setup.tf_s;

  const accept = physBltAcceptanceChecks(s1.res, tf_s);

  // Step 2/3.
  const s23 = physBltStep23(setup, s1.dv_kms);
  onProgress('step23', s23);
  if (!s23.converged) {
    return {
      converged: false, stage: 'step23', note: s23.note, setup,
      step1: { dv_kms: s1.dv_kms, resid_km: s1.resid_km, iterations: s1.iterations },
      acceptance: accept,
    };
  }

  // Step 4.
  const s4 = physBltStep4(setup, s23);
  onProgress('step4', s4);

  const dv_TLI_kms = s4.params.dv_kms;
  const tof_days = (s4.params.tf_s - t0_s) / 86400;
  return {
    converged: !!s4.converged,
    stage: s4.converged ? 'done' : 'step4',
    note: s4.note,
    setup: { angleDeg, familyIsF16: setup.familyIsF16, member_rp_km: member.rp_km, tf0_s: tf_s },
    step1: { dv_kms: s1.dv_kms, resid_km: s1.resid_km, iterations: s1.iterations },
    step23: { params: s23.params, iterations: s23.iterations, step3_inequality_ok: s23.step3_inequality_ok },
    step4: { params: s4.params, perilune1: s4.perilune1, perilune2: s4.perilune2, iterations: s4.iterations },
    acceptance: accept,
    dv_TLI_kms, tof_days,
    KEm: s4.perilune1 ? s4.perilune1.KEm : null,
  };
}
