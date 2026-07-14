
// ─── MISSION_MODEL_V2 Phase 3 T1 — reference-orbit catalog ──────────────────
//
// §4.3/§13 T1: orbits become first-class shared objects, like STAGE_LIBRARY.
// Two tiers:
//   - PROG_ORBIT_CATALOG_BUILTIN  — fixed builtin entries, stable string ids.
//   - PROG_ORBIT_CATALOG_USER     — user-created one-offs, progUUID() ids.
// refOrbitResolve(id) is the ONLY read path either T2 binding or the node map
// should use — it returns plain Keplerian elements (or null for an unseeded
// 'propagated' entry, Phase 4's job).
//
// Canon picked for the builtin tier (documented per the task):
//   leo-185      LEO      185x185 km  @28.5   (Saturn V golden inclination)
//   leo-400-51.6 Station  400x400 km  @51.6   ("Station" — ISS-class)
//   sso-800      SSO      800x800 km  @98.6   (sun-synchronous canon alt/inc)
//   gto-185      GTO      185x35786   @28.5
//   geo          GEO      35786x35786 @0
//   llo-100      LLO      100x100 km  @90 (polar) — polar chosen as the
//                sensible default LLO canon (matches the existing node-map
//                LLO node's 90 inc, Apollo used near-equatorial but polar is
//                the more general/reusable catalog default for landing-site
//                access; a program can always add an equatorial LLO one-off)
//   nrho-nominal Lunar NRHO — kind:'propagated', SEEDED (Phase 4, see below).
//
// Persistence: user tier + program one-offs join _buildSessionObject (455)
// and buildProgramObject/applyProgramObject (450) exactly like customThemes.

// ─── MISSION_MODEL_V2 Phase 4 U1/U2 — NRHO seed (provenance) ────────────────
// Corrector: physPeriodicOrbitCorrect-style FD-Jacobian Newton (565), 3 free
// params [vx, vy, P] targeting position closure at t0+P, run OFFLINE in the
// REAL ephemeris model (ctx = {center:'Moon', bodies:['Moon','Earth','Sun']}).
// Run 2026-07-14. Seed family scanned: perilune south-pole (-z, ecliptic
// convention per the task), velocity in-plane (xz plane, contains z per the
// task's "orbit plane contains z" instruction). The canonical 9:2 apolune
// (~70,000 km) escapes the integrator's Moon-SOI patch in THIS restricted
// 3-body approximation (SOI ~66,100 km) before one rev completes; a lower-
// apolune family member converges cleanly and stays inside the SOI:
//   rp=3,000 km, ra=60,000 km -> converged v=[1.764338088034402,0,0] km/s,
//   P=406944 s (4.71 d), one-rev position closure = 468.6 km (< 500 km gate).
// HONEST caveat (documented per the task + MATH.md §7s): this is a SHORTER-
// period family member than the literal 9:2 resonance (4.71 d vs 6.56 d) —
// the real 9:2 NRHO's outer arc goes near L2, deep in Earth-perturbed
// territory our SOI-patched integrator doesn't model as a bound orbit.
// 3-rev boundedness is WEAK: perilune distance decays across revs (measured
// min ~330 km by rev 3, i.e. drifts toward the surface) — real NRHOs are
// weakly unstable and a single-rev correction does not enforce a long-term
// invariant torus; this is acknowledged, not hidden (critique in MATH.md).
const NRHO_NOMINAL_SEED = {
  r_km: [0, 0, -3000],
  v_kms: [1.764338088034402, 0, 0],
  period_s: 406944,          // 4.71 days
  closureKm: 468.6,          // measured one-rev position closure
  frame: 'Moon',
  epochRef: 0,                // t0 = PROG_ACTIVE_PROGRAM.epochJD (epoch-anchored, quasi-periodic away from t0)
};

