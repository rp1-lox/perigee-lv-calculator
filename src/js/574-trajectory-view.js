
// ─── TRAJECTORY VIEW — unified continuous-zoom world (C1b) ───────────────
// Third mission view: a 2D true-geometry orbital map ("2D KSP/SFS-like"),
// restrained blueprint style (thin strokes, mono labels, theme colors — NOT
// cartoon). Mission orbits / transfer arcs come from _trajSceneContent().
//
// ── ARCHITECTURE — ONE WORLD, HELIOCENTRIC KM ─────────────────────────────
// C1b deletes the scene catalog entirely. There is no per-body "scene" any
// more — one render pass draws the WHOLE system every time: the Sun, every
// planet's heliocentric ring + disc/glyph, moons on their rings around their
// parents, and ALL mission content (orbit rings, transfer arcs, burn
// markers, surface events) embedded at its parent body's CURRENT world
// position (progBodyWorldPos). A camera (pan/zoom, anchored to a body) picks
// which slice of that one world is visible — "changing scene" is now just
// "flying the camera," never a different render path.
//
// Two-layer split is preserved (mandatory, per the a0f5614 architecture —
// see the auto-memory note this task was briefed with):
//
//   LAYER 1 — WORLD  (svg.traj-svg): GEOMETRY ONLY, in FLOATING-ORIGIN render
//     coords (see below) — never raw heliocentric km (Neptune ~4.5e9 km
//     would jitter/overflow float precision inside an SVG attribute at LEO
//     zoom). Pure viewBox-camera SVG; nothing in this layer is sized in
//     screen px.
//
//   LAYER 2 — SYMBOLOGY overlay (svg.traj-overlay): sibling SVG, container
//     px 1:1, all labels/plates/markers/hit-circles. Untouched by C1b except
//     that anchors are now floating-origin render coords too (still funneled
//     through the ONE projection function below).
//
// `_trajWorldToScreen(x, y, cam, rect)` is UNCHANGED signature/semantics —
// the mini-diagram (230-orbit-diagram.js) calls it directly with a synthetic
// cam and must keep working untouched. What changed is what "world" MEANS:
// x,y are now floating-origin render units (worldKm - camCenterKm), not
// scene-local km*scale.
//
// ── FLOATING ORIGIN (precision — non-negotiable) ──────────────────────────
// Every render computes camCenterKm = worldPos(cam.anchorBody, viewTime) +
// cam.relOffsetKm, then every emitted point is (worldKm - camCenterKm) — so
// SVG attributes never carry heliocentric-scale numbers. The viewBox itself
// is therefore always centered near (0,0) regardless of where in the solar
// system the camera actually is.
//
// ── ANCHORED CAMERA (the teleport killer) ─────────────────────────────────
// Camera state per mission: { anchorBody, relOffsetKm:{x,y}, wKm }. Effective
// center = worldPos(anchorBody, viewTime) + relOffsetKm. R3.4: drag-pan and
// cursor-anchored zoom are RETIRED (KSP camera semantics — see PHYSICS_PLAN
// R3.4 item 1); relOffsetKm is only ever written as {0,0} now (wheel zoom is
// a pure wKm change, drag always rotates az/el). The field stays on the
// camera struct because the fit/zoom-to-content math still reads it. Changing
// the selected event (which moves viewTime) leaves anchor+offset untouched, so
// the anchored body stays fixed on screen while the rest of the system moves
// around it. Fly-to (trajSetFocus, kept name/signature for the focus-bar
// wiring) sets anchor, zeroes offset, and fits wKm to the body's
// neighborhood.
//
// DELETED as part of C1b (the scene-catalog machinery):
//   _trajSceneList, _trajFocus/_trajFocusByMission (scene-keyed) — replaced
//     by camera anchor state (_trajCamByMission[id].anchorBody)
//   _trajSceneForOrbit's scene-id return value being a "which SVG to build"
//     key — orbits/legs are now just embedded at their body's world pos,
//     every scene renders in the one pass
//   _trajSunSceneSVG / _trajBodySceneSVG / _trajSceneGeomSVG (per-scene
//     builders) — replaced by _trajWorldSVG (one pass, everything)
//   _trajFitScale/_trajMissionExtent's "which scene" framing — replaced by
//     _trajFitCamToAnchor (still fits mission content, now camera-driven)
//   the "scene switch" hint chip semantics — hint chip now means "fly to"
// Kept (still load-bearing, unchanged behavior): the LOD/label registry
// (_trajRegisterLabel/_trajResolveLabels/_trajWorldToScreen), the mission log
// extraction (_trajExtractMission and friends), ellipse/arc geometry helpers,
// pan/wheel gesture plumbing (adapted to mutate relOffsetKm/wKm instead of
// cx/cy/w), the ResizeObserver sync path.

// Module-local, session-only state (NOT authored — never touches m.log or
// autosave; camera resets on reload, same spirit as _missionNmZoom).


// Burn marker — registers a fixed-px triangle glyph + optional dv/MET text at
// a render-space (floating-origin) anchor. Geometry side (world layer) gets
// nothing from this function any more; everything it emits is overlay-side
// markup carried on the label registry entry (`marker`/`hit`), resolved to
// px by _trajResolveLabels.
function _trajBurnMarker(x, y, dir, dvText, metText, opts) {
  opts = opts || {};
  const zoom = opts.zoom || 1;
  const emphasized = !!opts.emphasized;
  const strokeColor = emphasized ? 'var(--accent)' : 'var(--accent2)';
  const strokeW = emphasized ? 1.3 : 0.8;
  const textColor = emphasized ? 'var(--accent)' : 'var(--accent2)';
  // R6.2' Phase A item 1: dblclick the marker to open the maneuver gizmo at
  // its solved state (_trajGizmoOpenExisting, a no-op for non-MANEUVER
  // authIdx entries — MNODE dblclick is wired separately via the event-node
  // pass, R6.1).
  const clickAttr = opts.authIdx != null ? ` style="cursor:pointer" onclick="event.stopPropagation();_trajSelectEventFromView('${opts.missionId}',${opts.authIdx})" ondblclick="event.stopPropagation();if(typeof _trajGizmoOpenExisting==='function')_trajGizmoOpenExisting('${opts.missionId}',${opts.authIdx});"` : '';
  const titleTxt = opts.title || '';
  // Marker dot + hit area (px-sized, always rendered — geometry-adjacent, not
  // an "annotation" subject to LOD).
  const marker = `<circle cx="0" cy="0" r="${emphasized ? 2.4 : 2}" fill="var(--nm-bg)" stroke="${strokeColor}" stroke-width="${strokeW}" pointer-events="none"/>`;
  const hit = opts.authIdx != null ? `<circle cx="0" cy="0" r="8" fill="transparent" style="pointer-events:auto;cursor:pointer"${clickAttr}><title>${titleTxt}</title></circle>` : '';
  const glyph = dir === 'up' ? '▲' : '▼';
  const dvLabel = dvText ? `${glyph} ${dvText}` : glyph;
  const lines = [{ text: dvLabel, dy: -5, fontPx: 10, color: textColor }];
  if (metText) lines.push({ text: metText, dy: 9, fontPx: 10, color: 'var(--text-dim)' });
  _trajRegisterLabel(x, y, lines, 'burn', { screenSize: opts.screenSize != null ? opts.screenSize : Infinity, minSize: _TRAJ_LOD_BURN_MIN, selected: emphasized, marker, hit, opacity: opts.opacity != null ? opts.opacity : 1 });
}

// ── R6.1: passive flight-plan event nodes ───────────────────────────────────
// Every replayed m.log entry that resolves to a MET and a drawable position
// gets a small overlay marker (2 above). MANEUVER is intentionally excluded
// from the render pass (not the resolver) — see the note above
// _trajEventNodesSVG: the existing _trajBurnMarker calls (dep/arr triangles,
// wired since before R6) already give MANEUVER click-to-select
// (_trajSelectEventFromView, with event.stopPropagation()) and a hover
// tooltip, so a second independent node would just double-mark the same
// event. All other 11 types are new.

// type -> {glyph, colorVar-category}. Category drives the marker's stroke
// color per the theming brief: maneuver-ish = accent, structural = accent3,
// passive/other = text-dim. No chromatic literals — plain seed vars only
// (same "stroke uses the seed directly, no tint" convention _trajBurnMarker
// already uses for its own accent2 stroke).
const _TRAJ_EVENTNODE_TYPES = {
  LAUNCH:     { glyph: 'L',  cat: 'passive' },
  DEPLOY:     { glyph: 'D',  cat: 'passive' },
  BURN:       { glyph: 'B',  cat: 'maneuver' },
  MANEUVER:   { glyph: 'M',  cat: 'maneuver' },   // resolver supports it; render pass skips it (see above)
  MNODE:      { glyph: 'MN', cat: 'maneuver' },
  SEPARATE:   { glyph: 'S',  cat: 'structural' },
  DOCK:       { glyph: 'DK', cat: 'structural' },
  EXPEND:     { glyph: 'E',  cat: 'structural' },
  RENDEZVOUS: { glyph: 'RV', cat: 'structural' },
  TRANSFER:   { glyph: 'T',  cat: 'maneuver' },
  REENTER:    { glyph: 'R',  cat: 'passive' },
  RECOVER:    { glyph: 'RC', cat: 'passive' },
};

function _trajEventNodeColorVar(type) {
  const cat = (_TRAJ_EVENTNODE_TYPES[type] || {}).cat;
  if (cat === 'maneuver') return 'var(--accent)';
  if (cat === 'structural') return 'var(--accent3)';
  return 'var(--text-dim)';
}

// Short human label — kept to a couple words, vehicle/target name appended
// when a resolvable one is authored on the entry (best-effort; the entry may
// not carry one at all, e.g. a bare SEPARATE).
function _trajEventNodeLabel(e) {
  switch (e.type) {
    case 'LAUNCH': return 'Launch' + (e.label ? ' — ' + e.label : '');
    case 'DEPLOY': return 'Deploy' + (e.label ? ' — ' + e.label : '');
    case 'BURN': return e.burnLabel || 'Burn';
    case 'MANEUVER': return 'Maneuver' + (e.toLabel ? ' → ' + e.toLabel : '');
    case 'MNODE': return 'Node';
    case 'SEPARATE': return 'Separate';
    case 'DOCK': return 'Dock';
    case 'EXPEND': return 'Expend' + (e.stageName ? ' — ' + e.stageName : '');
    case 'RENDEZVOUS': return 'Rendezvous';
    case 'TRANSFER': return 'Transfer';
    case 'REENTER': return 'Reenter';
    case 'RECOVER': return 'Recover';
    default: return e.type;
  }
}

// Pure resolver: m.log[idx] -> {met, label, glyphKind} or null. `met` is read
// from `.metStart`, the field `missionRecompute` (570) stamps on every
// replayed entry — mirrored back onto the AUTHORED m.log entry itself
// (`authEntry.metStart = metClock`, 570 ~L2189) for the common (non-repeated
// -group) case, which is the only case this resolver supports (repeated-
// group clones live only in m._expanded and are out of scope here, same
// limitation the existing leg/burn-marker extraction already has via
// `e._authIdx`). Returns null for any type not in the R6.1 list, or when the
// entry/mission is malformed, or when no MET has been stamped yet (mission
// never recomputed, or a corrupt entry).
function _trajEventNodeInfo(m, idx) {
  if (!m || !m.log || idx == null || idx < 0 || idx >= m.log.length) return null;
  const e = m.log[idx];
  if (!e || typeof e !== 'object' || !e.type) return null;
  if (!_TRAJ_EVENTNODE_TYPES[e.type]) return null;
  if (e.metStart == null || !isFinite(e.metStart)) return null;
  return { met: e.metStart, label: _trajEventNodeLabel(e), glyphKind: _TRAJ_EVENTNODE_TYPES[e.type].glyph };
}

// Tier (b)/(c) support: the orbit a given log entry's snapshot places some
// vehicle into, in body-frame `body` (skips surface/degenerate orbits). Reads
// `e.snapshot` directly off m.log[idx] — populated by missionRecompute for
// the primary (non-cloned) replay of that entry, same object-identity fact
// _trajEventNodeInfo's metStart read relies on.
function _trajEventNodeOrbitFor(m, idx, body) {
  const e = m && m.log && m.log[idx];
  if (!e || !e.snapshot) return null;
  for (const v of e.snapshot) {
    if (v.orbit && !v.orbit.surface && (v.orbit.body || 'Earth') === body) return v.orbit;
  }
  return null;
}

// Which body-frame a log entry's node belongs in — LAUNCH/REENTER/RECOVER use
// their authored/replayed surface-transition orbit fields directly; every
// other type uses the body of its own snapshot's (first non-surface) orbit.
function _trajEventNodeBody(m, idx) {
  const e = m && m.log && m.log[idx];
  if (!e) return null;
  if (e.type === 'LAUNCH') return (e.launchOrbit && e.launchOrbit.body) || 'Earth';
  if (e.type === 'REENTER' || e.type === 'RECOVER') return (e.orbitAfter && e.orbitAfter.body) || 'Earth';
  if (e.snapshot) {
    for (const v of e.snapshot) {
      if (v.orbit && !v.orbit.surface) return v.orbit.body || 'Earth';
    }
  }
  return null;
}

// Position resolver, precedence per PHYSICS_PLAN.md R6: (a) covering physics
// leg sample interpolation, reusing _trajPolylinePointAt exactly like the
// physics-leg renderer does; (b) orbit-ring position at MET via the SAME
// mean-motion/theta convention the maneuver gizmo's rail math uses
// (_trajGizmoNodeState, 5745 — nMean = sqrt(mu/rMean^3), theta = nMean*met
// mod 2pi, fed through physAimBurnState); (c) body glyph position (ox,oy —
// the body-frame's own origin, correct for surface events); else null.
function _trajEventNodePos(m, idx, body, scale, zoom, ox, oy, met) {
  // (a) physics leg covering this MET in this frame
  if (typeof _physTrajByMission !== 'undefined' && _physTrajByMission[m.missionId]) {
    const legs = _physTrajByMission[m.missionId].legs || [];
    for (const L of legs) {
      const inFrame = (L.samples || []).filter(s => s.frame === body);
      if (!inFrame.length) continue;
      const tMin = Math.min(inFrame[0].t, inFrame[inFrame.length - 1].t);
      const tMax = Math.max(inFrame[0].t, inFrame[inFrame.length - 1].t);
      if (met < tMin || met > tMax) continue;
      const anchorOf = f => (f === body ? { x: ox, y: oy } : null);
      const p = _trajPolylinePointAt(L, anchorOf, zoom, met);
      if (p) return p;
    }
  }
  // (b) orbit-ring position at MET
  const o = _trajEventNodeOrbitFor(m, idx, body);
  if (o && PROG_BODIES[body] && typeof physAimBurnState === 'function') {
    const R = PROG_BODIES[body].R || 0;
    const peri = o.perigee ?? o.apogee ?? 0, apo = o.apogee ?? o.perigee ?? 0;
    const rMean = R + (peri + apo) / 2;
    const mu = PROG_BODIES[body].mu;
    if (rMean > 0 && mu > 0) {
      const nMean = Math.sqrt(mu / (rMean * rMean * rMean));
      const theta = (nMean * met) % (2 * Math.PI);
      const incRad = ((o.inclination || 0) * Math.PI) / 180;
      const raan = o.lan_deg != null ? (o.lan_deg * Math.PI) / 180 : (o.lan != null ? (o.lan * Math.PI) / 180 : 0);
      const bs = physAimBurnState(body, rMean, theta, 0, 0, incRad, 0, raan);
      if (bs && bs.r) {
        const q = _trajProj3(bs.r[0] * scale, bs.r[1] * scale, (bs.r[2] || 0) * scale);
        if (isFinite(q.x) && isFinite(q.y)) return { x: ox + q.x, y: oy + q.y };
      }
    }
  }
  // (c) body glyph position — correct fallback for surface events; also the
  // honest fallback for anything else with no resolvable orbit/leg.
  if (isFinite(ox) && isFinite(oy)) return { x: ox, y: oy };
  return null;
}

// Emits (registers) the passive event-node markers for one body frame. Runs
// AFTER rings/legs/MNODE legs so covering-leg lookups (tier a) see the same
// data those passes already resolved. `screenSize` reuses whatever LOD extent
// is available for the node's underlying geometry (the ring's own screenSize
// for tier b/c nodes, matching the ring's own LOD window so a node doesn't
// outlive its ring visually; Infinity — always eligible — for tier a nodes,
// since a visible leg polyline is itself the LOD gate); piggybacks
// _trajRegisterLabel's existing collision/minSize machinery, per the brief,
// rather than inventing a second LOD system.
function _trajEventNodesSVG(body, m, scale, zoom, ox, oy, id, selAuthIdx) {
  if (!m || !m.log) return;
  const frames = _trajGetExtraction(m);
  const sc = frames[body];
  m.log.forEach((e, idx) => {
    if (!e || _evIsSolvedManeuver(e)) return; // already selectable via _trajBurnMarker — see note above
    const info = _trajEventNodeInfo(m, idx);
    if (!info) return;
    const evBody = _trajEventNodeBody(m, idx);
    if (evBody !== body) return;
    // R6.1 fix (round 2 item 1): MNODE with a resolved physics leg draws ONE
    // merged marker at the LEG's first-sample position (the same anchor the
    // dep burn marker would have used) instead of the independent ring
    // mean-motion position — the leg's own dep marker is suppressed for
    // MNODE legs in _trajMnodeLegsSVG so there is exactly one marker.
    let pos = null, mergedDvText = null, mergedLeg = null;
    if (e.type === 'MNODE' && typeof physMissionLeg === 'function') {
      mergedLeg = physMissionLeg(id, idx);
      if (mergedLeg && mergedLeg.samples && mergedLeg.samples.length) {
        const anchorOf = f => (f === body ? { x: ox, y: oy } : null);
        const poly = _trajPolylineSVG(mergedLeg, anchorOf, zoom, {});
        if (poly && poly.first && isFinite(poly.first.x) && isFinite(poly.first.y)) {
          pos = { x: poly.first.x, y: poly.first.y };
          const dv = e.dvRequired || (mergedLeg.dv_ms != null ? Math.round(mergedLeg.dv_ms) : null);
          if (dv) mergedDvText = _trajDvText(dv);
        }
      }
    }
    if (!pos) pos = _trajEventNodePos(m, idx, body, scale, zoom, ox, oy, info.met);
    if (!pos) return;
    const emphasized = selAuthIdx != null && selAuthIdx === idx;
    const o = _trajEventNodeOrbitFor(m, idx, body);
    const rec = (o && sc) ? [...sc.orbits.values()].find(r => Math.abs(r.peri - (o.perigee ?? o.apogee ?? 0)) < 1 && Math.abs(r.apo - (o.apogee ?? o.perigee ?? 0)) < 1) : null;
    const screenSize = rec ? ((PROG_BODIES[body] ? PROG_BODIES[body].R : 0) + rec.apo) * scale : Infinity;
    const color = _trajEventNodeColorVar(e.type);
    const vehName = (m._ownerLabels && e.vehicleId && m._ownerLabels[e.vehicleId]) || e.activeName || e.label || '';
    const title = `${e.type} · ${_metFmt(info.met)}${vehName ? ' · ' + _tsEsc(vehName) : ''}`;
    const clickAttr = ` style="cursor:pointer" onclick="event.stopPropagation();_trajSelectEventFromView('${id}',${idx})"` +
      (e.type === 'MNODE' ? ` ondblclick="event.stopPropagation();_trajGizmoOpenExisting('${id}',${idx})"` : '');
    const r = emphasized ? 4.6 : 4;
    const ring = emphasized ? `<circle cx="0" cy="0" r="${(r + 2).toFixed(1)}" fill="none" stroke="var(--accent)" stroke-width="1.1"/>` : '';
    const marker = `${ring}<circle cx="0" cy="0" r="${r}" fill="var(--nm-bg)" stroke="${color}" stroke-width="1"/>` +
      `<text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="var(--mono)" font-size="${info.glyphKind.length > 1 ? 4 : 5}" fill="${color}" pointer-events="none">${info.glyphKind}</text>`;
    const hitR = mergedLeg ? 12 : 9; // merged MNODE marker gets a more generous hit radius
    const hit = `<circle cx="0" cy="0" r="${hitR}" fill="transparent"${clickAttr}><title>${title}</title></circle>`;
    // Merged MNODE marker: Δv text above, time plate directly below — one
    // coherent stack (round 2 item 1). Non-merged nodes keep the plain label.
    const lines = mergedDvText
      ? [{ text: mergedDvText, dy: -9, fontPx: 9, color }, { text: _metFmt(info.met), dy: r + 7, fontPx: 9, color: 'var(--text-dim)' }]
      : [{ text: info.label, dy: -9, fontPx: 9, color }];
    _trajRegisterLabel(pos.x, pos.y, lines,
      'burn', { screenSize, minSize: _TRAJ_LOD_BURN_MIN, selected: emphasized, marker, hit, opacity: 1 });
  });
}

// History alpha (C2): legs/orbits belonging to a vehicle/state that no
// longer exists "now" (arrived-and-past, or expended before viewTime) dim to
// this constant rather than disappearing — keeps mission HISTORY legible
// without competing visually with the current/planned state.
const _TRAJ_HISTORY_ALPHA = 0.35;

// Ghost marker (C2 Moon-lead fix): a dim glyph-outline + label at a body's
// ARRIVAL-time position, shown only when it differs visibly (>3px) from the
// body's CURRENT viewTime position — so users don't conclude "the arc misses
// the Moon" when the Moon has since moved along its own orbit. LOD-gated
// like any other label (screenSize tied to zoom so it also fades with scale).
function _trajGhostMarker(x, y, bodyName, zoom, parentAlpha) {
  const alpha = (parentAlpha != null ? parentAlpha : 1);
  const r = _trajBodyPxR(3, zoom); // render units ≈ px
  const marker = `<circle cx="0" cy="0" r="${r.toFixed(2)}" fill="none" stroke="var(--text-dim)" stroke-width="0.8" stroke-dasharray="1.5,1.5" pointer-events="none"/>`;
  const lines = [{ text: `${bodyName} at arrival`, dy: -4 - r, fontPx: 9, color: 'var(--text-dim)' }];
  _trajRegisterLabel(x, y, lines, 'zone', { screenSize: r, minSize: 0, selected: false, marker, opacity: alpha * 0.8 });
  return '';
}

