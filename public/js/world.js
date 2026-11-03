/*
 * Voxel world renderer: procedural pixel-art texture atlas + chunked mesher with
 * hidden-face culling, per-vertex ambient occlusion, baked sun shading AND baked
 * voxel-raymarched sun shadows (walls/containers cast real shadows, roofs darken interiors).
 */
const S = window.SHARED;
const { BLOCK, BLOCK_INFO, CONFIG } = S;

const TILE = 16;
const TILES = 32;

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
      let tint = null;
      switch (type) {
        case BLOCK.GROUND:
          k += (rng() < 0.08 ? -0.18 : 0) + (rng() < 0.05 ? 0.1 : 0);
          break;
        case BLOCK.WALL: case BLOCK.CONCRETE: {
          const row = Math.floor(y / 4), off = row % 2 ? 4 : 0;
          if (type === BLOCK.CONCRETE) { if (y % 8 === 0 || x % 8 === 0) k *= 0.86; k *= 1 + (rng() - 0.5) * 0.05; }
          else if (y % 4 === 0) k *= 0.82;
          else if ((x + off) % 8 === 0) k *= 0.85;
          break;
        }
        case BLOCK.BRICK: {
          const row = Math.floor(y / 4), off = row % 2 ? 4 : 0;
          if (y % 4 === 3 || (x + off) % 8 === 7) k *= 0.62;
          break;
        }
        case BLOCK.CRATE: {
          const border = x <= 1 || x >= 14 || y <= 1 || y >= 14;
          const diag = Math.abs(x - y) <= 1;
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
          if (ry === 0 || ry === 4 || cx === 0) k *= 0.78;
          if (ry === 1) k *= 1.06;
          break;
        }
        case BLOCK.SITE_A: case BLOCK.SITE_B: {
          if (x % 8 === 0 || y % 8 === 0) k *= 0.7;
          else if ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) k *= 0.88;
          break;
        }
        case BLOCK.METAL: {
          if ((x === 2 || x === 13) && (y === 2 || y === 13)) k *= 1.35;
          if (x === 0 || y === 0) k *= 1.15;
          if (x === 15 || y === 15) k *= 0.7;
          break;
        }
        case BLOCK.ASPHALT:
          k = 1 + (rng() - 0.5) * 0.22;
          if (rng() < 0.03) k *= 1.3;
          break;
        case BLOCK.CONT_R: case BLOCK.CONT_B: case BLOCK.CONT_G:
          // corrugated steel
          k *= x % 4 < 2 ? 1.08 : 0.86;
          if (y === 0 || y === 15) k *= 0.6;
          if (rng() < 0.02) tint = [0.55, 0.35, 0.2];   // rust specks
          break;
        case BLOCK.SNOW:
          k = 1 + (rng() - 0.5) * 0.05;
          if (rng() < 0.04) tint = [0.82, 0.88, 0.98];
          break;
        case BLOCK.STONE: {
          const n = Math.sin(x * 1.3 + y * 0.7) + Math.sin(x * 0.4 - y * 1.7);
          k *= 1 + n * 0.06;
          if ((x * 7 + y * 3) % 11 === 0) k *= 0.8;
          break;
        }
        case BLOCK.WOOD:
          k *= (x % 5 === 0) ? 0.72 : 1 + Math.sin(y * 0.8 + x) * 0.05;
          break;
        case BLOCK.LEAVES:
          k = 0.75 + rng() * 0.5;
          if (rng() < 0.12) tint = [0.9, 0.94, 0.98]; // snow on pine leaves
          break;
        case BLOCK.ICE:
          k = 1 + ((x + y) % 9 === 0 ? 0.25 : 0) + (rng() - 0.5) * 0.06;
          break;
      }
      const c = tint || base;
      const i = (y * img.width + type * TILE + x) * 4;
      img.data[i] = Math.min(255, c[0] * k * 255);
      img.data[i + 1] = Math.min(255, c[1] * k * 255);
      img.data[i + 2] = Math.min(255, c[2] * k * 255);
      img.data[i + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------
// Chunk mesher
// ---------------------------------------------------------------------------
const FACES = [];
for (let a = 0; a < 3; a++) for (const s of [1, -1]) FACES.push({ a, s, u: (a + 1) % 3, v: (a + 2) % 3 });
const AO_CURVE = [0.5, 0.68, 0.84, 1.0];
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

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
    this.texture = renderer.createTextureArray(createAtlasCanvas(), TILE, TILES);
    this.scratch = new Float32Array(1 << 18);
    for (let z = 0; z < this.cz; z++) for (let y = 0; y < this.cy; y++) for (let x = 0; x < this.cx; x++) {
      this.chunks.push({ x, y, z, vao: null, vbo: null, count: 0, center: [(x + 0.5) * this.CS, (y + 0.5) * this.CS, (z + 0.5) * this.CS] });
      this.dirty.add(this.chunks.length - 1);
    }
    this.shadowStrength = 0.42;
  }
  get sun() { return this.r.sun; }
  chunkIndex(cx, cy, cz) { return (cz * this.cy + cy) * this.cx + cx; }
  markChunkAt(bx, by, bz) {
    const CS = this.CS;
    const cx = Math.floor(bx / CS), cy = Math.floor(by / CS), cz = Math.floor(bz / CS);
    if (cx < 0 || cy < 0 || cz < 0 || cx >= this.cx || cy >= this.cy || cz >= this.cz) return;
    this.dirty.add(this.chunkIndex(cx, cy, cz));
  }
  markBlock(x, y, z) {
    this.updateLitAround(x, y, z);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.markChunkAt(x + dx, y + dy, z + dz);
    // chunks this block may cast a shadow onto (opposite to the sun direction)
    const s = this.sun;
    for (let t = 2; t <= 26; t += 4) this.markChunkAt(x - s[0] * t, y - s[1] * t, z - s[2] * t);
  }
  markAll() { this.computeLit(); for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i); }

  // ---- sun light grid: 1 byte per cell, 255 = cell centre sees the sun
  computeLit() {
    const W = this.world;
    if (!this.lit || this.lit.length !== W.data.length) this.lit = new Uint8Array(W.data.length);
    for (let y = 0; y < W.sy; y++) for (let z = 0; z < W.sz; z++) for (let x = 0; x < W.sx; x++) this.lit[W.idx(x, y, z)] = this.traceSun(x, y, z);
  }
  traceSun(x, y, z) {
    const W = this.world;
    if (W.data[W.idx(x, y, z)] !== 0) return 0;
    return this.sunVisibility(x + 0.5, y + 0.5, z + 0.5) ? 255 : 0;
  }
  updateLitAround(bx, by, bz) {
    if (!this.lit) return;
    const W = this.world, s = this.sun;
    const seen = new Set();
    for (let t = 0; t <= 30; t += 0.5) {
      const cx = Math.floor(bx + 0.5 - s[0] * t), cy = Math.floor(by + 0.5 - s[1] * t), cz = Math.floor(bz + 0.5 - s[2] * t);
      if (cy < 0) break;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, z = cz + dz;
        if (!W.inBounds(x, cy, z)) continue;
        const i = W.idx(x, cy, z);
        if (seen.has(i)) continue;
        seen.add(i);
        this.lit[i] = this.traceSun(x, cy, z);
      }
    }
  }
  litAt(x, y, z) {
    const W = this.world;
    if (y >= W.sy) return 255;
    if (!W.inBounds(x, y, z)) return -1;
    if (W.data[W.idx(x, y, z)] !== 0) return -1;
    return this.lit[W.idx(x, y, z)];
  }
  /** Rebuild dirty chunks within a per-frame time budget (no frame spikes when walls break). */
  update(maxPerFrame, budgetMs) {
    const t0 = performance.now();
    const budget = budgetMs || 4;
    let n = 0;
    // chunks near the camera first
    const order = [...this.dirty];
    if (this.focus && order.length > 1) {
      const f = this.focus;
      order.sort((a, b) => {
        const ca = this.chunks[a].center, cb = this.chunks[b].center;
        return ((ca[0] - f[0]) ** 2 + (ca[2] - f[2]) ** 2) - ((cb[0] - f[0]) ** 2 + (cb[2] - f[2]) ** 2);
      });
    }
    for (const i of order) {
      this.build(this.chunks[i]);
      this.dirty.delete(i);
      if (++n >= maxPerFrame || performance.now() - t0 > budget) break;
    }
  }
  /** 1 = lit, 0 = fully shadowed. Voxel ray-march towards the sun. */
  sunVisibility(px, py, pz) {
    const W = this.world, s = this.sun;
    let x = px, y = py, z = pz;
    for (let i = 0; i < 34; i++) {
      const st = i < 6 ? 0.5 : 0.8;
      x += s[0] * st; y += s[1] * st; z += s[2] * st;
      if (y >= W.sy) return 1;
      if (W.get(Math.floor(x), Math.floor(y), Math.floor(z)) !== 0) return 0;
    }
    return 1;
  }
  build(c) {
    const W = this.world, CS = this.CS;
    let out = this.scratch, n = 0;
    const x0 = c.x * CS, y0 = c.y * CS, z0 = c.z * CS;
    const p = [0, 0, 0], q = [0, 0, 0], pos = [0, 0, 0];
    const solid = (x, y, z) => W.get(x, y, z) !== 0;
    const sun = this.sun;
    const shadowK = this.shadowStrength;
    const verts = [{}, {}, {}, {}];
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
            if (f.a === 1 && f.s < 0 && y === 0) continue;
            const nx = f.a === 0 ? f.s : 0, ny = f.a === 1 ? f.s : 0, nz = f.a === 2 ? f.s : 0;
            const ndl = Math.max(0, nx * sun[0] + ny * sun[1] + nz * sun[2]);
            const faceBase = (0.6 + (f.a === 1 ? (f.s > 0 ? 0.06 : -0.15) : 0)) * tint;
            for (let k = 0; k < 4; k++) {
              const cu = CORNERS[k][0], cv = CORNERS[k][1];
              q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
              const du = cu ? 1 : -1, dv = cv ? 1 : -1;
              q[f.u] += du; const s1 = solid(q[0], q[1], q[2]) ? 1 : 0;
              q[f.u] -= du; q[f.v] += dv; const s2 = solid(q[0], q[1], q[2]) ? 1 : 0;
              q[f.u] += du; const s3 = solid(q[0], q[1], q[2]) ? 1 : 0;
              const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
              pos[0] = x; pos[1] = y; pos[2] = z;
              if (f.s > 0) pos[f.a] += 1;
              pos[f.u] += cu; pos[f.v] += cv;
              // sun shadow from the light grid: average the air cells touching this vertex in front of the face
              let lit = 0;
              if (ndl > 0.01) {
                let sum = 0, cnt = 0;
                for (let a2 = -1; a2 <= 0; a2++) for (let b2 = -1; b2 <= 0; b2++) {
                  q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
                  q[f.u] += cu + a2; q[f.v] += cv + b2;
                  const l = this.litAt(q[0], q[1], q[2]);
                  if (l >= 0) { sum += l; cnt++; }
                }
                lit = cnt ? (sum / cnt / 255) * ndl : 0;
              }
              const light = faceBase + 0.45 * lit - (ndl > 0.01 ? shadowK * 0.12 * (1 - lit / ndl) : 0);
              const v = verts[k];
              v.x = pos[0]; v.y = pos[1]; v.z = pos[2];
              v.tu = f.a === 0 ? cv : cu; v.tv = f.a === 0 ? cu : cv;
              v.shade = light * AO_CURVE[ao];
              v.ao = ao;
            }
            const flip = verts[0].ao + verts[2].ao < verts[1].ao + verts[3].ao;
            const ord = flip ? (f.s > 0 ? [1, 2, 3, 1, 3, 0] : [1, 3, 2, 1, 0, 3]) : (f.s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
            if (n + 72 > out.length) { const bigger = new Float32Array(out.length * 2); bigger.set(out); out = this.scratch = bigger; }
            for (const k of ord) {
              const v = verts[k];
              out[n++] = v.x; out[n++] = v.y; out[n++] = v.z;
              out[n++] = v.tu; out[n++] = 1 - v.tv; out[n++] = t;
              out[n++] = v.shade; out[n++] = v.shade; out[n++] = v.shade * (t === BLOCK.SNOW || t === BLOCK.ICE ? 1.03 : 1);
              out[n++] = nx; out[n++] = ny; out[n++] = nz;
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
      const stride = 12 * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 36);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, n), gl.STATIC_DRAW);
    c.count = n / 12;
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
    const p = this._planes || (this._planes = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const set = (i, a, b, c, d) => { const l = Math.hypot(a, b, c); p[i][0] = a / l; p[i][1] = b / l; p[i][2] = c / l; p[i][3] = d / l; };
    set(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
    set(1, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
    set(2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
    set(3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
    set(4, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
    set(5, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
    return p;
  }

  /** Top-down colour image of the map for the radar / menu thumbnails. */
  static topDownCanvas(world, map, scale, noLetters) {
    scale = scale || 4;
    const cv = document.createElement('canvas');
    cv.width = world.sx * scale; cv.height = world.sz * scale;
    const ctx = cv.getContext('2d');
    for (let z = 0; z < world.sz; z++) for (let x = 0; x < world.sx; x++) {
      let h = 0, t = 0;
      for (let y = world.sy - 1; y >= 0; y--) { const b = world.get(x, y, z); if (b) { h = y; t = b; break; } }
      const c = BLOCK_INFO[t].color;
      const walkable = h === 0;
      const k = walkable ? 0.55 : 0.85 + Math.min(h, 8) * 0.03;
      ctx.fillStyle = `rgb(${Math.round(c[0] * k * 255)},${Math.round(c[1] * k * 255)},${Math.round(c[2] * k * 255)})`;
      ctx.fillRect(x * scale, (world.sz - 1 - z) * scale, scale, scale);
    }
    if (noLetters) return cv;
    // site letters
    ctx.font = `bold ${scale * 6}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const s of ['A', 'B']) {
      const c = S.siteCenter(map, s);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(s, c[0] * scale, (world.sz - c[1]) * scale);
    }
    return cv;
  }
}
