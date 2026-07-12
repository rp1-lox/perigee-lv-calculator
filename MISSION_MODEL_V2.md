# MISSION_MODEL_V2 — physics-primary mission model

**Status: DRAFT v0.2 (2026-07-12) — design agreed on 5 of 6 decisions (§9); one recommended default pending confirmation. No code yet.**

This is the architecture spec for inverting the mission model's center of gravity: from **ΔV-accounting-primary** (physics derived as a side-table) to **physics-primary** (accounting derived from a real simulated vehicle state). It is an *evolutionary re-architecture of the replay core*, not a rewrite. Prime directive: **the gate stays green at every step, and V2's derived accounting reconciles with V1's goldens within a documented tolerance (D6).**

---

## 0. Decisions (settled 2026-07-12)

| # | Question | Decision |
|---|---|---|
| **D1** | Drag an intermediate orbit — which burn absorbs? | **Upstream.** The transfer that *delivers* you to the node re-solves to hit the new orbit; downstream edges keep their own targets fixed and re-solve only because their origin state moved. Changes never propagate past adjacent edges. |
| **D2** | Reference-orbit library scope | **Global catalog** (like STAGE_LIBRARY/vehicle libraries) — Gateway-style reuse across programs. Programs may still define local one-offs; the catalog is the shared tier. |
| **D3** | Legacy missions | **Retired entirely. Breaking change, by design.** V1 `.program`/autosave mission blobs are NOT migrated — on load, a version gate detects them and says so plainly (old builds remain published for old files). This deletes the whole compatibility tax: no lazy-migration shims, no legacy `MANEUVER` replay case, no `detachedFrom` fallbacks, no parallel accounting path kept alive for old saves. |
| **D4** | Master clock | **RECOMMENDED (pending confirmation): MET stays the simulation clock; the epoch anchor (`epochJD`) is promoted to a first-class, user-visible mission start DATE.** Window-driven quantities (launch time, departure windows, rendezvous dates) are authored/displayed as real calendar dates (JD) and converted to MET internally. No change to the time plumbing's core. |
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

### 4.5 Time model (D4, recommended default)
MET remains the internal simulation clock and the T+ display convention. `PROG_ACTIVE_PROGRAM.epochJD` is promoted to a visible **mission start date**; window-driven values (launch time, transfer departure/arrival, rendezvous windows) are authored and shown as calendar dates/JD and converted to MET at the seam. One conversion seam, no dual clocks inside the simulation.

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

## 9. Remaining open item

- **D4 confirmation:** MET-as-simulation-clock + first-class mission start date + calendar-authored windows (recommended above). Confirm or amend.

---

*Once D4 is confirmed, Phase 1 (shadow state) gets its concrete per-step spec and becomes the first code — provably behavior-neutral under the D6 goldens.*
