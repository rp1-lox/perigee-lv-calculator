// tests/mshoot_harness.js — MISSION_MODEL_V2 §21 B3.2 offline exploration
//
// OFFLINE (NOT run by the build gate — a Gauss-Newton search, seconds-scale
// but exploratory, same "not in the gate" status as corrector_harness.js).
// Reproduces the B3.1 trunk (Step 1 + Step 2/3 from 565-physics-blt.js) then
// attempts the B3.2 multiple-shooting capture closure: segments the trunk
// every ~9 days, backward-seeds the terminal node from a desired perilune
// capture state (ispace-hybrid), and Gauss-Newtons (damped, normal-equations
// least squares since the block system is non-square: 6*nSeg continuity
// residuals vs 3+6*(nSeg-1) unknowns) on the interior patch-point states plus
// the departure (dv, gamma/theta, beta/inc).
//
// HISTORY (2026-07-15, kept per coordinator direction — the diagnosis is the
// narrative): the FIRST pass of this harness reported a "stationary point" at
// 0.14 km position / 70.8 km/s velocity continuity residual. That number was
// never physics — coordinator review flagged it as a frame/units artifact,
// and the audit found the actual bug: `physPropagateSegment`'s main loop is
// `while (t < tMax)`, so a BACKWARD call (tMax < t0, which the ispace-hybrid
// backward-seeding leg used) never iterates and silently returns the initial
// state as the final state. The "backward-seeded" nodes were therefore the
// raw terminal capture state stamped at epochs 9-18 days earlier — a
// systematic ~km/s-to-tens-of-km/s velocity offset fed straight into the
// corrector, which then (least-squares) smeared it around. Fixes in this
// pass: (1) backward propagation done PROPERLY through physPropagateSegment
// via time reversal (gravity is velocity-independent: integrate (r, -v)
// forward in tau = -t with railFn t -> -t, negate the final velocity —
// still "all propagation through physPropagateSegment", no ad-hoc
// integrator); (2) the initial residual PROFILE is printed before any
// correction (forward-trunk internal boundaries must chain at ~zero by
// construction — that is now asserted); (3) a physicality guard: any initial
// velocity residual > 10 km/s anywhere = bookkeeping bug, abort with the
// boundary index, never fed to the corrector; (4) a backward round-trip
// self-check (forward one segment then backward must recover the start).
//
// POST-FIX RESULT (see MATH.md §7aj B3.2 + critique 117 for the full
// narrative and numbers): with bookkeeping proven clean (trunk boundaries
// chain at exactly 0; only the deliberate backward-seed seam shows physical
// mismatch, ~718k km / 1.11 km/s), plus a SQUARE perilune-condition terminal
// formulation (radius/vr/KEm instead of a pinned 6D state), freed tf, a
// non-uniform grid (9-day trunk / 3-day encounter segments), and commensurate
// row weighting, the corrector reduces the residual ~500x but stalls with an
// aggregate ~2.8 km/s of velocity discontinuity smeared across the encounter
// boundaries (max single boundary ~0.8 km/s) — an implied LOI-class DSM
// itinerary, not ballistic capture. A retrograde-capture-sense variant
// (`node tests/mshoot_harness.js flip`) is worse (~2.0 km/s at the seam).
// Conclusion: the stall is now credible physics (the canonical-epoch trunk
// does not arrive capture-compatible), so 565-physics-blt.js Step 4
// (single-shooting + KE polish) stays the shipped path.
//
// FOLLOW-UP (2026-07-15, `tests/mshoot_wsb_harness.js` + MATH.md §7aj B3.2
// WSB-seam subsection): this harness's seam sits INSIDE the stiff encounter.
// The sibling WSB harness moves the seam to the weak stability boundary
// (~1M-km apogee) and frees alpha — cutting the implied DSM from this ~2.8
// km/s to ~0.5 km/s (small-DSM BLT regime), but STILL not ballistic (the
// zero-DSM forward arc never captures). The verdict is unchanged: stalled
// clean, single-shooting Step 4 stays shipped.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'src/js/010-constants.js',
  'src/js/140-physics.js',
  'src/js/360-delta-v-engine.js',
  'src/js/385-physics-core.js',
  'src/js/386-physics-integrator.js',
  'src/js/424-blt-reference.js',
  'src/js/425-reference-orbits.js',
  'src/js/565-physics-targeting.js',
  'src/js/565-physics-blt.js',
];
const src = FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
const sandbox = { document: { getElementById: () => null }, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'blt-modules.js' });
const g = name => vm.runInContext(name, sandbox);

