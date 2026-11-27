// The aeroplane, built from primitives: a tapered fuselage with a raised cabin, a high wing with
// dihedral, struts, a tailplane and fin, a spinner and a two-blade prop, fixed gear with tundra
// tyres, and a red cheatline down the flank. The nose points along +Z and the machine is drawn at
// roughly 9.2 m long and 12 m across the wings, which is a real bush plane's size next to a 40 m
// runway.

import { PALETTE } from './config.js';
import { createBuilder, toMeshData } from './geometry.js';

export function buildAircraftMesh(propAngle = 0) {
  const builder = createBuilder();
  const cream = PALETTE.hullCream;
  const red = PALETTE.hullRed;
  const dark = PALETTE.hullDark;
  const glass = PALETTE.glass;

  // Fuselage: nose at z=+4.1, tail at z=-4.6, widening at the cabin then tapering to the tail post.
  builder.taperedBox([0, 0, 4.05], [0, 0.02, -0.6], 1.05, 1.0, 1.42, 1.34, cream);
  builder.taperedBox([0, 0.02, -0.6], [0, 0.30, -4.55], 1.42, 1.34, 0.34, 0.46, cream);
  // A darker belly pan breaks up the flat cream side.
  builder.taperedBox([0, -0.44, 3.6], [0, -0.18, -4.4], 0.86, 0.30, 0.28, 0.22, dark);
  // Red cheatline along both flanks.
  builder.taperedBox([0.0, -0.05, 3.55], [0.0, 0.16, -3.2], 1.452, 0.18, 0.44, 0.14, red);
  // Cabin roof and the windscreen frame.
  builder.taperedBox([0, 0.62, 0.62], [0, 0.58, -1.15], 1.30, 0.24, 1.30, 0.22, cream);
  // The greenhouse: side windows as dark slabs laid on the fuselage side.
  builder.box([0.715, 0.20, -0.16], [0.05, 0.52, 1.52], glass);
  builder.box([-0.715, 0.20, -0.16], [0.05, 0.52, 1.52], glass);
  builder.box([0, 0.24, 0.68], [1.06, 0.50, 0.10], glass);
  // Windscreen rake.
  builder.taperedBox([0, 0.30, 1.02], [0, 0.56, 0.62], 1.10, 0.52, 1.12, 0.18, glass);

  // Wing: high, with dihedral, four metres of span each side and a chord of 1.6 m.
  const wingRoot = { x: 0.62, y: 0.42, z: 0.35 };
  const wingTip = { x: 5.9, y: 0.86, z: 0.18 };
  builder.taperedBox(
    [wingRoot.x, wingRoot.y, wingRoot.z + 0.0],
    [wingTip.x, wingTip.y, wingTip.z + 0.0],
    0.34,
    1.72,
    0.14,
    1.05,
    cream,
    cream,
  );
  builder.taperedBox(
    [-wingRoot.x, wingRoot.y, wingRoot.z],
    [-wingTip.x, wingTip.y, wingTip.z],
    0.34,
    1.72,
    0.14,
    1.05,
    cream,
    cream,
  );
  // Red wingtips.
  builder.box([5.86, 0.865, 0.18], [0.30, 0.16, 1.02], red);
  builder.box([-5.86, 0.865, 0.18], [0.30, 0.16, 1.02], red);
  // Lift struts from the lower fuselage to mid-span, the bush plane's signature.
  for (const side of [1, -1]) {
    const from = [side * 0.55, -0.42, 0.62];
    const to = [side * 3.35, 0.62, 0.42];
    strut(builder, from, to, 0.075, dark);
    strut(builder, [side * 0.55, -0.44, -0.55], [side * 3.35, 0.62, 0.16], 0.062, dark);
  }

  // Tailplane and fin.
  builder.taperedBox([0, 0.30, -3.55], [0, 0.32, -4.72], 0.30, 1.30, 0.14, 0.78, cream);
  builder.taperedBox([0, 0.34, -3.5], [0, 0.36, -4.7], 0.16, 0.44, 0.12, 0.5, red);
  builder.taperedBox([0, 0.72, -4.30], [0, 1.86, -4.62], 0.16, 0.62, 0.14, 0.30, cream);
  builder.box([0, 1.72, -4.55], [0.17, 0.34, 0.62], red);

  // Prop: spinner cone and two blades, turning on the nose.
  builder.cylinder([0, 0, 4.28], 0.26, 0.44, red, 14, 'z');
  for (let blade = 0; blade < 2; blade += 1) {
    const a = propAngle + blade * Math.PI;
    const dirX = Math.cos(a);
    const dirY = Math.sin(a);
    const mid = [dirX * 0.78, dirY * 0.78, 4.28];
    // Blades lie along the disc, so they are thin in z and long in the radial direction.
    const len = 1.62;
    builder.taperedBox(
      [mid[0] + dirX * len * 0.5, mid[1] + dirY * len * 0.5, 4.26],
      [mid[0] - dirX * len * 0.5, mid[1] - dirY * len * 0.5, 4.26],
      0.02,
      0.20,
      0.02,
      0.085,
      PALETTE.prop,
    );
  }

  // Fixed gear: two legs with tundra tyres, and a tailwheel.
  for (const side of [1, -1]) {
    strut(builder, [side * 0.5, -0.5, 0.95], [side * 1.28, -1.28, 0.62], 0.075, dark);
    strut(builder, [side * 0.5, -0.5, 0.35], [side * 1.28, -1.28, 0.62], 0.06, dark);
    builder.cylinder([side * 1.34, -1.30, 0.62], 0.42, 0.26, PALETTE.prop, 16, 'x');
    builder.cylinder([side * 1.34, -1.30, 0.62], 0.16, 0.30, cream, 10, 'x');
  }
  builder.cylinder([0, -0.98, -3.95], 0.20, 0.18, PALETTE.prop, 10, 'x');
  strut(builder, [0, -0.32, -3.6], [0, -0.94, -3.95], 0.05, dark);

  // Exhaust stub and a nav light on the fin.
  builder.cylinder([0.52, -0.28, 2.9], 0.085, 0.5, dark, 8, 'z');
  builder.box([0, 1.90, -4.62], [0.10, 0.10, 0.10], red);

  return toMeshData(builder);
}

