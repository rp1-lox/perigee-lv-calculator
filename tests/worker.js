// tests/worker.js
//
// Child-process entry point spawned by tests/run.js. Takes one suite file
// path on argv[2], requires it, runs it, and reports the result back to the
// parent via IPC (process.send). Kept separate from run.js so run.js's own
// module-load cost isn't duplicated N times.
'use strict';
const path = require('path');

const suitePath = process.argv[2];
if (!suitePath) {
  console.error('worker.js: missing suite path argument');
  process.exit(2);
}

const t0 = Date.now();
let result;
try {
  const run = require(path.resolve(suitePath));
  result = run();
} catch (err) {
  process.send({
    suite: path.basename(suitePath),
    ok: false,
    error: (err && err.stack) || String(err),
    ms: Date.now() - t0,
  });
  process.exit(1);
}

process.send({
  suite: path.basename(suitePath),
  ok: result.fail === 0,
  pass: result.pass,
  fail: result.fail,
  failures: result.failures,
  ms: Date.now() - t0,
});
process.exit(result.fail === 0 ? 0 : 1);
