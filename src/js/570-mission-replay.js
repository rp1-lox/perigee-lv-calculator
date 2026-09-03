// ─── MISSION REPLAY ENGINE ──────────────────────────────────────────────────
// missionRecompute(m) tears down runtime vehicles and replays the whole m.log;
// it is the mission's source of truth. Every mutation goes
// m.log -> missionRecompute(m) -> missionRenderDetail(); the recompute tail
// hooks autosaveScheduleSave() and missionUndoCapture(). Support helpers:
// display-name resolution, snapshots, effective-log / event-group expansion,
// owner rescoping for repeated groups, transfer/separate index resolution.

// Translate a vehicle orbitState (380 dialect: perigee/apogee/
// inclination/lan + surface/propagated/r/v/frame/body) into the CANONICAL
// orbitAtBurn boundary shape (periKm/apoKm/incDeg/lanDeg), preserving every
// non-element field via spread. The element keys are removed so the persisted
// boundary field carries canonical-only names (matches the 450 migration).
function _missionOrbitAtBurnCanonical(os) {
  const ob = { ...os };
  ob.periKm = os.perigee; ob.apoKm = os.apogee; ob.incDeg = os.inclination; ob.lanDeg = os.lan;
  delete ob.perigee; delete ob.apogee; delete ob.inclination; delete ob.lan;
  return ob;
}

// Capture a serialisable snapshot of every live vehicle's state at a point in time.
// Names are disambiguated (#N) within the snapshot so duplicates are distinguishable.
// Single source of truth for vehicle display names. When several live vehicles share
// a base name, distinguish them by the (user-chosen) parent launch name carried on
// their stages; only fall back to "#N" when parents repeat or are unknown. Returns a
// Map(vehicle -> resolved name). Used by BOTH the recompute naming pass and snapshots
// so the roster, editors, cards, band view and state monitor never disagree.
function _missionResolveDisplayNames(live, baseOf) {
  const parentOf = v => {
    const ps = [...new Set((v.stages || []).map(s => s._parentName).filter(Boolean))];
    return ps.length === 1 ? ps[0] : (ps.length ? ps.join(' + ') : '');
  };
  const byBase = {};
  live.forEach(v => { const b = baseOf(v); (byBase[b] = byBase[b] || []).push(v); });
  const out = new Map();
  Object.keys(byBase).forEach(b => {
    const arr = byBase[b];
    if (arr.length === 1) { out.set(arr[0], b); return; }
    arr.sort((x, y) => (x._birthOrd || 0) - (y._birthOrd || 0));
    const parents = arr.map(parentOf);
    if (parents.every(Boolean) && new Set(parents).size === arr.length) {
      arr.forEach((v, i) => out.set(v, b + ' (' + parents[i] + ')'));
    } else {
      const cnt = {}; parents.forEach(p => { if (p) cnt[p] = (cnt[p] || 0) + 1; });
      const seen = {};
      arr.forEach((v, i) => {
        const p = parents[i];
        if (p) { seen[p] = (seen[p] || 0) + 1; out.set(v, b + ' (' + p + (cnt[p] > 1 ? ' #' + seen[p] : '') + ')'); }
        else out.set(v, b + ' #' + (i + 1));
      });
    }
  });
  return out;
}

function _missionCaptureSnapshot(live, baseOf) {
  // disambiguate duplicate names with the shared resolver (parent-launch aware)
  const _names = _missionResolveDisplayNames(live, baseOf);
  const nameOf = v => _names.get(v) || baseOf(v);
  return live.map(v => {
    const name = nameOf(v);
    const os = v.orbitState;
    const alt = os ? (os.surface ? 0 : (((os.apogee ?? os.perigee ?? 0) + (os.perigee ?? os.apogee ?? 0)) / 2)) : 0;
    return {
      vehicleId: v.vehicleId,
      originKey: v._originKey || null,
      name, status: v.status || 'ORBIT',
      // OBLIQUITY: carry lan_deg into the snapshot ONLY when
      // it was genuinely authored (plane-match / plan-for-destination / launch-
      // time-derived RAAN — os.lanAuthored). Otherwise leave it null so the
      // trajectory ring extractor (5741) keeps its flight-derived (tier-2) /
      // Ω=0 default (tier-3) orientation instead of pinning a meaningless
      // default LAN. This is what lets a matched parking plane actually reach
      // the World-view ring (with the eq->world seam applied there).
      orbit: os ? { body: os.body, perigee: os.perigee, apogee: os.apogee, inclination: os.inclination,
        lanDeg: os.lanAuthored ? os.lan : null, surface: !!os.surface,
        propagated: !!os.propagated, refId: os.refId || null } : null,
      alt,
      owners: [...new Set(v.stages.map(st => st._ownerKey || _missionStageOwnerKey(st.stageDefinitionId)))],
      remDv: Math.round(_missionVehicleRemainingDv(v)),
      remProp: Math.round(v.stages.reduce((s, st) => s + progStageRemainingProp(st), 0)),
      stages: v.stages.map(st => ({
        id: st.stageDefinitionId,
        name: _missionStageLabelById(st.stageDefinitionId),
        parent: st._parentName || '', parentKid: st._parentKid,
        prop: Math.round(progStageRemainingProp(st)),
        cap: Math.round(progStageTotalCapacity(st)),
        dry: Math.round(st.dry_mass || 0),
        crew: st.crewAboard || 0,
      })),
    };
  });
}

// Expand the authored log into the effective replay log: a contiguous run of events
// sharing a groupId is repeated `group.repeat` times. The first pass uses the original
// event objects (so results/snapshots land back on m.log); repeats are shallow clones
// tagged _rep>0 + _clone. Every event gets _authIdx (its m.log index) for stable keys.
function _missionEffectiveLog(m) {
  const groups = m.groups || {};
  const out = [];
  let i = 0;
  while (i < m.log.length) {
    const e = m.log[i];
    const gid = e.groupId;
    if (gid && groups[gid]) {
      const range = [];
      while (i < m.log.length && m.log[i].groupId === gid) { range.push(i); i++; }
      const rep = Math.max(1, Math.min(99, groups[gid].repeat || 1));
      for (let r = 0; r < rep; r++) {
        range.forEach(idx => {
          const orig = m.log[idx];
          if (r === 0) { orig._authIdx = idx; orig._rep = 0; orig._clone = false; out.push(orig); }
          else { const c = Object.assign({}, orig); c._authIdx = idx; c._rep = r; c._clone = true; out.push(c); }
        });
      }
    } else { e._authIdx = i; e._rep = 0; e._clone = false; out.push(e); i++; }
  }
  // Unify-create/edit: a PENDING draft (mid-creation, fields not
  // yet applied) sits at the end of m.log so it renders through the normal
  // card machinery, but it must never be replayed — it has no effect on the
  // mission until Commit clears the flag. Filtered here (the single choke
  // point every recompute goes through) rather than at each call site.
  return out.filter(e => !e.pending);
}

