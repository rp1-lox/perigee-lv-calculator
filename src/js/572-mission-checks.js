
// ─── MISSION FLIGHT READINESS CHECKS ─────────────────────────────────────────
// Derived, read-only diagnostics computed at the END of missionRecompute (570),
// AFTER the existing autosave/undo hooks. Reads ONLY replay products already
// produced by recompute — m._expanded (cached result/stagingResult/dv/prop per
// event), each event's e.snapshot (per-event vehicle state — same data the
// event-aware left panel / _missionSelectedEventSnapshotEntry read), and the
// live end-state vehicles (m.vehicleIds -> PROG_ACTIVE_PROGRAM.vehicles).
// No lvPerformance calls, no new simulation — O(events + stages).
//
// Result lands on m._checks = [{ id, severity, title, detail, authIdx, count }].
// `_checks` is DERIVED STATE — it must NEVER be persisted:
//  - Mission undo/redo (575) serializes an explicit whitelist of authored fields
//    (log/groups/vehicleNames/launchOrbit/name/fleetEntryId/payloadScIds/laneColors)
//    via _missionUndoSerialize, so an underscore-prefixed m._checks is already
//    excluded there without any extra work.
//  - Autosave / .program save (450/455) instead JSON.stringifies `_missions`
//    (and PROG_ACTIVE_PROGRAM) directly, which WOULD pick up any own-enumerable
//    field on `m` including m._checks. So missionRunChecks stores the result on
//    a side table (_missionChecksById) keyed by missionId instead of directly on
//    the mission object, and mission* accessors below read through it — this
//    keeps `m` itself exactly as clean as before checks were added.

const _missionChecksById = {};   // missionId -> finding[]

function missionGetChecks(m) {
  if (!m) return [];
  return _missionChecksById[m.missionId] || [];
}

function _mcEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Node lookup for MANEUVER from-node vs pre-event vehicle-state comparison.
// Compares the from-node's canonical orbit spec against the acting vehicle's
// orbit state (from the PRECEDING event's snapshot) using the same tolerances
// progOrbitalStateMatch uses for docking.
function _mcNodeOrbitMatchesState(node, os) {
  if (!node || !node.orbit || !os) return true;   // no data to compare — don't false-positive
  const no = node.orbit;
  if (no.type === 'transit' || no.type === 'escape') return true;   // not a fixed orbital state — skip
  if (no.body && os.body && no.body !== os.body) return false;
  if (no.type === 'surface') return !!os.surface;
  const a = { apogee: no.apogee, perigee: no.perigee, inclination: no.inclination };
  const b = { apogee: os.apogee, perigee: os.perigee, inclination: os.inclination };
  return Math.abs((a.apogee ?? 0) - (b.apogee ?? 0)) < 1 &&
    Math.abs((a.perigee ?? 0) - (b.perigee ?? 0)) < 1 &&
    Math.abs((a.inclination ?? 0) - (b.inclination ?? 0)) < 0.5;   // slightly looser than dock (nodes are canonical/rounded)
}

// Orbit delta summary between two per-event-snapshot vehicle orbit records, for
// the DOCK-failure special detail.
function _mcOrbitDeltaText(oa, ob) {
  if (!oa || !ob) return 'orbit state unavailable for one or both vehicles';
  if (oa.body !== ob.body) return `different bodies (${oa.body || '?'} vs ${ob.body || '?'})`;
  const apoA = oa.apogee ?? oa.perigee ?? 0, apoB = ob.apogee ?? ob.perigee ?? 0;
  const periA = oa.perigee ?? oa.apogee ?? 0, periB = ob.perigee ?? ob.apogee ?? 0;
  const incA = oa.inclination ?? 0, incB = ob.inclination ?? 0;
  const dApo = Math.round(apoA - apoB), dPeri = Math.round(periA - periB), dInc = +(incA - incB).toFixed(1);
  return `apogee &Delta; ${dApo >= 0 ? '+' : ''}${dApo} km, perigee &Delta; ${dPeri >= 0 ? '+' : ''}${dPeri} km, inclination &Delta; ${dInc >= 0 ? '+' : ''}${dInc}&deg;`;
}

