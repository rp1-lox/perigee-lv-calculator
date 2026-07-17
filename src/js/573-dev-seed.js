
// Plane-matches a just-launched LAUNCH event's parking orbit to the Moon and
// solves the launch time that reaches that plane — the SAME recipe the UI's
// Target:"Moon" plane-match picker runs (missionLaunchMatchPlane, 570-mission-
// events.js), reproduced here programmatically for the dev seed (no DOM).
// Needed because a raw 185x185@28.5/LAN-0 parking orbit (the seed's old,
// unmatched authoring) is generically NOT in the Moon's orbital plane at an
// arbitrary epoch, so the TLC leg's shooter (physShootLegAim, 565) has no
// departure-plane corridor to converge into — confirmed non-convergent
// (miss ~100,000 km >> the ~66,000 km lunar SOI) after the pole-sign fix
// (3f4350ce1) corrected the Moon's plane phase and moved the real corridor
// away from the old hand-tuned geometry.
// progResolvePlaneTarget('Moon', ...) returns the Moon's TRUE inclination
// (~28.1 deg at the default 2026 epoch) even when that's below the launch
// site's latitude (28.5 deg here) — "unreachable" in that case, by design
// (415-launch-planner.js: never silently clamped, surfaced to the caller).
// A site can never launch directly into a plane below its own latitude, so
// the achievable min-penalty inclination is max(moonInc, |siteLat|); LAN
// stays the Moon's LAN (only ~0.4 deg penalty at this epoch/site — see
// CLAUDE.md). Mutates the LAUNCH event's orbit + launch time in place and
// recomputes; returns the resolved {inc_deg, lan_deg, launchTime_s} for
// callers that want to report/verify the match, or null if the required
// helpers aren't loaded (older builds) — callers should treat null as
// "left the seed's baseline orbit untouched".
function _devSeedPlaneMatchLaunchToMoon(m, launchEv) {
  if (typeof progResolvePlaneTarget !== 'function' || typeof progLaunchRaanFor !== 'function'
      || typeof progLaunchNextWindowS !== 'function' || !launchEv || !launchEv.orbit) return null;
  const site = (typeof _missionLaunchSiteFor === 'function') ? _missionLaunchSiteFor(launchEv) : null;
  if (!site || site.lon == null) return null;
  const epochJD = (typeof progEpochJD === 'function') ? progEpochJD() : PROG_DEFAULT_EPOCH_JD;
  const res = progResolvePlaneTarget('Moon', epochJD, 0, site.lat);
  if (!res) return null;
  const incUse = Math.max(res.inc_deg, Math.abs(site.lat)); // achievable floor = site latitude
  const rNow = progLaunchRaanFor(site.lat, site.lon, incUse, 0, _missionEarthSpinRad);
  if (rNow.unreachable) return null; // shouldn't happen once inc is floored to |siteLat|
  const win_t_s = Math.round(progLaunchNextWindowS(rNow.raan, res.lan_deg, 86164.1));
  launchEv.orbit.incDeg = incUse;
  launchEv.orbit.lanDeg = res.lan_deg;
  launchEv.launchTime_s = win_t_s;
  missionRecompute(m);
  return { inc_deg: incUse, lan_deg: res.lan_deg, launchTime_s: win_t_s, penalty_deg: res.penalty_deg };
}
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
    // Plane-match the parking orbit to the Moon (+ solve the launch window
    // that reaches it) BEFORE flying TLC — see _devSeedPlaneMatchLaunchToMoon.
    // leo-185's LAN is unpinned in the catalog (inc-only), so this stays
    // bound to orbitRefId 'leo-185' after the LAN edit (T2's ref-binding
    // path above is preserved, not detached).
    if (launchEv) _devSeedPlaneMatchLaunchToMoon(m, launchEv);
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
