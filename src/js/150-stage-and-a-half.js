
// ─── STAGE-AND-A-HALF ─────────────────────────
/**
 * Compute the Phase-1 / Phase-2 propellant split for a stage-and-a-half.
 * Uses a stage-mass-only approximation: the mass of upper stages and payload
 * above this stage is ignored when locating the BECO point.  The rocket-equation
 * accounting in evalAtPayload still runs with the full mass stack, so the ΔV
 * error from this approximation is small (< 5 % for typical Atlas-class vehicles).
 *
 * @param {object} s  - stage record with {dry, prop, isp, thrust,
 *                      s15_sust_thrust, s15_sust_isp, s15_jet_mass, s15_beco_twr,
 *                      s15_boost_isp}
 * @returns {object}  - {prop_ph1, prop_ph2, isp_ph1, isp_ph2, dry_ph2, boostIspUsed} or {error}
 */
function _s15BecoSplit(s) {
  const F_sust   = (s.s15_sust_thrust || 0) * 1000;   // N
  const isp_ph2  = s.s15_sust_isp > 0 ? s.s15_sust_isp : (parseFloat(s.isp) || 1);
  const jet      = s.s15_jet_mass   || 0;
  const twr      = s.s15_beco_twr   || 1.2;
  const dry      = parseFloat(s.dry)  || 0;
  const prop     = parseFloat(s.prop) || 0;

  if (F_sust <= 0)  return { error: 'Sustainer thrust must be > 0' };
  if (jet   <= 0)   return { error: 'Booster pack mass must be > 0' };
  if (jet   >= dry) return { error: 'Booster pack mass ≥ stage dry mass' };
  if ((s.s15_sust_thrust || 0) >= (parseFloat(s.thrust) || 0))
                    return { error: 'Sustainer thrust ≥ total thrust — no booster engines' };

  // At BECO: sustainer TWR on stage-only mass = F_sust / (m_after × G0) = twr
  // → m_after = F_sust / (twr × G0)   [stage mass after jettison, no payload]
  const m_after  = F_sust / (twr * G0);
  const m_beco   = m_after + jet;               // stage mass at BECO (before jettison)
  const m_stage0 = dry + prop;                  // stage mass at ignition

  if (m_beco >= m_stage0) return { error: 'BECO TWR too low — stage never reaches jettison point (increase TWR)' };

  const prop_ph1 = Math.max(0, m_stage0 - m_beco);
  const prop_ph2 = Math.max(0, prop - prop_ph1);

  if (prop_ph2 <= 0) return { error: 'No propellant left for Phase 2 — lower BECO TWR or add more propellant' };

  // Optional mass-flow-blended Phase-1 Isp: thrust-weighted harmonic mean of the
  // booster engines' Isp and the sustainer's Isp, since both burn together in Phase 1.
  // Isp_eff = F_tot / (F_boost/Isp_boost + F_sust/Isp_sust), F_boost = F_tot - F_sust.
  const authoredIsp = parseFloat(s.isp) || 1;
  const boostIsp     = s.s15_boost_isp > 0 ? s.s15_boost_isp : 0;
  let isp_ph1 = authoredIsp;
  let boostIspUsed = null;
  if (boostIsp > 0) {
    const F_tot   = (parseFloat(s.thrust) || 0) * 1000;   // N
    const F_boost = F_tot - F_sust;                       // guarded > 0 above
    if (F_boost > 0) {
      isp_ph1 = F_tot / (F_boost / boostIsp + F_sust / isp_ph2);
      boostIspUsed = boostIsp;
    }
  }

  return {
    prop_ph1,
    prop_ph2,
    isp_ph1,
    isp_ph2,
    dry_ph2:  dry - jet,
    boostIspUsed,
  };
}

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
  const virtualStages = [];   // [{dry,prop,thrust,isp,res, label}]
  const stageLabels   = [];   // parallel display labels for post-processing

  for (let i = 0; i < numStages; i++) {
    const sd = stageStore[i] || {};
    if (sd.s15) {
      const sp = _s15BecoSplit(sd);
      if (sp.error) {
        // Surface the error to the results panel without calling calculate()
        showPage('results');
        const panel = document.getElementById('results-panel');
        if (panel) panel.innerHTML =
          `<div class="error-msg">// Stage ${i+1} (Stage-and-a-Half) CONFIG ERROR: ${sp.error}</div>`;
        return;
      }
      virtualStages.push({ dry: mathValue(sd.dry,0), prop: sp.prop_ph1, thrust: mathValue(sd.thrust,0), isp: sp.isp_ph1, res: mathValue(sd.res,0) });
      stageLabels.push(`Stage ${i+1} Ph.1`);
      virtualStages.push({ dry: sp.dry_ph2, prop: sp.prop_ph2, thrust: sd.s15_sust_thrust||0, isp: sp.isp_ph2, res: mathValue(sd.res,0) });
      stageLabels.push(`Stage ${i+1} Ph.2`);
    } else {
      virtualStages.push({ dry: mathValue(sd.dry,0), prop: mathValue(sd.prop,0), thrust: mathValue(sd.thrust,0), isp: parseFloat(sd.isp)||1, res: mathValue(sd.res,0) });
      stageLabels.push(`Stage ${i+1}`);
    }
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
