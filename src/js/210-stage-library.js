
// ─── STAGE LIBRARY ────────────────────────────
const STAGE_LIBRARY={
  'Booster Stages':[
    {
      name:'WAC Corporal',
      dry:90,
      prop:474,
      thrust:6.7,
      isp:195,
      engines:'XCAL-200',
      note:'First US guided missile. Sounding rocket.',
      tags:[
        'Nitrogen Tetroxide / Aniline',
        'First Stage',
        '1940s',
        '1950s',
        'American'
      ]
    },
    {
      name:'Viking',
      dry:480,
      prop:6800,
      thrust:94,
      isp:225,
      engines:'XLR10-RM-2',
      note:'NRL sounding rocket. LOX/Ethanol. Predecessor to Vanguard.',
      tags:['Liquid Oxygen / Ethanol','First Stage','1950s','American']
    },
    {
      name:'Redstone',
      dry:5443,
      prop:23820,
      thrust:370,
      isp:265,
      res:2,
      engines:'LR-89 (A-7)',
      note:'Mercury/Juno first stage. LOX/Ethanol.',
      tags:[
        'Liquid Oxygen / Ethanol',
        'First Stage',
        '1950s',
        '1960s',
        'American',
        'QC-Controlled'
      ]
    },
    {
      name:'Jupiter',
      dry:4530,
      prop:49900,
      thrust:667.2,
      isp:284,
      res:2,
      engines:'LR-79-NA-9',
      note:'PGM-19 Jupiter IRBM. Used in Juno II.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '1950s',
        '1960s',
        'American',
        'QC-Controlled'
      ]
    },
    {
      name:'Thor DM-21',
      dry:2800,
      prop:46640,
      thrust:742.9,
      isp:285,
      res:2,
      engines:'MB-3-II',
      note:'Thor IRBM. LOX/RP-1. Used in Thor-Able/Agena/Delta.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '1950s',
        '1960s',
        '1970s',
        'American',
        'QC-Controlled'
      ]
    },
    {
      name:'Thor (Long Tank)',
      dry:3700,
      prop:67810,
      thrust:765.1,
      isp:285,
      res:2,
      engines:'MB-3-III',
      note:'Extended Thor. Delta variants.',
      tags:['Liquid Oxygen / Kerosene','First Stage','1960s','1970s','American']
    },
    {
      name:'Atlas D Sust.',
      dry:5657,
      prop:90000,
      thrust:1800,
      isp:282,
      res:2,
      engines:'LR-105+LR-89',
      note:'Stage-and-a-half. Boosters jettisoned at 2m 11s.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '1960s',
        'American',
        'QC-Controlled'
      ],
      s15:true,
      s15_sust_thrust:362,
      s15_sust_isp:309,
      s15_jet_mass:3050,
      s15_beco_twr:1.2,
      s15_boost_isp:282
    },
    {
      name:'Atlas SLV-3',
      dry:3400,
      prop:117000,
      thrust:1920,
      isp:316,
      engines:'MA-3',
      note:'Atlas SLV-3 for Agena/Centaur missions.',
      tags:['Liquid Oxygen / Kerosene','First Stage','1960s','1970s','American']
    },
    {
      name:'Atlas I/II Booster',
      dry:3600,
      prop:145000,
      thrust:1920,
      isp:316,
      engines:'MA-5A',
      note:'Atlas I/II first stage. LOX/RP-1.',
      tags:['Liquid Oxygen / Kerosene','First Stage','1990s-2000s','American']
    },
    {
      name:'Saturn I S-I',
      dry:54300,
      prop:381300,
      thrust:6690,
      isp:288,
      res:2,
      engines:'Rock.    H-1 8',
      note:'Saturn I first stage. 8× H-1. LOX/RP-1.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '1960s',
        'American',
        'QC-Controlled',
        'LOX/Kerosene',
        'LOX/RP-1'
      ]
    },
    {
      name:'Saturn IB S-IB',
      dry:38350,
      prop:417970,
      thrust:7100,
      isp:293,
      res:2,
      engines:'Rock.    H-1 8',
      note:'Saturn IB first stage. Uprated H-1.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '1960s',
        '1970s',
        'American',
        'QC-Controlled'
      ]
    },
    {
      name:'Saturn V S-IC',
      dry:130980,
      prop:2169290,
      thrust:34020,
      isp:304,
      res:2,
      engines:'Rock.    F-1 5',
      note:'Largest booster stage flown, previously second highest thrust, now third. F-1 vac Isp 304s.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '1960s',
        '1970s',
        'American',
        'QC-Controlled'
      ]
    },
    {
      name:'Titan I Stage 1',
      dry:3230,
      prop:72900,
      thrust:1512,
      isp:290,
      engines:'LR-87-1',
      note:'First Titan. LOX/RP-1. Only 2-stage LOX Titan.',
      tags:['Liquid Oxygen / Kerosene','First Stage','1960s','American']
    },
    {
      name:'Titan II GLV S1',
      dry:4526,
      prop:112500,
      thrust:2090,
      isp:290,
      engines:'LR-87-7',
      note:'Gemini LV. NTO/Aerozine-50.',
      tags:['Nitrogen Tetroxide / Aerozine-50','First Stage','1960s','American']
    },
    {
      name:'Titan IIIC/D S1',
      dry:8200,
      prop:142000,
      thrust:2340,
      isp:301,
      engines:'LR-87-11',
      note:'Titan III core stage 1.',
      tags:[
        'Nitrogen Tetroxide / Aerozine-50',
        'First Stage',
        '1970s',
        '1980s',
        'American'
      ]
    },
    {
      name:'Titan IIIE S1',
      dry:9200,
      prop:158000,
      thrust:2340,
      isp:301,
      engines:'LR-87-11',
      note:'Titan IIIE core first stage.',
      tags:['Nitrogen Tetroxide / Aerozine-50','First Stage','1970s','American']
    },
    {
      name:'Titan IV Stage 1',
      dry:9200,
      prop:165000,
      thrust:2340,
      isp:302,
      engines:'LR-87-AJ11',
      note:'Titan IV. Uprated LR-87. NTO/Aerozine-50.',
      tags:[
        'Nitrogen Tetroxide / Aerozine-50',
        'First Stage',
        '1990s-2000s',
        'American'
      ]
    },
    {
      name:'Delta II S1',
      dry:4800,
      prop:96900,
      thrust:1050,
      isp:302,
      engines:'RS-27A',
      note:'LOX/RP-1. RS-27A.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '1980s',
        '1990s-2000s',
        'American'
      ]
    },
    {
      name:'Delta III/IV S1',
      dry:6100,
      prop:151700,
      thrust:2141,
      isp:360,
      engines:'RS-68',
      note:'LOX/LH2. Common Booster Core. Delta III/IV.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'First Stage',
        '2000s',
        '2010s+',
        'American'
      ]
    },
    {
      name:'Antares S1 (Castor 30)',
      dry:3500,
      prop:44000,
      thrust:1285,
      isp:289,
      engines:'Castor 30XL',
      note:'Solid first stage for Antares 230.',
      tags:['Solid Propellant','First Stage','2010s+','American']
    },
    {
      name:'Vanguard S1',
      dry:940,
      prop:7140,
      thrust:123.9,
      isp:270,
      res:2,
      engines:'GE X-405',
      note:'Vanguard first stage. LOX/Kerosene.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '1950s',
        '1960s',
        'American',
        'QC-Controlled'
      ]
    },
    {
      name:'Atlas V CCB',
      dry:21054,
      prop:284089,
      thrust:4152,
      isp:338,
      engines:'RD-180',
      note:'Atlas V Common Core Booster. LOX/RP-1. RD-180 single shaft.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '1990s-2000s',
        '2010s+',
        'American'
      ]
    },
    {
      name:'Delta IV CBC',
      dry:26760,
      prop:199640,
      thrust:3137,
      isp:412,
      engines:'RS-68A',
      note:'Delta IV Common Booster Core. LOX/LH2. RS-68A.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'First Stage',
        '2000s',
        '2010s+',
        'American'
      ]
    },
    {
      name:'Vulcan S1',
      dry:15600,
      prop:372000,
      thrust:4800,
      isp:340,
      engines:'2× BE-4',
      note:'Vulcan first stage. LOX/Methane. 2× Blue Origin BE-4.',
      tags:['Liquid Oxygen / Methane','First Stage','2010s+','American']
    },
    {
      name:'New Glenn S1',
      dry:45000,
      prop:875000,
      thrust:16800,
      isp:340,
      engines:'7× BE-4',
      note:'New Glenn first stage. LOX/Methane. 7× BE-4.',
      tags:['Liquid Oxygen / Methane','First Stage','2010s+','American']
    },
    {
      name:'Antares S1',
      dry:8000,
      prop:218000,
      thrust:3840,
      isp:338,
      engines:'2× RD-181',
      note:'Antares 230+ first stage. LOX/RP-1. 2× Energomash RD-181.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '2010s+',
        'American',
        'Soviet / Russian'
      ]
    },
    {
      name:'Electron S1',
      dry:950,
      prop:9300,
      thrust:224,
      isp:320,
      engines:'9× Rutherford',
      note:'Rocket Lab Electron. LOX/RP-1. Electric-pump fed.',
      tags:['Liquid Oxygen / Kerosene','First Stage','2010s+','American']
    },
    {
      name:'Falcon 9 B5 S1',
      dry:25600,
      prop:407500,
      thrust:8829,
      isp:311,
      engines:'9× Merlin 1D+',
      note:'Expendable config. LOX/RP-1.',
      tags:['Liquid Oxygen / Kerosene','First Stage','2010s+','American']
    },
    {
      name:'R-7 Blok A (core)',
      dry:6545,
      prop:91440,
      thrust:941,
      isp:315,
      engines:'RD-108',
      note:'R-7/Sputnik/Vostok/Soyuz core stage. LOX/Kerosene.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '1950s',
        '1960s',
        '1970s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Proton Blok A',
      dry:31000,
      prop:419400,
      thrust:10470,
      isp:285,
      engines:'6× RD-253',
      note:'Proton first stage. N2O4/UDMH. 6 engines radially.',
      tags:[
        'Nitrogen Tetroxide / UDMH',
        'First Stage',
        '1960s',
        '1970s',
        '1980s',
        '1990s-2000s',
        'Soviet / Russian'
      ]
    },
    {
      name:'N1 Blok A',
      dry:209000,
      prop:1880000,
      thrust:45400,
      isp:297,
      engines:'30× NK-15',
      note:'N1 first stage. 30× NK-15. LOX/RP-1. Never succeeded.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '1960s',
        '1970s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Zenit S1',
      dry:10400,
      prop:262800,
      thrust:8180,
      isp:337,
      engines:'RD-171',
      note:'Zenit first stage. LOX/Kerosene. RD-171 — worlds most powerful single-chamber engine.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'First Stage',
        '1980s',
        '1990s-2000s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Kosmos-3M S1',
      dry:3000,
      prop:65000,
      thrust:1510,
      isp:276,
      engines:'RD-216',
      note:'Based on R-14 IRBM. N2O4/UDMH. Reliable workhorse.',
      tags:[
        'Nitrogen Tetroxide / UDMH',
        'First Stage',
        '1970s',
        '1980s',
        '1990s-2000s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Tsyklon-2 S1',
      dry:4000,
      prop:131000,
      thrust:2750,
      isp:301,
      engines:'RD-261',
      note:'Based on R-36 ICBM. N2O4/UDMH.',
      tags:[
        'Nitrogen Tetroxide / UDMH',
        'First Stage',
        '1970s',
        '1980s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Energia Blok Ts',
      dry:34500,
      prop:730000,
      thrust:5888,
      isp:455,
      engines:'4× RD-0120',
      note:'Energia core. LOX/LH2. Most powerful Soviet LH2 engine.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'First Stage',
        '1980s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Thor DM-18',
      dry:3200,
      prop:45400,
      thrust:676.1,
      isp:283,
      res:2,
      engines:'MB-3-I',
      tags:[
        '1960s',
        'Gimballed',
        'QC-Controlled',
        'Pump-fed',
        'LOX/Kerosene',
        'LOX/RP-1',
        'Cryogenic'
      ]
    }
  ],
  'Upper Stages':[
    {
      name:'Able I (Thor)',
      dry:405,
      prop:1575,
      thrust:33,
      isp:267,
      res:2,
      engines:'AJ-10-42',
      note:'Thor-Able upper stage. NTO/UDMH. Pioneer probes.',
      tags:[
        'Nitrogen Tetroxide / UDMH',
        'Upper Stage',
        '1950s',
        '1960s',
        'American',
        'QC-Controlled',
        'Hypergolic',
        'Pressure-fed'
      ]
    },
    {
      name:'Vanguard S2',
      dry:400,
      prop:1575,
      thrust:33,
      isp:267,
      res:2,
      engines:'AJ-10-37',
      note:'Vanguard second stage. NTO/Aerozine-50.',
      tags:[
        'Nitrogen Tetroxide / Aerozine-50',
        'Upper Stage',
        '1950s',
        '1960s',
        'American',
        'Pressure-fed',
        'QC-Controlled'
      ]
    },
    {
      name:'Vanguard S3',
      dry:24,
      prop:193,
      thrust:11.6,
      isp:230,
      res:2,
      engines:'GCR X-242',
      note:'Vanguard third stage. Solid kick motor.',
      tags:[
        'Solid Propellant',
        'Upper Stage',
        'Kick Stage',
        '1950s',
        '1960s',
        'American',
        'Solid'
      ]
    },
    {
      name:'Kosmos-3M S2',
      dry:450,
      prop:5300,
      thrust:157,
      isp:300,
      engines:'RD-48',
      note:'Kosmos-3M second stage. N2O4/UDMH.',
      tags:[
        'Nitrogen Tetroxide / UDMH',
        'Upper Stage',
        '1970s',
        '1980s',
        '1990s-2000s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Agena A',
      dry:890,
      prop:3060,
      thrust:68.9,
      isp:277,
      res:2,
      engines:'Bell 8048',
      note:'IRFNA/UDMH. First Agena variant.',
      tags:[
        'Inhibited Red Fuming Nitric Acid / UDMH',
        'Upper Stage',
        'Restartable',
        '1950s',
        '1960s',
        'American',
        'QC-Controlled'
      ]
    },
    {
      name:'Agena B',
      dry:1690,
      prop:6110,
      thrust:71.2,
      isp:290,
      res:2,
      engines:'Bell 8096',
      note:'Extended Agena. IRFNA/UDMH.',
      tags:[
        'Inhibited Red Fuming Nitric Acid / UDMH',
        'Upper Stage',
        'Restartable',
        '1960s',
        'American',
        'Throttleable',
        'QC-Controlled'
      ]
    },
    {
      name:'Agena D',
      dry:670,
      prop:6497,
      thrust:71,
      isp:291,
      res:2,
      engines:'Bell 8096',
      note:'IRFNA/UDMH. Standard upper stage for Atlas/Thor.',
      tags:[
        'Inhibited Red Fuming Nitric Acid / UDMH',
        'Upper Stage',
        'Restartable',
        '1960s',
        '1970s',
        'American',
        'QC-Controlled'
      ]
    },
    {
      name:'Saturn S-IV',
      dry:6500,
      prop:45360,
      thrust:400.3,
      isp:428,
      res:2,
      engines:'RL-10A-3S    (6)',
      note:'Saturn I upper stage. 6× RL-10. LOX/LH2.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        '1960s',
        'American',
        'LOX/LH2',
        'Pump-fed',
        'QC-Controlled'
      ]
    },
    {
      name:'Saturn V S-II',
      dry:34450,
      prop:451830,
      thrust:5165,
      isp:425,
      res:2,
      engines:'Rock.    J-2 5',
      note:'LOX/LH2. Five J-2 engines.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        '1960s',
        '1970s',
        'American',
        'Pump-fed',
        'QC-Controlled',
        'LOX/LH2'
      ]
    },
    {
      name:'Saturn 1B & V S-IVB',
      dry:15090,
      prop:108110,
      thrust:876,
      isp:425,
      res:2,
      engines:'Rock.    J-2',
      note:'Restartable. Used for TLI on Apollo.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        'Restartable',
        '1960s',
        '1970s',
        'American',
        'LOX/LH2',
        'Pump-fed',
        'QC-Controlled'
      ]
    },
    {
      name:'Centaur A',
      dry:1800,
      prop:9000,
      thrust:133,
      isp:428,
      engines:'2× RL-10A-1',
      note:'First Centaur. LOX/LH2. Atlas-Centaur.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        'Restartable',
        '1960s',
        'American'
      ]
    },
    {
      name:'Centaur D-1T',
      dry:2100,
      prop:13500,
      thrust:133,
      isp:444,
      engines:'2× RL-10A-3-3',
      note:'Titan IIIE upper stage. LOX/LH2.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        'Restartable',
        '1970s',
        'American'
      ]
    },
    {
      name:'Centaur II (AC)',
      dry:2100,
      prop:15900,
      thrust:147,
      isp:449,
      engines:'2× RL-10A-4',
      note:'Atlas-Centaur II. LOX/LH2.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        'Restartable',
        '1980s',
        '1990s-2000s',
        'American'
      ]
    },
    {
      name:'Centaur III',
      dry:2247,
      prop:20830,
      thrust:147,
      isp:451,
      engines:'2× RL-10A-4-2',
      note:'Atlas V upper stage. LOX/LH2.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        'Restartable',
        '1990s-2000s',
        '2010s+',
        'American'
      ]
    },
    {
      name:'Titan I Stage 2',
      dry:1630,
      prop:27000,
      thrust:444,
      isp:308,
      engines:'LR-91-1',
      note:'Titan I second stage. LOX/RP-1.',
      tags:['Liquid Oxygen / Kerosene','Upper Stage','1960s','American']
    },
    {
      name:'Titan II GLV S2',
      dry:2404,
      prop:26535,
      thrust:444,
      isp:316,
      engines:'LR-91-7',
      note:'Gemini LV second stage. NTO/Aerozine-50.',
      tags:['Nitrogen Tetroxide / Aerozine-50','Upper Stage','1960s','American']
    },
    {
      name:'Titan IIIC/D S2',
      dry:4100,
      prop:28800,
      thrust:444,
      isp:316,
      engines:'LR-91-11',
      note:'Titan III second stage.',
      tags:[
        'Nitrogen Tetroxide / Aerozine-50',
        'Upper Stage',
        '1970s',
        '1980s',
        'American'
      ]
    },
    {
      name:'Titan IIIE S2',
      dry:4500,
      prop:27500,
      thrust:467,
      isp:316,
      engines:'LR-91-11',
      note:'Titan IIIE second stage.',
      tags:['Nitrogen Tetroxide / Aerozine-50','Upper Stage','1970s','American']
    },
    {
      name:'Transtage',
      dry:1100,
      prop:10000,
      thrust:71,
      isp:311,
      engines:'AJ10-138',
      note:'Titan IIIC third stage. NTO/Aerozine-50. Restartable.',
      tags:[
        'Nitrogen Tetroxide / Aerozine-50',
        'Upper Stage',
        'Restartable',
        '1960s',
        '1970s',
        '1980s',
        'American'
      ]
    },
    {
      name:'Delta-K',
      dry:950,
      prop:6000,
      thrust:43,
      isp:319,
      engines:'AJ10-118K',
      note:'Delta upper stage. NTO/Aerozine-50.',
      tags:[
        'Nitrogen Tetroxide / Aerozine-50',
        'Upper Stage',
        '1980s',
        '1990s-2000s',
        'American'
      ]
    },
    {
      name:'PAM-D (Star-48)',
      dry:130,
      prop:2010,
      thrust:67,
      isp:292,
      engines:'Star-48B',
      note:'Payload Assist Module. Solid. Used on Delta/Shuttle.',
      tags:[
        'Solid Propellant',
        'Upper Stage',
        'Kick Stage',
        '1980s',
        '1990s-2000s',
        'American'
      ]
    },
    {
      name:'Inertial Upper Stg',
      dry:944,
      prop:9707,
      thrust:89,
      isp:304,
      engines:'STAR-63D',
      note:'IUS solid. Used on Shuttle/Titan. Two-stage solid.',
      tags:['Solid Propellant','Upper Stage','1980s','1990s-2000s','American']
    },
    {
      name:'DCSS (Delta IV)',
      dry:3380,
      prop:27220,
      thrust:110,
      isp:462,
      engines:'RL-10B-2',
      note:'Delta Cryogenic Second Stage. LOX/LH2.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        'Restartable',
        '1990s-2000s',
        '2010s+',
        'American'
      ]
    },
    {
      name:'Falcon 9 MVac',
      dry:4000,
      prop:107500,
      thrust:934,
      isp:348,
      engines:'Merlin Vac',
      note:'LOX/RP-1. Expendable config.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Upper Stage',
        'Restartable',
        '2010s+',
        'American'
      ]
    },
    {
      name:'Centaur V',
      dry:2700,
      prop:41000,
      thrust:110,
      isp:452,
      engines:'RL-10C-1-1',
      note:'Vulcan Centaur upper stage. LOX/LH2. Single RL-10C.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        'Restartable',
        '2010s+',
        'American'
      ]
    },
    {
      name:'New Glenn S2',
      dry:3000,
      prop:47000,
      thrust:710,
      isp:445,
      engines:'BE-3U',
      note:'New Glenn second stage. LOX/LH2. Blue Origin BE-3U.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        'Restartable',
        '2010s+',
        'American'
      ]
    },
    {
      name:'Electron S2',
      dry:250,
      prop:2150,
      thrust:27,
      isp:343,
      engines:'Rutherford Vac',
      note:'Rocket Lab Electron upper stage. LOX/RP-1. Vacuum Rutherford.',
      tags:['Liquid Oxygen / Kerosene','Upper Stage','2010s+','American']
    },
    {
      name:'SLS Core Stage',
      dry:99000,
      prop:987000,
      thrust:8360,
      isp:452,
      engines:'4× RS-25',
      note:'SLS Core Stage. 4× RS-25 (SSME). LOX/LH2. ~8,360 kN total.',
      tags:['Liquid Oxygen / Liquid Hydrogen','First Stage','2010s+','American']
    },
    {
      name:'ICPS (SLS Block 1)',
      dry:3380,
      prop:27220,
      thrust:110,
      isp:462,
      engines:'RL-10B-2',
      note:'Interim Cryogenic Propulsion Stage. Same as DCSS. LOX/LH2.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        'Restartable',
        '2010s+',
        'American'
      ]
    },
    {
      name:'EUS (SLS Block 1B)',
      dry:15000,
      prop:120000,
      thrust:440,
      isp:462,
      engines:'4× RL-10C-3',
      note:'Exploration Upper Stage. 4× RL-10C. LOX/LH2. SLS Block 1B.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        'Restartable',
        '2010s+',
        'American'
      ]
    },
    {
      name:'NOMAD (G-1)',
      dry:600,
      prop:5500,
      thrust:53.5,
      isp:357,
      engines:'Rocketdyne G-1',
      note:'LF2/Hydrazine. Atlas upper stage (Agena replacement). Never flown due to fluorine toxicity. Engine specs confirmed; stage masses estimated.',
      tags:[
        'Liquid Fluorine / Hydrazine',
        'Upper Stage',
        'Exotic',
        'Unbuilt',
        '1950s',
        '1960s',
        'American'
      ]
    },
    {
      name:'CHARIOT',
      dry:1600,
      prop:12000,
      thrust:155.9,
      isp:350,
      engines:'Bell LF2',
      note:'LF2/MMH+H2O+Hydrazine. Titan III Transtage replacement. Never flown. Burned to CO and HF. Engine specs confirmed; stage masses estimated.',
      tags:[
        'Liquid Fluorine / Hydrazine',
        'Upper Stage',
        'Exotic',
        'Unbuilt',
        '1960s',
        'American'
      ]
    },
    {
      name:'Vulcan ACES',
      dry:2500,
      prop:41000,
      thrust:110,
      isp:462,
      engines:'2× RL-10C-1-1',
      note:'Advanced Cryogenic Evolved Stage. LOX/LH2.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Upper Stage',
        'Restartable',
        '2010s+',
        'American'
      ]
    },
    {
      name:'R-7 Blok E',
      dry:600,
      prop:5600,
      thrust:55,
      isp:323,
      engines:'RD-0109',
      note:'Vostok 3rd stage. LOX/Kerosene. First orbital upper stage.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Upper Stage',
        '1950s',
        '1960s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Soyuz Blok I',
      dry:2355,
      prop:22000,
      thrust:298,
      isp:326,
      engines:'RD-0110',
      note:'Soyuz/Molniya 3rd stage. LOX/Kerosene. Restartable.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Upper Stage',
        'Restartable',
        '1960s',
        '1970s',
        '1980s',
        '1990s-2000s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Blok L (8S814)',
      dry:1200,
      prop:8000,
      thrust:54,
      isp:340,
      engines:'S1.5400',
      note:'Luna/Molniya 4th stage. LOX/Kerosene. Deep space kick.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Upper Stage',
        'Kick Stage',
        '1960s',
        '1970s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Proton Blok B',
      dry:11000,
      prop:157300,
      thrust:2399,
      isp:327,
      engines:'3× RD-0210 + RD-0211',
      note:'Proton 2nd stage. N2O4/UDMH.',
      tags:[
        'Nitrogen Tetroxide / UDMH',
        'Upper Stage',
        '1960s',
        '1970s',
        '1980s',
        '1990s-2000s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Proton Blok V',
      dry:4185,
      prop:46562,
      thrust:599,
      isp:325,
      engines:'RD-0212',
      note:'Proton 3rd stage. N2O4/UDMH. Restartable.',
      tags:[
        'Nitrogen Tetroxide / UDMH',
        'Upper Stage',
        'Restartable',
        '1960s',
        '1970s',
        '1980s',
        '1990s-2000s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Blok D',
      dry:2400,
      prop:15200,
      thrust:85,
      isp:352,
      engines:'11D58',
      note:'Deep space stage. LOX/Kerosene. Used on Proton/Zond/Lunna.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Upper Stage',
        'Restartable',
        '1960s',
        '1970s',
        '1980s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Blok DM-03',
      dry:2750,
      prop:19800,
      thrust:85,
      isp:352,
      engines:'11D58M',
      note:'Modernised Blok D. LOX/Kerosene. Proton upper stage.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Upper Stage',
        'Restartable',
        '1990s-2000s',
        '2010s+',
        'Soviet / Russian'
      ]
    },
    {
      name:'Fregat',
      dry:930,
      prop:5250,
      thrust:20,
      isp:332,
      engines:'S5.92',
      note:'Soyuz/Zenit upper stage. N2O4/UDMH. Highly restartable.',
      tags:[
        'Nitrogen Tetroxide / UDMH',
        'Upper Stage',
        'Restartable',
        '1990s-2000s',
        '2010s+',
        'Soviet / Russian'
      ]
    },
    {
      name:'Zenit Blok II',
      dry:8800,
      prop:82600,
      thrust:912,
      isp:350,
      engines:'RD-120',
      note:'Zenit second stage. LOX/Kerosene.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Upper Stage',
        '1980s',
        '1990s-2000s',
        'Soviet / Russian'
      ]
    },
    {
      name:'N1 Blok B',
      dry:11400,
      prop:300000,
      thrust:14040,
      isp:346,
      engines:'8× NK-15V',
      note:'N1 second stage. LOX/Kerosene. NK-15V high-alt variant.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Upper Stage',
        '1960s',
        '1970s',
        'Soviet / Russian'
      ]
    },
    {
      name:'N1 Blok V',
      dry:4400,
      prop:93000,
      thrust:4080,
      isp:354,
      engines:'4× NK-19',
      note:'N1 third stage. LOX/Kerosene.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Upper Stage',
        '1960s',
        '1970s',
        'Soviet / Russian'
      ]
    },
    {
      name:'N1 Blok G (TLI)',
      dry:4900,
      prop:15600,
      thrust:980,
      isp:353,
      engines:'NK-21',
      note:'N1 TLI stage. LOX/Kerosene.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Upper Stage',
        'Kick Stage',
        '1960s',
        '1970s',
        'Soviet / Russian'
      ]
    },
    {
      name:'Able II (Thor)',
      dry:535,
      prop:1575,
      thrust:33.4,
      isp:270,
      res:2,
      engines:'AJ-10-101A',
      tags:[
        'Hypergolic',
        '1960s',
        '1950s',
        'QC-Controlled',
        'Pressure-fed',
        'Second Stage'
      ]
    },
    {
      name:'Ablestar',
      dry:568,
      prop:4862,
      thrust:35.2,
      isp:277,
      res:2,
      engines:'AJ-10-104',
      tags:[
        '1960s',
        '1950s',
        'Gimballed',
        'Hypergolic',
        'Restartable',
        'QC-Controlled',
        'Pressure-fed'
      ]
    }
  ],
  'Kick Stages':[
    {
      name:'Sergeant (1×)',
      dry:6,
      prop:22,
      thrust:7.3,
      isp:214,
      engines:'Solid',
      note:'Single Sergeant motor. Juno I 4th stage.',
      tags:['Solid Propellant','Kick Stage','1950s','1960s','American']
    },
    {
      name:'Sergeant (3×)',
      dry:18,
      prop:73,
      thrust:22,
      isp:214,
      engines:'Solid',
      note:'3× Sergeant cluster. Juno I 3rd stage.',
      tags:['Solid Propellant','Kick Stage','1950s','1960s','American']
    },
    {
      name:'Sergeant (11×)',
      dry:68,
      prop:295,
      thrust:73,
      isp:214,
      engines:'Solid',
      note:'11× Sergeant cluster. Juno I 2nd stage.',
      tags:['Solid Propellant','Kick Stage','1950s','1960s','American']
    },
    {
      name:'Altair 1 (X-248)',
      dry:40,
      prop:388,
      thrust:12,
      isp:256,
      engines:'Solid',
      note:'Scout/Vanguard 3rd stage. X-248 motor.',
      tags:['Solid Propellant','Kick Stage','1950s','1960s','American']
    },
    {
      name:'Altair 3',
      dry:25,
      prop:276,
      thrust:27.4,
      isp:280,
      engines:'Solid',
      note:'Scout 4th stage. HTPB.',
      tags:['Solid Propellant','Kick Stage','1960s','American']
    },
    {
      name:'Antares 3A',
      dry:98,
      prop:1286,
      thrust:80,
      isp:294,
      engines:'Solid',
      note:'Scout 3rd stage.',
      tags:['Solid Propellant','Kick Stage','1960s','American']
    },
    {
      name:'Castor II',
      dry:695,
      prop:3729,
      thrust:259,
      isp:262,
      engines:'Solid',
      note:'Scout 2nd stage / Delta strap-on.',
      tags:['Solid Propellant','Kick Stage','1960s','American']
    },
    {
      name:'Algol III',
      dry:1600,
      prop:12720,
      thrust:472,
      isp:284,
      engines:'Solid',
      note:'Scout 1st stage.',
      tags:['Solid Propellant','Kick Stage','1970s','American']
    },
    {
      name:'Star-17',
      dry:22,
      prop:88,
      thrust:9.5,
      isp:278,
      engines:'Solid',
      note:'Small kick motor. Spin-stabilised.',
      tags:['Solid Propellant','Kick Stage','1970s','1980s','American']
    },
    {
      name:'Star-37FM',
      dry:100,
      prop:1000,
      thrust:45,
      isp:289,
      engines:'Solid',
      note:'Kick motor. Spin-stabilised.',
      tags:['Solid Propellant','Kick Stage','1980s','American']
    },
    {
      name:'Star-48B',
      dry:123,
      prop:2010,
      thrust:67,
      isp:292,
      engines:'Solid',
      note:'Payload kick stage. Widely used.',
      tags:['Solid Propellant','Kick Stage','1980s','1990s-2000s','American']
    },
    {
      name:'Star-48BV',
      dry:120,
      prop:2010,
      thrust:66,
      isp:292,
      engines:'Solid',
      note:'Star-48B with vectored nozzle.',
      tags:['Solid Propellant','Kick Stage','1990s-2000s','American']
    },
    {
      name:'Star-63D (IUS)',
      dry:620,
      prop:9250,
      thrust:182,
      isp:299,
      engines:'Solid',
      note:'Inertial Upper Stage 1st stage. Shuttle payload.',
      tags:['Solid Propellant','Kick Stage','1980s','1990s-2000s','American']
    },
    {
      name:'MAGE-1 (Apogee)',
      dry:40,
      prop:550,
      thrust:27,
      isp:285,
      engines:'Solid',
      note:'Apogee kick motor. Used on European/US commsats.',
      tags:['Solid Propellant','Kick Stage','1970s','1980s','American','European']
    },
    {
      name:'MAGE-2',
      dry:55,
      prop:813,
      thrust:36,
      isp:286,
      engines:'Solid',
      note:'Larger apogee kick motor.',
      tags:['Solid Propellant','Kick Stage','1980s','American','European']
    },
    {
      name:'AKM / Thiokol TE-364-4',
      dry:50,
      prop:545,
      thrust:39,
      isp:290,
      engines:'Solid',
      note:'Standard apogee kick motor.',
      tags:['Solid Propellant','Kick Stage','1970s','1980s','American']
    }
  ],
  'Side Boosters':[
    {
      name:'UA1205 SRB',
      dry:6200,
      prop:110000,
      thrust:5340,
      isp:268,
      engines:'Solid',
      note:'Titan IIIC/E strap-on. Per booster.',
      tags:['Solid Propellant','Strap-on Booster','1960s','1970s','American'],
      isBooster:true
    },
    {
      name:'UA1207 SRB',
      dry:7600,
      prop:143000,
      thrust:6846,
      isp:272,
      engines:'Solid',
      note:'Titan IVA strap-on. Per booster.',
      tags:['Solid Propellant','Strap-on Booster','1980s','1990s-2000s','American'],
      isBooster:true
    },
    {
      name:'UA1212 SRB (TIV-B)',
      dry:8300,
      prop:182000,
      thrust:7560,
      isp:275,
      engines:'Solid',
      note:'Titan IVB upgraded SRB. Per booster.',
      tags:['Solid Propellant','Strap-on Booster','1990s-2000s','American'],
      isBooster:true
    },
    {
      name:'Space Shuttle SRB',
      dry:87500,
      prop:503000,
      thrust:12450,
      isp:269,
      engines:'Solid',
      note:'Thiokol SRB. Per booster. Sea level thrust.',
      tags:['Solid Propellant','Strap-on Booster','1980s','1990s-2000s','American'],
      isBooster:true
    },
    {
      name:'GEM-40',
      dry:874,
      prop:11765,
      thrust:490,
      isp:274,
      engines:'Solid',
      note:'Delta II strap-on. Per booster.',
      tags:['Solid Propellant','Strap-on Booster','1980s','1990s-2000s','American'],
      isBooster:true
    },
    {
      name:'GEM-46',
      dry:910,
      prop:14175,
      thrust:490,
      isp:274,
      engines:'Solid',
      note:'Delta II 7925 strap-on. Per booster.',
      tags:['Solid Propellant','Strap-on Booster','1990s-2000s','American'],
      isBooster:true
    },
    {
      name:'GEM-60 (Delta IV)',
      dry:1600,
      prop:27000,
      thrust:827,
      isp:275,
      engines:'Solid',
      note:'Delta IV strap-on. Per booster.',
      tags:['Solid Propellant','Strap-on Booster','2000s','2010s+','American'],
      isBooster:true
    },
    {
      name:'Castor 4A',
      dry:1150,
      prop:11600,
      thrust:478,
      isp:265,
      engines:'Solid',
      note:'Delta/Scout strap-on. Per booster.',
      tags:['Solid Propellant','Strap-on Booster','1970s','1980s','American'],
      isBooster:true
    },
    {
      name:'Atlas V SRB (AJ-60A)',
      dry:1000,
      prop:42000,
      thrust:1688,
      isp:279,
      engines:'Solid',
      note:'Atlas V strap-on. Per booster.',
      tags:['Solid Propellant','Strap-on Booster','2000s','2010s+','American'],
      isBooster:true
    },
    {
      name:'Delta IV CBC (booster)',
      dry:26760,
      prop:199640,
      thrust:3137,
      isp:412,
      engines:'RS-68A',
      note:'Delta IV Heavy side CBC. LOX/LH2. Per booster.',
      tags:[
        'Liquid Oxygen / Liquid Hydrogen',
        'Strap-on Booster',
        '2000s',
        '2010s+',
        'American'
      ],
      isBooster:true
    },
    {
      name:'Atlas V CCB (booster)',
      dry:21054,
      prop:284089,
      thrust:4152,
      isp:338,
      engines:'RD-180',
      note:'Atlas V CCB used as future strap-on concept. LOX/RP-1.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Strap-on Booster',
        '2000s',
        '2010s+',
        'American'
      ],
      isBooster:true
    },
    {
      name:'SLS 5-Seg SRB',
      dry:97000,
      prop:628000,
      thrust:16000,
      isp:269,
      engines:'RSRM-V',
      note:'SLS Block 1 solid strap-on. Per booster. Largest SRBs ever flown.',
      tags:['Solid Propellant','Strap-on Booster','2010s+','American'],
      isBooster:true
    },
    {
      name:'R-7 Blok B/V/G/D',
      dry:3450,
      prop:38600,
      thrust:1021,
      isp:313,
      engines:'RD-107',
      note:'R-7 strap-on. Per booster. LOX/Kerosene.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Strap-on Booster',
        '1950s',
        '1960s',
        '1970s',
        'Soviet / Russian'
      ],
      isBooster:true
    },
    {
      name:'Energia Zenit LRB',
      dry:30000,
      prop:278000,
      thrust:7904,
      isp:338,
      res:2,
      engines:'RD-170',
      note:'Energia liquid strap-on (Zenit-based). Per booster.',
      tags:[
        'Liquid Oxygen / Kerosene',
        'Strap-on Booster',
        '1980s',
        'Soviet / Russian'
      ]
    }
  ]
};
let userStagesByCategory={}; // { catName: [stage, ...] }
let collapsedLibCats=new Set();
let showUserOnly=false;

