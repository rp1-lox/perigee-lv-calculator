
// ─── PROGRAM MODULE — R7 phase 1: Launch-to-Destination Planner ─────────────
//
// Pure math, no UI, no DOM. Given a launch body (Earth), a destination, and
// an epoch, computes the IDEAL parking orbit (inclination, LAN, altitude)
// that sets up the lowest-delta-v departure toward that destination, plus
// the launch azimuth and the departure C3. See MATH.md §7p and
// PHYSICS_PLAN.md "### R7 phase 1" for the full derivation/critiques.
//
// All dependency calls below happen at RUNTIME inside function bodies (never
// at module-eval time), so this file's position in the concatenation order
// only needs to be AFTER the modules it calls — it loads after 410 (per
// filename sort) but does not actually need 410 at all; see the Lambert note
// below.
//
// ── Dependencies (grepped, exact APIs) ───────────────────────────────────────
//   - progBodyEphemState(body, t_s)                                   (360, line ~314)
//       Heliocentric element-evaluated 3D state { r:[x,y,z] km, v:[vx,vy,vz] km/s }
//       at t_s SECONDS PAST THE PROGRAM EPOCH (progEpochJD()). Sun -> zeros.
//       This is THE one position/velocity source the whole program resolves
//       through (physBodyStateAt/progBodyWorldPos are thin wrappers on it).
//   - progLaunchAzimuthDeg(latDeg, incDeg)                            (360, line ~264)
//       sin(az) = cos(i)/cos(lat). Returns {azNE, azSE, unreachable}.
//   - progLaunchRaanFor(siteLatDeg, siteLonDeg, incDeg, tLaunchSec, spinFn) (360, line ~287)
//       NOT called directly here — its signature takes a LAUNCH SITE/TIME
//       and derives the RAAN a launch reaches, whereas this module needs the
//       RAAN whose PLANE CONTAINS A GIVEN HYPERBOLIC-ASYMPTOTE DIRECTION —
//       a related but distinct spherical-trig problem. Per the task brief,
//       the SAME identity (Ω = λ − asin(tan(δ)/tan(i)), asin of a
//       tan-ratio) is mirrored below in progIdealParkingOrbit rather than
//       imported, because progLaunchRaanFor's λ input is a launch-site
//       inertial longitude, not the right ascension of a heliocentric
//       vector, and it isn't a drop-in substitution.
//   - PROG_AU_KM, PROG_MU_SUN, PROG_BODY_ELEMENTS                     (360)
//   - physV3/physAdd/physSub/physScale/physDot/physCross/physMag     (385)
//   - progStumpffC/progStumpffS                                      (385, moved
//       there from 410 specifically so both Lambert solvers can share them)
//
// ── Lambert solver note ──────────────────────────────────────────────────────
// 410's progLambert2D is explicitly 2-D (drops z — see its header comment and
// MATH.md critique 42) so it cannot supply a genuine 3-D v-infinity vector,
// which this module needs for the declination-of-launch-asymptote (DLA) math.
// progLambert3D below is the SAME universal-variable algorithm (Curtis,
// Orbital Mechanics for Engineering Students §5.3, bisection on psi — the
// exact algorithm 410 cites) ported to 3 dimensions: every step is dimension-
// generic (dot products, vector scale/add) EXCEPT the prograde/retrograde
// disambiguation, which — mirroring 410's existing convention exactly —
// uses the sign of the z-component of r1 x r2 as a stand-in for "which way
// is prograde," valid because every body in PROG_BODY_ELEMENTS has small
// ecliptic inclination (<7 deg, Mars 1.85 deg, Venus 3.39 deg — same
// approximation basis as critique 42).

/**
 * Solve Lambert's problem in 3-D heliocentric space (prograde = CCW as seen
 * from ecliptic +z, same convention as progLambert2D/410).
 * Returns { v1:[vx,vy,vz], v2:[vx,vy,vz] } km/s, or null if degenerate/diverged.
 * @param {[number,number,number]} r1v departure pos km
 * @param {[number,number,number]} r2v arrival pos km
 * @param {number} tof_s   time of flight, seconds
 * @param {number} mu      gravitational parameter km^3/s^2
 */
