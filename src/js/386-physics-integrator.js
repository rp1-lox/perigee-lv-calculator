
// ─── PHYSICS INTEGRATOR (P1) — restricted n-body propagation ─────────────────
//
// Pure math, no DOM. See PHYSICS_PLAN.md (P1) and MATH.md §7d.
//
// Model: vessels are massless test particles; bodies ride analytic rails
// (physBodyStateAt, 385). Integration happens in the DOMINANT body's frame
// (the vessel's current SOI) with third-body perturbers in the standard
// relative-motion form (direct minus indirect tidal terms) — this keeps
// coordinates small near the body that matters and is exactly the restricted
// three-body relative formulation when one perturber dominates.
//
// Determinism contract: fixed quantized step ladder, no wall clock, no
// randomness — identical inputs give bit-identical outputs (replay/undo/golden
// safety). All consumers go through physPropagateSegment (hard invariant:
// no ad-hoc integrators elsewhere).
//
// ctx = {
//   center:  'Earth' | 'Moon' | 'Sun' | ...   frame body (vessel's SOI)
//   bodies:  ['Sun','Earth','Moon']           gravitating set (center included or not — filtered)
//   overrides: {}                              planet-phase calibration map (render coherence)
//   railFn:  (body, t, overrides) => {r,v}    body-state source; default physBodyStateAt
//                                              (tests inject consistent synthetic rails here)
// }

// ── SOI radii ────────────────────────────────────────────────────────────────
// r_SOI = a · (mu / mu_parent)^(2/5). Sun: Infinity. Cached per body.
const _physSoiCache = {};
function physSoiRadius(body) {
  if (body === 'Sun') return Infinity;
  if (_physSoiCache[body] != null) return _physSoiCache[body];
  const mu = PROG_BODIES[body] && PROG_BODIES[body].mu;
  let a, muParent;
  const moonInfo = PROG_MOON_ORBITS && PROG_MOON_ORBITS[body];
  if (moonInfo) { a = moonInfo.r; muParent = PROG_BODIES[moonInfo.parent].mu; }
  else if (PROG_HELIO_R[body] != null) { a = PROG_HELIO_R[body]; muParent = PROG_MU_SUN; }
  else return 0;
  const r = (mu && a) ? a * Math.pow(mu / muParent, 0.4) : 0;
  _physSoiCache[body] = r;
  return r;
}

/** Parent frame of a body ('Sun' for planets, planet for moons). */
function physParentOf(body) {
  if (body === 'Sun') return null;
  const moonInfo = PROG_MOON_ORBITS && PROG_MOON_ORBITS[body];
  return moonInfo ? moonInfo.parent : 'Sun';
}

// ── frame finding + patching ─────────────────────────────────────────────────
/** Deepest body whose SOI contains the heliocentric point (Sun -> planet ->
 *  moon walk). railFn/overrides must match the caller's integration context.
 *  `onlyBodies` (optional, R3 perf): restrict the scan to these bodies — a
 *  leg's SOI transitions can only involve the bodies whose gravity it models,
 *  and the full scan was ~9 ephemeris Kepler solves per integrator step. */
function physFrameOf(rHelio, t, overrides, railFn, onlyBodies) {
  const rails = railFn || physBodyStateAt;
  const allowed = onlyBodies ? new Set(onlyBodies) : null;
  let frame = 'Sun';
  for (const planet of Object.keys(PROG_HELIO_R)) {
    if (allowed && !allowed.has(planet)) continue;
    const p = rails(planet, t, overrides);
    if (physMag(physSub(rHelio, p.r)) < physSoiRadius(planet)) { frame = planet; break; }
  }
  if (frame !== 'Sun') {
    for (const [moon, mo] of Object.entries(PROG_MOON_ORBITS || {})) {
      if (mo.parent !== frame) continue;
      if (allowed && !allowed.has(moon)) continue;
      const p = rails(moon, t, overrides);
      if (physMag(physSub(rHelio, p.r)) < physSoiRadius(moon)) { frame = moon; break; }
    }
  }
  return frame;
}

