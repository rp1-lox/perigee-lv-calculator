
// ─── THEMES ─────────────────────────────────────
const BUILTIN_THEMES={
  default:{name:'Default (Dark)',
    '--bg':'#0a0c10','--panel':'#0f1318','--input':'#0b0e13','--border':'#1e2530','--border-bright':'#2e3d50',
    '--accent':'#00c8ff','--accent2':'#ff6b35','--accent3':'#7fff6b',
    '--danger':'#ff4444','--warn':'#ffb020',
    '--text':'#c8d8e8','--text-dim':'#5a7080','--text-bright':'#e8f4ff',
    '--mono':"'JetBrains Mono',monospace",'--sans':"'Outfit',sans-serif",
    '--nm-bg':'#080a0e','--nm-earth':'#44b06a','--nm-lunar':'#7888c8','--nm-interp':'#cc5040',
    '--nm-edge':'#2a3545','--nm-edge-act':'#00c8ff','--nm-node-fill':'#0f1318',
    '--nm-label':'#5a7080','--nm-pill-bg':'#0f1318','--nm-pill-bd':'#1e2530','--nm-pill-text':'#5a7080',
    '--nm-pal-bg':'#070910','--nm-pal-hdr':'#060709','--nm-pal-item':'#0f1318','--nm-pal-item-act':'#081210','--nm-ghost':'#1e2530'},
  perigee:{name:'Perigee',
    '--bg':'#3b393a','--panel':'#2e2c2d','--input':'#3a3739','--border':'#524f50','--border-bright':'#6e6b6c',
    '--accent':'#88c657','--accent2':'#c6a057','--accent3':'#b0e080',
    '--danger':'#b8564a','--warn':'#c6a057',
    '--text':'#e7e8ea','--text-dim':'#a7a6a4','--text-bright':'#ffffff',
    '--mono':"'JetBrains Mono',monospace",'--sans':"'Outfit',sans-serif",
    '--nm-bg':'#282628','--nm-earth':'#5db877','--nm-lunar':'#8890bc','--nm-interp':'#b85848',
    '--nm-edge':'#5a5758','--nm-edge-act':'#88c657','--nm-node-fill':'#2e2c2d',
    '--nm-label':'#a7a6a4','--nm-pill-bg':'#2e2c2d','--nm-pill-bd':'#524f50','--nm-pill-text':'#a7a6a4',
    '--nm-pal-bg':'#252325','--nm-pal-hdr':'#1e1c1e','--nm-pal-item':'#2e2c2d','--nm-pal-item-act':'#1e2419','--nm-ghost':'#524f50'},
};;
let customThemes={};
let activeThemeKey='perigee';

function getTheme(key){return customThemes[key]||BUILTIN_THEMES[key]||BUILTIN_THEMES.perigee;}
function applyTheme(key){
  activeThemeKey=key;
  const t=getTheme(key);
  const fallback=BUILTIN_THEMES.default;
  Object.entries(t).forEach(([k,v])=>{if(k.startsWith('--'))document.documentElement.style.setProperty(k,v);});
  // Guard: legacy custom theme files predating --danger/--warn shouldn't leave
  // those seeds unset (would break derived --danger-tint/etc in styles.css).
  ['--danger','--warn'].forEach(k=>{if(!t[k])document.documentElement.style.setProperty(k,fallback[k]);});
  document.body.style.backgroundImage='none';
  const sel=document.getElementById('theme-select');
  if(sel){for(const o of sel.options){if(o.value===key){sel.value=key;break;}}}
  if(typeof progRenderNodeMap==='function')progRenderNodeMap();
  if(typeof artUpdateInvertFilter==='function')artUpdateInvertFilter();
  if(typeof autosaveScheduleSave==='function')autosaveScheduleSave();
}
function rebuildThemeSelect(){
  const sel=document.getElementById('theme-select');const cur=sel.value;sel.innerHTML='';
  Object.entries(BUILTIN_THEMES).forEach(([k,t])=>{const o=document.createElement('option');o.value=k;o.textContent=t.name;sel.appendChild(o);});
  Object.entries(customThemes).forEach(([k,t])=>{const o=document.createElement('option');o.value=k;o.textContent=(t.name||k)+' (custom)';sel.appendChild(o);});
  sel.value=(cur in BUILTIN_THEMES||cur in customThemes)?cur:'perigee';
}

