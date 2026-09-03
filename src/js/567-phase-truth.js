// ─── PHASE TRUTH — orbital phase measurement ────────────────────────────────
// Measurement and display support only; no solving. Two vehicles share an
// orbit in two shapes:
//  (a) both orbitState.propagated with the same refId (the NRHO case) —
//      measured via each vehicle's nearest-point time parameter on the ref's
//      sampled loop, in the Earth-Moon rotating frame (a rotating-frame-
//      periodic orbit does not close inertially).
//  (b) both classical Keplerian orbits sharing (a, e, i) within tolerance —
//      mean-anomaly difference / mean motion. Gate-tested but not wired to the
//      UI: classical orbitState carries no anomaly/epoch field yet.
// Details and critiques in.

// Capture window: TIME-based, not distance-based (spec offered either).
// Rationale: the NRHO is highly eccentric (perilune ~5,500 km
// vs apolune ~71,000 km from the Moon) — orbital speed varies enormously
// around one loop, so a FIXED distance threshold would flag "captured" near
// apolune (slow) at phase errors that are actually huge in time, and flag
// "not captured" near perilune (fast) for phase errors that are tiny in
// time. A time window is the one framing that means the same thing
// everywhere on an eccentric loop. 300 s (5 min) chosen as a docking-ops-
// scale window — well inside "minutes", the band the spec names.
const PHASE_CAPTURE_WINDOW_S = 300;

// Wrap a time difference into [-P/2, P/2] (shortest signed offset around the loop).
function _phaseWrapDt(dt, P) {
  if (!(P > 0)) return dt;
  return ((dt + P / 2) % P + P) % P - P / 2;
}

// Resolve a vehicle's inertial position + the epoch it's valid at, for phase
// measurement, from an orbitState that is propagated/refId. Two shapes exist
// in this codebase today:
//  - DEPLOY-placed vehicles carry a real captured r (+ v, + metAt — the MET
//    at which that state was captured; see 570-mission-manager.js's DEPLOY
//    branch, which now stamps metAt alongside r/v for this consumer).
//  - Maneuver-ARRIVED vehicles (a solved transfer landing on a propagated
//    node, e.g. the NRHO node in 570-mission-panel.js's _missionApplyManeuver)
//    stamp propagated+refId but carry NO r/v — there is no captured phase
//    offset for them. The honest reading of "no data" here is NOT "phase
//    unknown", it's "this vehicle has always been assumed to sit exactly on
//    the ref's own wrapped-clock position" (that IS today's silent
//    co-orbital-success assumption pre-R1) — so we fall back to
//    refOrbitPropagatedStateAt(refId, metNow), i.e. zero recorded offset at
//    the query epoch, and let the OTHER vehicle's real captured state (if
//    any) be the one that shows a nonzero phase error.
function _phaseVehiclePoint(os, metNow) {
  if (!os || !os.propagated || !os.refId) return null;
  if (os.r) return { r: os.r, t: (os.metAt != null ? os.metAt : (metNow || 0)) };
  const st = refOrbitPropagatedStateAt(os.refId, metNow || 0);
  if (!st) return null;
  return { r: st.r, t: metNow || 0 };
}

// Nearest-point time parameter: which sample of the ref's one-period raw loop
// (each sample keeping ITS OWN true epoch — 425's refOrbitSamplePropagatedRaw,
// the N3 live/un-rebased source) is closest to the query point, comparing in
// the Earth-Moon ROTATING frame at each sample's own epoch. Returns the
// WINNING SAMPLE'S EPOCH as the vehicle's "along-track clock" reading — not a
// literal position, a phase-position label on the loop.
function _phaseNearestT(refId, r, t, nSamples) {
  const res = refOrbitResolve(refId);
  if (!res || res.kind !== 'propagated' || !res.period_s) return null;
  if (!_refRotCapable(res)) return null;   // only Moon-frame refs (§17 N2) get the rotating wrap
  const raw = refOrbitSamplePropagatedRaw(refId, nSamples || 180);
  if (!raw || !raw.length) return null;
  const qRot = _refToRot({ r, v: [0, 0, 0] }, t).r;
  let bestT = null, bestD2 = Infinity;
  for (const s of raw) {
    const sRot = _refToRot({ r: s.r, v: [0, 0, 0] }, s.t).r;
    const dx = qRot[0] - sRot[0], dy = qRot[1] - sRot[1], dz = qRot[2] - sRot[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; bestT = s.t; }
  }
  if (bestT == null) return null;
  return { tPhase: bestT, period_s: res.period_s };
}