// authored index range [start,end] of a group's events.
function _missionGroupRange(m, gid) {
  if (!gid) return null;
  let s = -1, e = -1;
  m.log.forEach((ev, i) => { if (ev.groupId === gid) { if (s < 0) s = i; e = i; } });
  return s >= 0 ? [s, e] : null;
}
// re-scope an owner key to repetition `rep` if its launch instance is inside `range`
// (so a transfer authored against "this loop's tanker" follows each repetition's tanker).
function _missionRescopeOwner(key, range, rep) {
  if (!key) return key;
  const h = key.indexOf('#'); if (h < 0) return key;
  const head = key.slice(0, h), kid = String(key.slice(h + 1));
  const ai = +kid.split(':')[0];
  if (range && ai >= range[0] && ai <= range[1]) return head + '#' + ai + (rep ? ':' + rep : '');
  return key;
}
// re-scope a vehicle ORIGIN key ('launch:3', 'sepU:5', …) to repetition `rep` if the
// originating event is inside `range` — used so any event (active or target) follows the
// current repetition's instance, while references to outside vehicles (a depot) stay put.
function _missionRescopeOriginKey(key, range, rep) {
  if (!key) return key;
  const parts = String(key).split(':');   // [type, authIdx, rep?]
  const type = parts[0], ai = +parts[1];
  if (isNaN(ai)) return key;
  if (range && ai >= range[0] && ai <= range[1]) return type + ':' + ai + (rep ? ':' + rep : '');
  return key;
}
// Resolve a transfer's source/dest stage indices by OWNER (scoped per repetition), so a
// repeated transfer targets the current loop's vehicle instead of the original by position.
function _missionResolveXferStages(m, e, active, si, di) {
  const ownerPos = (idx) => { const k = active.stages[idx] && active.stages[idx]._ownerKey; let p = 0; for (let i = 0; i < idx; i++) if (active.stages[i]._ownerKey === k) p++; return p; };
  const nthOwner = (k, p) => { let c = 0; for (let i = 0; i < active.stages.length; i++) { if (active.stages[i]._ownerKey === k) { if (c === p) return i; c++; } } return -1; };
  const auth = m.log[e._authIdx] || e;
  if (!e._clone) {
    if (active.stages[si]) { auth._srcOwner = active.stages[si]._ownerKey; auth._srcPos = ownerPos(si); }
    if (active.stages[di]) { auth._dstOwner = active.stages[di]._ownerKey; auth._dstPos = ownerPos(di); }
    return { si, di };
  }
  const range = _missionGroupRange(m, e.groupId);
  const sk = _missionRescopeOwner(auth._srcOwner, range, e._rep);
  const dk = _missionRescopeOwner(auth._dstOwner, range, e._rep);
  const rsi = sk != null ? nthOwner(sk, auth._srcPos || 0) : -1;
  const rdi = dk != null ? nthOwner(dk, auth._dstPos || 0) : -1;
  return { si: rsi >= 0 ? rsi : si, di: rdi >= 0 ? rdi : di };
}
// Resolve a SEPARATE's split index by owner (the stage at the split), re-scoped
// repetition so each loop jettisons that loop's vehicle, not the original.
function _missionResolveSepIndex(m, e, active, sepIndex) {
  const auth = m.log[e._authIdx] || e;
  if (!e._clone) { if (active.stages[sepIndex]) auth._sepOwner = active.stages[sepIndex]._ownerKey; return sepIndex; }
  const range = _missionGroupRange(m, e.groupId);
  const k = _missionRescopeOwner(auth._sepOwner, range, e._rep);
  if (k != null) { const idx = active.stages.findIndex(st => st._ownerKey === k); if (idx > 0) return idx; }
  return sepIndex;
}

