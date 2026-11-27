// The island. Heights come from a seeded value-noise field shaped by an island mask, one
// volcano cone with a lava crater, and ridge noise for the shoulders; the same function the mesh
// is built from is the one the flight model asks for ground height, so AGL and terrain never
// disagree. A runway pad flattens the ground under it, so the strip is level where the wheels go.

import { MISSION, PALETTE } from './config.js';
import { clamp, lerp, smoothstep } from './mathx.js';

export const WORLD = { halfSize: 4200, grid: 300 };

/** The flat places: a runway at each, and a small village apron at the home field. The pad has to
 * be wider than the runway it carries, or the strip's ends would sit on sloping ground. */
export const PADS = [
  {
    id: 'home',
    name: 'KAWAH VILLAGE',
    center: [0, 0, 520],
    elevation: 24,
    radius: 520,
    runway: { length: 760, width: 40, heading: 0 },
    village: true,
  },
  {
    id: 'beach',
    name: 'PASIR PANJANG',
    center: [-1640, 0, -760],
    elevation: 9,
    radius: 400,
    runway: { length: 600, width: 32, heading: 1.05 },
    village: false,
  },
];

const ISLAND = { centerX: -120, centerZ: -430, radiusX: 1760, radiusZ: 1560 };
const VOLCANO = { x: 300, z: -1180, height: 690, radius: 760, craterRadius: 150, craterDepth: 210 };

function hash(ix, iz, seed) {
  let h = ix * 374761393 + iz * 668265263 + seed * 1442695040888963407;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

function fbm(x, z, octaves, seed) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += valueNoise(x * frequency, z * frequency, seed + o * 977) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

/** Ridged noise: the sharp crests that make volcano shoulders read as rock, not dunes. */
function ridged(x, z, seed) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let o = 0; o < 3; o += 1) {
    const n = 1 - Math.abs(valueNoise(x * frequency, z * frequency, seed + o * 131) * 2 - 1);
    sum += n * n * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.11;
  }
  return sum / total;
}

function islandMask(x, z) {
  const dx = (x - ISLAND.centerX) / ISLAND.radiusX;
  const dz = (z - ISLAND.centerZ) / ISLAND.radiusZ;
  const d = Math.hypot(dx, dz);
  // The coastline wanders: the mask edge is pushed in and out by a slow noise of the angle.
  const angle = Math.atan2(dz, dx);
  const wobble = (valueNoise(Math.cos(angle) * 3.1 + 8, Math.sin(angle) * 3.1 + 8, 421) - 0.5) * 0.26;
  return smoothstep(1.0, 0.66, d + wobble);
}

/** Ground height in metres before the pads flatten it. */
function rawHeight(x, z) {
  const seaFloor = -52;
  const mask = islandMask(x, z);
  if (mask <= 0.001) return seaFloor;
  const shelf = smoothstep(0.0, 0.32, mask) * 46;
  const hills = (fbm(x * 0.0021, z * 0.0021, 4, 11) - 0.35) * 150 * mask;
  const ridges = (ridged(x * 0.0034, z * 0.0034, 57) - 0.3) * 190 * mask * smoothstep(0.25, 0.8, mask);
  const grain = (fbm(x * 0.014, z * 0.014, 3, 199) - 0.5) * 11 * mask;

  const vdx = x - VOLCANO.x;
  const vdz = z - VOLCANO.z;
  const vd = Math.hypot(vdx, vdz) / VOLCANO.radius;
  let cone = 0;
  if (vd < 1) cone = Math.pow(1 - vd, 1.7) * VOLCANO.height;
  // The crater: a bowl cut into the top of the cone, with a low rim around it.
  const cd = Math.hypot(vdx, vdz);
  if (cd < VOLCANO.craterRadius * 2.4) {
    const t = clamp(cd / (VOLCANO.craterRadius * 2.4), 0, 1);
    const bowl = (1 - smoothstep(VOLCANO.craterRadius * 0.55, VOLCANO.craterRadius * 2.4, cd)) * VOLCANO.craterDepth;
    const rim = Math.exp(-Math.pow((cd - VOLCANO.craterRadius * 1.9) / (VOLCANO.craterRadius * 0.7), 2)) * 34 * (1 - t * 0.4);
    cone += rim - bowl;
  }

  return seaFloor + (shelf + hills + ridges + grain + cone) * mask + (mask > 0.02 ? 0 : 0);
}

