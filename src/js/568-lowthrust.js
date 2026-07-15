
// ─── MISSION_MODEL_V2 §19 E2 — electric propulsion event model (pure core) ──
// Consumes E1's substrate (386: ctx.thrust on physPropagateSegment; see
// MATH.md §7y). This module is the "est." accounting lane (Edelbaum /
// rocket-equation, cheap, synchronous) plus the signature machinery that
// gates the "computed" lane (integrated, expensive, behind a UI button in
// 570/572 — see MATH.md §7z for the full boundary write-up).
//
// Hard invariant (CLAUDE.md): physics results never live on `m` — the
// integrated-leg cache is a side-table sibling to _physTrajByMission (565),
// declared here and consulted by 570's LOWTHRUST recompute case.

// side-table: computed low-thrust legs, keyed missionId -> { [authIdx]: record }.
// record = { sig, samples, dvAccum_kms, mF_kg, propUsed_kg, tof_s }
// NOT session-persisted (spec, D6 honesty): a restored session has no entries
// here, so every LOWTHRUST leg renders STALE/est. until recomputed — by design.
let _ltComputedByMission = {};

/** Accessor: computed record for an authored log index, or null. */
function ltComputedLeg(missionId, authIdx) {
  const t = _ltComputedByMission[missionId];
  return (t && t[authIdx]) || null;
}

function ltStoreComputedLeg(missionId, authIdx, record) {
  if (!_ltComputedByMission[missionId]) _ltComputedByMission[missionId] = {};
  _ltComputedByMission[missionId][authIdx] = record;
}

function ltClearMissionCache(missionId) {
  delete _ltComputedByMission[missionId];
}

// ── est. lane: Edelbaum / rocket-equation analytic pricing ──────────────────
//
// Approximation (documented, MATH.md §7z): the authored duration prices as a
// straight rocket-equation burn at the throttled thrust/Isp — i.e. the SAME
// mass-depletion math E1 validated exactly for a continuous thrust arc
// (§7y "Mass-coupling exactness"), NOT a full Edelbaum multi-rev spiral
// integral. This is the "Edelbaum-ish" est. the spec calls for: cheap,
// synchronous, and exact for the one thing that matters for budgeting
// (prop consumed -> dv via Isp*g0*ln(m0/mF)) while remaining honest that a
// real spiral's ORBIT geometry (not priced here) needs the computed lane.
//
// ep = { thrust_N, isp_s, m0_kg, mDry_kg }, duration_s, throttle (0-1, default 1)
// Returns { dv_est_kms, propUsed_kg, mF_kg, capped, tof_s }.
function ltEstimateLeg(ep, duration_s, throttle) {
  const T = Math.max(0, (ep && ep.thrust_N) || 0) * (throttle == null ? 1 : Math.max(0, Math.min(1, throttle)));
  const Isp = (ep && ep.isp_s) || 0;
  const m0 = Math.max(0, (ep && ep.m0_kg) || 0);
  const mDry = Math.max(0, (ep && ep.mDry_kg) || 0);
  const dur = Math.max(0, duration_s || 0);
  if (T <= 0 || Isp <= 0 || m0 <= 0 || dur <= 0) {
    return { dv_est_kms: 0, propUsed_kg: 0, mF_kg: m0, capped: false, tof_s: dur };
  }
  const mdot = T / (Isp * PHYS_G0_MS2);          // kg/s
  const propWanted = mdot * dur;                  // kg, uncapped
  const propAvail = Math.max(0, m0 - mDry);
  const propUsed = Math.min(propWanted, propAvail);
  const capped = propWanted > propAvail;
  const mF = m0 - propUsed;
  // rocket equation for the dv this prop mass buys — exact per §7y's telescoping
  // per-step-log argument, independent of how the burn is chunked in time.
  const dv_ms = (mF > 0 && mF < m0) ? Isp * PHYS_G0_MS2 * Math.log(m0 / mF) : 0;
  return { dv_est_kms: dv_ms / 1000, propUsed_kg: propUsed, mF_kg: mF, capped, tof_s: dur };
}

