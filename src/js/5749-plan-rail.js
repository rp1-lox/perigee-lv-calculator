// ─────────────────────────────────────────────────────────────────────────────
// 5749-plan-rail.js — MISSION_MODEL_V2 §12 U1: the Plan rail
//
// A vertical, compressed rendering of the node/edge skeleton (the Orbit Map's
// data), docked as a left column beside the stage whenever the stage is
// 'traj' or 'band' (never 'nodemap' — the stage IS the full map there, no
// duplication). Reuses 570-mission-nodemap.js's data helpers rather than
// re-deriving them: _missionNmNodes()/_missionNmNodeById (node list incl.
// custom), _missionNmEdgePairs (leg → pair/chip extraction, factored out of
// the full map's edgesHTML block for exactly this reuse), _missionNodePath
// (active-path highlight, 570-mission-panel.js), _nmEdgePhysicsAnnotation
// (430) and _missionLtEdgeEstimate (570-mission-events.js) for the SAME
// tooltip pricing text the full map shows. Click handlers call the SAME
// missionNodeClick/missionEdgeClick entry points — selection is shared (R5).
//
// Collapse state (_planRailCollapsed) and scroll offset (_planRailScroll) are
// per-mission transient view state, same pattern as 574's _trajFrameByMission
// — never persisted, never touches m.log or autosave.
// ─────────────────────────────────────────────────────────────────────────────

let _planRailCollapsed = {};   // missionId -> bool
let _planRailScroll    = {};   // missionId -> scrollTop (pr-body)

function _planRailToggle(id) {
  _planRailCollapsed[id] = !_planRailCollapsed[id];
  if (typeof _missionRenderPreserveNm === 'function') _missionRenderPreserveNm(id);
  else if (typeof missionRenderDetail === 'function') missionRenderDetail();
}

// Which rail section a node belongs to. Built-in nodes already carry `zone`
// ('earth'|'lunar'|'interp' — see 430's PROG_NM_NODES header comment: "Three
// vertical zones: Earth | Lunar | Interplanetary"); custom nodes classify by
// their orbit's body since they have no authored zone.
function _planRailZoneOf(n) {
  if (n.zone && n.zone !== 'custom') return n.zone;
  const b = n.orbit && n.orbit.body;
  if (b === 'Earth') return 'earth';
  if (b === 'Moon') return 'lunar';
  return 'interp';
}

const _PLAN_RAIL_ZONES = [['earth', 'Earth System'], ['lunar', 'Lunar'], ['interp', 'Interplanetary']];

function _planRailNodeChipHTML(id, n, path) {
  const inPath    = path.includes(n.id);
  const isCurrent = path.length > 0 && path[path.length - 1] === n.id;
  const isFrom    = (typeof _missionBridgeFrom !== 'undefined') && _missionBridgeFrom === n.id;
  const cls = ['pr-node'];
  if (inPath) cls.push('pr-active');
  if (isFrom) cls.push('pr-from');
  // Reference-orbit-bound nodes (orbitRefId — NRHO etc.) get the ◆ marker
  // (§12: "the rail is the natural home for reference-orbit nodes").
  const refMark = n.orbitRefId ? ' <span class="pr-ref-marker" title="Bound to a reference orbit">&#9670;</span>' : '';
  const cur = isCurrent ? ' &#9679;' : '';
  const title = `${n.label}${n.sub ? ' — ' + n.sub : ''}${typeof _missionOrientationBadge === 'function' ? _missionOrientationBadge(n, id) : ''}`;
  return `<div class="${cls.join(' ')}" title="${title.replace(/"/g, '&quot;')}" onclick="missionNodeClick('${id}','${n.id}')">
    <div class="pr-node-label">${n.label}${refMark}${cur}</div>
    ${n.sub ? `<div class="pr-node-sub">${n.sub}</div>` : ''}
  </div>`;
}

