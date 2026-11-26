# Roadmap

Ordered by how much each step would matter to the people we want to show this to. "Who" names the audience that step is for.

## Now (pilot, built)

- Longest straight run per water body, two pilot regions.
- Minutes per load from any point; ranked past fires.
- Monthly Sentinel-2 run history for the largest Spanish-region reservoirs, 2021–2025.

## Next: make the drought finding defensible

1. **Validate against a documented case.** Catalonia, April 2023: amphibious aircraft could not use La Baells and La Llosa del Cavall at about 26 % of capacity. Run the satellite step there and see whether the measured run drops below the threshold in the same weeks. *Who: researchers, any reviewer.*
2. **Validate against gauges.** Compare observed water share with official weekly reservoir storage (Spanish ministry hydrological bulletin). *Who: basin authorities.*
3. **The level that matters.** For each reservoir, the storage level below which the run is lost. This is the number a dam operator can act on in fire season. *Who: basin authorities, dam operators.*
4. **Month slider.** Show the whole region as it was in a chosen month, instead of each reservoir at its own driest.

## Then: close the known gaps

5. **Official reservoir inventory for Spain.** OpenStreetMap maps some canyon reservoirs as river sections, so they are missing. Replace with the national inventory.
6. **Elevation-aware run length.** The required run grows from about 1 mile at sea level to about 2.5 miles at 8,000 ft. Use a terrain model to set the threshold per water body.
7. **Approach and climb-out.** Terrain analysis along each run's axis: flag runs that end in rising ground.
8. **Depth, where it exists.** Modelled mean depth (HydroLAKES) as a warning flag; bathymetry where agencies publish it.
9. **Forest only.** Weight the minutes-per-load surface by land cover so farmland and towns do not count.
10. **Rivers and the sea.** Long river reaches and coastal water are used for scooping and are excluded today.

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
