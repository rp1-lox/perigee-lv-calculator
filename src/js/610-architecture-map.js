// ─────────────────────────────────────────────────────────────────────────────
// 610-architecture-map.js — Architecture node-map stage (A3)
// MISSION_MODEL_V2.md §26. OWNS: `.arch-stage` SVG mount (archMapRender),
// node placement from ladder order, bridge-draw edge authoring (archAddEdge),
// per-edge dV + chain-decomposition display, and the dV budget footer number
// (archComputeBudget, consumed by 605's #arch-dv-budget text). Keeps
// 600-architecture-model.js pure and 605-architecture-page.js ladder/rail-only.
//
// MOUNT-VS-EXTRACT DECISION (documented per the task brief's reuse mandate):
// The Mission Plan surface's renderer (_missionNodeMapHTML, 570-mission-
// nodemap.js) was evaluated for a second mount here and found too mission-
// entangled to parameterize cleanly for A3's honest v1 scope:
//   - its node set is the FIXED PROG_NM_NODES solar-system catalog (+ per-
//     mission nodeMapCustomNodes) — architecture nodes are arbitrary
//     user-authored orbits with no relationship to that catalog;
//   - its edges are DERIVED from m.log maneuver events (_missionNmEdgePairs
//     replays the log) — architecture has no log, no vehicle, no MET;
//   - its layout (_missionNmLayout) fans nodes around a hardcoded per-body
//     solar-system diagram — architecture nodes can bind to any body in any
//     ladder order, with no fixed "system" to fan around;
//   - its bridge-draw/drag/zoom state (_missionBridgeMode, _missionNmPos,
//     _missionNmZoom) is keyed by missionId throughout.
// Forking a copy of that ~700-line renderer would violate the one-definition
// mandate worse than not reusing it. Instead this module EXTRACTS AND REUSES
// the two genuinely mission-agnostic pieces: the arrowhead primitive
// (_nmArrowHead, 570-mission-panel.js) drawn as-is, and — the important one —
// the pure ΔV physics engine (_nmDvPhysics, 430-program-module-phase-8-node-
// map.js). progNmComputeEdgeDv (430) is NOT reusable directly (it resolves
// fromId/toId against the fixed PROG_NM_NODES/nodeMapCustomNodes catalogs),
// but it is itself just a thin ID-resolution wrapper around _nmDvPhysics(nA,
// nB) — the actual accounting function both progNmComputeEdgeDv and this
// module call. archEdgeDv() below adapts a canonical architecture orbit into
// the {type,body,periKm,apoKm,incDeg,lanDeg} shape _nmDvPhysics expects
// (mirrors _missionOrbitToNodeOrbit's dialect-shim pattern in 570-mission-
// nodemap.js) and reads the `legs` breakdown _nmDvPhysics now returns for
// its multi-term branches (Earth<->Moon TLI/LOI, coaxial two-burn) — that
// `legs` field was added ONCE to _nmDvPhysics itself (430) so BOTH the
// mission node map and the Architecture page read the identical numbers;
// nothing is duplicated or recomputed. A cross-body corridor edge's chain
// decomposition here is depart/insert only (no MCC term) — a real MCC only
// emerges from an actual solved physics leg on a FLOWN vehicle (565's
// propagation), which architecture deliberately has none of (KSP invariant:
// no vehicle/propagation dependency on this page). The UI shows an explicit
// "MCC: n/a (pre-mission estimate)" note rather than fabricating a number;
// A4's "transfer along this edge" will generate the real s22 chain (with a
// real solved MCC) once the edge becomes actual mission events.
//
// SELECTION OWNERSHIP: one cursor, owned by 605 (_archExpandedId, the ladder
// accordion cursor already in place before A3). This module's node clicks
// call 605's _archSelectNode(id) so a map click and a ladder-card click
// converge on the exact same state — archRenderPage() (605) re-renders both
// the ladder and the map every time either changes. Edge selection is a
// SEPARATE, map-local cursor (_archSelectedEdgeId, this module) — edges
// aren't ladder rows, so there's nothing in 605 for them to synchronize with.
// ─────────────────────────────────────────────────────────────────────────────

