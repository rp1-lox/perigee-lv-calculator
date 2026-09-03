// ─── MANEUVER GIZMO — KSP-style MNODE authoring on the trajectory overlay ──
// Six pull-out handles (pro/retro, radial out/in, normal/anti — each adds only
// in its own direction), a center knob that slides the node in time along its
// orbit plus a small menu (+1/-1 orbit, delete, close), and a closest-approach
// readout vs the mission's next destination body. Render state is module-local
// — never on m, never in autosave. Pure math lives in -math, hover in -hover,
// drag in -drag.


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
 *  orbitState — an intentional simplification documented in;
 *  precise historical reconstruction would require re-replaying the log up
 *  to `met`, which the gizmo does not do. */
function _trajGizmoNodeState(m, met, authIdx) {
  let o = null;
  if (authIdx != null && m.log[authIdx] && m.log[authIdx].orbitAtBurn) o = m.log[authIdx].orbitAtBurn;
  else {
    const fv = m.vehicleId ? PROG_ACTIVE_PROGRAM.vehicles[m.vehicleId] : null;
    o = fv && fv.orbitState ? fv.orbitState : null;
  }
  // The actual math (mean-anomaly circular reconstruction via
  // physAimBurnState) is factored out to _trajGizmoOrbitNodeAt so a ring
  // hover/click-menu can share the identical rail without a gizmo attached.
  return _trajGizmoOrbitNodeAt(o, met);
}

/** R6.2' Phase A: departure-state reconstruction for an EXISTING MANEUVER log
 *  entry (as opposed to MNODE's own recorded orbitAtBurn). No side-table
 *  entry records the exact departure r/v basis physSolveNodeBurn/the P4
 *  shooter actually flew (only the solved dvVec, in 565's leg record) — so
 *  documented fallback, this reconstructs from the
 *  fromNode's authored orbit at the maneuver's own MET via the SAME
 *  mean-anomaly rail _trajGizmoOrbitNodeAt/_trajGizmoNodeState already use
 *  for MNODE. The reconstructed basis is internally consistent (orthonormal)
 *  so decomposing the leg's real dvVec against it is exact in magnitude even
 *  though the absolute burn POINT (theta) may differ slightly from what the
 *  shooter actually flew — a presentation-layer simplification, not a
 *  physics change (ΔV accounting is untouched: it still comes from
 *  progNmComputeEdgeDv via the leg, never recomputed here). Returns the same
 *  shape as _trajGizmoNodeState, or null. */
function _trajGizmoManeuverNodeState(m, e, missionId, authIdx) {
  if (!e || !_evIsSolvedManeuver(e) || !e.fromNode) return null;
  const fromN = _missionNmNodeById(e.fromNode);
  const o = fromN && fromN.orbit;
  if (!o) return null;
  const met = e.metStart != null ? e.metStart : 0;
  const fallback = _trajGizmoOrbitNodeAt(o, met);
  if (!fallback) return null;
  // R6.2' Phase B step 5 (basis fix): prefer the leg's RECORDED actual burn
  // state (leg.burnState — the shooter's real departure state for a moon/
  // interplanetary leg) over the mean-motion reconstruction above, when it's
  // available. Only the axes (rHat/vHat/hHat) + r/v are swapped; body/mu
  // stay from the fallback lookup.
  if (missionId != null && authIdx != null) {
    const rec = _physTrajByMission[missionId];
    const leg = rec && rec.legs && rec.legs.find(l => l.authIdx === authIdx);
    if (leg && leg.burnState && leg.burnState.r && leg.burnState.v) {
      const axes = _trajGizmoAxes(leg.burnState.r, leg.burnState.v);
      if (axes) return Object.assign({}, fallback, { r: leg.burnState.r, v: leg.burnState.v,
        rHat: axes.rHat, vHat: axes.vHat, hHat: axes.hHat });
    }
  }
  return fallback;
}

/** R6.2' Phase A: look up the solved Δv (leg.dvVec, km/s) for a MANEUVER's
 *  physics leg in the mission's side-table (_physTrajByMission, 565 — the
 *  ONLY sanctioned source for this vector), decomposed into (pro,rad,nrm)
 *  m/s against `node`'s local basis. Returns null if the leg hasn't been
 *  computed yet (physics off, or not yet recomputed). Pure lookup + the pure
 *  decompose helper above — no math performed here beyond that call. */
