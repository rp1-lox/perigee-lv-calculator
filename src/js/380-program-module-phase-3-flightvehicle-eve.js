
// ─── PROGRAM MODULE — Phase 3: FlightVehicle & Event Engine ──────────────────
//
// Structs: FlightVehicle, Event envelope.
// Executors: LAUNCH, BURN, SEPARATE, COAST, EXPEND.
// A BURN fires exactly one stage. Nothing expends automatically (Rules 2 & 4).

// ── Helpers ───────────────────────────────────────────────────────────────────
function progUUID() {
  return 'p' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-5);
}

const PROG_VEHICLE_COLORS = [
  '#61afef','#e5c07b','#98c379','#c678dd','#e06c75','#56b6c2','#d19a66','#be5046',
];
let _progColorIdx = 0;

// ── FlightVehicle ─────────────────────────────────────────────────────────────
function progMakeFlightVehicle(name, stages, orbitState, color) {
  return {
    vehicleId:       progUUID(),
    name:            name  ?? 'Vehicle',
    color:           color ?? PROG_VEHICLE_COLORS[_progColorIdx++ % PROG_VEHICLE_COLORS.length],
    stages:          stages ?? [],      // LiveStage[], bottom → top
    orbitState:      orbitState ?? null,
    status:          'PRELAUNCH',       // PRELAUNCH | ASCENT | ORBIT | TRANSFER | LANDED | EXPENDED
    parentVehicleId: null,
  };
}

/** Total mass of one live stage (dry + propellant remaining), kg. */
function progStageMass(liveStage) {
  return (liveStage.dry_mass ?? 0) + progStageRemainingProp(liveStage);
}

/** Total wet mass of a FlightVehicle (all stages), kg. */
function progVehicleTotalMass(fv) {
  return fv.stages.reduce((sum, s) => sum + progStageMass(s), 0);
}

// ── Rocket equation ───────────────────────────────────────────────────────────
const PROG_G0 = 9.80665; // m/s²

/** ΔV delivered by burning m_prop_consumed kg from wet mass m_wet, m/s. */
function progRocketEqDv(m_wet, m_prop_consumed, isp) {
  const m_final = m_wet - m_prop_consumed;
  if (m_wet <= 0 || m_final <= 0 || isp <= 0) return 0;
  return isp * PROG_G0 * Math.log(m_wet / m_final);
}

/** Propellant mass needed to deliver dv_ms from wet mass m_wet, kg. */
function progRocketEqPropNeeded(m_wet, dv_ms, isp) {
  if (isp <= 0 || m_wet <= 0) return 0;
  return m_wet * (1 - Math.exp(-dv_ms / (isp * PROG_G0)));
}

// ── Event factory ─────────────────────────────────────────────────────────────
function progMakeEvent(type, fields) {
  const ev = {
    eventId:   progUUID(),
    type,
    label:     type,
    vehicleId: null,
    tStart:    0,
    tEnd:      0,
    deltaV:    0,
    dvBudget:  {},
    fromNode:  null,
    toNode:    null,
    result:    'PENDING',
    warnings:  [],
  };
  return Object.assign(ev, fields);
}

// ── Program container ─────────────────────────────────────────────────────────
function progMakeProgram(name) {
  return {
    programId:             progUUID(),
    name:                  name ?? 'Untitled Program',
    missionClock:          0,        // T+ seconds; only COAST and LAUNCH advance this
    vehicles:              {},       // vehicleId → FlightVehicle (Phase 3+)
    pads:                  [],       // Pad[] (spec §3.2)
    vehicleDefinitions:    [],       // loaded LV Calculator .json files (spec §3.3; Phase 10)
    spacecraftDefinitions: [],       // SpacecraftDefinition[] (spec §3.4; Phase 9)
    events:                [],       // ordered event list (Phase 7 owns rendering)
    nodeMapCustomNodes:    [],       // user-added nodes (Phase 8)
    nodeMapCustomEdges:    [],       // user-added edges between custom nodes
    nodeMapNodePos:        {},       // nodeId → {cx,cy} position overrides (drag-to-move)
    nodeMapActiveNodes:    PROG_NM_NODES.filter(n => n.zone === 'earth' && n.orbit?.type !== 'surface').map(n => n.id), // earth orbitals on by default; surface nodes tied to planet discs
    performanceCases:      [],       // archived perf cases (Phase 10)
    warnings:              [],
  };
}

// ── Event executors ───────────────────────────────────────────────────────────