/** Convert a body-relative state between frames (position AND velocity). */
function physPatchState(state, fromBody, toBody, t, overrides, railFn) {
  if (fromBody === toBody) return { r: state.r.slice(), v: state.v.slice() };
  const rails = railFn || physBodyStateAt;
  const from = fromBody === 'Sun' ? { r: [0,0,0], v: [0,0,0] } : rails(fromBody, t, overrides);
  const to   = toBody   === 'Sun' ? { r: [0,0,0], v: [0,0,0] } : rails(toBody, t, overrides);
  return {
    r: physSub(physAdd(state.r, from.r), to.r),
    v: physSub(physAdd(state.v, from.v), to.v),
  };
}

// ── acceleration ─────────────────────────────────────────────────────────────
/** Gravitational acceleration (km/s²) on a test particle at r (km, relative to
 *  ctx.center) at time t. Central body: -mu r/|r|³. Perturbers: standard
 *  relative-motion tidal form mu_p·[(d-r)/|d-r|³ - d/|d|³] where d is the
 *  perturber's position relative to the center. */
function physAccel(r, t, ctx) {
  const rails = ctx.railFn || physBodyStateAt;
  const muC = ctx.center === 'Sun' ? PROG_MU_SUN : PROG_BODIES[ctx.center].mu;
  const rMag = physMag(r);
  let a = physScale(r, -muC / (rMag * rMag * rMag));
  const centerState = ctx.center === 'Sun' ? null : rails(ctx.center, t, ctx.overrides);
  for (const body of (ctx.bodies || [])) {
    if (body === ctx.center) continue;
    const muP = body === 'Sun' ? PROG_MU_SUN : (PROG_BODIES[body] && PROG_BODIES[body].mu);
    if (!muP) continue;
    const bodyHelio = body === 'Sun' ? { r: [0,0,0] } : rails(body, t, ctx.overrides);
    const d = centerState ? physSub(bodyHelio.r, centerState.r) : bodyHelio.r; // perturber rel center
    const dMag = physMag(d);
    if (!(dMag > 0)) continue;
    const rel = physSub(d, r);                       // vessel -> perturber
    const relMag = physMag(rel);
    if (!(relMag > 0)) continue;
    a = physAdd(a, physSub(
      physScale(rel, muP / (relMag * relMag * relMag)),
      physScale(d,   muP / (dMag  * dMag  * dMag))));
  }
  // ── optional J2 oblateness term (R4) — DEFAULT OFF: only applied when the
  // caller explicitly opts in with ctx.j2 === true AND the center body has a
  // J2 entry (PROG_BODY_J2, 385). No existing caller sets ctx.j2, so this is
  // zero behavior change unless requested (gate-pinned).
  // Approximation: the standard Earth-centered J2 form treats the z axis as
  // the body's equatorial-plane normal. We use the ECLIPTIC normal as a
  // stand-in (z of the integration frame) since body obliquities aren't
  // modeled anywhere in this program — see MATH.md §7l critique.
  if (ctx.j2 === true) {
    const j2 = (typeof PROG_BODY_J2 !== 'undefined') ? PROG_BODY_J2[ctx.center] : null;
    if (j2 != null) {
      const info = PROG_BODIES[ctx.center];
      const Rb = info.R;
      const x = r[0], y = r[1], z = r[2];
      const r2 = rMag * rMag;
      const z2r2 = (z * z) / r2;
      const k = -1.5 * j2 * muC * Rb * Rb / (rMag * rMag * rMag * rMag * rMag);
      a = physAdd(a, [
        k * x * (1 - 5 * z2r2),
        k * y * (1 - 5 * z2r2),
        k * z * (3 - 5 * z2r2),
      ]);
    }
  }
  return a;
}

