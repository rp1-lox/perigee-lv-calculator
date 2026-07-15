// ── Timeline dock (MISSION_MODEL_V2 §12, Timeline dock step) ───────────────
// Merges the Band view's per-vehicle lanes with the MET scrubber onto ONE
// shared time axis, docked at the bottom of the trajectory view. Reuses the
// Band's data extraction (_missionBandModel) and its zone/lane color logic
// (_missionBodyGroupOf / _MISSION_BODY_ZONE_COLOR / lane.color) rather than
// reinventing state classification — this module only reprojects that data
// from the Band's column-index x-axis onto a literal MET x-axis (the SAME
// axis the scrub track uses), so a burn tick on the track and its ▲ marker
// on a lane always land at the same %-left.
//
// Interaction model: clicking a lane segment/marker routes through the same
// _trajSelectEventFromView(id, authIdx) used by every other trajectory-view
// hotspot, so the inspector/gizmo hooks fire identically. The scrub track's
// own behaviors (_trajScrubDown/Move/Key, arrow-key nudge, drag) are
// untouched — this module wraps around them, it doesn't replace them.

// Transient (module-local, no persistence) collapsed/expanded state per mission.
let _ttdExpanded = {};

function _ttdToggleExpand(id) {
  _ttdExpanded[id] = !_ttdExpanded[id];
  if (typeof missionRenderDetail === 'function') missionRenderDetail();
}

// Map a Band-model owner's points (indexed by log position, column-based x)
// onto literal MET segments spanning [0, maxMet] — the shared axis with the
// scrub track. Each segment covers [met(point_i), met(point_i+1) or maxMet).
function _ttdLaneModel(m) {
  if (typeof _missionBandModel !== 'function') return { lanes: [], maxMet: 0 };
  const band = _missionBandModel(m);
  const maxMet = (typeof _trajMissionMaxMet === 'function') ? _trajMissionMaxMet(m) : 0;
  const authIdxOf = idx => {
    const log = (m._expanded && m._expanded.length) ? m._expanded : m.log;
    const e = log[idx];
    return e && e._authIdx != null ? e._authIdx : idx;
  };
  const lanes = band.lanes.map(L => {
    const pts = L.points.map(p => {
      const ev = band.events[p.index];
      return { met: ev && ev.met != null ? ev.met : 0, zoneKey: p.zoneKey, status: p.status, index: p.index, authIdx: authIdxOf(p.index) };
    }).filter(p => isFinite(p.met));
    const segs = [];
    for (let i = 0; i < pts.length; i++) {
      const t0 = Math.max(0, pts[i].met);
      const t1 = i + 1 < pts.length ? Math.max(t0, pts[i + 1].met) : maxMet;
      segs.push({ t0, t1, zoneKey: pts[i].zoneKey, bodyGroup: _missionBodyGroupOf(pts[i].zoneKey), status: pts[i].status, authIdx: pts[i].authIdx });
    }
    const burns = pts.filter(p => {
      const ev = band.events[p.index];
      // BURN literals AND the modern unified MNODE maneuvers (solved or
      // manual) — real missions author MNODEs, so BURN-only left the marker
      // pass empty on every current mission (found in delivery review).
      // E3: LOWTHRUST joins the ▲ pass too (the burn STARTS here; its
      // duration renders as a span below, not as this point marker).
      return ev && (ev.type === 'BURN' || ev.type === 'MNODE' || ev.type === 'LOWTHRUST');
    }).map(p => ({ met: p.met, authIdx: p.authIdx, zoneKey: p.zoneKey }));
    // E3 (MISSION_MODEL_V2 §19): a LOWTHRUST leg is a months-long BAND on the
    // lane, not a tick — collect [met, met+duration] spans (durationUsed is
    // stamped by the recompute loop alongside metStart).
    const ltSpans = pts.filter(p => {
      const ev = band.events[p.index];
      return ev && ev.type === 'LOWTHRUST' && ev.durationUsed > 0;
    }).map(p => ({ t0: p.met, t1: p.met + (band.events[p.index].durationUsed || 0), authIdx: p.authIdx }));
    return { name: L.name, color: L.color, expended: L.expended, segs, burns, ltSpans };
  });
  return { lanes, maxMet };
}

const _TTD_LANE_H_COLLAPSED = 7, _TTD_LANE_H_EXPANDED = 14, _TTD_MAX_COLLAPSED_LANES = 3, _TTD_MAX_EXPANDED_LANES = 6;