function toggleLibrary(){
  libOpen=!libOpen;
  document.getElementById('lib-body').style.display=libOpen?'block':'none';
  document.getElementById('lib-arrow').classList.toggle('open',libOpen);
}

function makeCard(stage,cat,onDel){
  const card=document.createElement('div');
  card.className='stage-card'+(stage.isBooster?' booster-card':'')+(onDel?' lib-user-stage-card':'');
  card.draggable=true;
  // Slim display: name + fuel + prop mass
  const fuel=propShort(stage.tags);
  const fM=v=>v>=1000?(v/1000).toFixed(0)+'t':v+' kg';
  const propStr=stage.prop>=1000?fM(stage.prop)+' prop':'';
  const ispStr=stage.isp?stage.isp+'s':'';
  const thrStr=stage.thrust?fT(stage.thrust):'';
  const line1=[fuel,propStr].filter(Boolean).join(' · ');
  const line2=[ispStr,thrStr].filter(Boolean).join(' · ');
  card.innerHTML=`<div class="stage-card-name" title="${stage.name}">${stage.name}</div>
    ${line1?`<div class="stage-card-mini">${line1}</div>`:''}
    ${line2?`<div class="stage-card-mini" style="opacity:.7;">${line2}</div>`:''}`;
  if(onDel){
    const x=document.createElement('button');x.className='lib-del-btn';x.textContent='×';x.title='Remove stage';
    x.onclick=e=>{e.stopPropagation();onDel();};card.appendChild(x);
  }
  // Drag (separate from click via _didDrag flag)
  card.addEventListener('dragstart',e=>{
    _didDrag=true;
    _draggingStage={...stage,_cat:cat};
    e.dataTransfer.setData('text/plain',JSON.stringify(_draggingStage));
    e.dataTransfer.effectAllowed='copy';
    setTimeout(()=>card.classList.add('dragging'),0);
  });
  card.addEventListener('dragend',()=>{
    card.classList.remove('dragging');_draggingStage=null;
    setTimeout(()=>{_didDrag=false;},80);
  });
  card.addEventListener('click',e=>{
    e.stopPropagation();
    if(_didDrag)return;
    openStageModal(stage);
  });
  return card;
}

