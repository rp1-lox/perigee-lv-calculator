
// ─── MISSION REPORT (printable export) ───────────────────────────────────
// Self-contained, standalone HTML document — NOT part of the app's themed UI,
// so it does NOT use the app's CSS custom properties (exempt by design: it's
// meant to be printed / saved / opened outside the tool).

function _mrEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _mrNum(v, digits) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString(undefined, digits ? { maximumFractionDigits: digits } : {});
}

// Event description line, reusing the same field-precedence the on-screen
// event cards use (sub = burnLabel || toLabel || vehicleName || label || targetName).
function _mrEventDesc(e) {
  if (e.type === 'COAST') return e.label || 'Coast';
  return e.burnLabel || e.toLabel || e.vehicleName || e.label || e.targetName || '';
}

function _mrEventRow(e, i) {
  // R6.2' Phase B: report label stays "MANEUVER" for a unified solved MNODE
  // (mode:'solved') — the printed report is a plain-English document, not a
  // schema dump, so it shows the same type word a legacy MANEUVER always did.
  const isSolvedMv = (typeof _evIsSolvedManeuver === 'function') && _evIsSolvedManeuver(e);
  const type = _mrEsc(isSolvedMv ? 'MANEUVER' : (e.type || ''));
  const desc = _mrEsc(_mrEventDesc(e));
  let dv = '', prop = '', veh = '';
  if (e.type === 'LAUNCH') {
    const sr = e.stagingResult || {};
    dv = _mrNum(sr.dvDelivered);
    prop = _mrNum((sr.stages || []).reduce((s, st) => s + (st.propBurned || 0), 0));
    veh = _mrEsc(e.label || '');
  } else if (e.type === 'BURN' || isSolvedMv) {
    dv = _mrNum(e.dv_actual != null ? e.dv_actual : e.dv);
    prop = _mrNum(e.prop_consumed);
    veh = _mrEsc(e.vehicleName || e.activeName || '');
  } else if (e.type === 'DEPLOY') {
    veh = _mrEsc(e.label || '');
  } else if (e.type === 'SEPARATE' || e.type === 'DOCK') {
    veh = _mrEsc(e.vehicleName || e.targetName || '');
  } else if (e.type === 'EXPEND') {
    veh = _mrEsc(e.vehicleLevel ? e.vehicleName : e.stageName);
  } else if (e.type === 'COAST') {
    veh = _mrEsc((e.days||0).toLocaleString() + ' d' + (e.boiloffKg > 0 ? ' — boiloff ' + Math.round(e.boiloffKg).toLocaleString() + ' kg' : ''));
  } else {
    veh = _mrEsc(e.vehicleName || e.activeName || e.targetName || '');
  }
  const rep = e.groupId ? ' <span class="mr-tag">grp</span>' : '';
  const met = (typeof _metFmt === 'function' && e.metStart != null) ? _metFmt(e.metStart) : '—';
  return `<tr>
    <td class="mr-num">${i + 1}</td>
    <td>${type}${rep}</td>
    <td class="mr-num" style="font-family:monospace;">${_mrEsc(met)}</td>
    <td>${desc}</td>
    <td>${veh}</td>
    <td class="mr-num">${dv}</td>
    <td class="mr-num">${prop}</td>
  </tr>`;
}

function _mrStageRow(s) {
  return `<tr>
    <td>${_mrEsc(s.name)}</td>
    <td class="mr-num">${_mrNum(s.propTotal)}</td>
    <td class="mr-num">${_mrNum(s.propBurned)}</td>
    <td class="mr-num">${_mrNum(s.propRemaining)}</td>
    <td class="mr-num">${_mrNum(s.dvContrib)}</td>
    <td>${s.expended ? 'EXPENDED' : 'INSERTION'}</td>
  </tr>`;
}

