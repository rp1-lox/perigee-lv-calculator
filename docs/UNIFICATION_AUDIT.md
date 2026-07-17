# UNIFICATION AUDIT — fragmented definitions in Rocket Playground

Read-only audit (2026-07-17). Scope: `src/js` (~114 modules). Goal: enumerate every
concept represented multiple inconsistent ways, the dialects, the converters, and the
call sites that convert INLINE instead of through one boundary. Drives a refactor series
(will be referenced as MISSION_MODEL_V2 §24). No code was changed.

Severity legend: **SHIPPED** = this exact shape has already produced a user-facing bug;
**LATENT** = same shape, no bug yet observed. Blast radius = # of modules that touch the
concept. Migration cost S/M/L is engineering effort for the proposed unification.

---

## Executive summary — top 5 offenders (severity × blast radius)

1. **DONE (C1, 2026-07-17).** ~~Equator-vs-world frame conversion applied per-call-site, not
   at one boundary~~ (SHIPPED ×5 this week alone: b7d35afe0 rings, 36a46fd05 gizmo + event
   nodes, 9264919e0 NRHO, 28ed02b5e launch planner). `progEqToWorldElements` was called from
   **8 different modules** (566, 5741, 5742, 5744, 5745-hover, 565-nrho, 565-targeting;
   inverse from 415). Every consumer that turns authored `(inc, lan)` into a state vector
   or a rendered ring must remember to rotate first; the ones that forgot were the five
   bugs. The frame is an implicit property of the object, carried nowhere. **Root cause
   of the whole audit.** Blast radius: ~10 modules. Cost: **M**.
   Fixed by the C1 boundary: `orbitWorldElements(o)`/`orbitWorldState(o, thetaRad)`
   (385-physics-core.js) — all 8 call sites route through it, a gate test
   (tests/math.test.js) fails the build if any module outside 385 calls
   `progEqToWorldElements` directly. See MISSION_MODEL_V2.md §24 C1 as-built note.

2. **Orbit-shaped objects have ≥6 incompatible dialects** with no single reader.
   Mission events use `{alt_km, apo_km, inc_deg, lan_deg}`; node-map/catalog builtins use
   `{perigee, apogee, inclination, lan_deg}`; `refOrbitResolve` returns
   `{peri, apo, inc, lan, argp}`; vehicle `orbitState` uses `{perigee, apogee,
   inclination, lan, propagated, r, v, frame, surface}`; physics uses state vectors
   `{r, v, frame}`; `physElementsToState` wants `{a, e, i, raan, argp, nu}` in radians.
   Converters are inline field-copies (570-mission-events.js:724, 566:96-108). Blast
   radius: ~20 modules. Cost: **L**. This is the substrate that makes #1 dangerous —
   a canonical orbit object should carry its own frame tag.

3. **`launchOrbit` triplicated** — **DONE 2026-07-17 (C3, see docs/MISSION_MODEL_V2.md §24).**
   `m.launchOrbit`, `e.orbit`, and `e.launchOrbit` all
   hold the launch parking orbit, kept in sync by hand-spread copies
   (`e.launchOrbit = { ...o }` at 570-mission-events.js:726 and :879). Plus
   `e.orbitBefore`/`orbitAfter` on other event types. SHIPPED-adjacent (the launch-planner
   revert bug 364512b65 lived here). Blast radius: ~8 modules. Cost: **S**.
   `e.orbit` is now the single authored source on LAUNCH/DEPLOY entries; `e.launchOrbit`
   deleted from every writer/reader; `m.launchOrbit` demoted to a seed-default (new-draft
   prefill + `missionExecLaunch`) with a load-time migration for old logs. `e.orbitBefore`/
   `orbitAfter` were untouched (out of scope for this item).

4. **Mass/propellant field dialects across the vehicle stack**, with S1.5 fields
   hand-forwarded. Worksheet `stageStore` uses `{dry, prop, res, thrust, isp}` as
   **strings**; live-stage model (370) uses `{dry_mass, tanks, isp}`; presets/library
   use `{dry, prop}` as numbers. The `s15_*` sextet (sust_thrust, sust_isp, jet_mass,
   beco_twr, boost_isp) is copied field-by-field in ≥3 assemblers (210:211, 210:1814,
   plus the splitters). SHIPPED ×3 (the S1.5-splitter drop, per CLAUDE.md). Blast radius:
   ~12 modules. Cost: **M**.

