// ─── MISSION EPOCH (T+0) PICKER ────────────────────────────────────────────
// Self-contained themed calendar popover. Nothing commits until Apply, so
// typing never triggers missionRecompute mid-edit (a native datetime-local
// input fired change on every intermediate value and the re-render destroyed
// the field). Generic: epochPickerOpen({ initialJD, anchorEl, onApply(jd) }).

let _epochPickerEl = null;
let _epochPickerCloseHandlers = null;

/** Tear down any currently-open picker (safe to call when none is open). */
function epochPickerClose() {
  if (_epochPickerCloseHandlers) {
    document.removeEventListener('keydown', _epochPickerCloseHandlers.onKey, true);
    document.removeEventListener('mousedown', _epochPickerCloseHandlers.onOutside, true);
    _epochPickerCloseHandlers = null;
  }
  if (_epochPickerEl && _epochPickerEl.parentNode) _epochPickerEl.parentNode.removeChild(_epochPickerEl);
  _epochPickerEl = null;
}

const _EPOCH_PICKER_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const _EPOCH_PICKER_DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

/**
 * Open the popover calendar. opts:
 *   initialJD  — Julian date to seed the picker with (falls back to "now")
 *   anchorEl   — element to anchor the popover under (viewport-positioned)
 *   onApply(jd)— called with the chosen Julian date ONLY when Apply is clicked
 */
