# Speed Clone Escape

A Bloxity game built with Three.js and Colyseus. It is a clone of the Roblox game
"+1 Clone Speed Escape" (reference video: `reference/Gameplay.mp4`).

## How it plays

- Every step you take earns Steps: `(1 + clones alive) x multipliers` every 0.4 s while you run.
- Steps are also XP. Every level gives you one more clone, up to your clone limit (3 at the start).
- Clones run behind you along the path you walked.
- Each stage is a corridor guarded by shadow monsters. A monster that reaches you or a clone eats a clone.
  With no clones left it eats you (Revive for Bux, or back to the lobby).
- At the end of each stage, touch the yellow pad for Wins (the blue pad gives double with the x2 Wins pass),
  or walk through the blue "Stage N" screen to keep going.
- In the lobby, spend Wins on:
  - the clone limit stairs (+6, +12, +22 ... clone limit);
  - the stage portals (shortcuts to stages 2-6).
- AUTO RUN treadmills earn Steps while you stand on them. Gold (x2), Diamond (x5) and Celestial (x10) are passes.
- Rebirth at Level 25: +50% Steps per rebirth, level and clones start over.

## Run it

```bash
npm install        # also installs client/ and server/
npm run build      # builds the client into client/dist
npm start          # server + built client on http://localhost:2567 (PORT to change)
```

For development, run the server and the Vite client side by side:

```bash
npm run dev:server
VITE_SERVER_URL=http://localhost:2567 npm run dev:client
```

## Layout

- `shared/config.js`: game data used by both sides (stages, clone limits, treadmills, passes, quests).
- `server/src/CloneRoom.js`: the room. It owns Steps, levels, clones, Wins, unlocks and purchases.
- `client/src/main.js`: player, clone crowd, monsters, networking.
- `client/src/world.js`: lobby and stage corridors.
- `client/src/ui.js` and `client/index.html`: the HUD.

## Bloxity

Bloxity integration works the same way as in Speed Football Scape:

- Login, avatars (clones wear your Bloxity avatar), friends, settings, Bux purchases and stats.
- Game slug: `speed-clone-escape` (`client/src/bloxity.js`). Confirm it with Bloxity.
- Create the Bux SKUs from `SKUS` in `shared/config.js` in the game's IAP catalog.
- Set `LEGION_WEBHOOK_SECRET` on the host to turn on Bux mode.

UI rules: the top-left corner stays empty for the Bloxity overlay, prices are in Bux only, and there is no start menu.
