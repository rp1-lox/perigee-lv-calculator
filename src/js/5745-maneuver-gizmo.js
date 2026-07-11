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

/** R6.2' Phase A: decompose a Δv vector (km/s, inertial/center frame) into
 *  the local (v̂, r̂, ĥ) basis, in m/s — the same basis _trajGizmoAxes builds
 *  and physAimBurnState used to construct the vector in the first place.
 *  Pure dot-product projection (the basis is orthonormal so this is exact
 *  regardless of which theta the basis was reconstructed at); used to show a
 *  solved MANEUVER's Δv on the gizmo's pro/rad/nrm handles. Returns
 *  {pro,rad,nrm} (m/s) or {pro:0,rad:0,nrm:0} for a degenerate/null input. */
function _trajGizmoDecomposeDv(dvVecKms, axes) {
  if (!dvVecKms || !axes) return { pro: 0, rad: 0, nrm: 0 };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    pro: dot(dvVecKms, axes.vHat) * 1000,
    rad: dot(dvVecKms, axes.rHat) * 1000,
    nrm: dot(dvVecKms, axes.hHat) * 1000,
  };
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

/** R3.5 (2026-07-10, user flight-test item 1): nearest point (by squared
 *  screen-px distance) in a precomputed ring-sample array `pts` (each
 *  {x,y,met}, screen px) to a cursor position (x,y). Returns that sample's
 *  met, or null for an empty array. Replaces the old incremental
 *  velocity-projection center-drag (which broke down as the node moved
 *  around the curve and the local v̂ rotated away from the drag direction —
 *  see PHYSICS_PLAN R3.5) with KSP-style "grab and slide anywhere on the
 *  rails" behavior: the node always snaps to whichever ring sample is
 *  physically closest to the cursor, so dragging works uniformly in every
 *  direction and around the full loop. Pure. */
function _trajGizmoNearestScreenMet(pts, x, y) {
  if (!pts || !pts.length) return null;
  let best = Infinity, bestMet = pts[0].met;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - x, dy = pts[i].y - y;
    const d = dx * dx + dy * dy;
    if (d < best) { best = d; bestMet = pts[i].met; }
  }
  return bestMet;
}

/** R3.5 (item 4): single-tick zero-cross clamp — given a component's value
 *  at the START of the current drag (`prev`) and the raw candidate value for
 *  this tick (`next`), returns 0 if `next` would cross to the opposite sign
 *  of `prev` (a drag that pulls an existing +component back through zero
 *  stops AT zero rather than silently continuing negative — KSP-style;
 *  matching or same-sign values, and any candidate once `prev` is already 0,
 *  pass through unchanged). See _trajGizmoDragComponentValue for how this
 *  composes with a handle's own-direction floor. Pure. */
function _trajGizmoClampCross(prev, next) {
  if ((prev > 0 && next < 0) || (prev < 0 && next > 0)) return 0;
  return next;
}

/** R3.5 (item 4): full per-tick drag-component value, combining the
 *  zero-cross clamp above with the R3.4 "a handle only ever pushes its OWN
 *  side" floor (a "+" handle's sign is +1: the result is never allowed
 *  negative; a "-" handle's sign is -1: never allowed positive). `compStart`
 *  is the component's RAW signed value at drag-start (may belong to the
 *  opposite handle, e.g. +50 when grabbing retro) — using the raw value
 *  (rather than always starting a freshly-grabbed handle from 0) is what
 *  makes an opposite-handle grab drain the existing value down to zero and
 *  stop there for the rest of THIS drag, instead of jumping straight to a
 *  negative value; releasing and re-grabbing starts a new drag with
 *  compStart already at 0, which is when it's free to build the opposite
 *  sign. Pure. */
function _trajGizmoDragComponentValue(compStart, sign, deltaDv) {
  const raw = (compStart || 0) + sign * (deltaDv || 0);
  const crossClamped = _trajGizmoClampCross(compStart || 0, raw);
  return sign > 0 ? Math.max(0, crossClamped) : Math.min(0, crossClamped);
}

