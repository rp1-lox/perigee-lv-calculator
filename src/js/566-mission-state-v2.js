
// ─── 566: MISSION MODEL V2 — Phase 1 shadow state ─────────────────────────
// See MISSION_MODEL_V2.md §10. PROMOTE, don't recompute: stitches existing
// _physTrajByMission legs (565) + the V1 replay's own per-event results (570)
// into a per-vehicle VehicleState timeline, side-tabled by missionId. Read
// ONLY by the reconciliation tooling below — zero user-visible change, and
// NEVER persisted on `m` (§8 invariant; autosave-leak guard). Loads after 565.

// Side-table: _v2StateByMission[missionId] = { vehicles: { [ownerKey]: { anchors: [V2Anchor...] } }, builtJD }
var _v2StateByMission = {};

// D6 reconciliation margins (MISSION_MODEL_V2.md §0 D6): per-burn max(1%, 5 m/s); totals 1%.
const V2_DV_MARGIN_REL = 0.01;
const V2_DV_MARGIN_ABS_MS = 5;
function _v2Margin(v1dv) { return Math.max(V2_DV_MARGIN_ABS_MS, V2_DV_MARGIN_REL * Math.abs(v1dv || 0)); }

// Per-stage mass snapshot for a live FlightVehicle, in the shape V2Anchor.mass.perStage wants.
function _v2StageSnapshot(fv) {
  if (!fv || !fv.stages) return [];
  return fv.stages.map(function (st) {
    return {
      ownerKey: st._ownerKey || null,
      stageDefinitionId: st.stageDefinitionId,
      dry: st.dry_mass || 0,
      prop: (typeof progStageRemainingProp === 'function') ? progStageRemainingProp(st) : 0,
      isp: st.isp || 0,
    };
  });
}

function _v2MakeAnchor(t, frame, r, v, kind, authIdx, mass, dvApplied, legRef, note) {
  return {
    t: t || 0, frame: frame || null, r: r || null, v: v || null, kind: kind,
    authIdx: authIdx != null ? authIdx : null,
    mass: mass || { perStage: [] },
    dvApplied: dvApplied || null,
    legRef: legRef != null ? legRef : null,
    note: note || null,
  };
}

// Union of the owner keys (tagOwners' scheme, 570) live on a FlightVehicle's stages.
function _v2OwnerKeysOf(fv) {
  if (!fv || !fv.stages) return [];
  const seen = {}; const out = [];
  fv.stages.forEach(function (st) {
    if (st._ownerKey && !seen[st._ownerKey]) { seen[st._ownerKey] = true; out.push(st._ownerKey); }
  });
  return out;
}

// Every vehicleId an event's replay result may reference, across event types.
function _v2EventVehicleIds(e) {
  const keys = ['vehicleId', 'destVehicleId', 'parentVehicleId', 'lowerVehicleId',
    'upperVehicleId', 'aVehId', 'tVehId', 'mergedVehicleId', 'targetVehId'];
  const out = [];
  keys.forEach(function (k) { if (e[k] && out.indexOf(e[k]) < 0) out.push(e[k]); });
  return out;
}

/** v2BuildShadow(m) — walks m._expanded (the SAME expanded/replayed log 570
 *  just processed) post-replay, stitching leg + V1-snapshot artifacts into
 *  per-owner-key VehicleState timelines. Idempotent; full rebuild each call
 *  (same discipline as _physTrajByMission). Called from missionRecompute's
 *  tail, AFTER physRebuildMissionTrajectories. */
