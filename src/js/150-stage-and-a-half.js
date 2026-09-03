
// ─── STAGE-AND-A-HALF ─────────────────────────
// The S1.5 BECO splitter (_s15BecoSplit / stageExpandS15) lives in 140-physics.js;
// a test gate forbids calling _s15BecoSplit from any other module.
/**
 * Replace the CALCULATE button's target.
 * If any stage has s15 enabled, temporarily expands it into two virtual stages
 * in the DOM so that calculate() / evalAtPayload() see the correct split
 * without any modification to those functions.
 */
function calculateWithS15() {
  // Orbits-page vehicle selector: if a library vehicle (not "Worksheet") is
  // selected, delegate to the pure path and skip the DOM-reading worksheet
  // flow entirely. calculate() itself is never touched.
  if (typeof _orbVehSel !== 'undefined' && _orbVehSel) { orbCalcSelectedVehicle(); return; }
  // Check whether any stage uses S1.5
  saveStoreFromDOM();
  const s15Indices = [];
  for (let i = 0; i < numStages; i++) {
    if (stageStore[i]?.s15) s15Indices.push(i);
  }
  if (!s15Indices.length) { calculate(); condenseResultsPanel(); return; }

  // ── 1. Build virtual stage sequence ──────────────────────────────────────────
  // Normalize the worksheet's DOM-string stage records to numbers (mathValue/
  // gv-style parsing, same as every other caller), carry the s15 sextet
  // atomically, then hand off to the ONE S1.5 expansion boundary
  // (stageExpandS15, 140-physics.js). mathValue()/label wrapping is this
  // caller's own decoration on top of the shared core split.
  const normalized = [];
  for (let i = 0; i < numStages; i++) {
    const sd = stageStore[i] || {};
    const st = { dry: mathValue(sd.dry,0), prop: mathValue(sd.prop,0), thrust: mathValue(sd.thrust,0), isp: parseFloat(sd.isp)||1, res: mathValue(sd.res,0) };
    stageCarryS15(st, sd);
    normalized.push(st);
  }

  const virtualStages = [];   // [{dry,prop,thrust,isp,res}]
  const stageLabels   = [];   // parallel display labels for post-processing
  try {
    stageExpandS15(normalized, { onError: 'throw' }).forEach(vs => {
      virtualStages.push({ dry: vs.dry, prop: vs.prop, thrust: vs.thrust, isp: vs.isp, res: vs.res });
      stageLabels.push(vs._phase ? `Stage ${vs._src+1} ${vs._phase}` : `Stage ${vs._src+1}`);
    });
  } catch (e) {
    // Surface the error to the results panel without calling calculate()
    showPage('results');
    const panel = document.getElementById('results-panel');
    if (panel) panel.innerHTML =
      `<div class="error-msg">// Stage ${e.stageIndex+1} (Stage-and-a-Half) CONFIG ERROR: ${e.s15Error}</div>`;
    return;
  }

  // ── 2. Snapshot current DOM state ────────────────────────────────────────────
  const origN     = numStages;
  const origStore = {};
  for (let i = 0; i < origN; i++) origStore[i] = { ...stageStore[i] };

  const origInputVals = {};
  for (let i = 0; i < origN; i++) {
    origInputVals[i] = {};
    ROWS.forEach(row => {
      const el = document.getElementById(`s${i+1}_${row.key}`);
      if (el) origInputVals[i][row.key] = el.value;
    });
  }

  // ── 3. Inject virtual stages into DOM ────────────────────────────────────────
  // For slots that already have DOM inputs: just update values.
  // For extra slots (beyond origN): create hidden inputs in document.body.
  const tempInputs = [];

  virtualStages.forEach((vs, vi) => {
    const slot = vi + 1;   // 1-based DOM id
    ROWS.forEach(row => {
      let el = document.getElementById(`s${slot}_${row.key}`);
      if (!el) {
        // Create a temporary hidden input that gv() / getElementById() will find
        el = document.createElement('input');
        el.type  = 'hidden';
        el.id    = `s${slot}_${row.key}`;
        document.body.appendChild(el);
        tempInputs.push(el);
      }
      el.value = vs[row.key] ?? 0;
    });
  });

  // ── 4. Temporarily expand numStages ──────────────────────────────────────────
  numStages = virtualStages.length;

  // ── 5. Call the unmodified calculate() ───────────────────────────────────────
  calculate();

  // ── 6. Restore DOM + global state ────────────────────────────────────────────
  numStages = origN;
  for (let i = 0; i < origN; i++) {
    stageStore[i] = origStore[i];   // calculate() called saveStoreFromDOM() — undo
    ROWS.forEach(row => {
      const el = document.getElementById(`s${i+1}_${row.key}`);
      if (el) el.value = origInputVals[i][row.key] ?? 0;
    });
  }
  tempInputs.forEach(el => el.remove());

  // ── 7. Relabel the ΔV breakdown in the rendered results panel ─────────────────
  // renderResults() labels stages "STG 1", "STG 2", … — patch them to show split labels.
  const panel = document.getElementById('results-panel');
  if (panel) {
    stageLabels.forEach((lbl, vi) => {
      // Labels rendered as "STG N" in the bar chart
      const canonical = `STG ${vi + 1}`;
      panel.innerHTML = panel.innerHTML.replaceAll(canonical, lbl.toUpperCase().replace('STAGE ', 'STG '));
      // Labels in the breakdown list  "Stage N"
      panel.innerHTML = panel.innerHTML.replaceAll(`Stage ${vi + 1}`, lbl);
    });
  }

  condenseResultsPanel();
}
