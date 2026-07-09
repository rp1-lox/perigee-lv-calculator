
// ─── TRAJECTORY VIEW — Phase O1-a: framework + static solar system ──────────
// Third mission view: a 2D true-geometry orbital map ("2D KSP/SFS-like"),
// restrained blueprint style (thin strokes, mono labels, theme colors — NOT
// cartoon). This phase builds the canvas, scenes, and static content only.
// Mission orbits / transfer arcs are injected by a LATER run through the
// documented extension point _trajSceneContent() at the bottom of this file.
//
// Module-local, session-only state (NOT authored — never touches m.log or
// autosave; focus/zoom reset on reload, same spirit as _missionNmZoom but
// kept separate per mission id so switching missions doesn't fight itself).
let _trajFocusByMission = {};   // missionId -> body name ('SUN','Earth','Moon',...)
let _trajZoomByMission  = {};   // missionId -> zoom factor
let _trajPanByMission   = {};   // missionId -> {x,y} pan offset (px, scene-local)

const _TRAJ_ZMIN = 0.15, _TRAJ_ZMAX = 20;

// ── body -> chrome color mapping ─────────────────────────────────────────
// Reuses the node-map's --nm-* seeds so the trajectory view stays in the same
// theme family as Orbit Map rather than inventing a new palette:
//   Earth              -> --nm-earth
//   Moon, Titan (moons) -> --nm-lunar
//   every other body    -> --nm-interp
//   Sun glyph            -> --warn (closest existing "star/energy" seed)
function _trajBodyColor(body) {
  if (body === 'SUN') return 'var(--warn)';
  if (body === 'Earth') return 'var(--nm-earth)';
  if (PROG_MOON_ORBITS && PROG_MOON_ORBITS[body]) return 'var(--nm-lunar)';
  return 'var(--nm-interp)';
}

// ── scene catalog ────────────────────────────────────────────────────────
// A "scene" is either the Sun (all planets) or a body's local system (the
// body + its moons, if any). Generated from PROG_BODIES / PROG_HELIO_R /
// PROG_MOON_ORBITS so new bodies/moons added to those data tables show up
// here automatically — no hand-listing.
function _trajSceneList() {
  const scenes = [{ id: 'SUN', label: 'Sun' }];
  // Any body with a heliocentric radius is a planet scene.
  Object.keys(PROG_HELIO_R).forEach(b => scenes.push({ id: b, label: b }));
  // Also include bodies that host moons even if (hypothetically) not in
  // PROG_HELIO_R, and always include Earth (has PROG_HELIO_R already).
  Object.values(PROG_MOON_ORBITS || {}).forEach(mo => {
    if (!scenes.find(s => s.id === mo.parent)) scenes.push({ id: mo.parent, label: mo.parent });
  });
  return scenes;
}

function _trajMoonsOf(body) {
  return Object.entries(PROG_MOON_ORBITS || {})
    .filter(([, mo]) => mo.parent === body)
    .map(([name, mo]) => ({ name, r: mo.r }));
}

function _trajFocus(m) { return _trajFocusByMission[m.missionId] || 'Earth'; }
function _trajZoom(m)  { return _trajZoomByMission[m.missionId]  || 1; }
function _trajPan(m)   { return _trajPanByMission[m.missionId]   || { x: 0, y: 0 }; }

function trajSetFocus(id, body) {
  _trajFocusByMission[id] = body;
  _trajZoomByMission[id]  = 1;
  _trajPanByMission[id]   = { x: 0, y: 0 };
  missionRenderDetail();
}

function trajResetView(id) {
  _trajZoomByMission[id] = 1;
  _trajPanByMission[id]  = { x: 0, y: 0 };
  missionRenderDetail();
}

function trajWheelZoom(ev, id) {
  ev.preventDefault();
  const svg = ev.currentTarget.querySelector('svg.traj-svg') || ev.currentTarget;
  const prev = _trajZoomByMission[id] || 1;
  const dir = ev.deltaY < 0 ? 1 : -1;
  const next = Math.max(_TRAJ_ZMIN, Math.min(_TRAJ_ZMAX, prev * (1 + dir * 0.15)));
  if (next === prev) return;
  _trajZoomByMission[id] = next;
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"]`);
  if (va) {
    const svgEl = va.querySelector('svg.traj-svg');
    if (svgEl) { svgEl.style.width = (400 * next) + 'px'; svgEl.style.height = (400 * next) + 'px'; }
  } else {
    missionRenderDetail();
  }
}

