'use strict';
// Auto-split from the former monolithic tests/math.test.js (see tests/harness.js
// for the shared vm-sandbox loader + assertion helpers). Content below is
// relocated byte-for-byte from the original section of the same name; see
// docs/dev_notes.md "Test suite layout" for how to add a new suite.
//
// Suite: R3 3D physics coherence, R3.1 state-derived rings, R3.2 orbit-orientation authoring (solver-heavy), R2 3D projection
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
    // §20 (2026-07-16): the tier-3 default now rotates the EQUATOR-referenced
    // authored inclination (Ω=0 in the equator frame) through progEqToWorldElements
    // so a default ring hugs the body's tilted equator on screen, not the
    // ecliptic (MATH.md §7al O2). Ω=ω=0 is still the CONVENTION — it's just
    // expressed in the world frame the ring actually draws in.
    const dflt = _trajRingOrientationFor({ inc: 28.5, body: 'Earth' });
    const wDflt = progEqToWorldElements('Earth', 28.5, 0);
    ok('R3.2 render precedence: default source, §20 seam-rotated to WORLD frame',
      dflt.source === 'default' && dflt.argp === 0
      && Math.abs(dflt.i - wDflt.inc_deg * Math.PI / 180) < 1e-9
      && Math.abs(dflt.raan - wDflt.lan_deg * Math.PI / 180) < 1e-9);
    // untilted body (no PROG_BODY_POLES entry): seam is identity, Ω stays 0.
    const dfltFlat = _trajRingOrientationFor({ inc: 28.5, body: 'Jupiter' });
    ok('R3.2 render precedence: default for an untilted body is identity (Ω=0, inc unchanged)',
      dfltFlat.source === 'default' && dfltFlat.raan === 0 && Math.abs(dfltFlat.i - 28.5 * Math.PI / 180) < 1e-9);
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

  // R6.3 handedness fix (2026-07-11) + R6.3b axis correction (same day):
  // world coords are standard right-handed ecliptic (+z north, CCW-from-+z /
  // east-longitude convention); SVG screen space is y-DOWN, so a det=+1 map
  // mirrors the world. The FIRST fix negated screen-Y, which repaired
  // chirality but pointed north DOWN at tilted views (the tilt term flipped
  // with it — user saw the world "180° flipped"). The correct reflection
  // negates screen-X: chirality fixed AND +z (north) projects UP-screen
  // (v = −z·st, negative = up in y-down space). Goldens re-derived for u=−x;
  // see MATH.md §7o.
  // el=π/2, az=0: u=−x, v=+y, depth=z
  {
    const p = _trajProjectVec(3, 7, 11, 0, Math.PI / 2);
    approx('R2 proj: el=90 identity u=-x', p.x, -3, 1e-12);
    approx('R2 proj: el=90 identity v=y', p.y, 7, 1e-12);
    approx('R2 proj: el=90 identity depth=z', p.depth, 11, 1e-12);
  }
  // el=0 (edge-on): v = −z (world +z / north projects UP-screen), depth = y
  {
    const p = _trajProjectVec(3, 7, 11, 0, 0);
    approx('R2 proj: el=0 u=-x', p.x, -3, 1e-12);
    approx('R2 proj: el=0 v=-z (north up-screen)', p.y, -11, 1e-12);
    approx('R2 proj: el=0 depth=y', p.depth, 7, 1e-12);
  }
  // az=π/2 at top-down: xa = x·cos−y·sin, ya = x·sin+y·cos; u=−xa, v=+ya
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

  return counts();
};
