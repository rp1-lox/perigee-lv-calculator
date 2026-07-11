
// ─── MISSION MANAGER ─────────────────────────────────────────────────────

let _missions = [];
let _missionSel = null;
let _missionViewMode  = 'band';       // 'band' | 'nodemap' | 'traj'  — band is the primary view
let _missionEvtFilter = { type: 'ALL', veh: 'ALL' };   // events-list filter
let _missionBandScrub = null;
let _missionBandSpacing = 90;          // px per timeline column (user-configurable)
let _missionBandZoom = 1;              // band-view zoom factor (scales rendered SVG)
