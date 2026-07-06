
// ─── STAGE RESOLVER ───────────────────────────
function findStageByName(name){
  for(const stages of Object.values(STAGE_LIBRARY)){
    const s=stages.find(s=>s.name===name);
    if(s)return s;
  }
  for(const stages of Object.values(userStagesByCategory)){
    const s=stages.find(s=>s.name===name);
    if(s)return s;
  }
  return null;
}

function resolvePresetStages(p){
  // Convert stageNames array to stageData array by looking up library
  if(p.stageData)return p.stageData; // already resolved (user LV)
  return (p.stageNames||[]).map(name=>{
    const s=findStageByName(name);
    if(!s)return {dry:0,prop:0,thrust:0,isp:300,res:2,_missing:name};
    const entry={dry:s.dry,prop:s.prop,thrust:s.thrust,isp:s.isp,res:s.res??2};
    if(s.s15){entry.s15=true;entry.s15_sust_thrust=s.s15_sust_thrust||0;entry.s15_sust_isp=s.s15_sust_isp||0;entry.s15_jet_mass=s.s15_jet_mass||0;entry.s15_beco_twr=s.s15_beco_twr||1.2;entry.s15_boost_isp=s.s15_boost_isp||0;}
    return entry;
  });
}

function resolvePresetBooster(p){
  if(p.boosterData)return p.boosterData;
  if(!p.boosterName)return null;
  const s=findStageByName(p.boosterName);
  if(!s)return null;
  const b={dry:s.dry,prop:s.prop,thrust:s.thrust,isp:s.isp,res:s.res??2,count:p.boosterCount||1};
  // carry parallel-staging mode (crossfeed / center-throttle) from the preset
  if(p.parallelMode)b.parallelMode=p.parallelMode;
  if(p.coreThrottle!=null)b.coreThrottle=p.coreThrottle;
  return b;
}

// Compute tags for a vehicle from its stages + vehicle-specific tags
function computeVehicleTags(p){
  const stageTags=new Set();
  (p.stageNames||[]).forEach(name=>{
    const s=findStageByName(name);
    if(s)(s.tags||[]).forEach(t=>stageTags.add(t));
  });
  if(p.boosterName){
    const s=findStageByName(p.boosterName);
    if(s)(s.tags||[]).forEach(t=>stageTags.add(t));
  }
  // Add payload class tag
  const pay=p.payload||0;
  if(pay<50)stageTags.add('Nano (<50 kg)');
  else if(pay<1000)stageTags.add('Small (<1 t)');
  else if(pay<10000)stageTags.add('Medium (1–10 t)');
  else if(pay<50000)stageTags.add('Heavy (10–50 t)');
  else stageTags.add('Super Heavy (>50 t)');
  // Merge with vehicle's own tags
  (p.tags||[]).forEach(t=>stageTags.add(t));
  return [...stageTags];
}
