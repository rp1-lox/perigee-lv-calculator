// ─────────────────────────────────────────────────────────────────────────────
// 5744-trajectory-eventnodes.js — Event-node markers, burn glyphs, low-thrust arc
//
// OWNS: the per-event visual markers overlaid on the trajectory — burn glyphs
//   (_trajBurnMarker), event-node symbology and placement (_TRAJ_EVENTNODE_TYPES,
//   _trajEventNodeColorVar/_Label/_Info/_OrbitFor/_Body/_Pos, _trajEventNodesSVG),
//   ghost markers (_trajGhostMarker, _TRAJ_HISTORY_ALPHA), click-to-select from the
//   view (_trajSelectEventFromView, _trajSelectedAuthIdx); the mission extent /
//   extraction cache used to frame those nodes (_trajMissionExtentForBody,
//   _trajExtractionCache, _trajGetExtraction); small orbit-radius helpers
//   (toO_peri, toO_apo, _trajTransferIsRedundant); and the low-thrust spiral arc
//   renderer (_trajLowThrustSVG).
// Does NOT own: ring/leg geometry (5743), globes/surfaces (5744-trajectory-globe.js),
//   camera/projection (5740), or the per-body content orchestrator (core).
// Split out of 574-trajectory-view.js (behavior-preserving move). Definitions/decls
//   only (no load-time execution); load order among 574x def-only modules is irrelevant.
// ─────────────────────────────────────────────────────────────────────────────

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
