// Boot and the one loop: input is read every frame, the flight model runs in fixed 1/120 s steps
// (several in a slow frame, none in a fast one), the renderer paints the island, and the HUD canvas
// paints the instruments over it. The game moves between four screens: title, flying, paused and
// the landing card.
//
// ?shot=cover|rings|cockpit|result stages that scene from a real sortie flown by the autopilot in
// shots.js, paints it, and sets window.__shotReady so the screenshot tool knows the frame is final.

import { MAX_FRAME, SAVE_KEY, STEP, VIEW } from './config.js';
import { createFlightState, checkTerrainCollision, stepFlight } from './flightModel.js';
import { createCamera, CAMERA_CHASE } from './camera.js';
import { createInput, ACTION_CAMERA, ACTION_CONFIRM, ACTION_GEAR, ACTION_FLAPS, ACTION_PAUSE, ACTION_RESTART } from './input.js';
import { createRenderer } from './renderer.js';
import { collectSceneItems, createWorld, releaseMail, resetWorld, stepWorld } from './world.js';
import { dropPoint } from './terrain.js';
import { drawHud, drawRunwayPointer } from './hud.js';
import { drawPause, drawResult, drawTitle } from './screens.js';
import { stageShot } from './shots.js';

const SCREEN_TITLE = 'title';
const SCREEN_FLY = 'fly';
const SCREEN_PAUSED = 'paused';
const SCREEN_RESULT = 'result';

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');

const view = document.getElementById('game');
const hudCanvas = document.getElementById('hud');
const status = document.getElementById('status');

const renderer = createRenderer(view);
const hud = hudCanvas.getContext('2d');
const camera = createCamera();
const flight = createFlightState();
const world = createWorld();
const input = createInput(window);

// The two canvases share one 1280x720 logical frame; the drawing buffer follows the window so the
// screenshots are crisp at any size the tool asks for.
function resize() {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(window.innerWidth * ratio);
  const height = Math.round(window.innerHeight * ratio);
  view.width = width;
  view.height = height;
  hudCanvas.width = VIEW.width;
  hudCanvas.height = VIEW.height;
  const scale = Math.min(width / VIEW.width, height / VIEW.height);
  const offsetX = (width - VIEW.width * scale) / 2;
  const offsetY = (height - VIEW.height * scale) / 2;
  view.style.position = 'fixed';
  view.style.left = `${offsetX / ratio}px`;
  view.style.top = `${offsetY / ratio}px`;
  view.style.width = `${(VIEW.width * scale) / ratio}px`;
  view.style.height = `${(VIEW.height * scale) / ratio}px`;
  hudCanvas.style.position = 'fixed';
  hudCanvas.style.left = `${offsetX / ratio}px`;
  hudCanvas.style.top = `${offsetY / ratio}px`;
  hudCanvas.style.width = `${(VIEW.width * scale) / ratio}px`;
  hudCanvas.style.height = `${(VIEW.height * scale) / ratio}px`;
  hudCanvas.style.pointerEvents = 'none';
}

resize();
window.addEventListener('resize', resize);

const sun = { direction: [-0.44, 0.235, 0.866], height: 0.235 };
function normalizeSun() {
  const d = sun.direction;
  const len = Math.hypot(d[0], d[1], d[2]);
  sun.direction = [d[0] / len, d[1] / len, d[2] / len];
  sun.height = sun.direction[1];
}
normalizeSun();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(SAVE_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(SAVE_KEY, String(value));
  } catch {
    // Storage may be off; the best then lasts this visit.
  }
}

world.best = readBest();

/** Project a world point onto the HUD canvas, for the ring director. */
let lastViewProjection = null;
function projectPoint(point) {
  if (!lastViewProjection) return { x: VIEW.width / 2, y: VIEW.height / 2, visible: false };
  return renderer.projectToScreen(lastViewProjection, point, VIEW.width, VIEW.height);
}

