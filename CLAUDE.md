# RuneSkate — notes for Claude

Multiplayer skateboarding in the 2004 RuneScape world, in the browser. Plain JS + Three.js client (no build step,
no bundler), one Bun server, no database. Libraries are vendored in `vendor/`; the import map lives in `index.html`.

## Run / check

```bash
bun serve.ts 8123                 # http://localhost:8123/?name=Test  (unknown names sign up on the spot)
bun test/sim.js                   # headless physics/world checks — run after touching skater/world/ragdoll/scoring
bun test/net.js                   # boots the server on a spare port: S.K.A.T.E., parks, spot claims
bun test/br.js                    # RuneRoyale: storm, building + collapse, breaking + restoring the world, bot matches
bun tools/spot-check.ts           # every challenge spot reachable from spawn
bun tools/pocket-check.ts         # spawn + teleport drops aren't trapped pockets (needs the near/far split)
bun test/cod.js                   # CODScape: gun numbers, gunner timelines, headless bot matches (TDM/CTF/FFA)
bun test/stairs.js                # CODScape: every staircase walked up + down, wading, stepping stones
bun test/castle-fuzz.js           # CODScape: bodies wander the castles; no popping a storey, no walking through walls
bun test/supply-fuzz.js           # CODScape: bodies scramble round the supply tables; nobody ends up stuck (body.js unstuck)
node test/cod-e2e.cjs [base]      # CODScape in a real browser (needs playwright; server on base, default :8199)
bun test/cart.js                  # CartScape: the road, CPU races per class + difficulty, every item, no lap from cutting/reversing, highscores (boots the server)
bun test/league.js                # Rune League: RL numbers, rules, wire state, bot matches, aerials, online 3v3 (boots the server)
bun tools/cart-track.ts            # CartScape: re-bake assets/cart_lumbridge.* after changing the route in src/cart/track.js
bun test/mine.js                  # MineScape: the map as blocks, MC movement/digging/crafting/furnace/hunger, mobs, trades, saving
python3 tools/mine-bake.py        # MineScape: re-bake assets/mine_world.* from tools/out (heights, surfaces, walls, roofs, colours)
```

The owner doesn't want CI or npm-script plumbing; just run the scripts above directly.

## Map of the code

- `src/skater.js` — all skate physics (`P` tuning table at the top), tricks, combos/scoring, grinds, landings.
- `src/main.js` — client: loading, renderer, input (keys/mouse/gamepad/touch), camera rig, game loop, NPCs, HUD wiring.
- `src/world.js` — collision world (tile flags, rails, trunks), region streaming. `src/mapdata.js` — `WORLD_SCALE`,
  spawns, portals. `src/nearfirst.js` — near/far world split shared by client and server.
- Body: `rig.js` (2-bone IK rider on the deck), `ragdoll.js` (verlet bails), `ragskin.js` (skin the RS mesh to it),
  `rsanim.js` (RS kit/outfits/animations), `model.js` (RS model loader, the board).
- Features: `replay.js`, `park.js` + `park-shape.js` (Create-a-Park, shape rules shared with server), `goals.js`
  (runes, challenges), `spots.js`, `teleport.js`, `touch.js`, `hud.js`, `audio.js`, `lighting.js`, `designer.js` (outfits).
- `serve.ts` — static files (+ `.br`/`.gz`), accounts in `data/*.json`, WebSocket relay, S.K.A.T.E., XP rate limits.
- `tools/` — world rebuild pipeline from the 2004 cache (see README). `assets/` is already built (~800 MB); only
  rebuild when changing the map itself.

## CODScape (cod.html, src/cod/)

