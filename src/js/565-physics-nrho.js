// ─────────────────────────────────────────────────────────────────────────────
// 565-physics-nrho.js — LEO -> lunar NRHO direct transfer + free-return solver
//
// OWNS: the Phase-5a direct LEO->NRHO transfer solver (physSolveNrhoTransfer) and the
//   free-return solver (physFreeReturnSolve), plus their re-shoot cache
//   (_physNrhoShootCache). Both drive the shared shooter in 565-physics-targeting.js.
// CONTRACT (unchanged): no tolerances, seeds, iteration caps, or reference-orbit ids
//   were altered; the solved trajectories remain byte-identical (pinned by the Gateway
//   NRHO missKm golden and the free-return fingerprint).
// Does NOT own: the differential corrector itself (565-physics-targeting.js), node
//   burns / mission rebuild (residual 565-physics-mission.js).
// Split out of 565-physics-mission.js (behavior-preserving move). Definitions/decls
//   only (no load-time execution); load order among 565* def-only modules is irrelevant.
// ─────────────────────────────────────────────────────────────────────────────
// ── MISSION_MODEL_V2 Phase 5a — LEO -> lunar NRHO direct transfer ────────────
// cache: re-shoot only when the leg's signature changes (same discipline as
// _physShootCache above).
const _physNrhoShootCache = {};

/**
 * Solve a LEO (or other Earth-centered fromOrbit) -> lunar NRHO direct
 * transfer: an Artemis-class TLI-like departure, ballistic Earth-Moon coast,
 * arriving co-orbital with (NOT phase-matched to) the NRHO's own trajectory
 * — see MATH.md §7t. This is explicitly 5a: rendezvous phase-matching and
 * multi-vehicle timing are 5b, deferred (MISSION_MODEL_V2.md §15).
 *
 * Reuses physShootLegAim's machinery/patterns: physSolveNodeBurn for the
 * analytic departure seed, physAimBurnState for the burn construction,
 * physShootToTarget as the differential corrector, physPropagateSegment for
 * the coast. Target: the NRHO's PERILUNE state (refOrbitSamplePropagated's
 * min-|r| sample) phased to the arrival epoch (tDepart + TOF) via
 * refOrbitPropagatedStateAt — TOF is a free (solved) parameter, seeded near
 * the perilune's own in-period phase.
 *
 * 3-DOF Newton solve on x = [burn anomaly theta, TOF (s), in-plane pitch],
 * miss = the 3 Cartesian components (km, Moon-centered frame) between the
 * departure trajectory's position at t = tDepart + TOF and the NRHO target
 * sample's position at that same epoch. |Δv| is FIXED throughout (ctx.dv_kms,
 * supplied by the caller from the existing ΔV engine) — never recomputed
 * here, same accounting-parity rule as the rest of this module.
 *
 * Insertion burn: at the converged arrival point, dvVec = (NRHO velocity at
 * that phase) − (corridor arrival velocity) — the Phase-2 arrival-burn
 * construction, reused.
 *
 * Iteration-capped via physShootToTarget (maxIter/maxProps below) — never
 * loops. Fails cleanly with converged:false + note.
 *
 * fromOrbit: node orbit spec {body:'Earth', type, perigee/apogee, inclination,
 *   lan_deg?}. nrhoRefId: ref-orbit catalog id (e.g. 'nrho-nominal').
 * tDepart_s: mission MET of the departure burn. ctx: { dv_kms (REQUIRED,
 *   from the existing ΔV engine) }.
 *
 * Returns { converged, dvDepartVec, met, tof_s, missKm, insertionBurn:
 *   {t, frame, r, vPre, dvVec}, samples, events, frame, theta, pitch, dv_kms,
 *   note } — converged:false carries a `note` and no insertionBurn.
 */