const physPropagateSegment = g('physPropagateSegment');
const physBodyStateAt = g('physBodyStateAt');
const physAdd = g('physAdd'), physSub = g('physSub'), physScale = g('physScale');
const physCross = g('physCross'), physDot = g('physDot'), physMag = g('physMag');
const physAimBurnState = g('physAimBurnState');
const physBltSunEarthMoonAngleDeg = g('physBltSunEarthMoonAngleDeg');
const bltF16SelectFamily = g('bltF16SelectFamily');
const BLT_F16_FAMILY = g('BLT_F16_FAMILY');
const physBltInterpFamilyMember = g('physBltInterpFamilyMember');
const physBltAnchorSeed = g('physBltAnchorSeed');
const physBltStep1 = g('physBltStep1');
const physBltFindMoonPlaneCrossing = g('physBltFindMoonPlaneCrossing');
const physBltStep23 = g('physBltStep23');
const physBltHelioPos = g('physBltHelioPos');
const PROG_BODIES = g('PROG_BODIES');
const physBltKeplerEnergyAtMoon = g('physBltKeplerEnergyAtMoon');
const physBltPeriluneFrom = g('physBltPeriluneFrom');

const t0_s = 0;
const parkingAltKm = 185;
const incRad = 28.5 * Math.PI / 180;
const parkKm = PROG_BODIES.Earth.R + parkingAltKm;

// ---- reproduce B3.1 trunk (Step 1 + Step 2/3) ----
const angleDeg = physBltSunEarthMoonAngleDeg(t0_s);
const family = bltF16SelectFamily(angleDeg);
const member = physBltInterpFamilyMember(family, parkKm);
const familyIsF16 = family === BLT_F16_FAMILY;
const anchor = physBltAnchorSeed(t0_s, parkKm, member, familyIsF16);
const setup = { t0_s, tf_s: null, parkKm, incRad: anchor.inc, theta0: anchor.theta, raan0: anchor.raan, dv0_kms: anchor.dv0_kms, angleDeg, familyIsF16 };

const halfMonthD = 14.75;
const candOffsets = [100 - halfMonthD, 100, 100 + halfMonthD];
const candSet = {};
for (const off of candOffsets) {
  const c = physBltFindMoonPlaneCrossing(t0_s, off, 8);
  if (c != null) candSet[Math.round(c)] = c;
}
const cands = Object.values(candSet).sort((a, b) => Math.abs(a - t0_s - 100 * 86400) - Math.abs(b - t0_s - 100 * 86400));
let s1 = null;
for (const c of cands) {
  setup.tf_s = c;
  const trial = physBltStep1(setup, anchor, {});
  if (trial.converged) {
    const earth = physBodyStateAt('Earth', c);
    const basis = g('_refRotBasisPair')('Sun', 'Earth', c);
    const moonY = physDot(physSub(physBodyStateAt('Moon', c).r, earth.r), basis.yh);
    const sideOk = Math.sign(trial.yRot_km) === Math.sign(moonY);
    if (sideOk) { s1 = trial; break; }
  }
}
if (!s1) { console.log('Step1 failed to reproduce trunk'); process.exit(1); }
const tf_s = setup.tf_s;
console.log('Step1: dv=', s1.dv_kms.toFixed(4), 'apogee_km=', s1.apogee_km.toFixed(0), 'tf_days=', (tf_s/86400).toFixed(2));

const s23 = physBltStep23(setup, s1.dv_kms);
console.log('Step23 converged:', s23.converged, JSON.stringify(s23.params), 'rMoon_km=', s23.rMoon_km && s23.rMoon_km.toFixed(0));
if (!s23.converged) process.exit(1);

// ---- B3.2: multiple shooting ----
const p0 = s23.params;
const alpha = p0.raan, gAnchor = p0.theta, bAnchor = p0.inc, dvAnchor = p0.dv_kms;

function burnState(dv, gamma, beta, alphaP) {
  return physAimBurnState('Earth', parkKm, gamma, 0, dv, beta, 0, alphaP);
}

