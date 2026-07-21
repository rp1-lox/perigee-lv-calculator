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

// Simple ladder-order layout: honest v1, no drag (mirrors 605's "no drag" call
// for the ladder cards themselves) — nodes place left-to-right in ladder
// order, staggered vertically so edges between non-adjacent nodes don't all
// collide on one line.
function _archMapLayout(nodes) {
  const pos = {};
  const W = Math.max(760, 150 * nodes.length + 160);
  nodes.forEach((n, i) => {
    pos[n.id] = [90 + i * 150, 170 + (i % 2 === 0 ? 0 : 70)];
  });
  return { W, H: 320, pos };
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
  const lay = _archMapLayout(nodes);
  const pos = lay.pos;

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
  ctrlHTML += `</div>`;

  let edgesHTML = '', chainHTML = '';
  edges.forEach(e => {
    const A = byId[e.fromId], B = byId[e.toId];
    if (!A || !B) return;   // orphaned edge (shouldn't happen — archRemoveNode cascades) — skip defensively
    const [ax, ay] = pos[A.id], [bx, by] = pos[B.id];
    const res = archEdgeDv(A, B);
    const sel = e.id === _archSelectedEdgeId;
    const col = sel ? 'var(--accent2)' : 'var(--accent)';
    edgesHTML += `<g style="cursor:pointer" onclick="archSelectEdge('${e.id}')">
      <line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="transparent" stroke-width="14"/>
      <line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${col}" stroke-width="2.5" opacity="0.85"/>
      ${_nmArrowHead(ax, ay, bx, by, col, 18)}
    </g>`;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dvLabel = (res && res.dv != null) ? Math.round(res.dv).toLocaleString() + ' m/s' : 'no model';
    edgesHTML += `<g onclick="event.stopPropagation();archSelectEdge('${e.id}')" style="cursor:pointer">
      <rect x="${mx - 38}" y="${my - 9}" width="76" height="18" rx="9" fill="var(--bg)" stroke="${col}" stroke-width="1.2"/>
      <text x="${mx}" y="${my + 3}" text-anchor="middle" font-family="var(--mono)" font-size="8px" fill="${col}">${escHtml(dvLabel)}</text>
    </g>`;
    if (!readOnly) {
      edgesHTML += `<g onclick="event.stopPropagation();archDeleteEdge('${e.id}')" style="cursor:pointer"><title>Delete edge</title>
        <circle cx="${mx + 44}" cy="${my - 9}" r="7" fill="var(--input)" stroke="var(--danger)" stroke-width="1"/>
        <text x="${mx + 44}" y="${my - 6}" text-anchor="middle" font-family="var(--mono)" font-size="9px" fill="var(--danger)">&times;</text>
      </g>`;
    }
    if (sel && res) chainHTML = _archChainDetailHTML(A, B, res);
  });

  let nodesHTML = '';
  nodes.forEach(n => {
    const [x, y] = pos[n.id];
    const isFrom = _archBridgeFrom === n.id;
    const isLadderSel = (typeof _archExpandedId !== 'undefined' && _archExpandedId === n.id);
    const stroke = isFrom ? 'var(--accent2)' : (isLadderSel ? 'var(--accent)' : 'var(--border-bright)');
    const sw = (isFrom || isLadderSel) ? 3 : 1.5;
    const label = (n.name || 'Orbit').slice(0, 12);
    nodesHTML += `<g style="cursor:pointer" onclick="archMapNodeClick('${n.id}')"><title>${escHtml(n.name)} &mdash; ${escHtml(n.body)}</title>
      <circle cx="${x}" cy="${y}" r="19" fill="${stroke}" fill-opacity="0.18" stroke="${stroke}" stroke-width="${sw}"/>
      <text x="${x}" y="${y + 3}" text-anchor="middle" font-family="var(--mono)" font-size="9px" fill="var(--text-bright)">${escHtml(label)}</text>
    </g>`;
  });

  const svgHTML = `<svg viewBox="0 0 ${lay.W} ${lay.H}" preserveAspectRatio="xMidYMid meet" style="width:100%;max-width:none;height:auto;max-height:340px;background:transparent;display:block;">${edgesHTML}${nodesHTML}</svg>`;
  return `${ctrlHTML}<div style="overflow-x:auto;">${svgHTML}</div>${chainHTML}`;
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
