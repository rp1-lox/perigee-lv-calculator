
// ─── INIT ────────────────────────────────────────
buildTable();
buildPresets();
buildOrbitCategories();
buildSiteSelector();
buildStageLibrary();
buildCaseList();
updateFilterChips();
loadPersistedUserSpaceports();
initSiteMap();
initOrbitDiagram();
rebuildThemeSelect();   // populate the header select from BUILTIN_THEMES (static HTML lists only two)
applyTheme('perigee');
_initVersionUI();
scEdInit();
fleetInit();
missionInit();
// Initialise default active program with demo pads
(function(){
  const p = progMakeProgram('New Program');
  p.pads = [
    progMakePad('LC-39A',     '39A', 'KSC',  72),
    progMakePad('LC-39B',     '39B', 'KSC',  72),
    progMakePad('Baikonur 1', 'BK1', 'BK',   48),
    progMakePad('Vandenberg', 'SLC', 'VAFB', 48),
  ];
  PROG_ACTIVE_PROGRAM = p;
})();

// Delegated listeners for user-defined tracking
let _stageCompDebounce=null;
document.getElementById('stage-tbody').addEventListener('input',e=>{
  if(_suppressUD)return;
  // Clear the library name for the column being manually edited
  const td=e.target.closest('td');
  const tr=e.target.closest('tr');
  if(td&&tr){
    const colIdx=[...tr.cells].indexOf(td)-1; // -1 for label column
    if(colIdx>=0&&colIdx<15){currentStageNames[colIdx]=null;stageSaved[colIdx]=false;}
    clearTimeout(_stageCompDebounce);
    _stageCompDebounce=setTimeout(buildStageComposition,200);
  }
  markLVUserDefined();
});
document.addEventListener('focusout',e=>{if(e.target.matches?.('.math-input'))commitMathInput(e.target);});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches?.('.math-input'))e.target.blur();});
['fairing-mass','fairing-jettison','b_dry','b_prop','b_thrust','b_isp','b_res','num-boosters'].forEach(id=>{
  const el=document.getElementById(id);
  if(el)el.addEventListener('change',()=>markLVUserDefined());
});