// Click handler shared by arcs/markers/rings: selects the AUTHORED event
// (expands its card + rewinds the state panel via existing missionSelectEvent
// behavior). Guarded against firing after a real pan-drag (see trajCanvasDown).
function _trajSelectEventFromView(id, authIdx) {
  if (_trajJustDragged) { _trajJustDragged = false; return; }
  // Clicking a leg/marker to select its event hands view-time authority back
  // to the "state as of this event" rule (_trajViewTime) — a lingering scrub
  // override would otherwise silently out-rank the selection the user just
  // made, per the "one view-time authority" integration rule.
  delete _trajViewTimeOverride[id];
  if (typeof missionSelectEvent === 'function') missionSelectEvent(id, authIdx);
  // R3.3: selecting an MNODE event attaches the gizmo at its recorded state;
  // selecting anything else detaches a currently-committed gizmo.
  if (typeof _trajGizmoOnEventSelected === 'function') {
    const m = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
    _trajGizmoOnEventSelected(id, authIdx, m && m.log && m.log[authIdx]);
  }
  // T4: same dwell-orbit-inspector hook as the node-map click path (_missionNmSelectShared).
  if (typeof _oiOnEventSelected === 'function') {
    const m2 = (typeof _missions !== 'undefined' ? _missions : []).find(x => x.missionId === id);
    _oiOnEventSelected(id, authIdx, m2 && m2.log && m2.log[authIdx]);
  }
  // E4 (5748): a duration-drag in progress against a DIFFERENT event is
  // stale the moment selection moves — cancel it rather than leave a
  // dangling drag targeting an event no longer shown as selected.
  if (typeof _ltgCancelDrag === 'function') _ltgCancelDrag();
}

// Compute the min zoom-worthy extent (max body-centered radius, km) of a
// body-frame's MISSION content only (orbit apoapses + transfer/legs' far
// endpoint) — used to pick the fly-to fit scale (static rings beyond remain
// reachable by zooming out further).
function _trajMissionExtentForBody(body, m) {
  const frames = _trajGetExtraction(m);
  const sc = frames[body];
  if (!sc) return 0;
  const isSun = body === 'Sun';
  const R = isSun ? 0 : ((PROG_BODIES[body] && PROG_BODIES[body].R) || 0);
  let maxR = 0;
  sc.orbits.forEach(rec => {
    // Phase 5a fix (user flight-test "corrupted Moon view"): a PROPAGATED
    // record (NRHO) has no rec.apo — `R + undefined` = NaN, which poisons
    // every Math.max downstream and lands as a NaN camera width in
    // _trajFitWKmForBody (zoom = 400/NaN → the whole scene culls to nothing).
    // Use the propagated loop's real sampled extent instead.
    if (rec.kind === 'propagated') {
      if (typeof refOrbitSamplePropagated === 'function' && rec.refId) {
        const samples = refOrbitSamplePropagated(rec.refId, 24);
        samples.forEach(s => { const d = Math.hypot(s.r[0], s.r[1], s.r[2]); if (isFinite(d)) maxR = Math.max(maxR, d); });
      }
      return;
    }
    if (isFinite(rec.apo)) maxR = Math.max(maxR, R + rec.apo);
  });
  sc.legs.forEach(leg => {
    if (isSun) {
      // transit orbits live in the Sun frame with body 'Sun' — their ring
      // radius comes from the destination planet (same rule as the arc renderer)
      const hr = o => o ? PROG_HELIO_R[o.type === 'transit' ? o.destination : o.body] : null;
      const r1 = hr(leg.fromO), r2 = hr(leg.toO);
      if (r1 != null) maxR = Math.max(maxR, r1);
      if (r2 != null) maxR = Math.max(maxR, r2);
    } else {
      const r1 = _trajLocalRadius(leg.fromO, body), r2 = _trajLocalRadius(leg.toO, body);
      if (r1 != null) maxR = Math.max(maxR, r1);
      if (r2 != null) maxR = Math.max(maxR, r2);
    }
  });
  return maxR;
}

// Per-render extraction cache, keyed by missionId so switching missions (or a
// stale reference from a prior render) can't leak state across renders.
let _trajExtractionCache = { missionId: null, data: null };
function _trajGetExtraction(m) {
  if (!m) return {};
  if (_trajExtractionCache.missionId === m.missionId && _trajExtractionCache.data) return _trajExtractionCache.data;
  const data = _trajExtractMission(m);
  _trajExtractionCache = { missionId: m.missionId, data };
  return data;
}

// ── Planet-phase calibration — RETIRED (R1, 2026-07-09) ─────────────────────
// The per-mission calibration fiction (_trajGetPlanetCalibration /
// progCalibratedTheta0, old MATH.md §7a) existed only because the rails were
// schematic circles: a Hohmann arc could not otherwise land on its planet.
// With real ephemeris rails (360), real phases connect (or honestly don't —
// a leg that can't connect at its authored MET renders converged:false via
// the physics side-table, and the schematic fallback arc shows a ghost
// marker at the true arrival position). progBodyWorldPosCalibrated survives
// as a thin alias that ignores its overrides argument.

function _trajSelectedAuthIdx(m) {
  if (!m || !m.log) return null;
  const idx = m.log.findIndex(e => e._expanded);
  return idx >= 0 ? idx : null;
}

// Body-centered periapsis/apoapsis radius (km, including body R) for a
// node-map orbit spec — used only by the redundancy check below (distinct
// from _trajLocalRadius's single "mean radius" used for arc endpoints).
function toO_peri(o, R) {
  if (!o || o.perigee == null && o.apogee == null) return null;
  return R + (o.perigee ?? o.apogee ?? 0);
}
function toO_apo(o, R) {
  if (!o || o.perigee == null && o.apogee == null) return null;
  return R + (o.apogee ?? o.perigee ?? 0);
}

// Redundant-transfer check: a leg's transfer ellipse (rPeri..rApo) is
// suppressed when it's ~equal to the destination orbit's own (rPeri..rApo) —
// i.e. the target IS the transfer (classic GTO-as-destination case, where the
// model charges dv2=0 for the arrival burn). Tolerance ~2%, matching the
// design brief. `toRPeri`/`toRApo` are the destination orbit's body-centered
// radii; `arcRPeri`/`arcRApo` are the drawn transfer arc's radii.
function _trajTransferIsRedundant(arcRPeri, arcRApo, toRPeri, toRApo) {
  if (!(arcRPeri > 0) || !(arcRApo > 0) || !(toRPeri > 0) || !(toRApo > 0)) return false;
  const tolP = Math.max(1, toRPeri * 0.02), tolA = Math.max(1, toRApo * 0.02);
  return Math.abs(arcRPeri - toRPeri) < tolP && Math.abs(arcRApo - toRApo) < tolA;
}

// Emits mission content (orbit rings, transfer legs, surface events) for one
// body frame, positioned around (ox,oy) — that body's floating-origin render
// coordinates for this frame. `scale` is the LOCAL px-per-km factor for this
// body's neighborhood (independent of the camera zoom, same "local scene
// scale" concept as before — it just gets recentered on ox,oy instead of on
// the SVG origin).
// ── MISSION_MODEL_V2 §19 E3 — low-thrust spiral rendering (MATH.md §7aa) ────
// COMPUTED legs: the signature-matched cache record (568) carries a
// rev-boundary-LOD sample split (head/mid/tail from ltResampleSpiralRevs) —
// head+tail draw as REAL polylines through _trajPolylineSVG (per-sample
// epochs -> the N3 frame transform applies automatically, same as physics
// legs), and the dense middle draws as a translucent min/max-radius annulus
// ("washer") in the spiral's plane. The washer is built here with _trajProj3
// at t=viewT rather than reusing Saturn's ring-band machinery
// (_trajRingBandRunPath): that path projects through raw az/el and
// _trajRingPlaneBasis(body), which BYPASSES the N3 frame transform — the
// washer must rotate with the frame like the polylines it bridges. v1
// spirals are ecliptic-planar by construction (ltComputeTrajectory seeds
// r=[R+alt,0,0], v=[0,v,0]), so a flat z=0 annulus is exact, not an
// approximation, for every leg this pass can author; the "washer uses the
// plane at viewT" caveat only matters if out-of-plane laws ever land
// (documented, §7aa).
// UN-COMPUTED / STALE legs: an honest SCHEMATIC — a dashed log-spiral arc
// from the start orbit's radius to the est.-lane end radius, var(--text-dim),
// clearly stylized (fixed 4 revs, not a physics claim), so an authored leg
// always has SOME visual (§19's contract) without pretending integration ran.
function _trajLowThrustSVG(m, body, zoom, ox, oy, viewportDiagPx, vt, oDepth, selAuthIdx) {
  if (!m || !m.log || typeof ltComputedLeg !== 'function') return '';
  const id = m.missionId;
  const bodyDef = PROG_BODIES[body];
  if (!bodyDef) return '';
  let out = '';
  m.log.forEach((e, i) => {
    if (!e || e.type !== 'LOWTHRUST') return;
    const ob = e.orbitBefore;
    if (!ob || ob.body !== body) return;
    const emphasized = selAuthIdx != null && i === selAuthIdx;
    const met0 = e.metStart || 0;
    const dur = Math.max(0, e.duration_s || 0);
    const legState = vt >= met0 + dur ? 'history' : (vt >= met0 ? 'current' : 'planned');
    const stateAlpha = legState === 'history' ? _TRAJ_HISTORY_ALPHA : 1;
    const clickAttr = ` style="cursor:pointer" onclick="_trajSelectEventFromView('${id}',${i})"`;
    const rec = (e._ltState === 'computed') ? ltComputedLeg(id, i) : null;
    const lod = rec && rec.samplesLod;

    if (lod && ((lod.head && lod.head.length > 1) || (lod.tail && lod.tail.length > 1))) {
      // ── computed: LOD render ──
      const color = emphasized ? 'var(--accent)' : 'var(--accent2)';
      const anchorOf = f => f === body ? { x: ox, y: oy, depth: oDepth != null ? oDepth : Infinity } : null;
      const toLeg = seg => ({ samples: seg.map(s => ({ t: met0 + s.t, frame: body, r: s.r })) });
      const title = `Low-thrust spiral (computed) &middot; ${_trajDvText(Math.round((rec.dvAccum_kms || 0) * 1000))}${lod.revCount ? ' &middot; ' + Math.round(lod.revCount) + ' revs' : ''} &middot; ${_metFmt(met0)}`;
      // envelope washer FIRST (under the polylines): min/max radius over the
      // decimated middle (plus the adjacent head/tail endpoints for a seamless
      // bridge). Skipped when the middle is empty (short spiral — pure polyline).
      if (lod.mid && lod.mid.length) {
        let rMin = Infinity, rMax = 0;
        const scan = s => { const r = Math.hypot(s.r[0], s.r[1], s.r[2] || 0); if (r < rMin) rMin = r; if (r > rMax) rMax = r; };
        lod.mid.forEach(scan);
        if (lod.head && lod.head.length) scan(lod.head[lod.head.length - 1]);
        if (lod.tail && lod.tail.length) scan(lod.tail[0]);
        const extentPx = rMax * zoom;
        if (isFinite(rMin) && rMax > rMin && !_trajCullByExtent(extentPx) && !_trajCullRingByDiagonal(extentPx, viewportDiagPx)) {
          const N = 48;
          const arc = r => {
            let d = '';
            for (let k = 0; k <= N; k++) {
              const a = k / N * 2 * Math.PI;
              const q = _trajProj3(r * Math.cos(a), r * Math.sin(a), 0);   // t=viewT: washer plane rides the frame at view time
              d += (d ? ' L ' : 'M ') + (ox + q.x * zoom).toFixed(2) + ' ' + (oy + q.y * zoom).toFixed(2);
            }
            return d + ' Z';
          };
          // two closed subpaths + evenodd = a true annulus (hole at the inner radius)
          const washerD = arc(rMax) + ' ' + arc(rMin);
          out += `<path d="${washerD}" fill="${color}" fill-opacity="${(0.10 * stateAlpha).toFixed(3)}" fill-rule="evenodd" stroke="${color}" stroke-width="0.4" stroke-opacity="${(0.35 * stateAlpha).toFixed(3)}" vector-effect="non-scaling-stroke"${clickAttr}><title>${title} &middot; envelope ${Math.round(rMin - bodyDef.R).toLocaleString()}&ndash;${Math.round(rMax - bodyDef.R).toLocaleString()} km alt (dense middle revs)</title></path>`;
        }
      }
      // head + tail polylines (real per-rev geometry; per-sample epochs -> N3)
      [lod.head, lod.tail].forEach((seg, si) => {
        if (!seg || seg.length < 2) return;
        const poly = _trajPolylineSVG(toLeg(seg), anchorOf, zoom, { viewportDiagPx });
        if (!poly || poly.hidden) return;
        const dashAttr = legState === 'planned' ? ' stroke-dasharray="2.5,2"' : '';
        const op = ((emphasized ? 1 : 0.85) * stateAlpha).toFixed(3);
        out += `<path d="${poly.d}" fill="none" stroke="${color}" stroke-width="${emphasized ? 1.1 : 0.7}"${dashAttr} opacity="${op}" vector-effect="non-scaling-stroke"${clickAttr}><title>${title} &middot; ${si === 0 ? 'first' : 'last'} revs</title></path>`;
        out += `<path d="${poly.d}" fill="none" stroke="transparent" stroke-width="8"${clickAttr}/>`;
      });
      // ── E4 duration-drag handle (MATH.md §7ab): at the LOD tail's endpoint,
      // only when this event is the selected/expanded one. Direction (tx,ty)
      // is the tail's second-to-last sample, projected the SAME way as the
      // endpoint — the gizmo module (5748) reads both as data attrs to derive
      // a screen-space drag axis, no re-projection needed client-side.
      if (emphasized && lod.tail && lod.tail.length >= 2 && typeof _ltgHandleDown === 'function') {
        const s2 = lod.tail[lod.tail.length - 1], s1 = lod.tail[lod.tail.length - 2];
        const a = anchorOf(body);
        const q2 = _trajProj3(s2.r[0], s2.r[1], s2.r[2] || 0, met0 + s2.t);
        const q1 = _trajProj3(s1.r[0], s1.r[1], s1.r[2] || 0, met0 + s1.t);
        const hx = a.x + q2.x * zoom, hy = a.y + q2.y * zoom;
        const tx = a.x + q1.x * zoom, ty = a.y + q1.y * zoom;
        out += `<circle class="ltg-handle" cx="${hx.toFixed(2)}" cy="${hy.toFixed(2)}" r="7" data-tx="${tx.toFixed(2)}" data-ty="${ty.toFixed(2)}" fill="var(--accent)" stroke="var(--bg)" stroke-width="1.5" style="pointer-events:auto;cursor:ew-resize" onmousedown="event.stopPropagation();_ltgHandleDown(event,'${id}',${i})"><title>Drag to scale duration (live est. — release to author)</title></circle>`;
      }
      return;
    }

    // ── un-computed / STALE: schematic dashed log-spiral glyph ──
    const oa = e.orbitAfter;
    const meanAlt = o => ((o.perigee ?? o.apogee ?? 0) + (o.apogee ?? o.perigee ?? 0)) / 2;
    const r0 = bodyDef.R + meanAlt(ob);
    const r1 = bodyDef.R + (oa ? meanAlt(oa) : meanAlt(ob));
    if (!(r0 > 0) || !(r1 > 0)) return;
    const extentPx = Math.max(r0, r1) * zoom;
    if (_trajCullByExtent(extentPx) || _trajCullRingByDiagonal(extentPx, viewportDiagPx)) return;
    const REVS = 4, STEPS = 160;                       // stylized, NOT the est. rev count — a glyph, not physics
    const thMax = REVS * 2 * Math.PI;
    let d = '', lastPx = null, prevPx = null;
    for (let k = 0; k <= STEPS; k++) {
      const th = k / STEPS * thMax;
      const r = r0 * Math.pow(r1 / r0, th / thMax);    // log spiral: exponential radius vs angle
      const q = _trajProj3(r * Math.cos(th), r * Math.sin(th), 0);
      const px = ox + q.x * zoom, py = oy + q.y * zoom;
      d += (k ? ' L ' : 'M ') + px.toFixed(2) + ' ' + py.toFixed(2);
      prevPx = lastPx; lastPx = { x: px, y: py };
    }
    const stateTxt = e._ltState === 'stale' ? 'STALE — recompute' : 'est. — not computed';
    const title = `Low-thrust spiral (schematic, ${stateTxt}) &middot; ${_trajDvText(Math.round(e.dv_est || 0))} est. &middot; ${_metFmt(met0)}`;
    // E4: schematic arc gets an id so the duration-drag gizmo (5748) can
    // rewrite its `d` attribute directly during a drag (est.-lane-only, no
    // recompute) without a full DOM re-render on every mouse-move frame.
    const schemId = `lt-schem-${id}-${i}`;
    out += `<path id="${schemId}" d="${d}" fill="none" stroke="var(--text-dim)" stroke-width="0.7" stroke-dasharray="4,3" opacity="${(0.7 * stateAlpha).toFixed(3)}" vector-effect="non-scaling-stroke"${clickAttr}><title>${title}</title></path>`;
    out += `<path d="${d}" fill="none" stroke="transparent" stroke-width="8"${clickAttr}/>`;
    // E4 duration-drag handle at the schematic arc's endpoint (only for the
    // selected/expanded event) — see MATH.md §7ab.
    if (emphasized && lastPx && prevPx && typeof _ltgHandleDown === 'function') {
      out += `<circle class="ltg-handle" cx="${lastPx.x.toFixed(2)}" cy="${lastPx.y.toFixed(2)}" r="7" data-tx="${prevPx.x.toFixed(2)}" data-ty="${prevPx.y.toFixed(2)}" data-schem="${schemId}" data-r0="${r0.toFixed(3)}" data-body="${body}" fill="var(--accent)" stroke="var(--bg)" stroke-width="1.5" style="pointer-events:auto;cursor:ew-resize" onmousedown="event.stopPropagation();_ltgHandleDown(event,'${id}',${i})"><title>Drag to scale duration (live est. — release to author)</title></circle>`;
    }
  });
  return out;
}

