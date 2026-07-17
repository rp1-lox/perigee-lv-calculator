// ─────────────────────────────────────────────────────────────────────────────
// 570-mission-panel.js — Mission state panel + maneuver builder + node/edge interaction
//
// OWNS: the band-mode left-column "Vehicles & Mission ΔV Budget" state panel
//   (_missionMultiVehicleHTML); view switching + scroll/render helpers
//   (missionSetView, _missionSaveScroll/_missionRestoreScroll, _missionRerenderNodeView,
//   _missionRenderPreserveNm, missionToggleBridgeMode); the maneuver-step builder
//   (_missionMvBuilderHTML, missionMvStep, _missionMvCtx, _missionMvAutoSteps,
//   _missionSimManeuverSteps, _missionManeuverSteps, _missionApplyManeuver,
//   missionExecManeuver); node/edge click handling (missionNodeClick, missionEdgeClick,
//   _missionNmSelectShared, _nmArrowHead); and the MANEUVER log card
//   (_missionManeuverLogCardHTML).
// Does NOT own: node-map SVG rendering (570-mission-nodemap.js), band SVG
//   (570-mission-band.js), event execution (570-mission-events.js), replay
//   (570-mission-replay.js).
// Split out of 570-mission-manager.js (behavior-preserving move). Definitions only
//   (no load-time execution); load order relative to the manager is immaterial.
// ─────────────────────────────────────────────────────────────────────────────

// Merged Vehicles + Mission ΔV Budget panel (band-mode left column). Each vehicle
// card is the old roster row ENRICHED with that vehicle's own current orbit +
// remaining ΔV/prop (what the old sticky budget card showed, but per-vehicle
// instead of just the focused one) — plus a compact mission-level totals line at
// the bottom (same fields the old budget card showed mission-wide). Numbers here
// always reflect current/live state exactly like the old budget card did: neither
// missionBudget() nor these per-vehicle numbers are affected by the band-view
// scrub position (_missionBandScrub only moves the scrub marker + expands the
// matching event card — it never rewinds vehicle state), so this preserves that
// semantic unchanged.
// §12 U3: the vehicle-assigned color swatch, formerly on the HUD chip, moves
// here (the left panel is the swatch's one home now). Same write path as
// before — missionSetLaneColorForVehicle/missionResetLaneColorForVehicle —
// the band-legend picker stays the single write path per the brief.
function _missionVehSwatchHTML(m, id, vehicleKey) {
  if (!vehicleKey) return '';
  const accent = (typeof _missionVehicleColor === 'function') ? _missionVehicleColor(m, vehicleKey, null) : null;
  const swatchColor = (typeof _missionVehicleSwatchColor === 'function') ? _missionVehicleSwatchColor(m, vehicleKey) : (accent || '#888');
  return `<input type="color" class="mcc-veh-swatch" value="${swatchColor}" title="Vehicle color (right-click to reset)" onclick="event.stopPropagation()" onchange="event.stopPropagation();missionSetLaneColorForVehicle('${id}','${vehicleKey}',this.value)" oncontextmenu="event.preventDefault();event.stopPropagation();missionResetLaneColorForVehicle('${id}','${vehicleKey}')">`;
}

// HUD vehicle chips are click-expandable (user feedback 2026-07-16, item 3):
// clicking a vehicle reveals a per-stage breakdown (name, propellant
// remaining/capacity, dry mass). Transient UI state only (never persisted /
// never touches m.log) — keyed by "missionId|vehicleKey" so each vehicle's
// expansion is independent and survives a re-render.
let _missionHudExpandVeh = {};
function missionHudToggleVehExpand(id, vehicleKey, ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  const k = id + '|' + vehicleKey;
  _missionHudExpandVeh[k] = !_missionHudExpandVeh[k];
  missionRenderDetail();
}

