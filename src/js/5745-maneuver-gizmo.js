// ─── R3.3 — KSP-style maneuver gizmo for MNODE authoring (574 overlay + 565/386 physics) ───
// See PHYSICS_PLAN.md COHERENCE SERIES R3.3 and MATH.md §7k.
//
// Two sections: (1) pure DOM-free helpers, pinned by tests/math.test.js; (2)
// interactive plumbing (module-local render state only — NEVER on `m`, NEVER
// in autosave/session — see MATH.md §7k / the mutation-discipline rule).

// ── (1) Pure helpers ────────────────────────────────────────────────────────

/** Local burn-frame axes at a state {r,v} (km, km/s), mirroring the EXACT
 *  (non Gram-Schmidt-orthonormalized) basis physAimBurnState builds — dv
 *  applied via this basis must match what 565's MNODE builder will actually
 *  fly. Returns null on a degenerate state (zero r or v). Pure. */
function _trajGizmoAxes(r, v) {
  if (!r || !v) return null;
  const rMag = physMag(r), vMag = physMag(v);
  if (!(rMag > 0) || !(vMag > 0)) return null;
  const rHat = physScale(r, 1 / rMag);
  const vHat = physScale(v, 1 / vMag);
  const hV = physCross(r, v);
  const hMag = physMag(hV);
  const hHat = hMag > 0 ? physScale(hV, 1 / hMag) : [0, 0, 1];
  return { rHat, vHat, hHat };
}

/** px-drag -> signed m/s. gain = 2 m/s/px normally, 0.2 m/s/px with Shift
 *  held (fine control) — hand-tuned constants, zoom-independent by design
 *  (screen px in, m/s out; see MATH.md §7k). Pure. */
function _trajGizmoPxToDv(pxDelta, shiftHeld) {
  const gain = shiftHeld ? 0.2 : 2;
  return pxDelta * gain;
}

/** Nearest sample (by |t - targetT|) in a physics leg's `samples` array;
 *  returns that sample's MET, or null for an empty array. Used both for
 *  "spawn a node on a physics polyline" (targetT = current view time — a
 *  documented simplification of "nearest to the click point" that avoids an
 *  inverse-projection of the click pixel back into world/sample space; see
 *  PHYSICS_PLAN.md R3.3) and is generically reusable. Pure. */
function _trajGizmoNearestSampleMet(samples, targetT) {
  if (!samples || !samples.length) return null;
  let best = Infinity, bestT = samples[0].t;
  for (let i = 0; i < samples.length; i++) {
    const d = Math.abs(samples[i].t - targetT);
    if (d < best) { best = d; bestT = samples[i].t; }
  }
  return bestT;
}

/** Format the gizmo's live readout plate text. Pure. */
function _trajGizmoFormatReadout(pro, rad, nrm, met) {
  const fmt = v => (v >= 0 ? '+' : '') + Math.round(v || 0);
  const sign = met < 0 ? '-' : '';
  const a = Math.abs(met || 0);
  const mm = Math.floor(a / 60), ss = Math.round(a % 60);
  const metTxt = `${sign}${mm}m${ss < 10 ? '0' : ''}${ss}s`;
  return `pro ${fmt(pro)} · rad ${fmt(rad)} · nrm ${fmt(nrm)} m/s · MET ${metTxt}`;
}

/** Given a projected 2D direction (dv.x, dv.y from _trajProj3) and a
 *  fixed-screen fallback [ux,uy] for the degenerate case (projected length
 *  below `epsilon`), return a unit screen direction + a `degenerate` flag.
 *  Pure — no DOM, no globals besides Math. */
function _trajGizmoScreenDir(dvx, dvy, fallback, epsilon) {
  const eps = epsilon != null ? epsilon : 0.05;
  const len = Math.hypot(dvx, dvy);
  if (len < eps) return { ux: fallback[0], uy: fallback[1], degenerate: true };
  return { ux: dvx / len, uy: dvy / len, degenerate: false };
}

