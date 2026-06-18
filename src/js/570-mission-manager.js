
// ─── MISSION MANAGER ─────────────────────────────────────────────────────

let _missions = [];
let _missionSel = null;
let _missionViewMode  = 'band';       // 'band' | 'nodemap'  — band is the primary view
let _missionEvtFilter = { type: 'ALL', veh: 'ALL' };   // events-list filter
let _missionBandScrub = null;
let _missionBandSpacing = 90;          // px per timeline column (user-configurable)
let _missionBandZoom = 1;              // band-view zoom factor (scales rendered SVG)

function missionBandSpacing(id, dir) {
  _missionBandSpacing = Math.max(45, Math.min(260, _missionBandSpacing + dir * 20));
  missionRenderDetail();
}
function missionBandZoom(id, dir) {
  if (dir === 0) { _missionBandZoom = 1; }
  else _missionBandZoom = Math.max(0.5, Math.min(3, +(_missionBandZoom + dir * 0.25).toFixed(2)));
  missionRenderDetail();
}
// Scroll-wheel zoom for the band view, anchored on the cursor. Resizes the SVG
// in place (no re-render) so scroll position is preserved.
function missionBandWheel(e, id) {
  e.preventDefault();
  const sc = e.currentTarget;
  const svg = sc.querySelector('svg');
  if (!svg) return;
  const prev = _missionBandZoom;
  const dir = e.deltaY < 0 ? 1 : -1;
  _missionBandZoom = Math.max(0.5, Math.min(3, +(prev + dir * 0.15).toFixed(3)));
  if (_missionBandZoom === prev) return;
  const ratio = _missionBandZoom / prev;
  const rect = sc.getBoundingClientRect();
  const ax = e.clientX - rect.left, ay = e.clientY - rect.top;     // cursor anchor in viewport
  const wx = sc.scrollLeft + ax, wy = sc.scrollTop + ay;           // anchor in content
  const w = parseFloat(svg.getAttribute('width')) || svg.clientWidth;
  const h = parseFloat(svg.getAttribute('height')) || svg.clientHeight;
  svg.setAttribute('width', Math.round(w * ratio));
  svg.setAttribute('height', Math.round(h * ratio));
  sc.scrollLeft = wx * ratio - ax;
  sc.scrollTop  = wy * ratio - ay;
  // keep the zoom %-readout in the legend in sync without a full re-render
  const pct = sc.parentElement && sc.parentElement.querySelector('button[onclick*="missionBandZoom(\'' + id + '\',0)"]');
  if (pct) pct.textContent = Math.round(_missionBandZoom * 100) + '%';
}
function missionToggleSameTime(id, idx) {
  const m = _missionGet(id);
  if (!m || !m.log[idx] || idx < 1) return;
  m.log[idx].sameTimeAsPrev = !m.log[idx].sameTimeAsPrev;
  missionRenderDetail();
}
function missionToggleMidCoast(id, idx) {
  const m = _missionGet(id);
  if (!m || !m.log[idx] || idx < 1) return;
  m.log[idx].midCoast = !m.log[idx].midCoast;
  if (m.log[idx].midCoast) m.log[idx].sameTimeAsPrev = false;   // mutually exclusive placement
  missionRenderDetail();
}

// ── Event groups (repeatable blocks, e.g. a refuelling or crew-rotation cycle) ──
let _missionGroupMode = false;     // true while picking a range to group
let _missionGroupStart = null;     // first picked event index

function missionToggleGroupMode(id) {
  _missionGroupMode = !_missionGroupMode;
  _missionGroupStart = null;
  missionRenderDetail();
}
function missionGroupPick(id, i) {
  const m = _missionGet(id); if (!m) return;
  if (_missionGroupStart == null) { _missionGroupStart = i; missionRenderDetail(); return; }
  let a = _missionGroupStart, b = i; if (b < a) { const t = a; a = b; b = t; }
  _missionGroupStart = null; _missionGroupMode = false;
  // reject if any event in range is already grouped
  for (let k = a; k <= b; k++) { if (m.log[k].groupId) { missionRenderDetail(); return; } }
  missionOpenGroupModal(id, a, b, '');
  missionRenderDetail();
}
function missionOpenGroupModal(id, start, end, gid) {
  const m = _missionGet(id); if (!m) return;
  const g = (gid && m.groups && m.groups[gid]) || {};
  const body = document.getElementById('mgroup-body'); if (!body) return;
  const n = end - start + 1;
  body.innerHTML = `
    <input type="hidden" id="mgroup-id" value="${id}">
    <input type="hidden" id="mgroup-start" value="${start}">
    <input type="hidden" id="mgroup-end" value="${end}">
    <input type="hidden" id="mgroup-gid" value="${gid || ''}">
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-bottom:10px;">${n} event${n!==1?'s':''} — repeated as one block during the simulation.</div>
    <label class="cfg-label">Loop name</label>
    <input id="mgroup-name" class="mcc-field-input" style="width:100%;margin-bottom:10px;" value="${(g.name||'Loop').replace(/"/g,'&quot;')}" maxlength="40">
    <label class="cfg-label">Repeat (×)</label>
    <input id="mgroup-rep" type="number" class="field" min="1" max="99" value="${g.repeat||2}" style="width:90px;margin-bottom:12px;">
    <div style="display:flex;justify-content:flex-end;gap:8px;">
      <button class="act-btn" onclick="closeModal('modal-mission-group')">Cancel</button>
      <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;" onclick="missionGroupSave()">${gid?'Save':'Create Loop'}</button>
    </div>`;
  openModal('modal-mission-group');
  setTimeout(() => { const el = document.getElementById('mgroup-name'); if (el) { el.focus(); el.select(); } }, 30);
}
function missionGroupSave() {
  const id = document.getElementById('mgroup-id')?.value;
  const m = _missionGet(id); if (!m) return;
  const start = parseInt(document.getElementById('mgroup-start')?.value, 10);
  const end = parseInt(document.getElementById('mgroup-end')?.value, 10);
  let gid = document.getElementById('mgroup-gid')?.value || '';
  const name = (document.getElementById('mgroup-name')?.value || 'Loop').trim().slice(0, 40);
  const repeat = Math.max(1, Math.min(99, parseInt(document.getElementById('mgroup-rep')?.value, 10) || 1));
  m.groups = m.groups || {};
  if (!gid) {
    gid = 'g' + progUUID().slice(0, 8);
    for (let k = start; k <= end; k++) m.log[k].groupId = gid;
  }
  m.groups[gid] = { name, repeat };
  closeModal('modal-mission-group');
  missionRecompute(m);
  missionRenderDetail();
}
function missionGroupRepeat(id, gid, delta) {
  const m = _missionGet(id); if (!m || !m.groups || !m.groups[gid]) return;
  m.groups[gid].repeat = Math.max(1, Math.min(99, (m.groups[gid].repeat || 1) + delta));
  missionRecompute(m);
  missionRenderDetail();
}
function missionUngroup(id, gid) {
  const m = _missionGet(id); if (!m) return;
  m.log.forEach(e => { if (e.groupId === gid) delete e.groupId; });
  if (m.groups) delete m.groups[gid];
  missionRecompute(m);
  missionRenderDetail();
}
let _missionAddEvt = null;   // null = closed; '__menu__' = picker; or a type          // scrubbed event index for the band view (null = last event)
let _missionSelEvt = null;   // selected event index for event detail panel
// Maneuver add-form draft: the composite step program being built (BURN / SEPARATE steps).
// [] = a single full burn from the default stage. Reset whenever the maneuver form opens.
let _missionAddMv = { from: null, to: null, steps: [] };
// Prop-transfer add-form: origin key of the chosen DESTINATION vehicle (null = the active
// vehicle, i.e. an intra-vehicle transfer). Lets you fill a separately-deployed depot.
let _missionXferDest = null;
function missionXferSetDest(id, key) { _missionXferDest = key || null; missionRenderDetail(); }

// Collapse every event card except the last one (used after adding an event so the
// newest is shown expanded). Cards use `_expanded` (default falsy = collapsed/compact).
function _missionExpandLast(m) {
  if (!m || !m.log) return;
  m.log.forEach(e => { e._expanded = false; });
  if (m.log.length) m.log[m.log.length - 1]._expanded = true;
}
let _missionBridgeMode = false;        // true while user is drawing a maneuver bridge
let _missionBridgeFrom = null;         // node id chosen as the bridge start
let _missionNmPos = {};                // nodeId -> [x,y] drag overrides
let _missionNmDrag = null;             // { missionId, nid } while dragging
let _missionOrbitPaletteOpen = true;   // orbit catalog dock open by default (below the view)
let _missionNmZoom = 1.0;              // node-map zoom (px width = worldW * zoom) — opens zoomed in on Earth
let _missionNmPan = null;              // active background-pan drag state
let _missionNmJustPanned = false;      // suppress the click that ends a pan-drag
const _MISSION_NM_ZMIN = 0.3, _MISSION_NM_ZMAX = 2.0;

function missionNmZoom(id, dir) {
  if (dir === 0) _missionNmZoom = 0.55;
  else _missionNmZoom = Math.max(_MISSION_NM_ZMIN, Math.min(_MISSION_NM_ZMAX, _missionNmZoom + dir * 0.15));
  const m = _missionGet(id);
  const va = document.querySelector('.mcc-view-area');
  if (va && m) va.innerHTML = _missionNodeMapHTML(m);
}

// Scroll-wheel zoom, centred on the cursor. Only resizes the SVG (uniform scale
// via px width) so we don't re-render or lose scroll position.
function missionNmWheel(e, id) {
  e.preventDefault();
  const sc = e.currentTarget;
  const svg = sc.querySelector('svg');
  if (!svg) return;
  const prev = _missionNmZoom;
  const dir = e.deltaY < 0 ? 1 : -1;
  _missionNmZoom = Math.max(_MISSION_NM_ZMIN, Math.min(_MISSION_NM_ZMAX, prev + dir * 0.12));
  if (_missionNmZoom === prev) return;
  const ratio = _missionNmZoom / prev;
  const rect = sc.getBoundingClientRect();
  const ax = e.clientX - rect.left, ay = e.clientY - rect.top;     // anchor in viewport
  const wx = sc.scrollLeft + ax, wy = sc.scrollTop + ay;           // anchor in content
  const worldW = _missionNmLayout().worldW;
  svg.style.width = Math.round(worldW * _missionNmZoom) + 'px';
  sc.scrollLeft = wx * ratio - ax;
  sc.scrollTop  = wy * ratio - ay;
}

// Grab the background and drag to pan (scrolls the container).
function missionNmPanStart(e, id) {
  if (e.button !== 0) return;                 // left button only (right = node move)
  const sc = e.currentTarget;
  _missionNmPan = { sc, x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop, moved: false };
  sc.style.cursor = 'grabbing';
  document.addEventListener('mousemove', missionNmPanMove);
  document.addEventListener('mouseup', missionNmPanEnd);
}
function missionNmPanMove(e) {
  const p = _missionNmPan; if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) p.moved = true;
  p.sc.scrollLeft = p.sl - dx;
  p.sc.scrollTop  = p.st - dy;
}
function missionNmPanEnd() {
  const p = _missionNmPan; if (!p) return;
  p.sc.style.cursor = 'grab';
  _missionNmJustPanned = p.moved;             // swallow the click that follows a real drag
  _missionNmPan = null;
  document.removeEventListener('mousemove', missionNmPanMove);
  document.removeEventListener('mouseup', missionNmPanEnd);
}

function missionToggleOrbitPalette(id) {
  _missionOrbitPaletteOpen = !_missionOrbitPaletteOpen;
  const m = _missionGet(id);
  const ft = document.querySelector('.mcc-footer');
  if (ft && m) ft.innerHTML = _missionFooterHTML(m);
}

function _missionMake(name) {
  return {
    missionId:     progUUID(),
    name:          name || 'New Mission',
    fleetEntryId:  null,
    payloadScIds:  [],
    launchOrbit:   { body: 'Earth', alt_km: 185, apo_km: 185, inc_deg: 28.5, lan_deg: 0 },
    log:           [],
    vehicleId:     null,
    vehicleIds:    [],
  };
}

function missionNew() {
  const m = _missionMake('Mission ' + (_missions.length + 1));
  _missions.push(m);
  _missionSel = m.missionId;
  missionRender();
}

function missionDelete(id) {
  _missions = _missions.filter(m => m.missionId !== id);
  if (_missionSel === id) _missionSel = _missions[0]?.missionId ?? null;
  missionRender();
}

function missionSelect(id) {
  _missionSel = id;
  missionRender();
}

function _missionGet(id) {
  return _missions.find(m => m.missionId === id) ?? null;
}

function missionRender() {
  const m = _missionGet(_missionSel);
  if (m) missionRecompute(m);   // rebuild this mission's runtime vehicles + snapshots
  missionRenderList();
  missionRenderDetail();
}

function missionRenderList() {
  const search = (document.getElementById('mission-search')?.value || '').toLowerCase();
  const list   = document.getElementById('mission-list');
  if (!list) return;
  const items  = _missions.filter(m => m.name.toLowerCase().includes(search));
  list.innerHTML = items.map(m => `
    <div class="lv-item${m.missionId === _missionSel ? ' selected' : ''}" onclick="missionSelect('${m.missionId}')">
      <button class="lv-item-btn" style="text-align:left;flex:1;cursor:pointer;background:none;border:none;padding:6px 8px;">
        <span style="display:block;font-size:11px;color:var(--text-bright)">${m.name}</span>
        <span style="color:var(--text-dim);font-size:9px">${m.log.length ? m.log.length + ' event' + (m.log.length !== 1 ? 's' : '') : 'No events'}</span>
      </button>
      <button class="lv-del" onclick="event.stopPropagation();missionDelete('${m.missionId}')" title="Delete">✕</button>
    </div>`).join('');
}

function missionRenderDetail() {
  const cc = document.getElementById('mission-cc');
  if (!cc) return;
  const m = _missionGet(_missionSel);
  if (!m) { cc.innerHTML = '<div class="placeholder-msg">Select or create a mission</div>'; return; }
  const id = m.missionId;

  // ── events log (with group blocks + repetition) ──
  const grpSel = _missionGroupMode;
  // event filter: by type and/or vehicle. On the Orbit Map the type is forced to
  // MANEUVER (it's the only event the map is about).
  const effType = (_missionViewMode === 'nodemap') ? 'MANEUVER' : (_missionEvtFilter.type || 'ALL');
  const effVeh  = _missionEvtFilter.veh || 'ALL';
  const matchEvt = e => (effType === 'ALL' || e.type === effType) && (effVeh === 'ALL' || e.vehicleId === effVeh);
  const card = (e, i) => {
    if (!grpSel && !matchEvt(e)) return '';   // hidden by filter (never hide while picking a group)
    const expanded = !!e._expanded;
    const upDis = (i <= 0) ? ' disabled' : '';
    const dnDis = (i >= m.log.length - 1) ? ' disabled' : '';
    const sub = e.burnLabel || e.toLabel || e.vehicleName || e.label || e.targetName || '';
    const editBtn = `<button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionOpenEventModal('${id}',${i})" title="Edit">✎</button>`;
    const ctl = `<div class="mevt-ctlbar">${editBtn}<button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionMoveEvent('${id}',${i},-1)" title="Move up"${upDis}>▲</button><button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionMoveEvent('${id}',${i},1)" title="Move down"${dnDis}>▼</button><button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionMoveEventToEnd('${id}',${i})" title="Send to end"${dnDis}>⤓</button><button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionDeleteEvent('${id}',${i})" title="Delete event">✕</button></div>`;
    const grpMark = grpSel ? (_missionGroupStart === i ? '◉ ' : '○ ') : '';
    const onclick = grpSel ? `missionGroupPick('${id}',${i})` : `missionSelectEvent('${id}',${i})`;
    const dragAttrs = grpSel ? '' : ` draggable="true" ondragstart="missionEvtDragStart(event,${i})" ondragover="missionEvtDragOver(event)" ondragleave="missionEvtDragLeave(event)" ondrop="missionEvtDrop(event,'${id}',${i})"`;
    return `<div id="mlog-${id}-${i}" class="mcc-evt-row${expanded?' sel':''}${grpSel&&_missionGroupStart===i?' grpstart':''}"${dragAttrs}>
      <div class="mevt-head" onclick="${onclick}">
        <span class="mevt-caret">${grpSel ? grpMark : (expanded ? '▾' : '▸')}</span>
        <span class="mission-log-type">${e.type}</span>
        <span class="mevt-sub">${sub}</span>
        ${grpSel ? '' : ctl}
      </div>
      ${(!grpSel && expanded) ? `<div class="mevt-body">${_missionLogCardHTML(e, id, i)}</div>` : ''}
    </div>`;
  };
  let logHTML = '';
  if (!m.log.length) {
    logHTML = '<div style="color:var(--text-dim);font-family:var(--mono);font-size:10px;">No events yet.<br>Add an event to begin (Launch or Place in Orbit).</div>';
  } else {
    let i = 0;
    while (i < m.log.length) {
      const gid = m.log[i].groupId;
      if (gid && m.groups && m.groups[gid]) {
        let j = i; while (j < m.log.length && m.log[j].groupId === gid) j++;
        const g = m.groups[gid];
        let inner = ''; for (let k = i; k < j; k++) inner += card(m.log[k], k);
        if (!inner) { i = j; continue; }   // whole group filtered out
        logHTML += `<div class="mcc-group">
          <div class="mcc-group-hdr">
            <span class="mcc-group-name" style="cursor:pointer" title="Click to rename / change repeat" onclick="missionOpenGroupModal('${id}',${i},${j-1},'${gid}')">⊞ ${g.name || 'Loop'}</span>
            <span class="mcc-group-rep">repeat
              <button class="act-btn mevt-ctl" onclick="missionGroupRepeat('${id}','${gid}',-1)">−</button>
              <b style="color:var(--accent3)">${g.repeat || 1}×</b>
              <button class="act-btn mevt-ctl" onclick="missionGroupRepeat('${id}','${gid}',1)">+</button></span>
            <button class="act-btn mevt-ctl" onclick="missionUngroup('${id}','${gid}')" title="Ungroup">⊟</button>
          </div>
          <div class="mcc-group-body">${inner}</div>
        </div>`;
        i = j;
      } else { logHTML += card(m.log[i], i); i++; }
    }
    if (!logHTML) logHTML = `<div style="color:var(--text-dim);font-family:var(--mono);font-size:10px;padding:6px;">No events match the filter.</div>`;
  }

  // ── events filter row (by type + vehicle; type is locked to MANEUVER on Orbit Map) ──
  const _vehName = vid => { const fv = PROG_ACTIVE_PROGRAM.vehicles[vid]; return fv ? _missionVehicleDisplayName(fv) : '?'; };
  const distinctTypes = [...new Set(m.log.map(e => e.type))];
  const vehIds = [...new Set(m.log.map(e => e.vehicleId).filter(Boolean))];
  const _fsel = 'class="mcc-evt-filter"';
  const typeSel = (_missionViewMode === 'nodemap')
    ? `<span style="font-family:var(--mono);font-size:9px;color:var(--accent3);align-self:center;white-space:nowrap;">▸ Maneuvers only</span>`
    : `<select ${_fsel} onchange="missionSetEvtFilter('${id}','type',this.value)"><option value="ALL"${effType==='ALL'?' selected':''}>All types</option>${distinctTypes.map(t => `<option value="${t}"${effType===t?' selected':''}>${t}</option>`).join('')}</select>`;
  const vehSelF = `<select ${_fsel} onchange="missionSetEvtFilter('${id}','veh',this.value)"><option value="ALL"${effVeh==='ALL'?' selected':''}>All vehicles</option>${vehIds.map(v => `<option value="${v}"${effVeh===v?' selected':''}>${_vehName(v)}</option>`).join('')}</select>`;
  const filterRow = m.log.length
    ? `<div class="mcc-evt-filterbar">${typeSel}${vehIds.length > 1 || effVeh !== 'ALL' ? vehSelF : ''}</div>`
    : '';

  // ── center content (view only — orbit catalog now lives in the footer) ──
  const view = _missionViewMode === 'nodemap' ? _missionNodeMapHTML(m) : _missionBandViewHTML(m);

  cc.innerHTML = `
    <!-- TOP BAR — current mission name + view toggle -->
    <div class="mcc-topbar">
      <span class="sl" style="margin:0;">Mission</span>
      <input value="${m.name.replace(/"/g,'&quot;')}" class="sc-stage-name" style="font-size:13px;flex:1;max-width:340px;"
        oninput="missionRename('${id}',this.value)">
      <div style="margin-left:auto;display:flex;align-items:center;gap:6px;">
        <div class="seg">
          <button class="${_missionViewMode === 'band' ? 'active' : ''}" onclick="missionSetView('${id}','band')">Band</button>
          <button class="${_missionViewMode === 'nodemap' ? 'active' : ''}" onclick="missionSetView('${id}','nodemap')">Orbit Map</button>
        </div>
        <div style="width:1px;height:16px;background:var(--border);margin:0 2px;"></div>
        <button class="act-btn" onclick="missionExportPNG('${id}')" title="Save the current view as a PNG image">&#x2B07; PNG</button>
        ${m.log.length ? `<button class="act-btn" onclick="missionResetLaunch('${id}')">Reset</button>` : ''}
      </div>
    </div>

    <!-- BODY -->
    <div class="mcc-body">
      <!-- LEFT COLUMN — Orbit Map: the ORBITS catalog fills it; Band: vehicles + budget -->
      <div class="mcc-left-col">
        ${_missionViewMode === 'nodemap'
          ? `<div class="mcc-orbit-cat">${_missionOrbitPaletteHTML(m)}</div>`
          : `${m.vehicleId ? '' : `<div class="mcc-section-header">Setup</div>
            <div class="mcc-panel-pad"><div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);line-height:1.7;">
              Use <b style="color:var(--text-bright)">＋ Add Event → Launch</b> (or Place in Orbit) on the right to bring a vehicle into the mission.
            </div></div>`}
            ${m.vehicleId ? _missionMultiVehicleHTML(m) : ''}
            ${m.vehicleId ? `<div class="mcc-left-budget">${_missionBudgetCardHTML(m)}</div>` : ''}`}
      </div>

      <!-- CENTER COLUMN — node map / band view -->
      <div class="mcc-center-col"><div class="mcc-view-area">${view}</div></div>

      <!-- RIGHT COLUMN — events (list on top, Add Event docked at the bottom) -->
      <div class="mcc-right-col">
        <div class="mcc-events-header" style="display:flex;align-items:center;gap:8px;">
          <span style="color:var(--accent3);">EVENTS</span>
          ${m.log.length ? `<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${m.log.length}</span>` : ''}
          ${m.log.length >= 1 ? `<button class="act-btn" style="margin-left:auto;padding:1px 8px;font-size:9px;${_missionGroupMode?'background:var(--accent);color:#000;':''}" onclick="missionToggleGroupMode('${id}')">${_missionGroupMode ? (_missionGroupStart==null?'⊞ pick start…':'⊞ pick end…') : '⊞ Loop'}</button>${_missionGroupMode?`<button class="act-btn" style="padding:1px 8px;font-size:9px;" onclick="missionToggleGroupMode('${id}')">✕</button>`:''}` : ''}
        </div>
        ${filterRow}
        <div class="mcc-events-list">${logHTML}</div>
        <div class="mcc-panel-pad mcc-addevt-dock${_missionAddEvt != null ? ' open' : ''}" style="flex-shrink:0;">${_missionAddEventHTML(m)}</div>
      </div>
    </div>
  `;
  if (m.vehicleId) setTimeout(() => missionBurnPreview(m.missionId), 0);
  if (_missionViewMode === 'nodemap') _missionCenterNmEarth();
}

// Position the node-map scroll on Earth's system (Earth + its orbits), leaving the
// other bodies off to the right — so the map opens zoomed in on Earth.
function _missionCenterNmEarth() {
  const sc = document.querySelector('.mcc-view-area .nm-scroll');
  if (!sc) return;
  const z = _missionNmZoom;
  sc.scrollLeft = Math.max(0, (200 - 150) * z);                 // Earth column (~x=200) near the left
  sc.scrollTop = Math.max(0, 290 * z - sc.clientHeight / 2);    // centre Earth's orbit band vertically
}

function missionRename(id, val) {
  const m = _missionGet(id);
  if (m) { m.name = val; missionRenderList(); }
}

function missionSetFleet(id, fleetId) {
  const m = _missionGet(id);
  if (!m) return;
  m.fleetEntryId = fleetId || null;
  // Don't clobber the user's chosen payloads when swapping the launch vehicle —
  // only seed from the fleet entry the first time (nothing selected yet).
  if (fleetId && (!m.payloadScIds || !m.payloadScIds.length)) {
    const entry = _fleetGet(fleetId);
    if (entry) m.payloadScIds = [...(entry.payloads || [])];
  }
  if (!m.payloadScIds) m.payloadScIds = [];
  missionRenderDetail();
}

function missionTogglePayload(id, scId, checked) {
  const m = _missionGet(id);
  if (!m) return;
  if (checked && !m.payloadScIds.includes(scId)) m.payloadScIds.push(scId);
  if (!checked) m.payloadScIds = m.payloadScIds.filter(x => x !== scId);
}

function missionSetOrbit(id, key, val) {
  const m = _missionGet(id);
  if (m) m.launchOrbit[key] = val;
}

// ── Launch parameter UI (lives in a pop-up, opened from Add Event → Launch) ──
function _missionOrbitFieldsHTML(m) {
  const id = m.missionId;
  const bodies = ['Earth','Moon','Mars','Venus','Mercury','Titan'];
  const bodyOpts = bodies.map(b => `<option${b === m.launchOrbit.body ? ' selected' : ''}>${b}</option>`).join('');
  const selStyle = 'background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;';
  return `<div class="cfg-row" style="flex-wrap:wrap;gap:10px 20px;align-items:flex-end;">
    <div class="cfg-item"><label class="cfg-label">Body</label>
      <select style="${selStyle}" onchange="missionSetOrbit('${id}','body',this.value)">${bodyOpts}</select></div>
    <div class="cfg-item"><label class="cfg-label">Perigee (km)</label>
      <input type="number" class="field" value="${m.launchOrbit.alt_km}" min="0" style="width:90px;" oninput="missionSetOrbit('${id}','alt_km',+this.value)"></div>
    <div class="cfg-item"><label class="cfg-label">Apogee (km)</label>
      <input type="number" class="field" value="${m.launchOrbit.apo_km ?? m.launchOrbit.alt_km}" min="0" style="width:90px;" oninput="missionSetOrbit('${id}','apo_km',+this.value)"></div>
    <div class="cfg-item"><label class="cfg-label">Inc (deg)</label>
      <input type="number" class="field" value="${m.launchOrbit.inc_deg}" min="0" max="180" style="width:80px;" oninput="missionSetOrbit('${id}','inc_deg',+this.value)"></div>
    <div class="cfg-item"><label class="cfg-label">LAN (deg)</label>
      <input type="number" class="field" value="${m.launchOrbit.lan_deg}" min="0" max="360" style="width:80px;" oninput="missionSetOrbit('${id}','lan_deg',+this.value)"></div>
  </div>`;
}

function _missionLaunchParamsHTML(m) {
  const id = m.missionId;
  const lvOpts = ['<option value="">— select launch vehicle —</option>',
    ..._fleetEntries.map(e => `<option value="${e.fleetId}"${e.fleetId === m.fleetEntryId ? ' selected' : ''}>${e.name}</option>`)].join('');
  const payChecks = _scEdSC.map(sc => `
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer;">
      <input type="checkbox"${m.payloadScIds.includes(sc.spacecraftId) ? ' checked' : ''}
        onchange="missionTogglePayload('${id}','${sc.spacecraftId}',this.checked);_missionRefreshLaunchModal('${id}')">
      <span style="font-family:var(--mono);font-size:11px;color:var(--text-bright)">${sc.name}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${_fleetScMassById(sc.spacecraftId).toLocaleString()} kg</span>
    </label>`).join('');
  const payMass = (m.payloadScIds || []).reduce((s, scId) => s + _fleetScMassById(scId), 0);
  return `
    <div class="mcc-section-header" style="padding-top:0;">Launch Vehicle</div>
    <div class="mcc-panel-pad" style="padding-top:4px;"><div class="panel" style="padding:8px 10px;">
      <select class="mcc-field-select" onchange="missionSetFleet('${id}',this.value);_missionRefreshLaunchModal('${id}')">${lvOpts}</select>
    </div></div>
    <div class="mcc-section-header">Payload Manifest${payMass ? ` <span style="color:var(--text-dim);text-transform:none;letter-spacing:0;">— ${payMass.toLocaleString()} kg</span>` : ''}</div>
    <div class="mcc-panel-pad" style="padding-top:4px;"><div class="panel" style="padding:8px 10px;">
      ${payChecks || '<span style="color:var(--text-dim);font-family:var(--mono);font-size:10px;">No spacecraft defined. Add spacecraft in the Spacecraft tab.</span>'}
    </div></div>
    <div class="mcc-section-header">Launch Orbit</div>
    <div class="mcc-panel-pad" style="padding-top:4px;"><div class="panel" style="padding:8px 10px;">${_missionOrbitFieldsHTML(m)}</div></div>`;
}

function _missionLaunchModalBody(m) {
  const id = m.missionId;
  const can = !!m.fleetEntryId;
  return `${_missionLaunchParamsHTML(m)}
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:10px;border-top:1px solid var(--border);">
      <button class="act-btn" onclick="closeModal('modal-mission-launch')">Cancel</button>
      <button class="act-btn" style="${can ? 'background:var(--accent);color:#000;font-weight:600;' : ''}" onclick="missionExecLaunch('${id}');closeModal('modal-mission-launch')"${can ? '' : ' disabled'}>▶ Launch</button>
    </div>`;
}

function missionOpenLaunchModal(id) {
  const m = _missionGet(id); if (!m) return;
  const body = document.getElementById('mlaunch-body');
  if (!body) return;
  body.innerHTML = _missionLaunchModalBody(m);
  openModal('modal-mission-launch');
}

