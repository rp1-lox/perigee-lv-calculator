// ─── TRAJECTORY CAMERA — state, projection seam, pan/zoom ──────────────────
// Per-mission camera state (_trajCamByMission) and zoom clamps; the single
// projection seam _trajProjectVec (+ _trajProj3/_trajProjLocal and the az/el
// context _trajProjCtx); framing (_trajCamCenterKm, _trajFitWKmForBody,
// trajSetFocus, trajResetView, _trajApplyCam) and fly-to animation; wheel-zoom
// and pan interaction; body-color / moons lookups. Loads before the other
// 574x modules.

// Camera per mission: { anchorBody, relOffsetKm:{x,y}, wKm }.
//   anchorBody   — body name the camera tracks ('Sun' or any PROG_BODIES key)
//   relOffsetKm  — pan offset from the anchor's world position, in km
//   wKm          — camera viewBox width, in km (zoom = independent of any
//                  scene-local `scale` factor now — it's real km)
let _trajCamByMission = {};

// ── Non-mission stub registry (Architecture-page World mount) ────────────────
// The Architecture page reuses this whole trajectory renderer to draw the
// program's authored orbit ladder in the exact same solar-system view the
// Mission World surface uses (see 610-architecture-map.js). It drives the
// render with a transient STUB mission object (empty log, id '__arch__' /
// '__archplan__') carrying only the sanctioned `_extraRings`/`_extraEdges`
// inputs — registered here, NEVER in `_missions`, so autosave/session (which
// walk `_missions`) can never see it. Camera/view state for the stub lives in
// the existing missionId-keyed side tables under its id (transient, resets on
// reload, same spirit as every other camera). Real missions never appear here.
let _trajExtraMissions = {};

// Resolve a mission id to its object: a real mission first, else a registered
// stub. Every camera/render site that used `(_missions||[]).find(...)` now
// routes through this so the World renderer works for the Architecture stub
// too — behavior is byte-identical for real missions (find still wins).
function _trajMissionById(id) {
  const arr = (_missions) ? _missions : [];
  const found = arr.find(mm => mm.missionId === id);
  if (found) return found;
  return (_trajExtraMissions && _trajExtraMissions[id]) || null;
}

// Find a mounted traj-wrap by id. The Mission World surface lives inside
// `.mcc-view-area` (kept as the preferred, unambiguous scope so mission
// behavior is unchanged); the Architecture-page mount lives elsewhere, so fall
// back to a global lookup. A given data-mid is unique (real missionId vs the
// two arch stub ids), so the fallback can never grab the wrong wrap.
function _trajFindWrap(id) {
  return document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"]`)
    || document.querySelector(`.traj-wrap[data-mid="${id}"]`);
}

// Re-render the surface that owns a given id after a camera anchor change:
// real missions + the Plan-mirror stub go through missionRenderDetail(); the
// Architecture-page stub re-mounts through archMapRender(). (trajSetFocus needs
// a full re-mount for the instant floating-origin re-center on the new anchor.)
function _trajRequestRerender(id) {
  if (id === '__arch__') { archMapRender(); return; }
  missionRenderDetail();
}

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
  if (PROG_BODY_COLORS[body]) return PROG_BODY_COLORS[body];
  if (PROG_MOON_ORBITS && PROG_MOON_ORBITS[body]) return (PROG_BODY_COLORS.Moon) || 'var(--nm-lunar)';
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
  // R6.3 handedness fix: world coords use the standard
  // right-handed ecliptic convention (+z north, CCW prograde motion/east
  // longitude as seen from +z looking down: x-right, y-UP). SVG screen space
  // is y-DOWN, so plotting world-y directly as screen-y is a reflection —
  // it mirrored geography (Australia rendered left of Asia) AND orbital
  // motion (prograde appeared clockwise) system-wide, since every consumer
  // (surface points, gizmo, hover rails, ring tangents) routes through this
  // one seam. R6.3b: the first fix negated screen-Y, which
  // repairs chirality but points north DOWN at tilted views (the tilt term's
  // sign flipped with it) — the world read as "flipped 180°". Negating
  // screen-X instead is the other det=−1 reflection: chirality fixed AND the
  // north pole tilts toward the TOP of the screen (+z → v=−z·st → up in SVG's
  // y-down space).
  return { x: -xa, y: ya * ct - (z || 0) * st, depth: ya * st + (z || 0) * ct };
}
// Per-render-pass projection context (set by _trajWorldSVG from the camera;
// helpers below read it so every emission site shares ONE projection).
// FrameKind/frameBody/viewT added — 'inertial' (default) is a no-op path
// (frameKind check short-circuits below, zero overhead, byte-identical to
// pre-N3 rendering).
let _trajProjCtx = { az: 0, el: Math.PI / 2, frameKind: 'inertial', frameBody: 'Earth', viewT: 0 };
/** Project a 3D vector (any consistent units) through the pass camera. `t` is
 *  the vector's OWN epoch (seconds); omitted for content already evaluated
 *  "now" (bodies, glyphs, spin-baked surface points) — defaults to viewT.
 *  For why t=viewT is NOT an identity no-op for non-inertial
 *  frames (that's what makes e.g. the Moon render frame-fixed). */