function progLambert3D(r1v, r2v, tof_s, mu) {
  const r1  = physMag(r1v);
  const r2  = physMag(r2v);
  const dot = physDot(r1v, r2v);
  const cz  = physCross(r1v, r2v)[2];   // z-component only: prograde/retrograde sign, see header note

  const dv_raw = Math.acos(Math.max(-1, Math.min(1, dot / (r1 * r2))));
  const dv     = cz >= 0 ? dv_raw : (2 * Math.PI - dv_raw);

  if (dv < 1e-4 || Math.abs(dv - Math.PI) < 1e-4) return null;

  const A = Math.sin(dv) * Math.sqrt(r1 * r2 / (1 - Math.cos(dv)));

  let psi_lo = -4 * Math.PI * Math.PI;
  let psi_hi =  4 * Math.PI * Math.PI;
  let psi    = 0;
  let c2     = 0.5;
  let c3     = 1 / 6;

  for (let k = 0; k < 150; k++) {
    let y = r1 + r2 + A * (psi * c3 - 1) / Math.sqrt(c2);

    if (A > 0 && y < 0) {
      psi_lo = psi;
      const psi_next = 0.8 * (1 / c3) * (1 - (r1 + r2) * Math.sqrt(c2) / A);
      psi = Math.max(psi_next, psi_lo + 0.1);
      c2  = progStumpffC(psi);
      c3  = progStumpffS(psi);
      continue;
    }
    if (y < 0) return null;

    const chi    = Math.sqrt(y / c2);
    const t_test = (chi * chi * chi * c3 + A * Math.sqrt(y)) / Math.sqrt(mu);

    if (Math.abs(t_test - tof_s) < 1e-6 * tof_s) break;

    if (t_test < tof_s) psi_lo = psi;
    else                psi_hi = psi;

    psi = (psi_lo + psi_hi) / 2;
    c2  = progStumpffC(psi);
    c3  = progStumpffS(psi);
  }

  const y = r1 + r2 + A * (psi * c3 - 1) / Math.sqrt(c2);
  if (y <= 0) return null;

  const f     = 1 - y / r1;
  const g     = A * Math.sqrt(y / mu);
  const g_dot = 1 - y / r2;
  if (Math.abs(g) < 1e-12) return null;

  const v1 = physScale(physSub(r2v, physScale(r1v, f)), 1 / g);
  const v2 = physScale(physSub(physScale(r2v, g_dot), r1v), 1 / g);
  return { v1, v2 };
}

/**
 * Departure hyperbolic-excess velocity for a heliocentric transfer
 * fromBody@tDepartJD -> destBody@tArrJD.
 * Returns { vInfVec:[x,y,z] km/s ecliptic, c3, vInfMag } or null (degenerate
 * Lambert geometry, non-positive TOF, or an unknown body).
 */
function progDepartVinf(fromBody, destBody, tDepartJD, tArrJD) {
  const tofDays = tArrJD - tDepartJD;
  if (!(tofDays > 0)) return null;
  const epoch = progEpochJD();
  const t1_s = (tDepartJD - epoch) * 86400;
  const t2_s = (tArrJD - epoch) * 86400;

  const st1 = progBodyEphemState(fromBody, t1_s);
  const st2 = progBodyEphemState(destBody, t2_s);
  if (!st1 || !st2) return null;

  const sol = progLambert3D(st1.r, st2.r, tofDays * 86400, PROG_MU_SUN);
  if (!sol) return null;

  const vInfVec = physSub(sol.v1, st1.v);
  const c3 = physDot(vInfVec, vInfVec);
  return { vInfVec, c3, vInfMag: Math.sqrt(c3) };
}

// Per-destination default scan windows (departure-day span from opts epoch,
// TOF range, step size). Hand-picked from rough synodic periods (Mars ~780 d,
// Venus ~584 d) and typical Hohmann-class transfer times; NOT derived from a
// synodic-period formula in code — same "hand-tuned constant" category as
// MATH.md's other magic-number critiques (7/24/51/52/53). Unknown bodies
// fall back to a generic wide window.
const _LP_DEFAULT_WINDOWS = {
  Mars:  { scanSpanDays: 780, tofMinDays: 150, tofMaxDays: 400, step: 8  },
  Venus: { scanSpanDays: 584, tofMinDays: 80,  tofMaxDays: 200, step: 6  },
};
function _lpDefaultWindow(destBody) {
  return _LP_DEFAULT_WINDOWS[destBody] || { scanSpanDays: 700, tofMinDays: 100, tofMaxDays: 400, step: 10 };
}

