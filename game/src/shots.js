// The four staged screens behind ?shot=. Each one is a frame of one real sortie: the same
// deterministic replay is flown from the strip every time, and each shot stops it at its own
// moment. Nothing here writes a number into the HUD by hand — the clock, the score and the ring
// count are whatever the simulation had reached when the frame was frozen, so the four shots are
// consistent with each other and with the game a player gets.

import { STEP } from './config.js';
import { checkTerrainCollision, stepFlight } from './flightModel.js';
import { CAMERA_CHASE, CAMERA_COCKPIT } from './camera.js';
import { LEG_DROP, LEG_LANDING, LEG_RINGS, releaseMail, resetWorld, stepWorld } from './world.js';
import { heightAt, dropPoint, PADS } from './terrain.js';
import { circuitWaypoint, flyApproach, flyTakeoff, flyTo } from './autopilot.js';

const SCREEN_FLY = 'fly';
const SCREEN_RESULT = 'result';

const BEACH = PADS.find((p) => p.id === 'beach');

/** How far off the nose a world point sits, in radians, the same convention as nextRingInfo. */
function noseOffset(flight, point) {
  const bearing = Math.atan2(point[0] - flight.position[0], -(point[2] - flight.position[2]));
  let d = bearing - flight.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Horizontal range to a world point. */
function rangeTo(flight, point) {
  return Math.hypot(point[0] - flight.position[0], point[2] - flight.position[2]);
}

/**
 * A gate is only in the frame when the aeroplane is actually tracking it. The replay used to stop
 * as soon as it was a set distance away, which happened mid-turn: the ring was then well off the
 * nose and projected outside the frame, so the gold in the picture was the HUD's own amber value
 * box rather than a ring. Every shot now also requires its subject to be near the nose.
 */
function framedOn(flight, point, maxOffsetDeg) {
  return Math.abs(noseOffset(flight, point)) < (maxOffsetDeg * Math.PI) / 180;
}

/** Put the aeroplane on the home strip's south threshold, the way the game starts. */
function placeOnRunway(flight) {
  flight.position = [0, 24 + 1.55, 780];
  flight.velocity = [0, 0, 0];
  flight.heading = 0;
  flight.pitch = 0;
  flight.roll = 0;
  flight.alpha = 0.02;
  flight.throttle = 1;
  flight.fuelKg = 96;
  flight.damage = 0;
  flight.gearDown = true;
  flight.flaps = 0;
  flight.onGround = true;
  flight.crashed = false;
  flight.crashReason = '';
  flight.engineOut = false;
  flight.touchdown = null;
  flight.agl = 1.55;
  flight.altitude = 24 + 1.55;
}

/**
 * The sortie pilot: takeoff, the ring run, the mail, the circuit join and the landing. This is the
 * same sequence tools/sortiecheck.mjs flies, so a staged frame is a frame of the sortie the test
 * proves is completable.
 */
function createSortiePilot() {
  const state = { phase: 'takeoff', joinLeg: 'downwind', takeoffRolled: false };

  function controls(flight, world) {
    if (state.phase === 'takeoff') {
      const c = flyTakeoff(flight);
      if (!flight.onGround) state.takeoffRolled = true;
      if (state.takeoffRolled && flight.agl > 55) state.phase = 'rings';
      return c;
    }
    if (state.phase === 'rings') {
      const ring = world.rings[world.ringIndex] ?? world.rings[world.rings.length - 1];
      if (world.leg === LEG_DROP) state.phase = 'drop';
      return flyTo(flight, ring.center, 40, { arriveLevel: true, axis: ring.axis, lead: 240, dt: STEP });
    }
    if (state.phase === 'drop') {
      const drop = dropPoint();
      const ground = heightAt(drop.x, drop.z);
      // Descend towards the circle, not level over it. Pointing at a target at cruise height makes
      // the aeroplane hold a 54-degree bank and orbit the village; arriving at 60 m above the
      // ground instead gives a descending pass that satisfies the game's own release gate (inside
      // 205 m, under 126 m, wings level) with the circle well inside the chase camera's frame.
      return flyTo(flight, [drop.x, ground + 60, drop.z], 34, { arriveLevel: true, dt: STEP });
    }
    if (state.phase === 'join') {
      const waypoint = circuitWaypoint(BEACH, state.joinLeg);
      const distance = Math.hypot(waypoint[0] - flight.position[0], waypoint[2] - flight.position[2]);
      const c = flyTo(flight, waypoint, 38, { arriveLevel: true, dt: STEP });
      if (distance < 380) {
        if (state.joinLeg === 'downwind') state.joinLeg = 'base';
        else if (state.joinLeg === 'base') state.joinLeg = 'final';
        else state.phase = 'landing';
      }
      return c;
    }
    // On the wheels the job is to stop; in the air, fly the centreline down.
    return flight.onGround
      ? { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: true, steer: 0 }
      : flyApproach(flight, BEACH);
  }

  return { controls, state };
}

/** How far down the beach strip's centreline the aeroplane is, and how high above the strip. */
function finalGeometry(flight) {
  const heading = BEACH.runway.heading;
  const dx = flight.position[0] - BEACH.center[0];
  const dz = flight.position[2] - BEACH.center[2];
  const along = dx * Math.sin(heading) + dz * -Math.cos(heading);
  return { along, height: flight.position[1] - BEACH.elevation };
}

/**
 * Fly the sortie from the threshold, offering every step to `onStep`. `onStep` returns a score for
 * the frame it is looking at, or null if that frame is not a candidate; the best-scoring frame wins.
 *
 * Choosing by score rather than by stopping at the first match matters: a distance threshold is
 * satisfied while the aeroplane is still rolling out of a turn, and the ring is then far off the
 * nose and outside the frame. Scoring every step lets the shot pick the moment the subject is
 * genuinely ahead, which is the frame the brief is asking for. Deterministic: same physics, same
 * steps, same winner every run.
 */
function flySortie(flight, world, onStep) {
  resetWorld(world, flight);
  placeOnRunway(flight);
  const pilot = createSortiePilot();
  let t = 0;
  let best = { score: -Infinity, snapshot: null, time: 0 };
  for (let i = 0; i < 120 * 400; i += 1) {
    const controls = pilot.controls(flight, world);
    flight.throttle = controls.throttle;
    flight.braking = !!controls.brake;
    flight.steer = controls.steer ?? 0;
    const prev = [flight.position[0], flight.position[1], flight.position[2]];
    stepFlight(flight, controls, STEP);
    checkTerrainCollision(flight);
    const event = stepWorld(world, flight, prev, STEP);
    t += STEP;

    // Release the mail at the moment the game's own gate allows it, then fly the join.
    if (pilot.state.phase === 'drop' && !world.mailDropped) {
      const drop = dropPoint();
      const dist = Math.hypot(flight.position[0] - drop.x, flight.position[2] - drop.z);
      if (dist < 205 && flight.agl < 126 && Math.abs(flight.roll) < 0.38) {
        const result = releaseMail(world, flight);
        if (result.ok) {
          pilot.state.phase = 'join';
          pilot.state.joinLeg = 'downwind';
        }
      }
    }

    const score = onStep(flight, world, t, event);
    if (score != null && score > best.score) {
      best = { score, time: t, snapshot: snapshot(flight, world) };
    }
    if (best.snapshot && world.ended) break;
    if (world.ended) break;
  }
  if (best.snapshot) restore(flight, world, best.snapshot);
  return best.snapshot ? best.time : t;
}

/** Everything a staged frame needs to be put back exactly, so the best frame can be revisited. */
function snapshot(flight, world) {
  return {
    flight: JSON.parse(JSON.stringify(flight)),
    world: {
      ringIndex: world.ringIndex,
      ringsCleared: world.ringsCleared,
      ringsMissed: world.ringsMissed,
      leg: world.leg,
      clock: world.clock,
      remaining: world.remaining,
      mailDropped: world.mailDropped,
      mailAccuracy: world.mailAccuracy,
      score: world.score,
      landingGrade: world.landingGrade,
      ended: world.ended,
      outcome: world.outcome,
      passed: world.rings.map((r) => r.passed),
    },
  };
}

function restore(flight, world, snap) {
  Object.assign(flight, snap.flight);
  const w = snap.world;
  world.ringIndex = w.ringIndex;
  world.ringsCleared = w.ringsCleared;
  world.ringsMissed = w.ringsMissed;
  world.leg = w.leg;
  world.clock = w.clock;
  world.remaining = w.remaining;
  world.mailDropped = w.mailDropped;
  world.mailAccuracy = w.mailAccuracy;
  world.score = w.score;
  world.landingGrade = w.landingGrade;
  world.ended = w.ended;
  world.outcome = w.outcome;
  w.passed.forEach((passed, i) => {
    world.rings[i].passed = passed;
  });
}

/**
 * Set the aeroplane and the world to the named scene by replaying the sortie, and return what the
 * loop needs to draw it: the screen, the camera mode and the sortie clock for the frame.
 */
export function stageShot(name, flight, world) {
  if (name === 'result') return stageLandingCard(flight, world);
  if (name === 'cockpit') {
    // Pilot's eye on the approach to a gate: the hoop ahead through the windscreen, the valley
    // beyond it. Scored on how close to the centre line the gate sits and how level the wings are,
    // because a 54-degree bank fills half the frame with empty sky.
    const t = flySortie(flight, world, (f, w) => {
      if (w.leg !== LEG_RINGS || w.ringsCleared < 3) return null;
      const ring = w.rings[w.ringIndex];
      if (!ring) return null;
      const d = rangeTo(f, ring.center);
      if (d > 320 || d < 170) return null;
      const off = Math.abs(noseOffset(f, ring.center));
      if (off > (16 * Math.PI) / 180) return null;
      const level = Math.abs(f.roll);
      return 100 - off * 100 - level * 60 - Math.abs(f.agl - 150) * 0.05;
    });
    return { screen: SCREEN_FLY, camera: CAMERA_COCKPIT, time: t };
  }

  if (name === 'mail') {
    // On the run-in to the village apron: the drop circle on the ground, the mail still aboard.
    // The circle lies on the ground, so what matters is the depression angle from the eye to it,
    // not the distance: from 190 m up and nearly level it sits below the bottom edge of the frame
    // and the shot shows only sea and haze. A depression of roughly 15-35 degrees puts the gold
    // ring comfortably in the lower half of the picture with the island behind it.
    const t = flySortie(flight, world, (f, w) => {
      if (w.leg !== LEG_DROP || w.mailDropped) return null;
      const drop = dropPoint();
      const ground = heightAt(drop.x, drop.z);
      const d = rangeTo(f, [drop.x, 0, drop.z]);
      if (d > 330 || d < 150) return null;
      const depression = Math.atan2(f.position[1] - ground, d) * (180 / Math.PI);
      if (depression < 12 || depression > 40) return null;
      const off = Math.abs(noseOffset(f, [drop.x, 0, drop.z]));
      if (off > (20 * Math.PI) / 180) return null;
      return 100 - off * 70 - Math.abs(f.roll) * 60 - Math.abs(depression - 24) * 1.2;
    });
    return { screen: SCREEN_FLY, camera: CAMERA_CHASE, time: t };
  }

  if (name === 'landing') {
    // Short final: the beach strip ahead, gear and flap down, the numbers in the windscreen. Close
    // and low enough that the strip is a wide band of asphalt rather than a distant grey thread.
    const t = flySortie(flight, world, (f, w) => {
      if (w.leg !== LEG_LANDING || w.mailDropped !== true) return null;
      const g = finalGeometry(f);
      if (g.along < -430 || g.along > -190) return null;
      if (g.height > 58 || g.height < 18) return null;
      if (Math.abs(noseOffset(f, [BEACH.center[0], 0, BEACH.center[2]])) > (15 * Math.PI) / 180) return null;
      return 100 - Math.abs(g.along + 300) * 0.1 - Math.abs(f.roll) * 40 - Math.abs(g.height - 35) * 0.5;
    });
    return { screen: SCREEN_FLY, camera: CAMERA_CHASE, time: t };
  }

  // The cover: a gate ahead with the volcano behind it, the island filling the lower frame.
  const t = flySortie(flight, world, (f, w) => {
    if (w.leg !== LEG_RINGS || w.ringsCleared < 1) return null;
    const ring = w.rings[w.ringIndex];
    if (!ring) return null;
    const d = rangeTo(f, ring.center);
    if (d > 400 || d < 210) return null;
    const off = Math.abs(noseOffset(f, ring.center));
    if (off > (18 * Math.PI) / 180) return null;
    // Prefer the frames whose nose also points at the volcano, so the smoking summit is in shot.
    const volcanoOff = Math.abs(noseOffset(f, [300, 0, -1180]));
    return 100 - off * 90 - volcanoOff * 22 - Math.abs(f.roll) * 40;
  });
  return { screen: SCREEN_FLY, camera: CAMERA_CHASE, time: t };
}

/** The landing card: fly the sortie to a graded touchdown and the card that follows it. */
export function stageLandingCard(flight, world) {
  flySortie(flight, world, (f, w) => {
    if (!w.landingGrade || !f.onGround || f.groundSpeed >= 5) return null;
    return 1;
  });
  if (world.landingGrade) {
    world.ended = true;
    world.outcome = 'landed';
  }
  return { screen: SCREEN_RESULT, camera: CAMERA_CHASE, time: world.clock };
}

export { stageLandingCard as stageResult };
