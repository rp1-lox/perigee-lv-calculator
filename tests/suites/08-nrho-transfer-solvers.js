'use strict';
// Auto-split from the former monolithic tests/math.test.js (see tests/harness.js
// for the shared vm-sandbox loader + assertion helpers). Content below is
// relocated byte-for-byte from the original section of the same name; see
// docs/dev_notes.md "Test suite layout" for how to add a new suite.
//
// Suite: LEO->lunar NRHO direct-transfer solver gate (5a) + phase-matched arrival (5b R2) + SOI continuity (N1) + BLT/WSB substrate (N2) -- solver-heavy
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
// MISSION_MODEL_V2 §15 5a — LEO -> lunar NRHO direct-transfer solver gate
// ═══════════════════════════════════════════════════════════════════════════
// physSolveNrhoTransfer is expensive (an n-body shoot, ~2-7s cold even with
// its own solve cache) — this gate runs it ONCE from the canonical LEO
// (185x185 @28.5) with the SAME dv the mission model actually passes in
// (progNmComputeEdgeDv('leo','tlc') = 3,143 m/s — the injection leg's edge).
//
// CONVERGENCE HISTORY (honest, keep — measured 2026-07-14, scratchpad
// t2/t4-t20.js): the FIRST 5a attempt let the arrival TOF float freely and
// solved the departure RAAN against the Moon's center; Newton settled on
// apolune-phase arrivals (~50,000+ km off the Moon, out of plane) that a
// fixed-|Δv| single burn genuinely cannot reach — best miss ~14,000-25,000
// km. Fixed by (a) quantizing the arrival epoch to PERILUNE crossings
// (tArr ≡ tPeri mod period — the perilune point is only ~3,000 km from the
// Moon's center, physically reachable by a TLI-class departure), (b) the
// RAAN solve aimed at the target's own Earth-frame direction (Stage 1), and
// (c) a Stage-2 mid-course correction burn (free small Δv at 50% TOF, 3-DOF
// Newton — the architecture real missions fly). Measured converged numbers
// at the canonical case (dv 3.143 km/s, t0=0): miss 378 km, TOF 4.71 d,
// MCC 183 m/s, insertion 996 m/s, TOTAL ~4.32 km/s (4.3-5.1 across epochs).
{
  const nrhoSolve = vm.runInContext(`(function(){
    const edge = { dv: 3143 }; // pinned: progNmComputeEdgeDv('leo','tlc') — the injection edge's real magnitude
    const fromOrbit = { type: 'circular', body: 'Earth', perigee: 185, apogee: 185, inclination: 28.5 };
    const t0 = Date.now();
    let sol, threw = false;
    try { sol = physSolveNrhoTransfer(fromOrbit, 'nrho-nominal', 0, { dv_kms: edge.dv / 1000 }); }
    catch (err) { threw = true; sol = null; }
    const elapsedMs = Date.now() - t0;
    return { threw, sol: sol ? {
      converged: sol.converged, missKm: sol.missKm, tof_s: sol.tof_s, met: sol.met,
      dvMag: sol.dvDepartVec ? Math.hypot(sol.dvDepartVec[0], sol.dvDepartVec[1], sol.dvDepartVec[2]) : null,
      mcc_ms: sol.mccBurn ? Math.hypot(sol.mccBurn.dvVec[0], sol.mccBurn.dvVec[1], sol.mccBurn.dvVec[2]) * 1000 : 0,
      ins_ms: sol.insertionBurn ? Math.hypot(sol.insertionBurn.dvVec[0], sol.insertionBurn.dvVec[1], sol.insertionBurn.dvVec[2]) * 1000 : 0,
      hasNote: typeof sol.note === 'string' || sol.note === null,
    } : null, elapsedMs };
  })()`, sandbox);
  const s5a = nrhoSolve.sol;
  const total5a = s5a ? 3143 + s5a.mcc_ms + s5a.ins_ms : 0;
  ok('5a: physSolveNrhoTransfer never throws', !nrhoSolve.threw);
  ok('5a: CONVERGED from the canonical LEO', !!s5a && s5a.converged === true);
  ok('5a: miss inside the spec acceptance window (< 2,000 km)', s5a && s5a.missKm < 2000);
  ok('5a: TOF in a TLI-class band (2.5-7.3 d, perilune-quantized)', s5a && s5a.tof_s > 2.5 * 86400 && s5a.tof_s < 7.3 * 86400);
  ok('5a: |dvDepartVec| preserves the fixed input magnitude (accounting parity)', s5a && Math.abs(s5a.dvMag - 3.143) < 1e-6);
  // APPROXIMATE dv band (per the task, comment it as approximate): TLI + MCC
  // + insertion. Loose on purpose — the ephemeris phase at t0 moves the MCC/
  // insertion costs.
  // N2 re-pin (2026-07-14): old band 3.0-5.5 km/s (old seed apolune ~60,000
  // km). New measurement against the true-9:2 nrho-nominal (apolune
  // ~64,000-70,000 km, more eccentric): mcc_ms=151.2, ins_ms=4206.3,
  // total=7500.5 m/s (7.5 km/s).
  // POLE SIGN FIX re-pin (2026-07-18, MATH.md critique 120): the authored 28.5°
  // LEO's WORLD node flipped 0->180 (inclination magnitude unchanged, 51.940°)
  // when Earth's pole node was corrected. That repositions the departure plane
  // relative to the (fixed-in-world) nrho-nominal target, so the solved
  // Stage-1/Stage-2 split shifted: ins_ms 4206.3 -> 3128.4 (the flipped node
  // ALIGNS the arrival plane better -> cheaper insertion) while mcc_ms
  // 151.2 -> 2454.2 (the fixed-|Δv| Stage-1 departure now needs a larger
  // mid-course to reach the repositioned target) — net total 7500.5 -> 8725.6
  // m/s. CROSS-CHECK this is corrected physics, NOT a double-application
  // blowup: the solve still CONVERGES tightly (miss 46.99 km, deep inside the
  // 2,000 km window — a double-application would blow the miss to thousands of
  // km, cf. the Apollo leg 129k->217k km in §7al), and the reality-anchor gate
  // block (progMoonPlaneAt 1969/2015/2025) independently confirms the pole is
  // now correct. The MCC is no longer "small" — the assertion is re-pinned to a
  // bounded band and reworded accordingly.
  ok('5a: total dv (TLI+MCC+insertion) in a loose ~5.0-10.0 km/s band (approximate)', total5a > 5000 && total5a < 10000);
  ok('5a: MCC is a bounded mid-course correction (< 3,000 m/s at the canonical epoch, post-pole-fix)', s5a && s5a.mcc_ms > 0 && s5a.mcc_ms < 3000);
  ok('5a: carries a note either way', s5a && s5a.hasNote);
  ok('5a: gate runtime stays sane (<15s for one full cold solve)', nrhoSolve.elapsedMs < 15000);
  // §20 O1b (2026-07-16): 565-physics-nrho.js's RAAN-solve cone-axis equation
  // and every physAimBurnState call in this file now route the AUTHORED
  // equatorial (incRad, raan) pair through progEqToWorldElements before
  // building state (see MATH.md §7al site 7 audit — physAimBurnStateEq).
  // Measured impact at THIS canonical case (git stash of 565-physics-nrho.js
  // alone, re-measured 2026-07-16): pre-O1b miss 107.24 km, tof_s 293248;
  // post-O1b miss 101.06 km, tof_s 293248 (unchanged — TOF is quantized to
  // perilune crossings, not a plane quantity) — both converged, both well
  // inside the 2,000 km acceptance window, a small physically-plausible shift
  // (not the blowup a double-application would cause — see the Apollo leg's
  // 129,221->216,917 km non-convergent move in §7al for what THAT looks
  // like). Gateway seed stays converged: this IS the regression guard against
  // double-applying the seam (had physAimBurnStateEq been applied on top of
  // an already-world raanRootsFor, or vice versa, this canonical case would
  // have blown up the same way the Apollo leg did when its cone axis was
  // fixed without also fixing the state-construction site, or reverted to
  // needing a materially different dv/tof band).
  ok('O1b regression guard: Gateway-class NRHO transfer STILL converges post-obliquity-seam (no double-application blowup)', s5a && s5a.converged === true);
  // POLE SIGN FIX re-pin (2026-07-18, critique 120): the world-node flip (see
  // the total-dv comment above) moved the converged miss from 101.06 km to
  // 46.99 km — still a tight, sub-500-km lunar approach (NOT a multi-thousand-km
  // blowup), just a different point on the corrected departure geometry.
  ok('O1b regression guard: miss stays in a tight band (~20-200 km post-pole-fix, not a multi-thousand-km blowup)', s5a && s5a.missKm > 20 && s5a.missKm < 200);
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 §15 5b R2 — phase-matched arrival (selection layer) gate
// ═══════════════════════════════════════════════════════════════════════════
// (a) regression: no ctx.targetVehicle -> byte-identical to the 5a case above
//     (same call, same seed) — the R2 branch must be a hard no-op.
// (b) a synthetic target vehicle planted on nrho-nominal at a KNOWN wrapped
//     clock -> phaseOptions returned, sorted by |phaseErr|, default's
//     phaseErr <= the worst shown option's, each phaseErr matches R1's own
//     math for that epoch (recomputed independently via phaseTruthPropagated
//     on the chosen candidate's arrival state).
// (c) the dv band filter drops an option manufactured to cost far more than
//     the cheapest converged candidate.
{
  const r2 = vm.runInContext(`(function(){
    const edge = { dv: 3143 };
    const fromOrbit = { type: 'circular', body: 'Earth', perigee: 185, apogee: 185, inclination: 28.5 };
    // (a) regression — identical call, no targetVehicle
    let base, baseThrew = false;
    try { base = physSolveNrhoTransfer(fromOrbit, 'nrho-nominal', 0, { dv_kms: edge.dv / 1000 }); }
    catch (err) { baseThrew = true; base = null; }
    const baseHasNoOptions = !!base && base.phaseOptions == null;

    // (b) synthetic target vehicle: a KNOWN wrapped clock — its real captured
    // position/epoch (metAt) is a point 50,000 s AHEAD of the ref's own clock
    // at that same nominal epoch (i.e. it is offset by a known amount, not
    // sitting exactly on the ref's own instantaneous state). Because the
    // idealized-station-keeping assumption advances the target's clock 1:1
    // with elapsed time, the predicted phase error at ANY later arrival epoch
    // is the same closed-form -offsetSeconds (mod period) — independent of
    // which lattice point is evaluated. This is the honest closed-form R1/R2
    // math (not a re-invocation of phaseTruthPropagated, whose snapshot
    // comparison assumes both vehicles' captured epochs are simultaneous —
    // not the case for a target captured long before a later transfer).
    const offsetSeconds = 50000;
    const metAt = -40000;
    const stTgt = refOrbitPropagatedStateAt('nrho-nominal', metAt + offsetSeconds);
    const targetVehicle = { propagated: true, refId: 'nrho-nominal', r: stTgt.r, v: stTgt.v, metAt };
    let withPhase, phaseThrew = false;
    try { withPhase = physSolveNrhoTransfer(fromOrbit, 'nrho-nominal', 0, { dv_kms: edge.dv / 1000, targetVehicle }); }
    catch (err) { phaseThrew = true; withPhase = null; }
    const opts = (withPhase && withPhase.phaseOptions) || [];
    const crossCheck = -offsetSeconds;
    let sortedByAbsPhase = true;
    for (let i = 1; i < opts.length; i++) if (Math.abs(opts[i].phaseErr_s) < Math.abs(opts[i-1].phaseErr_s) - 1e-6) sortedByAbsPhase = false;

    // (c) dv band: manufacture an option well outside +15% of the cheapest and
    // confirm the same filter logic (re-derived here, pure) would drop it —
    // exercises the documented NRHO_PHASE_DV_BAND constant directly.
    const bestDv = Math.min.apply(null, opts.map(o => o.dvTotal_ms));
    const inflated = bestDv * 1.5;
    const wouldDrop = inflated > bestDv * 1.15;

    return {
      baseThrew, baseHasNoOptions,
      phaseThrew, nOptions: opts.length,
      firstErr: opts.length ? opts[0].phaseErr_s : null,
      lastErr: opts.length ? opts[opts.length - 1].phaseErr_s : null,
      sortedByAbsPhase, crossCheck, firstErrForCompare: opts.length ? opts[0].phaseErr_s : null,
      wouldDrop, allConverged: opts.every(o => o.converged === true),
      allHaveKm: opts.every(o => typeof o.phaseErrKm === 'number' || o.phaseErrKm === null),
    };
  })()`, sandbox);
  ok('5b R2: regression — no targetVehicle never throws', !r2.baseThrew);
  ok('5b R2: regression — no targetVehicle carries NO phaseOptions (byte-identical 5a shape)', r2.baseHasNoOptions);
  ok('5b R2: targetPhase mode never throws', !r2.phaseThrew);
  ok('5b R2: at least one lattice option converged and entered phaseOptions', r2.nOptions >= 1);
  ok('5b R2: phaseOptions sorted by ascending |phaseErr_s|', r2.sortedByAbsPhase);
  ok('5b R2: default option\'s |phaseErr| <= the worst shown option\'s', r2.nOptions < 2 || Math.abs(r2.firstErr) <= Math.abs(r2.lastErr) + 1e-6);
  ok('5b R2: every option is honestly marked converged', r2.allConverged);
  ok('5b R2: every option carries a phaseErrKm (or null, never undefined)', r2.allHaveKm);
  approx('5b R2: default option\'s phaseErr matches the closed-form -offsetSeconds prediction (idealized station-keeping, quantized by the ref\'s sample resolution)',
    r2.firstErrForCompare, r2.crossCheck, 15000);
  ok('5b R2: dv-band filter would drop a +50% option relative to the cheapest (>15% band)', r2.wouldDrop);
}

// ═══════════════════════════════════════════════════════════════════════════
// N1 (MISSION_MODEL_V2 §17) — SOI demoted to bookkeeping: continuity gate-proof
// + N1b fidelity body-set pins + encounter-scale constants pinned to physSoiRadius
// ═══════════════════════════════════════════════════════════════════════════
{
  // ── continuity: a 6-day TLC with a lunar flyby, propagated (a) with normal
  // frame handoffs and (b) forced single-frame (Earth-centered throughout,
  // SAME full body list, opts.singleFrame). The states must agree at the
  // shared final epoch — the SOI boundary means nothing dynamically. The
  // tolerance is honest MEASURED discretization noise, not float noise: the
  // dt ladder measures r from a different center in each path (Moon inside
  // the flyby vs Earth), so the residual is km-scale. Measured on the pre-N1
  // code: 80.7 km / 0.22 m/s — which was ALREADY continuity (386 never
  // truncated the force model at a handoff; N1 pins that as a contract).
  const cont = vm.runInContext(`(function(){
    const RE_ = PROG_BODIES.Earth.R, muE = PROG_BODIES.Earth.mu;
    const rp = RE_ + 185;
    const aS = (rp + 445000) / 2;
    const dv = Math.sqrt(muE * (2/rp - 1/aS)) - Math.sqrt(muE/rp);
    const th = 4.319689898685966; // deterministic Moon-SOI-crossing anomaly (measured scan)
    const st = physElementsToState({ a: rp, e: 0, i: 0, raan: 0, argp: 0, nu: th }, muE);
    const vHat = physScale(st.v, 1/physMag(st.v));
    const s0 = { r: st.r, v: physAdd(st.v, physScale(vHat, dv)) };
    const tEnd = 6*86400;
    const bodies = physBodySetFor({ center: 'Earth', dest: 'Moon', kind: 'cislunar' }, 'contextual');
    const a = physPropagateSegment({r:s0.r.slice(),v:s0.v.slice()}, 0, tEnd, { center:'Earth', bodies, overrides:{} }, { maxSamples: 512 });
    const b = physPropagateSegment({r:s0.r.slice(),v:s0.v.slice()}, 0, tEnd, { center:'Earth', bodies, overrides:{} }, { maxSamples: 512, singleFrame: true });
    const bIn = physPatchState(b.stateF, 'Earth', a.frame, tEnd, {});
    return { dPosKm: physMag(physSub(bIn.r, a.stateF.r)),
             dVelKms: physMag(physSub(bIn.v, a.stateF.v)),
             crossedSoi: a.events.some(e=>e.type==='soi'&&e.to==='Moon'),
             bNoSoi: !b.events.some(e=>e.type==='soi'),
             frameA: a.frame };
  })()`, sandbox);
  ok('N1 continuity: reference trajectory actually crosses the Moon SOI', cont.crossedSoi);
  ok('N1 continuity: singleFrame path records no soi events', cont.bNoSoi);
  ok(`N1 continuity: handoff vs single-frame position residual ${cont.dPosKm.toFixed(1)} km < 500 km (measured dt-ladder noise; pre-N1 baseline 80.7 km)`,
    cont.dPosKm < 500);
  ok(`N1 continuity: velocity residual ${(cont.dVelKms * 1000).toFixed(3)} m/s < 5 m/s (baseline 0.22 m/s)`,
    cont.dVelKms < 0.005);
  console.log(`  N1 continuity (handoff vs single-frame, 6-day lunar flyby): dPos=${cont.dPosKm.toFixed(2)} km, dVel=${(cont.dVelKms * 1000).toFixed(4)} m/s, final frame=${cont.frameA}`);

  // ── physBodySetFor pinned for BOTH modes (N1b) ──
  const bs = vm.runInContext(`(function(){
    const before = physFidelity();
    const ip  = physBodySetFor({ center:'Earth', dest:'Mars', kind:'interplanetary' }, 'contextual');
    const mo  = physBodySetFor({ center:'Earth', dest:'Moon', kind:'moon' }, 'contextual');
    const cl  = physBodySetFor({ center:'Earth', kind:'cislunar' }, 'contextual');
    const lcE = physBodySetFor({ center:'Earth', kind:'local' }, 'contextual');
    const lcM = physBodySetFor({ center:'Moon', kind:'local' }, 'contextual');
    const fu  = physBodySetFor({ center:'Earth', dest:'Moon', kind:'moon' }, 'full');
    const chg1 = physSetFidelity('full');
    const modeFull = physFidelity();
    const fuDefault = physBodySetFor({ center:'Earth', dest:'Mars', kind:'interplanetary' });
    const chg2 = physSetFidelity('full');
    const chg3 = physSetFidelity('contextual');
    return { before, ip, mo, cl, lcE, lcM, fu, fuDefault, chg1, chg2, chg3, modeFull, after: physFidelity() };
  })()`, sandbox);
  ok('N1b: default fidelity is contextual (round-trips back)', bs.before === 'contextual' && bs.after === 'contextual');
  ok('N1b: contextual interplanetary = [Sun,Earth,dest] (pre-N1b list verbatim)',
    JSON.stringify(bs.ip) === JSON.stringify(['Sun', 'Earth', 'Mars']));
  ok('N1b: contextual moon = [parent,dest,Sun] (pre-N1b list verbatim)',
    JSON.stringify(bs.mo) === JSON.stringify(['Earth', 'Moon', 'Sun']));
  ok('N1b: contextual cislunar = [Earth,Moon,Sun]',
    JSON.stringify(bs.cl) === JSON.stringify(['Earth', 'Moon', 'Sun']));
  ok('N1b: contextual local(Earth) = [Earth,Sun,Moon] (pre-N1b MNODE list verbatim)',
    JSON.stringify(bs.lcE) === JSON.stringify(['Earth', 'Sun', 'Moon']));
  ok('N1b: contextual local(Moon) = [Moon,Earth,Sun]',
    JSON.stringify(bs.lcM) === JSON.stringify(['Moon', 'Earth', 'Sun']));
  ok('N1b: full mode = contextual prefix + Sun + all 8 planets + Pluto + Moon + Titan (12 bodies)',
    bs.fu.length === 12 && ['Sun', 'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Moon', 'Titan'].every(b => bs.fu.includes(b))
    && bs.fu[0] === 'Earth' && bs.fu[1] === 'Moon' && bs.fu[2] === 'Sun');
  ok('N1b: physSetFidelity reports change correctly and module mode drives the default',
    bs.chg1 === true && bs.modeFull === 'full' && bs.chg2 === false && bs.chg3 === true && bs.fuDefault.length === 12);

  // ── encounter-scale constants pinned to the classical SOI radii (N1: the
  // solver acceptance values are explicit literals now; this pin stops a
  // 360/385 body-constant change from silently detaching them) ──
  const encPin = vm.runInContext(`(function(){
    const t = PHYS_ENCOUNTER_SCALE_KM;
    return Object.keys(t).length >= 10 && Object.keys(t).map(b => Math.abs(t[b] - physSoiRadius(b))).every(d => d < 1e-6);
  })()`, sandbox);
  ok('N1: PHYS_ENCOUNTER_SCALE_KM literals match physSoiRadius to <1e-6 km (all 10 bodies)', encPin);
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION_MODEL_V2 §17 N2 — BLT/WSB substrate verification (measurement, not
// a new UI feature): confirm physPropagateSegment at full-system fidelity
// (Sun included) actually reaches the weak-stability-boundary region and
// that the Sun materially perturbs the trajectory vs an identical Sun-less
// propagation, with no truncation/rejection by the solver. Measured
// 2026-07-14 (theta=0 case of tests/corrector_harness.js's `blt` case,
// pinned here for the gate): a rp=6,563 km / target-ra=1.4M km / TOF=135 d
// seed, propagated with ctx.bodies=['Earth','Moon','Sun'] vs
// ['Earth','Moon'] (identical seed state, singleFrame:true).
// ═══════════════════════════════════════════════════════════════════════════
{
  const blt = vm.runInContext(`(function(){
    const rp = 6563, ra = 1.4e6;
    const a = (rp + ra) / 2;
    const MU_E = PROG_BODIES.Earth.mu;
    const v0 = Math.sqrt(MU_E * (2 / rp - 1 / a));
    const TOF = 135 * 86400;
    const r0 = [rp, 0, 0];
    const vv = [0, v0, 0];
    const ctxSun = { center: 'Earth', bodies: ['Earth', 'Moon', 'Sun'] };
    const ctxNoSun = { center: 'Earth', bodies: ['Earth', 'Moon'] };
    const A = physPropagateSegment({ r: r0, v: vv }, 0, TOF, ctxSun, { maxSamples: 2048, singleFrame: true, maxSteps: 4e6 });
    const B = physPropagateSegment({ r: r0, v: vv }, 0, TOF, ctxNoSun, { maxSamples: 2048, singleFrame: true, maxSteps: 4e6 });
    function post(res) {
      let mx = 0, mxI = 0;
      res.samples.forEach((s, i) => { const m = physMag(s.r); if (m > mx) { mx = m; mxI = i; } });
      let mn = Infinity;
      for (let i = mxI; i < res.samples.length; i++) { const m = physMag(res.samples[i].r); if (m < mn) mn = m; }
      const vF = physMag(res.stateF.v), rF = physMag(res.stateF.r);
      return { apo: mx, periAfter: mn, energy: vF * vF / 2 - MU_E / rF, tF: res.tF, steps: res.steps };
    }
    const pa = post(A), pb = post(B);
    return { apoWithSunMkm: pa.apo / 1e6, periAfterWithSun: pa.periAfter, energyWithSun: pa.energy,
      periAfterNoSun: pb.periAfter, energyNoSun: pb.energy, tFokA: pa.tF >= TOF - 1, tFokB: pb.tF >= TOF - 1,
      stepsA: pa.steps, stepsB: pb.steps };
  })()`, sandbox);
  // (a) reaches the WSB region: with-Sun apogee is well past the 1.4M km
  // target apogee (the Sun's perturbation actually redirects the trajectory,
  // it doesn't just coast to a clean apogee) — measured 4.676M km.
  ok('N2 BLT: with-Sun trajectory reaches the WSB region (apogee > 1.5M km)', blt.apoWithSunMkm > 1.5);
  // (b) Sun perturbation is material: measured with-Sun energy = +0.3458
  // km^2/s^2 (UNBOUND — escapes Earth) vs no-Sun energy = -0.3631 km^2/s^2
  // (bound ellipse, returns to periAfter ~2,554 km). This theta=0 case is a
  // genuine WSB-class result: the Sun's third-body perturbation flips the
  // orbit from bound to escape, which is exactly the physical effect a BLT
  // substrate needs to be able to represent.
  ok('N2 BLT: Sun materially changes post-apogee energy (delta > 0.5 km^2/s^2)',
    Math.abs(blt.energyWithSun - blt.energyNoSun) > 0.5);
  ok('N2 BLT: with-Sun energy is positive (escape) at this seed/theta — real WSB behavior', blt.energyWithSun > 0);
  ok('N2 BLT: no-Sun energy is negative (bound ellipse) at the identical seed', blt.energyNoSun < 0);
  // (c) no truncation/rejection: both legs ran to the full requested TOF and
  // took a finite, sane number of integrator steps.
  ok('N2 BLT: with-Sun leg reaches full TOF (no early truncation)', blt.tFokA);
  ok('N2 BLT: no-Sun leg reaches full TOF (no early truncation)', blt.tFokB);
  ok('N2 BLT: step counts are finite and sane (no runaway/rejection)',
    blt.stepsA > 0 && blt.stepsA < 4e6 && blt.stepsB > 0 && blt.stepsB < 4e6);
}

{
  // §17 N3 — switchable reference frames (574's _trajFrameBasisAt /
  // _trajFrameTransform). Pure rendering transform; no physics/mission-log
  // consequence. See MATH.md §7x for the formula and the az-convention note.
  const n3 = vm.runInContext(`(function(){
    const t0 = 0, t1 = 200000, t2 = 450000; // arbitrary epochs across a week-ish span
    const pRel = [12345.6, -6789.1, 234.5];

    // (1) inertial === identity, EXACTLY (no float drift — the whole point of
    // the null-basis short-circuit / zero-overhead-when-selected requirement).
    const idOut = _trajFrameTransform('inertial', 'Earth', pRel, t1);
    const idExact = idOut[0] === pRel[0] && idOut[1] === pRel[1] && idOut[2] === pRel[2];

    // (2) EM-rotating: the MOON's own position relative to EARTH, transformed
    // sample-at-its-own-epoch across a week of epochs, has a FIXED direction
    // (exact by construction: the frame's x-axis IS defined as the
    // Earth->Moon direction at that same epoch) and a magnitude within the
    // real Earth-Moon distance range (~356k-407k km, eccentricity ~10%).
    const epochs = [];
    for (let k = 0; k < 8; k++) epochs.push(k * 86400 * 1); // 8 days, 1/day
    const emSamples = epochs.map(t => {
      const e = physBodyStateAt('Earth', t), m = physBodyStateAt('Moon', t);
      const pRelMoon = [e.r[0] - m.r[0], e.r[1] - m.r[1], e.r[2] - m.r[2]].map(v => -v); // Moon rel Earth
      const fc = _trajFrameTransform('earth-moon-rotating', 'Earth', pRelMoon, t);
      return { fc, mag: Math.hypot(fc[0], fc[1], fc[2]) };
    });
    let maxAngleRad = 0, minMag = Infinity, maxMag = -Infinity;
    emSamples.forEach(s => {
      const dirAngle = Math.atan2(s.fc[1], s.fc[0]); // should be ~0 (along +x) every time
      const zAngle = Math.atan2(s.fc[2], s.fc[0]);
      maxAngleRad = Math.max(maxAngleRad, Math.abs(dirAngle), Math.abs(zAngle));
      minMag = Math.min(minMag, s.mag); maxMag = Math.max(maxMag, s.mag);
    });

    // (3) magnitude preservation: a rotation never distorts vector length —
    // true for EVERY frame kind at ANY epoch (the honest replacement for a
    // literal "t===viewT => identity" claim, which only holds for inertial —
    // see MATH.md §7x critique).
    const magIn = Math.hypot(pRel[0], pRel[1], pRel[2]);
    const kinds = ['body-fixed', 'earth-moon-rotating', 'sun-earth-rotating'];
    let magOk = true;
    kinds.forEach(k => {
      [t0, t1, t2].forEach(t => {
        const q = _trajFrameTransform(k, 'Earth', pRel, t);
        const magOut = Math.hypot(q[0], q[1], q[2]);
        if (Math.abs(magOut - magIn) > 1e-6) magOk = false;
      });
    });

    // (4) basis orthonormality across epochs (EM + sun-earth), several t.
    let orthoOk = true;
    ['earth-moon-rotating', 'sun-earth-rotating'].forEach(k => {
      [t0, t1, t2].forEach(t => {
        const B = _trajFrameBasisAt(k, 'Earth', t);
        const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
        const mag = a => Math.hypot(a[0], a[1], a[2]);
        if (Math.abs(mag(B.xh) - 1) > 1e-9 || Math.abs(mag(B.yh) - 1) > 1e-9 || Math.abs(mag(B.zh) - 1) > 1e-9) orthoOk = false;
        if (Math.abs(dot(B.xh, B.yh)) > 1e-9 || Math.abs(dot(B.xh, B.zh)) > 1e-9 || Math.abs(dot(B.yh, B.zh)) > 1e-9) orthoOk = false;
      });
    });

    // (5) NRHO closure improvement: transform the RAW propagated NRHO loop's
    // samples (refOrbitSamplePropagatedRaw, un-rebased) into the EM frame,
    // each at its OWN epoch — the endpoints (t=0 and t=period) should land
    // close to the measured 345.6 km rotating-frame closure (MATH.md §7v),
    // NOT the ~27,000 km inertial gap the same raw loop shows un-transformed.
    const raw = refOrbitSamplePropagatedRaw('nrho-nominal', 96);
    const first = raw[0], last = raw[raw.length - 1];
    const fcFirst = _trajFrameTransform('earth-moon-rotating', 'Moon', first.r, first.t);
    const fcLast = _trajFrameTransform('earth-moon-rotating', 'Moon', last.r, last.t);
    const closureKm = Math.hypot(fcFirst[0]-fcLast[0], fcFirst[1]-fcLast[1], fcFirst[2]-fcLast[2]);
    const rawInertialGapKm = Math.hypot(first.r[0]-last.r[0], first.r[1]-last.r[1], first.r[2]-last.r[2]);

    return { idExact, maxAngleRad, minMag, maxMag, magOk, orthoOk, closureKm, rawInertialGapKm, nRaw: raw.length };
  })()`, sandbox);
  ok('N3: inertial frame transform is EXACT identity (zero-overhead path)', n3.idExact);
  ok(`N3: EM-rotating — Moon direction fixed to <1e-6 rad across a week (measured ${n3.maxAngleRad.toExponential(3)})`, n3.maxAngleRad < 1e-6);
  ok(`N3: EM-rotating — Moon magnitude stays in the real Earth-Moon range (measured ${n3.minMag.toFixed(0)}-${n3.maxMag.toFixed(0)} km)`,
    n3.minMag > 350000 && n3.maxMag < 410000);
  ok('N3: frame transform preserves vector magnitude (pure rotation) at every epoch/kind', n3.magOk);
  ok('N3: earth-moon-rotating / sun-earth-rotating bases are orthonormal across epochs', n3.orthoOk);
  ok(`N3: NRHO raw-sample count sane (${n3.nRaw})`, n3.nRaw > 50);
  ok(`N3: NRHO ring closes live in the EM frame near the measured 345.6 km pin (got ${n3.closureKm.toFixed(1)} km)`,
    n3.closureKm < 500);
  ok(`N3: same raw loop's INERTIAL gap is the large ~27,000 km figure (got ${n3.rawInertialGapKm.toFixed(0)} km) — confirms the frame transform, not raw propagation, is what closes it`,
    n3.rawInertialGapKm > 10000);
}

  return counts();
};
