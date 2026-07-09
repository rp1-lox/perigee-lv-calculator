
// ─── PROGRAM MODULE — Phase 1: Delta-V Engine ───────────────────────
// Pure JS, no UI. Band View and Node Map: Phases 7 and 8.

// ── Body constants ─────────────────────────────────────────────────────────
const PROG_BODIES = {
  Earth:   { mu: 398600.4418,  R: 6371.0  },   // km³/s², km
  Moon:    { mu:   4902.800,   R: 1737.4  },
  Mars:    { mu:  42828.375,   R: 3389.5  },
  Venus:   { mu: 324858.592,   R: 6051.8  },
  Mercury: { mu:  22031.868,   R: 2439.7  },
  Jupiter: { mu: 126686534.0,  R: 69911.0 },
  Saturn:  { mu:  37931187.0,  R: 58232.0 },
  Uranus:  { mu:   5793939.0,  R: 25362.0 },
  Neptune: { mu:   6836529.0,  R: 24622.0 },
  Titan:   { mu:      8978.14, R: 2574.7  },
};
const PROG_MU_SUN       = 1.32712440018e11; // km³/s² — heliocentric
const PROG_HELIO_R      = {                  // km — mean orbital radii
  Mercury: 57.91e6,
  Venus:   108208930,
  Earth:   149597870.7,
  Mars:    227939200,
  Jupiter: 778.5e6,
  Saturn:  1.4335e9,
  Uranus:  2.8725e9,
  Neptune: 4.4951e9,
};
const PROG_MOON_ORBIT_R = 384400; // km — Moon orbital radius from Earth centre

// Moon-type bodies orbiting a planet rather than the Sun (for trajectory scenes
// and any future local-orbit math). Keyed by body name; `parent` must exist in
// PROG_BODIES, `r` is mean orbital radius (km) from parent centre.
const PROG_MOON_ORBITS = {
  Moon:  { parent: 'Earth',  r: PROG_MOON_ORBIT_R },
  Titan: { parent: 'Saturn', r: 1221900 },
};

// ── Body kinematics (C1a) ────────────────────────────────────────────────────
// Single source of truth for orbital PERIOD (seconds, canonical — kills the
// seconds-vs-days unit bug class at the source) and phase angle at T=0
// (theta0_rad) for every body the trajectory view / porkchop plotter draws.
// A PARALLEL map (not a rework of PROG_HELIO_R) so existing consumers of
// PROG_HELIO_R as plain numbers (progTransferTOF/TMI/etc.) are untouched.
//
// Periods (days -> seconds, ×86400):
//   Mercury 87.969d, Venus 224.701d, Earth 365.256d, Mars 686.971d,
//   Jupiter 4332.59d, Saturn 10759.22d, Uranus 30688.5d, Neptune 60182d,
//   Moon 27.3217d, Titan 15.9454d.
//
// theta0_rad:
//   - Earth/Mars/Venus: taken directly FROM PROG_PORK_DATA (410) — those
//     values are calibrated so a Hohmann departure lands near day 0. The
//     porkchop module reads its theta0s from THIS table now (single source);
//     see 410's PROG_PORK_DATA for the unification.
//   - All other bodies (planets + Moon/Titan): the CURRENT schematic spread
//     angles used by 574's Sun scene / body scenes, extracted verbatim so
//     t=0 renders identically to today.
//     Sun scene planets: spread evenly over Object.keys(PROG_HELIO_R),
//     ang = (i/n)*2*Math.PI - Math.PI/2, n = 8 (Mercury..Neptune in
//     PROG_HELIO_R's declared order).
//     Moon/Titan (body scene moon rings): schematic angle 0 (drawn at
//     cx=rr, cy=0 — see _trajBodySceneSVG in 574).
const PROG_BODY_KINEMATICS = {
  Mercury: { period_s: 87.969   * 86400, theta0_rad: (0/8) * 2*Math.PI - Math.PI/2 },
  Venus:   { period_s: 224.701  * 86400, theta0_rad: 5.3390 },                        // porkchop-calibrated
  Earth:   { period_s: 365.256  * 86400, theta0_rad: 0 },                             // porkchop-calibrated
  Mars:    { period_s: 686.971  * 86400, theta0_rad: 0.7729 },                        // porkchop-calibrated
  Jupiter: { period_s: 4332.59  * 86400, theta0_rad: (4/8) * 2*Math.PI - Math.PI/2 },
  Saturn:  { period_s: 10759.22 * 86400, theta0_rad: (5/8) * 2*Math.PI - Math.PI/2 },
  Uranus:  { period_s: 30688.5  * 86400, theta0_rad: (6/8) * 2*Math.PI - Math.PI/2 },
  Neptune: { period_s: 60182    * 86400, theta0_rad: (7/8) * 2*Math.PI - Math.PI/2 },
  Moon:    { period_s: 27.3217  * 86400, theta0_rad: 0 },
  Titan:   { period_s: 15.9454  * 86400, theta0_rad: 0 },
};