function v2BuildShadow(m) {
  if (!m || typeof PROG_ACTIVE_PROGRAM === 'undefined') return;
  const missionId = m.missionId;
  if (!missionId) return;
  const expanded = m._expanded || [];
  const vehicles = {};
  const timelineFor = function (key) { return vehicles[key] || (vehicles[key] = { anchors: [] }); };
  const lastAnchorOf = function (key) {
    const tl = vehicles[key]; return (tl && tl.anchors.length) ? tl.anchors[tl.anchors.length - 1] : null;
  };

  for (let idx = 0; idx < expanded.length; idx++) {
    const e = expanded[idx];
    const authIdx = e._authIdx != null ? e._authIdx : idx;
    const met = e.metStart != null ? e.metStart : 0;

    if (e.type === 'LAUNCH' || e.type === 'DEPLOY') {
      if (e.result === 'FAILED' || !e.vehicleId) continue;
      const fv = PROG_ACTIVE_PROGRAM.vehicles[e.vehicleId];
      let r = null, v = null, frame = null, note = null;
      const os = fv && fv.orbitState;
      if (os && !os.surface && typeof PROG_BODIES !== 'undefined' && PROG_BODIES[os.body] && typeof physElementsToState === 'function') {
        try {
          const alt = ((os.apogee != null ? os.apogee : os.perigee || 0) + (os.perigee != null ? os.perigee : os.apogee || 0)) / 2;
          const bodyMeta = PROG_BODIES[os.body];
          // Same elements->state reconstruction the leg builders use (565's MNODE
          // path); reused rather than forked. Mean-motion phase, Ω from lan.
          const st0 = physElementsToState({
            a: bodyMeta.R + (alt || 0), e: 0, i: (os.inclination || 0) * Math.PI / 180,
            raan: (os.lan || 0) * Math.PI / 180, argp: 0, nu: 0,
          }, bodyMeta.mu);
          if (st0) { r = st0.r; v = st0.v; frame = os.body; }
          else note = 'elements->state reconstruction returned null';
        } catch (err) { note = 'state reconstruction failed: ' + err.message; }
      } else {
        note = 'surface/pre-orbit state at ' + e.type + ' — r,v not modeled (D5 point-mass has no launch-pad frame)';
      }
      const mass = { perStage: _v2StageSnapshot(fv) };
      // MISSION_MODEL_V2 Phase 2 S3 (F2, critique 60): the launch anchor
      // carries ascentDv, sourced from the SAME staging result V1 stamps
      // today (e.stagingResult.dvDelivered — read, never recomputed). Ascent
      // is sub-orbital LV-calculator territory (the state timeline begins at
      // parking-orbit insertion, D5) — it is an accounting attribute OF the
      // launch anchor, never a fake 'burn' row (v2DeriveBudget below).
      const ascentDv = (e.type === 'LAUNCH' && e.stagingResult) ? (e.stagingResult.dvDelivered || 0) : 0;
      _v2OwnerKeysOf(fv).forEach(function (k) {
        const anchor = _v2MakeAnchor(met, frame, r, v, e.type === 'LAUNCH' ? 'launch' : 'deploy', authIdx, mass, null, null, note);
        if (e.type === 'LAUNCH') anchor.ascentDv = ascentDv;
        timelineFor(k).anchors.push(anchor);
      });

    } else if (e.type === 'BURN' || e.type === 'MNODE') {
      const leg = (typeof physMissionLeg === 'function') ? physMissionLeg(missionId, authIdx) : null;
      const fv = e.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[e.vehicleId] : null;
      let r = null, v = null, frame = null, dvApplied = null, note = null, legRef = null;
      if (leg && leg.burnState && leg.burnState.r && leg.burnState.v) {
        // MNODE (solved): §10.3 — pre-state from leg.burnState, dvApplied =
        // leg.dvVec, legRef = its leg. "Read what the leg RECORDED" — never
        // re-derive a different basis. Covers both samebody and n-body
        // (moon/interplanetary) solved legs, which both stamp burnState.
        r = leg.burnState.r; v = leg.burnState.v;
        frame = leg.center || leg.homeFrame || (leg.frames && leg.frames[0]) || null;
        dvApplied = leg.dvVec || null; legRef = authIdx;
      } else if (leg && leg.kind === 'mnode' && leg.dvVec && leg.initState && leg.initState.r && leg.initState.v) {
        // MNODE (manual): §10.3 — the manual-burn leg builder (565) stamps
        // dvVec + a POST-burn initState but no burnState field (that field is
        // solved-maneuver-only). Pre-burn state = initState minus the SAME
        // dvVec the leg recorded (impulsive burn, position unchanged) — a
        // mechanical un-apply, not a re-derivation from a different basis.
        const post = leg.initState, dv = leg.dvVec;
        r = post.r; v = [post.v[0] - dv[0], post.v[1] - dv[1], post.v[2] - dv[2]];
        frame = leg.center || leg.homeFrame || (leg.frames && leg.frames[0]) || null;
        dvApplied = dv; legRef = authIdx;
      } else if (leg && leg.initState && leg.initState.r) {
        r = leg.initState.r; v = leg.initState.v; frame = leg.center || null; legRef = authIdx;
        note = 'leg carries no burnState/dvVec — anchored from initState only, no dv attributed here';
      } else if (leg && leg.kind === 'arrival' && leg.arrivalBurn && leg.arrivalBurn.dvVec) {
        // MISSION_MODEL_V2 Phase 2 S2 (F1, critique 58 resolved): the exiting
        // leg of a transit corridor now carries a real arrival-burn record
        // (565's physRebuildMissionTrajectories) — promote it exactly like a
        // solved MNODE burn. Pre-state = the burn's PRE-burn arrival state
        // (arrivalBurn.vPre), dvApplied = the real Δv vector. This is the
        // first place physics disagrees with V1's schematic dv_actual for
        // this edge on purpose — see MISSION_MODEL_V2.md §11.1/§11.5.
        r = leg.arrivalBurn.r; v = leg.arrivalBurn.vPre;
        frame = leg.arrivalBurn.frame; dvApplied = leg.arrivalBurn.dvVec; legRef = authIdx;
      } else if (leg && leg.kind === 'arrival') {
        // Corridor/arrival edges (fromNode.type === 'transit'): unconverged,
        // or the arrival-burn construction couldn't find a bracketing
        // periapsis event this replay. Record the anchor with dvApplied:null
        // + a note (never silently drop it; v2Reconcile/v2DeriveBudget
        // surface it as an unaccounted finding).
        note = 'corridor/arrival edge — V1 dv (' + (e.dv_actual || 0) + ' m/s); no arrival-burn state this replay (unconverged leg or no bracketing periapsis event); see MISSION_MODEL_V2.md §11.1';
      } else {
        note = 'no propagated leg found for this burn (physics disabled, unconverged, or classic scalar BURN with no 565 leg) — shadow left unanchored per §10.3';
      }
      const mass = { perStage: _v2StageSnapshot(fv) };
      _v2OwnerKeysOf(fv).forEach(function (k) {
        timelineFor(k).anchors.push(_v2MakeAnchor(met, frame, r, v, 'burn', authIdx, mass, dvApplied, legRef, note));
      });

    } else if (e.type === 'SEPARATE' || e.type === 'DOCK' || e.type === 'EXPEND' ||
               e.type === 'TRANSFER_PROPELLANT' || e.type === 'TRANSFER_CREW' || e.type === 'RENDEZVOUS') {
      const ids = _v2EventVehicleIds(e);
      const fvs = ids.map(function (id) { return PROG_ACTIVE_PROGRAM.vehicles[id]; }).filter(Boolean);
      const ownerKeys = {};
      fvs.forEach(function (fv) { _v2OwnerKeysOf(fv).forEach(function (k) { ownerKeys[k] = fv; }); });
      Object.keys(ownerKeys).forEach(function (k) {
        const fv = ownerKeys[k];
        const prev = lastAnchorOf(k);
        // §10.3: r,v carried through from the prior anchor (state is trajectory-
        // neutral for composition events, D5); mass/composition delta from V1's
        // own post-event snapshot. New owner keys (e.g. a freshly separated
        // stage) inherit the parent's last-known state this same way.
        const mass = { perStage: _v2StageSnapshot(fv) };
        timelineFor(k).anchors.push(_v2MakeAnchor(met, prev ? prev.frame : null, prev ? prev.r : null,
          prev ? prev.v : null, 'composition', authIdx, mass, null, null,
          prev ? null : 'no prior anchor for this owner — state unknown (forked with no launch/dock history yet)'));
      });

    } else if (e.type === 'REENTER' || e.type === 'RECOVER') {
      const fv = e.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[e.vehicleId] : null;
      const mass = { perStage: _v2StageSnapshot(fv) };
      _v2OwnerKeysOf(fv).forEach(function (k) {
        timelineFor(k).anchors.push(_v2MakeAnchor(met, null, null, null, 'terminal', authIdx, mass, null, null, null));
      });
    }
    // COAST: no anchor when a leg already covers the span (§10.1/§10.3) — gap
    // coasts are handled on demand by v2StateAt, never eagerly propagated here.
  }

  Object.keys(vehicles).forEach(function (k) { vehicles[k].anchors.sort(function (a, b) { return a.t - b.t; }); });
  _v2StateByMission[missionId] = { vehicles: vehicles, builtJD: (PROG_ACTIVE_PROGRAM.epochJD != null ? PROG_ACTIVE_PROGRAM.epochJD : null) };
}

