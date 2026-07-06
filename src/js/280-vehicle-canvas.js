
// ─── VEHICLE CANVAS ───────────────────────────
let stageArtMap = {};         // slotKey ('s0','s1',...,'booster') → artId
let vehicleCanvasItems = [];  // freeform canvas items [{id,artId,x,y,w,h}]
let _vehCiDrag = null;
let _vehArtPickerSlot = null;

/** Render all vehicle canvas items into #veh-canvas. */
function vehCanvasRender() {
  const canvas = document.getElementById('veh-canvas');
  if (!canvas) return;
  canvas.innerHTML = vehicleCanvasItems.map(item => {
    const art = PROG_ART_REGISTRY[item.artId];
    if (!art) return '';
    return `<div class="art-ci" id="vci-${item.id}"
        style="left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;"
        onmousedown="vehCiMousedown(event,'${item.id}','move')">
      <img src="${art.dataURL}"${art.monochrome?' class="art-mono"':''} style="width:100%;height:100%;object-fit:contain;display:block;">
      <div class="art-ci-del" onmousedown="event.stopPropagation()"
        onclick="event.stopPropagation();vehCanvasRemove('${item.id}')">✕</div>
      <div class="art-ci-rsz"
        onmousedown="event.stopPropagation();vehCiMousedown(event,'${item.id}','resize')"></div>
    </div>`;
  }).join('');
}

function vehCanvasRemove(id) {
  vehicleCanvasItems = vehicleCanvasItems.filter(i => i.id !== id);
  vehCanvasRender();
}

function vehCanvasClear() {
  vehicleCanvasItems = [];
  vehCanvasRender();
}

/** Place assigned stage art proportionally (top = last stage, bottom = first/booster). */
function vehCanvasAutoLayout() {
  vehicleCanvasItems = [];
  const canvas = document.getElementById('veh-canvas');
  if (!canvas) return;
  const cw = canvas.offsetWidth  || 180;
  const ch = canvas.offsetHeight || 400;

  const slots = [];
  for (let s = numStages - 1; s >= 0; s--) {
    const artId = stageArtMap['s' + s];
    if (artId && PROG_ART_REGISTRY[artId])
      slots.push({ artId, prop: Math.max(1, parseFloat(stageStore[s]?.prop) || 1) });
  }
  if (useBooster) {
    const artId = stageArtMap['booster'];
    if (artId && PROG_ART_REGISTRY[artId])
      slots.push({ artId, prop: Math.max(1, parseFloat(document.getElementById('b_prop')?.value) || 1) });
  }
  if (!slots.length) { vehCanvasRender(); return; }

  const maxProp = Math.max(...slots.map(s => s.prop));
  const gap     = 3;
  const totalGap = (slots.length - 1) * gap;
  const availH  = ch - 16 - totalGap;
  const getH    = p => Math.max(18, Math.round((p / maxProp) * availH / slots.length * 2));
  const w       = Math.min(cw - 16, 150);
  const x       = Math.round((cw - w) / 2);
  const totalH  = slots.reduce((a, s) => a + getH(s.prop), 0) + totalGap;
  let y         = Math.max(8, Math.round((ch - totalH) / 2));

  slots.forEach(slot => {
    const h  = getH(slot.prop);
    const id = 'vci' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    vehicleCanvasItems.push({ id, artId: slot.artId, x, y, w, h });
    y += h + gap;
  });
  vehCanvasRender();
}

/** Called when stages change — auto-layouts only if canvas is currently empty. */
function vehCanvasOnStagesChanged() {
  if (vehicleCanvasItems.length === 0) vehCanvasAutoLayout();
}

/** Rebuild the per-stage art assignment strip above the canvas. */
function vehBuildAssignStrip() {
  const strip = document.getElementById('veh-stage-assign');
  if (!strip) return;
  let html = '';
  const slotSize = 28;
  const slots = [];
  for (let s = 0; s < numStages; s++) slots.push({ key: 's' + s, lbl: 'S' + (s + 1) });
  if (useBooster) slots.push({ key: 'booster', lbl: 'B' });

  slots.forEach(slot => {
    const artId = stageArtMap[slot.key];
    const art   = artId ? PROG_ART_REGISTRY[artId] : null;
    html += `<div onclick="vehArtOpenPicker('${slot.key}')" title="Assign art to ${slot.lbl}"
      style="width:${slotSize}px;height:${slotSize}px;flex-shrink:0;cursor:pointer;
        border:1px ${art ? 'solid var(--accent)' : 'dashed var(--border)'};
        display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">`;
    if (art) {
      html += `<img src="${art.dataURL}"${art.monochrome?' class="art-mono"':''} style="width:100%;height:100%;object-fit:contain;">`;
    } else {
      html += `<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);">${slot.lbl}</span>`;
    }
    html += `</div>`;
  });
  strip.innerHTML = html;
}

