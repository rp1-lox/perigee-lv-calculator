// ──────────────────────────────────────────────────────────────────────────────────
// 5745-maneuver-gizmo-hover.js — Hover-ball + placement-menu subsystem (rings & legs)
//
// OWNS: the KSP-style hover ghost-ball and node-placement menu shared by orbit
//   rings and physics legs — rail nearest-point + ring/leg hover rails
//   (_trajRingHoverRail, _trajLegHoverRail, _trajRailNearestPoint, _trajGizmoOrbitNodeAt),
//   the hover ghost-ball paint/move/leave state (_trajRingHover*, _trajLegHoverMove),
//   the placement menu (_trajRingMenu*, _trajRingMenuPlaceNode, _trajRingMenuUseAddEvent,
//   _missionPendingEventMet — the MET handed to "Use time in Add Event"), and the
//   ring/leg click entry points (_trajRingClick, _trajLegClick).
// Does NOT own: the gizmo overlay/handles/drag (residual core + -drag module) or the
//   pure math (-math module).
// Split out of 5745-maneuver-gizmo.js (behavior-preserving move). Definitions/decls
//   only (no load-time execution); load order among 5745* def-only modules is irrelevant.
// ────────────────────────────────────────────────────────────────────────────

// ── R6.1.2: KSP-style hover ball + placement menu on ring hit paths ────────
// Reuses the exact rail math the center-knob drag already validated (mean-
// anomaly circular reconstruction via physAimBurnState, 64 screen-space
// samples over one period, nearest-sample snap) instead of inventing a
// second cursor->orbit mapping. Extracted from _trajGizmoNodeState so BOTH
// the gizmo's own node AND an arbitrary (non-gizmo) ring can share it.
function _trajGizmoOrbitNodeAt(o, met) {
  if (!o || o.surface || !PROG_BODIES[o.body]) return null;
  const mu = PROG_BODIES[o.body].mu;
  const rMean = PROG_BODIES[o.body].R + ((o.perigee ?? o.apogee ?? 0) + (o.apogee ?? o.perigee ?? 0)) / 2;
  if (!(rMean > 0)) return null;
  const nMean = Math.sqrt(mu / (rMean * rMean * rMean));
  const theta = (nMean * met) % (2 * Math.PI);
  // §20/C1 seam (2026-07-17, user: gizmo "not on a real orbit... covered up
  // by the Earth"): authored inc/lan are EQUATOR-referenced; physAimBurnState
  // wants world-frame. Routed through the ONE C1 boundary (orbitWorldState,
  // 385) — the single source for the gizmo node, center-knob rail, and hover
  // ball — so after O2/O2b tilted the rendered rings the gizmo can't drift
  // back onto a phantom orbit at a new call site.
  const bs = orbitWorldState(o, theta);
  if (!bs) return null;
  return { body: o.body, mu, r: bs.r, v: bs.v, rHat: bs.rHat, vHat: bs.vHat, hHat: bs.hHat };
}

/** Nearest point (full {x,y,met}) in a screen-space rail — the shared
 *  distance metric behind both the center-knob drag snap and ring hover.
 *  _trajGizmoNearestScreenMet (above) is now a thin wrapper over this so
 *  there is exactly one "nearest sample" implementation. */
function _trajRailNearestPoint(pts, x, y) {
  if (!pts || !pts.length) return null;
  let best = Infinity, bestPt = pts[0];
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - x, dy = pts[i].y - y;
    const d = dx * dx + dy * dy;
    if (d < best) { best = d; bestPt = pts[i]; }
  }
  return bestPt;
}

/** 64-sample screen-space rail for a RING RECORD's own authored orbit
 *  (peri/apo/inc, Ω=ω=0 convention — same simplification the ring's default
 *  geometry and the gizmo's mean-anomaly reconstruction both already use),
 *  independent of any active gizmo. Mirrors _trajGizmoCenterDown's ringPts
 *  precompute 1:1 so hover/click-menu/drag all agree on the same rail. */
