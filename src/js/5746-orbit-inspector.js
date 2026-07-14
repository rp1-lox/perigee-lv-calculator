
// ─── MISSION_MODEL_V2 Phase 3 T4 — Orbit Inspector (direct manipulation) ────
//
// §13 T4: selecting a DWELL orbit (a LAUNCH/DEPLOY node, or a solved
// maneuver's arrival/toNode dwell) opens a compact floating card docked in
// the trajectory view with peri/apo/inc/LAN sliders+numbers. Scrub = cheap
// live ring preview; release/commit = write + missionRecompute (D1 local
// re-solve falls out of the existing architecture: progNmComputeEdgeDv and
// the T2 orbitRefId resolution both re-read node/ref orbits FRESH every
// recompute — see 565-physics-mission.js:986 and 570's replay tail).
//
// Binding taxonomy (two independent systems, both handled — see MATH.md §7r):
//   LAUNCH/DEPLOY  -> bound via e.orbitRefId into the 425 global ref catalog
//                     (builtin tier immutable -> auto-fork; user tier -> edit
//                     in place; unbound -> edit e.orbit inline).
//   MNODE toNode   -> bound via a node id into 430's PROG_NM_NODES (builtin,
//                     immutable) / PROG_ACTIVE_PROGRAM.nodeMapCustomNodes
//                     (user-owned, mutable in place). T2 deliberately left
//                     maneuver targets unbound to the 425 catalog (a second,
//                     conflicting indirection) -- T4 treats the existing
//                     builtin/custom node split as the same two-tier binding
//                     model: builtin node -> auto-fork to a custom node
//                     (rebinding e.toNode); custom node -> mutate in place.

let _oiState = null; // { missionId, authIdx, source:'launch'|'maneuver', evType, nodeId,
                      //   body, peri, apo, inc, lan, binding:'user'|'builtin'|'unbound',
                      //   refId, name }
let _oiScrubTimer = null;
let _oiScrubPending = null; // { field, value } most recent unflushed scrub

// ── selection classification ────────────────────────────────────────────────
// Only LAUNCH/DEPLOY and solved-maneuver arrivals at a real dwell (non-
// transit, non-escape) orbit qualify. Anything else (manual vector burns,
// unresolved/no-orbit events) returns null -> inspector stays/goes closed,
// and the existing gizmo hook (independent, see _trajGizmoOnEventSelected)
// keeps handling MNODE burn-vector editing exactly as before — the two
// coexist by construction (different UI surfaces: docked card vs 3D handles).
function _oiClassify(m, authIdx, e) {
  if (!m || !e) return null;
  if (e.type === 'LAUNCH' || e.type === 'DEPLOY') {
    const o = e.orbit || {};
    // §14 U3: a propagated ref (NRHO) has no peri/apo/inc — read-only card,
    // no sliders (there is nothing here to drag: parameters are fixed by the
    // catalog seed, not authored per-event).
    if (o.propagated && e.orbitRefId) {
      const refEntry = (typeof refOrbitGet === 'function') ? refOrbitGet(e.orbitRefId) : null;
      const samples = (typeof refOrbitSamplePropagated === 'function') ? refOrbitSamplePropagated(e.orbitRefId, 48) : [];
      let periKm = null, apoKm = null;
      const R = (typeof PROG_BODIES !== 'undefined' && PROG_BODIES[o.body]) ? PROG_BODIES[o.body].R : 0;
      if (samples.length) {
        let minD = Infinity, maxD = -Infinity;
        samples.forEach(s => { const d = Math.hypot(s.r[0], s.r[1], s.r[2]); if (d < minD) minD = d; if (d > maxD) maxD = d; });
        periKm = Math.max(0, minD - R); apoKm = Math.max(0, maxD - R);
      }
      return {
        authIdx, source: 'propagated', evType: e.type,
        body: o.body, refId: e.orbitRefId,
        name: refEntry ? refEntry.name : 'propagated orbit',
        periodDays: refEntry && refEntry.period_s ? refEntry.period_s / 86400 : null,
        periKm, apoKm,
      };
    }
    if (o.body == null || o.alt_km == null) return null;
    const isBuiltinRef = e.orbitRefId && typeof refOrbitIsBuiltin === 'function' && refOrbitIsBuiltin(e.orbitRefId);
    const refEntry = e.orbitRefId && typeof refOrbitGet === 'function' ? refOrbitGet(e.orbitRefId) : null;
    return {
      authIdx, source: 'launch', evType: e.type,
      body: o.body, peri: o.alt_km, apo: (o.apo_km != null ? o.apo_km : o.alt_km),
      inc: o.inc_deg || 0, lan: o.lan_deg || 0,
      binding: e.orbitRefId ? (isBuiltinRef ? 'builtin' : 'user') : 'unbound',
      refId: e.orbitRefId || null,
      name: refEntry ? refEntry.name : 'custom orbit',
    };
  }
  if (typeof _evIsSolvedManeuver === 'function' && _evIsSolvedManeuver(e) && e.toNode) {
    const n = (typeof _missionNmNodeById === 'function') ? _missionNmNodeById(e.toNode) : null;
    if (!n || !n.orbit || n.orbit.type === 'transit' || n.orbit.type === 'escape') return null;
    const o = n.orbit;
    if (o.perigee == null) return null;
    return {
      authIdx, source: 'maneuver', nodeId: e.toNode,
      body: o.body, peri: o.perigee, apo: (o.apogee != null ? o.apogee : o.perigee),
      inc: o.inclination || 0, lan: o.lan_deg || 0,
      binding: n.custom ? 'user' : 'builtin',
      refId: null,
      name: n.sub ? n.label + ' (' + n.sub + ')' : n.label,
    };
  }
  return null;
}

