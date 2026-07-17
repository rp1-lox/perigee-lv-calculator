
// ─── DEV SEED — Apollo reference mission ─────────
// Console/test helper: builds the standard Apollo-style test mission in one call
// so subagents and manual testing never have to hand-assemble it through the UI.
// Usage (browser console / preview_eval):
//   devSeedApolloMission()                    → LAUNCH + LEO→TLC + TLC→LLO
//   devSeedApolloMission({ maneuvers:false }) → LAUNCH only
// Returns { missionId, log } or { error }. Idempotent-ish: refuses to seed into a
// mission that already has events unless { force:true } (which resets it first).
function devSeedApolloMission(opts) {
  opts = opts || {};
  if (typeof missionEnsureDefault === 'function') missionEnsureDefault();
  const m = _missions[0];
  if (!m) return { error: 'no mission' };
  if (m.log.length) {
    if (!opts.force) return { error: 'mission already has events — pass {force:true} to reset and seed' };
    m.log = []; m.groups = {}; missionRecompute(m);
  }
  // launch vehicle: Built-in Saturn V, snapshotted through the normal picker path
  const idx = BUILTIN_PRESETS.findIndex(p => /^saturn v$/i.test(p.name));
  if (idx < 0) return { error: 'Saturn V preset not found' };
  missionPickLibVehicle(m.missionId, 'builtin:' + idx);
  // payload: Apollo CSM + LM if the default spacecraft exist
  const csm = _scEdSC.find(s => /csm/i.test(s.name));
  const lm  = _scEdSC.find(s => /lunar module|(^|\s)lm(\s|$)/i.test(s.name));
  m.payloadScIds = [csm, lm].filter(Boolean).map(s => s.spacecraftId);
  missionExecLaunch(m.missionId, { silent: true });
  // MISSION_MODEL_V2 §13 T3 item 3: the seed's LEO parking orbit (185x185 @28.5) matches
  // the builtin 'leo-185' catalog entry exactly — bind it so the seed exercises T2's
  // ref-binding path end to end (this also lets refOrbitUpdate/recompute verification
  // move a real seeded launch, not just a synthetic one).
  const launchEv = m.log.find(e => e.type === 'LAUNCH');
  if (launchEv) { launchEv.orbitRefId = 'leo-185'; missionRecompute(m); }
  if (opts.maneuvers !== false) {
    missionExecManeuver(m.missionId, 'leo', 'tlc');   // trans-lunar injection
    missionExecManeuver(m.missionId, 'tlc', 'llo');   // lunar orbit insertion
  }
  missionRenderDetail();
  return { missionId: m.missionId, log: m.log.map(e => e.type) };
}

// ─── DEV SEED — MISSION_MODEL_V2 §15 5a Gateway reference mission ───────────
// Console/test helper for the LEO -> lunar NRHO direct-transfer solver
// (physSolveNrhoTransfer, 565): snapshots a builtin LV, launches to LEO
// 185x185 @28.5 (bound to the 'leo-185' ref-orbit catalog entry), DEPLOYs a
// Gateway station on the NRHO at t=0 (bound to 'nrho-nominal'), then flies
// the crewed vehicle's own LEO -> NRHO transfer (LEO -> TLC -> NRHO, the
// TLI/'NRHO insertion' edge — see 430's 'nrho' node + 565's nrhoRefAfter).
// Usage (browser console / preview_eval): devSeedGatewayMission({force:true})
// Returns { missionId, log } or { error }.
function devSeedGatewayMission(opts) {
  opts = opts || {};
  if (typeof missionEnsureDefault === 'function') missionEnsureDefault();
  const m = _missions[0];
  if (!m) return { error: 'no mission' };
  if (m.log.length) {
    if (!opts.force) return { error: 'mission already has events — pass {force:true} to reset and seed' };
    m.log = []; m.groups = {}; missionRecompute(m);
  }
  const idx = BUILTIN_PRESETS.findIndex(p => /^saturn v$/i.test(p.name));
  if (idx < 0) return { error: 'Saturn V preset not found' };
  missionPickLibVehicle(m.missionId, 'builtin:' + idx);
  const csm = _scEdSC.find(s => /csm/i.test(s.name));
  const lm = _scEdSC.find(s => /lunar module|(^|\s)lm(\s|$)/i.test(s.name));
  m.payloadScIds = [csm, lm].filter(Boolean).map(s => s.spacecraftId);
  missionExecLaunch(m.missionId, { silent: true });
  const launchEv = m.log.find(e => e.type === 'LAUNCH');
  if (launchEv) { launchEv.orbitRefId = 'leo-185'; missionRecompute(m); }
  const lvVehicleId = m.vehicleId; // DEPLOY below flips m.vehicleId to the station — restore before the crewed maneuvers
  // Gateway station spacecraft — reuse one named 'Gateway' if the library
  // already has it (persisted programs), else make a minimal one on the fly.
  let gateway = _scEdSC.find(s => /gateway/i.test(s.name));
  if (!gateway && typeof progMakeSpacecraftDefinition === 'function') {
    gateway = progMakeSpacecraftDefinition('Gateway');
    if (typeof progMakeSpacecraftStageDef === 'function') gateway.stages.push(progMakeSpacecraftStageDef('Gateway Bus'));
    _scEdSC.push(gateway);
  }
  if (!gateway) return { error: 'no Gateway spacecraft available to deploy' };
  // DEPLOY at MET 0 (the mission's own launch epoch — "at t 0" per spec),
  // mid-log so it doesn't interfere with the crewed vehicle's own log index
  // lookups; bound to the NRHO ref via missionDeployRefPick (§14 U3 path,
  // the only ref-picker that accepts a propagated entry).
  const gwLaunchEv = m.log.find(e => e.type === 'LAUNCH');
  m.log.push({ type: 'DEPLOY', label: gateway.name, spacecraftId: gateway.spacecraftId,
    orbit: (gwLaunchEv && gwLaunchEv.orbit) ? { ...gwLaunchEv.orbit } : _missionLaunchOrbitDraft(m.launchOrbit), emptyTanks: false });
  missionRecompute(m); missionRenderDetail();
  const deployIdx = m.log.length - 1;
  missionDeployRefPick(m.missionId, deployIdx, 'nrho-nominal');
  // DEPLOY's replay makes the just-placed station the "current" vehicle
  // (same as LAUNCH does) — switch back to the crewed LV before authoring
  // ITS maneuvers, or they'd be stamped/owned by the station instead.
  if (lvVehicleId && typeof missionSetActiveVehicle === 'function') missionSetActiveVehicle(m.missionId, lvVehicleId);
  if (opts.maneuvers !== false) {
    missionExecManeuver(m.missionId, 'leo', 'tlc');    // TLI
    missionExecManeuver(m.missionId, 'tlc', 'nrho');   // NRHO insertion (physSolveNrhoTransfer)
  }
  missionRenderDetail();
  return { missionId: m.missionId, log: m.log.map(e => e.type) };
}
