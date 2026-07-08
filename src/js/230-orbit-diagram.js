
// ─── ORBIT DIAGRAM ────────────────────────────
function initOrbitDiagram(){
  const canvas=document.getElementById('orbit-diagram');
  if(!canvas||canvas._odInited)return;
  canvas._odInited=true;
  function resize(){
    clearTimeout(canvas._szTimer);
    canvas._szTimer=setTimeout(()=>{
      const dpr=window.devicePixelRatio||1;
      const w=canvas.offsetWidth,h=canvas.offsetHeight;
      if(!w||!h)return;
      canvas._dpr=dpr;
      canvas.width=Math.round(w*dpr);
      canvas.height=Math.round(h*dpr);
      drawOrbitDiagram();
    },120);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
}

function drawOrbitDiagram(){
  const canvas=document.getElementById('orbit-diagram');
  if(!canvas||!canvas._odInited)return;
  const dpr=canvas._dpr||1;
  const ctx=canvas.getContext('2d');
  const W=canvas.width/dpr,H=canvas.height/dpr;
  const cx=W/2,cy=H/2;
  const maxR=Math.min(cx,cy)*0.86;
  ctx.save();
  ctx.scale(dpr,dpr);

  const cs=getComputedStyle(document.documentElement);
  const accent=cs.getPropertyValue('--accent').trim();
  const accent3=cs.getPropertyValue('--accent3').trim()||'#7fff6b';
  const panelCol=cs.getPropertyValue('--panel').trim();

  ctx.fillStyle=panelCol;ctx.fillRect(0,0,W,H);

  const R_e=6371;
  const isEsc=(destMode==='escape');
  const gn=id=>parseFloat(document.getElementById(id)?.value)||0;

  let r_park,r_apo,r_peri,c3v;
  if(isEsc){
    r_park=R_e+Math.max(gn('escape-perigee'),100);
    c3v=gn('c3');
    r_apo=r_park; r_peri=r_park;
  } else {
    r_park=R_e+Math.max(gn('parking-alt'),100);
    r_apo =R_e+Math.max(gn('apogee'),100);
    r_peri=R_e+Math.max(gn('perigee'),100);
    if(r_peri>r_apo){const t=r_peri;r_peri=r_apo;r_apo=t;}
  }

  // power-scale radius → pixels: alt^0.38 so LEO and GEO both render well
  const r_scale=isEsc ? r_park*28 : Math.max(r_apo,r_park)*1.38;
  const logR=r=>{
    if(r<=R_e)return 0;
    const alt=Math.min(r-R_e, r_scale-R_e);
    return Math.pow(alt/(r_scale-R_e), 0.38)*maxR;
  };

  // parametric orbit arc: r(θ) = p/(1+e·cosθ), perigee at θ=0 (right)
  const drawArc=(rp,ra,th0,th1,color,lw,dash)=>{
    const a=(rp+ra)/2, e=(ra-rp)/(ra+rp);
    const p=a*(1-e*e);
    const steps=240;
    ctx.beginPath();
    ctx.setLineDash(dash||[]);
    for(let i=0;i<=steps;i++){
      const th=th0+(th1-th0)*i/steps;
      const r=e<1e-6?rp:p/(1+e*Math.cos(th));
      const dr=logR(r);
      const x=cx+dr*Math.cos(th), y=cy-dr*Math.sin(th);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }
    if(Math.abs(th1-th0)>=Math.PI*1.99)ctx.closePath();
    ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.stroke();
    ctx.setLineDash([]);
  };

  const dot=(th,r_km,col,sz)=>{
    const dr=logR(r_km);
    ctx.beginPath();ctx.arc(cx+dr*Math.cos(th),cy-dr*Math.sin(th),sz??3.5,0,Math.PI*2);
    ctx.fillStyle=col;ctx.fill();
  };
  const lbl=(text,x,y,col,align)=>{
    ctx.font='9px JetBrains Mono,monospace';ctx.fillStyle=col;
    ctx.textAlign=align||'left';ctx.fillText(text,x,y);ctx.textAlign='left';
  };
  const fmtAlt=r=>`${Math.round(r-R_e).toLocaleString()} km`;

  // ── Earth ──
  const eR=Math.max(logR(R_e+20),7);
  const eg=ctx.createRadialGradient(cx,cy,0,cx,cy,eR);
  eg.addColorStop(0,'#1a5080');eg.addColorStop(0.55,'#1a6b50');eg.addColorStop(1,'#0a7a3a');
  ctx.beginPath();ctx.arc(cx,cy,eR,0,Math.PI*2);
  ctx.fillStyle=eg;ctx.fill();
  ctx.strokeStyle='rgba(100,210,255,0.5)';ctx.lineWidth=0.7;ctx.stroke();
  lbl('Earth',cx,cy+3,'rgba(255,255,255,0.55)','center');

  if(isEsc){
    // parking orbit (dim dashed)
    drawArc(r_park,r_park,0,Math.PI*2,'rgba(200,200,200,0.18)',0.8,[4,5]);
    lbl(fmtAlt(r_park),cx+logR(r_park)+5,cy-4,'rgba(200,200,200,0.4)');

    // hyperbolic departure arc — starts at perigee (right), sweeps counterclockwise outward
    const mu=398600;
    const v_c=Math.sqrt(mu/r_park);
    const v_esc=Math.sqrt(2*mu/r_park);
    const v_inj=Math.sqrt(v_esc*v_esc+Math.max(c3v,0));
    // semi-major axis (negative for hyperbola), eccentricity
    const a_h=mu/(v_inj*v_inj - 2*mu/r_park) * -1; // |a| of hyperbola
    const e_h=1+r_park/a_h;
    // asymptote angle: cos(θ∞) = -1/e_h
    const th_inf=Math.acos(-1/Math.max(e_h,1.001));
    // Draw from slightly past -θ∞ to slightly past +θ∞, sweeping through perigee
    const span=th_inf*0.88;
    ctx.beginPath();ctx.setLineDash([]);
    const steps=220;
    const p_h=a_h*(e_h*e_h-1);
    for(let i=0;i<=steps;i++){
      const th=-span+2*span*i/steps;
      const r=p_h/(1+e_h*Math.cos(th));
      if(r<=0||r>r_scale*1.1)continue;
      const dr=logR(r);
      const x=cx+dr*Math.cos(th),y=cy-dr*Math.sin(th);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }
    ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.stroke();

    // Injection burn dot at perigee
    dot(0,r_park,accent,4);
    lbl('Injection Δv',cx+logR(r_park)+7,cy+4,accent);

    // Asymptote lines (faint dashed)
    const aLen=maxR*0.92;
    ctx.setLineDash([3,5]);ctx.strokeStyle='rgba(255,255,255,0.12)';ctx.lineWidth=0.7;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+aLen*Math.cos(th_inf),cy-aLen*Math.sin(th_inf));ctx.stroke();
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+aLen*Math.cos(-th_inf),cy-aLen*Math.sin(-th_inf));ctx.stroke();
    ctx.setLineDash([]);

    // Footer
    lbl(`C3 = ${c3v>=0?'+':''}${c3v.toFixed(1)} km²/s²   e = ${e_h.toFixed(3)}`,8,H-10,'rgba(255,255,255,0.3)');

  } else {
    const isCirc=Math.abs(r_apo-r_peri)<5;
    const traj=trajectory||'two-burn';

    // Parking orbit
    drawArc(r_park,r_park,0,Math.PI*2,'rgba(200,200,200,0.2)',0.8,[4,5]);

    if(traj==='direct'){
      // Direct ascent: curved line from ~45° atmospheric to target insertion point
      const r_atm=R_e+100;
      const th0=Math.PI*0.38,th1=Math.PI*0.70;
      const r0=logR(r_atm),r1=logR(isCirc?r_apo:r_peri);
      const sx=cx+r0*Math.cos(th0),sy=cy-r0*Math.sin(th0);
      const ex=cx+r1*Math.cos(th1),ey=cy-r1*Math.sin(th1);
      // control point: midpoint pushed outward
      const mx=cx+(r0+r1)*0.6*Math.cos((th0+th1)/2);
      const my=cy-(r0+r1)*0.6*Math.sin((th0+th1)/2);
      ctx.beginPath();ctx.moveTo(sx,sy);ctx.quadraticCurveTo(mx,my,ex,ey);
      ctx.strokeStyle=accent+'99';ctx.lineWidth=1.5;ctx.setLineDash([3,4]);ctx.stroke();
      ctx.setLineDash([]);
      dot(th1,isCirc?r_apo:r_peri,accent,4);
      lbl('Direct Insertion',8,H-10,'rgba(255,255,255,0.28)');

    } else if(traj==='optimal'&&r_apo>r_park*3.5){
      // Bi-elliptic: two transfer arcs via an intermediate high point
      const r_int=Math.min(Math.sqrt(r_park*r_apo)*2.2,r_scale*0.88);
      drawArc(r_park,r_int,0,Math.PI,accent+'55',1.4);
      drawArc(r_peri,r_int,-Math.PI,0,accent+'88',1.4);
      dot(0,r_park,accent,4);
      dot(Math.PI,r_int,accent,4);
      dot(0,r_peri,accent,4);
      lbl('Δv₁',cx+logR(r_park)+7,cy+4,accent);
      lbl('Δv₂',cx-logR(r_int)-22,cy-6,accent);
      lbl('Δv₃',cx+logR(r_peri)+7,cy-6,accent);
      lbl('Bi-Elliptic Transfer',8,H-10,'rgba(255,255,255,0.28)');

    } else {
      // Hohmann / two-burn: upper half of transfer ellipse
      if(r_apo>r_park+20){
        drawArc(r_park,r_apo,0,Math.PI,accent+'88',1.8);
        dot(0,r_park,accent,4);
        dot(Math.PI,r_apo,accent,4);
        lbl('Δv₁',cx+logR(r_park)+7,cy+4,accent);
        lbl('Δv₂',cx-logR(r_apo)-22,cy-5,accent);
      }
      lbl(traj==='optimal'?'Optimal Transfer':'Hohmann Transfer',8,H-10,'rgba(255,255,255,0.28)');
    }

    // ── Final target orbit ──
    if(isCirc){
      drawArc(r_apo,r_apo,0,Math.PI*2,accent,2);
      const dr=logR(r_apo);
      lbl(fmtAlt(r_apo),cx,cy-dr-6,accent+'dd','center');
    } else {
      drawArc(r_peri,r_apo,0,Math.PI*2,accent3,2);
      lbl(fmtAlt(r_apo),cx-logR(r_apo)-4,cy-5,accent3+'cc','right');
      lbl(fmtAlt(r_peri),cx+logR(r_peri)+4,cy-5,accent3+'cc');
    }

    // Parking alt label (bottom-right, small)
    lbl(`Park: ${fmtAlt(r_park)}`,W-8,H-10,'rgba(200,200,200,0.35)','right');
  }

  ctx.restore();
}

