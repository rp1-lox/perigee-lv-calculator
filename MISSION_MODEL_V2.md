# MISSION_MODEL_V2 — physics-primary mission model

**Status: AGREED v1.0 (2026-07-12) — all six decisions settled (§0). Phase 1 (shadow state, §10): DONE 2026-07-14. Phase 2 (the flip, §11): DONE 2026-07-14 — §11.5/§11.6 hold the measured acceptance. This program is the v3.0 release train** (v2.1 was abandoned; the last released version remains v2.0.0 "Integral", and old files stay readable there per D3).

This is the architecture spec for inverting the mission model's center of gravity: from **ΔV-accounting-primary** (physics derived as a side-table) to **physics-primary** (accounting derived from a real simulated vehicle state). It is an *evolutionary re-architecture of the replay core*, not a rewrite. Prime directive: **the gate stays green at every step, and V2's derived accounting reconciles with V1's goldens within a documented tolerance (D6).**

---

## 0. Decisions (settled 2026-07-12)

| # | Question | Decision |
|---|---|---|
| **D1** | Drag an intermediate orbit — which burn absorbs? | **Upstream.** The transfer that *delivers* you to the node re-solves to hit the new orbit; downstream edges keep their own targets fixed and re-solve only because their origin state moved. Changes never propagate past adjacent edges. |
| **D2** | Reference-orbit library scope | **Global catalog** (like STAGE_LIBRARY/vehicle libraries) — Gateway-style reuse across programs. Programs may still define local one-offs; the catalog is the shared tier. |
| **D3** | Legacy missions | **Retired entirely. Breaking change, by design.** V1 `.program`/autosave mission blobs are NOT migrated — on load, a version gate detects them and says so plainly (old builds remain published for old files). This deletes the whole compatibility tax: no lazy-migration shims, no legacy `MANEUVER` replay case, no `detachedFrom` fallbacks, no parallel accounting path kept alive for old saves. |
| **D4** | Master clock | **EPOCH-PRIMARY (settled 2026-07-12).** The mission timeline runs on absolute time: a required, user-visible mission start date (JD/calendar), events authored and displayed at absolute dates, launches as events *at* dates (which naturally enables multiple launches on one timeline — the Gateway/multi-vehicle prerequisite). Window-pinned events (Grand Tour flybys, porkchop departures, rendezvous) anchor to the calendar and do NOT slip if the start date moves. T+ (from a chosen reference, e.g. first launch) remains available as a derived readout, not the authority. Implementation note: the internal simulation clock is ALREADY seconds-from-`epochJD` (what V1 calls "MET"), so the propagation/ephemeris plumbing is unchanged — this decision governs authoring + display semantics and the persistence format. |
| **D5** | Vehicle model beyond r,v | **NEVER attitude. Point-mass forever.** This is a hard non-goal, not a deferral: vehicles are state vectors + staged mass, full stop. Docking/rendezvous are modeled as position/phase coincidence, never orientation. (We are not building a KSP clone.) |
| **D6** | Reconciliation strictness | **Documented tolerance, not byte parity.** V1's stretched-ΔV accounting is acknowledged as the less accurate model; where physics-primary disagrees, physics is presumed right. Shadow-phase gate goldens compare V2-derived accounting to V1 within stated margins (default: per-burn ΔV within 1% or 5 m/s, whichever is larger; totals within 1%); any excursion beyond margin must be understood and documented before the flip. After the flip, goldens are RE-PINNED to V2's numbers and V1's are historical. |

---

## 1. The inversion (the whole idea in one paragraph)

**V1 (today):** `m.log` is a sequence of *accounting operations*. `missionRecompute(m)` replays them, building runtime vehicles and applying ΔV penalties; the real physics (`_physTrajByMission`) is computed *afterward*, as a derived side-table. Physics is a report the accounting generates.

**V2 (target):** `m.log` is authored *intent*. `missionRecompute(m)` **simulates a continuous vehicle-state timeline** — real state vectors propagated through real dynamics — and the ΔV budget / prop / margins become a *readout of that simulation*. Accounting is a report the physics generates.

Same log. Same replay skeleton. Same gate. **Flipped primacy.**

The one genuinely new primitive underneath everything: **`VehicleState(t)`** — a vehicle's real physical state at a mission time, as a first-class continuous thing that every event reads and writes.

## 2. What STAYS (non-negotiable)

- **`m.log` is the source of truth; recompute is pure replay.** Undo, autosave, determinism ride on this. Unchanged.
- **The physics engine** (385 core, 386 integrator), the shooters (`physSolveNodeBurn`, `physShootLegAim`, `physShootToTarget`), the ephemeris (360), the launch planner (415), `physPropagateSegment` as the ONE propagation entry point. Unchanged.
- **The renderer** (574), the gizmo (5745), the trajectory view, the node map's rendering layer. They already consume real physics — they get *more* correct, not rewritten.
- **The LV calculator core**: `calculate()`/`evalAtPayload()`/`lvPerformance`/`destOnOrbitDV` — frozen and orthogonal to all of this. Saturn V golden (150,838 kg) untouched.
- **`progNmComputeEdgeDv`** remains the ΔV-magnitude authority for solved Keplerian same-body edges. V2 changes what happens *around* it. (Its output participates in D6 reconciliation like everything else; the function itself is not edited.)
- **Side-table discipline:** simulation results keyed by missionId, never persisted on `m` (autosave-leak guard).

## 3. What CHANGES (the concentrated core)

- **`missionRecompute`'s replay body** — from "apply accounting deltas" to "simulate state through dynamics."
- **The event-exec functions** — each redefined as an operation on `VehicleState` (§5).
- **The state representation** — today split between accounting-state (runtime vehicles) and physics legs (`_physTrajByMission`); V2 unifies into one `VehicleState` timeline per vehicle.
- **Accounting** — from *source* to *derived readout* (§6).
- **Persistence format** — V2 mission blobs get a `modelVersion: 2` stamp; V1 blobs are refused with a clear message (D3). Event groups/repetition are re-specified against V2 replay (audited in Phase 2, kept only if they earn their keep).