function _ttdLanesHTML(m, id) {
  const model = _ttdLaneModel(m);
  if (!model.lanes.length || !(model.maxMet > 0)) return '';
  const expanded = !!_ttdExpanded[id];
  const laneH = expanded ? _TTD_LANE_H_EXPANDED : _TTD_LANE_H_COLLAPSED;
  const capIdx = expanded ? _TTD_MAX_EXPANDED_LANES : _TTD_MAX_COLLAPSED_LANES;
  const shown = model.lanes.slice(0, capIdx);
  const hiddenN = model.lanes.length - shown.length;
  const vt = (typeof _trajViewTime === 'function') ? _trajViewTime(m) : 0;

  const rowsHTML = shown.map(L => {
    const segsHTML = L.segs.map(s => {
      const l = Math.max(0, Math.min(100, (s.t0 / model.maxMet) * 100));
      const r = Math.max(0, Math.min(100, (s.t1 / model.maxMet) * 100));
      const w = Math.max(0.4, r - l);
      const zoneColor = _MISSION_BODY_ZONE_COLOR[s.bodyGroup] || 'var(--text-dim)';
      const past = s.t1 <= vt;
      const dead = s.status === 'EXPENDED' || s.status === 'RECOVERED';
      const op = (dead ? 0.4 : 1) * (past ? 0.6 : 1);
      const title = `${_tsEsc(L.name)} · ${_tsEsc(s.zoneKey || '')} · T+${_metFmt(s.t0)}–${_metFmt(s.t1)}`;
      return `<div class="ttd-seg" style="left:${l.toFixed(2)}%;width:${w.toFixed(2)}%;background:${zoneColor};border-top-color:${L.color};opacity:${op}" onclick="_trajSelectEventFromView('${id}',${s.authIdx})" title="${title}"></div>`;
    }).join('');
    // E3: LOWTHRUST spans — duration-wide thrust-colored low-alpha bands laid
    // over the zone segments (the ▲ start marker comes from the burns pass).
    const ltHTML = (L.ltSpans || []).map(s => {
      const l = Math.max(0, Math.min(100, (s.t0 / model.maxMet) * 100));
      const r = Math.max(0, Math.min(100, (s.t1 / model.maxMet) * 100));
      const w = Math.max(0.4, r - l);
      const title = `${_tsEsc(L.name)} low-thrust burn · T+${_metFmt(s.t0)}–${_metFmt(s.t1)}`;
      return `<div class="ttd-seg" style="left:${l.toFixed(2)}%;width:${w.toFixed(2)}%;background:var(--accent2);border-top-color:var(--accent2);opacity:0.35" onclick="_trajSelectEventFromView('${id}',${s.authIdx})" title="${title}"></div>`;
    }).join('');
    const burnsHTML = L.burns.map(b => {
      const l = Math.max(0, Math.min(100, (b.met / model.maxMet) * 100));
      return `<div class="ttd-burn" style="left:${l.toFixed(2)}%" onclick="event.stopPropagation();_trajSelectEventFromView('${id}',${b.authIdx})" title="${_tsEsc(L.name)} burn · T+${_metFmt(b.met)}">▲</div>`;
    }).join('');
    const label = L.name.length > 14 ? L.name.slice(0, 13) + '…' : L.name;
    return `<div class="ttd-lane-row" style="height:${laneH + 4}px">
      <div class="ttd-lane-label" style="border-left-color:${L.color}" title="${_tsEsc(L.name)}">${_tsEsc(label)}</div>
      <div class="ttd-lane-track" style="height:${laneH}px">${segsHTML}${ltHTML}${burnsHTML}</div>
    </div>`;
  }).join('');

  const moreHTML = (!expanded && hiddenN > 0)
    ? `<div class="ttd-lane-row ttd-more-row" style="height:${laneH + 4}px"><div class="ttd-lane-label">&nbsp;</div><div class="ttd-lane-track ttd-more-track" style="height:${laneH}px">+${hiddenN} more</div></div>`
    : '';

  return `<div class="ttd-lanes${expanded ? ' expanded' : ''}" data-mid="${id}">${rowsHTML}${moreHTML}</div>`;
}

// Top-level dock builder — replaces the plain `.traj-scrubber` row in
// _missionTrajViewHTML. Wraps the UNCHANGED scrub track (_trajScrubberHTML)
// so drag/click/arrow-key/focus behaviors and the outerHTML sync in
// _trajApplyCam (which targets `.traj-scrubber` by querySelector) keep
// working exactly as before — only lanes + an expand toggle are added.
function _ttdDockHTML(m, id) {
  const lanesHTML = _ttdLanesHTML(m, id);
  const expanded = !!_ttdExpanded[id];
  const hasLanes = !!lanesHTML;
  const toggleHTML = hasLanes
    ? `<button class="ttd-expand-btn" onclick="_ttdToggleExpand('${id}')" title="${expanded ? 'Collapse lanes' : 'Expand lanes'}">${expanded ? '⌃' : '⌄'}</button>`
    : '';
  return `<div class="traj-timeline-dock" data-mid="${id}">
    <div class="ttd-body">
      ${lanesHTML}
      ${_trajScrubberHTML(m, id)}
    </div>
    ${toggleHTML}
  </div>`;
}
