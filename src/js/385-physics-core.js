
// ─── PHYSICS CORE (P0) — 3D two-body machinery ───────────────────────────────
//
// Pure math, no DOM, no globals mutated. See PHYSICS_PLAN.md (P0) and
// MATH.md §"Numerical propagation foundations".
//
// Everything here is 3D-NATIVE: vectors are plain [x, y, z] arrays. Since R3
// the MISSION layer is 3D too (inclined parking orbits, out-of-plane burns).
// Units: km, km/s, seconds, radians. mu in km³/s².
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

// ── §20 OBLIQUITY seam: equator-frame <-> world(ecliptic)-frame elements ─────
// Authored launch/orbit inclinations remain EQUATOR-referenced by user-facing
// convention (28.5 means 28.5-from-equator); physElementsToState/
// physStateToElements above are WORLD (ecliptic) frame. These two functions
// are the ONE pair of transforms between the two, driven by physBodyPoleAt
// (360). Only (inc, lan/raan) are rotated — argp/nu are measured from the
// orbit's own ascending node, a direction intrinsic to the orbit plane, so
// they are frame-invariant under a pure re-basing of (i, raan) and are left
// untouched by design (see MATH.md §7al). See MISSION_MODEL_V2.md §20 / the
// audited call-site list in MATH.md §7al for where this must be applied.

/** Orthonormal basis of `body`'s EQUATOR frame, expressed in WORLD (ecliptic)
 *  coordinates: zEq = the body's pole; xEq = the ascending node of the
 *  equator on the ecliptic (ẑ_world × zEq, normalized — falls back to world
 *  +x when the pole is parallel to world z, i.e. an untilted body, which
 *  makes the whole seam an identity transform for such bodies); yEq
 *  completes the right-handed set. */
function physEqBasis(body) {
  const zEq = (typeof physBodyPoleAt === 'function') ? physBodyPoleAt(body) : [0, 0, 1];
  let xEq = physCross([0, 0, 1], zEq);
  const xMag = physMag(xEq);
  xEq = xMag > 1e-9 ? physScale(xEq, 1 / xMag) : [1, 0, 0];
  const yEq = physCross(zEq, xEq);
  return { xEq, yEq, zEq };
}
/** Orbit-normal unit vector from (inc, raan) using the SAME convention as
 *  565's RAAN-solve normal (n = [sin(raan)sin(i), -cos(raan)sin(i), cos(i)]),
 *  in whatever frame the caller's (inc, raan) are already expressed. */
function physNormalFromIncLan(inc_deg, lan_deg) {
  const i = inc_deg * Math.PI / 180, raan = lan_deg * Math.PI / 180;
  return [Math.sin(raan) * Math.sin(i), -Math.cos(raan) * Math.sin(i), Math.cos(i)];
}
/** Inverse of physNormalFromIncLan: recover (inc, raan) deg from a normal
 *  vector (need not be pre-normalized). */
function physIncLanFromNormal(h) {
  const hMag = physMag(h);
  if (!(hMag > 1e-12)) return { inc_deg: 0, lan_deg: 0 };
  const hz = h[2] / hMag;
  const i = Math.acos(Math.max(-1, Math.min(1, hz)));
  let raan = Math.atan2(h[0], -h[1]);
  if (raan < 0) raan += 2 * Math.PI;
  return { inc_deg: i * 180 / Math.PI, lan_deg: raan * 180 / Math.PI };
}
/** Rotate an orbit-normal (inc_deg, lan_deg) AUTHORED in `body`'s EQUATOR
 *  frame into the WORLD (ecliptic) frame physElementsToState propagates in.
 *  Pure. Identity for a body absent from PROG_BODY_POLES (untilted). */
function progEqToWorldElements(body, inc_deg, lan_deg) {
  const b = physEqBasis(body);
  const hEqComp = physNormalFromIncLan(inc_deg, lan_deg); // components IN the eq basis
  const hWorld = physAdd(physAdd(physScale(b.xEq, hEqComp[0]), physScale(b.yEq, hEqComp[1])), physScale(b.zEq, hEqComp[2]));
  return physIncLanFromNormal(hWorld);
}
/** Inverse of progEqToWorldElements: WORLD-frame (inc_deg, lan_deg) ->
 *  `body`'s EQUATOR frame. Round-trips progEqToWorldElements exactly (pure
 *  change of orthonormal basis) — pinned in the gate (§20). */
function progWorldToEqElements(body, inc_deg, lan_deg) {
  const b = physEqBasis(body);
  const hWorld = physNormalFromIncLan(inc_deg, lan_deg);
  const comp = [physDot(hWorld, b.xEq), physDot(hWorld, b.yEq), physDot(hWorld, b.zEq)];
  return physIncLanFromNormal(comp);
}

