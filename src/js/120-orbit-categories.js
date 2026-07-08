
// ─── ORBIT CATEGORIES ─────────────────────────
function buildOrbitCategories(){
  const container=document.getElementById('orbit-categories');
  container.innerHTML='';
  const _oq=(document.getElementById('orbit-search')?.value||'').toLowerCase();

  // Build list of all categories: built-in + any user-created ones not in built-ins
  const builtinNames=new Set(ORBIT_CATEGORIES.map(c=>c.planet));
  const userCatNames=Object.keys(userOrbitsByCategory).filter(k=>!builtinNames.has(k));

  // Helper: render one orbit button (with optional delete)
  const renderOrbit=(grid,o,key,onDel)=>{
    const wrap=document.createElement('div');
    wrap.style.cssText='display:flex;gap:2px;';
    const btn=document.createElement('button');
    btn.className='orbit-btn'+(onDel?' user-orbit':'')+(activeOrbitKey===key?' active':'');
    btn.style.flex='1';
    btn.innerHTML=`<b>${o.mode==='escape'?'↗ ':'⊙ '}${o.name}</b>`;
    btn.title=o.note||'';
    btn.onclick=()=>loadOrbitPreset(o,key);
    wrap.appendChild(btn);
    if(onDel){
      const x=document.createElement('button');
      x.className='orbit-btn';
      x.style.cssText='flex:none;width:22px;padding:4px 3px;color:var(--danger);border-color:color-mix(in srgb, var(--danger) 40%, transparent);font-size:13px;';
      x.textContent='×';x.title='Remove from list';x.onclick=onDel;
      wrap.appendChild(x);
    }
    grid.appendChild(wrap);
  };

  // Helper: render one planet section (now a vertical COLUMN in a horizontal row)
  const renderSection=(name,icon,color,builtinOrbits,userOrbitsInCat)=>{
    const collapsed=_oq?false:collapsedPlanets.has(name); // auto-expand when searching
    const hasContent=builtinOrbits.length+userOrbitsInCat.length>0||(name==='(current)'&&userDefinedOrbit);
    if(!hasContent)return;
    const sec=document.createElement('div');sec.className='planet-col';
    const hdr=document.createElement('div');hdr.className='planet-header';
    hdr.style.cssText=`border-left:3px solid ${color};`;
    hdr.innerHTML=`<span class="planet-icon">${icon}</span><span class="planet-name" style="color:${color}">${name}</span><span class="planet-chevron${collapsed?' collapsed':''}">▼</span>`;
    hdr.onclick=()=>{collapsedPlanets.has(name)?collapsedPlanets.delete(name):collapsedPlanets.add(name);buildOrbitCategories();};
    sec.appendChild(hdr);
    if(!collapsed){
      const grid=document.createElement('div');grid.className='planet-orbits-col';
      // Built-in orbits (no delete)
      builtinOrbits.forEach((o,oi)=>{
        const key=`orbit_${name}_${oi}`;
        renderOrbit(grid,o,key,null);
      });
      // User orbits (with delete)
      userOrbitsInCat.forEach((o,ui)=>{
        const key=`uorbit_${name}_${ui}`;
        renderOrbit(grid,o,key,()=>{
          userOrbitsByCategory[name].splice(ui,1);
          if(!userOrbitsByCategory[name].length)delete userOrbitsByCategory[name];
          if(activeOrbitKey===key)activeOrbitKey=null;
          buildOrbitCategories();
        });
      });
      sec.appendChild(grid);
    }
    container.appendChild(sec);
  };

  // Render built-in categories (filtered by search)
  ORBIT_CATEGORIES.forEach(cat=>{
    const filtBuiltin=_oq?cat.orbits.filter(o=>o.name.toLowerCase().includes(_oq)||cat.planet.toLowerCase().includes(_oq)):cat.orbits;
    const filtUser=_oq?(userOrbitsByCategory[cat.planet]||[]).filter(o=>o.name.toLowerCase().includes(_oq)):userOrbitsByCategory[cat.planet]||[];
    renderSection(cat.planet,cat.icon,cat.color,filtBuiltin,filtUser);
  });

  // Render user-created categories (filtered by search)
  userCatNames.forEach(name=>{
    const filtUser=_oq?(userOrbitsByCategory[name]||[]).filter(o=>o.name.toLowerCase().includes(_oq)):userOrbitsByCategory[name]||[];
    renderSection(name,'◆','var(--accent3)',[],filtUser);
  });

  // "Current Parameters" tracking button (unsaved edits)
  if(userDefinedOrbit){
    const sec=document.createElement('div');sec.className='planet-col';
    const hdr=document.createElement('div');hdr.className='planet-header';
    hdr.style.cssText='border-left:3px solid var(--text-dim);opacity:0.7;';
    hdr.innerHTML=`<span class="planet-icon">✏</span><span class="planet-name">Unsaved</span>`;
    sec.appendChild(hdr);
    const grid=document.createElement('div');grid.className='planet-orbits-col';
    const btn=document.createElement('button');
    btn.className='orbit-btn user-orbit'+(activeOrbitKey==='user_defined_orbit'?' active':'');
    btn.innerHTML='<b>Current Parameters</b>';
    btn.title='Current unsaved orbit parameters';
    btn.onclick=()=>{activeOrbitKey='user_defined_orbit';buildOrbitCategories();};
    grid.appendChild(btn);
    sec.appendChild(grid);container.appendChild(sec);
  }
  updateOrbTargetLabel();
}

function updateOrbTargetLabel(){
  const el=document.getElementById('orb-target-label');
  if(!el)return;
  if(userDefinedOrbit||activeOrbitKey==='user_defined_orbit'){
    el.textContent='Target: Custom';
    el.classList.add('custom');
    el.style.display='block';
  } else if(activeOrbitKey){
    // Find the display name for the active key by re-scanning categories/user orbits
    let name=null;
    ORBIT_CATEGORIES.forEach(cat=>{
      cat.orbits.forEach((o,oi)=>{
        if(`orbit_${cat.planet}_${oi}`===activeOrbitKey)name=o.name;
      });
    });
    Object.keys(userOrbitsByCategory).forEach(catName=>{
      (userOrbitsByCategory[catName]||[]).forEach((o,ui)=>{
        if(`uorbit_${catName}_${ui}`===activeOrbitKey)name=o.name;
      });
    });
    if(name){
      el.textContent='Target: '+name;
      el.classList.remove('custom');
      el.style.display='block';
    } else {
      el.style.display='none';
    }
  } else {
    el.style.display='none';
  }
}

function loadOrbitPreset(o,key){
  activeOrbitKey=key;userDefinedOrbit=false;
  setDestMode(o.mode||'orbit');
  if(o.mode==='escape'){
    document.getElementById('c3').value=o.c3;
    document.getElementById('decl').value=o.decl;
    document.getElementById('escape-perigee').value=o.perigee??185;
  } else {
    document.getElementById('apogee').value=o.apogee;
    document.getElementById('perigee').value=o.perigee;
    // If incTracksLat, override with effective site inclination
    const site=getCurrentSite();
    const inc=o.incTracksLat&&site ? siteEffectiveInc(site) : o.inc;
    document.getElementById('inclination').value=inc;
    document.getElementById('parking-alt').value=o.parking??185;
  }
  buildOrbitCategories();
  drawOrbitDiagram();
  // Update tracked-inc note
  const site=getCurrentSite();
  if(site)updateIncTrackedNote(site);
  else document.getElementById('inc-tracked-note').style.display='none';
}