export function heightAt(x, z) {
  let h = rawHeight(x, z);
  for (let i = 0; i < PADS.length; i += 1) {
    const pad = PADS[i];
    const d = Math.hypot(x - pad.center[0], z - pad.center[2]);
    if (d < pad.radius) {
      const t = smoothstep(pad.radius, pad.radius * 0.58, d);
      h = lerp(h, pad.elevation, t);
    }
  }
  return h;
}

/** The surface the aeroplane can touch: the land where there is land, sea level where the noise
 * field has dug the seabed below it. Height above ground is measured from this, so a machine over
 * open water reads its height above the sea, never a height above the seabed. */
export function surfaceAt(x, z) {
  return Math.max(0, heightAt(x, z));
}

/** The surface normal, from the same field: used for slope-aware colouring and for crashes. */
export function normalAt(x, z, delta = 6) {
  const hL = heightAt(x - delta, z);
  const hR = heightAt(x + delta, z);
  const hD = heightAt(x, z - delta);
  const hU = heightAt(x, z + delta);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * delta;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function slopeAt(x, z) {
  return 1 - normalAt(x, z).slice(1)[0] * 1;
}

/** Ground colour by height, slope and a little noise: sand, moss, ash, rock, and lava in the crater. */
function groundColor(x, z, h, normal) {
  const upness = normal[1];
  const grain = valueNoise(x * 0.02, z * 0.02, 733);
  const patch = valueNoise(x * 0.0055, z * 0.0055, 88);

  let color;
  if (h < 2.5) {
    color = PALETTE.sand;
  } else if (h < 40) {
    const t = smoothstep(2.5, 32, h);
    color = [
      lerp(PALETTE.sand[0], PALETTE.moss[0], t),
      lerp(PALETTE.sand[1], PALETTE.moss[1], t),
      lerp(PALETTE.sand[2], PALETTE.moss[2], t),
    ];
  } else if (h < 210) {
    const t = smoothstep(40, 190, h) * 0.75 + patch * 0.25;
    color = [
      lerp(PALETTE.moss[0], PALETTE.mossLight[0], t),
      lerp(PALETTE.moss[1], PALETTE.mossLight[1], t),
      lerp(PALETTE.moss[2], PALETTE.mossLight[2], t),
    ];
  } else {
    const t = smoothstep(210, 460, h);
    color = [
      lerp(PALETTE.mossLight[0], PALETTE.ash[0], t),
      lerp(PALETTE.mossLight[1], PALETTE.ash[1], t),
      lerp(PALETTE.mossLight[2], PALETTE.ash[2], t),
    ];
  }

  // Steep faces are bare rock whatever their height.
  const steep = smoothstep(0.90, 0.66, upness);
  color = [
    lerp(color[0], PALETTE.rockDark[0] + grain * 0.06, steep),
    lerp(color[1], PALETTE.rockDark[1] + grain * 0.055, steep),
    lerp(color[2], PALETTE.rockDark[2] + grain * 0.05, steep),
  ];

  // The crater's inner walls glow: a hot band just under the rim.
  const cd = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  if (cd < VOLCANO.craterRadius * 2.2 && h > VOLCANO.height * 0.45) {
    const heat = (1 - smoothstep(VOLCANO.craterRadius * 0.7, VOLCANO.craterRadius * 2.1, cd)) * smoothstep(0.35, 0.85, 1 - upness + 0.4);
    const vein = smoothstep(0.55, 0.85, valueNoise(x * 0.03, z * 0.03, 1201));
    const t = clamp(heat * (0.55 + vein * 0.75), 0, 1);
    color = [
      lerp(color[0], PALETTE.lava[0], t),
      lerp(color[1], PALETTE.lava[1], t),
      lerp(color[2], PALETTE.lava[2], t),
    ];
  }

  const shade = 0.94 + grain * 0.12;
  return [color[0] * shade, color[1] * shade, color[2] * shade];
}

/**
 * Build the island mesh: one grid over the whole world, each cell split into two triangles, each
 * vertex coloured by the terrain it stands on. Flat-shaded per triangle so the ridges keep their
 * edges, which reads as rock rather than a melted surface.
 */
export function buildTerrainMesh(builder) {
  const { halfSize, grid } = WORLD;
  const step = (halfSize * 2) / grid;
  const positions = new Float32Array((grid + 1) * (grid + 1) * 3);
  const normals = new Float32Array((grid + 1) * (grid + 1) * 3);
  const colors = new Float32Array((grid + 1) * (grid + 1) * 3);

  for (let iz = 0; iz <= grid; iz += 1) {
    for (let ix = 0; ix <= grid; ix += 1) {
      const x = -halfSize + ix * step;
      const z = -halfSize + iz * step;
      const h = heightAt(x, z);
      const n = normalAt(x, z, step * 0.7);
      const c = groundColor(x, z, h, n);
      const i = (iz * (grid + 1) + ix) * 3;
      positions[i] = x;
      positions[i + 1] = h;
      positions[i + 2] = z;
      normals[i] = n[0];
      normals[i + 1] = n[1];
      normals[i + 2] = n[2];
      colors[i] = c[0];
      colors[i + 1] = c[1];
      colors[i + 2] = c[2];
    }
  }

  const indices = [];
  for (let iz = 0; iz < grid; iz += 1) {
    for (let ix = 0; ix < grid; ix += 1) {
      const a = iz * (grid + 1) + ix;
      const b = a + 1;
      const c = a + grid + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Emit every triangle with its own three vertices and one face normal: flat shading.
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3;
    const ib = indices[t + 1] * 3;
    const ic = indices[t + 2] * 3;
    const ax = positions[ia];
    const ay = positions[ia + 1];
    const az = positions[ia + 2];
    const bx = positions[ib];
    const by = positions[ib + 1];
    const bz = positions[ib + 2];
    const cx = positions[ic];
    const cy = positions[ic + 1];
    const cz = positions[ic + 2];
    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // Average the three vertex colours for the face, then push a hair of variation.
    const cr = (colors[ia] + colors[ib] + colors[ic]) / 3;
    const cg = (colors[ia + 1] + colors[ib + 1] + colors[ic + 1]) / 3;
    const cb = (colors[ia + 2] + colors[ib + 2] + colors[ic + 2]) / 3;
    builder.push([ax, ay, az], [nx, ny, nz], [cr, cg, cb]);
    builder.push([bx, by, bz], [nx, ny, nz], [cr, cg, cb]);
    builder.push([cx, cy, cz], [nx, ny, nz], [cr, cg, cb]);
  }
}

/** Where the ring run goes: a weaving course up the valley toward the volcano. Each gate is lifted
 * clear of the ground beneath it and no gate is more than a gentle climb above the one before, so
 * the run is a flying problem rather than a wall. Each gate carries the course direction at its own
 * point, so the ring stands across the line the pilot is flying rather than facing one fixed way. */
export function ringPath() {
  // A left-hand circuit of the valley: out over the west shore, round the volcano's foot, and back
  // across the village so the last gate hands the pilot to the mail drop. The last entry is an exit
  // waypoint — it is not a gate, it only aims the final gate at the village.
  const WAYPOINTS = [
    [0, 200],
    [-330, -20],
    [-330, -380],
    [0, -520],
    [330, -330],
    [380, 80],
    [150, 560],
  ];
  // Gate heights follow what the aeroplane can actually reach. From a standing start at the south
  // threshold it lifts off about 610 m along the strip and then holds roughly a 15% gradient, so a
  // gate 620 m from the start cannot sit at 158 m. The first two gates are set to that climb-out
  // profile; the rest climb gently from there. Every gate is also kept at least one ring radius plus
  // 26 m above the ground beneath it, so the hoop is never half-buried.
  const ALTITUDES = [112, 142, 174, 190, 205, 220];
  const points = [];
  const count = MISSION.ringCount;
  for (let i = 0; i < count; i += 1) {
    const [x, z] = WAYPOINTS[i];
    const ground = heightAt(x, z);
    const y = Math.max(ground + MISSION.ringRadiusM + 26, ALTITUDES[i] ?? 220);
    points.push({ center: [x, y, z], index: i });
  }
  // The course direction at each gate is the leg arriving at it, so the gate stands square across
  // the flight path: a pilot tracking the leg crosses the middle of the hoop, not its edge. A
  // bisector would leave every gate canted to the arrival and punish a perfectly flown line.
  const START = [0, 780];
  for (let i = 0; i < points.length; i += 1) {
    const here = points[i].center;
    const before = i === 0 ? [START[0], 0, START[1]] : points[i - 1].center;
    let ax = here[0] - before[0];
    let az = here[2] - before[2];
    const len = Math.hypot(ax, az) || 1;
    ax /= len;
    az /= len;
    points[i].axis = [ax, 0, az];
    points[i].courseHeading = Math.atan2(ax, -az);
  }
  return points;
}

/** The village strip's drop circle, and the two runway pads, as plain data for the world. */
export function padById(id) {
  return PADS.find((pad) => pad.id === id);
}

/** The mail drop circle: over the village apron, where the ground is flat and the huts are the
 * landmark the pilot aims at. */
export function dropPoint() {
  return { x: 150, z: 560, radius: MISSION.dropRadiusM };
}
