
// ─── PROGRAM MODULE — Phase 5: Pad & Spaceport ────────────────────────────────

 // seconds per sidereal day

// ── Pad struct ────────────────────────────────────────────────────────────────

/**
 * Create a launch pad.
 * @param {string} name              e.g. 'LC-39A'
 * @param {string} siteKey           e.g. 'KSC' — matches a key in LAUNCH_SITES
 * @param {number} recycleTimeHours  hours before pad is ready to launch again
 */
function progMakePad(name, shortCode, siteKey, recycleTimeHours) {
  return {
    padId:          progUUID(),
    name,
    shortCode:      shortCode ?? name,  // compact identifier for tight spaces
    siteKey,
    recycleTime:    recycleTimeHours,  // hours
    lastLaunchTime: null,              // T+ seconds; null = never launched (always ready)
  };
}



// ── LAN alignment window calculator ──────────────────────────────────────────



// ── Active program state & spaceport panel ─────────────────────────────────────

let PROG_ACTIVE_PROGRAM = null;



/** Render the spaceport pad list into #prog-pad-list. */
/** Load an LV Calculator .json file into the active program's vehicleDefinitions[]. */

/**
 * Convert a VehicleDefinition (LV .json) to LiveStage[] for use in a LAUNCH event.
 * Assigns propellant type based on Isp: >400 → LOX_LH2, 310-400 → LOX_CH4, else LOX_RP1.
 */
function progVehicleDefToLiveStages(vdef) {
  const stages = vdef.stageData || [];
  const names  = vdef.stageNames || [];
  return stages.map((sd, i) => {
    const isp  = sd.isp || 1;
    const prop = sd.prop || 0;
    const ptype = isp > 400 ? 'LOX_LH2' : isp > 310 ? 'LOX_CH4' : 'LOX_RP1';
    const tanks = prop > 0 ? [progMakeTank(ptype, prop)] : [];
    const name  = names[i] || ('Stage ' + (i + 1));
    return progMakeLiveStage(name, tanks, 0, sd.dry || 0, isp);
  });
}

/** Render the loaded vehicle list into #prog-vehicle-list. */


