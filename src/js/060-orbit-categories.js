
// ─── ORBIT CATEGORIES ─────────────────────────
// All C3 values are Earth-departure hyperbolic excess energy (km²/s²)
// Injection burn computed via vis-viva: Vinj = √(Vesc² + C3) where Vesc²=2μ/r
const ORBIT_CATEGORIES=[
  {planet:'Earth', icon:'⊕', color:'#4a9fff', orbits:[
    {name:'LEO 200 km',      mode:'orbit',apogee:200,  perigee:200,  inc:28.5,parking:185,incTracksLat:true,note:'Minimum stable LEO. Inclination = launch site latitude.'},
    {name:'ISS',             mode:'orbit',apogee:418,  perigee:408,  inc:51.6,parking:185,note:'International Space Station. 51.6° for Russian site access.'},
    {name:'Sun-Sync 700 km', mode:'orbit',apogee:700,  perigee:700,  inc:98.2,parking:185,note:'Sun-synchronous Earth observation. 98.2° retrograde.'},
    {name:'Polar 800 km',    mode:'orbit',apogee:800,  perigee:800,  inc:90,  parking:185,note:'True polar. Full Earth coverage.'},
    {name:'GPS / MEO',       mode:'orbit',apogee:20200,perigee:20200,inc:55,  parking:185,note:'GPS constellation. 12-hour period.'},
    {name:'Molniya',         mode:'orbit',apogee:39700,perigee:600,  inc:63.4,parking:185,note:'HEO 12-hr. 63.4° freezes apsides. Soviet Arctic comms.'},
    {name:'Tundra',          mode:'orbit',apogee:46300,perigee:17900,inc:63.4,parking:185,note:'24-hr HEO. Single-satellite Arctic coverage.'},
    {name:'GTO',             mode:'orbit',apogee:35786,perigee:185,  inc:28.5,parking:185,incTracksLat:true,note:'Geostationary Transfer Orbit. Inclination = launch site latitude (or range safety minimum).'},
    {name:'GEO',             mode:'orbit',apogee:35786,perigee:35786,inc:0,   parking:185,note:'Geostationary. 0° inc. Plane change combined at apogee.'},
    {name:'Graveyard',       mode:'orbit',apogee:36086,perigee:36086,inc:0,   parking:185,note:'300 km above GEO per IADC guidelines.'},
    {name:'Sun-Sync GTO',    mode:'orbit',apogee:35786,perigee:500,  inc:98.2,parking:185,note:'High-inclination GTO for SSO replenishment.'},
  ]},
  {planet:'Moon', icon:'☽', color:'#c0c0c0', orbits:[
    {name:'Trans-Lunar Inj.', mode:'escape',c3:-1.9,  decl:28.5,perigee:185,note:'TLI from 185 km. C3≈−1.9 km²/s². ~3.14 km/s injection burn.'},
    {name:'TLI (polar appr.)',mode:'escape',c3:-1.9,  decl:45,  perigee:185,note:'TLI for polar lunar approach. Higher departure declination.'},
    {name:'Fast Lunar',       mode:'escape',c3:0.5,   decl:28.5,perigee:185,note:'Higher energy TLI for faster transit. ~3.26 km/s.'},
  ]},
  {planet:'Mars', icon:'♂', color:'#cc4433', orbits:[
    {name:'Mars (min energy)',mode:'escape',c3:8.7,   decl:28.5,perigee:185,note:'Hohmann-like minimum energy. C3=8.7 km²/s². ~3.62 km/s.'},
    {name:'Mars (fast)',      mode:'escape',c3:16.0,  decl:28.5,perigee:185,note:'~7 month transit. C3=16 km²/s². ~3.93 km/s.'},
    {name:'Mars (opposition)',mode:'escape',c3:25.0,  decl:28.5,perigee:185,note:'Short-period opposition class. Higher C3 but shorter transit.'},
  ]},
  {planet:'Venus', icon:'♀', color:'#ffaa44', orbits:[
    {name:'Venus (min energy)',mode:'escape',c3:6.3,  decl:28.5,perigee:185,note:'Minimum Hohmann to Venus. C3≈6.3 km²/s². ~3.54 km/s.'},
    {name:'Venus (fast)',      mode:'escape',c3:12.0, decl:28.5,perigee:185,note:'Faster Venus transfer. C3≈12 km²/s².'},
  ]},
  {planet:'Mercury', icon:'☿', color:'#aa8866', orbits:[
    {name:'Mercury (direct)', mode:'escape',c3:56.7, decl:28.5,perigee:185,note:'Direct Hohmann to Mercury. C3≈56.7 km²/s². Very high energy.'},
  ]},
  {planet:'Jupiter', icon:'♃', color:'#cc8844', orbits:[
    {name:'Jupiter (direct)', mode:'escape',c3:77.4, decl:28.5,perigee:185,note:'Direct to Jupiter. C3≈77.4 km²/s². ~6.37 km/s injection.'},
    {name:'Jupiter (Voyager)',mode:'escape',c3:98.5, decl:28.5,perigee:185,note:'Voyager 1 trajectory. C3=98.5 km²/s². Jupiter gravity assist to Saturn.'},
  ]},
  {planet:'Saturn', icon:'♄', color:'#ccbb88', orbits:[
    {name:'Saturn (direct)',  mode:'escape',c3:105.7,decl:28.5,perigee:185,note:'Direct Hohmann to Saturn. C3≈105.7 km²/s².'},
  ]},
  {planet:'Uranus', icon:'♅', color:'#44cccc', orbits:[
    {name:'Uranus (direct)',  mode:'escape',c3:127.5,decl:28.5,perigee:185,note:'Direct to Uranus. C3≈127.5 km²/s².'},
  ]},
  {planet:'Neptune', icon:'♆', color:'#4455cc', orbits:[
    {name:'Neptune (direct)', mode:'escape',c3:135.9,decl:28.5,perigee:185,note:'Direct to Neptune. C3≈135.9 km²/s².'},
  ]},
  {planet:'Pluto', icon:'♇', color:'#d9a86c', orbits:[
    {name:'Pluto (direct)',   mode:'escape',c3:139.6,decl:28.5,perigee:185,note:'Direct Hohmann to Pluto (39.48 AU). C3≈139.6 km²/s². Real missions (New Horizons) used a Jupiter gravity assist instead.'},
  ]},
  {planet:'Beyond', icon:'✦', color:'#9944cc', orbits:[
    {name:'Solar Escape',     mode:'escape',c3:152.0,decl:28.5,perigee:185,note:'Solar system escape velocity. C3≈152 km²/s².'},
    {name:'Earth Escape',     mode:'escape',c3:0.1,  decl:28.5,perigee:185,note:'Minimum Earth escape. C3≈0 km²/s². ~3.23 km/s.'},
  ]},
];

let userLVs=[];
let userOrbitsByCategory={}; // { categoryName: [{orbit}, ...] }
let collapsedPlanets=new Set();
