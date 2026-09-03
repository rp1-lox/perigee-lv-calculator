'use strict';
// Auto-split from the former monolithic tests/math.test.js (see tests/harness.js
// for the shared vm-sandbox loader + assertion helpers). Content below is
// relocated byte-for-byte from the original section of the same name; see
// docs/dev_notes.md "Test suite layout" for how to add a new suite.
//
// Suite: C1 frame-boundary gate, C2 canonical orbit (orbitNormalize), C3 launchOrbit-triplication migration pins, C4 atomic S1.5 carriage migration, REALITY ANCHOR Moon-plane-vs-standstill-calendar pins
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { buildSandbox, makeAssertions, ROOT } = require('../harness');

module.exports = function run() {
  const sandbox = buildSandbox();
  const { ok, approx, counts } = makeAssertions();

const {
  archGet, archAddNode, archRemoveNode, archAddEdge, archRemoveEdge,
  archUndoCapture, archUndo, archRedo, archUndoReset,
  archUpdateNode, archMoveNode, archNodeDetachRef,
  archEdgeDv, archComputeBudget, _nmDvPhysics,
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
  _missionMigrateOrbitFieldNames, _missionMigrateNodeMapCustomNodes,
  _missionPlaneMatchTargetSpec, _archMapContentHTML, _archCustomNodeForArchNode,
  _missionCreateCustomNode, _missionCustomNodes, _archOrbitToNmOrbit,
  missionRunChecks, missionGetChecks,
} = sandbox;
// PHYS_THRUST_REVS_RESOLUTION is a module-scope `const` (not a `function`
// declaration), so it isn't a sandbox-global property — pull it via
// vm.runInContext like the other module-scope consts (orientation map).
const PHYS_THRUST_REVS_RESOLUTION = vm.runInContext('PHYS_THRUST_REVS_RESOLUTION', sandbox);
const { G0, MU, RE, OMEGA_E, PROG_BODIES, PROG_HELIO_R, PROG_MU_SUN, PROG_MOON_ORBITS, PROG_BODY_ELEMENTS, PROG_MOON_ELEMENTS, PROG_DEFAULT_EPOCH_JD, PROG_J2000_JD, PROG_AU_KM, PROG_BODY_POLES } =
  vm.runInContext('({ G0, MU, RE, OMEGA_E, PROG_BODIES, PROG_HELIO_R, PROG_MU_SUN, PROG_MOON_ORBITS, PROG_BODY_ELEMENTS, PROG_MOON_ELEMENTS, PROG_DEFAULT_EPOCH_JD, PROG_J2000_JD, PROG_AU_KM, PROG_BODY_POLES })', sandbox);
// ═══════════════════════════════════════════════════════════════════════════
// C1 frame-boundary gate (MISSION_MODEL_V2.md §24, UNIFICATION_AUDIT item 1)
//
// Guards the bug class C1 retired: an inline "progEqToWorldElements + typeof
// guard" at a new call site silently skipping the eq->world seam (five
// shipped bugs in one week were this exact disease). Every orbit-shaped
// consumer must now go through the ONE boundary (orbitWorldElements /
// orbitWorldState, 385-physics-core.js) instead of calling
// progEqToWorldElements directly. Source-grep style mirrors the ghost-stage
// guard above: read every src/js/*.js module as TEXT and assert no module
// outside the allowed-callers list contains a direct call.
// ═══════════════════════════════════════════════════════════════════════════
{
  const JS_DIR = path.join(ROOT, 'src', 'js');
  const allJsFiles = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  // Allowed direct callers of progEqToWorldElements: the boundary's own
  // module (385, where orbitWorldElements/orbitWorldState live and
  // progEqToWorldElements/progWorldToEqElements are defined).
  const ALLOWED_EQ_TO_WORLD = new Set(['385-physics-core.js']);
  // progWorldToEqElements (the INVERSE direction) is exempt everywhere: C1
  // only puts a boundary on the eq->world AUTHORING direction. 415's use is
  // the one non-385 caller today (see the C1 NOTE comment at its call site)
  // — kept as an explicit allowed-callers list per the spec rather than a
  // blanket exemption, so a new inverse-direction call site still shows up
  // for review.
  const ALLOWED_WORLD_TO_EQ = new Set(['385-physics-core.js', '415-launch-planner.js']);
  const violations = [];
  allJsFiles.forEach(f => {
    const text = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    if (/\bprogEqToWorldElements\s*\(/.test(text) && !ALLOWED_EQ_TO_WORLD.has(f)) violations.push(f + ' calls progEqToWorldElements(');
    if (/\bprogWorldToEqElements\s*\(/.test(text) && !ALLOWED_WORLD_TO_EQ.has(f)) violations.push(f + ' calls progWorldToEqElements(');
  });
  ok('C1 gate: no module outside the allowed-callers list calls progEqToWorldElements/progWorldToEqElements directly' +
     (violations.length ? ' — VIOLATIONS: ' + violations.join('; ') : ''), violations.length === 0);
}

// orbitWorldElements unit pins (385-physics-core.js)
{
  ok('orbitWorldElements: frame:"world" is identity', (() => {
    const w = orbitWorldElements({ body: 'Earth', inc_deg: 51.6, lan_deg: 200, frame: 'world' });
    return w.incDeg === 51.6 && w.lanDeg === 200;
  })());
  ok('orbitWorldElements: frame:"eq" matches progEqToWorldElements output exactly', (() => {
    const direct = progEqToWorldElements('Earth', 28.5, 60);
    const w = orbitWorldElements({ body: 'Earth', inc_deg: 28.5, lan_deg: 60, frame: 'eq' });
    return w.incDeg === direct.inc_deg && w.lanDeg === direct.lan_deg;
  })());
  ok('orbitWorldElements: missing frame defaults to "eq" (matches an explicit frame:"eq" call)', (() => {
    const tagged = orbitWorldElements({ body: 'Moon', inclination: 90, lan: 40, frame: 'eq' });
    const untagged = orbitWorldElements({ body: 'Moon', inclination: 90, lan: 40 });
    return tagged.incDeg === untagged.incDeg && tagged.lanDeg === untagged.lanDeg;
  })());
}

// ═══════════════════════════════════════════════════════════════════════════
// C2 canonical orbit — orbitNormalize + helpers (384-orbit-canonical.js)
// (MISSION_MODEL_V2.md §24 C2, UNIFICATION_AUDIT item 2)
// ═══════════════════════════════════════════════════════════════════════════
{
  // Every dialect for the SAME orbit (LEO 185×420 @ 51.6° eq, Ω 60) must
  // normalize to one identical canonical record.
  const expected = { body: 'Earth', periKm: 185, apoKm: 420, incDeg: 51.6, lanDeg: 60, frame: 'eq' };
  const eq = (c) => c && c.body === expected.body && c.periKm === expected.periKm &&
    c.apoKm === expected.apoKm && c.incDeg === expected.incDeg && c.lanDeg === expected.lanDeg &&
    c.frame === expected.frame && c.argpDeg === undefined;
  ok('orbitNormalize: event dialect (alt_km/apo_km/inc_deg/lan_deg)',
    eq(orbitNormalize({ body: 'Earth', alt_km: 185, apo_km: 420, inc_deg: 51.6, lan_deg: 60 })));
  ok('orbitNormalize: node-map/catalog dialect (perigee/apogee/inclination/lan)',
    eq(orbitNormalize({ body: 'Earth', perigee: 185, apogee: 420, inclination: 51.6, lan: 60 })));
  ok('orbitNormalize: refOrbitResolve dialect (peri/apo/inc/lan)',
    eq(orbitNormalize({ body: 'Earth', peri: 185, apo: 420, inc: 51.6, lan: 60 })));
  ok('orbitNormalize: idempotent passthrough of a canonical record',
    eq(orbitNormalize({ body: 'Earth', periKm: 185, apoKm: 420, incDeg: 51.6, lanDeg: 60, frame: 'eq' })));
  ok('orbitNormalize: idempotence (normalize(normalize(x)) === normalize(x))', (() => {
    const a = orbitNormalize({ body: 'Earth', alt_km: 185, apo_km: 420, inc_deg: 51.6, lan_deg: 60 });
    const b = orbitNormalize(a);
    return JSON.stringify(a) === JSON.stringify(b);
  })());
  ok('orbitNormalize: ambiguity — canonical key wins over legacy alias', (() => {
    const c = orbitNormalize({ body: 'Earth', periKm: 200, alt_km: 999, apoKm: 300, apogee: 888, incDeg: 10, inclination: 77, lanDeg: 5, lan: 44 });
    return c.periKm === 200 && c.apoKm === 300 && c.incDeg === 10 && c.lanDeg === 5;
  })());
  ok('orbitNormalize: circular fill — single radius mirrors to both', (() => {
    const c = orbitNormalize({ body: 'Earth', alt_km: 185, inc_deg: 28.5 });
    return c.periKm === 185 && c.apoKm === 185;
  })());
  ok('orbitNormalize: argpDeg emitted only when input carries argp', (() => {
    const withArgp = orbitNormalize({ body: 'Earth', peri: 185, apo: 420, inc: 28.5, argp: 90 });
    const without = orbitNormalize({ body: 'Earth', peri: 185, apo: 420, inc: 28.5 });
    return withArgp.argpDeg === 90 && without.argpDeg === undefined;
  })());
  ok('orbitNormalize: frame:"world" preserved', orbitNormalize({ body: 'Moon', perigee: 100, apogee: 100, inclination: 90, frame: 'world' }).frame === 'world');
  ok('orbitNormalize: propagated orbit -> null (no Keplerian form)',
    orbitNormalize({ body: 'Moon', kind: 'propagated', seedState: {} }) === null &&
    orbitNormalize({ body: 'Moon', propagated: true, r: [1, 0, 0], v: [0, 1, 0] }) === null);
  ok('orbitNormalize: surface (pre-orbit) state -> null',
    orbitNormalize({ body: 'Earth', surface: true }) === null);

  // orbitMeanRadiusKm vs the inline idiom it replaces.
  ok('orbitMeanRadiusKm: matches R + (peri+apo)/2', (() => {
    const R = PROG_BODIES.Earth.R;
    return orbitMeanRadiusKm({ perigee: 185, apogee: 420, body: 'Earth' }, R) === R + (185 + 420) / 2;
  })());
  ok('orbitMeanRadiusKm: null for propagated', orbitMeanRadiusKm({ propagated: true, body: 'Moon' }, PROG_BODIES.Moon.R) === null);

  // orbitPeriodS vs a hand-computed Kepler period.
  ok('orbitPeriodS: matches 2π√(a³/μ) hand computation', (() => {
    const R = PROG_BODIES.Earth.R, mu = PROG_BODIES.Earth.mu;
    const a = R + (185 + 420) / 2;
    const hand = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
    return orbitPeriodS({ perigee: 185, apogee: 420, body: 'Earth' }, mu) === hand;
  })());

  // orbitWorldNormal vs the hand recipe [sin i·sin Ω, −sin i·cos Ω, cos i]
  // applied to the C1 world-frame elements.
  ok('orbitWorldNormal: matches the hand recipe applied to world elements', (() => {
    const o = { body: 'Moon', perigee: 100, apogee: 100, inclination: 96.68, lan: 20 };
    const w = orbitWorldElements(o);
    const iR = w.incDeg * Math.PI / 180, LR = w.lanDeg * Math.PI / 180;
    const hand = [Math.sin(LR) * Math.sin(iR), -Math.cos(LR) * Math.sin(iR), Math.cos(iR)];
    const n = orbitWorldNormal(o);
    return n && Math.abs(n[0] - hand[0]) < 1e-12 && Math.abs(n[1] - hand[1]) < 1e-12 && Math.abs(n[2] - hand[2]) < 1e-12;
  })());
  ok('orbitWorldNormal: null for propagated', orbitWorldNormal({ propagated: true, body: 'Moon' }) === null);
}

// ═══════════════════════════════════════════════════════════════════════════
// C3 (launchOrbit triplication collapse) — load-time migration pins
// ═══════════════════════════════════════════════════════════════════════════

ok('_missionMigrateLaunchOrbitEntry: both present -> orbit wins, launchOrbit deleted', (() => {
  const e = { type: 'LAUNCH', orbit: { body: 'Earth', periKm: 185 }, launchOrbit: { body: 'Earth', alt_km: 999 } };
  _missionMigrateLaunchOrbitEntry(e);
  return e.orbit.periKm === 185 && !('launchOrbit' in e);
})());

ok('_missionMigrateLaunchOrbitEntry: launchOrbit-only -> copied into orbit, then deleted', (() => {
  const e = { type: 'LAUNCH', launchOrbit: { body: 'Earth', alt_km: 185, inc_deg: 28.5 } };
  _missionMigrateLaunchOrbitEntry(e);
  return e.orbit && e.orbit.periKm === 185 && e.orbit.incDeg === 28.5 && !('launchOrbit' in e);
})());

ok('_missionMigrateLaunchOrbitEntry: already-canonical orbit, no launchOrbit -> untouched', (() => {
  const e = { type: 'LAUNCH', orbit: { body: 'Earth', periKm: 185 } };
  const before = JSON.stringify(e);
  _missionMigrateLaunchOrbitEntry(e);
  return JSON.stringify(e) === before;
})());

ok('_missionMigrateLaunchOrbitEntry: non-LAUNCH entry with legacy launchOrbit still migrates (defensive, dialect-agnostic)', (() => {
  const e = { type: 'DEPLOY', launchOrbit: { body: 'Earth', alt_km: 400 } };
  _missionMigrateLaunchOrbitEntry(e);
  return e.orbit && e.orbit.periKm === 400 && !('launchOrbit' in e);
})());

ok('_missionMigrateLaunchOrbitLog: migrates every entry in a mission log', (() => {
  const m = { log: [
    { type: 'LAUNCH', launchOrbit: { body: 'Earth', alt_km: 185 } },
    { type: 'MANEUVER', foo: 1 },
    { type: 'DEPLOY', orbit: { body: 'Earth', periKm: 400 }, launchOrbit: { body: 'Earth', alt_km: 401 } },
  ] };
  _missionMigrateLaunchOrbitLog(m);
  return m.log[0].orbit.periKm === 185 && !('launchOrbit' in m.log[0]) &&
    m.log[1].foo === 1 &&
    m.log[2].orbit.periKm === 400 && !('launchOrbit' in m.log[2]);
})());

// C2b (event-orbit dialect rename): the SAME migration also field-renames a
// legacy-shaped e.orbit (alt_km/apo_km/inc_deg/lan_deg) to canonical
// (periKm/apoKm/incDeg/lanDeg) in place, so old autosaves/.program files with
// no launchOrbit at all (already past C3) still land on canonical field names.
ok('_missionMigrateLaunchOrbitEntry: legacy-shaped e.orbit field-renamed to canonical', (() => {
  const e = { type: 'LAUNCH', orbit: { body: 'Earth', alt_km: 185, apo_km: 220, inc_deg: 51.6, lan_deg: 30 } };
  _missionMigrateLaunchOrbitEntry(e);
  return e.orbit.periKm === 185 && e.orbit.apoKm === 220 && e.orbit.incDeg === 51.6 && e.orbit.lanDeg === 30 &&
    !('alt_km' in e.orbit) && !('apo_km' in e.orbit) && !('inc_deg' in e.orbit) && !('lan_deg' in e.orbit);
})());

// C2b item 1 (m.launchOrbit seed-default rename): the log migration ALSO
// field-renames a legacy-shaped m.launchOrbit (alt_km/apo_km/inc_deg/lan_deg)
// to canonical (periKm/apoKm/incDeg/lanDeg) in place, so old blobs feed the
// launch-orbit UI / draft builders canonical field names.
ok('_missionMigrateLaunchOrbitLog: legacy m.launchOrbit field-renamed to canonical', (() => {
  const m = { log: [], launchOrbit: { body: 'Earth', alt_km: 185, apo_km: 220, inc_deg: 51.6, lan_deg: 30 } };
  _missionMigrateLaunchOrbitLog(m);
  return m.launchOrbit.periKm === 185 && m.launchOrbit.apoKm === 220 && m.launchOrbit.incDeg === 51.6 && m.launchOrbit.lanDeg === 30 &&
    !('alt_km' in m.launchOrbit) && !('apo_km' in m.launchOrbit) && !('inc_deg' in m.launchOrbit) && !('lan_deg' in m.launchOrbit);
})());

// C2b item-3 (node-map + orbitAtBurn dialect rename): the shared
// _missionMigrateOrbitFieldNames now ALSO absorbs the node-map dialect
// (perigee/apogee/inclination/lan) so legacy custom nodes + orbitAtBurn blobs
// land on canonical field names.
ok('_missionMigrateOrbitFieldNames: node-map dialect (perigee/apogee/inclination/lan) -> canonical', (() => {
  const o = { type: 'circular', body: 'Moon', perigee: 100, apogee: 200, inclination: 90, lan: 40, argp_deg: 12 };
  _missionMigrateOrbitFieldNames(o);
  return o.periKm === 100 && o.apoKm === 200 && o.incDeg === 90 && o.lanDeg === 40 && o.argpDeg === 12 &&
    o.type === 'circular' && o.body === 'Moon' &&
    !('perigee' in o) && !('apogee' in o) && !('inclination' in o) && !('lan' in o) && !('argp_deg' in o);
})());

ok('_missionMigrateLaunchOrbitEntry: legacy e.orbitAtBurn (node-map dialect + state fields) -> canonical, non-element fields preserved', (() => {
  const e = { type: 'MNODE', orbitAtBurn: { body: 'Earth', perigee: 185, apogee: 185, inclination: 28.5, lan: 45, lan_deg: 45, surface: false, frame: 'Earth' } };
  _missionMigrateLaunchOrbitEntry(e);
  const o = e.orbitAtBurn;
  return o.periKm === 185 && o.apoKm === 185 && o.incDeg === 28.5 && o.lanDeg === 45 &&
    o.body === 'Earth' && o.surface === false && o.frame === 'Earth' &&
    !('perigee' in o) && !('apogee' in o) && !('inclination' in o) && !('lan' in o) && !('lan_deg' in o);
})());

ok('_missionMigrateNodeMapCustomNodes: legacy custom-node .orbit field-renamed to canonical', (() => {
  const prog = { nodeMapCustomNodes: [
    { nodeId: 'c1', orbit: { type: 'circular', body: 'Earth', perigee: 400, apogee: 400, inclination: 51.6 } },
    { nodeId: 'c2', orbit: { type: 'escape', body: 'Earth', c3: 0.1 } },
  ] };
  _missionMigrateNodeMapCustomNodes(prog);
  const a = prog.nodeMapCustomNodes[0].orbit, b = prog.nodeMapCustomNodes[1].orbit;
  return a.periKm === 400 && a.apoKm === 400 && a.incDeg === 51.6 && !('perigee' in a) && !('inclination' in a) &&
    b.type === 'escape' && b.c3 === 0.1;   // escape node: no element fields to touch
})());

// ═══════════════════════════════════════════════════════════════════════════
// C4 — atomic S1.5 (stage-and-a-half) carriage (MISSION_MODEL_V2.md §24 C4,
// UNIFICATION_AUDIT item 4)
//
// The s15 sextet (the `s15` flag + s15_sust_thrust/s15_sust_isp/s15_jet_mass/
// s15_beco_twr/s15_boost_isp) was copied field-by-field at each assembler and
// has shipped the same drop bug 3x. stageCarryS15/stageClearS15/stagePickS15
// (140-physics.js) are now the ONE sanctioned way to move it between stage
// records. Gate: no module writes an s15_* field via dot-assignment
// (`obj.s15_xxx = ...`) outside 140-physics.js — that is exactly the
// field-by-field copy pattern that shipped the bug. (Object-literal
// `s15_xxx: value` construction from fresh DOM input, or the splitter's
// read-only `s.s15_xxx`, are unaffected — those aren't stage-to-stage
// carriage.)
// ═══════════════════════════════════════════════════════════════════════════
{
  const JS_DIR = path.join(ROOT, 'src', 'js');
  const allJsFiles = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  const ALLOWED_S15_DOT_ASSIGN = new Set(['140-physics.js']);
  const dotAssignRe = /\.s15_\w+\s*=(?!=)/;
  const violations = [];
  allJsFiles.forEach(f => {
    if (ALLOWED_S15_DOT_ASSIGN.has(f)) return;
    const text = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    if (dotAssignRe.test(text)) violations.push(f);
  });
  ok('C4 gate: no module outside 140-physics.js dot-assigns an s15_* field (must route through stageCarryS15/stageClearS15)' +
     (violations.length ? ' — VIOLATIONS: ' + violations.join('; ') : ''), violations.length === 0);
}

// stageCarryS15 / stageClearS15 / stagePickS15 unit pins: the carriage
// helper must move the flag + ALL 5 sextet fields atomically, clear all of
// them atomically, and read them off without mutating the source.
{
  const full = { dry: 100, prop: 900, thrust: 500, isp: 300, res: 2,
    s15: true, s15_sust_thrust: 270, s15_sust_isp: 309, s15_jet_mass: 1800, s15_beco_twr: 0.5, s15_boost_isp: 282 };
  ok('stageCarryS15: carries the flag + all 5 sextet fields atomically', (() => {
    const dst = { dry: 100, prop: 900, thrust: 500, isp: 300, res: 2 };
    stageCarryS15(dst, full);
    return dst.s15 === true && dst.s15_sust_thrust === 270 && dst.s15_sust_isp === 309 &&
      dst.s15_jet_mass === 1800 && dst.s15_beco_twr === 0.5 && dst.s15_boost_isp === 282;
  })());
  ok('stageCarryS15: no-op (dst untouched) when src has no s15 data', (() => {
    const dst = { dry: 1, s15: true, s15_sust_thrust: 999 };
    stageCarryS15(dst, { dry: 2 });
    return dst.s15 === true && dst.s15_sust_thrust === 999;
  })());
  ok('stageClearS15: removes the flag + all 5 sextet fields', (() => {
    const dst = { ...full };
    stageClearS15(dst);
    return !('s15' in dst) && !('s15_sust_thrust' in dst) && !('s15_sust_isp' in dst) &&
      !('s15_jet_mass' in dst) && !('s15_beco_twr' in dst) && !('s15_boost_isp' in dst) && dst.dry === 100;
  })());
  ok('stagePickS15: returns the flag + sextet without mutating src, null when absent', (() => {
    const picked = stagePickS15(full);
    const noS15 = stagePickS15({ dry: 1 });
    return picked && picked.s15 === true && picked.s15_sust_thrust === 270 && picked.s15_boost_isp === 282 &&
      full.dry === 100 && noS15 === null;
  })());
}

// ═══════════════════════════════════════════════════════════════════════════
// C5 — ONE S1.5 BECO expansion boundary (UNIFICATION_AUDIT P2.1)
//
// calculateWithS15 (150), _fleetExpandStages (560), and _tsExpandStages (165)
// used to each hand-roll their own stage-iteration + _s15BecoSplit call with
// DIVERGENT output records and error policies — the exact bug class CLAUDE.md
// flags as "shipped 3x". stageExpandS15 (140-physics.js) is now the ONE
// boundary; gate: no module outside 140-physics.js may call `_s15BecoSplit`
// directly (that is precisely the reimplementation pattern that shipped the
// bug 3 times).
// ═══════════════════════════════════════════════════════════════════════════
{
  const JS_DIR = path.join(ROOT, 'src', 'js');
  const allJsFiles = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  const ALLOWED_S15_SPLIT_CALL = new Set(['140-physics.js']);
  const splitCallRe = /\b_s15BecoSplit\s*\(/;
  const violations = [];
  allJsFiles.forEach(f => {
    if (ALLOWED_S15_SPLIT_CALL.has(f)) return;
    const text = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    if (splitCallRe.test(text)) violations.push(f);
  });
  ok('C5 gate: no module outside 140-physics.js calls _s15BecoSplit directly (must route through stageExpandS15)' +
     (violations.length ? ' — VIOLATIONS: ' + violations.join('; ') : ''), violations.length === 0);
}

// stageExpandS15 error-policy pins: 'throw' aborts with stageIndex/s15Error
// set (calculateWithS15's abort-and-render behavior); 'annotate' pushes the
// raw unsplit stage decorated with _err and keeps going (_fleetExpandStages'
// and now _tsExpandStages' behavior — the latter used to silently drop the
// error and fall back with NO annotation, which is the policy retired here).
{
  const badStage = { dry: 5000, prop: 40000, thrust: 2000, isp: 300, res: 2,
    s15: true, s15_sust_thrust: 0, s15_sust_isp: 309, s15_jet_mass: 3000, s15_beco_twr: 1.2 };
  const goodStage = { dry: 5657, prop: 90000, thrust: 1800, isp: 282, res: 2,
    s15: true, s15_sust_thrust: 362, s15_sust_isp: 309, s15_jet_mass: 3050, s15_beco_twr: 1.2 };
  const plainStage = { dry: 4000, prop: 90000, thrust: 900, isp: 421, res: 2 };

  ok("stageExpandS15: onError:'throw' (default) throws with .stageIndex/.s15Error on a bad S1.5 stage", (() => {
    try { stageExpandS15([badStage]); return false; }
    catch (e) { return e.stageIndex === 0 && typeof e.s15Error === 'string' && e.s15Error.length > 0; }
  })());
  ok("stageExpandS15: onError:'annotate' does not throw on a bad S1.5 stage — pushes one raw record with _err", (() => {
    const out = stageExpandS15([badStage], { onError: 'annotate' });
    return out.length === 1 && out[0]._src === 0 && typeof out[0]._err === 'string' && !('_phase' in out[0]);
  })());
  ok('stageExpandS15: a valid S1.5 stage always splits into 2 records (Ph.1/Ph.2) regardless of onError', (() => {
    const outThrow = stageExpandS15([goodStage], { onError: 'throw' });
    const outAnnotate = stageExpandS15([goodStage], { onError: 'annotate' });
    return outThrow.length === 2 && outThrow[0]._phase === 'Ph.1' && outThrow[1]._phase === 'Ph.2' &&
      outAnnotate.length === 2 && outAnnotate[0]._phase === 'Ph.1' && outAnnotate[1]._phase === 'Ph.2';
  })());
  ok('stageExpandS15: a non-s15 stage passes through as one record, _src set, no _phase/_err', (() => {
    const out = stageExpandS15([plainStage]);
    return out.length === 1 && out[0]._src === 0 && !('_phase' in out[0]) && !('_err' in out[0]) &&
      out[0].dry === plainStage.dry && out[0].prop === plainStage.prop;
  })());
  ok('stageExpandS15: mixed stage array — index math (_src) stays correct across a split', (() => {
    const out = stageExpandS15([goodStage, plainStage], { onError: 'annotate' });
    return out.length === 3 && out[0]._src === 0 && out[1]._src === 0 && out[2]._src === 1;
  })());
}

// ═══════════════════════════════════════════════════════════════════════════
// REALITY ANCHOR — Moon plane inclination-to-equator vs the standstill calendar
// (MATH.md critique 120, 2026-07-18)
// ═══════════════════════════════════════════════════════════════════════════
// The lesson of the mirrored-pole bug: every SELF-consistency check passed
// while the whole obliquity seam was reflected — only an EXTERNAL truth anchor
// caught it. These pins are that anchor. The Moon's inclination TO EARTH'S
// EQUATOR oscillates ~18.3-28.6° over the 18.6-yr nodal cycle: it is ~28.6° at
// a MAJOR standstill (Moon's node aligned so ecliptic-inclination ~5.15° ADDS
// to the 23.44° obliquity) and ~18.3° at a MINOR standstill (subtracts). The
// pre-fix (mirrored-pole) app read these PHASE-INVERTED — 18.3° in 1969 (when
// Apollo's near-coplanar ~28.6° launches prove the true figure was 28.6°) and
// 28.6° at the 2015 minor standstill. Threaded exactly as the app threads it:
// PROG_ACTIVE_PROGRAM.epochJD carries the epoch, progMoonPlaneAt's epochJD
// argument (now LIVE — it folds (epochJD - globalEpoch) into the MET, see
// 415-launch-planner.js / critique 120) agrees. Both are set here so the pin
// guards both threading paths.
{
  const _savedActive = sandbox.PROG_ACTIVE_PROGRAM;
  const moonIncAt = (jd) => {
    sandbox.PROG_ACTIVE_PROGRAM = { epochJD: jd };
    return progMoonPlaneAt(jd, 0).inc_deg;
  };
  // 1969-07-16 (Apollo 11 launch), a MAJOR standstill -> ~28.6° (Apollo anchor).
  const inc1969 = moonIncAt(2440419.06);
  ok(`reality anchor: Moon inc-to-eq 1969-07-16 in [28.0,28.8] (Apollo major-standstill anchor) — got ${inc1969.toFixed(3)}`,
    inc1969 >= 28.0 && inc1969 <= 28.8);
  // 2015-06, a MINOR standstill -> ~18.3°.
  const inc2015 = moonIncAt(2457205);
  ok(`reality anchor: Moon inc-to-eq 2015-06 in [18.1,18.7] (minor standstill) — got ${inc2015.toFixed(3)}`,
    inc2015 >= 18.1 && inc2015 <= 18.7);
  // 2025-01, approaching a MAJOR standstill -> ~28.6°.
  const inc2025 = moonIncAt(2460680);
  ok(`reality anchor: Moon inc-to-eq 2025-01 in [28.0,28.8] — got ${inc2025.toFixed(3)}`,
    inc2025 >= 28.0 && inc2025 <= 28.8);
  // The exact component whose SIGN was wrong: Earth's north pole must point to
  // POSITIVE ecliptic-y (real north celestial pole ~ (0, +sin ε, cos ε)); the
  // mirrored pole had y = -sin ε < 0 (ecliptic longitude 270 instead of 90).
  const earthPole = physBodyPoleAt('Earth');
  ok(`reality anchor: Earth pole y-component > 0 (the sign that was mirrored) — got ${earthPole[1].toFixed(4)}`,
    earthPole[1] > 0);
  sandbox.PROG_ACTIVE_PROGRAM = _savedActive;
}

// ═══════════════════════════════════════════════════════════════════════════
// A1 — Architecture data model (600-architecture-model.js, MISSION_MODEL_V2.md
// §26). Data-model CRUD + own undo stack + persistence round-trip + legacy-
// blob guard. archGet()/archAddNode() etc. read/write PROG_ACTIVE_PROGRAM,
// which the harness sandbox doesn't otherwise define — set it fresh per block
// the same way the REALITY ANCHOR section above does.
// ═══════════════════════════════════════════════════════════════════════════
{
  // Deterministic ids for this block only (the harness's shared progUUID stub
  // returns one constant string, which is fine for suites that only ever add
  // one entity but not for cascade/edge tests here that need distinct ids).
  let _idCounter = 0;
  sandbox.progUUID = () => 'arch-test-' + (_idCounter++);

  const leo = { body: 'Earth', periKm: 185, apoKm: 185, incDeg: 28.5, lanDeg: 0 };
  const geo = { body: 'Earth', periKm: 35786, apoKm: 35786, incDeg: 0, lanDeg: 0 };

  // archGet(): lazy-creates an empty architecture on first access, in place.
  {
    sandbox.PROG_ACTIVE_PROGRAM = {};
    const arch = archGet();
    ok('archGet: lazily creates {nodes:[],edges:[]}', Array.isArray(arch.nodes) && arch.nodes.length === 0 && Array.isArray(arch.edges) && arch.edges.length === 0);
    ok('archGet: the created object is wired onto PROG_ACTIVE_PROGRAM.architecture (same reference on re-call)', archGet() === arch);
  }

  // archAddNode(): validates the orbit through orbitNormalize; rejects
  // propagated/surface orbits (v1 has no non-Keplerian nodes).
  {
    sandbox.PROG_ACTIVE_PROGRAM = {};
    const n = archAddNode({ name: 'LEO', body: 'Earth', orbit: leo });
    ok('archAddNode: returns a node with a canonical orbit + generated id', n && n.id && n.name === 'LEO' && n.orbit.periKm === 185 && n.orbit.incDeg === 28.5);
    ok('archAddNode: node lands in archGet().nodes', archGet().nodes.length === 1 && archGet().nodes[0].id === n.id);

    const rejected = archAddNode({ name: 'Bad', body: 'Earth', orbit: { body: 'Earth', propagated: true, r: [1, 0, 0], v: [0, 1, 0] } });
    ok('archAddNode: propagated orbit (no Keplerian form) is rejected -> null, no node added', rejected === null && archGet().nodes.length === 1);
  }

  // archRemoveNode(): removes the node AND cascades to any edge touching it.
  {
    sandbox.PROG_ACTIVE_PROGRAM = {};
    const a = archAddNode({ name: 'LEO', body: 'Earth', orbit: leo });
    const b = archAddNode({ name: 'GEO', body: 'Earth', orbit: geo });
    const e = archAddEdge(a.id, b.id);
    ok('archAddEdge: connects two existing nodes', e && e.fromId === a.id && e.toId === b.id);
    ok('archAddEdge: unknown endpoint -> null, no edge added', archAddEdge(a.id, 'nope') === null && archGet().edges.length === 1);

    const removed = archRemoveNode(a.id);
    ok('archRemoveNode: removes the node', removed === true && archGet().nodes.length === 1 && archGet().nodes[0].id === b.id);
    ok('archRemoveNode: cascades — the edge touching the removed node is also gone', archGet().edges.length === 0);

    // archRemoveEdge on an already-cascaded edge is a clean no-op (false).
    ok('archRemoveEdge: removing an already-gone edge id returns false', archRemoveEdge(e.id) === false);
  }

  // Undo/redo — own small stack, JSON-snapshot based.
  {
    sandbox.PROG_ACTIVE_PROGRAM = {};
    archUndoReset();
    const n = archAddNode({ name: 'LEO', body: 'Earth', orbit: leo });
    ok('undo: one node present after archAddNode', archGet().nodes.length === 1);
    const undone = archUndo();
    ok('archUndo: reverts to the pre-add (empty) state', undone === true && archGet().nodes.length === 0);
    const redone = archRedo();
    ok('archRedo: re-applies the add', redone === true && archGet().nodes.length === 1 && archGet().nodes[0].name === 'LEO');
    ok('archUndo: empty stack returns false (nothing left to undo after a fresh redo)', (() => {
      // stack has exactly the pre-add snapshot again after redo re-pushed it to undo;
      // undo it back to empty, then undo again should report false.
      archUndo();
      return archUndo() === false;
    })());
  }

  // Persistence round-trip: architecture rides inside PROG_ACTIVE_PROGRAM,
  // which buildProgramObject/applyProgramObject (450) already serialize
  // verbatim as `activeProgram` — simulate exactly that JSON round trip here
  // (no dedicated architecture save/load code exists, by design) and assert
  // nodes/edges/canonical orbit fields survive byte-for-byte.
  {
    sandbox.PROG_ACTIVE_PROGRAM = {};
    archAddNode({ name: 'LEO', body: 'Earth', orbit: leo });
    const b = archAddNode({ name: 'GEO', body: 'Earth', orbit: geo });
    const a = archGet().nodes[0];
    archAddEdge(a.id, b.id);
    const before = archGet();

    // round trip: exactly what buildProgramObject -> JSON.stringify (autosave/
    // .program export) -> JSON.parse -> applyProgramObject's
    // `PROG_ACTIVE_PROGRAM = obj.activeProgram` does to the whole object.
    const serialized = JSON.stringify({ activeProgram: sandbox.PROG_ACTIVE_PROGRAM });
    const restoredProgram = JSON.parse(serialized).activeProgram;
    sandbox.PROG_ACTIVE_PROGRAM = restoredProgram;
    const after = archGet();

    ok('persistence round-trip: node count survives', after.nodes.length === before.nodes.length && after.nodes.length === 2);
    ok('persistence round-trip: edge count survives', after.edges.length === before.edges.length && after.edges.length === 1);
    ok('persistence round-trip: canonical orbit fields survive on a node', after.nodes[1].orbit.periKm === 35786 && after.nodes[1].orbit.incDeg === 0 && after.nodes[1].orbit.frame === 'eq');
    ok('persistence round-trip: edge endpoints still reference the (re-hydrated) node ids', after.edges[0].fromId === after.nodes[0].id && after.edges[0].toId === after.nodes[1].id);
  }

  // Legacy-blob guard: a program object that predates the architecture field
  // (no .architecture key at all) must not crash and must NOT spuriously gain
  // an empty architecture until something actually asks for one via
  // archGet() — applying an old blob is purely `PROG_ACTIVE_PROGRAM =
  // obj.activeProgram` (450), which never calls archGet() itself.
  {
    const legacyBlob = { name: 'Old Program', pads: [] }; // no .architecture key — pre-A1 shape
    sandbox.PROG_ACTIVE_PROGRAM = legacyBlob; // mirrors applyProgramObject's direct assignment
    ok('legacy blob: no crash, architecture field absent until archGet() is called', !('architecture' in sandbox.PROG_ACTIVE_PROGRAM));
    const arch = archGet();
    ok('legacy blob: archGet() lazily creates an empty architecture on first access', Array.isArray(arch.nodes) && arch.nodes.length === 0 && Array.isArray(arch.edges) && arch.edges.length === 0);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // A2 — ladder rail CRUD extensions (archUpdateNode/archMoveNode/
  // archNodeDetachRef, 600-architecture-model.js). The rail UI itself
  // (605-architecture-page.js) is DOM-driven and not loaded into this
  // harness — these pins cover the model-side CRUD it calls.
  // ═══════════════════════════════════════════════════════════════════════
  {
    sandbox.PROG_ACTIVE_PROGRAM = {};
    archUndoReset();
    const a = archAddNode({ name: 'LEO', body: 'Earth', orbit: leo });
    const b = archAddNode({ name: 'GEO', body: 'Earth', orbit: geo });

    const updated = archUpdateNode(a.id, { name: 'LEO renamed', orbit: { body: 'Earth', periKm: 300, apoKm: 300, incDeg: 51.6, lanDeg: 0 } });
    ok('archUpdateNode: patches name + re-normalizes the orbit', updated && updated.name === 'LEO renamed' && updated.orbit.periKm === 300 && updated.orbit.incDeg === 51.6);
    ok('archUpdateNode: unknown id -> null, no crash', archUpdateNode('nope', { name: 'x' }) === null);

    const badPatch = archUpdateNode(a.id, { orbit: { body: 'Earth', propagated: true, r: [1, 0, 0], v: [0, 1, 0] } });
    ok('archUpdateNode: invalid (propagated) orbit patch rejected -> null, node unchanged', badPatch === null && archGet().nodes.find(n => n.id === a.id).orbit.periKm === 300);

    const boundNode = archAddNode({ name: 'GTO', body: 'Earth', orbit: geo, orbitRefId: 'geo' });
    ok('archAddNode: orbitRefId carries through when passed in spec', boundNode.orbitRefId === 'geo');
    const detached = archNodeDetachRef(boundNode.id);
    ok('archNodeDetachRef: clears orbitRefId (fork-on-edit), no undo-capture side effect on the stack top', detached === true && !('orbitRefId' in archGet().nodes.find(n => n.id === boundNode.id)));
    ok('archNodeDetachRef: already-unbound node -> false', archNodeDetachRef(boundNode.id) === false);
    const rebound = archUpdateNode(boundNode.id, { orbitRefId: 'geo' });
    ok('archUpdateNode: orbitRefId key present + truthy -> binds', rebound.orbitRefId === 'geo');
    const cleared = archUpdateNode(boundNode.id, { orbitRefId: null });
    ok('archUpdateNode: orbitRefId key present + null -> clears (deletes key)', !('orbitRefId' in cleared));

    // archMoveNode: [a, b, boundNode] -> move boundNode (idx 2) up to idx 1.
    ok('order before move', archGet().nodes.map(n => n.id).join(',') === [a.id, b.id, boundNode.id].join(','));
    const moved = archMoveNode(boundNode.id, -1);
    ok('archMoveNode: moves a node up one slot', moved === true && archGet().nodes.map(n => n.id).join(',') === [a.id, boundNode.id, b.id].join(','));
    ok('archMoveNode: cannot move the first node further up -> false, order unchanged', archMoveNode(a.id, -1) === false && archGet().nodes[0].id === a.id);
    ok('archMoveNode: cannot move the last node further down -> false', archMoveNode(b.id, 1) === false);
    ok('archMoveNode: unknown id -> false', archMoveNode('nope', 1) === false);

    // undo/redo: archUpdateNode and archMoveNode both went through archUndoCapture.
    const beforeUndoCount = archGet().nodes.length;
    ok('CRUD extensions participate in the same undo stack (archUndo reverts the last move)', archUndo() === true && archGet().nodes.map(n => n.id).join(',') === [a.id, b.id, boundNode.id].join(',') && archGet().nodes.length === beforeUndoCount);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // A3 — node-map edge dV + chain decomposition (610-architecture-map.js).
  // ACCOUNTING-IDENTITY GUARD: archEdgeDv() adapts canonical architecture
  // orbits into the node-map dialect and calls _nmDvPhysics directly (the
  // SAME pure function progNmComputeEdgeDv, 430, delegates to) — these pins
  // confirm the two paths agree byte-for-byte, and that a multi-term result's
  // `legs` breakdown sums back to the total (no silent double-counting or
  // dropped terms when 610 displays the chain).
  // ═══════════════════════════════════════════════════════════════════════
  {
    sandbox.PROG_ACTIVE_PROGRAM = {};
    archUndoReset();
    const leoNode = archAddNode({ name: 'LEO', body: 'Earth', orbit: leo });
    const gtoOrbit = { body: 'Earth', periKm: 185, apoKm: 35786, incDeg: 28.5, lanDeg: 0, frame: 'eq' };
    const gtoNode = archAddNode({ name: 'GTO', body: 'Earth', orbit: gtoOrbit });
    const lloNode = archAddNode({ name: 'LLO', body: 'Moon', orbit: { body: 'Moon', periKm: 100, apoKm: 100, incDeg: 90, lanDeg: 0, frame: 'eq' } });

    // Same-body coaxial two-burn edge (LEO -> GTO): archEdgeDv must equal the
    // direct _nmDvPhysics call on the same orbit shapes, and its legs must
    // sum to the total.
    const direct = _nmDvPhysics({ orbit: { type: 'circular', body: 'Earth', periKm: 185, apoKm: 185, incDeg: 28.5 } },
                                 { orbit: { type: 'elliptic', body: 'Earth', periKm: 185, apoKm: 35786, incDeg: 28.5 } });
    const viaArch = archEdgeDv(leoNode, gtoNode);
    ok('archEdgeDv: LEO->GTO matches _nmDvPhysics dv exactly (one accounting source)', viaArch && direct && viaArch.dv === direct.dv);
    ok('archEdgeDv: LEO->GTO legs sum to the total (accounting-identity guard)', viaArch.legs && viaArch.legs.length === 2 && viaArch.legs.reduce((s, l) => s + l.dv, 0) === viaArch.dv);

    // Cross-body corridor edge (Earth orbit -> Moon orbit): depart/insert
    // chain, no fabricated MCC term.
    const corridor = archEdgeDv(leoNode, lloNode);
    ok('archEdgeDv: LEO->LLO corridor edge resolves a dv', corridor && corridor.dv > 0);
    ok('archEdgeDv: LEO->LLO corridor legs are depart(TLI)+insert(LOI), summing to the total', corridor.legs && corridor.legs.length === 2 && corridor.legs[0].role === 'depart' && corridor.legs[1].role === 'insert' && corridor.legs.reduce((s, l) => s + l.dv, 0) === corridor.dv);

    const edge1 = archAddEdge(leoNode.id, gtoNode.id);
    const edge2 = archAddEdge(leoNode.id, lloNode.id);
    const budget = archComputeBudget();
    ok('archComputeBudget: sums every edge\'s dv (2 edges, 0 unresolved)', budget.edgeCount === 2 && budget.unresolved === 0 && budget.total === viaArch.dv + corridor.dv);

    archRemoveEdge(edge2.id);
    ok('archComputeBudget: live-recomputes after an edge is removed (no caching)', archComputeBudget().edgeCount === 1 && archComputeBudget().total === viaArch.dv);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // A4 — mission-side wiring (MISSION_MODEL_V2.md §26): LAUNCH Target-from-
  // node resolution, architecture-edge -> custom-node adaptation for the
  // reused s22 chain path, and the Plan surface's read-mostly content
  // builder. Full end-to-end event authoring (missionExecArchTransfer's
  // missionRecompute/physics tail) is exercised by hand in the browser pass
  // per CLAUDE.md's lightweight-verification default; these pins pin the
  // pure adaptation/data-shape seams that make that reuse honest.
  // ═══════════════════════════════════════════════════════════════════════
  {
    sandbox.PROG_ACTIVE_PROGRAM = {};
    archUndoReset();
    const node = archAddNode({ name: 'Gateway NRHO', body: 'Moon', orbit: { body: 'Moon', periKm: 3000, apoKm: 70000, incDeg: 57, lanDeg: 120, frame: 'eq' } });

    // Target-from-node resolution: _missionPlaneMatchTargetSpec('node:<id>')
    // returns the {inc,lan,name} shape progResolvePlaneTarget already accepts
    // for 'Moon'/catalog-ref targets — no new solve path, same function.
    const spec = _missionPlaneMatchTargetSpec('node:' + node.id);
    ok('_missionPlaneMatchTargetSpec resolves an architecture-node target to {inc,lan,name}', spec && spec.inc === 57 && spec.lan === 120 && spec.name === 'Gateway NRHO');
    ok('_missionPlaneMatchTargetSpec: unknown node id -> null (display-tolerant, no throw)', _missionPlaneMatchTargetSpec('node:nope') === null);
    ok('_missionPlaneMatchTargetSpec: still resolves Moon unchanged (no regression)', _missionPlaneMatchTargetSpec('Moon') === 'Moon');

    const epochJD = progEpochJD();
    const res = progResolvePlaneTarget(spec, epochJD, 0, 28.5);
    ok('progResolvePlaneTarget accepts the node-derived spec and returns a real solve', !!res && isFinite(res.inc_deg) && isFinite(res.lan_deg));

    // Edge -> custom-node adaptation: _archCustomNodeForArchNode creates one
    // node-map custom node in the SAME dialect archEdgeDv already produces
    // (_archOrbitToNmOrbit), tags it archNodeId, and is idempotent per
    // architecture node (no duplicate spawned on a second call) — the seam
    // that lets missionExecArchTransfer hand off to the existing
    // missionExecManeuver chain path with zero new chain logic.
    const nid1 = _archCustomNodeForArchNode(node);
    const nid2 = _archCustomNodeForArchNode(node);
    ok('_archCustomNodeForArchNode creates a node-map custom node for an architecture node', !!nid1);
    ok('_archCustomNodeForArchNode is idempotent per architecture node (no duplicate on repeat calls)', nid1 === nid2);
    const cn = _missionCustomNodes().find(n => n.id === nid1);
    ok('_archCustomNodeForArchNode tags the custom node with archNodeId for lookup', cn && cn.archNodeId === node.id);
    ok('_archCustomNodeForArchNode: custom node orbit matches _archOrbitToNmOrbit exactly (one accounting/dialect source)', cn && JSON.stringify(cn.orbit) === JSON.stringify(_archOrbitToNmOrbit(node.orbit)));

    // Plan-surface read-mostly content: _archMapContentHTML(true) renders the
    // same node/edge markup archMapRender uses for the Architecture page
    // (one renderer, two mounts, per A3's convention) but suppresses the
    // Draw Edge control and the per-edge delete chip, and offers the
    // Edit-in-Architecture affordance instead.
    const node2 = archAddNode({ name: 'LLO', body: 'Moon', orbit: { body: 'Moon', periKm: 100, apoKm: 100, incDeg: 90, lanDeg: 0, frame: 'eq' } });
    archAddEdge(node.id, node2.id);
    // escHtml (015-version.js) isn't in this suite's harness FILES list (chrome
    // module, no math/model content) — stub it for this content-string call.
    sandbox.escHtml = s => String(s);
    const readOnlyHTML = _archMapContentHTML(true);
    const editableHTML = _archMapContentHTML(false);
    ok('_archMapContentHTML(true) omits the Draw Edge authoring control', !readOnlyHTML.includes('archToggleBridgeMode'));
    ok('_archMapContentHTML(true) omits the per-edge delete chip', !readOnlyHTML.includes('archDeleteEdge'));
    ok('_archMapContentHTML(true) offers the Edit-in-Architecture affordance', readOnlyHTML.includes("showPage('architecture')"));
    ok('_archMapContentHTML(false) (Architecture page mount) keeps the Draw Edge control (no regression)', editableHTML.includes('archToggleBridgeMode'));
  }

  // restore the shared progUUID stub for any later code in this process that
  // might rely on it (defensive — this suite doesn't reuse it after this point).
  sandbox.progUUID = () => 'test-uuid';
}

  // ═══════════════════════════════════════════════════════════════════════
  // A5 — flown-vs-planned readiness checks (572-mission-checks.js).
  // missionRunChecks reads only m.log/m._expanded/m.groups/m.vehicleIds +
  // PROG_ACTIVE_PROGRAM.vehicles (see 572's own banner) — a hand-built m
  // with a pre-populated _expanded exercises the two new checks without
  // needing a full missionRecompute replay. KSP invariant is the FIRST
  // assertion in each block: no architecture -> zero new findings, even
  // when e.planNodeId/e.orbit are present (a stale/dangling reference from
  // before the architecture was cleared must not spuriously fire either).
  // ═══════════════════════════════════════════════════════════════════════
  {
    sandbox.PROG_ACTIVE_PROGRAM = { vehicles: {} };
    archUndoReset();

    const launchEvt = (orbit, planNodeId) => ({
      type: 'LAUNCH', result: 'SUCCESS', _authIdx: 0, orbit, planNodeId,
      stagingResult: { status: 'SUCCESS', dvMargin: 500, dvRequired: 9000 },
    });

    // KSP invariant: no architecture at all — a LAUNCH carrying a (dangling)
    // planNodeId + orbit produces neither new finding, and an over-threshold
    // authored dV produces no over-budget finding either (there's no budget
    // to be over).
    {
      const m = { missionId: 'a5-noarch', log: [], groups: {}, vehicleIds: [] };
      m._expanded = [launchEvt({ body: 'Earth', periKm: 200, apoKm: 200, incDeg: 80, lanDeg: 0, frame: 'eq' }, 'dangling-node-id')];
      m.log = m._expanded;
      missionRunChecks(m);
      const findings = missionGetChecks(m);
      ok('A5 KSP invariant: no architecture -> no architecture-plane-deviation finding', !findings.some(f => f.id === 'architecture-plane-deviation'));
      ok('A5 KSP invariant: no architecture -> no architecture-over-budget finding', !findings.some(f => f.id === 'architecture-over-budget'));
    }

    // Plane-deviation check: matching plane -> silent; deviated plane -> fires
    // with a sensible degree value; tolerance is not so tight that a
    // canonical-rounding no-op edit trips it.
    {
      const node = archAddNode({ name: 'Target LEO', body: 'Earth', orbit: { body: 'Earth', periKm: 200, apoKm: 200, incDeg: 28.5, lanDeg: 0, frame: 'eq' } });
      const mMatch = { missionId: 'a5-match', log: [], groups: {}, vehicleIds: [] };
      mMatch._expanded = [launchEvt({ body: 'Earth', periKm: 200, apoKm: 200, incDeg: 28.5, lanDeg: 0, frame: 'eq' }, node.id)];
      mMatch.log = mMatch._expanded;
      missionRunChecks(mMatch);
      ok('A5: LAUNCH committed orbit matching its node plane -> no plane-deviation finding', !missionGetChecks(mMatch).some(f => f.id === 'architecture-plane-deviation'));

      const mDeviate = { missionId: 'a5-deviate', log: [], groups: {}, vehicleIds: [] };
      mDeviate._expanded = [launchEvt({ body: 'Earth', periKm: 200, apoKm: 200, incDeg: 51.6, lanDeg: 0, frame: 'eq' }, node.id)];
      mDeviate.log = mDeviate._expanded;
      missionRunChecks(mDeviate);
      const dev = missionGetChecks(mDeviate).find(f => f.id === 'architecture-plane-deviation');
      ok('A5: LAUNCH committed orbit deviated 23.1deg from its node -> plane-deviation finding fires', !!dev);
      ok('A5: plane-deviation finding is amber (info/amber only, never blocking)', dev && dev.severity === 'amber');
      ok('A5: plane-deviation finding names a sensible degree value in its detail text', dev && /23\.1|23\.0|23\.2/.test(dev.detail));
      ok('A5: plane-deviation finding is anchored to the LAUNCH event (clickable in the UI)', dev && dev.authIdx === 0);

      // set back to matching -> the finding clears (fresh recompute of checks).
      mDeviate._expanded[0].orbit.incDeg = 28.5;
      missionRunChecks(mDeviate);
      ok('A5: setting the plane back to match clears the finding', !missionGetChecks(mDeviate).some(f => f.id === 'architecture-plane-deviation'));
    }

    // Over-budget check: archComputeBudget().total is the ONE accounting
    // source (610) — build a 2-node/1-edge architecture with a known budget,
    // then author BURN dv well past it.
    {
      sandbox.PROG_ACTIVE_PROGRAM = { vehicles: {} };
      archUndoReset();
      // archAddNode/archAddEdge id nodes via progUUID — the harness's shared
      // stub returns a constant id, which would collide the two nodes here
      // (archAddEdge would resolve fromId===toId to the SAME node). Give
      // this block its own incrementing stub, restored after.
      let _uid = 0;
      const _savedUUID = sandbox.progUUID;
      sandbox.progUUID = () => 'a5-node-' + (_uid++);
      const a = archAddNode({ name: 'LEO', body: 'Earth', orbit: { body: 'Earth', periKm: 185, apoKm: 185, incDeg: 28.5, lanDeg: 0, frame: 'eq' } });
      const b = archAddNode({ name: 'LLO', body: 'Moon', orbit: { body: 'Moon', periKm: 110, apoKm: 110, incDeg: 0, lanDeg: 0, frame: 'eq' } });
      archAddEdge(a.id, b.id);
      sandbox.progUUID = _savedUUID;
      const budget = archComputeBudget();
      ok('A5 fixture: 2-node/1-edge architecture prices a nonzero budget', budget.total > 0 && budget.unresolved === 0);

      const mUnder = { missionId: 'a5-under', log: [], groups: {}, vehicleIds: [] };
      mUnder._expanded = [{ type: 'BURN', result: 'SUCCESS', _authIdx: 0, dvTarget: budget.total * 0.5, dv_actual: budget.total * 0.5 }];
      mUnder.log = mUnder._expanded;
      missionRunChecks(mUnder);
      ok('A5: authored dV well under budget -> no over-budget finding', !missionGetChecks(mUnder).some(f => f.id === 'architecture-over-budget'));

      const mOver = { missionId: 'a5-over', log: [], groups: {}, vehicleIds: [] };
      mOver._expanded = [{ type: 'BURN', result: 'SUCCESS', _authIdx: 0, dvTarget: budget.total * 1.5, dv_actual: budget.total * 1.5 }];
      mOver.log = mOver._expanded;
      missionRunChecks(mOver);
      const over = missionGetChecks(mOver).find(f => f.id === 'architecture-over-budget');
      ok('A5: authored dV 50% over budget -> over-budget finding fires', !!over);
      ok('A5: over-budget finding is amber (info/amber only, never blocking)', over && over.severity === 'amber');
      ok('A5: over-budget finding is a mission-level (unanchored) end-state finding', over && over.authIdx === null);
    }
  }

  return counts();
};