// ── RECOMPUTE ENGINE: tear down & replay the full mission log from scratch ──
function missionRecompute(m) {
  if (!m || typeof PROG_ACTIVE_PROGRAM === 'undefined') return;
  // P2 physics bridge: rotate the trajectory side-table (current -> previous)
  // so this replay can consult the PREVIOUS rebuild's physics TOFs (565).
  physMissionRecomputeBegin(m);
  // tear down this mission's runtime vehicles
  (m.vehicleIds || []).forEach(vid => { if (PROG_ACTIVE_PROGRAM.vehicles[vid]) delete PROG_ACTIVE_PROGRAM.vehicles[vid]; });
  m.vehicleIds = []; m.vehicleId = null;
  let active = null;   // current active runtime FlightVehicle
  let live = [];       // all live runtime FlightVehicles for this mission
  // Resolve the vehicle an event targets — stable across replays even when ids
  // regenerate and names duplicate.
  // Resolve the vehicle an event ACTS ON. For repeated (cloned) events the stored key is
  // re-scoped to this repetition, so each loop targets its own instance; references to
  // outside vehicles (a depot) keep their key. Falls back to name (originals) then active.
  const resolveActive = ev => {
    if (ev && ev.activeKey) {
      const key = ev._clone ? _missionRescopeOriginKey(ev.activeKey, _missionGroupRange(m, ev.groupId), ev._rep) : ev.activeKey;
      const f = live.find(v => v._originKey === key && v.status !== 'EXPENDED' && v.status !== 'RECOVERED');
      if (f) return f;
    }
    const name = ev && ev.activeName;
    if (name && !(ev && ev._clone)) { const f = live.find(v => v.status !== 'EXPENDED' && v.status !== 'RECOVERED' && _missionVehicleDisplayName(v) === name); if (f) return f; }
    return active;
  };
  // Find a specific (possibly expended) TARGET vehicle. For cloned events the key is
  // re-scoped to this repetition first. Then display name, then internal name.
  const findVehE = (ev, key, name) => {
    const k = (ev && ev._clone) ? _missionRescopeOriginKey(key, _missionGroupRange(m, ev.groupId), ev._rep) : key;
    return (k && live.find(v => v._originKey === k)) ||
      (key && live.find(v => v._originKey === key)) ||
      (name && !(ev && ev._clone) && live.find(v => _missionVehicleDisplayName(v) === name)) ||
      (name && !(ev && ev._clone) && live.find(v => v.name === name)) || null;
  };
  // ── T2: boiloff on clock advancement ────────────────────────────────────────
  // Apply progApplyStageBoiloff (370) to every stage of every LIVE (not EXPENDED/
  // RECOVERED) vehicle for a Δt in DAYS. Cryo tanks lose mass per PROG_PROPELLANT_TYPES'
  // boiloff_rate; non-cryo/unknown propTypes (incl. LV stages, whose progVehicleDefToLiveStages
  // always assigns a valid LOX_* type. Returns total kg lost
  // across the whole mission (summed onto the caller's event for the "boiloff −N kg" badge).
  // Per-vehicle cumulative boiloff, keyed by stable origin key (survives dock/separate
  // identity changes well enough for a mission-level readiness summary — see check #boiloff-losses,
  // 572). Reset each recompute since the whole log is replayed from scratch.
  m._boiloffByVehicle = {};
  m._initialPropByVehicle = {};   // originKey -> initial total propellant capacity, kg (set at LAUNCH/DEPLOY)
  const applyMissionBoiloff = (deltaDays) => {
    if (!(deltaDays > 0)) return 0;
    let totalLost = 0;
    live.forEach(fv => {
      if (!fv || fv.status === 'EXPENDED' || fv.status === 'RECOVERED') return;
      let vehLost = 0;
      (fv.stages || []).forEach(st => { vehLost += progApplyStageBoiloff(st, deltaDays); });
      if (vehLost > 0 && fv._originKey) {
        m._boiloffByVehicle[fv._originKey] = (m._boiloffByVehicle[fv._originKey] || 0) + vehLost;
        // best-effort initial cap: a vehicle born from a dock/separate (no LAUNCH/DEPLOY of
        // its own) won't have one cached — fall back to its CURRENT capacity so the % is a
        // (conservative, slightly understated) estimate rather than a divide-by-zero.
        if (m._initialPropByVehicle[fv._originKey] == null) {
          m._initialPropByVehicle[fv._originKey] = fv.stages.reduce((s, st) => s + progStageTotalCapacity(st), 0);
        }
      }
      totalLost += vehLost;
    });
    return totalLost;
  };
  // base name resolver (custom rename by origin key, else computed base) — shared by
  // the per-event snapshots and the final display-name pass.
  m.vehicleNames = m.vehicleNames || {};
  const baseOf = v => (v._originKey && m.vehicleNames[v._originKey]) || _missionVehicleBaseName(v);
  // tag each stage with a band-view owner key scoped to its LAUNCH INSTANCE (kid),
  // so two launches of the same vehicle (incl. repeated group launches) get distinct
  // owner tracks AND stage-level ops can re-target the right repetition's vehicle.
  m._ownerLabels = {};
  const tagOwners = (fv, kid, parentName) => {
    fv.stages.forEach((st, i) => {
      const sc = _missionStageOwner(st.stageDefinitionId);
      if (sc) {
        // each SC stage is its OWN owner (keyed by its stage definition, i.e. the
        // specific ascent/descent/service module), so separating a multi-stage
        // spacecraft (e.g. LM ascent/descent) yields distinctly-named, distinctly-
        // tracked vehicles instead of "Apollo LM #1 / #2". An intact multi-stage
        // spacecraft still renders as one band track (co-located owners collapse),
        // and its display name falls back to the spacecraft name via
        // _missionVehicleBaseName for as long as it has >1 stage aboard.
        st._ownerKey = 'sc:' + sc.spacecraftId + ':' + st.stageDefinitionId + '#' + kid;
        const stDef = (sc.stages || []).find(d => d.stageId === st.stageDefinitionId);
        st._ownerLabel = (stDef && stDef.name) || sc.name;
      } else {
        // each LAUNCH-VEHICLE stage is its OWN owner, so separating LV stages
        // (e.g. S-IVB from S-II) yields two distinctly-named vehicles instead of
        // "S-IVB #1 / #2". The band node-graph still draws co-located owners as one
        // track, so the launch stack stays a single line until it actually splits.
        st._ownerKey = 'lv' + i + '#' + kid;
        st._ownerLabel = _missionStageLabelById(st.stageDefinitionId);
      }
      // remember which launch/vehicle this stage came from, so identical stages in a
      // docked / transfer stack can be told apart by their parent.
      st._parentName = parentName; st._parentKid = kid;
      m._ownerLabels[st._ownerKey] = st._ownerLabel;
    });
  };
  // Stable birth order keyed by ORIGIN identity (not object), so a vehicle's #N stays
  // fixed even as dock/separate recreate its object and reorder the live array.
  const birthOrd = {}; let birthSeq = 0;
  const markBirth = fv => {
    if (!fv || fv._originKey == null) return;
    if (!(fv._originKey in birthOrd)) birthOrd[fv._originKey] = birthSeq++;
    fv._birthOrd = birthOrd[fv._originKey];
  };

  // Expand event groups into the effective replay log (repetitions cloned with
  // repetition-scoped keys so each repeat creates fresh, independent vehicles).
  const expanded = _missionEffectiveLog(m);
  m._expanded = expanded;

  // ── T1: mission time core ────────────────────────────────────────────────
  // Time is DERIVED from the replay, never stored as position. metClock walks
  // forward in seconds as each expanded event is processed; T-0 is the FIRST
  // LAUNCH (events authored before it sit at T+0). Per-event duration:
  //   LAUNCH    = ascent burn time (perf.tBT, cached on stagingResult.burnTime)
  //   BURN      = TOF for the underlying transfer (Hohmann/TLI/LOI legs; 0 for
  //               impulsive-only burn types with no separate coast — CIRC/
  //               PLANE_CHANGE/CUSTOM)
  //   MANEUVER  = progTransferTOF(fromNode, toNode) — the coast, not the burn
  //   everything else = 0 (COAST doesn't exist yet — T2)
  // `durationOverride` (seconds, authored on the log entry) replaces the auto
  // value when present. Cached onto both the expanded event and the authored
  // entry (metStart/durationUsed/durationAuto), mirroring existing caches like
  // e.stagingResult so undo/autosave round-trip them for free (they're on m.log).
  let metClock = 0;
  let sawLaunch = false;

  for (let evIdx = 0; evIdx < expanded.length; evIdx++) {
    const e = expanded[evIdx];
    const kid = e._authIdx + (e._rep ? ':' + e._rep : '');   // stable per authored-event + repetition
    const authEntry = (e._authIdx != null && m.log[e._authIdx]) ? m.log[e._authIdx] : null;
    // If this event is bound to a reference orbit, overwrite its inline orbit
    // fields with the ref's CURRENT resolution before replay consumes them — a catalog
    // edit propagates to every binder on next recompute (cached-resolution semantics).
    // Missing/deleted/stub ref: keep the cached inline values, stamp a transient note,
    // never throw.
    if ((e.type === 'LAUNCH' || e.type === 'DEPLOY') && e.orbitRefId) {
      const res = refOrbitResolve(e.orbitRefId);
      if (res && res.kind === 'propagated' && res.seedState) {
        // Phase 4 U3: a propagated ref (nrho-nominal) has no peri/apo/inc to
        // write into the inline Kepler fields — a LAUNCH can never target one
        // (excluded from the launch picker), so this only fires for
        // DEPLOY. Stamp a propagated marker instead of Kepler fields.
        if (e.type === 'DEPLOY') {
          const o = e.orbit || (e.orbit = {});
          o.body = res.body; o.propagated = true; o.refId = e.orbitRefId;
          delete o.periKm; delete o.apoKm; delete o.incDeg;
          delete e._refNote;
          if (authEntry) { authEntry.orbit = { ...o }; delete authEntry._refNote; }
        } else {
          e._refNote = 'a LAUNCH cannot target a propagated orbit — ref ignored';
        }
      } else if (res && res.periKm != null) {
        const o = e.orbit || (e.orbit = {});
        o.body = res.body; o.periKm = res.periKm; o.apoKm = res.apoKm; o.incDeg = res.incDeg;
        if (res.lanDeg != null) o.lanDeg = res.lanDeg;
        delete o.propagated; delete o.refId;
        delete e._refNote;
        if (authEntry) { authEntry.orbit = { ...o }; delete authEntry._refNote; }
      } else {
        e._refNote = 'orbit ref unresolved — using cached values';
        if (authEntry) authEntry._refNote = e._refNote;
      }
    }
    let durationAuto = 0;
    if (e.type === 'LAUNCH') {
      const r = _missionApplyLaunch(m, e);
      if (!r || !r.fv) { e.result = 'FAILED'; continue; }
      r.fv._originKey = 'launch:' + kid;
      _missionRekeyVehicleId(r.fv, m.missionId);
      tagOwners(r.fv, kid, (m.vehicleNames && m.vehicleNames['launch:' + kid]) || e.label || 'Vehicle'); markBirth(r.fv);
      e.vehicleId = r.fv.vehicleId; e.stagingResult = r.stagingResult;
      e.payloadMass = r.payloadMass; e.payloadNames = r.payloadNames;
      live.push(r.fv); active = r.fv;
      r.fv._initialPropCap = r.fv.stages.reduce((s, st) => s + progStageTotalCapacity(st), 0);
      m._initialPropByVehicle[r.fv._originKey] = r.fv._initialPropCap;
      durationAuto = (r.stagingResult && r.stagingResult.burnTime) || 0;
      if (!sawLaunch) { metClock = 0; sawLaunch = true; }   // T-0 = first LAUNCH
      // Ascent burn time is minutes — boiloff over that span is negligible, so
      // ordering vs. the ascent burn itself doesn't matter; applied after for simplicity
      // Only affects OTHER live vehicles (this one has no
      // propellant history yet) unless a depot etc. is already on-orbit.
      e.boiloffKg = applyMissionBoiloff((durationAuto || 0) / 86400);
    } else if (e.type === 'DEPLOY') {
      const r = _missionApplyDeploy(m, e, metClock);
      if (!r || !r.fv) { e.result = 'FAILED'; continue; }
      r.fv._originKey = 'deploy:' + kid;
      _missionRekeyVehicleId(r.fv, m.missionId);
      tagOwners(r.fv, kid, (m.vehicleNames && m.vehicleNames['deploy:' + kid]) || e.label || 'Vehicle'); markBirth(r.fv);
      e.vehicleId = r.fv.vehicleId; e.payloadMass = r.payloadMass; e.payloadNames = r.payloadNames;
      live.push(r.fv); active = r.fv;
      r.fv._initialPropCap = r.fv.stages.reduce((s, st) => s + progStageTotalCapacity(st), 0);
      m._initialPropByVehicle[r.fv._originKey] = r.fv._initialPropCap;
    } else if (e.type === 'BURN') {
      active = resolveActive(e);
      if (!active) continue;
      e.vehicleId = active.vehicleId;
      const osBefore = active.orbitState ? { ...active.orbitState } : null;
      const res = _missionApplyBurn(active, e.burnType, e.burnParam, e.stageId);
      e.dvTarget = res.dvTarget; e.dv_actual = res.dv_actual; e.prop_consumed = res.prop_consumed;
      e.burnLabel = res.burnLabel; e.result = res.result;
      // A phasing burn (missionAddPhasingBurns, 570-
      // mission-events.js) stamps _phaseOffsetDelta on its CLOSING burn — the
      // construction's guaranteed effect (after N revs on the retimed
      // period, the vehicle's along-track clock has shifted by exactly the
      // residual it was built to cancel). CUSTOM burns don't otherwise touch
      // orbitState/r (no re-propagation happens here, honestly),
      // so this is the one place that effect is recorded: a stamped clock
      // correction 567's phase-truth machinery reads (_phaseVehiclePoint),
      // not a hidden fudge on the measured phase itself.
      if (e._phaseOffsetDelta != null && res.result !== 'FAILED' && active.orbitState && active.orbitState.propagated) {
        active.orbitState = { ...active.orbitState, _phaseOffsetS: (active.orbitState._phaseOffsetS || 0) + e._phaseOffsetDelta };
      }
      e.orbitAfter = active.orbitState ? { ...active.orbitState } : null;
      // TOF for the underlying transfer type — Hohmann/TLI/LOI legs have a coast;
      // CIRC (apoapsis burn, no leg of its own) / PLANE_CHANGE / CUSTOM are impulsive.
      if (osBefore && (e.burnType === 'HOHMANN' || e.burnType === 'TLI' || e.burnType === 'LOI')) {
        const body = osBefore.body || 'Earth';
        const altA = osBefore.perigee ?? osBefore.apogee ?? 0;
        if (e.burnType === 'HOHMANN') durationAuto = progHohmannTOF(body, altA, e.burnParam || altA);
        else if (e.burnType === 'TLI') durationAuto = progHohmannTOF('Earth', altA, PROG_MOON_ORBIT_R - PROG_BODIES.Earth.R);
        else if (e.burnType === 'LOI') durationAuto = 0;   // arrival burn at end of an already-counted TLI coast
      }
      // This BURN's own coast is the leg it INITIATES (HOHMANN/TLI depart now, arrive
      // later) — the burn itself is impulsive, so boiloff for the coast is charged AFTER
      // the burn's propellant is spent (ordering is immaterial for the burn's own tank
      // here since the burn already completed; it matters for OTHER live vehicles idling
      // through the same span, e.g. a docked depot).
      e.boiloffKg = applyMissionBoiloff((durationAuto || 0) / 86400);
    } else if (e.type === 'LOWTHRUST') {
      //
      // lane writeup. This branch ALWAYS runs the cheap est. (Edelbaum/
      // rocket-eq) lane synchronously; the expensive integrated lane is
      // computed out-of-band by the "Compute trajectory" button (572/UI) and
      // consulted here ONLY via the signature-keyed side-table (568) — never
      // recomputed inline, per the compute-button contract (no multi-second
      // integration inside missionRecompute).
      active = resolveActive(e);
      if (!active) continue;
      e.vehicleId = active.vehicleId;
      const stage = active.stages.length ? active.stages[active.stages.length - 1] : null;
      const readiness = ltReadinessCheck(stage);
      e._ltReady = readiness.ok;
      e._ltReadyMessage = readiness.message;
      const dur = Math.max(0, e.duration_s || 0);
      const throttle = e.throttle == null ? 1 : Math.max(0, Math.min(1, e.throttle));
      const law = e.law === 'retrograde' ? 'retrograde' : 'prograde';
      e.orbitBefore = active.orbitState ? { ...active.orbitState } : null;
      if (!readiness.ok || !active.orbitState) {
        e.result = 'FAILED'; e._ltState = 'est';
        e.dv_est = 0; e.propUsed_est = 0; e.dv_actual = 0; e.prop_consumed = 0;
        durationAuto = dur;
        e.boiloffKg = applyMissionBoiloff(dur / 86400);
        continue;
      }
      const m0 = progStageMass(stage);   // top/active stage — nothing rides above it by convention
      const ep = { thrust_N: stage.ep_thrust_N, isp_s: stage.ep_isp_s, m0_kg: m0, mDry_kg: stage.dry_mass };
      const est = ltEstimateLeg(ep, dur, throttle);
      e.dv_est = est.dv_est_kms * 1000;   // m/s, matches e.dv_actual's units elsewhere
      e.propUsed_est = est.propUsed_kg;
      const body = active.orbitState.body;
      const altKm = active.orbitState.perigee ?? active.orbitState.apogee ?? 0;
      const vCirc = progVcirc(body, altKm);
      const bodyDef = PROG_BODIES[body];
      // metStart_s = metClock (this event's start MET, before this event's own
      // duration advances the clock) — E4:
      // folded into the signature so an upstream timeline shift (an earlier
      // event's duration edit sliding this leg's metStart) flips STALE even
      // when the leg's own r/v/thrust/duration are byte-identical.
      const sig = ltSignature({
        r: [(bodyDef ? bodyDef.R : 0) + altKm, 0, 0], v: [0, vCirc, 0],
        m0_kg: m0, thrust_N: ep.thrust_N, isp_s: ep.isp_s, throttle, law, duration_s: dur, fidelity: 'default',
        metStart_s: metClock,
      });
      e._ltSig = sig;
      const cached = ltComputedLeg(m.missionId, e._authIdx);
      const useComputed = !!(cached && cached.sig === sig);
      e._ltState = useComputed ? 'computed' : (cached ? 'stale' : 'est');
      const dv_kms   = useComputed ? cached.dvAccum_kms : est.dv_est_kms;
      const propUsed = useComputed ? cached.propUsed_kg : est.propUsed_kg;
      e.dv_actual = dv_kms * 1000;
      e.prop_consumed = propUsed;
      progBurnPropellant(stage, propUsed);
      const signedDv = (law === 'retrograde') ? -dv_kms : dv_kms;
      const newAlt = ltApplyDvToCircularAlt(body, altKm, signedDv);
      active.orbitState = { ...active.orbitState, apogee: newAlt, perigee: newAlt, estOrbit: !useComputed };
      active.status = 'ORBIT';
      e.orbitAfter = { ...active.orbitState };
      e.result = 'SUCCESS';
      durationAuto = dur;
      e.boiloffKg = applyMissionBoiloff(dur / 86400);
    } else if (_evIsSolvedManeuver(e)) {
      // R6.2' Phase B (step 2): a unified MNODE(mode:'solved') replays through
      // this IDENTICAL accounting path as a legacy MANEUVER — same
      // progNmComputeEdgeDv call inside _missionApplyManeuver, same duration
      // precedence, same physics leg build (565's leg builder is keyed off
      // this same predicate). fromNode/toNode/fromLabel/toLabel are mirrored
      // at the top level on both forms (migration/authoring keep them in
      // sync), so every read below is unchanged from the legacy MANEUVER path.
      active = resolveActive(e);
      if (active) e.vehicleId = active.vehicleId;
      // labels are display-only mirrors — refresh them from the current
      // terminology helper each replay so cached logs pick up the dwell/transit
      // phrasing ("TLI (trans-lunar)" not "TLC (trans-lunar)") without migration.
      if (e.fromNode) e.fromLabel = _missionManeuverNodeLabel(e.fromNode, 'from');
      if (e.toNode)   e.toLabel   = _missionManeuverNodeLabel(e.toNode, 'to');
      if (authEntry && authEntry !== e) { authEntry.fromLabel = e.fromLabel; authEntry.toLabel = e.toLabel; }
      // T2 ordering devil: this MANEUVER's duration is the COAST that PRECEDES it
      // (transit-corridor convention, critique 16e — the coast is charged on the leg
      // EXITING a corridor, and the maneuver's burn is the arrival burn at the END of
      // that coast, e.g. LOI ending a TLC->LLO leg). So boiloff for the full coast is
      // applied to every live vehicle BEFORE the maneuver's own propellant burn runs,
      // meaning the burn draws from POST-boiloff tanks — a coast that eats enough cryo
      // propellant correctly starves the arrival burn, and the existing burn-overdraw
      // check (572 #2) catches the resulting shortfall for free.
      // Duration precedence (P2): durationOverride (below, T1 block) > physics
      // leg TOF (previous rebuild's side-table, stale-by-one — see 565 +
      // > launchWindow > Hohmann (both inside progTransferTOF).
      const _physTof = physLegTofFor(m, e, metClock);
      durationAuto = (_physTof != null) ? _physTof
        : progTransferTOF(_missionNmNodeById(e.fromNode), _missionNmNodeById(e.toNode));
      e.boiloffKg = applyMissionBoiloff((durationAuto || 0) / 86400);
      _missionApplyManeuver(active, e);
    } else if (e.type === 'SEPARATE' && e.result === 'SUCCESS') {
      const sepActor = resolveActive(e); if (sepActor) active = sepActor;   // editable: which vehicle separates
      if (!active) continue;
      const parentKey = active._originKey;
      const sepIdx = _missionResolveSepIndex(m, e, active, e.sepIndex);   // owner-scoped per repetition
      const ev = progMakeEvent('SEPARATE', { vehicleId: active.vehicleId, separationIndex: sepIdx });
      const res = progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);
      if (res.result === 'SUCCESS') {
        const lower = PROG_ACTIVE_PROGRAM.vehicles[res.lowerVehicleId];
        const upper = PROG_ACTIVE_PROGRAM.vehicles[res.upperVehicleId];
        // the lower (continuing) vehicle keeps the parent's identity inside a group so a
        // persistent depot can be docked again next repetition; the jettisoned upper is new.
        if (lower) lower._originKey = (e.groupId && parentKey) ? parentKey : ('sepL:' + kid);
        if (upper) upper._originKey = 'sepU:' + kid;
        if (lower) _missionRekeyVehicleId(lower, m.missionId);
        if (upper) _missionRekeyVehicleId(upper, m.missionId);
        markBirth(lower); markBirth(upper);
        e.parentVehicleId = active.vehicleId; e.lowerVehicleId = lower ? lower.vehicleId : res.lowerVehicleId; e.upperVehicleId = upper ? upper.vehicleId : res.upperVehicleId;
        e.parentName = _missionVehicleDisplayName(active);
        e.lowerName = lower ? _missionVehicleDisplayName(lower) : '?'; e.upperName = upper ? _missionVehicleDisplayName(upper) : '?';
        e.lowerStages = lower ? lower.stages.length : 0; e.upperStages = upper ? upper.stages.length : 0;
        live = live.filter(v => v !== active); if (lower) live.push(lower); if (upper) live.push(upper);
        active = upper || lower || null;
      }
    } else if (e.type === 'DOCK') {
      // NOTE: re-attempted on EVERY replay regardless of the authored/previous
      // e.result — the gate used to be `e.result === 'SUCCESS'`, which read the
      // STALE value from a prior recompute (or the optimistic value set at
      // authoring time in missionExecDock) and never re-ran progDispatchEvent
      // once that gate failed to match. That meant a dock broken by editing an
      // earlier maneuver stayed silently "SUCCESS" (stale merged-vehicle info,
      // both vehicles left un-merged) instead of flipping to FAILED, and a dock
      // fixed by editing the maneuver back could never re-succeed. Docking is a
      // physical feasibility check (progOrbitalStateMatch) re-evaluated fresh
      // from replayed state every time, like BURN/MANEUVER/SEPARATE — there is
      // no "user deliberately deleted this dock" concept distinct from deleting
      // the log entry itself, so always re-attempting is correct here.
      const dockActor = resolveActive(e); if (dockActor) active = dockActor;   // editable: which vehicle docks
      // target by stable key first (so a persistent depot is found again every repetition),
      // then by internal name. The merged vehicle inherits the target's identity + owner tags.
      const tKey = e._clone ? _missionRescopeOriginKey(e.targetKey, _missionGroupRange(m, e.groupId), e._rep) : e.targetKey;
      const target = (tKey && live.find(v => v !== active && v._originKey === tKey))
        || (e.targetKey && live.find(v => v !== active && v._originKey === e.targetKey))
        || live.find(v => v !== active && v.name === e.tName);
      if (active && target) {
        const targetKey0 = target._originKey;
        e.aDisp = _missionVehicleBaseName(active); e.tDisp = _missionVehicleBaseName(target);   // clean names for the card
        const ev = progMakeEvent('DOCK', { vehicleIds: [active.vehicleId, target.vehicleId], bottomVehicleId: target.vehicleId });
        const res = progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);
        e.result = res.result;
        if (res.result === 'SUCCESS') {
          const merged = PROG_ACTIVE_PROGRAM.vehicles[res.vehicleId];
          if (merged) {
            merged._originKey = targetKey0 || ('dock:' + kid);   // keep the depot's identity across repetitions
            _missionRekeyVehicleId(merged, m.missionId);
            markBirth(merged);
            // preserve each stage's owner tag (progMakeFlightVehicle reuses the stage objects)
            merged.stages.forEach(st => { if (st._ownerKey == null) { const sc = _missionStageOwner(st.stageDefinitionId); st._ownerKey = (sc ? 'sc:' + sc.spacecraftId : 'lv') + '#dock'; } });
          }
          e.aVehId = active.vehicleId; e.tVehId = target.vehicleId; e.mergedVehicleId = merged ? merged.vehicleId : res.vehicleId;
          e.mergedName = merged ? _missionVehicleDisplayName(merged) : '?'; e.mergedStages = merged ? merged.stages.length : 0;
          live = live.filter(v => v !== active && v !== target); if (merged) live.push(merged);
          active = merged || null;
        } else {
          e.warnings = res.warnings || ev.warnings || ['Orbits do not match'];
        }
      } else {
        e.result = 'FAILED';
        e.warnings = ['Target vehicle not found'];
      }
    } else if (e.type === 'EXPEND') {
      const tgt = findVehE(e, e.targetKey, e.vehicleName || e.stageName) || active;
      if (tgt) { tgt.status = 'EXPENDED'; e.vehicleId = tgt.vehicleId; if (e.vehicleLevel) e.vehicleName = _missionVehicleDisplayName(tgt); if (active === tgt) active = live.find(v => v !== tgt && v.status !== 'EXPENDED') || tgt; }
    }
    else if (e.type === 'RENDEZVOUS') {
      active = resolveActive(e);
      if (active) { e.vehicleId = active.vehicleId; e.activeName = _missionVehicleDisplayName(active); }
      const tgt = findVehE(e, e.targetKey, e.targetName);
      if (tgt) { e.targetName = _missionVehicleDisplayName(tgt); e.targetVehId = tgt.vehicleId; }
      // Phase truth AT this event's MET, measured BEFORE
      // the co-orbital merge below overwrites active's orbitState with tgt's —
      // this is the honest "how far apart were they really" reading; the merge
      // itself stays R1-unchanged (still co-orbital success, no new solving).
      e.phase = (active && tgt && tgt !== active && typeof phaseTruthBetween === 'function')
        ? phaseTruthBetween(active.orbitState, tgt.orbitState, metClock) : null;
      if (active && tgt && tgt !== active && tgt.orbitState) { active.orbitState = { ...tgt.orbitState }; e.matched = true; } else { e.matched = false; }
    }
    else if (e.type === 'TRANSFER_PROPELLANT') {
      active = resolveActive(e);
      if (active) {
        // resolve the destination vehicle: another live vehicle (a depot) if set, else active
        let dstFv = active;
        if (e.destVehicleKey) {
          const dk = e._clone ? _missionRescopeOriginKey(e.destVehicleKey, _missionGroupRange(m, e.groupId), e._rep) : e.destVehicleKey;
          dstFv = live.find(v => v._originKey === dk) || live.find(v => v._originKey === e.destVehicleKey) || active;
        }
        if (dstFv === active) {
          const r = _missionResolveXferStages(m, e, active, e.sourceIndex, e.destIndex);
          e.sourceIndex = r.si; e.destIndex = r.di;
        } else {
          // cross-vehicle: clamp each index to its own vehicle's stage list
          e.sourceIndex = Math.min(Math.max(0, e.sourceIndex || 0), active.stages.length - 1);
          e.destIndex   = Math.min(Math.max(0, e.destIndex   || 0), dstFv.stages.length - 1);
        }
        e.vehicleId = active.vehicleId; e.destVehicleId = dstFv.vehicleId;
        _missionApplyPropTransfer(active, dstFv, e);
      }
    }
    else if (e.type === 'TRANSFER_CREW') {
      active = resolveActive(e);
      if (active) {
        const r = _missionResolveXferStages(m, e, active, e.sourceIndex, e.destIndex);
        e.sourceIndex = r.si; e.destIndex = r.di;
        e.vehicleId = active.vehicleId; _missionApplyCrewTransfer(active, e);
      }
    }
    else if (e.type === 'REENTER') {
      active = resolveActive(e);
      if (active) { e.vehicleId = active.vehicleId; e.vehicleName = _missionVehicleDisplayName(active);
        const ev = progMakeEvent('LAND', { vehicleId: active.vehicleId, body: 'Earth' });
        progDispatchEvent(PROG_ACTIVE_PROGRAM, ev);
        e.orbitAfter = active.orbitState ? { ...active.orbitState } : null; e.result = 'SUCCESS'; }
    }
    else if (e.type === 'RECOVER') {
      const tgt = findVehE(e, e.targetKey, e.vehicleName) || active;
      if (tgt) { tgt.status = 'RECOVERED'; e.vehicleId = tgt.vehicleId; e.vehicleName = _missionVehicleDisplayName(tgt);
        if (active === tgt) active = live.find(v => v !== tgt && v.status !== 'EXPENDED' && v.status !== 'RECOVERED') || tgt; }
    }
    else if (e.type === 'COAST') {
      // The ONLY event type where the user authors time directly ("loiter 30 days in
      // NRHO"). durationOverride is NOT needed here — e.days IS the authored duration.
      durationAuto = Math.max(0, e.days || 0) * 86400;
      e.result = 'SUCCESS';
      e.boiloffKg = applyMissionBoiloff(Math.max(0, e.days || 0));
    }
    else if (e.type === 'MNODE') {
      // P2 vector maneuver node (authored via missionExecManeuverNode, 565; no
      // dock UI until P4). Burns propellant through the SAME rocket-eq path as
      // MANEUVER burn steps with |Δv| = √(pro²+rad²+nrm²); advances NO orbit
      // state — the node-map orbit stays where it is (the physics-side
      // trajectory divergence is P3/P4's problem; critique).
      active = resolveActive(e);
      if (active) {
        e.vehicleId = active.vehicleId;
        // Cache the vehicle's node-map orbit at the burn so the physics
        // rebuild (565) can reconstruct + propagate the post-burn trajectory
        // (same replay-derived-cache pattern as e.orbitAfter / e.stagingResult).
        // OrbitAtBurn is a CANONICAL boundary field
        // (periKm/apoKm/incDeg/lanDeg). active.orbitState is the 380 dialect
        // (perigee/apogee/inclination/lan) — translate the element field names
        // to canonical here (the ONE writer), spreading the rest (body/surface/
        // propagated/r/v/frame) through unchanged so 565's oValid/propagated
        // checks and orbitWorldState/orbitMeanRadiusKm reads keep working.
        e.orbitAtBurn = active.orbitState ? _missionOrbitAtBurnCanonical(active.orbitState) : null;
        if (authEntry) authEntry.orbitAtBurn = e.orbitAtBurn;
        const fullDv = Math.sqrt(Math.pow(e.dvPro_ms || 0, 2) + Math.pow(e.dvRad_ms || 0, 2) + Math.pow(e.dvNrm_ms || 0, 2));
        e.dvRequired = Math.round(fullDv);
        let delivered = 0, propTotal = 0;
        const st = active.stages.find(s => s.stageDefinitionId === _missionDefaultFiringStageId(active)) || null;
        if (st && (st.isp || 0) > 0 && fullDv > 0) {
          const m_wet = _missionVehWetMass(active);
          const avail = progStageRemainingProp(st);
          if (avail > 0) {
            const need = progRocketEqPropNeeded(m_wet, fullDv, st.isp);
            if (need > avail) { propTotal = avail; delivered = progRocketEqDv(m_wet, avail, st.isp); }
            else { propTotal = need; delivered = fullDv; }
            progBurnPropellant(st, propTotal);
            e.firedStageId = st.stageDefinitionId;
          }
        }
        e.dv = Math.round(delivered); e.dv_actual = Math.round(delivered); e.dvDelivered = Math.round(delivered);
        e.prop_consumed = Math.round(propTotal);
        e.result = fullDv > 0 ? (delivered + 1 >= fullDv ? 'SUCCESS' : 'MARGINAL') : 'SUCCESS';
      } else { e.result = 'FAILED'; }
    }
    // ── T1: MET bookkeeping — durationOverride (authored, seconds) wins over the
    //    computed auto value; both are cached so the UI can show "(custom)". Events
    //    before the first LAUNCH sit at T+0 (metClock hasn't started advancing yet). ──
    const overrideSec = authEntry && authEntry.durationOverride != null ? authEntry.durationOverride : null;
    const durationUsed = overrideSec != null ? overrideSec : durationAuto;
    e.metStart = metClock;
    e.durationAuto = durationAuto;
    e.durationUsed = durationUsed;
    if (authEntry) { authEntry.metStart = metClock; authEntry.durationAuto = durationAuto; authEntry.durationUsed = durationUsed; authEntry.boiloffKg = e.boiloffKg; }
    if (sawLaunch) metClock += durationUsed;
    // per-event snapshot: state of every live vehicle AFTER this event (the band
    // monitor reads this so scrubbing shows the exact state at that point in time).
    e.snapshot = _missionCaptureSnapshot(live, baseOf);
    e.activeOriginKey = active ? (active._originKey || null) : null;
  }
  m._metTotal = metClock;
  // ── resolve display names: custom rename (by stable origin key) + #N for duplicates,
  //    numbered by stable BIRTH order so a vehicle's # never shifts as docks/separates
  //    reorder the live array. ──
  const _resolved = _missionResolveDisplayNames(live, baseOf);
  live.forEach(v => { v.displayName = _resolved.get(v) || baseOf(v); });
  // refresh cached child names on separate/dock cards to match
  expanded.forEach(e => {
    if (e.type === 'SEPARATE' && e.result === 'SUCCESS') {
      const lo = PROG_ACTIVE_PROGRAM.vehicles[e.lowerVehicleId], up = PROG_ACTIVE_PROGRAM.vehicles[e.upperVehicleId];
      if (lo && lo.displayName) e.lowerName = lo.displayName;
      if (up && up.displayName) e.upperName = up.displayName;
    } else if (e.type === 'DOCK' && e.result === 'SUCCESS') {
      const mg = PROG_ACTIVE_PROGRAM.vehicles[e.mergedVehicleId];
      if (mg && mg.displayName) e.mergedName = mg.displayName;
    } else if ((e.type === 'EXPEND' && e.vehicleLevel) || e.type === 'RECOVER' || e.type === 'REENTER') {
      const v = PROG_ACTIVE_PROGRAM.vehicles[e.vehicleId];
      if (v && v.displayName) e.vehicleName = v.displayName;
    } else if (e.type === 'RENDEZVOUS') {
      const a = PROG_ACTIVE_PROGRAM.vehicles[e.vehicleId];
      if (a && a.displayName) e.activeName = a.displayName;
      const t = e.targetVehId ? PROG_ACTIVE_PROGRAM.vehicles[e.targetVehId] : null;
      if (t && t.displayName) e.targetName = t.displayName;
    }
  });

  m.vehicleIds = live.map(v => v.vehicleId);
  m.vehicleId = active ? active.vehicleId : (m.vehicleIds[0] || null);
  // P2 physics bridge: rebuild propagated trajectory legs into the 565
  // side-table (results NEVER stored on m — autosave/undo leak guard). Runs
  // BEFORE autosave/undo/checks; may trigger ONE extra recompute pass when a
  // physics TOF disagrees >1% with the duration this replay used (see 565).
  if (PHYS_ENABLED) {
    try { physRebuildMissionTrajectories(m); } catch (err) { console.warn('physics trajectory rebuild failed:', err); }
  }
  // Builds a VehicleState timeline
  // alongside V1, promoting the legs just rebuilt above. Transient side-table
  // only (never on m); read only by v2Reconcile/reconciliation tooling.
  // Zero user-visible effect.
  try { v2BuildShadow(m); } catch (err) { console.warn('v2 shadow build failed:', err); }
  // Phase 2 S4 ( step 2, "stamp-from-V2"): overwrite the
  // consumer-read fields (e.dv_actual, e.prop_consumed) on every burn-family
  // expanded entry FROM the just-built V2 timeline, so band/checks/report/
  // node-map/state-panel — none of which change in this phase ('s
  // blast-radius trick) — start reading physics-derived delivered ΔV instead
  // of V1's bookkeeping. e.dvRequired/e.dvTarget for solved edges are left
  // untouched (still progNmComputeEdgeDv, unchanged authority). A
  // burn with no promotable V2 dv (dv_ms: null — an unconverged/un-anchored
  // corridor edge, "never silently skip") keeps its V1-computed value
  // rather than being blanked.
  if (m.missionId) {
    const vb = v2DeriveBudget(m.missionId);
    const byAuth = {};
    vb.perBurn.forEach(function (b) { if (!(b.authIdx in byAuth)) byAuth[b.authIdx] = b; });
    expanded.forEach(function (e) {
      if (e.type !== 'BURN' && e.type !== 'MNODE') return;
      const authIdx = e._authIdx != null ? e._authIdx : null;
      const b = authIdx != null ? byAuth[authIdx] : null;
      if (b && b.dv_ms != null) {
        e.dv_actual = Math.round(b.dv_ms);
        e.dvDelivered = Math.round(b.dv_ms);
        e.dv = Math.round(b.dv_ms);
        e.prop_consumed = Math.round(b.prop_kg || 0);
        // e.result (SUCCESS/MARGINAL) was set by the V1 replay against V1's
        // OWN prop-limited delivered ΔV, before the stamp above overwrote
        // dv_actual with the simulated value — re-derive it against the
        // stamped number so readiness checks (572) see a consistent
        // required-vs-delivered pair instead of a stale verdict (F1,:
        // "reason about it, don't suppress it" — the arrival-burn flip can
        // legitimately turn a V1 shortfall into an over-delivery or vice
        // versa; this keeps the SUCCESS/MARGINAL badge honest either way).
        if (e.dvRequired != null) {
          e.result = (b.dv_ms + 1 >= e.dvRequired) ? 'SUCCESS' : 'MARGINAL';
        }
      }
    });
  }
  if (typeof autosaveScheduleSave === 'function') autosaveScheduleSave();
  if (typeof missionUndoCapture === 'function') missionUndoCapture(m);
  // Flight Readiness checks are derived state — computed LAST, after autosave has
  // already scheduled its save and undo has already captured its snapshot, so
  // neither persistence path can pick them up (see 572-mission-checks.js header).
  missionRunChecks(m);
}
