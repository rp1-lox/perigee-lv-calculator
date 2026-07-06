
// ─── LIBRARY BROWSER (v2 merged design) ───────
// Replaces the old flat buildStageLibrary / buildPresets rendering inside
// #lib-body on the Vehicles page. Browse by taxonomy (205-tag-schema dims) →
// drill into a value → refine with stacked facets → search composes with the
// current scope. A "Spotlight" surfaces a random item on the home view.
// Vehicles ⇄ Stages is the spine. Renders into #lib-browser-body; the toggle +
// search box live in the static HTML and call libSetMode / libSearch.
//
// Reuses existing card factories & behaviors: stages → makeCard() (drag/click
// already wired), vehicles → libMakeVehicleCard(). buildStageLibrary and
// buildPresets are reassigned to libRender at the bottom so every existing
// refresh call-site keeps working.

let _libMode='veh', _libQ='', _libFacets={}, _libBrowseDim=null, _libSpot=null;
// Stages use a class-first layout (S-C): class tabs + propellant chips + a side
// Filters button (era/origin) — NOT the vehicle taxonomy tiles.
let _libStageCat='all', _libStageProp='all', _libStageEra=null, _libStageOrigin=null, _libStageFilterOpen=false;
const LIB_PROP_SHORT={
  'Liquid Oxygen / Liquid Hydrogen':'LOX/LH2','Liquid Oxygen / Kerosene':'LOX/RP-1',
  'Liquid Oxygen / Methane':'LOX/CH4','Liquid Oxygen / Ethanol':'LOX/Eth',
  'Nitrogen Tetroxide / Aerozine-50':'N2O4/A-50','Nitrogen Tetroxide / UDMH':'N2O4/UDMH',
  'Inhibited Red Fuming Nitric Acid / UDMH':'IRFNA/UDMH','Liquid Fluorine / Hydrazine':'LF2/N2H4',
  'Nitrogen Tetroxide / Aniline':'N2O4/Aniline','Solid Propellant':'Solid',
};
function libPropShort(p){return LIB_PROP_SHORT[p]||p;}
function libStageShort(c){return {'Booster Stages':'Booster','Side Boosters':'Side','Upper Stages':'Upper','Kick Stages':'Kick'}[c]||c;}

// ── data accessors ──
function libList(){
  if(_libMode==='veh'){
    let a=BUILTIN_PRESETS.map((p,i)=>({item:p,key:'builtin_'+i,user:false}));
    if(typeof userLVs!=='undefined') a=a.concat(userLVs.map((p,i)=>({item:p,key:'user_'+i,user:true})));
    return a;
  }
  const a=[];
  Object.entries(STAGE_LIBRARY).forEach(([cat,arr])=>arr.forEach(s=>a.push({item:s,cat,user:false})));
  if(typeof userStagesByCategory!=='undefined')
    Object.entries(userStagesByCategory).forEach(([cat,arr])=>arr.forEach(s=>a.push({item:s,cat,user:true})));
  return a;
}
function libMatchFacets(rec){
  return Object.entries(_libFacets).every(([dim,val])=>libResolveTags(rec.item,dim,_libMode).includes(val));
}
function libSubset(){
  let l=libList();
  if(typeof showUserOnly!=='undefined' && showUserOnly) l=l.filter(r=>r.user);
  return l.filter(libMatchFacets);
}
function libSearchStr(rec){
  const it=rec.item;
  return ((it.name||'')+' '+(it.note||'')+' '+((it.stageNames||[]).join(' '))+' '+
    (it.vehicle||'')+' '+(it.engines||'')+' '+((it.tags||[]).join(' '))).toLowerCase();
}

