// tests/mshoot_wsb_harness.js — MISSION_MODEL_V2 §21 B3.2 WSB-seam variant
//
// OFFLINE (NOT run by the build gate — same status as mshoot_harness.js and
// corrector_harness.js: re-runnable provenance, not a pass/fail assertion).
//
// WHAT THIS IS. The sibling harness `tests/mshoot_harness.js` placed the
// multiple-shooting SEAM (where the forward trunk meets the backward-seeded
// capture leg) 3-18 days from perilune, INSIDE the stiff lunar-encounter
// region, and stalled at ~2.8 km/s aggregate velocity discontinuity smeared
// across the encounter boundaries (an LOI-class implied DSM). Coordinator
// direction (the "WSB-seam lever"): move the seam to the WEAK STABILITY
// BOUNDARY — backward-propagate the capture state THROUGH the L2 neck out to
// apogee (~1M km), place the trunk-vs-backward seam THERE (soft dynamics,
// maximally connective), and free the departure orientation (alpha) so the
// corrector can absorb the Moon's out-of-plane offset.
//
// WHAT IT MEASURES (canonical case, t0 = PROG_DEFAULT_EPOCH_JD, 185 km / 28.5°;
// all numbers from real runs of this file — see MATH.md §7aj B3.2 + critique 117):
//   1. ESCAPE ASSERTION (the physics precondition the lever demands): the mild
//      4,000x50,000 km capture ellipse (KEm -0.091 km^2/s^2), placed in the
//      RETROGRADE sense a few days after the trunk's plane crossing, backward-
//      propagates OUT through the L2 neck to Earth-apogee 1.18-1.41M km
//      (escaped=true). The prograde sense stays bound (<=0.7M km) — so the
//      retrograde mild-capture seed is the genuinely WSB-compatible one, and
//      the trunk's own apogee is ~1.1-1.4M km: the two legs meet in the WSB.
//   2. SEAM-PLACEMENT SWEEP: the corrector's stalled aggregate velocity
//      discontinuity is strongly seam-dependent — 2.6 km/s (tSeam 50 d), 3.4
//      (58 d), 0.56 (65 d, best). Placing the seam at the LATE-apogee approach
//      (~65 d, just before the encounter but out of the stiff region) cuts the
//      implied DSM ~5x vs the encounter seam.
//   3. FREED ALPHA IS DEGENERATE at the anchored near-zero departure
//      inclination (alpha stays ~pi, unused — the same alpha/gamma degeneracy
//      B3.1 critique documents). The plane DOF that matters is departure
//      INCLINATION (beta): seeding beta = 0.05 rad reaches the Moon's z-offset
//      (max|z| 32,196 km ~ Moon's +32k km) and drops the forward (no-DSM)
//      perilune to ~18,700 km — but the arc is still HYPERBOLIC there
//      (KEm +0.66) and the aggregate DSM is UNCHANGED at ~0.56 km/s.
//   4. THE FLOOR IS REAL, NOT SLOW CONVERGENCE: 400 iterations only creep the
//      weighted norm ~194 -> 170 and the aggregate asymptotes to ~0.55 km/s,
//      never toward zero; the zero-DSM forward-propagated trajectory never
//      captures.
//
// VERDICT: BALLISTIC CAPTURE NOT ACHIEVED at the canonical epoch. But the WSB
// seam reduces the measured MINIMUM-IMPULSE connection from ~2.8 km/s (encounter
// seam) to ~0.5 km/s — a SMALL deterministic DSM, i.e. exactly the ispace-style
// small-DSM BLT regime, not the LOI-class dead-end the encounter seam implied.
// 565-physics-blt.js Step 4 (single-shooting + KE polish) stays the shipped path;
// an explicit ~0.5 km/s mid-course-DSM capture option is the honest B4-adjacent
// follow-up. Run:  node tests/mshoot_wsb_harness.js [tPeriDays] [sense] [tSeamDays] [seedBeta]
// (defaults 104.6  -1  65  0.05 = the canonical best config above).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const FILES = [
  'src/js/010-constants.js', 'src/js/140-physics.js',
  'src/js/360-program-module-phase-1-delta-v-engine.js', 'src/js/385-physics-core.js',
  'src/js/386-physics-integrator.js', 'src/js/424-blt-reference.js', 'src/js/425-reference-orbits.js',
  'src/js/565-physics-targeting.js', 'src/js/565-physics-blt.js',
];
const src = FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
const sandbox = { document: { getElementById: () => null }, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'blt-modules.js' });
const g = n => vm.runInContext(n, sandbox);
const physPropagateSegment = g('physPropagateSegment'), physBodyStateAt = g('physBodyStateAt');
const physAdd = g('physAdd'), physSub = g('physSub'), physScale = g('physScale');
const physCross = g('physCross'), physDot = g('physDot'), physMag = g('physMag');
const physAimBurnState = g('physAimBurnState'), physBltSunEarthMoonAngleDeg = g('physBltSunEarthMoonAngleDeg');
const bltF16SelectFamily = g('bltF16SelectFamily'), BLT_F16_FAMILY = g('BLT_F16_FAMILY');
const physBltInterpFamilyMember = g('physBltInterpFamilyMember'), physBltAnchorSeed = g('physBltAnchorSeed');
const physBltStep1 = g('physBltStep1'), physBltFindMoonPlaneCrossing = g('physBltFindMoonPlaneCrossing');
const physBltStep23 = g('physBltStep23');
const PROG_BODIES = g('PROG_BODIES'), physBltKeplerEnergyAtMoon = g('physBltKeplerEnergyAtMoon');
const physBltPeriluneFrom = g('physBltPeriluneFrom');

