# RuneSkate

**A multiplayer skateboarding game set in 2004 RuneScape.** Push, ollie, kickflip and grind your way across
the whole free-to-play world: Lumbridge, Draynor, Varrock, Falador, Port Sarim, Al Kharid and the Wilderness,
rebuilt tile-for-tile from the game's own map data and running in the browser.

![Grinding the fence by the River Lum](docs/grind.png)

![Ollie through the goblin field north of Lumbridge](docs/ollie.png)

## What's in it

- **Skate physics built for flow.** Pushing, carving, powerslides, manuals, grabs, 360s and a flip-trick
  set (kickflip, heelflip, shove-it, varial, 360 flip, hardflip...). Combos chain across grinds and manuals.
- **Grind anything that looks grindable.** Bridge parapets, fences, low walls and hedges, measured from the
  real geometry. Grinds carry round corners and across small gaps.
- **The real map.** Every wall, gate, tree and river comes from the server's own collision data. Trees
  collide at the trunk, not the tile, and flowers, stumps and fungus are ridden straight over.
- **Multiplayer.** Everyone on one server, with chat, emotes, outfits and a leaderboard.
- **Things to do.** 100 hidden runes and a set of challenge spots across the map, goblins to stomp, and
  portals to every town. Collect all 100 runes to unlock `::noclip`.
- **Live map** at `/map`: the whole world with runes, portals, challenges and everyone online.

![The world map](assets/map.png)

## Controls

| Key | Action |
|---|---|
| W / S | push / brake (W always pushes toward the camera) |
| A / D | steer |
| SPACE | hold + release to ollie |
| J K L I | kickflip, heelflip, shove-it, varial |
| U N M Y B | 360 flip, hardflip, 360 shove-it, double kickflip, double heelflip |
| Mouse | pull down, flick up: ollie (up-left kickflip, up-right heelflip) |
| SHIFT | powerslide |
| Q | manual when rolling (balance with W/S), grab in the air (A/D picks the grab) |
| C / R / E / O | camera / back to spawn / step off the board / outfit |
| 1-5, ENTER, TAB | emotes, chat, leaderboard |

A gamepad works too. Press **H** in game for the full list.

## Running it

You need [Bun](https://bun.sh).

```bash
bun serve.ts 8123          # then open http://localhost:8123/?name=YourName
```

Anyone who opens the URL with a new name is signed up on the spot (`?name=You&password=secret` works as a
join link). Accounts (hashed passwords, outfits, XP, runes, challenges) live in `data/accounts.json`,
which is never committed.

Optional environment variables:

| Variable | Meaning |
|---|---|
| `RUNESKATE_OWNER` | login of the server owner's account: crown, `[OWNER]` tag, gilded kit, `::noclip` |
| `RUNESKATE_OWNER_NAME` | display name for the owner account (you still log in as `RUNESKATE_OWNER`) |
| `RUNESKATE_RESERVED` | extra comma-separated names nobody may register |

`bun tools/compress.ts` pre-compresses the assets (`.br`/`.gz`) for much faster loading over the internet.

## Development

- `bun test/sim.js` runs the headless physics checks (collisions, grinds, rune placement, regions).
- `bun tools/spot-check.ts` checks every challenge spot is reachable from spawn.
- `src/skater.js` is the physics, `src/world.js` the collision world, `src/main.js` the client,
  `serve.ts` the server (static files, accounts, multiplayer relay).

### Rebuilding the world

`assets/` is already built, so you only need this to change the map itself (collision, trees, lanes, runes).
Everything it needs is in this repo: the 2004 game cache (`tools/cache/`), the server's collision, map-object
and spawn data (`tools/data/`), and the parts of the [LostCity](https://github.com/LostCityRS) web client
that read them (`third_party/webclient/`, MIT). You need Bun and Python 3 with `numpy` (plus `Pillow` for
the map image).

```bash
bun install                                                        # fflate, for the exporters
bun --preload ./tools/preload.ts tools/export-world.ts 2880 3072 896   # terrain + objects -> tools/out
bun --preload ./tools/preload.ts tools/small-locs.ts                   # tiny objects + tree tiles
python tools/build.py        # meshes, collision, rails, tree trunks -> assets/world.*
python tools/lanes.py        # forest skate lanes, water vs rock
python tools/fixrunes.py     # check every rune still sits on open ground (--write to move them)
python tools/split.py        # cut into the core + streamed region packs
python tools/mapimg.py       # the world map image
bun tools/compress.ts        # optional: .br/.gz for fast loading
```

`tools/export-kit.ts` (outfits) and `tools/export-npcs.ts` (NPC models) run the same way. The game client
adds a little random shading jitter, so re-exported meshes differ from the committed ones by a shade or two;
collision and gameplay data come out identical.

Rune ids must never change: accounts store the ids of the runes they have found.

## License

The code is MIT licensed (see [LICENSE](LICENSE)). That covers the code only. The game cache and the world
geometry, models, textures and map data derived from it (`assets/`, `tools/cache/`, `tools/data/`) come from
the 2004 RuneScape game, which belongs to Jagex Ltd. They are not covered by the MIT license.
`third_party/webclient/` is from the LostCity web client, under its own MIT license.

## Disclaimer

This is a free, open-source, community-run fan project.

The goal is strictly education and research. RuneSkate's world is built from the data of
[LostCity](https://github.com/LostCityRS), a server written from scratch after many hours of research and
peer review. Everything you see is completely and transparently open source.

We have not been endorsed by, authorized by, or officially communicated with Jagex Ltd. on our efforts here.
RuneScape and Old School RuneScape are trademarks of Jagex Ltd.

You cannot play Old School RuneScape here, buy RuneScape gold, or access any of the official game's
services! Nothing here connects to or works with the official game servers.