function _missionRefreshLaunchModal(id) {
  const m = _missionGet(id); if (!m) return;
  const body = document.getElementById('mlaunch-body');
  if (body) body.innerHTML = _missionLaunchModalBody(m);
}

// ── PURE APPLIER: builds the launch vehicle, runs ascent staging, returns results.
// Does NOT push to m.log or set m.vehicleId — that is done by missionRecompute.
function _missionApplyLaunch(m, e) {
  e = e || {};
  const entry = _fleetGet(e.fleetEntryId || m.fleetEntryId);
  if (!entry) return null;

  const lvStages = progVehicleDefToLiveStages(entry);   // boosters are NOT live stages — they're handled in the LV math (lvPerformance)
  let scStages = [];
  for (const scId of (e.payloadScIds || m.payloadScIds || [])) {
    const sc = _scEdSC.find(s => s.spacecraftId === scId);
    if (sc) scStages = scStages.concat(progSpacecraftToLiveStages(sc));
  }

  const allStages = [...lvStages, ...scStages];
  const launchOrbit = e.launchOrbit || m.launchOrbit;
  const ev = progMakeEvent('LAUNCH', {
    label:       m.name + ' — ' + entry.name,
    stages:      allStages,
    targetOrbit: { ...launchOrbit },
    color:       '#61afef',
  });
  const result = progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);

  const fv = PROG_ACTIVE_PROGRAM.vehicles[result.vehicleId];
  if (!fv) return null;

  const payloadMass = (e.payloadScIds || m.payloadScIds || []).reduce((s, scId) => s + _fleetScMassById(scId), 0);
  const payloadNames = (e.payloadScIds || m.payloadScIds || []).map(scId => _scEdSC.find(s => s.spacecraftId === scId)?.name).filter(Boolean);

  // Earth launches go through the EXACT LV-calculator math (lvPerformance) — same
  // parallel-booster handling, same Townsend ascent penalty. We read its per-stage
  // ΔV (perf.sDVs, boosters folded into stage 0) + ascent requirement, then map that
  // onto the live vehicle. Other bodies use the simpler circular-velocity estimate.
  const perf = (launchOrbit.body === 'Earth' && typeof lvPerformance === 'function' && entry.stageData && entry.stageData.length)
    ? lvPerformance(entry.stageData, entry.boosterData || null, payloadMass, entry.fairingMass || 0, 0, launchOrbit.alt_km, 0, 28.5, 37, 112)
    : null;
  const dvRequired = perf ? perf.DVasc : _missionDvToOrbit(launchOrbit.body, launchOrbit.alt_km);
  let dvRemaining = dvRequired;
  const stagingLog   = [];
  const stagesToDrop = [];

  if (perf) {
    // staging from the LV calculator's own per-stage ΔVs (stage 0 already includes
    // the boosters). Fully-consumed stages expend; the one that crosses the
    // requirement is the insertion stage; the payload rides up as dead mass.
    const nLv = entry.stageData.length;
    const hasB = !!(entry.boosterData && entry.boosterData.count > 0);
    for (let i = 0; i < nLv && i < fv.stages.length; i++) {
      const s = fv.stages[i];
      if (_missionStageOwner(s.stageDefinitionId)) break;   // safety: never burn payload
      const dvStage  = perf.sDVs[i] || 0;
      const prop     = progStageRemainingProp(s);
      const sname    = _missionStageLabelById(s.stageDefinitionId) + (i === 0 && hasB ? ' + boosters' : '');
      if (dvStage >= dvRemaining) {
        const massAbove  = fv.stages.slice(i + 1).reduce((sum, st) => sum + progStageMass(st), 0);
        const m_wet      = progStageMass(s) + massAbove;
        const propNeeded = Math.min(prop, progRocketEqPropNeeded(m_wet, dvRemaining, s.isp));
        progBurnPropellant(s, propNeeded);
        stagingLog.push({ name: sname, propTotal: Math.round(prop), propBurned: Math.round(propNeeded), propRemaining: Math.round(progStageRemainingProp(s)), dvContrib: Math.round(dvRemaining), expended: false });
        dvRemaining = 0;
        break;
      }
      progBurnPropellant(s, prop);
      stagingLog.push({ name: sname, propTotal: Math.round(prop), propBurned: Math.round(prop), propRemaining: 0, dvContrib: Math.round(dvStage), expended: true });
      dvRemaining -= dvStage;
      stagesToDrop.push(s.stageDefinitionId);
    }
  } else {
    // non-Earth fallback: live-stage rocket equation (payload not burned)
    for (let i = 0; i < fv.stages.length; i++) {
      const s = fv.stages[i];
      if (_missionStageOwner(s.stageDefinitionId)) break;
      if ((s.isp || 0) <= 0) continue;
      const prop = progStageRemainingProp(s);
      if (prop <= 0) continue;
      const massAbove = fv.stages.slice(i + 1).reduce((sum, st) => sum + progStageMass(st), 0);
      const m_wet     = progStageMass(s) + massAbove;
      const dvAvail   = progRocketEqDv(m_wet, prop, s.isp);
      const sname     = _missionStageLabelById(s.stageDefinitionId);
      if (dvAvail >= dvRemaining) {
        const propNeeded = progRocketEqPropNeeded(m_wet, dvRemaining, s.isp);
        progBurnPropellant(s, propNeeded);
        stagingLog.push({ name: sname, propTotal: Math.round(prop), propBurned: Math.round(propNeeded), propRemaining: Math.round(prop - propNeeded), dvContrib: Math.round(dvRemaining), expended: false });
        dvRemaining = 0;
        break;
      }
      progBurnPropellant(s, prop);
      stagingLog.push({ name: sname, propTotal: Math.round(prop), propBurned: Math.round(prop), propRemaining: 0, dvContrib: Math.round(dvAvail), expended: true });
      dvRemaining -= dvAvail;
      stagesToDrop.push(s.stageDefinitionId);
    }
  }

  fv.stages = fv.stages.filter(s => !stagesToDrop.includes(s.stageDefinitionId));
  fv.orbitState = { body: launchOrbit.body, perigee: launchOrbit.alt_km, apogee: (launchOrbit.apo_km ?? launchOrbit.alt_km), inclination: launchOrbit.inc_deg, lan: launchOrbit.lan_deg, epoch: 0, surface: false };

  // Verdict + capacity come straight from the LV calculator's math: feasibility is
  // its ΔV margin, and max payload is its binary search (lvMaxPayload), so the
  // program reports exactly what the calculator would for this vehicle + orbit.
  const maxPayload = perf
    ? lvMaxPayload(entry.stageData, entry.boosterData || null, entry.fairingMass || 0, 0, launchOrbit.alt_km, 0, 28.5, 37, 112)
    : null;
  const ok = perf ? (perf.margin >= 0) : (dvRemaining <= 0);
  const stagingResult = {
    dvRequired:  Math.round(dvRequired),
    dvDelivered: Math.round(dvRequired - Math.max(dvRemaining, 0)),
    status:      ok ? 'SUCCESS' : 'MARGINAL',
    stages:      stagingLog,
    dvAvailable: perf ? Math.round(perf.tDV) : null,
    dvMargin:    perf ? Math.round(perf.margin) : null,
    maxPayload:  maxPayload != null ? Math.round(maxPayload) : null,
  };

  return { fv, stagingResult, payloadMass, payloadNames };
}

function _missionApplyDeploy(m, e) {
  e = e || {};
  // DEPLOY places a single SPACECRAFT directly in orbit (e.g. a station like the
  // ISS) — no launch vehicle, no ascent staging, full tanks.
  const sc = _scEdSC.find(s => s.spacecraftId === e.spacecraftId);
  if (!sc) return null;
  const allStages = progSpacecraftToLiveStages(sc);
  // Optionally deploy with EMPTY tanks (a dry depot to be filled by prop transfer later).
  if (e.emptyTanks) allStages.forEach(st => (st.tanks || []).forEach(t => { t.fill = 0; }));
  const o = e.orbit || m.launchOrbit || {};
  const orbitState = { body: o.body, perigee: o.alt_km, apogee: (o.apo_km ?? o.alt_km), inclination: o.inc_deg, lan: o.lan_deg, epoch: 0, surface: false };
  const fv = progMakeFlightVehicle(sc.name, allStages, orbitState, '#e5c07b');
  fv.status = 'ORBIT';
  PROG_ACTIVE_PROGRAM.vehicles[fv.vehicleId] = fv;
  const payloadMass = (typeof progVehicleTotalMass === 'function') ? progVehicleTotalMass(fv) : 0;
  return { fv, payloadMass, payloadNames: [sc.name] };
}

function missionExecLaunch(id) {
  const m = _missionGet(id);
  if (!m || !m.fleetEntryId) return;
  const entry = _fleetGet(m.fleetEntryId);
  if (!entry) return;
  m.log.push({ type: 'LAUNCH', label: entry.name, fleetEntryId: m.fleetEntryId, payloadScIds: [...(m.payloadScIds||[])], launchOrbit: { ...m.launchOrbit }, orbit: { ...m.launchOrbit } });
  _missionAddEvt = null;  _missionExpandLast(m);
  missionRecompute(m);
  missionRenderDetail();
  // prompt the user to name the freshly-launched vehicle (skippable → keeps auto name)
  const fv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  if (fv && fv._originKey) setTimeout(() => missionRenameVehicle(id, fv._originKey), 0);
}

function missionExecDeploy(id, scId) {
  const m = _missionGet(id);
  if (!m) return;
  const sc = _scEdSC.find(s => s.spacecraftId === scId);
  if (!sc) return;
  const empty = !!document.getElementById('addev-deploy-empty-' + id)?.checked;
  m.log.push({ type: 'DEPLOY', label: sc.name, spacecraftId: scId, orbit: { ...m.launchOrbit }, emptyTanks: empty });
  _missionAddEvt = null;
  _missionExpandLast(m);
  missionRecompute(m); missionRenderDetail();
}

function missionResetLaunch(id) {
  const m = _missionGet(id);
  if (!m) return;
  m.log = [];
  m.vehicleId = null;
  m.vehicleIds = [];
  missionRecompute(m);
  missionRenderDetail();
}