/** R3.5.1 (2026-07-10, correction #2, user flight-test on R3.5 item 4): the
 *  zero-cross clamp above FELT wrong in practice — real KSP lets a held
 *  handle's pull set a continuous RATE of change, and pulling the opposite
 *  handle just drains the component through zero and keeps going negative
 *  (no stop-at-zero). `_trajGizmoDragComponentValue`/`_trajGizmoClampCross`
 *  are kept (still gate-pinned below) but are NO LONGER on the live drag
 *  path — see _trajGizmoHandleTick, which now integrates this rate instead.
 *  `pullPx` is the drag displacement projected onto the handle's own
 *  outward axis, already floored to >= 0 by the caller (pushing back toward
 *  the node = zero rate, never a negative pull). Ramp is a tunable
 *  power curve — smooth near 0, steepening with distance — scaled 0.1x with
 *  Shift (fine control), matching the old px-to-dv gain's fine-control
 *  ratio. Pure. */
const _TRAJ_GIZMO_RATE_MS_PER_S = 20; // m/s per second of hold, at a 40px pull (tunable)
function _trajGizmoPullRate(pullPx, shiftHeld) {
  const p = Math.max(0, pullPx || 0);
  const base = _TRAJ_GIZMO_RATE_MS_PER_S * Math.pow(p / 40, 1.5);
  return shiftHeld ? base * 0.1 : base;
}

/** R3.5 (item 2): split a sampled ring polyline (array of {x,y} render/screen
 *  points, in DIRECTION-OF-MOTION order) into `nSeg` contiguous segments with
 *  opacity ramping from ~0.25 (trailing/behind) to 1.0 (leading edge) — KSP's
 *  "fade behind the direction of travel" cue. Returns
 *  [{pts:[{x,y},...], opacity}], oldest/faintest segment first. Empty/1-point
 *  input -> []. Pure — caller supplies already-projected points and does the
 *  actual SVG emission. */
function _trajRingDirSegments(pts, nSeg) {
  if (!pts || pts.length < 2) return [];
  const n = Math.max(1, nSeg || 8);
  const totalEdges = pts.length - 1;
  const segLen = Math.max(1, Math.floor(totalEdges / n));
  const segs = [];
  for (let s = 0; s < n; s++) {
    const startIdx = s * segLen;
    const endIdx = (s === n - 1) ? totalEdges : Math.min(totalEdges, (s + 1) * segLen);
    if (endIdx <= startIdx) continue;
    const opacity = 0.25 + (0.75 * s) / Math.max(1, n - 1);
    segs.push({ pts: pts.slice(startIdx, endIdx + 1), opacity });
  }
  return segs;
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
  // R6.1.2: the actual math (mean-anomaly circular reconstruction via
  // physAimBurnState) is factored out to _trajGizmoOrbitNodeAt so a ring
  // hover/click-menu can share the identical rail without a gizmo attached.
  return _trajGizmoOrbitNodeAt(o, met);
}

/** R6.2' Phase A: departure-state reconstruction for an EXISTING MANEUVER log
 *  entry (as opposed to MNODE's own recorded orbitAtBurn). No side-table
 *  entry records the exact departure r/v basis physSolveNodeBurn/the P4
 *  shooter actually flew (only the solved dvVec, in 565's leg record) — so
 *  per PHYSICS_PLAN's documented fallback, this reconstructs from the
 *  fromNode's authored orbit at the maneuver's own MET via the SAME
 *  mean-anomaly rail _trajGizmoOrbitNodeAt/_trajGizmoNodeState already use
 *  for MNODE. The reconstructed basis is internally consistent (orthonormal)
 *  so decomposing the leg's real dvVec against it is exact in magnitude even
 *  though the absolute burn POINT (theta) may differ slightly from what the
 *  shooter actually flew — a presentation-layer simplification, not a
 *  physics change (ΔV accounting is untouched: it still comes from
 *  progNmComputeEdgeDv via the leg, never recomputed here). Returns the same
 *  shape as _trajGizmoNodeState, or null. */
function _trajGizmoManeuverNodeState(m, e) {
  if (!e || !_evIsSolvedManeuver(e) || !e.fromNode) return null;
  const fromN = (typeof _missionNmNodeById === 'function') ? _missionNmNodeById(e.fromNode) : null;
  const o = fromN && fromN.orbit;
  if (!o) return null;
  const met = e.metStart != null ? e.metStart : 0;
  return _trajGizmoOrbitNodeAt(o, met);
}

/** R6.2' Phase A: look up the solved Δv (leg.dvVec, km/s) for a MANEUVER's
 *  physics leg in the mission's side-table (_physTrajByMission, 565 — the
 *  ONLY sanctioned source for this vector), decomposed into (pro,rad,nrm)
 *  m/s against `node`'s local basis. Returns null if the leg hasn't been
 *  computed yet (physics off, or not yet recomputed). Pure lookup + the pure
 *  decompose helper above — no math performed here beyond that call. */