// ── step-size policy ─────────────────────────────────────────────────────────
// dt = local orbital timescale / PHYS_STEPS_PER_ORBIT, quantized DOWN onto a
// fixed power-of-4 ladder — quantization is what makes runs deterministic
// regardless of float noise in the timescale estimate.
// R3 perf (2026-07-10): ladder densified from powers of 4 to powers of 2 —
// the coarse buckets quantized "want 14.7 s" down to 4 s, running ~3.7× more
// steps than the accuracy policy asked for (measured 612k steps per shoot
// campaign, dominating cold recompute). Still a FIXED ladder: deterministic.
// ctx.stepsPerOrbit (optional) coarsens the policy for scan-quality
// propagations (the shooter's seed grid needs closest-approach magnitude,
// not integration-grade accuracy).
const PHYS_DT_LADDER = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const PHYS_STEPS_PER_ORBIT = 360;
function physStepFor(r, ctx) {
  const muC = ctx.center === 'Sun' ? PROG_MU_SUN : PROG_BODIES[ctx.center].mu;
  const d = physMag(r);
  const tOrbit = 2 * Math.PI * Math.sqrt(d * d * d / muC); // circular timescale at this radius
  let want = tOrbit / (ctx.stepsPerOrbit || PHYS_STEPS_PER_ORBIT);
  // ctx.dtMax (P4): optional deterministic cap — heliocentric cruise steps
  // otherwise reach the 65,536 s rung (~1.5M km of relative motion per step),
  // enough to step clean OVER a planet's SOI, which both misses the SOI event
  // and makes the shooter's closest-approach metric noisy. Callers targeting
  // a specific body cap the ladder (a FIXED constant per leg — still
  // deterministic; the cap just selects a smaller rung).
  if (ctx.dtMax && want > ctx.dtMax) want = ctx.dtMax;
  let dt = PHYS_DT_LADDER[0];
  for (const step of PHYS_DT_LADDER) { if (step <= want) dt = step; else break; }
  return dt;
}

// ── E1: electric propulsion / low-thrust (MISSION_MODEL_V2 §19, MATH.md §7y) ──
// Opt-in via ctx.thrust = { thrust_N, isp_s, m0_kg, law, coastWindows?, mDry_kg? }.
// Ballistic byte-identity: every function below is ONLY invoked when ctx.thrust
// is present (physPropagateSegment hoists `hasThrust` once and branches on it),
// so the no-thrust path evaluates none of this — same physAccel/physLeapfrogStep
// calls, same object shapes, as before E1.
const PHYS_G0_MS2 = 9.80665; // standard gravity, m/s^2 (rocket-equation constant)
// Thrusting arcs must resolve every rev: cap dt <= local circular period / 40,
// composed with the existing distance-based ladder (physStepFor) via min().
const PHYS_THRUST_REVS_RESOLUTION = 40;

/** û(law) — thrust direction dispatch. Unknown law => null (caller treats as
 *  no thrust for that step; never throws mid-integration). */
function physThrustDir(law, r, v, t) {
  const vMag = physMag(v);
  if (vMag <= 0) return null;
  if (law === 'prograde') return physScale(v, 1 / vMag);
  if (law === 'retrograde') return physScale(v, -1 / vMag);
  return null;
}

/** True only for laws physThrustDir can actually resolve. An unknown law
 *  means no thrust AT ALL — no acceleration, no propellant burn (spec:
 *  "treat as no thrust + result flag, never throw mid-integration"). */
function physThrustLawKnown(law) {
  return law === 'prograde' || law === 'retrograde';
}

/** Local circular orbital period (s) at |r| about ctx.center — same tOrbit
 *  formula physStepFor uses internally, exposed for the thrust step cap. */
function physLocalPeriod(r, ctx) {
  const muC = ctx.center === 'Sun' ? PROG_MU_SUN : PROG_BODIES[ctx.center].mu;
  const d = physMag(r);
  return 2 * Math.PI * Math.sqrt(d * d * d / muC);
}

/** tRel-relative coast check: true when thrust should be ON (not inside a
 *  coastWindows interval). tRel is MET-relative (t - t0 of the segment). */