function _missionLogCardHTML(entry, id, idx) {
  if (entry.type === 'BURN')     return _missionBurnLogCardHTML(entry);
  if (entry.type === 'SEPARATE') return _missionSeparateLogCardHTML(entry);
  if (entry.type === 'DOCK')     return _missionDockLogCardHTML(entry);
  if (entry.type === 'MANEUVER') return _missionManeuverLogCardHTML(entry, id, idx);
  if (entry.type === 'EXPEND') return `<div class="mission-log-card" style="padding:8px 14px;display:flex;align-items:center;gap:8px;">
    <span class="mission-log-type">EXPEND</span>
    <span style="font-family:var(--mono);font-size:11px;color:var(--text-bright)">${entry.vehicleLevel ? entry.vehicleName : entry.stageName}</span>
    <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-left:auto">${entry.vehicleLevel ? 'vehicle expended' : 'stage dropped'}</span>
  </div>`;
  if (entry.type === 'RENDEZVOUS') return `<div class="mission-log-card" style="padding:8px 14px;">
    <span class="mission-log-type">RENDEZVOUS</span>
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-top:4px;">${entry.activeName||'?'} → matches ${entry.targetName||'?'}</div>
    ${entry.matched===false ? `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">// target not found on replay</div>` : ''}
  </div>`;
  if (entry.type === 'TRANSFER_PROPELLANT') return `<div class="mission-log-card" style="padding:8px 14px;">
    <span class="mission-log-type">PROP XFER</span>
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-top:4px;">${(entry.transferred||0).toLocaleString()} kg</div>
    ${(entry.fromName||entry.toName) ? `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:2px;">${entry.fromName||'?'}${entry.vehName ? ' ['+entry.vehName+']' : ''} → ${entry.toName||'?'}${(entry.destVehName && entry.destVehName !== entry.vehName) ? ' ['+entry.destVehName+']' : ''}</div>` : ''}
    ${(entry.warnings||[]).map(w => `<div style="font-family:var(--mono);font-size:9px;color:var(--accent2);">${w}</div>`).join('')}
  </div>`;
  if (entry.type === 'TRANSFER_CREW') return `<div class="mission-log-card" style="padding:8px 14px;">
    <span class="mission-log-type">CREW XFER</span>
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-top:4px;">${entry.transferred||0} crew</div>
    ${(entry.warnings||[]).map(w => `<div style="font-family:var(--mono);font-size:9px;color:var(--accent2);">${w}</div>`).join('')}
  </div>`;
  if (entry.type === 'REENTER') return `<div class="mission-log-card" style="padding:8px 14px;">
    <span class="mission-log-type">REENTER</span>
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-top:4px;">${entry.vehicleName||'?'} → Earth surface</div>
  </div>`;
  if (entry.type === 'RECOVER') return `<div class="mission-log-card" style="padding:8px 14px;">
    <span class="mission-log-type">RECOVER</span>
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-top:4px;">${entry.vehicleName||'?'} recovered</div>
  </div>`;
  if (entry.type === 'DEPLOY') return `<div class="mission-log-card"><div class="mission-log-header"><span class="mission-log-type">DEPLOY</span><span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto">${entry.label||''}</span></div><div class="mission-state-grid"><div class="mission-state-kv"><span class="mission-state-key">Orbit</span><span class="mission-state-val">${(entry.orbit&&entry.orbit.alt_km||0).toLocaleString()} km${entry.orbit&&entry.orbit.apo_km&&entry.orbit.apo_km!==entry.orbit.alt_km?' × '+entry.orbit.apo_km.toLocaleString():''}</span></div><div class="mission-state-kv"><span class="mission-state-key">Body</span><span class="mission-state-val">${entry.orbit&&entry.orbit.body||'Earth'}</span></div></div></div>`;
  if (entry.type !== 'LAUNCH') return '';
  const o  = entry.orbit;
  const sr = entry.stagingResult || {};
  const sc = sr.status === 'SUCCESS' ? 'var(--accent3)' : 'var(--accent2)';
  const payStr = (entry.payloadNames || []).length ? entry.payloadNames.join(', ') : 'None';
  const stageRows = (sr.stages || []).map(s => {
    const statusCell = s.expended
      ? `<td style="color:var(--text-dim);font-family:var(--mono);font-size:9px">EXPENDED</td>`
      : `<td style="color:var(--accent);font-family:var(--mono);font-size:9px">INSERTION &nbsp;${s.propRemaining.toLocaleString()} kg remain</td>`;
    return `<tr>
      <td class="rl">${s.name}</td>
      <td style="text-align:right">${s.propBurned.toLocaleString()}</td>
      <td style="text-align:right;color:var(--accent3)">${s.dvContrib.toLocaleString()}</td>
      ${statusCell}
    </tr>`;
  }).join('');
  return `<div class="mission-log-card">
    <div class="mission-log-header">
      <span class="mission-log-type">LAUNCH</span>
      <span style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;padding:1px 6px;border:1px solid ${sc};color:${sc}">${sr.status || 'SUCCESS'}</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto">${entry.label}</span>
    </div>
    <div class="mission-state-grid">
      <div class="mission-state-kv"><span class="mission-state-key">Body</span><span class="mission-state-val">${o.body}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Altitude</span><span class="mission-state-val">${o.alt_km.toLocaleString()} km</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Inc</span><span class="mission-state-val">${o.inc_deg}&deg;</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">LAN</span><span class="mission-state-val">${o.lan_deg}&deg;</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Payload</span><span class="mission-state-val">${entry.payloadMass.toLocaleString()} kg</span></div>
      ${sr.maxPayload != null ? `<div class="mission-state-kv"><span class="mission-state-key">Max to this orbit</span><span class="mission-state-val" style="color:${entry.payloadMass <= sr.maxPayload ? 'var(--accent3)' : 'var(--accent2)'}">${sr.maxPayload.toLocaleString()} kg</span></div>` : ''}
    </div>
    ${(entry.payloadNames || []).length ? `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px;">Payloads: ${payStr}</div>` : ''}
    ${stageRows ? `<table class="sc-dv-tbl" style="width:100%"><thead><tr>
      <th>Stage</th><th style="text-align:right">Prop Used (kg)</th><th style="text-align:right">&#916;V (m/s)</th><th>Ascent Status</th>
    </tr></thead><tbody>${stageRows}</tbody></table>
    <div style="display:flex;justify-content:flex-end;align-items:baseline;gap:16px;margin-top:10px;padding-top:8px;border-top:1px solid var(--border);flex-wrap:wrap;">
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);letter-spacing:.1em;text-transform:uppercase;">Required &#916;V</span>
      <span style="font-family:var(--mono);font-size:16px;color:var(--text-bright)">${(sr.dvRequired||0).toLocaleString()} m/s</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);letter-spacing:.1em;text-transform:uppercase;">Available</span>
      <span style="font-family:var(--mono);font-size:16px;color:${sc}">${(sr.dvAvailable != null ? sr.dvAvailable : sr.dvDelivered || 0).toLocaleString()} m/s</span>
      ${sr.dvMargin != null ? `<span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);letter-spacing:.1em;text-transform:uppercase;">Margin</span>
      <span style="font-family:var(--mono);font-size:16px;color:${sr.dvMargin >= 0 ? 'var(--accent3)' : 'var(--accent2)'}">${sr.dvMargin.toLocaleString()} m/s</span>` : ''}
    </div>` : ''}
  </div>`;
}



function missionDeleteEvent(id, idx) {
  const m = _missionGet(id); if (!m) return;
  m.log.splice(idx, 1);
  _missionSelEvt = null;
  missionRecompute(m);
  _missionRenderPreserveNm(id);
}

function missionMoveEvent(id, idx, dir) {
  const m = _missionGet(id); if (!m) return;
  const j = idx + dir;
  if (j < 0 || j >= m.log.length) return;
  const tmp = m.log[idx]; m.log[idx] = m.log[j]; m.log[j] = tmp;
  _missionSelEvt = null;
  missionRecompute(m);
  _missionRenderPreserveNm(id);
}

// ── event reordering (drag a card to a new position, or send it to the end) ──
let _missionEvtDrag = null;
function missionEvtDragStart(e, i) { _missionEvtDrag = i; e.dataTransfer.effectAllowed = 'move'; }
function missionEvtDragOver(e) { if (_missionEvtDrag == null) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('mevt-drop-hot'); }
function missionEvtDragLeave(e) { e.currentTarget.classList.remove('mevt-drop-hot'); }
function missionEvtDrop(e, id, toIdx) {
  e.preventDefault(); e.currentTarget.classList.remove('mevt-drop-hot');
  const from = _missionEvtDrag; _missionEvtDrag = null;
  if (from == null || from === toIdx) return;
  missionReorderEvent(id, from, toIdx);
}
function missionReorderEvent(id, from, to) {
  const m = _missionGet(id); if (!m) return;
  if (from < 0 || from >= m.log.length || to < 0 || to >= m.log.length) return;
  const [ev] = m.log.splice(from, 1);
  m.log.splice(to, 0, ev);
  _missionSelEvt = null;
  missionRecompute(m);
  _missionRenderPreserveNm(id);
}
function missionMoveEventToEnd(id, idx) {
  const m = _missionGet(id); if (!m) return;
  missionReorderEvent(id, idx, m.log.length - 1);
}

function missionSelectEvent(id, idx) {
  // Single-expansion: clicking a card expands it and collapses the rest;
  // clicking the already-open card collapses it (so clicking off auto-minimizes).
  const m = _missionGet(id);
  if (!m || !m.log[idx]) return;
  const wasOpen = !!m.log[idx]._expanded;
  m.log.forEach(e => { e._expanded = false; });
  if (!wasOpen) m.log[idx]._expanded = true;
  missionRenderDetail();
}

// Open the edit pop-up for an event (BURN / MANEUVER).
function missionOpenEventModal(id, idx) {
  const m = _missionGet(id);
  if (!m || !m.log[idx]) return;
  const e = m.log[idx];
  const titleEl = document.getElementById('mevt-title');
  const bodyEl  = document.getElementById('mevt-body');
  if (!titleEl || !bodyEl) return;
  titleEl.textContent = 'Edit ' + e.type + ' Event';
  bodyEl.innerHTML = _missionEventDetailHTML(m, idx);
  openModal('modal-mission-evt');
}

function _missionEventDetailHTML(m, idx) {
  if (idx == null) return '';
  const e = m.log[idx];
  if (!e) return '';
  const id = m.missionId;
  let fields = '';
  if (e.type === 'LAUNCH') {
    const o = e.orbit || {};
    fields = `<div class="mission-state-kv"><span class="mission-state-key">Body</span><span class="mission-state-val">${o.body}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Alt</span><span class="mission-state-val">${(o.alt_km||0).toLocaleString()} km</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Inc</span><span class="mission-state-val">${(o.inc_deg||0)}&deg;</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Payload</span><span class="mission-state-val">${(e.payloadMass||0).toLocaleString()} kg</span></div>`;
  } else if (e.type === 'BURN') {
    fields = `<div class="mission-state-kv"><span class="mission-state-key">Burn</span><span class="mission-state-val">${e.burnLabel||e.burnType||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Target ΔV</span><span class="mission-state-val">${Math.round(e.dvTarget||0).toLocaleString()} m/s</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Actual ΔV</span><span class="mission-state-val">${Math.round(e.dv_actual||0).toLocaleString()} m/s</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Prop Consumed</span><span class="mission-state-val">${Math.round(e.prop_consumed||0).toLocaleString()} kg</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Result</span><span class="mission-state-val">${e.result||''}</span></div>`;
  } else if (e.type === 'DEPLOY') {
    const o = e.orbit || {};
    fields = `<div class="mission-state-kv"><span class="mission-state-key">Spacecraft</span><span class="mission-state-val">${e.label||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Body</span><span class="mission-state-val">${o.body||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Orbit</span><span class="mission-state-val">${(o.alt_km||0).toLocaleString()} km${o.apo_km&&o.apo_km!==o.alt_km?' × '+o.apo_km.toLocaleString():''}</span></div>`;
  } else if (e.type === 'MANEUVER') {
    fields = `<div class="mission-state-kv"><span class="mission-state-key">Route</span><span class="mission-state-val">${e.fromLabel||''} → ${e.toLabel||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">ΔV</span><span class="mission-state-val">${e.dv!=null?e.dv.toLocaleString()+' m/s':'n/a'}</span></div>
      ${e.prop_consumed?`<div class="mission-state-kv"><span class="mission-state-key">Prop used</span><span class="mission-state-val">${Math.round(e.prop_consumed).toLocaleString()} kg</span></div>`:''}
      ${(e.firingStageId||e.firedStageId)?`<div class="mission-state-kv"><span class="mission-state-key">Firing stage</span><span class="mission-state-val">${_missionStageLabelById(e.firingStageId||e.firedStageId)}</span></div>`:''}`;
  } else if (e.type === 'SEPARATE') {
    fields = `<div class="mission-state-kv"><span class="mission-state-key">From</span><span class="mission-state-val">${e.parentName||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Lower</span><span class="mission-state-val">${e.lowerName||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Upper</span><span class="mission-state-val">${e.upperName||''}</span></div>`;
  } else if (e.type === 'DOCK') {
    fields = `<div class="mission-state-kv"><span class="mission-state-key">Vehicle A</span><span class="mission-state-val">${e.aDisp||e.aName||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Vehicle B</span><span class="mission-state-val">${e.tDisp||e.tName||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Merged</span><span class="mission-state-val">${e.mergedName||''}</span></div>`;
  } else if (e.type === 'EXPEND') {
    fields = `<div class="mission-state-kv"><span class="mission-state-key">Name</span><span class="mission-state-val">${e.vehicleName || e.stageName || ''}</span></div>`;
  }

  const _es = 'background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;';
  const _vehBefore = _missionVehiclesBeforeEvent(m, idx);
  const _vehOpt = (selKey, exclKey) => _vehBefore.filter(v => v.key !== exclKey)
    .map(v => `<option value="${v.key}"${v.key === selKey ? ' selected' : ''}>${v.name}</option>`).join('');
  let editForm = '';
  if (e.type === 'BURN') {
    editForm = `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <div class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
          <div class="cfg-item">
            <label class="cfg-label">Burn Type</label>
            <select id="edit-burn-type-${id}" style="background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;">
              <option value="HOHMANN"${e.burnType==='HOHMANN'?' selected':''}>Hohmann Transfer</option>
              <option value="CIRC"${e.burnType==='CIRC'?' selected':''}>Circularize at Apo</option>
              <option value="TLI"${e.burnType==='TLI'?' selected':''}>Trans-Lunar Injection</option>
              <option value="LOI"${e.burnType==='LOI'?' selected':''}>Lunar Orbit Insertion</option>
              <option value="PLANE_CHANGE"${e.burnType==='PLANE_CHANGE'?' selected':''}>Plane Change</option>
              <option value="CUSTOM"${e.burnType==='CUSTOM'?' selected':''}>Custom ΔV</option>
            </select>
          </div>
          <div class="cfg-item">
            <label class="cfg-label">Param</label>
            <input type="number" id="edit-burn-param-${id}" class="field" value="${e.burnParam ?? 0}" style="width:100px;">
          </div>
        </div>
        <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionApplyBurnEdit('${id}',${idx})">Apply</button>
      </div>`;
  } else if (e.type === 'MANEUVER') {
    const _nm  = _missionNmNodes();
    const _opt = sel => _nm.map(n => `<option value="${n.id}"${n.id===sel?' selected':''}>${n.label}${n.sub?' ('+n.sub+')':''}</option>`).join('');
    const _selStyle = 'background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;';
    editForm = `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <div class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
          <div class="cfg-item"><label class="cfg-label">From</label>
            <select id="edit-mv-from-${id}" style="${_selStyle}">${_opt(e.fromNode)}</select></div>
          <div class="cfg-item"><label class="cfg-label">To</label>
            <select id="edit-mv-to-${id}" style="${_selStyle}">${_opt(e.toNode)}</select></div>
        </div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px;">// edit the burn/separate steps on the maneuver card itself</div>
        <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionApplyManeuverEdit('${id}',${idx})">Apply</button>
      </div>`;
  } else if (e.type === 'DEPLOY') {
    const scs = _scEdSC || [];
    const o = scs.map(s => `<option value="${s.spacecraftId}"${s.spacecraftId===e.spacecraftId?' selected':''}>${s.name}</option>`).join('');
    editForm = `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <div class="cfg-item" style="margin-bottom:8px;"><label class="cfg-label">Spacecraft</label>
          <select id="edit-deploy-sc-${id}" class="mcc-field-select">${o}</select></div>
        <label style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="edit-deploy-empty-${id}" style="accent-color:var(--accent);"${e.emptyTanks?' checked':''}> Deploy with empty tanks (depot)</label>
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px;">// orbit follows the Launch Orbit set in the left panel</div>
        <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionApplyDeployEdit('${id}',${idx})">Apply</button>
      </div>`;
  } else if (e.type === 'TRANSFER_PROPELLANT') {
    // stage lists + propellant come from each vehicle's state AT THIS EVENT (snapshot), so the
    // indices line up with the real transfer and amounts are point-in-time. Source is the active
    // vehicle; destination may be a separate vehicle (a depot) when destVehicleKey is set.
    const srcStages = _missionPreSnapStages(m, idx, e.activeKey, e.vehicleId);
    const dstStages = e.destVehicleKey ? _missionPreSnapStages(m, idx, e.destVehicleKey, e.destVehicleId) : srcStages;
    if (srcStages.length && dstStages.length) {
      const optsFor = (list, sel) => {
        const cnt = {}; list.forEach(s => { cnt[s.name] = (cnt[s.name] || 0) + 1; });
        return list.map((s, i) => {
          let lbl = s.name;
          if (cnt[s.name] > 1) {
            const same = list.filter(x => x.name === s.name);
            const parents = [...new Set(same.map(x => x.parent || ''))];
            if (s.parent && parents.length > 1) lbl = `${s.name} (${s.parent})`;
            else { const kids = [...new Set(same.map(x => String(x.parentKid)))]; lbl = `${s.name} (${s.parent ? s.parent + ' #' : ''}${kids.indexOf(String(s.parentKid)) + 1})`; }
          }
          return `<option value="${i}"${i === sel ? ' selected' : ''}>${lbl} — ${(s.prop || 0).toLocaleString()} kg</option>`;
        }).join('');
      };
      const destNote = e.destVehicleKey ? `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:4px;">// destination vehicle: ${e.destName || e.destVehName || '?'}</div>` : '';
      editForm = `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
          <label class="cfg-label">Source Stage</label>
          <select id="edit-xfer-src-${id}" class="mcc-field-select" style="margin-bottom:6px;">${optsFor(srcStages, e.sourceIndex)}</select>
          ${destNote}<label class="cfg-label">Destination Stage</label>
          <select id="edit-xfer-dst-${id}" class="mcc-field-select" style="margin-bottom:6px;">${optsFor(dstStages, e.destIndex)}</select>
          <label class="cfg-label">Mass (kg)</label>
          <div style="display:flex;gap:6px;margin-bottom:8px;"><input type="number" id="edit-xfer-mass-${id}" class="field" value="${e.mass_kg||0}" style="flex:1;"><button class="act-btn" style="flex-shrink:0;" onclick="missionPropXferEditMax('${id}',${idx})">Max</button></div>
          <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionApplyPropTransferEdit('${id}',${idx})">Apply</button>
        </div>`;
    }
  } else if (e.type === 'LAUNCH') {
    const lvOpts = ['<option value="">— launch vehicle —</option>',
      ..._fleetEntries.map(f => `<option value="${f.fleetId}"${f.fleetId === e.fleetEntryId ? ' selected' : ''}>${f.name}</option>`)].join('');
    const o = e.orbit || {};
    const payChecks = (_scEdSC || []).map(sc => {
      const on = (e.payloadScIds || []).includes(sc.spacecraftId);
      return `<label style="display:flex;align-items:center;gap:8px;margin-bottom:4px;cursor:pointer;font-family:var(--mono);font-size:10px;color:var(--text-bright);"><input type="checkbox" class="edit-launch-pay-${id}" value="${sc.spacecraftId}"${on ? ' checked' : ''}>${sc.name}</label>`;
    }).join('') || '<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">No spacecraft defined</div>';
    const bodies = ['Earth','Moon','Mars','Venus','Mercury','Titan'];
    editForm = `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <label class="cfg-label">Launch Vehicle</label>
        <select id="edit-launch-lv-${id}" class="mcc-field-select" style="margin-bottom:8px;">${lvOpts}</select>
        <label class="cfg-label">Payloads</label>
        <div style="margin:4px 0 8px;">${payChecks}</div>
        <div class="cfg-row" style="flex-wrap:wrap;gap:8px 14px;align-items:flex-end;margin-bottom:8px;">
          <div class="cfg-item"><label class="cfg-label">Body</label><select id="edit-launch-body-${id}" style="${_es}">${bodies.map(b => `<option${b === (o.body || 'Earth') ? ' selected' : ''}>${b}</option>`).join('')}</select></div>
          <div class="cfg-item"><label class="cfg-label">Perigee (km)</label><input type="number" id="edit-launch-alt-${id}" class="field" value="${o.alt_km ?? 200}" style="width:90px;"></div>
          <div class="cfg-item"><label class="cfg-label">Apogee (km)</label><input type="number" id="edit-launch-apo-${id}" class="field" value="${o.apo_km ?? o.alt_km ?? 200}" style="width:90px;"></div>
          <div class="cfg-item"><label class="cfg-label">Inc (deg)</label><input type="number" id="edit-launch-inc-${id}" class="field" value="${o.inc_deg ?? 28.5}" style="width:80px;"></div>
        </div>
        <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionApplyLaunchEdit('${id}',${idx})">Apply</button>
      </div>`;
  } else if (e.type === 'SEPARATE') {
    // stage list comes from the vehicle's state AT THIS EVENT (snapshot), point-in-time.
    const sepStages = _missionPreSnapStages(m, idx, e.activeKey, e.parentVehicleId);
    const stageOpts = sepStages.map((s, i) => i >= 1
      ? `<option value="${i}"${i === e.sepIndex ? ' selected' : ''}>${s.name}</option>` : '').join('');
    editForm = `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <div class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
          <div class="cfg-item"><label class="cfg-label">Vehicle to separate</label>
            <select id="edit-sep-veh-${id}" style="${_es}" onchange="missionSepEditSetVehicle('${id}',${idx},this.value)">${_vehOpt(e.activeKey)}</select></div>
          <div class="cfg-item"><label class="cfg-label">Split point</label>
            <select id="edit-sep-idx-${id}" style="${_es}">${stageOpts || '<option>— n/a —</option>'}</select></div>
        </div>
        <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionApplySeparateEdit('${id}',${idx})">Apply</button>
      </div>`;
  } else if (e.type === 'DOCK') {
    editForm = `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <div class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
          <div class="cfg-item"><label class="cfg-label">Vehicle A (docks onto B)</label>
            <select id="edit-dock-a-${id}" style="${_es}">${_vehOpt(e.activeKey, e.targetKey)}</select></div>
          <div class="cfg-item"><label class="cfg-label">Vehicle B (target)</label>
            <select id="edit-dock-b-${id}" style="${_es}">${_vehOpt(e.targetKey, e.activeKey)}</select></div>
        </div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px;">// docking requires both in a matching orbit (rendezvous first)</div>
        <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionApplyDockEdit('${id}',${idx})">Apply</button>
      </div>`;
  } else if (e.type === 'EXPEND') {
    editForm = `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <div class="cfg-item" style="margin-bottom:8px;"><label class="cfg-label">Vehicle to expend</label>
          <select id="edit-expend-veh-${id}" style="${_es}">${_vehOpt(e.targetKey)}</select></div>
        <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionApplyExpendEdit('${id}',${idx})">Apply</button>
      </div>`;
  }

  const simToggle = idx >= 1
    ? `<label style="display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);cursor:pointer;font-family:var(--mono);font-size:10px;color:var(--text-bright);">
        <input type="checkbox"${e.sameTimeAsPrev ? ' checked' : ''} onchange="missionToggleSameTime('${id}',${idx})">
        ⇄ Occurs at the same time as the previous event (stack them in the timeline)
      </label>`
    : '';
  // mid-coast: only meaningful after a transfer-type event (MANEUVER / BURN) — places
  // this event partway along that transfer's coast in the band view.
  const prevType = idx >= 1 ? m.log[idx - 1].type : null;
  const coastToggle = (idx >= 1 && (prevType === 'MANEUVER' || prevType === 'BURN'))
    ? `<label style="display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer;font-family:var(--mono);font-size:10px;color:var(--text-bright);">
        <input type="checkbox"${e.midCoast ? ' checked' : ''} onchange="missionToggleMidCoast('${id}',${idx})">
        ⤵ Occurs during the previous transfer's coast (show it mid-maneuver)
      </label>`
    : '';
  return `<div style="padding:4px 2px;">
      <div class="mission-state-grid">${fields}</div>
      ${editForm}
      ${simToggle}
      ${coastToggle}
      <div style="display:flex;gap:6px;margin-top:12px;">
        <button class="act-btn" onclick="missionDeleteEvent('${id}',${idx});closeModal('modal-mission-evt')">Delete Event</button>
        <button class="act-btn" onclick="closeModal('modal-mission-evt')">Close</button>
      </div>
    </div>`;
}

function _missionDvToOrbit(body, alt_km) {
  const b = PROG_BODIES[body];
  if (!b) return 9400;
  const vCirc_ms = progVcirc(body, alt_km) * 1000;
  const losses = { Earth: 1550, Moon: 20, Mars: 1100, Venus: 1700, Mercury: 200, Titan: 1400 };
  return vCirc_ms + (losses[body] || 800);
}

function _missionStageLabelById(stageDefId) {
  for (const sc of _scEdSC) {
    const def = sc.stages.find(d => d.stageId === stageDefId);
    if (def) return def.name + ' (' + sc.name + ')';
  }
  return stageDefId;
}

// Display name for a flight vehicle: if its stage stack exactly matches a defined
// spacecraft (e.g. after separating an Apollo CSM off the stack), show that
// spacecraft's name. Otherwise fall back to the joined stage names, then fv.name.
// Build <option> list for a vehicle's stages, addressed by index, with duplicate
// stage labels disambiguated as "Centaur V (1)" / "Centaur V (2)".
// Disambiguated label for a stage when its name repeats within `fv` (e.g. two
// identical stages in a separation / fuel-transfer stack): "Stage (Parent Vehicle)".
// If the parents share a name too, number them ("Centaur V (Vulcan Centaur #2)").
function _missionStageDisambig(fv, s, idx) {
  const base = x => _missionStageLabelById(x.stageDefinitionId);
  const name = base(s);
  const same = fv.stages.filter(x => base(x) === name);
  if (same.length <= 1) return name;
  const parent = s._parentName || '';
  const distinctParents = [...new Set(same.map(x => x._parentName || ''))];
  if (parent && distinctParents.length > 1) return `${name} (${parent})`;
  // parents collide (or unknown) → number by launch instance (parent kid)
  const kids = [...new Set(same.map(x => (x._parentKid != null ? String(x._parentKid) : '?')))];
  const inst = kids.indexOf(s._parentKid != null ? String(s._parentKid) : '?') + 1;
  return parent ? `${name} (${parent} #${inst})` : `${name} (${inst})`;
}

function _missionStageOptions(fv, detailFn) {
  const base = s => _missionStageLabelById(s.stageDefinitionId);
  const cnts = {}; fv.stages.forEach(s => { const b = base(s); cnts[b] = (cnts[b] || 0) + 1; });
  return fv.stages.map((s, i) => {
    const lbl = cnts[base(s)] > 1 ? _missionStageDisambig(fv, s, i) : base(s);
    const detail = detailFn ? detailFn(s) : '';
    return `<option value="${i}">${lbl}${detail ? ' — ' + detail : ''}</option>`;
  }).join('');
}

// Base name: derived from the stages' OWNER labels (launch vehicle / spacecraft), the
// same source the band view uses — so a vehicle reads identically everywhere ("Vulcan
// Centaur" stays "Vulcan Centaur" after staging, not "Centaur"). Falls back to a preset
// match or joined stage names for stages that were never owner-tagged.
function _missionVehicleBaseName(fv) {
  if (!fv || !fv.stages || !fv.stages.length) return fv ? fv.name : '?';
  // summarise: the vehicle's TOPMOST launch stage (the part leading it) + each
  // distinct spacecraft payload aboard. A lone S-II reads "S-II", an S-IVB+CSM
  // stack reads "S-IVB + Apollo CSM", and it stays correct after LV stages split.
  const scLabels = [];
  let topLv = null;
  fv.stages.forEach(s => {
    const sc = _missionStageOwner(s.stageDefinitionId);
    if (sc) { if (!scLabels.includes(sc.name)) scLabels.push(sc.name); }
    else { topLv = s._ownerLabel || _missionStageLabelById(s.stageDefinitionId); }   // last LV seen = topmost
  });
  const parts = [];
  if (topLv) parts.push(topLv);
  scLabels.forEach(n => parts.push(n));
  if (parts.length) return parts.join(' + ');
  const ids = fv.stages.map(s => s.stageDefinitionId);
  for (const sc of _scEdSC) {
    const scIds = (sc.stages || []).map(d => d.stageId);
    if (scIds.length === ids.length && scIds.every((x, k) => x === ids[k])) return sc.name;
  }
  const names = fv.stages.map(s => {
    for (const sc of _scEdSC) { const d = sc.stages.find(x => x.stageId === s.stageDefinitionId); if (d) return d.name; }
    return s.stageDefinitionId;
  });
  return names.join(' + ');
}
// Display name: the resolved name set by recompute (custom rename + #N disambiguation),
// falling back to the base name.
function _missionVehicleDisplayName(fv) {
  return (fv && fv.displayName) || _missionVehicleBaseName(fv);
}

function _missionVehicleRemainingDv(fv) {
  if (!fv || !fv.stages) return 0;
  let total = 0;
  for (let i = 0; i < fv.stages.length; i++) {
    const s = fv.stages[i];
    if ((s.isp || 0) <= 0) continue;
    const prop = progStageRemainingProp(s);
    if (prop <= 0) continue;
    const massAbove = fv.stages.slice(i + 1).reduce((sum, st) => sum + progStageMass(st), 0);
    const m_wet = progStageMass(s) + massAbove;
    total += progRocketEqDv(m_wet, prop, s.isp);
  }
  return total;
}

function missionBudget(m) {
  let dvExpended = 0, propConsumed = 0, payloadMass = 0;
  for (const e of (m.log || [])) {
    if (e.type === 'LAUNCH') {
      const sr = e.stagingResult || {};
      dvExpended  += sr.dvDelivered || 0;
      propConsumed += (sr.stages || []).reduce((s, st) => s + (st.propBurned || 0), 0);
      payloadMass  = e.payloadMass || payloadMass;
    } else if (e.type === 'BURN' || e.type === 'MANEUVER') {
      dvExpended  += e.dv_actual || 0;
      propConsumed += e.prop_consumed || 0;
    }
  }
  const fv = (typeof PROG_ACTIVE_PROGRAM !== 'undefined' && m.vehicleId)
    ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  const dvCapacityRemaining = fv ? _missionVehicleRemainingDv(fv) : 0;
  return {
    dvExpended:           Math.round(dvExpended),
    propConsumed:         Math.round(propConsumed),
    dvCapacityRemaining:  Math.round(dvCapacityRemaining),
    payloadMass:          Math.round(payloadMass),
  };
}

function _missionBudgetCardHTML(m) {
  const b = missionBudget(m);
  const capColor = b.dvCapacityRemaining > 0 ? 'var(--accent3)' : 'var(--accent2)';
  const kv = (k, v, color) => `<div class="mission-state-kv"><span class="mission-state-key">${k}</span><span class="mission-state-val"${color ? ` style="color:${color}"` : ''}>${v}</span></div>`;
  const _fv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  const _os = _fv && _fv.orbitState ? _fv.orbitState : null;
  const orbitGrid = _os ? `<div class="mission-state-grid">${kv('Body', _os.body || 'Earth')}${kv('Apogee', Math.round(_os.apogee || 0).toLocaleString() + ' km')}${kv('Perigee', Math.round(_os.perigee ?? _os.apogee ?? 0).toLocaleString() + ' km')}${kv('Inc', (_os.inclination || 0) + '&deg;')}</div>` : '';
  return `
    <div class="mcc-section-header">Mission ΔV Budget</div>
    <div class="mission-log-card">
      ${orbitGrid}
      <div class="mission-state-grid">
        ${kv('ΔV Expended', b.dvExpended.toLocaleString() + ' m/s')}
        ${kv('Prop Consumed', b.propConsumed.toLocaleString() + ' kg')}
        ${kv('ΔV Capacity Left', b.dvCapacityRemaining.toLocaleString() + ' m/s', capColor)}
        ${kv('Payload', b.payloadMass.toLocaleString() + ' kg')}
      </div>
    </div>`;
}

function _missionBurnSectionHTML(m) {
  const fv = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId];
  if (!fv || fv.status !== 'ORBIT') return '';
  const os  = fv.orbitState || {};
  const id  = m.missionId;
  const apo  = os.apogee  || 0;
  const peri = os.perigee ?? apo;
  const inc  = os.inclination || 0;
  const body = os.body || 'Earth';

  const stateKV = (k, v) => `<div class="mission-state-kv"><span class="mission-state-key">${k}</span><span class="mission-state-val">${v}</span></div>`;

  const propRows = fv.stages.map(s => {
    const p = Math.round(progStageRemainingProp(s));
    const cap = Math.round(progStageTotalCapacity(s));
    const pct = cap > 0 ? Math.round(p/cap*100) : 0;
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
      <span style="font-family:var(--mono);font-size:9px;color:${p > 0 ? 'var(--text-bright)' : 'var(--text-dim)'};flex:1;">${_missionStageLabelById(s.stageDefinitionId)}: ${p.toLocaleString()} / ${cap.toLocaleString()} kg (${pct}%)</span>
      <button onclick="missionDropStage('${id}','${s.stageDefinitionId}')" style="font-family:var(--mono);font-size:8px;padding:1px 5px;background:transparent;border:1px solid var(--border);color:var(--text-dim);cursor:pointer;letter-spacing:.05em;" title="Expend / separate this stage">expend</button>
    </div>`;
  }).join('');

  // default to the heaviest stage that still has propellant
  let defIdx = -1, _defMass = -1;
  fv.stages.forEach((s, i) => { if (progStageRemainingProp(s) > 0) { const mss = progStageMass(s); if (mss > _defMass) { _defMass = mss; defIdx = i; } } });
  const stageOpts = fv.stages.map((s, i) => {
    const p = Math.round(progStageRemainingProp(s));
    return `<option value="${s.stageDefinitionId}"${i === defIdx ? ' selected' : ''}${p === 0 ? ' disabled' : ''}>${_missionStageLabelById(s.stageDefinitionId)} (${p.toLocaleString()} kg)</option>`;
  }).join('');

  return `
    <div class="sl" style="margin-top:16px;">Stage Propellant</div>
    <div class="panel" style="padding:10px 12px;">
      <div style="display:flex;flex-direction:column;gap:3px;">${propRows}</div>
    </div>

    <div class="sl" style="margin-top:16px;">BURN Event</div>
    <div class="panel" style="padding:10px 12px;">
      <div class="cfg-row" style="flex-wrap:wrap;gap:10px 20px;align-items:flex-end;margin-bottom:10px;">
        <div class="cfg-item">
          <label class="cfg-label">Burn Type</label>
          <select id="burn-type-${id}" style="background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;"
            onchange="missionBurnTypeChanged('${id}')">
            <option value="HOHMANN">Hohmann Transfer</option>
            <option value="CIRC">Circularize at Apo</option>
            <option value="TLI">Trans-Lunar Injection</option>
            <option value="LOI">Lunar Orbit Insertion</option>
            <option value="PLANE_CHANGE">Plane Change</option>
            <option value="CUSTOM">Custom ΔV</option>
          </select>
        </div>
        <div id="burn-param-${id}" class="cfg-item">
          <label class="cfg-label" id="burn-param-lbl-${id}">Target Alt (km)</label>
          <input type="number" id="burn-param-val-${id}" class="field" value="35786" min="0" style="width:100px;"
            oninput="missionBurnPreview('${id}')">
        </div>
        <div class="cfg-item">
          <label class="cfg-label">Firing Stage</label>
          <select id="burn-stage-${id}" style="background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;">
            ${stageOpts}
          </select>
        </div>
      </div>
      <div id="burn-dv-${id}" style="font-family:var(--mono);font-size:11px;color:var(--text-dim);margin-bottom:10px;min-height:1.4em;"></div>
      <button class="act-btn" onclick="missionExecBurn('${id}')">&#9654; Execute Burn</button>
    </div>
  `;
}

function missionBurnTypeChanged(id) {
  const bt  = document.getElementById('burn-type-' + id)?.value;
  const div = document.getElementById('burn-param-' + id);
  const lbl = document.getElementById('burn-param-lbl-' + id);
  const val = document.getElementById('burn-param-val-' + id);
  if (!bt || !div) return;
  const hidden = bt === 'CIRC' || bt === 'TLI';
  div.style.display = hidden ? 'none' : 'flex';
  if (!hidden && lbl && val) {
    if (bt === 'LOI')          { lbl.textContent = 'LLO Alt (km)';  val.value = '100';   }
    else if (bt === 'PLANE_CHANGE') { lbl.textContent = 'New Inc (deg)'; val.value = '0'; }
    else if (bt === 'CUSTOM')  { lbl.textContent = 'ΔV (m/s)';      val.value = '500';   }
    else                       { lbl.textContent = 'Target Alt (km)'; val.value = '35786'; }
  }
  missionBurnPreview(id);
}

function missionBurnPreview(id) {
  const m = _missionGet(id);
  if (!m || !m.vehicleId) return;
  const fv  = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId];
  if (!fv) return;
  const os   = fv.orbitState || {};
  const body = os.body || 'Earth';
  const apo  = os.apogee || 0;
  const peri = os.perigee ?? apo;
  const inc  = os.inclination || 0;
  const bt   = document.getElementById('burn-type-' + id)?.value || 'HOHMANN';
  const pval = parseFloat(document.getElementById('burn-param-val-' + id)?.value) || 0;
  const el   = document.getElementById('burn-dv-' + id);
  if (!el) return;
  let dv = 0, note = '';
  try {
    if      (bt === 'HOHMANN')      { const h = progDvHohmann(body, peri, pval); dv = h.total_ms; note = `dv1 ${Math.round(h.dv1_ms).toLocaleString()} + dv2 ${Math.round(h.dv2_ms).toLocaleString()} m/s`; }
    else if (bt === 'CIRC')         { dv = progDvCircularizeAtApo(body, peri, apo); note = `circularize @ ${Math.round(apo).toLocaleString()} km`; }
    else if (bt === 'TLI')          { dv = progDvTLI(peri); note = `from ${Math.round(peri).toLocaleString()} km`; }
    else if (bt === 'LOI')          { dv = progDvLOI(pval, peri); note = `LLO ${pval} km`; }
    else if (bt === 'PLANE_CHANGE') { dv = progDvPlaneChange(body, (apo+peri)/2, Math.abs(pval - inc)); note = `${inc}° → ${pval}°`; }
    else if (bt === 'CUSTOM')       { dv = pval; note = 'manual'; }
  } catch(e) { dv = 0; note = 'n/a'; }
  el.innerHTML = `<span style="color:var(--text-dim)">Required ΔV: </span><span style="color:var(--accent3);font-size:13px;">${Math.round(dv).toLocaleString()} m/s</span>${note ? ` &nbsp;<span style="color:var(--text-dim);font-size:10px;">${note}</span>` : ''}`;
}

function _missionComputeBurn(fv, bt, pval) {
  const os = fv.orbitState || {};
  const body = os.body||'Earth';
  const apo = os.apogee||0;
  const peri = os.perigee ?? apo;
  const inc = os.inclination||0;
  const lan = os.lan||0;

  let dvTarget = 0, newOrbit = null, burnLabel = bt;
  if (bt === 'HOHMANN') {
    const h = progDvHohmann(body, peri, pval);
    dvTarget  = h.total_ms;
    newOrbit  = { body, apogee: pval, perigee: pval, inclination: inc, lan, epoch: 0, surface: false };
    burnLabel = `Hohmann → ${pval.toLocaleString()} km`;
  } else if (bt === 'CIRC') {
    dvTarget  = progDvCircularizeAtApo(body, peri, apo);
    newOrbit  = { body, apogee: apo, perigee: apo, inclination: inc, lan, epoch: 0, surface: false };
    burnLabel = `Circularize @ ${Math.round(apo).toLocaleString()} km`;
  } else if (bt === 'TLI') {
    dvTarget  = progDvTLI(peri);
    newOrbit  = { body: 'Moon', apogee: 100, perigee: 100, inclination: inc, lan, epoch: 0, surface: false };
    burnLabel = 'TLI';
  } else if (bt === 'LOI') {
    dvTarget  = progDvLOI(pval, peri);
    newOrbit  = { body: 'Moon', apogee: pval, perigee: pval, inclination: inc, lan, epoch: 0, surface: false };
    burnLabel = `LOI → ${pval} km (Moon)`;
  } else if (bt === 'PLANE_CHANGE') {
    dvTarget  = progDvPlaneChange(body, (apo + peri) / 2, Math.abs(pval - inc));
    newOrbit  = { body, apogee: apo, perigee: peri, inclination: pval, lan, epoch: 0, surface: false };
    burnLabel = `Plane Change ${inc}° → ${pval}°`;
  } else if (bt === 'CUSTOM') {
    dvTarget  = pval;
    newOrbit  = null;
    burnLabel = `Custom (${pval.toLocaleString()} m/s)`;
  }
  return { dvTarget, newOrbit, burnLabel };
}

function _missionSnapState(fv) {
  return {
    orbit: fv.orbitState ? {...fv.orbitState} : null,
    status: fv.status,
    fills: fv.stages.map(s => (s.tanks||[]).map(t => t.fill))
  };
}

function _missionRestoreState(fv, snap) {
  if (!snap) return;
  fv.orbitState = snap.orbit ? {...snap.orbit} : fv.orbitState;
  if (snap.status) fv.status = snap.status;
  if (snap.fills) fv.stages.forEach((s,i)=>{
    (s.tanks||[]).forEach((t,j)=>{
      if (snap.fills[i] && snap.fills[i][j] != null) t.fill = snap.fills[i][j];
    });
  });
}

// ── PURE APPLIER: computes burn, dispatches BURN progEvent, updates fv orbit.
// Does NOT push to m.log — that is done by missionRecompute.
function _missionApplyBurn(fv, bt, pval, stageId) {
  let dvTarget, newOrbit, burnLabel;
  try {
    ({ dvTarget, newOrbit, burnLabel } = _missionComputeBurn(fv, bt, pval));
  } catch(e) {
    return { result: 'FAILED' };
  }

  const ev = progMakeEvent('BURN', {
    vehicleId:    fv.vehicleId,
    stagingStageId: stageId || null,
    burnType:     bt,
    dvTarget:     dvTarget,
  });
  const res = progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);

  if (newOrbit && res.result !== 'FAILED') {
    fv.orbitState = newOrbit;
    fv.status = 'ORBIT';
  }

  return {
    dvTarget,
    dv_actual:     res.dv_actual  || 0,
    prop_consumed: res.prop_consumed || 0,
    burnLabel,
    result:        res.result,
  };
}

// Capture a serialisable snapshot of every live vehicle's state at a point in time.
// Names are disambiguated (#N) within the snapshot so duplicates are distinguishable.
// Single source of truth for vehicle display names. When several live vehicles share
// a base name, distinguish them by the (user-chosen) parent launch name carried on
// their stages; only fall back to "#N" when parents repeat or are unknown. Returns a
// Map(vehicle -> resolved name). Used by BOTH the recompute naming pass and snapshots
// so the roster, editors, cards, band view and state monitor never disagree.
function _missionResolveDisplayNames(live, baseOf) {
  const parentOf = v => {
    const ps = [...new Set((v.stages || []).map(s => s._parentName).filter(Boolean))];
    return ps.length === 1 ? ps[0] : (ps.length ? ps.join(' + ') : '');
  };
  const byBase = {};
  live.forEach(v => { const b = baseOf(v); (byBase[b] = byBase[b] || []).push(v); });
  const out = new Map();
  Object.keys(byBase).forEach(b => {
    const arr = byBase[b];
    if (arr.length === 1) { out.set(arr[0], b); return; }
    arr.sort((x, y) => (x._birthOrd || 0) - (y._birthOrd || 0));
    const parents = arr.map(parentOf);
    if (parents.every(Boolean) && new Set(parents).size === arr.length) {
      arr.forEach((v, i) => out.set(v, b + ' (' + parents[i] + ')'));
    } else {
      const cnt = {}; parents.forEach(p => { if (p) cnt[p] = (cnt[p] || 0) + 1; });
      const seen = {};
      arr.forEach((v, i) => {
        const p = parents[i];
        if (p) { seen[p] = (seen[p] || 0) + 1; out.set(v, b + ' (' + p + (cnt[p] > 1 ? ' #' + seen[p] : '') + ')'); }
        else out.set(v, b + ' #' + (i + 1));
      });
    }
  });
  return out;
}

function _missionCaptureSnapshot(live, baseOf) {
  // disambiguate duplicate names with the shared resolver (parent-launch aware)
  const _names = _missionResolveDisplayNames(live, baseOf);
  const nameOf = v => _names.get(v) || baseOf(v);
  return live.map(v => {
    const name = nameOf(v);
    const os = v.orbitState;
    const alt = os ? (os.surface ? 0 : (((os.apogee ?? os.perigee ?? 0) + (os.perigee ?? os.apogee ?? 0)) / 2)) : 0;
    return {
      vehicleId: v.vehicleId,
      originKey: v._originKey || null,
      name, status: v.status || 'ORBIT',
      orbit: os ? { body: os.body, perigee: os.perigee, apogee: os.apogee, inclination: os.inclination, surface: !!os.surface } : null,
      alt,
      owners: [...new Set(v.stages.map(st => st._ownerKey || _missionStageOwnerKey(st.stageDefinitionId)))],
      remDv: Math.round(_missionVehicleRemainingDv(v)),
      remProp: Math.round(v.stages.reduce((s, st) => s + progStageRemainingProp(st), 0)),
      stages: v.stages.map(st => ({
        id: st.stageDefinitionId,
        name: _missionStageLabelById(st.stageDefinitionId),
        parent: st._parentName || '', parentKid: st._parentKid,
        prop: Math.round(progStageRemainingProp(st)),
        cap: Math.round(progStageTotalCapacity(st)),
        crew: st.crewAboard || 0,
      })),
    };
  });
}

// Expand the authored log into the effective replay log: a contiguous run of events
// sharing a groupId is repeated `group.repeat` times. The first pass uses the original
// event objects (so results/snapshots land back on m.log); repeats are shallow clones
// tagged _rep>0 + _clone. Every event gets _authIdx (its m.log index) for stable keys.
function _missionEffectiveLog(m) {
  const groups = m.groups || {};
  const out = [];
  let i = 0;
  while (i < m.log.length) {
    const e = m.log[i];
    const gid = e.groupId;
    if (gid && groups[gid]) {
      const range = [];
      while (i < m.log.length && m.log[i].groupId === gid) { range.push(i); i++; }
      const rep = Math.max(1, Math.min(99, groups[gid].repeat || 1));
      for (let r = 0; r < rep; r++) {
        range.forEach(idx => {
          const orig = m.log[idx];
          if (r === 0) { orig._authIdx = idx; orig._rep = 0; orig._clone = false; out.push(orig); }
          else { const c = Object.assign({}, orig); c._authIdx = idx; c._rep = r; c._clone = true; out.push(c); }
        });
      }
    } else { e._authIdx = i; e._rep = 0; e._clone = false; out.push(e); i++; }
  }
  return out;
}

// authored index range [start,end] of a group's events.
function _missionGroupRange(m, gid) {
  if (!gid) return null;
  let s = -1, e = -1;
  m.log.forEach((ev, i) => { if (ev.groupId === gid) { if (s < 0) s = i; e = i; } });
  return s >= 0 ? [s, e] : null;
}
// re-scope an owner key to repetition `rep` if its launch instance is inside `range`
// (so a transfer authored against "this loop's tanker" follows each repetition's tanker).
function _missionRescopeOwner(key, range, rep) {
  if (!key) return key;
  const h = key.indexOf('#'); if (h < 0) return key;
  const head = key.slice(0, h), kid = String(key.slice(h + 1));
  const ai = +kid.split(':')[0];
  if (range && ai >= range[0] && ai <= range[1]) return head + '#' + ai + (rep ? ':' + rep : '');
  return key;
}
// re-scope a vehicle ORIGIN key ('launch:3', 'sepU:5', …) to repetition `rep` if the
// originating event is inside `range` — used so any event (active or target) follows the
// current repetition's instance, while references to outside vehicles (a depot) stay put.
function _missionRescopeOriginKey(key, range, rep) {
  if (!key) return key;
  const parts = String(key).split(':');   // [type, authIdx, rep?]
  const type = parts[0], ai = +parts[1];
  if (isNaN(ai)) return key;
  if (range && ai >= range[0] && ai <= range[1]) return type + ':' + ai + (rep ? ':' + rep : '');
  return key;
}
// Resolve a transfer's source/dest stage indices by OWNER (scoped per repetition), so a
// repeated transfer targets the current loop's vehicle instead of the original by position.
function _missionResolveXferStages(m, e, active, si, di) {
  const ownerPos = (idx) => { const k = active.stages[idx] && active.stages[idx]._ownerKey; let p = 0; for (let i = 0; i < idx; i++) if (active.stages[i]._ownerKey === k) p++; return p; };
  const nthOwner = (k, p) => { let c = 0; for (let i = 0; i < active.stages.length; i++) { if (active.stages[i]._ownerKey === k) { if (c === p) return i; c++; } } return -1; };
  const auth = m.log[e._authIdx] || e;
  if (!e._clone) {
    if (active.stages[si]) { auth._srcOwner = active.stages[si]._ownerKey; auth._srcPos = ownerPos(si); }
    if (active.stages[di]) { auth._dstOwner = active.stages[di]._ownerKey; auth._dstPos = ownerPos(di); }
    return { si, di };
  }
  const range = _missionGroupRange(m, e.groupId);
  const sk = _missionRescopeOwner(auth._srcOwner, range, e._rep);
  const dk = _missionRescopeOwner(auth._dstOwner, range, e._rep);
  const rsi = sk != null ? nthOwner(sk, auth._srcPos || 0) : -1;
  const rdi = dk != null ? nthOwner(dk, auth._dstPos || 0) : -1;
  return { si: rsi >= 0 ? rsi : si, di: rdi >= 0 ? rdi : di };
}
// Resolve a SEPARATE's split index by owner (the stage at the split), re-scoped per
// repetition so each loop jettisons that loop's vehicle, not the original.
function _missionResolveSepIndex(m, e, active, sepIndex) {
  const auth = m.log[e._authIdx] || e;
  if (!e._clone) { if (active.stages[sepIndex]) auth._sepOwner = active.stages[sepIndex]._ownerKey; return sepIndex; }
  const range = _missionGroupRange(m, e.groupId);
  const k = _missionRescopeOwner(auth._sepOwner, range, e._rep);
  if (k != null) { const idx = active.stages.findIndex(st => st._ownerKey === k); if (idx > 0) return idx; }
  return sepIndex;
}

// ── RECOMPUTE ENGINE: tear down & replay the full mission log from scratch ──
function missionRecompute(m) {
  if (!m || typeof PROG_ACTIVE_PROGRAM === 'undefined') return;
  // tear down this mission's runtime vehicles
  (m.vehicleIds || []).forEach(vid => { if (PROG_ACTIVE_PROGRAM.vehicles[vid]) delete PROG_ACTIVE_PROGRAM.vehicles[vid]; });
  m.vehicleIds = []; m.vehicleId = null;
  let active = null;   // current active runtime FlightVehicle
  let live = [];       // all live runtime FlightVehicles for this mission
  // Resolve the vehicle an event targets — stable across replays even when ids
  // regenerate and names duplicate.
  // Resolve the vehicle an event ACTS ON. For repeated (cloned) events the stored key is
  // re-scoped to this repetition, so each loop targets its own instance; references to
  // outside vehicles (a depot) keep their key. Falls back to name (originals) then active.
  const resolveActive = ev => {
    if (ev && ev.activeKey) {
      const key = ev._clone ? _missionRescopeOriginKey(ev.activeKey, _missionGroupRange(m, ev.groupId), ev._rep) : ev.activeKey;
      const f = live.find(v => v._originKey === key && v.status !== 'EXPENDED' && v.status !== 'RECOVERED');
      if (f) return f;
    }
    const name = ev && ev.activeName;
    if (name && !(ev && ev._clone)) { const f = live.find(v => v.status !== 'EXPENDED' && v.status !== 'RECOVERED' && _missionVehicleDisplayName(v) === name); if (f) return f; }
    return active;
  };
  // Find a specific (possibly expended) TARGET vehicle. For cloned events the key is
  // re-scoped to this repetition first. Then display name, then internal name.
  const findVehE = (ev, key, name) => {
    const k = (ev && ev._clone) ? _missionRescopeOriginKey(key, _missionGroupRange(m, ev.groupId), ev._rep) : key;
    return (k && live.find(v => v._originKey === k)) ||
      (key && live.find(v => v._originKey === key)) ||
      (name && !(ev && ev._clone) && live.find(v => _missionVehicleDisplayName(v) === name)) ||
      (name && !(ev && ev._clone) && live.find(v => v.name === name)) || null;
  };
  // base name resolver (custom rename by origin key, else computed base) — shared by
  // the per-event snapshots and the final display-name pass.
  m.vehicleNames = m.vehicleNames || {};
  const baseOf = v => (v._originKey && m.vehicleNames[v._originKey]) || _missionVehicleBaseName(v);
  // tag each stage with a band-view owner key scoped to its LAUNCH INSTANCE (kid),
  // so two launches of the same vehicle (incl. repeated group launches) get distinct
  // owner tracks AND stage-level ops can re-target the right repetition's vehicle.
  m._ownerLabels = {};
  const tagOwners = (fv, kid, parentName) => {
    fv.stages.forEach((st, i) => {
      const sc = _missionStageOwner(st.stageDefinitionId);
      if (sc) {
        // a whole spacecraft is ONE owner (CSM stays one track / name)
        st._ownerKey = 'sc:' + sc.spacecraftId + '#' + kid;
        st._ownerLabel = sc.name;
      } else {
        // each LAUNCH-VEHICLE stage is its OWN owner, so separating LV stages
        // (e.g. S-IVB from S-II) yields two distinctly-named vehicles instead of
        // "S-IVB #1 / #2". The band node-graph still draws co-located owners as one
        // track, so the launch stack stays a single line until it actually splits.
        st._ownerKey = 'lv' + i + '#' + kid;
        st._ownerLabel = _missionStageLabelById(st.stageDefinitionId);
      }
      // remember which launch/vehicle this stage came from, so identical stages in a
      // docked / transfer stack can be told apart by their parent.
      st._parentName = parentName; st._parentKid = kid;
      m._ownerLabels[st._ownerKey] = st._ownerLabel;
    });
  };
  // Stable birth order keyed by ORIGIN identity (not object), so a vehicle's #N stays
  // fixed even as dock/separate recreate its object and reorder the live array.
  const birthOrd = {}; let birthSeq = 0;
  const markBirth = fv => {
    if (!fv || fv._originKey == null) return;
    if (!(fv._originKey in birthOrd)) birthOrd[fv._originKey] = birthSeq++;
    fv._birthOrd = birthOrd[fv._originKey];
  };

  // Expand event groups into the effective replay log (repetitions cloned with
  // repetition-scoped keys so each repeat creates fresh, independent vehicles).
  const expanded = _missionEffectiveLog(m);
  m._expanded = expanded;

  for (let evIdx = 0; evIdx < expanded.length; evIdx++) {
    const e = expanded[evIdx];
    const kid = e._authIdx + (e._rep ? ':' + e._rep : '');   // stable per authored-event + repetition
    if (e.type === 'LAUNCH') {
      const r = _missionApplyLaunch(m, e);
      if (!r || !r.fv) { e.result = 'FAILED'; continue; }
      r.fv._originKey = 'launch:' + kid;
      tagOwners(r.fv, kid, (m.vehicleNames && m.vehicleNames['launch:' + kid]) || e.label || 'Vehicle'); markBirth(r.fv);
      e.vehicleId = r.fv.vehicleId; e.stagingResult = r.stagingResult;
      e.payloadMass = r.payloadMass; e.payloadNames = r.payloadNames;
      live.push(r.fv); active = r.fv;
    } else if (e.type === 'DEPLOY') {
      const r = _missionApplyDeploy(m, e);
      if (!r || !r.fv) { e.result = 'FAILED'; continue; }
      r.fv._originKey = 'deploy:' + kid;
      tagOwners(r.fv, kid, (m.vehicleNames && m.vehicleNames['deploy:' + kid]) || e.label || 'Vehicle'); markBirth(r.fv);
      e.vehicleId = r.fv.vehicleId; e.payloadMass = r.payloadMass; e.payloadNames = r.payloadNames;
      live.push(r.fv); active = r.fv;
    } else if (e.type === 'BURN') {
      active = resolveActive(e);
      if (!active) continue;
      e.vehicleId = active.vehicleId;
      const res = _missionApplyBurn(active, e.burnType, e.burnParam, e.stageId);
      e.dvTarget = res.dvTarget; e.dv_actual = res.dv_actual; e.prop_consumed = res.prop_consumed;
      e.burnLabel = res.burnLabel; e.result = res.result;
      e.orbitAfter = active.orbitState ? { ...active.orbitState } : null;
    } else if (e.type === 'MANEUVER') {
      active = resolveActive(e);
      if (active) e.vehicleId = active.vehicleId;
      _missionApplyManeuver(active, e);
    } else if (e.type === 'SEPARATE' && e.result === 'SUCCESS') {
      const sepActor = resolveActive(e); if (sepActor) active = sepActor;   // editable: which vehicle separates
      if (!active) continue;
      const parentKey = active._originKey;
      const sepIdx = _missionResolveSepIndex(m, e, active, e.sepIndex);   // owner-scoped per repetition
      const ev = progMakeEvent('SEPARATE', { vehicleId: active.vehicleId, separationIndex: sepIdx });
      const res = progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);
      if (res.result === 'SUCCESS') {
        const lower = PROG_ACTIVE_PROGRAM.vehicles[res.lowerVehicleId];
        const upper = PROG_ACTIVE_PROGRAM.vehicles[res.upperVehicleId];
        // the lower (continuing) vehicle keeps the parent's identity inside a group so a
        // persistent depot can be docked again next repetition; the jettisoned upper is new.
        if (lower) lower._originKey = (e.groupId && parentKey) ? parentKey : ('sepL:' + kid);
        if (upper) upper._originKey = 'sepU:' + kid;
        markBirth(lower); markBirth(upper);
        e.parentVehicleId = active.vehicleId; e.lowerVehicleId = res.lowerVehicleId; e.upperVehicleId = res.upperVehicleId;
        e.parentName = _missionVehicleDisplayName(active);
        e.lowerName = lower ? _missionVehicleDisplayName(lower) : '?'; e.upperName = upper ? _missionVehicleDisplayName(upper) : '?';
        e.lowerStages = lower ? lower.stages.length : 0; e.upperStages = upper ? upper.stages.length : 0;
        live = live.filter(v => v !== active); if (lower) live.push(lower); if (upper) live.push(upper);
        active = upper || lower || null;
      }
    } else if (e.type === 'DOCK' && e.result === 'SUCCESS') {
      const dockActor = resolveActive(e); if (dockActor) active = dockActor;   // editable: which vehicle docks
      // target by stable key first (so a persistent depot is found again every repetition),
      // then by internal name. The merged vehicle inherits the target's identity + owner tags.
      const tKey = e._clone ? _missionRescopeOriginKey(e.targetKey, _missionGroupRange(m, e.groupId), e._rep) : e.targetKey;
      const target = (tKey && live.find(v => v !== active && v._originKey === tKey))
        || (e.targetKey && live.find(v => v !== active && v._originKey === e.targetKey))
        || live.find(v => v !== active && v.name === e.tName);
      if (active && target) {
        const targetKey0 = target._originKey;
        e.aDisp = _missionVehicleBaseName(active); e.tDisp = _missionVehicleBaseName(target);   // clean names for the card
        const ev = progMakeEvent('DOCK', { vehicleIds: [active.vehicleId, target.vehicleId], bottomVehicleId: target.vehicleId });
        const res = progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);
        if (res.result === 'SUCCESS') {
          const merged = PROG_ACTIVE_PROGRAM.vehicles[res.vehicleId];
          if (merged) {
            merged._originKey = targetKey0 || ('dock:' + kid);   // keep the depot's identity across repetitions
            markBirth(merged);
            // preserve each stage's owner tag (progMakeFlightVehicle reuses the stage objects)
            merged.stages.forEach(st => { if (st._ownerKey == null) { const sc = _missionStageOwner(st.stageDefinitionId); st._ownerKey = (sc ? 'sc:' + sc.spacecraftId : 'lv') + '#dock'; } });
          }
          e.aVehId = active.vehicleId; e.tVehId = target.vehicleId; e.mergedVehicleId = res.vehicleId;
          e.mergedName = merged ? _missionVehicleDisplayName(merged) : '?'; e.mergedStages = merged ? merged.stages.length : 0;
          live = live.filter(v => v !== active && v !== target); if (merged) live.push(merged);
          active = merged || null;
        }
      }
    } else if (e.type === 'EXPEND') {
      const tgt = findVehE(e, e.targetKey, e.vehicleName || e.stageName) || active;
      if (tgt) { tgt.status = 'EXPENDED'; e.vehicleId = tgt.vehicleId; if (e.vehicleLevel) e.vehicleName = _missionVehicleDisplayName(tgt); if (active === tgt) active = live.find(v => v !== tgt && v.status !== 'EXPENDED') || tgt; }
    }
    else if (e.type === 'RENDEZVOUS') {
      active = resolveActive(e);
      if (active) { e.vehicleId = active.vehicleId; e.activeName = _missionVehicleDisplayName(active); }
      const tgt = findVehE(e, e.targetKey, e.targetName);
      if (tgt) { e.targetName = _missionVehicleDisplayName(tgt); e.targetVehId = tgt.vehicleId; }
      if (active && tgt && tgt !== active && tgt.orbitState) { active.orbitState = { ...tgt.orbitState }; e.matched = true; } else { e.matched = false; }
    }
    else if (e.type === 'TRANSFER_PROPELLANT') {
      active = resolveActive(e);
      if (active) {
        // resolve the destination vehicle: another live vehicle (a depot) if set, else active
        let dstFv = active;
        if (e.destVehicleKey) {
          const dk = e._clone ? _missionRescopeOriginKey(e.destVehicleKey, _missionGroupRange(m, e.groupId), e._rep) : e.destVehicleKey;
          dstFv = live.find(v => v._originKey === dk) || live.find(v => v._originKey === e.destVehicleKey) || active;
        }
        if (dstFv === active) {
          const r = _missionResolveXferStages(m, e, active, e.sourceIndex, e.destIndex);
          e.sourceIndex = r.si; e.destIndex = r.di;
        } else {
          // cross-vehicle: clamp each index to its own vehicle's stage list
          e.sourceIndex = Math.min(Math.max(0, e.sourceIndex || 0), active.stages.length - 1);
          e.destIndex   = Math.min(Math.max(0, e.destIndex   || 0), dstFv.stages.length - 1);
        }
        e.vehicleId = active.vehicleId; e.destVehicleId = dstFv.vehicleId;
        _missionApplyPropTransfer(active, dstFv, e);
      }
    }
    else if (e.type === 'TRANSFER_CREW') {
      active = resolveActive(e);
      if (active) {
        const r = _missionResolveXferStages(m, e, active, e.sourceIndex, e.destIndex);
        e.sourceIndex = r.si; e.destIndex = r.di;
        e.vehicleId = active.vehicleId; _missionApplyCrewTransfer(active, e);
      }
    }
    else if (e.type === 'REENTER') {
      active = resolveActive(e);
      if (active) { e.vehicleId = active.vehicleId; e.vehicleName = _missionVehicleDisplayName(active);
        const ev = progMakeEvent('LAND', { vehicleId: active.vehicleId, body: 'Earth' });
        progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);
        e.orbitAfter = active.orbitState ? { ...active.orbitState } : null; e.result = 'SUCCESS'; }
    }
    else if (e.type === 'RECOVER') {
      const tgt = findVehE(e, e.targetKey, e.vehicleName) || active;
      if (tgt) { tgt.status = 'RECOVERED'; e.vehicleId = tgt.vehicleId; e.vehicleName = _missionVehicleDisplayName(tgt);
        if (active === tgt) active = live.find(v => v !== tgt && v.status !== 'EXPENDED' && v.status !== 'RECOVERED') || tgt; }
    }
    // per-event snapshot: state of every live vehicle AFTER this event (the band
    // monitor reads this so scrubbing shows the exact state at that point in time).
    e.snapshot = _missionCaptureSnapshot(live, baseOf);
    e.activeOriginKey = active ? (active._originKey || null) : null;
  }
  // ── resolve display names: custom rename (by stable origin key) + #N for duplicates,
  //    numbered by stable BIRTH order so a vehicle's # never shifts as docks/separates
  //    reorder the live array. ──
  const _resolved = _missionResolveDisplayNames(live, baseOf);
  live.forEach(v => { v.displayName = _resolved.get(v) || baseOf(v); });
  // refresh cached child names on separate/dock cards to match
  expanded.forEach(e => {
    if (e.type === 'SEPARATE' && e.result === 'SUCCESS') {
      const lo = PROG_ACTIVE_PROGRAM.vehicles[e.lowerVehicleId], up = PROG_ACTIVE_PROGRAM.vehicles[e.upperVehicleId];
      if (lo && lo.displayName) e.lowerName = lo.displayName;
      if (up && up.displayName) e.upperName = up.displayName;
    } else if (e.type === 'DOCK' && e.result === 'SUCCESS') {
      const mg = PROG_ACTIVE_PROGRAM.vehicles[e.mergedVehicleId];
      if (mg && mg.displayName) e.mergedName = mg.displayName;
    } else if ((e.type === 'EXPEND' && e.vehicleLevel) || e.type === 'RECOVER' || e.type === 'REENTER') {
      const v = PROG_ACTIVE_PROGRAM.vehicles[e.vehicleId];
      if (v && v.displayName) e.vehicleName = v.displayName;
    } else if (e.type === 'RENDEZVOUS') {
      const a = PROG_ACTIVE_PROGRAM.vehicles[e.vehicleId];
      if (a && a.displayName) e.activeName = a.displayName;
      const t = e.targetVehId ? PROG_ACTIVE_PROGRAM.vehicles[e.targetVehId] : null;
      if (t && t.displayName) e.targetName = t.displayName;
    }
  });

  m.vehicleIds = live.map(v => v.vehicleId);
  m.vehicleId = active ? active.vehicleId : (m.vehicleIds[0] || null);
}

// Rename an on-orbit vehicle via an in-app modal (no browser prompt). Persists by
// the vehicle's stable origin key so the name survives recompute.
function missionRenameVehicle(id, originKey) {
  const m = _missionGet(id); if (!m || !originKey) return;
  m.vehicleNames = m.vehicleNames || {};
  const current = (m.vehicleNames[originKey] || '').replace(/"/g, '&quot;');
  const body = document.getElementById('mrename-body'); if (!body) return;
  body.innerHTML = `
    <label class="cfg-label">Vehicle name</label>
    <input id="mrename-input" class="mcc-field-input" style="width:100%;margin-bottom:8px;" value="${current}" placeholder="e.g. CSM Columbia" maxlength="40"
      onkeydown="if(event.key==='Enter')missionRenameApply('${id}','${originKey}')">
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:12px;">// leave blank to use the automatic name</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;">
      <button class="act-btn" onclick="closeModal('modal-mission-rename')">Cancel</button>
      <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;" onclick="missionRenameApply('${id}','${originKey}')">Save</button>
    </div>`;
  openModal('modal-mission-rename');
  setTimeout(() => { const el = document.getElementById('mrename-input'); if (el) { el.focus(); el.select(); } }, 30);
}
function missionRenameApply(id, originKey) {
  const m = _missionGet(id); if (!m) return;
  m.vehicleNames = m.vehicleNames || {};
  const name = (document.getElementById('mrename-input')?.value || '').trim();
  if (name) m.vehicleNames[originKey] = name.slice(0, 40); else delete m.vehicleNames[originKey];
  closeModal('modal-mission-rename');
  missionRecompute(m);
  missionRenderDetail();
}

function missionExecBurn(id) {
  const m = _missionGet(id);
  if (!m || !m.vehicleId) return;
  const fv  = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId];
  if (!fv)  return;
  const bt   = document.getElementById('burn-type-' + id)?.value || 'HOHMANN';
  const pval = parseFloat(document.getElementById('burn-param-val-' + id)?.value) || 0;
  const stageId = document.getElementById('burn-stage-' + id)?.value || null;
  m.log.push({ type: 'BURN', burnType: bt, burnParam: pval, stageId, activeKey: fv._originKey, activeName: _missionVehicleDisplayName(fv) });
  _missionAddEvt = null;  _missionExpandLast(m);
  missionRecompute(m);
  missionRenderDetail();
}

function missionApplyBurnEdit(id, idx) {
  const m = _missionGet(id); if(!m) return;
  const e = m.log[idx]; if(!e || e.type!=='BURN') return;
  const bt = document.getElementById('edit-burn-type-'+id)?.value || e.burnType;
  const pval = parseFloat(document.getElementById('edit-burn-param-'+id)?.value) || 0;
  e.burnType = bt; e.burnParam = pval;
  closeModal('modal-mission-evt');
  missionRecompute(m);
  missionRenderDetail();
}

function missionApplyManeuverEdit(id, idx) {
  const m = _missionGet(id); if(!m) return;
  const e = m.log[idx]; if(!e || e.type!=='MANEUVER') return;
  const from = document.getElementById('edit-mv-from-'+id)?.value || e.fromNode;
  const to   = document.getElementById('edit-mv-to-'+id)?.value || e.toNode;
  const lbl = nid => { const n = _missionNmNodeById(nid); return n ? (n.sub ? n.label + ' (' + n.sub + ')' : n.label) : nid; };
  e.fromNode = from; e.toNode = to; e.fromLabel = lbl(from); e.toLabel = lbl(to);
  closeModal('modal-mission-evt');
  missionRecompute(m);   // recompute refreshes ΔV/prop from the new node pair (steps unchanged)
  missionRenderDetail();
}

function missionApplyDeployEdit(id, idx) {
  const m = _missionGet(id); if(!m) return;
  const e = m.log[idx]; if(!e || e.type!=='DEPLOY') return;
  const scId = document.getElementById('edit-deploy-sc-'+id)?.value;
  const sc = _scEdSC.find(s => s.spacecraftId === scId);
  if (sc) { e.spacecraftId = scId; e.label = sc.name; }
  const emptyEl = document.getElementById('edit-deploy-empty-'+id);
  if (emptyEl) e.emptyTanks = emptyEl.checked;
  closeModal('modal-mission-evt');
  missionRecompute(m);
  missionRenderDetail();
}

// Vehicles available ENTERING event idx = the post-state of the most recent prior
// event that has a snapshot. Used to populate the separate/dock/expend selectors.
function _missionVehiclesBeforeEvent(m, idx) {
  const log = (m._expanded && m._expanded.length) ? m._expanded : m.log;
  for (let j = idx - 1; j >= 0; j--) {
    if (log[j] && log[j].snapshot && log[j].snapshot.length) {
      return log[j].snapshot
        .filter(v => v.status !== 'EXPENDED' && v.status !== 'RECOVERED' && v.originKey)
        .map(v => ({ key: v.originKey, name: v.name }));
    }
  }
  return [];
}
// The active vehicle's per-stage state AS OF the moment event idx fires (the prior
// event's snapshot, matched by stable origin key — falling back to this event's own
// post-state). Used so the maneuver/transfer editors show point-in-time propellant,
// not the depleted end-of-mission state.
function _missionPreSnapStages(m, idx, originKey, vehId) {
  const log = (m._expanded && m._expanded.length) ? m._expanded : m.log;
  const pick = snap => snap && (
    (originKey && snap.find(s => s.originKey === originKey)) ||
    (vehId && snap.find(s => s.vehicleId === vehId)) || null);
  for (let j = idx - 1; j >= 0; j--) {
    const v = pick(log[j] && log[j].snapshot);
    if (v) return v.stages || [];
  }
  const own = pick(log[idx] && log[idx].snapshot);
  return own ? (own.stages || []) : [];
}
// Runtime vehicle (from the last recompute) for this mission matching an origin key.
function _missionVehByKey(m, key) {
  if (!key) return null;
  return (m.vehicleIds || []).map(v => PROG_ACTIVE_PROGRAM.vehicles[v]).find(v => v && v._originKey === key) || null;
}

function missionApplyLaunchEdit(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LAUNCH') return;
  const lv = document.getElementById('edit-launch-lv-' + id)?.value;
  if (lv) { e.fleetEntryId = lv; const f = _fleetGet(lv); if (f) e.label = f.name; }
  e.payloadScIds = [...document.querySelectorAll('.edit-launch-pay-' + id + ':checked')].map(c => c.value);
  const o = e.orbit || (e.orbit = {});
  const body = document.getElementById('edit-launch-body-' + id)?.value; if (body) o.body = body;
  o.alt_km = +document.getElementById('edit-launch-alt-' + id)?.value || 0;
  o.apo_km = +document.getElementById('edit-launch-apo-' + id)?.value || o.alt_km;
  o.inc_deg = +document.getElementById('edit-launch-inc-' + id)?.value || 0;
  e.launchOrbit = { ...o };
  closeModal('modal-mission-evt'); missionRecompute(m); missionRenderDetail();
}
// Provisionally set which vehicle separates, then refresh the modal so the stage
// list matches the chosen vehicle (no recompute until Apply).
function missionSepEditSetVehicle(id, idx, key) {
  const m = _missionGet(id); if (!m || !m.log[idx]) return;
  m.log[idx].activeKey = key || null;
  const b = document.getElementById('mevt-body'); if (b) b.innerHTML = _missionEventDetailHTML(m, idx);
}
function missionApplySeparateEdit(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'SEPARATE') return;
  const vk = document.getElementById('edit-sep-veh-' + id)?.value; if (vk) e.activeKey = vk;
  const si = document.getElementById('edit-sep-idx-' + id)?.value; if (si != null && si !== '') e.sepIndex = +si;
  closeModal('modal-mission-evt'); missionRecompute(m); missionRenderDetail();
}
function missionApplyDockEdit(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'DOCK') return;
  const a = document.getElementById('edit-dock-a-' + id)?.value;
  const b = document.getElementById('edit-dock-b-' + id)?.value;
  if (a) { e.activeKey = a; delete e.aName; }
  if (b) { e.targetKey = b; delete e.tName; }
  closeModal('modal-mission-evt'); missionRecompute(m); missionRenderDetail();
}
function missionApplyExpendEdit(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'EXPEND') return;
  const vk = document.getElementById('edit-expend-veh-' + id)?.value;
  if (vk) { e.targetKey = vk; e.vehicleLevel = true; delete e.stageName; }
  closeModal('modal-mission-evt'); missionRecompute(m); missionRenderDetail();
}

function missionApplyPropTransferEdit(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'TRANSFER_PROPELLANT') return;
  const srcI = parseInt(document.getElementById('edit-xfer-src-' + id)?.value, 10);
  const dstI = parseInt(document.getElementById('edit-xfer-dst-' + id)?.value, 10);
  const mass = parseFloat(document.getElementById('edit-xfer-mass-' + id)?.value) || 0;
  if (!isNaN(srcI)) e.sourceIndex = srcI;
  if (!isNaN(dstI)) e.destIndex = dstI;
  e.mass_kg = mass;
  const fv = e.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[e.vehicleId] : null;
  const ss = fv ? fv.stages[e.sourceIndex] : null;
  if (ss && ss.tanks && ss.tanks[0]) e.propellantType = ss.tanks[0].propellantType;
  closeModal('modal-mission-evt');
  missionRecompute(m);
  missionRenderDetail();
}
function missionPropXferEditMax(id, idx) {
  const m = _missionGet(id); if (!m || !m.log[idx]) return;
  const e = m.log[idx];
  const stages = _missionPreSnapStages(m, idx, e.activeKey, e.vehicleId);
  const si = parseInt(document.getElementById('edit-xfer-src-' + id)?.value, 10);
  const s = stages[si]; const el = document.getElementById('edit-xfer-mass-' + id);
  if (s && el) el.value = Math.round(s.prop || 0);
}

function missionDropStage(missionId, stageDefId) {
  const m = _missionGet(missionId);
  if (!m || !m.vehicleId) return;
  const fv = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId];
  if (!fv) return;
  const idx = fv.stages.findIndex(s => s.stageDefinitionId === stageDefId);
  if (idx < 0) return;
  // resolve name before removal
  let label = stageDefId;
  for (const sc of _scEdSC) {
    const def = sc.stages.find(d => d.stageId === stageDefId);
    if (def) { label = def.name + ' (' + sc.name + ')'; break; }
  }
  fv.stages.splice(idx, 1);
  m.log.push({ type: 'EXPEND', stageName: label, orbitAfter: fv.orbitState ? { ...fv.orbitState } : null });
  missionRenderDetail();
}

function _missionBurnLogCardHTML(entry) {
  const statusColor = entry.result === 'SUCCESS' ? 'var(--accent3)' : entry.result === 'MARGINAL' ? 'var(--accent2)' : 'var(--error,#e06c75)';
  const o   = entry.orbitAfter || {};
  const stateKV = (k, v) => `<div class="mission-state-kv"><span class="mission-state-key">${k}</span><span class="mission-state-val">${v}</span></div>`;
  const warns = (entry.warnings || []).map(w => `<div style="color:var(--accent2);font-family:var(--mono);font-size:9px;">${w}</div>`).join('');
  return `<div class="mission-log-card">
    <div class="mission-log-header">
      <span class="mission-log-type">BURN</span>
      <span style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;padding:1px 6px;border:1px solid ${statusColor};color:${statusColor}">${entry.result}</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto">${entry.burnLabel}</span>
    </div>
    <div class="mission-state-grid">
      ${stateKV('Target ΔV',   Math.round(entry.dvTarget).toLocaleString() + ' m/s')}
      ${stateKV('Actual ΔV',   Math.round(entry.dv_actual).toLocaleString() + ' m/s')}
      ${stateKV('Prop Used',   Math.round(entry.prop_consumed).toLocaleString() + ' kg')}
    </div>
    <div class="mission-state-grid">
      ${stateKV('Body',    o.body || '?')}
      ${stateKV('Apogee',  Math.round(o.apogee || 0).toLocaleString() + ' km')}
      ${stateKV('Perigee', Math.round(o.perigee ?? o.apogee ?? 0).toLocaleString() + ' km')}
      ${stateKV('Inc',     (o.inclination || 0) + '&deg;')}
    </div>
    ${warns}
  </div>`;
}

// ── Step 3: multi-vehicle ops (SEPARATE / DOCK / EXPEND) ───────────────────────

function _missionLiveVehicles(m) {
  if (typeof PROG_ACTIVE_PROGRAM === 'undefined' || !PROG_ACTIVE_PROGRAM || !m.vehicleIds) return [];
  return m.vehicleIds
    .map(vid => ({ id: vid, fv: PROG_ACTIVE_PROGRAM.vehicles[vid] }))
    .filter(x => x.fv);
}

function missionSetActiveVehicle(id, vehId) {
  const m = _missionGet(id);
  if (!m) return;
  m.vehicleId = vehId;
  missionRenderDetail();
}

function missionSetEvtFilter(id, kind, val) {
  if (kind === 'type') _missionEvtFilter.type = val;
  else if (kind === 'veh') _missionEvtFilter.veh = val;
  missionRenderDetail();
}

// Bodies you must INJECT toward (can't arrive without the transfer burn) → the
// transfer-corridor node that represents that injection.
const _MISSION_SOI_INJECT = { Moon: 'tli-corridor', Mars: 'mars-transfer', Venus: 'venus-transfer' };

// Click a body's SOI ring → add the injection maneuver from the focused vehicle's
// current orbit to that body's transfer corridor (TLI / TMI / TVI).
function missionInjectToBody(id, body) {
  const m = _missionGet(id);
  if (!m) return;
  const toNode = _MISSION_SOI_INJECT[body];
  if (!toNode) return;
  const fv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  let fromNode = fv ? _progNmVehicleNode(fv) : null;
  if (!fromNode) { const path = _missionNodePath(m); fromNode = path.length ? path[path.length - 1] : 'leo-185'; }
  missionExecManeuver(id, fromNode, toNode);
}

// ── Visual stage-stack split picker (for the SEPARATE add-event form) ────────
// Lists the active vehicle's stages top→bottom; the user drags a horizontal bar
// (or clicks between stages) to choose the split point. _missionSepIndex i means
// stages[0..i-1] stay below, stages[i..] detach above.
let _missionSepIndex = null;
let _missionSepDrag = null;

// Which spacecraft (if any) a live stage belongs to.
// Ownership key for a stage: the spacecraft it belongs to, else the launch vehicle.
// Used by the band view to give each spacecraft (and the LV) its own persistent track.
function _missionStageOwnerKey(stageDefId) {
  const sc = _missionStageOwner(stageDefId);
  return sc ? 'sc:' + sc.spacecraftId : 'lv';
}

function _missionStageOwner(stageDefId) {
  for (const sc of _scEdSC) if ((sc.stages || []).some(d => d.stageId === stageDefId)) return sc;
  return null;
}
// Contiguous spacecraft payload groups within a vehicle's stack.
function _missionPayloadGroups(fv) {
  const groups = [];
  let cur = null;
  (fv.stages || []).forEach((s, idx) => {
    const sc = _missionStageOwner(s.stageDefinitionId);
    if (sc) {
      if (cur && cur.scId === sc.spacecraftId) cur.endIndex = idx;
      else { cur = { scId: sc.spacecraftId, scName: sc.name, startIndex: idx, endIndex: idx }; groups.push(cur); }
    } else cur = null;
  });
  return groups;
}

function _missionSepPickerHTML(m) {
  const fv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  if (!fv || fv.stages.length < 2) return '<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// active vehicle needs ≥ 2 stages</div>';
  const n = fv.stages.length;
  if (_missionSepIndex == null || _missionSepIndex < 1 || _missionSepIndex > n - 1) _missionSepIndex = 1;
  const nm = s => _missionStageLabelById(s.stageDefinitionId);
  const id = m.missionId;
  let html = '<div class="msep-stack">';
  for (let k = n - 1; k >= 0; k--) {
    const inUpper = k >= _missionSepIndex;
    html += `<div class="msep-stage ${inUpper ? 'upper' : 'lower'}">${nm(fv.stages[k])}</div>`;
    if (k >= 1) {
      const i = k, sel = (i === _missionSepIndex);
      html += `<div class="msep-gap${sel ? ' sel' : ''}" data-i="${i}" onclick="missionSepSetIndex('${id}',${i})">${
        sel
          ? `<div class="msep-bar" onmousedown="missionSepDragStart(event,'${id}')"><span class="msep-grip">⇕ separate here — drag</span></div>`
          : '<div class="msep-line"></div>'
      }</div>`;
    }
  }
  html += '</div>';
  const upper = fv.stages.slice(_missionSepIndex).map(nm).join(' + ');
  const lower = fv.stages.slice(0, _missionSepIndex).map(nm).join(' + ');
  html += `<div class="msep-summary"><span style="color:var(--accent3)">↑ detaches:</span> ${upper}<br><span style="color:var(--text-dim)">↓ stays:</span> ${lower}</div>`;
  return html;
}

function missionSepSetIndex(id, i) {
  _missionSepIndex = i;
  const cont = document.getElementById('sep-pick-' + id);
  const m = _missionGet(id);
  if (cont && m) cont.innerHTML = _missionSepPickerHTML(m);
}
function missionSepDragStart(e, id) {
  e.preventDefault(); e.stopPropagation();
  _missionSepDrag = { id };
  document.addEventListener('mousemove', missionSepDragMove);
  document.addEventListener('mouseup', missionSepDragEnd);
}
function missionSepDragMove(e) {
  if (!_missionSepDrag) return;
  const id = _missionSepDrag.id;
  const cont = document.getElementById('sep-pick-' + id);
  if (!cont) return;
  let best = null, bestD = Infinity;
  cont.querySelectorAll('.msep-gap').forEach(g => {
    const r = g.getBoundingClientRect();
    const d = Math.abs(e.clientY - (r.top + r.height / 2));
    if (d < bestD) { bestD = d; best = +g.dataset.i; }
  });
  if (best != null && best !== _missionSepIndex) {
    _missionSepIndex = best;
    const m = _missionGet(id);
    if (m) cont.innerHTML = _missionSepPickerHTML(m);
  }
}
function missionSepDragEnd() {
  document.removeEventListener('mousemove', missionSepDragMove);
  document.removeEventListener('mouseup', missionSepDragEnd);
  _missionSepDrag = null;
}

function missionExecSeparate(id, sepIndex) {
  const m = _missionGet(id);
  if (!m || !m.vehicleId) return;
  const fv = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId];
  if (!fv) return;
  const idx = +sepIndex;
  const ev = progMakeEvent('SEPARATE', { vehicleId: m.vehicleId, separationIndex: idx });
  const res = progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);
  if (res.result !== 'SUCCESS') {
    m.log.push({ type: 'SEPARATE', result: 'FAILED', warnings: ev.warnings || [], parentName: fv.name });
    missionRenderDetail();
    return;
  }
  m.log.push({ type: 'SEPARATE', result: 'SUCCESS', sepIndex: idx, parentName: fv.name, activeKey: fv._originKey });
  _missionAddEvt = null;  _missionExpandLast(m);  missionRecompute(m);
  missionRenderDetail();
}

function missionExecDock(id, targetVehId) {
  const m = _missionGet(id);
  if (!m || !m.vehicleId || !targetVehId) return;
  const activeFV = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId];
  const targetFV = PROG_ACTIVE_PROGRAM.vehicles[targetVehId];
  if (!activeFV || !targetFV) return;
  const aName = activeFV.name, tName = targetFV.name;   // internal names — stable for replay matching
  const targetKey = targetFV._originKey;   // stable identity of the dock target (e.g. a depot)
  const ev = progMakeEvent('DOCK', { vehicleIds: [m.vehicleId, targetVehId], bottomVehicleId: targetVehId });
  const res = progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);
  if (res.result !== 'SUCCESS') {
    m.log.push({ type: 'DOCK', result: 'FAILED', warnings: ev.warnings || [], aName, tName, targetKey });
    missionRenderDetail();
    return;
  }
  m.log.push({ type: 'DOCK', result: 'SUCCESS', aName, tName, targetKey, activeKey: activeFV._originKey });
  _missionAddEvt = null;  _missionExpandLast(m);  missionRecompute(m);
  missionRenderDetail();
}

function missionExecExpendVehicle(id, vehId) {
  const m = _missionGet(id);
  if (!m || !vehId) return;
  const fv = PROG_ACTIVE_PROGRAM.vehicles[vehId];
  if (!fv) return;
  m.log.push({ type: 'EXPEND', vehicleLevel: true, targetKey: fv._originKey, vehicleName: _missionVehicleDisplayName(fv) });
  _missionAddEvt = null;  _missionExpandLast(m);  missionRecompute(m);
  missionRenderDetail();
}

function missionExecRendezvous(id, targetVid) {
  const m = _missionGet(id); if (!m || !targetVid) return;
  const tgt = PROG_ACTIVE_PROGRAM.vehicles[targetVid];
  const act = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId];
  m.log.push({ type: 'RENDEZVOUS', targetKey: tgt ? tgt._originKey : null, activeKey: act ? act._originKey : null, targetName: tgt ? _missionVehicleDisplayName(tgt) : '?', activeName: act ? _missionVehicleDisplayName(act) : '?' });
  _missionAddEvt = null; _missionExpandLast(m); missionRecompute(m); missionRenderDetail();
}
// Set the prop-transfer mass field to the selected source stage's full remaining propellant.
function missionPropXferMax(id) {
  const m = _missionGet(id); if (!m || !m.vehicleId) return;
  const fv = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId]; if (!fv) return;
  const si = parseInt(document.getElementById('xfer-src-' + id)?.value, 10);
  const ss = fv.stages[si]; if (!ss) return;
  const el = document.getElementById('xfer-mass-' + id);
  if (el) el.value = Math.round(progStageRemainingProp(ss));
}

// Apply a propellant transfer between two stages of `fv`, addressed by INDEX so
// two identical stages (same stageDefinitionId, e.g. docked twin Centaurs) work.
// Disambiguated stage label for stage at `idx` within a vehicle ("Centaur V (2)").
function _missionStageNameAt(fv, idx) {
  return _missionStageDisambig(fv, fv.stages[idx], idx);
}

function _missionApplyPropTransfer(srcFv, dstFv, e) {
  dstFv = dstFv || srcFv;
  const src = (e.sourceIndex != null) ? srcFv.stages[e.sourceIndex] : srcFv.stages.find(s => s.stageDefinitionId === e.sourceStageId);
  const dst = (e.destIndex != null) ? dstFv.stages[e.destIndex] : dstFv.stages.find(s => s.stageDefinitionId === e.destStageId);
  if (!src || !dst || src === dst) { e.result = 'FAILED'; e.transferred = 0; e.warnings = ['Pick two different stages']; return; }
  if (e.sourceIndex != null) e.fromName = _missionStageNameAt(srcFv, e.sourceIndex);
  if (e.destIndex != null) e.toName = _missionStageNameAt(dstFv, e.destIndex);
  e.vehName = _missionVehicleDisplayName(srcFv);
  e.destVehName = _missionVehicleDisplayName(dstFv);
  const pt = e.propellantType;
  const srcMatch = t => !pt || t.propellantType === pt;
  // A destination tank accepts the transfer if it already holds this propellant OR is EMPTY
  // (a dry depot tank adopts the incoming propellant type) — fixes mixed-fuel / empty-depot fills.
  const dstMatch = t => !pt || t.propellantType === pt || (t.fill || 0) <= 0;
  // Only move what the SOURCE has AND the DESTINATION can hold, so propellant is
  // conserved — never drained into the void when the dest is full.
  const srcAvail = src.tanks.reduce((s, t) => s + (srcMatch(t) ? t.fill : 0), 0);
  const dstSpace = dst.tanks.reduce((s, t) => s + (dstMatch(t) ? (t.capacity - t.fill) : 0), 0);
  const want = e.mass_kg ?? 0;
  const amount = Math.max(0, Math.min(want, srcAvail, dstSpace));
  let toTake = amount;
  for (const t of src.tanks) { if (!srcMatch(t)) continue; const d = Math.min(t.fill, toTake); t.fill -= d; toTake -= d; if (toTake <= 0) break; }
  let toFill = amount;
  for (const t of dst.tanks) { if (!dstMatch(t)) continue; const room = t.capacity - t.fill; const f = Math.min(room, toFill); if (f > 0) { if ((t.fill || 0) <= 0 && pt) t.propellantType = pt; t.fill += f; toFill -= f; } if (toFill <= 0) break; }
  const warns = [];
  if (amount < want) {
    if (dstSpace < want && dstSpace <= srcAvail) warns.push('⚠ Destination only had room for ' + Math.round(dstSpace).toLocaleString() + ' kg');
    else warns.push('⚠ Source only had ' + Math.round(srcAvail).toLocaleString() + ' kg');
  }
  // cross-vehicle transfer needs the two to be co-located (rendezvous/dock) — warn, don't block
  if (srcFv !== dstFv && typeof progOrbitalStateMatch === 'function' && srcFv.orbitState && dstFv.orbitState
      && !progOrbitalStateMatch(srcFv.orbitState, dstFv.orbitState)) {
    warns.push('⚠ Vehicles not in a matching orbit — rendezvous/dock for a real transfer');
  }
  e.result = 'SUCCESS'; e.transferred = amount; e.warnings = warns;
}

function _missionApplyCrewTransfer(fv, e) {
  const src = (e.sourceIndex != null) ? fv.stages[e.sourceIndex] : fv.stages.find(s => s.stageDefinitionId === e.sourceStageId);
  const dst = (e.destIndex != null) ? fv.stages[e.destIndex] : fv.stages.find(s => s.stageDefinitionId === e.destStageId);
  if (!src || !dst || src === dst) { e.result = 'FAILED'; e.transferred = 0; e.warnings = ['Pick two different stages']; return; }
  const move = Math.min(src.crewAboard || 0, e.count || 0);
  src.crewAboard = (src.crewAboard || 0) - move;
  dst.crewAboard = (dst.crewAboard || 0) + move;
  e.result = 'SUCCESS'; e.transferred = move; e.warnings = move < (e.count || 0) ? ['⚠ Only ' + move + ' crew available'] : [];
}

function missionExecPropTransfer(id) {
  const m = _missionGet(id); if (!m) return;
  const fv = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId]; if (!fv) return;
  const srcI = parseInt(document.getElementById('xfer-src-' + id)?.value, 10);
  const dstI = parseInt(document.getElementById('xfer-dst-' + id)?.value, 10);
  const mass = parseFloat(document.getElementById('xfer-mass-' + id)?.value) || 0;
  const destKey = document.getElementById('xfer-destveh-' + id)?.value || fv._originKey;
  const sameVeh = !destKey || destKey === fv._originKey;
  const destFv = sameVeh ? fv : (_missionVehByKey(m, destKey) || fv);
  const ss = fv.stages[srcI];
  const pt = (ss && ss.tanks && ss.tanks[0]) ? ss.tanks[0].propellantType : null;
  m.log.push({ type: 'TRANSFER_PROPELLANT', sourceIndex: srcI, destIndex: dstI, propellantType: pt, mass_kg: mass,
    activeKey: fv._originKey, activeName: _missionVehicleDisplayName(fv),
    destVehicleKey: sameVeh ? null : destKey, destName: sameVeh ? null : _missionVehicleDisplayName(destFv) });
  _missionAddEvt = null; _missionXferDest = null; _missionExpandLast(m); missionRecompute(m); missionRenderDetail();
}
function missionExecCrewTransfer(id) {
  const m = _missionGet(id); if (!m) return;
  const fv = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId]; if (!fv) return;
  const srcI = parseInt(document.getElementById('xfer-csrc-' + id)?.value, 10);
  const dstI = parseInt(document.getElementById('xfer-cdst-' + id)?.value, 10);
  const count = parseInt(document.getElementById('xfer-ccount-' + id)?.value) || 0;
  m.log.push({ type: 'TRANSFER_CREW', sourceIndex: srcI, destIndex: dstI, count, activeKey: fv._originKey, activeName: _missionVehicleDisplayName(fv) });
  _missionAddEvt = null; _missionExpandLast(m); missionRecompute(m); missionRenderDetail();
}
function missionExecReenter(id) {
  const m = _missionGet(id); if (!m) return;
  const act = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId];
  m.log.push({ type: 'REENTER', activeKey: act ? act._originKey : null, vehicleName: act ? _missionVehicleDisplayName(act) : '?' });
  _missionAddEvt = null; _missionExpandLast(m); missionRecompute(m); missionRenderDetail();
}
function missionExecRecover(id, vehId) {
  const m = _missionGet(id); if (!m || !vehId) return;
  const fv = PROG_ACTIVE_PROGRAM.vehicles[vehId];
  m.log.push({ type: 'RECOVER', targetKey: fv ? fv._originKey : null, vehicleName: fv ? _missionVehicleDisplayName(fv) : '?' });
  _missionAddEvt = null; _missionExpandLast(m); missionRecompute(m); missionRenderDetail();
}

function _missionSeparateLogCardHTML(entry) {
  if (entry.result !== 'SUCCESS') {
    const w = (entry.warnings || []).join('; ');
    return `<div class="mission-log-card" style="padding:8px 14px;">
      <span class="mission-log-type" style="color:var(--error,#e06c75)">SEPARATE FAILED</span>
      <div style="font-family:var(--mono);font-size:9px;color:var(--accent2);margin-top:4px;">${w || 'Separation failed'}</div>
    </div>`;
  }
  return `<div class="mission-log-card" style="padding:8px 14px;">
    <div class="mission-log-header"><span class="mission-log-type">SEPARATE</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto">${entry.parentName} @ stage ${entry.sepIndex}</span></div>
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-top:4px;line-height:1.5;">
      <div>▸ ${entry.lowerName} <span style="color:var(--text-dim)">— ${entry.lowerStages} stage${entry.lowerStages===1?'':'s'}</span></div>
      <div>▸ ${entry.upperName} <span style="color:var(--text-dim)">— ${entry.upperStages} stage${entry.upperStages===1?'':'s'}</span></div>
    </div>
  </div>`;
}

function _missionDockLogCardHTML(entry) {
  if (entry.result !== 'SUCCESS') {
    const w = (entry.warnings || []).join('; ');
    return `<div class="mission-log-card" style="padding:8px 14px;">
      <span class="mission-log-type" style="color:var(--error,#e06c75)">DOCK FAILED</span>
      <div style="font-family:var(--mono);font-size:9px;color:var(--accent2);margin-top:4px;">${w || 'Docking failed'}</div>
    </div>`;
  }
  const notes = (entry.warnings || []).map(w => `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${w}</div>`).join('');
  return `<div class="mission-log-card" style="padding:8px 14px;">
    <div class="mission-log-header"><span class="mission-log-type">DOCK</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto">${entry.aDisp || entry.aName || '?'} + ${entry.tDisp || entry.tName || '?'}</span></div>
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-top:4px;">${entry.mergedName} (${entry.mergedStages} stage${entry.mergedStages===1?'':'s'})</div>
    ${notes}
  </div>`;
}

function _missionMultiVehicleHTML(m) {
  const live = _missionLiveVehicles(m);
  if (!live.length) return '';
  const id = m.missionId;

  const rows = live.map(({ id: vid, fv }) => {
    const isActive = vid === m.vehicleId;
    const expended = fv.status === 'EXPENDED';
    // whole row is clickable to make this the active vehicle; active = green
    return `<div onclick="missionSetActiveVehicle('${id}','${vid}')" title="Click to make active" style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 8px;border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};border-left:3px solid ${isActive ? 'var(--accent)' : 'var(--border)'};margin-bottom:4px;background:${isActive ? 'rgba(136,198,87,.14)' : 'transparent'};cursor:pointer;">
      <span style="flex-shrink:0;width:12px;font-size:11px;color:${isActive ? 'var(--accent3)' : 'var(--text-dim)'};">${isActive ? '●' : '○'}</span>
      <span style="font-family:var(--mono);font-size:11px;color:${isActive ? 'var(--accent3)' : 'var(--text-bright)'};font-weight:${isActive ? '600' : '400'};flex:1 1 100px;min-width:80px;white-space:normal;word-break:break-word;line-height:1.3;">${_missionVehicleDisplayName(fv)}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${fv.stages.length} stages</span>
      ${expended ? '<span style="font-family:var(--mono);font-size:9px;color:var(--error,#e06c75)">EXPENDED</span>' : ''}
      <button class="act-btn" style="padding:2px 6px;font-size:10px;flex-shrink:0;" onclick="event.stopPropagation();missionRenameVehicle('${id}','${fv._originKey || ''}')" title="Rename this vehicle">✎</button>
      <button class="act-btn" style="padding:2px 8px;font-size:10px;flex-shrink:0;" onclick="event.stopPropagation();missionExecExpendVehicle('${id}','${vid}')"${expended ? ' disabled' : ''}>Expend</button>
    </div>`;
  }).join('');

  // Separate & Dock are done via ＋ Add Event; this panel is purely the vehicle list.
  // Selecting a row sets the focused vehicle that the Orbit Map edits and that new
  // events default to.
  return `<div class="mcc-box">
      <div class="mcc-box-hdr">Vehicles</div>
      ${rows}
    </div>`;
}

// ── Step 4: node-map view + MANEUVER events ───────────────────────────────────

function missionSetView(id, mode) {
  _missionViewMode  = mode;
  _missionBridgeMode = false;
  _missionBridgeFrom = null;
  missionRenderDetail();
}

// Snapshot/restore every scroll position that a re-render could reset: the node
// map pan, the view-area, and the page itself — so nothing jolts.
function _missionSaveScroll() {
  const nm  = document.querySelector('.mcc-view-area .nm-scroll');
  const va  = document.querySelector('.mcc-view-area');
  const doc = document.scrollingElement || document.documentElement;
  return { nmL: nm ? nm.scrollLeft : 0, nmT: nm ? nm.scrollTop : 0,
           vaL: va ? va.scrollLeft : 0, vaT: va ? va.scrollTop : 0,
           docT: doc ? doc.scrollTop : 0, docL: doc ? doc.scrollLeft : 0 };
}
function _missionRestoreScroll(s) {
  if (!s) return;
  const nm  = document.querySelector('.mcc-view-area .nm-scroll'); if (nm) { nm.scrollLeft = s.nmL; nm.scrollTop = s.nmT; }
  const va  = document.querySelector('.mcc-view-area'); if (va) { va.scrollLeft = s.vaL; va.scrollTop = s.vaT; }
  const doc = document.scrollingElement || document.documentElement; if (doc) { doc.scrollTop = s.docT; doc.scrollLeft = s.docL; }
}

// Re-render only the node map view, preserving scroll so picking nodes / toggling
// Draw Maneuver doesn't yank the view around.
function _missionRerenderNodeView(id) {
  const m = _missionGet(id);
  const va = document.querySelector('.mcc-view-area');
  if (!m || !va) return;
  const s = _missionSaveScroll();
  va.innerHTML = _missionNodeMapHTML(m);
  _missionRestoreScroll(s);
}
// Full detail render, then restore all scroll positions (for events that change
// the events panel AND the node map, e.g. adding/deleting a maneuver).
function _missionRenderPreserveNm(id) {
  const s = _missionSaveScroll();
  missionRenderDetail();
  _missionRestoreScroll(s);
}

function missionToggleBridgeMode(id) {
  _missionBridgeMode = !_missionBridgeMode;
  _missionBridgeFrom = null;
  _missionRerenderNodeView(id);
}

// Map a mission's launch orbit to the nearest canonical node id.
function _missionNodeForLaunch(m) {
  const o = m.launchOrbit || {};
  return _progNmVehicleNode({ orbitState: { body: o.body, perigee: o.alt_km, apogee: o.alt_km } });
}

// Ordered list of node ids the mission traverses: launch node, then each MANEUVER destination.
function _missionNodePath(m) {
  // The Orbit Map shows the FOCUSED vehicle's path: only its maneuvers (matched by
  // the selected runtime vehicleId), so selecting a vehicle in the roster scopes the
  // map to the one you're editing. Falls back to all maneuvers if none is focused.
  const path = [];
  const vid = m.vehicleId;
  if (m.log.some(e => e.type === 'LAUNCH' || e.type === 'DEPLOY')) path.push(_missionNodeForLaunch(m));
  for (const e of m.log) if (e.type === 'MANEUVER' && e.toNode && (!vid || e.vehicleId === vid)) path.push(e.toNode);
  return path;
}

// Heaviest stage that still has propellant — the sensible default firing stage.
function _missionDefaultFiringStageId(fv) {
  let id = null, best = -1;
  (fv.stages || []).forEach(s => {
    if ((s.isp || 0) > 0 && progStageRemainingProp(s) > 0) {
      const mss = progStageMass(s);
      if (mss > best) { best = mss; id = s.stageDefinitionId; }
    }
  });
  return id;
}

// Apply a MANEUVER during replay: compute ΔV from the node-map physics, expend it
// from the chosen firing stage, and move the vehicle to the destination orbit.
// A maneuver is a CONTAINER: a target (from→to → ΔV requirement) fulfilled by an ordered
// list of sub-steps the user composes. Each step is either a BURN (a stage provides ΔV,
// either a typed amount or its whole tank) or a SEPARATE (jettison a spent stage so the
// next burn is lighter). Legacy maneuvers with no steps fall back to one full burn from
// the chosen / default firing stage.
function _missionManeuverSteps(active, e, fullDv) {
  if (Array.isArray(e.steps) && e.steps.length) return e.steps;
  const sid = e.firingStageId || _missionDefaultFiringStageId(active);
  return [{ kind: 'burn', stageId: sid, mode: 'dv', dv: fullDv }];
}

function _missionApplyManeuver(active, e) {
  const r = progNmComputeEdgeDv(e.fromNode, e.toNode);
  const fullDv = r ? r.dv : 0;
  e.dvRequired = fullDv ? Math.round(fullDv) : null;
  e.note = r ? r.note : 'No transfer model for this pair';
  e.method = r ? r.method : null;
  if (!active) { e.result = 'FAILED'; return; }

  const steps = _missionManeuverSteps(active, e, fullDv);
  const fired = [];
  let delivered = 0, propTotal = 0;
  for (const step of steps) {
    if (step.kind === 'separate') {
      // jettison the spent stage (it leaves the active vehicle as debris — its band lane
      // simply ends). Dropping a stage lightens the stack for the following burns.
      const si = active.stages.findIndex(s => s.stageDefinitionId === step.stageId);
      if (si >= 0) active.stages.splice(si, 1);
      continue;
    }
    // burn step
    let st = step.stageId ? active.stages.find(s => s.stageDefinitionId === step.stageId) : null;
    if (!st) st = active.stages.find(s => s.stageDefinitionId === _missionDefaultFiringStageId(active)) || null;
    if (!st || (st.isp || 0) <= 0) continue;
    const m_wet = _missionVehWetMass(active);
    const avail = progStageRemainingProp(st);
    if (avail <= 0) { fired.push(st.stageDefinitionId); continue; }
    let burnProp, dvGain;
    if (step.mode === 'deplete') {
      burnProp = avail; dvGain = progRocketEqDv(m_wet, avail, st.isp);
    } else {
      const want = (step.dv != null) ? step.dv : Math.max(0, fullDv - delivered);
      const need = progRocketEqPropNeeded(m_wet, want, st.isp);
      if (need > avail) { burnProp = avail; dvGain = progRocketEqDv(m_wet, avail, st.isp); }
      else { burnProp = need; dvGain = want; }
    }
    progBurnPropellant(st, burnProp);
    delivered += dvGain; propTotal += burnProp; fired.push(st.stageDefinitionId);
  }
  e.dv = Math.round(delivered);
  e.dv_actual = Math.round(delivered);
  e.dvDelivered = Math.round(delivered);
  e.prop_consumed = Math.round(propTotal);
  e.firedStageId = fired[0] || null;          // primary, for legacy single-stage display
  e.firedStageIds = fired;
  e.result = (fullDv > 0) ? (delivered + 1 >= fullDv ? 'SUCCESS' : 'MARGINAL') : (r ? 'SUCCESS' : 'NO_MODEL');

  // arrive at the destination orbit (a short/MARGINAL burn still moves the vehicle, but is
  // flagged). escape / transit destinations put it on a departure trajectory so the band
  // view jumps UP immediately (TLI → cislunar, TMI / interplanetary → transit).
  const node = _missionNmNodeById(e.toNode);
  if (node && node.orbit) {
    const o = node.orbit;
    if (o.type === 'surface') active.orbitState = { body: o.body, perigee: 0, apogee: 0, inclination: 0, lan: 0, epoch: 0, surface: true };
    else if (o.type === 'circular' || o.type === 'elliptic') active.orbitState = { body: o.body, perigee: o.perigee ?? o.apogee ?? 0, apogee: o.apogee ?? o.perigee ?? 0, inclination: o.inclination ?? 0, lan: 0, epoch: 0, surface: false };
    // escape / transit: put the vehicle on its departure trajectory so the band view
    // jumps UP immediately (TLI → cislunar, TMI/interplanetary → transit) instead of
    // appearing stuck in the parking orbit.
    else if (o.type === 'escape') active.orbitState = { body: o.body || 'Earth', perigee: 200, apogee: 1.0e6, inclination: 0, lan: 0, epoch: 0, surface: false, escape: true };
    else if (o.type === 'transit') {
      active.orbitState = (o.body === 'Sun')
        ? { body: 'Sun', perigee: 0, apogee: 0, inclination: 0, lan: 0, epoch: 0, surface: false, transit: true, destination: o.destination }
        : { body: o.body || 'Earth', perigee: 185, apogee: 378000, inclination: 0, lan: 0, epoch: 0, surface: false, transit: true, destination: o.destination };
    }
  }
}

// Vehicle total mass helper (guarded — progVehicleTotalMass may be absent).
function _missionVehWetMass(fv) {
  return (typeof progVehicleTotalMass === 'function')
    ? progVehicleTotalMass(fv)
    : fv.stages.reduce((s, st) => s + progStageMass(st), 0);
}

// ── Composite maneuver — step-program model ─────────────────────────────────
// A maneuver is built from an ordered list of steps. BURN steps spend a stage (a typed ΔV
// or its whole tank); SEPARATE steps jettison a spent stage. One builder UI drives both
// the add-form draft (_missionAddMv.steps) and an existing maneuver card (m.log[idx].steps).

function _replaceArr(arr, vals) { arr.length = 0; (vals || []).forEach(v => arr.push(v)); }

// Materialize an event's steps from a legacy single-burn maneuver the first time it's edited.
function _missionEvSteps(m, idx) {
  const e = m.log[idx];
  if (!Array.isArray(e.steps) || !e.steps.length) {
    e.steps = [{ kind: 'burn', stageId: e.firingStageId || e.firedStageId || null, mode: 'dv', dv: null }];
  }
  return e.steps;
}

// Simulate a step program on a live vehicle (no mutation) → running ΔV / prop + per-step.
function _missionSimManeuverSteps(fv, steps, fullDv) {
  let stages = (fv && fv.stages ? fv.stages : []).map(s => ({ id: s.stageDefinitionId, isp: s.isp || 0, prop: progStageRemainingProp(s), mass: progStageMass(s) }));
  let total = fv ? _missionVehWetMass(fv) : 0;
  let delivered = 0, propTotal = 0; const per = [];
  (steps || []).forEach(step => {
    if (step.kind === 'separate') {
      const i = stages.findIndex(s => s.id === step.stageId);
      if (i >= 0) { total -= stages[i].mass; stages.splice(i, 1); per.push({ kind: 'separate', ok: true }); }
      else per.push({ kind: 'separate', ok: false });
      return;
    }
    let st = step.stageId ? stages.find(s => s.id === step.stageId) : null;
    if (!st) st = stages[0];
    if (!st || st.isp <= 0 || st.prop <= 0) { per.push({ kind: 'burn', dvGain: 0, dry: true }); return; }
    let burn, gain, short = false;
    if (step.mode === 'deplete') { burn = st.prop; gain = progRocketEqDv(total, st.prop, st.isp); }
    else {
      const want = (step.dv != null) ? step.dv : Math.max(0, fullDv - delivered);
      const need = progRocketEqPropNeeded(total, want, st.isp);
      if (need > st.prop) { burn = st.prop; gain = progRocketEqDv(total, st.prop, st.isp); short = true; }
      else { burn = need; gain = want; }
    }
    st.prop -= burn; st.mass -= burn; total -= burn; delivered += gain; propTotal += burn;
    per.push({ kind: 'burn', dvGain: gain, propBurn: burn, short });
  });
  return { delivered, propTotal, per, shortfall: Math.max(0, fullDv - delivered) };
}

// Greedy auto-build: bottom-up, burn each stage to depletion + drop it, until ΔV closes.
function _missionMvAutoSteps(fv, fullDv) {
  const order = (fv.stages || []).filter(s => (s.isp || 0) > 0 && progStageRemainingProp(s) > 0).map(s => s.stageDefinitionId);
  const steps = []; let mass = _missionVehWetMass(fv), remaining = fullDv;
  for (let i = 0; i < order.length; i++) {
    const sid = order[i]; const st = fv.stages.find(s => s.stageDefinitionId === sid);
    const maxDv = progRocketEqDv(mass, progStageRemainingProp(st), st.isp);
    if (maxDv + 1 >= remaining || i === order.length - 1) { steps.push({ kind: 'burn', stageId: sid, mode: 'dv', dv: null }); break; }
    steps.push({ kind: 'burn', stageId: sid, mode: 'deplete' });
    steps.push({ kind: 'separate', stageId: sid });
    remaining -= maxDv; mass -= progStageMass(st);
  }
  return steps;
}

// Resolve the builder's working context for a token: 'add' (the draft) or an event index.
function _missionMvCtx(id, token) {
  const m = _missionGet(id); if (!m) return null;
  const stagesOf = fv => fv ? fv.stages.map(s => ({ id: s.stageDefinitionId, name: _missionStageLabelById(s.stageDefinitionId), prop: Math.round(progStageRemainingProp(s)) })) : [];
  if (token === 'add') {
    const fv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
    const fromId = document.getElementById('addev-mvf-' + id)?.value, toId = document.getElementById('addev-mvt-' + id)?.value;
    const r = (fromId && toId) ? progNmComputeEdgeDv(fromId, toId) : null;
    if (!Array.isArray(_missionAddMv.steps)) _missionAddMv.steps = [];
    return { m, isAdd: true, token, steps: _missionAddMv.steps, fv, stages: stagesOf(fv), fullDv: r ? r.dv : 0 };
  }
  const idx = +token; const e = m.log[idx]; if (!e) return null;
  const fv = e.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[e.vehicleId] : null;
  const pre = _missionPreSnapStages(m, idx, e.activeKey, e.vehicleId);
  const stages = (pre && pre.length) ? pre.map(s => ({ id: s.id, name: s.name, prop: s.prop })) : stagesOf(fv);
  const r = progNmComputeEdgeDv(e.fromNode, e.toNode);
  return { m, isAdd: false, token, idx, e, steps: _missionEvSteps(m, idx), fv, stages, fullDv: r ? r.dv : 0 };
}

// One dispatcher for every step edit (add / remove / move / set field / auto-build).
function missionMvStep(id, token, op, a, b, c) {
  const ctx = _missionMvCtx(id, token); if (!ctx) return;
  const steps = ctx.steps;
  const bottom = ctx.stages && ctx.stages[0] ? ctx.stages[0].id : null;
  if (op === 'add') steps.push(a === 'separate' ? { kind: 'separate', stageId: bottom } : { kind: 'burn', stageId: bottom, mode: 'dv', dv: null });
  else if (op === 'rm') { if (a >= 0 && a < steps.length) steps.splice(a, 1); }
  else if (op === 'mv') { const j = a + b; if (a >= 0 && j >= 0 && a < steps.length && j < steps.length) { const t = steps[a]; steps[a] = steps[j]; steps[j] = t; } }
  else if (op === 'set') { const st = steps[a]; if (st) { if (b === 'dv') st.dv = (c === '' || c == null) ? null : (parseFloat(c) || 0); else st[b] = c; } }
  else if (op === 'auto') _replaceArr(steps, ctx.fv ? _missionMvAutoSteps(ctx.fv, ctx.fullDv) : []);
  if (ctx.isAdd) missionMvRefreshSteps(id);
  else { missionRecompute(ctx.m); _missionRenderPreserveNm(id); }
}
function missionMvRefreshSteps(id) { const el = document.getElementById('mv-steps-' + id); if (el) el.innerHTML = _missionMvBuilderHTML(id, 'add'); }

// The step-builder UI (shared by the add form and an expanded maneuver card).
function _missionMvBuilderHTML(id, token) {
  const ctx = _missionMvCtx(id, token); if (!ctx) return '';
  const { fv, stages, fullDv, steps, isAdd, e } = ctx;
  const sim = (isAdd && fv) ? _missionSimManeuverSteps(fv, steps, fullDv) : null;
  const sel = 'background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:10px;padding:3px 6px;';
  const mini = 'style="font-family:var(--mono);font-size:9px;padding:2px 5px;background:var(--input);color:var(--text-bright);border:1px solid var(--border);cursor:pointer;"';
  const opts = selv => stages.map(s => `<option value="${s.id}"${s.id === selv ? ' selected' : ''}>${s.name} (${(s.prop || 0).toLocaleString()} kg)</option>`).join('');
  const t = `'${id}','${token}'`;
  let rows;
  if (!steps.length) {
    rows = `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:4px 0;">// no steps — one full burn from the default stage is used. Add steps to control staging.</div>`;
  } else {
    rows = steps.map((step, k) => {
      const ctl = `<button ${mini} title="up" onclick="missionMvStep(${t},'mv',${k},-1)">▲</button><button ${mini} title="down" onclick="missionMvStep(${t},'mv',${k},1)">▼</button><button ${mini} title="remove" onclick="missionMvStep(${t},'rm',${k})">✕</button>`;
      const row = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;';
      if (step.kind === 'separate') {
        return `<div style="${row}"><span style="font-family:var(--mono);font-size:8px;font-weight:700;color:var(--accent2,#e5c07b);min-width:30px;">SEP</span>
          <select style="${sel};flex:1;" onchange="missionMvStep(${t},'set',${k},'stageId',this.value)">${opts(step.stageId)}</select>
          <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">drop</span>${ctl}</div>`;
      }
      const dep = step.mode === 'deplete';
      const gain = sim && sim.per[k] ? Math.round(sim.per[k].dvGain || 0) : null;
      return `<div style="${row}"><span style="font-family:var(--mono);font-size:8px;font-weight:700;color:var(--accent);min-width:30px;">BURN</span>
        <select style="${sel};flex:1;" onchange="missionMvStep(${t},'set',${k},'stageId',this.value)">${opts(step.stageId)}</select>
        <select style="${sel};" onchange="missionMvStep(${t},'set',${k},'mode',this.value)"><option value="dv"${!dep ? ' selected' : ''}>ΔV</option><option value="deplete"${dep ? ' selected' : ''}>full</option></select>
        ${dep ? `<span style="font-family:var(--mono);font-size:9px;color:var(--accent);min-width:54px;text-align:right;">${gain != null ? gain.toLocaleString() : 'full'}</span>`
              : `<input type="number" value="${step.dv == null ? '' : step.dv}" placeholder="rem" onchange="missionMvStep(${t},'set',${k},'dv',this.value)" style="${sel};width:58px;">`}
        ${ctl}</div>`;
    }).join('');
  }
  let status = '';
  if (fullDv > 0) {
    const delivered = sim ? sim.delivered : (e ? (e.dvDelivered || 0) : 0);
    const close = delivered + 1 >= fullDv;
    status = `<div style="font-family:var(--mono);font-size:10px;margin-top:5px;color:${close ? 'var(--accent)' : 'var(--accent2,#e5c07b)'};">ΔV ${Math.round(delivered).toLocaleString()} / ${Math.round(fullDv).toLocaleString()} m/s — ${close ? '✓ closes' : 'short ' + Math.round(Math.max(0, fullDv - delivered)).toLocaleString()}</div>`;
  }
  const reqStr = fullDv > 0 ? Math.round(fullDv).toLocaleString() + ' m/s' : '—';
  return `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin:6px 0 3px;">// requires <b style="color:var(--text-bright)">${reqStr}</b> — steps:</div>
    ${rows}${status}
    <div style="display:flex;gap:4px;margin-top:6px;">
      <button class="act-btn" style="flex:1;font-size:10px;" onclick="missionMvStep(${t},'add','burn')">＋ Burn</button>
      <button class="act-btn" style="flex:1;font-size:10px;" onclick="missionMvStep(${t},'add','separate')">＋ Separate</button>
      <button class="act-btn" style="flex:1;font-size:10px;" title="Auto-build a staged burn that closes the ΔV" onclick="missionMvStep(${t},'auto')">⚙ Auto</button>
    </div>`;
}

function missionExecManeuver(id, fromId, toId) {
  const m = _missionGet(id);
  if (!m || !fromId || !toId || fromId === toId) return;
  const res = progNmComputeEdgeDv(fromId, toId);
  const lbl = nid => { const n = _missionNmNodeById(nid); return n ? (n.sub ? n.label + ' (' + n.sub + ')' : n.label) : nid; };
  const actFv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  // copy the draft step program (if any) onto the new maneuver; empty → legacy single burn
  const steps = (_missionAddMv && Array.isArray(_missionAddMv.steps) && _missionAddMv.steps.length)
    ? _missionAddMv.steps.map(s => ({ ...s })) : undefined;
  m.log.push({
    type: 'MANEUVER',
    fromNode: fromId, toNode: toId, fromLabel: lbl(fromId), toLabel: lbl(toId),
    steps,
    activeKey: actFv ? actFv._originKey : null,
    activeName: actFv ? _missionVehicleDisplayName(actFv) : null,
    note: res ? res.note : 'No transfer model for this pair',
    method: res ? res.method : null,
  });
  _missionBridgeMode = false;
  _missionBridgeFrom = null;
  _missionAddEvt = null;
  _missionAddMv = { from: null, to: null, steps: [] };
  _missionExpandLast(m);
  missionRecompute(m);
  _missionRenderPreserveNm(id);
}

function missionNodeClick(id, nodeId) {
  if (_missionNmJustPanned) { _missionNmJustPanned = false; return; }   // ignore click that ended a pan-drag
  const m = _missionGet(id);
  if (!m) return;
  if (_missionBridgeMode) {
    if (!_missionBridgeFrom)        { _missionBridgeFrom = nodeId; _missionRerenderNodeView(id); return; }
    if (_missionBridgeFrom === nodeId) { _missionBridgeFrom = null; _missionRerenderNodeView(id); return; }
    missionExecManeuver(id, _missionBridgeFrom, nodeId);
    return;
  }
  // Not drawing — jump to the most recent event that lands on this node.
  let target = -1;
  m.log.forEach((e, i) => { if (e.type === 'MANEUVER' && e.toNode === nodeId) target = i; });
  if (target < 0 && nodeId === _missionNodeForLaunch(m)) m.log.forEach((e, i) => { if (e.type === 'LAUNCH' || e.type === 'DEPLOY') target = i; });
  if (target >= 0) {
    const tid = 'mlog-' + id + '-' + target;
    setTimeout(() => {
      const el = document.getElementById(tid);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '2px solid var(--accent)'; setTimeout(() => { el.style.outline = ''; }, 1500); }
    }, 60);
  }
}

// SVG arrowhead pointing from (sx,sy) toward (tx,ty), backed off the target by `back`.
function _nmArrowHead(sx, sy, tx, ty, color, back) {
  const ang = Math.atan2(ty - sy, tx - sx);
  back = back == null ? 18 : back;
  const sz = 8;
  const px = tx - Math.cos(ang) * back, py = ty - Math.sin(ang) * back;
  const a1 = ang + Math.PI - 0.45, a2 = ang + Math.PI + 0.45;
  return `<polygon points="${px.toFixed(1)},${py.toFixed(1)} ${(px + Math.cos(a1) * sz).toFixed(1)},${(py + Math.sin(a1) * sz).toFixed(1)} ${(px + Math.cos(a2) * sz).toFixed(1)},${(py + Math.sin(a2) * sz).toFixed(1)}" fill="${color}"/>`;
}

// Click a node-map maneuver edge → expand that maneuver's card and scroll to it.
function missionEdgeClick(id, idx) {
  const m = _missionGet(id);
  if (!m || !m.log[idx]) return;
  m.log.forEach(e => { e._expanded = false; });
  m.log[idx]._expanded = true;
  missionRenderDetail();
  const tid = 'mlog-' + id + '-' + idx;
  setTimeout(() => {
    const el = document.getElementById(tid);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '2px solid var(--accent)'; setTimeout(() => { el.style.outline = ''; }, 1500); }
  }, 60);
}

function _missionManeuverLogCardHTML(entry, id, idx) {
  const stateKV = (k, v) => `<div class="mission-state-kv"><span class="mission-state-key">${k}</span><span class="mission-state-val">${v}</span></div>`;
  const statusChip = entry.dvRequired != null
    ? `<span style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;padding:1px 6px;border:1px solid var(--accent3);color:var(--accent3)">computed</span>`
    : `<span style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;padding:1px 6px;border:1px solid var(--accent2);color:var(--accent2)">no model</span>`;
  const reqDisplay = entry.dvRequired != null
    ? stateKV('ΔV required', `<span style="color:var(--accent3)">${entry.dvRequired.toLocaleString()} m/s</span>`)
    : `<div style="color:var(--accent2);font-family:var(--mono);font-size:10px;padding:4px 0;">${entry.note}</div>`;
  const delDisplay = entry.dvDelivered != null ? stateKV('ΔV delivered', `${entry.dvDelivered.toLocaleString()} m/s`) : '';
  const methodDisplay = entry.method ? stateKV('Method', entry.method) : '';
  const propDisplay = entry.prop_consumed ? stateKV('Prop used', `${Math.round(entry.prop_consumed).toLocaleString()} kg`) : '';
  const marginal = entry.result === 'MARGINAL' ? `<div style="color:var(--accent2);font-family:var(--mono);font-size:9px;margin-top:3px;">⚠ short — only ${Math.round(entry.dvDelivered||0).toLocaleString()} of ${Math.round(entry.dvRequired||0).toLocaleString()} m/s delivered</div>` : '';
  // editable step builder (bound to this event by its index)
  const builder = (id != null && idx != null) ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">${_missionMvBuilderHTML(id, String(idx))}</div>` : '';
  return `<div class="mission-log-card">
    <div class="mission-log-header">
      <span class="mission-log-type">MANEUVER</span>
      ${statusChip}
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto">${entry.fromLabel} → ${entry.toLabel}</span>
    </div>
    <div class="mission-state-grid">
      ${reqDisplay}
      ${delDisplay}
      ${propDisplay}
      ${methodDisplay}
    </div>
    ${marginal}
    ${builder}
  </div>`;
}

// ── Band view data model (event-based) ──────────────────────────────────────
function _missionAltToYFrac(alt) {
  const a = Math.max(0, alt || 0);
  return Math.max(0, Math.min(1, Math.log10(a + 1) / Math.log10(500000)));
}

// Swimlane band model: each vehicle is a horizontal lane (row); X is a timeline
// column (simultaneous events share a column). A separated vehicle spawns on a
// new row just ABOVE its parent; docked vehicles merge onto one row.
// Owner-centric swimlane model: one persistent lane per "owner" — each spacecraft
// payload and the launch vehicle. Built from the per-event snapshots. Separations
// just let owners continue on their own rows; docking puts two owners in one vehicle
// so their lines run side by side (a "docked" tie connects them).
function _missionBandModel(m) {
  const palette = ['#61afef','#e5c07b','#98c379','#c678dd','#56b6c2','#e06c75','#d19a66'];
  const log = (m._expanded && m._expanded.length) ? m._expanded : m.log;
  // colOf: normal events advance a column; sameTimeAsPrev share the prev column;
  // midCoast events ALSO share the prev column but sit at a fractional x-offset, so
  // they read as happening DURING the previous transfer's coast (not instantaneously).
  const colOf = [], xFracOf = []; let col = 0, coastN = 0;
  log.forEach((e, i) => {
    const share = i > 0 && (e.sameTimeAsPrev || e.midCoast);
    if (i > 0 && !share) col++;
    colOf[i] = col;
    if (e.midCoast) { coastN++; xFracOf[i] = Math.min(0.85, 0.5 + (coastN - 1) * 0.18); }
    else { coastN = 0; xFracOf[i] = 0; }
  });
  const colCount = log.length ? col + 1 : 0;

  const owners = new Map();
  let colorIdx = 0, birth = 0;
  const ownerName = key => {
    if (m._ownerLabels && m._ownerLabels[key]) return m._ownerLabels[key];   // unified label (upper stage / spacecraft)
    const h = key.indexOf('#');
    const head = h >= 0 ? key.slice(0, h) : key;
    if (head.startsWith('sc:')) { const scId = head.slice(3); const sc = _scEdSC.find(s => s.spacecraftId === scId); return sc ? sc.name : head; }
    return 'Launch Vehicle';
  };
  const ensure = key => {
    if (!owners.has(key)) owners.set(key, { key, name: ownerName(key), color: palette[colorIdx++ % palette.length], birth: birth++, points: [], endCol: null, expended: false, _ended: false });
    return owners.get(key);
  };

  // per-column docked groups: vehicleId -> set of owner keys sharing that vehicle
  const dockTies = [];   // { col, ownerKeys:[...] }
  const events = [];

  log.forEach((e, i) => {
    const c = colOf[i];
    const snap = e.snapshot || [];
    const placed = new Set();
    const byVehicle = {};
    snap.forEach(v => {
      const z = _missionOrbitZone(v.orbit);
      (v.owners || []).forEach(key => {
        // group for docked tie
        (byVehicle[v.vehicleId] = byVehicle[v.vehicleId] || []).push(key);
        if (placed.has(key)) return;          // one point per owner per column
        const existing = owners.get(key);
        if (existing && existing._ended) return;
        placed.add(key);
        const L = ensure(key);
        L.points.push({ col: c, xFrac: xFracOf[i] || 0, alt: v.alt || 0, vehicleId: v.vehicleId, status: v.status, index: i, zoneKey: z.key, zoneOrder: z.order, zoneLabel: z.label });
        if (v.status === 'EXPENDED' || v.status === 'RECOVERED') L._ended = true;
      });
    });
    Object.values(byVehicle).forEach(keys => { if (keys.length > 1) dockTies.push({ col: c, ownerKeys: [...new Set(keys)] }); });
    let label = e.type;
    if (e.type === 'BURN') label = e.burnLabel || 'BURN';
    else if (e.type === 'MANEUVER') label = '→ ' + (e.toLabel || e.toNode || '');
    events.push({ index: i, type: e.type, col: c, label });
  });

  const lanes = [...owners.values()];
  lanes.sort((a, b) => a.birth - b.birth);
  // disambiguate duplicate lane names (e.g. two Vulcan Centaur launches → #1 / #2)
  const nameCnt = {}; lanes.forEach(L => { nameCnt[L.name] = (nameCnt[L.name] || 0) + 1; });
  const nameSeen = {};
  lanes.forEach(L => { if (nameCnt[L.name] > 1) { nameSeen[L.name] = (nameSeen[L.name] || 0) + 1; L.name = L.name + ' #' + nameSeen[L.name]; } });
  lanes.forEach(L => {
    if (L.points.length) {
      L.endCol = L.points[L.points.length - 1].col;
      L.expended = L._ended;
      L.live = (L.endCol === colCount - 1) && !L.expended;
    }
  });

  // ── zones: the Earth→cislunar ladder is always shown so higher orbits are
  //    immediately available; deeper regions (lunar, Mars…) appear once visited. ──
  const zoneMap = {
    earth: { key: 'earth', label: 'Earth', order: 0 },
    leo:   { key: 'leo',   label: 'LEO', order: 10 },
    meo:   { key: 'meo',   label: 'MEO / GTO', order: 16 },
    heo:   { key: 'heo',   label: 'Elliptical / Cislunar', order: 20 },
  };
  lanes.forEach(L => L.points.forEach(p => { if (!zoneMap[p.zoneKey]) zoneMap[p.zoneKey] = { key: p.zoneKey, label: p.zoneLabel, order: p.zoneOrder }; }));
  const zones = Object.values(zoneMap).sort((a, b) => a.order - b.order);
  const zoneSlot = {}; zones.forEach((z, idx) => { z.slot = idx; zoneSlot[z.key] = idx; });

  // ── per-point vertical offset WITHIN a zone: different vehicles separate, docked
  //    owners (same vehicle) cluster — keeps the polylines distinct but converging. ──
  // OWNER_SPREAD = 0: owners sharing a vehicle (co-manifested OR docked) sit at the
  // SAME point so the band view can draw them as one track until they SEPARATE.
  const VEH_SPREAD = 18, OWNER_SPREAD = 0;
  log.forEach((e, i) => {
    const c = colOf[i];
    const here = [];
    lanes.forEach(L => { const p = L.points.find(pp => pp.col === c); if (p) here.push({ L, p }); });
    const byZone = {};
    here.forEach(o => { (byZone[o.p.zoneKey] = byZone[o.p.zoneKey] || []).push(o); });
    Object.values(byZone).forEach(group => {
      const byVeh = {};
      group.forEach(o => { (byVeh[o.p.vehicleId] = byVeh[o.p.vehicleId] || []).push(o); });
      const vehs = Object.values(byVeh); const V = vehs.length;
      vehs.sort((a, b) => a[0].L.birth - b[0].L.birth);
      vehs.forEach((owners2, vi) => {
        const vehOff = (vi - (V - 1) / 2) * VEH_SPREAD;
        owners2.sort((a, b) => a.L.birth - b.L.birth);
        const O = owners2.length;
        owners2.forEach((o, oi) => { o.p.yOff = vehOff + (oi - (O - 1) / 2) * OWNER_SPREAD; });
      });
    });
  });
  lanes.forEach(L => L.points.forEach(p => { if (p.yOff == null) p.yOff = 0; }));

  // ── ascent: a vehicle that LAUNCHED should be shown rising up FROM the Earth
  //    band (not just appearing in LEO). Prepend a synthetic Earth-surface point
  //    at the launch column so the track draws a vertical climb out of Earth. ──
  lanes.forEach(L => {
    if (!L.points.length) return;
    const first = L.points[0];
    const ev = events[first.index];
    if (ev && ev.type === 'LAUNCH' && first.zoneKey !== 'earth') {
      L.points.unshift({ col: first.col, alt: 0, vehicleId: first.vehicleId, status: first.status,
        index: first.index, zoneKey: 'earth', zoneOrder: 0, zoneLabel: 'Earth', yOff: first.yOff || 0, _ascent: true });
    }
  });

  return { events, lanes, zones, zoneSlot, count: m.log.length, colCount, colOf };
}

// Map an orbital state to a labelled band/zone, ordered by energy (Earth low → high).
function _missionOrbitZone(o) {
  if (!o || o.body == null) return { key: 'space', label: 'Coast', order: 22 };
  if (o.surface) {
    const b = o.body;
    if (b === 'Earth') return { key: 'earth', label: 'Earth', order: 0 };
    if (b === 'Moon')  return { key: 'moon',  label: 'Moon', order: 40 };
    if (b === 'Mars')  return { key: 'mars',  label: 'Mars', order: 72 };
    return { key: b.toLowerCase() + '-surf', label: b, order: 62 };
  }
  const alt = ((o.apogee ?? o.perigee ?? 0) + (o.perigee ?? o.apogee ?? 0)) / 2;
  switch (o.body) {
    case 'Earth':
      if (alt < 2000)  return { key: 'leo', label: 'LEO', order: 10 };
      if (alt < 30000) return { key: 'meo', label: 'MEO / GTO', order: 16 };
      return { key: 'heo', label: 'Elliptical / Cislunar', order: 20 };
    case 'Moon':
      if (alt < 5000) return { key: 'llo', label: 'Low Lunar Orbit', order: 36 };
      return { key: 'nrho', label: 'NRHO / High Lunar', order: 30 };
    case 'Mars':  return { key: 'mars-orbit',  label: 'Mars Orbit',  order: 66 };
    case 'Venus': return { key: 'venus-orbit', label: 'Venus Orbit', order: 60 };
    case 'Sun':   return { key: 'transit',     label: 'Interplanetary Transit', order: 50 };
    default:      return { key: (o.body || 'x') + '-orbit', label: (o.body || '') + ' Orbit', order: 55 };
  }
}

// Scrub to a band event AND open that event's card in the EVENTS panel.
function missionBandScrubTo(id, idx) {
  _missionBandScrub = (idx == null ? null : +idx);
  _missionBandOpenEvent(id, idx);
}

// Click a band-view dot: select that dot's vehicle as active AND scrub to the event,
// so you can pick a specific vehicle (even on a crowded track) just by clicking it.
function missionBandPickVehicle(id, vid, idx) {
  const m = _missionGet(id); if (!m) return;
  const fv = vid ? PROG_ACTIVE_PROGRAM.vehicles[vid] : null;
  if (fv && fv.status !== 'EXPENDED' && fv.status !== 'RECOVERED') m.vehicleId = vid;
  _missionBandScrub = (idx == null ? null : +idx);
  _missionBandOpenEvent(id, idx);
}

// Selecting a state in the band view opens the matching event card (expanded + scrolled
// into view). idx is an index into the EXPANDED log; map it back to the authored card.
function _missionBandOpenEvent(id, idx) {
  const m = _missionGet(id); if (!m) { missionRenderDetail(); return; }
  if (idx == null) { missionRenderDetail(); return; }
  const exp = (m._expanded && m._expanded.length) ? m._expanded : m.log;
  const src = exp[+idx];
  const authIdx = src && src._authIdx != null ? src._authIdx : +idx;
  m.log.forEach(e => { e._expanded = false; });
  if (m.log[authIdx]) m.log[authIdx]._expanded = true;
  missionRenderDetail();
  const tid = 'mlog-' + id + '-' + authIdx;
  setTimeout(() => {
    const el = document.getElementById(tid);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '2px solid var(--accent)'; setTimeout(() => { el.style.outline = ''; }, 1500); }
  }, 60);
}

// ── Band view SVG renderer ─────────────────────────────────────────────────
function missionSetAddEvt(id, type) {
  _missionAddEvt = (type === _missionAddEvt) ? null : type;
  _missionAddMv = { from: null, to: null, steps: [] };   // fresh maneuver step draft each open
  _missionXferDest = null;                                // fresh prop-transfer destination each open
  if (_missionAddEvt === 'maneuver') {
    _missionViewMode = 'nodemap';        // node map for drawing maneuvers
    _missionBridgeMode = true;           // auto-enter Draw Maneuver mode
    _missionBridgeFrom = null;
  } else {
    _missionBridgeMode = false;
  }
  missionRenderDetail();
}

function _missionAddEventHTML(m) {
  const id = m.missionId;
  if (_missionAddEvt == null) {
    return `<button class="act-btn mcc-addevt-btn" style="width:100%;background:var(--accent);color:#000;font-weight:700;padding:11px;font-size:12px;letter-spacing:.08em;" onclick="missionSetAddEvt('${id}','__menu__')">＋ ADD EVENT</button>`;
  }
  const types = [['launch','Launch'],['deploy','Place in Orbit'],['maneuver','Maneuver'],['separate','Separate'],['dock','Dock'],['expend','Expend'],['rendezvous','Rendezvous'],['proptransfer','Prop Transfer'],['crewtransfer','Crew Transfer'],['reenter','Reenter'],['recover','Recover']];
  const typeBtns = types.map(([t,label]) =>
    `<button class="act-btn" style="padding:3px 8px;font-size:10px;${_missionAddEvt===t?'background:var(--accent);color:#000;':''}" onclick="missionSetAddEvt('${id}','${t}')">${label}</button>`
  ).join('');
  const header = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
      <button class="act-btn" style="padding:3px 8px;font-size:10px;background:var(--accent);color:#000;" onclick="missionSetAddEvt('${id}',null)">✕ Close</button>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);letter-spacing:.1em;">ADD EVENT</span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">${typeBtns}</div>`;
  const live = (typeof _missionLiveVehicles === 'function') ? _missionLiveVehicles(m) : [];
  const selectable = live.filter(x => x.fv.status !== 'EXPENDED' && x.fv.status !== 'RECOVERED');
  let vehSel = '';
  if (selectable.length > 1) {
    const opts = selectable.map(x => `<option value="${x.id}"${x.id===m.vehicleId?' selected':''}>${_missionVehicleDisplayName(x.fv)}</option>`).join('');
    vehSel = `<div style="margin-bottom:8px;"><label class="cfg-label">Active Vehicle</label>
      <select class="mcc-field-select" onchange="missionSetActiveVehicle('${id}',this.value)">${opts}</select></div>`;
  }
  let form = '';
  const fv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  if (_missionAddEvt === '__menu__') {
    form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// pick an event type above</div>`;
  } else if (_missionAddEvt === 'launch') {
    form = `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:6px;">// pick the launch vehicle, payload &amp; target orbit in a pop-up, then launch (runs ascent staging)</div>
      <button class="act-btn" style="width:100%;background:var(--accent);color:#000;font-weight:600;" onclick="missionOpenLaunchModal('${id}')">▶ Select Parameters &amp; Launch…</button>`;
  } else if (_missionAddEvt === 'deploy') {
    const scs = _scEdSC || [];
    if (scs.length) {
      const o = scs.map(s => `<option value="${s.spacecraftId}">${s.name}</option>`).join('');
      form = `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:6px;">// places a SPACECRAFT directly in orbit — full tanks, no ascent (e.g. a station like the ISS)</div>
        <label class="cfg-label">Spacecraft</label>
        <select id="addev-deploy-${id}" class="mcc-field-select" style="margin-bottom:6px;">${o}</select>
        <label class="cfg-label">Target Orbit</label>
        <div style="margin-bottom:8px;">${_missionOrbitFieldsHTML(m)}</div>
        <label style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="addev-deploy-empty-${id}" style="accent-color:var(--accent);"> Deploy with empty tanks (depot to be refuelled)</label>
        <button class="act-btn" style="width:100%;background:var(--accent);color:#000;font-weight:600;" onclick="missionExecDeploy('${id}',document.getElementById('addev-deploy-${id}').value)">⊕ Place in Orbit</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// no spacecraft defined — add one in the Spacecraft tab</div>`;
  } else if (_missionAddEvt === 'burn') {
    form = _missionBurnSectionHTML(m);
  } else if (_missionAddEvt === 'separate') {
    if (fv && fv.stages.length >= 2) {
      // quick per-payload detach buttons (separate at each spacecraft boundary)
      const groups = _missionPayloadGroups(fv).filter(g => g.startIndex >= 1);
      let quick = '';
      if (groups.length) {
        const btns = groups.map(g => {
          const top = g.endIndex === fv.stages.length - 1;
          return `<button class="act-btn" style="flex:1;min-width:0;font-size:10px;" title="Separate ${g.scName}${top ? '' : ' and everything above it'} off the stack" onclick="missionExecSeparate('${id}',${g.startIndex})">⇕ ${g.scName}</button>`;
        }).join('');
        quick = `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:4px;">// quick-detach a payload:</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">${btns}</div>`;
      }
      form = `${quick}<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:6px;">// …or drag the bar (click between stages) to set a custom split — everything above it detaches</div>
        <div id="sep-pick-${id}">${_missionSepPickerHTML(m)}</div>
        <button class="act-btn" style="width:100%;margin-top:8px;" onclick="missionExecSeparate('${id}',_missionSepIndex)">⇕ Separate at bar</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// active vehicle needs ≥ 2 stages</div>`;
  } else if (_missionAddEvt === 'dock') {
    const targets = live.filter(x => x.id !== m.vehicleId && x.fv.status !== 'EXPENDED');
    if (targets.length) {
      const o = targets.map(x=>`<option value="${x.id}">${_missionVehicleDisplayName(x.fv)}</option>`).join('');
      form = `<select id="addev-dock-${id}" class="mcc-field-select" style="margin-bottom:6px;">${o}</select>
        <button class="act-btn" style="width:100%;" onclick="missionExecDock('${id}',document.getElementById('addev-dock-${id}').value)">⊕ Dock</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// need another live vehicle to dock with</div>`;
  } else if (_missionAddEvt === 'expend') {
    if (live.length) {
      const o = live.map(x=>`<option value="${x.id}">${_missionVehicleDisplayName(x.fv)}${x.fv.status==='EXPENDED'?' (expended)':''}</option>`).join('');
      form = `<select id="addev-exp-${id}" class="mcc-field-select" style="margin-bottom:6px;">${o}</select>
        <button class="act-btn" style="width:100%;" onclick="missionExecExpendVehicle('${id}',document.getElementById('addev-exp-${id}').value)">Expend Vehicle</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// no vehicles yet</div>`;
  } else if (_missionAddEvt === 'maneuver') {
    const nodes = _missionNmNodes();
    const o = nodes.map(n=>`<option value="${n.id}">${n.label}${n.sub?' ('+n.sub+')':''}</option>`).join('');
    form = `<label class="cfg-label">From</label><select id="addev-mvf-${id}" class="mcc-field-select" style="margin-bottom:6px;" onchange="missionMvRefreshSteps('${id}')">${o}</select>
      <label class="cfg-label">To</label><select id="addev-mvt-${id}" class="mcc-field-select" style="margin-bottom:6px;" onchange="missionMvRefreshSteps('${id}')">${o}</select>
      <div id="mv-steps-${id}">${_missionMvBuilderHTML(id, 'add')}</div>
      <button class="act-btn" style="width:100%;margin-top:6px;" onclick="missionExecManeuver('${id}',document.getElementById('addev-mvf-${id}').value,document.getElementById('addev-mvt-${id}').value)">Add Maneuver</button>
      <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:5px;">// pick From/To (or draw a bridge on the Node Map); the steps above define how the ΔV is delivered</div>`;
  } else if (_missionAddEvt === 'rendezvous') {
    const others = live.filter(x => x.id !== m.vehicleId);
    if (others.length) {
      const o = others.map(x => `<option value="${x.id}">${_missionVehicleDisplayName(x.fv)}</option>`).join('');
      form = `<select id="addev-rend-${id}" class="mcc-field-select" style="margin-bottom:6px;">${o}</select>
        <button class="act-btn" style="width:100%;" onclick="missionExecRendezvous('${id}',document.getElementById('addev-rend-${id}').value)">Rendezvous</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// need another live vehicle</div>`;
  } else if (_missionAddEvt === 'proptransfer') {
    const canIntra = fv && fv.stages.length >= 2;
    const others = fv ? live.filter(x => x.fv !== fv) : [];
    if (fv && fv.stages.length >= 1 && (canIntra || others.length)) {
      // destination can be the active vehicle OR another live vehicle (e.g. a deployed depot)
      const destKey = _missionXferDest || fv._originKey;
      const destEntry = live.find(x => x.fv._originKey === destKey);
      const destFv = destEntry ? destEntry.fv : fv;
      const srcOpts = _missionStageOptions(fv, s => `${Math.round(progStageRemainingProp(s)).toLocaleString()} kg`);
      const vehOpts = live.map(x => `<option value="${x.fv._originKey}"${x.fv._originKey === destKey ? ' selected' : ''}>${_missionVehicleDisplayName(x.fv)}${x.fv === fv ? ' (active)' : ''}</option>`).join('');
      const dstOpts = _missionStageOptions(destFv, s => `${Math.round(progStageRemainingProp(s)).toLocaleString()} kg`);
      form = `<label class="cfg-label">Source Stage <span style="color:var(--text-dim);">(active vehicle)</span></label><select id="xfer-src-${id}" class="mcc-field-select" style="margin-bottom:6px;">${srcOpts}</select>
        <label class="cfg-label">Destination Vehicle</label><select id="xfer-destveh-${id}" class="mcc-field-select" style="margin-bottom:6px;" onchange="missionXferSetDest('${id}',this.value)">${vehOpts}</select>
        <label class="cfg-label">Destination Stage</label><select id="xfer-dst-${id}" class="mcc-field-select" style="margin-bottom:6px;">${dstOpts}</select>
        <label class="cfg-label">Mass (kg)</label>
        <div style="display:flex;gap:6px;margin-bottom:6px;"><input type="number" id="xfer-mass-${id}" class="field" value="1000" style="flex:1;"><button class="act-btn" style="flex-shrink:0;" onclick="missionPropXferMax('${id}')" title="Use the source stage's full remaining propellant">Max</button></div>
        <button class="act-btn" style="width:100%;" onclick="missionExecPropTransfer('${id}')">Transfer Propellant</button>
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:5px;">// fill a deployed depot directly, or move propellant between two stages of one (docked) vehicle</div>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// transfer needs a second stage (dock) or another vehicle / depot in orbit</div>`;
  } else if (_missionAddEvt === 'crewtransfer') {
    if (fv && fv.stages.length >= 2) {
      const so = _missionStageOptions(fv, s => `${s.crewAboard || 0} crew`);
      form = `<label class="cfg-label">Source Stage</label><select id="xfer-csrc-${id}" class="mcc-field-select" style="margin-bottom:6px;">${so}</select>
        <label class="cfg-label">Destination Stage</label><select id="xfer-cdst-${id}" class="mcc-field-select" style="margin-bottom:6px;">${so}</select>
        <label class="cfg-label">Crew</label><input type="number" id="xfer-ccount-${id}" class="field" value="1" style="width:100%;margin-bottom:6px;">
        <button class="act-btn" style="width:100%;" onclick="missionExecCrewTransfer('${id}')">Transfer Crew</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// dock first — transfer needs ≥2 stages</div>`;
  } else if (_missionAddEvt === 'reenter') {
    form = `<button class="act-btn" style="width:100%;" onclick="missionExecReenter('${id}')">Reenter (land on Earth)</button>
      <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:5px;">// zero-ΔV; deorbit burn should precede this</div>`;
  } else if (_missionAddEvt === 'recover') {
    if (live.length) {
      const o = live.map(x => `<option value="${x.id}">${_missionVehicleDisplayName(x.fv)}${x.fv.status==='RECOVERED'?' (recovered)':x.fv.status==='EXPENDED'?' (expended)':''}</option>`).join('');
      form = `<select id="addev-rec-${id}" class="mcc-field-select" style="margin-bottom:6px;">${o}</select>
        <button class="act-btn" style="width:100%;" onclick="missionExecRecover('${id}',document.getElementById('addev-rec-${id}').value)">Recover</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// no vehicles yet</div>`;
  }
  // forms that already have their own vehicle dropdown don't need the global Active Vehicle selector
  const ownsVehiclePicker = ['expend', 'recover'].includes(_missionAddEvt);
  return `${header}${(_missionAddEvt!=='__menu__'&&_missionAddEvt!=='burn'&&!ownsVehiclePicker)?vehSel:''}${form}`;
}

// Resolve var(--x) tokens in a serialized SVG to concrete computed values, so
// the rasterized image keeps the theme's colours AND fonts (CSS variables and
// the stylesheet don't apply to a detached <img> SVG).
function _missionResolveCssVars(xml) {
  const cs = getComputedStyle(document.documentElement);
  return xml.replace(/var\(--([a-z0-9-]+)\)/gi, (full, name) => {
    const val = cs.getPropertyValue('--' + name).trim();
    return val || full;
  });
}

// Save the current mission view (band OR node map — whichever SVG is showing)
// as a PNG. v1: rasterize the on-screen SVG at 2× with var() resolved.
function missionExportPNG(id) {
  const svg = document.querySelector('.mcc-view-area svg');
  if (!svg) { if (typeof showAlert === 'function') showAlert('No view to export yet — run a launch first.', 'Export PNG'); return; }
  const vb = svg.viewBox && svg.viewBox.baseVal;
  const w = (vb && vb.width)  ? vb.width  : (svg.clientWidth  || 900);
  const h = (vb && vb.height) ? vb.height : (svg.clientHeight || 500);
  const clone = svg.cloneNode(true);
  clone.setAttribute('width',  w);
  clone.setAttribute('height', h);
  const xml = _missionResolveCssVars(new XMLSerializer().serializeToString(clone));
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  const SCALE = 2;
  // band view: build a vehicle colour KEY to draw under the chart
  const m0 = _missionGet(id);
  let legend = [];
  if (_missionViewMode === 'band' && m0) {
    try { legend = (_missionBandModel(m0).lanes || []).map(L => ({ color: L.color, name: L.name + (L.expended ? ' (expended)' : '') })); } catch (_) {}
  }
  const csv = getComputedStyle(document.documentElement);
  const panelCol = csv.getPropertyValue('--panel').trim() || '#2e2c2d';
  const dimCol = csv.getPropertyValue('--text-dim').trim() || '#a7a6a4';
  const brightCol = csv.getPropertyValue('--text-bright').trim() || '#ffffff';
  img.onload = () => {
    // lay out the legend (unscaled px): swatch + label items wrapping across width
    const padX = 14, rowH = 18, sw = 11, fontPx = 11;
    const placed = []; let legendH = 0;
    if (legend.length) {
      let x = padX, y = 8;
      for (const it of legend) {
        const iw = sw + 5 + it.name.length * fontPx * 0.6 + 16;
        if (x + iw > w - padX && x > padX) { x = padX; y += rowH; }
        placed.push({ color: it.color, name: it.name, x, y });
        x += iw;
      }
      legendH = y + rowH + 6;
    }
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(w * SCALE);
    canvas.height = Math.round((h + legendH) * SCALE);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = panelCol;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, Math.round(w * SCALE), Math.round(h * SCALE));
    URL.revokeObjectURL(url);
    if (placed.length) {
      ctx.save();
      ctx.scale(SCALE, SCALE);
      ctx.strokeStyle = dimCol; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.moveTo(padX, h + 2); ctx.lineTo(w - padX, h + 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = fontPx + "px 'JetBrains Mono', monospace";
      ctx.textBaseline = 'middle';
      for (const it of placed) {
        const yy = h + it.y;
        ctx.fillStyle = it.color; ctx.fillRect(it.x, yy + (rowH - sw) / 2 - 1, sw, sw);
        ctx.fillStyle = brightCol; ctx.fillText(it.name, it.x + sw + 5, yy + rowH / 2);
      }
      ctx.restore();
    }
    canvas.toBlob(b => {
      if (!b) return;
      const m = _missionGet(id);
      const base = (m && m.name ? m.name : 'mission').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'mission';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = base + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); if (typeof showAlert === 'function') showAlert('PNG export failed — the SVG could not be rasterized.', 'Export PNG'); };
  img.src = url;
}

function _missionBandViewHTML(m) {
  const model = _missionBandModel(m);
  const id = m.missionId;

  if (model.count === 0) {
    return '<div style="display:flex;align-items:center;justify-content:center;height:200px;font-family:var(--mono);font-size:11px;color:var(--text-dim);">// No events yet — execute a LAUNCH to populate the band view.</div>';
  }

  const spacing = _missionBandSpacing;
  const leftPad = 150, rightPad = 50, topPad = 18, botPad = 20, bandH = 112;
  const zoneCount = Math.max(model.zones.length, 1);
  const plotH = zoneCount * bandH;
  const totalH = topPad + plotH + botPad;
  const totalW = leftPad + Math.max(model.colCount - 1, 0) * spacing + rightPad + 30;
  const X = c => leftPad + c * spacing;
  // zone slot 0 = lowest energy → drawn at the BOTTOM; higher zones stack upward
  const zoneCenterY = slot => topPad + (zoneCount - 1 - slot) * bandH + bandH / 2;
  const Y = pt => zoneCenterY(model.zoneSlot[pt.zoneKey] ?? 0) + (pt.yOff || 0);
  const fmtAlt = a => a >= 100000 ? '∞' : (a >= 1000 ? Math.round(a / 1000) + 'k' : Math.round(a)) + '';

  const scrub = _missionBandScrub == null ? (model.count - 1) : _missionBandScrub;

  // ── zone bands: labelled horizontal regions (Earth at the bottom → higher orbits up) ──
  let gridHTML = '';
  model.zones.forEach(z => {
    const yTop = topPad + (zoneCount - 1 - z.slot) * bandH;
    if (z.slot % 2 === 1) gridHTML += `<rect x="${leftPad}" y="${yTop}" width="${totalW - leftPad - 6}" height="${bandH}" fill="var(--text-bright)" opacity="0.02"/>`;
    // clear dotted boundary between zones (so LEO→GTO etc. reads at a glance)
    gridHTML += `<line x1="${leftPad}" y1="${yTop}" x2="${totalW - 6}" y2="${yTop}" stroke="var(--border-bright)" stroke-opacity="0.85" stroke-dasharray="1 5" stroke-linecap="round" stroke-width="1.4"/>`;
    gridHTML += `<text x="${leftPad - 10}" y="${yTop + 13}" text-anchor="end" font-family="var(--mono)" font-size="9px" letter-spacing=".05em" fill="var(--text-dim)">${z.label}</text>`;
  });
  // close the bottom of the lowest band so every zone is fully bounded
  gridHTML += `<line x1="${leftPad}" y1="${topPad + plotH}" x2="${totalW - 6}" y2="${topPad + plotH}" stroke="var(--border-bright)" stroke-opacity="0.85" stroke-dasharray="1 5" stroke-linecap="round" stroke-width="1.4"/>`;
  // column gridlines (faint)
  for (let c = 0; c < model.colCount; c++) {
    gridHTML += `<line x1="${X(c)}" y1="${topPad}" x2="${X(c)}" y2="${topPad + plotH}" stroke="var(--border)" stroke-opacity="0.12" stroke-width="1"/>`;
  }

  const branchHTML = '';

  // ── tracks as a vehicle-node graph ──────────────────────────────────────────
  // Owners that share a vehicle (co-manifested at launch OR docked) are drawn as
  // ONE track: we collapse each owner's per-event points into per-(column,vehicle,
  // zone) NODES, then connect them by owner continuity. A track therefore forks
  // only at a SEPARATE (the owners get different vehicleIds) and merges at a DOCK.
  // Each node's representative owner = the lowest-birth owner aboard, giving the
  // "dominant / launch" colour + label (e.g. S-IVB while attached, then CSM).
  // node key includes the fractional x-offset so a mid-coast event gets its OWN node
  // (positioned between the maneuver and the next event) rather than collapsing into it.
  const keyP = p => p.col + '+' + (p.xFrac || 0) + '|' + p.vehicleId + '|' + p.zoneKey;
  const nodes = new Map();
  for (const lane of model.lanes) {
    for (const p of lane.points) {
      const k = keyP(p);
      let n = nodes.get(k);
      if (!n) { n = { x: X(p.col + (p.xFrac || 0)), y: Y(p), col: p.col, frac: p.xFrac || 0, vid: p.vehicleId, alt: p.alt, status: p.status, index: p.index, ascent: !!p._ascent, rep: lane, hasIn: false, hasOut: false }; nodes.set(k, n); }
      else if (lane.birth < n.rep.birth) { n.rep = lane; n.y = Y(p); }
    }
  }
  // edges (deduped per node-pair; representative = lowest-birth owner traversing it)
  const edges = new Map();
  for (const lane of model.lanes) {
    for (let i = 0; i < lane.points.length - 1; i++) {
      const a = keyP(lane.points[i]), b = keyP(lane.points[i + 1]);
      if (a === b) continue;
      let e = edges.get(a + '>' + b);
      if (!e) { e = { a, b, rep: lane }; edges.set(a + '>' + b, e); }
      else if (lane.birth < e.rep.birth) e.rep = lane;
      const A = nodes.get(a), B = nodes.get(b); if (A) A.hasOut = true; if (B) B.hasIn = true;
    }
  }
  // a node labels its dominant owner only where that owner STARTS — i.e. it has no
  // incoming edge, or its rep differs from every predecessor (a SEPARATE fork).
  for (const e of edges.values()) { const A = nodes.get(e.a), B = nodes.get(e.b); if (A && B && A.rep === B.rep) B._repIn = true; }
  const clip = s => s.length > 16 ? s.slice(0, 15) + '…' : s;
  let lanesHTML = '';
  // edges (active vehicle gets the translucent accent underlay)
  for (const e of edges.values()) {
    const A = nodes.get(e.a), B = nodes.get(e.b);
    if (!A || !B) continue;
    if (A.vid === m.vehicleId || B.vid === m.vehicleId)
      lanesHTML += `<polyline points="${A.x},${A.y} ${B.x},${B.y}" fill="none" stroke="var(--accent)" stroke-width="7" opacity="0.16" stroke-linejoin="round"/>`;
    lanesHTML += `<polyline points="${A.x},${A.y} ${B.x},${B.y}" fill="none" stroke="${e.rep.color}" stroke-width="2.5" opacity="${e.rep.expended ? '0.4' : '1'}" stroke-linejoin="round"/>`;
  }
  // lone nodes (a track with a single event) → short dash
  for (const n of nodes.values()) {
    if (!n.hasIn && !n.hasOut)
      lanesHTML += `<line x1="${n.x - 8}" y1="${n.y}" x2="${n.x + 8}" y2="${n.y}" stroke="${n.rep.color}" stroke-width="2.5" opacity="${n.rep.expended ? '0.4' : '1'}"/>`;
  }
  // node dots + altitude labels (one per vehicle per column)
  for (const n of nodes.values()) {
    const ev = model.events[n.index];
    const dead = n.status === 'EXPENDED' || n.status === 'RECOVERED';
    const rDot = n.ascent ? 3.5 : (n.frac ? 3.5 : 5);
    lanesHTML += `<circle cx="${n.x}" cy="${n.y}" r="${rDot}" fill="${n.frac ? 'var(--input)' : n.rep.color}" stroke="${n.rep.color}" stroke-width="${n.frac ? 2 : 1}" opacity="${dead ? '0.5' : '1'}" style="cursor:pointer" onclick="missionBandPickVehicle('${id}','${n.vid}',${n.index})"><title>${n.ascent ? 'Liftoff from Earth' : (ev ? (n.frac ? 'mid-coast: ' : '') + ev.label : '')}${n.ascent ? '' : ' — ' + Math.round(n.alt).toLocaleString() + ' km'} — ${n.rep.name}</title></circle>`;
    if (!n.ascent) lanesHTML += `<text x="${n.x}" y="${n.y - 8}" text-anchor="middle" font-family="var(--mono)" font-size="7px" fill="var(--text-dim)" style="pointer-events:none">${fmtAlt(n.alt)}</text>`;
  }
  // start labels (nodes with no incoming edge) + "+" affordance at live track ends
  for (const n of nodes.values()) {
    const isActive = n.vid === m.vehicleId;
    const dead = n.status === 'EXPENDED' || n.status === 'RECOVERED';
    if (!n._repIn)
      lanesHTML += `<text x="${n.x - 7}" y="${n.y - 7}" text-anchor="end" font-family="var(--mono)" font-size="8px" font-weight="${isActive ? '700' : '400'}" fill="${n.rep.expended ? 'var(--text-dim)' : (isActive ? 'var(--accent3)' : n.rep.color)}" style="cursor:pointer" onclick="missionBandPickVehicle('${id}','${n.vid}',null)">${(isActive ? '● ' : '') + clip(n.rep.name)}</text>`;
    if (!n.hasOut && n.rep.live && !dead && n.col === model.colCount - 1) {
      const px = n.x + 22;
      lanesHTML += `<circle cx="${px}" cy="${n.y}" r="10" fill="var(--input)" stroke="${n.rep.color}" stroke-width="1.5" style="cursor:pointer" onclick="missionSetActiveVehicle('${id}','${n.vid}');missionSetAddEvt('${id}','__menu__')"><title>Add event to ${n.rep.name}</title></circle>`;
      lanesHTML += `<text x="${px}" y="${n.y + 4}" text-anchor="middle" font-family="var(--mono)" font-size="13" font-weight="bold" fill="${n.rep.color}" style="pointer-events:none">+</text>`;
    }
  }

  // scrubber (vertical line at the scrubbed event's column)
  const scrubCol = model.events[scrub] ? model.events[scrub].col : 0;
  const scrubX = X(scrubCol);
  let scrubberHTML = `<line x1="${scrubX}" y1="${topPad - 2}" x2="${scrubX}" y2="${topPad + plotH}" stroke="var(--accent)" stroke-width="1.5" opacity="0.75"/>`;
  const scrubEv = model.events[scrub];
  scrubberHTML += `<text x="${scrubX}" y="${topPad - 9}" text-anchor="middle" font-family="var(--mono)" font-size="8px" fill="var(--accent)">${scrubEv ? scrubEv.label : ''}</text>`;

  // controls (spacing) + legend
  let legendHTML = '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px;align-items:center;">';
  legendHTML += `<span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:9px;color:var(--text-dim);">spacing
    <button class="act-btn" style="padding:0 7px;" onclick="missionBandSpacing('${id}',-1)">−</button>
    <button class="act-btn" style="padding:0 7px;" onclick="missionBandSpacing('${id}',1)">+</button></span>`;
  legendHTML += `<span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:9px;color:var(--text-dim);">zoom
    <button class="act-btn" style="padding:0 7px;" onclick="missionBandZoom('${id}',-1)">−</button>
    <button class="act-btn" style="padding:0 7px;" onclick="missionBandZoom('${id}',0)" title="Reset zoom">${Math.round(_missionBandZoom * 100)}%</button>
    <button class="act-btn" style="padding:0 7px;" onclick="missionBandZoom('${id}',1)">+</button></span>`;
  for (const lane of model.lanes) {
    const dimmed = lane.expended;
    legendHTML += `<span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:9px;color:${dimmed ? 'var(--text-dim)' : 'var(--text-bright)'};opacity:${dimmed ? '0.5' : '1'}"><span style="display:inline-block;width:8px;height:8px;background:${lane.color};border-radius:2px;"></span>${lane.name}${dimmed ? ' (expended)' : ''}</span>`;
  }
  legendHTML += '</div>';

  // ── state monitor: the per-event snapshot of EVERY vehicle at the scrubbed event ──
  const _explog = (m._expanded && m._expanded.length) ? m._expanded : m.log;
  const scrubEvent = _explog[scrub];
  const snap = scrubEvent && scrubEvent.snapshot ? scrubEvent.snapshot : null;
  const activeKey = scrubEvent ? scrubEvent.activeOriginKey : null;
  const fmtOrbit = o => !o ? '—' : (o.surface ? o.body + ' surface'
    : `${o.body} ${Math.round(o.perigee).toLocaleString()}${(o.apogee && o.apogee !== o.perigee) ? '×' + Math.round(o.apogee).toLocaleString() : ''} km · ${Math.round(o.inclination || 0)}°`);
  let monitorHTML = '';
  if (snap && snap.length) {
    const rows = snap.map(v => {
      const isAct = activeKey && v.originKey === activeKey;
      const dead = v.status === 'EXPENDED' || v.status === 'RECOVERED';
      return `<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);${dead ? 'opacity:.5;' : ''}">
        <span style="font-size:11px;color:${isAct ? 'var(--accent3)' : 'var(--text-bright)'};font-weight:${isAct ? '700' : '400'};min-width:120px;">${isAct ? '● ' : ''}${v.name}${dead ? ' (' + v.status.toLowerCase() + ')' : ''}</span>
        <span>${fmtOrbit(v.orbit)}</span>
        <span style="margin-left:auto;">ΔV <span style="color:var(--accent)">${v.remDv.toLocaleString()}</span> m/s</span>
        <span>prop <span style="color:var(--accent)">${v.remProp.toLocaleString()}</span> kg</span>
      </div>`;
    }).join('');
    monitorHTML = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">
      <div style="font-size:9px;letter-spacing:.1em;margin-bottom:4px;">CURRENT STATE${scrubEvent ? ' @ ' + scrubEvent.type + (model.events[scrub] ? ' — ' + model.events[scrub].label : '') : ''}</div>
      ${rows}
    </div>`;
  } else {
    monitorHTML = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// no vehicle state at this event</div>`;
  }

  const zf = _missionBandZoom;
  const svgHTML = `<svg viewBox="0 0 ${totalW} ${totalH}" width="${Math.round(totalW * zf)}" height="${Math.round(totalH * zf)}" style="background:var(--panel);display:block;">${gridHTML}${branchHTML}${lanesHTML}${scrubberHTML}</svg>`;

  return `<div class="band-root">${legendHTML}<div class="band-scroll" onwheel="missionBandWheel(event,'${id}')">${svgHTML}</div><div class="band-monitor">${monitorHTML}</div></div>`;
}

// ── Custom node-map nodes (orbit palette + manual creation) ─────────────────
// User-added nodes live in PROG_ACTIVE_PROGRAM.nodeMapCustomNodes, stored in the
// SAME shape as PROG_NM_NODES (id, label, sub, orbit, cx, cy …) plus custom:true.
function _missionCustomNodes() {
  return (typeof PROG_ACTIVE_PROGRAM !== 'undefined' && PROG_ACTIVE_PROGRAM && PROG_ACTIVE_PROGRAM.nodeMapCustomNodes) || [];
}
function _missionNmNodes() {
  return [...PROG_NM_NODES, ..._missionCustomNodes()];
}
function _missionNmNodeById(id) {
  return _missionNmNodes().find(n => n.id === id) || null;
}

// Convert an ORBIT_CATEGORIES entry to a node-map orbit spec (for ΔV physics).
function _missionOrbitToNodeOrbit(o, planet) {
  if (o.mode === 'escape') {
    return { type: 'escape', body: 'Earth', c3: o.c3 ?? 0 };
  }
  const peri = o.perigee ?? o.apogee ?? 0;
  const apo  = o.apogee ?? o.perigee ?? 0;
  return { type: (Math.abs(apo - peri) < 1 ? 'circular' : 'elliptic'),
           body: planet, perigee: peri, apogee: apo, inclination: o.inc ?? 0 };
}

function _missionCreateCustomNode(label, orbit, x, y, sub) {
  if (!PROG_ACTIVE_PROGRAM) return null;
  if (!PROG_ACTIVE_PROGRAM.nodeMapCustomNodes) PROG_ACTIVE_PROGRAM.nodeMapCustomNodes = [];
  const id = 'custom-' + progUUID();
  const dashed = (orbit.type === 'escape' || orbit.type === 'transit');
  PROG_ACTIVE_PROGRAM.nodeMapCustomNodes.push({
    id, nodeId: id,
    label: String(label || 'NODE').toUpperCase().slice(0, 14),
    sub: sub || (orbit.body + ' ' + orbit.type),
    zone: 'custom', cx: Math.round(x), cy: Math.round(y), r: 15,
    orbit, custom: true, dashed,
  });
  return id;
}

function missionDeleteCustomNode(missionId, nodeId) {
  if (!PROG_ACTIVE_PROGRAM || !PROG_ACTIVE_PROGRAM.nodeMapCustomNodes) return;
  PROG_ACTIVE_PROGRAM.nodeMapCustomNodes = PROG_ACTIVE_PROGRAM.nodeMapCustomNodes.filter(n => n.id !== nodeId);
  delete _missionNmPos[nodeId];
  _missionRerenderNodeView(missionId);
}

// ── Orbit palette drag-and-drop ─────────────────────────────────────────────
function missionNmOrbitDragStart(e, pi, oi) {
  e.dataTransfer.setData('text/plain', pi + ':' + oi);
  e.dataTransfer.effectAllowed = 'copy';
}
function missionNmDrop(e, missionId) {
  e.preventDefault();
  const data = e.dataTransfer.getData('text/plain');
  if (!data || data.indexOf(':') < 0) return;
  const [pi, oi] = data.split(':').map(Number);
  const cat = (typeof ORBIT_CATEGORIES !== 'undefined') ? ORBIT_CATEGORIES[pi] : null;
  if (!cat) return;
  const o = cat.orbits[oi];
  if (!o) return;
  // map drop point to SVG world coords
  let x = 550, y = 260;
  const svg = document.querySelector('.mcc-center-col svg');
  if (svg && svg.getScreenCTM) {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    x = p.x; y = p.y;
  }
  _missionCreateCustomNode(o.name, _missionOrbitToNodeOrbit(o, cat.planet), x, y);
  const m = _missionGet(missionId);
  const va = document.querySelector('.mcc-view-area');
  if (va && m) va.innerHTML = _missionNodeMapHTML(m);
}

// Upload a .orbit file (or LV-calc .json orbit) and add it to the node map as a
// custom node, so users can bring saved orbits into a mission.
function missionLoadOrbitFile(input, missionId) {
  const f = input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const o = JSON.parse(e.target.result);
      if (!o.mode && o.perigee == null && o.apogee == null) { showAlert('Not a valid orbit file.', 'Invalid File'); input.value = ''; return; }
      const planet = (o._category && typeof PROG_BODIES !== 'undefined' && PROG_BODIES[o._category]) ? o._category : 'Earth';
      const nodeOrbit = _missionOrbitToNodeOrbit(o, planet);
      _missionCreateCustomNode(o.name || 'Orbit', nodeOrbit, 550 + Math.round((Math.random() - 0.5) * 120), 300 + Math.round((Math.random() - 0.5) * 80));
      const m = _missionGet(missionId);
      const va = document.querySelector('.mcc-view-area');
      if (va && m && _missionViewMode === 'nodemap') va.innerHTML = _missionNodeMapHTML(m);
    } catch (err) { showAlert('Invalid orbit file: ' + err.message, 'Invalid File'); }
    input.value = '';
  };
  r.readAsText(f);
}

// ── Manual custom-node modal ────────────────────────────────────────────────
function missionOpenCustomNodeModal(missionId) {
  const bodyEl = document.getElementById('nmnode-body');
  if (!bodyEl) return;
  const bodies = ['Earth','Moon','Mars','Venus','Mercury','Titan'];
  const bodyOpts = bodies.map(b => `<option>${b}</option>`).join('');
  bodyEl.innerHTML = `
    <input type="hidden" id="nmnode-mission" value="${missionId}">
    <div class="cfg-item" style="margin-bottom:8px;"><label class="cfg-label">Label</label>
      <input id="nmnode-label" class="mcc-field-input" style="width:100%;" value="New Node"></div>
    <div class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
      <div class="cfg-item"><label class="cfg-label">Body</label>
        <select id="nmnode-body-sel" class="mcc-field-input">${bodyOpts}</select></div>
      <div class="cfg-item"><label class="cfg-label">Type</label>
        <select id="nmnode-type" class="mcc-field-input" onchange="missionNmNodeTypeChange()">
          <option value="circular">Circular orbit</option>
          <option value="elliptic">Elliptic orbit</option>
          <option value="escape">Escape / transit</option>
        </select></div>
    </div>
    <div id="nmnode-orbit-fields" class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
      <div class="cfg-item"><label class="cfg-label">Perigee (km)</label>
        <input type="number" id="nmnode-peri" class="field" value="185" style="width:90px;"></div>
      <div class="cfg-item"><label class="cfg-label">Apogee (km)</label>
        <input type="number" id="nmnode-apo" class="field" value="185" style="width:90px;"></div>
      <div class="cfg-item"><label class="cfg-label">Inc (deg)</label>
        <input type="number" id="nmnode-inc" class="field" value="28.5" style="width:80px;"></div>
    </div>
    <div id="nmnode-escape-fields" class="cfg-row" style="display:none;flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
      <div class="cfg-item"><label class="cfg-label">C3 (km²/s²)</label>
        <input type="number" id="nmnode-c3" class="field" value="0" style="width:100px;"></div>
    </div>
    <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionSaveCustomNode()">Add Node</button>`;
  openModal('modal-nm-node');
}
function missionNmNodeTypeChange() {
  const t = document.getElementById('nmnode-type')?.value;
  const orbitF  = document.getElementById('nmnode-orbit-fields');
  const escF    = document.getElementById('nmnode-escape-fields');
  if (!orbitF || !escF) return;
  const isEsc = (t === 'escape');
  orbitF.style.display = isEsc ? 'none' : 'flex';
  escF.style.display   = isEsc ? 'flex' : 'none';
}
function missionSaveCustomNode() {
  const missionId = document.getElementById('nmnode-mission')?.value;
  const label = document.getElementById('nmnode-label')?.value || 'Node';
  const t = document.getElementById('nmnode-type')?.value || 'circular';
  const body = document.getElementById('nmnode-body-sel')?.value || 'Earth';
  let orbit;
  if (t === 'escape') {
    orbit = { type: 'escape', body, c3: parseFloat(document.getElementById('nmnode-c3')?.value) || 0 };
  } else {
    const peri = parseFloat(document.getElementById('nmnode-peri')?.value) || 0;
    const apo  = parseFloat(document.getElementById('nmnode-apo')?.value) || peri;
    orbit = { type: t, body, perigee: peri, apogee: apo, inclination: parseFloat(document.getElementById('nmnode-inc')?.value) || 0 };
  }
  // place new node in open space mid-canvas; user can drag it
  _missionCreateCustomNode(label, orbit, 550 + Math.round((Math.random()-0.5)*120), 300 + Math.round((Math.random()-0.5)*80));
  closeModal('modal-nm-node');
  const m = _missionGet(missionId);
  const va = document.querySelector('.mcc-view-area');
  if (va && m) va.innerHTML = _missionNodeMapHTML(m);
}

function _missionNodeMapHTML(m) {
  const id = m.missionId;
  const path = _missionNodePath(m);
  const byId = {}; _missionNmNodes().forEach(n => byId[n.id] = n);

  // ── data-driven solar-system layout ──────────────────────────────────────
  // Every body gets a column; orbital nodes fan ABOVE the body, transit/escape
  // approach nodes sit to the LEFT at the body's baseline (so they line up with
  // the planet they lead to). World is wide — zoom/scroll to view it all.
  const lay = _missionNmLayout();
  const BODY_COL = lay.bodyCol;
  const pos = lay.pos;
  const posOf = n => _missionNmPos[n.id] || pos[n.id] || [n.cx || 0, n.cy || 0];

  // ── control bar (Draw Maneuver + custom nodes + zoom) ──
  let ctrlHTML = `<div class="sl" style="margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
    <button class="act-btn" style="${_missionBridgeMode ? 'background:var(--accent);color:#000;' : ''}" onclick="missionToggleBridgeMode('${id}')">＋ Draw Maneuver</button>
    <span style="display:inline-flex;align-items:center;gap:2px;">
      <button class="act-btn" style="padding:1px 8px;" onclick="missionNmZoom('${id}',-1)" title="Zoom out">−</button>
      <button class="act-btn" style="padding:1px 8px;" onclick="missionNmZoom('${id}',0)" title="Reset zoom">⊡</button>
      <button class="act-btn" style="padding:1px 8px;" onclick="missionNmZoom('${id}',1)" title="Zoom in">+</button>
    </span>`;
  if (_missionBridgeMode) {
    if (_missionBridgeFrom === null) {
      ctrlHTML += `<span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">Click a start node…</span>`;
    } else {
      const fl = byId[_missionBridgeFrom] ? byId[_missionBridgeFrom].label : _missionBridgeFrom;
      ctrlHTML += `<span style="font-family:var(--mono);font-size:10px;color:var(--text-bright);">From ${fl} — click a destination node</span>`;
      ctrlHTML += `<button class="act-btn" style="padding:2px 8px;font-size:10px;" onclick="missionToggleBridgeMode('${id}')">Cancel</button>`;
    }
  }
  ctrlHTML += `</div>`;

  // ── planet blobs: SOI glow + dashed SOI ring + body disc (clickable if a
  //    surface node exists for that body) ──
  let blobsHTML = '';
  for (const b of lay.blobs) {
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR}" fill="${b.col}" fill-opacity="0.04"/>`;
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR * 0.72}" fill="${b.col}" fill-opacity="0.05"/>`;
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR * 0.44}" fill="${b.col}" fill-opacity="0.07"/>`;
    // SOI ring — clickable for bodies you can inject toward (TLI / TMI / TVI). Clicking
    // it adds the mandatory transfer-injection burn from the focused vehicle's orbit.
    const canInject = !!_MISSION_SOI_INJECT[b.body];
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR}" fill="none" stroke="${b.col}" stroke-width="${canInject ? 1.6 : 1}" stroke-opacity="${canInject ? 0.55 : 0.18}" stroke-dasharray="4,5"/>`;
    if (canInject) blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR}" fill="none" stroke="transparent" stroke-width="18" style="cursor:pointer" onclick="missionInjectToBody('${id}','${b.body}')"><title>Inject toward ${b.body} — adds the transfer burn (you can't arrive without it)</title></circle>`;
    const inPath    = b.surfId && path.includes(b.surfId);
    const isCurrent = b.surfId && path.length > 0 && path[path.length - 1] === b.surfId;
    const isFrom    = b.surfId && _missionBridgeFrom === b.surfId;
    const stroke = isFrom ? 'var(--accent2)' : inPath ? 'var(--accent)' : b.col;
    const sw = (isFrom || isCurrent) ? 3 : (inPath ? 2.5 : 1.6);
    const open = b.surfId ? `<g style="cursor:pointer" onclick="missionNodeClick('${id}','${b.surfId}')" onmousedown="missionNmNodeDown(event,'${id}','${b.surfId}')" oncontextmenu="return false;"><title>${b.body} — surface</title>` : '<g>';
    blobsHTML += open;
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.bodyR}" fill="${b.col}" fill-opacity="0.5" stroke="${stroke}" stroke-width="${sw}"/>`;
    if (isCurrent) blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.bodyR + 5}" fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.5"/>`;
    blobsHTML += `<text x="${b.cx}" y="${b.cy + b.bodyR + 12}" text-anchor="middle" font-family="var(--mono)" font-size="9px" font-weight="600" letter-spacing="1" fill="${b.col}">${b.body.toUpperCase()}</text>`;
    blobsHTML += `</g>`;
  }

  // ── maneuver edges (directional arrows; double-headed when traversed both ways) ──
  // Edges clip to each node's visual radius so they stop at the planet edge instead
  // of cutting through the body disc (surface nodes sit at the planet centre).
  const surfR = {}; lay.blobs.forEach(b => { if (b.surfId) surfR[b.surfId] = b.bodyR; });
  const radiusOf = n => surfR[n.id] || n.r || 16;
  let edgesHTML = '';
  {
    const pairs = {};
    m.log.forEach((e, i) => {
      if (e.type !== 'MANEUVER' || !e.fromNode || !e.toNode || e.fromNode === e.toNode) return;
      const lo = e.fromNode < e.toNode ? e.fromNode : e.toNode;
      const hi = e.fromNode < e.toNode ? e.toNode : e.fromNode;
      const k = lo + '::' + hi;
      if (!pairs[k]) pairs[k] = { lo, hi, loToHi: null, hiToLo: null };
      if (e.fromNode === lo) pairs[k].loToHi = i; else pairs[k].hiToLo = i;
    });
    for (const k in pairs) {
      const p = pairs[k];
      const A = byId[p.lo], B = byId[p.hi];
      if (!A || !B) continue;
      const [ax, ay] = posOf(A), [bx, by] = posOf(B);
      const rA = radiusOf(A), rB = radiusOf(B);
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const Ax = ax + ux * rA, Ay = ay + uy * rA, Bx = bx - ux * rB, By = by - uy * rB;   // clipped to node edges
      const bothWays = p.loToHi != null && p.hiToLo != null;
      const latestIdx = Math.max(p.loToHi == null ? -1 : p.loToHi, p.hiToLo == null ? -1 : p.hiToLo);
      const col = 'var(--accent)';
      edgesHTML += `<g style="cursor:pointer" onclick="missionEdgeClick('${id}',${latestIdx})"><title>${bothWays ? '↔ round trip — ' : ''}maneuver (click to open)</title>`;
      edgesHTML += `<line x1="${Ax}" y1="${Ay}" x2="${Bx}" y2="${By}" stroke="transparent" stroke-width="14"/>`;
      edgesHTML += `<line x1="${Ax}" y1="${Ay}" x2="${Bx}" y2="${By}" stroke="${col}" stroke-width="2.5" opacity="0.85"/>`;
      if (p.loToHi != null || bothWays) edgesHTML += _nmArrowHead(Ax, Ay, Bx, By, col, 2);   // arrow at hi edge
      if (p.hiToLo != null || bothWays) edgesHTML += _nmArrowHead(Bx, By, Ax, Ay, col, 2);   // arrow at lo edge
      edgesHTML += `</g>`;
    }
  }

  // ── nodes (skip surface — drawn as the body disc above) ──
  let nodesHTML = '';
  for (const n of PROG_NM_NODES) {
    if (n.orbit && n.orbit.type === 'surface') continue;
    const [x, y] = posOf(n);
    const inPath    = path.includes(n.id);
    const isCurrent = path.length > 0 && path[path.length - 1] === n.id;
    const isFrom    = _missionBridgeFrom === n.id;
    const r = n.r || 16;
    const stroke = isFrom ? 'var(--accent2)' : inPath ? 'var(--accent)' : (BODY_COL[n.orbit && (n.orbit.destination || n.orbit.body)] || 'var(--border-bright)');
    const sw = (isFrom || isCurrent) ? 3 : (inPath ? 2.5 : 1.5);
    const dash = n.dashed ? ' stroke-dasharray="4 3"' : '';
    const labelColor = inPath ? 'var(--text-bright)' : 'var(--text-dim)';
    nodesHTML += `<g style="cursor:pointer" onclick="missionNodeClick('${id}','${n.id}')" onmousedown="missionNmNodeDown(event,'${id}','${n.id}')" oncontextmenu="return false;"><title>${n.label}${n.sub ? ' — ' + n.sub : ''}</title>`;
    nodesHTML += `<circle cx="${x}" cy="${y}" r="${r}" fill="${stroke}" fill-opacity="0.18" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
    if (isCurrent) nodesHTML += `<circle cx="${x}" cy="${y}" r="${r + 5}" fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.5"/>`;
    nodesHTML += `<text x="${x}" y="${y + 3}" text-anchor="middle" font-family="var(--mono)" font-size="9px" fill="${labelColor}">${n.label}</text>`;
    nodesHTML += `</g>`;
  }

  // ── custom (user-added) nodes ──
  for (const n of _missionCustomNodes()) {
    const [x, y] = posOf(n);
    const inPath    = path.includes(n.id);
    const isCurrent = path.length > 0 && path[path.length - 1] === n.id;
    const isFrom    = _missionBridgeFrom === n.id;
    const r = n.r || 15;
    const baseCol = BODY_COL[n.orbit && n.orbit.body] || 'var(--accent2)';
    const stroke = isFrom ? 'var(--accent2)' : inPath ? 'var(--accent)' : baseCol;
    const sw = (isFrom || isCurrent) ? 3 : (inPath ? 2.5 : 1.5);
    const dash = n.dashed ? ' stroke-dasharray="4 3"' : '';
    const labelColor = inPath ? 'var(--text-bright)' : 'var(--text-dim)';
    nodesHTML += `<g style="cursor:pointer" onclick="missionNodeClick('${id}','${n.id}')" onmousedown="missionNmNodeDown(event,'${id}','${n.id}')" oncontextmenu="return false;"><title>${n.label}${n.sub ? ' — ' + n.sub : ''} (custom — right-drag to move)</title>`;
    nodesHTML += `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" rx="3" fill="${stroke}" fill-opacity="0.18" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
    if (isCurrent) nodesHTML += `<rect x="${x - r - 4}" y="${y - r - 4}" width="${(r + 4) * 2}" height="${(r + 4) * 2}" rx="4" fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.5"/>`;
    nodesHTML += `<text x="${x}" y="${y + 3}" text-anchor="middle" font-family="var(--mono)" font-size="8px" fill="${labelColor}">${n.label}</text>`;
    // delete affordance
    nodesHTML += `<g onclick="event.stopPropagation();missionDeleteCustomNode('${id}','${n.id}')" style="cursor:pointer"><circle cx="${x + r}" cy="${y - r}" r="6" fill="var(--input)" stroke="var(--accent2)" stroke-width="1"/><text x="${x + r}" y="${y - r + 3}" text-anchor="middle" font-family="var(--mono)" font-size="9px" fill="var(--accent2)">×</text></g>`;
    nodesHTML += `</g>`;
  }

  const pxW = Math.round(lay.worldW * _missionNmZoom);
  const svgHTML = `<svg viewBox="0 0 ${lay.worldW} ${lay.worldH}" preserveAspectRatio="xMidYMid meet" style="width:${pxW}px;max-width:none;height:auto;background:transparent;display:block;" oncontextmenu="return false;" ondragover="event.preventDefault()" ondrop="missionNmDrop(event,'${id}')">${blobsHTML}${edgesHTML}${nodesHTML}</svg>`;
  return `<div class="nm-root">${ctrlHTML}<div class="nm-scroll" onwheel="missionNmWheel(event,'${id}')" onmousedown="missionNmPanStart(event,'${id}')">${svgHTML}</div></div>`;
}

