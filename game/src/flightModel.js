// The aeroplane. The elevator commands an angle of attack, the wing turns that into lift, the lift
// curves the flight path, and the nose sits at the path's angle plus the angle of attack it is
// flying. Banking tilts the lift, the tilted lift curves the path sideways, and the heading follows
// the path — so every number on the HUD is the state, not a decoration, and a stall is a real loss
// of lift rather than a light that comes on.
//
// Body axes: +Z is the nose, +Y is up through the canopy, +X is the right wing. Heading 0 flies
// toward -Z (north) and heading 90 toward +X (east); positive pitch is nose up; positive roll is a
// right bank.

import { AIRCRAFT } from './config.js';
import { clamp, dot, length, normalize } from './mathx.js';
import { heightAt, surfaceAt } from './terrain.js';

export const AIR_DENSITY = 1.12;
const GRAVITY = 9.81;
export const WHEEL_HEIGHT = 1.55;

export function createFlightState() {
  return {
    position: [0, 24 + WHEEL_HEIGHT, 820],
    velocity: [0, 0, 0],
    heading: 0,
    pitch: 0,
    roll: 0,
    /** The angle of attack the wing is actually at, and the one the elevator is asking for. */
    alpha: 0.02,
    alphaCommand: 0.02,
    throttle: 0,
    fuelKg: AIRCRAFT.fuelKg,
    damage: 0,
    gearDown: true,
    flaps: 0,
    rpm: 0,
    onGround: true,
    beta: 0,
    gLoad: 1,
    stall: 0,
    stallWarning: false,
    engineOut: false,
    crashed: false,
    crashReason: '',
    agl: WHEEL_HEIGHT,
    altitude: 24 + WHEEL_HEIGHT,
    verticalSpeed: 0,
    airspeed: 0,
    groundSpeed: 0,
    pathPitch: 0,
    touchdown: null,
    braking: false,
    steer: 0,
    justLifted: false,
  };
}

/** Nose, wing-up and right-wing vectors from the attitude angles. */
export function bodyAxes(state) {
  const ch = Math.cos(state.heading);
  const sh = Math.sin(state.heading);
  const cp = Math.cos(state.pitch);
  const sp = Math.sin(state.pitch);
  const cr = Math.cos(state.roll);
  const sr = Math.sin(state.roll);
  const forward = [sh * cp, sp, -ch * cp];
  const rightLevel = [ch, 0, sh];
  const upLevel = [0, 1, 0];
  const up = [upLevel[0] * cr + rightLevel[0] * sr, upLevel[1] * cr, upLevel[2] * cr + rightLevel[2] * sr];
  const right = [
    rightLevel[0] * cr - upLevel[0] * sr,
    rightLevel[1] * cr - upLevel[1] * sr,
    rightLevel[2] * cr - upLevel[2] * sr,
  ];
  return { forward, up, right };
}

/** Lift coefficient against angle of attack, with the post-stall fall-off. The sign is carried
 * through the linear range: a wing at a negative angle of attack makes negative lift, which is how
 * the aeroplane is made to descend without simply pointing the nose at the ground. */
export function liftCoefficient(alpha) {
  const a = Math.abs(alpha);
  if (a <= AIRCRAFT.stallAlpha) return AIRCRAFT.cl0 + AIRCRAFT.clAlpha * alpha;
  const peak = AIRCRAFT.cl0 + AIRCRAFT.clAlpha * AIRCRAFT.stallAlpha;
  const fallen = Math.max(peak * 0.38, peak - (a - AIRCRAFT.stallAlpha) * 3.0);
  return alpha < 0 ? -fallen : fallen;
}

export function stallSpeedKt(flaps = 0) {
  const clMax = AIRCRAFT.cl0 + AIRCRAFT.clAlpha * AIRCRAFT.stallAlpha + flaps * 0.30;
  const v = Math.sqrt((2 * AIRCRAFT.massKg * GRAVITY) / (AIR_DENSITY * AIRCRAFT.wingAreaM2 * clMax));
  return v * 1.94384;
}

/** Engine thrust available now: throttle, fuel, damage and airspeed all take their cut. */
export function thrustNow(state, airspeed) {
  if (state.fuelKg <= 0) return 0;
  const damaged = 1 - state.damage * AIRCRAFT.damageThrust;
  const rough = state.damage > 0.55 ? 0.74 + 0.26 * Math.cos(state.rpm * 31.7) : 1;
  const base = AIRCRAFT.idleThrustN + (AIRCRAFT.maxThrustN - AIRCRAFT.idleThrustN) * state.throttle;
  const ramFall = clamp(1 - Math.max(0, airspeed - 55) / 140, 0.25, 1);
  return base * damaged * rough * ramFall;
}

