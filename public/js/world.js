/*
 * Voxel world renderer: procedural pixel-art texture atlas + chunked mesher with
 * hidden-face culling, per-vertex ambient occlusion and baked sun shading.
 */
const S = window.SHARED;
const { BLOCK, BLOCK_INFO, CONFIG } = S;

const TILE = 16;
const TILES = 16;

// ---------------------------------------------------------------------------
// Procedural texture atlas
// ---------------------------------------------------------------------------
export function createAtlasCanvas() {
  const cv = document.createElement('canvas');
  cv.width = TILE * TILES; cv.height = TILE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(cv.width, cv.height);
  for (let t = 1; t < BLOCK_INFO.length; t++) paintTile(img, t);
  ctx.putImageData(img, 0, 0);
  return cv;
}

function paintTile(img, type) {
  const rng = S.mulberry32(type * 977 + 13);
  const base = BLOCK_INFO[type].color;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let k = 1 + (rng() - 0.5) * 0.12;
      switch (type) {
        case BLOCK.GROUND:
          k += (rng() < 0.08 ? -0.18 : 0) + (rng() < 0.05 ? 0.1 : 0);
          break;
        case BLOCK.WALL: {
          const row = Math.floor(y / 4);
          const off = row % 2 ? 4 : 0;
          if (y % 4 === 0) k *= 0.82;
          else if ((x + off) % 8 === 0) k *= 0.85;
          else k *= 1 + (rng() - 0.5) * 0.05;
          break;
        }
        case BLOCK.BRICK: {
          const row = Math.floor(y / 4);
          const off = row % 2 ? 4 : 0;
          if (y % 4 === 3 || (x + off) % 8 === 7) k *= 0.62;
          break;
        }
        case BLOCK.CRATE: {
          const border = x <= 1 || x >= 14 || y <= 1 || y >= 14;
          const diag = Math.abs(x - y) <= 1 || Math.abs(x - (15 - y)) <= 0;
          if (border) k *= 0.72; else if (diag) k *= 0.82; else if (y % 5 === 0) k *= 0.9;
          if ((x === 2 || x === 13) && (y === 2 || y === 13)) k *= 0.5;
          break;
        }
        case BLOCK.PLANK:
          if (y % 4 === 3) k *= 0.65;
          k *= 1 + Math.sin(x * 0.9 + Math.floor(y / 4) * 3) * 0.05;
          if ((x === 2 || x === 13) && y % 4 === 1) k *= 0.55;
          break;
        case BLOCK.SAND: {
          const ry = y % 5, cx = (x + (Math.floor(y / 5) % 2) * 4) % 8;
          const edge = ry === 0 || ry === 4 || cx === 0;
          if (edge) k *= 0.78;
          if (ry === 1) k *= 1.06;
          break;
        }
        case BLOCK.SITE_A:
        case BLOCK.SITE_B: {
          const grout = x % 8 === 0 || y % 8 === 0;
          if (grout) k *= 0.7;
          else if ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) k *= 0.88;
          break;
        }
        case BLOCK.METAL: {
          const rivet = (x === 2 || x === 13) && (y === 2 || y === 13);
          if (rivet) k *= 1.35;
          if (x === 0 || y === 0) k *= 1.15;
          if (x === 15 || y === 15) k *= 0.7;
          if ((x + y) % 7 === 0) k *= 1.04;
          break;
        }
      }
      const i = (y * img.width + type * TILE + x) * 4;
      img.data[i] = Math.min(255, base[0] * k * 255);
      img.data[i + 1] = Math.min(255, base[1] * k * 255);
      img.data[i + 2] = Math.min(255, base[2] * k * 255);
      img.data[i + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------
// Chunk mesher
// ---------------------------------------------------------------------------
// For face axis a with sign s, u=(a+1)%3, v=(a+2)%3
const FACES = [];
for (let a = 0; a < 3; a++) for (const s of [1, -1]) FACES.push({ a, s, u: (a + 1) % 3, v: (a + 2) % 3 });
const AO_CURVE = [0.5, 0.68, 0.84, 1.0];

export class WorldRenderer {
  constructor(renderer, world) {
    this.r = renderer;
    this.gl = renderer.gl;
    this.world = world;
    this.CS = CONFIG.WORLD.CHUNK;
    this.cx = Math.ceil(world.sx / this.CS);
    this.cy = Math.ceil(world.sy / this.CS);
    this.cz = Math.ceil(world.sz / this.CS);
    this.chunks = [];
    this.dirty = new Set();
    this.texture = renderer.createTextureFromCanvas(createAtlasCanvas());
    for (let z = 0; z < this.cz; z++) for (let y = 0; y < this.cy; y++) for (let x = 0; x < this.cx; x++) {
      const c = { x, y, z, vao: null, vbo: null, count: 0, center: [(x + 0.5) * this.CS, (y + 0.5) * this.CS, (z + 0.5) * this.CS] };
      this.chunks.push(c);
      this.dirty.add(this.chunks.length - 1);
    }
    this.sun = renderer.sun;
  }
  chunkIndex(cx, cy, cz) { return (cz * this.cy + cy) * this.cx + cx; }
  markBlock(x, y, z) {
    const CS = this.CS;
    const mark = (bx, by, bz) => {
      const cx = Math.floor(bx / CS), cy = Math.floor(by / CS), cz = Math.floor(bz / CS);
      if (cx < 0 || cy < 0 || cz < 0 || cx >= this.cx || cy >= this.cy || cz >= this.cz) return;
      this.dirty.add(this.chunkIndex(cx, cy, cz));
    };
    // neighbours too (faces + AO)
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mark(x + dx, y + dy, z + dz);
  }
  markAll() { for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i); }
  update(maxPerFrame) {
    let n = 0;
    for (const i of this.dirty) {
      this.build(this.chunks[i]);
      this.dirty.delete(i);
      if (++n >= maxPerFrame) break;
    }
  }
  build(c) {
    const W = this.world, CS = this.CS;
    const out = [];
    const x0 = c.x * CS, y0 = c.y * CS, z0 = c.z * CS;
    const p = [0, 0, 0], q = [0, 0, 0];
    const solid = (x, y, z) => W.get(x, y, z) !== 0;
    const sun = this.sun;
    for (let y = y0; y < y0 + CS && y < W.sy; y++) {
      for (let z = z0; z < z0 + CS && z < W.sz; z++) {
        for (let x = x0; x < x0 + CS && x < W.sx; x++) {
          const t = W.data[W.idx(x, y, z)];
          if (!t) continue;
          const tint = 0.9 + 0.1 * S.hash3(x, y, z);
          for (const f of FACES) {
            p[0] = x; p[1] = y; p[2] = z;
            p[f.a] += f.s;
            if (solid(p[0], p[1], p[2])) continue;
            // skip faces at world floor bottom
            if (f.a === 1 && f.s < 0 && y === 0) continue;
            const n = [0, 0, 0]; n[f.a] = f.s;
            const ndl = Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]);
            const faceLight = (0.58 + 0.42 * ndl + (f.a === 1 ? (f.s > 0 ? 0.08 : -0.15) : 0)) * tint;
            const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
            const verts = [];
            for (const [cu, cv] of corners) {
              // AO neighbours in the layer in front of the face
              q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
              const du = cu ? 1 : -1, dv = cv ? 1 : -1;
              q[f.u] += du; const s1 = solid(q[0], q[1], q[2]) ? 1 : 0;
              q[f.u] -= du; q[f.v] += dv; const s2 = solid(q[0], q[1], q[2]) ? 1 : 0;
              q[f.u] += du; const s3 = solid(q[0], q[1], q[2]) ? 1 : 0;
              const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
              const pos = [x, y, z];
              if (f.s > 0) pos[f.a] += 1;
              pos[f.u] += cu; pos[f.v] += cv;
              // texture coords: V follows world Y on side faces
              let tu, tv;
              if (f.a === 0) { tu = cv; tv = cu; } else { tu = cu; tv = cv; }
              const shade = faceLight * AO_CURVE[ao];
              verts.push({ pos, tu, tv, shade, ao });
            }
            const u0 = (t * TILE + 0.02) / (TILE * TILES), u1 = ((t + 1) * TILE - 0.02) / (TILE * TILES);
            const order = f.s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
            // flip diagonal for nicer AO interpolation
            const flip = verts[0].ao + verts[2].ao < verts[1].ao + verts[3].ao;
            const ord = flip ? (f.s > 0 ? [1, 2, 3, 1, 3, 0] : [1, 3, 2, 1, 0, 3]) : order;
            for (const k of ord) {
              const v = verts[k];
              out.push(v.pos[0], v.pos[1], v.pos[2], u0 + (u1 - u0) * v.tu, 1 - v.tv, v.shade, v.shade, v.shade, n[0], n[1], n[2]);
            }
          }
        }
      }
    }
    const gl = this.gl;
    if (!c.vao) {
      c.vao = gl.createVertexArray();
      c.vbo = gl.createBuffer();
      gl.bindVertexArray(c.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
      const stride = 11 * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 20);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 32);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);
    c.count = out.length / 11;
  }
  draw(vp, cam) {
    const gl = this.gl;
    this.r.useWorld(vp, cam, this.texture);
    const planes = this.planesFrom(vp);
    const rad = this.CS * 0.87;
    for (const c of this.chunks) {
      if (!c.count) continue;
      let visible = true;
      for (const pl of planes) {
        if (pl[0] * c.center[0] + pl[1] * c.center[1] + pl[2] * c.center[2] + pl[3] < -rad) { visible = false; break; }
      }
      if (!visible) continue;
      gl.bindVertexArray(c.vao);
      gl.drawArrays(gl.TRIANGLES, 0, c.count);
      this.r.stats.draws++;
      this.r.stats.tris += c.count / 3;
    }
    gl.bindVertexArray(null);
  }
  planesFrom(m) {
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
}
