
function missionBandSpacing(id, dir) {
  _missionBandSpacing = Math.max(45, Math.min(260, _missionBandSpacing + dir * 20));
  missionRenderDetail();
}
function missionBandZoom(id, dir) {
  if (dir === 0) { _missionBandZoom = 1; }
  else _missionBandZoom = Math.max(0.5, Math.min(3, +(_missionBandZoom + dir * 0.25).toFixed(2)));
  missionRenderDetail();
}
// Scroll-wheel zoom for the band view, anchored on the cursor. Resizes the SVG
// in place (no re-render) so scroll position is preserved.
function missionBandWheel(e, id) {
  e.preventDefault();
  const sc = e.currentTarget;
  const svg = sc.querySelector('svg');
  if (!svg) return;
  const prev = _missionBandZoom;
  const dir = e.deltaY < 0 ? 1 : -1;
  _missionBandZoom = Math.max(0.5, Math.min(3, +(prev + dir * 0.15).toFixed(3)));
  if (_missionBandZoom === prev) return;
  const ratio = _missionBandZoom / prev;
  const rect = sc.getBoundingClientRect();
  const ax = e.clientX - rect.left, ay = e.clientY - rect.top;     // cursor anchor in viewport
  const wx = sc.scrollLeft + ax, wy = sc.scrollTop + ay;           // anchor in content
  const w = parseFloat(svg.getAttribute('width')) || svg.clientWidth;
  const h = parseFloat(svg.getAttribute('height')) || svg.clientHeight;
  svg.setAttribute('width', Math.round(w * ratio));
  svg.setAttribute('height', Math.round(h * ratio));
  sc.scrollLeft = wx * ratio - ax;
  sc.scrollTop  = wy * ratio - ay;
  // keep the zoom %-readout in the legend in sync without a full re-render
  const pct = sc.parentElement && sc.parentElement.querySelector('button[onclick*="missionBandZoom(\'' + id + '\',0)"]');
  if (pct) pct.textContent = Math.round(_missionBandZoom * 100) + '%';
}
function missionToggleSameTime(id, idx) {
  const m = _missionGet(id);
  if (!m || !m.log[idx] || idx < 1) return;
  m.log[idx].sameTimeAsPrev = !m.log[idx].sameTimeAsPrev;
  missionRenderDetail();
}
function missionToggleMidCoast(id, idx) {
  const m = _missionGet(id);
  if (!m || !m.log[idx] || idx < 1) return;
  m.log[idx].midCoast = !m.log[idx].midCoast;
  if (m.log[idx].midCoast) m.log[idx].sameTimeAsPrev = false;   // mutually exclusive placement
  missionRenderDetail();
}

// ── Event groups (repeatable blocks, e.g. a refuelling or crew-rotation cycle) ──
let _missionGroupMode = false;     // true while picking a range to group
let _missionGroupStart = null;     // first picked event index

function missionToggleGroupMode(id) {
  _missionGroupMode = !_missionGroupMode;
  _missionGroupStart = null;
  missionRenderDetail();
}
function missionGroupPick(id, i) {
  const m = _missionGet(id); if (!m) return;
  if (_missionGroupStart == null) { _missionGroupStart = i; missionRenderDetail(); return; }
  let a = _missionGroupStart, b = i; if (b < a) { const t = a; a = b; b = t; }
  _missionGroupStart = null; _missionGroupMode = false;
  // reject if any event in range is already grouped
  for (let k = a; k <= b; k++) { if (m.log[k].groupId) { missionRenderDetail(); return; } }
  missionOpenGroupModal(id, a, b, '');
}
// Inline event-loop (repetition) authoring: replaces the old
// modal-mission-group pop-up. `_missionGroupPending` holds the in-progress
// form state and is rendered inline in the events dock (_missionGroupFormHTML,
// 570-mission-band.js) in place of the normal Add Event dock while active.
// Kept the function name `missionOpenGroupModal` for the two existing call
// sites (range-pick above, and the "click a loop label to edit" handler in
// 570-mission-lifecycle.js) — it no longer opens a modal, just arms the form.
let _missionGroupPending = null;   // { id, start, end, gid } | null
function missionOpenGroupModal(id, start, end, gid) {
  const m = _missionGet(id); if (!m) return;
  _missionGroupPending = { id, start, end, gid: gid || '' };
  missionRenderDetail();
  setTimeout(() => { const el = document.getElementById('mgroup-name'); if (el) { el.focus(); el.select(); } }, 30);
}
function missionGroupCancel() {
  _missionGroupPending = null;
  missionRenderDetail();
}
function missionGroupSave() {
  if (!_missionGroupPending) return;
  const { id, start, end } = _missionGroupPending;
  let gid = _missionGroupPending.gid || '';
  const m = _missionGet(id); if (!m) return;
  const name = (document.getElementById('mgroup-name')?.value || 'Loop').trim().slice(0, 40);
  const repeat = Math.max(1, Math.min(99, parseInt(document.getElementById('mgroup-rep')?.value, 10) || 1));
  m.groups = m.groups || {};
  if (!gid) {
    gid = 'g' + progUUID().slice(0, 8);
    for (let k = start; k <= end; k++) m.log[k].groupId = gid;
  }
  m.groups[gid] = { name, repeat };
  _missionGroupPending = null;
  missionRecompute(m);
  missionRenderDetail();
}
function missionGroupRepeat(id, gid, delta) {
  const m = _missionGet(id); if (!m || !m.groups || !m.groups[gid]) return;
  m.groups[gid].repeat = Math.max(1, Math.min(99, (m.groups[gid].repeat || 1) + delta));
  missionRecompute(m);
  missionRenderDetail();
}
function missionUngroup(id, gid) {
  const m = _missionGet(id); if (!m) return;
  m.log.forEach(e => { if (e.groupId === gid) delete e.groupId; });
  if (m.groups) delete m.groups[gid];
  missionRecompute(m);
  missionRenderDetail();
}
let _missionAddEvt = null;   // null = closed; '__menu__' = picker; or a type          // scrubbed event index for the band view (null = last event)
let _missionSelEvt = null;   // selected event index for event detail panel
// Unify-create/edit: a pending event is a DRAFT log entry, pushed onto
// the END of m.log (flagged `pending:true`) so it renders through the exact same
// card/edit-fields renderers a committed event uses — Commit clears the flag +
// applies via the normal missionApply*Edit path; Cancel splices it back out with
// NO recompute. Tracked here
// so exactly one can exist at a time and it can be discarded on mission switch.
let _missionPendingEvent = null;   // { missionId, idx } | null
// Maneuver add-form draft: the composite step program being built (BURN / SEPARATE steps).
// [] = a single full burn from the default stage. Reset whenever the maneuver form opens.
let _missionAddMv = { from: null, to: null, steps: [] };
// Prop-transfer add-form: origin key of the chosen DESTINATION vehicle (null = the active
// vehicle, i.e. an intra-vehicle transfer). Lets you fill a separately-deployed depot.
let _missionXferDest = null;

