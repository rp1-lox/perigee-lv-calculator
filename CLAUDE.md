# lv_calc.html — Project Guide

Single-file orbital mission planning tool. Everything lives in `lv_calc.html` (~7100 lines): all CSS in `<style>`, all JS in one `<script>` block at end of body. No build system, no npm, no bundler.

## Hard invariants

- **Never modify `calculate()` or `evalAtPayload()`** — LV calculator core, do not touch
- **`showPage(id)`** only for page navigation
- **`openModal()` / `closeModal()`** for all modals
- **CSS custom properties only** — `var(--accent)`, `var(--text-bright)`, `var(--border)`, etc. No hex colors in CSS rules. Use `-webkit-text-fill-color` to override Chrome's autofill/transparent-input color behavior.
- **Stage stack convention**: `stages[0]` = bottom engine, `stages[last]` = top/payload nose

## Key globals

```js
PROG_ACTIVE_PROGRAM          // { vehicles: {}, ... }
PROG_BODIES                  // { Earth:{mu,R}, Moon:{mu,R}, Mars:{mu,R}, Venus, Mercury, Titan }
_missions[]                  // Mission Manager state
_missionSel                  // selected mission id
_scEdSC[]                    // spacecraft definitions
```

## Stage identity — critical dual-use

`stageDefinitionId` is overloaded:
- **LV stages**: human-readable name string (e.g. `"S-IC"`, `"S-II"`)
- **SC stages**: UUID from `progUUID()`

Use `_missionStageLabelById(stageDefId)` to resolve either to a display name. Don't assume it's always readable.

## Key math functions

| Function | What it does |
|---|---|
| `progVcirc(body, alt_km)` | Circular orbital velocity (km/s) |
| `progRocketEqDv(m_wet, prop_kg, isp)` | Tsiolkovsky ΔV (m/s) |
| `progRocketEqPropNeeded(m_wet, dv, isp)` | Propellant mass for a given ΔV |
| `progStageMass(liveStage)` | Total mass of a live stage (dry + prop) |
| `progStageRemainingProp(liveStage)` | Remaining propellant kg |
| `progStageTotalCapacity(liveStage)` | Max propellant capacity |
| `progBurnPropellant(liveStage, kg)` | Consume propellant in-place |
| `progMakeLiveStage(stageDefinitionId, tanks, crewAboard, dry_mass, isp)` | Create live stage object |
| `_missionDvToOrbit(body, alt_km)` | Required ΔV to orbit = v_circ + gravity/drag losses |

## Mission Manager

**Data model:**
```js
{
  missionId, name,
  fleetEntryId,       // which LV/fleet entry
  payloadScIds: [],   // spacecraft IDs (copied from fleet entry on selection)
  launchOrbit: { body, alt_km, inc_deg, lan_deg },
  log: [],            // event entries
  vehicleId: null,    // set after LAUNCH
}
```

**Log entry types:** `LAUNCH`, `BURN`, `EXPEND`

**LAUNCH log entry** includes `stagingResult`:
```js
stagingResult: {
  dvRequired, dvDelivered, status,  // 'SUCCESS' | 'MARGINAL'
  stages: [{ name, propTotal, propBurned, propRemaining, dvContrib, expended }]
}
```

**Ascent staging** (`missionExecLaunch`): iterates stages bottom→top, expends stages fully consumed, partially burns insertion stage, removes expended stages from `fv.stages`.

## File structure markers

Phase boundaries: `// ─── END PROGRAM MODULE Phase N ───` (dashes are U+2500 box-drawing chars)

New code goes **before** the Phase 8 END marker.

Init block at bottom:
```js
applyTheme('perigee');
scEdInit();
fleetInit();
missionInit();
```

## Editing approach

- Use the **Edit tool** for targeted replacements — safe, no encoding issues
- Python patch scripts work but: write to file only at the end (`f.write`), so any assertion failure before that leaves the file unchanged. Use `encoding='utf-8'` on both read and write. Avoid `\t`, `\n` in match strings — use raw triple-quoted strings.
- After any edit, grep for the anchor string to confirm placement

## Pages

| Page id | Tab |
|---|---|
| `page-lv` | Vehicles (LV calculator) |
| `page-orbits` | Orbits |
| `page-results` | Results |
| `page-program` | Program (SC editor / Fleet / Missions) |

Program tab sub-panels toggled by `progShowTab('spacecraft' | 'fleet' | 'mission')`.

