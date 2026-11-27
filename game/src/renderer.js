// The 3D view, on WebGL2 with nothing vendored: one lit shader draws every solid thing, a sky
// shader paints the gradient, the sun and the haze, and a water shader runs the swell out to the
// horizon. Lighting is a warm low sun, a cool sky bounce and a little rim so the aeroplane's edges
// stay readable against the terrain.

import { PALETTE } from './config.js';
import { bodyAxes } from './flightModel.js';
import { FLOATS_PER_VERTEX } from './geometry.js';
import { clamp, identity, invert, lookAt, multiply, perspective, transformPoint } from './mathx.js';

const SOLID_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform vec3 uEye;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out float vDistance;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vDistance = length(world.xyz - uEye);
  gl_Position = uViewProjection * world;
}`;

const SOLID_FRAG = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in float vDistance;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform vec3 uEye;
uniform float uFogDensity;
uniform float uEmissive;
uniform vec3 uTint;
uniform float uTintAmount;
uniform float uAlpha;
out vec4 outColor;

void main() {
  vec3 n = normalize(vNormal);
  float wrap = 0.55;
  float diffuse = max(0.0, (dot(n, uSunDirection) + wrap) / (1.0 + wrap));
  vec3 ambient = uSkyColor * (0.42 + 0.24 * n.y);
  vec3 color = vColor * mix(vec3(1.0), uTint, uTintAmount);
  vec3 lit = color * (ambient + uSunColor * diffuse * 0.92);
  // A rim of sky light on the edges, so a cream aeroplane stays separate from cream haze.
  vec3 viewDir = normalize(uEye - vWorld);
  float rim = pow(1.0 - max(0.0, dot(n, viewDir)), 3.0);
  lit += uSkyColor * rim * 0.34;
  lit += color * uEmissive;
  float fog = 1.0 - exp(-pow(vDistance * uFogDensity, 1.7));
  lit = mix(lit, uFogColor, clamp(fog, 0.0, 0.94));
  outColor = vec4(lit, uAlpha);
}`;

const SKY_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.999, 1.0);
}`;

const SKY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform mat4 uInverseViewProjection;
uniform vec3 uEye;
uniform vec3 uSunDirection;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunColor;
uniform float uTime;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += noise(p) * a;
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec4 clip = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 far = uInverseViewProjection * clip;
  vec3 dir = normalize(far.xyz / far.w - uEye);

  float h = clamp(dir.y, -1.0, 1.0);
  float up = clamp(h, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.36, up));
  sky = mix(sky, uZenith, smoothstep(0.24, 0.98, up));

  // The sun: a disc, a broad glow, and light scattered along the horizon toward it.
  float sunDot = max(0.0, dot(dir, uSunDirection));
  vec3 toSun = normalize(vec3(uSunDirection.x, 0.0, uSunDirection.z) + vec3(0.0001));
  vec3 flatDir = normalize(vec3(dir.x, 0.0, dir.z) + vec3(0.0001));
  float sunBearing = max(0.0, dot(flatDir, toSun));
  float horizonGlow = pow(sunBearing, 3.0) * pow(1.0 - up, 2.4);
  sky = mix(sky, uGlow, horizonGlow * 0.85);

  float disc = smoothstep(0.9993, 0.9997, sunDot);
  float halo = pow(sunDot, 34.0) * 0.55 + pow(sunDot, 320.0) * 0.9;
  sky += uSunColor * (disc * 2.4 + halo * 1.15);

  // High cloud streaks: one band, stretched out along the view, catching the low light.
  if (dir.y > 0.008) {
    vec2 cloudUv = dir.xz / max(dir.y, 0.06) * 1.35 + vec2(uTime * 0.0035, uTime * 0.0019);
    float streak = fbm(cloudUv * vec2(0.62, 2.1));
    float mask = smoothstep(0.52, 0.86, streak) * smoothstep(0.02, 0.30, dir.y) * (1.0 - smoothstep(0.55, 0.95, dir.y));
    vec3 cloudLit = mix(vec3(0.62, 0.42, 0.44), vec3(1.0, 0.80, 0.66), pow(sunBearing, 1.5));
    sky = mix(sky, cloudLit, mask * 0.55);
  }

  // Below the horizon the sky fades into the haze the water will pick up.
  sky = mix(sky, uHorizon * 0.86, smoothstep(0.0, -0.16, h));
  outColor = vec4(sky, 1.0);
}`;