function buildLibCat(container,cat,stages,userStages,q){
  const filtBuiltin=stages.filter(s=>stageMatchesFilters(s)&&(!q||s.name.toLowerCase().includes(q)||
    (s.engines||'').toLowerCase().includes(q)||(s.note||'').toLowerCase().includes(q)||
    (s.tags||[]).some(t=>t.toLowerCase().includes(q))));
  const filtUser=(userStages||[]).filter(s=>stageMatchesFilters(s)&&(!q||s.name.toLowerCase().includes(q)||
    (s.engines||'').toLowerCase().includes(q)||(s.note||'').toLowerCase().includes(q)||
    (s.tags||[]).some(t=>t.toLowerCase().includes(q))));
  // In showUserOnly mode, show category even if empty (so users know it exists)
  if(!showUserOnly&&!filtBuiltin.length&&!filtUser.length)return;
  if(showUserOnly&&!filtUser.length&&q)return; // hide empty cats when searching
  const collapsed=!q&&collapsedLibCats.has(cat);
  const div=document.createElement('div');div.className='lib-cat';
  // Header
  const hdr=document.createElement('div');hdr.className='lib-cat-hdr';
  const lbl=document.createElement('span');lbl.className='lib-cat-label';lbl.textContent=cat;
  const count=document.createElement('span');
  count.style.cssText='font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-left:4px;';
  count.textContent=showUserOnly?`(${filtUser.length})`:`(${filtBuiltin.length+filtUser.length})`;
  const chev=document.createElement('span');chev.className='lib-cat-chevron'+(collapsed?'':' open');chev.textContent='▶';
  hdr.appendChild(lbl);hdr.appendChild(count);hdr.appendChild(chev);
  hdr.addEventListener('click',e=>{e.stopPropagation();collapsedLibCats.has(cat)?collapsedLibCats.delete(cat):collapsedLibCats.add(cat);buildStageLibrary();});
  div.appendChild(hdr);
  if(!collapsed){
    const scroll=document.createElement('div');scroll.className='lib-scroll';
    if(showUserOnly&&!filtUser.length){
      const empty=document.createElement('div');
      empty.style.cssText='font-family:var(--mono);font-size:9px;color:var(--text-dim);opacity:.5;padding:6px 4px;letter-spacing:.06em;white-space:nowrap;';
      empty.textContent='// no user stages here yet';
      scroll.appendChild(empty);
    }
    if(!showUserOnly)filtBuiltin.forEach(stage=>scroll.appendChild(makeCard(stage,cat,null)));
    filtUser.forEach((stage,ui)=>scroll.appendChild(makeCard(stage,cat,()=>{
      userStagesByCategory[cat].splice(ui,1);
      if(!userStagesByCategory[cat].length)delete userStagesByCategory[cat];
      buildStageLibrary();
    })));
    div.appendChild(scroll);
  }
  container.appendChild(div);
}