function _trajGizmoManeuverSolvedDv(missionId, authIdx, node) {
  if (!node) return null;
  const rec = _physTrajByMission[missionId];
  const leg = rec && rec.legs && rec.legs.find(l => l.authIdx === authIdx);
  if (!leg || !leg.dvVec) return null;
  const axes = _trajGizmoAxes(node.r, node.v);
  if (!axes) return null;
  return _trajGizmoDecomposeDv(leg.dvVec, axes);
}

/** R3.4 target selection for the closest-approach pair: scan the mission log
 *  for the next MANEUVER after `met` whose destination node names a body
 *  different from the node's own body; else fall back to the Moon for
 *  Earth-centric nodes;
 *  else null (no CA pair shown). */
function _trajGizmoPickTarget(m, node, met) {
  if (!m || !node) return null;
  // Round 2 item 3: explicit target wins over the heuristics — first a
  // runtime pick from clicking a body glyph while the gizmo is open (session
  // state, not persisted), then an authored `caTarget` field on the MNODE
  // log entry set via its event-card dropdown (persisted, since it's
  // authored state on the event, same as any other MNODE field).
  const g = _trajGizmo;
  if (g && g.manualTarget) {
    if (g.manualTarget === node.body) return null; // can't target your own body
    return g.manualTarget;
  }
  if (g && g.authIdx != null && m.log[g.authIdx]) {
    const ct = m.log[g.authIdx].caTarget;
    if (ct && ct !== 'auto' && ct !== node.body) return ct;
  }
  for (const e of m.log || []) {
    if (!_evIsSolvedManeuver(e) || !e.toNode) continue;
    if ((e.metStart != null ? e.metStart : 0) < met) continue; // only look forward from the node
    const n = _missionNmNodeById(e.toNode);
    if (n && n.body && n.body !== node.body) return n.body;
  }
  if (node.body === 'Earth' && PROG_BODIES.Moon) return 'Moon';
  return null;
}

/** Round 2 item 3(a): set the gizmo's runtime CA target from a body-glyph
 *  click (session state only — not written to the log; the persisted
 *  equivalent is the MNODE card's caTarget dropdown). Re-runs the cheap
 *  scratch pass so the CA readout/ghost marker reflect the new target
 *  immediately without forcing a full n-body pass. */
function _trajGizmoSetManualTarget(body) {
  const g = _trajGizmo;
  if (!g || !body) return;
  g.manualTarget = body;
  if (typeof _trajGizmoRunScratch === 'function') _trajGizmoRunScratch('cheap');
  else _trajGizmoRepaintOverlay();
}

function _trajGizmoOpenPending(id, met) {
  const m = _missionGet(id);
  if (!m) return;
  const node = _trajGizmoNodeState(m, met, null);
  if (!node) return;
  _trajGizmo = { missionId: id, met, authIdx: null, kind: 'mnode', dv: { pro: 0, rad: 0, nrm: 0 }, node, drag: null, centerDrag: null, menuOpen: false, preview: null, ca: null };
  document.addEventListener('keydown', _trajGizmoKeydown);
  _trajGizmoAddDismissListeners();
  missionRenderDetail();
}