let _archBridgeMode = false;
let _archBridgeFrom = null;
let _archSelectedEdgeId = null;

// ── A3-3D: body-centered 3D orbit scene ─────────────────────────────────────
// Camera state — transient (module-level), never persisted, never on the
// program object (mirrors the trajectory view's own camera convention).
let _archCam = { yaw: -30 * _PROG_D2R, pitch: 22 * _PROG_D2R, zoom: 1 };
let _archDragState = null;
let _archRafPending = false;
let _archFocusBody = null;   // null => defaults to the first ladder node's body

function _archMapRafRender() {
  if (_archRafPending) return;
  _archRafPending = true;
  requestAnimationFrame(() => { _archRafPending = false; archMapRender(); });
}

function _archCamDragStart(e) {
  e.preventDefault();
  _archDragState = { x: e.clientX, y: e.clientY };
  document.addEventListener('mousemove', _archCamDragMove);
  document.addEventListener('mouseup', _archCamDragEnd);
}
function _archCamDragMove(e) {
  if (!_archDragState) return;
  const dx = e.clientX - _archDragState.x, dy = e.clientY - _archDragState.y;
  _archDragState.x = e.clientX; _archDragState.y = e.clientY;
  _archCam.yaw += dx * 0.008;
  _archCam.pitch = Math.max(-85 * _PROG_D2R, Math.min(85 * _PROG_D2R, _archCam.pitch - dy * 0.008));
  _archMapRafRender();
}
function _archCamDragEnd() {
  _archDragState = null;
  document.removeEventListener('mousemove', _archCamDragMove);
  document.removeEventListener('mouseup', _archCamDragEnd);
}
function _archCamWheel(e) {
  e.preventDefault();
  const f = e.deltaY > 0 ? 1.1 : 0.9;
  _archCam.zoom = Math.max(0.3, Math.min(6, _archCam.zoom * f));
  archMapRender();
}
function _archCamReset() {
  _archCam = { yaw: -30 * _PROG_D2R, pitch: 22 * _PROG_D2R, zoom: 1 };
  archMapRender();
}
function _archSetFocusBody(body) {
  _archFocusBody = body;
  archMapRender();
}

/** ONE projection function — world geometry (orbit polylines, body sphere,
 *  equator, spin axis) AND symbology anchors (node chips, dV labels, edge
 *  endpoints) all go through this so symbology never scales independently of
 *  the world it's labeling (screen-space-symbology-two-layers convention).
 *  pt = [x,y,z] km, body-centered, equatorial frame (Z = spin axis — the same
 *  frame progOrbitSamplePoints' rotation matrix targets). cam = {yaw,pitch,
 *  scale,cx,cy}. Returns {sx,sy,depth} in SCREEN px; depth is a signed
 *  view-space distance (positive = toward the camera). */
function _archProject3D(pt, cam) {
  const x = pt[0], y = pt[1], z = pt[2];
  const cy_ = Math.cos(cam.yaw), sy_ = Math.sin(cam.yaw);
  const x1 = x * cy_ - y * sy_, y1 = x * sy_ + y * cy_, z1 = z;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
  const x2 = x1;
  return { sx: cam.cx + x2 * cam.scale, sy: cam.cy - z2 * cam.scale, depth: y2 };
}

/** Canonical architecture orbit -> {a,e,i,raan,argp} (km/rad) for
 *  progOrbitSamplePoints (360). Reuses orbitNormalize (384, canonical shape)
 *  + orbitWorldElements (385, the ONE eq->world frame seam) — no re-derived
 *  geometry. a/e come from periKm/apoKm + the body's radius (PROG_BODIES). */
