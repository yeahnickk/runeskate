# RuneSkate

A skateboarding game set in 2004 RuneScape: Lumbridge, Draynor, Al Kharid and the fields
between them, exported tile-for-tile from the game's own map data.

```bash
bun serve.ts 8123          # then open http://localhost:8123/?name=YourName
```

Anyone who opens the URL with a new name is signed up on the spot. Accounts (hashed passwords,
outfits, XP, runes and challenges) live in `data/accounts.json`, which is never committed.

- `bun test/sim.js` runs the headless physics checks.
- `bun tools/spot-check.ts` checks every challenge spot is reachable from spawn.
- `tools/export-*.ts` + `tools/build.py` regenerate `assets/` from the game cache.
