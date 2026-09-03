// ─── MANEUVER GIZMO — pure math (gate-tested) ──────────────────────────────
// Side-effect-free helpers: local orbit-frame axes and Δv decomposition,
// pixel<->Δv mapping and handle magnitudes, center-drag time mapping and orbit
// period, nearest-sample / nearest-screen-MET picking, pull rate, readout
// formatting, and closest-approach / SOI-entry / preview-fidelity helpers.
// No DOM or render state.

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

/** Nearest point (by squared
 *  screen-px distance) in a precomputed ring-sample array `pts` (each
 *  {x,y,met}, screen px) to a cursor position (x,y). Returns that sample's
 *  met, or null for an empty array. Replaces the old incremental
 *  velocity-projection center-drag (which broke down as the node moved
 *  around the curve and the local v̂ rotated away from the drag direction —
 *  with KSP-style "grab and slide anywhere on the
 *  rails" behavior: the node always snaps to whichever ring sample is
 *  physically closest to the cursor, so dragging works uniformly in every
 *  direction and around the full loop. Pure. */
function _trajGizmoNearestScreenMet(pts, x, y) {
  const p = _trajRailNearestPoint(pts, x, y);
  return p ? p.met : null;
}



/** The
 *  zero-cross clamp above FELT wrong in practice — real KSP lets a held
 *  handle's pull set a continuous RATE of change, and pulling the opposite
 *  handle just drains the component through zero and keeps going negative
 *  (no stop-at-zero). `_trajGizmoDragComponentValue`/`_trajGizmoClampCross`
 *  are kept but are NO LONGER on the live drag
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

/** Split a sampled ring polyline (array of {x,y} render/screen
 *  points, in DIRECTION-OF-MOTION order) into `nSeg` contiguous segments with
 *  opacity ramping from `floor` (trailing/behind) to 1.0 (leading edge) — KSP's
 *  "fade behind the direction of travel" cue. `floor` defaults to 0.25 (the
 *  unselected-ring fade); the SELECTED ring passes a higher floor (~0.45,
 *  5743's _trajRingSVG) so the trailing 3/4 of a close-zoomed selected orbit
 *  never fades to near-invisible over a bright day-side globe (user-reported
 *  round 2 — the previous 0.25 floor read as "color floating over
 *  black" once the casing pass was also toned down). Returns
 *  [{pts:[{x,y},...], opacity}], oldest/faintest segment first. Empty/1-point
 *  input -> []. Pure — caller supplies already-projected points and does the
 *  actual SVG emission. */
function _trajRingDirSegments(pts, nSeg, floor) {
  if (!pts || pts.length < 2) return [];
  const n = Math.max(1, nSeg || 8);
  const f = floor != null ? floor : 0.25;
  const totalEdges = pts.length - 1;
  const segLen = Math.max(1, Math.floor(totalEdges / n));
  const segs = [];
  for (let s = 0; s < n; s++) {
    const startIdx = s * segLen;
    const endIdx = (s === n - 1) ? totalEdges : Math.min(totalEdges, (s + 1) * segLen);
    if (endIdx <= startIdx) continue;
    const opacity = f + ((1 - f) * s) / Math.max(1, n - 1);
    segs.push({ pts: pts.slice(startIdx, endIdx + 1), opacity });
  }
  return segs;
}

/** Nearest sample (by |t - targetT|) in a physics leg's `samples` array;
 *  returns that sample's MET, or null for an empty array. Used both for
 *  "spawn a node on a physics polyline" (targetT = current view time — a
 *  documented simplification of "nearest to the click point" that avoids an
 *  inverse-projection of the click pixel back into world/sample space;
 *  And is generically reusable. Pure. */
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
  const rails = railFn || physBodyStateAt;
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

