
// ─── STAGE COMPOSITION VIEW ───────────────────
let currentStageNames=new Array(15).fill(null); // library name for each stage slot
let stageSaved=new Array(15).fill(false);
let boosterSaved=false;

// ── Vehicle performance panel (per-stage ΔV tracker + spec table) ──
const VP_COLORS = ['#ff8844','#5599ff','#88cc55','#cc77ff','#55ccff','#ffcc33','#ff5577'];

function updatePerfPanel() {
  const tblBody   = document.getElementById('vp-table-body');
  if (!tblBody) return;

  // ── Collect stage data ────────────────────────────────────────
  const pF = v => mathValue(v,0);
  const segments = []; // {label, shortLabel, dry, prop, thrust, isp, res, color, isBooster}

  if (useBooster) {
    const bCount = parseInt(document.getElementById('num-boosters')?.value) || 0;
    segments.push({
      label:      (currentBoosterName || 'Strap-on') + (bCount > 1 ? ` ×${bCount}` : ''),
      shortLabel: currentBoosterName ? currentBoosterName.slice(0,10) : 'Booster',
      dry:    pF(document.getElementById('b_dry')?.value),
      prop:   pF(document.getElementById('b_prop')?.value),
      thrust: pF(document.getElementById('b_thrust')?.value) * bCount,
      isp:    pF(document.getElementById('b_isp')?.value) || 1,
      res:    pF(document.getElementById('b_res')?.value),
      count:  bCount,
      color:  VP_COLORS[0],
      isBooster: true,
    });
  }

  for (let s = 0; s < numStages; s++) {
    const st = stageStore[s] || {};
    const colorIdx = useBooster ? (s + 1) : s;
    segments.push({
      label:      currentStageNames[s] || `Stage ${s+1}`,
      shortLabel: currentStageNames[s] ? currentStageNames[s].slice(0,10) : `S${s+1}`,
      dry:    pF(st.dry),
      prop:   pF(st.prop),
      thrust: pF(st.thrust),
      isp:    pF(st.isp) || 1,
      res:    pF(st.res),
      count:  1,
      color:  VP_COLORS[colorIdx % VP_COLORS.length],
      isBooster: false,
    });
  }

  // Helpers
  const fmt  = v => Math.round(v).toLocaleString();
  const fmtF = (v, dec=1) => v >= 1000 ? (v/1000).toFixed(dec) + ' MN' : v.toFixed(dec) + ' kN';
  const fmtM = v => v >= 1e6 ? (v/1e6).toFixed(2) + ' Mt' : v >= 1000 ? (v/1000).toFixed(1) + ' t' : Math.round(v) + ' kg';

  // ── Per-segment calculations ──────────────────────────────────
  let totalDV = 0, liftoffMass = 0, totalThrust = 0, totalDry = 0, totalProp = 0;

  const calcs = segments.map(seg => {
    const propUsable = seg.prop * (1 - seg.res / 100);
    const m0 = seg.dry + propUsable;
    const mf = seg.dry;
    const dv = (m0 > mf && mf > 0) ? G0 * seg.isp * Math.log(m0 / mf) : 0;
    const massFlow = (seg.thrust * 1000) / (G0 * seg.isp);
    const burnTime = massFlow > 0 ? propUsable / massFlow : 0;
    const propFrac = (seg.dry + seg.prop) > 0 ? seg.prop / (seg.dry + seg.prop) * 100 : 0;
    const massRatio = mf > 0 ? m0 / mf : 0;

    // For vehicle-level totals, multiply boosters by count
    const effectiveDry   = seg.dry   * seg.count;
    const effectiveProp  = seg.prop  * seg.count;
    totalDry    += effectiveDry;
    totalProp   += effectiveProp;
    liftoffMass += effectiveDry + effectiveProp;
    totalThrust += seg.thrust; // already has ×count baked in for boosters
    totalDV     += dv;

    return { ...seg, dv, burnTime, propFrac, massRatio };
  });

  const hasAnyDV = totalDV > 0;

  // ── Spec Table (last column = whole-vehicle summary) ─────────
  // (The former standalone "ΔV Budget" panel was folded in here — the ΔV (isol.)
  // row carries a proportional background bar per stage, replacing the old bars.)
  if (calcs.length === 0) {
    tblBody.innerHTML = '<div class="vp-dv-empty">// No stages loaded</div>';
    return;
  }

  const weightKN = liftoffMass * G0 / 1000;
  const twr      = weightKN > 0 ? totalThrust / weightKN : 0;
  const twrClass = twr < 1.05 ? 'warn' : twr >= 1.2 ? 'ok' : '';
  const propFracTot = liftoffMass > 0 ? totalProp / liftoffMass * 100 : 0;

  const dotH = c => `<span class="vp-col-dot" style="background:${c.color};"></span>`;
  const th = c => `<th>${dotH(c)}${c.shortLabel}</th>`;
  const headers = `<tr><th></th>${calcs.map(th).join('')}<th class="vp-col-veh">Vehicle</th></tr>`;

  const row = (label, fn, vehVal) =>
    `<tr><td>${label}</td>${calcs.map(c => `<td>${fn(c)}</td>`).join('')}<td class="vp-col-veh">${vehVal}</td></tr>`;

  tblBody.innerHTML = `<table class="vp-spec-tbl">
    <thead>${headers}</thead>
    <tbody>
      ${row('Dry Mass',      c => fmtM(c.dry),            fmtM(totalDry))}
      ${row('Propellant',    c => fmtM(c.prop),           fmtM(totalProp))}
      ${row('Gross Mass',    c => fmtM(c.dry + c.prop),   fmtM(liftoffMass))}
      ${row('Isp',           c => c.isp > 1 ? Math.round(c.isp) + ' s' : '—', '—')}
      ${row('Thrust',        c => c.thrust > 0 ? fmtF(c.thrust / (c.isBooster ? 1 : 1), c.thrust >= 100 ? 0 : 1) : '—', totalThrust > 0 ? fmtF(totalThrust, totalThrust >= 100 ? 0 : 1) : '—')}
      ${row('Liftoff T/W',   () => '—',                   twr > 0 ? `<span class="vp-stat-val ${twrClass}" style="font-size:inherit;">${twr.toFixed(2)}</span>` : '—')}
      ${row('Prop Fraction', c => c.propFrac > 0 ? c.propFrac.toFixed(1) + ' %' : '—', propFracTot > 0 ? propFracTot.toFixed(1) + ' %' : '—')}
      ${row('Mass Ratio',    c => c.massRatio > 1 ? c.massRatio.toFixed(2) : '—', '—')}
      ${row('ΔV (isol.)',    c => { const pct = (c.dv / Math.max(...calcs.map(x => x.dv), 1) * 100).toFixed(1); return `<span class="vp-dv-cellbar" style="background:linear-gradient(to right, ${c.color}2e ${pct}%, transparent ${pct}%);"><span class="vp-dv-accent">${c.dv > 0 ? fmt(Math.round(c.dv)) + ' m/s' : '—'}</span></span>`; }, `<span class="vp-dv-accent">${hasAnyDV ? fmt(Math.round(totalDV)) + ' m/s' : '—'}</span>`)}
      ${row('Burn Time',     c => c.burnTime > 0 ? (c.burnTime >= 60 ? (c.burnTime/60).toFixed(1) + ' min' : Math.round(c.burnTime) + ' s') : '—', '—')}
    </tbody>
  </table>`;
}

