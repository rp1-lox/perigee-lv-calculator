
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
  // Shared per-body DATA palette (570's PROG_BODY_COLORS) so glyphs, rings and
  // labels here match the same body's color in the orbit map. Unlisted moons
  // (e.g. Titan) fall back to the Moon's hue; anything else to the theme accent2.
  if (typeof PROG_BODY_COLORS !== 'undefined' && PROG_BODY_COLORS[body]) return PROG_BODY_COLORS[body];
  if (PROG_MOON_ORBITS && PROG_MOON_ORBITS[body]) return (typeof PROG_BODY_COLORS !== 'undefined' && PROG_BODY_COLORS.Moon) || 'var(--nm-lunar)';
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
  return _trajCamByMission[id] || { anchorBody: 'Earth', relOffsetKm: { x: 0, y: 0 }, wKm: _TRAJ_VB, az: 0, el: Math.PI / 2 };
}
function _trajZoomFromCam(cam) { return _TRAJ_VB / cam.wKm; }

// ── R2: 3D projection (ONE seam) ────────────────────────────────────────────
// Pure orthographic camera: rotate about the ecliptic normal by az, then tilt
// from top-down by (π/2 − el) about the screen-x axis, drop the view axis as
// depth. At el = π/2, az = 0 this is EXACTLY the pre-R2 mapping (u=x, v=y) —
// 3D is a superset, not a re-projection. Linear, so planar LOCAL geometry
// (arcs, spurs, ring offsets around a body) can be projected as offsets and
// added to the body's already-projected anchor.
function _trajProjectVec(x, y, z, az, el) {
  const t = Math.PI / 2 - (el != null ? el : Math.PI / 2);
  const ca = Math.cos(az || 0), sa = Math.sin(az || 0);
  const ct = Math.cos(t), st = Math.sin(t);
  const xa = x * ca - y * sa, ya = x * sa + y * ca;
  return { x: xa, y: ya * ct - (z || 0) * st, depth: ya * st + (z || 0) * ct };
}
// Per-render-pass projection context (set by _trajWorldSVG from the camera;
// helpers below read it so every emission site shares ONE projection).
let _trajProjCtx = { az: 0, el: Math.PI / 2 };
/** Project a 3D vector (any consistent units) through the pass camera. */
function _trajProj3(x, y, z) { return _trajProjectVec(x, y, z, _trajProjCtx.az, _trajProjCtx.el); }
/** Project a PLANAR (ecliptic z=0) local offset through the pass camera. */
function _trajProjLocal(dx, dy) { const p = _trajProjectVec(dx, dy, 0, _trajProjCtx.az, _trajProjCtx.el); return { x: p.x, y: p.y }; }

// Effective camera center in heliocentric km at the given view time — the
// ONE place anchor + offset combine. Everything else in the render path
// subtracts this from world km to get floating-origin render coords.
// z rides along (R2): the anchor body's real out-of-plane position keeps it
// centered under tilt. `overrides` is a retired R1 vestige, ignored.
function _trajCamCenterKm(cam, viewT, overrides) {
  const p = progBodyWorldPos(cam.anchorBody, viewT);
  return { x: p.x + (cam.relOffsetKm ? cam.relOffsetKm.x : 0), y: p.y + (cam.relOffsetKm ? cam.relOffsetKm.y : 0), z: p.z || 0 };
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
    // Mission-aware solar fit: fitting the FULL system (out to Neptune) put
    // any realistic mission's geometry in the inner ~5% of the view, below
    // every LOD window — "fly to Sun" showed empty space. Frame the outermost
    // heliocentric ring the mission actually touches instead (Earth's ring is
    // the floor — every mission departs it); no mission -> full system.
    const rs = Object.values(PROG_HELIO_R);
    const fullR = rs.length ? Math.max(...rs) * 1.15 : 1e9;
    let missionHelioR = 0;
    if (m) {
      const frames = _trajGetExtraction(m);
      Object.keys(frames).forEach(frameId => {
        const sc = frames[frameId];
        const touched = sc.orbits.size || (sc.legs && sc.legs.length) || (sc.surface && sc.surface.length);
        if (!touched) return;
        const parent = (PROG_MOON_ORBITS[frameId] && PROG_MOON_ORBITS[frameId].parent) || frameId;
        if (PROG_HELIO_R[parent] != null) missionHelioR = Math.max(missionHelioR, PROG_HELIO_R[parent]);
        (sc.legs || []).forEach(leg => {
          [leg.fromO, leg.toO].forEach(o => {
            if (o && o.type === 'transit' && PROG_HELIO_R[o.destination] != null) missionHelioR = Math.max(missionHelioR, PROG_HELIO_R[o.destination]);
          });
        });
      });
      if (missionHelioR > 0 && PROG_HELIO_R.Earth) missionHelioR = Math.max(missionHelioR, PROG_HELIO_R.Earth);
    }
    staticR = missionHelioR > 0 ? missionHelioR * 1.3 : fullR;
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
  const prev = _trajCam(id); // fly-to keeps the user's 3D orientation
  _trajCamByMission[id] = { anchorBody: body, relOffsetKm: { x: 0, y: 0 }, wKm, az: prev.az || 0, el: prev.el != null ? prev.el : Math.PI / 2 };
  missionRenderDetail();
}

function trajResetView(id) {
  const cam = _trajCam(id);
  const m = (typeof _missions !== 'undefined' ? (_missions || []) : []).find(mm => mm.missionId === id);
  const wKm = _trajFitWKmForBody(cam.anchorBody, m);
  // Reset returns to the canonical top-down view (az/el included).
  _trajCamByMission[id] = { anchorBody: cam.anchorBody, relOffsetKm: { x: 0, y: 0 }, wKm, az: 0, el: Math.PI / 2 };
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
  // Geometry is emitted in render units (km·zoom), so the viewBox is a
  // CONSTANT ~±200-unit window regardless of camera width — attribute floats
  // stay small at every zoom (software-rasterizer safety; see _trajWorldSVG).
  const vbH = _TRAJ_VB * aspect;
  svgEl.setAttribute('viewBox', `${(-_TRAJ_VB / 2).toFixed(3)} ${(-vbH / 2).toFixed(3)} ${_TRAJ_VB.toFixed(3)} ${vbH.toFixed(3)}`);
  const sceneEl = svgEl.querySelector('g.traj-scene');
  if (sceneEl && typeof _missions !== 'undefined') {
    const m = (_missions || []).find(mm => mm.missionId === id);
    const zoom = _trajZoomFromCam(cam);
    _trajResetLabels();
    sceneEl.innerHTML = _trajWorldSVG(m, cam, zoom, rect);
    if (overlayEl && rect.width > 0 && rect.height > 0) {
      overlayEl.style.transform = ''; // clear any mid-drag pan slide
      overlayEl.setAttribute('width', rect.width);
      overlayEl.setAttribute('height', rect.height);
      overlayEl.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
      const renderCam = { cx: 0, cy: 0, w: _TRAJ_VB };
      overlayEl.innerHTML = _trajResolveLabels(renderCam, rect);
    }
  }
  const footEl = va.querySelector('.traj-footer'); // R2: keep the az/el readout live
  if (footEl) footEl.innerHTML = _trajFooterHTML(cam);
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
      // Screen-plane point under the cursor, offset-relative. R2: the pan
      // offset lives in the ECLIPTIC plane — un-project the screen delta
      // (divide v by sin(el) to undo foreshortening, then inverse-az rotate)
      // so cursor-anchored zoom keeps tracking under tilt.
      const el0 = cam.el != null ? cam.el : Math.PI / 2;
      const sinEl = Math.max(Math.sin(el0), 0.15);
      const ca = Math.cos(cam.az || 0), sa = Math.sin(cam.az || 0);
      const nextH = nextW * aspect;
      const su = ((-cam.wKm / 2) + fx * cam.wKm) - (fx - 0.5) * nextW;
      const sv = (((-h / 2) + fy * h) - (fy - 0.5) * nextH) / sinEl;
      offX += su * ca + sv * sa;
      offY += -su * sa + sv * ca;
    }
  }
  _trajApplyCam(id, Object.assign({}, cam, { relOffsetKm: { x: offX, y: offY }, wKm: nextW }));
}

