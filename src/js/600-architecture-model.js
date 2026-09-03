
// ─── ARCHITECTURE DATA MODEL ─────────────────────────────────────────────────
// A program-level orbit ladder (nodes) + transfer edges feeding a ΔV budget,
// stored at PROG_ACTIVE_PROGRAM.architecture. Pure CRUD plus a small undo
// stack. Persistence rides along with the program object (450/455); archGet()
// creates the field lazily so old programs are not modified on load.

/** Returns PROG_ACTIVE_PROGRAM.architecture, creating an empty
 *  {nodes:[], edges:[]} lazily on first access. Never returns null/undefined. */
function archGet() {
  // New call sites in 570-mission-band.js/570-mission-events.js
  // read archGet() from render paths that can fire during missionInit(),
  // BEFORE 590-init.js's startup IIFE assigns PROG_ACTIVE_PROGRAM — return a
  // transient empty shape instead of throwing (never persisted; the real
  // program's architecture is created lazily on the first real archGet()
  // call once PROG_ACTIVE_PROGRAM exists).
  if (!PROG_ACTIVE_PROGRAM) return { nodes: [], edges: [] };
  if (!PROG_ACTIVE_PROGRAM.architecture) {
    PROG_ACTIVE_PROGRAM.architecture = { nodes: [], edges: [] };
  }
  return PROG_ACTIVE_PROGRAM.architecture;
}

/** Add a ladder node. spec: {name, body, orbit, orbitRefId?}. `orbit` is
 *  normalized through orbitNormalize (384) — a v1 architecture only accepts
 *  orbits with a Keplerian element form; propagated/surface orbits
 *  (orbitNormalize -> null) are rejected. Returns the new node, or null if
 *  the orbit didn't validate. */
function archAddNode(spec) {
  if (!spec) return null;
  const orbit = orbitNormalize(spec.orbit);
  if (!orbit) return null; // v1: no propagated/surface nodes — document via this guard
  const node = {
    id: progUUID(),
    name: spec.name || 'Orbit',
    body: spec.body || orbit.body || 'Earth',
    orbit,
  };
  if (spec.orbitRefId) node.orbitRefId = spec.orbitRefId;
  archUndoCapture();
  archGet().nodes.push(node);
  return node;
}

/** Remove a node by id. Also drops any edge touching it (an edge can't
 *  reference a node that no longer exists). Returns true if a node was
 *  removed. */
function archRemoveNode(id) {
  const arch = archGet();
  const idx = arch.nodes.findIndex(n => n.id === id);
  if (idx === -1) return false;
  archUndoCapture();
  arch.nodes.splice(idx, 1);
  arch.edges = arch.edges.filter(e => e.fromId !== id && e.toId !== id);
  return true;
}

/** Add a transfer edge between two existing nodes.
 *  Returns the new edge, or null if either endpoint doesn't exist. */
function archAddEdge(fromId, toId) {
  const arch = archGet();
  if (!arch.nodes.some(n => n.id === fromId) || !arch.nodes.some(n => n.id === toId)) return null;
  const edge = { id: progUUID(), fromId, toId };
  archUndoCapture();
  arch.edges.push(edge);
  return edge;
}

/** Remove an edge by id. Returns true if an edge was removed. */
function archRemoveEdge(id) {
  const arch = archGet();
  const idx = arch.edges.findIndex(e => e.id === id);
  if (idx === -1) return false;
  archUndoCapture();
  arch.edges.splice(idx, 1);
  return true;
}

// ─── A2 additions: update + reorder ────────────────────────────────────────

/** Patch an existing node's name/body/orbit/orbitRefId. `patch.orbit` (if
 *  present) is re-validated through orbitNormalize exactly like archAddNode
 *  — an invalid orbit patch is rejected wholesale (no partial mutation) and
 *  returns null. `patch.orbitRefId` may be set to a string to bind, or
 *  explicit null to clear (fork-on-edit) — omit the key to leave it
 *  untouched. Returns the updated node, or null if the node id doesn't
 *  exist or the orbit patch didn't validate. */
