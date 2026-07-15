// ─────────────────────────────────────────────────────────────────────────────
// 5744-trajectory-globe.js — Body discs, surfaces, textures, raster globes, 3D rings
//
// OWNS: everything that draws a body as more than a schematic dot — the disc-size
//   tiering (_TRAJ_MIN_BODY_PX, _trajBodyPxR, _TRAJ_SURFACE_PX/_CHIP/_FEATURE tiers,
//   _trajBodyDiscTiered); reference-frame basis/transform used for spin & surfaces
//   (_trajFrameBasisAt, _trajFrameTransform, _trajFrame, trajSetFrame, _TRAJ_FRAME_KINDS,
//   _trajFrameByMission); surface geometry (_trajSurfacePoint, hemisphere clipping,
//   geo polygons/ellipses, spin _trajSpinRotate/_trajBodySpinAngle); atmosphere, limb
//   gradient and terminator (_trajAtmosphereGlowSVG, _trajLimbGradientDef,
//   _trajTerminatorNightPath, _trajSurfacedDiscSVG); the texture + cloud stores and
//   bilinear-sampled raster globe pipeline (_trajTexStore, _trajTextureFor,
//   _trajCloudTextureFor, _trajBilinearSample, _trajRasterGlobe, _trajRasterCache,
//   _trajRasteredDiscDataURL, prewarm/idle/repaint scheduling, _trajReconcileGlobeLayer);
//   and the projected 3D ring system (_TRAJ_RING_OBLIQUITY_DEG, _trajRingPlaneBasis,
//   _trajRingAngleRuns, _trajRingBandRunPath, _trajRingsSVG). _TRAJ_SVG_NS lives here.
// Does NOT own: schematic body glyphs (_trajGlyph stays in core), event nodes (5744-
//   trajectory-eventnodes.js), ring/leg *orbit* geometry (5743), camera (5740).
// Split out of 574-trajectory-view.js (behavior-preserving move). Definitions/decls
//   only (no load-time execution); load order among 574x def-only modules is irrelevant.
// ─────────────────────────────────────────────────────────────────────────────

// Minimum on-screen disc radius (px) a body should ever render at, converted
// to WORLD-space svg units by dividing by zoom (so after the viewBox camera's
// zoom, the rendered px is >= _TRAJ_MIN_BODY_PX). This clamp is legitimately
// world-layer: it's a size floor on GEOMETRY (the disc itself), computed from
// the camera's pxPerUnit, not a counter-scaled annotation. True-scale discs
// bigger than this pass through unclamped (e.g. zoomed into LEO, Earth's limb
// stays huge and real).
const _TRAJ_MIN_BODY_PX = 6;
// Returns the disc radius in RENDER UNITS (km·zoom ≈ px): true-scale when
// zoomed in, clamped to the min-px floor when zoomed out. (Pre-normalization
// this returned km and callers multiplied by zoom for px math.)
function _trajBodyPxR(trueR, zoom) {
  const z = zoom || 1;
  return Math.max(trueR * z, _TRAJ_MIN_BODY_PX);
}

// ── R6.2: planetary surface rendering + body LOD ladder ────────────────────
// Three tiers by TRUE (unclamped) apparent screen radius (trueR_km * zoom):
//   >= _TRAJ_SURFACE_PX : surfaced disc — base color + coastlines/maria/region
//                          ellipses/cloud bands + a limb-darkening overlay.
//   >= _TRAJ_CHIP_PX     : plain clamped disc (pre-existing behavior, unchanged
//                          — _trajBodyPxR's Math.max floor already holds a
//                          CONSTANT _TRAJ_MIN_BODY_PX screen size as trueR*zoom
//                          shrinks below the floor).
//   <  _TRAJ_CHIP_PX      : symbol chip — constant-radius outlined circle +
//                          astronomical glyph (deep zoom-out, e.g. heliocentric).
// Cross-fade is NOT implemented (a clean pop at each threshold, per spec).
const _TRAJ_SURFACE_PX = 24;
const _TRAJ_CHIP_PX = 2;
const _TRAJ_CHIP_R = 7; // constant screen radius (px/render-unit) for the chip tier
// R6.2.1: middle plain-disc tier removed (flight-test item 2) — the surfaced
// disc now renders all the way down to the chip threshold. Below this radius
// (px) the surfaced disc skips vector feature sampling (base fill + limb
// gradient only — visually indistinguishable at that size, and keeps the
// per-point path-string cost bounded at small sizes).
const _TRAJ_FEATURE_PX = 14;

// Astronomical glyphs — reuses the same symbols as the Orbits page destination
// picker (060-orbit-categories.js ORBIT_CATEGORIES icons) for Earth/Moon/Mars/
// Venus/Mercury/Jupiter/Saturn/Uranus/Neptune so a body reads the same symbol
// everywhere in the app; Sun/Titan added here (no picker entry exists for them).
const _TRAJ_BODY_GLYPH = {
  Sun: '☉', Mercury: '☿', Venus: '♀', Earth: '⊕', Moon: '☽',
  Mars: '♂', Jupiter: '♃', Saturn: '♄', Uranus: '♅', Neptune: '♆', Titan: 'T',
};

// Body true physical radius (km) for LOD apparent-size math. Sun's value
// (696,000 km, IAU mean) is display-schematic only — the Sun still renders
// through its own plain-glyph path (_trajGlyph), never this ladder.
function _trajTrueBodyRadiusKm(body) {
  if (body === 'Sun') return 696000;
  return (typeof PROG_BODIES !== 'undefined' && PROG_BODIES[body] && PROG_BODIES[body].R) || 3;
}

// lat/lon (deg) -> unit-sphere point in the body's OWN unrotated frame
// (lon measured east from the body's lon=0 meridian, +z = spin axis).
// APPROXIMATION (2026-07-10, presentation layer only — see MATH.md §7g): no
// body's axial tilt is modeled; every spin axis is assumed coincident with
// the ecliptic normal (+z world axis), so this is a simplified top-down
// globe, not a true axial-tilt globe.
function _trajLatLonUnit(latDeg, lonDeg) {
  const lat = latDeg * _PROG_D2R, lon = lonDeg * _PROG_D2R;
  const cl = Math.cos(lat);
  return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
}
// Rotate a unit-sphere body-frame point by spin angle (rad) about the +z
// (ecliptic-normal) axis, giving its WORLD-frame direction.
function _trajSpinRotate(pt, spinRad) {
  const c = Math.cos(spinRad), s = Math.sin(spinRad);
  return [pt[0] * c - pt[1] * s, pt[0] * s + pt[1] * c, pt[2]];
}
// Body spin angle (rad) at mission time viewT_s. Earth/Mars: sidereal
// rotation from viewT with a fixed (uncalibrated — display flavor only, not
// tied to a real prime-meridian epoch) offset of 0. Moon: tidally locked —
// its nearside meridian (lon 0) is kept facing Earth via the Moon's own
// orbital position angle about Earth (+ π, since progBodyAngleAt gives the
// Earth->Moon direction and the nearside must face the opposite way, Moon-
// >Earth). Other bodies: 0 (no vector surface features drawn for them).
function _trajBodySpinAngle(body, viewT_s) {
  const t = viewT_s || 0;
  if (body === 'Earth') return (t / 86164.1) * 2 * Math.PI;
  if (body === 'Mars') return (t / 88642.66) * 2 * Math.PI;
  if (body === 'Moon' && typeof progBodyAngleAt === 'function') return progBodyAngleAt('Moon', t) + Math.PI;
  return 0;
}

