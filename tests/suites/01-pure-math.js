'use strict';
// Auto-split from the former monolithic tests/math.test.js (see tests/harness.js
// for the shared vm-sandbox loader + assertion helpers). Content below is
// relocated byte-for-byte from the original section of the same name; see
// docs/dev_notes.md "Test suite layout" for how to add a new suite.
//
// Suite: Pure math: parseMathExpression, rocketEq, circVel, lvPerformance/lvMaxPayload, progVcirc, destOnOrbitDV, trade-study C3 sweep, preset integrity, S1.5 split, Hohmann/boiloff time, helioR, LOD ramps, R1 ephemeris
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { buildSandbox, makeAssertions, ROOT } = require('../harness');

module.exports = function run() {
  const sandbox = buildSandbox();
  const { ok, approx, counts } = makeAssertions();

const {
  circVel, rotVel, rocketEq, parseMathExpression, mathValue,
  lvPerformance, lvMaxPayload,
  progVcirc, progHohmannTOF, progTransferTOF, progBoiloff,
  _s15BecoSplit, stageExpandS15, stageCarryS15, stageClearS15, stagePickS15, progBodyAngleAt, progBodyWorldPos,
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
  _trajHemiClipRuns,
  _evIsSolvedManeuver, _evManeuverTarget, _evIsManualBurn, _missionMigrateManeuverEntry,
  progLambert3D, progDepartVinf, progOptimalDeparture, progIdealParkingOrbit,
  progPlanLaunchToDestination, progLaunchAzimuthDeg, progMoonPlaneAt, progResolvePlaneTarget,
  progJDToDate, progDateToJD, progMissionTimeToDate, progDateToMissionTime, progDateToLocalInputValue,
  progDvTLI,
  physThrustDir, physThrustLawKnown,
  _tsOnOrbitDVEscapeC3,
  physBodyPoleAt, physEqBasis, physNormalFromIncLan, physIncLanFromNormal,
  progEqToWorldElements, progWorldToEqElements, _trajRingPlaneBasis,
  orbitWorldElements, orbitWorldState,
  orbitNormalize, orbitMeanRadiusKm, orbitPeriodS, orbitWorldNormal,
  _missionMigrateLaunchOrbitEntry, _missionMigrateLaunchOrbitLog,
} = sandbox;
// PHYS_THRUST_REVS_RESOLUTION is a module-scope `const` (not a `function`
// declaration), so it isn't a sandbox-global property — pull it via
// vm.runInContext like the other module-scope consts (orientation map).
const PHYS_THRUST_REVS_RESOLUTION = vm.runInContext('PHYS_THRUST_REVS_RESOLUTION', sandbox);
const { G0, MU, RE, OMEGA_E, PROG_BODIES, PROG_HELIO_R, PROG_MU_SUN, PROG_MOON_ORBITS, PROG_BODY_ELEMENTS, PROG_MOON_ELEMENTS, PROG_DEFAULT_EPOCH_JD, PROG_J2000_JD, PROG_AU_KM, PROG_BODY_POLES } =
  vm.runInContext('({ G0, MU, RE, OMEGA_E, PROG_BODIES, PROG_HELIO_R, PROG_MU_SUN, PROG_MOON_ORBITS, PROG_BODY_ELEMENTS, PROG_MOON_ELEMENTS, PROG_DEFAULT_EPOCH_JD, PROG_J2000_JD, PROG_AU_KM, PROG_BODY_POLES })', sandbox);
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
// Re-pinned 2026-07-18 (was 909.813): LV_MSCORR_* multi-stage ascent
// correction (MATH.md critique 121, Silverbird-fitted) raises DVpen for
// multi-stage stacks; margin drops by the correction.
approx('lvPerformance: golden margin snapshot', res1.margin, 500.769, 0.01);

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
  // 360-delta-v-engine.js). Use rocketEq itself for a
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
    maxPayFor({ mode: 'orbit', apogee: 35786, perigee: 185, inc: 28.5, parkingAlt: 185 }), 44786.45, 2); // re-pinned 2026-07-18 (was 57105): critique 121 correction
  approx('destOnOrbitDV pin: circular 800 km @0° (plane change) matches calculate()',
    maxPayFor({ mode: 'orbit', apogee: 800, perigee: 800, inc: 0, parkingAlt: 185 }), 16582.49, 2); // re-pinned 2026-07-18 (was 24350): critique 121
  approx('destOnOrbitDV pin: escape C3=0 matches calculate()',
    maxPayFor({ mode: 'escape', c3: 0, decl: 28.5, perigee: 185 }), 30521.39, 2); // re-pinned 2026-07-18 (was 40549): critique 121

  // escape below minimum C3 → error, no crash
  ok('destOnOrbitDV: impossible C3 returns error field',
    !!destOnOrbitDV({ mode: 'escape', c3: -200, decl: 28.5, perigee: 185 }, 28.5).error);
}

