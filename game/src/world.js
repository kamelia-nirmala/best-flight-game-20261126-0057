// The sortie and everything in the world that is not terrain or aeroplane: six gold rings up the
// valley, the village strip with its mail drop circle, the beach strip, the smoke the volcano
// breathes, and the state machine that carries the pilot from taxi to touchdown. The legs are:
// fly the rings, drop the mail, then land at Pasir Panjang with the light going.

import { MISSION, PALETTE } from './config.js';
import { buildAircraftMesh } from './aircraft.js';
import { createBuilder, toMeshData } from './geometry.js';
import { clamp, deg, lerp } from './mathx.js';
import { PADS, buildTerrainMesh, dropPoint, heightAt, ringPath } from './terrain.js';
import { placeAt } from './renderer.js';

export const LEG_RINGS = 'rings';
export const LEG_DROP = 'drop';
export const LEG_LANDING = 'landing';

export const SORTIE_TAXI = 'taxi';
export const SORTIE_FLIGHT = 'flight';
export const SORTIE_ENDED = 'ended';

export function createWorld() {
  const rings = ringPath().map((ring, index) => ({
    index,
    center: ring.center,
    radius: MISSION.ringRadiusM,
    /** The horizontal direction the course runs at this ring: the gate stands across it. */
    axis: ring.axis,
    courseHeading: ring.courseHeading,
    passed: false,
  }));

  const state = {
    rings,
    ringIndex: 0,
    ringsCleared: 0,
    ringsMissed: 0,
    leg: LEG_RINGS,
    sortie: SORTIE_TAXI,
    clock: 0,
    remaining: MISSION.sortieSeconds,
    mailDropped: false,
    mailAccuracy: 0,
    dropPrompted: false,
    landingGrade: null,
    score: 0,
    messages: [],
    smoke: [],
    ringFlash: 0,
    missFlash: 0,
    ended: false,
    outcome: '',
    best: 0,
  };

  buildSmoke(state);
  return state;
}

/** Smoke columns: a handful of puffs per vent, each with its own rise and drift. */
function buildSmoke(state) {
  const vents = [
    { x: 300, z: -1180, count: 18, strength: 1.0 },
    { x: 150, z: -1585, count: 7, strength: 0.5 },
    { x: 236, z: -1530, count: 5, strength: 0.38 },
  ];
  for (const vent of vents) {
    const ground = heightAt(vent.x, vent.z);
    for (let i = 0; i < vent.count; i += 1) {
      state.smoke.push({
        origin: [vent.x + (i % 3) * 26 - 26, ground + 8 + (i % 4) * 6, vent.z + Math.floor(i / 3) * 22 - 30],
        phase: (i * 0.137) % 1,
        speed: 0.11 + (i % 5) * 0.013,
        rise: 170 + (i % 6) * 46,
        drift: 120 + (i % 4) * 40,
        size: 20 + (i % 5) * 8,
        strength: vent.strength,
      });
    }
  }
}

export function resetWorld(state, flight) {
  state.ringIndex = 0;
  state.ringsCleared = 0;
  state.ringsMissed = 0;
  state.leg = LEG_RINGS;
  state.sortie = SORTIE_TAXI;
  state.clock = 0;
  state.remaining = MISSION.sortieSeconds;
  state.mailDropped = false;
  state.mailAccuracy = 0;
  state.dropPrompted = false;
  state.landingGrade = null;
  state.score = 0;
  state.messages.length = 0;
  state.ringFlash = 0;
  state.missFlash = 0;
  state.ended = false;
  state.outcome = '';
  for (const ring of state.rings) ring.passed = false;
  if (flight) flight.touchdown = null;
}

export function announce(state, text, tone = 'info', seconds = 3.4) {
  state.messages.push({ text, tone, life: seconds, age: 0 });
  if (state.messages.length > 3) state.messages.shift();
}

/** Where the aeroplane crossed a ring's plane this step, and how far off the middle. The gate stands
 * across its own course, so the crossing is measured along that gate's axis: a gate facing north
 * cannot be crossed by sliding past it sideways. */