// ── card nodes (reuse existing factories, append a clickable tag row) ──
function libMakeVehicleCard(p,key,isUser){
  const card=document.createElement('div');
  card.className='stage-card lib-vcard'+(isUser?' user':'')+(activePresetKey===key?' active':'');
  card.draggable=true; card.style.width='100%';
  const sub=(p.stageNames||[]).join(' + ') || (p.note? p.note.slice(0,70)+(p.note.length>70?'…':'') : '');
  card.innerHTML=`<div class="stage-card-name" title="${(p.name||'').replace(/"/g,'&quot;')}">${p.name||'Unnamed LV'}</div>`+
    (sub?`<div class="stage-card-mini" style="white-space:normal;line-height:1.4;">${sub}</div>`:'');
  card.addEventListener('dragstart',e=>{
    _didDrag=true; _draggingStage={_isVehicle:true,_preset:p,name:p.name};
    e.dataTransfer.setData('text/plain',JSON.stringify({_isVehicle:true,name:p.name}));
    e.dataTransfer.effectAllowed='copy'; setTimeout(()=>card.classList.add('dragging'),0);
  });
  card.addEventListener('dragend',()=>{card.classList.remove('dragging');_draggingStage=null;setTimeout(()=>{_didDrag=false;},80);});
  card.addEventListener('click',e=>{
    e.stopPropagation(); if(_didDrag)return;
    // user LVs load directly (same as old preset list); built-ins open the detail modal
    if(isUser) loadPreset(p,key); else if(typeof openVehicleModal==='function') openVehicleModal(p); else loadPreset(p,key);
  });
  return card;
}
function libTagRow(item){
  const row=document.createElement('div'); row.className='lib-tagrow';
  ['era','origin','cls'].forEach(dim=>{               // prop omitted (already in card subtitle)
    libResolveTags(item,dim,_libMode).forEach(v=>{
      if(v==='Unspecified')return;
      const t=document.createElement('span'); t.className='lib-tagchip'; t.textContent=v; t.title='Refine by '+v;
      t.onclick=e=>{e.stopPropagation();libAddFacet(dim,v);};
      row.appendChild(t);
    });
  });
  return row;
}
function libCardNode(rec){
  let card;
  if(_libMode==='veh'){ card=libMakeVehicleCard(rec.item,rec.key,rec.user); }
  else {
    const onDel = rec.user ? ()=>{
      const arr=userStagesByCategory[rec.cat]; if(arr){ const i=arr.indexOf(rec.item); if(i>=0)arr.splice(i,1); if(!arr.length)delete userStagesByCategory[rec.cat]; }
      libRender();
    } : null;
    card=makeCard(rec.item,rec.cat,onDel); card.style.width='100%';
  }
  card.appendChild(libTagRow(rec.item));
  return card;
}

// ── chrome builders ──
function libCrumb(){
  const c=document.createElement('div'); c.className='lib-crumb';
  const sep=()=>{const s=document.createElement('span');s.textContent='›';s.style.cssText='opacity:.5;margin:0 4px;';return s;};
  const home=document.createElement('a'); home.textContent='All '+(_libMode==='veh'?'Vehicles':'Stages'); home.onclick=libHome; c.appendChild(home);
  Object.entries(_libFacets).forEach(([dim,val])=>{
    c.appendChild(sep());
    const chip=document.createElement('span'); chip.className='lib-fchip'; chip.textContent=val;
    const x=document.createElement('span'); x.className='x'; x.textContent='✕'; x.onclick=()=>libDelFacet(dim); chip.appendChild(x);
    c.appendChild(chip);
  });
  if(_libBrowseDim){ c.appendChild(sep()); const h=document.createElement('span'); h.className='here'; h.textContent=LIB_DIMLBL[_libBrowseDim]+'?'; c.appendChild(h); }
  return c;
}
function libRefineBar(){
  const remaining=LIB_DIMS.filter(d=>!(d in _libFacets));
  if(!remaining.length) return document.createTextNode('');
  const bar=document.createElement('div'); bar.className='lib-refine';
  const lbl=document.createElement('span'); lbl.className='lbl'; lbl.textContent='REFINE'; bar.appendChild(lbl);
  remaining.forEach(d=>{const b=document.createElement('span'); b.className='lib-refine-opt'; b.textContent=LIB_DIMLBL[d]+' ▾'; b.onclick=()=>libOpenDim(d); bar.appendChild(b);});
  return bar;
}
function libCountLine(n){const d=document.createElement('div'); d.className='lib-count'; d.textContent=`// ${n} ${_libMode==='veh'?'vehicles':'stages'}`; return d;}

