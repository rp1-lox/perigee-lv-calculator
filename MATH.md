# MATH.md — Rocket Playground Methodology

Every physics calculation in the program, where it lives, what it assumes, and where it's weak. **This file is load-bearing: if you change any math, update this file in the same commit** (CLAUDE.md enforces this). Critiques are collected at the bottom — add to them honestly when you spot a weakness; they are the to-do list for model quality.

Conventions: masses kg · thrust kN (converted to N internally) · Isp seconds · ΔV m/s unless noted · altitudes km above surface · `G0 = 9.80665 m/s²` · Earth `MU` (km³/s²) and `RE` (km) in `010-constants.js` · other bodies in `PROG_BODIES`. Every stage/engine carries ONE representative Isp — there is no altitude-dependent Isp anywhere in the program; users choose sea-level, vacuum, or trajectory-averaged values by convention (typically SL-ish for first stages, vacuum for uppers).

---

## 1. Rocket equation (the foundation)

`rocketEq(isp, m0, mf)` (140-physics.js) — Tsiolkovsky:

```
ΔV = g0 · Isp · ln(m0 / mf)
```

Degenerate inputs (mf ≤ 0, m0 ≤ mf) return 0. The program-side twins `progRocketEqDv(m_wet, m_prop_consumed, isp)` and its inverse `progRocketEqPropNeeded(m_wet, dv, isp) = m_wet·(1 − e^(−ΔV/(g0·Isp)))` live in 380 and drive mission burns.

Usable propellant everywhere excludes residuals: `prop_usable = prop · (1 − res/100)`.

## 2. Launch performance — the Townsend-Schilling model

`lvPerformance(stages, booster, pay, fairingMass, fairingJ, parkingAlt, onOrbitDV, siteLat, azMin, azMax)` (140-physics.js) is the single source of truth for ascent performance — the LV calculator, the mission LAUNCH event, the orbits-page vehicle selector, and every trade-study sweep all call it. It is an **empirical ΔV-budget model**, not a trajectory integrator: no altitude, drag, or pitch profile is simulated. Structure:

**2.1 Ideal ΔV per stage.** Serial stages burn bottom-up. For stage s with payload-above mass `spM[s]` (all stages above + payload + fairing while attached):

```
m0 = dry + prop_usable + spM[s],  mf = dry + spM[s]
ΔV_s = rocketEq(isp, m0, mf);   burn time bt_s = prop_usable / ṁ,  ṁ = F/(g0·Isp)
```

**2.2 Parallel boosters — event-driven integrator.** When booster groups exist, stage 0's ΔV/burn-time are replaced by a piecewise integration: between "events" (a group igniting at T-0 / after a predecessor / at a fixed time; a group or the core running dry) the active engine set is constant, so each interval is one rocket-equation step at the **blended effective Isp**:

```
Isp_eff = ΣF / (Σṁ · g0)        (true thrust-weighted harmonic mean, per interval)
```

Per-group `parallelMode`: `independent` (each burns its own tanks), `crossfeed` (boosters feed the core — the core reaches staging with full tanks; core mass-flow is drawn from the booster groups evenly), `throttle` (the core throttles to `coreThrottle` while that group burns — also reduces liftoff thrust). Spent groups drop their dry mass immediately. A guard caps the loop at 500 events. This block reduces exactly to the plain serial computation for a single ground-lit group (regression-tested).

**2.3 Gravity + drag losses (the empirical core).** With `Hp = parkingAlt` (km):

```
K3 = 429.9 + 1.602·Hp + 1.224e-3·Hp²         (m/s)
K4 = 2.328 − 9.687e-4·Hp                      (m/s per second)
T3s = 3·(1 − e^(−0.333·Vcirc/(g0·Isp_avg)))·g0·Isp_avg / A0
Tmix = 0.405·Ta + 0.595·T3s
ΔV_penalty = K3 + K4·Tmix
```

where `A0` = liftoff thrust / liftoff mass, `Isp_avg` = burn-time-weighted average Isp, and `Ta` = burn time **only up to reaching Vcirc** (fractional within the crossing stage via an exponential prop-fraction interpolation) — deliberately so low-thrust upper stages aren't charged gravity/drag losses for burns that happen after insertion. The K3/K4/T3s forms and the 0.405/0.595 mix are fitted constants from the Townsend/Schilling launch-performance estimation method; treat them as a package — do not tune individual constants without re-validating against known vehicles.