**Consumers audit** (all become readers of the simulation, none rewritten): band view, state panel, flight-readiness checks (572), mission report (577), node-map annotations, trajectory view. Trade studies and the LV worksheet don't touch missions — unaffected.

## 4. The state model

### 4.1 VehicleState
```
VehicleState = {
  met,                       // mission time (s) at this anchor
  frame,                     // 'Earth' | 'Moon' | 'Sun' | ... (SOI)
  r, v,                      // km, km/s in frame
  mass: { perStage: [...] }, // dry + prop per stage (composition model unchanged)
  crew, ...                  // carried non-physics attributes
}
```
Point-mass **forever** (D5). No attitude, ever.

### 4.2 The timeline
A vehicle's history = a **piecewise trajectory**: propagated segments (coasts/transfers) punctuated by discrete state edits (burns, separations, dockings). This is what `_physTrajByMission` legs already are — V2 *promotes* them from derived side-table to primary record. `stateAt(vehicle, t)` = propagate from the nearest anchor — "a vehicle has a defined position on its orbit" falls out for free (the scrubber already does this for display; V2 makes it the model).

### 4.3 Reference orbits (first-class, global catalog — D2)
```
ReferenceOrbit = {
  id, name, body,
  kind: 'keplerian' | 'propagated',
  // keplerian:  { peri/apo (or a,e), inc, raan, argp }
  // propagated: { seedState, period, frame }   // NRHO / three-body orbits
}
```
Global catalog + per-program one-offs. Nodes **bind by id** — Orion, HLS, and Gateway all point at the same NRHO object, so "hit the same orbit multiple times" is coherent by construction. The `propagated` kind is what lets an NRHO exist at all (no Keplerian elements exist for it).

### 4.4 Nodes and edges (the intent model)
- **Node = a dwell orbit** you occupy. Binds a reference orbit + invariant **intent** `{ body, role }` (park / operate / capture / rendezvous). Geometry is the editable current solution; intent is sticky under parametric manipulation. Structural edits (change destination, delete node) are deliberate re-plans and may ripple; parametric edits never do.
- **Edge = a transfer** between dwell orbits — internally possibly multi-burn (departure + midcourse + insertion). **TLI is the departure burn on the LEO→(lunar destination) edge, not a node.** Rule: *dwell = node, transit = edge.* (Terminology pass rides along: TLI/TMI/LOI/MOI etc. name burns; nodes are named as orbits.)
- **Solved vs manual** (R6.2′ unification, kept): edges default `solved` and re-solve **locally** on endpoint manipulation per D1 (upstream edge delivers the change; adjacent edges only). Detaching a burn pins it `manual` — the user's explicit "stop re-solving this." That's what keeps free manipulation non-brittle.

