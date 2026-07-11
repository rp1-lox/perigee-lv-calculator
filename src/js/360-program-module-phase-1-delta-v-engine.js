
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

// ── Body kinematics (R1 — real ephemeris rails, 2026-07-09) ─────────────────
// Replaces the C1a circular-coplanar model (PROG_BODY_KINEMATICS + theta0
// calibration) with REAL Keplerian mean elements + secular rates, evaluated
// at real absolute time. The planet-phase calibration fiction (MATH.md old
// §7a) retires with it: real ephemeris = real phases. See MATH.md §7a (R1).
//
// Planets: JPL approximate mean elements (Standish, valid 1800–2050).
//   Columns: a (AU), e, I (deg), L (mean longitude, deg), wbar (longitude of
//   perihelion, deg), Om (ascending node, deg) + rates per Julian CENTURY
//   from J2000 (JD 2451545.0). Frame: ecliptic-J2000, +x = vernal equinox.
// Moon: simplified mean elements about Earth (mean-element-only — no
//   evection/variation/solar perturbation terms), rates per DAY.
// Titan: circular schematic in Saturn's orbital plane (documented critique).

const PROG_J2000_JD = 2451545.0;          // J2000.0 epoch, Julian date
const PROG_DEFAULT_EPOCH_JD = 2461230.5;  // 2026-07-09 00:00 UTC — default "missions start today"
const PROG_AU_KM = 1.495978707e8;

/** Program epoch (Julian date of MET 0). Reads PROG_ACTIVE_PROGRAM.epochJD
 *  (persisted with the program object); default applied when absent. */
function progEpochJD() {
  const p = (typeof PROG_ACTIVE_PROGRAM !== 'undefined') ? PROG_ACTIVE_PROGRAM : null;
  return (p && isFinite(p.epochJD)) ? p.epochJD : PROG_DEFAULT_EPOCH_JD;
}

// { a0 (AU), aDot (AU/cty), e0, eDot, I0 (deg), IDot, L0, LDot, wbar0, wbarDot, Om0, OmDot }
const PROG_BODY_ELEMENTS = {
  Mercury: { a0: 0.38709927, aDot:  0.00000037, e0: 0.20563593, eDot:  0.00001906, I0: 7.00497902,  IDot: -0.00594749, L0: 252.25032350,  LDot: 149472.67411175, wbar0: 77.45779628,  wbarDot: 0.16047689,  Om0: 48.33076593,  OmDot: -0.12534081 },
  Venus:   { a0: 0.72333566, aDot:  0.00000390, e0: 0.00677672, eDot: -0.00004107, I0: 3.39467605,  IDot: -0.00078890, L0: 181.97909950,  LDot: 58517.81538729,  wbar0: 131.60246718, wbarDot: 0.00268329,  Om0: 76.67984255,  OmDot: -0.27769418 },
  Earth:   { a0: 1.00000261, aDot:  0.00000562, e0: 0.01671123, eDot: -0.00004392, I0: -0.00001531, IDot: -0.01294668, L0: 100.46457166,  LDot: 35999.37244981,  wbar0: 102.93768193, wbarDot: 0.32327364,  Om0: 0.0,          OmDot: 0.0 },
  Mars:    { a0: 1.52371034, aDot:  0.00001847, e0: 0.09339410, eDot:  0.00007882, I0: 1.84969142,  IDot: -0.00813131, L0: -4.55343205,   LDot: 19140.30268499,  wbar0: -23.94362959, wbarDot: 0.44441088,  Om0: 49.55953891,  OmDot: -0.29257343 },
  Jupiter: { a0: 5.20288700, aDot: -0.00011607, e0: 0.04838624, eDot: -0.00013253, I0: 1.30439695,  IDot: -0.00183714, L0: 34.39644051,   LDot: 3034.74612775,   wbar0: 14.72847983,  wbarDot: 0.21252668,  Om0: 100.47390909, OmDot: 0.20469106 },
  Saturn:  { a0: 9.53667594, aDot: -0.00125060, e0: 0.05386179, eDot: -0.00050991, I0: 2.48599187,  IDot: 0.00193609,  L0: 49.95424423,   LDot: 1222.49362201,   wbar0: 92.59887831,  wbarDot: -0.41897216, Om0: 113.66242448, OmDot: -0.28867794 },
  Uranus:  { a0: 19.18916464,aDot: -0.00196176, e0: 0.04725744, eDot: -0.00004397, I0: 0.77263783,  IDot: -0.00242939, L0: 313.23810451,  LDot: 428.48202785,    wbar0: 170.95427630, wbarDot: 0.40805281,  Om0: 74.01692503,  OmDot: 0.04240589 },
  Neptune: { a0: 30.06992276,aDot:  0.00026291, e0: 0.00859048, eDot:  0.00005105, I0: 1.77004347,  IDot: 0.00035372,  L0: -55.12002969,  LDot: 218.45945325,    wbar0: 44.96476227,  wbarDot: -0.32241464, Om0: 131.78422574, OmDot: -0.00508664 },
};

