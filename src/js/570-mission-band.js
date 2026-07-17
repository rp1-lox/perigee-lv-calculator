// ─────────────────────────────────────────────────────────────────────────────
// 570-mission-band.js — Mission band view (altitude-vs-event timeline) + authoring
//
// OWNS: the band-view data model (_missionBandModel) and SVG (_missionBandViewHTML),
//   band scrub/lane-color/body-zone styling, the Add-Event dock (_missionAddEventHTML,
//   missionSetAddEvt), maneuver-node (MNODE) authoring/editing from the dock
//   (missionExecMnodeFromDock, missionSolveFreeReturn, missionApplyMnodeEdit,
//   missionMnodeNudge, missionMnodeResolveToTarget, missionApplyMnodeCaTarget),
//   and PNG export of the current view (missionExportPNG, _missionResolveCssVars).
// Does NOT own: the node-map view (570-mission-nodemap.js), replay (570-mission-replay.js),
//   or event-card rendering (still in the manager remainder for now).
// Split out of 570-mission-manager.js (behavior-preserving move). Definitions/consts
//   only (no load-time execution); load order relative to the manager is immaterial.
// ─────────────────────────────────────────────────────────────────────────────
// ── Band view data model (event-based) ──────────────────────────────────────
function _missionAltToYFrac(alt) {
  const a = Math.max(0, alt || 0);
  return Math.max(0, Math.min(1, Math.log10(a + 1) / Math.log10(500000)));
}

// Swimlane band model: each vehicle is a horizontal lane (row); X is a timeline
// column (simultaneous events share a column). A separated vehicle spawns on a
// new row just ABOVE its parent; docked vehicles merge onto one row.
// Owner-centric swimlane model: one persistent lane per "owner" — each spacecraft
// payload and the launch vehicle. Built from the per-event snapshots. Separations
// just let owners continue on their own rows; docking puts two owners in one vehicle
// so their lines run side by side (a "docked" tie connects them).
const _MISSION_BAND_PALETTE = ['#61afef','#e5c07b','#98c379','#c678dd','#56b6c2','#e06c75','#d19a66'];

// Resolve a lane's display color: user override (keyed by stable owner LABEL,
// stored on the mission so it survives save/load + autosave) beats the
// index-based palette default. `fallbackIdx` is the owner's insertion order
// within this replay (ownerKey embeds per-replay kid indices and regenerates,
// so labels — not keys — are the stable, human-meaningful storage key).
function _missionLaneColor(m, label, fallbackIdx, palette) {
  const pal = palette || _MISSION_BAND_PALETTE;
  if (m && m.laneColors && m.laneColors[label]) return m.laneColors[label];
  return pal[fallbackIdx % pal.length];
}

// User picked a custom color for a band-view lane (by owner label). Persists
// on the mission object (survives save/load + autosave), captures undo, and
// re-renders the detail view (band redraw needs the model rebuilt with the new color).
function missionSetLaneColor(missionId, label, hex) {
  const m = (typeof _missionGet === 'function') ? _missionGet(missionId) : null;
  if (!m) return;
  m.laneColors = m.laneColors || {};
  m.laneColors[label] = hex;
  if (typeof autosaveScheduleSave === 'function') autosaveScheduleSave();
  if (typeof missionUndoCapture === 'function') missionUndoCapture(m);
  missionRenderDetail();
}

// WORKFLOW PASS 1 deliverable C: single color-source entry point. The band
// view's actual override storage (m.laneColors) is keyed by owner display
// LABEL (a band "owner" = one LV/spacecraft stage-track — see _missionLaneColor
// above); the HUD strip and snapshot data instead only have a runtime VEHICLE
// id/originKey handy (a vehicle can host >1 owner, e.g. a docked LV stage +
// payload). `vehicleKey` accepts either: an owner key found directly in
// m._ownerLabels (the label-lookup path other callers like 5741's scene
// extraction already use via _missionLaneColor), or a vehicle id/originKey,
// in which case this falls back to asking the band model which owner lane(s)
// live on that vehicle and returns the first one with a custom color. Returns
// `fallback` (default null) when nothing custom is assigned, so callers keep
// their own existing default derivation unchanged — missions with no custom
// laneColors see zero visual change (regression guard).
function _missionVehicleColor(m, vehicleKey, fallback) {
  if (!m || !vehicleKey) return fallback == null ? null : fallback;
  const directLabel = m._ownerLabels && m._ownerLabels[vehicleKey];
  if (directLabel && m.laneColors && m.laneColors[directLabel]) return m.laneColors[directLabel];
  if (typeof _missionBandModel === 'function') {
    try {
      const band = _missionBandModel(m);
      for (const L of band.lanes) {
        if (L.points.some(p => p.vehicleId === vehicleKey) && m.laneColors && m.laneColors[L.name]) {
          return m.laneColors[L.name];
        }
      }
    } catch (e) { /* best-effort only — never block the HUD render */ }
  }
  return fallback == null ? null : fallback;
}

// HUD-swatch discoverability (workflow pass 2, user report 2026-07-15: "can't
// figure out how to change the color of the orbit in the trajectory map").
// The HUD chip is vehicle-granularity but m.laneColors is owner-label-granularity
// (see _missionVehicleColor above); this resolves the PRIMARY owner label for a
// vehicleKey — the same label whose color the chip's accent already shows — so
// the swatch edits exactly the lane the user sees colored. Mirrors the lookup
// order in _missionVehicleColor (direct label match, else first band-lane owner
// on this vehicle) so the swatch always targets what's actually displayed.
function _missionVehiclePrimaryLabel(m, vehicleKey) {
  if (!m || !vehicleKey) return null;
  const directLabel = m._ownerLabels && m._ownerLabels[vehicleKey];
  if (directLabel) return directLabel;
  if (typeof _missionBandModel === 'function') {
    try {
      const band = _missionBandModel(m);
      for (const L of band.lanes) {
        if (L.points.some(p => p.vehicleId === vehicleKey)) return L.name;
      }
    } catch (e) { /* best-effort only */ }
  }
  return null;
}

// Effective color for a vehicle chip's swatch fill: custom override if set,
// else the same default the band-view legend would show for that owner.
function _missionVehicleSwatchColor(m, vehicleKey) {
  const label = _missionVehiclePrimaryLabel(m, vehicleKey);
  if (!label) return _MISSION_BAND_PALETTE[0];
  if (m.laneColors && m.laneColors[label]) return m.laneColors[label];
  if (typeof _missionBandModel === 'function') {
    try {
      const band = _missionBandModel(m);
      const L = band.lanes.find(l => l.name === label);
      if (L) return L.color;
    } catch (e) { /* best-effort only */ }
  }
  return _MISSION_BAND_PALETTE[0];
}

// Reset gesture (right-click the HUD swatch): deletes the override for this
// vehicle's primary owner label so the default palette color returns. Shares
// the same storage + save/undo/re-render path as missionSetLaneColor — one
// write path to m.laneColors, just the delete branch of it.
function missionResetLaneColorForVehicle(missionId, vehicleKey) {
  const m = (typeof _missionGet === 'function') ? _missionGet(missionId) : null;
  if (!m || !m.laneColors) return;
  const label = _missionVehiclePrimaryLabel(m, vehicleKey);
  if (!label || !(label in m.laneColors)) return;
  delete m.laneColors[label];
  if (typeof autosaveScheduleSave === 'function') autosaveScheduleSave();
  if (typeof missionUndoCapture === 'function') missionUndoCapture(m);
  missionRenderDetail();
}

// HUD chip swatch: reuses missionSetLaneColor as the sole write path (same
// function the band-view legend's <input type="color"> onchange calls) —
// resolves vehicleKey to its primary owner label first.
function missionSetLaneColorForVehicle(missionId, vehicleKey, hex) {
  const m = (typeof _missionGet === 'function') ? _missionGet(missionId) : null;
  if (!m) return;
  const label = _missionVehiclePrimaryLabel(m, vehicleKey);
  if (!label) return;
  missionSetLaneColor(missionId, label, hex);
}

