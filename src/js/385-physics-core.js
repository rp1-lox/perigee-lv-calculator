
// ─── PHYSICS CORE (P0) — 3D two-body machinery ───────────────────────────────
//
// Pure math, no DOM, no globals mutated. See PHYSICS_PLAN.md (P0) and
// MATH.md §"Numerical propagation foundations".
//
// Everything here is 3D-NATIVE: vectors are plain [x, y, z] arrays even while
// the rest of the program passes z = 0 (the world stays coplanar until the
// P5 camera). Units: km, km/s, seconds, radians. mu in km³/s².
//
// The Stumpff functions live here (moved verbatim from 410, which loads later
// and keeps using them by name) because both the Lambert solver (410) and the
// universal-variable propagator below are built on them.

// ── vec3 primitives ──────────────────────────────────────────────────────────
function physV3(x, y, z) { return [x || 0, y || 0, z || 0]; }
function physAdd(a, b)   { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function physSub(a, b)   { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function physScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function physDot(a, b)   { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function physCross(a, b) {
  return [a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]];
}
function physMag(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }

// ── Stumpff functions (moved from 410 — single copy, shared by Lambert + UV) ──
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

// ── scalars ──────────────────────────────────────────────────────────────────
/** Orbital period (s) for semi-major axis a (km) — elliptical only (a > 0). */
function physOrbitPeriod(a, mu) {
  if (!(a > 0)) return NaN;
  return 2 * Math.PI * Math.sqrt(a * a * a / mu);
}
/** Vis-viva speed (km/s) at radius r on an orbit of semi-major axis a. */
function physVisViva(r, a, mu) {
  return Math.sqrt(Math.max(0, mu * (2 / r - 1 / a)));
}

// ── elements <-> state ───────────────────────────────────────────────────────
// Element set: { a, e, i, raan, argp, nu } (km, -, rad, rad, rad, rad).
// a < 0 for hyperbolic. Angles follow the standard perifocal convention;
// the reference plane is the ecliptic (z = 0), reference direction +x.

/** Orbital elements -> inertial state {r:[3], v:[3]}. */
function physElementsToState(el, mu) {
  const { a, e } = el;
  const i = el.i || 0, raan = el.raan || 0, argp = el.argp || 0, nu = el.nu || 0;
  const p = a * (1 - e * e);                 // semi-latus rectum (valid for e>1 with a<0)
  const rMag = p / (1 + e * Math.cos(nu));
  // perifocal frame
  const rP = [rMag * Math.cos(nu), rMag * Math.sin(nu), 0];
  const vFac = Math.sqrt(mu / p);
  const vP = [-vFac * Math.sin(nu), vFac * (e + Math.cos(nu)), 0];
  // perifocal -> inertial: R3(-raan) · R1(-i) · R3(-argp)
  const cO = Math.cos(raan), sO = Math.sin(raan);
  const ci = Math.cos(i),    si = Math.sin(i);
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
  return { r: rot(rP), v: rot(vP) };
}

/** Inertial state -> elements + derived quantities.
 *  Degeneracies handled explicitly: near-circular (e≈0) pins argp=0 and
 *  measures nu from the node/x-axis; near-equatorial (i≈0) pins raan=0. */
function physStateToElements(r, v, mu) {
  const rMag = physMag(r), vMag = physMag(v);
  const h = physCross(r, v);                   // specific angular momentum
  const hMag = physMag(h);
  const energy = vMag * vMag / 2 - mu / rMag;  // km²/s²
  const a = Math.abs(energy) > 1e-12 ? -mu / (2 * energy) : Infinity; // parabolic guard
  // eccentricity vector
  const eVec = physSub(physScale(physCross(v, h), 1 / mu), physScale(r, 1 / rMag));
  const e = physMag(eVec);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hMag)));
  const n = physCross([0, 0, 1], h);           // node vector
  const nMag = physMag(n);
  const EPS = 1e-10;
  let raan = 0, argp = 0, nu;
  if (nMag > EPS) {
    raan = Math.atan2(n[1], n[0]);
    if (raan < 0) raan += 2 * Math.PI;
  }
  if (e > EPS) {
    if (nMag > EPS) {
      argp = Math.acos(Math.max(-1, Math.min(1, physDot(n, eVec) / (nMag * e))));
      if (eVec[2] < 0) argp = 2 * Math.PI - argp;
    } else {
      // equatorial: argp measured from +x (longitude of periapsis)
      argp = Math.atan2(eVec[1], eVec[0]);
      if (argp < 0) argp += 2 * Math.PI;
    }
    nu = Math.acos(Math.max(-1, Math.min(1, physDot(eVec, r) / (e * rMag))));
    if (physDot(r, v) < 0) nu = 2 * Math.PI - nu;
  } else {
    // circular: nu from node (or +x if equatorial), argp pinned 0
    const ref = nMag > EPS ? n : [1, 0, 0];
    nu = Math.acos(Math.max(-1, Math.min(1, physDot(ref, r) / (physMag(ref) * rMag))));
    // quadrant: prograde position "above" the ref in the orbit plane
    const cr = physCross(ref, r);
    if (physDot(cr, h) < 0) nu = 2 * Math.PI - nu;
  }
  const rp = a * (1 - e), ra = e < 1 ? a * (1 + e) : Infinity;
  return {
    a, e, i, raan, argp, nu,
    rp, ra, energy, hVec: h,
    period: (e < 1 && a > 0 && isFinite(a)) ? physOrbitPeriod(a, mu) : NaN,
  };
}