/** Planar Edelbaum circular-to-circular Δv (Δi=0 reduction, MATH.md §7y/§7z):
 *  the "required" pricing lane for node-map/UI display, independent of the
 *  above rocket-eq burn estimate (which prices the AUTHORED duration, not a
 *  target orbit change). v0,v1 in km/s. */
function ltEdelbaumPlanarDv(v0_kms, v1_kms) {
  return Math.abs((v0_kms || 0) - (v1_kms || 0));
}

// ── E3: full-form Edelbaum (circular-to-circular, plane change included) ────
//
// MATH.md §7aa. Δv = sqrt(v0^2 + v1^2 - 2*v0*v1*cos(pi/2 * di)), the standard
// circular-orbit Edelbaum result (di in DEGREES, full 90 deg = orthogonal
// planes costs the quadrature sum v0^2+v1^2 rather than a naive |v0-v1|+
// plane-change add). di=0 degenerates exactly to ltEdelbaumPlanarDv's
// |v0-v1| (verified by gate). Node-map est. lane ONLY (§19 E3) — NEVER feeds
// progNmComputeEdgeDv's impulsive accounting (frozen, CLAUDE.md).
// di_deg: total relative inclination change between the two circular orbits,
// in DEGREES (0-180). Interpretation (documented, MATH.md §7aa): the angle
// argument is the plane-change angle itself in radians -- di_deg=0 -> cos=1
// -> exact |v0-v1| (matches ltEdelbaumPlanarDv, gate-pinned); di_deg=90 ->
// cos=0 -> sqrt(v0^2+v1^2) (orthogonal planes, pure quadrature); di_deg=180
// -> cos=-1 -> v0+v1 (opposite planes, full retrograde re-launch cost). This
// is the standard law-of-cosines closure between two circular-orbit velocity
// VECTORS separated by angle di -- exact for that idealized geometry, and is
// what "Edelbaum's full form" reduces to for a single combined burn; it is
// still an UPPER-BOUND-ish single-maneuver estimate vs a true multi-rev
// Edelbaum spiral that splits the plane change optimally across the whole
// transfer (see critique below) -- an "est." lane number, not physics truth.
function ltEdelbaumFullDv(v0_kms, v1_kms, di_deg) {
  const v0 = v0_kms || 0, v1 = v1_kms || 0;
  const di = Math.max(0, Math.min(180, di_deg || 0));
  const theta = di * Math.PI / 180;
  const inner = v0 * v0 + v1 * v1 - 2 * v0 * v1 * Math.cos(theta);
  return Math.sqrt(Math.max(0, inner));
}

// ── E3: TOF estimate for a priced Edelbaum-style leg ────────────────────────
//
// tof_s = dv_ms / (T_N / mBar_kg), a mass-averaged constant-acceleration
// estimate (mBar = (m0+mF)/2, mF from the SAME rocket-eq relation ltEstimateLeg
// uses, so the TOF and the dv/prop numbers stay internally consistent). Not
// exact (real accel rises through the burn as mass depletes -- see §7y), but
// consistent with the est. lane's existing honesty boundary. Returns
// {tof_s, mF_kg, propUsed_kg} or nulls if the burn can't be completed with
// available prop (dv exceeds what the tank can deliver at that Isp).
function ltEdelbaumTofEst(dv_kms, ep) {
  const dv_ms = Math.max(0, (dv_kms || 0) * 1000);
  const Isp = (ep && ep.isp_s) || 0, T = (ep && ep.thrust_N) || 0;
  const m0 = Math.max(0, (ep && ep.m0_kg) || 0), mDry = Math.max(0, (ep && ep.mDry_kg) || 0);
  if (!(Isp > 0) || !(T > 0) || !(m0 > mDry)) return { tof_s: null, mF_kg: null, propUsed_kg: null };
  const ve = Isp * PHYS_G0_MS2;
  const mF = m0 * Math.exp(-dv_ms / ve);
  if (!(mF >= mDry)) return { tof_s: null, mF_kg: null, propUsed_kg: null }; // dv exceeds tank capacity
  const propUsed = m0 - mF;
  const mBar = (m0 + mF) / 2;
  const accel = T / mBar; // m/s^2 (T in N, mBar in kg)
  const tof_s = dv_ms / accel;
  return { tof_s, mF_kg: mF, propUsed_kg: propUsed };
}

