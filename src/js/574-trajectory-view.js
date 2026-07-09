
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
function trajPanStart(ev, id) {
  _trajDrag = { id, x0: ev.clientX, y0: ev.clientY, pan0: Object.assign({}, _trajPan({ missionId: id })) };
  ev.preventDefault();
}
function trajPanMove(ev) {
  if (!_trajDrag) return;
  const dx = ev.clientX - _trajDrag.x0, dy = ev.clientY - _trajDrag.y0;
  const p = { x: _trajDrag.pan0.x + dx, y: _trajDrag.pan0.y + dy };
  _trajPanByMission[_trajDrag.id] = p;
  const el = document.querySelector(`.mcc-view-area .traj-scene[data-mid="${_trajDrag.id}"]`);
  if (el) el.setAttribute('transform', `translate(${p.x},${p.y})`);
}
function trajPanEnd() { _trajDrag = null; }

// ── extension point for O1-b ─────────────────────────────────────────────
// Returns extra SVG markup (groups/paths) to overlay on top of the static
// scene for the given scene id ('SUN' or a body name). A later run will fill
// this in with mission orbit rings + transfer arcs read from m.log; keep the
// signature stable. Return '' for now — static phase only.
function _trajSceneContent(scene, m) {
  return '';
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

function _trajSunSceneSVG(m) {
  const bodies = Object.keys(PROG_HELIO_R);
  const maxR = Math.max(...bodies.map(b => PROG_HELIO_R[b]));
  const scale = (_TRAJ_VB / 2 - 20) / maxR;   // fit outermost ring with margin
  const rings = bodies.map((b, i) => {
    const rr = PROG_HELIO_R[b] * scale;
    const ang = (i / bodies.length) * 2 * Math.PI - Math.PI / 2; // spread angles so labels don't collide
    const cx = rr * Math.cos(ang), cy = rr * Math.sin(ang);
    const color = _trajBodyColor(b);
    return `<circle cx="0" cy="0" r="${rr.toFixed(2)}" fill="none" stroke="${color}" stroke-width="0.6" opacity="0.55"/>`
      + _trajGlyph(cx, cy, 3, color, b);
  }).join('');
  const sun = _trajGlyph(0, 0, 6, _trajBodyColor('SUN'), 'Sun');
  return `${rings}${sun}${_trajSceneContent('SUN', m)}`;
}

function _trajBodySceneSVG(body, m) {
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 6371;
  const moons = _trajMoonsOf(body);
  const maxR = moons.length ? Math.max(...moons.map(mo => mo.r)) : R * 4;
  const scale = (_TRAJ_VB / 2 - 20) / maxR;
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
  return `${moonRings}${disc}${_trajSceneContent(body, m)}`;
}

function _trajSceneSVG(scene, m) {
  return scene === 'SUN' ? _trajSunSceneSVG(m) : _trajBodySceneSVG(scene, m);
}

// ── top-level view builder (called from missionRenderDetail via 570's hook) ──
function _missionTrajViewHTML(m) {
  const id = m.missionId;
  const focus = _trajFocus(m);
  const zoom = _trajZoom(m);
  const pan = _trajPan(m);
  const scenes = _trajSceneList();
  const focusSeg = scenes.map(s =>
    `<button class="${focus === s.id ? 'active' : ''}" onclick="trajSetFocus('${id}','${s.id}')">${s.label}</button>`
  ).join('');

  const svgInner = _trajSceneSVG(focus, m);
  const px = Math.round(_TRAJ_VB * zoom);

  return `
    <div class="traj-wrap" data-mid="${id}">
      <div class="traj-toolbar">
        <div class="seg traj-focus-seg">${focusSeg}</div>
        <button class="act-btn" onclick="trajResetView('${id}')" title="Reset zoom/pan">&#x21BA; Reset</button>
      </div>
      <div class="traj-canvas" onwheel="trajWheelZoom(event,'${id}')"
           onmousedown="trajPanStart(event,'${id}')" onmousemove="trajPanMove(event)"
           onmouseup="trajPanEnd()" onmouseleave="trajPanEnd()">
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
