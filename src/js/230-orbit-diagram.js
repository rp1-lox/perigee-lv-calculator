
// ─── ORBIT DIAGRAM ────────────────────────────
// "Weaker, Earth-centric" true-geometry mini-view. Earth-centric only, no
// zoom/pan, fixed frame auto-fit each render. Reuses the Trajectory view's
// (574) pure geometry helper _trajEllipseGeom (focus-correct: body at focus,
// c = a - r_peri) so the ellipse math is identical to the big view — this
// panel is deliberately a smaller, non-interactive SVG rendering of the same
// geometry, not a reimplementation.
// viewBox matches the panel's rendered aspect (~1.1/1, see #orbit-diagram in
// styles.css) so font-size units map directly to rendered px without a
// stretch-distortion correction: width slightly wider than height.
const _OD_VBW = 330, _OD_VBH = 300;

function initOrbitDiagram(){
  const host=document.getElementById('orbit-diagram');
  if(!host||host._odInited)return;
  host._odInited=true;
  drawOrbitDiagram();
}

function _odFmtAlt(r,R_e){return `${Math.round(r-R_e).toLocaleString()}`;}

function drawOrbitDiagram(){
  const host=document.getElementById('orbit-diagram');
  if(!host||!host._odInited)return;

  const R_e=(typeof PROG_BODIES!=='undefined'&&PROG_BODIES.Earth)?PROG_BODIES.Earth.R:6371;
  const isEsc=(destMode==='escape');
  const gn=id=>parseFloat(document.getElementById(id)?.value)||0;

  let warn=null;
  let r_park,apoAlt,periAlt,c3v;
  if(isEsc){
    periAlt=gn('escape-perigee');
    if(periAlt<0){warn='perigee altitude is negative — showing 0 km';periAlt=0;}
    r_park=R_e+Math.max(periAlt,100);
    c3v=gn('c3');
  } else {
    apoAlt=gn('apogee'); periAlt=gn('perigee');
    let parkAlt=gn('parking-alt');
    if(apoAlt<0||periAlt<0||parkAlt<0){warn='negative altitude input — clamped to 0 km';}
    apoAlt=Math.max(apoAlt,0); periAlt=Math.max(periAlt,0); parkAlt=Math.max(parkAlt,0);
    if(periAlt>apoAlt){
      warn=(warn?warn+'; ':'')+'perigee > apogee — swapped for display';
      const t=periAlt;periAlt=apoAlt;apoAlt=t;
    }
    r_park=R_e+Math.max(parkAlt,100);
  }

  // ── scale: fit content to viewBox, matching the auto-fit spirit of 574's
  // _trajFitScale (linear true scale, headroom margin) ──
  const margin=40; // px headroom for labels (viewBox units == rendered px, see #orbit-diagram CSS aspect-ratio match)
  let maxR;
  if(isEsc){
    maxR=r_park*2.4; // parking ring + a bit of departure-curve headroom
  } else {
    const rApo=R_e+apoAlt, rPeri=R_e+periAlt;
    maxR=Math.max(r_park,rApo,rPeri);
  }
  const scale=(_OD_VBH/2-margin)/Math.max(1,maxR);

  const cs=getComputedStyle(document.documentElement);
  const v=name=>cs.getPropertyValue(name).trim();
  const earthColor=v('--nm-earth')||v('--accent2');
  const dimColor='var(--text-dim)';
  const accent='var(--accent)';
  const accent2='var(--accent2)';
  const warnColor='var(--warn)';

  let out='';
  // Earth disc — min ~8 viewBox-units (== ~8px rendered, since the viewBox
  // matches the panel's rendered aspect 1:1 — see #orbit-diagram CSS).
  const eR=Math.max(R_e*scale,8);
  out+=`<circle cx="0" cy="0" r="${eR.toFixed(2)}" fill="${earthColor}" stroke="var(--border-bright)" stroke-width="1.2"/>`;
  out+=`<text x="0" y="${(eR+13).toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="${dimColor}">Earth</text>`;

  // Parking orbit ring (thin, dim, dashed) — label nudged bottom-left per brief
  const rParkPx=r_park*scale;
  out+=`<circle cx="0" cy="0" r="${rParkPx.toFixed(2)}" fill="none" stroke="${dimColor}" stroke-width="1.2" stroke-dasharray="3,3" opacity="0.7"/>`;
  out+=`<text x="${(-rParkPx*0.7).toFixed(2)}" y="${(rParkPx*0.7+12).toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="${dimColor}">PARK ${_odFmtAlt(r_park,R_e)}</text>`;

  if(isEsc){
    // Escape mode: schematic outgoing hyperbolic-suggestive open curve.
    // Honest-not-precise: a dashed arc bending outward from the parking ring,
    // annotated with the C3 value, not a rigorously solved hyperbola.
    const th0=-40*Math.PI/180, th1=70*Math.PI/180;
    const rEndPx=Math.min(_OD_VBH/2-16, rParkPx*1.9+30);
    const p0={x:rParkPx*Math.cos(th0),y:-rParkPx*Math.sin(th0)};
    const p1={x:rEndPx*Math.cos(th1),y:-rEndPx*Math.sin(th1)};
    const cxp=(p0.x+p1.x)/2 + 40, cyp=(p0.y+p1.y)/2 - 20;
    out+=`<path d="M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} Q ${cxp.toFixed(2)} ${cyp.toFixed(2)} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}" fill="none" stroke="${accent2}" stroke-width="1.6" stroke-dasharray="4,3"/>`;
    // arrowhead at p1
    const ang=Math.atan2(p1.y-cyp,p1.x-cxp);
    const ah=6;
    const a1={x:p1.x-ah*Math.cos(ang-0.4),y:p1.y-ah*Math.sin(ang-0.4)};
    const a2={x:p1.x-ah*Math.cos(ang+0.4),y:p1.y-ah*Math.sin(ang+0.4)};
    out+=`<path d="M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} L ${a1.x.toFixed(2)} ${a1.y.toFixed(2)} M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} L ${a2.x.toFixed(2)} ${a2.y.toFixed(2)}" stroke="${accent2}" stroke-width="1.6" fill="none"/>`;
    out+=`<circle cx="${p0.x.toFixed(2)}" cy="${p0.y.toFixed(2)}" r="2.6" fill="${accent}"/>`;
    out+=`<text x="${p0.x.toFixed(2)}" y="${(p0.y-9).toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="${accent}">Injection</text>`;
    const c3Txt=`C3 = ${c3v>=0?'+':''}${c3v.toFixed(1)} km²/s²`;
    out+=`<text x="${(-_OD_VBW/2+8).toFixed(2)}" y="${(_OD_VBH/2-10).toFixed(2)}" font-family="var(--mono)" font-size="10.5" fill="${accent2}">${c3Txt}</text>`;
  } else {
    const rApo=R_e+apoAlt, rPeri=R_e+periAlt;
    const inc=gn('inclination');

    if(Math.abs(rApo-r_park)<5 && Math.abs(rPeri-r_park)<5){
      // Target ≈ parking: single circle only, no transfer arc.
      const rPx=rApo*scale;
      out+=`<circle cx="0" cy="0" r="${rPx.toFixed(2)}" fill="none" stroke="${accent}" stroke-width="2"/>`;
      out+=`<text x="0" y="${(-rPx-6).toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="10.5" fill="${accent}">TARGET ${_odFmtAlt(rApo,R_e)}${inc?(' · '+inc.toFixed(1)+'°'):''}</text>`;
    } else {
      // Target ellipse/circle via 574's pure geometry helper.
      const g=_trajEllipseGeom(periAlt,apoAlt,R_e);
      const gCirc=Math.abs(g.rApo-g.rPeri)<Math.max(1,R_e*0.001);
      const gcx=g.c*scale, grx=g.a*scale, gry=g.b*scale;
      // Redundant-transfer suppression: when the transfer ellipse (parking ->
      // target apoapsis) ~= the target orbit itself (peri-matched elliptical
      // target — the classic GTO case, model charges dv2=0), don't draw a
      // separate dashed transfer arc; the target ring IS the transfer. Draw
      // only the departure burn dot at perigee. Circular targets are
      // unaffected (gCirc branch never reaches here with a redundant arc,
      // since a circular target's peri==apo can't equal r_park unless it's
      // already caught by the "target≈parking" branch above).
      const redundant=!gCirc && _trajTransferIsRedundant(Math.min(r_park,rApo),Math.max(r_park,rApo),rPeri,rApo);
      if(gCirc){
        out+=`<circle cx="0" cy="0" r="${grx.toFixed(2)}" fill="none" stroke="${accent}" stroke-width="2"/>`;
        out+=`<text x="0" y="${(-grx-6).toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="10.5" fill="${accent}">TARGET ${_odFmtAlt(rApo,R_e)}${inc?(' · '+inc.toFixed(1)+'°'):''}</text>`;
      } else {
        out+=`<ellipse cx="${gcx.toFixed(2)}" cy="0" rx="${grx.toFixed(2)}" ry="${gry.toFixed(2)}" fill="none" stroke="${accent}" stroke-width="2"/>`;
        // label nudged to the apogee end (far -x side of the ellipse) so it
        // doesn't sit on top of the parking-ring / transfer-arc geometry.
        const labelX=gcx-grx;
        out+=`<text x="${labelX.toFixed(2)}" y="${(-gry-6).toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="10.5" fill="${accent}">TARGET ${_odFmtAlt(rPeri,R_e)}×${_odFmtAlt(rApo,R_e)}${inc?(' · '+inc.toFixed(1)+'°'):''}</text>`;
      }

      if(!redundant){
        // Hohmann transfer arc, parking -> target apoapsis, with 2 burn dots at
        // the tangent points (periapsis-side and apoapsis-side of the transfer).
        const arc=_trajTransferArcPath(r_park,rApo,scale,0);
        out+=`<path d="${arc.d}" fill="none" stroke="${accent2}" stroke-width="1.3" stroke-dasharray="3,2.5" opacity="0.9"/>`;
        out+=`<circle cx="${arc.depX.toFixed(2)}" cy="${arc.depY.toFixed(2)}" r="2.6" fill="${accent}"/>`;
        out+=`<circle cx="${arc.arrX.toFixed(2)}" cy="${arc.arrY.toFixed(2)}" r="2.6" fill="${accent}"/>`;
      } else {
        // Just the departure burn dot at perigee — the target ellipse IS the transfer.
        const depX=rPeri*scale, depY=0;
        out+=`<circle cx="${depX.toFixed(2)}" cy="${depY.toFixed(2)}" r="2.6" fill="${accent}"/>`;
      }
    }

    out+=`<text x="${(-_OD_VBW/2+8).toFixed(2)}" y="${(_OD_VBH/2-10).toFixed(2)}" font-family="var(--mono)" font-size="10" fill="${dimColor}">coplanar · inc annotated</text>`;
  }

  if(warn){
    out+=`<text x="0" y="${(_OD_VBH/2-26).toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="${warnColor}">${warn}</text>`;
  }

  host.innerHTML=`<svg viewBox="-${_OD_VBW/2} -${_OD_VBH/2} ${_OD_VBW} ${_OD_VBH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${out}</svg>`;
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
