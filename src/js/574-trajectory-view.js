
// ─── TRAJECTORY VIEW — unified continuous-zoom world (C1b) ───────────────
// Third mission view: a 2D true-geometry orbital map ("2D KSP/SFS-like"),
// restrained blueprint style (thin strokes, mono labels, theme colors — NOT
// cartoon). Mission orbits / transfer arcs come from _trajSceneContent().
//
// ── ARCHITECTURE — ONE WORLD, HELIOCENTRIC KM ─────────────────────────────
// C1b deletes the scene catalog entirely. There is no per-body "scene" any
// more — one render pass draws the WHOLE system every time: the Sun, every
// planet's heliocentric ring + disc/glyph, moons on their rings around their
// parents, and ALL mission content (orbit rings, transfer arcs, burn
// markers, surface events) embedded at its parent body's CURRENT world
// position (progBodyWorldPos). A camera (pan/zoom, anchored to a body) picks
// which slice of that one world is visible — "changing scene" is now just
// "flying the camera," never a different render path.
//
// Two-layer split is preserved (mandatory, per the a0f5614 architecture —
// see the auto-memory note this task was briefed with):
//
//   LAYER 1 — WORLD  (svg.traj-svg): GEOMETRY ONLY, in FLOATING-ORIGIN render
//     coords (see below) — never raw heliocentric km (Neptune ~4.5e9 km
//     would jitter/overflow float precision inside an SVG attribute at LEO
//     zoom). Pure viewBox-camera SVG; nothing in this layer is sized in
//     screen px.
//
//   LAYER 2 — SYMBOLOGY overlay (svg.traj-overlay): sibling SVG, container
//     px 1:1, all labels/plates/markers/hit-circles. Untouched by C1b except
//     that anchors are now floating-origin render coords too (still funneled
//     through the ONE projection function below).
//
// `_trajWorldToScreen(x, y, cam, rect)` is UNCHANGED signature/semantics —
// the mini-diagram (230-orbit-diagram.js) calls it directly with a synthetic
// cam and must keep working untouched. What changed is what "world" MEANS:
// x,y are now floating-origin render units (worldKm - camCenterKm), not
// scene-local km*scale.
//
// ── FLOATING ORIGIN (precision — non-negotiable) ──────────────────────────
// Every render computes camCenterKm = worldPos(cam.anchorBody, viewTime) +
// cam.relOffsetKm, then every emitted point is (worldKm - camCenterKm) — so
// SVG attributes never carry heliocentric-scale numbers. The viewBox itself
// is therefore always centered near (0,0) regardless of where in the solar
// system the camera actually is.
//
// ── ANCHORED CAMERA (the teleport killer) ─────────────────────────────────
// Camera state per mission: { anchorBody, relOffsetKm:{x,y}, wKm }. Effective
// center = worldPos(anchorBody, viewTime) + relOffsetKm. Wheel zoom-to-cursor
// mutates wKm + relOffsetKm; drag pan mutates relOffsetKm; changing the
// selected event (which moves viewTime) leaves anchor+offset untouched, so
// the anchored body stays fixed on screen while the rest of the system moves
// around it. Fly-to (trajSetFocus, kept name/signature for the focus-bar
// wiring) sets anchor, zeroes offset, and fits wKm to the body's
// neighborhood.
//
// DELETED as part of C1b (the scene-catalog machinery):
//   _trajSceneList, _trajFocus/_trajFocusByMission (scene-keyed) — replaced
//     by camera anchor state (_trajCamByMission[id].anchorBody)
//   _trajSceneForOrbit's scene-id return value being a "which SVG to build"
//     key — orbits/legs are now just embedded at their body's world pos,
//     every scene renders in the one pass
//   _trajSunSceneSVG / _trajBodySceneSVG / _trajSceneGeomSVG (per-scene
//     builders) — replaced by _trajWorldSVG (one pass, everything)
//   _trajFitScale/_trajMissionExtent's "which scene" framing — replaced by
//     _trajFitCamToAnchor (still fits mission content, now camera-driven)
//   the "scene switch" hint chip semantics — hint chip now means "fly to"
// Kept (still load-bearing, unchanged behavior): the LOD/label registry
// (_trajRegisterLabel/_trajResolveLabels/_trajWorldToScreen), the mission log
// extraction (_trajExtractMission and friends), ellipse/arc geometry helpers,
// pan/wheel gesture plumbing (adapted to mutate relOffsetKm/wKm instead of
// cx/cy/w), the ResizeObserver sync path.

// Module-local, session-only state (NOT authored — never touches m.log or
// autosave; camera resets on reload, same spirit as _missionNmZoom).
// Camera per mission: { anchorBody, relOffsetKm:{x,y}, wKm }.
//   anchorBody   — body name the camera tracks ('Sun' or any PROG_BODIES key)
//   relOffsetKm  — pan offset from the anchor's world position, in km
//   wKm          — camera viewBox width, in km (zoom = independent of any
//                  scene-local `scale` factor now — it's real km)
let _trajCamByMission = {};

// Fixed reference viewBox size in RENDER units (floating-origin km, i.e. 1
// render unit = 1 km at zoom reference). Kept named _TRAJ_VB for continuity
// with the mini-diagram's synthetic cam (still `{cx:0,cy:0,w:_OD_VBW}` in its
// own unrelated unit space — no coupling).
const _TRAJ_VB = 400;

// Zoom clamps per the C1b brief: wKm in [~200 km, ~1.2e10 km] (just past
// Neptune's ring so the full system is reachable in one continuous zoom).
const _TRAJ_WKM_MIN = 200, _TRAJ_WKM_MAX = 1.2e10;

// ── body -> chrome color mapping ─────────────────────────────────────────
function _trajBodyColor(body) {
  if (body === 'Sun') return 'var(--warn)';
  if (body === 'Earth') return 'var(--nm-earth)';
  if (PROG_MOON_ORBITS && PROG_MOON_ORBITS[body]) return 'var(--nm-lunar)';
  return 'var(--nm-interp)';
}

// All body names the world ever draws: Sun + every heliocentric body +
// every moon. Used for the full-system render pass and the focus-bar list.
function _trajAllBodies() {
  const helio = Object.keys(PROG_HELIO_R);
  const moons = Object.keys(PROG_MOON_ORBITS || {});
  return ['Sun', ...helio, ...moons];
}

function _trajMoonsOf(body) {
  return Object.entries(PROG_MOON_ORBITS || {})
    .filter(([, mo]) => mo.parent === body)
    .map(([name, mo]) => ({ name, r: mo.r }));
}

// ── camera helpers ─────────────────────────────────────────────────────────
function _trajCam(id) {
  return _trajCamByMission[id] || { anchorBody: 'Earth', relOffsetKm: { x: 0, y: 0 }, wKm: _TRAJ_VB };
}
function _trajZoomFromCam(cam) { return _TRAJ_VB / cam.wKm; }

// Effective camera center in heliocentric km at the given view time — the
// ONE place anchor + offset combine. Everything else in the render path
// subtracts this from world km to get floating-origin render coords.
// `overrides` (optional) = the current mission's planet-phase calibration
// map (see _trajGetPlanetCalibration) — when the camera is anchored on a
// calibrated planet, the camera itself must resolve through the SAME
// calibrated position so the anchor body stays centered (coherence: glyph
// position, ZOI anchor, and camera center must all agree, per the render
// integration brief). Falls back to plain progBodyWorldPos when omitted or
// when the anchor has no override.
function _trajCamCenterKm(cam, viewT, overrides) {
  const p = overrides ? progBodyWorldPosCalibrated(cam.anchorBody, viewT, overrides) : progBodyWorldPos(cam.anchorBody, viewT);
  return { x: p.x + (cam.relOffsetKm ? cam.relOffsetKm.x : 0), y: p.y + (cam.relOffsetKm ? cam.relOffsetKm.y : 0) };
}

// Fit wKm (and zero the offset) to a sensible neighborhood of `body`:
//   - has moons  -> fit the outermost moon's ring (x ~2.6 headroom)
//   - Sun        -> fit the outermost planet's ring
//   - no moons   -> a schematic multiple of the body's own radius (local orbit space)
// Mission content anchored at this body (if any) can extend the fit, same
// spirit as the old _trajFitScale's "mission extent vs static extent" — we
// take whichever is larger so authored orbits are never clipped on fly-to.
function _trajFitWKmForBody(body, m) {
  let staticR;
  if (body === 'Sun') {
    const rs = Object.values(PROG_HELIO_R);
    staticR = rs.length ? Math.max(...rs) * 1.15 : 1e9;
  } else {
    const moons = _trajMoonsOf(body);
    if (moons.length) {
      staticR = Math.max(...moons.map(mo => mo.r)) * 2.6;
    } else {
      const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 6371;
      staticR = R * 8; // schematic local-orbit neighborhood
    }
  }
  const missionR = m ? _trajMissionExtentForBody(body, m) : 0;
  const fitR = Math.max(staticR, missionR * 1.2);
  return Math.max(_TRAJ_WKM_MIN, Math.min(_TRAJ_WKM_MAX, fitR * 2));
}

function trajSetFocus(id, body) {
  const m = (typeof _missions !== 'undefined' ? (_missions || []) : []).find(mm => mm.missionId === id);
  const wKm = _trajFitWKmForBody(body, m);
  _trajCamByMission[id] = { anchorBody: body, relOffsetKm: { x: 0, y: 0 }, wKm };
  missionRenderDetail();
}

function trajResetView(id) {
  const cam = _trajCam(id);
  const m = (typeof _missions !== 'undefined' ? (_missions || []) : []).find(mm => mm.missionId === id);
  const wKm = _trajFitWKmForBody(cam.anchorBody, m);
  _trajCamByMission[id] = { anchorBody: cam.anchorBody, relOffsetKm: { x: 0, y: 0 }, wKm };
  missionRenderDetail();
}

// Re-render both layers + update the world <svg>'s viewBox attribute — cheap
// camera-only update path shared by wheel-zoom and pan so neither has to
// rebuild the whole mission panel.
function _trajApplyCam(id, cam) {
  _trajCamByMission[id] = cam;
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"]`);
  if (!va) { missionRenderDetail(); return; }
  const svgEl = va.querySelector('svg.traj-svg');
  const overlayEl = va.querySelector('svg.traj-overlay');
  if (!svgEl) { missionRenderDetail(); return; }
  const rect = svgEl.getBoundingClientRect();
  const aspect = (rect.width > 0 && rect.height > 0) ? (rect.height / rect.width) : 1;
  const h = cam.wKm * aspect;
  svgEl.setAttribute('viewBox', `${(-cam.wKm / 2).toFixed(3)} ${(-h / 2).toFixed(3)} ${cam.wKm.toFixed(3)} ${h.toFixed(3)}`);
  const sceneEl = svgEl.querySelector('g.traj-scene');
  if (sceneEl && typeof _missions !== 'undefined') {
    const m = (_missions || []).find(mm => mm.missionId === id);
    const zoom = _trajZoomFromCam(cam);
    _trajResetLabels();
    sceneEl.innerHTML = _trajWorldSVG(m, cam, zoom, rect);
    if (overlayEl && rect.width > 0 && rect.height > 0) {
      overlayEl.setAttribute('width', rect.width);
      overlayEl.setAttribute('height', rect.height);
      overlayEl.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
      const renderCam = { cx: 0, cy: 0, w: cam.wKm };
      overlayEl.innerHTML = _trajResolveLabels(renderCam, rect);
    }
  }
}

