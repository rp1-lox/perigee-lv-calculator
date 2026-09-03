// ─── MISSION NODE MAP — schematic phase/ΔV graph ────────────────────────────
// Custom node CRUD (PROG_ACTIVE_PROGRAM.nodeMapCustomNodes), node-map SVG
// rendering (_missionNodeMapHTML, _missionNmLayout), orbit palette,
// orientation badges, node drag, and the per-body color / atmosphere / ring
// constants (PROG_BODY_COLORS/ATMOSPHERE/RINGS) also used by the trajectory view.
//
// User-added nodes live in PROG_ACTIVE_PROGRAM.nodeMapCustomNodes in the same
// shape as PROG_NM_NODES (id, label, sub, orbit, cx, cy …) plus custom:true.
function _missionCustomNodes() {
  return (typeof PROG_ACTIVE_PROGRAM !== 'undefined' && PROG_ACTIVE_PROGRAM && PROG_ACTIVE_PROGRAM.nodeMapCustomNodes) || [];
}
function _missionNmNodes() {
  return [...PROG_NM_NODES, ..._missionCustomNodes()];
}
function _missionNmNodeById(id) {
  return _missionNmNodes().find(n => n.id === id) || null;
}

// terminology: a maneuver endpoint label. Dwell orbits keep "LABEL (sub)".
// Transit-corridor nodes stop reading as orbits you park in: as a DESTINATION the
// label is the departure BURN name ("TLI (trans-lunar)"); as an ORIGIN it's the
// corridor itself ("trans-lunar coast"). dir: 'to' | 'from'.
function _missionManeuverNodeLabel(nid, dir) {
  const n = _missionNmNodeById(nid);
  if (!n) return nid;
  if (n.orbit && n.orbit.type === 'transit') {
    const corridor = n.sub || 'transit';
    if (dir === 'from') return corridor + ' coast';
    const names = _nmBurnNames(n.orbit.departure_body || n.orbit.body, n.orbit.destination);
    return names ? names.dep + ' (' + corridor + ')' : corridor;
  }
  return n.sub ? n.label + ' (' + n.sub + ')' : n.label;
}

// Convert an ORBIT_CATEGORIES entry to a node-map orbit spec (for ΔV physics).
function _missionOrbitToNodeOrbit(o, planet) {
  if (o.mode === 'escape') {
    return { type: 'escape', body: 'Earth', c3: o.c3 ?? 0 };
  }
  // Input `o` is a frozen ORBIT_CATEGORIES entry (060 dialect: perigee/apogee/
  // inc) — read as-is; the OUTPUT node.orbit spec is canonical (C2b item-3).
  const peri = o.perigee ?? o.apogee ?? 0;
  const apo  = o.apogee ?? o.perigee ?? 0;
  const spec = { type: (Math.abs(apo - peri) < 1 ? 'circular' : 'elliptic'),
           body: planet, periKm: peri, apoKm: apo, incDeg: o.inc ?? 0 };
  // Authored orientation is OPTIONAL — only carried over when the
  // source orbit spec actually authored it.
  if (o.lan_deg != null) spec.lanDeg = o.lan_deg;
  if (o.argp_deg != null) spec.argpDeg = o.argp_deg;
  return spec;
}

function _missionCreateCustomNode(label, orbit, x, y, sub) {
  if (!PROG_ACTIVE_PROGRAM) return null;
  if (!PROG_ACTIVE_PROGRAM.nodeMapCustomNodes) PROG_ACTIVE_PROGRAM.nodeMapCustomNodes = [];
  const id = 'custom-' + progUUID();
  const dashed = (orbit.type === 'escape' || orbit.type === 'transit');
  PROG_ACTIVE_PROGRAM.nodeMapCustomNodes.push({
    id, nodeId: id,
    label: String(label || 'NODE').toUpperCase().slice(0, 14),
    sub: sub || (orbit.body + ' ' + orbit.type),
    zone: 'custom', cx: Math.round(x), cy: Math.round(y), r: 15,
    orbit, custom: true, dashed,
  });
  return id;
}

function missionDeleteCustomNode(missionId, nodeId) {
  if (!PROG_ACTIVE_PROGRAM || !PROG_ACTIVE_PROGRAM.nodeMapCustomNodes) return;
  PROG_ACTIVE_PROGRAM.nodeMapCustomNodes = PROG_ACTIVE_PROGRAM.nodeMapCustomNodes.filter(n => n.id !== nodeId);
  delete _missionNmPos[nodeId];
  _missionRerenderNodeView(missionId);
}

// ── Orbit palette drag-and-drop ─────────────────────────────────────────────
function missionNmOrbitDragStart(e, pi, oi) {
  e.dataTransfer.setData('text/plain', pi + ':' + oi);
  e.dataTransfer.effectAllowed = 'copy';
}
function missionNmDrop(e, missionId) {
  e.preventDefault();
  const data = e.dataTransfer.getData('text/plain');
  if (!data || data.indexOf(':') < 0) return;
  const [pi, oi] = data.split(':').map(Number);
  const cat = (typeof ORBIT_CATEGORIES !== 'undefined') ? ORBIT_CATEGORIES[pi] : null;
  if (!cat) return;
  const o = cat.orbits[oi];
  if (!o) return;
  // map drop point to SVG world coords
  let x = 550, y = 260;
  const svg = document.querySelector('.mcc-center-col svg');
  if (svg && svg.getScreenCTM) {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    x = p.x; y = p.y;
  }
  _missionCreateCustomNode(o.name, _missionOrbitToNodeOrbit(o, cat.planet), x, y);
  const m = _missionGet(missionId);
  const va = document.querySelector('.mcc-view-area');
  if (va && m) va.innerHTML = _missionNodeMapHTML(m);
}

// Upload a .orbit file (or LV-calc .json orbit) and add it to the node map as a
// custom node, so users can bring saved orbits into a mission.
function missionLoadOrbitFile(input, missionId) {
  const f = input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const o = JSON.parse(e.target.result);
      if (!o.mode && o.perigee == null && o.apogee == null) { showAlert('Not a valid orbit file.', 'Invalid File'); input.value = ''; return; }
      const planet = (o._category && PROG_BODIES[o._category]) ? o._category : 'Earth';
      const nodeOrbit = _missionOrbitToNodeOrbit(o, planet);
      _missionCreateCustomNode(o.name || 'Orbit', nodeOrbit, 550 + Math.round((Math.random() - 0.5) * 120), 300 + Math.round((Math.random() - 0.5) * 80));
      const m = _missionGet(missionId);
      const va = document.querySelector('.mcc-view-area');
      if (va && m && _missionViewMode === 'nodemap') va.innerHTML = _missionNodeMapHTML(m);
    } catch (err) { showAlert('Invalid orbit file: ' + err.message, 'Invalid File'); }
    input.value = '';
  };
  r.readAsText(f);
}

