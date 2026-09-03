
// ─── LOW-THRUST DURATION-DRAG GIZMO ────────────────────────────────────────
// Mirrors 5745's drag wiring (mousedown on an SVG handle -> document
// mousemove/mouseup -> Escape cancel) but uses only est.-lane math during the
// drag (never physPropagateSegment in a mouse handler). Release authors the
// new duration_s through m.log -> missionRecompute -> missionRenderDetail; the
// signature machinery in 568/570 invalidates any computed cache.
// Handles exist in the DOM only for the selected LOWTHRUST event.

let _ltgDrag = null; // { missionId, authIdx, x0, y0, ux, uy, baseDuration_s, ep, body, alt0Km, law, schemEl, r0Km, tickEls }

const _LTG_PX_PER_DAY = 5;      // screen px of along-axis drag per day of duration change
const _LTG_MIN_DURATION_S = 3600; // floor: never drag below 1 hour


function _ltgActiveStageEpFor(m, e) {
  const ob = e && e.orbitBefore;
  if (!ob) return null;
  const stage = _missionActiveEpStage(m);
  if (!stage) return null;
  const m0 = progStageMass(stage);
  return {
    ep: { thrust_N: stage.ep_thrust_N, isp_s: stage.ep_isp_s, m0_kg: m0, mDry_kg: stage.dry_mass },
    body: ob.body,
    alt0Km: ob.perigee ?? ob.apogee ?? 0,
  };
}

function _ltgHandleDown(evt, id, authIdx) {
  if (_missionViewMode !== 'traj') return; // mode-conditional guard
  evt.preventDefault();
  const m = _missionGet(id);
  const e = m && m.log && m.log[authIdx];
  if (!m || !e || e.type !== 'LOWTHRUST') return;
  const ctx = _ltgActiveStageEpFor(m, e);
  if (!ctx) return;
  const target = evt.currentTarget || evt.target;
  const tx = parseFloat(target.getAttribute('data-tx'));
  const ty = parseFloat(target.getAttribute('data-ty'));
  const hx = parseFloat(target.getAttribute('cx'));
  const hy = parseFloat(target.getAttribute('cy'));
  let ux = hx - tx, uy = hy - ty;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len; uy /= len;
  const schemId = target.getAttribute('data-schem');
  _ltgDrag = {
    missionId: id, authIdx, x0: evt.clientX, y0: evt.clientY, ux, uy,
    baseDuration_s: e.duration_s || 0, liveDuration_s: e.duration_s || 0,
    ep: ctx.ep, body: ctx.body, alt0Km: ctx.alt0Km, law: e.law === 'retrograde' ? 'retrograde' : 'prograde',
    throttle: e.throttle == null ? 1 : e.throttle,
    schemEl: schemId ? document.getElementById(schemId) : null,
    handleEl: target, hx0: hx, hy0: hy,
    tickLayer: null,
  };
  _ltgDrawTicks();
  document.addEventListener('mousemove', _ltgHandleMove);
  document.addEventListener('mouseup', _ltgHandleUp);
  document.addEventListener('keydown', _ltgKeydown);
  _ltgUpdateReadout(); // paint the readout once at the base duration before any movement
}

// Week-boundary tick marks along the drag axis (subtle, var(--text-dim)) —
// spec requirement. Drawn once at drag-start (the axis is fixed for the
// whole drag; only the live duration/handle position changes per frame).
function _ltgDrawTicks() {
  const g = _ltgDrag;
  if (!g) return;
  const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
  const overlay = va && va.querySelector('svg.traj-overlay');
  if (!overlay) return;
  let layer = overlay.querySelector('g.ltg-tick-layer');
  if (layer) layer.remove();
  const perpX = -g.uy, perpY = g.ux;
  const halfLen = 6;
  let svg = '';
  const maxWeeks = 26; // ~half a year of drag range in either direction is plenty of ticks
  for (let w = -maxWeeks; w <= maxWeeks; w++) {
    if (w === 0) continue;
    const px = g.hx0 + g.ux * w * 7 * _LTG_PX_PER_DAY;
    const py = g.hy0 + g.uy * w * 7 * _LTG_PX_PER_DAY;
    svg += `<line x1="${(px - perpX * halfLen).toFixed(1)}" y1="${(py - perpY * halfLen).toFixed(1)}" x2="${(px + perpX * halfLen).toFixed(1)}" y2="${(py + perpY * halfLen).toFixed(1)}" stroke="var(--text-dim)" stroke-width="1" opacity="0.5" vector-effect="non-scaling-stroke"/>`;
  }
  overlay.insertAdjacentHTML('beforeend', `<g class="ltg-tick-layer" style="pointer-events:none">${svg}</g>`);
  g.tickLayer = overlay.querySelector('g.ltg-tick-layer');
}

