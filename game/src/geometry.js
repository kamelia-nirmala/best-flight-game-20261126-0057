// A tiny mesh builder: everything in the game is assembled from tapered boxes, cylinders,
// rings and quads, so the aeroplane and the islands are geometry the code makes rather than
// a model file. Vertices are interleaved position/normal/colour, which is what the lit shader
// reads.

import { cross, normalize, sub } from './mathx.js';

export const FLOATS_PER_VERTEX = 9;

export function createBuilder() {
  const vertices = [];
  const indices = [];

  function push(p, n, c) {
    vertices.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2]);
    return vertices.length / FLOATS_PER_VERTEX - 1;
  }

  function triangle(a, b, c, color, normal) {
    let n = normal;
    if (!n) {
      const e1 = sub(b, a);
      const e2 = sub(c, a);
      n = normalize(cross(e1, e2));
    }
    const base = vertices.length / FLOATS_PER_VERTEX;
    push(a, n, color);
    push(b, n, color);
    push(c, n, color);
    indices.push(base, base + 1, base + 2);
  }

  /** A quad wound counter-clockwise seen from the side the normal points to. */
  function quad(a, b, c, d, color, normal) {
    triangle(a, b, c, color, normal);
    triangle(a, c, d, color, normal);
  }

  /** Six faces of a box, each face flat-shaded so the edges stay crisp. */
  function box(center, size, color) {
    const [cx, cy, cz] = center;
    const hx = size[0] / 2;
    const hy = size[1] / 2;
    const hz = size[2] / 2;
    const p = (sx, sy, sz) => [cx + sx * hx, cy + sy * hy, cz + sz * hz];
    quad(p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), color, [0, 1, 0]);
    quad(p(-1, -1, 1), p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), color, [0, -1, 0]);
    quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), color, [0, 0, 1]);
    quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), color, [0, 0, -1]);
    quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), color, [1, 0, 0]);
    quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), color, [-1, 0, 0]);
  }

  /**
   * A box whose two ends differ in size: the fuselage, the wings and the tail all taper, which
   * is what makes a shape read as an aeroplane rather than a crate. `front` and `back` are the
   * centre points of the two end faces, each with its own width (x) and height (y).
   */
  function taperedBox(front, back, frontW, frontH, backW, backH, color, topColor) {
    const fw = frontW / 2;
    const fh = frontH / 2;
    const bw = backW / 2;
    const bh = backH / 2;
    const f = front;
    const b = back;
    const fp = (sx, sy) => [f[0] + sx * fw, f[1] + sy * fh, f[2]];
    const bp = (sx, sy) => [b[0] + sx * bw, b[1] + sy * bh, b[2]];
    const top = topColor ?? color;
    // Top, bottom, left, right, then the two caps.
    quad(fp(-1, 1), bp(-1, 1), bp(1, 1), fp(1, 1), top, [0, 1, 0]);
    quad(fp(-1, -1), fp(1, -1), bp(1, -1), bp(-1, -1), color, [0, -1, 0]);
    quad(fp(-1, -1), fp(-1, 1), bp(-1, 1), bp(-1, -1), color, [-1, 0, 0]);
    quad(fp(1, -1), bp(1, -1), bp(1, 1), fp(1, 1), color, [1, 0, 0]);
    quad(fp(-1, -1), fp(1, -1), fp(1, 1), fp(-1, 1), top, [0, 0, 1]);
    quad(bp(-1, -1), bp(-1, 1), bp(1, 1), bp(1, -1), color, [0, 0, -1]);
  }

  /** A cylinder about the z axis, capped: wheels, struts, the prop hub, the ring tubes. */
  function cylinder(center, radius, length, color, segments = 12, axis = 'z') {
    const ring = [];
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      ring.push([Math.cos(a), Math.sin(a)]);
    }
    const at = (u, v, along) => {
      if (axis === 'z') return [center[0] + u * radius, center[1] + v * radius, center[2] + along];
      if (axis === 'x') return [center[0] + along, center[1] + u * radius, center[2] + v * radius];
      return [center[0] + u * radius, center[1] + along, center[2] + v * radius];
    };
    const half = length / 2;
    for (let i = 0; i < segments; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % segments];
      const n = normalize([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]);
      const normal = axis === 'z' ? n : axis === 'x' ? [0, n[0], n[1]] : [n[0], 0, n[1]];
      quad(at(a[0], a[1], -half), at(b[0], b[1], -half), at(b[0], b[1], half), at(a[0], a[1], half), color, normal);
      triangle(at(0, 0, half), at(a[0], a[1], half), at(b[0], b[1], half), color, axis === 'z' ? [0, 0, 1] : axis === 'x' ? [1, 0, 0] : [0, 1, 0]);
      triangle(at(0, 0, -half), at(b[0], b[1], -half), at(a[0], a[1], -half), color, axis === 'z' ? [0, 0, -1] : axis === 'x' ? [-1, 0, 0] : [0, -1, 0]);
    }
  }

  /** A torus standing in the x-y plane (a target ring to fly through), radius r, tube t. */
  function torus(center, radius, tube, color, majorSegments = 40, minorSegments = 8) {
    const grid = [];
    for (let i = 0; i <= majorSegments; i += 1) {
      const u = (i / majorSegments) * Math.PI * 2;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const row = [];
      for (let j = 0; j <= minorSegments; j += 1) {
        const v = (j / minorSegments) * Math.PI * 2;
        const cv = Math.cos(v);
        const sv = Math.sin(v);
        const nx = cv * cu;
        const ny = cv * su;
        const nz = sv;
        row.push({
          p: [center[0] + (radius + tube * cv) * cu, center[1] + (radius + tube * cv) * su, center[2] + tube * sv],
          n: [nx, ny, nz],
        });
      }
      grid.push(row);
    }
    for (let i = 0; i < majorSegments; i += 1) {
      for (let j = 0; j < minorSegments; j += 1) {
        const a = grid[i][j];
        const b = grid[i + 1][j];
        const c = grid[i + 1][j + 1];
        const d = grid[i][j + 1];
        const base = vertices.length / FLOATS_PER_VERTEX;
        push(a.p, a.n, color);
        push(b.p, b.n, color);
        push(c.p, c.n, color);
        push(d.p, d.n, color);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }

  /** A flat disc lying in the x-z plane: the runway, the drop zone, the apron. */
  function disc(center, radius, color, segments = 24, normal = [0, 1, 0]) {
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      triangle(
        center,
        [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius],
        [center[0] + Math.cos(b) * radius, center[1], center[2] + Math.sin(b) * radius],
        color,
        normal,
      );
    }
  }

  /** A flat rectangle in the x-z plane, given a centre, a heading and half extents. */
  function slab(center, halfWidth, halfLength, heading, color, lift = 0) {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const p = (u, v) => [center[0] + u * c - v * s, center[1] + lift, center[2] + u * s + v * c];
    quad(p(-halfWidth, -halfLength), p(-halfWidth, halfLength), p(halfWidth, halfLength), p(halfWidth, -halfLength), color, [0, 1, 0]);
  }

  function merge(other) {
    const offset = vertices.length / FLOATS_PER_VERTEX;
    for (let i = 0; i < other.vertices.length; i += 1) vertices.push(other.vertices[i]);
    for (let i = 0; i < other.indices.length; i += 1) indices.push(other.indices[i] + offset);
  }

  return {
    vertices,
    indices,
    push,
    triangle,
    quad,
    box,
    taperedBox,
    cylinder,
    torus,
    disc,
    slab,
    merge,
    get vertexCount() {
      return vertices.length / FLOATS_PER_VERTEX;
    },
  };
}

/** Copy a builder's arrays into typed arrays the GPU can take. */
export function toMeshData(builder) {
  return {
    vertices: new Float32Array(builder.vertices),
    indices: new Uint32Array(builder.indices),
    vertexCount: builder.vertexCount,
    indexCount: builder.indices.length,
  };
}
