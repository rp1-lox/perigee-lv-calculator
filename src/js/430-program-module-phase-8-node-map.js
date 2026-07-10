
// ─── PROGRAM MODULE — Phase 8: Node Map ──────────────────────────────────────
//
// Subway-style ΔV topology graph (Model 3 from conops_mockups.html).
// Rendered as programmatic SVG in #prog-nm-canvas (viewBox 0 0 1100 520).
// Three vertical zones: Earth | Lunar | Interplanetary.
// Hover on edge: tooltip with ΔV.
// Click on edge: insert BURN event in Band View with that ΔV.
// Active mission path highlighted in vehicle color.

// ── Tooltip element ───────────────────────────────────────────────────────────

// ── Node Map data ─────────────────────────────────────────────────────────────
// viewBox 0 0 1100 520.
// Zone columns: Earth x=80–380, Lunar x=400–660, Interplanetary x=680–1080.
// Y axis loosely maps to energy/altitude: surface ~460, LEO ~360, GEO ~240, escape ~130.
// Each node carries a full orbital definition so ΔV can be computed directly
// using vis-viva / patched-conic without routing through the graph.
// orbit.type: 'surface' | 'circular' | 'elliptic' | 'escape' | 'transit'
// transit nodes represent a trajectory between bodies (TLI, TMI, etc.)
// Node positions are in world-space coords. The canvas uses a zoomable/pannable
// <g id="nm-world"> so these coords are independent of the SVG viewBox size.
// Systems are laid out like a compressed solar system (Earth left → planets right).
// Within each system nodes fan RADIALLY around the planet body:
//   surface → just outside/below the planet disc
//   orbitals → spread above at increasing distances, angled apart so they don't crowd
//   escape/transit → near the SOI boundary or in open space between systems
// All positions verified: no node overlaps each other or the planet body disc.
const PROG_NM_NODES = [
  // ── Earth system — body center (195, 255), bodyR=26, SOI r=210 ───────────────
  // Surface node lives AT the planet body center — the disc IS the node visually.
  { id:'earth-surface', label:'EARTH',   sub:'surface',        zone:'earth',  cx:195, cy:255, r:26,
    orbit:{ type:'surface',  body:'Earth' } },
  // LEO directly above the planet (57 px from center → 19 px clear of disc top).
  { id:'leo',           label:'LEO',     sub:'185 – 400 km',   zone:'earth',  cx:195, cy:190, r:20,
    orbit:{ type:'circular', body:'Earth', perigee:185,   apogee:185,   inclination:28.5 } },
  // GTO upper-left; GEO upper-right — same altitude band, fanned ±30° from vertical.
  { id:'gto',           label:'GTO',     sub:'35,786 km apo',  zone:'earth',  cx:140, cy:168, r:18,
    orbit:{ type:'elliptic', body:'Earth', perigee:185,   apogee:35786, inclination:28.5 } },
  { id:'geo',           label:'GEO',     sub:'35,786 km circ', zone:'earth',  cx:252, cy:163, r:18,
    orbit:{ type:'circular', body:'Earth', perigee:35786, apogee:35786, inclination:0    } },
  // Escape near the SOI boundary, centred above.
  { id:'escape',        label:'ESCAPE',  sub:'C3 ≥ 0',         zone:'earth',  cx:195, cy:122, r:17, dashed:true,
    orbit:{ type:'escape',   body:'Earth', c3:0.1 } },

  // ── Lunar system — body center (450, 192), bodyR=12, SOI r=70 ────────────────
  // TLC floats in the transfer corridor, well outside both SOIs.
  { id:'tlc',           label:'TLC',     sub:'trans-lunar',    zone:'lunar',  cx:352, cy:244, r:17, dashed:true,
    orbit:{ type:'transit',  body:'Earth', c3:-1.9, destination:'Moon' } },
  // LLO upper-left of Moon, DRO upper-right — angled apart so they're clear.
  { id:'llo',           label:'LLO',     sub:'100 km lunar',   zone:'lunar',  cx:418, cy:152, r:18,
    orbit:{ type:'circular', body:'Moon',  perigee:100,   apogee:100,   inclination:90 } },
  { id:'dro',           label:'DRO',     sub:'distant retro',  zone:'lunar',  cx:483, cy:138, r:18,
    orbit:{ type:'circular', body:'Moon',  perigee:68300, apogee:68300, inclination:0 } },
  // Surface node at Moon body center — disc is the node.
  { id:'moon-surface',  label:'MOON',    sub:'surface',        zone:'lunar',  cx:450, cy:192, r:12,
    orbit:{ type:'surface',  body:'Moon' } },

  // ── Mars system — body center (860, 205), bodyR=18, SOI r=80 ─────────────────
  { id:'mars-transit',  label:'TRANSIT', sub:'Earth → Mars',   zone:'interp', cx:655, cy:244, r:17, dashed:true,
    orbit:{ type:'transit',  body:'Sun', c3:8.7,  departure_body:'Earth', destination:'Mars'  } },
  // Orbit above, surface below.
  { id:'mars-orbit',    label:'MARS',    sub:'orbit 400 km',   zone:'interp', cx:860, cy:150, r:22,
    orbit:{ type:'circular', body:'Mars',  perigee:400,   apogee:400,   inclination:0 } },
  // Surface node at Mars body center — disc is the node.
  { id:'mars-surface',  label:'MARS',    sub:'surface',        zone:'interp', cx:860, cy:205, r:18,
    orbit:{ type:'surface',  body:'Mars' } },

  // ── Venus system — body center (848, 380), bodyR=15, SOI r=67 ────────────────
  { id:'venus-transit', label:'TRANSIT', sub:'Earth → Venus',  zone:'interp', cx:655, cy:366, r:17, dashed:true,
    orbit:{ type:'transit',  body:'Sun', c3:6.3,  departure_body:'Earth', destination:'Venus' } },
  // Orbit above Venus disc.
  { id:'venus-orbit',   label:'VENUS',   sub:'orbit 300 km',   zone:'interp', cx:848, cy:318, r:20,
    orbit:{ type:'circular', body:'Venus', perigee:300,   apogee:300,   inclination:0 } },

  // ── Mercury ─────────────────────────────────────────────────────────────────
  { id:'mercury-transit', label:'TRANSIT', sub:'Earth → Mercury', zone:'interp', r:17, dashed:true,
    orbit:{ type:'transit',  body:'Sun', c3:56.7, departure_body:'Earth', destination:'Mercury' } },
  { id:'mercury-orbit',   label:'MERCURY', sub:'orbit 200 km',    zone:'interp', r:18,
    orbit:{ type:'circular', body:'Mercury', perigee:200, apogee:200, inclination:0 } },
  { id:'mercury-surface', label:'MERCURY', sub:'surface',         zone:'interp', r:14,
    orbit:{ type:'surface',  body:'Mercury' } },

  // ── Jupiter ─────────────────────────────────────────────────────────────────
  { id:'jupiter-transit', label:'TRANSIT', sub:'Earth → Jupiter', zone:'interp', r:17, dashed:true,
    orbit:{ type:'transit',  body:'Sun', c3:77.4, departure_body:'Earth', destination:'Jupiter' } },
  { id:'jupiter-orbit',   label:'JUPITER', sub:'orbit 1,000 km',  zone:'interp', r:22,
    orbit:{ type:'circular', body:'Jupiter', perigee:1000, apogee:1000, inclination:0 } },

  // ── Saturn ──────────────────────────────────────────────────────────────────
  { id:'saturn-transit',  label:'TRANSIT', sub:'Earth → Saturn',  zone:'interp', r:17, dashed:true,
    orbit:{ type:'transit',  body:'Sun', c3:105.7, departure_body:'Earth', destination:'Saturn' } },
  { id:'saturn-orbit',    label:'SATURN',  sub:'orbit 1,000 km',  zone:'interp', r:22,
    orbit:{ type:'circular', body:'Saturn', perigee:1000, apogee:1000, inclination:0 } },

  // ── Uranus ──────────────────────────────────────────────────────────────────
  { id:'uranus-transit',  label:'TRANSIT', sub:'Earth → Uranus',  zone:'interp', r:17, dashed:true,
    orbit:{ type:'transit',  body:'Sun', c3:127.5, departure_body:'Earth', destination:'Uranus' } },
  { id:'uranus-orbit',    label:'URANUS',  sub:'orbit 1,000 km',  zone:'interp', r:20,
    orbit:{ type:'circular', body:'Uranus', perigee:1000, apogee:1000, inclination:0 } },

  // ── Neptune ─────────────────────────────────────────────────────────────────
  { id:'neptune-transit', label:'TRANSIT', sub:'Earth → Neptune', zone:'interp', r:17, dashed:true,
    orbit:{ type:'transit',  body:'Sun', c3:135.9, departure_body:'Earth', destination:'Neptune' } },
  { id:'neptune-orbit',   label:'NEPTUNE', sub:'orbit 1,000 km',  zone:'interp', r:20,
    orbit:{ type:'circular', body:'Neptune', perigee:1000, apogee:1000, inclination:0 } },
];