const TPERI_D = parseFloat(process.argv[2] || '104.6');
const SENSE = parseInt(process.argv[3] || '-1', 10);
const TSEAM_D = parseFloat(process.argv[4] || '65');
const SEED_BETA = parseFloat(process.argv[5] !== undefined ? process.argv[5] : '0.05'); // departure inclination (rad); NaN => use anchor
const MAXIT = parseInt(process.env.MAXIT || '120', 10);

const t0_s = 0, parkKm = PROG_BODIES.Earth.R + 185;

// ---- reproduce the B3.1 trunk (Step 1 + Step 2/3) ----
const angleDeg = physBltSunEarthMoonAngleDeg(t0_s), family = bltF16SelectFamily(angleDeg);
const member = physBltInterpFamilyMember(family, parkKm), familyIsF16 = family === BLT_F16_FAMILY;
const anchor = physBltAnchorSeed(t0_s, parkKm, member, familyIsF16);
const setup = { t0_s, tf_s: null, parkKm, incRad: anchor.inc, theta0: anchor.theta, raan0: anchor.raan, dv0_kms: anchor.dv0_kms, angleDeg, familyIsF16 };
const halfMonthD = 14.75, candSet = {};
for (const off of [100 - halfMonthD, 100, 100 + halfMonthD]) { const c = physBltFindMoonPlaneCrossing(t0_s, off, 8); if (c != null) candSet[Math.round(c)] = c; }
const cands = Object.values(candSet).sort((a, b) => Math.abs(a - 100 * 86400) - Math.abs(b - 100 * 86400));
let s1 = null;
for (const c of cands) {
  setup.tf_s = c;
  const t = physBltStep1(setup, anchor, {});
  if (t.converged) {
    const earth = physBodyStateAt('Earth', c);
    const basis = g('_refRotBasisPair')('Sun', 'Earth', c);
    const moonY = physDot(physSub(physBodyStateAt('Moon', c).r, earth.r), basis.yh);
    if (Math.sign(t.yRot_km) === Math.sign(moonY)) { s1 = t; break; }
  }
}
if (!s1) { console.log('Step1 failed to reproduce trunk'); process.exit(1); }
const tf_s = setup.tf_s;
const s23 = physBltStep23(setup, s1.dv_kms);
if (!s23.converged) { console.log('Step23 failed'); process.exit(1); }
const p0 = s23.params;
console.log('config: tPeri', TPERI_D, 'd  sense', SENSE, '  tSeam', TSEAM_D, 'd  seedBeta', SEED_BETA);
console.log('trunk: dv_TLI', s1.dv_kms.toFixed(4), 'km/s  tf', (tf_s / 86400).toFixed(2), 'd  (raan', p0.raan.toFixed(4), 'inc', p0.inc.toExponential(2), 'theta', p0.theta.toFixed(4), ')');

