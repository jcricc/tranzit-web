# TranZit port: working guide

This branch adds a playable TranZit scene and browser zombie systems to Luckey Faraday's [Claude of Duty](https://github.com/luckeyfaraday/claude-of-duty). It is an unofficial fan project. The MIT license covers the original project code, not exported Black Ops II art, maps, audio, models, or animations; see [ASSET_NOTICE.md](ASSET_NOTICE.md).

## Run and change it on a Mac

Use Node 22 or newer for the build and test tools. From the repository root:

```bash
npm ci
python3 -m http.server 8000 --directory export/web
```

Open <http://localhost:8000/?map=zm_transit>. The Python server stays running in that Terminal tab. Edit files in your editor, then refresh the browser. Changes to the baked map itself require a new bake.

**Network detail:** `export/web/index.html` currently maps Three.js, three-mesh-bvh, and Recast modules to jsDelivr. The first browser load needs those CDN modules even though the map assets and HTTP server are local. `npm ci` does not change that import map. Use normal Wi-Fi for first setup; this is not yet an offline package.

The GitHub repository contains the browser-ready map, zombies, interactions, and textures. You can edit their JavaScript, UI, balance, positions, and material choices from the Mac without BO2 installed. Extracting *new* BO2 models, textures, animations, sounds, or map data still needs access to the installed game files and the patched Windows exporter. The original PC has those files.

## Where to edit

| What | File |
| --- | --- |
| Select the TranZit map, fallback player start, sky, LUT, and bake names | `export/web/maps.js` |
| Main game boot, controls, HUD integration, and TranZit tint override | `export/web/index.html` |
| Zombie AI, original animation clips, hitboxes, damage, waves, and spawn choice | `export/web/zombie-system.js` |
| Starting points, combat rewards, purchases, and repair rewards | `export/web/zombie-economy.js` |
| Door meshes, prices, collision, window boards, repair/tear behavior, and F prompt | `export/web/zombie-interactions.js` |
| Door and window placements extracted from map entities | `export/web/interactions/tranZit.json` |
| Exported zombie spawn markers | `export/web/zombies/spawns.json` |
| Lighting and color grading | `export/web/lighting.js`, `export/web/index.html`, TranZit LUT/vision in `export/web/textures/` |
| Map composition and collision source generation | `.tools/compose_scene.py`, `.tools/export_collision.py` |
| Browser bake steps | `.tools/bake_map.mjs`, `.tools/bake_collision_bvh.mjs`, `.tools/bake_navmesh.mjs`, `.tools/bake_env.mjs`, `.tools/bake_probes.mjs` |

The shipped runtime map is `export/web/zm_transit_optimized.glb` plus collision BVH, navigation mesh, probes, vision, and textures. The source `zm_transit.gltf/.bin` and raw BO2 dump were intentionally left out of this Git repository; the Mac can play and change gameplay code, but cannot fully recompose the world from this checkout alone.

## How the current port was made

1. On the PC, the installed BO2 `zone/all/zm_transit.ff`, its patches and regional `zm_transit_gump_*.ff` files were read by OpenAssetTools Unlinker. This project used upstream OAT revision `9dca965366541504b71fa8cfb7ac049cb9b717e1` and the local T6 patches in `.tools/oat/`. Stock OAT at that revision did not supply this entire browser geometry export on its own.
2. The dump produced GfxWorld geometry, model exports, materials, images, entities, and animation data in a separate `work/dumps` area on the PC. Regional files filled in referenced models absent from the main zone.
3. PC helper scripts `dump_transit.py`, `prepare_transit.py`, and `export_interactions.py` lived **beside** the repository under the original `work` folder. They were not part of the Git commit. Keep copies of them and the patched OAT source on the PC if you expect to repeat extraction.
4. `.tools/compose_scene.py zm_transit` assembled world surfaces and placed models into glTF. `.tools/export_collision.py` made collision/navigation inputs. Node bake tools produced the optimized GLB, collision BVH, tiled navmesh, environment, and probes.
5. The browser loads those baked files via the `zm_transit` entry in `export/web/maps.js`. JavaScript adds zombie movement, combat, points, doors, and repairable windows. Exporting art or entity data does not automatically export BO2's game scripts.

