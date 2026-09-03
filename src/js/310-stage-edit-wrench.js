
// ─── STAGE EDIT (WRENCH) ──────────────────────
let _editSlot=null; // {stageIdx, isBooster}

function openEditStageModal(stageIdx,isBooster,extraIdx){
  _editSlot={stageIdx,isBooster,extraIdx:(extraIdx!=null?extraIdx:null)};
  // Get current values
  let dry,prop,thrust,isp,res,engines='',note='',tags=[],name='',cat='Upper Stages',isB=false;
  if(extraIdx!=null){
    // editing an additional booster group (Group 2+)
    const g=_extraBoosterGroups[extraIdx]||{};
    dry=g.dry||0;prop=g.prop||0;thrust=g.thrust||0;isp=g.isp||0;res=g.res!=null?g.res:2;
    name=g.name||('Booster Group '+(extraIdx+2));
    isB=true; cat='Side Boosters';
  } else if(isBooster){
    dry=document.getElementById('b_dry')?.value||0;
    prop=document.getElementById('b_prop')?.value||0;
    thrust=document.getElementById('b_thrust')?.value||0;
    isp=document.getElementById('b_isp')?.value||0;
    res=document.getElementById('b_res')?.value||2;
    name=currentBoosterName||'Strap-on Booster';
    isB=true;
    cat='Side Boosters';
  } else {
    const store=stageStore[stageIdx]||{};
    dry=store.dry||0;prop=store.prop||0;thrust=store.thrust||0;isp=store.isp||0;res=store.res||2;
    name=currentStageNames[stageIdx]||'Stage '+(stageIdx+1);
    // Try to find category from library
    const foundCat=findStageCategory(name);
    if(foundCat)cat=foundCat;
    // Find engines/note/tags from library
    const libStage=findStageInLibrary(name);
    if(libStage){engines=libStage.engines||'';note=libStage.note||'';tags=libStage.tags||[];}
  }
  // Fill modal fields
  document.getElementById('stg-name').value=name;
  document.getElementById('stg-dry').value=dry;
  document.getElementById('stg-prop').value=prop;
  document.getElementById('stg-thrust').value=thrust;
  document.getElementById('stg-isp').value=isp;
  document.getElementById('stg-res').value=res;
  document.getElementById('stg-engines').value=engines;
  document.getElementById('stg-note').value=note;
  document.getElementById('stg-tags').value=tags.join(', ');
  document.getElementById('stg-is-booster').checked=isB;
  document.getElementById('stg-new-cat-wrap').style.display='none';
  // Set category
  const sel=document.getElementById('stg-category');
  if([...sel.options].some(o=>o.value===cat))sel.value=cat;
  // Swap footer buttons: hide Add, show Save Changes
  document.getElementById('add-stage-lib-btn').style.display='none';
  document.getElementById('add-stage-save-btn').style.display='none';
  document.getElementById('edit-stage-save-btn').style.display='';
  document.getElementById('stg-base').value='';
  document.querySelector('#modal-add-stage .modal-title').textContent = (extraIdx!=null) ? 'Edit Booster Group' : 'Edit Stage';

  // S1.5 section — only meaningful for real stage slots (not boosters)
  const s15Sec = document.getElementById('stg-s15-section');
  if (s15Sec) s15Sec.style.display = isBooster ? 'none' : '';

  // Parallel-staging section — for any strap-on BOOSTER (primary or extra group).
  const pSec = document.getElementById('stg-parallel-section');
  if (pSec) pSec.style.display = isBooster ? '' : 'none';
  if (pSec && isBooster) {
    const eg = (extraIdx!=null) ? (_extraBoosterGroups[extraIdx]||{}) : null;
    const pm  = eg ? (eg.parallelMode || 'independent') : (document.getElementById('b_parallel_mode')?.value || 'independent');
    const thr = eg ? Math.round((eg.coreThrottle!=null?eg.coreThrottle:0.57)*100) : (document.getElementById('b_core_throttle')?.value || 57);
    const sel = document.getElementById('stg-parallel-mode'); if (sel) sel.value = pm;
    const tin = document.getElementById('stg-throttle');      if (tin) tin.value = thr;
    _stgParallelToggle(pm);
  }

  // Booster-group section — count + ignition + remove (only for additional groups)
  const bgSec = document.getElementById('stg-bgroup-section');
  if (bgSec) bgSec.style.display = (extraIdx!=null) ? '' : 'none';
  if (bgSec && extraIdx!=null) {
    const g = _extraBoosterGroups[extraIdx] || {};
    document.getElementById('stg-bg-count').value = g.count || 2;
    const ign = g.ignition || 'ground';
    const kind = (ign==='ground') ? 'ground' : ((ign && ign.atTime!=null) ? 'time' : 'after');
    document.getElementById('stg-bg-ign').value = kind;
    // "after" options: groups before this one (Group 1 .. Group extraIdx+1)
    const afterSel = document.getElementById('stg-bg-after');
    if (afterSel) {
      const cur = (ign && ign.after!=null) ? ign.after : 0;
      afterSel.innerHTML = Array.from({length: extraIdx+1}, (_,k) => `<option value="${k}"${k===cur?' selected':''}>Group ${k+1}</option>`).join('');
    }
    document.getElementById('stg-bg-time').value = (ign && ign.atTime!=null) ? ign.atTime : 60;
    _stgBgIgnToggle(kind);
  }
  // s15 (stage-and-a-half) markup is optional — only populate it when present,
  // otherwise getElementById(...).checked throws and the modal never opens.
  if (s15Sec && !isBooster && stageIdx >= 0) {
    const sd = stageStore[stageIdx] || {};
    const on = !!sd.s15;
    document.getElementById('stg-s15').checked = on;
    document.getElementById('stg-s15-thrust').value = sd.s15_sust_thrust || '';
    document.getElementById('stg-s15-isp').value    = sd.s15_sust_isp   || '';
    document.getElementById('stg-s15-jet').value    = sd.s15_jet_mass   || '';
    document.getElementById('stg-s15-twr').value    = sd.s15_beco_twr != null ? sd.s15_beco_twr : 1.2;
    const boostIspEl = document.getElementById('stg-s15-boost-isp');
    if (boostIspEl) boostIspEl.value = sd.s15_boost_isp || '';
    toggleS15Fields(on);
    _s15UpdatePreview(stageIdx);
  }

  openModal('modal-add-stage');
}

