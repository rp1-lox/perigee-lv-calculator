// tests/corrector_harness.js
//
// OFFLINE periodicity-corrector harness (MISSION_MODEL_V2 §17 N2) — the
// re-runnable provenance for every `kind:'propagated'` seed pinned in
// src/js/425-reference-orbits.js. NOT run by the build gate (it is a Newton
// search, minutes-scale); the gate only VERIFIES the pinned seeds' closure
// (same escape hatch as Phase 4 U4).
//
// Run:  node tests/corrector_harness.js            (all cases)
//       node tests/corrector_harness.js nrho       (one case: nrho|eml2|eml1|lyap|blt|f16)
//
// Method (upgrade over the Phase-4 offline corrector, which measured closure
// in the INERTIAL Moon frame — adequate for a 4.71d high-eccentricity loop
// that never leaves the Moon's near field, wrong for true three-body objects):
//   - propagate in the REAL ephemeris model via physPropagateSegment
//     (ctx = {center:'Moon', bodies:['Moon','Earth','Sun']}, singleFrame —
//     N1 proved the frame handoff is coordinate bookkeeping, so integrating
//     the whole loop Moon-centered with the full body list is dynamically
//     identical and keeps every sample in one frame),
//   - measure position closure |r(t0+P) - r(t0)| in the instantaneous
//     Earth-Moon ROTATING frame (x away from Earth, z along the Earth-Moon
//     orbital angular momentum), where a libration-point orbit is actually
//     (quasi-)periodic,
//   - damped FD-Jacobian Gauss-Newton over the case's free parameters.
//
// In the real ephemeris model exact periodicity does not exist (lunar orbit
// eccentricity/evection pulse the rotating frame): the accepted product is a
// bounded quasi-periodic loop with documented closure, same D6 discipline as
// Phase 4 (< ~500 km/rev standard; the achieved numbers are printed and then
// pinned verbatim into 425 + MATH.md §7v).

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'src/js/010-constants.js',
  'src/js/140-physics.js',
  'src/js/360-program-module-phase-1-delta-v-engine.js',
  'src/js/385-physics-core.js',
  'src/js/386-physics-integrator.js',
];
const src = FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
const sandbox = { document: { getElementById: () => null }, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'corrector-modules.js' });

const g = name => vm.runInContext(name, sandbox);
const physPropagateSegment = g('physPropagateSegment');
const physBodyStateAt = g('physBodyStateAt');
const physAdd = g('physAdd'), physSub = g('physSub'), physScale = g('physScale');
const physCross = g('physCross'), physDot = g('physDot'), physMag = g('physMag');
const MU_E = g('PROG_BODIES').Earth.mu, MU_M = g('PROG_BODIES').Moon.mu;

const CTX = { center: 'Moon', bodies: ['Moon', 'Earth', 'Sun'] };
const PROP_OPTS = { maxSamples: 512, singleFrame: true };

// ── Earth-Moon rotating frame at epoch t ─────────────────────────────────────
function emFrame(t) {
  const e = physBodyStateAt('Earth', t), m = physBodyStateAt('Moon', t);
  const rE = physSub(e.r, m.r), vE = physSub(e.v, m.v);   // Earth rel Moon
  const d = physMag(rE);
  const xh = physScale(rE, -1 / d);                        // +x: away from Earth (L2 side)
  const h = physCross(rE, vE);
  const om = physScale(h, 1 / (d * d));                    // instantaneous angular velocity
  const zh = physScale(om, 1 / physMag(om));
  const yh = physCross(zh, xh);
  return { xh, yh, zh, om, d };
}
function toRot(state, t) {
  const f = emFrame(t);
  const vr = physSub(state.v, physCross(f.om, state.r));
  const proj = a => [physDot(a, f.xh), physDot(a, f.yh), physDot(a, f.zh)];
  return { r: proj(state.r), v: proj(vr), d: f.d };
}
function fromRot(rRot, vRot, t) {
  const f = emFrame(t);
  const mk = c => physAdd(physAdd(physScale(f.xh, c[0]), physScale(f.yh, c[1])), physScale(f.zh, c[2]));
  const r = mk(rRot);
  return { r, v: physAdd(mk(vRot), physCross(f.om, r)) };
}