let _trajDrag = null;
// Set true when a pan-drag actually moved the pointer (>3px, same threshold as
// the node map's missionNmPanMove) so the click that follows a real drag on an
// interactive arc/marker/ring doesn't also select an event (drag-vs-click
// disambiguation, per the node map / library-browser _didDrag pattern).
let _trajJustDragged = false;
function trajPanStart(ev, id) {
  _trajDrag = { id, x0: ev.clientX, y0: ev.clientY, pan0: Object.assign({}, _trajPan({ missionId: id })), moved: false };
  ev.preventDefault();
}
function trajPanMove(ev) {
  if (!_trajDrag) return;
  const dx = ev.clientX - _trajDrag.x0, dy = ev.clientY - _trajDrag.y0;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _trajDrag.moved = true;
  const p = { x: _trajDrag.pan0.x + dx, y: _trajDrag.pan0.y + dy };
  _trajPanByMission[_trajDrag.id] = p;
  const el = document.querySelector(`.mcc-view-area .traj-scene[data-mid="${_trajDrag.id}"]`);
  if (el) el.setAttribute('transform', `translate(${p.x},${p.y})`);
}
function trajPanEnd() {
  if (_trajDrag) _trajJustDragged = _trajDrag.moved;
  _trajDrag = null;
}

// ── O1-b: mission content extraction ─────────────────────────────────────
// Everything below reads the REPLAYED log (m._expanded, populated by
// missionRecompute — each entry carries e.snapshot[] of live-vehicle states
// AFTER that event, plus e.metStart / e.dvRequired / e.dvDelivered / e.fromNode
// / e.toNode for MANEUVER, e.days for COAST). Positions along orbits are NOT
// modeled — this is a geometry-true, time-schematic map, per the design brief.

// A scene-local orbit record: { key, body, a, e, r_peri, r_apo, label, colors:Set, names:Set }
// key dedupes identical orbits (rounded so float noise from repeated snapshots
// doesn't fork the same LEO into two near-identical rings).
function _trajOrbitKey(body, peri, apo) {
  return body + '|' + Math.round(peri) + '|' + Math.round(apo);
}

// Detects a transit-corridor snapshot (e.g. a TLC leg captured mid-coast: peri
// near a low parking orbit, apo near a moon's orbital radius around `body`) so
// it can be labeled "TLC corridor"-style instead of a raw "185×378000" ring —
// per the O1-c polish brief. Tolerance is generous (2%) since these are
// snapshot-of-the-moment radii, not exact apsides.
function _trajCorridorMoon(body, apo) {
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  const moons = _trajMoonsOf(body);
  for (const mo of moons) {
    if (Math.abs((apo + R) - mo.r) < mo.r * 0.02) return mo.name;
  }
  return null;
}

function _trajOrbitLabel(body, peri, apo) {
  const corridorMoon = _trajCorridorMoon(body, apo);
  if (corridorMoon) return `T${corridorMoon.slice(0, 1).toUpperCase()}C corridor`; // "TLC corridor" for Moon, generalized initial for other moons
  // ORBIT_CATEGORIES (060) is an array of {planet, orbits:[{name,mode,perigee,apogee,...}]}
  // grouped by planet — find this body's group, then match on peri/apo within tolerance
  // for a friendlier label ("LEO 200 km" instead of "200×200").
  const group = (typeof ORBIT_CATEGORIES !== 'undefined') ? ORBIT_CATEGORIES.find(g => g.planet === body) : null;
  if (group) {
    for (const cat of group.orbits) {
      if (cat.mode === 'orbit' && cat.perigee != null && Math.abs(cat.perigee - peri) < 50 && cat.apogee != null && Math.abs(cat.apogee - apo) < 50) {
        return cat.name;
      }
    }
  }
  const prefix = body === 'Earth' ? '' : (body + ' ');
  const rounded = Math.round(peri);
  return Math.abs(apo - peri) < 5 ? `${prefix}${rounded}` : `${prefix}${rounded}×${Math.round(apo)}`;
}

// Which scene (body name, or 'SUN' for interplanetary/heliocentric legs) an
// orbit/transit record belongs in.
function _trajSceneForOrbit(o) {
  if (!o) return null;
  if (o.transit && o.body === 'Sun') return 'SUN';
  if (o.transit) return o.body || 'Earth'; // translunar etc — parent body's local scene
  if (o.escape) return o.body || 'Earth';
  return o.body || 'Earth';
}

