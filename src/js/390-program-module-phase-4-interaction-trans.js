
// ─── PROGRAM MODULE — Phase 4: Interaction & Transfer Events ─────────────────
//
// DOCK, TRANSFER_PROPELLANT, TRANSFER_CREW, TRANSFER_STAGE, LAND,
// ASCENT_SURFACE, RECONFIGURE.
//
// Key rule: LAND is zero ΔV / zero prop (Rule 5). Powered descent prop is
// consumed by preceding BURN events. ASCENT_SURFACE DOES consume prop (not
// in Rule 5's exclusion list).

/** DOCK: merge two FlightVehicles that share the same OrbitalState (Rule 3).
 *  event.vehicleIds     = [id1, id2]
 *  event.bottomVehicleId = which vehicle's stages form the lower portion (default: vehicleIds[0])
 *
 *  Both source vehicles are removed from program.vehicles.
 *  A new merged FlightVehicle is created and added.
 */
function progExecDock(program, event) {
  const [idA, idB] = event.vehicleIds ?? [];
  const fvA = program.vehicles[idA];
  const fvB = program.vehicles[idB];
  if (!fvA || !fvB) {
    event.result = 'FAILED'; event.warnings = ['One or both vehicles not found'];
    return { result: 'FAILED' };
  }
  if (!progOrbitalStateMatch(fvA.orbitState, fvB.orbitState)) {
    event.result = 'FAILED';
    event.warnings = ['\u26a0 Orbital states do not match — burn to match first'];
    return { result: 'FAILED' };
  }

  // Bottom vehicle goes at stages[0..], other goes on top
  const bottomId = event.bottomVehicleId ?? idA;
  const [bot, top] = bottomId === idA ? [fvA, fvB] : [fvB, fvA];
  const mergedStages = [...bot.stages, ...top.stages];

  const merged = progMakeFlightVehicle(bot.name + '+' + top.name, mergedStages, bot.orbitState, bot.color);
  merged.status = bot.status;

  // Info note if no tunnel-capable port between the docking faces
  const warns = [];
  const botTop  = bot.stages[bot.stages.length - 1];
  const topBot  = top.stages[0];
  if (botTop && !botTop.tunnelCapable && topBot && !topBot.tunnelCapable) {
    warns.push('// No tunnel-capable port at docking face — EVA required for crew transfer');
  }

  delete program.vehicles[idA];
  delete program.vehicles[idB];
  program.vehicles[merged.vehicleId] = merged;

  event.vehicleId = merged.vehicleId;
  event.result = 'SUCCESS'; event.warnings = warns;
  return { result: 'SUCCESS', vehicleId: merged.vehicleId };
}

/** TRANSFER_PROPELLANT: move propellant between stages of the same (merged) vehicle.
 *  Same propellant type only. Zero ΔV, zero clock (Rule 4).
 *  event.vehicleId
 *  event.sourceStageId    stageDefinitionId of source
 *  event.destStageId      stageDefinitionId of dest
 *  event.propellantType
 *  event.mass_kg
 */
function progExecTransferPropellant(program, event) {
  const fv = program.vehicles[event.vehicleId];
  if (!fv) { event.result = 'FAILED'; event.warnings = ['Vehicle not found']; return { result: 'FAILED' }; }

  const src = fv.stages.find(s => s.stageDefinitionId === event.sourceStageId);
  const dst = fv.stages.find(s => s.stageDefinitionId === event.destStageId);
  if (!src || !dst) { event.result = 'FAILED'; event.warnings = ['Stage not found']; return { result: 'FAILED' }; }

  const pt = event.propellantType;
  let to_take = event.mass_kg ?? 0;

  // Drain from source tanks of matching type
  for (const tank of src.tanks) {
    if (tank.propellantType !== pt) continue;
    const drain = Math.min(tank.fill, to_take);
    tank.fill -= drain; to_take -= drain;
    if (to_take <= 0) break;
  }
  const transferred = (event.mass_kg ?? 0) - to_take;

  // Fill into dest tanks of matching type
  let to_fill = transferred;
  for (const tank of dst.tanks) {
    if (tank.propellantType !== pt) continue;
    const space = tank.capacity - tank.fill;
    const fill  = Math.min(space, to_fill);
    tank.fill += fill; to_fill -= fill;
    if (to_fill <= 0) break;
  }

  const warns = [];
  if (to_take > 0) warns.push('\u26a0 Source had less prop than requested: short ' + Math.round(to_take) + ' kg');
  if (to_fill > 0) warns.push('\u26a0 Dest tanks full, ' + Math.round(to_fill) + ' kg could not be received');

  event.result = 'SUCCESS'; event.warnings = warns;
  return { result: 'SUCCESS', transferred_kg: transferred };
}