function ringCrossing(ring, prevPos, pos) {
  const center = ring.center;
  const axis = ring.axis;
  const prevD = (prevPos[0] - center[0]) * axis[0] + (prevPos[2] - center[2]) * axis[2];
  const d = (pos[0] - center[0]) * axis[0] + (pos[2] - center[2]) * axis[2];
  if (prevD === d || (prevD > 0) === (d > 0)) return null;
  const t = prevD / (prevD - d);
  const x = lerp(prevPos[0], pos[0], t);
  const y = lerp(prevPos[1], pos[1], t);
  const z = lerp(prevPos[2], pos[2], t);
  const across = (x - center[0]) * -axis[2] + (z - center[2]) * axis[0];
  const offset = Math.hypot(across, y - center[1]);
  return { offset, x, y };
}

/**
 * Advance the sortie by one step. Returns an event name when something worth a sound happened:
 * 'ring', 'miss', 'drop', 'land', 'crash', 'out', 'go'.
 */
export function stepWorld(state, flight, prevPosition, dt) {
  if (state.ended) return null;
  state.clock += dt;
  state.remaining = Math.max(0, state.remaining - dt);
  state.ringFlash = Math.max(0, state.ringFlash - dt * 1.6);
  state.missFlash = Math.max(0, state.missFlash - dt * 1.6);
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    state.messages[i].age += dt;
    if (state.messages[i].age >= state.messages[i].life) state.messages.splice(i, 1);
  }

  let event = null;

  if (state.sortie === SORTIE_TAXI) {
    if (!flight.onGround && flight.agl > 14) {
      state.sortie = SORTIE_FLIGHT;
      announce(state, 'AIRBORNE — SIX RINGS UP THE KAWAH VALLEY', 'accent', 4.6);
      event = 'go';
    }
  }

  // The rings.
  if (state.leg === LEG_RINGS && !flight.onGround) {
    const next = state.rings[state.ringIndex];
    if (next) {
      const crossing = ringCrossing(next, prevPosition, flight.position);
      if (crossing) {
        next.passed = true;
        state.ringIndex += 1;
        if (crossing.offset <= next.radius) {
          state.ringsCleared += 1;
          state.ringFlash = 1;
          state.score += 120;
          event = 'ring';
          announce(state, `RING ${state.ringsCleared}/${state.rings.length} CLEAN`, 'good', 2.4);
        } else {
          state.ringsMissed += 1;
          state.missFlash = 1;
          event = 'miss';
          announce(state, `RING MISSED — ${Math.round(crossing.offset - next.radius)} M WIDE`, 'warn', 2.6);
        }
      }
    }
    if (state.ringIndex >= state.rings.length) {
      state.leg = LEG_DROP;
      announce(state, 'RING RUN COMPLETE — MAIL DROP OVER KAWAH VILLAGE', 'good', 5.2);
    }
  }

  // The mail drop prompt: inside the circle, low enough and level.
  if (state.leg === LEG_DROP && !state.mailDropped && !state.dropPrompted) {
    const drop = dropPoint();
    const dist = Math.hypot(flight.position[0] - drop.x, flight.position[2] - drop.z);
    if (dist < drop.radius && flight.agl < MISSION.dropMaxAglFt * 0.3048 && Math.abs(deg(flight.roll)) <= MISSION.dropMaxBankDeg) {
      state.dropPrompted = true;
      announce(state, 'MAIL IN THE DOOR — PRESS SPACE TO DROP', 'accent', 5);
    }
  }

  if (flight.touchdown) {
    const td = flight.touchdown;
    flight.touchdown = null;
    // The grade is taken once: a bounce that re-touches must not overwrite a good landing with a
    // second card, and must not pay the points twice.
    if (state.mailDropped && !state.landingGrade) {
      state.landingGrade = gradeLanding(state, flight, td);
      state.score += state.landingGrade.points;
      event = 'land';
    } else if (!state.mailDropped && state.leg === LEG_RINGS) {
      announce(state, 'TOUCH AND GO — THE MAIL IS STILL ABOARD', 'warn', 3.2);
    } else if (!state.mailDropped) {
      announce(state, 'TOUCH AND GO — DROP THE MAIL FIRST', 'warn', 3.2);
    }
  }

  if (flight.crashed) {
    state.ended = true;
    state.outcome = 'crash';
    state.sortie = SORTIE_ENDED;
    return 'crash';
  }
  if (state.remaining <= 0) {
    state.ended = true;
    state.outcome = 'timeout';
    state.sortie = SORTIE_ENDED;
    return 'out';
  }
  if (state.landingGrade && flight.onGround && flight.groundSpeed < 5) {
    state.ended = true;
    state.outcome = 'landed';
    state.sortie = SORTIE_ENDED;
    return 'done';
  }
  return event;
}