// Moons: elements about the parent. a in km; angles deg AT J2000; rates per DAY.
// Moon: standard mean elements (i = 5.145° to the ecliptic; e = 0.0549).
// Titan: schematic — circular at 1,221,870 km IN SATURN'S ORBITAL PLANE
// (I/Om copied from Saturn's J2000 elements; the real Titan orbits near
// Saturn's EQUATOR, tilted ~26.7° from its orbital plane — known wrong,
// accepted and critiqued in MATH.md).
const PROG_MOON_ELEMENTS = {
  Moon:  { parent: 'Earth',  a: 384400,  e: 0.0549, I0: 5.145,      L0: 218.316, LDot: 13.176358,          wbar0: 83.353, wbarDot: 0.111403, Om0: 125.080,       OmDot: -0.052954 },
  Titan: { parent: 'Saturn', a: 1221870, e: 0,      I0: 2.48599187, L0: 0,       LDot: 360 / 15.9454,      wbar0: 0,      wbarDot: 0,        Om0: 113.66242448,  OmDot: 0 },
};

/** Solve Kepler's equation M = E − e·sinE (Newton, tol 1e-8). Angles rad. */
function progKeplerSolveE(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 20; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-8) break;
  }
  return E;
}

/**
 * Evaluate one body's osculating mean elements into a 3D state {r:[3], v:[3]}
 * (km, km/s) relative to its primary. Angles rad; nDot/OmDot/argpDot rad/s.
 * VELOCITY IS ANALYTIC (no finite differencing): perifocal Ė-form using the
 * TABLE's mean-motion rate (dM/dt = L̇ − ϖ̇, which for the Moon differs ~0.5%
 * from √(μ/a³) because the real lunar rate is solar-perturbed), plus the
 * secular frame-rotation terms Ω̇·(ẑ×r) + ω̇·(ĥ×r).
 */
function _progElementsEval(a, e, i, raan, argp, M, nDot, OmDot, argpDot) {
  // normalize M to [-π, π] for the Newton solve
  M = M % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;
  const E = progKeplerSolveE(M, e);
  const cE = Math.cos(E), sE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);
  const xpf = a * (cE - e), ypf = b * sE;             // perifocal position
  const Edot = nDot / (1 - e * cE);
  const vxpf = -a * sE * Edot, vypf = b * cE * Edot;  // perifocal velocity
  // perifocal -> inertial: R3(−Ω) R1(−i) R3(−ω)
  const cO = Math.cos(raan), sO = Math.sin(raan);
  const ci = Math.cos(i), si = Math.sin(i);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const R = [
    [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci,  sO * si],
    [sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si],
    [sw * si,                 cw * si,                  ci     ],
  ];
  const rot = v => [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
  ];
  const r = rot([xpf, ypf, 0]);
  let v = rot([vxpf, vypf, 0]);
  // secular frame rotation: node regression about +z, apsidal precession about ĥ
  if (OmDot) v = [v[0] - OmDot * r[1], v[1] + OmDot * r[0], v[2]];
  if (argpDot) {
    const h = rot([0, 0, 1]); // orbit-normal unit vector
    v = [v[0] + argpDot * (h[1] * r[2] - h[2] * r[1]),
         v[1] + argpDot * (h[2] * r[0] - h[0] * r[2]),
         v[2] + argpDot * (h[0] * r[1] - h[1] * r[0])];
  }
  return { r, v };
}

