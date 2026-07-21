
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
  // `no` = node.orbit (canonical, C2b item-3); `os` = vehicle orbitState (380 dialect).
  const a = { apogee: (no.apoKm ?? no.apogee), perigee: (no.periKm ?? no.perigee), inclination: (no.incDeg ?? no.inclination) };
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
  // A5 (MISSION_MODEL_V2 §26): flown-vs-planned readiness checks. KSP hard
  // invariant — with no architecture authored, these are complete no-ops
  // (guarded up front, not just "usually silent"): zero new findings, zero
  // new work done, byte-identical behavior to pre-A5.
  const _archHasNodes = (typeof archGet === 'function') && archGet().nodes.length > 0;
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
    if ((e.type === 'BURN' || _evIsSolvedManeuver(e)) && e.result !== 'FAILED') {
      // BURN caches its target on e.dvTarget; a solved maneuver (legacy
      // MANEUVER or unified MNODE mode:'solved') caches it on e.dvRequired
      // (dvOverride-aware — see _missionApplyManeuver, 570) — read whichever the
      // event type actually populates rather than only the BURN field (pre-T2 bug:
      // this check silently never fired for MANEUVER shortfalls before T2 surfaced
      // it via boiloff-starved arrival burns).
      const target = e.type === 'BURN' ? (e.dvTarget != null ? e.dvTarget : null) : (e.dvRequired != null ? e.dvRequired : null);
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

    // R6.2' Phase B: soft info note for a manual burn that still carries a
    // target — i.e. a solved maneuver detached (mode-flipped) into a manual
    // vector burn via the gizmo's handle-drag detach (5745). Not a failure —
    // just a heads-up that ΔV accounting for this leg switched from the
    // solved edge (progNmComputeEdgeDv) to the authored vector's own
    // magnitude, which won't auto-track a later change to the original
    // from/to nodes the way a still-solved maneuver would.
    if (_evIsManualBurn(e) && e.target) {
      const tgt = e.target;
      const fromLbl = _mcEscape(e.fromLabel || tgt.fromLabel || tgt.fromNode || '?');
      const toLbl = _mcEscape(e.toLabel || tgt.toLabel || tgt.toNode || '?');
      push('mnode-detached', 'info', 'Vector-authored burn replaces a solved maneuver',
        `This maneuver node was detached from a solved ${fromLbl} → ${toLbl} transfer — &Delta;V budget now uses the authored vector's own magnitude, not the solved edge. Use "Re-solve to target" to restore the solved maneuver.`,
        authIdx);
    }

    // MISSION_MODEL_V2 §19 E2: LOWTHRUST readiness + STALE. Not-ready is a RED
    // (the event failed to price at all — e._ltReady stamped false by 570's
    // recompute case); STALE is an INFO nudge (the est. lane still prices it,
    // just not with the last computed run's numbers) rather than a failure.
    if (e.type === 'LOWTHRUST') {
      if (e._ltReady === false) {
        push('lowthrust-not-ready', 'red', 'Low-thrust burn not ready',
          _mcEscape(e._ltReadyMessage || 'Active stage cannot perform this burn.'), authIdx);
      } else if (e._ltState === 'stale') {
        push('lowthrust-stale', 'info', 'Low-thrust leg is STALE',
          'A computed trajectory exists for this event but no longer matches its authored inputs — budget/orbit are using the est. lane until it is recomputed.', authIdx);
      }
    }

    // 5b R1 (MATH.md §7ad): RENDEZVOUS is co-orbital-only through R1 (the
    // event still succeeds — matching orbits, not stations, per critique 63)
    // — this is a PLAN-QUALITY warning (AMBER), not a broken plan (RED): the
    // rendezvous itself did not fail, it just arrived out of phase, which R2/
    // R3 (deferred) are the intended fix for. e.phase is stamped in
    // 570-mission-replay.js's RENDEZVOUS branch, computed BEFORE the
    // co-orbital merge, using 567's phaseTruthBetween at this event's MET.
    // e.phase === null means "not comparable" (disjoint orbits, or one side
    // has no propagated/refId data) — silently skipped, not flagged, since
    // R1 only checks phase where it CAN be measured.
    if (e.type === 'RENDEZVOUS' && e.matched && e.phase && e.phase.capture === false) {
      push('rendezvous-phase-error', 'amber', 'Rendezvous phase error outside capture window',
        `Arriving vehicle is ${_mcEscape(_phaseFmtDt ? _phaseFmtDt(e.phase.dt_s) : Math.round(Math.abs(e.phase.dt_s)) + 's')} ` +
        `(${_mcEscape(_phaseFmtDistKm ? _phaseFmtDistKm(e.phase.distKm) : Math.round(e.phase.distKm || 0) + ' km')}) out of phase with ` +
        `${_mcEscape(e.targetName || 'the target')} at rendezvous MET — same orbit, wrong place. Phase-matched arrival/phasing burns are not yet modeled (5b R2/R3).`,
        authIdx);
    }

    // BUG FIX (2026-07-15 user report): a solved maneuver targeting a node
    // routed through the dedicated physics solver (currently NRHO transfers,
    // 565's physSolveNrhoTransfer) can fail to converge — e.g. a hand-
    // authored one-hop LEO->NRHO maneuver shot from an unfavorable MET. The
    // world/trajectory view withholds the polyline for an unconverged leg
    // (honest — a non-converged ballistic path is not a real trajectory), but
    // until now NOTHING else surfaced that fact: the card still shows a
    // schematic patched-conic dv from progNmComputeEdgeDv and the view simply
    // renders no leg at all, indistinguishable from a rendering bug. Surface
    // it here (same RED-finding pattern as the LOWTHRUST not-ready check
    // above) so a failed/unroutable leg is always visible somewhere, never
    // silently nothing.
    if (_evIsSolvedManeuver(e) && typeof physMissionLeg === 'function') {
      const physLeg = physMissionLeg(m.missionId, authIdx);
      if (physLeg && (physLeg.kind === 'nrho' || physLeg.kind === 'moon') && physLeg.converged === false) {
        push('physics-leg-unconverged', 'red', 'Transfer trajectory did not converge',
          _mcEscape(physLeg.note || 'The physics solver could not find a converged trajectory for this maneuver — the schematic ' +
            '&Delta;V shown on the card is a patched-conic estimate only; no real transfer path exists for the current MET/target.'),
          authIdx);
      }
    }

    // #3 RED maneuver-from-mismatch: a solved maneuver whose from-node != the
    // acting vehicle's orbit state at that event (pre-event snapshot).
    if (_evIsSolvedManeuver(e) && e.fromNode) {
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

    // A5 #10 AMBER architecture-plane-deviation: a LAUNCH targeting an
    // architecture node (e.planNodeId, A4) whose COMMITTED orbit (e.orbit,
    // authored/possibly hand-edited after the plane-match ran) no longer
    // shares the node's plane. Compared via orbitWorldNormal (384/385, the
    // ONE C1 boundary) on both sides — never raw inc/lan, which would be
    // meaningless across bodies/frames (docs/MATH.md §7al). INFO/amber only
    // — a deviating plane doesn't fail the launch, it just makes the
    // architecture's dV budget for the downstream edge unreliable.
    if (_archHasNodes && e.type === 'LAUNCH' && e.planNodeId && e.orbit) {
      const node = archGet().nodes.find(n => n.id === e.planNodeId);
      if (node && node.orbit) {
        const nA = (typeof orbitWorldNormal === 'function') ? orbitWorldNormal(node.orbit) : null;
        const nB = (typeof orbitWorldNormal === 'function') ? orbitWorldNormal(e.orbit) : null;
        if (nA && nB) {
          const dot = Math.max(-1, Math.min(1, nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2]));
          const deviationDeg = Math.acos(dot) * 180 / Math.PI;
          if (deviationDeg > 1) {
            push('architecture-plane-deviation', 'amber', 'Launch plane drifted from its architecture node',
              `This launch targets "${_mcEscape(node.name || 'the node')}" but the committed orbit's plane is ${deviationDeg.toFixed(1)}&deg; off that node's plane — the transfer edges leaving this node will price against a plane the vehicle isn't actually on.`,
              authIdx);
          }
        }
      }
    }
  }

  // ── §22 TRANSFER CHAINS — group-level checks (flyby / staleness) ──────────
  // Evaluated regardless of suspendAt: these describe the AUTHORED chain
  // itself (structure + inputs), not a replay failure downstream of it, so
  // they stay meaningful even if a later event in the log went red.
  Object.keys(m.groups || {}).forEach(gid => {
    const g = m.groups[gid];
    if (!g || g.kind !== 'transfer') return;
    const members = (m.log || []).map((e, i) => ({ e, i })).filter(x => x.e.groupId === gid);
    if (!members.length) return;
    const anchorIdx = members[0].i;
    // C1: flyby — this chain USED to author an injection member (g.hadInject)
    // but no longer has one in the log (user deleted it) — the vehicle
    // honestly continues past the target on the transfer leg; INFO, not a
    // failure (a legitimate architecture, not a broken plan).
    if (g.hadInject && !members.some(x => x.e.chainRole === 'inject')) {
      push('chain-flyby', 'info', 'No insertion — flyby',
        `${_mcEscape(g.name || 'This transfer')}'s injection burn was removed — the vehicle continues past the target on the transfer leg instead of arriving into its destination orbit.`,
        anchorIdx);
    }
    // C2: staleness — the schematic ΔV requirement or the depart member's own
    // MET has moved since this chain was last (re-)solved, and nobody has
    // clicked ↻ yet. Detail deliberately loose (destination orbit / upstream
    // MET edits both move one of these two signals) — see docs/MATH.md §7ak
    // for the documented scope (vehicle-mass-only changes are NOT detected,
    // a known gap).
    if (g.solved && g.route) {
      const depart = members.find(x => x.e.chainRole === 'depart') || members.find(x => x.e.chainRole === 'inject');
      const curDv = (typeof progNmComputeEdgeDv === 'function') ? progNmComputeEdgeDv(g.route.fromNode, g.route.toNode) : null;
      const dvMoved = curDv && g.solved.dv != null && Math.abs(curDv.dv - g.solved.dv) > 1;
      const metMoved = depart && depart.e.metStart != null && g.solved.departMet != null && Math.abs(depart.e.metStart - g.solved.departMet) > 1;
      if (dvMoved || metMoved) {
        push('chain-stale', 'amber', 'Chain inputs changed since solve',
          `${_mcEscape(g.name || 'This transfer')}'s ${dvMoved ? 'required &Delta;V' : 'departure time'} has changed since it was last solved — click &#8635; Re-solve on the group header to rewrite the departure/MCC/injection burns for the current inputs.`,
          anchorIdx);
      }
    }
  });

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

    // #boiloff-losses (T2): cumulative boiloff over the mission vs. that vehicle's
    // initial total propellant. INFO above 1%, AMBER above 10%. m._boiloffByVehicle /
    // m._initialPropByVehicle are populated by missionRecompute's applyMissionBoiloff
    // (570) — keyed by stable origin key, reset every recompute. A burn that fails
    // because boiloff already ate its propellant is caught by the existing #1/#2
    // failed/shortfall checks above; this is purely an informational summary.
    const boiloffMap = m._boiloffByVehicle || {};
    Object.keys(boiloffMap).forEach(originKey => {
      const lostKg = boiloffMap[originKey];
      if (!(lostKg > 0)) return;
      const initCap = (m._initialPropByVehicle || {})[originKey] || 0;
      if (!(initCap > 0)) return;
      const pct = lostKg / initCap;
      if (pct < 0.01) return;
      const fv = (m.vehicleIds || []).map(vid => PROG_ACTIVE_PROGRAM.vehicles[vid]).find(v => v && v._originKey === originKey);
      const name = fv ? _missionVehicleDisplayName(fv) : (m._ownerLabels && m._ownerLabels[originKey]) || originKey;
      const sev = pct > 0.10 ? 'amber' : 'info';
      const totalDays = (m._metTotal || 0) / 86400;
      push('boiloff-losses', sev, 'Boiloff losses — ' + _mcEscape(name),
        `${Math.round(lostKg).toLocaleString()} kg (${Math.round(pct * 100)}%) of initial propellant lost to boiloff over ${totalDays.toFixed(0)} d.`,
        null);
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

    // A5 #11 AMBER architecture-over-budget: the mission's total AUTHORED
    // transfer dV (what BURN/solved-maneuver cards say they need — the same
    // fields #2's burn-overdraw check reads, summed across the whole log,
    // not just one repetition group) materially exceeds the architecture's
    // own budget (archComputeBudget().total, 610 — the ONE accounting
    // source, never recomputed here). "Materially" = >5% over, so ordinary
    // margin/rounding doesn't chatter. INFO/amber only — a real mission can
    // legitimately fly a fatter margin than its plan called for.
    if (_archHasNodes) {
      const budget = (typeof archComputeBudget === 'function') ? archComputeBudget() : null;
      if (budget && budget.total > 0) {
        let authoredDv = 0;
        expanded.forEach(e => {
          if (e.type === 'BURN') authoredDv += (e.dvTarget || 0);
          else if (_evIsSolvedManeuver(e)) authoredDv += (e.dvRequired || 0);
        });
        const over = authoredDv - budget.total;
        if (over > 0.05 * budget.total) {
          push('architecture-over-budget', 'amber', 'Mission is over the architecture plan budget',
            `Authored transfer &Delta;V totals ${Math.round(authoredDv).toLocaleString()} m/s against a ${Math.round(budget.total).toLocaleString()} m/s architecture budget — over plan budget by ${Math.round(over).toLocaleString()} m/s.`,
            null);
        }
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
  return sev === 'red' ? 'var(--danger)' : sev === 'amber' ? 'var(--accent2)' : 'var(--text-dim)';
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
    ? `${redN ? `<span class="mcc-check-badge" style="color:var(--danger);border-color:var(--danger);">${redN} red</span>` : ''}${amberN ? `<span class="mcc-check-badge" style="color:var(--accent2);border-color:var(--accent2);">${amberN} amber</span>` : ''}`
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
  const color = worst === 'red' ? 'var(--danger)' : worst === 'amber' ? 'var(--accent2)' : 'var(--accent3)';
  const label = worst === 'clean' ? 'GO' : `${redN ? redN + ' red' : ''}${redN && amberN ? ' / ' : ''}${amberN ? amberN + ' amber' : ''}`;
  const title = worst === 'clean'
    ? 'Flight readiness: all checks pass'
    : `Flight readiness: ${redN} red, ${amberN} amber finding${(redN + amberN) === 1 ? '' : 's'} — click to review`;
  return `<button class="act-btn mcc-check-chip" style="color:${color};border-color:${color};" title="${_mcEscape(title)}" onclick="missionChecksOpenFromToolbar('${m.missionId}')">${icon} ${label}</button>`;
}

// WORKFLOW PASS 1 deliverable A: the standalone FLIGHT READINESS panel
// (_missionChecksBoxHTML above) is retired from the layout — findings now
// re-home onto the things they criticize (event card badges/inline text,
// timeline-dock markers, plan-rail node chips) plus this toolbar/HUD chip.
// _missionChecksBoxHTML itself is left defined (harmless, unused) rather than
// deleted, in case a future surface wants the full list rendering again.

// Worst finding across a mission (red beats amber beats info) — drives the
// toolbar/HUD chip's click-to-select behavior.
function _missionChecksWorstFinding(m) {
  const findings = missionGetChecks(m);
  const rank = { red: 2, amber: 1, info: 0 };
  let worst = null;
  findings.forEach(f => {
    if (f.authIdx == null) return;   // nothing to select — end-state findings have no anchor event
    if (!worst || (rank[f.severity] || 0) > (rank[worst.severity] || 0)) worst = f;
  });
  return worst;
}

// authIdx -> findings anchored there (for event-card badges/inline text).
function _missionChecksByAuthIdx(m) {
  const map = new Map();
  missionGetChecks(m).forEach(f => {
    if (f.authIdx == null) return;
    if (!map.has(f.authIdx)) map.set(f.authIdx, []);
    map.get(f.authIdx).push(f);
  });
  return map;
}

// Small ● dot badge(s) for an event card header row — one dot per distinct
// severity present at this authIdx (red/amber only; info findings don't badge
// the event, they're not actionable failures).
function _missionChecksEventBadgeHTML(m, authIdx) {
  const findings = (_missionChecksByAuthIdx(m).get(authIdx) || []).filter(f => f.severity === 'red' || f.severity === 'amber');
  if (!findings.length) return '';
  const hasRed = findings.some(f => f.severity === 'red');
  const hasAmber = findings.some(f => f.severity === 'amber');
  let out = '';
  if (hasRed) out += `<span class="mcc-check-dot" style="color:var(--danger);" title="Flight readiness: red finding on this event">&#9679;</span>`;
  if (hasAmber) out += `<span class="mcc-check-dot" style="color:var(--warn,var(--accent2));" title="Flight readiness: amber finding on this event">&#9679;</span>`;
  return out;
}

// Full finding text, inline in the event card body when that event is selected —
// the information moves onto the thing it criticizes instead of a separate panel.
function _missionChecksInlineHTML(m, authIdx) {
  const findings = _missionChecksByAuthIdx(m).get(authIdx) || [];
  if (!findings.length) return '';
  return findings.map(f => {
    const red = f.severity === 'red';
    const amber = f.severity === 'amber';
    const border = red ? 'var(--danger)' : amber ? 'var(--warn,var(--accent2))' : 'var(--border-bright)';
    const bg = red ? 'var(--danger-tint)' : amber ? 'color-mix(in srgb, var(--warn,var(--accent2)) 12%, transparent)' : 'transparent';
    const color = red ? 'var(--danger-bright,var(--danger))' : amber ? 'var(--warn,var(--accent2))' : 'var(--text-dim)';
    const countBadge = f.count > 1 ? ` &times;${f.count}` : '';
    return `<div style="margin-top:6px;padding:6px 8px;border:1px solid ${border};background:${bg};font-family:var(--mono);font-size:9px;">
      <div style="color:${color};font-weight:600;">${_missionChecksSeverityIcon(f.severity)} ${_mcEscape(f.title)}${countBadge}</div>
      <div style="color:var(--text-dim);margin-top:2px;">${f.detail}</div>
    </div>`;
  }).join('');
}

function missionChecksOpenFromToolbar(missionId) {
  const m = (typeof _missionGet === 'function') ? _missionGet(missionId) : null;
  const worst = m ? _missionChecksWorstFinding(m) : null;
  // Route through the SAME shared selection path the event list itself uses —
  // no new selection machinery (deliverable A spec).
  if (worst && worst.authIdx != null) missionChecksGoTo(missionId, worst.authIdx);
}
