
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
//   profReport(minMs?)  — print the table (default: everything with >=0.05ms total)
//   profReset()         — zero the counters
//   profWrap('fnName')  — instrument one more global function by name at runtime

const PROF_TABLE = {};
const PROF_WRAPPED = new Set();

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
    }
  };
  return true;
}

function profReset() {
  Object.values(PROF_TABLE).forEach(r => { r.calls = 0; r.totalMs = 0; r.maxMs = 0; });
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
    '_trajApplyCam', '_trajExtractMission', '_trajGetPlanetCalibration',
    // calculators
    'lvPerformance', 'lvMaxPayload', 'destOnOrbitDV',
    // porkchop
    'progLambert2D', 'progPorkchopGrid',
  ];
  const wrapAll = () => NAMES.forEach(profWrap);
  wrapAll(); // most are defined by now (990 loads last)
  if (typeof window !== 'undefined') window.addEventListener('load', wrapAll); // catch stragglers
  console.log('[profiler] debug build — profReport() / profReset() / profWrap(name) available;',
    PROF_WRAPPED.size, 'functions instrumented');
})();