function _missionBandModel(m) {
  const palette = _MISSION_BAND_PALETTE;
  const log = (m._expanded && m._expanded.length) ? m._expanded : m.log;
  // colOf: normal events advance a column; sameTimeAsPrev share the prev column;
  // midCoast events ALSO share the prev column but sit at a fractional x-offset, so
  // they read as happening DURING the previous transfer's coast (not instantaneously).
  const colOf = [], xFracOf = []; let col = 0, coastN = 0;
  log.forEach((e, i) => {
    const share = i > 0 && (e.sameTimeAsPrev || e.midCoast);
    if (i > 0 && !share) col++;
    colOf[i] = col;
    if (e.midCoast) { coastN++; xFracOf[i] = Math.min(0.85, 0.5 + (coastN - 1) * 0.18); }
    else { coastN = 0; xFracOf[i] = 0; }
  });
  const colCount = log.length ? col + 1 : 0;

  const owners = new Map();
  let colorIdx = 0, birth = 0;
  const ownerName = key => {
    if (m._ownerLabels && m._ownerLabels[key]) return m._ownerLabels[key];   // unified label (upper stage / spacecraft)
    const h = key.indexOf('#');
    const head = h >= 0 ? key.slice(0, h) : key;
    if (head.startsWith('sc:')) { const scId = head.slice(3); const sc = _scEdSC.find(s => s.spacecraftId === scId); return sc ? sc.name : head; }
    return 'Launch Vehicle';
  };
  const ensure = key => {
    if (!owners.has(key)) {
      const name = ownerName(key);
      const idx = colorIdx++;
      owners.set(key, { key, name, color: _missionLaneColor(m, name, idx, palette), birth: birth++, points: [], endCol: null, expended: false, _ended: false });
    }
    return owners.get(key);
  };

  // per-column docked groups: vehicleId -> set of owner keys sharing that vehicle
  const dockTies = [];   // { col, ownerKeys:[...] }
  const events = [];

  log.forEach((e, i) => {
    const c = colOf[i];
    const snap = e.snapshot || [];
    const placed = new Set();
    const byVehicle = {};
    snap.forEach(v => {
      const z = _missionOrbitZone(v.orbit);
      (v.owners || []).forEach(key => {
        // group for docked tie
        (byVehicle[v.vehicleId] = byVehicle[v.vehicleId] || []).push(key);
        if (placed.has(key)) return;          // one point per owner per column
        const existing = owners.get(key);
        if (existing && existing._ended) return;
        placed.add(key);
        const L = ensure(key);
        L.points.push({ col: c, xFrac: xFracOf[i] || 0, alt: v.alt || 0, vehicleId: v.vehicleId, status: v.status, index: i, zoneKey: z.key, zoneOrder: z.order, zoneLabel: z.label });
        if (v.status === 'EXPENDED' || v.status === 'RECOVERED') L._ended = true;
      });
    });
    Object.values(byVehicle).forEach(keys => { if (keys.length > 1) dockTies.push({ col: c, ownerKeys: [...new Set(keys)] }); });
    let label = e.type;
    if (e.type === 'BURN') label = e.burnLabel || 'BURN';
    else if (_evIsSolvedManeuver(e)) label = '→ ' + (e.toLabel || e.toNode || '');
    events.push({ index: i, type: e.type, col: c, label, met: e.metStart, durationUsed: e.durationUsed });
  });

  const lanes = [...owners.values()];
  lanes.sort((a, b) => a.birth - b.birth);
  // disambiguate duplicate lane names (e.g. two Vulcan Centaur launches → #1 / #2)
  const nameCnt = {}; lanes.forEach(L => { nameCnt[L.name] = (nameCnt[L.name] || 0) + 1; });
  const nameSeen = {};
  lanes.forEach(L => { if (nameCnt[L.name] > 1) { nameSeen[L.name] = (nameSeen[L.name] || 0) + 1; L.name = L.name + ' #' + nameSeen[L.name]; } });
  lanes.forEach(L => {
    if (L.points.length) {
      L.endCol = L.points[L.points.length - 1].col;
      L.expended = L._ended;
      L.live = (L.endCol === colCount - 1) && !L.expended;
    }
  });

  // ── zones: the Earth→cislunar ladder is always shown so higher orbits are
  //    immediately available; deeper regions (lunar, Mars…) appear once visited. ──
  const zoneMap = {
    earth: { key: 'earth', label: 'Earth', order: 0 },
    leo:   { key: 'leo',   label: 'LEO', order: 10 },
    meo:   { key: 'meo',   label: 'MEO / GTO', order: 16 },
    heo:   { key: 'heo',   label: 'Elliptical / Cislunar', order: 20 },
  };
  lanes.forEach(L => L.points.forEach(p => { if (!zoneMap[p.zoneKey]) zoneMap[p.zoneKey] = { key: p.zoneKey, label: p.zoneLabel, order: p.zoneOrder }; }));
  const zones = Object.values(zoneMap).sort((a, b) => a.order - b.order);
  const zoneSlot = {}; zones.forEach((z, idx) => { z.slot = idx; zoneSlot[z.key] = idx; z.bodyGroup = _missionBodyGroupOf(z.key); });

  // ── per-point vertical offset WITHIN a zone: different vehicles separate, docked
  //    owners (same vehicle) cluster — keeps the polylines distinct but converging. ──
  // OWNER_SPREAD = 0: owners sharing a vehicle (co-manifested OR docked) sit at the
  // SAME point so the band view can draw them as one track until they SEPARATE.
  const VEH_SPREAD = 18, OWNER_SPREAD = 0;
  log.forEach((e, i) => {
    const c = colOf[i];
    const here = [];
    lanes.forEach(L => { const p = L.points.find(pp => pp.col === c); if (p) here.push({ L, p }); });
    const byZone = {};
    here.forEach(o => { (byZone[o.p.zoneKey] = byZone[o.p.zoneKey] || []).push(o); });
    Object.values(byZone).forEach(group => {
      const byVeh = {};
      group.forEach(o => { (byVeh[o.p.vehicleId] = byVeh[o.p.vehicleId] || []).push(o); });
      const vehs = Object.values(byVeh); const V = vehs.length;
      vehs.sort((a, b) => a[0].L.birth - b[0].L.birth);
      vehs.forEach((owners2, vi) => {
        const vehOff = (vi - (V - 1) / 2) * VEH_SPREAD;
        owners2.sort((a, b) => a.L.birth - b.L.birth);
        const O = owners2.length;
        owners2.forEach((o, oi) => { o.p.yOff = vehOff + (oi - (O - 1) / 2) * OWNER_SPREAD; });
      });
    });
  });
  lanes.forEach(L => L.points.forEach(p => { if (p.yOff == null) p.yOff = 0; }));

  // ── ascent: a vehicle that LAUNCHED should be shown rising up FROM the Earth
  //    band (not just appearing in LEO). Prepend a synthetic Earth-surface point
  //    at the launch column so the track draws a vertical climb out of Earth. ──
  lanes.forEach(L => {
    if (!L.points.length) return;
    const first = L.points[0];
    const ev = events[first.index];
    if (ev && ev.type === 'LAUNCH' && first.zoneKey !== 'earth') {
      L.points.unshift({ col: first.col, alt: 0, vehicleId: first.vehicleId, status: first.status,
        index: first.index, zoneKey: 'earth', zoneOrder: 0, zoneLabel: 'Earth', yOff: first.yOff || 0, _ascent: true });
    }
  });

  return { events, lanes, zones, zoneSlot, count: m.log.length, colCount, colOf };
}

// Map a band zoneKey (from _missionOrbitZone) to its body/system group, for the
// band-view "body zone" backdrop (decoration only — matches node-map zone naming:
// earth | lunar | interp). Used to tint bands by which body they orbit/sit on.
function _missionBodyGroupOf(zoneKey) {
  if (zoneKey === 'earth' || zoneKey === 'leo' || zoneKey === 'meo' || zoneKey === 'heo') return 'earth';
  if (zoneKey === 'moon' || zoneKey === 'llo' || zoneKey === 'nrho') return 'lunar';
  if (zoneKey === 'mars' || zoneKey === 'mars-orbit' || zoneKey === 'venus-orbit' || zoneKey === 'transit'
      || zoneKey.endsWith('-surf') || zoneKey.endsWith('-orbit')) return 'interp';
  return null;   // 'space'/'coast' — no specific body, no zone backdrop
}
const _MISSION_BODY_ZONE_COLOR = { earth: 'var(--nm-earth)', lunar: 'var(--nm-lunar)', interp: 'var(--nm-interp)' };
const _MISSION_BODY_ZONE_TINT  = { earth: 'var(--nm-earth-zone)', lunar: 'var(--nm-lunar-zone)', interp: 'var(--nm-interp-zone)' };
const _MISSION_BODY_ZONE_LABEL = { earth: 'EARTH', lunar: 'CISLUNAR', interp: 'INTERPLANETARY' };

