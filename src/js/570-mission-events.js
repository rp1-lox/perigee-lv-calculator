// ─────────────────────────────────────────────────────────────────────────────
// 570-mission-events.js — Mission event execution, inline-edit appliers, launch
//   planning, and per-type log cards
//
// OWNS: the missionExec* handlers that append a spec to m.log and recompute
//   (burn, low-thrust, separate, dock, expend, rendezvous, prop/crew transfer,
//   reenter, recover, coast); the missionApply*Edit appliers for inline event
//   edits; the low-thrust compute run (ltComputeTrajectory, _ltRunState guard);
//   the launch-window / launch-geometry / plane-match planning UI and math
//   (_missionLaunchGeoHTML, _missionLaunchPlanHTML, missionLaunchPlanOptimize,
//   _missionLaunchPlanReadoutHTML, missionLaunchGeoUpdate, …); separation picker +
//   drag (_missionSepPickerHTML, _MISSION_SOI_INJECT, _missionSepIndex/_missionSepDrag);
//   roster/owner helpers (_missionLiveVehicles, _missionStageOwner*, _missionPayloadGroups);
//   and the per-type log-card renderers (_missionBurnLogCardHTML,
//   _missionLowThrustLogCardHTML, _missionSeparateLogCardHTML, _missionDockLogCardHTML).
// CONTRACT (unchanged): every exec fn mutates m.log then calls missionRecompute(m)
//   (defined in 570-mission-replay.js) then missionRenderDetail() — never mutates
//   runtime vehicle state in place.
// Does NOT own: the state panel / maneuver builder (570-mission-panel.js), replay
//   (570-mission-replay.js), event cards (570-mission-cards.js), or launch SETUP
//   modal (still in the manager remainder).
// Split out of 570-mission-manager.js (behavior-preserving move). Definitions/consts
//   only (no load-time execution); load order relative to the manager is immaterial.
// ─────────────────────────────────────────────────────────────────────────────

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

