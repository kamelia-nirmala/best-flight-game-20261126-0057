# Ashfall Courier — a bush-pilot mail run over a live volcano

[![make.fun bounty](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/kamelia-nirmala/best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/kamelia-nirmala/best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

An entry in make.fun's **Make the best flight game** bounty:
<https://make.fun/bounty/best-flight-game-20261126-0057>

One sortie in a fictional volcanic archipelago at dawn. Fly six gold gates up the Kawah valley,
drop the mail on the village apron, then put the aeroplane down on the beach strip at Pasir Panjang
before the light goes. Everything is computed, not decorated: the lift curve sets the climb, the
bank sets the turn, the sink rate at touchdown is graded, and every number on the HUD is read from
the aeroplane's own state.

## Play it

No build step and no network. Serve `game/` from any static server and open `game/index.html`:

```sh
node serve.ts          # http://localhost:8080
```

or, without Node's type stripping, `python3 -m http.server -d game 8080`.

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` or `↑` / `↓` | Elevator — the stick sets the angle of attack, not the climb rate |
| `A` / `D` or `←` / `→` | Ailerons — bank, and the bank turns the aeroplane |
| `Q` / `E` | Rudder |
| `Shift` / `Ctrl` | Throttle up / down |
| `Space` | Release the mail, or start the sortie |
| `G` / `F` | Gear / flaps |
| `C` | Chase, cockpit, wing view |
| `P` / `R` | Pause / restart |

## The sortie

1. **Ring run** — six gates up the valley, each lifted clear of the ground and aimed along the leg
   that arrives at it. Clean passes score; a gate missed is called out by how wide.
2. **Mail drop** — a marked circle on the Kawah village apron. Inside the circle, under 420 ft and
   within 22° of bank, the door opens; accuracy sets the score.
3. **Landing** — Pasir Panjang, a 600 m beach strip. The card grades touchdown sink, centreline and
   approach speed, and names the verdict: `TEXTBOOK`, `ACCEPTED`, `HARD LANDING` or `OFF STRIP`.

Fuel burns with throttle, damage costs thrust and adds drag, and a hard arrival bends the airframe.
The clock is 7 minutes.

## What is in here

```
game/index.html          canvas pair, module entry
game/src/config.js       every tuning number and the palette
game/src/main.js         boot, fixed-step loop, screens, ?shot= staging
game/src/flightModel.js  lift curve, drag polar, stall, fuel, damage, ground handling
game/src/terrain.js      noise island, volcano, runways, the ring course
game/src/world.js        rings, mail drop, sortie state machine, landing grade
game/src/renderer.js     hand-written WebGL2: lit solid, sky and water shaders
game/src/aircraft.js     the aeroplane, built from primitives
game/src/camera.js       spring chase, cockpit and wing views
game/src/hud.js          tapes, heading ribbon, sortie card, minimap, director
game/src/screens.js      title, pause and result cards
game/src/autopilot.js    the inverse-lift controller the tests and shots fly
game/src/shots.js        the four staged screens
tools/                   headless screenshot and flight tests
```

The renderer is WebGL2 with no library: one lit shader with wrap diffuse, sky ambient, rim light and
exponential fog; a full-screen sky shader with a sun disc and fbm cloud streaks; and a water shader
with swell, fresnel and sun glitter. The island is seeded value-noise fbm plus ridged noise, with a
volcano cone, a lava crater and flattened runway pads, flat-shaded per triangle.

## Tests

```sh
node tools/flightcheck.mjs   # stall speed, liftoff, climb, trimmed level, 30° turn
node tools/sortiecheck.mjs   # a whole sortie flown by the autopilot, with a score
node tools/shoot.mjs . cover shots-raw 1280 720   # headless render of one staged screen
```

## Licence

MIT — see `LICENSE`.
