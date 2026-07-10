// ─── R3.3/R3.4 — KSP-style maneuver gizmo for MNODE authoring (574 overlay + 565/386 physics) ───
// See PHYSICS_PLAN.md COHERENCE SERIES R3.3 + R3.4 and MATH.md §7k.
//
// Two sections: (1) pure DOM-free helpers, pinned by tests/math.test.js; (2)
// interactive plumbing (module-local render state only — NEVER on `m`, NEVER
// in autosave/session — see MATH.md §7k / the mutation-discipline rule).
//
// R3.4 KSP-parity rework: (a) six pull-out handles (pro/retro, radial
// out/in, normal/anti — each ADDS only in its own direction, no sign-flip-
// through-zero); (b) center-knob drag slides the node in TIME along its
// orbit + a small flyout menu (+1/-1 orbit, delete, close); (c) a
// closest-approach pair vs. the mission's next destination body (or the
// Moon for Earth-centric nodes), rendered on the preview + as a plate
// readout. The camera-drag rework that makes handles reliably grabbable
// lives in 574 (trajPanStart/Move, trajWheelZoom).

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

/** R3.4 six-handle component mapping: a handle only ADDS in its own signed
 *  direction. `dv0` is the handle's OWN side magnitude at drag-start (i.e.
 *  max(component,0) for a "+" handle, max(-component,0) for a "-" handle) —
 *  never the raw signed component, so re-grabbing a handle after the
 *  opposite handle drove the value negative starts this handle's pull from
 *  zero, not from the negative value. Result is clamped >= 0 (never crosses
 *  zero into the opposite handle's territory — that's its job). Pure. */
function _trajGizmoHandleSideMag(dv0, alongPx, shiftHeld) {
  return Math.max(0, (dv0 || 0) + _trajGizmoPxToDv(alongPx, shiftHeld));
}

/** R3.4 node-time control: screen px dragged along the node's own prograde
 *  screen direction -> a MET delta (s). K = km-per-screen-px (at the
 *  camera's current width) / |v| (km/s) — so a fixed px gesture always
 *  slides the node the same FRACTION of one "second's worth of screen
 *  motion" at the node's own orbital speed, independent of zoom (dragging
 *  while zoomed out covers more km/px, so the same px delta covers more
 *  MET — matches how far the node visibly appears to move). Returns 0 for a
 *  non-positive vMagKms (degenerate/parked state — no time axis to drag
 *  along). Pure. */
function _trajGizmoCenterDragDMet(pxAlong, kmPerPx, vMagKms) {
  if (!(vMagKms > 0)) return 0;
  return (pxAlong || 0) * (kmPerPx || 0) / vMagKms;
}

/** Orbital period (s) via vis-viva semi-major axis from a state {mu,r,v}.
 *  Returns null for a non-elliptical (parabolic/hyperbolic, or degenerate)
 *  state — "+1/-1 orbit" has no period to step by in that case. Pure. */
function _trajGizmoOrbitPeriodMet(mu, r, v) {
  if (!(mu > 0) || !r || !v) return null;
  const rMag = physMag(r), vMag = physMag(v);
  if (!(rMag > 0)) return null;
  const invA = 2 / rMag - (vMag * vMag) / mu;
  if (!(invA > 0)) return null; // parabolic/hyperbolic
  const a = 1 / invA;
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
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

/** R3.4 closest-approach pair: scan a physics leg/preview `samples` array
 *  ([{t, r:[3] (position relative to `frame`'s center, km), frame}, ...])
 *  against `targetBody`'s REAL position (via `railFn`, default
 *  physBodyStateAt) at each sample's t, and return the minimum-distance
 *  sample: {dKm, t, craftR, frame}. Frame-aware: if a sample's frame IS the
 *  target body, its `r` is already target-relative (distance = |r|,
 *  encounter case); otherwise the target's position is resolved into the
 *  SAME frame as the sample (target helio - frame-body helio) before
 *  differencing, so this is exact across an SOI-patched propagation. Returns
 *  null for an empty/missing samples array, no targetBody, or no railFn
 *  available. Pure (railFn is injected, no ambient physBodyStateAt call
 *  unless the caller lets the default resolve at call time). */
function _trajGizmoClosestApproach(samples, targetBody, railFn) {
  if (!samples || !samples.length || !targetBody) return null;
  const rails = railFn || (typeof physBodyStateAt === 'function' ? physBodyStateAt : null);
  if (!rails) return null;
  let best = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s || !s.r) continue;
    let dKm;
    if (s.frame === targetBody) {
      dKm = physMag(s.r);
    } else {
      const tgt = rails(targetBody, s.t, {});
      const frameState = s.frame === 'Sun' ? { r: [0, 0, 0] } : rails(s.frame, s.t, {});
      if (!tgt || !frameState) continue;
      const targetRel = physSub(tgt.r, frameState.r);
      dKm = physMag(physSub(s.r, targetRel));
    }
    if (best == null || dKm < best.dKm) best = { dKm, t: s.t, craftR: s.r, frame: s.frame };
  }
  return best;
}