// Hooked from _missionNmSelectShared (node-map click) and
// _trajSelectEventFromView (trajectory view ring/marker click) — the same two
// shared-selection entry points the gizmo already hooks (R5 item 3 lineage).
function _oiOnEventSelected(id, authIdx, e) {
  const m = (typeof _missionGet === 'function') ? _missionGet(id) : null;
  const sel = _oiClassify(m, authIdx, e);
  if (!sel) { if (_oiState && _oiState.missionId === id) { _oiState = null; _oiRepaint(id); } return; }
  _oiState = { missionId: id, ...sel };
  // Fly-to (D2 of the task): only when not already anchored there — avoid
  // yanking the camera on every reselect of the same body.
  if (typeof _trajCamByMission !== 'undefined' && typeof _trajFitWKmForBody === 'function') {
    const cam = _trajCamByMission[id];
    if (!cam || cam.anchorBody !== sel.body) {
      const wKm = _trajFitWKmForBody(sel.body, m);
      const prev = cam || {};
      _trajCamByMission[id] = { anchorBody: sel.body, relOffsetKm: { x: 0, y: 0 }, wKm, az: prev.az || 0, el: prev.el != null ? prev.el : Math.PI / 2 };
      if (typeof _trajApplyCam === 'function') _trajApplyCam(id, _trajCamByMission[id]);
    }
  }
  // Ordering fix (found in live verification): the shared selection paths run
  // missionSelectEvent/missionRenderDetail BEFORE this hook, so the panel
  // template has already rendered by the time _oiState is set — without a
  // targeted repaint the card only appears one interaction LATE (on the next
  // unrelated re-render). Patch the card into the CURRENT panel in place.
  _oiRepaint(id);
}

// Insert/replace/remove the inspector card in the mounted panel without a
// full re-render (the template's _oiCardHTML inclusion still covers full
// re-renders; this covers the select-time seam).
function _oiRepaint(id) {
  const canvas = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"] .traj-canvas`);
  if (!canvas) return;
  const existing = canvas.querySelector('.traj-oi-card');
  if (existing) existing.remove();
  const m = (typeof _missionGet === 'function') ? _missionGet(id) : null;
  const html = (m && _oiState && _oiState.missionId === id) ? _oiCardHTML(m) : '';
  if (html) canvas.insertAdjacentHTML('afterbegin', html);
}

function _oiClose() {
  const id = _oiState && _oiState.missionId;
  _oiState = null;
  if (id) _oiRepaint(id);
  if (typeof missionRenderDetail === 'function') missionRenderDetail();
}