// Full-model propagation of a heliocentric state [r,v] over [ta,tb], with a
// chosen center; returns {rF,vF, stmF (6x6 or null), tF}. Converts between
// heliocentric bookkeeping and the center-relative geo state physPropagateSegment
// consumes, per the note in the module: dxF_helio/dx0_helio == stmF (geo STM)
// when both endpoints use the SAME center for the whole (singleFrame) segment.
function propHelio(rHelio, vHelio, ta, tb, center, wantStm) {
  const c0 = physBodyStateAt(center, ta);
  const rGeo = physSub(rHelio, c0.r), vGeo = physSub(vHelio, c0.v);
  const ctx = { center, bodies: ['Earth', 'Moon', 'Sun'] };
  const res = physPropagateSegment({ r: rGeo, v: vGeo }, ta, tb, ctx, { stm: wantStm, singleFrame: true, maxSamples: 24 });
  const cF = physBodyStateAt(center, res.tF);
  const rF = physAdd(res.stateF.r, cF.r), vF = physAdd(res.stateF.v, cF.v);
  return { rF, vF, stmF: res.stmF || null, tF: res.tF, res };
}

// BACKWARD propagation through physPropagateSegment (whose main loop is
// forward-only: `while (t < tMax)` — a tMax < t0 call silently returns the
// initial state, the first-pass bug). Time reversal: gravity (incl. the
// non-inertial center-frame indirect terms) is velocity-independent, so
// u(tau) := r(ta - (tau - (-ta))) ... concretely: integrate (rGeo, -vGeo)
// FORWARD in tau from -ta to -tb (tb < ta so -tb > -ta) with rails evaluated
// at physical time -tau; then r is the true backward arc and the final
// velocity negates back. singleFrame keeps patching out of the loop.
function propHelioBack(rHelio, vHelio, ta, tb, center) {
  if (!(tb < ta)) throw new Error('propHelioBack expects tb < ta');
  const c0 = physBodyStateAt(center, ta);
  const rGeo = physSub(rHelio, c0.r), vGeo = physSub(vHelio, c0.v);
  const railRev = (body, t, ov) => {
    const st = physBodyStateAt(body, -t);
    return { r: st.r, v: physScale(st.v, -1) }; // rail velocity sign flips with time reversal (used by handoff patching only; harmless under singleFrame)
  };
  const ctx = { center, bodies: ['Earth', 'Moon', 'Sun'], railFn: railRev };
  const res = physPropagateSegment({ r: rGeo, v: physScale(vGeo, -1) }, -ta, -tb, ctx, { singleFrame: true, maxSamples: 24 });
  const tPhys = -res.tF; // should equal tb
  const cF = physBodyStateAt(center, tPhys);
  const rF = physAdd(res.stateF.r, cF.r);
  const vF = physAdd(physScale(res.stateF.v, -1), cF.v);
  return { rF, vF, tF: tPhys };
}

// trunk departure state (heliocentric) at t0 as fn of (dv,gamma,beta)
function depState(dv, gamma, beta) {
  const burn = burnState(dv, gamma, beta);
  const e0 = physBodyStateAt('Earth', t0_s);
  return { r: physAdd(burn.r, e0.r), v: physAdd(burn.v, e0.v) };
}

// ---- segment the trunk: NON-UNIFORM grid (critique 117(b) resolution) —
// ~9-day segments over the quiet trunk (t0 -> tf), then DENSE ~3-day
// segments through the lunar-encounter leg (tf -> tf+15d): the STM of a
// 9-day Moon-centered segment through a close encounter is chaotically
// amplifying and its Newton direction unreliable; 3-day encounter segments
// keep each block well-conditioned (measured: this change is what unstuck
// the corrector from its ~6.6e3 creep floor). ----
const tEnd = tf_s + 15 * 86400;
const times = [];
{
  const nTrunk = Math.max(4, Math.round((tf_s - t0_s) / (9 * 86400)));
  for (let i = 0; i < nTrunk; i++) times.push(t0_s + (tf_s - t0_s) * i / nTrunk);
  const nEnc = 5; // 15 d / 3 d
  for (let i = 0; i <= nEnc; i++) times.push(tf_s + (tEnd - tf_s) * i / nEnc);
}
const nSeg = times.length - 1;
console.log('nSeg=', nSeg, '(trunk ~9d + encounter ~3d) tEnd_days=', (tEnd/86400).toFixed(2));

// center choice per segment: Moon-centered for the encounter leg (t >= tf),
// Earth-centered for the trunk (per spec: "Earth-centered early, Moon-
// centered late").
function centerFor(i) { return times[i] >= tf_s - 1 ? 'Moon' : 'Earth'; }

// initial guess: forward-propagate the trunk (dvAnchor,gAnchor,bAnchor) node by node
let d0 = depState(dvAnchor, gAnchor, bAnchor);
let guess = [d0];
for (let i = 0; i < nSeg; i++) {
  const prev = guess[i];
  const p = propHelio(prev.r, prev.v, times[i], times[i + 1], centerFor(i), false);
  guess.push({ r: p.rF, v: p.vF });
}