// R6.2″ (round-3 item 5): "+ Maneuver node here" on a PHYSICS-LEG polyline.
// R6.2.1 deliberately withheld this because _trajGizmoOpenPending's node
// state (via _trajGizmoNodeState(m, met, null)) reconstructs from the
// vehicle's SETTLED orbitState — wrong mid-transfer (it would snap the node
// onto the parking/destination ring instead of the hovered leg point). This
// builds the node's state from physLegStateAt (565) instead — an EXACT
// re-propagation of the covering leg from its own recorded initial state to
// the hovered MET, so a node dropped mid-TLC gets a real cislunar state (and
// the right frame/mu when the hovered point lies inside the Moon's SOI).
function _trajGizmoOpenPendingOnLeg(missionId, authIdx, met) {
  const m = _missionGet(missionId);
  if (!m) return;
  const st = physLegStateAt(missionId, authIdx, met);
  if (!st || !st.r || !st.v || !st.frame || !PROG_BODIES[st.frame]) return;
  const axes = _trajGizmoAxes(st.r, st.v);
  if (!axes) return;
  const node = { body: st.frame, mu: PROG_BODIES[st.frame].mu, r: st.r, v: st.v,
    rHat: axes.rHat, vHat: axes.vHat, hHat: axes.hHat };
  _trajGizmo = { missionId, met, authIdx: null, kind: 'mnode', dv: { pro: 0, rad: 0, nrm: 0 }, node,
    drag: null, centerDrag: null, menuOpen: false, preview: null, ca: null,
    // legAuthIdx marks this pending node as leg-spawned: _trajGizmoCommit
    // inserts it right after the covering leg's own authored event (instead
    // of appending at the end of the log) and stamps e.burnState/burnFrame
    // from node.r/node.v (the PRE-burn state — dv hasn't been added to it)
    // so 565's MNODE leg builder can fly from this exact point without an
    // orbitAtBurn context.
    legAuthIdx: authIdx };
  document.addEventListener('keydown', _trajGizmoKeydown);
  _trajGizmoAddDismissListeners();
  missionRenderDetail();
}

function _trajGizmoOpenExisting(id, authIdx) {
  const m = _missionGet(id);
  if (!m || !m.log[authIdx]) return;
  let e = m.log[authIdx];
  if (_evIsSolvedManeuver(e)) {
    // dblclicking a solved maneuver (legacy MANEUVER shim, or unified
    // MNODE mode:'solved') opens the SAME gizmo, showing the leg's solved Δv
    // on the handles (kind:'maneuver'). The gizmo starts attached (authIdx
    // set) but the log entry's MODE is untouched until the first handle drag
    // flips it to 'manual' (see _trajGizmoHandleDown/_trajGizmoDetachManeuverIfNeeded)
    // — so opening/closing without dragging is a no-op, same as inspecting
    // an MNODE without touching a handle.
    const node = _trajGizmoManeuverNodeState(m, e, id, authIdx);
    if (!node) return;
    const met = e.metStart != null ? e.metStart : 0;
    const solved = _trajGizmoManeuverSolvedDv(id, authIdx, node) || { pro: 0, rad: 0, nrm: 0 };
    const tgt = _evManeuverTarget(e);
    const toN = (tgt) ? _missionNmNodeById(tgt.toNode) : null;
    const toLabel = e.toLabel || (toN && toN.label) || (tgt && tgt.toNode) || '?';
    _trajGizmo = {
      missionId: id, met, authIdx, kind: 'maneuver',
      dv: { pro: solved.pro, rad: solved.rad, nrm: solved.nrm }, node,
      drag: null, centerDrag: null, menuOpen: false, preview: null, ca: null,
      solved: { pro: solved.pro, rad: solved.rad, nrm: solved.nrm, toLabel },
    };
    document.addEventListener('keydown', _trajGizmoKeydown);
    _trajGizmoAddDismissListeners();
    _trajGizmoRepaintOverlay();
    return;
  }
  if (e.type === 'MNODE') {
    const met = (e.at && e.at.value_s != null) ? e.at.value_s : (e.metStart || 0);
    const node = _trajGizmoNodeState(m, met, authIdx);
    if (!node) return;
    _trajGizmo = { missionId: id, met, authIdx, kind: 'mnode', dv: { pro: e.dvPro_ms || 0, rad: e.dvRad_ms || 0, nrm: e.dvNrm_ms || 0 }, node, drag: null, centerDrag: null, menuOpen: false, preview: null, ca: null };
    document.addEventListener('keydown', _trajGizmoKeydown);
    _trajGizmoAddDismissListeners();
    _trajGizmoRepaintOverlay();
  }
}

