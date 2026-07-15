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

// MISSION_MODEL_V2 §12 U2: promotion mechanics. Which surface is the stage,
// per mission. Promoting swaps it with the stage; the demoted surface docks
// where the promoted one lived. Nothing unmounts — the world surface always
// re-renders (full or thumb) on every missionRenderDetail() pass, so camera
// (_trajCamByMission), selection (log entries' _expanded / _trajSelectedAuthIdx),
// and view time (_trajViewTime / _missionBandScrub) — none of which are keyed
// to a view mode — survive every swap untouched.
function _missionStageOf(id) {
  return _missionStageSurface[id] || 'world';
}
function _missionPromote(id, surface) {
  const prev = _missionStageOf(id);
  if (prev === surface) return;
  // Leaving World as the stage: drop its cached starfield size (mirrors the
  // old missionSetView's leave-traj behavior) so a later re-promotion
  // re-measures instead of trusting a size cached while off-stage — the
  // thumbnail render skips the starfield entirely (cost cap), so the cache
  // would otherwise go stale silently.
  if (prev === 'world' && typeof _trajStarfieldUnmount === 'function') _trajStarfieldUnmount(id);
  _missionStageSurface[id] = surface;
  _missionBridgeMode = false;
  _missionBridgeFrom = null;
  // legacy mirror — see 570-mission-core-state.js comment on _missionViewMode
  _missionViewMode = surface === 'plan' ? 'nodemap' : surface === 'timeline' ? 'band' : 'traj';
  missionRenderDetail();
}

function _missionStateCardHTML(m) {
  const id = m.missionId;
  if (!m.vehicleId || typeof _missionMultiVehicleHTML !== 'function') return '';
  const inner = _missionMultiVehicleHTML(m);
  if (!inner) return '';
  if (_missionStateCardCollapsed[id]) {
    return `<div class="mcc-state-card collapsed"><button class="mcc-state-card-toggle" onclick="_missionStateCardToggle('${id}')" title="Expand Vehicles &amp; Mission State">&#x25B8;</button></div>`;
  }
  return `<div class="mcc-state-card">
    <button class="mcc-state-card-toggle" onclick="_missionStateCardToggle('${id}')" title="Collapse Vehicles &amp; Mission State">&#x25BE;</button>
    ${inner}
  </div>`;
}
function _missionStateCardToggle(id) {
  _missionStateCardCollapsed[id] = !_missionStateCardCollapsed[id];
  if (typeof _missionRenderPreserveNm === 'function') _missionRenderPreserveNm(id);
  else missionRenderDetail();
}

