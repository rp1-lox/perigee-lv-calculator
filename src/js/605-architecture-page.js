// ─────────────────────────────────────────────────────────────────────────────
// 605-architecture-page.js — Architecture page rendering + handlers (A2)
// MISSION_MODEL_V2.md §26. OWNS: `#arch-ladder-list` card rendering (canonical
// inline edit, accordion, mirrors 570-mission-cards.js's mevt-evt-row markup),
// the preset picker (571-combobox over refOrbitCatalogList), add/delete/
// reorder, and the page-scoped undo/redo keyboard shortcut. Keeps
// 600-architecture-model.js pure — every mutation here goes through its CRUD
// (archAddNode/archRemoveNode/archUpdateNode/archMoveNode/archNodeDetachRef)
// then archRenderPage() then autosaveScheduleSave(), never touches
// PROG_ACTIVE_PROGRAM.architecture directly.
// ─────────────────────────────────────────────────────────────────────────────

// Single-expansion accordion state, mirrors missionSelectEvent's convention —
// module-local (not persisted; purely a UI cursor).
let _archExpandedId = null;

function archRenderPage() {
  const list = document.getElementById('arch-ladder-list');
  const stage = document.querySelector('#page-architecture .arch-stage .placeholder-msg');
  const budget = document.getElementById('arch-dv-budget');
  if (!list) return;
  const arch = archGet();
  const nodes = arch.nodes || [];

  if (stage) {
    stage.textContent = nodes.length
      ? 'Node map mounts here (A3) — ladder nodes are authored in the rail →'
      : 'No architecture yet — add orbits from the rail';
  }

  list.innerHTML = nodes.length
    ? nodes.map((n, i) => _archNodeCardHTML(n, i, nodes.length)).join('')
    : '<div class="placeholder-msg" style="padding:14px;">No orbits in the ladder yet — add one below.</div>';

  list.innerHTML += _archPresetPickerHTML();

  if (budget) {
    // A3 fills the real dV chain accounting; A2 just states the honest count.
    budget.textContent = nodes.length
      ? `${nodes.length} node${nodes.length === 1 ? '' : 's'} in ladder · edges/dV budget: A3`
      : '';
  }
}

function _archOrbitSummary(o) {
  if (!o) return '';
  const peri = (o.periKm || 0).toLocaleString();
  const apo = (o.apoKm || 0).toLocaleString();
  const radii = (o.apoKm !== o.periKm) ? `${peri} × ${apo} km` : `${peri} km`;
  return `${radii} @ ${o.incDeg || 0}&deg;`;
}

function _archNodeCardHTML(n, i, count) {
  const expanded = n.id === _archExpandedId;
  const upDis = (i <= 0) ? ' disabled' : '';
  const dnDis = (i >= count - 1) ? ' disabled' : '';
  const refEntry = (n.orbitRefId && typeof refOrbitCatalogList === 'function')
    ? refOrbitCatalogList().find(r => r.id === n.orbitRefId) : null;
  const boundNote = refEntry ? escHtml(refEntry.name) : '(custom)';
  const ctl = `<div class="mevt-ctlbar">
      <button class="act-btn mevt-ctl" onclick="event.stopPropagation();archMoveNode('${n.id}',-1);archRenderPage();autosaveScheduleSave();" title="Move up"${upDis}>&#9650;</button>
      <button class="act-btn mevt-ctl" onclick="event.stopPropagation();archMoveNode('${n.id}',1);archRenderPage();autosaveScheduleSave();" title="Move down"${dnDis}>&#9660;</button>
      <button class="act-btn mevt-ctl" onclick="event.stopPropagation();_archDeleteNode('${n.id}')" title="Delete node">&#10005;</button>
    </div>`;
  const bodyHTML = expanded ? _archNodeEditFieldsHTML(n) : '';
  return `<div id="arch-node-${n.id}" class="mcc-evt-row${expanded ? ' sel' : ''}">
    <div class="mevt-head" onclick="_archSelectNode('${n.id}')">
      <span class="mevt-caret">${expanded ? '&#9662;' : '&#9656;'}</span>
      <span class="mission-log-type">${escHtml(n.name || 'Orbit')}</span>
      <span class="mevt-sub">${escHtml(n.body || 'Earth')} &middot; ${_archOrbitSummary(n.orbit)}</span>
      ${ctl}
    </div>
    ${expanded ? `<div class="mevt-body">${bodyHTML}</div>` : ''}
  </div>`;
}

