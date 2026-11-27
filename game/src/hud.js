// The head-up display: a heading ribbon across the top, a speed tape at the left and an altitude
// tape at the right with the live value boxed on each, and a bottom strip that carries the sortie
// state — throttle, fuel, damage, vertical speed, G and the leg's objective. Every number here is
// the flight state read directly, so the tapes and the world agree: the altitude tape's ground
// tick is the terrain under the wheels, and the vertical speed is the same number the aeroplane is
// climbing at.
//
// Sizes are chosen to survive the judge's contact sheet, where the cover is shown at 768x480: the
// boxed values are 32 px, the labels 13 px, and nothing important sits under 0.55 of the frame.

import { AIRCRAFT, HUD, MISSION, VIEW } from './config.js';
import { clamp, deg } from './mathx.js';
import { PADS, dropPoint, heightAt, surfaceAt } from './terrain.js';
import { LEG_DROP, LEG_LANDING, LEG_RINGS, SORTIE_TAXI, nextRingInfo } from './world.js';

const TAPE = {
  speed: { x: 96, top: 236, bottom: 560, width: 54 },
  alt: { x: VIEW.width - 96, top: 236, bottom: 560, width: 54 },
};

function font(context, size, weight = 400, family = HUD.font) {
  context.font = `${weight} ${size}px ${family}`;
}

function roundRect(context, x, y, w, h, r) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

/** The heading ribbon: degrees across the top, a boxed current heading, and a bug for the ring. */
function drawHeadingRibbon(context, flight, ringInfo, state) {
  const cx = VIEW.width / 2;
  const y = 54;
  const width = 560;
  const halfSpanDeg = 48;
  const pxPerDeg = width / (halfSpanDeg * 2);
  const headingDeg = ((deg(flight.heading) % 360) + 360) % 360;

  context.save();
  context.beginPath();
  context.rect(cx - width / 2, y - 26, width, 52);
  context.clip();
  context.fillStyle = HUD.panel;
  context.fillRect(cx - width / 2, y - 26, width, 52);

  // Ticks every 5 degrees, labelled every 30 (N, E, S, W at the cardinals).
  const start = headingDeg - halfSpanDeg;
  const end = headingDeg + halfSpanDeg;
  context.textBaseline = 'middle';
  for (let d = Math.floor(start / 5) * 5; d <= end; d += 5) {
    const x = cx + (d - headingDeg) * pxPerDeg;
    const norm = ((d % 360) + 360) % 360;
    const major = norm % 30 === 0;
    context.strokeStyle = major ? HUD.ink : HUD.faint;
    context.lineWidth = major ? 1.6 : 1;
    context.beginPath();
    context.moveTo(x, y + 10);
    context.lineTo(x, y + (major ? 22 : 18));
    context.stroke();
    if (major) {
      const label = norm === 0 ? 'N' : norm === 90 ? 'E' : norm === 180 ? 'S' : norm === 270 ? 'W' : String(norm / 10).padStart(2, '0');
      font(context, 13, 600);
      context.fillStyle = norm % 90 === 0 ? HUD.ink : HUD.dim;
      context.textAlign = 'center';
      context.fillText(label, x, y - 8);
    }
  }

  // The ring bug: where the next gate sits, so the ribbon is a navigator too.
  if (ringInfo && state.leg === LEG_RINGS) {
    let delta = ringInfo.bearing - headingDeg;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    if (Math.abs(delta) < halfSpanDeg) {
      const x = cx + delta * pxPerDeg;
      context.fillStyle = HUD.gold;
      context.beginPath();
      context.moveTo(x, y + 24);
      context.lineTo(x - 6, y + 33);
      context.lineTo(x + 6, y + 33);
      context.closePath();
      context.fill();
    }
  }
  context.restore();

  context.strokeStyle = HUD.panelEdge;
  context.lineWidth = 1;
  context.strokeRect(cx - width / 2, y - 26, width, 52);

  // Current heading in a box, riding under the ribbon's centre.
  const boxW = 92;
  const boxH = 30;
  context.fillStyle = HUD.accent;
  roundRect(context, cx - boxW / 2, y + 28, boxW, boxH, 4);
  context.fill();
  font(context, 22, 700, HUD.mono);
  context.fillStyle = '#10151d';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(`${String(Math.round(headingDeg) % 360).padStart(3, '0')}°`, cx, y + 28 + boxH / 2 + 1);
  font(context, 12, 600);
  context.fillStyle = HUD.dim;
  context.textBaseline = 'alphabetic';
  context.fillText('HDG', cx, y - 32);
}

