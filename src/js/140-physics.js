
// ─── PHYSICS ──────────────────────────────────
function circVel(alt){return Math.sqrt(MU/(RE+alt))*1000;}
function rotVel(lat,azMin,azMax){
  const Vm=OMEGA_E*RE*1000*Math.cos(lat*Math.PI/180);
  let best=0;[azMin,azMax,90].forEach(az=>{const c=Vm*Math.cos((az-90)*Math.PI/180);if(c>best)best=c;});
  return Math.max(0,Math.min(best,Vm));
}
function rocketEq(isp,m0,mf){return(mf<=0||m0<=mf)?0:G0*isp*Math.log(m0/mf);}

// ─── MULTI-STAGE ASCENT CORRECTION (2026-07-18, MATH.md critique 121) ───────
// The published Townsend-Schilling method (2009 note) gives only the LINEAR
// penalty refit (Eq5, K3+K4*Tmix) — regressed on modern vehicles with
// ordinary ascent times. Silverbird's live model (SB7) books substantially
// more penalty for multi-stage stacks with long total burns (Saturn V-class:
// ~800 m/s more), physics visible in third-party Schilling-method
// implementations as a full-ascent-time correction. This term was fitted by
// least squares against a 30-configuration black-box probe campaign of
// Silverbird itself (19 LEO calibration + 11 higher-orbit holdout points;
// dataset: tests/fixtures/silverbird-probes-.md). Chosen basis won
// on HOLDOUT error (fitted at LEO only, validated blind at 800 km/GTO/MEO:
// Saturn V GTO error +29.7% -> +1.1%, MEO +32% -> -0.3%).
//   corr = max(0, A*TaFull - C*X + B)   [multi-stage only]
//   TaFull = total ascent burn time (all stages, boosters integrated), s
//   X      = sum over upper stages of bt_i * max(0, 1 - TW_i)  (low-TW
//            upper-stage exposure; TW at stage ignition, full stack above)
// With identical stage data our corrected model reproduces Silverbird raw to
// +-0.3-6% across LEO/800/GTO/MEO, 1-3 stages. Single-stage is gated off
// (already agreed within noise). Known residual: none of this fixes the
// inclination-insensitive rotVel (separate defect, documented).
const LV_MSCORR_A=1.0313, LV_MSCORR_C=1.0667, LV_MSCORR_B=-1.4664;

// ─── S1.5 (STAGE-AND-A-HALF) CARRIAGE ─────────
// The s15 sextet (the `s15` flag + these 5 fields) describes a stage's BECO
// (booster-engine-cutoff) split and must move ATOMICALLY between every stage
// record shape in the app (worksheet stageStore, library entries, fleet
// snapshots, presets, trade-study assemblers, ...). Copying it field-by-field
// at each call site has shipped the same drop bug 3x (hard
// invariant +) — every module that needs to
// carry, clear, or read-off s15 data MUST route through these three helpers
// (grep-gated in tests/run.js: no other module may reference an
// `s15_*` field name directly outside the splitters that consume it).
const STAGE_S15_FIELDS=['s15_sust_thrust','s15_sust_isp','s15_jet_mass','s15_beco_twr','s15_boost_isp'];
function _s15FieldDefault(f){return f==='s15_beco_twr'?1.2:0;}
// Copy the s15 flag + sextet from src onto dst atomically. No-op (dst
// untouched) if src has no s15 data — callers that need clear-on-toggle-off
// call stageClearS15(dst) explicitly.
function stageCarryS15(dst,src){
  if(!dst||!src||!src.s15)return dst;
  dst.s15=true;
  STAGE_S15_FIELDS.forEach(f=>{dst[f]=src[f]||_s15FieldDefault(f);});
  return dst;
}
// Remove the s15 flag + sextet from dst (the toggle-off / clear case).
function stageClearS15(dst){
  if(!dst)return dst;
  delete dst.s15;
  STAGE_S15_FIELDS.forEach(f=>delete dst[f]);
  return dst;
}
// Read-only: pull the s15 flag + sextet off src into a fresh plain object
// (for DOM population, preview computation, etc.) without touching src.
// Returns null if src has no s15 data.
function stagePickS15(src){
  if(!src||!src.s15)return null;
  const out={s15:true};
  STAGE_S15_FIELDS.forEach(f=>{out[f]=src[f]||_s15FieldDefault(f);});
  return out;
}