// ── §17 N3 — switchable reference frames (pure rendering transform) ────────
// See MATH.md §7x for the full derivation. Frame kinds:
//   'inertial'            — today's rendering, B = null (identity, skipped).
//   'body-fixed'          — B(t) = rotation about the anchor body's spin axis
//                            by its OWN spinAngle(t) (same source the globes
//                            use, _trajBodySpinAngle) — so a surface point's
//                            world position (which is ALSO spin(t)-rotated)
//                            transforms back to its constant body-local
//                            direction: the globe stops turning on screen.
//   'earth-moon-rotating' — B(t) from the Earth->Moon line (_refRotBasisPair,
//                            425; identical math to the N2 wrap/harness).
//   'sun-earth-rotating'  — same construction for the Sun->Earth pair.
// `body` is the frame's ANCHOR (passed from the camera's anchorBody so
// body-fixed knows whose spin to use; earth-moon/sun-earth ignore it — the
// pair is fixed by the frame choice, only the render CENTER varies, and the
// center is already handled by the existing floating-origin camCenter
// subtraction upstream of this transform).
function _trajFrameBasisAt(frameKind, body, t) {
  if (!frameKind || frameKind === 'inertial') return null;
  if (frameKind === 'body-fixed') {
    const a = (typeof _trajBodySpinAngle === 'function') ? _trajBodySpinAngle(body, t) : 0;
    const c = Math.cos(a), s = Math.sin(a);
    return { xh: [c, s, 0], yh: [-s, c, 0], zh: [0, 0, 1] };
  }
  if (frameKind === 'earth-moon-rotating' && typeof _refRotBasisPair === 'function') {
    return _refRotBasisPair('Earth', 'Moon', t);
  }
  if (frameKind === 'sun-earth-rotating' && typeof _refRotBasisPair === 'function') {
    return _refRotBasisPair('Sun', 'Earth', t);
  }
  return null;
}
// q(t) = B(t)^T . pRel(t) — pRel EXPRESSED IN FRAME COORDINATES AT ITS OWN
// EPOCH, fed directly to the camera projector (_trajProjectVec). This is the
// az-convention choice documented in MATH.md §7x: the projector's az/el rotate
// the FRAME's axes, not fixed ecliptic-world axes, when a non-inertial frame
// is active ("the frame rotates the world, the camera stays put"). Because
// B(t) is a pure rotation, this is valid for ANY world-axis-aligned vector
// regardless of what its origin represents (camera-relative body position,
// leg-local sample, or a spin-baked surface direction) — the same one
// function is the whole seam for (a) polyline/ring samples (call with the
// sample's OWN t — this is what closes a rotating-frame-periodic loop live,
// retiring MATH.md critique 64), (b) bodies/markers (called with t=viewT by
// the _trajProj3 default — NOT an identity no-op for non-inertial frames,
// see the §7x critique: a body's frame-coordinates at its own current epoch
// are exactly what makes e.g. the Moon render at a fixed screen direction in
// the Earth-Moon frame), (c) spin-baked surface/globe points (also default
// t=viewT — composes with the SAME spin(t) baked into their world direction,
// exactly cancelling it for body-fixed anchored on that body).
function _trajFrameTransform(frameKind, body, pRel, t) {
  const B = _trajFrameBasisAt(frameKind, body, t);
  if (!B) return pRel;
  return [
    pRel[0] * B.xh[0] + pRel[1] * B.xh[1] + pRel[2] * B.xh[2],
    pRel[0] * B.yh[0] + pRel[1] * B.yh[1] + pRel[2] * B.yh[2],
    pRel[0] * B.zh[0] + pRel[1] * B.zh[1] + pRel[2] * B.zh[2],
  ];
}