// ── collinear L-point distances at t=0 (force balance, Moon-centered x) ─────
// point at signed offset x from the Moon along the Earth-Moon line (+ away
// from Earth; Earth at -d). Balance: aE + aM = n^2 * (x + d*(1-mu_frac)),
// n^2 = (muE+muM)/d^3. Bisection.
function collinearL(t, which) {
  const d = emFrame(t).d;
  const n2 = (MU_E + MU_M) / (d * d * d);
  const muFrac = MU_M / (MU_E + MU_M);
  const f = x => {
    const aE = -MU_E * Math.sign(x + d) / ((x + d) * (x + d));
    const aM = -MU_M * Math.sign(x) / (x * x);
    return aE + aM + n2 * (x + d * (1 - muFrac));
  };
  let lo, hi;
  if (which === 'L2') { lo = 0.05 * d; hi = 0.4 * d; }
  else { lo = -0.4 * d; hi = -0.05 * d; }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if ((f(lo) <= 0) === (f(mid) <= 0)) lo = mid; else hi = mid;
  }
  return { x: (lo + hi) / 2, d };
}

// ── closure residual: rotating-frame position miss over one period ──────────
// build(params) -> { rRot, vRot, P }.
function closure(build, params) {
  const s = build(params);
  const st0 = fromRot(s.rRot, s.vRot, 0);
  const out = physPropagateSegment(st0, 0, s.P, CTX, PROP_OPTS);
  const rotF = toRot(out.stateF, out.tF);
  const rot0 = toRot(st0, 0);
  const miss = [rotF.r[0] - rot0.r[0], rotF.r[1] - rot0.r[1], rotF.r[2] - rot0.r[2]];
  const dvClose = Math.hypot(rotF.v[0] - rot0.v[0], rotF.v[1] - rot0.v[1], rotF.v[2] - rot0.v[2]);
  let rMin = Infinity, rMax = 0;
  for (const smp of out.samples) { const m = physMag(smp.r); if (m < rMin) rMin = m; if (m > rMax) rMax = m; }
  return { miss, missMag: Math.hypot(...miss), dvClose, rMin, rMax, out, st0, s };
}

// ── derivative-free compass/pattern search (N2 finding: the full-period map
// through a libration orbit's near pass is so sensitive that FD Jacobians are
// noise-dominated — Gauss-Newton stalled at iteration 0 on every case. Direct
// search only asks "does this move reduce closure", which survives the noise;
// the NRHO went 1,640 km (scan) → 346 km in ~220 evaluations this way.) ──────
// step0[j] = 0 locks parameter j (e.g. P pinned to a resonance).
function patternSearch(build, p0, step0, opts) {
  opts = opts || {};
  let p = p0.slice();
  let best = closure(build, p);
  let step = step0.slice();
  const minStep = opts.minStep || step0.map(s => s === 0 ? 0 : s / 4096);
  let evals = 0, iter = 0;
  const maxIter = opts.maxIter || 400;
  for (; iter < maxIter && best.missMag > (opts.tolKm || 25); iter++) {
    let improved = false;
    for (let j = 0; j < p.length; j++) {
      if (step[j] === 0) continue;
      for (const sgn of [1, -1]) {
        const pn = p.slice(); pn[j] += sgn * step[j];
        const c = closure(build, pn); evals++;
        if (c.rMin < (opts.rMinFloor || 1500) || c.rMax > (opts.rMaxCeil || 200000)) continue;
        if (c.missMag < best.missMag) { p = pn; best = c; improved = true; break; }
      }
    }
    if (!improved) {
      let allMin = true;
      for (let j = 0; j < step.length; j++) {
        if (step[j] === 0) continue;
        step[j] = Math.max(minStep[j], step[j] / 2);
        if (step[j] > minStep[j]) allMin = false;
      }
      if (allMin) break;
    }
  }
  return { p, best, iter, evals };
}