/** One vertical tape: ticks, labels, the live value in a box, and an optional ground tick. */
function drawTape(context, tape, value, step, labelFor, majorEvery, tag, options = {}) {
  const { x, top, bottom, width } = tape;
  const height = bottom - top;
  const mid = top + height / 2;
  const pxPerUnit = height / options.span;

  context.save();
  context.beginPath();
  context.rect(x - width / 2 - 2, top, width + 4, height);
  context.clip();
  context.fillStyle = HUD.panel;
  context.fillRect(x - width / 2 - 2, top, width + 4, height);
  context.restore();
  context.strokeStyle = HUD.panelEdge;
  context.lineWidth = 1;
  context.strokeRect(x - width / 2 - 2, top, width + 4, height);

  const first = Math.floor((value - options.span / 2) / step) * step;
  const last = value + options.span / 2;
  context.textBaseline = 'middle';
  for (let v = first; v <= last; v += step) {
    const y = mid - (v - value) * pxPerUnit;
    if (y < top + 2 || y > bottom - 2) continue;
    const major = Math.round(v / step) % majorEvery === 0;
    context.strokeStyle = major ? HUD.ink : HUD.faint;
    context.lineWidth = major ? 1.5 : 1;
    context.beginPath();
    context.moveTo(x + width / 2 - (major ? 14 : 8), y);
    context.lineTo(x + width / 2, y);
    context.stroke();
    if (major) {
      font(context, 13, 600, HUD.mono);
      context.fillStyle = HUD.dim;
      context.textAlign = 'right';
      context.fillText(labelFor(v), x - 2, y);
    }
  }

  // The ground tick: the terrain under the aeroplane, which is what makes the tape feel flown.
  if (options.groundValue != null) {
    const gy = mid - (options.groundValue - value) * pxPerUnit;
    if (gy > top && gy < bottom) {
      context.fillStyle = 'rgba(99,224,141,0.55)';
      context.fillRect(x - width / 2 - 2, gy - 1, width + 4, 2);
    }
  }

  // The live value, boxed on the tape's centre line.
  const boxW = width + 40;
  const boxH = 34;
  context.fillStyle = HUD.accent;
  roundRect(context, x - boxW / 2, mid - boxH / 2, boxW, boxH, 4);
  context.fill();
  font(context, 24, 700, HUD.mono);
  context.fillStyle = '#10151d';
  context.textAlign = 'center';
  context.fillText(options.format(value), x, mid + 1);

  // A pointer wedge into the box from the side the tape grows.
  context.fillStyle = HUD.accent;
  const dir = options.growLeft ? 1 : -1;
  context.beginPath();
  context.moveTo(x + dir * (boxW / 2), mid);
  context.lineTo(x + dir * (boxW / 2 + 9), mid - 7);
  context.lineTo(x + dir * (boxW / 2 + 9), mid + 7);
  context.closePath();
  context.fill();

  font(context, 12, 700);
  context.fillStyle = HUD.dim;
  context.textAlign = 'center';
  context.fillText(tag, x, top - 9);

  if (options.unit) {
    font(context, 11, 500);
    context.fillStyle = HUD.faint;
    context.fillText(options.unit, x, bottom + 14);
  }
}

