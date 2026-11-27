// Keyboard and mouse into one control block. The mouse steers by its offset from the middle of the
// window, the keyboard gives the same axes at full deflection, and the keys with a job of their
// own are reported as one-shot actions the loop decodes.

import { clamp } from './mathx.js';

export const ACTION_NONE = 0;
export const ACTION_PAUSE = 1;
export const ACTION_RESTART = 2;
export const ACTION_CAMERA = 4;
export const ACTION_GEAR = 8;
export const ACTION_FLAPS = 16;
export const ACTION_CONFIRM = 32;

const PITCH_UP = new Set(['KeyW', 'ArrowUp']);
const PITCH_DOWN = new Set(['KeyS', 'ArrowDown']);
const ROLL_LEFT = new Set(['KeyA', 'ArrowLeft']);
const ROLL_RIGHT = new Set(['KeyD', 'ArrowRight']);
const YAW_LEFT = new Set(['KeyQ']);
const YAW_RIGHT = new Set(['KeyE']);
const THROTTLE_UP = new Set(['ShiftLeft', 'ShiftRight', 'Equal', 'NumpadAdd']);
const THROTTLE_DOWN = new Set(['ControlLeft', 'ControlRight', 'Minus', 'NumpadSubtract']);

export function createInput(target) {
  const held = new Set();
  let pendingActions = ACTION_NONE;
  const mouse = { x: 0, y: 0, active: false, lastMove: 0 };
  const controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0.55, brake: false, steer: 0 };

  function onKeyDown(event) {
    const code = event.code;
    if (code.startsWith('Arrow') || code === 'Space') event.preventDefault();
    if (event.repeat) return;
    if (code === 'Space') pendingActions |= ACTION_CONFIRM;
    else if (code === 'KeyP' || code === 'Escape') pendingActions |= ACTION_PAUSE;
    else if (code === 'KeyR') pendingActions |= ACTION_RESTART;
    else if (code === 'KeyC') pendingActions |= ACTION_CAMERA;
    else if (code === 'KeyG') pendingActions |= ACTION_GEAR;
    else if (code === 'KeyF') pendingActions |= ACTION_FLAPS;
    held.add(code);
  }

  function onKeyUp(event) {
    held.delete(event.code);
  }

  function onPointerMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = (event.clientY / window.innerHeight) * 2 - 1;
    mouse.active = Math.abs(mouse.x) > 0.06 || Math.abs(mouse.y) > 0.06;
    mouse.lastMove = performance.now();
  }

  function onPointerDown() {
    pendingActions |= ACTION_CONFIRM;
    mouse.lastMove = performance.now();
  }

  function onBlur() {
    held.clear();
  }

  target.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('blur', onBlur);

  const any = (set) => {
    for (const code of set) if (held.has(code)) return true;
    return false;
  };

  /** Read the axes for one frame; the smoothing is the pilot's hand, not the airframe. */
  function read(dt) {
    let pitch = 0;
    let roll = 0;
    if (any(PITCH_UP)) pitch += 1;
    if (any(PITCH_DOWN)) pitch -= 1;
    if (any(ROLL_LEFT)) roll -= 1;
    if (any(ROLL_RIGHT)) roll += 1;

    // The mouse adds to the keys. Its authority fades if it has sat still away from centre, so the
    // stick recentres itself instead of holding a bank forever.
    if (!mouse.active) {
      const dead = 0.05;
      const ax = Math.abs(mouse.x) < dead ? 0 : (mouse.x - Math.sign(mouse.x) * dead) / (1 - dead);
      const ay = Math.abs(mouse.y) < dead ? 0 : (mouse.y - Math.sign(mouse.y) * dead) / (1 - dead);
      roll += ax;
      pitch -= ay;
    }

    const yaw = (any(YAW_RIGHT) ? 1 : 0) - (any(YAW_LEFT) ? 1 : 0);
    controls.steer = roll;

    const rate = 1 - Math.exp(-9 * dt);
    controls.pitch += (clamp(pitch, -1, 1) - controls.pitch) * rate;
    controls.roll += (clamp(roll, -1, 1) - controls.roll) * rate;
    controls.yaw += (yaw - controls.yaw) * rate;

    if (any(THROTTLE_UP)) controls.throttle = clamp(controls.throttle + dt * 0.85, 0, 1);
    if (any(THROTTLE_DOWN)) controls.throttle = clamp(controls.throttle - dt * 0.85, 0, 1);
    controls.brake = held.has('KeyB');
    return controls;
  }

  function takeActions() {
    const value = pendingActions;
    pendingActions = ACTION_NONE;
    return value;
  }

  function setMouseForShot(x, y) {
    mouse.x = x;
    mouse.y = y;
    mouse.active = true;
  }

  return { controls, read, takeActions, setMouseForShot, mouse };
}
