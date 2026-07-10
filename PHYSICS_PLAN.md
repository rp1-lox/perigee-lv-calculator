# Rocket Playground — 3D N-Body Physics Plan

Status: **approved plan, not yet started** (2026-07-09). Owner context: continuous-zoom trajectory epic complete; render units normalized (km·zoom, constant ±200-unit viewBox); porkchop/Lambert live in 410.

**Prime directives**
- 3D-native math from day one (z = 0 until P5) — the physics core never needs a 3D rewrite.
- Every phase ends gate-green and independently shippable; stopping after P4 leaves a complete 2D physics playground.
- ONE body-position function everywhere (`progBodyWorldPosCalibrated` / `physBodyStateAt`) — physics, porkchop, and renderer must agree or arcs visually detach (the transit-vs-body bug family).
- Physics results live in module side-tables keyed by missionId, never on `m` (autosave/serialization leak guard — the `_missionChecksById` pattern).
- MATH.md updated in the same commit as each phase (new sections + honest critiques).
- Modding/body-registry work explicitly TABLED (would drag the ascent calculator into scope).

**Why batch n-body is cheap here (vs Principia):** our mission is a replayed log — physics runs once per log edit, offline from the render loop, results cached as sampled polylines. No live-sim constraints. A 260-day transfer at ~5-min average steps ≈ 75k steps ≈ single-digit ms in JS.

**3D presentation strategy:** schematic SVG stays (theme-native, single-file constraint rules out inlining a WebGL engine); the two-layer architecture's single projection function is the seam — P5 swaps it for a real camera. NASA Eyes is the interaction reference (orbit/fly-to/time-scrub), not the photoreal skin.

---

## P0 — Physics core module (`src/js/385-physics-core.js`, pure math, no behavior change)

New functions:

| Function | Signature → returns | Notes |
|---|---|---|
| `physV3/physAdd/physSub/physScale/physDot/physCross/physMag` | vec3 primitives on `[x,y,z]` | plain arrays — cheap, JSON-safe |
| `physStumpffC(z)`, `physStumpffS(z)` | Stumpff functions | EXTRACTED from 410's Lambert internals; 410 re-pointed (no-op proven by porkchop goldens) |
| `physElementsToState(el, mu)` | `{a,e,i,raan,argp,nu}` → `{r,v}` | full 3D elements honored even while callers pass i=0 |
| `physStateToElements(r, v, mu)` | → elements + `{period, rp, ra, energy, hVec}` | handles hyperbolic (a<0) + near-circular/near-equatorial degeneracies explicitly |
| `physKeplerPropagate(r0, v0, dt, mu)` | → `{r,v}` | universal variables — one code path for ellipse/parabola/hyperbola |
| `physOrbitPeriod(a, mu)`, `physVisViva(r, a, mu)` | scalars | consolidation targets, no removals yet |
| `physBodyStateAt(body, t, overrides)` | → heliocentric `{r,v}` | position via `progBodyWorldPosCalibrated` (calibration coherence), velocity analytic for circular rails (v = ω×r), recursive for moons |

Existing-code changes: 410 loses its private Stumpff copies. Nothing else moves.

Gate (~20 new asserts): elements↔state round-trip 1e-9 across case matrix (LEO, GTO, high-e, hyperbolic, retrograde); one-period propagation returns start to 1e-6; energy + |h| constant; Hohmann half-period TOF matches `progHohmannTOF` to 0.1%; Moon rail speed ≈ 1.018 km/s.

## P1 — Restricted n-body integrator (`386-physics-integrator.js`)

Vessels = massless test particles in the field of on-rails bodies. Fixed-step symplectic leapfrog; step size regime-dependent but quantized to a fixed ladder for determinism.

New functions:

| Function | Purpose |
|---|---|
| `physSoiRadius(body)` | `a·(μ/μ_parent)^(2/5)`, cached module table (Moon ≈ 66,100 km pinned in gate) |
| `physFrameOf(rHelio, t, overrides)` | deepest body whose SOI contains the point (Sun → planet → moon walk) |
| `physPatchState(state, fromBody, toBody, t, overrides)` | vector frame conversion (position AND velocity offsets via `physBodyStateAt`) |
| `physAccel(r, t, ctx)` | Σ μ_b(r_b−r)/‖…‖³ over `ctx.bodies` (default `['Sun','Earth','Moon']` cislunar, +target planet interplanetary) |
| `physStepFor(r, ctx)` | `dt = clamp(k·d_nearest^1.5/√μ, dtMin, dtMax)` quantized to ladder (1/4/16/64… s) — determinism |
| `physLeapfrogStep(state, dt, ctx)` | kick-drift-kick |
| `physFindEventTime(f, tLo, tHi, tol)` | bisection for SOI crossings / apsides / arrival conditions |
| `physPropagateSegment(state0, t0, tMax, ctx, opts)` | workhorse: `{stateF, tF, samples:[{t,r,frame}] (≤opts.maxSamples, default 256), events:[{type:'soi'\|'periapsis'\|'apoapsis', t}]}` |

Optional later optimization (do NOT start with it): Encke deviation-from-conic integration.