function toggleS15Fields(on) {
  const fields = document.getElementById('stg-s15-fields');
  if (fields) fields.style.display = on ? '' : 'none';
}

// Show the center-throttle % field only when 'throttle' mode is picked in the booster editor.
function _stgParallelToggle(mode) {
  const w = document.getElementById('stg-throttle-wrap');
  if (w) w.style.display = (mode === 'throttle') ? '' : 'none';
}
// Toggle the "after group" / "T+ time" inputs in the booster-group ignition control.
function _stgBgIgnToggle(kind) {
  const a = document.getElementById('stg-bg-after-wrap'), t = document.getElementById('stg-bg-time-wrap');
  if (a) a.style.display = (kind === 'after') ? '' : 'none';
  if (t) t.style.display = (kind === 'time')  ? '' : 'none';
}
// Remove the additional booster group currently open in the editor.
function _stgBgRemove() {
  if (!_editSlot || _editSlot.extraIdx == null) return;
  const i = _editSlot.extraIdx; _editSlot = null;
  closeModal('modal-add-stage');
  boosterGroupRemove(i);
}

/** Live BECO split preview shown inside the edit modal. stageIdx is unused but kept for back-compat. */
function _s15UpdatePreview(_stageIdx) {
  const pre = document.getElementById('stg-s15-preview');
  if (!pre || !document.getElementById('stg-s15')?.checked) return;
  const dry    = mathValue(document.getElementById('stg-dry')?.value,0);
  const prop   = mathValue(document.getElementById('stg-prop')?.value,0);
  const isp    = mathValue(document.getElementById('stg-isp')?.value,0)    || 1;
  const thrust = mathValue(document.getElementById('stg-thrust')?.value,0);
  const sThrust = parseFloat(document.getElementById('stg-s15-thrust')?.value) || 0;
  const sIsp    = mathValue(document.getElementById('stg-s15-isp')?.value, isp) || isp;
  const jetM    = parseFloat(document.getElementById('stg-s15-jet')?.value)    || 0;
  const twr     = parseFloat(document.getElementById('stg-s15-twr')?.value)    || 1.2;
  const boostIsp = mathValue(document.getElementById('stg-s15-boost-isp')?.value,0) || 0;
  // Route through the ONE S1.5 expansion boundary (stageExpandS15,
  // 140-physics.js) rather than calling
  // _s15BecoSplit directly, so this preview stays byte-identical to what the
  // calculator will actually do with the stage (source-grep-gated: no module
  // outside 140-physics.js may call _s15BecoSplit directly).
  const expanded = stageExpandS15([{ dry, prop, isp, thrust,
    s15: true, s15_sust_thrust: sThrust, s15_sust_isp: sIsp, s15_jet_mass: jetM, s15_beco_twr: twr, s15_boost_isp: boostIsp }],
    { onError: 'annotate' });
  if (expanded[0]._err) { pre.textContent = '// ' + expanded[0]._err; pre.style.color='var(--accent2)'; return; }
  const [ph1, ph2] = expanded;
  pre.style.color = 'var(--text-dim)';
  const fM = v => Math.round(v).toLocaleString() + ' kg';
  pre.textContent =
    `Ph.1 → Ph.2 prop split:  ${fM(ph1.prop)}  →  ${fM(ph2.prop)}`+
    `   |   dry after BECO: ${fM(ph2.dry)}`+
    `   |   booster thrust: ${(thrust - sThrust).toFixed(1)} kN`+
    (boostIsp > 0 ? `   |   Ph.1 Isp (blended): ${ph1.isp.toFixed(1)} s` : '');
}

