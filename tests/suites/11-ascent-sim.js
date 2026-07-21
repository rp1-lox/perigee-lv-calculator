'use strict';
// Suite: 2-DOF ascent simulator (src/js/155-ascent-sim.js).
//  - SIM1 analytic pins (rocket-eq limit, hover loss, energy audit, orbit
//    reconstruction, determinism) — pure physics identities, unchanged.
//  - SIM2 earth-rotation / launch-azimuth formula pins.
//  - SIM3 machinery pins: two-burn/closed-loop guidance reaches a STABLE orbit
//    of the target ORBITAL ENERGY, booster groups (parallel thrust + drop),
//    S1.5 expansion boundary, fairing jettison, air-lit refusal, direct-mode
//    insertion cutoff, and per-anchor determinism / finiteness / runtime.
// See docs/MISSION_MODEL_V2.md §27 (SIM3 as-built) for the guidance design and
// the HONEST anchor-band finding: the sim delivers the target orbital ENERGY
// but a heuristic closed-loop insertion leaves residual eccentricity, so the
// max-payload-to-a-circular-orbit numbers land BELOW the §27 payload bands.
// Per the brief the gate therefore does NOT assert those bands — it pins what
// is demonstrably true (the machinery), mirroring the SIM2 honest-miss policy.
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
    ok('rocket-eq limit: drag+steering losses ~0 with no atmosphere / no pitch',
      (r1.losses.drag + r1.losses.steering) < 1e-6);
    ok('rocket-eq limit: dvIdeal within 1% of achieved dv + total losses',
      Math.abs(r1.dvIdeal - (actualDv + r1.losses.total)) / r1.dvIdeal < 0.01);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Hover-loss analytic: vertical constant-thrust short burn — integrated
  //    gravity loss over burn time tb ~= g0*tb (<2%).
  // ═══════════════════════════════════════════════════════════════════════
  {
    const m0 = 10000;
    const isp = 300;
    const F = 1.2 * G0 * m0;
    const r2 = ascentSimRun({
      stages: [{ dry_kg: 1000, prop_kg: 2000, F_vac_N: F, isp_vac_s: isp, isp_sl_s: isp, res_pct: 0 }],
      payload_kg: 0, dragArea_m2: 0, v_kick: 1e9, tMax: 30,
    });
    const tb = r2.tBurnout;
    approx('hover loss: gravity loss over burn ~= g0*tb (2% band)', r2.losses.gravity, G0 * tb, 0.02 * G0 * tb);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Energy audit: no-drag run, specific-orbital-energy change == integral
  //    of thrust power/m dt (<0.5%). A physics identity, independent of the
  //    steering law (so it still holds for the SIM3 pitch schedule).
  // ═══════════════════════════════════════════════════════════════════════
  {
    const r3 = ascentSimRun({
      stages: [
        { dry_kg: 5000, prop_kg: 40000, F_vac_N: 1200000, isp_vac_s: 300, isp_sl_s: 270, res_pct: 0 },
        { dry_kg: 1000, prop_kg: 8000, F_vac_N: 150000, isp_vac_s: 340, res_pct: 0 },
      ],
      payload_kg: 500, dragArea_m2: 0, v_kick: 60, theta_kick: 0.05, tMax: 600,
    });
    const epsStart = 0 - MU_SI / RE_M;
    const epsEnd = r3.finalState.vr * r3.finalState.vr / 2 + r3.finalState.vt * r3.finalState.vt / 2 - MU_SI / r3.finalState.r;
    const dEps = epsEnd - epsStart;
    const work = r3.workDiag.thrustPowerIntegral;
    ok('energy audit: specific-energy change matches integrated thrust power/m (<0.5%)',
      Math.abs(dEps - work) / Math.abs(work) < 0.005);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Orbit reconstruction: circular initial state -> peri/apo both 200 km.
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
      payload_kg: 500, v_kick: 60, theta_kick: 0.05, ltRate: 0.001, tMax: 600,
    };
    const a = ascentSimRun(JSON.parse(JSON.stringify(cfg)));
    const b = ascentSimRun(JSON.parse(JSON.stringify(cfg)));
    ok('determinism: two identical runs produce byte-identical JSON', JSON.stringify(a) === JSON.stringify(b));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SIM2: earth-rotation / launch-azimuth formula pins.
  // ═══════════════════════════════════════════════════════════════════════
  const { ascentSimLaunchAzimuth, ascentSimV0Tangential, ascentSimOptimize, ascentSimMaxPayload } = sandbox;
  const { OMEGA_E } = vm.runInContext('({ OMEGA_E })', sandbox);
  {
    approx('azimuth: inc==lat gives due-east (Az=90)', ascentSimLaunchAzimuth(28.5, 37, 112, 28.5), 90, 1e-6);
    ok('azimuth: near-polar target from KSC-style window clamps to azMin',
      Math.abs(ascentSimLaunchAzimuth(28.5, 37, 112, 90) - 37) < 1e-6);
    ok('azimuth: inclination below site latitude clamps into the window',
      ascentSimLaunchAzimuth(28.5, 37, 112, 10) <= 112 + 1e-9);
    {
      const azVAFB = ascentSimLaunchAzimuth(34.7, 150, 220, 90);
      ok('azimuth: polar-corridor site picks the secondary root (180-Az1), not the primary',
        azVAFB >= 150 - 1e-6 && azVAFB <= 220 + 1e-6);
    }
    {
      const RE_M2 = RE * 1000;
      const v0t = ascentSimV0Tangential(28.5, 37, 112, 28.5);
      const expect = OMEGA_E * RE_M2 * Math.cos(28.5 * Math.PI / 180);
      approx('v0_tangential: due-east case matches OMEGA_E*RE*cos(lat) directly', v0t, expect, 1e-6 * expect);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. SIM3 direct-ascent ENERGY cutoff mechanism. A run whose target orbital
  //    energy is reached mid-final-stage must stop with status 'inserted' or
  //    'insertOffTol' (energy delivered) and report the correct residual
  //    propellant (unburned final-stage + never-lit stages), NOT run to
  //    depletion. Uses the default two-burn path (boost + energy cutoff) with a
  //    deliberately low-energy target so the cutoff fires early in stage 1.
  // ═══════════════════════════════════════════════════════════════════════
  {
    const stages = [
      { dry_kg: 3000, prop_kg: 90000, F_vac_N: 2500000, isp_vac_s: 380, isp_sl_s: 360, res_pct: 0 },
      { dry_kg: 1000, prop_kg: 8000, F_vac_N: 150000, isp_vac_s: 340, res_pct: 0 },
    ];
    const totalProp = 90000 + 8000;
    const r = ascentSimRun({
      stages, payload_kg: 0, v_kick: 55, vTarget: 6000, pitchExp: 2.5,
      target: { periKm: 150, apoKm: 150, periTol: 400, apoTol: 400 }, tMax: 900,
    });
    ok('SIM3 energy cutoff: fires (status inserted/insertOffTol) once target orbital energy is reached',
      r.status === 'inserted' || r.status === 'insertOffTol');
    // Cut off before depletion (energy reached), so there is UNBURNED propellant
    // left and the residual bookkeeping is a positive fraction of the total.
    ok('SIM3 energy cutoff: reports positive residual propellant (cut off before depletion)',
      r.residualProp_kg > 0 && Number.isFinite(r.residualProp_kg) && r.residualProp_kg < totalProp);
    // mFinal must reconcile with the residual: final mass = remaining dry mass
    // of the current+later stages + residual propellant (all pure bookkeeping).
    ok('SIM3 energy cutoff: mFinal reconciles with residual propellant (mFinal = dry-left + residual)',
      Math.abs(r.mFinal - (1000 + r.residualProp_kg)) < 1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Optimizer sanity + determinism (searches {vTarget, pitchExp}).
  // ═══════════════════════════════════════════════════════════════════════
  {
    const cfg = {
      stages: [
        { dry_kg: 5000, prop_kg: 40000, F_vac_N: 1200000, isp_vac_s: 300, isp_sl_s: 270, res_pct: 0 },
        { dry_kg: 1000, prop_kg: 8000, F_vac_N: 150000, isp_vac_s: 340, res_pct: 0 },
      ],
      payload_kg: 500, tMax: 900,
      target: { periKm: 185, apoKm: 185, periTol: 25, apoTol: 40 },
    };
    const opt = ascentSimOptimize(cfg, { budget: 60 });
    ok('optimizer: simsRun does not exceed the requested budget', opt.simsRun <= 60);
    ok('optimizer: returns a finite score', Number.isFinite(opt.score));
    const optB = ascentSimOptimize(cfg, { budget: 60 });
    ok('optimizer determinism: same cfg/budget -> byte-identical params+score',
      JSON.stringify(opt.params) === JSON.stringify(optB.params) && opt.score === optB.score);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 9. SIM3 machinery: boosters (parallel thrust + drop), S1.5 expansion
  //    boundary, fairing jettison, air-lit refusal. Loaded in a small preset
  //    sandbox (mirrors the preset-integrity pattern in 01-pure-math.js).
  // ═══════════════════════════════════════════════════════════════════════
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
    try { vm.runInContext(psrc, psb); } catch (e) { loadOk = false; console.error('SIM3 preset-sandbox load error: ' + e.message); }
    ok('SIM3 preset sandbox loads (010/020/040/140/145/155/210/050/330/165)', loadOk);

    // ── Booster adapter: Atlas V 551's 5 SRBs -> one SI group, thrust in N ──
    {
      const g = JSON.parse(vm.runInContext(
        `JSON.stringify(ascsimBoostersFromBase(_tsVehicleToBase(BUILTIN_PRESETS.find(x=>x.name==='Atlas V 551')).boosterArg))`, psb));
      ok('SIM3 booster adapter: Atlas V 551 yields a ground-lit SI group with positive thrust+prop',
        g.length === 1 && g[0].Fvac_N > 0 && g[0].usableProp_kg > 0 && (g[0].ignition || 'ground') === 'ground');
    }

    // ── Booster mass accounting: a ground-lit booster group is carried at
    //    liftoff and dropped when spent. Compare initial mass and confirm a run
    //    completes (reaches a terminal status, doesn't throw/hang). ──
    {
      const out = JSON.parse(vm.runInContext(`(function(){
        const base=_tsVehicleToBase(BUILTIN_PRESETS.find(x=>x.name==='Atlas V 551'));
        const stages=ascsimStagesFromBase(_tsExpandStages(base.stages));
        const boost=ascsimBoostersFromBase(base.boosterArg);
        const v0t=ascentSimV0Tangential(base.siteLat,base.azMin,base.azMax,28.5);
        const withB=ascentSimRun({stages,booster:boost,payload_kg:5000,v0_tangential:v0t,fairingMass:base.fairingM,
          apohold:true,apoholdFrac:0.6,vTarget:5000,pitchExp:3,target:{periKm:185,apoKm:185,periTol:25,apoTol:40},tMax:2000});
        const noB=ascentSimRun({stages,payload_kg:5000,v0_tangential:v0t,fairingMass:base.fairingM,
          apohold:true,apoholdFrac:0.6,vTarget:5000,pitchExp:3,target:{periKm:185,apoKm:185,periTol:25,apoTol:40},tMax:2000});
        return JSON.stringify({withStatus:withB.status, noStatus:noB.status,
          withApo:withB.finalOrbit.apoKm, noApo:noB.finalOrbit.apoKm,
          det: JSON.stringify(ascentSimRun({stages,booster:boost,payload_kg:5000,v0_tangential:v0t,fairingMass:base.fairingM,apohold:true,apoholdFrac:0.6,vTarget:5000,pitchExp:3,target:{periKm:185,apoKm:185,periTol:25,apoTol:40},tMax:2000}))
            === JSON.stringify(ascentSimRun({stages,booster:boost,payload_kg:5000,v0_tangential:v0t,fairingMass:base.fairingM,apohold:true,apoholdFrac:0.6,vTarget:5000,pitchExp:3,target:{periKm:185,apoKm:185,periTol:25,apoTol:40},tMax:2000}))});
      })()`, psb));
      ok('SIM3 boosters: a boosted run reaches a terminal status (no throw/timeout-hang)',
        typeof out.withStatus === 'string' && out.withStatus.length > 0);
      ok('SIM3 boosters: adding the SRB group raises apogee vs the core-only run (parallel thrust helps)',
        out.withApo > out.noApo - 1e-6);
      ok('SIM3 boosters: a boosted run is deterministic (byte-identical repeat)', out.det);
    }

    // ── S1.5 expansion boundary: an s15 preset expands to one MORE serial
    //    stage (Ph.1 + Ph.2) before the sim sees it, per the hard invariant. ──
    {
      const n = JSON.parse(vm.runInContext(`(function(){
        const b=_tsVehicleToBase(BUILTIN_PRESETS.find(x=>x.name==='Atlas-Centaur'));
        return JSON.stringify({raw:b.stages.length, exp:_tsExpandStages(b.stages).length});
      })()`, psb));
      ok('SIM3 S1.5: Atlas-Centaur (s15) expands to one extra serial stage via _tsExpandStages',
        n.exp === n.raw + 1);
    }

    // ── Fairing jettison: a run carrying a fairing sheds it mid-ascent, so the
    //    final mass matches the no-fairing run (the fairing mass is gone). ──
    {
      const fr = JSON.parse(vm.runInContext(`(function(){
        const stages=[{dry_kg:5000,prop_kg:40000,F_vac_N:1200000,isp_vac_s:300,isp_sl_s:270},{dry_kg:1000,prop_kg:8000,F_vac_N:150000,isp_vac_s:340}];
        const noF=ascentSimRun({stages,payload_kg:500,fairingMass:0,v_kick:60,theta_kick:0.05,tMax:600});
        const wiF=ascentSimRun({stages,payload_kg:500,fairingMass:2000,v_kick:60,theta_kick:0.05,tMax:600});
        return JSON.stringify({noF:noF.mFinal, wiF:wiF.mFinal});
      })()`, psb));
      ok('SIM3 fairing: jettison rule sheds the fairing mid-ascent (fairing-run mFinal == no-fairing mFinal)',
        Math.abs(fr.noF - fr.wiF) < 1e-6);
    }

    // ── Air-lit refusal: a non-ground-lit booster ignition throws loudly. ──
    {
      let threw = false;
      try {
        vm.runInContext(`ascentSimRun({stages:[{dry_kg:1,prop_kg:1,F_vac_N:1,isp_vac_s:1}],booster:[{Fvac_N:1,isp_vac_s:1,usableProp_kg:1,ignition:{after:0}}]})`, psb);
      } catch (e) { threw = /air-lit/.test(e.message); }
      ok('SIM3 boosters: an air-lit ignition config is REFUSED loudly (throws), not mis-simulated', threw);
    }

    // ── Anchor machinery pins (HONEST-MISS policy, per §27). The payload bands
    //    are NOT asserted — the sim delivers the target orbital ENERGY but with
    //    residual eccentricity, so the max-payload-to-circular numbers fall
    //    below the bands. Asserted instead: the full pipeline runs, is
    //    deterministic, respects its runtime budget, returns a well-formed
    //    (finite, non-negative) result, and agrees with lvMaxPayload on the T-S
    //    sanity number. Diagnostics are printed for provenance. ──
    const anchors = ['Saturn IB', 'Saturn V', 'Falcon 9 Block 5'];
    anchors.forEach((name) => {
      const code = `(function(){
        const p = BUILTIN_PRESETS.find(x=>x.name===${JSON.stringify(name)});
        const base = _tsVehicleToBase(p);
        const stages = _tsExpandStages(base.stages);
        const tsMax = lvMaxPayload(stages, base.boosterArg, base.fairingM, base.fairingJ, 185, 0, base.siteLat, base.azMin, base.azMax);
        const t0 = Date.now();
        const cfg = {stages, boosterArg: base.boosterArg, fairingMass: base.fairingM,
          siteLat: base.siteLat, azMin: base.azMin, azMax: base.azMax, targetIncDeg: 28.5,
          target: {periKm:185, apoKm:185, periTol:25, apoTol:40}, apohold:true, apoholdFrac:0.6, tMax:2000};
        const opts = {bisectIters:10, bisectBudget:25, polishBudget:60, kgTol:600};
        const res = ascentSimMaxPayload(cfg, opts);
        const t1 = Date.now();
        const res2 = ascentSimMaxPayload(cfg, opts);
        const o = res.optimizeResult.result;
        return JSON.stringify({tsMax, maxPayload_kg: res.maxPayload_kg, feasible: res.feasible,
          peri:o.finalOrbit.periKm, apo:o.finalOrbit.apoKm, status:o.status,
          ms: t1-t0, same: res.maxPayload_kg === res2.maxPayload_kg});
      })()`;
      const out = JSON.parse(vm.runInContext(code, psb));
      console.error(`SIM3 anchor — ${name}: T-S=${out.tsMax.toFixed(0)} kg, sim maxPayload=${out.maxPayload_kg.toFixed(0)} kg ` +
        `(feasible=${out.feasible}), closest orbit ${out.peri.toFixed(0)}x${out.apo.toFixed(0)} km (target 185x185, ${out.status}), ${out.ms} ms`);
      ok(`SIM3 anchor (${name}): maxPayload_kg is finite and non-negative`,
        Number.isFinite(out.maxPayload_kg) && out.maxPayload_kg >= 0);
      ok(`SIM3 anchor (${name}): T-S sanity number agrees with lvMaxPayload (finite, positive)`,
        Number.isFinite(out.tsMax) && out.tsMax > 0);
      ok(`SIM3 anchor (${name}): determinism — two full bisection runs return the identical kg`, out.same);
      ok(`SIM3 anchor (${name}): runtime guard — one full bisection run < 15 s`, out.ms < 15000);
    });
  }

  return counts();
};
