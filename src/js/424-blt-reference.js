// src/js/424-blt-reference.js
// MISSION_MODEL_V2 §21 B2 — Markellos f16/f'16 reference family (pinned table).
//
// PROVENANCE: generated offline by the Sun-(Earth+Moon) planar CRTBP scratch
// dynamics in tests/corrector_harness.js (NOT the app's ephemeris integrator —
// per RESEARCH_CISLUNAR.md's own recommendation, "a CRTBP scratch mode exists
// only inside the corrector harness — keep it there"). Re-runnable:
//   node tests/corrector_harness.js f16
// Re-run and re-pin (with a dated comment) if the generation method changes.
// See docs/MATH.md §7ai for the full derivation (family continuation in the
// Jacobi constant, perpendicular-crossing correction to |vx| < 1e-11 nondim),
// the scaling chain, and the verification against Griesemer/Ocampo/Cooley
// (NTRS 20090016184) Table 1: our f16 rp=7,200 km member gives perigee 2 =
// 231,007 km vs the paper's 230,434 km (0.25%) and perigee 3 = 132,854 km vs
// 132,580 km (0.21%); Jacobi C = 3.0008551 vs the paper's 3.000850893 (4e-6).
//
// Orbit structure (the paper's Fig. 1/2): 5 perigees per period — p1 = the
// LEO-class nearest perigee (the family parameter, on the x-axis, perpendicular
// crossing), p2/p3 raised by the solar perturbation (~28-35x), p4/p5 mirror
// p3/p2 by the orbit's x-axis symmetry. The half-period point is the FAR
// perpendicular x-axis crossing (~1.51M km, the WSB region).
//
// Each entry:
//   rp_km        — perigee 1 = the target parking perigee (family parameter).
//   x0_nd/vy0_nd — perpendicular-crossing IC, CRTBP nondim rotating frame
//                  (secondary at x = 1-mu; f16 starts on the ANTI-Sun side,
//                  x0 > 1-mu, vy0 > 0; f'16 on the Sun side, x0 < 1-mu,
//                  vy0 < 0 — labels assigned so f16 reproduces the paper's
//                  Table 1, see MATH.md §7ai critique 107).
//   jacobiC      — Jacobi constant of the converged IC.
//   perigee2_km/perigee3_km + t_p2_days/t_p3_days — the raised perigees and
//                  their times from p1 (paper: capture targeted at p2 gives
//                  the ~100 d transfer class, at p3 the ~180 d class).
//   period_days  — full period (2x the 5th-crossing time).
//   far_km       — the half-period far perpendicular crossing radius.
//
// Convergence: every member fully converged, |vx at 5th crossing| <= 2.2e-11
// nondim (<= 7e-7 m/s dimensional) — real periodic orbits, not approximations.

'use strict';

const BLT_F16_SCALE = {
  mu: 3.040364489e-6,      // Sun-(Earth+Moon) CRTBP mass ratio (Griesemer Eq. 1)
  DU_KM: 149598023,        // Sun-EM barycenter distance (~1.0000002 AU)
  YEAR_D: 365.256898,      // sidereal year (defines the nondim time unit)
};
// TU (seconds) is derived, not pinned literally, so a future constant tweak
// can't silently desync it from YEAR_D:
BLT_F16_SCALE.TU_S = BLT_F16_SCALE.YEAR_D * 86400 / (2 * Math.PI);
BLT_F16_SCALE.VU_KMS = BLT_F16_SCALE.DU_KM / BLT_F16_SCALE.TU_S;

// nondim distance <-> km (identity round-trip, gate-checked)
function bltNdToKm(x) { return x * BLT_F16_SCALE.DU_KM; }
function bltKmToNd(x) { return x / BLT_F16_SCALE.DU_KM; }