// Per-mission transient view state (sibling of _trajCamByMission — NOT
// session-persisted: the camera itself isn't persisted either, so frame
// choice matches that existing pattern, see MATH.md §7x).
let _trajFrameByMission = {};
function _trajFrame(id) { return (_trajFrameByMission[id] && _trajFrameByMission[id].kind) || 'inertial'; }
function trajSetFrame(id, kind) {
  _trajFrameByMission[id] = { kind };
  missionRenderDetail();
}
const _TRAJ_FRAME_KINDS = [
  { id: 'inertial', label: 'Inertial' },
  { id: 'body-fixed', label: 'Body-fixed' },
  { id: 'earth-moon-rotating', label: 'Earth-Moon' },
  { id: 'sun-earth-rotating', label: 'Sun-Earth' },
];
// Project a body-local (already spin-rotated) UNIT direction through the pass
// camera and scale by the disc's screen radius — linear, so this is exactly
// equivalent to projecting the rPx-scaled vector (same seam as _trajProj3).
function _trajSurfacePoint(unitDir, cx, cy, rPx) {
  const q = _trajProj3(unitDir[0], unitDir[1], unitDir[2]);
  return { x: cx + q.x * rPx, y: cy + q.y * rPx, depth: q.depth };
}
// ── R6.2 defect1: exact hemisphere clip (2026-07-11) ────────────────────────
// The old per-vertex "drop back-facing points, keep the front runs joined"
// approach let the SVG fill close each gap with a straight chord THROUGH the
// disc interior (visible as giant wedges, worst pole-on where whole polygons
// straddle the limb). This clips a closed polygon of WORLD-frame unit
// direction vectors (as produced by _trajSpinRotate/_trajLatLonUnit, i.e.
// pre-projection) against the camera's front hemisphere (projected depth >=
// 0), closing every crossed edge exactly ON the limb circle instead of
// cutting inward.
//
// Exactness: depth is a LINEAR function of the input vector (_trajProjectVec
// is a pure rotation), so interpolating the two endpoint UNIT VECTORS in 3D
// by t = za/(za-zb) yields a point whose depth is exactly 0 by construction;
// renormalizing that point to unit length then gives a projected radius of
// exactly 1 (|x,y|^2 + 0^2 = 1) — i.e. it lands exactly on the limb, not an
// approximation of it (accurate at any polygon scale, not just coastlines).
//
// Returns { closed, runs }:
//   closed: true  -> `runs` is a single array holding the ENTIRE input
//                     polygon (every vertex front-facing) — draw with a
//                     plain `Z` close, no limb involved.
//   closed: false -> `runs` is zero or more open chains, each starting and
//                     ending exactly on the limb (or [] if fully back-facing).
function _trajHemiClipRuns(dirs) {
  const n = dirs.length;
  if (!n) return { closed: false, runs: [] };
  const zc = dirs.map(v => _trajProj3(v[0], v[1], v[2]).depth);
  if (zc.every(z => z >= 0)) return { closed: true, runs: [dirs.slice()] };
  if (zc.every(z => z < 0)) return { closed: false, runs: [] };
  const lerpUnit = (i, j, t) => {
    const wx = dirs[i][0] + (dirs[j][0] - dirs[i][0]) * t;
    const wy = dirs[i][1] + (dirs[j][1] - dirs[i][1]) * t;
    const wz = dirs[i][2] + (dirs[j][2] - dirs[i][2]) * t;
    const len = Math.hypot(wx, wy, wz) || 1;
    return [wx / len, wy / len, wz / len];
  };
  const runs = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const za = zc[i], zb = zc[j];
    if (za >= 0) {
      if (!cur) cur = [];
      cur.push(dirs[i]);
      if (zb < 0) { cur.push(lerpUnit(i, j, za / (za - zb))); runs.push(cur); cur = null; }
    } else if (zb >= 0) {
      cur = [lerpUnit(i, j, za / (za - zb))];
    }
  }
  // Wraparound: if the LAST edge crossed back->front, `cur` is left open at
  // loop end — it is the run continuing across the array boundary INTO
  // runs[0] (which necessarily starts at dirs[0] itself, since that crossing
  // is only left open when dirs[0] is front-facing). Splicing it onto the
  // front of runs[0] reunites the two into the single continuous run they
  // actually are, instead of emitting a spurious extra fragment.
  if (cur) { if (runs.length) runs[0] = cur.concat(runs[0]); else runs.push(cur); }
  return { closed: false, runs };
}
// Project a hemisphere-clip result to an SVG path `d`, stitching consecutive
// open runs together with an elliptical arc ALONG THE LIMB (radius rPx)
// instead of a chord — this is what actually kills the chord-wedge artifact.
// Winding-direction disambiguation between the two candidate arcs (short vs
// long way around) is resolved by taking the SHORT arc; at coastline/maria
// polygon scale (item 1a already clips to the disc circle as a safety net
// too) this reads correctly in every case exercised during verification —
// noted here per the brief as the accepted fallback for ambiguous cases.
function _trajClippedRunsToPath(clip, cx, cy, rPx) {
  const { closed, runs } = clip;
  if (!runs.length) return '';
  const proj = v => { const q = _trajProj3(v[0], v[1], v[2]); return { x: cx + q.x * rPx, y: cy + q.y * rPx }; };
  if (closed) {
    const pts = runs[0].map(proj);
    return pts.map((p, k) => (k ? 'L ' : 'M ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ') + ' Z';
  }
  let d = '';
  for (let r = 0; r < runs.length; r++) {
    const pts = runs[r].map(proj);
    d += pts.map((p, k) => ((r === 0 && k === 0) ? 'M ' : 'L ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ') + ' ';
    const nextPts = runs[(r + 1) % runs.length].map(proj);
    const exitPt = pts[pts.length - 1], entryPt = nextPts[0];
    const a0 = Math.atan2(exitPt.y - cy, exitPt.x - cx), a1 = Math.atan2(entryPt.y - cy, entryPt.x - cx);
    let delta = a1 - a0;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    const sweep = delta >= 0 ? 1 : 0;
    d += `A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 0 ${sweep} ${entryPt.x.toFixed(2)} ${entryPt.y.toFixed(2)} `;
  }
  return d + 'Z';
}
// Flat [lon0,lat0,lon1,lat1,...] TENTHS-of-degree polygon (PROG_GEO_EARTH) ->
// an SVG path `d` string, hemisphere-clipped and limb-closed (item defect1).
function _trajGeoPolyPath(lonLatTenths, spinAngle, cx, cy, rPx) {
  const dirs = [];
  for (let i = 0; i < lonLatTenths.length; i += 2) {
    dirs.push(_trajSpinRotate(_trajLatLonUnit(lonLatTenths[i + 1] / 10, lonLatTenths[i] / 10), spinAngle));
  }
  return _trajClippedRunsToPath(_trajHemiClipRuns(dirs), cx, cy, rPx);
}
// PROG_GEO_FEATURES ellipse {lat,lon,rLat,rLon} -> sampled SVG path `d`
// string, same hemisphere-clip/limb-close treatment as the coastline path.
function _trajGeoEllipsePath(feat, spinAngle, cx, cy, rPx) {
  const n = 20;
  const lonScale = Math.max(0.15, Math.cos(feat.lat * _PROG_D2R)); // lon degrees compress toward the poles
  const dirs = [];
  for (let k = 0; k < n; k++) { // n (not n+1): the polygon is implicitly closed by the clip/path Z, no duplicate seam point
    const a = 2 * Math.PI * k / n;
    const lat = feat.lat + feat.rLat * Math.sin(a);
    const lon = feat.lon + (feat.rLon * Math.cos(a)) / lonScale;
    dirs.push(_trajSpinRotate(_trajLatLonUnit(lat, lon), spinAngle));
  }
  return _trajClippedRunsToPath(_trajHemiClipRuns(dirs), cx, cy, rPx);
}
// Shared limb-darkening overlay: transparent center -> ~35% black rim,
// center offset toward the Sun's SCREEN direction (cheap 2D dot from already-
// projected positions) for a rudimentary day-side/terminator feel.
// ── V1 atmosphere rim glow (MISSION_MODEL_V2 §18) ──────────────────────────
// Soft radial-gradient halo just outside a body's limb, using the per-body
// PROG_BODY_ATMOSPHERE data-layer tint (570, next to PROG_BODY_COLORS — same
// theming exemption). Bodies absent from that table (airless: Moon, Mercury,
// ...) get nothing here — the existing inward limb-darkening gradient
// (_trajLimbGradientDef) already gives them a faint neutral shading cue.
// Emitted BEHIND the disc/globe by call order at the call site; a soft
// donut (transparent -> tinted -> transparent) so it reads as a glow at the
// edge rather than a hard ring.
function _trajAtmosphereGlowSVG(body, cx, cy, rPx, instanceId) {
  if (typeof PROG_BODY_ATMOSPHERE === 'undefined' || !PROG_BODY_ATMOSPHERE[body]) return '';
  const col = PROG_BODY_ATMOSPHERE[body];
  const gid = `traj-atmo-${(instanceId || 'x')}-${body}`;
  // Tight rim hugging the limb (NASA-Eyes look) — the first cut (1.38x outer,
  // 0.85 peak at 1.2x) read as a fat donut, not an atmosphere (review 2026-07-14).
  const rOut = rPx * 1.16;
  return `<defs><radialGradient id="${gid}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="80%" stop-color="${col}" stop-opacity="0"/>` +
    `<stop offset="88%" stop-color="${col}" stop-opacity="0.5"/>` +
    `<stop offset="100%" stop-color="${col}" stop-opacity="0"/></radialGradient></defs>` +
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rOut.toFixed(2)}" fill="url(#${gid})"/>`;
}
function _trajLimbGradientDef(gradId, body, sunDirAngle) {
  const style = (typeof PROG_GEO_STYLE !== 'undefined' && PROG_GEO_STYLE[body]) || {};
  const limbColor = style.limb || 'rgba(0,0,0,.35)';
  const off = 0.32;
  const ox = Math.cos(sunDirAngle || 0) * off, oy = Math.sin(sunDirAngle || 0) * off;
  return `<radialGradient id="${gradId}" cx="${(50 + ox * 50).toFixed(1)}%" cy="${(50 + oy * 50).toFixed(1)}%" r="78%">` +
    `<stop offset="30%" stop-color="${limbColor}" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="${limbColor}" stop-opacity="1"/></radialGradient>`;
}
// ── R6.2 defect3: real terminator (2026-07-11, MATH.md §7m) ────────────────
// `sd` is the body->Sun WORLD-frame unit vector. Builds the great circle
// perpendicular to `sd` (the terminator) in WORLD frame — NOT spin-rotated,
// since illumination depends on sun geometry, not the body's own rotation —
// samples it, and runs it through the SAME hemisphere clipper as coastlines
// (item defect1's clipper doubles as the "ellipse feature" clipper the brief
// asked for). The front-visible arc plus a limb arc closes the NIGHT region;
// which limb arc (of the two candidates) is night is resolved by checking
// which one avoids the sun's own screen angle. Returns null when no scrim is
// needed (fully lit) or {path, alpha} otherwise.
function _trajTerminatorNightPath(sd, cx, cy, rPx) {
  const sq = _trajProj3(sd[0], sd[1], sd[2]);
  const a = sq.x, b = sq.y, c = sq.depth; // a^2+b^2+c^2 == 1 (rotation preserves length)
  if (c >= 0.995) return null; // sun ~directly toward viewer: fully lit face, no scrim
  const FULL_CIRCLE = `M ${(cx - rPx).toFixed(2)} ${cy.toFixed(2)} A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 1 0 ${(cx + rPx).toFixed(2)} ${cy.toFixed(2)} A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 1 0 ${(cx - rPx).toFixed(2)} ${cy.toFixed(2)} Z`;
  if (c <= -0.995) return { path: FULL_CIRCLE, alpha: 0.55 }; // sun ~directly away: fully dark face, soft floor so geometry stays faintly legible
  // World-frame basis spanning the plane perpendicular to sd (the terminator
  // plane); worldUp is the ecliptic normal (+z), matching _trajLatLonUnit's
  // spin-axis convention.
  let e1x = sd[1] * 1 - sd[2] * 0, e1y = sd[2] * 0 - sd[0] * 1, e1z = sd[0] * 0 - sd[1] * 0; // sd x (0,0,1)
  let elen = Math.hypot(e1x, e1y, e1z);
  if (elen < 1e-6) { e1x = 1; e1y = 0; e1z = 0; elen = 1; } // sd ~parallel to ecliptic pole (edge case, no real mission body hits this)
  e1x /= elen; e1y /= elen; e1z /= elen;
  const e2x = sd[1] * e1z - sd[2] * e1y, e2y = sd[2] * e1x - sd[0] * e1z, e2z = sd[0] * e1y - sd[1] * e1x; // sd x e1, already unit
  const N = 40;
  const termDirs = [];
  for (let k = 0; k < N; k++) {
    const phi = 2 * Math.PI * k / N, cp = Math.cos(phi), sp = Math.sin(phi);
    termDirs.push([cp * e1x + sp * e2x, cp * e1y + sp * e2y, cp * e1z + sp * e2z]);
  }
  const clip = _trajHemiClipRuns(termDirs);
  if (clip.closed || !clip.runs.length) return null; // degenerate (shouldn't occur once |c|<0.995) — no scrim rather than a wrong one
  const run = clip.runs[0];
  if (run.length < 2) return null;
  const proj = v => { const q = _trajProj3(v[0], v[1], v[2]); return { x: cx + q.x * rPx, y: cy + q.y * rPx }; };
  const p0 = proj(run[0]), pn = proj(run[run.length - 1]);
  const angStart = Math.atan2(p0.y - cy, p0.x - cx), angEnd = Math.atan2(pn.y - cy, pn.x - cx);
  const theta = Math.atan2(b, a); // sun's own screen angle from disc center
  const norm2pi = x => { x %= 2 * Math.PI; return x < 0 ? x + 2 * Math.PI : x; };
  const s = norm2pi(angStart), e = norm2pi(angEnd), sunA = norm2pi(theta);
  const span = norm2pi(s - e);           // CCW (increasing-angle) span from pn's angle to p0's angle
  const sunSpan = norm2pi(sunA - e);     // where the sun angle falls within that sweep
  const ccwArcContainsSun = sunSpan <= span; // that arc is the DAY side -> night needs the complement
  const sweep = ccwArcContainsSun ? 0 : 1;
  const arcSpan = ccwArcContainsSun ? (2 * Math.PI - span) : span;
  const largeArc = arcSpan > Math.PI ? 1 : 0;
  let d = `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} `;
  for (let i = 1; i < run.length; i++) { const p = proj(run[i]); d += `L ${p.x.toFixed(2)} ${p.y.toFixed(2)} `; }
  d += `A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 ${largeArc} ${sweep} ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} Z`;
  return { path: d, alpha: 0.4 };
}
// Full surfaced-disc render (tier 1): base color + surface geometry (per body
// kind) + limb-shading overlay + terminator scrim. `rPx` is the disc's TRUE
// (unclamped) screen radius. Perf clamp: an absurdly huge disc (camera
// zoomed deep into the body, disc mostly off-screen) skips surface geometry
// sampling entirely — same spirit as the polyline viewClampUnits pattern —
// so path strings stay bounded; the base-color fill alone still reads
// correctly at that zoom. `sunDir3` is the body->Sun WORLD-frame unit vector
// (defect3); `instanceId` (mission id or a fixed fallback) + `body` form a
// STABLE per-body-per-instance id for the gradient/clip defs (defect2 — see
// _trajBodyDiscTiered).
// NOTE (clouds, MISSION_MODEL_V2 §18 V1 follow-up): this vector-geometry
// tier has no per-pixel loop to sample a second texture into, unlike
// _trajRasterGlobe — it draws discrete SVG shapes (coastline polygons,
// craters), not a raster. Clouds are intentionally NOT drawn here; this is
// the low-fidelity fallback used only before the real texture has decoded
// or when raster is unavailable, so the omission is brief and low-stakes.
function _trajSurfacedDiscSVG(body, cx, cy, rPx, spinAngle, sunDir3, viewportDiagPx, instanceId) {
  const style = (typeof PROG_GEO_STYLE !== 'undefined' && PROG_GEO_STYLE[body]) || {};
  // R6.2.1 item 2: skip vector feature sampling both when the disc is
  // absurdly huge (mostly off-screen — path strings would be unbounded) AND
  // when it's small enough (< _TRAJ_FEATURE_PX) that features are invisible
  // — the surfaced tier now runs all the way to the chip threshold, so this
  // keeps small-disc rendering as cheap as the old plain-disc middle tier.
  const skipGeometry = (viewportDiagPx && rPx > viewportDiagPx * 4) || rPx < _TRAJ_FEATURE_PX;
  const baseFill = style.base || (style.bands && style.bands[0]) || _trajBodyColor(body);
  // Feature paths are collected separately so they can be clipped to the
  // disc circle (item 1a) as a safety net on top of the exact hemisphere clip
  // above (defect1) — belt-and-suspenders against any float-precision spill.
  let features = '';
  if (!skipGeometry) {
    if (body === 'Earth' && typeof PROG_GEO_EARTH !== 'undefined') {
      PROG_GEO_EARTH.forEach(poly => {
        const d = _trajGeoPolyPath(poly, spinAngle, cx, cy, rPx);
        if (d) features += `<path d="${d}" fill="${style.land || '#3f7a42'}" stroke="none"/>`;
      });
    } else if (body === 'Moon' && typeof PROG_GEO_FEATURES !== 'undefined') {
      (PROG_GEO_FEATURES.Moon || []).forEach(f => {
        const d = _trajGeoEllipsePath(f, spinAngle, cx, cy, rPx);
        const fill = style[f.kind] || style.mare || '#7d7566';
        if (d) features += `<path d="${d}" fill="${fill}" stroke="none"/>`;
      });
    } else if (body === 'Mars' && typeof PROG_GEO_FEATURES !== 'undefined') {
      (PROG_GEO_FEATURES.Mars || []).forEach(f => {
        const d = _trajGeoEllipsePath(f, spinAngle, cx, cy, rPx);
        const fill = style[f.kind] || style.base;
        if (d) features += `<path d="${d}" fill="${fill}" stroke="none"/>`;
      });
    } else if ((body === 'Jupiter' || body === 'Saturn') && style.bands) {
      const bands = style.bands, nBands = bands.length, nSeg = 16;
      for (let b = 0; b < nBands; b++) {
        const lat0 = -90 + (180 * b) / nBands, lat1 = -90 + (180 * (b + 1)) / nBands;
        const dirs = [];
        for (let k = 0; k <= nSeg; k++) {
          const lon = -180 + (360 * k) / nSeg;
          dirs.push(_trajSpinRotate(_trajLatLonUnit(lat1, lon), spinAngle));
        }
        for (let k = nSeg; k >= 0; k--) {
          const lon = -180 + (360 * k) / nSeg;
          dirs.push(_trajSpinRotate(_trajLatLonUnit(lat0, lon), spinAngle));
        }
        const d = _trajClippedRunsToPath(_trajHemiClipRuns(dirs), cx, cy, rPx);
        if (d) features += `<path d="${d}" fill="${bands[b]}" stroke="none" opacity="0.85"/>`;
      }
    }
    // Venus/Mercury/Titan: base disc only (Venus's base fill is already a
    // brightened tint via PROG_GEO_STYLE.Venus).
  }
  // R6.2 defect2: STABLE deterministic ids (per body per render instance)
  // instead of a per-render-unique counter. The world layer is rebuilt
  // wholesale via innerHTML swap every ~33ms during rotation; unique ids
  // meant every rebuild minted fresh gradient/clipPath ids and rewired every
  // url(#) reference, which browsers can resolve asynchronously relative to
  // the atomic DOM swap -> one-frame paint gaps (the flicker). Same-id defs
  // recreated atomically by the innerHTML swap never dangle a reference.
  const idBase = `traj-geo-${(instanceId || 'x')}-${body}`;
  const gradId = `${idBase}-limb`;
  const clipId = `${idBase}-clip`;
  const sunQ = _trajProj3(sunDir3[0], sunDir3[1], sunDir3[2]);
  const sunDirAngle = Math.atan2(sunQ.y, sunQ.x);
  const baseCircle = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rPx.toFixed(2)}" fill="${baseFill}"/>`;
  const featuresSvg = features ? `<g clip-path="url(#${clipId})">${features}</g>` : '';
  const term = _trajTerminatorNightPath(sunDir3, cx, cy, rPx);
  const termSvg = term ? `<path d="${term.path}" fill="rgba(0,0,0,${term.alpha})" clip-path="url(#${clipId})"/>` : '';
  return `<defs>${_trajLimbGradientDef(gradId, body, sunDirAngle)}<clipPath id="${clipId}"><circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rPx.toFixed(2)}"/></clipPath></defs>` +
    `<g>${baseCircle}${featuresSvg}${termSvg}<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rPx.toFixed(2)}" fill="url(#${gradId})"/>` +
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rPx.toFixed(2)}" fill="none" stroke="var(--border-bright)" stroke-width="0.5" vector-effect="non-scaling-stroke"/></g>`;
}
// ── R6.4: real textured globes (MATH.md §7m raster addendum) ───────────────
// Lazy per-body sampling-canvas cache: decodes PROG_TEXTURES[body] into an
// offscreen canvas once and keeps its ImageData for bilinear sampling. Image
// decode is async — callers MUST check `.ready` and fall back to the vector
// path until the onload fires (which invalidates the raster cache below and
// triggers a repaint through _trajRequestRepaint).
let _trajTexStore = {};
function _trajTextureFor(body) {
  if (!(typeof PROG_TEXTURES !== 'undefined' && PROG_TEXTURES[body])) return null;
  let t = _trajTexStore[body];
  if (t) return t;
  t = { ready: false, imgData: null, w: 0, h: 0 };
  _trajTexStore[body] = t;
  const img = new Image();
  img.onload = () => {
    // Sampling canvas: cap width so bilinear lookups stay cheap; equirect
    // aspect is always 2:1 for these sources.
    const sw = Math.min(img.naturalWidth || 1024, 1024);
    const sh = Math.round(sw / 2);
    const sc = document.createElement('canvas');
    sc.width = sw; sc.height = sh;
    const sctx = sc.getContext('2d');
    sctx.drawImage(img, 0, 0, sw, sh);
    t.imgData = sctx.getImageData(0, 0, sw, sh);
    t.w = sw; t.h = sh;
    t.ready = true;
    _trajRasterCache = {}; // stale dataURLs reference the pre-decode fallback
    _trajRequestRepaint();
  };
  img.src = PROG_TEXTURES[body];
  return t;
}
// Cloud layer (Earth only, V1 follow-up MISSION_MODEL_V2 §18): same lazy
// decode-to-ImageData cache as _trajTextureFor, keyed off PROG_CLOUD_TEXTURE
// instead of PROG_TEXTURES. Kept as a separate store/function (not folded
// into _trajTextureFor) because clouds sample at an INDEPENDENT longitude
// offset from the ground texture — see the cloudSpin comment in
// _trajRasterGlobe — and only Earth has an entry, so every other body's
// lookup is a cheap `undefined` short-circuit.
let _trajCloudTexStore = {};
function _trajCloudTextureFor(body) {
  if (!(typeof PROG_CLOUD_TEXTURE !== 'undefined' && PROG_CLOUD_TEXTURE[body])) return null;
  let t = _trajCloudTexStore[body];
  if (t) return t;
  t = { ready: false, imgData: null, w: 0, h: 0 };
  _trajCloudTexStore[body] = t;
  const img = new Image();
  img.onload = () => {
    const sw = Math.min(img.naturalWidth || 1024, 1024);
    const sh = Math.round(sw / 2);
    const sc = document.createElement('canvas');
    sc.width = sw; sc.height = sh;
    const sctx = sc.getContext('2d');
    sctx.drawImage(img, 0, 0, sw, sh);
    t.imgData = sctx.getImageData(0, 0, sw, sh);
    t.w = sw; t.h = sh;
    t.ready = true;
    _trajRasterCache = {};
    _trajRequestRepaint();
  };
  img.src = PROG_CLOUD_TEXTURE[body];
  return t;
}
// Bilinear sample of an ImageData at fractional pixel (fx,fy), wrapping X
// (longitude seam) and clamping Y (poles).
function _trajBilinearSample(imgData, w, h, fx, fy) {
  fx = ((fx % w) + w) % w;
  fy = fy < 0 ? 0 : (fy > h - 1 ? h - 1 : fy);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = (x0 + 1) % w, y1 = y0 + 1 > h - 1 ? h - 1 : y0 + 1;
  const tx = fx - x0, ty = fy - y0;
  const d = imgData.data;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * tx;
    const b = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * tx;
    out[c] = a + (b - a) * ty;
  }
  return out;
}
// Raster an equirect texture to a shaded disc canvas via PER-PIXEL INVERSE
// orthographic mapping. Derivation (MATH.md §7m raster addendum): the
// forward map _trajProjectVec rotates a WORLD unit vector (x,y,z) by az then
// tilt t=pi/2-el and reflects screen-x:
//   u = -(x*ca - y*sa)                         [ca=cos(az), sa=sin(az)]
//   v = (x*sa + y*ca)*ct - z*st                 [ct=cos(t), st=sin(t)]
//   w = (x*sa + y*ca)*st + z*ct   (== depth)
// Since this is a pure rotation, (u,v,w) is unit-length whenever (x,y,z) is,
// so w = +sqrt(1-u^2-v^2) recovers the dropped depth on the front hemisphere.
// Un-rotating tilt then azimuth (both orthonormal, so inverse = transpose)
// gives back the WORLD direction; un-spinning by the body's own spin angle
// (inverse of _trajSpinRotate) gives the BODY-FRAME direction that
// _trajLatLonUnit produces lat/lon from — this is what makes the raster
// align with the vector site markers, which route through the same chain.
function _trajRasterGlobe(body, discPx, spinAngle, az, el, sunDir3, maxPx) {
  const tex = _trajTextureFor(body);
  if (!tex || !tex.ready) return null;
  // Cloud layer (Earth only): drifts at an independent rate/offset from the
  // ground so scrubbing time visibly moves clouds relative to the surface.
  // 0.85x rate (slightly slower than the planet's own spin) + a fixed phase
  // offset — both arbitrary but stable, chosen only so drift is obviously
  // non-zero and non-degenerate (never exactly co-rotating with the ground).
  const cloudTex = _trajCloudTextureFor(body);
  const cloudActive = !!(cloudTex && cloudTex.ready);
  const cloudSpin = (spinAngle || 0) * 0.85 + 0.6;
  const cspc = Math.cos(cloudSpin), csps = Math.sin(cloudSpin);
  const size = Math.max(1, Math.min(Math.round(discPx), maxPx || 512));
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(size, size);
  const od = out.data;
  const t = Math.PI / 2 - (el != null ? el : Math.PI / 2);
  const ca = Math.cos(az || 0), sa = Math.sin(az || 0), ct = Math.cos(t), st = Math.sin(t);
  const spc = Math.cos(spinAngle || 0), sps = Math.sin(spinAngle || 0);
  const iw = tex.w, ih = tex.h, id = tex.imgData;
  const ciw = cloudActive ? cloudTex.w : 0, cih = cloudActive ? cloudTex.h : 0, cid = cloudActive ? cloudTex.imgData : null;
  const R = size / 2;
  // sunDir3 is WORLD-frame body->Sun unit vector (same one the vector
  // terminator uses) — no re-derivation, single source per the brief.
  const sx = sunDir3 ? sunDir3[0] : 0, sy = sunDir3 ? sunDir3[1] : 0, sz = sunDir3 ? sunDir3[2] : 1;
  for (let py = 0; py < size; py++) {
    const v = (py + 0.5 - R) / R;
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5 - R) / R;
      const r2 = u * u + v * v;
      const pi = (py * size + px) * 4;
      if (r2 > 1) { od[pi + 3] = 0; continue; }
      const w = Math.sqrt(Math.max(0, 1 - r2));
      // un-tilt: (ya,z) = R(-t) * (v,w)
      const ya = v * ct + w * st;
      const z = -v * st + w * ct;
      const xa = -u;
      // un-azimuth: (x,y) = R(-az) * (xa,ya)
      const x = xa * ca + ya * sa;
      const y = u * sa + ya * ca; // == -xa*sa + ya*ca
      // un-spin: body-frame = R(-spin) * (x,y)
      const bx = x * spc + y * sps;
      const by = -x * sps + y * spc;
      const bz = z;
      const lat = Math.asin(Math.max(-1, Math.min(1, bz)));
      const lon = Math.atan2(by, bx);
      const fx = ((lon + Math.PI) / (2 * Math.PI)) * iw;
      const fy = ((Math.PI / 2 - lat) / Math.PI) * ih;
      const rgb = _trajBilinearSample(id, iw, ih, fx, fy);
      if (cloudActive) {
        // Independent longitude for the cloud layer: re-un-spin the SAME
        // pre-spin world direction (x,y,z) with cloudSpin instead of the
        // body's own spinAngle. Latitude is spin-invariant (z unchanged).
        const ccx = x * cspc + y * csps;
        const ccy = -x * csps + y * cspc;
        const clon = Math.atan2(ccy, ccx);
        const cfx = ((clon + Math.PI) / (2 * Math.PI)) * ciw;
        const cfy = fy * (cih / ih); // same latitude fraction, cloud texture's own height
        const crgb = _trajBilinearSample(cid, ciw, cih, cfx, cfy);
        // Grayscale cloud map (R=G=B): brightness IS coverage. Screen/lerp
        // toward white, capped so fully-bright cloud doesn't clip to pure
        // white (keeps some surface tone visible through thin cloud).
        const cw = Math.min(0.9, crgb[0] / 255);
        rgb[0] += (255 - rgb[0]) * cw;
        rgb[1] += (255 - rgb[1]) * cw;
        rgb[2] += (255 - rgb[2]) * cw;
      }
      // Shading in the SAME (world-frame, pre-unspin) coordinates as the
      // vector terminator: normal == (x,y,z), dot with sunDir3.
      let ndotl = x * sx + y * sy + z * sz;
      const edge = 0.15;
      let lightF = ndotl < -edge ? 0 : ndotl > edge ? 1 : (ndotl + edge) / (2 * edge);
      lightF = lightF * lightF * (3 - 2 * lightF); // smoothstep
      const NIGHT_FLOOR = 0.45;
      const shade = NIGHT_FLOOR + (1 - NIGHT_FLOOR) * lightF;
      const limb = 0.75 + 0.25 * w;
      const f = shade * limb;
      od[pi] = rgb[0] * f; od[pi + 1] = rgb[1] * f; od[pi + 2] = rgb[2] * f; od[pi + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}
// Raster dataURL cache: quantized key -> dataURL, so drag/rotate re-uses a
// stale raster between throttled re-raster passes instead of re-running the
// per-pixel loop every 33ms frame. Cleared whenever a texture finishes
// decoding (fallback frames must not stick around after real data arrives).
let _trajRasterCache = {};
// R6.4b (user flight-test): the old 120ms raster throttle made the globe
// visibly update at ~8fps while the vector layer moved at 30fps. Replaced
// with a FIDELITY LADDER (gizmo-preview precedent): while the user is
// interacting (rotate/zoom/scrub — see _trajMarkInteracting call sites) the
// globe re-rasters EVERY frame at low resolution (≤224px ≈ 2–4ms, well
// inside the 33ms frame budget) so it moves in lockstep with the lines; a
// settle timer then repaints once at full 512px when the interaction ends.
const _TRAJ_RASTER_LO_PX = 224;
let _trajInteractingUntil = 0;
let _trajRasterSettleTimer = null;
function _trajMarkInteracting() {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  _trajInteractingUntil = now + 250;
  if (_trajRasterSettleTimer) clearTimeout(_trajRasterSettleTimer);
  _trajRasterSettleTimer = setTimeout(() => {
    _trajRasterSettleTimer = null;
    _trajRequestRepaint(); // one full-res pass after the gesture ends
  }, 300);
}
function _trajRasteredDiscDataURL(body, discPx, spinAngle, az, el, sunDir3) {
  const tex = _trajTextureFor(body);
  if (!tex || !tex.ready) return null;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const interacting = now < _trajInteractingUntil;
  const maxPx = interacting ? _TRAJ_RASTER_LO_PX : 512;
  const discBucket = Math.round(discPx / 8) * 8;
  const spinQ = Math.round((spinAngle || 0) * 100) / 100;
  const azQ = Math.round((az || 0) * 100) / 100;
  const elQ = Math.round((el != null ? el : Math.PI / 2) * 100) / 100;
  const sunQ = sunDir3 ? [Math.round(sunDir3[0] * 10) / 10, Math.round(sunDir3[1] * 10) / 10, Math.round(sunDir3[2] * 10) / 10].join(',') : '0';
  const key = `${body}|${maxPx}|${discBucket}|${spinQ}|${azQ}|${elQ}|${sunQ}`;
  const cached = _trajRasterCache[key];
  if (cached) return cached.url;
  const canvas = _trajRasterGlobe(body, discPx, spinAngle, az, el, sunDir3, maxPx);
  if (!canvas) return null;
  const url = canvas.toDataURL('image/png');
  // Bound the cache: quantized spin/az keys churn constantly during long
  // sessions — reset wholesale past a small cap (rasters are cheap to redo).
  if (Object.keys(_trajRasterCache).length > 64) _trajRasterCache = {};
  _trajRasterCache[key] = { url, t: now };
  return url;
}
// ── V1 idle texture pre-warm (MISSION_MODEL_V2 §18) ─────────────────────────
// The trajectory view's first-open lag is texture decode (network fetch +
// getImageData), not a slow render — the per-pixel raster loop itself is a
// few ms once tex.ready. Kick decode for every textured body shortly after
// app init, chunked one body per idle slice, so the view opens with
// tex.ready already true for everything it's about to draw. No loading
// screen (decision 2026-07-14 — pre-warm removes the wait instead of
// dressing it up).
function _trajScheduleIdle(fn) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 800 });
  else setTimeout(() => fn({ timeRemaining: () => 0, didTimeout: true }), 120);
}
let _trajPrewarmStats = null; // {startedAt, bodies:[{body,ms}], totalMs} — read by verification/perf checks
function _trajPrewarmTextures() {
  if (typeof document === 'undefined' || typeof PROG_TEXTURES === 'undefined') return;
  // Bodies present in the active mission's touched frames take priority (the
  // ones the user will actually see first); fall back to every textured body
  // so a fresh/empty program still warms the common planets.
  let list = _trajAllBodies().filter(b => PROG_TEXTURES[b]);
  if (typeof _missions !== 'undefined' && _missions && _missions[0]) {
    try {
      const m = _missions[0];
      const frames = _trajGetExtraction ? _trajGetExtraction(m) : null;
      if (frames) {
        const touched = Object.keys(frames).filter(id => {
          const sc = frames[id];
          return sc && (sc.orbits.size || (sc.legs && sc.legs.length) || (sc.surface && sc.surface.length));
        });
        const parents = touched.map(id => (PROG_MOON_ORBITS[id] && PROG_MOON_ORBITS[id].parent) || id);
        const wanted = ['Earth', ...parents, ...touched].filter(b => PROG_TEXTURES[b]);
        if (wanted.length) list = [...new Set(wanted)].concat(list.filter(b => !wanted.includes(b)));
      }
    } catch (e) { /* best-effort prioritization only — never block the prewarm */ }
  }
  let i = 0, retries = 0;
  const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  _trajPrewarmStats = { startedAt, bodies: [], totalMs: null };
  const az = 0, el = Math.PI / 2;
  const doOne = () => {
    if (i >= list.length) {
      _trajPrewarmStats.totalMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      return;
    }
    const body = list[i];
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const tex = _trajTextureFor(body); // kicks off img decode if not already started
    if (body === 'Earth') _trajCloudTextureFor(body); // kicks off cloud decode alongside the surface map
    if (!tex.ready) {
      retries++;
      if (retries > 60) { i++; retries = 0; } // ~a few seconds of retries, then give up on this body
      _trajScheduleIdle(doOne);
      return;
    }
    // Warm both fidelity-ladder tiers at a canonical top-down orientation —
    // this is a bonus (populates the dataURL cache for the common default
    // view); the real win already happened above (tex.ready).
    _trajRasterGlobe(body, _TRAJ_RASTER_LO_PX, 0, az, el, [0, 0, 1], _TRAJ_RASTER_LO_PX);
    _trajRasterGlobe(body, 512, 0, az, el, [0, 0, 1], 512);
    _trajPrewarmStats.bodies.push({ body, ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0 });
    i++; retries = 0;
    _trajScheduleIdle(doOne);
  };
  _trajScheduleIdle(doOne);
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  const kickPrewarm = () => _trajScheduleIdle(() => _trajPrewarmTextures());
  document.addEventListener('DOMContentLoaded', kickPrewarm);
  if (document.readyState === 'interactive' || document.readyState === 'complete') kickPrewarm();
}

