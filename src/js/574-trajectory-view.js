
// ─── TRAJECTORY VIEW — Phase O1-a: framework + static solar system ──────────
// Third mission view: a 2D true-geometry orbital map ("2D KSP/SFS-like"),
// restrained blueprint style (thin strokes, mono labels, theme colors — NOT
// cartoon). This phase builds the canvas, scenes, and static content only.
// Mission orbits / transfer arcs are injected by a LATER run through the
// documented extension point _trajSceneContent() at the bottom of this file.
//
// Module-local, session-only state (NOT authored — never touches m.log or
// autosave; focus/zoom reset on reload, same spirit as _missionNmZoom but
// kept separate per mission id so switching missions doesn't fight itself).
let _trajFocusByMission = {};   // missionId -> body name ('SUN','Earth','Moon',...)
// Camera model (viewBox-camera refactor, O2-fix): the <svg> ALWAYS fills its
// container (width/height:100%) — zoom/pan are expressed purely as viewBox
// mutations, never CSS element sizing, so true-scale content can never be
// clipped by shrinking the svg element below the container (the old bug).
// Camera state per mission: { cx, cy, w } — world-unit (scene `scale`-space,
// same space geometry is already drawn in) center + width; height is derived
// from the container's aspect ratio at render time so the viewBox always
// exactly matches the rendered box (no letterboxing, no overflow).
// `zoom` (used throughout for LOD/symbology/counter-scale) is redefined as
// _TRAJ_VB / cam.w — i.e. "how much more zoomed in than the default fit" —
// which preserves every existing zoom>1-means-closer semantic even though
// the SVG's CSS size no longer changes with zoom.
let _trajCamByMission   = {};   // missionId -> {cx,cy,w}

// Fixed reference "world box" size (viewBox units at zoom=1, i.e. the default
// fit-to-content window). Declared here (not further down where the SVG
// builders live) because the camera helpers above need it immediately.
const _TRAJ_VB = 400;

const _TRAJ_ZMIN = 0.15, _TRAJ_ZMAX = 20; // camera w = _TRAJ_VB/zoom, clamped to [_TRAJ_VB/_TRAJ_ZMAX, _TRAJ_VB/_TRAJ_ZMIN]

// ── body -> chrome color mapping ─────────────────────────────────────────
// Reuses the node-map's --nm-* seeds so the trajectory view stays in the same
// theme family as Orbit Map rather than inventing a new palette:
//   Earth              -> --nm-earth
//   Moon, Titan (moons) -> --nm-lunar
//   every other body    -> --nm-interp
//   Sun glyph            -> --warn (closest existing "star/energy" seed)
function _trajBodyColor(body) {
  if (body === 'SUN') return 'var(--warn)';
  if (body === 'Earth') return 'var(--nm-earth)';
  if (PROG_MOON_ORBITS && PROG_MOON_ORBITS[body]) return 'var(--nm-lunar)';
  return 'var(--nm-interp)';
}

// ── scene catalog ────────────────────────────────────────────────────────
// A "scene" is either the Sun (all planets) or a body's local system (the
// body + its moons, if any). Generated from PROG_BODIES / PROG_HELIO_R /
// PROG_MOON_ORBITS so new bodies/moons added to those data tables show up
// here automatically — no hand-listing.
function _trajSceneList() {
  const scenes = [{ id: 'SUN', label: 'Sun' }];
  // Any body with a heliocentric radius is a planet scene.
  Object.keys(PROG_HELIO_R).forEach(b => scenes.push({ id: b, label: b }));
  // Also include bodies that host moons even if (hypothetically) not in
  // PROG_HELIO_R, and always include Earth (has PROG_HELIO_R already).
  Object.values(PROG_MOON_ORBITS || {}).forEach(mo => {
    if (!scenes.find(s => s.id === mo.parent)) scenes.push({ id: mo.parent, label: mo.parent });
  });
  return scenes;
}

function _trajMoonsOf(body) {
  return Object.entries(PROG_MOON_ORBITS || {})
    .filter(([, mo]) => mo.parent === body)
    .map(([name, mo]) => ({ name, r: mo.r }));
}

function _trajFocus(m) { return _trajFocusByMission[m.missionId] || 'Earth'; }

// Camera accessor — lazily fit-to-content on first access for a mission/focus
// (trajSetFocus/trajResetView clear the stored camera so the NEXT render
// re-fits against that scene's actual content extent, computed in
// _missionTrajViewHTML where the scale/extent are already known).
function _trajCam(id) { return _trajCamByMission[id] || { cx: 0, cy: 0, w: _TRAJ_VB }; }
function _trajZoomFromCam(cam) { return _TRAJ_VB / cam.w; }

function trajSetFocus(id, body) {
  _trajFocusByMission[id] = body;
  delete _trajCamByMission[id]; // re-fit to the new scene's content on next render
  missionRenderDetail();
}

function trajResetView(id) {
  delete _trajCamByMission[id]; // re-fit to current scene's content on next render
  missionRenderDetail();
}

// Re-render just the .traj-scene group + update the <svg> viewBox attribute —
// cheap camera-only update path shared by wheel-zoom and pan so neither has to
// rebuild the whole mission panel (matches the previous in-place re-render
// discipline, now operating on viewBox instead of CSS width/height).
function _trajApplyCam(id, cam) {
  _trajCamByMission[id] = cam;
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"]`);
  if (!va) { missionRenderDetail(); return; }
  const svgEl = va.querySelector('svg.traj-svg');
  if (!svgEl) { missionRenderDetail(); return; }
  const rect = svgEl.getBoundingClientRect();
  const aspect = (rect.width > 0 && rect.height > 0) ? (rect.height / rect.width) : 1;
  const h = cam.w * aspect;
  svgEl.setAttribute('viewBox', `${(cam.cx - cam.w / 2).toFixed(3)} ${(cam.cy - h / 2).toFixed(3)} ${cam.w.toFixed(3)} ${h.toFixed(3)}`);
  const sceneEl = svgEl.querySelector('g.traj-scene');
  if (sceneEl && typeof _missions !== 'undefined') {
    const m = (_missions || []).find(mm => mm.missionId === id);
    const focus = _trajFocus({ missionId: id });
    const zoom = _trajZoomFromCam(cam);
    const pxScale = rect.width > 0 ? (rect.width / _TRAJ_VB) : 1;
    sceneEl.removeAttribute('transform'); // pan now lives in the viewBox, not a group transform
    sceneEl.innerHTML = _trajSceneSVG(focus, m, zoom, pxScale);
  }
}

