// ─────────────────────────────────────────────────────────────────────────────
// 570-mission-cards.js — Mission event-log cards + inline event editing UI
//
// OWNS: the event-log card dispatcher (_missionLogCardHTML) and the large inline
//   event editor (_missionEventEditFieldsHTML), plus event-list manipulation from
//   the cards: delete/move/reorder/select and the drag-reorder handlers
//   (missionDeleteEvent, missionMoveEvent, missionMoveEventToEnd, missionReorderEvent,
//   missionSelectEvent, missionEvtDragStart/Over/Leave/Drop).
// Note: per-type log-card renderers (_missionBurnLogCardHTML, _missionSeparateLogCardHTML,
//   etc.) and per-type edit appliers live in the manager remainder; this module
//   forward-references them (resolved at call time after all modules load).
// Does NOT own: replay (570-mission-replay.js), band/node-map views, or event execution.
// Split out of 570-mission-manager.js (behavior-preserving move). Definitions only
//   (no load-time execution); load order relative to the manager is immaterial.
// ─────────────────────────────────────────────────────────────────────────────

function _missionLogCardHTML(entry, id, idx) {
  if (entry.type === 'BURN')     return _missionBurnLogCardHTML(entry);
  if (entry.type === 'SEPARATE') return _missionSeparateLogCardHTML(entry);
  if (entry.type === 'DOCK')     return _missionDockLogCardHTML(entry);
  // Unified schema (R6.2' Phase B): a solved MNODE (mode:'solved', has a
  // target) renders through the SAME card as a legacy MANEUVER — the
  // predicate is the shim that keeps both forms indistinguishable to the UI.
  if (_evIsSolvedManeuver(entry)) return _missionManeuverLogCardHTML(entry, id, idx);
  if (entry.type === 'LOWTHRUST') return _missionLowThrustLogCardHTML(entry, id, idx);
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
  if (entry.type === 'MNODE') {
    // Manual burn (mode:'manual', or classic vector MNODE with no target at
    // all). A retained `target` means this was once (or can again be) a
    // solved maneuver — offer the mode-flip back.
    const tgt = entry.target;
    return `<div class="mission-log-card" style="padding:8px 14px;">
    <span class="mission-log-type">MANEUVER NODE (vector)</span>
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-top:4px;">Δv ${(entry.dvRequired||0).toLocaleString()} m/s <span style="color:var(--text-dim);">(pro ${Math.round(entry.dvPro_ms||0)} / rad ${Math.round(entry.dvRad_ms||0)} / nrm ${Math.round(entry.dvNrm_ms||0)})</span></div>
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:2px;">prop &minus;${(entry.prop_consumed||0).toLocaleString()} kg &middot; ${entry.result||''}</div>
    ${tgt ? `<div style="font-family:var(--mono);font-size:9px;color:var(--accent2);margin-top:4px;">detached — was solved ${_tsEsc(entry.fromLabel || tgt.fromLabel || tgt.fromNode || '?')} → ${_tsEsc(entry.toLabel || tgt.toLabel || tgt.toNode || '?')} · ΔV budget now uses this vector's authored magnitude, not the solved edge</div>
    <button class="act-btn" style="margin-top:6px;font-size:10px;" onclick="event.stopPropagation();missionMnodeResolveToTarget('${id}',${idx})">↺ Re-solve to target</button>` : ''}
    ${(() => { const t = _missionMnodeSettleLabel(id, idx); return t ? `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:4px;">settles: ${_tsEsc(t)}</div>` : ''; })()}
  </div>`;
  }
  if (entry.type === 'COAST') return `<div class="mission-log-card" style="padding:8px 14px;">
    <span class="mission-log-type">COAST</span>
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-top:4px;">${(entry.days||0).toLocaleString()} d${entry.label ? ' — ' + entry.label : ''}${entry.metStart!=null?` <span style="color:var(--text-dim);">&middot; ${_metFmt(entry.metStart)}</span>`:''}</div>
    ${entry.boiloffKg > 0 ? `<div style="font-family:var(--mono);font-size:9px;color:var(--accent2);margin-top:2px;">boiloff &minus;${Math.round(entry.boiloffKg).toLocaleString()} kg</div>` : ''}
  </div>`;
  if (entry.type === 'DEPLOY') {
    // §14 U3: propagated orbit (NRHO) has no alt_km/apo_km — honest label.
    const orbitVal = (entry.orbit && entry.orbit.propagated)
      ? 'NRHO (propagated)'
      : `${(entry.orbit&&entry.orbit.alt_km||0).toLocaleString()} km${entry.orbit&&entry.orbit.apo_km&&entry.orbit.apo_km!==entry.orbit.alt_km?' × '+entry.orbit.apo_km.toLocaleString():''}`;
    return `<div class="mission-log-card"><div class="mission-log-header"><span class="mission-log-type">DEPLOY</span><span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto">${entry.label||''}</span></div><div class="mission-state-grid"><div class="mission-state-kv"><span class="mission-state-key">Orbit</span><span class="mission-state-val">${orbitVal}</span></div><div class="mission-state-kv"><span class="mission-state-key">Body</span><span class="mission-state-val">${entry.orbit&&entry.orbit.body||'Earth'}</span></div></div></div>`;
  }
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
  // Trajectory-view scrubber integration (574): selecting an event from the
  // log list, same as selecting one by clicking the view directly, hands
  // view-time authority back to "state as of this event" — clear any
  // lingering manual scrub override so it doesn't silently out-rank this pick.
  if (typeof _trajViewTimeOverride !== 'undefined') delete _trajViewTimeOverride[id];
  // Selection stickiness fix (user-reported 2026-07-15): an event belongs to
  // a vehicle — selecting it should set/keep the active vehicle (m.vehicleId,
  // the R5 one-selection state that drives the "Vehicles & Mission State"
  // panel highlight AND the ring/leg emphasis in the trajectory view) as that
  // event's vehicle. Before this fix, clicking an event card left m.vehicleId
  // untouched at whatever it was — fine on its own, but combined with the
  // ring/leg emitters keying "emphasized" purely off the selected event's
  // authIdx (not vehicle identity), any UI that treated "no ring emphasized"
  // as "no vehicle selected" read this as the vehicle de-selecting. Resolve
  // the event's owning vehicle from its replay-time snapshot
  // (e.activeOriginKey, stamped in missionRecompute/570-mission-replay.js) to
  // the CURRENT live vehicle with that origin key, and adopt it. Never clears
  // m.vehicleId to null as a side effect — if the owner can't be resolved
  // (older data, non-vehicle event types), the previous selection is left in
  // place rather than dropped.
  const selEv = m.log[idx];
  const ownerKey = selEv && selEv.activeOriginKey;
  if (ownerKey && typeof PROG_ACTIVE_PROGRAM !== 'undefined' && PROG_ACTIVE_PROGRAM) {
    const vid = (m.vehicleIds || []).find(v => {
      const fv = PROG_ACTIVE_PROGRAM.vehicles[v];
      return fv && fv._originKey === ownerKey;
    });
    if (vid) m.vehicleId = vid;
  }
  missionRenderDetail();
}