// ─── COLOR MATH HELPERS (hex <-> HSL, mixing) ───────────────────────
// Small, dependency-free helpers used by themeFromSeeds() to derive a full
// theme from just a handful of "core" seed colors.
function _hexToRgb(hex){
  hex=(hex||'#000000').replace('#','');
  if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');
  const n=parseInt(hex,16);
  return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};
}
function _rgbToHex({r,g,b}){
  const h=v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
  return '#'+h(r)+h(g)+h(b);
}
function _rgbToHsl({r,g,b}){
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b);
  let h=0,s=0;const l=(max+min)/2;
  const d=max-min;
  if(d!==0){
    s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){
      case r:h=((g-b)/d+(g<b?6:0));break;
      case g:h=((b-r)/d+2);break;
      case b:h=((r-g)/d+4);break;
    }
    h*=60;
  }
  return {h,s,l};
}
function _hslToRgb({h,s,l}){
  h=((h%360)+360)%360;
  if(s===0){const v=l*255;return {r:v,g:v,b:v};}
  const q=l<0.5?l*(1+s):l+s-l*s;
  const p=2*l-q;
  const hk=h/360;
  const t=[hk+1/3,hk,hk-1/3].map(x=>{
    if(x<0)x+=1;if(x>1)x-=1;
    if(x<1/6)return p+(q-p)*6*x;
    if(x<1/2)return q;
    if(x<2/3)return p+(q-p)*(2/3-x)*6;
    return p;
  });
  return {r:t[0]*255,g:t[1]*255,b:t[2]*255};
}
/** Mix two hex colors; amt = fraction of hex2 (0..1). */
function hexMix(hex1,hex2,amt){
  const a=_hexToRgb(hex1),b=_hexToRgb(hex2);
  return _rgbToHex({r:a.r+(b.r-a.r)*amt,g:a.g+(b.g-a.g)*amt,b:a.b+(b.b-a.b)*amt});
}
/** Lighten (amt>0) or darken (amt<0) a hex color by shifting HSL lightness. */
function hexLighten(hex,amt){
  const hsl=_rgbToHsl(_hexToRgb(hex));
  hsl.l=Math.max(0,Math.min(1,hsl.l+amt));
  return _rgbToHex(_hslToRgb(hsl));
}
/** Rotate hue by deg degrees, optionally nudging saturation/lightness. */
function hexHueRotate(hex,deg,dl){
  const hsl=_rgbToHsl(_hexToRgb(hex));
  hsl.h+=deg;
  if(dl)hsl.l=Math.max(0,Math.min(1,hsl.l+dl));
  return _rgbToHex(_hslToRgb(hsl));
}
/** Lighten a color toward a target (e.g. panel toward text) by fraction. */
function hexTowards(hex,target,amt){return hexMix(hex,target,amt);}

/**
 * Derive a full theme object from just the 4 "core" seeds:
 *   { bg, panel, accent, text, name? }
 * Everything else (borders, input, accent2/3, text-dim/bright, danger/warn,
 * and the full nm-* node-map palette) is computed with sensible defaults.
 * Callers can override any individual derived value afterward — this just
 * gives a coherent starting point.
 */
function themeFromSeeds(core){
  const bg=core.bg||'#0a0c10';
  const panel=core.panel||'#0f1318';
  const accent=core.accent||'#00c8ff';
  const text=core.text||'#c8d8e8';
  const fallback=BUILTIN_THEMES.default;

  const border=hexTowards(panel,text,0.15);
  const borderBright=hexTowards(panel,text,0.30);
  const input=hexMix(bg,panel,0.5);
  const textDim=hexMix(text,bg,0.55);
  const textBright=hexTowards(text,'#ffffff',0.6);
  const accent2=core.accent2||hexHueRotate(accent,40);
  const accent3=core.accent3||hexLighten(accent,0.20);
  const danger=core.danger||fallback['--danger'];
  const warn=core.warn||fallback['--warn'];

  // Node-map palette — derived from bg/panel/accent, matching what each
  // builtin theme's nm-* set looks like relative to its own bg/panel/accent.
  const nmBg=hexLighten(bg,-0.02);
  const nmEarth=core['--nm-earth']||hexHueRotate(accent,-90,0.05);
  const nmLunar=core['--nm-lunar']||hexHueRotate(accent,140,0.05);
  const nmInterp=core['--nm-interp']||hexHueRotate(accent,150,-0.05);
  const nmEdge=hexTowards(panel,text,0.20);
  const nmEdgeAct=accent;
  const nmNodeFill=panel;
  const nmLabel=textDim;
  const nmPillBg=panel;
  const nmPillBd=border;
  const nmPillText=textDim;
  const nmPalBg=hexLighten(bg,-0.03);
  const nmPalHdr=hexLighten(bg,-0.04);
  const nmPalItem=panel;
  const nmPalItemAct=hexMix(panel,accent,0.10);
  const nmGhost=border;

  return {
    name:core.name||'Custom Theme',
    '--bg':bg,'--panel':panel,'--input':input,'--border':border,'--border-bright':borderBright,
    '--accent':accent,'--accent2':accent2,'--accent3':accent3,
    '--danger':danger,'--warn':warn,
    '--text':text,'--text-dim':textDim,'--text-bright':textBright,
    '--mono':core['--mono']||"'JetBrains Mono',monospace",'--sans':core['--sans']||"'Outfit',sans-serif",
    '--nm-bg':nmBg,'--nm-earth':nmEarth,'--nm-lunar':nmLunar,'--nm-interp':nmInterp,
    '--nm-edge':nmEdge,'--nm-edge-act':nmEdgeAct,'--nm-node-fill':nmNodeFill,
    '--nm-label':nmLabel,'--nm-pill-bg':nmPillBg,'--nm-pill-bd':nmPillBd,'--nm-pill-text':nmPillText,
    '--nm-pal-bg':nmPalBg,'--nm-pal-hdr':nmPalHdr,'--nm-pal-item':nmPalItem,'--nm-pal-item-act':nmPalItemAct,'--nm-ghost':nmGhost,
  };
}