// Per-stage breakdown rows for the expanded HUD vehicle card. `stages` is a
// normalized array of {name, prop, cap, dry} (kg); works for both the live
// path (fv.stages, via progStageRemainingProp/progStageTotalCapacity) and the
// event-scoped snapshot path (entry.snapshot[].stages, which already carries
// prop/cap/dry — see _missionCaptureSnapshot, 570-mission-replay.js).
function _missionVehStageRowsHTML(stages) {
  if (!stages || !stages.length) return `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:4px 0;">// no stage data</div>`;
  const rows = stages.map(s => {
    const cap = s.cap || 0;
    const frac = cap > 0 ? Math.max(0, Math.min(1, s.prop / cap)) : 0;
    return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-family:var(--mono);font-size:9px;color:var(--text-dim);">
      <span style="flex:1 1 90px;min-width:0;color:var(--text-bright);white-space:normal;word-break:break-word;">${_mrEsc ? _mrEsc(s.name || '?') : (s.name || '?')}</span>
      <span style="flex:0 0 90px;height:5px;background:var(--input);border:1px solid var(--border);position:relative;overflow:hidden;"><span style="position:absolute;inset:0;width:${Math.round(frac*100)}%;background:var(--accent-tint-strong);"></span></span>
      <span style="flex:0 0 auto;text-align:right;">${Math.round(s.prop).toLocaleString()} / ${Math.round(cap).toLocaleString()} kg</span>
      <span style="flex:0 0 auto;text-align:right;color:var(--text-dim);">dry ${Math.round(s.dry||0).toLocaleString()} kg</span>
    </div>`;
  }).join('');
  return `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);">${rows}</div>`;
}

// Live-vehicle adapter: normalize fv.stages -> the shape _missionVehStageRowsHTML expects.
function _missionVehStageRowsFromLive(fv) {
  const stages = (fv.stages || []).map(st => ({
    name: (typeof _missionStageLabelById === 'function') ? _missionStageLabelById(st.stageDefinitionId) : (st.stageDefinitionId || '?'),
    prop: progStageRemainingProp(st),
    cap: progStageTotalCapacity(st),
    dry: st.dry_mass || 0,
  }));
  return _missionVehStageRowsHTML(stages);
}

// "More statistics" disclosure (item 4): low-value headline metrics — chiefly
// propellant consumed — demoted here instead of sitting on the mission totals
// line at a glance. Plain <details> reuses native disclosure semantics (no
// new expand-state plumbing needed) and is styled with theme vars only.
function _missionMoreStatsHTML(propConsumed) {
  return `<details style="margin-top:4px;">
      <summary style="cursor:pointer;font-family:var(--mono);font-size:9px;color:var(--text-dim);letter-spacing:.05em;">More statistics</summary>
      <div style="padding:4px 0 0 10px;font-family:var(--mono);font-size:9px;color:var(--text-dim);">
        <span>Prop consumed: <span style="color:var(--text-bright)">${Math.round(propConsumed).toLocaleString()} kg</span></span>
      </div>
    </details>`;
}

function _missionMultiVehicleHTML(m) {
  const id = m.missionId;
  const sel = _missionSelectedEventSnapshotEntry(m);   // non-null = show state AS OF that event

  if (sel) {
    // ── event-scoped view: read the per-event snapshot captured during recompute
    //    instead of live vehicle state. ──
    const entry = sel.entry;
    const snap = entry.snapshot || [];
    if (!snap.length) return '';
    const rows = snap.map(v => {
      const isActive = entry.activeOriginKey && v.originKey === entry.activeOriginKey;
      const expended = v.status === 'EXPENDED';
      const os = v.orbit || null;
      const accent = (typeof _missionVehicleColor === 'function') ? _missionVehicleColor(m, v.vehicleId, null) : null;
      const orbitLine = os
        ? `<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${os.propagated ? (os.body || 'Moon') + ' · NRHO (propagated)' : os.surface ? (os.body || 'Earth') + ' surface' : `${os.body || 'Earth'} · ${Math.round(os.perigee ?? os.apogee ?? 0).toLocaleString()}×${Math.round(os.apogee ?? os.perigee ?? 0).toLocaleString()} km · ${(os.inclination || 0)}&deg;`}</span>`
        : '';
      const expandKey = id + '|' + v.vehicleId;
      const expanded = !!_missionHudExpandVeh[expandKey];
      return `<div onclick="missionHudToggleVehExpand('${id}','${v.vehicleId}',event)" title="Click for per-stage detail" style="display:flex;flex-direction:column;gap:4px;padding:6px 8px;border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};border-left:3px solid ${accent || (isActive ? 'var(--accent)' : 'var(--border)')};margin-bottom:4px;background:${isActive ? 'var(--accent-tint-strongest)' : 'transparent'};cursor:pointer;${expended ? 'opacity:.6;' : ''}">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
          <span style="flex-shrink:0;width:12px;font-size:11px;color:${isActive ? 'var(--accent3)' : 'var(--text-dim)'};">${isActive ? '●' : '○'}</span>
          ${_missionVehSwatchHTML(m, id, v.vehicleId)}
          <span style="font-family:var(--mono);font-size:11px;color:${isActive ? 'var(--accent3)' : 'var(--text-bright)'};font-weight:${isActive ? '600' : '400'};flex:1 1 100px;min-width:80px;white-space:normal;word-break:break-word;line-height:1.3;">${v.name}</span>
          <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${(v.stages || []).length} stages</span>
          ${expended ? `<span style="font-family:var(--mono);font-size:9px;color:var(--danger)">${v.status}</span>` : ''}
          <span style="flex-shrink:0;font-size:9px;color:var(--text-dim);transform:rotate(${expanded?'90deg':'0deg'});transition:transform .1s;">&#9656;</span>
        </div>
        ${orbitLine ? `<div>${orbitLine}</div>` : ''}
        <div style="display:flex;gap:12px;font-family:var(--mono);font-size:9px;color:var(--text-dim);">
          <span>&Delta;V left: <span style="color:${v.remDv > 0 ? 'var(--accent3)' : 'var(--accent2)'}">${v.remDv.toLocaleString()} m/s</span></span>
          <span>Prop left: <span style="color:var(--text-bright)">${v.remProp.toLocaleString()} kg</span></span>
        </div>
        ${expanded ? _missionVehStageRowsHTML(v.stages || []) : ''}
      </div>`;
    }).join('');

    // mission totals AS OF this event: sum m.log contributions up to & including this
    // event's authored index (same accounting missionBudget() does, just truncated).
    const authIdx = entry._authIdx != null ? entry._authIdx : sel.index;
    let dvExpended = 0, propConsumed = 0, payloadMass = 0;
    for (let i = 0; i <= authIdx && i < m.log.length; i++) {
      const e = m.log[i];
      if (e.type === 'LAUNCH') {
        const sr = e.stagingResult || {};
        dvExpended += sr.dvDelivered || 0;
        propConsumed += (sr.stages || []).reduce((s, st) => s + (st.propBurned || 0), 0);
        payloadMass = e.payloadMass || payloadMass;
      } else if (e.type === 'BURN' || e.type === 'MNODE') {
        dvExpended += e.dv_actual || 0;
        propConsumed += e.prop_consumed || 0;
      }
    }
    const activeSnap = entry.activeOriginKey ? snap.find(v => v.originKey === entry.activeOriginKey) : null;
    const capRem = activeSnap ? activeSnap.remDv : 0;
    const capColor = capRem > 0 ? 'var(--accent3)' : 'var(--accent2)';
    const totals = `<div style="display:flex;flex-wrap:wrap;gap:4px 14px;padding-top:6px;margin-top:4px;border-top:1px solid var(--border);font-family:var(--mono);font-size:9px;color:var(--text-dim);">
        <span>&Delta;V expended: <span style="color:var(--text-bright)">${Math.round(dvExpended).toLocaleString()} m/s</span></span>
        <span>&Delta;V left (active): <span style="color:${capColor}">${Math.round(capRem).toLocaleString()} m/s</span></span>
        <span>Payload: <span style="color:var(--text-bright)">${Math.round(payloadMass).toLocaleString()} kg</span></span>
      </div>
      ${_missionMoreStatsHTML(propConsumed)}`;

    const evLabel = entry.type + (sel.index != null && m._expanded ? ' ' + (sel.index + 1) : '');
    const metSuffix = entry.metStart != null ? ` <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">&middot; ${_metFmt(entry.metStart)}</span>` : '';
    return `<div class="mcc-box">
        <div class="mcc-box-hdr">Vehicles &amp; Mission State — at ${evLabel}${metSuffix}</div>
        ${rows}
        ${totals}
      </div>`;
  }

  const live = _missionLiveVehicles(m);
  if (!live.length) return '';

  const rows = live.map(({ id: vid, fv }) => {
    const isActive = vid === m.vehicleId;
    const expended = fv.status === 'EXPENDED';
    const os = fv.orbitState || null;
    const remDv = Math.round(_missionVehicleRemainingDv(fv));
    const remProp = Math.round(fv.stages.reduce((s, st) => s + progStageRemainingProp(st), 0));
    const accent = (typeof _missionVehicleColor === 'function') ? _missionVehicleColor(m, fv.vehicleId, null) : null;
    const orbitLine = os
      ? `<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${os.propagated ? (os.body || 'Moon') + ' · NRHO (propagated)' : `${os.body || 'Earth'} · ${Math.round(os.perigee ?? os.apogee ?? 0).toLocaleString()}×${Math.round(os.apogee ?? os.perigee ?? 0).toLocaleString()} km · ${(os.inclination || 0)}&deg;`}</span>`
      : '';
    // whole row is clickable to make this the active vehicle AND expand per-stage detail
    const expandKey = id + '|' + vid;
    const expanded = !!_missionHudExpandVeh[expandKey];
    return `<div onclick="missionSetActiveVehicle('${id}','${vid}');missionHudToggleVehExpand('${id}','${vid}',event)" title="Click to make active / show per-stage detail" style="display:flex;flex-direction:column;gap:4px;padding:6px 8px;border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};border-left:3px solid ${accent || (isActive ? 'var(--accent)' : 'var(--border)')};margin-bottom:4px;background:${isActive ? 'var(--accent-tint-strongest)' : 'transparent'};cursor:pointer;">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
        <span style="flex-shrink:0;width:12px;font-size:11px;color:${isActive ? 'var(--accent3)' : 'var(--text-dim)'};">${isActive ? '●' : '○'}</span>
        ${_missionVehSwatchHTML(m, id, fv.vehicleId)}
        <span style="font-family:var(--mono);font-size:11px;color:${isActive ? 'var(--accent3)' : 'var(--text-bright)'};font-weight:${isActive ? '600' : '400'};flex:1 1 100px;min-width:80px;white-space:normal;word-break:break-word;line-height:1.3;">${_missionVehicleDisplayName(fv)}</span>
        <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${fv.stages.length} stages</span>
        ${expended ? '<span style="font-family:var(--mono);font-size:9px;color:var(--danger)">EXPENDED</span>' : ''}
        <button class="act-btn" style="padding:2px 6px;font-size:10px;flex-shrink:0;" onclick="event.stopPropagation();missionRenameVehicle('${id}','${fv._originKey || ''}')" title="Rename this vehicle">✎</button>
        <button class="act-btn" style="padding:2px 8px;font-size:10px;flex-shrink:0;" onclick="event.stopPropagation();missionExecExpendVehicle('${id}','${vid}')"${expended ? ' disabled' : ''}>Expend</button>
        <span style="flex-shrink:0;font-size:9px;color:var(--text-dim);transform:rotate(${expanded?'90deg':'0deg'});transition:transform .1s;">&#9656;</span>
      </div>
      ${orbitLine ? `<div>${orbitLine}</div>` : ''}
      <div style="display:flex;gap:12px;font-family:var(--mono);font-size:9px;color:var(--text-dim);">
        <span>&Delta;V left: <span style="color:${remDv > 0 ? 'var(--accent3)' : 'var(--accent2)'}">${remDv.toLocaleString()} m/s</span></span>
        <span>Prop left: <span style="color:var(--text-bright)">${remProp.toLocaleString()} kg</span></span>
      </div>
      ${expanded ? _missionVehStageRowsFromLive(fv) : ''}
    </div>`;
  }).join('');

  const b = missionBudget(m);
  const capColor = b.dvCapacityRemaining > 0 ? 'var(--accent3)' : 'var(--accent2)';
  const totals = `<div style="display:flex;flex-wrap:wrap;gap:4px 14px;padding-top:6px;margin-top:4px;border-top:1px solid var(--border);font-family:var(--mono);font-size:9px;color:var(--text-dim);">
      <span>&Delta;V expended: <span style="color:var(--text-bright)">${b.dvExpended.toLocaleString()} m/s</span></span>
      <span>&Delta;V left (active): <span style="color:${capColor}">${b.dvCapacityRemaining.toLocaleString()} m/s</span></span>
      <span>Payload: <span style="color:var(--text-bright)">${b.payloadMass.toLocaleString()} kg</span></span>
      <span>Duration: <span style="color:var(--text-bright)">${_metFmt(m._metTotal)}</span></span>
    </div>
    ${_missionMoreStatsHTML(b.propConsumed)}`;

  // Separate & Dock are done via ＋ Add Event; this panel is the vehicle list plus
  // per-vehicle + mission-wide state (formerly a separate sticky budget card).
  // Selecting a row sets the focused vehicle that the Orbit Map edits and that new
  // events default to.
  return `<div class="mcc-box">
      <div class="mcc-box-hdr">Vehicles &amp; Mission State — current</div>
      ${rows}
      ${totals}
    </div>`;
}

// Mission epoch (T+0 date/time) editing — the top-strip date stamp AND its
// adjacent calendar button both open the custom themed popover calendar
// (578-mission-epoch-picker.js, _missionEpochOpen/epochPickerOpen). Nothing
// commits until the popover's Apply button; the old inline
// datetime-local-input approach (commit-on-change/blur) is retired — it
// committed PARTIAL segment edits mid-type (see 578's header comment for the
// root-cause writeup), which looked like "typing 1919 only moves the date
// back about a year" because each keystroke's transient (still-valid)
// intermediate value re-rendered and killed the input's focus.
//
// MISSION_MODEL_V2 §12 U3: top universal strip, identical across all three
// views. Minimal by decree: MET + calendar date + a minimal scrubber
// (reuses the UNCHANGED _trajScrubberHTML — the same scrub track/thumb/ticks
// used everywhere else, so drag/click/arrow-key behavior is byte-identical),
// the active-vehicle name, and — right end — the readiness counts chip.
function _missionTopStripHTML(m) {
  const id = m.missionId;
  const vt = (typeof _trajViewTime === 'function') ? _trajViewTime(m) : (m._metTotal || 0);
  const dateStr = (typeof progMissionTimeToDate === 'function')
    ? progMissionTimeToDate(vt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    : '';
  const scrubHTML = (typeof _trajScrubberHTML === 'function') ? _trajScrubberHTML(m, id) : '';
  const activeFv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  const activeName = activeFv ? _missionVehicleDisplayName(activeFv) : '—';
  const readinessChip = (typeof _missionChecksToolbarChipHTML === 'function') ? _missionChecksToolbarChipHTML(m) : '';
  // Calendar glyph: inline SVG (theme-var stroke), NOT an emoji — see
  // 578-mission-epoch-picker.js header comment / user directive 2026-07-16.
  const _calSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:block;" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
      <line x1="1.5" y1="6" x2="14.5" y2="6" stroke="currentColor" stroke-width="1.2"/>
      <line x1="4.5" y1="1" x2="4.5" y2="3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="11.5" y1="1" x2="11.5" y2="3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`;
  const dateCell = `<span class="mcc-top-date" title="Click to change mission epoch (T+0), UTC"
      style="cursor:pointer;border-bottom:1px dashed var(--accent-tint-strong);"
      onclick="_missionEpochOpen(this)">${dateStr}</span><button type="button" class="act-btn mcc-epoch-btn"
      title="Change mission epoch (T+0)" aria-label="Change mission epoch (T+0)"
      style="padding:1px 5px;line-height:1;margin-left:3px;color:var(--text-dim);display:inline-flex;align-items:center;"
      onclick="_missionEpochOpen(this)">${_calSvg}</button>`;
  return `<div class="mcc-top-strip">
    <span class="mcc-top-met">T+${_metFmt(vt)}</span>
    ${dateCell}
    <div class="mcc-top-scrub">${scrubHTML}</div>
    <span class="mcc-top-veh" title="Active vehicle">${_mcEscape ? _mcEscape(activeName) : activeName}</span>
    <div class="mcc-top-right">${readinessChip}</div>
  </div>`;
}

// Opens the custom epoch-picker popover (578) anchored under whichever
// element (stamp or button) was clicked, seeded with the current program
// epoch, and wires Apply to the real commit path: set epochJD -> recompute
// -> re-render (missionRecompute's tail already hooks undo capture +
// autosave — see 575/455).
function _missionEpochOpen(anchorEl) {
  if (typeof epochPickerOpen !== 'function') return;
  const epochJD = (typeof progEpochJD === 'function') ? progEpochJD() : PROG_DEFAULT_EPOCH_JD;
  epochPickerOpen({
    initialJD: epochJD,
    anchorEl: anchorEl,
    onApply: function(jd) {
      if (!isFinite(jd)) return;
      PROG_ACTIVE_PROGRAM.epochJD = jd;
      const m = (typeof _missionGet === 'function') ? _missionGet(_missionSel) : (_missions && _missions[0]);
      if (m && typeof missionRecompute === 'function') missionRecompute(m);
      if (typeof missionRenderDetail === 'function') missionRenderDetail();
    }
  });
}

// MISSION_MODEL_V2 §12 U3: the visible tri-toggle at the top of the center
// region — the primary, exclusive view switch. Replaces the U1/U2 promotion
// selectors (which drove _missionStageSurface via _missionPromote); this one
// drives the real _missionViewMode directly via missionSetView. Undo/redo
// docked at the right end (the mission's one control bar, same spot the
// old floating toolbar / HUD strip held them).
function _missionViewToggleHTML(m) {
  const id = m.missionId;
  const mode = _missionViewMode;
  const btn = (val, label) => `<button class="act-btn mcc-viewtgl-btn${mode === val ? ' active' : ''}" onclick="missionSetView('${id}','${val}')" title="Show ${label}">${label}</button>`;
  return `<div class="mcc-view-toggle">
    <div class="mcc-viewtgl-seg">${btn('traj', 'World')}${btn('band', 'Timeline')}${btn('nodemap', 'Node map')}</div>
    <div class="mcc-toolbar-sep"></div>
    <div class="mcc-topbar-undoredo">
      <button class="act-btn" onclick="missionUndo()" title="Undo (Ctrl+Z)"${(typeof _missionUndoCanUndo === 'function' && _missionUndoCanUndo()) ? '' : ' disabled'}>&#x21B6;</button>
      <button class="act-btn" onclick="missionRedo()" title="Redo (Ctrl+Y)"${(typeof _missionUndoCanRedo === 'function' && _missionUndoCanRedo()) ? '' : ' disabled'}>&#x21B7;</button>
    </div>
  </div>`;
}

// ── Step 4: node-map view + MANEUVER events ───────────────────────────────────

// MISSION_MODEL_V2 §12 U3: the real, authoritative view switch. Sets
// _missionViewMode directly and re-renders — NOT an alias onto a promotion
// surface (U1/U2's _missionPromote/_missionStageSurface are retired).
// Dev-seed/eval compatibility: callers keep invoking
// missionSetView(id,'traj'|'band'|'nodemap') exactly as before.
function missionSetView(id, mode) {
  // Leaving World: drop its cached starfield size so a later switch back
  // re-measures instead of trusting a stale cache (same behavior the old
  // pre-U2 missionSetView had).
  if (_missionViewMode === 'traj' && mode !== 'traj' && typeof _trajStarfieldUnmount === 'function') _trajStarfieldUnmount(id);
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
  // C3: prefer the actual authored LAUNCH/DEPLOY entry's orbit (single source
  // of truth); m.launchOrbit is only a fallback for the pre-authoring case
  // (no LAUNCH/DEPLOY exists yet — nothing else to show a default node for).
  const first = (m.log || []).find(e => e.type === 'LAUNCH' || e.type === 'DEPLOY');
  const o = (first && first.orbit) || (typeof _missionLaunchOrbitDraft === 'function' ? _missionLaunchOrbitDraft(m.launchOrbit) : m.launchOrbit) || {};
  return _progNmVehicleNode({ orbitState: { body: o.body, perigee: o.periKm, apogee: o.periKm } });
}

// Ordered list of node ids the mission traverses: launch node, then each MANEUVER destination.
function _missionNodePath(m) {
  // The Orbit Map shows the FOCUSED vehicle's path: only its maneuvers (matched by
  // the selected runtime vehicleId), so selecting a vehicle in the roster scopes the
  // map to the one you're editing. Falls back to all maneuvers if none is focused.
  const path = [];
  const vid = m.vehicleId;
  if (m.log.some(e => e.type === 'LAUNCH' || e.type === 'DEPLOY')) path.push(_missionNodeForLaunch(m));
  for (const e of m.log) if (_evIsSolvedManeuver(e) && e.toNode && (!vid || e.vehicleId === vid)) path.push(e.toNode);
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
  const autoDv = r ? r.dv : 0;
  // dvOverride (m/s, authored) replaces the physics-derived requirement BEFORE
  // propellant computation, so the rocket equation consumes the custom ΔV. Badged
  // in the UI as "(custom)" — see missionApplyManeuverEdit / the maneuver card.
  const fullDv = (e.dvOverride != null) ? e.dvOverride : autoDv;
  e.dvAuto = autoDv ? Math.round(autoDv) : null;
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
    else if (o.type === 'circular' || o.type === 'elliptic') {
      active.orbitState = { body: o.body, perigee: o.perigee ?? o.apogee ?? 0, apogee: o.apogee ?? o.perigee ?? 0, inclination: o.inclination ?? 0, lan: 0, epoch: 0, surface: false };
      // Phase 5a fix (user flight-test): a destination node bound to a
      // PROPAGATED catalog ref (the NRHO) must stamp propagated/refId onto the
      // arrived orbitState — the node's Kepler-ish peri/apo are label-only
      // pricing values (see 430's nrho comment). Without the stamp, snapshots
      // register a bogus Kepler ring record ("Moon 3000×60000"), the real
      // halo loop never renders after arrival, and the state panel shows
      // wrong ellipse numbers instead of "NRHO (propagated)".
      if (node.orbitRefId && typeof refOrbitGet === 'function') {
        const refE = refOrbitGet(node.orbitRefId);
        if (refE && refE.kind === 'propagated') {
          active.orbitState.propagated = true;
          active.orbitState.refId = node.orbitRefId;
          active.orbitState.perigee = null; active.orbitState.apogee = null; active.orbitState.inclination = null;
        }
      }
    }
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

// Re-render the "Launch window..." button in the Add-Event maneuver form when
// the To-node selection changes (destination may switch between porkchop-
// supported / unsupported / non-interplanetary).
function progPorkRefreshAddEvBtn(id) {
  const el = document.getElementById('pork-addev-btn-' + id);
  const toSel = document.getElementById('addev-mvt-' + id);
  if (!el || !toSel || typeof progPorkButtonHTML !== 'function') return;
  el.innerHTML = progPorkButtonHTML(id, -1, toSel.value);
}

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
  // E3 dual pricing: PARALLEL low-thrust est. line (Edelbaum full form, 568)
  // when the acting vehicle's active stage is EP-capable — the impulsive
  // "requires" number above is untouched (progNmComputeEdgeDv, frozen).
  const ltFrom = isAdd ? document.getElementById('addev-mvf-' + id)?.value : (e && e.fromNode);
  const ltTo   = isAdd ? document.getElementById('addev-mvt-' + id)?.value : (e && e.toNode);
  const ltHTML = _missionLtEdgeEstHTML(ctx.m, ltFrom, ltTo);
  const ltBtn  = (isAdd && ltHTML)
    ? `<button class="act-btn" style="width:100%;margin-top:6px;font-size:10px;" title="Author a LOWTHRUST event pre-filled with the Edelbaum est. duration instead of an impulsive maneuver" onclick="missionExecLowThrustFromEdge('${id}')">⚡ Add as Low-Thrust instead</button>`
    : '';
  return `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin:6px 0 3px;">// requires <b style="color:var(--text-bright)">${reqStr}</b> — steps:</div>
    ${ltHTML}${rows}${status}
    <div style="display:flex;gap:4px;margin-top:6px;">
      <button class="act-btn" style="flex:1;font-size:10px;" onclick="missionMvStep(${t},'add','burn')">＋ Burn</button>
      <button class="act-btn" style="flex:1;font-size:10px;" onclick="missionMvStep(${t},'add','separate')">＋ Separate</button>
      <button class="act-btn" style="flex:1;font-size:10px;" title="Auto-build a staged burn that closes the ΔV" onclick="missionMvStep(${t},'auto')">⚙ Auto</button>
    </div>${ltBtn}`;
}

// §22 TRANSFER CHAINS: |vec|*1000 (km/s vector -> m/s magnitude) — the SAME
// convention the 5a gate (tests/math.test.js) already uses to read
// mccBurn/insertionBurn off physSolveNrhoTransfer. Pure, no mutation.
function _missionChainVecMs(vec) {
  return (vec && vec.length >= 3 && isFinite(vec[0])) ? Math.hypot(vec[0], vec[1], vec[2]) * 1000 : 0;
}

// §22 C1/C2: split the solver's mid-course-correction + injection components
// out of the two-hop corridor pattern (entry edge solved via
// physSolveNrhoTransfer, exit edge is the schematic 'arrival' wrapper around
// the SAME solve — see 565's lastTransit machinery) into their own log
// entries, in place. One-source rule: every dv/timing value comes from what
// 565 ALREADY solved (entryLeg.mccBurn / thisLeg.arrivalBurn) — never
// recomputed here. Scope (documented, MATH.md §7ak): only fires for the
// two-hop corridor pattern (entryEntry present + thisLeg.kind==='arrival');
// a direct one-hop solved edge (no transit hop) stays a single 'inject'
// member, unchanged from today's accounting. Returns the mcc entry's
// inserted index, or -1 if no mcc was produced/applicable.
function _missionChainSplitInject(m, gid, entryIdx, injectIdx) {
  if (entryIdx == null || entryIdx < 0 || injectIdx == null || injectIdx < 0) return -1;
  if (typeof physMissionLeg !== 'function') return -1;
  const entryEntry = m.log[entryIdx], injectEntry = m.log[injectIdx];
  if (!entryEntry || !injectEntry) return -1;
  const entryLeg = physMissionLeg(m.missionId, entryIdx);
  const thisLeg = physMissionLeg(m.missionId, injectIdx);
  if (!thisLeg || thisLeg.kind !== 'arrival') return -1;
  const arrivalMet = entryLeg ? (entryLeg.met + (entryLeg.tof_s || 0)) : null;
  let mccInsertedAt = -1;
  if (entryLeg && entryLeg.mccBurn && entryEntry.metStart != null) {
    const departMet = entryEntry.metStart;
    const mccGap = Math.max(0, (entryLeg.mccBurn.t != null ? entryLeg.mccBurn.t : departMet) - departMet);
    const mccDvMs = _missionChainVecMs(entryLeg.mccBurn.dvVec);
    m.log.splice(injectIdx, 0, {
      type: 'BURN', burnType: 'CUSTOM', burnParam: Math.round(mccDvMs),
      chainRole: 'mcc', groupId: gid,
      activeKey: entryEntry.activeKey, activeName: entryEntry.activeName,
      durationOverride: mccGap,
      note: `Mid-course correction — solved by the ${entryEntry.fromLabel || entryEntry.fromNode} → ${injectEntry.toLabel || injectEntry.toNode} transfer (MATH.md §7ak)`,
    });
    mccInsertedAt = injectIdx;
    if (arrivalMet != null) injectEntry.durationOverride = Math.max(0, arrivalMet - entryLeg.mccBurn.t);
  }
  // Stamp the injection burn's OWN physics-solved magnitude (leg.arrivalBurn)
  // in place of the schematic patched-conic estimate — safe here because an
  // 'arrival'-kind leg's physics solve never reads dv_ms (it rides the entry
  // leg's already-flown trajectory; see 565's fromO.type==='transit' branch),
  // so overriding it AFTER the solve cannot feed back into the physics.
  if (thisLeg.arrivalBurn && thisLeg.arrivalBurn.dvVec) {
    injectEntry.dvOverride = Math.round(_missionChainVecMs(thisLeg.arrivalBurn.dvVec));
  }
  return mccInsertedAt;
}

function missionExecManeuver(id, fromId, toId) {
  const m = _missionGet(id);
  if (!m || !fromId || !toId || fromId === toId) return;
  const res = progNmComputeEdgeDv(fromId, toId);
  const lbl = (nid, dir) => _missionManeuverNodeLabel(nid, dir);
  const actFv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  // copy the draft step program (if any) onto the new maneuver; empty → legacy single burn
  const steps = (_missionAddMv && Array.isArray(_missionAddMv.steps) && _missionAddMv.steps.length)
    ? _missionAddMv.steps.map(s => ({ ...s })) : undefined;

  // §22 TRANSFER CHAINS C3 (docs/MISSION_MODEL_V2.md §22): the solved from->to
  // single-node MNODE authoring path is REPLACED by a GROUPED CHAIN bound
  // through m.groups (new kind:'transfer'). Two-hop corridor pattern (LEO->
  // TLC then TLC->destination, the shape both dev seeds already author):
  // does THIS edge CLOSE an already-open corridor-entry chain? Scan backward
  // for a still-open 'depart' member targeting this edge's fromNode.
  let entryIdx = -1, entryEntry = null;
  for (let k = m.log.length - 1; k >= 0; k--) {
    const cand = m.log[k];
    const g = cand.groupId && m.groups && m.groups[cand.groupId];
    if (g && g.kind === 'transfer' && cand.chainRole === 'depart' && cand.toNode === fromId && !g.hadInject) {
      entryIdx = k; entryEntry = cand; break;
    }
  }
  const toNodeObj = (typeof _missionNmNodeById === 'function') ? _missionNmNodeById(toId) : null;
  const toIsTransit = !!(toNodeObj && toNodeObj.orbit && toNodeObj.orbit.type === 'transit');
  // depart = a corridor-entry edge with no closing hop authored yet (expects
  // one later); inject = closes an open chain, OR a direct edge straight to a
  // real destination (single-member chain — nothing to separate, it both
  // departs and arrives in the same impulse, same as today).
  const chainRole = entryEntry ? 'inject' : (toIsTransit ? 'depart' : 'inject');
  const gid = entryEntry ? entryEntry.groupId : ('gxfer' + progUUID().slice(0, 8));

  const idx0 = m.log.length;
  // R6.2' Phase B (3a), preserved: the node-map bridge authors the UNIFIED
  // schema — MNODE(mode:'solved', target) — dv components start at 0 and are
  // refreshed from the solved leg on the very next recompute (display-only
  // mirror, see physRebuildMissionTrajectories). chainRole/groupId are new
  // (§22) metadata only — the exec/replay path is byte-identical to before.
  m.log.push({
    type: 'MNODE', mode: 'solved',
    target: { fromNode: fromId, toNode: toId },
    at: { kind: 'met', value_s: 0 },
    dvPro_ms: 0, dvRad_ms: 0, dvNrm_ms: 0,
    fromNode: fromId, toNode: toId, fromLabel: lbl(fromId, 'from'), toLabel: lbl(toId, 'to'),
    steps,
    activeKey: actFv ? actFv._originKey : null,
    activeName: actFv ? _missionVehicleDisplayName(actFv) : null,
    note: res ? res.note : 'No transfer model for this pair',
    method: res ? res.method : null,
    chainRole, groupId: gid,
  });
  _missionBridgeMode = false;
  _missionBridgeFrom = null;
  _missionAddEvt = null;
  _missionAddMv = { from: null, to: null, steps: [] };
  _missionExpandLast(m);
  // PASS 1 — solve the edge (populates the physics leg the split below reads).
  // Suppressed from undo history (reuses the existing _missionUndoRestoring
  // guard 575 already respects) so the whole authoring action lands as ONE
  // undo step, same contract as missionAddPhasingBurns.
  _missionUndoRestoring = true;
  try { missionRecompute(m); } finally { _missionUndoRestoring = false; }

  if (chainRole === 'inject' && entryEntry) _missionChainSplitInject(m, gid, entryIdx, idx0);

  m.groups = m.groups || {};
  if (entryEntry) {
    const g = m.groups[gid];
    g.name = `${entryEntry.fromLabel || entryEntry.fromNode} → ${lbl(toId, 'to')}`;
    g.route = { fromNode: entryEntry.fromNode, toNode: toId };
    g.hadInject = true;
  } else {
    m.groups[gid] = {
      kind: 'transfer',
      name: `${lbl(fromId, 'from')} → ${lbl(toId, 'to')}`,
      route: { fromNode: fromId, toNode: toId },
      hadInject: (chainRole === 'inject'),
    };
  }
  // §22 C2 staleness signature — re-checked every recompute (572), rewritten
  // by the group header's ↻ re-solve control. IMPORTANT: computed from the
  // group's OVERALL route (leo->nrho for a two-hop chain), NOT `res` (which
  // is only THIS edge's own endpoints, e.g. tlc->nrho on the closing hop) —
  // using `res` here would compare apples to oranges against the staleness
  // check's own progNmComputeEdgeDv(g.route...) read and false-positive on
  // every fresh authoring.
  {
    const finalG = m.groups[gid];
    const routeDv = (finalG.route && typeof progNmComputeEdgeDv === 'function')
      ? progNmComputeEdgeDv(finalG.route.fromNode, finalG.route.toNode) : res;
    const departMember = m.log.find(e => e.groupId === gid && e.chainRole === 'depart') || m.log[idx0];
    finalG.solved = { dv: routeDv ? routeDv.dv : 0, departMet: departMember ? departMember.metStart : null };
  }

  // PASS 2 — final settle with the mcc member (if any) + dvOverride in place.
  missionRecompute(m);
  _missionRenderPreserveNm(id);
}

// §22 C2: group-header ↻ re-solve — re-run the transfer solve with CURRENT
// authored inputs (departure MET, destination, vehicle state at entry) and
// rewrite the member events in place. ONE undo capture (never implicit).
function missionChainResolve(id, gid) {
  const m = _missionGet(id); if (!m || !m.groups || !m.groups[gid]) return;
  const g = m.groups[gid];
  if (g.kind !== 'transfer') return;
  let dIdx = -1, iIdx = -1, mIdx = -1;
  m.log.forEach((e, i) => {
    if (e.groupId !== gid) return;
    if (e.chainRole === 'depart') dIdx = i;
    else if (e.chainRole === 'inject') iIdx = i;
    else if (e.chainRole === 'mcc') mIdx = i;
  });
  if (dIdx < 0 && iIdx < 0) return;
  // Strip the transient mcc member + stamped overrides so the re-solve below
  // re-derives everything from current conditions, not stale cached numbers.
  if (mIdx >= 0) { m.log.splice(mIdx, 1); if (iIdx > mIdx) iIdx--; if (dIdx > mIdx) dIdx--; }
  if (iIdx >= 0) { delete m.log[iIdx].dvOverride; delete m.log[iIdx].durationOverride; }
  _missionUndoRestoring = true;
  try { missionRecompute(m); } finally { _missionUndoRestoring = false; }

  if (dIdx >= 0 && iIdx >= 0) _missionChainSplitInject(m, gid, dIdx, iIdx);

  const res = (g.route && typeof progNmComputeEdgeDv === 'function') ? progNmComputeEdgeDv(g.route.fromNode, g.route.toNode) : null;
  g.solved = { dv: res ? res.dv : 0, departMet: (dIdx >= 0 && m.log[dIdx]) ? m.log[dIdx].metStart : (iIdx >= 0 && m.log[iIdx] ? m.log[iIdx].metStart : null) };

  missionRecompute(m);
  missionRenderDetail();
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
  m.log.forEach((e, i) => { if (_evIsSolvedManeuver(e) && e.toNode === nodeId) target = i; });
  if (target < 0 && nodeId === _missionNodeForLaunch(m)) m.log.forEach((e, i) => { if (e.type === 'LAUNCH' || e.type === 'DEPLOY') target = i; });
  if (target >= 0) {
    // R5 item 3: route through the shared selection model (m.log[i]._expanded,
    // the same flag _trajSelectedAuthIdx reads) so selecting an orbit node here
    // also highlights the matching ring in the trajectory view.
    _missionNmSelectShared(id, target);
    missionRenderDetail();
    const tid = 'mlog-' + id + '-' + target;
    setTimeout(() => {
      const el = document.getElementById(tid);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '2px solid var(--accent)'; setTimeout(() => { el.style.outline = ''; }, 1500); }
    }, 60);
  }
}

// R5 item 3: single entry point both missionNodeClick and missionEdgeClick use
// to select a log event through the SAME selection state the trajectory view
// reads (_expanded → _trajSelectedAuthIdx) and the SAME gizmo hook the
// trajectory view's own ring/arc clicks use (_trajSelectEventFromView) — so a
// node-map click and a trajectory-view click land in identical state.
function _missionNmSelectShared(id, idx) {
  const m = _missionGet(id);
  if (!m || !m.log[idx]) return;
  m.log.forEach(e => { e._expanded = false; });
  m.log[idx]._expanded = true;
  if (typeof _trajGizmoOnEventSelected === 'function') _trajGizmoOnEventSelected(id, idx, m.log[idx]);
  // T4: opens/closes the orbit inspector for dwell-orbit selections; coexists
  // with the gizmo hook above (different UI surfaces — see 5746).
  if (typeof _oiOnEventSelected === 'function') _oiOnEventSelected(id, idx, m.log[idx]);
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
  _missionNmSelectShared(id, idx);   // R5 item 3: same selection state as trajectory view clicks
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
  const porkChip = (id != null && idx != null && typeof progPorkChipHTML === 'function') ? progPorkChipHTML(id, idx, entry.toNode) : '';
  // 5b R2 (MATH.md §7ae): an NRHO-bound leg with a co-orbital target vehicle
  // carries leg.phaseOptions (565's physSolveNrhoTransfer) — surface the
  // honest lattice choices as a compact radio-chip row. No target vehicle at
  // the ref -> leg.phaseOptions is null -> this row renders '' (5a behavior
  // unchanged, byte-identical card).
  const nrhoLeg = (id != null && idx != null && typeof physMissionLeg === 'function') ? physMissionLeg(id, idx) : null;
  const arrivalOptionsHTML = (nrhoLeg && nrhoLeg.kind === 'nrho' && Array.isArray(nrhoLeg.phaseOptions) && nrhoLeg.phaseOptions.length)
    ? _missionArrivalOptionsRowHTML(id, idx, entry, nrhoLeg) : '';
  return `<div class="mission-log-card">
    <div class="mission-log-header">
      <span class="mission-log-type">MANEUVER</span>
      ${statusChip}
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto">${entry.fromLabel} → ${entry.toLabel}</span>
      ${porkChip}
    </div>
    <div class="mission-state-grid">
      ${reqDisplay}
      ${delDisplay}
      ${propDisplay}
      ${methodDisplay}
    </div>
    ${marginal}
    ${arrivalOptionsHTML}
    ${builder}
  </div>`;
}

// 5b R2 UI (MATH.md §7ae): "T+4.7d · 4.32 km/s · Δφ 41m" radio chips — picking
// one persists e.arrivalOption (the option's tof_s, an AUTHORED field, replay-
// deterministic) and re-solves via missionRecompute; "auto" clears it back to
// the solver's own min-|Δφ| default. Follows the existing card row pattern
// (inline styles like the rest of this file's cards, no new CSS class rules).
function _missionArrivalOptionsRowHTML(id, idx, entry, leg) {
  const opts = leg.phaseOptions;
  const selTof = entry.arrivalOption;
  const chipHTML = (label, isSel, onchange) => `<label style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid ${isSel ? 'var(--accent)' : 'var(--border)'};font-family:var(--mono);font-size:9px;color:${isSel ? 'var(--accent)' : 'var(--text-dim)'};cursor:pointer;margin:0 4px 4px 0;">
    <input type="radio" name="mnode-arrival-${id}-${idx}" style="margin:0;" ${isSel ? 'checked' : ''} onchange="${onchange}">${label}</label>`;
  const autoActive = selTof == null;
  const autoChip = chipHTML('auto (min &Delta;&phi;)', autoActive, `missionClearArrivalOption('${id}',${idx})`);
  const chips = opts.map(o => {
    const isSel = selTof != null && Math.abs(o.tof_s - selTof) < 60;
    const days = (o.tof_s / 86400).toFixed(1);
    const dvKms = (o.dvTotal_ms / 1000).toFixed(2);
    const phaseTxt = (typeof _phaseFmtDt === 'function') ? _phaseFmtDt(o.phaseErr_s) : Math.round(o.phaseErr_s) + 's';
    return chipHTML(`T+${days}d &middot; ${dvKms} km/s &middot; &Delta;&phi; ${phaseTxt}`, isSel, `missionSetArrivalOption('${id}',${idx},${o.tof_s})`);
  }).join('');
  return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;">Arrival Options &mdash; phase-matched to co-orbital vehicle</div>
    <div>${autoChip}${chips}</div>
  </div>`;
}
function missionSetArrivalOption(id, idx, tof_s) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e) return;
  e.arrivalOption = tof_s;
  missionRecompute(m);
  missionRenderDetail();
}
function missionClearArrivalOption(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e) return;
  delete e.arrivalOption;
  missionRecompute(m);
  missionRenderDetail();
}