/** v2StateAt(missionId, ownerKey, t) — state at any time: bracket to the
 *  latest anchor at/before t; if it has a legRef, reuse physLegStateAt's
 *  machinery (no duplicate propagation); else Kepler/physPropagateSegment
 *  from the anchor for an un-legged gap (the ONE propagation entry point,
 *  §8). Returns {frame, r, v, mass} or null pre-launch/post-terminal/unknown. */
function v2StateAt(missionId, ownerKey, t) {
  const md = _v2StateByMission[missionId];
  const tl = md && md.vehicles[ownerKey];
  if (!tl || !tl.anchors.length) return null;
  const anchors = tl.anchors;
  if (t < anchors[0].t - 1e-6) return null;
  let idx = -1;
  for (let i = 0; i < anchors.length; i++) { if (anchors[i].t <= t + 1e-6) idx = i; else break; }
  if (idx < 0) return null;
  // Bracketing must skip USELESS anchors (no state and no leg — e.g. the
  // note-only anchor of an unaccounted corridor-exit edge, MATH.md critique
  // 58) and fall back to the last usable one — otherwise two same-time
  // departures (the Apollo seed's stacked maneuvers at t=1048) null out the
  // whole following span. Terminal anchors still end the timeline: never
  // skip past a 'terminal' kind.
  let a = anchors[idx];
  while (idx > 0 && (!a.r || !a.v) && a.legRef == null && a.kind !== 'terminal') a = anchors[--idx];
  if (!a.r || !a.v) return null; // pre-launch/terminal/unknown-state anchor
  if (Math.abs(t - a.t) < 1e-6) return { frame: a.frame, r: a.r, v: a.v, mass: a.mass };
  if (a.legRef != null && typeof physLegStateAt === 'function') {
    const st = physLegStateAt(missionId, a.legRef, t);
    if (st) return { frame: st.frame, r: st.r, v: st.v, mass: a.mass };
  }
  if (typeof physPropagateSegment === 'function' && typeof PROG_BODIES !== 'undefined' && a.frame && PROG_BODIES[a.frame]) {
    try {
      const res = physPropagateSegment({ r: a.r, v: a.v }, a.t, t,
        { center: a.frame, bodies: [a.frame], overrides: {} }, { maxSamples: 8 });
      if (res && res.stateF) return { frame: res.frame || a.frame, r: res.stateF.r, v: res.stateF.v, mass: a.mass };
    } catch (err) { /* fall through to holding the anchor state */ }
  }
  return { frame: a.frame, r: a.r, v: a.v, mass: a.mass };
}

