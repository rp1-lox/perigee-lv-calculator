// ──────────────────────────────────────────────────────────────────────────────────
// 5745-maneuver-gizmo-drag.js — Gizmo drag mechanics, commit, and scratch preview
//
// OWNS: the interactive drag handling — Δv handle drag (pointer down/move/up, ticker,
//   keydown, cancel: _trajGizmoHandleDown/Move/Up, _trajGizmoHandleTick,
//   _trajGizmoStart/StopDragTicker, _trajGizmoDetachManeuverIfNeeded, _trajGizmoKeydown,
//   _trajGizmoDragCtxMenu, _trajGizmoCancelDrag); center-knob TIME drag and MANEUVER
//   center-drag (_trajGizmoCenterDown/Move/Up, _trajGizmoManeuverCenterDown,
//   _trajGizmoManeuverCommitTimeDrag, _trajGizmoCancelCenterDrag); the commit path
//   (_trajGizmoCommit); and the SCRATCH-ONLY live-preview propagation
//   (_TRAJ_GIZMO_FULL_DEBOUNCE_MS, _trajGizmoScheduleScratch[Cheap], _trajGizmoRunScratch,
//   _trajGizmoRepaintScenePreview).
// Does NOT own: overlay rendering / node menu (residual core), hover placement (-hover),
//   or pure math (-math).
// Split out of 5745-maneuver-gizmo.js (behavior-preserving move). Definitions/decls
//   only (no load-time execution); load order among 5745* def-only modules is irrelevant.
// ────────────────────────────────────────────────────────────────────────────

// ── Drag mechanics — handles (Δv) ───────────────────────────────────────────
/** R6.2' Phase B: the first Δv-handle drag on a solved maneuver gizmo
 *  DETACHES it — now a pure MODE-FLIP ('solved' -> 'manual') on the SAME
 *  unified log entry (lazy-migrated to unified form when the gizmo opened,
 *  see _trajGizmoOpenExisting) instead of Phase A's object swap-and-stash:
 *  `target` stays on the entry so "Re-solve to target"
 *  (missionMnodeResolveToTarget, 570) can flip it straight back, and
 *  dvPro/rad/nrm_ms are seeded to the solved values already sitting in
 *  g.dv (the gizmo opened showing them) so the manual burn starts
 *  byte-identical to what was flying a moment ago. No recompute here — the
 *  existing MNODE drag/commit path (unchanged below) recomputes on release,
 *  exactly like authoring a fresh MNODE. Idempotent: a no-op once g.kind is
 *  already 'mnode' (e.g. dragging a second handle on an already-detached
 *  node). */
function _trajGizmoDetachManeuverIfNeeded() {
  const g = _trajGizmo;
  if (!g || g.kind !== 'maneuver' || g.authIdx == null) return;
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
  if (!m || !m.log[g.authIdx] || !_evIsSolvedManeuver(m.log[g.authIdx])) return;
  const e = m.log[g.authIdx];
  e.mode = 'manual';
  e.at = { kind: 'met', value_s: g.met };
  e.dvPro_ms = g.dv.pro; e.dvRad_ms = g.dv.rad; e.dvNrm_ms = g.dv.nrm;
  // R6.2' Phase B step 5 (detach fidelity): stamp the leg's recorded ACTUAL
  // burn state (plain {r:[...],v:[...]} arrays — JSON-safe, rides autosave
  // fine) onto the now-manual entry, so 565's manual-MNODE leg builder
  // applies the same dv vector in the same basis the solved leg really flew,
  // instead of reconstructing from mean-motion phase. Falls back silently
  // (no stamp) if the leg hasn't been computed with a burnState yet.
  const rec = (typeof _physTrajByMission !== 'undefined') ? _physTrajByMission[g.missionId] : null;
  const leg = rec && rec.legs && rec.legs.find(l => l.authIdx === g.authIdx);
  if (leg && leg.burnState && leg.burnState.r && leg.burnState.v)
    e.burnState = { r: leg.burnState.r.slice(), v: leg.burnState.v.slice() };
  g.kind = 'mnode';
}

