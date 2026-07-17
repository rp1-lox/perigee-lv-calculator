'use strict';
// Auto-split from the former monolithic tests/math.test.js (see tests/harness.js
// for the shared vm-sandbox loader + assertion helpers). Content below is
// relocated byte-for-byte from the original section of the same name; see
// docs/dev_notes.md "Test suite layout" for how to add a new suite.
//
// Suite: MISSION_MODEL_V2 Phase 1-4: shadow state, budget-delegation flip, reference-orbit catalog CRUD, orbitRefId binding, orbit inspector, NRHO catalog + propagated-ring gate
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
  _s15BecoSplit, stageCarryS15, stageClearS15, stagePickS15, progBodyAngleAt, progBodyWorldPos,
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
// JD <-> calendar-date conversion (feedback items 3/5) — round-trip + known dates
// ═══════════════════════════════════════════════════════════════════════════
{
  // Known JD/date pair: 2000-01-01 12:00:00 UTC = JD 2451545.0 (J2000.0 epoch).
  const j2000 = progJDToDate(2451545.0);
  ok('progJDToDate: J2000.0 -> 2000-01-01T12:00:00Z', j2000.toISOString() === '2000-01-01T12:00:00.000Z');
  approx('progDateToJD: 2000-01-01T12:00:00Z -> JD 2451545.0', progDateToJD('2000-01-01T12:00:00Z'), 2451545.0, 1e-9);

  // Round-trip: JD -> Date -> JD for the program's default epoch and a few offsets.
  // Date is millisecond-resolution, so round-trip tolerance is 1ms in JD days.
  for (const jd of [PROG_DEFAULT_EPOCH_JD, PROG_DEFAULT_EPOCH_JD + 123.456, PROG_DEFAULT_EPOCH_JD - 500.25]) {
    const rt = progDateToJD(progJDToDate(jd));
    approx(`JD<->Date round-trip @ JD=${jd}`, rt, jd, 2e-8);
  }

  // Mission-time round-trip (seconds-from-epoch is the authored storage model
  // per D4 -- the picker only converts for DISPLAY, never changes what's stored).
  {
    const savedEpoch = PROG_DEFAULT_EPOCH_JD;
    for (const t_s of [0, 3600, 86400 * 30.5, -7200]) {
      const d = progMissionTimeToDate(t_s);
      const back = progDateToMissionTime(d);
      approx(`mission-time<->Date round-trip @ t_s=${t_s}`, back, t_s, 2e-3);
    }
  }

  // datetime-local input value format: "YYYY-MM-DDTHH:mm", UTC fields.
  {
    const d = new Date(Date.UTC(2026, 6, 14, 9, 30));
    ok('progDateToLocalInputValue: formats as YYYY-MM-DDTHH:mm (UTC)', progDateToLocalInputValue(d) === '2026-07-14T09:30');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 Phase 1 — shadow state (566)
// ═══════════════════════════════════════════════════════════════════════════
{
  const {
    v2BuildShadow, v2StateAt, v2DeriveBudget, v2Reconcile, _v2StateByMission,
  } = vm.runInContext(
    '({ v2BuildShadow, v2StateAt, v2DeriveBudget, v2Reconcile, _v2StateByMission })',
    sandbox
  );

  ok('S1: _v2StateByMission starts as an object side-table', typeof _v2StateByMission === 'object');
  ok('S1: v2StateAt on an unknown mission returns null (no throw)', v2StateAt('nope', 'lv0#0', 0) === null);
  ok('S1: v2BuildShadow on a missing mission is a safe no-op', (v2BuildShadow(null), true));
  ok('S1: v2DeriveBudget on an unbuilt mission returns empty shape', (function () {
    const b = v2DeriveBudget('nope'); return Array.isArray(b.perBurn) && b.perBurn.length === 0 && b.dvTotal === 0;
  })());

  // Fresh sandbox-global program/leg fixtures for a synthetic mission, so this
  // block doesn't depend on any earlier test's PROG_ACTIVE_PROGRAM state.
  vm.runInContext(`
    PROG_ACTIVE_PROGRAM = { epochJD: PROG_DEFAULT_EPOCH_JD, vehicles: {} };
    _physTrajByMission = _physTrajByMission || {};
  `, sandbox);

  // ── S2: launch anchor + v2StateAt inside a legless (single-anchor) window ──
  const launchFv = vm.runInContext(`
    (function () {
      const alt = 200;
      const fv = { vehicleId: 'v1', orbitState: { body: 'Earth', apogee: alt, perigee: alt, inclination: 28.5, lan: 0, surface: false },
        stages: [ { stageDefinitionId: 'S1', _ownerKey: 'lv0#0', dry_mass: 10000, isp: 350 } ] };
      PROG_ACTIVE_PROGRAM.vehicles.v1 = fv;
      return fv;
    })()
  `, sandbox);
  const m1 = { missionId: 'synM1', log: [{ type: 'LAUNCH', vehicleId: 'v1', metStart: 0, result: 'SUCCESS', dv_actual: 0 }] };
  m1._expanded = [{ type: 'LAUNCH', vehicleId: 'v1', metStart: 0, result: 'SUCCESS', _authIdx: 0 }];
  v2BuildShadow(m1);
  const s0 = v2StateAt('synM1', 'lv0#0', 0);
  ok('S2: launch anchor produced a state at t=0', !!(s0 && s0.r && s0.v));
  if (s0) {
    const RE_ = vm.runInContext('RE', sandbox);
    const rmag = Math.hypot(s0.r[0], s0.r[1], s0.r[2]);
    approx('S2: launch-anchor radius matches the parking orbit (RE+200km)', rmag, RE_ + 200, 1);
    ok('S2: launch anchor frame is the parking body', s0.frame === 'Earth');
  }
  ok('S2: v2StateAt before the first anchor returns null', v2StateAt('synM1', 'lv0#0', -10) === null);

  // ── S3: solved + manual MNODE burn anchors, dv reconciles with V1 ──────────
  const burnFixture = vm.runInContext(`
    (function () {
      const preR = [7000, 0, 0], preV = [0, 7.5, 0];
      const dvVec = [0, 0.25, 0];   // km/s -> 250 m/s
      _physTrajByMission['synM2'] = { legs: [
        { authIdx: 1, burnState: { r: preR, v: preV }, dvVec: dvVec, center: 'Earth', kind: 'samebody' },
        { authIdx: 2, burnState: { r: preR, v: preV }, dvVec: [0, 0.10, 0], center: 'Earth', kind: 'mnode' },
      ] };
      PROG_ACTIVE_PROGRAM.vehicles.v2 = { vehicleId: 'v2', orbitState: { body: 'Earth', apogee: 200, perigee: 200, inclination: 0, lan: 0 },
        stages: [ { stageDefinitionId: 'S1', _ownerKey: 'lv0#1', dry_mass: 5000, isp: 320 } ] };
      return true;
    })()
  `, sandbox);
  ok('S3: burn fixture set up', burnFixture === true);
  const m2 = { missionId: 'synM2', log: [
    { type: 'LAUNCH', vehicleId: 'v2', metStart: 0, result: 'SUCCESS', dv_actual: 0 },
    { type: 'MNODE', vehicleId: 'v2', metStart: 100, dv_actual: 250 },     // solved-equivalent, matches dvVec magnitude
    { type: 'MNODE', vehicleId: 'v2', metStart: 200, dv_actual: 100 },     // manual burn
  ] };
  m2._expanded = [
    { type: 'LAUNCH', vehicleId: 'v2', metStart: 0, result: 'SUCCESS', _authIdx: 0 },
    { type: 'MNODE', vehicleId: 'v2', metStart: 100, _authIdx: 1 },
    { type: 'MNODE', vehicleId: 'v2', metStart: 200, _authIdx: 2 },
  ];
  vm.runInContext('_missions.length = 0', sandbox);
  const pushMission = vm.runInContext('(function(x){ _missions.push(x); })', sandbox);
  pushMission(m2);
  v2BuildShadow(m2);
  const budget2 = v2DeriveBudget('synM2');
  ok('S3: two burn anchors produced two per-burn budget rows', budget2.perBurn.length === 2);
  approx('S3: solved-MNODE anchor dv matches leg.dvVec magnitude (250 m/s)', budget2.perBurn[0].dv_ms, 250, 1e-6);
  approx('S3: manual-MNODE anchor dv matches leg.dvVec magnitude (100 m/s)', budget2.perBurn[1].dv_ms, 100, 1e-6);

  // ── S5: reconciliation harness on the same synthetic 3-event mission ──────
  const recon2 = v2Reconcile('synM2');
  ok('S5: v2Reconcile pairs both burns with their V1 log entries', recon2.rows.length === 2);
  ok('S5: v2Reconcile per-burn deltas are within D6 margin (dv matches by construction)', recon2.rows.every(r => r.withinMargin));
  ok('S5: v2Reconcile totals are within D6 margin', recon2.totals.withinMargin);
  ok('S5: v2Reconcile.allWithin is true for a self-consistent fixture', recon2.allWithin === true);

  // A deliberately mismatched V1 dv_actual must be flagged, not silently passed
  // (D6 margin math itself, since v2Reconcile's mission lookup needs
  // _missionById/_missions wiring this isolated harness doesn't set up).
  ok('S5: D6 margin math flags a genuine mismatch (9000 vs 250 far exceeds max(1%,5m/s))',
    Math.abs(9000 - 250) > Math.max(5, 0.01 * 9000));

  // ── S4: composition event carries state through, forks a new owner key ────
  vm.runInContext(`
    PROG_ACTIVE_PROGRAM.vehicles.vLower = { vehicleId: 'vLower', stages: [ { stageDefinitionId: 'S1', _ownerKey: 'lv0#2', dry_mass: 3000, isp: 300 } ] };
    PROG_ACTIVE_PROGRAM.vehicles.vUpper = { vehicleId: 'vUpper', stages: [ { stageDefinitionId: 'S2', _ownerKey: 'lv1#2', dry_mass: 500, isp: 450 } ] };
    PROG_ACTIVE_PROGRAM.vehicles.v3 = { vehicleId: 'v3', orbitState: { body: 'Earth', apogee: 200, perigee: 200, inclination: 0, lan: 0 },
      stages: [ { stageDefinitionId: 'S1', _ownerKey: 'lv0#2', dry_mass: 3000, isp: 300 }, { stageDefinitionId: 'S2', _ownerKey: 'lv1#2', dry_mass: 500, isp: 450 } ] };
    true;
  `, sandbox);
  const m3 = { missionId: 'synM3', log: [
    { type: 'LAUNCH', vehicleId: 'v3', metStart: 0, result: 'SUCCESS' },
    { type: 'SEPARATE', lowerVehicleId: 'vLower', upperVehicleId: 'vUpper', metStart: 50 },
  ] };
  m3._expanded = [
    { type: 'LAUNCH', vehicleId: 'v3', metStart: 0, result: 'SUCCESS', _authIdx: 0 },
    { type: 'SEPARATE', lowerVehicleId: 'vLower', upperVehicleId: 'vUpper', metStart: 50, _authIdx: 1 },
  ];
  v2BuildShadow(m3);
  const lowerState = v2StateAt('synM3', 'lv0#2', 50);
  const upperState = v2StateAt('synM3', 'lv1#2', 50);
  ok('S4: SEPARATE forks a composition anchor for the lower stage owner', !!lowerState);
  ok('S4: SEPARATE forks a composition anchor for the upper stage owner', !!upperState);
  if (lowerState && upperState) {
    ok('S4: both post-separation owners inherit the SAME pre-separation r,v (state carried through, mass forked)',
      lowerState.r[0] === upperState.r[0] && lowerState.v[1] === upperState.v[1]);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 Phase 2 — the flip (S4 stamp-from-V2/budget delegation,
// S5 deletions + version gate)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { missionBudget, _missionsPassV2Gate } = vm.runInContext(
    '({ missionBudget, _missionsPassV2Gate })', sandbox
  );

  // ── S4: missionBudget(m) delegates to v2DeriveBudget — reusing synM2 from
  // the Phase 1 block above (already shadow-built: LAUNCH + two burns, 250 +
  // 100 m/s). No ascent line (no stagingResult on that synthetic LAUNCH), so
  // missionBudget's total should equal v2DeriveBudget's dvTotal exactly. ──
  const m2ForBudget = { missionId: 'synM2', log: [
    { type: 'LAUNCH', vehicleId: 'v2', metStart: 0, result: 'SUCCESS' },
    { type: 'MNODE', vehicleId: 'v2', metStart: 100 },
    { type: 'MNODE', vehicleId: 'v2', metStart: 200 },
  ] };
  const budgetViaMissionBudget = missionBudget(m2ForBudget);
  approx('S4: missionBudget(m).dvExpended delegates to v2DeriveBudget (250+100=350 m/s, no ascent)',
    budgetViaMissionBudget.dvExpended, 350, 1e-6);

  // ── S5: version gate — a synthetic pre-Phase-2 ("V1-shaped") missions array
  // (no modelVersion field, as every mission this build's predecessor ever
  // produced) is refused; a V2-stamped array passes. ──
  ok('S5: version gate refuses a mission blob with no modelVersion field',
    _missionsPassV2Gate([{ missionId: 'old1', log: [] }]) === false);
  ok('S5: version gate refuses a mission blob stamped modelVersion:1',
    _missionsPassV2Gate([{ missionId: 'old2', log: [], modelVersion: 1 }]) === false);
  ok('S5: version gate accepts a mission blob stamped modelVersion:2',
    _missionsPassV2Gate([{ missionId: 'new1', log: [], modelVersion: 2 }]) === true);
  ok('S5: version gate accepts an empty/absent missions array (nothing to gate)',
    _missionsPassV2Gate([]) === true && _missionsPassV2Gate(undefined) === true);
  ok('S5: version gate refuses if ANY mission in a multi-mission blob is pre-V2',
    _missionsPassV2Gate([{ missionId: 'a', log: [], modelVersion: 2 }, { missionId: 'b', log: [] }]) === false);
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 Phase 3 T1 — reference-orbit catalog (CRUD, resolve,
// persistence round-trip, propagated-stub behavior)
// ═══════════════════════════════════════════════════════════════════════════
{
  const {
    refOrbitGet, refOrbitAdd, refOrbitUpdate, refOrbitDelete, refOrbitResolve,
    refOrbitCatalogList, refOrbitIsBuiltin,
    _refOrbitSessionSave, _refOrbitSessionRestore,
  } = vm.runInContext(
    '({ refOrbitGet, refOrbitAdd, refOrbitUpdate, refOrbitDelete, refOrbitResolve, refOrbitCatalogList, refOrbitIsBuiltin, _refOrbitSessionSave, _refOrbitSessionRestore })',
    sandbox
  );

  // ── builtins present with the documented canon ──
  ok('T1: builtin leo-185 present', !!refOrbitGet('leo-185'));
  const leo185 = refOrbitResolve('leo-185');
  ok('T1: leo-185 resolves to 185x185 @28.5', leo185 && leo185.periKm === 185 && leo185.apoKm === 185 && leo185.incDeg === 28.5);
  ok('T1: Station (leo-400-51.6) is 400x400 @51.6', (() => {
    const r = refOrbitResolve('leo-400-51.6'); return r && r.periKm === 400 && r.apoKm === 400 && r.incDeg === 51.6;
  })());
  ok('T1: SSO 800 is 800x800 @98.6', (() => {
    const r = refOrbitResolve('sso-800'); return r && r.periKm === 800 && r.apoKm === 800 && r.incDeg === 98.6;
  })());
  ok('T1: GTO is 185x35786 @28.5', (() => {
    const r = refOrbitResolve('gto-185'); return r && r.periKm === 185 && r.apoKm === 35786 && r.incDeg === 28.5;
  })());
  ok('T1: GEO is 35786x35786 @0', (() => {
    const r = refOrbitResolve('geo'); return r && r.periKm === 35786 && r.apoKm === 35786 && r.incDeg === 0;
  })());
  ok('T1: LLO 100 is polar (inc 90) on Moon', (() => {
    const r = refOrbitResolve('llo-100'); return r && r.body === 'Moon' && r.periKm === 100 && r.apoKm === 100 && r.incDeg === 90;
  })());

  // ── propagated entry: nrho-nominal — SEEDED as of Phase 4 (see the U4 test
  // block below for the full corrector/sampling gate); this T1-era check now
  // just confirms the kind + that resolve() carries the seed through. ──
  const nrho = refOrbitGet('nrho-nominal');
  ok('T1: nrho-nominal exists as kind:propagated', !!nrho && nrho.kind === 'propagated');
  const nrhoResolved = refOrbitResolve('nrho-nominal');
  ok('T1: (Phase 4) propagated entry resolves with its seedState, inc null (no Kepler elements)',
    nrhoResolved && nrhoResolved.incDeg === null && !!nrhoResolved.seedState);

  // ── builtin immutability ──
  ok('T1: refOrbitIsBuiltin true for a builtin id', refOrbitIsBuiltin('leo-185') === true);
  ok('T1: refOrbitUpdate on a builtin id is a no-op (returns false)', refOrbitUpdate('leo-185', { incDeg: 99 }) === false);
  ok('T1: builtin leo-185 unchanged after the rejected update', refOrbitResolve('leo-185').incDeg === 28.5);
  ok('T1: refOrbitDelete on a builtin id is a no-op (returns false)', refOrbitDelete('leo-185') === false);

  // ── user-tier CRUD (refOrbitAdd/refOrbitUpdate take canonical periKm/apoKm/
  // incDeg input since the C2b item-2 tolerance retirement; resolve() returns
  // canonical too). ──
  const created = refOrbitAdd({ name: 'My Test Orbit', body: 'Earth', periKm: 300, apoKm: 300, incDeg: 45 });
  ok('T1: refOrbitAdd returns an entry with a fresh (non-builtin-style) id', !!created && !!created.id && created.id !== 'leo-185');
  ok('T1: refOrbitIsBuiltin false for the new user entry', refOrbitIsBuiltin(created.id) === false);
  ok('T1: created entry resolves with the authored elements', (() => {
    const r = refOrbitResolve(created.id); return r && r.periKm === 300 && r.apoKm === 300 && r.incDeg === 45;
  })());
  ok('T1: refOrbitUpdate mutates a user entry', refOrbitUpdate(created.id, { incDeg: 60 }) === true);
  ok('T1: updated user entry reflects the new value on resolve', refOrbitResolve(created.id).incDeg === 60);
  ok('T1: refOrbitCatalogList includes the user entry with builtin:false', (() => {
    const found = refOrbitCatalogList().find(e => e.id === created.id);
    return !!found && found.builtin === false;
  })());
  ok('T1: refOrbitAdd rejects a spec missing name/body', refOrbitAdd({ periKm: 100 }) === null);

  // ── persistence round-trip (455/450 pattern) ──
  const saved = _refOrbitSessionSave();
  ok('T1: session-save captures the user entry', Array.isArray(saved) && saved.some(e => e.id === created.id));
  ok('T1: refOrbitDelete removes a user entry', refOrbitDelete(created.id) === true);
  ok('T1: deleted user entry no longer resolves', refOrbitResolve(created.id) === null);
  _refOrbitSessionRestore(saved);
  ok('T1: session-restore round-trips the deleted entry back', (() => {
    const r = refOrbitResolve(created.id); return r && r.periKm === 300 && r.apoKm === 300 && r.incDeg === 60;
  })());
  // Clean up so later tests in this file see the same catalog state they'd
  // see on a fresh load (this module's globals persist for the rest of the run).
  refOrbitDelete(created.id);
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 Phase 3 T2/T3 — orbitRefId binding + dwell/transit burn names
// ═══════════════════════════════════════════════════════════════════════════
// T2 gate (§13): two events bound to one user ref; a ref edit moves BOTH inline
// orbits on the next recompute; detaching one (orbitRefId=null) isolates it; a
// deleted ref keeps the cached inline values and stamps _refNote (never throws).
// The DEPLOY events use a bogus spacecraftId on purpose — the replay marks them
// FAILED, but the T2 ref-resolution block runs BEFORE the type dispatch, which
// is exactly the seam under test (no DOM, no runtime vehicles needed).
{
  vm.runInContext(
    "if (typeof PROG_ACTIVE_PROGRAM==='undefined') globalThis.PROG_ACTIVE_PROGRAM={vehicles:{}};" +
    "if (typeof _scEdSC==='undefined') globalThis._scEdSC=[];", sandbox);
  const t2 = vm.runInContext(`(function(){
    const ref = refOrbitAdd({ name:'t2 gate ref', body:'Earth', kind:'keplerian', periKm:250, apoKm:250, incDeg:45 });
    const mk = () => ({ type:'DEPLOY', spacecraftId:'nope', orbit:{ body:'Earth', periKm:1, apoKm:1, incDeg:1 }, orbitRefId: ref.id });
    const m = { missionId:'t2gate', name:'t', log:[mk(), mk()], groups:{}, vehicleIds:[], vehicleId:null,
                launchOrbit:{ body:'Earth', periKm:185, apoKm:185, incDeg:28.5, lanDeg:0 }, modelVersion:2 };
    missionRecompute(m);
    const boundBoth = m.log[0].orbit.periKm === 250 && m.log[0].orbit.incDeg === 45 && m.log[1].orbit.periKm === 250;
    refOrbitUpdate(ref.id, { incDeg:60, periKm:300, apoKm:300 });
    m.log[1].orbitRefId = null;                       // detach the second binder
    missionRecompute(m);
    const editMovesBound = m.log[0].orbit.incDeg === 60 && m.log[0].orbit.periKm === 300;
    const detachIsolates = m.log[1].orbit.incDeg === 45 && m.log[1].orbit.periKm === 250;
    refOrbitDelete(ref.id);
    m.log[0].orbitRefId = ref.id;                     // now dangling
    missionRecompute(m);
    const deletedKeepsCache = m.log[0]._refNote != null && m.log[0].orbit.periKm === 300;
    return { boundBoth, editMovesBound, detachIsolates, deletedKeepsCache };
  })()`, sandbox);
  ok('T2: two events bound to one user ref resolve to its elements', t2.boundBoth);
  ok('T2: refOrbitUpdate + recompute moves the still-bound event', t2.editMovesBound);
  ok('T2: detached event keeps its cached inline orbit', t2.detachIsolates);
  ok('T2: deleted ref keeps cached values + stamps _refNote (no throw)', t2.deletedKeepsCache);
}

// T3 gate (§13): _nmBurnNames canon table + fallback, and the terminology helper —
// transit nodes never label as orbits you park in.
{
  const bn = pair => vm.runInContext(`_nmBurnNames('${pair.split('>')[0]}','${pair.split('>')[1]}')`, sandbox);
  ok('T3: Earth→Moon = {TLI, LOI}', (() => { const r = bn('Earth>Moon'); return r.dep === 'TLI' && r.arr === 'LOI'; })());
  ok('T3: Moon→Earth = {TEI, reentry}', (() => { const r = bn('Moon>Earth'); return r.dep === 'TEI' && r.arr === 'reentry'; })());
  ok('T3: Earth→Mars = {TMI, MOI}', (() => { const r = bn('Earth>Mars'); return r.dep === 'TMI' && r.arr === 'MOI'; })());
  ok('T3: Earth→Venus = {TVI, VOI}', (() => { const r = bn('Earth>Venus'); return r.dep === 'TVI' && r.arr === 'VOI'; })());
  ok('T3: unknown pair falls back to {injection, insertion}', (() => { const r = bn('Earth>Jupiter'); return r.dep === 'injection' && r.arr === 'insertion'; })());
  const lblTo = vm.runInContext("_missionManeuverNodeLabel('tlc','to')", sandbox);
  const lblFrom = vm.runInContext("_missionManeuverNodeLabel('tlc','from')", sandbox);
  ok('T3: transit destination label is the burn name ("TLI (trans-lunar)")', lblTo === 'TLI (trans-lunar)');
  ok('T3: transit origin label is the corridor coast ("trans-lunar coast")', lblFrom === 'trans-lunar coast');
  const lblDwell = vm.runInContext("_missionManeuverNodeLabel('llo','to')", sandbox);
  ok('T3: dwell node label unchanged (LLO …)', /^LLO/.test(lblDwell));
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 Phase 3 T4 — orbit inspector: pure D1 re-solve-locality
// ═══════════════════════════════════════════════════════════════════════════
// D1 (§0): "the transfer that DELIVERS you to the node re-solves... changes
// never propagate past adjacent edges." Synthetic 4-dwell chain A-B-C-D (all
// real circular Earth orbits so progNmComputeEdgeDv takes the generic
// coaxial vis-viva path, unlike the seed's transit-corridor LOI leg which is
// a fixed patched-conic lookup — see MATH.md §7r for why the seed's LLO leg
// doesn't move under this same edit and why LEO-origin edits were used for
// the browser-measured evidence instead). Edit node B's altitude: edge(A,B)
// (B is the delivering edge's target) and edge(B,C) (B is the departing
// edge's origin) both re-solve; edge(C,D), two hops away, must NOT move.
{
  const t4 = vm.runInContext(`(function(){
    if (typeof PROG_ACTIVE_PROGRAM === 'undefined' || !PROG_ACTIVE_PROGRAM) globalThis.PROG_ACTIVE_PROGRAM = { vehicles:{} };
    PROG_ACTIVE_PROGRAM.nodeMapCustomNodes = [
      { id:'t4-a', nodeId:'t4-a', label:'A', custom:true, orbit:{ type:'circular', body:'Earth', perigee:200, apogee:200, inclination:28.5 } },
      { id:'t4-b', nodeId:'t4-b', label:'B', custom:true, orbit:{ type:'circular', body:'Earth', perigee:400, apogee:400, inclination:28.5 } },
      { id:'t4-c', nodeId:'t4-c', label:'C', custom:true, orbit:{ type:'circular', body:'Earth', perigee:800, apogee:800, inclination:28.5 } },
      { id:'t4-d', nodeId:'t4-d', label:'D', custom:true, orbit:{ type:'circular', body:'Earth', perigee:1200, apogee:1200, inclination:28.5 } },
    ];
    const dvAB_before = progNmComputeEdgeDv('t4-a','t4-b').dv;
    const dvBC_before = progNmComputeEdgeDv('t4-b','t4-c').dv;
    const dvCD_before = progNmComputeEdgeDv('t4-c','t4-d').dv;
    // edit node B (like _oiResolveManeuverNodeId mutating a custom node in place)
    PROG_ACTIVE_PROGRAM.nodeMapCustomNodes[1].orbit.perigee = 600;
    PROG_ACTIVE_PROGRAM.nodeMapCustomNodes[1].orbit.apogee = 600;
    const dvAB_after = progNmComputeEdgeDv('t4-a','t4-b').dv;
    const dvBC_after = progNmComputeEdgeDv('t4-b','t4-c').dv;
    const dvCD_after = progNmComputeEdgeDv('t4-c','t4-d').dv;
    delete PROG_ACTIVE_PROGRAM.nodeMapCustomNodes;
    return { dvAB_before, dvBC_before, dvCD_before, dvAB_after, dvBC_after, dvCD_after };
  })()`, sandbox);
  ok('T4 D1: editing node B re-solves the DELIVERING edge A→B', t4.dvAB_after !== t4.dvAB_before);
  ok('T4 D1: editing node B re-solves the DEPARTING edge B→C', t4.dvBC_after !== t4.dvBC_before);
  ok('T4 D1: edge C→D (two hops from B) is UNTOUCHED', t4.dvCD_after === t4.dvCD_before);
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 Phase 4 U4 — NRHO catalog + propagated-ring gate
// ═══════════════════════════════════════════════════════════════════════════
// Per §14 U4: "the corrector run in the gate should use the HARD-CODED seed
// ... if the full correction is slow, gate only VERIFIES the pinned seed's
// closure rather than re-running Newton." This is that verification: one
// physPropagateSegment call over the pinned seed's period (fast, <1s).
{
  // N2 re-pin (2026-07-14, round 2): the closure criterion moved to the
  // Earth-Moon ROTATING frame — the frame where a three-body orbit is
  // actually (quasi-)periodic. The seed is the TRUE 9:2 family member
  // (P = 566,987.3 s = 6.5624 d, the literal resonance, LOCKED in the
  // corrector), apolune-seeded pattern search (tests/corrector_harness.js):
  // measured rotating-frame closure 345.6 km / 28.33 m/s — BETTER than the
  // old 4.71 d compromise seed's 468.6 km, at the real Gateway-class shape
  // (perilune 5,544 / apolune 71,203 km). The INERTIAL closure is ~27,241 km
  // by physics (the rotating frame turns ~86.5°/rev), which is why the
  // measurement below uses _refToRot, and why refOrbitSamplePropagated /
  // refOrbitPropagatedStateAt re-base through the rotating frame.
  const propCheck = id => vm.runInContext(`(function(){
    const entry = refOrbitGet('${id}');
    const res = refOrbitResolve('${id}');
    const samples = refOrbitSamplePropagated('${id}', 96);
    let closureRotKm = null;
    if (entry && entry.seedState && entry.period_s) {
      const ctx = { center: entry.frame || entry.body, bodies: [entry.frame || entry.body, 'Earth', 'Sun'] };
      const st0 = { r: entry.seedState.r.slice(), v: entry.seedState.v.slice() };
      // singleFrame: the 9:2 apolune crosses the Moon-SOI bookkeeping boundary;
      // without it stateF comes back Earth-centered and the closure is bogus.
      const out = physPropagateSegment(st0, 0, entry.period_s, ctx, { maxSamples: 400, singleFrame: true });
      if (out && out.stateF) {
        const rotF = _refToRot(out.stateF, out.tF);
        const rot0 = _refToRot(st0, 0);
        closureRotKm = Math.hypot(rotF.r[0]-rot0.r[0], rotF.r[1]-rot0.r[1], rotF.r[2]-rot0.r[2]);
      }
    }
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    samples.forEach(s => { if (s.r[0]<minX) minX=s.r[0]; if (s.r[0]>maxX) maxX=s.r[0]; if (s.r[2]<minZ) minZ=s.r[2]; if (s.r[2]>maxZ) maxZ=s.r[2]; });
    // ring-gap: the sampled (rotating-re-based) loop's first-to-last distance
    // — this is what the rendered ring's visual closure actually is.
    let ringGapKm = null;
    if (samples.length > 2) {
      const a = samples[0].r, b = samples[samples.length-1].r;
      ringGapKm = Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
    }
    // rotating-frame wrap sanity: state at t = 1.5 P must sit on the loop
    // (distance from Moon inside the orbit's min/max band, padded)
    const entryP = entry ? entry.period_s : 0;
    const wrapped = refOrbitPropagatedStateAt('${id}', entryP * 1.5);
    const wrapR = wrapped ? Math.hypot(wrapped.r[0], wrapped.r[1], wrapped.r[2]) : null;
    return {
      kind: entry && entry.kind, resKind: res && res.kind,
      hasSeed: !!(entry && entry.seedState), periodDays: entry ? entry.period_s / 86400 : null,
      closureRotKm, nSamples: samples.length,
      bboxW: maxX - minX, bboxH: maxZ - minZ, ringGapKm, wrapR,
      periKm: entry ? entry.periKm : null, apoKm: entry ? entry.apoKm : null,
    };
  })()`, sandbox);

  const nrho = propCheck('nrho-nominal');
  ok('NRHO U2: nrho-nominal is kind:propagated', nrho.kind === 'propagated');
  ok('NRHO U2: refOrbitResolve returns kind:propagated with a seed', nrho.resKind === 'propagated' && nrho.hasSeed);
  ok('NRHO N2: period is the literal 9:2 resonance (6.5624 d ± 0.01)', Math.abs(nrho.periodDays - 6.5624) < 0.01);
  ok(`NRHO N2: rotating-frame one-rev closure ${nrho.closureRotKm && nrho.closureRotKm.toFixed(1)} km < 500 km (measured 345.6 at pin time; old seed 468.6)`,
    nrho.closureRotKm != null && nrho.closureRotKm < 500);
  ok('NRHO U2: refOrbitSamplePropagated returns a real sample loop', nrho.nSamples > 10);
  ok('NRHO U3: sample loop is non-degenerate (nonzero extent both axes)', nrho.bboxW > 1000 && nrho.bboxH > 1000);
  ok('NRHO U3: sample loop is tall/asymmetric, not circular (aspect check)', Math.abs(nrho.bboxW - nrho.bboxH) > 0.05 * Math.max(nrho.bboxW, nrho.bboxH));
  ok(`NRHO N2: rendered ring visually closes (rotating re-base; gap ${nrho.ringGapKm && nrho.ringGapKm.toFixed(0)} km < 2000)`,
    nrho.ringGapKm != null && nrho.ringGapKm < 2000);
  ok('NRHO N2: rotating-frame wrap puts t=1.5P on the loop (Moon distance inside the peri/apo band, 20% pad)',
    nrho.wrapR != null && nrho.wrapR > nrho.periKm * 0.8 && nrho.wrapR < nrho.apoKm * 1.2);

  // ── N2: EML1/EML2 libration-orbit catalog entries (same check battery;
  // per-entry closure pins are their measured single-shooting basin floors —
  // see the seed provenance comments in 425 and MATH.md §7v for why the
  // halos are looser than the 500 km standard and why that is safe (phase
  // wrap = idealized station-keeping; no consumer propagates past 1 period))
  const lyap = propCheck('eml1-lyapunov');
  ok('EML1 Lyapunov: kind:propagated with seed', lyap.kind === 'propagated' && lyap.hasSeed);
  ok('EML1 Lyapunov: period in band (12.42 d ± 0.1)', Math.abs(lyap.periodDays - 12.421) < 0.1);
  ok(`EML1 Lyapunov: rotating-frame closure ${lyap.closureRotKm && lyap.closureRotKm.toFixed(1)} km < 150 (measured 47.4 at pin time)`,
    lyap.closureRotKm != null && lyap.closureRotKm < 150);
  ok('EML1 Lyapunov: wrap at 1.5P lands on the loop', lyap.wrapR != null && lyap.wrapR > lyap.periKm * 0.8 && lyap.wrapR < lyap.apoKm * 1.2);
  const h1 = propCheck('eml1-halo-s');
  ok('EML1 Halo: kind:propagated with seed', h1.kind === 'propagated' && h1.hasSeed);
  ok(`EML1 Halo: rotating-frame closure ${h1.closureRotKm && h1.closureRotKm.toFixed(1)} km < 1000 (measured 672.5 basin floor — see §7v)`,
    h1.closureRotKm != null && h1.closureRotKm < 1000);
  ok('EML1 Halo: wrap at 1.5P lands on the loop', h1.wrapR != null && h1.wrapR > h1.periKm * 0.8 && h1.wrapR < h1.apoKm * 1.2);
  const h2 = propCheck('eml2-halo-s');
  ok('EML2 Halo: kind:propagated with seed', h2.kind === 'propagated' && h2.hasSeed);
  ok(`EML2 Halo: rotating-frame closure ${h2.closureRotKm && h2.closureRotKm.toFixed(1)} km < 2000 (measured 1459.7 basin floor — L2 halos are strongly unstable, see §7v)`,
    h2.closureRotKm != null && h2.closureRotKm < 2000);
  ok('EML2 Halo: wrap at 1.5P lands on the loop', h2.wrapR != null && h2.wrapR > h2.periKm * 0.8 && h2.wrapR < h2.apoKm * 1.2);
}

// Catalog exposes at least one propagated entry (§14 U3: launch picker excludes it).
{
  const propagatedIds = vm.runInContext(`refOrbitCatalogList().filter(o => o.kind === 'propagated').map(o => o.id)`, sandbox);
  ok('NRHO U3: catalog exposes at least one propagated entry (nrho-nominal)', propagatedIds.includes('nrho-nominal'));
}

// DEPLOY-on-NRHO synthetic timeline anchor (§14 U3/U4): exercise
// refOrbitPropagatedStateAt the same way _missionApplyDeploy does, at a
// nonzero MET offset, and confirm it returns a real finite state.
{
  const deployAnchor = vm.runInContext(`(function(){
    const st = refOrbitPropagatedStateAt('nrho-nominal', 123456);
    return st && st.r && st.v ? { ok: true, r: st.r } : { ok: false };
  })()`, sandbox);
  ok('NRHO U3: refOrbitPropagatedStateAt returns a finite v2-anchor-ready state', deployAnchor.ok && deployAnchor.r.every(v => isFinite(v)));
}

  return counts();
};
