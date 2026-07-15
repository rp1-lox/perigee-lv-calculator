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

// Library-vehicle launch picker: optgroups Built-in / My Vehicles / Program (legacy
// fleet entries, so old loaded programs keep working). Selecting a library vehicle
// runs the EXISTING snapshot path (_fleetVehicleSpecFromLib → new fleet entry) so
// ascent/staging math is untouched; selecting a Program entry just reuses it.
function missionPickLibVehicle(id, val) {
  const m = _missionGet(id); if (!m || !val) return;
  const [kind, ref] = val.split(':');
  let fleetId;
  if (kind === 'fleet') {
    fleetId = ref;   // existing fleet entry (legacy / already-snapshotted)
  } else {
    const spec = _fleetVehicleSpecFromLib(kind, parseInt(ref, 10));
    if (!spec) return;
    const entry = { fleetId: progUUID(), ...spec, payloads: [] };
    _fleetEntries.push(entry);
    fleetId = entry.fleetId;
  }
  missionSetFleet(id, fleetId);
  _missionRefreshLaunchModal(id);
}

function _missionLvPickerOptsHTML(selectedFleetId) {
  const opt = (val, label, sel) => `<option value="${val}"${sel ? ' selected' : ''}>${label}</option>`;
  let html = '<option value="">— select launch vehicle —</option>';
  if (BUILTIN_PRESETS && BUILTIN_PRESETS.length) {
    html += '<optgroup label="Built-in">' + BUILTIN_PRESETS.map((v, i) => opt('builtin:' + i, v.name, false)).join('') + '</optgroup>';
  }
  if (typeof userLVs !== 'undefined' && userLVs.length) {
    html += '<optgroup label="My Vehicles">' + userLVs.map((v, i) => opt('user:' + i, v.name, false)).join('') + '</optgroup>';
  }
  if (_fleetEntries.length) {
    html += '<optgroup label="Program">' + _fleetEntries.map(e =>
      opt('fleet:' + e.fleetId, e.name, e.fleetId === selectedFleetId)
    ).join('') + '</optgroup>';
  }
  return html;
}

function _missionLaunchParamsHTML(m) {
  const id = m.missionId;
  const lvOpts = _missionLvPickerOptsHTML(m.fleetEntryId);
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
      <select class="mcc-field-select" onchange="missionPickLibVehicle('${id}',this.value)">${lvOpts}</select>
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

// MISSION_MODEL_V2 Phase 2 S1 (F3 — deterministic replay identity): runtime
// vehicleIds default to a fresh progUUID() per replay, which dirties the
// autosave blob (m.log stamps e.vehicleId/e.lowerVehicleId/etc.) on every
// recompute even when nothing changed. `_originKey` is ALREADY a stable
// function of (authIdx, repetition) — see tagOwners/kid below — so rekey the
// runtime vehicleId to a deterministic derivative of it right after a
// FlightVehicle's _originKey is assigned, before anything reads/stamps
// fv.vehicleId. Same log + same replay ⇒ byte-identical vehicleIds every time.
function _missionRekeyVehicleId(fv, missionId) {
  if (!fv || !fv._originKey || !missionId) return fv;
  const newId = 'v_' + missionId + '_' + String(fv._originKey).replace(/[^A-Za-z0-9_:-]/g, '_');
  if (fv.vehicleId === newId) return fv;
  const oldId = fv.vehicleId;
  if (oldId && PROG_ACTIVE_PROGRAM.vehicles[oldId] === fv) delete PROG_ACTIVE_PROGRAM.vehicles[oldId];
  fv.vehicleId = newId;
  PROG_ACTIVE_PROGRAM.vehicles[newId] = fv;
  return fv;
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
    ? lvPerformance(entry.stageData, entry.boosterGroups || entry.boosterData || null, payloadMass, entry.fairingMass || 0, 0, launchOrbit.alt_km, 0, 28.5, 37, 112)
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
    ? lvMaxPayload(entry.stageData, entry.boosterGroups || entry.boosterData || null, entry.fairingMass || 0, 0, launchOrbit.alt_km, 0, 28.5, 37, 112)
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
    burnTime:    perf ? perf.tBT : null,   // seconds — T1 mission-clock ascent duration
  };

  return { fv, stagingResult, payloadMass, payloadNames };
}

function _missionApplyDeploy(m, e, metNow) {
  e = e || {};
  // DEPLOY places a single SPACECRAFT directly in orbit (e.g. a station like the
  // ISS) — no launch vehicle, no ascent staging, full tanks.
  const sc = _scEdSC.find(s => s.spacecraftId === e.spacecraftId);
  if (!sc) return null;
  const allStages = progSpacecraftToLiveStages(sc);
  // Optionally deploy with EMPTY tanks (a dry depot to be filled by prop transfer later).
  if (e.emptyTanks) allStages.forEach(st => (st.tanks || []).forEach(t => { t.fill = 0; }));
  const o = e.orbit || m.launchOrbit || {};
  let orbitState;
  if (o.propagated && o.refId) {
    // Phase 4 U3: deploy ON the propagated ref — sample it at the event's own
    // MET (phase into the period) rather than always the seed epoch, so a
    // DEPLOY authored later in the timeline still lands somewhere ON the loop.
    const st0 = (typeof refOrbitPropagatedStateAt === 'function') ? refOrbitPropagatedStateAt(o.refId, metNow || 0) : null;
    orbitState = {
      body: o.body, propagated: true, refId: o.refId,
      r: st0 ? st0.r : null, v: st0 ? st0.v : null, frame: st0 ? st0.frame : o.body,
      perigee: null, apogee: null, inclination: null, lan: null, epoch: 0, surface: false,
    };
  } else {
    orbitState = { body: o.body, perigee: o.alt_km, apogee: (o.apo_km ?? o.alt_km), inclination: o.inc_deg, lan: o.lan_deg, epoch: 0, surface: false };
  }
  const fv = progMakeFlightVehicle(sc.name, allStages, orbitState, '#e5c07b');
  fv.status = 'ORBIT';
  PROG_ACTIVE_PROGRAM.vehicles[fv.vehicleId] = fv;
  const payloadMass = (typeof progVehicleTotalMass === 'function') ? progVehicleTotalMass(fv) : 0;
  return { fv, payloadMass, payloadNames: [sc.name] };
}