## Current state & next steps

**LV calculator restored (2026-06-11):** A GitHub sync had stripped the full LV calculator from `lv_calc.html`, keeping only the new program manager. Restored it by merging from the user's backup `LV_calc_saved.html` (current-as-base). Brought over: the whole LV JS block (`CONSTANTS` → before `PROGRAM MODULE — Phase 1`), the 3 LV pages (`page-vehicles`/`orbits`/`results`), LV modals (`save-spaceport`/`confirm`/`alert`/`veh-art-picker`/`lookup`), LV CSS, the `VEHICLE PERFORMANCE PANEL` section (`VP_COLORS`+`updatePerfPanel` = the per-stage ΔV tracker, which lived after the program module so the block-cut missed it), and INIT calls (`initSiteMap`/`initOrbitDiagram`/`loadPersistedUserSpaceports`). Kept current's program module + new program UI untouched. Verified in-browser: ΔV tracker, prop breakdown (`buildStageComposition`/`comp-body`), perf table, orbit diagram + site map, and launch/separate/maneuver all work.
- **Deferred:** the dedicated art page + art system. `artPageRebuildSlots`/`_progArtRebuildManagerList` are no-op stubs (see comment above `buildStageComposition`); vehicle/stage preset art images don't render. Restore the art module later if wanted.
- Safety backup of the pre-merge file: `lv_calc.html.premerge` (deletable once happy).
- Known pre-existing noise (NOT from the merge): `PROG_NM_NODES before initialization` errors from old Phase-test IIFEs.