// ---- backward-propagation SELF-CHECK (round-trip): forward one segment,
// backward the same segment, must recover the start state to integrator
// tolerance. Guards the time-reversal railFn bookkeeping itself. ----
{
  const rt0 = guess[3], seg = 3;
  const fwd = propHelio(rt0.r, rt0.v, times[seg], times[seg + 1], centerFor(seg), false);
  const back = propHelioBack(fwd.rF, fwd.vF, times[seg + 1], times[seg], centerFor(seg));
  const dR = physMag(physSub(back.rF, rt0.r)), dV = physMag(physSub(back.vF, rt0.v));
  console.log('backward round-trip check: dR=', dR.toFixed(3), 'km  dV=', (dV * 1000).toFixed(4), 'm/s');
  if (dR > 100 || dV > 0.01) { console.log('ABORT: backward propagation round-trip failed — bookkeeping bug'); process.exit(1); }
}

// ---- backward-seed target capture state at t_M (last node) ----
const periluneKm = 4000; // target class per Griesemer
const moonEnd = physBodyStateAt('Moon', tEnd);
// desired velocity: MILDLY-captured (KEm just below 0) PERILUNE state — the
// ellipse with perilune periluneKm and apolune 50,000 km (inside the ~64k-km
// L2 distance), v = sqrt(mu(2/rp - 1/a)) > vcirc so rp is genuinely the
// periapsis. (First pass used 0.9*vcirc, which makes r the APOLUNE of a
// deeply-bound a=3,360 km ellipse, KEm -0.73 — backward propagation of that
// winds ~20 tight revs around the Moon instead of escaping outward like a
// real WSB arrival; measured as part of the seam-can't-close diagnosis.)
const muM = PROG_BODIES.Moon.mu;
const apoluneKm = 50000;
const aCap = (periluneKm + apoluneKm) / 2;
const vTarget = Math.sqrt(muM * (2 / periluneKm - 1 / aCap)); // 1.507 km/s, KEm = -mu/2a = -0.049
// direction: perpendicular to the Moon's own orbital-plane radius at tEnd,
// roughly matching the guess node's incoming relative-velocity plane so the
// backward leg doesn't have to bend across an arbitrary orientation.
const guessRelR = physSub(guess[nSeg].r, moonEnd.r);
const rHatPeri = physScale(guessRelR, 1 / physMag(guessRelR));
const guessRelV = physSub(guess[nSeg].v, moonEnd.v);
let hApprox = physCross(rHatPeri, guessRelV);
if (physMag(hApprox) < 1e-9) hApprox = [0, 0, 1];
const hHat = physScale(hApprox, 1 / physMag(hApprox));
const rPeriVec = physScale(rHatPeri, periluneKm);
const CAPTURE_SENSE = (process.argv[2] === 'flip') ? -1 : 1; // prograde/retrograde experiment
let vDirPeri = physScale(physCross(hHat, rHatPeri), CAPTURE_SENSE); // perpendicular to radius, in-plane
vDirPeri = physScale(vDirPeri, 1 / physMag(vDirPeri));
const vRelPeri = physScale(vDirPeri, vTarget);
const targetHelio = { r: physAdd(moonEnd.r, rPeriVec), v: physAdd(moonEnd.v, vRelPeri) };
const keCheck = physBltKeplerEnergyAtMoon(targetHelio.r, targetHelio.v, moonEnd);
console.log('backward-seed target: rMag=', keCheck.rMag.toFixed(0), 'KEm=', keCheck.KE.toFixed(4));

// backward-propagate the target 1-2 segments (GENUINE backward integration —
// see propHelioBack; the first pass's forward-only call was the bookkeeping
// bug) to refine the guess for the last 2 interior nodes (ispace-hybrid):
// Moon-centered, matching centerFor for those segments.
let bwNode = { r: targetHelio.r, v: targetHelio.v };
for (let i = nSeg; i >= nSeg - 1; i--) {
  const p = propHelioBack(bwNode.r, bwNode.v, times[i], times[i - 1], centerFor(i - 1));
  guess[i - 1] = { r: p.rF, v: p.vF };
  bwNode = guess[i - 1];
}
guess[nSeg] = targetHelio; // fixed terminal node