function physThrustWindowActive(thrust, tRel) {
  const windows = thrust.coastWindows;
  if (!windows || !windows.length) return true;
  for (const w of windows) { if (tRel >= w[0] && tRel < w[1]) return false; }
  return true;
}

/** Coupled mass ODE over one step: mdot = -T/(Isp*g0), constant rate while
 *  thrust is active (law resolves) => exact analytic integration per step
 *  (no Euler-bolt-on): mEnd = mStart - rate*dt, clamped to mDry_kg. Returns
 *  the fraction of dt actually spent burning (consumedDt) so a mid-step
 *  depletion doesn't go mass-negative. */
function physMassBurn(mStart, thrust, dt, active) {
  const mDry = thrust.mDry_kg || 0;
  if (!active || !(mStart > mDry)) return { mEnd: mStart, consumedDt: 0, depleted: !(mStart > mDry) };
  const rate = thrust.thrust_N / (thrust.isp_s * PHYS_G0_MS2); // kg/s
  const avail = mStart - mDry;
  const wantBurn = rate * dt;
  if (wantBurn <= avail) return { mEnd: mStart - wantBurn, consumedDt: dt, depleted: false };
  const consumedDt = avail / rate;
  return { mEnd: mDry, consumedDt, depleted: true };
}

/** Gravity (physAccel) + thrust acceleration (T/m . u-hat), km/s^2. `active`
 *  gates both the coast window AND the depletion flag (mass at floor). */
function physAccelWithThrust(r, v, m, t, ctx, thrust, active) {
  let a = physAccel(r, t, ctx);
  if (active && m > 0) {
    const dir = physThrustDir(thrust.law, r, v, t);
    if (dir) {
      const aThrust_kms2 = (thrust.thrust_N / m) / 1000; // m/s^2 -> km/s^2
      a = physAdd(a, physScale(dir, aThrust_kms2));
    }
  }
  return a;
}

/** Thrust-aware counterpart of physLeapfrogStep — same kick-drift-kick
 *  scheme, mass rides it via the exact per-step analytic burn above (matched
 *  to the r,v scheme: a0 uses mass/velocity at the step start, a1 uses the
 *  half-step velocity + end-of-step mass, mirroring how a1 already uses the
 *  drifted position). Returns {r,v,m,a1,dvStep,depleted,active}. */
function physLeapfrogStepThrust(state, t, dt, ctx, thrust, tRel, a0) {
  const active = physThrustLawKnown(thrust.law) && physThrustWindowActive(thrust, tRel);
  const burn = physMassBurn(state.m, thrust, dt, active);
  if (!a0) a0 = physAccelWithThrust(state.r, state.v, state.m, t, ctx, thrust, active);
  const vHalf = physAdd(state.v, physScale(a0, dt / 2));
  const r1 = physAdd(state.r, physScale(vHalf, dt));
  const a1 = physAccelWithThrust(r1, vHalf, burn.mEnd, t + dt, ctx, thrust, active && !burn.depleted ? active : active);
  const v1 = physAdd(vHalf, physScale(a1, dt / 2));
  // dvAccum: exact analytic integral of (T/m)dt over the burning portion of
  // this step (mass is exactly linear in t while burning at constant rate,
  // so this equals rocket-eq truth to float precision; telescopes over the
  // whole segment to Isp*g0*ln(m0/mF)). Units: km/s (matches state.v).
  let dvStep = 0;
  if (burn.consumedDt > 0 && burn.mEnd < state.m) {
    dvStep = (thrust.isp_s * PHYS_G0_MS2 * Math.log(state.m / burn.mEnd)) / 1000;
  }
  return { r: r1, v: v1, m: burn.mEnd, a1, dvStep, depleted: burn.depleted, active };
}

