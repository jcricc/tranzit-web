// Map registry shared by the browser and the bake tools.
//
// Every baked file a map needs is named from one prefix, so the exporters,
// the bakers, the deploy staging, and the runtime loader all agree on paths
// without listing them in five places. This module has no dependencies on
// purpose: .tools/*.mjs import it from Node.

export const DEFAULT_MAP = 'mp_hijacked';
export const MAP_STORAGE_KEY = 'vibeslops:map';

export const MAPS = Object.freeze({
  zm_transit: Object.freeze({
    id: 'zm_transit',
    name: 'TranZit',
    prefix: 'zm_transit',
    card: null,
    radar: null,
    minimapSpan: 1250,
    env: 'textures/zm_transit/env/',
    probe: 'textures/zm_transit/probe/',
    vision: 'zm_transit.vision.json',
    lut: 'textures/zm_transit_lut.png',
    fallbackSpawn: [-6785, -26, -5591],
    navTileSize: 256,
    sources: { sky: 'zm_transit_haze_ft', lut: 'zm_lut_win', vision: 'zm_transit_base_off' },
    baked: true,
  }),
  mp_hijacked: Object.freeze({
    id: 'mp_hijacked',
    name: 'Hijacked',
    prefix: 'hijacked',
    card: 'ui/menu_mp_map_select_hijacked_final.png',
    radar: 'ui/hud/compass_map_mp_hijacked.png',
    // Radar viewport radius in world units, tuned by eye against the game.
    // Both maps run the engine default compassmaxrange of 2100 (Nuketown's
    // script sets it explicitly), so they share the same span here.
    minimapSpan: 1250,
    // Hijacked shipped before per-map asset folders existed. Its sky, probe
    // and vision set stay where the first deploy put them.
    env: 'textures/env/',
    probe: 'textures/probe/',
    vision: 'vision.json',
    lut: 'textures/mp_hijacked_lut.png',
    fallbackSpawn: [2102, 57, 133],
    // Names of the dumped source assets bake:env reads. They follow the
    // worldspawn's skyboxmodel and lutmaterial keys, not the map id.
    sources: { sky: 'skybox_mp_hijacked_ft', lut: 'mp_hijacked_lut_win', vision: 'mp_hijacked' },
    baked: true,
  }),
  mp_nuketown_2020: Object.freeze({
    id: 'mp_nuketown_2020',
    name: 'Nuketown 2025',
    prefix: 'nuketown_2020',
    // The DLC card ships in patch_ui_mp.ff, not ui_mp.ff, and drops the
    // underscore like the rest of the map's art.
    card: 'ui/menu_mp_map_select_nuketown2020_final.png',
    // The zone drops the underscore in its art names: compass_map_mp_nuketown2020
    // and skybox_mp_nuketown2020, while the map itself is mp_nuketown_2020.
    radar: 'ui/hud/compass_map_mp_nuketown2020.png',
    minimapSpan: 1250,
    env: 'textures/nuketown_2020/env/',
    probe: 'textures/nuketown_2020/probe/',
    vision: 'nuketown_2020.vision.json',
    lut: 'textures/mp_nuketown_2020_lut.png',
    fallbackSpawn: [0, 0, 0],
    // The LUT material mp_nuketown2020_lut samples the image mp_nuketown2020_win.
    sources: { sky: 'skybox_mp_nuketown2020_ft', lut: 'mp_nuketown2020_win', vision: 'mp_nuketown_2020' },
    // Geometry, collision, navmesh and props are baked. Textures, sky, LUT,
    // radar and title card wait on the zone's image pack (see README).
    baked: true,
    // Nodes of the baked render scene the runtime hides. The hydro car's
    // display case is an fxanim model: the game poses it with an xanim the
    // composer does not play, so its bind pose puts the case 30-60 units under
    // the road and leaves only the sign panel floating over the buses. The
    // server-side brush copy of the case is the one to draw; until the next
    // bake carries it (see .tools/export_collision.py), the client model is
    // hidden here rather than shown wrong.
    hiddenNodes: Object.freeze(['fxanim_mp_nuked2025_display_glass_mod']),
  }),
});

/**
 * Hide the nodes a map lists in `hiddenNodes`. Names are matched with and
 * without the composer's `i_` instance prefix, and against the mesh name a
 * batched node carries. Returns how many objects were hidden.
 */