// ═══════════════════════════════════════════════════════════════════════════
// _tsOnOrbitDVEscapeC3 (165-trade-study.js) — the C3-sweep replica of
// destOnOrbitDV()'s escape branch. Pinned equal to destOnOrbitDV at every
// escape-mode C3 that appears in ORBIT_CATEGORIES (060-orbit-categories.js),
// all of which use decl=siteLat=28.5, perigee=185 — the exact condition under
// which the replica's dropped plane-change term is guaranteed to vanish in the
// original too. Then a monotonicity check and a Saturn V capability-curve
// sanity (payload strictly decreases with C3).
// ═══════════════════════════════════════════════════════════════════════════
{
  ok('_tsOnOrbitDVEscapeC3: function exists', typeof _tsOnOrbitDVEscapeC3 === 'function');

  const destOnOrbitDV = sandbox.destOnOrbitDV;
  const escapeC3s = [-1.9, 0.1, 0.5, 6.3, 8.7, 12.0, 16.0, 25.0, 56.7, 77.4, 98.5, 105.7, 127.5, 135.9, 139.6, 152.0];
  escapeC3s.forEach(c3 => {
    const pinned = destOnOrbitDV({ mode: 'escape', c3, decl: 28.5, perigee: 185 }, 28.5).onOrbitDV;
    const replica = _tsOnOrbitDVEscapeC3(c3, 185).onOrbitDV;
    approx(`_tsOnOrbitDVEscapeC3(${c3},185) == destOnOrbitDV escape pin`, replica, pinned, 1e-9);
  });

  // monotonicity: higher C3 → strictly more on-orbit ΔV, same parking orbit
  {
    const c3Series = [0, 10, 30, 60, 100, 120];
    const dvs = c3Series.map(c3 => _tsOnOrbitDVEscapeC3(c3, 185).onOrbitDV);
    let monotone = true;
    for (let i = 1; i < dvs.length; i++) if (!(dvs[i] > dvs[i - 1])) monotone = false;
    ok('_tsOnOrbitDVEscapeC3: monotonically increasing in C3', monotone);
  }

  // below-minimum C3 still reports an error, same as destOnOrbitDV
  ok('_tsOnOrbitDVEscapeC3: impossible C3 returns error field',
    !!_tsOnOrbitDVEscapeC3(-200, 185).error);

  // capability curve: builtin Saturn V max payload strictly decreases as C3 rises
  {
    const satStages = [
      { dry: 130980, prop: 2169290, thrust: 34020, isp: 304, res: 2 },
      { dry: 34450,  prop: 451830,  thrust: 5165,  isp: 425, res: 2 },
      { dry: 0,      prop: 0,       thrust: 0,     isp: 300, res: 2 },
    ];
    const c3Curve = [0, 10, 30, 60, 100, 120];
    const site = { lat: 28.5, azMin: 37, azMax: 112 };
    const pays = c3Curve.map(c3 => {
      const r = _tsOnOrbitDVEscapeC3(c3, 185);
      return lvMaxPayload(satStages, null, 0, 0, 185, r.onOrbitDV, site.lat, site.azMin, site.azMax);
    });
    // Non-increasing everywhere (a capability curve legitimately clips at 0 once
    // C3 exceeds what the vehicle can reach), with at least one strict decrease
    // so the curve isn't flat.
    let nonIncreasing = true, sawStrictDrop = false;
    for (let i = 1; i < pays.length; i++) {
      if (pays[i] > pays[i - 1]) nonIncreasing = false;
      if (pays[i] < pays[i - 1]) sawStrictDrop = true;
    }
    ok('_tsOnOrbitDVEscapeC3 + lvMaxPayload: Saturn V payload is non-increasing with C3', nonIncreasing);
    ok('_tsOnOrbitDVEscapeC3 + lvMaxPayload: Saturn V payload curve actually drops (not flat)', sawStrictDrop);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// preset integrity — every builtin preset's stageNames/boosterName must
// resolve against STAGE_LIBRARY. A miss silently becomes a zero-mass ghost
// stage ({dry:0,prop:0,...}) that "flies" to orbit alongside real stages
// (caught live on Saturn V, 2026-07-03: 'Saturn V S-IVB' vs library name
// 'Saturn 1B & V S-IVB').
// ═══════════════════════════════════════════════════════════════════════════
{
  const psrc = ['src/js/020-state.js', 'src/js/210-stage-library.js', 'src/js/050-builtin-presets.js']
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

  // ── Expansion: the ONE S1.5 expansion boundary (stageExpandS15,
  // src/js/140-physics.js, UNIFICATION_AUDIT P2.1) — exercised directly here
  // rather than a locally-duplicated mirror, so this pin also covers the
  // shared boundary all three real callers (150/560/165) now route through.
  const expanded = stageExpandS15([atlasD, upperStage], { onError: 'annotate' });
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
    s15MaxPay, 1750.95, 1); // re-pinned 2026-07-18 (was 2329.83): critique 121 correction applies to the expanded 2-stage S1.5 stack

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
  ok('N-Pluto: Pluto has JPL 1800-2050 elements', !!PROG_BODY_ELEMENTS.Pluto);
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

  // N-Pluto: heliocentric distance at J2000 itself (not the app's default
  // 2026 epoch) must land in [29, 32] AU — Pluto was inside Neptune's orbit
  // until 1999, so this is a real discriminating sanity check, not a
  // tautology. t_s is seconds from PROG_DEFAULT_EPOCH_JD to PROG_J2000_JD.
  {
    const tsAtJ2000 = (PROG_J2000_JD - PROG_DEFAULT_EPOCH_JD) * 86400;
    const rPlutoJ2000_AU = mag3(progBodyEphemState('Pluto', tsAtJ2000).r) / PROG_AU_KM;
    ok(`N-Pluto: heliocentric r at J2000 in [29,32] AU (got ${rPlutoJ2000_AU.toFixed(3)} AU)`,
      rPlutoJ2000_AU >= 29 && rPlutoJ2000_AU <= 32);
  }

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
// SILVERBIRD ANCHORS (2026-07-18, MATH.md critique 121) — the LV calculator's
// correctness standard is fidelity to Silverbird Astronautics (user directive).
// Reference: 30-probe black-box campaign, tests/fixtures/silverbird-probes-
// 2026-07-18.md. Silverbird raw, OUR stage data, SatV 185x185@28.5: 119,002 kg.
// Our corrected model must stay within the validated band of that reference,
// and the multi-stage correction must stay ON for stacks / OFF for singles.
// ═══════════════════════════════════════════════════════════════════════════
{
  const satst=[{dry:130980,prop:2169290,thrust:34020,isp:304,res:2},{dry:34450,prop:451830,thrust:5165,isp:425,res:2},{dry:15090,prop:108110,thrust:876,isp:425,res:2}];
  const mp=lvMaxPayload(satst,null,0,0,185,0,28.5,37,112);
  approx('SB anchor: Saturn V 185x185@28.5 corrected max payload (headline golden)', mp, 125893, 5);
  const sbRaw=119002;
  ok('SB anchor: corrected SatV within +8%/-2% of Silverbird raw (119,002)', mp>sbRaw*0.98 && mp<sbRaw*1.08);
  const perf=lvPerformance(satst,null,mp,0,0,185,0,28.5,37,112);
  ok('SB anchor: multi-stage correction active on SatV (msCorr 500-800 m/s band)', perf.msCorr>500 && perf.msCorr<800);
  const ss=lvPerformance([{dry:5000,prop:100000,thrust:2500,isp:350,res:0}],null,3948,0,0,185,0,28.5,37,112);
  ok('SB anchor: single-stage msCorr gated off (exactly 0)', ss.msCorr===0);
  ok('SB anchor: DVpen decomposes (DVpenBase + msCorr, exact)', Math.abs(perf.DVpenBase+perf.msCorr-perf.DVpen)<1e-9);
}

  return counts();
};