// ---- propagators (forward + time-reversed backward, both THROUGH physPropagateSegment) ----
function propHelio(rH, vH, ta, tb, center, wantStm) {
  const c0 = physBodyStateAt(center, ta);
  const res = physPropagateSegment({ r: physSub(rH, c0.r), v: physSub(vH, c0.v) }, ta, tb, { center, bodies: ['Earth', 'Moon', 'Sun'] }, { stm: wantStm, singleFrame: true, maxSamples: 24 });
  const cF = physBodyStateAt(center, res.tF);
  return { rF: physAdd(res.stateF.r, cF.r), vF: physAdd(res.stateF.v, cF.v), stmF: res.stmF || null, tF: res.tF, res };
}
function propHelioBack(rH, vH, ta, tb, center) {
  if (!(tb < ta)) throw new Error('propHelioBack expects tb < ta');
  const c0 = physBodyStateAt(center, ta);
  const railRev = (body, t) => { const st = physBodyStateAt(body, -t); return { r: st.r, v: physScale(st.v, -1) }; };
  const res = physPropagateSegment({ r: physSub(rH, c0.r), v: physScale(physSub(vH, c0.v), -1) }, -ta, -tb, { center, bodies: ['Earth', 'Moon', 'Sun'], railFn: railRev }, { singleFrame: true, maxSamples: 24 });
  const tPhys = -res.tF, cF = physBodyStateAt(center, tPhys);
  return { rF: physAdd(res.stateF.r, cF.r), vF: physAdd(physScale(res.stateF.v, -1), cF.v), tF: tPhys, res };
}
function burnDep(dv, gamma, beta, alpha) { const b = physAimBurnState('Earth', parkKm, gamma, 0, dv, beta, 0, alpha); const e = physBodyStateAt('Earth', t0_s); return { r: physAdd(b.r, e.r), v: physAdd(b.v, e.v) }; }

// ---- backward round-trip self-check (guards the time-reversal bookkeeping) ----
{
  const dep = burnDep(p0.dv_kms, p0.theta, p0.inc, p0.raan);
  const a = 20 * 86400, b = 29 * 86400;
  const fwd = propHelio(dep.r, dep.v, a, b, 'Earth', false);
  const back = propHelioBack(fwd.rF, fwd.vF, b, a, 'Earth');
  const dR = physMag(physSub(back.rF, dep.r)), dV = physMag(physSub(back.vF, dep.v));
  console.log('backward round-trip: dR', dR.toFixed(3), 'km  dV', (dV * 1000).toFixed(4), 'm/s');
  if (dR > 100 || dV > 0.01) { console.log('ABORT: backward round-trip failed'); process.exit(1); }
}

// ---- capture state (mild 4000x50000 km ellipse) at tPeri ----
const muM = PROG_BODIES.Moon.mu, periluneKm = 4000, apoluneKm = 50000, aCap = (periluneKm + apoluneKm) / 2;
const vTarget = Math.sqrt(muM * (2 / periluneKm - 1 / aCap)), KE_TARGET = -muM / (2 * aCap);
const tPeri0 = TPERI_D * 86400;
function buildCapture(tPeri) {
  const moon = physBodyStateAt('Moon', tPeri), earth = physBodyStateAt('Earth', tPeri);
  const vHatM = physScale(moon.v, 1 / physMag(moon.v));
  const outward = physSub(moon.r, earth.r), rHat = physScale(outward, 1 / physMag(outward));
  const hHat = physScale(physCross(rHat, vHatM), 1 / physMag(physCross(rHat, vHatM)));
  let vDir = physScale(physCross(hHat, rHat), SENSE); vDir = physScale(vDir, 1 / physMag(vDir));
  return { r: physAdd(moon.r, physScale(rHat, periluneKm)), v: physAdd(moon.v, physScale(vDir, vTarget)) };
}
const cap = buildCapture(tPeri0);
console.log('capture seed: vTarget', vTarget.toFixed(4), 'km/s  KEm', KE_TARGET.toFixed(4), 'km2/s2');