function _trajRingHoverRail(missionId, body, periKm, apoKm, incDeg, rect) {
  const cam = (typeof _trajCamByMission !== 'undefined') ? _trajCamByMission[missionId] : null;
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === missionId);
  if (!cam || !m || !rect || !(rect.width > 0)) return null;
  const o = { body, perigee: Math.min(periKm, apoKm), apogee: Math.max(periKm, apoKm), inclination: incDeg || 0, lan: 0 };
  const node0 = _trajGizmoOrbitNodeAt(o, 0);
  if (!node0) return null;
  const period = _trajGizmoOrbitPeriodMet(node0.mu, node0.r, node0.v);
  if (!(period > 0)) return null;
  const vt = _trajViewTime(m);
  const zoom = _trajZoomFromCam(cam);
  _trajProjCtx = { az: cam.az || 0, el: cam.el != null ? cam.el : Math.PI / 2 };
  const camCenterKm = _trajCamCenterKm(cam, vt);
  const N = 64, pts = [];
  for (let k = 0; k < N; k++) {
    const met = (k / N) * period;
    const node = _trajGizmoOrbitNodeAt(o, met);
    if (!node) continue;
    const bodyWorld = progBodyWorldPosCalibrated(node.body, vt, {});
    if (!bodyWorld) continue;
    const w = { x: bodyWorld.x + node.r[0], y: bodyWorld.y + node.r[1], z: (bodyWorld.z || 0) + (node.r[2] || 0) };
    const p = _trajProj3(w.x - camCenterKm.x, w.y - camCenterKm.y, w.z - (camCenterKm.z || 0));
    const s = _trajWorldToScreen(p.x * zoom, p.y * zoom, { cx: 0, cy: 0, w: _TRAJ_VB }, rect);
    pts.push({ x: s.x, y: s.y, met });
  }
  return { pts, period };
}

let _trajRingHover = null;       // { missionId, x, y, met, color } — active ghost ball (canvas-relative px)
let _trajRingHoverLastMs = 0;    // throttle gate

function _trajRingHoverPaint(missionId) {
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${missionId}"]`);
  const overlayEl = va && va.querySelector('svg.traj-overlay');
  if (!overlayEl) return;
  let layer = overlayEl.querySelector('g.traj-ring-hover-layer');
  const h = _trajRingHover;
  if (!h || h.missionId !== missionId) { if (layer) layer.innerHTML = ''; return; }
  const plate = _metFmt(h.met);
  const plateW = plate.length * 5.6 + 12;
  const html = `<circle cx="${h.x.toFixed(1)}" cy="${h.y.toFixed(1)}" r="4" fill="${h.color}" opacity="0.7" pointer-events="none"/>
    <g transform="translate(${(h.x + 8).toFixed(1)},${(h.y - 10).toFixed(1)})" pointer-events="none">
      <rect x="0" y="0" width="${plateW.toFixed(0)}" height="16" rx="3" fill="var(--panel)" stroke="var(--border)" opacity="0.9"/>
      <text x="6" y="12" font-family="var(--mono)" font-size="9.5" fill="var(--text)">${plate}</text>
    </g>`;
  if (!layer) overlayEl.insertAdjacentHTML('beforeend', `<g class="traj-ring-hover-layer">${html}</g>`);
  else layer.innerHTML = html;
}

/** Wired from the ring hit path's onmousemove. Throttled ~30ms; no-op while
 *  a gizmo drag/menu owns the pointer so the two affordances never fight. */
function _trajRingHoverMove(evt, missionId, body, periKm, apoKm, incDeg, color) {
  if (typeof _trajGizmo !== 'undefined' && _trajGizmo && (_trajGizmo.drag || _trajGizmo.centerDrag)) return;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  if (now - _trajRingHoverLastMs < 30) return;
  _trajRingHoverLastMs = now;
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${missionId}"]`);
  const svgEl = va && va.querySelector('svg.traj-svg');
  const rect = svgEl && svgEl.getBoundingClientRect();
  if (!rect || !(rect.width > 0)) return;
  const rail = _trajRingHoverRail(missionId, body, periKm, apoKm, incDeg, rect);
  if (!rail || !rail.pts.length) return;
  const cx = evt.clientX - rect.left, cy = evt.clientY - rect.top;
  const pt = _trajRailNearestPoint(rail.pts, cx, cy);
  if (!pt) return;
  _trajRingHover = { missionId, x: pt.x, y: pt.y, met: pt.met, color: color || 'var(--accent)' };
  _trajRingHoverPaint(missionId);
}