// Compute the solar-system node-map layout: body positions + per-node positions.
// Returns { worldW, worldH, blobs:[…], pos:{id:[x,y]}, bodyCol:{} }.
function _missionNmLayout() {
  // body order (left → right) and per-body geometry/color
  const META = {
    Earth:   { col:'#5db877', bodyR:30, soiR:150 },
    Moon:    { col:'#8890bc', bodyR:14, soiR:70  },
    Venus:   { col:'#d8a657', bodyR:24, soiR:95  },
    Mercury: { col:'#aa8866', bodyR:14, soiR:60  },
    Mars:    { col:'#b85848', bodyR:20, soiR:95  },
    Jupiter: { col:'#cc8844', bodyR:42, soiR:185 },
    Saturn:  { col:'#ccbb88', bodyR:38, soiR:160 },
    Uranus:  { col:'#5fd0d0', bodyR:28, soiR:120 },
    Neptune: { col:'#5566dd', bodyR:28, soiR:120 },
  };
  const ORDER = ['Earth','Moon','Venus','Mercury','Mars','Jupiter','Saturn','Uranus','Neptune'];
  const bodyCol = { Sun:'#c6a057' };
  ORDER.forEach(b => bodyCol[b] = META[b].col);

  const SLOT = 320, PADX = 200, BASE_Y = 470, WORLD_H = 1040;
  // vertical scatter so the bodies aren't in one straight line; each body's node
  // fan + SOI move with it. Earth sits lower since it carries the most orbits.
  const CY = { Earth:600, Moon:340, Venus:680, Mercury:420, Mars:740, Jupiter:380, Saturn:700, Uranus:450, Neptune:620 };
  const cxOf = si => PADX + si * SLOT;
  const worldW = cxOf(ORDER.length - 1) + PADX;

  // which system a node belongs to (transit/escape route to their destination)
  const sysOf = n => {
    const o = n.orbit || {};
    if ((o.type === 'transit' || o.type === 'escape') && o.destination) return o.destination;
    return o.body;
  };

  // group built-in nodes by system
  const groups = {};
  ORDER.forEach(b => groups[b] = { surface: [], orbital: [], approach: [] });
  for (const n of PROG_NM_NODES) {
    const sys = sysOf(n);
    if (!groups[sys]) continue;
    const t = n.orbit && n.orbit.type;
    if (t === 'surface') groups[sys].surface.push(n);
    else if (t === 'transit' || t === 'escape') groups[sys].approach.push(n);
    else groups[sys].orbital.push(n);
  }

  const meanAlt = n => {
    const o = n.orbit || {};
    return ((o.apogee ?? o.perigee ?? 0) + (o.perigee ?? o.apogee ?? 0)) / 2;
  };

  const pos = {};
  const blobs = [];
  ORDER.forEach((body, si) => {
    const cx = cxOf(si), cy = CY[body] ?? BASE_Y, meta = META[body];
    const g = groups[body];
    blobs.push({ body, cx, cy, bodyR: meta.bodyR, soiR: meta.soiR, col: meta.col,
                 surfId: g.surface[0] ? g.surface[0].id : null });
    // surface node sits at the body centre
    g.surface.forEach(n => { pos[n.id] = [cx, cy]; });
    // orbital nodes fan straight above the body, lowest altitude nearest
    g.orbital.sort((a, b) => meanAlt(a) - meanAlt(b));
    g.orbital.forEach((n, rank) => {
      const offy = meta.bodyR + 52 + rank * 56;
      const offx = g.orbital.length > 1 ? (rank % 2 === 0 ? -40 : 40) : 0;
      pos[n.id] = [cx + offx, cy - offy];
    });
    // approach (transit/escape) nodes to the LEFT, centred on the body baseline
    const ac = g.approach.length;
    g.approach.forEach((n, k) => {
      pos[n.id] = [cx - meta.bodyR - 88, cy + (k - (ac - 1) / 2) * 54];
    });
  });

  return { worldW, worldH: WORLD_H, blobs, pos, bodyCol };
}