// ---- ESCAPE ASSERTION: backward-propagate the capture state ~55 d and confirm
//      it exits the L2 neck (Earth-apogee > 0.9M km). If it stays bound, THAT is
//      the finding (the capture state is too deeply bound to be WSB-compatible). ----
{
  const bp = propHelioBack(cap.r, cap.v, tPeri0, tPeri0 - 55 * 86400, 'Moon');
  let maxEarthD = 0, tMaxE = 0;
  for (const s of (bp.res.samples || [])) {
    const tPhys = -s.t;
    const helio = physAdd(s.r, physBodyStateAt(s.frame || 'Moon', tPhys).r);
    const d = physMag(physSub(helio, physBodyStateAt('Earth', tPhys).r));
    if (d > maxEarthD) { maxEarthD = d; tMaxE = tPhys; }
  }
  const escaped = maxEarthD > 0.9e6;
  console.log('ESCAPE ASSERTION: backward leg max Earth-dist', (maxEarthD / 1e6).toFixed(3), 'M km @', (tMaxE / 86400).toFixed(1), 'd  escaped=' + escaped);
  if (!escaped) console.log('  (NOTE: this capture seed does NOT escape the neck — a stalled-clean finding in itself; try sense=-1 / a later tPeri.)');
}

// ---- grid: forward trunk t0->tSeam (~9 d), backward leg tSeam->tPeri (~5 d) ----
const tSeam = TSEAM_D * 86400;
const times = [];
const nFwd = Math.max(4, Math.round((tSeam - t0_s) / (9 * 86400)));
for (let i = 0; i < nFwd; i++) times.push(t0_s + (tSeam - t0_s) * i / nFwd);
const nBwd = Math.max(8, Math.round((tPeri0 - tSeam) / (5 * 86400)));
for (let i = 0; i <= nBwd; i++) times.push(tSeam + (tPeri0 - tSeam) * i / nBwd);
const nSeg = times.length - 1, seamIdx = nFwd;
console.log('nSeg', nSeg, ' seam node idx', seamIdx, '(t=', (times[seamIdx] / 86400).toFixed(1), 'd, ~apogee)');
function centerFor(i) { return times[i] >= tf_s - 2 * 86400 ? 'Moon' : 'Earth'; }

// ---- initial guess: forward-chain trunk to seam, backward-chain capture to seam ----
const p0dv = p0.dv_kms, p0g = p0.theta, p0b = Number.isFinite(SEED_BETA) ? SEED_BETA : p0.inc, p0a = p0.raan;
const dep0 = burnDep(p0dv, p0g, p0b, p0a);
const guess = new Array(times.length);
guess[0] = dep0;
for (let i = 0; i < seamIdx; i++) { const p = propHelio(guess[i].r, guess[i].v, times[i], times[i + 1], centerFor(i), false); guess[i + 1] = { r: p.rF, v: p.vF }; }
guess[times.length - 1] = cap;
let bw = { r: cap.r, v: cap.v };
for (let i = times.length - 1; i > seamIdx; i--) { const p = propHelioBack(bw.r, bw.v, times[i], times[i - 1], centerFor(i - 1)); guess[i - 1] = { r: p.rF, v: p.vF }; bw = guess[i - 1]; }
{ const p = propHelio(guess[seamIdx - 1].r, guess[seamIdx - 1].v, times[seamIdx - 1], times[seamIdx], centerFor(seamIdx - 1), false); guess[seamIdx] = { r: p.rF, v: p.vF }; }

