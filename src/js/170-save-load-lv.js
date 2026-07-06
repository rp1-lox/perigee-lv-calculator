
// ─── SAVE / LOAD LV ───────────────────────────
function buildLVObject(name,note){
  const v=collectVehicle();v.name=name||'Unnamed LV';v.note=note||'';
  // Save stage names alongside data for composition view on load
  v.stageNames=currentStageNames.slice(0,numStages).map((n,i)=>n||null);
  if(currentBoosterName)v.boosterName=currentBoosterName;
  // Structured library tags (era/origin) chosen in the Save LV modal — travel with
  // the vehicle into the program / fleet so it browses correctly there too.
  if(typeof _lvTagHolder!=='undefined' && _lvTagHolder.tags && _lvTagHolder.tags.length) v.tags=[..._lvTagHolder.tags];
  v.performanceCases=[...performanceCases];
  return v;
}
function downloadJSON(obj,filename){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);}
function openSaveLVModal(){
  document.getElementById('lv-save-name').value='';document.getElementById('lv-save-note').value='';
  if(typeof libBuildTagEditor==='function')
    libBuildTagEditor(document.getElementById('lv-save-tags'), _lvTagHolder, [{dim:'era',multi:true},{dim:'origin',multi:false}], 'veh');
  refreshLVSaveSummary();
  openModal('modal-save-lv');setTimeout(()=>document.getElementById('lv-save-name').focus(),100);
}
// "Saving: N stages · boosters: M×/none · launch site: <name> (<lat>°)" — refreshed each open.
function refreshLVSaveSummary(){
  const el=document.getElementById('lv-save-summary');
  if(!el)return;
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const stages=(typeof numStages!=='undefined')?numStages:1;
  let boosterStr='none';
  if(typeof useBooster!=='undefined' && useBooster){
    const nb=document.getElementById('num-boosters');
    const count=nb?parseInt(nb.value)||0:0;
    boosterStr=count+'×';
  }
  const latEl=document.getElementById('site-lat');
  const lat=latEl?parseFloat(latEl.value):NaN;
  const latStr=isFinite(lat)?lat.toFixed(1):'--';
  const site=(typeof getCurrentSite==='function')?getCurrentSite():null;
  const siteName=site?site.name:'Custom';
  el.textContent='Saving: '+stages+' stage'+(stages===1?'':'s')+' · boosters: '+boosterStr+' · launch site: '+esc(siteName)+' ('+latStr+'°)';
}

/**
 * "Use in Program" button handler.
 * Loads the current vehicle configuration into the active Program's vehicleDefinitions[].
 * Spec §5 / Phase 10 item 3.
 */