/** First sample (in array order) whose frame already equals `targetBody` —
 *  the SOI-entry point of an encounter, or null if the target's SOI is
 *  never entered over the sampled span. Pure. */
function _trajGizmoSoiEntryT(samples, targetBody) {
  if (!samples || !samples.length || !targetBody) return null;
  for (let i = 0; i < samples.length; i++) if (samples[i] && samples[i].frame === targetBody) return samples[i].t;
  return null;
}

/** R3.4 fidelity-ladder decision, pure: 'cheap' while the pointer is still
 *  actively moving (< debounceMs since the last move), 'full' once the node
 *  has been left alone for >= debounceMs (default 2000 — a hand-tuned
 *  constant, see MATH.md §7k). Any new movement should re-call this with a
 *  fresh `lastMoveMs` (i.e. resets the ladder back to 'cheap'), which the
 *  caller does by re-stamping lastMoveMs on every move tick — this function
 *  itself is stateless/pure, just the (lastMoveMs, nowMs) -> mode mapping. */
function _trajGizmoPreviewFidelity(lastMoveMs, nowMs, debounceMs) {
  const dt = (nowMs || 0) - (lastMoveMs || 0);
  return dt >= (debounceMs != null ? debounceMs : 2000) ? 'full' : 'cheap';
}

// ── (2) Interactive plumbing (DOM/render-state, not gate-tested) ───────────
// State shape: { missionId, met, authIdx (existing MNODE log index or null =
// pending/uncommitted), dv:{pro,rad,nrm}, node:{body,mu,r,v,rHat,vHat,hHat},
// drag:{axis,x0,y0,dv0,dir,sign,component} or null, centerDrag:{...} or null,
// menuOpen:bool, preview:{samples,body} or null, ca:{...}|null }.
let _trajGizmo = null;
const _TRAJ_GIZMO_HANDLE_LEN = 22; // constant RENDER units (km*zoom-baked, ±200 viewBox) -> ~constant screen px at any zoom, per the two-layer rule
const _TRAJ_GIZMO_CENTER_HIT_R = 12; // px, per R3.4 item 2/3 (>= 12px hit circles)

// Six handles, KSP layout. `sign` selects which side of the axis this handle
// owns (a "+"handle only ever holds a component >= 0; its opposite owns the
// negative side — see _trajGizmoHandleSideMag).
const _TRAJ_GIZMO_HANDLES = [
  { key: 'pro',     axis: 'vHat', sign: 1,  component: 'pro', color: 'var(--accent)',  label: 'Prograde' },
  { key: 'retro',   axis: 'vHat', sign: -1, component: 'pro', color: 'var(--accent)',  label: 'Retrograde' },
  { key: 'radOut',  axis: 'rHat', sign: 1,  component: 'rad', color: 'var(--accent2)', label: 'Radial out' },
  { key: 'radIn',   axis: 'rHat', sign: -1, component: 'rad', color: 'var(--accent2)', label: 'Radial in' },
  { key: 'nrm',     axis: 'hHat', sign: 1,  component: 'nrm', color: 'var(--accent3)', label: 'Normal' },
  { key: 'antinrm', axis: 'hHat', sign: -1, component: 'nrm', color: 'var(--accent3)', label: 'Anti-normal' },
];

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

/** R3.4 target selection for the closest-approach pair: scan the mission log
 *  for the next MANEUVER after `met` whose destination node names a body
 *  different from the node's own body; else fall back to the Moon for
 *  Earth-centric nodes (a sensible default per PHYSICS_PLAN R3.4 item 4);
 *  else null (no CA pair shown). */
function _trajGizmoPickTarget(m, node, met) {
  if (!m || !node) return null;
  if (typeof _missionNmNodeById === 'function') {
    for (const e of m.log || []) {
      if (e.type !== 'MANEUVER' || !e.toNode) continue;
      if ((e.metStart != null ? e.metStart : 0) < met) continue; // only look forward from the node
      const n = _missionNmNodeById(e.toNode);
      if (n && n.body && n.body !== node.body) return n.body;
    }
  }
  if (node.body === 'Earth' && PROG_BODIES.Moon) return 'Moon';
  return null;
}

