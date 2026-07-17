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
        onchange="missionTogglePayload('${id}','${sc.spacecraftId}',this.checked);missionRenderDetail()">
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

// Inline event authoring (2026-07-16): _missionLaunchModalBody / missionOpenLaunchModal /
// _missionRefreshLaunchModal (the modal-mission-launch pop-up + its refresh plumbing) are
// removed — Add Event → Launch now renders _missionLaunchParamsHTML directly in the
// events dock (570-mission-band.js, _missionAddEventHTML 'launch' branch) and calls
// missionExecLaunch straight from there.

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
      // 5b R1: the MET this state was captured at — phase-truth's nearest-point
      // search (567) needs the epoch a captured r/v is valid at, to rotate it
      // into the Earth-Moon frame correctly (§7v: the rotating basis itself
      // moves with real time). Without this, a DEPLOY'd vehicle's phase could
      // only be measured relative to "now", losing the very offset R1 exists
      // to surface.
      metAt: metNow || 0,
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

// ── WORKFLOW PASS 2 deliverable B2: File ▾ menu moved to the GLOBAL header
// (it's program-level, not mission-level) — was previously emitted inline by
// missionRenderDetail (570-mission-lifecycle.js). Reuses the exact same
// classes/ids (mcc-export-wrap / #mcc-export-menu) and the SAME toggle/close
// handlers above unmodified, so behavior is identical; only its DOM location
// changed. Rendered into the static #global-file-menu-slot in src/index.html
// (see _globalFileMenuRender), refreshed on every missionRenderDetail() pass
// (program/mission name + Reset visibility can change on any mutation) and
// once at startup. ──
function _globalFileMenuHTML() {
  const progName = (typeof PROG_ACTIVE_PROGRAM !== 'undefined' && PROG_ACTIVE_PROGRAM && PROG_ACTIVE_PROGRAM.name) || '';
  const m = (typeof _missions !== 'undefined' && _missions) ? _missions[0] : null;
  const id = m ? m.missionId : '';
  const missionName = m ? m.name : '';
  return `<div class="mcc-export-wrap">
    <button class="th-btn" onclick="_missionToggleExportMenu(event)" title="File options">File &#x25BE;</button>
    <div class="mcc-export-menu" id="mcc-export-menu">
      <div class="mcc-export-progrow" onclick="event.stopPropagation();">
        <input class="mcc-program-name-input" value="${progName.replace(/"/g,'&quot;')}"
          onclick="event.stopPropagation();" oninput="event.stopPropagation();_missionProgramRename(this.value)" title="Program name" placeholder="Program name">
      </div>
      ${m ? `<div class="mcc-export-progrow" onclick="event.stopPropagation();">
        <input class="mcc-program-name-input" value="${missionName.replace(/"/g,'&quot;')}"
          onclick="event.stopPropagation();" oninput="event.stopPropagation();missionRename('${id}',this.value)" title="Mission name" placeholder="Mission name">
      </div>` : ''}
      <button class="mcc-export-item" onclick="_missionCloseExportMenu();saveProgramFile()">&#x1F4BE; Save Program</button>
      <label class="mcc-export-item" style="cursor:pointer;" title="Load a .program file" onclick="_missionCloseExportMenu();">&#x1F4C2; Load Program
        <input type="file" accept=".program,.json" style="display:none" onchange="loadProgramFile(this)">
      </label>
      ${m ? `<div class="mcc-export-sep"></div>
      <button class="mcc-export-item" onclick="_missionCloseExportMenu();missionExportReport('${id}')">&#x2398; Report</button>
      <button class="mcc-export-item" onclick="_missionCloseExportMenu();missionExportPNG('${id}')">&#x2B07; PNG</button>
      ${m.log.length ? `<div class="mcc-export-sep"></div><button class="mcc-export-item mcc-export-danger" onclick="_missionCloseExportMenu();_missionConfirmReset('${id}')">&#x232B; Reset</button>` : ''}` : ''}
    </div>
  </div>`;
}
function _globalFileMenuRender() {
  const slot = document.getElementById('global-file-menu-slot');
  if (slot) slot.innerHTML = _globalFileMenuHTML();
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', _globalFileMenuRender);
  if (document.readyState === 'interactive' || document.readyState === 'complete') _globalFileMenuRender();
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