// Collapse every event card except the last one (used after adding an event so the
// newest is shown expanded). Cards use `_expanded` (default falsy = collapsed/compact).
function _missionExpandLast(m) {
  if (!m || !m.log) return;
  m.log.forEach(e => { e._expanded = false; });
  if (m.log.length) m.log[m.log.length - 1]._expanded = true;
}
let _missionBridgeMode = false;        // true while user is drawing a maneuver bridge
let _missionBridgeFrom = null;         // node id chosen as the bridge start
let _missionNmPos = {};                // nodeId -> [x,y] drag overrides
let _missionNmDrag = null;             // { missionId, nid } while dragging
   // orbit catalog dock open by default (below the view)
let _missionNmZoom = 1.0;              // node-map zoom (px width = worldW * zoom) — opens zoomed in on Earth
let _missionNmPan = null;              // active background-pan drag state
let _missionNmJustPanned = false;      // suppress the click that ends a pan-drag
const _MISSION_NM_ZMIN = 0.3, _MISSION_NM_ZMAX = 2.0;

function missionNmZoom(id, dir) {
  if (dir === 0) _missionNmZoom = 0.55;
  else _missionNmZoom = Math.max(_MISSION_NM_ZMIN, Math.min(_MISSION_NM_ZMAX, _missionNmZoom + dir * 0.15));
  const m = _missionGet(id);
  const va = document.querySelector('.mcc-view-area');
  if (va && m) va.innerHTML = _missionNodeMapHTML(m);
}

// Scroll-wheel zoom, centred on the cursor. Only resizes the SVG (uniform scale
// via px width) so we don't re-render or lose scroll position.
function missionNmWheel(e, id) {
  e.preventDefault();
  const sc = e.currentTarget;
  const svg = sc.querySelector('svg');
  if (!svg) return;
  const prev = _missionNmZoom;
  const dir = e.deltaY < 0 ? 1 : -1;
  _missionNmZoom = Math.max(_MISSION_NM_ZMIN, Math.min(_MISSION_NM_ZMAX, prev + dir * 0.12));
  if (_missionNmZoom === prev) return;
  const ratio = _missionNmZoom / prev;
  const rect = sc.getBoundingClientRect();
  const ax = e.clientX - rect.left, ay = e.clientY - rect.top;     // anchor in viewport
  const wx = sc.scrollLeft + ax, wy = sc.scrollTop + ay;           // anchor in content
  const worldW = _missionNmLayout().worldW;
  svg.style.width = Math.round(worldW * _missionNmZoom) + 'px';
  sc.scrollLeft = wx * ratio - ax;
  sc.scrollTop  = wy * ratio - ay;
}

// Grab the background and drag to pan (scrolls the container).
function missionNmPanStart(e, id) {
  if (e.button !== 0) return;                 // left button only (right = node move)
  const sc = e.currentTarget;
  _missionNmPan = { sc, x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop, moved: false };
  sc.style.cursor = 'grabbing';
  document.addEventListener('mousemove', missionNmPanMove);
  document.addEventListener('mouseup', missionNmPanEnd);
}
function missionNmPanMove(e) {
  const p = _missionNmPan; if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) p.moved = true;
  p.sc.scrollLeft = p.sl - dx;
  p.sc.scrollTop  = p.st - dy;
}
function missionNmPanEnd() {
  const p = _missionNmPan; if (!p) return;
  p.sc.style.cursor = 'grab';
  _missionNmJustPanned = p.moved;             // swallow the click that follows a real drag
  _missionNmPan = null;
  document.removeEventListener('mousemove', missionNmPanMove);
  document.removeEventListener('mouseup', missionNmPanEnd);
}


