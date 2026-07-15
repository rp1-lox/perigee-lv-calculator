# Rocket Playground Refactor Log

This log is append-only. Planned mappings are marked **proposed** until the corresponding verified commit lands.

## Module map delta

| Old module | New module(s) | Status |
|---|---|---|
| `src/js/570-mission-manager.js` | `570-mission-core-state.js` (shared manager state); `570-mission-event-model.js` (time/event predicates, lazy migration, override plumbing); `570-mission-interaction-state.js` (band/group/add-event/node-map interaction state); `570-mission-lifecycle.js` (mission construction, selection, render shell, fleet/orbit settings); plus proposed replay/recompute; event cards/editing; node-map rendering; band view; budget/state panel modules | in progress |
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

## [3] Extract shared mission manager state — 2026-07-10
**Intent**: Begin the approved `570-mission-manager.js` split with a minimal prefix extraction that isolates shared manager state while preserving the concatenated program byte-for-byte.
**Type**: split.
**Files**: `src/js/570-mission-manager.js` lines 1–10 → `src/js/570-mission-core-state.js`: mission manager banner plus `_missions`, `_missionSel`, `_missionViewMode`, `_missionEvtFilter`, `_missionBandScrub`, `_missionBandSpacing`, and `_missionBandZoom`; `tests/math.test.js` `FILES` list updated to load the new file immediately before `570-mission-manager.js`.
**Behavior delta**: none.
**Deleted**: none.
**Verified**: `python build.py` passed 499/499 assertions and `node --check`; actual sorted order is `570-mission-core-state.js` → `570-mission-manager.js`; concatenating the two source files is byte-identical to the original 308,556-byte module; generated `lv_calc.html` is byte-identical to the pre-split baseline with SHA-256 `AC4A0F869258A4D78F3D5E3C6ABE1F31169DBF4022FF410779BF48F9E760AB42`. Browser: Vehicles, Mission, and Orbits pages rendered; no console errors; Saturn V at 185×185 km, 28.5° produced the 150,838 kg golden. Seeded Apollo/gizmo/session flows were not run for this state-declaration-only move.
**Risk notes**: The first proposed filename (`570-mission-state.js`) sorted after `570-mission-manager.js`; the mandatory actual-order check caught this before the build and it was renamed to `570-mission-core-state.js`. The landed filename sorts correctly. No frozen functions, persisted fields, replay hooks, physics numerics, or generated source were edited.

## [4] Extract mission event model and overrides — 2026-07-10
**Intent**: Continue the approved mission-manager split by isolating shared event-model helpers and override-card plumbing as a contiguous prefix move.
**Type**: split.
**Files**: `src/js/570-mission-manager.js` lines 1–171 → `src/js/570-mission-event-model.js`: MET formatting; duration units/conversions; `_evIsSolvedManeuver`, `_evManeuverTarget`, `_evIsManualBurn`; settled-MNODE display helpers; `_missionMigrateManeuverEntry`; duration/ΔV override handlers and `_missionDurationOverrideHTML`; `tests/math.test.js` `FILES` list updated to load the new module between `570-mission-core-state.js` and `570-mission-manager.js`.
**Behavior delta**: none.
**Deleted**: none.
**Verified**: `python build.py` passed 499/499 assertions and `node --check`; actual sorted order is `570-mission-core-state.js` → `570-mission-event-model.js` → `570-mission-manager.js`; concatenating the extracted file and manager remainder is byte-identical to the prior 307,944-byte manager file; generated `lv_calc.html` is byte-identical to the pre-split artifact with SHA-256 `AC4A0F869258A4D78F3D5E3C6ABE1F31169DBF4022FF410779BF48F9E760AB42`. Browser: after dismissing the restored-session banner, Orbits and Mission rendered; Saturn V at 185×185 km, 28.5° produced the 150,838 kg golden; no console errors. Seeded Apollo/gizmo/session flows were not run for this move-only extraction.
**Risk notes**: `tests/math.test.js` explicitly lists 570 modules, so its load order was updated in the same commit. The extracted migration shim remains unchanged and lazy; no persisted field names, replay hooks, frozen functions, physics numerics, or generated source were edited.

