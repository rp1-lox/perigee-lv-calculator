function _missionMake(name) {
  return {
    missionId:     progUUID(),
    name:          name || 'New Mission',
    fleetEntryId:  null,
    payloadScIds:  [],
    launchOrbit:   { body: 'Earth', periKm: 185, apoKm: 185, incDeg: 28.5, lanDeg: 0 },
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
  // Switching missions silently discards any pending create/edit draft on the
  // mission we're leaving (rule: a draft never survives navigating away).
  if (_missionPendingEvent) missionCancelPendingEvent(_missionPendingEvent.missionId);
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
  // MISSION_MODEL_V2 §12 U3: _missionViewMode is real state again — the
  // authoritative view ('traj'|'band'|'nodemap'), not a mirror of a
  // promotion surface. See 570-mission-core-state.js.
  const viewMode = _missionViewMode;

  // ── events log (with group blocks + repetition) ──
  const grpSel = _missionGroupMode;
  // event filter: by type and/or vehicle. When Node map is the active view
  // the type is forced to MANEUVER (it's the only event the map is about).
  const effType = (viewMode === 'nodemap') ? 'MANEUVER' : (_missionEvtFilter.type || 'ALL');
  const effVeh  = _missionEvtFilter.veh || 'ALL';
  const matchEvt = e => (effType === 'ALL' || e.type === effType) && (effVeh === 'ALL' || e.vehicleId === effVeh);
  const card = (e, i) => {
    if (!grpSel && !e.pending && !matchEvt(e)) return '';   // hidden by filter (never hide while picking a group, and never hide the pending draft)
    const expanded = e.pending || !!e._expanded;   // a pending draft is ALWAYS shown expanded (it IS the create form)
    const upDis = (i <= 0) ? ' disabled' : '';
    const dnDis = (i >= m.log.length - 1) ? ' disabled' : '';
    const sub = e.burnLabel || e.toLabel || e.vehicleName || e.label || e.targetName || '';
    // Unify-create/edit (2026-07-16): a pending draft's ctlbar is Commit/Cancel
    // instead of the usual move/delete controls — Commit runs the SAME
    // missionApply*Edit function a later edit of that entry would use (see
    // missionCommitPendingEvent, 570-mission-band.js); Cancel splices the
    // draft back out with no recompute (m.log stays byte-identical).
    const ctl = e.pending
      ? `<div class="mevt-ctlbar"><button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;" onclick="event.stopPropagation();missionCommitPendingEvent('${id}')">${e._commitLabel || 'Commit'}</button><button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionCancelPendingEvent('${id}')" title="Discard (Esc)">Cancel</button></div>`
      : `<div class="mevt-ctlbar"><button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionMoveEvent('${id}',${i},-1)" title="Move up"${upDis}>▲</button><button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionMoveEvent('${id}',${i},1)" title="Move down"${dnDis}>▼</button><button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionMoveEventToEnd('${id}',${i})" title="Send to end"${dnDis}>⤓</button><button class="act-btn mevt-ctl" onclick="event.stopPropagation();missionDeleteEvent('${id}',${i})" title="Delete event">✕</button></div>`;
    const grpMark = grpSel ? (_missionGroupStart === i ? '◉ ' : '○ ') : '';
    const onclick = e.pending ? '' : (grpSel ? `missionGroupPick('${id}',${i})` : `missionSelectEvent('${id}',${i})`);
    const dragAttrs = (grpSel || e.pending) ? '' : ` draggable="true" ondragstart="missionEvtDragStart(event,${i})" ondragover="missionEvtDragOver(event)" ondragleave="missionEvtDragLeave(event)" ondrop="missionEvtDrop(event,'${id}',${i})"`;
    // Deliverable A: flight-readiness findings anchored to this authored index
    // render as a small dot badge in the header row and — only while the card
    // is expanded — their full text inline in the body (re-homed off the
    // retired standalone FLIGHT READINESS panel).
    const checkBadge = (!e.pending && typeof _missionChecksEventBadgeHTML === 'function') ? _missionChecksEventBadgeHTML(m, i) : '';
    const checkInline = (!e.pending && expanded && typeof _missionChecksInlineHTML === 'function') ? _missionChecksInlineHTML(m, i) : '';
    // The pending draft has no committed state to summarize yet — show ONLY
    // the (shared) edit-fields form, i.e. exactly the create form; a
    // committed card shows its read-only summary PLUS the edit-fields form.
    const bodyHTML = e.pending ? _missionEventEditFieldsHTML(m, i) : `${_missionLogCardHTML(e, id, i)}${_missionEventEditFieldsHTML(m, i)}${checkInline}`;
    return `<div id="mlog-${id}-${i}" class="mcc-evt-row${expanded?' sel':''}${grpSel&&_missionGroupStart===i?' grpstart':''}${e.pending?' mevt-pending':''}"${dragAttrs}>
      <div class="mevt-head" onclick="${onclick}">
        <span class="mevt-caret">${e.pending ? '<span class="mevt-pending-badge">NEW</span>' : (grpSel ? grpMark : (expanded ? '▾' : '▸'))}</span>
        <span class="mission-log-type">${e.type}</span>
        ${checkBadge}
        ${e.metStart!=null?`<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${_metFmt(e.metStart)}</span>`:''}
        <span class="mevt-sub">${sub}</span>
        ${grpSel ? '' : ctl}
      </div>
      ${(!grpSel && expanded) ? `<div class="mevt-body">${bodyHTML}</div>` : ''}
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
        if (g.kind === 'transfer') {
          // §22 TRANSFER CHAINS: header shows the route + summed member ΔV +
          // a ↻ re-solve control instead of the Loop repeat UI. Total is the
          // SUM of each member's own charged dv (depart auto/override + mcc
          // burnParam + inject dv/dvOverride) — never re-derived here.
          let totalDv = 0;
          for (let k = i; k < j; k++) {
            const e = m.log[k];
            if (e.type === 'BURN') totalDv += (e.burnParam || 0);
            else if (e.type === 'MNODE') totalDv += (e.dvOverride != null ? e.dvOverride : (e.dvRequired || 0));
          }
          logHTML += `<div class="mcc-group mcc-group-transfer">
            <div class="mcc-group-hdr">
              <span class="mcc-group-name">⊞ ${_tsEsc ? _tsEsc(g.name || 'Transfer') : (g.name || 'Transfer')}</span>
              <span class="mcc-group-rep" style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">Σ&Delta;V ${Math.round(totalDv).toLocaleString()} m/s</span>
              <button class="act-btn mevt-ctl" onclick="missionChainResolve('${id}','${gid}')" title="Re-solve this transfer with current inputs">↻ Re-solve</button>
              <button class="act-btn mevt-ctl" onclick="missionUngroup('${id}','${gid}')" title="Ungroup">⊟</button>
            </div>
            <div class="mcc-group-body">${inner}</div>
          </div>`;
          i = j;
          continue;
        }
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
  const typeSel = (viewMode === 'nodemap')
    ? `<span style="font-family:var(--mono);font-size:9px;color:var(--accent3);align-self:center;white-space:nowrap;">▸ Maneuvers only</span>`
    : `<select ${_fsel} onchange="missionSetEvtFilter('${id}','type',this.value)"><option value="ALL"${effType==='ALL'?' selected':''}>All types</option>${distinctTypes.map(t => `<option value="${t}"${effType===t?' selected':''}>${t}</option>`).join('')}</select>`;
  const vehSelF = `<select ${_fsel} onchange="missionSetEvtFilter('${id}','veh',this.value)"><option value="ALL"${effVeh==='ALL'?' selected':''}>All vehicles</option>${vehIds.map(v => `<option value="${v}"${effVeh===v?' selected':''}>${_vehName(v)}</option>`).join('')}</select>`;
  const filterRow = m.log.length
    ? `<div class="mcc-evt-filterbar">${typeSel}${vehIds.length > 1 || effVeh !== 'ALL' ? vehSelF : ''}</div>`
    : '';

  // ── MISSION_MODEL_V2 §12 U3: switchable CENTER region. Exactly one of the
  // three renderers fills the stage; its own docked assistive panel renders
  // directly underneath as one unit (option A, uniform across all three
  // views). The renderers themselves (_missionTrajViewHTML/_missionBandViewHTML/
  // _missionNodeMapHTML) are UNCHANGED — this is chrome, not map rendering. ──
  let stageHTML, viewPanelHTML;
  if (viewMode === 'nodemap') {
    stageHTML = _missionNodeMapHTML(m);
    // Node map panel = the ORBITS catalog — its natural home (was the dying
    // Plan-rail's one live occupant).
    viewPanelHTML = `<div class="mcc-view-panel mcc-view-panel-nodemap"><div class="mcc-orbit-cat">${_missionOrbitPaletteHTML(m)}</div></div>`;
  } else if (viewMode === 'band') {
    stageHTML = _missionBandViewHTML(m);
    // Timeline panel: blank scaffold for now (user: "leave them blank").
    viewPanelHTML = `<div class="mcc-view-panel mcc-view-panel-timeline"></div>`;
  } else { // 'traj' — World
    stageHTML = (typeof _missionTrajViewHTML === 'function') ? _missionTrajViewHTML(m) : '';
    // World panel = the camera/frame/anchor selects, moved off the floating
    // stage toolbar into the docked panel — the last floating chrome killed.
    viewPanelHTML = `<div class="mcc-view-panel mcc-view-panel-world">${(typeof _trajCamToolbarHTML === 'function') ? _trajCamToolbarHTML(m, id) : ''}</div>`;
  }

  // Left column: the Vehicles & Mission State panel RETURNS to its pre-§12
  // home, full per-vehicle state, event-aware (unchanged data path).
  const leftColHTML = (typeof _missionMultiVehicleHTML === 'function') ? _missionMultiVehicleHTML(m) : '';

  // Top universal strip: MET/date + minimal scrubber + active vehicle name +
  // readiness chip — identical across all three views (570-mission-panel.js).
  const topStripHTML = (typeof _missionTopStripHTML === 'function') ? _missionTopStripHTML(m) : '';

  // Visible tri-toggle at the top of the center region — the primary,
  // exclusive view switch (570-mission-panel.js).
  const viewToggleHTML = (typeof _missionViewToggleHTML === 'function') ? _missionViewToggleHTML(m) : '';

  // The setup hint (shown before any vehicle has been launched) lives above
  // the events list, in the right column it's guiding the user toward.
  const setupHintHTML = (!m.vehicleId && viewMode !== 'nodemap')
    ? `<div class="mcc-panel-pad" style="border-bottom:1px solid var(--border);"><div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);line-height:1.7;">
        Use <b style="color:var(--text-bright)">＋ Add Event → Launch</b> (or Place in Orbit) below to bring a vehicle into the mission.
      </div></div>`
    : '';

  cc.innerHTML = `
    ${topStripHTML}
    <!-- BODY -->
    <div class="mcc-body">
      <!-- LEFT COLUMN — Vehicles & Mission State (§12 U3: back home) -->
      <div class="mcc-left-col">${leftColHTML}</div>

      <!-- CENTER COLUMN — tri-toggle + switchable stage + per-view panel -->
      <div class="mcc-center-col">
        ${viewToggleHTML}
        <div class="mcc-view-area">${stageHTML}</div>
        ${viewPanelHTML}
      </div>

      <!-- RIGHT COLUMN — events (list on top, Add Event docked at the bottom) -->
      <div class="mcc-right-col">
        ${setupHintHTML}
        <div class="mcc-events-header" style="display:flex;align-items:center;gap:8px;">
          <span style="color:var(--accent3);">EVENTS</span>
          ${m.log.length ? `<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${m.log.length}</span>` : ''}
          ${m.log.length >= 1 ? `<button class="act-btn mcc-loop-btn${_missionGroupMode?' active':''}" onclick="missionToggleGroupMode('${id}')">${_missionGroupMode ? (_missionGroupStart==null?'⊞ pick start…':'⊞ pick end…') : '⊞ Loop'}</button>${_missionGroupMode?`<button class="act-btn mcc-loop-cancel" onclick="missionToggleGroupMode('${id}')">✕</button>`:''}` : ''}
        </div>
        ${filterRow}
        <div class="mcc-events-list">${logHTML}</div>
        <div class="mcc-panel-pad mcc-addevt-dock${(_missionAddEvt != null || (typeof _missionGroupPending !== 'undefined' && _missionGroupPending)) ? ' open' : ''}" style="flex-shrink:0;">${_missionAddEventHTML(m)}</div>
      </div>
    </div>
  `;
  if (m.vehicleId) setTimeout(() => missionBurnPreview(m.missionId), 0);
  if (viewMode === 'nodemap') _missionCenterNmEarth();
  if (viewMode === 'traj' && typeof _missionTrajAfterRender === 'function') _missionTrajAfterRender(m);
  // keep the header's File menu (program/mission name fields, Reset
  // visibility) in sync with every mission mutation.
  if (typeof _globalFileMenuRender === 'function') _globalFileMenuRender();
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

// ── Launch parameter UI (rendered inline in the Add Event → Launch dock form) ──