let activeSiteKey=null;

function siteEffectiveInc(site){
  // Minimum achievable inclination from this site
  return site.minInc!==undefined ? site.minInc : Math.abs(site.lat);
}

function buildSiteSelector(){
  const grid=document.getElementById('site-selector-grid');
  if(!grid)return;
  grid.innerHTML='';
  LAUNCH_SITES.forEach(region=>{
    const regionDiv=document.createElement('div');regionDiv.className='site-region';
    const lbl=document.createElement('div');lbl.className='site-region-label';lbl.textContent=region.region;
    regionDiv.appendChild(lbl);
    const btnRow=document.createElement('div');btnRow.className='site-grid';
    region.sites.forEach(site=>{
      const key=site.short;
      const btn=document.createElement('button');
      btn.className='site-btn'+(activeSiteKey===key?' active':'');
      btn.textContent=site.short;
      btn.title=site.name+' — '+site.note;
      btn.onclick=()=>loadSite(site);
      btnRow.appendChild(btn);
    });
    regionDiv.appendChild(btnRow);
    grid.appendChild(regionDiv);
  });
  // User-defined spaceports
  if(userSpaceports.length>0){
    const uDiv=document.createElement('div');uDiv.className='site-region';
    const uLbl=document.createElement('div');uLbl.className='site-region-label';uLbl.textContent='User Defined';
    uDiv.appendChild(uLbl);
    const uRow=document.createElement('div');uRow.className='site-grid';
    userSpaceports.forEach(sp=>{
      const key='usp_'+sp._uid;
      const wrap=document.createElement('div');wrap.style.cssText='display:flex;gap:2px;';
      const btn=document.createElement('button');
      btn.className='site-btn'+(activeSiteKey===key?' active':'');
      btn.textContent=sp.short;btn.title=sp.name+(sp.note?' — '+sp.note:'');
      btn.onclick=()=>{
        activeSiteKey=key;
        document.getElementById('site-lat').value=sp.lat;
        document.getElementById('az-min').value=sp.azMin;
        document.getElementById('az-max').value=sp.azMax;
        buildSiteSelector();updateSiteNotes(sp);updateIncForSite(sp);
      };
      wrap.appendChild(btn);
      const del=document.createElement('button');
      del.className='site-btn';
      del.style.cssText='flex:none;width:18px;padding:2px 3px;color:var(--danger-bright);border-color:color-mix(in srgb, var(--danger) 30%, transparent);font-size:11px;';
      del.textContent='×';del.title='Remove';
      del.onclick=e=>{e.stopPropagation();deleteUserSpaceport(sp._uid);};
      wrap.appendChild(del);uRow.appendChild(wrap);
    });
    uDiv.appendChild(uRow);grid.appendChild(uDiv);
  }
  // Custom option
  const customDiv=document.createElement('div');customDiv.className='site-region';
  const customRow=document.createElement('div');customRow.className='site-grid';
  const customBtn=document.createElement('button');
  customBtn.className='site-btn'+(activeSiteKey===null?' active':'');
  customBtn.textContent='Custom';customBtn.title='Edit fields manually';
  customBtn.onclick=()=>{activeSiteKey=null;buildSiteSelector();updateSiteNotes(null);};
  customRow.appendChild(customBtn);customDiv.appendChild(customRow);grid.appendChild(customDiv);
  drawSiteMap();
}

