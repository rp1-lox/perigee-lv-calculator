
// ─── STAGE CARD SAVE ──────────────────────────
function saveStageCardAsFile(stageIdx,isBooster){
  let stage;
  if(isBooster){
    stage={
      name:currentBoosterName||'Strap-on Booster',
      dry:parseFloat(document.getElementById('b_dry')?.value)||0,
      prop:parseFloat(document.getElementById('b_prop')?.value)||0,
      thrust:parseFloat(document.getElementById('b_thrust')?.value)||0,
      isp:parseFloat(document.getElementById('b_isp')?.value)||0,
      res:parseFloat(document.getElementById('b_res')?.value)||2,
      isBooster:true,_userGenerated:true,
    };
    boosterSaved=true;
  } else {
    const store=stageStore[stageIdx]||{};
    stage={
      name:currentStageNames[stageIdx]||`Stage ${stageIdx+1}`,
      dry:mathValue(store.dry,0),
      prop:mathValue(store.prop,0),
      thrust:mathValue(store.thrust,0),
      isp:parseFloat(store.isp)||0,
      res:mathValue(store.res,2),
      _userGenerated:true,
    };
    if(store.s15){
      stage.s15=true;
      stage.s15_sust_thrust=store.s15_sust_thrust||0;
      stage.s15_sust_isp   =store.s15_sust_isp   ||0;
      stage.s15_jet_mass   =store.s15_jet_mass   ||0;
      stage.s15_beco_twr   =store.s15_beco_twr   ||1.2;
      stage.s15_boost_isp  =store.s15_boost_isp  ||0;
    }
    stageSaved[stageIdx]=true;
  }
  const fname=stage.name.replace(/[^a-z0-9_-]/gi,'_').toLowerCase()+'.stage';
  downloadJSON(stage,fname);
  buildStageComposition();
}