function _trajGizmoOpenPending(id, met) {
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
  if (!m) return;
  const node = _trajGizmoNodeState(m, met, null);
  if (!node) return;
  _trajGizmo = { missionId: id, met, authIdx: null, dv: { pro: 0, rad: 0, nrm: 0 }, node, drag: null, centerDrag: null, menuOpen: false, preview: null, ca: null };
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
  _trajGizmo = { missionId: id, met, authIdx, dv: { pro: e.dvPro_ms || 0, rad: e.dvRad_ms || 0, nrm: e.dvNrm_ms || 0 }, node, drag: null, centerDrag: null, menuOpen: false, preview: null, ca: null };
  document.addEventListener('keydown', _trajGizmoKeydown);
  _trajGizmoRepaintOverlay();
}

function _trajGizmoClose() {
  if (!_trajGizmo) return;
  if (_trajGizmoFullTimer) { clearTimeout(_trajGizmoFullTimer); _trajGizmoFullTimer = null; }
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
  const menuEl = va && va.querySelector('.traj-gizmo-menu');
  if (menuEl) menuEl.remove();
}

// Dblclick affordances (per PHYSICS_PLAN R3.3 placement rule). Ring click:
// MET = current view time (documented simplification — the theta-inversion
// path is skipped, see the module doc comment). Polyline click: nearest
// sample's MET (primary path).
function _trajGizmoRingDblClick(id, authIdx, evt) {
  if (evt) evt.stopPropagation();
  if (_trajGizmo && (_trajGizmo.drag || _trajGizmo.centerDrag)) return; // never spawn a second gizmo mid-drag
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
  if (!m) return;
  _trajGizmoOpenPending(id, _trajViewTime(m));
}

function _trajGizmoLegDblClick(id, authIdx, evt) {
  if (evt) evt.stopPropagation();
  if (_trajGizmo && (_trajGizmo.drag || _trajGizmo.centerDrag)) return;
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

// Screen-space geometry for the active gizmo: node anchor + per-HANDLE unit
// screen directions (6, one per _TRAJ_GIZMO_HANDLES entry), shared by the
// overlay renderer AND the handle-down picker (drag direction is captured
// once, at mousedown, from this same calc).
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
  // Base projected direction per AXIS (3, not 6) — each handle re-uses its
  // axis's base dir, negated for sign:-1 handles.
  const axisFallback = { vHat: [1, 0], rHat: [0, 1], hHat: [0, -1] };
  const axisBase = {};
  ['vHat', 'rHat', 'hHat'].forEach(axisKey => {
    const hat = g.node[axisKey];
    const dv = _trajProj3(hat[0], hat[1], hat[2]);
    axisBase[axisKey] = _trajGizmoScreenDir(dv.x, dv.y, axisFallback[axisKey]);
  });
  const dirs = {};
  _TRAJ_GIZMO_HANDLES.forEach(h => {
    const base = axisBase[h.axis];
    dirs[h.key] = { ux: base.ux * h.sign, uy: base.uy * h.sign, degenerate: base.degenerate, color: h.color };
  });
  return { nodeRender, nodeScreen, dirs, zoom, rect, cam, vt };
}

/** Current side-magnitude of a handle (>=0), from the gizmo's signed dv
 *  components — see _trajGizmoHandleSideMag doc. */
function _trajGizmoHandleValue(g, h) {
  const comp = g.dv[h.component] || 0;
  return h.sign > 0 ? Math.max(0, comp) : Math.max(0, -comp);
}