/** v2DeriveBudget(missionId) — the accounting readout: per-burn Δv =
 *  |dvApplied| (km/s -> m/s); prop re-derived via the SAME rocket-eq path
 *  V1 uses (progRocketEqPropNeeded) on the anchor's pre-burn mass snapshot,
 *  against the highest-remaining-prop stage carrying an isp (best-effort
 *  single-active-stage assumption — Phase 1 doesn't track which stage fired;
 *  a genuine limitation, not a bug, see MATH.md). */
function v2DeriveBudget(missionId) {
  const md = _v2StateByMission[missionId];
  const perBurn = []; let dvTotal = 0, propTotal = 0, ascent = 0;
  if (!md) return { perBurn: perBurn, dvTotal: 0, propTotal: 0, ascent: 0 };
  // A single physical burn moves every stage in the current (possibly docked,
  // multi-owner) stack, so tagOwners' per-stage keys ALL get an anchor for the
  // same authIdx. That's correct per-timeline (each owner's VehicleState really
  // did receive that dv at that instant) but the ACCOUNTING readout must count
  // each authored burn exactly once — same discipline as missionBudget, which
  // sums m.log once per entry, not once per stage. Dedupe by authIdx, keeping
  // the first owner's anchor (arbitrary but stable — they all carry the same
  // dvApplied/mass-derived dv_ms by construction). Same dedupe discipline
  // applies to 'launch' anchors' ascentDv (§11.1 F2/S3) — a multi-stage
  // vehicle's stages all get a 'launch' anchor for the same authIdx.
  const seenAuth = {};
  const seenLaunchAuth = {};
  Object.keys(md.vehicles).forEach(function (k) {
    md.vehicles[k].anchors.forEach(function (a) {
      if (a.kind === 'launch') {
        if (seenLaunchAuth[a.authIdx]) return;
        seenLaunchAuth[a.authIdx] = true;
        ascent += a.ascentDv || 0;
        return;
      }
      if (a.kind !== 'burn') return;
      if (seenAuth[a.authIdx]) return;
      seenAuth[a.authIdx] = true;
      if (!a.dvApplied) {
        // §10.3 rule of the phase: never silently skip. A burn anchor with no
        // promotable dv (e.g. a corridor/arrival edge, see v2BuildShadow) is
        // surfaced as an unaccounted row (dv_ms: null) instead of vanishing
        // from the readout — v2Reconcile flags it as NOT within margin.
        perBurn.push({ authIdx: a.authIdx, ownerKey: k, dv_ms: null, prop_kg: null, note: a.note });
        return;
      }
      const dv_ms = (typeof physMag === 'function' ? physMag(a.dvApplied) : Math.hypot(a.dvApplied[0], a.dvApplied[1], a.dvApplied[2])) * 1000;
      const stages = a.mass.perStage || [];
      const wet = stages.reduce(function (s, st) { return s + st.dry + st.prop; }, 0);
      const burning = stages.filter(function (st) { return st.isp > 0; }).sort(function (x, y) { return y.prop - x.prop; })[0];
      const isp = burning ? burning.isp : 0;
      const prop_kg = (isp > 0 && typeof progRocketEqPropNeeded === 'function') ? progRocketEqPropNeeded(wet, dv_ms, isp) : 0;
      perBurn.push({ authIdx: a.authIdx, ownerKey: k, dv_ms: dv_ms, prop_kg: prop_kg });
      dvTotal += dv_ms; propTotal += prop_kg;
    });
  });
  perBurn.sort(function (a, b) { return a.authIdx - b.authIdx; });
  // S3: dvTotal = ascent + Σ|burns| — ascent is its own line, never a burn row.
  return { perBurn: perBurn, dvTotal: ascent + dvTotal, propTotal: propTotal, ascent: ascent };
}