function report(name, res, extra) {
  const b = res.best;
  console.log(`\n=== ${name} ===`);
  console.log('params:', res.p.map(v => +v.toPrecision(12)).join(', '), ` (iters ${res.iter})`);
  console.log(`period P = ${b.s.P.toFixed(1)} s = ${(b.s.P / 86400).toFixed(3)} d`);
  console.log(`rotating-frame closure = ${b.missMag.toFixed(1)} km   velocity closure = ${(b.dvClose * 1000).toFixed(2)} m/s`);
  console.log(`Moon-distance min/max over the rev = ${b.rMin.toFixed(0)} / ${b.rMax.toFixed(0)} km`);
  console.log(`inertial seed (Moon frame, ecliptic): r=[${b.st0.r.map(v => +v.toPrecision(13)).join(', ')}]`);
  console.log(`                                      v=[${b.st0.v.map(v => +v.toPrecision(13)).join(', ')}]`);
  // inertial closure (what the gate's pinned-seed check measures)
  const inr = physSub(b.out.stateF.r, b.st0.r);
  console.log(`inertial position closure = ${physMag(inr).toFixed(1)} km`);
  // multi-rev boundedness (3 revs)
  const three = physPropagateSegment(b.st0, 0, 3 * b.s.P, CTX, { maxSamples: 1024, singleFrame: true });
  let mn = Infinity, mx = 0;
  for (const smp of three.samples) { const m = physMag(smp.r); if (m < mn) mn = m; if (m > mx) mx = m; }
  console.log(`3-rev boundedness: min ${mn.toFixed(0)} km / max ${mx.toFixed(0)} km`);
  if (extra) extra(b);
}

const which = (process.argv[2] || 'all').toLowerCase();

// ── CASE 1: true 9:2 NRHO (southern L2 family; P LOCKED to the resonance) ───
// 9:2 synodic resonance: P = 29.530589 d * 2/9 = 6.5624 d = 566,987 s.
// Seed at APOLUNE, not perilune (N2 finding: perilune shooting is hopelessly
// ill-conditioned — the coarse scan collapsed onto a small non-NRHO loop and
// Newton stalled; apolune is where the dynamics are slow and the map is
// gentle). Southern family: apolune plunges below the south pole, displaced
// toward L2. rRot = [xa, 0, -za], vRot = [0, vy, 0]; free [xa, za, vy].
if (which === 'all' || which === 'nrho') {
  const P92 = 29.530589 * 86400 * 2 / 9;
  const build = p => ({ rRot: [p[0], 0, -p[1]], vRot: [0, p[2], 0], P: P92 });
  let seed = null;
  for (const xa of [12000, 15000, 18000, 21000]) {
    for (const za of [66000, 68000, 70000, 72000]) {
      for (let vy = -0.16; vy <= -0.09; vy += 0.005) {
        const c = closure(build, [xa, za, vy]);
        if (c.rMax > 100000 || c.rMin < 1500) continue;
        if (!seed || c.missMag < seed.c.missMag) seed = { p: [xa, za, vy], c };
      }
    }
  }
  console.log(`[nrho] coarse scan best xa=${seed.p[0]} za=${seed.p[1]} vy=${seed.p[2].toFixed(3)} closure=${seed.c.missMag.toFixed(0)} km`);
  const res = patternSearch(build, seed.p, [2000, 2000, 0.01], { tolKm: 25, rMaxCeil: 120000 });
  report('TRUE 9:2 NRHO (nrho-nominal replacement, P locked to 6.5624 d)', res);
}

// ── CASE 2: EML2 southern halo (Gateway-adjacent class) ─────────────────────
// Seed at z-extremum above/below L2: rot r = [x, 0, Az], v = [0, vy, 0].
// Az fixed (family parameter), free [x, vy, P]. CR3BP EML2 halo period ~14.8 d.
if (which === 'all' || which === 'eml2') {
  const L2 = collinearL(0, 'L2');
  console.log(`[eml2] L2 at x=+${L2.x.toFixed(0)} km from Moon (d=${L2.d.toFixed(0)} km)`);
  // z-amplitude FREE (N2 round 2: pinning Az and x-at-L2 over-constrained the
  // search — closure stalled ~10,000 km and rev 3 escaped). Params [x, z, vy, P].
  const build = p => ({ rRot: [p[0], 0, p[1]], vRot: [0, p[2], 0], P: p[3] });
  let seed = null;
  for (const z of [-20000, -30000, -40000]) {
    for (let vy = -0.45; vy <= 0.45; vy += 0.03) {
      for (const P of [12, 13, 14, 15].map(d => d * 86400)) {
        const c = closure(build, [L2.x, z, vy, P]);
        if (!seed || c.missMag < seed.c.missMag) seed = { p: [L2.x, z, vy, P], c };
      }
    }
  }
  console.log(`[eml2] coarse scan best z=${seed.p[1]} vy=${seed.p[2].toFixed(3)} P=${(seed.p[3] / 86400).toFixed(1)}d closure=${seed.c.missMag.toFixed(0)} km`);
  let res = patternSearch(build, seed.p, [3000, 3000, 0.01, 20000], { tolKm: 50, maxIter: 800 });
  // polish pass: restart from the converged point with fine steps (the search
  // exhausts its step ladder before exhausting the basin — a fine restart
  // reliably shaves the remaining hundreds of km)
  res = patternSearch(build, res.p, [200, 200, 5e-4, 1000], { tolKm: 50, maxIter: 800 });
  report('EML2 SOUTHERN HALO (free amplitude)', res);
}

