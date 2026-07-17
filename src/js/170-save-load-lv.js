
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
  // If the worksheet was loaded from a user library entry, prefill name/note from it so
  // the Update button (see refreshLVUpdateButton) has something sensible to rename from.
  const _srcIdx=_lvUpdateSourceIdx();
  const _src=_srcIdx>=0?userLVs[_srcIdx]:null;
  document.getElementById('lv-save-name').value=_src?(_src.name||''):'';
  document.getElementById('lv-save-note').value=_src?(_src.note||''):'';
  if(typeof libBuildTagEditor==='function')
    libBuildTagEditor(document.getElementById('lv-save-tags'), _lvTagHolder, [{dim:'era',multi:true},{dim:'origin',multi:false}], 'veh');
  refreshLVSaveSummary();
  refreshLVUpdateButton();
  openModal('modal-save-lv');setTimeout(()=>document.getElementById('lv-save-name').focus(),100);
}
// Resolves the userLVs[] index the worksheet was loaded from (via loadPreset), or -1 if
// there is none / the entry was since deleted. Single lookup used by both the save-modal
// Update button and doUpdateLV so they never disagree.
function _lvUpdateSourceIdx(){
  if(_worksheetLoadedFromLvId==null)return -1;
  return userLVs.findIndex(lv=>lv._sessionId===_worksheetLoadedFromLvId);
}
// Show/hide + label the "Update ..." button in the Save LV modal based on provenance.
// When provenance exists, Update is the PRIMARY (accent) action and Save becomes the
// secondary "Save as new" — editing an existing saved vehicle should never force the
// user through save-as-new (see 2026-07-16 library-management rework).
function refreshLVUpdateButton(){
  const btn=document.getElementById('lv-update-btn');
  const saveBtn=document.getElementById('lv-save-btn');
  if(!btn)return;
  const idx=_lvUpdateSourceIdx();
  if(idx>=0){
    btn.style.display='';
    btn.textContent='Update "'+(userLVs[idx].name||'Unnamed LV')+'"';
    btn.classList.add('primary');
    if(saveBtn){saveBtn.classList.remove('primary');saveBtn.textContent='Save as New';}
  } else {
    btn.style.display='none';
    btn.classList.remove('primary');
    if(saveBtn){saveBtn.classList.add('primary');saveBtn.textContent='Save to Library';}
  }
}
// Small "editing: <name> ✕" chip shown above Stage Composition whenever the worksheet
// carries overwrite provenance (loaded from a user library vehicle). The ✕ detaches
// provenance without touching the worksheet's current values — next save then defaults
// to save-as-new. Call after anything that sets/clears _worksheetLoadedFromLvId.
function lvEditingIndicatorRefresh(){
  const wrap=document.getElementById('lv-editing-indicator');
  const txt=document.getElementById('lv-editing-indicator-text');
  if(!wrap||!txt)return;
  const idx=_lvUpdateSourceIdx();
  if(idx>=0){
    wrap.style.display='inline-flex';
    txt.textContent='editing: '+(userLVs[idx].name||'Unnamed LV');
  } else {
    wrap.style.display='none';
  }
}
function lvDetachEditing(){
  _worksheetLoadedFromLvId=null;
  lvEditingIndicatorRefresh();
}
// Replaces userLVs[idx] in place with a freshly-collected worksheet snapshot, preserving
// the entry's _sessionId (identity) so anything keyed off it stays valid. Reused by both
// the modal Update button and the per-card library overwrite action — same collect path
// (buildLVObject) as save-as-new, just no push.
function _replaceUserLVAt(idx,name,note){
  const keepId=userLVs[idx]._sessionId;
  const obj=buildLVObject(name,note);
  obj._sessionId=keepId;
  userLVs[idx]=obj;
  buildPresets();
  if(typeof autosaveScheduleSave==='function')autosaveScheduleSave();
  return obj;
}
// "Update '<name>'" button handler in the Save LV modal.
function doUpdateLV(){
  const idx=_lvUpdateSourceIdx();
  if(idx<0){
    showAlert('The vehicle this was loaded from is no longer in your library (it may have been deleted). Use "Save to Library" to save it as new.','Cannot Update');
    return;
  }
  const oldName=userLVs[idx].name||'Unnamed LV';
  const name=document.getElementById('lv-save-name').value.trim()||'LV';
  const note=document.getElementById('lv-save-note').value.trim();
  const renaming=name!==oldName;
  showConfirm('Update Saved Vehicle',
    'Overwrite "'+oldName+'" with the current worksheet configuration?'+(renaming?' It will be renamed to "'+name+'".':''),
    ()=>{
      const obj=_replaceUserLVAt(idx,name,note);
      activePresetKey='user_'+idx;
      closeModal('modal-save-lv');
      showAlert('Updated "'+obj.name+'" in your library.','Vehicle Updated');
    },'Update');
}
// Per-card "⟲ overwrite with worksheet" action in the library browser (221). Targets the
// card's own entry directly — covers the case where load provenance was lost but the user
// knows which saved vehicle they want to replace. Builtins are never overwritable.
function libOverwriteVehicleCard(key){
  if(!key||key.indexOf('user_')!==0)return; // builtin/other keys refused
  const idx=parseInt(key.slice(5),10);
  const entry=userLVs[idx];
  if(!entry)return;
  showConfirm('Overwrite Saved Vehicle',
    'Overwrite "'+(entry.name||'Unnamed LV')+'" with the current worksheet configuration? This replaces its saved stages and settings.',
    ()=>{
      const obj=_replaceUserLVAt(idx,entry.name,entry.note||'');
      showAlert('Overwrote "'+obj.name+'" with the current worksheet.','Vehicle Updated');
    },'Overwrite');
}
// Per-card "✕ delete" action in the library browser (221). Builtins are never deletable
// (key guard here + no button rendered for them at all). Deleting does NOT touch any
// mission fleet snapshot already taken from this vehicle — _fleetVehicleSpecFromLib (560)
// deep-copies stage/booster/site data into the fleet entry at snapshot time, so existing
// missions/fleet entries have no live reference back into userLVs[] and replay unaffected.
function libDeleteVehicleCard(key){
  if(!key||key.indexOf('user_')!==0)return; // builtin/other keys refused
  const idx=parseInt(key.slice(5),10);
  const entry=userLVs[idx];
  if(!entry)return;
  showConfirm('Delete Saved Vehicle',
    'Delete "'+(entry.name||'Unnamed LV')+'" from your library? This cannot be undone. Missions already built from it are unaffected (they hold their own copy).',
    ()=>{
      const wasEditing=_lvUpdateSourceIdx()===idx;
      userLVs.splice(idx,1);
      if(activePresetKey===key)activePresetKey=null;
      if(wasEditing)_worksheetLoadedFromLvId=null;
      buildPresets();
      lvEditingIndicatorRefresh();
      if(typeof autosaveScheduleSave==='function')autosaveScheduleSave();
    },'Delete');
}
// "Saving: N stages · boosters: M×/none · launch site: <name> (<lat>°)" — refreshed each open.
function refreshLVSaveSummary(){
  const el=document.getElementById('lv-save-summary');
  if(!el)return;
  // Alias onto the canonical escaper (escHtml, 015-version.js — UNIFICATION_AUDIT item 5).
  // The old local `esc` here did NOT escape double-quotes (attribute-context unsafe).
  const esc=s=>escHtml(s);
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
  // Newly-saved vehicle becomes the worksheet's overwrite target, same as if it had been
  // loaded from the library — so an immediate next edit defaults to Update, not save-as-new.
  _worksheetLoadedFromLvId=obj._sessionId;
  activePresetKey='user_'+(userLVs.length-1);
  lvEditingIndicatorRefresh();
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
  // Loading a raw file/JSON object isn't "loaded from the library" -- no overwrite target.
  _worksheetLoadedFromLvId=null;
  currentStageNames=new Array(15).fill(null);
  currentBoosterName=null;
  stageSaved=new Array(15).fill(false);
  boosterSaved=false;
  if(obj.stageNames)obj.stageNames.forEach((n,i)=>currentStageNames[i]=n);
  if(obj.boosterName)currentBoosterName=obj.boosterName;
  // ── Vehicle config ──
  if(obj.stageData)obj.stageData.forEach((sd,si)=>{
    const entry={dry:String(sd.dry),prop:String(sd.prop),thrust:String(sd.thrust),isp:String(sd.isp),res:String(sd.res??2)};
    stageCarryS15(entry,sd);
    stageStore[si]=entry;
  });
  // Resolve stage names if present (new format)
  if(obj.stageNames){
    const resolved=resolvePresetStages(obj);
    resolved.forEach((sd,si)=>{
      const entry={dry:String(sd.dry),prop:String(sd.prop),thrust:String(sd.thrust),isp:String(sd.isp),res:String(sd.res??2)};
      // Carry over s15 fields from the original stageData if present
      const orig=(obj.stageData||[])[si]||{};
      stageCarryS15(entry,orig);
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
  if(typeof lvEditingIndicatorRefresh==='function') lvEditingIndicatorRefresh();
}
function openJSONModal(){const obj=collectVehicle();if(lastResult)obj.performanceResults=lastResult;document.getElementById('json-editor').value=JSON.stringify(obj,null,2);document.getElementById('json-error').style.display='none';openModal('modal-json');}
function applyJSON(){const txt=document.getElementById('json-editor').value;try{const obj=JSON.parse(txt);applyLVObject(obj);closeModal('modal-json');}catch(e){const err=document.getElementById('json-error');err.textContent='// JSON parse error: '+e.message;err.style.display='block';}}