// ── (2) Interactive plumbing (DOM/render-state, not gate-tested) ───────────
// State shape: { missionId, met, authIdx (existing MNODE log index or null =
// pending/uncommitted), dv:{pro,rad,nrm}, node:{body,mu,r,v,rHat,vHat,hHat},
// drag:{axis,x0,y0,dv0,dir} or null, preview:{samples,body} or null }.
let _trajGizmo = null;
const _TRAJ_GIZMO_HANDLE_LEN = 22; // constant RENDER units (km*zoom-baked, ±200 viewBox) -> ~constant screen px at any zoom, per the two-layer rule

/** Reconstruct the node's burn-frame state at `met`, mirroring 565's MNODE
 *  builder (orbitAtBurn -> mean-anomaly circular-ring reconstruction via
 *  physAimBurnState). For an EXISTING MNODE, uses the exact recorded
 *  `orbitAtBurn` (565 writes this on every replay). For a PENDING node (no
 *  log entry yet) this approximates with the vehicle's CURRENT (end-of-replay)
 *  orbitState — an intentional simplification documented in MATH.md §7k;
 *  precise historical reconstruction would require re-replaying the log up
 *  to `met`, which the gizmo does not do. */
function _trajGizmoNodeState(m, met, authIdx) {
  let o = null;
  if (authIdx != null && m.log[authIdx] && m.log[authIdx].orbitAtBurn) o = m.log[authIdx].orbitAtBurn;
  else {
    const fv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
    o = fv && fv.orbitState ? fv.orbitState : null;
  }
  if (!o || o.surface || !PROG_BODIES[o.body]) return null;
  const mu = PROG_BODIES[o.body].mu;
  const rMean = PROG_BODIES[o.body].R + ((o.perigee ?? o.apogee ?? 0) + (o.apogee ?? o.perigee ?? 0)) / 2;
  if (!(rMean > 0)) return null;
  const nMean = Math.sqrt(mu / (rMean * rMean * rMean));
  const theta = (nMean * met) % (2 * Math.PI);
  const incRad = ((o.inclination || 0) * Math.PI) / 180;
  const raan = o.lan != null ? (o.lan * Math.PI) / 180 : 0;
  const bs = physAimBurnState(o.body, rMean, theta, 0, 0, incRad, 0, raan);
  return { body: o.body, mu, r: bs.r, v: bs.v, rHat: bs.rHat, vHat: bs.vHat, hHat: bs.hHat };
}

function _trajGizmoOpenPending(id, met) {
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
  if (!m) return;
  const node = _trajGizmoNodeState(m, met, null);
  if (!node) return;
  _trajGizmo = { missionId: id, met, authIdx: null, dv: { pro: 0, rad: 0, nrm: 0 }, node, drag: null, preview: null };
  document.addEventListener('keydown', _trajGizmoKeydown);
  missionRenderDetail();
}

function _trajGizmoOpenExisting(id, authIdx) {
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
  if (!m || !m.log[authIdx] || m.log[authIdx].type !== 'MNODE') return;
  const e = m.log[authIdx];
  const met = (e.at && e.at.value_s != null) ? e.at.value_s : (e.metStart || 0);
  const node = _trajGizmoNodeState(m, met, authIdx);
  if (!node) return;
  _trajGizmo = { missionId: id, met, authIdx, dv: { pro: e.dvPro_ms || 0, rad: e.dvRad_ms || 0, nrm: e.dvNrm_ms || 0 }, node, drag: null, preview: null };
  document.addEventListener('keydown', _trajGizmoKeydown);
  _trajGizmoRepaintOverlay();
}

function _trajGizmoClose() {
  if (!_trajGizmo) return;
  document.removeEventListener('keydown', _trajGizmoKeydown);
  const id = _trajGizmo.missionId;
  _trajGizmo = null;
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"]`);
  const overlayEl = va && va.querySelector('svg.traj-overlay');
  const layer = overlayEl && overlayEl.querySelector('g.traj-gizmo-layer');
  if (layer) layer.innerHTML = '';
  const sceneEl = va && va.querySelector('svg.traj-svg g.traj-scene');
  const pLayer = sceneEl && sceneEl.querySelector('g.traj-gizmo-preview');
  if (pLayer) pLayer.innerHTML = '';
}

