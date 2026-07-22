# Crash It

A 2-player, 2-D physics car battle recreated for the web from the mobile game.
Land your car on the other player's head — don't get your own head bonked,
thrown off the map, or swallowed by the rising water. **First to 5 points wins.**

## Quick start

```bash
cd crash-it
npm install     # first time only
npm start       # → Crash It running at http://localhost:3000
```

Open **http://localhost:3000** in a browser (Chrome/Safari/Firefox, desktop or mobile).

## How to play

Each player has only two controls — drive one way or the other:

| Player | Keyboard | Touch |
|--------|----------|-------|
| 🔴 Red  | `A` / `D` | round buttons, bottom-left |
| 🔵 Blue | `←` / `→` | round buttons, bottom-right |

**You score a point when the opponent...**
- gets touched on the head by anything (your car, the map, a plank),
- is thrown out of the map,
- or their head goes under water.

After **60 seconds** the water rises to force a finish. Every point loads a new
random map from the pool of **13** (cloud pockets, seesaws, half-pipes, the
oval, asphalt islands...) recreated from the original game. First to **5
points** takes the match.

## Game modes

- **Local 2 Player** — both players on one device (shared keyboard, or split
  the touch buttons on a phone/tablet in landscape).
- **Create Online Lobby** — get a 4-letter code, send it to a friend.
- **Join Lobby** — enter their code and play in real time. The host's browser
  runs the physics; the guest streams inputs up and world snapshots back.

### Playing online from different locations

The lobby server is this same Node process, so both players' browsers must be
able to reach it:

- **Same Wi-Fi/LAN**: the friend opens `http://<your-local-ip>:3000`.
- **Over the internet**: host the app on any Node host (Render, Railway,
  Fly.io, a VPS...) — `npm start` is all it needs (it respects `PORT`), no
  database. Or tunnel your local server with e.g. `npx localtunnel --port 3000`.

## Tech

- Plain HTML5 canvas + [Matter.js](https://brm.io/matter-js/) physics (bundled, no CDN).
- Node + Express + `ws` server: serves static files and relays lobby messages.
- Host-authoritative networking, 30 Hz snapshots with interpolation on the guest.

## Tests

```bash
npm test                     # headless physics/rules simulation tests
node test/browser-test.js    # local-mode end-to-end (needs Chrome)
node test/online-test.js     # two-browser lobby + realtime test (needs Chrome)
```
# Crash-It-Game
echo — I'm here and working. This looks like a connectivity test, so nothing was run.

For context, I'm in `/Users/jadontapp/Downloads/Crash It Game/crash-it` — a Node project with `server.js`, `public/`, and `test/` not yet committed. What would you like to do?
# Crash-It-Game
# Crash-It-Game