const WATER_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
uniform mat4 uViewProjection;
uniform vec3 uEye;
uniform float uExtent;
out vec3 vWorld;
void main() {
  vWorld = vec3(aPosition.x * uExtent + uEye.x, 0.0, aPosition.y * uExtent + uEye.z);
  gl_Position = uViewProjection * vec4(vWorld, 1.0);
}`;

const WATER_FRAG = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec3 uEye;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uSunHeight;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 p = vWorld.xz;
  float swell = noise(p * 0.010 + vec2(uTime * 0.05, uTime * 0.02)) * 0.6
              + noise(p * 0.031 - vec2(uTime * 0.08, uTime * 0.04)) * 0.4;
  float chop = noise(p * 0.14 + vec2(uTime * 0.35, -uTime * 0.22));
  // Fake a normal from the swell, and reflect the sky with it.
  vec3 normal = normalize(vec3((swell - 0.5) * 0.22, 1.0, (chop - 0.5) * 0.14));
  vec3 viewDir = normalize(uEye - vWorld);
  float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.4);

  float depthMix = smoothstep(0.2, 0.85, swell);
  vec3 base = mix(uDeep, uShallow, depthMix * 0.55);
  vec3 skyReflection = mix(uShallow * 1.5, uFogColor, 0.55);
  vec3 color = mix(base, skyReflection, clamp(fresnel * 1.15, 0.0, 0.86));

  // The sun's path on the water: a broken glitter column under the sun.
  vec3 sunFlat = normalize(vec3(uSunDirection.x, 0.0, uSunDirection.z) + vec3(0.0001));
  vec3 toPixel = normalize(vec3(vWorld.x - uEye.x, 0.0, vWorld.z - uEye.z) + vec3(0.0001));
  float align = max(0.0, dot(toPixel, sunFlat));
  float glitter = pow(align, 22.0) * smoothstep(0.55, 0.9, chop) * 1.6;
  color += uSunColor * glitter * uSunHeight * 0.9;

  float fog = 1.0 - exp(-pow(length(vWorld - uEye) * uFogDensity * 0.85, 1.6));
  color = mix(color, uFogColor, clamp(fog, 0.0, 0.97));
  outColor = vec4(color, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader failed to compile: ${log}`);
  }
  return shader;
}