// Walk m._expanded snapshots, building per-scene: orbit rings, transfer legs,
// burn markers, and surface events. Cached per mission per render call (cheap
// enough to just recompute; log length is small).
function _trajExtractMission(m) {
  const scenes = {}; // sceneId -> { orbits: Map<key,rec>, legs: [], surface: [] }
  const sceneFor = id => (scenes[id] = scenes[id] || { orbits: new Map(), legs: [], surface: [] });
  const log = (m && m._expanded && m._expanded.length) ? m._expanded : (m ? (m.log || []) : []);
  if (!log.length) return scenes;

  const laneColorFor = (ownerKeys) => {
    if (!ownerKeys || !ownerKeys.length) return null;
    const key = ownerKeys[0];
    const label = (m._ownerLabels && m._ownerLabels[key]) || null;
    if (!label) return null;
    // fallbackIdx doesn't matter for coloring purposes if a custom color is set;
    // otherwise fall back to a stable hash of the label so re-renders don't flicker.
    let idx = 0; for (let i = 0; i < label.length; i++) idx = (idx * 31 + label.charCodeAt(i)) >>> 0;
    return { color: _missionLaneColor(m, label, idx), label };
  };

  const addOrbitRing = (body, peri, apo, ownerKeys, authIdx) => {
    if (body == null || peri == null || apo == null) return null;
    const sceneId = body;
    const sc = sceneFor(sceneId);
    const key = _trajOrbitKey(body, peri, apo);
    const lane = laneColorFor(ownerKeys);
    if (!sc.orbits.has(key)) {
      sc.orbits.set(key, {
        key, body, peri, apo,
        label: _trajOrbitLabel(body, peri, apo),
        colors: new Set(), names: new Set(),
        firstAuthIdx: authIdx != null ? authIdx : null,  // first authored event that put a vehicle in this orbit (for click-to-select)
      });
    }
    const rec = sc.orbits.get(key);
    if (lane) { rec.colors.add(lane.color); rec.names.add(lane.label); }
    if (authIdx != null && rec.firstAuthIdx == null) rec.firstAuthIdx = authIdx;
    return rec;
  };

  // ── snapshots: every distinct orbit any vehicle occupies ─────────────────
  log.forEach(e => {
    (e.snapshot || []).forEach(v => {
      if (!v.orbit || v.orbit.surface) return;
      const o = v.orbit;
      const peri = o.perigee ?? o.apogee ?? 0, apo = o.apogee ?? o.perigee ?? 0;
      if (!(peri > 0) && !(apo > 0)) return; // skip degenerate/zero orbits
      addOrbitRing(o.body || 'Earth', peri, apo, v.owners, e._authIdx);
    });
  });

  // ── surface events: LAUNCH / (REENTER-derived) LAND ──────────────────────
  log.forEach(e => {
    if (e.type === 'LAUNCH') {
      const body = (e.launchOrbit && e.launchOrbit.body) || 'Earth';
      sceneFor(body).surface.push({ kind: 'launch', body, label: 'Launch', met: e.metStart });
    } else if (e.type === 'REENTER' || e.type === 'RECOVER') {
      const body = (e.orbitAfter && e.orbitAfter.body) || 'Earth';
      sceneFor(body).surface.push({ kind: 'land', body, label: e.type === 'RECOVER' ? 'Recovery' : 'Landing', met: e.metStart });
    }
  });

  // ── transfer legs: MANEUVER events with a from/to node pair ──────────────
  log.forEach(e => {
    if (e.type !== 'MANEUVER' || !e.fromNode || !e.toNode) return;
    const fromN = _missionNmNodeById(e.fromNode), toN = _missionNmNodeById(e.toNode);
    if (!fromN || !toN || !fromN.orbit || !toN.orbit) return;
    const fromO = fromN.orbit, toO = toN.orbit;
    const sceneId = _trajSceneForOrbit(toO) || _trajSceneForOrbit(fromO);
    if (!sceneId) return;
    const lane = laneColorFor(_trajOwnerKeysForManeuver(e));
    const dvUsed = (e.dvDelivered != null ? e.dvDelivered : e.dvRequired) || 0;
    const metArrive = (e.metStart != null && e.durationUsed != null) ? (e.metStart + e.durationUsed) : null;
    const vehName = (_trajOwnerKeysForManeuver(e) && m._ownerLabels && m._ownerLabels[_trajOwnerKeysForManeuver(e)[0]]) || e.activeName || '';
    sceneFor(sceneId).legs.push({
      sceneId, fromO, toO, fromLabel: e.fromLabel || fromN.label, toLabel: e.toLabel || toN.label,
      dv: dvUsed, met: e.metStart, metArrive, vehName,
      color: lane ? lane.color : null, key: e._authIdx != null ? ('mv' + e._authIdx + '#' + (e._rep || 0)) : ('mv' + Math.random()),
      authIdx: e._authIdx != null ? e._authIdx : null,
    });
  });

  // ── COAST loiter badges: attach to the orbit ring active at that point ───
  log.forEach((e, i) => {
    if (e.type !== 'COAST') return;
    const snap = e.snapshot || [];
    // pick the first non-surface orbit in this snapshot as "where we're loitering"
    const v = snap.find(vv => vv.orbit && !vv.orbit.surface && ((vv.orbit.perigee ?? 0) > 0 || (vv.orbit.apogee ?? 0) > 0));
    if (!v) return;
    const o = v.orbit;
    const peri = o.perigee ?? o.apogee ?? 0, apo = o.apogee ?? o.perigee ?? 0;
    const rec = addOrbitRing(o.body || 'Earth', peri, apo, v.owners, e._authIdx);
    if (rec) { rec.coast = rec.coast || []; rec.coast.push({ days: e.days || 0 }); }
  });

  return scenes;
}