const _PROG_D2R = Math.PI / 180;
const _PROG_CTY_S = 36525 * 86400; // Julian century in seconds

/** LOCAL element-evaluated state of a body relative to its PRIMARY at mission
 *  time t_s (seconds past the program epoch). Planets: heliocentric.
 *  Moons: parent-centric. Sun: zeros. 3D ecliptic-J2000 km / km/s. Pure. */
function progBodyLocalEphemState(body, t_s) {
  const t = t_s || 0;
  const el = PROG_BODY_ELEMENTS[body];
  if (el) {
    const T = (progEpochJD() - PROG_J2000_JD + t / 86400) / 36525; // Julian centuries from J2000
    const a = (el.a0 + el.aDot * T) * PROG_AU_KM;
    const e = el.e0 + el.eDot * T;
    const i = (el.I0 + el.IDot * T) * _PROG_D2R;
    const L = (el.L0 + el.LDot * T) * _PROG_D2R;
    const wbar = (el.wbar0 + el.wbarDot * T) * _PROG_D2R;
    const Om = (el.Om0 + el.OmDot * T) * _PROG_D2R;
    const nDot = (el.LDot - el.wbarDot) * _PROG_D2R / _PROG_CTY_S;
    const OmDot = el.OmDot * _PROG_D2R / _PROG_CTY_S;
    const argpDot = (el.wbarDot - el.OmDot) * _PROG_D2R / _PROG_CTY_S;
    return _progElementsEval(a, e, i, Om, wbar - Om, L - wbar, nDot, OmDot, argpDot);
  }
  const mel = PROG_MOON_ELEMENTS[body];
  if (mel) {
    const d = progEpochJD() - PROG_J2000_JD + t / 86400;           // days from J2000
    const L = (mel.L0 + mel.LDot * d) * _PROG_D2R;
    const wbar = (mel.wbar0 + mel.wbarDot * d) * _PROG_D2R;
    const Om = (mel.Om0 + mel.OmDot * d) * _PROG_D2R;
    const nDot = (mel.LDot - mel.wbarDot) * _PROG_D2R / 86400;
    const OmDot = mel.OmDot * _PROG_D2R / 86400;
    const argpDot = (mel.wbarDot - mel.OmDot) * _PROG_D2R / 86400;
    return _progElementsEval(mel.a, mel.e, mel.I0 * _PROG_D2R, Om, wbar - Om, L - wbar, nDot, OmDot, argpDot);
  }
  return { r: [0, 0, 0], v: [0, 0, 0] };
}

/** Osculating mean elements of a body at mission time t_s (R2): {a km, e,
 *  i rad, raan rad, argp rad} — the SHAPE of the orbit (no anomaly), for
 *  true-geometry ring sampling. null for the Sun / unknown bodies. Pure. */
function progBodyOrbitElementsAt(body, t_s) {
  const t = t_s || 0;
  const el = PROG_BODY_ELEMENTS[body];
  if (el) {
    const T = (progEpochJD() - PROG_J2000_JD + t / 86400) / 36525;
    const wbar = (el.wbar0 + el.wbarDot * T) * _PROG_D2R;
    const Om = (el.Om0 + el.OmDot * T) * _PROG_D2R;
    return { a: (el.a0 + el.aDot * T) * PROG_AU_KM, e: el.e0 + el.eDot * T,
             i: (el.I0 + el.IDot * T) * _PROG_D2R, raan: Om, argp: wbar - Om };
  }
  const mel = PROG_MOON_ELEMENTS[body];
  if (mel) {
    const d = progEpochJD() - PROG_J2000_JD + t / 86400;
    const wbar = (mel.wbar0 + mel.wbarDot * d) * _PROG_D2R;
    const Om = (mel.Om0 + mel.OmDot * d) * _PROG_D2R;
    return { a: mel.a, e: mel.e, i: mel.I0 * _PROG_D2R, raan: Om, argp: wbar - Om };
  }
  return null;
}

/** Sample a full orbit ellipse from elements into n 3D points (km, relative
 *  to the primary — heliocentric for planets, parent-centric for moons).
 *  Uniform eccentric anomaly (denser near periapsis where curvature lives).
 *  Closed: last point repeats the first. Pure geometry, no Kepler solve. */
