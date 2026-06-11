
// ─── PROGRAM MODULE — Phase 6: Pork Chop Plotter ─────────────────────────────
//
// Lambert solver → C3 departure grid → canvas heatmap → click-to-select window.
// Selected window sets PROG_ACTIVE_PROGRAM.launchWindow which drives COAST duration.
//
// Planet model: circular, coplanar ecliptic orbits.
// theta0_rad: phase angle at T=0 calibrated so a Hohmann departure is near day 0.

const PROG_PORK_MU = 1.32712440018e11;   // km³/s² — Sun

// Planet data.  theta0_rad chosen so optimal (Hohmann) departure ≈ T+0.
const PROG_PORK_DATA = {
  Earth: { period_d: 365.256, r_km: 149597870.7, theta0_rad: 0       },
  Mars:  { period_d: 686.971, r_km: 227939200,   theta0_rad: 0.7729  }, // 44.3°
  Venus: { period_d: 224.701, r_km: 108208930,   theta0_rad: 5.3390  }, // 305.9°
};

// ── Stumpff functions ─────────────────────────────────────────────────────────
// C(ψ) = ∫₀¹ cos(√ψ·t) dt-equivalent  |  S(ψ) = ∫₀¹ sin(√ψ·t)/√ψ dt-equivalent
function progStumpffC(psi) {
  if (psi >  1e-6) return (1 - Math.cos(Math.sqrt(psi))) / psi;
  if (psi < -1e-6) return (Math.cosh(Math.sqrt(-psi)) - 1) / (-psi);
  return 0.5;                      // series limit
}
function progStumpffS(psi) {
  if (psi >  1e-6) { const s = Math.sqrt(psi);  return (s - Math.sin(s))       / (s * psi); }
  if (psi < -1e-6) { const s = Math.sqrt(-psi); return (Math.sinh(s) - s)      / (s * (-psi)); }
  return 1/6;                      // series limit
}

// ── Lambert solver (universal variable method, bisection) ─────────────────────
// Algorithm: Universal Variable Method, bisection on ψ.
// Source: Curtis, H. (2013). Orbital Mechanics for Engineering Students, §5.3.
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

// ── Planet state (circular orbit model) ──────────────────────────────────────

/** Heliocentric position [x,y] km at t_days from epoch. */
function progHelioPos(body, t_days) {
  const d = PROG_PORK_DATA[body];
  if (!d) return null;
  const theta = d.theta0_rad + 2*Math.PI * t_days / d.period_d;
  return [d.r_km * Math.cos(theta), d.r_km * Math.sin(theta)];
}

/** Heliocentric velocity [vx,vy] km/s at t_days (tangential, CCW). */
function progHelioVel(body, t_days) {
  const d = PROG_PORK_DATA[body];
  if (!d) return null;
  const theta = d.theta0_rad + 2*Math.PI * t_days / d.period_d;
  const v     = 2*Math.PI * d.r_km / (d.period_d * 86400);
  return [-v * Math.sin(theta), v * Math.cos(theta)];
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

// ── Canvas rendering ──────────────────────────────────────────────────────────

/** Map C3 to a CSS colour string (blue=low, red=high, black=Infinity). */




/**
 * Create / update a COAST event in the active program with the selected
 * inter-planetary transit duration. The COAST event represents the
 * heliocentric cruise from TMI to arrival.
 */

/** Switch the pork chop between Earth\u2192Mars and Earth\u2192Venus. */

/** Initialise the pork chop plotter (called from INIT). */