export function hideMapNodes(root, map) {
  const names = map?.hiddenNodes ?? [];
  if (!root || !names.length) return 0;
  let hidden = 0;
  root.traverse((object) => {
    const name = String(object.name ?? '').replace(/^i_/, '');
    if (!names.some((wanted) => name === wanted || name.startsWith(`${wanted}_`))) return;
    object.visible = false;
    // The static batcher must leave it alone or it would come back inside a batch.
    object.userData.keepSeparate = true;
    hidden += 1;
  });
  return hidden;
}

export const MAP_IDS = Object.freeze(Object.keys(MAPS));

export function isMapId(id) {
  return typeof id === 'string' && Object.hasOwn(MAPS, id);
}

/** Resolve a map from its id, prefix, or the short name after `mp_`. */
export function findMap(value, maps = MAPS) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  if (Object.hasOwn(maps, text)) return maps[text];
  if (Object.hasOwn(maps, `mp_${text}`)) return maps[`mp_${text}`];
  for (const map of Object.values(maps)) {
    if (map.prefix === text) return map;
  }
  return null;
}

/**
 * Baked and intermediate file names for a map, relative to export/web/.
 * The intermediate set is bake input only and never ships.
 */
export function mapFiles(map) {
  const { prefix } = map;
  return {
    // compose_scene.py output, then bake:map input
    sourceGltf: `${prefix}.gltf`,
    sourceBin: `${prefix}.bin`,
    geometry: `${prefix}_geometry.glb`,
    // export_collision.py output, then bake input for the rest
    collisionGltf: `${prefix}_collision.gltf`,
    collisionBin: `${prefix}_collision.bin`,
    collisionSource: `${prefix}_collision_source.json`,
    // shipped runtime set
    render: `${prefix}_optimized.glb`,
    collisionBvh: `${prefix}_collision_bvh.bin`,
    collisionBvhMeta: `${prefix}_collision_bvh.json`,
    navmesh: `${prefix}.navmesh.bin`,
    navmeshMeta: `${prefix}.navmesh.json`,
    navHints: `${prefix}_nav_hints.json`,
    ladders: `${prefix}_ladders.json`,
    probes: `${prefix}_probes.bin`,
    probesMeta: `${prefix}_probes.json`,
  };
}

/** Files bake:map and compose_scene.py write that the deploy must not carry. */
export function mapIntermediateFiles(map) {
  const files = mapFiles(map);
  return [
    files.sourceGltf, files.sourceBin, files.geometry,
    files.collisionGltf, files.collisionBin, files.collisionSource,
  ];
}

/** Files a deploy needs before a map marked `baked` is playable at all. */
export function mapRequiredFiles(map) {
  const files = mapFiles(map);
  return [files.render, files.collisionBvh, files.collisionBvhMeta, files.navmesh];
}

/**
 * Files the runtime degrades without: flat lighting instead of the map's sky,
 * probe and grade, no radar art, no title card. Worth a warning, not a stop.
 */
export function mapRecommendedFiles(map) {
  const files = mapFiles(map);
  return [files.navHints, files.probes, map.env, map.probe, map.lut, map.vision, map.card, map.radar].filter(Boolean);
}

/**
 * Pick the map for this page load: `?map=` wins, then the remembered choice,
 * then the default. Unknown values fall through rather than throw so a stale
 * link still opens the game. An explicit link to an unbaked map is honoured
 * so it can explain itself; a remembered one is not, or a visitor would be
 * stuck on the error screen until they cleared site data.
 */
export function resolveMapId({ search = '', storage = null, maps = MAPS } = {}) {
  let requested = null;
  try {
    requested = new URLSearchParams(search).get('map');
  } catch {
    requested = null;
  }
  const fromQuery = findMap(requested, maps);
  if (fromQuery) return fromQuery.id;
  let remembered = null;
  try {
    remembered = storage?.getItem(MAP_STORAGE_KEY) ?? null;
  } catch {
    remembered = null;
  }
  const fromStorage = findMap(remembered, maps);
  if (fromStorage?.baked) return fromStorage.id;
  return DEFAULT_MAP;
}

export function rememberMap(storage, id, maps = MAPS) {
  if (!Object.hasOwn(maps, id) || !maps[id].baked) return;
  try {
    storage?.setItem(MAP_STORAGE_KEY, id);
  } catch {
    // Storage is a convenience; a sandboxed frame simply forgets.
  }
}
