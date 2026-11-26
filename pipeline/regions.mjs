// Pilot regions. Adding a region = adding an entry here and re-running the pipeline.
// bbox order: [west, south, east, north] in WGS84 degrees.
export const REGIONS = {
  'es-northwest': {
    name: 'Ourense – Zamora, Spain',
    country: 'ES',
    bbox: [-8.4, 41.6, -5.6, 42.7],
    note: 'Reservoir country: most open water here is dammed and drawn down in summer.',
  },
  'ca-okanagan': {
    name: 'Okanagan – Shuswap, British Columbia, Canada',
    country: 'CA',
    bbox: [-120.2, 49.5, -118.4, 51.2],
    note: 'Lake country: long natural lakes in valleys, small lakes on the plateaus.',
  },
  'es-catalonia': {
    name: 'Berguedà – Solsonès, Catalonia, Spain',
    country: 'ES',
    bbox: [0.9, 41.6, 2.6, 42.6],
    note: 'Pre-Pyrenees reservoirs. In April 2023 scooper aircraft could not use La Baells or La Llosa del Cavall at about a quarter full.',
  },
};

// Regions queued for the same pipeline. Listed on the site as "planned" so visitors can
// see where coverage is heading. Each was chosen for a large, well-documented recent fire;
// the roadmap item is to rank candidate regions from burned-area data instead of by hand.
export const PLANNED = [
  { name: 'Sierra de Gata – Las Hurdes, Extremadura', country: 'ES' },
  { name: 'Alto Palancia – Bejís, Valencia', country: 'ES' },
  { name: 'Jasper – Alberta foothills', country: 'CA' },
  { name: 'North Slave – Yellowknife, Northwest Territories', country: 'CA' },
  { name: 'La Ronge – northern Saskatchewan', country: 'CA' },
];

// Analysis parameters. Every value that is an assumption rather than a sourced
// figure is marked so the site can show it honestly.
export const PARAMS = {
  corridorWidthM: 100, // ASSUMPTION: clear water width required along the run
  minRunKeptM: 400, // water bodies whose longest run is shorter are dropped from the output
  directionStepDeg: 3,
};

// Official water-level gauges, by region. `match` picks the reservoir by its mapped name.
// Used by 07-levels.mjs to turn satellite observations into levels and known depths.
const ACA = 'Agència Catalana de l’Aigua, open data (daily level and volume, since 2000)';
export const GAUGES = {
  'es-catalonia': [
    { match: /Baells/, station: 'Embassament de la Baells (Cercs)', source: ACA },
    { match: /Llosa del Cavall/, station: 'Embassament de la Llosa del Cavall (Navès)', source: ACA },
    { match: /Sau/, station: 'Embassament de Sau (Vilanova de Sau)', source: ACA },
    { match: /Sant Ponç/, station: 'Embassament de Sant Ponç (Clariana de Cardener)', source: ACA },
    { match: /Susqueda/, station: 'Embassament de Susqueda (Osor)', source: ACA },
  ],
};