// ── views ──
// Reusable spotlight (shown on the vehicle home AND the stage view).
function libSpotlightNode(){
  if(!_libSpot) libReroll(true);
  if(!_libSpot) return null;
  const it=_libSpot.item;
  const sub=_libMode==='veh' ? ((it.stageNames||[]).join(' + ')||it.note||'') : `from ${it.vehicle||'—'} · ${it.thrust||'?'} kN · ${it.isp||'?'} s`;
  const cls=_libMode==='stg' ? (libResolveTags(it,'cls','stg').filter(v=>v!=='Unspecified')[0]||'') : '';
  const sp=document.createElement('div'); sp.className='lib-spotlight';
  sp.draggable=true;
  sp.innerHTML=`<div class="lib-spotlight-lbl">Spotlight${cls?' · '+cls:''}</div><div class="lib-spotlight-name">${it.name||''}</div><div class="lib-spotlight-sub">${sub}</div>`;
  sp.querySelectorAll('img').forEach(img=>{img.draggable=false;});
  const rr=document.createElement('button'); rr.className='lib-spotlight-reroll'; rr.textContent='⟳ discover'; rr.onclick=e=>{e.stopPropagation();libReroll();}; sp.appendChild(rr);
  // Drag (same payload shape as libMakeVehicleCard / makeCard) — separate from click via _didDrag flag.
  sp.addEventListener('dragstart',e=>{
    _didDrag=true;
    if(_libMode==='veh'){
      _draggingStage={_isVehicle:true,_preset:it,name:it.name};
      e.dataTransfer.setData('text/plain',JSON.stringify({_isVehicle:true,name:it.name}));
    } else {
      _draggingStage={...it,_cat:_libSpot.cat};
      e.dataTransfer.setData('text/plain',JSON.stringify(_draggingStage));
    }
    e.dataTransfer.effectAllowed='copy';
    setTimeout(()=>sp.classList.add('dragging'),0);
  });
  sp.addEventListener('dragend',()=>{
    sp.classList.remove('dragging');_draggingStage=null;
    setTimeout(()=>{_didDrag=false;},80);
  });
  sp.onclick=e=>{
    e.stopPropagation(); if(_didDrag)return;
    if(_libMode==='veh'){ _libSpot.user?loadPreset(it,_libSpot.key):(openVehicleModal&&openVehicleModal(it)); } else if(typeof openStageModal==='function'){ openStageModal(it); }
  };
  return sp;
}

// ── STAGES view (class-first: class tabs + propellant chips + side Filters) ──
function libStageCats(){
  const cats=Object.keys(STAGE_LIBRARY);
  if(typeof userStagesByCategory!=='undefined') Object.keys(userStagesByCategory).forEach(c=>{ if(!cats.includes(c))cats.push(c); });
  return cats;
}
function libStageItems(){
  let l=libList();
  if(typeof showUserOnly!=='undefined'&&showUserOnly) l=l.filter(r=>r.user);
  if(_libStageCat!=='all') l=l.filter(r=>r.cat===_libStageCat);
  if(_libStageProp!=='all') l=l.filter(r=>libResolveTags(r.item,'prop','stg').includes(_libStageProp));
  if(_libStageEra) l=l.filter(r=>libResolveTags(r.item,'era','stg').includes(_libStageEra));
  if(_libStageOrigin) l=l.filter(r=>libResolveTags(r.item,'origin','stg').includes(_libStageOrigin));
  if(_libQ) l=l.filter(r=>libSearchStr(r).includes(_libQ));
  return l;
}
function libViewStages(){
  const frag=document.createDocumentFragment();
  if(!_libQ){ const sp=libSpotlightNode(); if(sp)frag.appendChild(sp); }
  const all=libList();
  // class tabs + side Filters button
  const tabs=document.createElement('div'); tabs.className='lib-ctabs';
  const mkTab=(c,label,n)=>{const t=document.createElement('span'); t.className='lib-ctab'+(_libStageCat===c?' active':''); t.innerHTML=label+(n!=null?` <span class="n">${n}</span>`:''); t.onclick=()=>libStageSetCat(c); return t;};
  tabs.appendChild(mkTab('all','All',all.length));
  libStageCats().forEach(c=>{ const n=all.filter(r=>r.cat===c).length; tabs.appendChild(mkTab(c,libStageShort(c),n)); });
  const nf=(_libStageEra?1:0)+(_libStageOrigin?1:0);
  const fbtn=document.createElement('span'); fbtn.className='lib-ctab lib-filterbtn'+(nf?' on':'')+(_libStageFilterOpen?' active':''); fbtn.style.marginLeft='auto';
  fbtn.textContent='⊟ Filters'+(nf?` (${nf})`:''); fbtn.onclick=libStageToggleFilters; tabs.appendChild(fbtn);
  frag.appendChild(tabs);
  // propellant chips (within current class)
  const propVals=new Set();
  all.filter(r=>_libStageCat==='all'||r.cat===_libStageCat).forEach(r=>libResolveTags(r.item,'prop','stg').forEach(v=>{if(v!=='Unspecified')propVals.add(v);}));
  const pc=document.createElement('div'); pc.className='lib-pchips';
  const mkP=(p,label)=>{const c=document.createElement('span'); c.className='lib-pchip'+(_libStageProp===p?' active':''); c.textContent=label; c.onclick=()=>libStageSetProp(p); return c;};
  pc.appendChild(mkP('all','all propellants')); [...propVals].forEach(p=>pc.appendChild(mkP(p,libPropShort(p))));
  frag.appendChild(pc);
  // expandable Filters panel (era + origin — "filter through everything")
  if(_libStageFilterOpen){
    const panel=document.createElement('div'); panel.className='lib-filterpanel';
    ['era','origin'].forEach(dim=>{
      const vals=new Set();
      all.filter(r=>_libStageCat==='all'||r.cat===_libStageCat).forEach(r=>libResolveTags(r.item,dim,'stg').forEach(v=>{if(v!=='Unspecified')vals.add(v);}));
      if(!vals.size)return;
      const grp=document.createElement('div'); grp.className='lib-filtergrp';
      const lbl=document.createElement('div'); lbl.className='lib-filtergrp-lbl'; lbl.textContent=LIB_DIMLBL[dim]; grp.appendChild(lbl);
      const wrap=document.createElement('div'); wrap.className='lib-pchips';
      const cur=dim==='era'?_libStageEra:_libStageOrigin;
      [...vals].forEach(v=>{const c=document.createElement('span'); c.className='lib-pchip'+(cur===v?' active':''); c.textContent=v; c.onclick=()=>libStageSetDim(dim,v); wrap.appendChild(c);});
      grp.appendChild(wrap); panel.appendChild(grp);
    });
    if(nf){ const clr=document.createElement('span'); clr.className='lib-pchip lib-clear'; clr.textContent='✕ clear filters'; clr.onclick=()=>{_libStageEra=null;_libStageOrigin=null;libRender();}; panel.appendChild(clr); }
    frag.appendChild(panel);
  }
  const items=libStageItems();
  frag.appendChild(libCountLine(items.length));
  items.forEach(r=>frag.appendChild(libCardNode(r)));
  return frag;
}
function libStageSetCat(c){_libStageCat=c;_libStageProp='all';libRender();}
function libStageSetProp(p){_libStageProp=p;libRender();}
function libStageToggleFilters(){_libStageFilterOpen=!_libStageFilterOpen;libRender();}
function libStageSetDim(dim,v){ if(dim==='era')_libStageEra=_libStageEra===v?null:v; else _libStageOrigin=_libStageOrigin===v?null:v; libRender(); }

