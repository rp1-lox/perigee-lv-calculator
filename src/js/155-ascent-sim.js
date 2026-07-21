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
// Fairing jettison rule (SIM3): shed the fairing once dynamic pressure has
// fallen below ASCSIM_FAIRING_Q AND the vehicle is above ASCSIM_FAIRING_ALT_M
// — the standard "fairing goes when aeroheating/q is negligible" gate. Both
// conditions are required so a still-dense low pass (q low only because speed
// is low) doesn't trigger a premature drop.
const ASCSIM_FAIRING_Q = 1000;       // Pa (dynamic pressure threshold)
const ASCSIM_FAIRING_ALT_M = 60000;  // m
// Minimum perigee (km) for a delivered-energy orbit to count as a usable orbit
// in the optimizer's feasibility test (a stable-orbit guard against an
// energy-correct but reentering ellipse). See ascsimScoreOf.
const ASCSIM_ORBIT_MIN_PERI = 100;

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

// ─── Boost steering law: VELOCITY-SCHEDULED PITCH PROGRAM ──────────────────
// SIM3 replaced SIM1/SIM2's "pitch kick then follow the velocity vector"
// gravity turn. That law feeds the flight-path angle back through the velocity
// vector, and at low relative speed the turn rate (~g/v) is enormous: a heavy,
// lower-TWR stack lingers at low speed right after the kick, over-rotates, goes
// horizontal by ~20 km, then sinks and crashes — while a light high-TWR stack
// with the SAME params stays steep and reaches orbit. That extreme TWR
// sensitivity (documented in the §27 SIM3 as-built note) is exactly why the
// SIM2 anchors would not converge.
//
// The replacement is an OPEN, velocity-scheduled program: pitch (from local
// horizontal) is a deterministic, monotonically-decreasing function of the
// relative airspeed — vertical below v_kick, then ramping down linearly at
// pitchRate (rad per m/s of speed past v_kick) toward horizontal, floored so it
// never commands a downward (into-the-ground) attitude in the boost. Because
// pitch depends only on speed (not on the fed-back flight-path angle) there is
// no low-speed instability and the same params behave consistently across the
// TWR range — the optimizer searches {v_kick, pitchRate} over a smooth basin.
//
// Speed is measured RELATIVE to the co-rotating atmosphere (subtracting the
// v0_tangential rotation credit scaled by R/r — the same convention
// ascsimDerivative uses for drag), NOT raw inertial velocity: the vehicle
// co-rotates with the pad at t=0, so relative speed correctly starts at 0.
// (This was a real SIM2 bug when it used inertial speed; kept fixed here.)
// The law is evaluated once per outer step and held across the RK4 substeps
// for determinism (same rationale as SIM1).
function ascsimPitch(state, t, cfg, steerCtx, RE_M) {
  const v0t = cfg.v0_tangential || 0;
  const vtRel = state.vt - v0t * (RE_M / state.r);
  const speed = Math.sqrt(state.vr * state.vr + vtRel * vtRel);
  const HALF_PI = Math.PI / 2;

  // Phase 1 — vertical rise until relative speed reaches v_kick.
  if (speed < cfg.v_kick) return HALF_PI;

  // Phase 2 — COMMANDED pitch schedule vs relative-speed fraction. A passive
  // "follow the velocity vector" gravity turn LOCKS the flight-path angle for a
  // high-TWR stack (thrust dwarfs gravity's perpendicular deflection), so the
  // vehicle flies near-vertical and lobs to apogee with almost no horizontal
  // velocity (the SIM2 finding). Actively COMMANDING the pitch down along a
  // schedule forces the turn regardless of TWR:
  //   pitch = pitchMax * (1 - (vrel / vTarget))^pitchExp   (clamped [floor, max])
  // pitch eases from ~vertical at low speed to horizontal as relative speed
  // approaches vTarget (~orbital), so the vehicle builds horizontal velocity
  // throughout the climb and arrives near orbital velocity as apogee reaches
  // target — an efficient direct ascent. {vTarget, pitchExp} shape the loss
  // trade and are what the optimizer searches (with v_kick). Relative velocity
  // (co-rotating frame) is used throughout (drag-convention note above).
  const vTarget = cfg.vTarget != null ? cfg.vTarget : 7800;
  const exp = cfg.pitchExp != null ? cfg.pitchExp : 1.0;
  const floor = cfg.pitchFloor != null ? cfg.pitchFloor : 0;
  let frac = speed / vTarget;
  if (frac > 1) frac = 1;
  let p = HALF_PI * Math.pow(1 - frac, exp);
  if (p < floor) p = floor;
  if (p > HALF_PI) p = HALF_PI;
  return p;
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
  // Sea-level thrust: SIM3 lets callers pass ctx.Fsl EXPLICITLY (booster-
  // combined phases blend a core + N booster groups, each with its own vac/SL
  // ratio, so a single ispSl/ispVac ratio can't express the total). When Fsl
  // is not supplied (every serial-stage step, i.e. all SIM1/SIM2 pins) it
  // falls back to the original Fvac*(ispSl/ispVac) expression — byte-identical
  // to pre-SIM3 behavior, so no serial-path pin moves.
  const Fsl = ctx.Fsl != null ? ctx.Fsl
    : (ctx.ispVac > 0 ? ctx.Fvac * (ctx.ispSl / ctx.ispVac) : ctx.Fvac);
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
    // SIM3 commanded boost pitch schedule (see ascsimPitch): vTarget = relative
    // speed (m/s) at which pitch reaches horizontal; pitchExp = schedule shape
    // exponent; pitchFloor = minimum boost pitch (rad). All optional (defaulted
    // in ascsimPitch). {vTarget, pitchExp} are the loss-shaping levers.
    vTarget: cfg.vTarget,
    pitchExp: cfg.pitchExp,
    pitchFloor: cfg.pitchFloor,
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
    // ─── SIM3 additions (all caller-owned pass-throughs, defaulted below) ────
    // profile: 'twoburn' (loft boost -> coast-to-apogee -> insertion burn — the
    //   convergence fix, DEFAULT whenever a target with a positive apogee is
    //   present) | 'direct' (SIM1/SIM2 single continuous burn with the
    //   in-loop insertion cutoff — kept available, and the ONLY mode when no
    //   target is supplied). Resolved in ascentSimRun.
    profile: cfg.profile,
    // apoMarginKm: extra apogee the boost phase overshoots the target by before
    //   cutoff, to compensate for the small apogee decay during the coast +
    //   the finite-burn sink at insertion. Default 0 (documented; near-zero at
    //   185 km where the coast is exoatmospheric).
    apoMarginKm: cfg.apoMarginKm != null ? cfg.apoMarginKm : 0,
    // coastCapS: hard cap on Phase-B coast duration (s) — a guard against a
    //   never-reached apogee (should not happen once boost cuts off with
    //   apogee already at target, but bounds the loop deterministically).
    coastCapS: cfg.coastCapS != null ? cfg.coastCapS : 3000,
    // apoHoldKp / apoHoldClamp: the closed-loop APOAPSIS-HOLD insertion steering
    //   (SIM3, the actual convergence fix — see the §27 as-built note). Once the
    //   boost has raised the osculating apogee to target, the vehicle keeps
    //   thrusting with a pitch (from local horizontal) proportional to the
    //   apogee error: pitch = clamp(apoHoldKp*(apoTarget - apoNow[km]),
    //   +-apoHoldClamp) rad. This PINS apogee at target (overshoot -> pitch
    //   goes negative and bleeds it back; undershoot -> pitch positive and
    //   lifts it) while the horizontal thrust component drives PERIAPSIS up to
    //   meet it — a robust 1-D closed loop, cutoff when perigee reaches target.
    apoHoldKp: cfg.apoHoldKp != null ? cfg.apoHoldKp : 0.012,  // rad per km apogee error
    apoHoldKd: cfg.apoHoldKd != null ? cfg.apoHoldKd : 0.0004, // rad per (m/s) vertical rate
    apoHoldClamp: cfg.apoHoldClamp != null ? cfg.apoHoldClamp : 0.6, // rad
    // booster: array of SI booster groups (ascsimBoostersFromBase output) that
    //   burn in PARALLEL with the core first stage (stageIdx 0). undefined/[]
    //   = no boosters (serial stack). Ground-lit only; air-lit refuses loudly.
    booster: cfg.booster,
    // fairingMass: dead mass (kg) carried until the documented jettison rule
    //   (q < ASCSIM_FAIRING_Q Pa AND altitude > ASCSIM_FAIRING_ALT_M) is met,
    //   then dropped once. undefined/0 = no fairing modeling.
    fairingMass: cfg.fairingMass || 0,
    // _trace: optional array; when present ascentSimRun pushes a per-step
    //   sample (debug/verification only, no effect on the trajectory).
    _trace: cfg._trace,
    // Terminal-guidance selector: cfg.apohold engages the closed-loop apoapsis-
    // hold insertion at cfg.apoholdFrac*apoTarget apogee (default 0.7) instead
    // of the direct energy cutoff — trades some steering loss for a
    // near-circular orbit.
    apohold: cfg.apohold,
    apoholdFrac: cfg.apoholdFrac,
    // ─── PEG terminal guidance (the critique-122 resolution) ─────────────────
    // PEG is the DEFAULT exoatmospheric guidance for a targeted run (positive
    // apogee target, no explicit profile, apohold off). The SIM3 energy-cutoff
    // / apoapsis-hold / coast machinery is kept as a FALLBACK, reachable via an
    // explicit profile ('twoburn'/'twoburn-coast') or apohold:true.
    //   pegHandoffKm: altitude (km) at which the atmospheric boost (velocity-
    //     scheduled pitch) hands off to PEG. Above ~50-60 km drag is negligible
    //     and PEG's small-angle vacuum formulation holds. Default 55.
    //   pegCycleS: PEG re-solve interval (s of sim time). Deterministic; PEG
    //     switches to per-step re-solves once time-to-go drops below one cycle,
    //     for a clean cutoff. Default 2.
    pegHandoffKm: cfg.pegHandoffKm != null ? cfg.pegHandoffKm : 55,
    pegCycleS: cfg.pegCycleS != null ? cfg.pegCycleS : 2,
  };
}