// ── est-orbit approximation: apply a planar dv to a circular-orbit alt ──────
//
// Documented approximation (MATH.md §7z): treats the vehicle's current orbit
// as circular at its mean altitude, applies the estimated dv as a single
// TANGENTIAL impulse at that radius (v1 = v_circ +/- dv), then uses the
// resulting specific orbital energy to back-solve a new semi-major axis via
// vis-viva (a_new = -mu / (v1^2 - 2*mu/r0)) and reports that a_new AS the new
// "circular" altitude. This is the standard quasi-circular-spiral proxy: a
// real continuous low-thrust burn keeps the orbit nearly circular while its
// mean radius (~ a) grows/shrinks, so pricing off the post-impulse a (not a
// literal same-radius circular re-solve, which would invert the sign — see
// MATH.md §7z critique 75) matches the INTUITIVE raise/lower direction a user
// expects from prograde/retrograde while remaining honest that it is not a
// real spiral (no eccentricity growth tracked). body: PROG_BODIES key.
// altKm: current mean altitude. dv_kms: signed (positive = prograde/raise,
// negative = retrograde/lower). Returns new alt (km); non-physical inputs
// (e.g. dv driving the orbit hyperbolic/negative-radius) leave altitude
// unchanged rather than lie.
function ltApplyDvToCircularAlt(body, altKm, dv_kms) {
  const b = (typeof PROG_BODIES !== 'undefined') ? PROG_BODIES[body] : null;
  if (!b) return altKm;
  const R = b.R, mu = b.mu;
  const r0 = R + Math.max(0, altKm || 0);
  const v0 = Math.sqrt(mu / r0);
  const v1 = v0 + (dv_kms || 0);
  if (!(v1 > 0)) return altKm;
  const denom = v1 * v1 - 2 * mu / r0;
  if (!(denom < 0)) return altKm;   // denom >= 0 => escape/hyperbolic; est. lane doesn't model that here
  const aNew = -mu / denom;
  if (!(aNew > R)) return altKm;
  return aNew - R;
}

// ── signature (stale-detection) ──────────────────────────────────────────────
//
// Deterministic string hash (FNV-1a, 32-bit) over the JSON of the rounded
// inputs that define a computed leg's validity. Any authored/upstream field
// change -> different signature -> the cached computed leg is STALE.
function _ltFnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// fields: { r:[x,y,z], v:[vx,vy,vz], m0_kg, thrust_N, isp_s, throttle, law,
//           duration_s, fidelity }
function ltSignature(fields) {
  const f = fields || {};
  const round = (x, n) => Number.isFinite(x) ? +x.toFixed(n) : 0;
  const roundVec = (v, n) => (v || [0, 0, 0]).map(x => round(x, n));
  const canon = {
    r: roundVec(f.r, 3),          // km, mm-scale rounding is plenty for a signature
    v: roundVec(f.v, 6),          // km/s
    m0: round(f.m0_kg, 3),
    T: round(f.thrust_N, 6),
    isp: round(f.isp_s, 3),
    throttle: round(f.throttle, 4),
    law: f.law || '',
    dur: round(f.duration_s, 3),
    fidelity: f.fidelity || 'default',
  };
  return _ltFnv1a(JSON.stringify(canon));
}

// ── readiness (572 pattern: {ok, message}) ───────────────────────────────────
//
// activeStage: the SC LiveStage (or its stageDef) at the point of the event —
// same "active stage at that point in the log" convention as any other burn.
// Looks for propType==='XENON_EP' plus positive ep_thrust_N/ep_isp_s.
function ltReadinessCheck(activeStage) {
  if (!activeStage) return { ok: false, message: 'No active stage available for the low-thrust burn.' };
  const propType = activeStage.propType || (activeStage.tanks && activeStage.tanks[0] && activeStage.tanks[0].propellantType);
  if (propType !== 'XENON_EP') {
    return { ok: false, message: `Active stage propellant is "${propType || 'unknown'}", not an electric-propulsion type (Xenon (EP)) — LOWTHRUST requires an EP stage.` };
  }
  const T = activeStage.ep_thrust_N, Isp = activeStage.ep_isp_s;
  if (!(T > 0) || !(Isp > 0)) {
    return { ok: false, message: 'Active EP stage is missing ep_thrust_N / ep_isp_s (set them in the Spacecraft editor).' };
  }
  return { ok: true, message: null };
}