function physSolveNrhoTransfer(fromOrbit, nrhoRefId, tDepart_s, ctx) {
  ctx = ctx || {};
  const overrides = {};
  const dv_kms = ctx.dv_kms;
  if (!fromOrbit || (fromOrbit.body || 'Earth') !== 'Earth') return { converged: false, note: 'NRHO transfer solver only models an Earth-centered fromOrbit' };
  if (!(dv_kms > 0)) return { converged: false, note: 'no burn magnitude supplied (ctx.dv_kms)' };
  if (typeof refOrbitResolve !== 'function' || typeof refOrbitSamplePropagated !== 'function' || typeof refOrbitPropagatedStateAt !== 'function')
    return { converged: false, note: 'reference-orbit catalog unavailable' };
  const refRes = refOrbitResolve(nrhoRefId);
  if (!refRes || refRes.kind !== 'propagated' || !refRes.seedState || !refRes.period_s)
    return { converged: false, note: 'NRHO ref-orbit entry not seeded' };

  // analytic departure seed (transit toward the Moon — same construction the
  // ordinary moon-leg shooter uses for its own seed).
  const toTransit = { type: 'transit', body: 'Earth', c3: -1.9, destination: 'Moon' };
  const burn0 = physSolveNodeBurn(fromOrbit, toTransit, tDepart_s, dv_kms, overrides);
  if (!burn0) return { converged: false, note: 'no departure geometry for fromOrbit' };
  const r1 = physMag(burn0.state.r);
  const incRad = ((fromOrbit.inclination || 0) * Math.PI) / 180;
  let theta0 = physPhaseBurnAngle(progBodyAngleAt('Moon', tDepart_s + burn0.coastTof_s));

  // PERILUNE-phased arrival epochs (spec: "target = the NRHO's PERILUNE state
  // at arrival"): take the min-|r| sample's in-period time and enumerate the
  // absolute mission METs at which the NRHO is AT that perilune phase
  // (tArr ≡ tPeri mod period) inside a plausible TLI-class coast band. This
  // quantization is what makes the whole solve tractable: the perilune point
  // sits only ~3,000 km from the Moon's center (vs ~50,000+ km out-of-plane
  // at apolune phases), so a TLI-class departure can genuinely reach it —
  // the first 5a attempt let TOF float freely, Newton settled on apolune-
  // phase arrivals, and the transfer was physically unreachable (measured,
  // MATH.md §7t critique 65).
  const samples = refOrbitSamplePropagated(nrhoRefId, 96);
  if (!samples.length) return { converged: false, note: 'NRHO catalog entry has no propagated samples' };
  const P_nrho = refRes.period_s;
  let periT = 0, periMagKm = Infinity;
  samples.forEach(s => { const mg = physMag(s.r); if (mg < periMagKm) { periMagKm = mg; periT = s.t; } });
  const tArrCands = [];
  {
    const lo = tDepart_s + 2.5 * 86400, hi = tDepart_s + 7.3 * 86400; // band spans > one period — always ≥1 candidate
    let k = Math.ceil((lo - periT) / P_nrho);
    for (; periT + k * P_nrho <= hi; k++) if (periT + k * P_nrho >= lo) tArrCands.push(periT + k * P_nrho);
    if (!tArrCands.length) tArrCands.push(periT + Math.ceil((lo - periT) / P_nrho) * P_nrho);
  }
  let tofSeed = tArrCands[0] - tDepart_s;

  // Solved RAAN (same closed-form construction as physShootLegAim's R3.0.1 —
  // n(Ω)·m̂ = 0, reused per the task) but aimed at the TARGET, not the Moon's
  // center: m̂ is the EARTH-frame direction of the NRHO target sample at the
  // scheduled arrival epoch (Moon-frame sample from refOrbitPropagatedStateAt
  // + the Moon's own Earth-relative position). The first 5a attempt used the
  // Moon-center direction here and stalled ~14,000-25,000 km out — the NRHO
  // sample sits up to ~60,000 km off the Moon's center, a genuinely different
  // plane a fixed-|Δv| burn's small yaw authority could not cross (MATH.md
  // §7t critique 65's follow-on prescription — this IS that fix). With the
  // departure plane containing the actual aim point, the Newton corrector's
  // out-of-plane residual drops back into the linear regime. An AUTHORED
  // fromOrbit.lan_deg is fixed geometry (not a solve target), same precedence
  // as physShootLegAim.
  const raanAuthored = fromOrbit.lan_deg != null;
  const raanAuthoredRad = raanAuthored ? (fromOrbit.lan_deg * Math.PI) / 180 : 0;
  const propCtx = { center: 'Earth', bodies: physBodySetFor({ center: 'Earth', dest: 'Moon', kind: 'cislunar' }), overrides };
  const toMoonFrame = (st, frame, t) => frame === 'Moon' ? st : physPatchState(st, frame, 'Moon', t, overrides);
  const targetAtAbs = tArr => refOrbitPropagatedStateAt(nrhoRefId, tArr);
  const targetEarthDirAt = tArr => {
    const tgtM = targetAtAbs(tArr);
    if (!tgtM) return null;
    const moonSt = physPatchState(physBodyStateAt('Moon', tArr), 'Sun', 'Earth', tArr, overrides);
    const rGeo = physAdd(tgtM.r, moonSt.r);
    const mag = physMag(rGeo);
    return mag > 0 ? physScale(rGeo, 1 / mag) : null;
  };
  // Ω roots for a given (perilune-phased) arrival epoch, solved against the
  // TARGET's Earth-frame direction (Stage-1 fix — the first attempt used the
  // Moon's center here; near perilune the two nearly coincide, but solving
  // against the actual aim point keeps the plane exact). Authored plane wins.
  const raanRootsFor = tArr => {
    if (raanAuthored) return [raanAuthoredRad];
    if (incRad <= 1e-6) return [0];
    const mHat = targetEarthDirAt(tArr);
    if (!mHat) return [0];
    const a = mHat[0] * Math.sin(incRad), b = -mHat[1] * Math.sin(incRad), c = -mHat[2] * Math.cos(incRad);
    const R = Math.hypot(a, b);
    if (R <= 1e-12 || Math.abs(c) > R) return [0];
    const delta = Math.atan2(b, a);
    const s = Math.asin(Math.max(-1, Math.min(1, c / R)));
    return [s - delta, Math.PI - s - delta];
  };
  const ACCEPT_KM = 2000; // spec: "closest approach to the target sample point < 2,000 km"
  const sig = `${r1.toFixed(0)}|${incRad.toFixed(4)}|${raanAuthored ? 'A' + raanAuthoredRad.toFixed(4) : 'S'}|${nrhoRefId}|${tDepart_s.toFixed(0)}|${dv_kms.toFixed(3)}`;
  let sol = _physNrhoShootCache[sig];
  if (!sol) {
    try {
      // ── coarse global scan: every perilune-phased arrival epoch x its Ω
      // roots x a 24-point θ grid, scored by the full 3D miss to the FIXED
      // target point (cheap propagations — endpoint only).
      const cheap = (th, pitch, rn, tArr) => {
        const st = physAimBurnState('Earth', r1, th, pitch, dv_kms, incRad, 0, rn);
        const res = physPropagateSegment({ r: st.r, v: st.v }, tDepart_s, tArr,
          Object.assign({}, propCtx, { stepsPerOrbit: 90 }), { maxSamples: 4 });
        if (!res || !res.stateF) return Infinity;
        const tgtC = targetAtAbs(tArr);
        if (!tgtC) return Infinity;
        return physMag(physSub(toMoonFrame(res.stateF, res.frame, tArr).r, tgtC.r));
      };
      let best = { miss: Infinity, th: theta0, rn: 0, tArr: tArrCands[0] };
      for (const tArr of tArrCands) {
        for (const rn of raanRootsFor(tArr)) {
          for (let k = 0; k < 24; k++) {
            const th = (2 * Math.PI * k) / 24;
            const miss = cheap(th, 0, rn, tArr);
            if (miss < best.miss) best = { miss, th, rn, tArr };
          }
        }
      }
      // local θ refinement (the transfer corridor is much narrower than the
      // coarse grid — two levels, same pattern as physFreeReturnSolve)
      for (const div of [8, 64]) {
        const step = (2 * Math.PI / 24) / div, centre = best.th;
        for (let k = -7; k <= 7; k++) {
          if (!k) continue;
          const th = centre + k * step;
          const miss = cheap(th, 0, best.rn, best.tArr);
          if (miss < best.miss) best = { miss, th, rn: best.rn, tArr: best.tArr };
        }
      }
      // ── Newton, 2-DOF [θ, pitch] against the two in-plane Moon-frame miss
      // components at the FIXED perilune arrival epoch (the fixed endpoint is
      // what keeps this well-conditioned — the first attempt's free-TOF
      // moving-target system was not); the out-of-plane residual is small
      // near perilune and is Stage 2's (MCC) job if it isn't.
      const tArrN = best.tArr;
      const tgtN = targetAtAbs(tArrN);
      const propTo = st => physPropagateSegment({ r: st.r, v: st.v }, tDepart_s, tArrN, propCtx, { maxSamples: 128 });
      const missFull = res => {
        if (!res || !res.stateF || !tgtN) return null;
        const a2 = toMoonFrame(res.stateF, res.frame, tArrN);
        return [a2.r[0] - tgtN.r[0], a2.r[1] - tgtN.r[1], a2.r[2] - tgtN.r[2]];
      };
      const sol2 = physShootToTarget(
        x => physAimBurnState('Earth', r1, x[0], x[1], dv_kms, incRad, 0, best.rn),
        res => { const m = missFull(res); return m ? [m[0], m[1]] : null; },
        [best.th, 0], { propagate: propTo, tolKm: 500, eps: [1e-3, 1e-3], maxIter: 14, maxProps: 30 });
      const bs2 = physAimBurnState('Earth', r1, sol2.x[0], sol2.x[1], dv_kms, incRad, 0, best.rn);
      const m2 = missFull(propTo(bs2));
      const miss2Full = m2 ? Math.hypot(m2[0], m2[1], m2[2]) : Infinity;
      let x = [sol2.x[0], sol2.x[1], 0], missBest = miss2Full,
        iters = sol2.iters, props = sol2.propagations;
      if (miss2Full > ACCEPT_KM) {
        // 3-DOF escalation [θ, pitch, yaw] against the full 3D miss —
        // seeded from the 2-DOF result so steps stay in the linear regime.
        const sol3 = physShootToTarget(
          xx => physAimBurnState('Earth', r1, xx[0], xx[1], dv_kms, incRad, xx[2], best.rn),
          res => missFull(res),
          x, { propagate: propTo, tolKm: 500, eps: [1e-3, 1e-3, 1e-3], maxIter: 10, maxProps: 30 });
        iters += sol3.iters; props += sol3.propagations;
        if (sol3.missKm < missBest) { x = sol3.x; missBest = sol3.missKm; }
      }
      sol = { converged: missBest <= ACCEPT_KM, x, missKm: missBest, tArr: tArrN, raan: best.rn,
        iters, propagations: props };
    } catch (err) {
      sol = { converged: false, x: [theta0, 0, 0], missKm: Infinity, tArr: tArrCands[0], raan: 0, iters: 0, propagations: 0 };
    }
    _physNrhoShootCache[sig] = sol;
  }
  const burnSolveFn = x => physAimBurnState('Earth', r1, x[0], x[1] || 0, dv_kms, incRad, x[2] || 0, sol.raan);
  const bs = burnSolveFn(sol.x);
  const tArr = sol.tArr;
  const TOFf = tArr - tDepart_s;
  const finalRes = physPropagateSegment({ r: bs.r, v: bs.v }, tDepart_s, tArr, propCtx, { maxSamples: 128 });
  const tgt = targetAtAbs(tArr);
  if (!finalRes || !finalRes.stateF || !tgt) {
    return { converged: false, met: tDepart_s, tof_s: TOFf, missKm: Infinity,
      note: 'propagation or target sample failed at the solved x' };
  }
  const arr = toMoonFrame(finalRes.stateF, finalRes.frame, tArr);
  let missKm = physMag(physSub(arr.r, tgt.r));
  let converged = isFinite(missKm) && missKm <= ACCEPT_KM;
  let mccBurn = null;
  let outSamples = finalRes.samples, outEvents = finalRes.events, outFrame = finalRes.frame;
  let arrFinal = arr;

  // ── Stage 2 (MATH.md §7t): mid-course correction. The fixed-|Δv| TLI can
  // put the vehicle in the trans-lunar corridor but its 2-3 DOF direction
  // solve cannot reliably hit a moving off-Moon-center point to <2,000 km
  // (measured — the Stage-1 RAAN retarget alone still left 50,000-130,000 km
  // across the dv band). Real missions fly exactly this architecture: TLI
  // gets you the corridor, a small mid-course correction burn (tens of m/s —
  // Artemis-class MCC budgets) closes the endpoint. The MCC's Δv VECTOR is
  // free (it's a solver-authored burn, like physFreeReturnSolve's — not a
  // re-aim of the accounted TLI magnitude, which stays byte-identical):
  // 3-DOF Newton on the MCC Δv components at tMcc = tDepart + 0.5·TOF,
  // targeting the NRHO sample's position at the FIXED arrival epoch. This
  // is a near-linear problem (small velocity change, long lever arm) and
  // converges in a few iterations. Cached alongside the Stage-1 x.
  if (!converged) {
    const tMcc = tDepart_s + 0.5 * TOFf;
    // state at tMcc, re-derived from the SAME initial state (one propagation)
    const preRes = physPropagateSegment({ r: bs.r, v: bs.v }, tDepart_s, tMcc, propCtx, { maxSamples: 64 });
    if (preRes && preRes.stateF && PROG_BODIES[preRes.frame]) {
      const mccFrame = preRes.frame;
      const mccCtx = { center: mccFrame, bodies: propCtx.bodies, overrides };
      const propMcc = dv => physPropagateSegment(
        { r: preRes.stateF.r, v: physAdd(preRes.stateF.v, dv) }, tMcc, tArr, mccCtx, { maxSamples: 128 });
      const missOfMcc = res => {
        if (!res || !res.stateF) return null;
        const a2 = toMoonFrame(res.stateF, res.frame, tArr);
        return [a2.r[0] - tgt.r[0], a2.r[1] - tgt.r[1], a2.r[2] - tgt.r[2]];
      };
      let mccSol = sol.mcc;
      if (!mccSol) {
        try {
          mccSol = physShootToTarget(
            x => ({ r: preRes.stateF.r, v: physAdd(preRes.stateF.v, x) }),
            res => missOfMcc(res),
            [0, 0, 0],
            { propagate: (st, x) => propMcc(x), tolKm: Math.min(500, ACCEPT_KM / 4),
              eps: [1e-4, 1e-4, 1e-4], maxIter: 12, maxProps: 40 });
        } catch (err) { mccSol = { converged: false, x: [0, 0, 0], missKm: Infinity, iters: 0, propagations: 0 }; }
        sol.mcc = mccSol; // joins the cached record — warm recomputes skip both Newtons
      }
      const dvMcc = mccSol.x;
      const dvMccMag = physMag(dvMcc);
      const postRes = propMcc(dvMcc);
      const m2 = missOfMcc(postRes);
      const missMcc = m2 ? Math.hypot(m2[0], m2[1], m2[2]) : Infinity;
      if (isFinite(missMcc) && missMcc < missKm) {
        missKm = missMcc;
        converged = missKm <= ACCEPT_KM;
        mccBurn = { t: tMcc, frame: mccFrame, r: preRes.stateF.r, vPre: preRes.stateF.v,
          dvVec: dvMcc.slice(), dv_ms: dvMccMag * 1000 };
        // stitched trajectory: pre-MCC arc + post-MCC arc (one polyline for
        // the renderer; the MCC point is where they join)
        outSamples = (preRes.samples || []).concat(postRes.samples || []);
        outEvents = (preRes.events || []).concat(postRes.events || []);
        outFrame = postRes.frame;
        arrFinal = toMoonFrame(postRes.stateF, postRes.frame, tArr);
      }
    }
  }

  const insertionBurn = converged ? { t: tArr, frame: 'Moon', r: arrFinal.r, vPre: arrFinal.v, dvVec: physSub(tgt.v, arrFinal.v) } : null;
  return {
    converged, dvDepartVec: bs.dvVec, met: tDepart_s, tof_s: TOFf, missKm,
    insertionBurn, mccBurn, samples: outSamples, events: outEvents, frame: outFrame,
    theta: sol.x[0], pitch: sol.x[1] || 0, yaw: sol.x[2] || 0, dv_kms,
    note: converged
      ? (mccBurn ? `converged via mid-course correction (${Math.round(mccBurn.dv_ms)} m/s MCC at TLI+${(0.5 * TOFf / 86400).toFixed(1)} d)` : null)
      : `NRHO transfer did not converge (miss ${isFinite(missKm) ? Math.round(missKm) + ' km' : 'n/a'} > ${ACCEPT_KM} km window)`,
  };
}

