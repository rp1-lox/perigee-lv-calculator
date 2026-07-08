
// ─── THEMES MODAL (gallery + customize + preview) ──────────────

// All seed vars a theme carries (core group first, then node-map group).
const TE_CORE_VARS=[
  {key:'--bg',           label:'Background'},
  {key:'--panel',        label:'Panel'},
  {key:'--input',        label:'Input'},
  {key:'--border',       label:'Border'},
  {key:'--border-bright',label:'Border (highlight)'},
  {key:'--accent',       label:'Primary Accent'},
  {key:'--accent2',      label:'Secondary Accent'},
  {key:'--accent3',      label:'Tertiary Accent'},
  {key:'--text',         label:'Text (body)'},
  {key:'--text-dim',     label:'Text (dim)'},
  {key:'--text-bright',  label:'Text (bright)'},
  {key:'--danger',       label:'Danger'},
  {key:'--warn',         label:'Warn'},
];
const TE_NM_VARS=[
  {key:'--nm-bg',          label:'Node-map background'},
  {key:'--nm-earth',       label:'Earth marker'},
  {key:'--nm-lunar',       label:'Lunar marker'},
  {key:'--nm-interp',      label:'Interplanetary marker'},
  {key:'--nm-edge',        label:'Edge'},
  {key:'--nm-edge-act',    label:'Edge (active)'},
  {key:'--nm-node-fill',   label:'Node fill'},
  {key:'--nm-label',       label:'Label text'},
  {key:'--nm-pill-bg',     label:'Pill background'},
  {key:'--nm-pill-bd',     label:'Pill border'},
  {key:'--nm-pill-text',   label:'Pill text'},
  {key:'--nm-pal-bg',      label:'Palette background'},
  {key:'--nm-pal-hdr',     label:'Palette header'},
  {key:'--nm-pal-item',    label:'Palette item'},
  {key:'--nm-pal-item-act',label:'Palette item (active)'},
  {key:'--nm-ghost',       label:'Ghost'},
];
const TE_ALL_VARS=TE_CORE_VARS.concat(TE_NM_VARS);
const TE_SWATCH_KEYS=['--bg','--panel','--accent','--accent2','--accent3','--text','--danger'];

// Working copy state while the Customize panel is open.
let _teWorking=null;   // {name, --bg, ..., --sans, --mono}
let _teBaseKey=null;   // key of the theme this copy was seeded from (for label only)
let _teEditingKey=null;// if editing an existing custom theme in place (Save overwrites), else null = new

function openThemesModal(){
  teRenderGallery();
  document.getElementById('te-customize').style.display='none';
  openModal('modal-themes');
}