## [5] Extract mission interaction state — 2026-07-10
**Intent**: Continue the approved mission-manager split by moving shared mission interaction state and its direct UI controls out of the manager remainder.
**Type**: split.
**Files**: `src/js/570-mission-manager.js` lines 1–208 → `src/js/570-mission-interaction-state.js`: band spacing/zoom/wheel/same-time/mid-coast controls; event-group state and actions; add-event and transfer drafts; `_missionExpandLast`; node-map bridge/pan/zoom/palette state and controls; `tests/math.test.js` `FILES` list updated to load the new module between `570-mission-event-model.js` and `570-mission-manager.js`.
**Behavior delta**: none.
**Deleted**: none.
**Verified**: `python build.py` passed 499/499 assertions and `node --check`; actual sorted order is `570-mission-core-state.js` → `570-mission-event-model.js` → `570-mission-interaction-state.js` → `570-mission-manager.js`; concatenating the extracted file and manager remainder is byte-identical to the prior 298,714-byte manager file; generated `lv_calc.html` is byte-identical to the pre-split artifact with SHA-256 `AC4A0F869258A4D78F3D5E3C6ABE1F31169DBF4022FF410779BF48F9E760AB42`. Browser: Orbits golden (Saturn V, 185×185 km @ 28.5° = 150,838 kg), Mission page render, and console-error check passed. The browser role click for Mission timed out while a restored-session banner was present; after dismissing it, a DOM-grounded click verified the page normally.
**Risk notes**: `tests/math.test.js` load order was updated in the same commit. The extracted controls retain their forward references to manager functions, which are only evaluated on interaction after all concatenated modules have loaded. No persisted fields, replay hooks, frozen functions, physics numerics, or generated source were edited.

## [6] Extract mission lifecycle shell — 2026-07-10
**Intent**: Continue the approved mission-manager split by isolating mission lifecycle/model setup and its main detail-render shell before launch/event-card concerns.
**Type**: split.
**Files**: `src/js/570-mission-manager.js` lines 1–268 → `src/js/570-mission-lifecycle.js`: `_missionMake`; mission create/delete/select/get; `missionRender`, `missionRenderList`, `missionRenderDetail`, and `_missionCenterNmEarth`; program/mission rename; fleet/payload/orbit setters; `tests/math.test.js` `FILES` list updated to load the new module between `570-mission-interaction-state.js` and `570-mission-manager.js`.
**Behavior delta**: none.
**Deleted**: none.
**Verified**: `python build.py` passed 499/499 assertions and `node --check`; actual sorted order is `570-mission-core-state.js` → `570-mission-event-model.js` → `570-mission-interaction-state.js` → `570-mission-lifecycle.js` → `570-mission-manager.js`; concatenating the extracted file and manager remainder is byte-identical to the prior 288,441-byte manager file; generated `lv_calc.html` is byte-identical to the pre-split artifact with SHA-256 `AC4A0F869258A4D78F3D5E3C6ABE1F31169DBF4022FF410779BF48F9E760AB42`. Browser: after dismissing the restored-session banner, Mission and Orbits rendered; Saturn V at 185×185 km, 28.5° produced the 150,838 kg golden; no console errors.
**Risk notes**: `missionRenderDetail` deliberately keeps forward references to later HTML render helpers; they execute only after all sorted modules have loaded. `tests/math.test.js` load order was updated in the same commit. No persisted fields, replay hooks, frozen functions, physics numerics, or generated source were edited.

## [7] Size and dead-code audit baseline — 2026-07-11
**Intent**: Establish the measurement-first baseline for the approved performance and size-reduction engagement; no optimization, deletion, minification, or source restructuring is performed by this entry.
**Type**: OTHER — audit/report only.
**Files**: Measured `src/js/*.js` and generated `lv_calc.html`; no files moved, renamed, or deleted.
**Behavior delta**: none.
**Deleted**: none.
**Verified**: 86 JS modules total 1,517,472 source bytes / 25,650 lines; `lv_calc.html` is 1,652,778 bytes and gzip-compresses to 478,127 bytes (3.46×). Largest modules: `570-mission-manager.js` 272,573 bytes; `574-trajectory-view.js` 183,985; `220-launch-sites.js` 158,478; `5745-maneuver-gizmo.js` 96,978; `565-physics-mission.js` 70,030. Built-artifact exact-name counts: `progBodyWorldPosCalibrated` 11 (not dead); `_trajGizmoClampCross` 3 and `_trajGizmoDragComponentValue` 3 (candidate non-live-path helpers, but gate-pinned); `_missionEventDetailHTML` 0; removed plain-disc LOD identifiers have no executable occurrence. A singleton scan found 38 top-level function definitions whose exact name appears once in `lv_calc.html`; this is a candidate list only, not proof for frozen/test-facing functions. Source comments occupy 331,094 bytes and are explicitly retained for readability.
**Risk notes**: Candidate removal requires an individual evidence review: a singleton can still be intentional/test-facing, and frozen physics zones remain out of scope. The calibrated-position alias is used by trajectory/gizmo rendering and cannot be removed as dead code. No profiling finding is logged yet; the required realistic scenario measurements precede any performance optimization proposal.