function _trajGizmoOverlaySVG(id, rect) {
  const geo = _trajGizmoScreenGeo(id, rect);
  const g = _trajGizmo;
  if (!geo || !g) return '';
  let svg = '';
  _TRAJ_GIZMO_HANDLES.forEach(h => {
    const d = geo.dirs[h.key];
    const tipRender = { x: geo.nodeRender.x + d.ux * _TRAJ_GIZMO_HANDLE_LEN, y: geo.nodeRender.y + d.uy * _TRAJ_GIZMO_HANDLE_LEN };
    const tipScreen = _trajWorldToScreen(tipRender.x, tipRender.y, { cx: 0, cy: 0, w: _TRAJ_VB }, rect);
    const dragging = g.drag && g.drag.key === h.key;
    const knobR = dragging ? 9 : 7; // >= 12px HIT radius enforced via a larger invisible hit circle below
    const negSide = h.sign < 0; // negative-side handle: distinguish by OUTLINE (dashed ring), not a new color
    const kid = `tgh-${h.key}`;
    svg += `<line x1="${geo.nodeScreen.x.toFixed(1)}" y1="${geo.nodeScreen.y.toFixed(1)}" x2="${tipScreen.x.toFixed(1)}" y2="${tipScreen.y.toFixed(1)}" stroke="${d.color}" stroke-width="2"${negSide ? ' stroke-dasharray="3,2.5"' : ''} opacity="${negSide ? 0.7 : 1}"/>`;
    if (d.degenerate) {
      svg += `<rect id="${kid}" x="${(tipScreen.x - 5).toFixed(1)}" y="${(tipScreen.y - 5).toFixed(1)}" width="10" height="10" transform="rotate(45 ${tipScreen.x.toFixed(1)} ${tipScreen.y.toFixed(1)})" fill="${d.color}" opacity="${negSide ? 0.55 : 0.85}" style="pointer-events:auto;cursor:grab" onmousedown="event.stopPropagation();_trajGizmoHandleDown(event,'${h.key}')" onmouseenter="_trajGizmoHoverKnob(this,true)" onmouseleave="_trajGizmoHoverKnob(this,false)"><title>${h.label} (near edge-on at this view angle) — drag anyway</title></rect>`;
    } else {
      // Visible knob: solid fill for a "+" handle, dashed hollow ring for the
      // paired "-" handle — outline-only distinction, per R3.4 item 2 (no
      // second color). A larger transparent hit circle underneath satisfies
      // the >= 12px hit-radius requirement without inflating the visible glyph.
      svg += `<circle cx="${tipScreen.x.toFixed(1)}" cy="${tipScreen.y.toFixed(1)}" r="12" fill="transparent" style="pointer-events:auto;cursor:grab" onmousedown="event.stopPropagation();_trajGizmoHandleDown(event,'${h.key}')" onmouseenter="_trajGizmoHoverKnob(this,true)" onmouseleave="_trajGizmoHoverKnob(this,false)"><title>${h.label} handle — drag away from the node to increase (shift = fine)</title></circle>`;
      if (negSide) {
        svg += `<circle id="${kid}" cx="${tipScreen.x.toFixed(1)}" cy="${tipScreen.y.toFixed(1)}" r="${knobR}" fill="none" stroke="${d.color}" stroke-width="2" stroke-dasharray="2.5,2" opacity="0.85" pointer-events="none"/>`;
      } else {
        svg += `<circle id="${kid}" cx="${tipScreen.x.toFixed(1)}" cy="${tipScreen.y.toFixed(1)}" r="${knobR}" fill="${d.color}" opacity="0.9" pointer-events="none"/>`;
      }
    }
  });
  const readout = _trajGizmoFormatReadout(g.dv.pro, g.dv.rad, g.dv.nrm, g.met);
  const caTxt = _trajGizmoCaPlateText(g);
  const plateLines = caTxt ? [readout, caTxt] : [readout];
  const plateW = Math.max(...plateLines.map(l => l.length)) * 5.6 + 16;
  const plateH = 18 * plateLines.length;
  svg += `<g transform="translate(${(geo.nodeScreen.x + 12).toFixed(1)},${(geo.nodeScreen.y - 12 - plateH).toFixed(1)})" style="pointer-events:none">
    <rect x="0" y="0" width="${plateW.toFixed(0)}" height="${plateH}" rx="4" fill="var(--panel)" stroke="var(--border)" opacity="0.94"/>
    ${plateLines.map((l, i) => `<text x="7" y="${13 + i * 18}" font-family="var(--mono)" font-size="10" fill="${i === 1 && g.ca && g.ca.encounter ? 'var(--accent)' : 'var(--text)'}">${l}</text>`).join('')}
  </g>
  <g transform="translate(${(geo.nodeScreen.x + 12).toFixed(1)},${(geo.nodeScreen.y - 12 - plateH).toFixed(1)})" style="pointer-events:auto;cursor:pointer" onclick="_trajGizmoClose()">
    <text x="${(plateW - 12).toFixed(0)}" y="13" font-family="var(--mono)" font-size="10" fill="var(--text-dim)">✕</text>
  </g>`;
  // Center knob: >=12px hit circle (mousedown drives node-TIME drag/click-menu
  // via _trajGizmoCenterDown), small visible dot on top.
  svg += `<circle cx="${geo.nodeScreen.x.toFixed(1)}" cy="${geo.nodeScreen.y.toFixed(1)}" r="${_TRAJ_GIZMO_CENTER_HIT_R}" fill="transparent" style="pointer-events:auto;cursor:${g.centerDrag ? 'grabbing' : 'grab'}" onmousedown="event.stopPropagation();_trajGizmoCenterDown(event)"><title>Drag to slide along the orbit (time) · click for orbit +1/-1, delete</title></circle>`;
  svg += `<circle cx="${geo.nodeScreen.x.toFixed(1)}" cy="${geo.nodeScreen.y.toFixed(1)}" r="3.5" fill="var(--text-bright)" stroke="var(--nm-bg)" stroke-width="1" pointer-events="none"/>`;
  // R3.4 closest-approach pair markers, drawn in overlay space alongside the handles.
  svg += _trajGizmoCaMarkersSVG(g, geo);
  return svg;
}