// No pre-spawned edges — users draw their own via right-click → Add Edge From Here.
const PROG_NM_EDGES = [];

// ── Node Map renderer ─────────────────────────────────────────────────────────

// ── Node Map helpers (updated to accept allEdges param) ───────────────────────

/** Return edge IDs that appear in the current program's BURN events. */
function _progNmActiveEdgeIds(allEdges) {
  if (!PROG_ACTIVE_PROGRAM) return [];
  const edges = allEdges || [...PROG_NM_EDGES, ...(PROG_ACTIVE_PROGRAM.nodeMapCustomEdges || [])];
  const ids = [];
  for (const ev of (PROG_ACTIVE_PROGRAM.events || [])) {
    if (ev.type !== 'BURN') continue;
    if (ev.fromNode && ev.toNode) {
      const e = edges.find(ed => ed.from === ev.fromNode && ed.to === ev.toNode);
      if (e && !ids.includes(e.id)) ids.push(e.id);
    }
  }
  return ids;
}

/** Map a FlightVehicle's current OrbitalState to the nearest canonical node id. */
function _progNmVehicleNode(fv) {
  const os = fv.orbitState;
  if (!os) return 'earth-surface';
  if (os.surface) {
    if (os.body === 'Moon')  return 'moon-surface';
    if (os.body === 'Mars')  return 'mars-surface';
    return 'earth-surface';
  }
  const alt = (os.apogee + os.perigee) / 2;
  const body = os.body;
  if (body === 'Earth') {
    if (alt < 2000)   return 'leo';
    if (alt < 20000)  return 'gto';
    return 'geo';
  }
  if (body === 'Moon') return alt < 500 ? 'llo' : 'dro';
  if (body === 'Mars') return alt < 1000 ? 'mars-surface' : 'mars-orbit';
  if (body === 'Venus') return 'venus-orbit';
  return 'leo';
}