/** Body phase angle (radians, normalized to [0, 2π)) at time t_s (seconds since epoch). */
function progBodyAngleAt(body, t_s) {
  const k = PROG_BODY_KINEMATICS[body];
  if (!k) return 0;
  const t = t_s || 0;
  let theta = k.theta0_rad + 2 * Math.PI * t / k.period_s;
  theta = theta % (2 * Math.PI);
  if (theta < 0) theta += 2 * Math.PI;
  return theta;
}

/** Heliocentric world position {x,y} km at time t_s. Sun={0,0}; planets on
 * their PROG_HELIO_R ring; moons = parent position + moon-ring offset. Pure. */
function progBodyWorldPos(body, t_s) {
  if (body === 'Sun') return { x: 0, y: 0 };
  const moonInfo = PROG_MOON_ORBITS && PROG_MOON_ORBITS[body];
  if (moonInfo) {
    const parentPos = progBodyWorldPos(moonInfo.parent, t_s);
    const theta = progBodyAngleAt(body, t_s);
    return { x: parentPos.x + moonInfo.r * Math.cos(theta), y: parentPos.y + moonInfo.r * Math.sin(theta) };
  }
  const r = PROG_HELIO_R[body];
  if (r == null) return { x: 0, y: 0 };
  const theta = progBodyAngleAt(body, t_s);
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
}

// ── Propellant type registry ────────────────────────────────────────────────
const PROG_PROPELLANT_TYPES = {
  LOX_LH2:  { boiloff_rate: 0.0030, label: 'LOX/LH2',         cryo: true      },
  LOX_RP1:  { boiloff_rate: 0.0002, label: 'LOX/RP-1',        cryo: 'partial' },
  LOX_CH4:  { boiloff_rate: 0.0010, label: 'LOX/Methane',      cryo: true      },
  NTO_A50:  { boiloff_rate: 0.0000, label: 'NTO/Aerozine-50',  cryo: false     },
  NTO_UDMH: { boiloff_rate: 0.0000, label: 'NTO/UDMH',         cryo: false     },
  SOLID:    { boiloff_rate: 0.0000, label: 'Solid',             cryo: false     },
};

// ── OrbitalState ──────────────────────────────────────────────────────────────
/**
 * Create an OrbitalState (spec §3.8).
 * For circular orbits apogee === perigee === alt_km.
 * surface is inferred true when alt_km === 0.
 */
function progMakeOrbitalState(body, alt_km, inc_deg, lan_deg) {
  return {
    body,
    apogee:      alt_km  ?? 0,
    perigee:     alt_km  ?? 0,
    inclination: inc_deg ?? 0,
    lan:         lan_deg ?? 0,
    epoch:       0,                        // T+ seconds; set by event engine
    surface:     (alt_km ?? 0) === 0,
  };
}

/** Surface OrbitalState shorthand. */
function progMakeSurfaceState(body) {
  return progMakeOrbitalState(body, 0, 0, 0);
}

/** True if two OrbitalStates are close enough to dock (Rule 3). */
function progOrbitalStateMatch(a, b) {
  return a.body === b.body &&
    Math.abs((a.apogee      ?? 0) - (b.apogee      ?? 0)) < 1 &&
    Math.abs((a.perigee     ?? 0) - (b.perigee     ?? 0)) < 1 &&
    Math.abs((a.inclination ?? 0) - (b.inclination ?? 0)) < 0.1 &&
    Math.abs((a.lan         ?? 0) - (b.lan         ?? 0)) < 1;
}