// 5b R3 (MATH.md §7af): author the classic two-impulse phasing burn PAIR
// against a RENDEZVOUS event whose measured phase error (567's phaseTruth,
// 572's amber finding) is out of the capture window. Decision (documented in
// MATH.md §7af): authored as TWO plain BURN log entries (burnType:'CUSTOM',
// the sanctioned manual-ΔV lane — same path a user picks from the burn-type
// dropdown), inserted BEFORE the RENDEZVOUS entry, pushed together and
// recomputed ONCE so they land as a single undo capture (575's dedupe keys
// off the recompute call, not the log-push count) — not a new event TYPE,
// since the two burns are ordinary budget-charged impulses with nothing
// rendezvous-specific about their execution; only the AUTHORING affordance
// (570-mission-cards.js's _missionPhasingRowHTML) is rendezvous-specific.
// Timing: the rendezvous's own MET/duration is NOT auto-shifted (documented
// choice — see §7af "Timing semantics"); the wait time is shown on the chip
// and in the burn notes so the user can adjust the rendezvous timing/
// duration themselves via the existing duration-override field if desired.
function missionAddPhasingBurns(id, idx, N) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'RENDEZVOUS' || !e.phase) return;
  const tgt = (typeof PROG_ACTIVE_PROGRAM !== 'undefined' && PROG_ACTIVE_PROGRAM.vehicles) ? PROG_ACTIVE_PROGRAM.vehicles[e.targetVehId] : null;
  const os = tgt ? tgt.orbitState : null;
  const refId = (os && os.propagated) ? os.refId : null;
  const plan = refId
    ? (typeof phasingPlanPropagated === 'function' ? phasingPlanPropagated(refId, e.phase.dt_s, N) : null)
    : (typeof phasingPlanKeplerian === 'function' ? phasingPlanKeplerian(os, e.phase.dt_s, N) : null);
  if (!plan || !plan.feasible) return;
  const waitLabel = `${Math.round(plan.waitTime_s).toLocaleString()}s`;
  const burn1 = { type: 'BURN', burnType: 'CUSTOM', burnParam: plan.dvPerBurn_ms, stageId: null,
    activeKey: e.activeKey, activeName: e.activeName,
    note: `Phasing burn 1/2 (N=${N}, ${waitLabel} wait) — est. lane, two-body approx at periapsis (MATH.md §7af)` };
  const burn2 = { type: 'BURN', burnType: 'CUSTOM', burnParam: plan.dvPerBurn_ms, stageId: null,
    activeKey: e.activeKey, activeName: e.activeName,
    // the closing burn is where the construction's guaranteed clock
    // correction lands (see 570-mission-replay.js's BURN branch + 567's
    // _phaseVehiclePoint, MATH.md §7af) — cancels exactly the residual this
    // pair was built against, by construction.
    _phaseOffsetDelta: -e.phase.dt_s,
    note: `Phasing burn 2/2 (N=${N}) — closes the phasing orbit back onto the reference` };
  m.log.splice(idx, 0, burn1, burn2);
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
  _missionApplyClearPending(id, e);
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
        <input type="text" readonly id="edit-launch-time-${id}" class="field" data-raw-s="${hasTime ? e.launchTime_s : ''}" value="${dtVal}" placeholder="&mdash; unset &mdash;" style="width:150px;cursor:pointer;${_es}" onclick="missionLaunchTimeOpen('${id}',${idx},this)">
        <button type="button" class="act-btn" style="padding:2px 6px;margin-left:4px;display:inline-flex;align-items:center;" onclick="missionLaunchTimeOpen('${id}',${idx},this)" title="pick launch date/time (custom calendar)"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1" y="2" width="10" height="9" rx="1"/><path d="M1 4.5 H11 M3.5 1 V3 M8.5 1 V3"/></svg></button>
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
// Merged Target control (unify pass, 2026-07-17 layout reorg): "match plane"
// and "plan for destination" used to be two separate pickers that both, in
// the end, set inc/LAN — plan-for-destination additionally solves alt +
// launch time via its Optimize step. User feedback: "those don't really
// make sense separate. Those need to be the same thing." One control now:
// "— none —" (manual orbit, unchanged), a "Plan transfer to destination"
// group (Moon/Mercury/Venus/Mars/Jupiter/Saturn/Uranus/Neptune — the old
// plan-for-destination list, unchanged capability) that reveals the
// Depart(JD)+Optimize affordance, and a "Match plane only" group (Moon's
// current plane + any keplerian catalog ref orbit with a defined
// inclination — the old match-plane list, unchanged capability) that
// applies immediately on pick (no Optimize step — it's inc/LAN only).
// Nothing here mutates m.log; missionApplyLaunchEdit persists
// e.planDest/e.planDepJD (dest mode) or e.planeMatchTarget (plane mode).
function _missionLaunchTargetHTML(m, idx, e) {
  const id = m.missionId;
  const _es = 'background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;';
  const dests = ['Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
  const catalog = (typeof _refOrbitAllEntries === 'function') ? _refOrbitAllEntries() : [];
  const planeEntries = catalog.filter(o => o.kind === 'keplerian' && isFinite(o.inc));
  const cur = e.planDest ? ('dest:' + e.planDest) : (e.planeMatchTarget ? ('plane:' + e.planeMatchTarget) : '');
  const destOpts = dests.map(d => `<option value="dest:${d}"${cur === 'dest:' + d ? ' selected' : ''}>${d}</option>`).join('');
  const planeOpts = [`<option value="plane:Moon"${cur === 'plane:Moon' ? ' selected' : ''}>Moon (current plane)</option>`,
    ...planeEntries.map(o => `<option value="plane:${_tsEsc(o.id)}"${cur === 'plane:' + o.id ? ' selected' : ''}>${_tsEsc(o.name)}${o.lan != null ? '' : ' (LAN free)'}</option>`)].join('');
  const isDest = cur.startsWith('dest:');
  const depVal = (e.planDepJD != null && e.planDepJD !== '') ? e.planDepJD : '';
  // Committed LAUNCH entries auto-apply (missionRecompute + missionRenderDetail)
  // right after missionLaunchMatchPlane sets its rich live readout — which
  // wipes the DOM and re-derives initReadout from scratch. Re-resolve the
  // matched plane here so the essentials (inc/LAN/penalty) survive the
  // re-render instead of collapsing to the generic "pick Target again" text;
  // the window countdown itself is transient (already applied to launchTime_s
  // by the time this re-render happens) so it's not reconstructed here.
  let initReadout;
  if (e.planDest) {
    initReadout = `// planned for ${_mrEsc(e.planDest)} &mdash; click Optimize to recompute the ideal parking orbit`;
  } else if (e.planeMatchTarget) {
    const spec = (typeof _missionPlaneMatchTargetSpec === 'function') ? _missionPlaneMatchTargetSpec(e.planeMatchTarget) : null;
    const site = _missionLaunchSiteFor(e);
    const siteLat = site ? site.lat : 28.5;
    const epochJD = (typeof progEpochJD === 'function') ? progEpochJD() : PROG_DEFAULT_EPOCH_JD;
    const t_s = e.launchTime_s != null ? e.launchTime_s : 0;
    const res = (spec && typeof progResolvePlaneTarget === 'function') ? progResolvePlaneTarget(spec, epochJD, t_s, siteLat) : null;
    initReadout = res
      ? (typeof _missionPlaneMatchReadoutHTML === 'function' ? _missionPlaneMatchReadoutHTML(res, siteLat, '') : `// plane matched to ${_mrEsc(e.planeMatchTarget)}`)
        + (e.launchTime_s == null ? ' &mdash; no site/time to solve a window; pick a site to complete the match' : '')
      : `// plane matched to ${_mrEsc(e.planeMatchTarget)} &mdash; pick Target again to rematch`;
  } else {
    initReadout = '// choose a destination to auto-set the ideal parking-orbit plane (inc/&Omega;) for the lowest-&Delta;V departure, or a plane-match target to align inc/&Omega; only &mdash; every field stays editable';
  }
  return `
    <div class="cfg-row" style="flex-wrap:wrap;gap:8px 14px;align-items:flex-end;margin-bottom:8px;padding:8px;background:var(--accent-tint-faint);border-radius:3px;">
      <div class="cfg-item"><label class="cfg-label">Target</label>
        <select id="edit-launch-target-${id}" style="${_es}" onchange="missionLaunchTargetChange('${id}',${idx},this.value)">
          <option value=""${cur === '' ? ' selected' : ''}>&mdash; none (manual orbit) &mdash;</option>
          <optgroup label="Plan transfer to destination">${destOpts}</optgroup>
          <optgroup label="Match plane only">${planeOpts}</optgroup>
        </select></div>
      <div class="cfg-item" id="edit-launch-depjd-wrap-${id}" style="${isDest ? '' : 'display:none;'}">
        <label class="cfg-label">Depart (JD)</label>
        <input type="number" id="edit-launch-depjd-${id}" class="field" placeholder="auto (min &Delta;V)" value="${depVal}" step="any" style="width:120px;"></div>
      <button class="act-btn" id="edit-launch-optimize-${id}" style="padding:4px 12px;${isDest ? '' : 'display:none;'}" onclick="missionLaunchPlanOptimize('${id}',${idx})">&#x27F3; Optimize parking orbit</button>
    </div>
    <div id="launch-plan-readout-${id}" style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px;line-height:1.5;">${initReadout}</div>`;
}
// Merged-control onchange: dest:* just reveals the Depart/Optimize affordance
// (unchanged plan-for-destination flow — still a multi-field solve gated on
// clicking Optimize); plane:* applies immediately (unchanged match-plane
// flow — inc/LAN only, delegates to the existing missionLaunchMatchPlane).
function missionLaunchTargetChange(id, idx, val) {
  const depWrap = document.getElementById('edit-launch-depjd-wrap-' + id);
  const optBtn = document.getElementById('edit-launch-optimize-' + id);
  const isDest = val.startsWith('dest:');
  if (depWrap) depWrap.style.display = isDest ? '' : 'none';
  if (optBtn) optBtn.style.display = isDest ? '' : 'none';
  if (val.startsWith('plane:')) {
    missionLaunchMatchPlane(id, idx, val.slice('plane:'.length));
  } else if (!isDest) {
    const out = document.getElementById('launch-plan-readout-' + id);
    if (out) out.innerHTML = '// choose a destination to auto-set the ideal parking-orbit plane (inc/&Omega;) for the lowest-&Delta;V departure, or a plane-match target to align inc/&Omega; only &mdash; every field stays editable';
  }
}
// Resolves a plane:* target VALUE (as stored in the Target select / e.planeMatchTarget)
// into the {inc,lan,name}-or-'Moon' shape progResolvePlaneTarget expects. Shared by
// missionLaunchMatchPlane (initial solve) and missionLaunchGeoUpdate (staleness check).
function _missionPlaneMatchTargetSpec(targetVal) {
  if (!targetVal) return null;
  if (targetVal === 'Moon') return 'Moon';
  const entry = (typeof _refOrbitAllEntries === 'function') ? _refOrbitAllEntries().find(o => o.id === targetVal) : null;
  return entry ? { inc: entry.inc, lan: entry.lan, name: entry.name } : null;
}
// Shared readout fragment for a resolved plane-match (matched inc/LAN,
// unreachable/penalty framing). `winTxt` is an optional pre-formatted
// " · launch window in ~Xh Ym" suffix — callers with no window to report
// (e.g. the post-re-render initReadout, where the window was already
// consumed into launchTime_s) pass ''.
function _missionPlaneMatchReadoutHTML(res, siteLat, winTxt) {
  return (res.unreachable
    ? `<span style="color:var(--danger);">Plane match to ${_mrEsc(res.source)}: UNREACHABLE at site lat ${siteLat}&deg;</span> — parking at inc ${res.inc_deg.toFixed(1)}&deg; (min-penalty ${res.penalty_deg.toFixed(1)}&deg;), &Omega; ${res.lan_deg.toFixed(1)}&deg;`
    : `<span style="color:var(--accent);">Plane matched to ${_mrEsc(res.source)}</span>: inc ${res.inc_deg.toFixed(1)}&deg;, &Omega; ${res.lan_deg.toFixed(1)}&deg;`)
    + (winTxt || '');
}
// Fills inc/LAN from the picked plane target AND, since LAN is physically
// determined by launch time (missionLaunchGeoUpdate recomputes it from
// site+time and would otherwise clobber the match), solves the launch TIME
// that achieves the matched LAN — same recipe as missionLaunchPlanOptimize:
// progLaunchRaanFor at t=0 to find the RAAN a t=0 launch would reach, then
// progLaunchNextWindowS to find the next window that lands on the target LAN.
// Warns (not clamps) if the site latitude exceeds the plane's inclination —
// that combination is a real dogleg/unreachable case, not something to
// silently fix up; the min-penalty plane (res.inc_deg/res.lan_deg, pinned to
// the achievable inc) still gets a solved window so the readout is honest
// about the residual penalty rather than leaving the time unset.
function missionLaunchMatchPlane(id, idx, targetVal) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LAUNCH') return;
  if (!targetVal) return;
  const readEl = document.getElementById('launch-plan-readout-' + id);
  const setReadout = html => { if (readEl) readEl.innerHTML = html; };
  const siteShort = document.getElementById('edit-launch-site-' + id)?.value;
  const site = siteShort ? _missionLaunchSiteChoices().find(s => s.short === siteShort) : _missionLaunchSiteFor(e);
  const siteLat = site ? site.lat : 28.5;
  const tRaw = document.getElementById('edit-launch-time-' + id)?.dataset.rawS;
  const t_s = (tRaw !== '' && tRaw != null) ? +tRaw : 0;
  const epochJD = (typeof progEpochJD === 'function') ? progEpochJD() : PROG_DEFAULT_EPOCH_JD;
  const target = _missionPlaneMatchTargetSpec(targetVal);
  if (!target) return;
  if (typeof progResolvePlaneTarget !== 'function') return;
  const res = progResolvePlaneTarget(target, epochJD, t_s, siteLat);
  if (!res) return;
  const setV = (fid, v) => { const el = document.getElementById(fid + '-' + id); if (el != null && v != null) el.value = v; };
  setV('edit-launch-inc', res.inc_deg.toFixed(2));
  setV('edit-launch-lan', res.lan_deg.toFixed(2));
  const incField = document.getElementById('edit-launch-inc-' + id);
  if (incField) missionLaunchOrbitDetach(id, idx);
  // Solve the launch window that reaches the matched LAN, exactly like
  // missionLaunchPlanOptimize does for the dest: path (415-launch-planner.js
  // progLaunchRaanFor/progLaunchNextWindowS).
  let winTxt = '';
  if (site && site.lon != null && typeof progLaunchRaanFor === 'function' && typeof progLaunchNextWindowS === 'function') {
    const rNow = progLaunchRaanFor(site.lat, site.lon, res.inc_deg, 0, _missionEarthSpinRad);
    if (!rNow.unreachable) {
      const dt = progLaunchNextWindowS(rNow.raan, res.lan_deg, 86164.1);
      const win_t_s = Math.round(dt);
      const tField = document.getElementById('edit-launch-time-' + id);
      if (tField && typeof progMissionTimeToDate === 'function' && typeof progDateToLocalInputValue === 'function') {
        tField.value = progDateToLocalInputValue(progMissionTimeToDate(win_t_s));
        tField.dataset.rawS = win_t_s;
      }
      winTxt = ` &middot; launch window in ~${Math.floor(dt / 3600)}h ${Math.round((dt % 3600) / 60)}m`;
    }
  }
  // missionLaunchGeoUpdate recomputes LAN from the now-solved site+time — it
  // should land on the SAME res.lan_deg (that's the point of solving the
  // window above), so it no longer clobbers the match. It also relabels the
  // LAN field; overwrite that label below with the matched-plane wording
  // (still calling it first so the LAN VALUE and readout caption it builds
  // are consistent with the solved time).
  missionLaunchGeoUpdate(id, idx);
  const lanField = document.getElementById('edit-launch-lan-' + id);
  const lanLabel = lanField && lanField.closest('.cfg-item')?.querySelector('.cfg-label');
  if (lanLabel) {
    lanLabel.innerHTML = res.unreachable
      ? `LAN &Omega; (deg) <span style="color:var(--danger);">(matched to ${_mrEsc(res.source)} — UNREACHABLE at site lat ${siteLat}&deg;, penalty ${res.penalty_deg.toFixed(1)}&deg;)</span>`
      : `LAN &Omega; (deg) <span style="color:var(--text-dim);">(matched to ${_mrEsc(res.source)})</span>`;
  }
  setReadout(_missionPlaneMatchReadoutHTML(res, siteLat, winTxt)
    + `<br><span style="color:var(--text-dim);">launch time set to the next window achieving this plane — every field stays editable</span>`);
  // Write-through (root-cause fix): persist the matched plane + solved time
  // into the entry NOW — a later card re-render (payload pick, ref pick,
  // anything) rebuilds the fields from e.orbit/e.launchTime_s and used to
  // silently revert the match to the stale values. Committed entries also
  // auto-apply (recompute) so picking a plane target on an already-launched
  // card takes effect without hunting for Apply.
  _missionLaunchSyncDraft(id, idx);
  if (!e.pending) { missionRecompute(m); missionRenderDetail(); }
}
// Clear button for the datetime-local field (native inputs have no easy
// "unset" affordance) — reverts to unauthored launch time (LAN frees up to
// manual, matching the old empty-field behavior).
function missionLaunchClearTime(id, idx) {
  const t = document.getElementById('edit-launch-time-' + id);
  if (t) { t.value = ''; t.dataset.rawS = ''; }
  missionLaunchGeoUpdate(id, idx);
  _missionLaunchSyncDraft(id, idx);
}
// Launch-time picker: the card's date field opens the SAME custom calendar
// popover the program-epoch stamp uses (578-mission-epoch-picker.js) instead
// of a native datetime-local — user direction 2026-07-17 ("the calendar
// should also be using the custom calendar gizmo we made"). Apply-only
// commit, same as the epoch stamp; the hidden rawS/value contract that
// missionLaunchGeoUpdate reads is preserved unchanged.
function missionLaunchTimeOpen(id, idx, anchorEl) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LAUNCH') return;
  if (typeof epochPickerOpen !== 'function') return;
  const t0 = (e.launchTime_s != null && isFinite(+e.launchTime_s)) ? +e.launchTime_s : 0;
  epochPickerOpen({
    initialJD: progEpochJD() + t0 / 86400,
    anchorEl,
    onApply: (jd) => {
      const t_s = Math.round((jd - progEpochJD()) * 86400);
      const tf = document.getElementById('edit-launch-time-' + id);
      if (tf) {
        tf.dataset.rawS = t_s;
        tf.value = (typeof progDateToLocalInputValue === 'function') ? progDateToLocalInputValue(progJDToDate(jd)) : String(t_s);
      }
      missionLaunchGeoUpdate(id, idx);
      _missionLaunchSyncDraft(id, idx);
      if (!e.pending) { missionRecompute(m); missionRenderDetail(); }
    }
  });
}
// Optimize handler: runs the planner and fills the DOM fields (no commit until
// Apply). Uses the site currently picked in THIS card (falls back to the
// event's site) so azimuth/launch-window reflect the user's in-progress choice.
// Moon routes through the geocentric cislunar plane math (progMoonPlaneAt)
// inside progPlanLaunchToDestination rather than the heliocentric Lambert
// scan the other bodies use — see 415's Moon branch.
function missionLaunchPlanOptimize(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LAUNCH') return;
  const readEl = document.getElementById('launch-plan-readout-' + id);
  const setReadout = html => { if (readEl) readEl.innerHTML = html; };
  const targetVal = document.getElementById('edit-launch-target-' + id)?.value || '';
  const dest = targetVal.startsWith('dest:') ? targetVal.slice('dest:'.length) : '';
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
  // Write-through (root-cause fix): same as missionLaunchMatchPlane — the
  // solved plane/alt/launch-time must survive card re-renders. Pending drafts
  // sync only (the rich readout stays up); committed entries auto-apply.
  _missionLaunchSyncDraft(id, idx);
  if (!e.pending) { missionRecompute(m); }
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
      // Staleness check (feedback item 6): if this LAUNCH entry has a plane
      // match on file, re-resolve that target's plane right now and compare
      // against the LAN this site+time actually reaches. A mismatch means
      // the launch time was changed manually AFTER the match (or the target
      // plane itself moved with epoch) — physically the match is broken, but
      // fields stay editable per the §12 design note; just say so.
      let staleTxt = '';
      if (e.planeMatchTarget && typeof progResolvePlaneTarget === 'function' && typeof _missionPlaneMatchTargetSpec === 'function') {
        const spec = _missionPlaneMatchTargetSpec(e.planeMatchTarget);
        const epochJD = (typeof progEpochJD === 'function') ? progEpochJD() : PROG_DEFAULT_EPOCH_JD;
        const expected = spec ? progResolvePlaneTarget(spec, epochJD, t, site.lat) : null;
        if (expected) {
          let dLan = Math.abs(r.raan - expected.lan_deg) % 360;
          if (dLan > 180) dLan = 360 - dLan;
          staleTxt = dLan > 0.5
            ? ` <span style="color:var(--warn);">(launch time changed — plane match to ${_mrEsc(expected.source)} stale, re-pick target to re-solve)</span>`
            : ` <span style="color:var(--text-dim);">(matched to ${_mrEsc(expected.source)})</span>`;
        }
      }
      if (lanLabel) lanLabel.innerHTML = staleTxt
        ? `LAN &Omega; (deg)${staleTxt}`
        : 'LAN &Omega; (deg) <span style="color:var(--text-dim);">(from launch time)</span>';
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
  _missionLaunchSyncDraft(id, idx); // the render below rebuilds from e — sync in-progress edits first (the ref resolution then overwrites the orbit fields, as intended)
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

// LAUNCH card LV search combobox — see 571-combobox.js. Restores the
// Built-in/My Vehicles/Program grouping the pre-e1b08583f dock picker had
// (_missionLvPickerOptsHTML/missionPickLibVehicle, both now dead) and its
// on-pick snapshot-into-`_fleetEntries` behavior for library vehicles.
function _missionLaunchLvComboOpen(id, idx) {
  const inputEl = document.getElementById('edit-launch-lv-q-' + id);
  if (!inputEl) return;
  comboboxOpen({
    inputEl,
    groups: () => {
      const g = [];
      if (typeof BUILTIN_PRESETS !== 'undefined' && BUILTIN_PRESETS.length) {
        g.push({ label: 'Built-in', items: BUILTIN_PRESETS.map((v, i) => ({ value: 'builtin:' + i, label: v.name })) });
      }
      if (typeof userLVs !== 'undefined' && userLVs.length) {
        g.push({ label: 'My Vehicles', items: userLVs.map((v, i) => ({ value: 'user:' + i, label: v.name })) });
      }
      if (_fleetEntries.length) {
        g.push({ label: 'Program', items: _fleetEntries.map(f => ({ value: 'fleet:' + f.fleetId, label: f.name })) });
      }
      return g;
    },
    onPick: (item) => _missionLaunchLvPick(id, idx, item)
  });
}
function _missionLaunchLvPick(id, idx, item) {
  const [kind, ref] = item.value.split(':');
  let fleetId;
  if (kind === 'fleet') {
    fleetId = ref;
  } else {
    const spec = _fleetVehicleSpecFromLib(kind, parseInt(ref, 10));
    if (!spec) return;
    const entry = { fleetId: progUUID(), ...spec, payloads: [] };
    _fleetEntries.push(entry);
    fleetId = entry.fleetId;
  }
  const hidden = document.getElementById('edit-launch-lv-' + id);
  const q = document.getElementById('edit-launch-lv-q-' + id);
  if (hidden) hidden.value = fleetId;
  if (q) q.value = item.label;
  _missionLaunchSyncDraft(id, idx); // write-through: the pick must survive any later card re-render
}

// LAUNCH card payload search combobox — appends to e.payloadScIds (a list;
// mass accounting already sums it, see 570-mission-manager.js). Mutates the
// log entry directly and re-renders, same pre-Apply-mutation convention as
// missionLaunchOrbitDetach/missionSepEditSetVehicle.
function _missionLaunchPayComboOpen(id, idx) {
  const inputEl = document.getElementById('edit-launch-pay-q-' + id);
  const m = _missionGet(id);
  if (!inputEl || !m) return;
  const e = m.log[idx]; if (!e) return;
  comboboxOpen({
    inputEl,
    groups: () => {
      const already = e.payloadScIds || [];
      const avail = (_scEdSC || []).filter(sc => !already.includes(sc.spacecraftId));
      return avail.length ? [{ label: 'Spacecraft', items: avail.map(sc => ({ value: sc.spacecraftId, label: sc.name })) }] : [];
    },
    onPick: (item) => _missionLaunchPayloadAdd(id, idx, item.value)
  });
}
function _missionLaunchPayloadAdd(id, idx, scId) {
  comboboxClose();
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e) return;
  if (e.type === 'LAUNCH') _missionLaunchSyncDraft(id, idx); // re-render below rebuilds fields from e — sync first or in-progress edits (incl. plane match) revert
  if (!e.payloadScIds) e.payloadScIds = [];
  if (!e.payloadScIds.includes(scId)) e.payloadScIds.push(scId);
  missionRenderDetail();
}
function _missionLaunchPayloadRemove(id, idx, scId) {
  comboboxClose();
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e) return;
  if (e.type === 'LAUNCH') _missionLaunchSyncDraft(id, idx); // sync before the re-render below, same as PayloadAdd
  e.payloadScIds = (e.payloadScIds || []).filter(x => x !== scId);
  missionRenderDetail();
}