function buildStageComposition(){
  const body=document.getElementById('comp-body');
  if(!body)return;
  body.innerHTML='';
  // Update count badge
  const cntEl=document.getElementById('comp-stage-count');
  if(cntEl){const total=numStages+(useBooster?1:0);cntEl.textContent=total===1?'1 stage':total+' stages';}

  function makeCompCard(label,stageName,dry,prop,thrust,isp,stageIdx,isBooster,extraIdx){
    const isExtra = extraIdx!=null;   // an additional booster group (Group 2+)
    const saved=isExtra?false:(isBooster?boosterSaved:(stageIdx>=0?stageSaved[stageIdx]:false));
    const wrap=document.createElement('div');
    wrap.style.cssText='display:flex;flex-direction:column;';
    const lbl=document.createElement('div');
    lbl.className='comp-stage-label';lbl.textContent=label;
    wrap.appendChild(lbl);
    // Outer row: card content + save area
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:stretch;gap:0;';
    const card=document.createElement('div');
    card.className='comp-card'+(stageName?'':' custom-stage');
    card.style.flex='1';
    card.addEventListener('dragover',e=>{e.preventDefault();card.classList.add('drop-hover');});
    card.addEventListener('dragleave',()=>card.classList.remove('drop-hover'));
    card.addEventListener('drop',e=>{
      e.preventDefault();card.classList.remove('drop-hover');
      if(!_draggingStage)return;
      if(_draggingStage._isVehicle){loadPreset(_draggingStage._preset,'builtin_'+BUILTIN_PRESETS.indexOf(_draggingStage._preset));}
      else if(isExtra){if(typeof applyBoosterDataToGroup==='function')applyBoosterDataToGroup(extraIdx,_draggingStage);}
      else if(isBooster){applyBoosterData(_draggingStage);}
      else{applyStageData(stageIdx,_draggingStage);}
    });
    const nameEl=document.createElement('div');
    nameEl.className='comp-card-name'+(stageName?'':' unnamed');
    nameEl.style.display='flex';nameEl.style.alignItems='center';nameEl.style.gap='6px';
    const nameText=document.createElement('span');
    nameText.style.overflow='hidden';nameText.style.textOverflow='ellipsis';nameText.style.whiteSpace='nowrap';
    nameText.textContent=stageName||'Unnamed';
    nameEl.appendChild(nameText);
    // S1.5 badge
    if(!isBooster&&stageIdx>=0&&stageStore[stageIdx]?.s15){
      const badge=document.createElement('span');
      badge.textContent='½';
      badge.title='Stage-and-a-Half';
      badge.style.cssText='font-size:9px;font-family:var(--mono);color:var(--accent);background:rgba(136,198,87,.12);border:1px solid var(--accent);border-radius:2px;padding:1px 4px;flex-shrink:0;letter-spacing:0;';
      nameEl.appendChild(badge);
    }
    // Crossfeed / center-throttle badge (booster only) + air-lit indicator for extra groups
    if(isBooster){
      const grp=isExtra?(_extraBoosterGroups[extraIdx]||{}):null;
      const pm=isExtra?(grp.parallelMode||'independent'):(document.getElementById('b_parallel_mode')?.value||'independent');
      const mkBadge=(txt,title)=>{const b=document.createElement('span');b.textContent=txt;b.title=title;b.style.cssText='font-size:9px;font-family:var(--mono);color:var(--accent);background:rgba(136,198,87,.12);border:1px solid var(--accent);border-radius:2px;padding:1px 4px;flex-shrink:0;letter-spacing:0;';nameEl.appendChild(b);};
      if(pm!=='independent'){
        const thr=Math.round((isExtra?((grp.coreThrottle!=null?grp.coreThrottle:0.57)*100):(parseFloat(document.getElementById('b_core_throttle')?.value)||57)));
        mkBadge(pm==='crossfeed'?'XFEED':(thr+'%'), pm==='crossfeed'?'Crossfeed — boosters feed first stage':('First stage throttled to '+thr+'% during boost'));
      }
      // ignition badge for air-lit extra groups
      if(isExtra && grp.ignition && grp.ignition!=='ground'){
        if(grp.ignition.atTime!=null) mkBadge('T+'+grp.ignition.atTime+'s','Air-lit at T+'+grp.ignition.atTime+'s');
        else if(grp.ignition.after!=null) mkBadge('AIR','Air-lit — ignites after Group '+(grp.ignition.after+1)+' burns out');
      }
    }
    card.appendChild(nameEl);
    if(dry||prop||thrust||isp){
      const specs=document.createElement('div');specs.className='comp-card-specs';
      specs.innerHTML=`<span><b>Isp</b> ${isp||0} s</span><span><b>F</b> ${fT(thrust||0)}</span><span><b>Dry</b> ${fM(dry||0)}</span><span><b>Prop</b> ${fM(prop||0)}</span>`;
      card.appendChild(specs);
    }
    const hint=document.createElement('div');hint.className='comp-card-hint';
    hint.textContent='// drop to replace';
    card.appendChild(hint);
    row.appendChild(card);
    // Wrench / edit button
    const editBtn=document.createElement('button');
    editBtn.className='comp-edit-btn';
    editBtn.title='Edit stage';
    editBtn.innerHTML='<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 1a3 3 0 0 0-2.9 3.7L1 8.3A1.1 1.1 0 1 0 2.7 10l3.6-3.6A3 3 0 1 0 7.5 1z"/><circle cx="7.5" cy="4" r="1" fill="currentColor" stroke="none"/></svg>';
    editBtn.addEventListener('mouseenter',()=>editBtn.style.color='var(--accent2)');
    editBtn.addEventListener('mouseleave',()=>editBtn.style.color='');
    editBtn.addEventListener('click',e=>{e.stopPropagation();openEditStageModal(stageIdx,isBooster,extraIdx);});
    row.appendChild(editBtn);
    // Right column: a REMOVE button for extra booster groups, else the Save/saved control
    if(isExtra){
      const rm=document.createElement('div');
      rm.style.cssText='width:32px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);border-left:none;cursor:pointer;color:var(--text-dim);flex-shrink:0;transition:color .15s;';
      rm.innerHTML='<span style="font-size:11px;line-height:1;">&#x2715;</span>';
      rm.title='Remove this booster group';
      rm.addEventListener('mouseenter',()=>rm.style.color='var(--error,#e06c75)');
      rm.addEventListener('mouseleave',()=>rm.style.color='var(--text-dim)');
      rm.addEventListener('click',e=>{e.stopPropagation();if(typeof boosterGroupRemove==='function')boosterGroupRemove(extraIdx);});
      row.appendChild(rm); wrap.appendChild(row); return wrap;
    }
    // Save button / saved dot
    const saveBtn=document.createElement('div');
    saveBtn.style.cssText=`width:32px;display:flex;align-items:center;justify-content:center;
      border:1px solid var(--border);border-left:none;cursor:${saved?'default':'pointer'};
      color:${saved?'var(--accent3)':'var(--text-dim)'};flex-shrink:0;transition:color .15s;`;
    if(saved){
      saveBtn.innerHTML='<span style="font-size:9px;line-height:1;">●</span>';
      saveBtn.title='Saved';
    } else {
      saveBtn.innerHTML='<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><line x1="5.5" y1="1" x2="5.5" y2="7.5"/><polyline points="2.5,5 5.5,8.5 8.5,5"/><line x1="1.5" y1="10" x2="9.5" y2="10"/></svg>';
      saveBtn.title='Save stage as .json';
      saveBtn.addEventListener('mouseenter',()=>saveBtn.style.color='var(--accent)');
      saveBtn.addEventListener('mouseleave',()=>saveBtn.style.color='var(--text-dim)');
      saveBtn.addEventListener('click',e=>{e.stopPropagation();saveStageCardAsFile(stageIdx,isBooster);});
    }
    row.appendChild(saveBtn);
    wrap.appendChild(row);
    return wrap;
  }

  // Booster first
  if(useBooster){
    const bCount=parseInt(document.getElementById('num-boosters')?.value)||0;
    body.appendChild(makeCompCard(
      `Strap-on ×${bCount}`,
      currentBoosterName,
      parseFloat(document.getElementById('b_dry')?.value)||0,
      parseFloat(document.getElementById('b_prop')?.value)||0,
      parseFloat(document.getElementById('b_thrust')?.value)||0,
      parseFloat(document.getElementById('b_isp')?.value)||0,
      null,true
    ));
    // additional booster groups (Group 2+) as cards
    (_extraBoosterGroups||[]).forEach((g,i)=>{
      body.appendChild(makeCompCard(
        `Booster Grp ${i+2} ×${g.count||1}`,
        g.name||('Booster Group '+(i+2)),
        g.dry||0, g.prop||0, g.thrust||0, g.isp||0,
        null,true,i
      ));
    });
    // "+ Add booster group" affordance (visible right here in the composition view)
    const addBg=document.createElement('button');
    addBg.className='act-btn';
    addBg.textContent='+ Add Booster Group';
    addBg.title='Add another kind of strap-on (optionally air-lit after another group)';
    addBg.style.cssText='margin:2px 0 6px;font-size:10px;align-self:flex-start;';
    addBg.onclick=()=>{ if(typeof boosterGroupAdd==='function')boosterGroupAdd(); };
    body.appendChild(addBg);
  }

  for(let s=0;s<numStages;s++){
    const store=stageStore[s]||{};
    body.appendChild(makeCompCard(
      `Stage ${s+1}`,
      currentStageNames[s]||null,
      mathValue(store.dry,0),
      mathValue(store.prop,0),
      mathValue(store.thrust,0),
      parseFloat(store.isp)||0,
      s,false
    ));
  }
  // Ghost placeholder cards up to 4 total
  const ghostCount=Math.max(0,4-numStages);
  for(let g=0;g<ghostCount;g++){
    const slotIdx=numStages+g;
    const wrap=document.createElement('div');
    wrap.style.cssText='display:flex;flex-direction:column;';
    const lbl=document.createElement('div');
    lbl.className='comp-stage-label';lbl.style.opacity='.35';
    lbl.textContent=`Stage ${slotIdx+1}`;
    wrap.appendChild(lbl);
    // Ghost row (card + empty save area)
    const row=document.createElement('div');row.style.cssText='display:flex;align-items:stretch;';
    const ghost=document.createElement('div');
    ghost.className='comp-card-ghost';ghost.style.flex='1';
    const ghostLbl=document.createElement('div');
    ghostLbl.className='comp-card-ghost-label';
    ghostLbl.textContent='// drop stage here';
    ghost.appendChild(ghostLbl);
    ghost.addEventListener('dragover',e=>{e.preventDefault();ghost.classList.add('drop-hover');});
    ghost.addEventListener('dragleave',()=>ghost.classList.remove('drop-hover'));
    ghost.addEventListener('drop',e=>{
      e.preventDefault();ghost.classList.remove('drop-hover');
      if(!_draggingStage||_draggingStage._isVehicle)return;
      setStages(slotIdx+1);
      applyStageData(slotIdx,_draggingStage);
    });
    // Empty save area placeholder
    const savePh=document.createElement('div');
    savePh.style.cssText='width:32px;border:1px dashed var(--border);border-left:none;opacity:.3;flex-shrink:0;';
    row.appendChild(ghost);row.appendChild(savePh);
    wrap.appendChild(row);
    body.appendChild(wrap);
  }
  vehCanvasOnStagesChanged();
  vehBuildAssignStrip();
  updatePerfPanel();
}
