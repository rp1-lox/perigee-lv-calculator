
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
//   nrho-nominal Lunar NRHO — kind:'propagated', NO seed. resolve() returns
//                null + note 'seeded in Phase 4' per spec.
//
// Persistence: user tier + program one-offs join _buildSessionObject (455)
// and buildProgramObject/applyProgramObject (450) exactly like customThemes.

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
  { id: 'nrho-nominal', name: 'Lunar NRHO (9:2)', body: 'Moon', kind: 'propagated' },
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
// with no seedState (i.e. the nrho-nominal placeholder) resolve to null with
// a note — Phase 4 seeds them; nothing downstream should throw on that.
function refOrbitResolve(id) {
  const o = refOrbitGet(id);
  if (!o) return null;
  if (o.kind === 'propagated' && !o.seedState) {
    return { body: o.body, peri: null, apo: null, inc: null, kind: 'propagated', note: 'seeded in Phase 4' };
  }
  return {
    body: o.body,
    peri: o.peri, apo: o.apo, inc: o.inc,
    lan: o.lan, argp: o.argp,
    kind: o.kind,
  };
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