// ── Manual custom-node modal ────────────────────────────────────────────────
function missionOpenCustomNodeModal(missionId) {
  const bodyEl = document.getElementById('nmnode-body');
  if (!bodyEl) return;
  const bodies = ['Earth','Moon','Mars','Venus','Mercury','Titan'];
  const bodyOpts = bodies.map(b => `<option>${b}</option>`).join('');
  bodyEl.innerHTML = `
    <input type="hidden" id="nmnode-mission" value="${missionId}">
    <div class="cfg-item" style="margin-bottom:8px;"><label class="cfg-label">Label</label>
      <input id="nmnode-label" class="mcc-field-input" style="width:100%;" value="New Node"></div>
    <div class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
      <div class="cfg-item"><label class="cfg-label">Body</label>
        <select id="nmnode-body-sel" class="mcc-field-input">${bodyOpts}</select></div>
      <div class="cfg-item"><label class="cfg-label">Type</label>
        <select id="nmnode-type" class="mcc-field-input" onchange="missionNmNodeTypeChange()">
          <option value="circular">Circular orbit</option>
          <option value="elliptic">Elliptic orbit</option>
          <option value="escape">Escape / transit</option>
        </select></div>
    </div>
    <div id="nmnode-orbit-fields" class="cfg-row" style="flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
      <div class="cfg-item"><label class="cfg-label">Perigee (km)</label>
        <input type="number" id="nmnode-peri" class="field" value="185" style="width:90px;"></div>
      <div class="cfg-item"><label class="cfg-label">Apogee (km)</label>
        <input type="number" id="nmnode-apo" class="field" value="185" style="width:90px;"></div>
      <div class="cfg-item"><label class="cfg-label">Inc (deg)</label>
        <input type="number" id="nmnode-inc" class="field" value="28.5" style="width:80px;"></div>
      <div class="cfg-item"><label class="cfg-label">LAN &Omega; (deg, optional)</label>
        <input type="number" id="nmnode-lan" class="field" placeholder="unauthored" style="width:110px;"></div>
      <div class="cfg-item"><label class="cfg-label">Arg. periapsis &omega; (deg, optional)</label>
        <input type="number" id="nmnode-argp" class="field" placeholder="unauthored" style="width:130px;"></div>
    </div>
    <div id="nmnode-escape-fields" class="cfg-row" style="display:none;flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:8px;">
      <div class="cfg-item"><label class="cfg-label">C3 (km²/s²)</label>
        <input type="number" id="nmnode-c3" class="field" value="0" style="width:100px;"></div>
    </div>
    <button class="act-btn" style="background:var(--accent);color:#000;font-weight:600;padding:5px 14px;" onclick="missionSaveCustomNode()">Add Node</button>`;
  openModal('modal-nm-node');
}
function missionNmNodeTypeChange() {
  const t = document.getElementById('nmnode-type')?.value;
  const orbitF  = document.getElementById('nmnode-orbit-fields');
  const escF    = document.getElementById('nmnode-escape-fields');
  if (!orbitF || !escF) return;
  const isEsc = (t === 'escape');
  orbitF.style.display = isEsc ? 'none' : 'flex';
  escF.style.display   = isEsc ? 'flex' : 'none';
}
function missionSaveCustomNode() {
  const missionId = document.getElementById('nmnode-mission')?.value;
  const label = document.getElementById('nmnode-label')?.value || 'Node';
  const t = document.getElementById('nmnode-type')?.value || 'circular';
  const body = document.getElementById('nmnode-body-sel')?.value || 'Earth';
  let orbit;
  if (t === 'escape') {
    orbit = { type: 'escape', body, c3: parseFloat(document.getElementById('nmnode-c3')?.value) || 0 };
  } else {
    const peri = parseFloat(document.getElementById('nmnode-peri')?.value) || 0;
    const apo  = parseFloat(document.getElementById('nmnode-apo')?.value) || peri;
    orbit = { type: t, body, periKm: peri, apoKm: apo, incDeg: parseFloat(document.getElementById('nmnode-inc')?.value) || 0 };
    // LAN/argp are OPTIONAL — blank means unauthored, never coerced to 0.
    const lanRaw = (document.getElementById('nmnode-lan')?.value ?? '').trim();
    const argpRaw = (document.getElementById('nmnode-argp')?.value ?? '').trim();
    if (lanRaw !== '' && Number.isFinite(parseFloat(lanRaw))) orbit.lanDeg = parseFloat(lanRaw);
    if (argpRaw !== '' && Number.isFinite(parseFloat(argpRaw))) orbit.argpDeg = parseFloat(argpRaw);
  }
  // place new node in open space mid-canvas; user can drag it
  _missionCreateCustomNode(label, orbit, 550 + Math.round((Math.random()-0.5)*120), 300 + Math.round((Math.random()-0.5)*80));
  closeModal('modal-nm-node');
  const m = _missionGet(missionId);
  const va = document.querySelector('.mcc-view-area');
  if (va && m) va.innerHTML = _missionNodeMapHTML(m);
}

