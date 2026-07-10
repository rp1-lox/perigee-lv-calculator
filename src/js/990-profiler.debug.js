
// ─── DEV PROFILER (DEBUG BUILDS ONLY — *.debug.js is stripped from lv_calc.html) ──
//
// Build with `python build.py --debug` -> lv_calc.debug.html. The user build
// never contains this file, so nothing outside it may reference these names
// without a typeof guard.
//
// What it does: wraps a curated list of hot/global functions with a timing
// shim that accumulates {calls, total ms, max ms} per function, then prints a
// sorted table on demand. Numbered 990 so it loads AFTER every module it
// instruments.
//
// Console API:
//   profReport(minMs?)  — print the aggregate table (default: >=0.05ms total)
//   profReset()         — zero the counters AND the per-call log
//   profWrap('fnName')  — instrument one more global function by name at runtime
//   profDownloadCsv()   — download the PER-CALL log as CSV (function,start_ms,dur_ms)
//                         for offline analysis; also on the floating ⏱ button.
//
// Per-call log: EVERY instrumented call appends {name, start, dur}. Capped at
// PROF_LOG_CAP rows (a day-long LEO propagation makes ~500k physBodyStateAt
// calls — without a cap the tab dies); when full, new rows are dropped and the
// CSV notes the truncation. Timestamps are performance.now() ms since load.

const PROF_TABLE = {};
const PROF_WRAPPED = new Set();
const PROF_LOG = [];
const PROF_LOG_CAP = 500000;
let PROF_LOG_DROPPED = 0;

function profWrap(name) {
  const g = (typeof window !== 'undefined') ? window : globalThis;
  const fn = g[name];
  if (typeof fn !== 'function' || PROF_WRAPPED.has(name)) return false;
  PROF_WRAPPED.add(name);
  PROF_TABLE[name] = { calls: 0, totalMs: 0, maxMs: 0 };
  g[name] = function (...args) {
    const t0 = performance.now();
    try { return fn.apply(this, args); }
    finally {
      const dt = performance.now() - t0;
      const rec = PROF_TABLE[name];
      rec.calls++; rec.totalMs += dt; if (dt > rec.maxMs) rec.maxMs = dt;
      if (PROF_LOG.length < PROF_LOG_CAP) PROF_LOG.push({ n: name, t: t0, d: dt });
      else PROF_LOG_DROPPED++;
    }
  };
  return true;
}

function profReset() {
  Object.values(PROF_TABLE).forEach(r => { r.calls = 0; r.totalMs = 0; r.maxMs = 0; });
  PROF_LOG.length = 0;
  PROF_LOG_DROPPED = 0;
}

function profDownloadCsv() {
  let csv = 'function,start_ms,dur_ms\n';
  for (const row of PROF_LOG) csv += `${row.n},${row.t.toFixed(3)},${row.d.toFixed(4)}\n`;
  if (PROF_LOG_DROPPED > 0) csv += `# TRUNCATED: ${PROF_LOG_DROPPED} calls dropped after cap of ${PROF_LOG_CAP}\n`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lv_calc_profile_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  console.log(`[profiler] CSV downloaded: ${PROF_LOG.length} rows${PROF_LOG_DROPPED ? ` (${PROF_LOG_DROPPED} dropped)` : ''}`);
}

function profReport(minMs) {
  const floor = minMs != null ? minMs : 0.05;
  const rows = Object.entries(PROF_TABLE)
    .filter(([, r]) => r.calls > 0 && r.totalMs >= floor)
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .map(([name, r]) => ({
      fn: name, calls: r.calls,
      'total ms': +r.totalMs.toFixed(2),
      'avg ms': +(r.totalMs / r.calls).toFixed(4),
      'max ms': +r.maxMs.toFixed(3),
    }));
  console.table(rows);
  return rows;
}

// Instrument the interesting surface at load time. Curated rather than "every
// function in the program" — wrapping cheap leaf math (physAdd, physMag, ...)
// would distort the numbers with shim overhead many times the work measured;
// instrument the coarse units users feel, plus the physics workhorses.
(() => {
  const NAMES = [
    // physics core / integrator
    'physKeplerPropagate', 'physElementsToState', 'physStateToElements',
    'physAccel', 'physLeapfrogStep', 'physPropagateSegment', 'physFindEventTime',
    'physPatchState', 'physFrameOf', 'physBodyStateAt',
    // mission engine
    'missionRecompute', 'missionRenderDetail', 'missionRunChecks',
    // trajectory view render path
    '_trajWorldSVG', '_trajBodyFrameContent', '_trajResolveLabels',
    '_trajApplyCam', '_trajExtractMission',
    // calculators
    'lvPerformance', 'lvMaxPayload', 'destOnOrbitDV',
    // porkchop
    'progLambert2D', 'progPorkchopGrid',
  ];
  const wrapAll = () => NAMES.forEach(profWrap);
  wrapAll(); // most are defined by now (990 loads last)
  if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
      wrapAll(); // catch stragglers
      // Floating CSV-download chip (debug builds only — this whole file is
      // stripped from the user artifact, so no theming rules apply; keep it
      // deliberately ugly so nobody mistakes a debug build for a release).
      const b = document.createElement('button');
      b.textContent = '⏱ PROF CSV';
      b.title = 'Download per-call profiler log as CSV (profDownloadCsv)';
      b.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:99999;background:#803;color:#fff;'
        + 'border:1px solid #f6a;padding:4px 10px;font:11px monospace;cursor:pointer;opacity:.85;';
      b.onclick = profDownloadCsv;
      document.body.appendChild(b);
    });
  }
  console.log('[profiler] debug build — profReport() / profReset() / profWrap(name) / profDownloadCsv() available;',
    PROF_WRAPPED.size, 'functions instrumented');
})();