function _ltgClearTicks() {
  const g = _ltgDrag;
  const layer = g && g.tickLayer;
  if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
}

function _ltgHandleMove(evt) {
  const g = _ltgDrag;
  if (!g) return;
  const dx = evt.clientX - g.x0, dy = evt.clientY - g.y0;
  const alongPx = dx * g.ux + dy * g.uy;
  const days = alongPx / _LTG_PX_PER_DAY;
  g.liveDuration_s = Math.max(_LTG_MIN_DURATION_S, g.baseDuration_s + days * 86400);
  // move the handle itself along the fixed axis (visual feedback independent
  // of the schematic re-draw below, which needs a live altitude to exist)
  const movedPx = (g.liveDuration_s - g.baseDuration_s) / 86400 * _LTG_PX_PER_DAY;
  if (g.handleEl) {
    g.handleEl.setAttribute('cx', (g.hx0 + g.ux * movedPx).toFixed(2));
    g.handleEl.setAttribute('cy', (g.hy0 + g.uy * movedPx).toFixed(2));
  }
  _ltgUpdateReadout();
  _ltgRepaintSchematic();
}

// est.-lane ONLY (scope guard) — never physPropagateSegment here.
function _ltgLiveEstimate() {
  const g = _ltgDrag;
  if (!g) return null;
  return ltEstimateLeg(g.ep, g.liveDuration_s, g.throttle);
}

function _ltgRepaintSchematic() {
  const g = _ltgDrag;
  if (!g || !g.schemEl) return;
  const est = _ltgLiveEstimate();
  if (!est) return;
  const signedDv = (g.law === 'retrograde' ? -1 : 1) * est.dv_est_kms;
  const alt1Km = ltApplyDvToCircularAlt(g.body, g.alt0Km, signedDv);
  const b = PROG_BODIES[g.body];
  if (!b) return;
  const r0 = b.R + g.alt0Km, r1 = b.R + alt1Km;
  const REVS = 4, STEPS = 160, thMax = REVS * 2 * Math.PI;
  if (g.__r1Start == null) _ltgUpdateReadout(); // populates g.__r1Start as a side effect (first frame only)
  _ltgRebuildSchematicRobust(g, r0, r1, REVS, STEPS, thMax);
}

// Robust rebuild: recovers the render's (zoom, rotation) affine from the two
// endpoints already baked into the CURRENT schematic path (th=0 and th=thMax
// at the drag-start r1), then redraws the whole curve for the LIVE r1. Two
// point correspondences fully determine a uniform-scale+rotation 2D affine
// (4 unknowns: a,b,tx,ty in [x'=a*x-b*y+tx, y'=b*x+a*y+ty]), which is exactly
// what _trajProj3's own output (a rotation+scale of the orbital plane) is.
function _ltgRebuildSchematicRobust(g, r0, r1, REVS, STEPS, thMax) {
  // World-space (unprojected orbital-plane) coords of the two reference
  // points, using the DRAG-START r1 (g.__r1Start), which the original path
  // was drawn with.
  const r1Start = g.__r1Start != null ? g.__r1Start : r1;
  const wx0 = r0, wy0 = 0;                                     // th=0
  const thE = thMax;
  const rE = r1Start;
  const wxE = rE * Math.cos(thE), wyE = rE * Math.sin(thE);    // th=thMax (== wxE=rE since cos(4*2pi)=1, sin=0)
  const dAttr = g.schemEl.getAttribute('d') || '';
  const nums = dAttr.match(/-?\d+\.?\d*/g);
  if (!nums || nums.length < 4) return;
  const sx0 = parseFloat(nums[0]), sy0 = parseFloat(nums[1]);
  const sxE = parseFloat(nums[nums.length - 2]), syE = parseFloat(nums[nums.length - 1]);
  const wdx = wxE - wx0, wdy = wyE - wy0;
  const wLen2 = wdx * wdx + wdy * wdy;
  if (!(wLen2 > 1e-9)) return; // degenerate (r1Start ~= r0 along x) — skip live redraw, keep last drawn shape
  const sdx = sxE - sx0, sdy = syE - sy0;
  // a,b solve [wdx -wdy; wdy wdx] * [a;b] = [sdx;sdy]
  const a = (wdx * sdx + wdy * sdy) / wLen2;
  const b = (wdx * sdy - wdy * sdx) / wLen2;
  const tx = sx0 - (a * wx0 - b * wy0);
  const ty = sy0 - (b * wx0 + a * wy0);
  let d = '';
  for (let k = 0; k <= STEPS; k++) {
    const th = k / STEPS * thMax;
    const r = r0 * Math.pow(r1 / r0, th / thMax);
    const wx = r * Math.cos(th), wy = r * Math.sin(th);
    const px = a * wx - b * wy + tx, py = b * wx + a * wy + ty;
    d += (k ? ' L ' : 'M ') + px.toFixed(2) + ' ' + py.toFixed(2);
  }
  g.schemEl.setAttribute('d', d);
  g.__r1Start = r1Start; // preserve the fixed calibration reference across the whole drag
}

