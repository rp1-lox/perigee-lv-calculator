
// ─── ORBITS-PAGE VEHICLE SELECTOR ─────────────
// Page-local override: lets the Orbits page evaluate ANY library vehicle
// (built-in preset or user-saved LV) against the current destination inputs,
// WITHOUT touching the worksheet (the Vehicles page state / stageStore / DOM).
// Session-only — not persisted, not part of autosave.
//   null           = "Worksheet (current)" -> classic calculateWithS15() path.
//   {kind,idx,name}= a library vehicle -> pure orbCalcSelectedVehicle() path.
let _orbVehSel = null;

// Thin alias onto the canonical escaper (escHtml, 015-version.js — UNIFICATION_AUDIT item 5).
function _orbVehEsc(s){return escHtml(s);}

// Build the <select> options: Worksheet + optgroups for presets / user vehicles.
function _orbVehSelectorOptionsHTML(){
  let html = `<option value="">Worksheet (current)</option>`;
  const presets = (typeof BUILTIN_PRESETS !== 'undefined') ? BUILTIN_PRESETS : [];
  if (presets.length) {
    html += `<optgroup label="Presets">`;
    presets.forEach((p, i) => {
      html += `<option value="builtin:${i}">${_orbVehEsc(p.name)}</option>`;
    });
    html += `</optgroup>`;
  }
  const user = (typeof userLVs !== 'undefined') ? userLVs : [];
  if (user.length) {
    html += `<optgroup label="My Vehicles">`;
    user.forEach((v, i) => {
      html += `<option value="user:${i}">${_orbVehEsc(v.name || 'Unnamed')}</option>`;
    });
    html += `</optgroup>`;
  }
  return html;
}

// Render (or re-render) the selector bar. Called on page show / after saves.
function orbVehRenderSelectorBar(){
  const mount = document.getElementById('orb-veh-selector-bar');
  if (!mount) return;
  const selVal = _orbVehSel ? `${_orbVehSel.kind}:${_orbVehSel.idx}` : '';
  mount.innerHTML = `
    <span class="sl" style="margin:0;">Vehicle:</span>
    <select id="orb-veh-select" onchange="orbVehOnSelectorChange(this.value)"
      style="font-family:var(--mono);font-size:11px;background:var(--panel);color:var(--text-bright);border:1px solid var(--border-bright);padding:5px 8px;max-width:260px;">
      ${_orbVehSelectorOptionsHTML()}
    </select>
    ${_orbVehSel ? `<span style="font-family:var(--mono);font-size:10px;letter-spacing:.06em;padding:3px 9px;border:1px solid var(--accent);color:var(--accent);background:var(--accent-tint);">LIBRARY: ${_orbVehEsc(_orbVehSel.name)}</span>` : ''}
  `;
  const sel = document.getElementById('orb-veh-select');
  if (sel) sel.value = selVal;
  _orbVehUpdateUseInProgramBtn();
}

function orbVehOnSelectorChange(val){
  if (!val) { _orbVehSel = null; orbVehRenderSelectorBar(); return; }
  const [kind, idxStr] = val.split(':');
  const idx = parseInt(idxStr, 10);
  const src = kind === 'builtin' ? BUILTIN_PRESETS[idx] : userLVs[idx];
  if (!src) { _orbVehSel = null; orbVehRenderSelectorBar(); return; }
  _orbVehSel = { kind, idx, name: src.name || 'Unnamed' };
  orbVehRenderSelectorBar();
}

// "Use in Program" is worksheet-only — disable with a tooltip while a library
// vehicle is selected, to avoid mixing the two.
function _orbVehUpdateUseInProgramBtn(){
  const btn = document.getElementById('orb-use-in-program-btn');
  if (!btn) return;
  if (_orbVehSel) {
    btn.disabled = true;
    btn.title = `Disabled: "${_orbVehSel.name}" (library vehicle) is selected on the Orbits page. Switch to Worksheet to use the Vehicles-page vehicle in the Program.`;
  } else {
    btn.disabled = false;
    btn.title = 'Load this vehicle into the active Program as a VehicleDefinition';
  }
}

// Read the destination the SAME way calculate() does — mirrors the DOM reads
// only, does not touch worksheet stage state. Returns a dest object matching
// destOnOrbitDV()'s expected shape.
function _orbVehReadDestFromDOM(){
  if (destMode === 'escape') {
    return { mode: 'escape', c3: gv('c3'), decl: gv('decl'), perigee: gv('escape-perigee') };
  }
  return { mode: 'orbit', apogee: gv('apogee'), perigee: gv('perigee'), inc: gv('inclination'), parkingAlt: gv('parking-alt') };
}

function _orbVehModeLabel(dest){
  return dest.mode === 'escape' ? `C3 = ${dest.c3} km²/s²` : `${dest.apogee}×${dest.perigee} km @ ${dest.inc}°`;
}

