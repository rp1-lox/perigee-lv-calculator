
// ─── BEGINNER / ADVANCED MODE ─────────────────
let vehicleMode='beginner';


function syncAdvControls(){
  // Mirror primary controls to advanced duplicates
  const advSel=document.getElementById('stage-selector-adv');
  if(advSel){advSel.innerHTML='';
    const minus=document.createElement('button');minus.textContent='−';minus.style.cssText='font-size:15px;padding:4px 14px;letter-spacing:0;';
    minus.onclick=()=>{setStages(numStages-1);markLVUserDefined();};advSel.appendChild(minus);
    const count=document.createElement('button');count.textContent=numStages;count.style.cssText='font-size:13px;padding:4px 16px;font-weight:600;pointer-events:none;color:var(--accent);';
    advSel.appendChild(count);
    const plus=document.createElement('button');plus.textContent='+';plus.style.cssText='font-size:15px;padding:4px 14px;letter-spacing:0;';
    plus.onclick=()=>{setStages(numStages+1);markLVUserDefined();};advSel.appendChild(plus);
  }
  // Booster toggle
  document.querySelectorAll('#booster-toggle-adv button').forEach((b,i)=>b.classList.toggle('active',i===(useBooster?0:1)));
  const bcw=document.getElementById('booster-count-wrap-adv');
  if(bcw)bcw.style.display=useBooster?'flex':'none';
  const nb=document.getElementById('num-boosters-adv');
  if(nb)nb.value=document.getElementById('num-boosters')?.value||4;
  // Restartable toggle
  document.querySelectorAll('#restart-toggle-adv button').forEach((b,i)=>{
    const isRestart=document.querySelector('#restart-toggle button.active')?.textContent==='Yes';
    b.classList.toggle('active',i===(isRestart?0:1));
  });
  // Fairing jettison — sync options
  const fj=document.getElementById('fairing-jettison');
  const fja=document.getElementById('fairing-jettison-adv');
  if(fj&&fja){fja.innerHTML=fj.innerHTML;fja.value=fj.value;}
  // Fairing mass
  const fm=document.getElementById('fairing-mass');
  const fma=document.getElementById('fairing-mass-adv');
  if(fm&&fma)fma.value=fm.value;
}

// Advanced mode: load stage → prompt slot
let _advStageObj=null;
function advLoadStage(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      _advStageObj=JSON.parse(e.target.result);
      openAdvSlotModal();
    }catch(err){showAlert('Invalid stage JSON.','Invalid File');}
  };
  reader.readAsText(file);input.value='';
}
function openAdvSlotModal(){
  const sel=document.getElementById('adv-slot-select');
  sel.innerHTML='';
  if(useBooster){
    const o=document.createElement('option');o.value='booster';o.textContent='Strap-on Booster';
    sel.appendChild(o);
  }
  for(let s=0;s<numStages;s++){
    const o=document.createElement('option');o.value=s;
    o.textContent='Stage '+(s+1)+(currentStageNames[s]?' — '+currentStageNames[s]:'');
    sel.appendChild(o);
  }
  openModal('modal-adv-slot');
}
function openAdvSaveSlotModal(){
  const sel=document.getElementById('adv-save-slot-select');
  sel.innerHTML='';
  if(useBooster){const o=document.createElement('option');o.value='booster';o.textContent='Strap-on Booster';sel.appendChild(o);}
  for(let s=0;s<numStages;s++){const o=document.createElement('option');o.value=s;o.textContent='Stage '+(s+1)+(currentStageNames[s]?' — '+currentStageNames[s]:'');sel.appendChild(o);}
  openModal('modal-adv-save-slot');
}
function doAdvSaveSlot(){const val=document.getElementById('adv-save-slot-select').value;saveStageCardAsFile(val==='booster'?null:parseInt(val),val==='booster');closeModal('modal-adv-save-slot');}
function doAdvSlotLoad(){
  if(!_advStageObj)return;
  const val=document.getElementById('adv-slot-select').value;
  if(val==='booster'){applyBoosterData(_advStageObj);}
  else{applyStageData(parseInt(val),_advStageObj);}
  _advStageObj=null;
  closeModal('modal-adv-slot');
  buildTable();
}