// Map an orbital state to a labelled band/zone, ordered by energy (Earth low → high).
function _missionOrbitZone(o) {
  if (!o || o.body == null) return { key: 'space', label: 'Coast', order: 22 };
  if (o.surface) {
    const b = o.body;
    if (b === 'Earth') return { key: 'earth', label: 'Earth', order: 0 };
    if (b === 'Moon')  return { key: 'moon',  label: 'Moon', order: 40 };
    if (b === 'Mars')  return { key: 'mars',  label: 'Mars', order: 72 };
    return { key: b.toLowerCase() + '-surf', label: b, order: 62 };
  }
  const alt = ((o.apogee ?? o.perigee ?? 0) + (o.perigee ?? o.apogee ?? 0)) / 2;
  switch (o.body) {
    case 'Earth':
      if (alt < 2000)  return { key: 'leo', label: 'LEO', order: 10 };
      if (alt < 30000) return { key: 'meo', label: 'MEO / GTO', order: 16 };
      return { key: 'heo', label: 'Elliptical / Cislunar', order: 20 };
    case 'Moon':
      if (alt < 5000) return { key: 'llo', label: 'Low Lunar Orbit', order: 36 };
      return { key: 'nrho', label: 'NRHO / High Lunar', order: 30 };
    case 'Mars':  return { key: 'mars-orbit',  label: 'Mars Orbit',  order: 66 };
    case 'Venus': return { key: 'venus-orbit', label: 'Venus Orbit', order: 60 };
    case 'Sun':   return { key: 'transit',     label: 'Interplanetary Transit', order: 50 };
    default:      return { key: (o.body || 'x') + '-orbit', label: (o.body || '') + ' Orbit', order: 55 };
  }
}

// Scrub to a band event AND open that event's card in the EVENTS panel.
function missionBandScrubTo(id, idx) {
  _missionBandScrub = (idx == null ? null : +idx);
  _missionBandOpenEvent(id, idx);
}

// Click a band-view dot: select that dot's vehicle as active AND scrub to the event,
// so you can pick a specific vehicle (even on a crowded track) just by clicking it.
function missionBandPickVehicle(id, vid, idx) {
  const m = _missionGet(id); if (!m) return;
  const fv = vid ? PROG_ACTIVE_PROGRAM.vehicles[vid] : null;
  if (fv && fv.status !== 'EXPENDED' && fv.status !== 'RECOVERED') m.vehicleId = vid;
  _missionBandScrub = (idx == null ? null : +idx);
  _missionBandOpenEvent(id, idx);
}

// Resolve the currently "selected" event for the left panel's state-as-of display:
// prefers an expanded EVENTS-panel card (authored m.log entry), falling back to the
// band-view scrub position. Returns the EXPANDED-log entry (has .snapshot) or null
// (meaning: no selection — show live/current state). Selecting the LAST event (or
// nothing) is treated as "current".
function _missionSelectedEventSnapshotEntry(m) {
  if (!m) return null;
  const exp = (m._expanded && m._expanded.length) ? m._expanded : m.log;
  if (!exp.length) return null;
  let authIdx = m.log.findIndex(e => e && e._expanded);
  let expIdx = -1;
  if (authIdx >= 0) {
    expIdx = exp.findIndex(e => e._authIdx === authIdx && !e._rep);
    if (expIdx < 0) expIdx = exp.findIndex(e => e._authIdx === authIdx);
  } else if (_missionBandScrub != null) {
    expIdx = _missionBandScrub;
  }
  if (expIdx < 0 || expIdx == null) return null;
  if (expIdx >= exp.length - 1) return null;   // last event === current/live
  return { entry: exp[expIdx], index: expIdx };
}

// Selecting a state in the band view opens the matching event card (expanded + scrolled
// into view). idx is an index into the EXPANDED log; map it back to the authored card.
function _missionBandOpenEvent(id, idx) {
  const m = _missionGet(id); if (!m) { missionRenderDetail(); return; }
  if (idx == null) { missionRenderDetail(); return; }
  const exp = (m._expanded && m._expanded.length) ? m._expanded : m.log;
  const src = exp[+idx];
  const authIdx = src && src._authIdx != null ? src._authIdx : +idx;
  m.log.forEach(e => { e._expanded = false; });
  if (m.log[authIdx]) m.log[authIdx]._expanded = true;
  missionRenderDetail();
  const tid = 'mlog-' + id + '-' + authIdx;
  setTimeout(() => {
    const el = document.getElementById(tid);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '2px solid var(--accent)'; setTimeout(() => { el.style.outline = ''; }, 1500); }
  }, 60);
}

// ── Unified create/edit (2026-07-16) ────────────────────────────────────────
// Dock types that create a PENDING DRAFT card (same _missionLogCardHTML +
// _missionEventEditFieldsHTML the edit accordion already uses) instead of an
// inline dock form. commitLabel is the button shown on the pending card;
// _MISSION_APPLY_BY_TYPE maps the resulting log entry's `.type` to the exact
// missionApply*Edit function that already knows how to read its edit-fields
// DOM and mutate the entry in place — Commit == that function, plus clearing
// the `pending` flag first so the very same code path used for later edits
// is what brings the event to life.
const _MISSION_PENDING_TYPES = {
  launch:       { commitLabel: '&#9654; Launch' },
  deploy:       { commitLabel: '&oplus; Place in Orbit' },
  separate:     { commitLabel: '&#8645; Separate' },
  dock:         { commitLabel: '&oplus; Dock' },
  expend:       { commitLabel: 'Expend Vehicle' },
  coast:        { commitLabel: '&#8987; Add Coast' },
  mnode:        { commitLabel: '&oplus; Add Vector Burn' },
  proptransfer: { commitLabel: 'Transfer Propellant' },
};
const _MISSION_APPLY_BY_TYPE = {
  LAUNCH: (id, idx) => missionApplyLaunchEdit(id, idx),
  DEPLOY: (id, idx) => missionApplyDeployEdit(id, idx),
  SEPARATE: (id, idx) => missionApplySeparateEdit(id, idx),
  DOCK: (id, idx) => missionApplyDockEdit(id, idx),
  EXPEND: (id, idx) => missionApplyExpendEdit(id, idx),
  COAST: (id, idx) => missionApplyCoastEdit(id, idx),
  MNODE: (id, idx) => missionApplyMnodeEdit(id, idx),
  TRANSFER_PROPELLANT: (id, idx) => missionApplyPropTransferEdit(id, idx),
};

// Draft defaults for a freshly-opened pending card. The draft is appended to
// the END of m.log (see missionSetAddEvt) so every "state before this event"
// lookup (_missionVehiclesBeforeEvent, _missionPreSnapStages, …) naturally
// resolves to the CURRENT live mission state — exactly like the old dock
// forms computed their defaults, with zero new plumbing.
function _missionPendingDraft(m, dockType) {
  const fv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  const activeKey = fv ? fv._originKey : null;
  const live = (typeof _missionLiveVehicles === 'function') ? _missionLiveVehicles(m) : [];
  const label = (dockType === '__none__') ? '' : (_MISSION_PENDING_TYPES[dockType] || {}).commitLabel;
  switch (dockType) {
    case 'launch':
      return { type: 'LAUNCH', pending: true, _commitLabel: label, label: m.name, fleetEntryId: null,
        payloadScIds: [...(m.payloadScIds || [])], payloadMass: 0,
        orbit: { ...m.launchOrbit }, launchOrbit: { ...m.launchOrbit } };
    case 'deploy': {
      const sc = (_scEdSC || [])[0];
      return { type: 'DEPLOY', pending: true, _commitLabel: label, label: sc ? sc.name : '', spacecraftId: sc ? sc.spacecraftId : null,
        orbit: { ...m.launchOrbit }, emptyTanks: false };
    }
    case 'separate':
      return { type: 'SEPARATE', pending: true, _commitLabel: label, activeKey, parentVehicleId: m.vehicleId, sepIndex: 1 };
    case 'dock': {
      const other = live.find(x => x.id !== m.vehicleId);
      return { type: 'DOCK', pending: true, _commitLabel: label, activeKey, targetKey: other ? other.fv._originKey : null };
    }
    case 'expend':
      return { type: 'EXPEND', pending: true, _commitLabel: label, targetKey: activeKey, vehicleLevel: true };
    case 'coast':
      return { type: 'COAST', pending: true, _commitLabel: label, days: 30, label: null };
    case 'mnode':
      return { type: 'MNODE', pending: true, _commitLabel: label, at: { kind: 'met', value_s: Math.round(m._metTotal || 0) },
        dvPro_ms: 0, dvRad_ms: 0, dvNrm_ms: 0 };
    case 'proptransfer':
      return { type: 'TRANSFER_PROPELLANT', pending: true, _commitLabel: label, activeKey, vehicleId: m.vehicleId,
        sourceIndex: 0, destIndex: 0, mass_kg: 1000 };
    default:
      return null;
  }
}