function _oiKeydown(evt) {
  if (evt.key === 'Escape' && _oiState) _oiClose();
}
document.addEventListener('keydown', _oiKeydown);

// ── node/ref resolution helpers (fork-on-builtin-edit, shared by both binding systems) ──

// LAUNCH/DEPLOY side: builtin ref -> fork a user copy + rebind; user ref ->
// mutate in place; unbound -> edit the event's inline orbit fields.
function _oiCommitLaunch(m, e, st, merged) {
  if (!e.orbitRefId) {
    const o = e.orbit || (e.orbit = {});
    o.body = st.body; o.alt_km = merged.peri; o.apo_km = merged.apo; o.inc_deg = merged.inc; o.lan_deg = merged.lan;
    if (e.type === 'LAUNCH') e.launchOrbit = { ...o };
  } else if (typeof refOrbitIsBuiltin === 'function' && refOrbitIsBuiltin(e.orbitRefId)) {
    const base = (typeof refOrbitGet === 'function') ? refOrbitGet(e.orbitRefId) : null;
    const forked = (typeof refOrbitAdd === 'function') ? refOrbitAdd({
      name: (base ? base.name : 'orbit') + ' (copy)', body: st.body,
      peri: merged.peri, apo: merged.apo, inc: merged.inc, lan: merged.lan,
    }) : null;
    if (forked) e.orbitRefId = forked.id;
  } else {
    if (typeof refOrbitUpdate === 'function') refOrbitUpdate(e.orbitRefId, { peri: merged.peri, apo: merged.apo, inc: merged.inc, lan: merged.lan });
  }
  // D1 origin-moved case: if a solved maneuver's fromNode represents this
  // launch's dwell (matched via the launch-card default orbit, the existing
  // _missionNodeForLaunch convention), keep it in sync so the UPSTREAM edge
  // it feeds re-solves too. Best-effort by design (see MATH.md §7r) — the
  // node-map's launch-origin representation predates T4 and is not itself
  // bound to e.orbitRefId.
  if (typeof _missionNodeForLaunch === 'function' && typeof _evIsSolvedManeuver === 'function') {
    const originId = _missionNodeForLaunch(m);
    m.launchOrbit = { ...(m.launchOrbit || {}), body: st.body, alt_km: merged.peri, apo_km: merged.apo, inc_deg: merged.inc, lan_deg: merged.lan };
    const orbitSpec = { body: st.body, perigee: merged.peri, apogee: merged.apo, inclination: merged.inc, lan_deg: merged.lan };
    (m.log || []).forEach(e2 => {
      if (_evIsSolvedManeuver(e2) && e2.fromNode === originId) {
        const newId = _oiResolveManeuverNodeId(e2.fromNode, orbitSpec, 'Launch');
        if (newId && newId !== e2.fromNode) {
          e2.fromNode = newId; if (e2.target) e2.target.fromNode = newId;
          if (typeof _missionManeuverNodeLabel === 'function') e2.fromLabel = _missionManeuverNodeLabel(newId, 'from');
        }
      }
    });
  }
}

// Shared by the maneuver-toNode path and the launch-origin sync above:
// builtin node -> auto-fork a custom node (rebind); custom node -> mutate
// its orbit in place. Returns the (possibly new) node id.
function _oiResolveManeuverNodeId(existingNodeId, orbitSpec, labelBase) {
  const n = (typeof _missionNmNodeById === 'function') ? _missionNmNodeById(existingNodeId) : null;
  if (n && n.custom) {
    n.orbit = { ...n.orbit, ...orbitSpec };
    return existingNodeId;
  }
  const label = (n ? n.label : labelBase) + ' (copy)';
  const sub = n ? n.sub : '';
  const dashed = false;
  const spec = { type: (Math.abs((orbitSpec.apogee || 0) - (orbitSpec.perigee || 0)) < 1 ? 'circular' : 'elliptic'),
    body: orbitSpec.body, perigee: orbitSpec.perigee, apogee: orbitSpec.apogee, inclination: orbitSpec.inclination };
  if (orbitSpec.lan_deg != null) spec.lan_deg = orbitSpec.lan_deg;
  return (typeof _missionCreateCustomNode === 'function') ? _missionCreateCustomNode(label, spec, 0, 0, sub) : existingNodeId;
}

