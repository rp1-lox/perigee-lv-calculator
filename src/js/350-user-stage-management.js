
// ─── USER STAGE MANAGEMENT ─────────────────────
function openAddStageModal(){
  ['stg-name','stg-note','stg-engines'].forEach(id=>document.getElementById(id).value='');
  ['stg-dry','stg-prop','stg-thrust','stg-isp'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('stg-res').value=2;
  document.getElementById('stg-is-booster').checked=false;
  document.getElementById('stg-new-cat-wrap').style.display='none';
  {
    const s15Sec=document.getElementById('stg-s15-section');
    if(s15Sec)s15Sec.style.display='';
    const s15El=document.getElementById('stg-s15'); if(s15El)s15El.checked=false;
    ['stg-s15-thrust','stg-s15-isp','stg-s15-jet','stg-s15-boost-isp'].forEach(id=>{const el=document.getElementById(id); if(el)el.value='';});
    const twrEl=document.getElementById('stg-s15-twr'); if(twrEl)twrEl.value=1.2;
    if(typeof toggleS15Fields==='function')toggleS15Fields(false);
  }
  // Populate category dropdown
  const sel=document.getElementById('stg-category');
  while(sel.options.length>5)sel.remove(4);
  Object.keys(userStagesByCategory).filter(k=>!Object.keys(STAGE_LIBRARY).includes(k)).forEach(k=>{
    const o=document.createElement('option');o.value=k;o.textContent=k+' (custom)';
    sel.insertBefore(o,sel.lastElementChild);
  });
  sel.value='Upper Stages';
  // Populate base stage picker
  const base=document.getElementById('stg-base');
  base.innerHTML='<option value="">— Blank —</option>';
  const allCats={...STAGE_LIBRARY};
  Object.entries(userStagesByCategory).forEach(([k,v])=>{
    if(!allCats[k])allCats[k]=[];
    allCats[k]=[...v,...(allCats[k]||[])];
  });
  Object.entries(allCats).forEach(([cat,stages])=>{
    if(!stages.length)return;
    const grp=document.createElement('optgroup');grp.label=cat;
    stages.forEach(s=>{
      const o=document.createElement('option');o.value=s.name;o.textContent=s.name;
      grp.appendChild(o);
    });
    base.appendChild(grp);
  });
  // Restore Add mode footer
  _editSlot=null;
  document.getElementById('add-stage-lib-btn').style.display='';
  document.getElementById('add-stage-save-btn').style.display='';
  document.getElementById('edit-stage-save-btn').style.display='none';
  document.querySelector('#modal-add-stage .modal-title').textContent='Add Stage to Library';
  _stgTagHolder.tags=[];
  if(typeof libBuildTagEditor==='function')
    libBuildTagEditor(document.getElementById('stg-tags-editor'), _stgTagHolder, [{dim:'era',multi:true},{dim:'origin',multi:false},{dim:'prop',multi:true}], 'stg');
  openModal('modal-add-stage');
  setTimeout(()=>document.getElementById('stg-name').focus(),100);
}

function onBaseStageChange(val){
  if(!val)return;
  // Find stage across all sources
  let found=null;
  for(const stages of Object.values(STAGE_LIBRARY)){
    found=stages.find(s=>s.name===val);if(found)break;
  }
  if(!found)for(const stages of Object.values(userStagesByCategory)){
    found=stages.find(s=>s.name===val);if(found)break;
  }
  if(!found)return;
  document.getElementById('stg-name').value=found.name+' (mod)';
  document.getElementById('stg-dry').value=found.dry||'';
  document.getElementById('stg-prop').value=found.prop||'';
  document.getElementById('stg-thrust').value=found.thrust||'';
  document.getElementById('stg-isp').value=found.isp||'';
  document.getElementById('stg-res').value=found.res??2;
  document.getElementById('stg-engines').value=found.engines||'';
  document.getElementById('stg-note').value=found.note||'';
  // split the base stage's tags into structured (era/origin/prop chips) + leftover freetext
  const _stgDims=[{dim:'era',multi:true},{dim:'origin',multi:false},{dim:'prop',multi:true}];
  if(typeof libSeedTagHolder==='function'){
    libSeedTagHolder(_stgTagHolder, found.tags, _stgDims, 'stg');
    const structured=new Set();
    _stgDims.forEach(({dim})=>libVocabFor(dim,'stg').forEach(v=>structured.add(v)));
    document.getElementById('stg-tags').value=(found.tags||[]).filter(t=>!structured.has(t)&&t!=='1990s-2000s').join(', ');
    libBuildTagEditor(document.getElementById('stg-tags-editor'), _stgTagHolder, _stgDims, 'stg');
  } else {
    document.getElementById('stg-tags').value=(found.tags||[]).join(', ');
  }
  document.getElementById('stg-is-booster').checked=!!found.isBooster;
  // Set category to match base stage
  const cat=found._category||(found.isBooster?'Side Boosters':'Upper Stages');
  const catSel=document.getElementById('stg-category');
  if([...catSel.options].some(o=>o.value===cat))catSel.value=cat;
  onStageCatChange(catSel.value);
  // S1.5 fields — mirror the base stage's stage-and-a-half config if present
  const s15Sec=document.getElementById('stg-s15-section');
  if(s15Sec&&!found.isBooster){
    const on=!!found.s15;
    const s15El=document.getElementById('stg-s15'); if(s15El)s15El.checked=on;
    const setV=(id,v)=>{const el=document.getElementById(id); if(el)el.value=v;};
    setV('stg-s15-thrust', found.s15_sust_thrust||'');
    setV('stg-s15-isp',    found.s15_sust_isp||'');
    setV('stg-s15-jet',    found.s15_jet_mass||'');
    setV('stg-s15-twr',    found.s15_beco_twr!=null?found.s15_beco_twr:1.2);
    setV('stg-s15-boost-isp', found.s15_boost_isp||'');
    if(typeof toggleS15Fields==='function')toggleS15Fields(on);
    if(typeof _s15UpdatePreview==='function')_s15UpdatePreview();
  }
}

function onStageCatChange(val){
  document.getElementById('stg-new-cat-wrap').style.display=val==='__new__'?'grid':'none';
}

function doAddStage(andSave){
  const name=document.getElementById('stg-name').value.trim();
  if(!name){showAlert('Please enter a stage name.','Validation');return;}
  let cat=document.getElementById('stg-category').value;
  if(cat==='__new__'){
    cat=document.getElementById('stg-new-cat').value.trim()||'Custom';
  }
  const stage={
    name,_userGenerated:true,
    dry:    parseFloat(document.getElementById('stg-dry').value)||0,
    prop:   parseFloat(document.getElementById('stg-prop').value)||0,
    thrust: parseFloat(document.getElementById('stg-thrust').value)||0,
    isp:    mathValue(document.getElementById('stg-isp').value,0)||1,
    res:    parseFloat(document.getElementById('stg-res').value)||2,
    engines:document.getElementById('stg-engines').value.trim()||'—',
    note:   document.getElementById('stg-note').value.trim(),
    tags:   [...new Set([...document.getElementById('stg-tags').value.split(',').map(t=>t.trim()).filter(Boolean), ...((typeof _stgTagHolder!=='undefined'&&_stgTagHolder.tags)||[])])],
    isBooster:document.getElementById('stg-is-booster').checked,
    _category:cat,
  };
  const s15On=document.getElementById('stg-s15')?.checked??false;
  if(s15On&&!stage.isBooster){
    stageCarryS15(stage,{
      s15:true,
      s15_sust_thrust:parseFloat(document.getElementById('stg-s15-thrust')?.value)||0,
      s15_sust_isp:   mathValue(document.getElementById('stg-s15-isp')?.value,0)   ||0,
      s15_jet_mass:   parseFloat(document.getElementById('stg-s15-jet')?.value)   ||0,
      s15_beco_twr:   parseFloat(document.getElementById('stg-s15-twr')?.value)   ||1.2,
      s15_boost_isp:  mathValue(document.getElementById('stg-s15-boost-isp')?.value,0)||0,
    });
  }
  if(!userStagesByCategory[cat])userStagesByCategory[cat]=[];
  userStagesByCategory[cat].unshift(stage); // prepend so new stages appear first
  if(andSave){
    downloadJSON(stage,(name.replace(/[^a-z0-9_-]/gi,'_').toLowerCase())+'.stage');
  }
  closeModal('modal-add-stage');
  buildStageLibrary();
  if(typeof autosaveScheduleSave==='function')autosaveScheduleSave();
}

// Consolidated stg-mode "Import" button. Routes by content:
//  - a library bundle (schema 'perigee-lib-v1') -> libImportMine's object path
//  - a single stage (.stage/.json export)        -> original apply-in-place path
function loadUserStageFile(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    let s;
    try{s=JSON.parse(e.target.result);}catch(err){showAlert('Invalid stage JSON: '+err.message,'Invalid File');input.value='';return;}
    if(s&&s.schema==='perigee-lib-v1'){
      if(typeof libImportLibraryObject==='function')libImportLibraryObject(s);
      input.value='';return;
    }
    if(!s.name||s.dry===undefined){showAlert('Invalid stage file: missing name or dry mass.','Invalid File');input.value='';return;}
    s._userGenerated=true; // mark as user content on import
    const cat=s._category||'Custom';
    if(!userStagesByCategory[cat])userStagesByCategory[cat]=[];
    userStagesByCategory[cat].unshift(s); // prepend so it appears first
    buildStageLibrary();
    input.value='';
  };
  reader.readAsText(file);
}