function missionExecLaunch(id, opts) {
  const m = _missionGet(id);
  if (!m || !m.fleetEntryId) return;
  const entry = _fleetGet(m.fleetEntryId);
  if (!entry) return;
  m.log.push({ type: 'LAUNCH', label: entry.name, fleetEntryId: m.fleetEntryId, payloadScIds: [...(m.payloadScIds||[])], launchOrbit: { ...m.launchOrbit }, orbit: { ...m.launchOrbit } });
  _missionAddEvt = null;  _missionExpandLast(m);
  missionRecompute(m);
  missionRenderDetail();
  // prompt the user to name the freshly-launched vehicle (skippable → keeps auto name).
  // Suppressed when called programmatically (e.g. devSeedApolloMission) via opts.silent —
  // an unattended script shouldn't pop a UI modal the caller can't dismiss.
  if (opts && opts.silent) return;
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

function _missionConfirmReset(id) {
  const m = _missionGet(id);
  const label = m ? m.name : 'this mission';
  showConfirm('Reset Mission', `Clear all events for "${label}"? This cannot be undone.`, () => missionResetLaunch(id), 'Reset');
}

function _missionConfirmDelete(id) {
  const m = _missionGet(id);
  const label = m ? m.name : 'this mission';
  showConfirm('Delete Mission', `Delete "${label}"? This cannot be undone.`, () => missionDelete(id), 'Delete');
}

// ── Export menu (topbar "Export ▾") — tiny module-scoped open/close handler ──
let _missionExportMenuOpen = false;
function _missionToggleExportMenu(evt) {
  if (evt) evt.stopPropagation();
  _missionExportMenuOpen ? _missionCloseExportMenu() : _missionOpenExportMenu();
}
function _missionOpenExportMenu() {
  _missionExportMenuOpen = true;
  const menu = document.getElementById('mcc-export-menu');
  if (menu) menu.classList.add('open');
  document.addEventListener('click', _missionExportMenuOutsideClick);
}
function _missionCloseExportMenu() {
  _missionExportMenuOpen = false;
  const menu = document.getElementById('mcc-export-menu');
  if (menu) menu.classList.remove('open');
  document.removeEventListener('click', _missionExportMenuOutsideClick);
}
function _missionExportMenuOutsideClick(e) {
  const wrap = document.querySelector('.mcc-export-wrap');
  if (wrap && !wrap.contains(e.target)) _missionCloseExportMenu();
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
  // a vehicle with exactly ONE stage is named by that stage's own label (e.g. a
  // separated "LM Descent Stage"), not the parent spacecraft + counter — whether
  // it's an LV stage or a lone spacecraft stage.
  if (fv.stages.length === 1) {
    const s = fv.stages[0];
    return s._ownerLabel || _missionStageLabelById(s.stageDefinitionId);
  }
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

// MISSION_MODEL_V2 Phase 2 S4 (§11.2 step 3): missionBudget delegates to
// v2DeriveBudget (the simulated-state readout) + the ascent line it already
// carries (F2). The old per-entry summation over m.log is DELETED — this is
// also what retires the 2026-07-11 aggregate-undercount anomaly (a manual
// 200 m/s burn moving the total by +3), since the path that produced it no
// longer exists. Payload mass and ascent propellant are read straight off
// the LAUNCH entry's stagingResult (unchanged source, §11.1 F2) since
// v2DeriveBudget's propTotal only covers burns, not the ascent stage.
function missionBudget(m) {
  const vb = (typeof v2DeriveBudget === 'function' && m && m.missionId) ? v2DeriveBudget(m.missionId) : null;
  let dvExpended = 0, propConsumed = 0, payloadMass = 0;
  if (vb) {
    dvExpended = vb.dvTotal;
    propConsumed = vb.propTotal;
    for (const e of (m.log || [])) {
      if (e.type !== 'LAUNCH') continue;
      const sr = e.stagingResult || {};
      propConsumed += (sr.stages || []).reduce((s, st) => s + (st.propBurned || 0), 0);
      payloadMass = e.payloadMass || payloadMass;
    }
  } else {
    // Fallback for a mission with no v2 side-table yet (e.g. missionBudget
    // called before the first recompute) — same summation V1 used to do
    // unconditionally.
    for (const e of (m.log || [])) {
      if (e.type === 'LAUNCH') {
        const sr = e.stagingResult || {};
        dvExpended  += sr.dvDelivered || 0;
        propConsumed += (sr.stages || []).reduce((s, st) => s + (st.propBurned || 0), 0);
        payloadMass  = e.payloadMass || payloadMass;
      } else if (e.type === 'BURN' || e.type === 'MNODE') {
        dvExpended  += e.dv_actual || 0;
        propConsumed += e.prop_consumed || 0;
      }
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
  // §14 U3: a propagated orbit (NRHO) has no Kepler peri/apo/inc — an honest
  // label beats wrong ellipse numbers (spec's own phrasing).
  const orbitGrid = _os && _os.propagated
    ? `<div class="mission-state-grid">${kv('Body', _os.body || 'Moon')}${kv('Orbit', 'NRHO (propagated)')}</div>`
    : _os ? `<div class="mission-state-grid">${kv('Body', _os.body || 'Earth')}${kv('Apogee', Math.round(_os.apogee || 0).toLocaleString() + ' km')}${kv('Perigee', Math.round(_os.perigee ?? _os.apogee ?? 0).toLocaleString() + ' km')}${kv('Inc', (_os.inclination || 0) + '&deg;')}</div>` : '';
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

function missionExecLowThrust(id) {
  const m = _missionGet(id);
  if (!m || !m.vehicleId) return;
  const durVal  = parseFloat(document.getElementById('addev-lt-dur-' + id)?.value) || 0;
  const durUnit = document.getElementById('addev-lt-dur-unit-' + id)?.value || 'd';
  const law     = document.getElementById('addev-lt-law-' + id)?.value || 'prograde';
  const throttle = Math.max(0, Math.min(1, parseFloat(document.getElementById('addev-lt-throttle-' + id)?.value)));
  m.log.push({ type: 'LOWTHRUST', duration_s: _missionDurationToSeconds(durVal, durUnit), law, throttle: isFinite(throttle) ? throttle : 1 });
  _missionAddEvt = null; _missionExpandLast(m);
  missionRecompute(m);
  missionRenderDetail();
}

// ── MISSION_MODEL_V2 §19 E3 — low-thrust dual pricing (node-map est. lane) ──
// The mission's acting vehicle's ACTIVE (top) stage, if it is EP-capable
// (XENON_EP + positive ep_thrust_N/ep_isp_s), else null. Same "active stage"
// convention as the LOWTHRUST recompute case.
function _missionActiveEpStage(m) {
  const fv = m && m.vehicleId && typeof PROG_ACTIVE_PROGRAM !== 'undefined'
    ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  const stage = fv && fv.stages && fv.stages.length ? fv.stages[fv.stages.length - 1] : null;
  if (!stage || typeof ltReadinessCheck !== 'function') return null;
  return ltReadinessCheck(stage).ok ? stage : null;
}

// Full-form Edelbaum est. for a node-map edge (MATH.md §7aa): coplanar-ish
// circular/elliptic orbits of the SAME body only (the regime Edelbaum's
// circular-to-circular form covers — transit/escape/surface edges return
// null, the impulsive lane is the only honest price there). PARALLEL readout
// ONLY — progNmComputeEdgeDv's impulsive accounting is never touched (frozen
// rule). Returns { dv_ms, tof_s, di_deg } or null.
function _missionLtEdgeEstimate(m, fromId, toId) {
  const stage = _missionActiveEpStage(m);
  if (!stage || typeof ltEdelbaumFullDv !== 'function') return null;
  const nA = _missionNmNodeById(fromId), nB = _missionNmNodeById(toId);
  const oa = nA && nA.orbit, ob = nB && nB.orbit;
  if (!oa || !ob || oa.body !== ob.body) return null;
  const okType = t => t === 'circular' || t === 'elliptic';
  if (!okType(oa.type) || !okType(ob.type)) return null;
  const b = PROG_BODIES[oa.body]; if (!b) return null;
  const meanR = o => b.R + (((o.perigee ?? o.apogee ?? 0) + (o.apogee ?? o.perigee ?? 0)) / 2);
  const v0 = Math.sqrt(b.mu / meanR(oa)), v1 = Math.sqrt(b.mu / meanR(ob));
  const di = Math.abs((oa.inclination || 0) - (ob.inclination || 0));
  const dv_kms = ltEdelbaumFullDv(v0, v1, di);
  const ep = { thrust_N: stage.ep_thrust_N, isp_s: stage.ep_isp_s, m0_kg: progStageMass(stage), mDry_kg: stage.dry_mass };
  const tof = ltEdelbaumTofEst(dv_kms, ep);
  return { dv_ms: dv_kms * 1000, tof_s: tof.tof_s, di_deg: di };
}

// One-line HTML fragment for the dual-pricing readout ('' when not applicable).
function _missionLtEdgeEstHTML(m, fromId, toId) {
  const est = (fromId && toId) ? _missionLtEdgeEstimate(m, fromId, toId) : null;
  if (!est) return '';
  const tofTxt = est.tof_s != null ? ` &middot; TOF ${(est.tof_s / 86400).toFixed(1)} d` : ' &middot; exceeds tank capacity';
  return `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:3px;">&#x26A1; low-thrust est.: <b style="color:var(--text-bright)">${Math.round(est.dv_ms).toLocaleString()} m/s</b>${tofTxt} <span style="color:var(--text-dim);">(Edelbaum, &Delta;i ${est.di_deg.toFixed(1)}&deg;)</span></div>`;
}

// Insert a LOWTHRUST event pre-filled from the node-map est. (the Add-Event
// maneuver form's "Add as Low-Thrust instead" button) — follows
// missionExecLowThrust's authoring shape exactly; duration comes from the
// Edelbaum TOF est., law from the transfer direction (raise vs lower).
function missionExecLowThrustFromEdge(id) {
  const m = _missionGet(id); if (!m || !m.vehicleId) return;
  const fromId = document.getElementById('addev-mvf-' + id)?.value;
  const toId = document.getElementById('addev-mvt-' + id)?.value;
  const est = (fromId && toId) ? _missionLtEdgeEstimate(m, fromId, toId) : null;
  if (!est || est.tof_s == null) return;
  const nA = _missionNmNodeById(fromId), nB = _missionNmNodeById(toId);
  const meanAlt = o => ((o.perigee ?? o.apogee ?? 0) + (o.apogee ?? o.perigee ?? 0)) / 2;
  const law = meanAlt(nB.orbit) >= meanAlt(nA.orbit) ? 'prograde' : 'retrograde';
  m.log.push({ type: 'LOWTHRUST', duration_s: Math.round(est.tof_s), law, throttle: 1 });
  _missionAddEvt = null; _missionAddMv = { from: null, to: null, steps: [] };
  _missionExpandLast(m);
  missionRecompute(m);
  missionRenderDetail();
}

// Re-author the duration/law/throttle on an existing LOWTHRUST entry (mirrors
// missionApplyDurationOverride's pattern) — any edit changes the est-lane
// signature inputs, so the next recompute will find the computed cache (if
// any) STALE via ltSignature, never silently reusing a mismatched result.
function missionEditLowThrust(id, idx, field, val) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LOWTHRUST') return;
  if (field === 'duration_s') e.duration_s = Math.max(0, +val || 0);
  else if (field === 'law') e.law = val === 'retrograde' ? 'retrograde' : 'prograde';
  else if (field === 'throttle') e.throttle = Math.max(0, Math.min(1, +val || 0));
  missionRecompute(m);
  missionRenderDetail();
}

// "Compute trajectory" — the expensive integrated lane, run ONLY on explicit
// user action (never inside missionRecompute; see the compute-button contract,
// MISSION_MODEL_V2 §19). Chunked via rAF so the UI progress bar is honest and
// the run is cancellable; the result lands in 568's signature-keyed side-table
// and triggers exactly ONE missionRecompute on completion so downstream state
// (budget, orbit) picks up the computed end-state (stale-by-one recompute
// pattern, same as 570's physics-TOF convergence pass).
let _ltRunState = null;   // { id, authIdx, cancelled } — one run at a time
function ltCancelCompute() {
  if (_ltRunState) _ltRunState.cancelled = true;
}
function ltComputeTrajectory(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LOWTHRUST') return;
  if (!e._ltReady) { missionRenderDetail(); return; }
  const fv = e.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[e.vehicleId] : null;
  const stage = fv && fv.stages.length ? fv.stages[fv.stages.length - 1] : null;
  const ob = e.orbitBefore;
  if (!fv || !stage || !ob || typeof physPropagateSegment !== 'function') return;

  const body = ob.body;
  const altKm = ob.perigee ?? ob.apogee ?? 0;
  const bodyDef = PROG_BODIES[body];
  const v0 = (typeof progVcirc === 'function') ? progVcirc(body, altKm) : 0;
  const r0 = [bodyDef.R + altKm, 0, 0];
  const v0v = [0, v0, 0];
  const m0 = progStageMass(stage);
  const throttle = e.throttle == null ? 1 : e.throttle;
  const law = e.law === 'retrograde' ? 'retrograde' : 'prograde';
  const durTotal = Math.max(0, e.duration_s || 0);
  const CHUNK_S = 2 * 86400;   // 2-day slices per spec

  const run = { id, authIdx: idx, cancelled: false, tSim: 0, r: r0, v: v0v, m: m0, samples: [] };
  _ltRunState = run;
  e._ltComputing = true; e._ltProgress = 0;
  missionRenderDetail();

  function step() {
    if (run.cancelled) { e._ltComputing = false; missionRenderDetail(); return; }
    const chunkEnd = Math.min(durTotal, run.tSim + CHUNK_S);
    const ctx = { center: body, bodies: [body],
      thrust: { thrust_N: stage.ep_thrust_N * throttle, isp_s: stage.ep_isp_s, m0_kg: run.m, law, mDry_kg: stage.dry_mass } };
    // Single-frame v1 (documented limit): a real months-long spiral can cross
    // SOI boundaries in principle, but v1's authored use case is a body-centric
    // raise/lower, so the chunked compute pins ctx.center for the whole run
    // (opts.singleFrame, same knob E1's own gate uses) rather than handling a
    // mid-spiral SOI handoff — a genuine gap, noted in MATH.md §7z critiques.
    // E3: maxSamples 512/chunk (~16 samples/rev at LEO for a 2-day/~32-rev
    // chunk) so the rev-boundary resampler below has real per-rev fidelity to
    // keep for the head/tail revs — 256 was fine when nothing rendered (E2).
    const res = physPropagateSegment({ r: run.r, v: run.v, m: run.m }, run.tSim, chunkEnd, ctx, { singleFrame: true, maxSamples: 512 });
    if (res && res.stateF) {
      run.r = res.stateF.r; run.v = res.stateF.v; run.m = res.stateF.m != null ? res.stateF.m : run.m;
      run.dvAccum = (run.dvAccum || 0) + (res.dvAccum || 0);
      run.depleted = run.depleted || !!res.propDepleted;
      // E3 spiral rendering: accumulate the chunk's samples (t is burn-relative
      // seconds — the run passes a continuous t axis chunk to chunk). The full
      // array is resampled ONCE at completion (rev-boundary LOD, 568), never
      // stored raw — a 30-day LEO spiral would otherwise hold ~8k samples.
      if (res.samples && res.samples.length) {
        for (const s of res.samples) run.samples.push({ t: s.t, r: s.r });
      }
    }
    run.tSim = chunkEnd;
    e._ltProgress = durTotal > 0 ? run.tSim / durTotal : 1;

    if (run.tSim >= durTotal || run.depleted) {
      const propUsed = Math.max(0, m0 - run.m);
      const sig = e._ltSig;   // signature computed by the est. lane this same recompute cycle
      // E3: rev-boundary LOD resample (568) — head/tail keep per-rev fidelity
      // (first/last ~8 revs), the dense middle decimates to ~1 sample/rev for
      // the envelope-band renderer (574). body rides along so the renderer
      // knows which frame pass owns this spiral.
      const lod = (typeof ltResampleSpiralRevs === 'function')
        ? ltResampleSpiralRevs(run.samples, 8, 8) : { head: run.samples, mid: [], tail: [], revCount: 0 };
      ltStoreComputedLeg(id, idx, { sig, dvAccum_kms: run.dvAccum || 0, mF_kg: run.m, propUsed_kg: propUsed, tof_s: run.tSim,
        body, samplesLod: lod });
      e._ltComputing = false; _ltRunState = null;
      missionRecompute(m);       // ONE recompute — downstream state now consumes the computed lane
      missionRenderDetail();
      return;
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step);
    else setTimeout(step, 0);
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step);
  else setTimeout(step, 0);
}

function missionApplyBurnEdit(id, idx) {
  const m = _missionGet(id); if(!m) return;
  const e = m.log[idx]; if(!e || e.type!=='BURN') return;
  const bt = document.getElementById('edit-burn-type-'+id)?.value || e.burnType;
  const pval = parseFloat(document.getElementById('edit-burn-param-'+id)?.value) || 0;
  e.burnType = bt; e.burnParam = pval;
  missionRecompute(m);
  missionRenderDetail();
}

function missionApplyManeuverEdit(id, idx) {
  const m = _missionGet(id); if(!m) return;
  const e = m.log[idx]; if(!e || !_evIsSolvedManeuver(e)) return;
  const from = document.getElementById('edit-mv-from-'+id)?.value || e.fromNode;
  const to   = document.getElementById('edit-mv-to-'+id)?.value || e.toNode;
  e.fromNode = from; e.toNode = to;
  e.fromLabel = _missionManeuverNodeLabel(from, 'from'); e.toLabel = _missionManeuverNodeLabel(to, 'to');
  e.target = { fromNode: from, toNode: to };
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

// ── R6.3: launch-site + launch-time -> RAAN authoring (MATH.md §7k) ──────────
// Flat [{name,short,lat,lon}] of every built-in site, for the LAUNCH card's
// site picker. Sites without lon (shouldn't happen post-R6.3, but a custom/
// legacy site could still lack it) are filtered — the picker only offers
// sites the geometry math can actually use; a null e.site just degrades the
// whole geo block to "no site" (no throw, see _missionLaunchGeoHTML).
function _missionLaunchSiteChoices() {
  return (typeof LAUNCH_SITES !== 'undefined' ? LAUNCH_SITES : [])
    .flatMap(region => region.sites)
    .filter(s => s.lon != null)
    .map(s => ({ name: s.name, short: s.short, lat: s.lat, lon: s.lon }));
}
// Earth spin angle (rad) at absolute time tSec, self-consistent with the
// rotating globe (574's _trajBodySpinAngle) when that module is loaded;
// falls back to the same literal constant if 574 hasn't loaded yet (test
// harness / very early UI paint) so this never throws.
function _missionEarthSpinRad(tSec) {
  if (typeof _trajBodySpinAngle === 'function') return _trajBodySpinAngle('Earth', tSec);
  return (tSec / 86164.1) * 2 * Math.PI;
}
// The site currently associated with a LAUNCH event: authored on the event
// itself, else inherited from the picked fleet entry's vehicle site, else null.
function _missionLaunchSiteFor(e) {
  if (e.site) return e.site;
  const f = e.fleetEntryId ? _fleetGet(e.fleetEntryId) : null;
  return (f && f.site && f.site.lat != null) ? f.site : null;
}
function _missionLaunchGeoHTML(m, idx, e) {
  const id = m.missionId;
  const _es = 'background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;';
  const site = _missionLaunchSiteFor(e);
  const choices = _missionLaunchSiteChoices();
  const siteOpts = ['<option value="">— no site (RAAN unauthored) —</option>',
    ...choices.map(s => `<option value="${_tsEsc(s.short)}"${site && site.short === s.short ? ' selected' : ''}>${_tsEsc(s.name)} (${s.lat}&deg;, ${s.lon}&deg;)</option>`)].join('');
  const o = e.orbit || {};
  const hasTime = e.launchTime_s != null && e.launchTime_s !== '';
  const dtVal = hasTime && typeof progMissionTimeToDate === 'function'
    ? progDateToLocalInputValue(progMissionTimeToDate(+e.launchTime_s)) : '';
  const epochDateTxt = (typeof progEpochJD === 'function' && typeof progJDToDate === 'function')
    ? progJDToDate(progEpochJD()).toUTCString().replace(':00 GMT', ' UTC')
    : '';
  const launchDateTxt = hasTime ? progJDToDate(progEpochJD() + (+e.launchTime_s) / 86400).toUTCString().replace(':00 GMT', ' UTC') : '';
  return `
    <div class="cfg-row" style="flex-wrap:wrap;gap:8px 14px;align-items:flex-end;margin-bottom:8px;">
      <div class="cfg-item"><label class="cfg-label">Launch Site</label>
        <select id="edit-launch-site-${id}" style="${_es}" onchange="missionLaunchGeoUpdate('${id}',${idx})">${siteOpts}</select></div>
      <div class="cfg-item"><label class="cfg-label">Launch Time (UTC)</label>
        <input type="datetime-local" id="edit-launch-time-${id}" class="field" data-raw-s="${hasTime ? e.launchTime_s : ''}" value="${dtVal}" style="width:190px;${_es}" onchange="missionLaunchGeoUpdate('${id}',${idx})">
        <button type="button" class="act-btn" style="padding:2px 8px;font-size:9px;margin-left:4px;" onclick="missionLaunchClearTime('${id}',${idx})" title="unauthor launch time (RAAN reverts to manual)">&times; clear</button></div>
    </div>
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:4px;">
      Program epoch: <span style="color:var(--text-bright);">${_mrEsc(epochDateTxt)}</span>
      ${launchDateTxt ? ` &middot; this launch: <span style="color:var(--text-bright);">${_mrEsc(launchDateTxt)}</span> (MET +${(+e.launchTime_s).toLocaleString()} s)` : ''}
    </div>
    <div id="launch-geo-readout-${id}" style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px;">${_missionLaunchGeoReadoutHTML(site, o.inc_deg, e.launchTime_s, o.lan_deg)}</div>`;
}
// LAN field, relocated to sit alongside Inc (feedback item 4) instead of
// buried in the separate launch-geo block. Always shows an effective value
// (defaults to 0, never blank) and labels whether it's a manual authored
// value or derived from the launch site + time.
function _missionLaunchLanFieldHTML(m, idx, e) {
  const id = m.missionId;
  const o = e.orbit || {};
  const lanDerived = !!(e.launchTime_s != null && e.launchTime_s !== '' && o._lanFromLaunchTime);
  const lanVal = (o.lan_deg != null) ? o.lan_deg : 0;
  return `<div class="cfg-item"><label class="cfg-label">LAN &Omega; (deg)${lanDerived ? ' <span style="color:var(--text-dim);">(from launch time)</span>' : ''}</label>
    <input type="number" id="edit-launch-lan-${id}" class="field" value="${lanVal}" step="any" style="width:100px;${lanDerived ? 'color:var(--text-dim);' : ''}" oninput="missionLaunchGeoManualLan('${id}',${idx})"></div>`;
}
// "Match plane" picker (feedback item 2) — offers the Moon's current
// orbital plane (from its ephemeris state at the launch epoch) and any
// catalog reference orbit with a defined (non-null) inclination. Picking
// one fills inc/LAN — still user-overridable afterward, same philosophy as
// R7's "Plan for destination." Surfaces an unreachable-at-this-latitude
// warning rather than silently clamping (per the feedback).
function _missionLaunchPlaneMatchHTML(m, idx, e) {
  const id = m.missionId;
  const _es = 'background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;';
  const catalog = (typeof _refOrbitAllEntries === 'function') ? _refOrbitAllEntries() : [];
  const planeEntries = catalog.filter(o => o.kind === 'keplerian' && isFinite(o.inc));
  const opts = ['<option value="">— match plane —</option>', '<option value="Moon">Moon (current plane)</option>',
    ...planeEntries.map(o => `<option value="${_tsEsc(o.id)}">${_tsEsc(o.name)}${o.lan != null ? '' : ' (LAN free)'}</option>`)].join('');
  return `<div class="cfg-item"><label class="cfg-label">&nbsp;</label>
    <select id="edit-launch-planematch-${id}" style="${_es}" onchange="missionLaunchMatchPlane('${id}',${idx},this.value)">${opts}</select></div>`;
}
// Fills inc/LAN from the picked plane target. Warns (not clamps) if the
// site latitude exceeds the plane's inclination — that combination is a
// real dogleg/unreachable case, not something to silently fix up.
function missionLaunchMatchPlane(id, idx, targetVal) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LAUNCH') return;
  if (!targetVal) return;
  const siteShort = document.getElementById('edit-launch-site-' + id)?.value;
  const site = siteShort ? _missionLaunchSiteChoices().find(s => s.short === siteShort) : _missionLaunchSiteFor(e);
  const siteLat = site ? site.lat : 28.5;
  const tRaw = document.getElementById('edit-launch-time-' + id)?.dataset.rawS;
  const t_s = (tRaw !== '' && tRaw != null) ? +tRaw : 0;
  const epochJD = (typeof progEpochJD === 'function') ? progEpochJD() : PROG_DEFAULT_EPOCH_JD;
  let target = targetVal;
  if (targetVal !== 'Moon') {
    const entry = (typeof _refOrbitAllEntries === 'function') ? _refOrbitAllEntries().find(o => o.id === targetVal) : null;
    if (!entry) return;
    target = { inc: entry.inc, lan: entry.lan, name: entry.name };
  }
  if (typeof progResolvePlaneTarget !== 'function') return;
  const res = progResolvePlaneTarget(target, epochJD, t_s, siteLat);
  if (!res) return;
  const setV = (fid, v) => { const el = document.getElementById(fid + '-' + id); if (el != null && v != null) el.value = v; };
  setV('edit-launch-inc', res.inc_deg.toFixed(2));
  setV('edit-launch-lan', res.lan_deg.toFixed(2));
  const lanField = document.getElementById('edit-launch-lan-' + id);
  const lanLabel = lanField && lanField.closest('.cfg-item')?.querySelector('.cfg-label');
  if (lanLabel) {
    lanLabel.innerHTML = res.unreachable
      ? `LAN &Omega; (deg) <span style="color:var(--danger);">(matched to ${_mrEsc(res.source)} — UNREACHABLE at site lat ${siteLat}&deg;, penalty ${res.penalty_deg.toFixed(1)}&deg;)</span>`
      : `LAN &Omega; (deg) <span style="color:var(--text-dim);">(matched to ${_mrEsc(res.source)})</span>`;
  }
  const incField = document.getElementById('edit-launch-inc-' + id);
  if (incField) missionLaunchOrbitDetach(id, idx);
}
// Clear button for the datetime-local field (native inputs have no easy
// "unset" affordance) — reverts to unauthored launch time (LAN frees up to
// manual, matching the old empty-field behavior).
function missionLaunchClearTime(id, idx) {
  const t = document.getElementById('edit-launch-time-' + id);
  if (t) { t.value = ''; t.dataset.rawS = ''; }
  missionLaunchGeoUpdate(id, idx);
}
// ── R7 phase 1: "Plan for destination" — auto-set the ideal parking orbit ──
// A launch's parking orbit should be the plane that sets up the lowest-DV
// departure toward a destination. This block picks a destination + optional
// departure date, calls the pure planner (progPlanLaunchToDestination, 415),
// and FILLS the inc/LAN/alt fields + launch time — all of which stay editable
// (Apply commits whatever's in the fields). Nothing here mutates m.log; the
// only persisted state is e.planDest/e.planDepJD, written by missionApplyLaunchEdit.
function _missionLaunchPlanHTML(m, idx, e) {
  const id = m.missionId;
  const _es = 'background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;';
  // Moon routes through the geocentric cislunar plane math (progMoonPlaneAt)
  // inside progPlanLaunchToDestination rather than the heliocentric Lambert
  // scan the other bodies use — see 415's Moon branch.
  const dests = ['Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
  const cur = e.planDest || '';
  const destOpts = ['<option value="">&mdash; none (manual orbit) &mdash;</option>',
    ...dests.map(d => `<option value="${d}"${d === cur ? ' selected' : ''}>${d}</option>`)].join('');
  const depVal = (e.planDepJD != null && e.planDepJD !== '') ? e.planDepJD : '';
  const initReadout = e.planDest
    ? `// planned for ${_mrEsc(e.planDest)} &mdash; click Optimize to recompute the ideal parking orbit`
    : '// choose a destination to auto-set the ideal parking-orbit plane (inc/&Omega;) for the lowest-&Delta;V departure &mdash; every field stays editable';
  return `
    <div class="cfg-row" style="flex-wrap:wrap;gap:8px 14px;align-items:flex-end;margin-bottom:8px;padding:8px;background:var(--accent-tint-faint);border-radius:3px;">
      <div class="cfg-item"><label class="cfg-label">Plan for destination</label>
        <select id="edit-launch-dest-${id}" style="${_es}">${destOpts}</select></div>
      <div class="cfg-item"><label class="cfg-label">Depart (JD)</label>
        <input type="number" id="edit-launch-depjd-${id}" class="field" placeholder="auto (min &Delta;V)" value="${depVal}" step="any" style="width:120px;"></div>
      <button class="act-btn" style="padding:4px 12px;" onclick="missionLaunchPlanOptimize('${id}',${idx})">&#x27F3; Optimize parking orbit</button>
    </div>
    <div id="launch-plan-readout-${id}" style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px;line-height:1.5;">${initReadout}</div>`;
}
// Optimize handler: runs the planner and fills the DOM fields (no commit until
// Apply). Uses the site currently picked in THIS card (falls back to the
// event's site) so azimuth/launch-window reflect the user's in-progress choice.
function missionLaunchPlanOptimize(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LAUNCH') return;
  const readEl = document.getElementById('launch-plan-readout-' + id);
  const setReadout = html => { if (readEl) readEl.innerHTML = html; };
  const dest = document.getElementById('edit-launch-dest-' + id)?.value;
  if (!dest) { setReadout('// no destination selected &mdash; pick one, then Optimize'); return; }
  if (typeof progPlanLaunchToDestination !== 'function') { setReadout('// planner module unavailable'); return; }
  const siteShort = document.getElementById('edit-launch-site-' + id)?.value;
  const site = siteShort ? _missionLaunchSiteChoices().find(s => s.short === siteShort) : _missionLaunchSiteFor(e);
  const siteLat = site ? site.lat : 28.5;
  const altKm = +document.getElementById('edit-launch-alt-' + id)?.value || 185;
  const depRaw = document.getElementById('edit-launch-depjd-' + id)?.value;
  const epochJD = (typeof PROG_ACTIVE_PROGRAM !== 'undefined' && isFinite(PROG_ACTIVE_PROGRAM.epochJD))
    ? PROG_ACTIVE_PROGRAM.epochJD : (typeof PROG_DEFAULT_EPOCH_JD !== 'undefined' ? PROG_DEFAULT_EPOCH_JD : 2461230.5);
  let plan;
  try {
    plan = progPlanLaunchToDestination({ fromBody: 'Earth', destBody: dest, epochJD, siteLatDeg: siteLat, altKm,
      tDepartJD: (depRaw !== '' && depRaw != null) ? +depRaw : undefined });
  } catch (err) { setReadout('// planner error: ' + _mrEsc(String((err && err.message) || err))); return; }
  if (!plan || plan.inc_deg == null) { setReadout('// ' + _mrEsc((plan && plan.note) || 'no solution for this destination')); return; }
  const setV = (fid, v) => { const el = document.getElementById(fid + '-' + id); if (el != null && v != null) el.value = v; };
  setV('edit-launch-inc', plan.inc_deg.toFixed(2));
  setV('edit-launch-lan', plan.lan_deg.toFixed(2));
  setV('edit-launch-alt', Math.round(plan.alt_km));
  setV('edit-launch-apo', Math.round(plan.alt_km)); // circular parking orbit
  // Set launch time to establish the ideal LAN plane (needs a site with lon).
  if (site && site.lon != null && typeof progLaunchRaanFor === 'function') {
    const rNow = progLaunchRaanFor(site.lat, site.lon, plan.inc_deg, 0, _missionEarthSpinRad);
    if (!rNow.unreachable) {
      const t_s = Math.round(progLaunchNextWindowS(rNow.raan, plan.lan_deg, 86164.1));
      const tField = document.getElementById('edit-launch-time-' + id);
      if (tField && typeof progMissionTimeToDate === 'function') {
        tField.value = progDateToLocalInputValue(progMissionTimeToDate(t_s));
        tField.dataset.rawS = t_s;
      }
    }
  }
  setReadout(_missionLaunchPlanReadoutHTML(plan, dest, site, m));
}
// Formats the planner result into the readout caption. Handles the azimuth
// object ({azNE,azSE,unreachable}) and the null dla (Earth-orbit target).
function _missionLaunchPlanReadoutHTML(plan, dest, site, m) {
  const az = plan.azimuthDeg;
  const azTxt = (az && !az.unreachable && isFinite(az.azNE))
    ? ` &middot; az ${az.azNE.toFixed(0)}&deg;/${az.azSE.toFixed(0)}&deg; (NE/SE)`
    : (az && az.unreachable ? ' &middot; az unreachable at this inc' : '');
  const tof = (plan.tArrJD != null && plan.tDepartJD != null) ? Math.round(plan.tArrJD - plan.tDepartJD) : null;
  const penalty = plan.planePenalty > 0.1 ? ` &middot; <span style="color:var(--warn);">site-limited (+${plan.planePenalty.toFixed(1)}&deg; plane penalty)</span>` : '';
  const dlaTxt = plan.dla_deg != null ? ` &middot; plane through departure asymptote (DLA ${plan.dla_deg.toFixed(1)}&deg;)${penalty}` : ' &middot; coplanar with target';
  let winTxt = '';
  if (site && site.lon != null && plan.lan_deg != null && typeof progLaunchRaanFor === 'function') {
    const rNow = progLaunchRaanFor(site.lat, site.lon, plan.inc_deg, 0, _missionEarthSpinRad);
    if (!rNow.unreachable) {
      const dt = progLaunchNextWindowS(rNow.raan, plan.lan_deg, 86164.1);
      winTxt = ` &middot; launch window in ~${Math.floor(dt / 3600)}h ${Math.round((dt % 3600) / 60)}m`;
    }
  }
  const energyTxt = (plan.c3 != null && plan.c3 > 0)
    ? `C3 ${plan.c3.toFixed(1)} km&sup2;/s&sup2; &middot; v&infin; ${plan.vInfMag.toFixed(2)} km/s${tof != null ? ` &middot; TOF ${tof} d` : ''}`
    : (dest === 'Moon' && plan.dvDepart != null)
      ? `TLI &Delta;V &asymp; ${Math.round(plan.dvDepart)} m/s (geocentric departure, not a heliocentric hyperbola)`
      : 'same-body transfer (no departure hyperbola)';
  // E3: low-thrust departure line when the mission's acting vehicle carries an
  // EP stage. "Spiral to escape est." uses the standard low-thrust escape
  // limit: Δv ≈ v_circ(parking) — a many-rev Edelbaum spiral to escape spends
  // (asymptotically) the full circular speed of the starting orbit (MATH.md
  // §7aa). TOF from the same mass-averaged accel estimate the node-map uses.
  let ltTxt = '';
  const epStage = (m && typeof _missionActiveEpStage === 'function') ? _missionActiveEpStage(m) : null;
  if (epStage && typeof ltEdelbaumTofEst === 'function' && typeof progVcirc === 'function') {
    const vEsc_kms = progVcirc('Earth', plan.alt_km || 185);
    const ep = { thrust_N: epStage.ep_thrust_N, isp_s: epStage.ep_isp_s, m0_kg: progStageMass(epStage), mDry_kg: epStage.dry_mass };
    const tof = ltEdelbaumTofEst(vEsc_kms, ep);
    ltTxt = `<br>&#x26A1; spiral to escape est.: ${Math.round(vEsc_kms * 1000).toLocaleString()} m/s (&asymp; v_circ at ${Math.round(plan.alt_km || 185)} km — low-thrust escape limit)`
      + (tof.tof_s != null ? ` &middot; TOF ~${Math.round(tof.tof_s / 86400)} d` : ' &middot; <span style="color:var(--warn);">exceeds EP tank capacity</span>');
  }
  return `<span style="color:var(--accent);">Ideal parking for ${_mrEsc(dest)}</span>: `
    + `${Math.round(plan.alt_km)} km &times; ${plan.inc_deg.toFixed(1)}&deg; incl, &Omega; ${plan.lan_deg.toFixed(1)}&deg;${dlaTxt}`
    + `<br>${energyTxt}${azTxt}${winTxt}${ltTxt}`
    + `<br><span style="color:var(--text-dim);">ecliptic-frame approximation (no axial tilt) &middot; every field editable before Apply</span>`;
}
// Pure-ish readout builder — reads no DOM, just formats the three math
// helpers' output (progLaunchAzimuthDeg / progLaunchRaanFor / progLaunchNextWindowS,
// 360-...js) into the small caption line under the LAN field.
function _missionLaunchGeoReadoutHTML(site, incDeg, launchTimeS, currentLanDeg) {
  if (!site) return '// no launch site set — RAAN stays at its authored/default value';
  // Defensive: a site sourced from the fleet-vehicle's saved launch-site strip
  // carries {lat,lon} but not the {name,short} catalog shape — fall back
  // rather than interpolate "undefined" into the readout.
  if (site.name == null) site = { ...site, name: site.short || `${site.lat}°, ${site.lon}°` };
  incDeg = incDeg != null ? incDeg : 28.5;
  const az = progLaunchAzimuthDeg(site.lat, incDeg);
  const azTxt = az.unreachable
    ? `az: unreachable (inc ${incDeg.toFixed(1)}&deg; &lt; site lat ${site.lat}&deg;)`
    : `az &asymp; ${az.azNE.toFixed(1)}&deg; (NE) / ${az.azSE.toFixed(1)}&deg; (SE)`;
  let windowTxt = '';
  if (currentLanDeg != null && currentLanDeg !== '') {
    const rNow = progLaunchRaanFor(site.lat, site.lon, incDeg, 0, _missionEarthSpinRad);
    if (!rNow.unreachable) {
      const dt = progLaunchNextWindowS(rNow.raan, +currentLanDeg, 86164.1);
      const h = Math.floor(dt / 3600), mnt = Math.round((dt % 3600) / 60);
      windowTxt = ` &middot; window in ~${h}h ${mnt}m`;
    }
  }
  return `${site.name} &middot; ${azTxt}${windowTxt}`;
}
// Live (no missionRecompute) update as the site/launch-time fields change —
// recomputes RAAN and writes it into the LAN field + readout caption. Applied
// to m.log permanently only when the card's Apply button runs missionApplyLaunchEdit.
function missionLaunchGeoUpdate(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LAUNCH') return;
  const siteShort = document.getElementById('edit-launch-site-' + id)?.value;
  const site = siteShort ? _missionLaunchSiteChoices().find(s => s.short === siteShort) : null;
  const timeField = document.getElementById('edit-launch-time-' + id);
  const dtRaw = timeField?.value;
  const t = (dtRaw !== '' && dtRaw != null && typeof progDateToMissionTime === 'function')
    ? progDateToMissionTime(dtRaw + ':00Z') : null;
  if (timeField) timeField.dataset.rawS = (t != null) ? t : '';
  const incField = document.getElementById('edit-launch-inc-' + id);
  const incDeg = incField ? (+incField.value || 0) : (e.orbit && e.orbit.inc_deg) || 28.5;
  const lanField = document.getElementById('edit-launch-lan-' + id);
  const lanLabel = lanField && lanField.closest('.cfg-item')?.querySelector('.cfg-label');
  if (site && t != null) {
    const r = progLaunchRaanFor(site.lat, site.lon, incDeg, t, _missionEarthSpinRad);
    if (!r.unreachable && lanField) {
      lanField.value = r.raan.toFixed(2);
      lanField.style.color = 'var(--text-dim)';
      if (lanLabel) lanLabel.innerHTML = 'LAN &Omega; (deg) <span style="color:var(--text-dim);">(from launch time)</span>';
    } else if (lanLabel) {
      lanLabel.innerHTML = 'LAN &Omega; (deg) <span style="color:var(--danger);">(unreachable at this inc)</span>';
    }
  } else if (lanField) {
    // launch time cleared -> LAN field frees up (stays at its last value, editable)
    lanField.style.color = '';
    if (lanLabel) lanLabel.innerHTML = 'LAN &Omega; (deg)';
  }
  const out = document.getElementById('launch-geo-readout-' + id);
  if (out) out.innerHTML = _missionLaunchGeoReadoutHTML(site, incDeg, t, lanField ? lanField.value : null);
}
// Typing directly into LAN (with no launch time authored) is just a manual
// override — no RAAN derivation, but the readout line should still track it
// for the next-window preview.
function missionLaunchGeoManualLan(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LAUNCH') return;
  const tRaw = document.getElementById('edit-launch-time-' + id)?.value;
  if (tRaw !== '' && tRaw != null) return; // launch-time-driven — ignore manual edits here
  const siteShort = document.getElementById('edit-launch-site-' + id)?.value;
  const site = siteShort ? _missionLaunchSiteChoices().find(s => s.short === siteShort) : null;
  const incField = document.getElementById('edit-launch-inc-' + id);
  const incDeg = incField ? (+incField.value || 0) : 28.5;
  const lanField = document.getElementById('edit-launch-lan-' + id);
  const out = document.getElementById('launch-geo-readout-' + id);
  if (out) out.innerHTML = _missionLaunchGeoReadoutHTML(site, incDeg, null, lanField ? lanField.value : null);
}

// T2: picking a catalog entry binds orbitRefId + fills the inline fields (which become
// its cached resolution). Re-renders the card so the fields reflect the pick immediately.
function missionLaunchRefPick(id, idx, refId) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LAUNCH') return;
  if (!refId) { e.orbitRefId = null; missionRenderDetail(); return; }
  const res = (typeof refOrbitResolve === 'function') ? refOrbitResolve(refId) : null;
  e.orbitRefId = refId;
  if (res && res.peri != null) {
    const o = e.orbit || (e.orbit = {});
    o.body = res.body; o.alt_km = res.peri; o.apo_km = res.apo; o.inc_deg = res.inc;
    if (res.lan != null) o.lan_deg = res.lan;
    e.launchOrbit = { ...o };
    delete e._refNote;
  }
  missionRecompute(m);
  missionRenderDetail();
}
// §14 U3: DEPLOY equivalent of missionLaunchRefPick — the only ref-picker path
// that accepts a propagated ref (a LAUNCH never can, see the filtered picker
// above). Binds e.orbitRefId; e.orbit gets the resolved fields (or the
// propagated marker) on the NEXT missionRecompute (the T2 resolution block).
function missionDeployRefPick(id, idx, refId) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'DEPLOY') return;
  if (!refId) { e.orbitRefId = null; e.orbit = null; delete e._refNote; missionRecompute(m); missionRenderDetail(); return; }
  e.orbitRefId = refId;
  missionRecompute(m);
  missionRenderDetail();
}
// Hand-editing a bound field detaches it to a one-off (explicit, per §13 T2 spec).
function missionLaunchOrbitDetach(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LAUNCH' || !e.orbitRefId) return;
  e.orbitRefId = null;
  delete e._refNote;
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
  const siteShort = document.getElementById('edit-launch-site-' + id)?.value;
  const site = siteShort ? _missionLaunchSiteChoices().find(s => s.short === siteShort) : null;
  e.site = site || null;
  const timeField = document.getElementById('edit-launch-time-' + id);
  const tRaw = timeField ? timeField.dataset.rawS : '';
  e.launchTime_s = (tRaw !== '' && tRaw != null && isFinite(+tRaw)) ? +tRaw : null;
  const lanRaw = document.getElementById('edit-launch-lan-' + id)?.value;
  if (lanRaw !== '' && lanRaw != null && Number.isFinite(parseFloat(lanRaw))) {
    o.lan_deg = parseFloat(lanRaw);
    o._lanFromLaunchTime = e.launchTime_s != null && !!site;
  } else {
    delete o.lan_deg;
    o._lanFromLaunchTime = false;
  }
  e.launchOrbit = { ...o };
  // R7 phase 1: remember the destination-plan inputs (authoring metadata only;
  // the actual orbit lives in e.orbit above — replay/accounting ignore these).
  const destPick = document.getElementById('edit-launch-dest-' + id)?.value;
  e.planDest = destPick || null;
  const depPick = document.getElementById('edit-launch-depjd-' + id)?.value;
  e.planDepJD = (depPick !== '' && depPick != null && isFinite(+depPick)) ? +depPick : null;
  missionRecompute(m); missionRenderDetail();
}
// Provisionally set which vehicle separates, then re-render so the stage list in
// the inline edit section matches the chosen vehicle (no recompute until Apply).
function missionSepEditSetVehicle(id, idx, key) {
  const m = _missionGet(id); if (!m || !m.log[idx]) return;
  m.log[idx].activeKey = key || null;
  missionRenderDetail();
}
function missionApplySeparateEdit(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'SEPARATE') return;
  const vk = document.getElementById('edit-sep-veh-' + id)?.value; if (vk) e.activeKey = vk;
  const si = document.getElementById('edit-sep-idx-' + id)?.value; if (si != null && si !== '') e.sepIndex = +si;
  missionRecompute(m); missionRenderDetail();
}
function missionApplyDockEdit(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'DOCK') return;
  const a = document.getElementById('edit-dock-a-' + id)?.value;
  const b = document.getElementById('edit-dock-b-' + id)?.value;
  if (a) { e.activeKey = a; delete e.aName; }
  if (b) { e.targetKey = b; delete e.tName; }
  missionRecompute(m); missionRenderDetail();
}
function missionApplyExpendEdit(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'EXPEND') return;
  const vk = document.getElementById('edit-expend-veh-' + id)?.value;
  if (vk) { e.targetKey = vk; e.vehicleLevel = true; delete e.stageName; }
  missionRecompute(m); missionRenderDetail();
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
  const statusColor = entry.result === 'SUCCESS' ? 'var(--accent3)' : entry.result === 'MARGINAL' ? 'var(--accent2)' : 'var(--danger)';
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