function progOrbitSamplePoints(el, n) {
  const N = Math.max(8, n || 120);
  const { a, e, i, raan, argp } = el;
  const b = a * Math.sqrt(Math.max(0, 1 - e * e));
  const cO = Math.cos(raan), sO = Math.sin(raan);
  const ci = Math.cos(i), si = Math.sin(i);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const R = [
    [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci],
    [sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci],
    [sw * si,                 cw * si               ],
  ];
  const pts = [];
  for (let k = 0; k <= N; k++) {
    const E = 2 * Math.PI * k / N;
    const x = a * (Math.cos(E) - e), y = b * Math.sin(E);
    pts.push([R[0][0] * x + R[0][1] * y, R[1][0] * x + R[1][1] * y, R[2][0] * x + R[2][1] * y]);
  }
  return pts;
}

/** Single point on the same ellipse progOrbitSamplePoints walks, at ONE
 *  eccentric anomaly E (rad). Used by the mock-ascent renderer (574) to drop
 *  a schematic insertion marker without sampling the whole ring. Pure. */
function progOrbitPointAtE(el, E) {
  const { a, e, i, raan, argp } = el;
  const b = a * Math.sqrt(Math.max(0, 1 - e * e));
  const cO = Math.cos(raan), sO = Math.sin(raan);
  const ci = Math.cos(i), si = Math.sin(i);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const R = [
    [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci],
    [sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci],
    [sw * si,                 cw * si               ],
  ];
  const x = a * (Math.cos(E) - e), y = b * Math.sin(E);
  return [R[0][0] * x + R[0][1] * y, R[1][0] * x + R[1][1] * y, R[2][0] * x + R[2][1] * y];
}

// ─── R6.3: launch-time -> RAAN authoring (MATH.md §7k, resolves critique 49) ─
// Pure spherical-trig helpers. All angles in/out are DEGREES unless noted.
// Earth's sidereal rotation period, SECONDS — must match _trajBodySpinAngle's
// Earth constant (574) so the site-longitude math stays self-consistent with
// what's drawn on the rotating globe (that function's prime-meridian epoch
// offset is uncalibrated/display-flavor only — see MATH.md critique 55; the
// RAAN this produces is therefore self-consistent within the app, not tied to
// a real-world UTC launch-window clock).
const PROG_EARTH_SIDEREAL_S = 86164.1;

function _prog360(deg) { return ((deg % 360) + 360) % 360; }

/** Required launch azimuth (deg, measured from local north) to reach
 *  inclination incDeg from latitude latDeg, spherical-trig:
 *  sin(az) = cos(i) / cos(lat). Two solutions (NE ascending-node departure,
 *  SE descending-node departure) are both physically valid; returns both.
 *  {unreachable:true} when |cos(i)/cos(lat)| > 1 (inclination below the site's
 *  latitude — no azimuth reaches it without a plane-change dogleg). */
function progLaunchAzimuthDeg(latDeg, incDeg) {
  const latR = latDeg * Math.PI / 180, incR = incDeg * Math.PI / 180;
  const cosLat = Math.cos(latR);
  if (Math.abs(cosLat) < 1e-9) return { unreachable: true };
  const s = Math.cos(incR) / cosLat;
  if (s > 1 || s < -1) return { unreachable: true, raw: s };
  const azNE = Math.asin(s) * 180 / Math.PI;      // 0..90 (or 90..180 for retrograde), NE pair
  const azSE = 180 - azNE;                        // SE / descending-node pair
  return { azNE, azSE, unreachable: false };
}

/** RAAN (deg, 0-360) resulting from launching into inclination incDeg from a
 *  site at (siteLatDeg, siteLonDeg) at absolute time tLaunchSec, where
 *  spinFn(t) returns Earth's spin angle in RADIANS at t (pass
 *  _trajBodySpinAngle.bind(null,'Earth') from the caller — kept as an
 *  injected fn so this stays framework-free / unit-testable without loading
 *  574). Standard spherical-trig ascending-node relation:
 *    Ω = λ_inertial − asin(min(1, tan(lat)/tan(i)))     (direct, NE departure)
 *  where λ_inertial = site.lon + spin(t_launch) is the site's inertial
 *  (non-rotating-frame) longitude at that instant. Retrograde (i>90°)
 *  mirrors the offset (descending-node geometry). {unreachable:true} when
 *  |tan(lat)/tan(i)| > 1 — the requested inclination is below the site's
 *  reachable minimum (|lat|). Pure. */