// Footer = scrollable missions list (left) + orbit catalog dock (right).
function _missionFooterHTML(m) {
  // The orbit catalog now lives in the Orbit Map's left panel (not the footer).
  return _missionMissionsPanelHTML(m);
}

// Compact scrollable list of all missions (users rarely make more than ~10).
function _missionMissionsPanelHTML(m) {
  const cards = _missions.map(mi => {
    const sel = mi.missionId === _missionSel;
    return `<div class="mcc-mission-card${sel ? ' sel' : ''}" onclick="missionSelect('${mi.missionId}')">
      <div class="mcc-mission-meta">
        <span class="mcc-mission-name">${mi.name}</span>
        <span class="mcc-mission-sub">${mi.log.length ? mi.log.length + ' event' + (mi.log.length !== 1 ? 's' : '') : 'No events'}</span>
      </div>
      <button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionDelete('${mi.missionId}')" title="Delete mission">✕</button>
    </div>`;
  }).join('');
  return `<div class="mcc-missions">
    <div class="mcc-missions-hdr">
      <span style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--text-dim);">MISSIONS</span>
      <button class="act-btn" style="margin-left:auto;padding:1px 8px;font-size:10px;" onclick="missionNew()">+ New</button>
    </div>
    <div class="mcc-missions-list">${cards}</div>
  </div>`;
}

