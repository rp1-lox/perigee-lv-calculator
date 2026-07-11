
// ─── PHYSICS ──────────────────────────────────
function circVel(alt){return Math.sqrt(MU/(RE+alt))*1000;}
function rotVel(lat,azMin,azMax){
  const Vm=OMEGA_E*RE*1000*Math.cos(lat*Math.PI/180);
  let best=0;[azMin,azMax,90].forEach(az=>{const c=Vm*Math.cos((az-90)*Math.PI/180);if(c>best)best=c;});
  return Math.max(0,Math.min(best,Vm));
}
function rocketEq(isp,m0,mf){return(mf<=0||m0<=mf)?0:G0*isp*Math.log(m0/mf);}

// Parse editable stage quantities without eval. Supports decimal numbers,
// scientific notation, parentheses, unary signs, and + - * /.
function parseMathExpression(value){
  const src=String(value??'').trim();
  if(!src)return NaN;
  let pos=0;
  const ws=()=>{while(/\s/.test(src[pos]||''))pos++;};
  const expression=()=>{
    let value=term();ws();
    while(src[pos]==='+'||src[pos]==='-'){
      const op=src[pos++],right=term();
      value=op==='+'?value+right:value-right;ws();
    }
    return value;
  };
  const term=()=>{
    let value=unary();ws();
    while(src[pos]==='*'||src[pos]==='/'){
      const op=src[pos++],right=unary();
      value=op==='*'?value*right:value/right;ws();
    }
    return value;
  };
  const unary=()=>{
    ws();
    if(src[pos]==='+'){pos++;return unary();}
    if(src[pos]==='-'){pos++;return -unary();}
    return primary();
  };
  const primary=()=>{
    ws();
    if(src[pos]==='('){
      pos++;const value=expression();ws();
      if(src[pos]!==')')throw new Error('Missing closing parenthesis');
      pos++;return value;
    }
    const match=src.slice(pos).match(/^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/);
    if(!match)throw new Error('Expected a number');
    pos+=match[0].length;return Number(match[0]);
  };
  try{
    const result=expression();ws();
    return pos===src.length&&Number.isFinite(result)?result:NaN;
  }catch(_){return NaN;}
}
function mathValue(value,fallback=0){const result=parseMathExpression(value);return Number.isFinite(result)?result:fallback;}
function commitMathInput(input){
  const result=input.value.trim()===''?0:parseMathExpression(input.value);
  const valid=Number.isFinite(result)&&result>=0;
  input.setCustomValidity(valid?'':'Enter a non-negative calculation using +, -, *, /, and parentheses.');
  if(valid)input.value=String(result);
  return valid;
}
function gv(id){return mathValue(document.getElementById(id)?.value,0);}
// R3.2: optional numeric read — blank input means "unauthored" (null), not 0.
// Used for lan_deg/argp_deg fields where absence is a meaningful third state.
function gvOpt(id){
  const el=document.getElementById(id);
  if(!el)return null;
  const raw=(el.value??'').trim();
  if(raw==='')return null;
  const r=parseMathExpression(raw);
  return Number.isFinite(r)?r:null;
}