function epochPickerOpen(opts) {
  opts = opts || {};
  epochPickerClose();

  const haveJD = (typeof progDateToJD === 'function');
  const seedDate = (haveJD && isFinite(opts.initialJD)) ? progJDToDate(opts.initialJD) : new Date();

  let viewYear = seedDate.getUTCFullYear();
  let viewMonth = seedDate.getUTCMonth();   // 0-11
  let selDay = seedDate.getUTCDate();
  let selHH = seedDate.getUTCHours();
  let selMM = seedDate.getUTCMinutes();

  const pop = document.createElement('div');
  pop.className = 'epoch-picker-pop';
  pop.setAttribute('role', 'dialog');
  pop.style.cssText = [
    'position:fixed', 'z-index:9999', 'min-width:250px',
    'background:var(--panel)', 'border:1px solid var(--border-bright)',
    'border-radius:6px', 'box-shadow:0 6px 24px rgba(0,0,0,.4)',
    'padding:10px', 'font-family:var(--sans)', 'font-size:11px',
    'color:var(--text)'
  ].join(';');
  document.body.appendChild(pop);
  _epochPickerEl = pop;

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function firstDow(y, m) { return new Date(Date.UTC(y, m, 1)).getUTCDay(); }

  const today = new Date();
  const isToday = (y, m, d) => y === today.getUTCFullYear() && m === today.getUTCMonth() && d === today.getUTCDate();

  function render() {
    const dim = daysInMonth(viewYear, viewMonth);
    const startDow = firstDow(viewYear, viewMonth);
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += `<div></div>`;
    for (let d = 1; d <= dim; d++) {
      const sel = (d === selDay);
      const tday = isToday(viewYear, viewMonth, d);
      const style = sel
        ? 'background:var(--accent);color:var(--bg);font-weight:600;'
        : (tday ? 'background:var(--accent-tint-soft);color:var(--text-bright);' : 'color:var(--text);');
      cells += `<div class="epoch-picker-day" data-day="${d}" style="cursor:pointer;text-align:center;padding:3px 0;border-radius:4px;${style}">${d}</div>`;
    }
    pop.innerHTML = `
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:6px;">
        <button type="button" class="act-btn ep-yr-back" title="Previous year" style="padding:1px 5px;">&#171;</button>
        <button type="button" class="act-btn ep-mo-back" title="Previous month" style="padding:1px 5px;">&#8249;</button>
        <span style="flex:1;text-align:center;font-weight:600;color:var(--text-bright);">${_EPOCH_PICKER_MONTHS[viewMonth]}</span>
        <input type="number" class="field ep-year-input" value="${viewYear}" step="1"
          style="width:56px;background:var(--input);color:var(--text-bright);border:1px solid var(--border);border-radius:3px;font-family:var(--mono);font-size:11px;padding:1px 2px;text-align:center;">
        <button type="button" class="act-btn ep-mo-fwd" title="Next month" style="padding:1px 5px;">&#8250;</button>
        <button type="button" class="act-btn ep-yr-fwd" title="Next year" style="padding:1px 5px;">&#187;</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;font-size:9px;color:var(--text-dim);text-align:center;margin-bottom:2px;">
        ${_EPOCH_PICKER_DOW.map(d => `<div>${d}</div>`).join('')}
      </div>
      <div class="ep-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;">${cells}</div>
      <div style="display:flex;align-items:center;gap:6px;margin:8px 0 2px;padding-top:6px;border-top:1px solid var(--border);">
        <span style="color:var(--text-dim);">UTC time</span>
        <input type="number" class="field ep-hh" min="0" max="23" value="${String(selHH).padStart(2,'0')}"
          style="width:36px;background:var(--input);color:var(--text-bright);border:1px solid var(--border);border-radius:3px;font-family:var(--mono);font-size:11px;padding:1px 2px;text-align:center;">
        <span>:</span>
        <input type="number" class="field ep-mm" min="0" max="59" value="${String(selMM).padStart(2,'0')}"
          style="width:36px;background:var(--input);color:var(--text-bright);border:1px solid var(--border);border-radius:3px;font-family:var(--mono);font-size:11px;padding:1px 2px;text-align:center;">
      </div>
      <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px;">
        <button type="button" class="act-btn ep-cancel">Cancel</button>
        <button type="button" class="act-btn ep-apply" style="background:var(--accent-tint-med);border-color:var(--accent);color:var(--text-bright);">Apply</button>
      </div>`;

    pop.querySelectorAll('.epoch-picker-day').forEach(el => {
      el.addEventListener('click', () => { selDay = parseInt(el.getAttribute('data-day'), 10); render(); });
    });
    pop.querySelector('.ep-mo-back').addEventListener('click', () => { shiftMonth(-1); });
    pop.querySelector('.ep-mo-fwd').addEventListener('click', () => { shiftMonth(1); });
    pop.querySelector('.ep-yr-back').addEventListener('click', () => { shiftYear(-1); });
    pop.querySelector('.ep-yr-fwd').addEventListener('click', () => { shiftYear(1); });
    const yrInput = pop.querySelector('.ep-year-input');
    yrInput.addEventListener('change', () => {
      const y = parseInt(yrInput.value, 10);
      if (isFinite(y)) { viewYear = y; clampSelDay(); render(); }
    });
    pop.querySelector('.ep-hh').addEventListener('change', function() {
      const v = parseInt(this.value, 10); selHH = isFinite(v) ? Math.max(0, Math.min(23, v)) : selHH;
    });
    pop.querySelector('.ep-mm').addEventListener('change', function() {
      const v = parseInt(this.value, 10); selMM = isFinite(v) ? Math.max(0, Math.min(59, v)) : selMM;
    });
    pop.querySelector('.ep-cancel').addEventListener('click', () => epochPickerClose());
    pop.querySelector('.ep-apply').addEventListener('click', () => applyAndClose());
  }

  function clampSelDay() {
    const dim = daysInMonth(viewYear, viewMonth);
    if (selDay > dim) selDay = dim;
  }
  function shiftMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    else if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    clampSelDay();
    render();
  }
  function shiftYear(delta) {
    viewYear += delta;
    clampSelDay();
    render();
  }

  function applyAndClose() {
    // Read live HH/MM values in case the user tabbed away without a
    // change-event firing yet (Apply is the single commit point regardless).
    const hhEl = pop.querySelector('.ep-hh'), mmEl = pop.querySelector('.ep-mm');
    const hh = hhEl ? Math.max(0, Math.min(23, parseInt(hhEl.value, 10) || 0)) : selHH;
    const mm = mmEl ? Math.max(0, Math.min(59, parseInt(mmEl.value, 10) || 0)) : selMM;
    const d = new Date(Date.UTC(viewYear, viewMonth, selDay, hh, mm, 0));
    const jd = haveJD ? progDateToJD(d) : NaN;
    epochPickerClose();
    if (typeof opts.onApply === 'function') opts.onApply(jd);
  }

  render();

  // Position under the anchor element (viewport coords; popover is `fixed`).
  if (opts.anchorEl && opts.anchorEl.getBoundingClientRect) {
    const r = opts.anchorEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 4;
    if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - popRect.width - 8;
    if (top + popRect.height > window.innerHeight - 8) top = r.top - popRect.height - 4;
    pop.style.left = Math.max(4, left) + 'px';
    pop.style.top = Math.max(4, top) + 'px';
  } else {
    pop.style.left = '50%'; pop.style.top = '20%'; pop.style.transform = 'translateX(-50%)';
  }

  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); epochPickerClose(); } };
  const onOutside = (ev) => { if (_epochPickerEl && !_epochPickerEl.contains(ev.target) && ev.target !== opts.anchorEl) epochPickerClose(); };
  document.addEventListener('keydown', onKey, true);
  // Defer outside-click wiring one tick so the click that OPENED the popover
  // (still bubbling) doesn't immediately close it.
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
  _epochPickerCloseHandlers = { onKey, onOutside };
}
