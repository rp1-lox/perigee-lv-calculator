
// ─── PORK CHOP PLOTTER ───────────────────────────────────────────────────────
// Lambert solver → C3 departure grid → canvas heatmap → click-to-select window.
// The selected window sets PROG_ACTIVE_PROGRAM.launchWindow, which drives COAST
// duration. Planets use the real ephemeris (progBodyEphemState, 360) projected
// to the ecliptic plane because progLambert2D is 2D (small error for i ≤ 7°).
// dep_day = days since the program epoch (PROG_ACTIVE_PROGRAM.epochJD).

const PROG_PORK_MU = 1.32712440018e11;   // km³/s² — Sun

// ── Stumpff functions ─────────────────────────────────────────────────────────
// progStumpffC / progStumpffS moved to 385-physics-core.js (P0) — one shared
// copy for the Lambert solver here AND the universal-variable propagator.

// ── Lambert solver (universal variable method, bisection) ─────────────────────
// Algorithm: Universal Variable Method, bisection on ψ.
// Source: Curtis, H. (2013). Orbital Mechanics for Engineering Students,
//         Butterworth-Heinemann. The same algorithm is used in
//         EGPAerospace/LambertCalculator (MIT) and is the textbook foundation
//         for Gooding (1990) and Izzo (2015).
// Implementation by Rocket Playground / Anthropic Claude, 2026.
/**
 * Solve Lambert's problem in 2-D heliocentric space (prograde = CCW).
 * Returns { v1:[vx,vy], v2:[vx,vy] } in km/s, or null if degenerate / diverged.
 * @param {[number,number]} r1v  departure pos [x,y] km
 * @param {[number,number]} r2v  arrival pos   [x,y] km
 * @param {number} tof_s         time of flight, seconds
 * @param {number} mu            gravitational parameter km³/s²
 */
function progLambert2D(r1v, r2v, tof_s, mu) {
  const r1  = Math.hypot(r1v[0], r1v[1]);
  const r2  = Math.hypot(r2v[0], r2v[1]);
  const dot = r1v[0]*r2v[0] + r1v[1]*r2v[1];
  const cz  = r1v[0]*r2v[1] - r1v[1]*r2v[0];   // cross-product z

  // Transfer angle (prograde = counter-clockwise in ecliptic plane)
  const dv_raw = Math.acos(Math.max(-1, Math.min(1, dot / (r1 * r2))));
  const dv     = cz >= 0 ? dv_raw : (2*Math.PI - dv_raw);

  // Degenerate: 0° or ≈180° transfer
  if (dv < 1e-4 || Math.abs(dv - Math.PI) < 1e-4) return null;

  const A = Math.sin(dv) * Math.sqrt(r1 * r2 / (1 - Math.cos(dv)));

  let psi_lo = -4 * Math.PI * Math.PI;
  let psi_hi =  4 * Math.PI * Math.PI;
  let psi    = 0;
  let c2     = 0.5;
  let c3     = 1/6;

  for (let k = 0; k < 150; k++) {
    let y = r1 + r2 + A * (psi * c3 - 1) / Math.sqrt(c2);

    // Ensure y stays positive when A > 0
    if (A > 0 && y < 0) {
      psi_lo = psi;
      const psi_next = 0.8 * (1/c3) * (1 - (r1 + r2) * Math.sqrt(c2) / A);
      psi = Math.max(psi_next, psi_lo + 0.1);
      c2  = progStumpffC(psi);
      c3  = progStumpffS(psi);
      continue;
    }
    if (y < 0) return null;

    const chi    = Math.sqrt(y / c2);
    const t_test = (chi*chi*chi * c3 + A * Math.sqrt(y)) / Math.sqrt(mu);

    if (Math.abs(t_test - tof_s) < 1e-6 * tof_s) break;

    if (t_test < tof_s) psi_lo = psi;
    else                psi_hi = psi;

    psi = (psi_lo + psi_hi) / 2;
    c2  = progStumpffC(psi);
    c3  = progStumpffS(psi);
  }

  const y    = r1 + r2 + A * (psi * c3 - 1) / Math.sqrt(c2);
  if (y <= 0) return null;

  const f     = 1 - y / r1;
  const g     = A * Math.sqrt(y / mu);
  const g_dot = 1 - y / r2;
  if (Math.abs(g) < 1e-12) return null;

  return {
    v1: [(r2v[0] - f*r1v[0]) / g,         (r2v[1] - f*r1v[1]) / g],
    v2: [(g_dot*r2v[0] - r1v[0]) / g,     (g_dot*r2v[1] - r1v[1]) / g],
  };
}

