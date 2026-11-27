// The camera. A chase view on a spring: it trails the aeroplane's heading and altitude with a lag
// that is longer the harder the turn, so it never snaps and never fights the pilot, and it lifts
// with the horizon when the wings bank so the ground stays where the pilot expects it. A cockpit
// view sits on the pilot's eye line, and a wing view shows the aeroplane from the side for the
// screenshots that need the whole airframe.

import { clamp, dot, normalize, sub } from './mathx.js';

export const CAMERA_CHASE = 'chase';
export const CAMERA_COCKPIT = 'cockpit';
export const CAMERA_WING = 'wing';

function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createCamera() {
  const state = {
    mode: CAMERA_CHASE,
    eye: [0, 0, 0],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fov: 1.0,
    shake: 0,
    heading: 0,
    pitch: 0,
    upRoll: 0,
  };

  /** Snap the spring to the aeroplane: after a reset, a new leg, or a staged screenshot. */
  function reset(flight) {
    state.heading = flight.heading;
    state.pitch = flight.pitch * 0.35;
    state.upRoll = 0;
    state.shake = 0;
  }

  /**
   * Move the camera for this frame. `dt` is wall-clock seconds; the spring's rate is fixed in
   * seconds so the camera settles in about half a second at any frame rate.
   */
  function update(flight, dt, speedNorm) {
    const cockpit = state.mode === CAMERA_COCKPIT;
    const follow = 1 - Math.exp(-(cockpit ? 24 : 4.2) * dt);
    state.heading += angleDelta(state.heading, flight.heading) * follow;
    state.pitch += (flight.pitch * 0.35 - state.pitch) * follow;

    const bankTarget = flight.roll * (cockpit ? 1 : 0.44);
    state.upRoll += (bankTarget - state.upRoll) * (1 - Math.exp(-3.4 * dt));

    const ch = Math.cos(state.heading);
    const sh = Math.sin(state.heading);
    const levelUp = [0, 1, 0];
    const right = [ch, 0, sh];
    const cr = Math.cos(state.upRoll);
    const sr = Math.sin(state.upRoll);
    state.up = normalize([levelUp[0] * cr + right[0] * sr, levelUp[1] * cr, levelUp[2] * cr + right[2] * sr]);

    if (cockpit) {
      const cp = Math.cos(flight.pitch);
      const sp = Math.sin(flight.pitch);
      const fwd = [Math.sin(flight.heading) * cp, sp, -Math.cos(flight.heading) * cp];
      // The eye has to clear the airframe. The mesh runs from z = -4.86 to +4.50 and up to y = 2.01,
      // so an eye 2.05 m forward and 0.58 m up sat *inside* the fuselage: the windscreen filled with
      // the interior's back faces and half the frame was cream hull. Sitting just above the canopy
      // and a little behind the nose looks over the cowling at the valley, the way the shot wants.
      const eyeUp = 2.32;
      const eyeAhead = 1.30;
      state.eye = [
        flight.position[0] + fwd[0] * eyeAhead,
        flight.position[1] + fwd[1] * eyeAhead + eyeUp,
        flight.position[2] + fwd[2] * eyeAhead,
      ];
      state.target = [
        state.eye[0] + fwd[0] * 80,
        state.eye[1] + fwd[1] * 80,
        state.eye[2] + fwd[2] * 80,
      ];
      state.fov = 1.22;
      return state;
    }

    const ahead = [Math.sin(state.heading), 0, -Math.cos(state.heading)];
    let eye;
    if (state.mode === CAMERA_WING) {
      eye = [
        flight.position[0] + right[0] * 11.5 - ahead[0] * 1.8,
        flight.position[1] + 2.9,
        flight.position[2] + right[2] * 11.5 - ahead[2] * 1.8,
      ];
    } else {
      const dist = 15.5 + speedNorm * 3.2;
      const height = 4.1 + Math.sin(state.pitch) * 3.6;
      eye = [
        flight.position[0] - ahead[0] * dist,
        flight.position[1] + height,
        flight.position[2] - ahead[2] * dist,
      ];
    }
    state.eye = eye;

    // Look ahead of the aeroplane rather than at it, so the ring and the runway stay in frame. The
    // wing view is the exception: its eye sits 11.5 m off the wingtip, so every metre of look-ahead
    // swings the airframe further abeam. At 14 m it was 45 degrees off the sight line and at the
    // frame edge; at 34 m it was 63 degrees off and outside the frame. A short lead keeps the whole
    // aeroplane in frame with the gate beyond it.
    const look = state.mode === CAMERA_WING ? 6 : 30 + speedNorm * 26;
    const lp = Math.sin(state.pitch * 0.55);
    state.target = [
      flight.position[0] + ahead[0] * look,
      flight.position[1] + 1.6 + lp * look,
      flight.position[2] + ahead[2] * look,
    ];

    const shakeTarget =
      state.mode === CAMERA_CHASE ? clamp(Math.abs(flight.gLoad) - 3.4, 0, 2.5) * 0.02 + flight.stall * 0.06 : 0;
    state.shake += (shakeTarget - state.shake) * (1 - Math.exp(-7 * dt));
    state.fov = 1.0 + speedNorm * 0.09 + (flight.stall > 0.45 ? 0.02 : 0);
    return state;
  }

  /** The offset the renderer jitters the eye by this frame: held steady of the state itself. */
  function shakeOffset(t) {
    if (state.shake <= 0.0001) return [0, 0, 0];
    const a = state.shake;
    return [Math.sin(t * 37.1) * a, Math.sin(t * 51.7 + 1.3) * a * 0.8, Math.sin(t * 29.3 + 2.1) * a];
  }

  function toggle() {
    state.mode =
      state.mode === CAMERA_CHASE ? CAMERA_COCKPIT : state.mode === CAMERA_COCKPIT ? CAMERA_WING : CAMERA_CHASE;
    state.upRoll = 0;
    return state.mode;
  }

  function setMode(mode) {
    state.mode = mode;
    state.upRoll = 0;
  }

  return { state, update, reset, toggle, setMode, shakeOffset };
}

/** Nose direction of the chase camera; the renderer uses it to keep the sun out of frame. */
export function cameraForward(state) {
  return normalize(sub(state.target, state.eye));
}
