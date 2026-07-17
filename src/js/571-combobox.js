// ─── Generic search-combobox helper ────────────────────────────────────────
// Reused by the LAUNCH card's vehicle picker and payload picker (see
// docs/MISSION_MODEL_V2.md s12 addendum, "LAUNCH card LV/payload search").
// Pattern follows 578-mission-epoch-picker.js: a body-appended floating
// popover, capture-phase Escape (stopPropagation so it doesn't ALSO cancel
// the whole pending event card via 575-mission-undo.js's document Escape
// listener, which runs in the bubble phase), and a deferred outside-click
// listener (deferred one tick so the click that opened the combobox doesn't
// immediately close it).
//
// Regression this exists to fix: the unified pending-card LAUNCH form
// (e1b08583f) rendered its vehicle <select> straight from `_fleetEntries`
// (src/js/570-mission-cards.js) instead of the old dock's
// `_missionLvPickerOptsHTML` (src/js/570-mission-manager.js), which is the
// ONLY place that also listed Built-in/My Vehicles and snapshotted a picked
// library vehicle into `_fleetEntries` via `_fleetVehicleSpecFromLib`
// (`missionPickLibVehicle`, now dead code with no callers). `_fleetEntries`
// starts empty in every fresh program, so the LAUNCH form's dropdown had
// nothing to show and picking never fired the snapshot path -> "blank
// dropdown, does nothing." The combobox picker below restores the
// Built-in/My Vehicles/Program grouping AND the on-pick snapshot behavior.

let _comboPopEl = null;
let _comboCloseHandlers = null;

/** Tear down any currently-open combobox popover (safe if none is open). */
function comboboxClose() {
  if (_comboCloseHandlers) {
    document.removeEventListener('keydown', _comboCloseHandlers.onKey, true);
    document.removeEventListener('mousedown', _comboCloseHandlers.onOutside, true);
    if (_comboCloseHandlers.inputEl) _comboCloseHandlers.inputEl.removeEventListener('input', _comboCloseHandlers.onInput);
    _comboCloseHandlers = null;
  }
  if (_comboPopEl && _comboPopEl.parentNode) _comboPopEl.parentNode.removeChild(_comboPopEl);
  _comboPopEl = null;
}

/**
 * Open a filtered, keyboard-navigable dropdown anchored under a text input.
 * opts:
 *   inputEl     — the <input type="text"> the user types into (also the anchor)
 *   groups()    — fn returning [{ label, items:[{value,label}] }]; called on
 *                 every keystroke so callers can recompute from live state
 *                 (e.g. `_fleetEntries` growing as vehicles get snapshotted)
 *   onPick(item)— called with the chosen {value,label} on select; the popover
 *                 is already closed by the time this runs
 */
function comboboxOpen(opts) {
  const { inputEl, groups, onPick } = opts || {};
  if (!inputEl) return;
  comboboxClose();
  let activeIdx = -1;

  const pop = document.createElement('div');
  pop.className = 'combo-pop';
  pop.setAttribute('role', 'listbox');
  pop.style.cssText = [
    'position:fixed', 'z-index:9999', 'min-width:180px', 'max-height:260px', 'overflow:auto',
    'background:var(--panel)', 'border:1px solid var(--border-bright)', 'border-radius:6px',
    'box-shadow:0 6px 24px rgba(0,0,0,.4)', 'padding:4px', 'font-family:var(--mono)', 'font-size:11px'
  ].join(';');
  document.body.appendChild(pop);
  _comboPopEl = pop;

  function esc(s) { return (typeof _mrEsc === 'function') ? _mrEsc(s) : String(s == null ? '' : s); }

  function filteredGroups() {
    const q = (inputEl.value || '').trim().toLowerCase();
    const out = [];
    (groups() || []).forEach(g => {
      const matches = (g.items || []).filter(it => !q || it.label.toLowerCase().includes(q));
      if (matches.length) out.push({ label: g.label, items: matches });
    });
    return out;
  }

  function render() {
    const gs = filteredGroups();
    const flat = [];
    gs.forEach(g => g.items.forEach(it => flat.push(it)));
    if (activeIdx >= flat.length) activeIdx = flat.length - 1;
    let html = '';
    if (!flat.length) html = '<div style="padding:6px 8px;color:var(--text-dim);">No matches</div>';
    let i = 0;
    gs.forEach(g => {
      if (g.label) html += `<div style="padding:3px 8px;color:var(--text-dim);font-size:9px;text-transform:uppercase;letter-spacing:.03em;">${esc(g.label)}</div>`;
      g.items.forEach(it => {
        const isActive = i === activeIdx;
        html += `<div class="combo-item" data-idx="${i}" style="padding:5px 8px;cursor:pointer;border-radius:4px;color:var(--text-bright);${isActive ? 'background:var(--accent-tint-med);' : ''}">${esc(it.label)}</div>`;
        i++;
      });
    });
    pop.innerHTML = html;
    pop._flat = flat;
    pop.querySelectorAll('.combo-item').forEach(el => {
      // mousedown (not click) so the pick fires before the input's blur tears the popover down.
      el.addEventListener('mousedown', ev => {
        ev.preventDefault();
        pick(pop._flat[parseInt(el.getAttribute('data-idx'), 10)]);
      });
      el.addEventListener('mouseenter', () => { activeIdx = parseInt(el.getAttribute('data-idx'), 10); render(); });
    });
    position();
  }

  function position() {
    const r = inputEl.getBoundingClientRect();
    pop.style.left = Math.max(4, r.left) + 'px';
    pop.style.top = (r.bottom + 4) + 'px';
    pop.style.width = Math.max(180, r.width) + 'px';
  }

  function pick(item) {
    if (!item) return;
    comboboxClose();
    if (typeof onPick === 'function') onPick(item);
  }

  const onInput = () => { activeIdx = -1; render(); };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); comboboxClose(); return; }
    const flat = pop._flat || [];
    if (ev.key === 'ArrowDown') { ev.preventDefault(); activeIdx = Math.min(flat.length - 1, activeIdx + 1); render(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); render(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (activeIdx >= 0 && flat[activeIdx]) pick(flat[activeIdx]); }
  };
  const onOutside = (ev) => { if (_comboPopEl && !_comboPopEl.contains(ev.target) && ev.target !== inputEl) comboboxClose(); };

  inputEl.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
  _comboCloseHandlers = { onKey, onOutside, onInput, inputEl };

  render();
}
