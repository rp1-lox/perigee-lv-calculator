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
function ascsimPitch(state, t, cfg, steerCtx, RE_M) {
  const h = state.r - RE_M;
  const speed = Math.sqrt(state.vr * state.vr + state.vt * state.vt);

  if (!steerCtx.kicked) {
    if (speed >= cfg.v_kick) {
      steerCtx.kicked = true;
      steerCtx.lastGtPitch = Math.PI / 2 - cfg.theta_kick;
      return steerCtx.lastGtPitch;
    }
    return Math.PI / 2; // vertical
  }

  if (h < 60000) {
    let p;
    if (speed < 1e-3) {
      p = steerCtx.lastGtPitch != null ? steerCtx.lastGtPitch : Math.PI / 2;
    } else {
      // thrust along velocity vector; pitch_from_horizontal = angle of v
      // above local horizontal = atan2(radial component, tangential component)
      p = Math.atan2(state.vr, Math.max(state.vt, 1e-9));
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
//   dragArea_m2?, dt?, tMax?,
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
  }

  // Partial segment for a stage that was mid-burn when the loop stopped
  // (timeout/crash) — record the dv actually achieved on that stage.
  if (status !== 'depleted' && stageIdx < cfg.stages.length && burnedThisStage > 0) {
    dvIdeal += rocketEq(cfg.stages[stageIdx].isp_vac_s, mStageStart, mStageStart - burnedThisStage);
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
    // Diagnostic-only field (not in the §27 API list) kept for pin support:
    // integral of (thrust dot v)/m dt, i.e. the specific power thrust adds.
    // With no drag this must equal the specific-orbital-energy change.
    workDiag: { thrustPowerIntegral },
  };
}
