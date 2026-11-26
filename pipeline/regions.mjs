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
};

// Analysis parameters. Every value that is an assumption rather than a sourced
// figure is marked so the site can show it honestly.
export const PARAMS = {
  corridorWidthM: 100, // ASSUMPTION: clear water width required along the run
  minRunKeptM: 400, // water bodies whose longest run is shorter are dropped from the output
  directionStepDeg: 3,
};
