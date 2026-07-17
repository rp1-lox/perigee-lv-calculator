// tests/run.js
//
// Parallel test-gate runner. Replaces the old single-process `node
// tests/math.test.js` invocation: spawns one child process per suite under
// tests/suites/ (up to a worker cap), aggregates pass/fail, and prints output
// in deterministic suite order regardless of completion order.
//
// Usage:
//   node tests/run.js              parallel (default; what build.py calls)
//   node tests/run.js --serial     run all suites in-process, sequentially
//                                   (easier stack traces while debugging)
//   node tests/run.js --suite 04-targeting-corrector.js   run just one suite
//
// ASSERTION-PARITY FLOOR: MIN_ASSERTIONS below is the assertion count as of
// the 2026-07-17 monolith->suite split (961, matched the old math.test.js
// exactly at split time; +5 on 2026-07-18 for the §7al reconstruction-agreement
// pins in suite 05, +2 same date for the site-9 committed-leg guard pair, +20
// same date for the A1 architecture-data-model pins (600-architecture-model.js)
// in suite 10 — 998 total). If a
// suite is silently dropped from the manifest
// (or a suite's require() throws before running any assertions), the
// aggregate count drops below this floor and the gate fails even if every
// suite that DID run reported 0 failures. Bump this value (and the comment
// date) only when you deliberately add assertions — never lower it to make a
// broken manifest pass.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { fork } = require('child_process');

const MIN_ASSERTIONS = 998;

const SUITES_DIR = path.join(__dirname, 'suites');
const WORKER = path.join(__dirname, 'worker.js');

function listSuites() {
  return fs.readdirSync(SUITES_DIR)
    .filter(f => f.endsWith('.js'))
    .sort(); // deterministic order == the manifest order shown in output
}

function runOneInProcess(suiteFile) {
  const t0 = Date.now();
  try {
    const run = require(path.join(SUITES_DIR, suiteFile));
    const r = run();
    return { suite: suiteFile, ok: r.fail === 0, pass: r.pass, fail: r.fail, failures: r.failures, ms: Date.now() - t0 };
  } catch (err) {
    return { suite: suiteFile, ok: false, error: (err && err.stack) || String(err), ms: Date.now() - t0 };
  }
}

function runOneInChildProcess(suiteFile) {
  return new Promise((resolve) => {
    const child = fork(WORKER, [path.join(SUITES_DIR, suiteFile)], { stdio: 'inherit' });
    let result = null;
    child.on('message', (msg) => { result = msg; });
    child.on('exit', (code) => {
      if (!result) {
        resolve({ suite: suiteFile, ok: false, error: `worker exited (code ${code}) with no result message`, ms: 0 });
      } else {
        resolve(result);
      }
    });
  });
}

async function runParallel(suites, maxWorkers) {
  const results = new Array(suites.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= suites.length) return;
      results[i] = await runOneInChildProcess(suites[i]);
    }
  }
  const pool = [];
  for (let i = 0; i < Math.min(maxWorkers, suites.length); i++) pool.push(worker());
  await Promise.all(pool);
  return results;
}

function printReport(results) {
  let totalPass = 0, totalFail = 0, hardFail = false;
  for (const r of results) {
    if (r.error) {
      hardFail = true;
      console.error(`FAIL ${r.suite} — suite threw before completing (${r.ms}ms)`);
      console.error(r.error);
      continue;
    }
    totalPass += r.pass;
    totalFail += r.fail;
    const status = r.ok ? 'ok  ' : 'FAIL';
    console.log(`${status} ${r.suite}  ${r.pass} passed, ${r.fail} failed  (${r.ms}ms)`);
    if (!r.ok && r.failures && r.failures.length) {
      r.failures.forEach(f => console.error(`  - ${f}`));
    }
  }
  return { totalPass, totalFail, hardFail };
}

async function main() {
  const args = process.argv.slice(2);
  const serial = args.includes('--serial');
  const suiteIdx = args.indexOf('--suite');
  const oneSuite = suiteIdx !== -1 ? args[suiteIdx + 1] : null;

  let suites = listSuites();
  if (oneSuite) {
    if (!suites.includes(oneSuite)) {
      console.error(`No such suite: ${oneSuite}\nAvailable: ${suites.join(', ')}`);
      process.exit(2);
    }
    suites = [oneSuite];
  }

  const t0 = Date.now();
  let results;
  if (serial || oneSuite) {
    results = suites.map(runOneInProcess);
  } else {
    const maxWorkers = Math.max(1, Math.min(suites.length, os.cpus().length - 1));
    results = await runParallel(suites, maxWorkers);
  }
  const wallMs = Date.now() - t0;

  const { totalPass, totalFail, hardFail } = printReport(results);
  const total = totalPass + totalFail;

  console.log(`\n${totalPass} passed, ${totalFail} failed (${total} total assertions) [${wallMs}ms wall]`);

  if (hardFail) {
    console.error('\nOne or more suites threw before completing — treat as a gate failure.');
    process.exit(1);
  }
  if (totalFail > 0) {
    process.exit(1);
  }
  // Only enforce the floor for full-manifest runs — a single --suite run is
  // legitimately a fraction of the total.
  if (!oneSuite && total < MIN_ASSERTIONS) {
    console.error(`\nASSERTION-PARITY GUARD TRIPPED: only ${total} assertions ran, expected >= ${MIN_ASSERTIONS}.`);
    console.error('A suite was likely dropped from the manifest, or a suite silently ran fewer assertions than before. Investigate before shipping.');
    process.exit(1);
  }
  process.exit(0);
}

main();
