
// ─── THEMES ─────────────────────────────────────
const BUILTIN_THEMES={
  default:{name:'Default (Dark)',
    '--bg':'#0a0c10','--panel':'#0f1318','--input':'#0b0e13','--border':'#1e2530','--border-bright':'#2e3d50',
    '--accent':'#00c8ff','--accent2':'#ff6b35','--accent3':'#7fff6b',
    '--text':'#c8d8e8','--text-dim':'#5a7080','--text-bright':'#e8f4ff',
    '--mono':"'JetBrains Mono',monospace",'--sans':"'Outfit',sans-serif",
    '--nm-bg':'#080a0e','--nm-earth':'#44b06a','--nm-lunar':'#7888c8','--nm-interp':'#cc5040',
    '--nm-edge':'#2a3545','--nm-edge-act':'#00c8ff','--nm-node-fill':'#0f1318',
    '--nm-label':'#5a7080','--nm-pill-bg':'#0f1318','--nm-pill-bd':'#1e2530','--nm-pill-text':'#5a7080',
    '--nm-pal-bg':'#070910','--nm-pal-hdr':'#060709','--nm-pal-item':'#0f1318','--nm-pal-item-act':'#081210','--nm-ghost':'#1e2530'},
  perigee:{name:'Perigee',
    '--bg':'#3b393a','--panel':'#2e2c2d','--input':'#3a3739','--border':'#524f50','--border-bright':'#6e6b6c',
    '--accent':'#88c657','--accent2':'#c6a057','--accent3':'#b0e080',
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
  Object.entries(t).forEach(([k,v])=>{if(k.startsWith('--'))document.documentElement.style.setProperty(k,v);});
  document.body.style.backgroundImage='none';
  const sel=document.getElementById('theme-select');
  if(sel){for(const o of sel.options){if(o.value===key){sel.value=key;break;}}}
  if(typeof progRenderNodeMap==='function')progRenderNodeMap();
  if(typeof artUpdateInvertFilter==='function')artUpdateInvertFilter();
}
function rebuildThemeSelect(){
  const sel=document.getElementById('theme-select');const cur=sel.value;sel.innerHTML='';
  Object.entries(BUILTIN_THEMES).forEach(([k,t])=>{const o=document.createElement('option');o.value=k;o.textContent=t.name;sel.appendChild(o);});
  Object.entries(customThemes).forEach(([k,t])=>{const o=document.createElement('option');o.value=k;o.textContent=(t.name||k)+' (custom)';sel.appendChild(o);});
  sel.value=(cur in BUILTIN_THEMES||cur in customThemes)?cur:'perigee';
}