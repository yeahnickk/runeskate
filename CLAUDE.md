# RuneSkate — notes for Claude

Multiplayer skateboarding in the 2004 RuneScape world, in the browser. Plain JS + Three.js client (no build step,
no bundler), one Bun server, no database. Libraries are vendored in `vendor/`; the import map lives in `index.html`.

## Run / check

```bash
bun serve.ts 8123                 # http://localhost:8123/?name=Test  (unknown names sign up on the spot)
bun test/sim.js                   # headless physics/world checks — run after touching skater/world/ragdoll/scoring
bun test/net.js                   # boots the server on a spare port: S.K.A.T.E., parks, spot claims
bun tools/spot-check.ts           # every challenge spot reachable from spawn
bun tools/pocket-check.ts         # spawn + teleport drops aren't trapped pockets (needs the near/far split)
bun test/cod.js                   # CODScape: gun numbers, gunner timelines, headless bot matches (TDM/CTF/FFA)
bun test/stairs.js                # CODScape: every staircase walked up + down, wading, stepping stones
node test/cod-e2e.cjs [base]      # CODScape in a real browser (needs playwright; server on base, default :8199)
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
- `body.js` movement (capsule vs BVH, step-up, slide, wading), `gunner.js` gun timelines, `weapons.js` stats,
  `game.js` match rules (pure, runs headless), `bots.js` AI, `soldier.js` third-person RS bodies + hit zones,
  `guns.js` procedural gun models (mm side profiles), `viewmodel.js` first-person arms/reloads, `hud.js`, `input.js`.
- Online (PLAY ONLINE): `netserver.js` runs one always-on CTF match inside serve.ts (`/cod-ws`; bots fill each side to 4,
  people replace them, up to 8 a side, sim idles when empty). Browsers run their own movement + bullets and report
  hits; the server owns health, kills, flags, grenades, bots (`netclient.js` mirrors it, puppets interpolated ~0.12 s
  behind). `netwire.js` is the shared wire format. ENTER chats.
- The world renders 1:1 linear like the skate game; the gun pass uses sRGB + filmic (`withGunPass`).
- Dev pages: `test/guns.html` (armoury gallery), `test/vmsheet.html?gun=..&what=reload|empty|sights` (reload sheets).

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
