// ─── MISSION UNDO/REDO ───
// Per-mission undo/redo stacks over AUTHORED mission state (m.log, m.groups,
// m.vehicleNames, m.launchOrbit, m.name, m.fleetEntryId, m.payloadScIds).
// Snapshot capture is hooked at the end of missionRecompute (570) — every
// mutation already follows: mutate authored state -> missionRecompute(m) ->
// missionRenderDetail(). The undo-stack TOP is always the CURRENT state,
// since capture runs after every recompute (including the very first one).

const _missionUndoStacks = {};   // missionId -> { undo: [snapshotStr...], redo: [snapshotStr...] }
let _missionUndoRestoring = false;
const MISSION_UNDO_MAX = 50;

function _missionUndoGetStack(missionId) {
  if (!_missionUndoStacks[missionId]) _missionUndoStacks[missionId] = { undo: [], redo: [] };
  return _missionUndoStacks[missionId];
}

// Serialize only authored state. m.log is snapshotted as-is via JSON — cached/derived
// fields written by recompute (vehicleId, stagingResult, result, payloadMass,
// payloadNames, etc.) are harmless since replay overwrites them on restore — EXCEPT
// the `_expanded` UI accordion flag, which we strip so opening/closing a card doesn't
// pollute mutation history.
function _missionUndoSerialize(m) {
  const log = (m.log || []).map(e => {
    if (!e || !('_expanded' in e)) return e;
    const { _expanded, ...rest } = e;
    return rest;
  });
  return JSON.stringify({
    log,
    groups: m.groups || {},
    vehicleNames: m.vehicleNames || {},
    launchOrbit: m.launchOrbit || null,
    name: m.name,
    fleetEntryId: m.fleetEntryId,
    payloadScIds: m.payloadScIds || [],
    laneColors: m.laneColors || {},
    // R1 (mission epoch UI): epochJD lives on PROG_ACTIVE_PROGRAM (a program-
    // wide setting, not per-mission), but is captured here so an epoch change
    // is an undoable step like any other authored mutation. Guarded so a
    // pre-epoch-feature snapshot (this field simply absent) still round-trips.
    epochJD: (typeof PROG_ACTIVE_PROGRAM !== 'undefined' && PROG_ACTIVE_PROGRAM && isFinite(PROG_ACTIVE_PROGRAM.epochJD))
      ? PROG_ACTIVE_PROGRAM.epochJD : null,
  });
}

function missionUndoCapture(m) {
  if (!m || !m.missionId) return;
  if (_missionUndoRestoring) return;   // never capture while restoring
  const stack = _missionUndoGetStack(m.missionId);
  const snap = _missionUndoSerialize(m);
  if (stack.undo.length && stack.undo[stack.undo.length - 1] === snap) return;   // dedupe (recompute runs on render too)
  stack.undo.push(snap);
  if (stack.undo.length > MISSION_UNDO_MAX) stack.undo.shift();
  stack.redo.length = 0;   // a real new mutation invalidates redo history
}

function _missionUndoApply(m, snapStr) {
  const data = JSON.parse(snapStr);
  // C2b: in-session undo/redo snapshots serialize e.orbit verbatim — a
  // snapshot captured before this pass's rename (or loaded from an old
  // session) may still carry legacy alt_km/apo_km/inc_deg/lan_deg. Run it
  // through the same load-time migration persistence uses (450) so restore
  // always lands on canonical field names.
  if (Array.isArray(data.log) && typeof _missionMigrateLaunchOrbitLog === 'function') {
    _missionMigrateLaunchOrbitLog({ log: data.log });
  }
  m.log = data.log;
  m.groups = data.groups;
  m.vehicleNames = data.vehicleNames;
  m.launchOrbit = data.launchOrbit;
  // C2b item 1: a pre-rename snapshot's launchOrbit may carry the legacy
  // seed-default dialect — canonicalize it the same way persistence does.
  if (m.launchOrbit && typeof _missionMigrateOrbitFieldNames === 'function') _missionMigrateOrbitFieldNames(m.launchOrbit);
  m.name = data.name;
  m.fleetEntryId = data.fleetEntryId;
  m.payloadScIds = data.payloadScIds;
  m.laneColors = data.laneColors || {};
  // Legacy snapshots (pre-epoch-feature) have epochJD absent/null — leave the
  // current program epoch alone rather than clobbering it with null.
  if (isFinite(data.epochJD) && typeof PROG_ACTIVE_PROGRAM !== 'undefined' && PROG_ACTIVE_PROGRAM) {
    PROG_ACTIVE_PROGRAM.epochJD = data.epochJD;
  }
  _missionUndoRestoring = true;
  try {
    missionRecompute(m);
    missionRenderDetail();
  } finally {
    _missionUndoRestoring = false;
  }
}

function missionUndo() {
  const m = (typeof _missionGet === 'function') ? _missionGet(_missionSel) : null;
  if (!m) return;
  const stack = _missionUndoGetStack(m.missionId);
  if (stack.undo.length < 2) return;   // top === current state; need a prior state to go to
  const current = stack.undo.pop();
  stack.redo.push(current);
  const prev = stack.undo[stack.undo.length - 1];
  _missionUndoApply(m, prev);
}

function missionRedo() {
  const m = (typeof _missionGet === 'function') ? _missionGet(_missionSel) : null;
  if (!m) return;
  const stack = _missionUndoGetStack(m.missionId);
  if (!stack.redo.length) return;
  const next = stack.redo.pop();
  stack.undo.push(next);
  _missionUndoApply(m, next);
}

function _missionUndoCanUndo() {
  const m = (typeof _missionGet === 'function') ? _missionGet(_missionSel) : null;
  if (!m) return false;
  const stack = _missionUndoGetStack(m.missionId);
  return stack.undo.length >= 2;
}

function _missionUndoCanRedo() {
  const m = (typeof _missionGet === 'function') ? _missionGet(_missionSel) : null;
  if (!m) return false;
  const stack = _missionUndoGetStack(m.missionId);
  return stack.redo.length > 0;
}

document.addEventListener('keydown', e => {
  const cc = document.getElementById('mission-cc');
  const pageProgram = document.getElementById('page-program');
  const visible = cc && pageProgram
    && getComputedStyle(pageProgram).display !== 'none';
  if (!visible) return;   // mission command center not visible
  // Unify-create/edit (2026-07-16): Escape discards the open pending event
  // card, even while focus sits in one of its inputs — checked BEFORE the
  // INPUT/TEXTAREA/SELECT early-return below (which guards the Ctrl+Z/Y path).
  if (e.key === 'Escape' && typeof _missionPendingEvent !== 'undefined' && _missionPendingEvent) {
    e.preventDefault();
    missionCancelPendingEvent(_missionPendingEvent.missionId);
    return;
  }
  const t = e.target;
  const tag = t && t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    missionUndo();
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault();
    missionRedo();
  }
});