/**
 * LAUNCH: creates a FlightVehicle at the target orbit and adds it to the program.
 * event.stages     — LiveStage[] for the initial stack (upper stage + spacecraft)
 * event.targetOrbit — { body, alt_km, inc_deg, lan_deg }
 * event.ascent_duration_s — defaults to 600
 */
function progExecLaunch(program, event) {
  const o = event.targetOrbit ?? {};
  const orbit = progMakeOrbitalState(o.body ?? 'Earth', o.alt_km ?? 185, o.inc_deg ?? 0, o.lan_deg ?? 0);
  // Resolve spacecraft stages: LV stages (bottom) + spacecraft stages (top)
  let launchStages = event.stages ? [...event.stages] : [];
  if (event.spacecraftId && program.spacecraftDefinitions?.length) {
    const scd = program.spacecraftDefinitions.find(s => s.spacecraftId === event.spacecraftId);
    if (scd) launchStages = [...launchStages, ...progSpacecraftToLiveStages(scd)];
  }
  const fv = progMakeFlightVehicle(event.label ?? 'Vehicle', launchStages, orbit, event.color ?? null);
  fv.status = 'ORBIT';
  program.vehicles[fv.vehicleId] = fv;
  event.vehicleId = fv.vehicleId;
  event.tEnd      = (event.tStart ?? 0) + (event.ascent_duration_s ?? 600);
  event.result    = 'SUCCESS';
  return { result: 'SUCCESS', vehicleId: fv.vehicleId };
}

/**
 * BURN: fires exactly one stage. Consumes propellant via rocket equation.
 * event.stagingStageId    — stageDefinitionId of firing stage; null = bottom of stack
 * event.burnType          — 'HOHMANN'|'TLI'|'LOI'|'TMI'|'MOI'|'TVI'|'VOI'|'CIRC'|
 *                           'PLANE_CHANGE'|'COMBINED'|'PARTIAL'|…
 * event.dvTarget          — target ΔV in m/s (ignored for PARTIAL)
 * event.propStopThreshold — for PARTIAL: fraction remaining when burn halts (0–1)
 * event.toNode            — NodeMapId; updates orbitState if non-transfer node
 */
function progExecBurn(program, event) {
  const fv = program.vehicles[event.vehicleId];
  if (!fv) {
    event.result = 'FAILED';
    event.warnings = ['Vehicle not found: ' + event.vehicleId];
    return { result: 'FAILED' };
  }

  const stageIdx = (event.stagingStageId != null)
    ? fv.stages.findIndex(s => s.stageDefinitionId === event.stagingStageId)
    : 0;
  if (stageIdx < 0) {
    event.result = 'FAILED';
    event.warnings = ['Firing stage not found: ' + event.stagingStageId];
    return { result: 'FAILED' };
  }

  const fs        = fv.stages[stageIdx];
  const isp       = fs.isp ?? 0;
  const m_wet     = progVehicleTotalMass(fv);
  const prop_avail = progStageRemainingProp(fs);
  const warnings  = [];

  let prop_to_burn, dv_actual, result;

  if (event.burnType === 'PARTIAL' && event.propStopThreshold != null) {
    prop_to_burn = prop_avail * (1 - event.propStopThreshold);
    dv_actual    = progRocketEqDv(m_wet, prop_to_burn, isp);
    result       = 'SUCCESS';
  } else {
    const dv_target   = event.dvTarget ?? 0;
    const prop_needed = progRocketEqPropNeeded(m_wet, dv_target, isp);
    if (prop_needed > prop_avail) {
      prop_to_burn = prop_avail;
      dv_actual    = progRocketEqDv(m_wet, prop_to_burn, isp);
      result       = 'MARGINAL';
      warnings.push('\u26a0 Insufficient prop: delivered ' + Math.round(dv_actual) + ' m/s vs ' + Math.round(dv_target) + ' m/s target');
    } else {
      prop_to_burn = prop_needed;
      dv_actual    = dv_target;
      result       = 'SUCCESS';
    }
  }

  progBurnPropellant(fs, prop_to_burn);
  progRecordBurn(fs, event.eventId, dv_actual, prop_to_burn, event.tStart ?? 0, event.tEnd ?? event.tStart ?? 0);

  event.deltaV   = dv_actual;
  event.result   = result;
  event.warnings = warnings;

  // Update orbital state if toNode resolves to a non-transfer node
  if (event.toNode) {
    const node = progGetNode(event.toNode);
    if (node && !node.isTransfer) {
      if (node.surface) {
        fv.orbitState = progMakeSurfaceState(node.body);
        fv.status = 'LANDED';
      } else if (node.apogee != null) {
        // Preserve vehicle inclination/LAN; update body + altitude from node
        fv.orbitState = {
          body:        node.body,
          apogee:      node.apogee,
          perigee:     node.perigee ?? node.apogee,
          inclination: fv.orbitState?.inclination ?? 0,
          lan:         fv.orbitState?.lan ?? 0,
          epoch:       0,
          surface:     false,
        };
        fv.status = 'ORBIT';
      }
    }
  }
  return { result, dv_actual, prop_consumed: prop_to_burn, warnings };
}