// ── Interactions ───────────────────────────────────────────────────────────────


/**
 * Edge click: create a BURN event. Works with built-in and custom edges.
 */

// ── Custom node & edge management ─────────────────────────────────────────────

/** Open the "Add Custom Node" modal. */

/** Auto-compute canvas position for a custom node based on zone + altitude. */

/** Save a new custom node from the modal form. */

/** Right-click on a custom node square → delete menu. */

// ── ΔV computation for node-map edges ────────────────────────────────────────

// ── ΔV physics engine ─────────────────────────────────────────────────────────
// Computes ΔV directly from orbital parameters (vis-viva / patched-conic).
// Never routes through the graph — any two orbits can be connected directly.

/**
 * Speed of spacecraft in orbit `o` at radial distance r_km from body centre (km/s).
 * Works for circular and elliptic orbits.
 */
function _nmOrbitVAtR(body, orbit, r_km) {
  const b = PROG_BODIES[body];
  if (!b) return 0;
  if (!orbit || orbit.type === 'surface') return 0;
  if (orbit.type === 'circular') return Math.sqrt(b.mu / r_km);
  const rp = b.R + (orbit.perigee ?? orbit.apogee ?? 0);
  const ra = b.R + (orbit.apogee  ?? orbit.perigee ?? 0);
  const a  = (rp + ra) / 2;
  return Math.sqrt(Math.max(0, b.mu * (2 / r_km - 1 / a)));
}

/**
 * Two-impulse ΔV (m/s) between two COAXIAL orbits (apsides aligned) around the same body,
 * via vis-viva at the burn points. Considers every apsis→apsis bi-tangent transfer plus the
 * single-burn case when the two orbits share an apsis radius, and returns the cheapest.
 * Reduces exactly to a Hohmann transfer for two circular orbits — and, unlike collapsing
 * each ellipse to its mean altitude, makes BOTH perigee and apogee affect the result.
 * Reads perigee/apogee directly (not the type label), so a slightly-elliptical "circular"
 * node is still handled correctly.
 */