// ---- multiple shooting: unknowns = dv,gamma,beta,alpha (4) + interior nodes + tPeri offset ----
const nUnk = 4 + 6 * (nSeg - 1) + 1, nRes = 6 * (nSeg - 1) + 3;
function unpack(x) {
  const nodes = [burnDep(x[0], x[1], x[2], x[3])];
  for (let i = 0; i < nSeg - 1; i++) nodes.push({ r: [x[4 + 6 * i], x[4 + 6 * i + 1], x[4 + 6 * i + 2]], v: [x[4 + 6 * i + 3], x[4 + 6 * i + 4], x[4 + 6 * i + 5]] });
  return { nodes, tPeriVar: tPeri0 + x[nUnk - 1] };
}
const VW = 1000, KEW = 1e4;
function residuals(x, wantJ) {
  const { nodes, tPeriVar } = unpack(x);
  const f = new Array(nRes).fill(0); const stms = [];
  for (let i = 0; i < nSeg - 1; i++) {
    const p = propHelio(nodes[i].r, nodes[i].v, times[i], times[i + 1], centerFor(i), wantJ);
    const rb = 6 * i;
    f[rb] = p.rF[0] - nodes[i + 1].r[0]; f[rb + 1] = p.rF[1] - nodes[i + 1].r[1]; f[rb + 2] = p.rF[2] - nodes[i + 1].r[2];
    f[rb + 3] = p.vF[0] - nodes[i + 1].v[0]; f[rb + 4] = p.vF[1] - nodes[i + 1].v[1]; f[rb + 5] = p.vF[2] - nodes[i + 1].v[2];
    stms.push(p.stmF);
  }
  const pT = propHelio(nodes[nSeg - 1].r, nodes[nSeg - 1].v, times[nSeg - 1], tPeriVar, centerFor(nSeg - 1), wantJ);
  const moonT = physBodyStateAt('Moon', tPeriVar);
  const rRel = physSub(pT.rF, moonT.r), vRel = physSub(pT.vF, moonT.v), rM = physMag(rRel);
  const rowT = 6 * (nSeg - 1);
  f[rowT] = rM - periluneKm; f[rowT + 1] = physDot(rRel, vRel) / rM; f[rowT + 2] = physDot(vRel, vRel) / 2 - muM / rM - KE_TARGET;
  for (let i = 0; i < nSeg - 1; i++) for (let k = 3; k < 6; k++) f[6 * i + k] *= VW;
  f[rowT + 1] *= VW; f[rowT + 2] *= KEW;
  if (!wantJ) return { f };
  const J = []; for (let r = 0; r < nRes; r++) J.push(new Array(nUnk).fill(0));
  const h = [1e-4, 1e-5, 1e-5, 1e-5];
  for (let c = 0; c < 4; c++) { const xp = x.slice(); xp[c] += h[c]; const fp = residuals(xp, false).f; for (let r = 0; r < 6; r++) J[r][c] = (fp[r] - f[r]) / h[c]; }
  { const hT = 600; const xp = x.slice(); xp[nUnk - 1] += hT; const fp = residuals(xp, false).f; for (let r = 0; r < 3; r++) J[6 * (nSeg - 1) + r][nUnk - 1] = (fp[6 * (nSeg - 1) + r] - f[6 * (nSeg - 1) + r]) / hT; }
  const rHat = physScale(rRel, 1 / rM), vr = physDot(rRel, vRel) / rM;
  const gradT = [{ dr: rHat, dvv: [0, 0, 0] }, { dr: physScale(physSub(vRel, physScale(rHat, vr)), 1 / rM), dvv: rHat }, { dr: physScale(rHat, muM / (rM * rM)), dvv: vRel }];
  for (let i = 0; i < nSeg - 1; i++) {
    const cb = 4 + 6 * i, rowsEnd = 6 * i;
    for (let k = 0; k < 6; k++) J[rowsEnd + k][cb + k] += -1;
    if (i + 1 < nSeg - 1) { const rs = 6 * (i + 1), sn = stms[i + 1]; if (sn) for (let r = 0; r < 6; r++) for (let cc = 0; cc < 6; cc++) J[rs + r][cb + cc] += sn[r * 6 + cc]; }
    else { const st = pT.stmF; if (st) for (let gi = 0; gi < 3; gi++) for (let cc = 0; cc < 6; cc++) { let s = 0; for (let rr = 0; rr < 3; rr++) s += gradT[gi].dr[rr] * st[rr * 6 + cc] + gradT[gi].dvv[rr] * st[(rr + 3) * 6 + cc]; J[rowT + gi][cb + cc] += s; } }
  }
  const cLo = 4, cHi = 4 + 6 * (nSeg - 1);
  for (let i = 0; i < nSeg - 1; i++) for (let k = 3; k < 6; k++) { const r = 6 * i + k; for (let c = cLo; c < cHi; c++) J[r][c] *= VW; }
  for (let c = cLo; c < cHi; c++) { J[rowT + 1][c] *= VW; J[rowT + 2][c] *= KEW; }
  return { f, J };
}
function solveLM(J, f, lambda) {
  const n = nUnk; const A = []; for (let i = 0; i < n; i++) A.push(new Array(n).fill(0)); const b = new Array(n).fill(0);
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { let s = 0; for (let r = 0; r < nRes; r++) s += J[r][i] * J[r][j]; A[i][j] = s; } A[i][i] += lambda * (A[i][i] || 1); let s2 = 0; for (let r = 0; r < nRes; r++) s2 += J[r][i] * f[r]; b[i] = -s2; }
  for (let col = 0; col < n; col++) { let piv = col; for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r; if (piv !== col) { [A[col], A[piv]] = [A[piv], A[col]]; [b[col], b[piv]] = [b[piv], b[col]]; } if (Math.abs(A[col][col]) < 1e-20) continue; for (let r = col + 1; r < n; r++) { const m = A[r][col] / A[col][col]; for (let c2 = col; c2 < n; c2++) A[r][c2] -= m * A[col][c2]; b[r] -= m * b[col]; } }
  const dx = new Array(n).fill(0); for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let c2 = r + 1; c2 < n; c2++) s -= A[r][c2] * dx[c2]; dx[r] = Math.abs(A[r][r]) > 1e-20 ? s / A[r][r] : 0; }
  return dx;
}
let x = [p0dv, p0g, p0b, p0a];
for (let i = 1; i < nSeg; i++) x.push(...guess[i].r, ...guess[i].v);
x.push(0);