BO2 positions are z-up. The exporters convert them to Three.js y-up as `(x, y, z) -> (x, z, -y)`. Keep that conversion in mind when comparing entity coordinates with browser positions.

## Windows, doors, chalk, and mystery box

**Windows:** The PC's `zm_transit.d3dbsp.ents` contains `zbarrier_zmcore_BasicWoodBarrier` entities with identifiers, origins, rotations, and board counts. The helper wrote 34 barrier records into `interactions/tranZit.json`. The current browser draws six separate wooden plank meshes per window using the extracted rustic plank texture. Its repair and zombie tear behavior is browser JavaScript, not an imported BO2 script.

**Doors:** The same entity export contains `zombie_door` triggers, `zombie_cost` prices, and linked `script_model` / `script_brushmodel` pieces. The helper grouped nine purchasable sets in `tranZit.json`; browser code shows the F prompt, spends points, rotates the door, and removes its dynamic collision. Prices came from the entities. If a door's placement is wrong, compare its `triggers` and `parts` with the source entities on the PC.

**Gun chalk / wall buys:** First search the original PC's entity dump for likely chalk, wall weapon, purchase, cost, and target fields. Then search its model/material/image dumps for associated art. Do not assume every scripted object appears by its visible name. Once identified, convert its art to browser-readable GLB/PNG, add placements and prices to a small data file, then implement the interaction in JavaScript, drawing the chalk and granting/ammo-filling the chosen weapon. Existing weapon definitions and rigs live in `export/web/weapons.js`, `export/web/viewmodel/`, and `.tools/import_weapon_assets.py`.

**Mystery box:** Similarly inspect entity targets/spawns and the PC model, image, animation, and sound dumps. A visible box model is only one piece. The browser will need code for locations, 950-point purchase, weapon selection, animation/state, pickup, and inventory integration. Those original scripted behaviors are not present in the current port. Asset names and zone dependencies need to be verified against the actual dump before choosing export commands.

On the **original Windows PC**, from `C:\Users\jritc\Documents\Codex\2026-09-27\ca\work\claude-of-duty`, these read-only searches help locate candidates:

```powershell
$ents = '..\dumps\zm_transit\maps\mp\zm_transit.d3dbsp.ents'
Select-String -Path $ents -Pattern 'chalk','wall','weapon','mystery','box','zombie_cost','zbarrier' |
  Select-Object -First 100
Get-ChildItem '..\dumps' -Recurse -File |
  Where-Object Name -Match 'chalk|mystery|box|weapon' |
  Select-Object -First 100 FullName
```

The first search is only a lead: entity key/value blocks must be inspected as whole entities, and some interactive logic may come from BO2 scripts that the current exporter did not dump.

## Current limits and checks

The zombie body/head models and clips are exported BO2 assets, and spawn candidates derive from authored markers. The browser chooses nearby navigable markers and uses its own pursuit, round timing, barricade behavior, and economy rules. It does not reproduce exact BO2 zone activation, bus motion, perks, mystery box, chalk buys, or every script event. Door and outlying-region traversal still deserve manual playtesting.

To test ordinary code changes after `npm ci`, run `npm run test:unit`. For TranZit browser inspection use `AI_GAME_MAP=zm_transit npm run ai:state` and examine the artifacts. The optional `enemy-test` branch expects `.tools/zombie-game.mjs`, which was left on the PC; other harness commands no longer import it at startup. Copy that helper from the original PC before invoking that specific test.

For the game to be shareable as a hosted website, GitHub source hosting alone is not deployment. The current repo has the assets and code; choose hosting and check its per-file and bandwidth limits separately.
