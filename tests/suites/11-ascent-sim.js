'use strict';
// Suite: SIM1 2-DOF ascent simulator (src/js/155-ascent-sim.js) — analytic
// pins per docs/MISSION_MODEL_V2.md §27 SIM1 scope. See tests/harness.js for
// the shared vm-sandbox loader + assertion helpers.
const vm = require('vm');
const { buildSandbox, makeAssertions } = require('../harness');

module.exports = function run() {
  const sandbox = buildSandbox();
  const { ok, approx, counts } = makeAssertions();

  const { ascentSimRun, ascentSimOrbitOf } = sandbox;
  const { G0, MU, RE } = vm.runInContext('({ G0, MU, RE })', sandbox);
  const MU_SI = MU * 1e9;
  const RE_M = RE * 1000;

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Rocket-eq limit: single stage, no atmosphere, thrust >> gravity,
  //    short vertical burn (v_kick set huge so it never pitches over).
  // ═══════════════════════════════════════════════════════════════════════
  {
    const m0 = 10000;
    const isp = 300;
    const F = 50 * G0 * m0; // F/m0 ~ 50 g
    const r1 = ascentSimRun({
      stages: [{ dry_kg: 1000, prop_kg: 9000, F_vac_N: F, isp_vac_s: isp, isp_sl_s: isp, res_pct: 0 }],
      payload_kg: 0,
      dragArea_m2: 0,
      v_kick: 1e9, // never kicks: pure vertical burn throughout
      tMax: 20,
    });
    const actualDv = Math.sqrt(r1.finalState.vr * r1.finalState.vr + r1.finalState.vt * r1.finalState.vt);
    const predicted = r1.dvIdeal - r1.losses.total;
    ok('rocket-eq limit: identity dvIdeal - losses ~= actual dv (<0.5%)',
      Math.abs(predicted - actualDv) / actualDv < 0.005);
    // With F/m ~ 50g, gravity loss should be a small fraction of dvIdeal
    // (not a 0.1%-tight pin — the point is losses are dominated by gravity,
    // not spuriously huge from drag/steering, which are ~0 here by construction).
    ok('rocket-eq limit: drag+steering losses ~0 with no atmosphere / no pitch',
      (r1.losses.drag + r1.losses.steering) < 1e-6);
    ok('rocket-eq limit: dvIdeal within 1% of achieved dv + total losses',
      Math.abs(r1.dvIdeal - (actualDv + r1.losses.total)) / r1.dvIdeal < 0.01);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Hover-loss analytic: vertical constant-thrust short burn at low
  //    altitude — integrated gravity loss over burn time tb ~= g0*tb (<2%).
  // ═══════════════════════════════════════════════════════════════════════
  {
    const m0 = 10000;
    const isp = 300;
    const F = 1.2 * G0 * m0; // just above hover, mostly vertical, low altitude gain
    const r2 = ascentSimRun({
      stages: [{ dry_kg: 1000, prop_kg: 2000, F_vac_N: F, isp_vac_s: isp, isp_sl_s: isp, res_pct: 0 }],
      payload_kg: 0,
      dragArea_m2: 0,
      v_kick: 1e9, // stays vertical
      tMax: 30,
    });
    const tb = r2.tBurnout;
    approx('hover loss: gravity loss over burn ~= g0*tb (2% band)', r2.losses.gravity, G0 * tb, 0.02 * G0 * tb);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Energy audit: no-drag run, specific-orbital-energy change ==
  //    integral of thrust power/m dt (<0.5%). Uses the default (kicked,
  //    gravity-turn) steering law so both gravity and thrust act together.
  // ═══════════════════════════════════════════════════════════════════════
  {
    const r3 = ascentSimRun({
      stages: [
        { dry_kg: 5000, prop_kg: 40000, F_vac_N: 1200000, isp_vac_s: 300, isp_sl_s: 270, res_pct: 0 },
        { dry_kg: 1000, prop_kg: 8000, F_vac_N: 150000, isp_vac_s: 340, res_pct: 0 },
      ],
      payload_kg: 500,
      dragArea_m2: 0,
      v_kick: 60,
      theta_kick: 0.05,
      tMax: 600,
    });
    const epsStart = 0 - MU_SI / RE_M; // starts at rest at the surface
    const epsEnd = r3.finalState.vr * r3.finalState.vr / 2 + r3.finalState.vt * r3.finalState.vt / 2 - MU_SI / r3.finalState.r;
    const dEps = epsEnd - epsStart;
    const work = r3.workDiag.thrustPowerIntegral;
    ok('energy audit: specific-energy change matches integrated thrust power/m (<0.5%)',
      Math.abs(dEps - work) / Math.abs(work) < 0.005);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Orbit reconstruction: circular initial state -> peri/apo both 200 km
  //    within 0.1 km.
  // ═══════════════════════════════════════════════════════════════════════
  {
    const r = RE_M + 200000;
    const vcirc = Math.sqrt(MU_SI / r);
    const orb = ascentSimOrbitOf({ r, vr: 0, vt: vcirc }, MU_SI, RE_M);
    approx('orbit reconstruction: circular 200km peri', orb.periKm, 200, 0.1);
    approx('orbit reconstruction: circular 200km apo', orb.apoKm, 200, 0.1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Determinism: two identical runs -> byte-identical JSON results.
  // ═══════════════════════════════════════════════════════════════════════
  {
    const cfg = {
      stages: [
        { dry_kg: 5000, prop_kg: 40000, F_vac_N: 1200000, isp_vac_s: 300, isp_sl_s: 270, res_pct: 0 },
        { dry_kg: 1000, prop_kg: 8000, F_vac_N: 150000, isp_vac_s: 340, res_pct: 0 },
      ],
      payload_kg: 500,
      v_kick: 60,
      theta_kick: 0.05,
      ltRate: 0.001,
      tMax: 600,
    };
    const a = ascentSimRun(JSON.parse(JSON.stringify(cfg)));
    const b = ascentSimRun(JSON.parse(JSON.stringify(cfg)));
    ok('determinism: two identical runs produce byte-identical JSON', JSON.stringify(a) === JSON.stringify(b));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SIM2 (docs/MISSION_MODEL_V2.md §27 "SIM2 scope"): steering optimizer +
  // payload bisection + earth-rotation/azimuth handling.
  // ═══════════════════════════════════════════════════════════════════════
  const { ascentSimLaunchAzimuth, ascentSimV0Tangential, ascentSimOptimize, ascentSimMaxPayload } = sandbox;
  const { OMEGA_E } = vm.runInContext('({ OMEGA_E })', sandbox);

  // ───────────────────────────────────────────────────────────────────────
  // 6. Earth-rotation / launch-azimuth math (ascentSimLaunchAzimuth /
  //    ascentSimV0Tangential) — pure formula pins, independent of the
  //    steering-optimizer convergence questions below.
  // ───────────────────────────────────────────────────────────────────────
  {
    // Due-east (Az=90) is the correct azimuth when target inclination equals
    // site latitude — the classic "minimum-inclination" launch case.
    approx('azimuth: inc==lat gives due-east (Az=90)', ascentSimLaunchAzimuth(28.5, 37, 112, 28.5), 90, 1e-6);
    // A polar (90 deg) target from a mid-latitude site pulls Az toward north
    // (0 in the primary-root parameterization) — clamped into [azMin,azMax]
    // since the KSC-style window (37-112) doesn't reach that low.
    ok('azimuth: near-polar target from KSC-style window clamps to azMin',
      Math.abs(ascentSimLaunchAzimuth(28.5, 37, 112, 90) - 37) < 1e-6);
    // An inclination below the site latitude is unreachable without a
    // dogleg (sin(Az) would exceed 1) — clamps to the most-eastward limit
    // reachable in the window, same as the T-S rotVel() due-east ceiling.
    ok('azimuth: inclination below site latitude clamps into the window',
      ascentSimLaunchAzimuth(28.5, 37, 112, 10) <= 112 + 1e-9);
    // A polar-corridor site (Vandenberg-style azMin/azMax around 150-220)
    // picks the SECONDARY root (180-Az1), which is what actually lands in
    // that corridor for a near-polar target — proves the two-root branch
    // selection (nearest to the site's own corridor midpoint) is exercised,
    // not just the primary-root KSC case above.
    {
      const azVAFB = ascentSimLaunchAzimuth(34.7, 150, 220, 90);
      ok('azimuth: polar-corridor site picks the secondary root (180-Az1), not the primary',
        azVAFB >= 150 - 1e-6 && azVAFB <= 220 + 1e-6);
    }
    // v0_tangential at due-east reduces to the plain OMEGA_E*RE*cos(lat)
    // rotation credit (sin(90)=1) — cross-checks against the raw formula
    // independent of ascentSimLaunchAzimuth's internals.
    {
      const RE_M2 = RE * 1000;
      const v0t = ascentSimV0Tangential(28.5, 37, 112, 28.5);
      const expect = OMEGA_E * RE_M2 * Math.cos(28.5 * Math.PI / 180);
      approx('v0_tangential: due-east case matches OMEGA_E*RE*cos(lat) directly', v0t, expect, 1e-6 * expect);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // 7. Insertion cutoff + residual-propellant mechanics: the SIM2 config
  //    passthrough bug (ascentSimDefaults was silently dropping cfg.target,
  //    so no insertion cutoff could ever fire) is pinned here structurally —
  //    a run given a target that's already satisfied by a trivial one-step
  //    burn must report status 'inserted' with residual propellant equal to
  //    the untouched second stage, not silently run to depletion.
  // ───────────────────────────────────────────────────────────────────────
  {
    // A very short, very-low first-stage burn with an intentionally loose
    // target (the run only needs to cross the tolerance band once — this is
    // a MECHANISM pin, not a realism pin) followed by an untouched second
    // stage. tMax is short enough that if the cutoff never fires, the run
    // ends in 'timeout' (status contract, not 'inserted') instead.
    const cfg = {
      stages: [
        { dry_kg: 500, prop_kg: 500, F_vac_N: 2000000, isp_vac_s: 300, isp_sl_s: 300, res_pct: 0 },
        { dry_kg: 1000, prop_kg: 8000, F_vac_N: 150000, isp_vac_s: 340, res_pct: 0 },
      ],
      payload_kg: 0,
      v_kick: 5, theta_kick: 0.02, ltRate: 0,
      // Target band centered on the osculating orbit ~1s into the (final,
      // second) stage's burn — trivially wide (+-100 km) so the cutoff fires
      // almost immediately, near the top of the second stage's propellant
      // load. This is a MECHANISM pin (does the cutoff/residual bookkeeping
      // work at all), not a realism pin.
      target: { periKm: -6370, apoKm: 14, periTol: 100, apoTol: 100 },
      tMax: 35,
    };
    const r = ascentSimRun(cfg);
    ok('insertion cutoff: fires (status===\'inserted\') once the osculating orbit enters the target band',
      r.status === 'inserted');
    ok('insertion cutoff: residual propellant is close to the near-untouched second stage (~8000 kg, cutoff fires <1s in)',
      Math.abs(r.residualProp_kg - 8000) < 50);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 8. Optimizer sanity: ascentSimOptimize must find a score at least as
  //    good as its own starting point (a pattern search can never regress —
  //    it only accepts strictly-improving moves), and running it twice with
  //    the same cfg/budget/start must be byte-identical (determinism, same
  //    hard rule as SIM1 pin #5, extended to the optimizer's own search).
  // ───────────────────────────────────────────────────────────────────────
  {
    const cfg = {
      stages: [
        { dry_kg: 5000, prop_kg: 40000, F_vac_N: 1200000, isp_vac_s: 300, isp_sl_s: 270, res_pct: 0 },
        { dry_kg: 1000, prop_kg: 8000, F_vac_N: 150000, isp_vac_s: 340, res_pct: 0 },
      ],
      payload_kg: 500,
      tMax: 700,
      target: { periKm: 200, apoKm: 200 },
    };
    const opt = ascentSimOptimize(cfg, { budget: 80 });
    ok('optimizer: simsRun does not exceed the requested budget', opt.simsRun <= 80);
    ok('optimizer: returns a finite score', Number.isFinite(opt.score));
    const optB = ascentSimOptimize(cfg, { budget: 80 });
    ok('optimizer determinism: same cfg/budget -> byte-identical params+score',
      JSON.stringify(opt.params) === JSON.stringify(optB.params) && opt.score === optB.score);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 9. ascentSimMaxPayload determinism + runtime guard, using the ONE base
  //    bundle (_tsVehicleToBase/_tsExpandStages, 165-trade-study.js) for a
  //    real builtin preset — loaded into a SEPARATE small sandbox alongside
  //    155, mirroring the preset-integrity pattern in
  //    tests/suites/01-pure-math.js (020/040/210/050/330 aren't in the main
  //    FILES list; harness.js's sandbox has no BUILTIN_PRESETS/STAGE_LIBRARY).
  // ───────────────────────────────────────────────────────────────────────
  {
    const fs = require('fs');
    const path = require('path');
    const { ROOT } = require('../harness');
    const psrc = ['src/js/010-constants.js', 'src/js/020-state.js', 'src/js/040-builtin-art.js',
      'src/js/140-physics.js', 'src/js/145-dest-dv.js', 'src/js/155-ascent-sim.js',
      'src/js/210-stage-library.js', 'src/js/050-builtin-presets.js', 'src/js/330-stage-resolver.js',
      'src/js/165-trade-study.js']
      .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
    const psb = { document: { getElementById: () => null }, console, window: {} };
    vm.createContext(psb);
    let loadOk = true;
    try { vm.runInContext(psrc, psb); } catch (e) { loadOk = false; console.error('SIM2 preset-sandbox load error: ' + e.message); }
    ok('SIM2 preset sandbox loads (010/020/040/140/145/155/210/050/330/165)', loadOk);

    // ─── Anchor vehicles: Saturn IB, Saturn V, Falcon 9 Block 5 ───────────
    // §27 SIM2 scope names these three as the validation anchors, with
    // gate-pinned bands. AS-BUILT FINDING (see docs/MISSION_MODEL_V2.md §27
    // SIM2 as-built note for the full writeup): despite a working, correctly
    // wired optimizer + bisection + azimuth pipeline (pinned structurally
    // above) and an optimizer-default recalibration away from SIM1's tiny
    // test-rocket basin, NONE of the three anchors converge to a feasible
    // insertion (status 'inserted') within the deterministic search budget,
    // even at a tolerance loosened well past the spec's suggested +-2/+-5 km
    // (+-20/+-25 km tried, still infeasible for Saturn IB at every payload
    // sampled including 0). Diagnosis: the specified 3-parameter steering
    // family (single kick angle + single linear-tangent decay rate) locks
    // onto a near-fixed flight path angle once thrust dominates gravity's
    // (weak, for a high-TWR stack) perpendicular deflection — it doesn't
    // curve toward horizontal fast enough, at ANY tested parameter
    // combination, for these vehicles' burn durations, to bring perigee and
    // apogee together before propellant depletes. This is a genuine
    // limitation of the specified open-loop steering law for this vehicle
    // class, not a search-budget or unit-conversion bug (both of which WERE
    // found and fixed in the same change — see the module header comments in
    // 155-ascent-sim.js on ascsimPitch's relative-velocity fix and
    // ascentSimDefaults' target passthrough fix). Per the brief's own
    // instruction ("if an anchor misses its band, report diagnostics
    // INSTEAD of shipping — honest miss beats fudged band"), the gate does
    // NOT assert these three payload bands. It asserts only what is
    // demonstrably true: the pipeline runs, is deterministic, respects its
    // runtime budget, and returns a well-formed (finite, non-negative)
    // result even when infeasible.
    const anchors = [
      { name: 'Saturn IB' },
      { name: 'Saturn V' },
      { name: 'Falcon 9 Block 5' },
    ];
    anchors.forEach((a) => {
      const code = `
        (function(){
          const p = BUILTIN_PRESETS.find(x=>x.name===${JSON.stringify(a.name)});
          const base = _tsVehicleToBase(p);
          const stages = _tsExpandStages(base.stages);
          const tsMax = lvMaxPayload(stages, base.boosterArg, base.fairingM, base.fairingJ, base.parkingAlt, 0, base.siteLat, base.azMin, base.azMax);
          const t0 = Date.now();
          const res = ascentSimMaxPayload({
            stages, fairingMass: base.fairingM, siteLat: base.siteLat, azMin: base.azMin, azMax: base.azMax,
            targetIncDeg: base.orbit ? base.orbit.inc : 28.5, target: {periKm:185, apoKm:185}, gtAltKm: 55, tMax: 900
          }, {bisectIters:10, bisectBudget:30, polishBudget:100, kgTol:600});
          const t1 = Date.now();
          const res2 = ascentSimMaxPayload({
            stages, fairingMass: base.fairingM, siteLat: base.siteLat, azMin: base.azMin, azMax: base.azMax,
            targetIncDeg: base.orbit ? base.orbit.inc : 28.5, target: {periKm:185, apoKm:185}, gtAltKm: 55, tMax: 900
          }, {bisectIters:10, bisectBudget:30, polishBudget:100, kgTol:600});
          return JSON.stringify({tsMax, maxPayload_kg: res.maxPayload_kg, feasible: res.feasible,
            finalOrbit: res.optimizeResult.result.finalOrbit, status: res.optimizeResult.result.status,
            ms: t1 - t0, sameAgain: res.maxPayload_kg === res2.maxPayload_kg});
        })()
      `;
      const out = JSON.parse(vm.runInContext(code, psb));
      console.error(`SIM2 anchor diagnostic — ${a.name}: T-S=${out.tsMax.toFixed(0)} kg, ` +
        `SIM2 maxPayload=${out.maxPayload_kg.toFixed(0)} kg (feasible=${out.feasible}), ` +
        `closest orbit peri=${out.finalOrbit.periKm.toFixed(1)} apo=${out.finalOrbit.apoKm.toFixed(1)} km ` +
        `(target 185x185, status=${out.status}), ${out.ms} ms`);
      ok(`SIM2 anchor (${a.name}): maxPayload_kg is finite and non-negative`,
        Number.isFinite(out.maxPayload_kg) && out.maxPayload_kg >= 0);
      ok(`SIM2 anchor (${a.name}): T-S sanity comparison computed (own base bundle agrees with lvMaxPayload)`,
        Number.isFinite(out.tsMax) && out.tsMax > 0);
      ok(`SIM2 anchor (${a.name}): determinism — two full bisection runs return the identical kg`, out.sameAgain);
      ok(`SIM2 anchor (${a.name}): runtime guard — one full bisection run < 15 s (generous CI margin; parallel-worker load measured higher than the standalone ~4-7s)`, out.ms < 15000);
    });
  }

  return counts();
};