// Public: phase error between two vehicles sharing a propagated ref
// (osA/osB = each vehicle's orbitState). Returns null (never a bogus number)
// when the vehicles are not comparable — different refs, not both
// propagated, or the ref/loop data isn't resolvable.
function phaseTruthPropagated(osA, osB, metNow) {
  if (!osA || !osB) return null;
  if (!osA.propagated || !osB.propagated) return null;
  if (!osA.refId || osA.refId !== osB.refId) return null;
  const pA = _phaseVehiclePoint(osA, metNow), pB = _phaseVehiclePoint(osB, metNow);
  if (!pA || !pB) return null;
  const nA = _phaseNearestT(osA.refId, pA.r, pA.t);
  const nB = _phaseNearestT(osB.refId, pB.r, pB.t);
  if (!nA || !nB) return null;
  const P = nA.period_s;
  // Os._phaseOffsetS is an OPTIONAL stamped clock
  // correction — the recorded, guaranteed effect of an authored phasing-
  // burn pair (missionAddPhasingBurns / 570-mission-replay.js's BURN
  // branch), applied AFTER the geometric nearest-point search (never fed
  // into the search itself — the vehicle's real position is unaffected;
  // only its along-track CLOCK reading advances/retards by the burn pair's
  // construction). Zero (the default, no phasing authored) reproduces R1's
  // original math exactly.
  const tA = nA.tPhase + (osA._phaseOffsetS || 0);
  const tB = nB.tPhase + (osB._phaseOffsetS || 0);
  const dt = _phaseWrapDt(tA - tB, P);
  // Distance equivalent: the ACTUAL chord between the two vehicles' real
  // current position vectors — exact (no linearization), since we already
  // have both real r's in hand for this path. (The Δt×local-speed framing is
  // used instead in the Keplerian fallback below, where no real vectors
  // exist to chord between
  // different distance framings.)
  const distKm = physMag(physSub(pA.r, pB.r));
  return { dt_s: dt, distKm, capture: Math.abs(dt) <= PHASE_CAPTURE_WINDOW_S, period_s: P };
}