function progLaunchRaanFor(siteLatDeg, siteLonDeg, incDeg, tLaunchSec, spinFn) {
  const latR = siteLatDeg * Math.PI / 180, incR = incDeg * Math.PI / 180;
  const spinRad = spinFn(tLaunchSec || 0);
  const lambdaInertial = _prog360(siteLonDeg + spinRad * 180 / Math.PI);
  const tanInc = Math.tan(incR);
  if (Math.abs(tanInc) < 1e-9) return { unreachable: true };
  const arg = Math.tan(latR) / tanInc;
  if (arg > 1 || arg < -1) return { unreachable: true, raw: arg };
  let dOmega = Math.asin(arg) * 180 / Math.PI;
  if (incDeg > 90) dOmega = 180 - dOmega; // retrograde mirror
  return { raan: _prog360(lambdaInertial - dOmega), lambdaInertial, unreachable: false };
}

/** Seconds until Earth's rotation brings the site under a TARGET RAAN plane,
 *  given the RAAN launching right now (t=0-ish reference) would produce.
 *  Δt = ((Ω_target − Ω_now) mod 360°) / ω_earth, wrapped forward into
 *  [0, siderealPeriod). Pure. */
function progLaunchNextWindowS(currentRaanDeg, targetRaanDeg, siderealPeriodS) {
  const period = siderealPeriodS || PROG_EARTH_SIDEREAL_S;
  const deltaDeg = _prog360(targetRaanDeg - currentRaanDeg);
  return (deltaDeg / 360) * period;
}

/** HELIOCENTRIC element-evaluated 3D state {r:[3], v:[3]} of any body at
 *  mission time t_s. Recursive for moons (parent state + local state). The
 *  ONE body-position source — physics, porkchop, and renderer all resolve
 *  through this (via physBodyStateAt / progBodyWorldPos). Pure. */
function progBodyEphemState(body, t_s) {
  if (body === 'Sun') return { r: [0, 0, 0], v: [0, 0, 0] };
  const local = progBodyLocalEphemState(body, t_s);
  const mel = PROG_MOON_ELEMENTS[body];
  if (mel) {
    const p = progBodyEphemState(mel.parent, t_s);
    return { r: [p.r[0] + local.r[0], p.r[1] + local.r[1], p.r[2] + local.r[2]],
             v: [p.v[0] + local.v[0], p.v[1] + local.v[1], p.v[2] + local.v[2]] };
  }
  return local;
}

/** Body phase angle (radians, [0, 2π)) at mission time t_s — the in-ecliptic
 *  atan2 of the REAL element-evaluated position (planets: heliocentric;
 *  moons: parent-relative). Kept for callers that need an angle (phasing,
 *  moon-lead arc rotation); the z component is projected away. */
function progBodyAngleAt(body, t_s) {
  const st = progBodyLocalEphemState(body, t_s);
  if (!st.r[0] && !st.r[1]) return 0;
  let theta = Math.atan2(st.r[1], st.r[0]);
  if (theta < 0) theta += 2 * Math.PI;
  return theta;
}

/** Heliocentric world position {x, y, z} km at mission time t_s — REAL
 *  element-evaluated position (z carried for 3D consumers; the current
 *  top-down renderer reads x/y only — ecliptic projection). Pure. */
function progBodyWorldPos(body, t_s) {
  const st = progBodyEphemState(body, t_s);
  return { x: st.r[0], y: st.r[1], z: st.r[2] };
}

/** R1 COMPATIBILITY ALIAS: the old per-mission planet-phase calibration
 *  (progCalibratedTheta0 + overrides threading) retired with the real
 *  ephemeris — real phases need no calibration. Every legacy call site keeps
 *  compiling; `overrides` is accepted and IGNORED. */
function progBodyWorldPosCalibrated(body, t_s, overrides) {
  return progBodyWorldPos(body, t_s);
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