// ── B1: state-transition-matrix substrate (MISSION_MODEL_V2 §21, MATH.md §7ah) ──
// Opt-in via opts.stm = true on physPropagateSegment (NOT ctx.stm as the spec
// prose says — documented deviation: STM tracking is a per-call diagnostic
// concern like opts.singleFrame, not a physical force-model input, so it rides
// opts like every other propagation-mode flag). Propagates Phi(t,t0), the 6x6
// state-transition matrix (d state_f / d state_0), alongside the trajectory via
// the variational equation d/dt[dr;dv] = [[0,I],[F,0]]*[dr;dv], F = dA/dr, on
// the SAME kick-drift-kick scheme 386 already uses for r,v (E1's "ride the
// existing scheme" precedent, not an Euler bolt-on). Ballistic byte-identity:
// every function below is ONLY invoked when opts.stm is true (hoisted once),
// so the default path evaluates none of this.
/** 3x3 Jacobian term for one gravitating source: mu*(3 s s^T/|s|^5 - I/|s|^3),
 *  row-major length-9 array. `s` is the vector from the test particle TO the
 *  source (matches physAccel's own r/rel usage so signs fall out identically
 *  to a direct differentiation of physAccel's sum, not a re-derivation). */
function physJacTerm3(s, mu) {
  const sMag = physMag(s);
  if (!(sMag > 0) || !mu) return [0,0,0, 0,0,0, 0,0,0];
  const inv3 = 1 / (sMag * sMag * sMag);
  const inv5 = inv3 / (sMag * sMag);
  const k3 = 3 * mu * inv5;
  return [
    k3*s[0]*s[0] - mu*inv3, k3*s[0]*s[1],           k3*s[0]*s[2],
    k3*s[1]*s[0],           k3*s[1]*s[1] - mu*inv3, k3*s[1]*s[2],
    k3*s[2]*s[0],           k3*s[2]*s[1],           k3*s[2]*s[2] - mu*inv3,
  ];
}
function _physMat3Add(a, b) { const o = new Array(9); for (let i = 0; i < 9; i++) o[i] = a[i] + b[i]; return o; }
function _physMat3Vec(m, v) {
  return [
    m[0]*v[0] + m[1]*v[1] + m[2]*v[2],
    m[3]*v[0] + m[4]*v[1] + m[5]*v[2],
    m[6]*v[0] + m[7]*v[1] + m[8]*v[2],
  ];
}
/** dA/dr (3x3, row-major) for ctx's exact force sum at (r,t) — central body
 *  uses s=r directly (physAccel's central term), each perturber uses
 *  s=rel=d-r (physAccel's perturber term); see MATH.md §7ah for the
 *  derivation. Does NOT include the optional J2 term (ctx.j2) — v1 limitation,
 *  documented (MATH.md §7ah critique): an STM run with ctx.j2 true will be
 *  linearized against the point-mass field only. */
function physAccelJacobian(r, t, ctx) {
  const rails = ctx.railFn || physBodyStateAt;
  const muC = ctx.center === 'Sun' ? PROG_MU_SUN : PROG_BODIES[ctx.center].mu;
  let J = physJacTerm3(r, muC);
  const centerState = ctx.center === 'Sun' ? null : rails(ctx.center, t, ctx.overrides);
  for (const body of (ctx.bodies || [])) {
    if (body === ctx.center) continue;
    const muP = body === 'Sun' ? PROG_MU_SUN : (PROG_BODIES[body] && PROG_BODIES[body].mu);
    if (!muP) continue;
    const bodyHelio = body === 'Sun' ? { r: [0,0,0] } : rails(body, t, ctx.overrides);
    const d = centerState ? physSub(bodyHelio.r, centerState.r) : bodyHelio.r;
    if (!(physMag(d) > 0)) continue;
    const rel = physSub(d, r);
    if (!(physMag(rel) > 0)) continue;
    J = _physMat3Add(J, physJacTerm3(rel, muP));
  }
  return J;
}