## [8] Overnight orchestration — baseline fingerprint + 570 continued-split plan — 2026-07-15
**Intent**: Resume the approved 570 split (siblings core-state/event-model/interaction-state/lifecycle already landed). Extract the remaining large concern-blocks from `570-mission-manager.js` (5,067 lines) as move-only contiguous cuts. Opus orchestrator; Sonnet subagents do the mechanical moves one at a time.
**Type**: baseline record (no production code changed by this entry).
**Behavior fingerprint (baseline, deterministic; every number must be reproduced post-refactor)**:
- Apollo `devSeedApolloMission({force:true})`: logLen=3; budget dvCapacityRemaining=6044, dvExpended=12372, payloadMass=45078, propConsumed=2678494.
- Gateway `devSeedGatewayMission({force:true})`: logLen=4; budget dvCapacityRemaining=6078, dvExpended=15064, payloadMass=45078, propConsumed=2714165; NRHO leg[0] missKm=30.1135.
- Zero console errors. Gate: 772 passed / 0 failed. Built lv_calc.html = 2,410,170 chars / 33,227 lines.
**Planned 570 extractions (contiguous, def-only; load-order among def-only modules is behavior-irrelevant, verified: no top-level load-time execution in 570 beyond declarations)**:
- `570-mission-nodemap.js` <- _missionCustomNodes..missionNmDragEnd (incl. PROG_BODY_COLORS/ATMOSPHERE/RINGS consts; PROG_BODY_COLORS is cross-referenced by 574, which loads later — order safe).
- `570-mission-band.js` <- _missionAltToYFrac.._missionBandViewHTML (band model/view, add-event dock, mnode editing, exportPNG).
- `570-mission-replay.js` <- _missionResolveDisplayNames..missionRecompute (the replay engine the guide names).
- `570-mission-cards.js` <- _missionLogCardHTML.._missionEventEditFieldsHTML (event cards + inline editing).
Each move updates the `tests/math.test.js` FILES list in the same commit.

## [9] 570 split A — extract node-map + band view — 2026-07-15
**Intent**: First extraction phase of the continued 570 split: move the two largest self-contained view subsystems out of the manager remainder.
**Type**: split (behavior-preserving move).
**Files**: `src/js/570-mission-manager.js` (5,290 → 3,743 lines) → new `src/js/570-mission-nodemap.js` (699 lines: _missionCustomNodes..missionNmDragEnd incl. PROG_BODY_COLORS/ATMOSPHERE/RINGS) and new `src/js/570-mission-band.js` (874 lines: _missionAltToYFrac.._missionBandViewHTML incl. band palette/zone consts, Add-Event dock, MNODE authoring, PNG export). `tests/math.test.js` FILES list gained both new modules between lifecycle and manager.
**Subagent**: one Sonnet subagent, single pass, both extractions. Outcome: clean; manager -1547 lines, new files +1547 content lines (matches); normalized 2 cosmetic double-blank-lines at the cut boundaries (whitespace only). 0 U+FFFD; box-drawing banner chars preserved.
**Behavior delta**: none. Fingerprint AFTER == baseline: Apollo logLen=3 (LAUNCH,MNODE,MNODE), dvCapacityRemaining=6044/dvExpended=12372/payloadMass=45078/propConsumed=2678494; Gateway logLen=4, dvCapacityRemaining=6078/dvExpended=15064/payloadMass=45078/propConsumed=2714165, NRHO leg[0] missKm=30.1135. Zero console errors.
**Deleted**: none.
**Verified**: `python build.py` → 772 passed, 0 failed; node --check ok; U+FFFD guard ok. Each moved function present exactly once across src/js. Browser fingerprint on rebuilt artifact identical to baseline.
**Risk notes**: PROG_BODY_COLORS/ATMOSPHERE/RINGS moved into 570-mission-nodemap.js; consumed at runtime by 574 (loads later) and the node map — safe (def-only, no load-time execution). No frozen functions, persisted fields, replay hooks, or physics numerics touched.