5. **Time dialects** — `epochJD` (JD), MET seconds (`t_s`, `launchTime_s`, `metStart`),
   `at:{kind:'met', value_s}`, JD leg fields (`planDepJD`), `Date` objects, and
   `dataset.rawS` strings. Converters exist and are centralized in 360
   (`progEpochJD/progJDToDate/progMissionTimeToDate/progDateToMissionTime/progDateToJD`),
   which is the GOOD model — but call sites still store the same instant in different
   field names per event type. LATENT (converters are sound). Blast radius: ~20 modules.
   Cost: **S** (naming convergence, not new math).

---

## 1. Reference frame (equator-authored vs world/ecliptic) — WORST OFFENDER

### The seam
`progEqToWorldElements(body, inc_deg, lan_deg)` / `progWorldToEqElements(...)` in
**385-physics-core.js:178-192**. Pure change of orthonormal basis via `physEqBasis`
(body pole → equator frame). Round-trip is gate-pinned (§20). The math is correct and
single-sourced. **The problem is not the converter — it is that the obligation to CALL
it lives at every consumer.**

### Call-site inventory (the ones that DO rotate)
| File:line | What it rotates before |
|---|---|
| 566-mission-state-v2.js:102 | `physElementsToState` for LAUNCH/DEPLOY anchor |
| 565-physics-nrho.js:36 | `physAimBurnState` burn aim |
| 565-physics-targeting.js:259,370 | RAAN-solve + destination orbit normal |
| 5741-trajectory-scene-extract.js:145 | ring geometry from elements |
| 5742-trajectory-overlay-lod.js:234 | LOD overlay orbit |
| 5744-trajectory-eventnodes.js:192 | event-node marker orbit |
| 5745-maneuver-gizmo-hover.js:37 | gizmo preview orbit |
| 415-launch-planner.js:370 | inverse (world→eq) for the launch solver |

### The failure mode
Every one of these is a place where `(inc, lan)` authored in a body's equator frame must
be rotated into the world frame before it becomes a state vector or a drawn ring. The
five bugs this week were call sites that did the transform *inconsistently* or *not at
all*. New consumers keep being added (5745, 5744, 566 are all recent) and each one
re-derives the obligation. The `typeof progEqToWorldElements === 'function'` guard is
copy-pasted at every site, with a silent identity fallback — so a body without a pole
entry OR a site that forgets the guard both silently produce equator==world.

### Unification proposal
Make the frame a **property of the orbit object**, not of the call site. Every
orbit-shaped object gets a `frame` tag (`'equator'` | `'world'`). Provide ONE boundary
function `orbitToWorldState(orbit, body)` that (a) normalizes the dialect (see §2), (b)
reads `orbit.frame`, (c) rotates iff needed, (d) calls `physElementsToState`. NO consumer
calls `progEqToWorldElements` directly anymore — grep for it should return only the
boundary function + the inverse in the launch solver. Authoring UIs stamp
`frame:'equator'`; physics/render read state vectors that are already world-frame.
**Cost: M.** Unblocks all of §2's rendering consumers.

---

## 2. Orbit-shaped objects — dialect explosion

> **STATUS (2026-07-17): C2 ADAPTERS DONE** (MISSION_MODEL_V2.md §24 C2 as-built). `orbitNormalize` + `orbitMeanRadiusKm`/`orbitPeriodS`/`orbitWorldNormal` live in `src/js/384-orbit-canonical.js`; canonical shape `{ body, periKm, apoKm, incDeg, lanDeg, argpDeg?, frame }`. The C1 boundary (`orbitWorldElements`/`orbitWorldState`, 385) now normalizes internally. Three inline mean-radius derivations replaced. **Correction to the table below**: the node-map/catalog + `refOrbitResolve` keplerian dialects use `lan`, NOT `lan_deg` (only launch-planner `plan.*` objects carry `lan_deg`) — `orbitNormalize` accepts both. Writers not yet renamed (per-module rename pass pending) — see the §24 rename checklist.