A first-person COD-style shooter vs bots in the Castle Wars arena; the home page opens on a game picker.
- `arena.js` loads `assets/cw_arena.*` (cut by `tools/cw-arena.py`, then `bun tools/cw-decals.ts` lifts RS's coplanar
  face stacks so they don't shimmer up close), builds the BVH collider, perimeter wall, nav graph.
- `body.js` movement (capsule vs BVH, step-up, slide, wading), `gunner.js` gun timelines, `wrathfx.js` the God's Wrath set piece (comet, mushroom cloud, debris, cinematic camera), `weapons.js` stats,
  `game.js` match rules (pure, runs headless), `bots.js` AI, `soldier.js` third-person RS bodies + hit zones,
  `guns.js` procedural gun models (mm side profiles), `viewmodel.js` first-person arms/reloads, `hud.js`, `input.js`.
- Online (PLAY ONLINE): `netserver.js` runs one always-on CTF match inside serve.ts (`/cod-ws`; bots fill each side to 4,
  people replace them, up to 8 a side, sim idles when empty). Browsers run their own movement + bullets and report
  hits; the server owns health, kills, flags, grenades, bots (`netclient.js` mirrors it, puppets interpolated ~0.12 s
  behind). `netwire.js` is the shared wire format. ENTER chats.
- The world renders 1:1 linear like the skate game; the gun pass uses sRGB + filmic (`withGunPass`).
- Dev pages: `test/guns.html` (armoury gallery), `test/vmsheet.html?gun=..&what=reload|empty|sights` (reload sheets).

## CartScape (cart.html, src/cart/)

Mario Kart round Lumbridge vs 7 CPU karts. Single player for now (the race is pure, so an online version can follow
the CODScape pattern).
- `track.js` the route (`TRACKS.lumbridge.pts`, world tiles; centripetal Catmull-Rom, keep corner radii >= ~10 for the
  13-wide road) + features (`at` = waypoint index + fraction). `bakeTrack` makes the road profile (smoothed, bridges over
  water, ramps, the river gap). `Track` = track space: s along, d sideways (+ left), `locate`/`pos`/`h`/`curve`.
- `tools/cart-track.ts` bakes `assets/cart_lumbridge.track.json` and cuts the pack round it (`.json/.bin`): scenery
  off the road and verge, the ground levelled flat out past the fence, then cut/fill banks. Re-run after route edits.
- `race.js` the sim (pure, 1/120 substeps): drift hops + mini-turbo tiers, rocket start, items (`ITEMS`: OSRS spells and
  attacks from the treasure chests, rolled by place; Protect from Missiles blocks `MISSILES`, Smoke Barrage blinds
  everyone ahead), mobs (cows, chickens, blades, boulders: a pure function of race time), CPU AI, `DIFF` (easy/normal/
  hard: skill, rubber band, item timing). Laps only count via the `cp` checkpoint creeping round, so no cutting.
- `scores.js` the highscores rules (pure): one best a name per class, three lap splits that add up and beat no
  `LAP_FLOOR`. serve.ts keeps them in `data/cart.json` behind `/api/cart` (GET boards, POST a finish, 1 per 4 s an IP).
- `models.js` karts from scratch (`BODIES` x `THEMES` god trims) + the RS driver sat in via the ragdoll skin, hands
  IK'd onto the rim (`gripAt`, `placeWheel` moves the wheel to their reach) and turning it with the steering.
  `scenery.js` the road mesh, fence/bales, gantry, arches, pads, chests, obstacles. `hud.js`, `input.js`, `main.js`.
- Dev page: `test/karts.html` (every kart, `?body=mine`, `?one=3`, `?spin=1`, `?close=1&steer=0.7` grip markers). `window.CART` exposes the race.

## Rune League (league.html, src/league/)

Rocket League in the Lumbridge cabbage patch. The sim is RL's own numbers in RL units (uu), three.js axes (x across, y up,
z down the pitch, blue defends -z; a car's forward +x, up +y, right +z), 120 Hz.
- `arena.js` RL's soccar arena as a distance field (`D` > 0 inside, `N` its normal), pads, kickoff + respawn spots.
- `match.js` the match (pure): `Car`/`Ball` physics, rules, events; `save()`/`load()` the whole state for the wire,
  `packIn`/`unpackIn` inputs. The Psyonix hit scales by the closing speed *before* contact (as RL/RocketSim). `bots.js` the bots (`DIFFS` rookie/pro/allstar: rotation, power flips, aerials).
- `site.js` + `tools/league-arena.ts` cut `assets/league_patch.*` (the world round the patch, ground flattened under the
  stadium). The arena group sits at the site scaled by `K` (1/400 world units a uu), the pitch run east.
- Looks: `scenery.js` builds the stadium like RS draws (flat colours, light baked in, no textures) and dresses it with
  real RS models from `assets/league_models.json` (`tools/league-models.ts`, loaded by `rsmodels.js`: `meshOf`,
  `merged`, team `tint`). `gfx.js` the finish: HDR MSAA target, bloom, FXAA, filmic grade, sun shafts from the depth
  buffer's open sky + lens flare, ambient occlusion from depth (normals rebuilt, so flat ground never darkens itself), a
  speed smear at supersonic (`Post`), the sky dome
  (`buildSky`), resolution that follows the frame rate (`Scaler`); main.js adds the sun's shadow map (a `ShadowMaterial`
  floor from `floorShape`) and scenery's `pitchMat` sheens the mown stripes. Kart paint is lacquered (cars.js `paint`: standard material lit by a
  PMREM of the sky, `setEnv`); the RS drivers stay matte. Glows are colours over 1 (team trims, goal
  frames), so the HDR bloom catches them. The menu's GRAPHICS HIGH / LOW (`applyGfx`: shadows, MSAA, shafts, AO, scenery's `Grass` blades
  round the camera; LOW is the
  default everywhere). A HIGH frame is ~345 draw calls, ~470k triangles; the sim + bots ~0.4 ms. No canvas textures standing in for RS things.