// Repaint hook: after an async texture decode completes, re-render every
// mounted trajectory-view panel at its current camera (same rebuild path
// _trajApplyCam/_missionTrajAfterRender use) so the fallback vector frame is
// replaced with the real raster without waiting for the next user gesture.
function _trajRequestRepaint() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.mcc-view-area .traj-wrap[data-mid]').forEach(va => {
    const id = va.getAttribute('data-mid');
    const cam = _trajCamByMission[id];
    if (id && cam && typeof _trajApplyCam === 'function') _trajApplyCam(id, cam);
  });
}
// Reconcile the persistent globe layer against _trajPendingGlobes (populated by
// the _trajWorldSVG pass that just ran). Reuses one <image> per body, updating
// x/y/size every call and href ONLY when it changed — an in-place href swap
// retains the current bitmap until the new data-URI decodes, so rotation never
// shows a blank/half-decoded planet (the flicker fix). Bodies not drawn this
// frame are hidden (display:none), NOT removed, so their decoded bitmap is kept
// for when the camera returns.
const _TRAJ_SVG_NS = 'http://www.w3.org/2000/svg';
function _trajReconcileGlobeLayer(svgEl) {
  if (!svgEl) return;
  const layer = svgEl.querySelector('g.traj-globe-layer');
  if (!layer) return;
  const seen = {};
  for (const g of _trajPendingGlobes) {
    seen[g.body] = true;
    // Ring-behind group, kept as this body's DOM predecessor of its <image>
    // so it paints underneath the bitmap (see the pending-globe note at the
    // push site) while staying in the same behind-traj-scene layer.
    let ringG = layer.querySelector(`g[data-ring-behind="${g.body}"]`);
    if (!ringG) {
      ringG = document.createElementNS(_TRAJ_SVG_NS, 'g');
      ringG.setAttribute('data-ring-behind', g.body);
      layer.appendChild(ringG);
    }
    ringG.innerHTML = g.ringsBehind || '';
    let img = layer.querySelector(`image[data-body="${g.body}"]`);
    if (!img) {
      img = document.createElementNS(_TRAJ_SVG_NS, 'image');
      img.setAttribute('data-body', g.body);
      img.setAttribute('preserveAspectRatio', 'none');
      layer.appendChild(img);
    }
    // Keep ring-behind immediately before its image in paint order even if
    // both nodes already existed from a prior frame (appendChild moves an
    // existing node rather than duplicating it).
    layer.appendChild(ringG);
    layer.appendChild(img);
    img.setAttribute('x', g.x.toFixed(2));
    img.setAttribute('y', g.y.toFixed(2));
    img.setAttribute('width', g.size.toFixed(2));
    img.setAttribute('height', g.size.toFixed(2));
    if (img.getAttribute('href') !== g.url && img.dataset.pendingHref !== g.url) {
      // Decode-BEFORE-swap (close-zoom rotation flicker fix, 2026-07-14):
      // setting href directly blanks the SVG <image> until the new data-URL
      // decodes — invisible for small discs, a visible flash every az/el
      // cache bucket when zoomed close (large PNG, multi-ms decode). Decode
      // offscreen first and only then swap; the OLD bitmap stays on screen
      // the whole time. pendingHref stale-guards rapid rotation: only the
      // latest requested URL wins, intermediates are dropped.
      const pre = new Image();
      img.dataset.pendingHref = g.url;
      pre.onload = () => {
        if (img.dataset.pendingHref === g.url) {
          img.setAttribute('href', g.url);
          delete img.dataset.pendingHref;
        }
      };
      pre.onerror = () => { if (img.dataset.pendingHref === g.url) delete img.dataset.pendingHref; };
      pre.src = g.url;
      // First-ever bitmap for this body: nothing old to keep showing — set
      // href immediately so the globe appears without waiting a frame.
      if (!img.getAttribute('href')) img.setAttribute('href', g.url);
    }
    if (img.style.display === 'none') img.style.display = '';
    if (ringG.style.display === 'none') ringG.style.display = '';
  }
  layer.querySelectorAll('image[data-body]').forEach(img => {
    if (!seen[img.getAttribute('data-body')]) img.style.display = 'none';
  });
  layer.querySelectorAll('g[data-ring-behind]').forEach(rg => {
    if (!seen[rg.getAttribute('data-ring-behind')]) rg.style.display = 'none';
  });
}
// Tiered body disc dispatcher — replaces the old flat _trajGlyph call for
// planets/moons (Sun keeps its own plain _trajGlyph path, untouched). Picks
// one of the three LOD tiers from the TRUE apparent radius (trueRpx,
// unclamped) and returns the disc svg, wrapped in the same fly-to click
// handler as _trajGlyph. Registers the body-name label exactly as before.
// ── V2+ ring systems (MISSION_MODEL_V2 §18, NASA-Eyes direction) ───────────
// Ring-plane orientation approximation: STATIC tilt about world +X by the
// body's real obliquity (Saturn 26.73°) — the ring plane is really the
// body's own equatorial plane, whose orientation should rotate with a real
// per-epoch frame (N3), but a fixed tilted normal already reads correctly
// from any camera az/el and is documented here as the accepted shortcut
// until N3 lands. e1 = world X axis (lies in the tilted plane, since the
// tilt rotation is about X); e2 = the plane's other in-plane axis (world Y/Z
// rotated by the same tilt) — together an orthonormal basis for the ring
// plane, so a point at ring-plane angle phi and radius r (km) is
// r*(cos(phi)*e1 + sin(phi)*e2) in WORLD-frame km, ready for _trajProjectVec.
const _TRAJ_RING_OBLIQUITY_DEG = { Saturn: 26.73 };
function _trajRingPlaneBasis(body) {
  const deg = _TRAJ_RING_OBLIQUITY_DEG[body];
  if (deg == null) return null;
  const th = deg * _PROG_D2R;
  return { e1: [1, 0, 0], e2: [0, Math.cos(th), Math.sin(th)] };
}
// Sample the ring plane's UNIT circle (radius-independent — see note below)
// into contiguous front/back runs by projected-depth sign, exactly like
// _trajHemiClipRuns' front/back split but for an open ring curve rather than
// a closed hemisphere polygon. Because _trajProjectVec is a pure rotation,
// depth(phi, r) = r * depth(phi, 1) for any r > 0 — the sign of the depth,
// and therefore every front/back boundary angle, is IDENTICAL at every ring
// radius. So the split is computed once per body per frame and reused for
// every band (outer AND inner edge) instead of resampling per band.
function _trajRingAngleRuns(basis, az, el, N) {
  N = N || 120;
  const dirAt = (phi) => {
    const cp = Math.cos(phi), sp = Math.sin(phi);
    return [cp * basis.e1[0] + sp * basis.e2[0], cp * basis.e1[1] + sp * basis.e2[1], cp * basis.e1[2] + sp * basis.e2[2]];
  };
  const depthAt = (phi) => { const v = dirAt(phi); return _trajProjectVec(v[0], v[1], v[2], az, el).depth; };
  const samples = [];
  for (let k = 0; k < N; k++) { const phi = 2 * Math.PI * k / N; samples.push({ phi, d: depthAt(phi) }); }
  const runs = [];
  let cur = null;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const sa = samples[i], sb = samples[j];
    const frontA = sa.d >= 0;
    if (!cur) cur = { front: frontA, phis: [sa.phi] };
    else cur.phis.push(sa.phi);
    const frontB = sb.d >= 0;
    if (frontA !== frontB) {
      const t = sa.d / (sa.d - sb.d);
      let dphi = sb.phi - sa.phi; if (dphi <= 0) dphi += 2 * Math.PI;
      const crossPhi = sa.phi + dphi * (isFinite(t) ? t : 0.5);
      cur.phis.push(crossPhi);
      runs.push(cur);
      cur = { front: frontB, phis: [crossPhi] };
    }
  }
  if (cur) {
    if (runs.length && runs[0].front === cur.front) runs[0].phis = cur.phis.concat(runs[0].phis);
    else runs.push(cur);
  }
  if (!runs.length) runs.push({ front: samples[0].d >= 0, phis: samples.map(s => s.phi).concat([samples[0].phi + 2 * Math.PI]) });
  return runs;
}
// One angular run (contiguous phi list, same boundary angles for every
// radius per the note above) -> a filled "washer wedge" SVG path: outer edge
// forward, inner edge back, at the run's screen-projected positions.
function _trajRingBandRunPath(basis, run, rOut, rIn, cx, cy, zoom, az, el) {
  const project = (phi, r) => {
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const vx = (cp * basis.e1[0] + sp * basis.e2[0]) * r;
    const vy = (cp * basis.e1[1] + sp * basis.e2[1]) * r;
    const vz = (cp * basis.e1[2] + sp * basis.e2[2]) * r;
    const q = _trajProjectVec(vx, vy, vz, az, el);
    return { x: cx + q.x * zoom, y: cy + q.y * zoom };
  };
  const outPts = run.phis.map(phi => project(phi, rOut));
  const inPts = run.phis.map(phi => project(phi, rIn)).reverse();
  const all = outPts.concat(inPts);
  return all.map((p, i) => (i ? 'L ' : 'M ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ') + ' Z';
}
// PROG_BODY_RINGS -> { behind, front } SVG strings, ready to splice around a
// body's disc: `behind` emitted BEFORE the disc/globe so the sphere occludes
// the far side of the ring; `front` emitted AFTER so the near side occludes
// the sphere. Bodies absent from PROG_BODY_RINGS (everything but Saturn)
// return empty strings — the caller reads the table, no per-body branching.
function _trajRingsSVG(body, cx, cy, zoom, az, el) {
  const cfg = typeof PROG_BODY_RINGS !== 'undefined' && PROG_BODY_RINGS[body];
  const basis = _trajRingPlaneBasis(body);
  if (!cfg || !basis) return { behind: '', front: '' };
  const runs = _trajRingAngleRuns(basis, az, el, 120);
  let behind = '', front = '';
  cfg.bands.forEach(band => {
    runs.forEach(run => {
      if (run.phis.length < 2) return;
      const d = _trajRingBandRunPath(basis, run, band.rOut, band.rIn, cx, cy, zoom, az, el);
      const piece = `<path d="${d}" fill="${band.color}"/>`;
      if (run.front) front += piece; else behind += piece;
    });
  });
  return { behind, front };
}
function _trajBodyDiscTiered(cx, cy, trueRpx, color, body, zoom, isFocus, forceLabel, clickId, viewT, sunDir3, viewportDiagPx) {
  const labelSize = Math.max(trueRpx, _TRAJ_CHIP_R);
  _trajRegisterLabel(cx, cy - labelSize, [{ text: body, dy: -4, fontPx: 10, color: color || 'var(--nm-label)' }], 'body',
    { screenSize: labelSize, minSize: _TRAJ_LOD_BODY_MIN, selected: !!isFocus || !!forceLabel });
  const clickAttr = clickId ? ` class="traj-body-glyph" style="cursor:pointer" onclick="trajGlyphClick('${clickId}','${body}')"` : '';
  let disc;
  if (trueRpx >= _TRAJ_CHIP_PX) {
    // item 2: middle plain-disc tier removed — surfaced disc renders all the
    // way down to the chip threshold (same constant-floor clamp as the old
    // tier 2 kept the disc from vanishing below _TRAJ_MIN_BODY_PX; feature
    // sampling itself is skipped internally below _TRAJ_FEATURE_PX).
    const r = Math.max(trueRpx, _TRAJ_MIN_BODY_PX);
    const spin = _trajBodySpinAngle(body, viewT);
    const az = _trajProjCtx.az, el = _trajProjCtx.el;
    let rasterUrl = null;
    if (r >= _TRAJ_FEATURE_PX && typeof PROG_TEXTURES !== 'undefined' && PROG_TEXTURES[body]) {
      rasterUrl = _trajRasteredDiscDataURL(body, r * 2, spin, az, el, sunDir3);
    }
    const atmoGlow = _trajAtmosphereGlowSVG(body, cx, cy, r, clickId || body);
    // Rings (item 4/5): rendered at both the raster and vector disc tiers —
    // never below the chip threshold this whole branch is already gated by —
    // and ride the same km->px zoom as the disc itself (world-geometry
    // layer). Split behind/front around the disc so occlusion is correct.
    const rings = _trajRingsSVG(body, cx, cy, zoom, az, el);
    if (rasterUrl) {
      // Globe bitmap → persistent layer (see _trajPendingGlobes note); only
      // the crisp border stays inline in the per-frame scene. Glow is drawn
      // inline (traj-scene paints above the globe layer) so it reads as a
      // soft rim right at the bitmap's edge.
      // Ring-behind content can't just go inline here: the raster globe
      // <image> lives in the PERSISTENT traj-globe-layer sibling, which
      // paints BEHIND the whole per-frame traj-scene (see _trajPendingGlobes
      // note above) — so inline content in `disc` would show IN FRONT of the
      // bitmap regardless of string order. Ship ringsBehind alongside the
      // pending globe so _trajReconcileGlobeLayer can place it in that same
      // layer, under the image, for correct occlusion.
      _trajPendingGlobes.push({ body, url: rasterUrl, x: cx - r, y: cy - r, size: r * 2, ringsBehind: rings.behind });
      disc = atmoGlow + `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="none" stroke="var(--border-bright)" stroke-width="0.5" vector-effect="non-scaling-stroke"/>` + rings.front;
    } else {
      disc = rings.behind + atmoGlow + _trajSurfacedDiscSVG(body, cx, cy, r, spin, sunDir3, viewportDiagPx, clickId) + rings.front;
    }
  } else {
    const glyph = _TRAJ_BODY_GLYPH[body] || '•';
    disc = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${_TRAJ_CHIP_R}" fill="var(--nm-bg)" fill-opacity="0.15" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
      `<text x="${cx.toFixed(2)}" y="${(cy + 3.2).toFixed(2)}" text-anchor="middle" font-size="9" fill="${color}">${glyph}</text>`;
  }
  const hit = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${Math.max(trueRpx, 7).toFixed(2)}" fill="transparent"/>`;
  return clickId ? `<g${clickAttr}>${disc}${hit}</g>` : `<g>${disc}</g>`;
}
