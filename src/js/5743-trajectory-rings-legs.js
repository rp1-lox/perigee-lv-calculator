// ─────────────────────────────────────────────────────────────────────────────
// 5743-trajectory-rings-legs.js — World-layer ring, transfer-arc, and leg rendering
//
// OWNS: the render-unit (geometry) drawing of orbit rings (_trajRingSVG,
//   _trajPropagatedRingSVG), schematic transfer arcs (_trajTransferArcPath,
//   _trajArcProjectedPath, _trajArcRotationForTarget, _trajArcPointAt,
//   _trajLegPathFraction), physics-propagated legs (_trajPolylineSVG,
//   _trajPolylinePointAt, _trajPhysClipT, _trajPhysInjectionLegFor,
//   _trajMnodeLegsSVG, _trajPhysLegRender), hyperbolic escape spurs
//   (_trajEscapeSpurSVG), and the size->opacity LOD ramp (_trajLodOpacity).
// This is the WORLD (geometry) half of the two-layer contract; symbology it emits
//   is registered to the overlay via helpers in 5742-trajectory-overlay-lod.js.
// Does NOT own: event-node markers/burn glyphs (still in core for now), body
//   globes/surfaces, camera, or scene extraction.
// Split out of 574-trajectory-view.js (behavior-preserving move). Definitions only
//   (no load-time execution); load order among 574x def-only modules is irrelevant.
// ─────────────────────────────────────────────────────────────────────────────
function _trajRingSVG(rec, body, scale, color, opts) {
  opts = opts || {};
  const zoom = opts.zoom || 1;
  const viewportDiagPx = opts.viewportDiagPx || Infinity;
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  const emphasized = !!opts.emphasized;
  // V1 line restyle (MISSION_MODEL_V2 §18): the ACTIVE/selected ring keeps its
  // vehicle/zone color at full weight; every other ring drops to a thin
  // desaturated near-white low-alpha line (neutral scrim, exempt from theme
  // chroma per CLAUDE.md) so the reference reads as "space with lit objects"
  // rather than a wall of colored rings.
  const strokeColor = emphasized ? (color || (rec.colors.size === 1 ? [...rec.colors][0] : 'var(--accent)')) : 'rgba(255,255,255,0.42)';
  const strokeW = emphasized ? 1.4 : 0.6;
  const baseOpacity = emphasized ? 1 : 0.5;
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
  // V1 line restyle (MISSION_MODEL_V2 §18): the ACTIVE/selected ring keeps its
  // vehicle/zone color at full weight; every other ring drops to a thin
  // desaturated near-white low-alpha line (neutral scrim, exempt from theme
  // chroma per CLAUDE.md) so the reference reads as "space with lit objects"
  // rather than a wall of colored rings.
  const strokeColor = emphasized ? (color || (rec.colors.size === 1 ? [...rec.colors][0] : 'var(--accent)')) : 'rgba(255,255,255,0.42)';
  const strokeW = emphasized ? 1.4 : 0.6;
  const baseOpacity = emphasized ? 1 : 0.5;
  const historyMul = opts.historyAlpha != null ? opts.historyAlpha : 1;
  const names = [...rec.names].join(', ');
  const title = `${names ? names + ' — ' : ''}${rec.label} (propagated)`;
  const ox = opts.originX || 0, oy = opts.originY || 0;
  // N3: non-inertial frames draw the LIVE loop from raw (un-rebased) samples,
  // each transformed at its own epoch below — this is what closes the ring in
  // the rotating frame at any viewT (retires MATH.md critique 64). Inertial
  // keeps the existing seed-epoch-rebased shape (byte-identical, zero
  // regression) since refOrbitSamplePropagated already IS the frame-frozen
  // shape that transform is a no-op for.
  const liveFrame = _trajProjCtx.frameKind && _trajProjCtx.frameKind !== 'inertial' && typeof refOrbitSamplePropagatedRaw === 'function';
  const raw = liveFrame ? refOrbitSamplePropagatedRaw(rec.refId, 96) : refOrbitSamplePropagated(rec.refId, 96);
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
    const qRaw = _trajProj3(p[0], p[1], p[2], raw[k].t);
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
    const q = _trajProj3(s.r[0], s.r[1], s.r[2] || 0, s.t); // R2: samples are 3D (Moon-frame patches carry real z); N3: sample's OWN epoch
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