/** TRANSFER_CREW: move crew between stages of the same (or same-orbit) vehicle.
 *  event.vehicleId
 *  event.sourceStageId   stageDefinitionId
 *  event.destStageId     stageDefinitionId
 *  event.count
 *  event.subtype         'TUNNEL' | 'EVA'  (recorded for fidelity; no cost difference)
 */
function progExecTransferCrew(program, event) {
  const fv = program.vehicles[event.vehicleId];
  if (!fv) { event.result = 'FAILED'; event.warnings = ['Vehicle not found']; return { result: 'FAILED' }; }

  const src = fv.stages.find(s => s.stageDefinitionId === event.sourceStageId);
  const dst = fv.stages.find(s => s.stageDefinitionId === event.destStageId);
  if (!src || !dst) { event.result = 'FAILED'; event.warnings = ['Stage not found']; return { result: 'FAILED' }; }

  const move   = Math.min(src.crewAboard, event.count ?? 0);
  src.crewAboard -= move;
  dst.crewAboard += move;

  const warns = [];
  if (move < (event.count ?? 0)) warns.push('\u26a0 Only ' + move + ' crew available to transfer');

  event.result = 'SUCCESS'; event.warnings = warns;
  return { result: 'SUCCESS', transferred: move };
}

/** TRANSFER_STAGE: tug takes a stage from one vehicle and adds it to another.
 *  Both vehicles must be in the same orbit (post-dock context).
 *  The stage is removed from source and appended to the top of dest's stack.
 *  event.sourceVehicleId
 *  event.destVehicleId
 *  event.stageDefinitionId
 */
function progExecTransferStage(program, event) {
  const src = program.vehicles[event.sourceVehicleId];
  const dst = program.vehicles[event.destVehicleId];
  if (!src || !dst) { event.result = 'FAILED'; event.warnings = ['Vehicle not found']; return { result: 'FAILED' }; }

  const idx = src.stages.findIndex(s => s.stageDefinitionId === event.stageDefinitionId);
  if (idx < 0) { event.result = 'FAILED'; event.warnings = ['Stage not found in source']; return { result: 'FAILED' }; }

  const [stage] = src.stages.splice(idx, 1);
  dst.stages.push(stage);

  event.result = 'SUCCESS'; event.warnings = [];
  return { result: 'SUCCESS' };
}

/** LAND: set vehicle status to LANDED and orbitState to surface.
 *  Zero ΔV, zero propellant consumed (Rule 5).
 *  Powered descent propellant was consumed by preceding BURN events.
 *  event.vehicleId
 *  event.body              body name to land on (falls back to current orbitState.body)
 *  event.aerocapture       boolean — informational flag (no physics difference in Phase 4)
 */
function progExecLand(program, event) {
  const fv = program.vehicles[event.vehicleId];
  if (!fv) { event.result = 'FAILED'; event.warnings = ['Vehicle not found']; return { result: 'FAILED' }; }

  const body = event.body ?? fv.orbitState?.body ?? 'Moon';
  fv.status    = 'LANDED';
  fv.orbitState = progMakeSurfaceState(body);

  const warns = [];
  if (event.aerocapture) warns.push('// Aerocapture — no propellant consumed');

  event.deltaV   = 0;
  event.result   = 'SUCCESS'; event.warnings = warns;
  return { result: 'SUCCESS' };
}

/** ASCENT_SURFACE: ascend from a body surface to a target orbit.
 *  Computes ΔV from body model (progDvLunarAscent / progDvMarsAscent).
 *  Consumes propellant via rocket equation from the firing stage.
 *  event.vehicleId
 *  event.body                body name (falls back to current orbitState.body)
 *  event.targetOrbit         { alt_km, inc_deg, lan_deg }
 *  event.firingStageId       stageDefinitionId of firing stage (default: bottom)
 *  event.dv_override_ms      override body model ΔV (for Venus or custom bodies)
 */