// ── Core ΔV functions ───────────────────────────────────────────────────────

/** Circular orbital speed at altitude, km/s. */
function progVcirc(body, alt_km) {
  const b = PROG_BODIES[body];
  return Math.sqrt(b.mu / (b.R + alt_km));
}

/** Hohmann transfer ΔVs between two circular orbits.
 *  Returns { dv1_ms, dv2_ms, total_ms } in m/s. */
function progDvHohmann(body, alt1_km, alt2_km) {
  const b  = PROG_BODIES[body];
  const r1 = b.R + alt1_km, r2 = b.R + alt2_km;
  const a  = (r1 + r2) / 2;
  const v1 = Math.sqrt(b.mu / r1);
  const v2 = Math.sqrt(b.mu / r2);
  const vp = Math.sqrt(b.mu * (2/r1 - 1/a));
  const va = Math.sqrt(b.mu * (2/r2 - 1/a));
  const dv1 = Math.abs(vp - v1) * 1000;
  const dv2 = Math.abs(v2 - va) * 1000;
  return { dv1_ms: dv1, dv2_ms: dv2, total_ms: dv1 + dv2 };
}

/** Simple plane change ΔV at a circular orbit, m/s. */
function progDvPlaneChange(body, alt_km, delta_inc_deg) {
  const v     = progVcirc(body, alt_km);
  const theta = delta_inc_deg * Math.PI / 180;
  return 2 * v * Math.sin(theta / 2) * 1000;
}

/** Combined plane change + propulsive burn (vector addition), m/s. */
function progDvCombined(body, alt_km, delta_inc_deg, dv_prop_ms) {
  const dv_plane = progDvPlaneChange(body, alt_km, delta_inc_deg);
  return Math.sqrt(dv_plane * dv_plane + dv_prop_ms * dv_prop_ms);
}

/**
 * Full plane change ΔV including both inclination and LAN change, m/s.
 * Uses spherical law of cosines to compute the angle between two orbit planes:
 *   cos(θ) = cos(i1)·cos(i2) + sin(i1)·sin(i2)·cos(ΔLAN)
 * This generalises progDvPlaneChange (which only handles Δinclination).
 * ΔLAN = 0 → reduces exactly to progDvPlaneChange(body, alt, |i2-i1|).
 */
function progDvPlaneChangeFull(body, alt_km, i1_deg, lan1_deg, i2_deg, lan2_deg) {
  const i1   = i1_deg  * Math.PI / 180;
  const i2   = i2_deg  * Math.PI / 180;
  const dlan = (lan2_deg - lan1_deg) * Math.PI / 180;
  const cos_theta = Math.cos(i1)*Math.cos(i2) + Math.sin(i1)*Math.sin(i2)*Math.cos(dlan);
  const theta = Math.acos(Math.max(-1, Math.min(1, cos_theta)));
  const v     = progVcirc(body, alt_km);
  return 2 * v * Math.sin(theta / 2) * 1000;
}

/** Circularize at apoapsis of an elliptical orbit (e.g. GTO → GEO), m/s.
 *  alt_peri_km and alt_apo_km are altitudes above body surface (same convention
 *  as all other progDv* functions). */
function progDvCircularizeAtApo(body, alt_peri_km, alt_apo_km) {
  const b   = PROG_BODIES[body];
  const r_p = b.R + alt_peri_km;
  const r_a = b.R + alt_apo_km;
  const a   = (r_p + r_a) / 2;
  const va  = Math.sqrt(b.mu * (2/r_a - 1/a));
  const vc  = Math.sqrt(b.mu / r_a);
  return Math.abs(vc - va) * 1000;
}

// ── Cis-lunar transfers ───────────────────────────────────────────────────

/** Trans-Lunar Injection ΔV from LEO, m/s.
 *  Models TLI as a Hohmann transfer with apoapsis at the Moon's orbital radius. */
