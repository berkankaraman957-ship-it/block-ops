/*
 * BLOCK OPS mini WebGL2 engine — zero dependencies.
 * - Column-major mat4 math
 * - World chunk shader (texture atlas + baked AO + fog + dynamic flash lights)
 * - Instanced box renderer (all characters, guns, particles, tracers, decals = 1 draw call per batch)
 * - Tiny scene graph (Node) for hierarchical voxel models
 */

// ---------------------------------------------------------------------------
// MATH
// ---------------------------------------------------------------------------
export const M4 = {
  create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  identity(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  copy(o, a) { o.set(a); return o; },
  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o.fill(0);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
    return o;
  },
  multiply(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },
  /** local = T * Ry * Rx * Rz * S  (Euler order YXZ, same as an FPS camera) */
  compose(o, px, py, pz, rx, ry, rz, sx, sy, sz) {
    const cx = Math.cos(rx), sxn = Math.sin(rx), cy = Math.cos(ry), syn = Math.sin(ry), cz = Math.cos(rz), szn = Math.sin(rz);
    // R = Ry * Rx * Rz
    const m00 = cy * cz + syn * sxn * szn, m01 = cx * szn, m02 = -syn * cz + cy * sxn * szn;
    const m10 = -cy * szn + syn * sxn * cz, m11 = cx * cz, m12 = syn * szn + cy * sxn * cz;
    const m20 = syn * cx, m21 = -sxn, m22 = cy * cx;
    o[0] = m00 * sx; o[1] = m01 * sx; o[2] = m02 * sx; o[3] = 0;
    o[4] = m10 * sy; o[5] = m11 * sy; o[6] = m12 * sy; o[7] = 0;
    o[8] = m20 * sz; o[9] = m21 * sz; o[10] = m22 * sz; o[11] = 0;
    o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
    return o;
  },
  /** FPS view matrix: inverse of T(pos) * Ry(yaw) * Rx(pitch) * Rz(roll) */
  fpsView(o, px, py, pz, yaw, pitch, roll) {
    const w = M4._tmp || (M4._tmp = new Float32Array(16));
    M4.compose(w, px, py, pz, pitch, yaw, roll || 0, 1, 1, 1);
    return M4.invertRigid(o, w);
  },
  invertRigid(o, m) {
    // rotation transpose + translated
    const r00 = m[0], r01 = m[1], r02 = m[2], r10 = m[4], r11 = m[5], r12 = m[6], r20 = m[8], r21 = m[9], r22 = m[10];
    const tx = m[12], ty = m[13], tz = m[14];
    o[0] = r00; o[1] = r10; o[2] = r20; o[3] = 0;
    o[4] = r01; o[5] = r11; o[6] = r21; o[7] = 0;
    o[8] = r02; o[9] = r12; o[10] = r22; o[11] = 0;
    o[12] = -(r00 * tx + r01 * ty + r02 * tz);
    o[13] = -(r10 * tx + r11 * ty + r12 * tz);
    o[14] = -(r20 * tx + r21 * ty + r22 * tz);
    o[15] = 1;
    return o;
  },
  invert(o, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  transformPoint(m, x, y, z) {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, w];
  },
  frustumPlanes(m) {
    const p = [];
    const add = (a, b, c, d) => { const l = Math.hypot(a, b, c); p.push([a / l, b / l, c / l, d / l]); };
    add(m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
    add(m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
    add(m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
    add(m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
    add(m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
    add(m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
    return p;
  }
};

export function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// ---------------------------------------------------------------------------
// SCENE GRAPH
// ---------------------------------------------------------------------------
export class Node {
  constructor(name) {
    this.name = name || '';
    this.pos = [0, 0, 0];
    this.rot = [0, 0, 0];   // euler, applied as Ry * Rx * Rz
    this.scl = [1, 1, 1];
    this.children = [];
    this.boxes = [];
    this.visible = true;
    this.alpha = 1;
    this.local = M4.create();
    this.world = M4.create();
    this.tint = null;
  }
  add(child) { this.children.push(child); return child; }
  /** add a box: size sx,sy,sz centred at ox,oy,oz */
  box(sx, sy, sz, ox, oy, oz, color, emissive, alpha) {
    const c = typeof color === 'number' ? hexToRgb(color) : color;
    this.boxes.push({ s: [sx, sy, sz], o: [ox, oy, oz], c, e: emissive || 0, a: alpha == null ? 1 : alpha });
    return this;
  }
  /** a limb box spanning from point a to point b */
  limb(a, b, thick, color, emissive) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 0.001;
    const n = new Node('limb');
    n.pos = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    n.rot = [Math.asin(dy / len), Math.atan2(-dx, -dz), 0];
    n.box(thick, thick, len, 0, 0, 0, color, emissive);
    return this.add(n);
  }
  update(parent) {
    M4.compose(this.local, this.pos[0], this.pos[1], this.pos[2], this.rot[0], this.rot[1], this.rot[2], this.scl[0], this.scl[1], this.scl[2]);
    if (parent) M4.multiply(this.world, parent, this.local); else this.world.set(this.local);
    for (const c of this.children) c.update(this.world);
  }
  render(batch, alphaMul, tint) {
    if (!this.visible) return;
    const a = (alphaMul == null ? 1 : alphaMul) * this.alpha;
    const t = this.tint || tint;
    for (const b of this.boxes) {
      let r = b.c[0], g = b.c[1], bl = b.c[2];
      if (t) { r = r * (1 - t[3]) + t[0] * t[3]; g = g * (1 - t[3]) + t[1] * t[3]; bl = bl * (1 - t[3]) + t[2] * t[3]; }
      batch.pushBox(this.world, b.o[0], b.o[1], b.o[2], b.s[0], b.s[1], b.s[2], r, g, bl, b.a * a, b.e);
    }
    for (const c of this.children) c.render(batch, a, t);
  }
  find(name) {
    if (this.name === name) return this;
    for (const c of this.children) { const f = c.find(name); if (f) return f; }
    return null;
  }
}

// ---------------------------------------------------------------------------
// GL HELPERS
// ---------------------------------------------------------------------------
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

const LIGHTS_GLSL = `
uniform vec4 uLights[4];   // xyz pos, w intensity
uniform vec3 uLightCol[4];
vec3 flashLight(vec3 wp, vec3 n) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    if (uLights[i].w <= 0.0) continue;
    vec3 d = uLights[i].xyz - wp;
    float dist2 = dot(d, d);
    float ndl = max(dot(n, normalize(d)), 0.0) * 0.7 + 0.3;
    acc += uLightCol[i] * uLights[i].w * ndl / (1.0 + dist2 * 0.35);
  }
  return acc;
}`;

const WORLD_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec3 aCol;
layout(location=3) in vec3 aNorm;
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec2 uFog;
out vec2 vUV; out vec3 vCol; out float vFog; out vec3 vWP; out vec3 vN;
void main() {
  vUV = aUV; vCol = aCol; vWP = aPos; vN = aNorm;
  float d = distance(aPos, uCam);
  vFog = clamp((d - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  gl_Position = uVP * vec4(aPos, 1.0);
}`;
const WORLD_FS = `#version 300 es
precision mediump float;
in vec2 vUV; in vec3 vCol; in float vFog; in vec3 vWP; in vec3 vN;
uniform sampler2D uTex;
uniform vec3 uFogCol;
${LIGHTS_GLSL}
out vec4 o;
void main() {
  vec3 t = texture(uTex, vUV).rgb;
  vec3 c = t * (vCol + flashLight(vWP, vN));
  o = vec4(mix(c, uFogCol, vFog), 1.0);
}`;

const BOX_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNorm;
layout(location=2) in vec4 iM0;
layout(location=3) in vec4 iM1;
layout(location=4) in vec4 iM2;
layout(location=5) in vec4 iM3;
layout(location=6) in vec4 iCol;
layout(location=7) in float iEmis;
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uSun;
uniform vec2 uFog;
uniform float uAmbient;
${LIGHTS_GLSL}
out vec4 vCol; out float vFog;
void main() {
  mat4 M = mat4(iM0, iM1, iM2, iM3);
  vec4 wp = M * vec4(aPos, 1.0);
  vec3 n = normalize(mat3(M) * aNorm);
  float l = uAmbient + (1.0 - uAmbient) * max(dot(n, uSun), 0.0) + n.y * 0.06;
  vec3 lit = iCol.rgb * l + iCol.rgb * flashLight(wp.xyz, n);
  vCol = vec4(mix(lit, iCol.rgb, iEmis), iCol.a);
  float d = distance(wp.xyz, uCam);
  vFog = clamp((d - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0) * (1.0 - iEmis * 0.7);
  gl_Position = uVP * wp;
}`;
const BOX_FS = `#version 300 es
precision mediump float;
in vec4 vCol; in float vFog;
uniform vec3 uFogCol;
out vec4 o;
void main() { o = vec4(mix(vCol.rgb, uFogCol, vFog), vCol.a); }`;

const SKY_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }`;
const SKY_FS = `#version 300 es
precision mediump float;
in vec2 vNdc;
uniform mat4 uInvVP;
uniform vec3 uCam;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uSunCol;
out vec4 o;
void main() {
  vec4 p = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(p.xyz / p.w - uCam);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
  c = mix(c, uHorizon * 0.82, clamp(-h * 5.0, 0.0, 1.0));
  float sd = max(dot(d, uSun), 0.0);
  c += uSunCol * (pow(sd, 900.0) * 3.0 + pow(sd, 18.0) * 0.28 + pow(sd, 3.0) * 0.06);
  o = vec4(c, 1.0);
}`;

// Unit cube, per-face normals
function cubeGeometry() {
  const P = [], N = [], I = [];
  const faces = [
    [[1, 0, 0], [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]]],
    [[-1, 0, 0], [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]]],
    [[0, 1, 0], [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]]],
    [[0, -1, 0], [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]]],
    [[0, 0, 1], [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]]],
    [[0, 0, -1], [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]]]
  ];
  for (const [n, vs] of faces) {
    const base = P.length / 3;
    for (const v of vs) { P.push(...v); N.push(...n); }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { P: new Float32Array(P), N: new Float32Array(N), I: new Uint16Array(I) };
}

// ---------------------------------------------------------------------------
// INSTANCED BOX BATCH
// ---------------------------------------------------------------------------
const FLOATS_PER_INSTANCE = 21;
export class BoxBatch {
  constructor(renderer, capacity) {
    const gl = renderer.gl;
    this.gl = gl;
    this.cap = capacity || 1024;
    this.data = new Float32Array(this.cap * FLOATS_PER_INSTANCE);
    this.count = 0;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.cube.pbuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.cube.nbuf);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, renderer.cube.ibuf);
    this.ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.setupInstanceAttribs();
    gl.bindVertexArray(null);
  }
  setupInstanceAttribs() {
    const gl = this.gl, stride = FLOATS_PER_INSTANCE * 4;
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(2 + i);
      gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, stride, i * 16);
      gl.vertexAttribDivisor(2 + i, 1);
    }
    gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 4, gl.FLOAT, false, stride, 64); gl.vertexAttribDivisor(6, 1);
    gl.enableVertexAttribArray(7); gl.vertexAttribPointer(7, 1, gl.FLOAT, false, stride, 80); gl.vertexAttribDivisor(7, 1);
  }
  grow() {
    const gl = this.gl;
    this.cap *= 2;
    const nd = new Float32Array(this.cap * FLOATS_PER_INSTANCE);
    nd.set(this.data);
    this.data = nd;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
  }
  clear() { this.count = 0; }
  /** push parent * T(o) * S(s) */
  pushBox(pm, ox, oy, oz, sx, sy, sz, r, g, b, a, e) {
    if (this.count >= this.cap) this.grow();
    const d = this.data, k = this.count * FLOATS_PER_INSTANCE;
    d[k] = pm[0] * sx; d[k + 1] = pm[1] * sx; d[k + 2] = pm[2] * sx; d[k + 3] = 0;
    d[k + 4] = pm[4] * sy; d[k + 5] = pm[5] * sy; d[k + 6] = pm[6] * sy; d[k + 7] = 0;
    d[k + 8] = pm[8] * sz; d[k + 9] = pm[9] * sz; d[k + 10] = pm[10] * sz; d[k + 11] = 0;
    d[k + 12] = pm[0] * ox + pm[4] * oy + pm[8] * oz + pm[12];
    d[k + 13] = pm[1] * ox + pm[5] * oy + pm[9] * oz + pm[13];
    d[k + 14] = pm[2] * ox + pm[6] * oy + pm[10] * oz + pm[14];
    d[k + 15] = 1;
    d[k + 16] = r; d[k + 17] = g; d[k + 18] = b; d[k + 19] = a; d[k + 20] = e;
    this.count++;
  }
  /** axis-aligned world box */
  pushAABB(cx, cy, cz, sx, sy, sz, r, g, b, a, e) {
    if (this.count >= this.cap) this.grow();
    const d = this.data, k = this.count * FLOATS_PER_INSTANCE;
    d.fill(0, k, k + 16);
    d[k] = sx; d[k + 5] = sy; d[k + 10] = sz; d[k + 12] = cx; d[k + 13] = cy; d[k + 14] = cz; d[k + 15] = 1;
    d[k + 16] = r; d[k + 17] = g; d[k + 18] = b; d[k + 19] = a; d[k + 20] = e;
    this.count++;
  }
  /** stretched box between two points (tracers, beams) */
  pushSegment(ax, ay, az, bx, by, bz, thick, r, g, b, a, e) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const fx = dx / len, fy = dy / len, fz = dz / len;
    // build orthonormal basis (u, v, f)
    let ux = -fz, uy = 0, uz = fx;
    let ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-4) { ux = 1; uy = 0; uz = 0; ul = 1; }
    ux /= ul; uy /= ul; uz /= ul;
    const vx = fy * uz - fz * uy, vy = fz * ux - fx * uz, vz = fx * uy - fy * ux;
    if (this.count >= this.cap) this.grow();
    const d = this.data, k = this.count * FLOATS_PER_INSTANCE;
    d[k] = ux * thick; d[k + 1] = uy * thick; d[k + 2] = uz * thick; d[k + 3] = 0;
    d[k + 4] = vx * thick; d[k + 5] = vy * thick; d[k + 6] = vz * thick; d[k + 7] = 0;
    d[k + 8] = fx * len; d[k + 9] = fy * len; d[k + 10] = fz * len; d[k + 11] = 0;
    d[k + 12] = (ax + bx) / 2; d[k + 13] = (ay + by) / 2; d[k + 14] = (az + bz) / 2; d[k + 15] = 1;
    d[k + 16] = r; d[k + 17] = g; d[k + 18] = b; d[k + 19] = a; d[k + 20] = e;
    this.count++;
  }
  draw(renderer) {
    if (!this.count) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * FLOATS_PER_INSTANCE);
    gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, this.count);
    gl.bindVertexArray(null);
    renderer.stats.draws++;
    renderer.stats.instances += this.count;
  }
}

// ---------------------------------------------------------------------------
// RENDERER
// ---------------------------------------------------------------------------
export class Renderer {
  constructor(canvas, opts) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: !!opts.antialias, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false, desynchronized: true
    });
    if (!gl) throw new Error('WebGL2 desteklenmiyor');
    this.gl = gl;
    this.pixelRatio = opts.pixelRatio || 1;
    this.worldProg = program(gl, WORLD_VS, WORLD_FS);
    this.skyProg = program(gl, SKY_VS, SKY_FS);
    this.skyVao = gl.createVertexArray();
    gl.bindVertexArray(this.skyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3])));
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.invVP = M4.create();
    this.zeroLights = new Float32Array(16);
    this.theme = { zenith: [0.36, 0.58, 0.88], horizon: [0.88, 0.85, 0.76], sunColor: [1, 0.95, 0.82], ambient: 0.56 };
    this.boxProg = program(gl, BOX_VS, BOX_FS);
    const cube = cubeGeometry();
    this.cube = {
      pbuf: this.buf(gl.ARRAY_BUFFER, cube.P), nbuf: this.buf(gl.ARRAY_BUFFER, cube.N), ibuf: this.buf(gl.ELEMENT_ARRAY_BUFFER, cube.I)
    };
    this.fogColor = [0.68, 0.8, 0.92];
    this.fog = [28, 85];
    this.sun = normalize3([0.45, 0.8, 0.35]);
    this.lights = new Float32Array(16);
    this.lightCols = new Float32Array(12);
    this.stats = { draws: 0, instances: 0, tris: 0 };
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this.resize();
  }
  buf(target, data) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  }
  resize() {
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * this.pixelRatio));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * this.pixelRatio));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.gl.viewport(0, 0, w, h);
    this.aspect = w / h;
  }
  setTheme(t) {
    this.theme = t;
    this.fogColor = t.horizon.slice();
    this.fog = t.fog.slice();
    this.sun = normalize3(t.sun);
  }
  setPixelRatio(r) { this.pixelRatio = r; this.resize(); }
  drawSky(vp, cam) {
    const gl = this.gl, P = this.skyProg;
    if (!M4.invert(this.invVP, vp)) return;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uInvVP, false, this.invVP);
    gl.uniform3fv(P.u.uCam, cam);
    gl.uniform3fv(P.u.uZenith, this.theme.zenith);
    gl.uniform3fv(P.u.uHorizon, this.theme.horizon);
    gl.uniform3fv(P.u.uSun, this.sun);
    gl.uniform3fv(P.u.uSunCol, this.theme.sunColor || [1, 0.95, 0.8]);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    this.stats.draws++;
  }
  setLights(list) {
    // list: [{x,y,z,i,c:[r,g,b]}] max 4
    this.lights.fill(0);
    this.lightCols.fill(0);
    for (let i = 0; i < Math.min(4, list.length); i++) {
      const l = list[i];
      this.lights[i * 4] = l.x; this.lights[i * 4 + 1] = l.y; this.lights[i * 4 + 2] = l.z; this.lights[i * 4 + 3] = l.i;
      this.lightCols[i * 3] = l.c[0]; this.lightCols[i * 3 + 1] = l.c[1]; this.lightCols[i * 3 + 2] = l.c[2];
    }
  }
  beginFrame() {
    const gl = this.gl;
    this.stats.draws = 0; this.stats.instances = 0; this.stats.tris = 0;
    gl.clearColor(this.fogColor[0], this.fogColor[1], this.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
  useWorld(vp, cam, texture) {
    const gl = this.gl, P = this.worldProg;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, vp);
    gl.uniform3fv(P.u.uCam, cam);
    gl.uniform2fv(P.u.uFog, this.fog);
    gl.uniform3fv(P.u.uFogCol, this.fogColor);
    gl.uniform4fv(P.u.uLights, this.lights);
    gl.uniform3fv(P.u.uLightCol, this.lightCols);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(P.u.uTex, 0);
  }
  useBoxes(vp, cam, opts) {
    const gl = this.gl, P = this.boxProg;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, vp);
    gl.uniform3fv(P.u.uCam, cam);
    gl.uniform3fv(P.u.uSun, (opts && opts.sun) || this.sun);
    gl.uniform2fv(P.u.uFog, (opts && opts.fog) || this.fog);
    gl.uniform3fv(P.u.uFogCol, this.fogColor);
    gl.uniform1f(P.u.uAmbient, (opts && opts.ambient) || this.theme.ambient || 0.55);
    gl.uniform4fv(P.u.uLights, (opts && opts.noLights) ? this.zeroLights : this.lights);
    gl.uniform3fv(P.u.uLightCol, this.lightCols);
  }
  setBlend(mode) {
    const gl = this.gl;
    if (mode === 'none') { gl.disable(gl.BLEND); gl.depthMask(true); }
    else if (mode === 'alpha') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    else if (mode === 'add') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false); }
  }
  createTextureFromCanvas(canvas) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
}

export function normalize3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

// ---------------------------------------------------------------------------
// SMALL ANIMATION HELPERS
// ---------------------------------------------------------------------------
export const Ease = {
  smooth: (t) => t * t * (3 - 2 * t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
};
/** windowed 0→1→0 envelope over [a,b] with ease-in on [a, a+ramp] and ease-out on [b-ramp, b] */
export function window01(t, a, b, ramp) {
  if (t <= a || t >= b) return 0;
  if (t < a + ramp) return Ease.smooth((t - a) / ramp);
  if (t > b - ramp) return Ease.smooth((b - t) / ramp);
  return 1;
}
export function range01(t, a, b) { return t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a); }

/** critically-damped-ish spring (semi-implicit Euler, stable for dt<=1/30) */
export class Spring {
  constructor(k, d) { this.k = k; this.d = d; this.x = 0; this.v = 0; this.target = 0; }
  impulse(v) { this.v += v; }
  update(dt) {
    const steps = Math.ceil(dt / (1 / 120));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.x - this.target) - this.d * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}