function _trajBodyFrameContent(body, m, scale, zoom, ox, oy, viewportDiagPx, viewT, overrides, calib, oDepth) {
  if (!m) return '';
  const frames = _trajGetExtraction(m);
  const sc = frames[body];
  if (!sc) return '';
  const isSun = body === 'Sun';
  const R = isSun ? 0 : ((PROG_BODIES[body] && PROG_BODIES[body].R) || 0);
  scale = scale || 1;
  zoom = zoom || 1;
  overrides = overrides || {};
  const id = m.missionId;
  const selAuthIdx = _trajSelectedAuthIdx(m);

  let out = '';

  // orbit rings (skip for Sun frame — heliocentric transit legs are drawn as
  // arcs between the planet rings, not as a new "orbit" of the Sun)
  if (!isSun) {
    sc.orbits.forEach(rec => {
      const emphasized = selAuthIdx != null && rec.firstAuthIdx === selAuthIdx;
      // C2: a ring whose owning vehicle(s) are ALL expended by viewTime dims
      // to history alpha, same treatment as an arrived leg.
      const isHistoryOrbit = rec.expendMet != null && viewT != null && rec.expendMet <= viewT;
      const ringOpts = { emphasized, authIdx: rec.firstAuthIdx, missionId: id, zoom, originX: ox, originY: oy, viewportDiagPx, historyAlpha: isHistoryOrbit ? _TRAJ_HISTORY_ALPHA : 1, centerDepth: oDepth };
      out += rec.kind === 'propagated'
        ? _trajPropagatedRingSVG(rec, body, scale, rec.colors.size === 1 ? [...rec.colors][0] : null, ringOpts)
        : _trajRingSVG(rec, body, scale, rec.colors.size === 1 ? [...rec.colors][0] : null, ringOpts);
    });
    // MISSION_MODEL_V2 §19 E3 — low-thrust spiral legs (computed LOD render /
    // schematic dashed glyph). See _trajLowThrustSVG below + MATH.md §7aa.
    out += _trajLowThrustSVG(m, body, zoom, ox, oy, viewportDiagPx, viewT != null ? viewT : Infinity, oDepth, selAuthIdx);
  }

  // transfer legs — C2 mission-state trimming: a leg's relationship to
  // viewT decides its render treatment: arrived (metArrive <= viewT) =
  // "history" (dimmed, _TRAJ_HISTORY_ALPHA); departed but not yet arrived
  // (met <= viewT < metArrive) = "current" (full-strength + a schematic
  // vehicle dot at linear path fraction); not yet departed (met > viewT) =
  // "planned" (today's dashed rendering, unchanged). Legs with no `met`
  // (older missions / degenerate data) fall back to "planned" treatment.
  const vt = viewT != null ? viewT : Infinity;
  sc.legs.forEach((leg, li) => {
    const emphasized = selAuthIdx != null && leg.authIdx === selAuthIdx;
    const clickAttr = leg.authIdx != null ? ` style="cursor:pointer" onclick="_trajSelectEventFromView('${id}',${leg.authIdx})"` : '';
    const hoverTitle = `${leg.vehName ? leg.vehName + ' — ' : ''}${leg.fromLabel} → ${leg.toLabel}${leg.dv ? ' &middot; ' + _trajDvText(leg.dv) : ''}${leg.met != null ? ' &middot; ' + _metFmt(leg.met) : ''}`;
    const markerOpts = (screenSize) => ({ emphasized, authIdx: leg.authIdx, missionId: id, title: hoverTitle, zoom, screenSize });
    const hasTOF = leg.met != null && leg.metArrive != null && leg.metArrive > leg.met;
    const legState = !hasTOF ? 'planned' : (leg.metArrive <= vt ? 'history' : (leg.met <= vt ? 'current' : 'planned'));
    const stateAlpha = legState === 'history' ? _TRAJ_HISTORY_ALPHA : 1;
    if (isSun) {
      // A transit orbit's `body` is 'Sun' (the frame it lives in) — its ring
      // radius on the heliocentric map comes from its DESTINATION planet, not
      // its body field. Resolving by body alone made every interplanetary arc
      // silently bail here (r2 === undefined) — the transit-vs-body split, again.
      const heliR = o => {
        if (!o) return null;
        const key = o.type === 'transit' ? o.destination : o.body;
        return (key != null && PROG_HELIO_R[key] != null) ? PROG_HELIO_R[key] : null;
      };
      const r1 = heliR(leg.fromO);
      const r2 = heliR(leg.toO);
      if (r1 == null || r2 == null) return;
      // Moon-lead orientation (C2): rotate so the arrival end lands on the
      // DESTINATION BODY'S POSITION AT ARRIVAL TIME (t_arrive), not a
      // schematic fixed angle — same rule as the local-body case below,
      // just resolved in heliocentric coords for interplanetary legs.
      const destBody = leg.toO.destination || leg.toO.body || leg.toLabel;
      const tArrive = leg.metArrive != null ? leg.metArrive : vt;

      // (R1: the 'second leg to the same planet' ghost treatment retired with
      // the calibration — every leg renders against the same real ephemeris.)

      // ── P3: physics polyline (heliocentric leg) — drawn ONLY when the
      // propagation actually reached its destination SOI (converged). An
      // unconverged ballistic polyline is a green line to nowhere (user-
      // reported on the Venus transfer, 2026-07-09) while the schematic
      // calibrated arc DOES visually connect — pre-P4 (no targeting), the
      // schematic is the more honest picture of intent. P4's shooter flips
      // these legs to converged and they graduate to physics rendering.
      if (typeof physMissionLeg === 'function' && leg.authIdx != null) {
        const physLegS = physMissionLeg(id, leg.authIdx);
        if (physLegS && physLegS.converged && physLegS.samples && physLegS.samples.length) {
          const phys = _trajPhysLegRender({ m, leg, physLeg: physLegS, body: 'Sun', ox, oy, zoom, viewportDiagPx, vt, emphasized, title: hoverTitle, depMarker: true, arrMarker: true, calib, encounterChip: true, oDepth });
          if (phys != null) { out += phys; return; }
        }
      }

      let rotAng = _trajPlanetAngle(leg.fromO.body);
      let ghostP = null, arrivalTargetP = null;
      if (destBody && PROG_HELIO_R[destBody] != null && typeof progBodyWorldPos === 'function') {
        // R2: the arc's ROTATION is planar geometry (solved in the unprojected
        // ecliptic plane); marker/ghost POSITIONS project through the camera
        // so they land on the drawn planet under tilt.
        const arrWorld = progBodyWorldPos(destBody, tArrive);
        rotAng = _trajArcRotationForTarget(0, 0, arrWorld.x, arrWorld.y); // planar
        const aq = _trajProj3(arrWorld.x, arrWorld.y, arrWorld.z || 0);
        arrivalTargetP = { x: ox + aq.x * zoom, y: oy + aq.y * zoom };
        const viewWorld = progBodyWorldPos(destBody, vt);
        const vq = _trajProj3(viewWorld.x, viewWorld.y, viewWorld.z || 0);
        const viewP = { x: ox + vq.x * zoom, y: oy + vq.y * zoom };
        if (Math.hypot(viewP.x - arrivalTargetP.x, viewP.y - arrivalTargetP.y) > 3) ghostP = arrivalTargetP;
      }
      const arc = _trajArcProjectedPath(r1, r2, scale, rotAng, ox, oy);
      const arcExtentPx = Math.hypot(arc.depX - arc.arrX, arc.depY - arc.arrY) / 2;
      if (_trajCullByExtent(arcExtentPx) || _trajCullRingByDiagonal(arcExtentPx, viewportDiagPx)) return;
      const arcAlpha = emphasized ? 1 : _trajLodOpacity(arcExtentPx, _TRAJ_LOD_WIN.transferArc[0], _trajWindowHi(_TRAJ_LOD_WIN.transferArc[1], viewportDiagPx));
      if (arcAlpha <= 0) return;
      const color = emphasized ? 'var(--accent)' : (leg.color || 'var(--accent2)');
      const strokeW = emphasized ? 1.2 : 0.7;
      const dashAttr = legState === 'planned' ? ` stroke-dasharray="2.5,2"` : '';
      const opacity = (arcAlpha * (emphasized ? 1 : 0.8) * stateAlpha).toFixed(3);
      const hitArea = leg.authIdx != null ? `<path d="${arc.d}" fill="none" stroke="transparent" stroke-width="8"${clickAttr}/>` : '';
      out += `<path d="${arc.d}" fill="none" stroke="${color}" stroke-width="${strokeW}"${dashAttr} opacity="${opacity}" vector-effect="non-scaling-stroke"${clickAttr}><title>${hoverTitle}</title></path>${hitArea}`;
      _trajBurnMarker(arc.depX, arc.depY, 'up', _trajDvText(leg.dv), _metFmt(leg.met), Object.assign(markerOpts(arcExtentPx), { opacity: stateAlpha }));
      _trajBurnMarker(arc.arrX, arc.arrY, 'down', '', _metFmt(leg.metArrive), Object.assign(markerOpts(arcExtentPx), { opacity: stateAlpha }));
      if (legState === 'current' && hasTOF) {
        const frac = _trajLegPathFraction(leg.met, leg.metArrive - leg.met, vt);
        const dl = _trajArcPointAt(r1, r2, scale, rotAng, 0, 0, frac);
        const dq = _trajProjLocal(dl.x, dl.y);
        out += `<circle cx="${(ox + dq.x).toFixed(2)}" cy="${(oy + dq.y).toFixed(2)}" r="2.2" fill="var(--accent)" stroke="var(--nm-bg)" stroke-width="0.6" vector-effect="non-scaling-stroke"><title>Vehicle position (schematic — linear path fraction, not true orbital speed)</title></circle>`;
      }
      if (ghostP) out += _trajGhostMarker(ghostP.x, ghostP.y, destBody, zoom, arcAlpha * stateAlpha);
      return;
    }

    // (R1: local-frame 'second leg' ghost variant retired with calibration.)

    // ── P3: physics polyline, LOCAL-frame portion. Two cases:
    // (a) the leg's OWN physics record has samples in this frame (e.g. the
    //     TLC injection leg drawn at Earth — the spiral/ellipse out); and
    // (b) an ARRIVAL leg (fromO transit) drawn in the destination's own
    //     frame — the propagation lives on the earlier INJECTION leg, whose
    //     destination-frame samples carry the hyperbolic approach (this
    //     replaces the schematic SOI-fallback arc when the physics actually
    //     reached the body). Clicking the polyline selects THIS frame's
    //     authored event (injection at Earth, arrival burn at the Moon).
    if (typeof physMissionLeg === 'function' && leg.authIdx != null) {
      const physLegL = physMissionLeg(id, leg.authIdx);
      // (a) the leg's OWN physics record: the HOME pass draws the WHOLE
      // continuous path (all frames, glued via anchorOf) — converged only,
      // same rule as the Sun branch (unconverged = schematic fallback).
      if (physLegL && physLegL.converged && physLegL.samples && physLegL.samples.length) {
        const phys = _trajPhysLegRender({ m, leg, physLeg: physLegL, body, ox, oy, zoom, viewportDiagPx, vt, emphasized, title: hoverTitle, depMarker: true, arrMarker: false, calib, encounterChip: true, oDepth });
        if (phys != null) { out += phys; return; }
      }
      if (leg.fromO && leg.fromO.type === 'transit') {
        const inj = _trajPhysInjectionLegFor(m, leg.authIdx, body);
        // (b) ARRIVAL leg at the destination frame: the approach curve was
        // already drawn (continuously) by the injection leg's home pass — do
        // NOT redraw it here. Emit ONLY the arrival burn marker at the clip
        // point (the mission's arrival-burn moment on the propagated path).
        if (inj && inj.converged && inj.samples && inj.samples.some(s => s.frame === body)) {
          const clipT = _trajPhysClipT(m, inj);
          const anchorLocal = f => f === body ? { x: ox, y: oy } : null;
          const lastLocalT = inj.samples.reduce((acc, s) => (s.frame === body && s.t > acc ? s.t : acc), -Infinity);
          const tMark = Math.min(isFinite(clipT) ? clipT : Infinity, lastLocalT);
          const pos = isFinite(tMark) ? _trajPolylinePointAt(inj, anchorLocal, zoom, tMark) : null;
          if (pos) {
            _trajBurnMarker(pos.x, pos.y, 'down', _trajDvText(leg.dv), leg.metArrive != null ? _metFmt(leg.metArrive) : '',
              Object.assign(markerOpts(physSoiRadius(body) * zoom), { opacity: stateAlpha }));
            return;
          }
        }
        // ── P3: capture spur — an INTERPLANETARY arrival with no physics
        // samples at this body (unconverged pre-P4 aim is expected) draws the
        // analytic capture hyperbola from the SOI edge down to the arrival
        // orbit instead of the arbitrary R*20 schematic fallback. Incoming
        // asymptote anti-parallel to the schematic arrival v∞ direction
        // (≈ −v_planet for arrivals from an inner origin, +v_planet from an
        // outer one) — a schematic mirror of the departure geometry, per
        // MATH.md §7f.
        if (leg.fromO.body === 'Sun' && (leg.fromO.c3 > 0) && PROG_HELIO_R[body] != null && typeof physBodyStateAt === 'function') {
          const rpArr = _trajLocalRadius(leg.toO, body);
          if (rpArr != null) {
            const tArrSpur = leg.metArrive != null ? leg.metArrive : vt;
            const vArr = physBodyStateAt(body, tArrSpur).v;
            const originB = leg.fromO.departure_body || 'Earth';
            const fromInner = PROG_HELIO_R[originB] != null && PROG_HELIO_R[originB] < PROG_HELIO_R[body];
            // SOI entry point sits UP-stream of the incoming v∞ direction:
            // vInf ≈ −v_planet (from inner) → far end along +v_planet; mirrored otherwise.
            const farAng = Math.atan2(fromInner ? vArr[1] : -vArr[1], fromInner ? vArr[0] : -vArr[0]);
            const spurDash = legState === 'planned' ? ' stroke-dasharray="2.5,2"' : '';
            const spur = _trajEscapeSpurSVG(body, rpArr, leg.fromO.c3, farAng, true, zoom, ox, oy, viewportDiagPx,
              { emphasized, color: leg.color, dashAttr: spurDash, stateAlpha, missionId: id, authIdx: leg.authIdx, title: hoverTitle });
            if (spur != null) {
              out += spur.svg;
              if (!spur.hidden) _trajBurnMarker(spur.burn.x, spur.burn.y, 'down', _trajDvText(leg.dv), _metFmt(leg.metArrive), Object.assign(markerOpts(spur.extentPx), { opacity: stateAlpha }));
              return;
            }
          }
        }
      }
    }

    const fromR = _trajLocalRadius(leg.fromO, body);
    const toR = _trajLocalRadius(leg.toO, body);
    if (fromR == null || toR == null) return;
    const toPeri = toO_peri(leg.toO, R), toApo = toO_apo(leg.toO, R);
    const redundant = toPeri != null && toApo != null && _trajTransferIsRedundant(fromR, toApo, toPeri, toApo);
    const arcToR = (toApo != null && toPeri != null && Math.abs(toApo - toPeri) > Math.max(1, toApo * 0.001)) ? toApo : toR;
    // Moon-lead orientation (C2): for a leg whose destination is a MOON of
    // this body frame (o.destination present, e.g. LEO->TLC->LLO), orient
    // the apse line so the arrival end lands on that moon's world position
    // AT ARRIVAL TIME rather than the old fixed rotDeg=0 convention.
    const destMoon = leg.toO.destination || null;
    let rotAng = 0, ghostLocal = null;
    if (destMoon && PROG_MOON_ORBITS[destMoon] && PROG_MOON_ORBITS[destMoon].parent === body) {
      const tArrive = leg.metArrive != null ? leg.metArrive : vt;
      // R2: rotation solved in the PLANAR ecliptic (arc geometry lives there);
      // marker/ghost positions project through the pass camera.
      const arrTheta = progBodyAngleAt(destMoon, tArrive);
      const rL = PROG_MOON_ORBITS[destMoon].r * scale;
      rotAng = _trajArcRotationForTarget(0, 0, rL * Math.cos(arrTheta), rL * Math.sin(arrTheta)); // planar
      const aq = _trajProjLocal(rL * Math.cos(arrTheta), rL * Math.sin(arrTheta));
      const arrLocal = { x: ox + aq.x, y: oy + aq.y };
      const viewTheta = progBodyAngleAt(destMoon, vt);
      const vq = _trajProjLocal(rL * Math.cos(viewTheta), rL * Math.sin(viewTheta));
      if (Math.hypot(vq.x - aq.x, vq.y - aq.y) > 3) ghostLocal = { p: arrLocal, body: destMoon };
    }
    const arc = _trajArcProjectedPath(fromR, arcToR, scale, rotAng, ox, oy);
    const arcExtentPx = Math.hypot(arc.depX - arc.arrX, arc.depY - arc.arrY) / 2;
    if (_trajCullByExtent(arcExtentPx) || _trajCullRingByDiagonal(arcExtentPx, viewportDiagPx)) return;
    const arcAlpha = emphasized ? 1 : _trajLodOpacity(arcExtentPx, _TRAJ_LOD_WIN.transferArc[0], _trajWindowHi(_TRAJ_LOD_WIN.transferArc[1], viewportDiagPx));
    if (arcAlpha <= 0) return;
    const color = emphasized ? 'var(--accent)' : (leg.color || 'var(--accent2)');
    const strokeW = emphasized ? 1.2 : 0.7;
    const dashAttr = legState === 'planned' ? ` stroke-dasharray="2.5,2"` : '';
    const opacity = (arcAlpha * (emphasized ? 1 : 0.8) * stateAlpha).toFixed(3);
    if (!redundant) {
      const hitArea = leg.authIdx != null ? `<path d="${arc.d}" fill="none" stroke="transparent" stroke-width="8"${clickAttr}/>` : '';
      out += `<path d="${arc.d}" fill="none" stroke="${color}" stroke-width="${strokeW}"${dashAttr} opacity="${opacity}" vector-effect="non-scaling-stroke"${clickAttr}><title>${hoverTitle}</title></path>${hitArea}`;
      _trajBurnMarker(arc.depX, arc.depY, 'up', _trajDvText(leg.dv), _metFmt(leg.met), Object.assign(markerOpts(arcExtentPx), { opacity: stateAlpha }));
      _trajBurnMarker(arc.arrX, arc.arrY, 'down', '', _metFmt(leg.metArrive), Object.assign(markerOpts(arcExtentPx), { opacity: stateAlpha }));
      if (legState === 'current' && hasTOF) {
        const frac = _trajLegPathFraction(leg.met, leg.metArrive - leg.met, vt);
        const dl = _trajArcPointAt(fromR, arcToR, scale, rotAng, 0, 0, frac);
        const dq = _trajProjLocal(dl.x, dl.y);
        out += `<circle cx="${(ox + dq.x).toFixed(2)}" cy="${(oy + dq.y).toFixed(2)}" r="2.2" fill="var(--accent)" stroke="var(--nm-bg)" stroke-width="0.6" vector-effect="non-scaling-stroke"><title>Vehicle position (schematic — linear path fraction, not true orbital speed)</title></circle>`;
      }
    } else {
      _trajBurnMarker(arc.depX, arc.depY, 'up', _trajDvText(leg.dv), _metFmt(leg.met), Object.assign(markerOpts(arcExtentPx), { opacity: stateAlpha }));
    }
    if (ghostLocal) out += _trajGhostMarker(ghostLocal.p.x, ghostLocal.p.y, ghostLocal.body, zoom, arcAlpha * stateAlpha);
  });

  // ── P3: SOI departure spurs — an interplanetary injection leg lives in the
  // SUN frame's leg list (frameId 'Sun'), so the departure body's own local
  // frame previously showed nothing for it. Draw the escape hyperbola from
  // the parking ring out to the SOI edge, outgoing asymptote along the
  // departure body's heliocentric velocity (prograde for outbound/superior
  // destinations, retrograde for inbound). Embedded body-frame content: this
  // runs INSIDE _trajBodyFrameContent so it inherits the body's zoiAlpha from
  // the caller's <g opacity> wrapper (one fade authority); its own extent
  // LOD-gates through the transferArc window inside _trajEscapeSpurSVG.
  if (!isSun && PROG_HELIO_R[body] != null && frames['Sun'] && typeof physBodyStateAt === 'function') {
    (frames['Sun'].legs || []).forEach(sleg => {
      const toO = sleg.toO;
      if (!toO || toO.type !== 'transit' || toO.body !== 'Sun') return;
      if ((toO.departure_body || 'Earth') !== body) return;
      const dest = toO.destination;
      if (!dest || PROG_HELIO_R[dest] == null || !(toO.c3 > 0)) return;
      const rp = _trajLocalRadius(sleg.fromO, body);
      if (rp == null) return;
      const emphasized = selAuthIdx != null && sleg.authIdx === selAuthIdx;
      const tDep = sleg.met != null ? sleg.met : 0;
      const vDep = physBodyStateAt(body, tDep).v;
      const outbound = PROG_HELIO_R[dest] > PROG_HELIO_R[body];
      const farAng = Math.atan2(outbound ? vDep[1] : -vDep[1], outbound ? vDep[0] : -vDep[0]);
      // leg state: the spur is flown right after the (impulsive) injection
      // burn; it dims to history once the transit has fully arrived (clip
      // time from the propagated leg when available).
      const physLegD = (typeof physMissionLeg === 'function' && sleg.authIdx != null) ? physMissionLeg(id, sleg.authIdx) : null;
      const clipT = physLegD ? _trajPhysClipT(m, physLegD) : Infinity;
      const legState = vt < tDep ? 'planned' : (isFinite(clipT) && vt >= clipT ? 'history' : 'current');
      const stateAlpha = legState === 'history' ? _TRAJ_HISTORY_ALPHA : 1;
      const dashAttr = legState === 'planned' ? ' stroke-dasharray="2.5,2"' : '';
      const title = `${sleg.vehName ? sleg.vehName + ' — ' : ''}${sleg.fromLabel} → ${sleg.toLabel} — escape hyperbola to ${body} SOI`;
      const spur = _trajEscapeSpurSVG(body, rp, toO.c3, farAng, false, zoom, ox, oy, viewportDiagPx,
        { emphasized, color: sleg.color, dashAttr, stateAlpha, missionId: id, authIdx: sleg.authIdx, title });
      if (spur && !spur.hidden) {
        out += spur.svg;
        _trajBurnMarker(spur.burn.x, spur.burn.y, 'up', _trajDvText(sleg.dv), _metFmt(tDep),
          { emphasized, authIdx: sleg.authIdx, missionId: id, title, zoom, screenSize: spur.extentPx, opacity: stateAlpha });
      }
    });
  }

  // ── P4: MNODE legs — vector burns live ONLY in the physics side-table
  // (they're not node-map maneuvers, so the schematic extraction never sees
  // them). Rendered UNCONDITIONALLY (no converged gate): a maneuver node's
  // ballistic path IS the content — user-authored intent, drawn wherever it
  // goes. Same _trajPhysLegRender path (continuous multi-frame anchorOf
  // gluing, transferArc LOD window, click selects the MNODE event).
  out += _trajMnodeLegsSVG(m, body, zoom, ox, oy, viewportDiagPx, vt, calib, selAuthIdx, false, oDepth);

  // surface events (fixed-px marker + LOD-gated label, like burn markers)
  sc.surface.forEach(s => {
    const ang = s.kind === 'launch' ? -90 : 90; // launch at top, landing at bottom of disc — schematic
    const rad = ang * Math.PI / 180;
    const bodyPxR = Math.max(4, R * scale * 0.02);
    const x = ox + bodyPxR * Math.cos(rad), y = oy + bodyPxR * Math.sin(rad);
    const dy = s.kind === 'launch' ? -5 : 10;
    const marker = `<circle cx="0" cy="0" r="1.6" fill="var(--accent3)" pointer-events="none"/>`;
    _trajRegisterLabel(x, y, [{ text: s.label, dy, fontPx: 10, color: 'var(--accent3)' }], 'burn',
      { screenSize: Infinity, minSize: 0, selected: false, marker });
  });

  // R6.1: passive flight-plan event nodes — every other log event that
  // resolves to geometry (see _trajEventNodesSVG for the exact type/tier
  // rules). Runs last so tier-(a) leg lookups see the fully-populated
  // physics side-table and tier-(b) ring matches see this frame's `sc`.
  _trajEventNodesSVG(body, m, scale, zoom, ox, oy, id, selAuthIdx);

  return out;
}

function _trajDvText(dv) {
  return dv ? Math.round(dv).toLocaleString() + ' m/s' : '';
}

