/*
 * World-space VFX: tracers, voxel debris particles, smoke, brass casings, bullet-hole decals,
 * dynamic flash lights (muzzle/explosion), screen shake.
 */
const S = window.SHARED;
const { BLOCK_INFO } = S;

let MAX_PARTICLES = 600;
export function setParticleBudget(n) { MAX_PARTICLES = n; }
const MAX_DECALS = 90;

export class Effects {
  constructor(world) {
    this.world = world;
    this.tracers = [];
    this.particles = [];
    this.decals = [];
    this.lights = [];
    this.shake = 0;
  }

  tracer(a, b, color) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (len < 0.5) return;
    this.tracers.push({ a, b, len, t: 0, c: color || [1, 0.85, 0.5] });
  }

  light(x, y, z, intensity, color, decay) {
    this.lights.push({ x, y, z, i: intensity, c: color || [1, 0.75, 0.4], decay: decay || 25 });
    if (this.lights.length > 8) this.lights.shift();
  }

  particle(p) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  impact(point, normal, blockType) {
    const col = blockType ? BLOCK_INFO[blockType].color : [0.5, 0.5, 0.5];
    const n = normal || [0, 1, 0];
    for (let i = 0; i < 7; i++) {
      this.particle({
        x: point[0] + n[0] * 0.03, y: point[1] + n[1] * 0.03, z: point[2] + n[2] * 0.03,
        vx: n[0] * 2.5 + (Math.random() - 0.5) * 3, vy: n[1] * 2.5 + Math.random() * 2.5, vz: n[2] * 2.5 + (Math.random() - 0.5) * 3,
        life: 0.5 + Math.random() * 0.4, max: 0.9, s: 0.04 + Math.random() * 0.04,
        c: [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85], g: 14, a: 1
      });
    }
    // dust puff
    for (let i = 0; i < 3; i++) {
      this.particle({
        x: point[0], y: point[1], z: point[2],
        vx: n[0] * 0.8 + (Math.random() - 0.5) * 0.6, vy: n[1] * 0.8 + 0.4, vz: n[2] * 0.8 + (Math.random() - 0.5) * 0.6,
        life: 0.6, max: 0.6, s: 0.12, grow: 0.5, c: [col[0] * 0.9 + 0.1, col[1] * 0.9 + 0.1, col[2] * 0.9 + 0.1], g: -0.5, a: 0.5, alpha: true
      });
    }
    if (normal && blockType) this.decal(point, normal);
  }

  blood(point, dir) {
    for (let i = 0; i < 10; i++) {
      this.particle({
        x: point[0], y: point[1], z: point[2],
        vx: dir[0] * 2 + (Math.random() - 0.5) * 2.5, vy: dir[1] * 2 + Math.random() * 2, vz: dir[2] * 2 + (Math.random() - 0.5) * 2.5,
        life: 0.45 + Math.random() * 0.3, max: 0.75, s: 0.05 + Math.random() * 0.04, c: [0.62, 0.05, 0.06], g: 12, a: 1
      });
    }
  }

  blockBreak(x, y, z, type) {
    const col = BLOCK_INFO[type] ? BLOCK_INFO[type].color : [0.6, 0.5, 0.3];
    for (let i = 0; i < 18; i++) {
      this.particle({
        x: x + Math.random(), y: y + Math.random(), z: z + Math.random(),
        vx: (Math.random() - 0.5) * 4, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 4,
        life: 0.9 + Math.random() * 0.8, max: 1.7, s: 0.1 + Math.random() * 0.1,
        c: [col[0] * (0.8 + Math.random() * 0.25), col[1] * (0.8 + Math.random() * 0.25), col[2] * (0.8 + Math.random() * 0.25)], g: 16, a: 1, spin: true
      });
    }
    this.decals = this.decals.filter((d) => !(Math.floor(d.bx) === x && Math.floor(d.by) === y && Math.floor(d.bz) === z));
  }

  shell(pos, right, up, fwd) {
    this.particle({
      x: pos[0], y: pos[1], z: pos[2],
      vx: right[0] * 2.2 + up[0] * 1.6 + (Math.random() - 0.5) * 0.4 + fwd[0] * -0.3,
      vy: right[1] * 2.2 + up[1] * 1.6 + Math.random() * 0.5,
      vz: right[2] * 2.2 + up[2] * 1.6 + (Math.random() - 0.5) * 0.4 + fwd[2] * -0.3,
      life: 1.4, max: 1.4, s: 0.025, sl: 0.06, c: [0.85, 0.65, 0.22], g: 14, a: 1, spin: true, e: 0.2
    });
  }

  muzzleSmoke(pos) {
    for (let i = 0; i < 2; i++) {
      this.particle({
        x: pos[0], y: pos[1], z: pos[2], vx: (Math.random() - 0.5) * 0.4, vy: 0.4 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.4,
        life: 0.7, max: 0.7, s: 0.06, grow: 0.35, c: [0.75, 0.75, 0.75], g: -0.4, a: 0.35, alpha: true
      });
    }
  }

  explosion(x, y, z) {
    this.light(x, y + 1, z, 30, [1, 0.6, 0.25], 6);
    this.shake = Math.max(this.shake, 1.2);
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.5, sp = 4 + Math.random() * 12;
      const fire = i < 55;
      this.particle({
        x, y: y + 0.4, z,
        vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp,
        life: fire ? 0.5 + Math.random() * 0.5 : 1.5 + Math.random(), max: fire ? 1 : 2.5,
        s: fire ? 0.25 + Math.random() * 0.3 : 0.4 + Math.random() * 0.4, grow: fire ? 0.6 : 1.2,
        c: fire ? [1, 0.55 + Math.random() * 0.3, 0.15] : [0.3, 0.3, 0.3], g: fire ? 2 : -1, a: fire ? 1 : 0.6,
        e: fire ? 1 : 0, alpha: !fire, drag: 2.5
      });
    }
  }

  heBlast(x, y, z) {
    this.light(x, y + 0.5, z, 14, [1, 0.62, 0.3], 9);
    this.shake = Math.max(this.shake, 0.6);
    for (let i = 0; i < 45; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.5, sp = 3 + Math.random() * 8;
      const fire = i < 26;
      this.particle({
        x, y: y + 0.2, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp,
        life: fire ? 0.35 + Math.random() * 0.3 : 1.2 + Math.random(), max: fire ? 0.65 : 2,
        s: fire ? 0.18 + Math.random() * 0.2 : 0.3 + Math.random() * 0.3, grow: fire ? 0.5 : 0.9,
        c: fire ? [1, 0.6 + Math.random() * 0.3, 0.2] : [0.32, 0.31, 0.3], g: fire ? 1 : -0.8, a: fire ? 1 : 0.55,
        e: fire ? 1 : 0, alpha: !fire, drag: 3
      });
    }
  }

  flashBurst(x, y, z) {
    this.light(x, y + 0.3, z, 40, [1, 1, 0.95], 22);
    for (let i = 0; i < 16; i++) {
      this.particle({ x, y: y + 0.1, z, vx: (Math.random() - 0.5) * 6, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 6,
        life: 0.25, max: 0.25, s: 0.06, c: [1, 1, 0.9], g: 4, a: 1, e: 1 });
    }
  }

  /** headshot on a helmeted player: the helmet flies off and bounces on the floor */
  helmetPop(pos, dir, color) {
    this.particle({
      x: pos[0], y: pos[1], z: pos[2],
      vx: dir[0] * 4 + (Math.random() - 0.5), vy: 3.5 + Math.random() * 1.5, vz: dir[2] * 4 + (Math.random() - 0.5),
      life: 4, max: 4, s: 0.34, sl: 0.34, c: color || [0.24, 0.29, 0.23], g: 13, a: 1, spin: true
    });
    for (let i = 0; i < 6; i++) this.particle({ x: pos[0], y: pos[1], z: pos[2], vx: (Math.random() - 0.5) * 3 + dir[0] * 2, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 3 + dir[2] * 2,
      life: 0.25, max: 0.25, s: 0.03, c: [1, 0.9, 0.6], g: 6, a: 1, e: 1 });
  }

  molotovBurst(x, y, z) {
    this.light(x, y + 0.5, z, 10, [1, 0.55, 0.2], 4);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 4;
      this.particle({ x, y: y + 0.2, z, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 3, vz: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.4, max: 0.8, s: 0.12 + Math.random() * 0.12, grow: 0.4, c: [1, 0.5 + Math.random() * 0.3, 0.12], g: 1, a: 1, e: 1, drag: 2 });
    }
    for (let i = 0; i < 8; i++) this.particle({ x, y: y + 0.3, z, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 5,
      life: 0.8, max: 0.8, s: 0.03, c: [0.55, 0.7, 0.4], g: 14, a: 1, spin: true });     // glass shards
  }
  fireOut(x, y, z) {
    for (let i = 0; i < 14; i++) this.particle({ x: x + (Math.random() - 0.5) * 3, y: y + 0.3, z: z + (Math.random() - 0.5) * 3, vx: 0, vy: 1 + Math.random(), vz: 0,
      life: 1.4, max: 1.4, s: 0.25, grow: 0.6, c: [0.6, 0.6, 0.62], g: -0.4, a: 0.45, alpha: true });
  }
  breachBlast(x, y, z) {
    this.light(x, y, z, 22, [1, 0.6, 0.3], 7);
    this.shake = Math.max(this.shake, 0.9);
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI * 0.6, sp = 3 + Math.random() * 9;
      const fire = i < 24;
      this.particle({ x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 1, vz: Math.sin(a) * Math.cos(e) * sp,
        life: fire ? 0.35 + Math.random() * 0.3 : 1.3 + Math.random(), max: fire ? 0.65 : 2.2,
        s: fire ? 0.2 + Math.random() * 0.2 : 0.35 + Math.random() * 0.35, grow: fire ? 0.5 : 1.1,
        c: fire ? [1, 0.6, 0.2] : [0.4, 0.38, 0.35], g: fire ? 1 : -0.6, a: fire ? 1 : 0.6, e: fire ? 1 : 0, alpha: !fire, drag: 3 });
    }
  }
  /** burning molotov areas (rendered every frame from the snapshot list) */
  renderFires(add, fires, serverNow, dt) {
    const G = S.CONFIG.GRENADE.molotov;
    for (const f of fires) {
      const age = (serverNow - f.t0) / 1000;
      if (age < 0 || age > G.duration) continue;
      const fade = age > G.duration - 1 ? G.duration - age : 1;
      const rng = S.mulberry32(f.id * 104729);
      const n = Math.round((this.smokeCubes || 70) * 0.6);
      const t = performance.now() / 1000;
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * G.radius * Math.min(1, age * 2.5 + 0.3);
        const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
        if (this.world.isSolid(Math.floor(x), f.y, Math.floor(z))) continue;
        const ph = rng() * 10;
        const h = (0.25 + 0.45 * Math.abs(Math.sin(t * (3 + rng() * 3) + ph))) * fade;
        const s = 0.18 + rng() * 0.16;
        add.pushAABB(x, f.y + h * 0.5, z, s, h, s, 1, 0.42 + rng() * 0.3, 0.08, 0.75 * fade, 1);
      }
      if (Math.random() < dt * 6) this.light(f.x, f.y + 0.6, f.z, 2.2 + Math.random(), [1, 0.5, 0.18], 14);
      if (Math.random() < dt * 8) this.particle({ x: f.x + (Math.random() - 0.5) * G.radius, y: f.y + 0.6, z: f.z + (Math.random() - 0.5) * G.radius, vx: 0, vy: 1.2, vz: 0,
        life: 1.6, max: 1.6, s: 0.22, grow: 0.5, c: [0.22, 0.2, 0.2], g: -0.6, a: 0.4, alpha: true });
    }
  }

  /** Voxel smoke clouds: deterministic cube clusters that grow, swirl and fade. */
  renderSmokes(alpha, smokes, serverNow) {
    const G = S.CONFIG.GRENADE.smoke;
    for (const sm of smokes) {
      const age = (serverNow - sm.t0) / 1000;
      if (age < 0 || age > G.duration) continue;
      const grow = Math.min(1, age / 1.6);
      const fade = age > G.duration - 2.5 ? (G.duration - age) / 2.5 : 1;
      const rng = S.mulberry32(sm.id * 7919);
      const R = G.radius * (0.35 + 0.65 * grow);
      const cubes = this.smokeCubes || 70;
      for (let i = 0; i < cubes; i++) {
        const u = rng() * 2 - 1, th = rng() * Math.PI * 2, rr = Math.cbrt(rng());
        const q = Math.sqrt(1 - u * u);
        const swirl = Math.sin(age * 0.6 + i) * 0.25;
        const x = sm.x + q * Math.cos(th + swirl * 0.2) * R * rr;
        const y = sm.y + u * R * rr * 0.55 + age * 0.04;
        const zz = sm.z + q * Math.sin(th + swirl * 0.2) * R * rr;
        const size = (1.1 + rng() * 0.9) * (0.5 + 0.5 * grow) * (cubes < 70 ? 1.25 : 1);
        const shade = 0.72 + rng() * 0.16;
        alpha.pushAABB(x, Math.max(1, y), zz, size, size, size, shade, shade, shade * 1.02, (rr < 0.6 ? 0.82 : 0.5) * fade, 0.25);
      }
    }
  }

  decal(point, normal) {
    const d = { x: point[0] + normal[0] * 0.004, y: point[1] + normal[1] * 0.004, z: point[2] + normal[2] * 0.004, n: normal,
      bx: point[0] - normal[0] * 0.05, by: point[1] - normal[1] * 0.05, bz: point[2] - normal[2] * 0.05 };
    this.decals.push(d);
    if (this.decals.length > MAX_DECALS) this.decals.shift();
  }

  clearDecals() { this.decals = []; }

  update(dt) {
    const W = this.world;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt;
      if (t.t * 280 - 4 > t.len) this.tracers.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vy -= (p.g || 0) * dt;
      if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (!p.alpha && W.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        if (W.isSolid(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))) { p.vy = -p.vy * 0.3; p.vx *= 0.6; p.vz *= 0.6; }
        else { p.vx = -p.vx * 0.3; p.vz = -p.vz * 0.3; }
      } else { p.x = nx; p.y = ny; p.z = nz; }
      if (p.grow) p.s += p.grow * dt;
      if (p.spin) p.rot = (p.rot || 0) + dt * 12;
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.i -= l.decay * dt * Math.max(1, l.i);
      if (l.i <= 0.02) this.lights.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  activeLights(cam) {
    return this.lights
      .map((l) => ({ l, d: Math.hypot(l.x - cam[0], l.y - cam[1], l.z - cam[2]) }))
      .sort((a, b) => a.d - b.d).slice(0, 4).map((o) => o.l);
  }

  render(opaque, alpha, add) {
    const tmp = this._m || (this._m = new Float32Array(16));
    for (const d of this.decals) {
      const n = d.n;
      const sx = n[0] ? 0.008 : 0.09, sy = n[1] ? 0.008 : 0.09, sz = n[2] ? 0.008 : 0.09;
      opaque.pushAABB(d.x, d.y, d.z, sx, sy, sz, 0.12, 0.1, 0.09, 1, 0);
    }
    for (const p of this.particles) {
      const f = Math.min(1, p.life / (p.max * 0.4));
      const a = p.a * (p.alpha ? f : 1);
      const s = p.s * (p.alpha ? 1 : Math.min(1, 0.4 + f));
      if (p.rot) {
        const c = Math.cos(p.rot), si = Math.sin(p.rot);
        tmp.fill(0);
        tmp[0] = c; tmp[1] = si; tmp[4] = -si; tmp[5] = c; tmp[10] = 1; tmp[12] = p.x; tmp[13] = p.y; tmp[14] = p.z; tmp[15] = 1;
        opaque.pushBox(tmp, 0, 0, 0, s, s, p.sl || s, p.c[0], p.c[1], p.c[2], 1, p.e || 0);
      } else if (p.e) {
        add.pushAABB(p.x, p.y, p.z, s, s, s, p.c[0], p.c[1], p.c[2], a * f, 1);
      } else if (p.alpha) {
        alpha.pushAABB(p.x, p.y, p.z, s, s, s, p.c[0], p.c[1], p.c[2], a, 0);
      } else {
        opaque.pushAABB(p.x, p.y, p.z, s, s, s, p.c[0], p.c[1], p.c[2], 1, 0);
      }
    }
    for (const t of this.tracers) {
      const head = Math.min(t.t * 280, t.len), tail = Math.max(0, head - 4);
      if (tail >= t.len) continue;
      const dx = (t.b[0] - t.a[0]) / t.len, dy = (t.b[1] - t.a[1]) / t.len, dz = (t.b[2] - t.a[2]) / t.len;
      add.pushSegment(t.a[0] + dx * tail, t.a[1] + dy * tail, t.a[2] + dz * tail, t.a[0] + dx * head, t.a[1] + dy * head, t.a[2] + dz * head,
        0.022, t.c[0], t.c[1], t.c[2], 0.75, 1);
    }
  }
}