function progDvTLI(leo_alt_km) {
  const mu  = PROG_BODIES.Earth.mu;
  const r1  = PROG_BODIES.Earth.R + leo_alt_km;
  const r_m = PROG_MOON_ORBIT_R;
  const a   = (r1 + r_m) / 2;
  const v_leo  = Math.sqrt(mu / r1);
  const v_peri = Math.sqrt(mu * (2/r1 - 1/a));
  return Math.abs(v_peri - v_leo) * 1000;
}

/** Lunar Orbit Insertion ΔV, m/s.
 *  Computes v_inf at Moon SOI from TLI Hohmann, then LOI burn to LLO.
 *  NOTE: Hohmann model gives ~822 m/s; real Apollo LOI ~900 m/s via
 *  free-return trajectory — known Hohmann-model underestimate. */
function progDvLOI(llo_alt_km, leo_alt_km) {
  const mu_E   = PROG_BODIES.Earth.mu;
  const mu_M   = PROG_BODIES.Moon.mu;
  const r1     = PROG_BODIES.Earth.R + (leo_alt_km ?? 185);
  const r_m    = PROG_MOON_ORBIT_R;
  const a_tli  = (r1 + r_m) / 2;
  const v_moon = Math.sqrt(mu_E / r_m);        // Moon's orbital speed
  const v_apo  = Math.sqrt(mu_E * (2/r_m - 1/a_tli)); // TLI apo speed
  const v_inf  = Math.abs(v_moon - v_apo);     // hyperbolic excess at Moon SOI
  const r_llo  = PROG_BODIES.Moon.R + llo_alt_km;
  const v_hyp  = Math.sqrt(v_inf*v_inf + 2*mu_M/r_llo);
  const v_llo  = Math.sqrt(mu_M / r_llo);
  return Math.abs(v_hyp - v_llo) * 1000;
}

/** Trans-Earth Injection ΔV (symmetric to LOI in Hohmann model), m/s. */
function progDvTEI(llo_alt_km, leo_alt_km) {
  return progDvLOI(llo_alt_km, leo_alt_km);
}

// ── Interplanetary transfers ──────────────────────────────────────────────

/** Trans-Mars Injection ΔV from LEO, m/s. */
function progDvTMI(leo_alt_km) {
  const r_E   = PROG_HELIO_R.Earth;
  const r_M   = PROG_HELIO_R.Mars;
  const a     = (r_E + r_M) / 2;
  const v_E   = Math.sqrt(PROG_MU_SUN / r_E);
  const v_dep = Math.sqrt(PROG_MU_SUN * (2/r_E - 1/a));
  const v_inf = v_dep - v_E;                   // positive: outer planet
  const mu = PROG_BODIES.Earth.mu;
  const r  = PROG_BODIES.Earth.R + leo_alt_km;
  return Math.abs(Math.sqrt(v_inf*v_inf + 2*mu/r) - Math.sqrt(mu/r)) * 1000;
}

/** Mars Orbit Insertion ΔV, m/s. */
function progDvMOI(mco_alt_km) {
  const r_E     = PROG_HELIO_R.Earth;
  const r_M     = PROG_HELIO_R.Mars;
  const a       = (r_E + r_M) / 2;
  const v_M_orb = Math.sqrt(PROG_MU_SUN / r_M);
  const v_apo   = Math.sqrt(PROG_MU_SUN * (2/r_M - 1/a));
  const v_inf   = Math.abs(v_M_orb - v_apo);
  const mu_M  = PROG_BODIES.Mars.mu;
  const r_mco = PROG_BODIES.Mars.R + mco_alt_km;
  return Math.abs(Math.sqrt(v_inf*v_inf + 2*mu_M/r_mco) - Math.sqrt(mu_M/r_mco)) * 1000;
}

/** Trans-Venus Injection ΔV from LEO, m/s. */
function progDvTVI(leo_alt_km) {
  const r_E       = PROG_HELIO_R.Earth;
  const r_V       = PROG_HELIO_R.Venus;
  const a         = (r_E + r_V) / 2;
  const v_E       = Math.sqrt(PROG_MU_SUN / r_E);
  const v_apo_dep = Math.sqrt(PROG_MU_SUN * (2/r_E - 1/a));
  const v_inf     = Math.abs(v_E - v_apo_dep); // Earth faster than apo (inner planet)
  const mu = PROG_BODIES.Earth.mu;
  const r  = PROG_BODIES.Earth.R + leo_alt_km;
  return Math.abs(Math.sqrt(v_inf*v_inf + 2*mu/r) - Math.sqrt(mu/r)) * 1000;
}