// ── Write-through draft sync (2026-07-17 root-cause fix) ───────────────────
// The plane-match / plan-optimize / payload / ref-pick handlers all used to
// leave their results in the DOM only, and half of them re-render the card
// (missionRenderDetail rebuilds every field from e.orbit) — so anything not
// yet synced was silently reverted to the entry's stale values. Measured
// user-facing symptom: "target Moon" filled inc 19.04, adding a payload
// re-rendered the card back to 28.5, and Launch committed 28.5. Every
// mutating handler on the LAUNCH card now calls this DOM→entry sync BEFORE
// triggering any re-render, so the entry is always the source of truth.
function _missionLaunchSyncDraft(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LAUNCH') return;
  const lv = document.getElementById('edit-launch-lv-' + id)?.value;
  if (lv) { e.fleetEntryId = lv; const f = _fleetGet(lv); if (f) e.label = f.name; }
  const o = e.orbit || (e.orbit = {});
  // Body selector removed from the LAUNCH card (2026-07-17 layout reorg) —
  // launches are from Earth, full stop. The orbit-state data model still
  // carries a body field (other event types do target other bodies).
  o.body = 'Earth';
  const altEl = document.getElementById('edit-launch-alt-' + id);
  if (altEl) o.alt_km = +altEl.value || 0;
  const apoEl = document.getElementById('edit-launch-apo-' + id);
  if (apoEl) o.apo_km = +apoEl.value || o.alt_km;
  const incEl = document.getElementById('edit-launch-inc-' + id);
  if (incEl) o.inc_deg = +incEl.value || 0;
  const siteEl = document.getElementById('edit-launch-site-' + id);
  if (siteEl) {
    const siteShort = siteEl.value;
    e.site = siteShort ? (_missionLaunchSiteChoices().find(s => s.short === siteShort) || null) : null;
  }
  const timeField = document.getElementById('edit-launch-time-' + id);
  if (timeField) {
    const tRaw = timeField.dataset.rawS;
    e.launchTime_s = (tRaw !== '' && tRaw != null && isFinite(+tRaw)) ? +tRaw : null;
  }
  const lanEl = document.getElementById('edit-launch-lan-' + id);
  if (lanEl) {
    const lanRaw = lanEl.value;
    if (lanRaw !== '' && lanRaw != null && Number.isFinite(parseFloat(lanRaw))) {
      o.lan_deg = parseFloat(lanRaw);
      o._lanFromLaunchTime = e.launchTime_s != null && !!e.site;
    } else {
      delete o.lan_deg;
      o._lanFromLaunchTime = false;
    }
  }
  e.launchOrbit = { ...o };
  const targetEl = document.getElementById('edit-launch-target-' + id);
  if (targetEl) {
    const targetVal = targetEl.value || '';
    if (targetVal.startsWith('dest:')) {
      e.planDest = targetVal.slice('dest:'.length);
      e.planeMatchTarget = null;
    } else if (targetVal.startsWith('plane:')) {
      e.planDest = null;
      e.planeMatchTarget = targetVal.slice('plane:'.length);
    } else {
      e.planDest = null;
      e.planeMatchTarget = null;
    }
  }
  const depEl = document.getElementById('edit-launch-depjd-' + id);
  if (depEl) {
    const depPick = depEl.value;
    e.planDepJD = (depPick !== '' && depPick != null && isFinite(+depPick)) ? +depPick : null;
  }
}
// Apply == commit (2026-07-17 root-cause fix): a pending draft's Apply used
// to mutate the draft but leave pending:true — and _missionEffectiveLog
// filters pending entries from replay, so recompute changed NOTHING visible
// ("the apply button just doesn't do anything", user). Every missionApply*Edit
// now clears the pending flag first, making Apply and the ctlbar commit
// button functionally identical, per the user's explicit direction.
function _missionApplyClearPending(id, e) {
  if (!e || !e.pending) return;
  delete e.pending;
  if (typeof _missionPendingEvent !== 'undefined' && _missionPendingEvent && _missionPendingEvent.missionId === id) {
    _missionPendingEvent = null;
  }
}
function missionApplyLaunchEdit(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'LAUNCH') return;
  _missionLaunchSyncDraft(id, idx);
  _missionApplyClearPending(id, e);
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
  _missionApplyClearPending(id, e);
  const vk = document.getElementById('edit-sep-veh-' + id)?.value; if (vk) e.activeKey = vk;
  const si = document.getElementById('edit-sep-idx-' + id)?.value; if (si != null && si !== '') e.sepIndex = +si;
  missionRecompute(m); missionRenderDetail();
}
function missionApplyDockEdit(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'DOCK') return;
  _missionApplyClearPending(id, e);
  const a = document.getElementById('edit-dock-a-' + id)?.value;
  const b = document.getElementById('edit-dock-b-' + id)?.value;
  if (a) { e.activeKey = a; delete e.aName; }
  if (b) { e.targetKey = b; delete e.tName; }
  missionRecompute(m); missionRenderDetail();
}
function missionApplyExpendEdit(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'EXPEND') return;
  _missionApplyClearPending(id, e);
  const vk = document.getElementById('edit-expend-veh-' + id)?.value;
  if (vk) { e.targetKey = vk; e.vehicleLevel = true; delete e.stageName; }
  missionRecompute(m); missionRenderDetail();
}

function missionApplyPropTransferEdit(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'TRANSFER_PROPELLANT') return;
  _missionApplyClearPending(id, e);
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
  _missionApplyClearPending(id, e);
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
