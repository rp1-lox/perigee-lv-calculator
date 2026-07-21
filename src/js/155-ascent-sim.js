// ─── 155: 2-DOF ASCENT SIMULATOR — SIM1 (core module) ───────────────────────
// docs/MISSION_MODEL_V2.md §27. Pure numerical integrator: RK4, exponential
// atmosphere, Mach-dependent drag, altitude-blended thrust, serial staging,
// FIXED steering law. No DOM, no UI, no optimizer (SIM2) — a single
// deterministic ascentSimRun(cfg) -> result call.
//
// ONE-DEFINITION RULE: reuses G0/MU/RE/OMEGA_E from 010-constants.js and
// rocketEq() from 140-physics.js (both already in global scope by load
// order: 010, 140, 145, 150, 155). Does NOT touch calculate()/evalAtPayload()
// or the T-S path in 140 in any way — this module is purely additive.
//
// UNIT CONVENTION (documented once, converted at the boundary):
//   - 010-constants.js stores MU in km^3/s^2 and RE in km (that's what
//     circVel() in 140 uses: sqrt(MU/(RE+alt_km))*1000).
//   - This module's internal state is ALL SI (meters, m/s, kg, seconds,
//     radians): r = distance from Earth center in METERS, theta = downrange
//     angle (rad), vr/vt = radial/tangential velocity (m/s), m = mass (kg).
//   - Conversion happens ONCE at the top of ascentSimRun(): MU_SI = MU*1e9
//     (m^3/s^2), RE_M = RE*1000 (m). Every other function in this module
//     assumes SI and takes MU_SI/RE_M as explicit params (no hidden re-reads
//     of the km-based globals) so unit mistakes can't creep in mid-file.
//   - cfg (vehicle/stage) inputs are SI: masses in kg, thrust in N, Isp in s.

'use strict';

// ─── Environment ─────────────────────────────────────────────────────────
// Exponential atmosphere, scale height 7160 m (mid-range of the 7.16-8.5 km
// family cited in §27; SIM1 fixes the low end for a documented, re-pinnable
// constant — SIM3 revisits per MATH.md). Hard cutoff above 120 km: density
// is already ~7e-6 of sea level there, and a hard zero keeps drag exactly
// zero (and results exactly reproducible) once the vehicle is exoatmospheric,
// rather than carrying a vanishingly small but nonzero tail.
const ASCSIM_RHO0 = 1.225;           // kg/m^3, sea level
const ASCSIM_SCALE_H = 7160;         // m
const ASCSIM_ATM_CUTOFF_M = 120000;  // m
// Speed of sound: SIM1 has no temperature-altitude model (deferred to SIM3),
// so Mach number for the Cd(M) curve uses a constant a=340 m/s. This is a
// known simplification (documented per §27 "exact constants in MATH.md" —
// MATH.md itself waits for SIM3 per the spec); drag magnitude is dominated
// by rho(h) -> 0 well before this approximation would matter much.
const ASCSIM_SOUND_SPEED = 340;      // m/s

function ascsimRho(h_m) {
  if (h_m >= ASCSIM_ATM_CUTOFF_M) return 0;
  if (h_m < 0) h_m = 0;
  return ASCSIM_RHO0 * Math.exp(-h_m / ASCSIM_SCALE_H);
}

function ascsimGravity(r_m, muSI) {
  return muSI / (r_m * r_m);
}

// Fixed piecewise Cd(Mach) curve per §27 SIM1 scope.
function ascsimCd(M) {
  if (M < 0.8) return 0.25;
  if (M < 1.2) return 0.25 + (0.55 - 0.25) * (M - 0.8) / (1.2 - 0.8);
  if (M < 5) return 0.55 + (0.30 - 0.55) * (M - 1.2) / (5 - 1.2);
  return 0.30;
}

// Mass-scaled default drag reference area (documented approximation): a
// Falcon-9-class 500 t vehicle gets ~10 m^2; scales as mass^(2/3) (area
// scales with the square of a linear dimension, mass with the cube, for a
// roughly self-similar vehicle family).
function ascsimDefaultDragArea(m0_kg) {
  return 10 * Math.pow(m0_kg / 500000, 2 / 3);
}