// Node-card orientation badge (tooltip line) — same three-tier
// precedence as the ring renderer's _trajRingOrientationFor,
// but resolved from a NODE (not a drawn ring): authored (spec carries
// lan_deg) beats derived (a converged physics leg touched this exact
// (body, peri, apo)) beats default (Ω=0 convention). Compact one-line text,
// e.g. "i 5.3° Ω 141° — from flight" so users discover orientation matters.
function _missionOrientationBadge(n, missionId) {
  const o = n && n.orbit;
  if (!o || o.surface || o.type === 'surface' || o.type === 'transit' || o.type === 'escape') return '';
  const inc = (o.incDeg ?? o.inclination) || 0;
  const oLan = o.lanDeg ?? o.lan_deg;
  if (oLan != null) {
    return ` — i ${inc.toFixed(1)}&deg; &Omega; ${(+oLan).toFixed(1)}&deg; (authored)`;
  }
  if (missionId != null) {
    const legs = (_physTrajByMission[missionId] && _physTrajByMission[missionId].legs) || [];
    const peri = (o.periKm ?? o.perigee) ?? (o.apoKm ?? o.apogee) ?? 0, apo = (o.apoKm ?? o.apogee) ?? (o.periKm ?? o.perigee) ?? 0;
    const key = _trajOrbitKey(o.body, peri, apo);
    for (const L of legs) {
      if (!L.converged) continue;
      if (L.departElements && n.id && L.fromNode === n.id) {
        const d = L.departElements;
        return ` — i ${(d.i * 180 / Math.PI).toFixed(1)}&deg; &Omega; ${(d.raan * 180 / Math.PI).toFixed(1)}&deg; — from flight`;
      }
      if (L.arrivalElements && L.dest && PROG_BODIES[L.dest]) {
        const el = L.arrivalElements, Rd = PROG_BODIES[L.dest].R;
        const p = el.a * (1 - el.e) - Rd, a2 = el.a * (1 + el.e) - Rd;
        if (_trajOrbitKey(L.dest, p, a2) === key) {
          return ` — i ${(el.i * 180 / Math.PI).toFixed(1)}&deg; &Omega; ${(el.raan * 180 / Math.PI).toFixed(1)}&deg; — from flight`;
        }
      }
    }
  }
  return ` — default (&Omega;=0)`;
}

// "dwell = node, transit = edge." A dwell→transit→dwell maneuver CHAIN
// (e.g. LEO→TLC (TLI) then TLC→LLO (LOI)) collapses into ONE edge drawn directly
// between the dwell endpoints, carrying named burn chips (_nmBurnNames, 430) —
// the transit node itself is never drawn. Minimal-log-change: m.log keeps its
// two MANEUVER entries; only this extraction merges them for display. A
// maneuver into/out of a transit node that does NOT chain to a dwell on both
// ends (e.g. authored but not yet continued) is simply not drawn as a
// stop-to-stop line — it's still reachable via the event log/SOI-ring inject.
//
// Factored OUT of _missionNodeMapHTML's edgesHTML block so
// the Plan rail (5749-plan-rail.js) can reuse the SAME pair/chip data instead
// of re-deriving it — data only, no SVG/DOM. Returns { pairs, chipsByKey }
// exactly as the full node map consumed inline before this extraction.
function _missionNmEdgePairs(m, byId) {
  const isTransitId = nid => { const n = byId[nid]; return !!(n && n.orbit && n.orbit.type === 'transit'); };
  const isDwellId = nid => { const n = byId[nid]; return !!(n && n.orbit && n.orbit.type !== 'transit' && n.orbit.type !== 'escape' && n.orbit.type !== 'surface'); };
  const bodyOf = nid => { const n = byId[nid]; return n && n.orbit && (n.orbit.destination || n.orbit.body); };
  const legs = [];
  m.log.forEach((e, i) => { if (_evIsSolvedManeuver(e) && e.fromNode && e.toNode && e.fromNode !== e.toNode) legs.push({ e, i }); });

  const pairs = {};
  const chipsByKey = {};
  const usedLegs = new Set();
  for (let li = 0; li < legs.length; li++) {
    if (usedLegs.has(li)) continue;
    const { e, i } = legs[li];
    if (isDwellId(e.fromNode) && isTransitId(e.toNode)) {
      const arrival = legs.slice(li + 1).find((l, off) => !usedLegs.has(li + 1 + off) && l.e.fromNode === e.toNode && isDwellId(l.e.toNode));
      if (arrival) {
        usedLegs.add(li); usedLegs.add(legs.indexOf(arrival));
        const lo = e.fromNode, hi = arrival.e.toNode;
        const k = lo + '::' + hi + '::t';
        const names = _nmBurnNames(bodyOf(e.fromNode), bodyOf(arrival.e.toNode));
        // 5a: a leg arriving at a node bound to a
        // SEEDED propagated ref-orbit (the NRHO) reads "NRHO insertion",
        // not the generic same-body arrival name (LOI) — it's a distinct
        // solved maneuver (physSolveNrhoTransfer), not a Keplerian LOI.
        const arrNode = byId[arrival.e.toNode];
        const arrName = (arrNode && arrNode.orbitRefId) ? 'NRHO insertion' : names.arr;
        pairs[k] = { lo, hi, loToHi: i, hiToLo: null, latestIdx: arrival.i };
        chipsByKey[k] = [
          { name: names.dep, dv: e.dvRequired || e.dv || 0, idx: i },
          { name: arrName, dv: arrival.e.dvRequired || arrival.e.dv || 0, idx: arrival.i },
        ];
        continue;
      }
    }
    if (isTransitId(e.fromNode) || isTransitId(e.toNode)) continue;   // unpaired transit leg — no stop-to-stop line
    const lo = e.fromNode < e.toNode ? e.fromNode : e.toNode;
    const hi = e.fromNode < e.toNode ? e.toNode : e.fromNode;
    const k = lo + '::' + hi;
    if (!pairs[k]) pairs[k] = { lo, hi, loToHi: null, hiToLo: null };
    if (e.fromNode === lo) pairs[k].loToHi = i; else pairs[k].hiToLo = i;
  }
  return { pairs, chipsByKey };
}