let _trajDrag = null;
// Set true when a pan-drag actually moved the pointer (>3px, same threshold as
// the node map's missionNmPanMove) so the click that follows a real drag on an
// interactive arc/marker/ring doesn't also select an event (drag-vs-click
// disambiguation, per the node map / library-browser _didDrag pattern).
let _trajJustDragged = false;
function trajPanStart(ev, id) {
  // R2: Shift-drag or right-button drag rotates the 3D camera; plain drag pans.
  const mode = (ev.shiftKey || ev.button === 2) ? 'rotate' : 'pan';
  _trajDrag = { id, mode, x0: ev.clientX, y0: ev.clientY, cam0: Object.assign({}, _trajCam(id), { relOffsetKm: Object.assign({}, _trajCam(id).relOffsetKm) }), moved: false, rectW: null, rectH: null };
  const svgEl = ev.currentTarget && ev.currentTarget.querySelector ? ev.currentTarget.querySelector('svg.traj-svg') : null;
  if (svgEl) { const r = svgEl.getBoundingClientRect(); _trajDrag.rectW = r.width; _trajDrag.rectH = r.height; }
  ev.preventDefault();
}
// Rotate re-renders per move (same cost class as wheel zoom); throttle to
// ~one render per animation-frame-ish interval so slow machines stay live.
let _trajRotLastMs = 0;
function trajPanMove(ev) {
  if (!_trajDrag) return;
  const dx = ev.clientX - _trajDrag.x0, dy = ev.clientY - _trajDrag.y0;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _trajDrag.moved = true;
  if (_trajDrag.mode === 'rotate') {
    const cam0 = _trajDrag.cam0;
    const az = ((cam0.az || 0) - dx * 0.008) % (2 * Math.PI);
    const el = Math.max(0.087, Math.min(Math.PI / 2, (cam0.el != null ? cam0.el : Math.PI / 2) + dy * 0.008));
    const cam = Object.assign({}, cam0, { relOffsetKm: Object.assign({}, cam0.relOffsetKm), az, el });
    const now = performance.now();
    if (now - _trajRotLastMs > 33) { _trajRotLastMs = now; _trajApplyCam(_trajDrag.id, cam); }
    else _trajCamByMission[_trajDrag.id] = cam;
    return;
  }
  const rectW = _trajDrag.rectW || 400, rectH = _trajDrag.rectH || 400;
  // Screen-px delta -> world-unit (km) delta at the CURRENT camera width (drag
  // pan shifts relOffsetKm directly, opposite the pointer delta since dragging
  // right should reveal content to the left). Under tilt, a screen-vertical px
  // spans MORE ecliptic km (foreshortening) — divide by sin(el), and rotate
  // the screen delta back through az so panning still tracks the cursor.
  const cam0 = _trajDrag.cam0;
  const el0 = cam0.el != null ? cam0.el : Math.PI / 2;
  const sinEl = Math.max(Math.sin(el0), 0.15);
  const aspect = rectH / rectW;
  const su = -dx * (cam0.wKm / rectW);
  const sv = -dy * (cam0.wKm * aspect / rectH) / sinEl;
  const ca = Math.cos(cam0.az || 0), sa = Math.sin(cam0.az || 0);
  const worldDx = su * ca + sv * sa, worldDy = -su * sa + sv * ca; // inverse az rotation
  const cam = Object.assign({}, cam0, { relOffsetKm: { x: cam0.relOffsetKm.x + worldDx, y: cam0.relOffsetKm.y + worldDy } });
  _trajCamByMission[_trajDrag.id] = cam;
  const svgEl = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${_trajDrag.id}"] svg.traj-svg`);
  if (svgEl) {
    // Geometry was emitted in render units at cam0's center; slide the
    // constant-unit viewBox by the PROJECTED offset delta (projection is
    // linear and the pan offset is planar, so this stays exact under tilt).
    const zoom0 = _trajZoomFromCam(cam0);
    const q = _trajProjectVec(worldDx, worldDy, 0, cam0.az || 0, el0);
    const vbH = _TRAJ_VB * aspect;
    svgEl.setAttribute('viewBox', `${(-_TRAJ_VB / 2 + q.x * zoom0).toFixed(3)} ${(-vbH / 2 + q.y * zoom0).toFixed(3)} ${_TRAJ_VB.toFixed(3)} ${vbH.toFixed(3)}`);
  }
  // Overlay anchors are NOT re-projected during the drag (that would re-run
  // LOD/collision every mousemove tick) — but pan is a pure translation, so
  // sliding the whole overlay by the raw pointer delta keeps labels glued to
  // their geometry 1:1. The transform is cleared by pan-end's full re-render.
  const overlayEl = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${_trajDrag.id}"] svg.traj-overlay`);
  if (overlayEl) overlayEl.style.transform = `translate(${dx}px, ${dy}px)`;
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

  const addOrbitRing = (body, peri, apo, ownerKeys, authIdx, inc) => {
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
      addOrbitRing(o.body || 'Earth', peri, apo, v.owners, e._authIdx, o.inclination);
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
      if (!auth || auth.type !== 'MANEUVER') return;
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
  heliocentricRing: [3, 15],       // × viewport diagonal at hi (see _trajWindowHi); lo=3px so inner-planet rings survive full-system zoom
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
function _trajCullPositionOffscreen(renderX, renderY, viewportDiagPx) {
  const distPx = Math.hypot(renderX, renderY); // render coords are already units (~px)
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
  // R2: TRUE-GEOMETRY ring — sampled ellipse from elements {a, e from
  // peri/apo, i = authored inclination}, Ω = ω = 0 by convention (launch-time
  // modeling would pin RAAN; annotated in the tooltip rather than faked),
  // projected through the pass camera. Replaces the circle/ellipse emitters.
  const rp = R + Math.min(rec.peri, rec.apo), ra = R + Math.max(rec.peri, rec.apo);
  const a = (rp + ra) / 2, ecc = (ra - rp) / (ra + rp);
  const screenSize = ra * scale; // max radius in render units — LOD/cull metric (matches pre-R2 semantics)
  if (_trajCullByExtent(screenSize)) return '';
  if (_trajCullRingByDiagonal(screenSize, viewportDiagPx)) return '';
  const lodAlpha = emphasized ? 1 : _trajLodOpacity(screenSize, _TRAJ_LOD_WIN.missionOrbitRing[0], _trajWindowHi(_TRAJ_LOD_WIN.missionOrbitRing[1], viewportDiagPx));
  if (lodAlpha <= 0) return '';
  const opacity = (baseOpacity * lodAlpha * historyMul).toFixed(3);
  // R3.1: state-derived orientation override (MATH.md §7i) — a ring whose
  // plane was matched to a converged physics leg's departure/arrival state
  // samples with THAT (i, raan, argp) instead of the Ω=ω=0 convention; size
  // (a, e) always stays authored (rec.peri/rec.apo above — accounting truth).
  let incRad = (rec.inc || 0) * Math.PI / 180, raanRad = 0, argpRad = 0;
  if (rec.elements) { incRad = rec.elements.i || 0; raanRad = rec.elements.raan || 0; argpRad = rec.elements.argp || 0; }
  const pts = progOrbitSamplePoints({ a, e: ecc, i: incRad, raan: raanRad, argp: argpRad }, 96);
  let d = '', topX = ox, topY = Infinity, periX = ox, periY = oy;
  for (let k = 0; k < pts.length; k++) {
    const q = _trajProj3(pts[k][0] * scale, pts[k][1] * scale, pts[k][2] * scale);
    const x = ox + q.x, y = oy + q.y;
    if (!isFinite(x) || !isFinite(y)) return '';
    d += (k ? ' L ' : 'M ') + x.toFixed(2) + ' ' + y.toFixed(2);
    if (y < topY) { topY = y; topX = x; }
    if (k === 0) { periX = x; periY = y; } // E=0 sample = periapsis
  }
  const incTxt = rec.elements
    ? ` &middot; i=${(incRad * 180 / Math.PI).toFixed(1)}&deg; &Omega;=${(raanRad * 180 / Math.PI).toFixed(1)}&deg; (plane from flight)`
    : (rec.inc ? ` &middot; i=${rec.inc}&deg; (&Omega;,&omega; assumed 0)` : '');
  const hitArea = opts.authIdx != null ? `<path d="${d}" fill="none" stroke="transparent" stroke-width="9"${clickAttr}/>` : '';
  const lines = [{ text: rec.label, dy: -4, fontPx: 10.5, color: 'var(--nm-label)' }];
  _trajRegisterLabel(topX, topY, lines, 'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, opacity: lodAlpha * historyMul });
  if (coastTxt) _trajRegisterLabel(periX, periY - 6, [{ text: coastTxt, dy: 0, fontPx: 10, color: 'var(--nm-label)' }], 'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, opacity: lodAlpha * historyMul });
  return `<g${clickAttr}>
    <path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" opacity="${opacity}" vector-effect="non-scaling-stroke"><title>${title}${incTxt}</title></path>
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

// R2: camera-projected variant of the schematic transfer arc — samples the
// half-ellipse (planar, ecliptic z=0) and projects each point through the
// pass camera so unconverged/schematic legs tilt coherently with the world.
// (_trajTransferArcPath itself stays flat — 230's mini-diagram uses it with
// its own top-down camera.) Same return contract: {d, depX, depY, arrX, arrY}.
function _trajArcProjectedPath(r1, r2, scale, rotDeg, ox, oy) {
  const N = 64;
  let d = '';
  let dep = null, arr = null;
  for (let k = 0; k <= N; k++) {
    const p = _trajArcPointAt(r1, r2, scale, rotDeg, 0, 0, k / N); // planar local
    const q = _trajProjLocal(p.x, p.y);
    const x = ox + q.x, y = oy + q.y;
    d += (k ? ' L ' : 'M ') + x.toFixed(2) + ' ' + y.toFixed(2);
    if (k === 0) dep = { x, y };
    if (k === N) arr = { x, y };
  }
  return { d, depX: dep.x, depY: dep.y, arrX: arr.x, arrY: arr.y };
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

// ── P3: physics-leg polylines + SOI spurs (render integration) ─────────────
// A propagated physics leg (565's _physTrajByMission, via physMissionLeg)
// carries samples [{t, r:[x,y,z], frame}] where r is RELATIVE to that
// sample's frame body AT TIME sample.t. Drawing convention (patched-conic,
// KSP-style): each frame's sub-segment is anchored to that body's CURRENT
// DRAWN position (the ox,oy the renderer computed for the body at viewTime)
// — NEVER at absolute heliocentric sample positions (the bodies move between
// sample.t and viewTime; absolute positions would smear the trajectory).

/** The WHOLE physics leg as ONE CONTINUOUS polyline across frame handoffs.
 *  `anchorOf(frame)` -> {x,y} render-space position of that frame's body as
 *  DRAWN at viewTime (patched-conic gluing: each sample maps to
 *  anchorOf(sample.frame) + r·zoom). A cross-frame trajectory therefore never
 *  gaps mid-flight — the old per-frame rendering vanished the Moon-frame
 *  passage whenever the Moon's ZOI fade was closed, leaving a hole exactly at
 *  the encounter (user-reported, 2026-07-09). The frame seams get a small
 *  kink where the two gluings disagree (the body drifted between sample.t and
 *  viewTime) — an honest patched-conic seam, preferable to a void.
 *  Samples with t > opts.clipT or an unresolvable frame are skipped (runs
 *  split into subpaths only if a skip makes them non-contiguous).
 *  Returns null (<2 drawable samples) or {hidden:true} (outside LOD culls). */
function _trajPolylineSVG(physLeg, anchorOf, zoom, opts) {
  opts = opts || {};
  const clipT = opts.clipT != null ? opts.clipT : Infinity;
  const samples = (physLeg && physLeg.samples) || [];
  const runs = [];
  const seams = []; // SOI handoffs: {x, y, from, to, t} — drawn as small dashed circles, NOT connected by a chord
  let cur = null, curFrame = null, lastPt = null;
  for (const s of samples) {
    if (s.t > clipT) { cur = null; continue; }
    const a = anchorOf(s.frame);
    if (!a) { cur = null; continue; }
    const q = _trajProj3(s.r[0], s.r[1], s.r[2] || 0); // R2: samples are 3D (Moon-frame patches carry real z)
    const x = a.x + q.x * zoom, y = a.y + q.y * zoom;
    if (!isFinite(x) || !isFinite(y)) { cur = null; continue; }
    // Frame handoff: BREAK the polyline (the two gluings disagree by the
    // body's drift between sample.t and viewTime — a straight chord across
    // that gap reads as a phantom burn; user-reported) and record a seam
    // marker at the departure side of the handoff instead.
    if (cur && curFrame !== s.frame) {
      if (lastPt) seams.push({ x: lastPt.x, y: lastPt.y, from: curFrame, to: s.frame, t: s.t });
      cur = null;
    }
    if (!cur) { cur = []; runs.push(cur); curFrame = s.frame; }
    cur.push({ x, y, t: s.t });
    lastPt = { x, y };
  }
  const pts = [];
  runs.forEach(run => { if (run.length >= 2) pts.push(...run); });
  if (pts.length < 2) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  pts.forEach(p => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  });
  const extentPx = Math.max(maxX - minX, maxY - minY) / 2;
  const viewportDiagPx = opts.viewportDiagPx || Infinity;
  if (_trajCullByExtent(extentPx) || _trajCullRingByDiagonal(extentPx, viewportDiagPx)) return { hidden: true };
  let d = '';
  runs.forEach(run => {
    if (run.length < 2) return;
    d += (d ? ' ' : '') + 'M ' + run.map((p, i) => (i ? 'L ' : '') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ');
  });
  return { d, seams, first: pts[0], last: pts[pts.length - 1], extentPx, tFirst: pts[0].t, tLast: pts[pts.length - 1].t };
}

/** Vehicle-dot position on a physics leg at time tQuery: linear interpolation
 *  between the bracketing samples, glued via the SAME anchorOf resolver as
 *  the polyline (replaces the schematic _trajLegPathFraction for physics
 *  legs). Cross-frame bracket pairs interpolate in screen space — coarse but
 *  only ever spans one sample interval at the seam. */
function _trajPolylinePointAt(physLeg, anchorOf, zoom, tQuery) {
  const samples = (physLeg && physLeg.samples) || [];
  const project = s => {
    const a = anchorOf(s.frame);
    if (!a) return null;
    const q = _trajProj3(s.r[0], s.r[1], s.r[2] || 0);
    const x = a.x + q.x * zoom, y = a.y + q.y * zoom;
    return (isFinite(x) && isFinite(y)) ? { x, y } : null;
  };
  let prev = null;
  for (const s of samples) {
    if (prev && s.t >= tQuery && prev.t <= tQuery) {
      const p0 = project(prev), p1 = project(s);
      if (!p0 || !p1) return p0 || p1;
      const f = (s.t - prev.t) > 0 ? (tQuery - prev.t) / (s.t - prev.t) : 0;
      return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f };
    }
    prev = s;
  }
  return null;
}

/** Mission-truth clip time for a propagated injection leg: the propagation
 *  runs to 1.5× the schematic TOF (565), but the mission's own trajectory
 *  ends at the arrival burn — clip the drawn polyline at the EXITING
 *  (transit -> destination orbit) leg's metArrive so post-capture integrator
 *  samples don't render as a phantom continuation. Infinity when no arrival
 *  leg exists (the propagation tail is then the honest picture). */
function _trajPhysClipT(m, physLeg) {
  if (!m || !physLeg || !physLeg.dest) return Infinity;
  const frames = _trajGetExtraction(m);
  const sc = frames[physLeg.dest];
  if (!sc || !sc.legs) return Infinity;
  let clip = Infinity;
  sc.legs.forEach(l => {
    if (!l.fromO || l.fromO.type !== 'transit') return;
    if (l.authIdx == null || physLeg.authIdx == null || l.authIdx <= physLeg.authIdx) return;
    if (l.metArrive != null && l.metArrive < clip) clip = l.metArrive;
  });
  return clip;
}

/** The propagated INJECTION physics leg whose destination is `body`, for an
 *  arrival (transit -> orbit) schematic leg at arrAuthIdx — the injection leg
 *  already flew the coast, so its samples carry the body-frame approach. */
function _trajPhysInjectionLegFor(m, arrAuthIdx, body) {
  if (!m || arrAuthIdx == null || typeof _physTrajByMission === 'undefined') return null;
  const t = _physTrajByMission[m.missionId];
  if (!t || !t.legs) return null;
  let best = null;
  t.legs.forEach(L => {
    if ((L.kind !== 'moon' && L.kind !== 'interplanetary') || L.dest !== body) return;
    if (L.authIdx == null || L.authIdx >= arrAuthIdx) return;
    if (!best || L.authIdx > best.authIdx) best = L;
  });
  return best;
}

/** Shared physics-leg renderer for one frame: polyline + hit path + burn
 *  markers + vehicle dot, with the C2 leg-state treatment derived from the
 *  PROPAGATED time span (tDep = physLeg.met, tArr = clip time or last sample)
 *  rather than the schematic leg's met/metArrive (an impulsive injection
 *  leg's schematic record has met === metArrive; the polyline spans the real
 *  coast). Returns the SVG string, '' when LOD-hidden, or null when the
 *  physics leg has nothing drawable in this frame (schematic fallback). */
function _trajPhysLegRender(ctx) {
  const { m, leg, physLeg, body, ox, oy, zoom, viewportDiagPx, vt, emphasized } = ctx;
  const id = m.missionId;
  const clipT = _trajPhysClipT(m, physLeg);
  // Frame-anchor resolver: this pass knows only ITS body's drawn position
  // (ox,oy); sibling frames' drawn positions follow from the real-ephemeris
  // world delta at viewTime × zoom (same position source as the glyphs).
  const overrides = {}; // R1: calibration retired — alias ignores this anyway
  const bodyWorld = progBodyWorldPosCalibrated(body, vt, overrides);
  const anchorCache = {};
  const anchorOf = frame => {
    if (frame === body) return { x: ox, y: oy };
    if (anchorCache[frame]) return anchorCache[frame];
    const w = progBodyWorldPosCalibrated(frame, vt, overrides);
    if (!w) return null;
    const q = _trajProj3(w.x - bodyWorld.x, w.y - bodyWorld.y, (w.z || 0) - (bodyWorld.z || 0)); // R2: 3D world delta
    return (anchorCache[frame] = { x: ox + q.x * zoom, y: oy + q.y * zoom });
  };
  const poly = _trajPolylineSVG(physLeg, anchorOf, zoom, { clipT, viewportDiagPx });
  if (!poly) return null;
  if (poly.hidden) return '';
  const tDep = physLeg.met != null ? physLeg.met : poly.tFirst;
  const tArr = isFinite(clipT) ? clipT : poly.tLast;
  const legState = vt >= tArr ? 'history' : (vt >= tDep ? 'current' : 'planned');
  const stateAlpha = legState === 'history' ? _TRAJ_HISTORY_ALPHA : 1;
  const alpha = emphasized ? 1 : _trajLodOpacity(poly.extentPx, _TRAJ_LOD_WIN.transferArc[0], _trajWindowHi(_TRAJ_LOD_WIN.transferArc[1], viewportDiagPx));
  if (alpha <= 0) return '';
  const clickIdx = leg.authIdx;
  const clickAttr = clickIdx != null ? ` style="cursor:pointer" onclick="_trajSelectEventFromView('${id}',${clickIdx})"` : '';
  const color = emphasized ? 'var(--accent)' : (leg.color || 'var(--accent2)');
  const strokeW = emphasized ? 1.2 : 0.7;
  const dashAttr = legState === 'planned' ? ` stroke-dasharray="2.5,2"` : '';
  const opacity = (alpha * (emphasized ? 1 : 0.8) * stateAlpha).toFixed(3);
  const hoverTitle = ctx.title || '';
  const hitArea = clickIdx != null ? `<path d="${poly.d}" fill="none" stroke="transparent" stroke-width="8"${clickAttr}/>` : '';
  let out = `<path d="${poly.d}" fill="none" stroke="${color}" stroke-width="${strokeW}"${dashAttr} opacity="${opacity}" vector-effect="non-scaling-stroke"${clickAttr}><title>${hoverTitle}</title></path>${hitArea}`;
  // SOI handoff seams: small dashed circles where the trajectory leaves one
  // sphere of influence for another (the polyline BREAKS here by design —
  // the two frames' gluings disagree by the body's drift; see _trajPolylineSVG).
  (poly.seams || []).forEach(sm => {
    out += `<circle cx="${sm.x.toFixed(2)}" cy="${sm.y.toFixed(2)}" r="3.2" fill="none" stroke="${color}" stroke-width="0.7" stroke-dasharray="1.6,1.6" opacity="${opacity}" vector-effect="non-scaling-stroke"><title>SOI handoff: ${sm.from} → ${sm.to} · ${_metFmt(sm.t)}</title></circle>`;
  });
  const markerOpts = { emphasized, authIdx: clickIdx, missionId: id, title: hoverTitle, zoom, screenSize: poly.extentPx };
  if (ctx.depMarker) _trajBurnMarker(poly.first.x, poly.first.y, 'up', _trajDvText(ctx.depDv != null ? ctx.depDv : leg.dv), _metFmt(tDep), Object.assign({}, markerOpts, { opacity: stateAlpha }));
  if (ctx.arrMarker) _trajBurnMarker(poly.last.x, poly.last.y, 'down', ctx.arrDv != null ? _trajDvText(ctx.arrDv) : '', isFinite(tArr) ? _metFmt(tArr) : '', Object.assign({}, markerOpts, { opacity: stateAlpha }));
  if (legState === 'current') {
    const dotP = _trajPolylinePointAt(physLeg, anchorOf, zoom, vt);
    if (dotP) out += `<circle cx="${dotP.x.toFixed(2)}" cy="${dotP.y.toFixed(2)}" r="2.2" fill="var(--accent)" stroke="var(--nm-bg)" stroke-width="0.6" vector-effect="non-scaling-stroke"><title>Vehicle position (physics leg — interpolated from propagated samples)</title></circle>`;
  }
  return out;
}

/** SOI escape/capture spur (P3): hyperbola from the parking-ring periapsis
 *  out to the body's SOI edge (physEscapeGeometry, 385), rotated so the far
 *  (asymptote-ward) end points along farAngleRad. `mirror` flips the sweep
 *  side (capture spurs — schematic mirror, see MATH.md §7f). Embedded
 *  body-frame content: the caller's zoiAlpha <g opacity> wrapper is the one
 *  fade authority; the spur only applies its own transferArc LOD window. */
function _trajEscapeSpurSVG(body, rpKm, c3, farAngleRad, mirror, zoom, ox, oy, viewportDiagPx, opts) {
  opts = opts || {};
  const mu = PROG_BODIES[body] && PROG_BODIES[body].mu;
  const geo = (typeof physEscapeGeometry === 'function' && mu) ? physEscapeGeometry(rpKm, c3, mu, mirror ? -1 : 1) : null;
  if (!geo) return null;
  const rSoi = (typeof physSoiRadius === 'function') ? physSoiRadius(body) : 0;
  if (!(rSoi > rpKm) || !isFinite(rSoi)) return null;
  const raw = geo.samplePoints(rSoi, 48);
  const far = raw[raw.length - 1];
  const rot = farAngleRad - Math.atan2(far[1], far[0]);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const pts = raw.map(p => { // R2: rotate in the ecliptic plane, then project the planar offset
    const q = _trajProjLocal((p[0] * cr - p[1] * sr) * zoom, (p[0] * sr + p[1] * cr) * zoom);
    return { x: ox + q.x, y: oy + q.y };
  });
  if (pts.some(p => !isFinite(p.x) || !isFinite(p.y))) return null;
  const extentPx = rSoi * zoom;
  if (_trajCullByExtent(extentPx) || _trajCullRingByDiagonal(extentPx, viewportDiagPx)) return { svg: '', hidden: true };
  const alpha = opts.emphasized ? 1 : _trajLodOpacity(extentPx, _TRAJ_LOD_WIN.transferArc[0], _trajWindowHi(_TRAJ_LOD_WIN.transferArc[1], viewportDiagPx));
  if (alpha <= 0) return { svg: '', hidden: true };
  const d = 'M ' + pts.map((p, i) => (i ? 'L ' : '') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ');
  const stateAlpha = opts.stateAlpha != null ? opts.stateAlpha : 1;
  const opacity = (alpha * (opts.emphasized ? 1 : 0.8) * stateAlpha).toFixed(3);
  const clickAttr = opts.authIdx != null ? ` style="cursor:pointer" onclick="_trajSelectEventFromView('${opts.missionId}',${opts.authIdx})"` : '';
  const color = opts.emphasized ? 'var(--accent)' : (opts.color || 'var(--accent2)');
  const strokeW = opts.emphasized ? 1.2 : 0.7;
  const hit = opts.authIdx != null ? `<path d="${d}" fill="none" stroke="transparent" stroke-width="8"${clickAttr}/>` : '';
  const svg = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeW}"${opts.dashAttr || ''} opacity="${opacity}" vector-effect="non-scaling-stroke"${clickAttr}><title>${opts.title || ''}</title></path>${hit}`;
  return { svg, burn: pts[0], soiEnd: pts[pts.length - 1], extentPx, alpha };
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
  const r = _trajBodyPxR(3, zoom); // render units ≈ px
  const marker = `<circle cx="0" cy="0" r="${r.toFixed(2)}" fill="none" stroke="var(--text-dim)" stroke-width="0.8" stroke-dasharray="1.5,1.5" pointer-events="none"/>`;
  const lines = [{ text: `${bodyName} at arrival`, dy: -4 - r, fontPx: 9, color: 'var(--text-dim)' }];
  _trajRegisterLabel(x, y, lines, 'zone', { screenSize: r, minSize: 0, selected: false, marker, opacity: alpha * 0.8 });
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
      // transit orbits live in the Sun frame with body 'Sun' — their ring
      // radius comes from the destination planet (same rule as the arc renderer)
      const hr = o => o ? PROG_HELIO_R[o.type === 'transit' ? o.destination : o.body] : null;
      const r1 = hr(leg.fromO), r2 = hr(leg.toO);
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

// ── Planet-phase calibration — RETIRED (R1, 2026-07-09) ─────────────────────
// The per-mission calibration fiction (_trajGetPlanetCalibration /
// progCalibratedTheta0, old MATH.md §7a) existed only because the rails were
// schematic circles: a Hohmann arc could not otherwise land on its planet.
// With real ephemeris rails (360), real phases connect (or honestly don't —
// a leg that can't connect at its authored MET renders converged:false via
// the physics side-table, and the schematic fallback arc shows a ghost
// marker at the true arrival position). progBodyWorldPosCalibrated survives
// as a thin alias that ignores its overrides argument.

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
      // A transit orbit's `body` is 'Sun' (the frame it lives in) — its ring
      // radius on the heliocentric map comes from its DESTINATION planet, not
      // its body field. Resolving by body alone made every interplanetary arc
      // silently bail here (r2 === undefined) — the transit-vs-body split, again.
      const heliR = o => {
        if (!o) return null;
        const key = o.type === 'transit' ? o.destination : o.body;
        return (key != null && PROG_HELIO_R[key] != null) ? PROG_HELIO_R[key] : null;
      };
      const r1 = heliR(leg.fromO);
      const r2 = heliR(leg.toO);
      if (r1 == null || r2 == null) return;
      // Moon-lead orientation (C2): rotate so the arrival end lands on the
      // DESTINATION BODY'S POSITION AT ARRIVAL TIME (t_arrive), not a
      // schematic fixed angle — same rule as the local-body case below,
      // just resolved in heliocentric coords for interplanetary legs.
      const destBody = leg.toO.destination || leg.toO.body || leg.toLabel;
      const tArrive = leg.metArrive != null ? leg.metArrive : vt;

      // (R1: the 'second leg to the same planet' ghost treatment retired with
      // the calibration — every leg renders against the same real ephemeris.)

      // ── P3: physics polyline (heliocentric leg) — drawn ONLY when the
      // propagation actually reached its destination SOI (converged). An
      // unconverged ballistic polyline is a green line to nowhere (user-
      // reported on the Venus transfer, 2026-07-09) while the schematic
      // calibrated arc DOES visually connect — pre-P4 (no targeting), the
      // schematic is the more honest picture of intent. P4's shooter flips
      // these legs to converged and they graduate to physics rendering.
      if (typeof physMissionLeg === 'function' && leg.authIdx != null) {
        const physLegS = physMissionLeg(id, leg.authIdx);
        if (physLegS && physLegS.converged && physLegS.samples && physLegS.samples.length) {
          const phys = _trajPhysLegRender({ m, leg, physLeg: physLegS, body: 'Sun', ox, oy, zoom, viewportDiagPx, vt, emphasized, title: hoverTitle, depMarker: true, arrMarker: true, calib });
          if (phys != null) { out += phys; return; }
        }
      }

      let rotAng = _trajPlanetAngle(leg.fromO.body);
      let ghostP = null, arrivalTargetP = null;
      if (destBody && PROG_HELIO_R[destBody] != null && typeof progBodyWorldPos === 'function') {
        // R2: the arc's ROTATION is planar geometry (solved in the unprojected
        // ecliptic plane); marker/ghost POSITIONS project through the camera
        // so they land on the drawn planet under tilt.
        const arrWorld = progBodyWorldPos(destBody, tArrive);
        rotAng = _trajArcRotationForTarget(0, 0, arrWorld.x, arrWorld.y); // planar
        const aq = _trajProj3(arrWorld.x, arrWorld.y, arrWorld.z || 0);
        arrivalTargetP = { x: ox + aq.x * zoom, y: oy + aq.y * zoom };
        const viewWorld = progBodyWorldPos(destBody, vt);
        const vq = _trajProj3(viewWorld.x, viewWorld.y, viewWorld.z || 0);
        const viewP = { x: ox + vq.x * zoom, y: oy + vq.y * zoom };
        if (Math.hypot(viewP.x - arrivalTargetP.x, viewP.y - arrivalTargetP.y) > 3) ghostP = arrivalTargetP;
      }
      const arc = _trajArcProjectedPath(r1, r2, scale, rotAng, ox, oy);
      const arcExtentPx = Math.hypot(arc.depX - arc.arrX, arc.depY - arc.arrY) / 2;
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
        const dl = _trajArcPointAt(r1, r2, scale, rotAng, 0, 0, frac);
        const dq = _trajProjLocal(dl.x, dl.y);
        out += `<circle cx="${(ox + dq.x).toFixed(2)}" cy="${(oy + dq.y).toFixed(2)}" r="2.2" fill="var(--accent)" stroke="var(--nm-bg)" stroke-width="0.6" vector-effect="non-scaling-stroke"><title>Vehicle position (schematic — linear path fraction, not true orbital speed)</title></circle>`;
      }
      if (ghostP) out += _trajGhostMarker(ghostP.x, ghostP.y, destBody, zoom, arcAlpha * stateAlpha);
      return;
    }

    // (R1: local-frame 'second leg' ghost variant retired with calibration.)

    // ── P3: physics polyline, LOCAL-frame portion. Two cases:
    // (a) the leg's OWN physics record has samples in this frame (e.g. the
    //     TLC injection leg drawn at Earth — the spiral/ellipse out); and
    // (b) an ARRIVAL leg (fromO transit) drawn in the destination's own
    //     frame — the propagation lives on the earlier INJECTION leg, whose
    //     destination-frame samples carry the hyperbolic approach (this
    //     replaces the schematic SOI-fallback arc when the physics actually
    //     reached the body). Clicking the polyline selects THIS frame's
    //     authored event (injection at Earth, arrival burn at the Moon).
    if (typeof physMissionLeg === 'function' && leg.authIdx != null) {
      const physLegL = physMissionLeg(id, leg.authIdx);
      // (a) the leg's OWN physics record: the HOME pass draws the WHOLE
      // continuous path (all frames, glued via anchorOf) — converged only,
      // same rule as the Sun branch (unconverged = schematic fallback).
      if (physLegL && physLegL.converged && physLegL.samples && physLegL.samples.length) {
        const phys = _trajPhysLegRender({ m, leg, physLeg: physLegL, body, ox, oy, zoom, viewportDiagPx, vt, emphasized, title: hoverTitle, depMarker: true, arrMarker: false, calib });
        if (phys != null) { out += phys; return; }
      }
      if (leg.fromO && leg.fromO.type === 'transit') {
        const inj = _trajPhysInjectionLegFor(m, leg.authIdx, body);
        // (b) ARRIVAL leg at the destination frame: the approach curve was
        // already drawn (continuously) by the injection leg's home pass — do
        // NOT redraw it here. Emit ONLY the arrival burn marker at the clip
        // point (the mission's arrival-burn moment on the propagated path).
        if (inj && inj.converged && inj.samples && inj.samples.some(s => s.frame === body)) {
          const clipT = _trajPhysClipT(m, inj);
          const anchorLocal = f => f === body ? { x: ox, y: oy } : null;
          const lastLocalT = inj.samples.reduce((acc, s) => (s.frame === body && s.t > acc ? s.t : acc), -Infinity);
          const tMark = Math.min(isFinite(clipT) ? clipT : Infinity, lastLocalT);
          const pos = isFinite(tMark) ? _trajPolylinePointAt(inj, anchorLocal, zoom, tMark) : null;
          if (pos) {
            _trajBurnMarker(pos.x, pos.y, 'down', _trajDvText(leg.dv), leg.metArrive != null ? _metFmt(leg.metArrive) : '',
              Object.assign(markerOpts(physSoiRadius(body) * zoom), { opacity: stateAlpha }));
            return;
          }
        }
        // ── P3: capture spur — an INTERPLANETARY arrival with no physics
        // samples at this body (unconverged pre-P4 aim is expected) draws the
        // analytic capture hyperbola from the SOI edge down to the arrival
        // orbit instead of the arbitrary R*20 schematic fallback. Incoming
        // asymptote anti-parallel to the schematic arrival v∞ direction
        // (≈ −v_planet for arrivals from an inner origin, +v_planet from an
        // outer one) — a schematic mirror of the departure geometry, per
        // MATH.md §7f.
        if (leg.fromO.body === 'Sun' && (leg.fromO.c3 > 0) && PROG_HELIO_R[body] != null && typeof physBodyStateAt === 'function') {
          const rpArr = _trajLocalRadius(leg.toO, body);
          if (rpArr != null) {
            const tArrSpur = leg.metArrive != null ? leg.metArrive : vt;
            const vArr = physBodyStateAt(body, tArrSpur).v;
            const originB = leg.fromO.departure_body || 'Earth';
            const fromInner = PROG_HELIO_R[originB] != null && PROG_HELIO_R[originB] < PROG_HELIO_R[body];
            // SOI entry point sits UP-stream of the incoming v∞ direction:
            // vInf ≈ −v_planet (from inner) → far end along +v_planet; mirrored otherwise.
            const farAng = Math.atan2(fromInner ? vArr[1] : -vArr[1], fromInner ? vArr[0] : -vArr[0]);
            const spurDash = legState === 'planned' ? ' stroke-dasharray="2.5,2"' : '';
            const spur = _trajEscapeSpurSVG(body, rpArr, leg.fromO.c3, farAng, true, zoom, ox, oy, viewportDiagPx,
              { emphasized, color: leg.color, dashAttr: spurDash, stateAlpha, missionId: id, authIdx: leg.authIdx, title: hoverTitle });
            if (spur != null) {
              out += spur.svg;
              if (!spur.hidden) _trajBurnMarker(spur.burn.x, spur.burn.y, 'down', _trajDvText(leg.dv), _metFmt(leg.metArrive), Object.assign(markerOpts(spur.extentPx), { opacity: stateAlpha }));
              return;
            }
          }
        }
      }
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
      // R2: rotation solved in the PLANAR ecliptic (arc geometry lives there);
      // marker/ghost positions project through the pass camera.
      const arrTheta = progBodyAngleAt(destMoon, tArrive);
      const rL = PROG_MOON_ORBITS[destMoon].r * scale;
      rotAng = _trajArcRotationForTarget(0, 0, rL * Math.cos(arrTheta), rL * Math.sin(arrTheta)); // planar
      const aq = _trajProjLocal(rL * Math.cos(arrTheta), rL * Math.sin(arrTheta));
      const arrLocal = { x: ox + aq.x, y: oy + aq.y };
      const viewTheta = progBodyAngleAt(destMoon, vt);
      const vq = _trajProjLocal(rL * Math.cos(viewTheta), rL * Math.sin(viewTheta));
      if (Math.hypot(vq.x - aq.x, vq.y - aq.y) > 3) ghostLocal = { p: arrLocal, body: destMoon };
    }
    const arc = _trajArcProjectedPath(fromR, arcToR, scale, rotAng, ox, oy);
    const arcExtentPx = Math.hypot(arc.depX - arc.arrX, arc.depY - arc.arrY) / 2;
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
        const dl = _trajArcPointAt(fromR, arcToR, scale, rotAng, 0, 0, frac);
        const dq = _trajProjLocal(dl.x, dl.y);
        out += `<circle cx="${(ox + dq.x).toFixed(2)}" cy="${(oy + dq.y).toFixed(2)}" r="2.2" fill="var(--accent)" stroke="var(--nm-bg)" stroke-width="0.6" vector-effect="non-scaling-stroke"><title>Vehicle position (schematic — linear path fraction, not true orbital speed)</title></circle>`;
      }
    } else {
      _trajBurnMarker(arc.depX, arc.depY, 'up', _trajDvText(leg.dv), _metFmt(leg.met), Object.assign(markerOpts(arcExtentPx), { opacity: stateAlpha }));
    }
    if (ghostLocal) out += _trajGhostMarker(ghostLocal.p.x, ghostLocal.p.y, ghostLocal.body, zoom, arcAlpha * stateAlpha);
  });

  // ── P3: SOI departure spurs — an interplanetary injection leg lives in the
  // SUN frame's leg list (frameId 'Sun'), so the departure body's own local
  // frame previously showed nothing for it. Draw the escape hyperbola from
  // the parking ring out to the SOI edge, outgoing asymptote along the
  // departure body's heliocentric velocity (prograde for outbound/superior
  // destinations, retrograde for inbound). Embedded body-frame content: this
  // runs INSIDE _trajBodyFrameContent so it inherits the body's zoiAlpha from
  // the caller's <g opacity> wrapper (one fade authority); its own extent
  // LOD-gates through the transferArc window inside _trajEscapeSpurSVG.
  if (!isSun && PROG_HELIO_R[body] != null && frames['Sun'] && typeof physBodyStateAt === 'function') {
    (frames['Sun'].legs || []).forEach(sleg => {
      const toO = sleg.toO;
      if (!toO || toO.type !== 'transit' || toO.body !== 'Sun') return;
      if ((toO.departure_body || 'Earth') !== body) return;
      const dest = toO.destination;
      if (!dest || PROG_HELIO_R[dest] == null || !(toO.c3 > 0)) return;
      const rp = _trajLocalRadius(sleg.fromO, body);
      if (rp == null) return;
      const emphasized = selAuthIdx != null && sleg.authIdx === selAuthIdx;
      const tDep = sleg.met != null ? sleg.met : 0;
      const vDep = physBodyStateAt(body, tDep).v;
      const outbound = PROG_HELIO_R[dest] > PROG_HELIO_R[body];
      const farAng = Math.atan2(outbound ? vDep[1] : -vDep[1], outbound ? vDep[0] : -vDep[0]);
      // leg state: the spur is flown right after the (impulsive) injection
      // burn; it dims to history once the transit has fully arrived (clip
      // time from the propagated leg when available).
      const physLegD = (typeof physMissionLeg === 'function' && sleg.authIdx != null) ? physMissionLeg(id, sleg.authIdx) : null;
      const clipT = physLegD ? _trajPhysClipT(m, physLegD) : Infinity;
      const legState = vt < tDep ? 'planned' : (isFinite(clipT) && vt >= clipT ? 'history' : 'current');
      const stateAlpha = legState === 'history' ? _TRAJ_HISTORY_ALPHA : 1;
      const dashAttr = legState === 'planned' ? ' stroke-dasharray="2.5,2"' : '';
      const title = `${sleg.vehName ? sleg.vehName + ' — ' : ''}${sleg.fromLabel} → ${sleg.toLabel} — escape hyperbola to ${body} SOI`;
      const spur = _trajEscapeSpurSVG(body, rp, toO.c3, farAng, false, zoom, ox, oy, viewportDiagPx,
        { emphasized, color: sleg.color, dashAttr, stateAlpha, missionId: id, authIdx: sleg.authIdx, title });
      if (spur && !spur.hidden) {
        out += spur.svg;
        _trajBurnMarker(spur.burn.x, spur.burn.y, 'up', _trajDvText(sleg.dv), _metFmt(tDep),
          { emphasized, authIdx: sleg.authIdx, missionId: id, title, zoom, screenSize: spur.extentPx, opacity: stateAlpha });
      }
    });
  }

  // ── P4: MNODE legs — vector burns live ONLY in the physics side-table
  // (they're not node-map maneuvers, so the schematic extraction never sees
  // them). Rendered UNCONDITIONALLY (no converged gate): a maneuver node's
  // ballistic path IS the content — user-authored intent, drawn wherever it
  // goes. Same _trajPhysLegRender path (continuous multi-frame anchorOf
  // gluing, transferArc LOD window, click selects the MNODE event).
  if (typeof _physTrajByMission !== 'undefined' && _physTrajByMission[id]) {
    (_physTrajByMission[id].legs || []).forEach(L => {
      if (L.kind !== 'mnode' || !L.samples || !L.samples.length) return;
      const home = L.homeFrame || (L.samples[0] && L.samples[0].frame);
      if (home !== body) return;
      const ev = (m.log || [])[L.authIdx];
      const dv = (ev && ev.dvRequired) || (L.dv_ms != null ? Math.round(L.dv_ms) : null);
      const title = `Vector burn${dv ? ' &middot; ' + _trajDvText(dv) : ''}${L.met != null ? ' &middot; ' + _metFmt(L.met) : ''}`;
      const legRec = { authIdx: L.authIdx, dv, color: null, fromLabel: 'Vector burn', toLabel: '' };
      const phys = _trajPhysLegRender({ m, leg: legRec, physLeg: L, body, ox, oy, zoom, viewportDiagPx, vt,
        emphasized: selAuthIdx != null && L.authIdx === selAuthIdx, title, depMarker: true, arrMarker: false, calib });
      if (phys) out += phys;
    });
  }

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
// actual drawn position any more (that now comes from progBodyWorldPos —
// real ephemeris since R1).
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
  const calib = null;      // R1: planet-phase calibration retired (real ephemeris)
  const overrides = {};    // kept for downstream signature stability; ignored by the alias
  const camCenter = _trajCamCenterKm(cam, viewT, overrides); // heliocentric km — the ONE floating-origin subtraction point
  const rectW = (rect && rect.width > 0) ? rect.width : 400, rectH = (rect && rect.height > 0) ? rect.height : 400;
  const viewportDiagPx = Math.sqrt(rectW * rectW + rectH * rectH);

  // R2: arm the pass projection context — EVERY emission below (positions,
  // rings, arcs, spurs, physics samples, grid) projects through it.
  _trajProjCtx = { az: cam.az || 0, el: cam.el != null ? cam.el : Math.PI / 2 };
  const tilt = Math.PI / 2 - _trajProjCtx.el;

  // World-to-render: heliocentric km -> PROJECTED render units (floating
  // origin, 3D camera rotation, then ×zoom so the emitted coordinate space is
  // always ~viewBox-sized — the software-rasterizer precision discipline).
  // Carries `depth` (km, camera view axis) for painter sorting.
  const toRender = (worldX, worldY, worldZ) => {
    const p = _trajProj3(worldX - camCenter.x, worldY - camCenter.y, (worldZ || 0) - camCenter.z);
    return { x: p.x * zoom, y: p.y * zoom, depth: p.depth };
  };

  // R2 painter records: {depth, svg}. Rings/grid use -Infinity (always behind
  // glyphs — a ring spans all depths, exact painter order is undefined for it
  // anyway); bodies use their projected center depth. STABLE sort keeps the
  // pre-R2 layering as the tiebreak at el=90° where depths degenerate.
  const records = [];
  const emit = (depth, svg) => { if (svg) records.push({ depth, svg }); };

  // ── ecliptic reference grid (visible only when tilted) ────────────────────
  if (tilt > 0.17) {
    const gridAlpha = Math.min(0.35, Math.sin(tilt) * 0.4);
    let step = Math.pow(10, Math.floor(Math.log10(cam.wKm / 4)));
    if (cam.wKm / step > 8) step *= 2;
    let g = '';
    for (let k = 1; k <= 4; k++) {
      const rKm = step * k;
      const pts = [];
      for (let s = 0; s <= 72; s++) {
        const a = 2 * Math.PI * s / 72;
        const q = _trajProjLocal(Math.cos(a) * rKm * zoom, Math.sin(a) * rKm * zoom);
        pts.push((s ? 'L ' : 'M ') + q.x.toFixed(2) + ' ' + q.y.toFixed(2));
      }
      g += `<path d="${pts.join(' ')}" fill="none" stroke="var(--border)" stroke-width="0.5" opacity="${gridAlpha.toFixed(3)}" vector-effect="non-scaling-stroke"/>`;
    }
    const ax = _trajProjLocal(step * 4 * zoom, 0), ay = _trajProjLocal(0, step * 4 * zoom);
    g += `<line x1="${(-ax.x).toFixed(2)}" y1="${(-ax.y).toFixed(2)}" x2="${ax.x.toFixed(2)}" y2="${ax.y.toFixed(2)}" stroke="var(--border)" stroke-width="0.5" opacity="${(gridAlpha * 0.7).toFixed(3)}" vector-effect="non-scaling-stroke"/>`;
    g += `<line x1="${(-ay.x).toFixed(2)}" y1="${(-ay.y).toFixed(2)}" x2="${ay.x.toFixed(2)}" y2="${ay.y.toFixed(2)}" stroke="var(--border)" stroke-width="0.5" opacity="${(gridAlpha * 0.7).toFixed(3)}" vector-effect="non-scaling-stroke"/>`;
    emit(-Infinity, g);
  }

  // ── true-geometry orbit ring (R2): sampled real ellipse, projected ────────
  // centerP = the PRIMARY's projected render position; el = orbit elements.
  const trueRingPath = (el, centerP, alphaStr, color) => {
    const pts = progOrbitSamplePoints(el, 120);
    let d = '';
    for (let k = 0; k < pts.length; k++) {
      const q = _trajProj3(pts[k][0], pts[k][1], pts[k][2]);
      const x = centerP.x + q.x * zoom, y = centerP.y + q.y * zoom;
      if (!isFinite(x) || !isFinite(y)) return '';
      d += (k ? ' L ' : 'M ') + x.toFixed(2) + ' ' + y.toFixed(2);
    }
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="0.6" opacity="${alphaStr}" vector-effect="non-scaling-stroke"/>`;
  };

  // ── Sun (drawn unless off-screen — the heliocentric origin) ───────────────
  {
    const p = toRender(0, 0, 0);
    if (!_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) {
      const sunScale = _trajLocalScaleFor('Sun', m) * zoom; // km -> render units
      let s = _trajGlyph(p.x, p.y, _trajBodyPxR(6, zoom), _trajBodyColor('Sun'), 'Sun', zoom, cam.anchorBody === 'Sun', false, m && m.missionId);
      s += _trajBodyFrameContent('Sun', m, sunScale, zoom, p.x, p.y, viewportDiagPx, viewT, overrides, calib);
      emit(p.depth, s);
    }
  }

  // ── planets: TRUE heliocentric orbit + glyph + embedded mission content ───
  Object.keys(PROG_HELIO_R).forEach(body => {
    const worldR = PROG_HELIO_R[body]; // mean radius — LOD/culling only; drawing is true-geometry
    const ringScreenR = worldR * zoom;
    const sunP = toRender(0, 0, 0);
    const sunOffscreen = _trajCullPositionOffscreen(sunP.x, sunP.y, viewportDiagPx);
    const ringAlpha = _trajLodOpacity(ringScreenR, _TRAJ_LOD_WIN.heliocentricRing[0], _trajWindowHi(_TRAJ_LOD_WIN.heliocentricRing[1], viewportDiagPx));
    if (!sunOffscreen && !_trajCullRingByDiagonal(ringScreenR, viewportDiagPx) && ringAlpha > 0) {
      const oel = progBodyOrbitElementsAt(body, viewT);
      if (oel) emit(-1e17, trueRingPath(oel, sunP, (0.55 * ringAlpha).toFixed(3), _trajBodyColor(body)));
    }
    const wp = progBodyWorldPos(body, viewT);
    const p = toRender(wp.x, wp.y, wp.z);
    if (_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) return;
    const trueR = 3;
    // "Far representation" (C2): the NAME label is force-eligible whenever the
    // disc has hit its min-px clamp — all planets keep names at solar zoom.
    const forceLabel = (trueR * zoom) < _TRAJ_MIN_BODY_PX;
    let s = '';
    if (!_trajCullByExtent(_trajBodyPxR(trueR, zoom))) {
      s += _trajGlyph(p.x, p.y, _trajBodyPxR(trueR, zoom), _trajBodyColor(body), body, zoom, cam.anchorBody === body, forceLabel, m && m.missionId);
    }
    // Zone-of-influence content: single fade authority for everything embedded
    // at this body (moons in the next pass share the same gate via zoiAlpha).
    const localScale = _trajLocalScaleFor(body, m) * zoom; // km -> render units
    const neighborhoodExtentPx = _trajBodyPxR(trueR, zoom);
    const zoiAlpha = _trajLodOpacity(Math.max(neighborhoodExtentPx, _trajBodyNeighborhoodPx(body, zoom, m)), _TRAJ_LOD_WIN.zoneOfInfluence[0], Infinity);
    if (zoiAlpha > 0) {
      const contentSvg = _trajBodyFrameContent(body, m, localScale, zoom, p.x, p.y, viewportDiagPx, viewT, overrides, calib);
      s += zoiAlpha < 1 ? `<g opacity="${zoiAlpha.toFixed(3)}">${contentSvg}</g>` : contentSvg;
    }
    emit(p.depth, s);
  });

  // ── moons: TRUE orbit around parent + glyph, embedded mission content ─────
  Object.entries(PROG_MOON_ORBITS || {}).forEach(([name, mo]) => {
    const parentWP = progBodyWorldPos(mo.parent, viewT);
    const parentP = toRender(parentWP.x, parentWP.y, parentWP.z);
    const parentOffscreen = _trajCullPositionOffscreen(parentP.x, parentP.y, viewportDiagPx);
    const ringScreenR = mo.r * zoom;
    // Moon ring is part of its PARENT's zone-of-influence (single fade authority).
    const parentZoiAlpha = _trajLodOpacity(Math.max(ringScreenR, _trajBodyPxR(3, zoom)), _TRAJ_LOD_WIN.zoneOfInfluence[0], Infinity);
    if (!parentOffscreen && !_trajCullRingByDiagonal(ringScreenR, viewportDiagPx) && !_trajCullByExtent(ringScreenR) && parentZoiAlpha > 0) {
      const oel = progBodyOrbitElementsAt(name, viewT);
      if (oel) emit(-1e17, trueRingPath(oel, parentP, (0.55 * parentZoiAlpha).toFixed(3), _trajBodyColor(name)));
    }
    if (parentZoiAlpha <= 0) return; // moon (and its content) hidden with its parent's ZOI
    const wp = progBodyWorldPos(name, viewT);
    const p = toRender(wp.x, wp.y, wp.z);
    if (_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) return;
    const trueR = 3;
    let s = '';
    if (!_trajCullByExtent(_trajBodyPxR(trueR, zoom))) {
      const glyphSvg = _trajGlyph(p.x, p.y, _trajBodyPxR(trueR, zoom), _trajBodyColor(name), name, zoom, cam.anchorBody === name, false, m && m.missionId);
      s += parentZoiAlpha < 1 ? `<g opacity="${parentZoiAlpha.toFixed(3)}">${glyphSvg}</g>` : glyphSvg;
    }
    const localScale = _trajLocalScaleFor(name, m) * zoom; // km -> render units
    const contentSvg = _trajBodyFrameContent(name, m, localScale, zoom, p.x, p.y, viewportDiagPx, viewT, overrides, calib);
    s += parentZoiAlpha < 1 ? `<g opacity="${parentZoiAlpha.toFixed(3)}">${contentSvg}</g>` : contentSvg;
    emit(p.depth, s);
  });

  // painter: back-to-front (ascending depth), STABLE — emission order is the
  // tiebreak, preserving pre-R2 layering at el=90° where depths degenerate.
  return records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.depth - b.r.depth) || (a.i - b.i))
    .map(x => x.r.svg)
    .join('');
}

// A body's "neighborhood" radius in km — the ONE definition shared by the
// fly-to fit and the zone-of-influence LOD gate, so any camera that frames a
// body's content also opens the gate that draws it. (They were separate
// definitions before: the gate counted only moon rings, so moonless planets'
// mission content NEVER rendered at any zoom — MATH.md critique 26, fixed.)
function _trajBodyNeighborhoodKm(body, m) {
  const moons = _trajMoonsOf(body);
  const moonR = moons.length ? Math.max(...moons.map(mo => mo.r)) : 0;
  const contentR = m ? _trajMissionExtentForBody(body, m) : 0;
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  return Math.max(moonR, contentR, R * 4);
}

function _trajBodyNeighborhoodPx(body, zoom, m) {
  return _trajBodyNeighborhoodKm(body, m) * (zoom || 1);
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
// Click a body glyph to anchor the camera on it (fly-to) — guarded against
// the click that ends a real drag, same pattern as _trajSelectEventFromView.
function trajGlyphClick(id, body) {
  if (_trajJustDragged) { _trajJustDragged = false; return; }
  trajSetFocus(id, body);
}

function _trajGlyph(cx, cy, r, color, label, zoom, isFocus, forceLabel, clickId) {
  // Body name inherits the body's own chrome color (theme var) so labels read
  // as belonging to their glyph rather than a flat gray sheet of names.
  _trajRegisterLabel(cx, cy - r, [{ text: label, dy: -4, fontPx: 10, color: color || 'var(--nm-label)' }], 'body',
    { screenSize: r, minSize: _TRAJ_LOD_BODY_MIN, selected: !!isFocus || !!forceLabel });
  const clickAttr = clickId ? ` style="cursor:pointer" onclick="trajGlyphClick('${clickId}','${label}')"` : '';
  if (clickId) {
    return `<g${clickAttr}>
    <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r}" fill="${color}" stroke="var(--border-bright)" stroke-width="0.5" vector-effect="non-scaling-stroke"><title>Fly to ${label}</title></circle>
    <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${Math.max(r, 7)}" fill="transparent"/>
  </g>`;
  }
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
// Returns the disc radius in RENDER UNITS (km·zoom ≈ px): true-scale when
// zoomed in, clamped to the min-px floor when zoomed out. (Pre-normalization
// this returned km and callers multiplied by zoom for px math.)
function _trajBodyPxR(trueR, zoom) {
  const z = zoom || 1;
  return Math.max(trueR * z, _TRAJ_MIN_BODY_PX);
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
  // Constant-unit viewBox (geometry is emitted in km·zoom render units) —
  // square default; aspect corrected post-mount by _missionTrajAfterRender.
  const viewBox = `${(-_TRAJ_VB / 2).toFixed(3)} ${(-_TRAJ_VB / 2).toFixed(3)} ${_TRAJ_VB.toFixed(3)} ${_TRAJ_VB.toFixed(3)}`;

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
        <button class="act-btn" onclick="trajResetView('${id}')" title="Reset zoom/pan/orientation (top-down)">&#x21BA; Reset</button>
      </div>
      <div class="traj-canvas" onwheel="trajWheelZoom(event,'${id}')"
           onmousedown="trajPanStart(event,'${id}')" onmousemove="trajPanMove(event)"
           onmouseup="trajPanEnd()" onmouseleave="trajPanEnd()" oncontextmenu="return false">
        ${hintChip}
        <svg class="traj-svg" data-mid="${id}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">
          <g class="traj-scene" data-mid="${id}">
            ${svgInner}
          </g>
        </svg>
        <svg class="traj-overlay" data-mid="${id}" preserveAspectRatio="none"></svg>
      </div>
      <div class="traj-footer">${_trajFooterHTML(cam)}</div>
    </div>`;
}