function _nmCoaxialTransferDv(body, oa, ob, priceOrientation) {
  const b = PROG_BODIES[body]; if (!b) return null;
  const apsOf = o => {
    const r1 = b.R + (o.perigee ?? o.apogee ?? 0), r2 = b.R + (o.apogee ?? o.perigee ?? 0);
    return { rp: Math.min(r1, r2), ra: Math.max(r1, r2) };
  };
  const A = apsOf(oa), B = apsOf(ob);
  // vis-viva speed (km/s) on the orbit with apsides (rp,ra) at radius r:  1/a = 2/(rp+ra)
  const vAt = (rp, ra, r) => Math.sqrt(Math.max(0, b.mu * (2 / r - 2 / (rp + ra))));
  const apsA = [A.rp, A.ra], apsB = [B.rp, B.ra];
  let best = Infinity, dv1b = 0, dv2b = 0, single = false;
  apsA.forEach(r1 => apsB.forEach(r2 => {
    // bi-tangent two-burn: transfer ellipse spans r1↔r2; tangential burn at each orbit's apsis
    const tp = Math.min(r1, r2), ta = Math.max(r1, r2);
    const d1 = Math.abs(vAt(tp, ta, r1) - vAt(A.rp, A.ra, r1));
    const d2 = Math.abs(vAt(B.rp, B.ra, r2) - vAt(tp, ta, r2));
    if (d1 + d2 < best) { best = d1 + d2; dv1b = d1; dv2b = d2; single = false; }
    // single tangential burn where the orbits cross at a common apsis radius
    if (Math.abs(r1 - r2) < 1) {
      const d = Math.abs(vAt(A.rp, A.ra, r1) - vAt(B.rp, B.ra, r1));
      if (d < best) { best = d; dv1b = d; dv2b = 0; single = true; }
    }
  }));
  // R3.2 edge-cost flag (guarded, OPT-IN, default OFF): today this transfer
  // is purely coaxial — it never charges anything for the two orbits being
  // in different planes (critique 5's "assumes latitude-derived planes" gap,
  // here it's worse — no plane term at all for same-body node edges). When
  // EITHER node's spec sets priceOrientation:true, add the REAL plane-change
  // angle between the authored {i, Ω} pairs (progDvPlaneChangeFull, spherical
  // law of cosines) at burn 1's radius, combined vectorially with the
  // existing tangential burn (progDvCombined's sqrt-sum convention) — this
  // repricing is OFF by default so no existing mission's ΔV total moves;
  // absent lan_deg on either side is treated as Ω=0 (same convention the
  // renderer/physics fall back to).
  if (priceOrientation && best < Infinity) {
    const i1 = oa.inclination || 0, lan1 = oa.lan_deg || 0;
    const i2 = ob.inclination || 0, lan2 = ob.lan_deg || 0;
    if (Math.abs(i1 - i2) > 1e-9 || Math.abs(lan1 - lan2) > 1e-9) {
      const dvPlane_kms = progDvPlaneChangeFull(body, Math.min(A.rp, A.ra) - b.R, i1, lan1, i2, lan2) / 1000;
      const dv1Combined_kms = Math.sqrt(dv1b * dv1b + dvPlane_kms * dvPlane_kms);
      best = dv1Combined_kms + dv2b; // plane surcharge folds into burn 1, burn 2 unchanged
      dv1b = dv1Combined_kms;
    }
  }
  return { total_ms: best * 1000, dv1_ms: dv1b * 1000, dv2_ms: dv2b * 1000, single };
}

/**
 * ΔV (m/s) to depart from `orbit` around `body` onto a hyperbolic/escape trajectory
 * with hyperbolic excess speed v_inf_kms (km/s).  Burn happens at periapsis.
 */
function _nmDvDepart(body, orbit, v_inf_kms) {
  const b  = PROG_BODIES[body];
  const r  = b.R + (orbit.perigee ?? orbit.apogee ?? 0);
  const v0 = _nmOrbitVAtR(body, orbit, r);
  const ve = Math.sqrt(v_inf_kms * v_inf_kms + 2 * b.mu / r);
  return Math.abs(ve - v0) * 1000;
}