function missionRenderDetail() {
  const cc = document.getElementById('mission-cc');
  if (!cc) return;
  const m = _missionGet(_missionSel);
  if (!m) { cc.innerHTML = '<div class="placeholder-msg">Select or create a mission</div>'; return; }
  const id = m.missionId;
  const stageSurf = _missionStageOf(id);

  // ── events log (with group blocks + repetition) ──
  const grpSel = _missionGroupMode;
  // event filter: by type and/or vehicle. When Plan is staged (full node map)
  // the type is forced to MANEUVER (it's the only event the map is about).
  const effType = (stageSurf === 'plan') ? 'MANEUVER' : (_missionEvtFilter.type || 'ALL');
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
    // Deliverable A: flight-readiness findings anchored to this authored index
    // render as a small dot badge in the header row and — only while the card
    // is expanded — their full text inline in the body (re-homed off the
    // retired standalone FLIGHT READINESS panel).
    const checkBadge = (typeof _missionChecksEventBadgeHTML === 'function') ? _missionChecksEventBadgeHTML(m, i) : '';
    const checkInline = (expanded && typeof _missionChecksInlineHTML === 'function') ? _missionChecksInlineHTML(m, i) : '';
    return `<div id="mlog-${id}-${i}" class="mcc-evt-row${expanded?' sel':''}${grpSel&&_missionGroupStart===i?' grpstart':''}"${dragAttrs}>
      <div class="mevt-head" onclick="${onclick}">
        <span class="mevt-caret">${grpSel ? grpMark : (expanded ? '▾' : '▸')}</span>
        <span class="mission-log-type">${e.type}</span>
        ${checkBadge}
        ${e.metStart!=null?`<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${_metFmt(e.metStart)}</span>`:''}
        <span class="mevt-sub">${sub}</span>
        ${grpSel ? '' : ctl}
      </div>
      ${(!grpSel && expanded) ? `<div class="mevt-body">${_missionLogCardHTML(e, id, i)}${_missionEventEditFieldsHTML(m, i)}${checkInline}</div>` : ''}
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
  const typeSel = (stageSurf === 'plan')
    ? `<span style="font-family:var(--mono);font-size:9px;color:var(--accent3);align-self:center;white-space:nowrap;">▸ Maneuvers only</span>`
    : `<select ${_fsel} onchange="missionSetEvtFilter('${id}','type',this.value)"><option value="ALL"${effType==='ALL'?' selected':''}>All types</option>${distinctTypes.map(t => `<option value="${t}"${effType===t?' selected':''}>${t}</option>`).join('')}</select>`;
  const vehSelF = `<select ${_fsel} onchange="missionSetEvtFilter('${id}','veh',this.value)"><option value="ALL"${effVeh==='ALL'?' selected':''}>All vehicles</option>${vehIds.map(v => `<option value="${v}"${effVeh===v?' selected':''}>${_vehName(v)}</option>`).join('')}</select>`;
  const filterRow = m.log.length
    ? `<div class="mcc-evt-filterbar">${typeSel}${vehIds.length > 1 || effVeh !== 'ALL' ? vehSelF : ''}</div>`
    : '';

  // ── MISSION_MODEL_V2 §12 U2: three promotable surfaces, one stage + two
  // docked rails. Nothing unmounts: whichever surfaces are NOT staged still
  // render every pass (full rail/dock rendering, or — for World — a cheap
  // live thumbnail, see _missionWorldThumbHTML), so camera/selection/view-time
  // survive every promote. ──
  const worldFullHTML = (typeof _missionTrajViewHTML === 'function') ? _missionTrajViewHTML(m) : '';
  const planFullHTML = _missionNodeMapHTML(m);
  const timelineFullHTML = _missionBandViewHTML(m);
  const planRailSlotHTML = (typeof _planRailHTML === 'function') ? _planRailHTML(m) : '';
  const timelineDockSlotHTML = (typeof _ttdDockHTML === 'function') ? _ttdDockHTML(m, id) : '';

  // WORKFLOW PASS 2 deliverable A: the far-left .mcc-left-col (previously host
  // to the retired Vehicles & Mission State / Flight Readiness panels) is gone.
  // Its one still-live occupant — the ORBITS catalog shown while Plan is staged
  // — is re-homed into the rail slot, stacked above the demoted World thumbnail,
  // so it stays reachable in the same rail-width column adjacent to the stage.
  let stageHTML, leftSlotHTML, bottomSlotHTML = '';
  if (stageSurf === 'plan') {
    stageHTML = planFullHTML;
    const worldThumb = (typeof _missionWorldThumbHTML === 'function') ? _missionWorldThumbHTML(m, { slot: 'rail' }) : '';
    leftSlotHTML = `<div class="mcc-plan-orbit-rail"><div class="mcc-orbit-cat">${_missionOrbitPaletteHTML(m)}</div>${worldThumb}</div>`;
    bottomSlotHTML = timelineDockSlotHTML;
  } else if (stageSurf === 'timeline') {
    stageHTML = timelineFullHTML;
    leftSlotHTML = planRailSlotHTML;
    bottomSlotHTML = (typeof _missionWorldThumbHTML === 'function') ? _missionWorldThumbHTML(m, { slot: 'corner' }) : '';
  } else { // 'world' — the trajectory view embeds its own timeline dock
    // internally (U1 wiring, unchanged), so that IS the bottom-dock slot's
    // content here; no separate sibling is rendered to avoid duplicating it.
    stageHTML = worldFullHTML;
    leftSlotHTML = planRailSlotHTML;
  }
  // WORKFLOW PASS 1 deliverable B: the corner .mcc-state-card is retired in
  // favor of a thin HUD strip docked across the top of the stage (570-mission-panel.js).
  const hudStripHTML = (typeof _missionHudStripHTML === 'function') ? _missionHudStripHTML(m) : '';

  // ── mission/program name now live in the File ▾ menu, moved to the GLOBAL
  // header in WORKFLOW PASS 2 deliverable B2 (see _globalFileMenuHTML in
  // 570-mission-manager.js) — it's program-level, not mission-level. The
  // Band|Orbit Map|Trajectory toggle that used to live here is RETIRED per
  // §12 U2 — promotion (⤢ on each rail/dock/thumb, plus the World/Timeline/Plan
  // selector buttons, pass 2 deliverable B3) replaces it; missionSetView(id,mode)
  // survives as a thin alias, see 570-mission-panel.js) ──

  // WORKFLOW PASS 2 deliverable A: the setup hint that used to live in the
  // retired far-left column (shown before any vehicle has been launched) is
  // re-homed above the events list, in the right column it's guiding the user
  // toward.
  const setupHintHTML = (!m.vehicleId && stageSurf !== 'plan')
    ? `<div class="mcc-panel-pad" style="border-bottom:1px solid var(--border);"><div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);line-height:1.7;">
        Use <b style="color:var(--text-bright)">＋ Add Event → Launch</b> (or Place in Orbit) below to bring a vehicle into the mission.
      </div></div>`
    : '';

  // WORKFLOW PASS 2 deliverable B3: the primary stage-switching affordance —
  // three labeled buttons, active-state styled like the old Band|Orbit-Map
  // toggle. Wired straight to _missionPromote (⤢ promote controls on the
  // rails stay as the secondary path, unchanged).
  const stageBtn = (surf, label) => `<button class="act-btn mcc-stagesel-btn${stageSurf === surf ? ' active' : ''}" onclick="_missionPromote('${id}','${surf}')" title="Show ${label}">${label}</button>`;
  const stageSelHTML = `<div class="mcc-stagesel-seg">${stageBtn('world','World')}${stageBtn('timeline','Timeline')}${stageBtn('plan','Plan')}</div>`;

  cc.innerHTML = `
    <!-- BODY -->
    <div class="mcc-body">
      <!-- CENTER COLUMN — stage + rails (§12 U2). WORKFLOW PASS 2 deliverable A:
           the old far-left .mcc-left-col is gone; this column now claims the
           freed width. -->
      <div class="mcc-center-col">
        <!-- toolbar is a sibling of the scrolling view area (not inside it) so it
             can never be clipped by .mcc-view-area's overflow -->
        <div class="mcc-view-toggle-float">
          ${stageSelHTML}
          <div class="mcc-toolbar-sep"></div>
          <div class="mcc-topbar-undoredo">
            <button class="act-btn" onclick="missionUndo()" title="Undo (Ctrl+Z)"${(typeof _missionUndoCanUndo==='function'&&_missionUndoCanUndo())?'':' disabled'}>&#x21B6;</button>
            <button class="act-btn" onclick="missionRedo()" title="Redo (Ctrl+Y)"${(typeof _missionUndoCanRedo==='function'&&_missionUndoCanRedo())?'':' disabled'}>&#x21B7;</button>
          </div>
          <!-- readiness chip lives in the HUD strip (workflow pass 1) — NOT
               duplicated here; a pass-2 agent re-added it to the toolbar and
               the orchestrator removed the duplicate (2026-07-15). -->
        </div>
        <div class="mcc-view-row">
          ${leftSlotHTML}
          <div class="mcc-view-area">
            ${hudStripHTML}
            <div class="mcc-stage-col">
              <div class="mcc-stage-fill">${stageHTML}</div>
              ${bottomSlotHTML ? `<div class="mcc-dock-slot">${bottomSlotHTML}</div>` : ''}
            </div>
          </div>
        </div>
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
        <div class="mcc-panel-pad mcc-addevt-dock${_missionAddEvt != null ? ' open' : ''}" style="flex-shrink:0;">${_missionAddEventHTML(m)}</div>
      </div>
    </div>
  `;
  if (m.vehicleId) setTimeout(() => missionBurnPreview(m.missionId), 0);
  if (stageSurf === 'plan') _missionCenterNmEarth();
  if (stageSurf === 'world' && typeof _missionTrajAfterRender === 'function') _missionTrajAfterRender(m);
  // WORKFLOW PASS 2 deliverable B2: keep the header's File menu (program/mission
  // name fields, Reset visibility) in sync with every mission mutation.
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

// ── Launch parameter UI (lives in a pop-up, opened from Add Event → Launch) ──