// ── CASE 3: EML1 southern halo ──────────────────────────────────────────────
if (which === 'all' || which === 'eml1') {
  const L1 = collinearL(0, 'L1');
  console.log(`[eml1] L1 at x=${L1.x.toFixed(0)} km from Moon (d=${L1.d.toFixed(0)} km)`);
  // z-amplitude FREE (same round-2 rationale as EML2). Params [x, z, vy, P].
  const build = p => ({ rRot: [p[0], 0, p[1]], vRot: [0, p[2], 0], P: p[3] });
  let seed = null;
  for (const z of [-15000, -25000, -35000]) {
    for (let vy = -0.45; vy <= 0.45; vy += 0.03) {
      for (const P of [10, 11, 12, 13].map(d => d * 86400)) {
        const c = closure(build, [L1.x, z, vy, P]);
        if (!seed || c.missMag < seed.c.missMag) seed = { p: [L1.x, z, vy, P], c };
      }
    }
  }
  console.log(`[eml1] coarse scan best z=${seed.p[1]} vy=${seed.p[2].toFixed(3)} P=${(seed.p[3] / 86400).toFixed(1)}d closure=${seed.c.missMag.toFixed(0)} km`);
  let res = patternSearch(build, seed.p, [3000, 3000, 0.01, 20000], { tolKm: 50, maxIter: 800 });
  res = patternSearch(build, res.p, [200, 200, 5e-4, 1000], { tolKm: 50, maxIter: 800 });
  report('EML1 SOUTHERN HALO (free amplitude)', res);
}

// ── CASE 4: EML1 planar Lyapunov (optional — take it if it converges) ───────
if (which === 'all' || which === 'lyap') {
  const L1 = collinearL(0, 'L1');
  const Ax = 15000; // x-amplitude offset toward the Moon
  const build = p => ({ rRot: [L1.x + Ax, 0, 0], vRot: [0, p[0], 0], P: p[1] });
  let seed = null;
  for (let vy = -0.5; vy <= 0.5; vy += 0.025) {
    for (const P of [10, 11, 12, 13].map(d => d * 86400)) {
      const c = closure(build, [vy, P]);
      if (!seed || c.missMag < seed.c.missMag) seed = { vy, P, c };
    }
  }
  console.log(`[lyap] coarse scan best vy=${seed.vy.toFixed(3)} P=${(seed.P / 86400).toFixed(1)}d closure=${seed.c.missMag.toFixed(0)} km`);
  const res = patternSearch(build, [seed.vy, seed.P], [0.01, 20000], { tolKm: 50 });
  report('EML1 PLANAR LYAPUNOV (Ax=15,000 km)', res);
}

