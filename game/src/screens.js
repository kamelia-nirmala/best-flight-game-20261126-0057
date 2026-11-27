// The screens around the flying: the title with the sortie brief and the controls, the pause card,
// and the landing card that grades the touchdown. Drawn on the same overlay canvas as the HUD, in
// the same ink, so the game reads as one piece of equipment rather than a menu stuck on top.

import { HUD, VIEW } from './config.js';
import { roundRectPath, wrapText } from './typeface.js';

const BRIEF = [
  'Six gold rings climb the Kawah valley, then the mail goes out over',
  'the village strip, and then the landing at Pasir Panjang — one engine,',
  'one tank, and the light going.',
];

const CONTROLS = [
  ['MOUSE / W S', 'pitch'],
  ['MOUSE / A D', 'roll'],
  ['Q E', 'rudder'],
  ['SHIFT / CTRL', 'throttle'],
  ['C', 'camera — chase · cockpit · wing'],
  ['G  ·  F', 'gear · flaps'],
  ['SPACE', 'release the mail'],
  ['P  ·  R', 'pause · restart'],
];

/** The title card: name, one-line premise, the brief, the controls, and the invitation. */
export function drawTitle(context, best) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, VIEW.width, VIEW.height);

  // A scrim only behind the text column, so the aeroplane and the valley stay visible.
  const panelX = 96;
  const panelY = 128;
  const panelW = 700;
  const panelH = 452;
  const gradient = context.createLinearGradient(panelX, 0, panelX + panelW, 0);
  gradient.addColorStop(0, 'rgba(8,11,17,0.82)');
  gradient.addColorStop(0.78, 'rgba(8,11,17,0.62)');
  gradient.addColorStop(1, 'rgba(8,11,17,0.0)');
  context.fillStyle = gradient;
  context.fillRect(panelX, panelY, panelW, panelH);

  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';

  context.fillStyle = HUD.accent;
  context.font = `700 13px ${HUD.font}`;
  context.fillText('KAWAH ARCHIPELAGO · 06:12 LOCAL', panelX + 40, panelY + 52);

  context.fillStyle = HUD.ink;
  context.font = `700 76px ${HUD.font}`;
  context.fillText('ASHFALL', panelX + 36, panelY + 128);
  context.font = `300 76px ${HUD.font}`;
  context.fillStyle = HUD.accent;
  context.fillText('COURIER', panelX + 40, panelY + 200);

  context.fillStyle = HUD.ink;
  context.font = `400 22px ${HUD.font}`;
  context.fillText('A bush-pilot mail run over a live volcano.', panelX + 40, panelY + 240);

  context.fillStyle = 'rgba(238,243,250,0.72)';
  context.font = `400 16px ${HUD.font}`;
  let lineY = panelY + 276;
  for (const line of BRIEF) {
    context.fillText(line, panelX + 40, lineY);
    lineY += 23;
  }

  // Controls, in two columns of label/value pairs.
  context.font = `700 12px ${HUD.font}`;
  context.fillStyle = HUD.dim;
  context.fillText('CONTROLS', panelX + 40, lineY + 28);
  let keyY = lineY + 52;
  for (let i = 0; i < CONTROLS.length; i += 1) {
    const column = i < 4 ? 0 : 1;
    const row = i % 4;
    const kx = panelX + 40 + column * 300;
    const ky = keyY + row * 22;
    context.font = `700 12px ${HUD.mono}`;
    context.fillStyle = HUD.ink;
    context.fillText(CONTROLS[i][0], kx, ky);
    context.font = `400 12px ${HUD.font}`;
    context.fillStyle = 'rgba(238,243,250,0.62)';
    context.fillText(CONTROLS[i][1], kx + 118, ky);
  }

  // The invitation, pulsing gently.
  const pulse = 0.72 + 0.28 * Math.sin(performance.now() / 520);
  context.globalAlpha = pulse;
  context.fillStyle = HUD.accent;
  context.font = `700 20px ${HUD.font}`;
  context.fillText('PRESS SPACE OR CLICK TO FLY', panelX + 40, panelY + panelH - 34);
  context.globalAlpha = 1;

  if (best > 0) {
    context.font = `700 13px ${HUD.mono}`;
    context.fillStyle = HUD.dim;
    context.textAlign = 'right';
    context.fillText(`BEST SORTIE ${String(best).padStart(4, '0')}`, VIEW.width - 96, panelY + panelH - 34);
  }
}