// Dismiss affordances beyond Escape — left-click
// anywhere that isn't the gizmo (its overlay layer or flyout menu) closes it,
// as does right-click when not mid-drag. Committed MNODE edits are already in
// the log by close time (commit happens on drag release), so closing only
// clears the pending overlay/preview.
function _trajGizmoAddDismissListeners() {
  document.addEventListener('click', _trajGizmoDocClick, true);
  document.addEventListener('contextmenu', _trajGizmoDocCtxMenu);
}
function _trajGizmoRemoveDismissListeners() {
  document.removeEventListener('click', _trajGizmoDocClick, true);
  document.removeEventListener('contextmenu', _trajGizmoDocCtxMenu);
}
function _trajGizmoDocClick(evt) {
  const g = _trajGizmo;
  if (!g || g.drag || g.centerDrag) return;
  // A camera rotate-drag ends with a click too — don't treat it as dismissal.
  // (Read without consuming: trajGlyphClick owns resetting the flag.)
  if (_trajJustDragged) return;
  const t = evt.target;
  if (t && t.closest && t.closest('g.traj-gizmo-layer, .traj-gizmo-menu, .traj-body-glyph')) return;
  _trajGizmoClose();
}
function _trajGizmoDocCtxMenu(evt) {
  const g = _trajGizmo;
  if (!g || g.drag || g.centerDrag) return; // mid-drag right-click = cancel drag (own handler)
  evt.preventDefault();
  _trajGizmoClose();
}

// Drop the gizmo state and every document-level listener/timer it owns.
function _trajGizmoTeardown() {
  if (_trajGizmoFullTimer) { clearTimeout(_trajGizmoFullTimer); _trajGizmoFullTimer = null; }
  document.removeEventListener('keydown', _trajGizmoKeydown);
  _trajGizmoRemoveDismissListeners();
  _trajGizmo = null;
}