## [10] 570 split B — extract replay engine + event cards — 2026-07-15
**Intent**: Second extraction phase: isolate the recompute/replay engine and the event-card + inline-editing UI out of the manager remainder.
**Type**: split (behavior-preserving move).
**Files**: `src/js/570-mission-manager.js` (3,743 → 2,550 lines) → new `src/js/570-mission-replay.js` (756 lines: _missionResolveDisplayNames.._missionRescopeOriginKey/_missionResolveXferStages/_missionResolveSepIndex..missionRecompute — the replay engine the guide names) and new `src/js/570-mission-cards.js` (473 lines: _missionLogCardHTML..event delete/move/reorder/select + drag handlers.._missionEventEditFieldsHTML). `tests/math.test.js` FILES list gained both between lifecycle and band.
**Subagent**: one Sonnet subagent, single pass, both extractions, gate green first attempt. manager -1193 lines; new files +1229 content, +36 = 2 top-matter blocks. missionRenameVehicle and _missionDvToOrbit confirmed remaining in manager.
**Behavior delta**: none. Fingerprint AFTER == baseline: Apollo logLen=3 (LAUNCH,MNODE,MNODE) 6044/12372/45078/2678494; Gateway logLen=4 6078/15064/45078/2714165, NRHO missKm=30.1135. Zero console errors.
**Deleted**: none.
**Verified**: `python build.py` → 772 passed, 0 failed; node --check ok; U+FFFD guard ok; each moved fn present exactly once in src/js; browser fingerprint on rebuilt artifact identical to baseline.
**Risk notes**: recompute tail hooks (autosaveScheduleSave/missionUndoCapture) moved verbatim inside missionRecompute; forward references from cards to per-type renderers/appliers left in manager resolve at call time. No frozen functions, persisted fields, or physics numerics touched.
**Commit note**: split A landed as b7d954b2c.

## [11] 570 split C — extract event execution/editing + state panel/maneuver builder — 2026-07-15
**Intent**: Final extraction phase for 570: land the manager remainder under the ~1,200-line readability threshold by isolating the two remaining large contiguous concern-blocks.
**Type**: split (behavior-preserving move).
**Files**: `src/js/570-mission-manager.js` (2,550 → 776 lines) → new `src/js/570-mission-events.js` (1,182 lines: missionExecBurn.._missionDockLogCardHTML — all exec handlers, inline-edit appliers, low-thrust compute, launch-window/geometry planning, separation picker, roster/owner helpers, per-type log cards; incl. _ltRunState/_MISSION_SOI_INJECT/_missionSepIndex/_missionSepDrag) and new `src/js/570-mission-panel.js` (635 lines: _missionMultiVehicleHTML.._missionManeuverLogCardHTML — state panel, view switching, maneuver-step builder, node/edge interaction, MANEUVER log card). `tests/math.test.js` FILES list gained both.
**Subagent**: one Sonnet subagent, single pass, both extractions, gate green first attempt. missionInit/_missionMultiVehicleHTML confirmed at correct sides of the seams; no function duplicated or lost across the 570 family (boundary-sentinel + per-file uniqueness checks).
**Behavior delta**: none. Fingerprint AFTER == baseline: Apollo logLen=3 (LAUNCH,MNODE,MNODE) 6044/12372/45078/2678494; Gateway logLen=4 6078/15064/45078/2714165, NRHO missKm=30.1135. Zero console errors.
**Deleted**: none.
**Verified**: `python build.py` → 772 passed, 0 failed; node --check ok; U+FFFD guard ok; browser fingerprint on rebuilt artifact identical to baseline.
**Result**: 570-mission-manager.js is now 776 lines (from 5,067 at the start of tonight); the mission manager is decomposed into 10 load-ordered modules (core-state, event-model, interaction-state, lifecycle, replay, events, panel, cards, band, nodemap, + the 776-line manager core: launch-setup UI, budget/state helpers, burn worksheet, export menu, lifecycle glue).
**Risk notes**: forward references between the new modules (events↔replay↔panel↔cards) resolve at call time after all concatenated modules load. No frozen functions, persisted fields, replay hooks, or physics numerics touched.

## Suspected bugs (not fixed — refactor was behavior-preserving)
- **Pre-existing name collision `missionExecManeuver`**: defined in BOTH `src/js/565-physics-mission.js` and (formerly) `src/js/570-mission-manager.js`, now `src/js/570-mission-panel.js`. This predates tonight's work (present in both files at commit 060b9d2e1). 570 loads after 565, so the 570 definition wins at runtime; behavior is unchanged by the split. Worth a look: either the 565 copy is dead (shadowed) or the two are intended to differ and the collision is accidental. Not a refactor regression.
