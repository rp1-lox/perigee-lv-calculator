
// ─── SETTINGS MODAL (N1b, MISSION_MODEL_V2 §17) ──────────────────────────────
// The app's first (and deliberately tiny) Settings surface: one control —
// Physics fidelity. State lives in 565 (physFidelity/physSetFidelity) and is
// session-persisted through _buildSessionObject/_applySessionObject (455).
// UI markup: #modal-settings in index.html. Theming: seeds/derived vars only.

function openSettingsModal() {
  settingsSyncUI();
  openModal('modal-settings');
}

/** Reflect the current fidelity mode into the modal's radios (called on open
 *  and after a session restore so the UI can never lie about the live mode). */
function settingsSyncUI() {
  const mode = (typeof physFidelity === 'function') ? physFidelity() : 'contextual';
  const rc = document.getElementById('set-fid-contextual');
  const rf = document.getElementById('set-fid-full');
  if (rc) rc.checked = mode !== 'full';
  if (rf) rf.checked = mode === 'full';
}

/** Radio onchange: switch fidelity. The setting is a PHYSICS INPUT — every
 *  mission recomputes (numbers may legitimately move; D6 discipline) and the
 *  session autosaves. */
function settingsSetFidelity(mode) {
  if (typeof physSetFidelity !== 'function') return;
  const changed = physSetFidelity(mode);
  if (!changed) return;
  try {
    if (typeof _missions !== 'undefined' && typeof missionRecompute === 'function')
      (_missions || []).forEach(m => missionRecompute(m));
    if (typeof missionRenderDetail === 'function') missionRenderDetail();
  } catch (err) { console.warn('fidelity recompute failed:', err); }
  if (typeof autosaveScheduleSave === 'function') autosaveScheduleSave();
}