function teRenderGallery(){
  const g=document.getElementById('te-gallery');
  g.innerHTML='';
  const addCard=(key,t,isCustom)=>{
    const card=document.createElement('div');
    card.className='te-card'+(key===activeThemeKey?' active':'');
    const safeHex=v=>(/^#[0-9a-f]{3,8}$/i.test(v||''))?v:'#000000';
    const swatches=TE_SWATCH_KEYS.map(k=>`<span class="te-card-sw" style="background:${safeHex(t[k])}"></span>`).join('');
    const safeName=String(t.name||key).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    card.innerHTML=`
      <div class="te-card-swatches">${swatches}</div>
      <div class="te-card-name">${safeName}</div>
      <div class="te-card-actions">
        <button class="te-card-btn" data-act="use">Use</button>
        <button class="te-card-btn" data-act="copy">Edit copy</button>
        ${isCustom?'<button class="te-card-btn te-card-del" data-act="del" title="Delete">&#x2715;</button>':''}
      </div>`;
    card.querySelector('[data-act="use"]').onclick=()=>{applyTheme(key);teRenderGallery();};
    card.addEventListener('click',(e)=>{if(e.target.closest('.te-card-actions'))return;applyTheme(key);teRenderGallery();});
    card.querySelector('[data-act="copy"]').onclick=(e)=>{e.stopPropagation();teOpenCustomize(key,false);};
    if(isCustom){
      card.querySelector('[data-act="del"]').onclick=(e)=>{
        e.stopPropagation();
        showConfirm('Delete Theme','Delete theme "'+(t.name||key)+'"? This cannot be undone.',()=>{
          delete customThemes[key];
          if(activeThemeKey===key)applyTheme('perigee');
          rebuildThemeSelect();
          teRenderGallery();
          if(typeof autosaveScheduleSave==='function')autosaveScheduleSave();
        },'Delete');
      };
    }
    g.appendChild(card);
  };
  Object.entries(BUILTIN_THEMES).forEach(([k,t])=>addCard(k,t,false));
  Object.entries(customThemes).forEach(([k,t])=>addCard(k,t,true));
}

function teNewTheme(){
  teOpenCustomize(activeThemeKey,true);
}

// Open the Customize panel seeded from an existing theme (builtin or custom).
// Always edits a COPY — builtins are never mutated in place.
function teOpenCustomize(seedKey,isNew){
  const src=getTheme(seedKey);
  _teWorking=Object.assign({},src);
  _teBaseKey=seedKey;
  _teEditingKey=(!isNew && customThemes[seedKey])?seedKey:null;
  document.getElementById('te-customize-label').textContent=
    isNew?'(new theme, from '+ (src.name||seedKey) +')':'(editing copy of '+(src.name||seedKey)+')';
  document.getElementById('te-theme-name').value=
    _teEditingKey? (src.name||'') : ('Custom '+(src.name||seedKey));
  teBuildNMRows();
  tePopulate();
  document.getElementById('te-customize').style.display='block';
  document.getElementById('te-customize').scrollIntoView({block:'nearest'});
}

function teCancelCustomize(){
  _teWorking=null;_teEditingKey=null;
  document.getElementById('te-customize').style.display='none';
}

function teBuildNMRows(){
  const wrap=document.getElementById('te-nm-rows');
  wrap.innerHTML='';
  TE_NM_VARS.forEach(({key,label})=>{
    const id=key.slice(2);
    const row=document.createElement('div');row.className='te-row';
    row.innerHTML=`
      <span class="te-label">${label}</span>
      <button class="te-swatch"><div class="te-swatch-fill" id="te-fill-${id}"></div>
        <input type="color" id="te-picker-${id}" oninput="teSeedChanged('${key}',this.value)"></button>
      <input class="te-hex" id="te-hex-${id}" maxlength="7" oninput="teHexChanged('${key}',this.value)">`;
    wrap.appendChild(row);
  });
}
function teToggleNM(){
  const rows=document.getElementById('te-nm-rows');
  const caret=document.getElementById('te-nm-caret');
  const open=rows.style.display!=='none';
  rows.style.display=open?'none':'block';
  caret.innerHTML=open?'&#9656;':'&#9662;';
}

function tePopulate(){
  if(!_teWorking)return;
  TE_ALL_VARS.forEach(({key})=>{
    const id=key.slice(2);
    const val=_teWorking[key]||'#000000';
    const hex=val.startsWith('#')?val:'#000000';
    const fill=document.getElementById('te-fill-'+id);
    const picker=document.getElementById('te-picker-'+id);
    const hexEl=document.getElementById('te-hex-'+id);
    if(fill)fill.style.background=hex;
    if(picker)picker.value=hex;
    if(hexEl)hexEl.value=hex;
  });
  const stripQ=v=>(v||'').replace(/['"]/g,'').split(',')[0].trim();
  document.getElementById('te-font-sans').value=stripQ(_teWorking['--sans']||'Outfit');
  document.getElementById('te-font-mono').value=stripQ(_teWorking['--mono']||'JetBrains Mono');
  tePreviewRender();
}

function teSeedChanged(key,hex){
  if(!_teWorking)return;
  _teWorking[key]=hex;
  const id=key.slice(2);
  const fill=document.getElementById('te-fill-'+id);
  const hexEl=document.getElementById('te-hex-'+id);
  if(fill)fill.style.background=hex;
  if(hexEl)hexEl.value=hex;
  tePreviewRender();
}
function teHexChanged(key,val){
  if(!_teWorking)return;
  if(!/^#[0-9a-f]{6}$/i.test(val))return;
  _teWorking[key]=val;
  const id=key.slice(2);
  const fill=document.getElementById('te-fill-'+id);
  const picker=document.getElementById('te-picker-'+id);
  if(fill)fill.style.background=val;
  if(picker)picker.value=val;
  tePreviewRender();
}
function teFontChanged(){
  if(!_teWorking)return;
  const sans=document.getElementById('te-font-sans').value.trim();
  const mono=document.getElementById('te-font-mono').value.trim();
  if(sans)_teWorking['--sans']="'"+sans.replace(/'/g,'')+"',sans-serif";
  if(mono)_teWorking['--mono']="'"+mono.replace(/'/g,'')+"',monospace";
  tePreviewRender();
}

// Recompute everything from the 4 core seeds (bg, panel, accent, text).
// Individual pickers remain editable afterward.
function teDerive(){
  if(!_teWorking)return;
  const core={
    bg:_teWorking['--bg'],panel:_teWorking['--panel'],
    accent:_teWorking['--accent'],text:_teWorking['--text'],
    name:_teWorking.name,
  };
  const derived=themeFromSeeds(core);
  // Preserve name/fonts the user may have already set.
  derived.name=_teWorking.name||derived.name;
  derived['--sans']=_teWorking['--sans']||derived['--sans'];
  derived['--mono']=_teWorking['--mono']||derived['--mono'];
  _teWorking=derived;
  tePopulate();
}

// Render the live preview using CANDIDATE values scoped to the preview
// container only (inline style props) — never touches documentElement.
function tePreviewRender(){
  const el=document.getElementById('te-preview');
  if(!el||!_teWorking)return;
  TE_ALL_VARS.forEach(({key})=>{
    if(_teWorking[key])el.style.setProperty(key,_teWorking[key]);
  });
  if(_teWorking['--sans'])el.style.setProperty('--sans',_teWorking['--sans']);
  if(_teWorking['--mono'])el.style.setProperty('--mono',_teWorking['--mono']);
  // Derived tint vars mirror styles.css's :root formulas so the preview
  // matches what Apply will actually produce app-wide.
  el.style.setProperty('--accent-tint-soft','color-mix(in srgb, '+(_teWorking['--accent']||'#00c8ff')+' 7%, transparent)');
  el.style.setProperty('--danger-tint','color-mix(in srgb, '+(_teWorking['--danger']||'#ff4444')+' 15%, transparent)');
  el.style.setProperty('--danger-bright','color-mix(in srgb, '+(_teWorking['--danger']||'#ff4444')+' 70%, '+(_teWorking['--text-bright']||'#fff')+')');
}

function teApplyWorking(){
  if(!_teWorking)return;
  const tempKey='__preview_working__';
  customThemes[tempKey]=Object.assign({},_teWorking,{name:_teWorking.name||'(unsaved)'});
  applyTheme(tempKey);
  // Don't let the temp key linger in menus/gallery.
  delete customThemes[tempKey];
  rebuildThemeSelect();
  teRenderGallery();
}

function teSaveCustom(){
  if(!_teWorking)return;
  const name=document.getElementById('te-theme-name').value.trim()||'Custom Theme';
  const t=Object.assign({},_teWorking,{name});
  const key=_teEditingKey||('custom_'+name.replace(/\s+/g,'_').toLowerCase()+'_'+Date.now().toString(36));
  customThemes[key]=t;
  rebuildThemeSelect();
  applyTheme(key);
  teRenderGallery();
  document.getElementById('te-customize').style.display='none';
  _teWorking=null;_teEditingKey=null;
  if(typeof autosaveScheduleSave==='function')autosaveScheduleSave();
}

function exportActiveTheme(){
  const t=getTheme(activeThemeKey);
  downloadJSON(t,(t.name||activeThemeKey).replace(/[^a-z0-9_-]/gi,'_').toLowerCase()+'_theme.json');
}
function loadThemeFile(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const t=JSON.parse(e.target.result);
      const key='custom_'+(t.name||'theme').replace(/\s+/g,'_').toLowerCase()+'_'+Date.now().toString(36);
      customThemes[key]=t;
      rebuildThemeSelect();
      applyTheme(key);
      teRenderGallery();
      if(typeof autosaveScheduleSave==='function')autosaveScheduleSave();
    }catch(err){showAlert('Invalid theme JSON: '+err.message,'Invalid File');}
  };
  reader.readAsText(file);
  input.value='';
}