function _archOrbitWorldEl(n) {
  const o = n && n.orbit; if (!o) return null;
  const body = n.body || o.body || 'Earth';
  const bodyMeta = (typeof PROG_BODIES !== 'undefined') ? PROG_BODIES[body] : null;
  const bodyR = bodyMeta ? bodyMeta.R : 0;
  const c = (typeof orbitNormalize === 'function') ? orbitNormalize(o) : o;
  if (!c) return null;
  const rPeri = bodyR + (c.periKm || 0), rApo = bodyR + (c.apoKm || 0);
  const a = (rPeri + rApo) / 2;
  const e = rApo > rPeri ? (rApo - rPeri) / (rApo + rPeri) : 0;
  const w = (typeof orbitWorldElements === 'function') ? orbitWorldElements(o) : { incDeg: c.incDeg || 0, lanDeg: c.lanDeg || 0 };
  const argpDeg = c.argpDeg != null ? c.argpDeg : 0;
  return { a, e, i: (w.incDeg || 0) * _PROG_D2R, raan: (w.lanDeg || 0) * _PROG_D2R, argp: argpDeg * _PROG_D2R, bodyR, body };
}

// Split a projected polyline into behind/front runs by comparing each
// point's depth against the body sphere's screen disc (painter's order —
// no z-buffer, per the task brief). Returns [{front:bool, pts:[{sx,sy}...]}]
function _archSplitDepth(projPts, cam, bodyScreenR) {
  const runs = [];
  let cur = null;
  projPts.forEach(p => {
    const dx = p.sx - cam.cx, dy = p.sy - cam.cy;
    const behind = p.depth < 0 && Math.sqrt(dx * dx + dy * dy) < bodyScreenR;
    const front = !behind;
    if (!cur || cur.front !== front) { cur = { front, pts: [] }; runs.push(cur); }
    cur.pts.push(p);
  });
  return runs;
}

// Same summary text as 605's ladder cards (_archOrbitSummary), duplicated
// locally rather than cross-called — 605 owns ladder/rail rendering only and
// this module's own test sandbox loads without it (see the module banner's
// mount-vs-extract note: keep 605 and 610 independently loadable).
function _archMapOrbitSummary(o) {
  if (!o) return '';
  const peri = (o.periKm || 0).toLocaleString();
  const apo = (o.apoKm || 0).toLocaleString();
  const radii = (o.apoKm !== o.periKm) ? `${peri} &times; ${apo} km` : `${peri} km`;
  return `${radii} @ ${o.incDeg || 0}&deg;`;
}

function _archPolylinePath(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' ');
}

// Adapt a canonical architecture orbit (384's {body,periKm,apoKm,incDeg,
// lanDeg,frame}) into the node-map orbit dialect _nmDvPhysics expects
// ({type,body,periKm,apoKm,incDeg}) — same shim pattern as
// _missionOrbitToNodeOrbit (570-mission-nodemap.js), just a different input
// dialect (canonical vs. ORBIT_CATEGORIES).
function _archOrbitToNmOrbit(o) {
  if (!o) return null;
  const peri = o.periKm ?? 0, apo = o.apoKm ?? peri;
  return { type: Math.abs(apo - peri) < 1 ? 'circular' : 'elliptic',
           body: o.body || 'Earth', periKm: peri, apoKm: apo, incDeg: o.incDeg || 0 };
}

/** ΔV (+ chain legs, when the underlying model produces more than one term)
 *  for an architecture edge between two ladder nodes. Delegates entirely to
 *  _nmDvPhysics (430) — see the module banner above. Returns
 *  {dv, note, method, legs?} or null if no model applies to this pair. */
function archEdgeDv(fromNode, toNode) {
  if (!fromNode || !toNode || typeof _nmDvPhysics !== 'function') return null;
  const nA = { orbit: _archOrbitToNmOrbit(fromNode.orbit) };
  const nB = { orbit: _archOrbitToNmOrbit(toNode.orbit) };
  const result = _nmDvPhysics(nA, nB);
  if (result) return result;
  const rev = _nmDvPhysics(nB, nA);
  if (rev) return { ...rev, note: rev.note + ' (reversed)', reversed: true };
  return null;
}

