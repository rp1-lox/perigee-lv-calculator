
// ─── VEHICLES PANEL ───────────────────────────
// Vehicle filter state
let vehicleFilters={};
let vehicleFilterOpen=false;
const VEHICLE_FILTER_TREE={
  'Propellant':['Liquid Oxygen / Liquid Hydrogen','Liquid Oxygen / Kerosene','Liquid Oxygen / Methane','Liquid Oxygen / Ethanol','Nitrogen Tetroxide / Aerozine-50','Nitrogen Tetroxide / UDMH','Inhibited Red Fuming Nitric Acid / UDMH','Liquid Fluorine / Hydrazine','Solid Propellant'],
  'Payload Class':['Nano (<50 kg)','Small (<1 t)','Medium (1–10 t)','Heavy (10–50 t)','Super Heavy (>50 t)'],
  'Era':['1940s','1950s','1960s','1970s','1980s','1990s-2000s','2010s+'],
  'Origin':['American','Soviet / Russian','European'],
  'Mission':['Crewed','Deep Space','Historical','Active','Unbuilt','Exotic'],
};

function vehicleMatchesFilters(tags){
  return Object.entries(vehicleFilters).every(([cat,sel])=>{
    if(!sel.size)return true;
    return[...sel].some(t=>tags.includes(t));
  });
}

function buildVehicleFilterPanel(){
  const panel=document.getElementById('vehicle-filter-panel');
  if(!panel)return;
  panel.innerHTML='';
  Object.entries(VEHICLE_FILTER_TREE).forEach(([cat,opts])=>{
    const div=document.createElement('div');div.className='filter-cat';
    const hdr=document.createElement('div');hdr.className='filter-cat-hdr';
    const chev=document.createElement('span');chev.className='filter-cat-chevron open';chev.textContent='▶';
    hdr.appendChild(chev);
    const lbl=document.createElement('span');lbl.className='filter-cat-label';lbl.textContent=cat;hdr.appendChild(lbl);
    const active=vehicleFilters[cat]?.size||0;
    if(active){const b=document.createElement('span');b.style.cssText='font-family:var(--mono);font-size:8px;color:var(--accent);border:1px solid var(--accent);padding:1px 4px;margin-left:4px;';b.textContent=active;hdr.appendChild(b);}
    let collapsed=false;
    hdr.onclick=()=>{collapsed=!collapsed;row.style.display=collapsed?'none':'';chev.classList.toggle('open',!collapsed);};
    div.appendChild(hdr);
    const row=document.createElement('div');row.className='filter-opts';
    opts.forEach(opt=>{
      const active=vehicleFilters[cat]?.has(opt);
      const btn=document.createElement('div');btn.className='filter-opt'+(active?' active':'');
      btn.textContent=opt;
      btn.onclick=()=>{
        if(!vehicleFilters[cat])vehicleFilters[cat]=new Set();
        vehicleFilters[cat].has(opt)?vehicleFilters[cat].delete(opt):vehicleFilters[cat].add(opt);
        if(!vehicleFilters[cat].size)delete vehicleFilters[cat];
        buildVehicleFilterPanel();updateVehicleFilterChips();buildPresets();
      };
      row.appendChild(btn);
    });
    div.appendChild(row);panel.appendChild(div);
  });
}

function updateVehicleFilterChips(){
  const chips=document.getElementById('vehicle-filter-chips');
  if(!chips)return;
  chips.innerHTML='';
  let any=false;
  Object.entries(vehicleFilters).forEach(([cat,tags])=>{
    tags.forEach(tag=>{
      any=true;
      const chip=document.createElement('div');chip.className='filter-chip';
      const chx2=document.createElement('span');chx2.className='filter-chip-x';chx2.textContent='×';const cc2=cat,tt2=tag;chx2.onclick=()=>removeVehicleFilter(cc2,tt2);chip.innerHTML=`<span>${tag}</span>`;chip.appendChild(chx2);
      chips.appendChild(chip);
    });
  });
  const clr=document.getElementById('vehicle-clear-filters');
  if(clr)clr.style.display=any?'':'none';
  const ftb=document.getElementById('vehicle-filter-btn');
  if(ftb)ftb.classList.toggle('active',any||vehicleFilterOpen);
}

function removeVehicleFilter(cat,tag){
  if(vehicleFilters[cat]){vehicleFilters[cat].delete(tag);if(!vehicleFilters[cat].size)delete vehicleFilters[cat];}
  buildVehicleFilterPanel();updateVehicleFilterChips();buildPresets();
}

function toggleVehicleFilters(){
  vehicleFilterOpen=!vehicleFilterOpen;
  const p=document.getElementById('vehicle-filter-panel');
  if(p)p.style.display=vehicleFilterOpen?'block':'none';
  if(vehicleFilterOpen)buildVehicleFilterPanel();
  const ftb=document.getElementById('vehicle-filter-btn');
  if(ftb)ftb.classList.toggle('active',vehicleFilterOpen||Object.keys(vehicleFilters).length>0);
}