// Inline editable-fields section for an expanded event card (replaces the old
// edit-pop-up modal). Appended below the read-only card detail
// (_missionLogCardHTML) when e._expanded is true. Types with nothing editable
// return '' here and the card just shows its existing detail.
function _missionEventEditFieldsHTML(m, idx) {
  if (idx == null) return '';
  const e = m.log[idx];
  if (!e) return '';
  const id = m.missionId;

  const _es = 'background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;';
  const _vehBefore = _missionVehiclesBeforeEvent(m, idx);
  const _vehOpt = (selKey, exclKey) => _vehBefore.filter(v => v.key !== exclKey)
    .map(v => `<option value="${v.key}"${v.key === selKey ? ' selected' : ''}>${v.name}</option>`).join('');
  // Round 2 item 2 (regression restore, R6.2.1): precision +/- nudge buttons,
  // hoisted so both the solved-maneuver branch (time only — dv components are
  // solver-owned display, see progNmComputeEdgeDv) and the manual MNODE
  // branch (all axes + time) can use them. Standard step 10 m/s / 60 s,
  // shift-click for the fine step (1 m/s / 10 s).
  const _nudgeBtn = (field, sign, glyph) => `<button type="button" class="act-btn" style="padding:2px 7px;font-size:11px;line-height:1;" title="Shift-click for fine step" onclick="event.stopPropagation();missionMnodeNudge('${id}',${idx},'${field}',${sign},event)">${glyph}</button>`;
  const _nudgeRow = (field) => `<div style="display:flex;gap:4px;">${_nudgeBtn(field, -1, '−')}${_nudgeBtn(field, 1, '+')}</div>`;
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
        <div class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-start;margin-top:10px;">
          ${_missionDurationOverrideHTML(id, idx, e)}
        </div>
      </div>`;
  } else if (_evIsSolvedManeuver(e)) {
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
        <div style="margin-bottom:8px;">${(typeof progPorkButtonHTML === 'function') ? progPorkButtonHTML(id, idx, e.toNode) : ''}</div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px;">// edit the burn/separate steps on the maneuver card itself</div>
        <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionApplyManeuverEdit('${id}',${idx})">Apply</button>
        <div class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-start;margin-top:10px;">
          <div class="cfg-item"><label class="cfg-label" title="Solved maneuvers: only the departure MET is directly nudgeable — the ΔV components are solver-owned display, refreshed from the physics leg every recompute.">MET nudge</label>
            <div style="display:flex;gap:6px;align-items:center;">
              <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">${_metFmt((e.at && e.at.value_s) || 0)}</span>
              ${_nudgeRow('met')}
            </div>
          </div>
          ${_missionDurationOverrideHTML(id, idx, e)}
          <div class="cfg-item"><label class="cfg-label">&Delta;V (m/s) ${e.dvOverride!=null?'<span style="color:var(--accent3)">(custom)</span>':''}</label>
            <div style="display:flex;gap:6px;align-items:center;">
              <input type="number" id="edit-dv-override-${id}" class="field" placeholder="auto: ${e.dvAuto!=null?e.dvAuto.toLocaleString():'n/a'}" value="${e.dvOverride!=null?e.dvOverride:''}" style="width:100px;" onchange="missionApplyDvOverride('${id}',${idx})">
              ${e.dvOverride!=null?`<button class="act-btn" style="padding:3px 8px;" onclick="missionResetDvOverride('${id}',${idx})" title="Reset to auto">↺</button>`:''}
            </div>
            <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:2px;">auto: ${e.dvAuto!=null?e.dvAuto.toLocaleString()+' m/s':'n/a'}</div>
          </div>
        </div>
      </div>`;
  } else if (e.type === 'DEPLOY') {
    const scs = _scEdSC || [];
    const o = scs.map(s => `<option value="${s.spacecraftId}"${s.spacecraftId===e.spacecraftId?' selected':''}>${s.name}</option>`).join('');
    // §14 U3: DEPLOY (unlike LAUNCH) MAY target a propagated ref — a station
    // parked on the NRHO is exactly the use case. Picking one binds
    // e.orbitRefId + e.orbit; leaving it "— default —" keeps the pre-existing
    // "orbit follows the Launch Orbit" behavior (e.orbit unset).
    const deployRefOpts = (typeof refOrbitCatalogList === 'function') ? refOrbitCatalogList() : [];
    const eOrbit = e.orbit || {};
    const deployRefSelectHTML = `
        <div class="cfg-item" style="margin-bottom:8px;"><label class="cfg-label">Ref Orbit</label>
          <select id="edit-deploy-ref-${id}" style="${_es}" onchange="missionDeployRefPick('${id}',${idx},this.value)">
            <option value="">— default (follows Launch Orbit) —</option>
            ${deployRefOpts.map(r => `<option value="${r.id}"${r.id === e.orbitRefId ? ' selected' : ''}>${_mrEsc(r.name)}${r.kind === 'propagated' ? ' (propagated)' : ''}${r.builtin ? '' : ' (user)'}</option>`).join('')}
          </select>
          <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-left:6px;">${eOrbit.propagated ? 'on propagated orbit' : ''}${e._refNote ? ' // ' + _mrEsc(e._refNote) : ''}</span></div>`;
    editForm = `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <div class="cfg-item" style="margin-bottom:8px;"><label class="cfg-label">Spacecraft</label>
          <select id="edit-deploy-sc-${id}" class="mcc-field-select">${o}</select></div>
        ${deployRefSelectHTML}
        <label style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="edit-deploy-empty-${id}" style="accent-color:var(--accent);"${e.emptyTanks?' checked':''}> Deploy with empty tanks (depot)</label>
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px;">// unbound orbit follows the Launch Orbit set in the left panel</div>
        <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionApplyDeployEdit('${id}',${idx})">Apply</button>
      </div>`;
  } else if (e.type === 'COAST') {
    editForm = `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <div class="cfg-item" style="margin-bottom:8px;"><label class="cfg-label">Days</label>
          <input type="number" id="edit-coast-days-${id}" class="field" value="${e.days||0}" min="0" step="any" style="width:140px;"></div>
        <div class="cfg-item" style="margin-bottom:8px;"><label class="cfg-label">Label</label>
          <input type="text" id="edit-coast-label-${id}" class="field" value="${(e.label||'').replace(/"/g,'&quot;')}" style="width:100%;" maxlength="60"></div>
        <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionApplyCoastEdit('${id}',${idx})">Apply</button>
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
    const lanDerived = !!(e.launchTime_s != null && o._lanFromLaunchTime);
    // T2: reference-orbit catalog pick — '— custom —' or a catalog entry. Picking one
    // sets orbitRefId + fills the fields; hand-editing a bound field clears orbitRefId
    // (see missionApplyLaunchEdit / missionLaunchOrbitDetach) and shows '(custom)'.
    // §14 U3: a LAUNCH cannot target a propagated ref (not a launch-insertion
    // orbit — it's a DEPLOY/maneuver-target orbit) — filtered out of this picker.
    const refOpts = (typeof refOrbitCatalogList === 'function') ? refOrbitCatalogList().filter(r => r.kind !== 'propagated') : [];
    const refSelectHTML = `
        <div class="cfg-item"><label class="cfg-label">Ref Orbit</label>
          <select id="edit-launch-ref-${id}" style="${_es}" onchange="missionLaunchRefPick('${id}',${idx},this.value)">
            <option value="">— custom —</option>
            ${refOpts.map(r => `<option value="${r.id}"${r.id === e.orbitRefId ? ' selected' : ''}>${_mrEsc(r.name)}${r.builtin ? '' : ' (user)'}</option>`).join('')}
          </select>
          <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-left:6px;">${e.orbitRefId ? '' : '(custom)'}${e._refNote ? ' // ' + _mrEsc(e._refNote) : ''}</span></div>`;
    editForm = `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <label class="cfg-label">Launch Vehicle</label>
        <select id="edit-launch-lv-${id}" class="mcc-field-select" style="margin-bottom:8px;">${lvOpts}</select>
        <label class="cfg-label">Payloads</label>
        <div style="margin:4px 0 8px;">${payChecks}</div>
        <div class="cfg-row" style="flex-wrap:wrap;gap:8px 14px;align-items:flex-end;margin-bottom:8px;">
          ${refSelectHTML}
          <div class="cfg-item"><label class="cfg-label">Body</label><select id="edit-launch-body-${id}" style="${_es}">${bodies.map(b => `<option${b === (o.body || 'Earth') ? ' selected' : ''}>${b}</option>`).join('')}</select></div>
          <div class="cfg-item"><label class="cfg-label">Perigee (km)</label><input type="number" id="edit-launch-alt-${id}" class="field" value="${o.alt_km ?? 200}" style="width:90px;" oninput="missionLaunchOrbitDetach('${id}',${idx})"></div>
          <div class="cfg-item"><label class="cfg-label">Apogee (km)</label><input type="number" id="edit-launch-apo-${id}" class="field" value="${o.apo_km ?? o.alt_km ?? 200}" style="width:90px;" oninput="missionLaunchOrbitDetach('${id}',${idx})"></div>
          <div class="cfg-item"><label class="cfg-label">Inc (deg)</label><input type="number" id="edit-launch-inc-${id}" class="field" value="${o.inc_deg ?? 28.5}" style="width:80px;" oninput="missionLaunchOrbitDetach('${id}',${idx});missionLaunchGeoUpdate('${id}',${idx})"></div>
          ${_missionLaunchLanFieldHTML(m, idx, e)}
          ${_missionLaunchPlaneMatchHTML(m, idx, e)}
        </div>
        ${_missionLaunchPlanHTML(m, idx, e)}
        ${_missionLaunchGeoHTML(m, idx, e)}
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
  } else if (e.type === 'MNODE') {
    // Round 2 item 3(b): explicit CA-target dropdown, persisted on the log
    // entry as caTarget (authored state, same as any other MNODE field).
    const _ownBody = (e.orbitAtBurn && e.orbitAtBurn.body) || 'Earth';
    const _bodyOpts = Object.keys(PROG_BODIES || {}).filter(b => b !== _ownBody)
      .map(b => `<option value="${_tsEsc(b)}"${e.caTarget === b ? ' selected' : ''}>${_tsEsc(b)}</option>`).join('');
    editForm = `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <div class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
          <div class="cfg-item"><label class="cfg-label">MET (s)</label>
            <div style="display:flex;gap:6px;align-items:center;">
              <input type="number" id="edit-mnode-met-${id}" class="field" value="${e.at && e.at.value_s || 0}" min="0" step="any" style="width:110px;">
              ${_nudgeRow('met')}
            </div>
          </div>
          <div class="cfg-item"><label class="cfg-label">Prograde (m/s)</label>
            <div style="display:flex;gap:6px;align-items:center;">
              <input type="number" id="edit-mnode-pro-${id}" class="field" value="${e.dvPro_ms||0}" step="any" style="width:100px;">
              ${_nudgeRow('pro')}
            </div>
          </div>
          <div class="cfg-item"><label class="cfg-label">Radial (m/s)</label>
            <div style="display:flex;gap:6px;align-items:center;">
              <input type="number" id="edit-mnode-rad-${id}" class="field" value="${e.dvRad_ms||0}" step="any" style="width:100px;">
              ${_nudgeRow('rad')}
            </div>
          </div>
          <div class="cfg-item"><label class="cfg-label">Normal (m/s) <span style="color:var(--text-dim);">(+ along the orbit normal ĥ)</span></label>
            <div style="display:flex;gap:6px;align-items:center;">
              <input type="number" id="edit-mnode-nrm-${id}" class="field" value="${e.dvNrm_ms||0}" step="any" style="width:100px;">
              ${_nudgeRow('nrm')}
            </div>
          </div>
          <div class="cfg-item"><label class="cfg-label">CA Target</label>
            <select id="edit-mnode-catarget-${id}" style="${_es}" onchange="missionApplyMnodeCaTarget('${id}',${idx})">
              <option value="auto"${!e.caTarget || e.caTarget === 'auto' ? ' selected' : ''}>Auto</option>
              ${_bodyOpts}
            </select>
          </div>
        </div>
        <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionApplyMnodeEdit('${id}',${idx})">Apply</button>
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
  const prevEv = idx >= 1 ? m.log[idx - 1] : null;
  const coastToggle = (idx >= 1 && (_evIsSolvedManeuver(prevEv) || (prevEv && prevEv.type === 'BURN')))
    ? `<label style="display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer;font-family:var(--mono);font-size:10px;color:var(--text-bright);">
        <input type="checkbox"${e.midCoast ? ' checked' : ''} onchange="missionToggleMidCoast('${id}',${idx})">
        ⤵ Occurs during the previous transfer's coast (show it mid-maneuver)
      </label>`
    : '';
  if (!editForm && !simToggle && !coastToggle) return '';
  return `<div style="padding:4px 2px;">
      ${editForm}
      ${simToggle}
      ${coastToggle}
    </div>`;
}