function _missionNodeMapHTML(m) {
  const id = m.missionId;
  const path = _missionNodePath(m);
  const byId = {}; _missionNmNodes().forEach(n => byId[n.id] = n);

  // ── data-driven solar-system layout ──────────────────────────────────────
  // Every body gets a column; orbital nodes fan ABOVE the body, transit/escape
  // approach nodes sit to the LEFT at the body's baseline (so they line up with
  // the planet they lead to). World is wide — zoom/scroll to view it all.
  const lay = _missionNmLayout();
  const BODY_COL = lay.bodyCol;
  const pos = lay.pos;
  const posOf = n => _missionNmPos[n.id] || pos[n.id] || [n.cx || 0, n.cy || 0];

  // ── control bar (Draw Maneuver + custom nodes + zoom) ──
  let ctrlHTML = `<div class="sl" style="margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
    <button class="act-btn" style="${_missionBridgeMode ? 'background:var(--accent);color:#000;' : ''}" onclick="missionToggleBridgeMode('${id}')">＋ Draw Maneuver</button>
    <span style="display:inline-flex;align-items:center;gap:2px;">
      <button class="act-btn" style="padding:1px 8px;" onclick="missionNmZoom('${id}',-1)" title="Zoom out">−</button>
      <button class="act-btn" style="padding:1px 8px;" onclick="missionNmZoom('${id}',0)" title="Reset zoom">⊡</button>
      <button class="act-btn" style="padding:1px 8px;" onclick="missionNmZoom('${id}',1)" title="Zoom in">+</button>
    </span>`;
  if (_missionBridgeMode) {
    if (_missionBridgeFrom === null) {
      ctrlHTML += `<span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">Click a start node…</span>`;
    } else {
      const fl = byId[_missionBridgeFrom] ? byId[_missionBridgeFrom].label : _missionBridgeFrom;
      ctrlHTML += `<span style="font-family:var(--mono);font-size:10px;color:var(--text-bright);">From ${fl} — click a destination node</span>`;
      ctrlHTML += `<button class="act-btn" style="padding:2px 8px;font-size:10px;" onclick="missionToggleBridgeMode('${id}')">Cancel</button>`;
    }
  }
  ctrlHTML += `</div>`;

  // ── planet blobs: SOI glow + dashed SOI ring + body disc (clickable if a
  //    surface node exists for that body) ──
  let blobsHTML = '';
  for (const b of lay.blobs) {
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR}" fill="${b.col}" fill-opacity="0.04"/>`;
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR * 0.72}" fill="${b.col}" fill-opacity="0.05"/>`;
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR * 0.44}" fill="${b.col}" fill-opacity="0.07"/>`;
    // SOI ring — clickable for bodies you can inject toward (TLI / TMI / TVI). Clicking
    // it adds the mandatory transfer-injection burn from the focused vehicle's orbit.
    const canInject = !!_MISSION_SOI_INJECT[b.body];
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR}" fill="none" stroke="${b.col}" stroke-width="${canInject ? 1.6 : 1}" stroke-opacity="${canInject ? 0.55 : 0.18}" stroke-dasharray="4,5"/>`;
    if (canInject) blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.soiR}" fill="none" stroke="transparent" stroke-width="18" style="cursor:pointer" onclick="missionInjectToBody('${id}','${b.body}')"><title>Inject toward ${b.body} — adds the transfer burn (you can't arrive without it)</title></circle>`;
    const inPath    = b.surfId && path.includes(b.surfId);
    const isCurrent = b.surfId && path.length > 0 && path[path.length - 1] === b.surfId;
    const isFrom    = b.surfId && _missionBridgeFrom === b.surfId;
    const stroke = isFrom ? 'var(--accent2)' : inPath ? 'var(--accent)' : b.col;
    const sw = (isFrom || isCurrent) ? 3 : (inPath ? 2.5 : 1.6);
    const open = b.surfId ? `<g style="cursor:pointer" onclick="missionNodeClick('${id}','${b.surfId}')" onmousedown="missionNmNodeDown(event,'${id}','${b.surfId}')" oncontextmenu="return false;"><title>${b.body} — surface</title>` : '<g>';
    blobsHTML += open;
    blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.bodyR}" fill="${b.col}" fill-opacity="0.5" stroke="${stroke}" stroke-width="${sw}"/>`;
    if (isCurrent) blobsHTML += `<circle cx="${b.cx}" cy="${b.cy}" r="${b.bodyR + 5}" fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.5"/>`;
    blobsHTML += `<text x="${b.cx}" y="${b.cy + b.bodyR + 12}" text-anchor="middle" font-family="var(--mono)" font-size="9px" font-weight="600" letter-spacing="1" fill="${b.col}">${b.body.toUpperCase()}</text>`;
    blobsHTML += `</g>`;
  }

  // ── maneuver edges (directional arrows; double-headed when traversed both ways) ──
  // Edges clip to each node's visual radius so they stop at the planet edge instead
  // of cutting through the body disc (surface nodes sit at the planet centre).
  const surfR = {}; lay.blobs.forEach(b => { if (b.surfId) surfR[b.surfId] = b.bodyR; });
  const radiusOf = n => surfR[n.id] || n.r || 16;
  let edgesHTML = '';
  {
    const { pairs, chipsByKey } = _missionNmEdgePairs(m, byId);
    for (const k in pairs) {
      const p = pairs[k];
      const A = byId[p.lo], B = byId[p.hi];
      if (!A || !B) continue;
      const [ax, ay] = posOf(A), [bx, by] = posOf(B);
      const rA = radiusOf(A), rB = radiusOf(B);
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const Ax = ax + ux * rA, Ay = ay + uy * rA, Bx = bx - ux * rB, By = by - uy * rB;   // clipped to node edges
      const bothWays = p.loToHi != null && p.hiToLo != null;
      const latestIdx = p.latestIdx != null ? p.latestIdx : Math.max(p.loToHi == null ? -1 : p.loToHi, p.hiToLo == null ? -1 : p.hiToLo);
      const col = 'var(--accent)';
      // Annotate from the physics side-table (_physTrajByMission via
      // _nmEdgePhysicsAnnotation, 430) — display only, NEVER touches ΔV (that
      // stays sourced from progNmComputeEdgeDv/dvOverride exclusively).
      const ann = _nmEdgePhysicsAnnotation(id, latestIdx);
      const annTitle = ann.flown ? ` — ${_tsEsc(ann.label)}` : ' — estimated (schematic)';
      const chips = chipsByKey[k];
      const chipTitle = chips ? ' — ' + chips.map(c => `${c.name} ${Math.round(c.dv).toLocaleString()} m/s`).join(', ') : '';
      // E3 dual pricing (tooltip): PARALLEL Edelbaum est. when the acting
      // vehicle's active stage is EP-capable — impulsive numbers untouched.
      const ltEst = _missionLtEdgeEstimate(m, p.lo, p.hi);
      const ltTitle = ltEst ? ` — low-thrust est.: ${Math.round(ltEst.dv_ms).toLocaleString()} m/s${ltEst.tof_s != null ? ' · TOF ' + (ltEst.tof_s / 86400).toFixed(1) + ' d' : ''}` : '';
      edgesHTML += `<g style="cursor:pointer" onclick="missionEdgeClick('${id}',${latestIdx})"><title>${bothWays ? '↔ round trip — ' : ''}${chips ? 'trans-lunar transfer' : 'maneuver'} (click to open)${annTitle}${chipTitle}${ltTitle}</title>`;
      edgesHTML += `<line x1="${Ax}" y1="${Ay}" x2="${Bx}" y2="${By}" stroke="transparent" stroke-width="14"/>`;
      edgesHTML += `<line x1="${Ax}" y1="${Ay}" x2="${Bx}" y2="${By}" stroke="${col}" stroke-width="2.5" opacity="0.85"${chips ? ' stroke-dasharray="6 3"' : ''}/>`;
      if (p.loToHi != null || bothWays) edgesHTML += _nmArrowHead(Ax, Ay, Bx, By, col, 2);   // arrow at hi edge
      if (p.hiToLo != null || bothWays) edgesHTML += _nmArrowHead(Bx, By, Ax, Ay, col, 2);   // arrow at lo edge
      if (ann.flown) {
        // "flown ✓" badge at the edge midpoint — accent-styled, no chromatic literals.
        const mx = (Ax + Bx) / 2, my = (Ay + By) / 2;
        edgesHTML += `<circle cx="${mx}" cy="${my}" r="4.5" fill="var(--bg)" stroke="var(--accent)" stroke-width="1.4"/>`;
        edgesHTML += `<text x="${mx}" y="${my + 2.5}" text-anchor="middle" font-family="var(--mono)" font-size="6.5px" fill="var(--accent)">✓</text>`;
      }
      // burn-name chips (TLI/LOI-style) at the 1/3 and 2/3 points of a merged transit edge.
      if (chips) {
        const at = t => [Ax + (Bx - Ax) * t, Ay + (By - Ay) * t];
        chips.forEach((c, ci) => {
          const [cx, cy] = at(ci === 0 ? 0.33 : 0.67);
          const label = c.name.toUpperCase();
          const tw = Math.max(30, label.length * 6 + 8);
          edgesHTML += `<rect x="${cx - tw / 2}" y="${cy - 8}" width="${tw}" height="16" rx="8" fill="var(--bg)" stroke="var(--accent)" stroke-width="1.2" opacity="0.95"/>`;
          edgesHTML += `<text x="${cx}" y="${cy + 3}" text-anchor="middle" font-family="var(--mono)" font-size="8px" fill="var(--accent)">${_tsEsc(label)}</text>`;
        });
      }
      edgesHTML += `</g>`;
    }
  }

  // ── R6.2' Phase C: manual (vector-authored) burn node-map closure ────────
  // A manual MNODE that classifies to a known node (leg.settleInfo.kind ===
  // 'node', stamped by 565's leg builder via 430's pure
  // _nmClassifySettledOrbit) draws a dashed accent2 edge from its departure
  // point to that node, badged "vector-authored" — distinct from the solid
  // accent solved-edge style above but sharing the same click-to-select
  // path (missionEdgeClick → _missionNmSelectShared). A burn that does NOT
  // settle at a known node ('orbit'/'escape'/no leg yet) instead renders as
  // a small free-burn chip near its departure body. Display only — ΔV
  // accounting stays the vector magnitude via the existing card/replay path.
  let manualEdgesHTML = '', freeBurnHTML = '';
  {
    const bodyPos = {}; lay.blobs.forEach(b => { bodyPos[b.body] = [b.cx, b.cy]; });
    m.log.forEach((e, i) => {
      if (!_evIsManualBurn(e)) return;
      const info = _missionMnodeSettleInfo(id, i);
      const dvMag = Math.sqrt(Math.pow(e.dvPro_ms || 0, 2) + Math.pow(e.dvRad_ms || 0, 2) + Math.pow(e.dvNrm_ms || 0, 2));
      const departBody = (e.orbitAtBurn && e.orbitAtBurn.body) || (info && info.body) || 'Earth';
      const met = (e.at && e.at.value_s != null) ? e.at.value_s : (e.metStart || 0);
      if (info && info.kind === 'node') {
        const toNode = byId[info.nodeId]; if (!toNode) return;
        const fromNode = info.fromNodeId ? byId[info.fromNodeId] : null;
        const [ax, ay] = fromNode ? posOf(fromNode) : (bodyPos[departBody] || [0, 0]);
        const [bx, by] = posOf(toNode);
        const rB = radiusOf(toNode);
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        const Bx = bx - ux * rB, By = by - uy * rB;
        manualEdgesHTML += `<g style="cursor:pointer" onclick="missionEdgeClick('${id}',${i})"><title>vector-authored maneuver — ${Math.round(dvMag).toLocaleString()} m/s · ${_metFmt(met)} → ${_tsEsc(toNode.label)}</title>`;
        manualEdgesHTML += `<line x1="${ax}" y1="${ay}" x2="${Bx}" y2="${By}" stroke="transparent" stroke-width="14"/>`;
        manualEdgesHTML += `<line x1="${ax}" y1="${ay}" x2="${Bx}" y2="${By}" stroke="var(--accent2)" stroke-width="2" stroke-dasharray="5 4" opacity="0.85"/>`;
        manualEdgesHTML += _nmArrowHead(ax, ay, Bx, By, 'var(--accent2)', 2);
        const mx = (ax + Bx) / 2, my = (ay + By) / 2;
        manualEdgesHTML += `<circle cx="${mx}" cy="${my}" r="4.5" fill="var(--bg)" stroke="var(--accent2)" stroke-width="1.4"/>`;
        manualEdgesHTML += `<text x="${mx}" y="${my + 2.5}" text-anchor="middle" font-family="var(--mono)" font-size="6.5px" fill="var(--accent2)">⚡</text>`;
        manualEdgesHTML += `</g>`;
      } else {
        const [cx, cy] = bodyPos[departBody] || [0, 0];
        const angle = ((i * 37) % 360) * Math.PI / 180;   // deterministic spread if several chips share a body
        const chipX = cx + Math.cos(angle) * 46, chipY = cy - 90 - (i % 3) * 16;
        const label = (info && info.kind === 'escape')
          ? `⚡ ${Math.round(dvMag).toLocaleString()} m/s · ${_metFmt(met)} · → escape`
          : `⚡ free burn · ${Math.round(dvMag).toLocaleString()} m/s · ${_metFmt(met)}`;
        const tw = Math.max(70, label.length * 4.6);
        const detail = (info && info.kind === 'orbit')
          ? ` (${_tsEsc(info.body)} ${Math.round(info.periKm || 0).toLocaleString()}×${isFinite(info.apoKm) ? Math.round(info.apoKm).toLocaleString() : '∞'} km, ${(info.incDeg || 0).toFixed(1)}°)`
          : '';
        freeBurnHTML += `<g style="cursor:pointer" onclick="missionEdgeClick('${id}',${i})"><title>Manual burn — ${(info && info.kind === 'escape') ? 'escapes ' + _tsEsc(info.body) + ' SOI' : 'settles in an unmatched orbit' + detail}</title>`;
        freeBurnHTML += `<rect x="${chipX - tw / 2}" y="${chipY - 8}" width="${tw}" height="16" rx="8" fill="var(--bg)" stroke="var(--accent2)" stroke-width="1.2" opacity="0.92"/>`;
        freeBurnHTML += `<text x="${chipX}" y="${chipY + 3}" text-anchor="middle" font-family="var(--mono)" font-size="7px" fill="var(--accent2)">${_tsEsc(label)}</text>`;
        freeBurnHTML += `</g>`;
      }
    });
  }

  // ── nodes (skip surface — drawn as the body disc above; skip transit — §13 T3:
  //    "dwell = node, transit = edge." transit-type entries (TLC etc.) stop being
  //    drawn as stops; their hop renders as part of the merged dwell-to-dwell edge
  //    above, with named burn chips. The SOI-ring injection affordance (canInject,
  //    above) remains the way to start a departure without a visible transit node.) ──
  let nodesHTML = '';
  for (const n of PROG_NM_NODES) {
    if (n.orbit && (n.orbit.type === 'surface' || n.orbit.type === 'transit')) continue;
    const [x, y] = posOf(n);
    const inPath    = path.includes(n.id);
    const isCurrent = path.length > 0 && path[path.length - 1] === n.id;
    const isFrom    = _missionBridgeFrom === n.id;
    const r = n.r || 16;
    const stroke = isFrom ? 'var(--accent2)' : inPath ? 'var(--accent)' : (BODY_COL[n.orbit && (n.orbit.destination || n.orbit.body)] || 'var(--border-bright)');
    const sw = (isFrom || isCurrent) ? 3 : (inPath ? 2.5 : 1.5);
    const dash = n.dashed ? ' stroke-dasharray="4 3"' : '';
    const labelColor = inPath ? 'var(--text-bright)' : 'var(--text-dim)';
    nodesHTML += `<g style="cursor:pointer" onclick="missionNodeClick('${id}','${n.id}')" onmousedown="missionNmNodeDown(event,'${id}','${n.id}')" oncontextmenu="return false;"><title>${n.label}${n.sub ? ' — ' + n.sub : ''}${_missionOrientationBadge(n, id)}</title>`;
    nodesHTML += `<circle cx="${x}" cy="${y}" r="${r}" fill="${stroke}" fill-opacity="0.18" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
    if (isCurrent) nodesHTML += `<circle cx="${x}" cy="${y}" r="${r + 5}" fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.5"/>`;
    nodesHTML += `<text x="${x}" y="${y + 3}" text-anchor="middle" font-family="var(--mono)" font-size="9px" fill="${labelColor}">${n.label}</text>`;
    nodesHTML += `</g>`;
  }

  // ── custom (user-added) nodes ──
  for (const n of _missionCustomNodes()) {
    const [x, y] = posOf(n);
    const inPath    = path.includes(n.id);
    const isCurrent = path.length > 0 && path[path.length - 1] === n.id;
    const isFrom    = _missionBridgeFrom === n.id;
    const r = n.r || 15;
    const baseCol = BODY_COL[n.orbit && n.orbit.body] || 'var(--accent2)';
    const stroke = isFrom ? 'var(--accent2)' : inPath ? 'var(--accent)' : baseCol;
    const sw = (isFrom || isCurrent) ? 3 : (inPath ? 2.5 : 1.5);
    const dash = n.dashed ? ' stroke-dasharray="4 3"' : '';
    const labelColor = inPath ? 'var(--text-bright)' : 'var(--text-dim)';
    nodesHTML += `<g style="cursor:pointer" onclick="missionNodeClick('${id}','${n.id}')" onmousedown="missionNmNodeDown(event,'${id}','${n.id}')" oncontextmenu="return false;"><title>${n.label}${n.sub ? ' — ' + n.sub : ''}${_missionOrientationBadge(n, id)} (custom — right-drag to move)</title>`;
    nodesHTML += `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" rx="3" fill="${stroke}" fill-opacity="0.18" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
    if (isCurrent) nodesHTML += `<rect x="${x - r - 4}" y="${y - r - 4}" width="${(r + 4) * 2}" height="${(r + 4) * 2}" rx="4" fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.5"/>`;
    nodesHTML += `<text x="${x}" y="${y + 3}" text-anchor="middle" font-family="var(--mono)" font-size="8px" fill="${labelColor}">${n.label}</text>`;
    // delete affordance
    nodesHTML += `<g onclick="event.stopPropagation();missionDeleteCustomNode('${id}','${n.id}')" style="cursor:pointer"><circle cx="${x + r}" cy="${y - r}" r="6" fill="var(--input)" stroke="var(--accent2)" stroke-width="1"/><text x="${x + r}" y="${y - r + 3}" text-anchor="middle" font-family="var(--mono)" font-size="9px" fill="var(--accent2)">×</text></g>`;
    nodesHTML += `</g>`;
  }

  const pxW = Math.round(lay.worldW * _missionNmZoom);
  const svgHTML = `<svg viewBox="0 0 ${lay.worldW} ${lay.worldH}" preserveAspectRatio="xMidYMid meet" style="width:${pxW}px;max-width:none;height:auto;background:transparent;display:block;" oncontextmenu="return false;" ondragover="event.preventDefault()" ondrop="missionNmDrop(event,'${id}')">${blobsHTML}${edgesHTML}${manualEdgesHTML}${nodesHTML}${freeBurnHTML}</svg>`;
  return `<div class="nm-root">${ctrlHTML}<div class="nm-scroll" onwheel="missionNmWheel(event,'${id}')" onmousedown="missionNmPanStart(event,'${id}')">${svgHTML}</div></div>`;
}