// R2: footer text incl. the orientation readout — also refreshed by
// _trajApplyCam so rotate-drag keeps it live without a full panel rebuild.
function _trajFooterHTML(cam) {
  const elDeg = Math.round(((cam.el != null ? cam.el : Math.PI / 2) * 180 / Math.PI));
  const azDeg = Math.round((((cam.az || 0) * 180 / Math.PI) % 360 + 360) % 360);
  const orientTxt = elDeg < 89 ? `az ${azDeg}&deg; &middot; tilt ${90 - elDeg}&deg; &middot; ` : '';
  return `${orientTxt}true-geometry orbits (JPL mean elements; vessel orbit planes: from flight where flown, &Omega;=0 otherwise) &middot; shift/right-drag rotates &middot; body sizes clamped for visibility`;
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
    const vbH = _TRAJ_VB * aspect;
    svgEl.setAttribute('viewBox', `${(-_TRAJ_VB / 2).toFixed(3)} ${(-vbH / 2).toFixed(3)} ${_TRAJ_VB.toFixed(3)} ${vbH.toFixed(3)}`);
    const sceneEl = svgEl.querySelector('g.traj-scene');
    if (sceneEl && typeof _missions !== 'undefined') {
      const mm = (_missions || []).find(x => x.missionId === id);
      const zoom = _trajZoomFromCam(cam);
      _trajResetLabels();
      _trajExtractionCache = { missionId: null, data: null };
      sceneEl.innerHTML = _trajWorldSVG(mm, cam, zoom, rect);
      if (overlayEl) {
        overlayEl.style.transform = ''; // clear any mid-drag pan slide
        overlayEl.setAttribute('width', rect.width);
        overlayEl.setAttribute('height', rect.height);
        overlayEl.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
        const renderCam = { cx: 0, cy: 0, w: _TRAJ_VB };
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
