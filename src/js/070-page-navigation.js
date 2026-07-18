
// ─── PAGE NAVIGATION ──────────────────────────
// Flat, single-row top nav: Vehicles | Orbits | Trade Studies | Program.
// 'results' is a legacy alias (calculate() calls showPage('results') and that
// function is untouchable) — it resolves to the Orbits page, since the Results
// content now lives there, and scrolls #results-panel into view.
const _TOP_PAGES = ['vehicles', 'orbits', 'trades', 'spacecraft', 'architecture', 'program'];

function showPage(p){
  let target = p;
  if(target === 'results') target = 'orbits';

  document.querySelectorAll('.page').forEach(el=>{
    el.classList.remove('active');
    el.style.display='none';
  });
  const pg=document.getElementById('page-'+target);
  if(!pg) return;
  pg.classList.add('active');
  pg.style.display=(target==='program')?'flex':'block';

  // top-level nav highlight
  document.querySelectorAll('.nav-btn').forEach(el=>el.classList.remove('active'));
  const topBtn=document.getElementById('nav-'+target);
  if(topBtn) topBtn.classList.add('active');

  if(target==='program' && typeof missionEnsureDefault==='function'){ missionEnsureDefault(); }

  const vvw=document.getElementById('veh-view-wrap');
  if(vvw){vvw.style.display=(target==='vehicles')?'flex':'none';}
  if(target==='trades'){ tsEnsureRendered(); }
  if(target==='spacecraft'){ scEdRenderList(); scEdRenderDetail(); if(typeof scLibSetMode==='function') scLibSetMode(_scLibMode||'mine'); }
  if(target==='orbits' && typeof orbVehRenderSelectorBar==='function'){ orbVehRenderSelectorBar(); }
  if(target==='architecture' && typeof archRenderPage==='function'){ archRenderPage(); }
  // Re-draw the mini orbit-diagram on navigation TO the orbits page: its
  // overlay layer (230) sizes itself off the panel's REAL measured px rect
  // (see 230's header comment), which is 0x0 while the page is display:none —
  // the very first initOrbitDiagram() call at page-init time draws into a
  // hidden panel and falls back to the nominal _OD_VBW/_OD_VBH box, causing a
  // stretch-scaled overlay (fonts render ~2.5x too big) the first time the
  // user opens Orbits. Re-drawing here, once the page is visible and
  // measurable, fixes that first-paint case.
  if(target==='orbits' && typeof drawOrbitDiagram==='function'){ drawOrbitDiagram(); }

  // Legacy 'results' alias: scroll the results panel into view once rendered.
  if(p==='results'){
    const rp=document.getElementById('results-panel');
    if(rp) setTimeout(()=>rp.scrollIntoView({behavior:'smooth',block:'start'}), 0);
  }
}
