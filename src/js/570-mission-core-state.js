
// ─── MISSION MANAGER ─────────────────────────────────────────────────────

let _missions = [];
let _missionSel = null;
// MISSION_MODEL_V2 §12 U3 (tri-view restoration): _missionViewMode is the
// REAL, authoritative view state again — not a mirror of a promotion surface
// (the U1/U2 one-stage-two-rails promotion grammar is retired). Driven by
// missionSetView(id, mode); read directly by missionRenderDetail's tri-toggle
// (World|Timeline|Node map) and by the pre-U2 call sites that always branched
// on it directly (band.js's draw-maneuver flow, the nodemap's own selective
// re-render guard, 5748's low-thrust gizmo mode guard) — those keep working
// unmodified since the value they read is real again.
let _missionViewMode  = 'traj';       // 'band' | 'nodemap' | 'traj'
let _missionEvtFilter = { type: 'ALL', veh: 'ALL' };   // events-list filter
let _missionBandScrub = null;
let _missionBandSpacing = 90;          // px per timeline column (user-configurable)
let _missionBandZoom = 1;              // band-view zoom factor (scales rendered SVG)
