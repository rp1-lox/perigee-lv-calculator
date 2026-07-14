
// ─── AUTOSAVE / SESSION RESTORE ──────────────────────────────────────────────
//
// Persists the whole session (program + current LV) to localStorage on a
// debounce, and offers to restore it on next load via a dismissible banner.
// Never allowed to throw into the caller — save/restore failures are caught
// and swallowed (with a single console.warn) so a full/corrupt localStorage
// can never break the app.

const AUTOSAVE_KEY = 'lv_autosave_v1';

let _autosaveTimer = null;
let _autosaveDisabled = false;   // set true after a save failure (quota, etc.)
// Suspended from module load until the startup restore-banner decision is made
// (or immediately if there's nothing to restore). Without this, the page's own
// init calls (scEdInit/fleetInit/missionInit rendering default state) would
// schedule an autosave that clobbers the still-unread saved blob before the
// user ever sees the banner.
let _autosaveSuspended = true;

function autosaveScheduleSave() {
  if (_autosaveDisabled || _autosaveSuspended) return;
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(autosaveNow, 2000);
}

// Shared payload builder used by BOTH autosaveNow() and sessionExport() so the
// two paths can never drift apart. Includes the program + current LV (as
// before) plus user-created LIBRARY content that previously wasn't captured:
// saved vehicles (userLVs), user stage-library entries (userStagesByCategory),
// user orbit-library entries (userOrbitsByCategory). NOTE: the SC stage
// library (_scStageLib) is deliberately NOT duplicated here — it already
// travels inside buildProgramObject().scStageLib (see 450).
// Deep-copied via JSON so later in-app mutation can't leak back into the blob.
function _buildSessionObject() {
  const safeCopy = v => { try { return JSON.parse(JSON.stringify(v)); } catch (err) { return null; } };
  return {
    savedAt: new Date().toISOString(),
    program: (typeof buildProgramObject === 'function') ? buildProgramObject() : null,
    lv: (typeof buildLVObject === 'function') ? buildLVObject((typeof loadedVehicleName !== 'undefined' ? loadedVehicleName : '') || '', '') : null,
    userLVs: (typeof userLVs !== 'undefined') ? safeCopy(userLVs) : null,
    userStagesByCategory: (typeof userStagesByCategory !== 'undefined') ? safeCopy(userStagesByCategory) : null,
    userOrbitsByCategory: (typeof userOrbitsByCategory !== 'undefined') ? safeCopy(userOrbitsByCategory) : null,
    customThemes: (typeof customThemes !== 'undefined') ? safeCopy(customThemes) : null,
    activeThemeKey: (typeof activeThemeKey !== 'undefined') ? activeThemeKey : null,
    // MISSION_MODEL_V2 Phase 3 T1: user-tier reference-orbit catalog.
    orbitCatalogUser: (typeof _refOrbitSessionSave === 'function') ? _refOrbitSessionSave() : null,
    // N1b (§17): physics fidelity setting ('contextual' | 'full').
    physicsFidelity: (typeof physFidelity === 'function') ? physFidelity() : null,
  };
}

function autosaveNow() {
  if (_autosaveDisabled || _autosaveSuspended) return;
  try {
    const blob = _buildSessionObject();
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(blob));
  } catch (err) {
    _autosaveDisabled = true;
    console.warn('Autosave disabled for this session (localStorage write failed):', err);
  }
}

function autosaveClear() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch (err) { /* ignore */ }
}

// Shared restore/apply path used by BOTH autosaveRestore() and sessionImport().
// Library content is restored BEFORE program/LV apply since missions/vehicles
// may reference library entries. All fields are optional/guarded so OLD blobs
// (format without the library fields) still restore cleanly.
function _applySessionObject(blob) {
  if (!blob) return false;
  _autosaveSuspended = true;
  try {
    // ── User library content (restore first — may be referenced below) ──
    if (Array.isArray(blob.userLVs) && typeof userLVs !== 'undefined') {
      userLVs = blob.userLVs;
      if (typeof buildPresets === 'function') buildPresets();
    }
    if (blob.userStagesByCategory && typeof userStagesByCategory !== 'undefined') {
      userStagesByCategory = blob.userStagesByCategory;
      if (typeof buildStageLibrary === 'function') buildStageLibrary();
    }
    if (blob.userOrbitsByCategory && typeof userOrbitsByCategory !== 'undefined') {
      userOrbitsByCategory = blob.userOrbitsByCategory;
      if (typeof buildOrbitCategories === 'function') buildOrbitCategories();
    }
    // ── Themes (guarded — legacy blobs predate this field) ──
    if (blob.customThemes && typeof customThemes !== 'undefined') {
      customThemes = blob.customThemes;
    }
    if (typeof rebuildThemeSelect === 'function') rebuildThemeSelect();
    // MISSION_MODEL_V2 Phase 3 T1: user-tier reference-orbit catalog (guarded —
    // legacy blobs predate this field).
    if (typeof _refOrbitSessionRestore === 'function') {
      _refOrbitSessionRestore(blob.orbitCatalogUser);
    }
    // N1b (§17): physics fidelity — set BEFORE the program apply below so the
    // restored missions' first recompute already runs in the saved mode
    // (guarded — legacy blobs predate this field).
    if (blob.physicsFidelity && typeof physSetFidelity === 'function') {
      physSetFidelity(blob.physicsFidelity);
      if (typeof settingsSyncUI === 'function') settingsSyncUI();
    }
    if (blob.activeThemeKey && typeof applyTheme === 'function') {
      applyTheme(blob.activeThemeKey);
    } else if (typeof rebuildThemeSelect === 'function' && typeof applyTheme === 'function' && typeof activeThemeKey !== 'undefined') {
      applyTheme(activeThemeKey);
    }
    // ── Program + current LV ──
    if (blob.program && typeof applyProgramObject === 'function') {
      applyProgramObject(blob.program);
    }
    if (blob.lv && typeof applyLVObject === 'function') {
      applyLVObject(blob.lv);
    }
  } catch (err) {
    console.warn('Session restore failed partway through:', err);
  } finally {
    _autosaveSuspended = false;
  }
  return true;
}

