
// ─── FILTER SYSTEM ─────────────────────────────
function buildFilterPanel(){
  const panel=document.getElementById('filter-panel');
  if(!panel)return;   // legacy stage-filter UI removed by the library-browser redesign
  panel.innerHTML='';
  Object.entries(FILTER_TREE).forEach(([cat,opts])=>{
    const collapsed=collapsedFilterCats.has(cat);
    const div=document.createElement('div');div.className='filter-cat';
    const hdr=document.createElement('div');hdr.className='filter-cat-hdr';
    const chev=document.createElement('span');chev.className='filter-cat-chevron'+(collapsed?'':' open');chev.textContent='▶';
    hdr.appendChild(chev);
    hdr.appendChild(Object.assign(document.createElement('span'),{textContent:cat}));
    const activeInCat=activeFilters[cat]?.size||0;
    if(activeInCat){
      const badge=document.createElement('span');
      badge.style.cssText='font-family:var(--mono);font-size:8px;color:var(--accent);border:1px solid var(--accent);padding:1px 5px;margin-left:4px;';
      badge.textContent=activeInCat;hdr.appendChild(badge);
    }
    hdr.onclick=()=>{collapsedFilterCats.has(cat)?collapsedFilterCats.delete(cat):collapsedFilterCats.add(cat);buildFilterPanel();};
    div.appendChild(hdr);
    if(!collapsed){
      const row=document.createElement('div');row.className='filter-opts';
      opts.forEach(opt=>{
        const active=activeFilters[cat]?.has(opt);
        const btn=document.createElement('div');btn.className='filter-opt'+(active?' active':'');
        btn.textContent=opt;
        btn.onclick=()=>{
          if(!activeFilters[cat])activeFilters[cat]=new Set();
          if(activeFilters[cat].has(opt))activeFilters[cat].delete(opt);else activeFilters[cat].add(opt);
          if(!activeFilters[cat].size)delete activeFilters[cat];
          buildFilterPanel();updateFilterChips();buildStageLibrary();
        };
        row.appendChild(btn);
      });
      div.appendChild(row);
    }
    panel.appendChild(div);
  });
}

function updateFilterChips(){
  const chips=document.getElementById('active-filter-chips');
  if(!chips)return;   // legacy stage-filter UI removed by the library-browser redesign
  chips.innerHTML='';
  let any=false;
  Object.entries(activeFilters).forEach(([cat,tags])=>{
    tags.forEach(tag=>{
      any=true;
      const chip=document.createElement('div');chip.className='filter-chip';
      chip.innerHTML=`<span>${tag}</span><span class="filter-chip-x" onclick="removeFilter('${cat}','${tag}')">×</span>`;
      chips.appendChild(chip);
    });
  });
  document.getElementById('clear-filters-btn').style.display=any?'':'none';
  document.getElementById('filter-toggle-btn').classList.toggle('active',any||filterPanelOpen);
}

function removeFilter(cat,tag){
  if(activeFilters[cat]){activeFilters[cat].delete(tag);if(!activeFilters[cat].size)delete activeFilters[cat];}
  buildFilterPanel();updateFilterChips();buildStageLibrary();
}



function stageMatchesFilters(stage){
  // AND across filter categories, OR within each category
  return Object.entries(activeFilters).every(([cat,tags])=>{
    if(!tags.size)return true;
    const stageTags=stage.tags||[];
    return [...tags].some(t=>stageTags.includes(t));
  });
}
