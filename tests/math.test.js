// tests/math.test.js
//
// Plain-Node regression harness for the PURE math in lv_calc.html's src/ modules.
// No test framework — just assertions with a pass/fail summary and a nonzero exit
// code on failure. Loads the source modules as TEXT (src/ stays untouched) and
// evaluates them in a Node `vm` context with a stubbed `document`, so top-level
// DOM-touching statements in those files don't throw.
//
// Modules loaded (pure-math functions only; DOM-dependent functions such as
// boosterModeFromDOM/collectVehicle/gv exist in the context but are NOT tested):
//   src/js/010-constants.js
//   src/js/140-physics.js
//   src/js/360-program-module-phase-1-delta-v-engine.js
//
// Run: node tests/math.test.js   (also wired into `python build.py`)

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'src/js/010-constants.js',
  'src/js/140-physics.js',
  'src/js/145-dest-dv.js',
  'src/js/150-stage-and-a-half.js',
  'src/js/360-program-module-phase-1-delta-v-engine.js',
  'src/js/385-physics-core.js',
  'src/js/386-physics-integrator.js',
  'src/js/565-physics-mission.js',
  'src/js/410-program-module-phase-6-pork-chop-plotter.js',
  'src/js/574-trajectory-view.js',
];

const src = FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');

// Minimal DOM stub so top-level code / DOM-dependent function BODIES don't crash
// merely from being defined (they are never invoked by these tests).
const sandbox = {
  document: {
    getElementById: () => null,
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'concatenated-math-modules.js' });

// ── tiny assertion harness ──────────────────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];

function ok(desc, cond) {
  if (cond) { pass++; }
  else { fail++; failures.push(desc); console.error(`FAIL: ${desc}`); }
}

function approx(desc, actual, expected, tol) {
  const d = Math.abs(actual - expected);
  ok(`${desc} (got ${actual}, expected ${expected} ± ${tol})`, d <= tol);
}

// ── pull functions off the sandbox ──────────────────────────────────────────
// NOTE: top-level `const` declarations in vm-evaluated code bind to the context's
// lexical scope, NOT the global object — so constants like G0/MU/RE can't be
// destructured off `sandbox` (they'd be undefined). Evaluate them in-context instead.
// Top-level `function` declarations DO attach to the global object, so those are fine.
const {
  circVel, rotVel, rocketEq, parseMathExpression, mathValue,
  lvPerformance, lvMaxPayload,
  progVcirc, progHohmannTOF, progTransferTOF, progBoiloff,
  _s15BecoSplit, progBodyAngleAt, progBodyWorldPos,
  progCalibratedTheta0, progBodyWorldPosCalibrated,
  _trajArcRotationForTarget, _trajLegPathFraction, _trajArcPointAt, _trajLodOpacity,
  _trajTransferArcPath, _trajCorridorMoon, _trajOrbitLabel, _trajLocalRadius,
  physV3, physAdd, physSub, physScale, physDot, physCross, physMag,
  physOrbitPeriod, physVisViva, physElementsToState, physStateToElements,
  physKeplerPropagate, physBodyStateAt, progStumpffC, progStumpffS,
  physSoiRadius, physFrameOf, physPatchState, physAccel, physStepFor,
  physLeapfrogStep, physFindEventTime, physPropagateSegment, physParentOf,
} = sandbox;
const { G0, MU, RE, OMEGA_E, PROG_BODIES, PROG_HELIO_R, PROG_MU_SUN, PROG_MOON_ORBITS, PROG_BODY_KINEMATICS, PROG_PORK_DATA } =
  vm.runInContext('({ G0, MU, RE, OMEGA_E, PROG_BODIES, PROG_HELIO_R, PROG_MU_SUN, PROG_MOON_ORBITS, PROG_BODY_KINEMATICS, PROG_PORK_DATA })', sandbox);

// ═══════════════════════════════════════════════════════════════════════════
// parseMathExpression
// ═══════════════════════════════════════════════════════════════════════════

ok('parseMathExpression: plain integer', parseMathExpression('42') === 42);
ok('parseMathExpression: decimal', parseMathExpression('3.14') === 3.14);
ok('parseMathExpression: scientific notation', parseMathExpression('1.5e3') === 1500);
ok('parseMathExpression: negative scientific notation exponent', parseMathExpression('2E-2') === 0.02);
ok('parseMathExpression: operator precedence 2+3*4=14', parseMathExpression('2+3*4') === 14);
ok('parseMathExpression: parentheses (2+3)*4=20', parseMathExpression('(2+3)*4') === 20);
ok('parseMathExpression: unary minus', parseMathExpression('-5+2') === -3);
ok('parseMathExpression: division', parseMathExpression('10/4') === 2.5);
ok('parseMathExpression: whitespace tolerant', parseMathExpression('  1 +  2 ') === 3);
ok('parseMathExpression: nested parens', parseMathExpression('((1+2)*(3+4))') === 21);
ok('parseMathExpression: invalid "abc" -> NaN', Number.isNaN(parseMathExpression('abc')));
ok('parseMathExpression: trailing operator "2+" -> NaN', Number.isNaN(parseMathExpression('2+')));
ok('parseMathExpression: unclosed paren "(2" -> NaN', Number.isNaN(parseMathExpression('(2')));
ok('parseMathExpression: empty string -> NaN', Number.isNaN(parseMathExpression('')));
ok('parseMathExpression: "1/0" -> NaN (Infinity is not finite)', Number.isNaN(parseMathExpression('1/0')));

ok('mathValue: falls back on invalid input', mathValue('nonsense', 7) === 7);
ok('mathValue: passes through valid expression', mathValue('2*3', 0) === 6);

// ═══════════════════════════════════════════════════════════════════════════
// rocketEq (Tsiolkovsky)
// ═══════════════════════════════════════════════════════════════════════════

{
  // hand-computed: isp=300, m0=100000, mf=50000 -> G0*300*ln(2)
  const expected = G0 * 300 * Math.log(2); // ~2039.something
  approx('rocketEq: isp=300 m0=100000 mf=50000 (Tsiolkovsky)', rocketEq(300, 100000, 50000), expected, 0.1);
  approx('rocketEq: matches ~2039.3 m/s hand value', rocketEq(300, 100000, 50000), 2039.3, 0.5);
}
ok('rocketEq: degenerate mf<=0 -> 0', rocketEq(300, 100000, 0) === 0);
ok('rocketEq: degenerate m0<=mf -> 0', rocketEq(300, 50000, 50000) === 0);
ok('rocketEq: degenerate m0<mf -> 0', rocketEq(300, 40000, 50000) === 0);

// ═══════════════════════════════════════════════════════════════════════════
// circVel
// ═══════════════════════════════════════════════════════════════════════════

{
  const alt = 200; // km
  const expected = Math.sqrt(MU / (RE + alt)) * 1000; // m/s, derived from the module's own constants
  approx('circVel(200): matches formula from MU/RE constants', circVel(alt), expected, 1e-6);
  const v = circVel(alt);
  ok('circVel(200): sane 7.7-7.8 km/s window', v > 7700 && v < 7800);
}

// ═══════════════════════════════════════════════════════════════════════════
// lvPerformance — representative 2-stage vehicle, invariant checks
// ═══════════════════════════════════════════════════════════════════════════

const testStages = [
  { dry: 4000,  prop: 80000, thrust: 1200, isp: 300, res: 1 }, // stage 0 (bottom)
  { dry: 1500,  prop: 15000, thrust: 250,  isp: 350, res: 1 }, // stage 1 (top)
];
const testPayload = 2000;
const testFairingMass = 500;
const testFairingJ = 1; // jettison after stage 0
const testParkingAlt = 200; // km
const testOnOrbitDV = 100; // m/s
const testSiteLat = 28.5;
const testAzMin = 45, testAzMax = 100;

function runTestVehicle(booster) {
  return lvPerformance(
    testStages, booster, testPayload, testFairingMass, testFairingJ,
    testParkingAlt, testOnOrbitDV, testSiteLat, testAzMin, testAzMax
  );
}

const res1 = runTestVehicle(null);

ok('lvPerformance: tDV = sum(sDVs)', Math.abs(res1.tDV - res1.sDVs.reduce((a, b) => a + b, 0)) < 1e-6);
approx('lvPerformance: margin = tDV - DVtot', res1.margin, res1.tDV - res1.DVtot, 1e-6);
approx('lvPerformance: DVasc = Vcirc + DVpen - Vrot', res1.DVasc, res1.Vcirc + res1.DVpen - res1.Vrot, 1e-6);
ok('lvPerformance: all stage dVs positive', res1.sDVs.every(dv => dv > 0));
ok('lvPerformance: all stage burn times positive', res1.sBTs.every(bt => bt > 0));