// ─── Steering law (FIXED params — SIM2 optimizes these) ────────────────────
// Phases: (1) vertical thrust until speed >= v_kick; (2) instantaneous pitch
// by theta_kick off vertical; (3) gravity turn (thrust along velocity) while
// h < 60 km; (4) above 60 km, linear-tangent law freezing/decaying the pitch
// captured at the 60 km handoff. Pitch is expressed as "pitch_from_horizontal"
// (pi/2 = straight up, 0 = horizontal) so the linear-tangent law in the spec
// (tan(pitch) decaying) reads directly off this angle.
//
// Steering state is computed ONCE per outer timestep (from the state at the
// START of the step) and held fixed across all four RK4 substeps of that
// step. This is a deliberate determinism simplification: recomputing the
// discrete phase transition (v_kick trip, 60 km handoff) from perturbed
// RK4 substates could flip the phase mid-step in a way that depends on
// floating-point noise. Holding it fixed for dt=0.25s introduces at most one
// step's worth of lag on a phase boundary, which is negligible at this dt and
// keeps results exactly reproducible.
// SIM2 note: "speed"/pitch here are computed relative to the CO-ROTATING
// launch site (subtracting the v0_tangential rotation credit, scaled by
// R/r — the exact same relative-velocity convention ascsimDerivative already
// uses for drag), NOT the raw inertial velocity. With SIM1's default
// v0_tangential=0 this is identical to the inertial velocity (no behavior
// change for any SIM1 pin). With SIM2's nonzero rotation credit, using the
// INERTIAL velocity here was a real bug: state.vt starts at v0_tangential
// (the vehicle is co-rotating with the pad from t=0), so raw speed >= v_kick
// was already true before any real thrust-gained velocity existed, and the
// gravity-turn law's atan2(vr, vt) locked onto a near-horizontal pitch
// immediately (vt dominated by the rotation credit) — collapsing vertical
// thrust and crashing the vehicle within ~1 s. Relative velocity fixes this:
// it starts at 0 (co-rotating = "at rest" relative to the pad) and only
// grows as the vehicle actually gains real velocity, exactly like SIM1's
// original v0_tangential=0 behavior.
function ascsimPitch(state, t, cfg, steerCtx, RE_M) {
  const h = state.r - RE_M;
  const v0t = cfg.v0_tangential || 0;
  const vtRel = state.vt - v0t * (RE_M / state.r);
  const speed = Math.sqrt(state.vr * state.vr + vtRel * vtRel);

  if (!steerCtx.kicked) {
    if (speed >= cfg.v_kick) {
      steerCtx.kicked = true;
      steerCtx.lastGtPitch = Math.PI / 2 - cfg.theta_kick;
      return steerCtx.lastGtPitch;
    }
    return Math.PI / 2; // vertical
  }

  // Gravity-turn -> linear-tangent handoff altitude. Fixed at 60 km in SIM1;
  // SIM2 makes it an OPTIONAL 4th search dimension (cfg.gtAltKm, default 60)
  // per the brief's "+ optionally pitch-handoff altitude if trivially
  // beneficial" — a fixed 60 km handoff left the search unable to hit the
  // insertion tolerance for a heavy, long-burning stack (the LT decay
  // couldn't finish converting the flight path to horizontal before apogee
  // had already sailed past the target altitude). ascentSimOptimize does NOT
  // vary this by default (kept out of the 3 named params to match the
  // brief's contract exactly) — ascentSimMaxPayload turns it on.
  const gtAltM = (cfg.gtAltKm != null ? cfg.gtAltKm : 60) * 1000;
  if (h < gtAltM) {
    let p;
    if (speed < 1e-3) {
      p = steerCtx.lastGtPitch != null ? steerCtx.lastGtPitch : Math.PI / 2;
    } else {
      // thrust along RELATIVE velocity vector; pitch_from_horizontal = angle
      // of v_rel above local horizontal = atan2(radial component, relative
      // tangential component).
      p = Math.atan2(state.vr, Math.max(vtRel, 1e-9));
    }
    steerCtx.lastGtPitch = p;
    return p;
  }

  // Exoatmospheric linear-tangent law, anchored at the 60 km handoff.
  if (!steerCtx.handoffDone) {
    steerCtx.handoffDone = true;
    steerCtx.pitchHandoff = steerCtx.lastGtPitch != null ? steerCtx.lastGtPitch : 0;
    steerCtx.tHandoff = t;
  }
  const dtSince = t - steerCtx.tHandoff;
  const factor = Math.max(0, 1 - cfg.ltRate * dtSince);
  return Math.atan(Math.tan(steerCtx.pitchHandoff) * factor);
}