function _trajGizmoHandleDown(evt, key) {
  const g = _trajGizmo;
  if (!g) return;
  evt.preventDefault();
  _trajGizmoDetachManeuverIfNeeded();
  const h = _TRAJ_GIZMO_HANDLES.find(x => x.key === key);
  if (!h) return;
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
  const svgEl = va && va.querySelector('svg.traj-svg');
  const rect = svgEl && svgEl.getBoundingClientRect();
  const geo = rect && _trajGizmoScreenGeo(g.missionId, rect);
  if (!geo) return;
  // R3.5.1 (correction #2): compStart is still the component's RAW signed
  // value at grab time (used only to revert on cancel) — the live value is
  // now driven by _trajGizmoHandleTick's rate integration, not a per-move
  // px->dv conversion. curX/curY track the latest cursor position; the
  // ticker (started below) reads them every animation frame.
  g.drag = { key, component: h.component, sign: h.sign, x0: evt.clientX, y0: evt.clientY, curX: evt.clientX, curY: evt.clientY, shift: evt.shiftKey, compStart: g.dv[h.component] || 0, dir: geo.dirs[key], lastTickMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) };
  document.addEventListener('mousemove', _trajGizmoHandleMove);
  document.addEventListener('mouseup', _trajGizmoHandleUp);
  document.addEventListener('contextmenu', _trajGizmoDragCtxMenu);
  _trajGizmoStartDragTicker();
  // R3.5.1 (item 3 root-cause fix): arm the full-fidelity debounce right
  // away, same as a real move would — otherwise a user who holds a handle
  // perfectly still while the rate builds (very plausible with a hold-to-
  // accumulate control) never triggers a single 'full' scratch pass, and an
  // escaping burn's heliocentric preview never has a chance to compute
  // before release. See _trajGizmoHandleMove for the matching re-arm on
  // actual cursor movement, and _trajGizmoHandleTick for why per-TICK calls
  // deliberately do NOT touch this timer.
  _trajGizmoScheduleScratch();
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

// R3.5.1 (correction #2): mousemove during a handle drag only records the
// latest cursor position + shift state — the actual Δv integration happens
// in _trajGizmoHandleTick, driven by requestAnimationFrame, so the number
// keeps climbing even if the cursor sits still (KSP "hold to build rate").
function _trajGizmoHandleMove(evt) {
  const g = _trajGizmo;
  if (!g || !g.drag) return;
  g.drag.curX = evt.clientX;
  g.drag.curY = evt.clientY;
  g.drag.shift = evt.shiftKey;
  // Real cursor movement re-arms the full-fidelity debounce (matches the
  // R3.4 "any new movement resets the ladder to cheap" contract) — ticks
  // alone (no movement) leave it running so a stationary hold still gets
  // its one full pass ~2s in, per _trajGizmoHandleDown's comment.
  _trajGizmoScheduleScratch();
}

let _trajGizmoDragTicker = null;

/** One rAF tick of the held-handle rate integration: pullPx (>=0, along the
 *  handle's own outward axis — pushing back toward the node floors to 0)
 *  drives _trajGizmoPullRate (m/s per second); that rate is applied for
 *  this tick's real elapsed dt and ADDED signed (sign*rate*dt) to the
 *  component with NO zero-floor — crossing zero and going negative (or
 *  positive, for the opposite handle) is intentional, per the user's
 *  described KSP behavior. */
function _trajGizmoHandleTick() {
  const g = _trajGizmo;
  if (!g || !g.drag) { _trajGizmoDragTicker = null; return; }
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const dt = Math.max(0, (now - (g.drag.lastTickMs || now)) / 1000);
  g.drag.lastTickMs = now;
  const dx = g.drag.curX - g.drag.x0, dy = g.drag.curY - g.drag.y0;
  const alongPx = dx * g.drag.dir.ux + dy * g.drag.dir.uy;
  const pullPx = Math.max(0, alongPx);
  const rate = _trajGizmoPullRate(pullPx, g.drag.shift);
  if (rate > 0 && dt > 0) {
    g.dv[g.drag.component] = (g.dv[g.drag.component] || 0) + g.drag.sign * rate * dt;
    _trajGizmoRepaintOverlay();
    // R3.5.1 (item 3 note): while the ticker runs, only the CHEAP throttled
    // preview refreshes — the full n-body debounce is deliberately NOT
    // re-armed on every tick (it would never fire while a handle is held),
    // and the release path doesn't need it either since _trajGizmoCommit
    // triggers a real missionRecompute (full physics) immediately.
    _trajGizmoScheduleScratchCheap();
  }
  _trajGizmoDragTicker = requestAnimationFrame(_trajGizmoHandleTick);
}