**2.4 Earth rotation credit.** `rotVel(lat, azMin, azMax)`: `V_rot = ωE·RE·cos(lat)·cos(az−90°)`, maximized over {azMin, azMax, 90°} and clamped to [0, ωE·RE·cos(lat)]. A site whose azimuth window excludes due east gets partial credit.

**2.5 The budget.**

```
DVasc = Vcirc + ΔV_penalty − V_rot
DVtot = DVasc + onOrbitDV
margin = ΣΔV_s − DVtot
```

**2.6 Max payload.** `lvMaxPayload(...)`: 40-iteration bisection on payload ∈ [0, 2,000,000 kg] for margin = 0 (margin is monotonically decreasing in payload, so bisection is valid). Returns 0 if even zero payload has negative margin.

## 3. Destination ΔV (`onOrbitDV`)

Two implementations that MUST agree: the original inside frozen `calculate()` (160) and the pure transcription `destOnOrbitDV(dest, siteLat)` (145) — pinned together by regression goldens captured from the real calculate() (tests/math.test.js). All burns are impulsive, all transfers two-body Earth.

**Orbit mode** (target apogee/perigee/inc from a circular parking orbit at `parkingAlt`), with `vPeri/vApo` from vis-viva:
- Target ≈ parking (both within 5 km): 0.
- Circular target (|apo−peri| < 5 km): Hohmann `dv1 = |v_peri(transfer) − Vc_park|`, then either
  - **combined plane change at apoapsis** if a plane change is needed AND apogee > 10,000 km: `√(va² + vc² − 2·va·vc·cosθ)` replacing the circularization burn (the classic GEO trick), or
  - separate circularization + plane change at parking-orbit speed: `2·Vc·sin(θ/2)`.
- Elliptical target: `dv1` raises apogee, `dv2 = |vApo(target) − vApo(transfer)|` adjusts perigee at apoapsis (skipped when |perigee − parkingAlt| < 50 km), plane change added separately (never combined).
- Plane change is only charged when `inc < |siteLat| − 0.5°` — the model assumes launch inclination = site latitude (minimum-inclination due-east launch) and that HIGHER-than-latitude inclinations are reachable by launch azimuth at no ΔV cost (the azimuth window only affects V_rot).

**Escape mode** (C3, declination): from vis-viva at the parking perigee,

```
V_inj = √(Vesc² + C3),  Vesc² = 2μ/r     →  onOrbitDV = V_inj − Vcirc(parking)
```

plus a declination plane-change penalty `2·Vc·sin(Δ/2·...)` when |siteLat| exceeds |declination| by > 0.5° (Δ = the excess). C3 below −Vesc² is rejected as an error.

## 4. Stage-and-a-half (S1.5)

`_s15BecoSplit(s)` (150). An S1.5 stage (Atlas-style: jettisonable booster engines + continuing sustainer) is split into two virtual serial phases before ANY physics:

- **BECO point** from a jettison-TWR criterion using **stage-only mass** (payload above is deliberately ignored; the comment claims < 5 % ΔV error for Atlas-class): `m_after = F_sust/(twr·g0)`; propellant before BECO is `prop_ph1 = (dry+prop) − (m_after + jet_mass)`.
- **Phase 1** (all engines): thrust = authored stage thrust; Isp = the authored stage Isp, OR — when the optional `s15_boost_isp` field is present — the **mass-flow blend** `Isp_ph1 = F_tot / ((F_tot−F_sust)/Isp_boost + F_sust/Isp_sust)`. Note the sustainer term reuses `s15_sust_isp` (stored as vacuum — see critique 10a).
- **Phase 2** (sustainer alone): thrust = `s15_sust_thrust`, Isp = `s15_sust_isp`, dry mass reduced by the jettisoned pack.

⚠️ The pure physics (`lvPerformance`/`lvMaxPayload`) knows nothing about s15 fields — every consumer must expand first. Splitters: `calculateWithS15` (worksheet), `_fleetExpandStages` (560), `_tsExpandStages` (165, also used by 167). This invariant has been violated twice; the gate has an Atlas golden guarding it.

## 5. Mission engine (program mode)

**Live stages** (370): a stage instance = dry mass + tanks (`fill`/`capacity` per propellant type). Burns drain tanks in order (`progBurnPropellant`); COAST periods apply **boiloff** `fill·e^(−rate·insulation·days)` per cryo tank.