/** Overlay-space CA marker: a small × on the preview path at the CA/encounter
 *  sample (craft-at-CA), rendered via the same projection as the scene
 *  preview path (_trajGizmoRepaintScenePreview draws the dashed path; this
 *  draws the marker in the OVERLAY svg so it can carry a screen-px glyph +
 *  the ghost marker uses the existing _trajGhostMarker label-registry path,
 *  which only resolves during the WORLD-layer render pass — so the ghost
 *  itself is emitted from _trajGizmoRunScratch via a scratch label push;
 *  here we only draw the craft-side × (pure overlay geometry, no registry). */
function _trajGizmoCaMarkersSVG(g, geo) {
  if (!g.ca || !g.ca.craftR) return '';
  const bodyWorld = progBodyWorldPosCalibrated(g.ca.frame, geo.vt, {});
  if (!bodyWorld) return '';
  const w = { x: bodyWorld.x + g.ca.craftR[0], y: bodyWorld.y + g.ca.craftR[1], z: (bodyWorld.z || 0) + (g.ca.craftR[2] || 0) };
  const cam = geo.cam;
  const camCenterKm = _trajCamCenterKm(cam, geo.vt);
  const p = _trajProj3(w.x - camCenterKm.x, w.y - camCenterKm.y, w.z - (camCenterKm.z || 0));
  const render = { x: p.x * geo.zoom, y: p.y * geo.zoom };
  const s = _trajWorldToScreen(render.x, render.y, { cx: 0, cy: 0, w: _TRAJ_VB }, geo.rect);
  const color = g.ca.encounter ? 'var(--accent)' : 'var(--text-dim)';
  return `<g pointer-events="none" stroke="${color}" stroke-width="1.5">
    <line x1="${(s.x - 4).toFixed(1)}" y1="${(s.y - 4).toFixed(1)}" x2="${(s.x + 4).toFixed(1)}" y2="${(s.y + 4).toFixed(1)}"/>
    <line x1="${(s.x - 4).toFixed(1)}" y1="${(s.y + 4).toFixed(1)}" x2="${(s.x + 4).toFixed(1)}" y2="${(s.y - 4).toFixed(1)}"/>
  </g>`;
}