// ── Shared launch performance (Townsend-Schilling) — single source of truth for
//    BOTH the LV calculator (evalAtPayload) and the Program/mission launch. Pure: no
//    DOM. stages = [{dry,prop,thrust,isp,res}] bottom→top; booster =
//    {dry,prop,thrust,isp,res,count} or null. Masses kg, thrust kN, Isp s, res %.
//    Ta (ascent time feeding the penalty) = burn time only up to circular velocity,
//    so low-thrust upper stages aren't over-charged for gravity/drag losses.
function lvPerformance(stages, booster, pay, fairingMass, fairingJ, parkingAlt, onOrbitDV, siteLat, azMin, azMax){
  const n=stages.length;
  // boosters: accept a single legacy group OR an array of groups (multiple kinds + air-lit).
  // each group: {dry,prop,thrust,isp,res,count, parallelMode, coreThrottle, ignition}
  //   ignition: 'ground' (T-0) | {after:i} (light when group i burns out) | {atTime:s}
  const _groups = Array.isArray(booster) ? booster.filter(Boolean) : (booster ? [booster] : []);
  const Vcirc=circVel(parkingAlt), Vrot=rotVel(siteLat,azMin,azMax), Hp=parkingAlt;
  const K3=429.9+1.602*Hp+1.224e-3*Hp*Hp, K4=2.328-9.687e-4*Hp;
  // liftoff throttle: if a ground-lit booster group throttles the first stage from T-0, the
  // first stage's liftoff thrust is reduced accordingly (so launch T:W reflects the throttle).
  let liftoffF=1;
  _groups.forEach(g=>{ if((g.ignition||'ground')==='ground' && g.parallelMode==='throttle'){ const cf=Math.min(1,Math.max(0.1,g.coreThrottle||1)); if(cf<liftoffF) liftoffF=cf; } });
  let tThr=(stages[0]?stages[0].thrust:0)*1000*liftoffF;
  _groups.forEach(g=>{ if((g.ignition||'ground')==='ground') tThr+=g.thrust*1000*(g.count||1); });  // ground-lit boosters at full
  const spM=new Array(n).fill(0); let abv=pay;
  for(let s=n-1;s>=0;s--){spM[s]=abv+((fairingJ>0&&s<fairingJ)?fairingMass:0);abv+=stages[s].dry+stages[s].prop;}
  const sDVs=[],sBTs=[]; let tDV=0,tBT=0;
  for(let s=0;s<n;s++){
    const sd=stages[s],up=sd.prop*(1-(sd.res||0)/100),pa=spM[s];
    const m0=sd.dry+up+pa,mf=sd.dry+pa;
    if(m0<=0||mf<=0||m0<=mf){sDVs.push(0);sBTs.push(0);continue;}
    const dv=rocketEq(sd.isp,m0,mf),mflow=(sd.thrust*1000)/(G0*sd.isp),bt=mflow>0?up/mflow:0;
    sDVs.push(dv);sBTs.push(bt);tDV+=dv;tBT+=bt;
  }
  if(_groups.length){
    // Event-driven parallel-ascent integrator for the first stage + every booster group.
    // Generalises the old single-group boost phase: between events the active engine set is
    // fixed, so ΔV over each interval is one rocket-equation step at the blended Isp. Per-group
    // parallelMode is honoured — 'crossfeed' feeds the first stage (its tanks preserved),
    // 'throttle' throttles the first stage while that group burns. Groups ignite at T-0
    // ('ground'), when a predecessor burns out ({after:i}), or at {atTime:s}. Spent groups drop.
    // Reduces EXACTLY to the old block for a single ground-lit group (validated).
    const s1=stages[0], pa0=spM[0];
    const mfS1=s1.thrust*1000, mdotC0=mfS1/G0/s1.isp;
    const G=_groups.map((g,i)=>{ const nn=g.count||1; const md=g.parallelMode||'independent';
      return { i, mode:md, f:(md==='throttle')?Math.min(1,Math.max(0.1,g.coreThrottle||1)):1,
        thr:g.thrust*1000*nn, mdot:(g.thrust*1000*nn)/G0/g.isp, prop:g.prop*(1-(g.res||0)/100)*nn,
        dryDrop:g.dry*nn, ign:g.ignition||'ground',
        status:((g.ignition||'ground')==='ground')?'active':'pending' }; });
    let coreProp=s1.prop*(1-(s1.res||0)/100);
    let m=s1.dry+s1.prop+pa0+_groups.reduce((a,g)=>a+(g.dry+g.prop)*(g.count||1),0);
    let dv0=0,t0=0,guard=0;
    while(guard++<500){
      const act=G.filter(g=>g.status==='active'&&g.prop>1e-6);
      const xf=act.filter(g=>g.mode==='crossfeed'), thg=act.filter(g=>g.mode==='throttle');
      const f=thg.length?Math.min(...thg.map(g=>g.f)):1;
      const coreActive=coreProp>1e-6;
      const coreMdot=coreActive?f*mdotC0:0, coreThr=coreActive?f*mfS1:0;
      const coreFed=coreActive&&xf.length>0, coreTankDrain=coreFed?0:coreMdot;
      const per=(coreFed&&xf.length)?coreMdot/xf.length:0;
      act.forEach(g=>{ g._drain=g.mdot+(g.mode==='crossfeed'?per:0); });
      const massOut=coreMdot+act.reduce((a,g)=>a+g.mdot,0);   // total propellant leaving the vehicle
      const totThr=coreThr+act.reduce((a,g)=>a+g.thr,0);
      if(massOut<=1e-9)break;
      let dt=Infinity,ev=null;
      if(!coreFed&&coreActive&&coreTankDrain>0){ const te=coreProp/coreTankDrain; if(te<dt){dt=te;ev=['coreEmpty',null];} }
      act.forEach(g=>{ const te=g.prop/g._drain; if(te<dt){dt=te;ev=['groupEmpty',g];} });
      G.forEach(g=>{ if(g.status==='pending'&&g.ign&&g.ign.atTime!=null){ const tt=g.ign.atTime-t0; if(tt>1e-9&&tt<dt){dt=tt;ev=['ignite',g];} } });
      if(!isFinite(dt)||dt<=0)break;
      const ieff=totThr/(massOut*G0), mEnd=m-massOut*dt;
      dv0+=ieff*G0*Math.log(m/Math.max(mEnd,1)); m=mEnd; t0+=dt;
      if(!coreFed&&coreActive)coreProp-=coreTankDrain*dt;
      act.forEach(g=>g.prop-=g._drain*dt);
      if(ev&&ev[0]==='groupEmpty'){ ev[1].status='spent'; ev[1].prop=0; m-=ev[1].dryDrop;
        G.forEach(g=>{ if(g.status==='pending'&&g.ign&&g.ign.after===ev[1].i)g.status='active'; }); }
      else if(ev&&ev[0]==='ignite')ev[1].status='active';
      else if(ev&&ev[0]==='coreEmpty')coreProp=0;
      G.forEach(g=>{ if(g.status==='pending'&&g.ign&&g.ign.atTime!=null&&t0>=g.ign.atTime-1e-9)g.status='active'; });
      const anyActive=G.some(g=>g.status==='active'&&g.prop>1e-6);
      if(coreProp<=1e-6&&!anyActive)break;
    }
    sDVs[0]=dv0;sBTs[0]=t0;
    tDV=sDVs.reduce((a,b)=>a+b,0);tBT=sBTs.reduce((a,b)=>a+b,0);
  }
  const tMas=stages.reduce((a,s)=>a+s.dry+s.prop,0)+pay+fairingMass+_groups.reduce((a,g)=>a+(g.dry+g.prop)*(g.count||1),0);
  const A0=tThr/Math.max(tMas,1);
  const avgIsp=sBTs.reduce((a,bt,i)=>a+stages[i].isp*bt,0)/Math.max(tBT,1);
  const T3s=3*(1-Math.exp(-0.333*Vcirc/(G0*avgIsp)))*G0*avgIsp/Math.max(A0,0.01);
  // Ta = burn time to reach circular velocity (not the full burn of every stage)
  let Ta=0,cum=0;
  for(let s=0;s<n;s++){const dv=sDVs[s],bt=sBTs[s];if(dv<=0)continue;
    if(cum+dv>=Vcirc){const need=Vcirc-cum,isp=stages[s].isp||1;
      const fr=(1-Math.exp(-need/(G0*isp)))/Math.max(1e-9,1-Math.exp(-dv/(G0*isp)));
      Ta+=bt*Math.min(1,Math.max(0,fr));cum=Vcirc;break;}
    Ta+=bt;cum+=dv;}
  if(cum<Vcirc)Ta=tBT;
  const Tmix=0.405*Ta+0.595*T3s, DVpen=K3+K4*Tmix;
  const DVasc=Vcirc+DVpen-Vrot, DVtot=DVasc+(onOrbitDV||0), margin=tDV-DVtot;
  return{sDVs,sBTs,tDV,tBT,Ta,Tmix,DVpen,DVasc,DVtot,margin,tMas,A0,avgIsp,Vcirc,Vrot};
}

