
// ─── MISSION MANAGER ─────────────────────────────────────────────────────

let _missions = [];
let _missionSel = null;
let _missionViewMode  = 'nodemap';    // 'band' | 'nodemap'  (Step 4)
let _missionBandScrub = null;
let _missionAddEvt = null;   // null = closed; '__menu__' = picker; or a type          // scrubbed event index for the band view (null = last event)
let _missionSelEvt = null;   // selected event index for event detail panel
let _missionBridgeMode = false;        // true while user is drawing a maneuver bridge
let _missionBridgeFrom = null;         // node id chosen as the bridge start

function _missionMake(name) {
  return {
    missionId:     progUUID(),
    name:          name || 'New Mission',
    fleetEntryId:  null,
    payloadScIds:  [],
    launchOrbit:   { body: 'Earth', alt_km: 185, inc_deg: 28.5, lan_deg: 0 },
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

  // ── payload manifest checkboxes ──
  const payChecks = _scEdSC.map(sc => `
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer;">
      <input type="checkbox"${m.payloadScIds.includes(sc.spacecraftId) ? ' checked' : ''}
        onchange="missionTogglePayload('${id}','${sc.spacecraftId}',this.checked)">
      <span style="font-family:var(--mono);font-size:11px;color:var(--text-bright)">${sc.name}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${_fleetScMassById(sc.spacecraftId).toLocaleString()} kg</span>
    </label>`).join('');

  // ── launch vehicle & mission select options ──
  const lvOpts = [
    '<option value="">— select launch vehicle —</option>',
    ..._fleetEntries.map(e => `<option value="${e.fleetId}"${e.fleetId === m.fleetEntryId ? ' selected' : ''}>${e.name}</option>`)
  ].join('');

  const missionOpts = _missions.map(mi =>
    `<option value="${mi.missionId}"${mi.missionId === _missionSel ? ' selected' : ''}>${mi.name}</option>`
  ).join('');

  // ── body select ──
  const bodies = ['Earth','Moon','Mars','Venus','Mercury','Titan'];
  const bodyOpts = bodies.map(b => `<option${b === m.launchOrbit.body ? ' selected' : ''}>${b}</option>`).join('');

  const canLaunch = !!m.fleetEntryId;

  // ── events log ──
  const logHTML = m.log.length
    ? m.log.map((e, i) => `<div id="mlog-${id}-${i}" class="mcc-evt-row${_missionSelEvt===i?' sel':''}" style="position:relative;"><div onclick="missionSelectEvent('${id}',${i})" style="cursor:pointer">${_missionLogCardHTML(e)}</div><button class="act-btn" style="position:absolute;top:4px;right:4px;padding:1px 6px;font-size:10px;" onclick="event.stopPropagation();missionDeleteEvent('${id}',${i})" title="Delete event">✕</button>${_missionSelEvt===i ? _missionEventDetailHTML(m, i) : ''}</div>`).join('')
    : '<div style="color:var(--text-dim);font-family:var(--mono);font-size:10px;">No events yet.<br>Configure a LAUNCH and click Execute.</div>';

  // ── center content ──
  const centerHTML = _missionViewMode === 'nodemap'
    ? _missionNodeMapHTML(m)
    : _missionBandViewHTML(m);

  cc.innerHTML = `
    <!-- TOP BAR -->
    <div class="mcc-topbar">
      <span class="sl" style="margin:0;">Mission</span>
      <select class="mcc-field-select" style="width:auto;min-width:180px;" onchange="missionSelect(this.value)">${missionOpts}</select>
      <button class="act-btn" style="padding:4px 10px;font-size:10px;" onclick="missionNew()">+ New</button>
      <input value="${m.name.replace(/"/g,'&quot;')}" class="sc-stage-name" style="font-size:13px;flex:1;max-width:300px;"
        oninput="missionRename('${id}',this.value)">
      <div style="margin-left:auto;display:flex;align-items:center;gap:6px;">
        <div class="seg">
          <button class="${_missionViewMode === 'band' ? 'active' : ''}" onclick="missionSetView('${id}','band')">Band</button>
          <button class="${_missionViewMode === 'nodemap' ? 'active' : ''}" onclick="missionSetView('${id}','nodemap')">Node Map</button>
        </div>
        <div style="width:1px;height:16px;background:var(--border);margin:0 2px;"></div>
        <button class="act-btn" style="padding:7px 18px;${canLaunch ? 'background:var(--accent);color:#000;font-weight:600;' : ''}"
          onclick="missionExecLaunch('${id}')"${canLaunch ? '' : ' disabled'}>▶ Execute Launch</button>
        ${m.log.length ? `<button class="act-btn" onclick="missionResetLaunch('${id}')">Reset</button>` : ''}
      </div>
    </div>

    <!-- BODY -->
    <div class="mcc-body">
      <!-- LEFT COLUMN — setup & vehicles -->
      <div class="mcc-left-col">
        <div class="mcc-section-header">Launch Vehicle</div>
        <div class="mcc-panel-pad">
          <select class="mcc-field-select" onchange="missionSetFleet('${id}',this.value)">${lvOpts}</select>
        </div>

        <div class="mcc-section-header">Payload Manifest</div>
        <div class="mcc-panel-pad">
          ${payChecks || '<span style="color:var(--text-dim);font-family:var(--mono);font-size:10px;">No spacecraft defined. Add spacecraft in the Spacecraft tab.</span>'}
        </div>

        <div class="mcc-section-header">Launch Orbit</div>
        <div class="mcc-panel-pad">
          <div class="cfg-row" style="flex-wrap:wrap;gap:10px 20px;align-items:flex-end;">
            <div class="cfg-item">
              <label class="cfg-label">Body</label>
              <select style="background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;"
                onchange="missionSetOrbit('${id}','body',this.value)">${bodyOpts}</select>
            </div>
            <div class="cfg-item">
              <label class="cfg-label">Alt (km)</label>
              <input type="number" class="field" value="${m.launchOrbit.alt_km}" min="0" style="width:90px;"
                oninput="missionSetOrbit('${id}','alt_km',+this.value)">
            </div>
            <div class="cfg-item">
              <label class="cfg-label">Inc (deg)</label>
              <input type="number" class="field" value="${m.launchOrbit.inc_deg}" min="0" max="180" style="width:80px;"
                oninput="missionSetOrbit('${id}','inc_deg',+this.value)">
            </div>
            <div class="cfg-item">
              <label class="cfg-label">LAN (deg)</label>
              <input type="number" class="field" value="${m.launchOrbit.lan_deg}" min="0" max="360" style="width:80px;"
                oninput="missionSetOrbit('${id}','lan_deg',+this.value)">
            </div>
          </div>
        </div>

        ${m.vehicleId ? _missionMultiVehicleHTML(m) : ''}
        ${m.vehicleId ? `<div class="mcc-left-budget">${_missionBudgetCardHTML(m)}</div>` : ''}
      </div>

      <!-- CENTER COLUMN — node map or band placeholder -->
      <div class="mcc-center-col">${centerHTML}</div>

      <!-- RIGHT COLUMN — events -->
      <div class="mcc-right-col">
        <div class="mcc-events-header">EVENTS</div>
        <div class="mcc-panel-pad" style="border-bottom:1px solid var(--border);flex-shrink:0;">${_missionAddEventHTML(m)}</div>
        <div class="mcc-events-list">${logHTML}</div>
      </div>
    </div>

    <!-- BOTTOM SUMMARY BAR removed — budget moved to left column -->
  `;
  if (m.vehicleId) setTimeout(() => missionBurnPreview(m.missionId), 0);
}

function missionRename(id, val) {
  const m = _missionGet(id);
  if (m) { m.name = val; missionRenderList(); }
}

function missionSetFleet(id, fleetId) {
  const m = _missionGet(id);
  if (!m) return;
  m.fleetEntryId = fleetId || null;
  if (fleetId) {
    const entry = _fleetGet(fleetId);
    if (entry) m.payloadScIds = [...(entry.payloads || [])];
  } else {
    m.payloadScIds = [];
  }
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

// ── PURE APPLIER: builds the launch vehicle, runs ascent staging, returns results.
// Does NOT push to m.log or set m.vehicleId — that is done by missionRecompute.
function _missionApplyLaunch(m) {
  const entry = _fleetGet(m.fleetEntryId);
  if (!entry) return null;

  const lvStages = progVehicleDefToLiveStages(entry);
  let scStages = [];
  for (const scId of m.payloadScIds) {
    const sc = _scEdSC.find(s => s.spacecraftId === scId);
    if (sc) scStages = scStages.concat(progSpacecraftToLiveStages(sc));
  }

  const allStages = [...lvStages, ...scStages];
  const ev = progMakeEvent('LAUNCH', {
    label:       m.name + ' — ' + entry.name,
    stages:      allStages,
    targetOrbit: { ...m.launchOrbit },
    color:       '#61afef',
  });
  const result = progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);

  // Ascent staging simulation: stage-by-stage dv delivery
  const fv = PROG_ACTIVE_PROGRAM.vehicles[result.vehicleId];
  if (!fv) return null;

  const dvRequired   = _missionDvToOrbit(m.launchOrbit.body, m.launchOrbit.alt_km);
  let   dvRemaining  = dvRequired;
  const stagingLog   = [];
  const stagesToDrop = [];

  for (let i = 0; i < fv.stages.length; i++) {
    const s = fv.stages[i];
    if ((s.isp || 0) <= 0) continue;
    const prop = progStageRemainingProp(s);
    if (prop <= 0) continue;

    const massAbove = fv.stages.slice(i + 1).reduce((sum, st) => sum + progStageMass(st), 0);
    const m_wet     = progStageMass(s) + massAbove;
    const dvAvail   = progRocketEqDv(m_wet, prop, s.isp);
    const sname     = _missionStageLabelById(s.stageDefinitionId);

    if (dvAvail >= dvRemaining) {
      // Insertion stage: partially burned
      const propNeeded = progRocketEqPropNeeded(m_wet, dvRemaining, s.isp);
      progBurnPropellant(s, propNeeded);
      stagingLog.push({ name: sname, propTotal: Math.round(prop), propBurned: Math.round(propNeeded), propRemaining: Math.round(prop - propNeeded), dvContrib: Math.round(dvRemaining), expended: false });
      dvRemaining = 0;
      break;
    } else {
      // Stage fully consumed
      progBurnPropellant(s, prop);
      stagingLog.push({ name: sname, propTotal: Math.round(prop), propBurned: Math.round(prop), propRemaining: 0, dvContrib: Math.round(dvAvail), expended: true });
      dvRemaining -= dvAvail;
      stagesToDrop.push(s.stageDefinitionId);
    }
  }

  fv.stages = fv.stages.filter(s => !stagesToDrop.includes(s.stageDefinitionId));

  const stagingResult = {
    dvRequired:  Math.round(dvRequired),
    dvDelivered: Math.round(dvRequired - Math.max(dvRemaining, 0)),
    status:      dvRemaining <= 0 ? 'SUCCESS' : 'MARGINAL',
    stages:      stagingLog,
  };

  const payloadMass = m.payloadScIds.reduce((s, scId) => s + _fleetScMassById(scId), 0);
  const payloadNames = m.payloadScIds.map(scId => _scEdSC.find(s => s.spacecraftId === scId)?.name).filter(Boolean);

  return { fv, stagingResult, payloadMass, payloadNames };
}

function missionExecLaunch(id) {
  const m = _missionGet(id);
  if (!m || !m.fleetEntryId) return;
  const entry = _fleetGet(m.fleetEntryId);
  if (!entry) return;
  m.log.push({ type: 'LAUNCH', label: entry.name, orbit: { ...m.launchOrbit } });
  _missionAddEvt = null;
  _missionViewMode = 'nodemap';
  missionRecompute(m);
  missionRenderDetail();
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

function _missionLogCardHTML(entry) {
  if (entry.type === 'BURN')     return _missionBurnLogCardHTML(entry);
  if (entry.type === 'SEPARATE') return _missionSeparateLogCardHTML(entry);
  if (entry.type === 'DOCK')     return _missionDockLogCardHTML(entry);
  if (entry.type === 'MANEUVER') return _missionManeuverLogCardHTML(entry);
  if (entry.type === 'EXPEND') return `<div class="mission-log-card" style="padding:8px 14px;display:flex;align-items:center;gap:8px;">
    <span class="mission-log-type">EXPEND</span>
    <span style="font-family:var(--mono);font-size:11px;color:var(--text-bright)">${entry.vehicleLevel ? entry.vehicleName : entry.stageName}</span>
    <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-left:auto">${entry.vehicleLevel ? 'vehicle expended' : 'stage dropped'}</span>
  </div>`;
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
    </div>
    ${(entry.payloadNames || []).length ? `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px;">Payloads: ${payStr}</div>` : ''}
    ${stageRows ? `<table class="sc-dv-tbl" style="width:100%"><thead><tr>
      <th>Stage</th><th style="text-align:right">Prop Used (kg)</th><th style="text-align:right">&#916;V (m/s)</th><th>Ascent Status</th>
    </tr></thead><tbody>${stageRows}</tbody></table>
    <div style="display:flex;justify-content:flex-end;align-items:baseline;gap:16px;margin-top:10px;padding-top:8px;border-top:1px solid var(--border);flex-wrap:wrap;">
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);letter-spacing:.1em;text-transform:uppercase;">Required &#916;V</span>
      <span style="font-family:var(--mono);font-size:16px;color:var(--text-bright)">${(sr.dvRequired||0).toLocaleString()} m/s</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);letter-spacing:.1em;text-transform:uppercase;">Delivered</span>
      <span style="font-family:var(--mono);font-size:16px;color:${sc}">${(sr.dvDelivered||0).toLocaleString()} m/s</span>
    </div>` : ''}
  </div>`;
}



function missionDeleteEvent(id, idx) {
  const m = _missionGet(id); if (!m) return;
  if (m.log[idx] && m.log[idx].type === 'LAUNCH') {
    m.log = []; m.vehicleId = null; m.vehicleIds = [];
  } else {
    m.log.splice(idx, 1);
  }
  _missionSelEvt = null;
  missionRecompute(m);
  missionRenderDetail();
}

function missionSelectEvent(id, idx) {
  _missionSelEvt = (_missionSelEvt === idx ? null : idx);
  missionRenderDetail();
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
  } else if (e.type === 'MANEUVER') {
    fields = `<div class="mission-state-kv"><span class="mission-state-key">Route</span><span class="mission-state-val">${e.fromLabel||''} → ${e.toLabel||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">ΔV</span><span class="mission-state-val">${e.dv!=null?e.dv.toLocaleString()+' m/s':'n/a'}</span></div>`;
  } else if (e.type === 'SEPARATE') {
    fields = `<div class="mission-state-kv"><span class="mission-state-key">From</span><span class="mission-state-val">${e.parentName||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Lower</span><span class="mission-state-val">${e.lowerName||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Upper</span><span class="mission-state-val">${e.upperName||''}</span></div>`;
  } else if (e.type === 'DOCK') {
    fields = `<div class="mission-state-kv"><span class="mission-state-key">Vehicle A</span><span class="mission-state-val">${e.aName||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Vehicle B</span><span class="mission-state-val">${e.tName||''}</span></div>
      <div class="mission-state-kv"><span class="mission-state-key">Merged</span><span class="mission-state-val">${e.mergedName||''}</span></div>`;
  } else if (e.type === 'EXPEND') {
    fields = `<div class="mission-state-kv"><span class="mission-state-key">Name</span><span class="mission-state-val">${e.vehicleName || e.stageName || ''}</span></div>`;
  }

  const isBurn = e.type === 'BURN';
  const editForm = isBurn ? `
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
      </div>` : '';

  return `<div class="mcc-section-header">EVENT DETAIL</div>
    <div class="mcc-panel-pad">
      <div style="font-family:var(--mono);font-size:10px;color:var(--accent);margin-bottom:8px;">${e.type}</div>
      <div class="mission-state-grid">${fields}</div>
      ${editForm}
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button class="act-btn" onclick="missionDeleteEvent('${id}',${idx})">Delete Event</button>
        <button class="act-btn" onclick="missionSelectEvent('${id}',${idx})">Close</button>
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
    } else if (e.type === 'BURN') {
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

// ── RECOMPUTE ENGINE: tear down & replay the full mission log from scratch ──
function missionRecompute(m) {
  if (!m || typeof PROG_ACTIVE_PROGRAM === 'undefined') return;
  // tear down this mission's runtime vehicles
  (m.vehicleIds || []).forEach(vid => { if (PROG_ACTIVE_PROGRAM.vehicles[vid]) delete PROG_ACTIVE_PROGRAM.vehicles[vid]; });
  m.vehicleIds = []; m.vehicleId = null;
  let active = null;   // current active runtime FlightVehicle
  let live = [];       // all live runtime FlightVehicles for this mission

  for (const e of m.log) {
    if (e.type === 'LAUNCH') {
      const r = _missionApplyLaunch(m);
      if (!r || !r.fv) { e.result = 'FAILED'; continue; }
      e.vehicleId = r.fv.vehicleId; e.stagingResult = r.stagingResult;
      e.payloadMass = r.payloadMass; e.payloadNames = r.payloadNames;
      active = r.fv; live = [r.fv];
    } else if (e.type === 'BURN') {
      if (!active) continue;
      e.vehicleId = active.vehicleId;
      const res = _missionApplyBurn(active, e.burnType, e.burnParam, e.stageId);
      e.dvTarget = res.dvTarget; e.dv_actual = res.dv_actual; e.prop_consumed = res.prop_consumed;
      e.burnLabel = res.burnLabel; e.result = res.result;
      e.orbitAfter = active.orbitState ? { ...active.orbitState } : null;
    } else if (e.type === 'MANEUVER') {
      if (active) e.vehicleId = active.vehicleId;
      const r = progNmComputeEdgeDv(e.fromNode, e.toNode); if (r) e.dv = Math.round(r.dv);
    } else if (e.type === 'SEPARATE' && e.result === 'SUCCESS') {
      if (!active) continue;
      const ev = progMakeEvent('SEPARATE', { vehicleId: active.vehicleId, separationIndex: e.sepIndex });
      const res = progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);
      if (res.result === 'SUCCESS') {
        const lower = PROG_ACTIVE_PROGRAM.vehicles[res.lowerVehicleId];
        const upper = PROG_ACTIVE_PROGRAM.vehicles[res.upperVehicleId];
        e.parentVehicleId = active.vehicleId; e.lowerVehicleId = res.lowerVehicleId; e.upperVehicleId = res.upperVehicleId;
        e.lowerName = lower ? lower.name : '?'; e.upperName = upper ? upper.name : '?';
        e.lowerStages = lower ? lower.stages.length : 0; e.upperStages = upper ? upper.stages.length : 0;
        live = live.filter(v => v !== active); if (lower) live.push(lower); if (upper) live.push(upper);
        active = upper || lower || null;
      }
    } else if (e.type === 'DOCK' && e.result === 'SUCCESS') {
      const target = live.find(v => v !== active && v.name === e.tName);
      if (active && target) {
        const ev = progMakeEvent('DOCK', { vehicleIds: [active.vehicleId, target.vehicleId], bottomVehicleId: target.vehicleId });
        const res = progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);
        if (res.result === 'SUCCESS') {
          const merged = PROG_ACTIVE_PROGRAM.vehicles[res.vehicleId];
          e.aVehId = active.vehicleId; e.tVehId = target.vehicleId; e.mergedVehicleId = res.vehicleId;
          e.mergedName = merged ? merged.name : '?'; e.mergedStages = merged ? merged.stages.length : 0;
          live = live.filter(v => v !== active && v !== target); if (merged) live.push(merged);
          active = merged || null;
        }
      }
    } else if (e.type === 'EXPEND') {
      const tgt = live.find(v => v.name === (e.vehicleName || e.stageName)) || active;
      if (tgt) { tgt.status = 'EXPENDED'; e.vehicleId = tgt.vehicleId; if (active === tgt) active = live.find(v => v !== tgt && v.status !== 'EXPENDED') || tgt; }
    }
  }
  m.vehicleIds = live.map(v => v.vehicleId);
  m.vehicleId = active ? active.vehicleId : (m.vehicleIds[0] || null);
}

function missionExecBurn(id) {
  const m = _missionGet(id);
  if (!m || !m.vehicleId) return;
  const fv  = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId];
  if (!fv)  return;
  const bt   = document.getElementById('burn-type-' + id)?.value || 'HOHMANN';
  const pval = parseFloat(document.getElementById('burn-param-val-' + id)?.value) || 0;
  const stageId = document.getElementById('burn-stage-' + id)?.value || null;
  m.log.push({ type: 'BURN', burnType: bt, burnParam: pval, stageId });
  _missionAddEvt = null;
  _missionViewMode = 'nodemap';
  missionRecompute(m);
  missionRenderDetail();
}

function missionApplyBurnEdit(id, idx) {
  const m = _missionGet(id); if(!m) return;
  const e = m.log[idx]; if(!e || e.type!=='BURN') return;
  const bt = document.getElementById('edit-burn-type-'+id)?.value || e.burnType;
  const pval = parseFloat(document.getElementById('edit-burn-param-'+id)?.value) || 0;
  e.burnType = bt; e.burnParam = pval;
  _missionSelEvt = null;
  missionRecompute(m);
  missionRenderDetail();
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
  m.log.push({ type: 'SEPARATE', result: 'SUCCESS', sepIndex: idx, parentName: fv.name });
  _missionAddEvt = null;
  _missionViewMode = 'nodemap';
  missionRecompute(m);
  missionRenderDetail();
}

function missionExecDock(id, targetVehId) {
  const m = _missionGet(id);
  if (!m || !m.vehicleId || !targetVehId) return;
  const activeFV = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId];
  const targetFV = PROG_ACTIVE_PROGRAM.vehicles[targetVehId];
  if (!activeFV || !targetFV) return;
  const aName = activeFV.name, tName = targetFV.name;
  const ev = progMakeEvent('DOCK', { vehicleIds: [m.vehicleId, targetVehId], bottomVehicleId: targetVehId });
  const res = progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);
  if (res.result !== 'SUCCESS') {
    m.log.push({ type: 'DOCK', result: 'FAILED', warnings: ev.warnings || [], aName, tName });
    missionRenderDetail();
    return;
  }
  m.log.push({ type: 'DOCK', result: 'SUCCESS', aName, tName });
  _missionAddEvt = null;
  _missionViewMode = 'nodemap';
  missionRecompute(m);
  missionRenderDetail();
}

function missionExecExpendVehicle(id, vehId) {
  const m = _missionGet(id);
  if (!m || !vehId) return;
  const fv = PROG_ACTIVE_PROGRAM.vehicles[vehId];
  if (!fv) return;
  m.log.push({ type: 'EXPEND', vehicleLevel: true, vehicleName: fv.name });
  _missionAddEvt = null;
  _missionViewMode = 'nodemap';
  missionRecompute(m);
  missionRenderDetail();
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
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-top:4px;">
      ${entry.lowerName} (${entry.lowerStages} stages) &nbsp;|&nbsp; ${entry.upperName} (${entry.upperStages} stages)
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
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto">${entry.aName} + ${entry.tName}</span></div>
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-top:4px;">${entry.mergedName} (${entry.mergedStages} stages)</div>
    ${notes}
  </div>`;
}

function _missionMultiVehicleHTML(m) {
  const live = _missionLiveVehicles(m);
  if (!live.length) return '';
  const id = m.missionId;
  const activeFV = PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId];

  const rows = live.map(({ id: vid, fv }) => {
    const isActive = vid === m.vehicleId;
    const expended = fv.status === 'EXPENDED';
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};margin-bottom:4px;background:${isActive ? 'var(--input)' : 'transparent'};">
      <button class="act-btn" style="padding:2px 8px;font-size:10px;${isActive ? 'background:var(--accent);color:#000;' : ''}" onclick="missionSetActiveVehicle('${id}','${vid}')">${isActive ? '● active' : 'select'}</button>
      <span style="font-family:var(--mono);font-size:11px;color:var(--text-bright)">${fv.name}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${fv.stages.length} stages</span>
      ${expended ? '<span style="font-family:var(--mono);font-size:9px;color:var(--error,#e06c75)">EXPENDED</span>' : ''}
      <button class="act-btn" style="padding:2px 8px;font-size:10px;margin-left:auto;" onclick="missionExecExpendVehicle('${id}','${vid}')"${expended ? ' disabled' : ''}>Expend</button>
    </div>`;
  }).join('');

  let sepHTML = '';
  if (activeFV && activeFV.stages.length >= 2 && activeFV.status !== 'EXPENDED') {
    const opts = [];
    for (let i = 1; i < activeFV.stages.length; i++) {
      opts.push(`<option value="${i}">${_missionStageLabelById(activeFV.stages[i].stageDefinitionId)}</option>`);
    }
    sepHTML = `<div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
      <select id="mission-sep-idx-${id}" style="background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:10px;padding:4px 8px;">${opts.join('')}</select>
      <button class="act-btn" style="padding:5px 14px;" onclick="missionExecSeparate('${id}', document.getElementById('mission-sep-idx-${id}').value)">⇕ Separate</button>
    </div>`;
  }

  let dockHTML = '';
  const targets = live.filter(x => x.id !== m.vehicleId && x.fv.status !== 'EXPENDED');
  if (activeFV && activeFV.status !== 'EXPENDED' && targets.length) {
    const opts = targets.map(x => {
      const match = activeFV.orbitState && x.fv.orbitState && progOrbitalStateMatch(activeFV.orbitState, x.fv.orbitState);
      return `<option value="${x.id}">${x.fv.name}${match ? ' ✓ orbit match' : ' ✗ orbit mismatch'}</option>`;
    }).join('');
    dockHTML = `<div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
      <select id="mission-dock-tgt-${id}" style="background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:10px;padding:4px 8px;">${opts}</select>
      <button class="act-btn" style="padding:5px 14px;" onclick="missionExecDock('${id}', document.getElementById('mission-dock-tgt-${id}').value)">⊕ Dock</button>
    </div>`;
  }

  return `<div class="mcc-section-header">Vehicles &amp; Multi-Vehicle Ops</div>
    <div class="panel" style="padding:10px 12px;">
      ${rows}
      ${sepHTML}
      ${dockHTML}
    </div>`;
}

// ── Step 4: node-map view + MANEUVER events ───────────────────────────────────

function missionSetView(id, mode) {
  _missionViewMode  = mode;
  _missionBridgeMode = false;
  _missionBridgeFrom = null;
  missionRenderDetail();
}

function missionToggleBridgeMode(id) {
  _missionBridgeMode = !_missionBridgeMode;
  _missionBridgeFrom = null;
  missionRenderDetail();
}

// Map a mission's launch orbit to the nearest canonical node id.
function _missionNodeForLaunch(m) {
  const o = m.launchOrbit || {};
  return _progNmVehicleNode({ orbitState: { body: o.body, perigee: o.alt_km, apogee: o.alt_km } });
}

// Ordered list of node ids the mission traverses: launch node, then each MANEUVER destination.
function _missionNodePath(m) {
  const path = [];
  if (m.log.some(e => e.type === 'LAUNCH')) path.push(_missionNodeForLaunch(m));
  for (const e of m.log) if (e.type === 'MANEUVER' && e.toNode) path.push(e.toNode);
  return path;
}

function missionExecManeuver(id, fromId, toId) {
  const m = _missionGet(id);
  if (!m || !fromId || !toId || fromId === toId) return;
  const res = progNmComputeEdgeDv(fromId, toId);
  const lbl = nid => { const n = PROG_NM_NODES.find(x => x.id === nid); return n ? (n.sub ? n.label + ' (' + n.sub + ')' : n.label) : nid; };
  m.log.push({
    type: 'MANEUVER',
    fromNode: fromId, toNode: toId,
    fromLabel: lbl(fromId), toLabel: lbl(toId),
    note:   res ? res.note : 'No transfer model for this pair',
    method: res ? res.method : null,
  });
  _missionBridgeMode = false;
  _missionBridgeFrom = null;
  _missionAddEvt = null;
  _missionViewMode = 'nodemap';
  missionRecompute(m);
  missionRenderDetail();
}

function missionNodeClick(id, nodeId) {
  const m = _missionGet(id);
  if (!m) return;
  if (_missionBridgeMode) {
    if (!_missionBridgeFrom)        { _missionBridgeFrom = nodeId; missionRenderDetail(); return; }
    if (_missionBridgeFrom === nodeId) { _missionBridgeFrom = null; missionRenderDetail(); return; }
    missionExecManeuver(id, _missionBridgeFrom, nodeId);
    return;
  }
  // Not drawing — jump to the most recent event that lands on this node.
  let target = -1;
  m.log.forEach((e, i) => { if (e.type === 'MANEUVER' && e.toNode === nodeId) target = i; });
  if (target < 0 && nodeId === _missionNodeForLaunch(m)) m.log.forEach((e, i) => { if (e.type === 'LAUNCH') target = i; });
  if (target >= 0) {
    const tid = 'mlog-' + id + '-' + target;
    setTimeout(() => {
      const el = document.getElementById(tid);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '2px solid var(--accent)'; setTimeout(() => { el.style.outline = ''; }, 1500); }
    }, 60);
  }
}

function _missionManeuverLogCardHTML(entry) {
  const stateKV = (k, v) => `<div class="mission-state-kv"><span class="mission-state-key">${k}</span><span class="mission-state-val">${v}</span></div>`;
  const statusChip = entry.dv != null
    ? `<span style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;padding:1px 6px;border:1px solid var(--accent3);color:var(--accent3)">computed</span>`
    : `<span style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;padding:1px 6px;border:1px solid var(--accent2);color:var(--accent2)">no model</span>`;
  const dvDisplay = entry.dv != null
    ? stateKV('ΔV', `<span style="color:var(--accent3)">${entry.dv.toLocaleString()} m/s</span>`)
    : `<div style="color:var(--accent2);font-family:var(--mono);font-size:10px;padding:4px 0;">${entry.note}</div>`;
  const methodDisplay = entry.method ? stateKV('Method', entry.method) : '';
  const noteDisplay = entry.note ? `<div style="color:var(--text-dim);font-family:var(--mono);font-size:9px;margin-top:4px;">${entry.note}</div>` : '';
  return `<div class="mission-log-card">
    <div class="mission-log-header">
      <span class="mission-log-type">MANEUVER</span>
      ${statusChip}
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto">${entry.fromLabel} → ${entry.toLabel}</span>
    </div>
    <div class="mission-state-grid">
      ${dvDisplay}
      ${methodDisplay}
    </div>
    ${noteDisplay}
  </div>`;
}

// ── Band view data model (event-based) ──────────────────────────────────────
function _missionAltToYFrac(alt) {
  const a = Math.max(0, alt || 0);
  return Math.max(0, Math.min(1, Math.log10(a + 1) / Math.log10(500000)));
}

// Build {events, lanes} from m.log. X is event index; lanes track vehicles through
// LAUNCH / BURN / MANEUVER / SEPARATE (split) / DOCK (merge) / EXPEND (end).
function _missionBandModel(m) {
  const palette = ['#61afef','#e5c07b','#98c379','#c678dd','#56b6c2','#e06c75','#d19a66'];
  const lanes = new Map();
  let colorIdx = 0;
  const altOf = os => os ? (((os.apogee ?? os.alt_km ?? 0) + (os.perigee ?? os.apogee ?? os.alt_km ?? 0)) / 2) : 0;
  const nodeAlt = nid => {
    if (typeof PROG_NM_NODES === 'undefined') return 0;
    const n = PROG_NM_NODES.find(x => x.id === nid);
    if (!n || !n.orbit) return 0;
    const o = n.orbit;
    if (o.type === 'surface') return 0;
    if (o.type === 'escape' || o.type === 'transit') return 500000;
    return ((o.apogee ?? o.perigee ?? 0) + (o.perigee ?? o.apogee ?? 0)) / 2;
  };
  const ensure = (vid, name, startIdx) => {
    if (!vid) return null;
    if (!lanes.has(vid)) lanes.set(vid, { vehicleId: vid, name: name || vid, color: palette[colorIdx++ % palette.length], startIndex: startIdx, endIndex: null, expended: false, points: [] });
    return lanes.get(vid);
  };
  const lastAlt = vid => { const L = lanes.get(vid); return (L && L.points.length) ? L.points[L.points.length - 1].alt : 0; };
  const addPt = (vid, idx, alt) => { const L = lanes.get(vid); if (L) L.points.push({ index: idx, alt }); };
  const events = [];
  m.log.forEach((e, i) => {
    let vid = e.vehicleId, label = e.type;
    if (e.type === 'LAUNCH') { const alt = e.orbit?.alt_km ?? 0; ensure(e.vehicleId, 'LV', i); addPt(e.vehicleId, i, alt); label = 'LAUNCH'; }
    else if (e.type === 'BURN') { ensure(e.vehicleId, 'Vehicle', i); addPt(e.vehicleId, i, altOf(e.orbitAfter)); label = e.burnLabel || 'BURN'; }
    else if (e.type === 'MANEUVER') { ensure(e.vehicleId, 'Vehicle', i); addPt(e.vehicleId, i, nodeAlt(e.toNode)); label = '→ ' + (e.toLabel || e.toNode || ''); }
    else if (e.type === 'SEPARATE' && e.result === 'SUCCESS') {
      const pa = lastAlt(e.parentVehicleId);
      const p = lanes.get(e.parentVehicleId); if (p) p.endIndex = i;
      ensure(e.lowerVehicleId, e.lowerName, i); ensure(e.upperVehicleId, e.upperName, i);
      addPt(e.lowerVehicleId, i, pa); addPt(e.upperVehicleId, i, pa);
      vid = e.upperVehicleId; label = 'SEPARATE';
    }
    else if (e.type === 'DOCK' && e.result === 'SUCCESS') {
      const aa = lastAlt(e.aVehId);
      const a = lanes.get(e.aVehId); if (a) a.endIndex = i;
      const t = lanes.get(e.tVehId); if (t) t.endIndex = i;
      ensure(e.mergedVehicleId, e.mergedName, i); addPt(e.mergedVehicleId, i, aa);
      vid = e.mergedVehicleId; label = 'DOCK';
    }
    else if (e.type === 'EXPEND') { if (e.vehicleId) { const L = lanes.get(e.vehicleId); if (L) { L.expended = true; L.endIndex = i; } } label = 'EXPEND'; }
    events.push({ index: i, type: e.type, vehicleId: vid, label });
  });
  return { events, lanes: [...lanes.values()], count: m.log.length };
}

function missionBandScrubTo(id, idx) {
  _missionBandScrub = (idx == null ? null : +idx);
  missionRenderDetail();
}

// ── Band view SVG renderer ─────────────────────────────────────────────────
function missionSetAddEvt(id, type) {
  _missionAddEvt = (type === _missionAddEvt) ? null : type;
  if (_missionAddEvt && _missionAddEvt !== '__menu__') _missionViewMode = 'nodemap';
  missionRenderDetail();
}

function _missionAddEventHTML(m) {
  const id = m.missionId;
  if (_missionAddEvt == null) {
    return `<button class="act-btn" style="width:100%;" onclick="missionSetAddEvt('${id}','__menu__')">＋ Add Event</button>`;
  }
  const types = [['burn','Burn'],['maneuver','Maneuver'],['separate','Separate'],['dock','Dock'],['expend','Expend']];
  const typeBtns = types.map(([t,label]) =>
    `<button class="act-btn" style="padding:3px 8px;font-size:10px;${_missionAddEvt===t?'background:var(--accent);color:#000;':''}" onclick="missionSetAddEvt('${id}','${t}')">${label}</button>`
  ).join('');
  const header = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
      <button class="act-btn" style="padding:3px 8px;font-size:10px;background:var(--accent);color:#000;" onclick="missionSetAddEvt('${id}',null)">✕ Close</button>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);letter-spacing:.1em;">ADD EVENT</span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">${typeBtns}</div>`;
  const live = (typeof _missionLiveVehicles === 'function') ? _missionLiveVehicles(m) : [];
  let vehSel = '';
  if (live.length > 1) {
    const opts = live.map(x => `<option value="${x.id}"${x.id===m.vehicleId?' selected':''}>${x.fv.name}</option>`).join('');
    vehSel = `<div style="margin-bottom:8px;"><label class="cfg-label">Active Vehicle</label>
      <select class="mcc-field-select" onchange="missionSetActiveVehicle('${id}',this.value)">${opts}</select></div>`;
  }
  let form = '';
  const fv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  if (_missionAddEvt === '__menu__') {
    form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// pick an event type above</div>`;
  } else if (_missionAddEvt === 'burn') {
    form = _missionBurnSectionHTML(m);
  } else if (_missionAddEvt === 'separate') {
    if (fv && fv.stages.length >= 2) {
      let o=''; for (let i=1;i<fv.stages.length;i++) o+=`<option value="${i}">${_missionStageLabelById(fv.stages[i].stageDefinitionId)}</option>`;
      form = `<select id="addev-sep-${id}" class="mcc-field-select" style="margin-bottom:6px;">${o}</select>
        <button class="act-btn" style="width:100%;" onclick="missionExecSeparate('${id}',document.getElementById('addev-sep-${id}').value)">⇕ Separate</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// active vehicle needs ≥ 2 stages</div>`;
  } else if (_missionAddEvt === 'dock') {
    const targets = live.filter(x => x.id !== m.vehicleId && x.fv.status !== 'EXPENDED');
    if (targets.length) {
      const o = targets.map(x=>`<option value="${x.id}">${x.fv.name}</option>`).join('');
      form = `<select id="addev-dock-${id}" class="mcc-field-select" style="margin-bottom:6px;">${o}</select>
        <button class="act-btn" style="width:100%;" onclick="missionExecDock('${id}',document.getElementById('addev-dock-${id}').value)">⊕ Dock</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// need another live vehicle to dock with</div>`;
  } else if (_missionAddEvt === 'expend') {
    if (live.length) {
      const o = live.map(x=>`<option value="${x.id}">${x.fv.name}${x.fv.status==='EXPENDED'?' (expended)':''}</option>`).join('');
      form = `<select id="addev-exp-${id}" class="mcc-field-select" style="margin-bottom:6px;">${o}</select>
        <button class="act-btn" style="width:100%;" onclick="missionExecExpendVehicle('${id}',document.getElementById('addev-exp-${id}').value)">Expend Vehicle</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// no vehicles yet</div>`;
  } else if (_missionAddEvt === 'maneuver') {
    const nodes = (typeof PROG_NM_NODES !== 'undefined') ? PROG_NM_NODES : [];
    const o = nodes.map(n=>`<option value="${n.id}">${n.label}${n.sub?' ('+n.sub+')':''}</option>`).join('');
    form = `<label class="cfg-label">From</label><select id="addev-mvf-${id}" class="mcc-field-select" style="margin-bottom:6px;">${o}</select>
      <label class="cfg-label">To</label><select id="addev-mvt-${id}" class="mcc-field-select" style="margin-bottom:6px;">${o}</select>
      <button class="act-btn" style="width:100%;" onclick="missionExecManeuver('${id}',document.getElementById('addev-mvf-${id}').value,document.getElementById('addev-mvt-${id}').value)">Add Maneuver</button>
      <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:5px;">// or draw a bridge on the Node Map</div>`;
  }
  return `${header}${(_missionAddEvt!=='__menu__'&&_missionAddEvt!=='burn')?vehSel:''}${form}`;
}

function _missionBandViewHTML(m) {
  const model = _missionBandModel(m);
  const id = m.missionId;

  if (model.count === 0) {
    return '<div style="display:flex;align-items:center;justify-content:center;height:200px;font-family:var(--mono);font-size:11px;color:var(--text-dim);">// No events yet — execute a LAUNCH to populate the band view.</div>';
  }

  const leftPad = 70, rightPad = 60, topPad = 20, botPad = 40;
  const plotW = 1000 - leftPad - rightPad;
  const plotH = 460 - topPad - botPad;
  const maxI = Math.max(model.count - 1, 1);
  const X = i => leftPad + (i / maxI) * plotW;
  const Y = alt => topPad + (1 - _missionAltToYFrac(alt)) * plotH;

  // altitude gridlines
  const gridAlts = [
    { label: 'Surface (0)', alt: 0 },
    { label: 'LEO (185)', alt: 185 },
    { label: 'GEO (35786)', alt: 35786 },
    { label: 'Escape (500000)', alt: 500000 }
  ];
  let gridHTML = '';
  for (const g of gridAlts) {
    const gy = Y(g.alt);
    gridHTML += `<line x1="${leftPad}" y1="${gy}" x2="${leftPad + plotW}" y2="${gy}" stroke="var(--border)" stroke-opacity="0.4" stroke-width="1"/>`;
    gridHTML += `<text x="${leftPad - 6}" y="${gy + 3}" text-anchor="end" font-family="var(--mono)" font-size="8px" fill="var(--text-dim)">${g.label}</text>`;
  }

  const scrub = _missionBandScrub == null ? (model.count - 1) : _missionBandScrub;

  // per-event invisible hit rects for scrubbing
  const rectW = plotW / model.count;
  let scrubRectsHTML = '';
  for (let i = 0; i < model.count; i++) {
    scrubRectsHTML += `<rect x="${X(i) - rectW / 2}" y="${topPad}" width="${rectW}" height="${plotH}" fill="transparent" style="cursor:pointer" onclick="missionBandScrubTo('${id}',${i})"/>`;
  }

  // lanes
  let lanesHTML = '';
  for (const lane of model.lanes) {
    if (lane.points.length === 0) continue;

    // polyline
    if (lane.points.length === 1) {
      const px = X(lane.points[0].index);
      const py = Y(lane.points[0].alt);
      lanesHTML += `<line x1="${px - 8}" y1="${py}" x2="${px + 8}" y2="${py}" stroke="${lane.color}" stroke-width="2.5"/>`;
    } else {
      const polyPoints = lane.points.map(pt => X(pt.index) + ',' + Y(pt.alt)).join(' ');
      lanesHTML += `<polyline points="${polyPoints}" stroke="${lane.color}" stroke-width="2.5" fill="none"/>`;
    }

    // event circles
    for (const pt of lane.points) {
      const ev = model.events[pt.index];
      const lbl = ev ? ev.label : '';
      lanesHTML += `<circle cx="${X(pt.index)}" cy="${Y(pt.alt)}" r="5" fill="${lane.color}" stroke="var(--input)" stroke-width="1" style="cursor:pointer" onclick="missionBandScrubTo('${id}',${pt.index})"><title>${lbl}</title></circle>`;
    }

    // "+" affordance for live lanes
    if (lane.endIndex === null && !lane.expended && lane.points.length > 0) {
      const lastPt = lane.points[lane.points.length - 1];
      const plusX = X(lastPt.index) + 22;
      const plusY = Y(lastPt.alt);
      lanesHTML += `<circle cx="${plusX}" cy="${plusY}" r="10" fill="var(--input)" stroke="${lane.color}" stroke-width="1.5" style="cursor:pointer" onclick="missionSetActiveVehicle('${id}','${lane.vehicleId}');missionSetAddEvt('${id}','__menu__')"><title>Add event to ${lane.name}</title></circle>`;
      lanesHTML += `<text x="${plusX}" y="${plusY + 4}" text-anchor="middle" font-family="var(--mono)" font-size="13" font-weight="bold" fill="${lane.color}" style="cursor:pointer;pointer-events:none">+</text>`;
    }
  }

  // scrubber line + triangle + label
  const scrubX = X(scrub);
  let scrubberHTML = '';
  scrubberHTML += `<line x1="${scrubX}" y1="${topPad}" x2="${scrubX}" y2="${topPad + plotH}" stroke="var(--accent)" stroke-width="1.5" opacity="0.8"/>`;
  scrubberHTML += `<polygon points="${scrubX - 5},${topPad} ${scrubX + 5},${topPad} ${scrubX},${topPad - 6}" fill="var(--accent)" opacity="0.8"/>`;
  const scrubEv = model.events[scrub];
  scrubberHTML += `<text x="${scrubX}" y="${topPad - 10}" text-anchor="middle" font-family="var(--mono)" font-size="8px" fill="var(--accent)">${scrubEv ? scrubEv.label : ''}</text>`;

  // lane legend
  let legendHTML = '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px;align-items:center;">';
  for (const lane of model.lanes) {
    const dimmed = lane.expended;
    legendHTML += `<span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:9px;color:${dimmed ? 'var(--text-dim)' : 'var(--text-bright)'};opacity:${dimmed ? '0.5' : '1'}"><span style="display:inline-block;width:8px;height:8px;background:${lane.color};border-radius:2px;"></span>${lane.name}${dimmed ? ' (expended)' : ''}</span>`;
  }
  legendHTML += '</div>';

  // ΔV/PROP monitor box
  let monitorHTML = '';
  const scrubbedVehId = model.events[scrub]?.vehicleId;
  if (scrubbedVehId && PROG_ACTIVE_PROGRAM.vehicles[scrubbedVehId]) {
    const fv = PROG_ACTIVE_PROGRAM.vehicles[scrubbedVehId];
    const remDv = Math.round(_missionVehicleRemainingDv(fv)).toLocaleString();
    const remProp = Math.round(fv.stages.reduce((s, st) => s + progStageRemainingProp(st), 0)).toLocaleString();
    monitorHTML = `<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);font-family:var(--mono);font-size:10px;color:var(--text-dim);">
      <div style="color:var(--text-bright);font-size:11px;margin-bottom:4px;">${fv.name}</div>
      <div>Remaining ΔV: <span style="color:var(--accent)">${remDv} m/s</span></div>
      <div>Remaining Prop: <span style="color:var(--accent)">${remProp} kg</span></div>
      <div style="font-size:8px;margin-top:3px;color:var(--text-dim);opacity:0.6;">Values reflect vehicle&rsquo;s CURRENT state (per-event history is a future enhancement).</div>
    </div>`;
  } else if (scrubbedVehId) {
    monitorHTML = `<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);font-family:var(--mono);font-size:10px;color:var(--text-dim);">// vehicle no longer active at this event</div>`;
  } else {
    monitorHTML = `<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);font-family:var(--mono);font-size:10px;color:var(--text-dim);">// vehicle no longer active at this event</div>`;
  }

  const svgHTML = `<svg viewBox="0 0 1000 460" style="width:100%;height:auto;border:1px solid var(--border);background:transparent;">${gridHTML}${scrubRectsHTML}${lanesHTML}${scrubberHTML}</svg>`;

  return `<div>${legendHTML}${svgHTML}${monitorHTML}</div>`;
}

function _missionNodeMapHTML(m) {
  const id = m.missionId;
  const path = _missionNodePath(m);
  const byId = {}; PROG_NM_NODES.forEach(n => byId[n.id] = n);

  // Planet geometry (1100x520 world) — matches the original node-map layout.
  const BLOBS = {
    Earth: { cx:195, cy:255, bodyR:26, soiR:210, col:'#5db877', surfId:'earth-surface' },
    Moon:  { cx:450, cy:192, bodyR:12, soiR:100, col:'#8890bc', surfId:'moon-surface'  },
    Mars:  { cx:860, cy:205, bodyR:18, soiR:115, col:'#b85848', surfId:'mars-surface'  },
    Venus: { cx:848, cy:380, bodyR:15, soiR:100, col:'#b85848', surfId:null            },
  };
  // Spread screen positions per node id (avoids the cramped-label overlap).
  const POS = {
    'earth-surface':[195,255], 'leo':[195,152], 'gto':[110,108], 'geo':[285,99], 'escape':[195,62],
    'tlc':[352,244], 'llo':[425,156], 'dro':[494,117], 'moon-surface':[450,192],
    'mars-transit':[655,244], 'mars-orbit':[860,129], 'mars-surface':[860,205],
    'venus-transit':[655,366], 'venus-orbit':[848,316],
  };
  const posOf = n => POS[n.id] || [n.cx || 0, n.cy || 0];

  // ── control bar (Draw Maneuver) ──
  let ctrlHTML = `<div class="sl" style="margin-top:8px;display:flex;align-items:center;gap:12px;">
    <button class="act-btn" style="${_missionBridgeMode ? 'background:var(--accent);color:#000;' : ''}" onclick="missionToggleBridgeMode('${id}')">＋ Draw Maneuver</button>`;
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

  // ── planet blobs: SOI glow layers + dashed SOI ring ──
  let blobsHTML = '';
  for (const k in BLOBS) {
    const b = BLOBS[k];
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR}" fill="${b.col}" fill-opacity="0.04"/>`;
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR * 0.72}" fill="${b.col}" fill-opacity="0.05"/>`;
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR * 0.44}" fill="${b.col}" fill-opacity="0.07"/>`;
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR}" fill="none" stroke="${b.col}" stroke-width="1" stroke-opacity="0.18" stroke-dasharray="4,5"/>`;
  }

  // ── mission-path edges ──
  let edgesHTML = '';
  for (let i = 0; i < path.length - 1; i++) {
    const a = byId[path[i]], c = byId[path[i + 1]];
    if (a && c) { const [ax, ay] = posOf(a), [cx, cy] = posOf(c);
      edgesHTML += `<line x1="${ax}" y1="${ay}" x2="${cx}" y2="${cy}" stroke="var(--accent)" stroke-width="2" opacity="0.8"/>`; }
  }

  // ── nodes ──
  let nodesHTML = '';
  for (const n of PROG_NM_NODES) {
    const [x, y] = posOf(n);
    const inPath    = path.includes(n.id);
    const isCurrent = path.length > 0 && path[path.length - 1] === n.id;
    const isFrom    = _missionBridgeFrom === n.id;
    const isSurface = n.orbit && n.orbit.type === 'surface';
    const blob = isSurface ? Object.values(BLOBS).find(b => b.surfId === n.id) : null;

    nodesHTML += `<g style="cursor:pointer" onclick="missionNodeClick('${id}','${n.id}')"><title>${n.label}${n.sub ? ' — ' + n.sub : ''}</title>`;
    if (isSurface && blob) {
      const stroke = isFrom ? 'var(--accent2)' : inPath ? 'var(--accent)' : blob.col;
      const sw = (isFrom || isCurrent) ? 3 : (inPath ? 2.5 : 1.6);
      nodesHTML += `<circle cx="${x}" cy="${y}" r="${blob.bodyR}" fill="${blob.col}" fill-opacity="0.5" stroke="${stroke}" stroke-width="${sw}"/>`;
      if (isCurrent) nodesHTML += `<circle cx="${x}" cy="${y}" r="${blob.bodyR + 5}" fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.5"/>`;
      nodesHTML += `<text x="${x}" y="${y + blob.bodyR + 11}" text-anchor="middle" font-family="var(--mono)" font-size="8px" font-weight="600" letter-spacing="1" fill="${blob.col}">${n.label}</text>`;
    } else {
      const r = n.r || 16;
      const stroke = isFrom ? 'var(--accent2)' : inPath ? 'var(--accent)' : 'var(--border-bright)';
      const sw = (isFrom || isCurrent) ? 3 : (inPath ? 2.5 : 1.5);
      const dash = n.dashed ? ' stroke-dasharray="4 3"' : '';
      const labelColor = inPath ? 'var(--text-bright)' : 'var(--text-dim)';
      nodesHTML += `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--input)" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
      if (isCurrent) nodesHTML += `<circle cx="${x}" cy="${y}" r="${r + 5}" fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.5"/>`;
      nodesHTML += `<text x="${x}" y="${y + 3}" text-anchor="middle" font-family="var(--mono)" font-size="9px" fill="${labelColor}">${n.label}</text>`;
    }
    nodesHTML += `</g>`;
  }

  const svgHTML = `<svg viewBox="0 0 1100 520" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;background:transparent;border:1px solid var(--border);">${blobsHTML}${edgesHTML}${nodesHTML}</svg>`;
  return `<div>${ctrlHTML}${svgHTML}</div>`;
}

function missionInit() {
  _missions  = [];
  _missionSel = null;
}

function progShowTab(tab) {
  const PANELS   = { spacecraft: 'prog-panel-sc', fleet: 'prog-panel-fleet', mission: 'prog-panel-mission' };
  const TOOLBARS = { spacecraft: 'prog-tb-sc',    fleet: 'prog-tb-fleet',    mission: 'prog-tb-mission'    };
  Object.entries(PANELS).forEach(([t, id]) => {
    const el = document.getElementById(id); if (el) el.style.display = t === tab ? 'flex' : 'none';
  });
  Object.entries(TOOLBARS).forEach(([t, id]) => {
    const el = document.getElementById(id); if (el) el.style.display = t === tab ? 'flex' : 'none';
  });
  const TABS = ['spacecraft', 'fleet', 'mission'];
  document.querySelectorAll('#prog-tabs button').forEach((b, i) => b.classList.toggle('active', TABS[i] === tab));
  if (tab === 'mission') {
    if (!_missions.length) { missionNew(); }            // auto-create the first mission so the command center is never blank
    else {
      if (!_missionGet(_missionSel)) _missionSel = _missions[0].missionId;  // auto-select if none selected
      missionRender();
    }
  }
}
