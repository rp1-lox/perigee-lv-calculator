// ─────────────────────────────────────────────────────────────────────────────
// 610-architecture-map.js — Architecture node-map stage (A3-3D, World mount)
// MISSION_MODEL_V2.md §26. OWNS: the `.arch-stage` mount (archMapRender),
// bridge-draw edge authoring (archAddEdge), per-edge dV + chain-decomposition
// display, and the dV budget number (archComputeBudget, consumed by 605's
// #arch-dv-budget text). Keeps 600-architecture-model.js pure and
// 605-architecture-page.js ladder/rail-only.
//
// ── RENDERER: the Mission World surface, reused verbatim (2026-07-22) ────────
// The user rejected the bespoke body-centered 3D scene built in e581de1de
// ("not displaying proper eccentricity … wire the exact same solar system
// view into Architecture mode"). This module now MOUNTS the Mission page's
// World surface renderer (574-trajectory-view.js: _missionTrajViewHTML /
// _trajWorldSVG — real JPL-ephemeris bodies, starfield, az/el camera,
// occlusion, true-ellipse rings via trueRingPath) so the Architecture page
// gets the identical visual language, camera controls, and ring geometry as
// the Mission World view. NO fork/copy of that renderer exists.
//
// THE SEAM (one-definition rule): _trajWorldSVG takes ONE sanctioned optional
// input — the mission object's `_extraRings` / `_extraEdges` fields — consumed
// at the SAME trueRingPath emit layer the heliocentric/moon reference rings
// use. Real missions never set those fields, so their World view renders
// byte-identically; the Architecture page feeds them via a TRANSIENT STUB
// mission (empty log, id '__arch__' for the editable page, '__archplan__' for
// the read-mostly Plan-surface mirror). The stub is registered ONLY in
// 5740's _trajExtraMissions (NEVER in _missions), so autosave/session — which
// walk _missions — can never see it; its camera lives in the existing
// missionId-keyed _trajCamByMission side table under the stub id (transient).
//
// Architecture node orbits (canonical {body,periKm,apoKm,incDeg,lanDeg,argp?})
// are converted to the renderer's element shape {a,e,i,raan,argp} through the
// EXISTING frame seam orbitWorldElements (385) — see _archOrbitWorldEl below.
// Body at the FOCUS (a·(cosE−e) puts the primary at the ellipse focus), so a
// 185×35786 GTO ring visibly has Earth at one focus — the eccentricity defect
// the previous scene was rejected for.
//
// SELECTION OWNERSHIP: one cursor, owned by 605 (_archExpandedId). A ring
// click (_archWorldRingClick → archMapNodeClick) converges on 605's
// _archSelectNode(id), same as a ladder-card click; edge selection is a
// map-local cursor (_archSelectedEdgeId, this module). Bridge-draw edge
// authoring is unchanged (archMapNodeClick's bridge branch → archAddEdge).
//
// The pure ΔV physics is unchanged: archEdgeDv adapts a canonical orbit into
// the node-map dialect and delegates to _nmDvPhysics (430) — the SAME
// accounting function progNmComputeEdgeDv calls — so budget/chain numbers stay
// byte-identical with the mission node map.
// ─────────────────────────────────────────────────────────────────────────────

let _archBridgeMode = false;
let _archBridgeFrom = null;
let _archSelectedEdgeId = null;

/** Canonical architecture orbit -> {a,e,i,raan,argp} (km/rad) for
 *  progOrbitSamplePoints (360) / the World renderer's trueRingPath (574).
 *  Reuses orbitNormalize (384, canonical shape) + orbitWorldElements (385, the
 *  ONE eq->world frame seam) — no re-derived geometry. a/e come from
 *  periKm/apoKm + the body's radius (PROG_BODIES). */
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

// ── Selection / bridge-draw handlers (World rings call these) ────────────────

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

// World-scene click adapters (called from _trajWorldSVG-emitted onclick
// handlers). Guard against the click that ENDS a real camera-rotate drag
// (same _trajJustDragged discipline the mission World view uses for its own
// glyph/leg clicks), so dragging over a ring doesn't also select it.
function _archWorldRingClick(ev, nodeId) {
  if (ev) ev.stopPropagation();
  if (typeof _trajJustDragged !== 'undefined' && _trajJustDragged) { _trajJustDragged = false; return; }
  archMapNodeClick(nodeId);
}
function _archWorldEdgeClick(ev, edgeId) {
  if (ev) ev.stopPropagation();
  if (typeof _trajJustDragged !== 'undefined' && _trajJustDragged) { _trajJustDragged = false; return; }
  archSelectEdge(edgeId);
}

