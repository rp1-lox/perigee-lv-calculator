// ─────────────────────────────────────────────────────────────────────────────
// 5742-trajectory-overlay-lod.js — Overlay projection, label registry, LOD & occlusion
//
// OWNS: the world->screen overlay projection (_trajWorldToScreen); the px-native
//   label/marker registry and its collision-resolved layout (_trajLabelRegistry,
//   _trajResetLabels, _trajRegisterLabel, _trajResolveLabels, _trajTextWidthPx);
//   the level-of-detail priority/window model (_TRAJ_LOD_PRI, _TRAJ_LOD_*_MIN,
//   _TRAJ_LOD_WIN, _trajWindowHi) and viewport culling (_trajCullRingByDiagonal,
//   _trajCullByExtent, _trajCullPositionOffscreen); ring orientation + apse helpers
//   (_trajRingOrientationFor, _trajApsePoints, _trajFmtApseDist); and body occlusion
//   (_trajOccludeBodies, _trajPointOccluded, _trajOcclusionSplitRuns).
// This is the OVERLAY (px-native symbology) half of the two-layer render contract;
//   the WORLD (geometry, render-units) half lives in the rings/legs + globe modules.
// Does NOT own: the projection SEAM itself (_trajProjectVec -> 5740-trajectory-camera.js).
// Split out of 574-trajectory-view.js (behavior-preserving move). Definitions/decls
//   only (no load-time execution); load order among 574x def-only modules is irrelevant.
// ─────────────────────────────────────────────────────────────────────────────
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
    // V1 label restyle (MISSION_MODEL_V2 §18): small uppercase, letter-spaced,
    // dimmed until hover/selection, with a short leader tick from the anchor
    // point up to the text plate (match the NASA Eyes reference). Uppercasing
    // is done via CSS text-transform (not l.text.toUpperCase()) so the plate
    // width computed above from the ORIGINAL text stays the sizing basis —
    // uppercase glyphs read slightly wider, so the plate keeps a hair of
    // breathing room rather than clipping.
    const dimF = c.selected ? 1 : 0.62;
    const groupOp = (c.opacity * dimF) < 1 ? ` opacity="${(c.opacity * dimF).toFixed(3)}"` : '';
    const textLines = c.lines.map(l => `<text x="${sx.toFixed(2)}" y="${(sy + l.dy).toFixed(2)}" text-anchor="${c.anchor}" font-family="var(--mono)" font-size="${l.fontPx}" letter-spacing="0.6" style="text-transform:uppercase" fill="${l.color}">${l.text}</text>`).join('');
    const plate = `<rect x="${plateX.toFixed(2)}" y="${plateY.toFixed(2)}" width="${plateW.toFixed(2)}" height="${plateH.toFixed(2)}" fill="var(--panel-tint-plate)" rx="2"/>`;
    const tickColor = c.lines[0].color;
    const tickDir = c.lines[0].dy < 0 ? -1 : 1; // short stub pointing from the anchor toward the label
    const tickLen = Math.min(5, Math.abs(by2 - by1) / 2 + 1);
    const leaderTick = `<line x1="${sx.toFixed(2)}" y1="${sy.toFixed(2)}" x2="${sx.toFixed(2)}" y2="${(sy + tickDir * tickLen).toFixed(2)}" stroke="${tickColor}" stroke-width="0.5" opacity="0.5"/>`;
    out += `<g${groupOp}>${leaderTick}${plate}${textLines}</g>`;
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