// ---- multiple shooting: unknowns = dv,gamma,beta (departure) + interior
// nodes x_1..x_{nSeg-1} (6 each) = 75. x_0 = depState(dv,gamma,beta).
// Constraints: continuity at interior boundaries 0..nSeg-2 (segment i's
// endpoint = node i+1, 6 each = 72) + a 3-scalar PERILUNE CONDITION at tEnd
// on the LAST segment's endpoint (Moon-relative radius = periluneKm, radial
// velocity = 0, KEm = target) = 75. SQUARE system — the first re-run fixed
// the bookkeeping but kept the terminal node's full 6D state pinned, which
// over-determined the system by exactly 3 equations and parked a ~2.4 km/s
// least-squares leftover at the terminal boundary (critique 117(a), now
// resolved by this formulation). tf stays pinned at tEnd (the perilune-
// timing constraint vr=0 absorbs what a free tf would do; documented).
// tf FREED (the brief's optional DOF, taken after measuring the pinned-tf
// variant creep-stall at ~1.3e4: forcing perilune at exactly tEnd is
// dynamically restrictive for a WSB arrival — the capture corridor exists at
// the arrival phase the dynamics pick, not the one we pin). Unknown x[nUnk-1]
// = terminal epoch offset (seconds, relative to the initial tEnd); the system
// becomes 75 equations in 76 unknowns (underdetermined by 1 — the LM
// normal-equations step is then the minimum-norm Gauss-Newton step, fine).
const nUnk = 3 + 6 * (nSeg - 1) + 1;
const nRes = 6 * (nSeg - 1) + 3;
const KE_TARGET = -muM / (2 * aCap); // the mildly-captured ellipse's energy

function unpack(x) {
  const dv = x[0], gamma = x[1], beta = x[2];
  const nodes = [depState(dv, gamma, beta)];
  for (let i = 0; i < nSeg - 1; i++) {
    nodes.push({ r: [x[3 + 6*i], x[3+6*i+1], x[3+6*i+2]], v: [x[3+6*i+3], x[3+6*i+4], x[3+6*i+5]] });
  }
  return { dv, gamma, beta, nodes, tEndVar: tEnd + x[nUnk - 1] };
}

