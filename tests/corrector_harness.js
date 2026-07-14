// tests/corrector_harness.js
//
// OFFLINE periodicity-corrector harness (MISSION_MODEL_V2 §17 N2) — the
// re-runnable provenance for every `kind:'propagated'` seed pinned in
// src/js/425-reference-orbits.js. NOT run by the build gate (it is a Newton
// search, minutes-scale); the gate only VERIFIES the pinned seeds' closure
// (same escape hatch as Phase 4 U4).
//
// Run:  node tests/corrector_harness.js            (all cases)
//       node tests/corrector_harness.js nrho       (one case: nrho|eml2|eml1|lyap|blt)
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