function _archNodeEditFieldsHTML(n) {
  const o = n.orbit || {};
  const id = n.id;
  const bodyOpts = Object.keys((typeof PROG_BODIES !== 'undefined' && PROG_BODIES) || {})
    .map(b => `<option value="${escHtml(b)}"${b === n.body ? ' selected' : ''}>${escHtml(b)}</option>`).join('');
  const refEntry = (n.orbitRefId && typeof refOrbitCatalogList === 'function')
    ? refOrbitCatalogList().find(r => r.id === n.orbitRefId) : null;
  const refNote = refEntry ? escHtml(refEntry.name) : '(custom)';
  return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
    <div class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
      <div class="cfg-item"><label class="cfg-label">Name</label>
        <input type="text" id="arch-edit-name-${id}" class="field" value="${escHtml(n.name || '')}" style="width:160px;" maxlength="60"></div>
      <div class="cfg-item"><label class="cfg-label">Body</label>
        <select id="arch-edit-body-${id}" class="field">${bodyOpts}</select></div>
      <div class="cfg-item"><label class="cfg-label">Ref Orbit</label>
        <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${refNote}</span></div>
    </div>
    <div class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
      <div class="cfg-item"><label class="cfg-label">Perigee (km)</label>
        <input type="number" id="arch-edit-peri-${id}" class="field" value="${o.periKm ?? 200}" style="width:90px;" oninput="archNodeDetachRef('${id}')"></div>
      <div class="cfg-item"><label class="cfg-label">Apogee (km)</label>
        <input type="number" id="arch-edit-apo-${id}" class="field" value="${o.apoKm ?? o.periKm ?? 200}" style="width:90px;" oninput="archNodeDetachRef('${id}')"></div>
      <div class="cfg-item"><label class="cfg-label">Inc (deg)</label>
        <input type="number" id="arch-edit-inc-${id}" class="field" value="${o.incDeg ?? 0}" style="width:80px;" oninput="archNodeDetachRef('${id}')"></div>
      <div class="cfg-item"><label class="cfg-label">LAN (deg)</label>
        <input type="number" id="arch-edit-lan-${id}" class="field" value="${o.lanDeg ?? 0}" style="width:80px;" oninput="archNodeDetachRef('${id}')"></div>
    </div>
    <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="_archApplyNodeEdit('${id}')">Apply</button>
  </div>`;
}

function _archSelectNode(id) {
  _archExpandedId = (_archExpandedId === id) ? null : id;
  archRenderPage();
}

function _archApplyNodeEdit(id) {
  const nameEl = document.getElementById('arch-edit-name-' + id);
  const bodyEl = document.getElementById('arch-edit-body-' + id);
  const periEl = document.getElementById('arch-edit-peri-' + id);
  const apoEl = document.getElementById('arch-edit-apo-' + id);
  const incEl = document.getElementById('arch-edit-inc-' + id);
  const lanEl = document.getElementById('arch-edit-lan-' + id);
  if (!nameEl || !bodyEl || !periEl || !apoEl || !incEl || !lanEl) return;
  const body = bodyEl.value;
  const orbit = {
    body,
    periKm: parseFloat(periEl.value) || 0,
    apoKm: parseFloat(apoEl.value) || 0,
    incDeg: parseFloat(incEl.value) || 0,
    lanDeg: parseFloat(lanEl.value) || 0,
    frame: 'eq',
  };
  archUpdateNode(id, { name: nameEl.value.trim() || 'Orbit', body, orbit });
  archRenderPage();
  autosaveScheduleSave();
}

function _archDeleteNode(id) {
  archRemoveNode(id);
  if (_archExpandedId === id) _archExpandedId = null;
  archRenderPage();
  autosaveScheduleSave();
}

// ── Preset picker + "+ Custom orbit" (below the ladder) ─────────────────────

function _archPresetPickerHTML() {
  return `<div class="arch-add-row" style="padding:10px 8px;border-top:1px solid var(--border);">
    <input type="text" id="arch-preset-q" class="mcc-field-select" autocomplete="off"
      placeholder="Search reference orbits to add..." value=""
      style="width:100%;box-sizing:border-box;margin-bottom:6px;"
      onfocus="_archPresetComboOpen()" onclick="_archPresetComboOpen()">
    <button class="act-btn" style="width:100%;justify-content:center;" onclick="_archAddCustomNode()">+ Custom orbit</button>
  </div>`;
}

function _archPresetComboOpen() {
  const inputEl = document.getElementById('arch-preset-q');
  if (!inputEl || typeof comboboxOpen !== 'function') return;
  comboboxOpen({
    inputEl,
    groups: () => {
      const opts = (typeof refOrbitCatalogList === 'function') ? refOrbitCatalogList() : [];
      const keplerian = opts.filter(r => r.kind === 'keplerian');
      return keplerian.length ? [{ label: 'Reference Orbits', items: keplerian.map(r => ({ value: r.id, label: r.name })) }] : [];
    },
    onPick: (item) => _archPresetPick(item.value)
  });
}

function _archPresetPick(refId) {
  const resolved = (typeof refOrbitResolve === 'function') ? refOrbitResolve(refId) : null;
  if (!resolved || resolved.kind !== 'keplerian') return; // v1: no propagated architecture nodes
  const refEntry = (typeof refOrbitCatalogList === 'function') ? refOrbitCatalogList().find(r => r.id === refId) : null;
  const node = archAddNode({
    name: refEntry ? refEntry.name : 'Orbit',
    body: resolved.body,
    orbit: resolved,
    orbitRefId: refId,
  });
  if (!node) return;
  const q = document.getElementById('arch-preset-q');
  if (q) q.value = '';
  archRenderPage();
  autosaveScheduleSave();
}

function _archAddCustomNode() {
  const node = archAddNode({
    name: 'New Orbit',
    body: 'Earth',
    orbit: { body: 'Earth', periKm: 200, apoKm: 200, incDeg: 28.5, lanDeg: 0, frame: 'eq' },
  });
  if (!node) return;
  _archExpandedId = node.id;
  archRenderPage();
  autosaveScheduleSave();
}

// ── Page-scoped undo/redo (Ctrl+Z/Ctrl+Y) ────────────────────────────────────
// Own architecture undo stack (600), NOT the mission stream (575) — but the
// input-editable-target guard is shared (_uiEditableTarget, 575) so both
// page-scoped shortcuts agree on when a keystroke belongs to a text field
// instead of the shortcut.
document.addEventListener('keydown', e => {
  const pg = document.getElementById('page-architecture');
  const visible = pg && getComputedStyle(pg).display !== 'none';
  if (!visible) return;
  if (typeof _uiEditableTarget === 'function' && _uiEditableTarget(e)) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (archUndo()) { _archExpandedId = null; archRenderPage(); autosaveScheduleSave(); }
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault();
    if (archRedo()) { _archExpandedId = null; archRenderPage(); autosaveScheduleSave(); }
  }
});