// ORBITS panel = the LV-calculator's orbit catalog (ORBIT_CATEGORIES), the same
// orbits used everywhere else — grouped by body with the catalog's icons + colours
// and full orbit detail. Click (or drag) one to drop it onto the Orbit Map as a
// node, so the catalog and the map are integrated. Fills the whole sidebar.
function _missionOrbitPaletteHTML(m) {
  const id = m.missionId;
  const hdr = `<div class="nm-orbit-dock-hdr">
    <span style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--text-dim);">ORBITS</span>
    <button class="act-btn" style="padding:1px 8px;font-size:9px;margin-left:auto;" onclick="missionOpenCustomNodeModal('${id}')" title="Add a custom orbit">+ Custom</button>
    <label class="act-btn" style="padding:1px 8px;font-size:9px;cursor:pointer;" title="Upload a .orbit file">Load<input type="file" accept=".orbit,.json" style="display:none" onchange="missionLoadOrbitFile(this,'${id}')"></label>
  </div>`;
  if (typeof ORBIT_CATEGORIES === 'undefined') return `<div class="nm-orbit-dock">${hdr}</div>`;
  let rows = '';
  ORBIT_CATEGORIES.forEach((cat, pi) => {
    rows += `<div class="orbit-body-lbl" style="color:${cat.color};">${cat.icon || ''} ${cat.planet}</div>`;
    cat.orbits.forEach((o, oi) => {
      const detail = o.mode === 'escape'
        ? `C3 ${o.c3} km²/s²`
        : `${(o.perigee || 0).toLocaleString()}×${(o.apogee || 0).toLocaleString()} km · ${o.inc || 0}°`;
      rows += `<div class="orbit-row" draggable="true" ondragstart="missionNmOrbitDragStart(event,${pi},${oi})" onclick="missionCatalogAdd('${id}',${pi},${oi})" title="${(o.note || '').replace(/"/g,'&quot;')}" style="border-left:3px solid ${cat.color};">
        <span class="orbit-row-name">${o.name}</span>
        <span class="orbit-row-sub">${detail}</span>
      </div>`;
    });
  });
  return `<div class="nm-orbit-dock">${hdr}<div class="nm-orbit-scroll">${rows}</div></div>`;
}

