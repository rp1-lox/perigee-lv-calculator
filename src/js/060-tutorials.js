
// ─── TUTORIALS / HELP ────────────────────────────────────────────────────────
// A self-contained help modal: topic list on the left, written walkthrough on the
// right. Opened from the header "Tutorials" button. Content reflects the real UI
// (button labels, file extensions, event types) so it stays accurate.

const TUTORIALS = [
  { id: 'welcome', title: 'Welcome & Overview', body: () => `
    <h3>Welcome to Rocket Playground</h3>
    <p>This tool has two halves, switched from the top bar:</p>
    <ul>
      <li><b>LV Calculator</b> — design a launch vehicle stage-by-stage and compute its performance. Sub-tabs: <b>Vehicles</b>, <b>Orbits</b>, <b>Results</b>.</li>
      <li><b>Program Manager</b> — build spacecraft, manage your vehicles, and plan multi-step missions. Sub-tabs: <b>Hangar</b> (a Spacecraft / Vehicle picker) and <b>Missions</b>.</li>
    </ul>
    <p class="tut-tip">The two halves connect: vehicles you save in the LV Calculator show up in the Hangar's <b>Vehicle</b> library, and spacecraft you build become payloads for missions.</p>
    <p>Pick a topic on the left to learn each area. A typical first run: <b>build a vehicle → save it → in the Hangar give a Vehicle a payload → plan a mission</b>.</p>` },

  { id: 'lv', title: 'LV Calculator — build a rocket', body: () => `
    <h3>Designing a launch vehicle</h3>
    <ol>
      <li>Go to <b>LV Calculator → Vehicles</b>.</li>
      <li>Set the number of stages and fill the stage table (dry mass, propellant, thrust, Isp). <b>Stage 1 is the bottom</b> (fires first).</li>
      <li>Use the <b>Stage Library</b> to drop in real stages instead of typing numbers. Add strap-on <b>boosters</b> and a <b>fairing</b> if needed.</li>
      <li>Stage-and-a-half (e.g. Atlas): edit a stage (✎ wrench) and enable <b>S1.5</b> to model a booster-engine jettison (BECO).</li>
      <li>Set your <b>payload</b>, <b>target orbit</b> (or escape C3) and <b>launch site</b>, then press <b>Calculate</b> → it jumps to <b>Results</b>.</li>
    </ol>
    <p class="tut-tip">Crossfeed / center-throttle tricores: edit the <b>booster</b> (✎ wrench) → <b>Parallel Staging</b> to model UR-700-style crossfeed or Falcon-Heavy throttle-down.</p>
    <p class="tut-tip">Save a finished design with <b>Save</b> → it downloads a <b>.vehicle</b> file and adds it to your presets. Load it later from the Hangar's <b>Vehicle</b> library.</p>` },

  { id: 'orbits', title: 'Orbits', body: () => `
    <h3>Defining and saving orbits</h3>
    <ol>
      <li>Open <b>LV Calculator → Orbits</b>.</li>
      <li>Enter perigee / apogee / inclination (or an escape C3) and watch the orbit diagram update.</li>
      <li><b>Save</b> the orbit to a category — it downloads a <b>.orbit</b> file and joins the orbit catalog.</li>
      <li><b>Load Orbit</b> brings a saved <b>.orbit</b> back in.</li>
    </ol>
    <p class="tut-tip">Saved orbits are reusable: in a Mission's <b>Orbit Map</b> you can add orbits from the <b>Orbits</b> catalog (or upload an .orbit with <b>Load Orbit</b>) to create navigation nodes.</p>` },

  { id: 'spacecraft', title: 'Spacecraft Editor', body: () => `
    <h3>Building spacecraft</h3>
    <ol>
      <li>Go to <b>Program Manager → Hangar → Spacecraft</b> and click <b>+ New Spacecraft</b>.</li>
      <li>Add stages with <b>+ Add Stage</b>. Each stage has dry mass, Isp, propellant, prop type, plus <b>crew capacity</b> and <b>docking ports</b>.</li>
      <li>The <b>ΔV Breakdown</b> at the bottom updates live.</li>
      <li><b>Mass simulator:</b> tick it to define the craft as a single total mass (no stages) — handy for stations / cargo like the ISS (≈ 420 t) you don't want to model in detail.</li>
    </ol>
    <h3>Stage Library</h3>
    <ul>
      <li>Press <b>↓ Lib</b> on a stage card to save it to the reusable <b>Stage Library</b> (below the editor).</li>
      <li><b>+ New Stage</b> builds a standalone stage; <b>drag</b> any library stage into the spacecraft's stage stack to add it.</li>
      <li>Click a library card for details; <b>Download</b> exports a <b>.scstage</b> file (Load Stage re-imports it). The library also travels inside saved <b>.program</b> files.</li>
    </ul>` },

  { id: 'fleet', title: 'Hangar — vehicles + payloads', body: () => `
    <h3>Assembling a vehicle + payload</h3>
    <ol>
      <li>Go to <b>Program Manager → Hangar → Vehicle</b>. The list holds your saved vehicles + built-in presets; <b>Load Vehicle</b> imports a <b>.vehicle</b> file.</li>
      <li>Add an entry with <b>+ New Entry</b> or <b>Import Vehicle</b>, or drop a vehicle onto the <b>"Launch Vehicle Configuration"</b> box to swap an entry's rocket.</li>
      <li>Assign <b>payloads</b> (your spacecraft) to an entry from its Payload Manifest. The <b>ΔV Budget</b> covers the launch vehicle and each payload's on-orbit ΔV.</li>
    </ol>
    <p class="tut-tip">A Vehicle entry = one launch vehicle + its payload spacecraft. That's what you pick when you launch a mission.</p>` },

  { id: 'mission-start', title: 'Missions — launch', body: () => `
    <h3>Starting a mission</h3>
    <ol>
      <li>Go to <b>Program Manager → Missions</b>. A mission is auto-created; rename it in the top bar, or <b>+ New</b> in the missions list.</li>
      <li>In the EVENTS panel (right), click <b>＋ Add Event → Launch</b>. Pick the Hangar entry (launch vehicle + payload) and the target orbit, then launch — ascent staging runs automatically (boosters/lower stages are expended). You're prompted to name the new vehicle.</li>
      <li><b>Place in Orbit</b> instead drops a spacecraft (e.g. a station) directly into orbit, no ascent. Tick <b>Deploy with empty tanks</b> for a dry depot to refuel later.</li>
    </ol>
    <p class="tut-tip">Every change re-simulates the whole mission from its event log, so editing earlier events ripples forward correctly.</p>` },

  { id: 'mission-events', title: 'Missions — events', body: () => `
    <h3>Building the flight plan</h3>
    <p>Use <b>＋ Add Event</b> to append events; each acts on the <b>active vehicle</b>:</p>
    <ul>
      <li><b>Maneuver</b> — pick From/To nodes (or draw a bridge on the <b>Orbit Map</b>). It's a container: build it from ordered <b>Burn</b> / <b>Separate</b> steps (each burn uses a stage's ΔV or its whole tank), or hit <b>⚙ Auto</b> to close the ΔV for you.</li>
      <li><b>Separate / Dock</b> — split a stack into two vehicles, or merge two (orbits must match — rendezvous first).</li>
      <li><b>Transfer Propellant</b> — move fuel between stages, or fill a separate <b>depot</b> by choosing it as the destination vehicle. <b>Transfer Crew</b>, <b>Expend</b>, <b>Rendezvous</b>, <b>Reenter</b>, <b>Recover</b>.</li>
    </ul>
    <h3>Editing & ordering</h3>
    <ul>
      <li>Each event card has <b>✎ edit</b>, <b>▲▼ move</b>, <b>⤓ send to end</b>, <b>✕ delete</b>. You can also <b>drag a card</b> to reorder — add an event then drag it between two others to insert it.</li>
      <li>Editors show point-in-time state (fuel as it was <i>at that event</i>). Edit lets you re-pick vehicles/stages/orbits for that event.</li>
      <li><b>⤵ "during the previous transfer's coast"</b> places an event mid-maneuver so transport doesn't look instantaneous.</li>
      <li><b>⊞ Loop</b> a run of events and set a <b>repeat</b> count for cycles like refuelling or crew rotation.</li>
    </ul>` },

  { id: 'mission-views', title: 'Missions — band view & orbit map', body: () => `
    <h3>Two ways to see a mission</h3>
    <p>Toggle <b>Band</b> / <b>Orbit Map</b> in the mission top bar.</p>
    <h3>Band view</h3>
    <ul>
      <li>Horizontal <b>zones</b> (Earth → LEO → GTO → Cislunar → …) with each vehicle drawn as a track that climbs through them. X is event order, not real time.</li>
      <li>Co-manifested or docked vehicles share <b>one track</b> until they separate; a track forks at a SEPARATE and merges at a DOCK.</li>
      <li><b>Zoom</b> with the buttons or scroll-wheel; click a node to inspect; the panel below shows the full state at that event.</li>
      <li><b>⬇ PNG</b> saves the current view as an image (the band export includes a vehicle colour key).</li>
    </ul>
    <h3>Orbit Map</h3>
    <ul>
      <li>A solar-system map of orbital <b>nodes</b> — it's only about maneuvers. Use <b>＋ Draw Maneuver</b> to connect a start node to a destination (computes the ΔV).</li>
      <li>The <b>Orbits</b> panel is the list view of these same nodes (catalog and map are one set). Add with <b>+ Custom</b> or <b>Load</b> a .orbit file; right-drag a node to reposition.</li>
    </ul>` },

  { id: 'multi-vehicle', title: 'Missions — multi-vehicle ops', body: () => `
    <h3>Working with several vehicles</h3>
    <ol>
      <li>After a SEPARATE (or a second launch), the <b>Vehicles &amp; Multi-Vehicle Ops</b> panel lists every live vehicle. Click a row to make it the <b>active vehicle</b> (green) — new events act on it.</li>
      <li><b>⇕ Separate</b> splits the active vehicle at a chosen stage; the upper part becomes a new vehicle (e.g. extracting an Apollo CSM/LM).</li>
      <li><b>⊕ Dock</b> merges the active vehicle with a target whose orbit matches.</li>
      <li><b>Expend</b> retires a vehicle. ✎ renames it.</li>
    </ol>
    <p class="tut-tip">Vehicles are named by their leading stage + payloads (e.g. "S-IVB + Apollo CSM"); after splitting LV stages you'll see them as their own stages (e.g. "S-II" vs "S-IVB").</p>` },

  { id: 'saveload', title: 'Saving & loading', body: () => `
    <h3>File types</h3>
    <p>Everything is JSON, with a distinguishing extension so files are easy to tell apart:</p>
    <ul>
      <li><b>.program</b> — the <i>whole</i> program (spacecraft + vehicles + missions + stage library). Use <b>Save Program / Load Program</b> in the header (Program Manager only).</li>
      <li><b>.vehicle</b> — a launch vehicle from the LV Calculator.</li>
      <li><b>.stage</b> — an LV stage; <b>.scstage</b> — a spacecraft stage.</li>
      <li><b>.orbit</b> — a saved orbit. <b>.spacecraft</b> — a single spacecraft definition.</li>
    </ul>
    <p class="tut-tip">Ship-ready habit: keep your work in a <b>.program</b> file — it round-trips the entire Program Manager in one file.</p>` },
];

let _tutSel = 'welcome';

function openTutorials(topicId) {
  _tutSel = topicId || _tutSel || (TUTORIALS[0] && TUTORIALS[0].id);
  renderTutorials();
  if (typeof openModal === 'function') openModal('modal-tutorials');
}
function tutSelect(id) { _tutSel = id; renderTutorials(); }
function renderTutorials() {
  const listEl = document.getElementById('tut-list');
  const bodyEl = document.getElementById('tut-body');
  if (!listEl || !bodyEl) return;
  listEl.innerHTML = TUTORIALS.map(t =>
    `<button class="tut-item${t.id === _tutSel ? ' active' : ''}" onclick="tutSelect('${t.id}')">${t.title}</button>`
  ).join('');
  const t = TUTORIALS.find(x => x.id === _tutSel) || TUTORIALS[0];
  bodyEl.innerHTML = t ? t.body() : '';
  bodyEl.scrollTop = 0;
}