/** Venus Orbit Insertion ΔV, m/s. */
function progDvVOI(vco_alt_km) {
  const r_E     = PROG_HELIO_R.Earth;
  const r_V     = PROG_HELIO_R.Venus;
  const a       = (r_E + r_V) / 2;
  const v_V_orb = Math.sqrt(PROG_MU_SUN / r_V);
  const v_peri  = Math.sqrt(PROG_MU_SUN * (2/r_V - 1/a));
  const v_inf   = Math.abs(v_peri - v_V_orb);
  const mu_V  = PROG_BODIES.Venus.mu;
  const r_vco = PROG_BODIES.Venus.R + vco_alt_km;
  return Math.abs(Math.sqrt(v_inf*v_inf + 2*mu_V/r_vco) - Math.sqrt(mu_V/r_vco)) * 1000;
}

// ── Ascent ΔV estimates ───────────────────────────────────────────────────

/** Lunar ascent ΔV, surface to LLO, m/s.
 *  Scaled from 1870 m/s baseline at LLO 100 km. */
function progDvLunarAscent(llo_alt_km) {
  const BASE_DV = 1870;
  const v_ref   = Math.sqrt(PROG_BODIES.Moon.mu / (PROG_BODIES.Moon.R + 100));
  const v_h     = Math.sqrt(PROG_BODIES.Moon.mu / (PROG_BODIES.Moon.R + llo_alt_km));
  return BASE_DV * (v_h / v_ref);
}

/** Mars ascent ΔV, surface to MCO, m/s.
 *  Scaled from 3810 m/s baseline at MCO 400 km. */
function progDvMarsAscent(mco_alt_km) {
  const BASE_DV = 3810;
  const v_ref   = Math.sqrt(PROG_BODIES.Mars.mu / (PROG_BODIES.Mars.R + 400));
  const v_h     = Math.sqrt(PROG_BODIES.Mars.mu / (PROG_BODIES.Mars.R + mco_alt_km));
  return BASE_DV * (v_h / v_ref);
}

// ── Time-of-flight (TOF) estimates ─────────────────────────────────────────
// Pure, position-independent duration helpers for the mission clock (T2 core).
// All return SECONDS. These are annotation-only inputs to the replay's MET
// accumulation — they never affect ΔV or propellant math.

/** Half-ellipse Hohmann transfer time, seconds.
 *  a = (r1+r2)/2 (km); period T = 2π√(a³/μ); TOF = T/2. */
function progHohmannTOF(body, alt1_km, alt2_km) {
  const b  = PROG_BODIES[body];
  if (!b) return 0;
  const r1 = b.R + alt1_km, r2 = b.R + alt2_km;
  const a  = (r1 + r2) / 2;
  return Math.PI * Math.sqrt((a * a * a) / b.mu);
}

/**
 * Estimated transfer time between two node-map nodes, seconds.
 * Mirrors _nmDvPhysics's node-shape assumptions (node.orbit: type/body/perigee/
 * apogee/c3/destination) but only needs to classify same-body vs. transit legs —
 * it does not need the full ΔV case analysis.
 *   - Same-body orbit→orbit (both circular/elliptic, or surface as alt=0):
 *     Hohmann half-ellipse between their (average) altitudes.
 *   - Earth → Moon transit destinations (TLC corridor / LLO / lunar surface):
 *     translunar half-ellipse using PROG_MOON_ORBIT_R as the outer radius.
 *   - Earth → Mars/Venus/other interplanetary transit: heliocentric Hohmann TOF
 *     via PROG_HELIO_R/PROG_MU_SUN, UNLESS the active program has a selected
 *     Lambert launch-window (PROG_ACTIVE_PROGRAM.launchWindow.tof_days), which
 *     is authoritative when present (porkchop solutions are non-Hohmann).
 *   - Anything else (surface-to-surface, unmodeled pairs): 0 (unknown/instant).
 */