// ─── Equations of motion (2-DOF point mass, inertial frame) ────────────────
// ctx: { m, mdot, Fvac, ispVac, ispSl, pitch, v0t, dragArea, muSI, RE_M }
// Earth rotation enters ONLY as v0t, the initial/reference tangential
// velocity (SIM2 wires launch-azimuth math); the atmosphere is treated as
// co-rotating with the launch site at that same rate, so relative airspeed
// subtracts v0t scaled by (R/r) from the tangential velocity component
// (a simple, documented approximation — not a full rotating-frame model).
function ascsimDerivative(state, ctx, mOverride) {
  const r = state.r, vr = state.vr, vt = state.vt;
  const m = mOverride != null ? mOverride : ctx.m;
  const h = r - ctx.RE_M;

  const rho = ascsimRho(h);
  const pRatio = ctx.Fvac > 0 ? Math.max(0, Math.min(1, rho / ASCSIM_RHO0)) : 0;
  const Fsl = ctx.ispVac > 0 ? ctx.Fvac * (ctx.ispSl / ctx.ispVac) : ctx.Fvac;
  const F = ctx.Fvac - (ctx.Fvac - Fsl) * pRatio;
  const Fr = F * Math.sin(ctx.pitch);
  const Ft = F * Math.cos(ctx.pitch);

  const vtRel = vt - ctx.v0t * (ctx.RE_M / r);
  const vrel = Math.sqrt(vr * vr + vtRel * vtRel);
  const mach = vrel / ASCSIM_SOUND_SPEED;
  const Cd = ascsimCd(mach);
  const D = 0.5 * rho * vrel * vrel * Cd * ctx.dragArea;
  const Dr = vrel > 1e-9 ? D * vr / vrel : 0;
  const Dt = vrel > 1e-9 ? D * vtRel / vrel : 0;

  const g = ascsimGravity(r, ctx.muSI);

  return {
    dr: vr,
    dtheta: vt / r,
    dvr: (vt * vt) / r - g + (Fr - Dr) / m,
    dvt: -(vr * vt) / r + (Ft - Dt) / m,
    _diag: { F, D, Fr, Ft, Dr, Dt, g, mach, rho },
  };
}

// Mass is not frozen across the step's four RK4 substages: since mdot is
// constant and known analytically over the step, the exact mass at each
// substage's time offset (0, dt/2, dt/2, dt) is used. Freezing mass at the
// step-start value instead produced multi-percent delta-v error on
// short/high-thrust burns where propellant depletes a large fraction of the
// remaining mass within a single 0.25s step (caught by the SIM1 rocket-eq
// analytic pin, tests/suites/11-ascent-sim.js).
function ascsimRk4Step(y, dt, ctx) {
  const m0 = ctx.m, mdot = ctx.mdot || 0;
  const f = (yy, tau) => ascsimDerivative(yy, ctx, m0 - mdot * tau);
  const k1 = f(y, 0);
  const y2 = { r: y.r + dt / 2 * k1.dr, theta: y.theta + dt / 2 * k1.dtheta, vr: y.vr + dt / 2 * k1.dvr, vt: y.vt + dt / 2 * k1.dvt };
  const k2 = f(y2, dt / 2);
  const y3 = { r: y.r + dt / 2 * k2.dr, theta: y.theta + dt / 2 * k2.dtheta, vr: y.vr + dt / 2 * k2.dvr, vt: y.vt + dt / 2 * k2.dvt };
  const k3 = f(y3, dt / 2);
  const y4 = { r: y.r + dt * k3.dr, theta: y.theta + dt * k3.dtheta, vr: y.vr + dt * k3.dvr, vt: y.vt + dt * k3.dvt };
  const k4 = f(y4, dt);
  return {
    r: y.r + dt / 6 * (k1.dr + 2 * k2.dr + 2 * k3.dr + k4.dr),
    theta: y.theta + dt / 6 * (k1.dtheta + 2 * k2.dtheta + 2 * k3.dtheta + k4.dtheta),
    vr: y.vr + dt / 6 * (k1.dvr + 2 * k2.dvr + 2 * k3.dvr + k4.dvr),
    vt: y.vt + dt / 6 * (k1.dvt + 2 * k2.dvt + 2 * k3.dvt + k4.dvt),
    _diag0: k1._diag, // start-of-step diagnostics, used for loss quadrature
  };
}

// ─── Orbit reconstruction (vis-viva) ───────────────────────────────────────
// state: {r, vr, vt} in SI (meters, m/s). Returns {periKm, apoKm}.
function ascentSimOrbitOf(state, muSI, RE_M) {
  muSI = muSI == null ? MU * 1e9 : muSI;
  RE_M = RE_M == null ? RE * 1000 : RE_M;
  const r = state.r, vr = state.vr, vt = state.vt;
  const v2 = vr * vr + vt * vt;
  const eps = v2 / 2 - muSI / r;           // specific orbital energy
  const h = r * vt;                         // specific angular momentum
  const a = -muSI / (2 * eps);
  const eSq = 1 - (h * h) / (muSI * a);
  const e = Math.sqrt(Math.max(0, eSq));
  const periM = a * (1 - e) - RE_M;
  const apoM = a * (1 + e) - RE_M;
  return { periKm: periM / 1000, apoKm: apoM / 1000, aM: a, eccentricity: e, specificEnergy: eps };
}