function missionRunChecks(m) {
  if (!m || !m.log || !m.log.length) { delete _missionChecksById[m && m.missionId]; return; }
  const expanded = m._expanded || [];
  const findings = [];
  // dedupe by (id, authIdx) with a ×N count suffix for repeated-group clones
  const seen = new Map();   // key `${id}#${authIdx}` -> finding object (already pushed to findings)
  const push = (id, severity, title, detail, authIdx) => {
    const key = id + '#' + (authIdx == null ? 'x' : authIdx);
    const ex = seen.get(key);
    if (ex) { ex.count = (ex.count || 1) + 1; return ex; }
    const f = { id, severity, title, detail, authIdx: authIdx == null ? null : authIdx, count: 1 };
    seen.set(key, f);
    findings.push(f);
    return f;
  };

  // Devil (b): after the first RED at expanded position k, suppress all findings
  // derived from state AFTER k. We do this by scanning events in expanded order,
  // tracking a "suspend from" index once a red is hit, and skipping further
  // per-event checks (1/2/3) once suspended. End-state checks (5/6/8/9) are
  // evaluated once, globally, after the loop — if a red occurred anywhere in the
  // log, that's still "later" relative to it in the sense the spec cares about
  // (systemic view is unreliable once something has already failed), so they are
  // suspended too, folded into the same trailing info line.
  let suspendAt = -1;   // expanded index at which the first red occurred, or -1

  for (let k = 0; k < expanded.length; k++) {
    const e = expanded[k];
    const authIdx = e._authIdx != null ? e._authIdx : k;
    if (suspendAt >= 0) break;   // devil (b): stop scanning entirely past the first red

    // #1 RED event-failed (any expanded event with result === 'FAILED')
    if (e.result === 'FAILED') {
      let detail = 'This event failed during replay.';
      if (e.type === 'DOCK') {
        // special DOCK detail: orbit delta between the two vehicles at this point,
        // read from the PRECEDING event's snapshot (this event's own snapshot is
        // taken after replay attempted+failed the dock, so both vehicles are
        // still separately present in it).
        const prevSnap = (k > 0 && expanded[k - 1].snapshot) ? expanded[k - 1].snapshot : (e.snapshot || []);
        const aName = e.aDisp || e.aName || null;
        const tName = e.tDisp || e.tName || null;
        const va = aName ? prevSnap.find(v => v.name === aName) : null;
        const vb = tName ? prevSnap.find(v => v.name === tName) : null;
        const delta = _mcOrbitDeltaText(va && va.orbit, vb && vb.orbit);
        detail = `DOCK failed — ${delta}. Adjust the earlier maneuver so both vehicles share the same orbit before docking.`;
      } else if (e.type === 'SEPARATE') {
        detail = 'SEPARATE failed' + ((e.warnings || []).length ? ': ' + e.warnings.join('; ') : '.');
      } else if (e.warnings && e.warnings.length) {
        detail = e.type + ' failed: ' + e.warnings.join('; ');
      } else {
        detail = e.type + ' failed during replay.';
      }
      push('event-failed', 'red', e.type + ' failed', detail, authIdx);
      suspendAt = k;
      continue;
    }

    // #2 RED burn-overdraw. In this codebase BURN/MANEUVER shortfalls are already
    // surfaced as e.result === 'MARGINAL' or captured via dv_actual < dvTarget,
    // rather than a hard FAILED — the executors (_missionApplyBurn /
    // _missionApplyManeuver) clamp to available propellant instead of throwing,
    // so there is no separate "the burn silently overdrew the tank" failure mode
    // distinct from #1's FAILED handling. We fold #2 into a MARGINAL-shortfall
    // check here (still its own catalog id) rather than skip it outright.
    if ((e.type === 'BURN' || e.type === 'MANEUVER') && e.result !== 'FAILED') {
      const target = e.dvTarget != null ? e.dvTarget : null;
      const actual = e.dv_actual != null ? e.dv_actual : null;
      if (target != null && actual != null && actual < target - 1 && target > 0) {
        const pct = Math.round((1 - actual / target) * 100);
        if (pct >= 1) {
          push('burn-overdraw', 'red',
            (e.type === 'BURN' ? 'Burn' : 'Maneuver') + ' short of target',
            `Delivered ${Math.round(actual).toLocaleString()} of ${Math.round(target).toLocaleString()} m/s (${pct}% short) — the assigned stage ran out of propellant before completing this burn.`,
            authIdx);
        }
      }
    }

    // #3 RED maneuver-from-mismatch: MANEUVER whose from-node != the acting
    // vehicle's orbit state at that event (pre-event snapshot).
    if (e.type === 'MANEUVER' && e.fromNode) {
      const node = (typeof _missionNmNodeById === 'function') ? _missionNmNodeById(e.fromNode) : null;
      const prevSnap = (k > 0 && expanded[k - 1].snapshot) ? expanded[k - 1].snapshot : null;
      const activeKeyPrev = (k > 0) ? expanded[k - 1].activeOriginKey : null;
      const stateEntry = prevSnap && activeKeyPrev ? prevSnap.find(v => v.originKey === activeKeyPrev) : null;
      if (node && stateEntry && stateEntry.orbit && !_mcNodeOrbitMatchesState(node, stateEntry.orbit)) {
        push('maneuver-from-mismatch', 'red', 'Maneuver from-node mismatch',
          `This maneuver is authored FROM ${_mcEscape(node.label || e.fromNode)}, but the vehicle's actual orbit at this point doesn't match that node. The delivered &Delta;V may not take you where the maneuver implies.`,
          authIdx);
      }
    }

    // #4 AMBER launch-marginal
    // NOTE: dvDelivered records what was BURNED, which for a SUCCESS launch equals
    // dvRequired by construction (the insertion stage burns exactly to requirement) —
    // comparing those two flags every healthy launch. The real headroom is
    // stagingResult.dvMargin (total remaining capability above the requirement).
    if (e.type === 'LAUNCH' && e.stagingResult) {
      const sr = e.stagingResult;
      const margin = (sr.dvMargin != null) ? sr.dvMargin : null;
      const marginal = sr.status === 'MARGINAL' || (margin != null && sr.dvRequired > 0 && margin < 0.02 * sr.dvRequired);
      if (marginal) {
        push('launch-marginal', 'amber', 'Launch margin is thin',
          (sr.status === 'MARGINAL' ? 'Flagged MARGINAL — ' : '') +
          `margin ${Math.round(margin != null ? margin : 0).toLocaleString()} m/s above the ${Math.round(sr.dvRequired || 0).toLocaleString()} m/s required (< 2%).`,
          authIdx);
      }
    }
  }

  // ── End-state checks (5, 6, 8, 9) — evaluated once, from live vehicles ──
  // Skipped entirely if a red already suspended the scan (devil b): end-state is
  // unreliable once an earlier event already broke the plan.
  if (suspendAt < 0) {
    const live = (typeof _missionLiveVehicles === 'function') ? _missionLiveVehicles(m) : [];

    // #5 AMBER dead-mass: end-state stage with ~0 usable prop, never expended,
    // not a spacecraft/payload stage, not the topmost stage of its vehicle.
    live.forEach(({ fv }) => {
      if (!fv || !fv.stages || fv.status === 'EXPENDED') return;
      const n = fv.stages.length;
      fv.stages.forEach((st, i) => {
        if (i === n - 1) return;                         // topmost stage exempt
        if (_missionStageOwner(st.stageDefinitionId)) return;   // payload/spacecraft stage exempt
        const cap = progStageTotalCapacity(st);
        if (cap <= 0) return;
        const rem = progStageRemainingProp(st);
        if (rem / cap < 0.005) {
          push('dead-mass', 'amber', 'Dead mass aboard ' + _mcEscape(_missionVehicleDisplayName(fv)),
            `Stage "${_mcEscape(_missionStageLabelById(st.stageDefinitionId))}" has ${Math.round(rem)} kg of ${Math.round(cap)} kg propellant remaining and was never expended — consider an EXPEND event to jettison it.`,
            null);
        }
      });
    });

    // #6 AMBER crew-stranded: crewAboard > 0 on a vehicle whose end status is
    // EXPENDED, or that ends in a transfer corridor.
    (m.vehicleIds || []).forEach(vid => {
      const fv = PROG_ACTIVE_PROGRAM.vehicles[vid];
      if (!fv) return;
      const crew = (fv.stages || []).reduce((s, st) => s + (st.crewAboard || 0), 0);
      if (crew <= 0) return;
      const os = fv.orbitState;
      const node = (typeof _progNmVehicleNode === 'function' && os) ? _missionNmNodeById(_progNmVehicleNode(fv)) : null;
      const inTransfer = node && node.orbit && node.orbit.type === 'transit';
      if (fv.status === 'EXPENDED') {
        push('crew-stranded', 'amber', 'Crew aboard an expended vehicle',
          `${_mcEscape(_missionVehicleDisplayName(fv))} has ${crew} crew aboard but is marked EXPENDED.`, null);
      } else if (inTransfer) {
        push('crew-stranded', 'amber', 'Crew left mid-transfer',
          `${_mcEscape(_missionVehicleDisplayName(fv))} has ${crew} crew aboard and the mission ends in a transfer corridor (${_mcEscape(node.label || '')}).`, null);
      }
    });

    // #8 INFO ends-in-transfer: a live vehicle's end orbitState matches a
    // transfer-corridor node.
    (m.vehicleIds || []).forEach(vid => {
      const fv = PROG_ACTIVE_PROGRAM.vehicles[vid];
      if (!fv || fv.status === 'EXPENDED' || !fv.orbitState) return;
      const nodeId = (typeof _progNmVehicleNode === 'function') ? _progNmVehicleNode(fv) : null;
      const node = nodeId ? _missionNmNodeById(nodeId) : null;
      if (node && node.orbit && node.orbit.type === 'transit') {
        push('ends-in-transfer', 'info', 'Mission ends mid-transfer',
          `${_mcEscape(_missionVehicleDisplayName(fv))} ends the mission in ${_mcEscape(node.label || nodeId)}, a transfer corridor.`, null);
      }
    });

    // #9 INFO payload-never-freed: m.payloadScIds non-empty but no
    // SEPARATE/DEPLOY event ever detaches a spacecraft-owned stage.
    if ((m.payloadScIds || []).length) {
      const everFreed = (m.log || []).some(e => e.type === 'SEPARATE' && e.result === 'SUCCESS')
        || (m.log || []).some(e => e.type === 'DEPLOY');
      if (!everFreed) {
        push('payload-never-freed', 'info', 'Payload never separated',
          `${m.payloadScIds.length} payload spacecraft ${m.payloadScIds.length === 1 ? 'is' : 'are'} manifested but no SEPARATE (or independent DEPLOY) event ever detaches ${m.payloadScIds.length === 1 ? 'it' : 'them'} from the stack.`, null);
      }
    }
  } else {
    const stoppedLabel = (expanded[suspendAt] && expanded[suspendAt].type) || 'an earlier event';
    findings.push({ id: 'checks-suspended', severity: 'info', title: 'Later checks suspended',
      detail: `Checks after this point are suspended until ${_mcEscape(stoppedLabel)} is fixed.`,
      authIdx: null, count: 1 });
  }

  _missionChecksById[m.missionId] = findings;
}

