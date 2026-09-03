
// ─── SHARED HTML ESCAPER ──────────────────────
// escHtml() escapes & < > " ' and is the one escaper; _tsEsc/_orbVehEsc/_mrEsc
// are aliases kept for their call sites. Loads first so everything can use it.
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── VERSION & CHANGELOG ──────────────────────
// Single source of truth for the displayed version + patch notes (header button
// opens #modal-patch-notes). Bump APP_VERSION and prepend an entry on release.
const APP_VERSION='2.2.0';
const APP_CHANGELOG=[{v:'2.2.0', title:'Architecture page', date:'2026-07-21', notes:[
    'NEW Architecture page: plan your mission\'s orbit ladder and transfers before you fly it. Add named orbits (from the preset catalog or fully custom), draw transfer edges between them, and see the trip\'s delta-V budget add up automatically.',
    'The Mission page now understands your plan: a LAUNCH can target an architecture orbit directly, and "Transfer (from plan)" turns any drawn edge into a real, editable set of maneuver events.',
    'Flight Readiness now flags it when a flown mission drifts from its own plan: a launch that lands off the planned orbital plane, or a mission that ends up needing meaningfully more delta-V than the plan budgeted for.',
    'Missions with no architecture behave exactly as before — the Architecture page is fully optional.',
  ]},
  {v:'2.1.0', title:'Calculator recalibrated to Silverbird', date:'2026-07-18', notes:[
    'The launch vehicle performance calculator now tracks the Silverbird Astronautics reference across multi-stage vehicles. A multi-stage ascent correction was fitted against a 30-configuration probe campaign and validated on held-out higher orbits (800 km, GTO, MEO).',
    'Saturn V 185x185 km max payload moves 150,838 to 125,893 kg. Multi-stage payloads at every destination now land within a few percent of the reference; single-stage vehicles are unchanged.',
    'Falcon 9 Block 5 stage data refreshed: LEO 22,051 kg and GTO 7,493 kg. Falcon Heavy inherits the shared core. Titan presets carry notes documenting where published historical figures diverge from the model.',
  ]},
  {v:'2.0.1', title:'Integral — analysis update', date:'2026-07-15', notes:[
    'NEW Trade Studies sweep: Escape C3 — the classic payload-vs-C3 launch vehicle capability curve, with every metric, vehicle comparison, and CSV export. Pinned to exactly match the Orbits page escape math.',
    'Trade-study line charts are analysis-grade now: hairline series strokes at any window size, finer gridlines, and wheel-zoom / drag-pan / double-click-reset with the y-axis auto-fitting to the zoomed window.',
    'Vehicles page: you can finally OVERWRITE a previously saved vehicle — load it, edit, and Update in place (rename included, no duplicates), or overwrite any My-Vehicles card directly from the library. Builtins stay protected.',
  ]},
  {v:'2.0.0', title:'Integral', date:'2026-07-03', notes:[
    'Version 2.0 of the Rocket Playground focuses primarily on integrating old elements together cohesively and fleshing out previous capabilities.',
    'One, flat, modeless menu: Go from one menu to the next, automatically taking your vehicles with you.',
    'Vehicles page: Launch Site lives inside the Stage Composition card and saves with the vehicle; ΔV Budget and Vehicle Summary folded into one Stage Specifications table with a whole-vehicle column.',
    'Rebuilt orbits page: destination picker, old "performance calculator", and Define-an-Orbit in one menu with a clear highlight on whichever orbit you\'ve targeted without overwriting anything in your vehicles page.',
    'Greatly improved Mission View auto-naming for vehicles, along with new, dedicated undo/redo buttons, alongside a greatly simplified UI.',
    'NEW Trade Studies page - sweep by destination, payload mass, parking orbit, and analyze rocket sensitivity to different vehicle parameters, compare vehicles, and generate charts to understand your architecture\'s sensitivities better in real-time.',
    'Program Mode is no more - The former "Fleet" page has been integrated into the regular vehicle creator, meaning you can draw from existing work with no compromises. The Spacecraft Editor is now its own page, with updates to come to it in short order.',
    'Program Mode\'s mission feature is now present in a tab labeled Mission, and has greatly simplified stage naming and management so you can handle events better.',
    'Autosave now exists!',
    'Download or upload your entire session — worksheet, vehicles, spacecraft, and mission — as a single file.',
    'Performance is better - a really stupid way of rebuilding the database no longer exists, so things should be lighter (but this is like a one megabyte HTML file anyway, so...)',
  ]},
  {v:'1.1.1', title:'Extended Math', date:'2026-07-01', notes:[
    'Added ability to do use equations in stage and vehicle information boxes.',
  ]},
  {v:'1.1.0A', title:'Unified Library', date:'2026-06-21', notes:[
    'An all-new unified stages & vehicles panel across both Program and Calculator mode — designed to increase UI cohesion and discoverability. Vehicles and stages are now sorted directly by their characteristics, while keeping the earlier search capability.',
    'Tags are now simpler. (This mostly makes my life easier.)',
    'The website now fetches from GitHub Pages instead of static HTML — which makes my life really nice.',
    'Bulk downloads: grab ALL of your user-created vehicles and stages in one convenient button.',
    'The “A” at the end is because I pushed too early. Enjoy!',
  ]},
  {v:'1.1.0', title:'Spotlights', date:'2026-06-21', notes:[
    'New Vehicles & Stages library — browse by Era / Origin / Propellant / Class.',
    'Vehicles use a taxonomy browse (tiles → drill → stacked refine); stages use a class-first layout with a side Filters panel.',
    'A "Spotlight" surfaces a random vehicle or stage to discover.',
    'Search composes with whatever filters are active.',
  ]},
  {v:'1.0.3', title:'Added Release Tracking', date:'2026-06-20', notes:[
    'Began tracking releases on GitHub with downloadable builds.',
  ]},
];

