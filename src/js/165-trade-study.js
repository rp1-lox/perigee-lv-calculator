
// ─── TRADE STUDY ──────────────────────────────
// Sweep-chart panel for the Results page. Reuses the pure math in 140-physics.js
// (lvPerformance / lvMaxPayload) — never touches calculate()/evalAtPayload(). Reads
// the CURRENT vehicle + destination straight off the DOM (own small assembler below,
// deliberately not shared with calculate()'s local closure).
let _tsRunToken=0;   // increments to cancel an in-flight chunked sweep
let _tsResult=null;  // {xLabel,yLabel,xUnit,yUnit,series:[{name,points:[{x,y}]}],zeroLine}
// Vehicle comparison selection: array of {kind:'worksheet'|'builtin'|'user', idx, name}.
// This array is now the ONLY source of sweep series — there is no implicit series 0.
let _tsCompareVehicles=[{kind:'worksheet',idx:0,name:'Worksheet'}];
const TS_MAX_COMPARE=5;
const TS_SERIES_COLORS=['var(--accent)','var(--accent2)','var(--accent3)','var(--nm-earth)','var(--nm-lunar)'];

// Trade Studies is now its own always-expanded page (#page-trades). Ensure the
// panel is populated the first time the page is shown.
function tsEnsureRendered(){
  const panel=document.getElementById('ts-panel');
  if(!panel)return;
  if(!panel.innerHTML.trim()){tsRenderForm();return;}
  // Vehicles saved since the first render must appear: rebuild the compare
  // dropdown's options on every page visit, preserving the current selection.
  const sel=document.getElementById('ts-cmp-select');
  if(sel){
    const v=sel.value;
    sel.innerHTML=_tsCompareOptionsHTML();
    if([...sel.options].some(o=>o.value===v))sel.value=v;
  }
}

// Assemble the vehicle/site/booster args the same way calculate() does, from the DOM.
function _tsCollectBase(){
  const fairingM=gv('fairing-mass');
  const fairingJ=parseInt(document.getElementById('fairing-jettison').value);
  const siteLat=gv('site-lat'),azMin=gv('az-min'),azMax=gv('az-max');
  const stages=[];
  for(let s=0;s<numStages;s++){
    const st={dry:gv(`s${s+1}_dry`),prop:gv(`s${s+1}_prop`),thrust:gv(`s${s+1}_thrust`),isp:gv(`s${s+1}_isp`)||1,res:gv(`s${s+1}_res`)};
    // S1.5 stage-and-a-half fields live in stageStore, NOT the standard DOM rows.
    // Carry them through (mirroring _tsVehicleToBase) so _tsExpandStages can
    // BECO-split the stage before lvPerformance/lvMaxPayload — the same HARD
    // INVARIANT calculateWithS15()/_fleetExpandStages honor. Dropping them made
    // the worksheet trade-study numbers diverge from the Orbits-page calculator
    // for every S1.5 vehicle (shipped-a-third-time S1.5 splitter bug).
    const sd=(typeof stageStore!=='undefined'&&stageStore[s])?stageStore[s]:null;
    stageCarryS15(st,sd);
    stages.push(st);
  }
  const boosterArg=useBooster?lvBoosterGroups():null;
  const parkingAlt=destMode==='orbit'?gv('parking-alt'):gv('escape-perigee');
  const payload=gv('payload-mass');
  return{fairingM,fairingJ,siteLat,azMin,azMax,stages,boosterArg,parkingAlt,payload};
}

// On-orbit ΔV for the CURRENT DOM target, replicated minimally for a circular orbit
// (matches the destIsCirc/destIsPark branch of calculate() when apogee≈perigee≈parking).
// Not valid for elliptical or escape targets — callers must not use this off that path.
function _tsOnOrbitDVCircular(parkingAlt,inc,siteLat){
  const rPk=RE+parkingAlt;
  const Vc=Math.sqrt(MU/rPk)*1000;
  const needsPlane=inc<Math.abs(siteLat)-0.5;
  if(!needsPlane)return 0;
  const planeAngle=(Math.abs(siteLat)-inc)*Math.PI/180;
  return 2*Vc*Math.sin(planeAngle/2);
}

const TS_VARS={
  destination:{label:'Destination',unit:'',from:0,to:0,dom:null},
  altitude:{label:'Parking Altitude',unit:'km',from:200,to:10000,dom:'parking-alt'},
  inclination:{label:'Inclination',unit:'deg',from:0,to:90,dom:'inclination'},
  payload:{label:'Payload Mass',unit:'kg',from:0,to:20000,dom:'payload-mass'},
  c3:{label:'Escape C3',unit:'km²/s²',from:0,to:120,dom:null},
  sensitivity:{label:'Sensitivity',unit:'',from:0,to:0,dom:null},
};

// On-orbit ΔV for an escape of characteristic energy c3 (km²/s²) from a circular
// parking orbit at parkingAlt (km). Term-for-term replica of the dest.mode==='escape'
// branch of destOnOrbitDV() (145-dest-dv.js) with decl defaulted to siteLat (as
// destOnOrbitDV does when dest.decl is omitted) — that default makes the plane-change
// term (ds=|siteLat|-|decl|-0.5) always negative, so it drops out here exactly as it
// does there. tests/run.js pins this against destOnOrbitDV for every escape
// destination in ORBIT_CATEGORIES at siteLat=that destination's own decl.
function _tsOnOrbitDVEscapeC3(c3,parkingAlt){
  const Vesc2=2*MU/(RE+parkingAlt);
  if(c3<-Vesc2)return {onOrbitDV:0,error:`C3=${c3} below minimum (${(-Vesc2).toFixed(1)}) for ${parkingAlt} km orbit`};
  const Vh=Math.sqrt(Vesc2+c3);
  const onOrbitDV=(Vh-Math.sqrt(MU/(RE+parkingAlt)))*1000;
  return {onOrbitDV};
}

// ── Metric selector (y-axis) ──────────────────
// Applies to numeric sweeps (altitude/inclination/payload), destination sweeps, and
// the sensitivity/tornado sweep. 'maxpay' and 'payfrac' are disabled on the payload
// sweep (x IS payload there — nonsensical) and auto-switch to 'margin'.
const TS_METRICS={
  maxpay:  {label:'Max Payload',unit:'kg',zeroLine:false},
  margin:  {label:'ΔV Margin',unit:'m/s',zeroLine:true},
  payfrac: {label:'Payload Fraction',unit:'%',zeroLine:false},
  tdv:     {label:'Total ΔV',unit:'m/s',zeroLine:false},
  tbt:     {label:'Total Burn Time',unit:'s',zeroLine:false},
  tw:      {label:'Liftoff T:W',unit:'',zeroLine:false},
};
const TS_METRIC_ORDER=['maxpay','margin','payfrac','tdv','tbt','tw'];

// Expand authored (source-level) stages into the virtual stage sequence lvPerformance/
// lvMaxPayload actually understand: a stage-and-a-half (s15) stage splits into its
// Phase 1 (booster pack, dry+prop_ph1 @ full thrust/isp) + Phase 2 (sustainer-only,
// dry_ph2+prop_ph2 @ sustainer thrust/isp), per _s15BecoSplit — mirroring
// calculateWithS15()/_fleetExpandStages() so trade-study numbers match the LV
// calculator and fleet views. Non-s15 stages pass through unchanged. Re-run on every
// evaluation (never cached) so perturbing an authored s15 field re-derives the split,
// which is the physically-correct behavior (the BECO point is a function of those fields).
// Thin wrapper over the ONE S1.5 expansion boundary (stageExpandS15,
// 140-physics.js). This used to silently fall back
// to the raw unsplit stage on a split error (under-modeling an invalid S1.5
// vehicle without any visible signal); now uses 'annotate' like the other
// callers, so a bad S1.5 config is flagged (`_err`) instead of hidden.
function _tsExpandStages(stages){
  return stageExpandS15(stages||[], { onError: 'annotate' });
}

