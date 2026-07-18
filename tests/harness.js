// tests/harness.js
//
// Shared vm-sandbox loader + assertion helpers for the per-domain suites under
// tests/suites/. Extracted from the former monolithic tests/math.test.js so
// each suite (and each parallel worker process) can build its own fresh
// sandbox without re-deriving the loader logic.
//
// Loads the source modules as TEXT (src/ stays untouched) and evaluates them
// in a Node `vm` context with a stubbed `document`, so top-level DOM-touching
// statements in those files don't throw.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// Modules loaded (pure-math functions only; DOM-dependent functions such as
// boosterModeFromDOM/collectVehicle/gv exist in the context but are NOT tested).
// Keep in sync with the list that used to live at the top of math.test.js.
const FILES = [
  'src/js/010-constants.js',
  'src/js/140-physics.js',
  'src/js/145-dest-dv.js',
  'src/js/150-stage-and-a-half.js',
  'src/js/165-trade-study.js',
  'src/js/360-program-module-phase-1-delta-v-engine.js',
  'src/js/384-orbit-canonical.js',
  'src/js/600-architecture-model.js',
  'src/js/385-physics-core.js',
  'src/js/386-physics-integrator.js',
  'src/js/565-physics-mission.js',
  'src/js/565-physics-targeting.js',
  'src/js/565-physics-nrho.js',
  'src/js/566-mission-state-v2.js',
  'src/js/568-lowthrust.js',
  'src/js/440-program-module-phase-9-spacecraft-defini.js',
  'src/js/410-program-module-phase-6-pork-chop-plotter.js',
  'src/js/415-launch-planner.js',
  'src/js/424-blt-reference.js',
  'src/js/565-physics-blt.js',
  'src/js/425-reference-orbits.js',
  'src/js/567-phase-truth.js',   // after 425: uses refOrbitResolve/_refToRot/refOrbitSamplePropagatedRaw
  'src/js/430-program-module-phase-8-node-map.js',
  'src/js/610-architecture-map.js',
  'src/js/570-mission-core-state.js',
  'src/js/570-mission-event-model.js',
  'src/js/570-mission-interaction-state.js',
  'src/js/570-mission-lifecycle.js',
  'src/js/570-mission-replay.js',
  'src/js/570-mission-events.js',
  'src/js/570-mission-panel.js',
  'src/js/570-mission-cards.js',
  'src/js/570-mission-band.js',
  'src/js/570-mission-nodemap.js',
  'src/js/570-mission-manager.js',
  'src/js/574-trajectory-view.js',
  'src/js/5740-trajectory-camera.js',
  'src/js/5741-trajectory-scene-extract.js',
  'src/js/5742-trajectory-overlay-lod.js',
  'src/js/5743-trajectory-rings-legs.js',
  'src/js/5744-trajectory-eventnodes.js',
  'src/js/5744-trajectory-globe.js',
  'src/js/5745-maneuver-gizmo.js',
  'src/js/5745-maneuver-gizmo-math.js',
  'src/js/5745-maneuver-gizmo-hover.js',
  'src/js/5745-maneuver-gizmo-drag.js',
  'src/js/450-program-module-phase-10-save-load-closur.js',
];

let cachedSrc = null;
function moduleSource() {
  if (!cachedSrc) {
    cachedSrc = FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  }
  return cachedSrc;
}

// Builds a fresh vm sandbox with all pure-math source modules evaluated into
// it. Each suite (and each worker process) calls this once at the top of its
// run() — sandboxes are NOT shared across suites, so any global mutation a
// suite makes (and cleans up) can't leak into another suite's run.
function buildSandbox() {
  const sandbox = {
    document: {
      getElementById: () => null,
    },
    console,
    // 440 (spacecraft stage defs) calls progUUID() at struct-construction time;
    // the real impl lives in 380 (not otherwise needed by this harness), so a
    // trivial stub is enough for the LT (568) tests that construct a stage def.
    progUUID: () => 'test-uuid',
  };
  vm.createContext(sandbox);
  vm.runInContext(moduleSource(), sandbox, { filename: 'concatenated-math-modules.js' });
  return sandbox;
}

// Tiny assertion harness — identical semantics to the old math.test.js.
function makeAssertions() {
  let pass = 0, fail = 0;
  const failures = [];

  function ok(desc, cond) {
    if (cond) { pass++; }
    else { fail++; failures.push(desc); console.error(`FAIL: ${desc}`); }
  }

  function approx(desc, actual, expected, tol) {
    const d = Math.abs(actual - expected);
    ok(`${desc} (got ${actual}, expected ${expected} ± ${tol})`, d <= tol);
  }

  return { ok, approx, counts: () => ({ pass, fail, failures }) };
}

module.exports = { buildSandbox, makeAssertions, FILES, ROOT };