function _trajRingHoverLeave(missionId) {
  if (_trajRingHover && _trajRingHover.missionId === missionId) _trajRingHover = null;
  _trajRingHoverPaint(missionId);
}

let _missionPendingEventMet = {}; // missionId -> MET (s), set by "Use time in Add Event"; read by the
                                   // mnode Add-Event form's metDefault when its own input isn't mounted.

let _trajRingMenu = null; // { missionId, met, x, y, feedback } — canvas-relative placement menu

function _trajRingMenuRender() {
  const rm = _trajRingMenu;
  const va = rm && document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${rm.missionId}"]`);
  const existing = document.querySelector('.traj-ring-menu');
  if (!rm || !va) { if (existing) existing.remove(); return; }
  const fb = rm.feedback ? ` (${_metFmt(rm.met)})` : '';
  // legMode (R6.2.1, resolved R6.2″ round-3 item 5): "+ Maneuver node here"
  // now works on physics legs too — legMode routes the click through
  // _trajGizmoOpenPendingOnLeg (physLegStateAt re-propagation), not through
  // the ring-only _trajGizmoOpenPending path (settled orbitState, wrong
  // mid-transfer). See _trajRingMenuPlaceNode below.
  const html = `
    <button onclick="_trajRingMenuPlaceNode()">+ Maneuver node here</button>
    <button onclick="_trajRingMenuUseAddEvent()">Use time in Add Event${fb}</button>
    <button onclick="_trajRingMenuClose()">✕ close</button>`;
  let menu = existing;
  if (!menu) { menu = document.createElement('div'); menu.className = 'traj-gizmo-menu traj-ring-menu'; va.appendChild(menu); }
  menu.style.left = rm.x + 'px';
  menu.style.top = rm.y + 'px';
  menu.innerHTML = html;
}

function _trajRingMenuAddDismiss() {
  document.addEventListener('click', _trajRingMenuDocClick, true);
  document.addEventListener('keydown', _trajRingMenuKeydown);
}
function _trajRingMenuRemoveDismiss() {
  document.removeEventListener('click', _trajRingMenuDocClick, true);
  document.removeEventListener('keydown', _trajRingMenuKeydown);
}
function _trajRingMenuDocClick(evt) {
  const t = evt.target;
  if (t && t.closest && t.closest('.traj-ring-menu')) return;
  _trajRingMenuClose();
}
function _trajRingMenuKeydown(evt) {
  if (evt.key === 'Escape') _trajRingMenuClose();
}

function _trajRingMenuClose() {
  if (!_trajRingMenu) return;
  _trajRingMenu = null;
  _trajRingMenuRemoveDismiss();
  _trajRingMenuRender();
}

function _trajRingMenuPlaceNode() {
  const rm = _trajRingMenu;
  if (!rm) return;
  const id = rm.missionId, met = rm.met;
  const legMode = rm.legMode, authIdx = rm.authIdx;
  _trajRingMenuClose();
  if (legMode && authIdx != null) _trajGizmoOpenPendingOnLeg(id, authIdx, met);
  else _trajGizmoOpenPending(id, met);
}

// "Use time in Add Event": if the Add Event dock is currently in Vector-Burn
// (mnode) mode its MET <input> is on the page — prefill it directly. If not
// (a different event type is selected, or the dock is closed), that field
// doesn't exist yet, so the snapped MET is stashed in _missionPendingEventMet
// for the mnode form's metDefault to pick up once the user opens it — an
// investigated call: the dock has no generic/type-agnostic time field (only
// mnode authors a raw MET), so a field-prefill can't always apply.
function _trajRingMenuUseAddEvent() {
  const rm = _trajRingMenu;
  if (!rm) return;
  const input = document.getElementById('addev-mnode-met-' + rm.missionId);
  if (input) input.value = Math.round(rm.met);
  _missionPendingEventMet[rm.missionId] = rm.met;
  rm.feedback = true;
  _trajRingMenuRender();
}

