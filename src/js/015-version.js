
// ─── SHARED HTML ESCAPER ──────────────────────
// Canonical HTML escaper (UNIFICATION_AUDIT item 5). Five ad-hoc escapers used
// to exist: _tsEsc (165) and _orbVehEsc (167) were byte-identical 4-char
// escapers (& < > "); _mrEsc (577) additionally escaped '; but the 3-char
// `esc` locals in 170-save-load-lv.js and 220-launch-sites.js did NOT escape
// double-quotes — an attribute-context injection / broken-markup vector for
// any user-authored name interpolated into an HTML attribute. escHtml() is
// the ONE escaper now (all five entities); the old names are thin aliases
// (kept rather than hunting down every call site) so every one of them picks
// up the quote-safe behavior. Loads first (015) so every later consumer can
// reference it.
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
const APP_VERSION='2.1.0';
const APP_REPO_URL='https://github.com/rp1-lox/perigee-lv-calculator';
const APP_CHANGELOG=[{v:'2.1.0',d:'2026-07-18',t:'Calculator recalibrated to Silverbird',n:'Multi-stage ascent correction fitted against a 30-configuration Silverbird probe campaign (holdout-validated at 800 km/GTO/MEO). Saturn V 185x185 golden moves 150,838 -> 125,893 kg; all multi-stage payloads now track Silverbird raw within a few percent. Single-stage results unchanged. See MATH.md critique 121.'},
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

function _renderPatchNotes(){
  const el=document.getElementById('patch-notes-body'); if(!el)return;
  el.innerHTML=APP_CHANGELOG.map(c=>`
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
        <span style="font-family:var(--mono);color:var(--accent);font-size:13px;">v${c.v}</span>
        <span style="font-weight:600;color:var(--text-bright);">${c.title}</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:auto;">${c.date}</span>
      </div>
      <ul style="margin:6px 0 0;padding-left:18px;color:var(--text);font-size:12px;line-height:1.6;">
        ${c.notes.map(n=>`<li>${n}</li>`).join('')}
      </ul>
    </div>`).join('');
}
function openPatchNotes(){ _renderPatchNotes(); openModal('modal-patch-notes'); }
function _initVersionUI(){
  const v=document.getElementById('patch-notes-ver'); if(v)v.textContent='v'+APP_VERSION;
  _renderPatchNotes();
}