// Body-centered radius (km, including body R) for a node-map orbit spec, in
// the given body's local frame. Returns null if the orbit isn't in this
// body's local frame (e.g. a transit/escape leg that belongs to a different frame).
function _trajLocalRadius(o, body) {
  if (!o) return null;
  if (o.type === 'transit') {
    if (o.destination) {
      const mo = PROG_MOON_ORBITS[o.destination];
      if (mo && mo.parent === body) return mo.r; // parent-frame view (Earth): moon's orbital radius
      // C2 fix: a transit whose DESTINATION is `body` itself (e.g. body ===
      // 'Moon', o.destination === 'Moon') is the ARRIVING end drawn in the
      // destination's OWN frame — this is a patched-conic seam (the true
      // departure point is hyperbolic-relative-to-the-moon, not a finite
      // body-centered radius). Schematic fallback: draw from the moon's own
      // SOI-scale edge (a fixed multiple of its radius) down to the arrival
      // orbit, same spirit as a Hohmann-arc placeholder for the un-modeled
      // hyperbolic approach leg. This is what lets the TLC->LLO leg actually
      // render in the Moon frame (previously silently dropped — fromR was
      // always null here, so the leg never drew at all).
      if (o.destination === body) {
        // Bug fix (C2 review): this was `R*20` (a fixed multiple of the
        // MOON's own body radius, ~34,748 km for the Moon) — a value with NO
        // relationship to the actual departure-arrival gap the arc has to
        // span. That made the leg's drawn extent (and therefore its
        // _TRAJ_LOD_WIN.transferArc gate, evaluated in real screen px) a
        // function of camera zoom alone: at Moon anchor the camera is zoomed
        // in tight enough that even this tiny schematic radius reads as a
        // large arc; at Earth anchor (zoomed out to frame the whole
        // Earth-Moon gap) the SAME arc collapses under the window's 10px
        // floor and the leg silently vanished — even though its parent
        // frame's mirror leg (Earth's LEO->TLC, which correctly uses the
        // FULL mo.r orbital radius as its far endpoint) rendered fine at the
        // same zoom. Fix: scale the SOI-fallback radius off the moon's own
        // orbital radius (mo.r, the same quantity the parent-frame leg above
        // already uses) rather than the moon's body radius, so the two ends
        // of this cross-frame leg agree on the physical scale of the gap
        // they're schematically bridging — the arc's drawn extent is then
        // consistent (and correctly LOD-gated on its OWN screen extent,
        // per the one-fade-authority rule) at any camera anchor. Fraction
        // (0.5) picked so the arc's drawn extent clears the transferArc
        // window's 10px floor with headroom at typical Earth-fit zoom
        // (verified in-browser: ~19px vs. the 10px floor, up from ~4-8px
        // with smaller fractions/the old R*20 fallback).
        const mo2 = PROG_MOON_ORBITS[body];
        const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 1;
        return mo2 ? Math.max(R * 2, mo2.r * 0.5) : R * 20; // schematic SOI-edge radius, not a physical Hill-sphere calc
      }
    }
    return null;
  }
  if (o.body !== body) return null;
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  if (o.type === 'surface') return R;
  const peri = o.perigee ?? o.apogee ?? 0, apo = o.apogee ?? o.perigee ?? 0;
  return R + (peri + apo) / 2; // transfer endpoints use mean radius as departure/arrival point
}

// Schematic angle for a planet in the Sun frame, matching the OLD sun-scene
// layout (index order in PROG_HELIO_R, spread evenly) — kept in sync so
// transfer arcs originate at the visually-drawn ring position. NOTE: this is
// ONLY used for interplanetary transfer arc rotation, not for the planet's
// actual drawn position any more (that now comes from progBodyWorldPos —
// real ephemeris since R1).
function _trajPlanetAngle(body) {
  const bodies = Object.keys(PROG_HELIO_R);
  const i = bodies.indexOf(body);
  if (i < 0) return 0;
  return (i / bodies.length) * 360 - 90;
}

// ── C1a: view time (kept) ──────────────────────────────────────────────────
// Seconds-since-epoch used to place body glyphs. Mirrors the state panel's
// "state AS OF this event" semantics (_missionSelectedEventSnapshotEntry,
// 570): selected event's post-event time (metStart + durationUsed), else
// mission end (m._metTotal), else 0. Guards NaN/undefined.
//
// SCRUBBER INTEGRATION (backlog: scrubbable MET): a manual scrub is a
// SESSION-ONLY override (never authored/autosaved, same spirit as the
// camera) keyed by missionId, checked FIRST — this is the single authority
// downstream rendering reads (Earth rotation, vehicle dots, countdown chips,
// ghost markers all go through _trajViewTime, so scrubbing one place moves
// all of them). Selecting a log event (_trajSelectEventFromView) or the 570
// state-panel event list CLEARS the override so "state as of event" regains
// control, per the "integrate, don't add a second authority" brief.
let _trajViewTimeOverride = {};
function _trajViewTime(m) {
  if (!m) return 0;
  const ov = _trajViewTimeOverride[m.missionId];
  if (typeof ov === 'number' && isFinite(ov)) return ov;
  const sel = (typeof _missionSelectedEventSnapshotEntry === 'function') ? _missionSelectedEventSnapshotEntry(m) : null;
  if (sel && sel.entry) {
    const ms = sel.entry.metStart, du = sel.entry.durationUsed;
    if (typeof ms === 'number' && !isNaN(ms)) {
      const t = ms + (typeof du === 'number' && !isNaN(du) ? du : 0);
      if (!isNaN(t)) return t;
    }
  }
  if (typeof m._metTotal === 'number' && !isNaN(m._metTotal)) return m._metTotal;
  return 0;
}

// Mission-wide MET ceiling for the scrubber's range: max of the replay total
// and every log entry's own (metStart + durationUsed) — a mission with a
// still-open final coast can have log entries past m._metTotal in rare cases,
// so take the max rather than trusting either alone. Floors at 60s so a
// brand-new mission still shows a usable (if trivial) track.
function _trajMissionMaxMet(m) {
  if (!m) return 60;
  let max = (typeof m._metTotal === 'number' && isFinite(m._metTotal)) ? m._metTotal : 0;
  (m.log || []).forEach(e => {
    if (!e || typeof e.metStart !== 'number' || !isFinite(e.metStart)) return;
    const du = typeof e.durationUsed === 'number' && isFinite(e.durationUsed) ? e.durationUsed : 0;
    max = Math.max(max, e.metStart + du);
  });
  return Math.max(max, 60);
}

// Pure ladder pick for tick/nudge spacing — the ONLY math in this feature
// pinned by the test gate. Picks the FINEST rung (smallest interval) whose
// tick count over `tofS` is <= 8, so a leg lands in the ~3-8 ticks band
// (a leg just past a rung boundary gets the next-coarser rung, by design —
// see _trajTickIntervalS's own header for the tradeoff).
const _TRAJ_TICK_LADDER = [60, 600, 3600, 6 * 3600, 86400, 10 * 86400, 100 * 86400];
function _trajTickIntervalS(tofS) {
  if (!(tofS > 0)) return _TRAJ_TICK_LADDER[0]; // invalid/degenerate -> finest rung (never used to draw, defensive default)
  if (tofS === Infinity) return _TRAJ_TICK_LADDER[_TRAJ_TICK_LADDER.length - 1]; // unbounded span -> coarsest rung
  for (const step of _TRAJ_TICK_LADDER) {
    if (tofS / step <= 8) return step;
  }
  return _TRAJ_TICK_LADDER[_TRAJ_TICK_LADDER.length - 1];
}

// Short relative-duration text for countdown chips ("2d 03h", "45m") — no
// "T+" prefix (that's _metFmt's job for absolute MET); always non-negative,
// caller decides "in"/"passed ... ago" framing from the sign of the delta.
function _trajDurText(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const days = Math.floor(sec / 86400), hrs = Math.floor((sec % 86400) / 3600), mins = Math.floor((sec % 3600) / 60);
  if (days >= 1) return `${days}d ${String(hrs).padStart(2, '0')}h`;
  if (hrs >= 1) return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  return `${mins}m`;
}

// Sets the scrub override and refreshes both layers via the existing
// camera-refresh path (_trajApplyCam already rebuilds g.traj-scene from
// _trajWorldSVG, which reads _trajViewTime internally — no separate repaint
// path needed for view-time changes).
function _trajSetViewTime(id, t, maxMet) {
  const clamped = Math.max(0, maxMet != null ? Math.min(maxMet, t) : t);
  _trajViewTimeOverride[id] = clamped;
  _trajApplyCam(id, _trajCam(id));
}