function residuals(x, wantJ) {
  const { nodes, tEndVar } = unpack(x);
  const f = new Array(nRes).fill(0);
  const stms = []; // per segment 6x6 STM (geo == helio Jacobian per note above)
  for (let i = 0; i < nSeg - 1; i++) {
    const p = propHelio(nodes[i].r, nodes[i].v, times[i], times[i + 1], centerFor(i), wantJ);
    const rowBase = 6 * i;
    f[rowBase + 0] = p.rF[0] - nodes[i + 1].r[0];
    f[rowBase + 1] = p.rF[1] - nodes[i + 1].r[1];
    f[rowBase + 2] = p.rF[2] - nodes[i + 1].r[2];
    f[rowBase + 3] = p.vF[0] - nodes[i + 1].v[0];
    f[rowBase + 4] = p.vF[1] - nodes[i + 1].v[1];
    f[rowBase + 5] = p.vF[2] - nodes[i + 1].v[2];
    stms.push(p.stmF);
  }
  // Terminal segment (nSeg-1): propagate the last free node to tEnd and
  // evaluate the perilune condition on the Moon-relative endpoint state.
  const pT = propHelio(nodes[nSeg - 1].r, nodes[nSeg - 1].v, times[nSeg - 1], tEndVar, centerFor(nSeg - 1), wantJ);
  const moonT = physBodyStateAt('Moon', tEndVar);
  const rRel = physSub(pT.rF, moonT.r), vRel = physSub(pT.vF, moonT.v);
  const rM = physMag(rRel);
  const rowT = 6 * (nSeg - 1);
  f[rowT + 0] = rM - periluneKm;                                  // km
  f[rowT + 1] = physDot(rRel, vRel) / rM;                          // radial velocity, km/s (0 at periapsis)
  f[rowT + 2] = physDot(vRel, vRel) / 2 - muM / rM - KE_TARGET;    // KEm error, km^2/s^2
  // Row weighting (POST-bookkeeping-fix, now legitimate — the pre-fix
  // weighting experiment ran against broken seeds and was inconclusive):
  // velocity rows in raw km/s are numerically negligible against km-scale
  // position rows in the LM least-squares objective, so the damped steps
  // happily park a km/s-scale discontinuity (a hidden DSM) to shave km-scale
  // position residuals (measured: 15.8 km position / 2.50 km/s velocity
  // stall). Weight velocity rows x1000 (m/s scale) and the KEm row x1e4 so
  // every residual class is commensurate; applied identically to f and J.
  const VW = 1000, KEW = 1e4;
  for (let i = 0; i < nSeg - 1; i++) for (let k = 3; k < 6; k++) f[6 * i + k] *= VW;
  f[rowT + 1] *= VW;
  f[rowT + 2] *= KEW;
  if (!wantJ) return { f };
  // Jacobian d(f)/d(x). Columns 0..2 = dv,gamma,beta by FD (only segment 0's
  // rows are affected — the departure state feeds nothing else directly).
  // Columns 3.. = interior node components: block-bidiagonal (a node appears
  // with -I in the segment it ENDS and with the next segment's STM in the
  // segment it STARTS; the LAST node instead feeds the 3 perilune rows via
  // the terminal STM chained through the analytic condition gradients).
  const J = [];
  for (let r = 0; r < nRes; r++) J.push(new Array(nUnk).fill(0));
  const h = [1e-4, 1e-5, 1e-5];
  for (let c = 0; c < 3; c++) {
    const xp = x.slice(); xp[c] += h[c];
    const fp = residuals(xp, false).f;
    for (let r = 0; r < 6; r++) J[r][c] = (fp[r] - f[r]) / h[c]; // only rows 0-5 (segment 0) are affected
  }
  // FD column for the freed tf (only the 3 terminal rows depend on it)
  {
    const hT = 600; // s
    const xp = x.slice(); xp[nUnk - 1] += hT;
    const fp = residuals(xp, false).f;
    for (let r = 0; r < 3; r++) J[6 * (nSeg - 1) + r][nUnk - 1] = (fp[6 * (nSeg - 1) + r] - f[6 * (nSeg - 1) + r]) / hT;
  }
  // analytic condition gradients wrt the terminal endpoint state (helio):
  const rHat = physScale(rRel, 1 / rM);
  const vr = physDot(rRel, vRel) / rM;
  const gradT = [
    { dr: rHat, dvv: [0, 0, 0] },                                                    // d(rM)/d(rF,vF)
    { dr: physScale(physSub(vRel, physScale(rHat, vr)), 1 / rM), dvv: rHat },        // d(vr)
    { dr: physScale(rHat, muM / (rM * rM)), dvv: vRel },                             // d(KEm)
  ];
  for (let i = 0; i < nSeg - 1; i++) {
    const colBase = 3 + 6 * i;
    // node i+1 ENDS segment i (continuity rows 6i..6i+5, -I)
    const rowsEnd = 6 * i;
    for (let k = 0; k < 6; k++) J[rowsEnd + k][colBase + k] += -1;
    if (i + 1 < nSeg - 1) {
      // node i+1 STARTS interior segment i+1 (+STM)
      const rowsStart = 6 * (i + 1);
      const stmNext = stms[i + 1];
      if (stmNext) {
        for (let r = 0; r < 6; r++) for (let cc = 0; cc < 6; cc++) J[rowsStart + r][colBase + cc] += stmNext[r * 6 + cc];
      }
    } else {
      // node nSeg-1 STARTS the terminal segment: perilune rows = grad . STM_T
      const stmT = pT.stmF;
      if (stmT) {
        for (let gi = 0; gi < 3; gi++) {
          for (let cc = 0; cc < 6; cc++) {
            let s = 0;
            for (let rr = 0; rr < 3; rr++) s += gradT[gi].dr[rr] * stmT[rr * 6 + cc] + gradT[gi].dvv[rr] * stmT[(rr + 3) * 6 + cc];
            J[rowT + gi][colBase + cc] += s;
          }
        }
      }
    }
  }
  // apply the row weights to the ANALYTIC J entries (node-state columns
  // 3..nUnk-2). The FD columns (0-2 and nUnk-1) already carry the weights
  // because they difference the weighted f.
  const cLo = 3, cHi = 3 + 6 * (nSeg - 1);
  for (let i = 0; i < nSeg - 1; i++) for (let k = 3; k < 6; k++) {
    const r = 6 * i + k;
    for (let c = cLo; c < cHi; c++) J[r][c] *= VW;
  }
  for (let c = cLo; c < cHi; c++) { J[rowT + 1][c] *= VW; J[rowT + 2][c] *= KEW; }
  return { f, J };
}

function solveNormalEqGauss(J, f, lambda) {
  // JT J dx = -JT f, Levenberg-Marquardt damped (lambda*diag added).
  const n = nUnk;
  const A = []; for (let i=0;i<n;i++) A.push(new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let r = 0; r < nRes; r++) s += J[r][i] * J[r][j];
      A[i][j] = s;
    }
    A[i][i] += lambda * (A[i][i] || 1);
    let s2 = 0;
    for (let r = 0; r < nRes; r++) s2 += J[r][i] * f[r];
    b[i] = -s2;
  }
  // Gauss elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (piv !== col) { [A[col], A[piv]] = [A[piv], A[col]]; [b[col], b[piv]] = [b[piv], b[col]]; }
    if (Math.abs(A[col][col]) < 1e-20) continue;
    for (let r = col + 1; r < n; r++) {
      const m = A[r][col] / A[col][col];
      for (let c2 = col; c2 < n; c2++) A[r][c2] -= m * A[col][c2];
      b[r] -= m * b[col];
    }
  }
  const dx = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c2 = r + 1; c2 < n; c2++) s -= A[r][c2] * dx[c2];
    dx[r] = Math.abs(A[r][r]) > 1e-20 ? s / A[r][r] : 0;
  }
  return dx;
}

