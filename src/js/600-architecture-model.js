
// ─── ARCHITECTURE DATA MODEL (A1) ────────────────────────────────────────────
// MISSION_MODEL_V2.md §26 — the mission-planning stage that comes BEFORE
// events: a program-level orbit ladder (nodes) + transfer edges, feeding a dV
// budget the Mission page later executes against. A1 scope is JUST the data
// model + its own tiny undo stack + persistence round-trip; the ladder rail
// and node-map mount are A2/A3.
//
// KSP invariant: this module never touches _missions/PROG_ACTIVE_PROGRAM
// beyond the new `.architecture` field, and nothing else reads that field
// yet — a program with no architecture behaves exactly as before.
//
// PERSISTENCE: architecture is PROGRAM-level state. buildProgramObject (450)
// already serializes the whole PROG_ACTIVE_PROGRAM object verbatim as
// `activeProgram`, and applyProgramObject restores it the same way — so
// `.architecture` rides along for free with no dedicated save/load code.
// Legacy blobs simply lack the field; archGet() below creates it lazily
// in memory ONLY (it never mutates a program object that hasn't asked for
// one), so opening an old .program file does not spuriously add an empty
// architecture to it.

/** Returns PROG_ACTIVE_PROGRAM.architecture, creating an empty
 *  {nodes:[], edges:[]} lazily on first access. Never returns null/undefined. */
function archGet() {
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

/** Add a transfer edge between two existing nodes. chain decomposition
 *  (depart/mcc/insert legs) is A3 scope — A1 just carries an empty chain.
 *  Returns the new edge, or null if either endpoint doesn't exist. */
function archAddEdge(fromId, toId) {
  const arch = archGet();
  if (!arch.nodes.some(n => n.id === fromId) || !arch.nodes.some(n => n.id === toId)) return null;
  const edge = { id: progUUID(), fromId, toId, chain: [] };
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
 *  .program/session file) so undo history from the previous program can't
 *  leak into the freshly-loaded one. */
function archUndoReset() {
  _archUndoStack = [];
  _archRedoStack = [];
}