// Pure-path CALCULATE for a selected library vehicle. Never calls calculate().
function orbCalcSelectedVehicle(){
  const panel = document.getElementById('results-panel');
  if (!panel) return;
  showPage('results');
  if (!_orbVehSel) { calculateWithS15(); return; }

  const src = _orbVehSel.kind === 'builtin' ? BUILTIN_PRESETS[_orbVehSel.idx] : userLVs[_orbVehSel.idx];
  if (!src) {
    panel.innerHTML = `<div class="error-msg">// ERROR: Selected vehicle no longer exists.</div>`;
    return;
  }

  try {
    const base = _tsVehicleToBase(src);
    const dest = _orbVehReadDestFromDOM();
    const ddv = destOnOrbitDV(dest, base.siteLat);
    if (ddv.error) {
      panel.innerHTML = `<div class="error-msg">// ERROR: ${ddv.error}</div>`;
      return;
    }
    const onOrbitDV = ddv.onOrbitDV;
    const parkingAlt = ddv.parkingAlt;

    // S1.5 stages must be BECO-split before the pure physics (same fix as the
    // trade study's _tsMetricAt — lvPerformance knows nothing about s15 fields).
    const stages = (typeof _tsExpandStages === 'function') ? _tsExpandStages(base.stages) : base.stages;
    const maxPay = lvMaxPayload(stages, base.boosterArg, base.fairingM, base.fairingJ, parkingAlt, onOrbitDV, base.siteLat, base.azMin, base.azMax);
    const res = lvPerformance(stages, base.boosterArg, maxPay, base.fairingM, base.fairingJ, parkingAlt, onOrbitDV, base.siteLat, base.azMin, base.azMax);

    const fD = v => (v / 1000).toFixed(3) + ' km/s';
    const fM = v => Math.round(v).toLocaleString() + ' kg';
    const fS = v => Math.round(v) + ' s';
    const modeLabel = _orbVehModeLabel(dest);
    const badge = dest.mode === 'escape' ? '<span class="escape-badge">ESCAPE</span>' : '';

    const dvMax = Math.max(...res.sDVs, 1);
    const bars = res.sDVs.map((dv, i) => `<div style="margin-bottom:4px;"><div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:2px;">STG ${i + 1}</div><div class="dv-bar"><div class="dv-bar-fill" style="width:${Math.min(100, dv / dvMax * 100)}%"></div></div></div>`).join('');
    const bdown = res.sDVs.map((dv, i) => `<div class="breakdown-row"><span>Stage ${i + 1}</span><span>${fD(dv)}</span></div>`).join('');
    const TWR = res.A0 / G0;
    const feasible = res.margin >= -50;

    panel.innerHTML = `
      <div class="result-row"><span class="result-label">Target${badge}</span><span class="result-val" style="font-size:11px;color:var(--text-dim)">${modeLabel}</span></div>
      <div class="result-row"><span class="result-label">Est. Max Payload</span><span class="result-val ${maxPay > 0 ? 'hl' : 'neg'}">${fM(maxPay)}</span></div>
      <div class="result-row"><span class="result-label">Capacity Range (±10%)</span><span class="result-val" style="font-size:11px;">${maxPay > 0 ? fM(maxPay * .9) + ' – ' + fM(maxPay * 1.1) : '—'}</span></div>
      <div class="result-row"><span class="result-label">Mission Feasible?</span><span class="result-val ${feasible ? '' : 'neg'}">${feasible ? '✓ YES' : '✗ NO'}</span></div>
      <div class="result-row"><span class="result-label">Total ΔV Available</span><span class="result-val">${fD(res.tDV)}</span></div>
      <div class="result-row"><span class="result-label">ΔV Required (ascent to park)</span><span class="result-val">${fD(res.DVasc)}</span></div>
      <div class="result-row"><span class="result-label">ΔV Required (${dest.mode === 'escape' ? 'injection' : 'on-orbit'})</span><span class="result-val">${fD(onOrbitDV)}</span></div>
      <div class="result-row"><span class="result-label">ΔV Required (total)</span><span class="result-val">${fD(res.DVtot)}</span></div>
      <div class="result-row"><span class="result-label">ΔV Margin</span><span class="result-val ${res.margin >= 0 ? '' : 'neg'}">${fD(res.margin)}</span></div>
      <div class="result-row"><span class="result-label">Launch T:W Ratio</span><span class="result-val ${TWR >= 1.2 ? '' : 'neg'}">${TWR.toFixed(3)}</span></div>
      <div class="result-row"><span class="result-label">Total Burn Time</span><span class="result-val">${fS(res.tBT)}</span></div>
      <div class="stage-breakdown" style="margin-top:14px;">
        <div class="sl" style="margin-bottom:8px;">Stage ΔV Breakdown</div>
        ${bars}${bdown}
      </div>
      <div class="note">Computed for: <b>${_orbVehEsc(_orbVehSel.name)}</b> (library vehicle — worksheet unchanged).<br>Method: Townsend-Schilling (2009). Always use vacuum Isp.</div>`;
  } catch (e) {
    panel.innerHTML = `<div class="error-msg">// CALCULATION ERROR: ${e.message}</div>`;
    console.error(e);
  }

  condenseResultsPanel();
}