function trajWheelZoom(ev, id) {
  ev.preventDefault();
  const svgEl = (ev.currentTarget.querySelector && ev.currentTarget.querySelector('svg.traj-svg')) || null;
  const cam = _trajCam(id);
  const dir = ev.deltaY < 0 ? 1 : -1;
  const nextW = Math.max(_TRAJ_WKM_MIN, Math.min(_TRAJ_WKM_MAX, cam.wKm * (1 - dir * 0.15)));
  if (nextW === cam.wKm) return;
  // Zoom about the cursor: convert cursor screen position to a render-space
  // (floating-origin) point under the CURRENT camera, then re-anchor the
  // OFFSET so that same point stays under the cursor after the width change
  // (standard viewBox zoom-to-point, but operating on relOffsetKm rather
  // than an absolute center — the anchor body's world position is added
  // back in at render time, so this math never touches heliocentric km).
  let offX = cam.relOffsetKm ? cam.relOffsetKm.x : 0, offY = cam.relOffsetKm ? cam.relOffsetKm.y : 0;
  if (svgEl) {
    const rect = svgEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const aspect = rect.height / rect.width;
      const h = cam.wKm * aspect;
      const fx = (ev.clientX - rect.left) / rect.width;  // 0..1 across the svg
      const fy = (ev.clientY - rect.top) / rect.height;
      // render-space point under cursor (render coords are offset-relative
      // since the anchor's own world pos is the floating origin)
      const rx = (-cam.wKm / 2) + fx * cam.wKm;
      const ry = (-h / 2) + fy * h;
      const nextH = nextW * aspect;
      offX = offX + rx - (fx - 0.5) * nextW;
      offY = offY + ry - (fy - 0.5) * nextH;
    }
  }
  _trajApplyCam(id, { anchorBody: cam.anchorBody, relOffsetKm: { x: offX, y: offY }, wKm: nextW });
}

