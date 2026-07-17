// ─────────────────────────────────────────────────────────────────────────────
// 5741-trajectory-scene-extract.js — Trajectory scene extraction + orbit records
//
// OWNS: the per-mission scene extractor _trajExtractMission (walks m.log into
//   dedup'd orbit records + transfer/leg descriptors the render layer draws),
//   orbit-record identity/labelling helpers (_trajOrbitKey, _trajCorridorMoon,
//   _trajOrbitLabel, _trajFrameForOrbit), maneuver owner-key resolution
//   (_trajOwnerKeysForManeuver), and the parametric ellipse geometry helper
//   (_trajEllipseGeom).
// Does NOT own: rendering, labels/LOD, camera, globes. Consumers live in the
//   other 574x modules (loaded after this file).
// Split out of 574-trajectory-view.js (behavior-preserving move). Definitions only
//   (no load-time execution); load order among 574x def-only modules is irrelevant.
// ─────────────────────────────────────────────────────────────────────────────

// ── mission content extraction ───────────────────────────────────────────
// Everything below reads the REPLAYED log (m._expanded, populated by
// missionRecompute — each entry carries e.snapshot[] of live-vehicle states
// AFTER that event, plus e.metStart / e.dvRequired / e.dvDelivered / e.fromNode
// / e.toNode for MANEUVER, e.days for COAST). Positions along orbits are NOT
// modeled — this is a geometry-true, time-schematic map, per the design brief.

// A scene-local orbit record: { key, body, a, e, r_peri, r_apo, label, colors:Set, names:Set }
// key dedupes identical orbits (rounded so float noise from repeated snapshots
// doesn't fork the same LEO into two near-identical rings).
function _trajOrbitKey(body, peri, apo) {
  return body + '|' + Math.round(peri) + '|' + Math.round(apo);
}

// Detects a transit-corridor snapshot (e.g. a TLC leg captured mid-coast: peri
// near a low parking orbit, apo near a moon's orbital radius around `body`).
// C2: corridor STATE RINGS DIE — arcs carry all transfer meaning now. This
// detector is kept only to SUPPRESS ring generation for these snapshots (see
// addOrbitRing below), not to relabel them. Tolerance generous (2%) since
// these are snapshot-of-the-moment radii, not exact apsides.
function _trajCorridorMoon(body, apo) {
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  const moons = _trajMoonsOf(body);
  for (const mo of moons) {
    if (Math.abs((apo + R) - mo.r) < mo.r * 0.02) return mo.name;
  }
  return null;
}

function _trajOrbitLabel(body, peri, apo) {
  const group = (typeof ORBIT_CATEGORIES !== 'undefined') ? ORBIT_CATEGORIES.find(g => g.planet === body) : null;
  if (group) {
    for (const cat of group.orbits) {
      if (cat.mode === 'orbit' && cat.perigee != null && Math.abs(cat.perigee - peri) < 50 && cat.apogee != null && Math.abs(cat.apogee - apo) < 50) {
        return cat.name;
      }
    }
  }
  const prefix = body === 'Earth' ? '' : (body + ' ');
  const rounded = Math.round(peri);
  return Math.abs(apo - peri) < 5 ? `${prefix}${rounded}` : `${prefix}${rounded}×${Math.round(apo)}`;
}

// Which body-frame ('Sun' for interplanetary/heliocentric legs, else a body
// name) an orbit/transit record belongs in. Renamed conceptually from "scene"
// to "frame" in C1b (there's no scene to route to any more — this only picks
// which body's world position the content is drawn around).
function _trajFrameForOrbit(o) {
  if (!o) return null;
  // Field is `o.type === 'transit'`, not a boolean `o.transit` — PROG_NM_NODES
  // (430) node specs use `type:'transit'` (see e.g. mars-transfer's orbit
  // `{type:'transit', body:'Sun', destination:'Mars'}`); fixed here (was
  // checking a field name that's never actually set on any node, so every
  // Sun-frame/translunar transit leg silently fell through to the plain
  // `o.body` branch below — for a Sun-body transit that's `'Sun'` anyway
  // (harmless), but for local-frame transits like TLC (`body:'Earth'`) it
  // was accidentally correct too; the bug only bites callers that branch on
  // this function's SPECIFIC transit-vs-plain distinction, e.g. the planet
  // calibration pass added here needing to identify Sun-frame legs reliably).
  if (o.type === 'transit' && o.body === 'Sun') return 'Sun';
  if (o.type === 'transit') return o.body || 'Earth'; // translunar etc — parent body's local frame
  if (o.escape) return o.body || 'Earth';
  return o.body || 'Earth';
}