// Commit a pending draft: the SAME missionApply*Edit function every later
// edit of that entry uses (reads the edit-fields DOM, mutates the entry,
// missionRecompute + render) — clearing `pending` first so this is the exact
// path a real event follows, not a parallel one.
function missionCommitPendingEvent(id) {
  if (!_missionPendingEvent || _missionPendingEvent.missionId !== id) return;
  const m = _missionGet(id); if (!m) { _missionPendingEvent = null; return; }
  const idx = _missionPendingEvent.idx;
  const e = m.log[idx];
  if (!e) { _missionPendingEvent = null; return; }
  delete e.pending;
  _missionPendingEvent = null;
  const fn = _MISSION_APPLY_BY_TYPE[e.type];
  if (typeof fn === 'function') fn(id, idx);
  else { missionRecompute(m); missionRenderDetail(); }
}

// Cancel a pending draft: splice it back out — m.log is byte-identical to
// before the draft was opened (no missionRecompute call at all, so no undo
// step is captured — cancel costs exactly zero undo entries).
function missionCancelPendingEvent(id) {
  const pend = _missionPendingEvent;
  _missionPendingEvent = null;
  _missionAddEvt = null;
  if (!pend || pend.missionId !== id) { missionRenderDetail(); return; }
  const m = _missionGet(id);
  if (m && m.log[pend.idx] && m.log[pend.idx].pending) m.log.splice(pend.idx, 1);
  missionRenderDetail();
}

// ── Band view SVG renderer ─────────────────────────────────────────────────
function missionSetAddEvt(id, type) {
  // Starting/closing any dock interaction discards whatever draft was open
  // (rule: only one pending event at a time; switching types replaces it).
  if (_missionPendingEvent) missionCancelPendingEvent(_missionPendingEvent.missionId);
  _missionAddEvt = (type === _missionAddEvt) ? null : type;
  _missionAddMv = { from: null, to: null, steps: [] };   // fresh maneuver step draft each open
  _missionXferDest = null;                                // fresh prop-transfer destination each open
  if (_missionAddEvt === 'maneuver') {
    // MISSION_MODEL_V2 §12 U3: switch to the Node map view for drawing
    // maneuvers via the real view switch (missionSetView), not a promotion.
    if (typeof missionSetView === 'function') missionSetView(id, 'nodemap');
    else _missionViewMode = 'nodemap';
    _missionBridgeMode = true;           // auto-enter Draw Maneuver mode
    _missionBridgeFrom = null;
  } else {
    _missionBridgeMode = false;
  }
  if (_missionAddEvt && _MISSION_PENDING_TYPES[_missionAddEvt]) {
    const m = _missionGet(id);
    const draft = m ? _missionPendingDraft(m, _missionAddEvt) : null;
    if (draft) {
      m.log.push(draft);
      const idx = m.log.length - 1;
      m.log[idx]._expanded = true;
      _missionPendingEvent = { missionId: id, idx };
    }
  }
  missionRenderDetail();
}