### Dialect table
| Dialect | Fields | Frame | Units | Where |
|---|---|---|---|---|
| Mission event `e.orbit` | `body, alt_km, apo_km, inc_deg, lan_deg` | equator | km, deg | 570-mission-events.js:724,853-872 |
| Node-map / catalog builtin | `type, body, perigee, apogee, inclination, lan_deg` | equator | km, deg | 060-orbit-categories, 430:36-124 |
| `refOrbitResolve` return | `body, peri, apo, inc, lan, argp, kind, frame` | equator (peri/apo may be null for `propagated`) | km, deg | 425-reference-orbits.js:219-239 |
| Vehicle `orbitState` (os) | `body, perigee, apogee, inclination, lan, propagated, r, v, frame, surface` | equator OR state-vector | km, deg / km, km/s | 380, consumed 566:86-113 |
| Physics leg / anchor | `r, v, frame` (state vector) | world (or named rotating frame) | km, km/s | 565, `_physTrajByMission` |
| `physElementsToState` input | `a, e, i, raan, argp, nu` | world | **km, radians** | 385 |

Note the same physical quantity appears as `alt_km`/`perigee`/`peri`; `apo_km`/`apogee`/
`apo`; `inc_deg`/`inclination`/`inc`; `lan_deg`/`lan`. Mean altitude is re-derived inline
in at least three places (`(apogee+perigee)/2` at 430:158, 430:221, 566:96) rather than a
shared `orbitMeanAlt(o)`.

### Converters (all inline, none shared)
- 570-mission-events.js:724 — catalog resolve → event: `o.alt_km = res.peri; o.apo_km =
  res.apo; o.inc_deg = res.inc; o.lan_deg = res.lan` (hand field-rename).
- 566:96-108 — orbitState `{perigee,apogee,inclination,lan}` → mean-alt → elements → state,
  with the equator→world rotation inline.
- Every `?? apogee ?? perigee ?? 0` fallback (430:203-345) re-implements "circular if one
  radius missing" independently.