/**
 * Scan a (departure date x time-of-flight) grid for the MIN-C3 (~= minimum
 * departure delta-v) transfer fromBody -> destBody, within a synod-
 * appropriate window starting at epochJD. If opts.tDepartJD AND
 * opts.tArrJD are both supplied, the scan is skipped entirely and that exact
 * pair is evaluated.
 * Returns { tDepartJD, tArrJD, c3, vInfVec, dvDepart } or null if nothing in
 * the window converges.
 * opts: { scanStartDays=0, scanSpanDays, tofMinDays, tofMaxDays, step,
 *         tDepartJD, tArrJD }
 */
function progOptimalDeparture(fromBody, destBody, epochJD, opts) {
  opts = opts || {};
  if (isFinite(opts.tDepartJD) && isFinite(opts.tArrJD)) {
    const vinf = progDepartVinf(fromBody, destBody, opts.tDepartJD, opts.tArrJD);
    if (!vinf) return null;
    return { tDepartJD: opts.tDepartJD, tArrJD: opts.tArrJD, c3: vinf.c3, vInfVec: vinf.vInfVec, dvDepart: vinf.vInfMag };
  }

  const defs = _lpDefaultWindow(destBody);
  const scanStartDays = isFinite(opts.scanStartDays) ? opts.scanStartDays : 0;
  const scanSpanDays  = isFinite(opts.scanSpanDays)  ? opts.scanSpanDays  : defs.scanSpanDays;
  const tofMinDays     = isFinite(opts.tofMinDays)    ? opts.tofMinDays    : defs.tofMinDays;
  const tofMaxDays     = isFinite(opts.tofMaxDays)    ? opts.tofMaxDays    : defs.tofMaxDays;
  const step           = isFinite(opts.step)          ? opts.step          : defs.step;

  let best = null;
  for (let dep = scanStartDays; dep <= scanStartDays + scanSpanDays; dep += step) {
    const tDepartJD = epochJD + dep;
    for (let tof = tofMinDays; tof <= tofMaxDays; tof += step) {
      const tArrJD = tDepartJD + tof;
      const vinf = progDepartVinf(fromBody, destBody, tDepartJD, tArrJD);
      if (!vinf) continue;
      if (!best || vinf.c3 < best.c3) {
        best = { tDepartJD, tArrJD, c3: vinf.c3, vInfVec: vinf.vInfVec, dvDepart: vinf.vInfMag };
      }
    }
  }
  return best;
}

/**
 * Ideal parking orbit (inclination, LAN, DLA, azimuth) whose plane contains
 * the given departure v-infinity vector, for a site at siteLatDeg.
 * Returns { inc_deg, lan_deg, dla_deg, azimuthDeg, planePenalty, alt_km, note }.
 *
 * DLA (declination of the launch asymptote) is computed in the ECLIPTIC
 * frame — i.e. treating the ecliptic plane as if it were the launch body's
 * equatorial plane. This is the SAME approximation already documented for
 * the surface/spin renderer (MATH.md critiques 54/55: no axial tilt
 * modeled anywhere in the program; Earth's real ecliptic-vs-equatorial
 * obliquity is 23.4 deg). See critique 57 appended below for this module's
 * specific instance of that gap.
 */
function progIdealParkingOrbit(args) {
  const { vInfVec, siteLatDeg, altKm } = args || {};
  const alt_km = isFinite(altKm) ? altKm : 185;
  const vInfMag = physMag(vInfVec || [0, 0, 0]);

  const dla_deg = vInfMag > 1e-9
    ? Math.asin(Math.max(-1, Math.min(1, vInfVec[2] / vInfMag))) * 180 / Math.PI
    : 0;

  const lat = Math.abs(siteLatDeg || 0);
  const dlaAbs = Math.abs(dla_deg);
  const inc_deg = Math.max(dlaAbs, lat);
  const planePenalty = Math.max(0, lat - dlaAbs);

  let lan_deg = 0;
  let note = null;
  if (inc_deg < 1e-9) {
    // Equatorial (ecliptic-plane) parking orbit: the ascending node is
    // undefined (the plane IS the reference plane) -- LAN is meaningless
    // here, pinned to 0 by convention.
    note = 'inc~0: LAN undefined for an equatorial parking plane, pinned to 0 by convention';
  } else {
    const alphaDeg = Math.atan2(vInfVec[1], vInfVec[0]) * 180 / Math.PI;
    const dlaR = dla_deg * Math.PI / 180, incR = inc_deg * Math.PI / 180;
    const tanInc = Math.tan(incR);
    const arg = Math.abs(tanInc) > 1e-9 ? Math.max(-1, Math.min(1, Math.tan(dlaR) / tanInc)) : 0;
    // Ascending-node (lower-energy) root: LAN = alpha - asin(tan(dla)/tan(inc)).
    // The supplementary root (alpha - 180 - asin(...)) puts the same plane's
    // DESCENDING node at this longitude instead -- physically the same orbit
    // plane (a plane has one normal direction up to sign), so it is not a
    // distinct solution worth returning separately here.
    lan_deg = _prog360(alphaDeg - Math.asin(arg) * 180 / Math.PI);
  }

  if (planePenalty > 1e-9) {
    const dogleg = `site latitude (${lat.toFixed(2)} deg) exceeds the asymptote's declination (${dlaAbs.toFixed(2)} deg) -- cannot reach inc=${dlaAbs.toFixed(2)} deg without a dogleg; parking at inc=${lat.toFixed(2)} deg instead (penalty ${planePenalty.toFixed(2)} deg)`;
    note = note ? note + '; ' + dogleg : dogleg;
  }

  const azimuthDeg = progLaunchAzimuthDeg(siteLatDeg || 0, inc_deg);

  return { inc_deg, lan_deg, dla_deg, azimuthDeg, planePenalty, alt_km, note };
}