/** Sum of every edge's dV — the rail-footer headline number (605 reads this).
 *  Live-computed every call (never persisted/cached), so it can never go
 *  stale relative to node edits. */
function archComputeBudget() {
  const arch = archGet();
  const byId = {}; (arch.nodes || []).forEach(n => byId[n.id] = n);
  let total = 0, unresolved = 0;
  (arch.edges || []).forEach(e => {
    const A = byId[e.fromId], B = byId[e.toId];
    if (!A || !B) { unresolved++; return; }
    const res = archEdgeDv(A, B);
    if (res && res.dv != null) total += res.dv; else unresolved++;
  });
  return { total, unresolved, edgeCount: (arch.edges || []).length };
}

function archToggleBridgeMode() {
  _archBridgeMode = !_archBridgeMode;
  _archBridgeFrom = null;
  archMapRender();
}

function archMapCancelBridge() {
  _archBridgeFrom = null;
  archMapRender();
}

function archMapNodeClick(id) {
  if (_archBridgeMode) {
    if (_archBridgeFrom == null) { _archBridgeFrom = id; archMapRender(); return; }
    if (_archBridgeFrom === id) { _archBridgeFrom = null; archMapRender(); return; }
    const edge = archAddEdge(_archBridgeFrom, id);
    _archBridgeFrom = null;
    _archBridgeMode = false;
    if (edge) _archSelectedEdgeId = edge.id;
    archRenderPage();
    autosaveScheduleSave();
    return;
  }
  if (typeof _archSelectNode === 'function') _archSelectNode(id);   // 605 owns selection; re-renders ladder+map
}

function archSelectEdge(id) {
  _archSelectedEdgeId = (_archSelectedEdgeId === id) ? null : id;
  archMapRender();
}

function archDeleteEdge(id) {
  archRemoveEdge(id);
  if (_archSelectedEdgeId === id) _archSelectedEdgeId = null;
  archRenderPage();
  autosaveScheduleSave();
}