function _trajGizmoClose() {
  if (!_trajGizmo) return;
  const id = _trajGizmo.missionId;
  _trajGizmoTeardown();
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

// Dblclick affordances. Ring click:
// MET = current view time (documented simplification — the theta-inversion
// path is skipped, see the module doc comment). Polyline click: nearest
// sample's MET (primary path).
function _trajGizmoRingDblClick(id, authIdx, evt) {
  if (evt) evt.stopPropagation();
  if (_trajGizmo && (_trajGizmo.drag || _trajGizmo.centerDrag)) return; // never spawn a second gizmo mid-drag
  const m = _missionGet(id);
  if (!m) return;
  _trajGizmoOpenPending(id, _trajViewTime(m));
}

function _trajGizmoLegDblClick(id, authIdx, evt) {
  if (evt) evt.stopPropagation();
  if (_trajGizmo && (_trajGizmo.drag || _trajGizmo.centerDrag)) return;
  const m = _missionGet(id);
  if (!m) return;
  // R6.2' Phase A item 1: a MANEUVER leg/marker dblclick opens the SAME
  // gizmo at the maneuver's solved state (_trajGizmoOpenExisting), instead
  // of the "spawn a pending MNODE at the nearest sample" behavior below
  // (which remains the fallback for other physics-leg dblclicks, e.g. an
  // arrival/exiting-corridor leg with no MANEUVER of its own at this index).
  if (m.log[authIdx] && _evIsSolvedManeuver(m.log[authIdx])) { _trajGizmoOpenExisting(id, authIdx); return; }
  const rec = _physTrajByMission[id];
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
  const m = _missionGet(id);
  const cam = _trajCamByMission[id];
  if (!m || !cam) return null;
  const vt = _trajViewTime(m);
  const zoom = _trajZoomFromCam(cam);
  _trajProjCtx = { az: cam.az || 0, el: cam.el != null ? cam.el : Math.PI / 2 };
  const camCenterKm = _trajCamCenterKm(cam, vt);
  const bodyWorld = progBodyWorldPos(g.node.body, vt);
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


/** KSP navball-style glyph for a handle
 *  knob, in the knob's own LOCAL coordinate space (origin at the knob
 *  center; screen px, y-down). `r` = the knob's visible radius; `color` =
 *  the handle's own var(--accent*) (data, not a chromatic literal — same
 *  var already used for the shaft line); `negSide` draws a dashed ring (the
 *  paired "-" handle) instead of solid, consistent with the existing +/-
 *  outline convention. Pure string builder, DOM-free. */
function _trajGizmoKnobGlyphSVG(key, r, color, negSide) {
  const ring = `<circle r="${r}" fill="none" stroke="${color}" stroke-width="1.4"${negSide ? ' stroke-dasharray="2.5,2"' : ''} opacity="0.9"/>`;
  const spokeAt = (deg, r0, r1) => {
    const rad = (deg * Math.PI) / 180;
    const x0 = r0 * Math.sin(rad), y0 = -r0 * Math.cos(rad);
    const x1 = r1 * Math.sin(rad), y1 = -r1 * Math.cos(rad);
    return `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${color}" stroke-width="1.4"/>`;
  };
  if (key === 'pro' || key === 'retro') {
    const angles = key === 'pro' ? [0, 120, 240] : [60, 180, 300];
    let g = ring + `<circle r="1.8" fill="${color}"/>`;
    angles.forEach(a => { g += spokeAt(a, r * 0.4, r * 0.95); });
    if (key === 'retro') {
      const d = r * 0.55;
      g += `<line x1="${(-d).toFixed(1)}" y1="${(-d).toFixed(1)}" x2="${d.toFixed(1)}" y2="${d.toFixed(1)}" stroke="${color}" stroke-width="1.3"/>`;
      g += `<line x1="${(-d).toFixed(1)}" y1="${d.toFixed(1)}" x2="${d.toFixed(1)}" y2="${(-d).toFixed(1)}" stroke="${color}" stroke-width="1.3"/>`;
    }
    return g;
  }
  if (key === 'radOut' || key === 'radIn') {
    let g = ring;
    [0, 90, 180, 270].forEach(a => {
      g += key === 'radOut' ? spokeAt(a, r * 0.6, r * 1.15) : spokeAt(a, r * 0.55, r * 0.9);
    });
    return g;
  }
  // normal / antinormal: outline triangle, vertex pointing away from the
  // node ('nrm', up) or toward it ('antinrm', inverted).
  const up = key === 'nrm';
  const tipY = up ? -r * 1.1 : r * 1.1;
  const baseY = up ? r * 0.6 : -r * 0.6;
  const baseW = r * 0.9;
  return `<polygon points="0,${tipY.toFixed(1)} ${(-baseW).toFixed(1)},${baseY.toFixed(1)} ${baseW.toFixed(1)},${baseY.toFixed(1)}" fill="none" stroke="${color}" stroke-width="1.5"${negSide ? ' stroke-dasharray="2.5,2"' : ''}/>`;
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
      // Back to a circular knob (the
      // R3.5 arrowhead killed hover-highlight and was harder to grab) PLUS a
      // KSP navball glyph drawn inside it via _trajGizmoKnobGlyphSVG — the
      // >= 12px transparent hit circle is unchanged, and the glyph group
      // (`<g id="${kid}">`) is its sibling so _trajGizmoHoverKnob can scale
      // the whole glyph up on hover (see that function).
      svg += `<circle cx="${tipScreen.x.toFixed(1)}" cy="${tipScreen.y.toFixed(1)}" r="12" fill="transparent" style="pointer-events:auto;cursor:grab" onmousedown="event.stopPropagation();_trajGizmoHandleDown(event,'${h.key}')" onmouseenter="_trajGizmoHoverKnob(this,true)" onmouseleave="_trajGizmoHoverKnob(this,false)"><title>${h.label} handle — pull and hold to build rate (shift = fine)</title></circle>`;
      const glyph = _trajGizmoKnobGlyphSVG(h.key, knobR, d.color, negSide);
      svg += `<g id="${kid}" transform="translate(${tipScreen.x.toFixed(1)},${tipScreen.y.toFixed(1)})" data-tx="${tipScreen.x.toFixed(1)}" data-ty="${tipScreen.y.toFixed(1)}" style="pointer-events:none">${glyph}</g>`;
    }
  });
  const readout = _trajGizmoFormatReadout(g.dv.pro, g.dv.rad, g.dv.nrm, g.met);
  const caTxt = _trajGizmoCaPlateText(g);
  const solvedTxt = (g.kind === 'maneuver' && g.solved) ? `solved → ${g.solved.toLabel}` : '';
  const detachedTxt = (g.kind === 'mnode' && g.solved) ? `detached — was: solved burn` : '';
  const plateLines = [readout];
  if (solvedTxt) plateLines.push(solvedTxt);
  if (detachedTxt) plateLines.push(detachedTxt);
  if (caTxt) plateLines.push(caTxt);
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
  const bodyWorld = progBodyWorldPos(g.ca.frame, geo.vt);
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