/**
 * SEPARATE: splits a FlightVehicle at separationIndex.
 * Lower portion = stages[0 .. separationIndex-1], upper = stages[separationIndex ..].
 * Neither is auto-expended (Rule 2). Both inherit the parent's orbitState.
 */
function progExecSeparate(program, event) {
  const fv = program.vehicles[event.vehicleId];
  if (!fv) { event.result = 'FAILED'; return { result: 'FAILED', warnings: ['Vehicle not found'] }; }

  const idx = event.separationIndex ?? 1;
  if (idx <= 0 || idx >= fv.stages.length) {
    event.result = 'FAILED';
    return { result: 'FAILED', warnings: ['Invalid separationIndex: ' + idx + ' for stack of ' + fv.stages.length] };
  }

  const fvL = progMakeFlightVehicle(fv.name + '-L', fv.stages.slice(0, idx),  fv.orbitState, fv.color);
  const fvU = progMakeFlightVehicle(fv.name + '-U', fv.stages.slice(idx),      fv.orbitState, null);
  fvL.status = fvU.status = fv.status;
  fvL.parentVehicleId = fvU.parentVehicleId = fv.vehicleId;

  delete program.vehicles[fv.vehicleId];
  program.vehicles[fvL.vehicleId] = fvL;
  program.vehicles[fvU.vehicleId] = fvU;

  event.result = 'SUCCESS'; event.warnings = [];
  return { result: 'SUCCESS', lowerVehicleId: fvL.vehicleId, upperVehicleId: fvU.vehicleId };
}

/**
 * COAST: advances mission clock and applies boiloff to all cryo tanks.
 * event.vehicleId — specific vehicle or 'ALL' (default)
 * event.duration_s — coast duration in seconds
 */
function progExecCoast(program, event) {
  const dur_s    = event.duration_s ?? 0;
  const dur_days = dur_s / 86400;

  const ids = (!event.vehicleId || event.vehicleId === 'ALL')
    ? Object.keys(program.vehicles)
    : [event.vehicleId];

  ids.forEach(vid => {
    const v = program.vehicles[vid];
    if (v && v.status !== 'EXPENDED') v.stages.forEach(s => progApplyStageBoiloff(s, dur_days));
  });

  program.missionClock += dur_s;
  event.tEnd   = (event.tStart ?? 0) + dur_s;
  event.result = 'SUCCESS'; event.warnings = [];
  return { result: 'SUCCESS' };
}

/**
 * EXPEND: explicitly marks a FlightVehicle as expended (Rule 2 — user-initiated only).
 */
function progExecExpend(program, event) {
  const fv = program.vehicles[event.vehicleId];
  if (!fv) { event.result = 'FAILED'; return { result: 'FAILED', warnings: ['Vehicle not found'] }; }
  fv.status    = 'EXPENDED';
  event.result = 'SUCCESS'; event.warnings = [];
  return { result: 'SUCCESS' };
}

/** Dispatch an event to the appropriate executor. */
function progDispatchEvent(program, event) {
  switch (event.type) {
    case 'LAUNCH':               return progExecLaunch(program, event);
    case 'BURN':                 return progExecBurn(program, event);
    case 'SEPARATE':             return progExecSeparate(program, event);
    case 'COAST':                return progExecCoast(program, event);
    case 'EXPEND':               return progExecExpend(program, event);
    case 'DOCK':                 return progExecDock(program, event);
    case 'TRANSFER_PROPELLANT':  return progExecTransferPropellant(program, event);
    case 'TRANSFER_CREW':        return progExecTransferCrew(program, event);
    case 'TRANSFER_STAGE':       return progExecTransferStage(program, event);
    case 'LAND':                 return progExecLand(program, event);
    case 'ASCENT_SURFACE':       return progExecAscentSurface(program, event);
    case 'RECONFIGURE':          return progExecReconfigure(program, event);
    default: return { result: 'FAILED', warnings: ['Unknown event type: ' + event.type] };
  }
}