// A MANEUVER event doesn't carry v.owners directly — resolve via the active
// vehicle key (activeKey) against m._ownerLabels-keyed owner sets is indirect,
// so instead prefer the destination snapshot's owners for the SAME event (the
// vehicle that just arrived is the one that flew the leg).
function _trajOwnerKeysForManeuver(e) {
  const snap = e.snapshot || [];
  if (!snap.length) return null;
  // the maneuvering vehicle is whichever snapshot entry has the fewest/most recent
  // owners overlap; simplest reliable pick: first non-empty owners array.
  const v = snap.find(vv => vv.owners && vv.owners.length);
  return v ? v.owners : null;
}

// ── geometry helpers ──────────────────────────────────────────────────────
// True-geometry ellipse for a (peri,apo) orbit around a body of radius R,
// focus at the body center (origin in scene-local coords). Returns SVG-ready
// numbers in KM (caller applies scene `scale`).
//   a       = semi-major axis
//   c       = center-to-focus distance = a - r_peri
//   cx      = -c  (center is on the -x side since periapsis is drawn at +x)
// Periapsis is placed at angle 0 (local +x) by convention; ellipses are drawn
// axis-aligned then rotated by `rotDeg` for schematic orientation variety.
function _trajEllipseGeom(peri, apo, R) {
  const rPeri = R + peri, rApo = R + apo;
  const a = (rPeri + rApo) / 2;
  const b = Math.sqrt(Math.max(0, rPeri * rApo));
  const c = a - rPeri; // signed offset from focus to center along +x
  return { rPeri, rApo, a, b, c };
}

function _trajRingSVG(rec, body, scale, color, opts) {
  opts = opts || {};
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  const g = _trajEllipseGeom(rec.peri, rec.apo, R);
  const isCircle = Math.abs(rec.apo - rec.peri) < Math.max(1, R * 0.001);
  const emphasized = !!opts.emphasized;
  const strokeColor = emphasized ? 'var(--accent)' : (color || (rec.colors.size === 1 ? [...rec.colors][0] : 'var(--accent)'));
  const strokeW = emphasized ? 1.4 : 0.7;
  const opacity = emphasized ? 1 : 0.85;
  const names = [...rec.names].join(', ');
  const title = `${names ? names + ' — ' : ''}${rec.label}`;
  const clickAttr = opts.authIdx != null ? ` style="cursor:pointer" onclick="_trajSelectEventFromView('${opts.missionId}',${opts.authIdx})"` : '';
  // loiter badge: placed just below the ring label, at the ellipse center's x
  // (a legible spot regardless of eccentricity, not tied to a specific apsis).
  const coastBadge = rec.coast && rec.coast.length
    ? `<text x="${(g.c * scale).toFixed(2)}" y="-6" text-anchor="middle" font-family="var(--mono)" font-size="6" fill="var(--nm-label)">&#x27F3; ${Math.round(rec.coast.reduce((s, c) => s + (c.days || 0), 0))}d</text>`
    : '';
  if (isCircle) {
    const r = ((rec.peri + rec.apo) / 2 + R) * scale;
    const hitArea = opts.authIdx != null ? `<circle cx="0" cy="0" r="${r.toFixed(2)}" fill="none" stroke="transparent" stroke-width="9"${clickAttr}/>` : '';
    return `<g${clickAttr}>
      <circle cx="0" cy="0" r="${r.toFixed(2)}" fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" opacity="${opacity}"><title>${title}</title></circle>
      ${hitArea}
      <text x="0" y="${(-r - 4).toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="6.5" fill="var(--nm-label)">${rec.label}</text>
      ${coastBadge}
    </g>`;
  }
  const cx = g.c * scale, cy = 0, rx = g.a * scale, ry = g.b * scale;
  const hitArea = opts.authIdx != null ? `<ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="none" stroke="transparent" stroke-width="9"${clickAttr}/>` : '';
  return `<g${clickAttr}>
    <ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" opacity="${opacity}"><title>${title}</title></ellipse>
    ${hitArea}
    <text x="${cx.toFixed(2)}" y="${(cy - ry - 4).toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="6.5" fill="var(--nm-label)">${rec.label}</text>
    ${coastBadge}
  </g>`;
}

