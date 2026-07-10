
// ─── SAVE / LOAD ORBITS ───────────────────────
function saveUserOrbit(){
  document.getElementById('orbit-save-name').value='';
  // Populate category dropdown
  const sel=document.getElementById('orbit-save-category');
  sel.innerHTML='';
  ORBIT_CATEGORIES.forEach(cat=>{
    const o=document.createElement('option');o.value=cat.planet;o.textContent=cat.planet;sel.appendChild(o);
  });
  Object.keys(userOrbitsByCategory).filter(k=>!ORBIT_CATEGORIES.find(c=>c.planet===k)).forEach(k=>{
    const o=document.createElement('option');o.value=k;o.textContent=k+' (custom)';sel.appendChild(o);
  });
  const newOpt=document.createElement('option');newOpt.value='__new__';newOpt.textContent='[ New Category... ]';sel.appendChild(newOpt);
  document.getElementById('orbit-new-cat-wrap').style.display='none';
  openModal('modal-save-orbit');
  setTimeout(()=>document.getElementById('orbit-save-name').focus(),100);
}

function onOrbitCategoryChange(val){
  document.getElementById('orbit-new-cat-wrap').style.display=val==='__new__'?'block':'none';
}

function doSaveOrbit(){
  const name=document.getElementById('orbit-save-name').value.trim()||'My Orbit';
  let cat=document.getElementById('orbit-save-category').value;
  if(cat==='__new__'){
    cat=document.getElementById('orbit-new-cat-name').value.trim()||'Custom';
  }
  const o=collectCurrentOrbit();o.name=name;o.note=o.note||'User-defined orbit.';
  if(!userOrbitsByCategory[cat])userOrbitsByCategory[cat]=[];
  const idx=userOrbitsByCategory[cat].length;
  userOrbitsByCategory[cat].push(o);
  downloadJSON({...o,_category:cat},(name.replace(/[^a-z0-9_.\-]/gi,'_').toLowerCase())+'.orbit');
  activeOrbitKey=`uorbit_${cat}_${idx}`;
  userDefinedOrbit=false;
  closeModal('modal-save-orbit');
  buildOrbitCategories();
  if(typeof autosaveScheduleSave==='function')autosaveScheduleSave();
}

function collectCurrentOrbit(){
  if(destMode==='escape')return{mode:'escape',c3:gv('c3'),decl:gv('decl'),perigee:gv('escape-perigee')};
  // R3.2: lan_deg/argp_deg are OPTIONAL — blank fields stay absent from the
  // saved spec (unauthored), never coerced to 0 (see MATH.md §7i tier 1).
  const o={mode:'orbit',apogee:gv('apogee'),perigee:gv('perigee'),inc:gv('inclination'),parking:gv('parking-alt')};
  const lan=gvOpt('orbit-lan'), argp=gvOpt('orbit-argp');
  if(lan!=null)o.lan_deg=lan;
  if(argp!=null)o.argp_deg=argp;
  return o;
}

function loadOrbitFile(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const o=JSON.parse(e.target.result);
      if(!o.mode){showAlert('Invalid orbit file: missing mode field.','Invalid File');return;}
      const cat=o._category||'Custom';
      if(!userOrbitsByCategory[cat])userOrbitsByCategory[cat]=[];
      const idx=userOrbitsByCategory[cat].length;
      userOrbitsByCategory[cat].push(o);
      const key=`uorbit_${cat}_${idx}`;
      loadOrbitPreset(o,key);
    }catch(err){showAlert('Invalid orbit JSON: '+err.message,'Invalid File');}
  };
  reader.readAsText(file);input.value='';
}