// Dblclick affordances (per PHYSICS_PLAN R3.3 placement rule). Ring click:
// MET = current view time (documented simplification — the theta-inversion
// path is skipped, see the module doc comment). Polyline click: nearest
// sample's MET (primary path).
function _trajGizmoRingDblClick(id, authIdx, evt) {
  if (evt) evt.stopPropagation();
  if (_trajGizmo && _trajGizmo.drag) return; // never spawn a second gizmo mid-drag
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
  if (!m) return;
  _trajGizmoOpenPending(id, _trajViewTime(m));
}

function _trajGizmoLegDblClick(id, authIdx, evt) {
  if (evt) evt.stopPropagation();
  if (_trajGizmo && _trajGizmo.drag) return;
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
  if (!m) return;
  const rec = (typeof _physTrajByMission !== 'undefined') ? _physTrajByMission[id] : null;
  const leg = rec && rec.legs && rec.legs.find(l => l.authIdx === authIdx);
  const vt = _trajViewTime(m);
  const met = (leg && leg.samples && leg.samples.length) ? _trajGizmoNearestSampleMet(leg.samples, vt) : vt;
  _trajGizmoOpenPending(id, met != null ? met : vt);
}

// Hooked from _trajSelectEventFromView: selecting an MNODE event opens/
// re-attaches the gizmo at its recorded state; selecting anything else
// closes an attached (committed) gizmo (a pending one is left alone so a
// stray click elsewhere doesn't discard in-progress authoring).
function _trajGizmoOnEventSelected(id, authIdx, e) {
  if (e && e.type === 'MNODE') { _trajGizmoOpenExisting(id, authIdx); return; }
  if (_trajGizmo && _trajGizmo.missionId === id && _trajGizmo.authIdx != null) _trajGizmoClose();
}

// Screen-space geometry for the active gizmo: node anchor + per-axis unit
// screen directions, shared by the overlay renderer AND the handle-down
// picker (drag direction is captured once, at mousedown, from this same calc).
function _trajGizmoScreenGeo(id, rect) {
  const g = _trajGizmo;
  if (!g || g.missionId !== id || !rect || !(rect.width > 0)) return null;
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
  const cam = (typeof _trajCamByMission !== 'undefined') ? _trajCamByMission[id] : null;
  if (!m || !cam) return null;
  const vt = _trajViewTime(m);
  const zoom = _trajZoomFromCam(cam);
  _trajProjCtx = { az: cam.az || 0, el: cam.el != null ? cam.el : Math.PI / 2 };
  const camCenterKm = _trajCamCenterKm(cam, vt);
  const bodyWorld = progBodyWorldPosCalibrated(g.node.body, vt, {});
  if (!bodyWorld) return null;
  const nodeWorld = { x: bodyWorld.x + g.node.r[0], y: bodyWorld.y + g.node.r[1], z: (bodyWorld.z || 0) + (g.node.r[2] || 0) };
  const dP = _trajProj3(nodeWorld.x - camCenterKm.x, nodeWorld.y - camCenterKm.y, nodeWorld.z - (camCenterKm.z || 0));
  const nodeRender = { x: dP.x * zoom, y: dP.y * zoom };
  const nodeScreen = _trajWorldToScreen(nodeRender.x, nodeRender.y, { cx: 0, cy: 0, w: _TRAJ_VB }, rect);
  const axes = [
    { key: 'pro', hat: g.node.vHat, color: 'var(--accent)', fallback: [1, 0] },
    { key: 'rad', hat: g.node.rHat, color: 'var(--accent2)', fallback: [0, 1] },
    { key: 'nrm', hat: g.node.hHat, color: 'var(--accent3)', fallback: [0, -1] },
  ];
  const dirs = {};
  axes.forEach(ax => {
    const dv = _trajProj3(ax.hat[0], ax.hat[1], ax.hat[2]);
    dirs[ax.key] = Object.assign({ color: ax.color }, _trajGizmoScreenDir(dv.x, dv.y, ax.fallback));
  });
  return { nodeRender, nodeScreen, dirs, zoom, rect };
}