/** Release the mail if the aeroplane is in the circle, low and level. */
export function releaseMail(state, flight) {
  if (state.mailDropped) return { ok: false, reason: 'already' };
  if (state.leg !== LEG_DROP) return { ok: false, reason: 'leg' };
  const drop = dropPoint();
  const dist = Math.hypot(flight.position[0] - drop.x, flight.position[2] - drop.z);
  if (dist > drop.radius) return { ok: false, reason: 'far' };
  if (flight.agl > MISSION.dropMaxAglFt * 0.3048) return { ok: false, reason: 'high' };
  if (Math.abs(deg(flight.roll)) > MISSION.dropMaxBankDeg) return { ok: false, reason: 'bank' };
  state.mailDropped = true;
  state.mailAccuracy = 1 - dist / drop.radius;
  state.score += 260 + Math.round(state.mailAccuracy * 140);
  state.leg = LEG_LANDING;
  announce(state, 'MAIL AWAY — NOW PUT HER DOWN AT PASIR PANJANG', 'good', 5.4);
  return { ok: true, reason: 'released' };
}

/** The landing card: sink rate, centreline and speed, each graded good / ok / hard. */
function gradeLanding(state, flight, td) {
  const pad = PADS.find((p) => p.id === 'beach');
  const heading = pad.runway.heading;
  const dx = flight.position[0] - pad.center[0];
  const dz = flight.position[2] - pad.center[2];
  const along = dx * Math.sin(heading) - dz * Math.cos(heading);
  const across = dx * Math.cos(heading) + dz * Math.sin(heading);
  const centreOffset = Math.abs(across);
  const onStrip = Math.abs(along) < pad.runway.length / 2 + 40 && centreOffset < pad.runway.width / 2 + 14;

  const sink = td.sink;
  const speedKt = td.groundSpeed * 1.94384;
  const sinkGrade = sink <= MISSION.sinkGood ? 'good' : sink <= MISSION.sinkOk ? 'ok' : 'hard';
  const centreGrade = centreOffset <= MISSION.centreGood ? 'good' : centreOffset <= MISSION.centreOk ? 'ok' : 'off';
  const speedGrade = speedKt <= MISSION.speedGoodKt ? 'good' : speedKt <= MISSION.speedOkKt ? 'ok' : 'hot';

  let points = 0;
  if (onStrip) points += 180;
  points += sinkGrade === 'good' ? 220 : sinkGrade === 'ok' ? 120 : 30;
  points += centreGrade === 'good' ? 160 : centreGrade === 'ok' ? 90 : 20;
  points += speedGrade === 'good' ? 120 : speedGrade === 'ok' ? 70 : 20;
  if (state.ringsMissed === 0 && state.ringsCleared === state.rings.length) points += 140;
  if (state.mailAccuracy > 0) points += Math.round(state.mailAccuracy * 120);

  const verdict = !onStrip ? 'OFF STRIP' : sinkGrade === 'hard' ? 'HARD LANDING' : points > 700 ? 'TEXTBOOK' : 'ACCEPTED';
  return { sink, centreOffset, speedKt, sinkGrade, centreGrade, speedGrade, onStrip, points, verdict };
}

