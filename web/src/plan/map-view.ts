// Everything that touches the map library. The rest of the page talks to this class and
// never to MapLibre directly, so the map could be swapped without touching the analysis.
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { CLASSES, toLonLat } from './model.ts';
import type { Run } from './model.ts';
import { CELL_KM } from './region.ts';
import type { BBox, Region, WaterProps } from './types.ts';

const BASEMAP = 'https://tiles.openfreemap.org/styles/positron';
const EMPTY = { type: 'FeatureCollection' as const, features: [] };
const SOURCES = ['grid', 'water', 'fires', 'runs', 'probe', 'area'] as const;
type SourceId = (typeof SOURCES)[number];

const INK = '#15232b';
const FIRE = '#7a1f0c';

export class MapView {
  private readonly map: MapLibreMap;
  /** Resolves once the basemap style is loaded and our layers are added. */
  readonly ready: Promise<void>;

  constructor(container: string) {
    this.map = new maplibregl.Map({
      container,
      style: BASEMAP,
      center: [-7, 42.1],
      zoom: 7,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    // Listen for the style straight away so the event cannot fire before anyone is listening.
    // We wait for the style only, not for every basemap tile: our layers do not depend on them.
    this.ready = new Promise<void>((resolve) => this.map.once('style.load', () => resolve())).then(() => this.addLayers());
  }

  private source(id: SourceId): GeoJSONSource {
    return this.map.getSource(id) as GeoJSONSource;
  }

  private addLayers(): void {
    const map = this.map;
    // Our layers go under the basemap's labels so place names stay readable.
    const below = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
    for (const id of SOURCES) map.addSource(id, { type: 'geojson', data: EMPTY });

    const classColours = CLASSES.flatMap((c, i) => [i, c.color]);
    map.addLayer(
      {
        id: 'grid',
        type: 'fill',
        source: 'grid',
        paint: { 'fill-color': ['match', ['get', 'cls'], ...classColours, '#ccc'] as never, 'fill-opacity': 0.5, 'fill-antialias': false },
      },
      below,
    );
    map.addLayer({ id: 'area', type: 'line', source: 'area', paint: { 'line-color': INK, 'line-width': 1, 'line-dasharray': [3, 3] } }, below);
    map.addLayer({ id: 'fires', type: 'fill', source: 'fires', paint: { 'fill-color': FIRE, 'fill-opacity': 0.14 } }, below);
    map.addLayer({ id: 'fires-line', type: 'line', source: 'fires', paint: { 'line-color': FIRE, 'line-width': 0.8, 'line-opacity': 0.65 } }, below);
    map.addLayer({ id: 'water-off', type: 'fill', source: 'water', paint: { 'fill-color': '#9fb3bd', 'fill-opacity': 0.75 } }, below);
    map.addLayer({ id: 'water-on', type: 'fill', source: 'water', paint: { 'fill-color': '#0c3f63' } }, below);
    map.addLayer({ id: 'water-on-line', type: 'line', source: 'water', paint: { 'line-color': '#ffffff', 'line-width': 1 } }, below);
    map.addLayer({
      id: 'runs',
      type: 'line',
      source: 'runs',
      minzoom: 8.5,
      paint: { 'line-color': '#ffd24a', 'line-width': 2, 'line-dasharray': [2, 1.5] },
    });
    map.addLayer({
      id: 'probe-line',
      type: 'line',
      source: 'probe',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': INK, 'line-width': 2 },
    });
    map.addLayer({
      id: 'probe-pt',
      type: 'circle',
      source: 'probe',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': INK, 'circle-stroke-width': 3 },
    });

    for (const layer of ['water-on', 'water-off']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
  }

  /** Calls back with the water body clicked, or with the clicked position if none was hit. */
  onClick(handler: (hit: { waterId: string } | { lon: number; lat: number }) => void): void {
    this.map.on('click', (event) => {
      const water = this.map.queryRenderedFeatures(event.point, { layers: ['water-on', 'water-off'] })[0];
      const id = (water?.properties as Partial<WaterProps> | undefined)?.id;
      handler(id ? { waterId: id } : { lon: event.lngLat.lng, lat: event.lngLat.lat });
    });
  }

  /** Loads a region's outlines and frames its analysis area. */
  showRegion(region: Region, animate = true): void {
    this.source('water').setData(region.water as never);
    this.source('fires').setData((region.fires ?? EMPTY) as never);
    const [w, s, e, n] = region.area;
    this.source('area').setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      },
    });
    this.fit(region.area, animate);
  }

  fit([w, s, e, n]: BBox, animate = true): void {
    this.map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 30, duration: animate ? 700 : 0 },
    );
  }

  /**
   * Redraws everything that depends on the settings. `runs` are the runs to draw, and
   * `field` names the per-feature property holding their length (see region.ts).
   */
  update(region: Region, cellClass: Uint8Array, runs: Run[], threshold: number, field: string): void {
    const half = CELL_KM / 2;
    this.source('grid').setData({
      type: 'FeatureCollection',
      features: region.cells.map((cell, i) => {
        const [w, s] = toLonLat(region.frame, cell.x - half, cell.y - half);
        const [e, n] = toLonLat(region.frame, cell.x + half, cell.y + half);
        return {
          type: 'Feature',
          properties: { cls: cellClass[i] ?? 0 },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [w, s],
                [e, s],
                [e, n],
                [w, n],
                [w, s],
              ],
            ],
          },
        };
      }),
    });

    this.map.setFilter('water-on', ['>=', ['get', field], threshold]);
    this.map.setFilter('water-on-line', ['>=', ['get', field], threshold]);
    this.map.setFilter('water-off', ['<', ['get', field], threshold]);
    this.source('runs').setData({
      type: 'FeatureCollection',
      features: runs
        .filter((run) => run.lengthM >= threshold)
        .map((run) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [toLonLat(region.frame, run.ax, run.ay), toLonLat(region.frame, run.bx, run.by)] },
        })),
    });
  }

  /** Marks a measured spot, with a line to the nearest usable water if there is one. */
  setProbe(spot: [number, number], water: [number, number] | null): void {
    this.source('probe').setData({
      type: 'FeatureCollection',
      features: [
        ...(water ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [spot, water] } }] : []),
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: spot } },
      ],
    });
  }

  clearProbe(): void {
    this.source('probe').setData(EMPTY);
  }

  flyTo(lon: number, lat: number, zoom: number): void {
    this.map.flyTo({ center: [lon, lat], zoom, duration: 1400, essential: false });
  }

  setLayerVisible(layers: string[], visible: boolean): void {
    for (const layer of layers) this.map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
  }

  /** Position of a lon/lat on the page, in viewport pixels. */
  screenOf(lon: number, lat: number): { x: number; y: number } {
    const box = this.map.getContainer().getBoundingClientRect();
    const point = this.map.project([lon, lat]);
    return { x: box.left + point.x, y: box.top + point.y };
  }
}