### Unification proposal
Define ONE canonical orbit record: `{ body, rp_km, ra_km, inc_deg, lan_deg, argp_deg,
frame }` (peri/apo as radii-from-surface in km, angles in deg, explicit frame). Provide:
`orbitNormalize(any)` → canonical (absorbs all six dialects, one place to add a field);
`orbitMeanAlt`, `orbitToElements` (deg→rad + world rotation, feeds `physElementsToState`),
`orbitToWorldState` (§1's boundary). Migrate readers to accept only canonical.
**Cost: L** (touches ~20 modules) but it is the keystone — do it right after §1's seam
is centralized. Recommend a compatibility `orbitNormalize` shim first so migration is
incremental.

---

## 3. `launchOrbit` triplication + per-event orbit aliases

`m.launchOrbit`, `e.orbit`, `e.launchOrbit` all hold the launch parking orbit; DEPLOY/BURN
add `e.orbitBefore` / `e.orbitAfter` / `fv.orbitState.orbitAfter` (570-mission-events.js:190,
993, 1320). Sync is by hand-spread `{ ...o }` copies (570-mission-events.js:726, 879) — the
launch-planner "Apply reverts" family of bugs (364512b65) lived exactly in this
duplication. `e.orbitRefId` (catalog binding) is a fourth representation of the same orbit.

**Proposal:** single source `e.orbit` (canonical per §2) + `e.orbitRefId` for the catalog
binding; derive `m.launchOrbit` as a getter over `log[0]`. Delete `e.launchOrbit`.
**Cost: S.** Do alongside §2.

---

## 4. Mass / propellant fields

### Dialect table
| Layer | Dry field | Prop field | Reserve | Type | S1.5 |
|---|---|---|---|---|---|
| Worksheet `stageStore` | `dry` (string) | `prop` (string) | `res` | strings | `s15`, `s15_sust_thrust`… (6) |
| Preset / library entry | `dry` (num) | `prop` (num) | `res` | nums | same 6 |
| Live-stage (370) | `dry_mass` | `tanks[]` + `progStageRemainingProp` | — | nums | expanded away pre-model |
| Snapshot stamp (_v2StageSnapshot / _fleetEntries) | varies | varies | — | — | must survive copy |

Two hazards: (a) `dry`/`dry_mass` naming split between worksheet and live model forces a
rename at every assembler; (b) the `s15_*` sextet is copied field-by-field (210:211,
210:1814-1825, plus `calculateWithS15`, `_fleetExpandStages`, `_tsExpandStages`) — the
"assemblers drop a field" bug shipped **three times** per CLAUDE.md.

**Proposal:** one `StageMass` shape `{ dryKg, propKg, reserveFrac, s15?: {…} }` with the
S1.5 fields as a single nested object that copies atomically (spread the whole `s15` node,
never its members). One `stageMassNormalize` used by every assembler. Keep the pure
physics (`lvPerformance`) input contract unchanged; convert at the boundary. **Cost: M.**

---

## 5. Time

Converters are already centralized in 360-…-delta-v-engine.js:94-129 (`progEpochJD`,
`progJDToDate`, `progDateToJD`, `progMissionTimeToDate`, `progDateToMissionTime`,
`progDateToLocalInputValue`) — this is the model the other concepts should imitate. The
residual fragmentation is **field naming for the same instant**: `launchTime_s`,
`metStart`, `e.at.value_s`, `t_s`, plus JD leg fields (`planDepJD`) and UI `dataset.rawS`
strings. LATENT (no bug), but a convergence pass on field names (all MET seconds → `met_s`;
all JD → `*_jd`) would prevent a future one. **Cost: S.** Low priority.

---

## 6. Angle units / ranges

`physElementsToState` takes **radians**; every orbit dialect stores **degrees**; converters
multiply `Math.PI/180` inline at each call (566:106-107, 565-nrho:36, etc.). LAN range
convention (0-360 vs -180..180) is not enforced anywhere — `progWorldToEqElements` returns
0-360 (385:172 `if (raan < 0) raan += 2π`) but event authoring accepts raw
`parseFloat(lanRaw)` (570-mission-events.js:872). LATENT normalization gap. Fold deg→rad
into §2's `orbitToElements` so it happens once. **Cost: S** (rides on §2).

---

## 7. ΔV units (m/s vs km/s)

Mixed `_ms` and `_kms` suffixes across 233 occurrences / 29 modules (`dvPro_ms`, `dv_ms`,
`dvAccum_kms`, `dv_actual` in m/s at 360, `progVcirc` returns km/s). Convention is roughly
"physics km/s, accounting m/s" but there is no typed boundary; `progNmComputeEdgeDv` is the
sanctioned magnitude source (CLAUDE.md invariant) yet consumers still `*1000` inline.
LATENT. **Proposal:** suffix every ΔV field with its unit (already ~half-done) and add a
lint-style convention note; do NOT auto-convert (risk to the byte-identical accounting
invariant). **Cost: S**, low priority — mostly documentation + naming discipline.

---

## 8. Identity keys

`stageDefinitionId` overloaded (LV = name string, SC = UUID) — documented in CLAUDE.md,
resolved via `_missionStageLabelById`. Owner keys (`sc:<scId>:<stageDefId>#<kid>`),
`vehicleId`, `originKey`, `activeKey`, `vehicleKey`, `activeName`, `laneColors` keys,
`missionId`, `fleetId` — 62 occurrences of the key family in 570-mission-band.js alone.
These are mostly intentional (different scopes) but the LV-name-as-id overload is the one
genuine fragmentation (silent ghost-stage on mismatch, now gate-guarded). LATENT (guarded).
**Proposal:** give LV stages a real UUID + display name like SC stages, retire the
name-as-id overload. **Cost: M**, deferrable — the gate guard contains the bleeding.

---

## 9. Body constants

`PROG_BODIES` (mu, R) is the single source and is respected. `PROG_BODY_POLES`,
`PROG_BODY_COLORS` (570) are each single-sourced per CLAUDE.md. Spot-check found no
scattered `mu`/`R`/`soi` literals competing with `PROG_BODIES` in the physics path. **Not
a fragmentation** — leave as is. (Recorded here so the refactor series does not re-audit it.)

---

## Proposed refactor order (what unblocks what)

1. **§1 seam centralization** — introduce `orbitToWorldState` boundary; make every
   `progEqToWorldElements` caller go through it. Immediately retires the recurring
   frame-bug class. (M) — DO FIRST, highest severity, self-contained.
2. **§2 canonical orbit + `orbitNormalize` shim** — add the canonical shape and
   normalizer as a compatibility layer (readers accept both). (L, but incremental.)
   Depends on §1 (the boundary is where normalize + rotate live).
3. **§3 launchOrbit de-duplication** — collapses onto §2's canonical orbit. (S)
4. **§6 angle + §2 elements** — fold deg→rad into `orbitToElements`. (S, rides on §2.)
5. **§4 StageMass unification** — independent of the orbit work; can proceed in parallel.
   (M)
6. **§5 time naming + §7 dv naming** — cosmetic convergence passes, do last. (S each.)
7. **§8 LV-stage UUID** — deferrable; gate guard holds. (M)

Items 1-3 are the spine (they retire the shipped-bug class). 5 runs in parallel. 4, 6, 7
are follow-on hygiene.