// Click an orbit in the catalog → place it on the Orbit Map as a node.
function missionCatalogAdd(id, pi, oi) {
  if (typeof ORBIT_CATEGORIES === 'undefined') return;
  const cat = ORBIT_CATEGORIES[pi]; if (!cat) return;
  const o = cat.orbits[oi]; if (!o) return;
  _missionCreateCustomNode(o.name, _missionOrbitToNodeOrbit(o, cat.planet),
    550 + Math.round((Math.random() - 0.5) * 140), 300 + Math.round((Math.random() - 0.5) * 90));
  const m = _missionGet(id);
  const va = document.querySelector('.mcc-view-area');
  if (va && m && _missionViewMode === 'nodemap') va.innerHTML = _missionNodeMapHTML(m);
}

function missionNmNodeDown(e, missionId, nid) {
  if (e.button !== 2) return;            // right button only; left stays a click
  e.preventDefault(); e.stopPropagation();
  _missionNmDrag = { missionId, nid };
  document.addEventListener('mousemove', missionNmDragMove);
  document.addEventListener('mouseup', missionNmDragEnd);
}
function missionNmDragMove(e) {
  if (!_missionNmDrag) return;
  const svg = document.querySelector('.mcc-center-col svg');
  if (!svg || !svg.getScreenCTM) return;
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  _missionNmPos[_missionNmDrag.nid] = [Math.round(p.x), Math.round(p.y)];
  const va = document.querySelector('.mcc-view-area');   // re-render only the view, keep the palette dock
  const m = _missionGet(_missionNmDrag.missionId);
  if (va && m) {
    const sc = va.querySelector('.nm-scroll');           // preserve pan/scroll across re-render
    const sl = sc ? sc.scrollLeft : 0, st = sc ? sc.scrollTop : 0;
    va.innerHTML = _missionNodeMapHTML(m);               // container persists; doc listeners survive
    const sc2 = va.querySelector('.nm-scroll');
    if (sc2) { sc2.scrollLeft = sl; sc2.scrollTop = st; }
  }
}
function missionNmDragEnd() {
  document.removeEventListener('mousemove', missionNmDragMove);
  document.removeEventListener('mouseup', missionNmDragEnd);
  _missionNmDrag = null;
}

