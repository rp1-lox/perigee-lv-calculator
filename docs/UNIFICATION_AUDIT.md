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
   **STATUS UPDATE (2026-07-18, §7al seam-skip re-sweep):** the grep-gate closes
   the "re-implements the seam" hole but NOT the "skips the seam entirely"
   hole — an independent reconstruction that never calls `progEqToWorldElements`
   at all is invisible to it (this is how site 12's manual-MNODE builder shipped
   a 102.4° error post-gate). Two mitigations landed: (a) a **reconstruction-
   agreement** pin block in `tests/suites/05-orbit-orientation.js` (+5, docs/MATH.md
   §7al) asserts the independent world-frame reconstructions of one orbit agree
   geometrically AND that an un-seamed reconstruction is provably off-plane, so
   the next skip trips the gate; (b) the residual open debt is fully enumerated —
   the rendering sites 10/11 are now DONE (route through `orbitWorldState`), and
   the ONLY remaining seam-skips are the three **site-9** reconstructions in
   `565-physics-mission.js` (lines 233/640/792, §7al sites 13-15), HELD because
   fixing them moves the loosely-pinned Apollo/moon leg geometry at
   `tests/suites/03-mission-phasing.js:106-108` and needs an in-browser
   convergence re-measurement (out of scope for a lightweight seam pass).

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
   > **STATUS (2026-07-17): C4 DONE** (MISSION_MODEL_V2.md §24 C4 as-built) — the S1.5
   > sextet-carriage half of this item is closed. `stageCarryS15`/`stageClearS15`/
   > `stagePickS15` (140-physics.js) are now the one sanctioned way to move the `s15`
   > flag + 5-field sextet between stage records; all ~12 field-by-field copy sites
   > migrated; a source-grep gate (tests/math.test.js) fails the build if any module
   > outside 140-physics.js dot-assigns an `s15_*` field again. The BROADER mass/
   > propellant dialect gap named in this item (`stageStore` string fields vs 370's
   > `dry_mass`/`tanks` live-stage shape vs preset numeric `{dry,prop}`) is UNCHANGED —
   > only the S1.5 sextet-carriage sub-problem (the part that had shipped 3 bugs) was
   > in scope for C4.

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

---
---

# Part 2 — Calculator / Trades / Libraries (2026-07-18)

Read-only audit, same method (grep-driven breadth-first). Part 1 above covered the
physics/mission side; the user flagged that it "never really touched the LV calculator /
trade studies stuff." This part covers the worksheet→calculate pipeline (080-168), trade
studies (165), libraries (050/110/170/210/221/310-350), the orbits page (060/167/230), and
the spacecraft editor (580/585). Same severity legend (**SHIPPED** / **LATENT**). Module
numbers verified against `src/js`. **No code changed.**

Precedents cited below (all calculator-side): the S1.5-splitter "shipped 3×" family
(CLAUDE.md hard invariant), the trades-vs-orbits payload divergence (00b720710), the
ghost-stage zero-mass bug (`resolvePresetStages` `_missing`), the `buildPresets` shadowing
incident.

## Executive summary — top 5 calculator-side offenders (severity × blast radius)

1. **S1.5 BECO expansion is triplicated — three hand-kept-parallel implementations with
   DIVERGENT output shapes.** `calculateWithS15` (150-stage-and-a-half.js:74),
   `_fleetExpandStages` (560-fleet-editor.js:72), and `_tsExpandStages`
   (165-trade-study.js:113) each loop stages, call `_s15BecoSplit`, and emit a Ph.1/Ph.2
   pair — but produce **different records**: 150 wraps every field in `mathValue()` and
   appends a `label`; 560 stamps `_src/_phase/_err` provenance and pushes the raw stage on
   error; 165 emits bare `{dry,prop,thrust,isp,res}` and *falls back to the unsplit stage*
   on error (silently under-modeling an invalid S1.5). This is the **exact bug CLAUDE.md
   says "shipped twice / a third time"** — every splitter is a place a new consumer must
   rediscover the obligation, and 165's comment (:39-44) is a tombstone for the third
   shipping (worksheet trades diverged from the Orbits calculator). C4 unified the *field
   carriage* (`stageCarryS15`), NOT the *expansion*. **SHIPPED ×3.** Blast radius: 3 (any
   new consumer of vehicle stage data = 4). Cost: **S–M** (one `stageExpandS15(stages)`
   boundary + a grep gate). Highest severity on this side.

