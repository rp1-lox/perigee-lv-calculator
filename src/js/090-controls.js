
// ─── CONTROLS ─────────────────────────────────
function setStages(n,updateInput=true){
  n=Math.max(1,Math.min(MAX_STAGES,n));numStages=n;
  if(updateInput)document.getElementById('stage-count-input').value=n;
  _suppressUD=true;buildTable();
}
function setBoosters(val){
  useBooster=val;
  document.querySelectorAll('#booster-toggle button').forEach((b,i)=>b.classList.toggle('active',i===(val?0:1)));
  document.getElementById('booster-count-wrap').style.display=val?'flex':'none';
  const mw=document.getElementById('booster-mode-wrap');if(mw)mw.style.display=val?'flex':'none';
  // throttle % row only when boosters on AND mode is 'throttle'
  const tw=document.getElementById('booster-throttle-wrap');
  if(tw)tw.style.display=(val&&document.getElementById('b_parallel_mode')?.value==='throttle')?'flex':'none';
  if(typeof renderExtraBoosterGroups==='function')renderExtraBoosterGroups();
  _suppressUD=true;
  buildTable();
}
// ── Additional strap-on booster groups (multiple kinds + air-lit). Group 1 = the primary
//    booster column; these are Group 2+. Stored in _extraBoosterGroups; lvBoosterGroups()
//    assembles the full list for the shared math. ──
function renderExtraBoosterGroups(){
  const el=document.getElementById('extra-booster-groups'); if(!el) return;
  if(!useBooster){ el.style.display='none'; el.innerHTML=''; return; }
  el.style.display='block';
  const n=_extraBoosterGroups.length;
  const hint = n
    ? `// ${n} additional group${n>1?'s':''} — they appear as cards in Stage Composition; edit with the ✎ wrench, remove with ✕`
    : `// add another kind of strap-on (optionally air-lit after another group); manage it from the Stage Composition cards`;
  el.innerHTML=`<button class="act-btn" onclick="boosterGroupAdd()">+ Add Booster Group</button>
    <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);letter-spacing:.04em;margin-left:8px;">${hint}</span>`;
}
function _bgRefresh(){ renderExtraBoosterGroups(); if(typeof markLVUserDefined==='function')markLVUserDefined(); _suppressUD=true; if(typeof buildStageComposition==='function')buildStageComposition(); }
function boosterGroupAdd(){ _extraBoosterGroups.push({count:2,dry:4000,prop:40000,thrust:3000,isp:280,res:2,parallelMode:'independent',coreThrottle:0.57,ignition:'ground'}); _bgRefresh(); }
function boosterGroupRemove(i){ _extraBoosterGroups.splice(i,1);
  _extraBoosterGroups.forEach((g,k)=>{ const ai=k+1; if(g.ignition&&g.ignition.after!=null&&g.ignition.after>=ai) g.ignition='ground'; });
  _bgRefresh(); }
// Drop a library stage onto an extra-group composition card → fill its specs.
function applyBoosterDataToGroup(i,s){ if(!_extraBoosterGroups[i]||!s)return; const g=_extraBoosterGroups[i];
  g.dry=parseFloat(s.dry)||0; g.prop=parseFloat(s.prop)||0; g.thrust=parseFloat(s.thrust)||0; g.isp=parseFloat(s.isp)||1; g.res=s.res!=null?s.res:2; g.name=s.name||g.name; _bgRefresh(); }
// Booster parallel-staging mode: 'independent' | 'crossfeed' | 'throttle'. The throttle %
// row is only shown for 'throttle'. Triggers a recompute of the composition preview.
function setBoosterMode(mode){
  const hid=document.getElementById('b_parallel_mode'); if(hid)hid.value=mode;
  document.querySelectorAll('#b-parallel-seg button').forEach(b=>b.classList.toggle('active',b.dataset.pm===mode));
  const row=document.getElementById('booster-throttle-wrap'); if(row)row.style.display=(mode==='throttle')?'flex':'none';
  if(typeof markLVUserDefined==='function')markLVUserDefined();
  _suppressUD=true; if(typeof buildStageComposition==='function')buildStageComposition();
}
// Restore the mode UI from a loaded vehicle's boosterData (or defaults).
function applyBoosterModeUI(bd){
  const mode=(bd&&bd.parallelMode)||'independent';
  const thrEl=document.getElementById('b_core_throttle');
  if(thrEl&&bd&&isFinite(bd.coreThrottle))thrEl.value=Math.round(bd.coreThrottle*100);
  setBoosterMode(mode);
}
function setRestart(val){restartable=val;document.querySelectorAll('#restart-toggle button').forEach((b,i)=>b.classList.toggle('active',i===(val?0:1)));}
function setTraj(t){trajectory=t;document.querySelectorAll('#traj-toggle button').forEach((b,i)=>b.classList.toggle('active',['direct','two-burn','optimal'][i]===t));drawOrbitDiagram();}
function setDestMode(mode){
  destMode=mode;
  document.getElementById('dest-orbit').style.display=mode==='orbit'?'block':'none';
  document.getElementById('dest-escape').style.display=mode==='escape'?'block':'none';
  document.getElementById('mode-orbit-btn').classList.toggle('active',mode==='orbit');
  document.getElementById('mode-escape-btn').classList.toggle('active',mode==='escape');
  drawOrbitDiagram();
}