function _trajProj3(x, y, z, t) {
  const ctx = _trajProjCtx;
  if (ctx.frameKind && ctx.frameKind !== 'inertial') {
    const tv = t != null ? t : ctx.viewT;
    const fc = _trajFrameTransform(ctx.frameKind, ctx.frameBody, [x, y, z || 0], tv);
    return _trajProjectVec(fc[0], fc[1], fc[2], ctx.az, ctx.el);
  }
  return _trajProjectVec(x, y, z, ctx.az, ctx.el);
}
/** Project a PLANAR (ecliptic z=0) local offset through the pass camera. */
function _trajProjLocal(dx, dy) { const p = _trajProjectVec(dx, dy, 0, _trajProjCtx.az, _trajProjCtx.el); return { x: p.x, y: p.y }; }

// Effective camera center in heliocentric km at the given view time — the
// ONE place anchor + offset combine. Everything else in the render path
// subtracts this from world km to get floating-origin render coords.
// z rides along (R2): the anchor body's real out-of-plane position keeps it
// centered under tilt. `overrides` is a retired R1 vestige, ignored.
//
// Maneuver-gizmo camera-follow RETIRED (user-reported "camera
// keeps recentering on the node" — the follow was itself a workaround for an
// earlier bug, "node disappears when I zoom in", from when wheel-zoom always
// shrank the view around the ANCHOR BODY'S center: a LEO node ~6,500+ km from
// Earth's center was never reachable by zooming in, at any zoom level,
// because the point the zoom converged on was wrong, not because the node's
// own glyph/hit-target was too small (those are already constant screen-px,
// see 5745-maneuver-gizmo.js). Recentering the WHOLE scene on the node every
// render fixed reachability but cost the user their own framing/orientation
// choice the moment a gizmo opened. CURSOR-ANCHORED zoom (standard
// scroll-to-zoom UX) was tried next as a fix for the same reachability
// problem, but drifted the camera off the anchor body onto an arbitrary
// point in space, which the user also rejected ("the render should be
// centered on a planet, not a random point in space") — RETIRED in turn on
// trajWheelZoom is back to pure wKm contraction about the anchor
// body's center; relOffsetKm is permanently {0,0} again (drag-pan stays cut,
// same as R3.4). The original reachability problem is moot now that the
// gizmo draws on top, on the real orbit plane, always clickable regardless
// of zoom.
function _trajCamCenterKm(cam, viewT) {
  const p = progBodyWorldPos(cam.anchorBody, viewT);
  const off = cam.relOffsetKm || { x: 0, y: 0 };
  return { x: p.x + off.x, y: p.y + off.y, z: p.z || 0 };
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

// ── V1 fly-to easing (MISSION_MODEL_V2 §18) ─────────────────────────────────
// Camera anchor/zoom/orientation changes ease (cubic in-out, ~600ms) instead
// of snapping. The floating-origin design re-centers on the new anchor body
// INSTANTLY (that's a precision requirement, not a style choice — see the
// module header), so what eases here is wKm (zoom) and az/el (orientation);
// a true zoom-out/arc/zoom-in path between distant bodies is V2+ (spec).
// Interrupted cleanly by any user drag/wheel interaction mid-flight
// (trajPanStart/trajWheelZoom cancel the animation for that mission id).
let _trajFlyAnim = {}; // id -> requestAnimationFrame handle
function _trajEaseCubicInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function _trajCancelFlyTo(id) {
  if (_trajFlyAnim[id] != null) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_trajFlyAnim[id]);
    delete _trajFlyAnim[id];
  }
}
function _trajFlyTo(id, targetCam) {
  _trajCancelFlyTo(id);
  const from = _trajCam(id);
  const az0 = from.az || 0, el0 = from.el != null ? from.el : Math.PI / 2, wKm0 = from.wKm;
  const az1 = targetCam.az != null ? targetCam.az : az0;
  const el1 = targetCam.el != null ? targetCam.el : el0;
  let dAz = az1 - az0; // shortest-path wrap so a near-2pi az doesn't spin the long way
  while (dAz > Math.PI) dAz -= 2 * Math.PI;
  while (dAz < -Math.PI) dAz += 2 * Math.PI;
  const dur = 600, t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const step = () => {
    if (_trajDrag && _trajDrag.id === id) { delete _trajFlyAnim[id]; return; } // interrupted by drag on this panel
    const p = Math.min(1, ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) / dur);
    const e = _trajEaseCubicInOut(p);
    const cam = Object.assign({}, targetCam, {
      az: az0 + dAz * e,
      el: el0 + (el1 - el0) * e,
      wKm: wKm0 + (targetCam.wKm - wKm0) * e,
      relOffsetKm: { x: 0, y: 0 },
    });
    _trajApplyCam(id, cam);
    if (p < 1) { _trajFlyAnim[id] = requestAnimationFrame(step); }
    else delete _trajFlyAnim[id];
  };
  _trajFlyAnim[id] = requestAnimationFrame(step);
}