/** Wired from the ring hit path's onclick (single click, not drag — reuses
 *  the same _trajJustDragged guard _trajSelectEventFromView uses, captured
 *  BEFORE calling it since that function resets the flag as a side effect).
 *  Preserves the pre-existing select-event behavior, then opens the
 *  placement menu. If a gizmo happens to be open, the document-level
 *  capture-phase _trajGizmoDocClick listener already closed it by the time
 *  this (bubble-phase inline onclick) fires, so the menu opens cleanly. */
function _trajRingClick(id, authIdx, evt, body, periKm, apoKm, incDeg) {
  const dragged = (typeof _trajJustDragged !== 'undefined') ? _trajJustDragged : false;
  _trajJustDragged = false;
  if (dragged) return;
  if (typeof missionSelectEvent === 'function') missionSelectEvent(id, authIdx);
  if (typeof _trajGizmoOnEventSelected === 'function') {
    const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
    _trajGizmoOnEventSelected(id, authIdx, m && m.log && m.log[authIdx]);
  }
  evt.stopPropagation();
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"]`);
  const svgEl = va && va.querySelector('svg.traj-svg');
  const rect = svgEl && svgEl.getBoundingClientRect();
  if (!rect) return;
  let met = null, sx, sy;
  if (_trajRingHover && _trajRingHover.missionId === id) {
    met = _trajRingHover.met; sx = _trajRingHover.x; sy = _trajRingHover.y;
  } else {
    const rail = _trajRingHoverRail(id, body, periKm, apoKm, incDeg, rect);
    if (rail && rail.pts.length) {
      const pt = _trajRailNearestPoint(rail.pts, evt.clientX - rect.left, evt.clientY - rect.top);
      if (pt) { met = pt.met; sx = pt.x; sy = pt.y; }
    }
  }
  if (met == null) return;
  _trajRingMenu = { missionId: id, met, x: sx + 14, y: sy + 14, feedback: false };
  _trajRingMenuAddDismiss();
  _trajRingMenuRender();
}

// ── R6.2.1 (round-3 item 5): hover ball + placement menu on PHYSICS-LEG
// polylines. R6.1.2 shipped the affordance on orbit RINGS only; in a real
// mission most hoverable geometry is committed transfer/MNODE legs, which
// never got it — the user-facing "hover is gone" report. Same ghost/plate/
// menu flow as the ring version, but the rail comes from the leg's OWN
// propagated samples (exact nearest-sample MET, like _trajGizmoNearestSampleMet
// — no arc-fraction interpolation), projected with the SAME patched-conic
// gluing convention _trajPhysLegRender/_trajPolylineSVG use: each sample
// anchors to its frame body's position AT viewTime plus the sample's r.
// (Projection is linear, so proj(bodyWorld(vt)+r−camCenter) ≡ the renderer's
// anchorOf(frame) + proj(r)·zoom — the rail lands exactly on the drawn path.)
function _trajLegHoverRail(missionId, authIdx, rect) {
  const cam = (typeof _trajCamByMission !== 'undefined') ? _trajCamByMission[missionId] : null;
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === missionId);
  const L = (typeof physMissionLeg === 'function') ? physMissionLeg(missionId, authIdx) : null;
  if (!cam || !m || !L || !L.samples || !L.samples.length || !rect || !(rect.width > 0)) return null;
  const vt = _trajViewTime(m);
  const zoom = _trajZoomFromCam(cam);
  _trajProjCtx = { az: cam.az || 0, el: cam.el != null ? cam.el : Math.PI / 2 };
  const camCenterKm = _trajCamCenterKm(cam, vt);
  const anchorCache = {};
  const pts = [];
  for (const s of L.samples) {
    let bw = anchorCache[s.frame];
    if (bw === undefined) bw = anchorCache[s.frame] = (progBodyWorldPosCalibrated(s.frame, vt, {}) || null);
    if (!bw) continue;
    const p = _trajProj3(bw.x + s.r[0] - camCenterKm.x, bw.y + s.r[1] - camCenterKm.y,
      (bw.z || 0) + (s.r[2] || 0) - (camCenterKm.z || 0));
    const sc = _trajWorldToScreen(p.x * zoom, p.y * zoom, { cx: 0, cy: 0, w: _TRAJ_VB }, rect);
    if (isFinite(sc.x) && isFinite(sc.y)) pts.push({ x: sc.x, y: sc.y, met: s.t });
  }
  return pts.length ? { pts } : null;
}