// Per-body identity colors — a DATA palette (like VP_COLORS/TS_SERIES_COLORS,
// exempt from the no-chromatic-literals chrome rule): bodies keep the same
// color in the node map AND the trajectory view so the two stay cohesive.
const PROG_BODY_COLORS = {
  Sun:'#c6a057', Earth:'#5db877', Moon:'#8890bc', Venus:'#d8a657', Mercury:'#aa8866',
  Mars:'#b85848', Jupiter:'#cc8844', Saturn:'#ccbb88', Uranus:'#5fd0d0', Neptune:'#5566dd',
  Titan:'#d69a4e', // hazy orange-tan (not the Moon's bluish hue) — keep in sync with PROG_TEXTURES.Titan + PROG_BODY_ATMOSPHERE.Titan
  Pluto:'#d9a86c', // pale tan/ochre, New Horizons look — keep in sync with ORBIT_CATEGORIES' Pluto color
};

// Per-body atmosphere rim-glow tints — same DATA
// palette exemption as PROG_BODY_COLORS immediately above (keep the two in
// sync: any body with a meaningful atmosphere gets an entry here). Airless
// bodies (Moon, Mercury, etc.) are intentionally ABSENT — the renderer draws
// no glow, or at most a faint neutral-white limb, for anything missing here.
// rgba() literals, not var(--...) — this is body identity data, not chrome.
const PROG_BODY_ATMOSPHERE = {
  Earth: 'rgba(120,170,255,0.55)',
  Mars:  'rgba(214,140,90,0.40)',
  Venus: 'rgba(230,210,140,0.50)',
  Titan: 'rgba(230,150,70,0.50)',
};

