
// ─── ORBIT DIAGRAM ────────────────────────────
// "Weaker, Earth-centric" true-geometry mini-view. Earth-centric only, no
// zoom/pan, fixed frame auto-fit each render. Reuses the Trajectory view's
// (574) pure geometry helper _trajEllipseGeom (focus-correct: body at focus,
// c = a - r_peri) so the ellipse math is identical to the big view — this
// panel is deliberately a smaller, non-interactive SVG rendering of the same
// geometry, not a reimplementation.
//
// Two-layer split (same architecture as 574, see that file's header comment
// for the full rationale): the mini-diagram's world "camera" is a CONSTANT
// transform (fixed frame, auto-fit each render, no zoom/pan) — trivial
// compared to 574's mutable viewBox camera, but it funnels through the exact
// SAME projection (_trajWorldToScreen) and the exact same label registry /
// resolve pass (_trajRegisterLabel / _trajResolveLabels) so there is ONE
// symbology code path shared by both surfaces, not two. World geometry
// (rings/ellipses/discs/arcs) is drawn directly into the world <svg> in
// world-unit (km*scale) coordinates as before; labels/plates are registered
// then resolved into a sibling overlay <svg> sized in real container px.
// viewBox matches the panel's rendered aspect (~1.1/1, see #orbit-diagram in
// styles.css) so world-unit and overlay-px boxes have the same aspect ratio.
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

  // ── label registry: reuse 574's LOD/collision/plate machinery (loaded in
  // the same concatenated bundle — declaration order doesn't matter by call
  // time) so both surfaces share one algorithm and one visual language
  // (plates, greedy collision drop, priority order). The mini-diagram has no
  // zoom (zoom=1 always) and every label here is geometry-anchored (no size
  // gate needed beyond what's computed below), so labels are registered with
  // minSize:0 (always eligible) and let collision be the only filter.
  _trajResetLabels();
  const reg=(x,y,text,fontPx,color,pri)=>_trajRegisterLabel(x,y,[{text,dy:0,fontPx,color}],pri||'orbit',{screenSize:Infinity,minSize:0,selected:false});

  let out='';
  // Earth disc — true scale, but CAPPED per the C brief: at low-orbit targets
  // a true-scale Earth swamps the ring (e.g. a 200 km target reads as hugging
  // a giant disc). Clamp to min(true scale, ~55% of the smallest drawn
  // orbit's rendered radius), floor 8px, so Earth stays a size REFERENCE
  // rather than dominating the frame. "Smallest drawn orbit" = parking ring
  // (always drawn) and, when present, the target ring's own smaller apsis.
  let smallestOrbitPx=r_park*scale;
  if(!isEsc){
    const rApo=R_e+apoAlt, rPeri=R_e+periAlt;
    smallestOrbitPx=Math.min(smallestOrbitPx, rPeri*scale, rApo*scale);
  }
  const eR_true=R_e*scale;
  const eR_cap=Math.max(8, smallestOrbitPx*0.55);
  const eR=Math.max(8, Math.min(eR_true, eR_cap));
  const earthCapped=eR_true>eR_cap+0.5;
  out+=`<circle cx="0" cy="0" r="${eR.toFixed(2)}" fill="${earthColor}" stroke="var(--border-bright)" stroke-width="1.2"/>`;
  reg(0,eR+13,'Earth',10,dimColor,'body');

  // Parking orbit ring (thin, dim, dashed) — label nudged bottom-left per brief
  const rParkPx=r_park*scale;
  out+=`<circle cx="0" cy="0" r="${rParkPx.toFixed(2)}" fill="none" stroke="${dimColor}" stroke-width="1.2" stroke-dasharray="3,3" opacity="0.7"/>`;
  reg(-rParkPx*0.7, rParkPx*0.7+12, `PARK ${_odFmtAlt(r_park,R_e)}`, 10, dimColor, 'orbit');

  // Corner title (fixed header line, top-left, ~10px, plated) instead of a
  // large TARGET label floating centered-over-the-orbit — per the B/mini-
  // diagram brief. Built up below once the target params are known; emitted
  // as a direct (non-collision, always-on) plated text since it's pinned to
  // a fixed screen corner, not anchored to scene geometry.
  let titleTxt=null;

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
    reg(p0.x, p0.y-9, 'Injection', 10, accent, 'burn');
    titleTxt=`C3 = ${c3v>=0?'+':''}${c3v.toFixed(1)} km²/s²`;
  } else {
    const rApo=R_e+apoAlt, rPeri=R_e+periAlt;
    const inc=gn('inclination');

    if(Math.abs(rApo-r_park)<5 && Math.abs(rPeri-r_park)<5){
      // Target ≈ parking: single circle only, no transfer arc.
      const rPx=rApo*scale;
      out+=`<circle cx="0" cy="0" r="${rPx.toFixed(2)}" fill="none" stroke="${accent}" stroke-width="2"/>`;
      titleTxt=`TARGET ${_odFmtAlt(rApo,R_e)}${inc?(' · '+inc.toFixed(1)+'°'):''}`;
    } else {
      // Target ellipse/circle via 574's pure geometry helper.
      const g=_trajEllipseGeom(periAlt,apoAlt,R_e);
      const gCirc=Math.abs(g.rApo-g.rPeri)<Math.max(1,R_e*0.001);
      const gcx=-g.c*scale, grx=g.a*scale, gry=g.b*scale;
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
        titleTxt=`TARGET ${_odFmtAlt(rApo,R_e)}${inc?(' · '+inc.toFixed(1)+'°'):''}`;
      } else {
        out+=`<ellipse cx="${gcx.toFixed(2)}" cy="0" rx="${grx.toFixed(2)}" ry="${gry.toFixed(2)}" fill="none" stroke="${accent}" stroke-width="2"/>`;
        titleTxt=`TARGET ${_odFmtAlt(rPeri,R_e)}×${_odFmtAlt(rApo,R_e)}${inc?(' · '+inc.toFixed(1)+'°'):''}`;
      }

      if(!redundant){
        // Hohmann transfer arc, parking -> target apoapsis, with 2 burn dots at
        // the tangent points (periapsis-side and apoapsis-side of the transfer).
        // Apse-line aligned with the target ellipse (rotDeg=0 on both — see
        // the bug-fix note above _trajEllipseGeom's callers): the arrival dot
        // (arc.arrX/arrY) coincides with the target ellipse's apoapsis point.
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
  }

  // ── overlay resolution (layer 2) ──────────────────────────────────────
  // `out` above is WORLD-layer geometry only (rings/ellipses/discs/arcs), in
  // world-unit (km*scale) coords, [-_OD_VBW/2.._OD_VBW/2] x [-_OD_VBH/2.._OD_VBH/2].
  // Everything text/plate/marker goes through the SAME projection+resolve
  // path as 574: a synthetic camera whose box equals the world viewBox
  // (cam.w=_OD_VBW, centered at 0,0), projected against the panel's ACTUAL
  // measured rendered rect (odRect) — NOT the nominal _OD_VBW x _OD_VBH box.
  // The panel's CSS aspect-ratio is pinned to match _OD_VBW/_OD_VBH (see
  // #orbit-diagram in styles.css) so the two boxes are always the same
  // ASPECT, but the panel can render at any absolute size (350px wide on a
  // narrow layout, 900px on a wide one) — using the nominal box here would
  // silently stretch-scale every overlay px (font-size 10.5 rendering at
  // ~27px when the real box is ~2.5x the nominal one, the bug this fixes).
  // The overlay <svg>'s own viewBox is set to this same real-px rect below,
  // so world-unit-authored fixed-corner math (already in the -W/2..W/2 box)
  // still projects correctly through toPx().
  const odHost = document.getElementById('orbit-diagram');
  const odHostRect = odHost ? odHost.getBoundingClientRect() : null;
  const odRealW = (odHostRect && odHostRect.width > 0) ? odHostRect.width : _OD_VBW;
  const odRealH = (odHostRect && odHostRect.height > 0) ? odHostRect.height : _OD_VBH;
  const odCam = { cx: 0, cy: 0, w: _OD_VBW };
  const odRect = { width: odRealW, height: odRealH };
  let overlay = _trajResolveLabels(odCam, odRect);

  // Fixed-corner overlays (not part of the collision pass — pinned screen
  // positions, plated for legibility over geometry): title top-left (≤11px,
  // per brief), coplanar note + warn bottom-left, Earth-cap note in the footer.
  // These are already expressed in the same world-unit box, so projecting
  // through _trajWorldToScreen against odCam/odRect is an identity mapping
  // here (offset by the half-box + the same box origin) — done explicitly
  // (not hand-rolled) so this stays on the one shared projection path.
  const toPx = (x, y) => _trajWorldToScreen(x, y, odCam, odRect);
  const plateRect=(x,y,w,h)=>`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="var(--panel-tint-plate)" rx="2"/>`;
  if(titleTxt){
    const tw=_trajTextWidthPx(titleTxt,10.5);
    const p=toPx(-_OD_VBW/2+8, -_OD_VBH/2+16);
    overlay+=plateRect(p.x-3, p.y-11, tw+6, 15)+`<text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" font-family="var(--mono)" font-size="10.5" fill="${accent}">${titleTxt}</text>`;
  }
  if(!isEsc){
    const noteTxt='coplanar · inc annotated';
    const nw=_trajTextWidthPx(noteTxt,10);
    const p=toPx(-_OD_VBW/2+8, _OD_VBH/2-10);
    overlay+=plateRect(p.x-3, p.y-11, nw+6, 14)+`<text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" font-family="var(--mono)" font-size="10" fill="${dimColor}">${noteTxt}</text>`;
  } else {
    // titleTxt already carries the C3 readout in escape mode (moved to the
    // corner header above), so no separate bottom-left note is needed here.
  }

  if(warn){
    const ww=_trajTextWidthPx(warn,10);
    const p=toPx(0, _OD_VBH/2-26);
    overlay+=plateRect(p.x-ww/2-3, p.y-11, ww+6, 14)+`<text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="${warnColor}">${warn}</text>`;
  }

  // J2 readout chip (R4) — compact secular-rate line for the defined orbit,
  // Earth-only diagram so PROG_BODY_J2.Earth is the only entry that matters
  // here. Shown whenever inclination is authored (non-blank/non-zero input)
  // and the target apsides resolve to a real orbit.
  let j2Html='';
  if(!isEsc && typeof physJ2NodalRate==='function'){
    const incEl=document.getElementById('inclination');
    const incRaw=incEl?incEl.value:'';
    const incAuthored=incRaw!=='' && !isNaN(parseFloat(incRaw));
    if(incAuthored){
      const rApo=R_e+apoAlt, rPeri=R_e+periAlt;
      const aKm=(rApo+rPeri)/2, eEcc=(rApo-rPeri)/(rApo+rPeri);
      const iRad=inc*Math.PI/180;
      const nodalRate=physJ2NodalRate(aKm,eEcc,iRad,'Earth');
      const apsidalRate=physJ2ApsidalRate(aKm,eEcc,iRad,'Earth');
      if(nodalRate!=null && apsidalRate!=null){
        const nodalDegDay=nodalRate*(180/Math.PI)*86400;
        const apsidalDegDay=apsidalRate*(180/Math.PI)*86400;
        const ss=physJ2SunSyncCheck(aKm,eEcc,iRad,'Earth');
        let line=`J2: node ${nodalDegDay>=0?'+':''}${nodalDegDay.toFixed(2)}°/day · apsis ${apsidalDegDay>=0?'+':''}${apsidalDegDay.toFixed(2)}°/day`;
        j2Html=`<div class="od-footer-note">${line}${(ss&&ss.sunSync)?' · <span style="color:var(--accent)">sun-synchronous ✓</span>':''}</div>`;
      }
    }
  }

  const footerNote=earthCapped?'Earth size schematic':'';
  const footerHtml=(footerNote?`<div class="od-footer-note">${footerNote}</div>`:'')+j2Html;
  host.innerHTML=`<svg class="od-svg" viewBox="-${_OD_VBW/2} -${_OD_VBH/2} ${_OD_VBW} ${_OD_VBH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${out}</svg>`
    + `<svg class="od-overlay" viewBox="0 0 ${odRealW.toFixed(2)} ${odRealH.toFixed(2)}" width="100%" height="100%" preserveAspectRatio="none">${overlay}</svg>`
    + footerHtml;
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