// ── C1: the one frame boundary (MISSION_MODEL_V2.md §24, UNIFICATION_AUDIT
// item 1) ────────────────────────────────────────────────────────────────
// Every orbit-shaped object in the program now carries (or implicitly
// defaults) an explicit `frame` tag: 'eq' (equator-authored — the program's
// long-standing authoring convention, and the default when the field is
// absent so no legacy data needs migration) or 'world' (already
// ecliptic/world-frame, e.g. a propagated/state-derived ring). Every call
// site that used to inline "progEqToWorldElements + a `typeof` guard" now
// routes through orbitWorldElements/orbitWorldState instead — ONE boundary,
// so the seam can never again be silently skipped at a new call site (the
// bug class behind five shipped fixes in one week, §24 C1). Direct calls to
// progEqToWorldElements outside this module are a gate violation (see the
// grep-assert test in tests/math.test.js) — 415-launch-planner.js's
// progWorldToEqElements use is the one intentional exception: it is the
// INVERSE direction (a computed world-frame plane reported back out in the
// user-facing equator-authoring convention), not an authoring boundary, so
// it stays direct.
/** Read `o`'s inclination/LAN across every authoring dialect in use today
 *  (C2 will collapse these to one canonical name — this function is
 *  deliberately dialect-tolerant so it can front ALL of them without
 *  forcing a rename first): inc_deg | inclination | inc for inclination;
 *  lan_deg | lan for LAN/RAAN. A null/absent LAN defaults to 0, matching
 *  every existing call site's own fallback. Returns {incDeg, lanDeg} in
 *  WORLD (ecliptic) frame: identity when `o.frame === 'world'`, rotated via
 *  progEqToWorldElements(o.body||'Earth', ...) otherwise (frame absent or
 *  'eq' — today's default authoring convention). */
function orbitWorldElements(o) {
  o = o || {};
  // C2: the canonical shape is the boundary's native input — normalize first
  // (one dialect reader, 384) so post-C2 consumers can pass anything. The
  // inline multi-dialect read below stays as the fallback for the one case
  // orbitNormalize returns null on (a non-Keplerian propagated/surface orbit
  // — which has no inc/lan element form anyway, so the fallback yields the
  // same 0/0 it always did), and for headless load orders where 384 is absent.
  const _c = (typeof orbitNormalize === 'function') ? orbitNormalize(o) : null;
  const src = _c || o;
  const incDeg = (src.incDeg != null ? src.incDeg : (src.inc_deg != null ? src.inc_deg : (src.inclination != null ? src.inclination : (src.inc != null ? src.inc : 0)))) || 0;
  const lanDeg = (src.lanDeg != null ? src.lanDeg : (src.lan_deg != null ? src.lan_deg : (src.lan != null ? src.lan : 0))) || 0;
  if (src.frame === 'world') return { incDeg, lanDeg };
  const body = src.body || 'Earth';
  if (typeof progEqToWorldElements !== 'function') return { incDeg, lanDeg };
  const w = progEqToWorldElements(body, incDeg, lanDeg);
  return w ? { incDeg: w.inc_deg, lanDeg: w.lan_deg } : { incDeg, lanDeg };
}
/** orbitWorldElements + physAimBurnState reconstruction, for consumers that
 *  need r/v rather than bare elements — mirrors _trajGizmoOrbitNodeAt's
 *  (5745) exact reconstruction (mean-motion phase from rMean, theta as the
 *  in-plane anomaly, zero pitch/dv/yaw) so behavior is identical to the
 *  pre-boundary call sites it replaces. `thetaRad` is the in-plane anomaly
 *  (radians); `metOrOpts` is currently unused (reserved so future callers
 *  that only have a MET, not a pre-computed theta, have a slot without a
 *  signature break). Returns whatever physAimBurnState returns, or null if
 *  physAimBurnState isn't loaded or `o`/`o.body` is missing. */