// ── UI: FLIGHT READINESS box (band-mode left column) ─────────────────────────

const _missionChecksInfoOpen = {};   // missionId -> bool ("+N more" toggle state)

function _missionChecksSeverityIcon(sev) {
  return sev === 'red' ? '&#9679;' : sev === 'amber' ? '&#9650;' : '&#8226;';
}
function _missionChecksSeverityColor(sev) {
  return sev === 'red' ? 'var(--error,#e06c75)' : sev === 'amber' ? 'var(--accent2)' : 'var(--text-dim)';
}

function missionToggleChecksInfo(missionId) {
  _missionChecksInfoOpen[missionId] = !_missionChecksInfoOpen[missionId];
  missionRenderDetail();
}

// Click a finding: jump to its authored event (guard: not while group-picking).
function missionChecksGoTo(missionId, authIdx) {
  if (typeof _missionGroupMode !== 'undefined' && _missionGroupMode) return;   // don't fight the loop-picker
  if (authIdx == null) return;
  missionSelectEvent(missionId, authIdx);
  setTimeout(() => {
    const el = document.getElementById('mlog-' + missionId + '-' + authIdx);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '2px solid var(--accent)'; setTimeout(() => { el.style.outline = ''; }, 1500); }
  }, 60);
}

function _missionChecksRowHTML(m, f) {
  const clickable = f.authIdx != null;
  const countBadge = f.count > 1 ? ` <span style="color:var(--text-dim);">&times;${f.count}</span>` : '';
  return `<div class="mcc-check-row"${clickable ? ` onclick="missionChecksGoTo('${m.missionId}',${f.authIdx})" style="cursor:pointer;"` : ''}>
    <span class="mcc-check-icon" style="color:${_missionChecksSeverityColor(f.severity)};">${_missionChecksSeverityIcon(f.severity)}</span>
    <div class="mcc-check-body">
      <div class="mcc-check-title">${_mcEscape(f.title)}${countBadge}</div>
      <div class="mcc-check-detail">${f.detail}</div>
    </div>
  </div>`;
}