function autosaveRestore() {
  let blob = null;
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    blob = JSON.parse(raw);
  } catch (err) {
    return false; // corrupt data — bail silently
  }
  if (!blob) return false;
  return _applySessionObject(blob);
}

// ── Session download / upload ───────────────────────────────────────────────
// Same payload shape as autosave, plus a 'kind'/'formatVersion' envelope so
// imports can be validated. Uses the shared builder/applier above so this can
// never drift from autosave's own save/restore behavior.

function sessionExport() {
  try {
    const obj = Object.assign({ kind: 'rocket-playground-session', formatVersion: 1 }, _buildSessionObject());
    const base = (typeof PROG_ACTIVE_PROGRAM !== 'undefined' && PROG_ACTIVE_PROGRAM && PROG_ACTIVE_PROGRAM.name
      ? PROG_ACTIVE_PROGRAM.name : 'session').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'session';
    if (typeof downloadJSON === 'function') {
      downloadJSON(obj, base + '-session.json');
    }
  } catch (err) {
    console.warn('Session export failed:', err);
    if (typeof showAlert === 'function') showAlert('Session export failed: ' + err.message, 'Export Error');
  }
}

function sessionImport(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let obj;
    try { obj = JSON.parse(e.target.result); }
    catch (err) {
      if (typeof showAlert === 'function') showAlert('Invalid session file: ' + err.message, 'Invalid File');
      input.value = ''; return;
    }
    if (!obj || obj.kind !== 'rocket-playground-session') {
      if (typeof showAlert === 'function') showAlert('This file is not a Rocket Playground session file.', 'Invalid File');
      input.value = ''; return;
    }
    _applySessionObject(obj);
    autosaveNow(); // imported session becomes the new autosave
    input.value = '';
  };
  reader.readAsText(file);
}

// ── Restore banner ──────────────────────────────────────────────────────────

function _autosaveRelativeTime(iso) {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return 'earlier';
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return diffSec + 's ago';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return diffMin + 'm ago';
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h ago';
  const diffDay = Math.round(diffHr / 24);
  return diffDay + 'd ago';
}

function _autosaveDismissBanner() {
  const el = document.getElementById('autosave-banner');
  if (el) el.remove();
}

function autosaveShowBannerIfPresent() {
  let raw;
  try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch (err) { _autosaveSuspended = false; return; }
  if (!raw) { _autosaveSuspended = false; return; }
  let blob;
  try { blob = JSON.parse(raw); } catch (err) { _autosaveSuspended = false; return; }
  if (!blob) { _autosaveSuspended = false; return; }

  const banner = document.createElement('div');
  banner.id = 'autosave-banner';
  banner.className = 'autosave-banner';
  const when = _autosaveRelativeTime(blob.savedAt);
  banner.innerHTML =
    '<span class="autosave-banner-msg">Restored session from ' + when + '?</span>' +
    '<button type="button" class="autosave-banner-btn autosave-banner-restore">Restore</button>' +
    '<button type="button" class="autosave-banner-btn autosave-banner-discard">Discard</button>';
  document.body.appendChild(banner);

  banner.querySelector('.autosave-banner-restore').addEventListener('click', () => {
    autosaveRestore();
    _autosaveSuspended = false;
    _autosaveDismissBanner();
  });
  banner.querySelector('.autosave-banner-discard').addEventListener('click', () => {
    autosaveClear();
    _autosaveSuspended = false;
    _autosaveDismissBanner();
  });

  setTimeout(() => { _autosaveSuspended = false; _autosaveDismissBanner(); }, 60000);
}

window.addEventListener('beforeunload', () => {
  try { autosaveNow(); } catch (err) { /* never block unload */ }
});

function _autosaveInitStartup() {
  autosaveShowBannerIfPresent();
}

document.addEventListener('DOMContentLoaded', _autosaveInitStartup);
// In case this script runs after DOMContentLoaded already fired (it's loaded
// at the end of body via the build), also try immediately.
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  _autosaveInitStartup();
}