function _archChainDetailHTML(A, B, res, editable) {
  const legs = (res.legs && res.legs.length) ? res.legs : [{ role: 'insert', label: res.method || 'transfer', dv: res.dv }];
  const rows = legs.map(l => `<span style="margin-right:14px;">${escHtml(l.label)}: <b style="color:var(--text-bright);">${Math.round(l.dv).toLocaleString()} m/s</b></span>`).join('');
  const mccNote = legs.length > 1
    ? `<span style="margin-left:6px;color:var(--text-dim);">MCC: n/a (pre-mission estimate)</span>` : '';
  const delBtn = editable
    ? `<button class="act-btn" style="margin-left:10px;padding:1px 8px;font-size:10px;color:var(--danger);border-color:var(--danger);" onclick="archDeleteEdge('${_archSelectedEdgeId}')">Delete edge</button>` : '';
  return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-family:var(--mono);font-size:10px;color:var(--text-dim);">
    ${escHtml(A.name)} &rarr; ${escHtml(B.name)} &middot; total <b style="color:var(--text-bright);">${Math.round(res.dv).toLocaleString()} m/s</b>${delBtn}<br>
    ${rows}${mccNote}
  </div>`;
}

// ── World-mount plumbing ────────────────────────────────────────────────────

// Ring color for a node: selected (ladder accordion cursor) -> accent; the
// current bridge-draw start node -> accent2; else the body's identity color
// (PROG_BODY_COLORS via _trajBodyColor — the SAME per-body palette the World
// view's own bodies/rings use, so an architecture ring matches its body).
function _archNodeRingColor(n) {
  if (typeof _archExpandedId !== 'undefined' && _archExpandedId === n.id) return 'var(--accent)';
  if (_archBridgeFrom === n.id) return 'var(--accent2)';
  return (typeof _trajBodyColor === 'function') ? _trajBodyColor(n.body || 'Earth') : 'var(--nm-interp)';
}

// Build (or refresh) the transient stub mission that drives the World renderer
// for the Architecture mount. Recomputes _extraRings/_extraEdges from the
// current architecture every call (never stale); seeds the camera ONCE (anchor
// = the first node's body, framed to the ladder) so user zoom/rotate persists
// across re-mounts.
function _archBuildStub(id, readOnly) {
  const arch = archGet();
  const nodes = arch.nodes || [];
  const byId = {}; nodes.forEach(n => byId[n.id] = n);
  const rings = [];
  nodes.forEach(n => {
    const el = _archOrbitWorldEl(n);
    if (!el) return;
    rings.push({ body: el.body, el, color: _archNodeRingColor(n), label: n.name || 'Orbit',
      clickId: n.id, selected: (typeof _archExpandedId !== 'undefined' && _archExpandedId === n.id) || _archBridgeFrom === n.id });
  });
  const edges = [];
  (arch.edges || []).forEach(e => {
    const A = byId[e.fromId], B = byId[e.toId];
    if (!A || !B) return;
    const res = archEdgeDv(A, B);
    edges.push({ fromId: e.fromId, toId: e.toId, clickId: e.id,
      label: (res && res.dv != null) ? Math.round(res.dv).toLocaleString() + ' m/s' : 'no model',
      selected: e.id === _archSelectedEdgeId });
  });
  let stub = (typeof _trajExtraMissions !== 'undefined') ? _trajExtraMissions[id] : null;
  if (!stub) {
    stub = { missionId: id, log: [], groups: [], vehicleId: null, name: 'Architecture' };
    if (typeof _trajExtraMissions !== 'undefined') _trajExtraMissions[id] = stub;
  }
  stub._extraRings = rings;
  stub._extraEdges = edges;
  if (typeof _trajCamByMission !== 'undefined' && !_trajCamByMission[id]) {
    const anchor = rings.length ? rings[0].body : 'Earth';
    // Fit the ladder's OWN rings on the anchor body (not _trajFitWKmForBody,
    // whose Earth fit frames out to the Moon and shrinks LEO/GTO to sub-pixel).
    const bodyR = (typeof PROG_BODIES !== 'undefined' && PROG_BODIES[anchor]) ? PROG_BODIES[anchor].R : 6371;
    let maxApo = 0;
    rings.forEach(r => { if (r.body === anchor) maxApo = Math.max(maxApo, r.el.a * (1 + (r.el.e || 0))); });
    let wKm = Math.max(maxApo, bodyR * 3) * 2.6;
    if (typeof _TRAJ_WKM_MIN !== 'undefined') wKm = Math.max(_TRAJ_WKM_MIN, Math.min(_TRAJ_WKM_MAX, wKm));
    _trajCamByMission[id] = { anchorBody: anchor, relOffsetKm: { x: 0, y: 0 }, wKm, az: 0, el: Math.PI / 2 };
  }
  return stub;
}

// Inject the World view into an already-mounted `.arch-world-mount` container
// and run its post-mount sync (overlay sizing, starfield, ResizeObserver). Kept
// separate from the content-string builder so the string builder stays pure
// (test-safe) and the heavy DOM render happens only when actually mounted.
function _archWorldMountFill(id, readOnly) {
  const mount = document.querySelector(`.arch-world-mount[data-arch-id="${id}"]`);
  if (!mount || typeof _missionTrajViewHTML !== 'function') return;
  const stub = _archBuildStub(id, readOnly);
  mount.innerHTML = _missionTrajViewHTML(stub);
  if (typeof _missionTrajAfterRender === 'function') _missionTrajAfterRender(stub);
}

// Called by 570-mission-lifecycle.js after the Plan surface renders (nodemap
// view). No-op unless the read-mostly architecture World mirror is mounted.
function _archWorldPlanAfterRender() {
  if (!document.querySelector('.arch-world-mount[data-arch-id="__archplan__"]')) return;
  _archWorldMountFill('__archplan__', true);
}

// "one renderer, two mounts" — the content-string builder is shared by the
// Architecture page (editable) and the Mission Plan surface (read-mostly
// mirror, 570-mission-lifecycle.js). `readOnly` suppresses the Draw Edge
// control and per-edge delete; node/edge click-to-inspect stays live either
// way (harmless viewing, not editing).
function _archMapContentHTML(readOnly) {
  const arch = archGet();
  const nodes = arch.nodes || [];
  const edges = arch.edges || [];
  const id = readOnly ? '__archplan__' : '__arch__';

  if (!nodes.length) {
    return '<div class="placeholder-msg">No orbits in your ladder yet. Add one from the rail — pick a preset from the catalog or add a custom orbit — then draw a transfer edge between two nodes to see the dV budget.</div>';
  }

  const byId = {}; nodes.forEach(n => byId[n.id] = n);
  // Build the stub NOW (before the camera toolbar reads _trajCamByMission), so
  // the anchor seeds to the first node's body.
  _archBuildStub(id, readOnly);

  // ── control strip ──
  let ctrlHTML = `<div class="arch-map-ctl">`;
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
  // Camera/frame anchor selects + Reset — the World surface's own toolbar,
  // reused verbatim (same trajSetFocus/trajSetFrame/trajResetView handlers).
  if (typeof _trajCamToolbarHTML === 'function') {
    ctrlHTML += `<span style="margin-left:auto;">${_trajCamToolbarHTML(_trajExtraMissions[id], id)}</span>`;
  }
  ctrlHTML += `</div>`;

  // ── selected-edge chain detail (below the map) ──
  let chainHTML = '';
  if (_archSelectedEdgeId) {
    const e = edges.find(x => x.id === _archSelectedEdgeId);
    if (e) {
      const A = byId[e.fromId], B = byId[e.toId];
      const res = A && B ? archEdgeDv(A, B) : null;
      if (A && B && res) chainHTML = _archChainDetailHTML(A, B, res, !readOnly);
    }
  }

  return `<div class="arch-world-wrap">${ctrlHTML}<div class="arch-world-mount" data-arch-id="${id}"></div>${chainHTML}</div>`;
}

/** Renders the `.arch-stage` World surface. Called by 605's archRenderPage()
 *  on every model change, so it never goes stale relative to the ladder. */
function archMapRender() {
  const stage = document.querySelector('#page-architecture .arch-stage');
  if (!stage) return;
  stage.innerHTML = _archMapContentHTML(false);
  _archWorldMountFill('__arch__', false);
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