function program(gl, vertexSource, fragmentSource) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`Program failed to link: ${gl.getProgramInfoLog(prog)}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  const uniforms = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(prog, i);
    uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, uniforms };
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 is not available in this browser');

  const solid = program(gl, SOLID_VERT, SOLID_FRAG);
  const sky = program(gl, SKY_VERT, SKY_FRAG);
  const water = program(gl, WATER_VERT, WATER_FRAG);

  const meshes = new Map();
  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  let waterVao = null;

  function upload(name, meshData) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, meshData.vertices, gl.STATIC_DRAW);
    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, meshData.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const entry = { vao, indexCount: meshData.indices.length };
    meshes.set(name, entry);
    return entry;
  }

  function mesh(name) {
    return meshes.get(name);
  }

  function flush(material) {
    const uniforms = solid.uniforms;
    gl.uniform3f(uniforms.uSunDirection, material.sun[0], material.sun[1], material.sun[2]);
    gl.uniform3f(uniforms.uSunColor, material.sunColor[0], material.sunColor[1], material.sunColor[2]);
    gl.uniform3f(uniforms.uSkyColor, 0.36, 0.42, 0.58);
    gl.uniform3f(uniforms.uFogColor, PALETTE.fog[0], PALETTE.fog[1], PALETTE.fog[2]);
    gl.uniform1f(uniforms.uFogDensity, material.fogDensity);
    gl.uniform3f(uniforms.uEye, material.eye[0], material.eye[1], material.eye[2]);
    gl.uniformMatrix4fv(uniforms.uViewProjection, false, material.viewProjection);
  }

  /**
   * Draw one frame. `scene` carries the camera, the sun and the list of things to draw; each item
   * has a mesh name, a model matrix and optional tint/emissive/alpha, so the ring can glow and the
   * smoke can be translucent without another shader.
   */
  function draw(scene) {
    const { width, height, camera, sun, water: waterState } = scene;
    gl.viewport(0, 0, width, height);
    gl.clearColor(PALETTE.fog[0], PALETTE.fog[1], PALETTE.fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = width / height;
    const projection = perspective(camera.fov, aspect, 1.2, 34000);
    const view = lookAt(camera.eye, camera.target, camera.up);
    const viewProjection = multiply(projection, view);
    const inverseViewProjection = invert(viewProjection);

    // Sky first, with no depth so it costs nothing and cannot cover anything.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(sky.prog);
    gl.bindVertexArray(quadVao);
    gl.uniformMatrix4fv(sky.uniforms.uInverseViewProjection, false, inverseViewProjection);
    gl.uniform3f(sky.uniforms.uEye, camera.eye[0], camera.eye[1], camera.eye[2]);
    gl.uniform3f(sky.uniforms.uSunDirection, sun.direction[0], sun.direction[1], sun.direction[2]);
    gl.uniform3f(sky.uniforms.uZenith, PALETTE.skyZenith[0], PALETTE.skyZenith[1], PALETTE.skyZenith[2]);
    gl.uniform3f(sky.uniforms.uMid, PALETTE.skyMid[0], PALETTE.skyMid[1], PALETTE.skyMid[2]);
    gl.uniform3f(sky.uniforms.uHorizon, PALETTE.skyHorizon[0], PALETTE.skyHorizon[1], PALETTE.skyHorizon[2]);
    gl.uniform3f(sky.uniforms.uGlow, PALETTE.skyGlow[0], PALETTE.skyGlow[1], PALETTE.skyGlow[2]);
    gl.uniform3f(sky.uniforms.uSunColor, PALETTE.sun[0], PALETTE.sun[1], PALETTE.sun[2]);
    gl.uniform1f(sky.uniforms.uTime, scene.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);

    // Water: a big quad round the eye, so the sea reaches the horizon at any altitude.
    if (waterState) {
      if (!waterVao) {
        waterVao = gl.createVertexArray();
        gl.bindVertexArray(waterVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      }
      gl.useProgram(water.prog);
      gl.bindVertexArray(waterVao);
      gl.uniformMatrix4fv(water.uniforms.uViewProjection, false, viewProjection);
      gl.uniform3f(water.uniforms.uEye, camera.eye[0], camera.eye[1], camera.eye[2]);
      gl.uniform3f(water.uniforms.uSunDirection, sun.direction[0], sun.direction[1], sun.direction[2]);
      gl.uniform3f(water.uniforms.uSunColor, PALETTE.sun[0], PALETTE.sun[1], PALETTE.sun[2]);
      gl.uniform3f(water.uniforms.uDeep, PALETTE.oceanDeep[0], PALETTE.oceanDeep[1], PALETTE.oceanDeep[2]);
      gl.uniform3f(water.uniforms.uShallow, PALETTE.oceanShallow[0], PALETTE.oceanShallow[1], PALETTE.oceanShallow[2]);
      gl.uniform3f(water.uniforms.uFogColor, PALETTE.fog[0], PALETTE.fog[1], PALETTE.fog[2]);
      gl.uniform1f(water.uniforms.uFogDensity, scene.fogDensity);
      gl.uniform1f(water.uniforms.uTime, scene.time);
      gl.uniform1f(water.uniforms.uSunHeight, sun.height);
      gl.uniform1f(water.uniforms.uExtent, 24000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.useProgram(solid.prog);
    const material = {
      sun: sun.direction,
      sunColor: [PALETTE.sun[0] * 0.98, PALETTE.sun[1] * 0.94, PALETTE.sun[2] * 0.9],
      fogDensity: scene.fogDensity,
      eye: camera.eye,
      viewProjection,
    };
    flush(material);

    const opaque = [];
    const blended = [];
    for (const item of scene.items) {
      if (item.alpha != null && item.alpha < 1) blended.push(item);
      else opaque.push(item);
    }

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (const item of opaque) drawItem(item);

    if (blended.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const item of blended) drawItem(item);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    gl.bindVertexArray(null);
    return viewProjection;
  }

  function drawItem(item) {
    const entry = meshes.get(item.mesh);
    if (!entry) return;
    const uniforms = solid.uniforms;
    gl.uniformMatrix4fv(uniforms.uModel, false, item.model ?? identity());
    gl.uniform1f(uniforms.uEmissive, item.emissive ?? 0);
    gl.uniform3f(uniforms.uTint, item.tint ? item.tint[0] : 1, item.tint ? item.tint[1] : 1, item.tint ? item.tint[2] : 1);
    gl.uniform1f(uniforms.uTintAmount, item.tintAmount ?? 0);
    gl.uniform1f(uniforms.uAlpha, item.alpha ?? 1);
    gl.bindVertexArray(entry.vao);
    gl.drawElements(gl.TRIANGLES, entry.indexCount, gl.UNSIGNED_INT, 0);
  }

  function projectToScreen(viewProjection, point, width, height) {
    const p = transformPoint(viewProjection, point);
    const w = viewProjection[3] * point[0] + viewProjection[7] * point[1] + viewProjection[11] * point[2] + viewProjection[15];
    return {
      x: ((p[0] / w) * 0.5 + 0.5) * width,
      y: (1 - (p[1] / w * 0.5 + 0.5)) * height,
      visible: w > 0,
    };
  }

  return { gl, upload, mesh, draw, projectToScreen, canvas };
}

/**
 * A model matrix for a thing standing at a point with an attitude. The basis is built from the
 * same heading/pitch/roll the flight model uses, so the mesh's +Z nose points where the aeroplane
 * is actually going and its +X wing is the right wing.
 */
export function placeAt(position, heading, scale = 1, pitch = 0, roll = 0) {
  const axes = bodyAxes({ heading, pitch, roll });
  const m = new Float32Array(16);
  // Columns: where local +X, +Y and +Z land in the world.
  m[0] = axes.right[0] * scale;
  m[1] = axes.right[1] * scale;
  m[2] = axes.right[2] * scale;
  m[4] = axes.up[0] * scale;
  m[5] = axes.up[1] * scale;
  m[6] = axes.up[2] * scale;
  m[8] = axes.forward[0] * scale;
  m[9] = axes.forward[1] * scale;
  m[10] = axes.forward[2] * scale;
  m[12] = position[0];
  m[13] = position[1];
  m[14] = position[2];
  m[15] = 1;
  return m;
}

export { clamp as clampf };