/** A thin strut between two points: a box laid along the line, thin in the other two axes. */
function strut(builder, from, to, thickness, color) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  // A box of length len along z, then rotated: cheap and exact enough for thin rods.
  const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.acos(Math.max(-1, Math.min(1, dz / len)));
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Basis: local x, y, z in world space.
  const axisZ = [sy * sp, cp, cy * sp];
  const axisX = [cy, 0, -sy];
  const axisY = [
    axisX[1] * axisZ[2] - axisX[2] * axisZ[1],
    axisX[2] * axisZ[0] - axisX[0] * axisZ[2],
    axisX[0] * axisZ[1] - axisX[1] * axisZ[0],
  ];
  const h = thickness / 2;
  const hl = len / 2;
  const corner = (sx, sy2, sz) => [
    mid[0] + axisX[0] * sx * h + axisY[0] * sy2 * h + axisZ[0] * sz * hl,
    mid[1] + axisX[1] * sx * h + axisY[1] * sy2 * h + axisZ[1] * sz * hl,
    mid[2] + axisX[2] * sx * h + axisY[2] * sy2 * h + axisZ[2] * sz * hl,
  ];
  builder.quad(corner(-1, 1, -1), corner(-1, 1, 1), corner(1, 1, 1), corner(1, 1, -1), color, axisY);
  builder.quad(corner(-1, -1, 1), corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), color, [-axisY[0], -axisY[1], -axisY[2]]);
  builder.quad(corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1), color, axisZ);
  builder.quad(corner(1, -1, -1), corner(-1, -1, -1), corner(-1, 1, -1), corner(1, 1, -1), color, [-axisZ[0], -axisZ[1], -axisZ[2]]);
  builder.quad(corner(1, -1, 1), corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), color, axisX);
  builder.quad(corner(-1, -1, -1), corner(-1, -1, 1), corner(-1, 1, 1), corner(-1, 1, -1), color, [-axisX[0], -axisX[1], -axisX[2]]);
}