// ─── Main entry point ───────────────────────────────────────────────────────
// cfg: {
//   stages: [{dry_kg, prop_kg, F_vac_N, isp_vac_s, isp_sl_s?, res_pct?}],
//   payload_kg?, v0_tangential?, v_kick?, theta_kick?, ltRate?,
//   dragArea_m2?, dt?, tMax?, target?:{periKm,apoKm,periTol?,apoTol?} (SIM2),
// }
function ascentSimDefaults(cfg) {
  cfg = cfg || {};
  const stages = (cfg.stages || []).map((s) => ({
    dry_kg: s.dry_kg,
    prop_kg: s.prop_kg,
    F_vac_N: s.F_vac_N,
    isp_vac_s: s.isp_vac_s,
    isp_sl_s: (s.isp_sl_s != null ? s.isp_sl_s : null), // resolved per-stage below (first stage defaults to 0.9x vac)
    res_pct: s.res_pct || 0,
  }));
  return {
    stages,
    payload_kg: cfg.payload_kg || 0,
    v0_tangential: cfg.v0_tangential || 0,
    v_kick: cfg.v_kick != null ? cfg.v_kick : 50,
    theta_kick: cfg.theta_kick != null ? cfg.theta_kick : 0.035,
    ltRate: cfg.ltRate || 0,
    dragArea_m2: cfg.dragArea_m2, // resolved after m0 is known if undefined
    dt: cfg.dt || 0.25,
    tMax: cfg.tMax || 4000,
    // SIM2: pass the insertion target through verbatim (undefined if absent
    // — a plain SIM1-style fly-to-depletion run). NOT whitelisted/defaulted
    // field-by-field like the steering params above because its shape is
    // caller-owned (periKm/apoKm are required, periTol/apoTol default
    // inside the cutoff check itself, see the main loop).
    target: cfg.target,
    // SIM2: gravity-turn -> linear-tangent handoff altitude (km). Same
    // pass-through treatment as target — caller-owned, defaulted inside
    // ascsimPitch itself (60 km) rather than here.
    gtAltKm: cfg.gtAltKm,
  };
}