**Program UI redesign — Phase 1 done (2026-06-11):** The Mission view is now a full-page **command center** (mirrors the original program page's layout, but wired to OUR Steps 1–4 logic — the original program JS is dead/diseased, copied LOOK only). Structure rebuilt in `missionRenderDetail` → `#mission-cc`: top bar (mission `<select>` + name + Band/NodeMap toggle + Execute Launch) · left col (LV select, payload manifest, launch orbit, `_missionMultiVehicleHTML` roster) · center (`_missionNodeMapHTML` ↔ band placeholder) · right col EVENTS (`_missionBurnSectionHTML` + `m.log` cards) · bottom summary (`_missionBudgetCardHTML`). Editors spread full-width (`.sc-ed-main-col` max-width removed; spacecraft/fleet detail use `.sc-ed-detail-grid`). New CSS classes `.mcc-*`. `_missionViewMode` now `'band'|'nodemap'` (default `'nodemap'`). Delegated to DeepSeek (note: hit the 50-turn limit but had completed all edits first; verify such runs). Verified in-browser.

**Program UI — Phase 2 done (2026-06-11): event-based band view.** Center "Band" toggle now renders `_missionBandViewHTML(m)` from `_missionBandModel(m)` (x = event INDEX, equal spacing — NOT time; color-coded vehicle lanes at log-scaled altitude via `_missionAltToYFrac`; event circles; "+" at live lane ends; click-scrubber `_missionBandScrub`/`missionBandScrubTo` driving a ΔV/prop readout). Event logs were augmented with `vehicleId` (+ child/merged ids on SEPARATE/DOCK) to support lane tracking.

**Program UI — Phase 3 done (2026-06-11): EVENTS panel + layout.** Right panel now has a generic **"＋ Add Event"** → type toggle (Burn/Maneuver/Separate/Dock/Expend) → opens that type's inline form (`_missionAddEventHTML`, state `_missionAddEvt`, `missionSetAddEvt`). ΔV/budget box moved to the bottom-left column (`.mcc-left-budget`, sticky); summary bar emptied. Command center constrained to viewport (columns scroll internally). DeepSeek note: big "read+design" UI delegations hit the 50-turn limit (it burns turns re-reading the 12k-line file); SPLIT into verbatim find/replace edits — those finish in 15–42 turns. After a turn-limit crash, CHECK the file (it may be partially applied) and finish the remainder with exact edits.

⚠️ **CRITICAL DeepSeek gotcha — it corrupts non-ASCII characters.** A DeepSeek file-write round-tripped the whole file through ASCII, turning all 374 non-ASCII chars (`—`, `✕`, `→`, `Δ`, `≥`, `⇕`, `⊕`, the `─` U+2500 section markers, etc.) into `�` (U+FFFD). The browser showed them as "big question mark" boxes and it wrecked alignment. ALWAYS after a DeepSeek run that writes the file, check: `python -c "print(open('lv_calc.html','rb').read().decode('utf-8','replace').count(chr(0xFFFD)))"` — must be 0. If non-zero, recover from the last clean backup (re-apply the run's edits via a UTF-8 Python script, NOT from the corrupted file — the original chars are unrecoverable from `�`). Clean backups carry a `0 replacement chars` note. Prefer giving DeepSeek edits that avoid introducing many special chars, and keep dated clean backups before delegating.

**Program UI — still pending:** event reorder/remove + click-for-detail; event types RENDEZVOUS / PROP TRANSFER / CREW TRANSFER / REENTER / RECOVER; user-editable lane colors. Old (do-not-reuse) band view ref: `progRenderBandView`/`_progBv*` in `LV_calc_saved.html`.

**(superseded) earlier Phase-2 note:** implement the center **event-based band view** (the "Band" toggle, currently a placeholder). Spec: x-axis = equal spacing PER EVENT, NOT linear time (the explicit fix — old band view bunched events by time). Color-coded vehicle lanes at orbital-state height, events as circles, "+" at each live (non-EXPENDED/RECOVERED) lane end to add events, vertical scrubber that drives the bottom ΔV/prop monitor. Reference only (do NOT reuse): the backup `LV_calc_saved.html` old band view `progRenderBandView`/`progBand*`/`_progBv*` — user deemed it "fundamentally diseased / unfriendly." Also still missing vs doc: event reorder/remove, and event types RENDEZVOUS/PROP TRANSFER/CREW TRANSFER/REENTER/RECOVER.

**Last completed:** Mission Manager Steps 1–4 all done (2026-06-11). Step 1 (fleet/payload + LAUNCH), Step 2 (BURN events + ascent staging in `missionExecLaunch`), Step 3 (multi-vehicle SEPARATE/DOCK/EXPEND), Step 4 (node-map view + MANEUVER) — see below.

**Step 3 (done, 2026-06-11):** Multi-vehicle ops — SEPARATE / DOCK / EXPEND.
Mission model now tracks `m.vehicleIds[]` (all live vehicles) with `m.vehicleId` as the focused/active one. UI in `_missionMultiVehicleHTML`; wrappers `missionExecSeparate` / `missionExecDock` / `missionExecExpendVehicle` call the existing `progExec*` executors. Verified end-to-end (separate→expend→dock, plus orbit-mismatch dock rejection).
- **SEPARATE**: split a vehicle at stage N into two independent flight vehicles (e.g. Apollo CSM/LM extraction). New vehicle gets its own id in `PROG_ACTIVE_PROGRAM.vehicles`.
- **DOCK**: merge two vehicles back into one, gated on their orbits matching via `progOrbitalStateMatch`.
- **EXPEND**: mark a stage as done — user-deliberate only, never auto-expended (Invariant: no auto-expending). `missionDropStage` already pushes an `EXPEND` log entry.
- Test target: Apollo-style stack separation, docking, and booster disposal.

**Step 4 (done, 2026-06-11):** Node-map mission view + MANEUVER events.
- Mission detail center panel has a `.seg` toggle: **Timeline ↔ Node Map** (`_missionViewMode`).
- `_missionNodeMapHTML(m)` renders an SVG (`viewBox 0 0 900 460`) of all `PROG_NM_NODES`; the mission path (launch node + each MANEUVER destination, via `_missionNodePath`) is highlighted with accent edges and a ringed current node.
- "Draw Maneuver" mode (`_missionBridgeMode`/`_missionBridgeFrom`): click start node → destination node → `missionExecManeuver` computes ΔV via existing `progNmComputeEdgeDv` and pushes a `MANEUVER` log entry. Outside that mode, clicking a path node jumps to its log card.
- `MANEUVER` is a UI-layer log entry (like SEPARATE/DOCK) — no `progExec` executor; ΔV comes from the node-map physics engine. Card: `_missionManeuverLogCardHTML`.
- Verified: LEO→GTO maneuver = 3,402 m/s Hohmann, SVG renders 14 nodes + highlighted edge.

**Log entry types (updated):** `LAUNCH`, `BURN`, `EXPEND`, `SEPARATE`, `DOCK`, `MANEUVER`.

## Related files

- `implementation_onboarding.md` — full architecture doc
- `dev_notes.md` — implementation decisions and gotchas  
- `conops_mockups.html` — visual reference for UI
- `program_math_reference.md` — math documentation