2. **The "vehicle → physics args" base bundle is assembled 3 independent ways.** The shape
   `{fairingM,fairingJ,siteLat,azMin,azMax,stages,boosterArg,parkingAlt,payload}` is built
   by `_tsCollectBase` (165:32, from the live DOM), `_tsVehicleToBase` (165:404, from a
   saved/preset object), and a **fourth**, inline read inside the frozen `calculate()`
   (160). 167's orbit-page path and every trade sweep depend on these staying byte-aligned
   with `calculate()`; when they drifted, the **trades-vs-orbits payload divergence
   (00b720710)** shipped. No shared "collect base spec" boundary; the DOM-vs-object split
   is copied field-by-field including the S1.5 carry (:38-47 vs :405) and the
   booster-precedence logic (`boosterGroups` vs single group, duplicated at 165:408-414 and
   the live `lvBoosterGroups`). **SHIPPED.** Blast radius: ~4 (+150, +167). Cost: **M**.

3. **The results panel is rendered by two independent builders that can (and already do)
   drift.** `renderResults()` inside the frozen `calculate()` (160) and
   `orbCalcSelectedVehicle()` (167:92-156) each hand-assemble the same panel — same
   `result-row` rows, same STG ΔV bars, same breakdown list — from the same `lvPerformance`
   result object. 167 already uses a *different* `fM` (see #4) than the worksheet path, so
   the "Est. Max Payload" line can format differently depending on which vehicle selector
   drove it. `condenseResultsPanel()` (168) then post-processes *both*, and
   `calculateWithS15` (150:165-176) does string-replace surgery on the innerHTML of
   whichever one ran. Three layers editing one panel's HTML by hand. **LATENT** (cosmetic
   drift observed, no numeric bug). Blast radius: 3 (150/160/167/168). Cost: **M**.

4. **Formatter fragmentation with a same-name / different-meaning collision.**
   `290-shared-formatters.js` defines global `fM`/`fT` — but `fM` there means
   *tonnes-or-kg* (`v>=1000?(v/1000).toFixed(0)+'t':v+' kg'`), while `orbCalcSelectedVehicle`
   (167:122) defines a **local** `fM` meaning *comma-grouped kg*
   (`Math.round(v).toLocaleString()+' kg'`). Two functions, one name, incompatible output,
   one shadowing the other by scope. Add ~348 inline `toFixed()`/`toLocaleString()` sites
   across 46 modules and local `fD`/`fS`/`fD` redefinitions (167:121-123, 121-elsewhere)
   and there is no single mass/ΔV/Isp/time formatter. **LATENT** (footgun, not yet a bug).
   Blast radius: ~46. Cost: **M** (mechanical, but wide).

5. **Five HTML-escape helpers, in two incompatible strengths.** `_tsEsc` (165:273) and
   `_orbVehEsc` (167:11) are **byte-identical** 4-char escapers (`& < > "`). `_mrEsc`
   (577:7) is the mission-report variant. But `esc` in 170-save-load-lv.js:149 and `esc` in
   220-launch-sites.js:477 are **3-char** (`& < >` only — they do NOT escape `"`), so a
   user vehicle/site name containing a double-quote interpolated into an HTML *attribute*
   is a latent injection / broken-markup vector. Part 1 §8 counted the mission-side key
   sprawl; this is the calculator-side escaper sprawl. **LATENT** (needs a quote in a saved
   name to trigger). Blast radius: 5 helpers across 5 modules. Cost: **S** (one `escHtml`,
   delete the rest).

---

## P2.1 — S1.5 BECO expansion (triplicated splitter)

### Duplicate table
| Impl | File:line | Input read | Output record | Error behavior |
|---|---|---|---|---|
| `calculateWithS15` | 150:91-111 | `stageStore` (DOM strings, via `mathValue`) | `{dry,prop,thrust,isp,res}` + parallel `stageLabels[]` | renders error to `#results-panel`, aborts |
| `_fleetExpandStages` | 560:72-85 | fleet `stageData` (numbers) | `{dry,prop,thrust,isp,res,_src,_phase}` | pushes raw stage w/ `_err`, continues |
| `_tsExpandStages` | 165:113-126 | base `stages` (numbers) | bare `{dry,prop,thrust,isp,res}` | pushes **unsplit** stage, continues |

All three call the single `_s15BecoSplit` (150:15) — the *math* is unified; the *iteration
+ record assembly + error policy* is not. The three error policies are genuinely different
behavior, not just style: 165 silently under-models an invalid S1.5 vehicle as a single
stage, which is precisely how a divergence hides.

### Converters / copies
Each splitter is its own converter; there is no shared one. C4's `stageCarryS15` unified the
*carriage* of the `s15` sextet between stage records (gate-guarded), but the *expansion*
(sextet → two virtual stages) has no boundary and no gate.