// ── Planet state (real ephemeris, ecliptic-projected for the 2D Lambert) ─────

/** Heliocentric position [x,y] km at t_days past the program epoch (z dropped). */
function progHelioPos(body, t_days) {
  if (!PROG_BODY_ELEMENTS[body]) return null;
  const st = progBodyEphemState(body, t_days * 86400);
  return [st.r[0], st.r[1]];
}

/** Heliocentric velocity [vx,vy] km/s at t_days past the program epoch (z dropped). */
function progHelioVel(body, t_days) {
  if (!PROG_BODY_ELEMENTS[body]) return null;
  const st = progBodyEphemState(body, t_days * 86400);
  return [st.v[0], st.v[1]];
}

// ── C3 grid computation ───────────────────────────────────────────────────────

/**
 * Departure C3 (km²/s²) for a heliocentric transfer.
 * Returns Infinity if Lambert fails.
 */
function progDepartureC3(dep_body, arr_body, dep_day, tof_day) {
  if (tof_day < 10) return Infinity;
  const r1v = progHelioPos(dep_body, dep_day);
  const r2v = progHelioPos(arr_body, dep_day + tof_day);
  if (!r1v || !r2v) return Infinity;
  const sol = progLambert2D(r1v, r2v, tof_day * 86400, PROG_PORK_MU);
  if (!sol) return Infinity;
  const ve  = progHelioVel(dep_body, dep_day);
  const vix = sol.v1[0] - ve[0];
  const viy = sol.v1[1] - ve[1];
  return vix*vix + viy*viy;
}

/**
 * Compute a C3 pork chop grid.
 * Returns { grid[j][i], dep_days[], tof_days[], c3_min, c3_min_dep, c3_min_tof }
 */
function progPorkchopGrid(dep_body, arr_body, opts) {
  const { dep_start=0, dep_end=800, tof_start=120, tof_end=540, nx=130, ny=80 } = opts ?? {};
  const dep_step = (dep_end - dep_start) / Math.max(nx - 1, 1);
  const tof_step = (tof_end - tof_start) / Math.max(ny - 1, 1);
  const dep_days = Array.from({length: nx}, (_, i) => dep_start + i*dep_step);
  const tof_days = Array.from({length: ny}, (_, j) => tof_start + j*tof_step);
  const grid = [];
  let c3_min = Infinity, c3_min_dep = dep_start, c3_min_tof = tof_start;

  for (let j = 0; j < ny; j++) {
    const row = [];
    for (let i = 0; i < nx; i++) {
      const c3 = progDepartureC3(dep_body, arr_body, dep_days[i], tof_days[j]);
      row.push(c3);
      if (c3 < c3_min) { c3_min = c3; c3_min_dep = dep_days[i]; c3_min_tof = tof_days[j]; }
    }
    grid.push(row);
  }
  return { grid, dep_days, tof_days, dep_step, tof_step, c3_min, c3_min_dep, c3_min_tof, dep_body, arr_body };
}

// Destinations the plotter actually supports (Lambert grid data available).
const PROG_PORK_DESTINATIONS = ['Mars', 'Venus'];

// ---- Canvas rendering -------------------------------------------------------

/** Map C3 to a CSS colour string (blue=low, red=high, black=Infinity).
 *  Fixed perceptual ramp used as DATA (theming exemption --
 *  Theming rules: series/heatmap palettes are exempt chrome-vs-data). */
