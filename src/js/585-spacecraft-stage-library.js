
// ─── SPACECRAFT STAGE LIBRARY ───────────────────────────────────────────────
// A flat (uncategorized) library of reusable spacecraft-stage definitions.
// Populated by "↓ Lib" on a stage card, by the "+ New Stage" standalone editor,
// or by uploading a .scstage file. Lives in a session-global array AND travels
// inside saved .program files (see buildProgramObject / applyProgramObject).
// Drag a library stage into a spacecraft's stage stack to add it.

let _scStageLib       = [];     // [{ libId, name, dry_mass, isp, propKg, propType, … }]
let _scStageLibQuery  = '';     // library search text
let _scStageInfoSel   = null;   // libId shown in the info modal
let _scStageEditId    = null;   // libId being edited in the New/Edit modal (null = new)

// Clean stage spec (no libId / stageId) — the canonical shape shared by the
// spacecraft editor, the library, and .scstage files.
function _scStageSpec(o) {
  return {
    name:                String(o.name || 'Stage'),
    dry_mass:            o.dry_mass || 0,
    isp:                 o.isp || 0,
    propKg:              o.propKg || 0,
    propType:            o.propType || 'NTO_A50',
    crewCapacity:        o.crewCapacity || 0,
    dockingPorts:        o.dockingPorts || 0,
    tunnelCapable:       !!o.tunnelCapable,
    isLandingTruss:      !!o.isLandingTruss,
    descentPropFraction: o.descentPropFraction || 0,
  };
}

// ── populate the library ────────────────────────────────────────────────────
function scStageLibSaveFromCard(scId, idx) {
  const sc = _scEdGet(scId);
  if (!sc || !sc.stages[idx]) return;
  _scStageLib.unshift({ libId: progUUID(), ..._scStageSpec(sc.stages[idx]) });
  scStageLibRender();
  if (typeof showToast === 'function') showToast('Saved “' + sc.stages[idx].name + '” to Stage Library');
}

// ── use a library stage ─────────────────────────────────────────────────────
function scStageLibAddToCraft(libId) {
  const sc = _scEdGet();
  if (!sc) { if (typeof showAlert === 'function') showAlert('Select or create a spacecraft first.', 'No Spacecraft'); return; }
  const lib = _scStageLib.find(s => s.libId === libId);
  if (!lib) return;
  sc.stages.push({ stageId: progUUID(), ..._scStageSpec(lib) });
  scEdRenderDetail();
  scEdRenderList();
}

// ── drag & drop (into the spacecraft stage stack) ───────────────────────────
function scStageLibDragStart(e, libId) {
  e.dataTransfer.setData('text/plain', 'scstage:' + libId);
  e.dataTransfer.effectAllowed = 'copy';
}
function scStageDrop(e) {
  e.preventDefault(); e.currentTarget.classList.remove('drop-hot');
  const d = e.dataTransfer.getData('text/plain') || '';
  if (!d.startsWith('scstage:')) return;
  scStageLibAddToCraft(d.slice('scstage:'.length));
}