function _archChainDetailHTML(A, B, res) {
  const legs = (res.legs && res.legs.length) ? res.legs : [{ role: 'insert', label: res.method || 'transfer', dv: res.dv }];
  const rows = legs.map(l => `<span style="margin-right:14px;">${escHtml(l.label)}: <b style="color:var(--text-bright);">${Math.round(l.dv).toLocaleString()} m/s</b></span>`).join('');
  const mccNote = legs.length > 1
    ? `<span style="margin-left:6px;color:var(--text-dim);">MCC: n/a (pre-mission estimate)</span>` : '';
  return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-family:var(--mono);font-size:10px;color:var(--text-dim);">
    ${escHtml(A.name)} &rarr; ${escHtml(B.name)} &middot; total <b style="color:var(--text-bright);">${Math.round(res.dv).toLocaleString()} m/s</b><br>
    ${rows}${mccNote}
  </div>`;
}

// A4 (MISSION_MODEL_V2 §26): "one renderer, two mounts" — the content-string
// builder is now separate from the DOM mount so the Mission Plan surface
// (570-mission-lifecycle.js) can embed the exact same markup, read-mostly,
// when an architecture exists. `readOnly` suppresses the Draw Edge control
// and per-edge delete chip; node/edge click-to-inspect (selection + chain
// detail) stays live either way since that's harmless viewing, not editing.
function _archMapContentHTML(readOnly) {
  const arch = archGet();
  const nodes = arch.nodes || [];
  const edges = arch.edges || [];

  if (!nodes.length) {
    return '<div class="placeholder-msg">No orbits in your ladder yet. Add one from the rail — pick a preset from the catalog or add a custom orbit — then draw a transfer edge between two nodes to see the dV budget.</div>';
  }

  const byId = {}; nodes.forEach(n => byId[n.id] = n);

  // Body-selector: default to the first ladder node's body.
  const bodies = [];
  nodes.forEach(n => { const b = n.body || 'Earth'; if (bodies.indexOf(b) === -1) bodies.push(b); });
  if (!_archFocusBody || bodies.indexOf(_archFocusBody) === -1) _archFocusBody = bodies[0] || 'Earth';
  const focusBody = _archFocusBody;
  const focusNodes = nodes.filter(n => (n.body || 'Earth') === focusBody);
  const offBodyCounts = {};
  nodes.forEach(n => { const b = n.body || 'Earth'; if (b !== focusBody) offBodyCounts[b] = (offBodyCounts[b] || 0) + 1; });

  let ctrlHTML = `<div class="sl" style="margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">`;
  if (readOnly) {
    ctrlHTML += `<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);letter-spacing:.08em;">MISSION ARCHITECTURE (read-mostly)</span>
      <button class="act-btn" onclick="showPage('architecture')">Edit in Architecture &rarr;</button>`;
  } else {
    ctrlHTML += `<button class="act-btn" style="${_archBridgeMode ? 'background:var(--accent);color:#000;' : ''}" onclick="archToggleBridgeMode()">+ Draw Edge</button>`;
    if (_archBridgeMode) {
      if (_archBridgeFrom == null) {
        ctrlHTML += `<span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">Click a start node&hellip;</span>`;
      } else {
        const fl = byId[_archBridgeFrom] ? byId[_archBridgeFrom].name : _archBridgeFrom;
        ctrlHTML += `<span style="font-family:var(--mono);font-size:10px;color:var(--text-bright);">From ${escHtml(fl)} &mdash; click a destination node</span>
          <button class="act-btn" style="padding:2px 8px;font-size:10px;" onclick="archMapCancelBridge()">Cancel</button>`;
      }
    }
  }
  if (bodies.length > 1) {
    ctrlHTML += `<span style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">BODY</span>
      ${bodies.map(b => `<button class="act-btn" style="padding:2px 9px;font-size:10px;${b === focusBody ? 'background:var(--accent);color:#000;' : ''}" onclick="_archSetFocusBody('${escHtml(b)}')">${escHtml(b)}</button>`).join('')}
    </span>`;
  }
  ctrlHTML += `</div>`;

  const bodyMeta = (typeof PROG_BODIES !== 'undefined') ? PROG_BODIES[focusBody] : null;
  const bodyR = bodyMeta ? bodyMeta.R : 6371;
  const bodyColor = (typeof PROG_BODY_COLORS !== 'undefined' && PROG_BODY_COLORS[focusBody]) || 'var(--accent)';

  const nodeEls = {};
  focusNodes.forEach(n => { const el = _archOrbitWorldEl(n); if (el) nodeEls[n.id] = el; });

  // Scene bounds: two-pass fit. Project every ring (plus the body sphere's
  // extent) at unit scale under the CURRENT camera orientation, then fit the
  // actual projected bounding box — a radial bound wastes most of the frame
  // on eccentric orbits (body at the focus, not the center) and on pitch-
  // compressed views.
  const W = 760, H = 460;
  const probe = { yaw: _archCam.yaw, pitch: _archCam.pitch, cx: 0, cy: 0, scale: 1 };
  let minX = -bodyR * 1.25, maxX = bodyR * 1.25, minY = -bodyR * 1.25, maxY = bodyR * 1.25;
  if (typeof progOrbitSamplePoints === 'function') {
    Object.values(nodeEls).forEach(el => {
      progOrbitSamplePoints(el, 48).forEach(p3 => {
        const p = _archProject3D(p3, probe);
        if (p.sx < minX) minX = p.sx; if (p.sx > maxX) maxX = p.sx;
        if (p.sy < minY) minY = p.sy; if (p.sy > maxY) maxY = p.sy;
      });
    });
  }
  const fitScale = Math.min((W - 130) / Math.max(1, maxX - minX), (H - 96) / Math.max(1, maxY - minY));
  const cam = { yaw: _archCam.yaw, pitch: _archCam.pitch,
                cx: W / 2 - (minX + maxX) / 2 * fitScale * _archCam.zoom,
                cy: H / 2 - (minY + maxY) / 2 * fitScale * _archCam.zoom,
                scale: fitScale * _archCam.zoom };
  const bodyScreenR = Math.max(4, bodyR * cam.scale);

  // Equator ellipse (dashed, faint) — reads inclination against this plane.
  const EQ_N = 72, eqPts = [];
  for (let k = 0; k <= EQ_N; k++) { const t = 2 * Math.PI * k / EQ_N; eqPts.push(_archProject3D([bodyR * Math.cos(t), bodyR * Math.sin(t), 0], cam)); }
  const equatorHTML = `<path d="${_archPolylinePath(eqPts)}" fill="none" stroke="var(--border-bright)" stroke-width="1" stroke-dasharray="3,4" opacity="0.5"/>`;

  // Spin-axis line.
  const axTop = _archProject3D([0, 0, bodyR * 1.7], cam), axBot = _archProject3D([0, 0, -bodyR * 1.7], cam);
  const axisHTML = `<line x1="${axTop.sx.toFixed(1)}" y1="${axTop.sy.toFixed(1)}" x2="${axBot.sx.toFixed(1)}" y2="${axBot.sy.toFixed(1)}" stroke="var(--text-dim)" stroke-width="1" stroke-dasharray="2,3" opacity="0.4"/>`;

  const bodySphereHTML = `<defs><radialGradient id="arch-body-shade" cx="38%" cy="34%" r="70%">
      <stop offset="0%" stop-color="${bodyColor}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="${bodyColor}" stop-opacity="0.45"/>
    </radialGradient></defs>
    <circle cx="${cam.cx}" cy="${cam.cy}" r="${bodyScreenR.toFixed(1)}" fill="url(#arch-body-shade)" stroke="var(--border-bright)" stroke-width="1"/>`;

  // Per-node orbit ring: sample, project, depth-split, cache the ring +
  // apoapsis-anchor screen point for chip/edge placement below.
  const ringData = {};
  let ringsBehindHTML = '', ringsFrontHTML = '';
  focusNodes.forEach(n => {
    const el = nodeEls[n.id];
    if (!el || typeof progOrbitSamplePoints !== 'function') return;
    const pts3d = progOrbitSamplePoints(el, 96);
    const proj = pts3d.map(p => _archProject3D(p, cam));
    const isSel = (typeof _archExpandedId !== 'undefined' && _archExpandedId === n.id);
    const isFrom = _archBridgeFrom === n.id;
    const col = isFrom ? 'var(--accent2)' : (isSel ? 'var(--accent)' : 'var(--border-bright)');
    const sw = (isFrom || isSel) ? 2.6 : 1.6;
    const runs = _archSplitDepth(proj, cam, bodyScreenR);
    runs.forEach(run => {
      if (run.pts.length < 2) return;
      const seg = `<path d="${_archPolylinePath(run.pts)}" fill="none" stroke="${col}" stroke-width="${sw}" opacity="${run.front ? (isSel || isFrom ? 1 : 0.85) : 0.35}"/>`;
      if (run.front) ringsFrontHTML += seg; else ringsBehindHTML += seg;
    });
    // Apoapsis anchor for the label chip — the sampled point farthest from
    // the body center (robust for circular orbits too, where any point works).
    let anchor = proj[0], best = -1;
    proj.forEach(p => { const d = (p.sx - cam.cx) ** 2 + (p.sy - cam.cy) ** 2; if (d > best) { best = d; anchor = p; } });
    ringData[n.id] = { proj, anchor, col };
  });

  // Off-body note.
  let offBodyHTML = '';
  const offList = Object.keys(offBodyCounts);
  if (offList.length) {
    offBodyHTML = `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:6px;">` +
      offList.map(b => `${offBodyCounts[b]} node${offBodyCounts[b] === 1 ? '' : 's'} at ${escHtml(b)} &mdash; switch body`).join(' &middot; ') + `</div>`;
  }

  // Node chips (native screen px, anchored at the ring's projected apoapsis —
  // symbology layer, never scaled with zoom per the two-layer rule).
  let chipsHTML = '';
  focusNodes.forEach(n => {
    const rd = ringData[n.id]; if (!rd) return;
    const label = `${(n.name || 'Orbit').slice(0, 16)}`;
    const sub = _archMapOrbitSummary(n.orbit);
    const w = Math.max(70, label.length * 5.6 + 14);
    const x = rd.anchor.sx, y = rd.anchor.sy;
    chipsHTML += `<g style="cursor:pointer" onclick="archMapNodeClick('${n.id}')"><title>${escHtml(n.name)} &mdash; ${escHtml(n.body)}</title>
      <rect x="${(x - w / 2).toFixed(1)}" y="${(y - 17).toFixed(1)}" width="${w}" height="26" rx="5" fill="var(--bg)" stroke="${rd.col}" stroke-width="1.3" opacity="0.95"/>
      <text x="${x.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="9px" fill="var(--text-bright)">${escHtml(label)}</text>
      <text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="7.5px" fill="var(--text-dim)">${sub}</text>
    </g>`;
  });

  // Edges: connector between the two rings' nearest projected points (v1 —
  // no transfer physics, matches the flat map's straight-line convention).
  let edgesHTML = '', chainHTML = '';
  edges.forEach(e => {
    const A = byId[e.fromId], B = byId[e.toId];
    if (!A || !B) return;   // orphaned edge (shouldn't happen — archRemoveNode cascades) — skip defensively
    const res = archEdgeDv(A, B);
    const sel = e.id === _archSelectedEdgeId;
    const col = sel ? 'var(--accent2)' : 'var(--accent)';
    const rdA = ringData[A.id], rdB = ringData[B.id];
    const aOff = (A.body || 'Earth') !== focusBody, bOff = (B.body || 'Earth') !== focusBody;

    let ax, ay, bx, by, tagSuffix = '';
    if (!aOff && !bOff && rdA && rdB) {
      // Nearest-point pair between the two rings.
      let bestD = Infinity;
      rdA.proj.forEach(p => rdB.proj.forEach(q => { const d = (p.sx - q.sx) ** 2 + (p.sy - q.sy) ** 2; if (d < bestD) { bestD = d; ax = p.sx; ay = p.sy; bx = q.sx; by = q.sy; } }));
    } else if (!aOff && rdA) {
      ax = rdA.anchor.sx; ay = rdA.anchor.sy; bx = W - 30; by = 30; tagSuffix = ` &rarr; ${escHtml(B.body)}`;
    } else if (!bOff && rdB) {
      bx = rdB.anchor.sx; by = rdB.anchor.sy; ax = 30; ay = 30; tagSuffix = ` &larr; ${escHtml(A.body)}`;
    } else {
      return; // neither endpoint visible in this scene
    }

    edgesHTML += `<g style="cursor:pointer" onclick="archSelectEdge('${e.id}')">
      <line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="transparent" stroke-width="14"/>
      <line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${col}" stroke-width="2.5" opacity="0.85"/>
      ${_nmArrowHead(ax, ay, bx, by, col, 18)}
    </g>`;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dvLabel = (res && res.dv != null) ? Math.round(res.dv).toLocaleString() + ' m/s' : 'no model';
    const tagText = dvLabel + tagSuffix;
    const tagW = Math.max(76, tagText.replace(/&\w+;/g, 'X').length * 5.4);
    edgesHTML += `<g onclick="event.stopPropagation();archSelectEdge('${e.id}')" style="cursor:pointer">
      <rect x="${(mx - tagW / 2).toFixed(1)}" y="${(my - 9).toFixed(1)}" width="${tagW.toFixed(1)}" height="18" rx="9" fill="var(--bg)" stroke="${col}" stroke-width="1.2"/>
      <text x="${mx.toFixed(1)}" y="${(my + 3).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="8px" fill="${col}">${tagText}</text>
    </g>`;
    if (!readOnly) {
      edgesHTML += `<g onclick="event.stopPropagation();archDeleteEdge('${e.id}')" style="cursor:pointer"><title>Delete edge</title>
        <circle cx="${(mx + tagW / 2 + 8).toFixed(1)}" cy="${(my - 9).toFixed(1)}" r="7" fill="var(--input)" stroke="var(--danger)" stroke-width="1"/>
        <text x="${(mx + tagW / 2 + 8).toFixed(1)}" y="${(my - 6).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="9px" fill="var(--danger)">&times;</text>
      </g>`;
    }
    if (sel && res) chainHTML = _archChainDetailHTML(A, B, res);
  });

  const svgHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;max-width:none;height:auto;max-height:420px;background:transparent;display:block;">
    ${equatorHTML}${axisHTML}${ringsBehindHTML}${bodySphereHTML}${ringsFrontHTML}${edgesHTML}${chipsHTML}
  </svg>`;
  const viewportHTML = `<div class="arch-3d-viewport" style="overflow:hidden;cursor:grab;touch-action:none;"
    onmousedown="_archCamDragStart(event)" onwheel="_archCamWheel(event);return false;" ondblclick="_archCamReset()">${svgHTML}</div>`;
  return `<div style="display:flex;flex-direction:column;width:100%;min-width:0;">${ctrlHTML}${viewportHTML}${offBodyHTML}${chainHTML}</div>`;
}

/** Renders the `.arch-stage` node-map surface. Called by 605's archRenderPage()
 *  on every model change, so it never goes stale relative to the ladder. */
function archMapRender() {
  const stage = document.querySelector('#page-architecture .arch-stage');
  if (!stage) return;
  stage.innerHTML = _archMapContentHTML(false);
}

// ── A4: "Transfer along this edge" -> real s22 chain events ────────────────
// Reuse decision (task brief mandate): adapt the edge's two architecture
// nodes into custom node-map nodes (_missionCreateCustomNode, 570-mission-
// nodemap.js — the SAME dialect archEdgeDv already produces via
// _archOrbitToNmOrbit) and hand off to the EXISTING s22 authoring path,
// missionExecManeuver (570-mission-panel.js), completely unmodified. That
// function already: (1) detects a two-hop transit corridor and splits
// depart/MCC/insert via _missionChainSplitInject when the node-map's own
// physics recognizes one (e.g. an Earth<->Moon pair), or (2) authors a single
// charged, editable, deletable MNODE event for any other pair — the SAME
// fidelity the Node Map's own "Draw Maneuver" bridge has today for that same
// endpoint pair. No new chain-generation logic was written; dV/timing come
// from the identical accounting source (progNmComputeEdgeDv's underlying
// _nmDvPhysics) the Architecture page's own edge display already reads.
function _archCustomNodeForArchNode(node) {
  // Reuse a previously-created custom node for this architecture node
  // (tagged via archNodeId) instead of spawning a duplicate on every
  // "Add Transfer" click for the same edge.
  const existing = (typeof _missionCustomNodes === 'function') ? _missionCustomNodes().find(n => n.archNodeId === node.id) : null;
  if (existing) return existing.id;
  if (typeof _missionCreateCustomNode !== 'function') return null;
  const nmOrbit = _archOrbitToNmOrbit(node.orbit);
  const cid = _missionCreateCustomNode(node.name, nmOrbit, 550, 300, node.body + ' ' + nmOrbit.type);
  const cn = (typeof _missionCustomNodes === 'function') ? _missionCustomNodes().find(n => n.id === cid) : null;
  if (cn) cn.archNodeId = node.id;
  return cid;
}
function missionExecArchTransfer(missionId, edgeId) {
  if (!edgeId) return;
  const arch = archGet();
  const edge = (arch.edges || []).find(e => e.id === edgeId);
  if (!edge) return;
  const A = (arch.nodes || []).find(n => n.id === edge.fromId);
  const B = (arch.nodes || []).find(n => n.id === edge.toId);
  if (!A || !B) return;
  const fromId = _archCustomNodeForArchNode(A);
  const toId = _archCustomNodeForArchNode(B);
  if (!fromId || !toId) return;
  if (typeof missionExecManeuver === 'function') missionExecManeuver(missionId, fromId, toId);
}
