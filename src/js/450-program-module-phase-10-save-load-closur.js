
// ─── PROGRAM MODULE — Phase 10: Save / Load entire program ──────────────────
//
// A ".program" file is just JSON (renamed extension so users can tell it apart
// from per-vehicle / per-spaceport JSON). It bundles the WHOLE program:
// spacecraft definitions, fleet, missions, and the active program (pads etc.).
// Load restores all of them and re-simulates each mission so the runtime
// vehicles in PROG_ACTIVE_PROGRAM are rebuilt from each mission's log.

function buildProgramObject() {
  return {
    kind: 'rocket-playground-program',
    formatVersion: 1,
    savedAt: new Date().toISOString(),
    spacecraft: _scEdSC,
    fleet: _fleetEntries,
    missions: _missions,
    scStageLib: _scStageLib,
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

function applyProgramObject(obj) {
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
  if (Array.isArray(obj.scStageLib)) _scStageLib = obj.scStageLib;
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