// ── E3: rev-boundary resampler for LOD spiral rendering ─────────────────────
//
// MATH.md §7aa. ltComputeTrajectory's raw samples are near-uniform in TIME
// (E1/E2, up to maxSamples decimation) -- a multi-hundred-rev spiral drawn as
// a plain polyline through those aliases into visual noise (E2 critique 79).
// This function re-expresses the samples by ORBITAL REV instead: detect rev
// boundaries via accumulated winding angle (theta = atan2(y,x) in the orbit
// plane, unwrapped), keep every sample for the first `headRevs` and last
// `tailRevs` complete revs (full per-rev fidelity for the legible ends), and
// decimate the middle to ~1 sample per rev (one point per boundary crossing --
// enough for an envelope/annulus renderer, not a polyline).
//
// samples: [{t, r:[x,y,z], ...}] time-ordered, r relative to the body center,
// SAME plane assumption ltApplyDvToCircularAlt already makes (planar spiral;
// out-of-plane wobble isn't tracked by winding angle -- documented, §7aa
// critique). Returns { head:[...], mid:[...], tail:[...], revCount }.
// Degenerate inputs (< 2 samples, zero revs) fall back to returning
// everything in `head` with revCount 0 rather than throwing.
function ltResampleSpiralRevs(samples, headRevs, tailRevs) {
  const hr = Math.max(0, headRevs == null ? 8 : headRevs);
  const tr = Math.max(0, tailRevs == null ? 8 : tailRevs);
  if (!Array.isArray(samples) || samples.length < 2) {
    return { head: samples ? samples.slice() : [], mid: [], tail: [], revCount: 0 };
  }
  // unwrap winding angle across the sample sequence (planar theta = atan2(y,x))
  let prevTheta = Math.atan2(samples[0].r[1], samples[0].r[0]);
  let unwrapped = prevTheta;
  const windAngle = [unwrapped];
  for (let i = 1; i < samples.length; i++) {
    const th = Math.atan2(samples[i].r[1], samples[i].r[0]);
    let d = th - prevTheta;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    unwrapped += d;
    windAngle.push(unwrapped);
    prevTheta = th;
  }
  const totalAngle = Math.abs(windAngle[windAngle.length - 1] - windAngle[0]);
  const revCount = totalAngle / (2 * Math.PI);
  if (revCount < (hr + tr)) {
    // too short to split meaningfully -- everything is "head" (full fidelity)
    return { head: samples.slice(), mid: [], tail: [], revCount };
  }
  const sign = (windAngle[windAngle.length - 1] >= windAngle[0]) ? 1 : -1;
  const a0 = windAngle[0];
  const headCutAngle = a0 + sign * hr * 2 * Math.PI;
  const tailCutAngle = windAngle[windAngle.length - 1] - sign * tr * 2 * Math.PI;
  const head = [], mid = [], tail = [];
  let lastMidRev = -1;
  for (let i = 0; i < samples.length; i++) {
    const a = windAngle[i];
    const inHead = sign > 0 ? a <= headCutAngle : a >= headCutAngle;
    const inTail = sign > 0 ? a >= tailCutAngle : a <= tailCutAngle;
    if (inHead) { head.push(samples[i]); continue; }
    if (inTail) { tail.push(samples[i]); continue; }
    // middle: keep ~1 sample per rev boundary crossing
    const revIdx = Math.floor(sign * (a - a0) / (2 * Math.PI));
    if (revIdx !== lastMidRev) { mid.push(samples[i]); lastMidRev = revIdx; }
  }
  return { head, mid, tail, revCount };
}
