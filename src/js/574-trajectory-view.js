
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
// center = worldPos(anchorBody, viewTime) + relOffsetKm. R3.4: drag-pan and
// cursor-anchored zoom are RETIRED (KSP camera semantics — see PHYSICS_PLAN
// R3.4 item 1); relOffsetKm is only ever written as {0,0} now (wheel zoom is
// a pure wKm change, drag always rotates az/el). The field stays on the
// camera struct because the fit/zoom-to-content math still reads it. Changing
// the selected event (which moves viewTime) leaves anchor+offset untouched, so
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
  // R6.3 handedness fix (2026-07-11): world coords use the standard
  // right-handed ecliptic convention (+z north, CCW prograde motion/east
  // longitude as seen from +z looking down: x-right, y-UP). SVG screen space
  // is y-DOWN, so plotting world-y directly as screen-y is a reflection —
  // it mirrored geography (Australia rendered left of Asia) AND orbital
  // motion (prograde appeared clockwise) system-wide, since every consumer
  // (surface points, gizmo, hover rails, ring tangents) routes through this
  // one seam. R6.3b (user flight-test): the first fix negated screen-Y, which
  // repairs chirality but points north DOWN at tilted views (the tilt term's
  // sign flipped with it) — the world read as "flipped 180°". Negating
  // screen-X instead is the other det=−1 reflection: chirality fixed AND the
  // north pole tilts toward the TOP of the screen (+z → v=−z·st → up in SVG's
  // y-down space). See MATH.md §7o.
  return { x: -xa, y: ya * ct - (z || 0) * st, depth: ya * st + (z || 0) * ct };
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
    _trajReconcileGlobeLayer(svgEl); // R6.4c: patch persistent globe images in place (no flicker)
    if (overlayEl && rect.width > 0 && rect.height > 0) {
      overlayEl.style.transform = ''; // clear any mid-drag pan slide
      overlayEl.setAttribute('width', rect.width);
      overlayEl.setAttribute('height', rect.height);
      overlayEl.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
      const renderCam = { cx: 0, cy: 0, w: _TRAJ_VB };
      overlayEl.innerHTML = _trajResolveLabels(renderCam, rect);
      if (typeof _trajGizmoRepaintOverlay === 'function') _trajGizmoRepaintOverlay();
      // R3.5.2: the world re-render just rebuilt g.traj-scene, wiping the
      // gizmo's scene-space preview path — repaint it too, or the previewed
      // trajectory vanishes the moment the user zooms/rotates to look at it.
      if (typeof _trajGizmoRepaintScenePreview === 'function') _trajGizmoRepaintScenePreview();
    }
  }
  const footEl = va.querySelector('.traj-footer'); // R2: keep the az/el readout live
  if (footEl) footEl.innerHTML = _trajFooterHTML(cam);
  // Scrubber: keep thumb/readout/ticks live across camera AND view-time
  // refreshes alike (_trajSetViewTime routes through this same function).
  // outerHTML replaces the track node, so preserve keyboard focus across the
  // swap (arrow-key nudging calls this on every keypress — losing focus
  // would break repeat presses) — the drag path re-queries the track fresh
  // each tick instead of holding a reference, for the same reason.
  const scrubEl = va.querySelector('.traj-scrubber');
  if (scrubEl && typeof _missions !== 'undefined') {
    const mm = (_missions || []).find(x => x.missionId === id);
    if (mm) {
      const hadFocus = scrubEl.contains(document.activeElement);
      scrubEl.outerHTML = _trajScrubberHTML(mm, id);
      if (hadFocus) {
        const t = va.querySelector('.traj-scrub-track');
        if (t) t.focus();
      }
      // Timeline dock lanes: cheap-only refresh (dim-past-viewT segment opacity)
      // in step with the scrub track, without a full missionRenderDetail() pass.
      if (typeof _ttdLanesHTML === 'function') {
        const lanesEl = va.querySelector('.ttd-lanes');
        if (lanesEl) {
          const fresh = _ttdLanesHTML(mm, id);
          if (fresh) lanesEl.outerHTML = fresh;
        }
      }
    }
  }
}

function trajWheelZoom(ev, id) {
  ev.preventDefault();
  if (typeof _trajMarkInteracting === 'function') _trajMarkInteracting();
  const cam = _trajCam(id);
  const dir = ev.deltaY < 0 ? 1 : -1;
  const nextW = Math.max(_TRAJ_WKM_MIN, Math.min(_TRAJ_WKM_MAX, cam.wKm * (1 - dir * 0.15)));
  if (nextW === cam.wKm) return;
  // R3.4: cursor-anchored zoom RETIRES with drag-pan (item 1) — without a way
  // to undo an accumulated offset by panning, a cursor-anchored zoom could
  // walk the view away from the anchor body with no way back. Zoom is now a
  // pure wKm change about the anchor; relOffsetKm stays forced to {0,0}.
  _trajApplyCam(id, Object.assign({}, cam, { relOffsetKm: { x: 0, y: 0 }, wKm: nextW }));
}