/** Plate readout line for the CA pair, or '' if there's no target/CA data. */
function _trajGizmoCaPlateText(g) {
  if (!g.ca) return '';
  const dt = g.ca.t - g.met;
  const sign = dt < 0 ? '-' : '';
  const a = Math.abs(dt);
  const days = Math.floor(a / 86400), hrs = Math.floor((a % 86400) / 3600), mins = Math.floor((a % 3600) / 60);
  const tTxt = `T+${sign}${days ? days + 'd ' : ''}${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  const approx = g.ca.approx ? '~' : '';
  if (g.ca.encounter) return `${approx}ENCOUNTER · ${tTxt}`;
  return `${approx}CA ${Math.round(g.ca.dKm).toLocaleString()} km · in ${tTxt}`;
}

// R3.4: hover highlight — a plain attribute swap on the sibling visible knob
// (radius/stroke-width/opacity), NOT a re-render (spec item 2). `el` is the
// hit circle that received the mouse event; its visible sibling shares an id
// prefix (`tgh-<key>`) resolved from the hit circle's own title-adjacent DOM
// position — simplest robust hook is to look at the PREVIOUS sibling (the
// stroke-dasharray ring / solid dot emitted right after each hit circle).
function _trajGizmoHoverKnob(el, on) {
  const sib = el && el.nextElementSibling;
  if (!sib || sib.tagName !== 'circle') return;
  if (on) { sib.setAttribute('r', String(parseFloat(sib.getAttribute('r') || '7') + 2)); sib.setAttribute('stroke-width', '3'); sib.setAttribute('opacity', '1'); sib.dataset.hoverBoosted = '1'; }
  else if (sib.dataset.hoverBoosted) { sib.setAttribute('r', String(parseFloat(sib.getAttribute('r')) - 2)); sib.setAttribute('stroke-width', '2'); sib.setAttribute('opacity', sib.getAttribute('fill') === 'none' ? '0.85' : '0.9'); delete sib.dataset.hoverBoosted; }
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
  if (g.authIdx != null && !g.drag && !g.centerDrag) {
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
  _trajGizmoRenderMenu(va, rect);
}

// ── R3.4 node menu (+1/-1 orbit, delete, close) ─────────────────────────────
function _trajGizmoRenderMenu(va, rect) {
  const g = _trajGizmo;
  const existing = va.querySelector('.traj-gizmo-menu');
  if (!g || !g.menuOpen) { if (existing) existing.remove(); return; }
  const geo = _trajGizmoScreenGeo(g.missionId, rect);
  if (!geo) { if (existing) existing.remove(); return; }
  const canDelete = g.authIdx != null;
  const html = `
    <button onclick="_trajGizmoOrbitStep(1)">+1 orbit</button>
    <button onclick="_trajGizmoOrbitStep(-1)">-1 orbit</button>
    <button class="danger" onclick="_trajGizmoDeleteNode()">${canDelete ? 'Delete node' : 'Discard node'}</button>
    <button onclick="_trajGizmoCloseMenu()">Close</button>`;
  let menu = existing;
  if (!menu) {
    menu = document.createElement('div');
    menu.className = 'traj-gizmo-menu';
    va.appendChild(menu);
  }
  menu.style.left = (geo.nodeScreen.x + 14) + 'px';
  menu.style.top = (geo.nodeScreen.y + 14) + 'px';
  menu.innerHTML = html;
}

function _trajGizmoCloseMenu() {
  if (!_trajGizmo) return;
  _trajGizmo.menuOpen = false;
  _trajGizmoRepaintOverlay();
}

function _trajGizmoOrbitStep(sign) {
  const g = _trajGizmo;
  if (!g) return;
  const period = _trajGizmoOrbitPeriodMet(g.node.mu, g.node.r, g.node.v);
  g.menuOpen = false;
  if (!(period > 0)) { _trajGizmoRepaintOverlay(); return; }
  _trajGizmoApplyMet(Math.max(0, g.met + sign * period));
}

function _trajGizmoDeleteNode() {
  const g = _trajGizmo;
  if (!g) return;
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
  if (g.authIdx != null && m && m.log[g.authIdx]) {
    m.log.splice(g.authIdx, 1);
    _trajGizmo = null;
    document.removeEventListener('keydown', _trajGizmoKeydown);
    missionRecompute(m);
    missionRenderDetail();
    return;
  }
  _trajGizmoClose(); // pending node: nothing authored yet, just discard
}

// Recompute node state at a new MET, commit if this gizmo is attached to an
// existing MNODE (one recompute per commit — matches the drag-commit
// discipline), and repaint. Shared by center-drag release and the orbit
// +1/-1 menu actions.
function _trajGizmoApplyMet(newMet) {
  const g = _trajGizmo;
  if (!g) return;
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
  if (!m) return;
  const node = _trajGizmoNodeState(m, newMet, g.authIdx);
  if (!node) return;
  g.met = newMet;
  g.node = node;
  g.preview = null;
  g.ca = null;
  if (g.authIdx != null && m.log[g.authIdx] && m.log[g.authIdx].type === 'MNODE') {
    m.log[g.authIdx].at = { kind: 'met', value_s: newMet };
    missionRecompute(m);
    missionRenderDetail();
  } else {
    _trajGizmoRepaintOverlay();
  }
}

// ── Drag mechanics — handles (Δv) ───────────────────────────────────────────
function _trajGizmoHandleDown(evt, key) {
  const g = _trajGizmo;
  if (!g) return;
  evt.preventDefault();
  const h = _TRAJ_GIZMO_HANDLES.find(x => x.key === key);
  if (!h) return;
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
  const svgEl = va && va.querySelector('svg.traj-svg');
  const rect = svgEl && svgEl.getBoundingClientRect();
  const geo = rect && _trajGizmoScreenGeo(g.missionId, rect);
  if (!geo) return;
  g.drag = { key, component: h.component, sign: h.sign, x0: evt.clientX, y0: evt.clientY, dv0: _trajGizmoHandleValue(g, h), dir: geo.dirs[key] };
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
  else if (g.centerDrag) _trajGizmoCancelCenterDrag();
  else if (g.menuOpen) _trajGizmoCloseMenu();
  else _trajGizmoClose();
}

function _trajGizmoHandleMove(evt) {
  const g = _trajGizmo;
  if (!g || !g.drag) return;
  const dx = evt.clientX - g.drag.x0, dy = evt.clientY - g.drag.y0;
  const along = dx * g.drag.dir.ux + dy * g.drag.dir.uy; // signed px along the handle's OWN outward direction (pulling away always increases this handle's side)
  const sideMag = _trajGizmoHandleSideMag(g.drag.dv0, along, evt.shiftKey);
  g.dv[g.drag.component] = g.drag.sign * sideMag;
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
  if (_trajGizmoFullTimer) { clearTimeout(_trajGizmoFullTimer); _trajGizmoFullTimer = null; }
  g.drag = null;
  _trajGizmoCommit();
}

function _trajGizmoCancelDrag() {
  const g = _trajGizmo;
  if (!g || !g.drag) return;
  _trajGizmoEndDragListeners();
  if (_trajGizmoFullTimer) { clearTimeout(_trajGizmoFullTimer); _trajGizmoFullTimer = null; }
  g.dv[g.drag.component] = g.drag.sign * g.drag.dv0; // revert this drag's delta — zero log mutation
  g.drag = null;
  g.preview = null;
  _trajGizmoRepaintOverlay();
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
  const sceneEl = va && va.querySelector('svg.traj-svg g.traj-scene');
  const layer = sceneEl && sceneEl.querySelector('g.traj-gizmo-preview');
  if (layer) layer.innerHTML = '';
}

// ── Drag mechanics — center knob (node TIME) ────────────────────────────────
function _trajGizmoCenterDown(evt) {
  const g = _trajGizmo;
  if (!g || g.drag) return; // handle-drag owns the pointer; center never starts mid-handle-drag
  evt.preventDefault();
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
  const svgEl = va && va.querySelector('svg.traj-svg');
  const rect = svgEl && svgEl.getBoundingClientRect();
  const geo = rect && _trajGizmoScreenGeo(g.missionId, rect);
  if (!geo || !rect || !(rect.width > 0)) return;
  const vMagKms = physMag(g.node.v);
  g.centerDrag = { x0: evt.clientX, y0: evt.clientY, met0: g.met, moved: false, dir: geo.dirs.pro, kmPerPx: geo.cam.wKm / rect.width, vMagKms };
  g.menuOpen = false;
  document.addEventListener('mousemove', _trajGizmoCenterMove);
  document.addEventListener('mouseup', _trajGizmoCenterUp);
}

function _trajGizmoCenterMove(evt) {
  const g = _trajGizmo;
  if (!g || !g.centerDrag) return;
  const cd = g.centerDrag;
  const dx = evt.clientX - cd.x0, dy = evt.clientY - cd.y0;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) cd.moved = true;
  if (!cd.moved) return; // below the click-vs-drag threshold: don't touch MET yet
  const pxAlong = dx * cd.dir.ux + dy * cd.dir.uy;
  const dMet = _trajGizmoCenterDragDMet(pxAlong, cd.kmPerPx, cd.vMagKms);
  const newMet = Math.max(0, cd.met0 + dMet);
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
  if (!m) return;
  const node = _trajGizmoNodeState(m, newMet, g.authIdx);
  if (!node) return;
  g.met = newMet;
  g.node = node;
  _trajGizmoRepaintOverlay();
  _trajGizmoScheduleScratch();
}

function _trajGizmoCenterEndListeners() {
  document.removeEventListener('mousemove', _trajGizmoCenterMove);
  document.removeEventListener('mouseup', _trajGizmoCenterUp);
}

function _trajGizmoCenterUp() {
  const g = _trajGizmo;
  if (!g || !g.centerDrag) return;
  const cd = g.centerDrag;
  _trajGizmoCenterEndListeners();
  if (_trajGizmoFullTimer) { clearTimeout(_trajGizmoFullTimer); _trajGizmoFullTimer = null; }
  g.centerDrag = null;
  if (!cd.moved) { g.menuOpen = !g.menuOpen; _trajGizmoRepaintOverlay(); return; } // click (no drag) -> toggle the node menu
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
  if (m && g.authIdx != null && m.log[g.authIdx] && m.log[g.authIdx].type === 'MNODE') {
    m.log[g.authIdx].at = { kind: 'met', value_s: g.met };
    g.preview = null;
    missionRecompute(m);
    missionRenderDetail();
  } else {
    _trajGizmoRepaintOverlay();
  }
}

function _trajGizmoCancelCenterDrag() {
  const g = _trajGizmo;
  if (!g || !g.centerDrag) return;
  const cd = g.centerDrag;
  _trajGizmoCenterEndListeners();
  if (_trajGizmoFullTimer) { clearTimeout(_trajGizmoFullTimer); _trajGizmoFullTimer = null; }
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
  g.centerDrag = null;
  if (m) { const node = _trajGizmoNodeState(m, cd.met0, g.authIdx); if (node) { g.met = cd.met0; g.node = node; } }
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
// the side-table, never the log) — R3.4 fidelity ladder ─────────────────────
// WHILE actively dragging: 'cheap' mode on the existing ~100ms throttle —
// physPropagateSegment restricted to bodies:[center] (perturbers dropped)
// and maxSamples 64, i.e. an (near-)two-body pass reusing the SAME
// integrator entry point rather than a hand-rolled Kepler loop (simpler,
// still cheap — the expensive part of the full pass is the multi-body
// perturbation sum, not physPropagateSegment's own overhead). Once the
// pointer has been still for _TRAJ_GIZMO_FULL_DEBOUNCE_MS (2000, hand-tuned,
// see MATH.md §7k), a debounce timer fires ONE full-fidelity pass (full
// bodies list, maxSamples 128 — identical to R3.3's original scratch) and
// refines the preview path + CA pair. Any new move re-arms the debounce.
const _TRAJ_GIZMO_FULL_DEBOUNCE_MS = 2000;
let _trajGizmoScratchTimer = null;
let _trajGizmoFullTimer = null;
function _trajGizmoScheduleScratch() {
  const g = _trajGizmo;
  if (g) g.lastMoveMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (_trajGizmoFullTimer) clearTimeout(_trajGizmoFullTimer);
  _trajGizmoFullTimer = setTimeout(() => { _trajGizmoFullTimer = null; _trajGizmoRunScratch('full'); }, _TRAJ_GIZMO_FULL_DEBOUNCE_MS);
  if (_trajGizmoScratchTimer) return;
  _trajGizmoScratchTimer = setTimeout(() => { _trajGizmoScratchTimer = null; _trajGizmoRunScratch('cheap'); }, 100);
}

function _trajGizmoRunScratch(mode) {
  const g = _trajGizmo;
  if (!g || (!g.drag && !g.centerDrag)) return; // drag may have ended before the throttle/debounce fired
  const node = g.node;
  const dvVec = physAdd(physAdd(
    physScale(node.vHat, (g.dv.pro || 0) / 1000),
    physScale(node.rHat, (g.dv.rad || 0) / 1000)),
    physScale(node.hHat, (g.dv.nrm || 0) / 1000));
  const state = { r: node.r, v: physAdd(node.v, dvVec) };
  const parent = typeof physParentOf === 'function' ? physParentOf(node.body) : null;
  const fullBodies = [...new Set([node.body, parent || 'Sun', 'Sun', node.body === 'Earth' ? 'Moon' : null].filter(Boolean))];
  const cheap = mode !== 'full';
  const bodies = cheap ? [node.body] : fullBodies;
  const maxSamples = cheap ? 64 : 128;
  let horizon = 30 * 86400;
  const el = (typeof physStateToElements === 'function') ? physStateToElements(state.r, state.v, node.mu) : null;
  if (el && el.a > 0 && isFinite(el.period)) horizon = Math.min(horizon, Math.max(3 * el.period, 3600));
  const res = physPropagateSegment(state, g.met, g.met + horizon, { center: node.body, bodies, overrides: {} }, { maxSamples });
  g.preview = { samples: res.samples, body: node.body, fidelity: mode };
  // R3.4 item 4: closest-approach pair, recomputed alongside the preview at
  // whichever fidelity just ran — cheap-mode CA is approximate (flagged, so
  // the plate can show a "~" prefix) and gets silently refined by the next
  // full pass once the drag settles.
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
  const target = _trajGizmoPickTarget(m, node, g.met);
  if (target) {
    const hit = _trajGizmoClosestApproach(res.samples, target);
    const soiT = _trajGizmoSoiEntryT(res.samples, target);
    if (hit) g.ca = { dKm: hit.dKm, t: hit.t, craftR: hit.craftR, frame: hit.frame, target, encounter: soiT != null, soiT, approx: cheap };
    else g.ca = null;
  } else {
    g.ca = null;
  }
  _trajGizmoRepaintScenePreview();
  _trajGizmoRepaintOverlay();
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
  let html = d ? `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1" stroke-dasharray="2.5,2" vector-effect="non-scaling-stroke" opacity="0.85"/>` : '';
  // R3.4: target-at-CA ghost marker, in the SAME frame convention as the rest
  // of the scratch preview (only drawn when the target's own frame matches
  // the preview's drawn body — the wider committed-leg render path (565's
  // _trajPhysLegRender) has no such limit, see MATH.md §7k).
  if (g.ca && g.ca.frame === g.node.body && bodyWorld && typeof _trajGhostMarker === 'function') {
    const tgtState = (typeof physBodyStateAt === 'function') ? physBodyStateAt(g.ca.target, g.ca.t, {}) : null;
    if (tgtState) {
      const p = _trajProj3(tgtState.r[0] - camCenterKm.x, tgtState.r[1] - camCenterKm.y, (tgtState.r[2] || 0) - (camCenterKm.z || 0));
      html += _trajGhostMarker(p.x * zoom, p.y * zoom, g.ca.target, zoom, 1);
    }
  }
  let layer = sceneEl.querySelector('g.traj-gizmo-preview');
  if (!layer) sceneEl.insertAdjacentHTML('beforeend', `<g class="traj-gizmo-preview">${html}</g>`);
  else layer.innerHTML = html;
}