// ─── S1.5 (STAGE-AND-A-HALF) EXPANSION BOUNDARY ─────────────────────────
// Compute the Phase-1 / Phase-2 propellant split for a stage-and-a-half.
// Uses a stage-mass-only approximation: the mass of upper stages and payload
// above this stage is ignored when locating the BECO point.  The rocket-equation
// accounting in evalAtPayload still runs with the full mass stack, so the ΔV
// error from this approximation is small (< 5 % for typical Atlas-class vehicles).
//
// @param {object} s  - stage record with {dry, prop, isp, thrust,
//                      s15_sust_thrust, s15_sust_isp, s15_jet_mass, s15_beco_twr,
//                      s15_boost_isp}
// @returns {object}  - {prop_ph1, prop_ph2, isp_ph1, isp_ph2, dry_ph2, boostIspUsed} or {error}
function _s15BecoSplit(s) {
  const F_sust   = (s.s15_sust_thrust || 0) * 1000;   // N
  const isp_ph2  = s.s15_sust_isp > 0 ? s.s15_sust_isp : (parseFloat(s.isp) || 1);
  const jet      = s.s15_jet_mass   || 0;
  const twr      = s.s15_beco_twr   || 1.2;
  const dry      = parseFloat(s.dry)  || 0;
  const prop     = parseFloat(s.prop) || 0;

  if (F_sust <= 0)  return { error: 'Sustainer thrust must be > 0' };
  if (jet   <= 0)   return { error: 'Booster pack mass must be > 0' };
  if (jet   >= dry) return { error: 'Booster pack mass ≥ stage dry mass' };
  if ((s.s15_sust_thrust || 0) >= (parseFloat(s.thrust) || 0))
                    return { error: 'Sustainer thrust ≥ total thrust — no booster engines' };

  // At BECO: sustainer TWR on stage-only mass = F_sust / (m_after × G0) = twr
  // → m_after = F_sust / (twr × G0)   [stage mass after jettison, no payload]
  const m_after  = F_sust / (twr * G0);
  const m_beco   = m_after + jet;               // stage mass at BECO (before jettison)
  const m_stage0 = dry + prop;                  // stage mass at ignition

  if (m_beco >= m_stage0) return { error: 'BECO TWR too low — stage never reaches jettison point (increase TWR)' };

  const prop_ph1 = Math.max(0, m_stage0 - m_beco);
  const prop_ph2 = Math.max(0, prop - prop_ph1);

  if (prop_ph2 <= 0) return { error: 'No propellant left for Phase 2 — lower BECO TWR or add more propellant' };

  // Optional mass-flow-blended Phase-1 Isp: thrust-weighted harmonic mean of the
  // booster engines' Isp and the sustainer's Isp, since both burn together in Phase 1.
  // Isp_eff = F_tot / (F_boost/Isp_boost + F_sust/Isp_sust), F_boost = F_tot - F_sust.
  const authoredIsp = parseFloat(s.isp) || 1;
  const boostIsp     = s.s15_boost_isp > 0 ? s.s15_boost_isp : 0;
  let isp_ph1 = authoredIsp;
  let boostIspUsed = null;
  if (boostIsp > 0) {
    const F_tot   = (parseFloat(s.thrust) || 0) * 1000;   // N
    const F_boost = F_tot - F_sust;                       // guarded > 0 above
    if (F_boost > 0) {
      isp_ph1 = F_tot / (F_boost / boostIsp + F_sust / isp_ph2);
      boostIspUsed = boostIsp;
    }
  }

  return {
    prop_ph1,
    prop_ph2,
    isp_ph1,
    isp_ph2,
    dry_ph2:  dry - jet,
    boostIspUsed,
  };
}

