
// ─── PROGRAM MODULE — Phase 1: Delta-V Engine ───────────────────────
// Pure JS, no UI. Band View and Node Map: Phases 7 and 8.

// ── Body constants ─────────────────────────────────────────────────────────
const PROG_BODIES = {
  Earth: { mu: 398600.4418, R: 6371.0  },   // km³/s², km
  Moon:  { mu:   4902.800,  R: 1737.4  },
  Mars:  { mu:  42828.375,  R: 3389.5  },
  Venus: { mu: 324858.592,  R: 6051.8  },
};
const PROG_MU_SUN       = 1.32712440018e11; // km³/s² — heliocentric
const PROG_HELIO_R      = {                  // km — mean orbital radii
  Earth: 149597870.7,
  Mars:  227939200,
  Venus: 108208930,
};
const PROG_MOON_ORBIT_R = 384400; // km — Moon orbital radius from Earth centre

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