function _ltgUpdateReadout() {
  const g = _ltgDrag;
  if (!g) return;
  if (g.__r1Start == null) {
    const est0 = ltEstimateLeg(g.ep, g.baseDuration_s, g.throttle);
    const signedDv0 = (g.law === 'retrograde' ? -1 : 1) * (est0 ? est0.dv_est_kms : 0);
    g.__r1Start = ((PROG_BODIES[g.body]) ? PROG_BODIES[g.body].R : 0) +
      ltApplyDvToCircularAlt(g.body, g.alt0Km, signedDv0);
  }
  const est = _ltgLiveEstimate();
  if (!est) return;
  const durDays = (g.liveDuration_s / 86400).toFixed(1);
  const dvM = Math.round(est.dv_est_kms * 1000);
  const propKg = Math.round(est.propUsed_kg);
  const depleted = est.capped;
  const propRemainKg = Math.max(0, (g.ep.m0_kg - g.ep.mDry_kg) - propKg);
  const arrival = (typeof _missions !== 'undefined')
    ? (() => {
        const m = _missions.find(x => x.missionId === g.missionId);
        const e = m && m.log[g.authIdx];
        const met0 = (e && e.metStart) || 0;
        return progMissionTimeToDate(met0 + g.liveDuration_s);
      })()
    : null;
  const arrivalTxt = arrival ? arrival.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';
  // Floating readout near the handle — LAZILY CREATED (orchestrator fix
  // nothing ever emitted this element, so the drag readout
  // silently never appeared; the id lookup below found null every frame).
  // Lives in the traj-wrap (positioned HTML above the SVG), removed by the
  // shared drag-cleanup path.
  let el = document.getElementById(`ltg-readout-${g.missionId}-${g.authIdx}`);
  if (!el) {
    const va = document.querySelector(`.mcc-view-area .traj-wrap[data-mid="${g.missionId}"]`);
    if (va) {
      el = document.createElement('div');
      el.id = `ltg-readout-${g.missionId}-${g.authIdx}`;
      el.className = 'ltg-readout';
      el.style.cssText = 'position:absolute;z-index:30;pointer-events:none;';
      va.appendChild(el);
    }
  }
  if (el && g.handleEl) {
    // pin next to the handle's current screen position (overlay px == wrap px)
    const hb = g.handleEl.getBoundingClientRect();
    const wb = el.parentElement.getBoundingClientRect();
    el.style.left = Math.round(hb.right - wb.left + 10) + 'px';
    el.style.top = Math.round(hb.top - wb.top - 8) + 'px';
  }
  if (el) {
    el.innerHTML = `<div style="font-family:var(--mono);font-size:9px;color:var(--text-bright);background:var(--panel);border:1px solid var(--accent);border-radius:3px;padding:4px 8px;line-height:1.6;">
      <div>duration: ${durDays} d</div>
      <div>&Delta;v est.: ${dvM.toLocaleString()} m/s</div>
      <div>prop: ${propKg.toLocaleString()} kg${depleted ? ' <span style="color:var(--warn)">— DEPLETED</span>' : ''}</div>
      <div>prop remaining: ${propRemainKg.toLocaleString()} kg</div>
      <div>arrival: ${arrivalTxt}</div>
    </div>`;
  }
  // Also mirror onto the event card's own readout slot if present (card stays
  // open while dragging in the trajectory view — same DOM, two mount points).
  const cardEl = document.getElementById(`ltg-card-readout-${g.missionId}-${g.authIdx}`);
  if (cardEl) {
    cardEl.innerHTML = `${durDays} d &middot; ${dvM.toLocaleString()} m/s &middot; ${propKg.toLocaleString()} kg${depleted ? ' <span style="color:var(--warn)">DEPLETED</span>' : ''} &middot; remaining ${propRemainKg.toLocaleString()} kg &middot; arr. ${arrivalTxt}`;
  }
}