/** The frame's numbers, published for the screenshot tool: framing facts, not a judgement. */
function publishDebug(staged) {
  const ring = world.rings[world.ringIndex] ?? world.rings[world.rings.length - 1];
  const ringScreen = ring ? projectPoint(ring.center) : null;
  const aircraftScreen = projectPoint(flight.position);
  const drop = dropPoint();
  window.__shotDebug = {
    shot: shotName,
    screen: staged.screen,
    camera: camera.state.mode,
    flight: {
      position: flight.position.map((v) => +v.toFixed(1)),
      // The same 0..360 bearing the HUD's heading ribbon shows, so the two can be compared.
      heading: +(((((flight.heading * 180) / Math.PI) % 360) + 360) % 360).toFixed(1),
      pitchDeg: +((flight.pitch * 180) / Math.PI).toFixed(1),
      rollDeg: +((flight.roll * 180) / Math.PI).toFixed(1),
      speedKt: +(flight.airspeed * 1.94384).toFixed(1),
      altFt: +(flight.altitude * 3.28084).toFixed(0),
      aglFt: +(flight.agl * 3.28084).toFixed(0),
      vsFpm: +(flight.verticalSpeed * 196.85).toFixed(0),
      throttle: +flight.throttle.toFixed(2),
      fuelPct: +((flight.fuelKg / 96) * 100).toFixed(0),
      onGround: flight.onGround,
    },
    camera: {
      eye: camera.state.eye.map((v) => +v.toFixed(1)),
      target: camera.state.target.map((v) => +v.toFixed(1)),
      fovDeg: +((camera.state.fov * 180) / Math.PI).toFixed(1),
    },
    ring: ring ? { index: ring.index, screen: ringScreen, center: ring.center.map((v) => +v.toFixed(0)) } : null,
    aircraftScreen,
    horizonNote: 'aircraftScreen.y is where the aeroplane projects; camera eye is 15.5 m behind',
    world: { ringsCleared: world.ringsCleared, leg: world.leg, score: world.score, remaining: +world.remaining.toFixed(1) },
    dropDistanceM: +Math.hypot(flight.position[0] - drop.x, flight.position[2] - drop.z).toFixed(0),
  };
  // Also in the page's own status line, so --dump-dom can read the frame's numbers.
  status.textContent = `DEBUG ${JSON.stringify(window.__shotDebug)}`;
}

function paintFrame(time, cameraState) {
  const items = collectSceneItems(world, time, time * 26 + flight.throttle * 12, flight);
  lastViewProjection = renderer.draw({
    width: view.width,
    height: view.height,
    camera: cameraState,
    sun,
    time,
    fogDensity: 0.000118,
    items,
    water: true,
  });
}

function placeOnRunway() {
  // The aeroplane starts at the home strip's south threshold, facing north up the valley: heading 0
  // is -Z, which is where the first ring and the volcano are.
  const pad = { x: 0, z: 520, elevation: 24 };
  flight.position = [pad.x, pad.elevation + 1.55, pad.z + 300];
  flight.velocity = [0, 0, 0];
  flight.heading = 0;
  flight.pitch = 0;
  flight.roll = 0;
  flight.throttle = 0.0;
  flight.fuelKg = 96;
  flight.damage = 0;
  flight.gearDown = true;
  flight.flaps = 0;
  flight.onGround = true;
  flight.crashed = false;
  flight.crashReason = '';
  flight.engineOut = false;
  flight.agl = 1.55;
  flight.altitude = pad.elevation + 1.55;
  flight.touchdown = null;
  input.controls.throttle = 0;
  input.controls.pitch = 0;
  input.controls.roll = 0;
  camera.reset(flight);
  camera.setMode(CAMERA_CHASE);
}

function beginSortie() {
  resetWorld(world, flight);
  placeOnRunway();
  throttleTarget = 0;
  world.sortie = 'taxi';
}

function finishSortie() {
  if (world.score > world.best) {
    world.best = world.score;
    saveBest(world.best);
  }
}

function handleActions(actions, screen) {
  let next = screen;
  if (actions & ACTION_CONFIRM) {
    if (screen === SCREEN_TITLE) {
      beginSortie();
      next = SCREEN_FLY;
      status.textContent = 'Flying. Six rings up the valley, then drop the mail, then land.';
    } else if (screen === SCREEN_RESULT) {
      beginSortie();
      next = SCREEN_FLY;
    }
  }
  if (actions & ACTION_RESTART) {
    beginSortie();
    next = SCREEN_FLY;
  }
  if (actions & ACTION_PAUSE) {
    if (screen === SCREEN_FLY) next = SCREEN_PAUSED;
    else if (screen === SCREEN_PAUSED) next = SCREEN_FLY;
  }
  if (actions & ACTION_CAMERA && (screen === SCREEN_FLY || screen === SCREEN_PAUSED)) {
    camera.toggle();
  }
  if (actions & ACTION_GEAR && screen === SCREEN_FLY) {
    flight.gearDown = !flight.gearDown;
  }
  if (actions & ACTION_FLAPS && screen === SCREEN_FLY) {
    flight.flaps = flight.flaps > 0 ? 0 : 1;
  }
  return next;
}let accumulator = 0;
let lastTime = 0;
let elapsed = 0;
let screen = SCREEN_TITLE;
let previousPosition = [0, 0, 0];
let throttleTarget = 0;

