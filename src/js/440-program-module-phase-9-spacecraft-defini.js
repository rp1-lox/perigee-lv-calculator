
// ─── PROGRAM MODULE — Phase 9: Spacecraft Definition Editor ─────────────────
//
// SpacecraftDefinition: a named, ordered stage stack stored in the program.
// LAUNCH events may reference a spacecraftId; the spacecraft's stages are
// appended on top of (i.e. above) the launch vehicle upper stage.
//
// stage stack convention (same as Phase 2/3): stages[0]=bottom, stages[last]=top.
// A spacecraft typically sits above the LV upper stage, so spacecraft stages are
// appended AFTER the LV stages in the array.

// ── Structs ───────────────────────────────────────────────────────────────────

/**
 * A single stage blueprint inside a SpacecraftDefinition.
 * These are serializable (no live propellant state). Convert via progSpacecraftToLiveStages.
 */
function progMakeSpacecraftStageDef(name) {
  return {
    stageId:             progUUID(),
    name:                name ?? 'Stage',
    dry_mass:            500,        // kg
    isp:                 320,        // s, vacuum Isp
    propKg:              0,          // propellant capacity kg
    propType:            'MMH/NTO',  // propellant type key
    // Spec §3.4 extended fields
    crewCapacity:        0,          // number of crew seats
    dockingPorts:        0,          // number of docking ports
    tunnelCapable:       false,      // pressurised tunnel to adjacent stage
    isLandingTruss:      false,      // structural-only; auto-candidate for surface separation (spec §3.4)
    descentPropFraction: 0,          // fraction of propKg reserved for powered descent (0–1)
  };
}

function progMakeSpacecraftDefinition(name) {
  return {
    spacecraftId: progUUID(),
    name:         name ?? 'Spacecraft',
    stages:       [],  // SpacecraftStageDef[], bottom → top
  };
}

/**
 * Convert a SpacecraftDefinition to LiveStages[] for inclusion in a LAUNCH event.
 * Returns stages ordered bottom → top, matching the stage stack convention.
 */
function progSpacecraftToLiveStages(scd) {
  return scd.stages.map(def => {
    const tanks = def.propKg > 0
      ? [progMakeTank(def.propType || 'MMH/NTO', def.propKg)]
      : [];
    const ls = progMakeLiveStage(def.stageId, tanks, 0, def.dry_mass, def.isp);
    ls.crewCapacity        = def.crewCapacity        ?? 0;
    ls.dockingPorts        = def.dockingPorts         ?? 0;
    ls.tunnelCapable       = def.tunnelCapable        ?? false;
    ls.isLandingTruss      = def.isLandingTruss       ?? false;
    ls.descentPropFraction = def.descentPropFraction  ?? 0;
    return ls;
  });
}

// ── Spacecraft editor UI ──────────────────────────────────────────────────────

let _progScSelId = null;  // currently selected spacecraft ID in editor modal









