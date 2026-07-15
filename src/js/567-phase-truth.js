// ─── 567: MISSION_MODEL_V2 §15 5b R1 — phase truth ───────────────────────────
// Phase math ONLY (measurement + display support). NO solving (R2), NO
// phasing burns (R3), NO dock links (R4) — see MATH.md §7ad for the full
// writeup (definition, capture-window rationale, Kepler fallback, critiques).
//
// Two vehicles "share an orbit" in a way phase can be measured for, today, in
// two shapes:
//  (a) both orbitState.propagated with the SAME refId (the Gateway/NRHO
//      case) — measured via each vehicle's nearest-point time parameter on
//      the ref's sampled loop, in the Earth-Moon ROTATING frame (§7v: a
//      rotating-frame-periodic orbit does not close inertially, so any
//      "where on the loop is this" comparison MUST happen in rotating
//      coordinates or it is comparing frame-rotation drift, not phase).
//  (b) both classical Keplerian orbits sharing (a, e, i) within tolerance —
//      mean-anomaly difference / mean motion. This path is pure/gate-tested
//      but NOT wired to live UI: today's OrbitalState (360's
//      progMakeOrbitalState) carries no mean-anomaly/epoch field for
//      classical orbits (every classical orbitState is epoch:0, always) —
//      there is nothing to diff. Wiring that requires adding real anomaly
//      tracking to classical orbitState, out of R1's "measurement using
//      EXISTING data" scope. Documented, not hidden (MATH.md §7ad critique).

// Capture window: TIME-based, not distance-based (spec offered either).
// Rationale (MATH.md §7ad): the NRHO is highly eccentric (perilune ~5,500 km
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
  if (typeof refOrbitPropagatedStateAt !== 'function') return null;
  const st = refOrbitPropagatedStateAt(os.refId, metNow || 0);
  if (!st) return null;
  return { r: st.r, t: metNow || 0 };
}

// Nearest-point time parameter: which sample of the ref's one-period raw loop
// (each sample keeping ITS OWN true epoch — 425's refOrbitSamplePropagatedRaw,
// the N3 live/un-rebased source) is closest to the query point, comparing in
// the Earth-Moon ROTATING frame at each sample's own epoch (§7v). Returns the
// WINNING SAMPLE'S EPOCH as the vehicle's "along-track clock" reading — not a
// literal position, a phase-position label on the loop.
function _phaseNearestT(refId, r, t, nSamples) {
  const res = (typeof refOrbitResolve === 'function') ? refOrbitResolve(refId) : null;
  if (!res || res.kind !== 'propagated' || !res.period_s) return null;
  if (typeof _refRotCapable !== 'function' || !_refRotCapable(res)) return null;   // only Moon-frame refs (§17 N2) get the rotating wrap
  if (typeof refOrbitSamplePropagatedRaw !== 'function' || typeof _refToRot !== 'function') return null;
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
  const dt = _phaseWrapDt(nA.tPhase - nB.tPhase, P);
  // Distance equivalent: the ACTUAL chord between the two vehicles' real
  // current position vectors — exact (no linearization), since we already
  // have both real r's in hand for this path. (The Δt×local-speed framing is
  // used instead in the Keplerian fallback below, where no real vectors
  // exist to chord between — see MATH.md §7ad for why the two paths pick
  // different distance framings.)
  const distKm = (typeof physSub === 'function' && typeof physMag === 'function')
    ? physMag(physSub(pA.r, pB.r)) : null;
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
// The compact chip readout string itself: "Δφ 2h41m · 8,910 km".
function _phaseChipText(phase) {
  if (!phase) return '';
  return `&Delta;&phi; ${_phaseFmtDt(phase.dt_s)} &middot; ${_phaseFmtDistKm(phase.distKm)}`;
}