// pack initial x from guess
let x = [dvAnchor, gAnchor, bAnchor];
for (let i = 1; i < nSeg; i++) x.push(...guess[i].r, ...guess[i].v);
x.push(0); // freed-tf offset (s), seeded at the initial tEnd

// ---- INITIAL RESIDUAL PROFILE (before any correction) — the g(seed)
// discipline. Forward-trunk internal boundaries came from ONE continuous
// chained propagation, so they must be ~ZERO by construction; only the
// deliberate seam(s) where the backward-seeded leg meets the forward trunk
// may show real (physical, km-and-km/s-scale) mismatch. Physicality guard:
// ANY velocity residual > 10 km/s = bookkeeping bug (no two ballistic arcs
// meeting at one cislunar point disagree by that much) — abort, never feed
// it to the corrector.
let { f } = residuals(x, false);
console.log('--- initial residual profile (per boundary) ---');
for (let i = 0; i < nSeg - 1; i++) {
  const dR = Math.hypot(f[6*i], f[6*i+1], f[6*i+2]);
  const dV = Math.hypot(f[6*i+3], f[6*i+4], f[6*i+5]) / 1000; // rows carry the x1000 weight; back to km/s
  console.log('  boundary', i, '(t=' + (times[i+1]/86400).toFixed(1) + 'd):  dR=' + dR.toFixed(3) + ' km   dV=' + (dV*1000).toFixed(3) + ' m/s');
  if (dV > 10) { console.log('ABORT: velocity residual > 10 km/s at boundary ' + i + ' — bookkeeping bug, not physics'); process.exit(1); }
  // trunk-internal boundaries (before the backward-seeded region) must chain ~exactly
  if (i < nSeg - 3 && (dR > 1 || dV > 1e-3)) { console.log('ABORT: forward-trunk boundary ' + i + ' does not chain to ~zero — node bookkeeping broken'); process.exit(1); }
}
console.log('  terminal perilune condition: dRadius=' + f[6*(nSeg-1)].toFixed(2) + ' km  vr=' + f[6*(nSeg-1)+1].toFixed(2) + ' m/s  dKEm=' + (f[6*(nSeg-1)+2]/1e4).toFixed(5) + ' km2/s2');
let normF = Math.sqrt(f.reduce((s, v) => s + v * v, 0));
console.log('initial residual norm (km/km/s mixed):', normF.toExponential(3));

let lambda = 1e-3, best = { x: x.slice(), norm: normF };
const maxIter = 70;
for (let iter = 0; iter < maxIter; iter++) {
  const { f: f1, J } = residuals(x, true);
  const n1 = Math.sqrt(f1.reduce((s, v) => s + v * v, 0));
  const capsRel = 0.25; // damp step magnitude relative to current node scale (km-ish)
  let accepted = false;
  for (let tries = 0; tries < 6; tries++) {
    const dx = solveNormalEqGauss(J, f1, lambda);
    // step limiting: UNIFORM scaling of the whole Gauss-Newton step (trust-
    // region style) rather than per-component clipping — clipping was
    // measured to mangle the Newton direction (components saturate
    // unequally) and stall the first re-run at the seam. Scale so the worst
    // class-relative component stays within its cap.
    let s = 1;
    s = Math.min(s, 0.01 / Math.max(1e-12, Math.abs(dx[0])));   // dv cap 10 m/s
    s = Math.min(s, 0.05 / Math.max(1e-12, Math.abs(dx[1])));   // angle caps
    s = Math.min(s, 0.05 / Math.max(1e-12, Math.abs(dx[2])));
    for (let k = 3; k < 3 + 6 * (nSeg - 1); k += 6) {
      for (let d = 0; d < 3; d++) s = Math.min(s, 3e5 / Math.max(1e-12, Math.abs(dx[k + d]))); // 300k km pos cap
      for (let d = 3; d < 6; d++) s = Math.min(s, 2 / Math.max(1e-12, Math.abs(dx[k + d])));   // 2 km/s vel cap
    }
    s = Math.min(s, 43200 / Math.max(1e-12, Math.abs(dx[nUnk - 1]))); // tf cap 12 h/iter
    const xt = x.slice();
    for (let k = 0; k < nUnk; k++) xt[k] += s * dx[k];
    const { f: ft } = residuals(xt, false);
    const nt = Math.sqrt(ft.reduce((s, v) => s + v * v, 0));
    if (nt < n1) { x = xt; lambda = Math.max(lambda * 0.5, 1e-8); accepted = true; break; }
    lambda *= 4;
  }
  const { f: fnow } = residuals(x, false);
  const nnow = Math.sqrt(fnow.reduce((s, v) => s + v * v, 0));
  if (nnow < best.norm) best = { x: x.slice(), norm: nnow };
  if (iter % 3 === 0 || iter === maxIter - 1) console.log('iter', iter, 'residnorm', nnow.toExponential(3), 'lambda', lambda.toExponential(2), accepted ? '' : '(no improvement)');
  if (nnow < 1e-2) break;
}

