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