// Per-body ring systems — same DATA palette
// exemption as PROG_BODY_COLORS/PROG_BODY_ATMOSPHERE above. Real Saturn
// proportions (equatorial R = 60,268 km): C ring 74,500-92,000 km (faint),
// B ring 92,000-117,580 km (brightest), Cassini division 117,580-122,170 km
// (intentionally OMITTED — the gap between the B and A band paths reads as
// the dark division on its own), A ring 122,170-136,780 km (medium). Radii
// are km from body center; the renderer (574's _trajRingsSVG) samples each
// band's inner/outer edge as a 3D circle in the body's ring plane and scales
// by the same km->px zoom factor as the body disc.
const PROG_BODY_RINGS = {
  Saturn: {
    bands: [
      { rIn: 74500,  rOut: 92000,  color: 'rgba(196,178,140,0.28)' }, // C ring
      { rIn: 92000,  rOut: 117580, color: 'rgba(214,196,156,0.55)' }, // B ring
      { rIn: 122170, rOut: 136780, color: 'rgba(200,182,144,0.40)' }, // A ring
    ],
  },
};

// Compute the solar-system node-map layout: body positions + per-node positions.
// Returns { worldW, worldH, blobs:[…], pos:{id:[x,y]}, bodyCol:{} }.
function _missionNmLayout() {
  // body order (left → right) and per-body geometry (colors from PROG_BODY_COLORS)
  // SoiR is DERIVED from real SOI physics (physSoiRadius, 386)
  // via the pure helper _nmSoiLayoutRadius (430) — log-scaled/clamped for a
  // reasonable layout; provenance, not literal km. The numeric literals below
  // are now only the FALLBACK used if physSoiRadius is unavailable.
  const META = {
    Earth:   { col:PROG_BODY_COLORS.Earth,   bodyR:30, soiR:_nmSoiLayoutRadius('Earth',   150) },
    Moon:    { col:PROG_BODY_COLORS.Moon,    bodyR:14, soiR:_nmSoiLayoutRadius('Moon',    70)  },
    Venus:   { col:PROG_BODY_COLORS.Venus,   bodyR:24, soiR:_nmSoiLayoutRadius('Venus',   95)  },
    Mercury: { col:PROG_BODY_COLORS.Mercury, bodyR:14, soiR:_nmSoiLayoutRadius('Mercury', 60)  },
    Mars:    { col:PROG_BODY_COLORS.Mars,    bodyR:20, soiR:_nmSoiLayoutRadius('Mars',    95)  },
    Jupiter: { col:PROG_BODY_COLORS.Jupiter, bodyR:42, soiR:_nmSoiLayoutRadius('Jupiter', 185) },
    Saturn:  { col:PROG_BODY_COLORS.Saturn,  bodyR:38, soiR:_nmSoiLayoutRadius('Saturn',  160) },
    Uranus:  { col:PROG_BODY_COLORS.Uranus,  bodyR:28, soiR:_nmSoiLayoutRadius('Uranus',  120) },
    Neptune: { col:PROG_BODY_COLORS.Neptune, bodyR:28, soiR:_nmSoiLayoutRadius('Neptune', 120) },
    Pluto:   { col:PROG_BODY_COLORS.Pluto,   bodyR:14, soiR:_nmSoiLayoutRadius('Pluto',   90)  },
  };
  const ORDER = ['Earth','Moon','Venus','Mercury','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'];
  const bodyCol = { Sun: PROG_BODY_COLORS.Sun };
  ORDER.forEach(b => bodyCol[b] = META[b].col);

  const SLOT = 320, PADX = 200, BASE_Y = 470, WORLD_H = 1040;
  // vertical scatter so the bodies aren't in one straight line; each body's node
  // fan + SOI move with it. Earth sits lower since it carries the most orbits.
  const CY = { Earth:600, Moon:340, Venus:680, Mercury:420, Mars:740, Jupiter:380, Saturn:700, Uranus:450, Neptune:620, Pluto:400 };
  const cxOf = si => PADX + si * SLOT;
  const worldW = cxOf(ORDER.length - 1) + PADX;

  // which system a node belongs to (transit/escape route to their destination)
  const sysOf = n => {
    const o = n.orbit || {};
    if ((o.type === 'transit' || o.type === 'escape') && o.destination) return o.destination;
    return o.body;
  };

  // group built-in nodes by system
  const groups = {};
  ORDER.forEach(b => groups[b] = { surface: [], orbital: [], approach: [] });
  for (const n of PROG_NM_NODES) {
    const sys = sysOf(n);
    if (!groups[sys]) continue;
    const t = n.orbit && n.orbit.type;
    if (t === 'surface') groups[sys].surface.push(n);
    else if (t === 'transit' || t === 'escape') groups[sys].approach.push(n);
    else groups[sys].orbital.push(n);
  }

  const meanAlt = n => {
    const o = n.orbit || {};
    return (((o.apoKm ?? o.apogee) ?? (o.periKm ?? o.perigee) ?? 0) + ((o.periKm ?? o.perigee) ?? (o.apoKm ?? o.apogee) ?? 0)) / 2;
  };

  const pos = {};
  const blobs = [];
  ORDER.forEach((body, si) => {
    const cx = cxOf(si), cy = CY[body] ?? BASE_Y, meta = META[body];
    const g = groups[body];
    blobs.push({ body, cx, cy, bodyR: meta.bodyR, soiR: meta.soiR, col: meta.col,
                 surfId: g.surface[0] ? g.surface[0].id : null });
    // surface node sits at the body centre
    g.surface.forEach(n => { pos[n.id] = [cx, cy]; });
    // orbital nodes fan straight above the body, lowest altitude nearest
    g.orbital.sort((a, b) => meanAlt(a) - meanAlt(b));
    g.orbital.forEach((n, rank) => {
      const offy = meta.bodyR + 52 + rank * 56;
      const offx = g.orbital.length > 1 ? (rank % 2 === 0 ? -40 : 40) : 0;
      pos[n.id] = [cx + offx, cy - offy];
    });
    // approach (transit/escape) nodes to the LEFT, centred on the body baseline
    const ac = g.approach.length;
    g.approach.forEach((n, k) => {
      pos[n.id] = [cx - meta.bodyR - 88, cy + (k - (ac - 1) / 2) * 54];
    });
  });

  return { worldW, worldH: WORLD_H, blobs, pos, bodyCol };
}

