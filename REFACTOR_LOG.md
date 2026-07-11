# Rocket Playground Refactor Log

This log is append-only. Planned mappings are marked **proposed** until the corresponding verified commit lands.

## Module map delta

| Old module | New module(s) | Status |
|---|---|---|
| `src/js/570-mission-manager.js` | Event model/predicates/migration; replay/recompute; event cards/editing; node-map rendering; band view; budget/state panel, using load-ordered `570*` modules | proposed |
| `src/js/574-trajectory-view.js` | Camera/projection; world render passes; overlay/labels; event nodes/ticks/scrubber; centralized LOD constants, using load-ordered `574*` modules | proposed |
| `src/js/5745-maneuver-gizmo.js` | Pure gizmo math; DOM interaction; shared hover/placement subsystem, using load-ordered modules between trajectory view and mission undo | proposed |

## [1] Propose staged behavior-preserving module splits — 2026-07-10
**Intent**: Establish the approval-gated refactor plan: first split `570-mission-manager.js`, then `574-trajectory-view.js`, then `5745-maneuver-gizmo.js`, with each extraction performed as a small move-only commit that preserves concatenation order and global bindings; defer naming and dead-code passes until the structural splits are complete and separately approved.
**Type**: OTHER — plan proposal only; no production code is changed by this entry.
**Files**: Proposed: `570-mission-manager.js` → load-ordered event model/predicates/migration, replay/recompute, event cards/editing, node-map rendering, band view, and budget/state modules; `574-trajectory-view.js` → load-ordered camera/projection, world passes, overlay/labels, event nodes/ticks/scrubber, and LOD modules; `5745-maneuver-gizmo.js` → load-ordered pure math, DOM interaction, and hover/placement modules. Exact filenames and function-level mappings will be recorded before each implementing commit after inspecting dependency boundaries.
**Behavior delta**: none.
**Deleted**: none.
**Verified**: proposal only; gate and browser flows not run because no executable source changed. Every implementing commit will run `python build.py` with Node on PATH, followed by the applicable §6 browser flows and golden-number checks; the entry for that commit will state exactly what ran.
**Risk notes**: Highest risks are concatenation load order, module-scope `let`/`const` bindings, replay tail hooks, persistence leakage, the two-layer trajectory rendering seam, and the two capture-phase dismiss systems. Frozen functions and numerics remain untouched. `lv_calc.html`, persisted field names, lazy legacy maneuver migration, build architecture, and `divergence/` remain out of scope. Stop and request guidance if an extraction would require semantic rewriting rather than a mechanical move.

## [2] Review of entry [1] — APPROVED with four required additions — 2026-07-11
**Intent**: Review of the proposed split plan by the model that built the current architecture (author of REFACTOR_GUIDE.md). The plan, its sequencing (570 → 574 → 5745), its move-only commit discipline, and its deferral of rename/dead-code passes are all approved as written. The four items below are binding additions to the plan.
**Type**: OTHER — review entry only; no production code changed.
**Files**: none.
**Behavior delta**: none.
**Deleted**: none.
**Verified**: n/a (review).
**Risk notes / required additions**:
1. **Byte-compare the build output on every split commit.** A pure file-boundary split with no reordering must produce a `lv_calc.html` identical to the pre-split build (or differing only in build.py's inter-module separators, if any). Diff the built artifact before/after each split commit and record the result in that commit's log entry. This is a stronger correctness check than the test gate for move-only changes — it catches accidental reordering and dropped lines that 499 assertions cannot.
2. **Filename-sort trap**: load order is plain ASCII filename sort and `-` (0x2D) sorts BEFORE digits — `570-foo.js` sorts before `5700-bar.js`; `5745-maneuver-gizmo.js` (or its successors) must sort after every new `574x-` module and before `575-undo-redo.js`. Verify the ACTUAL concatenation order in the built file per split commit; do not assume.
3. **`tests/math.test.js` has a FILES list** that loads specific `src/js` modules by filename into the vm sandbox (includes 570, 385, 386, 565, 574, 5745, 410, 430, 360, among others). Any split of a listed file must update that list in the SAME commit, or the gate fails confusingly. Expect this; note it in each entry.
4. **Coordination with concurrent feature work**: features continue landing on `dev` during the refactor. Rule: split ONE module at a time, start-to-landed quickly; feature changes to the file currently being split are held until it lands (features in other modules proceed freely). 570 remains the right first target — it also takes the most feature traffic, so splitting it early reduces future conflict surface.
Also noted: entry [1] is dated 2026-07-10; it was written 2026-07-11.