// ── library panel (rendered under the spacecraft detail) ────────────────────
function scStageLibRender() {
  const inp = document.getElementById('scstage-lib-search');
  if (inp) _scStageLibQuery = inp.value;
  const grid = document.getElementById('scstage-lib-grid');
  if (grid) grid.innerHTML = _scStageLibChipsHTML();
}
function _scStageLibChipsHTML() {
  const q = (_scStageLibQuery || '').toLowerCase();
  const items = _scStageLib.filter(s => !q || (s.name || '').toLowerCase().includes(q));
  if (!items.length) return '<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);padding:8px;">No saved stages yet — use “↓ Lib” on a stage card or “+ New Stage”.</div>';
  return '<div class="fleet-lib-row">' + items.map(s => {
    const crew = s.crewCapacity ? ` · ${s.crewCapacity} crew` : '';
    return `<div class="fleet-lib-chip" draggable="true" ondragstart="scStageLibDragStart(event,'${s.libId}')" onclick="scStageLibInfo('${s.libId}')" title="Click for details · drag into the stage stack">
      <span class="fleet-lib-chip-name">${s.name}</span>
      <span class="fleet-lib-chip-sub">${(s.dry_mass||0).toLocaleString()} kg dry${s.propKg ? ` · ${s.propKg.toLocaleString()} kg prop` : ''}${crew}</span></div>`;
  }).join('') + '</div>';
}
function _scStageLibPanelHTML() {
  return `<div class="fleet-lib-panel">
    <div class="fleet-lib-hdr">
      <span>Stage Library</span>
      <input id="scstage-lib-search" class="fleet-lib-search" placeholder="Search stages…" oninput="scStageLibRender()" value="${(_scStageLibQuery || '').replace(/"/g,'&quot;')}">
      <button class="act-btn" onclick="scStageLibOpenNew()">+ New Stage</button>
      <label class="act-btn" style="cursor:pointer;">Load Stage<input type="file" accept=".scstage,.json" style="display:none" onchange="scStageLibLoadFile(this)"></label>
      <span class="fleet-lib-hint">drag a stage into the spacecraft's stage stack</span>
    </div>
    <div id="scstage-lib-grid" class="fleet-lib-grid">${_scStageLibChipsHTML()}</div>
  </div>`;
}

// ── New / Edit standalone stage editor (modal) ──────────────────────────────
function scStageLibOpenNew(editLibId) {
  _scStageEditId = editLibId || null;
  const s = editLibId ? (_scStageLib.find(x => x.libId === editLibId) || {}) : {};
  const v = _scStageSpec(s);
  const propOpts = Object.entries(PROG_PROPELLANT_TYPES).map(([k, p]) =>
    `<option value="${k}"${v.propType === k ? ' selected' : ''}>${p.label}</option>`).join('');
  const body = document.getElementById('scstage-new-body');
  if (!body) return;
  body.innerHTML = `
    <div class="cfg-item" style="margin-bottom:10px;"><label>Stage Name</label>
      <input type="text" id="scn-name" class="field" style="width:100%;max-width:340px;" value="${(v.name === 'Stage' && !editLibId ? '' : v.name).replace(/"/g,'&quot;')}" placeholder="e.g. Service Module"></div>
    <div class="cfg-row" style="gap:16px;margin-bottom:8px;flex-wrap:wrap;">
      <div class="cfg-item"><label>Dry Mass (kg)</label><input type="number" id="scn-dry" class="field" min="0" value="${v.dry_mass}" style="width:100px"></div>
      <div class="cfg-item"><label>Isp (s)</label><input type="number" id="scn-isp" class="field" min="0" value="${v.isp}" style="width:80px"></div>
      <div class="cfg-item"><label>Propellant (kg)</label><input type="number" id="scn-prop" class="field" min="0" value="${v.propKg}" style="width:110px"></div>
      <div class="cfg-item"><label>Prop Type</label><select id="scn-ptype" class="field" style="width:170px">${propOpts}</select></div>
    </div>
    <div class="cfg-row" style="gap:16px;padding-top:8px;border-top:1px solid var(--border);flex-wrap:wrap;">
      <div class="cfg-item"><label>Crew Capacity</label><input type="number" id="scn-crew" class="field" min="0" value="${v.crewCapacity}" style="width:80px"></div>
      <div class="cfg-item"><label>Docking Ports</label><input type="number" id="scn-dock" class="field" min="0" value="${v.dockingPorts}" style="width:80px"></div>
    </div>`;
  const title = document.getElementById('scstage-new-title');
  if (title) title.textContent = editLibId ? 'Edit Stage' : 'New Stage';
  openModal('modal-scstage-new');
  setTimeout(() => document.getElementById('scn-name')?.focus(), 80);
}
function scStageLibSaveNew() {
  const g = id => document.getElementById(id);
  const spec = _scStageSpec({
    name:                g('scn-name')?.value.trim() || 'Stage',
    dry_mass:            +g('scn-dry')?.value  || 0,
    isp:                 +g('scn-isp')?.value  || 0,
    propKg:              +g('scn-prop')?.value || 0,
    propType:            g('scn-ptype')?.value || 'NTO_A50',
    crewCapacity:        +g('scn-crew')?.value || 0,
    dockingPorts:        +g('scn-dock')?.value || 0,
    tunnelCapable:       false,
    isLandingTruss:      false,
    descentPropFraction: 0,
  });
  if (_scStageEditId) {
    const e = _scStageLib.find(x => x.libId === _scStageEditId);
    if (e) Object.assign(e, spec);
  } else {
    _scStageLib.unshift({ libId: progUUID(), ...spec });
  }
  _scStageEditId = null;
  closeModal('modal-scstage-new');
  scStageLibRender();
}