// ── SVG builder (WORLD layer — geometry only, ONE PASS, C1b) ──────────────
// The single render function replacing _trajSunSceneSVG/_trajBodySceneSVG/
// _trajSceneGeomSVG. Draws EVERY body (Sun, planets, moons) each call,
// positioned by progBodyWorldPos(body, viewTime) minus the camera's floating
// origin (_trajCamCenterKm), plus every body's embedded mission content.
// `cam` = {anchorBody, relOffsetKm, wKm}; `zoom` = _TRAJ_VB/cam.wKm;
// `rect` = the world svg's measured bounding rect (for viewport-diagonal
// culling — falls back to a square guess pre-mount).
// R6.4c: textured globes are collected here during the render pass and then
// reconciled into a PERSISTENT sibling <g class="traj-globe-layer"> (behind
// traj-scene) by _trajReconcileGlobeLayer. Reason: _trajApplyCam rebuilds
// g.traj-scene via innerHTML EVERY rotate frame, which destroys any inline
// <image> and forces the browser to async-decode the new data-URI on a fresh
// node — a blank frame until decode completes (the R6.4b per-frame re-raster
// turned this into constant flicker). Updating a persistent node's href in
// place keeps the previous bitmap painted until the new one decodes → no gap.
let _trajPendingGlobes = [];
function _trajWorldSVG(m, cam, zoom, rect) {
  _trajPendingGlobes = [];
  const viewT = _trajViewTime(m);
  const calib = null;      // R1: planet-phase calibration retired (real ephemeris)
  const overrides = {};    // kept for downstream signature stability; ignored by the alias
  const camCenter = _trajCamCenterKm(cam, viewT, overrides); // heliocentric km — the ONE floating-origin subtraction point
  const rectW = (rect && rect.width > 0) ? rect.width : 400, rectH = (rect && rect.height > 0) ? rect.height : 400;
  const viewportDiagPx = Math.sqrt(rectW * rectW + rectH * rectH);

  // R2: arm the pass projection context — EVERY emission below (positions,
  // rings, arcs, spurs, physics samples, grid) projects through it.
  _trajProjCtx = { az: cam.az || 0, el: cam.el != null ? cam.el : Math.PI / 2,
    frameKind: (m && typeof _trajFrame === 'function') ? _trajFrame(m.missionId) : 'inertial',
    frameBody: cam.anchorBody, viewT };
  const tilt = Math.PI / 2 - _trajProjCtx.el;

  // World-to-render: heliocentric km -> PROJECTED render units (floating
  // origin, 3D camera rotation, then ×zoom so the emitted coordinate space is
  // always ~viewBox-sized — the software-rasterizer precision discipline).
  // Carries `depth` (km, camera view axis) for painter sorting.
  const toRender = (worldX, worldY, worldZ) => {
    const p = _trajProj3(worldX - camCenter.x, worldY - camCenter.y, (worldZ || 0) - camCenter.z);
    return { x: p.x * zoom, y: p.y * zoom, depth: p.depth };
  };

  // R2 painter records: {depth, svg}. Rings/grid use -Infinity (always behind
  // glyphs — a ring spans all depths, exact painter order is undefined for it
  // anyway); bodies use their projected center depth. STABLE sort keeps the
  // pre-R2 layering as the tiebreak at el=90° where depths degenerate.
  const records = [];
  const emit = (depth, svg) => { if (svg) records.push({ depth, svg }); };

  // R6.5: occlusion pre-pass — collect every opaque body disc drawn THIS
  // frame (disc tier only, trueRpx >= _TRAJ_FEATURE_PX — chips/small discs
  // don't occlude) BEFORE any ring/leg content is emitted below, so the
  // occlusion test is order-independent (a ring embedded at body A can be
  // correctly occluded by body B regardless of which is iterated first).
  // Sun excluded: its glyph here (_trajGlyph) is a fixed schematic marker,
  // never a true-scale rendered sphere, so it isn't a meaningful occluder.
  _trajOccludeBodies = [];
  Object.keys(PROG_HELIO_R).forEach(body => {
    const wp = progBodyWorldPos(body, viewT);
    const p = toRender(wp.x, wp.y, wp.z);
    if (_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) return;
    const trueR = _trajTrueBodyRadiusKm(body);
    if (trueR * zoom >= _TRAJ_FEATURE_PX) _trajOccludeBodies.push({ name: body, cx: p.x, cy: p.y, depth: p.depth, R: trueR });
  });
  Object.keys(PROG_MOON_ORBITS || {}).forEach(name => {
    const wp = progBodyWorldPos(name, viewT);
    const p = toRender(wp.x, wp.y, wp.z);
    if (_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) return;
    const trueR = _trajTrueBodyRadiusKm(name);
    if (trueR * zoom >= _TRAJ_FEATURE_PX) _trajOccludeBodies.push({ name, cx: p.x, cy: p.y, depth: p.depth, R: trueR });
  });

  // (R6.4d) Ecliptic reference grid removed — its concentric rings read as
  // stray "orbits" and, since R6.4c moved globes to a behind-layer, drew over
  // the planet when tilted. Camera tilt is legible from the bodies/orbits
  // themselves; the grid added clutter without orientation value.

  // ── true-geometry orbit ring (R2): sampled real ellipse, projected ────────
  // centerP = the PRIMARY's projected render position; el = orbit elements.
  // R6.5: occlusion-split (a planet/moon ring's far side hides behind another
  // drawn body — the pre-pass above makes this order-independent) + Pe/Ap
  // apse markers (distance in AU for heliocentric rings, raw km — center-to-
  // body distance, not altitude — for moon rings; see MATH.md §7m).
  const trueRingPath = (el, centerP, alphaStr, color, apseMode) => {
    const pts = progOrbitSamplePoints(el, 120);
    const rendered = [];
    let periIdx = 0, apoIdx = 0, periR = Infinity, apoR = -Infinity;
    for (let k = 0; k < pts.length; k++) {
      const q = _trajProj3(pts[k][0], pts[k][1], pts[k][2]);
      const x = centerP.x + q.x * zoom, y = centerP.y + q.y * zoom;
      if (!isFinite(x) || !isFinite(y)) return '';
      rendered.push({ x, y, depth: centerP.depth + q.depth });
      const rLocal = Math.hypot(pts[k][0], pts[k][1], pts[k][2]);
      if (rLocal < periR) { periR = rLocal; periIdx = k; }
      if (rLocal > apoR) { apoR = rLocal; apoIdx = k; }
    }
    const runs = _trajOcclusionSplitRuns(rendered, zoom, _trajOccludeBodies);
    let d = '';
    runs.forEach(run => { d += (d ? ' ' : '') + run.map((p, k) => (k ? 'L ' : 'M ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' '); });
    if (apseMode) {
      const periPt = rendered[periIdx], apoPt = rendered[apoIdx];
      if (!_trajPointOccluded(periPt.x, periPt.y, periPt.depth, zoom, _trajOccludeBodies)) {
        _trajRegisterLabel(periPt.x, periPt.y, [{ text: 'Pe', dy: -6, fontPx: 8.5, color }, { text: _trajFmtApseDist(periR, apseMode), dy: 4, fontPx: 8, color: 'var(--text-dim)' }],
          'orbit', { screenSize: apoR * zoom, minSize: _TRAJ_LOD_RING_MIN, opacity: parseFloat(alphaStr) / 0.55 || 0, marker: `<path d="M -2.4 2 L 0 -2.4 L 2.4 2 Z" fill="${color}" stroke="none"/>` });
      }
      if (!_trajPointOccluded(apoPt.x, apoPt.y, apoPt.depth, zoom, _trajOccludeBodies)) {
        _trajRegisterLabel(apoPt.x, apoPt.y, [{ text: 'Ap', dy: -6, fontPx: 8.5, color }, { text: _trajFmtApseDist(apoR, apseMode), dy: 4, fontPx: 8, color: 'var(--text-dim)' }],
          'orbit', { screenSize: apoR * zoom, minSize: _TRAJ_LOD_RING_MIN, opacity: parseFloat(alphaStr) / 0.55 || 0, marker: `<path d="M -2.4 -2 L 0 2.4 L 2.4 -2 Z" fill="${color}" stroke="none"/>` });
      }
    }
    if (!d) return '';
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="0.6" opacity="${alphaStr}" vector-effect="non-scaling-stroke"/>`;
  };

  // ── Sun (drawn unless off-screen — the heliocentric origin) ───────────────
  {
    const p = toRender(0, 0, 0);
    if (!_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) {
      const sunScale = _trajLocalScaleFor('Sun', m) * zoom; // km -> render units
      let s = _trajGlyph(p.x, p.y, _trajBodyPxR(6, zoom), _trajBodyColor('Sun'), 'Sun', zoom, cam.anchorBody === 'Sun', false, m && m.missionId);
      s += _trajBodyFrameContent('Sun', m, sunScale, zoom, p.x, p.y, viewportDiagPx, viewT, overrides, calib, p.depth);
      emit(p.depth, s);
    }
  }

  // ── planets: TRUE heliocentric orbit + glyph + embedded mission content ───
  Object.keys(PROG_HELIO_R).forEach(body => {
    const worldR = PROG_HELIO_R[body]; // mean radius — LOD/culling only; drawing is true-geometry
    const ringScreenR = worldR * zoom;
    const sunP = toRender(0, 0, 0);
    const sunOffscreen = _trajCullPositionOffscreen(sunP.x, sunP.y, viewportDiagPx);
    const ringAlpha = _trajLodOpacity(ringScreenR, _TRAJ_LOD_WIN.heliocentricRing[0], _trajWindowHi(_TRAJ_LOD_WIN.heliocentricRing[1], viewportDiagPx));
    if (!sunOffscreen && !_trajCullRingByDiagonal(ringScreenR, viewportDiagPx) && ringAlpha > 0) {
      const oel = progBodyOrbitElementsAt(body, viewT);
      // V1 line restyle: heliocentric background rings are reference geometry,
      // not an active trajectory — thin desaturated near-white, not body color.
      if (oel) emit(-1e17, trueRingPath(oel, sunP, (0.4 * ringAlpha).toFixed(3), 'rgba(255,255,255,0.4)', 'au'));
    }
    const wp = progBodyWorldPos(body, viewT);
    const p = toRender(wp.x, wp.y, wp.z);
    if (_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) return;
    const trueR = _trajTrueBodyRadiusKm(body); // R6.2: real physical radius (was schematic 3)
    const trueRpx = trueR * zoom;
    // "Far representation" (C2): the NAME label is force-eligible whenever the
    // disc has hit its min-px clamp — all planets keep names at solar zoom.
    const forceLabel = trueRpx < _TRAJ_MIN_BODY_PX;
    let s = '';
    if (!_trajCullByExtent(_trajBodyPxR(trueR, zoom))) {
      // R6.2 defect3: body->Sun direction as a WORLD-frame unit 3-vector (not
      // a 2D screen angle) — the terminator math needs the real camera-depth
      // component (zc_sun), which a screen-space atan2 of two already-
      // projected points can't recover.
      const sunLen = Math.hypot(wp.x, wp.y, wp.z) || 1;
      const sunDir3 = [-wp.x / sunLen, -wp.y / sunLen, -wp.z / sunLen];
      s += _trajBodyDiscTiered(p.x, p.y, trueRpx, _trajBodyColor(body), body, zoom, cam.anchorBody === body, forceLabel, m && m.missionId, viewT, sunDir3, viewportDiagPx);
      // R6.3: site marker + mock ascent path — only meaningful once the disc is
      // surfaced (same LOD tier as coastlines) and only for Earth (the only
      // body missions currently launch from).
      if (body === 'Earth' && trueRpx >= _TRAJ_SURFACE_PX && m) {
        s += _trajLaunchSiteAndAscentSVG(m, p.x, p.y, trueRpx, viewT, viewportDiagPx);
      }
    }
    // Zone-of-influence content: single fade authority for everything embedded
    // at this body (moons in the next pass share the same gate via zoiAlpha).
    const localScale = _trajLocalScaleFor(body, m) * zoom; // km -> render units
    const neighborhoodExtentPx = _trajBodyPxR(trueR, zoom);
    const zoiAlpha = _trajLodOpacity(Math.max(neighborhoodExtentPx, _trajBodyNeighborhoodPx(body, zoom, m)), _TRAJ_LOD_WIN.zoneOfInfluence[0], Infinity);
    if (zoiAlpha > 0) {
      const contentSvg = _trajBodyFrameContent(body, m, localScale, zoom, p.x, p.y, viewportDiagPx, viewT, overrides, calib, p.depth);
      s += zoiAlpha < 1 ? `<g opacity="${zoiAlpha.toFixed(3)}">${contentSvg}</g>` : contentSvg;
    }
    // R3.5.2: escape (multi-frame) MNODE legs must survive heliocentric zoom —
    // cross-fade them back in as the zone-of-influence content fades out.
    if (zoiAlpha < 1 && m) {
      const escSvg = _trajMnodeLegsSVG(m, body, zoom, p.x, p.y, viewportDiagPx, viewT, calib, _trajSelectedAuthIdx(m), true, p.depth);
      if (escSvg) s += `<g opacity="${(1 - zoiAlpha).toFixed(3)}">${escSvg}</g>`;
    }
    emit(p.depth, s);
  });

  // ── moons: TRUE orbit around parent + glyph, embedded mission content ─────
  Object.entries(PROG_MOON_ORBITS || {}).forEach(([name, mo]) => {
    const parentWP = progBodyWorldPos(mo.parent, viewT);
    const parentP = toRender(parentWP.x, parentWP.y, parentWP.z);
    const parentOffscreen = _trajCullPositionOffscreen(parentP.x, parentP.y, viewportDiagPx);
    const ringScreenR = mo.r * zoom;
    // Moon ring is part of its PARENT's zone-of-influence (single fade authority).
    const parentZoiAlpha = _trajLodOpacity(Math.max(ringScreenR, _trajBodyPxR(3, zoom)), _TRAJ_LOD_WIN.zoneOfInfluence[0], Infinity);
    if (!parentOffscreen && !_trajCullRingByDiagonal(ringScreenR, viewportDiagPx) && !_trajCullByExtent(ringScreenR) && parentZoiAlpha > 0) {
      const oel = progBodyOrbitElementsAt(name, viewT);
      // V1 line restyle: same reasoning as the heliocentric ring above.
      if (oel) emit(-1e17, trueRingPath(oel, parentP, (0.4 * parentZoiAlpha).toFixed(3), 'rgba(255,255,255,0.4)', 'km'));
    }
    if (parentZoiAlpha <= 0) return; // moon (and its content) hidden with its parent's ZOI
    const wp = progBodyWorldPos(name, viewT);
    const p = toRender(wp.x, wp.y, wp.z);
    if (_trajCullPositionOffscreen(p.x, p.y, viewportDiagPx)) return;
    const trueR = _trajTrueBodyRadiusKm(name); // R6.2: real physical radius (was schematic 3)
    const trueRpx = trueR * zoom;
    let s = '';
    if (!_trajCullByExtent(_trajBodyPxR(trueR, zoom))) {
      // R6.2 defect3: same world-frame sun-direction vector as the planet pass.
      const sunLen = Math.hypot(wp.x, wp.y, wp.z) || 1;
      const sunDir3 = [-wp.x / sunLen, -wp.y / sunLen, -wp.z / sunLen];
      const glyphSvg = _trajBodyDiscTiered(p.x, p.y, trueRpx, _trajBodyColor(name), name, zoom, cam.anchorBody === name, false, m && m.missionId, viewT, sunDir3, viewportDiagPx);
      s += parentZoiAlpha < 1 ? `<g opacity="${parentZoiAlpha.toFixed(3)}">${glyphSvg}</g>` : glyphSvg;
    }
    const localScale = _trajLocalScaleFor(name, m) * zoom; // km -> render units
    const contentSvg = _trajBodyFrameContent(name, m, localScale, zoom, p.x, p.y, viewportDiagPx, viewT, overrides, calib, p.depth);
    s += parentZoiAlpha < 1 ? `<g opacity="${parentZoiAlpha.toFixed(3)}">${contentSvg}</g>` : contentSvg;
    emit(p.depth, s);
  });

  // painter: back-to-front (ascending depth), STABLE — emission order is the
  // tiebreak, preserving pre-R2 layering at el=90° where depths degenerate.
  return records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.depth - b.r.depth) || (a.i - b.i))
    .map(x => x.r.svg)
    .join('');
}

// A body's "neighborhood" radius in km — the ONE definition shared by the
// fly-to fit and the zone-of-influence LOD gate, so any camera that frames a
// body's content also opens the gate that draws it. (They were separate
// definitions before: the gate counted only moon rings, so moonless planets'
// mission content NEVER rendered at any zoom — MATH.md critique 26, fixed.)
function _trajBodyNeighborhoodKm(body, m) {
  const moons = _trajMoonsOf(body);
  const moonR = moons.length ? Math.max(...moons.map(mo => mo.r)) : 0;
  const contentR = m ? _trajMissionExtentForBody(body, m) : 0;
  const R = (PROG_BODIES[body] && PROG_BODIES[body].R) || 0;
  return Math.max(moonR, contentR, R * 4);
}

function _trajBodyNeighborhoodPx(body, zoom, m) {
  return _trajBodyNeighborhoodKm(body, m) * (zoom || 1);
}

// Local px-per-km scale for a body's embedded mission content (its own orbit
// rings / transfer arcs), independent of the camera zoom. This mirrors the
// OLD per-scene `_trajFitScale` concept: content is drawn true-scale-in-km at
// scale=1 relative to the world (the camera zoom does the rest), EXCEPT that
// small bodies (planets/moons with real orbit rings measured in hundreds to
// tens-of-thousands of km) need their mission content legible without
// requiring the user to zoom to literal 1:1 — so each body gets a fixed
// local multiplier sized to its own characteristic scale (its radius), same
// spirit as the old fit-to-content scale but now purely a per-body constant
// since there's no single "active scene" to fit anymrore. Chosen so a LEO
// ring (a few hundred km above a body of a few thousand km radius) renders
// at a legible fraction of that body's disc when the camera is zoomed to
// frame the body itself.
function _trajLocalScaleFor(body, m) {
  return 1; // true-scale km; camera zoom alone determines rendered size (matches "linear true scale — no log compression of distances" invariant)
}

// ── glyph + px-clamp helpers (world layer) ────────────────────────────────
// Body/planet glyph: disc only (world layer). `cx,cy` are RENDER-SPACE
// (floating-origin) coords; `r` is a WORLD-space (km) radius as computed by
// the caller; screen-space min-visibility clamp is applied by the caller via
// _trajBodyPxR (so the clamp only bites when zoomed OUT — zooming in lets
// the true-scale disc grow past the clamp). Label registration (overlay
// layer) happens alongside, keyed to the same render-space anchor.
// `forceLabel` (C2 "far representation" fix): when true, the label is
// registered with selected:true semantics for its SIZE gate (always
// eligible) regardless of the disc's screenSize — this is how all 9 planet
// names stay visible at full solar zoom-out once their neighborhood content
// has faded away and they're reduced to glyph+name. The disc itself is
// UNAFFECTED (still true-scale/min-clamped as before) — this only changes
// whether the NAME survives the size gate; collision resolution still runs
// normally (so crowded labels at extreme zoom still de-duplicate).
// Click a body glyph to anchor the camera on it (fly-to) — guarded against
// the click that ends a real drag, same pattern as _trajSelectEventFromView.
function trajGlyphClick(id, body) {
  if (_trajJustDragged) { _trajJustDragged = false; return; }
  // Round 2 item 3(a): with a gizmo open on this mission, a body-glyph click
  // sets that body as the gizmo's closest-approach TARGET instead of
  // recentering the camera (the dismiss handler already ignores clicks on
  // .traj-body-glyph so the gizmo stays open for this).
  if (typeof _trajGizmo !== 'undefined' && _trajGizmo && _trajGizmo.missionId === id) {
    if (typeof _trajGizmoSetManualTarget === 'function') _trajGizmoSetManualTarget(body);
    return;
  }
  trajSetFocus(id, body);
}

function _trajGlyph(cx, cy, r, color, label, zoom, isFocus, forceLabel, clickId) {
  // Body name inherits the body's own chrome color (theme var) so labels read
  // as belonging to their glyph rather than a flat gray sheet of names.
  _trajRegisterLabel(cx, cy - r, [{ text: label, dy: -4, fontPx: 10, color: color || 'var(--nm-label)' }], 'body',
    { screenSize: r, minSize: _TRAJ_LOD_BODY_MIN, selected: !!isFocus || !!forceLabel });
  const clickAttr = clickId ? ` class="traj-body-glyph" style="cursor:pointer" onclick="trajGlyphClick('${clickId}','${label}')"` : '';
  if (clickId) {
    return `<g${clickAttr}>
    <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r}" fill="${color}" stroke="var(--border-bright)" stroke-width="0.5" vector-effect="non-scaling-stroke"><title>Fly to ${label}</title></circle>
    <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${Math.max(r, 7)}" fill="transparent"/>
  </g>`;
  }
  return `<g>
    <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r}" fill="${color}" stroke="var(--border-bright)" stroke-width="0.5" vector-effect="non-scaling-stroke"/>
  </g>`;
}

// Minimum on-screen disc radius (px) a body should ever render at, converted
// to WORLD-space svg units by dividing by zoom (so after the viewBox camera's
// zoom, the rendered px is >= _TRAJ_MIN_BODY_PX). This clamp is legitimately
// world-layer: it's a size floor on GEOMETRY (the disc itself), computed from
// the camera's pxPerUnit, not a counter-scaled annotation. True-scale discs
// bigger than this pass through unclamped (e.g. zoomed into LEO, Earth's limb
// stays huge and real).
const _TRAJ_MIN_BODY_PX = 6;
// Returns the disc radius in RENDER UNITS (km·zoom ≈ px): true-scale when
// zoomed in, clamped to the min-px floor when zoomed out. (Pre-normalization
// this returned km and callers multiplied by zoom for px math.)
function _trajBodyPxR(trueR, zoom) {
  const z = zoom || 1;
  return Math.max(trueR * z, _TRAJ_MIN_BODY_PX);
}

// ── R6.2: planetary surface rendering + body LOD ladder ────────────────────
// Three tiers by TRUE (unclamped) apparent screen radius (trueR_km * zoom):
//   >= _TRAJ_SURFACE_PX : surfaced disc — base color + coastlines/maria/region
//                          ellipses/cloud bands + a limb-darkening overlay.
//   >= _TRAJ_CHIP_PX     : plain clamped disc (pre-existing behavior, unchanged
//                          — _trajBodyPxR's Math.max floor already holds a
//                          CONSTANT _TRAJ_MIN_BODY_PX screen size as trueR*zoom
//                          shrinks below the floor).
//   <  _TRAJ_CHIP_PX      : symbol chip — constant-radius outlined circle +
//                          astronomical glyph (deep zoom-out, e.g. heliocentric).
// Cross-fade is NOT implemented (a clean pop at each threshold, per spec).
const _TRAJ_SURFACE_PX = 24;
const _TRAJ_CHIP_PX = 2;
const _TRAJ_CHIP_R = 7; // constant screen radius (px/render-unit) for the chip tier
// R6.2.1: middle plain-disc tier removed (flight-test item 2) — the surfaced
// disc now renders all the way down to the chip threshold. Below this radius
// (px) the surfaced disc skips vector feature sampling (base fill + limb
// gradient only — visually indistinguishable at that size, and keeps the
// per-point path-string cost bounded at small sizes).
const _TRAJ_FEATURE_PX = 14;

// Astronomical glyphs — reuses the same symbols as the Orbits page destination
// picker (060-orbit-categories.js ORBIT_CATEGORIES icons) for Earth/Moon/Mars/
// Venus/Mercury/Jupiter/Saturn/Uranus/Neptune so a body reads the same symbol
// everywhere in the app; Sun/Titan added here (no picker entry exists for them).
const _TRAJ_BODY_GLYPH = {
  Sun: '☉', Mercury: '☿', Venus: '♀', Earth: '⊕', Moon: '☽',
  Mars: '♂', Jupiter: '♃', Saturn: '♄', Uranus: '♅', Neptune: '♆', Titan: 'T',
};

// Body true physical radius (km) for LOD apparent-size math. Sun's value
// (696,000 km, IAU mean) is display-schematic only — the Sun still renders
// through its own plain-glyph path (_trajGlyph), never this ladder.
function _trajTrueBodyRadiusKm(body) {
  if (body === 'Sun') return 696000;
  return (typeof PROG_BODIES !== 'undefined' && PROG_BODIES[body] && PROG_BODIES[body].R) || 3;
}

// lat/lon (deg) -> unit-sphere point in the body's OWN unrotated frame
// (lon measured east from the body's lon=0 meridian, +z = spin axis).
// APPROXIMATION (2026-07-10, presentation layer only — see MATH.md §7g): no
// body's axial tilt is modeled; every spin axis is assumed coincident with
// the ecliptic normal (+z world axis), so this is a simplified top-down
// globe, not a true axial-tilt globe.
function _trajLatLonUnit(latDeg, lonDeg) {
  const lat = latDeg * _PROG_D2R, lon = lonDeg * _PROG_D2R;
  const cl = Math.cos(lat);
  return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
}
// Rotate a unit-sphere body-frame point by spin angle (rad) about the +z
// (ecliptic-normal) axis, giving its WORLD-frame direction.
function _trajSpinRotate(pt, spinRad) {
  const c = Math.cos(spinRad), s = Math.sin(spinRad);
  return [pt[0] * c - pt[1] * s, pt[0] * s + pt[1] * c, pt[2]];
}
// Body spin angle (rad) at mission time viewT_s. Earth/Mars: sidereal
// rotation from viewT with a fixed (uncalibrated — display flavor only, not
// tied to a real prime-meridian epoch) offset of 0. Moon: tidally locked —
// its nearside meridian (lon 0) is kept facing Earth via the Moon's own
// orbital position angle about Earth (+ π, since progBodyAngleAt gives the
// Earth->Moon direction and the nearside must face the opposite way, Moon-
// >Earth). Other bodies: 0 (no vector surface features drawn for them).
function _trajBodySpinAngle(body, viewT_s) {
  const t = viewT_s || 0;
  if (body === 'Earth') return (t / 86164.1) * 2 * Math.PI;
  if (body === 'Mars') return (t / 88642.66) * 2 * Math.PI;
  if (body === 'Moon' && typeof progBodyAngleAt === 'function') return progBodyAngleAt('Moon', t) + Math.PI;
  return 0;
}

// ── §17 N3 — switchable reference frames (pure rendering transform) ────────
// See MATH.md §7x for the full derivation. Frame kinds:
//   'inertial'            — today's rendering, B = null (identity, skipped).
//   'body-fixed'          — B(t) = rotation about the anchor body's spin axis
//                            by its OWN spinAngle(t) (same source the globes
//                            use, _trajBodySpinAngle) — so a surface point's
//                            world position (which is ALSO spin(t)-rotated)
//                            transforms back to its constant body-local
//                            direction: the globe stops turning on screen.
//   'earth-moon-rotating' — B(t) from the Earth->Moon line (_refRotBasisPair,
//                            425; identical math to the N2 wrap/harness).
//   'sun-earth-rotating'  — same construction for the Sun->Earth pair.
// `body` is the frame's ANCHOR (passed from the camera's anchorBody so
// body-fixed knows whose spin to use; earth-moon/sun-earth ignore it — the
// pair is fixed by the frame choice, only the render CENTER varies, and the
// center is already handled by the existing floating-origin camCenter
// subtraction upstream of this transform).
function _trajFrameBasisAt(frameKind, body, t) {
  if (!frameKind || frameKind === 'inertial') return null;
  if (frameKind === 'body-fixed') {
    const a = (typeof _trajBodySpinAngle === 'function') ? _trajBodySpinAngle(body, t) : 0;
    const c = Math.cos(a), s = Math.sin(a);
    return { xh: [c, s, 0], yh: [-s, c, 0], zh: [0, 0, 1] };
  }
  if (frameKind === 'earth-moon-rotating' && typeof _refRotBasisPair === 'function') {
    return _refRotBasisPair('Earth', 'Moon', t);
  }
  if (frameKind === 'sun-earth-rotating' && typeof _refRotBasisPair === 'function') {
    return _refRotBasisPair('Sun', 'Earth', t);
  }
  return null;
}
// q(t) = B(t)^T . pRel(t) — pRel EXPRESSED IN FRAME COORDINATES AT ITS OWN
// EPOCH, fed directly to the camera projector (_trajProjectVec). This is the
// az-convention choice documented in MATH.md §7x: the projector's az/el rotate
// the FRAME's axes, not fixed ecliptic-world axes, when a non-inertial frame
// is active ("the frame rotates the world, the camera stays put"). Because
// B(t) is a pure rotation, this is valid for ANY world-axis-aligned vector
// regardless of what its origin represents (camera-relative body position,
// leg-local sample, or a spin-baked surface direction) — the same one
// function is the whole seam for (a) polyline/ring samples (call with the
// sample's OWN t — this is what closes a rotating-frame-periodic loop live,
// retiring MATH.md critique 64), (b) bodies/markers (called with t=viewT by
// the _trajProj3 default — NOT an identity no-op for non-inertial frames,
// see the §7x critique: a body's frame-coordinates at its own current epoch
// are exactly what makes e.g. the Moon render at a fixed screen direction in
// the Earth-Moon frame), (c) spin-baked surface/globe points (also default
// t=viewT — composes with the SAME spin(t) baked into their world direction,
// exactly cancelling it for body-fixed anchored on that body).
function _trajFrameTransform(frameKind, body, pRel, t) {
  const B = _trajFrameBasisAt(frameKind, body, t);
  if (!B) return pRel;
  return [
    pRel[0] * B.xh[0] + pRel[1] * B.xh[1] + pRel[2] * B.xh[2],
    pRel[0] * B.yh[0] + pRel[1] * B.yh[1] + pRel[2] * B.yh[2],
    pRel[0] * B.zh[0] + pRel[1] * B.zh[1] + pRel[2] * B.zh[2],
  ];
}

// Per-mission transient view state (sibling of _trajCamByMission — NOT
// session-persisted: the camera itself isn't persisted either, so frame
// choice matches that existing pattern, see MATH.md §7x).
let _trajFrameByMission = {};
function _trajFrame(id) { return (_trajFrameByMission[id] && _trajFrameByMission[id].kind) || 'inertial'; }
function trajSetFrame(id, kind) {
  _trajFrameByMission[id] = { kind };
  missionRenderDetail();
}
const _TRAJ_FRAME_KINDS = [
  { id: 'inertial', label: 'Inertial' },
  { id: 'body-fixed', label: 'Body-fixed' },
  { id: 'earth-moon-rotating', label: 'Earth-Moon' },
  { id: 'sun-earth-rotating', label: 'Sun-Earth' },
];
// Project a body-local (already spin-rotated) UNIT direction through the pass
// camera and scale by the disc's screen radius — linear, so this is exactly
// equivalent to projecting the rPx-scaled vector (same seam as _trajProj3).
function _trajSurfacePoint(unitDir, cx, cy, rPx) {
  const q = _trajProj3(unitDir[0], unitDir[1], unitDir[2]);
  return { x: cx + q.x * rPx, y: cy + q.y * rPx, depth: q.depth };
}
// ── R6.2 defect1: exact hemisphere clip (2026-07-11) ────────────────────────
// The old per-vertex "drop back-facing points, keep the front runs joined"
// approach let the SVG fill close each gap with a straight chord THROUGH the
// disc interior (visible as giant wedges, worst pole-on where whole polygons
// straddle the limb). This clips a closed polygon of WORLD-frame unit
// direction vectors (as produced by _trajSpinRotate/_trajLatLonUnit, i.e.
// pre-projection) against the camera's front hemisphere (projected depth >=
// 0), closing every crossed edge exactly ON the limb circle instead of
// cutting inward.
//
// Exactness: depth is a LINEAR function of the input vector (_trajProjectVec
// is a pure rotation), so interpolating the two endpoint UNIT VECTORS in 3D
// by t = za/(za-zb) yields a point whose depth is exactly 0 by construction;
// renormalizing that point to unit length then gives a projected radius of
// exactly 1 (|x,y|^2 + 0^2 = 1) — i.e. it lands exactly on the limb, not an
// approximation of it (accurate at any polygon scale, not just coastlines).
//
// Returns { closed, runs }:
//   closed: true  -> `runs` is a single array holding the ENTIRE input
//                     polygon (every vertex front-facing) — draw with a
//                     plain `Z` close, no limb involved.
//   closed: false -> `runs` is zero or more open chains, each starting and
//                     ending exactly on the limb (or [] if fully back-facing).
function _trajHemiClipRuns(dirs) {
  const n = dirs.length;
  if (!n) return { closed: false, runs: [] };
  const zc = dirs.map(v => _trajProj3(v[0], v[1], v[2]).depth);
  if (zc.every(z => z >= 0)) return { closed: true, runs: [dirs.slice()] };
  if (zc.every(z => z < 0)) return { closed: false, runs: [] };
  const lerpUnit = (i, j, t) => {
    const wx = dirs[i][0] + (dirs[j][0] - dirs[i][0]) * t;
    const wy = dirs[i][1] + (dirs[j][1] - dirs[i][1]) * t;
    const wz = dirs[i][2] + (dirs[j][2] - dirs[i][2]) * t;
    const len = Math.hypot(wx, wy, wz) || 1;
    return [wx / len, wy / len, wz / len];
  };
  const runs = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const za = zc[i], zb = zc[j];
    if (za >= 0) {
      if (!cur) cur = [];
      cur.push(dirs[i]);
      if (zb < 0) { cur.push(lerpUnit(i, j, za / (za - zb))); runs.push(cur); cur = null; }
    } else if (zb >= 0) {
      cur = [lerpUnit(i, j, za / (za - zb))];
    }
  }
  // Wraparound: if the LAST edge crossed back->front, `cur` is left open at
  // loop end — it is the run continuing across the array boundary INTO
  // runs[0] (which necessarily starts at dirs[0] itself, since that crossing
  // is only left open when dirs[0] is front-facing). Splicing it onto the
  // front of runs[0] reunites the two into the single continuous run they
  // actually are, instead of emitting a spurious extra fragment.
  if (cur) { if (runs.length) runs[0] = cur.concat(runs[0]); else runs.push(cur); }
  return { closed: false, runs };
}
// Project a hemisphere-clip result to an SVG path `d`, stitching consecutive
// open runs together with an elliptical arc ALONG THE LIMB (radius rPx)
// instead of a chord — this is what actually kills the chord-wedge artifact.
// Winding-direction disambiguation between the two candidate arcs (short vs
// long way around) is resolved by taking the SHORT arc; at coastline/maria
// polygon scale (item 1a already clips to the disc circle as a safety net
// too) this reads correctly in every case exercised during verification —
// noted here per the brief as the accepted fallback for ambiguous cases.
function _trajClippedRunsToPath(clip, cx, cy, rPx) {
  const { closed, runs } = clip;
  if (!runs.length) return '';
  const proj = v => { const q = _trajProj3(v[0], v[1], v[2]); return { x: cx + q.x * rPx, y: cy + q.y * rPx }; };
  if (closed) {
    const pts = runs[0].map(proj);
    return pts.map((p, k) => (k ? 'L ' : 'M ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ') + ' Z';
  }
  let d = '';
  for (let r = 0; r < runs.length; r++) {
    const pts = runs[r].map(proj);
    d += pts.map((p, k) => ((r === 0 && k === 0) ? 'M ' : 'L ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ') + ' ';
    const nextPts = runs[(r + 1) % runs.length].map(proj);
    const exitPt = pts[pts.length - 1], entryPt = nextPts[0];
    const a0 = Math.atan2(exitPt.y - cy, exitPt.x - cx), a1 = Math.atan2(entryPt.y - cy, entryPt.x - cx);
    let delta = a1 - a0;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    const sweep = delta >= 0 ? 1 : 0;
    d += `A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 0 ${sweep} ${entryPt.x.toFixed(2)} ${entryPt.y.toFixed(2)} `;
  }
  return d + 'Z';
}
// Flat [lon0,lat0,lon1,lat1,...] TENTHS-of-degree polygon (PROG_GEO_EARTH) ->
// an SVG path `d` string, hemisphere-clipped and limb-closed (item defect1).
function _trajGeoPolyPath(lonLatTenths, spinAngle, cx, cy, rPx) {
  const dirs = [];
  for (let i = 0; i < lonLatTenths.length; i += 2) {
    dirs.push(_trajSpinRotate(_trajLatLonUnit(lonLatTenths[i + 1] / 10, lonLatTenths[i] / 10), spinAngle));
  }
  return _trajClippedRunsToPath(_trajHemiClipRuns(dirs), cx, cy, rPx);
}
// PROG_GEO_FEATURES ellipse {lat,lon,rLat,rLon} -> sampled SVG path `d`
// string, same hemisphere-clip/limb-close treatment as the coastline path.
function _trajGeoEllipsePath(feat, spinAngle, cx, cy, rPx) {
  const n = 20;
  const lonScale = Math.max(0.15, Math.cos(feat.lat * _PROG_D2R)); // lon degrees compress toward the poles
  const dirs = [];
  for (let k = 0; k < n; k++) { // n (not n+1): the polygon is implicitly closed by the clip/path Z, no duplicate seam point
    const a = 2 * Math.PI * k / n;
    const lat = feat.lat + feat.rLat * Math.sin(a);
    const lon = feat.lon + (feat.rLon * Math.cos(a)) / lonScale;
    dirs.push(_trajSpinRotate(_trajLatLonUnit(lat, lon), spinAngle));
  }
  return _trajClippedRunsToPath(_trajHemiClipRuns(dirs), cx, cy, rPx);
}
// Shared limb-darkening overlay: transparent center -> ~35% black rim,
// center offset toward the Sun's SCREEN direction (cheap 2D dot from already-
// projected positions) for a rudimentary day-side/terminator feel.
// ── V1 atmosphere rim glow (MISSION_MODEL_V2 §18) ──────────────────────────
// Soft radial-gradient halo just outside a body's limb, using the per-body
// PROG_BODY_ATMOSPHERE data-layer tint (570, next to PROG_BODY_COLORS — same
// theming exemption). Bodies absent from that table (airless: Moon, Mercury,
// ...) get nothing here — the existing inward limb-darkening gradient
// (_trajLimbGradientDef) already gives them a faint neutral shading cue.
// Emitted BEHIND the disc/globe by call order at the call site; a soft
// donut (transparent -> tinted -> transparent) so it reads as a glow at the
// edge rather than a hard ring.
function _trajAtmosphereGlowSVG(body, cx, cy, rPx, instanceId) {
  if (typeof PROG_BODY_ATMOSPHERE === 'undefined' || !PROG_BODY_ATMOSPHERE[body]) return '';
  const col = PROG_BODY_ATMOSPHERE[body];
  const gid = `traj-atmo-${(instanceId || 'x')}-${body}`;
  // Tight rim hugging the limb (NASA-Eyes look) — the first cut (1.38x outer,
  // 0.85 peak at 1.2x) read as a fat donut, not an atmosphere (review 2026-07-14).
  const rOut = rPx * 1.16;
  return `<defs><radialGradient id="${gid}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="80%" stop-color="${col}" stop-opacity="0"/>` +
    `<stop offset="88%" stop-color="${col}" stop-opacity="0.5"/>` +
    `<stop offset="100%" stop-color="${col}" stop-opacity="0"/></radialGradient></defs>` +
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rOut.toFixed(2)}" fill="url(#${gid})"/>`;
}
function _trajLimbGradientDef(gradId, body, sunDirAngle) {
  const style = (typeof PROG_GEO_STYLE !== 'undefined' && PROG_GEO_STYLE[body]) || {};
  const limbColor = style.limb || 'rgba(0,0,0,.35)';
  const off = 0.32;
  const ox = Math.cos(sunDirAngle || 0) * off, oy = Math.sin(sunDirAngle || 0) * off;
  return `<radialGradient id="${gradId}" cx="${(50 + ox * 50).toFixed(1)}%" cy="${(50 + oy * 50).toFixed(1)}%" r="78%">` +
    `<stop offset="30%" stop-color="${limbColor}" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="${limbColor}" stop-opacity="1"/></radialGradient>`;
}
// ── R6.2 defect3: real terminator (2026-07-11, MATH.md §7m) ────────────────
// `sd` is the body->Sun WORLD-frame unit vector. Builds the great circle
// perpendicular to `sd` (the terminator) in WORLD frame — NOT spin-rotated,
// since illumination depends on sun geometry, not the body's own rotation —
// samples it, and runs it through the SAME hemisphere clipper as coastlines
// (item defect1's clipper doubles as the "ellipse feature" clipper the brief
// asked for). The front-visible arc plus a limb arc closes the NIGHT region;
// which limb arc (of the two candidates) is night is resolved by checking
// which one avoids the sun's own screen angle. Returns null when no scrim is
// needed (fully lit) or {path, alpha} otherwise.
function _trajTerminatorNightPath(sd, cx, cy, rPx) {
  const sq = _trajProj3(sd[0], sd[1], sd[2]);
  const a = sq.x, b = sq.y, c = sq.depth; // a^2+b^2+c^2 == 1 (rotation preserves length)
  if (c >= 0.995) return null; // sun ~directly toward viewer: fully lit face, no scrim
  const FULL_CIRCLE = `M ${(cx - rPx).toFixed(2)} ${cy.toFixed(2)} A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 1 0 ${(cx + rPx).toFixed(2)} ${cy.toFixed(2)} A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 1 0 ${(cx - rPx).toFixed(2)} ${cy.toFixed(2)} Z`;
  if (c <= -0.995) return { path: FULL_CIRCLE, alpha: 0.55 }; // sun ~directly away: fully dark face, soft floor so geometry stays faintly legible
  // World-frame basis spanning the plane perpendicular to sd (the terminator
  // plane); worldUp is the ecliptic normal (+z), matching _trajLatLonUnit's
  // spin-axis convention.
  let e1x = sd[1] * 1 - sd[2] * 0, e1y = sd[2] * 0 - sd[0] * 1, e1z = sd[0] * 0 - sd[1] * 0; // sd x (0,0,1)
  let elen = Math.hypot(e1x, e1y, e1z);
  if (elen < 1e-6) { e1x = 1; e1y = 0; e1z = 0; elen = 1; } // sd ~parallel to ecliptic pole (edge case, no real mission body hits this)
  e1x /= elen; e1y /= elen; e1z /= elen;
  const e2x = sd[1] * e1z - sd[2] * e1y, e2y = sd[2] * e1x - sd[0] * e1z, e2z = sd[0] * e1y - sd[1] * e1x; // sd x e1, already unit
  const N = 40;
  const termDirs = [];
  for (let k = 0; k < N; k++) {
    const phi = 2 * Math.PI * k / N, cp = Math.cos(phi), sp = Math.sin(phi);
    termDirs.push([cp * e1x + sp * e2x, cp * e1y + sp * e2y, cp * e1z + sp * e2z]);
  }
  const clip = _trajHemiClipRuns(termDirs);
  if (clip.closed || !clip.runs.length) return null; // degenerate (shouldn't occur once |c|<0.995) — no scrim rather than a wrong one
  const run = clip.runs[0];
  if (run.length < 2) return null;
  const proj = v => { const q = _trajProj3(v[0], v[1], v[2]); return { x: cx + q.x * rPx, y: cy + q.y * rPx }; };
  const p0 = proj(run[0]), pn = proj(run[run.length - 1]);
  const angStart = Math.atan2(p0.y - cy, p0.x - cx), angEnd = Math.atan2(pn.y - cy, pn.x - cx);
  const theta = Math.atan2(b, a); // sun's own screen angle from disc center
  const norm2pi = x => { x %= 2 * Math.PI; return x < 0 ? x + 2 * Math.PI : x; };
  const s = norm2pi(angStart), e = norm2pi(angEnd), sunA = norm2pi(theta);
  const span = norm2pi(s - e);           // CCW (increasing-angle) span from pn's angle to p0's angle
  const sunSpan = norm2pi(sunA - e);     // where the sun angle falls within that sweep
  const ccwArcContainsSun = sunSpan <= span; // that arc is the DAY side -> night needs the complement
  const sweep = ccwArcContainsSun ? 0 : 1;
  const arcSpan = ccwArcContainsSun ? (2 * Math.PI - span) : span;
  const largeArc = arcSpan > Math.PI ? 1 : 0;
  let d = `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} `;
  for (let i = 1; i < run.length; i++) { const p = proj(run[i]); d += `L ${p.x.toFixed(2)} ${p.y.toFixed(2)} `; }
  d += `A ${rPx.toFixed(2)} ${rPx.toFixed(2)} 0 ${largeArc} ${sweep} ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} Z`;
  return { path: d, alpha: 0.4 };
}
// Full surfaced-disc render (tier 1): base color + surface geometry (per body
// kind) + limb-shading overlay + terminator scrim. `rPx` is the disc's TRUE
// (unclamped) screen radius. Perf clamp: an absurdly huge disc (camera
// zoomed deep into the body, disc mostly off-screen) skips surface geometry
// sampling entirely — same spirit as the polyline viewClampUnits pattern —
// so path strings stay bounded; the base-color fill alone still reads
// correctly at that zoom. `sunDir3` is the body->Sun WORLD-frame unit vector
// (defect3); `instanceId` (mission id or a fixed fallback) + `body` form a
// STABLE per-body-per-instance id for the gradient/clip defs (defect2 — see
// _trajBodyDiscTiered).
// NOTE (clouds, MISSION_MODEL_V2 §18 V1 follow-up): this vector-geometry
// tier has no per-pixel loop to sample a second texture into, unlike
// _trajRasterGlobe — it draws discrete SVG shapes (coastline polygons,
// craters), not a raster. Clouds are intentionally NOT drawn here; this is
// the low-fidelity fallback used only before the real texture has decoded
// or when raster is unavailable, so the omission is brief and low-stakes.
function _trajSurfacedDiscSVG(body, cx, cy, rPx, spinAngle, sunDir3, viewportDiagPx, instanceId) {
  const style = (typeof PROG_GEO_STYLE !== 'undefined' && PROG_GEO_STYLE[body]) || {};
  // R6.2.1 item 2: skip vector feature sampling both when the disc is
  // absurdly huge (mostly off-screen — path strings would be unbounded) AND
  // when it's small enough (< _TRAJ_FEATURE_PX) that features are invisible
  // — the surfaced tier now runs all the way to the chip threshold, so this
  // keeps small-disc rendering as cheap as the old plain-disc middle tier.
  const skipGeometry = (viewportDiagPx && rPx > viewportDiagPx * 4) || rPx < _TRAJ_FEATURE_PX;
  const baseFill = style.base || (style.bands && style.bands[0]) || _trajBodyColor(body);
  // Feature paths are collected separately so they can be clipped to the
  // disc circle (item 1a) as a safety net on top of the exact hemisphere clip
  // above (defect1) — belt-and-suspenders against any float-precision spill.
  let features = '';
  if (!skipGeometry) {
    if (body === 'Earth' && typeof PROG_GEO_EARTH !== 'undefined') {
      PROG_GEO_EARTH.forEach(poly => {
        const d = _trajGeoPolyPath(poly, spinAngle, cx, cy, rPx);
        if (d) features += `<path d="${d}" fill="${style.land || '#3f7a42'}" stroke="none"/>`;
      });
    } else if (body === 'Moon' && typeof PROG_GEO_FEATURES !== 'undefined') {
      (PROG_GEO_FEATURES.Moon || []).forEach(f => {
        const d = _trajGeoEllipsePath(f, spinAngle, cx, cy, rPx);
        const fill = style[f.kind] || style.mare || '#7d7566';
        if (d) features += `<path d="${d}" fill="${fill}" stroke="none"/>`;
      });
    } else if (body === 'Mars' && typeof PROG_GEO_FEATURES !== 'undefined') {
      (PROG_GEO_FEATURES.Mars || []).forEach(f => {
        const d = _trajGeoEllipsePath(f, spinAngle, cx, cy, rPx);
        const fill = style[f.kind] || style.base;
        if (d) features += `<path d="${d}" fill="${fill}" stroke="none"/>`;
      });
    } else if ((body === 'Jupiter' || body === 'Saturn') && style.bands) {
      const bands = style.bands, nBands = bands.length, nSeg = 16;
      for (let b = 0; b < nBands; b++) {
        const lat0 = -90 + (180 * b) / nBands, lat1 = -90 + (180 * (b + 1)) / nBands;
        const dirs = [];
        for (let k = 0; k <= nSeg; k++) {
          const lon = -180 + (360 * k) / nSeg;
          dirs.push(_trajSpinRotate(_trajLatLonUnit(lat1, lon), spinAngle));
        }
        for (let k = nSeg; k >= 0; k--) {
          const lon = -180 + (360 * k) / nSeg;
          dirs.push(_trajSpinRotate(_trajLatLonUnit(lat0, lon), spinAngle));
        }
        const d = _trajClippedRunsToPath(_trajHemiClipRuns(dirs), cx, cy, rPx);
        if (d) features += `<path d="${d}" fill="${bands[b]}" stroke="none" opacity="0.85"/>`;
      }
    }
    // Venus/Mercury/Titan: base disc only (Venus's base fill is already a
    // brightened tint via PROG_GEO_STYLE.Venus).
  }
  // R6.2 defect2: STABLE deterministic ids (per body per render instance)
  // instead of a per-render-unique counter. The world layer is rebuilt
  // wholesale via innerHTML swap every ~33ms during rotation; unique ids
  // meant every rebuild minted fresh gradient/clipPath ids and rewired every
  // url(#) reference, which browsers can resolve asynchronously relative to
  // the atomic DOM swap -> one-frame paint gaps (the flicker). Same-id defs
  // recreated atomically by the innerHTML swap never dangle a reference.
  const idBase = `traj-geo-${(instanceId || 'x')}-${body}`;
  const gradId = `${idBase}-limb`;
  const clipId = `${idBase}-clip`;
  const sunQ = _trajProj3(sunDir3[0], sunDir3[1], sunDir3[2]);
  const sunDirAngle = Math.atan2(sunQ.y, sunQ.x);
  const baseCircle = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rPx.toFixed(2)}" fill="${baseFill}"/>`;
  const featuresSvg = features ? `<g clip-path="url(#${clipId})">${features}</g>` : '';
  const term = _trajTerminatorNightPath(sunDir3, cx, cy, rPx);
  const termSvg = term ? `<path d="${term.path}" fill="rgba(0,0,0,${term.alpha})" clip-path="url(#${clipId})"/>` : '';
  return `<defs>${_trajLimbGradientDef(gradId, body, sunDirAngle)}<clipPath id="${clipId}"><circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rPx.toFixed(2)}"/></clipPath></defs>` +
    `<g>${baseCircle}${featuresSvg}${termSvg}<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rPx.toFixed(2)}" fill="url(#${gradId})"/>` +
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rPx.toFixed(2)}" fill="none" stroke="var(--border-bright)" stroke-width="0.5" vector-effect="non-scaling-stroke"/></g>`;
}
// ── R6.4: real textured globes (MATH.md §7m raster addendum) ───────────────
// Lazy per-body sampling-canvas cache: decodes PROG_TEXTURES[body] into an
// offscreen canvas once and keeps its ImageData for bilinear sampling. Image
// decode is async — callers MUST check `.ready` and fall back to the vector
// path until the onload fires (which invalidates the raster cache below and
// triggers a repaint through _trajRequestRepaint).
let _trajTexStore = {};
function _trajTextureFor(body) {
  if (!(typeof PROG_TEXTURES !== 'undefined' && PROG_TEXTURES[body])) return null;
  let t = _trajTexStore[body];
  if (t) return t;
  t = { ready: false, imgData: null, w: 0, h: 0 };
  _trajTexStore[body] = t;
  const img = new Image();
  img.onload = () => {
    // Sampling canvas: cap width so bilinear lookups stay cheap; equirect
    // aspect is always 2:1 for these sources.
    const sw = Math.min(img.naturalWidth || 1024, 1024);
    const sh = Math.round(sw / 2);
    const sc = document.createElement('canvas');
    sc.width = sw; sc.height = sh;
    const sctx = sc.getContext('2d');
    sctx.drawImage(img, 0, 0, sw, sh);
    t.imgData = sctx.getImageData(0, 0, sw, sh);
    t.w = sw; t.h = sh;
    t.ready = true;
    _trajRasterCache = {}; // stale dataURLs reference the pre-decode fallback
    _trajRequestRepaint();
  };
  img.src = PROG_TEXTURES[body];
  return t;
}
// Cloud layer (Earth only, V1 follow-up MISSION_MODEL_V2 §18): same lazy
// decode-to-ImageData cache as _trajTextureFor, keyed off PROG_CLOUD_TEXTURE
// instead of PROG_TEXTURES. Kept as a separate store/function (not folded
// into _trajTextureFor) because clouds sample at an INDEPENDENT longitude
// offset from the ground texture — see the cloudSpin comment in
// _trajRasterGlobe — and only Earth has an entry, so every other body's
// lookup is a cheap `undefined` short-circuit.
let _trajCloudTexStore = {};
function _trajCloudTextureFor(body) {
  if (!(typeof PROG_CLOUD_TEXTURE !== 'undefined' && PROG_CLOUD_TEXTURE[body])) return null;
  let t = _trajCloudTexStore[body];
  if (t) return t;
  t = { ready: false, imgData: null, w: 0, h: 0 };
  _trajCloudTexStore[body] = t;
  const img = new Image();
  img.onload = () => {
    const sw = Math.min(img.naturalWidth || 1024, 1024);
    const sh = Math.round(sw / 2);
    const sc = document.createElement('canvas');
    sc.width = sw; sc.height = sh;
    const sctx = sc.getContext('2d');
    sctx.drawImage(img, 0, 0, sw, sh);
    t.imgData = sctx.getImageData(0, 0, sw, sh);
    t.w = sw; t.h = sh;
    t.ready = true;
    _trajRasterCache = {};
    _trajRequestRepaint();
  };
  img.src = PROG_CLOUD_TEXTURE[body];
  return t;
}
// Bilinear sample of an ImageData at fractional pixel (fx,fy), wrapping X
// (longitude seam) and clamping Y (poles).
function _trajBilinearSample(imgData, w, h, fx, fy) {
  fx = ((fx % w) + w) % w;
  fy = fy < 0 ? 0 : (fy > h - 1 ? h - 1 : fy);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = (x0 + 1) % w, y1 = y0 + 1 > h - 1 ? h - 1 : y0 + 1;
  const tx = fx - x0, ty = fy - y0;
  const d = imgData.data;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * tx;
    const b = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * tx;
    out[c] = a + (b - a) * ty;
  }
  return out;
}
// Raster an equirect texture to a shaded disc canvas via PER-PIXEL INVERSE
// orthographic mapping. Derivation (MATH.md §7m raster addendum): the
// forward map _trajProjectVec rotates a WORLD unit vector (x,y,z) by az then
// tilt t=pi/2-el and reflects screen-x:
//   u = -(x*ca - y*sa)                         [ca=cos(az), sa=sin(az)]
//   v = (x*sa + y*ca)*ct - z*st                 [ct=cos(t), st=sin(t)]
//   w = (x*sa + y*ca)*st + z*ct   (== depth)
// Since this is a pure rotation, (u,v,w) is unit-length whenever (x,y,z) is,
// so w = +sqrt(1-u^2-v^2) recovers the dropped depth on the front hemisphere.
// Un-rotating tilt then azimuth (both orthonormal, so inverse = transpose)
// gives back the WORLD direction; un-spinning by the body's own spin angle
// (inverse of _trajSpinRotate) gives the BODY-FRAME direction that
// _trajLatLonUnit produces lat/lon from — this is what makes the raster
// align with the vector site markers, which route through the same chain.
function _trajRasterGlobe(body, discPx, spinAngle, az, el, sunDir3, maxPx) {
  const tex = _trajTextureFor(body);
  if (!tex || !tex.ready) return null;
  // Cloud layer (Earth only): drifts at an independent rate/offset from the
  // ground so scrubbing time visibly moves clouds relative to the surface.
  // 0.85x rate (slightly slower than the planet's own spin) + a fixed phase
  // offset — both arbitrary but stable, chosen only so drift is obviously
  // non-zero and non-degenerate (never exactly co-rotating with the ground).
  const cloudTex = _trajCloudTextureFor(body);
  const cloudActive = !!(cloudTex && cloudTex.ready);
  const cloudSpin = (spinAngle || 0) * 0.85 + 0.6;
  const cspc = Math.cos(cloudSpin), csps = Math.sin(cloudSpin);
  const size = Math.max(1, Math.min(Math.round(discPx), maxPx || 512));
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(size, size);
  const od = out.data;
  const t = Math.PI / 2 - (el != null ? el : Math.PI / 2);
  const ca = Math.cos(az || 0), sa = Math.sin(az || 0), ct = Math.cos(t), st = Math.sin(t);
  const spc = Math.cos(spinAngle || 0), sps = Math.sin(spinAngle || 0);
  const iw = tex.w, ih = tex.h, id = tex.imgData;
  const ciw = cloudActive ? cloudTex.w : 0, cih = cloudActive ? cloudTex.h : 0, cid = cloudActive ? cloudTex.imgData : null;
  const R = size / 2;
  // sunDir3 is WORLD-frame body->Sun unit vector (same one the vector
  // terminator uses) — no re-derivation, single source per the brief.
  const sx = sunDir3 ? sunDir3[0] : 0, sy = sunDir3 ? sunDir3[1] : 0, sz = sunDir3 ? sunDir3[2] : 1;
  for (let py = 0; py < size; py++) {
    const v = (py + 0.5 - R) / R;
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5 - R) / R;
      const r2 = u * u + v * v;
      const pi = (py * size + px) * 4;
      if (r2 > 1) { od[pi + 3] = 0; continue; }
      const w = Math.sqrt(Math.max(0, 1 - r2));
      // un-tilt: (ya,z) = R(-t) * (v,w)
      const ya = v * ct + w * st;
      const z = -v * st + w * ct;
      const xa = -u;
      // un-azimuth: (x,y) = R(-az) * (xa,ya)
      const x = xa * ca + ya * sa;
      const y = u * sa + ya * ca; // == -xa*sa + ya*ca
      // un-spin: body-frame = R(-spin) * (x,y)
      const bx = x * spc + y * sps;
      const by = -x * sps + y * spc;
      const bz = z;
      const lat = Math.asin(Math.max(-1, Math.min(1, bz)));
      const lon = Math.atan2(by, bx);
      const fx = ((lon + Math.PI) / (2 * Math.PI)) * iw;
      const fy = ((Math.PI / 2 - lat) / Math.PI) * ih;
      const rgb = _trajBilinearSample(id, iw, ih, fx, fy);
      if (cloudActive) {
        // Independent longitude for the cloud layer: re-un-spin the SAME
        // pre-spin world direction (x,y,z) with cloudSpin instead of the
        // body's own spinAngle. Latitude is spin-invariant (z unchanged).
        const ccx = x * cspc + y * csps;
        const ccy = -x * csps + y * cspc;
        const clon = Math.atan2(ccy, ccx);
        const cfx = ((clon + Math.PI) / (2 * Math.PI)) * ciw;
        const cfy = fy * (cih / ih); // same latitude fraction, cloud texture's own height
        const crgb = _trajBilinearSample(cid, ciw, cih, cfx, cfy);
        // Grayscale cloud map (R=G=B): brightness IS coverage. Screen/lerp
        // toward white, capped so fully-bright cloud doesn't clip to pure
        // white (keeps some surface tone visible through thin cloud).
        const cw = Math.min(0.9, crgb[0] / 255);
        rgb[0] += (255 - rgb[0]) * cw;
        rgb[1] += (255 - rgb[1]) * cw;
        rgb[2] += (255 - rgb[2]) * cw;
      }
      // Shading in the SAME (world-frame, pre-unspin) coordinates as the
      // vector terminator: normal == (x,y,z), dot with sunDir3.
      let ndotl = x * sx + y * sy + z * sz;
      const edge = 0.15;
      let lightF = ndotl < -edge ? 0 : ndotl > edge ? 1 : (ndotl + edge) / (2 * edge);
      lightF = lightF * lightF * (3 - 2 * lightF); // smoothstep
      const NIGHT_FLOOR = 0.45;
      const shade = NIGHT_FLOOR + (1 - NIGHT_FLOOR) * lightF;
      const limb = 0.75 + 0.25 * w;
      const f = shade * limb;
      od[pi] = rgb[0] * f; od[pi + 1] = rgb[1] * f; od[pi + 2] = rgb[2] * f; od[pi + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}
// Raster dataURL cache: quantized key -> dataURL, so drag/rotate re-uses a
// stale raster between throttled re-raster passes instead of re-running the
// per-pixel loop every 33ms frame. Cleared whenever a texture finishes
// decoding (fallback frames must not stick around after real data arrives).
let _trajRasterCache = {};
// R6.4b (user flight-test): the old 120ms raster throttle made the globe
// visibly update at ~8fps while the vector layer moved at 30fps. Replaced
// with a FIDELITY LADDER (gizmo-preview precedent): while the user is
// interacting (rotate/zoom/scrub — see _trajMarkInteracting call sites) the
// globe re-rasters EVERY frame at low resolution (≤224px ≈ 2–4ms, well
// inside the 33ms frame budget) so it moves in lockstep with the lines; a
// settle timer then repaints once at full 512px when the interaction ends.
const _TRAJ_RASTER_LO_PX = 224;
let _trajInteractingUntil = 0;
let _trajRasterSettleTimer = null;
function _trajMarkInteracting() {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  _trajInteractingUntil = now + 250;
  if (_trajRasterSettleTimer) clearTimeout(_trajRasterSettleTimer);
  _trajRasterSettleTimer = setTimeout(() => {
    _trajRasterSettleTimer = null;
    _trajRequestRepaint(); // one full-res pass after the gesture ends
  }, 300);
}
function _trajRasteredDiscDataURL(body, discPx, spinAngle, az, el, sunDir3) {
  const tex = _trajTextureFor(body);
  if (!tex || !tex.ready) return null;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const interacting = now < _trajInteractingUntil;
  const maxPx = interacting ? _TRAJ_RASTER_LO_PX : 512;
  const discBucket = Math.round(discPx / 8) * 8;
  const spinQ = Math.round((spinAngle || 0) * 100) / 100;
  const azQ = Math.round((az || 0) * 100) / 100;
  const elQ = Math.round((el != null ? el : Math.PI / 2) * 100) / 100;
  const sunQ = sunDir3 ? [Math.round(sunDir3[0] * 10) / 10, Math.round(sunDir3[1] * 10) / 10, Math.round(sunDir3[2] * 10) / 10].join(',') : '0';
  const key = `${body}|${maxPx}|${discBucket}|${spinQ}|${azQ}|${elQ}|${sunQ}`;
  const cached = _trajRasterCache[key];
  if (cached) return cached.url;
  const canvas = _trajRasterGlobe(body, discPx, spinAngle, az, el, sunDir3, maxPx);
  if (!canvas) return null;
  const url = canvas.toDataURL('image/png');
  // Bound the cache: quantized spin/az keys churn constantly during long
  // sessions — reset wholesale past a small cap (rasters are cheap to redo).
  if (Object.keys(_trajRasterCache).length > 64) _trajRasterCache = {};
  _trajRasterCache[key] = { url, t: now };
  return url;
}
// ── V1 idle texture pre-warm (MISSION_MODEL_V2 §18) ─────────────────────────
// The trajectory view's first-open lag is texture decode (network fetch +
// getImageData), not a slow render — the per-pixel raster loop itself is a
// few ms once tex.ready. Kick decode for every textured body shortly after
// app init, chunked one body per idle slice, so the view opens with
// tex.ready already true for everything it's about to draw. No loading
// screen (decision 2026-07-14 — pre-warm removes the wait instead of
// dressing it up).
function _trajScheduleIdle(fn) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 800 });
  else setTimeout(() => fn({ timeRemaining: () => 0, didTimeout: true }), 120);
}
let _trajPrewarmStats = null; // {startedAt, bodies:[{body,ms}], totalMs} — read by verification/perf checks
function _trajPrewarmTextures() {
  if (typeof document === 'undefined' || typeof PROG_TEXTURES === 'undefined') return;
  // Bodies present in the active mission's touched frames take priority (the
  // ones the user will actually see first); fall back to every textured body
  // so a fresh/empty program still warms the common planets.
  let list = _trajAllBodies().filter(b => PROG_TEXTURES[b]);
  if (typeof _missions !== 'undefined' && _missions && _missions[0]) {
    try {
      const m = _missions[0];
      const frames = _trajGetExtraction ? _trajGetExtraction(m) : null;
      if (frames) {
        const touched = Object.keys(frames).filter(id => {
          const sc = frames[id];
          return sc && (sc.orbits.size || (sc.legs && sc.legs.length) || (sc.surface && sc.surface.length));
        });
        const parents = touched.map(id => (PROG_MOON_ORBITS[id] && PROG_MOON_ORBITS[id].parent) || id);
        const wanted = ['Earth', ...parents, ...touched].filter(b => PROG_TEXTURES[b]);
        if (wanted.length) list = [...new Set(wanted)].concat(list.filter(b => !wanted.includes(b)));
      }
    } catch (e) { /* best-effort prioritization only — never block the prewarm */ }
  }
  let i = 0, retries = 0;
  const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  _trajPrewarmStats = { startedAt, bodies: [], totalMs: null };
  const az = 0, el = Math.PI / 2;
  const doOne = () => {
    if (i >= list.length) {
      _trajPrewarmStats.totalMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      return;
    }
    const body = list[i];
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const tex = _trajTextureFor(body); // kicks off img decode if not already started
    if (body === 'Earth') _trajCloudTextureFor(body); // kicks off cloud decode alongside the surface map
    if (!tex.ready) {
      retries++;
      if (retries > 60) { i++; retries = 0; } // ~a few seconds of retries, then give up on this body
      _trajScheduleIdle(doOne);
      return;
    }
    // Warm both fidelity-ladder tiers at a canonical top-down orientation —
    // this is a bonus (populates the dataURL cache for the common default
    // view); the real win already happened above (tex.ready).
    _trajRasterGlobe(body, _TRAJ_RASTER_LO_PX, 0, az, el, [0, 0, 1], _TRAJ_RASTER_LO_PX);
    _trajRasterGlobe(body, 512, 0, az, el, [0, 0, 1], 512);
    _trajPrewarmStats.bodies.push({ body, ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0 });
    i++; retries = 0;
    _trajScheduleIdle(doOne);
  };
  _trajScheduleIdle(doOne);
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  const kickPrewarm = () => _trajScheduleIdle(() => _trajPrewarmTextures());
  document.addEventListener('DOMContentLoaded', kickPrewarm);
  if (document.readyState === 'interactive' || document.readyState === 'complete') kickPrewarm();
}