- `cars.js` CartScape's karts painted per team; `hud.js` RS fonts at native size on brown panels; `input.js` RL's
  PC defaults (right mouse jump, left mouse boost, SHIFT powerslide, SPACE ball cam; J/K without a mouse), pad, touch; `main.js` the client (a short menu: mode, bots, graphics; you're blue in Saradomin's kart, goal FX rolled; RL's
  camera: car cam rolls with you on walls, ball cam on the ball-car line; replays, sfx).
- Online: `netserver.js` one always-on 3v3 inside serve.ts (`/league-ws`; bots fill seats, people take them, idle when
  empty), 120 Hz, state out 30 a second. `netclient.js` loads each snapshot and replays our unacked inputs (2 ticks
  each), easing corrections out visually (`drawn`). Rule events (goals, demos...) only ever come from the server.
- Dev page: `test/league-models.html` (every RS model it uses, `?tint=0x..`, `?ball=1`). `window.LEAGUE` exposes the
  match (`LEAGUE.auto = true` lets a bot drive your car).

## MineScape (minescape.html, src/mine/)

Minecraft survival on the RS map, one block a tile, single player (worlds in localStorage). RuneScape to look at,
Minecraft to play: the real 2004 map draws over the blocks, Minecraft's first person, HUD and screens on top.
- `rsworld.js` draws the skate game's map packs (`assets/world*.json/.bin`, streamed by region) 1:1 over the blocks
  (pack y = `world.base + 1` - RS height). A tile you dig into or build in turns to blocks (`vx` 1: its triangles are
  dropped from that chunk's index); a felled tree takes only its canopy (`vx` 2). The mesher (`opts.rs`) skips natural
  blocks the RS ground already draws. `height()` the RS ground, so bodies stand on bridges and slopes as drawn.
  `world.keep` (set by render.js) stops MC's grass/dirt ticks on the map's own ground, which would otherwise turn every
  tile under a tree or wall to blocks. Wall triangles on a tile edge go with the tile the bake put the wall block on.
- Fights go by RS hitpoints for the weak (goblin 5, man 7: three or four punches), hunger drains at half MC's rate.
- `bodies.js` the RS bodies: mobs are RS NPC models with their clips; the player (F5) is an RS character wearing the
  armour as an RS set and holding a pickaxe of the tool's tier / scimitar / shortbow. Pointer lock is on the GUI
  canvas (the one with the mouse listeners).
- `tools/mine-bake.py` -> `assets/mine_world.bin` (planes: ground y, surface id, roof height, roof colour, flags, wall
  colour, ground R/G/B) + `.json` (spawn, trees, villagers, palettes). Block coords: X = tile x, Z = -(tile z) - 1.
- `world.js` chunks (16x16x128) generated from the bake: layers, caves, ores, walls in their RS material (`WALLC`),
  stepped roofs, trees; `tintAt` the grass/leaf tint from the RS ground colour. Edits are recorded for saving.
- `blocks.js` blocks/items/recipes/smelting with MC's numbers (block ids 0-23 are baked: never renumber; `tint` blocks
  take the ground colour over their green). `mesh.js` meshing + light (per-vertex tint `tc`), `phys.js` MC movement,
  `game.js` the rules (pure, 20 TPS: player, digging, use, mobs, items, furnace, farming, advancements, commands),
  `mobs.js` mob AI + RS villagers (`FOLK`), `inv.js` slots and clicks for every screen.
