// Fly a whole sortie headless: takeoff, six rings, the mail drop, the landing. Prints every event,
// the final score and the landing card, so the game's playability is a number rather than an
// opinion. Run with `node tools/sortiecheck.mjs`; TRACE=1 prints the flight every two seconds.

import { createFlightState, stepFlight, checkTerrainCollision, stallSpeedKt } from '../game/src/flightModel.js';
import { createWorld, stepWorld, releaseMail, resetWorld, LEG_DROP } from '../game/src/world.js';
import { heightAt, PADS, dropPoint } from '../game/src/terrain.js';
import { flyTo, flyApproach, flyTakeoff, approachEntry, circuitWaypoint, headingDeg } from '../game/src/autopilot.js';
import { STEP } from '../game/src/config.js';

const flight = createFlightState();
const world = createWorld();
resetWorld(world, flight);

flight.position = [0, 24 + 1.55, 780];
flight.heading = 0;
flight.throttle = 1;
flight.onGround = true;

const events = [];
let t = 0;
let takeoffRoll = null;
let phase = 'takeoff';
let joinLeg = 'downwind';
let entryPoint = null;

for (let i = 0; i < 120 * 400; i += 1) {
  let controls;
  if (phase === 'takeoff') {
    controls = flyTakeoff(flight);
    if (!flight.onGround && !takeoffRoll) takeoffRoll = { t: +t.toFixed(1), kt: (flight.airspeed * 1.944).toFixed(0) };
    if (takeoffRoll && flight.agl > 55) phase = 'rings';
  } else if (phase === 'rings') {
    const ring = world.rings[world.ringIndex] ?? world.rings[world.rings.length - 1];
    controls = flyTo(flight, ring.center, 40, { arriveLevel: true, axis: ring.axis, lead: 240, dt: STEP });
    if (world.leg === LEG_DROP) phase = 'drop';
  } else if (phase === 'drop') {
    const drop = dropPoint();
    const target = [drop.x, heightAt(drop.x, drop.z) + 105, drop.z];
    controls = flyTo(flight, target, 36, { arriveLevel: true, dt: STEP });
    const dist = Math.hypot(flight.position[0] - drop.x, flight.position[2] - drop.z);
    if (dist < 205 && flight.agl < 126 && Math.abs(flight.roll) < 0.38) {
      const result = releaseMail(world, flight);
      events.push(`${t.toFixed(1)}s drop attempt: ${JSON.stringify(result)} dist ${dist.toFixed(0)} agl ${flight.agl.toFixed(0)}`);
      if (result.ok) {
        phase = 'join';
        joinLeg = 'downwind';
        entryPoint = approachEntry(PADS.find((p) => p.id === 'beach'), 1500, 150);
      }
    }
  } else if (phase === 'join') {
    // A real join: downwind, base, then final on the centreline. Chasing the threshold directly
    // from the far side of the island just orbits the runway.
    const pad = PADS.find((p) => p.id === 'beach');
    const waypoint = circuitWaypoint(pad, joinLeg);
    const distance = Math.hypot(waypoint[0] - flight.position[0], waypoint[2] - flight.position[2]);
    controls = flyTo(flight, waypoint, 38, { arriveLevel: true, dt: STEP });
    if (distance < 380) {
      if (joinLeg === 'downwind') joinLeg = 'base';
      else if (joinLeg === 'base') {
        joinLeg = 'final';
        entryPoint = circuitWaypoint(pad, 'final');
      } else phase = 'landing';
    }
  } else if (phase === 'landing') {
    const pad = PADS.find((p) => p.id === 'beach');
    // Once the wheels are down the pilot's job is to stop, not to keep flying the approach: idle,
    // brakes, stick neutral. Holding the approach controller on the ground pitches it back into the
    // air at 40 knots and it falls out of the sky.
    controls = flight.onGround
      ? { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: true, steer: 0 }
      : flyApproach(flight, pad);
    if (flight.onGround && flight.groundSpeed < 3) {
      events.push(`${t.toFixed(1)}s landed`);
      break;
    }
  }

  flight.braking = controls.brake;
  const prev = [flight.position[0], flight.position[1], flight.position[2]];
  stepFlight(flight, controls, STEP);
  checkTerrainCollision(flight);
  const event = stepWorld(world, flight, prev, STEP);
  if (event && event !== 'go') {
    events.push(`${t.toFixed(1)}s ${event}: ${world.messages[world.messages.length - 1]?.text ?? ''}`);
  }
  if (process.env.TRACE && i % 240 === 0) {
    const r = world.rings[world.ringIndex];
    console.log(
      `  ${t.toFixed(0)}s ${phase} pos ${flight.position.map((v) => v.toFixed(0)).join(',')} kt ${(flight.airspeed * 1.944).toFixed(0)} vs ${(flight.verticalSpeed * 196.85).toFixed(0)} hdg ${headingDeg(flight).toFixed(0)} roll ${(flight.roll * 57.3).toFixed(0)} ${r ? `ring ${r.index} d ${Math.hypot(r.center[0] - flight.position[0], r.center[2] - flight.position[2]).toFixed(0)} dy ${(r.center[1] - flight.position[1]).toFixed(0)}` : ''}`,
    );
  }
  if (world.landingGrade && flight.onGround && flight.groundSpeed < 4) {
    events.push(`${t.toFixed(1)}s rolled out at ${flight.position.map((v) => v.toFixed(0)).join(',')}`);
    break;
  }
  if (world.ended) break;
  t += STEP;
}

console.log('stall speed', stallSpeedKt(0).toFixed(0), 'kt');
console.log('takeoff:', JSON.stringify(takeoffRoll));
console.log('events:');
for (const e of events) console.log('  ', e);
console.log('rings', world.ringsCleared, '/', world.rings.length, 'missed', world.ringsMissed);
console.log('mail', world.mailDropped, 'accuracy', world.mailAccuracy.toFixed(2));
console.log('landing', JSON.stringify(world.landingGrade));

console.log('clock remaining', world.remaining.toFixed(0), 's');
console.log('final position', flight.position.map((v) => v.toFixed(0)).join(','), 'alt', flight.altitude.toFixed(0), 'agl', flight.agl.toFixed(0));