// Golden-value snapshot — captured from the CURRENT implementation as a regression
// baseline. If a future physics refactor changes these values, this test will
// fail and must be re-evaluated deliberately (not silently updated).
approx('lvPerformance: golden tDV snapshot', res1.tDV, 10074.710, 0.01);
approx('lvPerformance: golden margin snapshot', res1.margin, 909.813, 0.01);

// ── Booster equivalence: single object vs array-of-one ─────────────────────
const boosterGroup = { dry: 2000, prop: 40000, thrust: 1500, isp: 280, res: 2, count: 2, ignition: 'ground' };
const resSingleObj = runTestVehicle(boosterGroup);
const resArrayOfOne = runTestVehicle([boosterGroup]);
approx('lvPerformance: booster single-object vs array-of-one tDV equivalence', resSingleObj.tDV, resArrayOfOne.tDV, 1e-6);
approx('lvPerformance: booster single-object vs array-of-one margin equivalence', resSingleObj.margin, resArrayOfOne.margin, 1e-6);

// ═══════════════════════════════════════════════════════════════════════════
// lvMaxPayload
// ═══════════════════════════════════════════════════════════════════════════

{
  const maxPay = lvMaxPayload(
    testStages, null, testFairingMass, testFairingJ,
    testParkingAlt, testOnOrbitDV, testSiteLat, testAzMin, testAzMax
  );
  const marginAtMax = lvPerformance(
    testStages, null, maxPay, testFairingMass, testFairingJ,
    testParkingAlt, testOnOrbitDV, testSiteLat, testAzMin, testAzMax
  ).margin;
  // bisection runs 40 iterations over [0, 2e6] -> hi-lo converges to <1 kg;
  // margin sensitivity to payload here is close to 1:1, so the margin at the
  // returned payload should be within a few kg-equivalent of zero.
  ok(`lvMaxPayload: marginAt(maxPayload) ~= 0 (got ${marginAtMax})`, Math.abs(marginAtMax) < 5);

  const weakStages = [{ dry: 4000, prop: 80000, thrust: 0.001, isp: 1, res: 1 }];
  const weakMaxPay = lvMaxPayload(
    weakStages, null, 0, 0, testParkingAlt, testOnOrbitDV, testSiteLat, testAzMin, testAzMax
  );
  ok('lvMaxPayload: absurdly low thrust/isp vehicle -> 0 payload', weakMaxPay === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// progVcirc — round-trip against rocketEq-derived ΔV
// ═══════════════════════════════════════════════════════════════════════════

{
  // progVcirc/PROG_BODIES don't expose a rocket-equation propellant<->dv pair
  // (progRocketEqDv/progRocketEqPropNeeded do NOT exist in this codebase — the
  // only Program-module ΔV primitives are the orbital-mechanics helpers in
  // 360-program-module-phase-1-delta-v-engine.js). Use rocketEq itself for a
  // round-trip: derive mf from a target ΔV, then confirm rocketEq recovers it.
  const isp = 320, m0 = 200000, dvTarget = 3000;
  const mf = m0 / Math.exp(dvTarget / (G0 * isp));
  approx('rocketEq round-trip: mf derived from target dv recovers dv', rocketEq(isp, m0, mf), dvTarget, 1e-3);

  // progVcirc sanity vs circVel(Earth) — same physics, independent implementation
  // (progVcirc returns km/s using PROG_BODIES.Earth; circVel returns m/s using MU/RE).
  const vProg_ms = progVcirc('Earth', 200) * 1000;
  const vCirc_ms = circVel(200);
  approx('progVcirc(Earth,200km) matches circVel(200) (same underlying constants)', vProg_ms, vCirc_ms, 1e-6);
}

// ═══════════════════════════════════════════════════════════════════════════
// destOnOrbitDV (145-dest-dv.js) — pinned against calculate() (160-calculate.js)
//
// destOnOrbitDV is a pure transcription of the on-orbit ΔV logic frozen inside
// calculate(). These goldens were produced by running the REAL calculate() in
// the browser (Saturn V preset, 2026-07-02) and reading its rendered
// "Est. Max Payload". Here we recompute max payload via destOnOrbitDV +
// lvMaxPayload; a match pins the two implementations together. If 160's
// on-orbit ΔV logic ever changes intentionally, re-capture these goldens.
// ═══════════════════════════════════════════════════════════════════════════
{
  const destOnOrbitDV = sandbox.destOnOrbitDV;
  ok('destOnOrbitDV: function exists', typeof destOnOrbitDV === 'function');

  // Saturn V as collectVehicle() reported it (3rd stage is an empty slot — kept verbatim)
  const satStages = [
    { dry: 130980, prop: 2169290, thrust: 34020, isp: 304, res: 2 },
    { dry: 34450,  prop: 451830,  thrust: 5165,  isp: 425, res: 2 },
    { dry: 0,      prop: 0,       thrust: 0,     isp: 300, res: 2 },
  ];
  const site = { lat: 28.5, azMin: 37, azMax: 112 };
  const maxPayFor = dest => {
    const d = destOnOrbitDV(dest, site.lat);
    return lvMaxPayload(satStages, null, 0, 0, d.parkingAlt, d.onOrbitDV, site.lat, site.azMin, site.azMax);
  };

  // parking-orbit destination → onOrbitDV must be exactly 0
  approx('destOnOrbitDV: dest == parking orbit → 0 m/s',
    destOnOrbitDV({ mode: 'orbit', apogee: 185, perigee: 185, inc: 28.5, parkingAlt: 185 }, 28.5).onOrbitDV, 0, 1e-9);

  // goldens from browser calculate() runs (rendered values are rounded → ±2 kg)
  approx('destOnOrbitDV pin: GTO 185×35786 @28.5° max payload matches calculate()',
    maxPayFor({ mode: 'orbit', apogee: 35786, perigee: 185, inc: 28.5, parkingAlt: 185 }), 57105, 2);
  approx('destOnOrbitDV pin: circular 800 km @0° (plane change) matches calculate()',
    maxPayFor({ mode: 'orbit', apogee: 800, perigee: 800, inc: 0, parkingAlt: 185 }), 24350, 2);
  approx('destOnOrbitDV pin: escape C3=0 matches calculate()',
    maxPayFor({ mode: 'escape', c3: 0, decl: 28.5, perigee: 185 }), 40549, 2);

  // escape below minimum C3 → error, no crash
  ok('destOnOrbitDV: impossible C3 returns error field',
    !!destOnOrbitDV({ mode: 'escape', c3: -200, decl: 28.5, perigee: 185 }, 28.5).error);
}

// ═══════════════════════════════════════════════════════════════════════════
// preset integrity — every builtin preset's stageNames/boosterName must
// resolve against STAGE_LIBRARY. A miss silently becomes a zero-mass ghost
// stage ({dry:0,prop:0,...}) that "flies" to orbit alongside real stages
// (caught live on Saturn V, 2026-07-03: 'Saturn V S-IVB' vs library name
// 'Saturn 1B & V S-IVB').
// ═══════════════════════════════════════════════════════════════════════════
{
  const psrc = ['src/js/020-state.js', 'src/js/040-builtin-art.js', 'src/js/210-stage-library.js', 'src/js/050-builtin-presets.js']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  const psb = { document: { getElementById: () => null }, console, window: {} };
  vm.createContext(psb);
  let loadOk = true;
  try { vm.runInContext(psrc, psb); } catch (e) { loadOk = false; console.error('preset-module load error: ' + e.message); }
  ok('preset modules load in vm', loadOk);
  const lib = vm.runInContext('typeof STAGE_LIBRARY!=="undefined"?STAGE_LIBRARY:null', psb);
  const presets = vm.runInContext('typeof BUILTIN_PRESETS!=="undefined"?BUILTIN_PRESETS:null', psb);
  ok('STAGE_LIBRARY and BUILTIN_PRESETS present', !!lib && !!presets);
  if (lib && presets) {
    const names = new Set();
    Object.values(lib).forEach(a => a.forEach(s => names.add(s.name)));
    const missing = [];
    presets.forEach(p => {
      (p.stageNames || []).forEach(n => { if (!names.has(n)) missing.push(`${p.name} -> stage "${n}"`); });
      if (p.boosterName && !names.has(p.boosterName)) missing.push(`${p.name} -> booster "${p.boosterName}"`);
    });
    ok(`all builtin preset stage/booster names resolve (${presets.length} presets)` +
       (missing.length ? ' — MISSING: ' + missing.join('; ') : ''), missing.length === 0);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage-and-a-Half (S1.5) — _s15BecoSplit + expansion regression
//
// Uses the real 'Atlas D Sust.' library entry (src/js/210-stage-library.js)
// as a representative S1.5 first stage, paired with a simple upper stage.
// The expansion loop below MIRRORS _fleetExpandStages() in
// src/js/560-fleet-editor.js (which itself mirrors calculateWithS15() in
// src/js/150-stage-and-a-half.js) — kept here as a tiny inline replica so we
// don't need to load the heavy DOM-dependent 560/165 modules just for this.
// ═══════════════════════════════════════════════════════════════════════════
{
  const atlasD = {
    dry: 5657, prop: 90000, thrust: 1800, isp: 282, res: 2,
    s15: true,
    s15_sust_thrust: 362,
    s15_sust_isp: 309,
    s15_jet_mass: 3050,
    s15_beco_twr: 1.2,
    s15_boost_isp: 282,   // mirrors the library entry's added field (2026-07-06)
  };
  const upperStage = { dry: 1000, prop: 6577, thrust: 71, isp: 309, res: 2 }; // Atlas-Agena-ish

  // ── _s15BecoSplit sanity ────────────────────────────────────────────────
  const split = _s15BecoSplit(atlasD);
  ok('_s15BecoSplit: Atlas D Sust. splits without error', !split.error);
  if (!split.error) {
    approx('_s15BecoSplit: prop_ph1 + prop_ph2 == authored prop',
      split.prop_ph1 + split.prop_ph2, atlasD.prop, 1e-6);
    ok('_s15BecoSplit: Phase 2 dry < authored dry (jettison of booster pack)',
      split.dry_ph2 < atlasD.dry);
    approx('_s15BecoSplit: dry_ph2 == dry - s15_jet_mass',
      split.dry_ph2, atlasD.dry - atlasD.s15_jet_mass, 1e-6);
  }

  // ── _s15BecoSplit: mass-flow-blended Phase-1 Isp (s15_boost_isp) ────────
  // (a) blend formula: isp_ph1 == F_tot/((F_tot-F_sust)/Isp_boost + F_sust/Isp_sust)
  {
    const F_tot   = atlasD.thrust * 1000;
    const F_sust  = atlasD.s15_sust_thrust * 1000;
    const F_boost = F_tot - F_sust;
    const expectedIspPh1 = F_tot / (F_boost / atlasD.s15_boost_isp + F_sust / atlasD.s15_sust_isp);
    approx('_s15BecoSplit: blended isp_ph1 matches thrust-weighted harmonic-mean formula',
      split.isp_ph1, expectedIspPh1, 1e-9);
  }
  // (b) absence regression: without s15_boost_isp, isp_ph1 == authored isp exactly
  {
    const { s15_boost_isp, ...atlasNoBoostIsp } = atlasD;
    const splitNoBlend = _s15BecoSplit(atlasNoBoostIsp);
    ok('_s15BecoSplit: without s15_boost_isp, isp_ph1 == authored isp exactly (regression)',
      !splitNoBlend.error && splitNoBlend.isp_ph1 === atlasD.isp);
  }
  // (c) blended isp_ph1 lies strictly between the two engines' Isps
  ok('_s15BecoSplit: blended isp_ph1 lies strictly between min and max of booster/sustainer Isp',
    split.isp_ph1 > Math.min(atlasD.s15_boost_isp, atlasD.s15_sust_isp) &&
    split.isp_ph1 < Math.max(atlasD.s15_boost_isp, atlasD.s15_sust_isp));

  // ── _s15BecoSplit error path: nonsense stage (zero sustainer thrust) ────
  const badAtlas = { ...atlasD, s15_sust_thrust: 0 };
  let badThrew = false, badResult;
  try { badResult = _s15BecoSplit(badAtlas); } catch (e) { badThrew = true; }
  ok('_s15BecoSplit: nonsense stage (sustainer thrust 0) returns error, does not throw',
    !badThrew && !!(badResult && badResult.error));

  // ── Expansion: mirrors _fleetExpandStages() (src/js/560-fleet-editor.js) ──
  function expandStages(stageData) {
    const out = [];
    (stageData || []).forEach((st, i) => {
      if (st.s15) {
        const sp = _s15BecoSplit(st);
        if (sp.error) { out.push({ dry: st.dry||0, prop: st.prop||0, thrust: st.thrust||0, isp: st.isp||1, res: st.res||2, _src: i, _err: sp.error }); return; }
        out.push({ dry: st.dry||0,  prop: sp.prop_ph1, thrust: st.thrust||0,          isp: sp.isp_ph1, res: st.res||2, _src: i, _phase: 'Ph.1' });
        out.push({ dry: sp.dry_ph2, prop: sp.prop_ph2, thrust: st.s15_sust_thrust||0, isp: sp.isp_ph2, res: st.res||2, _src: i, _phase: 'Ph.2' });
      } else {
        out.push({ dry: st.dry||0, prop: st.prop||0, thrust: st.thrust||0, isp: st.isp||1, res: st.res||2, _src: i });
      }
    });
    return out;
  }

  const expanded = expandStages([atlasD, upperStage]);
  ok('S1.5 expansion: 3 virtual stages produced (Ph.1 + Ph.2 + upper stage)', expanded.length === 3);
  ok('S1.5 expansion: first two phases both trace back to source stage 0',
    expanded[0]._src === 0 && expanded[1]._src === 0 && expanded[0]._phase === 'Ph.1' && expanded[1]._phase === 'Ph.2');
  approx('S1.5 expansion: expanded prop_ph1 + prop_ph2 == authored prop',
    expanded[0].prop + expanded[1].prop, atlasD.prop, 1e-6);
  ok('S1.5 expansion: expanded Ph.2 dry < authored dry (jettison)', expanded[1].dry < atlasD.dry);

  // ── Golden max-payload regression: EXPANDED (S1.5-aware) vehicle ────────
  // Same test-vehicle envelope params used elsewhere in this file.
  const s15MaxPay = lvMaxPayload(
    expanded, null, testFairingMass, testFairingJ,
    testParkingAlt, testOnOrbitDV, testSiteLat, testAzMin, testAzMax
  );
  // Golden value captured from the CURRENT implementation as a regression
  // baseline (2026-07-06, UPDATED same day: added s15_boost_isp:282 mass-flow
  // blend for Phase-1 Isp — was 2280.24 kg with the unblended authored isp
  // verbatim; the harmonic-mean blend of booster (282s) + sustainer (309s)
  // Isp raised Phase-1 Isp slightly, increasing max payload).
  // If a future physics refactor changes this value, re-evaluate deliberately
  // — do not silently update the number.
  approx('S1.5: golden max-payload snapshot (expanded Atlas D Sust. + upper stage)',
    s15MaxPay, 2329.83, 1);

  // ── UNexpanded stage must give a DIFFERENT max payload ──────────────────
  // Feeding the raw (unsplit) S1.5 stage directly into lvPerformance/
  // lvMaxPayload ignores the BECO jettison entirely — the authored {dry,prop,
  // thrust,isp} is the FULL booster+sustainer stage but its isp (282s) is the
  // blended full-stage figure, not the higher sustainer-only isp (309s) used
  // in Phase 2 after the booster pack drops away. Carrying the dead booster
  // mass through the whole burn (never jettisoning it) makes the single-stage
  // rocket-equation math WORSE than the properly-staged Ph.1/Ph.2 split, so
  // the unexpanded vehicle underperforms — this is why expansion is
  // mandatory before calling calculate() on an S1.5 vehicle: the unexpanded
  // path is not just wrong, it is asymmetrically wrong (no free lunch either
  // way — it just misses the fidelity of the actual staging event).
  const unexpandedStages = [
    { dry: atlasD.dry, prop: atlasD.prop, thrust: atlasD.thrust, isp: atlasD.isp, res: atlasD.res },
    upperStage,
  ];
  const unexpandedMaxPay = lvMaxPayload(
    unexpandedStages, null, testFairingMass, testFairingJ,
    testParkingAlt, testOnOrbitDV, testSiteLat, testAzMin, testAzMax
  );
  ok(`S1.5: unexpanded stage gives a DIFFERENT max payload than expanded (expanded=${s15MaxPay.toFixed(2)}, unexpanded=${unexpandedMaxPay.toFixed(2)})`,
    Math.abs(unexpandedMaxPay - s15MaxPay) > 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// T1 mission time core — progHohmannTOF / progTransferTOF goldens
// ═══════════════════════════════════════════════════════════════════════════
{
  // Earth 185 -> GEO(35786) Hohmann half-ellipse: analytically ~5.25 hours.
  const tofGeo = progHohmannTOF('Earth', 185, 35786);
  approx('progHohmannTOF: Earth 185->35786 km (~5.2-5.3 h)', tofGeo / 3600, 5.254, 0.05);

  // Transit-corridor convention (MATH.md critique 16e): the coast is charged
  // ONCE, on the leg EXITING the corridor. LEO -> TLC is the impulsive
  // injection (0 s); TLC -> LLO carries the ~5-day translunar half-ellipse
  // (known overestimate vs. real free-return ~3 days — critique 16a).
  const nodeLeo = { orbit: { type: 'circular', body: 'Earth', perigee: 185, apogee: 185 } };
  const nodeTlc = { orbit: { type: 'transit', body: 'Earth', destination: 'Moon' } };
  const nodeLlo = { orbit: { type: 'circular', body: 'Moon', perigee: 100, apogee: 100 } };
  ok('progTransferTOF: LEO -> TLC (entering corridor) = 0 — injection is impulsive',
    progTransferTOF(nodeLeo, nodeTlc) === 0);
  const tofLlo = progTransferTOF(nodeTlc, nodeLlo);
  ok(`progTransferTOF: TLC -> LLO carries the translunar TOF in [4,5.5] days (got ${(tofLlo/86400).toFixed(2)}d)`,
    tofLlo / 86400 >= 4 && tofLlo / 86400 <= 5.5);

  // Degenerate: same orbit -> 0 TOF.
  const nodeLeoA = { orbit: { type: 'circular', body: 'Earth', perigee: 400, apogee: 400 } };
  const nodeLeoB = { orbit: { type: 'circular', body: 'Earth', perigee: 400, apogee: 400 } };
  ok('progTransferTOF: same orbit -> 0 (degenerate)', progTransferTOF(nodeLeoA, nodeLeoB) === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// O1-a Trajectory view data — PROG_HELIO_R outer-planet expansion + PROG_MOON_ORBITS
// ═══════════════════════════════════════════════════════════════════════════
{
  ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'].forEach(b => {
    ok(`PROG_HELIO_R has ${b}`, typeof PROG_HELIO_R[b] === 'number' && PROG_HELIO_R[b] > 0);
  });
  ok('PROG_MOON_ORBITS.Moon parents to Earth', PROG_MOON_ORBITS.Moon && PROG_MOON_ORBITS.Moon.parent === 'Earth');
  ok('PROG_MOON_ORBITS.Titan parents to Saturn', PROG_MOON_ORBITS.Titan && PROG_MOON_ORBITS.Titan.parent === 'Saturn');

  // Earth -> Jupiter Hohmann TOF: a = (r_E + r_J)/2, half-period = pi*sqrt(a^3/mu_sun).
  // Analytically ~2.73 years (~997 days) for a co-planar Hohmann transfer.
  const a = (PROG_HELIO_R.Earth + PROG_HELIO_R.Jupiter) / 2;
  const tofJup = Math.PI * Math.sqrt(Math.pow(a, 3) / PROG_MU_SUN);
  approx('Earth->Jupiter Hohmann TOF ~= 2.73 years', tofJup / 86400 / 365.25, 2.73, 0.05);

  // Earth -> Saturn sanity: should be meaningfully longer than Earth->Jupiter (outer body).
  const aSat = (PROG_HELIO_R.Earth + PROG_HELIO_R.Saturn) / 2;
  const tofSat = Math.PI * Math.sqrt(Math.pow(aSat, 3) / PROG_MU_SUN);
  ok('Earth->Saturn Hohmann TOF > Earth->Jupiter Hohmann TOF', tofSat > tofJup);
}

// ═══════════════════════════════════════════════════════════════════════════
// T2 mission time / boiloff — progBoiloff goldens
// ═══════════════════════════════════════════════════════════════════════════
{
  // 10,000 kg at 0.3%/day (LOX_LH2 baseline) for 30 days, baseline insulation (1.0):
  // 10000 * e^(-0.003*1.0*30) = 10000 * e^(-0.09) ~= 9139.3 kg.
  const b1 = progBoiloff(10000, 0.003, 30, 1.0);
  approx('progBoiloff: 10,000 kg @ 0.3%/day, 30 d, baseline insulation -> ~9139.3 kg', b1, 9139.312, 0.01);

  // Halved insulation factor halves the exponent: e^(-0.003*0.5*30) = e^(-0.045).
  const b2 = progBoiloff(10000, 0.003, 30, 0.5);
  approx('progBoiloff: insulation factor 0.5 halves the exponent -> ~9559.97 kg', b2, 9559.975, 0.01);

  // Zero rate (non-cryo / storable propellant) -> unchanged.
  const b3 = progBoiloff(10000, 0, 30, 1.0);
  approx('progBoiloff: zero rate -> unchanged', b3, 10000, 1e-9);

  // Zero elapsed time -> unchanged regardless of rate.
  const b4 = progBoiloff(10000, 0.003, 0, 1.0);
  approx('progBoiloff: zero elapsed days -> unchanged', b4, 10000, 1e-9);
}

// ═══════════════════════════════════════════════════════════════════════════
// C1a Body kinematics — progBodyAngleAt / progBodyWorldPos / porkchop θ0 unification
// ═══════════════════════════════════════════════════════════════════════════
{
  // t=0 == theta0 for every body.
  Object.keys(PROG_BODY_KINEMATICS).forEach(b => {
    approx(`progBodyAngleAt(${b}, 0) == theta0_rad`, progBodyAngleAt(b, 0), ((PROG_BODY_KINEMATICS[b].theta0_rad % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI), 1e-9);
  });

  // Moon: +2*pi after exactly one period (27.3217 days) -> back to theta0.
  const moonPeriod = 27.3217 * 86400;
  approx('progBodyAngleAt(Moon, one full period) == theta0 (wrapped)', progBodyAngleAt('Moon', moonPeriod), progBodyAngleAt('Moon', 0), 1e-6);

  // Earth: +pi after half a year (365.256/2 days).
  const halfYear_s = (365.256 / 2) * 86400;
  const earthHalf = progBodyAngleAt('Earth', halfYear_s);
  const earthExpected = ((PROG_BODY_KINEMATICS.Earth.theta0_rad + Math.PI) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
  approx('progBodyAngleAt(Earth, half year) == theta0 + pi (normalized)', earthHalf, earthExpected, 1e-6);

  // Normalization: result always in [0, 2*pi).
  const bigT = 1e10;
  const angBig = progBodyAngleAt('Mars', bigT);
  ok('progBodyAngleAt normalizes to [0, 2*pi)', angBig >= 0 && angBig < 2*Math.PI);

  // progBodyWorldPos: Sun at origin.
  const sunPos = progBodyWorldPos('Sun', 12345);
  ok('progBodyWorldPos(Sun) == {0,0}', sunPos.x === 0 && sunPos.y === 0);

  // progBodyWorldPos: Earth at PROG_HELIO_R.Earth distance from origin (t=0).
  const earthPos = progBodyWorldPos('Earth', 0);
  approx('progBodyWorldPos(Earth, 0) distance == PROG_HELIO_R.Earth', Math.hypot(earthPos.x, earthPos.y), PROG_HELIO_R.Earth, 1e-3);

  // progBodyWorldPos: Moon == Earth's position + moon-ring offset.
  const tSample = 5 * 86400;
  const earthP = progBodyWorldPos('Earth', tSample);
  const moonP  = progBodyWorldPos('Moon', tSample);
  const moonAng = progBodyAngleAt('Moon', tSample);
  const expectedMoonX = earthP.x + PROG_MOON_ORBITS.Moon.r * Math.cos(moonAng);
  const expectedMoonY = earthP.y + PROG_MOON_ORBITS.Moon.r * Math.sin(moonAng);
  approx('progBodyWorldPos(Moon) == Earth pos + moon-ring offset (x)', moonP.x, expectedMoonX, 1e-3);
  approx('progBodyWorldPos(Moon) == Earth pos + moon-ring offset (y)', moonP.y, expectedMoonY, 1e-3);

  // Porkchop-consistency: Mars theta0 - Earth theta0 phase difference unchanged
  // from the PRE-unification hardcoded values (Mars: 0.7729, Earth: 0, Venus: 5.3390).
  const OLD_EARTH_THETA0 = 0;
  const OLD_MARS_THETA0  = 0.7729;
  const OLD_VENUS_THETA0 = 5.3390;
  approx('PROG_PORK_DATA Mars-Earth theta0 phase diff unchanged post-unification',
    PROG_PORK_DATA.Mars.theta0_rad - PROG_PORK_DATA.Earth.theta0_rad,
    OLD_MARS_THETA0 - OLD_EARTH_THETA0, 1e-6);
  approx('PROG_PORK_DATA Venus-Earth theta0 phase diff unchanged post-unification',
    PROG_PORK_DATA.Venus.theta0_rad - PROG_PORK_DATA.Earth.theta0_rad,
    OLD_VENUS_THETA0 - OLD_EARTH_THETA0, 1e-6);
  ok('PROG_PORK_DATA.Earth.theta0_rad reads from PROG_BODY_KINEMATICS', PROG_PORK_DATA.Earth.theta0_rad === PROG_BODY_KINEMATICS.Earth.theta0_rad);
  ok('PROG_PORK_DATA.Mars.theta0_rad reads from PROG_BODY_KINEMATICS', PROG_PORK_DATA.Mars.theta0_rad === PROG_BODY_KINEMATICS.Mars.theta0_rad);
  ok('PROG_PORK_DATA.Venus.theta0_rad reads from PROG_BODY_KINEMATICS', PROG_PORK_DATA.Venus.theta0_rad === PROG_BODY_KINEMATICS.Venus.theta0_rad);
}

// ═══════════════════════════════════════════════════════════════════════════
// C2 trajectory-view LOD ramps + mission-state rendering — pure helpers
// ═══════════════════════════════════════════════════════════════════════════
{
  // ── _trajArcRotationForTarget: arrival endpoint lands ON the target ──────
  // Straight right (target due +x of origin) -> rotDeg = 0 - 180 = -180 (== 180).
  approx('_trajArcRotationForTarget: target due +x -> rot = 180 (or -180)', Math.abs(_trajArcRotationForTarget(0, 0, 100, 0)), 180, 1e-6);
  // Target due +y (90deg) -> rot = 90 - 180 = -90.
  approx('_trajArcRotationForTarget: target due +y -> rot = -90', _trajArcRotationForTarget(0, 0, 0, 100), -90, 1e-6);
  // Target due -x (180deg) -> rot = 180-180 = 0.
  approx('_trajArcRotationForTarget: target due -x -> rot = 0', _trajArcRotationForTarget(0, 0, -100, 0), 0, 1e-6);
  // Non-origin local frame: offset (ox,oy) is subtracted correctly.
  approx('_trajArcRotationForTarget: works with a non-zero local origin', _trajArcRotationForTarget(50, 50, 50, 150), -90, 1e-6);

  // Round-trip: apply the solved rotation back through _trajTransferArcPath
  // and confirm the arrival endpoint (arrX,arrY) lands on the target within
  // float tolerance — this is the actual invariant the Moon-lead feature needs.
  {
    const ox = 10, oy = -5, targetX = 200, targetY = 340;
    const rot = _trajArcRotationForTarget(ox, oy, targetX, targetY);
    const arc = _trajTransferArcPath(6871, 384400 + 1737, 1, rot, ox, oy);
    // arrX/arrY should lie on the ray from (ox,oy) through (targetX,targetY) —
    // check the angle matches (magnitude differs since rApo != target distance).
    const arcAng = Math.atan2(arc.arrY - oy, arc.arrX - ox);
    const targetAng = Math.atan2(targetY - oy, targetX - ox);
    approx('_trajArcRotationForTarget round-trip: arc arrival angle == target angle', arcAng, targetAng, 1e-6);
  }

  // ── _trajLegPathFraction: linear schematic clamp ─────────────────────────
  approx('_trajLegPathFraction: at departure -> 0', _trajLegPathFraction(100, 50, 100), 0, 1e-9);
  approx('_trajLegPathFraction: at arrival -> 1', _trajLegPathFraction(100, 50, 150), 1, 1e-9);
  approx('_trajLegPathFraction: midpoint -> 0.5', _trajLegPathFraction(100, 50, 125), 0.5, 1e-9);
  ok('_trajLegPathFraction: clamps below departure to 0', _trajLegPathFraction(100, 50, 50) === 0);
  ok('_trajLegPathFraction: clamps past arrival to 1', _trajLegPathFraction(100, 50, 500) === 1);
  ok('_trajLegPathFraction: zero/negative TOF -> 0 (no divide-by-zero)', _trajLegPathFraction(100, 0, 100) === 0);

  // ── _trajArcPointAt: endpoints match _trajTransferArcPath's own p1/p2 ────
  {
    const r1 = 6871, r2 = 42164, scale = 1, rot = 37, ox = 3, oy = -8;
    const arc = _trajTransferArcPath(r1, r2, scale, rot, ox, oy);
    const p0 = _trajArcPointAt(r1, r2, scale, rot, ox, oy, 0);
    const p1 = _trajArcPointAt(r1, r2, scale, rot, ox, oy, 1);
    approx('_trajArcPointAt(t=0) == arc departure point (x)', p0.x, arc.depX, 1e-6);
    approx('_trajArcPointAt(t=0) == arc departure point (y)', p0.y, arc.depY, 1e-6);
    approx('_trajArcPointAt(t=1) == arc arrival point (x)', p1.x, arc.arrX, 1e-6);
    approx('_trajArcPointAt(t=1) == arc arrival point (y)', p1.y, arc.arrY, 1e-6);
  }

  // ── _trajLodOpacity: window + linear ramp behavior ───────────────────────
  ok('_trajLodOpacity: below window -> 0', _trajLodOpacity(5, 10, 100) === 0);
  ok('_trajLodOpacity: above window -> 0', _trajLodOpacity(200, 10, 100) === 0);
  ok('_trajLodOpacity: dead center of window -> 1', _trajLodOpacity(55, 10, 100) === 1);
  // Window [10,100]: ramp width = min((100-10)*0.2, 10*0.2) = min(18,2) = 2
  // (capped at 20% of lo — see _trajLodOpacity's doc comment for why the
  // full-span ramp would be absurdly wide for our lo<<hi windows).
  approx('_trajLodOpacity: at lo edge -> 0', _trajLodOpacity(10, 10, 100), 0, 1e-9);
  // At lo + rampW/2 -> 0.5 through the entry ramp.
  approx('_trajLodOpacity: halfway through entry ramp -> 0.5', _trajLodOpacity(10 + 1, 10, 100), 0.5, 1e-9);
  approx('_trajLodOpacity: at hi edge -> 0', _trajLodOpacity(100, 10, 100), 0, 1e-9);
  approx('_trajLodOpacity: halfway through exit ramp -> 0.5', _trajLodOpacity(100 - 1, 10, 100), 0.5, 1e-9);
  approx('_trajLodOpacity: well past entry ramp -> 1', _trajLodOpacity(20, 10, 100), 1, 1e-9);
  // hi=Infinity (zone-of-influence "fade in only, no ceiling") must NOT
  // collapse to 0 at large sizePx — this was a real bug caught in-browser
  // (Infinity span made the ramp width infinite, so opacity was always ~0).
  ok('_trajLodOpacity: hi=Infinity, sizePx far past lo -> 1 (no ceiling)', _trajLodOpacity(5531, 30, Infinity) === 1);
  ok('_trajLodOpacity: hi=Infinity, sizePx below lo -> 0', _trajLodOpacity(10, 30, Infinity) === 0);
  approx('_trajLodOpacity: hi=Infinity, sizePx at lo -> 0', _trajLodOpacity(30, 30, Infinity), 0, 1e-9);

  // ── _trajOrbitLabel / corridor suppression: labeler no longer special-cases
  // "TLC corridor" text (rings die entirely at the extraction layer instead —
  // see _trajCorridorMoon's doc comment) — confirm the label function doesn't
  // emit corridor text for a corridor-shaped orbit (extraction-layer
  // suppression is exercised via _trajCorridorMoon directly, the detector
  // is unchanged/still used to SUPPRESS, just not to relabel).
  ok('_trajCorridorMoon: still detects a TLC-shaped snapshot (peri~LEO, apo~Moon radius)', _trajCorridorMoon('Earth', PROG_MOON_ORBITS.Moon.r - PROG_BODIES.Earth.R) === 'Moon');
  ok('_trajOrbitLabel: no longer emits "corridor" text for any orbit', !_trajOrbitLabel('Earth', 185, PROG_MOON_ORBITS.Moon.r - PROG_BODIES.Earth.R).toLowerCase().includes('corridor'));

  // ── _trajLocalRadius: Moon-frame patched-conic seam fallback (C2 fix, then
  // C2-review fix) ────────────────────────────────────────────────────────
  // A transit leg whose destination IS the frame body itself (e.g. body ===
  // 'Moon', o.destination === 'Moon') previously returned null (leg silently
  // never rendered in the destination's own frame — the TLC->LLO coast arc
  // was invisible). Schematic fallback originally used 20x the destination
  // body's own radius — but that value has no relationship to the actual
  // departure-arrival gap, so at Earth anchor (zoomed out to frame the whole
  // Earth-Moon system) the arc's drawn extent collapsed under the LOD
  // window's px floor and the leg vanished entirely, even though the mirror
  // leg in the Earth frame (LEO->TLC, using the moon's full ORBITAL radius
  // mo.r as its far endpoint) rendered fine at the same zoom. Fix: scale off
  // mo.r (20% of it) instead, so both ends of the cross-frame leg agree on
  // the physical scale of the gap and the arc renders at a consistent size
  // regardless of camera anchor.
  {
    const transitToMoon = { type: 'transit', body: 'Earth', destination: 'Moon' };
    const r = _trajLocalRadius(transitToMoon, 'Moon');
    approx('_trajLocalRadius: transit arriving at its own destination frame -> 50% of moon orbital radius (schematic SOI edge)', r, PROG_MOON_ORBITS.Moon.r * 0.5, 1e-6);
    ok('_trajLocalRadius: still returns null for a transit with no destination', _trajLocalRadius({ type: 'transit', body: 'Sun' }, 'Moon') === null);
    // Parent-frame case (Earth, destination Moon) is UNCHANGED — still
    // returns the moon's orbital radius (used by other consumers, e.g.
    // mission-extent fitting), not the new 20xR fallback.
    approx('_trajLocalRadius: parent-frame transit (Earth->Moon) still returns moon orbital radius, unaffected by the new fallback', _trajLocalRadius(transitToMoon, 'Earth'), PROG_MOON_ORBITS.Moon.r, 1e-6);
  }

  // ── progCalibratedTheta0 / progBodyWorldPosCalibrated (planet-phase
  // calibration for the trajectory view's first-leg-to-a-planet rule) ───────
  {
    // (a) golden: t_dep/t_arr consistent with the TABLE theta0s (a real
    // Hohmann-timed Earth->Mars departure at t_dep=0) should need essentially
    // no calibration offset — the arc already connects under the table values.
    const aHelio = (PROG_HELIO_R.Earth + PROG_HELIO_R.Mars) / 2;
    const tofHelio = Math.PI * Math.sqrt((aHelio * aHelio * aHelio) / PROG_MU_SUN);
    // Tolerance is loose (1e-3 rad, ~0.06 deg) rather than 1e-9: Mars's table
    // theta0 was calibrated against the porkchop plotter's actual Lambert
    // solution (PROG_PORK_DATA, 410), not the pure-Hohmann TOF formula used
    // here — the two agree to within a small residual, not bit-for-bit.
    const offsetGolden = progCalibratedTheta0('Mars', 0, tofHelio, 'Earth');
    approx('progCalibratedTheta0: Earth->Mars at table-consistent Hohmann timing -> offset ~0', offsetGolden, 0, 2e-3);

    // (b) arbitrary time: assert the GEOMETRIC IDENTITY directly rather than
    // trusting the formula derivation — destination's CALIBRATED angle at
    // t_arr must equal departure's angle at t_dep + PI (both normalized).
    const tDep = 12345678, tArr = tDep + 87654321;
    const offsetArb = progCalibratedTheta0('Mars', tDep, tArr, 'Earth');
    const norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const kMars = PROG_BODY_KINEMATICS.Mars;
    const calibratedMarsAngleAtArr = norm(kMars.theta0_rad + offsetArb + 2 * Math.PI * tArr / kMars.period_s);
    const requiredAngle = norm(progBodyAngleAt('Earth', tDep) + Math.PI);
    approx('progCalibratedTheta0: geometric identity — calibrated dest angle at t_arr == depart angle at t_dep + PI', calibratedMarsAngleAtArr, requiredAngle, 1e-9);

    // progBodyWorldPosCalibrated: with offset 0 (no override), must exactly
    // match progBodyWorldPos (drop-in identical behavior when uncalibrated).
    const p0 = progBodyWorldPos('Mars', tArr);
    const p0c = progBodyWorldPosCalibrated('Mars', tArr, {});
    approx('progBodyWorldPosCalibrated: no override -> matches progBodyWorldPos (x)', p0c.x, p0.x, 1e-6);
    approx('progBodyWorldPosCalibrated: no override -> matches progBodyWorldPos (y)', p0c.y, p0.y, 1e-6);

    // With the calibration offset applied, Mars's world position at t_arr
    // should land exactly on the "required" angle (180 deg from Earth's
    // t_dep position) at Mars's orbital radius — i.e. the arc's arrival
    // endpoint construction is self-consistent.
    const pCal = progBodyWorldPosCalibrated('Mars', tArr, { Mars: offsetArb });
    const expX = PROG_HELIO_R.Mars * Math.cos(requiredAngle), expY = PROG_HELIO_R.Mars * Math.sin(requiredAngle);
    approx('progBodyWorldPosCalibrated: calibrated Mars position lands on required Hohmann-arrival angle (x)', pCal.x, expX, 1e-3);
    approx('progBodyWorldPosCalibrated: calibrated Mars position lands on required Hohmann-arrival angle (y)', pCal.y, expY, 1e-3);

    // Moon (a PROG_MOON_ORBITS body, not heliocentric) must move WITH a
    // calibrated Earth if Earth were ever calibrated (it isn't, per spec —
    // Earth is home base and never calibrated — but the recursion plumbing
    // must still be correct: a moon's parent-position input goes through
    // the SAME calibrated path). Verify with a synthetic non-zero Earth
    // override to prove the recursion actually threads through.
    const parentP = progBodyWorldPosCalibrated('Earth', tArr, { Earth: 0.5 });
    const moonP = progBodyWorldPosCalibrated('Moon', tArr, { Earth: 0.5 });
    const moonTheta = progBodyAngleAt('Moon', tArr);
    approx('progBodyWorldPosCalibrated: moon position = calibrated parent position + moon-ring offset (x)', moonP.x, parentP.x + PROG_MOON_ORBITS.Moon.r * Math.cos(moonTheta), 1e-6);
    approx('progBodyWorldPosCalibrated: moon position = calibrated parent position + moon-ring offset (y)', moonP.y, parentP.y + PROG_MOON_ORBITS.Moon.r * Math.sin(moonTheta), 1e-6);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// physics core (P0, 385) — vec3, Stumpff, elements<->state, UV propagation,
// body rails states. See PHYSICS_PLAN.md P0 verification list.
// ═══════════════════════════════════════════════════════════════════════════

{
  // vec3 sanity
  ok('physCross: x cross y = z', JSON.stringify(physCross([1,0,0],[0,1,0])) === '[0,0,1]');
  approx('physMag: 3-4-12 vector', physMag([3,4,12]), 13, 1e-12);
  approx('physDot: orthogonal', physDot([1,2,3],[3,0,-1]), 0, 1e-12);

  // Stumpff limits + continuity at the series switch
  approx('StumpffC(0) series limit', progStumpffC(0), 0.5, 1e-12);
  approx('StumpffS(0) series limit', progStumpffS(0), 1/6, 1e-12);
  approx('StumpffC continuity at +1e-6', progStumpffC(1.0001e-6), 0.5, 1e-6);
  approx('StumpffS continuity at -1e-6', progStumpffS(-1.0001e-6), 1/6, 1e-6);

  const muE = PROG_BODIES.Earth.mu;

  // elements -> state -> elements round-trips across the case matrix
  const CASES = [
    { name: 'LEO circular',        el: { a: 6771,  e: 0,     i: 0,    raan: 0,   argp: 0,   nu: 1.1 } },
    { name: 'GTO',                 el: { a: 24371, e: 0.7306,i: 0,    raan: 0,   argp: 0.5, nu: 2.0 } },
    { name: 'high-e Molniya-ish',  el: { a: 26562, e: 0.74,  i: 1.107,raan: 0.8, argp: 4.94,nu: 0.3 } },
    { name: 'inclined circular',   el: { a: 7178,  e: 0,     i: 0.9,  raan: 2.1, argp: 0,   nu: 5.5 } },
    { name: 'hyperbolic',          el: { a: -8000, e: 1.5,   i: 0.2,  raan: 1.0, argp: 2.2, nu: 0.4 } },
  ];
  CASES.forEach(c => {
    const st = physElementsToState(c.el, muE);
    const back = physStateToElements(st.r, st.v, muE);
    approx(`round-trip a (${c.name})`, back.a, c.el.a, Math.abs(c.el.a) * 1e-9);
    approx(`round-trip e (${c.name})`, back.e, c.el.e, 1e-9);
    approx(`round-trip i (${c.name})`, back.i, c.el.i, 1e-9);
    if (c.el.e > 1e-9) {
      // recompose the in-plane angle sum to dodge raan/argp degeneracy splits
      const inPlane = a => ((a % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
      approx(`round-trip argp+nu (${c.name})`,
        inPlane(back.argp + back.nu), inPlane(c.el.argp + c.el.nu), 1e-8);
    }
  });

  // energy + |h| invariance along a UV propagation
  {
    const st0 = physElementsToState({ a: 24371, e: 0.7306, i: 0, raan: 0, argp: 0.5, nu: 0 }, muE);
    const el0 = physStateToElements(st0.r, st0.v, muE);
    let maxEnergyErr = 0, maxHErr = 0;
    for (let k = 1; k <= 20; k++) {
      const st = physKeplerPropagate(st0.r, st0.v, k * 3000, muE);
      const el = physStateToElements(st.r, st.v, muE);
      maxEnergyErr = Math.max(maxEnergyErr, Math.abs(el.energy - el0.energy));
      maxHErr = Math.max(maxHErr, Math.abs(physMag(el.hVec) - physMag(el0.hVec)));
    }
    ok(`UV propagation: energy invariant along GTO (max err ${maxEnergyErr.toExponential(2)})`, maxEnergyErr < 1e-6 * Math.abs(el0.energy));
    ok(`UV propagation: |h| invariant along GTO (max err ${maxHErr.toExponential(2)})`, maxHErr < 1e-8 * physMag(el0.hVec));
  }

  // one full period returns to the start state
  {
    const el = { a: 6771, e: 0.01, i: 0.3, raan: 1.0, argp: 2.0, nu: 0.7 };
    const st0 = physElementsToState(el, muE);
    const T = physOrbitPeriod(el.a, muE);
    const st1 = physKeplerPropagate(st0.r, st0.v, T, muE);
    approx('UV propagation: full period returns start (pos km)', physMag(physSub(st1.r, st0.r)), 0, 1e-4);
    approx('UV propagation: full period returns start (vel km/s)', physMag(physSub(st1.v, st0.v)), 0, 1e-7);
  }

  // hyperbolic propagation: energy invariant, radius grows outbound
  {
    const st0 = physElementsToState({ a: -8000, e: 1.5, i: 0, raan: 0, argp: 0, nu: 0.1 }, muE);
    const st1 = physKeplerPropagate(st0.r, st0.v, 3600, muE);
    const e0 = physStateToElements(st0.r, st0.v, muE), e1 = physStateToElements(st1.r, st1.v, muE);
    approx('UV propagation: hyperbolic energy invariant', e1.energy, e0.energy, Math.abs(e0.energy) * 1e-8);
    ok('UV propagation: hyperbolic outbound radius grows', physMag(st1.r) > physMag(st0.r));
  }

  // agreement with the trusted schematic layer
  {
    // Hohmann half-ellipse Earth 185 -> 35786 km: propagate periapsis->apoapsis,
    // arrival time must equal progHohmannTOF for the same radii.
    const r1 = PROG_BODIES.Earth.R + 185, r2 = PROG_BODIES.Earth.R + 35786;
    const a = (r1 + r2) / 2, e = (r2 - r1) / (r2 + r1);
    const st0 = physElementsToState({ a, e, i: 0, raan: 0, argp: 0, nu: 0 }, muE);
    const tof = progHohmannTOF('Earth', 185, 35786);
    const st1 = physKeplerPropagate(st0.r, st0.v, tof, muE);
    approx('UV propagation vs progHohmannTOF: half period lands at apoapsis radius', physMag(st1.r), r2, 1);
    approx('physVisViva at periapsis matches state speed', physVisViva(r1, a, muE), physMag(st0.v), 1e-9);
  }

  // body rails states
  {
    const moon = physBodyStateAt('Moon', 0);
    approx('physBodyStateAt: Moon rail speed ~1.018 km/s', physMag(physSub(moon.v, physBodyStateAt('Earth', 0).v)), 1.018, 0.01);
    const earth = physBodyStateAt('Earth', 12345678);
    const pos = progBodyWorldPosCalibrated('Earth', 12345678, {});
    approx('physBodyStateAt: Earth position x = calibrated position source', earth.r[0], pos.x, 1e-6);
    approx('physBodyStateAt: Earth position y = calibrated position source', earth.r[1], pos.y, 1e-6);
    approx('physBodyStateAt: Earth rail speed ~29.78 km/s', physMag(earth.v), 29.78, 0.1);
    // velocity is tangential: v . r = 0 for circular rails
    approx('physBodyStateAt: rail velocity perpendicular to radius', physDot(earth.r, earth.v), 0, 1e-3 * physMag(earth.r));
    ok('physBodyStateAt: z components are 0 (coplanar era)', earth.r[2] === 0 && earth.v[2] === 0);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// physics integrator (P1, 386) — SOI model, frame patching, leapfrog
// propagation. See PHYSICS_PLAN.md P1 verification list. Tolerances were
// tuned empirically (2026-07-09, scratch run): two-body phase error
// ~0.3 km/orbit at 360 steps/orbit; Jacobi drift 7.7e-4 rel over 15 d on a
// deliberately violent e=0.95 lunar-grazing orbit.
// ═══════════════════════════════════════════════════════════════════════════

{
  const muE = PROG_BODIES.Earth.mu, muM = PROG_BODIES.Moon.mu;

  // SOI radii pins
  approx('physSoiRadius: Moon ~66,183 km', physSoiRadius('Moon'), 66183, 50);
  approx('physSoiRadius: Earth ~924,600 km', physSoiRadius('Earth'), 924600, 2000);
  ok('physSoiRadius: Sun infinite', physSoiRadius('Sun') === Infinity);
  ok('physParentOf: Moon->Earth, Earth->Sun, Sun->null',
    physParentOf('Moon') === 'Earth' && physParentOf('Earth') === 'Sun' && physParentOf('Sun') === null);

  // frame finding against real rails
  {
    const e = physBodyStateAt('Earth', 0), m = physBodyStateAt('Moon', 0);
    ok('physFrameOf: point 1000 km from Moon -> Moon', physFrameOf(physAdd(m.r, [1000, 0, 0]), 0, {}) === 'Moon');
    ok('physFrameOf: point 10,000 km from Earth -> Earth', physFrameOf(physAdd(e.r, [10000, 0, 0]), 0, {}) === 'Earth');
    ok('physFrameOf: deep interplanetary point -> Sun', physFrameOf([2.8e8, 2.8e8, 0], 0, {}) === 'Sun');
  }

  // SOI patch continuity: Earth frame -> Moon frame -> back is the identity
  {
    const st = { r: [300000, 100000, 0], v: [0.5, 0.9, 0] };
    const toMoon = physPatchState(st, 'Earth', 'Moon', 12345, {});
    const back = physPatchState(toMoon, 'Moon', 'Earth', 12345, {});
    approx('physPatchState: round-trip position identity', physMag(physSub(back.r, st.r)), 0, 1e-9);
    approx('physPatchState: round-trip velocity identity', physMag(physSub(back.v, st.v)), 0, 1e-12);
  }

  // step ladder: deterministic quantized values, monotone with radius
  {
    const ctx = { center: 'Earth', bodies: ['Earth'] };
    const dtLeo = physStepFor([6771, 0, 0], ctx), dtGeo = physStepFor([42164, 0, 0], ctx);
    ok(`physStepFor: LEO=${dtLeo}s on ladder`, [1,4,16,64,256,1024,4096,16384,65536].includes(dtLeo));
    ok('physStepFor: coarser at GEO than LEO', dtGeo > dtLeo);
  }

  // two-body limit: leapfrog vs analytic Kepler, 20 LEO orbits
  {
    const st0 = physElementsToState({ a: 6771, e: 0.001, i: 0, raan: 0, argp: 0, nu: 0 }, muE);
    const T = physOrbitPeriod(6771, muE);
    const ctx = { center: 'Earth', bodies: ['Earth'] };
    const res = physPropagateSegment(st0, 0, 20 * T, ctx, { maxSamples: 8 });
    const ref = physKeplerPropagate(st0.r, st0.v, res.tF, muE);
    const posErr = physMag(physSub(res.stateF.r, ref.r));
    ok(`integrator two-body limit: 20-orbit position error ${posErr.toFixed(2)} km < 10 km`, posErr < 10);
    const e0 = physStateToElements(st0.r, st0.v, muE), eF = physStateToElements(res.stateF.r, res.stateF.v, muE);
    ok(`integrator two-body limit: energy drift rel ${(Math.abs(eF.energy - e0.energy) / Math.abs(e0.energy)).toExponential(1)} < 1e-12 (symplectic)`,
      Math.abs(eF.energy - e0.energy) < 1e-12 * Math.abs(e0.energy));
  }

  // Jacobi constant, consistent synthetic rails (true CR3BP in relative form)
  {
    const d = 384400;
    const om = Math.sqrt((muE + muM) / (d * d * d)); // consistent: om^2 d^3 = mu1+mu2
    const railFn = (body, t) => {
      if (body === 'Earth') return { r: [0, 0, 0], v: [0, 0, 0] };
      if (body === 'Moon') {
        const th = om * (t || 0);
        return { r: [d * Math.cos(th), d * Math.sin(th), 0], v: [-d * om * Math.sin(th), d * om * Math.cos(th), 0] };
      }
      return { r: [1e12, 1e12, 0], v: [0, 0, 0] }; // park everything else far away
    };
    const jacobi = (st, t) => {
      const th = om * t, f = muM / (muE + muM);
      const rE = [-f * d * Math.cos(th), -f * d * Math.sin(th), 0];
      const vE = [f * d * om * Math.sin(th), -f * d * om * Math.cos(th), 0];
      const rB = physAdd(st.r, rE), vB = physAdd(st.v, vE);
      const c = Math.cos(-th), s = Math.sin(-th);
      const x = c * rB[0] - s * rB[1], y = s * rB[0] + c * rB[1];
      const vx = c * vB[0] - s * vB[1], vy = s * vB[0] + c * vB[1];
      const vrx = vx + om * y, vry = vy - om * x;
      const r1 = physMag(st.r), r2 = physMag(physSub(st.r, railFn('Moon', t).r));
      return om * om * (x * x + y * y) + 2 * (muE / r1 + muM / r2) - (vrx * vrx + vry * vry);
    };
    const st0 = physElementsToState({ a: 200000, e: 0.95, i: 0, raan: 0, argp: 0.5, nu: 0.2 }, muE);
    const ctx = { center: 'Earth', bodies: ['Earth', 'Moon'], railFn };
    const C0 = jacobi(st0, 0);
    let st = st0, t = 0, maxRel = 0;
    for (let k = 0; k < 14 && physFrameOf(st.r, t, {}, railFn) === 'Earth'; k++) {
      const res = physPropagateSegment(st, t, t + 86400, ctx, { maxSamples: 4, handoff: false });
      st = res.stateF; t = res.tF;
      if (res.frame !== 'Earth') break;
      maxRel = Math.max(maxRel, Math.abs(jacobi(st, t) - C0) / Math.abs(C0));
    }
    ok(`integrator CR3BP: Jacobi constant drift ${maxRel.toExponential(1)} < 2e-3 over ${(t / 86400).toFixed(0)} d (e=0.95 lunar-grazing)`, maxRel < 2e-3 && t > 5 * 86400);
  }

  // GOLDEN FREE RETURN (real rails): TLI from 185 km LEO, apogee 455,000 km,
  // burn-point angle 4.5379 rad (seed found by scan, 2026-07-09) -> transits
  // the Moon's SOI and returns to an Earth perigee at ~62 km altitude.
  {
    const rp = PROG_BODIES.Earth.R + 185;
    const apo = 455000, phi = 4.5379;
    const a = (rp + apo) / 2;
    const vP = Math.sqrt(muE * (2 / rp - 1 / a));
    const st0 = { r: [rp * Math.cos(phi), rp * Math.sin(phi), 0], v: [-vP * Math.sin(phi), vP * Math.cos(phi), 0] };
    const ctx = { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'] };
    const res = physPropagateSegment(st0, 0, 12 * 86400, ctx, { maxSamples: 64 });
    const soiIn = res.events.find(e => e.type === 'soi' && e.to === 'Moon');
    const soiOut = res.events.find(e => e.type === 'soi' && e.from === 'Moon');
    ok('free return: enters then exits the Moon SOI', !!soiIn && !!soiOut && soiOut.t > soiIn.t);
    const peri = res.events.filter(e => e.type === 'periapsis' && e.frame === 'Earth' && soiOut && e.t > soiOut.t);
    ok('free return: post-flyby Earth periapsis exists', peri.length > 0);
    if (peri.length) {
      const hPeri = peri[0].rMag - PROG_BODIES.Earth.R;
      ok(`free return: return perigee altitude ${hPeri.toFixed(0)} km within [0, 2000] km band`, hPeri >= 0 && hPeri <= 2000);
    }
    // determinism: an identical second run is bit-identical
    const res2 = physPropagateSegment(st0, 0, 12 * 86400, ctx, { maxSamples: 64 });
    ok('determinism: identical runs produce identical samples + events',
      JSON.stringify(res.samples) === JSON.stringify(res2.samples) && JSON.stringify(res.events) === JSON.stringify(res2.events));
  }

  // event bisection
  {
    const t = physFindEventTime(x => x - 42.5, 0, 100, 1e-6);
    approx('physFindEventTime: locates crossing', t, 42.5, 1e-4);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P2 — mission physics bridge (565): analytic phasing + solved node burns
// ═══════════════════════════════════════════════════════════════════════════
{
  const { physPhaseBurnAngle, physSolveNodeBurn, physSchematicCoastTof,
          physKeplerPropagate, physMissionLeg, progBodyAngleAt, progHohmannTOF,
          PROG_BODIES, PROG_MOON_ORBIT_R, _physTrajByMission } =
    vm.runInContext('({ physPhaseBurnAngle, physSolveNodeBurn, physSchematicCoastTof, physKeplerPropagate, physMissionLeg, progBodyAngleAt, progHohmannTOF, PROG_BODIES, PROG_MOON_ORBIT_R, _physTrajByMission })', sandbox);

  // phasing geometry: burn point diametrically opposite the arrival point
  approx('P2 phasing: arrival at π → burn at 0', physPhaseBurnAngle(Math.PI), 0, 1e-12);
  approx('P2 phasing: arrival at 0.5 → burn at 0.5+π', physPhaseBurnAngle(0.5), 0.5 + Math.PI, 1e-12);
  ok('P2 phasing: normalized to [0,2π)', physPhaseBurnAngle(-1) >= 0 && physPhaseBurnAngle(7) < 2 * Math.PI);

  // schematic coast TOF conventions
  const leo = { type: 'circular', body: 'Earth', perigee: 185, apogee: 185 };
  const tlc = { type: 'transit', body: 'Earth', c3: -1.9, destination: 'Moon' };
  const geo = { type: 'circular', body: 'Earth', perigee: 35786, apogee: 35786 };
  const tofMoon = physSchematicCoastTof(leo, tlc);
  approx('P2 coast TOF: LEO→TLC equals translunar half-ellipse',
    tofMoon, progHohmannTOF('Earth', 185, PROG_MOON_ORBIT_R - PROG_BODIES.Earth.R), 1);
  approx('P2 coast TOF: LEO→GEO equals Hohmann',
    physSchematicCoastTof(leo, geo), progHohmannTOF('Earth', 185, 35786), 1);

  // solved-burn magnitude parity: |dvVec| is exactly the engine-supplied value
  const burnP = physSolveNodeBurn(leo, tlc, 86400 * 3, 3.15);
  ok('P2 solved burn: returns a state for LEO→TLC', !!burnP && !!burnP.state);
  approx('P2 solved burn: |dvVec| equals supplied magnitude',
    Math.hypot(burnP.dvVec[0], burnP.dvVec[1], burnP.dvVec[2]), 3.15, 1e-12);
  ok('P2 solved burn: cislunar body set', burnP.bodies.includes('Earth') && burnP.bodies.includes('Moon'));

  // GOLDEN — analytic phasing arrival: a true Hohmann burn placed by
  // physSolveNodeBurn, propagated two-body for the schematic TOF, must land
  // on the Moon's railed position at arrival (consistent inputs: same rails,
  // same TOF; pure geometry, no perturbations).
  {
    const tDep = 86400 * 5;
    const muE = PROG_BODIES.Earth.mu;
    const r1 = PROG_BODIES.Earth.R + 185, r2 = PROG_MOON_ORBIT_R;
    const aT = (r1 + r2) / 2;
    const dvHoh = Math.sqrt(muE * (2 / r1 - 1 / aT)) - Math.sqrt(muE / r1); // km/s
    const b = physSolveNodeBurn(leo, tlc, tDep, dvHoh);
    const st = physKeplerPropagate(b.state.r, b.state.v, b.coastTof_s, muE);
    ok('P2 golden: Kepler propagation converged', !!st);
    const moonAng = progBodyAngleAt('Moon', tDep + b.coastTof_s);
    const moonPos = [r2 * Math.cos(moonAng), r2 * Math.sin(moonAng), 0];
    const missKm = Math.hypot(st.r[0] - moonPos[0], st.r[1] - moonPos[1], st.r[2] - moonPos[2]);
    ok(`P2 golden: Hohmann arrival lands on the Moon's railed position (miss ${missKm.toFixed(1)} km < 500 km)`,
      missKm < 500);
  }

  // side-table accessor
  {
    _physTrajByMission['test-mid'] = { legs: [{ authIdx: 2, tof_s: 42 }] };
    ok('P2 side-table: physMissionLeg finds by authIdx', physMissionLeg('test-mid', 2).tof_s === 42);
    ok('P2 side-table: miss returns null', physMissionLeg('test-mid', 5) === null && physMissionLeg('nope', 0) === null);
    delete _physTrajByMission['test-mid'];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// summary
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total assertions)`);
if (fail > 0) {
  console.error('\nFailed assertions:');
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