// Compute the chosen metric for a base vehicle at a given payload + orbit params.
// onOrbitDV: fixed on-orbit ΔV to use (payload/altitude/inclination sweeps pass a
// shared or per-point value; destination sweep passes the per-destination r.onOrbitDV).
// base.stages holds AUTHORED (source-level) stages — s15 stages carry their raw
// isp/prop/thrust/s15_* fields, not a pre-expanded Ph.1/Ph.2 split (needed so the
// tornado sweep can perturb one authored field at a time). Expand here, per call,
// immediately before handing stages to the pure physics functions.
function _tsMetricAt(metric,base,payload,parkingAlt,onOrbitDV){
  const stages=_tsExpandStages(base.stages);
  if(metric==='maxpay'){
    const y=lvMaxPayload(stages,base.boosterArg,base.fairingM,base.fairingJ,parkingAlt,onOrbitDV,base.siteLat,base.azMin,base.azMax);
    return Number.isFinite(y)?y:0;
  }
  if(metric==='payfrac'){
    const maxPay=lvMaxPayload(stages,base.boosterArg,base.fairingM,base.fairingJ,parkingAlt,onOrbitDV,base.siteLat,base.azMin,base.azMax);
    if(!Number.isFinite(maxPay)||maxPay<=0)return 0;
    const r=lvPerformance(stages,base.boosterArg,maxPay,base.fairingM,base.fairingJ,parkingAlt,onOrbitDV,base.siteLat,base.azMin,base.azMax);
    return r.tMas>0?(maxPay/r.tMas)*100:0;
  }
  const r=lvPerformance(stages,base.boosterArg,payload,base.fairingM,base.fairingJ,parkingAlt,onOrbitDV,base.siteLat,base.azMin,base.azMax);
  if(metric==='margin')return Number.isFinite(r.margin)?r.margin:0;
  if(metric==='tdv')return Number.isFinite(r.tDV)?r.tDV:0;
  if(metric==='tbt')return Number.isFinite(r.tBT)?r.tBT:0;
  if(metric==='tw')return r.A0>0?r.A0/G0:0;
  return 0;
}

function _tsSelectedMetric(){
  return document.getElementById('ts-metric')?.value||'maxpay';
}

// Destination sweep: which destinations are enabled. Keyed by `${planet}::${name}`.
// Populated lazily on first render of the destination picker (Earth checked by default).
let _tsDestEnabled=null;

function _tsDestKey(planet,name){return planet+'::'+name;}

function _tsInitDestEnabled(){
  if(_tsDestEnabled)return;
  _tsDestEnabled=new Set();
  ORBIT_CATEGORIES.forEach(cat=>{
    if(cat.planet==='Earth'){
      cat.orbits.forEach(o=>_tsDestEnabled.add(_tsDestKey(cat.planet,o.name)));
    }
  });
}

function tsRenderForm(){
  const panel=document.getElementById('ts-panel');
  if(!panel)return;
  _tsInitDestEnabled();
  panel.innerHTML=`
    <div style="border:1px solid var(--border);padding:10px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;">
        <div>
          <div class="sl" style="margin-bottom:4px;">Sweep Variable</div>
          <select id="ts-var" onchange="tsOnVarChange()" style="font-family:var(--mono);font-size:11px;background:var(--panel);color:var(--text-bright);border:1px solid var(--border-bright);padding:5px 8px;">
            <option value="destination">Destination</option>
            <option value="altitude">Parking Altitude (km)</option>
            <option value="inclination">Inclination (deg)</option>
            <option value="payload">Payload Mass (kg)</option>
            <option value="c3">Escape C3 (km²/s²)</option>
            <option value="sensitivity">Sensitivity (tornado)</option>
          </select>
        </div>
        <div id="ts-metric-field">
          <div class="sl" style="margin-bottom:4px;">Metric</div>
          <select id="ts-metric" onchange="tsOnMetricChange()" style="font-family:var(--mono);font-size:11px;background:var(--panel);color:var(--text-bright);border:1px solid var(--border-bright);padding:5px 8px;">
            ${TS_METRIC_ORDER.map(k=>`<option value="${k}">${TS_METRICS[k].label}</option>`).join('')}
          </select>
        </div>
        <div id="ts-range-fields" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
          <div><div class="sl" style="margin-bottom:4px;">From</div><input id="ts-from" type="number" style="width:90px;font-family:var(--mono);font-size:11px;background:var(--panel);color:var(--text-bright);border:1px solid var(--border-bright);padding:5px 8px;"></div>
          <div><div class="sl" style="margin-bottom:4px;">To</div><input id="ts-to" type="number" style="width:90px;font-family:var(--mono);font-size:11px;background:var(--panel);color:var(--text-bright);border:1px solid var(--border-bright);padding:5px 8px;"></div>
          <div><div class="sl" style="margin-bottom:4px;">Steps</div><input id="ts-steps" type="number" value="20" min="2" max="60" style="width:70px;font-family:var(--mono);font-size:11px;background:var(--panel);color:var(--text-bright);border:1px solid var(--border-bright);padding:5px 8px;"></div>
        </div>
        <div id="ts-sens-fields" style="display:none;gap:8px;flex-wrap:wrap;align-items:flex-end;">
          <div>
            <div class="sl" style="margin-bottom:4px;">Vehicle</div>
            <select id="ts-sens-vehicle" style="font-family:var(--mono);font-size:11px;background:var(--panel);color:var(--text-bright);border:1px solid var(--border-bright);padding:5px 8px;max-width:220px;"></select>
          </div>
          <div><div class="sl" style="margin-bottom:4px;">Vary by ±%</div><input id="ts-sens-pct" type="number" value="10" min="1" max="90" style="width:70px;font-family:var(--mono);font-size:11px;background:var(--panel);color:var(--text-bright);border:1px solid var(--border-bright);padding:5px 8px;"></div>
        </div>
        <button class="act-btn green" onclick="tsRunSweep()">▶ Run Sweep</button>
        <button class="act-btn" id="ts-csv-btn" onclick="tsDownloadCSV()" disabled>Download CSV</button>
      </div>
      <div id="ts-dest-picker" style="display:none;border:1px solid var(--border);padding:8px 10px;margin-bottom:10px;max-height:220px;overflow:auto;"></div>
      <div style="border:1px solid var(--border);padding:8px 10px;margin-bottom:10px;">
        <div class="sl" style="margin-bottom:6px;">Compare Vehicles <span style="color:var(--text-dim);font-weight:normal;">(up to ${TS_MAX_COMPARE})</span></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
          <select id="ts-cmp-select" style="font-family:var(--mono);font-size:11px;background:var(--panel);color:var(--text-bright);border:1px solid var(--border-bright);padding:5px 8px;max-width:280px;">
            ${_tsCompareOptionsHTML()}
          </select>
          <button class="act-btn" onclick="tsAddCompareVehicle()">+ Add</button>
        </div>
        <div id="ts-cmp-chips" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
      </div>
      <div id="ts-error" style="color:var(--danger);font-family:var(--mono);font-size:10px;margin-bottom:8px;"></div>
      <div id="ts-note" style="color:var(--text-dim);font-family:var(--mono);font-size:10px;margin-bottom:8px;"></div>
      <div id="ts-progress" style="color:var(--text-dim);font-family:var(--mono);font-size:10px;margin-bottom:8px;"></div>
      <div class="ts-chart-card" id="ts-chart-wrap"></div>
      <div id="ts-table-wrap" style="margin-top:10px;max-height:280px;overflow:auto;"></div>
    </div>`;
  document.getElementById('ts-metric').value='maxpay';
  tsOnVarChange();
  tsRenderCompareChips();
}

function _tsDestPickerHTML(){
  let html='';
  ORBIT_CATEGORIES.forEach(cat=>{
    const rows=cat.orbits.map(o=>{
      const key=_tsDestKey(cat.planet,o.name);
      const checked=_tsDestEnabled.has(key)?'checked':'';
      return `<label style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;color:var(--text-bright);padding:2px 0;cursor:pointer;">
        <input type="checkbox" ${checked} onchange="tsToggleDest('${_tsEsc(key).replace(/'/g,"\\'")}',this.checked)">
        ${_tsEsc(o.name)} <span style="color:var(--text-dim);">${o.mode==='escape'?`C3=${o.c3}`:`${o.apogee}×${o.perigee} km, ${o.inc}°`}</span>
      </label>`;
    }).join('');
    html+=`<div style="margin-bottom:8px;">
      <div class="sl" style="margin-bottom:4px;">${cat.icon} ${_tsEsc(cat.planet)}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 12px;">${rows}</div>
    </div>`;
  });
  return html;
}

function tsToggleDest(key,on){
  if(!_tsDestEnabled)_tsInitDestEnabled();
  if(on)_tsDestEnabled.add(key);else _tsDestEnabled.delete(key);
}

// ── Vehicle comparison: selection UI ──────────

function _tsCompareOptionsHTML(){
  const opts=[`<option value="worksheet:0">[Worksheet] Current Vehicles-page vehicle</option>`];
  (typeof BUILTIN_PRESETS!=='undefined'?BUILTIN_PRESETS:[]).forEach((p,i)=>{
    opts.push(`<option value="builtin:${i}">[Preset] ${_tsEsc(p.name)}</option>`);
  });
  (typeof userLVs!=='undefined'?userLVs:[]).forEach((v,i)=>{
    opts.push(`<option value="user:${i}">[My Stuff] ${_tsEsc(v.name)}</option>`);
  });
  return opts.join('');
}