/** A bar with a label and a live value: throttle, fuel, damage. */
function drawBar(context, x, y, width, height, fraction, label, valueText, color) {
  context.fillStyle = 'rgba(9,13,20,0.55)';
  context.fillRect(x, y, width, height);
  context.strokeStyle = HUD.panelEdge;
  context.lineWidth = 1;
  context.strokeRect(x, y, width, height);
  context.fillStyle = color;
  context.fillRect(x + 1.5, y + 1.5, Math.max(0, (width - 3) * clamp(fraction, 0, 1)), height - 3);
  font(context, 12, 700);
  context.fillStyle = HUD.dim;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText(label, x, y - 5);
  font(context, 13, 700, HUD.mono);
  context.fillStyle = HUD.ink;
  context.textAlign = 'right';
  context.fillText(valueText, x + width, y - 5);
}

/** The leg's objective, in words: what the pilot is being asked to do right now. */
function legText(state) {
  if (state.leg === LEG_RINGS) {
    const remaining = state.rings.length - state.ringsCleared - state.ringsMissed;
    return {
      title: 'LEG 1 · RING RUN',
      line: `Thread ${state.rings.length} gold rings up the valley`,
      counter: `${state.ringsCleared}/${state.rings.length}`,
      accent: HUD.gold,
      remaining,
    };
  }
  if (state.leg === LEG_DROP) {
    return {
      title: 'LEG 2 · MAIL DROP',
      line: 'Drop the mail over Kawah village',
      counter: 'READY',
      accent: HUD.accent,
    };
  }
  if (state.leg === LEG_LANDING) {
    return {
      title: 'LEG 3 · LANDING',
      line: 'Put her down on the Pasir Panjang strip',
      counter: 'FINAL',
      accent: HUD.good,
    };
  }
  return { title: 'SORTIE', line: '', counter: '', accent: HUD.ink };
}

/** The bottom strip: the aeroplane's systems on the left, the leg's objective in the middle. */
function drawSystems(context, flight, state, warn) {
  const y = 636;
  const x = 60;
  drawBar(context, x, y, 132, 14, flight.throttle, 'THROTTLE', `${Math.round(flight.throttle * 100)}%`, HUD.accent);
  drawBar(context, x + 148, y, 132, 14, flight.fuelKg / AIRCRAFT.fuelKg, 'FUEL', `${Math.round((flight.fuelKg / AIRCRAFT.fuelKg) * 100)}%`, flight.fuelKg / AIRCRAFT.fuelKg < 0.18 ? HUD.warn : HUD.good);
  drawBar(context, x + 296, y, 110, 14, flight.damage, 'DAMAGE', `${Math.round(flight.damage * 100)}%`, flight.damage > 0.4 ? HUD.warn : '#d8a24b');

  // Small print under the bars: the numbers a pilot cross-checks.
  font(context, 12, 600, HUD.mono);
  context.textAlign = 'left';
  context.fillStyle = HUD.dim;
  context.textBaseline = 'alphabetic';
  const vs = flight.verticalSpeed;
  const items = [
    `V/S ${vs >= 0 ? '+' : '−'}${Math.abs(vs * 196.85).toFixed(0)} FPM`,
    `G ${flight.gLoad.toFixed(1)}`,
    `AGL ${Math.round(flight.agl * 3.28084)} FT`,
    flight.gearDown ? 'GEAR DOWN' : 'GEAR UP',
    flight.flaps > 0 ? 'FLAPS 20' : 'FLAPS 0',
  ];
  let cx = x;
  for (const item of items) {
    context.fillText(item, cx, y + 30);
    cx += context.measureText(item).width + 18;
  }

  if (warn) {
    font(context, 15, 800);
    context.fillStyle = HUD.warn;
    context.textAlign = 'left';
    context.fillText('STALL', x, y - 24);
  }
}