function missionReportHTML(m) {
  if (!m) return '<!DOCTYPE html><html><body>No mission.</body></html>';

  const log = (m._expanded && m._expanded.length) ? m._expanded : (m.log || []);
  const entry = (typeof _fleetGet === 'function' && m.fleetEntryId) ? _fleetGet(m.fleetEntryId) : null;
  const lvName = entry ? entry.name : (m.fleetEntryId ? 'Unknown vehicle' : '—');

  const payloadNames = (m.payloadScIds || []).map(scId => {
    const sc = (typeof _scEdSC !== 'undefined') ? _scEdSC.find(s => s.spacecraftId === scId) : null;
    return sc ? sc.name : null;
  }).filter(Boolean);
  const payloadMass = (m.payloadScIds || []).reduce((s, scId) =>
    s + (typeof _fleetScMassById === 'function' ? _fleetScMassById(scId) : 0), 0);

  const firstLaunch = log.find(e => e.type === 'LAUNCH' && e.stagingResult);
  const sr = firstLaunch ? firstLaunch.stagingResult : null;
  // C3: read the actual authored LAUNCH entry's orbit; m.launchOrbit only as a
  // pre-authoring fallback (no LAUNCH entry logged yet).
  const o = (firstLaunch && firstLaunch.orbit) || (typeof _missionLaunchOrbitDraft === 'function' ? _missionLaunchOrbitDraft(m.launchOrbit) : m.launchOrbit) || {};

  const budget = (typeof missionBudget === 'function') ? missionBudget(m) : null;

  const genDate = new Date().toLocaleString();
  const ver = (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '';

  const eventRows = log.map((e, i) => _mrEventRow(e, i)).join('') ||
    `<tr><td colspan="7" class="mr-empty">No events.</td></tr>`;

  const stageRows = sr ? (sr.stages || []).map(_mrStageRow).join('') : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${_mrEsc(m.name)} — Mission Report</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #1a1a1a;
    background: #ffffff;
    margin: 0;
    padding: 40px 48px 80px;
    max-width: 960px;
    margin: 0 auto;
  }
  .mr-mono { font-family: 'Consolas', 'Courier New', monospace; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: .08em;
    color: #555; border-bottom: 1px solid #ccc; padding-bottom: 4px;
    margin: 28px 0 10px;
  }
  .mr-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 18px;
  }
  .mr-header-right { text-align: right; font-family: 'Consolas','Courier New',monospace; font-size: 11px; color: #555; }
  .mr-tool { font-weight: bold; color: #1a1a1a; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 10px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #ddd; font-family: 'Consolas','Courier New',monospace; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 2px solid #999; }
  td.mr-num, th.mr-num { text-align: right; }
  .mr-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 20px; font-family: 'Consolas','Courier New',monospace; font-size: 12px; margin-bottom: 8px; }
  .mr-grid div span { display: block; }
  .mr-key { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #777; }
  .mr-val { font-size: 13px; color: #111; }
  .mr-empty { color: #888; font-style: italic; text-align: center; padding: 14px; }
  .mr-tag { font-size: 9px; background: #eee; border: 1px solid #ccc; padding: 0 4px; border-radius: 2px; color: #666; }
  .mr-status { display: inline-block; padding: 1px 8px; font-size: 10px; letter-spacing: .08em; border: 1px solid #333; margin-left: 8px; }
  .mr-toolbar {
    position: fixed; top: 16px; right: 16px; display: flex; gap: 8px; z-index: 10;
  }
  .mr-toolbar button {
    font-family: 'Consolas','Courier New',monospace; font-size: 12px;
    background: #1a1a1a; color: #fff; border: none; padding: 8px 14px;
    cursor: pointer; border-radius: 3px;
  }
  .mr-toolbar button:hover { background: #333; }
  @media print { .mr-toolbar { display: none; } body { padding: 20px; } }
</style>
</head>
<body>
  <div class="mr-toolbar">
    <button onclick="window.print()">Print</button>
    <button onclick="(function(){var blob=new Blob(['&lt;!DOCTYPE html&gt;\\n'+document.documentElement.outerHTML],{type:'text/html'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='${_mrEsc(m.name).replace(/[^a-z0-9_-]/gi,'_')}-report.html';document.body.appendChild(a);a.click();a.remove();})()">Download HTML</button>
  </div>

  <div class="mr-header">
    <div>
      <h1>${_mrEsc(m.name)}</h1>
      <div class="mr-mono" style="font-size:11px;color:#666;">Mission Report</div>
    </div>
    <div class="mr-header-right">
      <div class="mr-tool">Rocket Playground${ver ? ' v' + _mrEsc(ver) : ''}</div>
      <div>Generated ${_mrEsc(genDate)}</div>
      <div>Physics fidelity: ${_mrEsc((typeof physFidelity === 'function') ? physFidelity() : 'contextual')}</div>
    </div>
  </div>

  <h2>Overview</h2>
  <div class="mr-grid">
    <div><span class="mr-key">Launch Vehicle</span><span class="mr-val">${_mrEsc(lvName)}</span></div>
    <div><span class="mr-key">Payload</span><span class="mr-val">${payloadNames.length ? _mrEsc(payloadNames.join(', ')) : '—'}</span></div>
    <div><span class="mr-key">Total Payload Mass</span><span class="mr-val">${_mrNum(payloadMass)} kg</span></div>
    <div><span class="mr-key">Events</span><span class="mr-val">${log.length}</span></div>
    <div><span class="mr-key">Body</span><span class="mr-val">${_mrEsc(o.body || 'Earth')}</span></div>
    <div><span class="mr-key">Altitude</span><span class="mr-val">${_mrNum(o.periKm)} km${o.apoKm && o.apoKm !== o.periKm ? ' × ' + _mrNum(o.apoKm) + ' km' : ''}</span></div>
    <div><span class="mr-key">Inclination</span><span class="mr-val">${_mrNum(o.incDeg)}&deg;</span></div>
    <div><span class="mr-key">LAN</span><span class="mr-val">${_mrNum(o.lanDeg)}&deg;</span></div>
  </div>

  <h2>Event Log</h2>
  <table>
    <thead><tr>
      <th class="mr-num">#</th><th>Type</th><th class="mr-num">T+</th><th>Description</th><th>Vehicle</th>
      <th class="mr-num">&#916;V (m/s)</th><th class="mr-num">Prop (kg)</th>
    </tr></thead>
    <tbody>${eventRows}</tbody>
  </table>

  ${sr ? `
  <h2>Ascent Staging${sr.status ? `<span class="mr-status">${_mrEsc(sr.status)}</span>` : ''}</h2>
  <table>
    <thead><tr>
      <th>Stage</th><th class="mr-num">Prop Total (kg)</th><th class="mr-num">Prop Burned (kg)</th>
      <th class="mr-num">Prop Remaining (kg)</th><th class="mr-num">&#916;V (m/s)</th><th>Status</th>
    </tr></thead>
    <tbody>${stageRows}</tbody>
  </table>
  <div class="mr-mono" style="font-size:11px;color:#444;margin-bottom:10px;">
    Required &#916;V: ${_mrNum(sr.dvRequired)} m/s &nbsp;|&nbsp;
    Delivered &#916;V: ${_mrNum(sr.dvDelivered)} m/s
    ${sr.dvMargin != null ? ` &nbsp;|&nbsp; Margin: ${_mrNum(sr.dvMargin)} m/s` : ''}
  </div>` : ''}

  ${budget ? `
  <h2>&#916;V Budget Summary</h2>
  <div class="mr-grid">
    <div><span class="mr-key">&#916;V Expended</span><span class="mr-val">${_mrNum(budget.dvExpended)} m/s</span></div>
    <div><span class="mr-key">Prop Consumed</span><span class="mr-val">${_mrNum(budget.propConsumed)} kg</span></div>
    <div><span class="mr-key">&#916;V Capacity Left</span><span class="mr-val">${_mrNum(budget.dvCapacityRemaining)} m/s</span></div>
    <div><span class="mr-key">Payload</span><span class="mr-val">${_mrNum(budget.payloadMass)} kg</span></div>
  </div>` : ''}

</body>
</html>`;
}

function missionExportReport(id) {
  const m = _missionGet(id);
  if (!m) return;
  if (!m._expanded || !m._expanded.length) {
    if (typeof missionRecompute === 'function') missionRecompute(m);
  }
  const html = missionReportHTML(m);
  let w = null;
  try { w = window.open('', '_blank'); } catch (err) { w = null; }
  if (w && w.document) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  } else {
    // popup blocked — fall back to a direct Blob download of the report HTML
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (m.name || 'mission').replace(/[^a-z0-9_-]/gi, '_') + '-report.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