function trajSetFocus(id, body) {
  const m = _trajMissionById(id);
  const wKm = _trajFitWKmForBody(body, m);
  const prev = _trajCam(id); // fly-to keeps the user's 3D orientation
  const target = { anchorBody: body, relOffsetKm: { x: 0, y: 0 }, wKm, az: prev.az || 0, el: prev.el != null ? prev.el : Math.PI / 2 };
  // The anchor swap itself must be instant (floating-origin re-center is a
  // precision requirement) — seed the camera at the new anchor but the OLD
  // zoom/orientation, mount the panel there, then ease wKm/az/el to target.
  _trajCamByMission[id] = Object.assign({}, target, { wKm: prev.wKm, az: prev.az || 0, el: prev.el != null ? prev.el : Math.PI / 2 });
  _trajRequestRerender(id);
  _trajFlyTo(id, target);
}

function trajResetView(id) {
  const cam = _trajCam(id);
  const m = _trajMissionById(id);
  const wKm = _trajFitWKmForBody(cam.anchorBody, m);
  // Reset returns to the canonical top-down view (az/el included) — anchor is
  // unchanged, so no instant re-mount is needed; just ease there.
  _trajFlyTo(id, { anchorBody: cam.anchorBody, relOffsetKm: { x: 0, y: 0 }, wKm, az: 0, el: Math.PI / 2 });
}