// MISSION_MODEL_V2 §19 E2 — LOWTHRUST event card. Shows the est./computed/
// STALE lane state (568/572), a live progress bar while computing, and the
// Compute/Cancel buttons. v1 rendering note (E3 defers spiral polylines/LOD):
// this card shows NUMBERS only — no schematic dashed-spiral glyph yet.
function _missionLowThrustLogCardHTML(entry, id, idx) {
  const state = entry._ltState || 'est';
  const badgeColor = state === 'computed' ? 'var(--accent3)' : state === 'stale' ? 'var(--warn)' : 'var(--text-dim)';
  const badgeLabel = state === 'computed' ? 'COMPUTED' : state === 'stale' ? 'STALE' : 'EST.';
  const durDays = ((entry.duration_s || 0) / 86400).toFixed(1);
  const stateKV = (k, v) => `<div class="mission-state-kv"><span class="mission-state-key">${k}</span><span class="mission-state-val">${v}</span></div>`;
  const dv = Math.round(entry.dv_actual || 0);
  const prop = Math.round(entry.prop_consumed || 0);
  const showBoth = state !== 'computed' && entry._ltComputedShadowDv != null;
  let progressHTML = '';
  if (entry._ltComputing) {
    const pct = Math.round((entry._ltProgress || 0) * 100);
    progressHTML = `<div style="margin:8px 0;">
      <div style="height:6px;background:var(--input);border:1px solid var(--border);border-radius:3px;overflow:hidden;">
        <div id="lt-bar-${id}-${idx}" style="height:100%;width:${pct}%;background:var(--accent);transition:width .15s linear;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
        <span id="lt-pct-${id}-${idx}" style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${pct}% — integrating…</span>
        <button class="act-btn" style="padding:2px 8px;font-size:9px;" onclick="ltCancelCompute()">Cancel</button>
      </div>
    </div>`;
  }
  const readyMsg = entry._ltReady === false
    ? `<div style="font-family:var(--mono);font-size:9px;color:var(--warn);margin-top:4px;">⚠ ${entry._ltReadyMessage || 'not ready'}</div>` : '';
  return `<div class="mission-log-card">
    <div class="mission-log-header">
      <span class="mission-log-type">LOWTHRUST</span>
      <span style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;padding:1px 6px;border:1px solid ${badgeColor};color:${badgeColor}">${badgeLabel}</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto">${entry.law || 'prograde'} · ${durDays} d</span>
    </div>
    <div class="mission-state-grid">
      ${stateKV('ΔV (' + (state === 'computed' ? 'integrated' : 'est.') + ')', dv.toLocaleString() + ' m/s')}
      ${stateKV('Prop Used', prop.toLocaleString() + ' kg')}
      ${stateKV('Throttle', Math.round((entry.throttle ?? 1) * 100) + '%')}
    </div>
    ${state === 'stale' ? `<div style="font-family:var(--mono);font-size:9px;color:var(--warn);margin-top:4px;">STALE — inputs changed since the last computed run; budget/orbit fall back to est. Click Compute to rebuild.</div>` : ''}
    ${readyMsg}
    ${progressHTML}
    <div id="ltg-card-readout-${id}-${idx}" style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:4px;min-height:11px;"></div>
    <div style="margin-top:6px;display:flex;gap:4px;align-items:center;">
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">Target altitude&hellip;</span>
      <input id="ltg-alt-${id}-${idx}" type="number" min="0" step="1" placeholder="km" style="width:70px;font-family:var(--mono);font-size:9px;" />
      <button class="act-btn" style="padding:2px 8px;font-size:9px;" onclick="ltgSetTargetAltitude('${id}',${idx})">Solve duration</button>
    </div>
    <div id="ltg-badge-${id}-${idx}" style="font-family:var(--mono);font-size:9px;margin-top:2px;"></div>
    ${!entry._ltComputing ? `<div style="margin-top:8px;display:flex;gap:6px;">
      <button class="act-btn" style="flex:1;" ${entry._ltReady === false ? 'disabled' : ''} onclick="ltComputeTrajectory('${id}',${idx})">▶ Compute Trajectory</button>
    </div>` : ''}
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
    // Recompute even on the immediate-authoring failure path so m._expanded and
    // Flight Readiness checks (572) see this event right away, matching the
    // SUCCESS path below — previously this skipped recompute entirely, so a
    // freshly-authored failed DOCK wouldn't show up as a check finding until
    // some unrelated later mutation happened to trigger a recompute.
    _missionExpandLast(m); missionRecompute(m);
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
// T2: COAST — the only event type where the user authors time directly.
function missionExecCoast(id) {
  const m = _missionGet(id); if (!m) return;
  const days = parseFloat(document.getElementById('addev-coast-days-' + id)?.value);
  if (!(days > 0)) return;
  const label = (document.getElementById('addev-coast-label-' + id)?.value || '').trim();
  m.log.push({ type: 'COAST', days, label: label || null });
  _missionAddEvt = null; _missionExpandLast(m); missionRecompute(m); missionRenderDetail();
}
function missionApplyCoastEdit(id, idx) {
  const m = _missionGet(id); if (!m || !m.log[idx]) return;
  const e = m.log[idx];
  const days = parseFloat(document.getElementById('edit-coast-days-' + id)?.value);
  if (days > 0) e.days = days;
  e.label = (document.getElementById('edit-coast-label-' + id)?.value || '').trim() || null;
  missionRecompute(m);
  missionRenderDetail();
}

function _missionSeparateLogCardHTML(entry) {
  if (entry.result !== 'SUCCESS') {
    const w = (entry.warnings || []).join('; ');
    return `<div class="mission-log-card" style="padding:8px 14px;">
      <span class="mission-log-type" style="color:var(--danger)">SEPARATE FAILED</span>
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
      <span class="mission-log-type" style="color:var(--danger)">DOCK FAILED</span>
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

function missionInit() {
  _missions  = [];
  _missionSel = null;
  missionEnsureDefault();
}

// One mission per program: pin the UI to _missions[0]. Creates a default mission
// if none exist (fresh init, or after loading a .program file with zero missions).
// Loading an OLD multi-mission .program file: _missions[0] is shown; the rest stay
// in the array untouched (data preserved, just not surfaced — no UI to switch to them).
function missionEnsureDefault() {
  if (!_missions.length) {
    const m = _missionMake('Mission 1');
    _missions.push(m);
  }
  _missionSel = _missions[0].missionId;
  missionRender();
}
