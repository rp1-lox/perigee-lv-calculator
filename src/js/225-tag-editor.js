
// ─── STRUCTURED TAG EDITOR ────────────────────
// Chip editor for the browse dimensions. Edits holder.tags[] in place, managing
// only the dimensions passed in and preserving freetext tags. Selecting nothing
// leaves the item untagged for that dimension.
//   holder : { tags: [...] }   (mutated in place)
//   dims   : [{dim:'era',multi:true}, {dim:'origin',multi:false}, ...]
//   mode   : 'veh' | 'stg'  (only affects the 'cls' vocab)
let _lvTagHolder = {tags:[]};    // working vehicle tags (era/origin) for Save LV + program
let _stgTagHolder = {tags:[]};   // working stage tags (era/origin/prop) for Make Stage

function libBuildTagEditor(container, holder, dims, mode){
  if(!container) return;
  if(!Array.isArray(holder.tags)) holder.tags=[];
  container.innerHTML='';
  dims.forEach(({dim,multi})=>{
    const vocab=libVocabFor(dim,mode);
    const grp=document.createElement('div'); grp.className='lib-filtergrp';
    const lbl=document.createElement('div'); lbl.className='lib-filtergrp-lbl';
    lbl.textContent=LIB_DIMLBL[dim]+(multi?'  (pick any)':'');
    grp.appendChild(lbl);
    const wrap=document.createElement('div'); wrap.className='lib-pchips';
    vocab.forEach(v=>{
      const active=holder.tags.includes(v);
      const chip=document.createElement('span'); chip.className='lib-pchip'+(active?' active':'');
      chip.textContent=(dim==='prop')?libPropShort(v):v;
      chip.title=v;
      chip.onclick=()=>{
        const has=holder.tags.includes(v);
        if(!multi){ holder.tags=holder.tags.filter(t=>!vocab.includes(t)); if(!has)holder.tags.push(v); }
        else { holder.tags = has ? holder.tags.filter(t=>t!==v) : holder.tags.concat(v); }
        libBuildTagEditor(container, holder, dims, mode);
      };
      wrap.appendChild(chip);
    });
    grp.appendChild(wrap); container.appendChild(grp);
  });
}

// Seed a holder's tags from an existing item's tags, keeping only values that
// belong to the given dims' vocab (so the editor shows the right chips active).
function libSeedTagHolder(holder, sourceTags, dims, mode){
  const allowed=new Set();
  dims.forEach(({dim})=>libVocabFor(dim,mode).forEach(v=>allowed.add(v)));
  holder.tags=(sourceTags||[]).flatMap(t=>t==='1990s-2000s'?['1990s','2000s']:[t]).filter(t=>allowed.has(t));
}

// Export / import the user's whole library (vehicles + stages) as one file.
function libExportMine(){
  const vehicles=(typeof userLVs!=='undefined'?userLVs:[]).map(v=>({...v}));
  const stages={};
  if(typeof userStagesByCategory!=='undefined')
    Object.entries(userStagesByCategory).forEach(([c,a])=>{ if(a&&a.length)stages[c]=a.map(s=>({...s})); });
  if(!vehicles.length && !Object.keys(stages).length){ showAlert('No saved vehicles or stages to export yet. Save some first.','Nothing to Export'); return; }
  downloadJSON({schema:'perigee-lib-v1', exported:new Date().toISOString(), vehicles, stages}, 'my-library.json');
}
// Shared object-import path (bundle already parsed) — used by libImportMine
// and by the consolidated Load/Import buttons that need to route a parsed
// file to the library-bundle path after sniffing its schema.
function libImportLibraryObject(o){
  if(!o||o.schema!=='perigee-lib-v1'){ showAlert('Not a Perigee library export (.json with schema "perigee-lib-v1").','Invalid File'); return; }
  let nv=0, ns=0;
  (o.vehicles||[]).forEach(v=>{ if(!userLVs.find(x=>x.name===v.name)){ v._sessionId=v._sessionId||Date.now(); userLVs.push(v); nv++; } });
  Object.entries(o.stages||{}).forEach(([c,arr])=>{ if(!userStagesByCategory[c])userStagesByCategory[c]=[];
    (arr||[]).forEach(s=>{ if(!userStagesByCategory[c].find(x=>x.name===s.name)){ s._userGenerated=true; userStagesByCategory[c].unshift(s); ns++; } }); });
  if(typeof libRender==='function')libRender();
  showAlert(`Imported ${nv} vehicle(s) and ${ns} stage(s).`,'Library Imported');
}
function libImportMine(input){
  const f=input.files[0]; if(!f)return;
  const r=new FileReader();
  r.onload=e=>{ try{
    const o=JSON.parse(e.target.result);
    libImportLibraryObject(o);
  }catch(err){ showAlert('Invalid library JSON: '+err.message,'Invalid File'); } };
  r.readAsText(f); input.value='';
}
