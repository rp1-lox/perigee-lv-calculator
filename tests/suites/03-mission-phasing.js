'use strict';
// Auto-split from the former monolithic tests/math.test.js (see tests/harness.js
// for the shared vm-sandbox loader + assertion helpers). Content below is
// relocated byte-for-byte from the original section of the same name; see
// docs/dev_notes.md "Test suite layout" for how to add a new suite.
//
// Suite: P2 mission physics bridge: analytic phasing + solved node burns (solver-heavy)
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

  return counts();
};