function _trajGizmoStartDragTicker() {
  if (_trajGizmoDragTicker) return;
  _trajGizmoDragTicker = requestAnimationFrame(_trajGizmoHandleTick);
}

function _trajGizmoStopDragTicker() {
  if (_trajGizmoDragTicker) { cancelAnimationFrame(_trajGizmoDragTicker); _trajGizmoDragTicker = null; }
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
  _trajGizmoStopDragTicker();
  if (_trajGizmoFullTimer) { clearTimeout(_trajGizmoFullTimer); _trajGizmoFullTimer = null; }
  g.drag = null;
  _trajGizmoCommit();
}

function _trajGizmoCancelDrag() {
  const g = _trajGizmo;
  if (!g || !g.drag) return;
  _trajGizmoEndDragListeners();
  _trajGizmoStopDragTicker();
  if (_trajGizmoFullTimer) { clearTimeout(_trajGizmoFullTimer); _trajGizmoFullTimer = null; }
  g.dv[g.drag.component] = g.drag.compStart; // revert this drag's delta — zero log mutation
  g.drag = null;
  g.preview = null;
  _trajGizmoRepaintOverlay();
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
  const sceneEl = va && va.querySelector('svg.traj-svg g.traj-scene');
  const layer = sceneEl && sceneEl.querySelector('g.traj-gizmo-preview');
  if (layer) layer.innerHTML = '';
}

// ── R6.2' Phase A item 2: MANEUVER center-drag slides departure time via the
// PRECEDING COAST (transit-corridor convention — a MANEUVER's own duration
// IS the coast that precedes it, per 570's replay comment). Simpler than the
// MNODE ring-snap drag (no closed parking ring to sample against a shifting
// departure point isn't meaningful here): plain px-along-prograde -> dMET via
// the same degenerate-fallback formula the MNODE center-drag already uses,
// scaled by the node's own orbital speed. Commit on release: log surgery
// (extend an existing preceding COAST, or insert a new 'phasing' COAST) ->
// missionRecompute -> render, ONE undo step (matches the drag-commit
// discipline elsewhere in this module).
function _trajGizmoManeuverCenterDown(evt) {
  const g = _trajGizmo;
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
  const svgEl = va && va.querySelector('svg.traj-svg');
  const rect = svgEl && svgEl.getBoundingClientRect();
  const geo = rect && _trajGizmoScreenGeo(g.missionId, rect);
  if (!geo || !rect || !(rect.width > 0)) return;
  const vMagKms = physMag(g.node.v);
  g.centerDrag = { maneuver: true, x0: evt.clientX, y0: evt.clientY, met0: g.met, moved: false, dir: geo.dirs.pro, kmPerPx: geo.cam.wKm / rect.width, vMagKms };
  g.menuOpen = false;
  document.addEventListener('mousemove', _trajGizmoCenterMove);
  document.addEventListener('mouseup', _trajGizmoCenterUp);
}

/** Log surgery for the MANEUVER center-drag commit: `dMetSec` is the signed
 *  MET delta accumulated by the drag (g.met - centerDrag.met0). Clamped >= 0
 *  duration on the preceding COAST (never negative — dragging backward past
 *  the original departure just floors the coast at 0, it can't go negative
 *  and "steal" time from the event before it). If the immediately preceding
 *  log entry isn't a COAST, one is inserted (label 'phasing') with the
 *  dragged duration. */
