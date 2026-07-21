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

  return counts();
};