function progExecAscentSurface(program, event) {
  const fv = program.vehicles[event.vehicleId];
  if (!fv || fv.status !== 'LANDED') {
    event.result = 'FAILED'; event.warnings = ['Vehicle not found or not LANDED'];
    return { result: 'FAILED' };
  }

  const body   = event.body ?? fv.orbitState?.body ?? 'Moon';
  const target = event.targetOrbit ?? {};
  const alt    = target.alt_km ?? 100;

  // Determine ascent ΔV from body model
  let dv_target;
  if (event.dv_override_ms != null) {
    dv_target = event.dv_override_ms;
  } else if (body === 'Moon') {
    dv_target = progDvLunarAscent(alt);
  } else if (body === 'Mars') {
    dv_target = progDvMarsAscent(alt);
  } else {
    event.result = 'FAILED'; event.warnings = ['No ascent model for body: ' + body + ' — use dv_override_ms'];
    return { result: 'FAILED' };
  }

  // Fire the specified stage (default: bottom)
  const stageIdx = event.firingStageId
    ? fv.stages.findIndex(s => s.stageDefinitionId === event.firingStageId)
    : 0;
  if (stageIdx < 0) { event.result = 'FAILED'; event.warnings = ['Firing stage not found']; return { result: 'FAILED' }; }

  const fs         = fv.stages[stageIdx];
  const isp        = fs.isp ?? 0;
  const m_wet      = progVehicleTotalMass(fv);
  const prop_avail = progStageRemainingProp(fs);
  const prop_need  = progRocketEqPropNeeded(m_wet, dv_target, isp);

  let dv_actual, result;
  const warns = [];
  if (prop_need > prop_avail) {
    dv_actual = progRocketEqDv(m_wet, prop_avail, isp);
    result    = 'MARGINAL';
    warns.push('\u26a0 Insufficient prop: delivered ' + Math.round(dv_actual) + ' m/s vs ' + Math.round(dv_target) + ' m/s target');
    progBurnPropellant(fs, prop_avail);
  } else {
    dv_actual = dv_target;
    result    = 'SUCCESS';
    progBurnPropellant(fs, prop_need);
  }

  progRecordBurn(fs, event.eventId, dv_actual, Math.min(prop_need, prop_avail), event.tStart ?? 0, event.tEnd ?? 0);

  fv.status    = 'ORBIT';
  fv.orbitState = progMakeOrbitalState(body, alt, target.inc_deg ?? 0, target.lan_deg ?? 0);

  event.deltaV = dv_actual; event.result = result; event.warnings = warns;
  return { result, dv_actual, prop_consumed: Math.min(prop_need, prop_avail) };
}

/** RECONFIGURE: the ONLY event that can reorder the stage stack.
 *  Internally: SEPARATE → RCS BURN → DOCK (not modeled separately here).
 *  event.vehicleId
 *  event.newStageOrder   array of stageDefinitionIds in desired order (same set, reordered)
 *  event.rcs_dv_ms       RCS ΔV for transposition (default 10 m/s, e.g. Apollo LM extraction)
 */
function progExecReconfigure(program, event) {
  const fv = program.vehicles[event.vehicleId];
  if (!fv) { event.result = 'FAILED'; event.warnings = ['Vehicle not found']; return { result: 'FAILED' }; }

  const order = event.newStageOrder ?? [];
  if (order.length !== fv.stages.length) {
    event.result = 'FAILED'; event.warnings = ['newStageOrder length must match current stage count'];
    return { result: 'FAILED' };
  }

  const reordered = order.map(id => fv.stages.find(s => s.stageDefinitionId === id));
  if (reordered.some(s => !s)) {
    event.result = 'FAILED'; event.warnings = ['Unknown stageDefinitionId in newStageOrder'];
    return { result: 'FAILED' };
  }

  fv.stages = reordered;
  event.deltaV   = event.rcs_dv_ms ?? 10;
  event.result   = 'SUCCESS'; event.warnings = [];
  return { result: 'SUCCESS' };
}