/**
 * Free-return template solve (authoring aid, NOT re-aiming an accounted burn —
 * here the magnitude IS free because the user is authoring a NEW burn).
 * 2-DOF shoot on x = [burn MET (s), |Δv| (km/s)] from a circular Earth orbit
 * at leoAltKm; the burn anomaly follows the MNODE convention theta = n·MET
 * (mean motion phase), so the solved MET round-trips exactly through the
 * MNODE leg builder. Targets: lunar SOI transit at the seed trajectory's
 * flyby distance AND Earth return perigee inside [30, 500] km (aimed at the
 * seed's own value when already in band). Seeded from the P1 golden (apogee
 * 455,000 km energy; burn angle 4.5379 rad rotated with the Moon's rail).
 * R3: solves from an INCLINED parking orbit (incDeg, default 28.5 — pass the
 * active vehicle's authored inclination; 0 for equatorial). The MNODE
 * builder honors the same inclination + theta = n·MET convention, so the
 * solved MET/Δv round-trips exactly.
 * Returns { converged, met_s, dv_ms, periAlt_km, missKm, iters } or a
 * converged:false record.
 */
function physFreeReturnSolve(leoAltKm, tDepart_s, overrides, incDeg) {
  overrides = overrides || {};
  const incRad = ((incDeg == null ? 28.5 : incDeg) * Math.PI) / 180;
  const muE = PROG_BODIES.Earth.mu, RE_ = PROG_BODIES.Earth.R;
  const rp = RE_ + (leoAltKm || 185);
  const nMean = Math.sqrt(muE / (rp * rp * rp));
  const t0 = tDepart_s || 0;
  const twoPi = 2 * Math.PI;
  const ctx = { center: 'Earth', bodies: physBodySetFor({ center: 'Earth', dest: 'Moon', kind: 'cislunar' }), overrides };
  const mkState = x => {
    const bs = physAimBurnState('Earth', rp, (x[0] * nMean) % twoPi, 0, x[1], incRad, 0);
    return { r: bs.r, v: bs.v, met: x[0] };
  };
  const propagate = st => physPropagateSegment({ r: st.r, v: st.v }, st.met, st.met + 12 * 86400, ctx, { maxSamples: 128 });
  const measure = res => {
    const soiOut = res.events.find(ev => ev.type === 'soi' && ev.from === 'Moon');
    const moonPeri = res.events.filter(ev => ev.type === 'periapsis' && ev.frame === 'Moon');
    const dMoonKm = moonPeri.length ? Math.min.apply(null, moonPeri.map(ev => ev.rMag))
      : physClosestApproachKm(res, 'Moon', overrides).dKm;
    let periAlt = null;
    if (soiOut) {
      const per = res.events.filter(ev => ev.type === 'periapsis' && ev.frame === 'Earth' && ev.t > soiOut.t);
      if (per.length) periAlt = per[0].rMag - RE_;
      else {
        let best = Infinity;
        res.samples.forEach(s => { if (s.frame === 'Earth' && s.t > soiOut.t) best = Math.min(best, physMag(s.r)); });
        if (isFinite(best)) periAlt = best - RE_;
      }
    }
    return { dMoonKm, periAlt };
  };
  // ── R3 seed selection (2026-07-10): the rotated-golden shortcut alone no
  // longer seeds reliably from an INCLINED parking orbit (the R1 golden apo
  // 445,000 km / phi 4.98 rad is an ecliptic solution; from a 28.5° ring it
  // never re-enters the return band — measured, scratchpad r3_scan.js; the
  // 28.5° grid optimum is apo 435,000 km / phi 5.96 rad → perigee ≈ 48 km).
  // Deterministic candidate scan instead: the rotated R1 golden PLUS a coarse
  // apo × phi grid (2 × 24, fixed order), scored by "return perigee near 200
  // km", falling back to "reached/entered the Moon SOI, closest first".
  const phiToMet = phi => {
    let th = phi % twoPi; if (th < 0) th += twoPi;
    const phase = (((th - nMean * t0) % twoPi) + twoPi) % twoPi;
    return t0 + phase / nMean;
  };
  const dvForApo = apo => { const aS = (rp + apo) / 2; return Math.sqrt(muE * (2 / rp - 1 / aS)) - Math.sqrt(muE / rp); };
  const moonRot = progBodyAngleAt('Moon', t0) - progBodyAngleAt('Moon', 0);
  // apogee candidates track the Moon's REAL geocentric distance at the
  // estimated encounter (~4.7 d out) — the eccentric Moon spans 363k–405k km
  // over the month, so fixed apogees strand the seed at unfavorable phases
  // (measured: t0 = 2 d failed with the fixed 435k/445k pair). The winning
  // t0 = 0 apogees sit ~65k–75k km past the Moon (far-side wraparound).
  const mArr = physBodyStateAt('Moon', t0 + 4.7 * 86400, overrides);
  const eArr = physBodyStateAt('Earth', t0 + 4.7 * 86400, overrides);
  const rMoonArr = physMag(physSub(mArr.r, eArr.r));
  const cands = [[4.98 + moonRot, 445000]];
  for (const apo of [rMoonArr + 60000, rMoonArr + 75000]) {
    for (let k = 0; k < 24; k++) cands.push([k * twoPi / 24 + moonRot, apo]);
  }
  // score: any trajectory that comes BACK (measurable Earth return perigee)
  // beats any that doesn't, ranked by |periAlt − 200 km| — even an out-of-band
  // or sub-surface perigee is a better corrector seed than a tight flyby that
  // never returns (measured: a 46,000 km flyby with an 84,000 km "perigee"
  // strands the 2-DOF Newton; a −1,600 km crash seed converges).
  const scoreOf = mm => (mm.periAlt != null)
    ? Math.abs(mm.periAlt - 200)
    : 1e6 + (isFinite(mm.dMoonKm) ? mm.dMoonKm : 1e9);
  let bestPhi = cands[0][0], bestApo = cands[0][1], bestScore = Infinity;
  for (const [phi, apo] of cands) {
    const mm = measure(propagate(mkState([phiToMet(phi), dvForApo(apo)])));
    const score = scoreOf(mm);
    if (score < bestScore) { bestScore = score; bestPhi = phi; bestApo = apo; }
  }
  // two-level local phi refinement around the grid winner (±1 coarse step at
  // 1/8 steps, then ±1 fine step at 1/64 steps) — the free-return corridor is
  // ~0.01 rad wide in burn anomaly, far narrower than the coarse grid, and a
  // seed stranded half a step out leaves the corrector nothing to damp toward
  const step = twoPi / 24;
  for (const div of [8, 64]) {
    const localStep = step / div, reach = div === 8 ? 7 : 4;
    const centre = bestPhi;
    for (let k = -reach; k <= reach; k++) {
      if (!k) continue;
      const phi = centre + k * localStep;
      const mm = measure(propagate(mkState([phiToMet(phi), dvForApo(bestApo)])));
      const score = scoreOf(mm);
      if (score < bestScore) { bestScore = score; bestPhi = phi; }
    }
  }
  // apogee refinement around the winner (the dv dimension): ±8k/±16k km,
  // re-checking the fine phi neighbours — the corridor is a narrow curve in
  // (phi, apo) and the corrector's damping needs a seed ON it, not beside it
  {
    const cPhi = bestPhi, cApo = bestApo;
    for (const dApo of [-16000, -8000, 8000, 16000]) {
      for (const dPhi of [-step / 64, 0, step / 64]) {
        const mm = measure(propagate(mkState([phiToMet(cPhi + dPhi), dvForApo(cApo + dApo)])));
        const score = scoreOf(mm);
        if (score < bestScore) { bestScore = score; bestPhi = cPhi + dPhi; bestApo = cApo + dApo; }
      }
    }
  }
  const metSeed = phiToMet(bestPhi), dvSeed = dvForApo(bestApo);
  const seedM = measure(propagate(mkState([metSeed, dvSeed])));
  // N1: lunar-encounter scale as an explicit constant (was physSoiRadius('Moon')
  // / ×0.15) — a target-selection heuristic, not a dynamical boundary.
  const dTgt = (isFinite(seedM.dMoonKm) && seedM.dMoonKm < PHYS_ENCOUNTER_SCALE_KM.Moon)
    ? seedM.dMoonKm : PHYS_ENCOUNTER_SCALE_KM.Moon * 0.15;
  const pTgt = (seedM.periAlt != null && seedM.periAlt >= 30 && seedM.periAlt <= 500) ? seedM.periAlt : 265;
  const sol = physShootToTarget(mkState,
    res => { const mm = measure(res); return [mm.dMoonKm - dTgt, mm.periAlt == null ? 1e9 : mm.periAlt - pTgt]; },
    [metSeed, dvSeed],
    { propagate, tolKm: 100, eps: [1e-3 / nMean, 1e-4], maxIter: 12, maxProps: 40 });
  const finalM = measure(propagate(mkState(sol.x)));
  const inBand = finalM.periAlt != null && finalM.periAlt >= 30 && finalM.periAlt <= 500;
  return { converged: !!(sol.converged && inBand) || inBand, met_s: sol.x[0], dv_ms: sol.x[1] * 1000,
    periAlt_km: finalM.periAlt, missKm: sol.missKm, iters: sol.iters };
}