// ── info / preview modal (click a chip) ─────────────────────────────────────
function scStageLibInfo(libId) {
  const s = _scStageLib.find(x => x.libId === libId);
  if (!s) return;
  _scStageInfoSel = libId;
  const titleEl = document.getElementById('scstage-info-title');
  if (titleEl) titleEl.textContent = s.name;
  const pt = (PROG_PROPELLANT_TYPES[s.propType] || {}).label || s.propType;
  const dv = (s.propKg > 0 && s.isp > 0) ? progRocketEqDv((s.dry_mass||0) + (s.propKg||0), s.propKg, s.isp) : 0;
  const row = (k, v) => `<tr><td class="rl">${k}</td><td style="text-align:right;color:var(--text-bright)">${v}</td></tr>`;
  const body = document.getElementById('scstage-info-body');
  if (body) body.innerHTML = `<table class="sc-dv-tbl" style="width:100%"><tbody>
    ${row('Dry mass', (s.dry_mass||0).toLocaleString() + ' kg')}
    ${row('Propellant', (s.propKg||0).toLocaleString() + ' kg')}
    ${row('Isp', (s.isp||0) + ' s')}
    ${row('Prop type', pt)}
    ${row('Stage ΔV (alone)', dv > 0 ? Math.round(dv).toLocaleString() + ' m/s' : '—')}
    ${row('Crew capacity', s.crewCapacity || 0)}
    ${row('Docking ports', s.dockingPorts || 0)}
  </tbody></table>`;
  openModal('modal-scstage-info');
}
function scStageInfoAdd()    { if (_scStageInfoSel) scStageLibAddToCraft(_scStageInfoSel); closeModal('modal-scstage-info'); }
function scStageInfoEdit()   { const id = _scStageInfoSel; closeModal('modal-scstage-info'); scStageLibOpenNew(id); }
function scStageInfoDelete() { _scStageLib = _scStageLib.filter(s => s.libId !== _scStageInfoSel); closeModal('modal-scstage-info'); scStageLibRender(); }
function scStageInfoDownload(){ scStageLibDownload(_scStageInfoSel); }

// ── download / upload (.scstage) ────────────────────────────────────────────
function scStageLibDownload(libId) {
  const s = _scStageLib.find(x => x.libId === libId);
  if (!s) return;
  const obj = { kind: 'rocket-playground-scstage', formatVersion: 1, ..._scStageSpec(s) };
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (s.name || 'stage').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() + '.scstage';
  a.click();
  URL.revokeObjectURL(a.href);
}
function scStageLibLoadFile(input) {
  const f = input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const o = JSON.parse(e.target.result);
      if (o.dry_mass === undefined && o.name === undefined) { showAlert('Not a spacecraft stage file.', 'Invalid File'); }
      else { _scStageLib.unshift({ libId: progUUID(), ..._scStageSpec(o) }); scStageLibRender(); }
    } catch (err) { showAlert('Invalid stage file: ' + err.message, 'Invalid File'); }
    input.value = '';
  };
  r.readAsText(f);
}