### Severity / blast radius
**SHIPPED ×3** (CLAUDE.md: "this bug shipped twice"; 165:44 documents the third). Any new
consumer of vehicle stage data that forgets to expand produces wrong ΔV for every S1.5
vehicle. Blast radius 3 today.

### Proposal
One `stageExpandS15(stages, {labels?, provenance?})` in 140/150 returning a canonical
virtual-stage array (+ optional parallel label/provenance side-array so 150's relabel and
560's `_phase` survive). All three call sites route through it; add a source-grep gate
(same pattern as C4's `s15_*` dot-assign guard) failing the build if any module outside the
boundary calls `_s15BecoSplit` directly. **Cost: S–M.** Do right after C4 — it is the other
half of the same shipped-bug class.

**STATUS: DONE (2026-07-17).** `stageExpandS15(stages, opts)` added to 140-physics.js next
to `_s15BecoSplit` (also moved there from 150). `calculateWithS15` (150), `_fleetExpandStages`
(560), and `_tsExpandStages` (165) are now thin wrappers; 150 keeps its mathValue/label
wrap and 560 keeps its default-res=2 normalization as caller-side decoration on top of the
shared core. `310-stage-edit-wrench.js`'s live BECO-split preview was also switched from
calling `_s15BecoSplit` directly to `stageExpandS15` (the only other in-tree caller found).
Error policy: `opts.onError` is `'throw'` (default, used by 150 — aborts and renders the
error to `#results-panel`, preserving its pre-existing behavior) or `'annotate'` (used by
560 and now 165 — pushes the raw unsplit stage decorated with `_err` and continues). 165's
old THIRD policy — silently falling back to the unsplit stage with no annotation — is
retired; it now uses `'annotate'` like 560, so an invalid S1.5 vehicle is visibly flagged
instead of silently under-modeled. Gate: `tests/suites/10-canonical-migrations.js` "C5"
block fails the build if any module outside 140-physics.js calls `_s15BecoSplit` directly,
plus 5 new pins on `stageExpandS15`'s error-policy/`_src` bookkeeping. Gate count after:
974 assertions (was 933 pre-change), all pre-existing pins byte-stable (Saturn V/Atlas
goldens, S1.5 path-equality, ghost-stage guard untouched).

## P2.2 — Vehicle → physics-args base bundle (assembled 3×)

Canonical-ish shape `{fairingM,fairingJ,siteLat,azMin,azMax,stages,boosterArg,parkingAlt,
payload}`. Producers:
- `_tsCollectBase` (165:32) — reads the live DOM (`gv('s${n}_dry')` …), carries S1.5 from
  `stageStore` (:45-46).
- `_tsVehicleToBase` (165:404) — reads a saved/preset object via `resolvePresetStages` +
  `resolvePresetBooster`, re-derives booster precedence (:408-414), defaults site/parking
  inline (:417-419).
- `calculate()` (160, FROZEN) — its own inline DOM read of the same fields; the two 165
  builders exist to *reproduce* it. `destOnOrbitDV` (145) was extracted precisely because
  of this pin, but the stage/booster/fairing/site read was not.

Notable seam inside the bundle: **`isp` bypasses expression parsing** everywhere. `gv()` /
`mathValue()` run `parseMathExpression` for dry/prop/thrust/res, but isp is read as
`parseFloat(document.getElementById(...).value)||1` in both `_tsCollectBase` (165:38) and
`calculateWithS15` (150:108) — so "290+5" works in the Dry field but not the Isp field.
LATENT inconsistency.

**STATUS: DONE (2026-07-17).** Root cause: the worksheet/modal Isp `<input>`s were
`type="number"` (080-build-table.js's `allowsMath` list, plus the static `stg-isp` field in
src/index.html) — a browser `type="number"` field rejects non-numeric text outright, so no
amount of downstream `gv()`/`mathValue()` plumbing could have helped; expressions never
reached the DOM value at all. Fixed at the source: `'isp'` added to `allowsMath` in
080-build-table.js (covers both the per-stage worksheet rows AND the booster row, built from
the same loop), and `stg-isp` in src/index.html switched to
`type="text" class="math-input"`. Because `calculate()`'s own (frozen) first line already
does `[...document.querySelectorAll('#stage-tbody .math-input')].forEach(commitMathInput)`,
giving Isp fields the `math-input` class was sufficient to make the frozen calculator commit
Isp expressions correctly too — **no frozen-file exception was needed**. Every non-frozen
`parseFloat(...isp...)` DOM/stored-value read was also switched to `gv()`/`mathValue()` for
consistency and to cover the "type Isp expression then hit Calculate without blurring" edge
case: `lvBoosterGroups` (140), `_tsCollectBase` (165), `_fleetExpandStages`/booster snapshot
(560), stage-composition preview + card-save (270/320), stage-library add/edit (310/350).
The two S1.5-optional Isp fields (`stg-s15-isp` "same as stage", `stg-s15-boost-isp` "blank
= use stage Isp") were made `type="text"` but deliberately **NOT** given the `math-input`
class: the global focusout auto-committer coerces a blank `math-input` field to `"0"`, which
would have destroyed their blank-means-"use default" sentinel; their reads still route
through `mathValue()` directly so expressions still work, just without the
auto-commit-on-blur normalization the required fields get.

**SHIPPED** (00b720710). Proposal: extract `collectBaseSpec(source)` where `source` is
`{kind:'dom'}` or `{kind:'vehicle', obj}` — one field list, one booster-precedence rule,
one S1.5 carry, one isp-parse decision. `calculate()` stays frozen but the two 165 builders
collapse to one. **Cost: M.**

## P2.3 — Results-panel double render

`renderResults()` (in frozen 160) and `orbCalcSelectedVehicle` (167:133-149) independently
emit the same panel from the same `lvPerformance` result. `condenseResultsPanel` (168)
post-processes both; `calculateWithS15` (150:167-176) string-replaces STG labels in
whichever ran. The 167 copy has already drifted (local `fM`, hard-coded `✓ YES`/`✗ NO`
glyphs, its own feasibility threshold `margin >= -50` vs the worksheet's). **LATENT.**
Proposal: a single `renderPerformancePanel(res, meta)` that both the frozen-path wrapper
and 167 call; since 160 is frozen, put it in 168 (already the post-processor) and have 167
call it directly instead of hand-building. **Cost: M.** Depends on #4 (shared formatter) to
be a clean win.

## P2.4 — Formatters

| Name | File | Meaning | Collision |
|---|---|---|---|
| `fM` | 290:4 (global) | `>=1000 → t`, else `kg` | — |
| `fM` | 167:122 (local) | `toLocaleString kg` | **shadows 290's `fM`, different output** |
| `fT` | 290:3 (global) | `>=1000 → MN`, else `kN` | — |
| `fD`,`fS` | 167:121,123 (local) | km/s, s | re-defined per builder |

Plus ~348 inline `toFixed`/`toLocaleString` across 46 modules (mass, ΔV, Isp, T:W, %,
burn-time all formatted ad hoc). No canonical `fmtMass/fmtDv/fmtIsp/fmtPct`. **LATENT** but
the same-name collision is a genuine footgun (a future edit to 290's `fM` silently does
nothing on the orbits page). Proposal: a `fmt.*` namespace in 290; migrate the high-traffic
mass/ΔV sites first. **Cost: M** (wide, low-risk).

## P2.5 — HTML escapers

| Helper | File:line | Escapes | Note |
|---|---|---|---|
| `_tsEsc` | 165:273 | `& < > "` | canonical-strength |
| `_orbVehEsc` | 167:11 | `& < > "` | **byte-identical to `_tsEsc`** |
| `_mrEsc` | 577:7 | `& < > "` (+ multiline) | mission report |
| `esc` | 170:149 | `& < >` | **no `"` — attribute-unsafe** |
| `esc` | 220:477 | `& < >` | **no `"` — attribute-unsafe** |

Vehicle names (170) and launch-site names (220) are user-authored and interpolated into
markup; the 3-char escapers are attribute-context-unsafe. **LATENT** (needs a `"` in a saved
name). Proposal: one `escHtml(s)` (4-char) exported early (000/010), delete the other four.
**Cost: S.** Mirrors Part 1's "one boundary" theme.

**STATUS: DONE (2026-07-17).** Canonical `escHtml(s)` (5-char: `& < > " '`) added to
015-version.js (loads before every consumer). `_tsEsc`, `_orbVehEsc`, and `_mrEsc` are now
one-line aliases onto it; the two 3-char `esc` locals (170-save-load-lv.js:149,
220-launch-sites.js:477) now also alias `escHtml` instead of hand-rolling `& < >` only, so
both pick up the quote-escaping fix — old call sites were left in place per the "alias, don't
hunt down call sites" plan. Grepped for other ad-hoc `replace(/&/g` recipes; found none beyond
the five already documented here. Verified in-browser: `x" onmouseover="1"` escapes
byte-identically through `escHtml`/`_tsEsc`/`_orbVehEsc`/`_mrEsc` to
`x&quot; onmouseover=&quot;1`.

## P2.6 — On-orbit ΔV re-implemented inside trades

`destOnOrbitDV` (145) is the pinned canonical destination-ΔV. Trades adds **two partial
replicas**: `_tsOnOrbitDVCircular` (165:58) and `_tsOnOrbitDVEscapeC3` (165:83), each a
"term-for-term replica" (their own comments) of a branch of `destOnOrbitDV`. They exist for
the sweep's per-point speed and are gate-pinned against `destOnOrbitDV` (165:80-82), so this
is the *disciplined* version of duplication — but it is still two more places to edit if
145's model changes, and 145 itself is a pinned transcription of the frozen `calculate()`.
So the destination-ΔV logic now lives in **three** synchronized copies (160 → 145 → 165).
**LATENT** (gate-pinned). Proposal: have the sweep call `destOnOrbitDV` directly for the
circular/escape points (profile first — the replicas were a speed optimization; confirm the
sweep actually needs them before deleting). **Cost: S**, low priority — the gate holds.

## P2.7 — Stage-record dialects (the mass/prop gap C4 left open)

Part 1 §4 named this and C4 closed only the S1.5-sextet half. The residual on the
calculator side: `stageStore` holds **DOM string values** (080:6 copies `el.value` verbatim),
while `resolvePresetStages`/library entries (330:21) and fleet `stageData` hold **numbers**.
`_s15BecoSplit` defensively `parseFloat`s every field (150:17-21) *because* it may be handed
either. `_tsCollectBase` re-parses via `gv()`; `_tsVehicleToBase` assumes numbers. So "is a
stage's `dry` a string or a number?" depends on provenance, and every consumer guards (or
forgets to). **LATENT** (guarded by defensive parsing). Proposal: `stageMassNormalize` at
the DOM→store boundary (080) so `stageStore` holds numbers like every other layer; folds
into Part 1 §4's `StageMass` shape. **Cost: M.**

## P2.8 — Things that are already unified (recorded so the series doesn't re-audit)

- **Metric definitions** — `TS_METRICS` + `TS_METRIC_ORDER` (165:95-103) are a single
  source; `TS_VARS` (165:67) likewise. Good model. `_tsMetricAt` (165:135) computes all six
  from one `lvPerformance` call — no per-metric duplication. **Not a fragmentation.**
- **Stage resolution / ghost-stage guard** — `resolvePresetStages`/`resolvePresetBooster`/
  `findStageByName` (330) are single-sourced; the `_missing` ghost-stage sentinel (330:20)
  is gate-guarded. **Not a fragmentation.**
- **Library card factories** — `libCardNode` (221:110) dispatches to `makeCard` (210:1667,
  stages) and `libMakeVehicleCard` (221:57, vehicles); 221's header comment explicitly says
  it *reuses* the existing factories rather than re-rolling. The spacecraft/comp-view cards
  (270:128 `makeCompCard`, 580) are a genuinely different layout, not a duplicate of the
  library card. Card rendering is **less duplicated than feared** — leave it.
- **No file-scope function shadowing found** — a `grep | uniq -d` over all top-level
  `function` names returned empty; the `buildPresets` shadowing was a *local* reassignment,
  and no analogous top-level collision exists on this side.

## Proposed refactor order (Part 2), with dependencies on the C-series

1. **P2.1 `stageExpandS15` boundary + gate** — closes the other half of the shipped-bug
   class C4 started. Independent of the orbit/C1-C2 work. **Do first.** (S–M)
2. **P2.5 `escHtml`** — trivial, high-hygiene, unblocks nothing but removes the attribute
   XSS latent. Can land anytime. (S)
3. **P2.2 `collectBaseSpec`** — depends on P2.1 (base.stages should already be
   expand-ready). Retires the trades-vs-orbits divergence class. (M)
4. **P2.4 `fmt.*` + P2.3 shared panel renderer** — P2.3 depends on P2.4 for a clean formatter
   story; both depend on nothing in the C-series. (M each)
5. **P2.7 `stageMassNormalize`** — folds into Part 1 §4 `StageMass`; do together. (M)
6. **P2.6 dedupe on-orbit ΔV** — lowest priority, gate holds; do opportunistically. (S)

P2.1 and P2.5 are self-contained quick wins. P2.2/P2.3/P2.4 are the "one boundary per
concept" spine for the calculator side, mirroring Part 1's §1-§2 spine. P2.7 explicitly
continues Part 1 §4 / C4.