// Max payload (kg) a vehicle can deliver — binary-search lvPerformance for the
// payload where ΔV margin hits zero. Single source of truth for BOTH the LV
// calculator's "Est. Max Payload" and the Program's launch capacity.
function lvMaxPayload(stages, booster, fairingMass, fairingJ, parkingAlt, onOrbitDV, siteLat, azMin, azMax){
  const marginAt = pay => lvPerformance(stages, booster, pay, fairingMass, fairingJ, parkingAlt, onOrbitDV, siteLat, azMin, azMax).margin;
  if (marginAt(0) < 0) return 0;
  let lo = 0, hi = 2000000;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (marginAt(mid) > 0) lo = mid; else hi = mid; if (hi - lo < 1) break; }
  return lo;
}

// Read the booster parallel-staging mode from the DOM (crossfeed / center-throttle / none).
// coreThrottle is stored as a 0–1 fraction (the input is a percent).
function boosterModeFromDOM(){
  const mode=(document.getElementById('b_parallel_mode')?.value)||'independent';
  const thr=parseFloat(document.getElementById('b_core_throttle')?.value);
  return {parallelMode:mode, coreThrottle:(isFinite(thr)?thr/100:0.57)};
}

// The full booster-group list for lvPerformance/lvMaxPayload: the primary group (the booster
// inputs, always ground-lit) + any additional groups in _extraBoosterGroups. [] when off.
function lvBoosterGroups(){
  if(!useBooster) return [];
  const g0={ dry:gv('b_dry'), prop:gv('b_prop'), thrust:gv('b_thrust'),
    isp:parseFloat(document.getElementById('b_isp')?.value)||1, res:gv('b_res'),
    count:parseInt(document.getElementById('num-boosters')?.value)||0, ignition:'ground',
    ...boosterModeFromDOM() };
  const extra=(typeof _extraBoosterGroups!=='undefined'&&Array.isArray(_extraBoosterGroups))?_extraBoosterGroups:[];
  return [g0, ...extra.map(g=>({...g}))];
}