function _trajGizmoOverlaySVG(id, rect) {
  const geo = _trajGizmoScreenGeo(id, rect);
  const g = _trajGizmo;
  if (!geo || !g) return '';
  let svg = '';
  ['pro', 'rad', 'nrm'].forEach(key => {
    const d = geo.dirs[key];
    const tipRender = { x: geo.nodeRender.x + d.ux * _TRAJ_GIZMO_HANDLE_LEN, y: geo.nodeRender.y + d.uy * _TRAJ_GIZMO_HANDLE_LEN };
    const tipScreen = _trajWorldToScreen(tipRender.x, tipRender.y, { cx: 0, cy: 0, w: _TRAJ_VB }, rect);
    const dragging = g.drag && g.drag.axis === key;
    const knobR = dragging ? 8 : 6.5;
    const label = key === 'pro' ? 'Prograde' : key === 'rad' ? 'Radial' : 'Normal';
    svg += `<line x1="${geo.nodeScreen.x.toFixed(1)}" y1="${geo.nodeScreen.y.toFixed(1)}" x2="${tipScreen.x.toFixed(1)}" y2="${tipScreen.y.toFixed(1)}" stroke="${d.color}" stroke-width="2"/>`;
    if (d.degenerate) {
      svg += `<rect x="${(tipScreen.x - 5).toFixed(1)}" y="${(tipScreen.y - 5).toFixed(1)}" width="10" height="10" transform="rotate(45 ${tipScreen.x.toFixed(1)} ${tipScreen.y.toFixed(1)})" fill="${d.color}" opacity="0.85" style="pointer-events:auto;cursor:grab" onmousedown="event.stopPropagation();_trajGizmoHandleDown(event,'${key}')"><title>${label} (near edge-on at this view angle) — drag anyway</title></rect>`;
    } else {
      svg += `<circle cx="${tipScreen.x.toFixed(1)}" cy="${tipScreen.y.toFixed(1)}" r="${knobR}" fill="${d.color}" opacity="0.9" style="pointer-events:auto;cursor:grab" onmousedown="event.stopPropagation();_trajGizmoHandleDown(event,'${key}')"><title>${label} handle — drag to set Δv (shift = fine)</title></circle>`;
    }
  });
  const readout = _trajGizmoFormatReadout(g.dv.pro, g.dv.rad, g.dv.nrm, g.met);
  const plateW = readout.length * 5.6 + 16;
  svg += `<g transform="translate(${(geo.nodeScreen.x + 12).toFixed(1)},${(geo.nodeScreen.y - 24).toFixed(1)})" style="pointer-events:none">
    <rect x="0" y="0" width="${plateW.toFixed(0)}" height="18" rx="4" fill="var(--panel)" stroke="var(--border)" opacity="0.94"/>
    <text x="7" y="13" font-family="var(--mono)" font-size="10" fill="var(--text)">${readout}</text>
  </g>
  <g transform="translate(${(geo.nodeScreen.x + 12).toFixed(1)},${(geo.nodeScreen.y - 24).toFixed(1)})" style="pointer-events:auto;cursor:pointer" onclick="_trajGizmoClose()">
    <text x="${(plateW - 12).toFixed(0)}" y="13" font-family="var(--mono)" font-size="10" fill="var(--text-dim)">✕</text>
  </g>`;
  svg += `<circle cx="${geo.nodeScreen.x.toFixed(1)}" cy="${geo.nodeScreen.y.toFixed(1)}" r="3.5" fill="var(--text-bright)" stroke="var(--nm-bg)" stroke-width="1"/>`;
  return svg;
}

/** Cheap repaint of just the gizmo overlay layer — called after every full
 *  overlay resolve (_trajApplyCam, _missionTrajAfterRender's sync) AND after
 *  every drag tick, so it never has to fight the label registry. */