function progUseCurrentVehicle() {
  if (typeof PROG_ACTIVE_PROGRAM === 'undefined' || !PROG_ACTIVE_PROGRAM) {
    showAlert('No active Program. Open the Program tab first.', 'No Program');
    return;
  }
  const name = (loadedVehicleName || document.getElementById('lv-save-name')?.value || 'Vehicle').trim() || 'Vehicle';
  const obj  = buildLVObject(name, '');
  obj.refId  = typeof progUUID === 'function' ? progUUID() : (Date.now().toString(36));
  const _doAdd = () => {
    if (typeof progRenderVehicleList === 'function') progRenderVehicleList();
    showAlert('Added "' + obj.name + '" to Program vehicle definitions.', 'Vehicle Added');
  };
  const existing = PROG_ACTIVE_PROGRAM.vehicleDefinitions.find(v => v.name === obj.name);
  if (existing) {
    showConfirm('Replace Vehicle', 'Replace existing "' + obj.name + '" in Program?', () => {
      Object.assign(existing, obj);
      _doAdd();
    }, 'Replace');
  } else {
    PROG_ACTIVE_PROGRAM.vehicleDefinitions.push(obj);
    _doAdd();
  }
}
function doSaveLV(){
  const name=document.getElementById('lv-save-name').value.trim()||'LV';
  const note=document.getElementById('lv-save-note').value.trim();
  const obj=buildLVObject(name,note);
  obj._sessionId=Date.now();userLVs.push(obj);buildPresets();closeModal('modal-save-lv');
  if(typeof autosaveScheduleSave==='function')autosaveScheduleSave();
  showAlert('Saved "'+obj.name+'" to your library (My Stuff).','Vehicle Saved');
}
// Secondary action in the Save LV modal: download the current vehicle as a standalone .vehicle JSON,
// without touching the in-app library. Does NOT close the modal.
function downloadLVAsJSON(){
  const name=(document.getElementById('lv-save-name')?.value.trim())||'LV';
  const note=document.getElementById('lv-save-note')?.value.trim()||'';
  const obj=buildLVObject(name,note);
  downloadJSON(obj,name.replace(/[^a-z0-9_-]/gi,'_').toLowerCase()+'.vehicle');
}
function savePerformance(){openSaveCaseModal();} // legacy alias
// Shared apply path for a single-vehicle object, used by loadLVFile and the
// consolidated library Load button's routing.
function applyLVFileObject(obj){
  applyLVObject(obj);
  if(!userLVs.find(lv=>lv.name===obj.name&&lv._sessionId===obj._sessionId)){
    obj._sessionId=obj._sessionId||Date.now();userLVs.push(obj);buildPresets();
  }
}
function loadLVFile(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{try{const obj=JSON.parse(e.target.result);applyLVFileObject(obj);}catch(err){showAlert('Invalid LV JSON: '+err.message,'Invalid File');}};
  reader.readAsText(file);input.value='';
}
// Consolidated library "Load" button (veh mode). Routes by content:
//  - a library bundle (schema 'perigee-lib-v1') -> libImportMine's object path
//  - a single vehicle (.vehicle/.json export)   -> applyLVFileObject
function libLoadVehicleFile(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    let obj;
    try{obj=JSON.parse(e.target.result);}catch(err){showAlert('Invalid file: '+err.message,'Invalid File');input.value='';return;}
    if(obj&&obj.schema==='perigee-lib-v1'){
      if(typeof libImportLibraryObject==='function')libImportLibraryObject(obj);
    } else if(obj&&obj.name!==undefined&&(obj.stageData||obj.stageNames||obj.stages!==undefined)){
      applyLVFileObject(obj);
    } else {
      showAlert('Unrecognized file — expected a saved vehicle (.vehicle/.json) or a Perigee library export.','Invalid File');
    }
    input.value='';
  };
  reader.readAsText(file);
}
function applyLVObject(obj){
  currentStageNames=new Array(15).fill(null);
  currentBoosterName=null;
  stageSaved=new Array(15).fill(false);
  boosterSaved=false;
  if(obj.stageNames)obj.stageNames.forEach((n,i)=>currentStageNames[i]=n);
  if(obj.boosterName)currentBoosterName=obj.boosterName;
  // ── Vehicle config ──
  if(obj.stageData)obj.stageData.forEach((sd,si)=>{
    const entry={dry:String(sd.dry),prop:String(sd.prop),thrust:String(sd.thrust),isp:String(sd.isp),res:String(sd.res??2)};
    if(sd.s15){entry.s15=true;entry.s15_sust_thrust=sd.s15_sust_thrust||0;entry.s15_sust_isp=sd.s15_sust_isp||0;entry.s15_jet_mass=sd.s15_jet_mass||0;entry.s15_beco_twr=sd.s15_beco_twr||1.2;entry.s15_boost_isp=sd.s15_boost_isp||0;}
    stageStore[si]=entry;
  });
  // Resolve stage names if present (new format)
  if(obj.stageNames){
    const resolved=resolvePresetStages(obj);
    resolved.forEach((sd,si)=>{
      const entry={dry:String(sd.dry),prop:String(sd.prop),thrust:String(sd.thrust),isp:String(sd.isp),res:String(sd.res??2)};
      // Carry over s15 fields from the original stageData if present
      const orig=(obj.stageData||[])[si]||{};
      if(orig.s15){entry.s15=true;entry.s15_sust_thrust=orig.s15_sust_thrust||0;entry.s15_sust_isp=orig.s15_sust_isp||0;entry.s15_jet_mass=orig.s15_jet_mass||0;entry.s15_beco_twr=orig.s15_beco_twr||1.2;entry.s15_boost_isp=orig.s15_boost_isp||0;}
      stageStore[si]=entry;
    });
    _suppressUD=true;setStages(resolved.length);
    const bData=resolvePresetBooster(obj);
    setBoosters(!!bData);
    if(bData){['dry','prop','thrust','isp','res'].forEach(k=>{const el=document.getElementById(`b_${k}`);if(el)el.value=bData[k]??0;});document.getElementById('num-boosters').value=bData.count||0;applyBoosterModeUI(bData);}
  } else {
    _suppressUD=true;setStages(obj.stages||1);
    setBoosters(obj.boosters||false);
    if(obj.boosters&&obj.boosterData){const bd=obj.boosterData;['dry','prop','thrust','isp','res'].forEach(k=>{const el=document.getElementById(`b_${k}`);if(el)el.value=bd[k]??0;});document.getElementById('num-boosters').value=bd.count||0;applyBoosterModeUI(bd);}
  }
  // additional booster groups (Group 2+); boosterGroups[0] is the primary loaded above
  _extraBoosterGroups = Array.isArray(obj.boosterGroups) ? obj.boosterGroups.slice(1).map(g=>({...g})) : [];
  if(typeof renderExtraBoosterGroups==='function') renderExtraBoosterGroups();
  if(typeof buildStageComposition==='function') buildStageComposition();
  if(obj.payload!==undefined)document.getElementById('payload-mass').value=obj.payload;
  if(obj.fairingMass!==undefined)document.getElementById('fairing-mass').value=obj.fairingMass;
  if(obj.site){document.getElementById('site-lat').value=obj.site.lat??28.5;document.getElementById('az-min').value=obj.site.azMin??37;document.getElementById('az-max').value=obj.site.azMax??112;matchSiteFromFields();}
  if(typeof launchSiteStripRefresh==='function')launchSiteStripRefresh();
  setDestMode(obj.mode||'orbit');
  if(obj.mode==='escape'&&obj.escape){document.getElementById('c3').value=obj.escape.c3??0;document.getElementById('decl').value=obj.escape.decl??28.5;document.getElementById('escape-perigee').value=obj.escape.perigee??185;}
  else if(obj.orbit){document.getElementById('apogee').value=obj.orbit.apogee??400;document.getElementById('perigee').value=obj.orbit.perigee??400;document.getElementById('inclination').value=obj.orbit.inc??28.5;}
  if(obj.parkingAlt!==undefined)document.getElementById('parking-alt').value=obj.parkingAlt;
  if(obj.trajectory)setTraj(obj.trajectory);
  setTimeout(()=>{const fj=document.getElementById('fairing-jettison');if(fj)fj.value=Math.min(obj.fairingJettison??0,obj.stages??1);},20);
  // ── Performance cases ──
  performanceCases=obj.performanceCases||[];
  // If no cases but legacy single result, wrap it
  if(!performanceCases.length&&obj.performanceResults){
    performanceCases=[{label:(obj.name||'LV')+' — imported',timestamp:new Date().toISOString(),result:obj.performanceResults,config:{modeLabel:obj.performanceResults.modeLabel||''}}];
  }
  activeCaseIndex=performanceCases.length>0?performanceCases.length-1:null;
  lastResult=activeCaseIndex!=null?performanceCases[activeCaseIndex].result:null;
  buildCaseList();
  const scBtn=document.getElementById('save-case-btn');if(scBtn)scBtn.disabled=!lastResult;
  // Show last case result or placeholder
  if(lastResult){renderResults(lastResult);}
  else{const panel=document.getElementById('results-panel');if(panel)panel.innerHTML=`<div class="placeholder-msg">// ${obj.name||'LV'} loaded — no performance cases yet. Calculate to add one.</div>`;}
  loadedVehicleName=obj.name||'';
  if(typeof libSeedTagHolder==='function') libSeedTagHolder(_lvTagHolder, obj.tags, [{dim:'era'},{dim:'origin'}], 'veh');
}
function openJSONModal(){const obj=collectVehicle();if(lastResult)obj.performanceResults=lastResult;document.getElementById('json-editor').value=JSON.stringify(obj,null,2);document.getElementById('json-error').style.display='none';openModal('modal-json');}
function applyJSON(){const txt=document.getElementById('json-editor').value;try{const obj=JSON.parse(txt);applyLVObject(obj);closeModal('modal-json');}catch(e){const err=document.getElementById('json-error');err.textContent='// JSON parse error: '+e.message;err.style.display='block';}}