function archUpdateNode(id, patch) {
  if (!patch) return null;
  const arch = archGet();
  const node = arch.nodes.find(n => n.id === id);
  if (!node) return null;
  let orbit = node.orbit;
  if (patch.orbit) {
    orbit = orbitNormalize(patch.orbit);
    if (!orbit) return null; // v1: no propagated/surface nodes — same guard as archAddNode
  }
  archUndoCapture();
  if (patch.name != null) node.name = patch.name;
  if (patch.body != null) node.body = patch.body;
  node.orbit = orbit;
  if ('orbitRefId' in patch) {
    if (patch.orbitRefId) node.orbitRefId = patch.orbitRefId;
    else delete node.orbitRefId;
  }
  return node;
}

/** Clear a node's orbitRefId binding WITHOUT an undo-capture step — the
 *  fork-on-edit convention (mirrors missionLaunchOrbitDetach, 570): hand-
 *  editing a bound orbit field detaches it immediately as the user types,
 *  same as T2's LAUNCH card; the undo-worthy mutation is the Apply that
 *  follows (archUpdateNode above), not the detach flag itself. */
function archNodeDetachRef(id) {
  const arch = archGet();
  const node = arch.nodes.find(n => n.id === id);
  if (!node || !node.orbitRefId) return false;
  delete node.orbitRefId;
  return true;
}

/** Move a node earlier/later in ladder order (dir: -1 up, +1 down). Returns
 *  true if it moved. */
function archMoveNode(id, dir) {
  const arch = archGet();
  const idx = arch.nodes.findIndex(n => n.id === id);
  if (idx === -1) return false;
  const j = idx + dir;
  if (j < 0 || j >= arch.nodes.length) return false;
  archUndoCapture();
  const tmp = arch.nodes[idx]; arch.nodes[idx] = arch.nodes[j]; arch.nodes[j] = tmp;
  return true;
}

// ── Undo (own small stack, scoped to the Architecture page — deliberately
//    NOT the mission undo stream at 575: architecture is program-level, so
//    mixing the two streams would make either "undo" ambiguous). ──────────

const ARCH_UNDO_CAP = 50;
let _archUndoStack = [];
let _archRedoStack = [];

function _archSnapshot() {
  return JSON.stringify(archGet());
}

/** Push the CURRENT architecture state onto the undo stack, before a
 *  mutation is applied. Dedupes an identical back-to-back snapshot (no-op
 *  edits don't grow the stack) and caps the stack at ARCH_UNDO_CAP. Any new
 *  capture clears the redo stack (standard undo/redo branching semantics). */
function archUndoCapture() {
  const snap = _archSnapshot();
  if (_archUndoStack.length && _archUndoStack[_archUndoStack.length - 1] === snap) return;
  _archUndoStack.push(snap);
  if (_archUndoStack.length > ARCH_UNDO_CAP) _archUndoStack.shift();
  _archRedoStack = [];
}

/** Revert to the previous captured state. Returns true if it undid
 *  something, false if the stack was empty. */
function archUndo() {
  if (!_archUndoStack.length) return false;
  const cur = _archSnapshot();
  const prev = _archUndoStack.pop();
  _redoAwarePush(_archRedoStack, cur);
  PROG_ACTIVE_PROGRAM.architecture = JSON.parse(prev);
  return true;
}

/** Re-apply a state undone by archUndo(). Returns true if it redid
 *  something, false if the redo stack was empty. */
function archRedo() {
  if (!_archRedoStack.length) return false;
  const cur = _archSnapshot();
  const next = _archRedoStack.pop();
  _redoAwarePush(_archUndoStack, cur);
  PROG_ACTIVE_PROGRAM.architecture = JSON.parse(next);
  return true;
}

function _redoAwarePush(stack, snap) {
  stack.push(snap);
  if (stack.length > ARCH_UNDO_CAP) stack.shift();
}

/** Reset both stacks — called when switching programs (loading a
 *  program/session file) so undo history from the previous program can't
 *  leak into the freshly-loaded one. */
function archUndoReset() {
  _archUndoStack = [];
  _archRedoStack = [];
}
