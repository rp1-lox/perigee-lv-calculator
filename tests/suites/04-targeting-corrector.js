'use strict';
// Auto-split from the former monolithic tests/math.test.js (see tests/harness.js
// for the shared vm-sandbox loader + assertion helpers). Content below is
// relocated byte-for-byte from the original section of the same name; see
// docs/dev_notes.md "Test suite layout" for how to add a new suite.
//
// Suite: P3 escape hyperbola geometry + P4 differential-corrector/free-return targeting (heaviest single suite)
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
    // the solved aim actually enters the Moon's SOI when propagated normally.
    // §20/critique-120: the shooter aims via aimBurnEq, which rotates the
    // AUTHORED equatorial (inc, raan) ring into the WORLD frame through
    // orbitWorldElements before building the burn state — so this verification
    // MUST reconstruct that same world ring (fromOrbit is equatorial inc 0, the
    // solved sol.raan is the equatorial RAAN root). Pre-fix this rebuilt a bare
    // equatorial inc=0/raan=0 WORLD ring (no seam), which only coincidentally
    // matched under the mirrored pole; under the corrected pole the authored
    // inc0 ring maps to world {inc 23.44, lan 180} and THAT is what the shooter
    // actually flew. Rebuilding the true world ring, the solved aim enters SOI
    // (closest ~954 km); the bare-ring rebuild does not (closest ~362,583 km).
    if (sol && sol.converged) {
      const wp = orbitWorldElements({ body: 'Earth', inc_deg: 0, lan_deg: (sol.raan || 0) * 180 / Math.PI });
      const bs = physAimBurnState('Earth', r1, sol.theta, sol.pitch, dvHoh, wp.incDeg * Math.PI / 180, 0, wp.lanDeg * Math.PI / 180);
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
  //
  // POLE SIGN FIX (2026-07-18, MATH.md critique 120) — GOOD-NEWS FLIP of the
  // O1b non-convergence, and RESOLUTION of the free-return seed-lattice debt
  // (critique 118). BACKGROUND: the §20 O1b pin below used to assert honest
  // NON-convergence for the default 28.5°-authored ring. Its reasoning was
  // correct given the geometry it saw, but that geometry was itself wrong: the
  // pole node was MIRRORED (node=0), so the authored 28.5° ring rotated to a
  // WORLD ring of {inc 51.940°, lan 0} whose free-return corridor sat outside
  // the hand-tuned apogee×phi seed lattice. The pole fix (node 180) leaves the
  // inclination MAGNITUDE identical (still 51.940°) but flips the world LAN to
  // 180 (progEqToWorldElements('Earth',28.5,0) = {inc 51.940, lan 180}). That
  // 180° node flip is the mirror correction — and it rotates the corridor back
  // INTO the existing seed lattice's reach, so the SAME solver now CONVERGES
  // with NO lattice retune: measured periAlt 353.9 km, dv 3148.4 m/s, met
  // 2460.5 s (well inside the [0,2000] km return-perigee band). The
  // seed-lattice-retune "real solver project" flagged in critique 118 is
  // therefore NOT needed — the debt was an artifact of the mirrored seam, and
  // closing the seam closed the debt. The explicit incDeg=0 path (no tilt,
  // ecliptic ring — untouched by the pole node) still converges, unchanged.
  {
    const fr = physFreeReturnSolve(185, 0, {});
    ok('critique-120 free return: solve returns a shaped record for the default 28.5° (51.94° world) ring',
      !!fr && typeof fr.converged === 'boolean' && fr.periAlt_km != null && fr.dv_ms > 0);
    // FLIPPED from converged:false — the pole node flip (0->180) rotated the
    // free-return corridor back into the seed lattice's reach (critique 120 /
    // 118-resolved). periAlt ~354 km, a physical low-perigee free return.
    ok('critique-120 free return: default 28.5°-authored ring now CONVERGES post-pole-fix (seed-lattice debt resolved, no retune needed)',
      !!fr && fr.converged === true && fr.periAlt_km >= 0 && fr.periAlt_km <= 2000);
    const fr2 = physFreeReturnSolve(185, 0, {});
    ok('critique-120 free return: still deterministic (identical repeat solve)',
      !!fr && !!fr2 && fr.met_s === fr2.met_s && fr.dv_ms === fr2.dv_ms && fr.periAlt_km === fr2.periAlt_km);
    const fr0 = physFreeReturnSolve(185, 0, {}, 0);
    ok(`R3/O1b free return: explicit incDeg=0 (no tilt applied — untilted ring) still converges in the ecliptic (perigee ${fr0 && fr0.periAlt_km != null ? fr0.periAlt_km.toFixed(0) : '?'} km) — proves the seam, not a general regression, moved the default case`,
      !!fr0 && fr0.converged && fr0.periAlt_km >= 0 && fr0.periAlt_km <= 2000);
  }
}

  return counts();
};