// Repaint hook: after an async texture decode completes, re-render every
// mounted trajectory-view panel at its current camera (same rebuild path
// _trajApplyCam/_missionTrajAfterRender use) so the fallback vector frame is
// replaced with the real raster without waiting for the next user gesture.
function _trajRequestRepaint() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.mcc-view-area .traj-wrap[data-mid]').forEach(va => {
    const id = va.getAttribute('data-mid');
    const cam = _trajCamByMission[id];
    if (id && cam && typeof _trajApplyCam === 'function') _trajApplyCam(id, cam);
  });
}
// Reconcile the persistent globe layer against _trajPendingGlobes (populated by
// the _trajWorldSVG pass that just ran). Reuses one <image> per body, updating
// x/y/size every call and href ONLY when it changed — an in-place href swap
// retains the current bitmap until the new data-URI decodes, so rotation never
// shows a blank/half-decoded planet (the flicker fix). Bodies not drawn this
// frame are hidden (display:none), NOT removed, so their decoded bitmap is kept
// for when the camera returns.
const _TRAJ_SVG_NS = 'http://www.w3.org/2000/svg';
function _trajReconcileGlobeLayer(svgEl) {
  if (!svgEl) return;
  const layer = svgEl.querySelector('g.traj-globe-layer');
  if (!layer) return;
  const seen = {};
  for (const g of _trajPendingGlobes) {
    seen[g.body] = true;
    // Ring-behind group, kept as this body's DOM predecessor of its <image>
    // so it paints underneath the bitmap (see the pending-globe note at the
    // push site) while staying in the same behind-traj-scene layer.
    let ringG = layer.querySelector(`g[data-ring-behind="${g.body}"]`);
    if (!ringG) {
      ringG = document.createElementNS(_TRAJ_SVG_NS, 'g');
      ringG.setAttribute('data-ring-behind', g.body);
      layer.appendChild(ringG);
    }
    ringG.innerHTML = g.ringsBehind || '';
    let img = layer.querySelector(`image[data-body="${g.body}"]`);
    if (!img) {
      img = document.createElementNS(_TRAJ_SVG_NS, 'image');
      img.setAttribute('data-body', g.body);
      img.setAttribute('preserveAspectRatio', 'none');
      layer.appendChild(img);
    }
    // Keep ring-behind immediately before its image in paint order even if
    // both nodes already existed from a prior frame (appendChild moves an
    // existing node rather than duplicating it).
    layer.appendChild(ringG);
    layer.appendChild(img);
    img.setAttribute('x', g.x.toFixed(2));
    img.setAttribute('y', g.y.toFixed(2));
    img.setAttribute('width', g.size.toFixed(2));
    img.setAttribute('height', g.size.toFixed(2));
    if (img.getAttribute('href') !== g.url && img.dataset.pendingHref !== g.url) {
      // Decode-BEFORE-swap (close-zoom rotation flicker fix, 2026-07-14):
      // setting href directly blanks the SVG <image> until the new data-URL
      // decodes — invisible for small discs, a visible flash every az/el
      // cache bucket when zoomed close (large PNG, multi-ms decode). Decode
      // offscreen first and only then swap; the OLD bitmap stays on screen
      // the whole time. pendingHref stale-guards rapid rotation: only the
      // latest requested URL wins, intermediates are dropped.
      const pre = new Image();
      img.dataset.pendingHref = g.url;
      pre.onload = () => {
        if (img.dataset.pendingHref === g.url) {
          img.setAttribute('href', g.url);
          delete img.dataset.pendingHref;
        }
      };
      pre.onerror = () => { if (img.dataset.pendingHref === g.url) delete img.dataset.pendingHref; };
      pre.src = g.url;
      // First-ever bitmap for this body: nothing old to keep showing — set
      // href immediately so the globe appears without waiting a frame.
      if (!img.getAttribute('href')) img.setAttribute('href', g.url);
    }
    if (img.style.display === 'none') img.style.display = '';
    if (ringG.style.display === 'none') ringG.style.display = '';
  }
  layer.querySelectorAll('image[data-body]').forEach(img => {
    if (!seen[img.getAttribute('data-body')]) img.style.display = 'none';
  });
  layer.querySelectorAll('g[data-ring-behind]').forEach(rg => {
    if (!seen[rg.getAttribute('data-ring-behind')]) rg.style.display = 'none';
  });
}
// Tiered body disc dispatcher — replaces the old flat _trajGlyph call for
// planets/moons (Sun keeps its own plain _trajGlyph path, untouched). Picks
// one of the three LOD tiers from the TRUE apparent radius (trueRpx,
// unclamped) and returns the disc svg, wrapped in the same fly-to click
// handler as _trajGlyph. Registers the body-name label exactly as before.
// ── V2+ ring systems (MISSION_MODEL_V2 §18, NASA-Eyes direction) ───────────
// Ring-plane orientation approximation: STATIC tilt about world +X by the
// body's real obliquity (Saturn 26.73°) — the ring plane is really the
// body's own equatorial plane, whose orientation should rotate with a real
// per-epoch frame (N3), but a fixed tilted normal already reads correctly
// from any camera az/el and is documented here as the accepted shortcut
// until N3 lands. e1 = world X axis (lies in the tilted plane, since the
// tilt rotation is about X); e2 = the plane's other in-plane axis (world Y/Z
// rotated by the same tilt) — together an orthonormal basis for the ring
// plane, so a point at ring-plane angle phi and radius r (km) is
// r*(cos(phi)*e1 + sin(phi)*e2) in WORLD-frame km, ready for _trajProjectVec.
const _TRAJ_RING_OBLIQUITY_DEG = { Saturn: 26.73 };
function _trajRingPlaneBasis(body) {
  const deg = _TRAJ_RING_OBLIQUITY_DEG[body];
  if (deg == null) return null;
  const th = deg * _PROG_D2R;
  return { e1: [1, 0, 0], e2: [0, Math.cos(th), Math.sin(th)] };
}
// Sample the ring plane's UNIT circle (radius-independent — see note below)
// into contiguous front/back runs by projected-depth sign, exactly like
// _trajHemiClipRuns' front/back split but for an open ring curve rather than
// a closed hemisphere polygon. Because _trajProjectVec is a pure rotation,
// depth(phi, r) = r * depth(phi, 1) for any r > 0 — the sign of the depth,
// and therefore every front/back boundary angle, is IDENTICAL at every ring
// radius. So the split is computed once per body per frame and reused for
// every band (outer AND inner edge) instead of resampling per band.
function _trajRingAngleRuns(basis, az, el, N) {
  N = N || 120;
  const dirAt = (phi) => {
    const cp = Math.cos(phi), sp = Math.sin(phi);
    return [cp * basis.e1[0] + sp * basis.e2[0], cp * basis.e1[1] + sp * basis.e2[1], cp * basis.e1[2] + sp * basis.e2[2]];
  };
  const depthAt = (phi) => { const v = dirAt(phi); return _trajProjectVec(v[0], v[1], v[2], az, el).depth; };
  const samples = [];
  for (let k = 0; k < N; k++) { const phi = 2 * Math.PI * k / N; samples.push({ phi, d: depthAt(phi) }); }
  const runs = [];
  let cur = null;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const sa = samples[i], sb = samples[j];
    const frontA = sa.d >= 0;
    if (!cur) cur = { front: frontA, phis: [sa.phi] };
    else cur.phis.push(sa.phi);
    const frontB = sb.d >= 0;
    if (frontA !== frontB) {
      const t = sa.d / (sa.d - sb.d);
      let dphi = sb.phi - sa.phi; if (dphi <= 0) dphi += 2 * Math.PI;
      const crossPhi = sa.phi + dphi * (isFinite(t) ? t : 0.5);
      cur.phis.push(crossPhi);
      runs.push(cur);
      cur = { front: frontB, phis: [crossPhi] };
    }
  }
  if (cur) {
    if (runs.length && runs[0].front === cur.front) runs[0].phis = cur.phis.concat(runs[0].phis);
    else runs.push(cur);
  }
  if (!runs.length) runs.push({ front: samples[0].d >= 0, phis: samples.map(s => s.phi).concat([samples[0].phi + 2 * Math.PI]) });
  return runs;
}
// One angular run (contiguous phi list, same boundary angles for every
// radius per the note above) -> a filled "washer wedge" SVG path: outer edge
// forward, inner edge back, at the run's screen-projected positions.
function _trajRingBandRunPath(basis, run, rOut, rIn, cx, cy, zoom, az, el) {
  const project = (phi, r) => {
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const vx = (cp * basis.e1[0] + sp * basis.e2[0]) * r;
    const vy = (cp * basis.e1[1] + sp * basis.e2[1]) * r;
    const vz = (cp * basis.e1[2] + sp * basis.e2[2]) * r;
    const q = _trajProjectVec(vx, vy, vz, az, el);
    return { x: cx + q.x * zoom, y: cy + q.y * zoom };
  };
  const outPts = run.phis.map(phi => project(phi, rOut));
  const inPts = run.phis.map(phi => project(phi, rIn)).reverse();
  const all = outPts.concat(inPts);
  return all.map((p, i) => (i ? 'L ' : 'M ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ') + ' Z';
}
// PROG_BODY_RINGS -> { behind, front } SVG strings, ready to splice around a
// body's disc: `behind` emitted BEFORE the disc/globe so the sphere occludes
// the far side of the ring; `front` emitted AFTER so the near side occludes
// the sphere. Bodies absent from PROG_BODY_RINGS (everything but Saturn)
// return empty strings — the caller reads the table, no per-body branching.
function _trajRingsSVG(body, cx, cy, zoom, az, el) {
  const cfg = typeof PROG_BODY_RINGS !== 'undefined' && PROG_BODY_RINGS[body];
  const basis = _trajRingPlaneBasis(body);
  if (!cfg || !basis) return { behind: '', front: '' };
  const runs = _trajRingAngleRuns(basis, az, el, 120);
  let behind = '', front = '';
  cfg.bands.forEach(band => {
    runs.forEach(run => {
      if (run.phis.length < 2) return;
      const d = _trajRingBandRunPath(basis, run, band.rOut, band.rIn, cx, cy, zoom, az, el);
      const piece = `<path d="${d}" fill="${band.color}"/>`;
      if (run.front) front += piece; else behind += piece;
    });
  });
  return { behind, front };
}
function _trajBodyDiscTiered(cx, cy, trueRpx, color, body, zoom, isFocus, forceLabel, clickId, viewT, sunDir3, viewportDiagPx) {
  const labelSize = Math.max(trueRpx, _TRAJ_CHIP_R);
  _trajRegisterLabel(cx, cy - labelSize, [{ text: body, dy: -4, fontPx: 10, color: color || 'var(--nm-label)' }], 'body',
    { screenSize: labelSize, minSize: _TRAJ_LOD_BODY_MIN, selected: !!isFocus || !!forceLabel });
  const clickAttr = clickId ? ` class="traj-body-glyph" style="cursor:pointer" onclick="trajGlyphClick('${clickId}','${body}')"` : '';
  let disc;
  if (trueRpx >= _TRAJ_CHIP_PX) {
    // item 2: middle plain-disc tier removed — surfaced disc renders all the
    // way down to the chip threshold (same constant-floor clamp as the old
    // tier 2 kept the disc from vanishing below _TRAJ_MIN_BODY_PX; feature
    // sampling itself is skipped internally below _TRAJ_FEATURE_PX).
    const r = Math.max(trueRpx, _TRAJ_MIN_BODY_PX);
    const spin = _trajBodySpinAngle(body, viewT);
    const az = _trajProjCtx.az, el = _trajProjCtx.el;
    let rasterUrl = null;
    if (r >= _TRAJ_FEATURE_PX && typeof PROG_TEXTURES !== 'undefined' && PROG_TEXTURES[body]) {
      rasterUrl = _trajRasteredDiscDataURL(body, r * 2, spin, az, el, sunDir3);
    }
    const atmoGlow = _trajAtmosphereGlowSVG(body, cx, cy, r, clickId || body);
    // Rings (item 4/5): rendered at both the raster and vector disc tiers —
    // never below the chip threshold this whole branch is already gated by —
    // and ride the same km->px zoom as the disc itself (world-geometry
    // layer). Split behind/front around the disc so occlusion is correct.
    const rings = _trajRingsSVG(body, cx, cy, zoom, az, el);
    if (rasterUrl) {
      // Globe bitmap → persistent layer (see _trajPendingGlobes note); only
      // the crisp border stays inline in the per-frame scene. Glow is drawn
      // inline (traj-scene paints above the globe layer) so it reads as a
      // soft rim right at the bitmap's edge.
      // Ring-behind content can't just go inline here: the raster globe
      // <image> lives in the PERSISTENT traj-globe-layer sibling, which
      // paints BEHIND the whole per-frame traj-scene (see _trajPendingGlobes
      // note above) — so inline content in `disc` would show IN FRONT of the
      // bitmap regardless of string order. Ship ringsBehind alongside the
      // pending globe so _trajReconcileGlobeLayer can place it in that same
      // layer, under the image, for correct occlusion.
      _trajPendingGlobes.push({ body, url: rasterUrl, x: cx - r, y: cy - r, size: r * 2, ringsBehind: rings.behind });
      disc = atmoGlow + `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="none" stroke="var(--border-bright)" stroke-width="0.5" vector-effect="non-scaling-stroke"/>` + rings.front;
    } else {
      disc = rings.behind + atmoGlow + _trajSurfacedDiscSVG(body, cx, cy, r, spin, sunDir3, viewportDiagPx, clickId) + rings.front;
    }
  } else {
    const glyph = _TRAJ_BODY_GLYPH[body] || '•';
    disc = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${_TRAJ_CHIP_R}" fill="var(--nm-bg)" fill-opacity="0.15" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
      `<text x="${cx.toFixed(2)}" y="${(cy + 3.2).toFixed(2)}" text-anchor="middle" font-size="9" fill="${color}">${glyph}</text>`;
  }
  const hit = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${Math.max(trueRpx, 7).toFixed(2)}" fill="transparent"/>`;
  return clickId ? `<g${clickAttr}>${disc}${hit}</g>` : `<g>${disc}</g>`;
}

// ── R6.3: launch site marker + mock ascent path (MATH.md §7n) ──────────────
// PRESENTATION LAYER ONLY — the ascent curve is a schematic bezier, not a
// propagated trajectory (no ΔV/physics consequence, same spirit as §7m's
// surface rendering). Finds the first LAUNCH event carrying a resolvable
// site (authored or inherited from its fleet vehicle — 570's
// _missionLaunchSiteFor) and draws: (a) a small ring+label marker at the
// site's CURRENT rotated position (rides the spin with viewT), (b) a dashed
// schematic curve from the site's position AT LAUNCH TIME to a nominal
// insertion point on the parking orbit.
function _trajMissionLaunchEvent(m) {
  if (!m || !m.log) return null;
  for (const e of m.log) {
    if (e.type === 'LAUNCH' && typeof _missionLaunchSiteFor === 'function') {
      const site = _missionLaunchSiteFor(e);
      if (site && site.lat != null && site.lon != null) return { e, site };
    }
  }
  return null;
}
function _trajLaunchSiteAndAscentSVG(m, cx, cy, rPx, viewT, viewportDiagPx) {
  const found = _trajMissionLaunchEvent(m);
  if (!found) return '';
  const { e, site } = found;
  const lodAlpha = _trajLodOpacity(rPx, _TRAJ_LOD_WIN.missionOrbitRing[0], _trajWindowHi(_TRAJ_LOD_WIN.missionOrbitRing[1], viewportDiagPx));
  if (lodAlpha <= 0) return '';
  const spinNow = _trajBodySpinAngle('Earth', viewT);
  const nowPt = _trajSurfacePoint(_trajSpinRotate(_trajLatLonUnit(site.lat, site.lon), spinNow), cx, cy, rPx);
  let svg = '';
  if (nowPt.depth >= 0) { // hemisphere cull — same convention as the coastline paths
    svg += `<circle cx="${nowPt.x.toFixed(2)}" cy="${nowPt.y.toFixed(2)}" r="3" fill="none" stroke="var(--accent3)" stroke-width="1.3" opacity="${lodAlpha.toFixed(3)}"/>`;
    const lbl = (site.name || 'Launch Site');
    _trajRegisterLabel(nowPt.x, nowPt.y - 8, [{ text: lbl, dy: 0, fontPx: 9, color: 'var(--accent3)' }], 'site',
      { screenSize: rPx, minSize: _TRAJ_LOD_BODY_MIN, selected: false, opacity: lodAlpha });
  }
  // v3.0 backlog fix (user, 2026-07-14): the mock-ascent bezier is REMOVED.
  // It connected the site's surface point to an insertion point on the orbit
  // ring — two points that are generally NOT plane-aligned unless the launch
  // time/RAAN were actually solved for this site, so it drew an unphysical
  // ~45° climb into an orbit it visibly didn't intersect. The LAUNCH event's
  // position on the trajectory is the ORBIT (the R6.1 event-node marker
  // resolves to the ring at the launch MET); the site ring above remains as
  // a purely cosmetic surface highlight. An honest ascent curve would need a
  // real plane-aligned launch solution — future work, not a fake curve.
  return svg;
}

// Which body-frame(s) hold content (an orbit ring or a transfer leg) tied to
// the given authored event index. Used for the "event at BODY — fly to" hint
// chip when the selected event's content lives somewhere other than the
// camera's current anchor.
function _trajFramesForAuthIdx(m, authIdx) {
  if (authIdx == null) return [];
  const frames = _trajGetExtraction(m);
  const hits = [];
  Object.keys(frames).forEach(frameId => {
    const sc = frames[frameId];
    const hasOrbit = [...sc.orbits.values()].some(rec => rec.firstAuthIdx === authIdx);
    const hasLeg = sc.legs.some(leg => leg.authIdx === authIdx);
    if (hasOrbit || hasLeg) hits.push(frameId);
  });
  return hits;
}

// Focus-bar grouping: bodies with moons render as a button + a flyout
// listing the parent and its moons (first-class nav path for Moon/Titan);
// moonless bodies (+Sun) render as plain buttons. Unchanged UX from before
// C1b — only the underlying action (trajSetFocus) now flies the camera
// instead of switching a scene.
function _trajFocusGroups() {
  const bodies = [{ id: 'Sun', label: 'Sun' }, ...Object.keys(PROG_HELIO_R).map(b => ({ id: b, label: b }))];
  return bodies.map(s => ({ scene: s, moons: s.id === 'Sun' ? [] : _trajMoonsOf(s.id) }));
}

// ── top-level view builder (called from missionRenderDetail via 570's hook) ──
function _missionTrajViewHTML(m) {
  const id = m.missionId;
  _trajExtractionCache = { missionId: null, data: null }; // force fresh extraction each render (mission log may have changed)

  // ── camera: default-anchor-Earth fit-to-content on first access for this mission ──
  let cam = _trajCamByMission[id];
  if (!cam) { cam = { anchorBody: 'Earth', relOffsetKm: { x: 0, y: 0 }, wKm: _trajFitWKmForBody('Earth', m) }; _trajCamByMission[id] = cam; }
  const zoom = _trajZoomFromCam(cam);
  const focus = cam.anchorBody;

  // Grouped focus bar: moonless bodies (+Sun) render as plain buttons; bodies
  // with moons render as a button + a small flyout dropdown listing the
  // parent and its moons, so Moon/Titan scenes get first-class navigation.
  const groups = _trajFocusGroups();
  const focusSeg = groups.map(g => {
    const sceneId = g.scene.id, label = g.scene.label;
    if (!g.moons.length) {
      return `<button class="${focus === sceneId ? 'active' : ''}" onclick="trajSetFocus('${id}','${sceneId}')">${label}</button>`;
    }
    const memberIds = [sceneId, ...g.moons.map(mo => mo.name)];
    const groupActive = memberIds.includes(focus);
    const isOpen = _trajFlyoutOpenFor === (id + '|' + sceneId);
    const items = memberIds.map(mid => {
      const mLabel = mid === sceneId ? label : mid;
      const active = focus === mid;
      return `<button class="traj-flyout-item${active ? ' active' : ''}" onclick="event.stopPropagation();trajSetFocus('${id}','${mid}');_trajCloseFlyout();">${mLabel}</button>`;
    }).join('');
    return `<div class="traj-flyout-wrap">
      <button class="${groupActive ? 'active' : ''}" onclick="event.stopPropagation();_trajToggleFlyout('${id}','${sceneId}')">${label} &#x25BE;</button>
      <div class="traj-flyout${isOpen ? ' open' : ''}">${items}</div>
    </div>`;
  }).join('');

  // WORLD-layer geometry (resets + fills the label registry as a side effect;
  // overlay resolution happens after mount in _missionTrajAfterRender, once
  // the container's real px rect is known — the initial paint here can't
  // resolve overlay px yet since the svg isn't measurable before mount).
  _trajResetLabels();
  const svgInner = _trajWorldSVG(m, cam, zoom, null);
  // Constant-unit viewBox (geometry is emitted in km·zoom render units) —
  // square default; aspect corrected post-mount by _missionTrajAfterRender.
  const viewBox = `${(-_TRAJ_VB / 2).toFixed(3)} ${(-_TRAJ_VB / 2).toFixed(3)} ${_TRAJ_VB.toFixed(3)} ${_TRAJ_VB.toFixed(3)}`;

  // Selection hint chip: if the selected event's content lives at a body
  // frame other than the camera's current anchor, offer a one-click fly-to
  // instead of auto-flying (per the O1-c brief — don't yank the user's view).
  const selAuthIdx = _trajSelectedAuthIdx(m);
  let hintChip = '';
  if (selAuthIdx != null) {
    const hitFrames = _trajFramesForAuthIdx(m, selAuthIdx).filter(s => s !== focus);
    if (hitFrames.length) {
      const target = hitFrames[0];
      hintChip = `<div class="traj-hint-chip" onclick="trajSetFocus('${id}','${target}')" title="Fly to ${target}">fly to ${target.toUpperCase()}</div>`;
    }
  }

  return `
    <div class="traj-wrap" data-mid="${id}">
      <div class="traj-toolbar">
        <div class="seg traj-focus-seg">${focusSeg}</div>
        <select class="traj-frame-select" title="Reference frame (MISSION_MODEL_V2 §17 N3)" onchange="trajSetFrame('${id}',this.value)">
          ${_TRAJ_FRAME_KINDS.map(f => `<option value="${f.id}"${_trajFrame(id) === f.id ? ' selected' : ''}>${f.label}</option>`).join('')}
        </select>
        <button class="act-btn" onclick="trajResetView('${id}')" title="Reset zoom/pan/orientation (top-down)">&#x21BA; Reset</button>
      </div>
      <div class="traj-canvas" onwheel="trajWheelZoom(event,'${id}')"
           onmousedown="trajPanStart(event,'${id}')" onmousemove="trajPanMove(event)"
           onmouseup="trajPanEnd()" onmouseleave="trajPanEnd()" oncontextmenu="return false">
        <canvas class="traj-starfield" data-mid="${id}"></canvas>
        ${hintChip}
        ${(typeof _oiCardHTML === 'function') ? _oiCardHTML(m) : ''}
        <svg class="traj-svg" data-mid="${id}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">
          <g class="traj-globe-layer" data-mid="${id}"></g>
          <g class="traj-scene" data-mid="${id}">
            ${svgInner}
          </g>
        </svg>
        <svg class="traj-overlay" data-mid="${id}" preserveAspectRatio="none"></svg>
      </div>
      ${(typeof _ttdDockHTML === 'function') ? _ttdDockHTML(m, id) : _trajScrubberHTML(m, id)}
      <div class="traj-footer">${_trajFooterHTML(cam)}</div>
    </div>`;
}

// ── scrubbable MET (backlog item 3) ─────────────────────────────────────────
// Slim track spanning [0, mission max MET] with a tick per log event and a
// draggable thumb at the CURRENT view time (_trajViewTime's manual-override
// slot — see there for the "one authority" integration note). Refreshed by
// _trajApplyCam/_missionTrajAfterRender's sync alongside the footer so it
// stays live under drag, event selection, and resize alike.
function _trajScrubberHTML(m, id) {
  if (!m) return '';
  const vt = _trajViewTime(m);
  const maxMet = _trajMissionMaxMet(m);
  const pct = maxMet > 0 ? Math.max(0, Math.min(1, vt / maxMet)) * 100 : 0;
  const ticks = (m.log || []).map(e => {
    if (!e || typeof e.metStart !== 'number' || !isFinite(e.metStart)) return '';
    const p = Math.max(0, Math.min(1, e.metStart / maxMet)) * 100;
    return `<div class="traj-scrub-tick" style="left:${p.toFixed(2)}%" title="${_tsEsc(e.type || '')} · ${_metFmt(e.metStart)}"></div>`;
  }).join('');
  return `<div class="traj-scrubber" data-mid="${id}">
    <div class="traj-scrub-track" tabindex="0" data-mid="${id}" data-max-met="${maxMet}"
         onmousedown="_trajScrubDown(event,'${id}',${maxMet})" onkeydown="_trajScrubKey(event,'${id}',${maxMet})"
         title="Drag or click to scrub mission time · arrow keys nudge when focused">
      ${ticks}
      <div class="traj-scrub-thumb" style="left:${pct.toFixed(2)}%"></div>
    </div>
    <div class="traj-scrub-readout">${_metFmt(vt)}</div>
  </div>`;
}

let _trajScrubDrag = null;
let _trajScrubLastMs = 0;
function _trajScrubPctFromEvent(ev, trackEl) {
  const r = trackEl.getBoundingClientRect();
  if (!(r.width > 0)) return 0;
  return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
}
// `track` is re-queried live on every tick rather than held from the mousedown
// closure: _trajSetViewTime -> _trajApplyCam replaces the track node's
// outerHTML on every refresh (to keep the thumb/ticks in sync), which would
// detach a held reference (getBoundingClientRect on a detached node reads as
// all-zero) after the very first tick.
function _trajScrubLiveTrack(id) {
  return document.querySelector(`.traj-scrub-track[data-mid="${id}"]`);
}
function _trajScrubDown(ev, id, maxMet) {
  const track = ev.currentTarget;
  _trajScrubDrag = { id, maxMet };
  track.focus();
  _trajSetViewTime(id, _trajScrubPctFromEvent(ev, track) * maxMet, maxMet);
  document.addEventListener('mousemove', _trajScrubMove);
  document.addEventListener('mouseup', _trajScrubUp);
  ev.preventDefault();
}
function _trajScrubMove(ev) {
  if (!_trajScrubDrag) return;
  if (typeof _trajMarkInteracting === 'function') _trajMarkInteracting();
  const now = performance.now();
  // Throttled ~30ms, same class as rotate-drag (trajPanMove) — a full
  // world+overlay re-render (via _trajApplyCam) per mousemove tick is the
  // same cost class as a camera rotate tick.
  if (now - _trajScrubLastMs <= 33) return;
  _trajScrubLastMs = now;
  const { id, maxMet } = _trajScrubDrag;
  const track = _trajScrubLiveTrack(id);
  if (!track) return;
  _trajSetViewTime(id, _trajScrubPctFromEvent(ev, track) * maxMet, maxMet);
}
function _trajScrubUp() {
  _trajScrubDrag = null;
  _trajScrubLastMs = 0;
  document.removeEventListener('mousemove', _trajScrubMove);
  document.removeEventListener('mouseup', _trajScrubUp);
}
function _trajScrubKey(ev, id, maxMet) {
  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
  ev.preventDefault();
  const m = (typeof _missions !== 'undefined' ? (_missions || []) : []).find(mm => mm.missionId === id);
  if (!m) return;
  const vt = _trajViewTime(m);
  const step = _trajTickIntervalS(maxMet);
  const dt = ev.key === 'ArrowLeft' ? -step : step;
  _trajSetViewTime(id, vt + dt, maxMet);
}

// R2: footer text incl. the orientation readout — also refreshed by
// _trajApplyCam so rotate-drag keeps it live without a full panel rebuild.
function _trajFooterHTML(cam) {
  const elDeg = Math.round(((cam.el != null ? cam.el : Math.PI / 2) * 180 / Math.PI));
  const azDeg = Math.round((((cam.az || 0) * 180 / Math.PI) % 360 + 360) % 360);
  // R3.5: el now ranges over ±~89.4° (full-range tilt, item 3) instead of
  // [0,90] — tilt = 90 - el still reads correctly across the whole range
  // (0 at top-down, 90 at the horizon, up to ~180 near straight-up-from-below);
  // only suppress the readout right at the canonical top-down default.
  const orientTxt = Math.abs(elDeg) < 89 ? `az ${azDeg}&deg; &middot; tilt ${90 - elDeg}&deg; &middot; ` : '';
  const attrib = (typeof PROG_TEXTURE_ATTRIBUTION !== 'undefined') ? ` &middot; ${PROG_TEXTURE_ATTRIBUTION}` : '';
  return `${orientTxt}true-geometry orbits (JPL mean elements; vessel orbit planes: from flight where flown, &Omega;=0 otherwise) &middot; drag rotates &middot; scroll zooms &middot; click a body to center &middot; body sizes clamped for visibility${attrib}`;
}

// Focus-flyout open state: 'missionId|sceneId' of the currently-open dropdown,
// or null. Single global (only one flyout can be open at a time), closed on
// outside click same as the File menu pattern (mcc-export-menu).
let _trajFlyoutOpenFor = null;
function _trajToggleFlyout(id, sceneId) {
  const key = id + '|' + sceneId;
  if (_trajFlyoutOpenFor === key) { _trajCloseFlyout(); return; }
  _trajFlyoutOpenFor = key;
  document.addEventListener('click', _trajFlyoutOutsideClick);
  missionRenderDetail();
}
function _trajCloseFlyout() {
  if (_trajFlyoutOpenFor == null) return;
  _trajFlyoutOpenFor = null;
  document.removeEventListener('click', _trajFlyoutOutsideClick);
  missionRenderDetail();
}
function _trajFlyoutOutsideClick(e) {
  if (e.target.closest && e.target.closest('.traj-flyout-wrap')) return;
  _trajCloseFlyout();
}

// Called by 570 right after render (mirrors _missionCenterNmEarth). Sizes the
// overlay svg to the container's real px rect, fixes the world svg's viewBox
// aspect ratio (the initial HTML string assumes a square box since the
// container size isn't known until after mount), resolves the overlay
// symbology now that px are real px, and wires a ResizeObserver so both
// layers stay honest across container resizes (band-view split resize,
// window resize, etc.) — required for the "world svg rect == container rect
// AND overlay rect == world rect, at all zoom levels and all container
// sizes" invariant.
// ── V1 starfield (MISSION_MODEL_V2 §18) ─────────────────────────────────────
// Deterministic seeded PRNG (mulberry32) — the SAME seed every draw, so
// stars never "twinkle" between re-renders. Built ONCE per panel size and
// only redrawn when that size actually changes (resize), never on
// camera/rotate/zoom (the starfield is screen-space, at infinity — it must
// NOT track the world). Neutral white-alpha only, per the theming rule's
// scrim exemption — this is not chrome color.
function _trajMulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const _TRAJ_STARFIELD_SEED = 133742;
let _trajStarfieldSize = {}; // id -> "WxH" of the last drawn size (resize-only regen gate)
// R6.5 fix: a 0x0 (or missing) measurement must NOT be cached as "done" —
// otherwise a canvas measured before layout flush (fresh reload straight
// into traj view, or a synchronous Band->Trajectory toggle) never gets a
// retry once real dimensions arrive, and the starfield silently stays
// blank. Only cache a key once it reflects a real, positive size; a
// transition FROM zero/uncached TO a real size always redraws.
function _trajStarfieldSync(id) {
  const canvas = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"] canvas.traj-starfield`);
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width), h = Math.round(rect.height);
  if (!(w > 0 && h > 0)) return; // nothing to draw into yet — leave cache alone so a later real size still draws
  const key = `${w}x${h}`;
  // The done-marker lives ON THE ELEMENT, not in a module map keyed by
  // mission id: view re-renders REPLACE the canvas element, and an id-keyed
  // cache outlives it — the fresh blank canvas then matches "already drawn"
  // and stays empty forever (reproduced: cache said 760x601 while the live
  // canvas sat at the 300x150 default with 0 stars). Same-size redraws are
  // pixel-identical anyway (seeded PRNG), so this can never twinkle.
  if (canvas.dataset.starSize === key) return;
  canvas.dataset.starSize = key;
  _trajStarfieldSize[id] = key; // kept for the unmount/resize-observer bookkeeping
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const rnd = _trajMulberry32(_TRAJ_STARFIELD_SEED);
  const count = Math.max(120, Math.min(500, Math.round((w * h) / 2200)));
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h;
    const tier = rnd();
    let r, a, fill;
    if (tier > 0.985) { // rare, slightly larger tinted stars
      r = 1.5 + rnd() * 0.5;
      a = 0.75 + rnd() * 0.2;
      fill = rnd() > 0.5 ? `rgba(190,205,255,${a.toFixed(2)})` : `rgba(255,222,180,${a.toFixed(2)})`;
    } else if (tier > 0.88) { // mid tier
      r = 0.9 + rnd() * 0.4;
      a = 0.55 + rnd() * 0.25;
      fill = `rgba(255,255,255,${a.toFixed(2)})`;
    } else { // faint background tier
      r = 0.4 + rnd() * 0.3;
      a = 0.2 + rnd() * 0.25;
      fill = `rgba(255,255,255,${a.toFixed(2)})`;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

let _trajResizeObservers = {};
function _missionTrajAfterRender(m) {
  const id = m.missionId;
  const svgEl = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"] svg.traj-svg`);
  const overlayEl = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${id}"] svg.traj-overlay`);
  if (!svgEl) return;
  const sync = () => {
    _trajStarfieldSync(id);
    const cam = _trajCamByMission[id];
    if (!cam) return;
    const rect = svgEl.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    const aspect = rect.height / rect.width;
    const vbH = _TRAJ_VB * aspect;
    svgEl.setAttribute('viewBox', `${(-_TRAJ_VB / 2).toFixed(3)} ${(-vbH / 2).toFixed(3)} ${_TRAJ_VB.toFixed(3)} ${vbH.toFixed(3)}`);
    const sceneEl = svgEl.querySelector('g.traj-scene');
    if (sceneEl && typeof _missions !== 'undefined') {
      const mm = (_missions || []).find(x => x.missionId === id);
      const zoom = _trajZoomFromCam(cam);
      _trajResetLabels();
      _trajExtractionCache = { missionId: null, data: null };
      sceneEl.innerHTML = _trajWorldSVG(mm, cam, zoom, rect);
      _trajReconcileGlobeLayer(svgEl); // R6.4c: patch persistent globe images in place (no flicker)
      if (overlayEl) {
        overlayEl.style.transform = ''; // clear any mid-drag pan slide
        overlayEl.setAttribute('width', rect.width);
        overlayEl.setAttribute('height', rect.height);
        overlayEl.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
        const renderCam = { cx: 0, cy: 0, w: _TRAJ_VB };
        overlayEl.innerHTML = _trajResolveLabels(renderCam, rect);
        if (typeof _trajGizmoRepaintOverlay === 'function') _trajGizmoRepaintOverlay();
      // R3.5.2: the world re-render just rebuilt g.traj-scene, wiping the
      // gizmo's scene-space preview path — repaint it too, or the previewed
      // trajectory vanishes the moment the user zooms/rotates to look at it.
      if (typeof _trajGizmoRepaintScenePreview === 'function') _trajGizmoRepaintScenePreview();
      }
    }
  };
  sync();
  // R6.5 fix: the first sync() can land before the browser has flushed
  // layout for freshly-mounted DOM (0x0 rect) — e.g. a fresh reload straight
  // into traj view, or switching Band->Trajectory in the same synchronous
  // render pass. A double-rAF retry re-runs sync() once layout is
  // guaranteed settled, so the starfield still gets drawn even if the
  // ResizeObserver never fires (size unchanged from 0 isn't a "resize").
  requestAnimationFrame(() => requestAnimationFrame(() => sync()));
  if (_trajResizeObservers[id]) { try { _trajResizeObservers[id].disconnect(); } catch (e) {} }
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => sync());
    ro.observe(svgEl);
    _trajResizeObservers[id] = ro;
  }
}

// R6.5 fix: clear the starfield's cached size when leaving the trajectory
// view (Trajectory->Band toggle, or navigating away) so a later return
// re-measures from scratch instead of trusting a stale cache from a
// panel that may have been resized while hidden.
function _trajStarfieldUnmount(id) {
  delete _trajStarfieldSize[id];
  if (_trajResizeObservers[id]) { try { _trajResizeObservers[id].disconnect(); } catch (e) {} delete _trajResizeObservers[id]; }
}