function collectVehicle(){
  saveStoreFromDOM();
  const stages=[];
  for(let s=0;s<numStages;s++){
    const sd=stageStore[s]||{};
    const st={dry:mathValue(sd.dry,0),prop:mathValue(sd.prop,0),thrust:mathValue(sd.thrust,0),isp:parseFloat(sd.isp)||1,res:mathValue(sd.res,0)};
    // Persist S1.5 fields so they survive save/load
    if(sd.s15){st.s15=true;st.s15_sust_thrust=sd.s15_sust_thrust||0;st.s15_sust_isp=sd.s15_sust_isp||0;st.s15_jet_mass=sd.s15_jet_mass||0;st.s15_beco_twr=sd.s15_beco_twr||1.2;st.s15_boost_isp=sd.s15_boost_isp||0;}
    stages.push(st);
  }
  const groups=lvBoosterGroups();
  const booster=groups[0]||null;   // primary group, kept as a single object for back-compat
  return{name:'',note:'',stages:numStages,boosters:useBooster,restartable,stageData:stages,boosterData:booster,boosterGroups:(groups.length>1?groups:null),payload:gv('payload-mass'),fairingMass:gv('fairing-mass'),fairingJettison:parseInt(document.getElementById('fairing-jettison').value),site:{lat:gv('site-lat'),azMin:gv('az-min'),azMax:gv('az-max'),lon:(typeof getCurrentSite==='function'&&getCurrentSite()&&getCurrentSite().lon!=null)?getCurrentSite().lon:null,name:(typeof getCurrentSite==='function'&&getCurrentSite())?getCurrentSite().name:null},mode:destMode,orbit:destMode==='orbit'?{apogee:gv('apogee'),perigee:gv('perigee'),inc:gv('inclination')}:null,escape:destMode==='escape'?{c3:gv('c3'),decl:gv('decl'),perigee:gv('escape-perigee')}:null,trajectory,parkingAlt:destMode==='orbit'?gv('parking-alt'):gv('escape-perigee')};
}
