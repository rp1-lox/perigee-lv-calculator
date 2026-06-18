
// ─── SPACECRAFT EDITOR ────────────────────────────────────────────────

const _PROG_SC_PRESETS = [
  { name: 'Apollo CSM', stages: [
    { name: 'Service Module',          dry_mass: 6000, isp: 314, propKg: 18410, propType: 'NTO_A50', crewCapacity: 0, dockingPorts: 1, tunnelCapable: true,  isLandingTruss: false, descentPropFraction: 0 },
    { name: 'Command Module',          dry_mass: 5560, isp: 0,   propKg: 0,     propType: 'NTO_A50', crewCapacity: 3, dockingPorts: 1, tunnelCapable: true,  isLandingTruss: false, descentPropFraction: 0 },
  ]},
  { name: 'Apollo Lunar Module', stages: [
    { name: 'Descent Stage',           dry_mass: 2145, isp: 311, propKg: 8165,  propType: 'NTO_A50', crewCapacity: 2, dockingPorts: 0, tunnelCapable: false, isLandingTruss: true,  descentPropFraction: 0.55 },
    { name: 'Ascent Stage',            dry_mass: 2445, isp: 311, propKg: 2353,  propType: 'NTO_A50', crewCapacity: 2, dockingPorts: 1, tunnelCapable: true,  isLandingTruss: false, descentPropFraction: 0 },
  ]},
  { name: 'Orion', stages: [
    { name: 'European Service Module', dry_mass: 6000, isp: 321, propKg: 8607,  propType: 'NTO_A50', crewCapacity: 0, dockingPorts: 1, tunnelCapable: true,  isLandingTruss: false, descentPropFraction: 0 },
    { name: 'Crew Module',             dry_mass: 9300, isp: 0,   propKg: 0,     propType: 'NTO_A50', crewCapacity: 4, dockingPorts: 1, tunnelCapable: true,  isLandingTruss: false, descentPropFraction: 0 },
  ]},
  { name: 'Dragon 2', stages: [
    { name: 'Trunk',                   dry_mass: 1500, isp: 0,   propKg: 0,     propType: 'NTO_A50', crewCapacity: 0, dockingPorts: 0, tunnelCapable: false, isLandingTruss: false, descentPropFraction: 0 },
    { name: 'Capsule',                 dry_mass: 9616, isp: 293, propKg: 1400,  propType: 'NTO_A50', crewCapacity: 7, dockingPorts: 1, tunnelCapable: false, isLandingTruss: false, descentPropFraction: 0 },
  ]},
];

let _scEdSC  = [];    // SpacecraftDefinition[]
let _scEdSel = null;  // selected spacecraftId

function scEdInit() {
  _scEdSC = _PROG_SC_PRESETS.map(p => ({
    spacecraftId: progUUID(),
    name: p.name,
    stages: p.stages.map(s => ({ stageId: progUUID(), ...s })),
  }));
  _scEdSel = _scEdSC[0]?.spacecraftId ?? null;
  scEdRender();
}

function _scEdGet(id) {
  return _scEdSC.find(s => s.spacecraftId === (id ?? _scEdSel)) ?? null;
}

function scEdRender() { scEdRenderList(); scEdRenderDetail(); }

function scEdRenderList() {
  const el = document.getElementById('sc-ed-list');
  if (!el) return;
  const q = (document.getElementById('sc-ed-search')?.value ?? '').toLowerCase();
  const rows = _scEdSC.filter(s => s.name.toLowerCase().includes(q));
  el.innerHTML = rows.map(s => {
    const totProp = s.stages.reduce((a, st) => a + (st.propKg || 0), 0);
    return `<div class="lv-item">
      <button class="lv-item-btn${s.spacecraftId === _scEdSel ? ' active' : ''}" onclick="scEdSelect('${s.spacecraftId}')">
        <span style="display:block;font-size:11px;color:var(--text-bright)">${s.name}</span>
        <span style="color:var(--text-dim);font-size:9px">${s.stages.length} stage${s.stages.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; ${totProp.toLocaleString()} kg prop</span>
      </button>
      <button class="lv-del" onclick="scEdDelete('${s.spacecraftId}')" title="Delete">&#x2715;</button>
    </div>`;
  }).join('') || '<div style="padding:12px;font-family:var(--mono);font-size:10px;color:var(--text-dim);">No spacecraft</div>';
}