function loadSite(site){
  activeSiteKey=site.short;
  document.getElementById('site-lat').value=site.lat;
  document.getElementById('az-min').value=site.azMin;
  document.getElementById('az-max').value=site.azMax;
  buildSiteSelector();
  updateSiteNotes(site);
  // Update any active incTracksLat orbit
  updateIncForSite(site);
}

function updateSiteNotes(site){
  const noteEl=document.getElementById('site-note');
  const trackEl=document.getElementById('inc-tracked-note');
  const descEl=document.getElementById('site-desc');
  if(!site){noteEl.textContent='';trackEl.style.display='none';if(descEl){descEl.textContent='';descEl.style.display='none';}return;}
  if(descEl){if(site.desc){descEl.textContent=site.desc;descEl.style.display='block';}else{descEl.textContent='';descEl.style.display='none';}}
  noteEl.textContent=site.name+(site.note?' — '+site.note:'');
  updateIncTrackedNote(site);
}

function updateIncTrackedNote(site){
  const trackEl=document.getElementById('inc-tracked-note');
  if(!site){trackEl.style.display='none';return;}
  const effectiveInc=siteEffectiveInc(site);
  // Check if active orbit tracks lat
  const activeOrbitTracksLat=checkActiveOrbitTracksLat();
  if(activeOrbitTracksLat){
    trackEl.style.display='block';
    trackEl.textContent='↻ Active orbit inclination updated to '+effectiveInc.toFixed(1)+'° ('+
      (site.minInc!==undefined?'range safety minimum':'site latitude')+')';
  } else {
    trackEl.style.display='none';
  }
}