function _missionChecksBoxHTML(m) {
  const findings = missionGetChecks(m);
  const redN = findings.filter(f => f.severity === 'red').length;
  const amberN = findings.filter(f => f.severity === 'amber').length;
  const infoFindings = findings.filter(f => f.severity === 'info');
  const topFindings = findings.filter(f => f.severity !== 'info');

  const badge = (redN || amberN)
    ? `${redN ? `<span class="mcc-check-badge" style="color:var(--error,#e06c75);border-color:var(--error,#e06c75);">${redN} red</span>` : ''}${amberN ? `<span class="mcc-check-badge" style="color:var(--accent2);border-color:var(--accent2);">${amberN} amber</span>` : ''}`
    : `<span class="mcc-check-badge mcc-check-go">GO</span>`;

  const evCount = (m._expanded || m.log || []).length;
  const vehCount = (m.vehicleIds || []).length;
  const cleanLine = (!redN && !amberN && !infoFindings.length)
    ? `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">All checks pass &middot; ${evCount} events &middot; ${vehCount} vehicles</div>` : '';

  const showInfoOpen = !!_missionChecksInfoOpen[m.missionId];
  const infoRows = infoFindings.length
    ? (topFindings.length
        ? (showInfoOpen
            ? infoFindings.map(f => _missionChecksRowHTML(m, f)).join('')
              + `<div class="mcc-check-more" onclick="missionToggleChecksInfo('${m.missionId}')">&#8722; hide info</div>`
            : `<div class="mcc-check-more" onclick="missionToggleChecksInfo('${m.missionId}')">+${infoFindings.length} more</div>`)
        : infoFindings.map(f => _missionChecksRowHTML(m, f)).join(''))
    : '';

  return `<div class="mcc-box">
    <div class="mcc-box-hdr" style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
      <span>FLIGHT READINESS</span>
      <span style="display:flex;gap:6px;">${badge}</span>
    </div>
    ${cleanLine}
    ${topFindings.map(f => _missionChecksRowHTML(m, f)).join('')}
    ${infoRows}
  </div>`;
}