function trajWheelZoom(ev, id) {
  ev.preventDefault();
  const svgEl = (ev.currentTarget.querySelector && ev.currentTarget.querySelector('svg.traj-svg')) || null;
  const cam = _trajCam(id);
  const dir = ev.deltaY < 0 ? 1 : -1;
  const wMin = _TRAJ_VB / _TRAJ_ZMAX, wMax = _TRAJ_VB / _TRAJ_ZMIN;
  const nextW = Math.max(wMin, Math.min(wMax, cam.w * (1 - dir * 0.15)));
  if (nextW === cam.w) return;
  // Zoom about the cursor: convert cursor screen position to world coords
  // under the CURRENT camera, then re-anchor so that same world point stays
  // under the cursor after the width change (standard viewBox zoom-to-point).
  let cx = cam.cx, cy = cam.cy;
  if (svgEl) {
    const rect = svgEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const aspect = rect.height / rect.width;
      const h = cam.w * aspect;
      const fx = (ev.clientX - rect.left) / rect.width;  // 0..1 across the svg
      const fy = (ev.clientY - rect.top) / rect.height;
      const worldX = (cam.cx - cam.w / 2) + fx * cam.w;
      const worldY = (cam.cy - h / 2) + fy * h;
      const nextH = nextW * aspect;
      cx = worldX - (fx - 0.5) * nextW;
      cy = worldY - (fy - 0.5) * nextH;
    }
  }
  _trajApplyCam(id, { cx, cy, w: nextW });
}

let _trajDrag = null;
// Set true when a pan-drag actually moved the pointer (>3px, same threshold as
// the node map's missionNmPanMove) so the click that follows a real drag on an
// interactive arc/marker/ring doesn't also select an event (drag-vs-click
// disambiguation, per the node map / library-browser _didDrag pattern).
let _trajJustDragged = false;
function trajPanStart(ev, id) {
  _trajDrag = { id, x0: ev.clientX, y0: ev.clientY, cam0: Object.assign({}, _trajCam(id)), moved: false, rectW: null, rectH: null };
  const svgEl = ev.currentTarget && ev.currentTarget.querySelector ? ev.currentTarget.querySelector('svg.traj-svg') : null;
  if (svgEl) { const r = svgEl.getBoundingClientRect(); _trajDrag.rectW = r.width; _trajDrag.rectH = r.height; }
  ev.preventDefault();
}
function trajPanMove(ev) {
  if (!_trajDrag) return;
  const dx = ev.clientX - _trajDrag.x0, dy = ev.clientY - _trajDrag.y0;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _trajDrag.moved = true;
  const rectW = _trajDrag.rectW || 400, rectH = _trajDrag.rectH || 400;
  // Screen-px delta -> world-unit delta at the CURRENT camera width (drag
  // pan shifts cx/cy directly, opposite the pointer delta since dragging
  // right should reveal content to the left).
  const worldDx = -dx * (_trajDrag.cam0.w / rectW);
  const aspect = rectH / rectW;
  const worldDy = -dy * (_trajDrag.cam0.w * aspect / rectH);
  const cam = { cx: _trajDrag.cam0.cx + worldDx, cy: _trajDrag.cam0.cy + worldDy, w: _trajDrag.cam0.w };
  _trajCamByMission[_trajDrag.id] = cam;
  const svgEl = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${_trajDrag.id}"] svg.traj-svg`);
  if (svgEl) {
    const h = cam.w * aspect;
    svgEl.setAttribute('viewBox', `${(cam.cx - cam.w / 2).toFixed(3)} ${(cam.cy - h / 2).toFixed(3)} ${cam.w.toFixed(3)} ${h.toFixed(3)}`);
  }
}
function trajPanEnd() {
  if (_trajDrag) _trajJustDragged = _trajDrag.moved;
  _trajDrag = null;
}

// ── O1-b: mission content extraction ─────────────────────────────────────
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
// near a low parking orbit, apo near a moon's orbital radius around `body`) so
// it can be labeled "TLC corridor"-style instead of a raw "185×378000" ring —
// per the O1-c polish brief. Tolerance is generous (2%) since these are
// snapshot-of-the-moment radii, not exact apsides.
function _trajCorridorMoon(body, apo) {
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  const moons = _trajMoonsOf(body);
  for (const mo of moons) {
    if (Math.abs((apo + R) - mo.r) < mo.r * 0.02) return mo.name;
  }
  return null;
}