- Client: `tex.js` the painted atlas + item sprites + icons, `font.js` MC's font, `gui.js` every screen + HUD (canvas,
  `COL` = the OSRS palette), `render.js` the 3D view, `models.js` mob/held models, `audio.js` synth sfx, `main.js`.
  `window.MINE` exposes the game.

## RuneRoyale (battle royale inside the skate game)

- `br-core.js` is the match (pure, shared by serve.ts and the offline browser match): storm, dragon drop, loot, builds,
  breaking the world, bots, teams (solo / duos / squads with knocks, revives, reboot vans), gadgets, carts, fishing.
- `br.js` is the client (input, HUD, meshes, phone buttons); `br-locker.js` the cosmetics (GP, pass, shop, localStorage).
- The arena is the core pack plus `ARENA_PACKS` (Varrock, Falador, Port Sarim, the south): serve.ts adds them to its
  match world, the client loads them while queued. 48 a match (`BR.SIZE`, divides into duos and squads). Each match
  thins the woods (`thinTrees`: lone trees 9 apart stay, the rest are broken like any tree; the world grows back after).
- No skating in a match: bodies are drawn by `drawRoyale` in main.js (raw RS clips, legs from walk/run, arms from
  an action `sk.ac`; `sk.gl` 1 skydive / 2 glider, `sk.cr` 1 crouch / 2 knocked). The held weapon is a real RS
  item worn in slot 3 (`W_ITEM`, exported by tools/export-kit.ts); outfits with the same items share baked frames.
- Dev page: `test/poses.html?anims=bow,cast&w=1275` (every RS clip an outfit carries, frame by frame).
- Match messages go out as `{ ...msg, t: 'br' }`, so they never use the field `t` themselves.
- `bun test/br.js` covers it; real-browser runs are slow in headless (game time runs ~10x slow there).

## Conventions

- Coordinates: game x = east, y = up, z = north. Three.js uses z = -north: `T(x, y, z) => Vector3(x, y, -z)`.
  Distances are in tiles. The world is stretched by `WORLD_SCALE` (1.5) horizontally; heights are not scaled.
- Style: dense, terse code; short names (`P`, `S`, `T`, `sk`); comments say *why*, often as trailing `//` notes.
  Match it — don't reformat or split files gratuitously.
- Keep the OSRS look and feel: low-poly RS models and colours, RS fonts/hitsplats, brown/yellow UI panels.
- Rune ids must never change (accounts store them). `data/` is never committed.
- Mobile matters: `TOUCH` in `main.js` switches on touch controls and lighter graphics; test changes at phone size.
- Shared client/server modules (`mapdata`, `spots`, `park-shape`, `nearfirst`, `npc-spawns`) must stay plain JS
  with no DOM/Three imports.