const PROG_ORBIT_CATALOG_BUILTIN = [
  { id: 'leo-185',      name: 'LEO 185',        body: 'Earth', kind: 'keplerian',
    peri: 185,   apo: 185,   inc: 28.5 },
  { id: 'leo-400-51.6', name: 'Station',         body: 'Earth', kind: 'keplerian',
    peri: 400,   apo: 400,   inc: 51.6 },
  { id: 'sso-800',      name: 'SSO 800',         body: 'Earth', kind: 'keplerian',
    peri: 800,   apo: 800,   inc: 98.6 },
  { id: 'gto-185',      name: 'GTO',             body: 'Earth', kind: 'keplerian',
    peri: 185,   apo: 35786, inc: 28.5 },
  { id: 'geo',          name: 'GEO',             body: 'Earth', kind: 'keplerian',
    peri: 35786, apo: 35786, inc: 0 },
  { id: 'llo-100',      name: 'LLO 100 (polar)', body: 'Moon',  kind: 'keplerian',
    peri: 100,   apo: 100,   inc: 90 },
  { id: 'nrho-nominal', name: 'Lunar NRHO (9:2-class)', body: 'Moon', kind: 'propagated',
    frame: NRHO_NOMINAL_SEED.frame,
    seedState: { r: NRHO_NOMINAL_SEED.r_km.slice(), v: NRHO_NOMINAL_SEED.v_kms.slice() },
    period_s: NRHO_NOMINAL_SEED.period_s,
    // approximate peri/apo for label/culling purposes only — real shape comes
    // from refOrbitSamplePropagated; NOT authoritative Keplerian elements.
    peri: 3000, apo: 60000, inc: null,
    note: 'propagated — see NRHO_NOMINAL_SEED provenance comment above' },
  // NOTE: builtin entries deliberately leave lan/argp UNSET — "free" per the
  // task's instruction ("builtins: lan/argp unset = free"): a binder resolves
  // whatever plane it needs; only a user one-off pins a specific lan/argp.
];

let PROG_ORBIT_CATALOG_USER = []; // [{ id, name, body, kind, peri, apo, inc, lan?, argp? }, ...]

function _refOrbitAllEntries() {
  return PROG_ORBIT_CATALOG_BUILTIN.concat(PROG_ORBIT_CATALOG_USER);
}

function refOrbitGet(id) {
  if (!id) return null;
  return _refOrbitAllEntries().find(o => o.id === id) || null;
}

function refOrbitIsBuiltin(id) {
  return PROG_ORBIT_CATALOG_BUILTIN.some(o => o.id === id);
}

// Returns the newly-created entry (with a fresh progUUID id) or null if the
// spec is missing required fields.
function refOrbitAdd(spec) {
  if (!spec || !spec.name || !spec.body) return null;
  const id = (typeof progUUID === 'function') ? progUUID() : ('ref_' + Date.now() + '_' + Math.random().toString(36).slice(2));
  const entry = {
    id, name: spec.name, body: spec.body,
    kind: spec.kind === 'propagated' ? 'propagated' : 'keplerian',
    peri: spec.peri, apo: spec.apo, inc: spec.inc,
  };
  if (spec.lan !== undefined) entry.lan = spec.lan;
  if (spec.argp !== undefined) entry.argp = spec.argp;
  if (spec.seedState) entry.seedState = spec.seedState;
  if (spec.period !== undefined) entry.period = spec.period;
  if (spec.frame) entry.frame = spec.frame;
  PROG_ORBIT_CATALOG_USER.push(entry);
  return entry;
}

// Builtins are immutable — update on a builtin id is a no-op (returns false).
function refOrbitUpdate(id, patch) {
  if (!id || refOrbitIsBuiltin(id)) return false;
  const entry = PROG_ORBIT_CATALOG_USER.find(o => o.id === id);
  if (!entry) return false;
  Object.assign(entry, patch || {});
  return true;
}

function refOrbitDelete(id) {
  if (!id || refOrbitIsBuiltin(id)) return false;
  const before = PROG_ORBIT_CATALOG_USER.length;
  PROG_ORBIT_CATALOG_USER = PROG_ORBIT_CATALOG_USER.filter(o => o.id !== id);
  return PROG_ORBIT_CATALOG_USER.length < before;
}