function ascentSimRun(rawCfg) {
  const cfg = ascentSimDefaults(rawCfg);
  const MU_SI = MU * 1e9;   // m^3/s^2 (MU global is km^3/s^2 — see header)
  const RE_M = RE * 1000;   // m (RE global is km)

  const m0Total = cfg.payload_kg + cfg.stages.reduce((s, st) => s + st.dry_kg + st.prop_kg, 0);
  const dragArea = cfg.dragArea_m2 != null ? cfg.dragArea_m2 : ascsimDefaultDragArea(m0Total);

  const state = { r: RE_M, theta: 0, vr: 0, vt: cfg.v0_tangential };
  let m = m0Total;
  let t = 0;
  const dt = cfg.dt;

  let stageIdx = 0;
  let burnedThisStage = 0;
  let mStageStart = m;
  let dvIdeal = 0;
  let status = 'timeout';

  const steerCtx = { kicked: false, lastGtPitch: null, handoffDone: false, pitchHandoff: null, tHandoff: null };

  let gravLoss = 0, dragLoss = 0, steerLoss = 0, thrustPowerIntegral = 0;

  function usableProp(st) { return st.prop_kg * (1 - (st.res_pct || 0) / 100); }
  function ispSlOf(st, idx) {
    if (st.isp_sl_s != null) return st.isp_sl_s;
    return idx === 0 ? 0.9 * st.isp_vac_s : st.isp_vac_s;
  }

  while (t < cfg.tMax) {
    if (stageIdx >= cfg.stages.length) { status = 'depleted'; break; }
    const st = cfg.stages[stageIdx];
    const usable = usableProp(st);

    if (burnedThisStage >= usable) {
      // segment dv for the just-finished stage
      dvIdeal += rocketEq(st.isp_vac_s, mStageStart, mStageStart - usable);
      m -= st.dry_kg; // jettison dry mass
      stageIdx++;
      burnedThisStage = 0;
      mStageStart = m;
      if (stageIdx >= cfg.stages.length) { status = 'depleted'; break; }
      continue; // re-evaluate with the new stage, no time consumed
    }

    const mdot = st.F_vac_N / (G0 * st.isp_vac_s);
    // Terminal-step clamp: if this stage's remaining usable propellant would
    // run out mid-step, shorten JUST this step to end exactly at depletion
    // (mass flow / thrust are unchanged — only the step's time extent is
    // clamped). Every step before this one is the full fixed dt=0.25s; this
    // keeps mass conservation exact at stage boundaries without adaptive
    // step-size control (still deterministic, still a fixed dt otherwise).
    const remaining = usable - burnedThisStage;
    const dtStep = mdot > 0 ? Math.min(dt, remaining / mdot) : dt;
    const pitch = ascsimPitch(state, t, cfg, steerCtx, RE_M);
    const ctx = {
      m, mdot, Fvac: st.F_vac_N, ispVac: st.isp_vac_s, ispSl: ispSlOf(st, stageIdx),
      pitch, v0t: cfg.v0_tangential, dragArea, muSI: MU_SI, RE_M,
    };

    // Loss quadrature (forward-Euler on the start-of-step derivative —
    // deliberately decoupled from the RK4 state integration; see module
    // header for why the phase/steering is likewise frozen at step start).
    const d0 = ascsimDerivative(state, ctx)._diag;
    const speed0 = Math.sqrt(state.vr * state.vr + state.vt * state.vt);
    const sinGamma = speed0 < 1e-6 ? Math.sin(pitch) : state.vr / speed0;
    gravLoss += d0.g * sinGamma * dtStep;
    dragLoss += (d0.D / m) * dtStep;
    const Fmag = d0.F;
    let cosAlpha = 1;
    if (Fmag > 1e-9 && speed0 > 1e-6) {
      cosAlpha = (d0.Fr * state.vr + d0.Ft * state.vt) / (Fmag * speed0);
      cosAlpha = Math.max(-1, Math.min(1, cosAlpha));
    }
    steerLoss += (Fmag / m) * (1 - cosAlpha) * dtStep;
    thrustPowerIntegral += ((d0.Fr * state.vr + d0.Ft * state.vt) / m) * dtStep;

    const next = ascsimRk4Step({ r: state.r, theta: state.theta, vr: state.vr, vt: state.vt }, dtStep, ctx);
    state.r = next.r; state.theta = next.theta; state.vr = next.vr; state.vt = next.vt;
    m -= mdot * dtStep;
    burnedThisStage += mdot * dtStep;
    t += dtStep;

    if (state.r < RE_M) { status = 'crash'; break; }

    // ─── SIM2: insertion targeting ─────────────────────────────────────────
    // Only checked while burning the FINAL stage (per §27 SIM2 scope — earlier
    // stages never trigger an insertion cutoff, matching a real ascent where
    // only the last active stage can perform the orbit-insertion cutoff).
    // Checks the OSCULATING orbit implied by the current state every step —
    // the instantaneous two-body orbit the vehicle would coast onto if thrust
    // stopped right now. Tolerance is a documented band (+-2 km peri, +-5 km
    // apo defaults — matches §27's validation-anchor tolerance), overridable
    // via cfg.target.periTol/apoTol. A hit is a deterministic step check (no
    // interpolation to the exact crossing instant) — at dt=0.25s that adds at
    // most one step's worth of extra burn, negligible next to the km-scale
    // tolerance band.
    if (cfg.target && stageIdx === cfg.stages.length - 1) {
      const orbCheck = ascentSimOrbitOf(state, MU_SI, RE_M);
      const periTol = cfg.target.periTol != null ? cfg.target.periTol : 2;
      const apoTol = cfg.target.apoTol != null ? cfg.target.apoTol : 5;
      if (Math.abs(orbCheck.periKm - cfg.target.periKm) <= periTol &&
          Math.abs(orbCheck.apoKm - cfg.target.apoKm) <= apoTol) {
        status = 'inserted';
        break;
      }
    }
  }

  // Partial segment for a stage that was mid-burn when the loop stopped
  // (timeout/crash/inserted) — record the dv actually achieved on that stage.
  if (status !== 'depleted' && stageIdx < cfg.stages.length && burnedThisStage > 0) {
    dvIdeal += rocketEq(cfg.stages[stageIdx].isp_vac_s, mStageStart, mStageStart - burnedThisStage);
  }

  // Residual propellant (kg): total UNBURNED propellant mass still onboard
  // when the run ended — the current (partially burned) stage's remainder
  // plus every stage after it that was never ignited. This is the SIM2
  // optimizer/bisection objective's "margin" (mirrors lvMaxPayload's ΔV
  // margin, but in propellant mass rather than ΔV, since the target is an
  // insertion cutoff rather than a fixed ΔV budget). Naturally 0 when
  // status==='depleted' (stageIdx has already advanced past the stage array).
  let residualProp_kg = 0;
  for (let i = stageIdx; i < cfg.stages.length; i++) {
    residualProp_kg += (i === stageIdx)
      ? Math.max(0, cfg.stages[i].prop_kg - burnedThisStage)
      : cfg.stages[i].prop_kg;
  }

  const orbit = ascentSimOrbitOf(state, MU_SI, RE_M);

  return {
    status,
    finalOrbit: { periKm: orbit.periKm, apoKm: orbit.apoKm },
    finalState: { r: state.r, theta: state.theta, vr: state.vr, vt: state.vt, m, t },
    losses: { gravity: gravLoss, drag: dragLoss, steering: steerLoss, total: gravLoss + dragLoss + steerLoss },
    dvIdeal,
    tBurnout: t,
    mFinal: m,
    residualProp_kg,
    // Diagnostic-only field (not in the §27 API list) kept for pin support:
    // integral of (thrust dot v)/m dt, i.e. the specific power thrust adds.
    // With no drag this must equal the specific-orbital-energy change.
    workDiag: { thrustPowerIntegral },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SIM2: steering optimizer + payload bisection + earth-rotation/azimuth.
// docs/MISSION_MODEL_V2.md §27 "SIM2 scope". ascentSimRun (above, SIM1)
// remains the ONLY trajectory evaluator — everything below calls it, never
// reimplements the physics.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Earth-rotation / launch-azimuth ────────────────────────────────────────
// cos(i) = sin(Az)*cos(lat)  =>  sin(Az) = cos(i)/cos(lat), Az measured
// compass-style (0=N, 90=E — the same convention as the app's azMin/azMax
// site fields, e.g. KSC 37-112 bracketing due-east/90). asin() gives the
// PRIMARY root Az1 in [-90,90] (a northeasterly launch, appropriate for a
// low/mid-inclination equatorial-ish corridor like KSC); the SECONDARY root
// Az2 = 180-Az1 is a southeasterly/retrograde-leaning launch (appropriate for
// a polar-corridor site like Vandenberg, azMin/azMax around 150-220). Of the
// two, this picks whichever lies closer to the site's own [azMin,azMax]
// corridor midpoint — the corridor itself already encodes which family of
// launch (direct vs retrograde-leaning) the site supports.
// An inclination outside the resulting corridor is simply CLAMPED to the
// nearest limit — SIM2 charges no dogleg maneuver for that case (documented
// limitation, deferred; matches the brief's instruction verbatim).
function ascentSimLaunchAzimuth(siteLat_deg, azMin_deg, azMax_deg, targetIncDeg) {
  const latRad = siteLat_deg * Math.PI / 180;
  const incRad = targetIncDeg * Math.PI / 180;
  const cosLat = Math.cos(latRad);
  let az1;
  if (Math.abs(cosLat) < 1e-9) {
    az1 = 90; // pole: azimuth is degenerate, due-east is as good a default as any
  } else {
    let s = Math.cos(incRad) / cosLat;
    s = Math.max(-1, Math.min(1, s));
    az1 = Math.asin(s) * 180 / Math.PI;
  }
  const az2 = 180 - az1;
  const mid = (azMin_deg + azMax_deg) / 2;
  let az = Math.abs(az1 - mid) <= Math.abs(az2 - mid) ? az1 : az2;
  if (az < azMin_deg) az = azMin_deg;
  if (az > azMax_deg) az = azMax_deg;
  return az;
}

// v0_tangential (m/s, SI) from site lat + target inclination, per §27's exact
// formula: v0_tangential = OMEGA_E*RE(m)*cos(lat)*sin(Az). Uses the ONE
// OMEGA_E/RE constants from 010-constants.js (converted to SI once here,
// same pattern as ascentSimRun's own MU_SI/RE_M conversion).
function ascentSimV0Tangential(siteLat_deg, azMin_deg, azMax_deg, targetIncDeg) {
  const az = ascentSimLaunchAzimuth(siteLat_deg, azMin_deg, azMax_deg, targetIncDeg);
  const latRad = siteLat_deg * Math.PI / 180;
  const RE_M = RE * 1000;
  return OMEGA_E * RE_M * Math.cos(latRad) * Math.sin(az * Math.PI / 180);
}

// ─── Vehicle-data adapter (one-definition rule) ─────────────────────────────
// Converts the ONE base-bundle stage shape produced by _tsVehicleToBase /
// _tsExpandStages (165-trade-study.js) — {dry,prop,thrust,isp,res}, thrust in
// kN — into ascentSimRun's SI cfg.stages shape. This is the ONLY place SIM2
// does that unit conversion (kN -> N once, at this boundary). Callers MUST
// pass already-S15-expanded stages (stageExpandS15 / _tsExpandStages) — this
// adapter does no S1.5 splitting itself, per the hard invariant that any new
// consumer of vehicle stage data expands S1.5 before touching pure physics.
function ascsimStagesFromBase(baseStages) {
  return (baseStages || []).map((s) => ({
    dry_kg: s.dry || 0,
    prop_kg: s.prop || 0,
    F_vac_N: (s.thrust || 0) * 1000,
    isp_vac_s: s.isp || 1,
    isp_sl_s: s.isp_sl_s != null ? s.isp_sl_s : null, // ascentSimDefaults resolves the 0.9x-vac default
    res_pct: s.res || 0,
  }));
}

// ─── Steering optimizer ──────────────────────────────────────────────────────
// Deterministic compass/pattern search (Hooke-Jeeves): from a FIXED starting
// point, try +-step along each of the 3 steering params {v_kick, theta_kick,
// ltRate}; move to any improving point found; if a full round finds no
// improvement, halve all step sizes; stop at a fixed simulation budget OR
// once every step size has shrunk below its floor. No randomness anywhere —
// same cfg + same budget + same start/steps ALWAYS produces the same answer
// (determinism is a spec hard rule, pinned by tests/suites/11-ascent-sim.js).
// Start point + step sizes calibrated empirically against the §27 anchor
// vehicles (Saturn-class stacks), NOT SIM1's tiny single-stage test rocket —
// SIM1's own pins call ascentSimRun directly with EXPLICIT steering params,
// never through the optimizer, so this calibration cannot move any SIM1 pin.
// A small-rocket-shaped default (v_kick~50, theta_kick~0.03 — appropriate for
// a fast-accelerating test vehicle) turned out to be a bad starting BASIN for
// a real, much-lower-TWR multi-stage stack: a shallow initial kick angle
// leaves a long, heavy vehicle still climbing steeply deep into its final
// stage's burn, and the compass search's fixed step sizes can't cross the
// basin boundary to a workable steep-kick / fast-flatten solution within a
// realistic budget. These defaults sit inside the empirically-good basin
// (large kick angle, moderate v_kick, faster linear-tangent decay) found by
// gridding Saturn IB at zero payload; see the SIM2 as-built note (§27) for
// the calibration trace.
const ASCSIM_OPT_DEFAULT_START = { v_kick: 100, theta_kick: 1.2, ltRate: 0.0035 };
const ASCSIM_OPT_DEFAULT_STEPS = { v_kick: 20, theta_kick: 0.15, ltRate: 0.0012 };
const ASCSIM_OPT_MIN_STEPS = { v_kick: 1, theta_kick: 0.002, ltRate: 0.00005 };
const ASCSIM_OPT_DEFAULT_BUDGET = 200;

// Objective: among runs that ACHIEVE the target insertion (status==='inserted'),
// maximize residual propellant (more margin = better trajectory). Among runs
// that DON'T, minimize a documented insertion-error norm — squared distance
// from the target peri/apo in tolerance-normalized units — so the search still
// has a gradient toward feasibility instead of a flat/undefined objective.
// The feasible score band (1e9 + residual) is unconditionally above every
// infeasible score (-errNorm <= 0 always), so any feasible point always beats
// any infeasible one, exactly matching the spec's priority order.
function ascsimScoreOf(result, target) {
  const periTol = target.periTol != null ? target.periTol : 2;
  const apoTol = target.apoTol != null ? target.apoTol : 5;
  const dPeri = (result.finalOrbit.periKm - target.periKm) / periTol;
  const dApo = (result.finalOrbit.apoKm - target.apoKm) / apoTol;
  const errNorm = dPeri * dPeri + dApo * dApo;
  const feasible = result.status === 'inserted' && (result.residualProp_kg || 0) >= 0;
  return { feasible, score: feasible ? (1e9 + result.residualProp_kg) : -errNorm, errNorm };
}

// cfg: same shape as ascentSimRun's cfg (minus v_kick/theta_kick/ltRate, which
// this function supplies from the search), PLUS cfg.target={periKm,apoKm,
// periTol?,apoTol?} (required — without a target every run is "infeasible"
// and the search degenerates to minimizing insertion error with no propellant
// signal, which is not a useful call for this function; SIM1's ascentSimRun
// remains the tool for a plain fixed-steering fly-until-depletion run).
// opts: {budget?, start?, steps?} — all optional, defaulting to the constants
// above.
function ascentSimOptimize(cfg, opts) {
  opts = opts || {};
  const budget = opts.budget != null ? opts.budget : ASCSIM_OPT_DEFAULT_BUDGET;
  const start = Object.assign({}, ASCSIM_OPT_DEFAULT_START, opts.start || {});
  const step = Object.assign({}, ASCSIM_OPT_DEFAULT_STEPS, opts.steps || {});
  const minStep = ASCSIM_OPT_MIN_STEPS;
  const dims = ['v_kick', 'theta_kick', 'ltRate'];

  let sims = 0;
  function evalPt(p) {
    sims++;
    const runCfg = Object.assign({}, cfg, { v_kick: p.v_kick, theta_kick: p.theta_kick, ltRate: p.ltRate });
    const r = ascentSimRun(runCfg);
    const sc = ascsimScoreOf(r, cfg.target);
    return { params: p, result: r, score: sc.score, feasible: sc.feasible };
  }

  let x = Object.assign({}, start);
  let best = evalPt(x);

  while (sims < budget) {
    let improvedThisRound = false;
    for (let di = 0; di < dims.length && sims < budget; di++) {
      const d = dims[di];
      for (let sign = 1; sign >= -1 && sims < budget; sign -= 2) {
        const cand = Object.assign({}, x);
        cand[d] = x[d] + sign * step[d];
        if (cand.v_kick < 0) continue;
        if (cand.theta_kick < 0 || cand.theta_kick > Math.PI / 2) continue;
        if (cand.ltRate < 0) continue;
        const evald = evalPt(cand);
        if (evald.score > best.score) {
          best = evald;
          x = cand;
          improvedThisRound = true;
        }
      }
    }
    if (!improvedThisRound) {
      dims.forEach((d) => { step[d] = step[d] / 2; });
      const allBelowFloor = dims.every((d) => step[d] < minStep[d]);
      if (allBelowFloor) break;
    }
  }

  return { params: x, result: best.result, feasible: best.feasible, score: best.score, simsRun: sims };
}

// ─── Payload bisection ──────────────────────────────────────────────────────
// Same bisection CONTRACT as lvMaxPayload (140-physics.js) — mirrored, NOT
// shared code (140 is frozen, per the hard invariant): binary search on
// payload for the boundary between feasible (optimizer finds an inserting
// trajectory, residual propellant >= 0) and infeasible.
//
// Runtime/determinism tradeoff (documented per the brief): re-running the
// FULL steering optimizer at every bisection step would be ~40 x 250 sims —
// too slow for the gate's runtime guard. Two mitigations, both deterministic:
//   (a) each bisection step SEEDS the pattern search from the previous
//       payload's best steering params (`lastParams`) instead of the fixed
//       default start — adjacent payloads have similar optimal steering, so
//       this converges in far fewer sims per step after the first;
//   (b) bisection steps run at a REDUCED inner budget (default 60 sims/step);
//       one FULL-budget optimizer polish runs once, at the end, at the found
//       payload boundary, so the returned optimizeResult/params reflect a
//       properly-converged search even though the intermediate bisection
//       steps didn't.
//
// cfg: {stages (base-bundle shape: {dry,prop,thrust,isp,res}, ALREADY
//   S1.5-expanded), fairingMass?, siteLat, azMin, azMax, targetIncDeg,
//   target:{periKm,apoKm,periTol?,apoTol?}, dragArea_m2?, dt?, tMax?}.
// opts: {bisectIters?(40), bisectBudget?(60), polishBudget?(200), kgTol?(5),
//   hiPayload_kg?(400000)}.
function ascentSimMaxPayload(cfg, opts) {
  opts = opts || {};
  const bisectIters = opts.bisectIters != null ? opts.bisectIters : 40;
  const bisectBudget = opts.bisectBudget != null ? opts.bisectBudget : 60;
  const polishBudget = opts.polishBudget != null ? opts.polishBudget : ASCSIM_OPT_DEFAULT_BUDGET;
  const kgTol = opts.kgTol != null ? opts.kgTol : 5;
  const hiPayload = opts.hiPayload_kg != null ? opts.hiPayload_kg : 400000;

  const stages = ascsimStagesFromBase(cfg.stages);
  // Fairing mass folded into the payload side (not jettisoned mid-ascent —
  // SIM3 handles fairing jettison per §27 sequencing). Small, documented
  // effect: this slightly UNDER-states max payload for vehicles with a large
  // fairing, since real fairing jettison sheds mass partway through ascent.
  const fairingExtra = cfg.fairingMass || 0;
  const v0t = ascentSimV0Tangential(cfg.siteLat, cfg.azMin, cfg.azMax, cfg.targetIncDeg);

  let lastParams = null;
  function feasibleAt(payload_kg, budget) {
    const runCfg = {
      stages,
      payload_kg: payload_kg + fairingExtra,
      v0_tangential: v0t,
      dragArea_m2: cfg.dragArea_m2,
      dt: cfg.dt,
      tMax: cfg.tMax,
      target: cfg.target,
    };
    const optOpts = { budget };
    if (lastParams) optOpts.start = lastParams;
    const opt = ascentSimOptimize(runCfg, optOpts);
    lastParams = opt.params;
    return opt;
  }

  let lo = 0, hi = hiPayload;
  const loOpt = feasibleAt(lo, bisectBudget);
  let simsTotal = loOpt.simsRun;
  let iterations = 0;
  for (let i = 0; i < bisectIters; i++) {
    const mid = (lo + hi) / 2;
    const opt = feasibleAt(mid, bisectBudget);
    simsTotal += opt.simsRun;
    iterations++;
    if (opt.feasible) lo = mid; else hi = mid;
    if (hi - lo < kgTol) break;
  }

  const finalOpt = feasibleAt(lo, polishBudget);
  simsTotal += finalOpt.simsRun;

  return {
    maxPayload_kg: lo,
    optimizeResult: finalOpt,
    feasible: finalOpt.feasible,
    iterations,
    simsTotal,
  };
}