function checkActiveOrbitTracksLat(){
  if(!activeOrbitKey)return false;
  // Search ORBIT_CATEGORIES for the active orbit
  for(const cat of ORBIT_CATEGORIES){
    for(let i=0;i<cat.orbits.length;i++){
      if('orbit_'+cat.planet+'_'+i===activeOrbitKey){
        return cat.orbits[i].incTracksLat===true;
      }
    }
  }
  return false;
}

function updateIncForSite(site){
  if(!checkActiveOrbitTracksLat())return;
  const inc=siteEffectiveInc(site);
  document.getElementById('inclination').value=inc;
  updateIncTrackedNote(site);
}


function matchSiteFromFields(){
  // Try to match current lat/azMin/azMax to a known site
  const lat=parseFloat(document.getElementById('site-lat').value);
  const azMin=parseFloat(document.getElementById('az-min').value);
  const azMax=parseFloat(document.getElementById('az-max').value);
  for(const region of LAUNCH_SITES){
    for(const site of region.sites){
      if(Math.abs(site.lat-lat)<0.1&&Math.abs(site.azMin-azMin)<1&&Math.abs(site.azMax-azMax)<1){
        activeSiteKey=site.short;
        buildSiteSelector();
        updateSiteNotes(site);
        return;
      }
    }
  }
  // No match — stay custom
  activeSiteKey=null;
  buildSiteSelector();
  updateSiteNotes(null);
}
function onSiteFieldEdit(){
  // User manually edited fields → switch to custom
  if(activeSiteKey!==null){
    activeSiteKey=null;
    buildSiteSelector();
    document.getElementById('site-note').textContent='';
    document.getElementById('inc-tracked-note').style.display='none';
    const descEl=document.getElementById('site-desc');
    if(descEl){descEl.textContent='';descEl.style.display='none';}
  }
}

function getCurrentSite(){
  if(!activeSiteKey)return null;
  for(const region of LAUNCH_SITES){
    const s=region.sites.find(s=>s.short===activeSiteKey);
    if(s)return s;
  }
  // Check user spaceports
  const usp=userSpaceports.find(s=>'usp_'+s._uid===activeSiteKey);
  if(usp)return usp;
  return null;
}
