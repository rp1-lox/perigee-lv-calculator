'use strict';
// Auto-split from the former monolithic tests/math.test.js (see tests/harness.js
// for the shared vm-sandbox loader + assertion helpers). Content below is
// relocated byte-for-byte from the original section of the same name; see
// docs/dev_notes.md "Test suite layout" for how to add a new suite.
//
// Suite: Apse/occlusion markers, maneuver-gizmo pure helpers (R3.3-R3.5), J2 layer (R4), node-map coherence (R5), escape horizon, flight-plan nodes, surface LOD, maneuver-unification predicates, launch-time->RAAN, transfer chains (§22), tick/clip helpers, R7 launch planner, JD<->calendar
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
// R6.5 (2026-07-11) — trajectory-view apse markers + occlusion (574)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { _trajApsePoints, _trajPointOccluded, _trajOcclusionSplitRuns } =
    vm.runInContext('({ _trajApsePoints, _trajPointOccluded, _trajOcclusionSplitRuns })', sandbox);

  // _trajApsePoints: robust min/max-radius pick, not just sample[0]/sample[N/2]
  {
    const el = { a: 400000, e: 0.5, i: 0.2, raan: 0.4, argp: 0.9 };
    const { periPt, apoPt, periR, apoR } = _trajApsePoints(el, 96);
    approx('R6.5 apse: periR = a(1-e)', periR, el.a * (1 - el.e), 1);
    approx('R6.5 apse: apoR = a(1+e)', apoR, el.a * (1 + el.e), 1);
    approx('R6.5 apse: periPt magnitude matches periR', Math.hypot(periPt[0], periPt[1], periPt[2]), periR, 1e-6);
    approx('R6.5 apse: apoPt magnitude matches apoR', Math.hypot(apoPt[0], apoPt[1], apoPt[2]), apoR, 1e-6);
    ok('R6.5 apse: apo is farther than peri', apoR > periR);
  }

  // _trajPointOccluded: depth-sign convention (larger depth = nearer camera,
  // painter sort ascending) — a point BEHIND the near cap (smaller depth than
  // the cap's surface at that radial offset) is occluded; a point IN FRONT of
  // the near cap, or outside the disc's silhouette, is not.
  {
    const bodies = [{ name: 'Test', cx: 0, cy: 0, depth: 1000, R: 100 }];
    const zoom = 1;
    // dead-center behind the body (depth well short of the near cap = depth+R = 1100)
    ok('R6.5 occlusion: center point behind the disc is occluded',
      _trajPointOccluded(0, 0, 500, zoom, bodies));
    // dead-center, but in FRONT of the body (depth > near cap)
    ok('R6.5 occlusion: center point in front of the disc is NOT occluded',
      !_trajPointOccluded(0, 0, 1200, zoom, bodies));
    // outside the silhouette (rho > R) — never occluded regardless of depth
    ok('R6.5 occlusion: point outside the disc silhouette is NOT occluded',
      !_trajPointOccluded(150, 0, 500, zoom, bodies));
    // exactly at the body's own depth, offset so rho < R: still behind the
    // near cap (near cap sits AHEAD of center depth by sqrt(R^2-rho^2) > 0)
    ok('R6.5 occlusion: point at the body\'s own center-depth, inside silhouette, is occluded',
      _trajPointOccluded(50, 0, 1000, zoom, bodies));
  }

  // _trajOcclusionSplitRuns: drops occluded points, breaks contiguous runs
  {
    const bodies = [{ name: 'Test', cx: 0, cy: 0, depth: 0, R: 50 }];
    // a "ring" of 8 points, radius 30 (inside the R=50 silhouette so rho<R for
    // all of them); half sit BEHIND the body (depth<0, occluded) and half in
    // FRONT (depth>0, visible) — a diameter split at x=0.
    const pts = [];
    for (let k = 0; k < 8; k++) {
      const a = 2 * Math.PI * k / 8;
      const x = 30 * Math.cos(a), y = 30 * Math.sin(a);
      const depth = Math.cos(a) >= 0 ? 100 : -100; // front half vs back half
      pts.push({ x, y, depth });
    }
    const runs = _trajOcclusionSplitRuns(pts, 1, bodies);
    ok('R6.5 occlusion split: multiple runs (the ring breaks, not one closed loop)', runs.length >= 1 && runs.length <= 4);
    const totalPts = runs.reduce((s, r) => s + r.length, 0);
    ok('R6.5 occlusion split: fewer points survive than went in (some were dropped)', totalPts < pts.length);
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
  // (Pluto is a real body now — item 2 of the Pluto addition — so this guard
  // uses a genuinely unknown name instead.)
  ok('R5 layout: unknown body falls back to the literal constant',
    _nmSoiLayoutRadius('Xyzzy9000', 42) === 42);
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
// _evIsSolvedManeuver / _evManeuverTarget / _evIsManualBurn. MISSION_MODEL_V2
// Phase 2 S5 (D3): the legacy MANEUVER type and _missionMigrateManeuverEntry
// (the lazy-migration shim, plus detachedFrom-fallback reads) are DELETED —
// the version gate (450) refuses any blob that could carry one, so these
// predicates only need to understand the unified MNODE form. Dated
// 2026-07-14 (was 2026-07-10, pre-flip).
// ═══════════════════════════════════════════════════════════════════════════
{
  const unifiedSolved = { type: 'MNODE', mode: 'solved', target: { fromNode: 'A', toNode: 'B' }, fromNode: 'A', toNode: 'B' };
  const manualMnode = { type: 'MNODE', dvPro_ms: 10 };
  const detachedManual = { type: 'MNODE', mode: 'manual', target: { fromNode: 'A', toNode: 'B' } };
  const halfUnified = { type: 'MNODE', mode: 'solved', target: { fromNode: 'A' } }; // missing toNode -> not solved
  const legacyMv = { type: 'MANEUVER', fromNode: 'A', toNode: 'B', metStart: 100 }; // can no longer occur post-gate; predicates must simply not recognize it

  ok('_evIsSolvedManeuver: unified mode:solved+target is solved', _evIsSolvedManeuver(unifiedSolved) === true);
  ok('_evIsSolvedManeuver: manual MNODE is not solved', _evIsSolvedManeuver(manualMnode) === false);
  ok('_evIsSolvedManeuver: incomplete target is not solved', _evIsSolvedManeuver(halfUnified) === false);
  ok('_evIsSolvedManeuver: null-safe', _evIsSolvedManeuver(null) === false);
  ok('_evIsSolvedManeuver: legacy MANEUVER type is no longer recognized (shim retired, D3)', _evIsSolvedManeuver(legacyMv) === false);

  const t2 = _evManeuverTarget(unifiedSolved);
  ok('_evManeuverTarget: unified MNODE target', t2 && t2.fromNode === 'A' && t2.toNode === 'B');
  ok('_evManeuverTarget: manual MNODE has no target', _evManeuverTarget(manualMnode) === null);
  ok('_evManeuverTarget: legacy MANEUVER type returns null (shim retired, D3)', _evManeuverTarget(legacyMv) === null);

  ok('_evIsManualBurn: manual MNODE is a manual burn', _evIsManualBurn(manualMnode) === true);
  ok('_evIsManualBurn: detached (mode:manual, has target) is a manual burn', _evIsManualBurn(detachedManual) === true);
  ok('_evIsManualBurn: solved MNODE is not a manual burn', _evIsManualBurn(unifiedSolved) === false);

  ok('_missionMigrateManeuverEntry: deleted (D3 — no longer exported)', typeof _missionMigrateManeuverEntry === 'undefined');
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 §22 — TRANSFER CHAINS: _missionChainVecMs (pure) +
// _missionChainSplitInject (leg-record extraction, see docs/MATH.md §7ak).
// Synthetic legs mirror the shapes 565-physics-mission.js actually produces
// (entry leg kind:'nrho' with mccBurn; exit leg kind:'arrival' with
// arrivalBurn) — this is the two-hop corridor pattern both dev seeds author
// (LEO->TLC then TLC->destination). Values chosen to echo the 5a canonical
// case's order of magnitude (mcc ~183 m/s, insertion ~996 m/s class) without
// depending on the expensive physSolveNrhoTransfer solve itself.
// ═══════════════════════════════════════════════════════════════════════════
{
  const { _missionChainVecMs, _missionChainSplitInject, _physTrajByMission } =
    vm.runInContext('({ _missionChainVecMs, _missionChainSplitInject, _physTrajByMission })', sandbox);

  approx('§22 _missionChainVecMs: km/s vector -> m/s magnitude', _missionChainVecMs([0.183, 0, 0]), 183, 1e-9);
  ok('§22 _missionChainVecMs: null-safe', _missionChainVecMs(null) === 0);
  ok('§22 _missionChainVecMs: non-finite-safe', _missionChainVecMs([NaN, 0, 0]) === 0);

  const missionId = 'test-chain-mid';
  const gid = 'gtest1';
  const entryIdx = 0, injectIdx = 1;
  const departMet = 1000, mccT = 1000 + 200000, arriveMet = 1000 + 400000;
  const m = {
    missionId,
    groups: { [gid]: { kind: 'transfer', route: { fromNode: 'leo', toNode: 'nrho' } } },
    log: [
      { type: 'MNODE', mode: 'solved', chainRole: 'depart', groupId: gid,
        fromNode: 'leo', toNode: 'tlc', fromLabel: 'LEO', toLabel: 'TLC',
        activeKey: 'k1', activeName: 'Vehicle', metStart: departMet },
      { type: 'MNODE', mode: 'solved', chainRole: 'inject', groupId: gid,
        fromNode: 'tlc', toNode: 'nrho', fromLabel: 'TLC', toLabel: 'NRHO',
        activeKey: 'k1', activeName: 'Vehicle' },
    ],
  };
  _physTrajByMission[missionId] = {
    legs: [
      { authIdx: entryIdx, kind: 'nrho', met: departMet, tof_s: arriveMet - departMet,
        mccBurn: { t: mccT, dvVec: [0.183, 0, 0] } },   // 183 m/s class MCC
      { authIdx: injectIdx, kind: 'arrival', met: mccT,
        arrivalBurn: { dvVec: [0, 0.996, 0] } },        // 996 m/s class insertion
    ],
  };
  const mccInsertedAt = _missionChainSplitInject(m, gid, entryIdx, injectIdx);
  ok('§22 split: reports the mcc member was inserted', mccInsertedAt === injectIdx);
  ok('§22 split: log grows by exactly one member (the mcc burn)', m.log.length === 3);
  const mccMember = m.log[injectIdx];
  const injectMember = m.log[injectIdx + 1];
  ok('§22 split: mcc member is a plain CUSTOM burn tagged chainRole+groupId (reuses existing BURN machinery — no parallel exec path)',
    mccMember.type === 'BURN' && mccMember.burnType === 'CUSTOM' && mccMember.chainRole === 'mcc' && mccMember.groupId === gid);
  approx('§22 split: mcc dv comes from leg.mccBurn (one-source rule)', mccMember.burnParam, 183, 1);
  approx('§22 split: mcc own MET spacing = mccBurn.t - departMet', mccMember.durationOverride, mccT - departMet, 1e-6);
  ok('§22 split: injection member stays the ORIGINAL solved MNODE (chainRole preserved, no new exec path)',
    injectMember.type === 'MNODE' && injectMember.mode === 'solved' && injectMember.chainRole === 'inject');
  approx('§22 split: injection dv comes from leg.arrivalBurn (one-source rule), replacing the schematic estimate',
    injectMember.dvOverride, 996, 1);
  approx('§22 split: injection own MET spacing = arrival - mccBurn.t (remaining coast after MCC)',
    injectMember.durationOverride, arriveMet - mccT, 1e-6);
  // Component-sum sanity (deliverable 8): depart + mcc + inject reconstructs
  // the leg's own total coast/arrival timing exactly (no dropped/duplicated
  // time), and neither component is silently zeroed.
  approx('§22 split: mcc + inject durations sum to the entry leg\'s own tof_s (no gap/overlap introduced)',
    mccMember.durationOverride + injectMember.durationOverride, arriveMet - departMet, 1e-6);
  ok('§22 split: both components are strictly positive (nothing dropped)', mccMember.burnParam > 0 && injectMember.dvOverride > 0);

  // No-mcc case: exit leg has an arrivalBurn but the entry leg produced no
  // mccBurn (converged on the first pass) — only the injection dv should be
  // stamped; no mcc member inserted; injection's duration untouched (still
  // auto, matching today's behavior for that case).
  const m2 = {
    missionId, groups: { [gid]: { kind: 'transfer', route: { fromNode: 'leo', toNode: 'nrho' } } },
    log: [
      { type: 'MNODE', mode: 'solved', chainRole: 'depart', groupId: gid, fromNode: 'leo', toNode: 'tlc', metStart: 0 },
      { type: 'MNODE', mode: 'solved', chainRole: 'inject', groupId: gid, fromNode: 'tlc', toNode: 'nrho' },
    ],
  };
  _physTrajByMission[missionId] = {
    legs: [
      { authIdx: 0, kind: 'nrho', met: 0, tof_s: 300000, mccBurn: null },
      { authIdx: 1, kind: 'arrival', met: 0, arrivalBurn: { dvVec: [1.0, 0, 0] } },
    ],
  };
  const noMcc = _missionChainSplitInject(m2, gid, 0, 1);
  ok('§22 split: no mccBurn on the entry leg -> no mcc member inserted', noMcc === -1 && m2.log.length === 2);
  approx('§22 split: injection dv still stamped from arrivalBurn even with no mcc', m2.log[1].dvOverride, 1000, 1);
  ok('§22 split: injection duration untouched with no mcc (falls back to auto, same as today)', m2.log[1].durationOverride === undefined);

  delete _physTrajByMission[missionId];
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
// _trajHemiClipRuns (2026-07-11, R6.2 defect1 — planet-surface chord-wedge fix)
// ═══════════════════════════════════════════════════════════════════════════
{
  // Default projection context is top-down (az:0, el:PI/2) at module load, so
  // for these tests camera depth == world z exactly (matches _trajProjectVec
  // at el=PI/2). Use points on the unit circle in the x-z plane for exactness.
  const deg = d => d * Math.PI / 180;
  const onCircle = degAngle => [Math.cos(deg(degAngle)), 0, Math.sin(deg(degAngle))];

  // Case 1: fully front-facing polygon (all z >= 0) -> single CLOSED run,
  // vertices unchanged (no limb involved).
  const frontPoly = [onCircle(20), onCircle(60), onCircle(100), onCircle(140)];
  const c1 = _trajHemiClipRuns(frontPoly);
  ok('_trajHemiClipRuns: fully front polygon is closed with all vertices kept', c1.closed === true && c1.runs.length === 1 && c1.runs[0].length === 4);

  // Case 2: fully back-facing polygon (all z < 0) -> no runs at all.
  const backPoly = [onCircle(200), onCircle(240), onCircle(280), onCircle(320)];
  const c2 = _trajHemiClipRuns(backPoly);
  ok('_trajHemiClipRuns: fully back polygon drops entirely', c2.closed === false && c2.runs.length === 0);

  // Case 3: single hemisphere crossing (2 front vertices, 2 back vertices,
  // contiguous) -> exactly one OPEN run, both its endpoints landing exactly
  // ON the limb (x^2+z^2 == 1, since y=0 here) rather than the original
  // vertices — this is the chord-wedge fix: the run is limb-bounded, not a
  // straight cut through the interior.
  const halfPoly = [onCircle(-45), onCircle(45), onCircle(135), onCircle(225)];
  const c3 = _trajHemiClipRuns(halfPoly);
  ok('_trajHemiClipRuns: single crossing yields exactly one open run', c3.closed === false && c3.runs.length === 1);
  if (c3.runs.length === 1) {
    const run = c3.runs[0];
    ok('_trajHemiClipRuns: single-crossing run keeps the 2 original front vertices + 2 limb points', run.length === 4);
    const first = run[0], last = run[run.length - 1];
    approx('_trajHemiClipRuns: run start lands on the limb (unit radius)', first[0] * first[0] + first[1] * first[1] + first[2] * first[2], 1, 1e-9);
    approx('_trajHemiClipRuns: run end lands on the limb (unit radius)', last[0] * last[0] + last[1] * last[1] + last[2] * last[2], 1, 1e-9);
    approx('_trajHemiClipRuns: run start depth is exactly 0 (on the hemisphere boundary)', last[2], 0, 1e-9);
  }

  // Case 4: polygon alternating front/back TWICE (front, back, front, back)
  // -> two separate open runs, and — the wraparound edge case that a naive
  // single-pass loop gets wrong — the run that spans the array boundary
  // (last vertex front, first vertex back... or vice versa) must NOT be
  // split into a spurious extra fragment.
  const zigzagPoly = [onCircle(30), onCircle(210), onCircle(150), onCircle(330)]; // front,back,front,back
  const c4 = _trajHemiClipRuns(zigzagPoly);
  ok('_trajHemiClipRuns: alternating front/back twice yields exactly two open runs', c4.closed === false && c4.runs.length === 2);

  // Case 5: wraparound-continuity regression — the run that crosses the
  // dirs[n-1]->dirs[0] boundary must be ONE run, not two. Front vertices at
  // index 0 and index n-1 (i.e. the run wraps across the array seam) with a
  // single back vertex elsewhere.
  const wrapPoly = [onCircle(10), onCircle(60), onCircle(200), onCircle(170)]; // front,front,back,front
  const c5 = _trajHemiClipRuns(wrapPoly);
  ok('_trajHemiClipRuns: run spanning the array wraparound stays a single run (not split)', c5.closed === false && c5.runs.length === 1 && c5.runs[0].length === 5);
}

// ═══════════════════════════════════════════════════════════════════════════
// R7 phase 1 — launch-to-destination planner (415), 2026-07-11
// ═══════════════════════════════════════════════════════════════════════════

{
  // §20 OBLIQUITY (2026-07-16): progIdealParkingOrbit's dla_deg/inc_deg/lan_deg
  // are now EARTH-EQUATOR-frame quantities (physEqBasis/progEqToWorldElements,
  // 385), not ecliptic — vInfVec (world/ecliptic, from progDepartVinf) is
  // rotated into Earth's equator frame internally before the DLA/LAN algebra.
  // These golden vectors are re-expressed accordingly; see MATH.md §7al for
  // the re-derivation and re-pin cause.
  // World-frame vector whose EQUATORIAL-frame representation is [x,y,z], built
  // CONVENTION-PROOF through physEqBasis('Earth') so it tracks PROG_BODY_POLES
  // rather than hardcoding a basis. This replaces the pre-fix hardcode
  // (node=0: xEq=[1,0,0], yEq=[0,cosE,sinE], zEq=[0,-sinE,cosE]) which was the
  // MIRRORED basis (MATH.md critique 120 — the pole sign bug). The invariant is
  // unchanged: a vInf lying in Earth's equator plane still has dla~0, etc. — the
  // fixture just constructs its inputs from the corrected basis now.
  const _earthEqB = physEqBasis('Earth');
  const eqToWorldVec = ([x, y, z]) => physAdd(
    physAdd(physScale(_earthEqB.xEq, x), physScale(_earthEqB.yEq, y)),
    physScale(_earthEqB.zEq, z));

  // DLA: a vInf purely in EARTH'S EQUATOR plane (z_eq=0) -> dla ~ 0.
  const flat = progIdealParkingOrbit({ vInfVec: eqToWorldVec([3, 4, 0]), siteLatDeg: 28.5, altKm: 185 });
  approx('progIdealParkingOrbit: in-equator-plane vInf -> dla ~ 0', flat.dla_deg, 0, 1e-9);

  // DLA: a tilted (in equator frame) vInf -> dla = asin(z_eq/|v|) exactly.
  const tiltedEq = [3, 4, 2];
  const tiltedMag = Math.sqrt(3 * 3 + 4 * 4 + 2 * 2);
  const expectedDla = Math.asin(2 / tiltedMag) * 180 / Math.PI;
  const tilted = progIdealParkingOrbit({ vInfVec: eqToWorldVec(tiltedEq), siteLatDeg: 28.5, altKm: 185 });
  approx('progIdealParkingOrbit: tilted vInf -> dla = asin(z_eq/|v|) exactly', tilted.dla_deg, expectedDla, 1e-9);

  // ideal inc = max(|dla|, siteLat): dla 23 deg (equator frame), site 28.5 -> inc 28.5 (penalty 5.5).
  {
    const dlaR = 23 * Math.PI / 180;
    const v = eqToWorldVec([Math.cos(dlaR), 0, Math.sin(dlaR)]); // alpha=0, dla=23deg IN EQUATOR FRAME
    const r = progIdealParkingOrbit({ vInfVec: v, siteLatDeg: 28.5, altKm: 185 });
    approx('progIdealParkingOrbit: dla=23 site=28.5 -> inc=28.5', r.inc_deg, 28.5, 1e-6);
    approx('progIdealParkingOrbit: dla=23 site=28.5 -> planePenalty=5.5', r.planePenalty, 5.5, 1e-6);
  }
  // dla 40 deg (equator frame), site 28.5 deg -> inc 40 (penalty 0).
  {
    const dlaR = 40 * Math.PI / 180;
    const v = eqToWorldVec([Math.cos(dlaR), 0, Math.sin(dlaR)]);
    const r = progIdealParkingOrbit({ vInfVec: v, siteLatDeg: 28.5, altKm: 185 });
    approx('progIdealParkingOrbit: dla=40 site=28.5 -> inc=40', r.inc_deg, 40, 1e-6);
    approx('progIdealParkingOrbit: dla=40 site=28.5 -> planePenalty=0', r.planePenalty, 0, 1e-9);
  }

  // Plane-contains-vInf invariant: for computed {inc, lan} (EQUATOR frame),
  // rotate into WORLD via progEqToWorldElements before building the plane
  // normal n(inc, lan) = [sin(lan)sin(inc), -cos(lan)sin(inc), cos(inc)] --
  // it must be perpendicular to the ORIGINAL world-frame vInf (n . vInf ~ 0).
  // Tested across several vInf directions / site latitudes.
  const testVecs = [
    [3, 4, 2], [1, 0, 0.3], [-2, 5, -1.2], [0.5, -0.8, 0.9], [4, -3, -2.5],
  ];
  const testLats = [0, 28.5, -51.6, 60];
  for (const v of testVecs) {
    for (const lat of testLats) {
      const r = progIdealParkingOrbit({ vInfVec: v, siteLatDeg: lat, altKm: 185 });
      const w = progEqToWorldElements('Earth', r.inc_deg, r.lan_deg);
      const incR = w.inc_deg * Math.PI / 180, lanR = w.lan_deg * Math.PI / 180;
      const n = [Math.sin(lanR) * Math.sin(incR), -Math.cos(lanR) * Math.sin(incR), Math.cos(incR)];
      const vMag = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      const residual = (n[0] * v[0] + n[1] * v[1] + n[2] * v[2]) / vMag;
      approx(`progIdealParkingOrbit: plane contains vInf [${v}] @ lat ${lat} (n.vInf/|v| residual, world-frame)`, residual, 0, 1e-6);
    }
  }

  // Azimuth ties to progLaunchAzimuthDeg directly.
  {
    const r = progIdealParkingOrbit({ vInfVec: [3, 4, 2], siteLatDeg: 28.5, altKm: 185 });
    const expectedAz = progLaunchAzimuthDeg(28.5, r.inc_deg);
    ok('progIdealParkingOrbit: azimuthDeg ties to progLaunchAzimuthDeg(siteLat, inc)',
      Math.abs(r.azimuthDeg.azNE - expectedAz.azNE) < 1e-9 && Math.abs(r.azimuthDeg.azSE - expectedAz.azSE) < 1e-9);
  }

  // Real Mars case: progOptimalDeparture(Earth, Mars, epoch~2026) -- loose
  // sanity band, not a pinned magic number (real min-C3 Earth-Mars transfers
  // run roughly 8-20 km^2/s^2 with TOF roughly 150-350 days).
  {
    const t0 = Date.now();
    const opt = progOptimalDeparture('Earth', 'Mars', PROG_DEFAULT_EPOCH_JD, {});
    const elapsedMs = Date.now() - t0;
    ok('progOptimalDeparture(Earth,Mars): found a converged optimum', !!opt);
    if (opt) {
      const tof = opt.tArrJD - opt.tDepartJD;
      console.log(`[415] Mars optimum: dep JD=${opt.tDepartJD.toFixed(1)} tof=${tof.toFixed(1)}d C3=${opt.c3.toFixed(2)} km^2/s^2 vInf=${opt.dvDepart.toFixed(3)} km/s (scan ${elapsedMs}ms)`);
      ok('progOptimalDeparture(Earth,Mars): C3 in a sane band (~8-20 km^2/s^2, approximate)', opt.c3 > 4 && opt.c3 < 30);
      ok('progOptimalDeparture(Earth,Mars): TOF in a sane band (~150-350 d, approximate)', tof >= 150 && tof <= 350);

      const parking = progIdealParkingOrbit({ vInfVec: opt.vInfVec, siteLatDeg: 28.5, altKm: 185 });
      const w = progEqToWorldElements('Earth', parking.inc_deg, parking.lan_deg);
      const incR = w.inc_deg * Math.PI / 180, lanR = w.lan_deg * Math.PI / 180;
      const n = [Math.sin(lanR) * Math.sin(incR), -Math.cos(lanR) * Math.sin(incR), Math.cos(incR)];
      const vMag = Math.sqrt(opt.vInfVec[0] ** 2 + opt.vInfVec[1] ** 2 + opt.vInfVec[2] ** 2);
      const residual = (n[0] * opt.vInfVec[0] + n[1] * opt.vInfVec[1] + n[2] * opt.vInfVec[2]) / vMag;
      console.log(`[415] Mars ideal parking @ lat 28.5: inc=${parking.inc_deg.toFixed(3)} lan=${parking.lan_deg.toFixed(3)} dla=${parking.dla_deg.toFixed(3)} plane.vInf residual=${residual.toExponential(3)}`);
      approx('progOptimalDeparture(Earth,Mars): resulting ideal parking plane contains vInf', residual, 0, 1e-6);
    }
  }

  // Earth-orbit-target short-circuit: parking inc == target inc, c3/vInf = 0.
  {
    const target = { inc: 51.6, lan: 120, alt: 400 };
    const plan = progPlanLaunchToDestination({ fromBody: 'Earth', destBody: target, epochJD: PROG_DEFAULT_EPOCH_JD, siteLatDeg: 28.5, altKm: 185 });
    ok('progPlanLaunchToDestination: Earth-orbit target short-circuit inc matches target', plan.inc_deg === 51.6);
    ok('progPlanLaunchToDestination: Earth-orbit target short-circuit lan matches target', plan.lan_deg === 120);
    ok('progPlanLaunchToDestination: Earth-orbit target short-circuit c3=0', plan.c3 === 0);
    ok('progPlanLaunchToDestination: Earth-orbit target short-circuit vInfMag=0', plan.vInfMag === 0);
  }

  // Moon: routed through the geocentric cislunar plane math (progMoonPlaneAt),
  // NOT the heliocentric Lambert scan — returns a real numeric parking plane.
  {
    const plan = progPlanLaunchToDestination({ fromBody: 'Earth', destBody: 'Moon', epochJD: PROG_DEFAULT_EPOCH_JD, siteLatDeg: 28.5, altKm: 185 });
    ok('progPlanLaunchToDestination: Moon returns a real numeric inc/lan (not deferred)', typeof plan.inc_deg === 'number' && typeof plan.lan_deg === 'number');
    ok('progPlanLaunchToDestination: Moon inc within plausible lunar-plane range [18,29] deg', plan.inc_deg >= 18 && plan.inc_deg <= 29);
    ok('progPlanLaunchToDestination: Moon dvDepart ~ TLI dv (progDvTLI(185))', Math.abs(plan.dvDepart - progDvTLI(185)) < 1e-6);
  }

  // progMoonPlaneAt: instantaneous Moon orbital-plane inclination TO EARTH'S
  // EQUATOR (§20 — was ecliptic pre-fix). The real figure oscillates
  // ~18.3-28.6 deg (5.145 deg Moon-orbit-to-ecliptic inclination combined
  // with Earth's 23.44 deg obliquity, node-phase dependent) — reachable from
  // a 28.5N site most of the time, which is the whole point of this section.
  {
    const p = progMoonPlaneAt(PROG_DEFAULT_EPOCH_JD, 0);
    ok('progMoonPlaneAt: inc_deg finite and in [0,90]', isFinite(p.inc_deg) && p.inc_deg >= 0 && p.inc_deg <= 90);
    ok('progMoonPlaneAt: lan_deg finite and in [0,360)', isFinite(p.lan_deg) && p.lan_deg >= 0 && p.lan_deg < 360);
  }

  // §20 gate: Moon inc-to-EQUATOR across a saros-scale (~19yr) epoch sweep
  // must land in the real oscillation band [18.3, 28.6] deg -- this IS the
  // reported-bug fix (was reporting the ~5.15deg ecliptic inclination,
  // compared against a 28.5deg equator-referenced site latitude, hence the
  // false UNREACHABLE reading). Sampled monthly-ish over 19 years so the
  // ~18.6yr nodal regression cycle is fully traversed.
  {
    let lo = Infinity, hi = -Infinity, nSamples = 0, nOutOfBand = 0;
    const SAMPLES = 76; // ~19 years / 76 -> ~3-month spacing
    for (let k = 0; k < SAMPLES; k++) {
      const t_s = k * (19 * 365.25 * 86400 / SAMPLES);
      const p = progMoonPlaneAt(PROG_DEFAULT_EPOCH_JD, t_s);
      nSamples++;
      if (p.inc_deg < lo) lo = p.inc_deg;
      if (p.inc_deg > hi) hi = p.inc_deg;
      if (p.inc_deg < 18.0 || p.inc_deg > 28.8) nOutOfBand++;
    }
    console.log(`[S20] Moon inc-to-equator over 19y saros sweep (${nSamples} samples): min=${lo.toFixed(2)} max=${hi.toFixed(2)} deg, out-of-band=${nOutOfBand}`);
    ok('S20: Moon inc-to-equator saros sweep stays within [18.0, 28.8] deg', nOutOfBand === 0);
  }

  // §20 gate: plane-match-from-28.5N reachable at SOME sampled epochs, and
  // the penalty when "unreachable" is a real, small, launch-window-scale
  // dogleg (single-digit degrees) rather than the pre-fix ~23 deg gap
  // (28.5 - ~5.15 ecliptic) that made it read impossible on every date.
  // NOTE (honest, not "majority" — see MATH.md §7al): exact coplanar match
  // with the Moon's instantaneous plane is a genuine once-per-nodal-cycle
  // launch-window constraint in real cislunar mission planning (this is WHY
  // Apollo had monthly launch windows, not daily ones) — a strict "lat <=
  // inc" coplanar test is reachable only during the ~upper fraction of the
  // Moon's [18.3,28.6] equator-inclination oscillation, not a majority of
  // all dates. The bug this section fixes is "reads unreachable on EVERY
  // date, with a ~23 deg penalty" (ecliptic-frame bug) -> "reads reachable
  // on the dates real missions actually launch, with a modest penalty on
  // the rest" (equator-frame fix) — verified below.
  {
    let reachable = 0, total = 0, maxPenalty = 0, sumPenalty = 0;
    const SAMPLES = 76;
    for (let k = 0; k < SAMPLES; k++) {
      const t_s = k * (19 * 365.25 * 86400 / SAMPLES);
      const res = progResolvePlaneTarget('Moon', PROG_DEFAULT_EPOCH_JD, t_s, 28.5);
      total++;
      if (!res.unreachable) reachable++;
      else { maxPenalty = Math.max(maxPenalty, res.penalty_deg); sumPenalty += res.penalty_deg; }
    }
    const avgPenalty = sumPenalty / Math.max(1, total - reachable);
    console.log(`[S20] plane-match-from-28.5N reachable in ${reachable}/${total} sampled epochs; when unreachable, avg penalty=${avgPenalty.toFixed(2)} deg, max=${maxPenalty.toFixed(2)} deg`);
    ok('S20: plane-match-from-28.5N is reachable at SOME sampled epochs (was ~0/76 pre-fix)', reachable > 0);
    ok('S20: when unreachable, the dogleg penalty is small (< 12 deg, not the pre-fix ~23 deg gap)', maxPenalty < 12);
  }

  // §20 gate: progEqToWorldElements/progWorldToEqElements round-trip to
  // identity (pure change of orthonormal basis) across several (inc, lan)
  // pairs, for a real tilted body (Earth) and an untilted one (identity
  // transform check, Jupiter -- absent from PROG_BODY_POLES).
  {
    const pairs = [[0, 0], [28.5, 0], [51.6, 45], [90, 200], [5, 300], [23.44, 0], [63.4, 120]];
    for (const [inc, lan] of pairs) {
      const w = progEqToWorldElements('Earth', inc, lan);
      const back = progWorldToEqElements('Earth', w.inc_deg, w.lan_deg);
      approx(`S20: Earth eq<->world round-trip inc=${inc} lan=${lan} (inc)`, back.inc_deg, inc, 1e-6);
      // lan is degenerate (meaningless) at inc~0/180 -- skip the lan check there.
      if (inc > 1e-6 && inc < 180 - 1e-6) {
        const lanDiff = ((back.lan_deg - lan + 540) % 360) - 180; // wrap to [-180,180)
        approx(`S20: Earth eq<->world round-trip inc=${inc} lan=${lan} (lan)`, lanDiff, 0, 1e-6);
      }
    }
    // untilted body: identity transform.
    const idW = progEqToWorldElements('Jupiter', 28.5, 120);
    approx('S20: untilted-body (Jupiter) eq->world is identity (inc)', idW.inc_deg, 28.5, 1e-9);
    approx('S20: untilted-body (Jupiter) eq->world is identity (lan)', idW.lan_deg, 120, 1e-9);
  }

  // §20 gate (regression pin for the 2026-07-16 "plane-match does nothing"
  // World-view render bug, MATH.md §7al O2b): the orbit ring (5741
  // addOrbitRing) samples/projects in the WORLD (ecliptic) frame, so an
  // AUTHORED (equator-referenced) plane-match must be rotated through
  // progEqToWorldElements BEFORE it becomes ring elements -- exactly as the
  // physics state path (566) does. Two bugs hid the matched plane: (a) the
  // replay snapshot dropped lan_deg (RAAN never reached the ring); (b) the
  // ring stamped raw equatorial inc/lan as if world-frame (no seam). This
  // block pins the pure-math invariant the ring now relies on -- a Moon
  // plane-match's SEAM-TRANSFORMED normal coincides with the Moon's own
  // world-frame plane normal -- and proves the seam is load-bearing (the raw
  // un-seamed elements are ~obliquity off, the visible symptom the user saw).
  {
    const dotAbs = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
    const planeAngle = (n1, n2) => Math.acos(Math.min(1, dotAbs(n1, n2))) * 180 / Math.PI;
    for (const epochJD of [PROG_DEFAULT_EPOCH_JD, 2440419.0639]) {
      const res = progResolvePlaneTarget('Moon', epochJD, 0, 28.5); // picker: unclamped inc
      const wPark = progEqToWorldElements('Earth', res.inc_deg, res.lan_deg);
      const nPark = physNormalFromIncLan(wPark.inc_deg, wPark.lan_deg);
      const mp = progMoonPlaneAt(epochJD, 0);
      const wMoon = progEqToWorldElements('Earth', mp.inc_deg, mp.lan_deg);
      const nMoon = physNormalFromIncLan(wMoon.inc_deg, wMoon.lan_deg);
      approx(`S20: Moon plane-match world ring coincides with Moon world plane (epoch ${epochJD})`,
        planeAngle(nPark, nMoon), 0, 1e-4);
      // Raw (un-seamed) equatorial elements drawn as world would be ~obliquity
      // off -- guards against a future removal of the ring/snapshot seam.
      const nRaw = physNormalFromIncLan(res.inc_deg, res.lan_deg);
      ok(`S20: un-seamed equatorial plane-match is >10 deg off Moon (seam is load-bearing, epoch ${epochJD})`,
        planeAngle(nRaw, nMoon) > 10);
    }
  }

  // §20 gate: ring-tilt table consistency -- _trajRingPlaneBasis(Saturn)'s
  // in-plane basis must be orthonormal and its cross product (the ring
  // plane's normal) must equal physBodyPoleAt('Saturn') exactly (same table,
  // same convention, mechanically unified per the spec).
  {
    const basis = _trajRingPlaneBasis('Saturn');
    ok('S20: _trajRingPlaneBasis(Saturn) returns a basis', !!basis);
    if (basis) {
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const n = cross(basis.e1, basis.e2);
      const pole = physBodyPoleAt('Saturn');
      approx('S20: Saturn ring-plane normal == physBodyPoleAt (x)', n[0], pole[0], 1e-9);
      approx('S20: Saturn ring-plane normal == physBodyPoleAt (y)', n[1], pole[1], 1e-9);
      approx('S20: Saturn ring-plane normal == physBodyPoleAt (z)', n[2], pole[2], 1e-9);
    }
    ok('S20: _trajRingPlaneBasis(Jupiter) [no table entry] returns null', _trajRingPlaneBasis('Jupiter') === null);
  }

  // progResolvePlaneTarget: Moon target matches progMoonPlaneAt directly;
  // unreachable flag fires when site lat exceeds the plane's inclination
  // (surfaced as a warning per feedback item 2, never silently clamped).
  {
    const p = progMoonPlaneAt(PROG_DEFAULT_EPOCH_JD, 0);
    const res = progResolvePlaneTarget('Moon', PROG_DEFAULT_EPOCH_JD, 0, 10);
    ok('progResolvePlaneTarget(Moon): inc matches progMoonPlaneAt', res.inc_deg === p.inc_deg);
    ok('progResolvePlaneTarget(Moon): lan matches progMoonPlaneAt', res.lan_deg === p.lan_deg);
    const hiLat = progResolvePlaneTarget('Moon', PROG_DEFAULT_EPOCH_JD, 0, 89);
    ok('progResolvePlaneTarget(Moon): high site latitude flags unreachable (not clamped)', hiLat.unreachable === true && hiLat.penalty_deg > 0);
    const catTarget = { inc: 51.6, lan: 120, name: 'Station' };
    const resCat = progResolvePlaneTarget(catTarget, PROG_DEFAULT_EPOCH_JD, 0, 28.5);
    ok('progResolvePlaneTarget(catalog object): inc/lan pass through', resCat.inc_deg === 51.6 && resCat.lan_deg === 120 && resCat.unreachable === false);
  }
}

  return counts();
};