**Ascent staging** (`_missionApplyLaunch`, 570): the LAUNCH event runs `lvPerformance` on the snapshot vehicle (S1.5 expanded, boosters included in stage 0) to get `DVasc` (required) and per-stage ΔVs. It then walks stages bottom-up: stages whose full ΔV is consumed before meeting the requirement are burned dry and EXPENDED; the stage that crosses the requirement is the **insertion stage** — its propellant use comes from inverting the rocket equation on the full remaining stack (`progRocketEqPropNeeded` with mass-above included), leaving real residual propellant for later mission ΔV. Upper stages that never ignite ride to orbit untouched (there is deliberately NO forced stage-at-burnout). Spacecraft payload stages are never burned during ascent. When no performance data exists, the required ΔV falls back to `_missionDvToOrbit(body, alt) = Vcirc + fixed loss` with a per-body loss table (Earth 1550, Mars 1100, Venus 1700, Moon 20, Mercury 200, Titan 1400 m/s).

**Maneuvers** use the node-map physics (below) for required ΔV, then `progRocketEqDv/PropNeeded` against the active vehicle's stage stack. **Docking** requires `progOrbitalStateMatch`: same body, apogee/perigee within 1 km, inclination within 0.1°, LAN within 1°.

**Mission time (T1 — `missionRecompute`, 570)**: time is DERIVED from the replay, never authored as position. A mission clock (seconds) walks `m._expanded` in order; T-0 is the FIRST LAUNCH event (anything authored before it sits at T+0). Duration rules per event type:

| Event | Auto duration |
|---|---|
| LAUNCH | Ascent burn time — `lvPerformance`'s `tBT` (sum of per-stage burn times), cached onto `stagingResult.burnTime` |
| BURN (HOHMANN) | `progHohmannTOF(body, periBefore, burnParam)` — the Hohmann coast this burn initiates |
| BURN (TLI) | `progHohmannTOF('Earth', periBefore, PROG_MOON_ORBIT_R − R_Earth)` — the translunar coast |
| BURN (LOI) | 0 — arrival burn at the end of an already-counted TLI coast |
| BURN (CIRC / PLANE_CHANGE / CUSTOM) | 0 — treated as impulsive with no separate coast leg |
| MANEUVER | `progTransferTOF(fromNode, toNode)` — the coast, not the (impulsive) burn itself |
| everything else (DEPLOY, SEPARATE, DOCK, EXPEND, RENDEZVOUS, transfers, REENTER, RECOVER) | 0 — COAST as its own event type doesn't exist yet (T2) |