let { f } = residuals(x, false);
{ // physicality guard + seam report (the mismatch lives at boundary seamIdx,
  // the first backward-leg boundary — seamIdx-1 was forced to chain from the
  // forward side so the discontinuity is fully on the backward node)
  const sb = seamIdx;
  const dRs = Math.hypot(f[6 * sb], f[6 * sb + 1], f[6 * sb + 2]);
  const dVs = Math.hypot(f[6 * sb + 3], f[6 * sb + 4], f[6 * sb + 5]) / 1000;
  console.log('initial SEAM (boundary ' + sb + ', t=' + (times[seamIdx + 1] / 86400).toFixed(1) + 'd): dR', (dRs / 1e3).toFixed(1), 'k km  dV', (dVs * 1000).toFixed(1), 'm/s');
  for (let i = 0; i < nSeg - 1; i++) { const dV = Math.hypot(f[6 * i + 3], f[6 * i + 4], f[6 * i + 5]) / 1000; if (dV > 10) { console.log('ABORT: velocity residual > 10 km/s at boundary ' + i + ' — bookkeeping bug'); process.exit(1); } }
}
let normF = Math.sqrt(f.reduce((s, v) => s + v * v, 0));
console.log('initial residual norm', normF.toExponential(3));

let lambda = 1e-3, best = { x: x.slice(), norm: normF };
for (let iter = 0; iter < MAXIT; iter++) {
  const { f: f1, J } = residuals(x, true); const n1 = Math.sqrt(f1.reduce((s, v) => s + v * v, 0));
  let accepted = false;
  for (let tries = 0; tries < 6; tries++) {
    const dx = solveLM(J, f1, lambda);
    let s = 1;
    s = Math.min(s, 0.01 / Math.max(1e-12, Math.abs(dx[0])));
    s = Math.min(s, 0.05 / Math.max(1e-12, Math.abs(dx[1])));
    s = Math.min(s, 0.20 / Math.max(1e-12, Math.abs(dx[2]))); // beta: wide cap so the plane can tilt
    s = Math.min(s, 0.20 / Math.max(1e-12, Math.abs(dx[3]))); // alpha: wide cap (freed DOF)
    for (let k = 4; k < 4 + 6 * (nSeg - 1); k += 6) { for (let d = 0; d < 3; d++) s = Math.min(s, 3e5 / Math.max(1e-12, Math.abs(dx[k + d]))); for (let d = 3; d < 6; d++) s = Math.min(s, 2 / Math.max(1e-12, Math.abs(dx[k + d]))); }
    s = Math.min(s, 43200 / Math.max(1e-12, Math.abs(dx[nUnk - 1])));
    const xt = x.slice(); for (let k = 0; k < nUnk; k++) xt[k] += s * dx[k];
    const { f: ft } = residuals(xt, false); const nt = Math.sqrt(ft.reduce((s, v) => s + v * v, 0));
    if (nt < n1) { x = xt; lambda = Math.max(lambda * 0.5, 1e-8); accepted = true; break; }
    lambda *= 4;
  }
  const { f: fn } = residuals(x, false); const nn = Math.sqrt(fn.reduce((s, v) => s + v * v, 0));
  if (nn < best.norm) best = { x: x.slice(), norm: nn };
  if (iter % 10 === 0 || iter === MAXIT - 1) console.log('iter', iter, 'norm', nn.toExponential(3), 'lam', lambda.toExponential(2), accepted ? '' : '(noimp)');
  if (nn < 1e-2) break;
}
x = best.x;
const fr = residuals(x, false).f;
let maxPos = 0, maxVel = 0, aggVel = 0;
for (let i = 0; i < nSeg - 1; i++) { for (let k = 0; k < 3; k++) maxPos = Math.max(maxPos, Math.abs(fr[6 * i + k])); let dv = 0; for (let k = 3; k < 6; k++) { const c = Math.abs(fr[6 * i + k]) / 1000; maxVel = Math.max(maxVel, c); dv += c * c; } aggVel += Math.sqrt(dv); }
console.log('=== FINAL weighted norm', best.norm.toExponential(3), ' maxPos', maxPos.toFixed(2), 'km  maxVel', maxVel.toFixed(5), 'km/s');
console.log('    aggregate velocity discontinuity (implied DSM)', aggVel.toFixed(4), 'km/s');
console.log('    terminal perilune cond: dR', fr[6 * (nSeg - 1)].toFixed(2), 'km  vr', fr[6 * (nSeg - 1) + 1].toFixed(2), 'm/s  dKEm', (fr[6 * (nSeg - 1) + 2] / 1e4).toFixed(5));
console.log('    final dv,gamma,beta,alpha', x[0].toFixed(4), x[1].toFixed(4), x[2].toFixed(5), x[3].toFixed(4), ' tPeri offset', (x[nUnk - 1] / 86400).toFixed(3), 'd');