// ── leapfrog (kick-drift-kick, symplectic, 2nd order) ────────────────────────
// `a0` (optional): precomputed acceleration at (state.r, t). Between
// consecutive steps a0 of step n+1 EQUALS a1 of step n (same r, same t) —
// physPropagateSegment threads it through, halving rail/accel evaluations
// (they became Kepler solves under the R1 real ephemeris — measured hot).
// Returned {a1} lets the caller do that. Identical math either way.
function physLeapfrogStep(state, t, dt, ctx, a0) {
  if (!a0) a0 = physAccel(state.r, t, ctx);
  const vHalf = physAdd(state.v, physScale(a0, dt / 2));
  const r1 = physAdd(state.r, physScale(vHalf, dt));
  const a1 = physAccel(r1, t + dt, ctx);
  const v1 = physAdd(vHalf, physScale(a1, dt / 2));
  return { r: r1, v: v1, a1 };
}

// ── event bisection ──────────────────────────────────────────────────────────
/** Find t in [tLo, tHi] where scalar f(t) crosses zero (f(tLo), f(tHi) must
 *  bracket). Plain bisection: robust, deterministic. */
function physFindEventTime(f, tLo, tHi, tol) {
  let lo = tLo, hi = tHi, fLo = f(tLo);
  for (let i = 0; i < 64 && (hi - lo) > (tol || 0.5); i++) {
    const mid = (lo + hi) / 2, fMid = f(mid);
    if ((fLo <= 0) === (fMid <= 0)) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

// ── the workhorse ────────────────────────────────────────────────────────────
/**
 * Propagate {r, v} (relative to ctx.center) from t0 until tMax.
 *
 * opts = {
 *   maxSamples: 256,        // decimation target for the returned polyline
 *   stopAtSoi:  false,      // end the segment at the first SOI transition
 *   handoff:    true,       // patch frames + continue on SOI transitions
 *   maxSteps:   2e6,        // hard runaway backstop
 *   singleFrame:false,      // N1 (MISSION_MODEL_V2 §17): never change frame —
 *                           // integrate in ctx.center the whole segment (full
 *                           // ctx.bodies force model unchanged; no soi
 *                           // events). Diagnostic/gate use: proves the frame
 *                           // handoff is pure coordinate bookkeeping (the
 *                           // residual vs the handoff path is dt-ladder
 *                           // discretization only — measured ~81 km / 0.22 m/s
 *                           // over a 6-day lunar flyby, MATH.md §7u).
 * }
 *
 * Returns {
 *   stateF, tF, frame,                       // final state + its frame body
 *   samples: [{t, r:[3], frame}],            // decimated, endpoints + events kept
 *   events:  [{type:'soi'|'periapsis'|'apoapsis', t, from?, to?, rMag?}],
 *   steps,                                   // raw integrator steps taken
 * }
 */
function physPropagateSegment(state0, t0, tMax, ctx, opts) {
  opts = opts || {};
  const maxSamples = opts.maxSamples || 256;
  const maxSteps = opts.maxSteps || 2e6;
  const rails = ctx.railFn || physBodyStateAt;
  let ctxNow = { center: ctx.center, bodies: ctx.bodies || ['Sun', 'Earth', 'Moon'], overrides: ctx.overrides || {}, railFn: ctx.railFn, dtMax: ctx.dtMax, j2: ctx.j2 };
  // E1 (MISSION_MODEL_V2 §19 / MATH.md §7y): thrust is opt-in and hoisted to a
  // single boolean — the ballistic branch below never evaluates any thrust
  // code, keeping it byte-identical to pre-E1 behavior.
  const hasThrust = !!ctx.thrust;
  const thrust = ctx.thrust;
  // B1 (MATH.md §7ah): opts.stm opt-in. Unsupported with ctx.thrust (v1) —
  // return stmF:null + a note rather than throwing (E1's "never throw
  // mid-integration" discipline extended to this substrate).
  const wantStm = !!opts.stm;
  let stmActive = wantStm && !hasThrust;
  let stmNote = null;
  if (wantStm && hasThrust) stmNote = 'B1: STM unsupported with ctx.thrust (v1) — stmF is null. Low-thrust STM is future work.';
  // Phi(t0) = I, stored as 6 columns (one per initial [dr;dv] basis vector);
  // each column's r-part/v-part are ordinary 3-vectors, so the same leapfrog
  // recursion physLeapfrogStep uses for the real trajectory applies column-
  // wise (physAdd/physScale reused verbatim — see physAccelJacobian above).
  let stmR = null, stmV = null;
  if (stmActive) {
    stmR = []; stmV = [];
    for (let j = 0; j < 6; j++) {
      stmR.push([j === 0 ? 1 : 0, j === 1 ? 1 : 0, j === 2 ? 1 : 0]);
      stmV.push([j === 3 ? 1 : 0, j === 4 ? 1 : 0, j === 5 ? 1 : 0]);
    }
  }
  let state = { r: state0.r.slice(), v: state0.v.slice() };
  if (hasThrust) state.m = thrust.m0_kg;
  let t = t0;
  const raw = [{ t, r: state.r.slice(), frame: ctxNow.center }];
  if (hasThrust) raw[0].m = state.m;
  const events = [];
  let steps = 0;
  let dvAccum = 0;
  let propDepleted = false;
  let prevRdotV = physDot(state.r, state.v);

  const helioOf = (st, tt, center) => center === 'Sun' ? st.r : physAdd(st.r, rails(center, tt, ctxNow.overrides).r);

  // R3 perf: SOI transitions can only involve bodies whose gravity the leg
  // models (ctx.bodies) + their moons — scanning every planet's ephemeris per
  // step was ~9 Kepler solves/step for nothing (frame checks got expensive
  // under the R1 real rails). physFrameOf takes the restricted list.
  const frameBodies = ctxNow.bodies;
  let aCarry = null; // a1 of step n === a0 of step n+1 (same r, same t)

  while (t < tMax && steps < maxSteps) {
    let dt = physStepFor(state.r, ctxNow);
    // Step control (E1): a thrusting arc must resolve every rev — cap dt to
    // local-period/40, composed with the distance-based ladder via min().
    // Only evaluated when hasThrust (ballistic path unaffected).
    if (hasThrust && !propDepleted && physThrustLawKnown(thrust.law) && physThrustWindowActive(thrust, t - t0)) {
      dt = Math.min(dt, physLocalPeriod(state.r, ctxNow) / PHYS_THRUST_REVS_RESOLUTION);
    }
    dt = Math.min(dt, tMax - t) || (tMax - t);
    let next;
    if (hasThrust) {
      next = physLeapfrogStepThrust(state, t, dt, ctxNow, thrust, t - t0, aCarry);
      dvAccum += next.dvStep;
      if (next.depleted) propDepleted = true;
    } else {
      next = physLeapfrogStep(state, t, dt, ctxNow, aCarry);
    }
    const tNext = t + dt;
    // B1: propagate Phi via the SAME kick-drift-kick recursion as r,v, using
    // F evaluated at the reference trajectory's own (r,t) and (r1,t+dt) — the
    // standard variational-equation linearization (same F for every column).
    if (stmActive) {
      const F0 = physAccelJacobian(state.r, t, ctxNow);
      const F1 = physAccelJacobian(next.r, tNext, ctxNow);
      for (let j = 0; j < 6; j++) {
        const vHalf = physAdd(stmV[j], physScale(_physMat3Vec(F0, stmR[j]), dt / 2));
        const r1c = physAdd(stmR[j], physScale(vHalf, dt));
        const v1c = physAdd(vHalf, physScale(_physMat3Vec(F1, r1c), dt / 2));
        stmR[j] = r1c; stmV[j] = v1c;
      }
    }
    aCarry = next.a1;
    steps++;

    // apsis events: sign change of r·v (radial velocity) within this frame
    const rdotV = physDot(next.r, next.v);
    if (prevRdotV < 0 && rdotV >= 0) events.push({ type: 'periapsis', t: tNext, rMag: physMag(next.r), frame: ctxNow.center });
    if (prevRdotV > 0 && rdotV <= 0) events.push({ type: 'apoapsis',  t: tNext, rMag: physMag(next.r), frame: ctxNow.center });
    prevRdotV = rdotV;

    // SOI transition: frame of the new heliocentric position differs.
    // N1 (§17): this is COORDINATE bookkeeping only — ctx.bodies (the force
    // model) is fixed for the whole segment and never truncated at a handoff;
    // opts.singleFrame skips even the re-centering (gate/diagnostic path).
    if (opts.singleFrame) { state = next; t = tNext; raw.push(hasThrust ? { t, r: state.r.slice(), frame: ctxNow.center, m: state.m, dv: dvAccum } : { t, r: state.r.slice(), frame: ctxNow.center }); continue; }
    const helio = helioOf(next, tNext, ctxNow.center);
    const frameNext = physFrameOf(helio, tNext, ctxNow.overrides, ctxNow.railFn, frameBodies);
    if (frameNext !== ctxNow.center) {
      events.push({ type: 'soi', t: tNext, from: ctxNow.center, to: frameNext });
      // B1: Phi's columns are expressed in the OLD frame's coordinates; a
      // frame handoff is a translation of r,v by body state (physPatchState),
      // not a linear map on the deviation coordinates, so Phi is not valid
      // past a handoff. RECOMMENDED usage is opts.singleFrame (the N2/B2
      // precedent — never reaches this branch). If a handoff occurs anyway,
      // freeze Phi at its last value and note it rather than silently
      // returning a wrong matrix.
      if (stmActive) { stmActive = false; stmNote = `B1: frame handoff (${ctxNow.center}->${frameNext}) occurred with opts.stm set and opts.singleFrame not set — Phi frozen at the last in-frame value (t=${t}); use opts.singleFrame for full-segment STM support.`; }
      state = physPatchState(next, ctxNow.center, frameNext, tNext, ctxNow.overrides, ctxNow.railFn);
      if (hasThrust) state.m = next.m; // mass is frame-invariant — patch only touches r,v
      ctxNow = Object.assign({}, ctxNow, { center: frameNext });
      prevRdotV = physDot(state.r, state.v);
      aCarry = null; // frame changed — carried acceleration is in the old frame
      t = tNext;
      raw.push(hasThrust ? { t, r: state.r.slice(), frame: ctxNow.center, m: state.m, dv: dvAccum } : { t, r: state.r.slice(), frame: ctxNow.center });
      if (opts.stopAtSoi || opts.handoff === false) break;
      continue;
    }

    state = next;
    t = tNext;
    raw.push(hasThrust ? { t, r: state.r.slice(), frame: ctxNow.center, m: state.m, dv: dvAccum } : { t, r: state.r.slice(), frame: ctxNow.center });
  }

  // decimate: keep first/last + every k-th; frame changes always survive
  let samples = raw;
  if (raw.length > maxSamples) {
    const k = Math.ceil(raw.length / maxSamples);
    samples = raw.filter((s, idx) =>
      idx === 0 || idx === raw.length - 1 || idx % k === 0 ||
      (idx > 0 && raw[idx - 1].frame !== s.frame));
  }

  const result = { stateF: state, tF: t, frame: ctxNow.center, samples, events, steps };
  if (hasThrust) { result.dvAccum = dvAccum; result.propDepleted = propDepleted; }
  if (wantStm) {
    if (hasThrust || !stmR) {
      result.stmF = null;
    } else {
      // 6x6 row-major: rows 0-2 = dr/d(state0) across the 6 columns, rows
      // 3-5 = dv/d(state0). stmR[j]/stmV[j] are the 3-vectors for column j.
      const stmF = new Array(36);
      for (let j = 0; j < 6; j++) {
        stmF[0 * 6 + j] = stmR[j][0]; stmF[1 * 6 + j] = stmR[j][1]; stmF[2 * 6 + j] = stmR[j][2];
        stmF[3 * 6 + j] = stmV[j][0]; stmF[4 * 6 + j] = stmV[j][1]; stmF[5 * 6 + j] = stmV[j][2];
      }
      result.stmF = stmF;
    }
    if (stmNote) result.stmNote = stmNote;
  }
  return result;
}