function vehCiMousedown(e, id, type) {
  e.preventDefault();
  const item = vehicleCanvasItems.find(i => i.id === id);
  if (!item) return;
  // Bring to front
  vehicleCanvasItems = vehicleCanvasItems.filter(i => i.id !== id);
  vehicleCanvasItems.push(item);
  vehCanvasRender();
  _vehCiDrag = { type, id, sx: e.clientX, sy: e.clientY, ox: item.x, oy: item.y, ow: item.w, oh: item.h };
  document.getElementById('vci-' + id)?.classList.add('sel');
  document.addEventListener('mousemove', _vehDragMove, { passive: false });
  document.addEventListener('mouseup',   _vehDragEnd,  { once: true });
}

function _vehDragMove(e) {
  if (!_vehCiDrag) return;
  const dx = e.clientX - _vehCiDrag.sx, dy = e.clientY - _vehCiDrag.sy;
  const item = vehicleCanvasItems.find(i => i.id === _vehCiDrag.id);
  if (!item) return;
  const canvas = document.getElementById('veh-canvas');
  const cw = canvas ? canvas.offsetWidth  : 9999;
  const ch = canvas ? canvas.offsetHeight : 9999;
  if (_vehCiDrag.type === 'move') {
    item.x = Math.max(0, Math.min(_vehCiDrag.ox + dx, cw - item.w));
    item.y = Math.max(0, Math.min(_vehCiDrag.oy + dy, ch - item.h));
  } else {
    item.w = Math.max(20, _vehCiDrag.ow + dx);
    item.h = Math.max(20, _vehCiDrag.oh + dy);
  }
  const el = document.getElementById('vci-' + item.id);
  if (el) { el.style.left=item.x+'px'; el.style.top=item.y+'px'; el.style.width=item.w+'px'; el.style.height=item.h+'px'; }
}

function _vehDragEnd() {
  document.removeEventListener('mousemove', _vehDragMove);
  if (_vehCiDrag) { document.getElementById('vci-'+_vehCiDrag.id)?.classList.remove('sel'); _vehCiDrag = null; }
}

/** Open the art picker for a stage/booster slot. */
function vehArtOpenPicker(slotKey) {
  _vehArtPickerSlot = slotKey;
  const el      = document.getElementById('veh-art-picker-list');
  if (!el) return;
  const entries = Object.values(PROG_ART_REGISTRY);
  const curId   = stageArtMap[slotKey] || null;
  const slotLbl = slotKey === 'booster' ? 'BOOSTER' : 'S' + (parseInt(slotKey.slice(1)) + 1);
  if (entries.length === 0) {
    el.innerHTML = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);padding:14px;text-align:center;">
      No art in library.<br>Go to the <b>Art</b> tab to upload images.</div>`;
  } else {
    el.innerHTML = `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);letter-spacing:.1em;padding-bottom:8px;">CHOOSE ART FOR ${slotLbl}</div>`
      + entries.map(entry => {
        const sid   = entry.artId;
        const isCur = sid === curId;
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">`
          + `<img src="${entry.dataURL}"${entry.monochrome?' class="art-mono"':''} style="width:26px;height:26px;object-fit:contain;flex-shrink:0;background:rgba(255,255,255,.04);border:1px solid var(--border);">`
          + `<span style="flex:1;min-width:0;font-family:var(--mono);font-size:10px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${entry.name}</span>`
          + `<button onclick="vehArtAssign('${sid}')" style="font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border);cursor:pointer;padding:2px 8px;white-space:nowrap;flex-shrink:0;color:${isCur?'var(--text-dim)':'var(--accent)'};">${isCur?'✓ Set':'+ Assign'}</button></div>`;
      }).join('')
      + (curId ? `<div style="padding:7px 0;"><button onclick="vehArtAssign(null)" style="width:100%;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border);color:var(--accent2);padding:3px 0;cursor:pointer;">✕ Remove Art</button></div>` : '');
  }
  openModal('modal-veh-art-picker');
}

function vehArtAssign(artId) {
  if (!_vehArtPickerSlot) return;
  if (artId) stageArtMap[_vehArtPickerSlot] = artId;
  else       delete stageArtMap[_vehArtPickerSlot];
  closeModal('modal-veh-art-picker');
  vehBuildAssignStrip();
  // Refresh canvas if auto-layout was used (re-run to pick up new assignment)
  if (vehicleCanvasItems.length === 0 || vehicleCanvasItems.every(i => i._auto)) vehCanvasAutoLayout();
}

// Track booster name
let currentBoosterName=null;
// applyBoosterData moved below(s){setBoosters(true);document.getElementById('b_dry').value=s.dry;document.getElementById('b_prop').value=s.prop;document.getElementById('b_thrust').value=s.thrust;document.getElementById('b_isp').value=s.isp;document.getElementById('b_res').value=s.res??2;currentBoosterName=s.name||null;boosterSaved=false;buildStageComposition();markLVUserDefined();}