/** Every static mesh the renderer needs: terrain, pads, rings, the aircraft and its prop. */
export function buildWorldMeshes(renderer) {
  const terrain = createBuilder();
  buildTerrainMesh(terrain);
  renderer.upload('terrain', toMeshData(terrain));

  const props = createBuilder();
  for (const pad of PADS) buildPad(props, pad);
  renderer.upload('props', toMeshData(props));

  const ringBuilder = createBuilder();
  ringBuilder.torus([0, 0, 0], MISSION.ringRadiusM, 2.6, PALETTE.ringGold, 44, 8);
  ringBuilder.torus([0, 0, 0], MISSION.ringRadiusM * 0.93, 1.0, PALETTE.ringInner, 44, 6);
  // Four fins out from the rim: the ring reads as a gate, not a halo.
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const r = MISSION.ringRadiusM + 7;
    const cx = Math.cos(angle) * r;
    const cy = Math.sin(angle) * r;
    ringBuilder.slab([cx, cy, 0], 5, 7, angle + Math.PI / 2, PALETTE.ringGold, 0);
  }
  renderer.upload('ring', toMeshData(ringBuilder));

  const marker = createBuilder();
  // The drop zone is a circle painted on the ground: the game's own 210 m radius, drawn as a wide
  // gold annulus with an inner hoop and a bullseye. A vertical torus a few metres across is
  // invisible from the shallow angle an approach is flown at, which is why the mail screenshots
  // had no gold in them at all. Built at the origin in the x-z plane so the draw list can place it
  // on the drop point with placeAt, the same way every other item is positioned.
  const dropRadius = dropPoint().radius;
  marker.annulus([0, 0, 0], dropRadius, dropRadius - 8, PALETTE.ringGold, 64);
  marker.annulus([0, 0, 0], dropRadius * 0.45, dropRadius * 0.45 - 5, PALETTE.ringGold, 48);
  marker.annulus([0, 0, 0], 16, 9, PALETTE.ringGold, 32);
  renderer.upload('dropRing', toMeshData(marker));

  const puff = createBuilder();
  puff.box([0, 0, 0], [1, 1, 1], [1, 1, 1]);
  renderer.upload('puff', toMeshData(puff));

  const hull = buildAircraftMesh(0);
  renderer.upload('aircraft', hull);

  const prop = createBuilder();
  for (let i = 0; i < 30; i += 1) {
    const a = (i / 30) * Math.PI * 2;
    prop.taperedBox(
      [Math.cos(a) * 0.8, Math.sin(a) * 0.8, 4.2],
      [Math.cos(a) * 0.8, Math.sin(a) * 0.8, 4.2],
      0.03,
      0.14,
      0.03,
      0.14,
      [0.3, 0.28, 0.26],
    );
  }
  renderer.upload('prop', toMeshData(prop));
}

function buildPad(builder, pad) {
  const runway = pad.runway;
  const h = pad.elevation;
  const c = Math.cos(runway.heading);
  const s = Math.sin(runway.heading);
  const at = (u, v, lift) => [pad.center[0] + u * c - v * s, h + lift, pad.center[2] + u * s + v * c];

  builder.slab([pad.center[0], h, pad.center[2]], runway.width / 2 + 6, runway.length / 2 + 8, runway.heading, PALETTE.rockLight, 0.06);
  builder.slab([pad.center[0], h, pad.center[2]], runway.width / 2, runway.length / 2, runway.heading, PALETTE.runway, 0.17);

  const dashes = 16;
  for (let i = 0; i < dashes; i += 1) {
    const v = -runway.length / 2 + 26 + (i * (runway.length - 52)) / (dashes - 1);
    builder.slab(at(0, v, 0.22), 0.75, 7.5, runway.heading, PALETTE.runwayMark, 0.22);
  }
  for (const end of [-1, 1]) {
    const v = end * (runway.length / 2 - 20);
    for (let bar = -3; bar <= 3; bar += 1) {
      if (bar === 0) continue;
      builder.slab(at(bar * (runway.width / 9), v, 0.22), 0.9, 8, runway.heading, PALETTE.runwayMark, 0.22);
    }
  }
  // The apron and its taxiway.
  const apronV = -runway.length / 2 + 70;
  builder.slab(at(runway.width / 2 + 26, apronV, 0.1), 15, 26, runway.heading, PALETTE.rockLight, 0.09);
  builder.slab(at(runway.width / 2 + 12, apronV, 0.1), 8, 5, runway.heading, PALETTE.rockLight, 0.09);

  if (pad.village) {
    // A few huts with red roofs, so the village reads from the air.
    const roofs = [
      [-140, -120, 0.4],
      [-176, -70, 1.1],
      [-120, -30, 0.2],
      [150, -150, 2.0],
      [186, -96, 1.4],
    ];
    for (const [u, v, angle] of roofs) {
      const x = pad.center[0] + u;
      const z = pad.center[2] + v;
      const g = heightAt(x, z);
      builder.box([x, g + 2.4, z], [9, 5, 7], PALETTE.hullCream);
      builder.taperedBox([x, g + 5.2, z], [x, g + 7.4, z], 10, 9, 1.2, 1.2, PALETTE.hullRed);
      builder.box([x, g + 5.4, z], [9.4, 0.5, 7.4], PALETTE.hullRed);
      void angle;
    }
    // A mast with a windsock: a small landmark for the approach.
    const mx = pad.center[0] - 60;
    const mz = pad.center[2] + 90;
    const mg = heightAt(mx, mz);
    builder.cylinder([mx, mg + 6, mz], 0.28, 12, PALETTE.hullDark, 8, 'y');
    builder.taperedBox([mx + 4, mg + 11, mz], [mx + 1, mg + 11, mz], 0.1, 2.2, 0.1, 1.2, PALETTE.hullRed);
  }
}