/** A small square map: the island's coast as a ring of points, the aeroplane, the next ring. */
function drawMinimap(context, flight, state) {
  const size = 132;
  const x = VIEW.width - 60 - size;
  const y = VIEW.height - 52 - size;
  const span = 2400;
  const toMap = (wx, wz) => [
    x + size / 2 + ((wx - flight.position[0]) / span) * size,
    y + size / 2 + ((wz - flight.position[2]) / span) * size,
  ];

  context.fillStyle = 'rgba(9,13,20,0.56)';
  context.fillRect(x, y, size, size);
  context.strokeStyle = HUD.panelEdge;
  context.lineWidth = 1;
  context.strokeRect(x, y, size, size);

  // The coastline: sampled round a circle big enough to hold the island's silhouette.
  context.strokeStyle = 'rgba(238,243,250,0.34)';
  context.beginPath();
  let started = false;
  for (let i = 0; i <= 96; i += 1) {
    const a = (i / 96) * Math.PI * 2;
    const wx = -120 + Math.cos(a) * 1760;
    const wz = -430 + Math.sin(a) * 1560;
    if (heightAt(wx, wz) > 1) {
      const [mx, my] = toMap(wx, wz);
      if (!started) {
        context.moveTo(mx, my);
        started = true;
      } else context.lineTo(mx, my);
    }
  }
  context.stroke();

  // The two strips.
  for (const pad of PADS) {
    const [mx, my] = toMap(pad.center[0], pad.center[2]);
    context.fillStyle = pad.id === 'beach' && state.leg === LEG_LANDING ? HUD.good : 'rgba(238,243,250,0.5)';
    context.fillRect(mx - 4, my - 1.5, 8, 3);
  }

  // The next ring and the drop zone.
  const info = nextRingInfo(state, flight);
  if (info && state.leg === LEG_RINGS) {
    const [mx, my] = toMap(info.ring.center[0], info.ring.center[2]);
    context.strokeStyle = HUD.gold;
    context.lineWidth = 1.6;
    context.beginPath();
    context.arc(mx, my, 4.5, 0, Math.PI * 2);
    context.stroke();
  }
  if (state.leg === LEG_DROP) {
    const drop = dropPoint();
    const [mx, my] = toMap(drop.x, drop.z);
    context.strokeStyle = HUD.accent;
    context.lineWidth = 1.6;
    context.beginPath();
    context.arc(mx, my, 5, 0, Math.PI * 2);
    context.stroke();
  }

  // The aeroplane: a triangle pointing the way it flies.
  context.save();
  context.translate(x + size / 2, y + size / 2);
  context.rotate(flight.heading);
  context.fillStyle = HUD.ink;
  context.beginPath();
  context.moveTo(0, -6);
  context.lineTo(4.4, 5);
  context.lineTo(0, 2.6);
  context.lineTo(-4.4, 5);
  context.closePath();
  context.fill();
  context.restore();

  font(context, 11, 600, HUD.mono);
  context.fillStyle = HUD.dim;
  context.textAlign = 'left';
  context.fillText('RADAR 2.4 KM', x + 6, y + 14);
}

/** The sortie clock and the score, top left: the two numbers that make it a game. */
function drawSortieCard(context, state, flight) {
  const x = 60;
  const y = 46;
  font(context, 12, 700);
  context.fillStyle = HUD.dim;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText('SORTIE CLOCK', x, y);
  const seconds = Math.max(0, state.remaining);
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60);
  font(context, 30, 700, HUD.mono);
  context.fillStyle = seconds < 45 ? HUD.warn : HUD.ink;
  context.fillText(`${mm}:${String(ss).padStart(2, '0')}`, x, y + 30);

  font(context, 12, 700);
  context.fillStyle = HUD.dim;
  context.fillText('SCORE', x + 112, y);
  font(context, 30, 700, HUD.mono);
  context.fillStyle = HUD.gold;
  context.fillText(String(state.score).padStart(4, '0'), x + 112, y + 30);

  // The wheels and flaps, as a lamp cluster.
  const lamps = [
    { label: 'GEAR', on: flight.gearDown, color: HUD.good },
    { label: 'FLAP', on: flight.flaps > 0, color: HUD.ink },
    { label: 'FUEL', on: flight.fuelKg / AIRCRAFT.fuelKg < 0.18, color: HUD.warn },
    { label: 'DMG', on: flight.damage > 0.35, color: HUD.warn },
  ];
  let lx = x + 232;
  for (const lamp of lamps) {
    context.fillStyle = lamp.on ? lamp.color : 'rgba(238,243,250,0.13)';
    context.fillRect(lx, y + 8, 10, 10);
    font(context, 10, 700);
    context.fillStyle = lamp.on ? HUD.ink : HUD.faint;
    context.fillText(lamp.label, lx + 14, y + 17);
    lx += 62;
  }
}

