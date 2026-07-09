
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
  if (opts.maneuvers !== false) {
    missionExecManeuver(m.missionId, 'leo', 'tlc');   // trans-lunar injection
    missionExecManeuver(m.missionId, 'tlc', 'llo');   // lunar orbit insertion
  }
  missionRenderDetail();
  return { missionId: m.missionId, log: m.log.map(e => e.type) };
}