function progTransferTOF(fromNode, toNode) {
  const oa = fromNode && fromNode.orbit, ob = toNode && toNode.orbit;
  if (!oa || !ob) return 0;

  // Transit-corridor convention: the coast is charged ONCE, on the leg that
  // EXITS the corridor (TLC→LLO, mars-transit→MCO). The leg that ENTERS a
  // corridor (LEO→TLC) is just the injection burn — impulsive, 0 s — otherwise
  // a two-leg route (LEO→TLC→LLO) double-counts the ~5-day translunar coast.
  if (ob.type === 'transit') return 0;

  // Same body: Hohmann half-ellipse between average altitudes (keeps the model
  // simple for elliptical endpoints — see MATH.md critique on TOF fidelity).
  if (oa.body === ob.body && (ob.type === 'circular' || ob.type === 'elliptic' || ob.type === 'surface')
      && (oa.type === 'circular' || oa.type === 'elliptic' || oa.type === 'surface')) {
    const altA = oa.type === 'surface' ? 0 : ((oa.perigee ?? oa.apogee ?? 0) + (oa.apogee ?? oa.perigee ?? 0)) / 2;
    const altB = ob.type === 'surface' ? 0 : ((ob.perigee ?? ob.apogee ?? 0) + (ob.apogee ?? ob.perigee ?? 0)) / 2;
    if (Math.abs(altA - altB) < 1) return 0;   // degenerate: same orbit
    return progHohmannTOF(oa.body, altA, altB);
  }

  // Earth → lunar transit / LLO / lunar surface: translunar half-ellipse.
  const lunarDest = (ob.body === 'Moon') || (ob.type === 'transit' && ob.destination === 'Moon');
  if ((oa.body === 'Earth' || oa.type === 'transit') && lunarDest) {
    const altA = oa.type === 'surface' ? 0 : (oa.type === 'transit' ? 185 : ((oa.perigee ?? oa.apogee ?? 185)));
    return progHohmannTOF('Earth', altA, PROG_MOON_ORBIT_R - PROG_BODIES.Earth.R);
  }

  // Interplanetary transit (Mars/Venus/other heliocentric destinations).
  const dest = ob.destination || (ob.type === 'transit' ? ob.destination : null) ||
    (ob.body && PROG_HELIO_R[ob.body] ? ob.body : null);
  if (dest && PROG_HELIO_R[dest] && (oa.body === 'Earth' || oa.type === 'transit')) {
    // A selected Lambert launch window overrides the Hohmann estimate when present.
    const lw = (typeof PROG_ACTIVE_PROGRAM !== 'undefined' && PROG_ACTIVE_PROGRAM && PROG_ACTIVE_PROGRAM.launchWindow) || null;
    if (lw && lw.tof_days != null && (lw.destination === dest || !lw.destination)) return lw.tof_days * 86400;
    const r_E = PROG_HELIO_R.Earth, r_D = PROG_HELIO_R[dest];
    const a   = (r_E + r_D) / 2;
    return Math.PI * Math.sqrt((a * a * a) / PROG_MU_SUN);
  }

  // Unknown / surface-to-surface / unmodeled pair: instantaneous by convention.
  return 0;
}

// ── Boiloff ──────────────────────────────────────────────────────────────────

/** Propellant remaining after cryo boiloff, kg.
 *  rate_per_day: fractional loss rate (0.003 = 0.3 %/day for LH2 baseline).
 *  insulation_factor: 1.0 = baseline MLI, < 1.0 = better insulation. */
function progBoiloff(fill_kg, rate_per_day, delta_t_days, insulation_factor) {
  return fill_kg * Math.exp(-rate_per_day * (insulation_factor ?? 1) * delta_t_days);
}

