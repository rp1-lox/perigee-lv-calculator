# Perigee LV Calculator ("Rocket Playground")

A single-file, dependency-free web app for launch-vehicle performance, orbit
targeting, trade studies, and mission planning with a 3D solar-system view.
The deployable artifact is `lv_calc.html`; it is generated, never edited by hand.

## Layout

- `src/index.html` — page markup with `/* @@BUILD:CSS@@ */` and `/* @@BUILD:JS@@ */` markers
- `src/css/styles.css` — all styles
- `src/js/NNN-name.js` — modules, concatenated in filename order into one `<script>`;
  every top-level function and const is a global, so load order matters
- `tests/suites/*.js` — regression suites run in a Node `vm` sandbox (`tests/harness.js`
  lists which modules are loaded); `tests/*_harness.js` are offline provenance scripts
  for pinned reference orbits and are not part of the gate
- `docs/MATH.md` — every physics calculation, its assumptions and known weaknesses;
  `docs/MISSION_MODEL_V2.md` — mission-model architecture spec

## Build and test

```
python build.py            # -> lv_calc.html, then node --check and the test gate
python build.py --debug    # -> lv_calc.debug.html, includes *.debug.js dev tooling
node tests/run.js          # tests only (--serial, --suite <file>)
```

Node must be on PATH for the syntax check and tests; without it the build still
writes `lv_calc.html` with a warning.