function _oiCommitManeuver(m, e, st, merged) {
  const orbitSpec = { body: st.body, perigee: merged.peri, apogee: merged.apo, inclination: merged.inc, lan_deg: merged.lan };
  const newId = _oiResolveManeuverNodeId(e.toNode, orbitSpec, st.name);
  if (newId && newId !== e.toNode) {
    e.toNode = newId; if (e.target) e.target.toNode = newId;
    if (typeof _missionManeuverNodeLabel === 'function') e.toLabel = _missionManeuverNodeLabel(newId, 'to');
  }
}

// ── commit (release / numeric change) — ONE undo step, per D1 ──────────────
function _oiCommit(field, value) {
  const st = _oiState; if (!st) return;
  const m = (typeof _missionGet === 'function') ? _missionGet(st.missionId) : null;
  const e = m && m.log[st.authIdx]; if (!m || !e) return;
  const v = parseFloat(value);
  if (!isFinite(v)) return;
  const merged = { peri: st.peri, apo: st.apo, inc: st.inc, lan: st.lan };
  merged[field] = v;
  if (st.source === 'launch') _oiCommitLaunch(m, e, st, merged);
  else _oiCommitManeuver(m, e, st, merged);
  // recompute's own undo capture (missionUndoCapture, called from the
  // recompute tail) supplies the ONE-step-per-commit guarantee — we call
  // recompute exactly once per commit, same as every other authoring path.
  if (typeof missionRecompute === 'function') missionRecompute(m);
  // _oiState is stale (authIdx/orbit may have moved under a fork) — reselect
  // from the fresh log so the card keeps showing the entry it's bound to.
  _oiOnEventSelected(st.missionId, st.authIdx, m.log[st.authIdx]);
  if (typeof missionRenderDetail === 'function') missionRenderDetail();
}

// ── scrub (input event) — cheap live ring preview, throttled ~33ms ─────────
// Chosen approach (documented per the task's "choose and report"): mutate the
// LIVE orbit object the ring renderer already reads (e.orbit for launch/
// deploy, node.orbit for a maneuver's toNode) IN PLACE, transiently, then
// call the existing _trajApplyCam cheap re-render path (same one wheel-zoom/
// pan already use every frame) instead of writing a dedicated ring-only
// repaint — _trajApplyCam already re-runs _trajWorldSVG off the SAME data
// the ring renderer reads, so a targeted ring-only path would duplicate that
// extraction logic for no real cost saving on this seed's scale. No commit,
// no recompute, no undo entry — a real recompute+render always follows on
// release (_oiCommit), which re-derives the authoritative values and
// overwrites whatever scrub left behind.
function _oiScrub(field, value) {
  const st = _oiState; if (!st) return;
  const v = parseFloat(value);
  if (!isFinite(v)) return;
  st[field] = v; // update the card's own numbers live too
  _oiScrubPending = true;
  if (_oiScrubTimer) return;
  _oiScrubTimer = setTimeout(() => {
    _oiScrubTimer = null;
    if (!_oiScrubPending || !_oiState) return;
    _oiScrubPending = null;
    _oiApplyScrubPreview();
  }, 33);
}

function _oiApplyScrubPreview() {
  const st = _oiState; if (!st) return;
  const m = (typeof _missionGet === 'function') ? _missionGet(st.missionId) : null;
  const e = m && m.log[st.authIdx]; if (!m || !e) return;
  if (st.source === 'launch') {
    const o = e.orbit || (e.orbit = {});
    o.body = st.body; o.alt_km = st.peri; o.apo_km = st.apo; o.inc_deg = st.inc; o.lan_deg = st.lan;
  } else {
    const n = (typeof _missionNmNodeById === 'function') ? _missionNmNodeById(e.toNode) : null;
    if (n) { n.orbit = { ...n.orbit, perigee: st.peri, apogee: st.apo, inclination: st.inc, lan_deg: st.lan }; }
  }
  if (typeof _trajApplyCam === 'function' && typeof _trajCamByMission !== 'undefined') {
    const cam = _trajCamByMission[st.missionId];
    if (cam) _trajApplyCam(st.missionId, cam);
  }
}