// ORBITS panel = the LV-calculator's orbit catalog (ORBIT_CATEGORIES), the same
// orbits used everywhere else — grouped by body with the catalog's icons + colours
// and full orbit detail. Click (or drag) one to drop it onto the Orbit Map as a
// node, so the catalog and the map are integrated. Fills the whole sidebar.
function _missionOrbitPaletteHTML(m) {
  const id = m.missionId;
  const hdr = `<div class="nm-orbit-dock-hdr">
    <span style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--text-dim);">ORBITS</span>
    <button class="act-btn" style="padding:1px 8px;font-size:9px;margin-left:auto;" onclick="missionOpenCustomNodeModal('${id}')" title="Add a custom orbit">+ Custom</button>
    <label class="act-btn" style="padding:1px 8px;font-size:9px;cursor:pointer;" title="Upload a .orbit file">Load<input type="file" accept=".orbit,.json" style="display:none" onchange="missionLoadOrbitFile(this,'${id}')"></label>
  </div>`;
  if (typeof ORBIT_CATEGORIES === 'undefined') return `<div class="nm-orbit-dock">${hdr}</div>`;
  let rows = '';
  ORBIT_CATEGORIES.forEach((cat, pi) => {
    rows += `<div class="orbit-body-lbl" style="color:${cat.color};">${cat.icon || ''} ${cat.planet}</div>`;
    cat.orbits.forEach((o, oi) => {
      const detail = o.mode === 'escape'
        ? `C3 ${o.c3} km²/s²`
        : `${(o.perigee || 0).toLocaleString()}×${(o.apogee || 0).toLocaleString()} km · ${o.inc || 0}°`;
      rows += `<div class="orbit-row" draggable="true" ondragstart="missionNmOrbitDragStart(event,${pi},${oi})" onclick="missionCatalogAdd('${id}',${pi},${oi})" title="${(o.note || '').replace(/"/g,'&quot;')}" style="border-left:3px solid ${cat.color};">
        <span class="orbit-row-name">${o.name}</span>
        <span class="orbit-row-sub">${detail}</span>
      </div>`;
    });
  });
  return `<div class="nm-orbit-dock">${hdr}<div class="nm-orbit-scroll">${rows}</div></div>`;
}

