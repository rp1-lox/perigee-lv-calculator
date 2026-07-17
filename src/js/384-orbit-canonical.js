// ═══════════════════════════════════════════════════════════════════════════
// C2 — Canonical orbit object + normalize shim
// (MISSION_MODEL_V2.md §24 C2, UNIFICATION_AUDIT item 2 — the keystone step)
//
// The program grew a dialect explosion for the same physical thing (an orbit):
// the SAME quantity appears as alt_km / perigee / peri, apo_km / apogee / apo,
// inc_deg / inclination / inc, lan_deg / lan. Mean radius and the world-frame
// orbit-normal were each re-derived inline in 3+ places. Every hand field-rename
// between dialects was a place a converter could drop or mistranslate a field —
// the disease behind the week's frame bugs. C2 introduces ONE canonical shape
// plus a normalize shim so consumers can migrate to reading through it
// incrementally (adapters first — THIS phase; per-module field renames second).
//
//   CANONICAL SHAPE: { body, periKm, apoKm, incDeg, lanDeg, argpDeg?, frame }
//     - body    : body name string ('Earth' default when absent).
//     - periKm  : periapsis ALTITUDE above the body surface, km.
//     - apoKm   : apoapsis  ALTITUDE above the body surface, km.
//     - incDeg  : inclination, degrees.
//     - lanDeg  : longitude of ascending node (RAAN), degrees.
//     - argpDeg : argument of periapsis, degrees (optional; absent for the
//                 circular-parking dialects that never carry it).
//     - frame   : 'eq' (equator-authored — the program's authoring default) or
//                 'world' (ecliptic/world). ABSENT ⇒ 'eq' (C1 convention). This
//                 module always emits an explicit 'eq'|'world'.
//
// This module is pure/definitions-only; load order (filename-sort concatenation)
// is irrelevant — it is placed at 384 for logical adjacency to the 385 physics
// core and its C1 frame boundary, which composes on top of orbitNormalize.
// ═══════════════════════════════════════════════════════════════════════════

/** Normalize any of the program's orbit dialects to the ONE canonical shape
 *  documented above. Accepts every dialect in the UNIFICATION_AUDIT item-2
 *  table (verified against the live code, 2026-07-17):
 *    - mission event  e.orbit : {body, alt_km(=peri), apo_km, inc_deg, lan_deg}
 *    - node-map/catalog builtin : {body, perigee, apogee, inclination, lan|lan_deg}
 *    - refOrbitResolve keplerian: {body, peri, apo, inc, lan, argp}
 *    - vehicle orbitState (os)  : {body, perigee, apogee, inclination, lan, frame}
 *    - already-canonical        : idempotent passthrough.
 *
 *  AMBIGUITY RULE (documented precedence): when BOTH a canonical key and a
 *  legacy alias are present on the same input, the CANONICAL key wins
 *  (periKm over alt_km/peri/perigee, etc.). Resolution is silent — nothing is
 *  logged — but the precedence is fixed here so it can never drift.
 *
 *  CIRCULAR FILL: if exactly one of peri/apo is present the other mirrors it
 *  (matches every consumer's `peri ?? apo` / `apo ?? peri` fallback), so a
 *  circular orbit authored with a single radius normalizes with periKm===apoKm.
 *
 *  NULL CONTRACT (mirrors physKeplerPropagate's null return): a state-vector
 *  orbit that has NO Keplerian element form — a `propagated` orbit
 *  (os.propagated truthy or kind==='propagated') or a pre-orbit `surface`
 *  state (os.surface truthy) — returns `null`. Callers MUST handle null the
 *  same way they handle physKeplerPropagate === null.
 *
 *  @returns {{body,periKm,apoKm,incDeg,lanDeg,argpDeg,frame}|null}
 */
