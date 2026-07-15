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
      const orbitLine = os
        ? `<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${os.propagated ? (os.body || 'Moon') + ' · NRHO (propagated)' : os.surface ? (os.body || 'Earth') + ' surface' : `${os.body || 'Earth'} · ${Math.round(os.perigee ?? os.apogee ?? 0).toLocaleString()}×${Math.round(os.apogee ?? os.perigee ?? 0).toLocaleString()} km · ${(os.inclination || 0)}&deg;`}</span>`
        : '';
      return `<div style="display:flex;flex-direction:column;gap:4px;padding:6px 8px;border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};border-left:3px solid ${isActive ? 'var(--accent)' : 'var(--border)'};margin-bottom:4px;background:${isActive ? 'var(--accent-tint-strongest)' : 'transparent'};${expended ? 'opacity:.6;' : ''}">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
          <span style="flex-shrink:0;width:12px;font-size:11px;color:${isActive ? 'var(--accent3)' : 'var(--text-dim)'};">${isActive ? '●' : '○'}</span>
          <span style="font-family:var(--mono);font-size:11px;color:${isActive ? 'var(--accent3)' : 'var(--text-bright)'};font-weight:${isActive ? '600' : '400'};flex:1 1 100px;min-width:80px;white-space:normal;word-break:break-word;line-height:1.3;">${v.name}</span>
          <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${(v.stages || []).length} stages</span>
          ${expended ? `<span style="font-family:var(--mono);font-size:9px;color:var(--danger)">${v.status}</span>` : ''}
        </div>
        ${orbitLine ? `<div>${orbitLine}</div>` : ''}
        <div style="display:flex;gap:12px;font-family:var(--mono);font-size:9px;color:var(--text-dim);">
          <span>&Delta;V left: <span style="color:${v.remDv > 0 ? 'var(--accent3)' : 'var(--accent2)'}">${v.remDv.toLocaleString()} m/s</span></span>
          <span>Prop left: <span style="color:var(--text-bright)">${v.remProp.toLocaleString()} kg</span></span>
        </div>
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
        <span>Prop consumed: <span style="color:var(--text-bright)">${Math.round(propConsumed).toLocaleString()} kg</span></span>
        <span>&Delta;V left (active): <span style="color:${capColor}">${Math.round(capRem).toLocaleString()} m/s</span></span>
        <span>Payload: <span style="color:var(--text-bright)">${Math.round(payloadMass).toLocaleString()} kg</span></span>
      </div>`;

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
    const orbitLine = os
      ? `<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${os.propagated ? (os.body || 'Moon') + ' · NRHO (propagated)' : `${os.body || 'Earth'} · ${Math.round(os.perigee ?? os.apogee ?? 0).toLocaleString()}×${Math.round(os.apogee ?? os.perigee ?? 0).toLocaleString()} km · ${(os.inclination || 0)}&deg;`}</span>`
      : '';
    // whole row is clickable to make this the active vehicle; active = green
    return `<div onclick="missionSetActiveVehicle('${id}','${vid}')" title="Click to make active" style="display:flex;flex-direction:column;gap:4px;padding:6px 8px;border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};border-left:3px solid ${isActive ? 'var(--accent)' : 'var(--border)'};margin-bottom:4px;background:${isActive ? 'var(--accent-tint-strongest)' : 'transparent'};cursor:pointer;">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
        <span style="flex-shrink:0;width:12px;font-size:11px;color:${isActive ? 'var(--accent3)' : 'var(--text-dim)'};">${isActive ? '●' : '○'}</span>
        <span style="font-family:var(--mono);font-size:11px;color:${isActive ? 'var(--accent3)' : 'var(--text-bright)'};font-weight:${isActive ? '600' : '400'};flex:1 1 100px;min-width:80px;white-space:normal;word-break:break-word;line-height:1.3;">${_missionVehicleDisplayName(fv)}</span>
        <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${fv.stages.length} stages</span>
        ${expended ? '<span style="font-family:var(--mono);font-size:9px;color:var(--danger)">EXPENDED</span>' : ''}
        <button class="act-btn" style="padding:2px 6px;font-size:10px;flex-shrink:0;" onclick="event.stopPropagation();missionRenameVehicle('${id}','${fv._originKey || ''}')" title="Rename this vehicle">✎</button>
        <button class="act-btn" style="padding:2px 8px;font-size:10px;flex-shrink:0;" onclick="event.stopPropagation();missionExecExpendVehicle('${id}','${vid}')"${expended ? ' disabled' : ''}>Expend</button>
      </div>
      ${orbitLine ? `<div>${orbitLine}</div>` : ''}
      <div style="display:flex;gap:12px;font-family:var(--mono);font-size:9px;color:var(--text-dim);">
        <span>&Delta;V left: <span style="color:${remDv > 0 ? 'var(--accent3)' : 'var(--accent2)'}">${remDv.toLocaleString()} m/s</span></span>
        <span>Prop left: <span style="color:var(--text-bright)">${remProp.toLocaleString()} kg</span></span>
      </div>
    </div>`;
  }).join('');

  const b = missionBudget(m);
  const capColor = b.dvCapacityRemaining > 0 ? 'var(--accent3)' : 'var(--accent2)';
  const totals = `<div style="display:flex;flex-wrap:wrap;gap:4px 14px;padding-top:6px;margin-top:4px;border-top:1px solid var(--border);font-family:var(--mono);font-size:9px;color:var(--text-dim);">
      <span>&Delta;V expended: <span style="color:var(--text-bright)">${b.dvExpended.toLocaleString()} m/s</span></span>
      <span>Prop consumed: <span style="color:var(--text-bright)">${b.propConsumed.toLocaleString()} kg</span></span>
      <span>&Delta;V left (active): <span style="color:${capColor}">${b.dvCapacityRemaining.toLocaleString()} m/s</span></span>
      <span>Payload: <span style="color:var(--text-bright)">${b.payloadMass.toLocaleString()} kg</span></span>
      <span>Duration: <span style="color:var(--text-bright)">${_metFmt(m._metTotal)}</span></span>
    </div>`;

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