Gate (~15): two-body limit — leapfrog vs Kepler over 100 LEO orbits <1 km, energy drift bounded non-secular; Jacobi constant conserved 1e-6 rel in Earth–Moon CR3BP; SOI patch round-trip continuity; **golden free return** (seeded translunar state returns to perigee within stated band); **bit-identical determinism** across two runs.

## P2 — Mission-model bridge (570 + new `565-physics-mission.js`)

New:
- `_physTrajByMission = {}` side-table: `{missionId: {legs:[{authIdx, samples, tof, dvVec, frames}]}}`.
- `physSolveNodeBurn(fromOrbit, toOrbit, tDepart, ctx)` — Δv VECTOR for existing node maneuvers (magnitude from today's `progNmComputeEdgeDv` path, Lambert via 410 for interplanetary). Old missions replay with unchanged meaning.
- `physRebuildMissionTrajectories(m)` — walks `m.log` post-replay, propagates legs, fills side-table. Called from `missionRecompute` tail behind `PHYS_ENABLED` flag (default off until P3 verifies).
- New log event `{type:'MNODE', at:{kind:'anomaly'|'met', value}, dvPro, dvRad, dvNrm}` + `missionExecManeuverNode(id, spec)` + replay case in `missionRecompute`; propellant burned through existing `progRocketEqPropNeeded` using |Δv| (one accounting path).

Changed: `progTransferTOF` (360) — duration precedence becomes `durationOverride > physics TOF > launchWindow > Hohmann`. MET clock + boiloff consumers unchanged.

Verify: reconciliation golden — Apollo seed ΔV totals under physics within documented tolerance of current model (delta recorded in MATH.md); `devSeedApolloMission` green; undo/redo intact; autosave blob byte-size unchanged with physics on; recompute wall-time < 50 ms.

## P3 — Render integration + SOI departure spurs (574)

New:
- `_trajPolylineSVG(samples, frameBody, ox, oy, zoom, opts)` — frame-relative km → render units (·zoom), one `<path d="M…L…">` + transparent hit path; LOD-gated by extent like `transferArc`.
- `physEscapeGeometry(rp, c3, mu, outboundSign)` → `{e, beta:acos(1/e), nuBurn, hyperbolaSamples→rSoi}` (e = 1 + rp·v∞²/μ; asymptote aligned with departure-body heliocentric velocity, prograde for outbound / retrograde for inbound targets).
- `_trajEscapeSpurSVG(...)` — burn marker at correct true anomaly on parking ring + hyperbola spur to SOI edge in the DEPARTURE body's frame; mirrored capture spur at arrival. Inherits ZOI alpha (one fade authority).

Changed: `_trajBodyFrameContent` leg loop — physics side-table hit → polyline + spurs; miss → today's `_trajTransferArcPath` schematic (kept for physics-off). Vehicle dot interpolates `samples` at viewT (retires `_trajLegPathFraction` linear-fraction critique).

Verify: gate — β vs closed form; polyline endpoints coincide with node markers (coincidence checks, not magnitudes — the Molniya-apse lesson). Browser — endpoint <1 px at Earth/Moon/Mars anchors; zoom×resize LOD matrix; labels track geometry.

## P4 — Targeting & authoring (largest phase)

New:
- `physLambertSeed(departBody, targetBody, tDep, tArr, ctx)` — wraps 410's solver for initial guesses.
- `physShootToTarget(state0, t0, target, ctx, opts)` — differential corrector: finite-difference Jacobian on 2–3 Δv components, Newton steps on miss vector at closest approach; `opts.maxIter=12`; returns `{converged, dvVec, missKm, iters}` — MUST fail cleanly, never loop.
- `physFreeReturnSolve(leoAltKm, tDepart, ctx)` — shooter with lunar-flyby + return-perigee-in-band constraint → MNODE spec.
- UI (570): Add-Event dock "Maneuver (vector)" mode — dvPro/dvRad/dvNrm + placement (anomaly or MET); "Free return…" template button.

Gate: convergence suite (Earth→Moon, Earth→Mars seeds: miss <500 km in ≤12 iters); unreachable target → `converged:false`, fast; free-return solver reproduces the P1 golden. Browser: author a free return via UI, assert return-perigee readout.

## R-SERIES (supersedes the original P5/P6, 2026-07-09) — REALITY UPGRADE

User directive after P4 shipped: *"each orbit should be accurate EXACTLY to how they are in real life. Accuracy to reality over the current model."* The original P5 (cosmetic 3D camera over the coplanar fiction) is replaced by a real-geometry series. Original P5/P6 text kept below for reference where still applicable.

### R1 — Real ephemeris rails — ✅ SHIPPED 2026-07-09

- Replace the circular-coplanar kinematics with **full Keplerian mean elements + secular rates per body** (JPL approximate-ephemeris table: a, e, i, Ω, ϖ, L at J2000 + centennial rates; Moon: mean elements about Earth incl. its 5.145° inclination, e=0.0549; Titan similar about Saturn). `physBodyStateAt`/`progBodyWorldPos*` become element-evaluated 3D states (Kepler's equation per call — cache per (body, t) if profiling demands).
- **Program epoch**: MET 0 = `PROG_ACTIVE_PROGRAM.epochJD` (default J2000.0 + a sane modern date). Porkchop dep_day = days since epoch — departure windows become REAL dates. (Launch-date UI can come later; the default epoch is enough for correctness.)
- **Planet-phase calibration RETIRES**: real ephemeris = real phases; `progCalibratedTheta0`, `_trajGetPlanetCalibration`, calibration overrides threading (565/574), ghost second-leg rendering, and MATH.md §7a all come out. Arcs/polylines connect because reality connects them; a leg that CAN'T connect at the authored MET is now honest information (P4 shooter aims at real positions).
- **Goldens re-derived** (same commit, dated): free-return seed re-scanned against the real inclined Moon; TOF/kinematics pins updated; porkchop C3 grid re-goldened. Two-body/Jacobi/determinism tests unaffected (synthetic rails).
- Gate: element evaluation vs published J2000 positions (spot longitude checks); Moon inclination visible in state (z ≠ 0); energy/h invariance unchanged.

### R2 — 3D camera + true-geometry rendering (574) — SHIPPED 2026-07-09

- Camera gains `az, el` (defaults el=90° top-down). ONE projection seam: rotate world km by az/el → orthographic drop → {x, y, depth}; emissions become {depth, svg} records, painter-sorted.
- **Rings stop being circles**: heliocentric rings, moon rings, and mission-orbit rings render as SAMPLED POLYLINES from real elements (eccentric, inclined, projected through the camera). The `<circle>`/`<ellipse>`+arc-flag emitters retire for orbits.
- Authored mission orbits: a,e,i from perigee/apogee/inclination; **Ω and ω default 0, annotated** (launch-time modeling would pin RAAN — documented honestly, not faked).
- Ecliptic reference grid; right-drag/modifier rotates; reset returns to top-down.
- Verify: top-down view shows REAL geometry (Mercury visibly eccentric, Moon ring visibly inclined when tilted); depth-flip asserts; rotate×zoom×pan×anchor matrix; frame <16 ms. (The old "el=90 parity" regression is replaced by "el=90 matches the R1 real-geometry top-down" — the schematic-circles view is intentionally gone.)

### R3 — 3D physics coherence

- Vessel states leave z=0: parking orbits take their authored inclination (Ω=0 convention), MNODE's Normal component comes alive, and the shooter gains the normal-direction DOF for plane-mismatched targets (28.5° LEO → 5.1°-inclined Moon is no longer coplanar).
- ΔV parity rule unchanged (magnitude from the node engine); the plane-change reality gap between the schematic ΔV model and 3D geometry gets an honest MATH.md critique (the node engine's plane-change model is still the accounting truth).
- Gate: 3D free-return golden; shooter 3-DOF convergence suite; plane-mismatch case converges or fails cleanly.

### R4 — J2 / orbital-economy layer (old P6, now fully drawable)

- `physJ2NodalRate(a, e, i, body)`, `physJ2ApsidalRate(...)` closed-form; readout chip in Define-an-Orbit + mission state ("nodal −0.986°/day — sun-synchronous ✓"); optional `physAccelJ2` integrator term so R2 can DRAW the precession on real inclined orbits.
- Gate: 800 km @ 98.6° → ≈0.9856°/day nodal; Molniya 63.4° → apsidal ≈ 0.

---

## Cross-cutting

- **New hard invariants (add to CLAUDE.md at P1/P2):** all body positions through `progBodyWorldPosCalibrated`/`physBodyStateAt`, no exceptions; physics artifacts in side-tables only; all propagation through `physPropagateSegment` (the S1.5-expansion analog — no ad-hoc integrators).
- **MATH.md:** new §"Numerical propagation" (integrator choice, step ladder, SOI model, shooter tolerances) + critiques (impulsive burns, on-rails bodies, sample decimation, coplanar-until-P5).
- **Gate growth:** 141 → ~220 assertions by P6.
- **Perf budget:** full mission recompute incl. propagation <50 ms; P5 frame render <16 ms.
- **Effort shape:** P0/P1 small-and-pure · P2 big (architecture) · P3 moderate · P4 big (numerics+UX) · P5 moderate-plus-fiddly · P6 small.

---

## COHERENCE SERIES (user-approved 2026-07-09, after R3 first flight) — orientation, gizmo, node map

User reports driving this: (1) arrival orbits render misaligned with the trajectories that create them ("always just a little misaligned"); (2) an LLO rendered as an arbitrary polar orbit ("inserting directly into a polar orbit for seemingly no reason"); (3) the Vector Burn form is unclear — wants a KSP-style maneuver gizmo; (4) the node map should be reworked to derive from the physics reality, with custom nodes gaining orientation detail so "polar-approach TLI" means something.

Root cause of (1)+(2): rings draw from the authored spec with the Ω=ω=0 convention (critique 46) while trajectories are real states — two authorities for one geometry.

### R3.1 — State-derived orbit rings + solved-RAAN defaults (574 + 565)

Orientation precedence for EVERY drawn orbit ring (one rule, three tiers):
1. **Authored orientation** (R3.2's fields) — if the orbit spec carries Ω/ω, that IS the orbit.
2. **State-derived** — no authored orientation but a converged physics leg arrives there: draw the OSCULATING elements of the post-arrival-burn state (`physStateToElements` of the propagated arrival state + insertion Δv applied along the arrival v̂). New side-table field on the arrival leg: `arrivalElements` (computed in 565's rebuild, consumed by 574's `_trajRingSVG` via a rec-level `elements` override). Burn marker sits ON the ring by construction. First converged arrival wins for a shared ring (same dedupe key); later arrivals don't re-orient it (stability under replay).
3. **Solved-RAAN default** — no orientation, no physics: keep authored {a, e, i} but SOLVE Ω so the ring passes through the point that created it (launch insertion point from the LAUNCH event's site/latitude context, or the schematic arrival point for planned legs). 1-DOF deterministic solve (ring plane must contain the point: Ω from atan2 on the point's projection); falls back to Ω=0 only when there is no creating point at all (define-an-orbit previews).
- Accounting untouched: authored {peri, apo, inc} remain the ΔV-engine inputs; orientation is geometry only in this phase.
- Gate: osculating-elements ring passes through the arrival state point (<1 km); solved-RAAN ring contains its creating point; determinism (same mission → same orientations).
- Verify (browser): Apollo LLO ring plane ≈ arrival trajectory plane (no more arbitrary polar LLO — measure the angle between ring normal and arrival-state h-vector, assert < 5°); arrival burn marker ON the ring (<2 px at fit zoom).

### R3.2 — Orbit orientation authoring (nodes + custom orbits) (430/570 node specs + 565 + 574)

- Orbit specs gain OPTIONAL `lan_deg` (Ω) and `argp_deg` (ω) alongside `inclination`. Persisted wherever orbit specs already serialize (custom orbits library, node overrides, .program) — absent fields mean "unauthored" (R3.1 tiers 2/3 apply).
- Node map + Define-an-Orbit UI: inc/LAN/ω inputs on the custom-orbit editor and node detail card, with the source badged: `authored` / `derived (from flight)` / `default (solved)`. Derived values are DISPLAYED back (e.g. "arrived in i=5.3°, Ω=141°") so users discover orientation matters and graduate to authoring it.
- Physics honors authored orientation end-to-end: `physSolveNodeBurn` builds departure states from the full authored element set; the shooter's target for an arrival into an ORIENTED orbit adds a plane-alignment component to the miss vector (angle between arrival h-vector and target plane normal, weighted; escalate DOFs as in P4) — insertion into "LLO i=90 Ω=X" is a genuinely different target than "any 100 km LLO". Clean converged:false when the fixed |Δv| can't reach the authored plane.
- **Edge-cost wiring (guarded)**: optionally price the authored plane into the node engine's ΔV (it already has plane-change math; today it assumes latitude-derived planes). OPT-IN per node ("price this orientation") + own goldens — silently repricing existing missions is forbidden (ΔV-parity discipline). Default off in this phase.
- MATH.md honesty note: authored LAN is an orbit property we model; REACHING a given LAN is a launch-window/wait problem we don't (COAST events are the future home of that cost).

### R3.3 — Maneuver gizmo (KSP-style) for MNODE authoring (574 + 570)

Replaces "type numbers into the Vector Burn form" as the primary authoring flow (the form stays as the precise-entry fallback and shows the live numbers).
- **Placement**: click a point on any orbit ring or trajectory polyline in the trajectory view → "add maneuver here" affordance (reuses the existing hit-path plumbing; the clicked sample's MET is the node's time; snap along-path by dragging).
- **Gizmo**: at the node point, draw three axis handles in the LOCAL frame — prograde (along v̂, accent color), radial (r̂), normal (ĥ) — as overlay-layer symbols anchored to the projected point (px-native, per the two-layer rule). Dragging a handle scales that Δv component (px-to-m/s gain ~ zoom-independent, shift = fine); the PREDICTED trajectory re-propagates live through the standard side-table path (throttled ~10 Hz like rotate-drag) and renders as the planned dashed polyline. This is exactly KSP's loop: drag, watch the trajectory bend.
- Mutation discipline unchanged: gizmo edits stage into the MNODE event's fields → `missionRecompute` → render (the live preview uses a scratch propagation, NOT a log mutation per drag tick; commit on release).
- 3D interplay: handles project through the pass camera; normal drags are how users FEEL the new R3 out-of-plane capability.
- Verify: drag prograde on a LEO node → apogee grows on screen and in the readout; normal drag tilts the predicted plane; release commits one undo step; escape/right-click cancels.

### R6+ FUTURE BACKLOG (user, 2026-07-10 — unscoped, capture only)

- **Real planet textures** ("don't have to be great, just real"): raster textures as embedded data-URIs (self-contained constraint — budget the file-size hit; tiny 128–256px equirect swatches or simple radial-gradient approximations of the real albedo may be the honest sweet spot; interacts with the SVG schematic aesthetic + theming — treat as data-not-chrome like PROG_BODY_COLORS).
- **Real launches from lon/lat**: launch site (lat exists; add lon) → the LAUNCH event's departure point sits at the real surface location on the drawn body; ties into RAAN-from-launch-time modeling (critique 49's honest gap).
- **Mock ascent path**: a schematic launch→parking-orbit curve (surface point to insertion point) so missions visually begin at the ground, not in orbit.
- **Better time display for intercepts**: time ticks/labels along trajectories, scrubbable MET, encounter countdowns — make "when do these two things meet" readable at a glance (extends the R3.4 CA pair).
- **Better control over launches**: launch-time/azimuth authoring (pins RAAN for real — closes critique 49), window hints.
- **Every event as a draggable node on the flight plan**: generalize the R3.3/R3.4 gizmo — all mission events (maneuvers, separations, coasts) visible as nodes on the trajectory and draggable in time/space; the trajectory view becomes the primary flight-plan editor. (Big; probably the post-R5 epic.)

### R5 — Node-map coherence pass (570 `_missionNmLayout` + selection model) — DONE 2026-07-10

The node map and trajectory view become two projections of ONE dataset — topology (plan/budgets) vs geometry (execution/time).

**Shipped**: SOI-derived `soiR` via new pure helper `_nmSoiLayoutRadius(body, fallback)` (430, log-scaled/clamped [45,260]px, anchored to Earth's legacy 150px, falls back to the old literal if `physSoiRadius` is unavailable/unknown body) — wired into `_missionNmLayout`'s `META` table (570). Edges annotated via new pure helper `_nmEdgePhysicsAnnotation(missionId, logIdx, legLookup?, caFn?)` (430, defaults to `physMissionLeg`/`_trajGizmoClosestApproach`) — converged legs get a "flown ✓" badge (accent-styled circle+check at the edge midpoint) plus a tooltip with real TOF (days) and closest-approach km when resolvable; unconverged/no-physics edges keep the schematic ΔV and are tooltipped "estimated (schematic)". ΔV numbers untouched (still only `progNmComputeEdgeDv`/`dvOverride`). Cross-view selection: `missionEdgeClick`/`missionNodeClick` now both route through a new `_missionNmSelectShared(id, idx)` that sets the SAME `m.log[idx]._expanded` flag `_trajSelectedAuthIdx` (574) already reads for ring/leg emphasis, and also calls `_trajGizmoOnEventSelected` — the identical hook the trajectory view's own ring/arc clicks use (`_trajSelectEventFromView`) — so a node-map click and a trajectory-view click land in the same state. Per-body true-ellipse insets (item 4) deferred — cosmetic/optional and out of budget this pass. Gate: 11 new assertions in `tests/math.test.js` (366 total, up from 355), covering layout-radius provenance/clamping/fallback and edge-annotation flown/estimated/TOF/CA paths.
- Layout derives from reality: body groups sized/positioned from real SOI structure (`physSoiRadius`) instead of hand-set `soiR` constants; per-body orbit fans list the same orbit records (with R3.1/R3.2 orientation shown on cards).
- Edges annotated from the physics side-table: converged legs show real TOF + closest approach + "flown ✓" badge; unconverged/planned edges show the schematic estimate and say so.
- Cross-view selection: node ↔ ring, edge ↔ maneuver event/polyline — one selection model, both views highlight (the event-selection plumbing already exists on both sides; this wires node/ring ids through it).
- Cosmetic (optional, last): per-body insets use the true-geometry sampled-ellipse renderer at fixed scale so the schematic view stops drawing false circles.

Sequencing: R3 verify/push → R3.1 → R3.2 → R3.3 (gizmo) → R3.4 (gizmo usability/KSP parity) → R4 (J2, unchanged scope) → R5 (node map). R3.1 is small; R3.2 medium (touches persistence + shooter targeting); R3.3 medium-UI; R5 medium.

### R3.4 — Gizmo usability + KSP parity (user first-flight feedback on R3.3, 2026-07-10)

User reports: handles hard to grab (camera drag fights them); wants node draggable in TIME along the orbit + "orbit +1/−1"; wants KSP's closest-approach pair ("how much the planet will have moved, when the encounter happens"). Research: KSP's map camera has NO drag-pan (drag rotates, scroll zooms, click focuses) — that's why its gizmo is grabbable; stock node = six pull-out handles (pro/retro, normal/anti, radial in/out), center-drag slides the node along the orbit, right-click menu has Orbit +1/−1 + delete; with a target set, paired markers show craft-at-closest-approach AND target-at-that-time, plus orbit-intersect markers.

1. **Camera rework (KSP semantics — the enabler)**: LEFT-DRAG ROTATES (az/el — replaces shift/right-drag as primary; those keep working as aliases), WHEEL ZOOMS toward the anchor center (cursor-anchored offset zoom RETIRES — without pan you could never undo the offset), CLICK A BODY/RING CENTERS (exists since R2/R3.1). Drag-pan REMOVED; relOffsetKm stays in the camera struct (fit math uses it) but is only ever set to 0. Reset = top-down re-fit. Mid-drag rotate keeps the ~30fps throttle; the overlay mid-drag translate hack retires with pan.
2. **Six pull-out handles** (KSP layout): pro/retro along ±v̂ (var(--accent)), normal/anti along ±ĥ (var(--accent3)), radial out/in along ±r̂ (var(--accent2)). Pull AWAY from the node to increase that component (no sign-flip-through-zero — the opposite handle is the negative). Knob hit radius ≥ 12 px; HOVER HIGHLIGHT (brighten + slight scale via onmouseenter/leave attribute swap on the overlay elements). Degenerate-projection glyph rule from R3.3 stays for edge-on axes.
3. **Node time control**: dragging the CENTER knob slides the node along its orbit — screen drag projected onto the local v̂ screen direction → dMET = ds/|v| (km/s), live-updating theta = n·MET and the preview. A small node menu (click the center, or a ⋯ affordance on the plate): **+1 orbit / −1 orbit** (MET ± 2π/n of the node's orbit), **delete node**, **close gizmo**. Menu markup follows the existing flyout pattern (traj-flyout).
4. **Closest-approach pair**: whenever the gizmo preview (or a selected committed MNODE's leg) has a relevant target — the mission's next destination body, else the body whose SOI the preview approaches nearest — compute closest approach over the propagation and render: (a) craft-at-CA marker ON the preview path; (b) target-body-at-CA ghost marker (existing _trajGhostMarker vocabulary) at the body's REAL position at t_CA; (c) plate readout "CA 12,340 km · in T+2d 13:04"; (d) if the preview enters the target SOI, swap to an "ENCOUNTER" state (accent highlight, SOI-entry time shown). Update throttled with the preview.
5. Dock numeric fields remain the precision fallback (unchanged).

Verify: handles grabbable without camera fights (drag on empty space rotates, drag on knob edits — no leakage either way); center-drag slides MET monotonically; ±1 orbit moves MET by the orbital period; CA pair matches the propagation's measured minimum (gate the pure CA-extraction helper); Apollo/free-return regressions; matrix + console clean.

### R3.5 — Gizmo polish (user flight-test feedback on R3.4, 2026-07-10)

Second round of first-flight feedback, six items, all shipped in this pass:

1. **Center-knob time-drag, cursor-nearest-sample**: the R3.4 center-drag integrated an incremental `dMET = pxAlong·kmPerPx/|v|` projected onto the node's INSTANTANEOUS v̂ — as the node moved around the curve, v̂ rotated away from the drag direction (sign flips, "only lets me rotate one way"). Replaced with KSP-style grab-and-slide: at drag-start, sample one period of the ring in SCREEN space (64 points via the existing `_trajGizmoNodeState` reconstruction, projected through the same camera pipeline as the overlay), then every move snaps the node's MET to whichever sample is nearest the CURSOR (`_trajGizmoNearestScreenMet`, squared-distance nearest search — pure/tested). Stays on the same lap the node started on (`Math.floor(met0/period)*period` + the local sample's MET); ±1/−1 orbit (menu) still changes laps. Degenerate/hyperbolic nodes (no closed ring) fall back to the old projection formula (`_trajGizmoCenterDragDMet`, kept for that case only).
2. **Orbit direction cue**: `_trajRingSVG` (574) now splits its 96-sample ring polyline into 10 opacity-graded segments via `_trajRingDirSegments` (pure: given the projected screen points in sample order, returns contiguous sub-runs with opacity ramping 0.25→1.0) instead of one uniform-opacity path. Sample order is increasing eccentric anomaly = direction of motion (confirmed against `progOrbitSamplePoints`, 360), so the bright end leads and the ring fades behind it, KSP-style. Same stroke color, opacity only — no new chromatic literal. Physics-leg polylines (`_trajPolylineSVG`) were left as single-opacity paths (out of scope per the brief — rings carry the cue).
3. **Camera tilt clamp loosened**: `trajPanMove`'s el clamp was `[0.087, π/2]` — one quarter-turn only (near-horizon to top-down), so drag-rotate visibly stalled past that. Loosened to the full continuous `±(π/2 − 0.01)` (a hair short of the poles, where az/el is singular); az was already wrapping freely via `%` (harmless negative results). Footer's tilt readout (`_trajFooterHTML`) updated to gate on `|elDeg| < 89` instead of `elDeg < 89` so it still hides only at the canonical top-down default.
4. **Opposing-handle zero-crossing clamp**: R3.4's per-handle `dv0` always started a freshly-grabbed handle's side-magnitude at 0 (floored via `_trajGizmoHandleValue`), so grabbing the OPPOSITE handle while the paired component was nonzero (e.g. +50 pro) made the component JUMP straight to a small negative value on the very first drag pixel, rather than draining smoothly to 0 first. Replaced the handle-drag math with `_trajGizmoDragComponentValue(compStart, sign, deltaDv)` — `compStart` is now the component's RAW signed value at grab time (not a per-handle floor) — composing `_trajGizmoClampCross(prev, next)` (clamps to 0 the instant a candidate would cross the sign of the drag-start value) with the existing own-direction floor. Net effect: dragging the opposite handle drains the existing value down to 0 and STAYS there for the rest of that drag (matches the user's "pulling the anti-handle drains the component to 0 and stops" description); releasing and re-grabbing starts a fresh drag with `compStart = 0`, which is when the opposite sign is free to build. `_trajGizmoHandleSideMag` (R3.4) is kept (still pinned by its own gate tests) but is no longer on the live drag path.
5. **Handle glyphs → vectors**: the six handle knobs (`_trajGizmoOverlaySVG`, 5745) are now short arrow triangles at the tip of each shaft line instead of plain knob circles/dots — filled triangle for a "+" handle, hollow/outline triangle for the paired "-" handle (same outline-only ± distinction as before, no new color). The ≥12px transparent hit circle and hover-hook (`_trajGizmoHoverKnob`) are unchanged in placement; the hover swap now branches on the sibling's tag (`circle` for the legacy degenerate-projection diamond fallback, `polygon` for the new arrowhead — brightens opacity + thickens the outline stroke rather than resizing, since a triangle's points aren't cheaply "grown" in place).
6. **Escape trajectory now continues into the heliocentric frame**: root cause was NOT the propagation — `physPropagateSegment` already performs the normal SOI handoff into the Sun frame once `ctx.bodies` includes `'Sun'` (the full-fidelity preview already did). Two separate things silently threw the result away: (a) the horizon was capped by the ORBITAL PERIOD for elliptical states only, and defaulted to a flat 30 days otherwise — mostly consumed by the local hyperbolic departure, leaving little/no heliocentric arc; (b) `_trajGizmoRepaintScenePreview` (5745) explicitly filtered preview samples down to `s.frame === g.node.body`, i.e. it drew ONLY same-body samples and threw away every post-escape (Sun-frame) sample outright. Fixed both: the full-fidelity pass now detects an escape result state (`el.a` not `>0` or `!isFinite(el.period)`) and extends the horizon to 90 days (cheap mode untouched, still single-frame/short per the fidelity ladder); the scene-preview renderer now builds its path through the SAME multi-frame polyline machinery committed legs use (`_trajPolylineSVG` + a per-frame `anchorOf` resolver keyed off `progBodyWorldPosCalibrated`), so a Sun-frame tail renders exactly like a committed interplanetary leg would.

New pure helpers (5745, all pinned by `tests/math.test.js`, "R3.5" dated block): `_trajGizmoNearestScreenMet`, `_trajGizmoClampCross`, `_trajGizmoDragComponentValue`, `_trajRingDirSegments`.

Not gate-testable (interactive feel/DOM) — flight-test only: drag smoothness of the new cursor-nearest-sample center-drag, the visual weight/legibility of the arrowhead glyphs at various zooms, whether 90 days is enough/too much heliocentric arc for a typical escape preview, and full-range camera tilt in actual mouse use (verified headlessly only as pure clamp-math + module load smokes — no browser session was available for this pass).

### R3.5.1 corrections (2026-07-10, user flight-test on R3.5)

Three items came back from flight-testing R3.5 itself:

1. **Arrowhead handles reverted.** Item 5's arrow-triangle glyphs killed the hover-highlight swap and were harder to grab than the old circles. Reverted to circular knobs + the pre-R3.5 hover-expand behavior (`_trajGizmoHoverKnob` now scales a glyph `<g>` around its own anchor instead of resizing a `<circle>` radius), and layered a KSP navball-style stroke glyph *inside* each knob via a new pure builder `_trajGizmoKnobGlyphSVG(key, r, color, negSide)`: prograde/retrograde get the 3-spoke marker (retrograde adds an X), radial-out/in get 4 outward/inward spokes, normal/anti-normal get an outline triangle pointing away/toward the node. Same per-handle `var(--accent*)` color as before — no new chromatic literal.
2. **Rate-based drag, not a zero-cross clamp.** Item 4's `_trajGizmoClampCross`/`_trajGizmoDragComponentValue` stopped a component dead at 0 when the opposite handle was pulled — correct KSP behavior is a continuous RATE while held (pull distance -> m/s per second), freely crossing zero into negative territory. Replaced the live drag path with a `requestAnimationFrame` ticker (`_trajGizmoHandleTick`) started on handle-down and stopped on release/cancel: each tick projects the CURRENT cursor position onto the handle's own axis (floored to 0 — pushing back toward the node yields zero rate), converts to a rate via the new pure `_trajGizmoPullRate(pullPx, shiftHeld)` (power-curve ramp, `_TRAJ_GIZMO_RATE_MS_PER_S` ≈ 20 m/s² at a 40px pull, ×0.1 with Shift), and integrates `component += sign·rate·dt` with NO floor — matches the user's "drains through zero and keeps going the other way" description. `_trajGizmoClampCross`/`_trajGizmoDragComponentValue` are kept (still gate-pinned, still technically usable) but are no longer called from the live path. The ticker only schedules the CHEAP scratch refresh per tick (`_trajGizmoScheduleScratchCheap`, new — arms just the 100ms throttle, never the full-fidelity timer) so holding a handle motionless doesn't spam full n-body passes every frame; the full-fidelity debounce is instead armed once at drag-start and re-armed on actual cursor movement (see item 3).
3. **Interplanetary/escape preview root cause.** Reproduced headlessly (node+vm, loading 010/140/145/150/360/385/386/565/410/430/574/5745 with stubbed `document`/`performance`/`requestAnimationFrame`): built a LEO state (a=6771 km, circular) via vis-viva, applied a +3300 m/s prograde Δv (hyperbolic result, `a<0`, non-finite period — confirmed escape), and ran the real `physPropagateSegment(state, 0, 90d, {center:'Earth', bodies:['Earth','Sun']}, {maxSamples:160})` the gizmo's full-fidelity pass uses. **Propagation was never the bug**: 145 samples came back, 106 Earth-frame + 39 Sun-frame, confirming the SOI handoff into the heliocentric frame works exactly as R3.5 item 6 already fixed. Then drove `_trajGizmoOpenPending` + `_trajGizmoRunScratch('full')` + `_trajGizmoRepaintScenePreview` directly (the actual functions, not a re-implementation) against a stubbed DOM: `g.preview.samples` came back with the same 106/39 Earth/Sun split, and `_trajGizmoRepaintScenePreview` DID emit a non-empty multi-frame `<path>` spanning both frames — so R3.5 item 6's `_trajPolylineSVG`-based renderer is also not the bug in isolation. **The actual gap was UX/timing, not rendering**: the R3.5 debounce only arms `_trajGizmoFullTimer` from `_trajGizmoHandleMove` (real mousemove events), and `_trajGizmoHandleUp` clears it — so a user who drags briefly and releases (the natural gesture before R3.5.1's rate-based redesign) never gives the 2-second-stationary window a chance to fire even once, and the escape/heliocentric extension never gets computed before commit. Fixed by arming the debounce once at `_trajGizmoHandleDown` (drag-start) in addition to real-movement re-arms — combined with item 2's rate-based hold-to-build gesture (which naturally keeps the handle down and still for 1-3+ seconds), the 2s window now reliably elapses DURING a normal drag. Smoke output (abbreviated): `elements: a=-149828.3 e=1.045 period=NaN isEscape=true` / `samples by frame: {"Earth":106,"Sun":39}` / `preview samples by frame: {"Earth":106,"Sun":39}` / `scene preview emitted a non-empty <path>: true`.

Still flight-test only: whether the rate ramp constant (20 m/s² at 40px) feels right, whether 2s-into-a-hold is early enough in practice, and — separately, OUT OF SCOPE for this pass — whether the preview is legible at the camera's LEO-local zoom once it reaches interplanetary scale (the smoke's Sun-frame render coordinates are ~10⁵–10⁶ render units against a ±200 viewBox at a typical LEO-editing zoom; the path data is correct and present, but a user editing a burn zoomed in on Earth won't see the far end without zooming/panning out — no auto-fit-during-drag exists and none was added, since the brief scoped this item to "does the pipeline produce and draw the samples," not camera behavior).

### R3.5.2 corrections (2026-07-10, second flight-test — browser-verified)

The heliocentric preview was STILL invisible after R3.5.1, and the gizmo had no pointer dismiss. Diagnosed live in the browser preview (tooling back up) by driving the real page:

1. **Full-fidelity pass never ran at all** — `_trajGizmoRunScratch` opened with `if (!g.drag && !g.centerDrag) return;`, but the full debounce deliberately fires ~2s AFTER mouseup, when drag is already null — so every full pass since R3.4 was silently skipped and only the cheap Earth-only preview ever rendered. (The R3.5.1 headless smoke passed because it injected a fake drag before calling.) Fix: the guard now only applies to cheap-mode ticks; `'full'` runs whenever the gizmo is open. Verified live: post-release debounce now yields `fidelity:'full'` with a 113 Earth + 39 Sun frame split.
2. **World re-renders wiped the scene preview** — camera zoom/rotate/re-center rebuilds `g.traj-scene`, clearing the gizmo's preview path; only `_trajGizmoRepaintOverlay` was hooked at 574's two overlay-resolve sites, so the escape arc vanished the instant the user zoomed out to look at it. Fix: `_trajGizmoRepaintScenePreview` is now called at both sites. Verified live: zoom to heliocentric scale (anchor Sun, 5.2e8 km) keeps the arc (bbox ~88×131 render units).
3. **Pointer dismiss** — left-click anywhere that isn't the gizmo layer/menu closes it (guarded by `_trajJustDragged` so camera rotate-drags don't dismiss), and right-click closes when not mid-drag (mid-drag right-click still cancels the drag). Escape unchanged. Verified live: background click closes + clears both layers; rotate-drag leaves it open.
4. **COMMITTED MNODE legs invisible at both zoom extremes** (third flight-test round; all browser-verified). Two independent gates hid them: (a) at heliocentric zoom the leg rendered only inside `_trajBodyFrameContent`, whose caller wraps everything in the body's `zoiAlpha` fade — 0 at solar scale, so the escape leg vanished with the rest of Earth's local content. Fixed by extracting the MNODE loop into shared `_trajMnodeLegsSVG(...)` called (i) inside body-frame content as before and (ii) from the planet loop OUTSIDE the gate for multi-frame legs only, at opacity `1 − zoiAlpha` (cross-fade, no double-draw). (b) At parking-orbit zoom the leg's screen extent blew past both the transferArc LOD high edge AND `_trajCullRingByDiagonal` inside `_trajPolylineSVG` — fixed with `ctx.noHighFade` (MNODE legs skip the high-side fade) plus `opts.viewClampUnits` (samples beyond 3×`_TRAJ_VB` from view center break the run instead of drawing — keeps the near-body portion visible without emitting rasterizer-hazard coordinates). Also: committed escape legs now propagate 90 days (was 30) in 565's MNODE leg builder, matching the gizmo preview. Verified live at LEO (30,000 km), SOI (2.5e6 km), and heliocentric (5.2e8 km) camera widths: leg path present at all three.