function buildPresets(){
  const grid=document.getElementById('preset-grid');
  const q=(document.getElementById('lv-search')?.value||'').toLowerCase();
  grid.innerHTML='';

  const addItem=(p,key,isUser,isDefined,onDel)=>{
    const tags=isUser?(p.tags||[]):computeVehicleTags(p);
    if(!vehicleMatchesFilters(tags))return;
    const label=p.name||'Unnamed LV';
    const subtext=isUser?'':(p.stageNames||[]).join(' + ');
    const searchStr=(label+' '+subtext+' '+(p.note||'')+' '+tags.join(' ')).toLowerCase();
    if(q&&!searchStr.includes(q))return;
    const item=document.createElement('div');item.className='lv-item';
    const btn=document.createElement('button');
    btn.className='lv-item-btn'+(activePresetKey===key?' active':'')+(isUser?' user-lv':'')+(isDefined?' user-defined':'');
    btn.onclick=isUser?()=>loadPreset(p,key):()=>loadPreset(p,key);
    // Name + stage summary
    const nameEl=document.createElement('div');nameEl.style.cssText='font-size:11px;';nameEl.textContent=label;
    btn.appendChild(nameEl);
    if(subtext){
      const sub=document.createElement('div');
      sub.style.cssText='font-size:8px;color:var(--text-dim);margin-top:2px;white-space:normal;line-height:1.4;';
      sub.textContent=subtext;btn.appendChild(sub);
    }
    item.appendChild(btn);
    if(onDel){const x=document.createElement('button');x.className='lv-del';x.textContent='×';x.title='Remove from list';x.onclick=onDel;item.appendChild(x);}
    grid.appendChild(item);
  };

  BUILTIN_PRESETS.forEach((p,i)=>addItem(p,'builtin_'+i,false,false,null));
  userLVs.forEach((lv,i)=>addItem(lv,'user_'+i,true,false,()=>{userLVs.splice(i,1);if(activePresetKey==='user_'+i)activePresetKey=null;buildPresets();}));
  if(userDefinedLV)addItem({name:'[ User-Defined LV ]',tags:[]},'user_defined',false,true,null);
}

function loadPreset(p,key){
  activePresetKey=key||null;userDefinedLV=false;
  // Track "overwrite" provenance: only user library entries (key = 'user_'+i) are
  // overwrite-eligible; loading a builtin/preset clears it.
  _worksheetLoadedFromLvId=(key&&key.indexOf('user_')===0&&p&&p._sessionId!=null)?p._sessionId:null;
  // Set stage name tracking BEFORE resolving
  currentStageNames=new Array(15).fill(null);
  currentBoosterName=null;
  stageSaved=new Array(15).fill(false);
  boosterSaved=false;
  if(p.stageNames)p.stageNames.forEach((n,i)=>currentStageNames[i]=n);
  if(p.boosterName)currentBoosterName=p.boosterName;
  // Resolve stage names to data
  const stageData=resolvePresetStages(p);
  const boosterData=resolvePresetBooster(p);
  const numStgs=stageData.length;
  stageData.forEach((sd,si)=>{
    const entry={dry:String(sd.dry),prop:String(sd.prop),thrust:String(sd.thrust),isp:String(sd.isp),res:String(sd.res??2)};
    const orig=(p.stageData||[])[si]||{};
    if(orig.s15){entry.s15=true;entry.s15_sust_thrust=orig.s15_sust_thrust||0;entry.s15_sust_isp=orig.s15_sust_isp||0;entry.s15_jet_mass=orig.s15_jet_mass||0;entry.s15_beco_twr=orig.s15_beco_twr||1.2;}
    stageStore[si]=entry;
  });
  _suppressUD=true;setStages(numStgs);
  const hasBoosters=!!boosterData;
  setBoosters(hasBoosters);
  if(hasBoosters){
    const bd=boosterData;
    ['dry','prop','thrust','isp','res'].forEach(k=>{const el=document.getElementById(`b_${k}`);if(el)el.value=bd[k]??0;});
    document.getElementById('num-boosters').value=bd.count||0;
    if(typeof applyBoosterModeUI==='function')applyBoosterModeUI(bd);
  }
  _extraBoosterGroups = Array.isArray(p.boosterGroups) ? p.boosterGroups.slice(1).map(g=>({...g})) : [];
  if(typeof renderExtraBoosterGroups==='function') renderExtraBoosterGroups();
  if(typeof buildStageComposition==='function') buildStageComposition();
  if(p.payload!==undefined)document.getElementById('payload-mass').value=p.payload;
  if(p.fairingMass!==undefined)document.getElementById('fairing-mass').value=p.fairingMass;
  if(p.site){document.getElementById('site-lat').value=p.site.lat??28.5;document.getElementById('az-min').value=p.site.azMin??37;document.getElementById('az-max').value=p.site.azMax??112;matchSiteFromFields();}
  setDestMode(p.mode||'orbit');
  if(p.mode==='escape'&&p.escape){document.getElementById('c3').value=p.escape.c3;document.getElementById('decl').value=p.escape.decl;document.getElementById('escape-perigee').value=p.escape.perigee;}
  else if(p.orbit){document.getElementById('apogee').value=p.orbit.apogee;document.getElementById('perigee').value=p.orbit.perigee;document.getElementById('inclination').value=p.orbit.inc;}
  if(p.parkingAlt!==undefined)document.getElementById('parking-alt').value=p.parkingAlt;
  if(p.trajectory)setTraj(p.trajectory);
  setTimeout(()=>{const fj=document.getElementById('fairing-jettison');if(fj)fj.value=Math.min(p.fairingJettison??0,p.stages??1);},20);
  lastResult=p.performanceResults||null;
  const _spb=document.getElementById('save-case-btn');if(_spb)_spb.disabled=!lastResult;
    const scBtn=document.getElementById('save-case-btn');if(scBtn)scBtn.disabled=!lastResult;
  document.getElementById('results-panel').innerHTML=`<div class="placeholder-msg">// ${p.name||'LV'} loaded — click Performance to calculate</div>${p.note?`<div class="note" style="margin:12px 0 0">${p.note}</div>`:''}`;
  if(typeof libSeedTagHolder==='function') libSeedTagHolder(_lvTagHolder, p.tags, [{dim:'era'},{dim:'origin'}], 'veh');
  buildPresets();
  buildStageComposition();
}