/** The pause card, small and centred. */
export function drawPause(context) {
  const cx = VIEW.width / 2;
  const cy = VIEW.height / 2;
  context.fillStyle = 'rgba(6,9,14,0.55)';
  context.fillRect(0, 0, VIEW.width, VIEW.height);
  context.fillStyle = 'rgba(9,13,20,0.9)';
  roundRectPath(context, cx - 190, cy - 74, 380, 148, 6);
  context.fill();
  context.strokeStyle = HUD.panelEdge;
  context.stroke();
  context.textAlign = 'center';
  context.fillStyle = HUD.ink;
  context.font = `700 34px ${HUD.font}`;
  context.fillText('PAUSED', cx, cy - 16);
  context.font = `400 15px ${HUD.font}`;
  context.fillStyle = HUD.dim;
  context.fillText('P to resume · R to restart', cx, cy + 22);
  context.fillText('C to change view', cx, cy + 46);
}

function gradeColor(grade) {
  if (grade === 'good') return HUD.good;
  if (grade === 'ok') return HUD.accent;
  return HUD.warn;
}

/** The landing card: the three numbers that were graded, the verdict, and the total. */
export function drawResult(context, state, flight) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = 'rgba(6,9,14,0.42)';
  context.fillRect(0, 0, VIEW.width, VIEW.height);

  const cx = VIEW.width / 2;
  const w = 620;
  const h = 400;
  const x = cx - w / 2;
  const y = 150;
  context.fillStyle = 'rgba(9,13,20,0.92)';
  roundRectPath(context, x, y, w, h, 8);
  context.fill();
  context.strokeStyle = HUD.panelEdge;
  context.lineWidth = 1;
  context.stroke();

  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';

  const crashed = state.outcome === 'crash';
  context.fillStyle = crashed ? HUD.warn : HUD.accent;
  context.font = `700 13px ${HUD.font}`;
  context.fillText(crashed ? 'SORTIE LOST' : 'SORTIE COMPLETE', x + 40, y + 46);

  context.fillStyle = HUD.ink;
  context.font = `700 44px ${HUD.font}`;
  context.fillText(crashed ? (flight.crashReason || 'Lost on the mountain') : state.landingGrade ? state.landingGrade.verdict : 'SORTIE ENDED', x + 36, y + 96);

  let rowY = y + 140;
  const rows = [];
  if (state.landingGrade) {
    const g = state.landingGrade;
    rows.push(['TOUCHDOWN SINK', `${g.sink.toFixed(1)} m/s`, g.sinkGrade, `${(g.sink * 196.85).toFixed(0)} fpm`]);
    rows.push(['CENTRELINE', `${g.centreOffset.toFixed(1)} m off`, g.centreGrade, g.onStrip ? 'on the strip' : 'off the strip']);
    rows.push(['APPROACH SPEED', `${g.speedKt.toFixed(0)} kt`, g.speedGrade, 'at the wheels']);
  }
  rows.push(['RINGS', `${state.ringsCleared} / ${state.rings.length}`, state.ringsMissed === 0 ? 'good' : 'ok', state.ringsMissed > 0 ? `${state.ringsMissed} missed` : 'all clean']);
  rows.push(['MAIL DROP', state.mailDropped ? `${Math.round(state.mailAccuracy * 100)}% on target` : 'not dropped', state.mailDropped ? 'good' : 'hard', state.mailDropped ? 'in the circle' : 'still aboard']);

  for (const [label, value, grade, note] of rows) {
    context.font = `700 13px ${HUD.font}`;
    context.fillStyle = HUD.dim;
    context.fillText(label, x + 40, rowY);
    context.font = `700 18px ${HUD.mono}`;
    context.fillStyle = HUD.ink;
    context.fillText(value, x + 232, rowY);
    context.font = `400 13px ${HUD.font}`;
    context.fillStyle = 'rgba(238,243,250,0.55)';
    context.fillText(note, x + 420, rowY);
    context.fillStyle = gradeColor(grade);
    context.fillRect(x + w - 62, rowY - 11, 22, 12);
    rowY += 42;
  }

  context.strokeStyle = 'rgba(238,243,250,0.14)';
  context.beginPath();
  context.moveTo(x + 40, y + h - 96);
  context.lineTo(x + w - 40, y + h - 96);
  context.stroke();

  context.font = `700 13px ${HUD.font}`;
  context.fillStyle = HUD.dim;
  context.fillText('SORTIE', x + 40, y + h - 58);
  context.font = `700 46px ${HUD.mono}`;
  context.fillStyle = HUD.gold;
  context.fillText(String(state.score).padStart(4, '0'), x + 36, y + h - 14);

  if (state.best > 0) {
    context.font = `700 13px ${HUD.mono}`;
    context.fillStyle = HUD.dim;
    context.textAlign = 'right';
    context.fillText(`BEST ${String(state.best).padStart(4, '0')}`, x + w - 40, y + h - 58);
    context.font = `700 15px ${HUD.font}`;
    context.fillStyle = HUD.accent;
    context.fillText('PRESS R TO FLY AGAIN', x + w - 40, y + h - 20);
  }
}

void wrapText;