// ── Built-in node table (18 nodes) ────────────────────────────────────────
// NodeMapState: { nodeId, label, body, apogee, perigee, inclination, surface, isCustom }
// Extra fields: zone, isTransfer — used by Phase 7/8 rendering.
// apogee/perigee are km altitude from body surface (same convention as OrbitalState).
// Transfer corridor nodes have apogee/perigee = null (heliocentric or injection trajectory).
// EML altitudes are approximate geocentric distances minus Earth radius.
// NRHO: highly elliptical (apogee ~68263 km, periapsis ~1500 km from Moon surface).
const PROG_BUILTIN_NODES = [
  // ── Earth zone ──────────────────────────────────────────────────────────
  { nodeId:'earth-surface', label:'Earth Surface', body:'Earth', apogee:0,       perigee:0,       inclination:0,  surface:true,  isCustom:false, zone:'earth',          isTransfer:false },
  { nodeId:'leo-185',       label:'LEO 185 km',    body:'Earth', apogee:185,     perigee:185,     inclination:0,  surface:false, isCustom:false, zone:'earth',          isTransfer:false },
  { nodeId:'leo-400',       label:'LEO 400 km',    body:'Earth', apogee:400,     perigee:400,     inclination:0,  surface:false, isCustom:false, zone:'earth',          isTransfer:false },
  { nodeId:'gto',           label:'GTO',           body:'Earth', apogee:35786,   perigee:185,     inclination:0,  surface:false, isCustom:false, zone:'earth',          isTransfer:false },
  { nodeId:'geo',           label:'GEO',           body:'Earth', apogee:35786,   perigee:35786,   inclination:0,  surface:false, isCustom:false, zone:'earth',          isTransfer:false },
  { nodeId:'eml1',          label:'EML-1',         body:'Earth', apogee:320000,  perigee:320000,  inclination:0,  surface:false, isCustom:false, zone:'earth',          isTransfer:false },
  { nodeId:'eml2',          label:'EML-2',         body:'Earth', apogee:437000,  perigee:437000,  inclination:0,  surface:false, isCustom:false, zone:'earth',          isTransfer:false },
  // ── Cis-lunar zone ──────────────────────────────────────────────────
  { nodeId:'tli-corridor',  label:'TLI Corridor',  body:'Earth', apogee:378000,  perigee:185,     inclination:0,  surface:false, isCustom:false, zone:'cislunar',       isTransfer:true  },
  { nodeId:'dro',           label:'DRO',           body:'Moon',  apogee:68263,   perigee:68263,   inclination:90, surface:false, isCustom:false, zone:'cislunar',       isTransfer:false },
  { nodeId:'nrho',          label:'NRHO',          body:'Moon',  apogee:68263,   perigee:1500,    inclination:90, surface:false, isCustom:false, zone:'cislunar',       isTransfer:false },
  { nodeId:'llo-100',       label:'LLO 100 km',    body:'Moon',  apogee:100,     perigee:100,     inclination:0,  surface:false, isCustom:false, zone:'cislunar',       isTransfer:false },
  { nodeId:'lunar-surface', label:'Lunar Surface', body:'Moon',  apogee:0,       perigee:0,       inclination:0,  surface:true,  isCustom:false, zone:'cislunar',       isTransfer:false },
  // ── Interplanetary zone ───────────────────────────────────────────
  { nodeId:'mars-transfer',  label:'Mars Transfer', body:'Earth', apogee:null,    perigee:null,    inclination:0,  surface:false, isCustom:false, zone:'interplanetary', isTransfer:true  },
  { nodeId:'mars-orbit-400', label:'MCO 400 km',    body:'Mars',  apogee:400,     perigee:400,     inclination:0,  surface:false, isCustom:false, zone:'interplanetary', isTransfer:false },
  { nodeId:'mars-surface',   label:'Mars Surface',  body:'Mars',  apogee:0,       perigee:0,       inclination:0,  surface:true,  isCustom:false, zone:'interplanetary', isTransfer:false },
  { nodeId:'venus-transfer', label:'Venus Transfer', body:'Earth', apogee:null,    perigee:null,    inclination:0,  surface:false, isCustom:false, zone:'interplanetary', isTransfer:true  },
  { nodeId:'venus-orbit',    label:'VCO 300 km',    body:'Venus', apogee:300,     perigee:300,     inclination:0,  surface:false, isCustom:false, zone:'interplanetary', isTransfer:false },
  { nodeId:'venus-surface',  label:'Venus Surface', body:'Venus', apogee:0,       perigee:0,       inclination:0,  surface:true,  isCustom:false, zone:'interplanetary', isTransfer:false },
];

function progGetNode(id) {
  return PROG_BUILTIN_NODES.find(n => n.nodeId === id) || null;
}