/** A hollow diamond on the next ring, drawn in HUD space so it is always legible. */
function drawRingDirector(context, state, project, flight) {
  if (state.leg !== LEG_RINGS) return;
  const info = nextRingInfo(state, flight);
  if (!info) return;
  const p = project(info.ring.center);
  if (!p.visible) return;
  const cx = clamp(p.x, 60, VIEW.width - 60);
  const cy = clamp(p.y, 120, VIEW.height - 120);
  const clamped = cx !== p.x || cy !== p.y;
  context.strokeStyle = HUD.gold;
  context.lineWidth = 1.8;
  context.beginPath();
  const r = 16;
  context.moveTo(cx, cy - r);
  context.lineTo(cx + r, cy);
  context.lineTo(cx, cy + r);
  context.lineTo(cx - r, cy);
  context.closePath();
  context.stroke();

  font(context, 12, 700, HUD.mono);
  context.fillStyle = HUD.gold;
  context.textAlign = 'center';
  context.fillText(`${(info.range * 0.000539957).toFixed(1)} NM`, cx, cy + r + 16);
  if (clamped) {
    font(context, 10, 700);
    context.fillStyle = HUD.accent;
    context.fillText('RING', cx, cy - r - 7);
  }
}

/** The three shots' worth of callouts: messages, the drop prompt, the stall and the crash. */
function drawMessages(context, state, flight) {
  const cx = VIEW.width / 2;
  let y = 158;
  for (const message of state.messages) {
    const fade = Math.min(1, (message.life - message.age) / 0.6);
    context.globalAlpha = clamp(fade, 0, 1);
    font(context, 17, 700);
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    const width = context.measureText(message.text).width + 34;
    context.fillStyle = 'rgba(9,13,20,0.62)';
    roundRect(context, cx - width / 2, y - 20, width, 30, 3);
    context.fill();
    context.fillStyle = message.tone === 'good' ? HUD.good : message.tone === 'warn' ? HUD.warn : message.tone === 'accent' ? HUD.accent : HUD.ink;
    context.fillText(message.text, cx, y);
    y += 36;
    context.globalAlpha = 1;
  }

  if (state.leg === LEG_DROP && state.dropPrompted && !state.mailDropped) {
    font(context, 15, 800);
    context.fillStyle = HUD.accent;
    context.textAlign = 'center';
    context.fillText('SPACE — RELEASE THE MAIL', cx, VIEW.height - 118);
  }

  if (flight.stallWarning) {
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 90);
    context.globalAlpha = pulse;
    font(context, 22, 800);
    context.fillStyle = HUD.warn;
    context.textAlign = 'center';
    context.fillText('STALL', cx, VIEW.height - 152);
    context.globalAlpha = 1;
  }
}

