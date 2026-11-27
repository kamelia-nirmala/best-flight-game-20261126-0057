// The four staged screens behind ?shot=. Each one flies a real sortie with an autopilot and freezes
// the frame when the moment is right, so the screenshot is a frame of the game running — the same
// physics, the same HUD numbers, the same terrain the player gets — rather than a mock-up.

import { MISSION, STEP } from './config.js';
import { checkTerrainCollision, stepFlight } from './flightModel.js';
import { CAMERA_CHASE, CAMERA_COCKPIT, CAMERA_WING } from './camera.js';
import { LEG_DROP, LEG_LANDING, LEG_RINGS, nextRingInfo, releaseMail, resetWorld, stepWorld } from './world.js';
import { heightAt, surfaceAt, dropPoint, PADS } from './terrain.js';
import { clamp, deg } from './mathx.js';
import { flyApproach } from './autopilot.js';

const SCREEN_TITLE = 'title';
const SCREEN_FLY = 'fly';
const SCREEN_RESULT = 'result';

function wrapAngle(a) {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * A proportional autopilot: it banks toward the point it is asked to reach, holds a climb or
 * descent rate with the elevator, and works the throttle to hold an airspeed. Deliberately plain,
 * because its job is to produce an honest frame, not to be clever.
 */
function autopilot(flight, target, options) {
  const dx = target[0] - flight.position[0];
  const dy = target[1] - flight.position[1];
  const dz = target[2] - flight.position[2];
  const bearing = Math.atan2(dx, -dz);
  const headingError = wrapAngle(bearing - flight.heading);
  const desiredRoll = clamp(headingError * 1.35, -0.95, 0.95);
  const rollCommand = clamp((desiredRoll - flight.roll) * 2.4, -1, 1);

  const targetVs = clamp(dy * 0.32, -7.5, 7.5);
  const vsError = targetVs - flight.verticalSpeed;
  const desiredPitch = clamp(vsError * 0.05, -0.30, 0.32);
  const pitchCommand = clamp((desiredPitch - flight.pitch) * 3.2, -1, 1);

  const targetSpeed = options.speed;
  const throttle = clamp(0.58 + (targetSpeed - flight.airspeed) * 0.075, 0, 1);

  return {
    pitch: pitchCommand,
    roll: rollCommand,
    yaw: clamp(headingError * -0.4, -0.6, 0.6),
    throttle,
    brake: false,
    steer: 0,
  };
}

/** Run the simulation forward with the autopilot until `until` says stop, or the clock runs out. */
function fly(flight, world, seconds, controller) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const controls = controller(flight, world, i * STEP);
    flight.throttle = controls.throttle;
    flight.braking = !!controls.brake;
    flight.steer = controls.steer ?? 0;
    const prev = [flight.position[0], flight.position[1], flight.position[2]];
    stepFlight(flight, controls, STEP);
    checkTerrainCollision(flight);
    stepWorld(world, flight, prev, STEP);
    if (world.ended) break;
  }
}

function setFlight(flight, position, velocity, heading, pitch, roll, throttle, flaps, gear) {
  flight.position = position;
  flight.velocity = velocity;
  flight.heading = heading;
  flight.pitch = pitch;
  flight.roll = roll;
  flight.throttle = throttle;
  flight.flaps = flaps;
  flight.gearDown = gear;
  flight.onGround = false;
  flight.crashed = false;
  flight.touchdown = null;
  flight.damage = 0;
  flight.fuelKg = 78;
  flight.verticalSpeed = velocity[1];
  flight.airspeed = Math.hypot(velocity[0], velocity[1], velocity[2]);
  flight.agl = position[1] - surfaceAt(position[0], position[2]);
  flight.altitude = position[1];
}

/** Line the aeroplane up on the beach strip's final approach, `distance` metres out, descending
 * toward the threshold on the landing heading. */
function stageFinal(flight, distance, altitude) {
  const pad = PADS.find((p) => p.id === 'beach');
  const heading = pad.runway.heading;
  // The landing direction is (sin h, -cos h); the approach sits back along its negative.
  const dirX = Math.sin(heading);
  const dirZ = -Math.cos(heading);
  const start = [
    pad.center[0] - dirX * distance,
    pad.elevation + altitude,
    pad.center[2] - dirZ * distance,
  ];
  const speed = 33;
  setFlight(
    flight,
    start,
    [dirX * speed, -2.2, dirZ * speed],
    heading,
    -0.04,
    0,
    0.24,
    1,
    true,
  );
  flight.heading = heading;
  flight.velocity = [dirX * speed, -2.2, dirZ * speed];
  flight.airspeed = speed;
}

/** Hold the glide slope down to the strip and keep the speed back, then let it settle. */
function landingController(flight, world, time) {
  // The same tracking law the sortie test uses: hold the centreline and the slope, don't chase a
  // point on the runway.
  const pad = PADS.find((p) => p.id === 'beach');
  void world;
  void time;
  return flyApproach(flight, pad);
}

/**
 * Set the aeroplane and the world to the named scene, and return what the loop needs to draw it:
 * the screen, the camera mode, and the eye/target to freeze on.
 */