function stepSimulation(dt) {
  const controls = input.read(dt);
  controls.flaps = flight.flaps;
  controls.gearDown = flight.gearDown;
  flight.braking = controls.brake;
  flight.steer = controls.steer;
  previousPosition = [flight.position[0], flight.position[1], flight.position[2]];
  stepFlight(flight, controls, dt);
  checkTerrainCollision(flight);
  const event = stepWorld(world, flight, previousPosition, dt);
  if (event === 'done' || event === 'crash' || event === 'out') {
    finishSortie();
    screen = SCREEN_RESULT;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const wall = Math.min((now - lastTime) / 1000 || 0, MAX_FRAME);
  lastTime = now;
  elapsed += wall;

  const actions = input.takeActions();
  screen = handleActions(actions, screen);

  if (screen === SCREEN_FLY) {
    throttleTarget = input.controls.throttle;
    accumulator += wall;
    let guard = 0;
    while (accumulator >= STEP && guard < 12) {
      stepSimulation(STEP);
      accumulator -= STEP;
      guard += 1;
      if (screen !== SCREEN_FLY) break;
    }
    const speedNorm = Math.min(1, flight.airspeed / 90);
    camera.update(flight, wall, speedNorm);
    const shake = camera.shakeOffset(elapsed);
    const cameraState = {
      eye: [camera.state.eye[0] + shake[0], camera.state.eye[1] + shake[1], camera.state.eye[2] + shake[2]],
      target: camera.state.target,
      up: camera.state.up,
      fov: camera.state.fov,
    };
    paintFrame(elapsed, cameraState);
    drawHud(hud, flight, world, projectPoint);
    drawRunwayPointer(hud, flight, world);
    status.textContent = `Altitude ${Math.round(flight.altitude)} metres, speed ${Math.round(flight.airspeed * 1.944)} knots, heading ${Math.round((((flight.heading * 180) / Math.PI) % 360 + 360) % 360)} degrees.`;
  } else if (screen === SCREEN_PAUSED) {
    const cameraState = { eye: camera.state.eye, target: camera.state.target, up: camera.state.up, fov: camera.state.fov };
    paintFrame(elapsed, cameraState);
    drawHud(hud, flight, world, projectPoint);
    drawPause(hud);
  } else if (screen === SCREEN_RESULT) {
    const cameraState = { eye: camera.state.eye, target: camera.state.target, up: camera.state.up, fov: camera.state.fov };
    paintFrame(elapsed, cameraState);
    drawHud(hud, flight, world, projectPoint);
    drawResult(hud, world, flight);
  } else {
    // The title: the aeroplane idles on the strip behind the card, so the cover scene is real.
    const speedNorm = 0.06;
    camera.update(flight, wall, speedNorm);
    paintFrame(elapsed, { eye: camera.state.eye, target: camera.state.target, up: camera.state.up, fov: camera.state.fov });
    drawTitle(hud, world.best);
  }
}

if (shotName) {
  // A staged frame: the scene is flown by the autopilot (stageShot runs the real model), then the
  // camera is snapped into place and the frame painted a few times before the tool takes it.
  beginSortie();
  const staged = stageShot(shotName, flight, world);
  screen = staged.screen;
  elapsed = staged.time;
  if (staged.camera) camera.setMode(staged.camera);
  camera.reset(flight);
  camera.update(flight, 1 / 60, Math.min(1, flight.airspeed / 90));

  let painted = 0;
  function stagePaint() {
    paintFrame(elapsed, {
      eye: camera.state.eye,
      target: camera.state.target,
      up: camera.state.up,
      fov: camera.state.fov,
    });
    if (staged.screen === SCREEN_TITLE) drawTitle(hud, world.best);
    else {
      drawHud(hud, flight, world, projectPoint);
      drawRunwayPointer(hud, flight, world);
      if (staged.screen === SCREEN_RESULT) drawResult(hud, world, flight);
    }
    painted += 1;
    if (painted < 4) requestAnimationFrame(stagePaint);
    else {
      window.__shotReady = true;
      publishDebug(staged);
    }
  }
  requestAnimationFrame(stagePaint);
} else {
  beginSortie();
  screen = SCREEN_TITLE;
  status.textContent = 'Ashfall Courier. Press Space or click to fly.';
  requestAnimationFrame(frame);
}