function missionInit() {
  _missions  = [];
  _missionSel = null;
}

let _hangarView = 'spacecraft';   // Hangar sub-picker: 'spacecraft' | 'fleet'
function progSetHangar(v) { _hangarView = v; progShowTab('hangar'); }

function progShowTab(tab) {
  // back-compat: Spacecraft & Fleet are now one "Hangar" tab with an inner picker
  if (tab === 'spacecraft' || tab === 'fleet') { _hangarView = tab === 'fleet' ? 'fleet' : 'spacecraft'; tab = 'hangar'; }
  const showSc      = tab === 'hangar' && _hangarView === 'spacecraft';
  const showFleet   = tab === 'hangar' && _hangarView === 'fleet';
  const showMission = tab === 'mission';
  const setD = (id, on, disp) => { const el = document.getElementById(id); if (el) el.style.display = on ? (disp || 'flex') : 'none'; };
  setD('prog-panel-sc', showSc);       setD('prog-tb-sc', showSc);
  setD('prog-panel-fleet', showFleet); setD('prog-tb-fleet', showFleet);
  setD('prog-panel-mission', showMission); setD('prog-tb-mission', showMission);
  setD('hangar-pick', tab === 'hangar', 'inline-flex');
  document.querySelectorAll('#prog-subnav .lv-sub-btn').forEach(b => b.classList.toggle('active', b.dataset.prog === tab));
  document.querySelectorAll('#hangar-pick button').forEach(b => b.classList.toggle('active', b.dataset.hv === _hangarView));
  if (tab === 'mission') {
    if (!_missions.length) { missionNew(); }            // auto-create the first mission so the command center is never blank
    else {
      if (!_missionGet(_missionSel)) _missionSel = _missions[0].missionId;  // auto-select if none selected
      missionRender();
    }
  }
}
