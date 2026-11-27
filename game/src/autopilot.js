// The autopilot that flies the staged screenshots and the headless sortie test. It is the inverse
// of the flight model: ask for the vertical acceleration the aeroplane needs, turn that into the
// lift coefficient that produces it, and turn that into the angle of attack the elevator must fly.
// Going through the inverse is what keeps it steady — a plain "more back stick when low" loop
// oscillates, because pitch sets lift, not climb rate.
//
// Gates are flown the way a pilot flies them: aim at a point short of the gate on its own axis, so
// the aeroplane is already lined up when it arrives, rather than turning at the last moment.

import { AIRCRAFT } from './config.js';
import { clamp, deg } from './mathx.js';
import { AIR_DENSITY } from './flightModel.js';

const G = 9.81;

function wrapAngle(a) {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The lift coefficient that gives `gWanted` at this speed and bank, inverted to an angle of attack
 * and then to the elevator command that flies it. Returns a pitch in -1..1.
 */
export function pitchForLoad(flight, gWanted) {
  const v = Math.max(flight.airspeed, 14);
  const q = 0.5 * AIR_DENSITY * v * v;
  // L = q*S*Cl must equal m*g*gWanted. The 0.5 is already inside q.
  const clNeeded = (AIRCRAFT.massKg * G * gWanted) / (q * AIRCRAFT.wingAreaM2);
  const alphaNeeded = (clNeeded - AIRCRAFT.cl0) / AIRCRAFT.clAlpha;
  const alpha = clamp(alphaNeeded, -0.19, 0.23);
  return clamp((alpha - 0.02) / 0.34, -1, 1);
}

/**
 * Fly toward `target` holding `speed` (m/s). With `options.axis` the aeroplane aims at a point
 * `options.lead` metres short of the target along that axis, so it crosses the gate square instead
 * of orbiting it: pure pursuit of a point dead ahead curves away and never arrives.
 */
export function flyTo(flight, target, speed, options = {}) {
  let aim = target;
  if (options.axis) {
    const lead = options.lead ?? 220;
    const d = Math.hypot(target[0] - flight.position[0], target[2] - flight.position[2]);
    const useLead = Math.min(lead, d * 0.6);
    aim = [target[0] - options.axis[0] * useLead, target[1], target[2] - options.axis[2] * useLead];
  }

  const dx = aim[0] - flight.position[0];
  const dy = aim[1] - flight.position[1];
  const dz = aim[2] - flight.position[2];
  const distance = Math.hypot(dx, dz);
  const bearing = Math.atan2(dx, -dz);
  const headingError = wrapAngle(bearing - flight.heading);

  // Lateral: bank into the turn, harder when the error is large, with a lead so it rolls out on
  // the line instead of weaving through it. The aeroplane holds whatever bank it is put at, so this
  // is a plain proportional law on the bank angle — no deadband, or the turn stalls short.
  const wantedRoll = clamp(headingError * 1.7, -0.95, 0.95);
  const roll = clamp((wantedRoll - flight.roll) * 3.0, -1, 1);

  // Vertical: the flight-path angle that closes the height difference over the distance to run.
  // A glide is not flown by unloading the wing — lift stays at about the weight and the aeroplane
  // descends because thrust is below drag. So the load command is cos(gamma)/cos(bank), with a soft
  // correction and a rate damper on top; the throttle schedule sets the speed.
  const dt = options.dt ?? 1 / 120;
  const timeToGo = Math.max(4, distance / Math.max(12, flight.airspeed));
  let wantedVs = clamp(dy / timeToGo, -8.5, 4.0);
  if (options.arriveLevel && distance < 320) wantedVs *= distance / 320;
  const vsError = wantedVs - flight.verticalSpeed;
  const vsRate = (flight.verticalSpeed - (flight.lastVs ?? flight.verticalSpeed)) / dt;
  flight.lastVs = flight.verticalSpeed;

  const gamma = Math.atan2(wantedVs, Math.max(12, flight.airspeed));
  const bankCos = Math.max(0.4, Math.cos(flight.roll));
  const gWanted = clamp(Math.cos(gamma) / bankCos + vsError * 0.05 - vsRate * 0.010, 0.15, 2.2);
  const pitch = pitchForLoad(flight, gWanted);

  const throttle = clamp(0.42 + (speed - flight.airspeed) * 0.055, 0, 1);
  return { pitch, roll, yaw: clamp(headingError * -0.2, -0.4, 0.4), throttle, brake: false, steer: 0 };
}

/** Where to join the approach: a point on the extended centreline, well before the threshold. */
export function approachEntry(pad, distance = 1500, height = 140) {
  const heading = pad.runway.heading;
  // The strip runs along (-sin h, cos h) and is landed on flying heading h, so the centreline
  // extends backwards along (-sin h, +cos h).
  return [
    pad.center[0] - Math.sin(heading) * distance,
    pad.elevation + height,
    pad.center[2] + Math.cos(heading) * distance,
  ];
}

/**
 * A circuit to join the approach from anywhere: out to a downwind point abeam the strip, round
 * base, then roll out on final. Handing the aeroplane the threshold from the far side of the island
 * just makes it circle the runway; a real join is three straight-ish legs, each with the next one
 * in sight.
 *
 * The legs are keyed by name so the caller only has to advance the name when the waypoint is
 * reached.
 */
export function circuitWaypoint(pad, leg) {
  const heading = pad.runway.heading;
  const dirX = Math.sin(heading);
  const dirZ = -Math.cos(heading);
  const rightX = Math.cos(heading);
  const rightZ = Math.sin(heading);
  const offset = 900;

  if (leg === 'downwind') {
    // Abeam the strip, offset to the right of the landing direction, at circuit height.
    return [
      pad.center[0] + rightX * offset + dirX * 200,
      pad.elevation + 200,
      pad.center[2] + rightZ * offset + dirZ * 200,
    ];
  }
  if (leg === 'base') {
    // Off the approach end, still on the offset, ready to roll out onto final.
    return [
      pad.center[0] + rightX * offset * 0.6 - dirX * 1250,
      pad.elevation + 175,
      pad.center[2] + rightZ * offset * 0.6 - dirZ * 1250,
    ];
  }
  return approachEntry(pad, 1500, 150);
}

/**
 * The landing: fly the centreline to the threshold, hold the speed back, and flare over the
 * numbers. `pad` is the runway record from terrain.js.
 *
 * This is a tracking law on a line, not a pursuit of the runway centre — aiming at the middle of
 * the strip from off to one side puts the aeroplane in a permanent turn around it. The lateral
 * command is built from the cross-track error and the track error, so the aeroplane converges onto
 * the extended centreline and then stays on it.
 *
 * Basis: the strip's landing direction is (sin h, -cos h); `along` is distance down that line from
 * the threshold (negative before it) and `across` is the offset to the right of it.
 */
export function flyApproach(flight, pad) {
  const heading = pad.runway.heading;
  const dirX = Math.sin(heading);
  const dirZ = -Math.cos(heading);
  const rightX = Math.cos(heading);
  const rightZ = Math.sin(heading);

  const dx = flight.position[0] - pad.center[0];
  const dz = flight.position[2] - pad.center[2];
  const along = dx * dirX + dz * dirZ;
  const across = dx * rightX + dz * rightZ;

  // Track the centreline: aim the nose back at the line by the cross-track error, and add a
  // correction for the heading already being off the runway direction.
  const trackError = wrapAngle(heading - flight.heading);
  const trackBearing = heading - clamp(across * 0.0060, -0.42, 0.42) + clamp(trackError * 0.7, -0.30, 0.30);
  const headingError = wrapAngle(trackBearing - flight.heading);
  const wantedRoll = clamp(headingError * 2.4, -0.5, 0.5);
  const roll = clamp((wantedRoll - flight.roll) * 3.0, -1, 1);

  // Glide slope: about 4 degrees down to the threshold, flattening into a flare over the numbers.
  // Height above the strip, not above the sea, is what the flare is measured on.
  const height = flight.position[1] - pad.elevation;
  const distanceToGo = Math.max(0, -along);
  const slopeVs = -clamp(distanceToGo * 0.062, 0.8, 3.8);
  const flare = height < 14 ? clamp(height / 14, 0.05, 1) : 1;
  const wantedVs = slopeVs * flare;
  const vsError = wantedVs - flight.verticalSpeed;
  const vsRate = (flight.verticalSpeed - (flight.lastVs ?? flight.verticalSpeed)) / (1 / 120);
  flight.lastVs = flight.verticalSpeed;
  const gamma = Math.atan2(wantedVs, Math.max(12, flight.airspeed));
  const gWanted = clamp(Math.cos(gamma) / Math.max(0.5, Math.cos(flight.roll)) + vsError * 0.05 - vsRate * 0.010, 0.15, 1.6);
  const pitch = pitchForLoad(flight, gWanted);

  const throttle = clamp(0.18 + (31 - flight.airspeed) * 0.075, 0, 0.55);
  const brake = flight.onGround && flight.groundSpeed > 3;
  return { pitch, roll, yaw: 0, throttle, brake, steer: 0 };
}

/** Take off: full power down the strip, rotate at 52 knots, then climb away. */
export function flyTakeoff(flight) {
  const kt = flight.airspeed * 1.94384;
  const rotating = kt > 52;
  return {
    pitch: rotating ? (flight.agl < 45 ? 0.42 : 0.22) : 0.05,
    roll: 0,
    yaw: 0,
    throttle: 1,
    brake: false,
    steer: 0,
  };
}

export function headingDeg(flight) {
  return ((deg(flight.heading) % 360) + 360) % 360;
}