/**
 * Compute the ΔV (m/s) for a transfer between two node objects that carry `.orbit`.
 * Returns { dv, note, method } or null if no model applies.
 *
 * Key property: never uses the graph. Any orbit → any orbit goes through physics.
 */
function progNmComputeEdgeDv(fromId, toId) {
  // Resolve node objects (built-in + custom)
  const allNodes = [
    ...PROG_NM_NODES,
    ...(PROG_ACTIVE_PROGRAM?.nodeMapCustomNodes || []).map(cn => ({
      id: cn.nodeId, orbit: cn.orbit || null,
      // R3.2 edge-cost flag: OPT-IN per node, absent = false (never on for
      // built-ins, which carry no priceOrientation field at all).
      priceOrientation: !!cn.priceOrientation,
    })),
  ];
  const nA = allNodes.find(n => n.id === fromId);
  const nB = allNodes.find(n => n.id === toId);

  const result = _nmDvPhysics(nA, nB);
  if (result) return result;
  // Try reverse (most transfers symmetric)
  const rev = _nmDvPhysics(nB, nA);
  if (rev) return { ...rev, note: rev.note + ' (reversed)' };
  return null;
}

/**
 * Physics engine: compute ΔV from nodeA to nodeB using orbital mechanics.
 * Both nodes must have an `orbit` field.
 */