// Thin alias onto the canonical escaper.
function _tsEsc(s){return escHtml(s);}

function _tsWorksheetLabel(){return (typeof loadedVehicleName!=='undefined'&&loadedVehicleName)?loadedVehicleName:'Worksheet';}

function tsAddCompareVehicle(){
  const sel=document.getElementById('ts-cmp-select');
  if(!sel||!sel.value)return;
  if(_tsCompareVehicles.length>=TS_MAX_COMPARE){_tsSetError(`You can compare up to ${TS_MAX_COMPARE} vehicles.`);return;}
  const [kind,idxStr]=sel.value.split(':');
  const idx=parseInt(idxStr);
  if(kind==='worksheet'){
    if(_tsCompareVehicles.some(cv=>cv.kind==='worksheet'))return;
    _tsCompareVehicles.push({kind:'worksheet',idx:0,name:_tsWorksheetLabel()});
    tsRenderCompareChips();
    return;
  }
  const src=kind==='builtin'?BUILTIN_PRESETS[idx]:userLVs[idx];
  if(!src)return;
  // Avoid duplicate entries
  if(_tsCompareVehicles.some(cv=>cv.kind===kind&&cv.idx===idx))return;
  _tsCompareVehicles.push({kind,idx,name:src.name||'Unnamed'});
  tsRenderCompareChips();
}

