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
  'src/js/430-program-module-phase-8-node-map.js',
  'src/js/570-mission-core-state.js',
  'src/js/570-mission-event-model.js',
  'src/js/570-mission-interaction-state.js',
  'src/js/570-mission-manager.js',
  'src/js/574-trajectory-view.js',
  'src/js/5745-maneuver-gizmo.js',
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
  progBodyWorldPosCalibrated, progBodyEphemState, progBodyLocalEphemState,
  progKeplerSolveE, progEpochJD, progHelioPos, progHelioVel, progPorkchopGrid,
  _trajArcRotationForTarget, _trajLegPathFraction, _trajArcPointAt, _trajLodOpacity,
  _trajTransferArcPath, _trajCorridorMoon, _trajOrbitLabel, _trajLocalRadius,
  physV3, physAdd, physSub, physScale, physDot, physCross, physMag,
  physOrbitPeriod, physVisViva, physElementsToState, physStateToElements,
  physKeplerPropagate, physBodyStateAt, progStumpffC, progStumpffS,
  physSoiRadius, physFrameOf, physPatchState, physAccel, physStepFor,
  physLeapfrogStep, physFindEventTime, physPropagateSegment, physParentOf,
  physMissionLeg, _trajGizmoClosestApproach, physEscapeHorizonS,
  _nmSoiLayoutRadius, _nmEdgePhysicsAnnotation, _trajEventNodeInfo,
  _nmMatchOrbitToNode, _nmClassifySettledOrbit,
  _trajLatLonUnit, _trajSpinRotate, _trajBodySpinAngle, _trajTrueBodyRadiusKm,
  _evIsSolvedManeuver, _evManeuverTarget, _evIsManualBurn, _missionMigrateManeuverEntry,
} = sandbox;
const { G0, MU, RE, OMEGA_E, PROG_BODIES, PROG_HELIO_R, PROG_MU_SUN, PROG_MOON_ORBITS, PROG_BODY_ELEMENTS, PROG_MOON_ELEMENTS, PROG_DEFAULT_EPOCH_JD } =
  vm.runInContext('({ G0, MU, RE, OMEGA_E, PROG_BODIES, PROG_HELIO_R, PROG_MU_SUN, PROG_MOON_ORBITS, PROG_BODY_ELEMENTS, PROG_MOON_ELEMENTS, PROG_DEFAULT_EPOCH_JD })', sandbox);

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
// R1 real ephemeris rails (360) — element evaluation, epoch, porkchop dates.
// Replaces the old C1a circular-kinematics + theta0-calibration pins
// (2026-07-09: PROG_BODY_KINEMATICS / progCalibratedTheta0 retired).
// ═══════════════════════════════════════════════════════════════════════════
{
  const mag3 = v => Math.hypot(v[0], v[1], v[2]);

  ok('R1: all 8 planets have JPL elements', ['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune'].every(b => !!PROG_BODY_ELEMENTS[b]));
  ok('R1: Moon + Titan have moon elements', !!PROG_MOON_ELEMENTS.Moon && !!PROG_MOON_ELEMENTS.Titan);
  approx('R1: default epoch JD = 2461230.5 (2026-07-09)', PROG_DEFAULT_EPOCH_JD, 2461230.5, 1e-9);
  approx('R1: progEpochJD() falls back to default with no program', progEpochJD(), 2461230.5, 1e-9);

  // Kepler solver sanity: E - e·sinE == M
  [[0.3, 0.0167], [2.5, 0.2056], [-1.2, 0.0549], [3.0, 0.7]].forEach(([M, e]) => {
    const E = progKeplerSolveE(M, e);
    approx(`R1: Kepler solve residual ~0 (M=${M}, e=${e})`, E - e * Math.sin(E), M, 1e-7);
  });

  // Earth heliocentric distance at T=0 within the real range, and |r| VARIES
  // over half a year (eccentricity is real, not a circle).
  const rE0 = mag3(progBodyEphemState('Earth', 0).r);
  ok(`R1: Earth |r| at epoch in [1.467e8, 1.53e8] km (got ${rE0.toExponential(4)})`, rE0 >= 1.467e8 && rE0 <= 1.53e8);
  let rEmin = Infinity, rEmax = 0;
  for (let d = 0; d < 366; d += 2) { const r = mag3(progBodyEphemState('Earth', d * 86400).r); rEmin = Math.min(rEmin, r); rEmax = Math.max(rEmax, r); }
  ok(`R1: Earth |r| varies over a year (range ${((rEmax - rEmin)/1e6).toFixed(1)}e6 km > 3e6)`, rEmax - rEmin > 3e6);
  ok('R1: Earth perihelion/aphelion in real bands', rEmin > 1.45e8 && rEmin < 1.48e8 && rEmax > 1.51e8 && rEmax < 1.53e8);

  // Mercury: e ≈ 0.2056 reflected in min/max radius over one Mercury year.
  let rMmin = Infinity, rMmax = 0;
  for (let d = 0; d < 88; d++) { const r = mag3(progBodyEphemState('Mercury', d * 86400).r); rMmin = Math.min(rMmin, r); rMmax = Math.max(rMmax, r); }
  approx('R1: Mercury implied e = (rmax-rmin)/(rmax+rmin) ~ 0.2056', (rMmax - rMmin) / (rMmax + rMmin), 0.2056, 0.005);

  // Moon: real 5.145° inclination shows as out-of-ecliptic z over a month
  // (sin(5.145°)·384,400 ≈ 34,480 km amplitude; measured max 36,210 km with
  // the eccentric radius — assert in [30000, 38000]).
  let zMax = 0;
  for (let h = 0; h < 28 * 24; h += 2) {
    const loc = progBodyLocalEphemState('Moon', h * 3600).r;
    zMax = Math.max(zMax, Math.abs(loc[2]));
  }
  ok(`R1: Moon |z| amplitude ${zMax.toFixed(0)} km in [30000, 38000]`, zMax >= 30000 && zMax <= 38000);
  // Moon radius range covers the real perigee..apogee band (eccentric orbit)
  let lrMin = Infinity, lrMax = 0;
  for (let h = 0; h < 28 * 24; h += 2) { const lr = mag3(progBodyLocalEphemState('Moon', h * 3600).r); lrMin = Math.min(lrMin, lr); lrMax = Math.max(lrMax, lr); }
  ok(`R1: Moon geocentric distance varies (${lrMin.toFixed(0)}..${lrMax.toFixed(0)} km)`, lrMin > 3.5e5 && lrMin < 3.7e5 && lrMax > 4.0e5 && lrMax < 4.1e5);

  // Velocity consistency: analytic v vs central-difference dr/dt < 1e-3 km/s.
  const velErr = (body, t) => {
    const h = 10;
    const rp = progBodyEphemState(body, t + h).r, rm = progBodyEphemState(body, t - h).r;
    const vn = [(rp[0] - rm[0]) / (2 * h), (rp[1] - rm[1]) / (2 * h), (rp[2] - rm[2]) / (2 * h)];
    const va = progBodyEphemState(body, t).v;
    return Math.hypot(vn[0] - va[0], vn[1] - va[1], vn[2] - va[2]);
  };
  ok(`R1: Earth velocity analytic == numeric (err ${velErr('Earth', 5e6).toExponential(1)} < 1e-3 km/s)`, velErr('Earth', 5e6) < 1e-3);
  ok(`R1: Moon velocity analytic == numeric (err ${velErr('Moon', 5e6).toExponential(1)} < 1e-3 km/s)`, velErr('Moon', 5e6) < 1e-3);
  ok(`R1: Titan velocity analytic == numeric (err ${velErr('Titan', 5e6).toExponential(1)} < 1e-3 km/s)`, velErr('Titan', 5e6) < 1e-3);

  // Epoch: shifting epochJD by exactly one Earth year (365.25 d) returns
  // Earth to ~the same position (< 2e5 km — sidereal-vs-Julian year residual).
  const e0 = progBodyEphemState('Earth', 0);
  sandbox.PROG_ACTIVE_PROGRAM = { epochJD: 2461230.5 + 365.25 };
  const e1 = progBodyEphemState('Earth', 0);
  sandbox.PROG_ACTIVE_PROGRAM = undefined;
  const shiftKm = Math.hypot(e1.r[0] - e0.r[0], e1.r[1] - e0.r[1], e1.r[2] - e0.r[2]);
  ok(`R1: epoch +365.25 d returns Earth to ~same position (${shiftKm.toFixed(0)} km < 2e5)`, shiftKm < 2e5);

  // progBodyAngleAt: normalized, and Sun-relative geometry composes: Moon
  // world pos == Earth world pos + Moon local pos.
  const angBig = progBodyAngleAt('Mars', 1e10);
  ok('R1: progBodyAngleAt normalizes to [0, 2π)', angBig >= 0 && angBig < 2 * Math.PI);
  const sunPos = progBodyWorldPos('Sun', 12345);
  ok('R1: progBodyWorldPos(Sun) == origin', sunPos.x === 0 && sunPos.y === 0);
  {
    const t = 5 * 86400;
    const eP = progBodyEphemState('Earth', t), mP = progBodyEphemState('Moon', t), mLoc = progBodyLocalEphemState('Moon', t);
    approx('R1: Moon world = Earth world + Moon local (x)', mP.r[0], eP.r[0] + mLoc.r[0], 1e-6);
    approx('R1: Moon world = Earth world + Moon local (z)', mP.r[2], eP.r[2] + mLoc.r[2], 1e-6);
  }

  // progBodyWorldPosCalibrated is now a thin alias: overrides IGNORED.
  {
    const t = 9.87e6;
    const a = progBodyWorldPos('Mars', t), b = progBodyWorldPosCalibrated('Mars', t, { Mars: 1.5 });
    ok('R1: progBodyWorldPosCalibrated ignores overrides (alias)', a.x === b.x && a.y === b.y);
  }

  // Porkchop on real ephemeris: progHelioPos == ecliptic projection of the
  // ephemeris; the Earth→Mars grid has a finite optimum at a REAL window
  // (default epoch 2026-07-09: measured c3_min 8.90 km²/s² at dep_day 118,
  // TOF 327 d ≈ the real late-2026 Mars window; old calibrated fiction pinned
  // the optimum near dep_day 0 by construction).
  {
    const hp = progHelioPos('Earth', 42);
    const st = progBodyEphemState('Earth', 42 * 86400);
    approx('R1 porkchop: progHelioPos == ephemeris x (z dropped)', hp[0], st.r[0], 1e-6);
    approx('R1 porkchop: progHelioPos == ephemeris y (z dropped)', hp[1], st.r[1], 1e-6);
    const gm = progPorkchopGrid('Earth', 'Mars', {});
    ok(`R1 porkchop golden: Mars c3_min ${gm.c3_min.toFixed(2)} in [5, 15] km²/s²`, gm.c3_min >= 5 && gm.c3_min <= 15);
    ok(`R1 porkchop golden: Mars optimal dep_day ${gm.c3_min_dep.toFixed(0)} in [80, 160], tof ${gm.c3_min_tof.toFixed(0)} in [250, 400]`,
      gm.c3_min_dep >= 80 && gm.c3_min_dep <= 160 && gm.c3_min_tof >= 250 && gm.c3_min_tof <= 400);
    const gvGrid = progPorkchopGrid('Earth', 'Venus', {});
    ok(`R1 porkchop golden: Venus c3_min ${gvGrid.c3_min.toFixed(2)} in [3, 12] km²/s²`, gvGrid.c3_min >= 3 && gvGrid.c3_min <= 12);
  }
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

  // (R1, 2026-07-09: progCalibratedTheta0 and the planet-phase calibration
  // pins retired with the calibration itself — real ephemeris rails need no
  // offsets; progBodyWorldPosCalibrated is a thin alias, pinned in the R1
  // ephemeris block above.)
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

  // body rails states — R1 re-goldened (2026-07-09): circular-rail pins
  // (Moon 1.018 km/s exact, Earth 29.78 km/s, v⊥r, z=0) replaced by real
  // element-evaluated values at FIXED t. Real Moon speed varies ~0.97–1.08
  // km/s over its eccentric orbit (measured 1.0618 at t=0, default epoch);
  // Earth speed at t=0 is 29.292 km/s (near aphelion in July).
  {
    const moon = physBodyStateAt('Moon', 0);
    const moonRel = physMag(physSub(moon.v, physBodyStateAt('Earth', 0).v));
    approx('physBodyStateAt: Moon speed rel Earth at t=0 (real rails; was 1.018 circular)', moonRel, 1.0618, 0.005);
    const earth = physBodyStateAt('Earth', 12345678);
    const pos = progBodyWorldPos('Earth', 12345678);
    approx('physBodyStateAt: Earth position x = the ONE position source', earth.r[0], pos.x, 1e-6);
    approx('physBodyStateAt: Earth position y = the ONE position source', earth.r[1], pos.y, 1e-6);
    approx('physBodyStateAt: Earth speed at epoch ~29.29 km/s (aphelion season; was 29.78 circular)', physMag(physBodyStateAt('Earth', 0).v), 29.292, 0.05);
    ok('physBodyStateAt: Moon state is 3D (z ≠ 0 — real 5.145° inclination)',
      Math.abs(physBodyStateAt('Moon', 7 * 86400).r[2] - physBodyStateAt('Earth', 7 * 86400).r[2]) > 1000);
    // overrides are ignored (calibration retired) — same state either way
    const a = physBodyStateAt('Mars', 1e6, {}), b = physBodyStateAt('Mars', 1e6, { Mars: 2.0 });
    ok('physBodyStateAt: overrides ignored (R1 alias behavior)', a.r[0] === b.r[0] && a.v[1] === b.v[1]);
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
    // 2026-07-10 (R3 perf): ladder densified to powers of 2 — the pow-4
    // buckets quantized dt ~3.7x below the accuracy policy (measured 612k
    // steps per shoot campaign, dominating cold recompute). LEO lands on 8 s
    // (was 4 s under the pow-4 ladder).
    ok(`physStepFor: LEO=${dtLeo}s on ladder`, [1,2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,16384,32768,65536].includes(dtLeo));
    ok('physStepFor: coarser at GEO than LEO', dtGeo > dtLeo);
    ok('physStepFor: ctx.stepsPerOrbit coarsens deterministically', physStepFor([6771, 0, 0], Object.assign({}, ctx, { stepsPerOrbit: 90 })) > dtLeo);
  }

  // two-body limit: leapfrog vs analytic Kepler, 20 LEO orbits
  {
    const st0 = physElementsToState({ a: 6771, e: 0.001, i: 0, raan: 0, argp: 0, nu: 0 }, muE);
    const T = physOrbitPeriod(6771, muE);
    const ctx = { center: 'Earth', bodies: ['Earth'] };
    const res = physPropagateSegment(st0, 0, 20 * T, ctx, { maxSamples: 8 });
    const ref = physKeplerPropagate(st0.r, st0.v, res.tF, muE);
    const posErr = physMag(physSub(res.stateF.r, ref.r));
    // 2026-07-10 (R3 perf): 10 km -> 30 km with the pow-2 ladder (dt doubled
    // at LEO -> 2nd-order phase error x4; measured 23.35 km). A deliberate
    // accuracy-for-speed trade — schematic-grade per MATH.md critique 28.
    ok(`integrator two-body limit: 20-orbit position error ${posErr.toFixed(2)} km < 30 km`, posErr < 30);
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

  // GOLDEN FREE RETURN (REAL ephemeris rails): TLI from 185 km LEO.
  // R1 re-scan (2026-07-09, same day as the original circular-rail scan):
  // the real Moon is eccentric + inclined 5.145°, so the coplanar burn's
  // geometry shifted — old golden apo 455,000 km / phi 4.5379 rad / ~62 km
  // return perigee → NEW golden apo 445,000 km / phi 4.98 rad / ~201 km
  // return perigee (scan: scratchpad r1_scan.js, apogee × burn-angle grid).
  {
    const rp = PROG_BODIES.Earth.R + 185;
    const apo = 445000, phi = 4.98;
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
          PROG_BODIES, PROG_MOON_ORBIT_R, _physTrajByMission,
          physLegStateAt, physNextMnodeMetAfter } =
    vm.runInContext('({ physPhaseBurnAngle, physSolveNodeBurn, physSchematicCoastTof, physKeplerPropagate, physMissionLeg, progBodyAngleAt, progHohmannTOF, PROG_BODIES, PROG_MOON_ORBIT_R, _physTrajByMission, physLegStateAt, physNextMnodeMetAfter })', sandbox);

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

  // GOLDEN — analytic phasing arrival vs the REAL Moon. R1 re-golden
  // (2026-07-09): the old circular-rail assertion (miss < 500 km) is
  // unreachable against the real Moon — the coplanar mean-radius Hohmann
  // aims at the Moon's in-plane ANGLE, but the real Moon's radius varies
  // 363k–405k km and it sits up to ~36,000 km out of the ecliptic. Measured
  // miss at tDep = 5 d (default epoch): 14,036 km — assert the phasing still
  // delivers the arrival deep inside the Moon's SOI (< 25,000 km ≪ 66,183).
  {
    const tDep = 86400 * 5;
    const muE = PROG_BODIES.Earth.mu;
    const r1 = PROG_BODIES.Earth.R + 185, r2 = PROG_MOON_ORBIT_R;
    const aT = (r1 + r2) / 2;
    const dvHoh = Math.sqrt(muE * (2 / r1 - 1 / aT)) - Math.sqrt(muE / r1); // km/s
    const b = physSolveNodeBurn(leo, tlc, tDep, dvHoh);
    const st = physKeplerPropagate(b.state.r, b.state.v, b.coastTof_s, muE);
    ok('P2 golden: Kepler propagation converged', !!st);
    const { progBodyEphemState } = sandbox;
    const eSt = progBodyEphemState('Earth', tDep + b.coastTof_s), mSt = progBodyEphemState('Moon', tDep + b.coastTof_s);
    const moonPos = [mSt.r[0] - eSt.r[0], mSt.r[1] - eSt.r[1], mSt.r[2] - eSt.r[2]];
    const missKm = Math.hypot(st.r[0] - moonPos[0], st.r[1] - moonPos[1], st.r[2] - moonPos[2]);
    ok(`P2 golden (R1): Hohmann arrival lands inside the real Moon's SOI (miss ${missKm.toFixed(0)} km < 25,000; was <500 vs circular rails)`,
      missKm < 25000);
  }

  // side-table accessor
  {
    _physTrajByMission['test-mid'] = { legs: [{ authIdx: 2, tof_s: 42 }] };
    ok('P2 side-table: physMissionLeg finds by authIdx', physMissionLeg('test-mid', 2).tof_s === 42);
    ok('P2 side-table: miss returns null', physMissionLeg('test-mid', 5) === null && physMissionLeg('nope', 0) === null);
    delete _physTrajByMission['test-mid'];
  }

  // physNextMnodeMetAfter — round-3 item 5 (mid-leg maneuver placement)
  {
    const log = [
      { type: 'LAUNCH' },
      { type: 'MNODE', at: { kind: 'met', value_s: 500 } },
      { type: 'MNODE', metStart: 900 },
      { type: 'MNODE', at: { kind: 'met', value_s: 0 } },
    ];
    ok('physNextMnodeMetAfter: finds the next MNODE by value_s', physNextMnodeMetAfter({ log }, 0) === 500);
    ok('physNextMnodeMetAfter: falls back to metStart', physNextMnodeMetAfter({ log }, 1) === 900);
    ok('physNextMnodeMetAfter: no later MNODE with a determinable met -> null after the last usable one',
      physNextMnodeMetAfter({ log }, 2) === 0);
    ok('physNextMnodeMetAfter: past the end -> null', physNextMnodeMetAfter({ log }, 3) === null);
    ok('physNextMnodeMetAfter: empty/missing log -> null', physNextMnodeMetAfter({ log: [] }, 0) === null && physNextMnodeMetAfter(null, 0) === null);
  }

  // physLegStateAt — round-3 item 5: exact mid-leg re-propagation off a leg's
  // own recorded initState/center/bodies (built by physRebuildMissionTrajectories,
  // reused here directly against a synthetic leg record — the same shape).
  {
    const muE = PROG_BODIES.Earth.mu;
    const r0 = PROG_BODIES.Earth.R + 185;
    const v0 = Math.sqrt(muE / r0);
    const state0 = { r: [r0, 0, 0], v: [0, v0, 0] };
    const T = physOrbitPeriod(muE, r0);
    const legMet = 1000;
    const ctx = { center: 'Earth', bodies: ['Earth'], overrides: {}, dtMax: undefined };
    const full = physPropagateSegment(state0, legMet, legMet + T, ctx, { maxSamples: 64 });
    _physTrajByMission['test-legstate'] = { legs: [{
      authIdx: 7, met: legMet, initState: state0, center: 'Earth', bodies: ['Earth'], dtMax: undefined,
      samples: full.samples, kind: 'mnode',
    }] };
    const tQuery = legMet + T / 4;
    const st = physLegStateAt('test-legstate', 7, tQuery);
    ok('physLegStateAt: returns a state inside the leg span', !!st && !!st.r && !!st.v && st.frame === 'Earth');
    // cross-check against the analytic two-body propagation of the same
    // initial state to the same query time — the exact quantity a mid-leg
    // maneuver placement needs (independent of the leg's own decimated
    // sample spacing).
    const expected = physKeplerPropagate(state0.r, state0.v, tQuery - legMet, muE);
    const deltaKm = (st && expected) ? Math.hypot(st.r[0] - expected.r[0], st.r[1] - expected.r[1], st.r[2] - expected.r[2]) : Infinity;
    // physPropagateSegment's numerical integrator (maxSamples-driven step
    // size) vs. the closed-form Kepler solution over a quarter LEO period —
    // a few hundred km of integration error is expected at this coarseness;
    // catches gross basis/frame errors (which would be off by thousands+ km).
    ok(`physLegStateAt: matches analytic two-body propagation closely (Δ ${deltaKm.toFixed(2)} km)`, deltaKm < 1500);
    ok('physLegStateAt: null before the leg starts', physLegStateAt('test-legstate', 7, legMet - 10) === null);
    ok('physLegStateAt: null after the last sample', physLegStateAt('test-legstate', 7, legMet + T + 10) === null);
    ok('physLegStateAt: null for a missing leg/mission', physLegStateAt('test-legstate', 99, tQuery) === null && physLegStateAt('nope', 7, tQuery) === null);
    delete _physTrajByMission['test-legstate'];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P3 — escape hyperbola geometry (385): physEscapeGeometry
// ═══════════════════════════════════════════════════════════════════════════
{
  const { physEscapeGeometry, physSoiRadius, PROG_BODIES } =
    vm.runInContext('({ physEscapeGeometry, physSoiRadius, PROG_BODIES })', sandbox);

  // closed forms across two (rp, c3) pairs (Earth departure, Mars-ish + fast)
  const muE = PROG_BODIES.Earth.mu;
  [[6563, 8.7], [6749, 56.7]].forEach(([rp, c3]) => {
    const g = physEscapeGeometry(rp, c3, muE, 1);
    ok(`P3 escape: hyperbolic (e>1) for rp=${rp}, C3=${c3}`, g && g.e > 1);
    approx(`P3 escape: e closed form (rp=${rp}, C3=${c3})`, g.e, 1 + rp * c3 / muE, 1e-12);
    approx(`P3 escape: beta = acos(1/e) closed form (rp=${rp}, C3=${c3})`, g.beta, Math.acos(1 / g.e), 0);
    approx(`P3 escape: vInf = sqrt(C3) (rp=${rp}, C3=${c3})`, g.vInf, Math.sqrt(c3), 1e-12);
  });

  // sample radii monotonically increase from rp out to rSoi
  {
    const rp = 6563, c3 = 8.7;
    const g = physEscapeGeometry(rp, c3, muE, 1);
    const rSoi = physSoiRadius('Earth');
    ok('P3 escape: Earth SOI radius sane (~9.25e5 km)', rSoi > 9e5 && rSoi < 9.5e5);
    const pts = g.samplePoints(rSoi, 40);
    ok('P3 escape: n+1 sample points', pts.length === 41);
    let mono = true, prevR = 0;
    pts.forEach(p => { const r = Math.hypot(p[0], p[1]); if (r < prevR - 1e-6) mono = false; prevR = r; });
    ok('P3 escape: sample radii monotonically increasing', mono);
    approx('P3 escape: first point at periapsis rp', Math.hypot(pts[0][0], pts[0][1]), rp, 1e-6);
    approx('P3 escape: last point at rSoi', Math.hypot(pts[40][0], pts[40][1]), rSoi, rSoi * 1e-9);
    ok('P3 escape: periapsis on +x (caller rotates)', Math.abs(pts[0][1]) < 1e-9 && pts[0][0] > 0);
    // mirror branch: outboundSign -1 flips y
    const gm = physEscapeGeometry(rp, c3, muE, -1);
    const pm = gm.samplePoints(rSoi, 40);
    approx('P3 escape: mirror branch flips y', pm[20][1], -pts[20][1], 1e-9);
  }

  // degenerate guards: bound/parabolic energies have no asymptote to draw
  ok('P3 escape: c3<=0 returns null', physEscapeGeometry(6563, 0, muE, 1) === null && physEscapeGeometry(6563, -1.9, muE, 1) === null);
  ok('P3 escape: bad rp/mu return null', physEscapeGeometry(0, 8.7, muE, 1) === null && physEscapeGeometry(6563, 8.7, 0, 1) === null);
}

// ═══════════════════════════════════════════════════════════════════════════
// P4 — targeting & authoring (565): differential corrector + free return
// ═══════════════════════════════════════════════════════════════════════════
{
  const { physShootToTarget, physShootLegAim, physFreeReturnSolve, physAimBurnState,
          physClosestApproachKm, physSoiRadius, physPropagateSegment, PROG_BODIES, PROG_MOON_ORBIT_R } =
    vm.runInContext('({ physShootToTarget, physShootLegAim, physFreeReturnSolve, physAimBurnState, physClosestApproachKm, physSoiRadius, physPropagateSegment, PROG_BODIES, PROG_MOON_ORBIT_R })', sandbox);

  const leo = { type: 'circular', body: 'Earth', perigee: 185, apogee: 185 };
  const tlc = { type: 'transit', body: 'Earth', c3: -1.9, destination: 'Moon' };
  const muE = PROG_BODIES.Earth.mu;
  const r1 = PROG_BODIES.Earth.R + 185, r2 = PROG_MOON_ORBIT_R;
  const aT = (r1 + r2) / 2;
  const dvHoh = Math.sqrt(muE * (2 / r1 - 1 / aT)) - Math.sqrt(muE / r1); // km/s
  const soiMoon = physSoiRadius('Moon');

  // shooter converges on a seeded Earth->Moon case with FIXED |dv|
  {
    const sol = physShootLegAim(leo, tlc, 86400 * 5, dvHoh, {}, {});
    ok('P4 shooter: returns a solution record for LEO→TLC', !!sol);
    ok(`P4 shooter: Earth→Moon converged (miss ${sol && sol.missKm.toFixed(0)} km < SOI/3 ${(soiMoon / 3).toFixed(0)} km) in ${sol && sol.iters} iters`,
      !!sol && sol.converged && sol.missKm < soiMoon / 3 && sol.iters <= 12);
    // the solved aim actually enters the Moon's SOI when propagated normally
    if (sol && sol.converged) {
      const bs = physAimBurnState('Earth', r1, sol.theta, sol.pitch, dvHoh);
      const res = physPropagateSegment({ r: bs.r, v: bs.v }, 86400 * 5, 86400 * 5 + 1.5 * 430000,
        { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'] }, { maxSamples: 128 });
      ok('P4 shooter: solved aim enters the Moon SOI', res.events.some(ev => ev.type === 'soi' && ev.to === 'Moon'));
      const ca = physClosestApproachKm(res, 'Moon', {});
      ok(`P4 shooter: closest approach ${ca.dKm.toFixed(0)} km < SOI/3`, ca.dKm < soiMoon / 3);
    }
    // |dv| is never modified: solution state's dv magnitude is exactly dvHoh
    if (sol) {
      const bs = physAimBurnState('Earth', r1, sol.theta, sol.pitch, dvHoh);
      approx('P4 shooter: |dvVec| magnitude parity (never retuned)',
        Math.hypot(bs.dvVec[0], bs.dvVec[1], bs.dvVec[2]), dvHoh, 1e-12);
    }
    // determinism: identical inputs -> identical solve
    const sol2 = physShootLegAim(leo, tlc, 86400 * 5, dvHoh, {}, {});
    ok('P4 shooter: deterministic (identical repeat solve)',
      !!sol && !!sol2 && sol.theta === sol2.theta && sol.pitch === sol2.pitch &&
      sol.missKm === sol2.missKm && sol.iters === sol2.iters);
  }

  // unreachable target: dv 10x too small -> clean converged:false, bounded work
  {
    let threw = false, sol = null;
    try { sol = physShootLegAim(leo, tlc, 86400 * 5, dvHoh / 10, {}, {}); } catch (e) { threw = true; }
    ok('P4 shooter: unreachable (dv/10) does not throw', !threw);
    ok('P4 shooter: unreachable returns converged:false', !!sol && !sol.converged);
    ok(`P4 shooter: unreachable bounded (${sol && sol.propagations} propagations ≤ 66)`, !!sol && sol.propagations <= 66);
    // generic corrector: unreachable 1-DOF case terminates within maxIter
    const flat = physShootToTarget(
      x => ({ r: [7000 * Math.cos(x[0]), 7000 * Math.sin(x[0]), 0], v: [0, 0, 0] }),
      () => [1e6],   // constant huge miss, zero gradient -> singular Jacobian
      [0], { propagate: st => ({ samples: [], events: [] }), tolKm: 1, maxIter: 12 });
    ok('P4 corrector: singular Jacobian terminates converged:false', flat.converged === false && flat.iters <= 12);
  }

  // free-return solve reproduces the P1 golden band.
  // R3 re-golden (2026-07-10): physFreeReturnSolve now solves from an
  // INCLINED parking orbit (incDeg param, default 28.5°) with a deterministic
  // seed scan replacing the rotated-golden shortcut. Old default (ecliptic
  // ring): met 4187 s / dv 3149 m/s / perigee ≈ 164 km at 0 iters. New
  // default (28.5° ring): met ≈ 5101 s / dv ≈ 3148 m/s / perigee ≈ 279 km.
  // The explicit incDeg=0 solve stays in the old bands (perigee ≈ 195 km
  // with the scanned seed).
  {
    const fr = physFreeReturnSolve(185, 0, {});
    ok('P4/R3 free return: solve converged from 185 km LEO @ default 28.5°', !!fr && fr.converged);
    ok(`P4/R3 free return: return perigee ${fr && fr.periAlt_km != null ? fr.periAlt_km.toFixed(0) : '?'} km within [0, 2000] band (P1 golden band)`,
      !!fr && fr.periAlt_km != null && fr.periAlt_km >= 0 && fr.periAlt_km <= 2000);
    ok('P4/R3 free return: solved |dv| plausible (3.0–3.3 km/s)', !!fr && fr.dv_ms > 3000 && fr.dv_ms < 3300);
    const fr2 = physFreeReturnSolve(185, 0, {});
    ok('P4/R3 free return: deterministic (identical repeat solve)',
      !!fr && !!fr2 && fr.met_s === fr2.met_s && fr.dv_ms === fr2.dv_ms && fr.periAlt_km === fr2.periAlt_km);
    const fr0 = physFreeReturnSolve(185, 0, {}, 0);
    ok(`R3 free return: explicit incDeg=0 converges in the ecliptic (perigee ${fr0 && fr0.periAlt_km != null ? fr0.periAlt_km.toFixed(0) : '?'} km)`,
      !!fr0 && fr0.converged && fr0.periAlt_km >= 0 && fr0.periAlt_km <= 2000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R3 — 3D physics coherence (565): inclined departure states, MNODE normal,
// shooter yaw DOF (2026-07-10)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { physAimBurnState, physSolveNodeBurn, physStateToElements, physKeplerPropagate,
          physShootLegAim, physSoiRadius, physMag, physAdd, physScale, PROG_BODIES, PROG_MOON_ORBIT_R } =
    vm.runInContext('({ physAimBurnState, physSolveNodeBurn, physStateToElements, physKeplerPropagate, physShootLegAim, physSoiRadius, physMag, physAdd, physScale, PROG_BODIES, PROG_MOON_ORBIT_R })', sandbox);

  const muE = PROG_BODIES.Earth.mu;
  const r1 = PROG_BODIES.Earth.R + 185;
  const inc = 28.5 * Math.PI / 180;

  // inclined ring state: radius preserved, plane tilted by i (h-vector check)
  {
    const bs = physAimBurnState('Earth', r1, 1.2, 0, 0, inc, 0);
    approx('R3 ring: |r| = r1 on the inclined ring', physMag(bs.r), r1, 1e-6);
    const el = physStateToElements(bs.r, bs.v, muE);
    approx('R3 ring: state inclination = authored i', el.i, inc, 1e-9);
    // z-amplitude over the ring is r1·sin(i): at nu = π/2 (max z for Ω=ω=0)
    const top = physAimBurnState('Earth', r1, Math.PI / 2, 0, 0, inc, 0);
    approx('R3 ring: z-amplitude = r1·sin(i) at ν=π/2', Math.abs(top.r[2]), r1 * Math.sin(inc), 1e-6);
  }
  // i=0 reproduces the pre-R3 planar construction exactly
  {
    const th = 2.3, dv = 3.1;
    const bs = physAimBurnState('Earth', r1, th, 0, dv, 0, 0);
    const vc = Math.sqrt(muE / r1);
    approx('R3 back-compat: i=0 r.x', bs.r[0], r1 * Math.cos(th), 1e-6);
    approx('R3 back-compat: i=0 r.y', bs.r[1], r1 * Math.sin(th), 1e-6);
    ok('R3 back-compat: i=0 stays planar (r.z = v.z = 0)', Math.abs(bs.r[2]) < 1e-9 && Math.abs(bs.v[2]) < 1e-9);
    approx('R3 back-compat: i=0 prograde speed', physMag(bs.v), vc + dv, 1e-9);
  }
  // yaw preserves |dvVec| exactly (ΔV accounting parity through the 3rd DOF)
  {
    const bs = physAimBurnState('Earth', r1, 0.7, 0.2, 3.15, inc, 0.3);
    approx('R3 yaw: |dvVec| magnitude parity at pitch 0.2 / yaw 0.3', physMag(bs.dvVec), 3.15, 1e-12);
    const bsY = physAimBurnState('Earth', r1, 0.7, 0, 1.0, inc, Math.PI / 2);
    const el0 = physStateToElements(physAimBurnState('Earth', r1, 0.7, 0, 0, inc, 0).r,
      physAimBurnState('Earth', r1, 0.7, 0, 0, inc, 0).v, muE);
    ok('R3 yaw: yaw=π/2 puts the whole dv along ĥ (dv ⊥ v and ⊥ r)',
      Math.abs(bsY.dvVec[0] * bsY.r[0] + bsY.dvVec[1] * bsY.r[1] + bsY.dvVec[2] * bsY.r[2]) < 1e-9 * r1 && !!el0);
  }
  // physSolveNodeBurn honors the FROM orbit's authored inclination
  {
    const leoInc = { type: 'circular', body: 'Earth', perigee: 185, apogee: 185, inclination: 28.5 };
    const tlc = { type: 'transit', body: 'Earth', c3: -1.9, destination: 'Moon' };
    const b = physSolveNodeBurn(leoInc, tlc, 86400 * 3, 3.15);
    ok('R3 solved burn: returns a state for inclined LEO→TLC', !!b && !!b.state);
    const el = physStateToElements(b.state.r, b.state.v, muE);
    approx('R3 solved burn: departure plane tilted by authored i (h-vector)', el.i, inc, 0.02);
    approx('R3 solved burn: |dvVec| parity from the inclined ring', physMag(b.dvVec), 3.15, 1e-12);
    // absent inclination -> ecliptic exactly (pre-R3 behavior)
    const leoFlat = { type: 'circular', body: 'Earth', perigee: 185, apogee: 185 };
    const bf = physSolveNodeBurn(leoFlat, tlc, 86400 * 3, 3.15);
    ok('R3 solved burn: no inclination field -> planar state (z = 0)',
      Math.abs(bf.state.r[2]) < 1e-9 && Math.abs(bf.state.v[2]) < 1e-9);
  }
  // MNODE normal component changes the orbit plane (pure two-body check)
  {
    const bs = physAimBurnState('Earth', r1, 0.9, 0, 0, inc, 0);
    const elBefore = physStateToElements(bs.r, bs.v, muE);
    const dvN = physScale(bs.hHat, 0.5); // 500 m/s normal
    const vAfter = physAdd(bs.v, dvN);
    const elAfter = physStateToElements(bs.r, vAfter, muE);
    const expTilt = Math.atan2(0.5, physMag(bs.v)); // h rotates about r̂ by atan(dvN/v)
    const hB = elBefore.hVec, hA = elAfter.hVec;
    const cosAng = (hB[0] * hA[0] + hB[1] * hA[1] + hB[2] * hA[2]) / (physMag(hB) * physMag(hA));
    const ang = Math.acos(Math.max(-1, Math.min(1, cosAng)));
    approx('R3 MNODE: nrm-only burn rotates the orbit plane by atan(dvN/v)', ang, expTilt, 0.002);
    ok(`R3 MNODE: inclination actually moves (Δi ${(Math.abs(elAfter.i - elBefore.i) * 180 / Math.PI).toFixed(2)}° > 1°)`,
      Math.abs(elAfter.i - elBefore.i) > Math.PI / 180);
    const st = physKeplerPropagate(bs.r, vAfter, 3000, muE);
    ok('R3 MNODE: post-burn propagation keeps the new plane', !!st &&
      Math.abs(physStateToElements(st.r, st.v, muE).i - elAfter.i) < 1e-6);
  }
  // shooter: plane-mismatched Earth→Moon (28.5° ring vs 5.145° Moon)
  // converges under the R3-tightened moon acceptance min(SOI/3, 25,000 km)
  {
    const leoInc = { type: 'circular', body: 'Earth', perigee: 185, apogee: 185, inclination: 28.5 };
    const tlc = { type: 'transit', body: 'Earth', c3: -1.9, destination: 'Moon' };
    const aT = (r1 + PROG_MOON_ORBIT_R) / 2;
    const dvHoh = Math.sqrt(muE * (2 / r1 - 1 / aT)) - Math.sqrt(muE / r1);
    const accept = Math.min(physSoiRadius('Moon') / 3, 25000);
    const sol = physShootLegAim(leoInc, tlc, 86400 * 5, dvHoh, {}, {});
    ok(`R3 shooter: 28.5° plane-mismatch converged (miss ${sol && sol.missKm.toFixed(0)} km < ${accept.toFixed(0)} km, dof ${sol && sol.dof})`,
      !!sol && sol.converged && sol.missKm < accept);
    ok(`R3 shooter: propagation budget ≤ 58 (used ${sol && sol.propagations})`, !!sol && sol.propagations <= 58);
    const sol2 = physShootLegAim(leoInc, tlc, 86400 * 5, dvHoh, {}, {});
    ok('R3 shooter: deterministic (identical repeat solve incl. yaw)',
      !!sol && !!sol2 && sol.theta === sol2.theta && sol.pitch === sol2.pitch && sol.yaw === sol2.yaw && sol.missKm === sol2.missKm);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R3.1 — state-derived orbit rings + solved-RAAN defaults (565 + 574,
// MATH.md §7i)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { physArrivalOsculatingElements, physStateToElements, physElementsToState,
          physMag, physCross, physSub, physScale, PROG_BODIES, _trajRingSVG, progOrbitSamplePoints } =
    vm.runInContext('({ physArrivalOsculatingElements, physStateToElements, physElementsToState, physMag, physCross, physSub, physScale, PROG_BODIES, _trajRingSVG, progOrbitSamplePoints })', sandbox);

  const muM = PROG_BODIES.Moon.mu;

  // synthetic converged "arrival": build a two-sample propagation result
  // bracketing a periapsis event around a known inclined circular state, and
  // verify physArrivalOsculatingElements' reconstructed h-vector matches the
  // true state's h-vector.
  const rp = PROG_BODIES.Moon.R + 100;
  const trueEl = { a: rp, e: 0, i: 0.9, raan: 1.3, argp: 0, nu: 0 };
  const trueState = physElementsToState(trueEl, muM);
  const hTrue = physCross(trueState.r, trueState.v);
  const dt = 5; // s, small step either side of the event for a clean finite difference
  const before = physElementsToState(Object.assign({}, trueEl, { nu: -0.01 }), muM);
  const after = physElementsToState(Object.assign({}, trueEl, { nu: 0.01 }), muM);
  const tEvent = 1000;
  const res = {
    events: [{ type: 'periapsis', t: tEvent, rMag: rp, frame: 'Moon' }],
    samples: [
      { t: tEvent - dt, r: before.r, frame: 'Moon' },
      { t: tEvent + dt, r: after.r, frame: 'Moon' },
    ],
  };
  const oscul = physArrivalOsculatingElements(res, 'Moon', muM);
  {
    const hOscul = oscul && oscul.hVec;
    const cosAng = hOscul ? (hOscul[0] * hTrue[0] + hOscul[1] * hTrue[1] + hOscul[2] * hTrue[2]) / (physMag(hOscul) * physMag(hTrue)) : 0;
    const ang = hOscul ? Math.acos(Math.max(-1, Math.min(1, cosAng))) : Infinity;
    ok(`R3.1 arrival osculating elements: h-vector angle to true state < 1e-6 rad (got ${ang.toExponential(2)})`,
      ang < 1e-6);
  }
  // determinism: identical inputs -> identical elements
  {
    const oscul2 = physArrivalOsculatingElements(res, 'Moon', muM);
    ok('R3.1 arrival elements: deterministic (identical repeat call)',
      !!oscul && !!oscul2 && oscul.i === oscul2.i && oscul.raan === oscul2.raan && oscul.argp === oscul2.argp);
  }
  // a ring sampled with the derived elements' plane has the same normal as
  // the arrival state's h-vector (the ring literally passes through that plane)
  {
    const pts = progOrbitSamplePoints({ a: rp, e: 0, i: oscul.i, raan: oscul.raan, argp: oscul.argp || 0 }, 96);
    const p0 = pts[0], p1 = pts[32];
    const hRing = physCross(p0, p1);
    const cosAng = (hRing[0] * hTrue[0] + hRing[1] * hTrue[1] + hRing[2] * hTrue[2]) / (physMag(hRing) * physMag(hTrue));
    const ang = Math.acos(Math.max(-1, Math.min(1, Math.abs(cosAng))));
    ok(`R3.1 ring plane: sampled ring's plane normal matches arrival h-vector (angle ${ang.toExponential(2)} rad)`,
      ang < 1e-9);
  }
  // _trajRingSVG: rec.elements overrides the Ω=ω=0 convention and the
  // tooltip switches from "assumed 0" to "plane from flight"
  {
    const rec = { key: 'k', body: 'Moon', peri: 100, apo: 100, inc: 45, label: '100', colors: new Set(), names: new Set(),
      elements: { i: oscul.i, raan: oscul.raan, argp: oscul.argp || 0, source: 'flight' } };
    const svg = _trajRingSVG(rec, 'Moon', 0.1, null, { zoom: 1, viewportDiagPx: 2000, originX: 0, originY: 0 });
    ok('R3.1 _trajRingSVG: derived-plane ring renders (non-empty path) and is annotated "plane from flight"',
      svg.length > 0 && svg.indexOf('plane from flight') >= 0 && svg.indexOf('assumed 0') === -1);
  }
  // i=0 unflown rings unchanged: no rec.elements -> same Ω=ω=0 convention text
  {
    const rec = { key: 'k2', body: 'Earth', peri: 185, apo: 185, inc: 0, label: '185', colors: new Set(), names: new Set() };
    const svg = _trajRingSVG(rec, 'Earth', 0.1, null, { zoom: 1, viewportDiagPx: 2000, originX: 0, originY: 0 });
    ok('R3.1 backwards-compat: i=0 unflown ring unchanged (no "plane from flight" annotation, no NaN)',
      svg.length > 0 && svg.indexOf('plane from flight') === -1 && svg.indexOf('NaN') === -1);
  }
  // no periapsis event in the destination frame -> no derived elements (clean null)
  {
    const resNoPeri = { events: [], samples: [{ t: 0, r: [1, 0, 0], frame: 'Moon' }] };
    ok('R3.1 arrival elements: no periapsis event -> null (no throw)',
      physArrivalOsculatingElements(resNoPeri, 'Moon', muM) === null);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R3.2 — orbit orientation authoring (430/570 node specs + 565 + 574,
// MATH.md §7i tier 1 + honesty note)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { physShootLegAim, physAimBurnState, physStateToElements, physSoiRadius,
          physPropagateSegment, physMag, physCross, physScale, PROG_BODIES, PROG_MOON_ORBIT_R,
          _trajRingOrientationFor, _nmCoaxialTransferDv, progDvPlaneChangeFull } =
    vm.runInContext('({ physShootLegAim, physAimBurnState, physStateToElements, physSoiRadius, physPropagateSegment, physMag, physCross, physScale, PROG_BODIES, PROG_MOON_ORBIT_R, _trajRingOrientationFor, _nmCoaxialTransferDv, progDvPlaneChangeFull })', sandbox);

  const muE = PROG_BODIES.Earth.mu;
  const r1 = PROG_BODIES.Earth.R + 185;
  const tlc = { type: 'transit', body: 'Earth', c3: -1.9, destination: 'Moon' };
  const aT = (r1 + PROG_MOON_ORBIT_R) / 2;
  const dvHoh = Math.sqrt(muE * (2 / r1 - 1 / aT)) - Math.sqrt(muE / r1);

  // 1) spec round-trip: orbit specs serialize WHOLESALE in this codebase
  // (autosave/.program/orbit-library all JSON.stringify the containing
  // object) — a plain JSON round trip is therefore an accurate proxy for
  // every real persistence path; the field is a plain optional property with
  // no special-cased (de)serialization anywhere, so nothing else to pin.
  {
    const spec = { type: 'circular', body: 'Earth', perigee: 185, apogee: 185, inclination: 28.5, lan_deg: 45, argp_deg: 12 };
    const rt = JSON.parse(JSON.stringify(spec));
    ok('R3.2 spec round-trip: lan_deg/argp_deg survive JSON serialize/deserialize',
      rt.lan_deg === 45 && rt.argp_deg === 12);
    const specUnauthored = { type: 'circular', body: 'Earth', perigee: 185, apogee: 185, inclination: 28.5 };
    const rt2 = JSON.parse(JSON.stringify(specUnauthored));
    ok('R3.2 spec round-trip: absent lan_deg/argp_deg stay absent (unauthored, not coerced to 0)',
      !('lan_deg' in rt2) && !('argp_deg' in rt2));
  }

  // 2) rendering precedence: authored beats derived beats default
  {
    const authored = _trajRingOrientationFor({ inc: 90, elements: { i: 1.57, raan: 0.785, argp: 0, source: 'authored' } });
    ok('R3.2 render precedence: authored source wins and carries its own {i,raan}',
      authored.source === 'authored' && Math.abs(authored.raan - 0.785) < 1e-12);
    const derived = _trajRingOrientationFor({ inc: 45, elements: { i: 0.5, raan: 1.1, argp: 0, source: 'flight' } });
    ok('R3.2 render precedence: flight-derived source when no authored elements present',
      derived.source === 'flight' && Math.abs(derived.raan - 1.1) < 1e-12);
    const dflt = _trajRingOrientationFor({ inc: 28.5 });
    ok('R3.2 render precedence: default (Ω=ω=0) when neither authored nor derived',
      dflt.source === 'default' && dflt.raan === 0 && dflt.argp === 0 && Math.abs(dflt.i - 28.5 * Math.PI / 180) < 1e-9);
  }

  // 3) departure-plane fixing: an authored fromOrbit.lan_deg is NOT re-solved —
  // physShootLegAim's raanRoots collapses to [authored], so the returned aim
  // always carries exactly that raan (mod 2π), regardless of what the
  // unauthored solve would have picked for this same Earth->Moon geometry.
  {
    const authoredRaanDeg = 200; // far from whatever the unauthored solve picks
    const leoAuthored = { type: 'circular', body: 'Earth', perigee: 185, apogee: 185, inclination: 28.5, lan_deg: authoredRaanDeg };
    const sol = physShootLegAim(leoAuthored, tlc, 86400 * 5, dvHoh, {}, {});
    const authoredRaanRad = ((authoredRaanDeg % 360) * Math.PI) / 180;
    ok(`R3.2 departure fixing: returned raan == authored (got ${sol && sol.raan.toFixed(4)}, want ${authoredRaanRad.toFixed(4)})`,
      !!sol && Math.abs(sol.raan - authoredRaanRad) < 1e-9);
    // determinism
    const sol2 = physShootLegAim(leoAuthored, tlc, 86400 * 5, dvHoh, {}, {});
    ok('R3.2 departure fixing: deterministic (identical repeat solve)',
      !!sol && !!sol2 && sol.raan === sol2.raan && sol.theta === sol2.theta && sol.converged === sol2.converged);
  }

  // 4) honest failure: an authored departure plane rotated 90° from anything
  // reachable by a fixed-|Δv| Hohmann-class burn must NOT be silently
  // re-aimed onto a different plane — clean converged:false, bounded work.
  {
    const leoHostile = { type: 'circular', body: 'Earth', perigee: 185, apogee: 185, inclination: 28.5, lan_deg: 90 };
    let threw = false, sol = null;
    try { sol = physShootLegAim(leoHostile, tlc, 86400 * 5, dvHoh, {}, {}); } catch (e) { threw = true; }
    ok('R3.2 honest failure: authored-plane shoot never throws', !threw);
    ok('R3.2 honest failure: bounded propagation budget (≤ 66)', !!sol && sol.propagations <= 66);
    // (not asserting converged:false unconditionally — a plane 90° from the
    // seed can, for some MET/geometry combinations, still be reachable by
    // yaw; the load-bearing guarantee is "never silently re-aimed", i.e. the
    // raan the solve reports back is ALWAYS the authored one)
    ok('R3.2 honest failure: even on a hostile plane, the reported raan stays the authored one',
      !!sol && Math.abs(sol.raan - (90 * Math.PI / 180)) < 1e-9);
  }

  // 5) arrival plane-alignment: authored TO-orbit plane adds a residual that
  // the converged solution must actually satisfy — reconstruct the arrival
  // h-vector from the propagated solution and check it against the authored
  // target normal.
  {
    const targetI = 5.9 * Math.PI / 180, targetRaan = 1.4; // near the Moon's real ecliptic inclination — reachable
    const lloAuthored = { type: 'circular', body: 'Moon', perigee: 100, apogee: 100,
      inclination: targetI * 180 / Math.PI, lan_deg: targetRaan * 180 / Math.PI };
    const leo = { type: 'circular', body: 'Earth', perigee: 185, apogee: 185, inclination: 28.5 };
    const sol = physShootLegAim(leo, lloAuthored, 86400 * 5, dvHoh, {}, {});
    if (sol && sol.converged) {
      const bs = physAimBurnState('Earth', r1, sol.theta, sol.pitch, dvHoh, 28.5 * Math.PI / 180, sol.yaw || 0, sol.raan || 0);
      const res = physPropagateSegment({ r: bs.r, v: bs.v }, 86400 * 5, 86400 * 5 + 1.5 * 430000,
        { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'] }, { maxSamples: 128 });
      const soiOut = res.events.find(ev => ev.type === 'soi' && ev.to === 'Moon');
      ok('R3.2 arrival alignment: converged aim actually enters the Moon SOI', !!soiOut);
    }
    ok('R3.2 arrival alignment: authored-target shoot returns a record (converged or honest false)', !!sol);
  }

  // 6) edge-cost flag: default (priceOrientation absent/false) is BYTE-IDENTICAL
  // parity with the pre-R3.2 coaxial transfer — the ΔV-parity discipline this
  // whole phase is gated on.
  {
    const body = 'Earth';
    const oa = { type: 'circular', perigee: 185, apogee: 185, inclination: 28.5, lan_deg: 0 };
    const ob = { type: 'circular', perigee: 500, apogee: 500, inclination: 51.6, lan_deg: 90 };
    const off = _nmCoaxialTransferDv(body, oa, ob);          // flag omitted
    const offExplicit = _nmCoaxialTransferDv(body, oa, ob, false);
    ok('R3.2 edge-cost: flag absent === flag explicit false (parity)',
      off.total_ms === offExplicit.total_ms && off.dv1_ms === offExplicit.dv1_ms);
    const on = _nmCoaxialTransferDv(body, oa, ob, true);
    ok(`R3.2 edge-cost: flag ON prices MORE than flag off for a 90° LAN + 22.6° inc gap (off ${off.total_ms.toFixed(0)} m/s, on ${on.total_ms.toFixed(0)} m/s)`,
      on.total_ms > off.total_ms);
    // monotone in plane angle: a bigger LAN gap prices more
    const obFar = { type: 'circular', perigee: 500, apogee: 500, inclination: 51.6, lan_deg: 170 };
    const onFar = _nmCoaxialTransferDv(body, oa, obFar, true);
    ok(`R3.2 edge-cost: monotone in plane angle (LAN 90° -> ${on.total_ms.toFixed(0)} m/s, LAN 170° -> ${onFar.total_ms.toFixed(0)} m/s)`,
      onFar.total_ms > on.total_ms);
    // same-plane authored orbits: flag on but zero plane angle -> parity with flag off
    const obSame = { type: 'circular', perigee: 500, apogee: 500, inclination: 28.5, lan_deg: 0 };
    const onSame = _nmCoaxialTransferDv(body, oa, obSame, true);
    const offSame = _nmCoaxialTransferDv(body, oa, obSame, false);
    ok('R3.2 edge-cost: zero plane angle (same i, same LAN) prices identically flag on or off',
      Math.abs(onSame.total_ms - offSame.total_ms) < 1e-9);
    // determinism
    const on2 = _nmCoaxialTransferDv(body, oa, ob, true);
    ok('R3.2 edge-cost: deterministic (identical repeat call)', on.total_ms === on2.total_ms);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R2 — 3D projection + true-geometry orbit sampling (574 + 360)
// ═══════════════════════════════════════════════════════════════════════════

{
  const { _trajProjectVec, progOrbitSamplePoints } =
    vm.runInContext('({ _trajProjectVec, progOrbitSamplePoints })', sandbox);

  // el=π/2, az=0 is EXACTLY the pre-R2 mapping (u=x, v=y, depth=z)
  {
    const p = _trajProjectVec(3, 7, 11, 0, Math.PI / 2);
    approx('R2 proj: el=90 identity u=x', p.x, 3, 1e-12);
    approx('R2 proj: el=90 identity v=y', p.y, 7, 1e-12);
    approx('R2 proj: el=90 identity depth=z', p.depth, 11, 1e-12);
  }
  // el=0 (edge-on): v = -z (world +z projects up-screen — SVG y is down), depth = y
  {
    const p = _trajProjectVec(3, 7, 11, 0, 0);
    approx('R2 proj: el=0 u=x', p.x, 3, 1e-12);
    approx('R2 proj: el=0 v=-z', p.y, -11, 1e-12);
    approx('R2 proj: el=0 depth=y', p.depth, 7, 1e-12);
  }
  // az=π/2 at top-down: x-axis rotates onto -y-screen... pin the convention:
  // xa = x·cos(az) − y·sin(az), ya = x·sin(az) + y·cos(az)
  {
    const p = _trajProjectVec(1, 0, 0, Math.PI / 2, Math.PI / 2);
    approx('R2 proj: az=90 maps +x to u=0', p.x, 0, 1e-12);
    approx('R2 proj: az=90 maps +x to v=+1', p.y, 1, 1e-12);
  }
  // tilt foreshortening: an ecliptic circle's v-extent scales by sin(el)
  {
    const el30 = Math.PI / 6;
    const top = _trajProjectVec(0, 1, 0, 0, el30);
    approx('R2 proj: el=30 foreshortens v by sin(30)=0.5', Math.abs(top.y), 0.5, 1e-12);
  }

  // orbit sampler: closed, correct periapsis/apoapsis, inclination lifts z
  {
    const el = { a: 10000, e: 0.3, i: 0.5, raan: 0.7, argp: 1.1 };
    const pts = progOrbitSamplePoints(el, 96);
    ok('R2 sampler: closed polyline (last === first)',
      Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1], pts[0][2] - pts[pts.length - 1][2]) < 1e-6);
    const radii = pts.map(p => Math.hypot(p[0], p[1], p[2]));
    approx('R2 sampler: min radius = a(1-e)', Math.min(...radii), el.a * (1 - el.e), 1);
    approx('R2 sampler: max radius = a(1+e)', Math.max(...radii), el.a * (1 + el.e), 1);
    const zMax = Math.max(...pts.map(p => Math.abs(p[2])));
    ok(`R2 sampler: inclination lifts z (max|z| ${zMax.toFixed(0)} km > 0.3a·sin(i))`, zMax > 0.3 * el.a * Math.sin(el.i));
    const flat = progOrbitSamplePoints({ a: 10000, e: 0, i: 0, raan: 0, argp: 0 }, 32);
    ok('R2 sampler: i=0 stays in the ecliptic', flat.every(p => Math.abs(p[2]) < 1e-9));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R3.3 — maneuver gizmo pure helpers (5745-maneuver-gizmo.js)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { _trajGizmoAxes, _trajGizmoPxToDv, _trajGizmoNearestSampleMet, _trajGizmoFormatReadout,
          _trajGizmoScreenDir, physMag, physDot } =
    vm.runInContext('({ _trajGizmoAxes, _trajGizmoPxToDv, _trajGizmoNearestSampleMet, _trajGizmoFormatReadout, _trajGizmoScreenDir, physMag, physDot })', sandbox);

  // axes: circular-orbit state -> orthonormal-ish {rHat,vHat,hHat}
  {
    const r = [7000, 0, 0], v = [0, 7.5, 0];
    const ax = _trajGizmoAxes(r, v);
    approx('gizmo axes: |rHat|=1', physMag(ax.rHat), 1, 1e-9);
    approx('gizmo axes: |vHat|=1', physMag(ax.vHat), 1, 1e-9);
    approx('gizmo axes: |hHat|=1', physMag(ax.hHat), 1, 1e-9);
    approx('gizmo axes: hHat = r cross v direction (z for this planar case)', ax.hHat[2], 1, 1e-9);
    ok('gizmo axes: rHat perp hHat', Math.abs(physDot(ax.rHat, ax.hHat)) < 1e-9);
    ok('gizmo axes: degenerate state (zero v) -> null', _trajGizmoAxes([7000, 0, 0], [0, 0, 0]) === null);
  }

  // px-drag -> dv mapping: 2 m/s/px normal, 0.2 m/s/px fine (shift), sign preserved (flip past zero)
  {
    approx('gizmo px->dv: 100px normal = 200 m/s', _trajGizmoPxToDv(100, false), 200, 1e-9);
    approx('gizmo px->dv: 100px shift-fine = 20 m/s', _trajGizmoPxToDv(100, true), 20, 1e-9);
    approx('gizmo px->dv: negative px flips sign', _trajGizmoPxToDv(-50, false), -100, 1e-9);
    ok('gizmo px->dv: zero px = zero dv', _trajGizmoPxToDv(0, false) === 0);
  }

  // nearest-sample MET resolution
  {
    const samples = [{ t: 0 }, { t: 100 }, { t: 250 }, { t: 400 }];
    ok('gizmo nearest-sample: exact hit', _trajGizmoNearestSampleMet(samples, 100) === 100);
    ok('gizmo nearest-sample: rounds to closer neighbor', _trajGizmoNearestSampleMet(samples, 180) === 250 || _trajGizmoNearestSampleMet(samples, 180) === 100);
    approx('gizmo nearest-sample: picks 100 for target 120', _trajGizmoNearestSampleMet(samples, 120), 100, 1e-9);
    ok('gizmo nearest-sample: empty array -> null', _trajGizmoNearestSampleMet([], 50) === null);
  }

  // readout formatting
  {
    ok('gizmo readout: positive/negative sign + MET mm:ss', _trajGizmoFormatReadout(200, -15, 0, 125) === 'pro +200 · rad -15 · nrm +0 m/s · MET 2m05s');
    ok('gizmo readout: zero met', _trajGizmoFormatReadout(0, 0, 0, 0) === 'pro +0 · rad +0 · nrm +0 m/s · MET 0m00s');
  }

  // screen-dir: normal (non-degenerate) direction normalizes; degenerate falls back
  {
    const d1 = _trajGizmoScreenDir(3, 4, [0, -1]);
    approx('gizmo screenDir: normalizes (3,4)->(0.6,0.8)', d1.ux, 0.6, 1e-9);
    approx('gizmo screenDir: normalizes (3,4)->(0.6,0.8) y', d1.uy, 0.8, 1e-9);
    ok('gizmo screenDir: non-degenerate flag', d1.degenerate === false);
    const d2 = _trajGizmoScreenDir(0.001, 0.001, [0, -1]);
    ok('gizmo screenDir: near-zero length -> degenerate fallback', d2.degenerate === true && d2.ux === 0 && d2.uy === -1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R3.4 — gizmo usability + KSP parity pure helpers (5745-maneuver-gizmo.js)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { _trajGizmoHandleSideMag, _trajGizmoCenterDragDMet, _trajGizmoOrbitPeriodMet,
          _trajGizmoClosestApproach, _trajGizmoSoiEntryT, _trajGizmoPreviewFidelity, physMag } =
    vm.runInContext('({ _trajGizmoHandleSideMag, _trajGizmoCenterDragDMet, _trajGizmoOrbitPeriodMet, _trajGizmoClosestApproach, _trajGizmoSoiEntryT, _trajGizmoPreviewFidelity, physMag })', sandbox);

  // six-handle component mapping: pull-away semantics, never crosses zero
  {
    approx('gizmo handle sideMag: pull away 100px -> +200', _trajGizmoHandleSideMag(0, 100, false), 200, 1e-9);
    approx('gizmo handle sideMag: push back toward node clamps at 0 (never negative)', _trajGizmoHandleSideMag(50, -1000, false), 0, 1e-9);
    ok('gizmo handle sideMag: never negative regardless of input', _trajGizmoHandleSideMag(10, -9999, true) === 0);
    approx('gizmo handle sideMag: fine (shift) drag', _trajGizmoHandleSideMag(0, 100, true), 20, 1e-9);
  }

  // px -> dMET node-time drag: gain formula + clamp behavior (clamp itself lives in the caller; helper is the pure ratio)
  {
    approx('gizmo center-drag: dMET = pxAlong*kmPerPx/|v|', _trajGizmoCenterDragDMet(50, 2, 7.5), 50 * 2 / 7.5, 1e-9);
    ok('gizmo center-drag: zero/neg vMag -> 0 (no time axis to drag along)', _trajGizmoCenterDragDMet(50, 2, 0) === 0 && _trajGizmoCenterDragDMet(50, 2, -1) === 0);
    approx('gizmo center-drag: negative px -> negative dMET', _trajGizmoCenterDragDMet(-40, 2, 8), -40 * 2 / 8, 1e-9);
  }

  // orbital period round-trip: circular LEO-ish state, +1/-1 orbit should move MET by exactly the period
  {
    const mu = 398600.4418; // Earth
    const r = [6778, 0, 0], v = [0, 7.6686, 0]; // ~400km circular
    const period = _trajGizmoOrbitPeriodMet(mu, r, v);
    ok('gizmo orbit period: positive finite for a circular state', period > 0 && isFinite(period));
    const expected = 2 * Math.PI * Math.sqrt(Math.pow(physMag(r), 3) / mu); // circular: a = r
    approx('gizmo orbit period: matches 2*pi*sqrt(a^3/mu) for a circular state', period, expected, 1);
    const met0 = 12345;
    approx('gizmo orbit period: +1 orbit then -1 orbit round-trips MET', (met0 + period) - period, met0, 1e-6);
    ok('gizmo orbit period: hyperbolic state -> null (no period)', _trajGizmoOrbitPeriodMet(mu, [7000, 0, 0], [0, 20, 0]) === null);
  }

  // closest-approach helper: synthetic samples with a KNOWN minimum, frame-aware + encounter detection
  {
    // Synthetic rail: target body sits stationary at (10000,0,0) in the 'Earth' frame for all t.
    const railFn = (body, t) => body === 'Target' ? { r: [10000, 0, 0] } : { r: [0, 0, 0] };
    const samples = [];
    for (let i = 0; i <= 10; i++) {
      const x = i * 2000; // craft flies straight along +x from 0 to 20000 km, passing nearest Target at x=10000
      samples.push({ t: i * 100, r: [x, 0, 0], frame: 'Earth' });
    }
    const hit = _trajGizmoClosestApproach(samples, 'Target', railFn);
    ok('gizmo CA: finds the known minimum (craft at x=10000 exactly matches target)', hit && hit.dKm < 1e-6);
    ok('gizmo CA: minimum occurs at the expected sample time', hit.t === 500);
    ok('gizmo CA: empty samples -> null', _trajGizmoClosestApproach([], 'Target', railFn) === null);
    ok('gizmo CA: no targetBody -> null', _trajGizmoClosestApproach(samples, null, railFn) === null);

    // frame-aware case: same craft samples but expressed in the 'Sun' frame, with Earth offset from the Sun —
    // target (relative to Earth) must be resolved through the frame-body's own position.
    const railFn2 = (body, t) => {
      if (body === 'Target') return { r: [10000, 0, 0] }; // Target sits at helio (10000,0,0), same as before
      if (body === 'Earth') return { r: [0, 0, 0] };       // Earth at helio origin -> same geometry as the direct case
      return { r: [0, 0, 0] };
    };
    const samplesSun = samples.map(s => ({ ...s, frame: 'Earth' }));
    const hit2 = _trajGizmoClosestApproach(samplesSun, 'Target', railFn2);
    ok('gizmo CA: frame-aware resolution matches the direct case', hit2 && hit2.dKm < 1e-6 && hit2.t === 500);

    // encounter case: a sample whose frame IS the target body -> distance is |r| directly, and SOI-entry detected
    const encSamples = samples.slice(0, 6).concat(samples.slice(6).map(s => ({ ...s, frame: 'Target', r: [s.r[0] - 10000, 0, 0] })));
    const hitEnc = _trajGizmoClosestApproach(encSamples, 'Target', railFn);
    ok('gizmo CA: still finds the pre-SOI-entry minimum correctly alongside re-framed samples', hitEnc && hitEnc.dKm < 1e-6 && hitEnc.t === 500);
    const soiT = _trajGizmoSoiEntryT(encSamples, 'Target');
    ok('gizmo CA: SOI-entry detected at the first re-framed sample', soiT === 600);
    ok('gizmo CA: no SOI entry when no sample re-frames to the target', _trajGizmoSoiEntryT(samples, 'Target') === null);
  }

  // determinism: same inputs -> byte-identical outputs (replay/undo safety, per the module's own contract)
  {
    const a = _trajGizmoHandleSideMag(37, -12.5, false), b = _trajGizmoHandleSideMag(37, -12.5, false);
    ok('gizmo determinism: handle sideMag is a pure function of its inputs', a === b);
    const s1 = [{ t: 0, r: [0, 0, 0], frame: 'Earth' }, { t: 100, r: [5000, 0, 0], frame: 'Earth' }];
    const rf = () => ({ r: [3000, 0, 0] });
    const c1 = _trajGizmoClosestApproach(s1, 'Target', rf), c2 = _trajGizmoClosestApproach(s1, 'Target', rf);
    ok('gizmo determinism: CA extraction is deterministic for identical inputs', c1.dKm === c2.dKm && c1.t === c2.t);
  }

  // fidelity-ladder decision (pure state helper, per the R3.4 spec addendum — timers themselves are NOT gate-tested)
  {
    ok('gizmo fidelity: fresh movement (dt=0) -> cheap', _trajGizmoPreviewFidelity(1000, 1000) === 'cheap');
    ok('gizmo fidelity: just under the debounce -> cheap', _trajGizmoPreviewFidelity(1000, 1000 + 1999) === 'cheap');
    ok('gizmo fidelity: at the debounce boundary -> full', _trajGizmoPreviewFidelity(1000, 1000 + 2000) === 'full');
    ok('gizmo fidelity: well past the debounce -> full', _trajGizmoPreviewFidelity(1000, 60000) === 'full');
    ok('gizmo fidelity: custom debounceMs is honored', _trajGizmoPreviewFidelity(0, 500, 500) === 'full' && _trajGizmoPreviewFidelity(0, 499, 500) === 'cheap');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R3.5 — gizmo polish (user flight-test feedback, 2026-07-10) pure helpers
// ═══════════════════════════════════════════════════════════════════════════
{
  const { _trajGizmoNearestScreenMet, _trajGizmoClampCross, _trajGizmoDragComponentValue,
          _trajRingDirSegments, _trajGizmoPullRate } =
    vm.runInContext('({ _trajGizmoNearestScreenMet, _trajGizmoClampCross, _trajGizmoDragComponentValue, _trajRingDirSegments, _trajGizmoPullRate })', sandbox);

  // item 1: cursor-nearest-sample center-drag mapping
  {
    const pts = [{ x: 0, y: 0, met: 0 }, { x: 100, y: 0, met: 50 }, { x: 0, y: 100, met: 150 }];
    ok('gizmo nearest-screen-met: exact hit picks that sample', _trajGizmoNearestScreenMet(pts, 100, 0) === 50);
    ok('gizmo nearest-screen-met: closer-to-origin cursor picks met=0', _trajGizmoNearestScreenMet(pts, 5, 5) === 0);
    ok('gizmo nearest-screen-met: works in every direction (not just along one axis)', _trajGizmoNearestScreenMet(pts, 10, 90) === 150);
    ok('gizmo nearest-screen-met: empty array -> null', _trajGizmoNearestScreenMet([], 1, 1) === null);
  }

  // item 4: opposing-handle zero-crossing clamp
  {
    ok('gizmo clampCross: same-sign passes through unchanged', _trajGizmoClampCross(50, 30) === 30);
    ok('gizmo clampCross: crossing from + to - clamps to 0', _trajGizmoClampCross(50, -10) === 0);
    ok('gizmo clampCross: crossing from - to + clamps to 0', _trajGizmoClampCross(-50, 10) === 0);
    ok('gizmo clampCross: prev=0 lets any candidate through (new drag, free to build the opposite sign)', _trajGizmoClampCross(0, -10) === -10 && _trajGizmoClampCross(0, 10) === 10);

    // composed drag-component value: grabbing the OPPOSITE handle drains an
    // existing value to 0 and STAYS there for the rest of that same drag
    // (does not silently continue negative) — matches the user's report.
    approx('gizmo dragComponentValue: own-handle drag away from 0 builds normally', _trajGizmoDragComponentValue(0, 1, 200), 200, 1e-9);
    approx('gizmo dragComponentValue: own-handle drag back floors at 0', _trajGizmoDragComponentValue(50, 1, -1000), 0, 1e-9);
    approx('gizmo dragComponentValue: opposite-handle grab drains +50 to 0, not negative', _trajGizmoDragComponentValue(50, -1, 500), 0, 1e-9);
    approx('gizmo dragComponentValue: opposite-handle grab even far past the drain point stays at 0', _trajGizmoDragComponentValue(50, -1, 99999), 0, 1e-9);
    approx('gizmo dragComponentValue: a FRESH drag from 0 on the opposite handle builds negative freely', _trajGizmoDragComponentValue(0, -1, 500), -500, 1e-9);
    ok('gizmo dragComponentValue: a "+" handle result is never negative', _trajGizmoDragComponentValue(-50, 1, -9999) === 0);
    ok('gizmo dragComponentValue: a "-" handle result is never positive', _trajGizmoDragComponentValue(50, -1, -9999) === 0);
  }

  // item 2: ring direction-of-motion opacity segments
  {
    const pts10 = Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0 }));
    const segs = _trajRingDirSegments(pts10, 10);
    ok('gizmo ring-dir-segments: produces 10 segments for 10 evenly-divisible edges', segs.length === 10);
    ok('gizmo ring-dir-segments: opacity ramps from faint (trailing) to full (leading)', segs[0].opacity < segs[segs.length - 1].opacity && segs[segs.length - 1].opacity === 1);
    ok('gizmo ring-dir-segments: first segment starts near the documented 0.25 floor', Math.abs(segs[0].opacity - 0.25) < 1e-9);
    ok('gizmo ring-dir-segments: empty/degenerate input -> []', _trajRingDirSegments([], 10).length === 0 && _trajRingDirSegments([{ x: 0, y: 0 }], 10).length === 0);
    // segments are contiguous and cover every point (no gaps in the drawn ring)
    let covered = 0; segs.forEach(s => { covered += s.pts.length - 1; });
    ok('gizmo ring-dir-segments: segments are contiguous (edge count sums to the input edge count)', covered === pts10.length - 1);
  }

  // R3.5.1 (2026-07-10, correction #2): rate-based handle drag — pull
  // distance -> a RATE (m/s per second), not a direct dv delta.
  {
    ok('gizmo pullRate: zero (or negative/back-toward-node) pull -> zero rate', _trajGizmoPullRate(0, false) === 0 && _trajGizmoPullRate(-15, false) === 0);
    approx('gizmo pullRate: a 40px pull matches the documented tuning constant', _trajGizmoPullRate(40, false), 20, 1e-9);
    ok('gizmo pullRate: shift (fine control) scales the rate down by 10x', Math.abs(_trajGizmoPullRate(40, true) - _trajGizmoPullRate(40, false) * 0.1) < 1e-9);
    ok('gizmo pullRate: a bigger pull yields a bigger rate (monotonic ramp)', _trajGizmoPullRate(80, false) > _trajGizmoPullRate(40, false));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R4 — J2 / orbital-economy layer (385/386): secular rates + optional J2
// integrator term (default off, MATH.md §7l)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { physJ2NodalRate, physJ2ApsidalRate, physJ2SunSyncCheck, physAccel,
          physPropagateSegment, physElementsToState, physStateToElements,
          PROG_BODIES, PROG_BODY_J2 } =
    vm.runInContext('({ physJ2NodalRate, physJ2ApsidalRate, physJ2SunSyncCheck, physAccel, physPropagateSegment, physElementsToState, physStateToElements, PROG_BODIES, PROG_BODY_J2 })', sandbox);

  const muE = PROG_BODIES.Earth.mu;
  const R2D_DAY = r => r * (180 / Math.PI) * 86400;

  // 800 km circular @ 98.6° (near-sun-sync). Sign convention: retrograde
  // (i > 90, cos i < 0) -> nodal rate is POSITIVE (eastward regression of
  // the ascending node), matching the ~+0.9856 deg/day Earth needs to stay
  // sun-synchronous.
  {
    const a = PROG_BODIES.Earth.R + 800;
    const iRad = 98.6 * Math.PI / 180;
    const rate = R2D_DAY(physJ2NodalRate(a, 0, iRad, 'Earth'));
    ok(`R4 J2 nodal: 800km@98.6deg ~ +0.9856 deg/day (got ${rate.toFixed(4)})`,
      Math.abs(rate - 0.9856) < 0.03);
    const ss = physJ2SunSyncCheck(a, 0, iRad, 'Earth');
    ok('R4 J2 sunSync: 800km@98.6deg is sun-synchronous', !!ss && ss.sunSync === true);
  }

  // Molniya: apsidal rate near zero at the critical inclination 63.4°.
  {
    const rate = R2D_DAY(physJ2ApsidalRate(26562, 0.74, 63.4 * Math.PI / 180, 'Earth'));
    ok(`R4 J2 apsidal: Molniya 63.4deg apsis ~ 0 deg/day (got ${rate.toFixed(5)})`,
      Math.abs(rate) < 0.01);
  }

  // ISS-like 51.6°: nodal rate ~ -5.0 deg/day (prograde -> negative/westward).
  {
    const a = PROG_BODIES.Earth.R + 400;
    const rate = R2D_DAY(physJ2NodalRate(a, 0, 51.6 * Math.PI / 180, 'Earth'));
    ok(`R4 J2 nodal: 400km@51.6deg ~ -5.0 deg/day (got ${rate.toFixed(3)})`,
      Math.abs(rate - (-5.0)) < 0.3);
    const ss = physJ2SunSyncCheck(a, 0, 51.6 * Math.PI / 180, 'Earth');
    ok('R4 J2 sunSync: 400km@51.6deg is NOT sun-synchronous', !!ss && ss.sunSync === false);
  }

  // No J2 data for a body -> null, not a fabricated zero.
  ok('R4 J2: body with no J2 entry returns null (nodal)',
    physJ2NodalRate(10000, 0, 0.5, 'Jupiter') === null);
  ok('R4 J2: body with no J2 entry returns null (sunSync)',
    physJ2SunSyncCheck(10000, 0, 0.5, 'Jupiter') === null);

  // physAccel with ctx.j2 unset === without: bit-identical (default-off contract).
  {
    const r = [7171, 500, 1200];
    const ctxBase = { center: 'Earth', bodies: ['Earth'] };
    const aOff1 = physAccel(r, 0, ctxBase);
    const aOff2 = physAccel(r, 0, { ...ctxBase, j2: false });
    const aUnset = physAccel(r, 0, { ...ctxBase, j2: undefined });
    ok('R4 J2: physAccel with ctx.j2 unset is bit-identical to no j2 key',
      aOff1.every((v, k) => v === aUnset[k]));
    ok('R4 J2: physAccel with ctx.j2 explicitly false is bit-identical to no j2 key',
      aOff1.every((v, k) => v === aOff2[k]));
    const aOn = physAccel(r, 0, { ...ctxBase, j2: true });
    ok('R4 J2: physAccel with ctx.j2 true DIFFERS from the default (term actually applied)',
      !aOff1.every((v, k) => v === aOn[k]));
  }

  // Numerically-propagated 800km/98.6deg orbit with J2 on: RAAN regresses in
  // the predicted direction/order-of-magnitude over a few orbits (generous
  // tolerance — this is a secular-trend sanity check, not a precision pin).
  {
    const a = PROG_BODIES.Earth.R + 800;
    const iRad = 98.6 * Math.PI / 180;
    const el = { a, e: 0, i: iRad, raan: 0, argp: 0, nu: 0 };
    const st0 = physElementsToState(el, muE);
    const period = 2 * Math.PI * Math.sqrt(a * a * a / muE);
    const nOrbits = 5;
    const tMax = nOrbits * period;
    const ctx = { center: 'Earth', bodies: ['Earth'], j2: true };
    const seg = physPropagateSegment(st0, 0, tMax, ctx, { maxSamples: 8 });
    ok('R4 J2 propagation: segment produced samples', !!seg && Array.isArray(seg.samples) && seg.samples.length > 1);
    if (seg && seg.stateF) {
      const elEnd = physStateToElements(seg.stateF.r, seg.stateF.v, muE);
      // predicted secular drift over tMax, wrapped to (-180, 180]
      const predictedDeg = R2D_DAY(physJ2NodalRate(a, 0, iRad, 'Earth')) * (tMax / 86400);
      let dRaan = (elEnd.raan - el.raan) * 180 / Math.PI;
      dRaan = ((dRaan + 540) % 360) - 180; // wrap to (-180,180]
      let predWrapped = ((predictedDeg + 540) % 360) - 180;
      ok(`R4 J2 propagation: RAAN drift sign/order matches secular prediction (predicted ${predWrapped.toFixed(2)} deg, observed ${dRaan.toFixed(2)} deg over ${nOrbits} orbits)`,
        Math.sign(predWrapped) === Math.sign(dRaan) && Math.abs(dRaan - predWrapped) < 2.0);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R5 — node-map coherence pass (2026-07-10): SOI-derived layout radius +
// physics-annotated edges (430's pure helpers, called by 570's node map).
// ═══════════════════════════════════════════════════════════════════════════
{
  // Layout radius: real physics (Earth's SOI ~ 924,000 km) should produce a
  // finite, positive, in-range radius — not the literal fallback constant.
  const rEarth = _nmSoiLayoutRadius('Earth', 150);
  ok('R5 layout: Earth SOI-derived radius is finite and positive', isFinite(rEarth) && rEarth > 0);
  ok('R5 layout: Earth SOI-derived radius clamps within [45,260]', rEarth >= 45 && rEarth <= 260);

  // Provenance ordering: bodies with bigger real SOI (relative to Earth) get a
  // bigger derived radius — Jupiter's SOI dwarfs Mercury's.
  const rMercury = _nmSoiLayoutRadius('Mercury', 60);
  const rJupiter = _nmSoiLayoutRadius('Jupiter', 185);
  ok('R5 layout: Jupiter (huge SOI) derives a larger radius than Mercury (tiny SOI)', rJupiter > rMercury);

  // Guard: unavailable physSoiRadius (or an unknown body) falls back verbatim.
  ok('R5 layout: unknown body falls back to the literal constant',
    _nmSoiLayoutRadius('Pluto', 42) === 42);
  {
    const savedFn = sandbox.physSoiRadius;
    sandbox.physSoiRadius = undefined;
    ok('R5 layout: physSoiRadius unavailable falls back to the literal constant',
      vm.runInContext("_nmSoiLayoutRadius('Earth', 150)", sandbox) === 150);
    sandbox.physSoiRadius = savedFn;
  }

  // Edge annotation: no leg in the side-table -> "estimated", never flown, and
  // never touches ΔV (the function has no ΔV-shaped return field at all).
  const annNone = _nmEdgePhysicsAnnotation('mission-x', 0, () => null);
  ok('R5 edges: no physics leg -> flown:false / estimated label',
    annNone.flown === false && annNone.label === 'estimated');

  // Edge annotation: converged leg -> flown:true, TOF surfaced in days, and (if
  // a closest-approach scanner + dest are present) CA distance surfaced too.
  const fakeLeg = { converged: true, tof_s: 3 * 86400, dest: 'Moon', samples: [{ t: 0, r: [1, 0, 0], frame: 'Earth' }] };
  const annFlown = _nmEdgePhysicsAnnotation('mission-x', 2, (mid, idx) => (mid === 'mission-x' && idx === 2) ? fakeLeg : null,
    () => ({ dKm: 12345 }));
  ok('R5 edges: converged leg -> flown:true', annFlown.flown === true);
  ok('R5 edges: converged leg surfaces TOF in days (3d)', Math.abs(annFlown.tofSeconds / 86400 - 3) < 1e-9);
  ok('R5 edges: converged leg surfaces closest-approach km from the injected scanner', annFlown.closestApproachKm === 12345);
  ok('R5 edges: flown label carries the "flown" marker', annFlown.label.indexOf('flown') >= 0);

  // Unconverged leg -> estimated, even though a leg record exists.
  const annUnconverged = _nmEdgePhysicsAnnotation('mission-x', 3, () => ({ converged: false }));
  ok('R5 edges: unconverged leg -> flown:false / estimated label', annUnconverged.flown === false);
}

// ═══════════════════════════════════════════════════════════════════════════
// R3.5.3 — physEscapeHorizonS (565-physics-mission.js): dynamic full-orbit
// heliocentric horizon, replacing the flat 90-day escape horizon that only
// ever showed a quarter-orbit. Dated 2026-07-10.
// ═══════════════════════════════════════════════════════════════════════════
{
  const FALLBACK_S = 90 * 86400;
  const YEAR_S = 365.25 * 86400;
  const CAP_S = 5 * YEAR_S;
  const MU_SUN = 1.32712440018e11;

  // No Sun-frame samples at all -> fallback verbatim.
  const noSun = [{ t: 0, r: [1e5, 0, 0], frame: 'Earth' }, { t: 1000, r: [1.1e5, 0, 0], frame: 'Earth' }];
  ok('physEscapeHorizonS: no Sun-frame samples -> fallback', physEscapeHorizonS(noSun, FALLBACK_S) === FALLBACK_S);

  // Only ONE Sun-frame sample recorded -> can't finite-difference a velocity -> fallback.
  const oneSun = [{ t: 0, r: [1e5, 0, 0], frame: 'Earth' }, { t: 1000, r: [1.496e8, 0, 0], frame: 'Sun' }];
  ok('physEscapeHorizonS: single Sun-frame sample -> fallback', physEscapeHorizonS(oneSun, FALLBACK_S) === FALLBACK_S);

  // Elliptical heliocentric orbit (near-circular at 1 AU, Earth-like) -> tExit + 1.05*period.
  {
    const R = 1.496e8; // km, 1 AU
    const vCirc = Math.sqrt(MU_SUN / R); // ~29.78 km/s
    const dt = 1000; // s, small step for an accurate finite-difference v estimate
    const dtheta = (vCirc / R) * dt;
    const s0 = { t: 5000, r: [R, 0, 0], frame: 'Sun' };
    const s1 = { t: 5000 + dt, r: [R * Math.cos(dtheta), R * Math.sin(dtheta), 0], frame: 'Sun' };
    const samples = [{ t: 0, r: [1e5, 0, 0], frame: 'Earth' }, s0, s1];
    const period = 2 * Math.PI * Math.sqrt((R * R * R) / MU_SUN); // ~1 sidereal year
    const expected = (s0.t - samples[0].t) + 1.05 * period;
    const got = physEscapeHorizonS(samples, FALLBACK_S);
    ok('physEscapeHorizonS: elliptical -> ~tExit + 1.05*period (within 1%)', Math.abs(got - expected) / expected < 0.01);
    ok('physEscapeHorizonS: elliptical -> roughly one solar year plus margin', got > YEAR_S && got < 1.2 * YEAR_S);
  }

  // Hyperbolic w.r.t. the Sun -> max(fallback, 2 solar years).
  {
    const R = 1.496e8;
    const vEsc = Math.sqrt(2 * MU_SUN / R); // ~42.12 km/s
    const vHyp = vEsc * 1.2; // comfortably hyperbolic
    const dt = 100;
    const s0 = { t: 5000, r: [R, 0, 0], frame: 'Sun' };
    const s1 = { t: 5000 + dt, r: [R, vHyp * dt, 0], frame: 'Sun' }; // near-radial straight-line step
    const samples = [{ t: 0, r: [1e5, 0, 0], frame: 'Earth' }, s0, s1];
    const got = physEscapeHorizonS(samples, FALLBACK_S);
    ok('physEscapeHorizonS: hyperbolic -> at least 2 solar years', got === 2 * YEAR_S);
  }

  // Extreme near-parabolic ellipse (huge period) -> capped at 5 solar years.
  {
    const R = 1.496e8;
    const vEsc = Math.sqrt(2 * MU_SUN / R);
    const vNearEsc = vEsc * 0.997; // bound but with an enormous semi-major axis
    const dt = 100;
    const dtheta = (vNearEsc / R) * dt;
    const s0 = { t: 5000, r: [R, 0, 0], frame: 'Sun' };
    const s1 = { t: 5000 + dt, r: [R * Math.cos(dtheta), R * Math.sin(dtheta), 0], frame: 'Sun' };
    const samples = [{ t: 0, r: [1e5, 0, 0], frame: 'Earth' }, s0, s1];
    const got = physEscapeHorizonS(samples, FALLBACK_S);
    ok('physEscapeHorizonS: near-parabolic huge-period ellipse -> capped at 5 years', got === CAP_S);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R6.1 — passive flight-plan event nodes (574-trajectory-view.js): pure
// resolver _trajEventNodeInfo(m, idx) -> {met, label, glyphKind} | null.
// Dated 2026-07-10.
// ═══════════════════════════════════════════════════════════════════════════
{
  const mNode = {
    log: [
      { type: 'LAUNCH', label: 'Falcon 9', metStart: 0 },
      { type: 'BURN', burnLabel: 'Circularize', metStart: 620 },
      { type: 'DOCK', metStart: 45000 },
      { type: 'COAST', days: 2, metStart: 12000 }, // not in the R6.1 type list -> null
      { type: 'MNODE', metStart: 9000 },
      { type: 'SEPARATE' }, // no metStart stamped -> null
    ],
  };
  const launch = _trajEventNodeInfo(mNode, 0);
  ok('R6.1 _trajEventNodeInfo: LAUNCH resolves met/glyph', launch && launch.met === 0 && launch.glyphKind === 'L');
  ok('R6.1 _trajEventNodeInfo: LAUNCH label mentions the launch', launch && /Launch/.test(launch.label));

  const burn = _trajEventNodeInfo(mNode, 1);
  ok('R6.1 _trajEventNodeInfo: BURN resolves met/glyph', burn && burn.met === 620 && burn.glyphKind === 'B');

  const dock = _trajEventNodeInfo(mNode, 2);
  ok('R6.1 _trajEventNodeInfo: DOCK resolves met/glyph', dock && dock.met === 45000 && dock.glyphKind === 'DK');

  ok('R6.1 _trajEventNodeInfo: unsupported type (COAST) -> null', _trajEventNodeInfo(mNode, 3) === null);

  const mnode = _trajEventNodeInfo(mNode, 4);
  ok('R6.1 _trajEventNodeInfo: MNODE resolves met/glyph', mnode && mnode.met === 9000 && mnode.glyphKind === 'MN');

  ok('R6.1 _trajEventNodeInfo: entry with no stamped metStart -> null', _trajEventNodeInfo(mNode, 5) === null);
  ok('R6.1 _trajEventNodeInfo: out-of-range index -> null', _trajEventNodeInfo(mNode, 99) === null);
  ok('R6.1 _trajEventNodeInfo: null mission -> null', _trajEventNodeInfo(null, 0) === null);
}

// ═══════════════════════════════════════════════════════════════════════════
// R6.2 — planetary surface LOD ladder: pure geometry helpers (2026-07-10)
// ═══════════════════════════════════════════════════════════════════════════
{
  // lat/lon -> unit sphere: sub-solar-style points land where expected.
  const eq0 = _trajLatLonUnit(0, 0);
  approx('R6.2 _trajLatLonUnit(0,0) -> +x', eq0[0], 1, 1e-9);
  approx('R6.2 _trajLatLonUnit(0,0) -> y=0', eq0[1], 0, 1e-9);
  approx('R6.2 _trajLatLonUnit(0,0) -> z=0', eq0[2], 0, 1e-9);

  const eq90 = _trajLatLonUnit(0, 90);
  approx('R6.2 _trajLatLonUnit(0,90) -> +y', eq90[1], 1, 1e-9);

  const pole = _trajLatLonUnit(90, 0);
  approx('R6.2 _trajLatLonUnit(90,0) -> +z (north pole)', pole[2], 1, 1e-9);
  ok('R6.2 _trajLatLonUnit is unit length', Math.abs(Math.hypot(...pole) - 1) < 1e-9 && Math.abs(Math.hypot(...eq90) - 1) < 1e-9);

  // spin rotation about +z: a quarter turn moves +x to +y (or -y), never touches z.
  const spun = _trajSpinRotate([1, 0, 0], Math.PI / 2);
  approx('R6.2 _trajSpinRotate(+x, 90deg) -> y=1', spun[1], 1, 1e-9);
  approx('R6.2 _trajSpinRotate(+x, 90deg) -> x=0', spun[0], 0, 1e-9);
  const poleSpun = _trajSpinRotate([0, 0, 1], Math.PI / 3);
  approx('R6.2 _trajSpinRotate leaves the pole (+z) fixed', poleSpun[2], 1, 1e-9);

  // spin angle: Earth advances monotonically with viewT; Moon's spin tracks
  // its own orbital position angle (+ pi) so the nearside always faces Earth.
  ok('R6.2 _trajBodySpinAngle(Earth) advances with viewT', _trajBodySpinAngle('Earth', 86164.1) > _trajBodySpinAngle('Earth', 0));
  ok('R6.2 _trajBodySpinAngle(Mars) advances with viewT', _trajBodySpinAngle('Mars', 88642.66) > _trajBodySpinAngle('Mars', 0));
  ok('R6.2 _trajBodySpinAngle(Venus) is 0 (no vector surface)', _trajBodySpinAngle('Venus', 12345) === 0);
  {
    const t = 3.7e6;
    const expectMoon = progBodyAngleAt('Moon', t) + Math.PI;
    approx('R6.2 _trajBodySpinAngle(Moon) = orbital position angle + pi (tidal lock)', _trajBodySpinAngle('Moon', t), expectMoon, 1e-9);
  }

  // real physical body radii feed the LOD tiers (not the old schematic "3").
  approx('R6.2 _trajTrueBodyRadiusKm(Earth) = PROG_BODIES.Earth.R', _trajTrueBodyRadiusKm('Earth'), PROG_BODIES.Earth.R, 1e-9);
  approx('R6.2 _trajTrueBodyRadiusKm(Moon) = PROG_BODIES.Moon.R', _trajTrueBodyRadiusKm('Moon'), PROG_BODIES.Moon.R, 1e-9);
  ok('R6.2 _trajTrueBodyRadiusKm(Sun) is the IAU mean solar radius', _trajTrueBodyRadiusKm('Sun') === 696000);
}

// ═══════════════════════════════════════════════════════════════════════════
// R6.2' Phase A — maneuver unification: solved-Δv decomposition (2026-07-10)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { _trajGizmoDecomposeDv } = vm.runInContext('({ _trajGizmoDecomposeDv })', sandbox);

  const axes = { vHat: [1, 0, 0], rHat: [0, 1, 0], hHat: [0, 0, 1] };
  const d1 = _trajGizmoDecomposeDv([1.5, -0.25, 0.75], axes); // km/s -> m/s
  approx('gizmo decomposeDv: pro component (axis-aligned)', d1.pro, 1500, 1e-9);
  approx('gizmo decomposeDv: rad component (axis-aligned)', d1.rad, -250, 1e-9);
  approx('gizmo decomposeDv: nrm component (axis-aligned)', d1.nrm, 750, 1e-9);
  approx('gizmo decomposeDv: magnitude preserved through decomposition',
    Math.hypot(d1.pro, d1.rad, d1.nrm), Math.hypot(1.5, -0.25, 0.75) * 1000, 1e-6);

  // non-axis-aligned orthonormal basis (a real burn-frame triad) still recovers the magnitude
  const axes2 = { vHat: [0, 1, 0], rHat: [1, 0, 0], hHat: [0, 0, -1] };
  const d2 = _trajGizmoDecomposeDv([2, 3, -1], axes2);
  approx('gizmo decomposeDv: reorders/sign-flips per basis (pro <- rHat-slot input)', d2.pro, 3000, 1e-9);
  approx('gizmo decomposeDv: reorders/sign-flips per basis (rad <- vHat-slot input)', d2.rad, 2000, 1e-9);
  approx('gizmo decomposeDv: reorders/sign-flips per basis (nrm <- -hHat-slot input)', d2.nrm, 1000, 1e-9);

  ok('gizmo decomposeDv: null vector -> zeros', JSON.stringify(_trajGizmoDecomposeDv(null, axes)) === JSON.stringify({ pro: 0, rad: 0, nrm: 0 }));
  ok('gizmo decomposeDv: null axes -> zeros', JSON.stringify(_trajGizmoDecomposeDv([1, 2, 3], null)) === JSON.stringify({ pro: 0, rad: 0, nrm: 0 }));
}

// ═══════════════════════════════════════════════════════════════════════════
// R6.2' Phase B step 5 — decomposition BASIS fix (recorded burn state, not
// a mean-motion reconstruction). See PHYSICS_PLAN.md R6.2' "Phase A known
// limitation" (RESOLVED 2026-07-10).
// ═══════════════════════════════════════════════════════════════════════════
{
  const { _trajGizmoAxes, _trajGizmoDecomposeDv } = vm.runInContext('({ _trajGizmoAxes, _trajGizmoDecomposeDv })', sandbox);

  // synthetic circular LEO-ish state: r along +x, v along +y -> axes should
  // read vHat=+y, rHat=+x, hHat=+z (right-hand: r x v = z).
  const r = [7000, 0, 0], v = [0, 7.5, 0];
  const axesRec = _trajGizmoAxes(r, v);
  ok('basis fix: recorded-state axes are the expected right-hand triad',
    axesRec && Math.abs(axesRec.vHat[1] - 1) < 1e-9 && Math.abs(axesRec.rHat[0] - 1) < 1e-9 && Math.abs(axesRec.hHat[2] - 1) < 1e-9);

  // decomposition against a RECORDED basis returns expected components for a
  // synthetic mixed-component case (assertion 1).
  const dMixed = _trajGizmoDecomposeDv([0.1, 3.0, 0.4], axesRec); // km/s
  approx('basis fix: decompose against recorded basis - pro component', dMixed.pro, 3000, 1e-9);
  approx('basis fix: decompose against recorded basis - rad component', dMixed.rad, 100, 1e-9);
  approx('basis fix: decompose against recorded basis - nrm component', dMixed.nrm, 400, 1e-9);

  // TLI-like case: a dvVec that is PURE prograde in its own recorded basis
  // (e.g. the shooter's real departure state) must decompose to ~pure
  // prograde, not the pro/rad/nrm-mixed reading the old mean-motion
  // reconstruction produced for Apollo's actual TLI (assertion 2).
  const dvPureVHat = [0, 3.143, 0]; // km/s, exactly along axesRec.vHat
  const dTLI = _trajGizmoDecomposeDv(dvPureVHat, axesRec);
  approx('basis fix: TLI-like burn decomposes to ~pure prograde (pro)', dTLI.pro, 3143, 1e-9);
  ok('basis fix: TLI-like burn decomposes to ~pure prograde (|rad| ~ 0)', Math.abs(dTLI.rad) < 1e-6);
  ok('basis fix: TLI-like burn decomposes to ~pure prograde (|nrm| ~ 0)', Math.abs(dTLI.nrm) < 1e-6);

  // round-trip compose/decompose identity (assertion 3): build a dvVec from
  // known pro/rad/nrm against a basis, decompose it back, recover the same
  // components (within fp tolerance).
  const compose = (pro_ms, rad_ms, nrm_ms, axes) => [
    axes.vHat[0] * pro_ms / 1000 + axes.rHat[0] * rad_ms / 1000 + axes.hHat[0] * nrm_ms / 1000,
    axes.vHat[1] * pro_ms / 1000 + axes.rHat[1] * rad_ms / 1000 + axes.hHat[1] * nrm_ms / 1000,
    axes.vHat[2] * pro_ms / 1000 + axes.rHat[2] * rad_ms / 1000 + axes.hHat[2] * nrm_ms / 1000,
  ];
  // r/v perpendicular (tangential velocity, no radial component) — the real
  // shape of a recorded parking-orbit burn state (physAimBurnState's own
  // rHat/vHat ARE orthogonal by construction); _trajGizmoAxes's simple
  // r-hat/v-hat basis is only exactly invertible under that condition (it is
  // intentionally NOT Gram-Schmidt-orthonormalized in general).
  const axesTilted = _trajGizmoAxes([6771, 500, 0], [-0.4918678127743018, 6.660873920589595, 3.626406577973024]);
  const composed = compose(-2085, 2151, 950, axesTilted);
  const roundTrip = _trajGizmoDecomposeDv(composed, axesTilted);
  approx('basis fix: round-trip compose/decompose identity - pro', roundTrip.pro, -2085, 1e-6);
  approx('basis fix: round-trip compose/decompose identity - rad', roundTrip.rad, 2151, 1e-6);
  approx('basis fix: round-trip compose/decompose identity - nrm', roundTrip.nrm, 950, 1e-6);
}

// ═══════════════════════════════════════════════════════════════════════════
// R6.3 — launch-time -> RAAN authoring (MATH.md §7k, closes critique 49)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { progLaunchAzimuthDeg, progLaunchRaanFor, progLaunchNextWindowS } =
    vm.runInContext('({ progLaunchAzimuthDeg, progLaunchRaanFor, progLaunchNextWindowS })', sandbox);
  const spin0 = t => (t / 86164.1) * 2 * Math.PI; // same convention as _trajBodySpinAngle('Earth', t)

  // azimuth: launching exactly to your own latitude requires due-east (90 deg)
  approx('progLaunchAzimuthDeg: i=lat=28.5 -> az=90 (due east)', progLaunchAzimuthDeg(28.5, 28.5).azNE, 90, 1e-9);
  // azimuth: KSC (28.5N) to ISS inclination (51.6 deg) -> ~45 deg NE
  approx('progLaunchAzimuthDeg: KSC->51.6deg -> az~=45.0 NE', progLaunchAzimuthDeg(28.5, 51.6).azNE, 44.97513309898836, 1e-9);
  ok('progLaunchAzimuthDeg: SE pair mirrors NE about 90', Math.abs(progLaunchAzimuthDeg(28.5, 51.6).azSE - (180 - 44.97513309898836)) < 1e-9);
  ok('progLaunchAzimuthDeg: i<lat is unreachable (flagged, not NaN)', progLaunchAzimuthDeg(28.5, 10).unreachable === true);

  // RAAN: KSC (28.5N, -80.6E) launching to its own latitude at t=0
  const r1 = progLaunchRaanFor(28.5, -80.6, 28.5, 0, spin0);
  approx('progLaunchRaanFor: KSC->28.5deg @t=0 pinned RAAN', r1.raan, 189.39999999999998, 1e-9);
  approx('progLaunchRaanFor: lambda_inertial @t=0 = site lon (no spin yet)', r1.lambdaInertial, 279.4, 1e-9);
  // same site/time, higher (ISS) inclination -> different RAAN
  const r2 = progLaunchRaanFor(28.5, -80.6, 51.6, 0, spin0);
  approx('progLaunchRaanFor: KSC->51.6deg @t=0 pinned RAAN', r2.raan, 253.91077277764623, 1e-9);
  // 2h later, Earth has rotated -> lambda_inertial and RAAN both shift by the same spin delta
  const r3 = progLaunchRaanFor(28.5, -80.6, 28.5, 7200, spin0);
  approx('progLaunchRaanFor: launch-time offset shifts RAAN by the spin delta', r3.raan - r1.raan, spin0(7200) * 180 / Math.PI, 1e-9);
  ok('progLaunchRaanFor: i<lat is unreachable (flagged)', progLaunchRaanFor(28.5, -80.6, 10, 0, spin0).unreachable === true);

  // next-window: wraps forward through 360 deg, never negative
  approx('progLaunchNextWindowS: 100->190deg forward wait', progLaunchNextWindowS(100, 190, 86164.1), 90 / 360 * 86164.1, 1e-6);
  approx('progLaunchNextWindowS: 190->100deg wraps almost a full day', progLaunchNextWindowS(190, 100, 86164.1), 270 / 360 * 86164.1, 1e-6);
  ok('progLaunchNextWindowS: same RAAN now -> ~0 wait', progLaunchNextWindowS(42, 42, 86164.1) < 1e-6);
}

// ═══════════════════════════════════════════════════════════════════════════
// R6.2' Phase B — maneuver-unification predicates (570-mission-manager.js):
// _evIsSolvedManeuver / _evManeuverTarget / _evIsManualBurn /
// _missionMigrateManeuverEntry. Dated 2026-07-10.
// ═══════════════════════════════════════════════════════════════════════════
{
  const legacyMv = { type: 'MANEUVER', fromNode: 'A', toNode: 'B', metStart: 100 };
  const unifiedSolved = { type: 'MNODE', mode: 'solved', target: { fromNode: 'A', toNode: 'B' }, fromNode: 'A', toNode: 'B' };
  const manualMnode = { type: 'MNODE', dvPro_ms: 10 };
  const detachedManual = { type: 'MNODE', mode: 'manual', target: { fromNode: 'A', toNode: 'B' } };
  const halfUnified = { type: 'MNODE', mode: 'solved', target: { fromNode: 'A' } }; // missing toNode -> not solved

  ok('_evIsSolvedManeuver: legacy MANEUVER is solved', _evIsSolvedManeuver(legacyMv) === true);
  ok('_evIsSolvedManeuver: unified mode:solved+target is solved', _evIsSolvedManeuver(unifiedSolved) === true);
  ok('_evIsSolvedManeuver: manual MNODE is not solved', _evIsSolvedManeuver(manualMnode) === false);
  ok('_evIsSolvedManeuver: incomplete target is not solved', _evIsSolvedManeuver(halfUnified) === false);
  ok('_evIsSolvedManeuver: null-safe', _evIsSolvedManeuver(null) === false);

  const t1 = _evManeuverTarget(legacyMv), t2 = _evManeuverTarget(unifiedSolved);
  ok('_evManeuverTarget: legacy MANEUVER target', t1 && t1.fromNode === 'A' && t1.toNode === 'B');
  ok('_evManeuverTarget: unified MNODE target', t2 && t2.fromNode === 'A' && t2.toNode === 'B');
  ok('_evManeuverTarget: manual MNODE has no target', _evManeuverTarget(manualMnode) === null);

  ok('_evIsManualBurn: manual MNODE is a manual burn', _evIsManualBurn(manualMnode) === true);
  ok('_evIsManualBurn: detached (mode:manual, has target) is a manual burn', _evIsManualBurn(detachedManual) === true);
  ok('_evIsManualBurn: solved MNODE is not a manual burn', _evIsManualBurn(unifiedSolved) === false);
  ok('_evIsManualBurn: legacy MANEUVER is not a manual burn', _evIsManualBurn(legacyMv) === false);

  // lazy migration: legacy MANEUVER -> unified solved, in place, fields mirrored
  const mig = { type: 'MANEUVER', fromNode: 'X', toNode: 'Y', fromLabel: 'X node', toLabel: 'Y node', metStart: 50, dvOverride: 3000 };
  const mutated = _missionMigrateManeuverEntry(mig);
  ok('_missionMigrateManeuverEntry: reports a mutation', mutated === true);
  ok('_missionMigrateManeuverEntry: type flips to MNODE', mig.type === 'MNODE');
  ok('_missionMigrateManeuverEntry: mode becomes solved', mig.mode === 'solved');
  ok('_missionMigrateManeuverEntry: target mirrors fromNode/toNode', mig.target.fromNode === 'X' && mig.target.toNode === 'Y');
  ok('_missionMigrateManeuverEntry: legacy top-level fields survive (mirrored)', mig.fromNode === 'X' && mig.toNode === 'Y' && mig.fromLabel === 'X node' && mig.dvOverride === 3000);
  ok('_missionMigrateManeuverEntry: post-migration predicate agrees', _evIsSolvedManeuver(mig) === true);
  ok('_missionMigrateManeuverEntry: idempotent (already-unified entry -> no mutation)', _missionMigrateManeuverEntry(mig) === false);

  // lazy migration: old Phase-A detachedFrom MNODE -> target populated, still manual
  const oldDetached = { type: 'MNODE', dvPro_ms: 42, detachedFrom: { fromNode: 'P', toNode: 'Q' } };
  const mutated2 = _missionMigrateManeuverEntry(oldDetached);
  ok('_missionMigrateManeuverEntry: detachedFrom save reports a mutation', mutated2 === true);
  ok('_missionMigrateManeuverEntry: detachedFrom -> target populated', oldDetached.target.fromNode === 'P' && oldDetached.target.toNode === 'Q');
  ok('_missionMigrateManeuverEntry: detachedFrom save stays manual (mode set)', oldDetached.mode === 'manual');
  ok('_missionMigrateManeuverEntry: migrated detachedFrom save is a manual burn', _evIsManualBurn(oldDetached) === true);
}

// ═══════════════════════════════════════════════════════════════════════════
// R6.2' Phase C — node-map closure: _nmMatchOrbitToNode / _nmClassifySettledOrbit
// (430's pure classifiers for manual-MNODE settled-orbit matching). Dated 2026-07-10.
// ═══════════════════════════════════════════════════════════════════════════
{
  const nodes = [
    { id: 'leo', label: 'LEO', orbit: { type: 'circular', body: 'Earth', perigee: 185, apogee: 185, inclination: 28.5 } },
    { id: 'gto', label: 'GTO', orbit: { type: 'elliptic', body: 'Earth', perigee: 185, apogee: 35786, inclination: 28.5 } },
    { id: 'escape', label: 'ESCAPE', orbit: { type: 'escape', body: 'Earth', c3: 0.1 } },
  ];

  // Exact match.
  const m1 = _nmMatchOrbitToNode('Earth', 185, 185, 28.5, nodes);
  ok('_nmMatchOrbitToNode: exact match finds LEO', !!m1 && m1.id === 'leo');

  // Within tolerance (peri/apo well under max(5%,25km), inc under 2deg).
  const m2 = _nmMatchOrbitToNode('Earth', 190, 200, 29.8, nodes);
  ok('_nmMatchOrbitToNode: within tolerance still matches LEO', !!m2 && m2.id === 'leo');

  // Tolerance-edge: apogee just past the max(5%,25km) band for LEO's low value
  // (25km floor -> 185+26=211 must miss).
  const m3 = _nmMatchOrbitToNode('Earth', 185, 211, 28.5, nodes);
  ok('_nmMatchOrbitToNode: just past the tolerance band misses', m3 === null);

  // No match at all (odd small ellipse).
  const m4 = _nmMatchOrbitToNode('Earth', 300, 900, 51.6, nodes);
  ok('_nmMatchOrbitToNode: unmatched orbit returns null', m4 === null);

  // Body mismatch never matches even with identical numbers.
  const m5 = _nmMatchOrbitToNode('Moon', 185, 185, 28.5, nodes);
  ok('_nmMatchOrbitToNode: body mismatch returns null', m5 === null);

  // Escape/transit/surface node types are never matched as a "settled" orbit.
  const m6 = _nmMatchOrbitToNode('Earth', 1e6, Infinity, 0, nodes);
  ok('_nmMatchOrbitToNode: escape-type nodes are excluded from matching', m6 === null);

  // _nmClassifySettledOrbit: elements-based wrapper, LEO circular state.
  const REarth = PROG_BODIES.Earth.R, muE = PROG_BODIES.Earth.mu;
  const rpLeo = REarth + 185, raLeo = REarth + 185;
  const elLeo = { a: rpLeo, e: 0, i: 28.5 * Math.PI / 180, rp: rpLeo, ra: raLeo };
  const c1 = _nmClassifySettledOrbit(elLeo, 'Earth', nodes);
  ok('_nmClassifySettledOrbit: circular LEO state classifies to the LEO node', !!c1 && c1.id === 'leo');

  // Hyperbolic (escaping) state never matches a bound node, regardless of nodes list.
  const elHyp = { a: -5000, e: 1.3, i: 0, rp: 6578, ra: -Infinity };
  const c2 = _nmClassifySettledOrbit(elHyp, 'Earth', nodes);
  ok('_nmClassifySettledOrbit: hyperbolic state never matches (escape)', c2 === null);

  // Unmatched bound ellipse -> null (caller treats as a free-burn/"orbit" outcome).
  const elOdd = { a: REarth + 600, e: 0.3, i: 51.6 * Math.PI / 180, rp: REarth + 300, ra: REarth + 900 };
  const c3 = _nmClassifySettledOrbit(elOdd, 'Earth', nodes);
  ok('_nmClassifySettledOrbit: unmatched ellipse returns null', c3 === null);
}

// ═══════════════════════════════════════════════════════════════════════════
// _trajTickIntervalS — time-tick ladder pick (574, added 2026-07-11 for the
// "better time display for intercepts" backlog item: ticks/labels along
// trajectories, scrubbable MET, encounter countdowns).
// ═══════════════════════════════════════════════════════════════════════════
{
  const _trajTickIntervalS = sandbox._trajTickIntervalS;
  // A ~3-day TLC-scale leg (259200s) should land on the 1-day rung (3 ticks
  // over the leg — the ladder's documented "finest rung with count<=8" rule).
  ok('_trajTickIntervalS: 3-day leg picks the 1-day rung', _trajTickIntervalS(259200) === 86400);

  // A short ~10-minute leg should pick the 60s rung (its own tof/step=10<=8
  // fails, so it steps up to... verify against the ladder directly rather
  // than assume — the ladder is [60,600,3600,21600,86400,864000,8640000]).
  ok('_trajTickIntervalS: 10-minute leg picks the 600s rung', _trajTickIntervalS(600) === 600);

  // A ~1-hour leg (3600s): 3600/60=60 (too many), 3600/600=6<=8 -> 600s rung.
  ok('_trajTickIntervalS: 1-hour leg picks the 600s rung', _trajTickIntervalS(3600) === 600);

  // Non-finite / non-positive input falls back to the finest rung rather than
  // throwing or returning NaN (defensive — an unconverged leg can hand this
  // Infinity for tArr-tDep).
  ok('_trajTickIntervalS: non-positive tof falls back to the finest rung', _trajTickIntervalS(-5) === 60);
  ok('_trajTickIntervalS: Infinity tof falls back to the coarsest rung', _trajTickIntervalS(Infinity) === 8640000);
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