// ── CASE 5: BLT / WSB substrate check (no correction — a measurement) ───────
// Earth departure to a ~1.4M km apogee, ~135-day exterior transfer. Measure
// the Sun's differential effect: propagate WITH ['Earth','Moon','Sun'] vs
// WITHOUT the Sun, compare post-apogee perigee radius and specific energy.
if (which === 'all' || which === 'blt') {
  const rp = 6563; // 185 km alt
  const ra = 1.4e6;
  const a = (rp + ra) / 2;
  const v0 = Math.sqrt(MU_E * (2 / rp - 1 / a));
  const TOF = 135 * 86400;
  console.log(`\n=== BLT / WSB SUBSTRATE (measurement, no solve) ===`);
  console.log(`seed: perigee r=${rp} km, v=${v0.toFixed(4)} km/s, apogee target ${ra} km, TOF ${TOF / 86400} d`);
  const ctxE = { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'] };
  const ctxNoSun = { center: 'Earth', bodies: ['Earth', 'Moon'] };
  for (let k = 0; k < 8; k++) {
    const th = (2 * Math.PI * k) / 8;
    const r0 = [rp * Math.cos(th), rp * Math.sin(th), 0];
    const vv = [-v0 * Math.sin(th), v0 * Math.cos(th), 0];
    const A = physPropagateSegment({ r: r0, v: vv }, 0, TOF, ctxE, { maxSamples: 2048, singleFrame: true, maxSteps: 4e6 });
    const B = physPropagateSegment({ r: r0, v: vv }, 0, TOF, ctxNoSun, { maxSamples: 2048, singleFrame: true, maxSteps: 4e6 });
    const post = res => {
      let mx = 0, mxI = 0;
      res.samples.forEach((s, i) => { const m = physMag(s.r); if (m > mx) { mx = m; mxI = i; } });
      let mn = Infinity;
      for (let i = mxI; i < res.samples.length; i++) { const m = physMag(res.samples[i].r); if (m < mn) mn = m; }
      const vF = physMag(res.stateF.v), rF = physMag(res.stateF.r);
      return { apo: mx, periAfter: mn, energy: vF * vF / 2 - MU_E / rF, tF: res.tF, steps: res.steps };
    };
    const pa = post(A), pb = post(B);
    console.log(`th=${(th * 180 / Math.PI).toFixed(0).padStart(3)}deg  apo=${(pa.apo / 1e6).toFixed(3)}M km` +
      `  periAfter: sun=${pa.periAfter.toFixed(0)} km / noSun=${pb.periAfter.toFixed(0)} km (d=${(pa.periAfter - pb.periAfter).toFixed(0)})` +
      `  E: sun=${pa.energy.toFixed(4)} / noSun=${pb.energy.toFixed(4)} km2/s2` +
      `  tF ok=${pa.tF >= TOF - 1} steps=${pa.steps}`);
  }
}

// ── CASE 6: MISSION_MODEL_V2 §21 B2 — Markellos f16/f'16 reference family ───
// Sun-(Earth+Moon) planar CRTBP SCRATCH dynamics (self-contained: NOT
// physPropagateSegment, NOT the vm-loaded app physics above — this is the
// design-stage-only model RESEARCH_CISLUNAR.md says to keep local to this
// harness). Nondim rotating-frame planar CRTBP (Griesemer NTRS 20090016184,
// Eq. 2), RK4 with a CONTINUOUS state-dependent step (a fraction of the local
// two-body period about the secondary, capped at 2000 s far away — continuous
// in the state, so there is no dt-ladder switching noise and the fixed-model
// FD/bisection below is trustworthy, unlike the app integrator's adaptive
// ladder where FD Jacobians are noise-dominated, MATH.md §7u/§7ah).
//
// Construction (the paper's own, verified against its text): start AT the
// nearest perigee rp on the x-axis, velocity perpendicular at NEAR-ESCAPE
// energy (Jacobi C ~ 3.00085 — "an initial velocity that yields an
// appropriate Jacobi constant"); propagate to the 5th x-axis crossing;
// correct so that crossing is also perpendicular (vx=0). Two perpendicular
// crossings => exactly periodic (Miele/Szebehely symmetry theorem). The
// orbit is a 5-periodic orbit of the second kind: 5 perigees per period,
// p2/p3 raised ~30x by the solar perturbation, p4/p5 mirroring p3/p2.
//
// WHY CONTINUATION (measured, kept as the honest finding): cold-starting the
// vy0 Newton from a bound-ellipse guess at LEO-scale rp collapses onto the
// TRIVIAL near-circular two-body family (no raising) — the f16 root lives
// within ~2e-5 in C of the escape boundary, in a band where most nearby ICs
// never complete 5 crossings. The working method: parametrize by Jacobi C,
// scan a narrow C window for a sign change of vx@5th ON THE FAR BRANCH
// (5th crossing > 1M km — the guard that rejects the trivial family), then
// bisect C to |vx| < ~1e-11 nondim. Each rp seeds the next rp's C window
// (family continuation); every member is FULLY converged.
if (which === 'all' || which === 'f16') {
  const MU_SS = 3.040364489e-6;      // Sun-(Earth+Moon) mass ratio
  const DU_KM = 149598023;           // Sun-EM barycenter distance (~1 AU)
  const YEAR_D = 365.256898;         // sidereal year
  const TU_S = YEAR_D * 86400 / (2 * Math.PI);

  function crtbpAccel(x, y, vx, vy) {
    const r1 = Math.hypot(x + MU_SS, y);
    const r2 = Math.hypot(x - (1 - MU_SS), y);
    const ax = 2 * vy + x - (1 - MU_SS) * (x + MU_SS) / (r1 * r1 * r1) - MU_SS * (x - (1 - MU_SS)) / (r2 * r2 * r2);
    const ay = -2 * vx + y - (1 - MU_SS) * y / (r1 * r1 * r1) - MU_SS * y / (r2 * r2 * r2);
    return [ax, ay];
  }
  function crtbpDeriv(s) { const [x, y, vx, vy] = s; const [ax, ay] = crtbpAccel(x, y, vx, vy); return [vx, vy, ax, ay]; }
  function crtbpRk4(s, dt) {
    const add = (a, b, f) => a.map((v, i) => v + b[i] * f);
    const k1 = crtbpDeriv(s), k2 = crtbpDeriv(add(s, k1, dt / 2));
    const k3 = crtbpDeriv(add(s, k2, dt / 2)), k4 = crtbpDeriv(add(s, k3, dt));
    return s.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  }
  function crtbpR2(s) { return Math.hypot(s[0] - (1 - MU_SS), s[1]); }
  function omega2(x0) { // 2*Omega on the x-axis
    const r1 = Math.abs(x0 + MU_SS), r2 = Math.abs(x0 - (1 - MU_SS));
    return x0 * x0 + 2 * (1 - MU_SS) / r1 + 2 * MU_SS / r2 + MU_SS * (1 - MU_SS);
  }
  function crtbpJacobiC(s) {
    const [x, y, vx, vy] = s;
    const r1 = Math.hypot(x + MU_SS, y), r2 = Math.hypot(x - (1 - MU_SS), y);
    const om = 0.5 * (x * x + y * y) + (1 - MU_SS) / r1 + MU_SS / r2 + 0.5 * MU_SS * (1 - MU_SS);
    return 2 * om - (vx * vx + vy * vy);
  }
  const DT_MAX = 2000 / TU_S, DT_FRAC = 0.002;
  function stepSize(s) {
    const r2 = crtbpR2(s);
    return Math.min(DT_MAX, DT_FRAC * 2 * Math.PI * Math.sqrt(r2 * r2 * r2 / MU_SS));
  }
  function crtbpRun(x0, vy, nWant, collect) {
    let s = [x0, 0, 0, vy], t = 0, steps = 0;
    const crossings = [], extrema = [];
    let rA = crtbpR2(s), rB = null, tPrev = 0;
    while (crossings.length < nWant && t < 4 * 2 * Math.PI) {
      const dt = stepSize(s); const sN = crtbpRk4(s, dt); steps++;
      const rN = crtbpR2(sN);
      if (steps > 1 && ((s[1] < 0) !== (sN[1] < 0))) {
        const frac = s[1] / (s[1] - sN[1]);
        const cs = s.map((v, k) => v + frac * (sN[k] - v));
        crossings.push({ t: t + frac * dt, state: cs, r2: crtbpR2(cs) });
      }
      if (collect && rB !== null) {
        if (rA < rB && rA < rN) extrema.push({ t: tPrev, r2: rA, kind: 'peri' });
        if (rA > rB && rA > rN) extrema.push({ t: tPrev, r2: rA, kind: 'apo' });
      }
      rB = rA; rA = rN; tPrev = t;
      s = sN; t += dt;
    }
    return { crossings, extrema };
  }
  // residual of the perpendicularity condition at the 5th crossing, as a
  // function of Jacobi C on a given branch; the far-branch guard rejects the
  // trivial near-circular family (whose 5th crossing stays near the secondary).
  function residAtC(x0, C, vySign) {
    const v2 = omega2(x0) - C;
    if (v2 <= 0) return null;
    const out = crtbpRun(x0, vySign * Math.sqrt(v2), 5, false);
    if (out.crossings.length < 5) return null;
    return { vx: out.crossings[4].state[2], far: out.crossings[4].r2 * DU_KM > 1e6 };
  }
  function solveMemberByC(rp_km, side, vySign, Cguess) {
    const x0 = (1 - MU_SS) + side * (rp_km / DU_KM);
    const W = 6e-5, ST = 2e-6;
    let prev = null, lo = null, hi = null;
    for (let C = Cguess + W; C >= Cguess - W; C -= ST) {
      const r = residAtC(x0, C, vySign);
      if (r === null || !r.far) { prev = null; continue; }
      if (prev && (prev.vx < 0) !== (r.vx < 0)) { lo = prev.C; hi = C; break; }
      prev = { C, vx: r.vx };
    }
    if (lo === null) return null;
    let flo = residAtC(x0, lo, vySign).vx;
    for (let i = 0; i < 70; i++) {
      const mid = (lo + hi) / 2, rm = residAtC(x0, mid, vySign);
      if (rm === null || !rm.far) { hi = mid; continue; }
      if ((rm.vx < 0) === (flo < 0)) { lo = mid; flo = rm.vx; } else hi = mid;
      if (Math.abs(hi - lo) < 1e-14) break;
    }
    const C = (lo + hi) / 2;
    const vy = vySign * Math.sqrt(omega2(x0) - C);
    const out = crtbpRun(x0, vy, 5, true);
    const peris = out.extrema.filter(e => e.kind === 'peri');
    return {
      rp_km, x0, vy0: vy, jacobiC: crtbpJacobiC([x0, 0, 0, vy]),
      P_days: 2 * out.crossings[4].t * TU_S / 86400,
      farKm: out.crossings[4].r2 * DU_KM,
      vxResid: residAtC(x0, C, vySign).vx,
      p2: peris[0] ? { km: peris[0].r2 * DU_KM, d: peris[0].t * TU_S / 86400 } : null,
      p3: peris[1] ? { km: peris[1].r2 * DU_KM, d: peris[1].t * TU_S / 86400 } : null,
    };
  }

  const rpWalk = [7200, 7000, 6900, 6700, 6563, 7400, 7500]; // anchor first, then continue outward
  console.log("\n=== B2: Markellos f16/f'16 reference family (Sun-(Earth+Moon) planar CRTBP) ===");
  console.log('mu=', MU_SS, ' DU_KM=', DU_KM, ' TU_S=', TU_S.toFixed(1));
  for (const fam of [
    { label: 'f16 (anti-Sun start; reproduces Griesemer Table 1)', side: +1, vySign: +1 },
    { label: "f'16 (Sun-side start; near-mirror)", side: -1, vySign: -1 },
  ]) {
    console.log('\n-- ' + fam.label + ' --');
    let C = 3.000853977; // measured anchor (rp=7200); the scan window finds the branch from here
    for (const rp of rpWalk) {
      const m = solveMemberByC(rp, fam.side, fam.vySign, C);
      if (!m) { console.log('rp=' + rp + ': FAILED (widen the C window)'); continue; }
      C = m.jacobiC;
      console.log('rp=' + rp + '  x0=' + m.x0.toPrecision(12) + '  vy0=' + m.vy0.toPrecision(12) +
        '  C=' + m.jacobiC.toPrecision(11) + '  P=' + m.P_days.toFixed(2) + 'd' +
        '  p2=' + (m.p2 ? m.p2.km.toFixed(0) : '?') + 'km@' + (m.p2 ? m.p2.d.toFixed(1) : '?') + 'd' +
        '  p3=' + (m.p3 ? m.p3.km.toFixed(0) : '?') + 'km@' + (m.p3 ? m.p3.d.toFixed(1) : '?') + 'd' +
        '  raise=' + (m.p2 ? (m.p2.km / rp).toFixed(1) : '?') + 'x' +
        '  far=' + (m.farKm / 1e6).toFixed(3) + 'Mkm  |vx5|=' + Math.abs(m.vxResid).toExponential(1));
    }
  }
  console.log("\nSee src/js/424-blt-reference.js (BLT_F16_FAMILY / BLT_FPRIME16_FAMILY) for the pinned table" +
    ' and docs/MATH.md §7ai for the derivation + verification against the paper.');
}
