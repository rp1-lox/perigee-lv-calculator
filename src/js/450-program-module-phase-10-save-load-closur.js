
// ─── PROGRAM MODULE — Phase 10: Save / Load entire program ──────────────────
//
// A ".program" file is just JSON (renamed extension so users can tell it apart
// from per-vehicle / per-spaceport JSON). It bundles the WHOLE program:
// spacecraft definitions, fleet, missions, and the active program (pads etc.).
// Load restores all of them and re-simulates each mission so the runtime
// vehicles in PROG_ACTIVE_PROGRAM are rebuilt from each mission's log.

// Unify-create/edit (2026-07-16): a mission's log may momentarily hold a
// PENDING draft event (mid-creation, appended to the end of m.log — see
// 570-mission-band.js) for the accordion/card machinery to render through.
// It must never reach a saved blob (autosave OR .program export both funnel
// through this function) — strip any `.pending` entries from a shallow copy,
// leaving the live `_missions` array itself untouched.
function _missionsSansPending() {
  return _missions.map(m => (m.log && m.log.some(e => e.pending)) ? { ...m, log: m.log.filter(e => !e.pending) } : m);
}

// C3 (2026-07-17, launchOrbit triplication collapse): `e.orbit` is now the
// single authored source on a LAUNCH/DEPLOY entry — old saved logs may still
// carry legacy `e.launchOrbit` (stamped alongside `orbit` by pre-C3 code).
// Load-time migration only (in-memory): both present -> orbit wins (it was
// always the more-authored field, kept current by every editing path);
// launchOrbit-only -> copy into orbit. Either way launchOrbit is deleted, so
// a re-save (autosave or .program export, both funnel through
// buildProgramObject serializing the log as-is) simply stops carrying it.
function _missionMigrateLaunchOrbitEntry(e) {
  if (!e || !('launchOrbit' in e)) return e;
  if (e.orbit == null) e.orbit = e.launchOrbit;
  delete e.launchOrbit;
  return e;
}
function _missionMigrateLaunchOrbitLog(m) {
  if (m && Array.isArray(m.log)) m.log.forEach(_missionMigrateLaunchOrbitEntry);
  return m;
}

function buildProgramObject() {
  return {
    kind: 'rocket-playground-program',
    formatVersion: 1,
    savedAt: new Date().toISOString(),
    spacecraft: _scEdSC,
    fleet: _fleetEntries,
    missions: _missionsSansPending(),
    scStageLib: _scStageLib,
    // MISSION_MODEL_V2 Phase 3 T1: user-tier reference-orbit catalog + any
    // program one-offs (both live in PROG_ORBIT_CATALOG_USER; there is no
    // separate per-program tier — a program's one-offs simply ARE user-tier
    // entries created while that program was active).
    orbitCatalogUser: (typeof _refOrbitSessionSave === 'function') ? _refOrbitSessionSave() : null,
    activeProgram: PROG_ACTIVE_PROGRAM,
    sel: { fleet: _fleetSel, mission: _missionSel },
  };
}

function saveProgramFile() {
  const obj = buildProgramObject();
  const base = (PROG_ACTIVE_PROGRAM && PROG_ACTIVE_PROGRAM.name ? PROG_ACTIVE_PROGRAM.name : 'program')
    .replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'program';
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = base + '.program';
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadProgramFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let obj;
    try { obj = JSON.parse(e.target.result); }
    catch (err) { showAlert('Invalid .program file: ' + err.message, 'Invalid File'); input.value = ''; return; }
    if (!obj || obj.kind !== 'rocket-playground-program') {
      showAlert('This file is not a Rocket Playground program (.program) file.', 'Invalid File');
      input.value = ''; return;
    }
    applyProgramObject(obj);
    input.value = '';
  };
  reader.readAsText(file);
}

// MISSION_MODEL_V2 D3/Phase 2 S5: the version gate. A mission blob without
// modelVersion:2 predates the physics-primary flip (V1 accounting, possibly
// legacy MANEUVER entries / detachedFrom fallbacks the replay no longer
// understands) — refused outright rather than migrated (old files keep
// working in the released v2.0.0 build). An empty/missing missions array
// passes trivially (nothing to gate).
function _missionsPassV2Gate(missions) {
  if (!Array.isArray(missions) || !missions.length) return true;
  return missions.every(m => m && m.modelVersion === 2);
}

function applyProgramObject(obj) {
  if (obj && !_missionsPassV2Gate(obj.missions)) {
    if (typeof showAlert === 'function') {
      showAlert('This program file was saved by an older version of Rocket Playground (pre-v3.0 mission model) and can\'t be opened here — its missions use the retired ΔV-accounting model. Old files remain readable in the published v2.0.0 "Integral" build. Nothing was changed.', 'Older Mission Format');
    }
    return;
  }
  _scEdSC       = Array.isArray(obj.spacecraft) ? obj.spacecraft : [];
  // Builtin presets are seeded with fresh UUIDs each session, so a restored blob
  // that predates them (or was saved with them deleted) silently wipes them.
  // Re-seed any builtin missing by name.
  if (typeof _PROG_SC_PRESETS !== 'undefined') {
    const have = new Set(_scEdSC.map(s => s.name));
    _PROG_SC_PRESETS.forEach(p => {
      if (!have.has(p.name)) _scEdSC.push({
        spacecraftId: progUUID(),
        name: p.name,
        stages: p.stages.map(s => ({ stageId: progUUID(), ...s })),
      });
    });
  }
  _fleetEntries = Array.isArray(obj.fleet)      ? obj.fleet      : [];
  _missions     = Array.isArray(obj.missions)   ? obj.missions   : [];
  _missions.forEach(_missionMigrateLaunchOrbitLog);   // C3: legacy e.launchOrbit -> e.orbit, in memory only
  if (Array.isArray(obj.scStageLib)) _scStageLib = obj.scStageLib;
  if (typeof _refOrbitSessionRestore === 'function') _refOrbitSessionRestore(obj.orbitCatalogUser);
  PROG_ACTIVE_PROGRAM = obj.activeProgram || progMakeProgram('Loaded Program');
  // R1: programs saved before the epoch feature get the default epoch
  if (!isFinite(PROG_ACTIVE_PROGRAM.epochJD)) PROG_ACTIVE_PROGRAM.epochJD = (typeof PROG_DEFAULT_EPOCH_JD !== 'undefined' ? PROG_DEFAULT_EPOCH_JD : 2461230.5);
  _fleetSel   = (obj.sel && obj.sel.fleet)   || (_fleetEntries[0] && _fleetEntries[0].fleetId) || null;
  _scEdSel    = (_scEdSC[0] && _scEdSC[0].spacecraftId) || null;
  // Re-simulate every mission so PROG_ACTIVE_PROGRAM's runtime vehicles are
  // rebuilt from each log (m.log is the source of truth).
  _missions.forEach(m => { try { missionRecompute(m); } catch (err) { /* keep loading the rest */ } });
  // One mission per program: pin the UI to _missions[0] (creates a default if the
  // loaded file had none). Older multi-mission .program files keep the rest of
  // _missions in the array — just not surfaced in the UI.
  if (typeof missionEnsureDefault === 'function') missionEnsureDefault();
  // Refresh all program UI.
  if (typeof scEdRenderList    === 'function') scEdRenderList();
  if (typeof scEdRenderDetail  === 'function') scEdRenderDetail();
}