function progPorkC3Color(c3, c3_min, c3_max) {
  if (!isFinite(c3)) return '#000000';
  const lo = c3_min, hi = Math.max(c3_max, c3_min + 1e-6);
  let t = (c3 - lo) / (hi - lo);
  t = Math.max(0, Math.min(1, t));
  // blue (low) -> cyan -> green -> yellow -> red (high), a simple 5-stop ramp.
  const stops = [
    [0.00, 33, 60, 180],
    [0.25, 30, 160, 190],
    [0.50, 90, 190, 90],
    [0.75, 230, 200, 40],
    [1.00, 210, 40, 40],
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const span = (b[0] - a[0]) || 1;
  const lt = (t - a[0]) / span;
  const r = Math.round(a[1] + (b[1] - a[1]) * lt);
  const g = Math.round(a[2] + (b[2] - a[2]) * lt);
  const bl = Math.round(a[3] + (b[3] - a[3]) * lt);
  return 'rgb(' + r + ',' + g + ',' + bl + ')';
}

// Cache of the last-built grid, keyed by destination + program epoch (R1:
// positions depend on epochJD now), so hover/click handlers don't re-run the
// Lambert solve on every mouse move.
let _progPorkGridCache = { key: null, grid: null };

/** Build (or reuse the cached) porkchop grid for Earth -> destination. */
function progPorkGetGrid(destination) {
  const key = destination + '|' + progEpochJD();
  if (_progPorkGridCache.key === key && _progPorkGridCache.grid) return _progPorkGridCache.grid;
  const grid = progPorkchopGrid('Earth', destination, {});
  _progPorkGridCache = { key, grid };
  return grid;
}

/** Render a porkchop grid onto a <canvas>. Chrome/labels are drawn by the
 *  caller (HTML/CSS, themeable) -- this only paints the C3 heatmap pixels. */
function progPorkRenderCanvas(canvas, grid) {
  if (!canvas || !grid) return;
  const nx = grid.dep_days.length, ny = grid.tof_days.length;
  canvas.width = nx; canvas.height = ny;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(nx, ny);
  // Cap the colour scale a bit above the minimum so a single Infinity/huge
  // outlier region doesn't wash out all the interesting low-C3 structure.
  let c3_max = grid.c3_min;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c3 = grid.grid[j][i];
    if (isFinite(c3) && c3 < grid.c3_min * 6 + 20) c3_max = Math.max(c3_max, c3);
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c3 = grid.grid[j][i];
      const col = progPorkC3Color(c3, grid.c3_min, c3_max);
      const m = col.match(/rgb\((\d+),(\d+),(\d+)\)/);
      const idx = (j * nx + i) * 4;
      img.data[idx]   = m ? +m[1] : 0;
      img.data[idx+1] = m ? +m[2] : 0;
      img.data[idx+2] = m ? +m[3] : 0;
      img.data[idx+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Cell (i,j) -> {dep_day, tof_day, c3} for a grid, from canvas-local px (px,py)
 *  -- the canvas is drawn 1px/cell so px/py map directly to grid indices. */
function progPorkCellAt(grid, px, py) {
  if (!grid) return null;
  const nx = grid.dep_days.length, ny = grid.tof_days.length;
  const i = Math.max(0, Math.min(nx - 1, Math.floor(px)));
  const j = Math.max(0, Math.min(ny - 1, Math.floor(py)));
  return { i, j, dep_day: grid.dep_days[i], tof_day: grid.tof_days[j], c3: grid.grid[j][i] };
}

/**
 * Set/clear the active program's selected launch window.
 * Shape: { destination, dep_day, tof_days, c3 } -- destination-keyed so a
 * window picked for Mars doesn't leak into a Venus leg (progTransferTOF and
 * the C3 calibration path both check `destination` before using it).
 */
function progPorkSetWindow(destination, dep_day, tof_day, c3) {
  if (typeof PROG_ACTIVE_PROGRAM === 'undefined' || !PROG_ACTIVE_PROGRAM) return;
  PROG_ACTIVE_PROGRAM.launchWindow = { destination, dep_day, tof_days: tof_day, c3 };
}
function progPorkClearWindow() {
  if (typeof PROG_ACTIVE_PROGRAM === 'undefined' || !PROG_ACTIVE_PROGRAM) return;
  delete PROG_ACTIVE_PROGRAM.launchWindow;
}

// ---- UI wiring (modal-mission-porkchop) -------------------------------------
// State for the currently-open modal: which mission/event we're picking a
// window for, the destination, and the pending (unapplied) selection.
let _porkUI = { missionId: null, evtIdx: null, destination: null, pending: null };

/** True when a maneuver's To-node is a porkchop-supported interplanetary leg.
 *  Returns the destination name ('Mars'/'Venus') or null. */
function progPorkDestinationForNode(toNodeId) {
  const node = _missionNmNodeById(toNodeId);
  const o = node && node.orbit;
  if (!o || o.type !== 'transit' || o.body !== 'Sun' || !o.destination) return null;
  return PROG_PORK_DESTINATIONS.indexOf(o.destination) >= 0 ? o.destination : null;
}

/** Open the launch-window modal for a given mission + maneuver event index. */
function progPorkOpenModal(missionId, evtIdx, toNodeId) {
  const dest = progPorkDestinationForNode(toNodeId);
  if (!dest) return;
  _porkUI = { missionId, evtIdx, destination: dest, pending: null };
  if (typeof openModal === 'function') openModal('modal-mission-porkchop');
  progPorkRenderModal();
}

function progPorkCloseModal() {
  if (typeof closeModal === 'function') closeModal('modal-mission-porkchop');
}

/** Currently-selected window for the modal's destination, if any. */
function progPorkActiveWindowFor(destination) {
  const lw = (typeof PROG_ACTIVE_PROGRAM !== 'undefined' && PROG_ACTIVE_PROGRAM && PROG_ACTIVE_PROGRAM.launchWindow) || null;
  if (lw && lw.destination === destination) return lw;
  return null;
}

function _porkFmtWindow(w) {
  if (!w) return '';
  return 'Dep T+' + Math.round(w.dep_day) + 'd &middot; TOF ' + Math.round(w.tof_days) + 'd &middot; C3 ' + w.c3.toFixed(1) + ' km&sup2;/s&sup2;';
}

/** Build the full modal body HTML (canvas + readout + apply/clear controls). */
function progPorkRenderModal() {
  const body = document.getElementById('mporkchop-body');
  if (!body) return;
  const dest = _porkUI.destination;
  const active = progPorkActiveWindowFor(dest);
  const sel = _porkUI.pending || active;
  const summary = sel
    ? '<div id="pork-summary" style="font-family:var(--mono);font-size:11px;color:var(--accent);margin-top:6px;">' + _porkFmtWindow(sel) + '</div>'
    : '<div id="pork-summary" style="font-family:var(--mono);font-size:11px;color:var(--text-dim);margin-top:6px;">// hover the heatmap, click a cell to select a window</div>';
  body.innerHTML =
    '<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-bottom:8px;">' +
      'Earth &rarr; ' + dest + ' departure C3 (km&sup2;/s&sup2;) &mdash; x: departure day, y: time of flight (days)' +
    '</div>' +
    '<div style="position:relative;border:1px solid var(--border);display:inline-block;">' +
      '<canvas id="pork-canvas" style="display:block;width:520px;height:320px;image-rendering:pixelated;cursor:crosshair;"' +
        ' onmousemove="progPorkCanvasHover(event)" onmouseleave="progPorkCanvasLeave()" onclick="progPorkCanvasClick(event)"></canvas>' +
    '</div>' +
    '<div id="pork-hover" style="font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-top:6px;min-height:14px;">&nbsp;</div>' +
    summary +
    '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<button class="act-btn" style="flex:1;" onclick="progPorkClearSelection()">Clear</button>' +
      '<button class="act-btn" style="flex:1;background:var(--accent);color:#000;font-weight:600;" onclick="progPorkApplySelection()">Apply</button>' +
    '</div>';
  const canvas = document.getElementById('pork-canvas');
  const grid = progPorkGetGrid(dest);
  progPorkRenderCanvas(canvas, grid);
}

function _porkCanvasCell(evt) {
  const canvas = document.getElementById('pork-canvas');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const px = (evt.clientX - rect.left) / rect.width * canvas.width;
  const py = (evt.clientY - rect.top) / rect.height * canvas.height;
  const grid = progPorkGetGrid(_porkUI.destination);
  return progPorkCellAt(grid, px, py);
}

function progPorkCanvasHover(evt) {
  const cell = _porkCanvasCell(evt);
  const out = document.getElementById('pork-hover');
  if (!out) return;
  if (!cell || !isFinite(cell.c3)) { out.innerHTML = '&nbsp;'; return; }
  out.textContent = 'Dep T+' + Math.round(cell.dep_day) + 'd · TOF ' + Math.round(cell.tof_day) + 'd · C3 ' + cell.c3.toFixed(1) + ' km²/s²';
}

function progPorkCanvasLeave() {
  const out = document.getElementById('pork-hover');
  if (out) out.innerHTML = '&nbsp;';
}

function progPorkCanvasClick(evt) {
  const cell = _porkCanvasCell(evt);
  if (!cell || !isFinite(cell.c3)) return;
  _porkUI.pending = { destination: _porkUI.destination, dep_day: cell.dep_day, tof_days: cell.tof_day, c3: cell.c3 };
  const summary = document.getElementById('pork-summary');
  if (summary) { summary.style.color = 'var(--accent)'; summary.innerHTML = _porkFmtWindow(_porkUI.pending); }
}

function progPorkClearSelection() {
  _porkUI.pending = { __clear: true };
  const summary = document.getElementById('pork-summary');
  if (summary) { summary.style.color = 'var(--text-dim)'; summary.innerHTML = '// window cleared -- Hohmann default will be used'; }
}

/** Apply the pending selection (or clear) to the program and recompute the mission. */
function progPorkApplySelection() {
  const pend = _porkUI.pending;
  if (pend && pend.__clear) {
    progPorkClearWindow();
  } else if (pend) {
    progPorkSetWindow(pend.destination, pend.dep_day, pend.tof_days, pend.c3);
  }
  progPorkCloseModal();
  const m = (_porkUI.missionId) ? _missionGet(_porkUI.missionId) : null;
  if (m) missionRecompute(m);
  missionRenderDetail();
}

/** Small chip HTML for a maneuver card showing the active window (or default).
 *  Returns '' when the leg isn't a porkchop-supported interplanetary route. */
function progPorkChipHTML(missionId, evtIdx, toNodeId) {
  const dest = progPorkDestinationForNode(toNodeId);
  if (!dest) return '';
  const w = progPorkActiveWindowFor(dest);
  const label = w ? ('⚟ ' + Math.round(w.tof_days) + 'd window') : '⚟ Hohmann default';
  return '<button class="act-btn" style="font-size:9px;padding:3px 7px;" ' +
    'onclick="progPorkOpenModal(\'' + missionId + '\',' + evtIdx + ',\'' + toNodeId + '\')" ' +
    'title="Selected launch window for the ' + dest + ' leg">' + label + '</button>';
}

/** Button HTML for the Add-Event maneuver form / edit modal, greyed out with a
 *  tooltip for non-porkchop destinations (per-spec: Mars/Venus supported). */
function progPorkButtonHTML(missionId, evtIdx, toNodeId) {
  const dest = progPorkDestinationForNode(toNodeId);
  const node = _missionNmNodeById(toNodeId);
  const isTransit = node && node.orbit && node.orbit.type === 'transit' && node.orbit.body === 'Sun';
  if (!isTransit) return '';
  if (!dest) {
    return '<button class="act-btn" disabled style="opacity:.4;cursor:not-allowed;" ' +
      'title="Launch-window plotting only supports Mars and Venus routes">⚟ Launch window…</button>';
  }
  return '<button class="act-btn" onclick="progPorkOpenModal(\'' + missionId + '\',' + (evtIdx == null ? -1 : evtIdx) + ',\'' + toNodeId + '\')">⚟ Launch window…</button>';
}