// Inline event-loop (repetition) form — replaces modal-mission-group. Takes over
// the Add Event dock slot while a range is being configured (created via the
// ⊞ Loop range-pick, or by clicking an existing loop's label to edit it).
function _missionGroupFormHTML(m) {
  const p = _missionGroupPending;
  const g = (p.gid && m.groups && m.groups[p.gid]) || {};
  const n = p.end - p.start + 1;
  return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
      <button class="act-btn" style="padding:3px 8px;font-size:10px;background:var(--accent);color:#000;" onclick="missionGroupCancel()">✕ Close</button>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);letter-spacing:.1em;">EVENT LOOP</span>
    </div>
    <div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-bottom:10px;">${n} event${n!==1?'s':''} — repeated as one block during the simulation.</div>
    <label class="cfg-label">Loop name</label>
    <input id="mgroup-name" class="mcc-field-input" style="width:100%;margin-bottom:10px;" value="${(g.name||'Loop').replace(/"/g,'&quot;')}" maxlength="40" onkeydown="if(event.key==='Enter')missionGroupSave();if(event.key==='Escape')missionGroupCancel()">
    <label class="cfg-label">Repeat (&times;)</label>
    <input id="mgroup-rep" type="number" class="field" min="1" max="99" value="${g.repeat||2}" style="width:90px;margin-bottom:12px;" onkeydown="if(event.key==='Enter')missionGroupSave();if(event.key==='Escape')missionGroupCancel()">
    <div style="display:flex;justify-content:flex-end;gap:8px;">
      <button class="act-btn" onclick="missionGroupCancel()">Cancel</button>
      <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;" onclick="missionGroupSave()">${p.gid?'Save':'Create Loop'}</button>
    </div>`;
}
function _missionAddEventHTML(m) {
  const id = m.missionId;
  if (typeof _missionGroupPending !== 'undefined' && _missionGroupPending) return _missionGroupFormHTML(m);
  if (_missionAddEvt == null) {
    return `<button class="act-btn mcc-addevt-btn" style="width:100%;background:var(--accent);color:#000;font-weight:700;padding:11px;font-size:12px;letter-spacing:.08em;" onclick="missionSetAddEvt('${id}','__menu__')">＋ ADD EVENT</button>`;
  }
  const types = [['launch','Launch'],['deploy','Place in Orbit'],['maneuver','Maneuver'],['mnode','Vector Burn'],['lowthrust','Low-Thrust'],['coast','Coast'],['separate','Separate'],['dock','Dock'],['expend','Expend'],['rendezvous','Rendezvous'],['proptransfer','Prop Transfer'],['crewtransfer','Crew Transfer'],['reenter','Reenter'],['recover','Recover']];
  const typeBtns = types.map(([t,label]) =>
    `<button class="act-btn" style="padding:3px 8px;font-size:10px;${_missionAddEvt===t?'background:var(--accent);color:#000;':''}" onclick="missionSetAddEvt('${id}','${t}')">${label}</button>`
  ).join('');
  const header = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
      <button class="act-btn" style="padding:3px 8px;font-size:10px;background:var(--accent);color:#000;" onclick="missionSetAddEvt('${id}',null)">✕ Close</button>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);letter-spacing:.1em;">ADD EVENT</span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">${typeBtns}</div>`;
  const live = (typeof _missionLiveVehicles === 'function') ? _missionLiveVehicles(m) : [];
  const selectable = live.filter(x => x.fv.status !== 'EXPENDED' && x.fv.status !== 'RECOVERED');
  let vehSel = '';
  if (selectable.length > 1) {
    const opts = selectable.map(x => `<option value="${x.id}"${x.id===m.vehicleId?' selected':''}>${_missionVehicleDisplayName(x.fv)}</option>`).join('');
    vehSel = `<div style="margin-bottom:8px;"><label class="cfg-label">Active Vehicle</label>
      <select class="mcc-field-select" onchange="missionSetActiveVehicle('${id}',this.value)">${opts}</select></div>`;
  }
  let form = '';
  const fv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  if (_missionAddEvt === '__menu__') {
    form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// pick an event type above</div>`;
  } else if (_MISSION_PENDING_TYPES[_missionAddEvt]) {
    // Unified create/edit (2026-07-16): this type creates a PENDING DRAFT card
    // in the events list (same _missionLogCardHTML/_missionEventEditFieldsHTML
    // an existing event's accordion uses) instead of a dock form — see
    // missionSetAddEvt/_missionPendingDraft above. There is nothing to show here.
    form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// editing the new event above, in the events list</div>`;
  } else if (_missionAddEvt === 'burn') {
    form = _missionBurnSectionHTML(m);
  } else if (_missionAddEvt === 'lowthrust') {
    const stage = fv && fv.stages.length ? fv.stages[fv.stages.length - 1] : null;
    const readiness = (typeof ltReadinessCheck === 'function') ? ltReadinessCheck(stage) : { ok: false, message: 'n/a' };
    form = `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:6px;">// months-long electric-propulsion burn — priced instantly (est.), integrate for real via "Compute trajectory" on the card</div>
      ${!readiness.ok ? `<div style="font-family:var(--mono);font-size:10px;color:var(--warn);margin-bottom:8px;">⚠ ${readiness.message}</div>` : ''}
      <label class="cfg-label">Duration</label>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <input type="number" id="addev-lt-dur-${id}" class="field" value="30" style="width:100px;">
        <select id="addev-lt-dur-unit-${id}" class="mcc-field-select" style="width:90px;">
          <option value="d" selected>days</option><option value="h">hours</option><option value="min">min</option><option value="s">sec</option>
        </select>
      </div>
      <label class="cfg-label">Steering Law</label>
      <select id="addev-lt-law-${id}" class="mcc-field-select" style="margin-bottom:8px;">
        <option value="prograde" selected>Prograde (raise)</option>
        <option value="retrograde">Retrograde (lower)</option>
      </select>
      <label class="cfg-label">Throttle</label>
      <input type="number" id="addev-lt-throttle-${id}" class="field" min="0" max="1" step="0.05" value="1" style="width:80px;margin-bottom:10px;">
      <button class="act-btn" style="width:100%;background:var(--accent);color:#000;font-weight:600;" onclick="missionExecLowThrust('${id}')">▶ Add Low-Thrust Burn</button>`;
  } else if (_missionAddEvt === 'maneuver') {
    const nodes = _missionNmNodes();
    const o = nodes.map(n=>`<option value="${n.id}">${n.label}${n.sub?' ('+n.sub+')':''}</option>`).join('');
    const addevToId = 'addev-mvt-' + id;
    form = `<label class="cfg-label">From</label><select id="addev-mvf-${id}" class="mcc-field-select" style="margin-bottom:6px;" onchange="missionMvRefreshSteps('${id}')">${o}</select>
      <label class="cfg-label">To</label><select id="${addevToId}" class="mcc-field-select" style="margin-bottom:6px;" onchange="missionMvRefreshSteps('${id}');progPorkRefreshAddEvBtn('${id}')">${o}</select>
      <div id="pork-addev-btn-${id}" style="margin-bottom:6px;">${(typeof progPorkButtonHTML === 'function') ? progPorkButtonHTML(id, -1, document.getElementById(addevToId) ? document.getElementById(addevToId).value : (nodes[0] && nodes[0].id)) : ''}</div>
      <div id="mv-steps-${id}">${_missionMvBuilderHTML(id, 'add')}</div>
      <button class="act-btn" style="width:100%;margin-top:6px;" onclick="missionExecManeuver('${id}',document.getElementById('addev-mvf-${id}').value,document.getElementById('addev-mvt-${id}').value)">Add Maneuver</button>
      <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:5px;">// pick From/To (or draw a bridge on the Node Map); the steps above define how the ΔV is delivered</div>`;
  } else if (_missionAddEvt === 'rendezvous') {
    const others = live.filter(x => x.id !== m.vehicleId);
    if (others.length) {
      const o = others.map(x => `<option value="${x.id}">${_missionVehicleDisplayName(x.fv)}</option>`).join('');
      form = `<select id="addev-rend-${id}" class="mcc-field-select" style="margin-bottom:6px;">${o}</select>
        <button class="act-btn" style="width:100%;" onclick="missionExecRendezvous('${id}',document.getElementById('addev-rend-${id}').value)">Rendezvous</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// need another live vehicle</div>`;
  } else if (_missionAddEvt === 'crewtransfer') {
    if (fv && fv.stages.length >= 2) {
      const so = _missionStageOptions(fv, s => `${s.crewAboard || 0} crew`);
      form = `<label class="cfg-label">Source Stage</label><select id="xfer-csrc-${id}" class="mcc-field-select" style="margin-bottom:6px;">${so}</select>
        <label class="cfg-label">Destination Stage</label><select id="xfer-cdst-${id}" class="mcc-field-select" style="margin-bottom:6px;">${so}</select>
        <label class="cfg-label">Crew</label><input type="number" id="xfer-ccount-${id}" class="field" value="1" style="width:100%;margin-bottom:6px;">
        <button class="act-btn" style="width:100%;" onclick="missionExecCrewTransfer('${id}')">Transfer Crew</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// dock first — transfer needs ≥2 stages</div>`;
  } else if (_missionAddEvt === 'reenter') {
    form = `<button class="act-btn" style="width:100%;" onclick="missionExecReenter('${id}')">Reenter (land on Earth)</button>
      <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:5px;">// zero-ΔV; deorbit burn should precede this</div>`;
  } else if (_missionAddEvt === 'recover') {
    if (live.length) {
      const o = live.map(x => `<option value="${x.id}">${_missionVehicleDisplayName(x.fv)}${x.fv.status==='RECOVERED'?' (recovered)':x.fv.status==='EXPENDED'?' (expended)':''}</option>`).join('');
      form = `<select id="addev-rec-${id}" class="mcc-field-select" style="margin-bottom:6px;">${o}</select>
        <button class="act-btn" style="width:100%;" onclick="missionExecRecover('${id}',document.getElementById('addev-rec-${id}').value)">Recover</button>`;
    } else form = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">// no vehicles yet</div>`;
  }
  // forms that already have their own vehicle dropdown don't need the global Active Vehicle selector
  const ownsVehiclePicker = ['recover'].includes(_missionAddEvt);
  return `${header}${(_missionAddEvt!=='__menu__'&&_missionAddEvt!=='burn'&&!ownsVehiclePicker)?vehSel:''}${form}`;
}

// Solve a free-return trajectory from the active vehicle's Earth orbit and
// PREFILL the pending MNODE card's Vector Burn fields (edit-mnode-* — the
// same ids the MNODE edit-fields form uses for both creating the pending
// draft AND editing a committed MNODE; never auto-pushes — Commit authors it).
function missionSolveFreeReturn(id) {
  const m = _missionGet(id); if (!m) return;
  const msgEl = document.getElementById('edit-mnode-msg-' + id);
  const say = (t, warn) => { if (msgEl) { msgEl.textContent = t; msgEl.style.color = warn ? 'var(--warn)' : 'var(--text-dim)'; } };
  const fv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
  const os = fv && fv.orbitState;
  if (!os || os.body !== 'Earth' || os.surface || os.transit) { say('// active vehicle must be in an Earth orbit', true); return; }
  if (typeof physFreeReturnSolve !== 'function') { say('// physics module unavailable', true); return; }
  const alt = ((os.perigee ?? 185) + (os.apogee ?? os.perigee ?? 185)) / 2;
  const metEl = document.getElementById('edit-mnode-met-' + id);
  const tDep = metEl ? Math.max(0, parseFloat(metEl.value) || 0) : 0;
  let sol = null; // R1: calibration overrides retired — real ephemeris rails
  // R3: solve in the active vehicle's authored orbit plane
  try { sol = physFreeReturnSolve(alt, tDep, {}, os.inclination ?? 28.5); } catch (err) { sol = null; }
  if (!sol || !sol.converged) {
    say(`// no free return found from ${Math.round(alt)} km at this departure — try a different MET`, true);
    return;
  }
  if (metEl) metEl.value = Math.round(sol.met_s);
  const proEl = document.getElementById('edit-mnode-pro-' + id);
  if (proEl) proEl.value = Math.round(sol.dv_ms);
  const radEl = document.getElementById('edit-mnode-rad-' + id);
  if (radEl) radEl.value = 0;
  say(`// free return solved: ${Math.round(sol.dv_ms).toLocaleString()} m/s prograde at MET ${Math.round(sol.met_s).toLocaleString()} s — return perigee ${Math.round(sol.periAlt_km)} km (hit Add to author it)`);
}

// Apply edits from the MNODE event's inline edit section — standard mutation path
// (update log entry → missionRecompute → render).
function missionApplyMnodeEdit(id, idx) {
  const m = _missionGet(id); if (!m || !m.log[idx] || !_evIsManualBurn(m.log[idx])) return;
  const e = m.log[idx];
  if (typeof _missionApplyClearPending === 'function') _missionApplyClearPending(id, e);
  const gv = f => { const el = document.getElementById(`edit-mnode-${f}-${id}`); return el ? parseFloat(el.value) || 0 : 0; };
  e.at = { kind: 'met', value_s: Math.max(0, gv('met')) };
  e.dvPro_ms = gv('pro'); e.dvRad_ms = gv('rad'); e.dvNrm_ms = gv('nrm');
  missionRecompute(m);
  missionRenderDetail();
}

// Round 2 item 2: precision +/- nudge buttons on the MNODE event card — write
// directly through the standard log-entry -> missionRecompute -> render
// mutation path (same discipline as missionApplyMnodeEdit), no modal needed.
// Step: 10 m/s (dv axes) / 60 s (time), shift-click for the fine step
// (1 m/s / 10 s).
function missionMnodeNudge(id, idx, field, sign, ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  const m = _missionGet(id); if (!m || !m.log[idx] || m.log[idx].type !== 'MNODE') return;
  const e = m.log[idx];
  // Solved MNODEs (regression restore, R6.2.1): only the departure MET is
  // author-nudgeable — dv components are solver-owned display (refreshed
  // from the physics leg every recompute via progNmComputeEdgeDv), nudging
  // them here would be silently overwritten and misleading.
  if (!_evIsManualBurn(e) && field !== 'met') return;
  const fine = !!(ev && ev.shiftKey);
  if (field === 'met') {
    const step = fine ? 10 : 60;
    const cur = (e.at && e.at.value_s) || 0;
    e.at = { kind: 'met', value_s: Math.max(0, cur + sign * step) };
  } else {
    const step = fine ? 1 : 10;
    const key = field === 'pro' ? 'dvPro_ms' : field === 'rad' ? 'dvRad_ms' : 'dvNrm_ms';
    e[key] = (e[key] || 0) + sign * step;
  }
  missionRecompute(m);
  missionRenderDetail();
}

// R6.2' Phase B: re-solve a detached (manual) MNODE back to its target — a
// pure MODE-FLIP ('manual' -> 'solved'), since the unified schema keeps
// `target` around on a manual node specifically so this doesn't need a
// stashed copy of anything. ΔV accounting flips back to progNmComputeEdgeDv
// via _evIsSolvedManeuver on the very next recompute — dvPro/rad/nrm_ms are
// left as-is (display-only once solved; refreshed from the leg's dvVec by
// the same recompute) and dvOverride (if the user had one) is untouched.
function missionMnodeResolveToTarget(id, idx) {
  const m = _missionGet(id); if (!m || !m.log[idx]) return;
  const e = m.log[idx];
  if (e.type !== 'MNODE') return;
  if (!e.target || !e.target.fromNode || !e.target.toNode) return;
  e.mode = 'solved';
  // R6.2' Phase B step 5: re-solving hands the departure state back to the
  // solver — drop the detach-time burnState stamp so a later detach re-
  // captures the (possibly different) freshly-solved state, not a stale one.
  delete e.burnState;
  if (typeof _trajGizmo !== 'undefined' && _trajGizmo && _trajGizmo.missionId === id && _trajGizmo.authIdx === idx) {
    if (typeof _trajGizmoClose === 'function') _trajGizmoClose();
  }
  missionRecompute(m);
  missionRenderDetail();
}

// Round 2 item 3(b): persist the explicit CA-target dropdown selection onto
// the log entry (authored state on the event, same mutation discipline).
function missionApplyMnodeCaTarget(id, idx) {
  const m = _missionGet(id); if (!m || !m.log[idx] || m.log[idx].type !== 'MNODE') return;
  const e = m.log[idx];
  const el = document.getElementById(`edit-mnode-catarget-${id}`);
  e.caTarget = el ? el.value : 'auto';
  missionRecompute(m);
  missionRenderDetail();
}

// Resolve var(--x) tokens in a serialized SVG to concrete computed values, so
// the rasterized image keeps the theme's colours AND fonts (CSS variables and
// the stylesheet don't apply to a detached <img> SVG).
function _missionResolveCssVars(xml) {
  const cs = getComputedStyle(document.documentElement);
  return xml.replace(/var\(--([a-z0-9-]+)\)/gi, (full, name) => {
    const val = cs.getPropertyValue('--' + name).trim();
    return val || full;
  });
}

// Save the current mission view (band OR node map — whichever SVG is showing)
// as a PNG. v1: rasterize the on-screen SVG at 2× with var() resolved.
function missionExportPNG(id) {
  const svg = document.querySelector('.mcc-view-area svg');
  if (!svg) { if (typeof showAlert === 'function') showAlert('No view to export yet — run a launch first.', 'Export PNG'); return; }
  const vb = svg.viewBox && svg.viewBox.baseVal;
  const w = (vb && vb.width)  ? vb.width  : (svg.clientWidth  || 900);
  const h = (vb && vb.height) ? vb.height : (svg.clientHeight || 500);
  const clone = svg.cloneNode(true);
  clone.setAttribute('width',  w);
  clone.setAttribute('height', h);
  const xml = _missionResolveCssVars(new XMLSerializer().serializeToString(clone));
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  const SCALE = 2;
  // band view: build a vehicle colour KEY to draw under the chart
  const m0 = _missionGet(id);
  let legend = [];
  if (_missionViewMode === 'band' && m0) {
    try { legend = (_missionBandModel(m0).lanes || []).map(L => ({ color: L.color, name: L.name + (L.expended ? ' (expended)' : '') })); } catch (_) {}
  }
  const csv = getComputedStyle(document.documentElement);
  const panelCol = csv.getPropertyValue('--panel').trim() || '#2e2c2d';
  const dimCol = csv.getPropertyValue('--text-dim').trim() || '#a7a6a4';
  const brightCol = csv.getPropertyValue('--text-bright').trim() || '#ffffff';
  img.onload = () => {
    // lay out the legend (unscaled px): swatch + label items wrapping across width
    const padX = 14, rowH = 18, sw = 11, fontPx = 11;
    const placed = []; let legendH = 0;
    if (legend.length) {
      let x = padX, y = 8;
      for (const it of legend) {
        const iw = sw + 5 + it.name.length * fontPx * 0.6 + 16;
        if (x + iw > w - padX && x > padX) { x = padX; y += rowH; }
        placed.push({ color: it.color, name: it.name, x, y });
        x += iw;
      }
      legendH = y + rowH + 6;
    }
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(w * SCALE);
    canvas.height = Math.round((h + legendH) * SCALE);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = panelCol;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, Math.round(w * SCALE), Math.round(h * SCALE));
    URL.revokeObjectURL(url);
    if (placed.length) {
      ctx.save();
      ctx.scale(SCALE, SCALE);
      ctx.strokeStyle = dimCol; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.moveTo(padX, h + 2); ctx.lineTo(w - padX, h + 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = fontPx + "px 'JetBrains Mono', monospace";
      ctx.textBaseline = 'middle';
      for (const it of placed) {
        const yy = h + it.y;
        ctx.fillStyle = it.color; ctx.fillRect(it.x, yy + (rowH - sw) / 2 - 1, sw, sw);
        ctx.fillStyle = brightCol; ctx.fillText(it.name, it.x + sw + 5, yy + rowH / 2);
      }
      ctx.restore();
    }
    canvas.toBlob(b => {
      if (!b) return;
      const m = _missionGet(id);
      const base = (m && m.name ? m.name : 'mission').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'mission';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = base + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); if (typeof showAlert === 'function') showAlert('PNG export failed — the SVG could not be rasterized.', 'Export PNG'); };
  img.src = url;
}

function _missionBandViewHTML(m) {
  const model = _missionBandModel(m);
  const id = m.missionId;

  if (model.count === 0) {
    return '<div style="display:flex;align-items:center;justify-content:center;height:200px;font-family:var(--mono);font-size:11px;color:var(--text-dim);">// No events yet — execute a LAUNCH to populate the band view.</div>';
  }

  const spacing = _missionBandSpacing;
  const leftPad = 150, rightPad = 50, topPad = 18, botPad = 20, bandH = 112;
  const zoneCount = Math.max(model.zones.length, 1);
  const plotH = zoneCount * bandH;
  const totalH = topPad + plotH + botPad;
  const totalW = leftPad + Math.max(model.colCount - 1, 0) * spacing + rightPad + 30;
  const X = c => leftPad + c * spacing;
  // zone slot 0 = lowest energy → drawn at the BOTTOM; higher zones stack upward
  const zoneCenterY = slot => topPad + (zoneCount - 1 - slot) * bandH + bandH / 2;
  const Y = pt => zoneCenterY(model.zoneSlot[pt.zoneKey] ?? 0) + (pt.yOff || 0);
  const fmtAlt = a => a >= 100000 ? '∞' : (a >= 1000 ? Math.round(a / 1000) + 'k' : Math.round(a)) + '';

  const scrub = _missionBandScrub == null ? (model.count - 1) : _missionBandScrub;

  // ── body-zone backdrops: group consecutive zone slots by body (earth/lunar/interp)
  //    into one faint tinted region + boundary + label, so the chart reads as a place
  //    (not just abstract altitude bands). Decoration only — painted FIRST (behind
  //    everything else) and never affects layout; zones with no bandGroup (deep-space
  //    coast) are left untinted, and a body only appears if this mission visited it. ──
  let bodyZoneHTML = '';
  {
    const groups = [];
    for (let i = model.zones.length - 1; i >= 0; i--) {   // top slot → bottom slot (screen order)
      const z = model.zones[i];
      const g = groups[groups.length - 1];
      if (g && g.bodyGroup === z.bodyGroup) g.zones.push(z);
      else groups.push({ bodyGroup: z.bodyGroup, zones: [z] });
    }
    for (const g of groups) {
      if (!g.bodyGroup) continue;
      const topSlot = g.zones[0].slot, botSlot = g.zones[g.zones.length - 1].slot;
      const yTop = topPad + (zoneCount - 1 - topSlot) * bandH;
      const yBot = topPad + (zoneCount - botSlot) * bandH;
      const color = _MISSION_BODY_ZONE_COLOR[g.bodyGroup], tint = _MISSION_BODY_ZONE_TINT[g.bodyGroup], label = _MISSION_BODY_ZONE_LABEL[g.bodyGroup];
      bodyZoneHTML += `<rect x="0" y="${yTop}" width="${totalW}" height="${yBot - yTop}" fill="${tint}"/>`;
      bodyZoneHTML += `<line x1="0" y1="${yTop}" x2="${totalW}" y2="${yTop}" stroke="${color}" stroke-opacity="0.3" stroke-width="1"/>`;
      bodyZoneHTML += `<text x="8" y="${yTop + 12}" font-family="var(--mono)" font-size="8px" font-weight="700" letter-spacing=".12em" fill="var(--text-dim)">${label}</text>`;
      // body glyph at the zone's SURFACE band (if present) — a limb arc + horizon line so
      // "on the surface" reads as sitting ON the body, not floating between dots.
      const surfZone = g.zones.find(z => z.key === 'earth' || z.key === 'moon' || z.key.endsWith('-surf') || z.key === 'mars');
      if (surfZone) {
        const sy = topPad + (zoneCount - 1 - surfZone.slot) * bandH;
        const cy = sy + bandH - 14, gr = 9, gx = leftPad - 60;
        bodyZoneHTML += `<line x1="${leftPad}" y1="${cy}" x2="${totalW - 6}" y2="${cy}" stroke="${color}" stroke-opacity="0.25" stroke-width="1" stroke-dasharray="2 3"/>`;
        bodyZoneHTML += `<circle cx="${gx}" cy="${cy}" r="${gr}" fill="none" stroke="${color}" stroke-width="1.4" opacity="0.8"/>`;
        bodyZoneHTML += `<path d="M ${gx - gr} ${cy} A ${gr} ${gr} 0 0 1 ${gx + gr} ${cy}" fill="${color}" opacity="0.18"/>`;
      }
    }
  }

  // ── zone bands: labelled horizontal regions (Earth at the bottom → higher orbits up) ──
  let gridHTML = '';
  model.zones.forEach(z => {
    const yTop = topPad + (zoneCount - 1 - z.slot) * bandH;
    if (z.slot % 2 === 1) gridHTML += `<rect x="${leftPad}" y="${yTop}" width="${totalW - leftPad - 6}" height="${bandH}" fill="var(--text-bright)" opacity="0.02"/>`;
    // clear dotted boundary between zones (so LEO→GTO etc. reads at a glance)
    gridHTML += `<line x1="${leftPad}" y1="${yTop}" x2="${totalW - 6}" y2="${yTop}" stroke="var(--border-bright)" stroke-opacity="0.85" stroke-dasharray="1 5" stroke-linecap="round" stroke-width="1.4"/>`;
    gridHTML += `<text x="${leftPad - 10}" y="${yTop + 13}" text-anchor="end" font-family="var(--mono)" font-size="9px" letter-spacing=".05em" fill="var(--text-dim)">${z.label}</text>`;
  });
  // close the bottom of the lowest band so every zone is fully bounded
  gridHTML += `<line x1="${leftPad}" y1="${topPad + plotH}" x2="${totalW - 6}" y2="${topPad + plotH}" stroke="var(--border-bright)" stroke-opacity="0.85" stroke-dasharray="1 5" stroke-linecap="round" stroke-width="1.4"/>`;
  // column gridlines (faint)
  for (let c = 0; c < model.colCount; c++) {
    gridHTML += `<line x1="${X(c)}" y1="${topPad}" x2="${X(c)}" y2="${topPad + plotH}" stroke="var(--border)" stroke-opacity="0.12" stroke-width="1"/>`;
  }

  const branchHTML = '';

  // ── tracks as a vehicle-node graph ──────────────────────────────────────────
  // Owners that share a vehicle (co-manifested at launch OR docked) are drawn as
  // ONE track: we collapse each owner's per-event points into per-(column,vehicle,
  // zone) NODES, then connect them by owner continuity. A track therefore forks
  // only at a SEPARATE (the owners get different vehicleIds) and merges at a DOCK.
  // Each node's representative owner = the lowest-birth owner aboard, giving the
  // "dominant / launch" colour + label (e.g. S-IVB while attached, then CSM).
  // node key includes the fractional x-offset so a mid-coast event gets its OWN node
  // (positioned between the maneuver and the next event) rather than collapsing into it.
  const keyP = p => p.col + '+' + (p.xFrac || 0) + '|' + p.vehicleId + '|' + p.zoneKey;
  const nodes = new Map();
  for (const lane of model.lanes) {
    for (const p of lane.points) {
      const k = keyP(p);
      let n = nodes.get(k);
      if (!n) { n = { x: X(p.col + (p.xFrac || 0)), y: Y(p), col: p.col, frac: p.xFrac || 0, vid: p.vehicleId, alt: p.alt, status: p.status, index: p.index, ascent: !!p._ascent, rep: lane, hasIn: false, hasOut: false, zoneKey: p.zoneKey, bodyGroup: _missionBodyGroupOf(p.zoneKey) }; nodes.set(k, n); }
      else if (lane.birth < n.rep.birth) { n.rep = lane; n.y = Y(p); }
    }
  }
  // edges (deduped per node-pair; representative = lowest-birth owner traversing it)
  const edges = new Map();
  for (const lane of model.lanes) {
    for (let i = 0; i < lane.points.length - 1; i++) {
      const a = keyP(lane.points[i]), b = keyP(lane.points[i + 1]);
      if (a === b) continue;
      let e = edges.get(a + '>' + b);
      if (!e) { e = { a, b, rep: lane }; edges.set(a + '>' + b, e); }
      else if (lane.birth < e.rep.birth) e.rep = lane;
      const A = nodes.get(a), B = nodes.get(b); if (A) A.hasOut = true; if (B) B.hasIn = true;
    }
  }
  // a node labels its dominant owner only where that owner STARTS — i.e. it has no
  // incoming edge, or its rep differs from every predecessor (a SEPARATE fork).
  for (const e of edges.values()) { const A = nodes.get(e.a), B = nodes.get(e.b); if (A && B && A.rep === B.rep) B._repIn = true; }
  const clip = s => s.length > 16 ? s.slice(0, 15) + '…' : s;
  // compact duration label for a transfer leg, e.g. "≈5d" / "≈3h" — decoration only.
  const fmtLegDur = sec => {
    if (sec == null || !isFinite(sec) || sec <= 0) return '';
    const d = sec / 86400;
    if (d >= 1) return '≈' + (d >= 10 ? Math.round(d) : Math.round(d * 10) / 10) + 'd';
    const h = sec / 3600;
    if (h >= 1) return '≈' + Math.round(h) + 'h';
    return '≈' + Math.round(sec / 60) + 'm';
  };
  let lanesHTML = '';
  // edges (active vehicle gets the translucent accent underlay)
  for (const e of edges.values()) {
    const A = nodes.get(e.a), B = nodes.get(e.b);
    if (!A || !B) continue;
    // a leg that crosses body zones (or connects a transit/corridor band) reads as a
    // TRANSFER — dashed, with a small mid-segment duration label — vs. a same-zone move.
    const crossesZone = A.bodyGroup && B.bodyGroup && A.bodyGroup !== B.bodyGroup;
    const isTransit = A.zoneKey === 'transit' || B.zoneKey === 'transit' || A.zoneKey === 'nrho' || B.zoneKey === 'nrho';
    const isLeg = crossesZone || (isTransit && A.zoneKey !== B.zoneKey);
    if (A.vid === m.vehicleId || B.vid === m.vehicleId)
      lanesHTML += `<polyline points="${A.x},${A.y} ${B.x},${B.y}" fill="none" stroke="var(--accent)" stroke-width="7" opacity="0.16" stroke-linejoin="round"/>`;
    lanesHTML += `<polyline points="${A.x},${A.y} ${B.x},${B.y}" fill="none" stroke="${e.rep.color}" stroke-width="2.5" opacity="${e.rep.expended ? '0.4' : '1'}" stroke-linejoin="round"${isLeg ? ' stroke-dasharray="5 3"' : ''}/>`;
    if (isLeg) {
      const ev = model.events[B.index];
      const durLabel = fmtLegDur(ev && ev.durationUsed);
      if (durLabel) {
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2 - 6;
        lanesHTML += `<text x="${mx}" y="${my}" text-anchor="middle" font-family="var(--mono)" font-size="7px" fill="var(--text-dim)" style="pointer-events:none">${durLabel}</text>`;
      }
    }
  }
  // lone nodes (a track with a single event) → short dash
  for (const n of nodes.values()) {
    if (!n.hasIn && !n.hasOut)
      lanesHTML += `<line x1="${n.x - 8}" y1="${n.y}" x2="${n.x + 8}" y2="${n.y}" stroke="${n.rep.color}" stroke-width="2.5" opacity="${n.rep.expended ? '0.4' : '1'}"/>`;
  }
  // node dots + altitude labels (one per vehicle per column)
  for (const n of nodes.values()) {
    const ev = model.events[n.index];
    const dead = n.status === 'EXPENDED' || n.status === 'RECOVERED';
    const rDot = n.ascent ? 3.5 : (n.frac ? 3.5 : 5);
    const metTitle = ev && ev.met != null ? ` [${_metFmt(ev.met)}]` : '';
    lanesHTML += `<circle cx="${n.x}" cy="${n.y}" r="${rDot}" fill="${n.frac ? 'var(--input)' : n.rep.color}" stroke="${n.rep.color}" stroke-width="${n.frac ? 2 : 1}" opacity="${dead ? '0.5' : '1'}" style="cursor:pointer" onclick="missionBandPickVehicle('${id}','${n.vid}',${n.index})"><title>${n.ascent ? 'Liftoff from Earth' : (ev ? (n.frac ? 'mid-coast: ' : '') + ev.label : '')}${n.ascent ? '' : ' — ' + Math.round(n.alt).toLocaleString() + ' km'} — ${n.rep.name}${metTitle}</title></circle>`;
    if (!n.ascent) lanesHTML += `<text x="${n.x}" y="${n.y - 8}" text-anchor="middle" font-family="var(--mono)" font-size="7px" fill="var(--text-dim)" style="pointer-events:none">${fmtAlt(n.alt)}</text>`;
  }
  // start labels (nodes with no incoming edge) + "+" affordance at live track ends
  for (const n of nodes.values()) {
    const isActive = n.vid === m.vehicleId;
    const dead = n.status === 'EXPENDED' || n.status === 'RECOVERED';
    if (!n._repIn)
      lanesHTML += `<text x="${n.x - 7}" y="${n.y - 7}" text-anchor="end" font-family="var(--mono)" font-size="8px" font-weight="${isActive ? '700' : '400'}" fill="${n.rep.expended ? 'var(--text-dim)' : (isActive ? 'var(--accent3)' : n.rep.color)}" style="cursor:pointer" onclick="missionBandPickVehicle('${id}','${n.vid}',null)">${(isActive ? '● ' : '') + clip(n.rep.name)}</text>`;
    if (!n.hasOut && n.rep.live && !dead && n.col === model.colCount - 1) {
      const px = n.x + 22;
      lanesHTML += `<circle cx="${px}" cy="${n.y}" r="10" fill="var(--input)" stroke="${n.rep.color}" stroke-width="1.5" style="cursor:pointer" onclick="missionSetActiveVehicle('${id}','${n.vid}');missionSetAddEvt('${id}','__menu__')"><title>Add event to ${n.rep.name}</title></circle>`;
      lanesHTML += `<text x="${px}" y="${n.y + 4}" text-anchor="middle" font-family="var(--mono)" font-size="13" font-weight="bold" fill="${n.rep.color}" style="pointer-events:none">+</text>`;
    }
  }

  // scrubber (vertical line at the scrubbed event's column)
  const scrubCol = model.events[scrub] ? model.events[scrub].col : 0;
  const scrubX = X(scrubCol);
  let scrubberHTML = `<line x1="${scrubX}" y1="${topPad - 2}" x2="${scrubX}" y2="${topPad + plotH}" stroke="var(--accent)" stroke-width="1.5" opacity="0.75"/>`;
  const scrubEv = model.events[scrub];
  const scrubMet = (scrubEv && scrubEv.met != null) ? ` (${_metFmt(scrubEv.met)})` : '';
  scrubberHTML += `<text x="${scrubX}" y="${topPad - 9}" text-anchor="middle" font-family="var(--mono)" font-size="8px" fill="var(--accent)">${scrubEv ? scrubEv.label + scrubMet : ''}</text>`;

  // controls (spacing) + legend
  let legendHTML = '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:8px 10px 6px;">';
  legendHTML += `<span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:9px;color:var(--text-dim);">spacing
    <button class="act-btn" style="padding:0 7px;" onclick="missionBandSpacing('${id}',-1)">−</button>
    <button class="act-btn" style="padding:0 7px;" onclick="missionBandSpacing('${id}',1)">+</button></span>`;
  legendHTML += `<span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:9px;color:var(--text-dim);">zoom
    <button class="act-btn" style="padding:0 7px;" onclick="missionBandZoom('${id}',-1)">−</button>
    <button class="act-btn" style="padding:0 7px;" onclick="missionBandZoom('${id}',0)" title="Reset zoom">${Math.round(_missionBandZoom * 100)}%</button>
    <button class="act-btn" style="padding:0 7px;" onclick="missionBandZoom('${id}',1)">+</button></span>`;
  for (const lane of model.lanes) {
    const dimmed = lane.expended;
    const labelJs = lane.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    legendHTML += `<span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:9px;color:${dimmed ? 'var(--text-dim)' : 'var(--text-bright)'};opacity:${dimmed ? '0.5' : '1'}"><input type="color" value="${lane.color}" title="Lane color" style="width:12px;height:12px;padding:0;border:none;background:none;cursor:pointer;border-radius:2px;" onchange="missionSetLaneColor('${id}','${labelJs}',this.value)">${lane.name}${dimmed ? ' (expended)' : ''}</span>`;
  }
  legendHTML += '</div>';

  const zf = _missionBandZoom;
  const svgHTML = `<svg viewBox="0 0 ${totalW} ${totalH}" width="${Math.round(totalW * zf)}" height="${Math.round(totalH * zf)}" style="background:var(--panel);display:block;">${bodyZoneHTML}${gridHTML}${branchHTML}${lanesHTML}${scrubberHTML}</svg>`;

  return `<div class="band-root">${legendHTML}<div class="band-scroll" onwheel="missionBandWheel(event,'${id}')">${svgHTML}</div></div>`;
}