`progHohmannTOF(body, alt1_km, alt2_km)` = half-ellipse period `π·√(a³/μ)`, `a=(r1+r2)/2`. `progTransferTOF(fromNode, toNode)` classifies the node pair (mirrors `_nmDvPhysics`'s node shape): same-body circular/elliptic/surface → Hohmann half-ellipse between average altitudes; Earth → lunar transit/LLO/lunar-surface → translunar half-ellipse to `PROG_MOON_ORBIT_R`; Earth → interplanetary transit (Mars/Venus/…) → heliocentric Hohmann TOF via `PROG_HELIO_R`/`PROG_MU_SUN`, UNLESS the program has a selected Lambert launch window (`PROG_ACTIVE_PROGRAM.launchWindow.tof_days`), which is authoritative when present; anything else (surface↔surface, unmodeled pairs) → 0.

**Overrides**: each log entry may carry `durationOverride` (seconds) and, for MANEUVER, `dvOverride` (m/s) — both authored fields that ride undo/autosave for free since they live on `m.log`. `durationOverride` replaces the auto duration in the clock accumulation. `dvOverride` replaces the node-map-computed ΔV requirement **before** propellant computation in `_missionApplyManeuver`, so the rocket equation (and everything downstream — flight-readiness checks, state-panel numbers) consumes the custom value consistently; there is no separate override-aware code path to keep in sync. Both are cached alongside the auto value (`e.durationAuto`/`e.durationUsed`, `e.dvAuto`/`e.dvRequired`) so the UI can badge overridden events "(custom)" and offer "reset to auto". `_metFmt(sec)` renders the running clock as `T+MM:SS` / `T+HH:MM` / `T+Nd HH:MM`; display only, never fed back into layout or physics.

## 6. Node-map ΔV physics (360 + 430)

`progNmComputeEdgeDv(from, to)` → `_nmDvPhysics`: same-body transfers compose Hohmann legs (`progDvHohmann`, vis-viva exact), plane changes (`progDvPlaneChange = 2v·sin(θ/2)`; `progDvPlaneChangeFull` gets the true angle between planes from the spherical law of cosines `cosθ = cos i1·cos i2 + sin i1·sin i2·cos ΔLAN`; `progDvCombined` vector-adds a plane change with a coplanar burn), and apoapsis circularization (GTO→GEO). Cross-body transfers are **patched conics with impulsive burns**:

- **TLI**: Hohmann from LEO to the Moon's orbital radius.
- **LOI/TEI**: v∞ at the Moon = |v_moon − v_apo(TLI)|, then hyperbolic-to-circular at LLO: `ΔV = √(v∞² + 2μM/r) − √(μM/r)` (the Oberth form). TEI is assumed symmetric to LOI. The code itself documents the known underestimate (~822 m/s vs ~900 real Apollo LOI with free-return constraints).
- **TMI/TVI + MOI/VOI**: heliocentric circular-coplanar Hohmann between planet orbits gives v∞ at departure/arrival; departure and capture burns use the same Oberth form at LEO/target-orbit radius. No plane change, no synodic timing (timing lives in the porkchop, separately).
- **Surface↔orbit**: Earth ascent uses the launch model; lunar/Mars ascent are scaled baselines (`1870 m/s` at LLO-100, `3810 m/s` at MCO-400, scaled by the ratio of target-orbit circular speeds). Descent numbers mirror ascent.

## 7. Porkchop plotter (410)

A real **Lambert solver** (universal variables with Stumpff functions C(ψ), S(ψ), bisection on ψ) over a departure-date × time-of-flight grid, on a **circular, coplanar** planet model (fixed radii, periods; phase angle `theta0` calibrated so the Hohmann window sits near T+0 — dates are therefore RELATIVE, not calendar). Output: C3 heatmap; the selected cell sets the program's launch window / coast duration. Independent of the node-map ΔV numbers.

## 8. Trade studies (165)

All sweeps evaluate the SAME pure pipeline per point: assemble vehicle (worksheet DOM or `_tsVehicleToBase` adapter) → S1.5 expand → `destOnOrbitDV` for the destination (or the swept parking/inclination values via the minimal circular-orbit plane-change replica `_tsOnOrbitDVCircular`) → `lvMaxPayload` / `lvPerformance`. Metrics: max payload; ΔV margin (at the vehicle's payload input); **payload fraction** = maxPay / tMas(at maxPay) × 100 (tMas from lvPerformance = exact liftoff mass incl. fairing/boosters — not an approximation); total ΔV; total burn time; liftoff T:W = A0/g0. Capability curves are clipped at their interpolated zero-crossing; margin curves keep their negative region. **Tornado**: one-at-a-time ±p% on each authored parameter (per-stage Isp/dry/prop, booster prop/thrust/Isp), re-deriving the S1.5 split per evaluation, bars sorted by |swing|; no parameter interactions.

## 9. Regression protection

`tests/math.test.js` (run by every `python build.py`): Tsiolkovsky hand values, lvPerformance invariants + golden snapshot, booster single-vs-array equivalence, lvMaxPayload convergence, `destOnOrbitDV` pinned to browser-captured `calculate()` outputs (GTO / plane change / escape), S1.5 split conservation + expanded-golden + divergence proof, preset name-resolution integrity. **Changing physics intentionally = re-capture goldens in the same commit, with a dated comment.**

---

## Critiques (known weaknesses, roughly by severity)

**Ascent model**
1. K3/K4/T3s/Tmix are fitted empirical constants of unstated provenance and envelope. They validate well against 1960s–present orbital LVs (Saturn V, F9 land within a few % of published capability), but nothing warns the user when a design leaves the fit's envelope (TWR ≪ 1.2 at liftoff, very lofted or depressed trajectories, air-launch).
2. Single static Isp per stage/engine — no altitude dependence. First-stage numbers are whatever the data author blended by hand; two vehicles with identical physics but different Isp-averaging conventions aren't comparable at the few-percent level.
3. The booster integrator blends Isp correctly per interval, but the Townsend penalty is computed from aggregate `A0`/`Isp_avg`/`Ta` — parallel-staged vehicles get a serial-equivalent loss estimate.
4. `Ta`'s fractional-stage interpolation uses an exponential prop-fraction heuristic, not the actual time-to-Vcirc within the stage.

**Destination ΔV**
5. Plane-change logic assumes initial inclination = |site latitude| and charges nothing for inclinations above latitude (real azimuth constraints and range-safety corridors can make those expensive). Retrograde/SSO targets are only "charged" via lost rotation credit.
6. The combined-plane-change-at-apo optimization triggers on an arbitrary `apogee > 10,000 km` threshold; elliptical targets never get the combined treatment (plane change added scalar, not vectorially).
7. Tolerance constants (5 km "circular", 50 km "same perigee", 0.5° plane-change deadband) are unlabeled magic numbers.
8. Escape declination penalty is a crude great-circle plane change at parking speed; no DLA/azimuth interaction.

**S1.5**
9. BECO located on stage-only mass (payload ignored) — the "< 5 %" error claim is asserted, not tested, outside Atlas-class proportions.
10. Phase-1 blend (when used) is static; booster-pack jettison is instantaneous with no thrust decay, and `s15_beco_twr` defaults to 1.2 regardless of vehicle.
10a. The blend's sustainer term uses `s15_sust_isp`, which the library stores as the VACUUM value (it primarily serves Phase 2) — so the Phase-1 blend is optimistic at low altitude, where the sustainer's real SL Isp is far worse (LR-105: ~215 s SL vs 309 s vac). With Atlas data the blend RAISED Ph.1 Isp (282 → 285.5 s) rather than lowering it. To make the blend represent liftoff conditions you'd need a separate sea-level sustainer Isp field, or the user must fold the pessimism into `s15_boost_isp`. Known and accepted for now.

**Mission / node map**
11. Two ascent models coexist: Townsend (when LV performance data exists) vs `Vcirc + fixed-loss table`. A mission can silently switch fidelity depending on how the vehicle was created. The loss table itself (Earth 1550 etc.) is a rough constant independent of TWR or target altitude.
12. LOI/TEI patched-conic underestimates (~10 %, documented); TEI = LOI symmetry is a simplification; no free-return or finite-burn losses anywhere.
13. Interplanetary transfers: circular coplanar planets, no plane change, no arrival-timing coupling between the node map ΔVs and the porkchop's Lambert solutions — the two subsystems can disagree about the same trip.
14. Docking tolerance windows (1 km, 0.1°, 1° LAN) are arbitrary, and `epoch`/phasing is entirely ignored — co-orbital ≠ co-located.
15. Lunar/Mars ascent = scaled constants; no TWR sensitivity, no plane targeting from launch site latitude on those bodies.
16. Boiloff: constant fractional rate, insulation as a linear multiplier in the exponent; no tank thermal state, no ullage/pressurization losses.

**Mission time (T1)**
16a. Hohmann-model TOF ≠ real trajectories: the translunar half-ellipse estimate lands ~5 days vs. Apollo's actual ~3-day free-return trajectory — the model doesn't know about faster non-Hohmann transfers, and overrides are the intended escape hatch for any mission that needs an accurate date.
16b. All burns (BURN and MANEUVER) are treated as impulsive/instantaneous in the clock — only the COAST/transfer between them accumulates time. A long low-thrust burn would in reality itself take meaningful time; not modeled.
16c. Interplanetary TOF ignores launch-window phasing (planets aren't actually where a Hohmann departure needs them) unless the mission has a specific porkchop-selected Lambert window (`PROG_ACTIVE_PROGRAM.launchWindow`) — absent that, the number is a generic Hohmann estimate, not a real date.
16d. `durationOverride`/`dvOverride` intentionally bypass the physics by design — they exist so the user can substitute a known real value (e.g. actual Apollo TOF/ΔV) for the model's estimate. The UI badges overridden events "(custom)" so this is never silently confused with the computed value, but nothing prevents an override that's physically inconsistent with the vehicle's actual propellant/ΔV budget beyond the normal margin checks.
16e. Transit-corridor convention: a coast is charged once, on the leg EXITING the corridor node (TLC→LLO carries the ~5 d translunar TOF; LEO→TLC is the impulsive injection, 0 s). Found the hard way: the first implementation charged both legs and doubled every corridor transit.

**Trade studies**
17. Inclination/altitude sweeps use the minimal circular-orbit ΔV replica (clearly labeled) — fine for trends, not for elliptical or escape comparisons.
18. Tornado is one-at-a-time and symmetric: no parameter interactions, no asymmetric sensitivities (e.g. Isp loss usually hurts more than gain helps near margin limits).

**Structural**
19. `calculate()` (frozen) and `destOnOrbitDV` are twin implementations held together only by regression goldens — an intentional physics change requires editing both plus re-capturing goldens, a three-way sync that must never be done casually. If you're editing 160 or 145, stop and re-read §9 first.
20. Bodies are point masses: no J2 (SSO inclinations are entered as data, not computed), no atmosphere beyond the fitted losses, no third-body effects (EML points and NRHO/DRO are cataloged as pseudo-orbits with hand-set radii).