// Hover highlight — a plain attribute swap on the sibling visible knob
// (radius/stroke-width/opacity), NOT a re-render (spec item 2). `el` is the
// hit circle that received the mouse event; its visible sibling shares an id
// prefix (`tgh-<key>`) resolved from the hit circle's own title-adjacent DOM
// position — simplest robust hook is to look at the PREVIOUS sibling (the
// stroke-dasharray ring / solid dot emitted right after each hit circle).
function _trajGizmoHoverKnob(el, on) {
  const sib = el && el.nextElementSibling;
  if (!sib) return;
  if (sib.tagName === 'g') {
    // The glyph group scales up around its own
    // anchor point on hover — translate is baked into data-tx/data-ty so a
    // trailing scale() applies around the glyph's local origin (the tip),
    // restoring the pre-R3.5 "hover expands the knob slightly" behavior.
    const tx = sib.getAttribute('data-tx'), ty = sib.getAttribute('data-ty');
    sib.setAttribute('transform', `translate(${tx},${ty}) scale(${on ? 1.3 : 1})`);
    return;
  }
  if (sib.tagName !== 'circle') return;
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
    const m = _missionGet(g.missionId);
    const le = m && m.log[g.authIdx];
    // Solved check FIRST: a unified MNODE(mode:'solved') is still type
    // 'MNODE' at the storage level, so testing le.type alone would
    // misclassify a still-solved gizmo as 'mnode' kind before ever reaching
    // the maneuver branch below.
    if (le && _evIsSolvedManeuver(le) && g.kind === 'maneuver') {
      // still-solved maneuver (not yet detached) — re-derive the solved Δv
      // in case an upstream edit (e.g. a preceding COAST commit) recomputed
      // the leg with a new magnitude/state.
      const node = _trajGizmoManeuverNodeState(m, le, g.missionId, g.authIdx);
      if (node) {
        g.node = node;
        g.met = le.metStart != null ? le.metStart : g.met;
        const solved = _trajGizmoManeuverSolvedDv(g.missionId, g.authIdx, node);
        if (solved) { g.dv = { pro: solved.pro, rad: solved.rad, nrm: solved.nrm }; g.solved = Object.assign({}, g.solved, solved); }
      }
    } else if (le && le.type === 'MNODE') {
      const node = _trajGizmoNodeState(m, g.met, g.authIdx);
      if (node) g.node = node;
      g.kind = 'mnode';
    } else {
      _trajGizmoTeardown(); // the event was deleted/undone out from under us
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
  // R6.2' Phase A item 4: a detached MNODE (has a retained `target`) gets a
  // re-solve action right in the gizmo flyout, mirroring the MNODE card's
  // button (570).
  const m = _missionGet(g.missionId);
  const le = m && g.authIdx != null ? m.log[g.authIdx] : null;
  const resolveBtn = (le && _evIsManualBurn(le) && le.target)
    ? `<button onclick="missionMnodeResolveToTarget('${g.missionId}',${g.authIdx})">↺ Re-solve to target</button>` : '';
  const html = `
    <button onclick="_trajGizmoOrbitStep(1)">+1 orbit</button>
    <button onclick="_trajGizmoOrbitStep(-1)">-1 orbit</button>
    ${resolveBtn}
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
  const m = _missionGet(g.missionId);
  if (g.authIdx != null && m && m.log[g.authIdx]) {
    m.log.splice(g.authIdx, 1);
    _trajGizmoTeardown();
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
  const m = _missionGet(g.missionId);
  if (!m) return;
  const node = _trajGizmoNodeState(m, newMet, g.authIdx);
  if (!node) return;
  g.met = newMet;
  g.node = node;
  g.preview = null;
  g.ca = null;
  if (g.authIdx != null && m.log[g.authIdx] && _evIsManualBurn(m.log[g.authIdx])) {
    m.log[g.authIdx].at = { kind: 'met', value_s: newMet };
    missionRecompute(m);
    missionRenderDetail();
  } else {
    _trajGizmoRepaintOverlay();
  }
}