function libViewHome(){
  const frag=document.createDocumentFragment();
  const list=libList();
  const sp=libSpotlightNode(); if(sp)frag.appendChild(sp);
  const tiles=document.createElement('div'); tiles.className='lib-tiles';
  LIB_DIMS.forEach(dim=>{
    const vals=new Set(); list.forEach(r=>libResolveTags(r.item,dim,_libMode).forEach(v=>vals.add(v)));
    const arr=[...vals].filter(v=>v!=='Unspecified');
    const t=document.createElement('div'); t.className='lib-tile'; t.onclick=()=>libOpenDim(dim);
    t.innerHTML=`<div class="lib-tile-lbl">By ${LIB_DIMLBL[dim]}</div><div class="lib-tile-cnt">${arr.length} groups · ${list.length} total</div><div class="lib-tile-ex">${arr.slice(0,3).join(' · ')}${arr.length>3?'…':''}</div>`;
    tiles.appendChild(t);
  });
  frag.appendChild(tiles);
  // Full scrollable list of every vehicle — available up front, not tucked behind the tiles.
  const sl=document.createElement('div'); sl.className='sl'; sl.style.marginTop='4px'; sl.textContent='All Vehicles'; frag.appendChild(sl);
  frag.appendChild(libCountLine(list.length));
  list.forEach(r=>frag.appendChild(libCardNode(r)));
  return frag;
}
function libViewDrill(){
  const frag=document.createDocumentFragment(); frag.appendChild(libCrumb());
  const sub=libSubset();
  const vals=new Set(); sub.forEach(r=>libResolveTags(r.item,_libBrowseDim,_libMode).forEach(v=>vals.add(v)));
  const vocab=libVocabFor(_libBrowseDim,_libMode);
  const arr=[...vals].sort((a,b)=>{const ia=vocab.indexOf(a),ib=vocab.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib);});
  arr.forEach(v=>{
    const n=sub.filter(r=>libResolveTags(r.item,_libBrowseDim,_libMode).includes(v)).length;
    const row=document.createElement('div'); row.className='lib-vrow'; row.onclick=()=>libAddFacet(_libBrowseDim,v);
    row.innerHTML=`<span class="lib-vrow-lbl">${v}</span><span class="lib-vrow-cnt">${n}</span>`;
    frag.appendChild(row);
  });
  return frag;
}
function libViewSubset(){
  const frag=document.createDocumentFragment();
  frag.appendChild(libCrumb()); frag.appendChild(libRefineBar());
  const items=libSubset(); frag.appendChild(libCountLine(items.length));
  items.forEach(r=>frag.appendChild(libCardNode(r)));
  return frag;
}
function libViewSearch(){
  const frag=document.createDocumentFragment(); frag.appendChild(libCrumb());
  const items=libSubset().filter(r=>libSearchStr(r).includes(_libQ));
  const cl=document.createElement('div'); cl.className='lib-count';
  cl.textContent=`// ${items.length} match "${_libQ}"${Object.keys(_libFacets).length?' within filters':''}`;
  frag.appendChild(cl);
  if(!items.length){const e=document.createElement('div'); e.className='lib-count'; e.textContent='no matches'; frag.appendChild(e);}
  items.forEach(r=>frag.appendChild(libCardNode(r)));
  return frag;
}

