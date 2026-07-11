
// ── T1: mission time core — display + override plumbing ─────────────────────
// _metFmt(sec) → "T+MM:SS" (<1h), "T+HH:MM" (<1d), "T+Nd HH:MM" (>=1d).
// Annotation only — never affects layout or physics, see missionRecompute.
function _metFmt(sec) {
  if (sec == null || !isFinite(sec)) return '';
  const s = Math.max(0, Math.round(sec));
  const days = Math.floor(s / 86400);
  const hrs  = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days >= 1) return `T+${days}d ${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}`;
  if (hrs  >= 1) return `T+${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}`;
  return `T+${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
}

// Duration unit conversion for the override input (d/h/min/s → seconds and back).
const _MISSION_DURATION_UNITS = { d: 86400, h: 3600, min: 60, s: 1 };
function _missionDurationToSeconds(val, unit) { return (parseFloat(val) || 0) * (_MISSION_DURATION_UNITS[unit] || 1); }
// Pick a "natural" display unit for an auto seconds value (used to preload the edit form).
function _missionNaturalDurationUnit(sec) {
  if (sec == null) return 's';
  if (sec >= 86400) return 'd';
  if (sec >= 3600)  return 'h';
  if (sec >= 60)    return 'min';
  return 's';
}
function _missionSecondsToUnitValue(sec, unit) { return sec == null ? 0 : +(sec / (_MISSION_DURATION_UNITS[unit] || 1)).toFixed(4); }

// ── R6.2' Phase B — maneuver unification predicates ──────────────────────────
// Unified target schema going forward: MNODE{mode:'solved', target:{fromNode,toNode}}
// behaves EXACTLY like a legacy MANEUVER{fromNode,toNode} entry for accounting
// purposes (same progNmComputeEdgeDv path, same node-map edge). These three
// predicates are the ONE place every consumer (replay, cards, node-map dedup,
// checks, report, gizmo) tests "is this a solved/targeted maneuver" so the
// legacy MANEUVER type keeps working as a shim without every call site
// special-casing it. Pure, no mutation.
function _evIsSolvedManeuver(e) {
  if (!e) return false;
  if (e.type === 'MANEUVER') return true;
  return e.type === 'MNODE' && e.mode === 'solved' && !!e.target && !!e.target.fromNode && !!e.target.toNode;
}
// {fromNode,toNode} for a solved/targeted event, from whichever field it's
// stored in (legacy top-level fields vs. unified e.target); null otherwise.
function _evManeuverTarget(e) {
  if (!e) return null;
  if (e.type === 'MANEUVER') return { fromNode: e.fromNode, toNode: e.toNode };
  if (e.type === 'MNODE' && e.target && e.target.fromNode && e.target.toNode) return { fromNode: e.target.fromNode, toNode: e.target.toNode };
  return null;
}
// A vector-authored burn whose magnitude is the |dv| itself, not a solved edge
// — today's classic MNODE, or a unified MNODE that's been detached (mode:'manual').
function _evIsManualBurn(e) {
  return !!e && e.type === 'MNODE' && !_evIsSolvedManeuver(e);
}

// ── R6.2' Phase C — node-map closure display helpers ────────────────────────
// Reads the settled-orbit classification 565's manual-MNODE leg builder
// stamped on the leg (`leg.settleInfo`, via 430's pure
// _nmClassifySettledOrbit) — recomputed fresh every recompute, never
// persisted beyond the transient card/node-map render. null if no leg (e.g.
// propagation not yet run) or no propagable orbit at burn.
function _missionMnodeSettleInfo(missionId, idx) {
  if (typeof physMissionLeg !== 'function') return null;
  const leg = physMissionLeg(missionId, idx);
  return (leg && leg.settleInfo) || null;
}
// Human-readable one-liner for the MNODE card / tooltips: "settles: <node>",
// "settles: <body> a×p km, i°", or "escapes <body> SOI". null if unknown.
function _missionMnodeSettleLabel(missionId, idx) {
  const info = _missionMnodeSettleInfo(missionId, idx);
  if (!info) return null;
  if (info.kind === 'escape') return `escapes ${info.body} SOI`;
  if (info.kind === 'node') {
    const n = (typeof _missionNmNodeById === 'function') ? _missionNmNodeById(info.nodeId) : null;
    return n ? (n.sub ? `${n.label} (${n.sub})` : n.label) : info.nodeId;
  }
  if (info.kind === 'orbit') {
    const apo = isFinite(info.apoKm) ? Math.round(info.apoKm).toLocaleString() : '∞';
    return `${info.body} ${Math.round(info.periKm || 0).toLocaleString()}×${apo} km, ${(info.incDeg || 0).toFixed(1)}°`;
  }
  return null;
}

// Lazy-migrate a legacy MANEUVER (or an old Phase-A detachedFrom-carrying
// MNODE) to the unified schema, in place, on first touch (gizmo open / card
// edit). Idempotent — a no-op for an entry that's already unified or already
// a plain manual MNODE with no detachedFrom baggage. dv components are left
// at 0 for a freshly-migrated solved node; missionRecompute's leg-decompose
// step (565/570) refreshes them from the physics leg immediately after, so
// they're display-only from the very next repaint. Returns true if it
// mutated the entry (caller decides whether that's an undo-worthy edit).
function _missionMigrateManeuverEntry(e) {
  if (!e) return false;
  if (e.type === 'MANEUVER') {
    const target = { fromNode: e.fromNode, toNode: e.toNode };
    e.type = 'MNODE';
    e.mode = 'solved';
    e.target = target;
    e.at = { kind: 'met', value_s: e.metStart != null ? e.metStart : 0 };
    if (e.dvPro_ms == null) e.dvPro_ms = 0;
    if (e.dvRad_ms == null) e.dvRad_ms = 0;
    if (e.dvNrm_ms == null) e.dvNrm_ms = 0;
    return true;
  }
  if (e.type === 'MNODE' && e.detachedFrom && !e.target) {
    e.target = { fromNode: e.detachedFrom.fromNode, toNode: e.detachedFrom.toNode };
    if (e.mode == null) e.mode = 'manual';   // detachedFrom always meant "currently manual"
    return true;
  }
  return false;
}

// Apply a duration override typed in the event card's inline edit section (BURN/MANEUVER only).
function missionApplyDurationOverride(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e) return;
  const val = document.getElementById('edit-dur-val-' + id)?.value;
  const unit = document.getElementById('edit-dur-unit-' + id)?.value || 's';
  if (val === '' || val == null) delete e.durationOverride;
  else e.durationOverride = _missionDurationToSeconds(val, unit);
  missionRecompute(m);
  missionRenderDetail();   // e._expanded persists, so the card re-renders with the (auto)/(custom) hint updated
}
function missionResetDurationOverride(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e) return;
  delete e.durationOverride;
  missionRecompute(m);
  missionRenderDetail();
}
// Apply a ΔV override typed in the event card's inline edit section (MANEUVER only).
function missionApplyDvOverride(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e || e.type !== 'MANEUVER') return;
  const val = document.getElementById('edit-dv-override-' + id)?.value;
  if (val === '' || val == null) delete e.dvOverride;
  else e.dvOverride = parseFloat(val) || 0;
  missionRecompute(m);
  missionRenderDetail();
}
function missionResetDvOverride(id, idx) {
  const m = _missionGet(id); if (!m) return;
  const e = m.log[idx]; if (!e) return;
  delete e.dvOverride;
  missionRecompute(m);
  missionRenderDetail();
}
// Shared duration-override sub-form for the BURN/MANEUVER inline edit section.
function _missionDurationOverrideHTML(id, idx, e) {
  const auto = e.durationAuto;
  const hasOverride = e.durationOverride != null;
  const unit = _missionNaturalDurationUnit(hasOverride ? e.durationOverride : auto);
  const val = hasOverride ? _missionSecondsToUnitValue(e.durationOverride, unit) : '';
  const autoHint = auto != null ? `auto: ${_metFmt(auto)}` : 'auto: n/a';
  const _selStyle = 'background:var(--input);color:var(--text-bright);-webkit-text-fill-color:var(--text-bright);border:1px solid var(--border);font-family:var(--mono);font-size:11px;padding:4px 8px;';
  return `
    <div class="cfg-item"><label class="cfg-label">Duration ${hasOverride ? '<span style="color:var(--accent3)">(custom)</span>' : ''}</label>
      <div style="display:flex;gap:6px;align-items:center;">
        <input type="number" id="edit-dur-val-${id}" class="field" placeholder="${autoHint}" value="${val}" style="width:100px;" onchange="missionApplyDurationOverride('${id}',${idx})">
        <select id="edit-dur-unit-${id}" style="${_selStyle}" onchange="missionApplyDurationOverride('${id}',${idx})">
          <option value="d"${unit==='d'?' selected':''}>days</option>
          <option value="h"${unit==='h'?' selected':''}>hours</option>
          <option value="min"${unit==='min'?' selected':''}>min</option>
          <option value="s"${unit==='s'?' selected':''}>sec</option>
        </select>
        ${hasOverride ? `<button class="act-btn" style="padding:3px 8px;" onclick="missionResetDurationOverride('${id}',${idx})" title="Reset to auto">↺</button>` : ''}
      </div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:2px;">${autoHint}</div>
    </div>`;
}
