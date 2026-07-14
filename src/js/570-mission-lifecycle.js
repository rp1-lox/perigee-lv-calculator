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
    // MISSION_MODEL_V2 D3/Phase 2 S5: the persistence version gate. Every
    // mission this build creates is pure-V2 (no legacy MANEUVER entries, no
    // detachedFrom baggage) — see applyProgramObject/_applySessionObject.
    modelVersion:  2,
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
    const ctl = `<div class="mevt-ctlbar"><button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionMoveEvent('${id}',${i},-1)" title="Move up"${upDis}>▲</button><button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionMoveEvent('${id}',${i},1)" title="Move down"${dnDis}>▼</button><button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionMoveEventToEnd('${id}',${i})" title="Send to end"${dnDis}>⤓</button><button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionDeleteEvent('${id}',${i})" title="Delete event">✕</button></div>`;
    const grpMark = grpSel ? (_missionGroupStart === i ? '◉ ' : '○ ') : '';
    const onclick = grpSel ? `missionGroupPick('${id}',${i})` : `missionSelectEvent('${id}',${i})`;
    const dragAttrs = grpSel ? '' : ` draggable="true" ondragstart="missionEvtDragStart(event,${i})" ondragover="missionEvtDragOver(event)" ondragleave="missionEvtDragLeave(event)" ondrop="missionEvtDrop(event,'${id}',${i})"`;
    return `<div id="mlog-${id}-${i}" class="mcc-evt-row${expanded?' sel':''}${grpSel&&_missionGroupStart===i?' grpstart':''}"${dragAttrs}>
      <div class="mevt-head" onclick="${onclick}">
        <span class="mevt-caret">${grpSel ? grpMark : (expanded ? '▾' : '▸')}</span>
        <span class="mission-log-type">${e.type}</span>
        ${e.metStart!=null?`<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${_metFmt(e.metStart)}</span>`:''}
        <span class="mevt-sub">${sub}</span>
        ${grpSel ? '' : ctl}
      </div>
      ${(!grpSel && expanded) ? `<div class="mevt-body">${_missionLogCardHTML(e, id, i)}${_missionEventEditFieldsHTML(m, i)}</div>` : ''}
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

  // ── center content ──
  const view = _missionViewMode === 'nodemap' ? _missionNodeMapHTML(m)
    : _missionViewMode === 'traj' ? (typeof _missionTrajViewHTML === 'function' ? _missionTrajViewHTML(m) : '')
    : _missionBandViewHTML(m);

  // ── mission/program name now live in the File ▾ menu (topbar removed — its row's
  // vertical space goes to the body; the view toggle + undo/redo + File menu all
  // moved into one floating toolbar over the view area, see mcc-view-toggle-float) ──
  const progName = (PROG_ACTIVE_PROGRAM && PROG_ACTIVE_PROGRAM.name) || '';

  cc.innerHTML = `
    <!-- BODY -->
    <div class="mcc-body">
      <!-- LEFT COLUMN — Orbit Map: the ORBITS catalog fills it; Band: vehicles + state -->
      <div class="mcc-left-col">
        ${_missionViewMode === 'nodemap'
          ? `<div class="mcc-orbit-cat">${_missionOrbitPaletteHTML(m)}</div>`
          : `${m.vehicleId ? '' : `<div class="mcc-section-header">Setup</div>
            <div class="mcc-panel-pad"><div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);line-height:1.7;">
              Use <b style="color:var(--text-bright)">＋ Add Event → Launch</b> (or Place in Orbit) on the right to bring a vehicle into the mission.
            </div></div>`}
            ${m.vehicleId ? _missionMultiVehicleHTML(m) : ''}
            ${(m.log.length && typeof _missionChecksBoxHTML === 'function') ? _missionChecksBoxHTML(m) : ''}`}
      </div>

      <!-- CENTER COLUMN — node map / band view -->
      <div class="mcc-center-col">
        <!-- toolbar is a sibling of the scrolling view area (not inside it) so its
             File menu can never be clipped by .mcc-view-area's overflow -->
        <div class="mcc-view-toggle-float">
          <div class="seg">
            <button class="${_missionViewMode === 'band' ? 'active' : ''}" onclick="missionSetView('${id}','band')">Band</button>
            <button class="${_missionViewMode === 'nodemap' ? 'active' : ''}" onclick="missionSetView('${id}','nodemap')">Orbit Map</button>
            <button class="${_missionViewMode === 'traj' ? 'active' : ''}" onclick="missionSetView('${id}','traj')">Trajectory</button>
          </div>
          <div class="mcc-toolbar-sep"></div>
          <div class="mcc-topbar-undoredo">
            <button class="act-btn" onclick="missionUndo()" title="Undo (Ctrl+Z)"${(typeof _missionUndoCanUndo==='function'&&_missionUndoCanUndo())?'':' disabled'}>&#x21B6;</button>
            <button class="act-btn" onclick="missionRedo()" title="Redo (Ctrl+Y)"${(typeof _missionUndoCanRedo==='function'&&_missionUndoCanRedo())?'':' disabled'}>&#x21B7;</button>
          </div>
          ${(m.log.length && typeof _missionChecksToolbarChipHTML === 'function') ? `<div class="mcc-toolbar-sep"></div>${_missionChecksToolbarChipHTML(m)}` : ''}
          <div class="mcc-toolbar-sep"></div>
          <div class="mcc-export-wrap">
            <button class="act-btn" onclick="_missionToggleExportMenu(event)" title="File options">File &#x25BE;</button>
            <div class="mcc-export-menu" id="mcc-export-menu">
              <div class="mcc-export-progrow" onclick="event.stopPropagation();">
                <input class="mcc-program-name-input" value="${progName.replace(/"/g,'&quot;')}"
                  onclick="event.stopPropagation();" oninput="event.stopPropagation();_missionProgramRename(this.value)" title="Program name" placeholder="Program name">
              </div>
              <div class="mcc-export-progrow" onclick="event.stopPropagation();">
                <input class="mcc-program-name-input" value="${m.name.replace(/"/g,'&quot;')}"
                  onclick="event.stopPropagation();" oninput="event.stopPropagation();missionRename('${id}',this.value)" title="Mission name" placeholder="Mission name">
              </div>
              <button class="mcc-export-item" onclick="_missionCloseExportMenu();saveProgramFile()">&#x1F4BE; Save Program</button>
              <label class="mcc-export-item" style="cursor:pointer;" title="Load a .program file" onclick="_missionCloseExportMenu();">&#x1F4C2; Load Program
                <input type="file" accept=".program,.json" style="display:none" onchange="loadProgramFile(this)">
              </label>
              <div class="mcc-export-sep"></div>
              <button class="mcc-export-item" onclick="_missionCloseExportMenu();missionExportReport('${id}')">&#x2398; Report</button>
              <button class="mcc-export-item" onclick="_missionCloseExportMenu();missionExportPNG('${id}')">&#x2B07; PNG</button>
              <div class="mcc-export-sep"></div>
              ${m.log.length ? `<button class="mcc-export-item mcc-export-danger" onclick="_missionCloseExportMenu();_missionConfirmReset('${id}')">&#x232B; Reset</button>` : ''}
            </div>
          </div>
        </div>
        <div class="mcc-view-area">${view}</div>
      </div>

      <!-- RIGHT COLUMN — events (list on top, Add Event docked at the bottom) -->
      <div class="mcc-right-col">
        <div class="mcc-events-header" style="display:flex;align-items:center;gap:8px;">
          <span style="color:var(--accent3);">EVENTS</span>
          ${m.log.length ? `<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${m.log.length}</span>` : ''}
          ${m.log.length >= 1 ? `<button class="act-btn mcc-loop-btn${_missionGroupMode?' active':''}" onclick="missionToggleGroupMode('${id}')">${_missionGroupMode ? (_missionGroupStart==null?'⊞ pick start…':'⊞ pick end…') : '⊞ Loop'}</button>${_missionGroupMode?`<button class="act-btn mcc-loop-cancel" onclick="missionToggleGroupMode('${id}')">✕</button>`:''}` : ''}
        </div>
        ${filterRow}
        <div class="mcc-events-list">${logHTML}</div>
        <div class="mcc-panel-pad mcc-addevt-dock${_missionAddEvt != null ? ' open' : ''}" style="flex-shrink:0;">${_missionAddEventHTML(m)}</div>
      </div>
    </div>
  `;
  if (m.vehicleId) setTimeout(() => missionBurnPreview(m.missionId), 0);
  if (_missionViewMode === 'nodemap') _missionCenterNmEarth();
  if (_missionViewMode === 'traj' && typeof _missionTrajAfterRender === 'function') _missionTrajAfterRender(m);
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

function _missionProgramRename(val) {
  if (!PROG_ACTIVE_PROGRAM) return;
  PROG_ACTIVE_PROGRAM.name = val;
  if (typeof autosaveScheduleSave === 'function') autosaveScheduleSave();
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