function _trajOrbitLabel(body, peri, apo) {
  const corridorMoon = _trajCorridorMoon(body, apo);
  if (corridorMoon) return `T${corridorMoon.slice(0, 1).toUpperCase()}C corridor`; // "TLC corridor" for Moon, generalized initial for other moons
  // ORBIT_CATEGORIES (060) is an array of {planet, orbits:[{name,mode,perigee,apogee,...}]}
  // grouped by planet — find this body's group, then match on peri/apo within tolerance
  // for a friendlier label ("LEO 200 km" instead of "200×200").
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

// Which scene (body name, or 'SUN' for interplanetary/heliocentric legs) an
// orbit/transit record belongs in.
function _trajSceneForOrbit(o) {
  if (!o) return null;
  if (o.transit && o.body === 'Sun') return 'SUN';
  if (o.transit) return o.body || 'Earth'; // translunar etc — parent body's local scene
  if (o.escape) return o.body || 'Earth';
  return o.body || 'Earth';
}

// Walk m._expanded snapshots, building per-scene: orbit rings, transfer legs,
// burn markers, and surface events. Cached per mission per render call (cheap
// enough to just recompute; log length is small).
function _trajExtractMission(m) {
  const scenes = {}; // sceneId -> { orbits: Map<key,rec>, legs: [], surface: [] }
  const sceneFor = id => (scenes[id] = scenes[id] || { orbits: new Map(), legs: [], surface: [] });
  const log = (m && m._expanded && m._expanded.length) ? m._expanded : (m ? (m.log || []) : []);
  if (!log.length) return scenes;

  const laneColorFor = (ownerKeys) => {
    if (!ownerKeys || !ownerKeys.length) return null;
    const key = ownerKeys[0];
    const label = (m._ownerLabels && m._ownerLabels[key]) || null;
    if (!label) return null;
    // fallbackIdx doesn't matter for coloring purposes if a custom color is set;
    // otherwise fall back to a stable hash of the label so re-renders don't flicker.
    let idx = 0; for (let i = 0; i < label.length; i++) idx = (idx * 31 + label.charCodeAt(i)) >>> 0;
    return { color: _missionLaneColor(m, label, idx), label };
  };

  const addOrbitRing = (body, peri, apo, ownerKeys, authIdx) => {
    if (body == null || peri == null || apo == null) return null;
    const sceneId = body;
    const sc = sceneFor(sceneId);
    const key = _trajOrbitKey(body, peri, apo);
    const lane = laneColorFor(ownerKeys);
    if (!sc.orbits.has(key)) {
      sc.orbits.set(key, {
        key, body, peri, apo,
        label: _trajOrbitLabel(body, peri, apo),
        colors: new Set(), names: new Set(),
        firstAuthIdx: authIdx != null ? authIdx : null,  // first authored event that put a vehicle in this orbit (for click-to-select)
      });
    }
    const rec = sc.orbits.get(key);
    if (lane) { rec.colors.add(lane.color); rec.names.add(lane.label); }
    if (authIdx != null && rec.firstAuthIdx == null) rec.firstAuthIdx = authIdx;
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
      sceneFor(body).surface.push({ kind: 'launch', body, label: 'Launch', met: e.metStart });
    } else if (e.type === 'REENTER' || e.type === 'RECOVER') {
      const body = (e.orbitAfter && e.orbitAfter.body) || 'Earth';
      sceneFor(body).surface.push({ kind: 'land', body, label: e.type === 'RECOVER' ? 'Recovery' : 'Landing', met: e.metStart });
    }
  });

  // ── transfer legs: MANEUVER events with a from/to node pair ──────────────
  log.forEach(e => {
    if (e.type !== 'MANEUVER' || !e.fromNode || !e.toNode) return;
    const fromN = _missionNmNodeById(e.fromNode), toN = _missionNmNodeById(e.toNode);
    if (!fromN || !toN || !fromN.orbit || !toN.orbit) return;
    const fromO = fromN.orbit, toO = toN.orbit;
    const sceneId = _trajSceneForOrbit(toO) || _trajSceneForOrbit(fromO);
    if (!sceneId) return;
    const lane = laneColorFor(_trajOwnerKeysForManeuver(e));
    const dvUsed = (e.dvDelivered != null ? e.dvDelivered : e.dvRequired) || 0;
    const metArrive = (e.metStart != null && e.durationUsed != null) ? (e.metStart + e.durationUsed) : null;
    const vehName = (_trajOwnerKeysForManeuver(e) && m._ownerLabels && m._ownerLabels[_trajOwnerKeysForManeuver(e)[0]]) || e.activeName || '';
    sceneFor(sceneId).legs.push({
      sceneId, fromO, toO, fromLabel: e.fromLabel || fromN.label, toLabel: e.toLabel || toN.label,
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

  return scenes;
}

// A MANEUVER event doesn't carry v.owners directly — resolve via the active
// vehicle key (activeKey) against m._ownerLabels-keyed owner sets is indirect,
// so instead prefer the destination snapshot's owners for the SAME event (the
// vehicle that just arrived is the one that flew the leg).
function _trajOwnerKeysForManeuver(e) {
  const snap = e.snapshot || [];
  if (!snap.length) return null;
  // the maneuvering vehicle is whichever snapshot entry has the fewest/most recent
  // owners overlap; simplest reliable pick: first non-empty owners array.
  const v = snap.find(vv => vv.owners && vv.owners.length);
  return v ? v.owners : null;
}

// ── geometry helpers ──────────────────────────────────────────────────────
// True-geometry ellipse for a (peri,apo) orbit around a body of radius R,
// focus at the body center (origin in scene-local coords). Returns SVG-ready
// numbers in KM (caller applies scene `scale`).
//   a       = semi-major axis
//   c       = center-to-focus distance = a - r_peri
//   cx      = -c  (center is on the -x side since periapsis is drawn at +x)
// Periapsis is placed at angle 0 (local +x) by convention; ellipses are drawn
// axis-aligned then rotated by `rotDeg` for schematic orientation variety.
function _trajEllipseGeom(peri, apo, R) {
  const rPeri = R + peri, rApo = R + apo;
  const a = (rPeri + rApo) / 2;
  const b = Math.sqrt(Math.max(0, rPeri * rApo));
  const c = a - rPeri; // signed offset from focus to center along +x
  return { rPeri, rApo, a, b, c };
}

// ── symbology (screen-space) helpers ─────────────────────────────────────
// The scene group (.traj-scene) is drawn true-scale in world (km*scale) units,
// then the WHOLE svg is upscaled by CSS width/height for zoom (viewBox stays
// fixed at _TRAJ_VB — see trajWheelZoom). That means anything drawn directly
// in world units would grow/shrink with zoom, including text and markers.
// Fix: wrap fixed-size symbology (text, glyphs, burn markers) in a group that
// translates to its world anchor, then counter-scales by 1/zoom so its
// on-screen pixel size stays constant. `zoom` defaults to 1 (static/no-mission
// contexts, and the mini orbit-diagram, never scale past 1).
// `_trajRenderPxScale` = (rendered container px) / _TRAJ_VB, set once per
// render call (see _trajSceneSVG) from the ACTUAL svg element size. Needed
// because the svg now fills its container at CSS width/height:100% instead
// of being explicitly sized to `_TRAJ_VB * zoom` px — so the world-unit ->
// screen-px ratio (pxPerUnit = containerPx / cam.w) depends on the container's
// real size, not just `zoom`. Counter-scaling by 1/zoom alone (the old
// formula, valid back when containerPx was ALWAYS _TRAJ_VB*zoom) would drift
// off actual screen px whenever the container isn't exactly _TRAJ_VB px wide
// (which is the common case for a viewBox camera). Defaults to 1 (matches old
// exact behavior) for any caller that doesn't go through _trajSceneSVG's
// render-time measurement (e.g. off-screen / not-yet-mounted first paint).
let _trajRenderPxScale = 1;
function _trajFixedG(x, y, zoom, inner, extraAttr) {
  const z = zoom || 1;
  const s = (_trajRenderPxScale / z).toFixed(5);
  return `<g transform="translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${s})"${extraAttr ? ' ' + extraAttr : ''}>${inner}</g>`;
}

// ── LOD (level-of-detail) + label collision ──────────────────────────────
// Feature geometry (rings, arcs, markers, discs) always renders — only TEXT
// annotations are gated/collision-resolved. Per-render registry: every label
// candidate is pushed here (world-space anchor already known to be fixed-px
// on screen via _trajFixedG's counter-scale) instead of being inlined
// directly, then _trajResolveLabels() runs LOD thresholds + a greedy bbox
// collision pass and returns the final <text>+plate markup for all winners.
// Reset at the top of every top-level scene render (_trajSceneSVG callers).
let _trajLabelRegistry = [];
function _trajResetLabels() { _trajLabelRegistry = []; }

// Priority order (higher wins collisions): selected-event > burn > orbit > body > zone.
const _TRAJ_LOD_PRI = { selected: 5, burn: 4, orbit: 3, body: 2, zone: 1 };

// Rough monospace glyph width in px at a given font-size (var(--mono) is a
// fixed-width face; ~0.62em per character is a safe estimate for JetBrains
// Mono-style fonts — used only for collision bbox sizing, not layout).
function _trajTextWidthPx(text, fontPx) { return (text || '').length * fontPx * 0.62; }

// Register a label candidate. `x,y` = world-space anchor (pre-zoom svg units,
// same space _trajFixedG anchors to). `screenSize` = the rendered on-screen
// px size of the PARENT feature (ring radius, disc radius, arc/ring extent)
// used for the size-based LOD gate; pass Infinity for features with no size
// gate (e.g. always-selected). `kind` indexes _TRAJ_LOD_PRI. `lines` is an
// array of {text, dy, fontPx, color} rendered top-to-bottom inside one plate.
function _trajRegisterLabel(x, y, lines, kind, opts) {
  opts = opts || {};
  // Callers compute screenSize as trueWorldRadius * zoom (pure camera zoom) —
  // correct back when containerPx == _TRAJ_VB*zoom always, but under the
  // viewBox camera the real on-screen px also depends on the container's
  // actual size (_trajRenderPxScale). Apply that correction once here so
  // every LOD threshold (_TRAJ_LOD_RING_MIN etc, calibrated in real screen
  // px) keeps gating against real screen px instead of camera-zoom-only px.
  const screenSize = (opts.screenSize != null && isFinite(opts.screenSize))
    ? opts.screenSize * _trajRenderPxScale : (opts.screenSize != null ? opts.screenSize : Infinity);
  _trajLabelRegistry.push({ x, y, lines, kind, priority: (opts.selected ? _TRAJ_LOD_PRI.selected : _TRAJ_LOD_PRI[kind]) || 0,
    screenSize, minSize: opts.minSize || 0,
    selected: !!opts.selected, zoom: opts.zoom || 1, anchor: opts.anchor || 'middle' });
}

// LOD + collision resolution: filters by size gate (unless selected — selected
// events always show full annotations per the brief), sorts by priority
// (ties broken by larger screenSize first — bigger features "win" visually),
// then greedily keeps a label only if its screen-space bbox doesn't overlap
// an already-kept label; drops losers outright (simple greedy pass, no force
// layout / leader lines, per the brief). Returns SVG markup string.
function _trajResolveLabels() {
  // Collision bboxes are computed in SCREEN-px space (world anchor * zoom),
  // matching what actually lands on screen: the SVG's CSS width/height scales
  // by `zoom` while _trajFixedG counter-scales each label's own content by
  // 1/zoom, so a label's rendered pixel SIZE is constant across zoom — but
  // its anchor POSITION still moves with zoom (world_px * zoom), same as
  // every other feature in the scene. Comparing raw world-unit anchors
  // without the zoom multiplier collapses labels together as you zoom out
  // (they visually converge toward the scene origin) even though their fixed
  // on-screen text size stays the same, producing false negatives (missed
  // overlaps) at zoom < 1. Font sizes (fontPx) are already screen-px by
  // design and need no further scaling.
  const cands = _trajLabelRegistry.filter(c => c.selected || c.screenSize >= c.minSize);
  cands.sort((a, b) => (b.priority - a.priority) || (b.screenSize - a.screenSize));
  const kept = [];
  const overlaps = (a, b) => !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1);
  let out = '';
  cands.forEach(c => {
    const z = c.zoom || 1;
    // Screen-px anchor = world anchor * pxPerUnit, where pxPerUnit = zoom *
    // _trajRenderPxScale (see _trajFixedG's comment for the derivation) — NOT
    // just `zoom` alone, since the container is no longer guaranteed to be
    // _TRAJ_VB px wide under the viewBox camera.
    const pxPerUnit = z * _trajRenderPxScale;
    const sx = c.x * pxPerUnit, sy = c.y * pxPerUnit; // screen-px anchor
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
    const plateX = sx - plateW / 2, plateY = by1 - 1;
    const textLines = c.lines.map(l => `<text x="0" y="${l.dy.toFixed(2)}" text-anchor="${c.anchor}" font-family="var(--mono)" font-size="${l.fontPx}" fill="${l.color}">${l.text}</text>`).join('');
    const plate = `<rect x="${(plateX - sx).toFixed(2)}" y="${(plateY - sy).toFixed(2)}" width="${plateW.toFixed(2)}" height="${plateH.toFixed(2)}" fill="var(--panel-tint-plate)" rx="2"/>`;
    out += _trajFixedG(c.x, c.y, z, plate + textLines);
  });
  return out;
}

// LOD size thresholds (rendered on-screen px, i.e. world-svg-units * zoom),
// per the brief: ring label >=40px ring radius; body label disc>=10px OR
// scene focus; burn text >=60px parent arc/ring extent OR selected.
const _TRAJ_LOD_RING_MIN = 40, _TRAJ_LOD_BODY_MIN = 10, _TRAJ_LOD_BURN_MIN = 60;

function _trajRingSVG(rec, body, scale, color, opts) {
  opts = opts || {};
  const zoom = opts.zoom || 1;
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  const g = _trajEllipseGeom(rec.peri, rec.apo, R);
  const isCircle = Math.abs(rec.apo - rec.peri) < Math.max(1, R * 0.001);
  const emphasized = !!opts.emphasized;
  const strokeColor = emphasized ? 'var(--accent)' : (color || (rec.colors.size === 1 ? [...rec.colors][0] : 'var(--accent)'));
  const strokeW = emphasized ? 1.4 : 0.7;
  const opacity = emphasized ? 1 : 0.85;
  const names = [...rec.names].join(', ');
  const title = `${names ? names + ' — ' : ''}${rec.label}`;
  const clickAttr = opts.authIdx != null ? ` style="cursor:pointer" onclick="_trajSelectEventFromView('${opts.missionId}',${opts.authIdx})"` : '';
  // loiter badge: placed just below the ring label, at the ellipse center's x
  // (a legible spot regardless of eccentricity, not tied to a specific apsis).
  const coastTxt = rec.coast && rec.coast.length
    ? `&#x27F3; ${Math.round(rec.coast.reduce((s, c) => s + (c.days || 0), 0))}d` : null;
  if (isCircle) {
    const r = ((rec.peri + rec.apo) / 2 + R) * scale;
    const hitArea = opts.authIdx != null ? `<circle cx="0" cy="0" r="${r.toFixed(2)}" fill="none" stroke="transparent" stroke-width="9"${clickAttr}/>` : '';
    const screenSize = r * zoom;
    const lines = [{ text: rec.label, dy: -4, fontPx: 10.5, color: 'var(--nm-label)' }];
    _trajRegisterLabel(0, -r, lines, 'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, zoom });
    if (coastTxt) _trajRegisterLabel(-g.c * scale, -6, [{ text: coastTxt, dy: 0, fontPx: 10, color: 'var(--nm-label)' }], 'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, zoom });
    return `<g${clickAttr}>
      <circle cx="0" cy="0" r="${r.toFixed(2)}" fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" opacity="${opacity}" vector-effect="non-scaling-stroke"><title>${title}</title></circle>
      ${hitArea}
    </g>`;
  }
  const cx = -g.c * scale, cy = 0, rx = g.a * scale, ry = g.b * scale;
  const hitArea = opts.authIdx != null ? `<ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="none" stroke="transparent" stroke-width="9"${clickAttr}/>` : '';
  const screenSize = Math.max(rx, ry) * zoom;
  const lines = [{ text: rec.label, dy: -4, fontPx: 10.5, color: 'var(--nm-label)' }];
  _trajRegisterLabel(cx, cy - ry, lines, 'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, zoom });
  if (coastTxt) _trajRegisterLabel(cx, -6, [{ text: coastTxt, dy: 0, fontPx: 10, color: 'var(--nm-label)' }], 'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, zoom });
  return `<g${clickAttr}>
    <ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" opacity="${opacity}" vector-effect="non-scaling-stroke"><title>${title}</title></ellipse>
    ${hitArea}
  </g>`;
}

// Half-ellipse Hohmann transfer arc between r1 (departure) and r2 (arrival),
// both body-centered radii (R already included). Drawn as an SVG elliptical
// arc path from periapsis to apoapsis (or vice versa), at a given rotation.
function _trajTransferArcPath(r1, r2, scale, rotDeg) {
  const rPeri = Math.min(r1, r2), rApo = Math.max(r1, r2);
  const a = (rPeri + rApo) / 2, b = Math.sqrt(Math.max(0, rPeri * rApo)), c = a - rPeri;
  const rot = rotDeg || 0;
  const rad = rot * Math.PI / 180;
  const rotp = (x, y) => ({ x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) });
  // local (unrotated) ellipse centered at (c,0)*scale, periapsis at local (rPeri,0), apoapsis at local (-rApo,0)
  const p1l = { x: rPeri * scale, y: 0 };
  const p2l = { x: -rApo * scale, y: 0 };
  const p1 = rotp(p1l.x, p1l.y), p2 = rotp(p2l.x, p2l.y);
  const rx = (a * scale).toFixed(2), ry = (b * scale).toFixed(2);
  const rotDegAttr = rot.toFixed(1);
  // half-ellipse: large-arc-flag 0, sweep depends on orientation but 0/1 both draw
  // a half; pick 1 for a consistent "upper" half visually.
  return { d: `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${rx} ${ry} ${rotDegAttr} 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
           depX: p1.x, depY: p1.y, arrX: p2.x, arrY: p2.y };
}

function _trajBurnMarker(x, y, dir, dvText, metText, opts) {
  opts = opts || {};
  const zoom = opts.zoom || 1;
  const glyph = dir === 'up' ? '▲' : '▼';
  const emphasized = !!opts.emphasized;
  const strokeColor = emphasized ? 'var(--accent)' : 'var(--accent2)';
  const strokeW = emphasized ? 1.3 : 0.8;
  const textColor = emphasized ? 'var(--accent)' : 'var(--accent2)';
  const clickAttr = opts.authIdx != null ? ` style="cursor:pointer" onclick="event.stopPropagation();_trajSelectEventFromView('${opts.missionId}',${opts.authIdx})"` : '';
  const titleTxt = opts.title || '';
  // Marker dot + hit area always render (geometry, not annotation). The
  // dv/MET text block is LOD-gated on the parent arc/ring's rendered extent
  // (opts.screenSize, passed by the caller — the transfer arc's semi-major
  // axis in px) OR shown unconditionally when the event is selected, per the
  // brief. Registered through _trajRegisterLabel so it also participates in
  // the collision pass instead of being inlined unconditionally.
  const inner = `
    <circle cx="0" cy="0" r="${emphasized ? 2.4 : 2}" fill="var(--nm-bg)" stroke="${strokeColor}" stroke-width="${strokeW}"/>
    ${opts.authIdx != null ? `<circle cx="0" cy="0" r="7" fill="transparent"${clickAttr}><title>${titleTxt}</title></circle>` : ''}
  `;
  const dvLabel = dvText ? `${glyph} ${dvText}` : glyph;
  const lines = [{ text: dvLabel, dy: -5, fontPx: 10, color: textColor }];
  if (metText) lines.push({ text: metText, dy: 9, fontPx: 10, color: 'var(--text-dim)' });
  _trajRegisterLabel(x, y, lines, 'burn', { screenSize: opts.screenSize != null ? opts.screenSize : Infinity, minSize: _TRAJ_LOD_BURN_MIN, selected: emphasized, zoom });
  return _trajFixedG(x, y, zoom, inner, clickAttr.trim());
}

// Click handler shared by arcs/markers/rings: selects the AUTHORED event
// (expands its card + rewinds the state panel via existing missionSelectEvent
// behavior). Guarded against firing after a real pan-drag (see trajCanvasDown).
function _trajSelectEventFromView(id, authIdx) {
  if (_trajJustDragged) { _trajJustDragged = false; return; }
  if (typeof missionSelectEvent === 'function') missionSelectEvent(id, authIdx);
}

// Compute the min zoom-worthy extent (max body-centered / heliocentric radius,
// km) of a scene's MISSION content only (orbit apoapses + transfer/legs'
// far endpoint) — used to pick the initial fit-to-content scale, per the
// design brief (static rings beyond remain reachable by zooming out further).
function _trajMissionExtent(scene, m) {
  const scenes = _trajGetExtraction(m);
  const sc = scenes[scene];
  if (!sc) return 0;
  const body = scene === 'SUN' ? null : scene;
  const R = body ? ((PROG_BODIES[body] && PROG_BODIES[body].R) || 0) : 0;
  let maxR = 0;
  sc.orbits.forEach(rec => { maxR = Math.max(maxR, R + rec.apo); });
  sc.legs.forEach(leg => {
    if (scene === 'SUN') {
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

// ── extension point for O1-b ─────────────────────────────────────────────
// Returns extra SVG markup (groups/paths) to overlay on top of the static
// scene for the given scene id ('SUN' or a body name). `scale` is the scene's
// resolved px-per-km factor (already fit to whichever is larger: static
// content or mission content — see _trajSunSceneSVG / _trajBodySceneSVG).
// Authored index of the currently-selected (expanded) event, or null. Single
// source of truth for O1-c emphasis — reads m.log's e._expanded flag, the same
// one missionSelectEvent()/the events panel use, so the two views can't drift.
function _trajSelectedAuthIdx(m) {
  if (!m || !m.log) return null;
  const idx = m.log.findIndex(e => e._expanded);
  return idx >= 0 ? idx : null;
}

// Body-centered periapsis/apoapsis radius (km, including body R) for a
// node-map orbit spec — used only by the redundancy check above (distinct
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

function _trajSceneContent(scene, m, scale, zoom) {
  if (!m) return '';
  const scenes = _trajGetExtraction(m);
  const sc = scenes[scene];
  if (!sc) return '';
  const body = scene === 'SUN' ? null : scene;
  const R = body ? ((PROG_BODIES[body] && PROG_BODIES[body].R) || 0) : 0;
  scale = scale || 1;
  zoom = zoom || 1;
  const id = m.missionId;
  const selAuthIdx = _trajSelectedAuthIdx(m);

  let out = '';

  // orbit rings (skip for SUN scene — heliocentric transit legs are drawn as
  // arcs between the static planet rings, not as a new "orbit" of the Sun)
  if (body) {
    sc.orbits.forEach(rec => {
      const emphasized = selAuthIdx != null && rec.firstAuthIdx === selAuthIdx;
      out += _trajRingSVG(rec, body, scale, rec.colors.size === 1 ? [...rec.colors][0] : null,
        { emphasized, authIdx: rec.firstAuthIdx, missionId: id, zoom });
    });
  }

  // transfer legs
  sc.legs.forEach((leg, li) => {
    const emphasized = selAuthIdx != null && leg.authIdx === selAuthIdx;
    const clickAttr = leg.authIdx != null ? ` style="cursor:pointer" onclick="_trajSelectEventFromView('${id}',${leg.authIdx})"` : '';
    const hoverTitle = `${leg.vehName ? leg.vehName + ' — ' : ''}${leg.fromLabel} → ${leg.toLabel}${leg.dv ? ' &middot; ' + _trajDvText(leg.dv) : ''}${leg.met != null ? ' &middot; ' + _metFmt(leg.met) : ''}`;
    // screenSize (rendered px extent of the arc) is filled in per-branch below
    // once the arc's semi-major axis is known; burn-marker text LOD gates on it.
    const markerOpts = (screenSize) => ({ emphasized, authIdx: leg.authIdx, missionId: id, title: hoverTitle, zoom, screenSize });
    if (scene === 'SUN') {
      const r1 = PROG_HELIO_R[leg.fromO.body] || PROG_HELIO_R[leg.fromLabel] || null;
      const r2 = PROG_HELIO_R[leg.toO.body] || PROG_HELIO_R[leg.toLabel] || null;
      if (r1 == null || r2 == null) return;
      const departAng = _trajPlanetAngle(leg.fromO.body);
      const arc = _trajTransferArcPath(r1, r2, scale, departAng);
      const arcExtentPx = Math.abs(arc.depX - arc.arrX) / 2 * zoom;
      const color = emphasized ? 'var(--accent)' : (leg.color || 'var(--accent2)');
      const strokeW = emphasized ? 1.2 : 0.7;
      const opacity = emphasized ? 1 : 0.8;
      // Sun-scene legs go planet-to-planet — never coincide with a "destination
      // ring" (there isn't one at this scale), so the redundancy rule doesn't
      // apply here; draw as before.
      const hitArea = leg.authIdx != null ? `<path d="${arc.d}" fill="none" stroke="transparent" stroke-width="8"${clickAttr}/>` : '';
      out += `<path d="${arc.d}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-dasharray="2.5,2" opacity="${opacity}" vector-effect="non-scaling-stroke"${clickAttr}><title>${hoverTitle}</title></path>${hitArea}`;
      out += _trajBurnMarker(arc.depX, arc.depY, 'up', _trajDvText(leg.dv), _metFmt(leg.met), markerOpts(arcExtentPx));
      out += _trajBurnMarker(arc.arrX, arc.arrY, 'down', '', _metFmt(leg.metArrive), markerOpts(arcExtentPx));
      return;
    }
    // local-body-frame leg: translunar (Earth scene, r2=Moon ring) or a normal
    // circular/elliptic-to-circular/elliptic transfer within the same body's SOI.
    const fromR = _trajLocalRadius(leg.fromO, body);
    const toR = _trajLocalRadius(leg.toO, body);
    if (fromR == null || toR == null) return;
    // Redundant-transfer suppression: if the destination orbit's own true
    // (peri,apo) already matches (departure radius, arrival radius), the
    // target ring IS the transfer arc (e.g. GTO as a destination, dv2=0) —
    // skip the dashed arc + arrival marker and draw only the departure burn
    // dot. Note: toR (from _trajLocalRadius) is toO's MEAN radius, which for
    // an elliptical target differs from its true apoapsis — so the
    // redundancy check compares against toO's real peri/apo (toO_peri/
    // toO_apo), not the mean-radius arc endpoints, matching what the target
    // RING actually draws.
    const toPeri = toO_peri(leg.toO, R), toApo = toO_apo(leg.toO, R);
    const redundant = toPeri != null && toApo != null && _trajTransferIsRedundant(fromR, toApo, toPeri, toApo);
    // Apse-line alignment: when the destination is elliptical, its ring is
    // drawn (via _trajRingSVG/_trajEllipseGeom) with apoapsis fixed at local
    // -x, rotDeg=0 — no rotation parameter exists on the ring. For the dashed
    // transfer arc to be VISUALLY TANGENT to that ring at the shared apoapsis
    // (the second/circularization burn point, matching calculate()'s
    // dv2-at-apoapsis model), the arc must share that same 0-rotation apse
    // line and use the destination's TRUE apoapsis radius (toApo), not the
    // mean radius (toR) which only equals toApo for circular targets. The
    // schematic per-leg rotation (20 + li*35) is dropped for elliptical
    // destinations so arcs don't go tangent to nothing; circular/degenerate
    // targets (toApo==toPeri) keep no meaningful apse line so this is a no-op
    // for them, and legs into scenes without a drawn ring (SUN-scene, handled
    // above) are unaffected.
    const arcToR = (toApo != null && toPeri != null && Math.abs(toApo - toPeri) > Math.max(1, toApo * 0.001)) ? toApo : toR;
    const arc = _trajTransferArcPath(fromR, arcToR, scale, 0);
    const arcExtentPx = Math.abs(arc.depX - arc.arrX) / 2 * zoom;
    const color = emphasized ? 'var(--accent)' : (leg.color || 'var(--accent2)');
    const strokeW = emphasized ? 1.2 : 0.7;
    const opacity = emphasized ? 1 : 0.8;
    if (!redundant) {
      const hitArea = leg.authIdx != null ? `<path d="${arc.d}" fill="none" stroke="transparent" stroke-width="8"${clickAttr}/>` : '';
      out += `<path d="${arc.d}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-dasharray="2.5,2" opacity="${opacity}" vector-effect="non-scaling-stroke"${clickAttr}><title>${hoverTitle}</title></path>${hitArea}`;
      out += _trajBurnMarker(arc.depX, arc.depY, 'up', _trajDvText(leg.dv), _metFmt(leg.met), markerOpts(arcExtentPx));
      out += _trajBurnMarker(arc.arrX, arc.arrY, 'down', '', _metFmt(leg.metArrive), markerOpts(arcExtentPx));
    } else {
      // Departure burn dot only, at the same perigee-side point the arc would
      // have started from — the target ring itself IS the transfer.
      out += _trajBurnMarker(arc.depX, arc.depY, 'up', _trajDvText(leg.dv), _metFmt(leg.met), markerOpts(arcExtentPx));
    }
  });

  // surface events (fixed screen-space marker + label, like burn markers) —
  // dot always renders; label text is LOD-gated through the same registry
  // (burn priority — these are event markers, same visual weight as burns).
  sc.surface.forEach(s => {
    const ang = s.kind === 'launch' ? -90 : 90; // launch at top, landing at bottom of disc — schematic
    const rad = ang * Math.PI / 180;
    const bodyPxR = Math.max(4, R * scale * 0.02);
    const x = bodyPxR * Math.cos(rad), y = bodyPxR * Math.sin(rad);
    const dy = s.kind === 'launch' ? -5 : 10;
    const inner = `<circle cx="0" cy="0" r="1.6" fill="var(--accent3)"/>`;
    out += _trajFixedG(x, y, zoom, inner);
    _trajRegisterLabel(x, y, [{ text: s.label, dy, fontPx: 10, color: 'var(--accent3)' }], 'burn',
      { screenSize: Infinity, minSize: 0, selected: false, zoom });
  });

  return out;
}

function _trajDvText(dv) {
  return dv ? Math.round(dv).toLocaleString() + ' m/s' : '';
}

// Body-centered radius (km, including body R) for a node-map orbit spec, in
// the given scene body's local frame. Returns null if the orbit isn't in this
// body's local frame (e.g. a transit/escape leg that belongs to a different scene).
function _trajLocalRadius(o, body) {
  if (!o) return null;
  if (o.type === 'transit') {
    // translunar/etc: departure end is a parking-orbit radius in `body`'s frame,
    // arrival end is the destination body's orbital radius around `body`.
    if (o.destination) {
      const mo = PROG_MOON_ORBITS[o.destination];
      if (mo && mo.parent === body) return mo.r;
    }
    return null;
  }
  if (o.body !== body) return null;
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  if (o.type === 'surface') return R;
  const peri = o.perigee ?? o.apogee ?? 0, apo = o.apogee ?? o.perigee ?? 0;
  return R + (peri + apo) / 2; // transfer endpoints use mean radius as departure/arrival point
}

// Schematic angle for a planet in the Sun scene, matching _trajSunSceneSVG's
// own layout (index order in PROG_HELIO_R, spread evenly) — kept in sync so
// transfer arcs originate at the visually-drawn ring position.
function _trajPlanetAngle(body) {
  const bodies = Object.keys(PROG_HELIO_R);
  const i = bodies.indexOf(body);
  if (i < 0) return 0;
  return (i / bodies.length) * 360 - 90;
}

// ── SVG builders ──────────────────────────────────────────────────────────
// Fixed viewBox; scale factors computed per scene so the ring set fits with
// headroom, then the wheel/drag zoom multiplies on top via CSS width/height
// (linear true scale — no log compression of distances).
// (_TRAJ_VB declared near top of file, with the camera state — needed early)

// Body/planet glyph: disc + label. Disc radius `r` is a WORLD-space (scaled
// km) radius as computed by the caller; screen-space min-visibility clamp is
// applied by the caller via _trajBodyPxR (counter-scaled by zoom so the
// clamp only bites when zoomed OUT — zooming in lets the true-scale disc
// grow past the clamp, per the O2 brief). Label is always fixed screen size.
function _trajGlyph(cx, cy, r, color, label, zoom, isFocus) {
  const z = zoom || 1;
  // Body label LOD: disc >=10px rendered OR this body is the scene focus
  // (always shown per the brief, since the focus body is the orientation
  // anchor for the whole view).
  _trajRegisterLabel(cx, cy - r, [{ text: label, dy: -4, fontPx: 10, color: 'var(--nm-label)' }], 'body',
    { screenSize: r * z, minSize: _TRAJ_LOD_BODY_MIN, selected: !!isFocus, zoom: z });
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="var(--border-bright)" stroke-width="0.5" vector-effect="non-scaling-stroke"/>
  </g>`;
}

// Minimum on-screen disc radius (px) a body should ever render at, converted
// to WORLD-space svg units by dividing by zoom (so after the svg's CSS
// width/height zoom multiply, the rendered px is >= _TRAJ_MIN_BODY_PX).
// True-scale discs bigger than this pass through unclamped (e.g. zoomed into
// LEO, Earth's limb stays huge and real).
const _TRAJ_MIN_BODY_PX = 6;
function _trajBodyPxR(trueR, zoom) {
  const z = zoom || 1;
  return Math.max(trueR, _TRAJ_MIN_BODY_PX / z);
}

// Default initial scale fits the MISSION's extent in this scene (min zoom that
// shows all mission orbits/arcs + the body), not the static maxR — per the O1-b
// design brief. Static rings beyond remain reachable by zooming out (user zoom
// is unbounded down to _TRAJ_ZMIN). Falls back to staticMaxR when the mission
// has no content in this scene (or no mission at all — static phase view).
// Margin is small relative to the half-viewBox so the fit content fills most
// of the frame (~80%+) rather than sitting as a small cluster in the middle.
function _trajFitScale(staticMaxR, missionMaxR) {
  const fitR = (missionMaxR > 0 && missionMaxR < staticMaxR) ? missionMaxR : staticMaxR;
  return (_TRAJ_VB / 2 - 12) / Math.max(1, fitR);
}

function _trajSunSceneSVG(m, zoom) {
  const bodies = Object.keys(PROG_HELIO_R);
  const staticMaxR = Math.max(...bodies.map(b => PROG_HELIO_R[b]));
  const missionMaxR = m ? _trajMissionExtent('SUN', m) : 0;
  const scale = _trajFitScale(staticMaxR, missionMaxR);
  const rings = bodies.map((b, i) => {
    const rr = PROG_HELIO_R[b] * scale;
    const ang = (i / bodies.length) * 2 * Math.PI - Math.PI / 2; // spread angles so labels don't collide
    const cx = rr * Math.cos(ang), cy = rr * Math.sin(ang);
    const color = _trajBodyColor(b);
    return `<circle cx="0" cy="0" r="${rr.toFixed(2)}" fill="none" stroke="${color}" stroke-width="0.6" opacity="0.55" vector-effect="non-scaling-stroke"/>`
      + _trajGlyph(cx, cy, _trajBodyPxR(3, zoom), color, b, zoom, false);
  }).join('');
  const sun = _trajGlyph(0, 0, _trajBodyPxR(6, zoom), _trajBodyColor('SUN'), 'Sun', zoom, true);
  return `${rings}${sun}${_trajSceneContent('SUN', m, scale, zoom)}`;
}

function _trajBodySceneSVG(body, m, zoom) {
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 6371;
  const moons = _trajMoonsOf(body);
  const staticMaxR = moons.length ? Math.max(...moons.map(mo => mo.r)) : R * 4;
  const missionMaxR = m ? _trajMissionExtent(body, m) : 0;
  const scale = _trajFitScale(staticMaxR, missionMaxR);
  const moonRings = moons.map(mo => {
    const rr = mo.r * scale;
    const color = _trajBodyColor(mo.name);
    return `<circle cx="0" cy="0" r="${rr.toFixed(2)}" fill="none" stroke="${color}" stroke-width="0.6" opacity="0.55" vector-effect="non-scaling-stroke"/>`
      + _trajGlyph(rr, 0, _trajBodyPxR(3, zoom), color, mo.name, zoom, false);
  }).join('');
  // Body disc: true world-scale (R*scale), with a screen-space min-visibility
  // clamp (_trajBodyPxR, ~6px on screen at any zoom) so it never vanishes when
  // zoomed out, but grows past the clamp on true scale once zoomed in enough
  // (e.g. framed on LEO, Earth's limb should be huge and real — see O2 brief).
  const bodyTrueR = R * scale;
  const bodyPxR = _trajBodyPxR(bodyTrueR, zoom);
  const discColor = _trajBodyColor(body);
  const disc = _trajGlyph(0, 0, bodyPxR, discColor, body, zoom, true);
  return `${moonRings}${disc}${_trajSceneContent(body, m, scale, zoom)}`;
}

function _trajSceneSVG(scene, m, zoom, pxScale) {
  // Single choke point for all scene renders (initial, wheel-zoom in-place
  // re-render) — reset the label registry, build geometry (which registers
  // label candidates as a side effect), then resolve LOD + collisions once
  // all candidates for this scene are known, and append the winners.
  // `pxScale` = actual rendered container px / _TRAJ_VB (see _trajRenderPxScale)
  // — defaults to 1 (exact old-formula behavior) when the container hasn't
  // been measured yet (first paint, before mount).
  _trajRenderPxScale = pxScale != null ? pxScale : 1;
  _trajResetLabels();
  const geo = scene === 'SUN' ? _trajSunSceneSVG(m, zoom) : _trajBodySceneSVG(scene, m, zoom);
  const labels = _trajResolveLabels();
  return geo + labels;
}

// Which scene(s) hold content (an orbit ring or a transfer leg) tied to the
// given authored event index. Used for the "event in EARTH scene → switch"
// hint chip when the selected event's content lives outside the current focus.
function _trajScenesForAuthIdx(m, authIdx) {
  if (authIdx == null) return [];
  const scenes = _trajGetExtraction(m);
  const hits = [];
  Object.keys(scenes).forEach(sceneId => {
    const sc = scenes[sceneId];
    const hasOrbit = [...sc.orbits.values()].some(rec => rec.firstAuthIdx === authIdx);
    const hasLeg = sc.legs.some(leg => leg.authIdx === authIdx);
    if (hasOrbit || hasLeg) hits.push(sceneId);
  });
  return hits;
}

// Which scenes are "moons of a planet" vs standalone — used to group the
// focus bar into planet buttons (moonless) and planet+flyout controls (has
// moons), so Moon/Titan scenes get a first-class nav path instead of only
// being reachable through the hint chip. A scene counts as a moon-parent if
// _trajMoonsOf(id) is non-empty; scene ids not in PROG_MOON_ORBITS values but
// present in _trajSceneList (e.g. 'SUN') are always plain buttons.
function _trajFocusGroups() {
  const scenes = _trajSceneList();
  return scenes.map(s => ({ scene: s, moons: s.id === 'SUN' ? [] : _trajMoonsOf(s.id) }));
}

// ── top-level view builder (called from missionRenderDetail via 570's hook) ──
function _missionTrajViewHTML(m) {
  const id = m.missionId;
  _trajExtractionCache = { missionId: null, data: null }; // force fresh extraction each render (mission log may have changed)
  const focus = _trajFocus(m);
  const scenes = _trajSceneList();

  // ── camera: fit-to-content on first access for this (mission,scene) pair ──
  // (trajSetFocus/trajResetView delete the stored camera so this branch runs
  // right after either). Fit width mirrors the OLD _trajFitScale intent but
  // expressed as a viewBox width instead of a zoom multiplier: at cam.w =
  // _TRAJ_VB the geometry (already fit into the +/-_TRAJ_VB/2 box by the
  // per-scene `scale` factor computed inside _trajSunSceneSVG/_trajBodySceneSVG)
  // exactly fills the frame, i.e. zoom=1 IS the fit view. No extra work needed
  // here beyond defaulting to the full box.
  let cam = _trajCamByMission[id];
  if (!cam) { cam = { cx: 0, cy: 0, w: _TRAJ_VB }; _trajCamByMission[id] = cam; }
  const zoom = _trajZoomFromCam(cam);

  // Grouped focus bar: moonless bodies (+SUN) render as plain buttons; bodies
  // with moons render as a button + a small flyout dropdown listing the
  // parent and its moons, so Moon/Titan scenes get first-class navigation
  // (previously only reachable via the hint chip). Active state shows on the
  // parent group whenever the focus is the parent OR one of its moons.
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

  const svgInner = _trajSceneSVG(focus, m, zoom);
  const h = cam.w; // square default (aspect corrected by _trajApplyCam/ResizeObserver post-mount; initial paint assumes 1:1 until measured)
  const viewBox = `${(cam.cx - cam.w / 2).toFixed(3)} ${(cam.cy - h / 2).toFixed(3)} ${cam.w.toFixed(3)} ${h.toFixed(3)}`;

  // Selection hint chip: if the selected event's content lives in a scene
  // other than the current focus, offer a one-click switch instead of
  // auto-switching (per the O1-c brief — don't yank the user's view).
  const selAuthIdx = _trajSelectedAuthIdx(m);
  let hintChip = '';
  if (selAuthIdx != null) {
    const hitScenes = _trajScenesForAuthIdx(m, selAuthIdx).filter(s => s !== focus);
    if (hitScenes.length) {
      const target = hitScenes[0];
      const label = (scenes.find(s => s.id === target) || { label: target }).label;
      hintChip = `<div class="traj-hint-chip" onclick="trajSetFocus('${id}','${target}')" title="Switch to the ${label} scene">event in ${label.toUpperCase()} scene &rarr; switch</div>`;
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
      </div>
      <div class="traj-footer">coplanar view — inclination/LAN annotated, not drawn &middot; planet positions schematic, body sizes clamped for visibility</div>
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

// Called by 570 right after render (mirrors _missionCenterNmEarth). Fixes the
// viewBox's aspect ratio to the ACTUAL rendered container (the initial HTML
// string assumes a square box since the container size isn't known until
// after mount) and wires a ResizeObserver so the camera stays honest across
// container resizes (band-view split resize, window resize, etc.) — required
// for the "svg rect == container rect at all zoom levels, never clips"
// invariant since the svg now fills its container via CSS instead of being
// explicitly sized.
let _trajResizeObservers = {};
function _missionTrajAfterRender(m) {
  const id = m.missionId;
  const svgEl = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"] svg.traj-svg`);
  if (!svgEl) return;
  // Fixes the viewBox aspect ratio AND re-renders symbology with the real
  // pxScale (containerPx / _TRAJ_VB) now that the container is measurable —
  // the very first paint (from _missionTrajViewHTML, before mount) assumed a
  // square box and pxScale=1, which only matches reality when the container
  // happens to be exactly _TRAJ_VB px wide.
  const fitViewBox = () => {
    const cam = _trajCamByMission[id];
    if (!cam) return;
    const rect = svgEl.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    const aspect = rect.height / rect.width;
    const h = cam.w * aspect;
    svgEl.setAttribute('viewBox', `${(cam.cx - cam.w / 2).toFixed(3)} ${(cam.cy - h / 2).toFixed(3)} ${cam.w.toFixed(3)} ${h.toFixed(3)}`);
    const sceneEl = svgEl.querySelector('g.traj-scene');
    if (sceneEl && typeof _missions !== 'undefined') {
      const mm = (_missions || []).find(x => x.missionId === id);
      const focus = _trajFocus({ missionId: id });
      const zoom = _trajZoomFromCam(cam);
      const pxScale = rect.width / _TRAJ_VB;
      sceneEl.innerHTML = _trajSceneSVG(focus, mm, zoom, pxScale);
    }
  };
  fitViewBox();
  if (_trajResizeObservers[id]) { try { _trajResizeObservers[id].disconnect(); } catch (e) {} }
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => fitViewBox());
    ro.observe(svgEl);
    _trajResizeObservers[id] = ro;
  }
}
