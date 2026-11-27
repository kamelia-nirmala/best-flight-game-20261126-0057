// Fly the model on the ground and in the air, and print what happened: takeoff distance, climb
// rate, stall speed and turn rate. This is the numbers check behind the feel.
//
// Each segment starts from a fresh state, so a crash in one cannot contaminate the next.
import { createFlightState, stepFlight, stallSpeedKt, thrustNow } from '../game/src/flightModel.js';
import { heightAt } from '../game/src/terrain.js';
import { STEP } from '../game/src/config.js';

const f = createFlightState();
f.position = [0, 24 + 1.55, 820];
f.heading = 0;
console.log('stall speed clean', stallSpeedKt(0).toFixed(1), 'kt | with flaps', stallSpeedKt(1).toFixed(1));
console.log('thrust at 0 kt, full:', thrustNow({ ...f, throttle: 1, damage: 0 }, 0).toFixed(0), 'N; at 40 m/s:', thrustNow({ ...f, throttle: 1, damage: 0 }, 40).toFixed(0));
console.log('weight:', (1250 * 9.81).toFixed(0), 'N');

// A clean airborne state at a given height, airspeed (m/s) and heading.
function airborne(alt, speed, heading = 0) {
  const s = createFlightState();
  s.position = [0, alt, 0];
  s.velocity = [Math.sin(heading) * speed, 0, -Math.cos(heading) * speed];
  s.heading = heading;
  s.pitch = 0;
  s.roll = 0;
  s.alpha = 0.02;
  s.throttle = 1;
  s.gearDown = false;
  s.flaps = 0;
  s.onGround = false;
  s.agl = alt - heightAt(0, 0);
  return s;
}

// 1. Takeoff run: full throttle, hold the runway heading, rotate at 52 kt.
let t = 0;
let rotated = false;
let liftoff = null;
const startZ = f.position[2];
for (let i = 0; i < 120 * 60; i += 1) {
  const kt = f.airspeed * 1.94384;
  if (!rotated && kt > 52) rotated = true;
  const pitchCmd = rotated && f.agl < 40 ? 0.55 : rotated ? 0.25 : 0;
  stepFlight(f, { pitch: pitchCmd, roll: 0, yaw: 0, throttle: 1, brake: false, steer: 0 }, STEP);
  t += STEP;
  if (!liftoff && !f.onGround) liftoff = { t: +t.toFixed(2), kt: kt.toFixed(1), dist: Math.abs(f.position[2] - startZ).toFixed(0) };
  if (liftoff && t > liftoff.t + 25) break;
}
console.log('liftoff:', JSON.stringify(liftoff));

// 2. Sustained climb: gear up, full throttle, a fixed elevator setting that asks for about 4.2 deg
//    of angle of attack. The wing decides the climb; nothing here holds a speed or a climb rate.
{
  const s = airborne(400, 40);
  const from = s.position[1];
  for (let i = 0; i < 120 * 30; i += 1) {
    stepFlight(s, { pitch: 0.16, roll: 0, yaw: 0, throttle: 1, brake: false, steer: 0 }, STEP);
  }
  console.log('30 s climb, gear up, full throttle: climbed ft', (s.position[1] - from).toFixed(0),
    'vs fpm', (s.verticalSpeed * 196.85).toFixed(0), 'kt', (s.airspeed * 1.94384).toFixed(0),
    'pitch', (s.pitch * 57.3).toFixed(1), 'aoa', (s.alpha * 57.3).toFixed(1));
}

// 3. Trimmed level flight: a rate loop on vertical speed, throttle holding 86 kt.
{
  const s = airborne(400, 45);
  for (let i = 0; i < 120 * 20; i += 1) {
    const vsErr = 0 - s.verticalSpeed;
    const pitch = Math.max(-0.6, Math.min(0.6, vsErr * 0.35 + 0.02));
    stepFlight(s, { pitch, roll: 0, yaw: 0, throttle: Math.max(0, Math.min(1, 0.5 + (44 - s.airspeed) * 0.05)), brake: false, steer: 0 }, STEP);
  }
  console.log('trimmed level: kt', (s.airspeed * 1.94384).toFixed(0), 'vs fpm', (s.verticalSpeed * 196.85).toFixed(0),
    'throttle', s.throttle.toFixed(2), 'aoa', (s.alpha * 57.3).toFixed(1), 'g', s.gLoad.toFixed(2));
}

// 4. A 30 degree bank, hands off pitch: does it hold altitude and turn?
{
  const s = airborne(500, 46);
  const h0 = s.heading;
  for (let i = 0; i < 120 * 12; i += 1) {
    const targetBank = 0.52;
    const roll = Math.max(-1, Math.min(1, (targetBank - s.roll) * 2.5));
    const vsErr = 0 - s.verticalSpeed;
    const pitch = Math.max(-0.6, Math.min(0.6, vsErr * 0.35));
    stepFlight(s, { pitch, roll, yaw: 0, throttle: Math.max(0, Math.min(1, 0.62 + (46 - s.airspeed) * 0.05)), brake: false, steer: 0 }, STEP);
  }
  const turned = ((s.heading - h0) * 57.3 + 540) % 360 - 180;
  console.log('12 s in a 30 deg bank: turned deg', turned.toFixed(0), 'alt ft', (s.altitude * 3.28084).toFixed(0),
    'vs fpm', (s.verticalSpeed * 196.85).toFixed(0), 'kt', (s.airspeed * 1.94384).toFixed(0), 'g', s.gLoad.toFixed(2));
}

// 5. Stall: idle power, full back stick. Full stick asks for 0.34 rad of angle of attack, past the
//    0.28 rad critical angle, so the wing should let go and the aeroplane should sink.
{
  const s = airborne(900, 33);
  s.throttle = 0;
  let stallAt = null;
  let minKt = 999;
  for (let i = 0; i < 120 * 25; i += 1) {
    stepFlight(s, { pitch: 1, roll: 0, yaw: 0, throttle: 0, brake: false, steer: 0 }, STEP);
    const kt = s.airspeed * 1.94384;
    minKt = Math.min(minKt, kt);
    if (!stallAt && s.stallWarning) stallAt = kt.toFixed(0);
  }
  console.log('stall onset kt:', stallAt, 'lowest kt', minKt.toFixed(0), 'alpha deg', (s.alpha * 57.3).toFixed(1),
    'stall', s.stall.toFixed(2), 'vs fpm', (s.verticalSpeed * 196.85).toFixed(0), 'crashed', s.crashed);
}

// 6. Terrain clearance sanity across the strip and the village.
console.log('height at start', heightAt(0, 820).toFixed(0), 'at village', heightAt(0, 520).toFixed(0));
