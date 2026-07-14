
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

// ─── MISSION_MODEL_V2 §17 N2 — TRUE 9:2 NRHO seed (provenance) ─────────────
// Superseded 2026-07-14 (N1 removed the SOI-wall constraint that forced the
// old rp=3,000/ra=60,000, 4.71 d compromise — see git history / MATH.md §7s
// for that context; critique 61 retired in §7v).
//
// Corrector: `node tests/corrector_harness.js nrho` (the re-runnable
// provenance for every seed pinned here), 2026-07-14. Method that WORKED,
// after two documented failures (§7v):
//   - perilune-seeded shooting collapsed onto a small non-NRHO loop and FD
//     Newton stalled at iteration 0 (the full-period map through perilune is
//     so sensitive that finite-difference Jacobians are noise-dominated);
//   - seed at APOLUNE instead (slow, well-conditioned dynamics): southern-
//     family rotating-frame r=[xa,0,-za], v=[0,vy,0], P LOCKED to the literal
//     9:2 synodic resonance (29.530589 d * 2/9 = 566,987.3 s), then a
//     derivative-free compass/pattern search on [xa,za,vy] minimizing
//     |r(t0+P)-r(t0)| in the instantaneous Earth-Moon ROTATING frame — the
//     frame where a three-body orbit is actually (quasi-)periodic.
// Propagation: REAL ephemeris, ctx={center:'Moon',bodies:['Moon','Earth','Sun']},
// singleFrame:true (N1 proved handoffs are pure coordinate bookkeeping).
//
// CONVERGED (measured, ~220 search evaluations): xa=18,417.97 km,
// za=68,440.43 km, vy=-0.1449707 km/s at P=566,987.3 s (6.5624 d, EXACT 9:2):
//   rotating-frame closure  = 345.6 km / 28.33 m/s   (old seed: 468.6 km)
//   perilune/apolune (1 rev)= 5,544 / 71,203 km      (real Gateway-class shape)
//   3-rev boundedness       = 3,199 / 72,195 km      (bounded, no escape)
// NOTE the INERTIAL Moon-frame closure is 27,241 km and that is CORRECT
// PHYSICS, not an error: the rotating frame turns ~86.5° per 6.56 d rev, so a
// rotating-frame-periodic orbit never closes inertially. Every consumer that
// phase-wraps this orbit MUST wrap in the rotating frame (see
// refOrbitPropagatedStateAt / refOrbitSamplePropagated below); the old seed
// tolerated inertial wrapping only because it was corrected inertially.
const NRHO_NOMINAL_SEED = {
  r_km: [18219.2291035, 15494.38552169, -66718.04626085],
  v_kms: [0.05068548537847, -0.07685209763387, -0.004006795365559],
  period_s: 566987.3,          // 6.5624 d — the literal 9:2 synodic resonance
  closureRotKm: 345.6,         // measured one-rev ROTATING-frame position closure
  closureRotVelMs: 28.33,      // measured one-rev rotating-frame velocity closure
  frame: 'Moon',
  epochRef: 0,                // t0 = PROG_ACTIVE_PROGRAM.epochJD (epoch-anchored, quasi-periodic away from t0)
};

// ─── §17 N2 — EML1 planar Lyapunov seed (provenance) ────────────────────────
// Same harness (`node tests/corrector_harness.js lyap`), same rotating-frame
// pattern search, 2026-07-14. Seed on the Earth-Moon line Moon-ward of L1
// (L1 at -55,835 km from the Moon at t0), planar (z≈0), free [vy, P].
// CONVERGED: vy=-0.1593066 km/s, P=1,073,193 s = 12.421 d:
//   rotating-frame closure = 47.4 km / 16.94 m/s   (tightest orbit shipped)
//   Moon-distance min/max  = 9,812 / 41,118 km
//   3-rev boundedness      = 9,813 / 41,116 km     (essentially invariant)
const EML1_LYAPUNOV_SEED = {
  r_km: [-34060.04038065, -22296.1086471, -3206.293042091],
  v_kms: [0.1520427319945, -0.2305354836106, -0.01201930117416],
  period_s: 1073193.0,         // 12.421 d
  closureRotKm: 47.4,
  closureRotVelMs: 16.94,
  frame: 'Moon',
  epochRef: 0,
};