function buildStageLibrary(){
  const q=(document.getElementById('lib-search')?.value||'').toLowerCase();
  const cont=document.getElementById('lib-content');
  cont.innerHTML='';
  // ── Preset Vehicles ──
  const vehicleStages=BUILTIN_PRESETS.filter(p=>{
    if(!q)return true;
    const sub=(p.stageNames||[]).join(' ');
    return(p.name+' '+sub+' '+(p.note||'')+' '+(p.tags||[]).join(' ')).toLowerCase().includes(q);
  });
  if(vehicleStages.length){
    const collapsed=collapsedLibCats.has('__vehicles__');
    const catDiv=document.createElement('div');catDiv.className='lib-cat';
    const hdr=document.createElement('div');hdr.className='lib-cat-hdr';
    const chev=document.createElement('span');chev.className='lib-cat-chevron'+(collapsed?'':' open');chev.textContent='▶';
    const lbl=document.createElement('span');lbl.className='lib-cat-label';lbl.textContent='Preset Vehicles';
    const cnt=document.createElement('span');cnt.style.cssText='font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-left:4px;';cnt.textContent='('+(showUserOnly?0:vehicleStages.length)+')';
    hdr.appendChild(lbl);hdr.appendChild(cnt);hdr.appendChild(chev);
    hdr.addEventListener('click',e=>{e.stopPropagation();collapsedLibCats.has('__vehicles__')?collapsedLibCats.delete('__vehicles__'):collapsedLibCats.add('__vehicles__');buildStageLibrary();});
    catDiv.appendChild(hdr);
    if(!collapsed){
      const scroll=document.createElement('div');scroll.className='lib-scroll';
      if(showUserOnly){
        const empty=document.createElement('div');
        empty.style.cssText='font-family:var(--mono);font-size:9px;color:var(--text-dim);opacity:.5;padding:6px 4px;letter-spacing:.06em;';
        empty.textContent='// built-in vehicles hidden';
        scroll.appendChild(empty);
      }
      (!showUserOnly?vehicleStages:[]).forEach((p,pi)=>{
        const card=document.createElement('div');
        card.className='stage-card';card.style.width='180px';card.draggable=true;
        const sub=(p.stageNames||[]).join(' + ');
        card.innerHTML=`<div class="stage-card-name" title="${p.name}">${p.name}</div>
          ${p.note?`<div class="stage-card-mini" style="white-space:normal;line-height:1.4;">${p.note.slice(0,70)}${p.note.length>70?'…':''}</div>`:''}`;
        card.title='Click for details · Drag to load all stages';
        card.addEventListener('dragstart',e=>{
          _didDrag=true;
          _draggingStage={_isVehicle:true,_preset:p,name:p.name};
          e.dataTransfer.setData('text/plain',JSON.stringify({_isVehicle:true,name:p.name}));
          e.dataTransfer.effectAllowed='copy';
          setTimeout(()=>card.classList.add('dragging'),0);
        });
        card.addEventListener('dragend',()=>{card.classList.remove('dragging');setTimeout(()=>{_didDrag=false;},80);});
        card.addEventListener('click',e=>{e.stopPropagation();if(_didDrag)return;openVehicleModal(p);});
        scroll.appendChild(card);
      });
      catDiv.appendChild(scroll);
    }
    cont.appendChild(catDiv);
  }
  // Built-in categories (always shown; built-in stages hidden in showUserOnly)
  Object.entries(STAGE_LIBRARY).forEach(([cat,stages])=>{
    buildLibCat(cont,cat,showUserOnly?[]:stages,userStagesByCategory[cat],q);
  });
  // User-created categories not in built-ins
  const builtinNames=new Set(Object.keys(STAGE_LIBRARY));
  Object.keys(userStagesByCategory).filter(k=>!builtinNames.has(k)).forEach(cat=>{
    buildLibCat(cont,cat,[],userStagesByCategory[cat],q);
  });
}

