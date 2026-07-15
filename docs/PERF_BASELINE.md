# Performance Baseline — 2026-07-11 (HEAD d3da844b + eval bridge)

Measured by Claude (main-world access) to unblock Codex's measurement-first audit.
Build: `lv_calc.debug.html` (`python build.py --debug`), Chrome-based in-app browser, viewport 1600×1000.
Mission: `devSeedApolloMission({force:true})` (LAUNCH + 2 solved maneuvers). Profiler: `990-profiler.debug.js`
(`profWrap`/`profReset`/`profReport(0)`); the hot-path set beyond the profiler's default boot wraps:
`physRebuildMissionTrajectories, _trajRasterGlobe, _trajHemiClipRuns, progNmComputeEdgeDv, _buildSessionObject, _applySessionObject, physSolveNodeBurn`.

## NEW: main-world eval bridge for isolated-world automation (Codex)

`src/js/991-eval-bridge.debug.js` — DEBUG BUILD ONLY (never ships). From an isolated world:
```js
window.postMessage({ __lvEval: 'id-1', code: 'profReport(0)' }, '*');
window.addEventListener('message', e => { if (e.data && e.data.__lvEvalResult) /* {id, ok, value(JSON)|error} */ ; });
// result also mirrored to document.documentElement.dataset.lvEvalLast for DOM-read-only tooling
```
Code is evaluated with indirect eval in the page's global scope; promises are awaited; `value` is JSON.

## Scenario results (top self-time entries; format: calls / total / avg / max ms)

### (a) Replay — `missionRecompute(m)` ×20
Wall: **41 ms (2.05 ms per recompute)**
- missionRecompute 20c / 40.8 / 2.04 / 2.7
- physRebuildMissionTrajectories 20c / 36.7 / 1.84 / 2.4
- physPropagateSegment 20c / 36.0 / 1.80 / 2.3
- physBodyStateAt 50,300c / 19.6 / 0.0004 / 0.2 · physLeapfrogStep 10,020c / 13.6 · physFrameOf 10,020c / 13.4 · physAccel 10,080c / 11.2

### (b) Rotate-drag, textured Earth @ wKm 20,000 — 150 frames (interaction ladder active)
Wall: **1469 ms → 9.8 ms/frame avg, 14.6 ms max** (budget 33 ms/frame)
- _trajApplyCam 150c / 1467 / 9.78 / 14.6
- _trajWorldSVG 150c / 1192 / 7.95 / 12.8  ← dominant
- _trajRasterGlobe 300c / 582 / 1.94 / 6.1  (**2 raster calls per frame** — Earth + Moon both textured in view; lo-res ladder holding at ~2 ms each)
- _trajBodyFrameContent 300c / 52 · _trajResolveLabels 150c / 6.7
Pre-texture-decode variant of the same sweep (vector fallback active): 3.2 ms/frame, _trajHemiClipRuns 21,450c / 18.5 total.

### (c) Gizmo cheap-preview ticker — 30 cheap scratch passes (drag held)
Wall: **18 ms (0.6 ms per pass)** — physPropagateSegment 30c / 3.2 / 0.11 / 0.2. Full-fidelity pass: **4 ms** (2 propagations).

### (d) Scrubber sweep — 30 view-time steps via `_trajViewTimeOverride` + `missionRenderDetail()`
Wall: **444 ms → 14.8 ms/step, 19.9 max**
- missionRenderDetail 30c / 443.6 / 14.79 / 19.9  ← dominant
- _trajWorldSVG **60c** / 264.7 / 4.41 / 11.1  (**2 world renders per scrub step** — likely a double-render; finding candidate)
- _trajRasterGlobe 61c / 118.8 / 1.95 / 5.8

### (e) Session round-trip — `_buildSessionObject` → deep-copy → `_applySessionObject`, ×5
Wall: **99 ms (19.9 ms per round-trip)**
- _applySessionObject 5c / 97.3 / 19.46 / 29.0
- missionRenderDetail 5c / 43.5 · missionRecompute 10c / 21.3 (2 recomputes per apply) · physPropagateSegment 10c / 18.3 · _trajWorldSVG 10c / 14.6

## Observations for the audit (findings candidates, NOT conclusions)
1. Nothing is outside budget today — rotate is 9.8/33 ms, scrub 14.8 ms/step, replay 2 ms. Optimizations here buy headroom, not user-visible fixes.
2. `_trajWorldSVG` is the cost center everywhere it appears (string-rebuild of the whole world layer per frame).
3. Scrub steps appear to run `_trajWorldSVG` TWICE per step (60 calls / 30 steps) — as does the session-apply path (2 recomputes per apply). Duplicate-work elimination looks like the highest-value/lowest-risk target.
4. `_trajRasterGlobe` runs per textured body per frame (2/frame in Earth view); each is ~2 ms at the lo-res ladder tier. A per-body skip when the body's quantized key is unchanged would halve it (the cache already dedupes identical keys — the 2/frame here are distinct az keys, so this only matters if bodies could share a raster between near-identical frames).
5. Machine noise: run-to-run wall deltas were within ~10% across repeats; scenario (b) was run twice (pre/post texture decode) — compare against the RIGHT baseline when re-measuring.