export function stageShot(name, flight, world) {
  resetWorld(world, flight);

  if (name === 'cover') {
    // Airborne on the ring run, one gate ahead in frame: the shot is the moment the pilot is
    // lining up the next hoop with the valley open below.
    const gate = world.rings[1];
    const back = 300;
    const axis = gate.axis;
    setFlight(
      flight,
      [gate.center[0] - axis[0] * back, gate.center[1] - 6, gate.center[2] - axis[2] * back],
      [axis[0] * 42, 1.2, axis[2] * 42],
      Math.atan2(axis[0], -axis[2]),
      0.05,
      0,
      0.72,
      0,
      false,
    );
    world.ringIndex = 1;
    world.ringsCleared = 1;
    world.rings[0].passed = true;
    world.score = 120;
    fly(flight, world, 2.2, (f, w) => autopilot(f, w.rings[2].center, { speed: 42 }));
    return {
      screen: SCREEN_FLY,
      camera: CAMERA_CHASE,
      time: 41.2,
      eye: null,
      target: null,
      up: null,
      fov: null,
    };
  }

  if (name === 'cockpit') {
    resetWorld(world, flight);
    world.leg = LEG_LANDING;
    world.mailDropped = true;
    world.mailAccuracy = 0.82;
    world.ringsCleared = MISSION.ringCount;
    world.ringIndex = MISSION.ringCount;
    world.score = 1580;
    // Short final rather than a 1.7 km straight-in: from the pilot's eye the strip has to be in the
    // windscreen, with the island behind it. At 1.75 km out the frame was open sea.
    stageFinal(flight, 900, 96);
    fly(flight, world, 12, landingController);
    return { screen: SCREEN_FLY, camera: CAMERA_COCKPIT, time: 52.6, eye: null, target: null, up: null, fov: null };
  }

  if (name === 'rings') {
    // A banked pass at the fourth gate, seen from the wing: the airframe in frame and the hoop
    // filling the view, with the previous gate behind.
    const gate = world.rings[3];
    const axis = gate.axis;
    const back = 340;
    setFlight(
      flight,
      [gate.center[0] - axis[0] * back, gate.center[1] + 4, gate.center[2] - axis[2] * back],
      [axis[0] * 44, 0.4, axis[2] * 44],
      Math.atan2(axis[0], -axis[2]),
      0.03,
      0,
      0.78,
      0,
      false,
    );
    world.ringIndex = 3;
    world.ringsCleared = 3;
    world.score = 360;
    for (let i = 0; i < 3; i += 1) world.rings[i].passed = true;
    fly(flight, world, 2.4, (f, w) => autopilot(f, w.rings[4].center, { speed: 44 }));
    return { screen: SCREEN_FLY, camera: CAMERA_WING, time: 63.4, eye: null, target: null, up: null, fov: null };
  }

  if (name === 'drop') {
    resetWorld(world, flight);
    world.leg = LEG_DROP;
    world.ringsCleared = MISSION.ringCount;
    world.ringIndex = MISSION.ringCount;
    world.score = 720;
    const drop = dropPoint();
    // On the run-in to the village apron: the drop circle ahead on the ground, the huts and the
    // windsock below, the mail still aboard.
    setFlight(
      flight,
      [drop.x - 40, heightAt(drop.x, drop.z) + 108, drop.z + 620],
      [2, -1.6, -38],
      0.05,
      -0.03,
      0,
      0.62,
      0,
      false,
    );
    fly(flight, world, 8, (f) => autopilot(f, [drop.x, heightAt(drop.x, drop.z) + 62, drop.z], { speed: 38 }));
    releaseMail(world, flight);
    return { screen: SCREEN_FLY, camera: CAMERA_CHASE, time: 78.1, eye: null, target: null, up: null, fov: null };
  }

  // The landing card: fly the approach for real, touch down, stop.
  resetWorld(world, flight);
  world.leg = LEG_LANDING;
  world.mailDropped = true;
  world.mailAccuracy = 0.86;
  world.ringsCleared = MISSION.ringCount;
  world.ringIndex = MISSION.ringCount;
  world.score = 1640;
  stageFinal(flight, 1000, 92);
  // Fly it down, then keep stepping until the wheels are down and it has stopped: the card needs a
  // graded touchdown, not an approach.
  for (let i = 0; i < 120 * 90 && !world.landingGrade; i += 1) {
    const controls = flight.onGround
      ? { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: true, steer: 0 }
      : landingController(flight, world, i * STEP);
    flight.braking = !!controls.brake;
    const prev = [flight.position[0], flight.position[1], flight.position[2]];
    stepFlight(flight, controls, STEP);
    checkTerrainCollision(flight);
    stepWorld(world, flight, prev, STEP);
  }
  if (world.landingGrade) {
    // stepWorld already paid the landing points when the grade was taken; only the sortie's end
    // is left to set here.
    world.ended = true;
    world.outcome = 'landed';
  }
  return { screen: SCREEN_RESULT, camera: CAMERA_CHASE, time: 96.4, eye: null, target: null, up: null, fov: null };
}

void LEG_RINGS;
void nextRingInfo;
void deg;