/**
 * Full launch-to-destination plan: picks a departure window (scan, or an
 * explicit tDepartJD/tArrJD pair), computes v-infinity, and derives the
 * ideal parking orbit.
 *
 * destBody may be:
 *   - a planet NAME string (e.g. 'Mars') present in PROG_BODY_ELEMENTS -- the
 *     full interplanetary path (scan/Lambert/DLA) runs.
 *   - 'Moon' -- OUT OF SCOPE for phase 1 (lunar transfer needs patched-conic
 *     handling this module doesn't attempt); returns an object with null
 *     numeric fields and an explanatory note rather than a bare null, so
 *     callers don't have to special-case a null-vs-object return shape.
 *   - an EARTH-ORBIT target spec object { inc, lan, alt } -- short-circuits
 *     to "ideal parking = coplanar with the target," c3/vInf = 0 (no
 *     departure hyperbola for a same-body destination).
 *
 * Returns { inc_deg, lan_deg, alt_km, c3, vInfMag, dla_deg, azimuthDeg,
 *           planePenalty, tDepartJD, tArrJD, dvDepart, note }.
 */
function progPlanLaunchToDestination(args) {
  const { destBody, epochJD, siteLatDeg, altKm, tDepartJD, tArrJD } = args || {};
  const fromBody = args.fromBody || 'Earth';
  const alt_km = isFinite(altKm) ? altKm : 185;

  if (destBody === 'Moon') {
    // Lunar departure is GEOCENTRIC, not a heliocentric Lambert transfer --
    // route through the existing cislunar plane math instead of
    // progOptimalDeparture. The "ideal" parking orbit for a lunar transfer
    // is simply coplanar with the Moon's instantaneous orbital plane at the
    // planned TLI time (a real free-return/plane-change trade exists, but
    // coplanar minimizes the TLI-to-LOI plane-change cost -- see MATH.md
    // critique 58). dvDepart reuses progDvTLI (360) so the readout's ΔV
    // number matches what the mission's TLI burn will actually cost.
    const tDep = isFinite(tDepartJD) ? (tDepartJD - epochJD) * 86400 : 0;
    const plane = progMoonPlaneAt(epochJD, tDep);
    const inc_deg = Math.max(plane.inc_deg, Math.abs(siteLatDeg || 0));
    const planePenalty = Math.max(0, Math.abs(siteLatDeg || 0) - plane.inc_deg);
    return {
      inc_deg, lan_deg: plane.lan_deg, alt_km, c3: null, vInfMag: null, dla_deg: null,
      azimuthDeg: progLaunchAzimuthDeg(siteLatDeg || 0, inc_deg),
      planePenalty, tDepartJD: isFinite(tDepartJD) ? tDepartJD : epochJD, tArrJD: null,
      dvDepart: (typeof progDvTLI === 'function') ? progDvTLI(alt_km) : null,
      note: `coplanar with the Moon's instantaneous orbital plane at TLI time (inc ${plane.inc_deg.toFixed(2)} deg vs ecliptic)`
        + (planePenalty > 0.05 ? `; site latitude exceeds the plane's inclination by ${planePenalty.toFixed(2)} deg -- dogleg required` : ''),
    };
  }

  if (destBody && typeof destBody === 'object') {
    // Earth-orbit (same-body) target: ideal parking is simply coplanar with
    // the target orbit -- no departure hyperbola involved.
    const inc_deg = destBody.inc ?? 0;
    const lan_deg = destBody.lan ?? 0;
    return {
      inc_deg, lan_deg, alt_km: isFinite(destBody.alt) ? destBody.alt : alt_km,
      c3: 0, vInfMag: 0, dla_deg: null,
      azimuthDeg: progLaunchAzimuthDeg(siteLatDeg || 0, inc_deg),
      planePenalty: 0, tDepartJD: epochJD, tArrJD: epochJD, dvDepart: 0,
      note: 'coplanar with target: same-body destination, no departure hyperbola',
    };
  }

  const opt = progOptimalDeparture(fromBody, destBody, epochJD, { tDepartJD, tArrJD });
  if (!opt) {
    return {
      inc_deg: null, lan_deg: null, alt_km, c3: null, vInfMag: null, dla_deg: null,
      azimuthDeg: null, planePenalty: null, tDepartJD: null, tArrJD: null, dvDepart: null,
      note: 'no converged Lambert solution found in the scanned window',
    };
  }

  const parking = progIdealParkingOrbit({ vInfVec: opt.vInfVec, siteLatDeg, altKm: alt_km });

  return {
    inc_deg: parking.inc_deg, lan_deg: parking.lan_deg, alt_km: parking.alt_km,
    c3: opt.c3, vInfMag: Math.sqrt(opt.c3), dla_deg: parking.dla_deg,
    azimuthDeg: parking.azimuthDeg, planePenalty: parking.planePenalty,
    tDepartJD: opt.tDepartJD, tArrJD: opt.tArrJD, dvDepart: opt.dvDepart,
    note: parking.note,
  };
}