// ── Floating toolbar status chip (both views) ─────────────────────────────────

function _missionChecksToolbarChipHTML(m) {
  if (!m) return '';
  const findings = missionGetChecks(m);
  const redN = findings.filter(f => f.severity === 'red').length;
  const amberN = findings.filter(f => f.severity === 'amber').length;
  const worst = redN ? 'red' : amberN ? 'amber' : 'clean';
  const icon = worst === 'red' ? '&#9679;' : worst === 'amber' ? '&#9650;' : '&#10003;';
  const color = worst === 'red' ? 'var(--error,#e06c75)' : worst === 'amber' ? 'var(--accent2)' : 'var(--accent3)';
  const label = worst === 'clean' ? 'GO' : `${redN ? redN + ' red' : ''}${redN && amberN ? ' / ' : ''}${amberN ? amberN + ' amber' : ''}`;
  const title = worst === 'clean'
    ? 'Flight readiness: all checks pass'
    : `Flight readiness: ${redN} red, ${amberN} amber finding${(redN + amberN) === 1 ? '' : 's'} — click to review`;
  return `<button class="act-btn mcc-check-chip" style="color:${color};border-color:${color};" title="${_mcEscape(title)}" onclick="missionChecksOpenFromToolbar('${m.missionId}')">${icon} ${label}</button>`;
}

function missionChecksOpenFromToolbar(missionId) {
  missionSetView(missionId, 'band');
  setTimeout(() => {
    const box = document.querySelector('.mcc-box .mcc-box-hdr');
    // find the specific FLIGHT READINESS box (first mcc-box in the left column matches)
    const boxes = document.querySelectorAll('.mcc-left-col .mcc-box');
    let target = null;
    boxes.forEach(b => { const h = b.querySelector('.mcc-box-hdr'); if (h && h.textContent.includes('FLIGHT READINESS')) target = b; });
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}
