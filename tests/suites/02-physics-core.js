'use strict';
// Auto-split from the former monolithic tests/math.test.js (see tests/harness.js
// for the shared vm-sandbox loader + assertion helpers). Content below is
// relocated byte-for-byte from the original section of the same name; see
// docs/dev_notes.md "Test suite layout" for how to add a new suite.
//
// Suite: Physics core (P0) + integrator (P1): vec3/Stumpff/elements<->state/UV propagation, SOI/frame patching/leapfrog
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

  return counts();
};