// Resolve a CSS custom-property color reference (e.g. "var(--accent)") to a
// concrete hex/rgb string for use as an <input type="color"> value. Resolved
// lazily at render time (per spec) so theme changes are picked up naturally.
function _tsResolveCssColor(cssVal){
  if(!cssVal)return '#ffffff';
  if(!/^var\(/.test(cssVal))return cssVal;
  const m=/^var\((--[\w-]+)\)$/.exec(cssVal.trim());
  if(!m)return '#ffffff';
  const raw=getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
  return _tsColorToHex(raw)||'#ffffff';
}

// Best-effort convert an arbitrary CSS color (hex/rgb/rgba/named) to a #rrggbb
// hex string, since <input type="color"> only accepts that format.
function _tsColorToHex(raw){
  if(!raw)return null;
  if(/^#([0-9a-f]{6})$/i.test(raw))return raw;
  if(/^#([0-9a-f]{3})$/i.test(raw)){
    return '#'+raw.slice(1).split('').map(c=>c+c).join('');
  }
  const m=/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(raw);
  if(m){
    const toHex=n=>Math.max(0,Math.min(255,parseInt(n))).toString(16).padStart(2,'0');
    return '#'+toHex(m[1])+toHex(m[2])+toHex(m[3]);
  }
  // Fallback: let the browser resolve named colors via a throwaway element.
  try{
    const probe=document.createElement('span');
    probe.style.color=raw;
    document.body.appendChild(probe);
    const computed=getComputedStyle(probe).color;
    document.body.removeChild(probe);
    return _tsColorToHex(computed)||_tsRgbStringToHex(computed);
  }catch(_){return null;}
}
function _tsRgbStringToHex(s){
  const m=/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s||'');
  if(!m)return null;
  const toHex=n=>Math.max(0,Math.min(255,parseInt(n))).toString(16).padStart(2,'0');
  return '#'+toHex(m[1])+toHex(m[2])+toHex(m[3]);
}

// Return the chip's chosen color, resolving+caching the palette default lazily.
function _tsChipColor(cv,i){
  if(!cv.color)cv.color=_tsResolveCssColor(TS_SERIES_COLORS[i%TS_SERIES_COLORS.length]);
  return cv.color;
}

// User changed a chip's color swatch: store it, then re-render whatever's on
// screen from _tsResult WITHOUT re-running the sweep.
function tsSetCompareColor(i,hex){
  const cv=_tsCompareVehicles[i];
  if(!cv)return;
  cv.color=hex;
  tsRenderCompareChips();
  if(_tsResult&&_tsResult.series&&_tsResult.series[i]){
    _tsResult.series[i].color=hex;
    tsRenderChart(_tsResult);
    tsRenderTable(_tsResult);
  }
}

function tsRemoveCompareVehicle(i){
  _tsCompareVehicles.splice(i,1);
  tsRenderCompareChips();
}

function tsRenderCompareChips(){
  const wrap=document.getElementById('ts-cmp-chips');
  if(!wrap)return;
  let html='';
  _tsCompareVehicles.forEach((cv,i)=>{
    const color=_tsChipColor(cv,i);
    const label=cv.kind==='worksheet'?_tsWorksheetLabel():cv.name;
    html+=`<span style="display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10px;color:var(--text-bright);border:1px solid var(--border-bright);padding:3px 8px;">
      <input type="color" value="${color}" title="Series color" style="width:14px;height:14px;padding:0;border:none;background:none;cursor:pointer;" oninput="tsSetCompareColor(${i},this.value)">${_tsEsc(label)}
      <span style="cursor:pointer;color:var(--text-dim);" onclick="tsRemoveCompareVehicle(${i})">✕</span></span>`;
  });
  wrap.innerHTML=html||'<span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);">No vehicles selected.</span>';
  _tsRefreshSensVehicleOptions();
}

function _tsRefreshSensVehicleOptions(){
  const sel=document.getElementById('ts-sens-vehicle');
  if(!sel)return;
  const prev=sel.value;
  sel.innerHTML=_tsCompareVehicles.map((cv,i)=>{
    const label=cv.kind==='worksheet'?_tsWorksheetLabel():cv.name;
    return `<option value="${i}">${_tsEsc(label)}</option>`;
  }).join('')||'<option disabled>No vehicles selected</option>';
  if(prev!==''&&[...sel.options].some(o=>o.value===prev))sel.value=prev;
}

// Resolve a compare-list entry {kind,idx,name} to its base bundle. 'worksheet'
// reads live DOM at run time (per the spec — must not be cached at selection time).
function _tsResolveBase(cv){
  if(cv.kind==='worksheet')return _tsCollectBase();
  const src=cv.kind==='builtin'?BUILTIN_PRESETS[cv.idx]:userLVs[cv.idx];
  return src?_tsVehicleToBase(src):null;
}
function _tsResolveLabel(cv){return cv.kind==='worksheet'?_tsWorksheetLabel():cv.name;}

// Convert a saved/preset vehicle object (buildLVObject shape) into the same
// {fairingM,fairingJ,siteLat,azMin,azMax,stages,boosterArg,parkingAlt,payload} bundle
// _tsCollectBase() returns for the current DOM vehicle. Uses the vehicle's OWN
// stages/booster/fairing/site — but callers overlay the swept variable + shared
// orbit params so curves stay comparable (see tsRunSweep).
function _tsVehicleToBase(vehObj){
  const stages=resolvePresetStages(vehObj).map(sd=>stageCarryS15({dry:sd.dry,prop:sd.prop,thrust:sd.thrust,isp:sd.isp,res:sd.res??2},sd));
  // boosterGroups (array, Group 2+) takes precedence like the live-DOM assembler (lvBoosterGroups);
  // fall back to a single resolved boosterData/boosterName group.
  let boosterArg=null;
  if(Array.isArray(vehObj.boosterGroups)&&vehObj.boosterGroups.length){
    boosterArg=vehObj.boosterGroups.map(g=>({...g}));
  }else{
    const b=resolvePresetBooster(vehObj);
    if(b)boosterArg=[{...b}];
  }
  const fairingM=vehObj.fairingMass||0;
  const fairingJ=vehObj.fairingJettison||0;
  const site=vehObj.site||{};
  const siteLat=site.lat??28.5,azMin=site.azMin??37,azMax=site.azMax??112;
  const parkingAlt=vehObj.mode==='orbit'?(vehObj.parkingAlt??(vehObj.orbit?vehObj.orbit.perigee:400)):(vehObj.parkingAlt??(vehObj.escape?vehObj.escape.perigee:185));
  const payload=vehObj.payload||0;
  return{fairingM,fairingJ,siteLat,azMin,azMax,stages,boosterArg,parkingAlt,payload};
}

function tsOnVarChange(){
  const key=document.getElementById('ts-var')?.value||'destination';
  const v=TS_VARS[key];
  const isDest=key==='destination';
  const isSens=key==='sensitivity';
  const rangeEl=document.getElementById('ts-range-fields');
  const pickerEl=document.getElementById('ts-dest-picker');
  const sensEl=document.getElementById('ts-sens-fields');
  const metricSel=document.getElementById('ts-metric');
  if(rangeEl)rangeEl.style.display=(isDest||isSens)?'none':'flex';
  if(sensEl)sensEl.style.display=isSens?'flex':'none';
  if(isSens)_tsRefreshSensVehicleOptions();
  if(pickerEl){
    pickerEl.style.display=isDest?'block':'none';
    if(isDest){_tsInitDestEnabled();pickerEl.innerHTML=_tsDestPickerHTML();}
  }
  if(!isDest&&!isSens){
    const fromEl=document.getElementById('ts-from'),toEl=document.getElementById('ts-to');
    if(fromEl)fromEl.value=v.from;
    if(toEl)toEl.value=v.to;
  }
  // Payload sweep: maxpay/payfrac are nonsensical (x IS payload) — disable + auto-switch.
  if(metricSel){
    const maxOpt=metricSel.querySelector('option[value="maxpay"]');
    const fracOpt=metricSel.querySelector('option[value="payfrac"]');
    const disable=(key==='payload');
    if(maxOpt)maxOpt.disabled=disable;
    if(fracOpt)fracOpt.disabled=disable;
    const noteEl=document.getElementById('ts-note');
    if(disable&&(metricSel.value==='maxpay'||metricSel.value==='payfrac')){
      metricSel.value='margin';
      if(noteEl)noteEl.textContent='Max Payload / Payload Fraction are not meaningful on a payload-mass sweep (x is already payload) — switched to ΔV Margin.';
    }
  }
}

function tsOnMetricChange(){
  const key=document.getElementById('ts-var')?.value||'destination';
  const metricSel=document.getElementById('ts-metric');
  if(key==='payload'&&metricSel&&(metricSel.value==='maxpay'||metricSel.value==='payfrac')){
    _tsSetError('Max Payload / Payload Fraction are not meaningful on a payload-mass sweep.');
    metricSel.value='margin';
  }
}

function _tsSetError(msg){
  const el=document.getElementById('ts-error');
  if(el)el.textContent=msg||'';
}

function tsRunSweep(){
  _tsSetError('');
  const key=document.getElementById('ts-var')?.value||'destination';
  if(key==='destination'){tsRunDestinationSweep();return;}
  if(key==='sensitivity'){tsRunSensitivitySweep();return;}
  if(!_tsCompareVehicles.length){_tsSetError('Add at least one vehicle.');return;}
  const v=TS_VARS[key];
  const from=parseFloat(document.getElementById('ts-from')?.value);
  const to=parseFloat(document.getElementById('ts-to')?.value);
  const steps=parseInt(document.getElementById('ts-steps')?.value);
  if(!Number.isFinite(from)||!Number.isFinite(to)){_tsSetError('From/To must be numbers.');return;}
  if(from>=to){_tsSetError('From must be less than To.');return;}
  if(!Number.isFinite(steps)||steps<2||steps>60){_tsSetError('Steps must be an integer between 2 and 60.');return;}

  let metric=_tsSelectedMetric();
  if(key==='payload'&&(metric==='maxpay'||metric==='payfrac')){
    metric='margin';
    const metricSel=document.getElementById('ts-metric');
    if(metricSel)metricSel.value='margin';
  }
  const metricDef=TS_METRICS[metric];

  const seriesDefs=_tsCompareVehicles.map((cv,i)=>{
    const base=_tsResolveBase(cv);
    return base?{name:_tsResolveLabel(cv),base,color:_tsChipColor(cv,i)}:null;
  }).filter(Boolean);
  if(!seriesDefs.length){_tsSetError('Add at least one vehicle.');return;}

  const xs=[];
  for(let i=0;i<steps;i++)xs.push(from+(to-from)*i/(steps-1));

  const token=++_tsRunToken;
  const noteEl=document.getElementById('ts-note');
  const csvBtn=document.getElementById('ts-csv-btn');
  if(csvBtn)csvBtn.disabled=true;
  _tsResult=null;_tsChartView=null;_tsChartPan=null; // fresh sweep = fresh zoom

  let xLabel=v.label,xUnit=v.unit,yLabel=metricDef.label,yUnit=metricDef.unit,zeroLine=metricDef.zeroLine;

  if(key==='altitude'){
    if(noteEl)noteEl.textContent=`Varies: parking/target altitude (circular, apogee=perigee=parking). Metric: ${metricDef.label}. Holds constant: inclination, payload path, booster, all stage masses (per vehicle). Site latitude/azimuth is per-vehicle. On-orbit ΔV recomputed per point via the minimal circular-orbit plane-change formula (see 165-trade-study.js) — NOT calculate()\'s full elliptical logic.`;
  }else if(key==='inclination'){
    if(noteEl)noteEl.textContent=`Varies: target inclination at the shared sweep parking altitude (circular orbit assumed). Metric: ${metricDef.label}. Holds constant: parking altitude, booster, all stage masses (per vehicle). Site latitude/azimuth is per-vehicle. On-orbit ΔV = plane-change only, via the minimal circular-orbit formula — NOT calculate()\'s full elliptical logic.`;
  }else if(key==='c3'){
    if(noteEl)noteEl.textContent=`Varies: escape characteristic energy C3 (km²/s²) from each vehicle's own parking perigee/altitude. Metric: ${metricDef.label}. Holds constant: parking altitude, payload path, booster, all stage masses (per vehicle). On-orbit ΔV recomputed per point via ${'_tsOnOrbitDVEscapeC3'} (165-trade-study.js), a term-for-term replica of destOnOrbitDV()'s escape branch (145-dest-dv.js) at zero plane-change (decl=siteLat). C3 below the minimum reachable from the parking orbit shows a blank/zero value.`;
  }else{
    if(noteEl)noteEl.textContent=`Varies: payload mass. Metric: ${metricDef.label}. Holds constant: parking altitude, inclination (on-orbit ΔV taken from the last Calculate run for the current vehicle, or 0 if none — same fixed value applied to all compared vehicles for a fair x-axis), booster, all stage masses (per vehicle). Site latitude/azimuth is per-vehicle.`;
  }

  const fixedOnOrbitDV=(key==='payload')?((lastResult&&Number.isFinite(lastResult.onOrbitDV))?lastResult.onOrbitDV:0):null;
  const curInc=gv('inclination');
  // Shared parking altitude for the inclination sweep so all vehicles are compared at the same altitude.
  const sharedParkingAlt=seriesDefs[0].base.parkingAlt;

  const progEl=document.getElementById('ts-progress');
  const series=seriesDefs.map(sd=>({name:sd.name,points:[],color:sd.color}));
  let si=0,i=0;

  function chunk(){
    if(token!==_tsRunToken)return; // superseded by a newer run
    const sd=seriesDefs[si];
    const base=sd.base;
    const pts=series[si].points;
    const end=Math.min(i+5,xs.length);
    for(;i<end;i++){
      const x=xs[i];
      let y;
      if(key==='altitude'){
        const onOrbitDV=_tsOnOrbitDVCircular(x,curInc,base.siteLat);
        y=_tsMetricAt(metric,base,base.payload,x,onOrbitDV);
      }else if(key==='inclination'){
        const onOrbitDV=_tsOnOrbitDVCircular(sharedParkingAlt,x,base.siteLat);
        y=_tsMetricAt(metric,base,base.payload,sharedParkingAlt,onOrbitDV);
      }else if(key==='c3'){
        const r=_tsOnOrbitDVEscapeC3(x,sharedParkingAlt);
        y=r.error?0:_tsMetricAt(metric,base,base.payload,sharedParkingAlt,r.onOrbitDV);
      }else{
        y=_tsMetricAt(metric,base,x,base.parkingAlt,fixedOnOrbitDV);
      }
      pts.push({x,y:Number.isFinite(y)?y:0});
    }
    if(progEl)progEl.textContent=`computing ${sd.name} … ${i}/${xs.length}${seriesDefs.length>1?` (vehicle ${si+1}/${seriesDefs.length})`:''}`;
    if(i<xs.length){
      setTimeout(chunk,0);
    }else if(si<seriesDefs.length-1){
      si++;i=0;
      setTimeout(chunk,0);
    }else{
      if(progEl)progEl.textContent='';
      // Zero-clip capability curves (altitude/inclination, maxpay/payfrac metrics only —
      // these legitimately hit a hard zero; margin/tdv/tbt/tw are exempt, they may
      // legitimately go negative (margin) or don't have a "capability cliff" meaning).
      const clip=(key==='altitude'||key==='inclination'||key==='c3')&&(metric==='maxpay'||metric==='payfrac');
      _tsResult={xLabel,xUnit,yLabel,yUnit,zeroLine,series,type:'line',clip};
      tsRenderChart(_tsResult);
      tsRenderTable(_tsResult);
      if(csvBtn)csvBtn.disabled=false;
    }
  }
  chunk();
}

// ── Destination sweep (categorical x-axis, grouped bars) ──────────

function tsRunDestinationSweep(){
  _tsInitDestEnabled();
  const selected=[];
  ORBIT_CATEGORIES.forEach(cat=>{
    cat.orbits.forEach(o=>{
      if(_tsDestEnabled.has(_tsDestKey(cat.planet,o.name)))selected.push({planet:cat.planet,...o});
    });
  });
  if(!selected.length){_tsSetError('Select at least one destination.');return;}
  if(!_tsCompareVehicles.length){_tsSetError('Add at least one vehicle.');return;}

  const metric=_tsSelectedMetric();
  const metricDef=TS_METRICS[metric];

  const seriesDefs=_tsCompareVehicles.map((cv,i)=>{
    const base=_tsResolveBase(cv);
    return base?{name:_tsResolveLabel(cv),base,color:_tsChipColor(cv,i)}:null;
  }).filter(Boolean);
  if(!seriesDefs.length){_tsSetError('Add at least one vehicle.');return;}

  const token=++_tsRunToken;
  const noteEl=document.getElementById('ts-note');
  const csvBtn=document.getElementById('ts-csv-btn');
  if(csvBtn)csvBtn.disabled=true;
  _tsResult=null;_tsChartView=null;_tsChartPan=null; // fresh sweep = fresh zoom
  if(noteEl)noteEl.textContent=`Varies: destination (per ORBIT_CATEGORIES). Metric: ${metricDef.label} (margin/T:W/ΔV/burn-time metrics evaluated at each vehicle's current payload input). Holds constant: all stage masses, booster, fairing per vehicle. On-orbit ΔV per destination computed via the pinned pure destOnOrbitDV() (145-dest-dv.js) — same math as the main calculator. Impossible C3 (below escape minimum for the parking perigee) shows a blank/zero value.`;

  const progEl=document.getElementById('ts-progress');
  const series=seriesDefs.map(sd=>({name:sd.name,points:[],color:sd.color}));
  let si=0,i=0;

  function chunk(){
    if(token!==_tsRunToken)return;
    const sd=seriesDefs[si];
    const base=sd.base;
    const pts=series[si].points;
    const end=Math.min(i+3,selected.length);
    for(;i<end;i++){
      const dest=selected[i];
      const destArg=dest.mode==='escape'
        ?{mode:'escape',c3:dest.c3,decl:dest.decl,perigee:dest.parking!=null?dest.parking:(dest.perigee!=null?dest.perigee:185)}
        :{mode:'orbit',apogee:dest.apogee,perigee:dest.perigee,inc:dest.incTracksLat?base.siteLat:dest.inc,parkingAlt:dest.parking!=null?dest.parking:185};
      const r=destOnOrbitDV(destArg,base.siteLat);
      let y=0;
      if(!r.error){
        y=_tsMetricAt(metric,base,base.payload,r.parkingAlt,r.onOrbitDV);
        if(!Number.isFinite(y))y=0;
        if((metric==='maxpay'||metric==='payfrac')&&y<0)y=0;
      }
      pts.push({x:dest.name,y,planet:dest.planet,error:r.error||null});
    }
    if(progEl)progEl.textContent=`computing ${sd.name} … ${i}/${selected.length}${seriesDefs.length>1?` (vehicle ${si+1}/${seriesDefs.length})`:''}`;
    if(i<selected.length){
      setTimeout(chunk,0);
    }else if(si<seriesDefs.length-1){
      si++;i=0;
      setTimeout(chunk,0);
    }else{
      if(progEl)progEl.textContent='';
      const anyNonzero=series.some(s=>s.points.some(p=>!p.error&&p.y!==0));
      _tsResult={xLabel:'Destination',xUnit:'',yLabel:metricDef.label,yUnit:metricDef.unit,zeroLine:false,series,type:'bar',anyNonzero};
      tsRenderChart(_tsResult);
      tsRenderTable(_tsResult);
      if(csvBtn)csvBtn.disabled=false;
    }
  }
  chunk();
}

// ── Sensitivity / tornado sweep ──────────
// Single-vehicle: for each stage parameter (isp, dry, prop) and booster-group
// parameter (prop, thrust, isp) if present, evaluate the chosen metric at
// param*(1-p%) and param*(1+p%), holding everything else at baseline.

function _tsSensParamList(base){
  const params=[];
  base.stages.forEach((sd,i)=>{
    const label=`Stage ${i+1}`;
    params.push({label:`${label} Isp`,path:['stages',i,'isp']});
    params.push({label:`${label} Dry Mass`,path:['stages',i,'dry']});
    params.push({label:`${label} Propellant`,path:['stages',i,'prop']});
  });
  (base.boosterArg||[]).forEach((g,i)=>{
    const label=(base.boosterArg.length>1)?`Booster Group ${i+1}`:'Booster';
    params.push({label:`${label} Propellant`,path:['boosterArg',i,'prop']});
    params.push({label:`${label} Thrust`,path:['boosterArg',i,'thrust']});
    params.push({label:`${label} Isp`,path:['boosterArg',i,'isp']});
  });
  return params;
}

// Deep-clone base + apply a fractional multiplier at `path`, return the perturbed base.
function _tsPerturbBase(base,path,mult){
  const clone={...base,stages:base.stages.map(s=>({...s})),boosterArg:base.boosterArg?base.boosterArg.map(g=>({...g})):null};
  const [group,idx,field]=path;
  const target=clone[group][idx];
  target[field]=target[field]*mult;
  return clone;
}

function tsRunSensitivitySweep(){
  if(!_tsCompareVehicles.length){_tsSetError('Add at least one vehicle.');return;}
  const vIdx=parseInt(document.getElementById('ts-sens-vehicle')?.value);
  const cvIdx=Number.isFinite(vIdx)?vIdx:0;
  const cv=_tsCompareVehicles[cvIdx];
  if(!cv){_tsSetError('Add at least one vehicle.');return;}
  const base=_tsResolveBase(cv);
  if(!base){_tsSetError('Selected vehicle could not be resolved.');return;}
  const pct=parseFloat(document.getElementById('ts-sens-pct')?.value);
  if(!Number.isFinite(pct)||pct<=0||pct>=100){_tsSetError('Vary by ±% must be between 0 and 100.');return;}
  const metric=_tsSelectedMetric();
  const metricDef=TS_METRICS[metric];
  const p=pct/100;

  const params=_tsSensParamList(base);
  if(!params.length){_tsSetError('Selected vehicle has no stages to vary.');return;}

  const baselineY=_tsMetricAt(metric,base,base.payload,base.parkingAlt,
    (lastResult&&Number.isFinite(lastResult.onOrbitDV))?lastResult.onOrbitDV:0);

  const token=++_tsRunToken;
  const noteEl=document.getElementById('ts-note');
  const csvBtn=document.getElementById('ts-csv-btn');
  if(csvBtn)csvBtn.disabled=true;
  _tsResult=null;_tsChartView=null;_tsChartPan=null; // fresh sweep = fresh zoom
  if(noteEl)noteEl.textContent=`Sensitivity (tornado) for ${_tsEsc(_tsResolveLabel(cv))}. Metric: ${metricDef.label}. Each parameter varied independently by ±${pct}% around baseline; all others held at baseline (current payload input, on-orbit ΔV from the last Calculate run or 0).`;

  const progEl=document.getElementById('ts-progress');
  const rows=params.map(pr=>({param:pr.label,low:0,high:0}));
  const fixedOnOrbitDV=(lastResult&&Number.isFinite(lastResult.onOrbitDV))?lastResult.onOrbitDV:0;
  let i=0;

  function chunk(){
    if(token!==_tsRunToken)return;
    const end=Math.min(i+2,params.length);
    for(;i<end;i++){
      const pr=params[i];
      const lowBase=_tsPerturbBase(base,pr.path,1-p);
      const highBase=_tsPerturbBase(base,pr.path,1+p);
      const lowY=_tsMetricAt(metric,lowBase,lowBase.payload,lowBase.parkingAlt,fixedOnOrbitDV);
      const highY=_tsMetricAt(metric,highBase,highBase.payload,highBase.parkingAlt,fixedOnOrbitDV);
      rows[i].low=Number.isFinite(lowY)?lowY:0;
      rows[i].high=Number.isFinite(highY)?highY:0;
    }
    if(progEl)progEl.textContent=`computing ${i}/${params.length} parameters`;
    if(i<params.length){
      setTimeout(chunk,0);
    }else{
      if(progEl)progEl.textContent='';
      rows.forEach(r=>{r.swing=Math.abs(r.high-r.low);});
      rows.sort((a,b)=>b.swing-a.swing);
      _tsResult={type:'tornado',xLabel:'Parameter',xUnit:'',yLabel:metricDef.label,yUnit:metricDef.unit,baseline:baselineY,rows,vehicleName:_tsResolveLabel(cv),color:_tsChipColor(cv,cvIdx),pct};
      tsRenderChart(_tsResult);
      tsRenderTable(_tsResult);
      if(csvBtn)csvBtn.disabled=false;
    }
  }
  chunk();
}

function tsRenderTable(res){
  const wrap=document.getElementById('ts-table-wrap');
  if(!wrap)return;
  if(res.type==='tornado'){tsRenderTornadoTable(res);return;}
  const n=res.series.length;
  const maxLen=Math.max(...res.series.map(s=>s.points.length));
  let rows='';
  for(let r=0;r<maxLen;r++){
    const xVal=res.series[0].points[r]?res.series[0].points[r].x:null;
    let row=`<td style="padding:2px 8px;border-bottom:1px solid var(--border);">${xVal!=null?_tsFmtX(xVal):'—'}</td>`;
    res.series.forEach(s=>{
      const p=s.points[r];
      const cell=p?(p.error?'—':_tsFmt(p.y)):'—';
      row+=`<td style="padding:2px 8px;border-bottom:1px solid var(--border);" title="${p&&p.error?_tsEsc(p.error):''}">${cell}</td>`;
    });
    rows+=`<tr>${row}</tr>`;
  }
  const unitSuffix=res.yUnit?` (${res.yUnit})`:'';
  const headCols=res.series.map((s,i)=>`<th style="text-align:left;padding:2px 8px;color:${s.color||TS_SERIES_COLORS[i%TS_SERIES_COLORS.length]};border-bottom:1px solid var(--border-bright);">${_tsEsc(s.name)} — ${res.yLabel}${unitSuffix}</th>`).join('');
  const xUnitSuffix=res.xUnit?` (${res.xUnit})`:'';
  wrap.innerHTML=`<table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:9px;color:var(--text-bright);">
    <thead><tr><th style="text-align:left;padding:2px 8px;color:var(--text-dim);border-bottom:1px solid var(--border-bright);">${res.xLabel}${xUnitSuffix}</th>${headCols}</tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function tsRenderTornadoTable(res){
  const wrap=document.getElementById('ts-table-wrap');
  const unitSuffix=res.yUnit?` (${res.yUnit})`:'';
  const rows=res.rows.map(r=>`<tr>
    <td style="padding:2px 8px;border-bottom:1px solid var(--border);">${_tsEsc(r.param)}</td>
    <td style="padding:2px 8px;border-bottom:1px solid var(--border);">${_tsFmt(r.low)}</td>
    <td style="padding:2px 8px;border-bottom:1px solid var(--border);">${_tsFmt(res.baseline)}</td>
    <td style="padding:2px 8px;border-bottom:1px solid var(--border);">${_tsFmt(r.high)}</td>
    <td style="padding:2px 8px;border-bottom:1px solid var(--border);">${_tsFmt(r.swing)}</td>
  </tr>`).join('');
  wrap.innerHTML=`<table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:9px;color:var(--text-bright);">
    <thead><tr>
      <th style="text-align:left;padding:2px 8px;color:var(--text-dim);border-bottom:1px solid var(--border-bright);">Parameter</th>
      <th style="text-align:left;padding:2px 8px;color:var(--text-dim);border-bottom:1px solid var(--border-bright);">−${res.pct}%${unitSuffix}</th>
      <th style="text-align:left;padding:2px 8px;color:var(--text-dim);border-bottom:1px solid var(--border-bright);">Baseline${unitSuffix}</th>
      <th style="text-align:left;padding:2px 8px;color:var(--text-dim);border-bottom:1px solid var(--border-bright);">+${res.pct}%${unitSuffix}</th>
      <th style="text-align:left;padding:2px 8px;color:var(--text-dim);border-bottom:1px solid var(--border-bright);">Swing${unitSuffix}</th>
    </tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function _tsFmt(v){return Number.isFinite(v)?(Math.abs(v)>=1000?v.toLocaleString(undefined,{maximumFractionDigits:1}):v.toFixed(2)):'—';}
function _tsFmtX(v){return typeof v==='string'?_tsEsc(v):_tsFmt(v);}

function tsRenderChart(res){
  const wrap=document.getElementById('ts-chart-wrap');
  if(!wrap)return;
  if(res.type==='bar'){tsRenderBarChart(res);return;}
  if(res.type==='tornado'){tsRenderTornadoChart(res);return;}
  tsRenderLineChart(res);
}

// Zero-clip helper: for each series, walk points in order and stop at the last
// positive y; if the next point is <=0, linear-interpolate the x where y crosses 0
// and append a terminus marker point there instead of continuing the polyline flat.
function _tsClipSeriesAtZero(points){
  const clipped=[];
  let terminus=null;
  for(let i=0;i<points.length;i++){
    const p=points[i];
    if(p.y>0){
      clipped.push(p);
    }else{
      const prev=points[i-1];
      if(prev&&prev.y>0){
        const t=prev.y/(prev.y-p.y);
        const xz=prev.x+(p.x-prev.x)*t;
        terminus={x:xz,y:0};
      }
      break;
    }
  }
  return {clipped,terminus};
}

// Transient x-domain zoom/pan state for the line chart (user :
// "add zoom/scroll to the chart"). {x0,x1} in DATA units, or null = full
// extent. Cleared whenever a new sweep renders (tsRenderChart). Y auto-fits
// to the points visible in the zoomed window — that's the analysis win.
let _tsChartView=null;
let _tsChartPan=null;
function _tsChartResetView(){ _tsChartView=null; _tsChartPan=null; if(_tsResult) tsRenderChart(_tsResult); }

function tsRenderLineChart(res){
  const wrap=document.getElementById('ts-chart-wrap');
  // 1280-unit viewBox (was 960): the SVG scales to container width, so a
  // denser viewBox renders text/markers ~25% smaller on screen — user
  // feedback ("everything on it is a bit big"). Line strokes are
  // additionally non-scaling (true px) below.
  const W=1280,H=420,ML=70,MR=26,MT=18,MB=44;
  const plotW=W-ML-MR,plotH=H-MT-MB;

  // Build per-series render data: clipped points + optional zero-crossing terminus.
  const renderSeries=res.series.map(s=>{
    if(res.clip){
      const {clipped,terminus}=_tsClipSeriesAtZero(s.points);
      return {name:s.name,points:clipped,terminus,color:s.color};
    }
    return {name:s.name,points:s.points,terminus:null,color:s.color};
  });

  const allPts=res.series.flatMap(s=>s.points);
  const xs=allPts.map(p=>p.x),ys=allPts.map(p=>p.y);
  const xFull={min:Math.min(...xs),max:Math.max(...xs)};
  let xMin=xFull.min,xMax=xFull.max;
  const zoomed=!!_tsChartView;
  if(zoomed){ xMin=_tsChartView.x0; xMax=_tsChartView.x1; }
  // Y range: fit to the points inside the visible x-window (full-extent
  // behavior unchanged when not zoomed — same set of points).
  const visYs=allPts.filter(p=>p.x>=xMin&&p.x<=xMax).map(p=>p.y);
  let yMin=visYs.length?Math.min(...visYs):Math.min(...ys);
  let yMax=visYs.length?Math.max(...visYs):Math.max(...ys);
  if(res.zeroLine){yMin=Math.min(yMin,0);yMax=Math.max(yMax,0);}
  if(res.clip&&!zoomed)yMin=Math.min(yMin,0);
  if(xMin===xMax){xMin-=1;xMax+=1;}
  if(yMin===yMax){yMin-=1;yMax+=1;}
  const yPad=(yMax-yMin)*0.08||1;
  yMin-=yPad;yMax+=yPad;
  const xToPx=x=>ML+(x-xMin)/(xMax-xMin)*plotW;
  const yToPx=y=>MT+plotH-(y-yMin)/(yMax-yMin)*plotH;

  const nTicks=6;
  let xTicks='',yTicks='';
  for(let i=0;i<=nTicks;i++){
    const xv=xMin+(xMax-xMin)*i/nTicks;
    const px=xToPx(xv);
    xTicks+=`<line x1="${px}" y1="${MT}" x2="${px}" y2="${MT+plotH}" stroke="var(--border)" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`;
    xTicks+=`<text x="${px}" y="${MT+plotH+16}" font-size="9" fill="var(--text-dim)" text-anchor="middle" font-family="var(--mono)">${_tsFmt(xv)}</text>`;
  }
  for(let i=0;i<=nTicks;i++){
    const yv=yMin+(yMax-yMin)*i/nTicks;
    const py=yToPx(yv);
    yTicks+=`<line x1="${ML}" y1="${py}" x2="${ML+plotW}" y2="${py}" stroke="var(--border)" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`;
    yTicks+=`<text x="${ML-6}" y="${py+3}" font-size="9" fill="var(--text-dim)" text-anchor="end" font-family="var(--mono)">${_tsFmt(yv)}</text>`;
  }

  const zero=(res.zeroLine||res.clip)?`<line x1="${ML}" y1="${yToPx(0)}" x2="${ML+plotW}" y2="${yToPx(0)}" stroke="var(--border-bright)" stroke-width="1" stroke-dasharray="4,3" vector-effect="non-scaling-stroke"/>`:'';

  const polylines=renderSeries.map((s,i)=>{
    const color=s.color||TS_SERIES_COLORS[i%TS_SERIES_COLORS.length];
    const linePts=s.terminus?[...s.points,s.terminus]:s.points;
    const pts=linePts.map(p=>`${xToPx(p.x)},${yToPx(p.y)}`).join(' ');
    const line=`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    const dot=s.terminus?`<circle cx="${xToPx(s.terminus.x)}" cy="${yToPx(s.terminus.y)}" r="2.75" fill="var(--panel)" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke"/>`:'';
    return line+dot;
  }).join('');

  const legend=res.series.map((s,i)=>{
    const color=s.color||TS_SERIES_COLORS[i%TS_SERIES_COLORS.length];
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-right:14px;"><span style="width:10px;height:10px;background:${color};display:inline-block;"></span>${_tsEsc(s.name)}</span>`;
  }).join('');

  const zoomHint=zoomed
    ?`<button onclick="_tsChartResetView()" style="font-family:var(--mono);font-size:9px;background:var(--panel);color:var(--text-bright);border:1px solid var(--border-bright);padding:1px 6px;cursor:pointer;margin-left:10px;">⟲ reset zoom</button>`
    :`<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-left:10px;">wheel: zoom · drag: pan · dbl-click: reset</span>`;
  const svg=`<div style="margin-bottom:6px;">${legend}${zoomHint}</div>
  <svg id="ts-svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;" xmlns="http://www.w3.org/2000/svg">
    <defs><clipPath id="ts-plot-clip"><rect x="${ML}" y="${MT}" width="${plotW}" height="${plotH}"/></clipPath></defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
    ${xTicks}${yTicks}
    <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT+plotH}" stroke="var(--border-bright)" stroke-width="1"/>
    <line x1="${ML}" y1="${MT+plotH}" x2="${ML+plotW}" y2="${MT+plotH}" stroke="var(--border-bright)" stroke-width="1"/>
    <g clip-path="url(#ts-plot-clip)">
    ${zero}
    ${polylines}
    </g>
    <text x="${ML+plotW/2}" y="${H-4}" font-size="10" fill="var(--text-dim)" text-anchor="middle" font-family="var(--mono)">${res.xLabel} (${res.xUnit})</text>
    <text x="12" y="${MT+plotH/2}" font-size="10" fill="var(--text-dim)" text-anchor="middle" font-family="var(--mono)" transform="rotate(-90 12 ${MT+plotH/2})">${res.yLabel} (${res.yUnit})</text>
    <circle id="ts-hover-dot" r="2.75" fill="var(--text-bright)" style="display:none;"/>
  </svg>
  <div id="ts-hover-readout" style="font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-top:4px;height:14px;"></div>`;
  wrap.innerHTML=svg;

  const svgEl=document.getElementById('ts-svg');
  const dot=document.getElementById('ts-hover-dot');
  const readout=document.getElementById('ts-hover-readout');
  svgEl.addEventListener('mousemove',ev=>{
    const rect=svgEl.getBoundingClientRect();
    const px=(ev.clientX-rect.left)/rect.width*W;
    let nearest=null,nearestSeries=null,bestD=Infinity;
    res.series.forEach(s=>{
      s.points.forEach(p=>{
        const d=Math.abs(xToPx(p.x)-px);
        if(d<bestD){bestD=d;nearest=p;nearestSeries=s;}
      });
    });
    if(!nearest)return;
    dot.style.display='';
    dot.setAttribute('cx',xToPx(nearest.x));
    dot.setAttribute('cy',yToPx(nearest.y));
    readout.textContent=`${_tsEsc(nearestSeries.name)} — ${res.xLabel}: ${_tsFmt(nearest.x)} ${res.xUnit}   →   ${res.yLabel}: ${_tsFmt(nearest.y)} ${res.yUnit}`;
  });
  svgEl.addEventListener('mouseleave',()=>{dot.style.display='none';readout.textContent='';});

  // ── zoom / pan (x-domain; y auto-fits on re-render) ────────────────────────
  const fullSpan=xFull.max-xFull.min||1;
  const clampView=v=>{
    const minSpan=fullSpan/200;
    let span=Math.max(minSpan,Math.min(fullSpan,v.x1-v.x0));
    let x0=Math.max(xFull.min,Math.min(v.x0,xFull.max-span));
    return {x0,x1:x0+span};
  };
  const pxToX=px=>xMin+(px-ML)/plotW*(xMax-xMin);
  svgEl.addEventListener('wheel',ev=>{
    ev.preventDefault();
    const rect=svgEl.getBoundingClientRect();
    const px=(ev.clientX-rect.left)/rect.width*W;
    const cx=pxToX(Math.max(ML,Math.min(ML+plotW,px)));
    const f=ev.deltaY>0?1.18:1/1.18;
    const nx0=cx-(cx-xMin)*f, nx1=cx+(xMax-cx)*f;
    const v=clampView({x0:nx0,x1:nx1});
    _tsChartView=(v.x1-v.x0)>=fullSpan*0.999?null:v;   // fully zoomed out = reset
    tsRenderChart(res);
  },{passive:false});
  // Pan state is MODULE-level (_tsChartPan), not a closure var: each pan step
  // re-renders the chart, replacing this svg element and its listeners — a
  // closure var would orphan the drag after the first step. The freshly
  // rendered instance picks the drag up from the shared state instead.
  svgEl.addEventListener('mousedown',ev=>{ _tsChartPan={px:ev.clientX,x0:xMin,x1:xMax}; });
  svgEl.addEventListener('mousemove',ev=>{
    if(!_tsChartPan)return;
    if(!(ev.buttons&1)){_tsChartPan=null;return;}
    if(Math.abs(ev.clientX-_tsChartPan.px)<3)return;  // dead zone: keep plain clicks cheap
    const rect=svgEl.getBoundingClientRect();
    const dx=(ev.clientX-_tsChartPan.px)/rect.width*W/plotW*(_tsChartPan.x1-_tsChartPan.x0);
    const v=clampView({x0:_tsChartPan.x0-dx,x1:_tsChartPan.x1-dx});
    _tsChartView=(v.x1-v.x0)>=fullSpan*0.999&&v.x0<=xFull.min?null:v;
    _tsChartPan={px:ev.clientX,x0:v.x0,x1:v.x1};
    tsRenderChart(res);
  });
  svgEl.addEventListener('mouseup',()=>{_tsChartPan=null;});
  svgEl.addEventListener('dblclick',()=>{_tsChartResetView();});
}

// Grouped-bar chart for the Destination sweep. Linear y-axis with a per-bar value
// label (log scale would be nicer for the LEO→C3 span but adds tick complexity;
// labels keep small bars legible without it).
function tsRenderBarChart(res){
  const wrap=document.getElementById('ts-chart-wrap');
  if(!res.anyNonzero){
    wrap.innerHTML=`<div style="font-family:var(--mono);font-size:11px;color:var(--text-dim);padding:24px;text-align:center;border:1px dashed var(--border);">No capability at these destinations — every compared vehicle returns zero for this metric (ΔV insufficient or destination C3 unreachable). Try fewer/closer destinations, a different metric, or a bigger vehicle.</div>`;
    return;
  }
  const W=960,H=380,ML=70,MR=24,MT=16,MB=90;
  const plotW=W-ML-MR,plotH=H-MT-MB;
  const dests=res.series[0].points.map(p=>p.x);
  const nGroups=dests.length;
  const nSeries=res.series.length;
  let yMin=0,yMax=0;
  res.series.forEach(s=>s.points.forEach(p=>{if(p.y>yMax)yMax=p.y;if(p.y<yMin)yMin=p.y;}));
  if(yMax<=0&&yMin>=0)yMax=1;
  const range=(yMax-yMin)||1;
  yMax+=range*0.15; if(yMin<0)yMin-=range*0.05;
  const yToPx=y=>MT+plotH-(y-yMin)/(yMax-yMin)*plotH;
  const zeroPx=yToPx(0);

  const groupW=plotW/nGroups;
  const barPad=groupW*0.12;
  const barsAreaW=groupW-2*barPad;
  const barW=barsAreaW/nSeries;

  const nTicks=6;
  let yTicks='';
  for(let i=0;i<=nTicks;i++){
    const yv=yMin+(yMax-yMin)*i/nTicks;
    const py=yToPx(yv);
    yTicks+=`<line x1="${ML}" y1="${py}" x2="${ML+plotW}" y2="${py}" stroke="var(--border)" stroke-width="1"/>`;
    yTicks+=`<text x="${ML-6}" y="${py+3}" font-size="9" fill="var(--text-dim)" text-anchor="end" font-family="var(--mono)">${_tsFmt(yv)}</text>`;
  }

  let bars='',xLabels='';
  for(let g=0;g<nGroups;g++){
    const gx=ML+g*groupW;
    xLabels+=`<text x="${gx+groupW/2}" y="${MT+plotH+14}" font-size="9" fill="var(--text-dim)" text-anchor="end" font-family="var(--mono)" transform="rotate(-40 ${gx+groupW/2} ${MT+plotH+14})">${_tsEsc(String(dests[g]).length>16?String(dests[g]).slice(0,15)+'…':dests[g])}</text>`;
    for(let si=0;si<nSeries;si++){
      const p=res.series[si].points[g];
      const color=res.series[si].color||TS_SERIES_COLORS[si%TS_SERIES_COLORS.length];
      const bx=gx+barPad+si*barW;
      const by=Math.min(yToPx(p.y),zeroPx);
      const bh=Math.abs(yToPx(p.y)-zeroPx);
      const title=p.error?_tsEsc(p.error):`${_tsEsc(res.series[si].name)}: ${_tsFmt(p.y)} ${res.yUnit||''}`;
      bars+=`<g><title>${title}</title><rect x="${bx}" y="${by}" width="${Math.max(barW-1.5,0.5)}" height="${Math.max(bh,0)}" fill="${color}"/>
        ${p.y!==0?`<text x="${bx+barW/2+3}" y="${by-4}" font-size="8" fill="var(--text-dim)" text-anchor="start" font-family="var(--mono)" transform="rotate(-90 ${bx+barW/2+3} ${by-4})">${_tsFmt(p.y)}</text>`:''}</g>`;
    }
  }

  const legend=res.series.map((s,i)=>{
    const color=s.color||TS_SERIES_COLORS[i%TS_SERIES_COLORS.length];
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10px;color:var(--text-bright);margin-right:14px;"><span style="width:10px;height:10px;background:${color};display:inline-block;"></span>${_tsEsc(s.name)}</span>`;
  }).join('');

  const svg=`<div style="margin-bottom:6px;">${legend}</div>
  <svg id="ts-svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
    ${yTicks}
    <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT+plotH}" stroke="var(--border-bright)" stroke-width="1"/>
    <line x1="${ML}" y1="${zeroPx}" x2="${ML+plotW}" y2="${zeroPx}" stroke="var(--border-bright)" stroke-width="1"/>
    ${bars}
    ${xLabels}
    <text x="12" y="${MT+plotH/2}" font-size="10" fill="var(--text-dim)" text-anchor="middle" font-family="var(--mono)" transform="rotate(-90 12 ${MT+plotH/2})">${res.yLabel} (${res.yUnit})</text>
  </svg>`;
  wrap.innerHTML=svg;
}

// Horizontal tornado chart for the Sensitivity sweep. One bar per parameter,
// sorted by |high-low| descending, spanning low->high around a baseline vertical line.
function tsRenderTornadoChart(res){
  const wrap=document.getElementById('ts-chart-wrap');
  const rows=res.rows;
  const rowH=26,padTop=16,padBot=40,ML=200,MR=30;
  const H=padTop+padBot+rowH*rows.length;
  const W=960;
  const plotW=W-ML-MR,plotH=H-padTop-padBot;

  let xMin=Math.min(res.baseline,...rows.map(r=>Math.min(r.low,r.high)));
  let xMax=Math.max(res.baseline,...rows.map(r=>Math.max(r.low,r.high)));
  if(xMin===xMax){xMin-=1;xMax+=1;}
  const xPad=(xMax-xMin)*0.08||1;
  xMin-=xPad;xMax+=xPad;
  const xToPx=x=>ML+(x-xMin)/(xMax-xMin)*plotW;

  const nTicks=6;
  let xTicks='';
  for(let i=0;i<=nTicks;i++){
    const xv=xMin+(xMax-xMin)*i/nTicks;
    const px=xToPx(xv);
    xTicks+=`<line x1="${px}" y1="${padTop}" x2="${px}" y2="${padTop+plotH}" stroke="var(--border)" stroke-width="1"/>`;
    xTicks+=`<text x="${px}" y="${padTop+plotH+16}" font-size="9" fill="var(--text-dim)" text-anchor="middle" font-family="var(--mono)">${_tsFmt(xv)}</text>`;
  }

  const baselinePx=xToPx(res.baseline);
  const baselineLine=`<line x1="${baselinePx}" y1="${padTop}" x2="${baselinePx}" y2="${padTop+plotH}" stroke="var(--border-bright)" stroke-width="1.5" stroke-dasharray="4,3"/>`;

  let bars='',labels='';
  rows.forEach((r,i)=>{
    const cy=padTop+i*rowH+rowH/2;
    const bh=rowH*0.55;
    const lowPx=xToPx(Math.min(r.low,r.high)), highPx=xToPx(Math.max(r.low,r.high));
    const color=res.color||TS_SERIES_COLORS[0];
    const title=`${_tsEsc(r.param)}: −${res.pct}%=${_tsFmt(r.low)}, baseline=${_tsFmt(res.baseline)}, +${res.pct}%=${_tsFmt(r.high)}`;
    bars+=`<g><title>${title}</title><rect x="${lowPx}" y="${cy-bh/2}" width="${Math.max(highPx-lowPx,0.5)}" height="${bh}" fill="${color}" opacity="0.85"/></g>`;
    labels+=`<text x="${ML-8}" y="${cy+3}" font-size="9" fill="var(--text-bright)" text-anchor="end" font-family="var(--mono)">${_tsEsc(r.param)}</text>`;
  });

  const svg=`<svg id="ts-svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
    ${xTicks}
    <line x1="${ML}" y1="${padTop}" x2="${ML}" y2="${padTop+plotH}" stroke="var(--border-bright)" stroke-width="1"/>
    ${baselineLine}
    ${bars}
    ${labels}
    <text x="${ML+plotW/2}" y="${H-4}" font-size="10" fill="var(--text-dim)" text-anchor="middle" font-family="var(--mono)">${res.yLabel} (${res.yUnit})</text>
  </svg>
  <div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-top:6px;">each parameter varied independently; all others at baseline.</div>`;
  wrap.innerHTML=svg;
}

function tsDownloadCSV(){
  if(!_tsResult){showAlert('Run a sweep first.','No Data');return;}
  if(_tsResult.type==='tornado'){
    const unitSuffix=_tsResult.yUnit?` (${_tsResult.yUnit})`:'';
    const header=['Parameter',`-${_tsResult.pct}%${unitSuffix}`,`Baseline${unitSuffix}`,`+${_tsResult.pct}%${unitSuffix}`,`Swing${unitSuffix}`];
    const lines=[header.join(',')];
    _tsResult.rows.forEach(r=>{
      lines.push([`"${r.param.replace(/"/g,'""')}"`,r.low,_tsResult.baseline,r.high,r.swing].join(','));
    });
    const blob=new Blob([lines.join('\n')],{type:'text/csv'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='trade_study_tornado.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  const seriesNames=_tsResult.series.map(s=>s.name.replace(/"/g,'""'));
  const header=[`${_tsResult.xLabel} (${_tsResult.xUnit})`,...seriesNames.map(n=>`"${n}" — ${_tsResult.yLabel} (${_tsResult.yUnit})`)];
  const lines=[header.join(',')];
  const maxLen=Math.max(...(_tsResult.series.map(s=>s.points.length)));
  for(let r=0;r<maxLen;r++){
    const xRaw=_tsResult.series[0].points[r]?_tsResult.series[0].points[r].x:'';
    const x=typeof xRaw==='string'?`"${xRaw.replace(/"/g,'""')}"`:xRaw;
    const row=[x,...(_tsResult.series.map(s=>s.points[r]?s.points[r].y:''))];
    lines.push(row.join(','));
  }
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='trade_study.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