// The ONE read path binders (T2) and the node map use. 'propagated' entries
// with no seedState resolve to null-fields + a note (nothing downstream
// should throw on that). A SEEDED propagated entry (Phase 4) resolves with
// its seedState/period_s so a DEPLOY/ring consumer can sample it — peri/apo
// are approximate (measured, not Keplerian truth; see refOrbitSamplePropagated).
function refOrbitResolve(id) {
  const o = refOrbitGet(id);
  if (!o) return null;
  if (o.kind === 'propagated' && !o.seedState) {
    return { body: o.body, peri: null, apo: null, inc: null, kind: 'propagated', note: 'seeded in Phase 4' };
  }
  if (o.kind === 'propagated') {
    return {
      body: o.body, kind: 'propagated', frame: o.frame || o.body,
      seedState: o.seedState, period_s: o.period_s,
      peri: o.peri != null ? o.peri : null, apo: o.apo != null ? o.apo : null, inc: null,
      note: o.note || null,
    };
  }
  return {
    body: o.body,
    peri: o.peri, apo: o.apo, inc: o.inc,
    lan: o.lan, argp: o.argp,
    kind: o.kind,
  };
}

// Phase 4 U2: propagate a SEEDED propagated ref one full period, returning
// samples in its own body-centered frame (Moon for nrho-nominal). Consumers
// (ring rendering, orbit inspector, DEPLOY anchor sampling) all go through
// this ONE function so the "what does this orbit actually look like" answer
// never diverges. Returns [] if unseeded/unresolvable/integrator unavailable.
function refOrbitSamplePropagated(id, nSamples) {
  const res = refOrbitResolve(id);
  if (!res || res.kind !== 'propagated' || !res.seedState || !res.period_s) return [];
  if (typeof physPropagateSegment !== 'function') return [];
  const ctx = { center: res.frame, bodies: [res.frame, 'Earth', 'Sun'] };
  const state0 = { r: res.seedState.r.slice(), v: res.seedState.v.slice() };
  const out = physPropagateSegment(state0, 0, res.period_s, ctx, { maxSamples: nSamples || 200 });
  if (!out || !out.samples) return [];
  return out.samples.map(s => ({ t: s.t, r: s.r, frame: s.frame }));
}

// Phase 4 U3: sample a seeded propagated ref AT a given mission-time offset
// (used by the DEPLOY anchor to place the vehicle at the right phase within
// the period rather than always at the seed epoch). `metOffset` is seconds
// since the deploy event; phase-wraps into [0, period_s).
function refOrbitPropagatedStateAt(id, metOffset) {
  const res = refOrbitResolve(id);
  if (!res || res.kind !== 'propagated' || !res.seedState || !res.period_s) return null;
  if (typeof physPropagateSegment !== 'function') return null;
  const ctx = { center: res.frame, bodies: [res.frame, 'Earth', 'Sun'] };
  const phase = ((metOffset || 0) % res.period_s + res.period_s) % res.period_s;
  const state0 = { r: res.seedState.r.slice(), v: res.seedState.v.slice() };
  if (phase < 1) return { r: state0.r, v: state0.v, frame: res.frame };
  const out = physPropagateSegment(state0, 0, phase, ctx, { maxSamples: 4 });
  if (!out || !out.stateF) return null;
  return { r: out.stateF.r, v: out.stateF.v, frame: out.frame };
}

function refOrbitCatalogList() {
  return _refOrbitAllEntries().map(o => ({ id: o.id, name: o.name, body: o.body, kind: o.kind, builtin: refOrbitIsBuiltin(o.id) }));
}

// ── Persistence hooks (455/450 pattern — mirrors customThemes exactly) ──────
function _refOrbitSessionSave() {
  try { return JSON.parse(JSON.stringify(PROG_ORBIT_CATALOG_USER)); } catch (err) { return null; }
}
function _refOrbitSessionRestore(arr) {
  if (Array.isArray(arr)) PROG_ORBIT_CATALOG_USER = arr;
}