// Public: Keplerian mean-anomaly phase error, pure/gate-tested. bodyMu in
// km^3/s^2, a_km = semi-major axis, M_A_deg/M_B_deg = mean anomalies (deg).
// NOT wired to live orbitState (see file header) — a standalone honest
// primitive for synthetic two-vehicle cases and any future consumer that
// starts tracking real anomaly/epoch on classical orbits.
function phaseTruthKeplerian(bodyMu, a_km, M_A_deg, M_B_deg) {
  if (!(bodyMu > 0) || !(a_km > 0)) return null;
  const n = Math.sqrt(bodyMu / (a_km * a_km * a_km));   // rad/s, mean motion
  const P = 2 * Math.PI / n;
  const dM = (((M_A_deg - M_B_deg) * Math.PI / 180 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const dt = dM / n;
  // Δt × local (circular-approx) speed — the only distance estimate available
  // without real state vectors; a first-order linearization, honestly weaker
  // than the chord distance the propagated path can compute directly.
  const vcirc = Math.sqrt(bodyMu / a_km);
  const distKm = Math.abs(dt) * vcirc;
  return { dt_s: dt, distKm, capture: Math.abs(dt) <= PHASE_CAPTURE_WINDOW_S, period_s: P };
}

// Dispatch: try the propagated-ref path, else the Keplerian path (peri/apo/inc
// match within progOrbitalStateMatch-like tolerance) — used by any consumer
// (HUD, RENDEZVOUS readiness) that just has two orbitState-shaped records and
// wants "are these co-orbital, and if so what's the phase error". Returns
// null when the two orbits are disjoint (never a bogus number).
function phaseTruthBetween(osA, osB, metNow) {
  if (!osA || !osB) return null;
  const prop = phaseTruthPropagated(osA, osB, metNow);
  if (prop) return prop;
  // classical fallback: today's OrbitalState has no anomaly/epoch to diff
  // (see header) — same-orbit classical vehicles are recognized as
  // co-orbital (peri/apo/inc match) but phase is genuinely UNKNOWN data, so
  // return null rather than fabricate a mean-anomaly reading with no source.
  return null;
}

// Compact "2h 41m" / "41m 12s" / "3.2d" style formatter for the HUD/event-card
// readout (sign omitted — callers show "ahead"/"behind" via the raw sign of
// dt_s if they want it; the spec's example strings are magnitude-only).
function _phaseFmtDt(dt_s) {
  if (dt_s == null || !isFinite(dt_s)) return '—';
  const s = Math.abs(Math.round(dt_s));
  const days = Math.floor(s / 86400);
  if (days >= 1) return `${(s / 86400).toFixed(1)}d`;
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (hrs >= 1) return `${hrs}h${mins}m`;
  const secs = s % 60;
  if (mins >= 1) return `${mins}m${secs}s`;
  return `${secs}s`;
}
function _phaseFmtDistKm(distKm) {
  if (distKm == null || !isFinite(distKm)) return '—';
  return Math.round(distKm).toLocaleString() + ' km';
}

// ─── 5b R3 (MATH.md §7af) — terminal two-impulse phasing burns ─────────────
// Classic phasing-orbit construction: given a residual along-track offset
// Δt_phase (R1's own measurement) and a user-chosen rev count N (1-5), the
// phasing orbit's period is offset by ΔP = Δt_phase / N so that after N revs
// the phasing vehicle has drifted exactly Δt_phase relative to the ref —
// closing the gap by construction ( for why this "the
// target also moves" concern is a non-issue: Δt_phase is ALREADY the
// relative offset between the two clocks, not an absolute position).
// Burn happens at periapsis (perilune for the NRHO case) both ways: raise/
// lower the OTHER apsis to retime the period, then undo it N revs later.
const PHASING_MAX_N = 5;
// |ΔP| must stay under this fraction of the reference period or the
// "phasing orbit" is no longer a sane perturbation of the parked orbit
// (e.g. an inverted or near-degenerate ellipse) — a documented, un-derived
// round-number guard, same discipline as NRHO_PHASE_DV_BAND.
const PHASING_FEASIBLE_FRAC = 0.5;

// Pure construction, shared by both the propagated (NRHO) and Keplerian
// callers below: given the reference orbit's period P_s and periapsis
// radius rPeri_km (both about a body of gravitational parameter mu,
// km^3/s^2), retime by deltaP_s = dtPhase_s / N via a periapsis-tangent
// burn that changes ONLY the period (vis-viva at the fixed periapsis
// radius — the two-body approximation the spec calls for; honest even
// when the reference orbit is itself a 3-body NRHO).
function physPhasingSolve(P_s, dtPhase_s, N, mu, rPeri_km) {
  if (!(P_s > 0) || !(N >= 1) || !(mu > 0) || !(rPeri_km > 0)) return null;
  const aRef_km = Math.cbrt(mu * P_s * P_s / (4 * Math.PI * Math.PI));
  const deltaP_s = dtPhase_s / N;
  const feasible = Math.abs(deltaP_s) < PHASING_FEASIBLE_FRAC * P_s && (rPeri_km < 2 * aRef_km);
  const aPhasing_km = Math.cbrt(mu * Math.pow(P_s + deltaP_s, 2) / (4 * Math.PI * Math.PI));
  const vPeriRef_kms = Math.sqrt(mu * (2 / rPeri_km - 1 / aRef_km));
  const vPeriPhasing_kms = Math.sqrt(mu * (2 / rPeri_km - 1 / aPhasing_km));
  const dvPerBurn_ms = Math.abs(vPeriPhasing_kms - vPeriRef_kms) * 1000;
  const waitTime_s = N * (P_s + deltaP_s);
  return { N, deltaP_s, aRef_km, aPhasing_km, dvPerBurn_ms, dvTotal_ms: dvPerBurn_ms * 2, waitTime_s, feasible };
}

// Propagated-ref (NRHO) construction: rPeri_km comes straight off the
// catalog's own MEASURED peri/apo fields (425's refOrbitResolve — the same
// "approximate, not Keplerian truth" numbers R1/R2 already treat as ground
// truth for this orbit; nothing new is measured here). aRef_km is derived
// from the period via Kepler's third law rather than from (peri+apo)/2,
// since the period is the one number this whole construction must hit
// exactly (peri/apo are secondary, approximate labels on a 3-body orbit).
function phasingPlanPropagated(refId, dtPhase_s, N, muBody) {
  const res = refOrbitResolve(refId);
  if (!res || res.kind !== 'propagated' || !res.period_s || !(res.periKm > 0)) return null;
  const mu = muBody || (PROG_BODIES[res.body] && PROG_BODIES[res.body].mu);
  if (!mu) return null;
  return physPhasingSolve(res.period_s, dtPhase_s, N, mu, res.periKm);
}

// Keplerian construction: textbook, same physPhasingSolve, periapsis radius
// and period derived from the classical orbitState's own peri/apo altitudes
// (360's progMakeOrbitalState convention: apogee/perigee are ALTITUDES above
// the body's surface).
function phasingPlanKeplerian(orbitState, dtPhase_s, N) {
  if (!orbitState) return null;
  const b = PROG_BODIES[orbitState.body];
  if (!b) return null;
  const rPeri_km = b.R + (orbitState.perigee ?? 0);
  const rApo_km = b.R + (orbitState.apogee ?? 0);
  const aRef_km = (rPeri_km + rApo_km) / 2;
  const P_s = 2 * Math.PI * Math.sqrt(Math.pow(aRef_km, 3) / b.mu);
  return physPhasingSolve(P_s, dtPhase_s, N, b.mu, rPeri_km);
}

// UI-facing: the N=1..5 option list for a given residual phase error, either
// against a propagated ref (refId given) or a Keplerian orbitState. Drops
// infeasible (|ΔP| too large) options rather than showing a nonsense burn.
function phasingOptionsFor(dtPhase_s, refId, orbitState, muBody) {
  const out = [];
  for (let N = 1; N <= PHASING_MAX_N; N++) {
    const plan = refId
      ? phasingPlanPropagated(refId, dtPhase_s, N, muBody)
      : phasingPlanKeplerian(orbitState, dtPhase_s, N);
    if (plan && plan.feasible) out.push(plan);
  }
  return out;
}