x = best.x;
const finalR = residuals(x, false);
const maxCompR = Math.max(...finalR.f.map(Math.abs));
console.log('FINAL best residual norm:', best.norm.toExponential(3), 'max component:', maxCompR.toExponential(3));
let maxPosR = 0, maxVelR = 0;
for (let i = 0; i < nSeg - 1; i++) {
  for (let k = 0; k < 3; k++) maxPosR = Math.max(maxPosR, Math.abs(finalR.f[6*i+k]));
  for (let k = 3; k < 6; k++) maxVelR = Math.max(maxVelR, Math.abs(finalR.f[6*i+k]) / 1000);
}
console.log('max continuity POSITION residual (km):', maxPosR.toFixed(3), '  max continuity VELOCITY residual (km/s):', maxVelR.toFixed(6));
console.log('terminal perilune condition: dRadius=' + finalR.f[6*(nSeg-1)].toFixed(3) + ' km  vr=' + finalR.f[6*(nSeg-1)+1].toFixed(3) + ' m/s  dKEm=' + (finalR.f[6*(nSeg-1)+2]/1e4).toFixed(6) + ' km2/s2');
// final per-boundary profile (localizes any leftover discontinuity)
console.log('--- final residual profile ---');
for (let i = 0; i < nSeg - 1; i++) {
  const dR = Math.hypot(finalR.f[6*i], finalR.f[6*i+1], finalR.f[6*i+2]);
  const dV = Math.hypot(finalR.f[6*i+3], finalR.f[6*i+4], finalR.f[6*i+5]) / 1000;
  console.log('  boundary', i, ' dR=' + dR.toFixed(3) + ' km   dV=' + (dV*1000).toFixed(3) + ' m/s');
}
console.log('final dv,gamma,beta:', x[0].toFixed(4), x[1].toFixed(4), x[2].toFixed(4));

const { nodes, tEndVar } = unpack(x);
console.log('converged tf offset:', (x[nUnk - 1] / 86400).toFixed(3), 'days (tEnd =', (tEndVar / 86400).toFixed(2), 'd)');
// forward-propagate the converged solution end-to-end (single continuous
// prop, no artificial patch discontinuities) to get the real perilune and
// z-profile / acceptance metrics.
const ctxFull = { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'] };
const d0f = nodes[0];
const e0 = physBodyStateAt('Earth', t0_s);
const fullRes = physPropagateSegment({ r: physSub(d0f.r, e0.r), v: physSub(d0f.v, e0.v) }, t0_s, tEndVar, ctxFull, { singleFrame: true, maxSamples: 400 });
let apogeeKm = 0, maxZ = 0;
for (const s of fullRes.samples) {
  const helio = physAdd(s.r, physBodyStateAt('Earth', s.t).r);
  const earth = physBodyStateAt('Earth', s.t);
  const d = physMag(physSub(helio, earth.r));
  if (d > apogeeKm) apogeeKm = d;
  if (Math.abs(helio[2]) > Math.abs(maxZ)) maxZ = helio[2];
}
console.log('full-arc apogee_km=', apogeeKm.toFixed(0), 'max|z|_km=', Math.abs(maxZ).toFixed(0));
const peri1 = physBltPeriluneFrom(fullRes.stateF, fullRes.frame, fullRes.tF, 25 * 86400);
console.log('perilune1:', peri1 ? { rMag_km: peri1.rMag_km.toFixed(0), KEm: peri1.KEm.toFixed(4), t_days: (peri1.t/86400).toFixed(2) } : null);
