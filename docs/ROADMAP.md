# Roadmap

Ordered by how much each step would matter to the people we want to show this to. "Who" names the audience that step is for.

## Now (pilot, built)

- Longest straight run per water body, two pilot regions.
- Minutes per load from any point; ranked past fires.
- Monthly Sentinel-2 run history for the largest Spanish-region reservoirs, 2021–2025.
- A third region, Berguedà–Solsonès in Catalonia, built from one config entry.
- Guided tour (choose a question, be walked to its answer), a page for planners, and a region list showing built and planned regions.

## Next: make the drought finding defensible

1. **Tested against a documented case: done.** Catalonia, April 2023: amphibious aircraft could not use La Baells at 26 % of capacity. Run length did not predict it (2,120 m that day), and neither did depth (that run was known to be over 1.8 m deep). A width experiment did: with a 200 m clear corridor the run was 2,250 m when full and 1,420 m on the day it was closed.
1a. **Clear width as a setting: done.** Every run, mapped and observed, is measured at 100, 150, 200, 250 and 300 m, and the visitor sets the width in step 2. Still open: confirm with an aerial firefighting crew what width they actually need, and make that the default. *Who: fire agencies.*
1b. **Depth from water level: done for gauged reservoirs.** Where an official gauge exists (Catalonia), each observation carries the level and percent of capacity, the run known to be at least 1.8 m deep, and the level below which the run is lost. Next: connect the SAIH gauges of the Miño-Sil, Duero and Ebro basins. *Who: basin authorities, fire agencies, researchers.*
2. **Validate against gauges.** Compare observed water share with official weekly reservoir storage (Spanish ministry hydrological bulletin). *Who: basin authorities.*
3. **The level that matters: done where gauged.** For each gauged reservoir, the level below which the run is lost, shown in its card. *Who: basin authorities, dam operators.*
4. **Month slider.** Show the whole region as it was in a chosen month, instead of each reservoir at its own driest.

## Then: close the known gaps

5. **Official reservoir inventory for Spain.** OpenStreetMap maps some canyon reservoirs as river sections, so they are missing. Replace with the national inventory.
6. **Elevation-aware run length.** The required run grows from about 1 mile at sea level to about 2.5 miles at 8,000 ft. Use a terrain model to set the threshold per water body.
7. **Approach and climb-out.** Terrain analysis along each run's axis: flag runs that end in rising ground.
8. **Depth, where it exists.** Modelled mean depth (HydroLAKES) as a warning flag; bathymetry where agencies publish it.
9. **Forest only.** Weight the minutes-per-load surface by land cover so farmland and towns do not count.
10. **Rivers and the sea.** Long river reaches and coastal water are used for scooping and are excluded today.

## Coverage: more fire-prone regions

Every region runs through the same five pipeline steps, driven by one entry in `pipeline/regions.mjs`. Planned regions are listed in that file and shown on the site.

- **Choose regions from data, not by hand.** Rank candidate areas by burned area (NBAC for Canada, EFFIS for Europe) and build the highest first. The planned list today was picked for large, well-documented recent fires.
- **Large reservoirs.** Sprawling reservoirs (Ricobayo, Belesar) are skipped by the satellite step because they need tens of megapixels per scene at 10 m. Read them at 20 m, or tile them.
- **Reservoirs on image-tile edges.** Cernadilla returned no usable scenes; the likely cause is that it straddles two Sentinel-2 tiles. Mosaic adjacent tiles.
- **Beyond Canada and Spain.** Portugal, France, Italy and Greece use the same aircraft and the same open data sources apply.

## Scale

11. **Whole countries.** Move outlines to vector tiles (PMTiles) and the grid to a precomputed raster so all of Canada and Spain load fast.
12. **Scheduled rebuilds.** Re-run the satellite step monthly so the site shows the latest clear observation.
13. **Radar.** Sentinel-1 sees through smoke and cloud; add it for use during fire season.
14. **Open downloads.** Publish the results as GeoParquet and GeoJSON with a licence, and an OGC API so agencies can pull the layer into their own GIS.

## Wider questions the same data can answer

- **Where would one new water point help most?** Rank locations by how much burned-area exposure a designated scoop site or tank would bring within six minutes. *Who: municipalities, regional planners.*
- **Fleet mix.** Where scoopers stop being effective and helicopters or land-based tankers are needed. Add helicopter dip sites (far smaller water). *Who: agencies.*
- **Climate outlook.** Combine run history with drought projections: which refill sites are likely to be lost more often by mid-century.
- **Mutual aid briefing.** One method across borders for crews deployed outside their home region. *Who: CIFFC, rescEU.*
- **Languages.** Spanish and French editions.

## Research angle

A possible thesis question: *How much aerial firefighting capacity does reservoir drawdown remove during drought, and can it be monitored from open satellite data?* It touches data acquisition, spatial analysis, spatial statistics and open standards.
