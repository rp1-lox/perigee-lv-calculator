# MISSION_MODEL_V2 — physics-primary mission model

**Status: AGREED v1.0 (2026-07-12) — all six decisions settled (§0). Phase 1 spec: §10. This program is the v3.0 release train** (v2.1 was abandoned; the last released version remains v2.0.0 "Integral", and old files stay readable there per D3).

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

*After Phase 1's acceptance table is filled, Phase 2 (the flip) gets its spec: events read/write VehicleState as primary, accounting derived, V1 path + legacy shims deleted (D3), goldens re-pinned (D6).*
