
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
 *  moon walk). railFn/overrides must match the caller's integration context. */
function physFrameOf(rHelio, t, overrides, railFn) {
  const rails = railFn || physBodyStateAt;
  let frame = 'Sun';
  for (const planet of Object.keys(PROG_HELIO_R)) {
    const p = rails(planet, t, overrides);
    if (physMag(physSub(rHelio, p.r)) < physSoiRadius(planet)) { frame = planet; break; }
  }
  if (frame !== 'Sun') {
    for (const [moon, mo] of Object.entries(PROG_MOON_ORBITS || {})) {
      if (mo.parent !== frame) continue;
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
  return a;
}

// ── step-size policy ─────────────────────────────────────────────────────────
// dt = local orbital timescale / PHYS_STEPS_PER_ORBIT, quantized DOWN onto a
// fixed power-of-4 ladder — quantization is what makes runs deterministic
// regardless of float noise in the timescale estimate.
const PHYS_DT_LADDER = [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536];
const PHYS_STEPS_PER_ORBIT = 360;
function physStepFor(r, ctx) {
  const muC = ctx.center === 'Sun' ? PROG_MU_SUN : PROG_BODIES[ctx.center].mu;
  const d = physMag(r);
  const tOrbit = 2 * Math.PI * Math.sqrt(d * d * d / muC); // circular timescale at this radius
  let want = tOrbit / PHYS_STEPS_PER_ORBIT;
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

// ── leapfrog (kick-drift-kick, symplectic, 2nd order) ────────────────────────
function physLeapfrogStep(state, t, dt, ctx) {
  const a0 = physAccel(state.r, t, ctx);
  const vHalf = physAdd(state.v, physScale(a0, dt / 2));
  const r1 = physAdd(state.r, physScale(vHalf, dt));
  const a1 = physAccel(r1, t + dt, ctx);
  const v1 = physAdd(vHalf, physScale(a1, dt / 2));
  return { r: r1, v: v1 };
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
  let ctxNow = { center: ctx.center, bodies: ctx.bodies || ['Sun', 'Earth', 'Moon'], overrides: ctx.overrides || {}, railFn: ctx.railFn, dtMax: ctx.dtMax };
  let state = { r: state0.r.slice(), v: state0.v.slice() };
  let t = t0;
  const raw = [{ t, r: state.r.slice(), frame: ctxNow.center }];
  const events = [];
  let steps = 0;
  let prevRdotV = physDot(state.r, state.v);

  const helioOf = (st, tt, center) => center === 'Sun' ? st.r : physAdd(st.r, rails(center, tt, ctxNow.overrides).r);

  while (t < tMax && steps < maxSteps) {
    const dt = Math.min(physStepFor(state.r, ctxNow), tMax - t) || (tMax - t);
    const next = physLeapfrogStep(state, t, dt, ctxNow);
    const tNext = t + dt;
    steps++;

    // apsis events: sign change of r·v (radial velocity) within this frame
    const rdotV = physDot(next.r, next.v);
    if (prevRdotV < 0 && rdotV >= 0) events.push({ type: 'periapsis', t: tNext, rMag: physMag(next.r), frame: ctxNow.center });
    if (prevRdotV > 0 && rdotV <= 0) events.push({ type: 'apoapsis',  t: tNext, rMag: physMag(next.r), frame: ctxNow.center });
    prevRdotV = rdotV;

    // SOI transition: frame of the new heliocentric position differs
    const helio = helioOf(next, tNext, ctxNow.center);
    const frameNext = physFrameOf(helio, tNext, ctxNow.overrides, ctxNow.railFn);
    if (frameNext !== ctxNow.center) {
      events.push({ type: 'soi', t: tNext, from: ctxNow.center, to: frameNext });
      state = physPatchState(next, ctxNow.center, frameNext, tNext, ctxNow.overrides, ctxNow.railFn);
      ctxNow = Object.assign({}, ctxNow, { center: frameNext });
      prevRdotV = physDot(state.r, state.v);
      t = tNext;
      raw.push({ t, r: state.r.slice(), frame: ctxNow.center });
      if (opts.stopAtSoi || opts.handoff === false) break;
      continue;
    }

    state = next;
    t = tNext;
    raw.push({ t, r: state.r.slice(), frame: ctxNow.center });
  }

  // decimate: keep first/last + every k-th; frame changes always survive
  let samples = raw;
  if (raw.length > maxSamples) {
    const k = Math.ceil(raw.length / maxSamples);
    samples = raw.filter((s, idx) =>
      idx === 0 || idx === raw.length - 1 || idx % k === 0 ||
      (idx > 0 && raw[idx - 1].frame !== s.frame));
  }

  return { stateF: state, tF: t, frame: ctxNow.center, samples, events, steps };
}