/** Move an angle toward another by at most `maxStep`, the short way round. */
function approach(from, to, maxStep) {
  const d = to - from;
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/**
 * Advance one fixed step. `controls` carries pitch (-1 nose down .. +1 nose up), roll (-1 left ..
 * +1 right), yaw (rudder) and throttle 0..1, plus flaps and gearDown so the loop owns those.
 */
export function stepFlight(state, controls, dt) {
  if (state.crashed) return state;

  const mass = AIRCRAFT.massKg;
  const area = AIRCRAFT.wingAreaM2;

  state.throttle = clamp(controls.throttle ?? state.throttle, 0, 1);
  if (controls.flaps != null) state.flaps = controls.flaps;
  if (controls.gearDown != null) state.gearDown = controls.gearDown;

  // Fuel and the engine.
  const burn = AIRCRAFT.burnIdleKgS + (AIRCRAFT.burnFullKgS - AIRCRAFT.burnIdleKgS) * state.throttle;
  state.fuelKg = Math.max(0, state.fuelKg - burn * dt);
  if (state.fuelKg <= 0) state.engineOut = true;

  let speed = length(state.velocity);
  const airflow = clamp(speed / 28, 0.1, 1.25);
  const onWheels = state.onGround;

  // Attitude: the stick rolls the wings; the elevator sets the angle of attack. A released stick
  // leaves the bank where it is — the wings stay where they are put, as on a real aeroplane with
  // the ailerons neutral — and the wings-level tendency is only a slow, gentle one.
  const rollAuthority = AIRCRAFT.rollRate * airflow * (onWheels ? 0.45 : 1);
  state.roll = clamp(state.roll + controls.roll * rollAuthority * dt, -1.45, 1.45);
  if (Math.abs(controls.roll) < 0.02 && !onWheels) state.roll *= 1 - 0.06 * dt;
  if (onWheels) state.roll *= 1 - 6 * dt;

  // The elevator's authority is the airframe's, and it is weakest when slow. Full back stick takes
  // the wing past its critical angle, so a stall is something the pilot can actually do — and past
  // the stall the elevator loses bite, which is what lets the nose drop and the wing fly again.
  const alphaRate = 1.25 * clamp(speed / 30, 0.35, 1.1);
  const alphaWanted = clamp(0.02 + controls.pitch * 0.34, -0.24, 0.34);
  state.alphaCommand = alphaWanted;
  state.alpha = approach(state.alpha, alphaWanted, alphaRate * dt);

  const cl = liftCoefficient(state.alpha);
  const q = 0.5 * AIR_DENSITY * speed * speed;
  const cd =
    AIRCRAFT.cd0 +
    AIRCRAFT.inducedK * cl * cl +
    (state.flaps > 0 ? AIRCRAFT.flapDrag : 0) +
    (state.gearDown ? AIRCRAFT.gearDrag : 0) +
    state.damage * AIRCRAFT.damageDrag;
  const liftN = q * area * cl;
  const dragN = q * area * cd;
  const thrustN = thrustNow(state, speed);

  // The force sum: lift along the wing's up line, drag along the path, thrust along the nose.
  const axes = bodyAxes(state);
  let fx = 0;
  let fy = 0;
  let fz = 0;
  if (speed > 1.0) {
    const vDir = [state.velocity[0] / speed, state.velocity[1] / speed, state.velocity[2] / speed];
    const upAlong = dot(axes.up, vDir);
    const liftDir = normalize([
      axes.up[0] - vDir[0] * upAlong,
      axes.up[1] - vDir[1] * upAlong,
      axes.up[2] - vDir[2] * upAlong,
    ]);
    fx += liftDir[0] * liftN - vDir[0] * dragN;
    fy += liftDir[1] * liftN - vDir[1] * dragN;
    fz += liftDir[2] * liftN - vDir[2] * dragN;
  }
  fx += axes.forward[0] * thrustN;
  fy += axes.forward[1] * thrustN;
  fz += axes.forward[2] * thrustN;
  fy -= mass * GRAVITY;

  state.velocity[0] += (fx / mass) * dt;
  state.velocity[1] += (fy / mass) * dt;
  state.velocity[2] += (fz / mass) * dt;

  state.gLoad = clamp(liftN / (mass * GRAVITY), -3, 9);

  state.position[0] += state.velocity[0] * dt;
  state.position[1] += state.velocity[1] * dt;
  state.position[2] += state.velocity[2] * dt;

  speed = length(state.velocity);
  const horiz = Math.hypot(state.velocity[0], state.velocity[2]);

  // The nose sits at the path's angle plus the angle of attack being flown, and the heading follows
  // the path. That is what keeps the attitude honest in a climb, a dive and a turn.
  if (horiz > 4 && !onWheels) {
    const pathHeading = Math.atan2(state.velocity[0], -state.velocity[2]);
    state.heading = approach(state.heading, pathHeading + controls.yaw * 0.06, 2.6 * dt);
    state.pathPitch = Math.atan2(state.velocity[1], horiz);
    state.pitch = approach(state.pitch, clamp(state.pathPitch + state.alpha, -1.15, 1.15), 3.2 * dt);
  } else if (onWheels) {
    state.pathPitch = 0;
    // On the wheels the nose is the pilot's to raise for the rotation, and no higher than the tail
    // will let it go.
    state.pitch = clamp(state.pitch + controls.pitch * 0.55 * dt, -0.03, 0.2);
    if (speed < 6) state.pitch *= 1 - 4 * dt;
  }

  const ground = heightAt(state.position[0], state.position[2]);
  state.agl = state.position[1] - surfaceAt(state.position[0], state.position[2]);  state.altitude = state.position[1];
  state.verticalSpeed = state.velocity[1];
  state.airspeed = speed;
  state.groundSpeed = horiz;
  state.rpm = state.engineOut ? 0 : 0.22 + state.throttle * 0.78;
  state.stall = clamp((Math.abs(state.alpha) - AIRCRAFT.stallAlpha) / 0.13, 0, 1);
  state.stallWarning = state.stall > 0.02 && !onWheels && speed > 2;
  // Past the stall the wing lets go: the nose drops and the aeroplane falls out of the climb. This
  // is the visible consequence the HUD's STALL light is warning about.
  if (state.stall > 0.35 && !onWheels) {
    state.pitch -= state.stall * 0.55 * dt;
    state.velocity[1] -= state.stall * 3.4 * dt;
    state.roll += Math.sin(state.alpha * 31) * state.stall * 0.35 * dt;
  }

  state.justLifted = false;
  const surface = surfaceAt(state.position[0], state.position[2]);
  if (state.agl <= WHEEL_HEIGHT) handleGround(state, ground, surface, dt);
  else if (onWheels) {
    state.onGround = false;
    state.justLifted = true;
  }

  return state;
}

/** Wheels on the ground: the touchdown record, rolling friction, brakes and steering. `ground` is
 * the land under the aeroplane; `surface` is what the wheels actually rest on, which is sea level
 * when the noise field has dug the seabed below it. */
function handleGround(state, ground, surface, dt) {
  const descent = -state.velocity[1];
  if (!state.onGround) {
    state.touchdown = {
      sink: Math.max(0, descent),
      groundSpeed: Math.hypot(state.velocity[0], state.velocity[2]),
      bankDeg: Math.abs((state.roll * 180) / Math.PI),
    };
    state.onGround = true;
    if (descent > 6.2) {
      state.crashed = true;
      state.crashReason = 'Hull struck the ground';
      return;
    }
    if (descent > 3.4) state.damage = clamp(state.damage + (descent - 3.4) * 0.16, 0, 1);
    state.roll *= 0.25;
    state.alpha = 0.02;
  }

  state.position[1] = surface + WHEEL_HEIGHT;
  if (state.velocity[1] < 0) state.velocity[1] = 0;

  let groundSpeed = Math.hypot(state.velocity[0], state.velocity[2]);
  // The wheels hold the aeroplane to the direction it is pointing.
  if (groundSpeed > 0.5) {
    const dirX = Math.sin(state.heading);
    const dirZ = -Math.cos(state.heading);
    const forwardSpeed = state.velocity[0] * dirX + state.velocity[2] * dirZ;
    state.velocity[0] = dirX * forwardSpeed;
    state.velocity[2] = dirZ * forwardSpeed;
    groundSpeed = Math.abs(forwardSpeed);
  }

  const decel = 0.5 + (state.braking ? 2.8 : 0);
  const next = Math.max(0, groundSpeed - decel * dt);
  if (groundSpeed > 0.01) {
    const scale = next / groundSpeed;
    state.velocity[0] *= scale;
    state.velocity[2] *= scale;
  } else {
    state.velocity[0] = 0;
    state.velocity[2] = 0;
  }

  if (groundSpeed > 0.4 && groundSpeed < 32) {
    const bite = clamp(groundSpeed / 5, 0, 1) * clamp(1 - groundSpeed / 36, 0, 1);
    state.heading += state.steer * 0.62 * bite * dt;
  }

  if (Math.abs(state.roll) > 0.5 && groundSpeed > 15) {
    state.crashed = true;
    state.crashReason = 'Wingtip caught the ground';
  }
}

/** Terrain rising into the aeroplane ends the sortie; the caller raises the message. */
export function checkTerrainCollision(state) {
  if (state.crashed) return true;
  const ground = surfaceAt(state.position[0], state.position[2]);
  if (state.position[1] - ground < 1.2 && !state.onGround) {
    state.crashed = true;
    state.crashReason = 'Flew into rising ground';
    return true;
  }
  if (state.position[1] > 4200) {
    state.position[1] = 4200;
    state.velocity[1] = Math.min(0, state.velocity[1]);
  }
  return false;
}
