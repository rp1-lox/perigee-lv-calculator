# LV Performance Calculator — Townsend-Schilling Conformance Audit

Read-only audit. Source of truth = Silverbird Astronautics (faithful Townsend-Schilling
2009 implementation). No code changed. Frozen functions (`calculate`/`evalAtPayload` 160,
`lvPerformance`/`lvMaxPayload` 140, `destOnOrbitDV` 145) were read only.

Vehicle under test: builtin Saturn V (S-IC / S-II / S-IVB), KSC lat 28.5°, az 37–112°,
target 185×185 km parking = destination. Golden `@28.5° = 150,838 kg` reproduced exactly
by the offline harness, so the harness faithfully mirrors the shipped math.

---

## HEADLINE FINDING — payload is inclination-insensitive (Vrot bug)

Our max-payload does **not change at all** with target inclination. Harness output
(reproduces the frozen path byte-for-byte):

| Target inc | our onOrbitDV | our Vrot | **our maxPayload** | Silverbird @45° |
|-----------:|--------------:|---------:|-------------------:|-----------------|
| 28.5° | 0.0 | 408.3 | **150,838 kg** | — |
| 35°   | 0.0 | 408.3 | **150,838 kg** | — |
| 45°   | 0.0 | 408.3 | **150,838 kg** | 126,693 (112,110–143,122) |
| 60°   | 0.0 | 408.3 | **150,838 kg** | — |
| 90°   | 0.0 | 408.3 | **150,838 kg** | — |

Two things stay pinned across all inclinations:

1. **`onOrbitDV = 0`** — correct here. Destination == parking orbit (185×185), so
   `destOnOrbitDV`'s `destIsPark` branch returns 0. And because `needsPlane = inc <
   |siteLat|-0.5`, no plane change is charged for `inc ≥ siteLat`. **The earlier
   "over-charges a plane change above site latitude" hypothesis is FALSE** — the gate is
   correct. `destOnOrbitDV` is not the defect.

2. **`Vrot = 408.3 m/s` fixed** — this is the bug. Vrot is the Earth-rotation assist in
   Eq3 (`dVtot = Vcirc + dVpen − Vrot`). Physically it must **fall as target inclination
   rises** (you launch off due-east, so less eastward rotational velocity is usable). Our
   `rotVel` ignores inclination entirely and always returns the full due-east value.

### Exact defective code — `rotVel` (140-physics.js:4-8)

```js
function rotVel(lat,azMin,azMax){
  const Vm=OMEGA_E*RE*1000*Math.cos(lat*Math.PI/180);
  let best=0;[azMin,azMax,90].forEach(az=>{const c=Vm*Math.cos((az-90)*Math.PI/180);if(c>best)best=c;});
  return Math.max(0,Math.min(best,Vm));
}
```

Root causes:
- **No inclination argument.** `rotVel(siteLat,azMin,azMax)` — the callers
  (`lvPerformance` 140:252, `calculate` 160:66) never pass target inclination, so Vrot
  cannot depend on it.
- **`90` is hard-coded into the candidate azimuth list.** The `.forEach([azMin,azMax,90])`
  always includes due-east (az=90 → `cos(0)=1` → full `Vm`) and takes the **max**. So even
  a polar target, or a site whose az-window excludes 90°, still books the full equatorial
  assist. This is why the curve is flat.
- **`Math.max(0, …)`** clamps retrograde to 0 assist; the paper wants a negative Vrot
  (a *penalty*) for retrograde/high-inclination launches. Minor here, real in general.

### Correct physics (paper prescription)

Launch azimuth for a target inclination from a site at latitude φ:
`cos(i) = sin(Az)·cos(φ)`. The usable eastward rotational velocity is the east component
of the pad's inertial velocity, `V_eq·sin(Az)`, with `V_eq = ΩR·cos(φ)`. Substituting:

```
Vrot(i) = Ω·R·cos(φ)·sin(Az) = Ω·R·cos(i)       (for reachable |i| ≥ φ)
```

i.e. Vrot should collapse to `Ω·R·cos(i)` — max (≈465 m/s at the equator) shrinking to 0
at i=90° and negative beyond. At i=φ it equals the current full value (so the 28.5° number
is unaffected — the bug only *fails to reduce* Vrot above φ). For `i < φ` (dogleg /
launch-azimuth-limited) Vrot is capped at the site's reachable azimuth AND a plane-change
is due — that part `destOnOrbitDV` already handles.

Suggested fix (do NOT apply — frozen path): give `rotVel` the target inclination and
return `OMEGA_E*RE*1000*Math.cos(inc*PI/180)` for `inc ≥ siteLat` (allowing negative for
retrograde), threading `inc` from `calculate`/`lvPerformance`/mission callers. Remove the
hard-coded `90` from the candidate list.

### Magnitude — how much of the Silverbird gap this explains

Re-running the harness with the paper's `Vrot(i)=Ω·R·cos(i)`:

| inc | our payload (flat) | payload w/ paper Vrot | Silverbird |
|----:|-------------------:|----------------------:|-----------:|
| 28.5° | 150,838 | 150,838 | — |
| 45°   | 150,838 | **147,440** | **126,693** |
| 90°   | 150,838 | 134,131 | — |

**Important honesty check:** fixing Vrot alone moves 45° from 150,838 → ~147,440 kg — it
recovers only ~3.4 t of the ~24 t (19%) gap to Silverbird's 126,693. So the
inclination-*insensitivity* is a genuine, clear-cut defect (Vrot must vary with i and
does not), but **the paper's Vrot term does not by itself account for the full Silverbird
delta.** The residual ~20 t indicates Silverbird books a substantially larger
inclination/azimuth penalty than the bare Eq3 rotation term (or applies the azimuth
restriction to the ascent penalty as well). That residual is NOT localized to a single
constant in our code and should be flagged as an open modeling-fidelity question, not
claimed as "fixed by the Vrot patch." Do not over-promise that the Vrot fix closes the gap.

---

## Equation-by-equation conformance (modern refinement, Eq3–Eq6)

| Paper | Code (file:line) | Verdict |
|-------|------------------|---------|
| Eq5 `K3 = 429.9 + 1.602·Hp + 1.224e-3·Hp²` | 140:253, 160:68 `K3=429.9+1.602*Hp+1.224e-3*Hp*Hp` | **MATCH** |
| Eq5 `K4 = 2.328 − 9.687e-4·Hp` | 140:253, 160:68 `K4=2.328-9.687e-4*Hp` | **MATCH** |
| Eq5 `dVpen = K3 + K4·Tmix` | 140:332 `DVpen=K3+K4*Tmix` | **MATCH** |
| Eq6 `Tmix = 0.405·Ta + 0.595·T3s` | 140:332 `Tmix=0.405*Ta+0.595*T3s` | **MATCH** |
| Eq4 factor 3, `0.333`, `g·Isp`, `A0` | 140:323 `T3s=3*(1-exp(-0.333*Vcirc/(G0*avgIsp)))*G0*avgIsp/A0` | **DEVIATES** (see D2, D3) |
| Eq4 `A0 = liftoff thrust/mass` | 140:321 `A0=tThr/tMas` (thrust N / mass kg) | **MATCH** — ground-lit boosters in `tThr`+`tMas`, air-lit only in `tMas` (correct) |
| Eq3 `dVtot = Vcirc + dVpen − Vrot` | 140:333 `DVasc=Vcirc+DVpen-Vrot` | **MATCH** (structure); **Vrot term DEVIATES**, see D1 |
| On-orbit maneuver ΔV bookmarked onto ascent | 140:333 `DVtot=DVasc+onOrbitDV`, margin `tDV−DVtot` | **MATCH** |
| `Vcirc = √(μ/(R+H))` | 140:3 `circVel` | **MATCH** (μ=398600.4418, R=6371) |
| `g = 9.80665` | 010:3 `G0` | **MATCH** |
| Original Eq1/Eq2 (V*, 662.1, 1.7871, 1036, 1.5e-3, 8.82e-2) | absent | N/A — code uses only the modern Eq5/Eq6 refinement, which is what Silverbird uses. Correct to omit. |

### Deviations affecting the penalty

**D1 — Vrot (headline above).** `rotVel` ignores target inclination and hard-codes az=90.
Effect: payload flat vs. inclination; over-predicts payload above site latitude. Fix in
§Headline.

**D2 — Eq4 uses `Vcirc` where the paper uses `dVp` (ΔV to parking orbit).**
140:323 feeds `Vcirc` (~7.79 km/s) into the T3s exponent, but Eq4's argument is `dVp`, the
full ascent ΔV to the parking orbit (Vcirc + penalty − rotation ≈ the vehicle's actual
ascent ΔV, ~9.3 km/s for Saturn V). Under-feeding the exponent biases T3s. Correct form:
`T3s = 3·(1−exp(−0.333·dVp/(g·Isp)))·g·Isp/A0` with `dVp = DVasc`. Second-order (inside a
saturating exponential) but a real constant-fidelity deviation vs. the paper.

**D3 — Eq4 `Isp` should be the FIRST-STAGE vacuum Isp; code uses burn-time-weighted
`avgIsp` over all stages.** 140:322 `avgIsp=Σ(isp_i·bt_i)/tBT`. The paper's T3s is a
first-stage gravity-loss surrogate and specifies the first stage's vacuum Isp. For Saturn V
`avgIsp` is pulled well above the S-IC's 304 s by the 425 s upper stages, inflating T3s.
Correct: use `stages[0].isp`. Direction: over-predicts T3s → over-predicts Tmix/penalty
(slightly *reduces* our payload), partially offsetting D1/D2 — which is why the net 28.5°
number still lands on the historical golden. These offsetting errors should not be read as
"correct."

**D4 — retrograde Vrot clamped to 0 (140:7 `Math.max(0,…)`).** Paper: retrograde launches
subtract a rotation penalty. We never penalize. Only bites for `inc > 90°`/retrograde
targets; irrelevant to the Saturn V case but a genuine sign-handling gap.

---

## S1.5 (stage-and-a-half) assessment

`_s15BecoSplit` (140:60) + `stageExpandS15` (140:148) split a booster/sustainer stage into
Ph.1 (boosters+sustainer, blended thrust-weighted-harmonic Isp 140:98) and Ph.2 (sustainer
continues, `dry_ph2 = dry − jet`). Output virtual stages are fed to the **same**
`lvPerformance` penalty path via `calculateWithS15` (150) — so S1.5 vehicles inherit the
D1–D4 penalty behavior identically; no separate/divergent physics. BECO located by
sustainer-TWR-on-stage-mass (`m_after = F_sust/(twr·G0)`), payload-independent
approximation (documented, <5% ΔV). **Blended Isp and continuity are physically sound.**
No S1.5-specific conformance defect beyond the shared penalty deviations.

## Parallel booster assessment

`lvPerformance` (140:270-319) runs an event-driven multi-group integrator: crossfeed
(feeds core, preserves core tanks), throttle (throttles core while group burns), air-lit
(`ignition:{after:i}`/`{atTime:s}`). Ground-lit thrust enters `tThr`→A0 (140:259); all
groups' mass enters `tMas` (140:320); spent groups drop dry mass. Reduces exactly to the
legacy single-group block (per comment, plausible on read). **A0 and ascent-ΔV
contributions are handled correctly.** No booster-specific conformance defect; boosters
feed the same (D1-afflicted) Vrot/penalty path.

## destOnOrbitDV (145) assessment

Pure mirror of calculate()'s on-orbit logic (145 == 160:36-62, verified line-by-line
identical). Hohmann `dv1`/`dv2` via vis-viva `vPeri`/`vApo`; plane change
`2·Vc·sin(Δ/2)` only when `needsPlane` (`inc < |siteLat|−0.5`); combined plane+apogee burn
for high circular orbits (`apogee>10000`); escape via `Vh=√(Vesc²+C3)`. **Impulsive
transfers correct; propellant correctly bookmarked as ascent payload (upstream via
`onOrbitDV`).** Plane-change gate is correct — it does NOT charge a plane change for
`inc ≥ siteLat`. This function is NOT the inclination-insensitivity culprit.

---

## VERDICT

**Partially faithful, with one clear physics defect and two constant-level deviations
from the paper's Eq4.**

- The penalty structure (Eq3, Eq5, Eq6) and constants are implemented **exactly**.
- `destOnOrbitDV`, S1.5, and booster paths are **sound** and route through the shared math.
- **`rotVel` is a genuine bug (D1):** Vrot does not depend on target inclination (no
  inclination arg + hard-coded az=90 + retrograde clamp), producing the observed
  inclination-insensitive payload and over-predicting payload above the site latitude.
- Eq4's T3s uses `Vcirc` instead of `dVp` (D2) and burn-weighted `avgIsp` instead of the
  first-stage Isp (D3) — offsetting errors that happen to preserve the 28.5° golden.

**Caveat for the user:** the Vrot fix removes the *insensitivity* and is the right physics,
but by itself recovers only ~3.4 t of the ~24 t gap to Silverbird at 45°. The remaining
~20 t is not attributable to any single constant in our code and points to Silverbird
applying a larger inclination/azimuth penalty than the bare Eq3 rotation term. Treat that
residual as an open fidelity question, not a solved one.

## Real code discrepancies (distinct from documented method limitations)

| # | Location | Defect | Correct form | Effect |
|---|----------|--------|--------------|--------|
| D1 | 140:4-8 `rotVel` (+callers 140:252, 160:66) | Vrot ignores target inclination; hard-codes az=90; clamps retrograde to 0 | `Vrot = Ω·R·cos(i)` for `i≥φ` (signed for retrograde); thread `inc` through callers | Payload flat vs inc; ~+3.4 t over-predict @45° (paper Vrot); larger at higher i |
| D2 | 140:323 | T3s exponent uses `Vcirc` not `dVp` (ΔV to parking) | `dVp = DVasc` | Small (saturating exp); biases penalty |
| D3 | 140:322-323 | T3s uses burn-weighted `avgIsp` not first-stage Isp | `stages[0].isp` | Over-predicts T3s for dissimilar staging; offsets D1/D2 |
| D4 | 140:7 | retrograde Vrot clamped ≥0 | allow negative (penalty) | Only affects retrograde/`i>90°` |

Documented method limitations (NOT bugs, per paper): sub-minute stage/SRB burns
over-predict; fast-burn surplus-ICBM vehicles over-predict (uncounted drag); ground-launch
ballistic only. These are inherent to Townsend-Schilling and out of scope.

## Black-box comparison against Silverbird itself (2026-07-18, Fable direct investigation)

**Method**: Silverbird's LVperform.html math is server-side (`cgi-bin/LVPcalc.pl`, unreadable; the page JS "LaunchScriptSB7.js" is UI-only — note SB**7**, seven versions past the 2009 paper). But the form accepts USER-DEFINED vehicles, so it was black-box probed via POST with EXACTLY our stage data (same kg/kN/s units, same site 28.5/az 37-112, same 185x185 @ 28.5, explicit residuals, CalMode=Raw). From each returned max payload, Silverbird's implied required dV is recovered exactly by inverting the rocket equation (their availability matches ours to a few m/s — proven on single-stage probes).

**Headline result — Saturn V (our exact stage data, identical inputs):**
| | ours | Silverbird raw | ratio |
|---|---|---|---|
| 3-stage Saturn V, 185x185 @28.5 | 150,838 | **119,002** | +26.8% |
Calibration mode (Raw/Mixed/Guide) makes NO difference for user-defined vehicles — the gap is in the RAW model, not the calibration layer. The user's 126,693 screenshot = Silverbird's own built-in "Saturn V (3 stage w/shroud)" DB entry @45 deg (different stage data than ours, incl. shroud), Mixed calibration.

**Probe matrix (implied ascent penalty, m/s, after removing Vcirc/Vrot):**
single-stage probes agree with our implementation within +-150 m/s (our raw model is FAITHFUL for single-stage; the paper's Eq5 fit reproduces both). Multi-stage diverges progressively:
| config | ours vs SB payload | SB extra penalty vs best paper-variant |
|---|---|---|
| B 2-stage same-Isp | +7.4% | ~135 m/s |
| A 3-stage same-Isp | +13.7% | ~235 m/s |
| C Saturn V 2-stage | +22.3% | ~480 m/s |
| D Saturn V fast-S-IVB | +18.3% | ~390 m/s |
| E Saturn V all-Isp-304 | +38.8% | ~440 m/s |
| Saturn V baseline | +26.8% | ~365-810 m/s (variant-dependent) |
Every candidate variant of the published equations (Ta truncated-at-Vcirc vs full burn; T3s with first-stage vs burn-averaged Isp; dVp iterated vs Vcirc) was least-squares tested against 11 probes: NONE closes the multi-stage gap. Silverbird books extra penalty that grows with upper-stage burn time and worsens for low-T:W uppers (E vs D) — physics (finite-burn/gravity losses on long upper-stage burns) that the 2009 note does not publish.

**Inclination handling (secondary findings, both real deviations in ours):**
- SB @45 deg drops only ~2.6% (Vrot ~ cos(inc)); ours is flat (rotVel ignores inclination entirely — audit D1 confirmed).
- SB @90 deg from az-window 37-112 collapses to 34,161 kg (dogleg charged when azimuth window cannot reach the inclination); ours stays at 150,838 (no charge).

**VERDICT**: our implementation is a faithful-within-noise implementation of the PUBLISHED 2009 method for single-stage vehicles, with two roughly-cancelling input deviations (D2/D3) and a real inclination blind spot (D1/D4). Silverbird's CURRENT model (SB7) contains substantial unpublished multi-stage refinements (~800 m/s extra ascent dV for a Saturn-V-class stack) that no rearrangement of the published equations reproduces. Exact equation parity with Silverbird is impossible without their server source; matching it requires either (a) a fitted multi-stage correction term derived from a systematic probe campaign, or (b) per-vehicle calibration offsets against Silverbird outputs — which is precisely the calibration practice the 2009 paper itself prescribes (its Delta IV example), and what Silverbird's own Mixed/Guide modes do against manufacturer data.