let _trajDrag = null;
// Set true when a pan-drag actually moved the pointer (>3px, same threshold as
// the node map's missionNmPanMove) so the click that follows a real drag on an
// interactive arc/marker/ring doesn't also select an event (drag-vs-click
// disambiguation, per the node map / library-browser _didDrag pattern).
let _trajJustDragged = false;
function trajPanStart(ev, id) {
  // R3.4 (KSP semantics): plain left-drag ROTATES by default now (the enabler
  // for a grabbable gizmo — see PHYSICS_PLAN R3.4 item 1). Shift-drag / right-
  // button drag remain aliases for rotate (kept for muscle-memory / R2 users).
  // Drag-PAN is retired entirely — relOffsetKm is only ever written as {0,0}
  // (see _trajCam / trajResetView / trajSetFocus) but the field stays on the
  // camera struct because the fit/zoom math still reads it.
  const mode = 'rotate';
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
  if (typeof _trajMarkInteracting === 'function') _trajMarkInteracting();
  const dx = ev.clientX - _trajDrag.x0, dy = ev.clientY - _trajDrag.y0;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _trajDrag.moved = true;
  const cam0 = _trajDrag.cam0;
  // R3.5 (user flight-test item 3): az already wrapped freely (JS `%` on a
  // growing/shrinking value just cycles, negative results are harmless to
  // sin/cos) — the actual clamp bug was el being pinned to [0.087, π/2], i.e.
  // ONE quarter-turn of tilt only (top-down to just-above-the-horizon), so
  // dragging past the horizon (or trying to look from "below") visibly
  // stalled ("doesn't let me go beyond a certain point"). Loosen el to the
  // full ±(π/2 − 0.01) continuous range (a hair short of the poles, where the
  // az/el decomposition is singular) so drag-rotate reaches every orientation
  // a KSP-style free camera would.
  const az = ((cam0.az || 0) - dx * 0.008) % (2 * Math.PI);
  const elMax = Math.PI / 2 - 0.01;
  const el = Math.max(-elMax, Math.min(elMax, (cam0.el != null ? cam0.el : Math.PI / 2) + dy * 0.008));
  const cam = Object.assign({}, cam0, { relOffsetKm: Object.assign({}, cam0.relOffsetKm), az, el });
  const now = performance.now();
  if (now - _trajRotLastMs > 33) { _trajRotLastMs = now; _trajApplyCam(_trajDrag.id, cam); }
  else _trajCamByMission[_trajDrag.id] = cam;
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

  const addOrbitRing = (body, peri, apo, ownerKeys, authIdx, inc, lan_deg, argp_deg) => {
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
    if (!rec.elements && lan_deg != null) {
      rec.elements = { i: (inc || 0) * Math.PI / 180, raan: lan_deg * Math.PI / 180,
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
      addOrbitRing(o.body || 'Earth', peri, apo, v.owners, e._authIdx, o.inclination, o.lan_deg, o.argp_deg);
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
/** R3.2: pure orientation resolver for a ring record — the ONE place the
 *  three-tier precedence rule (MATH.md §7i) is decided, factored out so it's
 *  unit-testable without constructing a full SVG. tier 1 (authored, source
 *  'authored') and tier 2 (state-derived, source 'flight') are both carried
 *  on rec.elements already (write-order enforced in _trajExtractMission —
 *  authored is stamped at ring creation, before the flight-derived pass can
 *  touch it); this function only has to fall through to tier 3 (default,
 *  Ω=ω=0) when neither is present. Returns {i, raan, argp, source} in RADIANS. */
function _trajRingOrientationFor(rec) {
  if (rec && rec.elements) {
    return { i: rec.elements.i || 0, raan: rec.elements.raan || 0, argp: rec.elements.argp || 0,
      source: rec.elements.source || 'flight' };
  }
  return { i: ((rec && rec.inc) || 0) * Math.PI / 180, raan: 0, argp: 0, source: 'default' };
}

/** R6.5 (2026-07-11): pure apsides finder — samples orbit `elements`
 *  {a,e,i,raan,argp} (radians) via progOrbitSamplePoints and picks the
 *  periapsis/apoapsis POINT by actual radius magnitude (robust against
 *  sampling-convention drift — doesn't blindly trust sample[0]/sample[N/2]
 *  even though that's what progOrbitSamplePoints's E=0/E=pi convention
 *  produces). Points are in the SAME local frame progOrbitSamplePoints
 *  returns (relative to the primary, pre-projection, real km — no `scale`
 *  applied). Pure, no DOM. Gate assertions: tests/math.test.js (2026-07-11). */
function _trajApsePoints(elements, n) {
  const pts = progOrbitSamplePoints(elements, n || 96);
  let periPt = pts[0], apoPt = pts[0], periR = Infinity, apoR = -Infinity;
  for (let k = 0; k < pts.length; k++) {
    const r = Math.hypot(pts[k][0], pts[k][1], pts[k][2]);
    if (r < periR) { periR = r; periPt = pts[k]; }
    if (r > apoR) { apoR = r; apoPt = pts[k]; }
  }
  return { periPt, apoPt, periR, apoR };
}

/** Distance label for an apse marker. `mode:'au'` -> AU (heliocentric rings);
 *  else plain comma-grouped km (moon rings: raw body-centered distance;
 *  mission rings: the caller passes an ALTITUDE-above-surface km value, not
 *  a center distance — see the two call sites). Pure. */
function _trajFmtApseDist(km, mode) {
  if (mode === 'au') return (km / 149597870.7).toFixed(3) + ' AU';
  return Math.round(km).toLocaleString() + ' km';
}

// ── R6.5: trajectory occlusion by opaque bodies (2026-07-11, MATH.md §7m) ──
// Module-local, reset at the top of every _trajWorldSVG pass: the opaque
// discs actually drawn this frame (disc tier only — chips don't occlude),
// collected as {name, cx, cy, depth, R}. cx/cy are RENDER units (km·zoom,
// the same space g.traj-scene draws in); depth/R are REAL km (unscaled) —
// depth in the painter-sort convention (_trajWorldSVG's `toRender`: larger
// depth = nearer the camera, since the painter sorts ascending-depth-first).
let _trajOccludeBodies = [];

/** Pure occlusion predicate: is render-space point (px,py) at camera-relative
 *  depth `pdepthKm` (km, SAME sign convention as the painter-sort depth —
 *  see _trajWorldSVG's `toRender`) hidden behind any opaque body disc in
 *  `bodies`? Derivation (empirically verified against the painter sort, see
 *  MATH.md §7m): a sphere of radius R centered at (cx,cy) with camera-axis
 *  depth `depth` has its NEAR cap (the side facing the camera, i.e. the
 *  LARGEST depth at a given perpendicular offset rho) at
 *  depth + sqrt(R^2 - rho^2). A point is behind that cap — occluded — iff
 *  its own depth is LESS than the near cap's depth at its rho AND it falls
 *  within the disc's silhouette (rho < R). Pure, no DOM. */
function _trajPointOccluded(px, py, pdepthKm, zoom, bodies) {
  if (!bodies || !bodies.length || !(zoom > 0)) return false;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    const rho = Math.hypot(px - b.cx, py - b.cy) / zoom; // render units -> real km
    if (!(rho < b.R)) continue;
    const nearCapDepth = b.depth + Math.sqrt(Math.max(0, b.R * b.R - rho * rho));
    if (pdepthKm < nearCapDepth) return true;
  }
  return false;
}

/** Split a sampled polyline (array of {x,y,depth}, render-units x/y + real-km
 *  depth) into contiguous VISIBLE runs against `bodies` (_trajOccludeBodies),
 *  dropping occluded points and breaking the run at the crossing — same
 *  pattern as _trajHemiClipRuns/viewClampUnits elsewhere in this file.
 *  Exact limb interpolation is NOT done (not required at ring/leg sample
 *  density per the brief) — dropping + breaking is sufficient. Pure. */
function _trajOcclusionSplitRuns(pts, zoom, bodies) {
  const runs = [];
  let cur = null;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    if (_trajPointOccluded(p.x, p.y, p.depth, zoom, bodies)) { cur = null; continue; }
    if (!cur) { cur = []; runs.push(cur); }
    cur.push(p);
  }
  return runs.filter(r => r.length >= 2);
}

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
  // R6.1.2: hover ghost ball + click-to-menu placement, additive to the
  // existing dblclick spawn. Thread the ring's own orbit basis (body/peri/
  // apo/inc) so the hover/menu handlers can build the same mean-motion rail
  // the gizmo's center-knob drag uses (_trajGizmoOrbitNodeAt/_trajRingHoverRail).
  const clickAttr = opts.authIdx != null ? ` style="cursor:pointer" onclick="_trajRingClick('${opts.missionId}',${opts.authIdx},event,'${body}',${rec.peri},${rec.apo},${rec.inc || 0})" ondblclick="_trajGizmoRingDblClick('${opts.missionId}',${opts.authIdx},event)" onmousemove="_trajRingHoverMove(event,'${opts.missionId}','${body}',${rec.peri},${rec.apo},${rec.inc || 0},'${strokeColor}')" onmouseleave="_trajRingHoverLeave('${opts.missionId}')"` : '';
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
  const orient = _trajRingOrientationFor(rec);
  const incRad = orient.i, raanRad = orient.raan, argpRad = orient.argp;
  const pts = progOrbitSamplePoints({ a, e: ecc, i: incRad, raan: raanRad, argp: argpRad }, 96);
  let topX = ox, topY = Infinity;
  // R6.5: the body's own camera-relative depth (real km, unscaled) — threaded
  // by the caller (_trajBodyFrameContent -> oDepth) so ring points can be
  // tested against _trajOccludeBodies; Infinity (never occluded) is the safe
  // default for any call site that hasn't threaded it.
  const centerDepth = opts.centerDepth != null ? opts.centerDepth : Infinity;
  const screenPts = [];
  let periIdx = 0, apoIdx = 0, periRLocal = Infinity, apoRLocal = -Infinity;
  for (let k = 0; k < pts.length; k++) {
    // Projecting the RAW (unscaled) local point then scaling x/y by `scale`
    // is exactly equivalent to projecting the pre-scaled vector (rotation is
    // linear) — and gives depth in REAL km directly (no /scale needed), the
    // same units _trajOccludeBodies' depth/R use.
    const qRaw = _trajProj3(pts[k][0], pts[k][1], pts[k][2]);
    const x = ox + qRaw.x * scale, y = oy + qRaw.y * scale;
    if (!isFinite(x) || !isFinite(y)) return '';
    const depth = centerDepth + qRaw.depth;
    screenPts.push({ x, y, depth });
    if (y < topY) { topY = y; topX = x; }
    const rLocal = Math.hypot(pts[k][0], pts[k][1], pts[k][2]);
    if (rLocal < periRLocal) { periRLocal = rLocal; periIdx = k; }
    if (rLocal > apoRLocal) { apoRLocal = rLocal; apoIdx = k; }
  }
  const periX = screenPts[periIdx].x, periY = screenPts[periIdx].y;
  const incTxt = orient.source === 'authored'
    ? ` &middot; i=${(incRad * 180 / Math.PI).toFixed(1)}&deg; &Omega;=${(raanRad * 180 / Math.PI).toFixed(1)}&deg; (&Omega;,&omega; authored)`
    : orient.source === 'flight'
    ? ` &middot; i=${(incRad * 180 / Math.PI).toFixed(1)}&deg; &Omega;=${(raanRad * 180 / Math.PI).toFixed(1)}&deg; (plane from flight)`
    : (rec.inc ? ` &middot; i=${rec.inc}&deg; (&Omega;,&omega; assumed 0)` : '');
  // R6.5: occlusion — split into visible runs against opaque bodies drawn
  // this frame (a LEO ring's far side hidden by Earth is correct/desired —
  // see MATH.md §7m). Fully-occluded ring (e.g. camera looking straight
  // through the body) renders nothing.
  const visRuns = _trajOcclusionSplitRuns(screenPts, zoom, _trajOccludeBodies);
  if (!visRuns.length) return '';
  const fullD = visRuns.map(run => run.map((p, i) => (i ? 'L ' : 'M ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ')).join(' ');
  const hitArea = opts.authIdx != null ? `<path d="${fullD}" fill="none" stroke="transparent" stroke-width="9"${clickAttr}/>` : '';
  const lines = [{ text: rec.label, dy: -4, fontPx: 10.5, color: 'var(--nm-label)' }];
  _trajRegisterLabel(topX, topY, lines, 'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, opacity: lodAlpha * historyMul });
  if (coastTxt) _trajRegisterLabel(periX, periY - 6, [{ text: coastTxt, dy: 0, fontPx: 10, color: 'var(--nm-label)' }], 'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, opacity: lodAlpha * historyMul });
  // R6.5: apoapsis/periapsis markers — altitude above `body`'s surface (the
  // ring's OWN peri/apo fields already ARE altitudes, not center-distances —
  // see the rp/ra construction above). Skipped individually when their own
  // point is occluded (per-point test, not the whole-ring visRuns gate, since
  // one apse can be visible while the other is hidden behind the body).
  const periAlt = Math.min(rec.peri, rec.apo), apoAlt = Math.max(rec.peri, rec.apo);
  const apseColor = strokeColor;
  const periPt = screenPts[periIdx], apoPt = screenPts[apoIdx];
  if (!_trajPointOccluded(periPt.x, periPt.y, periPt.depth, zoom, _trajOccludeBodies)) {
    const mk = `<path d="M -2.6 2.2 L 0 -2.6 L 2.6 2.2 Z" fill="${apseColor}" stroke="none"/>`;
    _trajRegisterLabel(periPt.x, periPt.y, [{ text: 'Pe', dy: -6, fontPx: 8.5, color: apseColor }, { text: _trajFmtApseDist(periAlt, 'km'), dy: 4, fontPx: 8, color: 'var(--text-dim)' }],
      'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, marker: mk, opacity: lodAlpha * historyMul });
  }
  if (!_trajPointOccluded(apoPt.x, apoPt.y, apoPt.depth, zoom, _trajOccludeBodies)) {
    const mk = `<path d="M -2.6 -2.2 L 0 2.6 L 2.6 -2.2 Z" fill="${apseColor}" stroke="none"/>`;
    _trajRegisterLabel(apoPt.x, apoPt.y, [{ text: 'Ap', dy: -6, fontPx: 8.5, color: apseColor }, { text: _trajFmtApseDist(apoAlt, 'km'), dy: 4, fontPx: 8, color: 'var(--text-dim)' }],
      'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, marker: mk, opacity: lodAlpha * historyMul });
  }
  // R3.5 item 2: direction-of-motion cue — split each VISIBLE run into
  // faint->bright segments (sample order = increasing eccentric anomaly =
  // prograde motion, per progOrbitSamplePoints) instead of one uniform-
  // opacity path, so which way the orbit goes is visible at a glance (KSP
  // fades the trailing side). Segmenting per-run (not across an occlusion
  // break) keeps each visible arc's own fade coherent.
  const segPaths = visRuns.map(run => {
    const segs = _trajRingDirSegments(run, Math.max(1, Math.round(10 * run.length / screenPts.length)));
    if (!segs.length) {
      const segD = run.map((p, i) => (i ? 'L ' : 'M ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ');
      return `<path d="${segD}" fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" opacity="${opacity}" vector-effect="non-scaling-stroke"/>`;
    }
    return segs.map(seg => {
      const segD = seg.pts.map((p, i) => (i ? 'L ' : 'M ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ');
      const segOpacity = (baseOpacity * lodAlpha * historyMul * seg.opacity).toFixed(3);
      return `<path d="${segD}" fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" opacity="${segOpacity}" vector-effect="non-scaling-stroke"/>`;
    }).join('');
  }).join('');
  return `<g${clickAttr}>
    <title>${title}${incTxt}</title>
    ${segPaths}
    ${hitArea}
  </g>`;
}

// Phase 4 U3: propagated-orbit ring — same visual language as _trajRingSVG
// (occlusion, direction fade, apse markers) but the LOOP comes from real
// samples (refOrbitSamplePropagated) instead of a Keplerian ellipse. Reuses
// the same projection/occlusion/label primitives _trajRingSVG uses, kept as
// a separate function since a propagated loop has no (a,e,i,raan,argp) basis
// to route through progOrbitSamplePoints.
function _trajPropagatedRingSVG(rec, body, scale, color, opts) {
  opts = opts || {};
  if (typeof refOrbitSamplePropagated !== 'function') return '';
  const zoom = opts.zoom || 1;
  const viewportDiagPx = opts.viewportDiagPx || Infinity;
  const emphasized = !!opts.emphasized;
  const strokeColor = emphasized ? 'var(--accent)' : (color || (rec.colors.size === 1 ? [...rec.colors][0] : 'var(--accent)'));
  const strokeW = emphasized ? 1.4 : 0.7;
  const baseOpacity = emphasized ? 1 : 0.85;
  const historyMul = opts.historyAlpha != null ? opts.historyAlpha : 1;
  const names = [...rec.names].join(', ');
  const title = `${names ? names + ' — ' : ''}${rec.label} (propagated)`;
  const ox = opts.originX || 0, oy = opts.originY || 0;
  const raw = refOrbitSamplePropagated(rec.refId, 96);
  if (!raw.length) return '';
  let maxR = 0;
  raw.forEach(s => { const d = Math.hypot(s.r[0], s.r[1], s.r[2]); if (d > maxR) maxR = d; });
  const screenSize = maxR * scale;
  if (_trajCullByExtent(screenSize)) return '';
  if (_trajCullRingByDiagonal(screenSize, viewportDiagPx)) return '';
  const lodAlpha = emphasized ? 1 : _trajLodOpacity(screenSize, _TRAJ_LOD_WIN.missionOrbitRing[0], _trajWindowHi(_TRAJ_LOD_WIN.missionOrbitRing[1], viewportDiagPx));
  if (lodAlpha <= 0) return '';
  const opacity = (baseOpacity * lodAlpha * historyMul).toFixed(3);
  const centerDepth = opts.centerDepth != null ? opts.centerDepth : Infinity;
  const screenPts = [];
  let topX = ox, topY = Infinity;
  let periIdx = 0, apoIdx = 0, periRLocal = Infinity, apoRLocal = -Infinity;
  for (let k = 0; k < raw.length; k++) {
    const p = raw[k].r;
    const qRaw = _trajProj3(p[0], p[1], p[2]);
    const x = ox + qRaw.x * scale, y = oy + qRaw.y * scale;
    if (!isFinite(x) || !isFinite(y)) return '';
    const depth = centerDepth + qRaw.depth;
    screenPts.push({ x, y, depth });
    if (y < topY) { topY = y; topX = x; }
    const rLocal = Math.hypot(p[0], p[1], p[2]);
    if (rLocal < periRLocal) { periRLocal = rLocal; periIdx = k; }
    if (rLocal > apoRLocal) { apoRLocal = rLocal; apoIdx = k; }
  }
  const visRuns = _trajOcclusionSplitRuns(screenPts, zoom, _trajOccludeBodies);
  if (!visRuns.length) return '';
  const clickAttr = opts.authIdx != null ? ` style="cursor:pointer" onclick="_trajRingClick('${opts.missionId}',${opts.authIdx},event,'${body}',0,0,0)"` : '';
  const fullD = visRuns.map(run => run.map((p, i) => (i ? 'L ' : 'M ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ')).join(' ');
  const hitArea = opts.authIdx != null ? `<path d="${fullD}" fill="none" stroke="transparent" stroke-width="9"${clickAttr}/>` : '';
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  const periPt = screenPts[periIdx], apoPt = screenPts[apoIdx];
  _trajRegisterLabel(topX, topY, [{ text: rec.label + ' (propagated)', dy: -4, fontPx: 10.5, color: 'var(--nm-label)' }],
    'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, opacity: lodAlpha * historyMul });
  if (!_trajPointOccluded(periPt.x, periPt.y, periPt.depth, zoom, _trajOccludeBodies)) {
    const mk = `<path d="M -2.6 2.2 L 0 -2.6 L 2.6 2.2 Z" fill="${strokeColor}" stroke="none"/>`;
    _trajRegisterLabel(periPt.x, periPt.y, [{ text: 'Pe', dy: -6, fontPx: 8.5, color: strokeColor }, { text: _trajFmtApseDist(Math.max(0, periRLocal - R), 'km'), dy: 4, fontPx: 8, color: 'var(--text-dim)' }],
      'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, marker: mk, opacity: lodAlpha * historyMul });
  }
  if (!_trajPointOccluded(apoPt.x, apoPt.y, apoPt.depth, zoom, _trajOccludeBodies)) {
    const mk = `<path d="M -2.6 -2.2 L 0 2.6 L 2.6 -2.2 Z" fill="${strokeColor}" stroke="none"/>`;
    _trajRegisterLabel(apoPt.x, apoPt.y, [{ text: 'Ap', dy: -6, fontPx: 8.5, color: strokeColor }, { text: _trajFmtApseDist(Math.max(0, apoRLocal - R), 'km'), dy: 4, fontPx: 8, color: 'var(--text-dim)' }],
      'orbit', { screenSize, minSize: _TRAJ_LOD_RING_MIN, selected: emphasized, marker: mk, opacity: lodAlpha * historyMul });
  }
  const segPaths = visRuns.map(run => {
    const segD = run.map((p, i) => (i ? 'L ' : 'M ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ');
    return `<path d="${segD}" fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" opacity="${opacity}" vector-effect="non-scaling-stroke"/>`;
  }).join('');
  return `<g${clickAttr}>
    <title>${title}</title>
    ${segPaths}
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
    // R3.5.2 (viewClampUnits): drop samples far outside the viewport instead
    // of drawing them — keeps the on-screen portion of an oversize leg visible
    // at close zoom WITHOUT emitting huge coordinates (software-rasterizer
    // hazard, see the render-unit invariant) and without the oversize cull
    // below hiding the whole leg. The run simply breaks where it exits.
    if (opts.viewClampUnits && (Math.abs(x) > opts.viewClampUnits || Math.abs(y) > opts.viewClampUnits)) { cur = null; lastPt = null; continue; }
    // R6.5: occlusion — a sample hidden behind an opaque body disc drawn this
    // frame is dropped and the run breaks (same pattern as the other skip
    // conditions here). `a.depth` defaults to Infinity ("never occluded") on
    // any anchorOf that hasn't threaded real depth (backward compatible).
    const pdepth = (a.depth != null ? a.depth : Infinity) + q.depth;
    if (_trajPointOccluded(x, y, pdepth, zoom, _trajOccludeBodies)) { cur = null; lastPt = null; continue; }
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
// ── P4/R3.5.2: MNODE (vector-burn) legs — shared renderer. Called from TWO
// places with different filters: (a) inside _trajBodyFrameContent for the
// leg's home body (all mnode legs — the normal zoomed-in case, faded by the
// caller's zoiAlpha wrapper like all embedded content), and (b) from the
// planet loop OUTSIDE the zoiAlpha gate for MULTI-FRAME (escape) legs only,
// at opacity (1 − zoiAlpha) — so an escape trajectory stays visible at
// heliocentric zoom where the home body's zone-of-influence content has
// faded to nothing (the two calls cross-fade; no double-draw at either end).
function _trajMnodeLegsSVG(m, body, zoom, ox, oy, viewportDiagPx, vt, calib, selAuthIdx, onlyMultiFrame, oDepth) {
  const id = m && m.missionId;
  if (!id || typeof _physTrajByMission === 'undefined' || !_physTrajByMission[id]) return '';
  let out = '';
  (_physTrajByMission[id].legs || []).forEach(L => {
    if (L.kind !== 'mnode' || !L.samples || !L.samples.length) return;
    const home = L.homeFrame || (L.samples[0] && L.samples[0].frame);
    if (home !== body) return;
    if (onlyMultiFrame && !L.samples.some(s0 => s0.frame !== home)) return;
    const ev = (m.log || [])[L.authIdx];
    const dv = (ev && ev.dvRequired) || (L.dv_ms != null ? Math.round(L.dv_ms) : null);
    const title = `Vector burn${dv ? ' &middot; ' + _trajDvText(dv) : ''}${L.met != null ? ' &middot; ' + _metFmt(L.met) : ''}`;
    const legRec = { authIdx: L.authIdx, dv, color: null, fromLabel: 'Vector burn', toLabel: '' };
    // R6.1 fix (round 2 item 1): the merged event-node marker in
    // _trajEventNodesSVG now draws at this leg's first-sample position and
    // carries the dv/time stack, so the leg's own dep marker is suppressed
    // here to avoid drawing two markers for the same MNODE.
    const phys = _trajPhysLegRender({ m, leg: legRec, physLeg: L, body, ox, oy, zoom, viewportDiagPx, vt, oDepth,
      emphasized: selAuthIdx != null && L.authIdx === selAuthIdx, title, depMarker: false, arrMarker: false, calib, noHighFade: true });
    if (phys) out += phys;
  });
  return out;
}

function _trajPhysLegRender(ctx) {
  const { m, leg, physLeg, body, ox, oy, zoom, viewportDiagPx, vt, emphasized } = ctx;
  const id = m.missionId;
  const clipT = _trajPhysClipT(m, physLeg);
  // Frame-anchor resolver: this pass knows only ITS body's drawn position
  // (ox,oy); sibling frames' drawn positions follow from the real-ephemeris
  // world delta at viewTime × zoom (same position source as the glyphs).
  // R6.5: each anchor also carries `depth` (real km, camera-relative, SAME
  // convention as _trajOccludeBodies) — this body's own depth (ctx.oDepth,
  // threaded from _trajWorldSVG's toRender; Infinity/"never occluded" if the
  // caller hasn't threaded it) plus the local delta's own depth contribution
  // (depth is linear under the pass's pure-rotation projection, so this is
  // exact, not an approximation).
  const overrides = {}; // R1: calibration retired — alias ignores this anyway
  const bodyWorld = progBodyWorldPosCalibrated(body, vt, overrides);
  const oDepth = ctx.oDepth != null ? ctx.oDepth : Infinity;
  const anchorCache = {};
  const anchorOf = frame => {
    if (frame === body) return { x: ox, y: oy, depth: oDepth };
    if (anchorCache[frame]) return anchorCache[frame];
    const w = progBodyWorldPosCalibrated(frame, vt, overrides);
    if (!w) return null;
    const q = _trajProj3(w.x - bodyWorld.x, w.y - bodyWorld.y, (w.z || 0) - (bodyWorld.z || 0)); // R2: 3D world delta
    return (anchorCache[frame] = { x: ox + q.x * zoom, y: oy + q.y * zoom, depth: oDepth + q.depth });
  };
  // MNODE legs (noHighFade): clamp to a 3-viewbox neighborhood so the near-
  // body portion draws at parking-orbit zoom (see viewClampUnits above).
  const poly = _trajPolylineSVG(physLeg, anchorOf, zoom, { clipT, viewportDiagPx, viewClampUnits: ctx.noHighFade ? 3 * _TRAJ_VB : null });
  if (!poly) return null;
  if (poly.hidden) return '';
  const tDep = physLeg.met != null ? physLeg.met : poly.tFirst;
  const tArr = isFinite(clipT) ? clipT : poly.tLast;
  const legState = vt >= tArr ? 'history' : (vt >= tDep ? 'current' : 'planned');
  const stateAlpha = legState === 'history' ? _TRAJ_HISTORY_ALPHA : 1;
  // R3.5.2: MNODE legs opt out of the HIGH-side fade (ctx.noHighFade) — a
  // vector burn's near-body portion is real geometry the user needs to see at
  // parking-orbit zoom (its extent is "too big" for the transferArc window
  // there, which used to fade the leg AND its burn marker to nothing until
  // the user zoomed way out). Low-side fade (sub-pixel legs) still applies.
  const alpha = emphasized ? 1 : _trajLodOpacity(poly.extentPx, _TRAJ_LOD_WIN.transferArc[0],
    ctx.noHighFade ? Infinity : _trajWindowHi(_TRAJ_LOD_WIN.transferArc[1], viewportDiagPx));
  if (alpha <= 0) return '';
  const clickIdx = leg.authIdx;
  const clickAttr = clickIdx != null ? ` style="cursor:pointer" onclick="_trajSelectEventFromView('${id}',${clickIdx})" ondblclick="_trajGizmoLegDblClick('${id}',${clickIdx},event)"` : '';
  const color = emphasized ? 'var(--accent)' : (leg.color || 'var(--accent2)');
  const strokeW = emphasized ? 1.2 : 0.7;
  const dashAttr = legState === 'planned' ? ` stroke-dasharray="2.5,2"` : '';
  const opacity = (alpha * (emphasized ? 1 : 0.8) * stateAlpha).toFixed(3);
  const hoverTitle = ctx.title || '';
  // R6.2.1 (round-3 item 5): the wide hit path also carries the hover-ball /
  // placement-menu affordance (5745 _trajLegHoverMove/_trajLegClick — the
  // physics-leg equivalent of the ring hit path's R6.1.2 wiring; the handler
  // re-finds the leg via physMissionLeg(missionId, authIdx)). The visible
  // stroke keeps the plain select/dblclick attrs unchanged.
  const legHoverAttr = clickIdx != null ? ` style="cursor:pointer" onclick="_trajLegClick('${id}',${clickIdx},event)" ondblclick="_trajGizmoLegDblClick('${id}',${clickIdx},event)" onmousemove="_trajLegHoverMove(event,'${id}',${clickIdx},'${color}')" onmouseleave="_trajRingHoverLeave('${id}')"` : '';
  const hitArea = clickIdx != null ? `<path d="${poly.d}" fill="none" stroke="transparent" stroke-width="8"${legHoverAttr}/>` : '';
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

  // ── time ticks along the polyline (backlog: readable "when do these meet")
  // Only on legs with a real TOF (>2min) and only while the leg itself reads
  // as visually meaningful (LOD-gated with the leg per the brief: skip ticks
  // when the leg's alpha is low or its on-screen extent is small). Ticks
  // inherit the leg's own color/opacity so they fade WITH their geometry
  // (one fade authority, same rule as every other overlay symbol here).
  if ((tArr - tDep) > 120 && isFinite(tDep) && isFinite(tArr) && alpha > 0.1 && poly.extentPx > 16) {
    const interval = _trajTickIntervalS(tArr - tDep);
    const epsT = Math.max(1, (tArr - tDep) * 0.004);
    let firstTick = Math.ceil(tDep / interval) * interval;
    if (firstTick <= tDep) firstTick += interval;
    const tickOpacity = alpha * stateAlpha * 0.9;
    for (let tt = firstTick; tt < tArr; tt += interval) {
      const p0 = _trajPolylinePointAt(physLeg, anchorOf, zoom, tt);
      if (!p0) continue;
      const p1 = _trajPolylinePointAt(physLeg, anchorOf, zoom, Math.min(tArr, tt + epsT));
      let nx = 0, ny = -1; // default: perpendicular "up" if the tangent degenerates
      if (p1 && (p1.x !== p0.x || p1.y !== p0.y)) {
        const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1;
        nx = -dy / len; ny = dx / len; // rotate tangent 90° -> perpendicular unit vector
      }
      // Marker geometry is authored in raw PX (relative to the anchor's own
      // <g transform="translate(...)">, resolved by _trajResolveLabels) — the
      // (nx,ny) unit vector survives the render->px projection unchanged
      // because _trajWorldToScreen scales x and y by the identical factor
      // (isotropic), so it's valid to use directly as a screen direction.
      const tickPx = 3; // half-length -> 6px tick, per the brief
      const marker = `<line x1="${(-nx * tickPx).toFixed(2)}" y1="${(-ny * tickPx).toFixed(2)}" x2="${(nx * tickPx).toFixed(2)}" y2="${(ny * tickPx).toFixed(2)}" stroke="${color}" stroke-width="0.9" opacity="${tickOpacity.toFixed(3)}" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
      const labelDy = ny >= 0 ? 11 : -7;
      _trajRegisterLabel(p0.x, p0.y, [{ text: _metFmt(tt), dy: labelDy, fontPx: 8, color: 'var(--text-dim)' }],
        'zone', { screenSize: poly.extentPx, minSize: 0, selected: false, marker, opacity: tickOpacity });
    }
  }

  // ── encounter countdown chip (backlog item, generalizes the gizmo's CA
  // plate — 5745 — to COMMITTED legs; the gizmo's own preview plate is
  // untouched). Only wired from the two "real" leg call sites (Sun-frame and
  // local-frame transit legs, via ctx.encounterChip) so MNODE/vector-burn
  // legs (which have no `.dest`) never grow a spurious chip.
  if (ctx.encounterChip && physLeg.dest) {
    const soiEv = (physLeg.events || []).find(ev => ev && ev.type === 'soi' && ev.to === physLeg.dest);
    const encT = soiEv ? soiEv.t : (isFinite(tArr) ? tArr : null);
    if (encT != null) {
      const encP = _trajPolylinePointAt(physLeg, anchorOf, zoom, Math.min(encT, poly.tLast));
      if (encP) {
        const dt = encT - vt;
        const passed = dt < 0;
        const relTxt = passed ? `passed ${_trajDurText(-dt)} ago` : `in ${_trajDurText(dt)}`;
        const chipColor = passed ? 'var(--text-dim)' : (emphasized ? 'var(--accent)' : color);
        const lines = [
          { text: `⟶ ${physLeg.dest}`, dy: -13, fontPx: 9, color: chipColor },
          { text: `${_metFmt(encT)} · ${relTxt}`, dy: -2, fontPx: 8.5, color: 'var(--text-dim)' },
        ];
        // 'burn' priority tier (not 'zone', which the time ticks above use) —
        // the encounter chip is higher-value information than a tick label
        // and should win a collision against one, not lose silently to it
        // (observed in flight-test: the chip nearest an SOI entry sits right
        // next to the ticks approaching it and was losing every time).
        _trajRegisterLabel(encP.x, encP.y, lines, 'burn',
          { screenSize: poly.extentPx, minSize: 0, selected: emphasized, opacity: (passed ? 0.55 : 1) * alpha * stateAlpha });
      }
    }
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
  // R6.2' Phase A item 1: dblclick the marker to open the maneuver gizmo at
  // its solved state (_trajGizmoOpenExisting, a no-op for non-MANEUVER
  // authIdx entries — MNODE dblclick is wired separately via the event-node
  // pass, R6.1).
  const clickAttr = opts.authIdx != null ? ` style="cursor:pointer" onclick="event.stopPropagation();_trajSelectEventFromView('${opts.missionId}',${opts.authIdx})" ondblclick="event.stopPropagation();if(typeof _trajGizmoOpenExisting==='function')_trajGizmoOpenExisting('${opts.missionId}',${opts.authIdx});"` : '';
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

// ── R6.1: passive flight-plan event nodes ───────────────────────────────────
// Every replayed m.log entry that resolves to a MET and a drawable position
// gets a small overlay marker (2 above). MANEUVER is intentionally excluded
// from the render pass (not the resolver) — see the note above
// _trajEventNodesSVG: the existing _trajBurnMarker calls (dep/arr triangles,
// wired since before R6) already give MANEUVER click-to-select
// (_trajSelectEventFromView, with event.stopPropagation()) and a hover
// tooltip, so a second independent node would just double-mark the same
// event. All other 11 types are new.

// type -> {glyph, colorVar-category}. Category drives the marker's stroke
// color per the theming brief: maneuver-ish = accent, structural = accent3,
// passive/other = text-dim. No chromatic literals — plain seed vars only
// (same "stroke uses the seed directly, no tint" convention _trajBurnMarker
// already uses for its own accent2 stroke).
const _TRAJ_EVENTNODE_TYPES = {
  LAUNCH:     { glyph: 'L',  cat: 'passive' },
  DEPLOY:     { glyph: 'D',  cat: 'passive' },
  BURN:       { glyph: 'B',  cat: 'maneuver' },
  MANEUVER:   { glyph: 'M',  cat: 'maneuver' },   // resolver supports it; render pass skips it (see above)
  MNODE:      { glyph: 'MN', cat: 'maneuver' },
  SEPARATE:   { glyph: 'S',  cat: 'structural' },
  DOCK:       { glyph: 'DK', cat: 'structural' },
  EXPEND:     { glyph: 'E',  cat: 'structural' },
  RENDEZVOUS: { glyph: 'RV', cat: 'structural' },
  TRANSFER:   { glyph: 'T',  cat: 'maneuver' },
  REENTER:    { glyph: 'R',  cat: 'passive' },
  RECOVER:    { glyph: 'RC', cat: 'passive' },
};

function _trajEventNodeColorVar(type) {
  const cat = (_TRAJ_EVENTNODE_TYPES[type] || {}).cat;
  if (cat === 'maneuver') return 'var(--accent)';
  if (cat === 'structural') return 'var(--accent3)';
  return 'var(--text-dim)';
}

// Short human label — kept to a couple words, vehicle/target name appended
// when a resolvable one is authored on the entry (best-effort; the entry may
// not carry one at all, e.g. a bare SEPARATE).
function _trajEventNodeLabel(e) {
  switch (e.type) {
    case 'LAUNCH': return 'Launch' + (e.label ? ' — ' + e.label : '');
    case 'DEPLOY': return 'Deploy' + (e.label ? ' — ' + e.label : '');
    case 'BURN': return e.burnLabel || 'Burn';
    case 'MANEUVER': return 'Maneuver' + (e.toLabel ? ' → ' + e.toLabel : '');
    case 'MNODE': return 'Node';
    case 'SEPARATE': return 'Separate';
    case 'DOCK': return 'Dock';
    case 'EXPEND': return 'Expend' + (e.stageName ? ' — ' + e.stageName : '');
    case 'RENDEZVOUS': return 'Rendezvous';
    case 'TRANSFER': return 'Transfer';
    case 'REENTER': return 'Reenter';
    case 'RECOVER': return 'Recover';
    default: return e.type;
  }
}

// Pure resolver: m.log[idx] -> {met, label, glyphKind} or null. `met` is read
// from `.metStart`, the field `missionRecompute` (570) stamps on every
// replayed entry — mirrored back onto the AUTHORED m.log entry itself
// (`authEntry.metStart = metClock`, 570 ~L2189) for the common (non-repeated
// -group) case, which is the only case this resolver supports (repeated-
// group clones live only in m._expanded and are out of scope here, same
// limitation the existing leg/burn-marker extraction already has via
// `e._authIdx`). Returns null for any type not in the R6.1 list, or when the
// entry/mission is malformed, or when no MET has been stamped yet (mission
// never recomputed, or a corrupt entry).
function _trajEventNodeInfo(m, idx) {
  if (!m || !m.log || idx == null || idx < 0 || idx >= m.log.length) return null;
  const e = m.log[idx];
  if (!e || typeof e !== 'object' || !e.type) return null;
  if (!_TRAJ_EVENTNODE_TYPES[e.type]) return null;
  if (e.metStart == null || !isFinite(e.metStart)) return null;
  return { met: e.metStart, label: _trajEventNodeLabel(e), glyphKind: _TRAJ_EVENTNODE_TYPES[e.type].glyph };
}

// Tier (b)/(c) support: the orbit a given log entry's snapshot places some
// vehicle into, in body-frame `body` (skips surface/degenerate orbits). Reads
// `e.snapshot` directly off m.log[idx] — populated by missionRecompute for
// the primary (non-cloned) replay of that entry, same object-identity fact
// _trajEventNodeInfo's metStart read relies on.
function _trajEventNodeOrbitFor(m, idx, body) {
  const e = m && m.log && m.log[idx];
  if (!e || !e.snapshot) return null;
  for (const v of e.snapshot) {
    if (v.orbit && !v.orbit.surface && (v.orbit.body || 'Earth') === body) return v.orbit;
  }
  return null;
}

// Which body-frame a log entry's node belongs in — LAUNCH/REENTER/RECOVER use
// their authored/replayed surface-transition orbit fields directly; every
// other type uses the body of its own snapshot's (first non-surface) orbit.
function _trajEventNodeBody(m, idx) {
  const e = m && m.log && m.log[idx];
  if (!e) return null;
  if (e.type === 'LAUNCH') return (e.launchOrbit && e.launchOrbit.body) || 'Earth';
  if (e.type === 'REENTER' || e.type === 'RECOVER') return (e.orbitAfter && e.orbitAfter.body) || 'Earth';
  if (e.snapshot) {
    for (const v of e.snapshot) {
      if (v.orbit && !v.orbit.surface) return v.orbit.body || 'Earth';
    }
  }
  return null;
}

// Position resolver, precedence per PHYSICS_PLAN.md R6: (a) covering physics
// leg sample interpolation, reusing _trajPolylinePointAt exactly like the
// physics-leg renderer does; (b) orbit-ring position at MET via the SAME
// mean-motion/theta convention the maneuver gizmo's rail math uses
// (_trajGizmoNodeState, 5745 — nMean = sqrt(mu/rMean^3), theta = nMean*met
// mod 2pi, fed through physAimBurnState); (c) body glyph position (ox,oy —
// the body-frame's own origin, correct for surface events); else null.
function _trajEventNodePos(m, idx, body, scale, zoom, ox, oy, met) {
  // (a) physics leg covering this MET in this frame
  if (typeof _physTrajByMission !== 'undefined' && _physTrajByMission[m.missionId]) {
    const legs = _physTrajByMission[m.missionId].legs || [];
    for (const L of legs) {
      const inFrame = (L.samples || []).filter(s => s.frame === body);
      if (!inFrame.length) continue;
      const tMin = Math.min(inFrame[0].t, inFrame[inFrame.length - 1].t);
      const tMax = Math.max(inFrame[0].t, inFrame[inFrame.length - 1].t);
      if (met < tMin || met > tMax) continue;
      const anchorOf = f => (f === body ? { x: ox, y: oy } : null);
      const p = _trajPolylinePointAt(L, anchorOf, zoom, met);
      if (p) return p;
    }
  }
  // (b) orbit-ring position at MET
  const o = _trajEventNodeOrbitFor(m, idx, body);
  if (o && PROG_BODIES[body] && typeof physAimBurnState === 'function') {
    const R = PROG_BODIES[body].R || 0;
    const peri = o.perigee ?? o.apogee ?? 0, apo = o.apogee ?? o.perigee ?? 0;
    const rMean = R + (peri + apo) / 2;
    const mu = PROG_BODIES[body].mu;
    if (rMean > 0 && mu > 0) {
      const nMean = Math.sqrt(mu / (rMean * rMean * rMean));
      const theta = (nMean * met) % (2 * Math.PI);
      const incRad = ((o.inclination || 0) * Math.PI) / 180;
      const raan = o.lan_deg != null ? (o.lan_deg * Math.PI) / 180 : (o.lan != null ? (o.lan * Math.PI) / 180 : 0);
      const bs = physAimBurnState(body, rMean, theta, 0, 0, incRad, 0, raan);
      if (bs && bs.r) {
        const q = _trajProj3(bs.r[0] * scale, bs.r[1] * scale, (bs.r[2] || 0) * scale);
        if (isFinite(q.x) && isFinite(q.y)) return { x: ox + q.x, y: oy + q.y };
      }
    }
  }
  // (c) body glyph position — correct fallback for surface events; also the
  // honest fallback for anything else with no resolvable orbit/leg.
  if (isFinite(ox) && isFinite(oy)) return { x: ox, y: oy };
  return null;
}

// Emits (registers) the passive event-node markers for one body frame. Runs
// AFTER rings/legs/MNODE legs so covering-leg lookups (tier a) see the same
// data those passes already resolved. `screenSize` reuses whatever LOD extent
// is available for the node's underlying geometry (the ring's own screenSize
// for tier b/c nodes, matching the ring's own LOD window so a node doesn't
// outlive its ring visually; Infinity — always eligible — for tier a nodes,
// since a visible leg polyline is itself the LOD gate); piggybacks
// _trajRegisterLabel's existing collision/minSize machinery, per the brief,
// rather than inventing a second LOD system.
function _trajEventNodesSVG(body, m, scale, zoom, ox, oy, id, selAuthIdx) {
  if (!m || !m.log) return;
  const frames = _trajGetExtraction(m);
  const sc = frames[body];
  m.log.forEach((e, idx) => {
    if (!e || _evIsSolvedManeuver(e)) return; // already selectable via _trajBurnMarker — see note above
    const info = _trajEventNodeInfo(m, idx);
    if (!info) return;
    const evBody = _trajEventNodeBody(m, idx);
    if (evBody !== body) return;
    // R6.1 fix (round 2 item 1): MNODE with a resolved physics leg draws ONE
    // merged marker at the LEG's first-sample position (the same anchor the
    // dep burn marker would have used) instead of the independent ring
    // mean-motion position — the leg's own dep marker is suppressed for
    // MNODE legs in _trajMnodeLegsSVG so there is exactly one marker.
    let pos = null, mergedDvText = null, mergedLeg = null;
    if (e.type === 'MNODE' && typeof physMissionLeg === 'function') {
      mergedLeg = physMissionLeg(id, idx);
      if (mergedLeg && mergedLeg.samples && mergedLeg.samples.length) {
        const anchorOf = f => (f === body ? { x: ox, y: oy } : null);
        const poly = _trajPolylineSVG(mergedLeg, anchorOf, zoom, {});
        if (poly && poly.first && isFinite(poly.first.x) && isFinite(poly.first.y)) {
          pos = { x: poly.first.x, y: poly.first.y };
          const dv = e.dvRequired || (mergedLeg.dv_ms != null ? Math.round(mergedLeg.dv_ms) : null);
          if (dv) mergedDvText = _trajDvText(dv);
        }
      }
    }
    if (!pos) pos = _trajEventNodePos(m, idx, body, scale, zoom, ox, oy, info.met);
    if (!pos) return;
    const emphasized = selAuthIdx != null && selAuthIdx === idx;
    const o = _trajEventNodeOrbitFor(m, idx, body);
    const rec = (o && sc) ? [...sc.orbits.values()].find(r => Math.abs(r.peri - (o.perigee ?? o.apogee ?? 0)) < 1 && Math.abs(r.apo - (o.apogee ?? o.perigee ?? 0)) < 1) : null;
    const screenSize = rec ? ((PROG_BODIES[body] ? PROG_BODIES[body].R : 0) + rec.apo) * scale : Infinity;
    const color = _trajEventNodeColorVar(e.type);
    const vehName = (m._ownerLabels && e.vehicleId && m._ownerLabels[e.vehicleId]) || e.activeName || e.label || '';
    const title = `${e.type} · ${_metFmt(info.met)}${vehName ? ' · ' + _tsEsc(vehName) : ''}`;
    const clickAttr = ` style="cursor:pointer" onclick="event.stopPropagation();_trajSelectEventFromView('${id}',${idx})"` +
      (e.type === 'MNODE' ? ` ondblclick="event.stopPropagation();_trajGizmoOpenExisting('${id}',${idx})"` : '');
    const r = emphasized ? 4.6 : 4;
    const ring = emphasized ? `<circle cx="0" cy="0" r="${(r + 2).toFixed(1)}" fill="none" stroke="var(--accent)" stroke-width="1.1"/>` : '';
    const marker = `${ring}<circle cx="0" cy="0" r="${r}" fill="var(--nm-bg)" stroke="${color}" stroke-width="1"/>` +
      `<text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="var(--mono)" font-size="${info.glyphKind.length > 1 ? 4 : 5}" fill="${color}" pointer-events="none">${info.glyphKind}</text>`;
    const hitR = mergedLeg ? 12 : 9; // merged MNODE marker gets a more generous hit radius
    const hit = `<circle cx="0" cy="0" r="${hitR}" fill="transparent"${clickAttr}><title>${title}</title></circle>`;
    // Merged MNODE marker: Δv text above, time plate directly below — one
    // coherent stack (round 2 item 1). Non-merged nodes keep the plain label.
    const lines = mergedDvText
      ? [{ text: mergedDvText, dy: -9, fontPx: 9, color }, { text: _metFmt(info.met), dy: r + 7, fontPx: 9, color: 'var(--text-dim)' }]
      : [{ text: info.label, dy: -9, fontPx: 9, color }];
    _trajRegisterLabel(pos.x, pos.y, lines,
      'burn', { screenSize, minSize: _TRAJ_LOD_BURN_MIN, selected: emphasized, marker, hit, opacity: 1 });
  });
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
  // Clicking a leg/marker to select its event hands view-time authority back
  // to the "state as of this event" rule (_trajViewTime) — a lingering scrub
  // override would otherwise silently out-rank the selection the user just
  // made, per the "one view-time authority" integration rule.
  delete _trajViewTimeOverride[id];
  if (typeof missionSelectEvent === 'function') missionSelectEvent(id, authIdx);
  // R3.3: selecting an MNODE event attaches the gizmo at its recorded state;
  // selecting anything else detaches a currently-committed gizmo.
  if (typeof _trajGizmoOnEventSelected === 'function') {
    const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
    _trajGizmoOnEventSelected(id, authIdx, m && m.log && m.log[authIdx]);
  }
  // T4: same dwell-orbit-inspector hook as the node-map click path (_missionNmSelectShared).
  if (typeof _oiOnEventSelected === 'function') {
    const m2 = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
    _oiOnEventSelected(id, authIdx, m2 && m2.log && m2.log[authIdx]);
  }
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
  sc.orbits.forEach(rec => {
    // Phase 5a fix (user flight-test "corrupted Moon view"): a PROPAGATED
    // record (NRHO) has no rec.apo — `R + undefined` = NaN, which poisons
    // every Math.max downstream and lands as a NaN camera width in
    // _trajFitWKmForBody (zoom = 400/NaN → the whole scene culls to nothing).
    // Use the propagated loop's real sampled extent instead.
    if (rec.kind === 'propagated') {
      if (typeof refOrbitSamplePropagated === 'function' && rec.refId) {
        const samples = refOrbitSamplePropagated(rec.refId, 24);
        samples.forEach(s => { const d = Math.hypot(s.r[0], s.r[1], s.r[2]); if (isFinite(d)) maxR = Math.max(maxR, d); });
      }
      return;
    }
    if (isFinite(rec.apo)) maxR = Math.max(maxR, R + rec.apo);
  });
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
function _trajBodyFrameContent(body, m, scale, zoom, ox, oy, viewportDiagPx, viewT, overrides, calib, oDepth) {
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
      const ringOpts = { emphasized, authIdx: rec.firstAuthIdx, missionId: id, zoom, originX: ox, originY: oy, viewportDiagPx, historyAlpha: isHistoryOrbit ? _TRAJ_HISTORY_ALPHA : 1, centerDepth: oDepth };
      out += rec.kind === 'propagated'
        ? _trajPropagatedRingSVG(rec, body, scale, rec.colors.size === 1 ? [...rec.colors][0] : null, ringOpts)
        : _trajRingSVG(rec, body, scale, rec.colors.size === 1 ? [...rec.colors][0] : null, ringOpts);
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
          const phys = _trajPhysLegRender({ m, leg, physLeg: physLegS, body: 'Sun', ox, oy, zoom, viewportDiagPx, vt, emphasized, title: hoverTitle, depMarker: true, arrMarker: true, calib, encounterChip: true, oDepth });
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
        const phys = _trajPhysLegRender({ m, leg, physLeg: physLegL, body, ox, oy, zoom, viewportDiagPx, vt, emphasized, title: hoverTitle, depMarker: true, arrMarker: false, calib, encounterChip: true, oDepth });
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
  out += _trajMnodeLegsSVG(m, body, zoom, ox, oy, viewportDiagPx, vt, calib, selAuthIdx, false, oDepth);

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

  // R6.1: passive flight-plan event nodes — every other log event that
  // resolves to geometry (see _trajEventNodesSVG for the exact type/tier
  // rules). Runs last so tier-(a) leg lookups see the fully-populated
  // physics side-table and tier-(b) ring matches see this frame's `sc`.
  _trajEventNodesSVG(body, m, scale, zoom, ox, oy, id, selAuthIdx);

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
//
// SCRUBBER INTEGRATION (backlog: scrubbable MET): a manual scrub is a
// SESSION-ONLY override (never authored/autosaved, same spirit as the
// camera) keyed by missionId, checked FIRST — this is the single authority
// downstream rendering reads (Earth rotation, vehicle dots, countdown chips,
// ghost markers all go through _trajViewTime, so scrubbing one place moves
// all of them). Selecting a log event (_trajSelectEventFromView) or the 570
// state-panel event list CLEARS the override so "state as of event" regains
// control, per the "integrate, don't add a second authority" brief.
let _trajViewTimeOverride = {};
function _trajViewTime(m) {
  if (!m) return 0;
  const ov = _trajViewTimeOverride[m.missionId];
  if (typeof ov === 'number' && isFinite(ov)) return ov;
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

// Mission-wide MET ceiling for the scrubber's range: max of the replay total
// and every log entry's own (metStart + durationUsed) — a mission with a
// still-open final coast can have log entries past m._metTotal in rare cases,
// so take the max rather than trusting either alone. Floors at 60s so a
// brand-new mission still shows a usable (if trivial) track.
function _trajMissionMaxMet(m) {
  if (!m) return 60;
  let max = (typeof m._metTotal === 'number' && isFinite(m._metTotal)) ? m._metTotal : 0;
  (m.log || []).forEach(e => {
    if (!e || typeof e.metStart !== 'number' || !isFinite(e.metStart)) return;
    const du = typeof e.durationUsed === 'number' && isFinite(e.durationUsed) ? e.durationUsed : 0;
    max = Math.max(max, e.metStart + du);
  });
  return Math.max(max, 60);
}

// Pure ladder pick for tick/nudge spacing — the ONLY math in this feature
// pinned by the test gate. Picks the FINEST rung (smallest interval) whose
// tick count over `tofS` is <= 8, so a leg lands in the ~3-8 ticks band
// (a leg just past a rung boundary gets the next-coarser rung, by design —
// see _trajTickIntervalS's own header for the tradeoff).
const _TRAJ_TICK_LADDER = [60, 600, 3600, 6 * 3600, 86400, 10 * 86400, 100 * 86400];
function _trajTickIntervalS(tofS) {
  if (!(tofS > 0)) return _TRAJ_TICK_LADDER[0]; // invalid/degenerate -> finest rung (never used to draw, defensive default)
  if (tofS === Infinity) return _TRAJ_TICK_LADDER[_TRAJ_TICK_LADDER.length - 1]; // unbounded span -> coarsest rung
  for (const step of _TRAJ_TICK_LADDER) {
    if (tofS / step <= 8) return step;
  }
  return _TRAJ_TICK_LADDER[_TRAJ_TICK_LADDER.length - 1];
}

// Short relative-duration text for countdown chips ("2d 03h", "45m") — no
// "T+" prefix (that's _metFmt's job for absolute MET); always non-negative,
// caller decides "in"/"passed ... ago" framing from the sign of the delta.
function _trajDurText(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const days = Math.floor(sec / 86400), hrs = Math.floor((sec % 86400) / 3600), mins = Math.floor((sec % 3600) / 60);
  if (days >= 1) return `${days}d ${String(hrs).padStart(2, '0')}h`;
  if (hrs >= 1) return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  return `${mins}m`;
}

// Sets the scrub override and refreshes both layers via the existing
// camera-refresh path (_trajApplyCam already rebuilds g.traj-scene from
// _trajWorldSVG, which reads _trajViewTime internally — no separate repaint
// path needed for view-time changes).
function _trajSetViewTime(id, t, maxMet) {
  const clamped = Math.max(0, maxMet != null ? Math.min(maxMet, t) : t);
  _trajViewTimeOverride[id] = clamped;
  _trajApplyCam(id, _trajCam(id));
}

// ── SVG builder (WORLD layer — geometry only, ONE PASS, C1b) ──────────────
// The single render function replacing _trajSunSceneSVG/_trajBodySceneSVG/
// _trajSceneGeomSVG. Draws EVERY body (Sun, planets, moons) each call,
// positioned by progBodyWorldPos(body, viewTime) minus the camera's floating
// origin (_trajCamCenterKm), plus every body's embedded mission content.
// `cam` = {anchorBody, relOffsetKm, wKm}; `zoom` = _TRAJ_VB/cam.wKm;
// `rect` = the world svg's measured bounding rect (for viewport-diagonal
// culling — falls back to a square guess pre-mount).
// R6.4c: textured globes are collected here during the render pass and then
// reconciled into a PERSISTENT sibling <g class="traj-globe-layer"> (behind
// traj-scene) by _trajReconcileGlobeLayer. Reason: _trajApplyCam rebuilds
// g.traj-scene via innerHTML EVERY rotate frame, which destroys any inline
// <image> and forces the browser to async-decode the new data-URI on a fresh
// node — a blank frame until decode completes (the R6.4b per-frame re-raster
// turned this into constant flicker). Updating a persistent node's href in
// place keeps the previous bitmap painted until the new one decodes → no gap.
let _trajPendingGlobes = [];
function _trajWorldSVG(m, cam, zoom, rect) {
  _trajPendingGlobes = [];
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

  // R6.5: occlusion pre-pass — collect every opaque body disc drawn THIS
  // frame (disc tier only, trueRpx >= _TRAJ_FEATURE_PX — chips/small discs
  // don't occlude) BEFORE any ring/leg content is emitted below, so the
  // occlusion test is order-independent (a ring embedded at body A can be
  // correctly occluded by body B regardless of which is iterated first).
  // Sun excluded: its glyph here (_trajGlyph) is a fixed schematic marker,
  // never a true-scale rendered sphere, so it isn't a meaningful occluder.
  _trajOccludeBodies = [];
  Object.keys(PROG_HELIO_R).forEach(body => {
    const wp = progBodyWorldPos(body, viewT);
    const p = toRender(wp.x, wp.y, wp.z);
    if (_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) return;
    const trueR = _trajTrueBodyRadiusKm(body);
    if (trueR * zoom >= _TRAJ_FEATURE_PX) _trajOccludeBodies.push({ name: body, cx: p.x, cy: p.y, depth: p.depth, R: trueR });
  });
  Object.keys(PROG_MOON_ORBITS || {}).forEach(name => {
    const wp = progBodyWorldPos(name, viewT);
    const p = toRender(wp.x, wp.y, wp.z);
    if (_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) return;
    const trueR = _trajTrueBodyRadiusKm(name);
    if (trueR * zoom >= _TRAJ_FEATURE_PX) _trajOccludeBodies.push({ name, cx: p.x, cy: p.y, depth: p.depth, R: trueR });
  });

  // (R6.4d) Ecliptic reference grid removed — its concentric rings read as
  // stray "orbits" and, since R6.4c moved globes to a behind-layer, drew over
  // the planet when tilted. Camera tilt is legible from the bodies/orbits
  // themselves; the grid added clutter without orientation value.

  // ── true-geometry orbit ring (R2): sampled real ellipse, projected ────────
  // centerP = the PRIMARY's projected render position; el = orbit elements.
  // R6.5: occlusion-split (a planet/moon ring's far side hides behind another
  // drawn body — the pre-pass above makes this order-independent) + Pe/Ap
  // apse markers (distance in AU for heliocentric rings, raw km — center-to-
  // body distance, not altitude — for moon rings; see MATH.md §7m).
  const trueRingPath = (el, centerP, alphaStr, color, apseMode) => {
    const pts = progOrbitSamplePoints(el, 120);
    const rendered = [];
    let periIdx = 0, apoIdx = 0, periR = Infinity, apoR = -Infinity;
    for (let k = 0; k < pts.length; k++) {
      const q = _trajProj3(pts[k][0], pts[k][1], pts[k][2]);
      const x = centerP.x + q.x * zoom, y = centerP.y + q.y * zoom;
      if (!isFinite(x) || !isFinite(y)) return '';
      rendered.push({ x, y, depth: centerP.depth + q.depth });
      const rLocal = Math.hypot(pts[k][0], pts[k][1], pts[k][2]);
      if (rLocal < periR) { periR = rLocal; periIdx = k; }
      if (rLocal > apoR) { apoR = rLocal; apoIdx = k; }
    }
    const runs = _trajOcclusionSplitRuns(rendered, zoom, _trajOccludeBodies);
    let d = '';
    runs.forEach(run => { d += (d ? ' ' : '') + run.map((p, k) => (k ? 'L ' : 'M ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' '); });
    if (apseMode) {
      const periPt = rendered[periIdx], apoPt = rendered[apoIdx];
      if (!_trajPointOccluded(periPt.x, periPt.y, periPt.depth, zoom, _trajOccludeBodies)) {
        _trajRegisterLabel(periPt.x, periPt.y, [{ text: 'Pe', dy: -6, fontPx: 8.5, color }, { text: _trajFmtApseDist(periR, apseMode), dy: 4, fontPx: 8, color: 'var(--text-dim)' }],
          'orbit', { screenSize: apoR * zoom, minSize: _TRAJ_LOD_RING_MIN, opacity: parseFloat(alphaStr) / 0.55 || 0, marker: `<path d="M -2.4 2 L 0 -2.4 L 2.4 2 Z" fill="${color}" stroke="none"/>` });
      }
      if (!_trajPointOccluded(apoPt.x, apoPt.y, apoPt.depth, zoom, _trajOccludeBodies)) {
        _trajRegisterLabel(apoPt.x, apoPt.y, [{ text: 'Ap', dy: -6, fontPx: 8.5, color }, { text: _trajFmtApseDist(apoR, apseMode), dy: 4, fontPx: 8, color: 'var(--text-dim)' }],
          'orbit', { screenSize: apoR * zoom, minSize: _TRAJ_LOD_RING_MIN, opacity: parseFloat(alphaStr) / 0.55 || 0, marker: `<path d="M -2.4 -2 L 0 2.4 L 2.4 -2 Z" fill="${color}" stroke="none"/>` });
      }
    }
    if (!d) return '';
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="0.6" opacity="${alphaStr}" vector-effect="non-scaling-stroke"/>`;
  };

  // ── Sun (drawn unless off-screen — the heliocentric origin) ───────────────
  {
    const p = toRender(0, 0, 0);
    if (!_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) {
      const sunScale = _trajLocalScaleFor('Sun', m) * zoom; // km -> render units
      let s = _trajGlyph(p.x, p.y, _trajBodyPxR(6, zoom), _trajBodyColor('Sun'), 'Sun', zoom, cam.anchorBody === 'Sun', false, m && m.missionId);
      s += _trajBodyFrameContent('Sun', m, sunScale, zoom, p.x, p.y, viewportDiagPx, viewT, overrides, calib, p.depth);
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
      if (oel) emit(-1e17, trueRingPath(oel, sunP, (0.55 * ringAlpha).toFixed(3), _trajBodyColor(body), 'au'));
    }
    const wp = progBodyWorldPos(body, viewT);
    const p = toRender(wp.x, wp.y, wp.z);
    if (_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) return;
    const trueR = _trajTrueBodyRadiusKm(body); // R6.2: real physical radius (was schematic 3)
    const trueRpx = trueR * zoom;
    // "Far representation" (C2): the NAME label is force-eligible whenever the
    // disc has hit its min-px clamp — all planets keep names at solar zoom.
    const forceLabel = trueRpx < _TRAJ_MIN_BODY_PX;
    let s = '';
    if (!_trajCullByExtent(_trajBodyPxR(trueR, zoom))) {
      // R6.2 defect3: body->Sun direction as a WORLD-frame unit 3-vector (not
      // a 2D screen angle) — the terminator math needs the real camera-depth
      // component (zc_sun), which a screen-space atan2 of two already-
      // projected points can't recover.
      const sunLen = Math.hypot(wp.x, wp.y, wp.z) || 1;
      const sunDir3 = [-wp.x / sunLen, -wp.y / sunLen, -wp.z / sunLen];
      s += _trajBodyDiscTiered(p.x, p.y, trueRpx, _trajBodyColor(body), body, zoom, cam.anchorBody === body, forceLabel, m && m.missionId, viewT, sunDir3, viewportDiagPx);
      // R6.3: site marker + mock ascent path — only meaningful once the disc is
      // surfaced (same LOD tier as coastlines) and only for Earth (the only
      // body missions currently launch from).
      if (body === 'Earth' && trueRpx >= _TRAJ_SURFACE_PX && m) {
        s += _trajLaunchSiteAndAscentSVG(m, p.x, p.y, trueRpx, viewT, viewportDiagPx);
      }
    }
    // Zone-of-influence content: single fade authority for everything embedded
    // at this body (moons in the next pass share the same gate via zoiAlpha).
    const localScale = _trajLocalScaleFor(body, m) * zoom; // km -> render units
    const neighborhoodExtentPx = _trajBodyPxR(trueR, zoom);
    const zoiAlpha = _trajLodOpacity(Math.max(neighborhoodExtentPx, _trajBodyNeighborhoodPx(body, zoom, m)), _TRAJ_LOD_WIN.zoneOfInfluence[0], Infinity);
    if (zoiAlpha > 0) {
      const contentSvg = _trajBodyFrameContent(body, m, localScale, zoom, p.x, p.y, viewportDiagPx, viewT, overrides, calib, p.depth);
      s += zoiAlpha < 1 ? `<g opacity="${zoiAlpha.toFixed(3)}">${contentSvg}</g>` : contentSvg;
    }
    // R3.5.2: escape (multi-frame) MNODE legs must survive heliocentric zoom —
    // cross-fade them back in as the zone-of-influence content fades out.
    if (zoiAlpha < 1 && m) {
      const escSvg = _trajMnodeLegsSVG(m, body, zoom, p.x, p.y, viewportDiagPx, viewT, calib, _trajSelectedAuthIdx(m), true, p.depth);
      if (escSvg) s += `<g opacity="${(1 - zoiAlpha).toFixed(3)}">${escSvg}</g>`;
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
      if (oel) emit(-1e17, trueRingPath(oel, parentP, (0.55 * parentZoiAlpha).toFixed(3), _trajBodyColor(name), 'km'));
    }
    if (parentZoiAlpha <= 0) return; // moon (and its content) hidden with its parent's ZOI
    const wp = progBodyWorldPos(name, viewT);
    const p = toRender(wp.x, wp.y, wp.z);
    if (_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) return;
    const trueR = _trajTrueBodyRadiusKm(name); // R6.2: real physical radius (was schematic 3)
    const trueRpx = trueR * zoom;
    let s = '';
    if (!_trajCullByExtent(_trajBodyPxR(trueR, zoom))) {
      // R6.2 defect3: same world-frame sun-direction vector as the planet pass.
      const sunLen = Math.hypot(wp.x, wp.y, wp.z) || 1;
      const sunDir3 = [-wp.x / sunLen, -wp.y / sunLen, -wp.z / sunLen];
      const glyphSvg = _trajBodyDiscTiered(p.x, p.y, trueRpx, _trajBodyColor(name), name, zoom, cam.anchorBody === name, false, m && m.missionId, viewT, sunDir3, viewportDiagPx);
      s += parentZoiAlpha < 1 ? `<g opacity="${parentZoiAlpha.toFixed(3)}">${glyphSvg}</g>` : glyphSvg;
    }
    const localScale = _trajLocalScaleFor(name, m) * zoom; // km -> render units
    const contentSvg = _trajBodyFrameContent(name, m, localScale, zoom, p.x, p.y, viewportDiagPx, viewT, overrides, calib, p.depth);
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
  // Round 2 item 3(a): with a gizmo open on this mission, a body-glyph click
  // sets that body as the gizmo's closest-approach TARGET instead of
  // recentering the camera (the dismiss handler already ignores clicks on
  // .traj-body-glyph so the gizmo stays open for this).
  if (typeof _trajGizmo !== 'undefined' && _trajGizmo && _trajGizmo.missionId === id) {
    if (typeof _trajGizmoSetManualTarget === 'function') _trajGizmoSetManualTarget(body);
    return;
  }
  trajSetFocus(id, body);
}

function _trajGlyph(cx, cy, r, color, label, zoom, isFocus, forceLabel, clickId) {
  // Body name inherits the body's own chrome color (theme var) so labels read
  // as belonging to their glyph rather than a flat gray sheet of names.
  _trajRegisterLabel(cx, cy - r, [{ text: label, dy: -4, fontPx: 10, color: color || 'var(--nm-label)' }], 'body',
    { screenSize: r, minSize: _TRAJ_LOD_BODY_MIN, selected: !!isFocus || !!forceLabel });
  const clickAttr = clickId ? ` class="traj-body-glyph" style="cursor:pointer" onclick="trajGlyphClick('${clickId}','${label}')"` : '';
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

// ── R6.2: planetary surface rendering + body LOD ladder ────────────────────
// Three tiers by TRUE (unclamped) apparent screen radius (trueR_km * zoom):
//   >= _TRAJ_SURFACE_PX : surfaced disc — base color + coastlines/maria/region
//                          ellipses/cloud bands + a limb-darkening overlay.
//   >= _TRAJ_CHIP_PX     : plain clamped disc (pre-existing behavior, unchanged
//                          — _trajBodyPxR's Math.max floor already holds a
//                          CONSTANT _TRAJ_MIN_BODY_PX screen size as trueR*zoom
//                          shrinks below the floor).
//   <  _TRAJ_CHIP_PX      : symbol chip — constant-radius outlined circle +
//                          astronomical glyph (deep zoom-out, e.g. heliocentric).
// Cross-fade is NOT implemented (a clean pop at each threshold, per spec).
const _TRAJ_SURFACE_PX = 24;
const _TRAJ_CHIP_PX = 2;
const _TRAJ_CHIP_R = 7; // constant screen radius (px/render-unit) for the chip tier
// R6.2.1: middle plain-disc tier removed (flight-test item 2) — the surfaced
// disc now renders all the way down to the chip threshold. Below this radius
// (px) the surfaced disc skips vector feature sampling (base fill + limb
// gradient only — visually indistinguishable at that size, and keeps the
// per-point path-string cost bounded at small sizes).
const _TRAJ_FEATURE_PX = 14;

// Astronomical glyphs — reuses the same symbols as the Orbits page destination
// picker (060-orbit-categories.js ORBIT_CATEGORIES icons) for Earth/Moon/Mars/
// Venus/Mercury/Jupiter/Saturn/Uranus/Neptune so a body reads the same symbol
// everywhere in the app; Sun/Titan added here (no picker entry exists for them).
const _TRAJ_BODY_GLYPH = {
  Sun: '☉', Mercury: '☿', Venus: '♀', Earth: '⊕', Moon: '☽',
  Mars: '♂', Jupiter: '♃', Saturn: '♄', Uranus: '♅', Neptune: '♆', Titan: 'T',
};

// Body true physical radius (km) for LOD apparent-size math. Sun's value
// (696,000 km, IAU mean) is display-schematic only — the Sun still renders
// through its own plain-glyph path (_trajGlyph), never this ladder.
function _trajTrueBodyRadiusKm(body) {
  if (body === 'Sun') return 696000;
  return (typeof PROG_BODIES !== 'undefined' && PROG_BODIES[body] && PROG_BODIES[body].R) || 3;
}

// lat/lon (deg) -> unit-sphere point in the body's OWN unrotated frame
// (lon measured east from the body's lon=0 meridian, +z = spin axis).
// APPROXIMATION (2026-07-10, presentation layer only — see MATH.md §7g): no
// body's axial tilt is modeled; every spin axis is assumed coincident with
// the ecliptic normal (+z world axis), so this is a simplified top-down
// globe, not a true axial-tilt globe.
function _trajLatLonUnit(latDeg, lonDeg) {
  const lat = latDeg * _PROG_D2R, lon = lonDeg * _PROG_D2R;
  const cl = Math.cos(lat);
  return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
}
// Rotate a unit-sphere body-frame point by spin angle (rad) about the +z
// (ecliptic-normal) axis, giving its WORLD-frame direction.
function _trajSpinRotate(pt, spinRad) {
  const c = Math.cos(spinRad), s = Math.sin(spinRad);
  return [pt[0] * c - pt[1] * s, pt[0] * s + pt[1] * c, pt[2]];
}
// Body spin angle (rad) at mission time viewT_s. Earth/Mars: sidereal
// rotation from viewT with a fixed (uncalibrated — display flavor only, not
// tied to a real prime-meridian epoch) offset of 0. Moon: tidally locked —
// its nearside meridian (lon 0) is kept facing Earth via the Moon's own
// orbital position angle about Earth (+ π, since progBodyAngleAt gives the
// Earth->Moon direction and the nearside must face the opposite way, Moon-
// >Earth). Other bodies: 0 (no vector surface features drawn for them).
function _trajBodySpinAngle(body, viewT_s) {
  const t = viewT_s || 0;
  if (body === 'Earth') return (t / 86164.1) * 2 * Math.PI;
  if (body === 'Mars') return (t / 88642.66) * 2 * Math.PI;
  if (body === 'Moon' && typeof progBodyAngleAt === 'function') return progBodyAngleAt('Moon', t) + Math.PI;
  return 0;
}
// Project a body-local (already spin-rotated) UNIT direction through the pass
// camera and scale by the disc's screen radius — linear, so this is exactly
// equivalent to projecting the rPx-scaled vector (same seam as _trajProj3).
function _trajSurfacePoint(unitDir, cx, cy, rPx) {
  const q = _trajProj3(unitDir[0], unitDir[1], unitDir[2]);
  return { x: cx + q.x * rPx, y: cy + q.y * rPx, depth: q.depth };
}
// ── R6.2 defect1: exact hemisphere clip (2026-07-11) ────────────────────────
// The old per-vertex "drop back-facing points, keep the front runs joined"
// approach let the SVG fill close each gap with a straight chord THROUGH the
// disc interior (visible as giant wedges, worst pole-on where whole polygons
// straddle the limb). This clips a closed polygon of WORLD-frame unit
// direction vectors (as produced by _trajSpinRotate/_trajLatLonUnit, i.e.
// pre-projection) against the camera's front hemisphere (projected depth >=
// 0), closing every crossed edge exactly ON the limb circle instead of
// cutting inward.
//
// Exactness: depth is a LINEAR function of the input vector (_trajProjectVec
// is a pure rotation), so interpolating the two endpoint UNIT VECTORS in 3D
// by t = za/(za-zb) yields a point whose depth is exactly 0 by construction;
// renormalizing that point to unit length then gives a projected radius of
// exactly 1 (|x,y|^2 + 0^2 = 1) — i.e. it lands exactly on the limb, not an
// approximation of it (accurate at any polygon scale, not just coastlines).
//
// Returns { closed, runs }:
//   closed: true  -> `runs` is a single array holding the ENTIRE input
//                     polygon (every vertex front-facing) — draw with a
//                     plain `Z` close, no limb involved.
//   closed: false -> `runs` is zero or more open chains, each starting and
//                     ending exactly on the limb (or [] if fully back-facing).
function _trajHemiClipRuns(dirs) {
  const n = dirs.length;
  if (!n) return { closed: false, runs: [] };
  const zc = dirs.map(v => _trajProj3(v[0], v[1], v[2]).depth);
  if (zc.every(z => z >= 0)) return { closed: true, runs: [dirs.slice()] };
  if (zc.every(z => z < 0)) return { closed: false, runs: [] };
  const lerpUnit = (i, j, t) => {
    const wx = dirs[i][0] + (dirs[j][0] - dirs[i][0]) * t;
    const wy = dirs[i][1] + (dirs[j][1] - dirs[i][1]) * t;
    const wz = dirs[i][2] + (dirs[j][2] - dirs[i][2]) * t;
    const len = Math.hypot(wx, wy, wz) || 1;
    return [wx / len, wy / len, wz / len];
  };
  const runs = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const za = zc[i], zb = zc[j];
    if (za >= 0) {
      if (!cur) cur = [];
      cur.push(dirs[i]);
      if (zb < 0) { cur.push(lerpUnit(i, j, za / (za - zb))); runs.push(cur); cur = null; }
    } else if (zb >= 0) {
      cur = [lerpUnit(i, j, za / (za - zb))];
    }
  }
  // Wraparound: if the LAST edge crossed back->front, `cur` is left open at
  // loop end — it is the run continuing across the array boundary INTO
  // runs[0] (which necessarily starts at dirs[0] itself, since that crossing
  // is only left open when dirs[0] is front-facing). Splicing it onto the
  // front of runs[0] reunites the two into the single continuous run they
  // actually are, instead of emitting a spurious extra fragment.
  if (cur) { if (runs.length) runs[0] = cur.concat(runs[0]); else runs.push(cur); }
  return { closed: false, runs };
}
// Project a hemisphere-clip result to an SVG path `d`, stitching consecutive
// open runs together with an elliptical arc ALONG THE LIMB (radius rPx)
// instead of a chord — this is what actually kills the chord-wedge artifact.
// Winding-direction disambiguation between the two candidate arcs (short vs
// long way around) is resolved by taking the SHORT arc; at coastline/maria
// polygon scale (item 1a already clips to the disc circle as a safety net
// too) this reads correctly in every case exercised during verification —
// noted here per the brief as the accepted fallback for ambiguous cases.
function _trajClippedRunsToPath(clip, cx, cy, rPx) {
  const { closed, runs } = clip;
  if (!runs.length) return '';
  const proj = v => { const q = _trajProj3(v[0], v[1], v[2]); return { x: cx + q.x * rPx, y: cy + q.y * rPx }; };
  if (closed) {
    const pts = runs[0].map(proj);
    return pts.map((p, k) => (k ? 'L ' : 'M ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ') + ' Z';
  }
  let d = '';
  for (let r = 0; r < runs.length; r++) {
    const pts = runs[r].map(proj);
    d += pts.map((p, k) => ((r === 0 && k === 0) ? 'M ' : 'L ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ') + ' ';
    const nextPts = runs[(r + 1) % runs.length].map(proj);
    const exitPt = pts[pts.length - 1], entryPt = nextPts[0];
    const a0 = Math.atan2(exitPt.y - cy, exitPt.x - cx), a1 = Math.atan2(entryPt.y - cy, entryPt.x - cx);
    let delta = a1 - a0;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    const sweep = delta >= 0 ? 1 : 0;
    d += `A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 0 ${sweep} ${entryPt.x.toFixed(2)} ${entryPt.y.toFixed(2)} `;
  }
  return d + 'Z';
}
// Flat [lon0,lat0,lon1,lat1,...] TENTHS-of-degree polygon (PROG_GEO_EARTH) ->
// an SVG path `d` string, hemisphere-clipped and limb-closed (item defect1).
function _trajGeoPolyPath(lonLatTenths, spinAngle, cx, cy, rPx) {
  const dirs = [];
  for (let i = 0; i < lonLatTenths.length; i += 2) {
    dirs.push(_trajSpinRotate(_trajLatLonUnit(lonLatTenths[i + 1] / 10, lonLatTenths[i] / 10), spinAngle));
  }
  return _trajClippedRunsToPath(_trajHemiClipRuns(dirs), cx, cy, rPx);
}
// PROG_GEO_FEATURES ellipse {lat,lon,rLat,rLon} -> sampled SVG path `d`
// string, same hemisphere-clip/limb-close treatment as the coastline path.
function _trajGeoEllipsePath(feat, spinAngle, cx, cy, rPx) {
  const n = 20;
  const lonScale = Math.max(0.15, Math.cos(feat.lat * _PROG_D2R)); // lon degrees compress toward the poles
  const dirs = [];
  for (let k = 0; k < n; k++) { // n (not n+1): the polygon is implicitly closed by the clip/path Z, no duplicate seam point
    const a = 2 * Math.PI * k / n;
    const lat = feat.lat + feat.rLat * Math.sin(a);
    const lon = feat.lon + (feat.rLon * Math.cos(a)) / lonScale;
    dirs.push(_trajSpinRotate(_trajLatLonUnit(lat, lon), spinAngle));
  }
  return _trajClippedRunsToPath(_trajHemiClipRuns(dirs), cx, cy, rPx);
}
// Shared limb-darkening overlay: transparent center -> ~35% black rim,
// center offset toward the Sun's SCREEN direction (cheap 2D dot from already-
// projected positions) for a rudimentary day-side/terminator feel.
function _trajLimbGradientDef(gradId, body, sunDirAngle) {
  const style = (typeof PROG_GEO_STYLE !== 'undefined' && PROG_GEO_STYLE[body]) || {};
  const limbColor = style.limb || 'rgba(0,0,0,.35)';
  const off = 0.32;
  const ox = Math.cos(sunDirAngle || 0) * off, oy = Math.sin(sunDirAngle || 0) * off;
  return `<radialGradient id="${gradId}" cx="${(50 + ox * 50).toFixed(1)}%" cy="${(50 + oy * 50).toFixed(1)}%" r="78%">` +
    `<stop offset="30%" stop-color="${limbColor}" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="${limbColor}" stop-opacity="1"/></radialGradient>`;
}
// ── R6.2 defect3: real terminator (2026-07-11, MATH.md §7m) ────────────────
// `sd` is the body->Sun WORLD-frame unit vector. Builds the great circle
// perpendicular to `sd` (the terminator) in WORLD frame — NOT spin-rotated,
// since illumination depends on sun geometry, not the body's own rotation —
// samples it, and runs it through the SAME hemisphere clipper as coastlines
// (item defect1's clipper doubles as the "ellipse feature" clipper the brief
// asked for). The front-visible arc plus a limb arc closes the NIGHT region;
// which limb arc (of the two candidates) is night is resolved by checking
// which one avoids the sun's own screen angle. Returns null when no scrim is
// needed (fully lit) or {path, alpha} otherwise.
function _trajTerminatorNightPath(sd, cx, cy, rPx) {
  const sq = _trajProj3(sd[0], sd[1], sd[2]);
  const a = sq.x, b = sq.y, c = sq.depth; // a^2+b^2+c^2 == 1 (rotation preserves length)
  if (c >= 0.995) return null; // sun ~directly toward viewer: fully lit face, no scrim
  const FULL_CIRCLE = `M ${(cx - rPx).toFixed(2)} ${cy.toFixed(2)} A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 1 0 ${(cx + rPx).toFixed(2)} ${cy.toFixed(2)} A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 1 0 ${(cx - rPx).toFixed(2)} ${cy.toFixed(2)} Z`;
  if (c <= -0.995) return { path: FULL_CIRCLE, alpha: 0.55 }; // sun ~directly away: fully dark face, soft floor so geometry stays faintly legible
  // World-frame basis spanning the plane perpendicular to sd (the terminator
  // plane); worldUp is the ecliptic normal (+z), matching _trajLatLonUnit's
  // spin-axis convention.
  let e1x = sd[1] * 1 - sd[2] * 0, e1y = sd[2] * 0 - sd[0] * 1, e1z = sd[0] * 0 - sd[1] * 0; // sd x (0,0,1)
  let elen = Math.hypot(e1x, e1y, e1z);
  if (elen < 1e-6) { e1x = 1; e1y = 0; e1z = 0; elen = 1; } // sd ~parallel to ecliptic pole (edge case, no real mission body hits this)
  e1x /= elen; e1y /= elen; e1z /= elen;
  const e2x = sd[1] * e1z - sd[2] * e1y, e2y = sd[2] * e1x - sd[0] * e1z, e2z = sd[0] * e1y - sd[1] * e1x; // sd x e1, already unit
  const N = 40;
  const termDirs = [];
  for (let k = 0; k < N; k++) {
    const phi = 2 * Math.PI * k / N, cp = Math.cos(phi), sp = Math.sin(phi);
    termDirs.push([cp * e1x + sp * e2x, cp * e1y + sp * e2y, cp * e1z + sp * e2z]);
  }
  const clip = _trajHemiClipRuns(termDirs);
  if (clip.closed || !clip.runs.length) return null; // degenerate (shouldn't occur once |c|<0.995) — no scrim rather than a wrong one
  const run = clip.runs[0];
  if (run.length < 2) return null;
  const proj = v => { const q = _trajProj3(v[0], v[1], v[2]); return { x: cx + q.x * rPx, y: cy + q.y * rPx }; };
  const p0 = proj(run[0]), pn = proj(run[run.length - 1]);
  const angStart = Math.atan2(p0.y - cy, p0.x - cx), angEnd = Math.atan2(pn.y - cy, pn.x - cx);
  const theta = Math.atan2(b, a); // sun's own screen angle from disc center
  const norm2pi = x => { x %= 2 * Math.PI; return x < 0 ? x + 2 * Math.PI : x; };
  const s = norm2pi(angStart), e = norm2pi(angEnd), sunA = norm2pi(theta);
  const span = norm2pi(s - e);           // CCW (increasing-angle) span from pn's angle to p0's angle
  const sunSpan = norm2pi(sunA - e);     // where the sun angle falls within that sweep
  const ccwArcContainsSun = sunSpan <= span; // that arc is the DAY side -> night needs the complement
  const sweep = ccwArcContainsSun ? 0 : 1;
  const arcSpan = ccwArcContainsSun ? (2 * Math.PI - span) : span;
  const largeArc = arcSpan > Math.PI ? 1 : 0;
  let d = `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} `;
  for (let i = 1; i < run.length; i++) { const p = proj(run[i]); d += `L ${p.x.toFixed(2)} ${p.y.toFixed(2)} `; }
  d += `A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 ${largeArc} ${sweep} ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} Z`;
  return { path: d, alpha: 0.4 };
}
// Full surfaced-disc render (tier 1): base color + surface geometry (per body
// kind) + limb-shading overlay + terminator scrim. `rPx` is the disc's TRUE
// (unclamped) screen radius. Perf clamp: an absurdly huge disc (camera
// zoomed deep into the body, disc mostly off-screen) skips surface geometry
// sampling entirely — same spirit as the polyline viewClampUnits pattern —
// so path strings stay bounded; the base-color fill alone still reads
// correctly at that zoom. `sunDir3` is the body->Sun WORLD-frame unit vector
// (defect3); `instanceId` (mission id or a fixed fallback) + `body` form a
// STABLE per-body-per-instance id for the gradient/clip defs (defect2 — see
// _trajBodyDiscTiered).
function _trajSurfacedDiscSVG(body, cx, cy, rPx, spinAngle, sunDir3, viewportDiagPx, instanceId) {
  const style = (typeof PROG_GEO_STYLE !== 'undefined' && PROG_GEO_STYLE[body]) || {};
  // R6.2.1 item 2: skip vector feature sampling both when the disc is
  // absurdly huge (mostly off-screen — path strings would be unbounded) AND
  // when it's small enough (< _TRAJ_FEATURE_PX) that features are invisible
  // — the surfaced tier now runs all the way to the chip threshold, so this
  // keeps small-disc rendering as cheap as the old plain-disc middle tier.
  const skipGeometry = (viewportDiagPx && rPx > viewportDiagPx * 4) || rPx < _TRAJ_FEATURE_PX;
  const baseFill = style.base || (style.bands && style.bands[0]) || _trajBodyColor(body);
  // Feature paths are collected separately so they can be clipped to the
  // disc circle (item 1a) as a safety net on top of the exact hemisphere clip
  // above (defect1) — belt-and-suspenders against any float-precision spill.
  let features = '';
  if (!skipGeometry) {
    if (body === 'Earth' && typeof PROG_GEO_EARTH !== 'undefined') {
      PROG_GEO_EARTH.forEach(poly => {
        const d = _trajGeoPolyPath(poly, spinAngle, cx, cy, rPx);
        if (d) features += `<path d="${d}" fill="${style.land || '#3f7a42'}" stroke="none"/>`;
      });
    } else if (body === 'Moon' && typeof PROG_GEO_FEATURES !== 'undefined') {
      (PROG_GEO_FEATURES.Moon || []).forEach(f => {
        const d = _trajGeoEllipsePath(f, spinAngle, cx, cy, rPx);
        const fill = style[f.kind] || style.mare || '#7d7566';
        if (d) features += `<path d="${d}" fill="${fill}" stroke="none"/>`;
      });
    } else if (body === 'Mars' && typeof PROG_GEO_FEATURES !== 'undefined') {
      (PROG_GEO_FEATURES.Mars || []).forEach(f => {
        const d = _trajGeoEllipsePath(f, spinAngle, cx, cy, rPx);
        const fill = style[f.kind] || style.base;
        if (d) features += `<path d="${d}" fill="${fill}" stroke="none"/>`;
      });
    } else if ((body === 'Jupiter' || body === 'Saturn') && style.bands) {
      const bands = style.bands, nBands = bands.length, nSeg = 16;
      for (let b = 0; b < nBands; b++) {
        const lat0 = -90 + (180 * b) / nBands, lat1 = -90 + (180 * (b + 1)) / nBands;
        const dirs = [];
        for (let k = 0; k <= nSeg; k++) {
          const lon = -180 + (360 * k) / nSeg;
          dirs.push(_trajSpinRotate(_trajLatLonUnit(lat1, lon), spinAngle));
        }
        for (let k = nSeg; k >= 0; k--) {
          const lon = -180 + (360 * k) / nSeg;
          dirs.push(_trajSpinRotate(_trajLatLonUnit(lat0, lon), spinAngle));
        }
        const d = _trajClippedRunsToPath(_trajHemiClipRuns(dirs), cx, cy, rPx);
        if (d) features += `<path d="${d}" fill="${bands[b]}" stroke="none" opacity="0.85"/>`;
      }
    }
    // Venus/Mercury/Titan: base disc only (Venus's base fill is already a
    // brightened tint via PROG_GEO_STYLE.Venus).
  }
  // R6.2 defect2: STABLE deterministic ids (per body per render instance)
  // instead of a per-render-unique counter. The world layer is rebuilt
  // wholesale via innerHTML swap every ~33ms during rotation; unique ids
  // meant every rebuild minted fresh gradient/clipPath ids and rewired every
  // url(#) reference, which browsers can resolve asynchronously relative to
  // the atomic DOM swap -> one-frame paint gaps (the flicker). Same-id defs
  // recreated atomically by the innerHTML swap never dangle a reference.
  const idBase = `traj-geo-${(instanceId || 'x')}-${body}`;
  const gradId = `${idBase}-limb`;
  const clipId = `${idBase}-clip`;
  const sunQ = _trajProj3(sunDir3[0], sunDir3[1], sunDir3[2]);
  const sunDirAngle = Math.atan2(sunQ.y, sunQ.x);
  const baseCircle = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rPx.toFixed(2)}" fill="${baseFill}"/>`;
  const featuresSvg = features ? `<g clip-path="url(#${clipId})">${features}</g>` : '';
  const term = _trajTerminatorNightPath(sunDir3, cx, cy, rPx);
  const termSvg = term ? `<path d="${term.path}" fill="rgba(0,0,0,${term.alpha})" clip-path="url(#${clipId})"/>` : '';
  return `<defs>${_trajLimbGradientDef(gradId, body, sunDirAngle)}<clipPath id="${clipId}"><circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rPx.toFixed(2)}"/></clipPath></defs>` +
    `<g>${baseCircle}${featuresSvg}${termSvg}<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rPx.toFixed(2)}" fill="url(#${gradId})"/>` +
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rPx.toFixed(2)}" fill="none" stroke="var(--border-bright)" stroke-width="0.5" vector-effect="non-scaling-stroke"/></g>`;
}
// ── R6.4: real textured globes (MATH.md §7m raster addendum) ───────────────
// Lazy per-body sampling-canvas cache: decodes PROG_TEXTURES[body] into an
// offscreen canvas once and keeps its ImageData for bilinear sampling. Image
// decode is async — callers MUST check `.ready` and fall back to the vector
// path until the onload fires (which invalidates the raster cache below and
// triggers a repaint through _trajRequestRepaint).
let _trajTexStore = {};
function _trajTextureFor(body) {
  if (!(typeof PROG_TEXTURES !== 'undefined' && PROG_TEXTURES[body])) return null;
  let t = _trajTexStore[body];
  if (t) return t;
  t = { ready: false, imgData: null, w: 0, h: 0 };
  _trajTexStore[body] = t;
  const img = new Image();
  img.onload = () => {
    // Sampling canvas: cap width so bilinear lookups stay cheap; equirect
    // aspect is always 2:1 for these sources.
    const sw = Math.min(img.naturalWidth || 1024, 1024);
    const sh = Math.round(sw / 2);
    const sc = document.createElement('canvas');
    sc.width = sw; sc.height = sh;
    const sctx = sc.getContext('2d');
    sctx.drawImage(img, 0, 0, sw, sh);
    t.imgData = sctx.getImageData(0, 0, sw, sh);
    t.w = sw; t.h = sh;
    t.ready = true;
    _trajRasterCache = {}; // stale dataURLs reference the pre-decode fallback
    _trajRequestRepaint();
  };
  img.src = PROG_TEXTURES[body];
  return t;
}
// Bilinear sample of an ImageData at fractional pixel (fx,fy), wrapping X
// (longitude seam) and clamping Y (poles).
function _trajBilinearSample(imgData, w, h, fx, fy) {
  fx = ((fx % w) + w) % w;
  fy = fy < 0 ? 0 : (fy > h - 1 ? h - 1 : fy);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = (x0 + 1) % w, y1 = y0 + 1 > h - 1 ? h - 1 : y0 + 1;
  const tx = fx - x0, ty = fy - y0;
  const d = imgData.data;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * tx;
    const b = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * tx;
    out[c] = a + (b - a) * ty;
  }
  return out;
}
// Raster an equirect texture to a shaded disc canvas via PER-PIXEL INVERSE
// orthographic mapping. Derivation (MATH.md §7m raster addendum): the
// forward map _trajProjectVec rotates a WORLD unit vector (x,y,z) by az then
// tilt t=pi/2-el and reflects screen-x:
//   u = -(x*ca - y*sa)                         [ca=cos(az), sa=sin(az)]
//   v = (x*sa + y*ca)*ct - z*st                 [ct=cos(t), st=sin(t)]
//   w = (x*sa + y*ca)*st + z*ct   (== depth)
// Since this is a pure rotation, (u,v,w) is unit-length whenever (x,y,z) is,
// so w = +sqrt(1-u^2-v^2) recovers the dropped depth on the front hemisphere.
// Un-rotating tilt then azimuth (both orthonormal, so inverse = transpose)
// gives back the WORLD direction; un-spinning by the body's own spin angle
// (inverse of _trajSpinRotate) gives the BODY-FRAME direction that
// _trajLatLonUnit produces lat/lon from — this is what makes the raster
// align with the vector site markers, which route through the same chain.
function _trajRasterGlobe(body, discPx, spinAngle, az, el, sunDir3, maxPx) {
  const tex = _trajTextureFor(body);
  if (!tex || !tex.ready) return null;
  const size = Math.max(1, Math.min(Math.round(discPx), maxPx || 512));
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(size, size);
  const od = out.data;
  const t = Math.PI / 2 - (el != null ? el : Math.PI / 2);
  const ca = Math.cos(az || 0), sa = Math.sin(az || 0), ct = Math.cos(t), st = Math.sin(t);
  const spc = Math.cos(spinAngle || 0), sps = Math.sin(spinAngle || 0);
  const iw = tex.w, ih = tex.h, id = tex.imgData;
  const R = size / 2;
  // sunDir3 is WORLD-frame body->Sun unit vector (same one the vector
  // terminator uses) — no re-derivation, single source per the brief.
  const sx = sunDir3 ? sunDir3[0] : 0, sy = sunDir3 ? sunDir3[1] : 0, sz = sunDir3 ? sunDir3[2] : 1;
  for (let py = 0; py < size; py++) {
    const v = (py + 0.5 - R) / R;
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5 - R) / R;
      const r2 = u * u + v * v;
      const pi = (py * size + px) * 4;
      if (r2 > 1) { od[pi + 3] = 0; continue; }
      const w = Math.sqrt(Math.max(0, 1 - r2));
      // un-tilt: (ya,z) = R(-t) * (v,w)
      const ya = v * ct + w * st;
      const z = -v * st + w * ct;
      const xa = -u;
      // un-azimuth: (x,y) = R(-az) * (xa,ya)
      const x = xa * ca + ya * sa;
      const y = u * sa + ya * ca; // == -xa*sa + ya*ca
      // un-spin: body-frame = R(-spin) * (x,y)
      const bx = x * spc + y * sps;
      const by = -x * sps + y * spc;
      const bz = z;
      const lat = Math.asin(Math.max(-1, Math.min(1, bz)));
      const lon = Math.atan2(by, bx);
      const fx = ((lon + Math.PI) / (2 * Math.PI)) * iw;
      const fy = ((Math.PI / 2 - lat) / Math.PI) * ih;
      const rgb = _trajBilinearSample(id, iw, ih, fx, fy);
      // Shading in the SAME (world-frame, pre-unspin) coordinates as the
      // vector terminator: normal == (x,y,z), dot with sunDir3.
      let ndotl = x * sx + y * sy + z * sz;
      const edge = 0.15;
      let lightF = ndotl < -edge ? 0 : ndotl > edge ? 1 : (ndotl + edge) / (2 * edge);
      lightF = lightF * lightF * (3 - 2 * lightF); // smoothstep
      const NIGHT_FLOOR = 0.45;
      const shade = NIGHT_FLOOR + (1 - NIGHT_FLOOR) * lightF;
      const limb = 0.75 + 0.25 * w;
      const f = shade * limb;
      od[pi] = rgb[0] * f; od[pi + 1] = rgb[1] * f; od[pi + 2] = rgb[2] * f; od[pi + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}
// Raster dataURL cache: quantized key -> dataURL, so drag/rotate re-uses a
// stale raster between throttled re-raster passes instead of re-running the
// per-pixel loop every 33ms frame. Cleared whenever a texture finishes
// decoding (fallback frames must not stick around after real data arrives).
let _trajRasterCache = {};
// R6.4b (user flight-test): the old 120ms raster throttle made the globe
// visibly update at ~8fps while the vector layer moved at 30fps. Replaced
// with a FIDELITY LADDER (gizmo-preview precedent): while the user is
// interacting (rotate/zoom/scrub — see _trajMarkInteracting call sites) the
// globe re-rasters EVERY frame at low resolution (≤224px ≈ 2–4ms, well
// inside the 33ms frame budget) so it moves in lockstep with the lines; a
// settle timer then repaints once at full 512px when the interaction ends.
const _TRAJ_RASTER_LO_PX = 224;
let _trajInteractingUntil = 0;
let _trajRasterSettleTimer = null;
function _trajMarkInteracting() {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  _trajInteractingUntil = now + 250;
  if (_trajRasterSettleTimer) clearTimeout(_trajRasterSettleTimer);
  _trajRasterSettleTimer = setTimeout(() => {
    _trajRasterSettleTimer = null;
    _trajRequestRepaint(); // one full-res pass after the gesture ends
  }, 300);
}
function _trajRasteredDiscDataURL(body, discPx, spinAngle, az, el, sunDir3) {
  const tex = _trajTextureFor(body);
  if (!tex || !tex.ready) return null;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const interacting = now < _trajInteractingUntil;
  const maxPx = interacting ? _TRAJ_RASTER_LO_PX : 512;
  const discBucket = Math.round(discPx / 8) * 8;
  const spinQ = Math.round((spinAngle || 0) * 100) / 100;
  const azQ = Math.round((az || 0) * 100) / 100;
  const elQ = Math.round((el != null ? el : Math.PI / 2) * 100) / 100;
  const sunQ = sunDir3 ? [Math.round(sunDir3[0] * 10) / 10, Math.round(sunDir3[1] * 10) / 10, Math.round(sunDir3[2] * 10) / 10].join(',') : '0';
  const key = `${body}|${maxPx}|${discBucket}|${spinQ}|${azQ}|${elQ}|${sunQ}`;
  const cached = _trajRasterCache[key];
  if (cached) return cached.url;
  const canvas = _trajRasterGlobe(body, discPx, spinAngle, az, el, sunDir3, maxPx);
  if (!canvas) return null;
  const url = canvas.toDataURL('image/png');
  // Bound the cache: quantized spin/az keys churn constantly during long
  // sessions — reset wholesale past a small cap (rasters are cheap to redo).
  if (Object.keys(_trajRasterCache).length > 64) _trajRasterCache = {};
  _trajRasterCache[key] = { url, t: now };
  return url;
}
// Repaint hook: after an async texture decode completes, re-render every
// mounted trajectory-view panel at its current camera (same rebuild path
// _trajApplyCam/_missionTrajAfterRender use) so the fallback vector frame is
// replaced with the real raster without waiting for the next user gesture.
function _trajRequestRepaint() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.mcc-view-area .traj-wrap[data-mid]').forEach(va => {
    const id = va.getAttribute('data-mid');
    const cam = _trajCamByMission[id];
    if (id && cam && typeof _trajApplyCam === 'function') _trajApplyCam(id, cam);
  });
}
// Reconcile the persistent globe layer against _trajPendingGlobes (populated by
// the _trajWorldSVG pass that just ran). Reuses one <image> per body, updating
// x/y/size every call and href ONLY when it changed — an in-place href swap
// retains the current bitmap until the new data-URI decodes, so rotation never
// shows a blank/half-decoded planet (the flicker fix). Bodies not drawn this
// frame are hidden (display:none), NOT removed, so their decoded bitmap is kept
// for when the camera returns.
const _TRAJ_SVG_NS = 'http://www.w3.org/2000/svg';
function _trajReconcileGlobeLayer(svgEl) {
  if (!svgEl) return;
  const layer = svgEl.querySelector('g.traj-globe-layer');
  if (!layer) return;
  const seen = {};
  for (const g of _trajPendingGlobes) {
    seen[g.body] = true;
    let img = layer.querySelector(`image[data-body="${g.body}"]`);
    if (!img) {
      img = document.createElementNS(_TRAJ_SVG_NS, 'image');
      img.setAttribute('data-body', g.body);
      img.setAttribute('preserveAspectRatio', 'none');
      layer.appendChild(img);
    }
    img.setAttribute('x', g.x.toFixed(2));
    img.setAttribute('y', g.y.toFixed(2));
    img.setAttribute('width', g.size.toFixed(2));
    img.setAttribute('height', g.size.toFixed(2));
    if (img.getAttribute('href') !== g.url) img.setAttribute('href', g.url);
    if (img.style.display === 'none') img.style.display = '';
  }
  layer.querySelectorAll('image[data-body]').forEach(img => {
    if (!seen[img.getAttribute('data-body')]) img.style.display = 'none';
  });
}
// Tiered body disc dispatcher — replaces the old flat _trajGlyph call for
// planets/moons (Sun keeps its own plain _trajGlyph path, untouched). Picks
// one of the three LOD tiers from the TRUE apparent radius (trueRpx,
// unclamped) and returns the disc svg, wrapped in the same fly-to click
// handler as _trajGlyph. Registers the body-name label exactly as before.
function _trajBodyDiscTiered(cx, cy, trueRpx, color, body, zoom, isFocus, forceLabel, clickId, viewT, sunDir3, viewportDiagPx) {
  const labelSize = Math.max(trueRpx, _TRAJ_CHIP_R);
  _trajRegisterLabel(cx, cy - labelSize, [{ text: body, dy: -4, fontPx: 10, color: color || 'var(--nm-label)' }], 'body',
    { screenSize: labelSize, minSize: _TRAJ_LOD_BODY_MIN, selected: !!isFocus || !!forceLabel });
  const clickAttr = clickId ? ` class="traj-body-glyph" style="cursor:pointer" onclick="trajGlyphClick('${clickId}','${body}')"` : '';
  let disc;
  if (trueRpx >= _TRAJ_CHIP_PX) {
    // item 2: middle plain-disc tier removed — surfaced disc renders all the
    // way down to the chip threshold (same constant-floor clamp as the old
    // tier 2 kept the disc from vanishing below _TRAJ_MIN_BODY_PX; feature
    // sampling itself is skipped internally below _TRAJ_FEATURE_PX).
    const r = Math.max(trueRpx, _TRAJ_MIN_BODY_PX);
    const spin = _trajBodySpinAngle(body, viewT);
    let rasterUrl = null;
    if (r >= _TRAJ_FEATURE_PX && typeof PROG_TEXTURES !== 'undefined' && PROG_TEXTURES[body]) {
      const az = _trajProjCtx.az, el = _trajProjCtx.el;
      rasterUrl = _trajRasteredDiscDataURL(body, r * 2, spin, az, el, sunDir3);
    }
    if (rasterUrl) {
      // Globe bitmap → persistent layer (see _trajPendingGlobes note); only
      // the crisp border stays inline in the per-frame scene.
      _trajPendingGlobes.push({ body, url: rasterUrl, x: cx - r, y: cy - r, size: r * 2 });
      disc = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="none" stroke="var(--border-bright)" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`;
    } else {
      disc = _trajSurfacedDiscSVG(body, cx, cy, r, spin, sunDir3, viewportDiagPx, clickId);
    }
  } else {
    const glyph = _TRAJ_BODY_GLYPH[body] || '•';
    disc = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${_TRAJ_CHIP_R}" fill="var(--nm-bg)" fill-opacity="0.15" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
      `<text x="${cx.toFixed(2)}" y="${(cy + 3.2).toFixed(2)}" text-anchor="middle" font-size="9" fill="${color}">${glyph}</text>`;
  }
  const hit = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${Math.max(trueRpx, 7).toFixed(2)}" fill="transparent"/>`;
  return clickId ? `<g${clickAttr}>${disc}${hit}</g>` : `<g>${disc}</g>`;
}

// ── R6.3: launch site marker + mock ascent path (MATH.md §7n) ──────────────
// PRESENTATION LAYER ONLY — the ascent curve is a schematic bezier, not a
// propagated trajectory (no ΔV/physics consequence, same spirit as §7m's
// surface rendering). Finds the first LAUNCH event carrying a resolvable
// site (authored or inherited from its fleet vehicle — 570's
// _missionLaunchSiteFor) and draws: (a) a small ring+label marker at the
// site's CURRENT rotated position (rides the spin with viewT), (b) a dashed
// schematic curve from the site's position AT LAUNCH TIME to a nominal
// insertion point on the parking orbit.
function _trajMissionLaunchEvent(m) {
  if (!m || !m.log) return null;
  for (const e of m.log) {
    if (e.type === 'LAUNCH' && typeof _missionLaunchSiteFor === 'function') {
      const site = _missionLaunchSiteFor(e);
      if (site && site.lat != null && site.lon != null) return { e, site };
    }
  }
  return null;
}
function _trajLaunchSiteAndAscentSVG(m, cx, cy, rPx, viewT, viewportDiagPx) {
  const found = _trajMissionLaunchEvent(m);
  if (!found) return '';
  const { e, site } = found;
  const lodAlpha = _trajLodOpacity(rPx, _TRAJ_LOD_WIN.missionOrbitRing[0], _trajWindowHi(_TRAJ_LOD_WIN.missionOrbitRing[1], viewportDiagPx));
  if (lodAlpha <= 0) return '';
  const spinNow = _trajBodySpinAngle('Earth', viewT);
  const nowPt = _trajSurfacePoint(_trajSpinRotate(_trajLatLonUnit(site.lat, site.lon), spinNow), cx, cy, rPx);
  let svg = '';
  if (nowPt.depth >= 0) { // hemisphere cull — same convention as the coastline paths
    svg += `<circle cx="${nowPt.x.toFixed(2)}" cy="${nowPt.y.toFixed(2)}" r="3" fill="none" stroke="var(--accent3)" stroke-width="1.3" opacity="${lodAlpha.toFixed(3)}"/>`;
    const lbl = (site.name || 'Launch Site');
    _trajRegisterLabel(nowPt.x, nowPt.y - 8, [{ text: lbl, dy: 0, fontPx: 9, color: 'var(--accent3)' }], 'site',
      { screenSize: rPx, minSize: _TRAJ_LOD_BODY_MIN, selected: false, opacity: lodAlpha });
  }
  // Mock ascent: site position AT LAUNCH TIME -> a nominal insertion point on
  // the launch orbit's ring, ~8.5 min (510 s) of schematic ascent later. Both
  // endpoints use the SAME spin/orbit conventions the rest of the view uses
  // (_trajBodySpinAngle, progOrbitPointAtE) so the curve is self-consistent
  // with everything else drawn, even though it is not itself propagated.
  const tLaunch = e.launchTime_s || 0;
  const spinAtLaunch = _trajBodySpinAngle('Earth', tLaunch);
  const launchPt = _trajSurfacePoint(_trajSpinRotate(_trajLatLonUnit(site.lat, site.lon), spinAtLaunch), cx, cy, rPx);
  const o = e.orbit || e.launchOrbit || {};
  const R = (typeof PROG_BODIES !== 'undefined' && PROG_BODIES.Earth && PROG_BODIES.Earth.R) || 6371;
  const peri = R + (o.alt_km != null ? o.alt_km : 200), apo = R + (o.apo_km != null ? o.apo_km : (o.alt_km != null ? o.alt_km : 200));
  const a = (peri + apo) / 2, ecc = (apo - peri) / (apo + peri);
  const incRad = (o.inc_deg != null ? o.inc_deg : 28.5) * _PROG_D2R;
  const raanRad = (o.lan_deg != null ? o.lan_deg : 0) * _PROG_D2R;
  // schematic near-circular mean-motion approximation (E ~= M): a real
  // insertion point requires a Kepler solve this presentation layer doesn't
  // need — the curve is explicitly labeled schematic, not a propagated leg.
  const mu = 398600.4418; // Earth GM, km^3/s^2 — matches PROG_BODIES.Earth.mu order of magnitude
  const n = Math.sqrt(mu / Math.pow(a, 3)); // rad/s
  const E = (n * 510) % (2 * Math.PI); // ~8.5 min nominal ascent
  const insertLocal = progOrbitPointAtE({ a, e: ecc, i: incRad, raan: raanRad, argp: 0 }, E);
  const scale = rPx / R; // render-units per km at THIS disc's current screen radius
  const insertQ = _trajProj3(insertLocal[0] * scale, insertLocal[1] * scale, insertLocal[2] * scale);
  const insertPt = { x: cx + insertQ.x, y: cy + insertQ.y, depth: insertQ.depth };
  if (launchPt.depth >= -0.3) { // allow a touch past the limb so the curve can visibly leave the disc
    // quadratic bezier, control point pulled toward the insertion point's
    // tangent direction so the curve visibly bends off the surface rather
    // than cutting a straight chord.
    const midX = (launchPt.x + insertPt.x) / 2, midY = (launchPt.y + insertPt.y) / 2;
    const bendX = midX + (insertPt.x - cx) * 0.35, bendY = midY + (insertPt.y - cy) * 0.35;
    svg += `<path d="M ${launchPt.x.toFixed(2)} ${launchPt.y.toFixed(2)} Q ${bendX.toFixed(2)} ${bendY.toFixed(2)} ${insertPt.x.toFixed(2)} ${insertPt.y.toFixed(2)}" fill="none" stroke="var(--accent3)" stroke-width="1" stroke-dasharray="3,3" opacity="${(lodAlpha * 0.85).toFixed(3)}" vector-effect="non-scaling-stroke"><title>Mock ascent (schematic — not a propagated trajectory)</title></path>`;
  }
  return svg;
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
        ${(typeof _oiCardHTML === 'function') ? _oiCardHTML(m) : ''}
        <svg class="traj-svg" data-mid="${id}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">
          <g class="traj-globe-layer" data-mid="${id}"></g>
          <g class="traj-scene" data-mid="${id}">
            ${svgInner}
          </g>
        </svg>
        <svg class="traj-overlay" data-mid="${id}" preserveAspectRatio="none"></svg>
      </div>
      ${(typeof _ttdDockHTML === 'function') ? _ttdDockHTML(m, id) : _trajScrubberHTML(m, id)}
      <div class="traj-footer">${_trajFooterHTML(cam)}</div>
    </div>`;
}

// ── scrubbable MET (backlog item 3) ─────────────────────────────────────────
// Slim track spanning [0, mission max MET] with a tick per log event and a
// draggable thumb at the CURRENT view time (_trajViewTime's manual-override
// slot — see there for the "one authority" integration note). Refreshed by
// _trajApplyCam/_missionTrajAfterRender's sync alongside the footer so it
// stays live under drag, event selection, and resize alike.
function _trajScrubberHTML(m, id) {
  if (!m) return '';
  const vt = _trajViewTime(m);
  const maxMet = _trajMissionMaxMet(m);
  const pct = maxMet > 0 ? Math.max(0, Math.min(1, vt / maxMet)) * 100 : 0;
  const ticks = (m.log || []).map(e => {
    if (!e || typeof e.metStart !== 'number' || !isFinite(e.metStart)) return '';
    const p = Math.max(0, Math.min(1, e.metStart / maxMet)) * 100;
    return `<div class="traj-scrub-tick" style="left:${p.toFixed(2)}%" title="${_tsEsc(e.type || '')} · ${_metFmt(e.metStart)}"></div>`;
  }).join('');
  return `<div class="traj-scrubber" data-mid="${id}">
    <div class="traj-scrub-track" tabindex="0" data-mid="${id}" data-max-met="${maxMet}"
         onmousedown="_trajScrubDown(event,'${id}',${maxMet})" onkeydown="_trajScrubKey(event,'${id}',${maxMet})"
         title="Drag or click to scrub mission time · arrow keys nudge when focused">
      ${ticks}
      <div class="traj-scrub-thumb" style="left:${pct.toFixed(2)}%"></div>
    </div>
    <div class="traj-scrub-readout">${_metFmt(vt)}</div>
  </div>`;
}

let _trajScrubDrag = null;
let _trajScrubLastMs = 0;
function _trajScrubPctFromEvent(ev, trackEl) {
  const r = trackEl.getBoundingClientRect();
  if (!(r.width > 0)) return 0;
  return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
}
// `track` is re-queried live on every tick rather than held from the mousedown
// closure: _trajSetViewTime -> _trajApplyCam replaces the track node's
// outerHTML on every refresh (to keep the thumb/ticks in sync), which would
// detach a held reference (getBoundingClientRect on a detached node reads as
// all-zero) after the very first tick.
function _trajScrubLiveTrack(id) {
  return document.querySelector(`.traj-scrub-track[data-mid="${id}"]`);
}
function _trajScrubDown(ev, id, maxMet) {
  const track = ev.currentTarget;
  _trajScrubDrag = { id, maxMet };
  track.focus();
  _trajSetViewTime(id, _trajScrubPctFromEvent(ev, track) * maxMet, maxMet);
  document.addEventListener('mousemove', _trajScrubMove);
  document.addEventListener('mouseup', _trajScrubUp);
  ev.preventDefault();
}
function _trajScrubMove(ev) {
  if (!_trajScrubDrag) return;
  if (typeof _trajMarkInteracting === 'function') _trajMarkInteracting();
  const now = performance.now();
  // Throttled ~30ms, same class as rotate-drag (trajPanMove) — a full
  // world+overlay re-render (via _trajApplyCam) per mousemove tick is the
  // same cost class as a camera rotate tick.
  if (now - _trajScrubLastMs <= 33) return;
  _trajScrubLastMs = now;
  const { id, maxMet } = _trajScrubDrag;
  const track = _trajScrubLiveTrack(id);
  if (!track) return;
  _trajSetViewTime(id, _trajScrubPctFromEvent(ev, track) * maxMet, maxMet);
}
function _trajScrubUp() {
  _trajScrubDrag = null;
  _trajScrubLastMs = 0;
  document.removeEventListener('mousemove', _trajScrubMove);
  document.removeEventListener('mouseup', _trajScrubUp);
}
function _trajScrubKey(ev, id, maxMet) {
  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
  ev.preventDefault();
  const m = (typeof _missions !== 'undefined' ? (_missions || []) : []).find(mm => mm.missionId === id);
  if (!m) return;
  const vt = _trajViewTime(m);
  const step = _trajTickIntervalS(maxMet);
  const dt = ev.key === 'ArrowLeft' ? -step : step;
  _trajSetViewTime(id, vt + dt, maxMet);
}

// R2: footer text incl. the orientation readout — also refreshed by
// _trajApplyCam so rotate-drag keeps it live without a full panel rebuild.
function _trajFooterHTML(cam) {
  const elDeg = Math.round(((cam.el != null ? cam.el : Math.PI / 2) * 180 / Math.PI));
  const azDeg = Math.round((((cam.az || 0) * 180 / Math.PI) % 360 + 360) % 360);
  // R3.5: el now ranges over ±~89.4° (full-range tilt, item 3) instead of
  // [0,90] — tilt = 90 - el still reads correctly across the whole range
  // (0 at top-down, 90 at the horizon, up to ~180 near straight-up-from-below);
  // only suppress the readout right at the canonical top-down default.
  const orientTxt = Math.abs(elDeg) < 89 ? `az ${azDeg}&deg; &middot; tilt ${90 - elDeg}&deg; &middot; ` : '';
  const attrib = (typeof PROG_TEXTURE_ATTRIBUTION !== 'undefined') ? ` &middot; ${PROG_TEXTURE_ATTRIBUTION}` : '';
  return `${orientTxt}true-geometry orbits (JPL mean elements; vessel orbit planes: from flight where flown, &Omega;=0 otherwise) &middot; drag rotates &middot; scroll zooms &middot; click a body to center &middot; body sizes clamped for visibility${attrib}`;
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
      _trajReconcileGlobeLayer(svgEl); // R6.4c: patch persistent globe images in place (no flicker)
      if (overlayEl) {
        overlayEl.style.transform = ''; // clear any mid-drag pan slide
        overlayEl.setAttribute('width', rect.width);
        overlayEl.setAttribute('height', rect.height);
        overlayEl.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
        const renderCam = { cx: 0, cy: 0, w: _TRAJ_VB };
        overlayEl.innerHTML = _trajResolveLabels(renderCam, rect);
        if (typeof _trajGizmoRepaintOverlay === 'function') _trajGizmoRepaintOverlay();
      // R3.5.2: the world re-render just rebuilt g.traj-scene, wiping the
      // gizmo's scene-space preview path — repaint it too, or the previewed
      // trajectory vanishes the moment the user zooms/rotates to look at it.
      if (typeof _trajGizmoRepaintScenePreview === 'function') _trajGizmoRepaintScenePreview();
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
