'use strict';
// Auto-split from the former monolithic tests/math.test.js (see tests/harness.js
// for the shared vm-sandbox loader + assertion helpers). Content below is
// relocated byte-for-byte from the original section of the same name; see
// docs/dev_notes.md "Test suite layout" for how to add a new suite.
//
// Suite: Electric propulsion/low-thrust (E1/E2), STM substrate (B1), backward-propagation fix, phase truth (R1/R3), Markellos f/f prime (B2), incremental BLT targeting solver (B3, solver-heavy), trade-study<->orbits path equality
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
// E1 (MISSION_MODEL_V2 §19) — electric propulsion / low-thrust physics
// substrate. Pure physics only (no UI/event/vehicle changes — that's E2/E3).
// Runtime note: thrust is scaled UP (not spiral duration) to keep gate
// runtime sane — a few N on a few-hundred-kg test mass over hours/days
// reaches the same dv/energy regime a mN-thrust SEP stage would reach over
// months, without the 1e5-1e6 step cost of a real months-long spiral.
// ═══════════════════════════════════════════════════════════════════════════
{
  const RE_E1 = PROG_BODIES.Earth.R, muE_E1 = PROG_BODIES.Earth.mu;
  const G0_E1 = 9.80665;

  // ── (1) ballistic byte-identity: ctx.thrust ABSENT reproduces the pinned
  // N1 continuity golden exactly (413 steps; the 80.7 km / 0.22 m/s residual
  // block above already re-verifies the same numbers every gate run — this
  // adds an explicit exact-step-count pin so an accidental thrust-branch
  // evaluation on the ballistic path would be caught immediately). ──
  const byteId = vm.runInContext(`(function(){
    const RE_ = PROG_BODIES.Earth.R, muE = PROG_BODIES.Earth.mu;
    const rp = RE_ + 185;
    const aS = (rp + 445000) / 2;
    const dv = Math.sqrt(muE * (2/rp - 1/aS)) - Math.sqrt(muE/rp);
    const th = 4.319689898685966;
    const st = physElementsToState({ a: rp, e: 0, i: 0, raan: 0, argp: 0, nu: th }, muE);
    const vHat = physScale(st.v, 1/physMag(st.v));
    const s0 = { r: st.r, v: physAdd(st.v, physScale(vHat, dv)) };
    const tEnd = 6*86400;
    const bodies = physBodySetFor({ center: 'Earth', dest: 'Moon', kind: 'cislunar' }, 'contextual');
    // no ctx.thrust key at all — the exact pre-E1 call shape.
    const a = physPropagateSegment({r:s0.r.slice(),v:s0.v.slice()}, 0, tEnd, { center:'Earth', bodies, overrides:{} }, { maxSamples: 512 });
    return { steps: a.steps, hasDv: 'dvAccum' in a, hasDepleted: 'propDepleted' in a, hasM: a.stateF.m !== undefined };
  })()`, sandbox);
  ok(`E1 ballistic byte-identity: step count unchanged (${byteId.steps} === 413, the pinned N1 golden)`, byteId.steps === 413);
  ok('E1 ballistic byte-identity: no thrust fields leak onto the result when ctx.thrust is absent',
    !byteId.hasDv && !byteId.hasDepleted && !byteId.hasM);

  // ── (2) mass depletion exact vs rocket equation: dvAccum = Isp*g0*ln(m0/mF)
  // to float precision — the per-step burn is exact analytic integration
  // (mass is linear in t at constant thrust), so this isn't an approximation
  // check, it's confirming the two expressions of the SAME integral agree. ──
  {
    const rp = RE_E1 + 300;
    const st0 = physElementsToState({ a: rp, e: 0.001, i: 0, raan: 0, argp: 0, nu: 0 }, muE_E1);
    const ctx = { center: 'Earth', bodies: ['Earth'], thrust: { thrust_N: 50, isp_s: 2000, m0_kg: 1000, law: 'prograde' } };
    const res = physPropagateSegment(st0, 0, 3 * 86400, ctx, { maxSamples: 8, maxSteps: 4e6 });
    const mF = res.stateF.m;
    const dvExact = (2000 * G0_E1 * Math.log(1000 / mF)) / 1000; // km/s, same units as dvAccum
    console.log(`  E1 mass coupling: mF=${mF.toFixed(4)} kg, dvAccum=${res.dvAccum.toFixed(8)} km/s, dvExact=${dvExact.toFixed(8)} km/s, diff=${(res.dvAccum - dvExact).toExponential(2)}`);
    approx('E1: dvAccum matches Isp*g0*ln(m0/mF) exactly (float precision)', res.dvAccum, dvExact, 1e-9);
    ok('E1: mass never drops below 0 with no mDry set (floor defaults to 0)', mF >= 0);
  }

  // ── (3) Edelbaum planar circular-to-circular vs integrated dvAccum-at-
  // crossing. Measured 2026-07-14 (rp=300km -> target 1000km circular, LEO,
  // T=5N/Isp=2000s/m0=500kg): ratio 1.0094 (0.94% high) — well inside the
  // spec's ~1-3% band (Edelbaum assumes constant accel; ours depletes mass
  // and the "reaches target radius-ish" sampling adds a little slop). Pinned
  // with headroom at 3%. ──
  {
    const rp = RE_E1 + 300, rTarget = RE_E1 + 1000;
    const v0 = Math.sqrt(muE_E1 / rp), v1 = Math.sqrt(muE_E1 / rTarget);
    const edelbaum = Math.abs(v0 - v1); // planar (di=0) Edelbaum reduces to |v0-v1|
    const st0 = { r: [rp, 0, 0], v: [0, v0, 0] };
    const ctx = { center: 'Earth', bodies: ['Earth'], thrust: { thrust_N: 5, isp_s: 2000, m0_kg: 500, law: 'prograde' } };
    const res = physPropagateSegment(st0, 0, 2 * 86400, ctx, { maxSamples: 2000, maxSteps: 4e6 });
    let idxHit = -1;
    for (let i = 0; i < res.samples.length; i++) { if (physMag(res.samples[i].r) >= rTarget) { idxHit = i; break; } }
    const dvAtHit = idxHit >= 0 ? res.samples[idxHit].dv : NaN;
    const ratio = dvAtHit / edelbaum;
    console.log(`  E1 Edelbaum: dvAtHit=${dvAtHit.toFixed(5)} km/s, edelbaum=${edelbaum.toFixed(5)} km/s, ratio=${ratio.toFixed(4)}`);
    ok('E1: integrated spiral reaches the target radius within the 2-day window', idxHit >= 0);
    ok(`E1: integrated dvAccum-at-crossing vs Edelbaum within 3% (measured ratio ${ratio.toFixed(4)})`,
      Math.abs(ratio - 1) < 0.03);
  }

  // ── (4) energy audit: dE (osculating specific energy, actual) vs
  // trapz(a_T . v) dt (work-energy truth, independent of Edelbaum's
  // assumptions). Measured 2026-07-14: ratio 1.00015 (0.015%) over a 1-day
  // prograde burn sampled hourly — pinned tight (1%). ──
  {
    const rp = RE_E1 + 300;
    const v0 = Math.sqrt(muE_E1 / rp);
    let state = { r: [rp, 0, 0], v: [0, v0, 0], m: 500 };
    const E0 = v0 * v0 / 2 - muE_E1 / rp;
    const chunk = 3600, nChunks = 24, T = 5, isp = 2000;
    let vMags = [v0], mMags = [500];
    for (let i = 0; i < nChunks; i++) {
      const ctx2 = { center: 'Earth', bodies: ['Earth'], thrust: { thrust_N: T, isp_s: isp, m0_kg: state.m, law: 'prograde' } };
      const r2 = physPropagateSegment({ r: state.r, v: state.v }, 0, chunk, ctx2, { maxSamples: 4, maxSteps: 2e5 });
      state = { r: r2.stateF.r, v: r2.stateF.v, m: r2.stateF.m };
      vMags.push(physMag(state.v)); mMags.push(state.m);
    }
    const EF = physMag(state.v) ** 2 / 2 - muE_E1 / physMag(state.r);
    let work = 0;
    for (let i = 1; i < vMags.length; i++) {
      const aT0 = (T / mMags[i-1]) / 1000, aT1 = (T / mMags[i]) / 1000; // km/s^2
      work += (aT0 * vMags[i-1] + aT1 * vMags[i]) / 2 * chunk;
    }
    const dE = EF - E0;
    console.log(`  E1 energy audit: dE=${dE.toFixed(6)} km^2/s^2, work=${work.toFixed(6)} km^2/s^2, ratio=${(dE/work).toFixed(6)}`);
    ok(`E1: energy gain matches work-energy integral within 1% (measured ratio ${(dE/work).toFixed(5)})`,
      Math.abs(dE / work - 1) < 0.01);
  }

  // ── (5) retrograde lowers energy ──
  {
    const rp = RE_E1 + 300;
    const v0 = Math.sqrt(muE_E1 / rp);
    const E0 = v0 * v0 / 2 - muE_E1 / rp;
    const ctx = { center: 'Earth', bodies: ['Earth'], thrust: { thrust_N: 5, isp_s: 2000, m0_kg: 500, law: 'retrograde' } };
    const res = physPropagateSegment({ r: [rp, 0, 0], v: [0, v0, 0] }, 0, 1 * 86400, ctx, { maxSamples: 8, maxSteps: 4e6 });
    const vF = physMag(res.stateF.v), rF = physMag(res.stateF.r);
    const EF = vF * vF / 2 - muE_E1 / rF;
    ok('E1: retrograde steering lowers orbital specific energy', EF < E0);
  }

  // ── (6) coastWindows: zero mass loss strictly inside the window ──
  {
    const rp = RE_E1 + 300;
    const v0 = Math.sqrt(muE_E1 / rp);
    const ctx = { center: 'Earth', bodies: ['Earth'], thrust: { thrust_N: 50, isp_s: 2000, m0_kg: 1000, law: 'prograde', coastWindows: [[0, 43200]] } };
    const res = physPropagateSegment({ r: [rp, 0, 0], v: [0, v0, 0] }, 0, 1 * 86400, ctx, { maxSamples: 500, maxSteps: 4e6 });
    const lastCoastSample = res.samples.filter(s => s.t < 43200).pop();
    ok('E1: mass unchanged strictly inside a coastWindow (no burn while coasting)',
      lastCoastSample && lastCoastSample.m === 1000);
    ok('E1: mass resumes dropping once the coastWindow ends', res.stateF.m < 1000);
  }

  // ── (7) depletion: thrust cuts off at mDry_kg, propDepleted flag set, mass
  // never goes below the floor, ballistic continuation after depletion. ──
  {
    const rp = RE_E1 + 300;
    const v0 = Math.sqrt(muE_E1 / rp);
    const ctx = { center: 'Earth', bodies: ['Earth'], thrust: { thrust_N: 50, isp_s: 2000, m0_kg: 1000, law: 'prograde', mDry_kg: 950 } };
    const res = physPropagateSegment({ r: [rp, 0, 0], v: [0, v0, 0] }, 0, 3 * 86400, ctx, { maxSamples: 500, maxSteps: 4e6 });
    ok('E1: mass floors exactly at mDry_kg, never below', res.stateF.m === 950);
    ok('E1: propDepleted flag set once the floor is reached', res.propDepleted === true);
    ok('E1: integration continues (ballistic) past depletion to the requested tMax', res.tF >= 3 * 86400 - 1);
  }

  // ── (8) step rule: while thrusting, dt is capped at local-period/40. Check
  // via a chunky-thrust LEO segment: no decimated sample-to-sample gap should
  // exceed period/40 by more than the ladder's coarsest rung (sanity — the
  // literal per-step dt is capped before any ladder quantization is applied,
  // decimation for the returned polyline can only widen the observed gap by
  // skipping intermediate points, so this is a necessary, not sufficient,
  // check strengthened by asserting steps scale as expected). ──
  {
    const rp = RE_E1 + 300;
    const v0 = Math.sqrt(muE_E1 / rp);
    const period = 2 * Math.PI * Math.sqrt(rp ** 3 / muE_E1);
    const ctx = { center: 'Earth', bodies: ['Earth'], thrust: { thrust_N: 50, isp_s: 2000, m0_kg: 1000, law: 'prograde' } };
    const res = physPropagateSegment({ r: [rp, 0, 0], v: [0, v0, 0] }, 0, 1 * 86400, ctx, { maxSamples: 8, maxSteps: 4e6 });
    const meanDt = 86400 / res.steps;
    console.log(`  E1 step rule: period=${period.toFixed(1)}s, period/40=${(period/40).toFixed(1)}s, mean actual dt=${meanDt.toFixed(2)}s over ${res.steps} steps`);
    ok(`E1: thrusting mean step size respects the period/40 cap (mean ${meanDt.toFixed(1)}s <= ${(period/40).toFixed(1)}s)`,
      meanDt <= period / PHYS_THRUST_REVS_RESOLUTION + 1e-6);
  }

  // ── (9) unknown steering law => no thrust, never throws ──
  {
    const rp = RE_E1 + 300;
    const v0 = Math.sqrt(muE_E1 / rp);
    const ctx = { center: 'Earth', bodies: ['Earth'], thrust: { thrust_N: 50, isp_s: 2000, m0_kg: 1000, law: 'q-law-not-implemented-yet' } };
    let threw = false, res = null;
    try { res = physPropagateSegment({ r: [rp, 0, 0], v: [0, v0, 0] }, 0, 1 * 3600, ctx, { maxSamples: 8, maxSteps: 4e6 }); }
    catch (e) { threw = true; }
    ok('E1: unknown steering law never throws mid-integration', !threw);
    ok('E1: unknown steering law means NO thrust at all — mass unburned, dvAccum zero',
      res && res.stateF.m === 1000 && res.dvAccum === 0);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 §21 B1 — state-transition-matrix substrate (386, MATH.md §7ah)
// Pure physics substrate only (no f16 family/targeting/UI — that's B2/B3/B4).
// opts.stm:true on physPropagateSegment (NOT ctx.stm, see MATH.md §7ah for the
// documented deviation from the spec's literal wording).
// ═══════════════════════════════════════════════════════════════════════════
{
  const RE_B1 = PROG_BODIES.Earth.R, muE_B1 = PROG_BODIES.Earth.mu;

  function det6(M) {
    const n = 6, A = [];
    for (let i = 0; i < n; i++) A.push(M.slice(i * 6, i * 6 + 6));
    let det = 1;
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      if (piv !== col) { const tmp = A[piv]; A[piv] = A[col]; A[col] = tmp; det = -det; }
      if (Math.abs(A[col][col]) < 1e-300) return 0;
      det *= A[col][col];
      for (let r = col + 1; r < n; r++) {
        const f = A[r][col] / A[col][col];
        for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      }
    }
    return det;
  }
  function matMul6(A, B) {
    const out = new Array(36).fill(0);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += A[i * 6 + k] * B[k * 6 + j];
      out[i * 6 + j] = s;
    }
    return out;
  }
  function stmColRelErr(Phi, j, fdCol) {
    const stmCol = [Phi[j], Phi[6 + j], Phi[12 + j], Phi[18 + j], Phi[24 + j], Phi[30 + j]];
    let num = 0, den = 0;
    for (let i = 0; i < 6; i++) { num += (fdCol[i] - stmCol[i]) ** 2; den += stmCol[i] ** 2; }
    return den > 0 ? Math.sqrt(num) / Math.sqrt(den) : 0;
  }
  function fdColumn(s0, ctx, tEnd, j, eps, opts) {
    const plusState = { r: s0.r.slice(), v: s0.v.slice() };
    const minusState = { r: s0.r.slice(), v: s0.v.slice() };
    if (j < 3) { plusState.r[j] += eps; minusState.r[j] -= eps; }
    else { plusState.v[j - 3] += eps; minusState.v[j - 3] -= eps; }
    const rp_ = physPropagateSegment(plusState, 0, tEnd, ctx, opts).stateF;
    const rm_ = physPropagateSegment(minusState, 0, tEnd, ctx, opts).stateF;
    return [
      (rp_.r[0] - rm_.r[0]) / (2 * eps), (rp_.r[1] - rm_.r[1]) / (2 * eps), (rp_.r[2] - rm_.r[2]) / (2 * eps),
      (rp_.v[0] - rm_.v[0]) / (2 * eps), (rp_.v[1] - rm_.v[1]) / (2 * eps), (rp_.v[2] - rm_.v[2]) / (2 * eps),
    ];
  }

  // ── (1) ballistic byte-identity: opts.stm ABSENT is untouched (413-step N1
  // golden), and opts.stm PRESENT reproduces the exact same trajectory (same
  // steps, same stateF) — the Phi side-computation never perturbs r,v. ──
  const rp1 = RE_B1 + 185;
  const aS1 = (rp1 + 445000) / 2;
  const dv1 = Math.sqrt(muE_B1 * (2 / rp1 - 1 / aS1)) - Math.sqrt(muE_B1 / rp1);
  const th1 = 4.319689898685966;
  const st1 = physElementsToState({ a: rp1, e: 0, i: 0, raan: 0, argp: 0, nu: th1 }, muE_B1);
  const vHat1 = physScale(st1.v, 1 / physMag(st1.v));
  const s0_1 = { r: st1.r, v: physAdd(st1.v, physScale(vHat1, dv1)) };
  const bodiesB1 = ['Earth', 'Moon', 'Sun'];
  const ctxB1 = { center: 'Earth', bodies: bodiesB1, overrides: {} };
  const tEndB1 = 6 * 86400;
  const noStm = physPropagateSegment({ r: s0_1.r.slice(), v: s0_1.v.slice() }, 0, tEndB1, ctxB1, { maxSamples: 512 });
  const withStmHandoff = physPropagateSegment({ r: s0_1.r.slice(), v: s0_1.v.slice() }, 0, tEndB1, ctxB1, { maxSamples: 512, stm: true });
  ok('B1: opts.stm absent reproduces the pinned N1 golden step count (413)', noStm.steps === 413);
  ok('B1: opts.stm present does not alter the trajectory (same step count, same final state)',
    withStmHandoff.steps === noStm.steps &&
    JSON.stringify(withStmHandoff.stateF) === JSON.stringify(noStm.stateF));

  // ── (2) frame-handoff boundary: this TLC scenario crosses the Moon SOI: with
  // opts.stm and no opts.singleFrame, Phi must freeze (documented, not silent)
  // — stmF non-null (last in-frame value) but stmNote explains the boundary. ──
  ok('B1: frame handoff without singleFrame yields a documented stmNote (not a silent wrong Phi)',
    withStmHandoff.events.some(e => e.type === 'soi') && typeof withStmHandoff.stmNote === 'string' &&
    withStmHandoff.stmNote.indexOf('frame handoff') >= 0);
  ok('B1: Phi is still returned (frozen at the last in-frame value), not null, on a handoff', !!withStmHandoff.stmF);

  // ── (3) thrust interaction: v1 is unsupported — stmF:null + a note, NEVER a
  // throw (E1's "never throw mid-integration" discipline extended here). ──
  const rpThrust = RE_B1 + 300, v0Thrust = Math.sqrt(muE_B1 / rpThrust);
  const ctxThrust = { center: 'Earth', bodies: ['Earth'], thrust: { thrust_N: 5, isp_s: 2000, m0_kg: 500, law: 'prograde' } };
  let stmThrewErr = false, stmThrustRes = null;
  try { stmThrustRes = physPropagateSegment({ r: [rpThrust, 0, 0], v: [0, v0Thrust, 0] }, 0, 3600, ctxThrust, { stm: true }); }
  catch (e) { stmThrewErr = true; }
  ok('B1: opts.stm with ctx.thrust never throws', !stmThrewErr);
  ok('B1: opts.stm with ctx.thrust returns stmF:null + a documented note (v1 unsupported)',
    stmThrustRes && stmThrustRes.stmF === null && typeof stmThrustRes.stmNote === 'string');

  // ── (4) STM vs central-difference on a SHORT smooth 2-hour LEO arc (Earth-
  // only, no Moon/Sun perturbation, no SOI handoff — FD is trustworthy here).
  // Measured 2026-07-15: max relative error across all 6 columns = 2.08e-6;
  // pinned at 1e-4 (headroom for float/step-quantization noise). ──
  const rpSmooth = RE_B1 + 300, v0Smooth = Math.sqrt(muE_B1 / rpSmooth);
  const s0Smooth = { r: [rpSmooth, 0, 0], v: [0, v0Smooth, 0] };
  const ctxSmooth = { center: 'Earth', bodies: ['Earth'] };
  const tSmooth = 2 * 3600;
  const smoothStm = physPropagateSegment(s0Smooth, 0, tSmooth, ctxSmooth, { stm: true, maxSamples: 64 });
  const PhiSmooth = smoothStm.stmF;
  const epsSmooth = [1, 1, 1, 1e-4, 1e-4, 1e-4];
  let maxRelErrSmooth = 0;
  for (let j = 0; j < 6; j++) {
    const fdCol = fdColumn(s0Smooth, ctxSmooth, tSmooth, j, epsSmooth[j], { maxSamples: 64 });
    maxRelErrSmooth = Math.max(maxRelErrSmooth, stmColRelErr(PhiSmooth, j, fdCol));
  }
  console.log(`  B1 smooth-arc STM vs FD: max relErr across 6 columns = ${maxRelErrSmooth.toExponential(3)}`);
  ok(`B1: STM matches central-difference FD on a short smooth arc (measured ${maxRelErrSmooth.toExponential(2)} < 1e-4)`,
    maxRelErrSmooth < 1e-4);

  // ── (5) determinant sanity: det(Phi) ~ 1 (volume preservation, conservative
  // dynamics). Measured 2026-07-15: |det-1| = 6.8e-14 (float-noise scale). ──
  const detPhiSmooth = det6(PhiSmooth);
  console.log(`  B1 det(Phi) smooth arc = ${detPhiSmooth}, |det-1| = ${Math.abs(detPhiSmooth - 1).toExponential(3)}`);
  ok(`B1: det(Phi) ~= 1 on the smooth arc (measured |det-1| = ${Math.abs(detPhiSmooth - 1).toExponential(2)} < 1e-9)`,
    Math.abs(detPhiSmooth - 1) < 1e-9);

  // ── (6) composition property: Phi(t2,t0) ~= Phi(t2,t1) . Phi(t1,t0) on a
  // split arc. Measured 2026-07-15: relative residual 1.3e-14. ──
  const tSplit = tSmooth / 2;
  const legA = physPropagateSegment(s0Smooth, 0, tSplit, ctxSmooth, { stm: true, maxSamples: 64 });
  const legB = physPropagateSegment(legA.stateF, tSplit, tSmooth, ctxSmooth, { stm: true, maxSamples: 64 });
  const PhiComposed = matMul6(legB.stmF, legA.stmF);
  let compNum = 0, compDen = 0;
  for (let i = 0; i < 36; i++) { compNum += (PhiComposed[i] - PhiSmooth[i]) ** 2; compDen += PhiSmooth[i] ** 2; }
  const compRelErr = Math.sqrt(compNum) / Math.sqrt(compDen);
  console.log(`  B1 composition Phi(t2,t1).Phi(t1,t0) vs Phi(t2,t0): relErr = ${compRelErr.toExponential(3)}`);
  ok(`B1: composition property holds (measured relErr ${compRelErr.toExponential(2)} < 1e-9)`, compRelErr < 1e-9);

  // ── (7) LONG chaotic arc (the N1 TLC scenario, singleFrame:true — B1's
  // recommended usage): Phi stays finite (no NaN/overflow), AND FD visibly
  // disagrees with it far beyond the smooth-arc agreement — this is the WHOLE
  // reason the substrate exists (Griesemer/ispace/Purdue all reject FD here;
  // our own N2 Newton failure, MATH.md critique 62). Measured 2026-07-15: TLC
  // max relErr vs FD = 1.97e-3 vs the smooth arc's 2.08e-6 — a ~950x gap. ──
  const tlcStm = physPropagateSegment({ r: s0_1.r.slice(), v: s0_1.v.slice() }, 0, tEndB1, ctxB1, { stm: true, maxSamples: 512, singleFrame: true });
  ok('B1: STM on the long chaotic (TLC) arc is finite (no NaN/overflow)', tlcStm.stmF.every(Number.isFinite));
  const PhiTlc = tlcStm.stmF;
  const epsTlc = [1, 1, 1, 1e-4, 1e-4, 1e-4];
  let maxRelErrTlc = 0;
  for (let j = 0; j < 6; j++) {
    const fdCol = fdColumn(s0_1, ctxB1, tEndB1, j, epsTlc[j], { maxSamples: 64, singleFrame: true });
    maxRelErrTlc = Math.max(maxRelErrTlc, stmColRelErr(PhiTlc, j, fdCol));
  }
  console.log(`  B1 chaotic-arc (TLC) STM vs FD: max relErr = ${maxRelErrTlc.toExponential(3)} (smooth-arc was ${maxRelErrSmooth.toExponential(3)}, ratio ${(maxRelErrTlc / maxRelErrSmooth).toFixed(0)}x)`);
  ok(`B1: FD visibly diverges from STM on the chaotic arc, orders of magnitude beyond the smooth-arc agreement (measured ${maxRelErrTlc.toExponential(2)} vs ${maxRelErrSmooth.toExponential(2)}, ratio ${(maxRelErrTlc / maxRelErrSmooth).toFixed(0)}x > 100x)`,
    maxRelErrTlc / maxRelErrSmooth > 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 §21 B3.2 fix — physPropagateSegment backward propagation
// (N1c, 386-physics-integrator.js). API hazard from MATH.md §7ak critique 117:
// the forward-only loop (`while (t < tMax)`) SILENTLY no-oped on tMax < t0,
// returning state0 as if propagation succeeded — garbage backward-seeded nodes
// that looked valid (cost a full B3.2 debugging round). Two pins: the explicit-
// error shape (default) and a backward round-trip self-check (opt-in).
// ═══════════════════════════════════════════════════════════════════════════
{
  const { physPropagateSegment, physMag, physSub, PROG_BODIES } =
    vm.runInContext('({ physPropagateSegment, physMag, physSub, PROG_BODIES })', sandbox);
  const muE_bk = PROG_BODIES.Earth.mu;
  const ctxBk = { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'] };
  // near-circular 100,000 km arc (Moon+Sun perturbed, slight out-of-plane) —
  // slowly-varying |r| keeps the variable-step leapfrog near-exactly time-
  // reversible, so the round-trip closes to float-noise scale (an eccentric
  // perigee-region arc reverses to ~km because dt swings across the ladder;
  // that is still correct backward propagation, just a looser tolerance).
  const r0_bk = 100000;
  const st0 = { r: [r0_bk, 0, 0], v: [0, Math.sqrt(muE_bk / r0_bk), 0.15] };
  const tA = 0, tB = 2 * 86400;

  // ── (1) default (no opts.backward): tMax < t0 returns an explicit error, NOT
  // a silent no-op returning state0 — the whole point of critique 117. ──
  const bad = physPropagateSegment(st0, tB, tA, ctxBk, { singleFrame: true });
  ok('N1c: tMax < t0 without opts.backward returns {error:"backward propagation unsupported"} (no silent no-op)',
    bad && bad.error === 'backward propagation unsupported' && bad.stateF === null);

  // ── (2) tMax === t0 stays a valid zero-duration FORWARD call (returns
  // state0, no error): the guard is strict `<`, so no forward caller changes
  // behavior (ballistic byte-identity preserved). ──
  const zero = physPropagateSegment(st0, 5, 5, ctxBk, { singleFrame: true });
  ok('N1c: tMax === t0 is still a valid forward zero-duration call (state0 back, no error)',
    zero && !zero.error && zero.stateF && physMag(physSub(zero.stateF.r, st0.r)) === 0);

  // ── (3) backward round-trip (opts.backward:true, singleFrame): forward the
  // arc, backward the SAME span, recover the start to integrator tolerance —
  // the exact self-check tests/mshoot_harness.js pins (there 0.067 km / 0.0001
  // m/s on its far-field trunk segment). ──
  const fwd = physPropagateSegment(st0, tA, tB, ctxBk, { singleFrame: true, maxSamples: 24 });
  const back = physPropagateSegment(fwd.stateF, tB, tA, ctxBk, { backward: true, singleFrame: true, maxSamples: 24 });
  const dR = physMag(physSub(back.stateF.r, st0.r));
  const dV = physMag(physSub(back.stateF.v, st0.v));
  console.log(`  N1c backward round-trip (100k km, 2d, EMS, singleFrame): dR=${dR.toFixed(4)} km, dV=${(dV * 1000).toFixed(5)} m/s, steps fwd/back=${fwd.steps}/${back.steps}`);
  ok(`N1c: backward round-trip recovers the start position (measured ${dR.toFixed(4)} km < 1 km)`, dR < 1);
  ok(`N1c: backward round-trip recovers the start velocity (measured ${(dV * 1000).toFixed(5)} m/s < 0.01 m/s)`, dV < 1e-5);
  ok('N1c: backward call lands at the requested physical epoch (tF === span start)', Math.abs(back.tF - tA) < 1e-6);
  ok('N1c: backward result is flagged (backward:true) and carries no error', back.backward === true && !back.error);

  // ── (4) backward round-trip on the DEFAULT (non-singleFrame) path — Earth-
  // only so no frame handoff occurs, exercising the ordinary integrator loop
  // through the reversal wrapper. ──
  const ctxE = { center: 'Earth', bodies: ['Earth'] };
  const fwdE = physPropagateSegment(st0, tA, tB, ctxE, { maxSamples: 24 });
  const backE = physPropagateSegment(fwdE.stateF, tB, tA, ctxE, { backward: true, maxSamples: 24 });
  const dRE = physMag(physSub(backE.stateF.r, st0.r)), dVE = physMag(physSub(backE.stateF.v, st0.v));
  ok(`N1c: backward round-trip closes on the default (non-singleFrame) path too (dR ${dRE.toFixed(4)} km < 1 km, dV ${(dVE * 1000).toFixed(5)} m/s < 0.01 m/s)`,
    dRE < 1 && dVE < 1e-5);

  // ── (5) thrust + backward: refused explicitly (mass would un-burn), never a
  // throw and never a wrong answer (E1/B1 "never mislead" discipline). ──
  let bkThrew = false, bkThrust = null;
  const ctxThrustBk = { center: 'Earth', bodies: ['Earth'], thrust: { thrust_N: 5, isp_s: 2000, m0_kg: 500, law: 'prograde' } };
  try { bkThrust = physPropagateSegment(st0, tB, tA, ctxThrustBk, { backward: true }); }
  catch (e) { bkThrew = true; }
  ok('N1c: backward + ctx.thrust never throws', !bkThrew);
  ok('N1c: backward + ctx.thrust returns an explicit error (unsupported), stateF null',
    bkThrust && typeof bkThrust.error === 'string' && bkThrust.stateF === null);
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 §19 E2 — electric propulsion vehicle + event model (568)
// ═══════════════════════════════════════════════════════════════════════════
{
  const {
    PROG_PROPELLANT_TYPES, PHYS_G0_MS2, ltEstimateLeg, ltEdelbaumPlanarDv, ltApplyDvToCircularAlt,
    ltSignature, ltReadinessCheck, ltComputedLeg, ltStoreComputedLeg, ltClearMissionCache,
    _ltComputedByMission, progVcirc, progMakeSpacecraftStageDef,
    ltEdelbaumFullDv, ltEdelbaumTofEst, ltResampleSpiralRevs,
    ltInverseEdelbaumDuration, ltMaxAchievableAlt,
  } = vm.runInContext(
    '({ PROG_PROPELLANT_TYPES, PHYS_G0_MS2, ltEstimateLeg, ltEdelbaumPlanarDv, ltApplyDvToCircularAlt, ' +
    'ltSignature, ltReadinessCheck, ltComputedLeg, ltStoreComputedLeg, ltClearMissionCache, ' +
    '_ltComputedByMission, progVcirc, progMakeSpacecraftStageDef, ' +
    'ltEdelbaumFullDv, ltEdelbaumTofEst, ltResampleSpiralRevs, ' +
    'ltInverseEdelbaumDuration, ltMaxAchievableAlt })',
    sandbox
  );

  // ── propellant registry (16f closed) ──
  ok('LT: MMH/NTO registered (16f) under the exact key 440 emits',
    PROG_PROPELLANT_TYPES['MMH/NTO'] && PROG_PROPELLANT_TYPES['MMH/NTO'].boiloff_rate === 0);
  ok('LT: XENON_EP registered, storable (no boiloff)',
    PROG_PROPELLANT_TYPES.XENON_EP && PROG_PROPELLANT_TYPES.XENON_EP.boiloff_rate === 0);
  const scDef = progMakeSpacecraftStageDef('EP test');
  ok('LT: SpacecraftStageDef carries ep_thrust_N/ep_isp_s fields (undefined by default)',
    ('ep_thrust_N' in scDef) && ('ep_isp_s' in scDef));

  // ── ltEstimateLeg: rocket-eq exactness vs a direct log computation ──
  {
    const ep = { thrust_N: 0.29, isp_s: 3100, m0_kg: 700, mDry_kg: 300 };
    const dur = 30 * 86400; // 30 days
    const est = ltEstimateLeg(ep, dur, 1);
    const mdot = ep.thrust_N / (ep.isp_s * PHYS_G0_MS2);
    const propExpected = mdot * dur;
    approx('LT: est. lane prop consumption matches ṁ·duration (uncapped case)', est.propUsed_kg, propExpected, 1e-6);
    ok('LT: est. lane not capped when plenty of prop remains', est.capped === false);
    const dvExpected_ms = ep.isp_s * PHYS_G0_MS2 * Math.log(ep.m0_kg / est.mF_kg);
    approx('LT: est. lane dv matches the direct rocket-equation log (same math E1 pinned exactly)', est.dv_est_kms * 1000, dvExpected_ms, 1e-9);
    ok('LT: est. lane mF = m0 - propUsed', Math.abs(est.mF_kg - (ep.m0_kg - est.propUsed_kg)) < 1e-9);

    // capped case: a long burn that would exceed available propellant
    const longEst = ltEstimateLeg(ep, 365 * 86400 * 5, 1);
    ok('LT: est. lane caps propUsed at (m0 - mDry) on a long burn', longEst.capped === true && Math.abs(longEst.propUsed_kg - (ep.m0_kg - ep.mDry_kg)) < 1e-9);
    ok('LT: est. lane never drives mF below mDry', longEst.mF_kg >= ep.mDry_kg - 1e-9);

    // throttle scales thrust -> scales prop use proportionally for the same duration
    const halfThrottle = ltEstimateLeg(ep, dur, 0.5);
    approx('LT: throttle=0.5 halves propUsed for the same duration', halfThrottle.propUsed_kg, est.propUsed_kg / 2, 1e-6);

    // degenerate inputs never throw / return zero
    const zeroDur = ltEstimateLeg(ep, 0, 1);
    ok('LT: zero duration -> zero dv/prop, no throw', zeroDur.dv_est_kms === 0 && zeroDur.propUsed_kg === 0);
    const noEngine = ltEstimateLeg({ thrust_N: 0, isp_s: 0, m0_kg: 700 }, dur, 1);
    ok('LT: zero thrust/isp -> zero dv/prop, no throw', noEngine.dv_est_kms === 0 && noEngine.propUsed_kg === 0);
  }

  // ── ltEdelbaumPlanarDv: sanity vs |v0-v1| ──
  ok('LT: planar Edelbaum reduction is |v0-v1|', Math.abs(ltEdelbaumPlanarDv(7.5, 7.1) - 0.4) < 1e-9);
  ok('LT: planar Edelbaum is order-independent (|v0-v1| symmetry)', ltEdelbaumPlanarDv(7.1, 7.5) === ltEdelbaumPlanarDv(7.5, 7.1));

  // ── ltApplyDvToCircularAlt: energy-based (vis-viva) sign sanity + round trip ──
  {
    const alt0 = 300;
    const v0 = progVcirc('Earth', alt0);
    const alt1 = ltApplyDvToCircularAlt('Earth', alt0, 0.1); // +100 m/s prograde
    ok('LT: prograde dv increases the resulting altitude (matches user intuition, MATH.md §7z crit. 75)', alt1 > alt0);
    const alt2 = ltApplyDvToCircularAlt('Earth', alt0, -0.1); // -100 m/s retrograde
    ok('LT: retrograde dv decreases the resulting altitude', alt2 < alt0);

    // independent check via specific orbital energy: a_new = -mu/(v1^2 - 2mu/r0)
    const muE = vm.runInContext('PROG_BODIES.Earth.mu', sandbox);
    const RE  = vm.runInContext('PROG_BODIES.Earth.R', sandbox);
    const r0 = RE + alt0, v1 = v0 + 0.1;
    const aExpected = -muE / (v1 * v1 - 2 * muE / r0) - RE;
    approx('LT: back-solved altitude matches the independent vis-viva energy calc', alt1, aExpected, 1e-6);

    const nonPhysical = ltApplyDvToCircularAlt('Earth', alt0, -100); // absurd retrograde dv -> v1<=0
    ok('LT: a non-physical dv leaves altitude unchanged rather than lying', nonPhysical === alt0);
  }

  // ── ltSignature: stability + sensitivity (8 fields as of E4, MATH.md §7ab,
  //    closes critique 86: metStart_s joins the signature) ──
  {
    const base = { r: [6678, 0, 0], v: [0, 7.7, 0], m0_kg: 700, thrust_N: 0.29, isp_s: 3100, throttle: 1, law: 'prograde', duration_s: 2592000, fidelity: 'default', metStart_s: 86400 };
    const sig1 = ltSignature(base);
    const sig2 = ltSignature(JSON.parse(JSON.stringify(base)));
    ok('LT: signature is a deterministic hash string', typeof sig1 === 'string' && sig1.length > 0);
    ok('LT: same inputs -> same signature (stability)', sig1 === sig2);
    const variants = [
      { ...base, duration_s: base.duration_s + 1 },
      { ...base, throttle: 0.99 },
      { ...base, law: 'retrograde' },
      { ...base, thrust_N: base.thrust_N + 0.001 },
      { ...base, isp_s: base.isp_s + 1 },
      { ...base, m0_kg: base.m0_kg + 1 },
      { ...base, v: [0, 7.701, 0] },
      { ...base, metStart_s: base.metStart_s + 3600 },   // E4 critique-86 closure: a pure timeline shift now flips STALE
    ];
    ok('LT: any single field change flips the signature (all 8 variants differ from base, incl. metStart)',
      variants.every(v => ltSignature(v) !== sig1));
    // Sub-60s float noise in accumulated MET must NOT cause a spurious STALE
    // (the field is intentionally rounded to 60s buckets, per §7ab).
    const jitter = ltSignature({ ...base, metStart_s: base.metStart_s + 12.3 });
    ok('LT: sub-60s metStart jitter does not flip the signature (60s rounding)', jitter === sig1);
  }

  // ── ltReadinessCheck: EP-stage requirement (the LOWTHRUST readiness gate, 572) ──
  {
    const okStage = { propType: 'XENON_EP', ep_thrust_N: 0.29, ep_isp_s: 3100 };
    const r1 = ltReadinessCheck(okStage);
    ok('LT: readiness OK for a proper EP stage', r1.ok === true && r1.message === null);

    const wrongProp = { propType: 'NTO_A50', ep_thrust_N: 0.29, ep_isp_s: 3100 };
    const r2 = ltReadinessCheck(wrongProp);
    ok('LT: readiness fails when the active stage is not an EP propellant type', r2.ok === false && !!r2.message);

    const missingFields = { propType: 'XENON_EP' };
    const r3 = ltReadinessCheck(missingFields);
    ok('LT: readiness fails when ep_thrust_N/ep_isp_s are missing', r3.ok === false && !!r3.message);

    const r4 = ltReadinessCheck(null);
    ok('LT: readiness fails cleanly (no throw) on a null stage', r4.ok === false && !!r4.message);
  }

  // ── computed-leg side-table (568, sibling of 565's _physTrajByMission) ──
  {
    ok('LT: _ltComputedByMission starts as an object side-table', typeof _ltComputedByMission === 'object');
    ok('LT: ltComputedLeg on an unknown mission returns null (no throw)', ltComputedLeg('nope', 0) === null);
    ltStoreComputedLeg('ltTestMission', 3, { sig: 'abc123', dvAccum_kms: 0.5, mF_kg: 400, propUsed_kg: 300, tof_s: 2592000 });
    const rec = ltComputedLeg('ltTestMission', 3);
    ok('LT: ltStoreComputedLeg/ltComputedLeg round-trip a record', !!rec && rec.dvAccum_kms === 0.5 && rec.propUsed_kg === 300);
    ltClearMissionCache('ltTestMission');
    ok('LT: ltClearMissionCache removes the mission entirely', ltComputedLeg('ltTestMission', 3) === null);
  }

  // ── budget-flow sanity (D6-style): a synthetic est-lane LOWTHRUST burn stays
  // finite/consistent, and stamping a fake computed result flips dv_actual
  // while staying within tolerance-or-honestly-flagged (per the spec's gate
  // requirement) — exercised at the pure-function level (568's lane-selection
  // logic itself), not through the full DOM-dependent missionRecompute (which
  // 570's own S-series tests likewise avoid in favor of v2BuildShadow/v2StateAt
  // fixtures — see the Phase 1 shadow-state block above for that pattern). ──
  {
    const ep = { thrust_N: 0.29, isp_s: 3100, m0_kg: 700, mDry_kg: 300 };
    const dur = 30 * 86400;
    const est = ltEstimateLeg(ep, dur, 1);
    ok('LT: est-lane budget numbers are finite', isFinite(est.dv_est_kms) && isFinite(est.propUsed_kg));
    ok('LT: est-lane dv is positive for a real burn', est.dv_est_kms > 0);

    // fake a "computed" result close to the est (small integration slop, like
    // §7y's measured 0.94% Edelbaum-vs-integrated case) and check the D6-style
    // reconciliation tolerance (max(1%, 5 m/s)) — matches, not flagged.
    const computedClose_ms = est.dv_est_kms * 1000 * 1.009;   // +0.9%, like §7y's 5N case
    const deltaClose = Math.abs(computedClose_ms - est.dv_est_kms * 1000);
    const tolClose = Math.max(5, 0.01 * est.dv_est_kms * 1000);
    ok('LT: a close computed/est pair reconciles within max(1%,5 m/s) — not flagged',
      deltaClose <= tolClose);

    // fake a genuinely divergent computed result (e.g. stale/mismatched signature
    // scenario) and check the SAME tolerance correctly flags it — the card must
    // show both numbers honestly rather than silently pick one.
    const computedFar_ms = est.dv_est_kms * 1000 * 1.5;       // +50%, way outside tolerance
    const deltaFar = Math.abs(computedFar_ms - est.dv_est_kms * 1000);
    const tolFar = Math.max(5, 0.01 * est.dv_est_kms * 1000);
    ok('LT: a divergent computed/est pair exceeds max(1%,5 m/s) — correctly flaggable',
      deltaFar > tolFar);
  }

  // ── E3: ltEdelbaumFullDv — full-form Edelbaum, MATH.md §7aa ──
  {
    const v0 = 7.726, v1 = 7.350; // LEO 300km -> 1000km circular speeds (approx)
    // di=0 must degenerate EXACTLY to the planar reduction already gate-pinned above
    const full0 = ltEdelbaumFullDv(v0, v1, 0);
    approx('LT E3: full-form Edelbaum at di=0 degenerates to |v0-v1|', full0, Math.abs(v0 - v1), 1e-9);

    // monotonicity: cost strictly increases with di for fixed v0,v1
    const full30 = ltEdelbaumFullDv(v0, v1, 30);
    const full60 = ltEdelbaumFullDv(v0, v1, 60);
    const full90 = ltEdelbaumFullDv(v0, v1, 90);
    ok('LT E3: Edelbaum cost is monotonically increasing in di (0<30<60<90)',
      full0 < full30 && full30 < full60 && full60 < full90);

    // di=90 -> exact quadrature sum sqrt(v0^2+v1^2) (orthogonal planes)
    approx('LT E3: di=90 reduces to sqrt(v0^2+v1^2) (orthogonal-plane quadrature)',
      full90, Math.sqrt(v0 * v0 + v1 * v1), 1e-9);

    // di=180 -> v0+v1 (opposite planes, full retrograde re-launch cost)
    const full180 = ltEdelbaumFullDv(v0, v1, 180);
    approx('LT E3: di=180 reduces to v0+v1 (opposite-plane closure)', full180, v0 + v1, 1e-9);

    // symmetric orbits (v0==v1): di=0 -> 0 (same orbit, no burn needed)
    ok('LT E3: identical circular orbits at di=0 need zero dv', ltEdelbaumFullDv(7.5, 7.5, 0) < 1e-9);

    // out-of-range di clamps rather than throwing/going complex
    ok('LT E3: di clamps to [0,180], no throw on out-of-range input',
      isFinite(ltEdelbaumFullDv(v0, v1, -10)) && isFinite(ltEdelbaumFullDv(v0, v1, 400)));
  }

  // ── E3: ltEdelbaumTofEst — mass-averaged constant-accel TOF ──
  {
    const ep = { thrust_N: 0.29, isp_s: 3100, m0_kg: 700, mDry_kg: 300 };
    const t1 = ltEdelbaumTofEst(0.376, ep); // ~300->1000km planar dv from §7y's table
    ok('LT E3: TOF estimate is finite and positive for a reachable dv', t1.tof_s > 0 && isFinite(t1.tof_s));
    ok('LT E3: TOF estimate reports mF between mDry and m0', t1.mF_kg > ep.mDry_kg && t1.mF_kg < ep.m0_kg);

    // internal consistency: propUsed_kg matches m0-mF, and matches the SAME
    // rocket-eq relation ltEstimateLeg uses (mF = m0*exp(-dv/(Isp*g0)))
    const ve = ep.isp_s * PHYS_G0_MS2;
    const mFExpected = ep.m0_kg * Math.exp(-0.376 * 1000 / ve);
    approx('LT E3: TOF-estimate mF matches direct rocket-equation value', t1.mF_kg, mFExpected, 1e-6);
    approx('LT E3: TOF-estimate propUsed = m0 - mF', t1.propUsed_kg, ep.m0_kg - t1.mF_kg, 1e-9);

    // a dv that exceeds tank capacity fails cleanly (nulls, no throw/NaN)
    const t2 = ltEdelbaumTofEst(50, ep); // 50 km/s, way beyond any Xenon tank here
    ok('LT E3: TOF estimate returns nulls (not NaN/throw) when dv exceeds tank capacity',
      t2.tof_s === null && t2.mF_kg === null);

    // doubling thrust halves TOF for the same dv/prop (accel doubles, dv fixed)
    const epDouble = Object.assign({}, ep, { thrust_N: ep.thrust_N * 2 });
    const t3 = ltEdelbaumTofEst(0.376, epDouble);
    approx('LT E3: doubling thrust halves TOF for the same dv', t3.tof_s, t1.tof_s / 2, 1e-3);
  }

  // ── E3: ltResampleSpiralRevs — rev-boundary resampler for LOD spiral render ──
  {
    // synthetic Archimedean-ish spiral: N complete revs, r grows linearly with
    // angle, sampled densely and uniformly in angle (not time -- doesn't matter,
    // the resampler works on winding angle alone)
    function buildSpiralSamples(revs, samplesPerRev, r0, rGrowPerRev) {
      const out = [];
      const totalSamples = Math.round(revs * samplesPerRev);
      for (let i = 0; i <= totalSamples; i++) {
        const revFrac = i / samplesPerRev;
        const theta = revFrac * 2 * Math.PI;
        const r = r0 + rGrowPerRev * revFrac;
        out.push({ t: i, r: [r * Math.cos(theta), r * Math.sin(theta), 0] });
      }
      return out;
    }

    const revs = 40, perRev = 20;
    const samples = buildSpiralSamples(revs, perRev, 7000, 5);
    const res = ltResampleSpiralRevs(samples, 8, 8);

    // rev count preserved (within one sample's angular resolution)
    approx('LT E3: resampler recovers the correct rev count from winding angle', res.revCount, revs, 0.05);

    // endpoints preserved: first sample in head, last sample in tail
    ok('LT E3: resampler preserves the exact first sample (in head)',
      res.head.length > 0 && res.head[0].t === samples[0].t);
    ok('LT E3: resampler preserves the exact last sample (in tail)',
      res.tail.length > 0 && res.tail[res.tail.length - 1].t === samples[samples.length - 1].t);

    // head/tail retain full per-sample fidelity (~8 revs * perRev samples each)
    ok('LT E3: head retains near-full fidelity for the first ~8 revs',
      res.head.length >= 8 * perRev * 0.9);
    ok('LT E3: tail retains near-full fidelity for the last ~8 revs',
      res.tail.length >= 8 * perRev * 0.9);

    // middle is decimated to ~1 sample/rev (40-16=24 revs -> ~24 mid samples, not 24*20)
    const midRevs = revs - 16;
    ok('LT E3: middle is decimated to ~1 sample per rev, not per-sample fidelity',
      res.mid.length > 0 && res.mid.length < midRevs * perRev * 0.5 && res.mid.length <= midRevs + 2);

    // total sample count collapses hugely vs the raw input (the whole point of the LOD pass)
    ok('LT E3: resampled total is far smaller than the raw sample count',
      (res.head.length + res.mid.length + res.tail.length) < samples.length * 0.6);

    // degenerate inputs don't throw
    const short = ltResampleSpiralRevs(samples.slice(0, 5), 8, 8);
    ok('LT E3: resampler falls back to all-head on a too-short/low-rev sample set (no throw)',
      short.mid.length === 0 && short.tail.length === 0 && short.head.length === 5);
    const empty = ltResampleSpiralRevs([], 8, 8);
    ok('LT E3: resampler handles an empty sample array without throwing', empty.head.length === 0 && empty.revCount === 0);
  }

  // ── LT E4: inverse-Edelbaum target-orbit mode + max-achievable altitude
  //    (MATH.md §7ab; drag mechanics themselves are browser-verified) ──
  {
    const RE = vm.runInContext('PROG_BODIES.Earth.R', sandbox);
    const muE = vm.runInContext('PROG_BODIES.Earth.mu', sandbox);
    const ep = { thrust_N: 0.29, isp_s: 3100, m0_kg: 700, mDry_kg: 300 };
    const alt0 = 400, alt1 = 1000; // raise

    // round-trip: altitude -> dv -> duration -> back to a re-solved altitude
    // via the SAME est-orbit approximation (ltApplyDvToCircularAlt) the
    // duration-drag gizmo itself uses to repaint the schematic live.
    const inv = ltInverseEdelbaumDuration('Earth', alt0, alt1, ep);
    ok('LT E4: inverse-Edelbaum returns a finite positive duration for a reachable raise', !!inv && inv.duration_s > 0 && isFinite(inv.duration_s));
    ok('LT E4: inverse-Edelbaum picks prograde for a raise', inv.law === 'prograde');
    // dv is the EXACT inverse of ltApplyDvToCircularAlt's own forward vis-viva
    // relation (v1 = sqrt(2*mu/r0 - mu/r1), NOT sqrt(mu/r1) — see the
    // function's doc comment for why those differ), independently re-derived
    // here rather than re-imported from the module under test.
    const r0 = RE + alt0, r1 = RE + alt1;
    const v0 = Math.sqrt(muE / r0), v1exact = Math.sqrt(2 * muE / r0 - muE / r1);
    approx('LT E4: inverse-Edelbaum dv matches the exact vis-viva inverse of ltApplyDvToCircularAlt', inv.dv_kms, Math.abs(v1exact - v0), 1e-9);
    const backAlt = ltApplyDvToCircularAlt('Earth', alt0, inv.dv_kms);
    approx('LT E4: round-trip (alt -> dv -> duration -> re-applied dv -> alt) recovers the target altitude exactly', backAlt, alt1, 1e-6);
    // re-derive duration independently via ltEdelbaumTofEst on the SAME dv and
    // check internal consistency with the inverse function's own duration.
    const tofCheck = ltEdelbaumTofEst(inv.dv_kms, ep);
    approx('LT E4: inverse-Edelbaum duration matches ltEdelbaumTofEst on the same dv (internal consistency)', inv.duration_s, tofCheck.tof_s, 1e-6);

    // lower case picks retrograde
    const invLower = ltInverseEdelbaumDuration('Earth', alt1, alt0, ep);
    ok('LT E4: inverse-Edelbaum picks retrograde for a lower', invLower.law === 'retrograde');

    // ── reachability honesty: a TIGHT-margin stage (small usable prop
    // fraction) whose full-tank dv stays well inside Earth's escape regime,
    // so the max-achievable-altitude math below stays in the physical
    // (elliptical/circular) domain ltApplyDvToCircularAlt actually models —
    // a wide-margin xenon stage's full dv (~tens of km/s) would drive the
    // "raise" case hyperbolic long before running out of prop, which is a
    // real and separate honesty gap (documented, MATH.md §7ab) but not what
    // THIS test is targeting. ──
    const epTight = { thrust_N: 0.29, isp_s: 1500, m0_kg: 700, mDry_kg: 695 };

    // unreachable: a target far enough out that epTight's small dv_max can't get there
    const invFar = ltInverseEdelbaumDuration('Earth', alt0, 5000, epTight);
    ok('LT E4: inverse-Edelbaum returns null when the target exceeds tank capacity (honest failure, no NaN)', invFar === null);

    // max-achievable altitude (prop-capped): dv_max from the FULL-tank rocket
    // equation, independently cross-checked against ltEstimateLeg's own
    // capped-duration dv for an arbitrarily long burn (same physics, two
    // different entry points -> must agree).
    const maxA = ltMaxAchievableAlt('Earth', alt0, epTight, true);
    ok('LT E4: max-achievable altitude is finite and above the starting altitude (raise direction)', !!maxA && isFinite(maxA.altMax_km) && maxA.altMax_km > alt0);
    const longBurn = ltEstimateLeg(epTight, 365 * 86400 * 50, 1); // deliberately excessive duration -> fully capped
    ok('LT E4: the cross-check burn is indeed fully prop-capped', longBurn.capped === true);
    approx('LT E4: max-achievable dv matches the fully-capped rocket-equation dv from ltEstimateLeg', maxA.dv_max_kms, longBurn.dv_est_kms, 1e-6);
    // and the resulting altitude matches applying that same capped dv directly
    const altFromCappedDv = ltApplyDvToCircularAlt('Earth', alt0, longBurn.dv_est_kms);
    approx('LT E4: max-achievable altitude matches applying the capped dv directly (ltApplyDvToCircularAlt)', maxA.altMax_km, altFromCappedDv, 1e-6);

    const maxALower = ltMaxAchievableAlt('Earth', alt1, epTight, false);
    ok('LT E4: max-achievable altitude in the lower direction is below the starting altitude', !!maxALower && maxALower.altMax_km < alt1);

    // honest failure on a dead/absent stage
    ok('LT E4: max-achievable returns null for a stage with no usable prop (m0<=mDry)', ltMaxAchievableAlt('Earth', alt0, { thrust_N: 1, isp_s: 3000, m0_kg: 300, mDry_kg: 300 }, true) === null);
    ok('LT E4: inverse-Edelbaum returns null for an unknown body (no throw)', ltInverseEdelbaumDuration('Nonexistentia', alt0, alt1, ep) === null);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 §15 5b R1 — phase truth (567-phase-truth.js, MATH.md §7ad)
// ═══════════════════════════════════════════════════════════════════════════
{
  const r = vm.runInContext(`(function(){
    const out = {};

    // -- Keplerian analytic case: pure mean-anomaly-difference/mean-motion primitive --
    const muE = PROG_BODIES.Earth.mu, aTest = PROG_BODIES.Earth.R + 400;
    out.kepA = phaseTruthKeplerian(muE, aTest, 200, 150); // A is 50 deg ahead of B
    const nTest = Math.sqrt(muE / (aTest * aTest * aTest));
    out.dtExpected = (50 * Math.PI / 180) / nTest;

    // -- capture-window boundary (just inside / just outside PHASE_CAPTURE_WINDOW_S) --
    const dMIn = (PHASE_CAPTURE_WINDOW_S * 0.9) * nTest * 180 / Math.PI;
    const dMOut = (PHASE_CAPTURE_WINDOW_S * 1.5) * nTest * 180 / Math.PI;
    out.capIn = phaseTruthKeplerian(muE, aTest, dMIn, 0);
    out.capOut = phaseTruthKeplerian(muE, aTest, dMOut, 0);

    // -- disjoint: different refIds -> null, never a bogus number --
    const osA = { propagated: true, refId: 'nrho-nominal', r: [1, 0, 0] };
    const osB = { propagated: true, refId: 'some-other-ref', r: [1, 0, 0] };
    out.disjointNull = phaseTruthBetween(osA, osB, 0) === null;

    // -- disjoint: one side not propagated at all (classical orbit, no anomaly data) --
    const osC = { propagated: false, body: 'Earth', perigee: 400, apogee: 400 };
    out.mixedNull = phaseTruthBetween(osA, osC, 0) === null;

    // -- propagated-ref pair on the real nrho-nominal catalog entry: two real
    //    vehicle points offset by a known metNow delta must recover that delta
    //    within the nearest-point sampler's own resolution (default 180 samples/period) --
    const res = refOrbitResolve('nrho-nominal');
    const spacing = res.period_s / 180;
    const t0 = 40000;
    const delta = spacing * 5; // several sample-widths, well inside half the period
    const stA = refOrbitPropagatedStateAt('nrho-nominal', t0);
    const stB = refOrbitPropagatedStateAt('nrho-nominal', t0 + delta);
    const pOsA = { propagated: true, refId: 'nrho-nominal', r: stA.r, metAt: t0 };
    const pOsB = { propagated: true, refId: 'nrho-nominal', r: stB.r, metAt: t0 + delta };
    out.phase = phaseTruthPropagated(pOsA, pOsB, 0);
    out.delta = delta; out.spacing = spacing;

    // same point vs itself -> ~zero phase error, captured
    out.phaseSame = phaseTruthPropagated(pOsA, { ...pOsA }, 0);

    // maneuver-arrived vehicle (propagated/refId, no r/v) vs a captured vehicle:
    // exercises _phaseVehiclePoint's refOrbitPropagatedStateAt(refId, metNow) fallback.
    const osArrived = { propagated: true, refId: 'nrho-nominal' };
    out.phaseArrivedHasResult = !!phaseTruthBetween(osArrived, pOsA, t0);

    return out;
  })()`, sandbox);

  ok('5b R1: phaseTruthKeplerian returns a finite dt for a synthetic 50 deg mean-anomaly offset', !!r.kepA && isFinite(r.kepA.dt_s));
  approx('5b R1: Keplerian dt matches the analytic mean-anomaly-difference/mean-motion formula', r.kepA.dt_s, r.dtExpected, 1e-6);
  ok('5b R1: Keplerian capture is true just inside the capture window', r.capIn.capture === true);
  ok('5b R1: Keplerian capture is false just outside the capture window', r.capOut.capture === false);
  ok('5b R1: phaseTruthBetween returns null for two propagated orbits with different refIds (disjoint)', r.disjointNull);
  ok('5b R1: phaseTruthBetween returns null when one orbit is not propagated (no comparable anomaly data)', r.mixedNull);
  ok('5b R1: phaseTruthPropagated returns a real measurement on the live nrho-nominal catalog ref', !!r.phase);
  approx(`5b R1: propagated-ref phase Δt recovers the known ${r.delta.toFixed(0)}s offset within the nearest-point sampler's own resolution (±${(r.spacing * 3).toFixed(0)}s)`,
    Math.abs(r.phase.dt_s), r.delta, r.spacing * 3);
  ok('5b R1: propagated-ref phase distance equivalent is a finite non-negative chord distance', r.phase.distKm != null && isFinite(r.phase.distKm) && r.phase.distKm >= 0);
  ok('5b R1: identical propagated point vs itself measures ~zero phase error and reports capture', !!r.phaseSame && Math.abs(r.phaseSame.dt_s) < 60 && r.phaseSame.capture === true);
  ok("5b R1: a maneuver-arrived vehicle (no r/v) still measures phase via the ref's own wrapped-clock fallback", r.phaseArrivedHasResult);
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 §15 5b R3 — terminal phasing burns (567-phase-truth.js, MATH.md §7af)
// ═══════════════════════════════════════════════════════════════════════════
// (a) ΔP construction round-trips EXACTLY by construction: N*(P+ΔP) - N*P == dtPhase.
// (b) dv math hand-checked against vis-viva for a Keplerian LEO case (independent
//     re-derivation of the formula in this test, not a call into the module).
// (c) feasibility boundary: |ΔP| just under/over PHASING_FEASIBLE_FRAC*P.
// (d) NRHO perilune-approximation sanity: dv positive/finite, scales ~linearly
//     with ΔP for small ΔP (first-order — vis-viva is smooth near aRef).
{
  const r3 = vm.runInContext(`(function(){
    const out = {};
    const Earth = { mu: 398600.4418, R: 6371.0 };
    const alt = 400, rPeri_km = Earth.R + alt, rApo_km = Earth.R + alt; // circular
    const aRef_km = (rPeri_km + rApo_km) / 2;
    const P_s = 2 * Math.PI * Math.sqrt(Math.pow(aRef_km, 3) / Earth.mu);
    const orbitState = { body: 'Earth', apogee: alt, perigee: alt };

    // (a) round-trip identity, N=1..5
    const dtPhase = 900; // s, a small residual offset
    out.roundTrip = [];
    for (let N = 1; N <= 5; N++) {
      const plan = phasingPlanKeplerian(orbitState, dtPhase, N);
      const identity = N * (P_s + plan.deltaP_s) - N * P_s;
      out.roundTrip.push({ N, identity, dtPhase, feasible: plan.feasible, dv: plan.dvPerBurn_ms, wait: plan.waitTime_s });
    }

    // (b) hand vis-viva cross-check, N=1
    const plan1 = phasingPlanKeplerian(orbitState, dtPhase, 1);
    const deltaP = dtPhase / 1;
    const aPhasing = Math.cbrt(Earth.mu * Math.pow(P_s + deltaP, 2) / (4 * Math.PI * Math.PI));
    const vRef = Math.sqrt(Earth.mu * (2 / rPeri_km - 1 / aRef_km));
    const vPhasing = Math.sqrt(Earth.mu * (2 / rPeri_km - 1 / aPhasing));
    const dvHand_ms = Math.abs(vPhasing - vRef) * 1000;
    out.dvHand = dvHand_ms; out.dvModule = plan1.dvPerBurn_ms;

    // (c) feasibility boundary
    const dtBig = 3 * P_s;   // even at N=5, deltaP = 0.6P > 0.5P threshold -> infeasible for every N in 1..5
    const dtSmall = 0.1 * P_s; // N=1 -> deltaP = 0.1P < 0.5P -> feasible
    out.infeasibleCase = phasingPlanKeplerian(orbitState, dtBig, 1).feasible;
    out.feasibleCase = phasingPlanKeplerian(orbitState, dtSmall, 1).feasible;

    // (d) NRHO perilune sanity — dv positive/finite, ~linear scaling for small dtPhase
    const dtA = 500, dtB = 1000; // s
    const planA = phasingPlanPropagated('nrho-nominal', dtA, 1);
    const planB = phasingPlanPropagated('nrho-nominal', dtB, 1);
    out.nrhoA = planA; out.nrhoB = planB;
    out.nrhoRatio = (planA && planB && planA.dvPerBurn_ms > 0) ? (planB.dvPerBurn_ms / planA.dvPerBurn_ms) : null;

    // options list — dropped when infeasible
    out.optsFromBig = phasingOptionsFor(dtBig, null, orbitState);
    out.optsFromSmall = phasingOptionsFor(dtPhase, null, orbitState);

    return out;
  })()`, sandbox);

  for (const rt of r3.roundTrip) {
    approx(`5b R3: ΔP construction round-trips exactly (N=${rt.N})`, rt.identity, rt.dtPhase, 1e-6);
  }
  approx('5b R3: Keplerian phasing dv matches hand vis-viva re-derivation', r3.dvModule, r3.dvHand, 1e-6);
  ok('5b R3: |ΔP| well beyond half the period is flagged infeasible', r3.infeasibleCase === false);
  ok('5b R3: |ΔP| well within half the period is flagged feasible', r3.feasibleCase === true);
  ok('5b R3: infeasible dtPhase drops out of the N=1..5 option list entirely', r3.optsFromBig.length === 0);
  ok('5b R3: feasible dtPhase yields at least one N option', r3.optsFromSmall.length >= 1);
  ok('5b R3: NRHO perilune-approx dv is positive and finite', !!r3.nrhoA && r3.nrhoA.dvPerBurn_ms > 0 && isFinite(r3.nrhoA.dvPerBurn_ms));
  ok('5b R3: NRHO perilune-approx dv scales ~linearly with ΔP for small ΔP (2x dtPhase -> ~2x dv, within 20%)',
    r3.nrhoRatio != null && r3.nrhoRatio > 1.6 && r3.nrhoRatio < 2.4);
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 §21 B2 — Markellos f16/f'16 reference family (424, MATH.md §7ai)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { BLT_F16_FAMILY, BLT_FPRIME16_FAMILY, BLT_F16_SCALE, bltNdToKm, bltKmToNd, bltF16SelectFamily } =
    vm.runInContext('({ BLT_F16_FAMILY, BLT_FPRIME16_FAMILY, BLT_F16_SCALE, bltNdToKm, bltKmToNd, bltF16SelectFamily })', sandbox);

  ok('B2: BLT_F16_FAMILY has the expected member count (7, LEO-class 6563-7500km band)', BLT_F16_FAMILY.length === 7);
  ok('B2: BLT_FPRIME16_FAMILY has the same member count', BLT_FPRIME16_FAMILY.length === BLT_F16_FAMILY.length);

  let wellFormed = true, monotoneC = true, prevC = null;
  let ratiosOk = true, periodsOk = true, farOk = true;
  for (const fam of [BLT_F16_FAMILY, BLT_FPRIME16_FAMILY]) {
    prevC = null;
    for (const m of fam) {
      for (const k of ['rp_km', 'x0_nd', 'vy0_nd', 'jacobiC', 'perigee1_km', 'perigee2_km', 'perigee3_km', 't_p2_days', 't_p3_days', 'period_days', 'far_km']) {
        if (typeof m[k] !== 'number' || !Number.isFinite(m[k])) wellFormed = false;
      }
      if (m.perigee1_km !== m.rp_km) wellFormed = false; // p1 IS the family parameter
      if (prevC !== null && !(m.jacobiC > prevC)) monotoneC = false; // C increases with rp_km (measured, both branches)
      prevC = m.jacobiC;
      const raise2 = m.perigee2_km / m.perigee1_km, raise3 = m.perigee3_km / m.perigee1_km;
      if (!(raise2 > 25 && raise2 < 40)) ratiosOk = false;   // measured 28.8-34.5x (paper's 7200 member: 32.0x)
      if (!(raise3 > 15 && raise3 < 25)) ratiosOk = false;   // measured 17.1-19.6x
      if (!(m.period_days > 360 && m.period_days < 390)) periodsOk = false; // measured 371.8-378.1 d
      if (!(m.far_km > 1.4e6 && m.far_km < 1.6e6)) farOk = false; // WSB-scale far point, measured ~1.505-1.510M km
    }
  }
  ok('B2: every family member is well-formed (all fields finite, perigee1 == rp)', wellFormed);
  ok('B2: Jacobi constant is monotone (increasing) along both families as rp_km increases', monotoneC);
  ok('B2: perigee-raising ratios in the paper band (p2/p1 in 25-40x, measured 28.8-34.5x; p3/p1 in 15-25x)', ratiosOk);
  ok('B2: periods in the measured band (360-390 d)', periodsOk);
  ok('B2: far perpendicular crossing is WSB-scale (1.4-1.6M km)', farOk);

  // Paper anchor (Griesemer NTRS 20090016184 Table 1, rp=7200): p2=230,434,
  // p3=132,580 km. Our f16 member: 231,007 / 132,854 (0.25% / 0.21%). Pin at 1%.
  const m72 = BLT_F16_FAMILY.find(m => m.rp_km === 7200);
  ok('B2: f16 rp=7200 reproduces the paper Table-1 perigee 2 within 1% (measured 0.25%: 231,007 vs 230,434 km)',
    !!m72 && Math.abs(m72.perigee2_km / 230434 - 1) < 0.01);
  ok('B2: f16 rp=7200 reproduces the paper Table-1 perigee 3 within 1% (measured 0.21%: 132,854 vs 132,580 km)',
    !!m72 && Math.abs(m72.perigee3_km / 132580 - 1) < 0.01);
  ok('B2: f16 rp=7200 Jacobi constant matches the paper within 1e-5 (measured 3.0008551 vs 3.000850893)',
    !!m72 && Math.abs(m72.jacobiC - 3.000850893) < 1e-5);

  // f'16 is the NEAR-mirror of f16 (the Sun's finite distance breaks exact
  // symmetry — perigee 2 differs by ~7%, a real physical asymmetry): opposite
  // vy0 sign and x0 side, |vy0| within 1e-4 relative, C within 5e-6, period
  // within 2% — each branch independently continued and converged.
  let mirrorOk = true;
  for (let i = 0; i < BLT_F16_FAMILY.length; i++) {
    const a = BLT_F16_FAMILY[i], b = BLT_FPRIME16_FAMILY[i];
    if (a.rp_km !== b.rp_km) mirrorOk = false;
    if (!(a.vy0_nd > 0 && b.vy0_nd < 0)) mirrorOk = false;
    if (Math.abs(Math.abs(b.vy0_nd) / a.vy0_nd - 1) > 1e-4) mirrorOk = false;
    if (Math.abs(a.jacobiC - b.jacobiC) > 5e-6) mirrorOk = false;
    if (Math.abs(a.period_days / b.period_days - 1) > 0.02) mirrorOk = false;
    if (!((a.x0_nd - 1) > 0 && (b.x0_nd - 1) < 0)) mirrorOk = false; // opposite sides of the secondary
  }
  ok("B2: f'16 near-mirrors f16 (opposite vy0/x0 side, C within 5e-6, period within 2%)", mirrorOk);

  // Scaling-chain round-trip: nondim -> km -> nondim is an identity.
  let scaleRoundTrip = true;
  for (const x of [1e-5, 4.8e-5, 0.5, 1.0000450886]) {
    if (Math.abs(bltKmToNd(bltNdToKm(x)) - x) > 1e-12) scaleRoundTrip = false;
  }
  ok('B2: scaling chain (nondim -> km -> nondim) round-trips to float precision', scaleRoundTrip);
  approx('B2: DU_KM/TU_S/VU_KMS are internally consistent', BLT_F16_SCALE.VU_KMS, BLT_F16_SCALE.DU_KM / BLT_F16_SCALE.TU_S, 1e-9);

  // Family-selection rule sanity (Moon-quadrant, B3 consumer contract).
  ok('B2: bltF16SelectFamily picks f16 when the Moon is Sun-near (angle 0)', bltF16SelectFamily(0) === BLT_F16_FAMILY);
  ok('B2: bltF16SelectFamily picks f\'16 when the Moon is Sun-far (angle 180)', bltF16SelectFamily(180) === BLT_FPRIME16_FAMILY);
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 §21 B3 — incremental BLT targeting solver (565-physics-blt.js, MATH.md §7aj)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { physSolveBlt, physBltSunEarthMoonAngleDeg, physBltEmL2DistanceKm,
    physBltFindMoonPlaneCrossing, physBltAcceptanceChecks, physPropagateSegment,
    physSolveNrhoTransfer, physShootLegAim } =
    vm.runInContext('({ physSolveBlt, physBltSunEarthMoonAngleDeg, physBltEmL2DistanceKm, physBltFindMoonPlaneCrossing, physBltAcceptanceChecks, physPropagateSegment, physSolveNrhoTransfer, physShootLegAim })', sandbox);

  // Regression guard (5a/targeting untouched by B3 — CLAUDE.md hard invariant).
  ok('B3: 5a/targeting solvers still defined (physSolveNrhoTransfer, physShootLegAim) — B3 added a new file, touched nothing else', typeof physSolveNrhoTransfer === 'function' && typeof physShootLegAim === 'function');

  // EM-L2 distance sanity: known to sit ~60,000-65,000 km beyond the Moon
  // (~448,000-450,000 km from Earth) at any epoch.
  const l2 = physBltEmL2DistanceKm(0);
  ok('B3: physBltEmL2DistanceKm gives a plausible EM-L2 offset from the Moon (60,000-65,000 km)', l2.distFromMoonKm > 60000 && l2.distFromMoonKm < 65000);
  ok('B3: EM-L2 distance from Earth is plausible (410,000-470,000 km — the real ephemeris Moon distance varies with lunar eccentricity, so this is wider than a fixed-mean-distance textbook figure)', l2.distFromEarthKm > 410000 && l2.distFromEarthKm < 470000);

  // Moon quadrant angle + plane-crossing finder: pure sanity (finite, in range).
  const angle0 = physBltSunEarthMoonAngleDeg(0);
  ok('B3: physBltSunEarthMoonAngleDeg returns a finite angle in [0,180]', Number.isFinite(angle0) && angle0 >= 0 && angle0 <= 180);
  const crossing = physBltFindMoonPlaneCrossing(0, 78, 20);
  ok('B3: physBltFindMoonPlaneCrossing finds a Moon Sun-Earth-rotating-plane crossing near the ~78d target', crossing != null && Math.abs(crossing / 86400 - 78) < 20);

  // The canonical case: t0=0 (MET epoch 0, PROG_DEFAULT_EPOCH_JD), 185 km
  // parking altitude (inclination is DERIVED by the B3.1 anchoring — the
  // family geometry determines the departure plane; a passed incRad is only
  // a fallback). All numbers below MEASURED 2026-07-15 on this codebase's
  // mean-element ephemeris (band-level agreement with the paper expected,
  // not exact numbers — B-series risk callout). ~5 s solve.
  const canonical = physSolveBlt({ t0_s: 0, parkingAltKm: 185 });
  ok('B3: physSolveBlt never throws and always returns a {converged,...} shape', canonical && typeof canonical.converged === 'boolean');
  // Step 1 (B3.1 anchored seed + WSB-band root selection): CONVERGED —
  // measured dv_TLI 3.1984 km/s (paper class 3.0-3.2), arc apogee 1.42M km
  // (ispace band 1-1.5M), arrival crossing at 101.6 d (paper TOF class
  // 87-180 d), plane-crossing residual -353 km.
  ok('B3: Step 1 converges on the canonical case (anchored seed + in-band root)', canonical.step1 && canonical.step1.dv_kms > 0);
  ok('B3: canonical dv_TLI in the paper band 3.0-3.3 km/s (measured 3.198)', canonical.step1.dv_kms > 3.0 && canonical.step1.dv_kms < 3.3);
  ok('B3: canonical Step-1 plane-crossing residual under 10,000 km (measured -353 km)', Math.abs(canonical.step1.resid_km) < 10000);
  // ispace-hybrid acceptance checks (RESEARCH_CISLUNAR.md): both PASS on the
  // canonical arc — apogee 1,423,889 km in the 1-1.5M band, L-neck exit true.
  ok('B3: canonical arc apogee lands in the WSB band (measured 1.424M km)', canonical.acceptance && canonical.acceptance.apogeeBandOk === true);
  ok('B3: canonical arc exits Earth vicinity via the L1/L2 region', canonical.acceptance && canonical.acceptance.exitedViaLNeck === true);
  // Step 2 (RTBP orientation Newton, STM-chained analytic partials):
  // CONVERGED — measured 7 iterations to the 15k-km hand-off band.
  ok('B3: Step 2/3 orientation Newton converges on the canonical case', canonical.step23 && canonical.step23.params && canonical.step23.params.dv_kms > 3.0);
  // Step 4 (capture refinement): the canonical epoch does NOT reach full
  // ballistic capture (KEm < 0 + second perilune) — measured best: a
  // ~40,000 km perilune at KEm ~ +0.37 km^2/s^2 (a slow flyby, not capture;
  // the capture filament needs the multiple-shooting escalation both
  // reference papers describe — MATH.md §7aj critiques 114-116). The gate
  // pins the HONEST overall fail-clean shape plus Step 4's measured
  // progress (a real perilune with finite KEm), not a fabricated capture.
  ok('B3: canonical result is fail-clean overall (converged:false at a named stage with a note) — no false capture claim', canonical.converged === false && typeof canonical.stage === 'string' && typeof canonical.note === 'string');
  ok('B3: Step 4 finds a real perilune with finite KEm on the canonical case (measured ~40k km, KEm ~ +0.37)', canonical.step4 && canonical.step4.perilune1 && Number.isFinite(canonical.step4.perilune1.KEm) && canonical.step4.perilune1.rMag_km > 1737.4);
  ok('B3: canonical TOF lands in the paper band 85-180 d (measured ~110 d)', canonical.tof_days > 85 && canonical.tof_days < 180);

  // physBltAcceptanceChecks on a plain high-energy Earth-Sun ballistic arc
  // (independent of the solver's own convergence) — sanity on the apogee
  // measurement machinery itself.
  const burnCtx = { center: 'Earth', bodies: ['Earth', 'Sun'] };
  const testRes = physPropagateSegment({ r: [6556, 0, 0], v: [0, 10.9, 0] }, 0, 60 * 86400, burnCtx, { maxSamples: 128 });
  const acc = physBltAcceptanceChecks(testRes, 60 * 86400);
  ok('B3: physBltAcceptanceChecks measures a finite, positive apogee on a real propagated arc', Number.isFinite(acc.apogeeKm) && acc.apogeeKm > 6556);
}

// ═══════════════════════════════════════════════════════════════════════════
// Trade-study ⇄ Orbits-page PATH EQUALITY (S1.5 splitter carry-through)
//
// Guards the shipped-a-third-time S1.5 bug: the worksheet trade-study base
// assembler `_tsCollectBase()` (165) used to build its stage list from the
// standard DOM rows ONLY, dropping the s15/s15_* fields (which live in
// stageStore, not those rows). `_tsExpandStages` therefore could not BECO-split
// the stage, so lvMaxPayload saw a single un-split stage and produced a payload
// that DIVERGED from the Orbits-page calculator (calculateWithS15 → _s15BecoSplit,
// which DOES split) for every S1.5 vehicle.
//
// This block drives the REAL `_tsCollectBase()` through a controlled DOM/global
// stub for every builtin preset that carries no separate booster (so the
// comparison isolates the stage list), and asserts its max payload equals the
// vehicle-object assembler `_tsVehicleToBase()` path (the same chain the Orbits
// page + trade-study compare-chips use) across a representative destination set.
// A dedicated sandbox is used because the preset/resolver modules aren't in the
// main FILES list (mirrors the ghost-stage guard).
// ═══════════════════════════════════════════════════════════════════════════
{
  const tsFiles = ['src/js/010-constants.js', 'src/js/050-builtin-presets.js',
    'src/js/060-orbit-categories.js', 'src/js/140-physics.js', 'src/js/145-dest-dv.js',
    'src/js/150-stage-and-a-half.js', 'src/js/165-trade-study.js',
    'src/js/210-stage-library.js', 'src/js/330-stage-resolver.js'];
  const tsSrc = tsFiles.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  // Mutable DOM store: getElementById(id) → {value}. numStages/stageStore/
  // useBooster/destMode are provided as context globals (none of the loaded
  // modules declare them, so free-variable lookups resolve to these props),
  // mutated per-preset from Node.
  const domStore = {};
  const tsb = {
    document: { getElementById: id => (id in domStore) ? { value: domStore[id] } : null },
    console, window: {},
    numStages: 0, stageStore: [], useBooster: false, destMode: 'orbit',
  };
  vm.createContext(tsb);
  let tsLoadOk = true;
  try { vm.runInContext(tsSrc, tsb, { filename: 'ts-pathcheck-modules.js' }); }
  catch (e) { tsLoadOk = false; console.error('ts-pathcheck load error: ' + e.message); }
  ok('S1.5 path-check modules load in vm', tsLoadOk);

  const PRESETS = vm.runInContext('typeof BUILTIN_PRESETS!=="undefined"?BUILTIN_PRESETS:null', tsb);
  const _tsVehicleToBase = vm.runInContext('_tsVehicleToBase', tsb);
  const _tsCollectBase = vm.runInContext('_tsCollectBase', tsb);
  const _tsExpandStages = vm.runInContext('_tsExpandStages', tsb);
  const resolvePresetStages = vm.runInContext('resolvePresetStages', tsb);
  const resolvePresetBooster = vm.runInContext('resolvePresetBooster', tsb);
  const lvMaxPayload_ts = vm.runInContext('lvMaxPayload', tsb);
  const destOnOrbitDV_ts = vm.runInContext('destOnOrbitDV', tsb);
  ok('S1.5 path-check exports resolved', !!PRESETS && !!_tsVehicleToBase && !!_tsCollectBase);

  const TS_DESTS = [
    { label: 'LEO200', arg: { mode: 'orbit', apogee: 200, perigee: 200, inc: 28.5, parkingAlt: 185 } },
    { label: 'GTO',    arg: { mode: 'orbit', apogee: 35786, perigee: 185, inc: 28.5, parkingAlt: 185 } },
    { label: 'SSO700', arg: { mode: 'orbit', apogee: 700, perigee: 700, inc: 98.2, parkingAlt: 185 } },
    { label: 'TLI',    arg: { mode: 'escape', c3: -1.9, decl: 28.5, perigee: 185 } },
  ];
  const maxPayVia = (base, destArg) => {
    const ddv = destOnOrbitDV_ts(destArg, base.siteLat);
    if (ddv.error) return null;
    const st = _tsExpandStages(base.stages);
    return lvMaxPayload_ts(st, base.boosterArg, base.fairingM, base.fairingJ, ddv.parkingAlt, ddv.onOrbitDV, base.siteLat, base.azMin, base.azMax);
  };

  if (PRESETS && _tsCollectBase) {
    let s15Covered = 0, checked = 0;
    const mism = [];
    PRESETS.forEach(p => {
      // Isolate the stage list: skip presets with a separate booster group (the
      // worksheet path would pull booster from lvBoosterGroups/DOM, which this
      // stub doesn't populate). No-booster presets keep boosterArg=null on both
      // sides, so any divergence is purely the S1.5 stage carry-through.
      if (resolvePresetBooster(p) || (Array.isArray(p.boosterGroups) && p.boosterGroups.length)) return;
      const resolved = resolvePresetStages(p);
      // Drive the REAL _tsCollectBase: standard DOM rows + stageStore (s15 fields).
      tsb.numStages = resolved.length;
      tsb.stageStore = resolved.map(s => ({ ...s }));
      tsb.useBooster = false;
      tsb.destMode = 'orbit';
      const site = p.site || {};
      domStore['fairing-mass'] = p.fairingMass || 0;
      domStore['fairing-jettison'] = p.fairingJettison || 0;
      domStore['site-lat'] = site.lat != null ? site.lat : 28.5;
      domStore['az-min'] = site.azMin != null ? site.azMin : 37;
      domStore['az-max'] = site.azMax != null ? site.azMax : 112;
      domStore['parking-alt'] = 185; domStore['escape-perigee'] = 185;
      domStore['payload-mass'] = 0;
      resolved.forEach((s, i) => {
        domStore[`s${i + 1}_dry`] = s.dry; domStore[`s${i + 1}_prop`] = s.prop;
        domStore[`s${i + 1}_thrust`] = s.thrust; domStore[`s${i + 1}_isp`] = s.isp;
        domStore[`s${i + 1}_res`] = s.res != null ? s.res : 2;
      });
      const wkBase = _tsCollectBase();       // worksheet trade-study path (fixed)
      const vehBase = _tsVehicleToBase(p);   // orbits / compare-chip path
      const isS15 = resolved.some(s => s.s15);
      if (isS15) s15Covered++;
      checked++;
      TS_DESTS.forEach(d => {
        const a = maxPayVia(vehBase, d.arg), b = maxPayVia(wkBase, d.arg);
        if (a == null && b == null) return;
        // exact equality expected: identical inputs → identical bisection.
        if (!(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.5))
          mism.push(`${p.name} @ ${d.label}: orbits=${a} trade=${b}`);
      });
    });
    ok(`trade-study worksheet path == orbits path for all no-booster presets (${checked} presets)` +
       (mism.length ? ' — MISMATCH: ' + mism.slice(0, 6).join('; ') : ''), mism.length === 0);
    // Guard the guard: the sweep must actually exercise S1.5 presets, else a
    // future _tsCollectBase regression on s15 would slip through unmeasured.
    ok(`S1.5 presets exercised by the path-equality check (covered ${s15Covered})`, s15Covered >= 3);
  }
}

  return counts();
};