function orbitWorldState(o, thetaRad, metOrOpts) {
  if (!o || !o.body || typeof physAimBurnState !== 'function') return null;
  const bodyMeta = (typeof PROG_BODIES !== 'undefined') ? PROG_BODIES[o.body] : null;
  const w = orbitWorldElements(o);
  // C2: mean radius via the canonical helper (handles every dialect incl. the
  // canonical periKm/apoKm shape); fall back to the inline perigee/apogee read
  // if 384 isn't loaded (headless) or the orbit is non-Keplerian.
  let rMean = (typeof orbitMeanRadiusKm === 'function') ? orbitMeanRadiusKm(o, bodyMeta ? bodyMeta.R : 0) : null;
  if (rMean == null) {
    const peri = o.perigee != null ? o.perigee : o.apogee, apo = o.apogee != null ? o.apogee : o.perigee;
    rMean = (bodyMeta ? bodyMeta.R : 0) + ((peri || 0) + (apo || 0)) / 2;
  }
  return physAimBurnState(o.body, rMean, thetaRad || 0, 0, 0,
    (w.incDeg * Math.PI) / 180, 0, (w.lanDeg * Math.PI) / 180);
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
/** Heliocentric state {r:[3], v:[3]} of a body at time t_s — REAL ephemeris
 *  rails (R1): full 3D element-evaluated position AND analytic velocity via
 *  progBodyEphemState (360), the ONE body-position source shared with the
 *  renderer/porkchop. The `overrides` param survives for signature
 *  compatibility only — the planet-phase calibration it once threaded
 *  retired with the real ephemeris; it is IGNORED. */
function physBodyStateAt(body, t_s, overrides) {
  return progBodyEphemState(body, t_s);
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

// ── J2 secular rates (R4) ─────────────────────────────────────────────────────
/** Dimensionless J2 (oblateness) coefficient per body. Bodies absent from this
 *  map have no J2 model — callers must treat that as "no data", not zero.
 *  Provenance: standard published low-precision values (Earth/Moon/Mars/Venus
 *  IAU/JPL fact-sheet order-of-magnitude figures), NOT re-derived here — see
 *  MATH.md §7l critique on provenance/precision. */
const PROG_BODY_J2 = {
  Earth: 1.08263e-3,
  Mars:  1.9555e-3,
  Moon:  2.033e-4,
  Venus: 4.458e-6,
};

/** Mean motion n (rad/s) for semi-major axis aKm (km) about body with GM mu
 *  (km^3/s^2). Internal helper shared by the two secular-rate functions. */
function _physJ2MeanMotion(aKm, mu) {
  return Math.sqrt(mu / (aKm * aKm * aKm));
}

/** J2 nodal regression rate dΩ/dt (rad/s) for an orbit {aKm, e, iRad} about
 *  `body`. Standard secular first-order result:
 *    dΩ/dt = -(3/2) J2 n (R/p)^2 cos(i),   p = a(1-e^2), n = sqrt(mu/a^3).
 *  Returns null if `body` has no J2 entry or inputs are degenerate (a<=0,
 *  e outside [0,1), or p<=0). */
function physJ2NodalRate(aKm, e, iRad, body) {
  const j2 = PROG_BODY_J2[body];
  const info = PROG_BODIES[body];
  if (j2 == null || !info) return null;
  if (!(aKm > 0) || !(e >= 0) || e >= 1) return null;
  const p = aKm * (1 - e * e);
  if (!(p > 0)) return null;
  const n = _physJ2MeanMotion(aKm, info.mu);
  const ratio = info.R / p;
  return -1.5 * j2 * n * ratio * ratio * Math.cos(iRad);
}

/** J2 apsidal precession rate dω/dt (rad/s) for an orbit {aKm, e, iRad} about
 *  `body`. Standard secular first-order result:
 *    dω/dt = (3/4) J2 n (R/p)^2 (5 cos^2(i) - 1).
 *  Returns null under the same degeneracy conditions as physJ2NodalRate. */
function physJ2ApsidalRate(aKm, e, iRad, body) {
  const j2 = PROG_BODY_J2[body];
  const info = PROG_BODIES[body];
  if (j2 == null || !info) return null;
  if (!(aKm > 0) || !(e >= 0) || e >= 1) return null;
  const p = aKm * (1 - e * e);
  if (!(p > 0)) return null;
  const n = _physJ2MeanMotion(aKm, info.mu);
  const ratio = info.R / p;
  const ci = Math.cos(iRad);
  return 0.75 * j2 * n * ratio * ratio * (5 * ci * ci - 1);
}

/** Sun-synchronous check: nodal rate converted to deg/day compared against
 *  Earth's mean heliocentric drift rate (360/365.2422 = 0.98565 deg/day).
 *  Only meaningful for Earth (other bodies always return sunSync:false).
 *  Returns {rateDegPerDay, sunSync} or null if no J2 data. */
function physJ2SunSyncCheck(aKm, e, iRad, body) {
  const rate = physJ2NodalRate(aKm, e, iRad, body);
  if (rate == null) return null;
  const rateDegPerDay = rate * (180 / Math.PI) * 86400;
  const sunSync = (body === 'Earth') && Math.abs(rateDegPerDay - 0.98565) < 0.02;
  return { rateDegPerDay, sunSync };
}
