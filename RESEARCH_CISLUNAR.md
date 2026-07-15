# Cislunar low-energy trajectory methods — literature review (2026-07-15)

Salvaged from a deep-research run whose search/extraction phases completed but whose
adversarial-verification phase died on a session rate limit (25 claims, 0 refuted, 0
machine-verified). Verification below is therefore TWO-TIER and honest about it:

- **[V]** = verified by the orchestrator directly against the source text on disk
  (both anchor papers were read in full this session).
- **[U]** = plausible, source-cited, but NOT verified — treat as leads, not facts.
  Re-run machine verification via the cached workflow when limits reset.

## The two BLT design schools (both flown/validated)

**A. Forward continuation from a CRTBP periodic orbit** — Griesemer/Ocampo/Cooley,
NTRS 20090016184 (read in full):
- [V] Reference = Markellos family f16/f'16 periodic orbit in the Sun-(Earth+Moon)
  CRTBP; solar perturbation raises perigee 7,200 → 230,434 km between flybys.
  One-parameter family scaled so nearest perigee = parking radius; found via
  perpendicular-crossing differential correction.
- [V] Family choice by Moon quadrant at epoch (Sun-far → f'16); arrival time = the
  Moon's rotating-frame plane crossing nearest ~100 d (p1) / ~180 d (p2).
- [V] Incremental continuation: 1-DOF |dv| in RTBP → 4-param parking-orbit
  orientation targeting the EM-L2 distance → full four-body with inequality
  constraint r_sc-Moon <= r_L2-Moon → SQP minimizing Keplerian energy wrt the Moon,
  constrained to end at perilune. Example: dv 3.0497 km/s, TOF 99.04 d, KEm -0.105.
- [V] 1000 random launch dates (2010-2012): 100% negative KEm at perilune, 96.5%
  complete a lunar orbit, 91.1% also avoid collision. (Stats confirmed in the
  paper's results section.)
- [V] STM-integrated analytical gradients, NOT finite differences — FD is unreliable
  on chaotic arcs (their argument independently matches our N2 experience where
  dt-ladder noise killed FD Newton).

**B. Backwards grid-search from arrival** — ispace M1 (flown 2022), ISSFD2024_18-1
(read in relevant part):
- [V] Fix the arrival LLO plane (periapsis alt, inc, node, true anomaly at LOI);
  mesh over exactly THREE free variables (time-from-landing dt, argument of
  periapsis, arrival C3); propagate each sample BACKWARDS; prune to families that
  depart Earth's vicinity via the EM-L1/L2 region.
- [V] Pruning heuristics: polar LLOs preferred; argument of periapsis near integer
  multiples of 90 deg (minimizes Lidov-Kozai eccentricity drift); trajectories that
  collide or fail to escape via L1/L2 discarded.
- [V] Detailed correction = multiple shooting with velocity discontinuities at patch
  points mapped to DSMs, stepped through increasing force-model fidelity; LOI split
  into three burns (post-burn periods ~8 h / ~4 h / ~1.96 h) to cut gravity losses.
- [V] BLT saves ~100-150 m/s at lunar insertion vs direct; apogee 1-1.5M km.
- [U-FLAGGED] The extracted linear LOI model "dv_LOI = 0.677 + 0.2164*C3 km/s"
  was NOT found in the paper's text layer — possibly an equation image, possibly
  over-synthesis by the extraction agent. DO NOT cite without re-checking the PDF
  figures/equations by eye.

## Correction/optimization practice (the convergence question)
- [V x2 schools] Both flown methods reject naive single-shooting FD Newton on long
  chaotic arcs: Griesemer uses STM gradients + incremental continuation; ispace uses
  multiple shooting + fidelity stepping. Convergent conclusion for us: B1 (STM
  substrate) is the right investment; multiple shooting is the escalation path
  (also what MATH.md critique 62 already concluded independently).
- [U] Purdue/Howell (Scheuerle 2021 MS thesis): multiple shooting preferred because
  long propagation + close primary passages break Newton linearity; BCR4BP is a
  sufficient coherent intermediate model, with initial guesses from periapse
  Poincare maps; theoretical-minimum LOI for a 100 km BLT ~632.8 m/s @ 109.7 d.
- [U] Staged force-model ladder as standard practice: 2-body/patched conic → CRTBP
  → bicircular 4-body → full ephemeris (CMES survey).

## Validation numbers to pin our solver against (bands, not exact — we run a
## mean-element ephemeris, not DE405)
- [V] Griesemer-class LEO BLT: dv_TLI ~3.05 km/s, TOF 87-180 d by capture perigee.
- [U] GRAIL: ~3-month BLT, LOI ~670 m/s vs ~940 direct (~270 m/s saved) (Scheuerle).
- [U] BLT-to-NRHO without flyby: TOF ~101-112 d, total deterministic dv ~17-41 m/s,
  NRHO insertion ~15.8-15.9 m/s (NTRS 20200011549 — CAPSTONE-class; if this holds
  it makes BLT-to-Gateway spectacularly cheap and is THE number to validate for B4).
- [U] JPL DESCANSO monograph: LET to libration orbits 70-120 d, near-zero insertion,
  ~500 m/s saved vs direct L1/L2 insertion; ~70 m/s of deterministic maneuvers
  covers a 21-day launch period from fixed inclination.
- [U] Transfer taxonomy for the tool's modes: direct (2-5 d) / phasing-loop /
  low-energy (85-292 d, 3.2-3.9 km/s total) / low-thrust spiral (CMES survey).

## Recommendations for OUR tool (seconds-scale JS, mean-element ephemeris)
1. **B1 STM substrate stands** — both schools + Purdue agree FD dies on these arcs;
   STM is cheap for us (Jacobian of the exact physAccel sum, E1 opt-in pattern).
2. **B-series should HYBRIDIZE the two schools**: keep the Griesemer forward
   continuation as spec'd (it is the automation-friendly one — 91-96% convergence
   unattended), but ADD ispace-style backwards sanity: propagate the target arrival
   state backwards a few days to seed/refine the terminal leg, and adopt their
   pruning heuristics (escape-via-L1/L2 check) as acceptance tests.
3. **BLT-to-NRHO is the killer app** (claim 25): if insertion is really ~16 m/s,
   the B4 node-map option should price NRHO arrivals via BLT at near-zero insertion
   vs 5a's ~1 km/s — a dramatic, user-visible trade. Verify claim 25 first.
4. **The monthly arrival lattice** (Moon plane-crossings) confirms the 5b R2 lattice
   design generalizes: same selection-layer pattern at two timescales.
5. **Fidelity ladder**: our contextual/full setting already implements the last rung
   pair; a CRTBP scratch mode exists only inside the corrector harness — keep it
   there (design-stage tool), don't ship it as a runtime mode.

## Status / next actions
- Machine verification of the 25 claims: resume the cached workflow
  (wf_4c6e70f2-9bf) after the rate-limit reset — search/fetch replay free.
- Claim 6 (LOI linear formula): re-check the ispace PDF equations by eye.
- Claim 25 (BLT-to-NRHO dv): fetch NTRS 20200011549 and verify before B4 pricing.