// ── universal-variable Kepler propagation ────────────────────────────────────
// One code path for ellipse / parabola / hyperbola. Curtis, "Orbital Mechanics
// for Engineering Students", Alg. 3.4 (chi iteration) + f/g functions.
/** Propagate a two-body state by dt seconds. Returns {r:[3], v:[3]} or null
 *  if the Newton iteration fails to converge (degenerate input). */
function physKeplerPropagate(r0, v0, dt, mu) {
  if (!dt) return { r: r0.slice(), v: v0.slice() };
  const r0Mag = physMag(r0);
  const vr0 = physDot(r0, v0) / r0Mag;          // radial velocity component
  const alpha = 2 / r0Mag - physDot(v0, v0) / mu; // 1/a (negative for hyperbolic)
  const sqMu = Math.sqrt(mu);
  // initial guess (Curtis eq. 3.66; good for all conic types)
  let chi = Math.abs(alpha) > 1e-12
    ? sqMu * Math.abs(alpha) * dt
    : sqMu * dt / r0Mag; // near-parabolic fallback seed
  let converged = false;
  for (let it = 0; it < 80; it++) {
    const z = alpha * chi * chi;
    const C = progStumpffC(z), S = progStumpffS(z);
    const F = (r0Mag * vr0 / sqMu) * chi * chi * C
            + (1 - alpha * r0Mag) * chi * chi * chi * S
            + r0Mag * chi - sqMu * dt;
    const dF = (r0Mag * vr0 / sqMu) * chi * (1 - alpha * chi * chi * S)
             + (1 - alpha * r0Mag) * chi * chi * C + r0Mag;
    const step = F / dF;
    chi -= step;
    if (Math.abs(step) < 1e-8 * Math.max(1, Math.abs(chi))) { converged = true; break; }
  }
  if (!converged) return null;
  const z = alpha * chi * chi;
  const C = progStumpffC(z), S = progStumpffS(z);
  const f = 1 - (chi * chi / r0Mag) * C;
  const g = dt - (chi * chi * chi / sqMu) * S;
  const r = physAdd(physScale(r0, f), physScale(v0, g));
  const rMag = physMag(r);
  const fdot = (sqMu / (rMag * r0Mag)) * (alpha * chi * chi * chi * S - chi);
  const gdot = 1 - (chi * chi / rMag) * C;
  return { r, v: physAdd(physScale(r0, fdot), physScale(v0, gdot)) };
}