function _trajGizmoRepaintOverlay() {
  const g = _trajGizmo;
  if (!g) return;
  // A committed gizmo re-derives its node state from the (possibly just
  // recomputed) log entry every repaint — item 5's "preserve an active
  // gizmo attached to a committed MNODE" rule.
  if (g.authIdx != null && !g.drag) {
    const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
    if (m && m.log[g.authIdx] && m.log[g.authIdx].type === 'MNODE') {
      const node = _trajGizmoNodeState(m, g.met, g.authIdx);
      if (node) g.node = node;
    } else {
      _trajGizmo = null; // the event was deleted/undone out from under us
      return;
    }
  }
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
  if (!va) return;
  const overlayEl = va.querySelector('svg.traj-overlay');
  const svgEl = va.querySelector('svg.traj-svg');
  if (!overlayEl || !svgEl) return;
  const rect = svgEl.getBoundingClientRect();
  const html = _trajGizmoOverlaySVG(g.missionId, rect);
  let layer = overlayEl.querySelector('g.traj-gizmo-layer');
  if (!layer) overlayEl.insertAdjacentHTML('beforeend', `<g class="traj-gizmo-layer">${html}</g>`);
  else layer.innerHTML = html;
}

// ── Drag mechanics ──────────────────────────────────────────────────────────
function _trajGizmoHandleDown(evt, axis) {
  const g = _trajGizmo;
  if (!g) return;
  evt.preventDefault();
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
  const svgEl = va && va.querySelector('svg.traj-svg');
  const rect = svgEl && svgEl.getBoundingClientRect();
  const geo = rect && _trajGizmoScreenGeo(g.missionId, rect);
  if (!geo) return;
  g.drag = { axis, x0: evt.clientX, y0: evt.clientY, dv0: g.dv[axis], dir: geo.dirs[axis] };
  document.addEventListener('mousemove', _trajGizmoHandleMove);
  document.addEventListener('mouseup', _trajGizmoHandleUp);
  document.addEventListener('contextmenu', _trajGizmoDragCtxMenu);
}

function _trajGizmoDragCtxMenu(evt) {
  evt.preventDefault();
  _trajGizmoCancelDrag();
}

function _trajGizmoKeydown(evt) {
  if (evt.key !== 'Escape') return;
  evt.preventDefault();
  const g = _trajGizmo;
  if (!g) return;
  if (g.drag) _trajGizmoCancelDrag();
  else _trajGizmoClose();
}

function _trajGizmoHandleMove(evt) {
  const g = _trajGizmo;
  if (!g || !g.drag) return;
  const dx = evt.clientX - g.drag.x0, dy = evt.clientY - g.drag.y0;
  const along = dx * g.drag.dir.ux + dy * g.drag.dir.uy; // signed px along the handle's screen direction (sign flip past zero = retro/anti-radial/anti-normal)
  g.dv[g.drag.axis] = g.drag.dv0 + _trajGizmoPxToDv(along, evt.shiftKey);
  _trajGizmoRepaintOverlay();
  _trajGizmoScheduleScratch();
}

function _trajGizmoEndDragListeners() {
  document.removeEventListener('mousemove', _trajGizmoHandleMove);
  document.removeEventListener('mouseup', _trajGizmoHandleUp);
  document.removeEventListener('contextmenu', _trajGizmoDragCtxMenu);
}

function _trajGizmoHandleUp() {
  const g = _trajGizmo;
  if (!g || !g.drag) return;
  _trajGizmoEndDragListeners();
  g.drag = null;
  _trajGizmoCommit();
}

function _trajGizmoCancelDrag() {
  const g = _trajGizmo;
  if (!g || !g.drag) return;
  _trajGizmoEndDragListeners();
  g.dv[g.drag.axis] = g.drag.dv0; // revert this drag's delta — zero log mutation
  g.drag = null;
  g.preview = null;
  _trajGizmoRepaintOverlay();
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
  const sceneEl = va && va.querySelector('svg.traj-svg g.traj-scene');
  const layer = sceneEl && sceneEl.querySelector('g.traj-gizmo-preview');
  if (layer) layer.innerHTML = '';
}

// Commit: push (new node) or edit (existing MNODE) the log entry, ONE
// missionRecompute -> ONE undo step (missionUndoCapture is hooked at the
// tail of missionRecompute — see 575/570). Never mutates the log per drag
// tick, only on release.
function _trajGizmoCommit() {
  const g = _trajGizmo;
  if (!g) return;
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
  if (!m) return;
  g.preview = null;
  if (g.authIdx != null && m.log[g.authIdx] && m.log[g.authIdx].type === 'MNODE') {
    const e = m.log[g.authIdx];
    e.dvPro_ms = g.dv.pro; e.dvRad_ms = g.dv.rad; e.dvNrm_ms = g.dv.nrm;
    missionRecompute(m);
    missionRenderDetail();
  } else {
    missionExecManeuverNode(g.missionId, { value_s: g.met, dvPro_ms: g.dv.pro, dvRad_ms: g.dv.rad, dvNrm_ms: g.dv.nrm });
    const idx = m.log.length - 1;
    if (m.log[idx] && m.log[idx].type === 'MNODE') g.authIdx = idx;
  }
}

