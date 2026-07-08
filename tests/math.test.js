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
  _s15BecoSplit,
} = sandbox;
const { G0, MU, RE, OMEGA_E, PROG_BODIES } =
  vm.runInContext('({ G0, MU, RE, OMEGA_E, PROG_BODIES })', sandbox);

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
// summary
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total assertions)`);
if (fail > 0) {
  console.error('\nFailed assertions:');
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