// ── body rails state ─────────────────────────────────────────────────────────
/** Heliocentric state {r:[3], v:[3]} of a body at time t_s.
 *  POSITION resolves through progBodyWorldPosCalibrated — the ONE body-position
 *  source shared with the renderer/porkchop (calibration coherence invariant;
 *  see PHYSICS_PLAN.md). VELOCITY is the analytic circular-rail tangent,
 *  v = ω·r ⊥ radius, recursive for moons (parent velocity + local). z = 0. */
function physBodyStateAt(body, t_s, overrides) {
  if (body === 'Sun') return { r: [0, 0, 0], v: [0, 0, 0] };
  overrides = overrides || {};
  const t = t_s || 0;
  const k = PROG_BODY_KINEMATICS[body];
  const moonInfo = PROG_MOON_ORBITS && PROG_MOON_ORBITS[body];
  const radius = moonInfo ? moonInfo.r : PROG_HELIO_R[body];
  if (radius == null || !k) return { r: [0, 0, 0], v: [0, 0, 0] };
  const omega = 2 * Math.PI / k.period_s;
  // Same angle math as progBodyWorldPosCalibrated (moons never take offsets).
  const theta = progBodyAngleAt(body, t) + (moonInfo ? 0 : (overrides[body] || 0));
  const localR = [radius * Math.cos(theta), radius * Math.sin(theta), 0];
  const localV = [-radius * omega * Math.sin(theta), radius * omega * Math.cos(theta), 0];
  if (moonInfo) {
    const parent = physBodyStateAt(moonInfo.parent, t, overrides);
    return { r: physAdd(parent.r, localR), v: physAdd(parent.v, localV) };
  }
  return { r: localR, v: localV };
}

// ── escape hyperbola geometry (P3) ───────────────────────────────────────────
/** Pure planar geometry of an escape/capture hyperbola with periapsis radius
 *  rpKm and characteristic energy c3 (km²/s²) about a body of GM mu (km³/s²).
 *  Periapsis is placed on the local +x axis — the CALLER rotates the sampled
 *  points into its own frame. outboundSign (+1 default / -1) picks which side
 *  of the apse line the branch sweeps (mirror for capture spurs).
 *  Returns null unless c3 > 0 (a bound/parabolic "escape" has no hyperbolic
 *  asymptote to draw). {
 *    e, vInf,
 *    beta:   acos(1/e) — asymptote half-angle from the apse line,
 *    nuBurn: 0 (burn modeled at periapsis),
 *    p:      semi-latus rectum rp·(1+e),
 *    samplePoints(rSoiKm, n): [[x,y],...] km — n+1 conic points from periapsis
 *      (ν=0) out to the true anomaly where r = rSoiKm (radii monotonically
 *      increasing; ν sign = outboundSign),
 *  } */
function physEscapeGeometry(rpKm, c3, mu, outboundSign) {
  if (!(rpKm > 0) || !(mu > 0) || !(c3 > 0)) return null;
  const sign = outboundSign < 0 ? -1 : 1;
  const vInf = Math.sqrt(c3);
  const e = 1 + rpKm * c3 / mu;           // rp·vInf²/mu, vInf² = c3
  const beta = Math.acos(1 / e);          // asymptote half-angle
  const p = rpKm * (1 + e);
  return {
    e, vInf, beta, nuBurn: 0, p,
    samplePoints(rSoiKm, n) {
      const N = Math.max(2, n || 32);
      const rMax = Math.max(rSoiKm || rpKm, rpKm);
      // ν where r = rMax: cosν = (p/r − 1)/e (clamped — rMax below rp can't happen)
      const nuMax = Math.acos(Math.max(-1, Math.min(1, (p / rMax - 1) / e)));
      const pts = [];
      for (let k = 0; k <= N; k++) {
        const nu = sign * nuMax * k / N;
        const r = p / (1 + e * Math.cos(nu));
        pts.push([r * Math.cos(nu), r * Math.sin(nu)]);
      }
      return pts;
    },
  };
}