// ONE S1.5 expansion boundary ("S1.5 splitter shipped
// 3x": calculateWithS15 (150), _fleetExpandStages (560), and _tsExpandStages
// (165) used to each hand-roll their own stage/BECO iteration with DIVERGENT
// output records and error policies). Every consumer of vehicle stage data now
// routes through this ONE function; a source-grep gate (tests/suites/
// 10-canonical-migrations.js) fails the build if any module outside this file
// calls `_s15BecoSplit` directly.
//
// Input: `stages` — an array of stage records, already numerically normalized
// by the caller (mass/thrust/isp/res coerced to numbers — e.g. via mathValue()
// for DOM-sourced fields). s15 stages must carry the s15 sextet (stageCarryS15).
// This function does NOT do unit coercion or defaulting beyond `||0`/`||1`
// safety nets — that is caller-side responsibility, same as the field-wrap
// decorations (150's mathValue/label wrap, 560's extra provenance) each caller
// applies on top of the returned records.
//
// Output: one record per input stage (non-s15, or s15-with-split-error under
// 'annotate'), or TWO records (Ph.1 + Ph.2) per split s15 stage. Every record
// carries `_src` (index of the originating input stage) so callers can rebuild
// per-source labels/provenance; split records additionally carry `_phase`
// ('Ph.1'|'Ph.2'); an annotated split failure carries `_err`.
//
// opts.onError:
//   'throw'    (default) — throws an Error with .stageIndex/.s15Error set, for
//              a caller that wants to abort the whole calculation and surface
//              the problem before computing anything wrong (calculateWithS15's
//              pre-existing abort-and-render-to-#results-panel behavior).
//   'annotate' — pushes the RAW unsplit stage decorated with `_err` and keeps
//              going (matches _fleetExpandStages' pre-existing behavior).
//              _tsExpandStages previously had a THIRD policy here — silently
//              falling back to the unsplit stage with NO annotation, i.e.
//              quietly under-modeling an invalid S1.5 vehicle as single-stage.
//              That silent policy is retired: _tsExpandStages now also uses
//              'annotate', so an invalid S1.5 vehicle is visibly flagged
//              (via `_err`) instead of hiding the misconfiguration.
function stageExpandS15(stages, opts){
  opts = opts || {};
  const onError = opts.onError || 'throw';
  const out = [];
  (stages || []).forEach((raw, i) => {
    const st = raw || {};
    if (st.s15) {
      const sp = _s15BecoSplit(st);
      if (sp.error) {
        if (onError === 'throw') {
          const err = new Error(sp.error);
          err.stageIndex = i;
          err.s15Error = sp.error;
          throw err;
        }
        out.push({ dry: st.dry||0, prop: st.prop||0, thrust: st.thrust||0, isp: st.isp||1, res: st.res||0, _src: i, _err: sp.error });
        return;
      }
      out.push({ dry: st.dry||0, prop: sp.prop_ph1, thrust: st.thrust||0, isp: sp.isp_ph1, res: st.res||0, _src: i, _phase: 'Ph.1' });
      out.push({ dry: sp.dry_ph2, prop: sp.prop_ph2, thrust: st.s15_sust_thrust||0, isp: sp.isp_ph2, res: st.res||0, _src: i, _phase: 'Ph.2' });
    } else {
      out.push({ dry: st.dry||0, prop: st.prop||0, thrust: st.thrust||0, isp: st.isp||1, res: st.res||0, _src: i });
    }
  });
  return out;
}

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
// Optional numeric read — blank input means "unauthored" (null), not 0.
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
  const Tmix=0.405*Ta+0.595*T3s, DVpenBase=K3+K4*Tmix;
  // Multi-stage ascent correction (see LV_MSCORR_* above): extra loss for
  // long multi-stage ascents that the linear Eq5 penalty cannot produce.
  // X = upper-stage low-TW exposure; TW at stage ignition with the full
  // stack above (spM[s] already = payload+fairing+stages-above).
  let msCorr=0;
  if(n>1){
    let X=0;
    for(let s=1;s<n;s++){
      const sd=stages[s],up=sd.prop*(1-(sd.res||0)/100);
      const mdot=(sd.thrust*1000)/(G0*sd.isp),bt=mdot>0?up/mdot:0;
      const mIgn=sd.dry+sd.prop+spM[s];
      const tw=mIgn>0?(sd.thrust*1000)/(mIgn*G0):0;
      X+=bt*Math.max(0,1-tw);
    }
    msCorr=Math.max(0,LV_MSCORR_A*tBT-LV_MSCORR_C*X+LV_MSCORR_B);
  }
  const DVpen=DVpenBase+msCorr;
  const DVasc=Vcirc+DVpen-Vrot, DVtot=DVasc+(onOrbitDV||0), margin=tDV-DVtot;
  return{sDVs,sBTs,tDV,tBT,Ta,Tmix,DVpen,DVpenBase,msCorr,DVasc,DVtot,margin,tMas,A0,avgIsp,Vcirc,Vrot};
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
    isp:gv('b_isp')||1, res:gv('b_res'),
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
    stageCarryS15(st,sd);
    stages.push(st);
  }
  const groups=lvBoosterGroups();
  const booster=groups[0]||null;   // primary group, kept as a single object for back-compat
  return{name:'',note:'',stages:numStages,boosters:useBooster,restartable,stageData:stages,boosterData:booster,boosterGroups:(groups.length>1?groups:null),payload:gv('payload-mass'),fairingMass:gv('fairing-mass'),fairingJettison:parseInt(document.getElementById('fairing-jettison').value),site:{lat:gv('site-lat'),azMin:gv('az-min'),azMax:gv('az-max'),lon:(typeof getCurrentSite==='function'&&getCurrentSite()&&getCurrentSite().lon!=null)?getCurrentSite().lon:null,name:(typeof getCurrentSite==='function'&&getCurrentSite())?getCurrentSite().name:null},mode:destMode,orbit:destMode==='orbit'?{apogee:gv('apogee'),perigee:gv('perigee'),inc:gv('inclination')}:null,escape:destMode==='escape'?{c3:gv('c3'),decl:gv('decl'),perigee:gv('escape-perigee')}:null,trajectory,parkingAlt:destMode==='orbit'?gv('parking-alt'):gv('escape-perigee')};
}