// ─── §17 N2 — EML1/EML2 southern halo seeds (provenance) ────────────────────
// Same harness (`node tests/corrector_harness.js eml1|eml2`), free-amplitude
// rotating-frame pattern search + fine polish restart, 2026-07-14. These are
// the single-shooting basin floors in the real ephemeris model — halos are
// genuinely quasi-periodic there, and EML2's is strongly unstable:
//   EML1 halo: closure 672.5 km / 44.12 m/s, P=11.106 d, r 51,488–61,496 km
//              (3-rev min decays to 4,956 km — unstable, as real halos are)
//   EML2 halo: closure 1,459.7 km / 45.97 m/s, P=13.711 d, r 48,011–73,856 km
//              (3-rev max ESCAPES to 705,611 km — L2 halos e-fold in days)
// Both are safe to ship because every catalog read path phase-wraps to at
// most ONE period from the seed (refOrbitPropagatedStateAt /
// refOrbitSamplePropagated) — the wrap acts as idealized station-keeping, so
// the multi-rev divergence never reaches a user-visible path. Documented as
// a critique in MATH.md §7v, not hidden.
const EML1_HALO_SEED = {
  r_km: [-45495.62608715, -28438.46343298, -30052.02700166],
  v_kms: [0.03974905976731, -0.06026969258125, -0.003142247672519],
  period_s: 959543.8,          // 11.106 d
  closureRotKm: 672.5,
  closureRotVelMs: 44.12,
  frame: 'Moon',
  epochRef: 0,
};
const EML2_HALO_SEED = {
  r_km: [53455.26172791, 37077.6876603, -34963.64865522],
  v_kms: [-0.01586593820016, 0.02405680092647, 0.001254236142279],
  period_s: 1184607.2,         // 13.711 d
  closureRotKm: 1459.7,
  closureRotVelMs: 45.97,
  frame: 'Moon',
  epochRef: 0,
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
  { id: 'nrho-nominal', name: 'Lunar NRHO (true 9:2)', body: 'Moon', kind: 'propagated',
    frame: NRHO_NOMINAL_SEED.frame,
    seedState: { r: NRHO_NOMINAL_SEED.r_km.slice(), v: NRHO_NOMINAL_SEED.v_kms.slice() },
    period_s: NRHO_NOMINAL_SEED.period_s,
    // approximate peri/apo for label/culling purposes only — real shape comes
    // from refOrbitSamplePropagated; NOT authoritative Keplerian elements.
    peri: 5544, apo: 71203, inc: null,
    note: 'propagated — see NRHO_NOMINAL_SEED provenance comment above' },
  { id: 'eml1-lyapunov', name: 'EML1 Lyapunov', body: 'Moon', kind: 'propagated',
    frame: EML1_LYAPUNOV_SEED.frame,
    seedState: { r: EML1_LYAPUNOV_SEED.r_km.slice(), v: EML1_LYAPUNOV_SEED.v_kms.slice() },
    period_s: EML1_LYAPUNOV_SEED.period_s,
    peri: 9812, apo: 41118, inc: null,
    note: 'propagated — see EML1_LYAPUNOV_SEED provenance comment above' },
  { id: 'eml1-halo-s', name: 'EML1 Halo (southern)', body: 'Moon', kind: 'propagated',
    frame: EML1_HALO_SEED.frame,
    seedState: { r: EML1_HALO_SEED.r_km.slice(), v: EML1_HALO_SEED.v_kms.slice() },
    period_s: EML1_HALO_SEED.period_s,
    peri: 51488, apo: 61496, inc: null,
    note: 'propagated — see EML1_HALO_SEED provenance comment above' },
  { id: 'eml2-halo-s', name: 'EML2 Halo (southern)', body: 'Moon', kind: 'propagated',
    frame: EML2_HALO_SEED.frame,
    seedState: { r: EML2_HALO_SEED.r_km.slice(), v: EML2_HALO_SEED.v_kms.slice() },
    period_s: EML2_HALO_SEED.period_s,
    peri: 48011, apo: 73856, inc: null,
    note: 'propagated — see EML2_HALO_SEED provenance comment above' },
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

// ── §17 N2 — Earth-Moon rotating frame (the frame where libration orbits are
// actually periodic). A rotating-frame-periodic orbit does NOT close in the
// inertial Moon frame (the frame turns ~86.5°/rev for the NRHO — measured
// inertial "closure" 27,241 km on a 345.6 km rotating-frame closure), so
// phase-wrapping MUST happen here: wrap in rotating coordinates at the
// wrapped epoch, reconstruct inertial at the TRUE epoch. Same math as
// tests/corrector_harness.js's emFrame/toRot/fromRot (keep in sync).
function _refEmRotBasis(t) {
  const e = physBodyStateAt('Earth', t), m = physBodyStateAt('Moon', t);
  const rE = physSub(e.r, m.r), vE = physSub(e.v, m.v);   // Earth rel Moon
  const d = physMag(rE);
  const xh = physScale(rE, -1 / d);                        // +x: away from Earth (L2 side)
  const h = physCross(rE, vE);
  const om = physScale(h, 1 / (d * d));                    // instantaneous angular velocity
  const zh = physScale(om, 1 / physMag(om));
  const yh = physCross(zh, xh);
  return { xh, yh, zh, om };
}
function _refToRot(state, t) {
  const f = _refEmRotBasis(t);
  const vr = physSub(state.v, physCross(f.om, state.r));
  const proj = a => [physDot(a, f.xh), physDot(a, f.yh), physDot(a, f.zh)];
  return { r: proj(state.r), v: proj(vr) };
}
function _refFromRot(rRot, vRot, t) {
  const f = _refEmRotBasis(t);
  const mk = c => physAdd(physAdd(physScale(f.xh, c[0]), physScale(f.yh, c[1])), physScale(f.zh, c[2]));
  const r = mk(rRot);
  return { r, v: physAdd(mk(vRot), physCross(f.om, r)) };
}
// Only Moon-frame refs get the rotating-frame treatment (the basis is the
// Earth-Moon line; another frame would need its own primary pair).
function _refRotCapable(res) {
  return res.frame === 'Moon' && typeof physBodyStateAt === 'function';
}

// Phase 4 U2: propagate a SEEDED propagated ref one full period, returning
// samples in its own body-centered frame (Moon for nrho-nominal). Consumers
// (ring rendering, orbit inspector, DEPLOY anchor sampling) all go through
// this ONE function so the "what does this orbit actually look like" answer
// never diverges. Returns [] if unseeded/unresolvable/integrator unavailable.
// N2: samples are re-based through the rotating frame to the SEED epoch —
// the drawn loop is the orbit's rotating-frame shape (which closes to the
// corrected 345.6 km), rendered in inertial Moon axes frozen at t=0. The raw
// inertial trace would show the ~27,000 km frame-rotation gap as a broken
// ring; frame-aware live rendering is N3's job (per-sample-epoch transform).
function refOrbitSamplePropagated(id, nSamples) {
  const res = refOrbitResolve(id);
  if (!res || res.kind !== 'propagated' || !res.seedState || !res.period_s) return [];
  if (typeof physPropagateSegment !== 'function') return [];
  const ctx = { center: res.frame, bodies: [res.frame, 'Earth', 'Sun'] };
  const state0 = { r: res.seedState.r.slice(), v: res.seedState.v.slice() };
  // singleFrame (N1): the true 9:2 apolune (71,203 km) crosses the Moon-SOI
  // bookkeeping boundary — without it, handoff re-centers samples to Earth
  // mid-loop and every consumer would have to re-patch them back. Same
  // dynamics (N1 gate-proof), one frame for all samples.
  const out = physPropagateSegment(state0, 0, res.period_s, ctx, { maxSamples: nSamples || 200, singleFrame: true });
  if (!out || !out.samples) return [];
  if (!_refRotCapable(res)) return out.samples.map(s => ({ t: s.t, r: s.r, frame: s.frame }));
  return out.samples.map(s => {
    const rot = _refToRot({ r: s.r, v: [0, 0, 0] }, s.t);   // position-only re-base
    const back = _refFromRot(rot.r, [0, 0, 0], 0);
    return { t: s.t, r: back.r, frame: s.frame };
  });
}

// Phase 4 U3: sample a seeded propagated ref AT a given mission-time offset
// (used by the DEPLOY anchor to place the vehicle at the right phase within
// the period rather than always at the seed epoch). `metOffset` is seconds
// since the deploy event; phase-wraps into [0, period_s).
// N2: the wrap happens in the ROTATING frame — propagate to the wrapped
// phase, take rotating coordinates at that epoch, reconstruct inertial at
// the TRUE epoch. This makes the returned state physically sensible for
// epochs beyond one period, and doubles as idealized station-keeping for the
// unstable halo entries (no consumer ever propagates a seed past one period).
function refOrbitPropagatedStateAt(id, metOffset) {
  const res = refOrbitResolve(id);
  if (!res || res.kind !== 'propagated' || !res.seedState || !res.period_s) return null;
  if (typeof physPropagateSegment !== 'function') return null;
  const ctx = { center: res.frame, bodies: [res.frame, 'Earth', 'Sun'] };
  const t = metOffset || 0;
  const phase = (t % res.period_s + res.period_s) % res.period_s;
  const state0 = { r: res.seedState.r.slice(), v: res.seedState.v.slice() };
  const canRot = _refRotCapable(res);
  let stPhase;
  if (phase < 1) stPhase = state0;
  else {
    // singleFrame: same rationale as refOrbitSamplePropagated — stay in the
    // seed's frame even where the loop crosses the SOI bookkeeping boundary.
    const out = physPropagateSegment(state0, 0, phase, ctx, { maxSamples: 4, singleFrame: true });
    if (!out || !out.stateF) return null;
    stPhase = out.stateF;
  }
  // same rev (t == phase): no re-basing needed
  if (!canRot || Math.abs(t - phase) < 1) return { r: stPhase.r, v: stPhase.v, frame: res.frame };
  const rot = _refToRot(stPhase, phase);
  const back = _refFromRot(rot.r, rot.v, t);
  return { r: back.r, v: back.v, frame: res.frame };
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