function scEdSelect(id) { _scEdSel = id; scEdRenderList(); scEdRenderDetail(); }

function scEdNew() {
  const sc = progMakeSpacecraftDefinition('New Spacecraft');
  sc.stages.push(progMakeSpacecraftStageDef('Stage 1'));
  _scEdSC.push(sc);
  _scEdSel = sc.spacecraftId;
  scEdRender();
}

function scEdDelete(id) {
  _scEdSC = _scEdSC.filter(s => s.spacecraftId !== id);
  if (_scEdSel === id) _scEdSel = _scEdSC[0]?.spacecraftId ?? null;
  scEdRender();
}

function scEdSaveJSON(id) {
  const sc = _scEdGet(id);
  if (!sc) return;
  const blob = new Blob([JSON.stringify(sc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = sc.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.spacecraft';
  a.click();
}

function scEdLoadJSON(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const sc = JSON.parse(e.target.result);
      if (!sc.stages || !Array.isArray(sc.stages)) { alert('Invalid spacecraft JSON'); return; }
      sc.spacecraftId = progUUID();
      sc.stages = sc.stages.map(st => ({ ...st, stageId: progUUID() }));
      _scEdSC.push(sc);
      _scEdSel = sc.spacecraftId;
      scEdRender();
    } catch(err) { alert('Failed to parse JSON: ' + err.message); }
  };
  reader.readAsText(file);
  input.value = '';
}

function scEdNameSet(id, val) {
  const sc = _scEdGet(id);
  if (sc) sc.name = val;
  scEdRenderList();
}

function scEdStageAdd(id) {
  const sc = _scEdGet(id);
  if (!sc) return;
  sc.stages.push(progMakeSpacecraftStageDef('Stage ' + (sc.stages.length + 1)));
  scEdRenderDetail();
}

function scEdStageDelete(id, idx) {
  const sc = _scEdGet(id);
  if (!sc || sc.stages.length <= 1) return;
  sc.stages.splice(idx, 1);
  scEdRenderDetail();
  scEdRenderList();
}

function scEdStageSet(id, idx, field, val) {
  const sc = _scEdGet(id);
  if (!sc || !sc.stages[idx]) return;
  sc.stages[idx][field] = val;
  const dvEl = document.getElementById('sc-dv-' + id);
  if (dvEl) dvEl.innerHTML = _scEdDvHTML(sc);
  scEdRenderList();
}

function _scEdDvBreakdown(sc) {
  let cum = 0;
  return sc.stages.map((st, i) => {
    const m_wet = sc.stages.slice(i).reduce((s, x) => s + (x.dry_mass || 0) + (x.propKg || 0), 0);
    const dv = (st.propKg > 0 && st.isp > 0) ? progRocketEqDv(m_wet, st.propKg, st.isp) : 0;
    cum += dv;
    return { name: st.name, prop: st.propKg || 0, isp: st.isp || 0, dv, cum };
  });
}

function _scEdDvHTML(sc) {
  const rows = _scEdDvBreakdown(sc);
  const total = rows.reduce((s, r) => s + r.dv, 0);
  const trs = rows.map(r => `<tr>
    <td class="rl">${r.name}</td>
    <td style="text-align:right;color:var(--text-bright)">${r.prop > 0 ? r.prop.toLocaleString() : '&#x2014;'}</td>
    <td style="text-align:right;color:var(--text-bright)">${r.isp > 0 ? r.isp : '&#x2014;'}</td>
    <td style="text-align:right;color:${r.dv > 0 ? 'var(--accent3)' : 'var(--text-dim)'}">${r.dv > 0 ? Math.round(r.dv).toLocaleString() : '&#x2014;'}</td>
    <td style="text-align:right;color:var(--accent)">${r.cum > 0 ? Math.round(r.cum).toLocaleString() : '&#x2014;'}</td>
  </tr>`).join('');
  return `<table class="sc-dv-tbl"><thead><tr>
    <th>Stage</th>
    <th style="text-align:right">Prop (kg)</th>
    <th style="text-align:right">Isp (s)</th>
    <th style="text-align:right">dv (m/s)</th>
    <th style="text-align:right">Cumul. (m/s)</th>
  </tr></thead><tbody>${trs}</tbody></table>
  <div style="display:flex;justify-content:flex-end;align-items:baseline;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">
    <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim);letter-spacing:.1em;text-transform:uppercase;">Total dv</span>
    <span style="font-family:var(--mono);font-size:18px;color:var(--accent)">${Math.round(total).toLocaleString()} m/s</span>
  </div>`;
}

function scEdRenderDetail() {
  const el = document.getElementById('sc-ed-detail');
  if (!el) return;
  const sc = _scEdGet();
  if (!sc) { el.innerHTML = '<div class="placeholder-msg">Select or create a spacecraft</div>' + _scStageLibPanelHTML(); return; }
  const id = sc.spacecraftId;
  const stageCards = sc.stages.map((st, i) => {
    const isBot = i === 0, isTop = i === sc.stages.length - 1;
    const tag = (isBot && isTop) ? 'Only Stage' : isBot ? 'Stage 1 &middot; Bottom / Fires First' : isTop ? 'Stage ' + (i+1) + ' &middot; Top / Payload End' : 'Stage ' + (i+1);
    const propOpts = Object.entries(PROG_PROPELLANT_TYPES).map(([k, v]) =>
      `<option value="${k}"${st.propType === k ? ' selected' : ''}>${v.label}</option>`).join('');
    const canDel = sc.stages.length > 1;
    return `<div class="sc-stage-card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;">${tag}</span>
        <input type="text" class="sc-stage-name" value="${st.name.replace(/\\/g,'\\\\').replace(/"/g,'&quot;').replace(/</g,'&lt;')}"
          oninput="scEdStageSet('${id}',${i},'name',this.value)" placeholder="Stage name">
        <button class="act-btn" style="font-size:9px;padding:3px 7px;flex-shrink:0;" onclick="scStageLibSaveFromCard('${id}',${i})" title="Save this stage to the Stage Library">&#x2193; Lib</button>
        ${canDel ? `<button class="lv-del" onclick="scEdStageDelete('${id}',${i})" title="Remove" style="font-size:10px;padding:0 8px;flex-shrink:0;">&#x2715;</button>` : ''}
      </div>
      <div class="cfg-row" style="margin-bottom:8px;gap:16px;">
        <div class="cfg-item"><label>Dry Mass (kg)</label>
          <input type="number" class="field" min="0" value="${st.dry_mass || 0}" style="width:90px"
            oninput="scEdStageSet('${id}',${i},'dry_mass',+this.value)"></div>
        <div class="cfg-item"><label>Isp (s)</label>
          <input type="number" class="field" min="0" value="${st.isp || 0}" style="width:80px"
            oninput="scEdStageSet('${id}',${i},'isp',+this.value)"></div>
        <div class="cfg-item"><label>Propellant (kg)</label>
          <input type="number" class="field" min="0" value="${st.propKg || 0}" style="width:100px"
            oninput="scEdStageSet('${id}',${i},'propKg',+this.value)"></div>
        <div class="cfg-item"><label>Prop Type</label>
          <select class="field" style="width:170px" onchange="scEdStageSet('${id}',${i},'propType',this.value)">${propOpts}</select></div>
      </div>
      <div class="cfg-row" style="gap:16px;padding-top:8px;border-top:1px solid var(--border);margin-bottom:0;">
        <div class="cfg-item"><label>Crew Capacity</label>
          <input type="number" class="field" min="0" value="${st.crewCapacity || 0}" style="width:70px"
            oninput="scEdStageSet('${id}',${i},'crewCapacity',+this.value)"></div>
        <div class="cfg-item"><label>Docking Ports</label>
          <input type="number" class="field" min="0" value="${st.dockingPorts || 0}" style="width:70px"
            oninput="scEdStageSet('${id}',${i},'dockingPorts',+this.value)"></div>
      </div>
    </div>`;
  }).join('');
  const massBody = `
    <div class="sl">Mass Simulator <span style="color:var(--text);font-size:10px;letter-spacing:0;text-transform:none;">(a single inert payload — e.g. a station)</span></div>
    <div class="cfg-row" style="gap:16px;margin-bottom:8px;">
      <div class="cfg-item"><label>Total Mass (kg)</label>
        <input type="number" class="field" min="0" value="${(sc.stages[0] && sc.stages[0].dry_mass) || sc.massSimKg || 0}" style="width:160px"
          oninput="scEdSetMassSimKg('${id}',+this.value)"></div>
    </div>
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:24px;">// no propellant, no stages, no crew — pure mass. Use for stations / cargo you don't want to model in detail (e.g. ISS ≈ 420,000 kg).</div>`;
  const stackBody = `
    <div class="sl">Stage Stack <span style="color:var(--text);font-size:10px;letter-spacing:0;text-transform:none;">(Stage 1 = bottom / fires first)</span></div>
    <div class="sc-ed-detail-grid">${stageCards}</div>
    <div class="fleet-drop-zone" ondragover="fleetDragOver(event)" ondragleave="fleetDragLeave(event)" ondrop="scStageDrop(event)">&#x2295; Drop a library stage here to add it to the stack</div>
    <div style="margin-bottom:24px;"><button class="act-btn" onclick="scEdStageAdd('${id}')">+ Add Stage</button></div>
    <div class="sl">dV Breakdown</div>
    <div class="panel" style="padding:12px;" id="sc-dv-${id}">${_scEdDvHTML(sc)}</div>`;
  el.innerHTML = `
    <div class="cfg-row" style="margin-bottom:16px;gap:16px;align-items:flex-end;">
      <div class="cfg-item" style="flex:1;min-width:180px;"><label>Spacecraft Name</label>
        <input type="text" class="field" style="width:100%;max-width:340px;" value="${sc.name.replace(/"/g,'&quot;')}"
          oninput="scEdNameSet('${id}',this.value)"></div>
      <label style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;color:var(--text-bright);cursor:pointer;white-space:nowrap;padding-bottom:6px;"><input type="checkbox" style="accent-color:var(--accent);" ${sc.massSim ? 'checked' : ''} onchange="scEdSetMassSim('${id}',this.checked)"> Mass simulator</label>
      <button class="act-btn green" onclick="scEdSaveJSON('${id}')">&#x2B07; Save JSON</button>
    </div>
    ${sc.massSim ? massBody : stackBody}
    ${_scStageLibPanelHTML()}`;
}

// Toggle "mass simulator" — collapse the spacecraft to one inert stage (its total mass) so it
// can be added like a station without modelling stages; un-toggling keeps that single stage.
function scEdSetMassSim(id, on) {
  const sc = _scEdGet(id); if (!sc) return;
  if (on) {
    const total = sc.massSimKg || sc.stages.reduce((s, st) => s + (+st.dry_mass || 0) + (+st.propKg || 0), 0) || 0;
    sc.massSim = true; sc.massSimKg = total;
    sc.stages = [{ stageId: progUUID(), name: sc.name || 'Mass', dry_mass: total, isp: 0, propKg: 0,
      propType: 'NTO_A50', crewCapacity: 0, dockingPorts: 0, tunnelCapable: false, isLandingTruss: false, descentPropFraction: 0 }];
  } else {
    sc.massSim = false;
  }
  scEdRenderDetail();
}
function scEdSetMassSimKg(id, val) {
  const sc = _scEdGet(id); if (!sc) return;
  sc.massSimKg = Math.max(0, +val || 0);
  if (sc.stages && sc.stages[0]) sc.stages[0].dry_mass = sc.massSimKg;
}