// Half-ellipse Hohmann transfer arc between r1 (departure) and r2 (arrival),
// both body-centered radii (R already included). Drawn as an SVG elliptical
// arc path from periapsis to apoapsis (or vice versa), at a given rotation.
function _trajTransferArcPath(r1, r2, scale, rotDeg) {
  const rPeri = Math.min(r1, r2), rApo = Math.max(r1, r2);
  const a = (rPeri + rApo) / 2, b = Math.sqrt(Math.max(0, rPeri * rApo)), c = a - rPeri;
  const rot = rotDeg || 0;
  const rad = rot * Math.PI / 180;
  const rotp = (x, y) => ({ x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) });
  // local (unrotated) ellipse centered at (c,0)*scale, periapsis at local (rPeri,0), apoapsis at local (-rApo,0)
  const p1l = { x: rPeri * scale, y: 0 };
  const p2l = { x: -rApo * scale, y: 0 };
  const p1 = rotp(p1l.x, p1l.y), p2 = rotp(p2l.x, p2l.y);
  const rx = (a * scale).toFixed(2), ry = (b * scale).toFixed(2);
  const rotDegAttr = rot.toFixed(1);
  // half-ellipse: large-arc-flag 0, sweep depends on orientation but 0/1 both draw
  // a half; pick 1 for a consistent "upper" half visually.
  return { d: `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${rx} ${ry} ${rotDegAttr} 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
           depX: p1.x, depY: p1.y, arrX: p2.x, arrY: p2.y };
}

function _trajBurnMarker(x, y, dir, dvText, metText, opts) {
  opts = opts || {};
  const glyph = dir === 'up' ? '▲' : '▼';
  const emphasized = !!opts.emphasized;
  const strokeColor = emphasized ? 'var(--accent)' : 'var(--accent2)';
  const strokeW = emphasized ? 1.3 : 0.8;
  const textColor = emphasized ? 'var(--accent)' : 'var(--accent2)';
  const clickAttr = opts.authIdx != null ? ` style="cursor:pointer" onclick="event.stopPropagation();_trajSelectEventFromView('${opts.missionId}',${opts.authIdx})"` : '';
  const titleTxt = opts.title || '';
  // invisible wider hit-area circle on top of the small visible marker so it's
  // easy to click without the strokes needing to be thick (standard trick, see
  // node map / library-browser drag-vs-click patterns).
  const hitArea = opts.authIdx != null
    ? `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="7" fill="transparent"${clickAttr}><title>${titleTxt}</title></circle>` : '';
  return `<g${clickAttr}>
    <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${emphasized ? 2.4 : 2}" fill="var(--nm-bg)" stroke="${strokeColor}" stroke-width="${strokeW}"/>
    <text x="${x.toFixed(2)}" y="${(y - 5).toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="6" fill="${textColor}">${glyph} ${dvText}</text>
    <text x="${x.toFixed(2)}" y="${(y + 9).toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="5.5" fill="var(--text-dim)">${metText}</text>
    ${hitArea}
  </g>`;
}

// Click handler shared by arcs/markers/rings: selects the AUTHORED event
// (expands its card + rewinds the state panel via existing missionSelectEvent
// behavior). Guarded against firing after a real pan-drag (see trajCanvasDown).
function _trajSelectEventFromView(id, authIdx) {
  if (_trajJustDragged) { _trajJustDragged = false; return; }
  if (typeof missionSelectEvent === 'function') missionSelectEvent(id, authIdx);
}

// Compute the min zoom-worthy extent (max body-centered / heliocentric radius,
// km) of a scene's MISSION content only (orbit apoapses + transfer/legs'
// far endpoint) — used to pick the initial fit-to-content scale, per the
// design brief (static rings beyond remain reachable by zooming out further).
function _trajMissionExtent(scene, m) {
  const scenes = _trajGetExtraction(m);
  const sc = scenes[scene];
  if (!sc) return 0;
  const body = scene === 'SUN' ? null : scene;
  const R = body ? ((PROG_BODIES[body] && PROG_BODIES[body].R) || 0) : 0;
  let maxR = 0;
  sc.orbits.forEach(rec => { maxR = Math.max(maxR, R + rec.apo); });
  sc.legs.forEach(leg => {
    if (scene === 'SUN') {
      const r1 = PROG_HELIO_R[leg.fromO.body], r2 = PROG_HELIO_R[leg.toO.body];
      if (r1 != null) maxR = Math.max(maxR, r1);
      if (r2 != null) maxR = Math.max(maxR, r2);
    } else {
      const r1 = _trajLocalRadius(leg.fromO, body), r2 = _trajLocalRadius(leg.toO, body);
      if (r1 != null) maxR = Math.max(maxR, r1);
      if (r2 != null) maxR = Math.max(maxR, r2);
    }
  });
  return maxR;
}

// Per-render extraction cache, keyed by missionId so switching missions (or a
// stale reference from a prior render) can't leak state across renders.
let _trajExtractionCache = { missionId: null, data: null };
function _trajGetExtraction(m) {
  if (!m) return {};
  if (_trajExtractionCache.missionId === m.missionId && _trajExtractionCache.data) return _trajExtractionCache.data;
  const data = _trajExtractMission(m);
  _trajExtractionCache = { missionId: m.missionId, data };
  return data;
}

// ── extension point for O1-b ─────────────────────────────────────────────
// Returns extra SVG markup (groups/paths) to overlay on top of the static
// scene for the given scene id ('SUN' or a body name). `scale` is the scene's
// resolved px-per-km factor (already fit to whichever is larger: static
// content or mission content — see _trajSunSceneSVG / _trajBodySceneSVG).
// Authored index of the currently-selected (expanded) event, or null. Single
// source of truth for O1-c emphasis — reads m.log's e._expanded flag, the same
// one missionSelectEvent()/the events panel use, so the two views can't drift.
function _trajSelectedAuthIdx(m) {
  if (!m || !m.log) return null;
  const idx = m.log.findIndex(e => e._expanded);
  return idx >= 0 ? idx : null;
}

function _trajSceneContent(scene, m, scale) {
  if (!m) return '';
  const scenes = _trajGetExtraction(m);
  const sc = scenes[scene];
  if (!sc) return '';
  const body = scene === 'SUN' ? null : scene;
  const R = body ? ((PROG_BODIES[body] && PROG_BODIES[body].R) || 0) : 0;
  scale = scale || 1;
  const id = m.missionId;
  const selAuthIdx = _trajSelectedAuthIdx(m);

  let out = '';

  // orbit rings (skip for SUN scene — heliocentric transit legs are drawn as
  // arcs between the static planet rings, not as a new "orbit" of the Sun)
  if (body) {
    sc.orbits.forEach(rec => {
      const emphasized = selAuthIdx != null && rec.firstAuthIdx === selAuthIdx;
      out += _trajRingSVG(rec, body, scale, rec.colors.size === 1 ? [...rec.colors][0] : null,
        { emphasized, authIdx: rec.firstAuthIdx, missionId: id });
    });
  }

  // transfer legs
  sc.legs.forEach((leg, li) => {
    const emphasized = selAuthIdx != null && leg.authIdx === selAuthIdx;
    const clickAttr = leg.authIdx != null ? ` style="cursor:pointer" onclick="_trajSelectEventFromView('${id}',${leg.authIdx})"` : '';
    const hoverTitle = `${leg.vehName ? leg.vehName + ' — ' : ''}${leg.fromLabel} → ${leg.toLabel}${leg.dv ? ' &middot; ' + _trajDvText(leg.dv) : ''}${leg.met != null ? ' &middot; ' + _metFmt(leg.met) : ''}`;
    const markerOpts = (dir) => ({ emphasized, authIdx: leg.authIdx, missionId: id, title: hoverTitle });
    if (scene === 'SUN') {
      const r1 = PROG_HELIO_R[leg.fromO.body] || PROG_HELIO_R[leg.fromLabel] || null;
      const r2 = PROG_HELIO_R[leg.toO.body] || PROG_HELIO_R[leg.toLabel] || null;
      if (r1 == null || r2 == null) return;
      const departAng = _trajPlanetAngle(leg.fromO.body);
      const arc = _trajTransferArcPath(r1, r2, scale, departAng);
      const color = emphasized ? 'var(--accent)' : (leg.color || 'var(--accent2)');
      const strokeW = emphasized ? 1.2 : 0.7;
      const opacity = emphasized ? 1 : 0.8;
      // invisible wider hit-area stroke over the thin dashed arc (visible strokes stay thin/blueprint).
      const hitArea = leg.authIdx != null ? `<path d="${arc.d}" fill="none" stroke="transparent" stroke-width="8"${clickAttr}/>` : '';
      out += `<path d="${arc.d}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-dasharray="2.5,2" opacity="${opacity}"${clickAttr}><title>${hoverTitle}</title></path>${hitArea}`;
      out += _trajBurnMarker(arc.depX, arc.depY, 'up', _trajDvText(leg.dv), _metFmt(leg.met), markerOpts());
      out += _trajBurnMarker(arc.arrX, arc.arrY, 'down', '', _metFmt(leg.metArrive), markerOpts());
      return;
    }
    // local-body-frame leg: translunar (Earth scene, r2=Moon ring) or a normal
    // circular/elliptic-to-circular/elliptic transfer within the same body's SOI.
    const fromR = _trajLocalRadius(leg.fromO, body);
    const toR = _trajLocalRadius(leg.toO, body);
    if (fromR == null || toR == null) return;
    const arc = _trajTransferArcPath(fromR, toR, scale, 20 + (li * 35) % 360);
    const color = emphasized ? 'var(--accent)' : (leg.color || 'var(--accent2)');
    const strokeW = emphasized ? 1.2 : 0.7;
    const opacity = emphasized ? 1 : 0.8;
    const hitArea = leg.authIdx != null ? `<path d="${arc.d}" fill="none" stroke="transparent" stroke-width="8"${clickAttr}/>` : '';
    out += `<path d="${arc.d}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-dasharray="2.5,2" opacity="${opacity}"${clickAttr}><title>${hoverTitle}</title></path>${hitArea}`;
    out += _trajBurnMarker(arc.depX, arc.depY, 'up', _trajDvText(leg.dv), _metFmt(leg.met), markerOpts());
    out += _trajBurnMarker(arc.arrX, arc.arrY, 'down', '', _metFmt(leg.metArrive), markerOpts());
  });

  // surface events
  sc.surface.forEach(s => {
    const ang = s.kind === 'launch' ? -90 : 90; // launch at top, landing at bottom of disc — schematic
    const rad = ang * Math.PI / 180;
    const bodyPxR = Math.max(4, R * scale * 0.02);
    const x = bodyPxR * Math.cos(rad), y = bodyPxR * Math.sin(rad);
    out += `<g><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.6" fill="var(--accent3)"/>
      <text x="${x.toFixed(2)}" y="${(y + (s.kind === 'launch' ? -5 : 10)).toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="6" fill="var(--accent3)">${s.label}</text></g>`;
  });

  return out;
}