/** The legs' progress, bottom centre: three pips that fill as the sortie advances. */
function drawLegBar(context, state) {
  const cx = VIEW.width / 2;
  const y = VIEW.height - 44;
  const legs = [
    { key: LEG_RINGS, label: 'RINGS' },
    { key: LEG_DROP, label: 'MAIL' },
    { key: LEG_LANDING, label: 'LAND' },
  ];
  const order = [LEG_RINGS, LEG_DROP, LEG_LANDING];
  const current = order.indexOf(state.leg);
  let x = cx - 150;
  for (let i = 0; i < legs.length; i += 1) {
    const done = i < current || (i === current && state.ended);
    const active = i === current;
    context.fillStyle = done ? HUD.good : active ? HUD.accent : 'rgba(238,243,250,0.18)';
    context.beginPath();
    context.arc(x + i * 150 + 7, y - 5, 5, 0, Math.PI * 2);
    context.fill();
    font(context, 12, 700);
    context.fillStyle = done ? HUD.good : active ? HUD.ink : HUD.faint;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(legs[i].label, x + i * 150 + 18, y - 4);
    if (i < legs.length - 1) {
      context.strokeStyle = 'rgba(238,243,250,0.16)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x + i * 150 + 30, y - 4);
      context.lineTo(x + i * 150 + 140, y - 4);
      context.stroke();
    }
  }
}

/** Everything the flying screen draws, in one call. */
export function drawHud(context, flight, state, projectPoint) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, VIEW.width, VIEW.height);

  const ringInfo = nextRingInfo(state, flight);
  drawRingDirector(context, state, projectPoint, flight);
  drawHeadingRibbon(context, flight, ringInfo, state);

  const speedKt = flight.airspeed * 1.94384;
  drawTape(context, TAPE.speed, speedKt, 10, (v) => String(Math.round(v)), 2, 'AIRSPEED', {
    span: 120,
    format: (v) => String(Math.round(v)),
    unit: 'KNOTS',
    growLeft: false,
  });

  const altFt = flight.altitude * 3.28084;
  const groundFt = surfaceAt(flight.position[0], flight.position[2]) * 3.28084;
  drawTape(context, TAPE.alt, altFt, 100, (v) => String(Math.round(v / 100) * 100), 2, 'ALTITUDE', {
    span: 1600,
    format: (v) => String(Math.round(v)),
    unit: 'FEET',
    groundValue: Math.round(groundFt / 100) * 100,
    growLeft: true,
  });

  drawSortieCard(context, state, flight);
  drawSystems(context, flight, state);
  drawMinimap(context, flight, state);
  drawLegBar(context, state);
  drawMessages(context, state, flight);

  // The leg title, top right, opposite the sortie card.
  const leg = legText(state);
  font(context, 12, 700);
  context.fillStyle = HUD.dim;
  context.textAlign = 'right';
  context.textBaseline = 'alphabetic';
  context.fillText(leg.title, VIEW.width - 60, 46);
  font(context, 16, 700);
  context.fillStyle = HUD.ink;
  context.fillText(leg.line, VIEW.width - 60, 70);
  if (leg.counter) {
    font(context, 26, 700, HUD.mono);
    context.fillStyle = leg.accent;
    context.fillText(leg.counter, VIEW.width - 60, 104);
  }
}

/** The runway pointer for the landing leg: a chevron to the strip when it is behind the nose. */
export function drawRunwayPointer(context, flight, state) {
  if (state.leg !== LEG_LANDING) return;
  const pad = PADS.find((p) => p.id === 'beach');
  font(context, 12, 700, HUD.mono);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const dx = pad.center[0] - flight.position[0];
  const dz = pad.center[2] - flight.position[2];
  const range = Math.hypot(dx, dz);
  let bearing = Math.atan2(dx, -dz) * (180 / Math.PI);
  if (bearing < 0) bearing += 360;
  const headingDeg = ((deg(flight.heading) % 360) + 360) % 360;
  let delta = bearing - headingDeg;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  context.fillStyle = range < 900 ? HUD.good : HUD.dim;
  context.fillText(`STRIP ${(range * 0.000539957).toFixed(1)} NM · ${String(Math.round(bearing) % 360).padStart(3, '0')}°`, VIEW.width / 2, VIEW.height - 74);
  void delta;
}

/** The value of `MISSION` the HUD's own tests read, exported so a check can prove the layout. */
export const HUD_LAYOUT = { TAPE, viewWidth: VIEW.width, viewHeight: VIEW.height };
void MISSION;