### 4.5 Time model (D4 — epoch-primary)
The timeline is **absolute**: a required mission start date (`epochJD`, user-visible and user-set), events authored/stored at absolute time, displayed as calendar dates. Rationale: window-pinned missions (Voyager-style Grand Tours, porkchop departures, rendezvous) are calendar phenomena — an event tied to a window must NOT slip when the start date moves. Launches are events *at* dates, so several vehicles can launch at different dates on one timeline (multi-vehicle prerequisite). T+ from a chosen reference (e.g. first launch) is a derived display, not the authority. Internally the simulation clock stays seconds-from-`epochJD` (identical to V1's "MET" plumbing) — propagation, ephemeris, and the scrubber are unchanged; the decision governs authoring, display, and persistence semantics. One time axis, one conversion seam (JD ↔ sim-seconds).

## 5. Event redefinition — operations on VehicleState

Every event is a pure operation `(stateIn, params) → stateOut` (+ its delta, for the accounting readout). Two families:

### 5.1 Physics-state events (read/write r,v — these get *simpler*)
| Event | V2 definition |
|---|---|
| **LAUNCH** | Instantiate a vehicle at a physical state: bound parking reference orbit at launch date/time, plane from launch geometry (R7 planner). |
| **DEPLOY** | Instantiate a spacecraft at a state on a bound reference orbit. |
| **COAST** | `stateOut = physPropagateSegment(stateIn, dt)`. That is the entire definition. |
| **BURN / VECTOR BURN (MNODE)** | `v += Δv(pro,rad,nrm)` at met; propellant via rocket-eq on delivered Δv (one accounting path). |
| **MANEUVER (solved edge)** | Solve the transfer between two dwell states → its burn(s); Keplerian same-body magnitudes via `progNmComputeEdgeDv`, targeted/n-body via the shooters. Re-solves locally per D1. |
| **REENTER / RECOVER** | Terminal state operations (atmosphere interface / surface). |

### 5.2 Vehicle-composition events (mass/structure — nearly unchanged)
**SEPARATE, DOCK, EXPEND, PROPELLANT TRANSFER, CREW TRANSFER** happen *at* a state but are trajectory-neutral: they edit composition/mass and pass r,v through. DOCK's precondition under V2 is state coincidence (same orbit, same phase within tolerance) — a *check*, not new physics (D5: never attitude).

### 5.3 RENDEZVOUS (the one that deepens)
Rendezvous = arrive at a shared reference orbit **at the target vehicle's phase**. Orbit-reaching is a §5.1 op; **phase-matching is a new solver, explicitly deferred** to the post-NRHO phases (§7). Until then, rendezvous remains a coincidence check the user satisfies by authoring.

## 6. Accounting becomes a readout

`missionBudget` (ΔV expended, prop consumed, margins), the state panel, readiness checks, and the report are **summed/derived from the simulation's burns and masses**. Shadow-phase goldens assert reconciliation with V1 within D6 margins (per-burn 1% or 5 m/s; totals 1%); after the flip, goldens re-pin to V2 as the reference and V1's numbers become history. Where V1 and V2 disagree beyond margin, the discrepancy is investigated and documented in MATH.md before flipping — physics presumed right, but *understood* first.

## 7. Migration strategy — gate-green every step

- **Phase 0 — this doc agreed.** (5/6 decided; D4 pending confirmation.)
- **Phase 1 — shadow state.** Recompute builds the `VehicleState` timeline *alongside* the V1 model; nothing user-visible changes. Gate goldens compare shadow-derived accounting to V1 within D6 margins. De-risks the inversion before it bears load.
- **Phase 2 — the flip.** Physics-state events read/write `VehicleState` as primary; accounting derived; V1 accounting path and legacy compatibility **deleted** (D3: version-gate old blobs; also delete the legacy `MANEUVER` shim and `detachedFrom` fallbacks). Goldens re-pinned to V2. Event groups/repetition re-validated or retired.
- **Phase 3 — reference-orbit catalog + node/edge semantics.** Global catalog, bind-by-id, dwell/transit model, TLI-as-burn terminology, upstream-absorb manipulation (D1). Substrate for the node↔trajectory direct-manipulation feature (sliders/handles on a selected node's orbit).
- **Phase 4 — NRHO.** `propagated` reference-orbit kind + the seeded canonical Gateway NRHO (9:2, ~6.5-day period), propagated by the integrator, rendered as a real three-body orbit. The power move; also proves the `propagated` kind end-to-end.
- **Phase 5+ — reach-it (n-body transfer/BLT to NRHO), then rendezvous phasing & multi-vehicle timing.** The genuinely hard tail; scoped separately when we get there.

Each phase ships alone: gate green, D6 reconciliation (through Phase 2), browser-verified.

## 8. Invariants

- **`m.log` source of truth; recompute pure replay** (edit log → recompute → render; exec fns never mutate in place). Undo/autosave/determinism preserved.
- **One state source** (`VehicleState`), **one propagation entry** (`physPropagateSegment`), **one Keplerian solved-edge ΔV authority** (`progNmComputeEdgeDv`).
- Simulation results in missionId-keyed side-tables, never on `m`.
- **Point-mass forever** (D5).
- LV calculator core frozen; Saturn V 150,838 kg immortal.
- D6 tolerance discipline through the flip; goldens re-pinned after.

## 9. Open items

None — all six decisions settled (§0). **Status: AGREED v1.0 (2026-07-12).**

---

## 10. PHASE 1 SPEC — shadow state (the first code)

**Goal:** `missionRecompute` builds a complete `VehicleState` timeline for every vehicle *alongside* the V1 model, with **zero user-visible change**, and a reconciliation harness proves the shadow's derived accounting matches V1 within D6 margins. Nothing reads the shadow yet except the reconciliation tooling. This is pure de-risking: when Phase 2 flips primacy, the thing it flips TO will already have been proven equivalent.

### 10.1 The key architectural move: PROMOTE, don't recompute

`_physTrajByMission` legs already contain real propagated segments with samples, burn states (`leg.burnState`), solved Δv vectors (`leg.dvVec`), frames, and SOI events. The V1 replay already produces per-event vehicle snapshots and mass/prop states. **Phase 1 stitches these existing artifacts into per-vehicle timelines; it does not re-propagate.** New propagation happens only where no leg exists (gap coasts between anchored events — and even those defer to `stateAt()`-on-demand rather than eager propagation). Consequence: the shadow build is cheap (target: recompute stays under ~2.5 ms on the Apollo seed vs. the 2.05 ms baseline in PERF_BASELINE.md) and correct by construction wherever a leg exists.

### 10.2 New module: `src/js/566-mission-state-v2.js`

(Loads after 565. All cross-module calls at runtime, never module-eval.)

Data (side-table, missionId-keyed, NEVER on `m` — invariant §8):
```
_v2StateByMission = {
  [missionId]: {
    vehicles: {
      [ownerKey]: {                    // same owner keys tagOwners already assigns
        anchors: [ V2Anchor... ],      // time-ordered
      }
    },
    builtJD,                           // epochJD at build (staleness guard)
  }
}

V2Anchor = {
  t,                    // sim-seconds from epochJD (V1 "MET" — same clock, per D4 note)
  frame, r, v,          // physical state (r,v may be null for surface/pre-launch anchors — explicit kind instead)
  kind,                 // 'launch' | 'deploy' | 'burn' | 'composition' | 'coast-start' | 'terminal'
  authIdx,              // the m.log entry that created this anchor (provenance)
  mass: { perStage },   // composition snapshot at this anchor
  dvApplied,            // [x,y,z] km/s for kind:'burn' (the delta this anchor applied), else null
  legRef,               // authIdx of the _physTrajByMission leg covering [this anchor, next), or null
}
```

API (all pure over the side-table + existing artifacts):
- `v2BuildShadow(m)` — walks `m.log` post-replay (called from the recompute tail, AFTER `physRebuildMissionTrajectories`, guarded `typeof`-safe), builds the timelines. Idempotent; full rebuild each recompute (same discipline as the legs).
- `v2StateAt(missionId, ownerKey, t)` — state at any time: find bracketing anchor; if `legRef`, interpolate/propagate within the leg's samples (reuse `physLegStateAt`'s machinery); else Kepler-propagate from the anchor via `physPropagateSegment` with `maxSamples` tiny. Returns `{frame, r, v, mass}` or null (pre-launch/post-terminal).
- `v2DeriveBudget(missionId)` — the accounting readout: per-burn Δv = |dvApplied| (km/s→m/s), prop per burn re-derived by the SAME rocket-eq path V1 uses (`progRocketEqPropNeeded` on the anchor's mass snapshot), totals summed. Returns `{ perBurn: [{authIdx, dv_ms, prop_kg}], dvTotal, propTotal }`.
- `v2Reconcile(missionId)` — the proof tool: pairs each V2 burn with its V1 log entry (`dvRequired`/`dv_actual`, `prop_consumed`) and `missionBudget(m)`, returns `{ rows: [{authIdx, v1_dv, v2_dv, delta, withinMargin}], totals: {...}, allWithin: bool }` using D6 margins (per-burn max(1%, 5 m/s); totals 1%).

### 10.3 Per-event shadow semantics (Phase 1 subset — V1 meanings, recorded not redefined)

| Event | Shadow action |
|---|---|
| LAUNCH / DEPLOY | Anchor `kind:'launch'/'deploy'` at the event's time: state from the parking-orbit spec via the SAME reconstruction the leg builders use (elements→state at the orbit's phase convention; reuse, don't fork). Mass = V1's post-event vehicle snapshot. |
| MNODE (solved) | Anchor `kind:'burn'`: pre-state from `leg.burnState`, `dvApplied = leg.dvVec`, `legRef` = its leg. |
| MNODE (manual) | Same, from the manual leg (burnState stamp when present, else the mean-motion reconstruction the leg builder used — read what the leg RECORDED, never re-derive differently). |
| Legacy MANEUVER (shim) | Treated identically to solved MNODE via `_evIsSolvedManeuver` (predicates already unify them). |
| COAST | No anchor needed when a leg covers it; a `coast-start` anchor only when it begins an un-legged gap. |
| SEPARATE / DOCK / EXPEND / TRANSFER (prop/crew) | Anchor `kind:'composition'`: r,v carried through from `v2StateAt` at that time; mass/composition delta from V1's replay result. New owner keys inherit their state from the parent's anchor at separation time. |
| REENTER / RECOVER | Anchor `kind:'terminal'`; timeline ends. |
| Groups/repetition | Phase 1 shadows the EXPANDED log exactly as replay sees it (clones included) — no special handling. |

**Rule of the phase:** where V1 and the legs disagree or an event can't be shadowed faithfully, record the anchor with a `note` and surface it in `v2Reconcile` — never silently skip, never "fix" V1's meaning in Phase 1. Discrepancies are FINDINGS for Phase 2, not bugs to patch here.

### 10.4 Implementation steps (each gate-green before the next)

1. **S1 — skeleton:** module, data shapes, `v2BuildShadow` no-op hook in the recompute tail (after `physRebuildMissionTrajectories`, `typeof`-guarded), `v2StateAt` for a single-anchor timeline. Gate: pure-shape tests.
2. **S2 — launch/deploy anchors + leg stitching:** timelines for launched vehicles with `legRef` coverage; `v2StateAt` inside legs. Gate: synthetic one-launch mission in the vm harness (570 loads there already) — state at t matches the orbit spec's expected radius.
3. **S3 — burns:** solved + manual MNODE anchors with `dvApplied`; per-burn Δv derivation. Gate: synthetic log with one solved + one manual burn — v2 per-burn Δv equals the authored/solved values within D6.
4. **S4 — composition events + owner forking:** separation forks timelines with inherited state; mass snapshots flow. Gate: synthetic separate → two owners, mass conservation asserted.
5. **S5 — reconciliation harness:** `v2DeriveBudget` + `v2Reconcile` + gate goldens on a synthetic 5-event mission (launch, coast, solved burn, manual burn, separate) asserting `allWithin === true`. Browser: run `v2Reconcile` on the full Apollo seed (`devSeedApolloMission({force:true})` + a manual gizmo burn) and RECORD the actual per-burn deltas in §10.6.
6. **S6 — docs:** MATH.md §8-adjacent "V2 shadow state" section (data model + reconciliation results); this doc's §10.6 filled with measured numbers; PHYSICS_PLAN cross-reference note.

### 10.5 Explicitly OUT of scope for Phase 1

No UI change of any kind. No persistence change (the side-table is transient; autosave blobs are byte-identical). No event redefinition (V1 meanings are *recorded*, not changed). No reference-orbit catalog, no epoch-display work, no node/edge rework — those are Phases 2–3. No performance optimization beyond the §10.1 promote-don't-recompute discipline.

### 10.6 Acceptance (measured 2026-07-14)

- **Gate: green.** 555 → **575 assertions** (+20 Phase-1 additions: pure-shape tests, a synthetic launch-anchor/state-reconstruction test, synthetic solved+manual MNODE dv-reconciliation tests, D6 margin-math tests, and a synthetic SEPARATE owner-forking test).
- **Apollo seed reconciliation** (`devSeedApolloMission({force:true})` + one manual gizmo burn, `_trajGizmoOpenPending(missionId,1800); _trajGizmo.dv.pro=500; _trajGizmoCommit()`):
  - Per-burn: **2 of 3 rows within margin** — TLI (authIdx 1): v1 3143 m/s vs v2 3143 m/s, Δ0, within. Manual burn (authIdx 3): v1 500 m/s vs v2 ≈500.0 m/s (Δ ≈ 5.7e-14, float noise), within. LOI/corridor-exit edge (authIdx 2): v1 638 m/s vs v2 **unaccounted** (no promotable leg in Phase 1 — 565 attributes zero propagation to a transit corridor's exiting edge; flagged `withinMargin:false` per the §10.3 "never silently skip" rule, not dropped). See MATH.md §7q critique 58.
  - Totals: v1 (`missionBudget().dvExpended`) = 13,510 m/s; v2 (`v2DeriveBudget().dvTotal`, burns only) = 3,643 m/s; **does not close** — two documented, understood gaps, not stitching bugs: (a) the LOI edge above (638 m/s unaccounted), and (b) LAUNCH's ascent Δv (≈9,229 m/s) is its own anchor `kind` in the V2 model and is never emitted as a `v2DeriveBudget` "burn" row at all, so it's absent from the v2 total while `missionBudget()`'s v1 total includes it (critique 60). `9229 + 638 = 9867 ≈ 13510 − 3643`, confirming these two gaps fully account for the shortfall — no unexplained residual.
  - `allWithin: false` overall, honestly, for the two reasons above (both cataloged in MATH.md §7q/critiques 58 & 60 as Phase-2 open items, not Phase-1 defects). A dedicated dv-double-counting bug (every owner key in a docked stack independently anchoring the same burn, inflating early measurements to 5×) was found and fixed during this same verification pass — see MATH.md §7q.
- **Recompute wall-time**, Apollo seed, 20-iteration average after 5-iteration warmup: **≈4.2–4.5 ms**, both with and without `v2BuildShadow` active (isolated A/B: v2's own contribution measured at ≈0 ms / within noise, even slightly negative). This EXCEEDS the ~2.5 ms target and the 2.05 ms `PERF_BASELINE.md` figure — but the excess is entirely pre-existing (565's physics-trajectory rebuild), unrelated to this module; Phase 1 adds no measurable propagation cost of its own, consistent with the promote-don't-recompute design (§10.1).
- **Autosave-blob neutrality: verified.** `JSON.stringify(_buildSessionObject())` byte-identical with the shadow build on vs. off, once the two pre-existing non-deterministic ISO timestamp fields (`savedAt`, top-level and nested under `program`) are excluded — those timestamps differ between ANY two calls regardless of this module and are not new. No `_v2`/`V2Anchor`/`v2BuildShadow` substring appears anywhere in the serialized blob (grepped directly), confirming the side-table is never persisted on `m` or reachable from `_buildSessionObject()`.

---

## 11. PHASE 2 SPEC — the flip (drafted 2026-07-14)

**Goal:** `VehicleState` becomes the PRIMARY record. Every number the user sees about a mission — ΔV required/delivered, prop consumed, margins, per-vehicle state — is **derived from the simulation timeline**, not from parallel bookkeeping. The V1 accounting computation and all legacy compatibility are **deleted** (D3). Goldens re-pin to V2 (D6). Phase 1's three findings are resolved as part of the flip, not bolted on after.

### 11.0 The blast-radius trick that makes this tractable

Consumers (band view, state panel, 572 checks, 577 report, node-map labels, trajectory markers) read mission numbers from two places: **stamped fields on log entries** (`e.dvRequired`, `e.dv_actual`, `e.stagingResult`, `e.prop_consumed`) and **`missionBudget(m)`**. Phase 2 keeps those exact read surfaces but changes their SOURCE: recompute stamps them **from the V2 timeline**. Consumers don't change at all in this phase — the flip happens beneath them. (Consumer-visible redesign is Phase 3+ territory.)

### 11.1 Resolve the Phase-1 findings (these are the real model work)

- **F1 — Arrival/corridor-exit burns become real (critique 58).** V1 treats a transfer's arrival burn (LOI/MOI/capture-circularize) as pure bookkeeping on the edge — zero propagated existence, which is why Phase 1 couldn't shadow it. Phase 2 makes arrival a first-class burn anchor: at the corridor's arrival state (the leg's final sample / SOI-frame state), the burn Δv VECTOR = (target dwell-orbit velocity at the insertion point) − (arrival corridor velocity), applied to the state; magnitude derived from that vector. **Expectation, stated up front:** the physics-derived arrival Δv will NOT generally equal V1's schematic 638/822-style numbers — D6 governs: investigate, document in MATH.md, re-pin. This is the first place "physics is presumed right" does real work.
- **F2 — Ascent ΔV representation (critique 60).** Launch ascent is sub-orbital abstraction (the LV calculator's domain, not the mission simulation's — the state timeline BEGINS at parking-orbit insertion). Ascent ΔV therefore stays an accounting attribute OF the launch anchor (`anchor.ascentDv`, sourced from the staging result exactly as today), and `v2DeriveBudget` gains an `ascent` line so mission totals close: `dvTotal = ascent + Σ burns`. It is never a state delta and never a fake "burn row."
- **F3 — Deterministic replay identity (blob churn).** Runtime vehicle ids become deterministic functions of (missionId, log position, repetition index) instead of fresh `progUUID()` per replay — same log ⇒ byte-identical blob. This is required anyway for "recompute is pure replay" to be literally true, and it stops every recompute dirtying autosave. Repetition-clone keys join the same scheme (groups/repetition machinery otherwise unchanged — it clones log entries pre-replay, orthogonal to the state model; re-validated by a gate case).

### 11.2 The flip itself

1. **Replay produces the timeline as its primary output.** The V1 exec functions' composition/mass machinery (stage states, prop burn via `progRocketEqPropNeeded`, tagOwners keys) is KEPT — it becomes the **mass track** of the timeline (it already computes exactly what `anchor.mass` needs). What gets deleted is the parallel ΔV/margin bookkeeping that duplicates what the timeline knows.
2. **Stamp-from-V2:** after the timeline builds, recompute writes the legacy-named fields (`dvRequired`, `dv_actual`, `stagingResult`, `prop_consumed`) from `v2DeriveBudget`/anchor data. Solved-edge required-Δv still comes from `progNmComputeEdgeDv` (unchanged authority, §2) — what flips is that *delivered/actual/prop/margins* come from the simulated state, and required-vs-delivered comparisons are simulation-vs-target rather than bookkeeping-vs-bookkeeping.
3. **`missionBudget(m)` delegates to `v2DeriveBudget`** (plus the F2 ascent line). The old summation path is deleted. (This also retires the pre-existing aggregate-undercount bug flagged 2026-07-11 — the +3-for-200 m/s manual-burn anomaly — which dies with the path that produced it.)
4. **Delete, per D3:** the legacy `MANEUVER` replay case, `_missionMigrateManeuverEntry`, all `detachedFrom` fallback reads, and every "old save" tolerance in mission load paths. `buildProgramObject`/`_buildSessionObject` stamp `modelVersion: 2`; `applyProgramObject`/`_applySessionObject` REFUSE mission blobs without it: clear message naming the v2.0.0 release for old files. (Worksheet/vehicle/stage/orbit/theme persistence is untouched — the gate applies to MISSIONS only.)
5. **Re-pin goldens (D6):** gate mission goldens move to V2-derived values. Solved-edge magnitudes (3143) should hold exactly (same authority); arrival burns (F1) and totals WILL move — each moved number gets a MATH.md entry stating old, new, and why physics disagrees with the old model. `devSeedApolloMission` continues to be the canonical case.

### 11.3 Steps (each gate-green; browser-verified where marked)

1. **S1 — F3 determinism:** deterministic ids + repetition keys; gate: two recomputes ⇒ identical blob (savedAt excluded); browser: autosave no longer dirtied by recompute alone.
2. **S2 — F1 arrival burns:** 565's transfer legs produce arrival anchors with real Δv vectors; `v2Reconcile` reports the physics-vs-V1 delta for LOI; investigate + document the delta (browser, numbers recorded in §11.5).
3. **S3 — F2 ascent line:** `v2DeriveBudget` totals close against a hand-summed expectation on the seed.
4. **S4 — stamp-from-V2 + budget delegation:** consumers now read V2-derived numbers through unchanged surfaces; browser: state panel / checks / report / node map / band all render sane values on the seed + a detached-burn + a mid-leg-burn mission; goldens re-pinned in the same commit.
5. **S5 — deletions (D3):** legacy paths removed; version gate on load with the refusal message; gate case: a synthetic V1 blob is refused, a V2 blob round-trips.
6. **S6 — docs:** MATH.md accounting sections rewritten as "derived from the state timeline" (old text moved to an appendix or deleted); critiques 58/60 closed; §11.5 filled; PHYSICS_PLAN cross-note.

### 11.4 Explicitly OUT of scope for Phase 2

Reference-orbit catalog, node/edge dwell-transit rework, epoch-primary *authoring UI* (D4's display work — the internal clock is already epoch-seconds), NRHO, phase-matching, any consumer-visible redesign. Phase 2 ends with the app LOOKING the same, computing from the simulation, and carrying zero legacy weight.

### 11.5 Acceptance — S1–S3 measured (2026-07-14; S4–S6 not yet done)

**Scope note:** this pass implements Phase 2 **S1–S3 only** (F3 determinism, F1 arrival burns, F2 ascent line). S4 (stamp-from-V2 + budget delegation), S5 (deletions/version gate), S6 (docs rewrite) are NOT done — `missionBudget()`/consumers still read the V1 accounting path; V2 remains a side-table the reconciliation tooling reads, same posture as Phase 1. Gate stayed at **575 assertions** (no new gate cases added this pass — S1–S3 were verified live in the browser per the task's instructions; a synthetic gate case is S4/S5 follow-up work).

- **S1 — determinism (F3), verified in-browser:** `_missionRekeyVehicleId` (570-mission-manager.js) derives runtime `vehicleId` from the already-stable `_originKey` (`'v_' + missionId + '_' + originKey`, sanitized) instead of a fresh `progUUID()` per replay, rekeying `PROG_ACTIVE_PROGRAM.vehicles` at all four creation points (LAUNCH, DEPLOY, SEPARATE lower/upper, DOCK merge). Two `missionRecompute(m)` calls on the seeded Apollo mission (`devSeedApolloMission({force:true})`) produced **byte-identical `m.vehicleIds` and `JSON.stringify(m.log)`**: `vehicleIds = ["v_pq5ttxh71cmu_launch:0"]` both times, `logSame: true`.
- **S2 — arrival burns (F1, critique 58 resolved):** 565's `physRebuildMissionTrajectories` 'arrival' leg branch (the exiting leg of a transit corridor) now constructs a real `leg.arrivalBurn = {t, frame, r, vPre, dvVec}` from `physArrivalStateAt` (new helper, factored out of `physArrivalOsculatingElements` so both share one bracket/finite-difference reconstruction) + a target-orbit velocity built from vis-viva at the arrival radius with direction `ĥ_target × r̂_arr` (Ω=0-convention target-plane normal). 566's `v2BuildShadow` promotes it to a `kind:'burn'` anchor exactly like a solved MNODE.
  - **Measured on the seed** (Apollo LAUNCH + TLI + LOI + one manual 500 m/s gizmo burn at t=1800): LOI edge (authIdx 2) — **V1 638 m/s vs V2 (physics) 1028.29 m/s, Δ = +390.29 m/s (+61%)**. Outside the D6 margin (not within 1%/5 m/s) — expected per §11.1's stated expectation. Not implausible (1.61× V1, well inside the "investigate if >2x or <0.3x" bound) — accepted as a genuine model disagreement, not a construction bug.
  - **Cause of the discrepancy (documented per D6):** V1's `progNmComputeEdgeDv` computes the LOI burn as a schematic same-plane Hohmann-arrival circularization at the corridor's nominal arrival radius. V2's arrival burn is built from the ACTUAL propagated corridor state (`physArrivalStateAt`'s finite-difference reconstruction of the injection leg's real trajectory, which includes the true lunar-approach geometry, plane offset from the 3-DOF shooter's yaw solve, and the corridor's actual arrival speed/angle) matched against the target LLO's vis-viva velocity in the AUTHORED target plane. The bulk of the +390 m/s gap is the plane-alignment/geometry cost that the schematic Hohmann-LOI number does not carry: the shooter's converged corridor arrives with a real out-of-plane and timing offset from the idealized coplanar transfer V1 assumes, so matching the exact authored LLO plane costs more Δv than V1's 2D approximation. This matches MATH.md's existing critique-58 framing (V1's LOI/MOI accounting is schematic, not flown) — see MATH.md's new entry for the full writeup.
- **S3 — ascent line (F2, critique 60 resolved):** `v2DeriveBudget` now sums a dedicated `ascent` field from launch anchors' `ascentDv` (sourced from `e.stagingResult.dvDelivered`, the same field V1 stamps — read, not recomputed), and `dvTotal = ascent + Σ|burns|`.
  - **Measured:** `ascent = 9229`, `burns = 3143 (TLI) + 1028.29 (LOI) + 500 (manual) = 4671.29`, `dvTotal = 13900.29`. **Totals close exactly**: `9229 + 4671.29 = 13900.29 = v2DeriveBudget().dvTotal`. Compared to V1 (`missionBudget().dvExpended = 13510`): the total delta (`13900.29 − 13510 = 390.29`) equals EXACTLY the S2 LOI delta (390.29 m/s) — the ascent and TLI/manual-burn numbers agree with V1 to float noise, so the only source of total disagreement is the one documented, understood arrival-burn gap from S2. No unexplained residual.
- **Regression (confirmed, S1–S3 must not and did not touch V1-stamped numbers):** `missionBudget(m).dvExpended` on the untouched seed is still **13510** (same as the Phase 1 measurement) after all S1–S3 changes and two recomputes. `page-program` trajectory rendering (band + orbit-map view via `missionSetBandView`/`missionRenderDetail`) still renders without console errors after the changes; `_trajApplyCam` present and callable.
- V1-blob refusal / version gate: **not yet implemented — S5, out of this pass's scope.**
- Recompute wall-time: not separately re-measured this pass (no propagation-cost-relevant change — S2 adds one `physArrivalStateAt` call + a handful of vector ops per corridor-exit edge, reusing samples/events the rebuild already computed; expected within Phase-1 noise, not re-profiled).

### 11.6 Acceptance — S4–S6 measured (2026-07-14; the flip is now complete)

- **S4 (stamp-from-V2 + budget delegation):** implemented in `missionRecompute`'s tail (570-mission-manager.js) — immediately after `v2BuildShadow`, a stamping loop overwrites `e.dv_actual`/`e.dvDelivered`/`e.dv`/`e.prop_consumed` on every BURN/MNODE expanded entry from `v2DeriveBudget`'s matching per-burn row; `e.dvRequired`/`e.dvTarget` stay sourced from `progNmComputeEdgeDv` (unchanged, §2). `missionBudget(m)` now delegates to `v2DeriveBudget(m.missionId)` (+ ascent + ascent-stage prop off the LAUNCH `stagingResult`, unchanged source) — the old per-entry summation is deleted, with a defensive fallback retained for the (rare) case `missionBudget` is called before any recompute has built the v2 side-table.
  - **Measured on the seed** (Apollo LAUNCH + TLI + LOI + one manual 500 m/s gizmo burn at t=1800): `missionBudget(m)` now returns `dvExpended: 13,900` (was 13,510 under V1's schematic LOI) and the LOI entry (`m._expanded[2]`) shows `dvRequired: 822, dv_actual: 1028, result: 'SUCCESS'` — the arrival-burn flip (§11.1 F1/S2) turned what V1 flagged `MARGINAL` (delivered < 822-ish) into an honest over-delivery once `dv_actual` reflects the real 1028.29 m/s arrival burn; the stamping loop re-derives `e.result` against the stamped value for exactly this reason (documented in MATH.md's Phase 2 S4 entry).
  - **Undercount anomaly confirmed dead:** adding a manual 200 m/s burn to the seed moved `missionBudget().dvExpended` from 13,900 to **exactly 14,100** (+200, not +203) — `v2Reconcile` on the seed (three burns, post-stamp) reports `allWithin: true` for all three rows and totals, which is now definitional (V1's `dv_actual` fields ARE the V2 numbers post-stamp) rather than a coincidence, confirming the old parallel-bookkeeping path that produced the anomaly is gone.
- **S5 (deletions, D3):** removed — the `type:'MANEUVER'` branches of `_evIsSolvedManeuver`/`_evManeuverTarget` (570-mission-event-model.js), the `_missionMigrateManeuverEntry` function and its four call sites (570-mission-manager.js ×2, 5745-maneuver-gizmo.js ×2), and every `detachedFrom` fallback read (card/report text in 570, the manual-burn info note in 572-mission-checks.js, the gizmo's re-solve-button visibility check in 5745). `_evIsManualBurn` was already MNODE-only and is unchanged. New missions are stamped `modelVersion: 2` at creation (`_missionMake`, 570-mission-lifecycle.js §S5). A new pure predicate `_missionsPassV2Gate(missions)` (450-program-module-phase-10-save-load-closur.js) gates `applyProgramObject`: any mission lacking/mismatching `modelVersion:2` refuses the WHOLE program load via `showAlert`, naming the retired v2.0.0 build, mutating nothing. `_applySessionObject`/autosave restore inherit the gate transitively (they call `applyProgramObject`); the restore banner's Discard button is untouched (`autosaveClear()` only), so a gated-out autosave blob can always still be discarded.
  - **Measured (browser):** `applyProgramObject({kind:'rocket-playground-program', formatVersion:1, missions:[{missionId:'x',log:[]}], activeProgram:{}, ...})` (no `modelVersion` on the mission — the V1 shape) left `_missions.length`/`PROG_ACTIVE_PROGRAM.name` byte-unchanged and raised a modal titled "OLDER MISSION FORMAT" with the expected message. `_buildSessionObject()` JSON before vs. after an extra `missionRecompute()` call is byte-identical once `savedAt` is stripped (S1's determinism holds under S4/S5). `missionUndo(m.missionId)` correctly reverted a `durationOverride` edit's effect on `e.durationUsed` in the same test session — undo unaffected by the flip.
- **S6 (docs):** MATH.md §7q gained the S4–S6 entry (stamp-from-V2 mechanics, the `e.result` re-derivation fix, the version gate, and a short historical note on what the deleted V1 `missionBudget` summation used to do); critique 58 and 60 marked fully CLOSED; critique 59 (prop-per-burn stage-selection heuristic) remains explicitly OPEN, with a newly observed minor symptom (a −67 kg prop-total drift when a third manual burn is appended) attributed to it and left for Phase 3+.
- **Gate:** 555 (Phase 0 baseline) → 575 (Phase 1) → **570 assertions** after S4–S6 (net −5: the legacy-MANEUVER/`_missionMigrateManeuverEntry` shim's ~19 predicate/migration assertions were deleted along with the code they tested and replaced with 9 simplified MNODE-only predicate assertions, while 10 new assertions were added — 5 for `missionBudget`'s v2-delegation and 5 for `_missionsPassV2Gate`'s version-gate behavior). All green, `python build.py` passing end to end.
- **Not yet done:** reference-orbit catalog, node/edge dwell-transit rework, epoch-primary authoring UI, NRHO, phase-matching, any consumer-visible redesign — all explicitly Phase 3+ per §11.4. Critique 59 (prop stage-selection heuristic) is the one open Phase 2 item carried forward.

---

## 12. v3.0 UI SHELL — agreed direction (2026-07-14)

Mockups: claude.ai/code artifact "Mission View Unification — Concepts" (v2-swappable-primacy). **Concept A accepted with the A′ amendment.** The Band | Orbit Map | Trajectory toggle is retired in favor of a fixed layout grammar:

- **One STAGE + two RAILS, any surface promotable.** The stage is the large working surface; the Plan rail (the node/edge skeleton, compressed vertical — was the Orbit Map) and the Timeline dock (Band lanes merged with the scrubber onto one time axis) flank it. Every rail carries a promote control (⤢); promoting swaps it with the stage, the demoted surface docks in its place, and NOTHING unmounts — the world keeps rendering live as a thumbnail when demoted, so camera/selection/time context survives every swap.
- **State inspector**: the "Vehicles & Mission State" panel becomes a dockable, event-aware card pinned to a corner of whatever surface is the stage (same content, compressed; "— at EVENT / — current" behavior preserved).
- **One time cursor, one selection, one camera intent** across all surfaces (extends R5's shared selection).
- Workflow presets fall out of promotion, not modes: world-stage = flying/authoring; timeline-stage = history audit & multi-vehicle choreography; plan-stage = early sketching.
- **Sequencing** (rides Phases 2–3): Timeline dock first (Band+scrubber merge, self-contained); Plan rail with Phase 3 (it is the natural home for reference-orbit nodes and the direct-manipulation handles); promotion mechanics once both rails exist; toggle retired last. Concept B (semantic zoom morph) remains a possible later enhancement on top — never a prerequisite.

*After Phase 2: Phase 3 (reference-orbit catalog + dwell/transit node-edge model + direct manipulation) builds on a mission model that is finally, actually, the physics — and lands inside the §12 shell.*

---

## 13. PHASE 3 SPEC — reference orbits, dwell/transit, direct manipulation (drafted 2026-07-14)

**Goal:** orbits become first-class shared objects (§4.3), the node map becomes the dwell/transit intent model (§4.4), and manipulating an orbit re-solves its adjacent transfers locally (D1). This is the substrate for Gateway-style architectures and the §12 Plan rail.

### T1 — Reference-orbit catalog (model + persistence)
New module `src/js/425-reference-orbits.js`: `PROG_ORBIT_CATALOG` (builtin tier: LEO 185, LEO 400/51.6 "station", SSO 800, GTO, GEO, LLO 100, lunar NRHO placeholder marked `kind:'propagated'` but UNSEEDED until Phase 4) + user tier (global catalog, persisted via a new session/autosave key + `.program` bundling; join `_buildSessionObject` per 455's rule). API: `refOrbitGet(id)`, `refOrbitAdd/Update/Delete`, `refOrbitResolve(id)` → elements. Keplerian kind only in Phase 3; `propagated` kind exists in the schema + resolver stub (returns null with note) so Phase 4 slots in without schema change. Gate: CRUD + persistence round-trip + resolve.

### T2 — Events bind by orbitId
LAUNCH/DEPLOY orbit specs and solved-maneuver targets gain `orbitRefId` alongside the inline numbers; the inline numbers become the CACHED RESOLUTION of the ref (re-resolved on recompute; a ref edit propagates to every binder on next recompute — this is "hit the same orbit multiple times" working). Authoring boundaries: the launch card + node map bridge offer catalog picks; editing an inline value on a bound event DETACHES it to a one-off (explicit, visible), mirroring solved/manual. Node-map nodes carry the binding. Gate: two events bound to one ref; ref edit moves both on recompute; detach isolates.

### T3 — Dwell/transit + terminology
Transit corridors (TLC-class) stop being NODES: the node map renders dwell orbits only; the transfer between them is the EDGE, carrying its burns (departure TLI / arrival LOI as named burn chips on the edge). `devSeedApolloMission` re-authored: LEO 185 (dwell) → edge [TLI 3143 … LOI ~1028] → LLO 100 (dwell). Terminology audit rides along: TLC→"trans-lunar" edge, TLI/TMI/LOI/MOI name BURNS. The transit state still EXISTS in the timeline (the corridor leg) — it's just not a planning node. Band/report/checks re-verified against the new seed shape. Gate: seed produces dwell-only node map; totals unchanged (13,400-class).

### T4 — Direct manipulation (the §12 payoff)
Selecting a dwell node (node map or plan-rail-precursor) flies the trajectory camera to it and opens the ORBIT INSPECTOR: sliders + numeric fields for alt(peri/apo)/inc/LAN (the user's requested representation), editing the bound reference orbit (or one-off) live: scrub → cheap re-render of the ring; release → recompute, and the UPSTREAM edge re-solves (D1) while downstream edges re-solve only from their moved origin. Solved edges follow; manual burns pinned (existing mode semantics). Undo = one step per slider release. Gate: pure re-solve-locality test (edit node N: edge N-1 re-solved, edge N+1 re-solved from new origin, edge N+2 UNTOUCHED). Browser: full flow on the seed.

### T5 — Acceptance
Gate green (570 + new). Seed: dwell-only map, bound orbits, slider edit → upstream re-solve → totals move sensibly, undo clean. Ref shared by two launches: one edit moves both. All §11-era numbers stable where unaffected. Docs: MATH.md (edge-burn naming, re-solve locality), this section's measured results.

*Out of scope: NRHO seeding (Phase 4), phase-matching/rendezvous (Phase 5+), the full §12 shell (Timeline dock/promotion — separate track), semantic zoom.*