// Click an orbit in the catalog → place it on the Orbit Map as a node.
function missionCatalogAdd(id, pi, oi) {
  if (typeof ORBIT_CATEGORIES === 'undefined') return;
  const cat = ORBIT_CATEGORIES[pi]; if (!cat) return;
  const o = cat.orbits[oi]; if (!o) return;
  _missionCreateCustomNode(o.name, _missionOrbitToNodeOrbit(o, cat.planet),
    550 + Math.round((Math.random() - 0.5) * 140), 300 + Math.round((Math.random() - 0.5) * 90));
  const m = _missionGet(id);
  const va = document.querySelector('.mcc-view-area');
  if (va && m && _missionViewMode === 'nodemap') va.innerHTML = _missionNodeMapHTML(m);
}

function missionNmNodeDown(e, missionId, nid) {
  if (e.button !== 2) return;            // right button only; left stays a click
  e.preventDefault(); e.stopPropagation();
  _missionNmDrag = { missionId, nid };
  document.addEventListener('mousemove', missionNmDragMove);
  document.addEventListener('mouseup', missionNmDragEnd);
}
function missionNmDragMove(e) {
  if (!_missionNmDrag) return;
  const svg = document.querySelector('.mcc-center-col svg');
  if (!svg || !svg.getScreenCTM) return;
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  _missionNmPos[_missionNmDrag.nid] = [Math.round(p.x), Math.round(p.y)];
  const va = document.querySelector('.mcc-view-area');   // re-render only the view, keep the palette dock
  const m = _missionGet(_missionNmDrag.missionId);
  if (va && m) {
    const sc = va.querySelector('.nm-scroll');           // preserve pan/scroll across re-render
    const sl = sc ? sc.scrollLeft : 0, st = sc ? sc.scrollTop : 0;
    va.innerHTML = _missionNodeMapHTML(m);               // container persists; doc listeners survive
    const sc2 = va.querySelector('.nm-scroll');
    if (sc2) { sc2.scrollLeft = sl; sc2.scrollTop = st; }
  }
}
function missionNmDragEnd() {
  document.removeEventListener('mousemove', missionNmDragMove);
  document.removeEventListener('mouseup', missionNmDragEnd);
  _missionNmDrag = null;
}