function _trajGizmoManeuverSolvedDv(missionId, authIdx, node) {
  if (!node) return null;
  const rec = (typeof _physTrajByMission !== 'undefined') ? _physTrajByMission[missionId] : null;
  const leg = rec && rec.legs && rec.legs.find(l => l.authIdx === authIdx);
  if (!leg || !leg.dvVec) return null;
  const axes = _trajGizmoAxes(node.r, node.v);
  if (!axes) return null;
  return _trajGizmoDecomposeDv(leg.dvVec, axes);
}

/** R3.4 target selection for the closest-approach pair: scan the mission log
 *  for the next MANEUVER after `met` whose destination node names a body
 *  different from the node's own body; else fall back to the Moon for
 *  Earth-centric nodes (a sensible default per PHYSICS_PLAN R3.4 item 4);
 *  else null (no CA pair shown). */
function _trajGizmoPickTarget(m, node, met) {
  if (!m || !node) return null;
  // Round 2 item 3: explicit target wins over the heuristics — first a
  // runtime pick from clicking a body glyph while the gizmo is open (session
  // state, not persisted), then an authored `caTarget` field on the MNODE
  // log entry set via its event-card dropdown (persisted, since it's
  // authored state on the event, same as any other MNODE field).
  const g = (typeof _trajGizmo !== 'undefined') ? _trajGizmo : null;
  if (g && g.manualTarget) {
    if (g.manualTarget === node.body) return null; // can't target your own body
    return g.manualTarget;
  }
  if (g && g.authIdx != null && m.log[g.authIdx]) {
    const ct = m.log[g.authIdx].caTarget;
    if (ct && ct !== 'auto' && ct !== node.body) return ct;
  }
  if (typeof _missionNmNodeById === 'function') {
    for (const e of m.log || []) {
      if (!_evIsSolvedManeuver(e) || !e.toNode) continue;
      if ((e.metStart != null ? e.metStart : 0) < met) continue; // only look forward from the node
      const n = _missionNmNodeById(e.toNode);
      if (n && n.body && n.body !== node.body) return n.body;
    }
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
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
  if (!m) return;
  const node = _trajGizmoNodeState(m, met, null);
  if (!node) return;
  _trajGizmo = { missionId: id, met, authIdx: null, kind: 'mnode', dv: { pro: 0, rad: 0, nrm: 0 }, node, drag: null, centerDrag: null, menuOpen: false, preview: null, ca: null };
  document.addEventListener('keydown', _trajGizmoKeydown);
  _trajGizmoAddDismissListeners();
  missionRenderDetail();
}

function _trajGizmoOpenExisting(id, authIdx) {
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
  if (!m || !m.log[authIdx]) return;
  let e = m.log[authIdx];
  // R6.2' Phase B (3b): touching (opening) a legacy MANEUVER — or an old
  // Phase-A detachedFrom-carrying MNODE — lazy-migrates it to the unified
  // schema in place before the gizmo reads it. A migration that only ADDS
  // fields (type/mode/target on a MANEUVER; target on a detachedFrom MNODE)
  // doesn't change accounting, so it's not itself an undo-worthy edit — no
  // recompute/undo capture here, just like opening an untouched MNODE is a
  // no-op today.
  if (typeof _missionMigrateManeuverEntry === 'function') _missionMigrateManeuverEntry(e);
  if (_evIsSolvedManeuver(e)) {
    // dblclicking a solved maneuver (legacy MANEUVER shim, or unified
    // MNODE mode:'solved') opens the SAME gizmo, showing the leg's solved Δv
    // on the handles (kind:'maneuver'). The gizmo starts attached (authIdx
    // set) but the log entry's MODE is untouched until the first handle drag
    // flips it to 'manual' (see _trajGizmoHandleDown/_trajGizmoDetachManeuverIfNeeded)
    // — so opening/closing without dragging is a no-op, same as inspecting
    // an MNODE without touching a handle.
    const node = _trajGizmoManeuverNodeState(m, e);
    if (!node) return;
    const met = e.metStart != null ? e.metStart : 0;
    const solved = _trajGizmoManeuverSolvedDv(id, authIdx, node) || { pro: 0, rad: 0, nrm: 0 };
    const tgt = _evManeuverTarget(e);
    const toN = (typeof _missionNmNodeById === 'function' && tgt) ? _missionNmNodeById(tgt.toNode) : null;
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

// R3.5.2 (user flight-test): dismiss affordances beyond Escape — left-click
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
  if (typeof _trajJustDragged !== 'undefined' && _trajJustDragged) return;
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

function _trajGizmoClose() {
  if (!_trajGizmo) return;
  if (_trajGizmoFullTimer) { clearTimeout(_trajGizmoFullTimer); _trajGizmoFullTimer = null; }
  document.removeEventListener('keydown', _trajGizmoKeydown);
  _trajGizmoRemoveDismissListeners();
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
  // R6.2' Phase A item 1: a MANEUVER leg/marker dblclick opens the SAME
  // gizmo at the maneuver's solved state (_trajGizmoOpenExisting), instead
  // of the "spawn a pending MNODE at the nearest sample" behavior below
  // (which remains the fallback for other physics-leg dblclicks, e.g. an
  // arrival/exiting-corridor leg with no MANEUVER of its own at this index).
  if (m.log[authIdx] && _evIsSolvedManeuver(m.log[authIdx])) { _trajGizmoOpenExisting(id, authIdx); return; }
  const rec = (typeof _physTrajByMission !== 'undefined') ? _physTrajByMission[id] : null;
  const leg = rec && rec.legs && rec.legs.find(l => l.authIdx === authIdx);
  const vt = _trajViewTime(m);
  const met = (leg && leg.samples && leg.samples.length) ? _trajGizmoNearestSampleMet(leg.samples, vt) : vt;
  _trajGizmoOpenPending(id, met != null ? met : vt);
}

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
  const incRad = ((o.inclination || 0) * Math.PI) / 180;
  const raan = o.lan != null ? (o.lan * Math.PI) / 180 : 0;
  const bs = physAimBurnState(o.body, rMean, theta, 0, 0, incRad, 0, raan);
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
  _trajRingMenuClose();
  _trajGizmoOpenPending(id, met);
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

/** R3.5.1 (2026-07-10, correction #1): KSP navball-style glyph for a handle
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
      // R3.5.1 (2026-07-10, correction #1): back to a circular knob (the
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
  if (!sib) return;
  if (sib.tagName === 'g') {
    // R3.5.1 (correction #1): the glyph group scales up around its own
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
    const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
    const le = m && m.log[g.authIdx];
    // Solved check FIRST: a unified MNODE(mode:'solved') is still type
    // 'MNODE' at the storage level, so testing le.type alone would
    // misclassify a still-solved gizmo as 'mnode' kind before ever reaching
    // the maneuver branch below.
    if (le && _evIsSolvedManeuver(le) && g.kind === 'maneuver') {
      // still-solved maneuver (not yet detached) — re-derive the solved Δv
      // in case an upstream edit (e.g. a preceding COAST commit) recomputed
      // the leg with a new magnitude/state.
      const node = _trajGizmoManeuverNodeState(m, le);
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
  // R6.2' Phase A item 4: a detached MNODE (has detachedFrom on the log
  // entry) gets a re-solve action right in the gizmo flyout, mirroring the
  // MNODE card's button (570).
  const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === g.missionId);
  const le = m && g.authIdx != null ? m.log[g.authIdx] : null;
  const resolveBtn = (le && _evIsManualBurn(le) && (le.target || le.detachedFrom))
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
  if (g.authIdx != null && m.log[g.authIdx] && _evIsManualBurn(m.log[g.authIdx])) {
    m.log[g.authIdx].at = { kind: 'met', value_s: newMet };
    missionRecompute(m);
    missionRenderDetail();
  } else {
    _trajGizmoRepaintOverlay();
  }
}

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
  if (typeof _missionMigrateManeuverEntry === 'function') _missionMigrateManeuverEntry(e); // no-op if already unified
  e.mode = 'manual';
  e.at = { kind: 'met', value_s: g.met };
  e.dvPro_ms = g.dv.pro; e.dvRad_ms = g.dv.rad; e.dvNrm_ms = g.dv.nrm;
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
  const parent = typeof physParentOf === 'function' ? physParentOf(node.body) : null;
  const fullBodies = [...new Set([node.body, parent || 'Sun', 'Sun', node.body === 'Earth' ? 'Moon' : null].filter(Boolean))];
  const cheap = mode !== 'full';
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