// Walk m._expanded snapshots, building per-body-frame: orbit rings, transfer
// legs, burn markers, and surface events. Cached per mission per render call
// (cheap enough to just recompute; log length is small).
function _trajExtractMission(m) {
  const frames = {}; // bodyFrame -> { orbits: Map<key,rec>, legs: [], surface: [] }
  const frameFor = id => (frames[id] = frames[id] || { orbits: new Map(), legs: [], surface: [] });
  const log = (m && m._expanded && m._expanded.length) ? m._expanded : (m ? (m.log || []) : []);
  if (!log.length) return frames;

  const laneColorFor = (ownerKeys) => {
    if (!ownerKeys || !ownerKeys.length) return null;
    const key = ownerKeys[0];
    const label = (m._ownerLabels && m._ownerLabels[key]) || null;
    if (!label) return null;
    let idx = 0; for (let i = 0; i < label.length; i++) idx = (idx * 31 + label.charCodeAt(i)) >>> 0;
    return { color: _missionLaneColor(m, label, idx), label };
  };

  // C2 "expended vehicle" dimming: earliest EXPEND met per owner key, so an
  // orbit ring whose only owners are all-expended-by-viewTime can be dimmed
  // the same as history legs (reuses _TRAJ_HISTORY_ALPHA). Best-effort: keys
  // by originKey when present (vehicle-level EXPEND) — stage-level EXPENDs
  // don't retire the whole vehicle so are intentionally NOT tracked here.
  const expendMetByOwner = {};
  log.forEach(e => {
    if (e.type === 'EXPEND' && e.vehicleLevel && e.targetKey != null && e.metStart != null) {
      if (expendMetByOwner[e.targetKey] == null || e.metStart < expendMetByOwner[e.targetKey]) expendMetByOwner[e.targetKey] = e.metStart;
    }
  });

  const addOrbitRing = (body, peri, apo, ownerKeys, authIdx, inc, lanDeg, argp_deg) => {
    if (body == null || peri == null || apo == null) return null;
    if (_trajCorridorMoon(body, apo)) return null; // corridor state rings die (C2) — arcs carry transfer meaning now
    const frameId = body;
    const sc = frameFor(frameId);
    const key = _trajOrbitKey(body, peri, apo);
    const lane = laneColorFor(ownerKeys);
    if (!sc.orbits.has(key)) {
      sc.orbits.set(key, {
        key, body, peri, apo,
        inc: inc || 0,   // authored inclination (deg) — drawn for real since R2 (Ω,ω assumed 0)
        label: _trajOrbitLabel(body, peri, apo),
        colors: new Set(), names: new Set(),
        firstAuthIdx: authIdx != null ? authIdx : null,  // first authored event that put a vehicle in this orbit (for click-to-select)
        ownerKeys: new Set(),
      });
    }
    const rec = sc.orbits.get(key);
    // R3.2 tier 1: an orbit spec that AUTHORED Ω/ω wins outright — stamped at
    // ring creation so the R3.1 state-derived pass below (which only sets
    // rec.elements when absent) can never override it. Precedence enforced by
    // write order: authored (here) -> flight-derived (§7i pass) -> default
    // (Ω=ω=0 convention, left as rec.elements == null for _trajRingSVG).
    if (!rec.elements && lanDeg != null) {
      // §20/C1 OBLIQUITY (MATH.md §7al, site 11): inc/lanDeg here are
      // AUTHORED, i.e. EQUATOR-referenced (os.inclination/os.lan — the
      // program's authoring convention). The ring is sampled + projected in
      // the WORLD (ecliptic) frame the tilted globe and the Moon are drawn
      // in, so rotate through the ONE C1 boundary (orbitWorldElements, 385)
      // BEFORE stamping. Without this, a plane-matched parking orbit drew
      // ~23.44 deg (Earth's obliquity) off its own physics plane and off the
      // Moon — the reported "plane-match does nothing" bug, made visible once
      // O2 gave the globe a real axial tilt (site 10's rendering scope-cut in
      // §7al assumed world==equator, which O2 retired).
      const _w20 = (typeof orbitWorldElements === 'function')
        ? orbitWorldElements({ body, incDeg: inc || 0, lanDeg })
        : { incDeg: inc || 0, lanDeg };
      rec.elements = { i: _w20.incDeg * Math.PI / 180, raan: _w20.lanDeg * Math.PI / 180,
        argp: (argp_deg || 0) * Math.PI / 180, source: 'authored' };
    }
    if (lane) { rec.colors.add(lane.color); rec.names.add(lane.label); }
    if (authIdx != null && rec.firstAuthIdx == null) rec.firstAuthIdx = authIdx;
    (ownerKeys || []).forEach(k => rec.ownerKeys.add(k));
    return rec;
  };

  // Phase 4 U3: a propagated ref (e.g. nrho-nominal) has no peri/apo — keyed
  // by refId instead of the (body,peri,apo) size key. The actual loop shape
  // is resolved at RENDER time via refOrbitSamplePropagated (574's ring
  // emitter), not here — this just registers the group (owners/color/label).
  const addPropagatedRing = (body, refId, refName, ownerKeys, authIdx) => {
    if (body == null || !refId) return null;
    const sc = frameFor(body);
    const key = 'propagated:' + refId;
    const lane = laneColorFor(ownerKeys);
    if (!sc.orbits.has(key)) {
      sc.orbits.set(key, {
        key, body, kind: 'propagated', refId,
        label: refName || 'Propagated orbit',
        colors: new Set(), names: new Set(),
        firstAuthIdx: authIdx != null ? authIdx : null,
        ownerKeys: new Set(),
      });
    }
    const rec = sc.orbits.get(key);
    if (lane) { rec.colors.add(lane.color); rec.names.add(lane.label); }
    if (authIdx != null && rec.firstAuthIdx == null) rec.firstAuthIdx = authIdx;
    (ownerKeys || []).forEach(k => rec.ownerKeys.add(k));
    return rec;
  };

  // ── snapshots: every distinct orbit any vehicle occupies ─────────────────
  log.forEach(e => {
    (e.snapshot || []).forEach(v => {
      if (!v.orbit || v.orbit.surface) return;
      const o = v.orbit;
      if (o.propagated && o.refId) {
        const refEntry = (typeof refOrbitGet === 'function') ? refOrbitGet(o.refId) : null;
        addPropagatedRing(o.body || 'Moon', o.refId, refEntry ? refEntry.name : null, v.owners, e._authIdx);
        return;
      }
      const peri = o.perigee ?? o.apogee ?? 0, apo = o.apogee ?? o.perigee ?? 0;
      if (!(peri > 0) && !(apo > 0)) return; // skip degenerate/zero orbits
      addOrbitRing(o.body || 'Earth', peri, apo, v.owners, e._authIdx, o.inclination, o.lanDeg, o.argp_deg);
    });
  });

  // ── surface events: LAUNCH / (REENTER-derived) LAND ──────────────────────
  log.forEach(e => {
    if (e.type === 'LAUNCH') {
      const body = (e.orbit && e.orbit.body) || 'Earth';
      frameFor(body).surface.push({ kind: 'launch', body, label: 'Launch', met: e.metStart });
    } else if (e.type === 'REENTER' || e.type === 'RECOVER') {
      const body = (e.orbitAfter && e.orbitAfter.body) || 'Earth';
      frameFor(body).surface.push({ kind: 'land', body, label: e.type === 'RECOVER' ? 'Recovery' : 'Landing', met: e.metStart });
    }
  });

  // ── transfer legs: MANEUVER events with a from/to node pair ──────────────
  log.forEach(e => {
    if (!_evIsSolvedManeuver(e) || !e.fromNode || !e.toNode) return;
    const fromN = _missionNmNodeById(e.fromNode), toN = _missionNmNodeById(e.toNode);
    if (!fromN || !toN || !fromN.orbit || !toN.orbit) return;
    const fromO = fromN.orbit, toO = toN.orbit;
    const frameId = _trajFrameForOrbit(toO) || _trajFrameForOrbit(fromO);
    if (!frameId) return;
    const lane = laneColorFor(_trajOwnerKeysForManeuver(e));
    const dvUsed = (e.dvDelivered != null ? e.dvDelivered : e.dvRequired) || 0;
    const metArrive = (e.metStart != null && e.durationUsed != null) ? (e.metStart + e.durationUsed) : null;
    const vehName = (_trajOwnerKeysForManeuver(e) && m._ownerLabels && m._ownerLabels[_trajOwnerKeysForManeuver(e)[0]]) || e.activeName || '';
    frameFor(frameId).legs.push({
      frameId, fromO, toO, fromLabel: e.fromLabel || fromN.label, toLabel: e.toLabel || toN.label,
      dv: dvUsed, met: e.metStart, metArrive, vehName,
      color: lane ? lane.color : null, key: e._authIdx != null ? ('mv' + e._authIdx + '#' + (e._rep || 0)) : ('mv' + Math.random()),
      authIdx: e._authIdx != null ? e._authIdx : null,
    });
  });

  // ── COAST loiter badges: attach to the orbit ring active at that point ───
  log.forEach((e, i) => {
    if (e.type !== 'COAST') return;
    const snap = e.snapshot || [];
    // pick the first non-surface orbit in this snapshot as "where we're loitering"
    const v = snap.find(vv => vv.orbit && !vv.orbit.surface && ((vv.orbit.perigee ?? 0) > 0 || (vv.orbit.apogee ?? 0) > 0));
    if (!v) return;
    const o = v.orbit;
    const peri = o.perigee ?? o.apogee ?? 0, apo = o.apogee ?? o.perigee ?? 0;
    const rec = addOrbitRing(o.body || 'Earth', peri, apo, v.owners, e._authIdx);
    if (rec) { rec.coast = rec.coast || []; rec.coast.push({ days: e.days || 0 }); }
  });

  // ── R3.1: state-derived ring orientation (MATH.md §7i) ───────────────────
  // A converged physics leg's departure/arrival plane OVERRIDES the ring's
  // Ω=ω=0 convention when the ring's (body, peri, apo) matches the leg's
  // parking/arrival orbit. First converged leg to touch a shared ring wins
  // (stability under replay) — later legs never re-orient an already-derived
  // ring. Size (peri/apo) is unchanged — orientation only (tier 2 of the
  // three-tier rule; unmatched rings keep the Ω=0 default, tier 3).
  if (m.missionId != null && typeof _physTrajByMission !== 'undefined') {
    const physLegs = (_physTrajByMission[m.missionId] && _physTrajByMission[m.missionId].legs) || [];
    physLegs.forEach(L => {
      if (!L.converged || (!L.departElements && !L.arrivalElements)) return;
      const auth = m.log[L.authIdx];
      if (!auth || !_evIsSolvedManeuver(auth)) return;
      const fromN = _missionNmNodeById(auth.fromNode);
      const fromO = fromN && fromN.orbit;
      if (L.departElements && fromO && fromO.body) {
        const sc = frames[fromO.body];
        const key = _trajOrbitKey(fromO.body, fromO.perigee ?? fromO.apogee ?? 0, fromO.apogee ?? fromO.perigee ?? 0);
        const rec = sc && sc.orbits.get(key);
        if (rec && !rec.elements) rec.elements = Object.assign({ source: 'flight' }, L.departElements);
      }
      // Arrival: L.toNode is the transit/corridor node (no peri/apo of its
      // own), so match by L.dest (the real destination BODY, stored on the
      // leg) + peri/apo RECOVERED from arrivalElements' own {a, e} — those
      // were already set to the AUTHORED destination orbit's size in 565, so
      // this reproduces exactly the (body, peri, apo) key the real LLO/
      // arrival ring was registered under.
      if (L.arrivalElements && L.dest && PROG_BODIES[L.dest]) {
        const el = L.arrivalElements, Rd = PROG_BODIES[L.dest].R;
        const peri = el.a * (1 - el.e) - Rd, apo = el.a * (1 + el.e) - Rd;
        const sc = frames[L.dest];
        const key = _trajOrbitKey(L.dest, peri, apo);
        const rec = sc && sc.orbits.get(key);
        if (rec && !rec.elements) rec.elements = Object.assign({ source: 'flight' }, L.arrivalElements);
      }
    });
  }

  // Resolve each ring's expend-at-met (C2 "expended vehicle" dimming): the
  // LATEST of its owners' expend times (a ring is only "history" once ALL
  // its owners are gone — a multi-owner co-located ring with one surviving
  // owner stays current).
  Object.values(frames).forEach(sc => {
    sc.orbits.forEach(rec => {
      if (!rec.ownerKeys || !rec.ownerKeys.size) { rec.expendMet = null; return; }
      let allExpended = true, maxMet = -Infinity;
      rec.ownerKeys.forEach(k => {
        const em = expendMetByOwner[k];
        if (em == null) { allExpended = false; return; }
        if (em > maxMet) maxMet = em;
      });
      rec.expendMet = allExpended ? maxMet : null;
    });
  });

  return frames;
}