function _nmDvPhysics(nA, nB) {
  const oa = nA?.orbit, ob = nB?.orbit;
  if (!oa || !ob) return null;

  // ── Same-body transfers ──────────────────────────────────────────────────

  if (oa.body === ob.body) {
    const body = oa.body;

    // Surface → surface: trivial
    if (oa.type === 'surface' && ob.type === 'surface')
      return { dv: 0, note: 'Same surface', method: 'trivial' };

    // Surface → orbit (ascent)
    if (oa.type === 'surface') {
      const h = ob.perigee ?? ob.apogee ?? 0;
      if (body === 'Earth')  return { dv: 9400, note: 'Earth ascent (gravity + drag losses included)', method: 'empirical' };
      if (body === 'Moon')   return { dv: Math.round(progDvLunarAscent(h)), note: `Lunar ascent to ${h} km`, method: 'scaled model' };
      if (body === 'Mars')   return { dv: Math.round(progDvMarsAscent(h)),  note: `Mars ascent to ${h} km`, method: 'scaled model' };
    }

    // Orbit → surface (descent, symmetric with ascent for planning)
    // Guard: only for actual orbits, not transit/escape trajectories
    if (ob.type === 'surface' && (oa.type === 'circular' || oa.type === 'elliptic')) {
      const h = oa.perigee ?? oa.apogee ?? 0;
      if (body === 'Earth')  return { dv: 9400, note: 'Earth deorbit/reentry', method: 'empirical' };
      if (body === 'Moon')   return { dv: Math.round(progDvLunarAscent(h)), note: `Lunar descent from ${h} km`, method: 'scaled model' };
      if (body === 'Mars')   return { dv: Math.round(progDvMarsAscent(h)),  note: `Mars descent from ${h} km`, method: 'scaled model' };
    }

    // circular/elliptic orbit → escape velocity
    if (ob.type === 'escape' && (oa.type === 'circular' || oa.type === 'elliptic')) {
      const c3 = ob.c3 ?? 0;
      const r  = PROG_BODIES[body].R + (oa.perigee ?? oa.apogee ?? 0);
      const v0 = _nmOrbitVAtR(body, oa, r);
      const ve = Math.sqrt(Math.max(0, 2 * PROG_BODIES[body].mu / r + c3));
      return { dv: Math.round(Math.abs(ve - v0) * 1000), note: `Escape from ${body} at ${oa.perigee ?? oa.apogee ?? 0} km (C3=${c3} km²/s²)`, method: 'vis-viva' };
    }

    // circular/elliptic orbit → transit departure (TLI, TMI, etc.)
    // Guard: oa must be an actual orbit (not already a transit/escape trajectory)
    if (ob.type === 'transit' && (ob.departure_body === body || ob.body === body)
        && (oa.type === 'circular' || oa.type === 'elliptic')) {
      const c3  = ob.c3 ?? 0;
      const r   = PROG_BODIES[body].R + (oa.perigee ?? oa.apogee ?? 185);
      const v0  = _nmOrbitVAtR(body, oa, r);
      const ve  = Math.sqrt(Math.max(0, 2 * PROG_BODIES[body].mu / r + c3));
      const alt = Math.round(r - PROG_BODIES[body].R);
      const dest = ob.destination || '?';
      return { dv: Math.round(Math.abs(ve - v0) * 1000),
        note: `Departure burn from ${alt} km, C3=${c3} km²/s² → ${dest}`, method: 'vis-viva' };
    }

    // Two circular/elliptic orbits around same body — proper coaxial vis-viva transfer
    // (both perigee AND apogee matter). Guard: actual orbits only, not transit/escape.
    if ((oa.type === 'circular' || oa.type === 'elliptic') &&
        (ob.type === 'circular' || ob.type === 'elliptic')) {
      const t = _nmCoaxialTransferDv(body, oa, ob, !!(nA.priceOrientation || nB.priceOrientation));
      if (!t) return null;
      if (t.total_ms < 1) return { dv: 0, note: 'Same orbit', method: 'trivial' };
      const bothCirc = oa.type === 'circular' && ob.type === 'circular';
      const label = t.single ? 'Single-burn transfer (shared apsis)'
                  : bothCirc ? 'Hohmann transfer' : 'Bi-tangent transfer';
      const note = t.single
        ? `${label}: ${Math.round(t.dv1_ms)} m/s at shared apsis around ${body}`
        : `${label}: ${Math.round(t.dv1_ms)} + ${Math.round(t.dv2_ms)} m/s around ${body}`;
      return { dv: Math.round(t.total_ms), note, method: label };
    }

    // Unhandled same-body combination (e.g. transit→transit, escape→transit)
    return null;
  }

  // ── Transit node → destination body orbit ───────────────────────────────
  // Must be checked BEFORE general body→body cases (transit nodes carry a
  // source body, so they would otherwise match Earth↔Moon etc. incorrectly).

  // TLC (or any lunar transit) → Moon surface or orbit: LOI only (not TLI — already in transit)
  if (oa.type === 'transit' && oa.destination === 'Moon' && ob.body === 'Moon') {
    if (ob.type === 'surface') {
      // LOI to a low capture orbit + descent
      const loi     = progDvLOI(100, 185);
      const descent = progDvLunarAscent(100); // symmetric: ascent ≈ descent ΔV
      return { dv: Math.round(loi + descent),
        note: `LOI to 100 km: ${Math.round(loi)} m/s  +  Lunar descent: ${Math.round(descent)} m/s`,
        method: 'patched-conic' };
    }
    const h_llo = ob.perigee ?? ob.apogee ?? 100;
    const loi = progDvLOI(h_llo, 185);
    return { dv: Math.round(loi),
      note: `LOI to ${h_llo} km LLO`,
      method: 'patched-conic' };
  }

  // Interplanetary transit → target body orbit or surface (arrival capture)
  if (oa.type === 'transit') {
    const dest = oa.destination || oa.arrival_body;
    if (dest === ob.body) {
      let dvCapture = null;
      let note = '';
      if (ob.type === 'surface') {
        // Capture to low reference orbit + powered descent
        if (ob.body === 'Mars') {
          const moi     = progDvMOI(400);
          const descent = progDvMarsAscent(400); // ascent ≈ descent
          dvCapture = moi + descent;
          note = `MOI to 400 km: ${Math.round(moi)} m/s  +  Mars descent: ${Math.round(descent)} m/s`;
        } else if (ob.body === 'Venus') {
          dvCapture = progDvVOI(300);
          note = `VOI to 300 km (Venus surface via aerobraking — entry ΔV not modeled)`;
        }
      } else {
        const h_arr = ob.perigee ?? ob.apogee ?? 400;
        if (ob.body === 'Mars')  { dvCapture = progDvMOI(h_arr); note = `Mars orbit insertion to ${h_arr} km`; }
        if (ob.body === 'Venus') { dvCapture = progDvVOI(h_arr); note = `Venus orbit insertion to ${h_arr} km`; }
      }
      if (dvCapture !== null)
        return { dv: Math.round(dvCapture), note, method: 'patched-conic' };
    }
  }

  // ── Cross-body: Earth ↔ Moon ──────────────────────────────────────────────

  if (oa.body === 'Earth' && ob.body === 'Moon' &&
      (oa.type === 'circular' || oa.type === 'elliptic' || oa.type === 'surface')) {
    // Generalized TLI from any Earth orbit altitude
    const h_park = oa.perigee ?? oa.apogee ?? 185;
    const tli    = progDvTLI(h_park);
    const h_llo  = (ob.type === 'surface') ? 0 : (ob.perigee ?? ob.apogee ?? 100);
    const loi    = progDvLOI(h_llo === 0 ? 100 : h_llo, h_park);
    if (ob.type === 'surface') {
      const descent = progDvLunarAscent(100);
      return { dv: Math.round(tli + loi + descent),
        note: `TLI from ${h_park} km: ${Math.round(tli)} m/s  +  LOI to 100 km: ${Math.round(loi)} m/s  +  Lunar descent: ${Math.round(descent)} m/s`,
        method: 'Hohmann/patched-conic' };
    }
    return { dv: Math.round(tli + loi),
      note: `TLI from ${h_park} km: ${Math.round(tli)} m/s  +  LOI to ${h_llo} km: ${Math.round(loi)} m/s`,
      method: 'Hohmann/patched-conic' };
  }

  if (oa.body === 'Moon' && ob.body === 'Earth' &&
      (oa.type === 'circular' || oa.type === 'elliptic')) {
    const h_llo  = oa.perigee ?? oa.apogee ?? 100;
    const h_park = (ob.type === 'surface') ? 0 : (ob.perigee ?? ob.apogee ?? 185);
    return { dv: Math.round(progDvTEI(h_llo, Math.max(h_park, 185))),
      note: `TEI from ${h_llo} km LLO → ${h_park > 0 ? h_park + ' km' : 'Earth surface'}`,
      method: 'patched-conic' };
  }

  // ── Cross-body: Moon → interplanetary transit ─────────────────────────────
  // Escape Moon, then burn from Moon's orbital altitude above Earth

  if (oa.body === 'Moon' && ob.type === 'transit' &&
      (oa.type === 'circular' || oa.type === 'elliptic' || oa.type === 'surface')) {
    const mu_M    = PROG_BODIES.Moon.mu;
    const r_M     = PROG_BODIES.Moon.R + (oa.perigee ?? oa.apogee ?? 100);
    const v_cM    = _nmOrbitVAtR('Moon', oa, r_M);           // current Moon orbit speed
    const v_escM  = Math.sqrt(2 * mu_M / r_M);               // Moon escape speed at periapsis
    const dv_esc  = Math.abs(v_escM - v_cM) * 1000;          // m/s to escape Moon

    // After Moon SOI escape, approximate position = Moon's orbital altitude from Earth
    const r_Eorb  = PROG_MOON_ORBIT_R;                        // ~384,400 km
    const mu_E    = PROG_BODIES.Earth.mu;
    const v_Ecirc = Math.sqrt(mu_E / r_Eorb);                 // circular speed at Moon orbital alt
    const c3      = ob.c3 ?? 8.7;
    const v_inj   = Math.sqrt(Math.max(0, 2 * mu_E / r_Eorb + c3));
    const dv_dep  = Math.abs(v_inj - v_Ecirc) * 1000;        // m/s interplanetary departure

    const dest = ob.destination || '?';
    return { dv: Math.round(dv_esc + dv_dep),
      note: `Moon escape: ${Math.round(dv_esc)} m/s  +  departure at lunar altitude: ${Math.round(dv_dep)} m/s (→ ${dest})`,
      method: 'patched-conic' };
  }

  // ── Cross-body: Earth orbit → interplanetary transit ─────────────────────
  // Guard: oa must be an actual orbit (not already a transit/escape trajectory itself)

  if (oa.body === 'Earth' && ob.type === 'transit' &&
      (oa.type === 'circular' || oa.type === 'elliptic')) {
    const c3     = ob.c3 ?? 8.7;
    const h_park = oa.perigee ?? oa.apogee ?? 185;
    const r      = PROG_BODIES.Earth.R + h_park;
    const v0     = _nmOrbitVAtR('Earth', oa, r);
    const vinj   = Math.sqrt(Math.max(0, 2 * PROG_BODIES.Earth.mu / r + c3));
    const dest   = ob.destination || '?';
    return { dv: Math.round(Math.abs(vinj - v0) * 1000),
      note: `Injection from ${h_park} km, C3=${c3} km²/s² (→ ${dest})`,
      method: 'vis-viva' };
  }

  return null;   // no model — caller may show "enter manually"
}