// ── card markup ──────────────────────────────────────────────────────────
function _oiSliderRow(label, field, value, min, max, step, unit) {
  const v = (value == null || !isFinite(value)) ? 0 : value;
  return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;">
    <span style="width:34px;font-family:var(--mono);font-size:9px;color:var(--text-dim);">${label}</span>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${v}" style="flex:1;accent-color:var(--accent);"
      oninput="_oiScrub('${field}',this.value)" onchange="_oiCommit('${field}',this.value)">
    <input type="number" value="${(Math.round(v * 100) / 100)}" step="${step}" style="width:64px;background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:10px;padding:3px 5px;"
      onchange="_oiCommit('${field}',this.value)">
    <span style="width:16px;font-family:var(--mono);font-size:9px;color:var(--text-dim);">${unit}</span>
  </div>`;
}

function _oiBindingChip(st) {
  if (st.binding === 'user') return `<span class="mcc-check-badge" title="Bound to a user reference orbit — editing moves EVERY event bound to this ref">ref: user</span>`;
  if (st.binding === 'builtin') return `<span class="mcc-check-badge" title="Bound to a builtin reference orbit (immutable) — first edit auto-forks a user copy and rebinds this event to it">ref: builtin</span>`;
  return `<span class="mcc-check-badge" title="No reference binding — editing changes this event's inline orbit only">unbound</span>`;
}

// Called from _missionTrajViewHTML (574) so the card renders/refreshes on
// every mission render pass — same discipline as the hint chip / gizmo menu.
function _oiCardHTML(m) {
  const st = _oiState;
  if (!st || !m || st.missionId !== m.missionId) return '';
  const e = m.log[st.authIdx];
  if (!e) return '';
  if (st.source === 'propagated') return _oiPropagatedCardHTML(st);
  const title = st.source === 'launch' ? (st.name || 'custom orbit') : (st.name || 'custom orbit');
  return `<div class="traj-oi-card" style="position:absolute;top:8px;right:8px;left:auto;min-width:230px;padding:8px 10px;z-index:55;" onclick="event.stopPropagation();">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
      <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);font-weight:600;">${_tsEsc(title)}</div>
      <button class="act-btn" style="padding:0 6px;" title="Close (Esc)" onclick="_oiClose()">&times;</button>
    </div>
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:6px;">${_tsEsc(st.body)} &middot; ${_oiBindingChip(st)}</div>
    ${_oiSliderRow('Peri', 'peri', st.peri, 100, 500000, 1, 'km')}
    ${_oiSliderRow('Apo', 'apo', st.apo, 100, 500000, 1, 'km')}
    ${_oiSliderRow('Inc', 'inc', st.inc, 0, 180, 0.1, 'deg')}
    ${_oiSliderRow('LAN', 'lan', st.lan, 0, 360, 0.1, 'deg')}
  </div>`;
}

// §14 U3: read-only card for a propagated orbit — name/body/period/peri/apo
// (measured from samples), no sliders (nothing here is authored per-event).
function _oiPropagatedCardHTML(st) {
  const kv = (k, v) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:2px 0;font-family:var(--mono);font-size:10px;"><span style="color:var(--text-dim);">${k}</span><span style="color:var(--text-bright);">${v}</span></div>`;
  return `<div class="traj-oi-card" style="position:absolute;top:8px;right:8px;left:auto;min-width:210px;padding:8px 10px;z-index:55;" onclick="event.stopPropagation();">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
      <div style="font-family:var(--mono);font-size:10px;color:var(--text-bright);font-weight:600;">${_tsEsc(st.name)}</div>
      <button class="act-btn" style="padding:0 6px;" title="Close (Esc)" onclick="_oiClose()">&times;</button>
    </div>
    ${kv('Body', _tsEsc(st.body))}
    ${kv('Period', st.periodDays != null ? st.periodDays.toFixed(2) + ' d' : '—')}
    ${kv('Perilune', st.periKm != null ? Math.round(st.periKm).toLocaleString() + ' km' : '—')}
    ${kv('Apolune', st.apoKm != null ? Math.round(st.apoKm).toLocaleString() + ' km' : '—')}
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:6px;">// propagated orbit — parameters fixed</div>
  </div>`;
}
