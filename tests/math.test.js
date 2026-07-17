// tests/math.test.js
//
// COMPATIBILITY FORWARDER (2026-07-17). The monolithic 5,235-line version of
// this file was split into per-domain suites under tests/suites/ + a shared
// vm-sandbox loader (tests/harness.js) + a parallel runner (tests/run.js),
// because the single-process gate had grown to ~100s wall-clock dominated by
// a handful of solver-heavy blocks (differential corrector, NRHO transfer
// shoot, orbit-orientation authoring) that ran one after another instead of
// concurrently. `python build.py` now calls tests/run.js directly.
//
// This forwarder exists for one release because some tooling/docs still
// reference `node tests/math.test.js` by name — it just execs the new
// runner with the same argv, so old invocations keep working unchanged.
// Prefer `node tests/run.js` (or `node tests/run.js --serial` / `--suite
// <name>`) directly; this file may be deleted in a future release once
// nothing references the old name. See docs/dev_notes.md "Test suite
// layout" for how to add a new suite.
'use strict';
require('./run.js');