// A MANEUVER event doesn't carry v.owners directly — resolve via the active
// vehicle key (activeKey) against m._ownerLabels-keyed owner sets is indirect,
// so instead prefer the destination snapshot's owners for the SAME event (the
// vehicle that just arrived is the one that flew the leg).
function _trajOwnerKeysForManeuver(e) {
  const snap = e.snapshot || [];
  if (!snap.length) return null;
  const v = snap.find(vv => vv.owners && vv.owners.length);
  return v ? v.owners : null;
}

// ── geometry helpers ──────────────────────────────────────────────────────
// True-geometry ellipse for a (peri,apo) orbit around a body of radius R,
// focus at the body center (LOCAL coords, before the body's world offset is
// added). Returns SVG-ready numbers in KM (caller applies scene `scale`).
//   a       = semi-major axis
//   c       = center-to-focus distance = a - r_peri
//   cx      = -c  (center is on the -x side since periapsis is drawn at +x)
// Periapsis is placed at angle 0 (local +x) by convention.
function _trajEllipseGeom(peri, apo, R) {
  const rPeri = R + peri, rApo = R + apo;
  const a = (rPeri + rApo) / 2;
  const b = Math.sqrt(Math.max(0, rPeri * rApo));
  const c = a - rPeri; // signed offset from focus to center along +x
  return { rPeri, rApo, a, b, c };
}
