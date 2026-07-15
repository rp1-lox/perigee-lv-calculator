
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