/** Assemble the per-frame draw list: terrain, pads, rings, the drop marker and the smoke. */
export function collectSceneItems(state, time, propAngle, flight) {
  const items = [];
  items.push({ mesh: 'terrain' });
  items.push({ mesh: 'props' });

  for (const ring of state.rings) {
    const isNext = ring.index === state.ringIndex;
    // The gate stands across its own course: turn the ring mesh so its face looks down the line.
    const model = placeAt(ring.center, ring.courseHeading, 1);
    if (ring.passed) {
      items.push({ mesh: 'ring', model, tint: [0.42, 0.44, 0.5], tintAmount: 1, alpha: 0.34 });
    } else {
      const glow = isNext ? 0.26 + Math.sin(time * 2.2) * 0.1 + state.ringFlash * 0.9 : 0.05;
      items.push({ mesh: 'ring', model, emissive: glow, alpha: 0.99 });
    }
  }

  if (!state.mailDropped) {
    const drop = dropPoint();
    items.push({
      mesh: 'dropRing',
      model: placeAt([drop.x, heightAt(drop.x, drop.z) + 1.4, drop.z], 0, 1),
      emissive: 0.2 + Math.sin(time * 3.1) * 0.07,
      alpha: 0.9,
    });
  }

  for (const puff of state.smoke) {
    const t = ((time * puff.speed + puff.phase) % 1 + 1) % 1;
    const rise = t * puff.rise;
    const drift = t * puff.drift;
    const size = puff.size * (1 + t * 2.8);
    const alpha = clamp((1 - t) * 0.46 * puff.strength + 0.02, 0, 0.5);
    items.push({
      mesh: 'puff',
      model: placeAt([puff.origin[0] + drift, puff.origin[1] + rise, puff.origin[2] + drift * 0.2], t * 1.4, size),
      tint: [0.66, 0.64, 0.63],
      tintAmount: 1,
      alpha,
    });
  }

  const body = placeAt(flight.position, flight.heading, 1, flight.pitch, -flight.roll);
  items.push({ mesh: 'aircraft', model: body });
  items.push({ mesh: 'prop', model: spinAboutNose(body, propAngle), alpha: 0.16 });

  return items;
}

/** The prop's matrix: the body's rotation, spun about its own nose axis. */
function spinAboutNose(body, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const local = new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        body[row] * local[col * 4] +
        body[4 + row] * local[col * 4 + 1] +
        body[8 + row] * local[col * 4 + 2] +
        body[12 + row] * local[col * 4 + 3];
    }
  }
  return out;
}

/** The next ring's bearing and range from the aeroplane, for the HUD's director. */
export function nextRingInfo(state, flight) {
  const ring = state.rings[state.ringIndex];
  if (!ring) return null;
  const dx = ring.center[0] - flight.position[0];
  const dz = ring.center[2] - flight.position[2];
  const dy = ring.center[1] - flight.position[1];
  const range = Math.hypot(dx, dz, dy);
  let bearing = Math.atan2(dx, -dz) * (180 / Math.PI);
  if (bearing < 0) bearing += 360;
  return { ring, range, bearing, dy };
}
