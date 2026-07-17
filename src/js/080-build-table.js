
// ─── BUILD TABLE ──────────────────────────────
function saveStoreFromDOM(){
  for(let s=0;s<MAX_STAGES;s++){
    if(!stageStore[s])stageStore[s]={};
    ROWS.forEach(row=>{const el=document.getElementById(`s${s+1}_${row.key}`);if(el)stageStore[s][row.key]=el.value;});
  }
}

function buildTable(){
  _suppressUD=true;
  const hr=document.getElementById('stage-header-row');
  hr.innerHTML='<th style="white-space:nowrap;">Parameter</th>';

  // ── Booster column before Stage 1 ──
  if(useBooster){
    const cnt=parseInt(document.getElementById('num-boosters')?.value)||0;
    const bth=document.createElement('th');
    bth.className='sh sh-booster';
    bth.textContent=`Strap-on ×${cnt}`;
    bth.title='Strap-on boosters — fire in parallel with Stage 1. Drop a stage here.';
    bth.style.cursor='copy';
    bth.addEventListener('dragover',e=>{e.preventDefault();bth.classList.add('sh-booster-hover');});
    bth.addEventListener('dragleave',()=>{bth.classList.remove('sh-booster-hover');});
    bth.addEventListener('drop',e=>{e.preventDefault();bth.classList.remove('sh-booster-hover');if(_draggingStage)applyBoosterData(_draggingStage);});
    hr.appendChild(bth);
  }

  // ── Stage columns ──
  for(let s=0;s<numStages;s++){
    const th=document.createElement('th');
    th.className='sh';
    th.textContent=`Stage ${s+1}`;
    th.style.cursor='copy';
    th.title='Drop a stage from the library here';
    const si=s;
    th.addEventListener('dragover', e=>onColDragOver(e,si));
    th.addEventListener('dragleave',e=>onColDragLeave(e,si));
    th.addEventListener('drop',     e=>onColDrop(e,si));
    hr.appendChild(th);
  }
  // ── Ghost columns (up to 4 total) ──
  const numGhost=Math.max(0,4-numStages);
  for(let g=0;g<numGhost;g++){
    const slotIdx=numStages+g;
    const gth=document.createElement('th');
    gth.className='sh sh-ghost';
    gth.textContent=`Stage ${slotIdx+1}`;
    gth.title='Drop a stage here to add it';
    gth.addEventListener('dragover',e=>{e.preventDefault();gth.classList.add('drop-hover');});
    gth.addEventListener('dragleave',()=>gth.classList.remove('drop-hover'));
    gth.addEventListener('drop',e=>{
      e.preventDefault();gth.classList.remove('drop-hover');
      if(!_draggingStage||_draggingStage._isVehicle)return;
      setStages(slotIdx+1);
      applyStageData(slotIdx,_draggingStage);
    });
    hr.appendChild(gth);
  }

  // ── Booster row values (read from DOM before rebuild wipes them) ──
  const bDefaults={dry:500,prop:5000,thrust:400,isp:265,res:2};
  const bVals={};
  ['dry','prop','thrust','isp','res'].forEach(k=>{
    const el=document.getElementById(`b_${k}`);
    bVals[k]=el?el.value:bDefaults[k];
  });

  const tbody=document.getElementById('stage-tbody');
  tbody.innerHTML='';
  ROWS.forEach(row=>{
    const tr=document.createElement('tr');
    // Isp now routes through the same expression parser as the mass/thrust
    // fields (UNIFICATION_AUDIT item — Isp inputs used to be a bare
    // type="number" field, so "311*0.98"-style expressions silently failed
    // where they work in mass fields). commitMathInput()/the global focusout
    // handler (590-init.js) already generically handle any `.math-input`
    // field, so this is the one place that needed to change for both the
    // stage row AND the booster row (both built from this same loop).
    const allowsMath=['dry','prop','thrust','res','isp'].includes(row.key);
    const inputAttrs=allowsMath?'type="text" inputmode="decimal" class="math-input" title="Calculations supported: +, -, *, /, and parentheses"':'type="number" min="0" step="any"';
    let html=`<td class="rl">${row.label}</td>`;
    // Booster cell (before Stage 1)
    if(useBooster){
      html+=`<td class="s-active booster-cell"><input ${inputAttrs} id="b_${row.key}" value="${bVals[row.key]??bDefaults[row.key]}" oninput="buildStageComposition();markLVUserDefined()"></td>`;
    }
    for(let s=0;s<numStages;s++){
      const id=`s${s+1}_${row.key}`;
      const val=(stageStore[s]&&stageStore[s][row.key]!==undefined)?stageStore[s][row.key]:row.def[s];
      html+=`<td class="s-active"><input ${inputAttrs} id="${id}" value="${val}"></td>`;
    }
    // Ghost cells
    for(let g=0;g<numGhost;g++){
      html+=`<td class="s-active ghost-cell"><input type="number" value="0" disabled tabindex="-1"></td>`;
    }
    tr.innerHTML=html;
    tbody.appendChild(tr);
  });
  const fj=document.getElementById('fairing-jettison');
  const prev=fj.value;
  fj.innerHTML='<option value="0">Never</option>';
  for(let s=1;s<=numStages;s++){const o=document.createElement('option');o.value=s;o.textContent=`Stage ${s}`;fj.appendChild(o);}
  fj.value=parseInt(prev)<=numStages?prev:Math.min(2,numStages);
  buildStageButtons();
  _suppressUD=false;
  buildStageComposition();
}

function buildStageButtons(){
  const sel=document.getElementById('stage-selector');
  sel.innerHTML='';
  const minus=document.createElement('button');
  minus.textContent='−';minus.style.cssText='font-size:15px;padding:4px 14px;letter-spacing:0;';
  minus.onclick=()=>{setStages(numStages-1);markLVUserDefined();};
  sel.appendChild(minus);
  const count=document.createElement('button');
  count.textContent=numStages;count.style.cssText='font-size:13px;padding:4px 16px;font-weight:600;pointer-events:none;color:var(--accent);';
  sel.appendChild(count);
  const plus=document.createElement('button');
  plus.textContent='+';plus.style.cssText='font-size:15px;padding:4px 14px;letter-spacing:0;';
  plus.onclick=()=>{setStages(numStages+1);markLVUserDefined();};
  sel.appendChild(plus);
  if(typeof vehicleMode!=='undefined'&&vehicleMode==='advanced')syncAdvControls();
}