function doEditStage(){
  if(!_editSlot)return;
  const invalidMath=['stg-dry','stg-prop','stg-thrust','stg-isp','stg-res']
    .map(id=>document.getElementById(id)).find(input=>!commitMathInput(input));
  if(invalidMath){invalidMath.reportValidity();return;}
  const {stageIdx,isBooster,extraIdx}=_editSlot;
  const name=document.getElementById('stg-name').value.trim();
  const dry=mathValue(document.getElementById('stg-dry').value,0);
  const prop=mathValue(document.getElementById('stg-prop').value,0);
  const thrust=mathValue(document.getElementById('stg-thrust').value,0);
  const isp=mathValue(document.getElementById('stg-isp').value,0)||1;
  const res=mathValue(document.getElementById('stg-res').value,2);
  const engines=document.getElementById('stg-engines').value.trim();
  const note=document.getElementById('stg-note').value.trim();
  const tags=document.getElementById('stg-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
  const cat=document.getElementById('stg-category').value;

  if(extraIdx!=null){
    // Update an additional booster group (Group 2+)
    const g=_extraBoosterGroups[extraIdx]; if(!g){_editSlot=null;closeModal('modal-add-stage');return;}
    Object.assign(g,{name,dry,prop,thrust,isp,res,count:Math.max(1,parseInt(document.getElementById('stg-bg-count')?.value)||g.count||1)});
    const pm=document.getElementById('stg-parallel-mode')?.value||'independent';
    g.parallelMode=pm;
    if(pm==='throttle'){ const pt=parseFloat(document.getElementById('stg-throttle')?.value); g.coreThrottle=isFinite(pt)?Math.min(1,Math.max(0.1,pt/100)):0.57; }
    // ignition
    const kind=document.getElementById('stg-bg-ign')?.value||'ground';
    if(kind==='ground') g.ignition='ground';
    else if(kind==='after') g.ignition={after:Math.max(0,parseInt(document.getElementById('stg-bg-after')?.value)||0)};
    else g.ignition={atTime:Math.max(0,parseFloat(document.getElementById('stg-bg-time')?.value)||0)};
    _editSlot=null; closeModal('modal-add-stage');
    if(typeof renderExtraBoosterGroups==='function')renderExtraBoosterGroups();
    if(typeof markLVUserDefined==='function')markLVUserDefined();
    buildStageComposition();
    return;
  }
  if(isBooster){
    // Update booster fields
    ['dry','prop','thrust','isp','res'].forEach(k=>{
      const el=document.getElementById('b_'+k);
      if(el)el.value={dry,prop,thrust,isp,res}[k];
    });
    // Parallel-staging mode (crossfeed / center-throttle) — write the throttle %, then set the
    // mode (setBoosterMode keeps the hidden inputs, the config-grid control and visibility in sync).
    const pm  = document.getElementById('stg-parallel-mode')?.value || 'independent';
    const pThr = parseFloat(document.getElementById('stg-throttle')?.value);
    const tEl = document.getElementById('b_core_throttle'); if (tEl && isFinite(pThr)) tEl.value = pThr;
    if (typeof setBoosterMode === 'function') setBoosterMode(pm);
    else { const hid = document.getElementById('b_parallel_mode'); if (hid) hid.value = pm; }
    currentBoosterName=name;
    boosterSaved=false;
    // If UGC, update library entry
    updateUGCStage(currentBoosterName,{name,dry,prop,thrust,isp,res,engines,note,tags,isBooster:true,_userGenerated:true,_category:cat});
  } else {
    // Update stageStore
    if(!stageStore[stageIdx])stageStore[stageIdx]={};
    Object.assign(stageStore[stageIdx],{dry:String(dry),prop:String(prop),thrust:String(thrust),isp:String(isp),res:String(res)});
    // Update DOM table cells
    ['dry','prop','thrust','isp','res'].forEach(k=>{
      const el=document.getElementById('s'+(stageIdx+1)+'_'+k);
      if(el)el.value={dry,prop,thrust,isp,res}[k];
    });
    // ── S1.5 fields ──
    const s15On = document.getElementById('stg-s15')?.checked ?? false;
    if (s15On) {
      stageCarryS15(stageStore[stageIdx],{
        s15:true,
        s15_sust_thrust:parseFloat(document.getElementById('stg-s15-thrust')?.value) || 0,
        s15_sust_isp:   mathValue(document.getElementById('stg-s15-isp')?.value,0)    || 0,
        s15_jet_mass:   parseFloat(document.getElementById('stg-s15-jet')?.value)    || 0,
        s15_beco_twr:   parseFloat(document.getElementById('stg-s15-twr')?.value)    || 1.2,
        s15_boost_isp:  mathValue(document.getElementById('stg-s15-boost-isp')?.value,0) || 0,
      });
    } else {
      // Clear any previous s15 data
      stageClearS15(stageStore[stageIdx]);
    }
    const wasUGC=isUGCStage(currentStageNames[stageIdx]);
    currentStageNames[stageIdx]=name;
    stageSaved[stageIdx]=false;
    // If UGC, update library entry directly
    if(wasUGC){
      const newStage={name,dry,prop,thrust,isp,res,engines,note,tags,_userGenerated:true,_category:cat};
      stageCarryS15(newStage,stageStore[stageIdx]);
      updateUGCStage(currentStageNames[stageIdx]||name,newStage);
    }
  }
  _editSlot=null;
  closeModal('modal-add-stage');
  buildStageComposition();
  markLVUserDefined();
  buildStageLibrary();
}

function isUGCStage(name){
  if(!name)return false;
  for(const stages of Object.values(userStagesByCategory)){
    if(stages.some(s=>s.name===name))return true;
  }
  return false;
}

function findStageCategory(name){
  for(const [cat,stages] of Object.entries(userStagesByCategory)){
    if(stages.some(s=>s.name===name))return cat;
  }
  for(const [cat,stages] of Object.entries(STAGE_LIBRARY)){
    if(stages.some(s=>s.name===name))return cat;
  }
  return null;
}

function findStageInLibrary(name){
  for(const stages of Object.values(userStagesByCategory)){
    const s=stages.find(s=>s.name===name);if(s)return s;
  }
  for(const stages of Object.values(STAGE_LIBRARY)){
    const s=stages.find(s=>s.name===name);if(s)return s;
  }
  return null;
}

function updateUGCStage(oldName,newStage){
  for(const [cat,stages] of Object.entries(userStagesByCategory)){
    const idx=stages.findIndex(s=>s.name===oldName);
    if(idx>=0){stages[idx]={...newStage,_category:cat};return;}
  }
}
