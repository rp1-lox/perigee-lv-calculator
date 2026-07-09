# -*- coding: utf-8 -*-
# Stitch src/ modules back into the single deployable lv_calc.html.
#
#   python build.py            -> lv_calc.html        (user build; *.debug.js EXCLUDED)
#   python build.py --debug    -> lv_calc.debug.html  (dev build; *.debug.js included)
#
# Edit the small files under src/ (one section each), then run this to produce
# the single self-contained HTML to paste into Squarespace. Lossless: the JS
# modules are concatenated in filename order into one <script>, the CSS into one
# <style>. Run after every source edit.
#
# The "compiler flag": any module named NNN-name.debug.js (e.g. the function
# profiler, 990-profiler.debug.js) exists ONLY in the debug artifact — the user
# build never contains a byte of it. Debug builds write to a SEPARATE file so
# the deployable lv_calc.html can never accidentally ship instrumented.
import io, os, glob, shutil, subprocess, sys, tempfile

DEBUG = '--debug' in sys.argv

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(ROOT, 'src')
OUT  = os.path.join(ROOT, 'lv_calc.debug.html' if DEBUG else 'lv_calc.html')
TESTS = os.path.join(ROOT, 'tests')

index = io.open(os.path.join(SRC, 'index.html'), encoding='utf-8').read()
css   = io.open(os.path.join(SRC, 'css', 'styles.css'), encoding='utf-8').read()

js_files = sorted(glob.glob(os.path.join(SRC, 'js', '*.js')))
if not DEBUG:
    js_files = [f for f in js_files if not f.endswith('.debug.js')]
js = ''.join(io.open(f, encoding='utf-8').read() for f in js_files)

out = index.replace('/* @@BUILD:CSS@@ */', css).replace('/* @@BUILD:JS@@ */', js)

if out.count('�'):
    raise SystemExit(f'ABORT: {out.count(chr(0xFFFD))} replacement char(s) in output — a source file is corrupted.')

io.open(OUT, 'w', encoding='utf-8', newline='').write(out)
print(f'[build] {len(js_files)} js modules + css -> {os.path.basename(OUT)} ({len(out):,} chars, {len(out.splitlines()):,} lines)' + (' [DEBUG BUILD]' if DEBUG else ''))

# ── Node-based checks: JS syntax check + pure-math regression tests ────────
# Skipped gracefully (with a warning) if `node` isn't on PATH. If node IS
# available, both must pass or the build aborts nonzero.
node = shutil.which('node')
if not node:
    print('[build] WARNING: node not found on PATH — skipping JS syntax check and math regression tests.')
else:
    print(f'[build] node found: {node}')

    # (a) syntax check the concatenated JS via `node --check`
    with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False, encoding='utf-8') as tf:
        tf.write(js)
        tmp_js_path = tf.name
    try:
        result = subprocess.run([node, '--check', tmp_js_path], capture_output=True, text=True)
        if result.returncode != 0:
            sys.stderr.write(result.stderr)
            raise SystemExit('[build] ABORT: JS syntax check failed (node --check) on concatenated src/js/*.js.')
        print('[build] JS syntax check passed (node --check).')
    finally:
        try:
            os.remove(tmp_js_path)
        except OSError:
            pass

    # (b) run the pure-math regression tests
    math_test = os.path.join(TESTS, 'math.test.js')
    if not os.path.isfile(math_test):
        print('[build] WARNING: tests/math.test.js not found — skipping math regression tests.')
    else:
        result = subprocess.run([node, math_test], capture_output=True, text=True, cwd=ROOT)
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        if result.returncode != 0:
            raise SystemExit('[build] ABORT: math regression tests failed (tests/math.test.js).')
        print('[build] math regression tests passed.')