// ---- forward-propagate the converged departure end-to-end (NO DSM): the honest
//      ballistic result. If this captures (KEm<0), it is real ballistic capture. ----
const { nodes, tPeriVar } = unpack(x);
const e0 = physBodyStateAt('Earth', t0_s);
const fullRes = physPropagateSegment({ r: physSub(nodes[0].r, e0.r), v: physSub(nodes[0].v, e0.v) }, t0_s, tPeriVar + 2 * 86400, { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'] }, { singleFrame: true, maxSamples: 600 });
let apogee = 0, maxZ = 0;
for (const s of fullRes.samples) { const helio = physAdd(s.r, physBodyStateAt('Earth', s.t).r); const d = physMag(s.r); if (d > apogee) apogee = d; if (Math.abs(helio[2]) > Math.abs(maxZ)) maxZ = helio[2]; }
console.log('ZERO-DSM forward arc: apogee', (apogee / 1e6).toFixed(3), 'M km  max|z|', Math.abs(maxZ).toFixed(0), 'km');
const peri1 = physBltPeriluneFrom(fullRes.stateF, fullRes.frame, fullRes.tF, 25 * 86400);
console.log('ZERO-DSM forward perilune:', peri1 ? { rMag_km: peri1.rMag_km.toFixed(0), KEm: peri1.KEm.toFixed(4), captured: peri1.KEm < 0 } : null);
console.log('VERDICT:', (peri1 && peri1.KEm < 0 && aggVel < 0.001) ? 'BALLISTIC CAPTURE' : 'NOT ballistic — implied DSM ' + aggVel.toFixed(3) + ' km/s (small-DSM BLT regime); single-shooting Step 4 stays shipped.');