// Re-render both layers + update the world <svg>'s viewBox attribute — cheap
// camera-only update path shared by wheel-zoom and pan so neither has to
// rebuild the whole mission panel.
function _trajApplyCam(id, cam) {
  _trajCamByMission[id] = cam;
  const va = _trajFindWrap(id);
  if (!va) { _trajRequestRerender(id); return; }
  const svgEl = va.querySelector('svg.traj-svg');
  const overlayEl = va.querySelector('svg.traj-overlay');
  if (!svgEl) { _trajRequestRerender(id); return; }
  const rect = svgEl.getBoundingClientRect();
  const aspect = (rect.width > 0 && rect.height > 0) ? (rect.height / rect.width) : 1;
  // Geometry is emitted in render units (km·zoom), so the viewBox is a
  // CONSTANT ~±200-unit window regardless of camera width — attribute floats
  // stay small at every zoom (software-rasterizer safety; see _trajWorldSVG).
  const vbH = _TRAJ_VB * aspect;
  svgEl.setAttribute('viewBox', `${(-_TRAJ_VB / 2).toFixed(3)} ${(-vbH / 2).toFixed(3)} ${_TRAJ_VB.toFixed(3)} ${vbH.toFixed(3)}`);
  const sceneEl = svgEl.querySelector('g.traj-scene');
  if (sceneEl) {
    const m = _trajMissionById(id);
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
      _trajGizmoRepaintOverlay();
      // The world re-render just rebuilt g.traj-scene, wiping the
      // gizmo's scene-space preview path — repaint it too, or the previewed
      // trajectory vanishes the moment the user zooms/rotates to look at it.
      _trajGizmoRepaintScenePreview();
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
  if (scrubEl) {
    const mm = (_missions || []).find(x => x.missionId === id);
    if (mm) {
      const hadFocus = scrubEl.contains(document.activeElement);
      scrubEl.outerHTML = _trajScrubberHTML(mm, id);
      if (hadFocus) {
        const t = va.querySelector('.traj-scrub-track');
        if (t) t.focus();
      }
    }
  }
}

function trajWheelZoom(ev, id) {
  ev.preventDefault();
  _trajCancelFlyTo(id); // V1: wheel interrupts an in-flight ease
  _trajMarkInteracting();
  const cam = _trajCam(id);
  const dir = ev.deltaY < 0 ? 1 : -1;
  const nextW = Math.max(_TRAJ_WKM_MIN, Math.min(_TRAJ_WKM_MAX, cam.wKm * (1 - dir * 0.15)));
  if (nextW === cam.wKm) return;
  // Strict body-centered zoom (restored, see the module-header
  // note above the retired cursor-anchored attempt): wKm contraction only,
  // about the ANCHOR BODY's center. relOffsetKm stays permanently {0,0} —
  // if a camera somehow carries a stale nonzero offset (e.g. from an older
  // in-session state), snap it back here rather than propagating it.
  _trajApplyCam(id, Object.assign({}, cam, { relOffsetKm: { x: 0, y: 0 }, wKm: nextW }));
}

let _trajDrag = null;
// Set true when a pan-drag actually moved the pointer (>3px, same threshold as
// the node map's missionNmPanMove) so the click that follows a real drag on an
// interactive arc/marker/ring doesn't also select an event (drag-vs-click
// disambiguation, per the node map / library-browser _didDrag pattern).
let _trajJustDragged = false;
function trajPanStart(ev, id) {
  // Plain left-drag ROTATES by default now (the enabler
  // for a grabbable gizmo. Shift-drag / right-
  // button drag remain aliases for rotate (kept for muscle-memory / R2 users).
  // Drag-PAN is retired entirely — relOffsetKm is only ever written as {0,0}
  // (see _trajCam / trajResetView / trajSetFocus) but the field stays on the
  // camera struct because the fit/zoom math still reads it.
  _trajCancelFlyTo(id); // V1: a drag interrupts an in-flight ease cleanly
  _trajDrag = { id, x0: ev.clientX, y0: ev.clientY, cam0: Object.assign({}, _trajCam(id), { relOffsetKm: Object.assign({}, _trajCam(id).relOffsetKm) }), moved: false };
  ev.preventDefault();
}
// Rotate re-renders per move (same cost class as wheel zoom); throttle to
// ~one render per animation-frame-ish interval so slow machines stay live.
let _trajRotLastMs = 0;
function trajPanMove(ev) {
  if (!_trajDrag) return;
  _trajMarkInteracting();
  const dx = ev.clientX - _trajDrag.x0, dy = ev.clientY - _trajDrag.y0;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _trajDrag.moved = true;
  const cam0 = _trajDrag.cam0;
  // Az already wrapped freely (JS `%` on a
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