// ── Step 4: node-map view + MANEUVER events ───────────────────────────────────

function missionSetView(id, mode) {
  // R6.5 fix: leaving the trajectory view drops its cached starfield size
  // (see _trajStarfieldUnmount, 574) so a later return re-measures instead
  // of trusting a size cached while the panel was hidden/resized.
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
  const pr  = document.querySelector('.mcc-plan-rail .pr-body');   // U1: Plan rail (5749)
  const doc = document.scrollingElement || document.documentElement;
  return { nmL: nm ? nm.scrollLeft : 0, nmT: nm ? nm.scrollTop : 0,
           vaL: va ? va.scrollLeft : 0, vaT: va ? va.scrollTop : 0,
           prT: pr ? pr.scrollTop : 0,
           docT: doc ? doc.scrollTop : 0, docL: doc ? doc.scrollLeft : 0 };
}
function _missionRestoreScroll(s) {
  if (!s) return;
  const nm  = document.querySelector('.mcc-view-area .nm-scroll'); if (nm) { nm.scrollLeft = s.nmL; nm.scrollTop = s.nmT; }
  const va  = document.querySelector('.mcc-view-area'); if (va) { va.scrollLeft = s.vaL; va.scrollTop = s.vaT; }
  const pr  = document.querySelector('.mcc-plan-rail .pr-body'); if (pr) pr.scrollTop = s.prT || 0;
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

function missionExecManeuver(id, fromId, toId) {
  const m = _missionGet(id);
  if (!m || !fromId || !toId || fromId === toId) return;
  const res = progNmComputeEdgeDv(fromId, toId);
  const lbl = (nid, dir) => _missionManeuverNodeLabel(nid, dir);
  const actFv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  // copy the draft step program (if any) onto the new maneuver; empty → legacy single burn
  const steps = (_missionAddMv && Array.isArray(_missionAddMv.steps) && _missionAddMv.steps.length)
    ? _missionAddMv.steps.map(s => ({ ...s })) : undefined;
  // R6.2' Phase B (3a): the node-map bridge now authors the UNIFIED schema
  // directly — MNODE(mode:'solved', target) — instead of the legacy MANEUVER
  // literal. fromNode/toNode/fromLabel/toLabel stay mirrored at the top level
  // (every existing consumer that reads them directly, e.g. the maneuver
  // card/band label/node-map path builder, keeps working unchanged); dv
  // components start at 0 and are refreshed from the solved leg on the very
  // next recompute (display-only mirror, see physRebuildMissionTrajectories).
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
    ${builder}
  </div>`;
}