function orbitNormalize(o) {
  if (!o || typeof o !== 'object') return null;
  // Non-Keplerian state orbits have no canonical element form.
  if (o.propagated || o.surface || o.kind === 'propagated') return null;

  const body = o.body || 'Earth';
  // Radii (canonical key wins, then dialect aliases). null when wholly absent.
  let periKm = o.periKm != null ? o.periKm
             : (o.alt_km != null ? o.alt_km
             : (o.peri   != null ? o.peri
             : (o.perigee != null ? o.perigee : null)));
  let apoKm  = o.apoKm != null ? o.apoKm
             : (o.apo_km != null ? o.apo_km
             : (o.apo    != null ? o.apo
             : (o.apogee != null ? o.apogee : null)));
  // Circular fill: one radius present ⇒ mirror it; neither present ⇒ 0.
  if (periKm == null && apoKm == null) { periKm = 0; apoKm = 0; }
  else if (periKm == null) periKm = apoKm;
  else if (apoKm == null) apoKm = periKm;

  const incDeg = (o.incDeg != null ? o.incDeg
               : (o.inc_deg != null ? o.inc_deg
               : (o.inclination != null ? o.inclination
               : (o.inc != null ? o.inc : 0)))) || 0;
  const lanDeg = (o.lanDeg != null ? o.lanDeg
               : (o.lan_deg != null ? o.lan_deg
               : (o.lan != null ? o.lan : 0))) || 0;
  // argp is optional — only emit it when the input actually carried one.
  const argpRaw = o.argpDeg != null ? o.argpDeg
                : (o.argp_deg != null ? o.argp_deg
                : (o.argp != null ? o.argp : null));

  // frame: honor an explicit 'eq'|'world'; anything else (absent, or the
  // body-name "frame" that refOrbitResolve/orbitState stamp on propagated
  // entries — which already returned null above) defaults to 'eq' (C1).
  const frame = (o.frame === 'world') ? 'world' : 'eq';

  const canon = { body, periKm, apoKm, incDeg, lanDeg, frame };
  if (argpRaw != null) canon.argpDeg = argpRaw;
  return canon;
}

/** Mean orbital radius (km, measured from body CENTER): bodyR + mean altitude.
 *  Replaces the `bodyR + ((peri ?? apo ?? 0)+(apo ?? peri ?? 0))/2` idiom that
 *  the audit found re-derived inline in 3+ spots. Returns null for a
 *  non-Keplerian orbit (orbitNormalize null contract). */
function orbitMeanRadiusKm(o, bodyR) {
  const c = orbitNormalize(o);
  if (!c) return null;
  return (bodyR || 0) + (c.periKm + c.apoKm) / 2;
}

/** Keplerian orbital period (seconds) from a canonical/dialect orbit and the
 *  body's μ (km³/s²). a = mean radius (semi-major axis for the ellipse whose
 *  peri/apo altitudes are periKm/apoKm). T = 2π√(a³/μ). Returns null for a
 *  non-Keplerian orbit or a missing/degenerate μ. bodyR defaults to the orbit
 *  body's PROG_BODIES radius when omitted. */
function orbitPeriodS(o, mu, bodyR) {
  const c = orbitNormalize(o);
  if (!c || !(mu > 0)) return null;
  if (bodyR == null && typeof PROG_BODIES !== 'undefined' && PROG_BODIES[c.body]) bodyR = PROG_BODIES[c.body].R;
  const a = (bodyR || 0) + (c.periKm + c.apoKm) / 2;
  if (!(a > 0)) return null;
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}

/** Unit orbit-normal in the WORLD (ecliptic) frame for a canonical/dialect
 *  orbit. Composes the C1 frame boundary (orbitWorldElements, 385) with the
 *  ONE normal recipe (physNormalFromIncLan, 385: [sin i·sin Ω, −sin i·cos Ω,
 *  cos i]) so the recipe — previously copy-pasted into verification code —
 *  lives in exactly one place. Returns null for a non-Keplerian orbit, or if
 *  the 385 helpers aren't loaded (headless callers without physics). */
function orbitWorldNormal(o) {
  const c = orbitNormalize(o);
  if (!c) return null;
  if (typeof orbitWorldElements !== 'function' || typeof physNormalFromIncLan !== 'function') return null;
  const w = orbitWorldElements(c); // eq→world seam (identity for frame:'world')
  return physNormalFromIncLan(w.incDeg, w.lanDeg);
}
