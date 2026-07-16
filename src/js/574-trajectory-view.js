
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
      // Casing pass (MISSION_MODEL_V2 §12 addendum) — same dark underlay as
      // the ring/physics-leg casing, reusing this arc's own geometry.
      const casing = `<path d="${arc.d}" fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="${(strokeW * 2.5).toFixed(2)}" opacity="${opacity}" vector-effect="non-scaling-stroke"/>`;
      out += `${casing}<path d="${arc.d}" fill="none" stroke="${color}" stroke-width="${strokeW}"${dashAttr} opacity="${opacity}" vector-effect="non-scaling-stroke"${clickAttr}><title>${hoverTitle}</title></path>${hitArea}`;
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
    // Moon-lead orientation (C2): for a leg whose destination is a MOON of
    // this body frame (o.destination present, e.g. LEO->TLC->LLO), orient
    // the apse line so the arrival end lands on that moon's world position
    // AT ARRIVAL TIME rather than the old fixed rotDeg=0 convention.
    // BUG FIX (2026-07-15): also treat a direct (non-transit) node that
    // orbits a moon of `body` as a moon destination for orientation purposes
    // — see the matching _trajLocalRadius fix above (hand-authored one-hop
    // LEO->NRHO maneuvers carry no `.destination` field at all).
    const destMoon = leg.toO.destination ||
      (leg.toO.body && PROG_MOON_ORBITS[leg.toO.body] && PROG_MOON_ORBITS[leg.toO.body].parent === body ? leg.toO.body : null);
    // toO_peri/toO_apo assume `o`'s perigee/apogee are altitudes above THIS
    // frame's body `R` — true for a same-body toO, meaningless for a direct
    // cross-body destMoon toO (its perigee/apogee are altitudes above the
    // MOON, not `body`). Skip the redundancy/ellipse-endpoint refinement in
    // that case and just use the plain moon-orbital-radius toR from above.
    const toPeri = !destMoon ? toO_peri(leg.toO, R) : null, toApo = !destMoon ? toO_apo(leg.toO, R) : null;
    const redundant = toPeri != null && toApo != null && _trajTransferIsRedundant(fromR, toApo, toPeri, toApo);
    const arcToR = (toApo != null && toPeri != null && Math.abs(toApo - toPeri) > Math.max(1, toApo * 0.001)) ? toApo : toR;
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
      // Casing pass (MISSION_MODEL_V2 §12 addendum) — same dark underlay as
      // the ring/physics-leg casing, reusing this arc's own geometry.
      const casing = `<path d="${arc.d}" fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="${(strokeW * 2.5).toFixed(2)}" opacity="${opacity}" vector-effect="non-scaling-stroke"/>`;
      out += `${casing}<path d="${arc.d}" fill="none" stroke="${color}" stroke-width="${strokeW}"${dashAttr} opacity="${opacity}" vector-effect="non-scaling-stroke"${clickAttr}><title>${hoverTitle}</title></path>${hitArea}`;
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
  // BUG FIX (2026-07-15 user report): a leg's toO can target a MOON ORBIT
  // NODE directly (e.g. 430's 'nrho', body:'Moon') without going through a
  // 'transit' corridor node at all — a hand-authored one-hop LEO->NRHO
  // maneuver does exactly this. The transit/.destination branch above was
  // the ONLY path that let a cross-body (parent-frame) schematic arc resolve
  // a far radius; a direct non-transit cross-body node fell straight to
  // `o.body !== body` => null and the leg silently drew nothing (physics
  // convergence aside — physLegL !converged already withholds the polyline,
  // so this schematic fallback is the only remaining honest picture). Mirror
  // the transit/.destination case: when `o` orbits a MOON of `body` (this is
  // the parent-frame view), use that moon's own orbital radius as the far
  // endpoint, same as the transit branch's `mo.r`.
  if (o.body !== body) {
    const moD = PROG_MOON_ORBITS[o.body];
    if (moD && moD.parent === body) return moD.r;
    return null;
  }
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

  // §12 U3: the anchor/frame camera-context selects are now built by
  // _trajCamToolbarHTML (this file) and rendered into the World view's
  // docked panel by 570-mission-lifecycle.js — no longer embedded in this
  // function's own markup (killed the last floating stage chrome).

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
      <div class="traj-footer">${_trajFooterHTML(cam)}</div>
    </div>`;
}

// MISSION_MODEL_V2 §12 U3: the World panel — camera/frame anchor selects,
// moved OFF the floating stage toolbar (the last floating chrome, per the
// brief) and into the docked per-view panel under the map. Same handlers
// (trajSetFocus/trajSetFrame/trajResetView) as before — only the location
// changed. Kept as a standalone function (rather than reusing state stashed
// during _missionTrajViewHTML) so it works regardless of render order.
function _trajCamToolbarHTML(m, id) {
  let cam = _trajCamByMission[id];
  if (!cam) { cam = { anchorBody: 'Earth', relOffsetKm: { x: 0, y: 0 }, wKm: _trajFitWKmForBody('Earth', m) }; _trajCamByMission[id] = cam; }
  const focus = cam.anchorBody;
  const groups = _trajFocusGroups();
  const focusOptsHTML = groups.map(g => {
    const sceneId = g.scene.id, label = g.scene.label;
    const opts = [`<option value="${sceneId}"${focus === sceneId ? ' selected' : ''}>${label}</option>`];
    g.moons.forEach(mo => opts.push(`<option value="${mo.name}"${focus === mo.name ? ' selected' : ''}>&nbsp;&nbsp;${mo.name}</option>`));
    return opts.join('');
  }).join('');
  return `<div class="traj-toolbar">
    <div class="traj-cam-context">
      <select class="traj-anchor-select" title="Camera anchor body" onchange="trajSetFocus('${id}',this.value)">${focusOptsHTML}</select>
      <select class="traj-frame-select" title="Reference frame (MISSION_MODEL_V2 §17 N3)" onchange="trajSetFrame('${id}',this.value)">
        ${_TRAJ_FRAME_KINDS.map(f => `<option value="${f.id}"${_trajFrame(id) === f.id ? ' selected' : ''}>${f.label}</option>`).join('')}
      </select>
    </div>
    <button class="act-btn" onclick="trajResetView('${id}')" title="Reset zoom/pan/orientation (top-down)">&#x21BA; Reset</button>
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