// Defensive by design: this runs from _initVersionUI during the
// 590-init top-level sequence, so ANY throw here halts the rest of init —
// PROG_ACTIVE_PROGRAM never gets created and every `let`/`const` declared in
// a later module (600-architecture-model's undo stack, ...) stays in its
// temporal dead zone, bricking the app on a fresh load. That is exactly what
// a single malformed changelog entry did in v2.1.0 (`n:'...'` string instead
// of `notes:[...]` -> `c.notes.map` threw). Entry rendering is now
// field-tolerant AND the whole body is try/caught: patch notes are cosmetic
// and must never be able to take the application down with them.
function _renderPatchNotes(){
  const el=document.getElementById('patch-notes-body'); if(!el)return;
  try{
    el.innerHTML=(APP_CHANGELOG||[]).map(c=>{
      const notes=Array.isArray(c.notes)?c.notes:(c.notes?[c.notes]:[]);
      return `
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
        <span style="font-family:var(--mono);color:var(--accent);font-size:13px;">v${c.v||'?'}</span>
        <span style="font-weight:600;color:var(--text-bright);">${c.title||''}</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto;">${c.date||''}</span>
      </div>
      <ul style="margin:6px 0 0;padding-left:18px;color:var(--text);font-size:12px;line-height:1.6;">
        ${notes.map(n=>`<li>${n}</li>`).join('')}
      </ul>
    </div>`;}).join('');
  }catch(e){
    console.warn('patch notes render failed (non-fatal):',e);
    el.innerHTML='<div style="color:var(--text-dim);font-family:var(--mono);font-size:11px;">Patch notes unavailable.</div>';
  }
}
function openPatchNotes(){ _renderPatchNotes(); openModal('modal-patch-notes'); }
function _initVersionUI(){
  const v=document.getElementById('patch-notes-ver'); if(v)v.textContent='v'+APP_VERSION;
  _renderPatchNotes();
}