// ── action slot (mode-aware Make/Load) ──
function libRenderActions(){
  const slot=document.getElementById('lib-action-slot'); if(!slot)return;
  slot.innerHTML='';
  if(_libMode==='stg'){
    // stg mode: [Save Stage] + [⇣ Import] (accepts .stage files AND library bundles)
    const mk=document.createElement('button'); mk.className='act-btn green'; mk.textContent='Save Stage';
    mk.onclick=()=>{ if(typeof openAddStageModal==='function')openAddStageModal(); };
    slot.appendChild(mk);
    const imp=document.createElement('label'); imp.className='act-btn'; imp.style.cursor='pointer'; imp.title='Import a stage file or a Perigee library export'; imp.textContent='⇣ Import';
    const fin=document.createElement('input'); fin.type='file'; fin.accept='.stage,.json'; fin.style.display='none';
    fin.onchange=function(){ if(typeof loadUserStageFile==='function')loadUserStageFile(this); }; imp.appendChild(fin); slot.appendChild(imp);
  } else {
    // veh mode: single [⇣ Load] — accepts .vehicle/.json single vehicles AND library bundles
    const ld=document.createElement('label'); ld.className='act-btn'; ld.style.cursor='pointer'; ld.title='Load a saved vehicle or a Perigee library export'; ld.textContent='⇣ Load';
    const fin=document.createElement('input'); fin.type='file'; fin.accept='.vehicle,.json'; fin.style.display='none';
    fin.onchange=function(){ if(typeof libLoadVehicleFile==='function')libLoadVehicleFile(this); }; ld.appendChild(fin); slot.appendChild(ld);
  }
}

// ── master render + state transitions ──
function libRender(){
  const root=document.getElementById('lib-browser-body'); if(!root)return;
  const seg=document.getElementById('lib-mode-seg');
  if(seg)[...seg.querySelectorAll('button')].forEach((b,i)=>b.classList.toggle('active',(i===0)===(_libMode==='veh')));
  libRenderActions();
  const sb=document.getElementById('lib-search'); if(sb&&document.activeElement!==sb)sb.placeholder=_libMode==='veh'?'Search vehicles…':'Search stages…';
  root.innerHTML='';
  if(_libMode==='stg'){ root.appendChild(libViewStages()); return; }   // stages: class-first layout
  if(_libQ){ root.appendChild(libViewSearch()); return; }
  if(_libBrowseDim){ root.appendChild(libViewDrill()); return; }
  if(Object.keys(_libFacets).length){ root.appendChild(libViewSubset()); return; }
  root.appendChild(libViewHome());
}
function libSetMode(m){ if(_libMode===m)return; _libMode=m; _libFacets={}; _libBrowseDim=null; _libQ=''; _libSpot=null;
  _libStageCat='all'; _libStageProp='all'; _libStageEra=null; _libStageOrigin=null; _libStageFilterOpen=false;
  const sb=document.getElementById('lib-search'); if(sb)sb.value=''; libRender(); }
function libSearch(v){ _libQ=(v||'').toLowerCase(); libRender(); }
function libOpenDim(d){ _libBrowseDim=d; libRender(); }
function libAddFacet(dim,val){ _libFacets[dim]=val; _libBrowseDim=null; libRender(); }
function libDelFacet(dim){ delete _libFacets[dim]; libRender(); }
function libHome(){ _libFacets={}; _libBrowseDim=null; _libQ=''; const sb=document.getElementById('lib-search'); if(sb)sb.value=''; libRender(); }
function libReroll(silent){ const l=libList(); _libSpot=l.length?l[Math.floor(Math.random()*l.length)]:null; if(!silent)libRender(); }

// Redirect the legacy render entry points so every existing refresh call works.
buildStageLibrary = libRender;
buildPresets = libRender;