function _trajGizmoManeuverCommitTimeDrag(dMetSec) {
  const g = _trajGizmo;
  if (!g || g.authIdx == null) return;
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
  if (!m || !m.log[g.authIdx] || !_evIsSolvedManeuver(m.log[g.authIdx])) return;
  const idx = g.authIdx;
  const prev = idx >= 1 ? m.log[idx - 1] : null;
  if (prev && prev.type === 'COAST') {
    prev.days = Math.max(0, (prev.days || 0) + dMetSec / 86400);
  } else {
    const days = Math.max(0, dMetSec / 86400);
    m.log.splice(idx, 0, { type: 'COAST', days, label: 'phasing' });
    g.authIdx = idx + 1; // the MANEUVER shifted down one slot
  }
  missionRecompute(m);
  missionRenderDetail();
}

// ── Drag mechanics — center knob (node TIME) ────────────────────────────────
function _trajGizmoCenterDown(evt) {
  const g = _trajGizmo;
  if (!g || g.drag) return; // handle-drag owns the pointer; center never starts mid-handle-drag
  evt.preventDefault();
  if (g.kind === 'maneuver') { _trajGizmoManeuverCenterDown(evt); return; }
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
  const svgEl = va && va.querySelector('svg.traj-svg');
  const rect = svgEl && svgEl.getBoundingClientRect();
  const geo = rect && _trajGizmoScreenGeo(g.missionId, rect);
  if (!geo || !rect || !(rect.width > 0)) return;
  const vMagKms = physMag(g.node.v);
  // R3.5 item 1: precompute one period's worth of ring samples in SCREEN
  // space (same projection pipeline as the rest of the overlay) so the drag
  // can snap to whichever sample is nearest the cursor (_trajGizmoNearestScreenMet)
  // instead of integrating an incremental px->MET delta along the
  // instantaneous (and constantly rotating) velocity direction — the old
  // approach broke down as soon as the node moved around the curve. Falls
  // back to the old projection method for a degenerate/hyperbolic node
  // (no closed ring to sample).
  const m0 = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
  const period = _trajGizmoOrbitPeriodMet(g.node.mu, g.node.r, g.node.v);
  let ringPts = null;
  if (m0 && period > 0) {
    const N = 64;
    ringPts = [];
    const camCenterKm = _trajCamCenterKm(geo.cam, geo.vt);
    for (let k = 0; k < N; k++) {
      const met = (k / N) * period;
      const node = _trajGizmoNodeState(m0, met, g.authIdx);
      if (!node) continue;
      const bodyWorld = progBodyWorldPosCalibrated(node.body, geo.vt, {});
      if (!bodyWorld) continue;
      const w = { x: bodyWorld.x + node.r[0], y: bodyWorld.y + node.r[1], z: (bodyWorld.z || 0) + (node.r[2] || 0) };
      const p = _trajProj3(w.x - camCenterKm.x, w.y - camCenterKm.y, w.z - (camCenterKm.z || 0));
      const s = _trajWorldToScreen(p.x * geo.zoom, p.y * geo.zoom, { cx: 0, cy: 0, w: _TRAJ_VB }, rect);
      ringPts.push({ x: s.x, y: s.y, met });
    }
  }
  g.centerDrag = { x0: evt.clientX, y0: evt.clientY, met0: g.met, moved: false, dir: geo.dirs.pro, kmPerPx: geo.cam.wKm / rect.width, vMagKms, ringPts, period, rectLeft: rect.left, rectTop: rect.top };
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
  if (cd.maneuver) {
    // R6.2' Phase A item 2: simple px-along-prograde -> dMET, no ring rebuild
    // (see _trajGizmoManeuverCenterDown doc comment) — display-only until
    // release, log surgery happens in _trajGizmoManeuverCommitTimeDrag.
    const pxAlong = dx * cd.dir.ux + dy * cd.dir.uy;
    const dMet = _trajGizmoCenterDragDMet(pxAlong, cd.kmPerPx, cd.vMagKms);
    g.met = Math.max(0, cd.met0 + dMet);
    _trajGizmoRepaintOverlay();
    return;
  }
  let newMet;
  if (cd.ringPts && cd.ringPts.length) {
    // R3.5 item 1: snap to the ring sample nearest the CURSOR (not a
    // projection of the drag delta) — works uniformly in every direction,
    // all the way around the loop. Stay on the same lap (orbit count) the
    // node started on; +1/-1 orbit remains the menu's job.
    const cx = evt.clientX - cd.rectLeft, cy = evt.clientY - cd.rectTop;
    const localMet = _trajGizmoNearestScreenMet(cd.ringPts, cx, cy);
    const lapBase = cd.period > 0 ? Math.floor(cd.met0 / cd.period) * cd.period : 0;
    newMet = Math.max(0, lapBase + (localMet || 0));
  } else {
    // Degenerate/hyperbolic fallback: no closed ring to sample against.
    const pxAlong = dx * cd.dir.ux + dy * cd.dir.uy;
    const dMet = _trajGizmoCenterDragDMet(pxAlong, cd.kmPerPx, cd.vMagKms);
    newMet = Math.max(0, cd.met0 + dMet);
  }
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
  if (cd.maneuver) { _trajGizmoManeuverCommitTimeDrag(g.met - cd.met0); return; }
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
  if (cd.maneuver) {
    g.met = cd.met0; // node/geometry never changed for the maneuver path — just revert the displayed MET
  } else if (m) {
    const node = _trajGizmoNodeState(m, cd.met0, g.authIdx); if (node) { g.met = cd.met0; g.node = node; }
  }
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
  if (g.authIdx != null && m.log[g.authIdx] && _evIsManualBurn(m.log[g.authIdx])) {
    const e = m.log[g.authIdx];
    e.dvPro_ms = g.dv.pro; e.dvRad_ms = g.dv.rad; e.dvNrm_ms = g.dv.nrm;
    missionRecompute(m);
    missionRenderDetail();
  } else if (g.legAuthIdx != null) {
    // R6.2″ (round-3 item 5): mid-leg placement — insert right after the
    // covering leg's own authored event, and stamp the PRE-burn state
    // (g.node.r/v — dv hasn't been added to it) so 565's leg builder flies
    // from this exact recorded point instead of trying (and failing) to
    // reconstruct one from a nonexistent orbitAtBurn.
    const idx = missionExecManeuverNode(g.missionId,
      { value_s: g.met, dvPro_ms: g.dv.pro, dvRad_ms: g.dv.rad, dvNrm_ms: g.dv.nrm },
      { afterAuthIdx: g.legAuthIdx, burnState: { r: g.node.r, v: g.node.v }, burnFrame: g.node.body });
    if (idx != null && m.log[idx] && m.log[idx].type === 'MNODE') g.authIdx = idx;
  } else {
    const idx = missionExecManeuverNode(g.missionId, { value_s: g.met, dvPro_ms: g.dv.pro, dvRad_ms: g.dv.rad, dvNrm_ms: g.dv.nrm });
    if (idx != null && m.log[idx] && m.log[idx].type === 'MNODE') g.authIdx = idx;
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

/** R3.5.1 (correction #2): the handle-drag ticker's per-tick scratch
 *  refresh — cheap-mode only, never arms the full debounce (see
 *  _trajGizmoHandleTick for why: arming it every tick would starve it from
 *  ever firing while a handle is held down). */
function _trajGizmoScheduleScratchCheap() {
  if (_trajGizmoScratchTimer) return;
  _trajGizmoScratchTimer = setTimeout(() => { _trajGizmoScratchTimer = null; _trajGizmoRunScratch('cheap'); }, 100);
}

function _trajGizmoRunScratch(mode) {
  const g = _trajGizmo;
  if (!g) return;
  // Cheap throttle ticks only matter mid-drag. The FULL debounce deliberately
  // fires ~2s AFTER release (drag already null) — it must still run, or the
  // n-body/heliocentric refinement never happens at all (R3.5.2: this guard
  // used to bail for both modes, which is why escape previews never showed).
  if (mode !== 'full' && !g.drag && !g.centerDrag) return;
  const node = g.node;
  const dvVec = physAdd(physAdd(
    physScale(node.vHat, (g.dv.pro || 0) / 1000),
    physScale(node.rHat, (g.dv.rad || 0) / 1000)),
    physScale(node.hHat, (g.dv.nrm || 0) / 1000));
  const state = { r: node.r, v: physAdd(node.v, dvVec) };
  // N1b: full-fidelity tier through the one body-set resolver (contextual =
  // the old ad-hoc list verbatim; 'full' setting unions the whole system).
  const fullBodies = (typeof physBodySetFor === 'function')
    ? physBodySetFor({ center: node.body, kind: 'local' })
    : [...new Set([node.body, (typeof physParentOf === 'function' && physParentOf(node.body)) || 'Sun', 'Sun', node.body === 'Earth' ? 'Moon' : null].filter(Boolean))];
  const cheap = mode !== 'full';
  // N1: the cheap drag tier's one-body list IS the explicit truncation opt-in
  // (MISSION_MODEL_V2 §17 N1) — near-two-body scan quality while dragging;
  // solvers and committed legs never truncate.
  const bodies = cheap ? [node.body] : fullBodies;
  const maxSamples = cheap ? 64 : 128;
  let horizon = 30 * 86400;
  const el = (typeof physStateToElements === 'function') ? physStateToElements(state.r, state.v, node.mu) : null;
  const isEscape = !!el && (!(el.a > 0) || !isFinite(el.period)); // parabolic/hyperbolic result state
  if (el && el.a > 0 && isFinite(el.period)) horizon = Math.min(horizon, Math.max(3 * el.period, 3600));
  // R3.5 item 6: an escaping burn's preview otherwise stopped dead at the SOI
  // exit — physPropagateSegment ALREADY performs the normal SOI handoff into
  // the Sun frame (ctx.bodies includes 'Sun'), the horizon just wasn't long
  // enough to show any of the resulting heliocentric arc (30d default is
  // mostly consumed by the local hyperbolic departure) and the renderer
  // separately discarded any sample not in the node's own body frame (see
  // _trajGizmoRepaintScenePreview). Only extend on the FULL-fidelity pass —
  // cheap mode stays single-frame/short per the fidelity ladder contract.
  if (!cheap && isEscape) horizon = 90 * 86400;
  let maxSamplesFull = (!cheap && isEscape) ? 160 : maxSamples;
  let res = physPropagateSegment(state, g.met, g.met + horizon, { center: node.body, bodies, overrides: {} }, { maxSamples: maxSamplesFull });
  // R3.5.3: extend a full-fidelity escape preview to a full-orbit horizon
  // (shared helper physEscapeHorizonS in 565) so the heliocentric arc reads
  // as a real orbit rather than the flat 90-day quarter-arc.
  if (!cheap && isEscape && typeof physEscapeHorizonS === 'function') {
    const fullHorizon = physEscapeHorizonS(res.samples, horizon);
    if (fullHorizon > horizon) {
      horizon = fullHorizon;
      maxSamplesFull = 256;
      res = physPropagateSegment(state, g.met, g.met + horizon, { center: node.body, bodies, overrides: {} }, { maxSamples: maxSamplesFull });
    }
  }
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
  // R3.5 item 6: draw through the SAME multi-frame polyline builder committed
  // legs use (_trajPolylineSVG + a per-frame anchorOf), instead of the old
  // single-frame loop that silently dropped every sample past an SOI exit —
  // that drop, not the propagation itself, is why an escaping preview used to
  // vanish at the boundary. anchorOf resolves each sample's OWN frame body's
  // drawn position (patched-conic gluing, same convention as committed legs).
  const anchorCache = {};
  const anchorOf = frame => {
    if (anchorCache[frame]) return anchorCache[frame];
    const w = progBodyWorldPosCalibrated(frame, vt, {});
    if (!w) return null;
    const q = _trajProj3(w.x - camCenterKm.x, w.y - camCenterKm.y, (w.z || 0) - (camCenterKm.z || 0));
    return (anchorCache[frame] = { x: q.x * zoom, y: q.y * zoom });
  };
  let html = '';
  if (bodyWorld && g.preview && g.preview.samples && g.preview.samples.length) {
    const poly = _trajPolylineSVG(g.preview, anchorOf, zoom, {});
    if (poly && !poly.hidden && poly.d) {
      html = `<path d="${poly.d}" fill="none" stroke="var(--accent)" stroke-width="1" stroke-dasharray="2.5,2" vector-effect="non-scaling-stroke" opacity="0.85"/>`;
    }
  }
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
