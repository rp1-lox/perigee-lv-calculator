
// ─── DESTINATION ΔV (pure) ────────────────────
// DOM-free mirror of the on-orbit ΔV logic inside calculate() (160), for the
// Orbits-page vehicle selector and trade-study sweeps. Pinned against
// calculate() goldens in tests/ — change both together.
//
// dest (orbit mode):  {mode:'orbit',  apogee, perigee, inc, parkingAlt}
// dest (escape mode): {mode:'escape', c3, decl, perigee}   // perigee = parking perigee
// siteLat in degrees. Returns {onOrbitDV (m/s), parkingAlt (km), error?}.
function destOnOrbitDV(dest, siteLat){
  if(!dest) return {onOrbitDV:0, parkingAlt:185, error:'no destination'};
  if(dest.mode==='escape'){
    const c3=dest.c3||0, decl=(dest.decl!=null?dest.decl:siteLat), parkingAlt=dest.perigee!=null?dest.perigee:185;
    const Vesc2=2*MU/(RE+parkingAlt);
    if(c3<-Vesc2) return {onOrbitDV:0, parkingAlt, error:`C3=${c3} below minimum (${(-Vesc2).toFixed(1)}) for ${parkingAlt} km orbit`};
    const Vh=Math.sqrt(Vesc2+c3);
    let onOrbitDV=(Vh-Math.sqrt(MU/(RE+parkingAlt)))*1000;
    const ds=Math.max(0,Math.abs(siteLat)-Math.abs(decl)-0.5);
    if(ds>0) onOrbitDV+=2*circVel(parkingAlt)*Math.sin(ds*Math.PI/360);
    return {onOrbitDV, parkingAlt};
  }
  const apogee=dest.apogee||0, perigee=dest.perigee||0, inc=(dest.inc!=null?dest.inc:siteLat);
  const parkingAlt=dest.parkingAlt!=null?dest.parkingAlt:185;
  const rPk=RE+parkingAlt, rAp=RE+apogee, rPe=RE+perigee;
  const Vc_park=Math.sqrt(MU/rPk);
  const vPeri=(rp,ra)=>Math.sqrt(2*MU*ra/(rp*(rp+ra)));
  const vApo=(rp,ra)=>Math.sqrt(2*MU*rp/(ra*(rp+ra)));
  const destIsCirc=Math.abs(apogee-perigee)<5;
  const destIsPark=Math.abs(apogee-parkingAlt)<5&&Math.abs(perigee-parkingAlt)<5;
  const needsPlane=inc<Math.abs(siteLat)-0.5;
  const planeAngle=needsPlane?(Math.abs(siteLat)-inc)*Math.PI/180:0;
  let onOrbitDV=0;
  if(destIsPark){
    onOrbitDV=0;
  }else if(destIsCirc){
    const dv1=Math.abs(vPeri(rPk,rAp)-Vc_park)*1000;
    if(needsPlane&&apogee>10000){
      const va=vApo(rPk,rAp)*1000,vc=Math.sqrt(MU/rAp)*1000;
      onOrbitDV=dv1+Math.sqrt(va*va+vc*vc-2*va*vc*Math.cos(planeAngle));
    }else{
      onOrbitDV=dv1+Math.abs(Math.sqrt(MU/rAp)-vApo(rPk,rAp))*1000;
      if(needsPlane)onOrbitDV+=2*Vc_park*1000*Math.sin(planeAngle/2);
    }
  }else{
    const dv1=Math.abs(vPeri(rPk,rAp)-Vc_park)*1000;
    const dv2=Math.abs(perigee-parkingAlt)<50?0:Math.abs(vApo(rPe,rAp)-vApo(rPk,rAp))*1000;
    onOrbitDV=dv1+dv2;
    if(needsPlane)onOrbitDV+=2*Vc_park*1000*Math.sin(planeAngle/2);
  }
  return {onOrbitDV, parkingAlt};
}