/** v2Reconcile(missionId) — proof tool: pairs each V2 burn with its V1 log
 *  entry (e.dv_actual — the SAME field missionBudget sums for BURN/MANEUVER/
 *  MNODE alike) and compares totals against missionBudget(m). D6 margins:
 *  per-burn max(1%, 5 m/s); totals 1%. */
function v2Reconcile(missionId) {
  const m = (typeof _missionGet === 'function') ? _missionGet(missionId) : null; // 570-mission-lifecycle.js
  const budget = v2DeriveBudget(missionId);
  const rows = [];
  if (m) {
    budget.perBurn.forEach(function (b) {
      const auth = m.log[b.authIdx];
      const v1_dv = auth ? (auth.dv_actual || 0) : 0;
      if (b.dv_ms == null) {
        // §10.3: unaccounted finding (no promotable leg dv) — never silently
        // dropped; always reported as outside margin so it can't hide inside
        // an "allWithin: true" result.
        rows.push({ authIdx: b.authIdx, v1_dv: v1_dv, v2_dv: null, delta: null, withinMargin: false, note: b.note });
        return;
      }
      const delta = b.dv_ms - v1_dv;
      rows.push({ authIdx: b.authIdx, v1_dv: v1_dv, v2_dv: b.dv_ms, delta: delta, withinMargin: Math.abs(delta) <= _v2Margin(v1_dv) });
    });
  }
  const v1Budget = (m && typeof missionBudget === 'function') ? missionBudget(m) : null;
  const totalV1 = v1Budget ? v1Budget.dvExpended : rows.reduce(function (s, r) { return s + r.v1_dv; }, 0);
  const totalDelta = budget.dvTotal - totalV1;
  const totalMargin = Math.max(1, 0.01 * Math.abs(totalV1));
  const totalsWithin = Math.abs(totalDelta) <= totalMargin;
  const allWithin = rows.every(function (r) { return r.withinMargin; }) && totalsWithin;
  return {
    rows: rows,
    totals: { v1: totalV1, v2: budget.dvTotal, delta: totalDelta, withinMargin: totalsWithin },
    allWithin: allWithin,
  };
}