/**
 * Moon's instantaneous orbital-plane inclination/LAN (deg, ecliptic frame --
 * the same reference frame every other body position resolves in) at
 * mission time t_s, derived from the orbit-normal vector h = r x v of the
 * Moon's GEOCENTRIC state (progBodyLocalEphemState, 360 -- the parent-
 * relative state BEFORE Earth's own heliocentric position is added back in,
 * i.e. already Earth-centered).
 * inc = acos(h_z/|h|); LAN = atan2(h_x, -h_y) (node vector N = k x h).
 * CRITIQUE: this is the INSTANTANEOUS osculating plane, not the Moon's mean
 * orbital plane -- it nutates with the ~18.6yr regression of nodes baked
 * into PROG_MOON_ELEMENTS.OmDot, which is physically correct for "the
 * plane at this exact epoch" but will drift over a long mission if reused
 * without recomputing at the new epoch. See MATH.md §7p critique 58.
 * Returns { inc_deg, lan_deg }.
 */
function progMoonPlaneAt(epochJD, t_s) {
  const st = progBodyLocalEphemState('Moon', t_s || 0);
  const h = physCross(st.r, st.v);
  const hMag = physMag(h);
  if (hMag < 1e-9) return { inc_deg: 0, lan_deg: 0 };
  const inc_deg = Math.acos(Math.max(-1, Math.min(1, h[2] / hMag))) * 180 / Math.PI;
  const lan_deg = _prog360(Math.atan2(h[0], -h[1]) * 180 / Math.PI);
  return { inc_deg, lan_deg };
}

/**
 * Generic "match this plane" resolver for the launch card's plane-target
 * picker (R7 phase 2 / user feedback item 2). target is either the string
 * 'Moon' or a catalog reference-orbit object with a defined plane
 * (kind:'keplerian', inc [+ lan if pinned]).
 * Returns { inc_deg, lan_deg, source, unreachable, penalty_deg } given the
 * launch site latitude -- unreachable/penalty surfaced by the CALLER (UI),
 * never silently clamped away (feedback item 2).
 */
function progResolvePlaneTarget(target, epochJD, t_s, siteLatDeg) {
  let inc_deg, lan_deg, source;
  if (target === 'Moon') {
    const p = progMoonPlaneAt(epochJD, t_s || 0);
    inc_deg = p.inc_deg; lan_deg = p.lan_deg; source = "Moon's current orbital plane";
  } else if (target && typeof target === 'object') {
    inc_deg = isFinite(target.inc) ? target.inc : 0;
    lan_deg = isFinite(target.lan) ? target.lan : 0;
    source = target.name || 'reference orbit';
  } else {
    return null;
  }
  const lat = Math.abs(siteLatDeg || 0);
  const unreachable = lat > inc_deg + 1e-9;
  const penalty_deg = unreachable ? (lat - inc_deg) : 0;
  return { inc_deg, lan_deg, source, unreachable, penalty_deg };
}