// ─── SIM3 booster state builder ─────────────────────────────────────────────
// cfg.booster is an array of SI groups (ascsimBoostersFromBase output):
//   {Fvac_N, isp_vac_s, isp_sl_s?, usableProp_kg, dryDrop_kg, mode, coreThrottle?, ignition?}
// SIM3 supports GROUND-LIT groups only (ignition 'ground'/absent). Air-lit
// ({after:i}/{atTime:s}) is REFUSED LOUDLY (throws) per §27 — silently
// mis-simulating an air-lit core/booster would be worse than refusing. modes:
// 'independent' (parallel, own tanks), 'throttle' (core throttled to
// coreThrottle while this group burns), 'crossfeed' (this group feeds the
// core's engines, preserving the core's own tanks) — mirroring 140's
// lvPerformance booster integrator, which is the ONE definition of these
// semantics (this is a per-dt re-expression of it, not a second dialect).
function ascsimBuildBoosters(booster) {
  const groups = (booster || []).filter(Boolean);
  return groups.map((g) => {
    const ign = g.ignition || 'ground';
    if (ign !== 'ground') {
      throw new Error('ascentSim: air-lit booster ignition (' + JSON.stringify(ign) +
        ') is not supported in SIM3 — ground-lit groups only (see §27).');
    }
    const isp = g.isp_vac_s || 1;
    const ispSl = g.isp_sl_s != null ? g.isp_sl_s : 0.9 * isp; // ground-lit -> 0.9x default
    const Fvac = g.Fvac_N || 0;
    return {
      Fvac, isp, ispSl, mdot: isp > 0 ? Fvac / (G0 * isp) : 0,
      prop: g.usableProp_kg || 0, dryDrop: g.dryDrop_kg || 0,
      mode: g.mode || 'independent',
      f: g.mode === 'throttle' ? Math.min(1, Math.max(0.1, g.coreThrottle != null ? g.coreThrottle : 1)) : 1,
      status: 'active', // ground-lit: burning from t=0
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PEG — Powered Explicit Guidance (2-DOF linear-tangent terminal guidance)
// ═══════════════════════════════════════════════════════════════════════════
// The SIM3 heuristic insertion (apoapsis-hold / energy cutoff) delivers the
// target ENERGY but leaves an eccentric orbit; forcing it circular costs
// 1200-2000 m/s of steering loss (critique 122). PEG replaces that heuristic
// with the published Shuttle-heritage optimal-control law: each guidance cycle
// it SOLVES the terminal boundary-value problem — find the linear-tangent
// steering coefficients (A,B) and time-to-go T that fly the state to the target
// circular orbit (r=r_T, v_r=0, v_t=sqrt(mu/r_T)) simultaneously. Because the
// steering is the solution of the two-point BVP (not a feedback heuristic), the
// thrust stays near-prograde and the orbit arrives circular with minimal loss.
//
// Formulation (2-DOF plane, small-angle linear-tangent):
//   The radial component of the thrust UNIT vector is f_r(t) = A + B*t (t=0 at
//   the guidance-cycle start). Tangential component f_t = sqrt(1-f_r^2). Radial
//   thrust acceleration ~= a(t)*f_r(t) to first order in the (small) pitch.
//   Thrust-acceleration moments b_k = integral_0^T t^k a(t) dt, composed across
//   ALL remaining SERIAL stages (each a constant-mdot segment a_i(s)=ve_i/(tau_i
//   - s), ve=g0*isp_vac, tau=m/mdot), give:
//     radial velocity gained by thrust  = A*b0 + B*b1
//     radial position gained by thrust  = A*c0 + B*c1,  c0=T*b0-b1, c1=T*b1-b2
//   Gravity/centrifugal enters through the effective radial acceleration
//   g_eff = mu/r^2 - v_t^2/r (net radial pull absent thrust; = 0 at the target
//   circular orbit). It is AVERAGED over the arc as the mean of its current
//   value and its terminal value (0 for the exact circular target), i.e.
//   g_eff_avg = g_eff_now/2 (documented averaging choice). The tangential
//   Coriolis term -v_r*v_t/r is averaged the same way (mean of now and 0).
//   Terminal constraints:
//     radial velocity : A*b0 + B*b1 = -v_r + g_eff_avg*T        (want v_r(T)=0)
//     radial position : A*c0 + B*c1 = r_T - r - v_r*T + g_eff_avg*T^2/2
//   Time-to-go from the velocity-to-gain magnitude closure: the total thrust dv
//   b0(T) must supply the whole velocity deficit, so b0(T) = |v_go(T)| with
//     v_go = [ v_tT - v_t + coriolis_avg*T ,  -v_r + g_eff_avg*T ]  (tang,rad).
//   b0 is monotone increasing in T and |v_go| is nearly flat, so T is found by
//   bisection over (0, T_burn_total] (deterministic, 50 iters; robust, avoids
//   FD-Jacobian noise per the repo's corrector philosophy). If even the full
//   remaining dv cannot meet |v_go| the burn is dv-insufficient (payload too
//   high) — T is pinned to the max and the run falls short (the optimizer/
//   bisection detects the miss). Boosters/atmosphere live BELOW the PEG handoff
//   (exoatmospheric, boosters long gone), so PEG composes only the serial upper
//   stages — parallel-booster thrust never needs composing (documented).

// Compose the thrust-acceleration moments b0,b1,b2 = integral_0^T t^k a(t) dt
// over the remaining serial-stage segments. remStages: [{ve,tau,burnTime}].
function ascsimPegMoments(remStages, T) {
  let b0 = 0, b1 = 0, b2 = 0, tOff = 0, remaining = T;
  for (let i = 0; i < remStages.length && remaining > 1e-9; i++) {
    const s = remStages[i];
    const dt = Math.min(s.burnTime, remaining);
    if (dt <= 1e-12) { tOff += s.burnTime; continue; }
    const ve = s.ve, tau = s.tau;
    const L = ve * Math.log(tau / Math.max(tau - dt, 1e-6)); // segment dv (b0 local)
    const J = tau * L - ve * dt;                              // integral s*a ds
    const Q = tau * J - ve * dt * dt / 2;                     // integral s^2*a ds
    b0 += L;
    b1 += tOff * L + J;
    b2 += tOff * tOff * L + 2 * tOff * J + Q;
    tOff += dt;
    remaining -= dt;
  }
  return { b0, b1, b2 };
}

// Build the remaining serial-stage segment list from the live sim state (the
// ONE place PEG derives future staging). Mirrors the integrator's mass
// bookkeeping exactly: burn usable propellant, then drop the stage's dry mass
// (reserve propellant rides up as it does in the integrator). usableFn = the
// run's usableProp closure.
function ascsimPegRemStages(stages, stageIdx, m, burnedThisStage, usableFn) {
  let mass = m;
  const rem = [];
  for (let i = stageIdx; i < stages.length; i++) {
    const st = stages[i];
    const ve = G0 * st.isp_vac_s;
    const mdot = st.isp_vac_s > 0 ? st.F_vac_N / ve : 0;
    const usable = usableFn(st);
    const propLeft = i === stageIdx ? Math.max(0, usable - burnedThisStage) : usable;
    if (mdot > 0 && propLeft > 1e-9) rem.push({ ve, tau: mass / mdot, burnTime: propLeft / mdot });
    mass = mass - propLeft - st.dry_kg;
  }
  return rem;
}

// Thrust-acceleration magnitude at elapsed time s into the remaining-stage
// sequence (ve/(tau - local time); 0 past the last stage). Used by the
// predicted-trajectory gravity integral below.
function ascsimPegThrustAccel(remStages, s) {
  let off = 0;
  for (let i = 0; i < remStages.length; i++) {
    const st = remStages[i];
    if (s < off + st.burnTime) return st.ve / Math.max(st.tau - (s - off), 1e-6);
    off += st.burnTime;
  }
  return 0;
}

// Predict the powered trajectory over [0,T] under gravity + thrust-along-primer
// and accumulate the GRAVITY velocity/position gained along the ACTUAL path:
//   vGrav = integral g(p(t)) dt ,  rGrav = integral (T-t) g(p(t)) dt
// (the position contribution of an acceleration at time t is weighted by T-t).
// This is the crux of a working long-arc PEG: the single trapezoidal
// current+terminal gravity average is only valid over a short near-apogee arc;
// a low-TWR direct ascent spends a long arc at varying radius/angle where the
// gravity vector both rotates and changes magnitude, and only integrating it
// along the predicted path keeps the guidance from diverging. Semi-implicit
// Euler, N sub-steps. Returns { vGrav, rGrav, Pend } (Pend = predicted terminal
// position, used for the terminal-direction target).
function ascsimPegPredict(P, V, remStages, lambda, lamDot, T, muSI, N) {
  let px = P[0], py = P[1], vx = V[0], vy = V[1];
  const dt = T / N;
  const vGrav = [0, 0], rGrav = [0, 0];
  for (let k = 0; k < N; k++) {
    const s = k * dt;
    const r = Math.hypot(px, py) || 1e-9;
    const gc = -muSI / (r * r * r);
    const gx = gc * px, gy = gc * py;
    vGrav[0] += gx * dt; vGrav[1] += gy * dt;
    rGrav[0] += (T - s) * gx * dt; rGrav[1] += (T - s) * gy * dt;
    const a = ascsimPegThrustAccel(remStages, s);
    let dx = lambda[0] + lamDot[0] * s, dy = lambda[1] + lamDot[1] * s;
    const dn = Math.hypot(dx, dy) || 1; dx /= dn; dy /= dn;
    vx += (gx + a * dx) * dt; vy += (gy + a * dy) * dt;
    px += vx * dt; py += vy * dt;
  }
  return { vGrav, rGrav, Pend: [px, py] };
}

// Solve the PEG terminal BVP in inertial Cartesian (direct ascent). Returns the
// primer vector lambda (unit thrust direction now) + its rate lamDot (kept
// perpendicular to lambda) + time-to-go T, or null (no burn time). The
// commanded thrust unit vector at cycle-elapsed s is lambda + lamDot*s
// (re-normalised). r_T = target circular radius (m). Outer fixed-point loop
// (deterministic, fixed iteration cap) alternately (a) predicts the trajectory
// to get the path gravity integral, (b) forms v_go/r_go, (c) updates T from the
// velocity-to-gain magnitude closure b0(T)=|v_go|, (d) updates lambda/lamDot.
function ascsimPegSolve(state, remStages, r_T, muSI, prev) {
  const r = state.r, theta = state.theta, vr = state.vr, vt = state.vt;
  const vt_T = Math.sqrt(muSI / r_T);
  const cth = Math.cos(theta), sth = Math.sin(theta);
  const P = [r * cth, r * sth];
  const V = [vr * cth - vt * sth, vr * sth + vt * cth];
  let Tmax = 0;
  for (let i = 0; i < remStages.length; i++) Tmax += remStages[i].burnTime;
  if (Tmax <= 1e-6) return null;
  const N = 24;
  // Seed lambda/lamDot/T from the previous cycle (warm start) or a prograde
  // guess; T seeded near the full remaining burn.
  let lambda = prev ? prev.lambda.slice() : [(-sth), (cth)]; // prograde-ish
  let lamDot = prev ? prev.lamDot.slice() : [0, 0];
  let T = prev ? Math.min(prev.T, Tmax) : Tmax * 0.9;
  let insufficient = false;
  for (let it = 0; it < 6; it++) {
    const pr = ascsimPegPredict(P, V, remStages, lambda, lamDot, T, muSI, N);
    // Terminal target direction from the predicted terminal position.
    const rn = Math.hypot(pr.Pend[0], pr.Pend[1]) || 1e-9;
    const urT = [pr.Pend[0] / rn, pr.Pend[1] / rn];
    const utT = [-urT[1], urT[0]];                 // prograde unit at terminal
    const P_T = [r_T * urT[0], r_T * urT[1]];
    const V_T = [vt_T * utT[0], vt_T * utT[1]];
    const v_go = [V_T[0] - V[0] - pr.vGrav[0], V_T[1] - V[1] - pr.vGrav[1]];
    const r_go = [P_T[0] - P[0] - V[0] * T - pr.rGrav[0], P_T[1] - P[1] - V[1] * T - pr.rGrav[1]];
    const vgoMag = Math.hypot(v_go[0], v_go[1]) || 1e-9;
    // Update T so the remaining thrust dv b0(T) supplies exactly |v_go|.
    const fOf = (TT) => ascsimPegMoments(remStages, TT).b0 - vgoMag;
    if (fOf(Tmax) < 0) { T = Tmax; insufficient = true; }
    else if (fOf(1e-3) > 0) { T = 1e-3; insufficient = false; }
    else {
      let lo = 1e-3, hi = Tmax; insufficient = false;
      for (let j = 0; j < 40; j++) { const mid = 0.5 * (lo + hi); if (fOf(mid) > 0) hi = mid; else lo = mid; }
      T = 0.5 * (lo + hi);
    }
    const mom = ascsimPegMoments(remStages, T);
    const b0 = mom.b0, b1 = mom.b1, b2 = mom.b2;
    const c0 = T * b0 - b1, c1 = T * b1 - b2;
    lambda = [v_go[0] / vgoMag, v_go[1] / vgoMag];
    lamDot = [0, 0];
    if (Math.abs(c1) > 1e-6) {
      lamDot = [(r_go[0] - c0 * lambda[0]) / c1, (r_go[1] - c0 * lambda[1]) / c1];
      const along = lamDot[0] * lambda[0] + lamDot[1] * lambda[1];
      lamDot = [lamDot[0] - along * lambda[0], lamDot[1] - along * lambda[1]];
    }
  }
  return { lambda, lamDot, T, insufficient };
}

function ascentSimRun(rawCfg) {
  const cfg = ascentSimDefaults(rawCfg);
  const MU_SI = MU * 1e9;   // m^3/s^2 (MU global is km^3/s^2 — see header)
  const RE_M = RE * 1000;   // m (RE global is km)

  // ─── Profile resolution ───────────────────────────────────────────────────
  // 'twoburn' is the default whenever an insertion target with a positive
  // apogee is present (the §27 SIM3 convergence fix); 'direct' otherwise or on
  // explicit request. With no target at all, phase 'direct' with no cutoff is
  // exactly the SIM1/SIM2 fly-to-depletion path (every SIM1 pin lands here).
  const hasApoTarget = !!(cfg.target && cfg.target.apoKm != null && cfg.target.apoKm > 0);
  // Three insertion profiles:
  //   'direct'       — SIM1/SIM2 single continuous burn + in-loop peri&apo
  //                    cutoff (the ONLY mode with no target; kept for the
  //                    mechanism pins). Explicit cfg.profile==='direct'.
  //   'twoburn-coast'— the spec's literal boost->ballistic-coast-to-apogee->
  //                    prograde-insertion. Available on explicit request; it
  //                    lobs near-vertical for high-TWR stacks (documented, see
  //                    §27 as-built), so it is NOT the default.
  //   'twoburn'      — DEFAULT for any positive-apogee target: gravity-turn
  //                    boost, then closed-loop APOAPSIS-HOLD steering that
  //                    thrusts to raise perigee while pinning apogee at target.
  //                    Robust + efficient (near-direct-ascent), converges where
  //                    SIM2's open-loop family could not.
  const twoBurnCoast = cfg.profile === 'twoburn-coast';
  //   'peg' — OPT-IN PEG optimal-control terminal guidance (atmospheric boost ->
  //           handoff -> direct-ascent PEG to the circular target). Implemented
  //           and available, but NOT the default: on the marginal, low-upper-
  //           stage-TWR anchor stacks it does not robustly reach a tight
  //           circular insertion (see docs/MATH.md §10.11 + critique 122 for the
  //           honest miss and the diagnostics), so the working SIM3 energy-
  //           cutoff / apoapsis-hold path remains the default. Selected only by
  //           an explicit cfg.profile==='peg'.
  const usePeg = cfg.profile === 'peg';
  const twoBurn = !usePeg && (cfg.profile === 'twoburn' || twoBurnCoast ||
    (cfg.profile !== 'direct' && hasApoTarget));

  const bstate = ascsimBuildBoosters(cfg.booster); // throws on air-lit
  const boosterInitMass = bstate.reduce((a, g) => a + g.prop + g.dryDrop, 0);

  let fairingRemaining = cfg.fairingMass || 0;
  const m0Total = cfg.payload_kg + fairingRemaining + boosterInitMass +
    cfg.stages.reduce((s, st) => s + st.dry_kg + st.prop_kg, 0);
  const dragArea = cfg.dragArea_m2 != null ? cfg.dragArea_m2 : ascsimDefaultDragArea(m0Total);

  const state = { r: RE_M, theta: 0, vr: 0, vt: cfg.v0_tangential };
  let m = m0Total;
  let t = 0;
  const dt = cfg.dt;

  let stageIdx = 0;
  let burnedThisStage = 0;   // core (serial-stage) propellant drained so far
  let mStageStart = m;
  let dvIdeal = 0;
  let status = 'timeout';
  let phase = (twoBurn || usePeg) ? 'boost' : 'direct';
  let coastStart = null;

  // Target circular radius for PEG (mean of the requested apsides — 185x185 ->
  // 185 km; a slightly elliptical target degrades gracefully to its mean).
  const rTargetM = cfg.target ? RE_M + (cfg.target.periKm + cfg.target.apoKm) / 2 * 1000 : 0;

  const steerCtx = { kicked: false, lastGtPitch: null, handoffDone: false, pitchHandoff: null, tHandoff: null, peg: null };

  let gravLoss = 0, dragLoss = 0, steerLoss = 0, thrustPowerIntegral = 0;

  function usableProp(st) { return st.prop_kg * (1 - (st.res_pct || 0) / 100); }
  function ispSlOf(st, idx) {
    if (st.isp_sl_s != null) return st.isp_sl_s;
    return idx === 0 ? 0.9 * st.isp_vac_s : st.isp_vac_s;
  }
  const apoTargetKm = cfg.target ? cfg.target.apoKm : null;
  const apoMarginKm = cfg.apoMarginKm || 0;

  // Fairing jettison: drop the fairing once q has fallen below threshold AND
  // the vehicle is above the altitude gate (both required — see the constants).
  function tryDropFairing() {
    if (fairingRemaining <= 0) return;
    const h = state.r - RE_M;
    if (h <= ASCSIM_FAIRING_ALT_M) return;
    const rho = ascsimRho(h);
    const v0t = cfg.v0_tangential || 0;
    const vtRel = state.vt - v0t * (RE_M / state.r);
    const vrel2 = state.vr * state.vr + vtRel * vtRel;
    const q = 0.5 * rho * vrel2;
    if (q < ASCSIM_FAIRING_Q) { m -= fairingRemaining; fairingRemaining = 0; }
  }

  while (t < cfg.tMax) {
    tryDropFairing();

    // ─── Phase B: unpowered coast to apogee ────────────────────────────────
    // Ballistic integration (thrust off, drag on) until the radial velocity
    // turns from climbing to falling (apogee) — then hand off to the insertion
    // burn. Deterministic apogee detection (vr crosses <= 0), capped duration.
    if (phase === 'coast') {
      const prevVr = state.vr;
      const ctx = { m, mdot: 0, Fvac: 0, Fsl: 0, ispVac: 1, ispSl: 1,
        pitch: 0, v0t: cfg.v0_tangential, dragArea, muSI: MU_SI, RE_M };
      const d0 = ascsimDerivative(state, ctx)._diag;
      dragLoss += (d0.D / m) * dt;
      const next = ascsimRk4Step({ r: state.r, theta: state.theta, vr: state.vr, vt: state.vt }, dt, ctx);
      state.r = next.r; state.theta = next.theta; state.vr = next.vr; state.vt = next.vt;
      t += dt;
      if (state.r < RE_M) { status = 'crash'; break; }
      // Reached true apogee (radial velocity turned over): hand to the
      // altitude-hold circularization burn. Starting from vr~=0 at the target
      // altitude is exactly the clean initial condition altitude-hold needs —
      // no residual vertical rate to fight, so it drives straight to circular.
      // Apogee reached (radial velocity turned over — or already non-positive
      // if we entered the coast at/after apogee): hand to the insertion burn.
      if (state.vr <= 0) { phase = usePeg ? 'peg' : (twoBurnCoast ? 'insert' : 'apohold'); steerCtx.peg = null; continue; }
      if (t - coastStart > cfg.coastCapS) { status = 'coastTimeout'; break; }
      continue;
    }

    // ─── Powered phases (boost / insert / direct): need an active core stage ─
    if (stageIdx >= cfg.stages.length) { status = 'depleted'; break; }
    const st = cfg.stages[stageIdx];
    const usable = usableProp(st);

    // Boosters attach ONLY to the core first stage (stageIdx 0). Active groups
    // = ground-lit groups with propellant left.
    const boostersHere = (stageIdx === 0);
    const actGroups = boostersHere ? bstate.filter((g) => g.status === 'active' && g.prop > 1e-6) : [];

    if (burnedThisStage >= usable) {
      // Core stage finished. Record its ideal dv (core-only; approximate when
      // boosters were attached — dvIdeal is a diagnostic, not a pinned number
      // for booster vehicles), jettison the core dry mass, and shed any booster
      // groups still physically attached (should be empty already for real
      // stacks; this guards the pathological core-empties-before-boosters case
      // by jettisoning their remaining mass so it can't ride up as ghost mass).
      dvIdeal += rocketEq(st.isp_vac_s, mStageStart, Math.max(1, mStageStart - usable));
      m -= st.dry_kg;
      if (boostersHere) {
        bstate.forEach((g) => { if (g.status === 'active') { m -= (g.prop + g.dryDrop); g.prop = 0; g.status = 'spent'; } });
      }
      stageIdx++;
      burnedThisStage = 0;
      mStageStart = m;
      if (stageIdx >= cfg.stages.length) { status = 'depleted'; break; }
      continue;
    }

    // ─── Propulsion for this step (serial core, or core + parallel boosters) ─
    const coreFvac = st.F_vac_N;
    const coreIsp = st.isp_vac_s;
    const coreFsl = st.F_vac_N * (ispSlOf(st, stageIdx) / (coreIsp || 1));
    const mdotCore0 = coreIsp > 0 ? coreFvac / (G0 * coreIsp) : 0;

    let Fvac, Fsl, mdotTotal, coreTankDrain, dtStep, eventGroup = null;
    if (actGroups.length) {
      // Blended core + boosters, mirroring 140's per-interval integrator.
      const thg = actGroups.filter((g) => g.mode === 'throttle');
      const xf = actGroups.filter((g) => g.mode === 'crossfeed');
      const f = thg.length ? Math.min.apply(null, thg.map((g) => g.f)) : 1;
      const coreThrVac = f * coreFvac, coreThrSl = f * coreFsl, coreMdot = f * mdotCore0;
      const coreFed = xf.length > 0;
      coreTankDrain = coreFed ? 0 : coreMdot;
      const per = coreFed ? coreMdot / xf.length : 0;
      Fvac = coreThrVac; Fsl = coreThrSl; mdotTotal = coreMdot;
      actGroups.forEach((g) => {
        Fvac += g.Fvac; Fsl += g.Fvac * (g.ispSl / (g.isp || 1)); mdotTotal += g.mdot;
        g._drain = g.mdot + (g.mode === 'crossfeed' ? per : 0);
      });
      // Next depletion event over the step: core tank empty (if draining), or
      // any active group empty. Clamp dt to it (exact mass conservation).
      dtStep = dt;
      if (coreTankDrain > 0) { const te = (usable - burnedThisStage) / coreTankDrain; if (te < dtStep) dtStep = te; }
      actGroups.forEach((g) => { const te = g.prop / g._drain; if (te < dtStep) { dtStep = te; eventGroup = g; } });
    } else {
      Fvac = coreFvac; Fsl = coreFsl; mdotTotal = mdotCore0; coreTankDrain = mdotCore0;
      dtStep = mdotCore0 > 0 ? Math.min(dt, (usable - burnedThisStage) / mdotCore0) : dt;
    }

    // ─── Steering ──────────────────────────────────────────────────────────
    // Boost/direct: the fixed open-loop law (ascsimPitch). Insert (Phase C):
    // thrust ALONG the current inertial velocity (prograde) — closed-loop
    // circularization; at apogee the velocity is ~horizontal, so this raises
    // perigee toward apogee. pitch_from_horizontal = atan2(vr, vt).
    let pitch;
    if (phase === 'peg') {
      // Re-solve the PEG BVP at the guidance-cycle interval; switch to per-step
      // re-solves once time-to-go falls below one cycle (clean cutoff). Between
      // re-solves the commanded radial thrust-unit component follows the stored
      // linear-tangent law f_r(t) = A + B*(t - t0).
      const pg0 = steerCtx.peg;
      const elapsed = pg0 ? (t - pg0.t0) : Infinity;
      const tgo0 = pg0 ? (pg0.T - elapsed) : 0;
      const needRecompute = !pg0 || elapsed >= cfg.pegCycleS || tgo0 < cfg.pegCycleS;
      if (needRecompute) {
        const remStages = ascsimPegRemStages(cfg.stages, stageIdx, m, burnedThisStage, usableProp);
        const sol = ascsimPegSolve(state, remStages, rTargetM, MU_SI, pg0);
        if (sol) steerCtx.peg = { lambda: sol.lambda, lamDot: sol.lamDot, T: sol.T, t0: t, insufficient: sol.insufficient };
      }
      const pg = steerCtx.peg;
      if (pg) {
        // Commanded inertial thrust unit vector: lambda + lamDot*(t - t0),
        // re-normalised. Project onto the CURRENT position basis (radial u_r,
        // prograde u_t) to get the sim's pitch-from-horizontal — this correctly
        // accounts for frame rotation between guidance cycles.
        const s = t - pg.t0;
        let fx = pg.lambda[0] + pg.lamDot[0] * s, fy = pg.lambda[1] + pg.lamDot[1] * s;
        const fn = Math.hypot(fx, fy) || 1e-9; fx /= fn; fy /= fn;
        const cth = Math.cos(state.theta), sth = Math.sin(state.theta);
        const fRad = fx * cth + fy * sth;        // component along u_r=(cos,sin)
        const fTan = fx * -sth + fy * cth;        // component along u_t=(-sin,cos)
        pitch = Math.atan2(fRad, fTan);
      } else {
        pitch = ascsimPitch(state, t, cfg, steerCtx, RE_M);
      }
    } else if (phase === 'insert') {
      pitch = Math.atan2(state.vr, Math.max(state.vt, 1e-9));
    } else if (phase === 'apohold') {
      // Closed-loop APOAPSIS-HOLD with vertical-rate damping (a PD law):
      //   pitch = Kp*(apoTarget - apoNow) - Kd*vr    (clamped)
      // The apogee-error term pins the osculating apogee at target (overshoot ->
      // pitch down and bleed it; undershoot -> pitch up and lift it); the -Kd*vr
      // term levels the residual climb the boost handed over (vr>0 -> pitch
      // down). When apogee sits on target and vr~0 the command is ~horizontal,
      // so nearly all thrust goes into HORIZONTAL velocity and perigee rises to
      // meet apogee — this is the standard "hold apoapsis" upper-stage guidance.
      // It is far more efficient than altitude-hold (which held the vehicle at a
      // fixed altitude with a large steady pitch, burning cosine) because the
      // steady-state command here is prograde. Cutoff is the energy trigger.
      const orbA = ascentSimOrbitOf(state, MU_SI, RE_M);
      let pc = cfg.apoHoldKp * (apoTargetKm - orbA.apoKm) - cfg.apoHoldKd * state.vr;
      if (pc > cfg.apoHoldClamp) pc = cfg.apoHoldClamp;
      if (pc < -cfg.apoHoldClamp) pc = -cfg.apoHoldClamp;
      pitch = pc;
    } else {
      pitch = ascsimPitch(state, t, cfg, steerCtx, RE_M);
    }

    // PEG: clamp the final step so the burn ends exactly at time-to-go (a clean,
    // near-circular cutoff rather than overshooting by up to a full step).
    if (phase === 'peg' && steerCtx.peg) {
      const tgo = steerCtx.peg.T - (t - steerCtx.peg.t0);
      if (tgo > 1e-9 && tgo < dtStep) dtStep = tgo;
    }

    const ctx = {
      m, mdot: mdotTotal, Fvac, Fsl, ispVac: coreIsp, ispSl: ispSlOf(st, stageIdx),
      pitch, v0t: cfg.v0_tangential, dragArea, muSI: MU_SI, RE_M,
    };

    // Loss quadrature (forward-Euler on the start-of-step derivative).
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
    m -= mdotTotal * dtStep;
    burnedThisStage += coreTankDrain * dtStep;
    // Drain booster tanks; a group that emptied this step separates (drop dry).
    if (actGroups.length) {
      actGroups.forEach((g) => { g.prop -= g._drain * dtStep; });
      if (eventGroup) { eventGroup.status = 'spent'; m -= eventGroup.dryDrop; eventGroup.prop = 0; }
    }
    t += dtStep;

    if (cfg._trace) cfg._trace.push({ t, h: (state.r - RE_M) / 1000, vr: state.vr, vt: state.vt,
      pitch, phase, stage: stageIdx, orb: ascentSimOrbitOf(state, MU_SI, RE_M) });

    if (state.r < RE_M) { status = 'crash'; break; }

    // ─── Phase transitions / cutoffs ───────────────────────────────────────
    if (phase === 'boost' && usePeg) {
      // Atmospheric boost -> PEG handoff. The velocity-scheduled gravity turn
      // (ascsimPitch) flies the drag-significant lower atmosphere; once above
      // the handoff altitude (drag negligible) PEG takes over the DIRECT ASCENT
      // to orbit — a continuous upper-stage burn, NOT a coast-to-apogee (a
      // low-TWR upper stage cannot circularise impulsively at apogee; it falls
      // before reaching orbital speed, so a direct ascent is both physical and
      // optimal). PEG's predicted-path gravity integral keeps the long powered
      // arc convergent. Boosters have separated by this altitude, so PEG
      // composes only the serial upper stages.
      const h = state.r - RE_M;
      if (h >= cfg.pegHandoffKm * 1000) { phase = 'peg'; steerCtx.peg = null; }
    } else if (phase === 'peg') {
      const pg = steerCtx.peg;
      const tgo = pg ? pg.T - (t - pg.t0) : Infinity;
      if (pg && tgo <= dtStep + 1e-9) {
        const orbCheck = ascentSimOrbitOf(state, MU_SI, RE_M);
        const periTol = cfg.target.periTol != null ? cfg.target.periTol : 2;
        const apoTol = cfg.target.apoTol != null ? cfg.target.apoTol : 5;
        status = (Math.abs(orbCheck.periKm - cfg.target.periKm) <= periTol &&
                  Math.abs(orbCheck.apoKm - cfg.target.apoKm) <= apoTol) ? 'inserted' : 'insertOffTol';
        break;
      }
    } else if (phase === 'boost') {
      const orb = ascentSimOrbitOf(state, MU_SI, RE_M);
      // DIRECT-ASCENT energy cutoff (default twoBurn). SIM2 established that the
      // continuous commanded-schedule ascent DOES reach orbit for these vehicles
      // (it hit ~189x491 for Saturn IB) — its only failure was hitting a tight
      // peri&apo tolerance with an open-loop cutoff. SIM3 keeps the efficient
      // continuous ascent (thrust along the schedule, minimal steering loss) but
      // cuts off on a MONOTONIC quantity: specific orbital energy reaching the
      // target circular orbit's energy. That fixes the semi-major axis — hence
      // the delivered ΔV and the payload-capacity accounting — EXACTLY to the
      // target, independent of the residual eccentricity (a low-TWR single-burn
      // ascent leaves the orbit somewhat elliptical; that is a guidance-fidelity
      // detail, not a payload-capacity error, since capacity is set by energy).
      // Feasibility (status 'inserted') additionally requires both apsides
      // within the caller's tolerance band — a generous band is an eccentricity
      // guard, a tight one demands near-circular insertion. twoBurnCoast keeps
      // the literal boost->coast->prograde profile for comparison.
      if (cfg.apohold && orb.apoKm >= (apoTargetKm * (cfg.apoholdFrac != null ? cfg.apoholdFrac : 0.7))) {
        phase = 'apohold';
      } else if (twoBurnCoast) {
        if (orb.apoKm >= apoTargetKm + apoMarginKm) { phase = 'coast'; coastStart = t; }
      } else if (cfg.target) {
        // DIRECT-ASCENT energy cutoff (default). SIM2 established the continuous
        // commanded-schedule ascent reaches orbit for these vehicles; SIM3 keeps
        // it (efficient — thrust close to the velocity vector, low steering
        // loss) and cuts off on the MONOTONIC specific orbital energy reaching
        // the target circular orbit's energy. This fixes the semi-major axis —
        // hence the delivered ΔV budget and the payload-CAPACITY accounting
        // (the same energy metric T-S targets) — EXACTLY, independent of the
        // orbit's residual eccentricity. Reaching target energy = 'inserted' if
        // both apsides are also within tolerance (near-circular), else
        // 'insertOffTol' (energy delivered, orbit still elliptical — a low-TWR
        // single-burn ascent leaves it so; a guidance-fidelity limitation, NOT a
        // capacity error). The optimizer/bisection treat BOTH as feasible (the
        // energy is what capacity depends on) but reward lower eccentricity.
        const aT = RE_M + (cfg.target.periKm + cfg.target.apoKm) / 2 * 1000;
        const epsT = -MU_SI / (2 * aT);
        const eps = (state.vr * state.vr + state.vt * state.vt) / 2 - MU_SI / state.r;
        if (eps >= epsT) {
          const periTol = cfg.target.periTol != null ? cfg.target.periTol : 2;
          const apoTol = cfg.target.apoTol != null ? cfg.target.apoTol : 5;
          status = (Math.abs(orb.periKm - cfg.target.periKm) <= periTol &&
                    Math.abs(orb.apoKm - cfg.target.apoKm) <= apoTol) ? 'inserted' : 'insertOffTol';
          break;
        }
      }
    } else if (phase === 'apohold' && cfg.target) {
      // Altitude-hold insertion cutoff — a MONOTONIC specific-energy trigger.
      // The both-apsides-in-tolerance window is only ~1-2 steps wide near
      // circular (apogee is hyper-sensitive to speed there) and gets stepped
      // over. Specific orbital energy eps = v^2/2 - mu/r instead rises smoothly
      // and monotonically under thrust, so "eps >= eps_target" (the target
      // orbit's energy) is a clean 1-D cutoff. altitude-hold has already driven
      // the orbit near-circular (vr~=0 at target altitude), so at the
      // energy-match the semi-major axis equals the target's and eccentricity
      // is small -> both apsides land near target. Status = whether they in
      // fact fall within tolerance.
      const aT = RE_M + (cfg.target.periKm + cfg.target.apoKm) / 2 * 1000;
      const epsT = -MU_SI / (2 * aT);
      const eps = (state.vr * state.vr + state.vt * state.vt) / 2 - MU_SI / state.r;
      if (eps >= epsT) {
        const orbCheck = ascentSimOrbitOf(state, MU_SI, RE_M);
        const periTol = cfg.target.periTol != null ? cfg.target.periTol : 2;
        const apoTol = cfg.target.apoTol != null ? cfg.target.apoTol : 5;
        status = (Math.abs(orbCheck.periKm - cfg.target.periKm) <= periTol &&
                  Math.abs(orbCheck.apoKm - cfg.target.apoKm) <= apoTol) ? 'inserted' : 'insertOffTol';
        break;
      }
    } else if ((phase === 'insert' || phase === 'direct') && cfg.target) {
      const orbCheck = ascentSimOrbitOf(state, MU_SI, RE_M);
      const periTol = cfg.target.periTol != null ? cfg.target.periTol : 2;
      const apoTol = cfg.target.apoTol != null ? cfg.target.apoTol : 5;
      if (phase === 'insert') {
        // Prograde insertion cutoff — MONOTONIC specific-energy trigger (same
        // rationale as the apohold cutoff above). Thrust is along the velocity
        // vector (set in the steering block), which is loss-free (no cosine
        // penalty) and near-horizontal from apogee, so it raises perigee
        // efficiently while the orbit's ENERGY climbs smoothly to the target's.
        // Cutting at eps >= eps_target fixes the semi-major axis (hence the
        // delivered ΔV and the payload-capacity accounting) exactly to the
        // target orbit; residual eccentricity from a finite-TWR single-pass
        // circularization is reported via the in/out-of-tolerance status.
        const aT = RE_M + (cfg.target.periKm + cfg.target.apoKm) / 2 * 1000;
        const epsT = -MU_SI / (2 * aT);
        const eps = (state.vr * state.vr + state.vt * state.vt) / 2 - MU_SI / state.r;
        if (eps >= epsT) {
          status = (Math.abs(orbCheck.periKm - cfg.target.periKm) <= periTol &&
                    Math.abs(orbCheck.apoKm - cfg.target.apoKm) <= apoTol) ? 'inserted' : 'insertOffTol';
          break;
        }
      } else {
        // 'direct' single-burn: only the FINAL stage may insert (SIM2 contract);
        // both apsides within tolerance simultaneously.
        if (stageIdx === cfg.stages.length - 1 &&
            Math.abs(orbCheck.periKm - cfg.target.periKm) <= periTol &&
            Math.abs(orbCheck.apoKm - cfg.target.apoKm) <= apoTol) {
          status = 'inserted';
          break;
        }
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
  // Any booster propellant still onboard (normally 0 — boosters deplete well
  // before insertion — but counted so a config that stages out with boosters
  // still attached doesn't report phantom margin).
  bstate.forEach((g) => { if (g.status === 'active') residualProp_kg += Math.max(0, g.prop); });

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

// ─── Booster-data adapter (one-definition rule) ─────────────────────────────
// Converts the base-bundle booster groups (165's base.boosterArg — the same
// {dry,prop,thrust(kN),isp,res,count,parallelMode?,coreThrottle?,ignition?}
// shape 140's lvPerformance consumes) into ascentSimRun's SI booster shape.
// This is the ONE place SIM3 does that unit conversion for boosters (kN -> N,
// per-unit -> group-total via count), exactly parallel to ascsimStagesFromBase
// for serial stages. Ground-lit only downstream (ascsimBuildBoosters throws on
// air-lit) — the field is passed through here so the refusal happens at run
// time with the real config, not silently dropped at the adapter.
function ascsimBoostersFromBase(boosterArg) {
  return (boosterArg || []).filter(Boolean).map((g) => {
    const n = g.count || 1;
    return {
      Fvac_N: (g.thrust || 0) * 1000 * n,
      isp_vac_s: g.isp || 1,
      isp_sl_s: g.isp_sl_s != null ? g.isp_sl_s : null,
      usableProp_kg: (g.prop || 0) * (1 - (g.res || 0) / 100) * n,
      dryDrop_kg: (g.dry || 0) * n,
      mode: g.parallelMode || 'independent',
      coreThrottle: g.coreThrottle,
      ignition: g.ignition || 'ground',
    };
  });
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
// SIM3 recalibration: with the two-burn (boost->coast->insert) profile, the
// steering params no longer decide FEASIBILITY (the closed-loop cutoffs do) —
// they only shape loss efficiency, so the good basin is a NORMAL gravity turn,
// not SIM2's extreme fast-flatten that tried (and failed) to force a
// single-burn insertion. Start = modest pitch kick + slow linear-tangent
// decay; the compass search refines from there against the residual-propellant
// objective. Empirically inside the good basin for all three §27 anchors.
// SIM3: the search space is the two parameters of the velocity-scheduled boost
// program — v_kick (relative speed to begin pitching over, m/s) and pitchRate
// (rad of pitch-down per m/s past v_kick). With the closed-loop apoapsis coast
// + altitude-hold insertion handling FEASIBILITY, these two only shape loss
// efficiency, and the basin is smooth (no TWR cliff), so a plain compass search
// converges reliably. Start/step calibrated against the §27 anchors.
const ASCSIM_OPT_DEFAULT_START = { vTarget: 4500, pitchExp: 1.8 };
const ASCSIM_OPT_DEFAULT_STEPS = { vTarget: 1000, pitchExp: 0.6 };
const ASCSIM_OPT_MIN_STEPS = { vTarget: 100, pitchExp: 0.08 };
const ASCSIM_OPT_DEFAULT_BUDGET = 120;

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
  // FEASIBILITY = the vehicle delivered the TARGET ORBITAL ENERGY (semi-major
  // axis) — i.e. reached the energy cutoff, status 'inserted' (also within
  // apsis tolerance) or 'insertOffTol' (energy delivered, orbit still
  // elliptical). Payload capacity is an energy question (T-S computes ΔV to the
  // circular orbit's energy likewise), so both count as feasible. Among
  // feasible points the score maximizes residual propellant (the bisection
  // objective) and, secondarily, rewards a tighter (less eccentric) orbit via a
  // small eccentricity-error term so the optimizer prefers near-circular
  // insertions where the propellant margin is equal. An additional stable-orbit
  // guard rejects a delivered-energy orbit whose perigee is so low it would
  // reenter (periKm < ASCSIM_ORBIT_MIN_PERI) — that is not a usable orbit.
  const reachedEnergy = result.status === 'inserted' || result.status === 'insertOffTol';
  const stable = result.finalOrbit && result.finalOrbit.periKm >= ASCSIM_ORBIT_MIN_PERI;
  if (reachedEnergy && stable && (result.residualProp_kg || 0) >= 0) {
    const dPeri = (result.finalOrbit.periKm - target.periKm) / periTol;
    const dApo = (result.finalOrbit.apoKm - target.apoKm) / apoTol;
    const eccPenalty = 5 * Math.sqrt(dPeri * dPeri + dApo * dApo); // kg-scale nudge
    return { feasible: true, score: 1e9 + result.residualProp_kg - eccPenalty, errNorm: 0 };
  }
  // Infeasible. A crashed / coast-timed-out run has a meaningless sub-surface
  // osculating orbit — strongly penalize it (below every real-orbit score) with
  // a mild altitude-reached nudge so the search climbs OUT of the crash basin.
  if (result.status === 'crash' || result.status === 'coastTimeout') {
    const apoReached = (result.finalOrbit && isFinite(result.finalOrbit.apoKm)) ? result.finalOrbit.apoKm : 0;
    return { feasible: false, score: -1e7 + Math.max(-5e6, Math.min(0, apoReached)), errNorm: Infinity };
  }
  // Reached a real (if energy-short or low-perigee) orbit: score by
  // tolerance-normalized apsis error so the search refines toward the target.
  const dPeri = (result.finalOrbit.periKm - target.periKm) / periTol;
  const dApo = (result.finalOrbit.apoKm - target.apoKm) / apoTol;
  const errNorm = dPeri * dPeri + dApo * dApo;
  return { feasible: false, score: -errNorm, errNorm };
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
  const dims = ['vTarget', 'pitchExp'];

  let sims = 0;
  function evalPt(p) {
    sims++;
    const runCfg = Object.assign({}, cfg, { vTarget: p.vTarget, pitchExp: p.pitchExp });
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
        if (cand.vTarget < 1000) continue;
        if (cand.pitchExp < 0.2) continue;
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
//   S1.5-expanded), boosterArg? (base-bundle booster groups), fairingMass?,
//   siteLat, azMin, azMax, targetIncDeg,
//   target:{periKm,apoKm,periTol?,apoTol?}, apoMarginKm?, dragArea_m2?, dt?,
//   tMax?}.
// opts: {bisectIters?(40), bisectBudget?(60), polishBudget?(200), kgTol?(5),
//   hiPayload_kg?(400000)}.
// SIM3: the insertion target carries a positive apogee, so ascentSimRun runs
// the two-burn (boost -> coast -> insert) profile automatically. Boosters/S1.5/
// fairing are all wired through here: stages must be ALREADY S1.5-expanded by
// the caller (the ONE boundary, stageExpandS15/_tsExpandStages), boosterArg is
// converted to SI here, and fairingMass is now MODELED as jettisonable mass
// (dropped mid-ascent per the q/altitude rule) rather than folded into payload.
function ascentSimMaxPayload(cfg, opts) {
  opts = opts || {};
  const bisectIters = opts.bisectIters != null ? opts.bisectIters : 40;
  const bisectBudget = opts.bisectBudget != null ? opts.bisectBudget : 60;
  const polishBudget = opts.polishBudget != null ? opts.polishBudget : ASCSIM_OPT_DEFAULT_BUDGET;
  const kgTol = opts.kgTol != null ? opts.kgTol : 5;
  const hiPayload = opts.hiPayload_kg != null ? opts.hiPayload_kg : 400000;

  const stages = ascsimStagesFromBase(cfg.stages);
  const booster = ascsimBoostersFromBase(cfg.boosterArg); // [] if no boosters
  const fairingMass = cfg.fairingMass || 0; // modeled as jettisonable (SIM3)
  const v0t = ascentSimV0Tangential(cfg.siteLat, cfg.azMin, cfg.azMax, cfg.targetIncDeg);

  let lastParams = null;
  function feasibleAt(payload_kg, budget) {
    const runCfg = {
      stages,
      booster,
      fairingMass,
      payload_kg: payload_kg,
      v0_tangential: v0t,
      dragArea_m2: cfg.dragArea_m2,
      apoMarginKm: cfg.apoMarginKm,
      dt: cfg.dt,
      tMax: cfg.tMax,
      target: cfg.target,
      gtAltKm: cfg.gtAltKm,
      apohold: cfg.apohold,
      apoholdFrac: cfg.apoholdFrac,
      // Forward the guidance profile so an opt-in profile (e.g. 'peg') is
      // actually exercised through the bisection; undefined keeps the default.
      profile: cfg.profile,
      pegHandoffKm: cfg.pegHandoffKm,
      pegCycleS: cfg.pegCycleS,
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
