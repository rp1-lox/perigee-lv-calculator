
// ─── MISSION MANAGER ─────────────────────────────────────────────────────

let _missions = [];
let _missionSel = null;
// _missionViewMode is a legacy mirror of _missionStageSurface (see below),
// kept in sync by _missionPromote (570-mission-lifecycle.js) so pre-U2 code
// paths that branch on it directly (band.js's draw-maneuver flow, the
// nodemap's own selective re-render, 5748's low-thrust gizmo mode guard)
// keep working unmodified. 'traj'->'world', 'band'->'timeline', 'nodemap'->'plan'.
let _missionViewMode  = 'traj';       // 'band' | 'nodemap' | 'traj'
// MISSION_MODEL_V2 §12 U2: per-mission promotable-surface state — which of
// 'world' (trajectory) | 'timeline' (band lanes+scrubber) | 'plan' (node map)
// is currently the STAGE (the other two dock as rails). Transient UI state
// only: never touches m.log, never persisted (autosave/session/.program),
// same non-persisted pattern as 5749's _planRailCollapsed / 574's
// _trajFrameByMission. Default 'world' per the §12 U2 default layout.
let _missionStageSurface = {};        // missionId -> 'world'|'timeline'|'plan'
let _missionStateCardCollapsed = {};  // missionId -> bool (state-inspector corner card, U2)
let _missionEvtFilter = { type: 'ALL', veh: 'ALL' };   // events-list filter
let _missionBandScrub = null;
let _missionBandSpacing = 90;          // px per timeline column (user-configurable)
let _missionBandZoom = 1;              // band-view zoom factor (scales rendered SVG)