// f16 — anti-Sun-side start (x0 > 1-mu), far loop on the anti-Sun side.
// Reproduces Griesemer Table 1 at rp=7200 (perigee 2: 231,007 vs 230,434 km).
const BLT_F16_FAMILY = [
  { rp_km: 6563, x0_nd: 1.00004083054, vy0_nd: 0.371136058168, jacobiC: 3.0008539748, perigee1_km: 6563, perigee2_km: 226523, perigee3_km: 128752, t_p2_days: 77.6, t_p3_days: 129.7, period_days: 375.57, far_km: 1508000 },
  { rp_km: 6700, x0_nd: 1.00004174632, vy0_nd: 0.367297634568, jacobiC: 3.0008542331, perigee1_km: 6700, perigee2_km: 227499, perigee3_km: 129644, t_p2_days: 77.6, t_p3_days: 129.7, period_days: 375.95, far_km: 1508000 },
  { rp_km: 6900, x0_nd: 1.00004308324, vy0_nd: 0.361900254336, jacobiC: 3.0008546033, perigee1_km: 6900, perigee2_km: 228915, perigee3_km: 130935, t_p2_days: 77.7, t_p3_days: 129.8, period_days: 376.50, far_km: 1508000 },
  { rp_km: 7000, x0_nd: 1.00004375170, vy0_nd: 0.359288529851, jacobiC: 3.0008547854, perigee1_km: 7000, perigee2_km: 229615, perigee3_km: 131576, t_p2_days: 77.8, t_p3_days: 129.9, period_days: 376.77, far_km: 1509000 },
  { rp_km: 7200, x0_nd: 1.00004508861, vy0_nd: 0.354228891611, jacobiC: 3.0008551440, perigee1_km: 7200, perigee2_km: 231007, perigee3_km: 132854, t_p2_days: 77.9, t_p3_days: 130.0, period_days: 377.32, far_km: 1509000 },
  { rp_km: 7400, x0_nd: 1.00004642553, vy0_nd: 0.349375297322, jacobiC: 3.0008554951, perigee1_km: 7400, perigee2_km: 232388, perigee3_km: 134125, t_p2_days: 78.0, t_p3_days: 130.1, period_days: 377.86, far_km: 1510000 },
  { rp_km: 7500, x0_nd: 1.00004709399, vy0_nd: 0.347021454097, jacobiC: 3.0008556680, perigee1_km: 7500, perigee2_km: 233074, perigee3_km: 134759, t_p2_days: 78.0, t_p3_days: 130.2, period_days: 378.13, far_km: 1510000 },
];

// f'16 — Sun-side start (x0 < 1-mu), far loop on the Sun side. The near-mirror
// counterpart (the Sun's finite distance breaks exact symmetry: perigee 2 is
// ~7% lower than f16's — a real physical asymmetry, verified by independent
// continuation, not an artifact; see MATH.md §7ai).
const BLT_FPRIME16_FAMILY = [
  { rp_km: 6563, x0_nd: 0.999953088735, vy0_nd: -0.371137665627, jacobiC: 3.0008527816, perigee1_km: 6563, perigee2_km: 210097, perigee3_km: 125403, t_p2_days: 76.4, t_p3_days: 127.9, period_days: 371.76, far_km: 1505000 },
  { rp_km: 6700, x0_nd: 0.999952172947, vy0_nd: -0.367299251187, jacobiC: 3.0008530455, perigee1_km: 6700, perigee2_km: 210996, perigee3_km: 126238, t_p2_days: 76.5, t_p3_days: 128.0, period_days: 372.10, far_km: 1505000 },
  { rp_km: 6900, x0_nd: 0.999950836031, vy0_nd: -0.361901883744, jacobiC: 3.0008534239, perigee1_km: 6900, perigee2_km: 212299, perigee3_km: 127449, t_p2_days: 76.6, t_p3_days: 128.1, period_days: 372.59, far_km: 1506000 },
  { rp_km: 7000, x0_nd: 0.999950167573, vy0_nd: -0.359290165395, jacobiC: 3.0008536102, perigee1_km: 7000, perigee2_km: 212944, perigee3_km: 128050, t_p2_days: 76.6, t_p3_days: 128.1, period_days: 372.83, far_km: 1506000 },
  { rp_km: 7200, x0_nd: 0.999948830657, vy0_nd: -0.354230538933, jacobiC: 3.0008539769, perigee1_km: 7200, perigee2_km: 214222, perigee3_km: 129248, t_p2_days: 76.7, t_p3_days: 128.2, period_days: 373.32, far_km: 1506000 },
  { rp_km: 7400, x0_nd: 0.999947493741, vy0_nd: -0.349376955770, jacobiC: 3.0008543363, perigee1_km: 7400, perigee2_km: 215491, perigee3_km: 130435, t_p2_days: 76.8, t_p3_days: 128.3, period_days: 373.80, far_km: 1507000 },
  { rp_km: 7500, x0_nd: 0.999946825283, vy0_nd: -0.347023117868, jacobiC: 3.0008545132, perigee1_km: 7500, perigee2_km: 216121, perigee3_km: 131026, t_p2_days: 76.8, t_p3_days: 128.4, period_days: 374.05, far_km: 1507000 },
];

// Family-selection rule (B3 consumer contract, MATH.md §7ai): at the mission
// epoch, resolve the Moon's Sun-relative quadrant (angle between the
// Earth->Moon vector and the Earth->Sun vector) — Sun-near quadrants select
// f16, Sun-far quadrants select f'16 (RESEARCH_CISLUNAR.md, [V] claim).
function bltF16SelectFamily(sunEarthMoonAngleDeg) {
  const a = ((sunEarthMoonAngleDeg % 360) + 360) % 360;
  const sunNear = a > 270 || a < 90; // within 90 deg of the Sun direction
  return sunNear ? BLT_F16_FAMILY : BLT_FPRIME16_FAMILY;
}
