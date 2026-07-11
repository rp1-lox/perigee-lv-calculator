
// ─── DEBUG-ONLY MAIN-WORLD EVAL BRIDGE ────────────────────────────────────
// (991-eval-bridge.debug.js — included ONLY in lv_calc.debug.html via
// `python build.py --debug`; the user build never contains this file.)
//
// Purpose: browser-automation tooling that runs in an ISOLATED execution
// world (extension content scripts, some in-app browsers — e.g. Codex's
// automation) cannot see page globals like devSeedApolloMission/profReport.
// Isolated worlds DO share the DOM event system, so this bridge evals code
// in the MAIN world on request via window.postMessage.
//
// Usage from an isolated world:
//   window.postMessage({ __lvEval: '<any unique id>', code: 'profReport(0)' }, '*');
//   window.addEventListener('message', e => {
//     if (e.data && e.data.__lvEvalResult) console.log(e.data); // {id, ok, value|error}
//   });
// `value` is JSON.stringify'd (undefined → null). Promises are awaited.
// The result is ALSO mirrored to document.documentElement.dataset.lvEvalLast
// (same JSON) for tooling that can read the DOM but not receive messages.
window.addEventListener('message', function (e) {
  const d = e && e.data;
  if (!d || !d.__lvEval || typeof d.code !== 'string') return;
  const id = d.__lvEval;
  const reply = (ok, payload) => {
    const msg = ok ? { __lvEvalResult: id, ok: true, value: payload }
                   : { __lvEvalResult: id, ok: false, error: payload };
    try { window.postMessage(msg, '*'); } catch (err) { /* ignore */ }
    try { document.documentElement.dataset.lvEvalLast = JSON.stringify(msg); } catch (err) { /* ignore */ }
  };
  let out;
  try { out = (0, eval)(d.code); } // indirect eval → global scope
  catch (err) { reply(false, String(err && err.message || err)); return; }
  Promise.resolve(out).then(
    v => { let s = null; try { s = JSON.stringify(v === undefined ? null : v); } catch (err) { s = '"<unserializable>"'; } reply(true, s); },
    err => reply(false, String(err && err.message || err))
  );
});
console.log('[lv debug] main-world eval bridge active (postMessage {__lvEval, code})');