// ── R5 — node-map coherence pass ──────────────────────────────────────────────
// The node map and trajectory view become two projections of ONE dataset.
// These two pure helpers are extracted so the layout/annotation logic is
// unit-testable (see tests/math.test.js) without constructing SVG or DOM.

// SOI-derived layout radius (2026-07-10, R5 item 1). Replaces the hand-set
// `soiR` constants in 570's _missionNmLayout with values DERIVED from real
// SOI physics (physSoiRadius, 386) — log-scaled and anchored to Earth's
// legacy 150px radius so the layout stays visually reasonable (the point is
// provenance, not literal km; giant planets clamp together at the top of the
// range — a known cosmetic limit, not a physics one). `fallback` is the old
// hand-set constant for that body; used verbatim if physSoiRadius is
// unavailable (guard) or returns a non-finite/zero radius.
function _nmSoiLayoutRadius(body, fallback) {
  if (typeof physSoiRadius !== 'function') return fallback;
  let soi, soiEarth;
  try { soi = physSoiRadius(body); soiEarth = physSoiRadius('Earth'); }
  catch (err) { return fallback; }
  if (!soi || !isFinite(soi) || soi <= 0) return fallback;
  if (!soiEarth || !isFinite(soiEarth) || soiEarth <= 0) return fallback;
  const EARTH_R = 150, MIN_R = 45, MAX_R = 260, SCALE = 0.22;
  const r = EARTH_R * (1 + SCALE * Math.log(soi / soiEarth));
  return Math.max(MIN_R, Math.min(MAX_R, r));
}