function _planRailEdgeTooltip(m, id, p, chips) {
  const ann = (typeof _nmEdgePhysicsAnnotation === 'function')
    ? _nmEdgePhysicsAnnotation(id, p.latestIdx != null ? p.latestIdx : Math.max(p.loToHi ?? -1, p.hiToLo ?? -1)) : { flown: false, label: 'estimated' };
  const annTitle = ann.flown ? ` — ${ann.label}` : ' — estimated (schematic)';
  const chipTitle = chips ? ' — ' + chips.map(c => `${c.name} ${Math.round(c.dv).toLocaleString()} m/s`).join(', ') : '';
  const ltEst = (typeof _missionLtEdgeEstimate === 'function') ? _missionLtEdgeEstimate(m, p.lo, p.hi) : null;
  const ltTitle = ltEst ? ` — low-thrust est.: ${Math.round(ltEst.dv_ms).toLocaleString()} m/s${ltEst.tof_s != null ? ' · TOF ' + (ltEst.tof_s / 86400).toFixed(1) + ' d' : ''}` : '';
  return { annTitle, chipTitle, ltTitle };
}

function _planRailEdgeChipHTML(m, byId, k, p, chipsByKey) {
  const A = byId[p.lo], B = byId[p.hi];
  if (!A || !B) return '';
  const idx = p.latestIdx != null ? p.latestIdx : Math.max(p.loToHi ?? -1, p.hiToLo ?? -1);
  if (idx < 0) return '';
  const chips = chipsByKey[k];
  const { annTitle, chipTitle, ltTitle } = _planRailEdgeTooltip(m, m.missionId, p, chips);
  const dv = chips ? chips.reduce((s, c) => s + (c.dv || 0), 0) : ((m.log[idx] && (m.log[idx].dvRequired || m.log[idx].dv)) || 0);
  const label = chips ? chips.map(c => c.name).join(' → ') : (A.label + ' ↔ ' + B.label);
  const title = `${A.label} → ${B.label}${annTitle}${chipTitle}${ltTitle}`.replace(/"/g, '&quot;');
  return `<div class="pr-edge" title="${title}" onclick="missionEdgeClick('${m.missionId}',${idx})">
    <div class="pr-edge-line"></div>
    <div class="pr-edge-chip">${label} · ${Math.round(dv).toLocaleString()} m/s</div>
  </div>`;
}

function _planRailHTML(m) {
  const id = m.missionId;
  if (_planRailCollapsed[id]) {
    return `<div class="mcc-plan-rail collapsed"><button class="pr-toggle" onclick="_planRailToggle('${id}')" title="Expand Plan rail">⟩</button></div>`;
  }
  const byId = {}; (typeof _missionNmNodes === 'function' ? _missionNmNodes() : []).forEach(n => byId[n.id] = n);
  const path = (typeof _missionNodePath === 'function') ? _missionNodePath(m) : [];
  const { pairs, chipsByKey } = (typeof _missionNmEdgePairs === 'function') ? _missionNmEdgePairs(m, byId) : { pairs: {}, chipsByKey: {} };

  let zonesHTML = '';
  for (const [zk, zlabel] of _PLAN_RAIL_ZONES) {
    const nodes = (typeof _missionNmNodes === 'function' ? _missionNmNodes() : [])
      .filter(n => !(n.orbit && n.orbit.type === 'transit'))
      .filter(n => _planRailZoneOf(n) === zk);
    if (!nodes.length) continue;
    zonesHTML += `<div class="pr-zone-hdr">${zlabel}</div>`;
    zonesHTML += nodes.map(n => _planRailNodeChipHTML(id, n, path)).join('');
  }

  let edgesHTML = '';
  for (const k in pairs) edgesHTML += _planRailEdgeChipHTML(m, byId, k, pairs[k], chipsByKey);
  if (edgesHTML) zonesHTML += `<div class="pr-zone-hdr">Transfers</div>${edgesHTML}`;

  if (!zonesHTML) zonesHTML = `<div class="pr-empty">No nodes yet.</div>`;

  return `<div class="mcc-plan-rail">
    <div class="pr-headerbar">
      <button class="pr-toggle" onclick="_planRailToggle('${id}')" title="Collapse Plan rail">⟨</button>
      ${typeof _missionPromote === 'function' ? `<button class="pr-promote-btn" onclick="_missionPromote('${id}','plan')" title="Promote Plan to stage">&#x2922;</button>` : ''}
    </div>
    <div class="pr-body">${zonesHTML}</div>
  </div>`;
}