function applyStageData(stageIdx,stage){
  const s=stageIdx+1;
  const set=(key,val)=>{const el=document.getElementById(`s${s}_${key}`);if(el){el.value=val;stageStore[stageIdx]={...stageStore[stageIdx],[key]:String(val)};}};
  set('dry',stage.dry);set('prop',stage.prop);set('thrust',stage.thrust);set('isp',stage.isp);set('res',stage.res??2);
  // Forward stage-and-a-half fields from the library entry into stageStore
  if(stage.s15){
    stageCarryS15(stageStore[stageIdx],stage);
  } else {
    stageClearS15(stageStore[stageIdx]);
  }
  currentStageNames[stageIdx]=stage.name||null;
  stageSaved[stageIdx]=false;
  buildStageComposition();
  markLVUserDefined();
}

// ── Booster drop zone handlers ──
// Booster populate helper (called from table drop)
function applyBoosterData(s){setBoosters(true);document.getElementById('b_dry').value=s.dry;document.getElementById('b_prop').value=s.prop;document.getElementById('b_thrust').value=s.thrust;document.getElementById('b_isp').value=s.isp;document.getElementById('b_res').value=s.res??2;currentBoosterName=s.name||null;boosterSaved=false;buildStageComposition();markLVUserDefined();}

// ── Stage column drop handlers (called from buildTable) ──
function onColDragOver(e,stageIdx){
  if(!_draggingStage||_draggingStage.isBooster)return;
  e.preventDefault();e.dataTransfer.dropEffect='copy';
  // Highlight whole column by adding class to the row containing this header
  document.getElementById('stage-header-row').classList.add('stage-col-hover');
  // Store target column for visual highlight
  document.getElementById('stage-header-row').dataset.hoverCol=stageIdx;
  // Highlight just this header cell
  const ths=document.getElementById('stage-header-row').querySelectorAll('th');
  ths.forEach((th,i)=>th.style.background=i===stageIdx+1?'rgba(0,200,255,.15)':'');
}
function onColDragLeave(e,stageIdx){
  const ths=document.getElementById('stage-header-row').querySelectorAll('th');
  ths.forEach(th=>th.style.background='');
}
function onColDrop(e,stageIdx){
  e.preventDefault();
  const ths=document.getElementById('stage-header-row').querySelectorAll('th');
  ths.forEach(th=>th.style.background='');
  if(!_draggingStage)return;
  if(_draggingStage._isVehicle){
    // Drop vehicle card on any column → load whole preset
    loadPreset(_draggingStage._preset,'builtin_'+BUILTIN_PRESETS.indexOf(_draggingStage._preset));
  } else if(!_draggingStage.isBooster){
    applyStageData(stageIdx,_draggingStage);
  }
}



const FILTER_TREE={
  'Propellant':[
    'Liquid Oxygen / Liquid Hydrogen',
    'Liquid Oxygen / Kerosene',
    'Liquid Oxygen / Ethanol',
    'Nitrogen Tetroxide / Aerozine-50',
    'Nitrogen Tetroxide / UDMH',
    'Inhibited Red Fuming Nitric Acid / UDMH',
    'Solid Propellant',
  ],
  'Application':['First Stage','Upper Stage','Kick Stage','Strap-on Booster','Restartable'],
  'Era':['1950s','1960s','1970s','1980s','1990s-2000s','2010s+'],
  'Origin':['American','Soviet / Russian','European'],
};
let activeFilters={};
let collapsedFilterCats=new Set(['Origin']);
let filterPanelOpen=false;