// Physics annotation for a node-map maneuver edge (R5 item 2). `logIdx` is
// the mission log index of the MANEUVER event the edge represents (matches
// physics legs' `authIdx` — see 565's leg-building loop, `leg.authIdx = i`
// against the SAME m.log index space e._authIdx is stamped from). Looks up
// the converged physics leg for that index in the mission's side-table
// (`_physTrajByMission`, 565 — the ONLY sanctioned mission-physics
// side-table) via the injected `legLookup` (defaults to physMissionLeg so
// this stays pure/testable with a stub). Returns:
//   { flown:true,  tofSeconds, closestApproachKm|null, label }  — converged leg found
//   { flown:false, label }                                       — no/unconverged leg
// NEVER touches ΔV — solved-burn magnitude stays sourced from
// progNmComputeEdgeDv/dvOverride exclusively (byte-parity discipline); this
// function only adds a display annotation alongside that number.
function _nmEdgePhysicsAnnotation(missionId, logIdx, legLookup, caFn) {
  const lookup = legLookup || (typeof physMissionLeg === 'function' ? physMissionLeg : null);
  if (!lookup || missionId == null || logIdx == null) return { flown: false, label: 'estimated' };
  let leg = null;
  try { leg = lookup(missionId, logIdx); } catch (err) { leg = null; }
  if (!leg || !leg.converged) return { flown: false, label: 'estimated' };
  const tofSeconds = leg.tofPhysics != null ? leg.tofPhysics : leg.tof_s;
  let closestApproachKm = null;
  if (leg.dest && leg.samples && leg.samples.length) {
    const scan = caFn || (typeof _trajGizmoClosestApproach === 'function' ? _trajGizmoClosestApproach : null);
    if (scan) {
      try { const ca = scan(leg.samples, leg.dest); if (ca) closestApproachKm = ca.dKm; }
      catch (err) { closestApproachKm = null; }
    }
  }
  const tofDays = tofSeconds != null ? (tofSeconds / 86400) : null;
  const parts = ['flown ✓'];
  if (tofDays != null) parts.push(`TOF ${tofDays.toFixed(1)}d`);
  if (closestApproachKm != null) parts.push(`CA ${Math.round(closestApproachKm).toLocaleString()} km`);
  return { flown: true, tofSeconds, closestApproachKm, label: parts.join(' · ') };
}

// ── Phase 8 tests (pure JS, no DOM) ──────────────────────────────────────────