function _trajDvText(dv) {
  return dv ? Math.round(dv).toLocaleString() + ' m/s' : '';
}

// Body-centered radius (km, including body R) for a node-map orbit spec, in
// the given scene body's local frame. Returns null if the orbit isn't in this
// body's local frame (e.g. a transit/escape leg that belongs to a different scene).
function _trajLocalRadius(o, body) {
  if (!o) return null;
  if (o.type === 'transit') {
    // translunar/etc: departure end is a parking-orbit radius in `body`'s frame,
    // arrival end is the destination body's orbital radius around `body`.
    if (o.destination) {
      const mo = PROG_MOON_ORBITS[o.destination];
      if (mo && mo.parent === body) return mo.r;
    }
    return null;
  }
  if (o.body !== body) return null;
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  if (o.type === 'surface') return R;
  const peri = o.perigee ?? o.apogee ?? 0, apo = o.apogee ?? o.perigee ?? 0;
  return R + (peri + apo) / 2; // transfer endpoints use mean radius as departure/arrival point
}

// Schematic angle for a planet in the Sun scene, matching _trajSunSceneSVG's
// own layout (index order in PROG_HELIO_R, spread evenly) — kept in sync so
// transfer arcs originate at the visually-drawn ring position.
function _trajPlanetAngle(body) {
  const bodies = Object.keys(PROG_HELIO_R);
  const i = bodies.indexOf(body);
  if (i < 0) return 0;
  return (i / bodies.length) * 360 - 90;
}