function _ltgKeydown(evt) {
  if (evt.key !== 'Escape') return;
  evt.preventDefault();
  _ltgCancelDrag();
}

function _ltgEndListeners() {
  document.removeEventListener('mousemove', _ltgHandleMove);
  document.removeEventListener('mouseup', _ltgHandleUp);
  document.removeEventListener('keydown', _ltgKeydown);
  // tear down the floating readout (created lazily in _ltgUpdateReadout)
  const g = _ltgDrag;
  if (g) {
    const el = document.getElementById(`ltg-readout-${g.missionId}-${g.authIdx}`);
    if (el) el.remove();
  }
}

function _ltgCancelDrag() {
  const g = _ltgDrag;
  if (!g) return;
  _ltgEndListeners();
  _ltgClearTicks();
  // restore the schematic to its pre-drag shape + handle position by simply
  // re-rendering the detail panel (cheap; no data was mutated).
  _ltgDrag = null;
  missionRenderDetail();
}

function _ltgHandleUp() {
  const g = _ltgDrag;
  if (!g) return;
  _ltgEndListeners();
  _ltgClearTicks();
  const m = _missionGet(g.missionId);
  const e = m && m.log && m.log[g.authIdx];
  const finalDuration = Math.round(g.liveDuration_s);
  _ltgDrag = null;
  if (!m || !e || e.type !== 'LOWTHRUST') return;
  if (finalDuration === (e.duration_s || 0)) {
    missionRenderDetail();
    return;
  }
  // Release = author through the sanctioned path (replay
  // invariant): change m.log -> missionRecompute -> missionRenderDetail. The
  // signature/STALE machinery (568 ltSignature / 570's recompute case) picks
  // up the new duration_s automatically and flips any cached computed leg
  // STALE without this module touching _ltComputedByMission at all.
  e.duration_s = finalDuration;
  missionRecompute(m);
  missionRenderDetail();
}

// ── E4 target-orbit mode ─────────────────────────────────────────────────
// "Target altitude…" affordance on the LOWTHRUST card: inverse-Edelbaum
// (closed form) fills duration_s; unreachable targets show a var(--warn)
// badge with the max-achievable altitude instead of silently clamping.
function ltgSetTargetAltitude(id, idx) {
  const m = _missionGet(id);
  const e = m && m.log && m.log[idx];
  if (!m || !e || e.type !== 'LOWTHRUST') return;
  const input = document.getElementById(`ltg-alt-${id}-${idx}`);
  const badgeEl = document.getElementById(`ltg-badge-${id}-${idx}`);
  const altKm = input ? parseFloat(input.value) : NaN;
  if (badgeEl) badgeEl.innerHTML = '';
  if (!isFinite(altKm) || altKm < 0) {
    if (badgeEl) badgeEl.innerHTML = '<span style="color:var(--warn)">enter a valid altitude (km)</span>';
    return;
  }
  const ctx = _ltgActiveStageEpFor(m, e);
  if (!ctx) {
    if (badgeEl) badgeEl.innerHTML = '<span style="color:var(--warn)">no ready EP stage / current orbit to solve from</span>';
    return;
  }
  const result = ltInverseEdelbaumDuration(ctx.body, ctx.alt0Km, altKm, ctx.ep);
  if (!result) {
    const raise = altKm >= ctx.alt0Km;
    const maxA = ltMaxAchievableAlt(ctx.body, ctx.alt0Km, ctx.ep, raise);
    if (badgeEl) {
      badgeEl.innerHTML = (maxA && isFinite(maxA.altMax_km))
        ? `<span style="color:var(--warn)">&#9888; unreachable with available prop — max achievable &#8776; ${Math.round(maxA.altMax_km).toLocaleString()} km (full-tank &Delta;v ${Math.round(maxA.dv_max_kms * 1000).toLocaleString()} m/s)</span>`
        : `<span style="color:var(--warn)">&#9888; unreachable with this stage's prop</span>`;
    }
    return;
  }
  e.duration_s = Math.round(result.duration_s);
  e.law = result.law;
  missionRecompute(m);
  missionRenderDetail();
}
