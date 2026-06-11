
// ─── PROGRAM MODULE — Phase 2: Propellant & Boiloff ────────────────────────────
//
// Structs: Tank, LiveStage.
// Boiloff runs only during COAST events (Rule 4); not during burns, docking, or assembly.

// ── Tank ─────────────────────────────────────────────────────────────────────

/**
 * Create a Tank. Starts full (fill === capacity).
 * @param {string}  propellantType   - key into PROG_PROPELLANT_TYPES
 * @param {number}  capacity_kg      - maximum propellant mass, kg
 * @param {number}  [insulationFactor=1.0] - 1.0 = baseline MLI, <1.0 = better
 */
function progMakeTank(propellantType, capacity_kg, insulationFactor) {
  return {
    propellantType,
    capacity:         capacity_kg,
    fill:             capacity_kg,      // kg remaining
    insulationFactor: insulationFactor ?? 1.0,
  };
}

/**
 * Apply boiloff to a Tank for one COAST period. Mutates tank.fill.
 * Returns kg lost. Zero for non-cryo propellants.
 */
function progApplyBoiloff(tank, delta_t_days) {
  const pt = PROG_PROPELLANT_TYPES[tank.propellantType];
  if (!pt || pt.boiloff_rate === 0) return 0;
  const remaining = progBoiloff(tank.fill, pt.boiloff_rate, delta_t_days, tank.insulationFactor);
  const lost      = tank.fill - remaining;
  tank.fill       = remaining;
  return lost;
}

/**
 * Apply boiloff to all cryo tanks in a LiveStage for one COAST period.
 * Returns total kg lost across all tanks.
 */
function progApplyStageBoiloff(liveStage, delta_t_days) {
  return liveStage.tanks.reduce((sum, t) => sum + progApplyBoiloff(t, delta_t_days), 0);
}

// ── LiveStage ─────────────────────────────────────────────────────────────

/**
 * Create a live stage instance.
 * @param {string}   stageDefinitionId - ID from the stage library or vehicle JSON
 * @param {Tank[]}   tanks             - array of Tank objects for this stage
 * @param {number}   [crewAboard=0]
 */
function progMakeLiveStage(stageDefinitionId, tanks, crewAboard, dry_mass, isp) {
  return {
    stageDefinitionId,
    dry_mass:   dry_mass  ?? 0,        // kg — structural + engine dry mass
    isp:        isp       ?? 0,        // s  — vacuum Isp; set from stage def at load time
    tanks:      tanks ?? [],
    burnLog:    [],                    // BurnEntry[] appended by progRecordBurn
    status:     'ACTIVE',              // 'ACTIVE' | 'EXPENDED' | 'SEPARATED'
    crewAboard: crewAboard ?? 0,
  };
}

/**
 * Record a completed BURN event on a stage. Appends to burnLog.
 * @param {object} liveStage
 * @param {string} eventId        - event UUID from the timeline
 * @param {number} dvActual_ms    - ΔV actually delivered, m/s
 * @param {number} propUsed_kg    - propellant consumed, kg
 * @param {number} [t_start=0]   - mission clock, seconds
 * @param {number} [t_end=0]     - mission clock, seconds
 */
function progRecordBurn(liveStage, eventId, dvActual_ms, propUsed_kg, t_start, t_end) {
  liveStage.burnLog.push({
    eventId,
    dvActual_ms,
    propUsed_kg,
    t_start: t_start ?? 0,
    t_end:   t_end   ?? 0,
  });
}

/**
 * Drain propUsed_kg from the stage's tanks in order.
 * Returns kg actually drained (may be less if tanks run dry).
 * Note: Phase 3 will handle mixture ratios and mid-burn separation.
 */
function progBurnPropellant(liveStage, propUsed_kg) {
  let remaining = propUsed_kg;
  for (const tank of liveStage.tanks) {
    if (remaining <= 0) break;
    const drain = Math.min(tank.fill, remaining);
    tank.fill  -= drain;
    remaining  -= drain;
  }
  return propUsed_kg - remaining;
}

/** Total propellant remaining across all tanks in a stage, kg. */
function progStageRemainingProp(liveStage) {
  return liveStage.tanks.reduce((sum, t) => sum + t.fill, 0);
}

/** Total propellant capacity of a stage, kg (sum of all tank capacities). */
function progStageTotalCapacity(liveStage) {
  return liveStage.tanks.reduce((sum, t) => sum + t.capacity, 0);
}

/** Propellant load fraction for a stage (0 = empty, 1 = full). */
function progStageFillFraction(liveStage) {
  const cap = progStageTotalCapacity(liveStage);
  return cap > 0 ? progStageRemainingProp(liveStage) / cap : 0;
}