// ── Scratch live-preview propagation (SCRATCH ONLY — module-local var, never
// the side-table, never the log; throttled ~100ms per drag tick) ──────────
let _trajGizmoScratchTimer = null;
function _trajGizmoScheduleScratch() {
  if (_trajGizmoScratchTimer) return;
  _trajGizmoScratchTimer = setTimeout(() => { _trajGizmoScratchTimer = null; _trajGizmoRunScratch(); }, 100);
}

function _trajGizmoRunScratch() {
  const g = _trajGizmo;
  if (!g || !g.drag) return; // drag may have ended before the throttle fired
  const node = g.node;
  const dvVec = physAdd(physAdd(
    physScale(node.vHat, (g.dv.pro || 0) / 1000),
    physScale(node.rHat, (g.dv.rad || 0) / 1000)),
    physScale(node.hHat, (g.dv.nrm || 0) / 1000));
  const state = { r: node.r, v: physAdd(node.v, dvVec) };
  const parent = typeof physParentOf === 'function' ? physParentOf(node.body) : null;
  const bodies = [...new Set([node.body, parent || 'Sun', 'Sun', node.body === 'Earth' ? 'Moon' : null].filter(Boolean))];
  let horizon = 30 * 86400;
  const el = (typeof physStateToElements === 'function') ? physStateToElements(state.r, state.v, node.mu) : null;
  if (el && el.a > 0 && isFinite(el.period)) horizon = Math.min(horizon, Math.max(3 * el.period, 3600));
  const res = physPropagateSegment(state, g.met, g.met + horizon, { center: node.body, bodies, overrides: {} }, { maxSamples: 128 });
  g.preview = { samples: res.samples, body: node.body };
  _trajGizmoRepaintScenePreview();
}

function _trajGizmoRepaintScenePreview() {
  const g = _trajGizmo;
  if (!g) return;
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
  const svgEl = va && va.querySelector('svg.traj-svg');
  const sceneEl = svgEl && svgEl.querySelector('g.traj-scene');
  if (!sceneEl) return;
  const cam = (typeof _trajCamByMission !== 'undefined') ? _trajCamByMission[g.missionId] : null;
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
  if (!cam || !m) return;
  const vt = _trajViewTime(m);
  const zoom = _trajZoomFromCam(cam);
  _trajProjCtx = { az: cam.az || 0, el: cam.el != null ? cam.el : Math.PI / 2 };
  const camCenterKm = _trajCamCenterKm(cam, vt);
  const bodyWorld = progBodyWorldPosCalibrated(g.node.body, vt, {});
  let d = '';
  (g.preview && g.preview.samples || []).forEach((s, i) => {
    if (s.frame !== g.node.body || !bodyWorld) return; // scratch preview only draws same-body samples (documented scope; see MATH.md §7k)
    const w = { x: bodyWorld.x + s.r[0], y: bodyWorld.y + s.r[1], z: (bodyWorld.z || 0) + (s.r[2] || 0) };
    const p = _trajProj3(w.x - camCenterKm.x, w.y - camCenterKm.y, w.z - (camCenterKm.z || 0));
    d += (d ? ' L' : 'M') + (p.x * zoom).toFixed(3) + ',' + (p.y * zoom).toFixed(3);
  });
  const html = d ? `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1" stroke-dasharray="2.5,2" vector-effect="non-scaling-stroke" opacity="0.85"/>` : '';
  let layer = sceneEl.querySelector('g.traj-gizmo-preview');
  if (!layer) sceneEl.insertAdjacentHTML('beforeend', `<g class="traj-gizmo-preview">${html}</g>`);
  else layer.innerHTML = html;
}