let _trajDrag = null;
// Set true when a pan-drag actually moved the pointer (>3px, same threshold as
// the node map's missionNmPanMove) so the click that follows a real drag on an
// interactive arc/marker/ring doesn't also select an event (drag-vs-click
// disambiguation, per the node map / library-browser _didDrag pattern).
let _trajJustDragged = false;
function trajPanStart(ev, id) {
  _trajDrag = { id, x0: ev.clientX, y0: ev.clientY, cam0: Object.assign({}, _trajCam(id), { relOffsetKm: Object.assign({}, _trajCam(id).relOffsetKm) }), moved: false, rectW: null, rectH: null };
  const svgEl = ev.currentTarget && ev.currentTarget.querySelector ? ev.currentTarget.querySelector('svg.traj-svg') : null;
  if (svgEl) { const r = svgEl.getBoundingClientRect(); _trajDrag.rectW = r.width; _trajDrag.rectH = r.height; }
  ev.preventDefault();
}
function trajPanMove(ev) {
  if (!_trajDrag) return;
  const dx = ev.clientX - _trajDrag.x0, dy = ev.clientY - _trajDrag.y0;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _trajDrag.moved = true;
  const rectW = _trajDrag.rectW || 400, rectH = _trajDrag.rectH || 400;
  // Screen-px delta -> world-unit (km) delta at the CURRENT camera width (drag
  // pan shifts relOffsetKm directly, opposite the pointer delta since dragging
  // right should reveal content to the left).
  const worldDx = -dx * (_trajDrag.cam0.wKm / rectW);
  const aspect = rectH / rectW;
  const worldDy = -dy * (_trajDrag.cam0.wKm * aspect / rectH);
  const cam = { anchorBody: _trajDrag.cam0.anchorBody, relOffsetKm: { x: _trajDrag.cam0.relOffsetKm.x + worldDx, y: _trajDrag.cam0.relOffsetKm.y + worldDy }, wKm: _trajDrag.cam0.wKm };
  _trajCamByMission[_trajDrag.id] = cam;
  const svgEl = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${_trajDrag.id}"] svg.traj-svg`);
  if (svgEl) {
    const h = cam.wKm * aspect;
    svgEl.setAttribute('viewBox', `${(-cam.wKm / 2).toFixed(3)} ${(-h / 2).toFixed(3)} ${cam.wKm.toFixed(3)} ${h.toFixed(3)}`);
  }
  // Overlay anchors are NOT re-projected during the drag itself (would mean
  // re-running LOD/collision every mousemove tick); they resync on pan-end
  // via _trajApplyCam's full re-render. See report note: "re-project on
  // pan-end, not every tick."
}
function trajPanEnd() {
  if (_trajDrag) {
    _trajJustDragged = _trajDrag.moved;
    if (_trajDrag.moved) _trajApplyCam(_trajDrag.id, _trajCamByMission[_trajDrag.id]);
  }
  _trajDrag = null;
}

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

  const addOrbitRing = (body, peri, apo, ownerKeys, authIdx) => {
    if (body == null || peri == null || apo == null) return null;
    if (_trajCorridorMoon(body, apo)) return null; // corridor state rings die (C2) — arcs carry transfer meaning now
    const frameId = body;
    const sc = frameFor(frameId);
    const key = _trajOrbitKey(body, peri, apo);
    const lane = laneColorFor(ownerKeys);
    if (!sc.orbits.has(key)) {
      sc.orbits.set(key, {
        key, body, peri, apo,
        label: _trajOrbitLabel(body, peri, apo),
        colors: new Set(), names: new Set(),
        firstAuthIdx: authIdx != null ? authIdx : null,  // first authored event that put a vehicle in this orbit (for click-to-select)
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
      const peri = o.perigee ?? o.apogee ?? 0, apo = o.apogee ?? o.perigee ?? 0;
      if (!(peri > 0) && !(apo > 0)) return; // skip degenerate/zero orbits
      addOrbitRing(o.body || 'Earth', peri, apo, v.owners, e._authIdx);
    });
  });

  // ── surface events: LAUNCH / (REENTER-derived) LAND ──────────────────────
  log.forEach(e => {
    if (e.type === 'LAUNCH') {
      const body = (e.launchOrbit && e.launchOrbit.body) || 'Earth';
      frameFor(body).surface.push({ kind: 'launch', body, label: 'Launch', met: e.metStart });
    } else if (e.type === 'REENTER' || e.type === 'RECOVER') {
      const body = (e.orbitAfter && e.orbitAfter.body) || 'Earth';
      frameFor(body).surface.push({ kind: 'land', body, label: e.type === 'RECOVER' ? 'Recovery' : 'Landing', met: e.metStart });
    }
  });

  // ── transfer legs: MANEUVER events with a from/to node pair ──────────────
  log.forEach(e => {
    if (e.type !== 'MANEUVER' || !e.fromNode || !e.toNode) return;
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

// ── PROJECTION — the one function every overlay anchor goes through ───────
// Render-space (floating-origin km * scale, same space g.traj-scene draws
// in) -> overlay px, given the current camera and the world svg's measured
// bounding rect. UNCHANGED signature/semantics from the two-layer refactor:
// both the trajectory view and the mini orbit-diagram (230, fixed camera
// {cx:0,cy:0,w:_OD_VBW}) funnel through it. `cam.cx/cam.cy` are always 0 for
// the trajectory view's own calls post-C1b (floating origin design), but the
// function itself stays cx/cy-general so 230's differently-centered
// synthetic cam keeps working unmodified.
function _trajWorldToScreen(x, y, cam, rect) {
  const w = rect && rect.width > 0 ? rect.width : cam.w;
  const h = rect && rect.height > 0 ? rect.height : cam.w;
  const aspect = h / w;
  const camH = cam.w * aspect;
  const px = ((x - (cam.cx - cam.w / 2)) / cam.w) * w;
  const py = ((y - (cam.cy - camH / 2)) / camH) * h;
  return { x: px, y: py };
}

// ── LOD (level-of-detail) + label collision — now pure px, no unit games ──
// Feature geometry (rings, arcs, markers, discs) always renders in the WORLD
// layer — only TEXT/marker-glyph annotations are gated/collision-resolved,
// and they live entirely in the OVERLAY layer. Per-render registry: every
// label/marker candidate is pushed here as a RENDER-SPACE anchor (x,y,
// floating-origin km*scale) — projection to px happens once, in
// _trajResolveLabels, via _trajWorldToScreen — plus a `screenSizeWorld` (the
// parent feature's true-scale world radius/extent) so the LOD gate can
// multiply it by the actual zoom at resolve time. Reset at the top of every
// top-level render.
let _trajLabelRegistry = [];
function _trajResetLabels() { _trajLabelRegistry = []; }

// Priority order (higher wins collisions): selected-event > burn > orbit > body > zone.
const _TRAJ_LOD_PRI = { selected: 5, burn: 4, orbit: 3, body: 2, zone: 1 };

// Rough monospace glyph width in px at a given font-size (var(--mono) is a
// fixed-width face; ~0.62em per character is a safe estimate for JetBrains
// Mono-style fonts — used only for collision bbox sizing, not layout).
function _trajTextWidthPx(text, fontPx) { return (text || '').length * fontPx * 0.62; }

// Register a label candidate. `x,y` = render-space anchor (same space
// geometry is drawn in — floating-origin). `screenSize` = the rendered
// on-screen px size of the PARENT feature (ring radius, disc radius,
// arc/ring extent) at the CURRENT zoom — callers already have `zoom` in hand
// and pass true-world-radius*zoom, same contract as before; the difference
// is there's no further pxScale correction needed since px really is px in
// the overlay now. Pass Infinity for features with no size gate (e.g.
// always-selected, or the mini-diagram which has no LOD). `kind` indexes
// _TRAJ_LOD_PRI. `lines` is an array of {text, dy, fontPx, color} rendered
// top-to-bottom inside one plate. `marker` (optional) = extra overlay
// markup (e.g. a burn triangle) anchored at the same render point, always
// rendered regardless of label LOD/collision outcome (geometry-adjacent
// symbology, not text).
// `opts.opacity` (0..1, default 1) — overlay symbology INHERITS its parent
// feature's alpha per the C2 brief ("labels/markers fade WITH their
// geometry"). A label still needs BOTH its feature visible (opacity>0, and
// past the minSize gate below) AND its own size gate to actually render —
// the two are independent checks, this field carries the first.
function _trajRegisterLabel(x, y, lines, kind, opts) {
  opts = opts || {};
  _trajLabelRegistry.push({
    x, y, lines, kind, priority: (opts.selected ? _TRAJ_LOD_PRI.selected : _TRAJ_LOD_PRI[kind]) || 0,
    screenSize: opts.screenSize != null ? opts.screenSize : Infinity, minSize: opts.minSize || 0,
    selected: !!opts.selected, anchor: opts.anchor || 'middle',
    marker: opts.marker || null, hit: opts.hit || null,
    opacity: opts.opacity != null ? Math.max(0, Math.min(1, opts.opacity)) : 1,
  });
}

// LOD + collision resolution, run in PURE PX against the overlay's own
// coordinate space (0,0 top-left, width x height = container px — set by the
// caller's <svg viewBox="0 0 W H">). `cam`/`rect` are used only to project
// each candidate's render-space anchor to px via _trajWorldToScreen; every
// threshold and every emitted shape after that point is in px, full stop —
// no zoom or pxScale correction anywhere in this function.
function _trajResolveLabels(cam, rect) {
  // A candidate needs BOTH its feature visible (opacity>0) AND its own size
  // gate (screenSize>=minSize, or selected) to be eligible at all.
  const cands = _trajLabelRegistry.filter(c => c.opacity > 0 && (c.selected || c.screenSize >= c.minSize));
  cands.sort((a, b) => (b.priority - a.priority) || (b.screenSize - a.screenSize));
  const kept = [];
  const overlaps = (a, b) => !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1);
  let out = '';
  // Always-render markers (triangles/dots/hit-circles) are emitted for every
  // candidate regardless of label collision outcome — only the TEXT+plate is
  // collision-gated. Marker inherits the feature's opacity too.
  cands.forEach(c => {
    if (!c.marker) return;
    const p = _trajWorldToScreen(c.x, c.y, cam, rect);
    const op = c.opacity < 1 ? ` opacity="${c.opacity.toFixed(3)}"` : '';
    out += `<g transform="translate(${p.x.toFixed(2)},${p.y.toFixed(2)})"${op}>${c.marker}${c.hit || ''}</g>`;
  });
  cands.forEach(c => {
    if (!c.lines || !c.lines.length) return;
    const p = _trajWorldToScreen(c.x, c.y, cam, rect);
    const sx = p.x, sy = p.y;
    const maxW = Math.max(1, ...c.lines.map(l => _trajTextWidthPx(l.text, l.fontPx)));
    const h = c.lines.reduce((s, l) => s + (l.fontPx * 1.15), 0);
    const topDy = c.lines[0].dy;
    const bx1 = sx - maxW / 2, bx2 = sx + maxW / 2;
    const by1 = sy + topDy - c.lines[0].fontPx, by2 = by1 + h + 2;
    const box = { x1: bx1, x2: bx2, y1: by1, y2: by2 };
    if (!c.selected) {
      const hit = kept.some(k => overlaps(box, k.box));
      if (hit) return; // dropped — a higher/equal-priority label already claims this space
    }
    kept.push({ box });
    const plateW = maxW + 6, plateH = h + 4;
    const plateX = bx1 - 3, plateY = by1 - 1;
    const groupOp = c.opacity < 1 ? ` opacity="${c.opacity.toFixed(3)}"` : '';
    const textLines = c.lines.map(l => `<text x="${sx.toFixed(2)}" y="${(sy + l.dy).toFixed(2)}" text-anchor="${c.anchor}" font-family="var(--mono)" font-size="${l.fontPx}" fill="${l.color}">${l.text}</text>`).join('');
    const plate = `<rect x="${plateX.toFixed(2)}" y="${plateY.toFixed(2)}" width="${plateW.toFixed(2)}" height="${plateH.toFixed(2)}" fill="var(--panel-tint-plate)" rx="2"/>`;
    out += `<g${groupOp}>${plate}${textLines}</g>`;
  });
  return out;
}

// LOD size thresholds (rendered on-screen px, i.e. world-svg-units * zoom),
// per the brief: ring label >=40px ring radius; body label disc>=10px OR
// scene focus; burn text >=60px parent arc/ring extent OR selected.
const _TRAJ_LOD_RING_MIN = 40, _TRAJ_LOD_BODY_MIN = 10, _TRAJ_LOD_BURN_MIN = 60;

// ── C2: LOD OPACITY WINDOWS (per-feature px visibility windows, linear ramp
// at ~20% of the window width at each edge — see _trajLodOpacity). These
// replace C1b's hard culls for the FEATURE geometry itself; the two
// correctness culls below (_trajCullRingByDiagonal / _trajCullByExtent)
// remain as the EXTREME ends only (numerical/degenerate-geometry safety, not
// a visual LOD decision — a ring beyond 20x the viewport diagonal is culled
// outright regardless of window math, same as before).
// RULE: one fade authority per feature — a child (e.g. a mission ring
// embedded in a planet's neighborhood) uses EITHER its own window OR
// inherits its parent group's resolved alpha, never both multiplied.
const _TRAJ_LOD_WIN = {
  heliocentricRing: [8, 15],       // × viewport diagonal at hi (see _trajWindowHi)
  moonRing:         [10, 15],
  missionOrbitRing: [12, 15],
  transferArc:      [10, 15],
  zoneOfInfluence:  [30, 15],      // hi unused (no fade-out ceiling — fades IN only above lo)
};
// hi values above are "x times viewport diagonal" multipliers except where
// noted; resolved to actual px via _trajWindowHi so every window shares the
// same viewport-relative ceiling semantics as the old hard cull did.
function _trajWindowHi(multiplier, viewportDiagPx) {
  return (viewportDiagPx || 800) * multiplier;
}

// ── C1b/C2 correctness culling (numerical safety — kept as the window's
// extreme outer end, NOT a visual LOD decision) ──
// (a) rings whose projected radius exceeds ~20x the viewport diagonal are
//     culled outright — at extreme zoom-in a huge/short-visible-chord ring
//     (e.g. Neptune's ring while anchored deep in LEO) would otherwise emit a
//     near-straight-line arc that jitters/degenerates in SVG's arc-flag math.
// (b) features whose projected extent < 0.5px are culled (the entire Earth
//     neighborhood at Sun zoom collapses under this — glyphs/labels keep
//     their EXISTING LOD gates on top, unaffected).
function _trajCullRingByDiagonal(rPx, viewportDiagPx) {
  return rPx > viewportDiagPx * 20;
}
function _trajCullByExtent(extentPx) {
  return extentPx < 0.5;
}
// Position-based off-screen cull: a body (glyph + embedded content) whose
// render-space position is far outside the viewport is skipped ENTIRELY —
// this is the fix for the "far body's min-px glyph clamp still emits its
// true (huge, off-screen) coordinate" case: _trajBodyPxR guarantees a
// visible-sized DISC, but the disc's CENTER can still be billions of km from
// the camera, and SVG attribute floats at that magnitude are exactly the
// precision hazard the floating-origin design exists to avoid. Threshold
// mirrors the ring cull (20x viewport diagonal, generous so a body just
// outside frame doesn't pop).
function _trajCullPositionOffscreen(renderX, renderY, zoom, viewportDiagPx) {
  const distPx = Math.hypot(renderX, renderY) * zoom;
  return distPx > viewportDiagPx * 20;
}

// `opts.historyAlpha` (0..1, optional multiplier < 1): applied when the
// orbit belongs to a vehicle that no longer exists at viewTime (expended
// before t) — same "history" dimming used for legs, per the mission-state
// rendering brief. This is the ring's OWN fade authority combining with the
// LOD ramp by simple multiplication (both describe the SAME feature, not a
// parent/child pair, so this does not violate the one-fade-authority rule).
function _trajRingSVG(rec, body, scale, color, opts) {
  opts = opts || {};
  const zoom = opts.zoom || 1;
  const viewportDiagPx = opts.viewportDiagPx || Infinity;
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  const g = _trajEllipseGeom(rec.peri, rec.apo, R);
  const isCircle = Math.abs(rec.apo - rec.peri) < Math.max(1, R * 0.001);
  const emphasized = !!opts.emphasized;
  const strokeColor = emphasized ? 'var(--accent)' : (color || (rec.colors.size === 1 ? [...rec.colors][0] : 'var(--accent)'));
  const strokeW = emphasized ? 1.4 : 0.7;
  const baseOpacity = emphasized ? 1 : 0.85;
  const historyMul = opts.historyAlpha != null ? opts.historyAlpha : 1;
  const names = [...rec.names].join(', ');
  const title = `${names ? names + ' — ' : ''}${rec.label}`;
  const clickAttr = opts.authIdx != null ? ` style="cursor:pointer" onclick="_trajSelectEventFromView('${opts.missionId}',${opts.authIdx})"` : '';
  const coastTxt = rec.coast && rec.coast.length
    ? `&#x27F3; ${Math.round(rec.coast.reduce((s, c) => s + (c.days || 0), 0))}d` : null;
  const ox = opts.originX || 0, oy = opts.originY || 0; // body's floating-origin render position
  if (isCircle) {
    const r = ((rec.peri + rec.apo) / 2 + R) * scale;
    const screenSize = r * zoom;
    if (_trajCullByExtent(screenSize)) return '';
    if (_trajCullRingByDiagonal(screenSize, viewportDiagPx)) return '';
    const lodAlpha = emphasized ? 1 : _trajLodOpacity(screenSize, _TRAJ_LOD_WIN.missionOrbitRing[0], _trajWindowHi(_TRAJ_LOD_WIN.missionOrbitRing[1], viewportDiagPx));
    const opacity = (baseOpacity * lodAlpha * historyMul).toFixed(3);
    if (lodAlpha <= 0) return '';
    const hitArea = opts.authIdx != null ? `<circle cx="${ox}" cy="${oy}" r="${r.toFixed(2)}" fill="none" stroke="transparent" stroke-width="9"${clickAttr}/>` : '';
    const lines = [{ text: rec.label, dy: -4, fontPx: 10.5, color: 'var(--nm-label)' }];
    _trajRegisterLabel(ox, oy - r, lines, 'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, opacity: lodAlpha * historyMul });
    if (coastTxt) _trajRegisterLabel(ox - g.c * scale, oy - 6, [{ text: coastTxt, dy: 0, fontPx: 10, color: 'var(--nm-label)' }], 'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, opacity: lodAlpha * historyMul });
    return `<g${clickAttr}>
      <circle cx="${ox}" cy="${oy}" r="${r.toFixed(2)}" fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" opacity="${opacity}" vector-effect="non-scaling-stroke"><title>${title}</title></circle>
      ${hitArea}
    </g>`;
  }
  const cx = ox - g.c * scale, cy = oy, rx = g.a * scale, ry = g.b * scale;
  const screenSize = Math.max(rx, ry) * zoom;
  if (_trajCullByExtent(screenSize)) return '';
  if (_trajCullRingByDiagonal(screenSize, viewportDiagPx)) return '';
  const lodAlpha = emphasized ? 1 : _trajLodOpacity(screenSize, _TRAJ_LOD_WIN.missionOrbitRing[0], _trajWindowHi(_TRAJ_LOD_WIN.missionOrbitRing[1], viewportDiagPx));
  if (lodAlpha <= 0) return '';
  const opacity = (baseOpacity * lodAlpha * historyMul).toFixed(3);
  const hitArea = opts.authIdx != null ? `<ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="none" stroke="transparent" stroke-width="9"${clickAttr}/>` : '';
  const lines = [{ text: rec.label, dy: -4, fontPx: 10.5, color: 'var(--nm-label)' }];
  _trajRegisterLabel(cx, cy - ry, lines, 'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, opacity: lodAlpha * historyMul });
  if (coastTxt) _trajRegisterLabel(cx, oy - 6, [{ text: coastTxt, dy: 0, fontPx: 10, color: 'var(--nm-label)' }], 'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, opacity: lodAlpha * historyMul });
  return `<g${clickAttr}>
    <ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" opacity="${opacity}" vector-effect="non-scaling-stroke"><title>${title}</title></ellipse>
    ${hitArea}
  </g>`;
}

// Half-ellipse Hohmann transfer arc between r1 (departure) and r2 (arrival),
// both body-centered radii (R already included), drawn relative to a local
// origin (ox,oy) — the body's floating-origin render position — so the arc
// embeds correctly wherever that body currently is.
function _trajTransferArcPath(r1, r2, scale, rotDeg, ox, oy) {
  ox = ox || 0; oy = oy || 0;
  const rPeri = Math.min(r1, r2), rApo = Math.max(r1, r2);
  const a = (rPeri + rApo) / 2, b = Math.sqrt(Math.max(0, rPeri * rApo)), c = a - rPeri;
  const rot = rotDeg || 0;
  const rad = rot * Math.PI / 180;
  const rotp = (x, y) => ({ x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) });
  const p1l = { x: rPeri * scale, y: 0 };
  const p2l = { x: -rApo * scale, y: 0 };
  const p1r = rotp(p1l.x, p1l.y), p2r = rotp(p2l.x, p2l.y);
  const p1 = { x: p1r.x + ox, y: p1r.y + oy }, p2 = { x: p2r.x + ox, y: p2r.y + oy };
  const rx = (a * scale).toFixed(2), ry = (b * scale).toFixed(2);
  const rotDegAttr = rot.toFixed(1);
  return { d: `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${rx} ${ry} ${rotDegAttr} 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
           depX: p1.x, depY: p1.y, arrX: p2.x, arrY: p2.y };
}

// ── Moon-lead arc orientation (pure geometry) ──────────────────────────────
// _trajTransferArcPath's arrival endpoint (the -rApo*scale local point) lands
// at screen angle (180 + rotDeg) degrees after rotation, since periapsis is
// fixed at local angle 0. To make the arrival end land ON a specific target
// point (targetX,targetY) relative to the arc's local origin (ox,oy), solve
// for rotDeg = angle(origin -> target) - 180, normalized to (-180,180].
// Pure function, no DOM/globals — testable in isolation.
function _trajArcRotationForTarget(ox, oy, targetX, targetY) {
  const dx = targetX - ox, dy = targetY - oy;
  let ang = Math.atan2(dy, dx) * 180 / Math.PI - 180;
  ang = ((ang + 180) % 360 + 360) % 360 - 180; // normalize to (-180,180]
  return ang;
}

// Linear (schematic, NOT Kepler) fraction of a leg's path completed at time
// viewT, clamped to [0,1]. Per MATH.md critique: real vehicles move faster
// near periapsis (true-anomaly rate is non-uniform); this is a path-length
// approximation for the schematic vehicle dot only, not a physics claim.
function _trajLegPathFraction(metDepart, tof, viewT) {
  if (!(tof > 0)) return 0;
  const f = (viewT - metDepart) / tof;
  return Math.max(0, Math.min(1, f));
}

// Point at parameter t (0..1, periapsis->apoapsis sweep, CCW half-ellipse)
// along the arc emitted by _trajTransferArcPath, in the SAME render-space
// coords as its d-path (so a caller can drop a dot directly on the drawn
// path without re-deriving the ellipse). t=0 -> p1 (departure/periapsis
// end), t=1 -> p2 (arrival/apoapsis end). Walks the true-anomaly-uniform
// half-ellipse parametrically (theta from 0 to pi) — schematic, matches the
// half-ellipse the SVG arc-flag draws, not true orbital speed.
function _trajArcPointAt(r1, r2, scale, rotDeg, ox, oy, t) {
  ox = ox || 0; oy = oy || 0;
  const rPeri = Math.min(r1, r2) * scale, rApo = Math.max(r1, r2) * scale;
  const a = (rPeri + rApo) / 2, b = Math.sqrt(Math.max(0, rPeri * rApo)), c = a - rPeri;
  const theta = Math.max(0, Math.min(1, t)) * Math.PI; // 0..pi sweeps periapsis->apoapsis
  // Ellipse centered at local (-c,0) — periapsis (local +rPeri,0) is `a` from
  // center: center_x + a = rPeri => center_x = rPeri - a = -c. Matches
  // _trajTransferArcPath's p1=(rPeri*scale,0), p2=(-rApo*scale,0) convention
  // (theta=0 -> periapsis at +x, theta=pi -> apoapsis at -x).
  const lx = -c + a * Math.cos(theta), ly = b * Math.sin(theta);
  const rad = (rotDeg || 0) * Math.PI / 180;
  const rx = lx * Math.cos(rad) - ly * Math.sin(rad), ry = lx * Math.sin(rad) + ly * Math.cos(rad);
  return { x: rx + ox, y: ry + oy };
}

// ── LOD opacity ramp (C2) ──────────────────────────────────────────────────
// Replaces C1b's hard culls with a linear fade at each end of a px-size
// visibility window [lo,hi]. Ramp width is ~20% of the window (in log space
// isn't needed here — windows are already px, linear ramp on px is fine
// since the edges are the interesting region, not the whole span).
// Returns opacity in [0,1]; 0 outside the window, 1 in the window's middle
// 60%, linear ramp in the outer 20% bands at each end.
function _trajLodOpacity(sizePx, lo, hi) {
  if (!(sizePx >= 0)) return 0;
  if (sizePx < lo) return 0;
  // Ramp width is 20% of the window, but CAPPED at 20% of `lo` — our windows
  // routinely pair a small lo (~10-30px) with a huge hi (15x viewport
  // diagonal, effectively "never fades out"), and 20% of THAT span would put
  // the entry ramp thousands of px wide, making everything just past lo read
  // as nearly invisible. Capping keeps the entry ramp a sane, visually-tight
  // band right at the lo threshold regardless of how far away hi is.
  const rampWFull = (isFinite(hi) && hi > lo) ? (hi - lo) * 0.2 : Infinity;
  const rampW = Math.max(1, Math.min(rampWFull, lo * 0.2));
  if (isFinite(hi) && hi > lo) {
    if (sizePx > hi) return 0;
    if (sizePx > hi - rampW) return (hi - sizePx) / rampW;
  }
  if (sizePx < lo + rampW) return (sizePx - lo) / rampW;
  return 1;
}

// Burn marker — registers a fixed-px triangle glyph + optional dv/MET text at
// a render-space (floating-origin) anchor. Geometry side (world layer) gets
// nothing from this function any more; everything it emits is overlay-side
// markup carried on the label registry entry (`marker`/`hit`), resolved to
// px by _trajResolveLabels.
function _trajBurnMarker(x, y, dir, dvText, metText, opts) {
  opts = opts || {};
  const zoom = opts.zoom || 1;
  const emphasized = !!opts.emphasized;
  const strokeColor = emphasized ? 'var(--accent)' : 'var(--accent2)';
  const strokeW = emphasized ? 1.3 : 0.8;
  const textColor = emphasized ? 'var(--accent)' : 'var(--accent2)';
  const clickAttr = opts.authIdx != null ? ` style="cursor:pointer" onclick="event.stopPropagation();_trajSelectEventFromView('${opts.missionId}',${opts.authIdx})"` : '';
  const titleTxt = opts.title || '';
  // Marker dot + hit area (px-sized, always rendered — geometry-adjacent, not
  // an "annotation" subject to LOD).
  const marker = `<circle cx="0" cy="0" r="${emphasized ? 2.4 : 2}" fill="var(--nm-bg)" stroke="${strokeColor}" stroke-width="${strokeW}" pointer-events="none"/>`;
  const hit = opts.authIdx != null ? `<circle cx="0" cy="0" r="8" fill="transparent" style="pointer-events:auto;cursor:pointer"${clickAttr}><title>${titleTxt}</title></circle>` : '';
  const glyph = dir === 'up' ? '▲' : '▼';
  const dvLabel = dvText ? `${glyph} ${dvText}` : glyph;
  const lines = [{ text: dvLabel, dy: -5, fontPx: 10, color: textColor }];
  if (metText) lines.push({ text: metText, dy: 9, fontPx: 10, color: 'var(--text-dim)' });
  _trajRegisterLabel(x, y, lines, 'burn', { screenSize: opts.screenSize != null ? opts.screenSize : Infinity, minSize: _TRAJ_LOD_BURN_MIN, selected: emphasized, marker, hit, opacity: opts.opacity != null ? opts.opacity : 1 });
}

// History alpha (C2): legs/orbits belonging to a vehicle/state that no
// longer exists "now" (arrived-and-past, or expended before viewTime) dim to
// this constant rather than disappearing — keeps mission HISTORY legible
// without competing visually with the current/planned state.
const _TRAJ_HISTORY_ALPHA = 0.35;

// Ghost marker (C2 Moon-lead fix): a dim glyph-outline + label at a body's
// ARRIVAL-time position, shown only when it differs visibly (>3px) from the
// body's CURRENT viewTime position — so users don't conclude "the arc misses
// the Moon" when the Moon has since moved along its own orbit. LOD-gated
// like any other label (screenSize tied to zoom so it also fades with scale).
function _trajGhostMarker(x, y, bodyName, zoom, parentAlpha) {
  const alpha = (parentAlpha != null ? parentAlpha : 1);
  const r = _trajBodyPxR(3, zoom);
  const marker = `<circle cx="0" cy="0" r="${r}" fill="none" stroke="var(--text-dim)" stroke-width="0.8" stroke-dasharray="1.5,1.5" pointer-events="none"/>`;
  const lines = [{ text: `${bodyName} at arrival`, dy: -4 - r, fontPx: 9, color: 'var(--text-dim)' }];
  _trajRegisterLabel(x, y, lines, 'zone', { screenSize: r * zoom, minSize: 0, selected: false, marker, opacity: alpha * 0.8 });
  return '';
}

// Click handler shared by arcs/markers/rings: selects the AUTHORED event
// (expands its card + rewinds the state panel via existing missionSelectEvent
// behavior). Guarded against firing after a real pan-drag (see trajCanvasDown).
function _trajSelectEventFromView(id, authIdx) {
  if (_trajJustDragged) { _trajJustDragged = false; return; }
  if (typeof missionSelectEvent === 'function') missionSelectEvent(id, authIdx);
}

// Compute the min zoom-worthy extent (max body-centered radius, km) of a
// body-frame's MISSION content only (orbit apoapses + transfer/legs' far
// endpoint) — used to pick the fly-to fit scale (static rings beyond remain
// reachable by zooming out further).
function _trajMissionExtentForBody(body, m) {
  const frames = _trajGetExtraction(m);
  const sc = frames[body];
  if (!sc) return 0;
  const isSun = body === 'Sun';
  const R = isSun ? 0 : ((PROG_BODIES[body] && PROG_BODIES[body].R) || 0);
  let maxR = 0;
  sc.orbits.forEach(rec => { maxR = Math.max(maxR, R + rec.apo); });
  sc.legs.forEach(leg => {
    if (isSun) {
      const r1 = PROG_HELIO_R[leg.fromO.body], r2 = PROG_HELIO_R[leg.toO.body];
      if (r1 != null) maxR = Math.max(maxR, r1);
      if (r2 != null) maxR = Math.max(maxR, r2);
    } else {
      const r1 = _trajLocalRadius(leg.fromO, body), r2 = _trajLocalRadius(leg.toO, body);
      if (r1 != null) maxR = Math.max(maxR, r1);
      if (r2 != null) maxR = Math.max(maxR, r2);
    }
  });
  return maxR;
}

// Per-render extraction cache, keyed by missionId so switching missions (or a
// stale reference from a prior render) can't leak state across renders.
let _trajExtractionCache = { missionId: null, data: null };
function _trajGetExtraction(m) {
  if (!m) return {};
  if (_trajExtractionCache.missionId === m.missionId && _trajExtractionCache.data) return _trajExtractionCache.data;
  const data = _trajExtractMission(m);
  _trajExtractionCache = { missionId: m.missionId, data };
  return data;
}

// ── Planet-phase calibration (per-mission, render-pass-only derived state) ──
// See MATH.md §7a "planet phase calibration" for the full rule set; spec
// recap: a mission's FIRST Sun-frame leg to a given heliocentric destination
// planet calibrates that planet's theta0 (via progCalibratedTheta0, 360) so
// its true-shape Hohmann arc visually connects. A SECOND leg to the SAME
// planet within the same mission can't also be satisfied — it's flagged
// 'second' so the render pass draws ghost endpoints + a dotted line instead
// of a connecting arc. Legs to planets that never get a calibrating leg keep
// table theta0s untouched (offset 0, simply absent from the overrides map).
// NOT persisted (m.log/autosave untouched), NOT written into the global
// PROG_BODY_KINEMATICS table — recomputed fresh every render pass, keyed to
// THIS mission's extraction cache so other missions/the porkchop plotter are
// completely unaffected.
let _trajCalibrationCache = { missionId: null, data: null };
function _trajGetPlanetCalibration(m) {
  if (!m) return { overrides: {}, legFlags: {}, active: false };
  if (_trajCalibrationCache.missionId === m.missionId && _trajCalibrationCache.data) return _trajCalibrationCache.data;
  const frames = _trajGetExtraction(m);
  const overrides = {};      // { bodyName: offsetRadians } — heliocentric planets only
  const legFlags = {};       // leg.key -> 'calibrating' | 'second'
  // A true interplanetary transit leg has fromO.body === 'Sun' (per
  // PROG_NM_NODES, 430 — e.g. mars-transfer's orbit is
  // {type:'transit', body:'Sun', destination:'Mars'}), but per
  // _trajFrameForOrbit(toO) it's extracted into the DESTINATION's OWN frame
  // (frameId === destBody, e.g. 'Mars'), not a 'Sun' frameId — only the
  // (impulsive, met===metArrive) injection leg that ENTERS the corridor
  // lands in a Sun-adjacent frameId. So candidates must be gathered by
  // scanning EVERY body frame's legs for fromO.body === 'Sun', not by
  // assuming a single 'Sun' frame holds them. Legs within each frame's
  // array are already in log/authored order (see _trajExtractMission); to
  // get correct MISSION-WIDE authored order across frames (needed so the
  // true first-in-time leg to a planet is the one that calibrates it, not
  // just the first one encountered by frame-iteration order), sort
  // candidates by leg.authIdx before assigning calibrating/second.
  const candidates = [];
  Object.keys(frames).forEach(frameId => {
    (frames[frameId].legs || []).forEach(leg => {
      if (!leg.fromO || leg.fromO.body !== 'Sun') return; // only real heliocentric transit legs
      const destBody = leg.toO && (leg.toO.destination || leg.toO.body);
      // Only heliocentric planets (PROG_HELIO_R) are calibration candidates —
      // explicitly excludes anything in PROG_MOON_ORBITS (moons are handled
      // by the existing Moon-lead logic, calibration is planet-ring-only).
      if (!destBody || PROG_HELIO_R[destBody] == null || (PROG_MOON_ORBITS && PROG_MOON_ORBITS[destBody])) return;
      if (leg.met == null || leg.metArrive == null) return; // no timing to calibrate against
      const departBody = leg.fromO.departure_body || 'Earth';
      candidates.push({ leg, destBody, departBody });
    });
  });
  candidates.sort((a, b) => (a.leg.authIdx != null ? a.leg.authIdx : 0) - (b.leg.authIdx != null ? b.leg.authIdx : 0));
  candidates.forEach(({ leg, destBody, departBody }) => {
    if (overrides[destBody] == null) {
      overrides[destBody] = (typeof progCalibratedTheta0 === 'function') ? progCalibratedTheta0(destBody, leg.met, leg.metArrive, departBody) : 0;
      legFlags[leg.key] = 'calibrating';
    } else {
      legFlags[leg.key] = 'second';
    }
  });
  const data = { overrides, legFlags, active: Object.keys(overrides).length > 0 };
  _trajCalibrationCache = { missionId: m.missionId, data };
  return data;
}

function _trajSelectedAuthIdx(m) {
  if (!m || !m.log) return null;
  const idx = m.log.findIndex(e => e._expanded);
  return idx >= 0 ? idx : null;
}

// Body-centered periapsis/apoapsis radius (km, including body R) for a
// node-map orbit spec — used only by the redundancy check below (distinct
// from _trajLocalRadius's single "mean radius" used for arc endpoints).
function toO_peri(o, R) {
  if (!o || o.perigee == null && o.apogee == null) return null;
  return R + (o.perigee ?? o.apogee ?? 0);
}
function toO_apo(o, R) {
  if (!o || o.perigee == null && o.apogee == null) return null;
  return R + (o.apogee ?? o.perigee ?? 0);
}

// Redundant-transfer check: a leg's transfer ellipse (rPeri..rApo) is
// suppressed when it's ~equal to the destination orbit's own (rPeri..rApo) —
// i.e. the target IS the transfer (classic GTO-as-destination case, where the
// model charges dv2=0 for the arrival burn). Tolerance ~2%, matching the
// design brief. `toRPeri`/`toRApo` are the destination orbit's body-centered
// radii; `arcRPeri`/`arcRApo` are the drawn transfer arc's radii.
function _trajTransferIsRedundant(arcRPeri, arcRApo, toRPeri, toRApo) {
  if (!(arcRPeri > 0) || !(arcRApo > 0) || !(toRPeri > 0) || !(toRApo > 0)) return false;
  const tolP = Math.max(1, toRPeri * 0.02), tolA = Math.max(1, toRApo * 0.02);
  return Math.abs(arcRPeri - toRPeri) < tolP && Math.abs(arcRApo - toRApo) < tolA;
}

// Emits mission content (orbit rings, transfer legs, surface events) for one
// body frame, positioned around (ox,oy) — that body's floating-origin render
// coordinates for this frame. `scale` is the LOCAL px-per-km factor for this
// body's neighborhood (independent of the camera zoom, same "local scene
// scale" concept as before — it just gets recentered on ox,oy instead of on
// the SVG origin).
function _trajBodyFrameContent(body, m, scale, zoom, ox, oy, viewportDiagPx, viewT, overrides, calib) {
  if (!m) return '';
  const frames = _trajGetExtraction(m);
  const sc = frames[body];
  if (!sc) return '';
  const isSun = body === 'Sun';
  const R = isSun ? 0 : ((PROG_BODIES[body] && PROG_BODIES[body].R) || 0);
  scale = scale || 1;
  zoom = zoom || 1;
  overrides = overrides || {};
  const legFlags = (calib && calib.legFlags) || {};
  const id = m.missionId;
  const selAuthIdx = _trajSelectedAuthIdx(m);

  let out = '';

  // orbit rings (skip for Sun frame — heliocentric transit legs are drawn as
  // arcs between the planet rings, not as a new "orbit" of the Sun)
  if (!isSun) {
    sc.orbits.forEach(rec => {
      const emphasized = selAuthIdx != null && rec.firstAuthIdx === selAuthIdx;
      // C2: a ring whose owning vehicle(s) are ALL expended by viewTime dims
      // to history alpha, same treatment as an arrived leg.
      const isHistoryOrbit = rec.expendMet != null && viewT != null && rec.expendMet <= viewT;
      out += _trajRingSVG(rec, body, scale, rec.colors.size === 1 ? [...rec.colors][0] : null,
        { emphasized, authIdx: rec.firstAuthIdx, missionId: id, zoom, originX: ox, originY: oy, viewportDiagPx, historyAlpha: isHistoryOrbit ? _TRAJ_HISTORY_ALPHA : 1 });
    });
  }

  // transfer legs — C2 mission-state trimming: a leg's relationship to
  // viewT decides its render treatment: arrived (metArrive <= viewT) =
  // "history" (dimmed, _TRAJ_HISTORY_ALPHA); departed but not yet arrived
  // (met <= viewT < metArrive) = "current" (full-strength + a schematic
  // vehicle dot at linear path fraction); not yet departed (met > viewT) =
  // "planned" (today's dashed rendering, unchanged). Legs with no `met`
  // (older missions / degenerate data) fall back to "planned" treatment.
  const vt = viewT != null ? viewT : Infinity;
  sc.legs.forEach((leg, li) => {
    const emphasized = selAuthIdx != null && leg.authIdx === selAuthIdx;
    const clickAttr = leg.authIdx != null ? ` style="cursor:pointer" onclick="_trajSelectEventFromView('${id}',${leg.authIdx})"` : '';
    const hoverTitle = `${leg.vehName ? leg.vehName + ' — ' : ''}${leg.fromLabel} → ${leg.toLabel}${leg.dv ? ' &middot; ' + _trajDvText(leg.dv) : ''}${leg.met != null ? ' &middot; ' + _metFmt(leg.met) : ''}`;
    const markerOpts = (screenSize) => ({ emphasized, authIdx: leg.authIdx, missionId: id, title: hoverTitle, zoom, screenSize });
    const hasTOF = leg.met != null && leg.metArrive != null && leg.metArrive > leg.met;
    const legState = !hasTOF ? 'planned' : (leg.metArrive <= vt ? 'history' : (leg.met <= vt ? 'current' : 'planned'));
    const stateAlpha = legState === 'history' ? _TRAJ_HISTORY_ALPHA : 1;
    if (isSun) {
      const r1 = PROG_HELIO_R[leg.fromO.body] || PROG_HELIO_R[leg.fromLabel] || null;
      const r2 = PROG_HELIO_R[leg.toO.body] || PROG_HELIO_R[leg.toLabel] || null;
      if (r1 == null || r2 == null) return;
      // Moon-lead orientation (C2): rotate so the arrival end lands on the
      // DESTINATION BODY'S POSITION AT ARRIVAL TIME (t_arrive), not a
      // schematic fixed angle — same rule as the local-body case below,
      // just resolved in heliocentric coords for interplanetary legs.
      const destBody = leg.toO.destination || leg.toO.body || leg.toLabel;
      const tArrive = leg.metArrive != null ? leg.metArrive : vt;

      // ── Second-leg-to-the-same-planet case (planet-phase calibration rule
      // 3, MATH.md §7a): only the FIRST leg to a given heliocentric
      // destination gets to calibrate that planet's theta0 for this mission's
      // render; a second leg's own departure/arrival timing generally won't
      // land on the (already-fixed) calibrated position, so it can't render a
      // real connecting arc — draw schematic ghost endpoints + a dotted line
      // instead, per the C2 ghost-marker pattern.
      if (legFlags[leg.key] === 'second' && destBody && PROG_HELIO_R[destBody] != null) {
        const depWorld = progBodyWorldPosCalibrated(leg.fromO.body || 'Earth', leg.met, overrides);
        const depP = { x: ox + depWorld.x, y: oy + depWorld.y }; // Sun frame: ox,oy IS the Sun's render pos, world coords add directly
        const arrWorld = progBodyWorldPosCalibrated(destBody, leg.metArrive, overrides); // reads the FIRST leg's already-fixed calibration for this body
        const arrP = { x: ox + arrWorld.x, y: oy + arrWorld.y };
        const ghostTitle = `phase not shown — planet position calibrated to the first ${destBody} transfer`;
        const dashLine = `<line x1="${depP.x.toFixed(2)}" y1="${depP.y.toFixed(2)}" x2="${arrP.x.toFixed(2)}" y2="${arrP.y.toFixed(2)}" stroke="var(--text-dim)" stroke-width="0.6" stroke-dasharray="1,2" opacity="${(0.5 * stateAlpha).toFixed(3)}" vector-effect="non-scaling-stroke"><title>${ghostTitle}</title></line>`;
        out += dashLine;
        const ghostMarkerSvg = (px, py) => {
          const r = _trajBodyPxR(2.5, zoom);
          return `<circle cx="0" cy="0" r="${r}" fill="none" stroke="var(--text-dim)" stroke-width="0.8" stroke-dasharray="1.5,1.5" pointer-events="auto"><title>${ghostTitle}</title></circle>`;
        };
        _trajRegisterLabel(depP.x, depP.y, [{ text: `${leg.fromLabel} → ${leg.toLabel}`, dy: -4 - _trajBodyPxR(2.5, zoom), fontPx: 9, color: 'var(--text-dim)' }], 'zone',
          { screenSize: _trajBodyPxR(2.5, zoom) * zoom, minSize: 0, selected: false, marker: ghostMarkerSvg(depP.x, depP.y), opacity: 0.7 * stateAlpha });
        _trajBurnMarker(depP.x, depP.y, 'up', _trajDvText(leg.dv), _metFmt(leg.met), Object.assign(markerOpts(0), { opacity: 0.7 * stateAlpha, title: ghostTitle }));
        _trajRegisterLabel(arrP.x, arrP.y, [{ text: `${destBody} (2nd leg)`, dy: -4 - _trajBodyPxR(2.5, zoom), fontPx: 9, color: 'var(--text-dim)' }], 'zone',
          { screenSize: _trajBodyPxR(2.5, zoom) * zoom, minSize: 0, selected: false, marker: ghostMarkerSvg(arrP.x, arrP.y), opacity: 0.7 * stateAlpha });
        return;
      }

      let rotAng = _trajPlanetAngle(leg.fromO.body);
      let ghostP = null, arrivalTargetP = null;
      if (destBody && PROG_HELIO_R[destBody] != null && typeof progBodyWorldPosCalibrated === 'function') {
        // Calibrated position at arrival — for a 'calibrating' first leg this
        // is DERIVED to make the arc connect exactly (offset solved for
        // that purpose), so the arc's rotation is now self-consistent by
        // construction. For a planet with no calibrating leg, overrides has
        // no entry for it and this is identical to plain progBodyWorldPos.
        const arrWorld = progBodyWorldPosCalibrated(destBody, tArrive, overrides);
        arrivalTargetP = { x: ox + arrWorld.x, y: oy + arrWorld.y };
        rotAng = _trajArcRotationForTarget(ox, oy, arrivalTargetP.x, arrivalTargetP.y);
        const viewWorld = progBodyWorldPosCalibrated(destBody, vt, overrides);
        const viewP = { x: ox + viewWorld.x, y: oy + viewWorld.y };
        if (Math.hypot(viewP.x - arrivalTargetP.x, viewP.y - arrivalTargetP.y) * zoom > 3) ghostP = arrivalTargetP;
      }
      const arc = _trajTransferArcPath(r1, r2, scale, rotAng, ox, oy);
      const arcExtentPx = Math.abs(arc.depX - arc.arrX) / 2 * zoom;
      if (_trajCullByExtent(arcExtentPx) || _trajCullRingByDiagonal(arcExtentPx, viewportDiagPx)) return;
      const arcAlpha = emphasized ? 1 : _trajLodOpacity(arcExtentPx, _TRAJ_LOD_WIN.transferArc[0], _trajWindowHi(_TRAJ_LOD_WIN.transferArc[1], viewportDiagPx));
      if (arcAlpha <= 0) return;
      const color = emphasized ? 'var(--accent)' : (leg.color || 'var(--accent2)');
      const strokeW = emphasized ? 1.2 : 0.7;
      const dashAttr = legState === 'planned' ? ` stroke-dasharray="2.5,2"` : '';
      const opacity = (arcAlpha * (emphasized ? 1 : 0.8) * stateAlpha).toFixed(3);
      const hitArea = leg.authIdx != null ? `<path d="${arc.d}" fill="none" stroke="transparent" stroke-width="8"${clickAttr}/>` : '';
      out += `<path d="${arc.d}" fill="none" stroke="${color}" stroke-width="${strokeW}"${dashAttr} opacity="${opacity}" vector-effect="non-scaling-stroke"${clickAttr}><title>${hoverTitle}</title></path>${hitArea}`;
      _trajBurnMarker(arc.depX, arc.depY, 'up', _trajDvText(leg.dv), _metFmt(leg.met), Object.assign(markerOpts(arcExtentPx), { opacity: stateAlpha }));
      _trajBurnMarker(arc.arrX, arc.arrY, 'down', '', _metFmt(leg.metArrive), Object.assign(markerOpts(arcExtentPx), { opacity: stateAlpha }));
      if (legState === 'current' && hasTOF) {
        const frac = _trajLegPathFraction(leg.met, leg.metArrive - leg.met, vt);
        const dotP = _trajArcPointAt(r1, r2, scale, rotAng, ox, oy, frac);
        out += `<circle cx="${dotP.x.toFixed(2)}" cy="${dotP.y.toFixed(2)}" r="2.2" fill="var(--accent)" stroke="var(--nm-bg)" stroke-width="0.6" vector-effect="non-scaling-stroke"><title>Vehicle position (schematic — linear path fraction, not true orbital speed)</title></circle>`;
      }
      if (ghostP) out += _trajGhostMarker(ghostP.x, ghostP.y, destBody, zoom, arcAlpha * stateAlpha);
      return;
    }

    // ── Second-leg-to-the-same-planet case, LOCAL-FRAME variant (planet-phase
    // calibration rule 3, MATH.md §7a): the leg that actually carries
    // interplanetary coast time (fromO.body==='Sun') is extracted into the
    // DESTINATION's own local frame (see _trajFrameForOrbit — a transit leg's
    // frame is the toO body, not literally 'Sun'), so the second-leg ghost
    // treatment has to be checked here too, not only in the isSun branch
    // above (which only ever sees the impulsive corridor-injection leg, whose
    // met===metArrive gives it no timing to calibrate against in the first
    // place). Only the FIRST such leg to this planet renders a real
    // (schematic SOI-fallback) arc; a second gets ghost endpoints + a dotted
    // line, matching the isSun branch's treatment.
    if (leg.fromO && leg.fromO.body === 'Sun' && legFlags[leg.key] === 'second') {
      const r = _trajLocalRadius(leg.fromO, body); // schematic SOI-edge departure point, still meaningful as a local anchor
      const depLocal = (r != null) ? { x: ox + r * scale, y: oy } : { x: ox, y: oy };
      const arrLocalR = _trajLocalRadius(leg.toO, body);
      const arrLocal = (arrLocalR != null) ? { x: ox + arrLocalR * scale, y: oy } : { x: ox, y: oy };
      const ghostTitle = `phase not shown — planet position calibrated to the first ${body} transfer`;
      out += `<line x1="${depLocal.x.toFixed(2)}" y1="${depLocal.y.toFixed(2)}" x2="${arrLocal.x.toFixed(2)}" y2="${arrLocal.y.toFixed(2)}" stroke="var(--text-dim)" stroke-width="0.6" stroke-dasharray="1,2" opacity="${(0.5 * stateAlpha).toFixed(3)}" vector-effect="non-scaling-stroke"><title>${ghostTitle}</title></line>`;
      const gr = _trajBodyPxR(2.5, zoom);
      const ghostMarkerSvg = `<circle cx="0" cy="0" r="${gr}" fill="none" stroke="var(--text-dim)" stroke-width="0.8" stroke-dasharray="1.5,1.5" pointer-events="auto"><title>${ghostTitle}</title></circle>`;
      _trajRegisterLabel(depLocal.x, depLocal.y, [{ text: leg.fromLabel, dy: -4 - gr, fontPx: 9, color: 'var(--text-dim)' }], 'zone', { screenSize: gr * zoom, minSize: 0, selected: false, marker: ghostMarkerSvg, opacity: 0.7 * stateAlpha });
      _trajBurnMarker(depLocal.x, depLocal.y, 'up', _trajDvText(leg.dv), _metFmt(leg.met), Object.assign(markerOpts(0), { opacity: 0.7 * stateAlpha, title: ghostTitle }));
      _trajRegisterLabel(arrLocal.x, arrLocal.y, [{ text: `${leg.toLabel} (2nd leg)`, dy: -4 - gr, fontPx: 9, color: 'var(--text-dim)' }], 'zone', { screenSize: gr * zoom, minSize: 0, selected: false, marker: ghostMarkerSvg, opacity: 0.7 * stateAlpha });
      return;
    }

    const fromR = _trajLocalRadius(leg.fromO, body);
    const toR = _trajLocalRadius(leg.toO, body);
    if (fromR == null || toR == null) return;
    const toPeri = toO_peri(leg.toO, R), toApo = toO_apo(leg.toO, R);
    const redundant = toPeri != null && toApo != null && _trajTransferIsRedundant(fromR, toApo, toPeri, toApo);
    const arcToR = (toApo != null && toPeri != null && Math.abs(toApo - toPeri) > Math.max(1, toApo * 0.001)) ? toApo : toR;
    // Moon-lead orientation (C2): for a leg whose destination is a MOON of
    // this body frame (o.destination present, e.g. LEO->TLC->LLO), orient
    // the apse line so the arrival end lands on that moon's world position
    // AT ARRIVAL TIME rather than the old fixed rotDeg=0 convention.
    const destMoon = leg.toO.destination || null;
    let rotAng = 0, ghostLocal = null;
    if (destMoon && PROG_MOON_ORBITS[destMoon] && PROG_MOON_ORBITS[destMoon].parent === body) {
      const tArrive = leg.metArrive != null ? leg.metArrive : vt;
      const arrTheta = progBodyAngleAt(destMoon, tArrive);
      const arrLocal = { x: ox + PROG_MOON_ORBITS[destMoon].r * scale * Math.cos(arrTheta), y: oy + PROG_MOON_ORBITS[destMoon].r * scale * Math.sin(arrTheta) };
      rotAng = _trajArcRotationForTarget(ox, oy, arrLocal.x, arrLocal.y);
      const viewTheta = progBodyAngleAt(destMoon, vt);
      const viewLocal = { x: ox + PROG_MOON_ORBITS[destMoon].r * scale * Math.cos(viewTheta), y: oy + PROG_MOON_ORBITS[destMoon].r * scale * Math.sin(viewTheta) };
      if (Math.hypot(viewLocal.x - arrLocal.x, viewLocal.y - arrLocal.y) * zoom > 3) ghostLocal = { p: arrLocal, body: destMoon };
    }
    const arc = _trajTransferArcPath(fromR, arcToR, scale, rotAng, ox, oy);
    const arcExtentPx = Math.abs(arc.depX - arc.arrX) / 2 * zoom;
    if (_trajCullByExtent(arcExtentPx) || _trajCullRingByDiagonal(arcExtentPx, viewportDiagPx)) return;
    const arcAlpha = emphasized ? 1 : _trajLodOpacity(arcExtentPx, _TRAJ_LOD_WIN.transferArc[0], _trajWindowHi(_TRAJ_LOD_WIN.transferArc[1], viewportDiagPx));
    if (arcAlpha <= 0) return;
    const color = emphasized ? 'var(--accent)' : (leg.color || 'var(--accent2)');
    const strokeW = emphasized ? 1.2 : 0.7;
    const dashAttr = legState === 'planned' ? ` stroke-dasharray="2.5,2"` : '';
    const opacity = (arcAlpha * (emphasized ? 1 : 0.8) * stateAlpha).toFixed(3);
    if (!redundant) {
      const hitArea = leg.authIdx != null ? `<path d="${arc.d}" fill="none" stroke="transparent" stroke-width="8"${clickAttr}/>` : '';
      out += `<path d="${arc.d}" fill="none" stroke="${color}" stroke-width="${strokeW}"${dashAttr} opacity="${opacity}" vector-effect="non-scaling-stroke"${clickAttr}><title>${hoverTitle}</title></path>${hitArea}`;
      _trajBurnMarker(arc.depX, arc.depY, 'up', _trajDvText(leg.dv), _metFmt(leg.met), Object.assign(markerOpts(arcExtentPx), { opacity: stateAlpha }));
      _trajBurnMarker(arc.arrX, arc.arrY, 'down', '', _metFmt(leg.metArrive), Object.assign(markerOpts(arcExtentPx), { opacity: stateAlpha }));
      if (legState === 'current' && hasTOF) {
        const frac = _trajLegPathFraction(leg.met, leg.metArrive - leg.met, vt);
        const dotP = _trajArcPointAt(fromR, arcToR, scale, rotAng, ox, oy, frac);
        out += `<circle cx="${dotP.x.toFixed(2)}" cy="${dotP.y.toFixed(2)}" r="2.2" fill="var(--accent)" stroke="var(--nm-bg)" stroke-width="0.6" vector-effect="non-scaling-stroke"><title>Vehicle position (schematic — linear path fraction, not true orbital speed)</title></circle>`;
      }
    } else {
      _trajBurnMarker(arc.depX, arc.depY, 'up', _trajDvText(leg.dv), _metFmt(leg.met), Object.assign(markerOpts(arcExtentPx), { opacity: stateAlpha }));
    }
    if (ghostLocal) out += _trajGhostMarker(ghostLocal.p.x, ghostLocal.p.y, ghostLocal.body, zoom, arcAlpha * stateAlpha);
  });

  // surface events (fixed-px marker + LOD-gated label, like burn markers)
  sc.surface.forEach(s => {
    const ang = s.kind === 'launch' ? -90 : 90; // launch at top, landing at bottom of disc — schematic
    const rad = ang * Math.PI / 180;
    const bodyPxR = Math.max(4, R * scale * 0.02);
    const x = ox + bodyPxR * Math.cos(rad), y = oy + bodyPxR * Math.sin(rad);
    const dy = s.kind === 'launch' ? -5 : 10;
    const marker = `<circle cx="0" cy="0" r="1.6" fill="var(--accent3)" pointer-events="none"/>`;
    _trajRegisterLabel(x, y, [{ text: s.label, dy, fontPx: 10, color: 'var(--accent3)' }], 'burn',
      { screenSize: Infinity, minSize: 0, selected: false, marker });
  });

  return out;
}

function _trajDvText(dv) {
  return dv ? Math.round(dv).toLocaleString() + ' m/s' : '';
}

// Body-centered radius (km, including body R) for a node-map orbit spec, in
// the given body's local frame. Returns null if the orbit isn't in this
// body's local frame (e.g. a transit/escape leg that belongs to a different frame).
function _trajLocalRadius(o, body) {
  if (!o) return null;
  if (o.type === 'transit') {
    if (o.destination) {
      const mo = PROG_MOON_ORBITS[o.destination];
      if (mo && mo.parent === body) return mo.r; // parent-frame view (Earth): moon's orbital radius
      // C2 fix: a transit whose DESTINATION is `body` itself (e.g. body ===
      // 'Moon', o.destination === 'Moon') is the ARRIVING end drawn in the
      // destination's OWN frame — this is a patched-conic seam (the true
      // departure point is hyperbolic-relative-to-the-moon, not a finite
      // body-centered radius). Schematic fallback: draw from the moon's own
      // SOI-scale edge (a fixed multiple of its radius) down to the arrival
      // orbit, same spirit as a Hohmann-arc placeholder for the un-modeled
      // hyperbolic approach leg. This is what lets the TLC->LLO leg actually
      // render in the Moon frame (previously silently dropped — fromR was
      // always null here, so the leg never drew at all).
      if (o.destination === body) {
        // Bug fix (C2 review): this was `R*20` (a fixed multiple of the
        // MOON's own body radius, ~34,748 km for the Moon) — a value with NO
        // relationship to the actual departure-arrival gap the arc has to
        // span. That made the leg's drawn extent (and therefore its
        // _TRAJ_LOD_WIN.transferArc gate, evaluated in real screen px) a
        // function of camera zoom alone: at Moon anchor the camera is zoomed
        // in tight enough that even this tiny schematic radius reads as a
        // large arc; at Earth anchor (zoomed out to frame the whole
        // Earth-Moon gap) the SAME arc collapses under the window's 10px
        // floor and the leg silently vanished — even though its parent
        // frame's mirror leg (Earth's LEO->TLC, which correctly uses the
        // FULL mo.r orbital radius as its far endpoint) rendered fine at the
        // same zoom. Fix: scale the SOI-fallback radius off the moon's own
        // orbital radius (mo.r, the same quantity the parent-frame leg above
        // already uses) rather than the moon's body radius, so the two ends
        // of this cross-frame leg agree on the physical scale of the gap
        // they're schematically bridging — the arc's drawn extent is then
        // consistent (and correctly LOD-gated on its OWN screen extent,
        // per the one-fade-authority rule) at any camera anchor. Fraction
        // (0.5) picked so the arc's drawn extent clears the transferArc
        // window's 10px floor with headroom at typical Earth-fit zoom
        // (verified in-browser: ~19px vs. the 10px floor, up from ~4-8px
        // with smaller fractions/the old R*20 fallback).
        const mo2 = PROG_MOON_ORBITS[body];
        const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 1;
        return mo2 ? Math.max(R * 2, mo2.r * 0.5) : R * 20; // schematic SOI-edge radius, not a physical Hill-sphere calc
      }
    }
    return null;
  }
  if (o.body !== body) return null;
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  if (o.type === 'surface') return R;
  const peri = o.perigee ?? o.apogee ?? 0, apo = o.apogee ?? o.perigee ?? 0;
  return R + (peri + apo) / 2; // transfer endpoints use mean radius as departure/arrival point
}

// Schematic angle for a planet in the Sun frame, matching the OLD sun-scene
// layout (index order in PROG_HELIO_R, spread evenly) — kept in sync so
// transfer arcs originate at the visually-drawn ring position. NOTE: this is
// ONLY used for interplanetary transfer arc rotation, not for the planet's
// actual drawn position any more (that now comes from progBodyWorldPos /
// progBodyAngleAt, which uses the SAME schematic spread as theta0 for bodies
// without porkchop-calibrated angles — see 360's PROG_BODY_KINEMATICS).
function _trajPlanetAngle(body) {
  const bodies = Object.keys(PROG_HELIO_R);
  const i = bodies.indexOf(body);
  if (i < 0) return 0;
  return (i / bodies.length) * 360 - 90;
}

// ── C1a: view time (kept) ──────────────────────────────────────────────────
// Seconds-since-epoch used to place body glyphs. Mirrors the state panel's
// "state AS OF this event" semantics (_missionSelectedEventSnapshotEntry,
// 570): selected event's post-event time (metStart + durationUsed), else
// mission end (m._metTotal), else 0. Guards NaN/undefined.
function _trajViewTime(m) {
  if (!m) return 0;
  const sel = (typeof _missionSelectedEventSnapshotEntry === 'function') ? _missionSelectedEventSnapshotEntry(m) : null;
  if (sel && sel.entry) {
    const ms = sel.entry.metStart, du = sel.entry.durationUsed;
    if (typeof ms === 'number' && !isNaN(ms)) {
      const t = ms + (typeof du === 'number' && !isNaN(du) ? du : 0);
      if (!isNaN(t)) return t;
    }
  }
  if (typeof m._metTotal === 'number' && !isNaN(m._metTotal)) return m._metTotal;
  return 0;
}

// ── SVG builder (WORLD layer — geometry only, ONE PASS, C1b) ──────────────
// The single render function replacing _trajSunSceneSVG/_trajBodySceneSVG/
// _trajSceneGeomSVG. Draws EVERY body (Sun, planets, moons) each call,
// positioned by progBodyWorldPos(body, viewTime) minus the camera's floating
// origin (_trajCamCenterKm), plus every body's embedded mission content.
// `cam` = {anchorBody, relOffsetKm, wKm}; `zoom` = _TRAJ_VB/cam.wKm;
// `rect` = the world svg's measured bounding rect (for viewport-diagonal
// culling — falls back to a square guess pre-mount).
function _trajWorldSVG(m, cam, zoom, rect) {
  const viewT = _trajViewTime(m);
  const calib = _trajGetPlanetCalibration(m);
  const overrides = calib.overrides;
  const camCenter = _trajCamCenterKm(cam, viewT, overrides); // heliocentric km — the ONE floating-origin subtraction point
  const rectW = (rect && rect.width > 0) ? rect.width : 400, rectH = (rect && rect.height > 0) ? rect.height : 400;
  const viewportDiagPx = Math.sqrt(rectW * rectW + rectH * rectH);

  // World-to-render: heliocentric km -> render-space km (floating origin).
  const toRender = (worldX, worldY) => ({ x: worldX - camCenter.x, y: worldY - camCenter.y });

  let out = '';

  // ── Sun (drawn unless off-screen — the heliocentric origin) ───────────────
  {
    const p = toRender(0, 0);
    if (!_trajCullPositionOffscreen(p.x, p.y, zoom, viewportDiagPx)) {
      const sunScale = _trajLocalScaleFor('Sun', m);
      out += _trajGlyph(p.x, p.y, _trajBodyPxR(6, zoom), _trajBodyColor('Sun'), 'Sun', zoom, cam.anchorBody === 'Sun');
      out += _trajBodyFrameContent('Sun', m, sunScale, zoom, p.x, p.y, viewportDiagPx, viewT, overrides, calib);
    }
  }

  // ── planets: heliocentric ring + glyph, each with its own local scale for
  // embedded mission content (its own orbit rings etc. — same concept as the
  // old per-scene `scale`, just computed per body instead of per active scene) ──
  Object.keys(PROG_HELIO_R).forEach(body => {
    const worldR = PROG_HELIO_R[body];
    const ringScreenR = worldR * zoom; // ring radius in px, at the SUN's floating origin — culling uses this
    const sunP = toRender(0, 0);
    const sunOffscreen = _trajCullPositionOffscreen(sunP.x, sunP.y, zoom, viewportDiagPx);
    const ringAlpha = _trajLodOpacity(ringScreenR, _TRAJ_LOD_WIN.heliocentricRing[0], _trajWindowHi(_TRAJ_LOD_WIN.heliocentricRing[1], viewportDiagPx));
    if (!sunOffscreen && !_trajCullRingByDiagonal(ringScreenR, viewportDiagPx) && ringAlpha > 0) {
      out += `<circle cx="${sunP.x.toFixed(2)}" cy="${sunP.y.toFixed(2)}" r="${worldR.toFixed(2)}" fill="none" stroke="${_trajBodyColor(body)}" stroke-width="0.6" opacity="${(0.55 * ringAlpha).toFixed(3)}" vector-effect="non-scaling-stroke"/>`;
    }
    const wp = progBodyWorldPosCalibrated(body, viewT, overrides);
    const p = toRender(wp.x, wp.y);
    if (_trajCullPositionOffscreen(p.x, p.y, zoom, viewportDiagPx)) return;
    const trueR = 3; // schematic glyph radius, world units == km at scale=1 for the heliocentric ring layer
    // "Far representation" (C2 — fixes the C1b handoff): the body's own disc
    // never fades (existing clamp+true-scale invariant, unchanged); its NAME
    // label is force-eligible (always shows, size-gate bypassed) whenever the
    // disc has hit its min-px clamp — i.e. we're zoomed out far enough
    // relative to THIS body that its true-scale disc would be imperceptible,
    // so it's rendered as glyph+name instead. This is per-body (not tied to
    // the ring's own fade window) specifically so ALL 9 planets keep their
    // names at full solar zoom-out even though their heliocentric rings span
    // wildly different radii (Mercury's ring is tiny next to Neptune's, but
    // both bodies are equally "far" from the camera at that zoom).
    const forceLabel = (trueR * zoom) < _TRAJ_MIN_BODY_PX;
    if (!_trajCullByExtent(_trajBodyPxR(trueR, zoom) * zoom)) {
      out += _trajGlyph(p.x, p.y, _trajBodyPxR(trueR, zoom), _trajBodyColor(body), body, zoom, cam.anchorBody === body, forceLabel);
    }
    // Zone-of-influence content (this body's moons + mission content) fades
    // IN as the body's own neighborhood extent exceeds ~30px — a single fade
    // authority for everything embedded at this body's position (moons drawn
    // in the next pass check the SAME gate via zoiAlpha, never multiplying a
    // second window on top — one fade authority per feature, per the brief).
    const localScale = _trajLocalScaleFor(body, m);
    const neighborhoodExtentPx = _trajBodyPxR(trueR, zoom) * zoom; // conservative floor; refined per-body below via moon ring extents
    const zoiAlpha = _trajLodOpacity(Math.max(neighborhoodExtentPx, _trajBodyNeighborhoodPx(body, zoom)), _TRAJ_LOD_WIN.zoneOfInfluence[0], Infinity);
    if (zoiAlpha > 0) {
      const contentSvg = _trajBodyFrameContent(body, m, localScale, zoom, p.x, p.y, viewportDiagPx, viewT, overrides, calib);
      out += zoiAlpha < 1 ? `<g opacity="${zoiAlpha.toFixed(3)}">${contentSvg}</g>` : contentSvg;
    }
  });

  // ── moons: ring around parent + glyph, embedded mission content ───────────
  Object.entries(PROG_MOON_ORBITS || {}).forEach(([name, mo]) => {
    // Parent position resolves through the SAME calibrated path (moons move
    // WITH a calibrated parent — see progBodyWorldPosCalibrated's recursion).
    const parentWP = progBodyWorldPosCalibrated(mo.parent, viewT, overrides);
    const parentP = toRender(parentWP.x, parentWP.y);
    const parentOffscreen = _trajCullPositionOffscreen(parentP.x, parentP.y, zoom, viewportDiagPx);
    const ringScreenR = mo.r * zoom;
    // Moon ring is part of its PARENT's zone-of-influence — inherits the
    // parent's zoiAlpha (single fade authority: the moon ring is a CHILD of
    // the parent's neighborhood, so it does NOT also apply its own window on
    // top; see _TRAJ_LOD_WIN.moonRing used only for the moon's OWN mission
    // content children, analogous one level down).
    const parentZoiAlpha = _trajLodOpacity(Math.max(ringScreenR, _trajBodyPxR(3, zoom) * zoom), _TRAJ_LOD_WIN.zoneOfInfluence[0], Infinity);
    if (!parentOffscreen && !_trajCullRingByDiagonal(ringScreenR, viewportDiagPx) && !_trajCullByExtent(ringScreenR) && parentZoiAlpha > 0) {
      out += `<circle cx="${parentP.x.toFixed(2)}" cy="${parentP.y.toFixed(2)}" r="${mo.r.toFixed(2)}" fill="none" stroke="${_trajBodyColor(name)}" stroke-width="0.6" opacity="${(0.55 * parentZoiAlpha).toFixed(3)}" vector-effect="non-scaling-stroke"/>`;
    }
    if (parentZoiAlpha <= 0) return; // moon (and its content) hidden with its parent's ZOI — no separate cull needed
    const wp = progBodyWorldPosCalibrated(name, viewT, overrides); // moon's own angle unaffected; parent input flows through
    const p = toRender(wp.x, wp.y);
    if (_trajCullPositionOffscreen(p.x, p.y, zoom, viewportDiagPx)) return;
    const trueR = 3;
    if (!_trajCullByExtent(_trajBodyPxR(trueR, zoom) * zoom)) {
      const glyphSvg = _trajGlyph(p.x, p.y, _trajBodyPxR(trueR, zoom), _trajBodyColor(name), name, zoom, cam.anchorBody === name, false);
      out += parentZoiAlpha < 1 ? `<g opacity="${parentZoiAlpha.toFixed(3)}">${glyphSvg}</g>` : glyphSvg;
    }
    const localScale = _trajLocalScaleFor(name, m);
    const contentSvg = _trajBodyFrameContent(name, m, localScale, zoom, p.x, p.y, viewportDiagPx, viewT, overrides, calib);
    out += parentZoiAlpha < 1 ? `<g opacity="${parentZoiAlpha.toFixed(3)}">${contentSvg}</g>` : contentSvg;
  });

  return out;
}

// Rough px extent of a body's own moon-ring neighborhood (max moon ring
// radius at the current zoom), used to feed the zone-of-influence fade gate
// — a body with moons "opens up" once ITS OWN moons' rings are big enough to
// be worth drawing, not merely once its own disc clears 30px.
function _trajBodyNeighborhoodPx(body, zoom) {
  const moons = _trajMoonsOf(body);
  if (!moons.length) return 0;
  return Math.max(...moons.map(mo => mo.r)) * (zoom || 1);
}

// Local px-per-km scale for a body's embedded mission content (its own orbit
// rings / transfer arcs), independent of the camera zoom. This mirrors the
// OLD per-scene `_trajFitScale` concept: content is drawn true-scale-in-km at
// scale=1 relative to the world (the camera zoom does the rest), EXCEPT that
// small bodies (planets/moons with real orbit rings measured in hundreds to
// tens-of-thousands of km) need their mission content legible without
// requiring the user to zoom to literal 1:1 — so each body gets a fixed
// local multiplier sized to its own characteristic scale (its radius), same
// spirit as the old fit-to-content scale but now purely a per-body constant
// since there's no single "active scene" to fit anymrore. Chosen so a LEO
// ring (a few hundred km above a body of a few thousand km radius) renders
// at a legible fraction of that body's disc when the camera is zoomed to
// frame the body itself.
function _trajLocalScaleFor(body, m) {
  return 1; // true-scale km; camera zoom alone determines rendered size (matches "linear true scale — no log compression of distances" invariant)
}

// ── glyph + px-clamp helpers (world layer) ────────────────────────────────
// Body/planet glyph: disc only (world layer). `cx,cy` are RENDER-SPACE
// (floating-origin) coords; `r` is a WORLD-space (km) radius as computed by
// the caller; screen-space min-visibility clamp is applied by the caller via
// _trajBodyPxR (so the clamp only bites when zoomed OUT — zooming in lets
// the true-scale disc grow past the clamp). Label registration (overlay
// layer) happens alongside, keyed to the same render-space anchor.
// `forceLabel` (C2 "far representation" fix): when true, the label is
// registered with selected:true semantics for its SIZE gate (always
// eligible) regardless of the disc's screenSize — this is how all 9 planet
// names stay visible at full solar zoom-out once their neighborhood content
// has faded away and they're reduced to glyph+name. The disc itself is
// UNAFFECTED (still true-scale/min-clamped as before) — this only changes
// whether the NAME survives the size gate; collision resolution still runs
// normally (so crowded labels at extreme zoom still de-duplicate).
function _trajGlyph(cx, cy, r, color, label, zoom, isFocus, forceLabel) {
  const z = zoom || 1;
  _trajRegisterLabel(cx, cy - r, [{ text: label, dy: -4, fontPx: 10, color: 'var(--nm-label)' }], 'body',
    { screenSize: r * z, minSize: _TRAJ_LOD_BODY_MIN, selected: !!isFocus || !!forceLabel });
  return `<g>
    <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r}" fill="${color}" stroke="var(--border-bright)" stroke-width="0.5" vector-effect="non-scaling-stroke"/>
  </g>`;
}

// Minimum on-screen disc radius (px) a body should ever render at, converted
// to WORLD-space svg units by dividing by zoom (so after the viewBox camera's
// zoom, the rendered px is >= _TRAJ_MIN_BODY_PX). This clamp is legitimately
// world-layer: it's a size floor on GEOMETRY (the disc itself), computed from
// the camera's pxPerUnit, not a counter-scaled annotation. True-scale discs
// bigger than this pass through unclamped (e.g. zoomed into LEO, Earth's limb
// stays huge and real).
const _TRAJ_MIN_BODY_PX = 6;
function _trajBodyPxR(trueR, zoom) {
  const z = zoom || 1;
  return Math.max(trueR, _TRAJ_MIN_BODY_PX / z);
}

// Which body-frame(s) hold content (an orbit ring or a transfer leg) tied to
// the given authored event index. Used for the "event at BODY — fly to" hint
// chip when the selected event's content lives somewhere other than the
// camera's current anchor.
function _trajFramesForAuthIdx(m, authIdx) {
  if (authIdx == null) return [];
  const frames = _trajGetExtraction(m);
  const hits = [];
  Object.keys(frames).forEach(frameId => {
    const sc = frames[frameId];
    const hasOrbit = [...sc.orbits.values()].some(rec => rec.firstAuthIdx === authIdx);
    const hasLeg = sc.legs.some(leg => leg.authIdx === authIdx);
    if (hasOrbit || hasLeg) hits.push(frameId);
  });
  return hits;
}

// Focus-bar grouping: bodies with moons render as a button + a flyout
// listing the parent and its moons (first-class nav path for Moon/Titan);
// moonless bodies (+Sun) render as plain buttons. Unchanged UX from before
// C1b — only the underlying action (trajSetFocus) now flies the camera
// instead of switching a scene.
function _trajFocusGroups() {
  const bodies = [{ id: 'Sun', label: 'Sun' }, ...Object.keys(PROG_HELIO_R).map(b => ({ id: b, label: b }))];
  return bodies.map(s => ({ scene: s, moons: s.id === 'Sun' ? [] : _trajMoonsOf(s.id) }));
}

// ── top-level view builder (called from missionRenderDetail via 570's hook) ──
function _missionTrajViewHTML(m) {
  const id = m.missionId;
  _trajExtractionCache = { missionId: null, data: null }; // force fresh extraction each render (mission log may have changed)
  _trajCalibrationCache = { missionId: null, data: null }; // planet-phase calibration depends on extraction, invalidate together

  // ── camera: default-anchor-Earth fit-to-content on first access for this mission ──
  let cam = _trajCamByMission[id];
  if (!cam) { cam = { anchorBody: 'Earth', relOffsetKm: { x: 0, y: 0 }, wKm: _trajFitWKmForBody('Earth', m) }; _trajCamByMission[id] = cam; }
  const zoom = _trajZoomFromCam(cam);
  const focus = cam.anchorBody;

  // Grouped focus bar: moonless bodies (+Sun) render as plain buttons; bodies
  // with moons render as a button + a small flyout dropdown listing the
  // parent and its moons, so Moon/Titan scenes get first-class navigation.
  const groups = _trajFocusGroups();
  const focusSeg = groups.map(g => {
    const sceneId = g.scene.id, label = g.scene.label;
    if (!g.moons.length) {
      return `<button class="${focus === sceneId ? 'active' : ''}" onclick="trajSetFocus('${id}','${sceneId}')">${label}</button>`;
    }
    const memberIds = [sceneId, ...g.moons.map(mo => mo.name)];
    const groupActive = memberIds.includes(focus);
    const isOpen = _trajFlyoutOpenFor === (id + '|' + sceneId);
    const items = memberIds.map(mid => {
      const mLabel = mid === sceneId ? label : mid;
      const active = focus === mid;
      return `<button class="traj-flyout-item${active ? ' active' : ''}" onclick="event.stopPropagation();trajSetFocus('${id}','${mid}');_trajCloseFlyout();">${mLabel}</button>`;
    }).join('');
    return `<div class="traj-flyout-wrap">
      <button class="${groupActive ? 'active' : ''}" onclick="event.stopPropagation();_trajToggleFlyout('${id}','${sceneId}')">${label} &#x25BE;</button>
      <div class="traj-flyout${isOpen ? ' open' : ''}">${items}</div>
    </div>`;
  }).join('');

  // WORLD-layer geometry (resets + fills the label registry as a side effect;
  // overlay resolution happens after mount in _missionTrajAfterRender, once
  // the container's real px rect is known — the initial paint here can't
  // resolve overlay px yet since the svg isn't measurable before mount).
  _trajResetLabels();
  const svgInner = _trajWorldSVG(m, cam, zoom, null);
  const calibActive = _trajGetPlanetCalibration(m).active;
  const h = cam.wKm; // square default (aspect corrected post-mount; initial paint assumes 1:1 until measured)
  const viewBox = `${(-cam.wKm / 2).toFixed(3)} ${(-h / 2).toFixed(3)} ${cam.wKm.toFixed(3)} ${h.toFixed(3)}`;

  // Selection hint chip: if the selected event's content lives at a body
  // frame other than the camera's current anchor, offer a one-click fly-to
  // instead of auto-flying (per the O1-c brief — don't yank the user's view).
  const selAuthIdx = _trajSelectedAuthIdx(m);
  let hintChip = '';
  if (selAuthIdx != null) {
    const hitFrames = _trajFramesForAuthIdx(m, selAuthIdx).filter(s => s !== focus);
    if (hitFrames.length) {
      const target = hitFrames[0];
      hintChip = `<div class="traj-hint-chip" onclick="trajSetFocus('${id}','${target}')" title="Fly to ${target}">fly to ${target.toUpperCase()}</div>`;
    }
  }

  return `
    <div class="traj-wrap" data-mid="${id}">
      <div class="traj-toolbar">
        <div class="seg traj-focus-seg">${focusSeg}</div>
        <button class="act-btn" onclick="trajResetView('${id}')" title="Reset zoom/pan">&#x21BA; Reset</button>
      </div>
      <div class="traj-canvas" onwheel="trajWheelZoom(event,'${id}')"
           onmousedown="trajPanStart(event,'${id}')" onmousemove="trajPanMove(event)"
           onmouseup="trajPanEnd()" onmouseleave="trajPanEnd()">
        ${hintChip}
        <svg class="traj-svg" data-mid="${id}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">
          <g class="traj-scene" data-mid="${id}">
            ${svgInner}
          </g>
        </svg>
        <svg class="traj-overlay" data-mid="${id}" preserveAspectRatio="none"></svg>
      </div>
      <div class="traj-footer">coplanar view — inclination/LAN annotated, not drawn &middot; planet positions schematic, body sizes clamped for visibility${calibActive ? ' &middot; planet phases calibrated to mission transfers' : ''}</div>
    </div>`;
}

// Focus-flyout open state: 'missionId|sceneId' of the currently-open dropdown,
// or null. Single global (only one flyout can be open at a time), closed on
// outside click same as the File menu pattern (mcc-export-menu).
let _trajFlyoutOpenFor = null;
function _trajToggleFlyout(id, sceneId) {
  const key = id + '|' + sceneId;
  if (_trajFlyoutOpenFor === key) { _trajCloseFlyout(); return; }
  _trajFlyoutOpenFor = key;
  document.addEventListener('click', _trajFlyoutOutsideClick);
  missionRenderDetail();
}
function _trajCloseFlyout() {
  if (_trajFlyoutOpenFor == null) return;
  _trajFlyoutOpenFor = null;
  document.removeEventListener('click', _trajFlyoutOutsideClick);
  missionRenderDetail();
}
function _trajFlyoutOutsideClick(e) {
  if (e.target.closest && e.target.closest('.traj-flyout-wrap')) return;
  _trajCloseFlyout();
}

// Called by 570 right after render (mirrors _missionCenterNmEarth). Sizes the
// overlay svg to the container's real px rect, fixes the world svg's viewBox
// aspect ratio (the initial HTML string assumes a square box since the
// container size isn't known until after mount), resolves the overlay
// symbology now that px are real px, and wires a ResizeObserver so both
// layers stay honest across container resizes (band-view split resize,
// window resize, etc.) — required for the "world svg rect == container rect
// AND overlay rect == world rect, at all zoom levels and all container
// sizes" invariant.
let _trajResizeObservers = {};
function _missionTrajAfterRender(m) {
  const id = m.missionId;
  const svgEl = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"] svg.traj-svg`);
  const overlayEl = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"] svg.traj-overlay`);
  if (!svgEl) return;
  const sync = () => {
    const cam = _trajCamByMission[id];
    if (!cam) return;
    const rect = svgEl.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    const aspect = rect.height / rect.width;
    const h = cam.wKm * aspect;
    svgEl.setAttribute('viewBox', `${(-cam.wKm / 2).toFixed(3)} ${(-h / 2).toFixed(3)} ${cam.wKm.toFixed(3)} ${h.toFixed(3)}`);
    const sceneEl = svgEl.querySelector('g.traj-scene');
    if (sceneEl && typeof _missions !== 'undefined') {
      const mm = (_missions || []).find(x => x.missionId === id);
      const zoom = _trajZoomFromCam(cam);
      _trajResetLabels();
      _trajExtractionCache = { missionId: null, data: null };
      _trajCalibrationCache = { missionId: null, data: null };
      sceneEl.innerHTML = _trajWorldSVG(mm, cam, zoom, rect);
      if (overlayEl) {
        overlayEl.setAttribute('width', rect.width);
        overlayEl.setAttribute('height', rect.height);
        overlayEl.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
        const renderCam = { cx: 0, cy: 0, w: cam.wKm };
        overlayEl.innerHTML = _trajResolveLabels(renderCam, rect);
      }
    }
  };
  sync();
  if (_trajResizeObservers[id]) { try { _trajResizeObservers[id].disconnect(); } catch (e) {} }
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => sync());
    ro.observe(svgEl);
    _trajResizeObservers[id] = ro;
  }
}
