
// ─── PAGE NAVIGATION ──────────────────────────
// Flat, single-row top nav: Vehicles | Orbits | Trade Studies | Program.
// 'results' is a legacy alias (calculate() calls showPage('results') and that
// function is untouchable) — it resolves to the Orbits page, since the Results
// content now lives there, and scrolls #results-panel into view.
const _TOP_PAGES = ['vehicles', 'orbits', 'trades', 'spacecraft', 'program'];

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

  // Legacy 'results' alias: scroll the results panel into view once rendered.
  if(p==='results'){
    const rp=document.getElementById('results-panel');
    if(rp) setTimeout(()=>rp.scrollIntoView({behavior:'smooth',block:'start'}), 0);
  }
}