/** Wired from the leg hit path's onmousemove (574 _trajPhysLegRender). Same
 *  ~30ms throttle + gizmo-drag no-op as the ring version; shares
 *  _trajRingHover/_trajRingHoverPaint/_trajRingHoverLeave wholesale. */
function _trajLegHoverMove(evt, missionId, authIdx, color) {
  if (typeof _trajGizmo !== 'undefined' && _trajGizmo && (_trajGizmo.drag || _trajGizmo.centerDrag)) return;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  if (now - _trajRingHoverLastMs < 30) return;
  _trajRingHoverLastMs = now;
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${missionId}"]`);
  const svgEl = va && va.querySelector('svg.traj-svg');
  const rect = svgEl && svgEl.getBoundingClientRect();
  if (!rect || !(rect.width > 0)) return;
  const rail = _trajLegHoverRail(missionId, authIdx, rect);
  if (!rail || !rail.pts.length) return;
  const pt = _trajRailNearestPoint(rail.pts, evt.clientX - rect.left, evt.clientY - rect.top);
  if (!pt) return;
  _trajRingHover = { missionId, x: pt.x, y: pt.y, met: pt.met, color: color || 'var(--accent2)' };
  _trajRingHoverPaint(missionId);
}

/** Wired from the leg hit path's onclick. R6.4d (user): a polyline click is
 *  purely for AUTHORING — it opens the placement menu at the hovered circle's
 *  MET so that MET becomes the base of a NEW event, and it no longer selects
 *  or focuses the leg's existing (older) event at all (that reads as
 *  "clicking the line just re-opens the old node"). `legMode:true` (+ authIdx)
 *  routes "+ Maneuver node here" through _trajGizmoOpenPendingOnLeg
 *  (physLegStateAt re-propagation, 565), spawning the pending node at the
 *  exact mid-leg state. Events remain selectable via the event list / node
 *  map / event-node markers. */
function _trajLegClick(id, authIdx, evt) {
  // Same drag guard the ring/glyph clicks use — a camera rotate ends with a
  // click too; consume the flag and bail (we no longer call
  // _trajSelectEventFromView, which used to reset it as a side effect).
  if (typeof _trajJustDragged !== 'undefined' && _trajJustDragged) { _trajJustDragged = false; return; }
  evt.stopPropagation();
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"]`);
  const svgEl = va && va.querySelector('svg.traj-svg');
  const rect = svgEl && svgEl.getBoundingClientRect();
  if (!rect) return;
  let met = null, sx, sy;
  if (_trajRingHover && _trajRingHover.missionId === id) {
    met = _trajRingHover.met; sx = _trajRingHover.x; sy = _trajRingHover.y;
  } else {
    const rail = _trajLegHoverRail(id, authIdx, rect);
    if (rail && rail.pts.length) {
      const pt = _trajRailNearestPoint(rail.pts, evt.clientX - rect.left, evt.clientY - rect.top);
      if (pt) { met = pt.met; sx = pt.x; sy = pt.y; }
    }
  }
  if (met == null) return;
  _trajRingMenu = { missionId: id, met, x: sx + 14, y: sy + 14, feedback: false, legMode: true, authIdx };
  _trajRingMenuAddDismiss();
  _trajRingMenuRender();
}