// ── SVG builders ──────────────────────────────────────────────────────────
// Fixed viewBox; scale factors computed per scene so the ring set fits with
// headroom, then the wheel/drag zoom multiplies on top via CSS width/height
// (linear true scale — no log compression of distances).
const _TRAJ_VB = 400; // viewBox is 0..400 in both axes, origin translated to center

function _trajGlyph(cx, cy, r, color, label) {
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="var(--border-bright)" stroke-width="0.5"/>
    <text x="${cx}" y="${cy - r - 4}" text-anchor="middle" font-family="var(--mono)" font-size="7" fill="var(--nm-label)">${label}</text>
  </g>`;
}

// Default initial scale fits the MISSION's extent in this scene (min zoom that
// shows all mission orbits/arcs + the body), not the static maxR — per the O1-b
// design brief. Static rings beyond remain reachable by zooming out (user zoom
// is unbounded down to _TRAJ_ZMIN). Falls back to staticMaxR when the mission
// has no content in this scene (or no mission at all — static phase view).
function _trajFitScale(staticMaxR, missionMaxR) {
  const fitR = (missionMaxR > 0 && missionMaxR < staticMaxR) ? missionMaxR : staticMaxR;
  return (_TRAJ_VB / 2 - 20) / Math.max(1, fitR);
}

function _trajSunSceneSVG(m) {
  const bodies = Object.keys(PROG_HELIO_R);
  const staticMaxR = Math.max(...bodies.map(b => PROG_HELIO_R[b]));
  const missionMaxR = m ? _trajMissionExtent('SUN', m) : 0;
  const scale = _trajFitScale(staticMaxR, missionMaxR);
  const rings = bodies.map((b, i) => {
    const rr = PROG_HELIO_R[b] * scale;
    const ang = (i / bodies.length) * 2 * Math.PI - Math.PI / 2; // spread angles so labels don't collide
    const cx = rr * Math.cos(ang), cy = rr * Math.sin(ang);
    const color = _trajBodyColor(b);
    return `<circle cx="0" cy="0" r="${rr.toFixed(2)}" fill="none" stroke="${color}" stroke-width="0.6" opacity="0.55"/>`
      + _trajGlyph(cx, cy, 3, color, b);
  }).join('');
  const sun = _trajGlyph(0, 0, 6, _trajBodyColor('SUN'), 'Sun');
  return `${rings}${sun}${_trajSceneContent('SUN', m, scale)}`;
}

function _trajBodySceneSVG(body, m) {
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 6371;
  const moons = _trajMoonsOf(body);
  const staticMaxR = moons.length ? Math.max(...moons.map(mo => mo.r)) : R * 4;
  const missionMaxR = m ? _trajMissionExtent(body, m) : 0;
  const scale = _trajFitScale(staticMaxR, missionMaxR);
  const moonRings = moons.map(mo => {
    const rr = mo.r * scale;
    const color = _trajBodyColor(mo.name);
    return `<circle cx="0" cy="0" r="${rr.toFixed(2)}" fill="none" stroke="${color}" stroke-width="0.6" opacity="0.55"/>`
      + _trajGlyph(rr, 0, 3, color, mo.name);
  }).join('');
  // body disc at true scale (min visible radius clamp so it doesn't vanish)
  const bodyPxR = Math.max(4, R * scale * 0.02); // body radius is tiny vs moon-orbit scale — clamp for visibility, disc is schematic-scale not orbit-scale
  const discColor = _trajBodyColor(body);
  const disc = _trajGlyph(0, 0, bodyPxR, discColor, body);
  return `${moonRings}${disc}${_trajSceneContent(body, m, scale)}`;
}

function _trajSceneSVG(scene, m) {
  return scene === 'SUN' ? _trajSunSceneSVG(m) : _trajBodySceneSVG(scene, m);
}

// Which scene(s) hold content (an orbit ring or a transfer leg) tied to the
// given authored event index. Used for the "event in EARTH scene → switch"
// hint chip when the selected event's content lives outside the current focus.
function _trajScenesForAuthIdx(m, authIdx) {
  if (authIdx == null) return [];
  const scenes = _trajGetExtraction(m);
  const hits = [];
  Object.keys(scenes).forEach(sceneId => {
    const sc = scenes[sceneId];
    const hasOrbit = [...sc.orbits.values()].some(rec => rec.firstAuthIdx === authIdx);
    const hasLeg = sc.legs.some(leg => leg.authIdx === authIdx);
    if (hasOrbit || hasLeg) hits.push(sceneId);
  });
  return hits;
}

// ── top-level view builder (called from missionRenderDetail via 570's hook) ──
function _missionTrajViewHTML(m) {
  const id = m.missionId;
  _trajExtractionCache = { missionId: null, data: null }; // force fresh extraction each render (mission log may have changed)
  const focus = _trajFocus(m);
  const zoom = _trajZoom(m);
  const pan = _trajPan(m);
  const scenes = _trajSceneList();
  const focusSeg = scenes.map(s =>
    `<button class="${focus === s.id ? 'active' : ''}" onclick="trajSetFocus('${id}','${s.id}')">${s.label}</button>`
  ).join('');

  const svgInner = _trajSceneSVG(focus, m);
  const px = Math.round(_TRAJ_VB * zoom);

  // Selection hint chip: if the selected event's content lives in a scene
  // other than the current focus, offer a one-click switch instead of
  // auto-switching (per the O1-c brief — don't yank the user's view).
  const selAuthIdx = _trajSelectedAuthIdx(m);
  let hintChip = '';
  if (selAuthIdx != null) {
    const hitScenes = _trajScenesForAuthIdx(m, selAuthIdx).filter(s => s !== focus);
    if (hitScenes.length) {
      const target = hitScenes[0];
      const label = (scenes.find(s => s.id === target) || { label: target }).label;
      hintChip = `<div class="traj-hint-chip" onclick="trajSetFocus('${id}','${target}')" title="Switch to the ${label} scene">event in ${label.toUpperCase()} scene &rarr; switch</div>`;
    }
  }

  return `
    <div class="traj-wrap" data-mid="${id}">
      <div class="traj-toolbar">
        <div class="seg traj-focus-seg">${focusSeg}</div>
        <button class="act-btn" onclick="trajResetView('${id}')" title="Reset zoom/pan">&#x21BA; Reset</button>
      </div>
      <div class="traj-canvas" onwheel="trajWheelZoom(event,'${id}')"
           onmousedown="trajPanStart(event,'${id}')" onmousemove="trajPanMove(event)"
           onmouseup="trajPanEnd()" onmouseleave="trajPanEnd()">
        ${hintChip}
        <svg class="traj-svg" viewBox="-${_TRAJ_VB/2} -${_TRAJ_VB/2} ${_TRAJ_VB} ${_TRAJ_VB}"
             style="width:${px}px;height:${px}px;">
          <g class="traj-scene" data-mid="${id}" transform="translate(${pan.x},${pan.y})">
            ${svgInner}
          </g>
        </svg>
      </div>
      <div class="traj-footer">coplanar view — inclination/LAN annotated, not drawn &middot; planet positions schematic</div>
    </div>`;
}

// Called by 570 right after render (mirrors _missionCenterNmEarth). Nothing to
// do yet in the static phase — kept as a hook so O1-b can center/frame on
// injected mission content without touching 570 again.
function _missionTrajAfterRender(m) {
  // no-op (extension point for future centering logic)
}
