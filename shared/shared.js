/*
 * BLOCK OPS: TACTICAL DRIFT — Shared deterministic core
 * Used by BOTH the Node.js server (require) and the browser client (window.SHARED).
 * Everything that must give identical results on both sides lives here:
 * config, voxel world + DDA raycast, player physics, weapons, recoil, spread, hitboxes,
 * map registry + A* navigation, grenade physics. Map layouts live in shared/maps.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); require('./maps.js')(module.exports); }
  else root.SHARED = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIG
  // ---------------------------------------------------------------------------
  const CONFIG = {
    VERSION: '2.3.1',
    TICK_RATE: 30,            // server simulation + snapshot rate (Hz)
    INPUT_RATE: 60,           // client fixed input/physics step (Hz)
    INTERP_DELAY_MS: 100,     // base remote interpolation delay (client adapts to jitter)
    MAX_REWIND_MS: 400,       // lag compensation cap
    MAX_PER_TEAM: 5,
    FRIENDLY_FIRE: false,
    WORLD: { X: 64, Y: 16, Z: 64, CHUNK: 16 },
    PLAYER: { RADIUS: 0.3, HEIGHT: 1.8, CROUCH_HEIGHT: 1.3, EYE: 1.62, CROUCH_EYE: 1.15, MAX_HP: 100 },
    MOVE: {
      RUN_SPEED: 7.4, WALK_MUL: 0.52, CROUCH_MUL: 0.38, SCOPED_MUL: 0.55,
      GROUND_ACCEL: 12.0, AIR_ACCEL: 14.0, AIR_WISH_CAP: 1.0, MAX_AIR_SPEED: 9.2,
      FRICTION: 6.2, STOP_SPEED: 2.2, GRAVITY: 22.0, JUMP_VEL: 7.4, MAX_FALL: 30.0
    },
    ROUND: {
      WARMUP: 12, FREEZE: 10, LIVE: 115, POST: 6, BUY_WINDOW: 20,
      HALF: 12, WIN: 13, MAX_ROUNDS: 24, GAMEOVER: 14, WARMUP_RESPAWN: 2.5
    },
    BOMB: {
      PLANT: 3.2, TIMER: 40, DEFUSE: 10, DEFUSE_KIT: 5, DEFUSE_RANGE: 2.0,
      PICKUP_RANGE: 1.4, RADIUS: 12, DAMAGE: 500, BLOCK_RADIUS: 3.5
    },
    ECON: {
      START: 800, MAX: 16000, WARMUP_MONEY: 16000,
      WIN_ELIM: 3250, WIN_BOMB: 3500, WIN_DEFUSE: 3500, WIN_TIME: 3250,
      LOSS_BASE: 1400, LOSS_STEP: 500, LOSS_MAX: 3400,
      PLANT_TEAM_BONUS: 800, PLANT_REWARD: 300, DEFUSE_REWARD: 300
    },
    GRENADE: {
      GRAVITY: 20, THROW_SPEED: 16, LOB_SPEED: 8, BOUNCE: 0.42, FRICTION: 0.72, RADIUS: 0.08,
      MAX: { he: 1, flash: 2, smoke: 1 }, MAX_TOTAL: 4,
      he: { fuse: 1.6, radius: 6.5, damage: 98, blockRadius: 2.4 },
      flash: { fuse: 1.5, range: 34, maxBlind: 3.8 },
      smoke: { minFuse: 1.2, maxFuse: 3.5, radius: 3.8, duration: 17 }
    },
    FALL: { SAFE_SPEED: 11.0, DMG_PER: 8.0 },
    PART_MUL: { head: 4.0, chest: 1.0, legs: 0.75 }
  };

  /*
   * Difficulty presets. "bot" tunes the AI, the rest tunes the rules of the match.
   * botDamageMul = damage bots deal to HUMANS (humans always deal full damage).
   */
  const DIFFICULTY = {
    easy: {
      id: 'easy', label: 'KOLAY', desc: 'Yavaş tepki veren, ıskalayan botlar · bol para · botlar az hasar verir',
      startMoney: 2400, botDamageMul: 0.55, lossBonusMul: 1.25,
      bot: { react: [600, 950], aimErr: 0.36, turn: 4.0, head: 0.05, comp: 0.3, burst: [2, 4], pause: [350, 700], fovDot: 0.15, spot: 42, strafe: 0.3, smart: 0.2 }
    },
    medium: {
      id: 'medium', label: 'ORTA', desc: 'Dengeli botlar · klasik rekabetçi ekonomi',
      startMoney: 1000, botDamageMul: 0.85, lossBonusMul: 1.0,
      bot: { react: [320, 560], aimErr: 0.18, turn: 7.0, head: 0.12, comp: 0.62, burst: [3, 6], pause: [220, 450], fovDot: -0.2, spot: 58, strafe: 0.6, smart: 0.55 }
    },
    hard: {
      id: 'hard', label: 'ZOR', desc: 'Hızlı nişan alan, sprey kontrolü yapan botlar · CS kuralları birebir',
      startMoney: 800, botDamageMul: 1.0, lossBonusMul: 1.0,
      bot: { react: [150, 290], aimErr: 0.07, turn: 11.5, head: 0.26, comp: 0.9, burst: [4, 9], pause: [140, 280], fovDot: -0.5, spot: 72, strafe: 0.9, smart: 0.9 }
    }
  };

  // Input buttons (bitmask)
  const BTN = { JUMP: 1, CROUCH: 2, WALK: 4, USE: 8, FIRE: 16 };

  // ---------------------------------------------------------------------------
  // BLOCKS
  // ---------------------------------------------------------------------------
  const BLOCK = {
    AIR: 0, GROUND: 1, WALL: 2, CRATE: 3, PLANK: 4, SAND: 5, SITE_A: 6, SITE_B: 7, METAL: 8, BRICK: 9,
    ASPHALT: 10, CONT_R: 11, CONT_B: 12, CONT_G: 13, SNOW: 14, STONE: 15, WOOD: 16, LEAVES: 17, CONCRETE: 18, ICE: 19,
    WINDOW: 20, LAMP: 21
  };
  // hp: 0 = indestructible
  const BLOCK_INFO = [
    { name: 'air', hp: 0, color: [0, 0, 0] },
    { name: 'ground', hp: 0, color: [0.62, 0.55, 0.42] },
    { name: 'wall', hp: 0, color: [0.78, 0.72, 0.60] },
    { name: 'crate', hp: 90, color: [0.66, 0.46, 0.24] },
    { name: 'plank', hp: 45, color: [0.74, 0.58, 0.36] },
    { name: 'sand', hp: 160, color: [0.82, 0.74, 0.52] },
    { name: 'siteA', hp: 0, color: [0.80, 0.36, 0.30] },
    { name: 'siteB', hp: 0, color: [0.34, 0.46, 0.80] },
    { name: 'metal', hp: 0, color: [0.50, 0.55, 0.60] },
    { name: 'brick', hp: 0, color: [0.66, 0.38, 0.30] },
    { name: 'asphalt', hp: 0, color: [0.34, 0.35, 0.37] },
    { name: 'containerRed', hp: 0, color: [0.66, 0.22, 0.17] },
    { name: 'containerBlue', hp: 0, color: [0.20, 0.36, 0.62] },
    { name: 'containerGreen', hp: 0, color: [0.26, 0.47, 0.30] },
    { name: 'snow', hp: 0, color: [0.90, 0.93, 0.97] },
    { name: 'stone', hp: 0, color: [0.53, 0.54, 0.56] },
    { name: 'wood', hp: 0, color: [0.44, 0.31, 0.20] },
    { name: 'leaves', hp: 25, color: [0.24, 0.42, 0.30] },
    { name: 'concrete', hp: 0, color: [0.60, 0.61, 0.62] },
    { name: 'ice', hp: 0, color: [0.66, 0.82, 0.93] },
    { name: 'window', hp: 0, color: [0.22, 0.3, 0.38] },
    { name: 'lamp', hp: 0, color: [1.0, 0.86, 0.55], glow: 1 }
  ];

  // ---------------------------------------------------------------------------
  // MATH HELPERS
  // ---------------------------------------------------------------------------
  const DEG = Math.PI / 180;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
  function lerpAngle(a, b, t) { return a + wrapAngle(b - a) * t; }
  function anglesToDir(yaw, pitch) {
    const cp = Math.cos(pitch);
    return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  }
  function dirToAngles(d) {
    return { yaw: Math.atan2(-d[0], -d[2]), pitch: Math.asin(clamp(d[1], -1, 1)) };
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shotSeed(playerNum, seq) {
    return (Math.imul(playerNum | 0, 73856093) ^ Math.imul(seq | 0, 19349663)) >>> 0;
  }
  function hash3(x, y, z) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------------------
  // VOXEL WORLD
  // ---------------------------------------------------------------------------
  class VoxelWorld {
    constructor(sx, sy, sz) {
      this.sx = sx || CONFIG.WORLD.X;
      this.sy = sy || CONFIG.WORLD.Y;
      this.sz = sz || CONFIG.WORLD.Z;
      this.data = new Uint8Array(this.sx * this.sy * this.sz);
    }
    idx(x, y, z) { return (y * this.sz + z) * this.sx + x; }
    inBounds(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz; }
    get(x, y, z) {
      if (y >= this.sy) return BLOCK.AIR;
      if (x < 0 || z < 0 || y < 0 || x >= this.sx || z >= this.sz) return BLOCK.WALL;
      return this.data[(y * this.sz + z) * this.sx + x];
    }
    set(x, y, z, t) { if (this.inBounds(x, y, z)) this.data[this.idx(x, y, z)] = t; }
    isSolid(x, y, z) { return this.get(x, y, z) !== BLOCK.AIR; }
    /**
     * Amanatides & Woo voxel traversal. Calls cb(x,y,z,tEnter,normal,type) for every
     * SOLID voxel the ray enters. Return true from cb to stop.
     */
    traverse(o, d, maxDist, cb) {
      let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
      const stepX = d[0] > 0 ? 1 : d[0] < 0 ? -1 : 0;
      const stepY = d[1] > 0 ? 1 : d[1] < 0 ? -1 : 0;
      const stepZ = d[2] > 0 ? 1 : d[2] < 0 ? -1 : 0;
      const tDX = stepX !== 0 ? Math.abs(1 / d[0]) : Infinity;
      const tDY = stepY !== 0 ? Math.abs(1 / d[1]) : Infinity;
      const tDZ = stepZ !== 0 ? Math.abs(1 / d[2]) : Infinity;
      let tMX = stepX > 0 ? (x + 1 - o[0]) * tDX : stepX < 0 ? (o[0] - x) * tDX : Infinity;
      let tMY = stepY > 0 ? (y + 1 - o[1]) * tDY : stepY < 0 ? (o[1] - y) * tDY : Infinity;
      let tMZ = stepZ > 0 ? (z + 1 - o[2]) * tDZ : stepZ < 0 ? (o[2] - z) * tDZ : Infinity;
      let t = 0;
      let nx = 0, ny = 0, nz = 0;
      for (let guard = 0; guard < 1024; guard++) {
        if (tMX < tMY && tMX < tMZ) { x += stepX; t = tMX; tMX += tDX; nx = -stepX; ny = 0; nz = 0; }
        else if (tMY < tMZ) { y += stepY; t = tMY; tMY += tDY; nx = 0; ny = -stepY; nz = 0; }
        else { z += stepZ; t = tMZ; tMZ += tDZ; nx = 0; ny = 0; nz = -stepZ; }
        if (t > maxDist) return;
        if (y >= this.sy && stepY >= 0) return;
        const type = this.get(x, y, z);
        if (type !== BLOCK.AIR && cb(x, y, z, t, [nx, ny, nz], type)) return;
      }
    }
    raycast(o, d, maxDist) {
      let res = null;
      this.traverse(o, d, maxDist, (x, y, z, t, n, type) => { res = { x, y, z, t, normal: n, type }; return true; });
      return res;
    }
  }

  // ---------------------------------------------------------------------------
  // MAP REGISTRY  (map definitions live in shared/maps.js)
  // A map: { id, name, desc, theme, spawns:{T,CT}, spawnYaw:{T,CT}, buyZones:{T,CT}, sites:{A,B}, build(world, box) }
  // ---------------------------------------------------------------------------
  const MAPS = {};
  const MAP_ORDER = [];
  function registerMap(def) { if (!MAPS[def.id]) MAP_ORDER.push(def.id); MAPS[def.id] = def; }
  function getMap(id) { return MAPS[id] || MAPS[MAP_ORDER[0]]; }
  function nextMapId(id) { const i = MAP_ORDER.indexOf(id); return MAP_ORDER[(i + 1) % MAP_ORDER.length]; }
  function generateMap(world, mapId) {
    const W = world;
    W.data.fill(0);
    const box = (x0, y0, z0, x1, y1, z1, t) => {
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) W.set(x, y, z, t);
    };
    getMap(mapId).build(W, box);
    return W;
  }
  function inZone(zone, x, z) { return x >= zone.x0 && x <= zone.x1 && z >= zone.z0 && z <= zone.z1; }
  function siteAt(map, x, z) {
    if (inZone(map.sites.A, x, z)) return 'A';
    if (inZone(map.sites.B, x, z)) return 'B';
    return null;
  }
  function siteCenter(map, s) { const z = map.sites[s]; return [(z.x0 + z.x1 + 1) / 2, (z.z0 + z.z1 + 1) / 2]; }

  // ---------------------------------------------------------------------------
  // NAVIGATION — 2D walkable grid at floor level + A* + string-pulling.
  // Works on any map automatically (no hand-placed waypoints) and updates
  // when walls are destroyed.
  // ---------------------------------------------------------------------------
  function buildNav(world) {
    const sx = world.sx, sz = world.sz;
    const walk = new Uint8Array(sx * sz);
    const cost = new Float32Array(sx * sz);
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const ok = world.get(x, 0, z) !== 0 && world.get(x, 1, z) === 0 && world.get(x, 2, z) === 0;
      walk[z * sx + x] = ok ? 1 : 0;
    }
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const i = z * sx + x;
      if (!walk[i]) continue;
      let near = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= sx || nz >= sz || !walk[nz * sx + nx]) near++;
      }
      cost[i] = 1 + (near ? 1.2 : 0);
    }
    return { sx, sz, walk, cost };
  }
  function nearestWalkable(nav, x, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    for (let r = 0; r < 8; r++) {
      let best = null, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= nav.sx || nz >= nav.sz || !nav.walk[nz * nav.sx + nx]) continue;
        const d = Math.hypot(nx + 0.5 - x, nz + 0.5 - z);
        if (d < bd) { bd = d; best = [nx, nz]; }
      }
      if (best) return best;
    }
    return null;
  }
  /** A* (8-dir, no corner cutting). Returns array of [x,z] cell centres or null. */
  function findPath(nav, fx, fz, tx, tz) {
    const s = nearestWalkable(nav, fx, fz), t = nearestWalkable(nav, tx, tz);
    if (!s || !t) return null;
    const W = nav.sx, N = nav.sx * nav.sz;
    const start = s[1] * W + s[0], goal = t[1] * W + t[0];
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = [];        // [f, idx] binary min-heap
    const push = (f, i) => {
      heap.push([f, i]);
      let c = heap.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; const tmp = heap[p]; heap[p] = heap[c]; heap[c] = tmp; c = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1, r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          const tmp = heap[m]; heap[m] = heap[c]; heap[c] = tmp; c = m;
        }
      }
      return top;
    };
    const h = (i) => { const x = i % W, z = (i / W) | 0; const dx = Math.abs(x - t[0]), dz = Math.abs(z - t[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    g[start] = 0;
    push(h(start), start);
    while (heap.length) {
      const [, cur] = pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % W, cz = (cur / W) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= nav.sz) continue;
        const ni = nz * W + nx;
        if (!nav.walk[ni] || closed[ni]) continue;
        if (dx && dz && (!nav.walk[cz * W + nx] || !nav.walk[nz * W + cx])) continue;
        const ng = g[cur] + (dx && dz ? 1.414 : 1) * nav.cost[ni];
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; push(ng + h(ni), ni); }
      }
    }
    if (came[goal] === -1 && goal !== start) return null;
    const out = [];
    for (let c = goal; c !== -1; c = came[c]) { out.push([(c % W) + 0.5, ((c / W) | 0) + 0.5]); if (c === start) break; }
    out.reverse();
    return out;
  }
  function walkLineClear(world, ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.2));
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
      if (boxCollides(world, x, 1, z, 1.8)) return false;
    }
    return true;
  }
  /** Path from (fx,fz) to (tx,tz) with line-of-walk smoothing. */
  function navPath(nav, world, fx, fz, tx, tz) {
    const raw = findPath(nav, fx, fz, tx, tz);
    if (!raw) return null;
    const out = [];
    let ax = fx, az = fz, i = 0;
    while (i < raw.length) {
      let j = raw.length - 1;
      while (j > i && !walkLineClear(world, ax, az, raw[j][0], raw[j][1])) j--;
      out.push(raw[j]);
      ax = raw[j][0]; az = raw[j][1];
      i = j + 1;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // PLAYER PHYSICS (identical on client prediction + server)
  // ---------------------------------------------------------------------------
  const P = CONFIG.PLAYER;
  function playerHeight(s) { return s.crouch ? P.CROUCH_HEIGHT : P.HEIGHT; }
  function eyeHeight(s) { return s.crouch ? P.CROUCH_EYE : P.EYE; }

  function boxCollides(world, x, y, z, h) {
    const R = P.RADIUS;
    const x0 = Math.floor(x - R), x1 = Math.floor(x + R);
    const y0 = Math.floor(y), y1 = Math.floor(y + h);
    const z0 = Math.floor(z - R), z1 = Math.floor(z + R);
    for (let by = y0; by <= y1; by++)
      for (let bz = z0; bz <= z1; bz++)
        for (let bx = x0; bx <= x1; bx++)
          if (world.get(bx, by, bz) !== 0) return true;
    return false;
  }

  function accelerate(s, dx, dz, wishSpeed, accel, dt, cap) {
    const cur = s.vx * dx + s.vz * dz;
    const add = cap - cur;
    if (add <= 0) return;
    let acc = accel * wishSpeed * dt;
    if (acc > add) acc = add;
    s.vx += acc * dx; s.vz += acc * dz;
  }

  /**
   * Advance one player state by one fixed step.
   * s: {x,y,z,vx,vy,vz,onGround,crouch}
   * inp: {mx,mz,yaw,b}
   * opts: {speedMul, frozen}
   */
  function stepPlayer(s, inp, dt, world, opts) {
    const M = CONFIG.MOVE;
    const ev = { landSpeed: 0, jumped: false };
    const b = inp.b | 0;
    const frozen = !!(opts && opts.frozen);

    if (b & BTN.CROUCH) s.crouch = true;
    else if (s.crouch && !boxCollides(world, s.x, s.y, s.z, P.HEIGHT)) s.crouch = false;
    const h = playerHeight(s);

    let mx = frozen ? 0 : clamp(+inp.mx || 0, -1, 1);
    let mz = frozen ? 0 : clamp(+inp.mz || 0, -1, 1);
    const sy = Math.sin(inp.yaw), cy = Math.cos(inp.yaw);
    let wx = -sy * mz + cy * mx, wz = -cy * mz - sy * mx;
    let wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; wl = 1; }
    let maxSpeed = M.RUN_SPEED * ((opts && opts.speedMul) || 1);
    if (s.crouch) maxSpeed *= M.CROUCH_MUL;
    else if (b & BTN.WALK) maxSpeed *= M.WALK_MUL;
    const wishSpeed = maxSpeed * wl;
    const dx = wl > 1e-6 ? wx / wl : 0, dz = wl > 1e-6 ? wz / wl : 0;

    if (s.onGround) {
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > 0) {
        const control = Math.max(sp, M.STOP_SPEED);
        const drop = control * M.FRICTION * dt;
        const ns = Math.max(sp - drop, 0) / sp;
        s.vx *= ns; s.vz *= ns;
      }
      accelerate(s, dx, dz, wishSpeed, M.GROUND_ACCEL, dt, wishSpeed);
      if ((b & BTN.JUMP) && !frozen) {
        s.vy = M.JUMP_VEL; s.onGround = false; ev.jumped = true;
      }
    } else {
      accelerate(s, dx, dz, wishSpeed, M.AIR_ACCEL, dt, Math.min(wishSpeed, M.AIR_WISH_CAP));
      const hs = Math.hypot(s.vx, s.vz);
      if (hs > M.MAX_AIR_SPEED) { s.vx *= M.MAX_AIR_SPEED / hs; s.vz *= M.MAX_AIR_SPEED / hs; }
    }

    s.vy = Math.max(s.vy - M.GRAVITY * dt, -M.MAX_FALL);

    // --- Y axis
    const oldY = s.y;
    const vyBefore = s.vy;
    const ny = s.y + s.vy * dt;
    if (boxCollides(world, s.x, ny, s.z, h)) {
      if (s.vy < 0) {
        s.y = Math.floor(ny) + 1;
        if (vyBefore < 0) ev.landSpeed = -vyBefore;
      } else {
        s.y = Math.floor(ny + h) - h - 1e-4;
      }
      if (boxCollides(world, s.x, s.y, s.z, h)) s.y = oldY;
      s.vy = 0;
    } else {
      s.y = ny;
    }
    // --- X axis
    const nx = s.x + s.vx * dt;
    if (boxCollides(world, nx, s.y, s.z, h)) {
      const ox = s.x;
      s.x = s.vx > 0 ? Math.floor(nx + P.RADIUS) - P.RADIUS - 1e-4 : Math.floor(nx - P.RADIUS) + 1 + P.RADIUS + 1e-4;
      if (boxCollides(world, s.x, s.y, s.z, h)) s.x = ox;
      s.vx = 0;
    } else s.x = nx;
    // --- Z axis
    const nz = s.z + s.vz * dt;
    if (boxCollides(world, s.x, s.y, nz, h)) {
      const oz = s.z;
      s.z = s.vz > 0 ? Math.floor(nz + P.RADIUS) - P.RADIUS - 1e-4 : Math.floor(nz - P.RADIUS) + 1 + P.RADIUS + 1e-4;
      if (boxCollides(world, s.x, s.y, s.z, h)) s.z = oz;
      s.vz = 0;
    } else s.z = nz;

    const wasGround = s.onGround;
    s.onGround = s.vy <= 0 && boxCollides(world, s.x, s.y - 0.03, s.z, h);
    if (!wasGround && s.onGround && ev.landSpeed === 0) ev.landSpeed = -vyBefore;

    // Safety: never leave the map
    s.x = clamp(s.x, 1.31, world.sx - 1.31);
    s.z = clamp(s.z, 1.31, world.sz - 1.31);
    if (s.y < 1) { s.y = 1; s.vy = 0; s.onGround = true; }
    return ev;
  }

  // ---------------------------------------------------------------------------
  // HITBOXES
  // ---------------------------------------------------------------------------
  function getHitboxes(x, y, z, crouch) {
    const h = crouch ? P.CROUCH_HEIGHT : P.HEIGHT;
    const legTop = y + h * 0.45;
    const headBottom = y + h - 0.42;
    return [
      { part: 'head', min: [x - 0.22, headBottom, z - 0.22], max: [x + 0.22, y + h, z + 0.22] },
      { part: 'chest', min: [x - 0.3, legTop, z - 0.3], max: [x + 0.3, headBottom, z + 0.3] },
      { part: 'legs', min: [x - 0.24, y, z - 0.24], max: [x + 0.24, legTop, z + 0.24] }
    ];
  }
  function rayAABB(o, d, mn, mx) {
    let tmin = 0, tmax = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < mn[i] || o[i] > mx[i]) return -1;
      } else {
        let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
    }
    return tmin;
  }

  // ---------------------------------------------------------------------------
  // WEAPONS + RECOIL
  // ---------------------------------------------------------------------------
  function buildPattern(vert, horiz, len, climb) {
    const out = [];
    for (let i = 0; i < len; i++) {
      const p = vert * Math.min(i, climb) + vert * 0.12 * Math.max(0, i - climb);
      let y;
      if (i <= climb * 0.6) y = Math.sin(i * 0.9) * horiz * 0.08;
      else y = Math.sin((i - climb * 0.6) * 0.38) * horiz;
      out.push([y, p]); // [yawDeg (+right), pitchDeg (+up)]
    }
    return out;
  }

  const BASE_W = {
    team: null, armorPen: 0.5, auto: false, mag: 0, reserve: 0, reload: 0, range: 80, rangeMod: 0.9, penetration: 0,
    spread: 0, moveSpread: 0, jumpSpread: 0, recover: 0.1, speedMul: 1, killReward: 300, drawTime: 0.6,
    pattern: [[0, 0]], kick: 0, pellets: 1, melee: false, grenade: null, scope: null, unscopedSpread: 0
  };
  function W(def) { return Object.assign({}, BASE_W, def); }

  const WEAPONS = {
    knife: W({ id: 'knife', name: 'Taktik Bıçak', cat: 'knife', slot: 3, price: 0, damage: 45, armorPen: 0.85, rpm: 110, auto: true,
      range: 2.1, rangeMod: 1, melee: true, killReward: 1500, drawTime: 0.4 }),

    // --- Pistols (slot 2)
    p9: W({ id: 'p9', name: 'P-9 Striker', cat: 'pistol', slot: 2, team: 'T', price: 200, damage: 28, armorPen: 0.47, rpm: 400,
      mag: 20, reserve: 120, reload: 2.2, rangeMod: 0.85, penetration: 1, spread: 0.45, moveSpread: 2.6, jumpSpread: 6,
      recover: 0.08, speedMul: 0.96, drawTime: 0.5, pattern: buildPattern(1.0, 0.4, 20, 6), kick: 0.6 }),
    p12: W({ id: 'p12', name: 'P-12 Warden', cat: 'pistol', slot: 2, team: 'CT', price: 200, damage: 35, armorPen: 0.5, rpm: 352,
      mag: 12, reserve: 24, reload: 2.2, rangeMod: 0.88, penetration: 1, spread: 0.35, moveSpread: 2.4, jumpSpread: 6,
      recover: 0.08, speedMul: 0.96, drawTime: 0.5, pattern: buildPattern(1.1, 0.4, 12, 6), kick: 0.65 }),
    vex: W({ id: 'vex', name: 'Vex-75 Otomatik', cat: 'pistol', slot: 2, price: 500, damage: 31, armorPen: 0.77, rpm: 600, auto: true,
      mag: 12, reserve: 24, reload: 2.7, range: 60, rangeMod: 0.85, penetration: 1, spread: 0.55, moveSpread: 2.4, jumpSpread: 6,
      recover: 0.07, speedMul: 0.96, killReward: 100, drawTime: 0.5, pattern: buildPattern(0.75, 1.2, 12, 6), kick: 0.5 }),
    hc50: W({ id: 'hc50', name: 'HC-50 Hand Cannon', cat: 'pistol', slot: 2, price: 700, damage: 53, armorPen: 0.93, rpm: 267,
      mag: 7, reserve: 35, reload: 2.2, range: 90, rangeMod: 0.86, penetration: 2, spread: 0.55, moveSpread: 5, jumpSpread: 9,
      recover: 0.13, speedMul: 0.92, pattern: buildPattern(2.6, 0.8, 7, 4), kick: 1.4 }),

    // --- SMGs (slot 1)
    viper: W({ id: 'viper', name: 'Viper SMG', cat: 'smg', slot: 1, price: 1250, damage: 26, armorPen: 0.6, rpm: 857, auto: true,
      mag: 30, reserve: 120, reload: 2.1, range: 60, rangeMod: 0.87, penetration: 1, spread: 0.9, moveSpread: 1.6, jumpSpread: 5,
      recover: 0.04, speedMul: 0.96, killReward: 600, pattern: buildPattern(0.38, 1.6, 30, 10), kick: 0.35 }),
    wasp: W({ id: 'wasp', name: 'Wasp-7 PDW', cat: 'smg', slot: 1, price: 1500, damage: 29, armorPen: 0.65, rpm: 750, auto: true,
      mag: 30, reserve: 120, reload: 3.1, range: 70, rangeMod: 0.85, penetration: 1, spread: 0.6, moveSpread: 1.8, jumpSpread: 5,
      recover: 0.04, speedMul: 0.95, killReward: 600, pattern: buildPattern(0.42, 1.7, 30, 10), kick: 0.38 }),
    hornet: W({ id: 'hornet', name: 'Hornet P50', cat: 'smg', slot: 1, price: 2350, damage: 26, armorPen: 0.69, rpm: 857, auto: true,
      mag: 50, reserve: 100, reload: 3.3, range: 70, rangeMod: 0.86, penetration: 1, spread: 0.7, moveSpread: 1.9, jumpSpread: 5,
      recover: 0.035, speedMul: 0.94, drawTime: 0.7, pattern: buildPattern(0.33, 1.9, 50, 12), kick: 0.32 }),

    // --- Heavy (slot 1)
    breacher: W({ id: 'breacher', name: 'Breacher Pompalı', cat: 'heavy', slot: 1, price: 1050, damage: 26, pellets: 9, armorPen: 0.5, rpm: 68,
      mag: 8, reserve: 32, reload: 3.2, range: 30, rangeMod: 0.75, spread: 3.4, moveSpread: 1, jumpSpread: 3,
      recover: 0.3, speedMul: 0.88, killReward: 900, drawTime: 0.8, pattern: buildPattern(2.5, 0.5, 8, 2), kick: 1.6 }),
    mauler: W({ id: 'mauler', name: 'Mauler Oto-Pompalı', cat: 'heavy', slot: 1, price: 2000, damage: 20, pellets: 6, armorPen: 0.8, rpm: 171, auto: true,
      mag: 7, reserve: 32, reload: 3.0, range: 28, rangeMod: 0.75, spread: 3.8, moveSpread: 1, jumpSpread: 3,
      recover: 0.2, speedMul: 0.86, killReward: 900, drawTime: 0.9, pattern: buildPattern(1.6, 0.6, 7, 3), kick: 1.2 }),
    titan: W({ id: 'titan', name: 'Titan M60 LMG', cat: 'heavy', slot: 1, price: 5200, damage: 32, armorPen: 0.8, rpm: 750, auto: true,
      mag: 100, reserve: 200, reload: 5.7, range: 110, rangeMod: 0.97, penetration: 2, spread: 0.8, moveSpread: 7, jumpSpread: 12,
      recover: 0.05, speedMul: 0.78, drawTime: 1.1, pattern: buildPattern(0.55, 2.8, 100, 10), kick: 0.5 }),

    // --- Rifles (slot 1)
    falcon: W({ id: 'falcon', name: 'Falcon G-35', cat: 'rifle', slot: 1, team: 'T', price: 1800, damage: 30, armorPen: 0.775, rpm: 666, auto: true,
      mag: 35, reserve: 90, reload: 3.0, range: 110, rangeMod: 0.98, penetration: 2, spread: 0.38, moveSpread: 6, jumpSpread: 10,
      recover: 0.05, speedMul: 0.86, drawTime: 0.9, pattern: buildPattern(0.52, 2.3, 35, 9), kick: 0.5 }),
    lynx: W({ id: 'lynx', name: 'Lynx F-25', cat: 'rifle', slot: 1, team: 'CT', price: 2050, damage: 30, armorPen: 0.7, rpm: 666, auto: true,
      mag: 25, reserve: 90, reload: 3.3, range: 110, rangeMod: 0.96, penetration: 2, spread: 0.36, moveSpread: 6, jumpSpread: 10,
      recover: 0.05, speedMul: 0.88, drawTime: 0.9, pattern: buildPattern(0.5, 2.0, 25, 9), kick: 0.48 }),
    krait: W({ id: 'krait', name: 'Krait AR-7', cat: 'rifle', slot: 1, team: 'T', price: 2700, damage: 36, armorPen: 0.775, rpm: 600, auto: true,
      mag: 30, reserve: 90, reload: 2.45, range: 120, rangeMod: 0.98, penetration: 2, spread: 0.3, moveSpread: 6, jumpSpread: 10,
      recover: 0.05, speedMul: 0.86, drawTime: 0.9, pattern: buildPattern(0.6, 2.6, 30, 9), kick: 0.55 }),
    sentinel: W({ id: 'sentinel', name: 'Sentinel M4', cat: 'rifle', slot: 1, team: 'CT', price: 2900, damage: 33, armorPen: 0.7, rpm: 666, auto: true,
      mag: 30, reserve: 90, reload: 3.1, range: 120, rangeMod: 0.97, penetration: 2, spread: 0.28, moveSpread: 5.5, jumpSpread: 10,
      recover: 0.05, speedMul: 0.88, drawTime: 0.9, pattern: buildPattern(0.5, 2.2, 30, 9), kick: 0.48 }),
    ranger: W({ id: 'ranger', name: 'Ranger SSG', cat: 'sniper', slot: 1, price: 1700, damage: 88, armorPen: 0.85, rpm: 48,
      mag: 10, reserve: 90, reload: 3.7, range: 200, rangeMod: 0.99, penetration: 3, spread: 0.05, unscopedSpread: 4.5, moveSpread: 8, jumpSpread: 7,
      recover: 0.25, speedMul: 0.92, drawTime: 1.0, pattern: buildPattern(3.0, 0.5, 10, 2), kick: 1.8, scope: [40, 15] }),
    longshot: W({ id: 'longshot', name: 'Longshot .338', cat: 'sniper', slot: 1, price: 4750, damage: 115, armorPen: 0.97, rpm: 41,
      mag: 5, reserve: 30, reload: 3.7, range: 200, rangeMod: 0.99, penetration: 3, spread: 0.04, unscopedSpread: 7, moveSpread: 12, jumpSpread: 16,
      recover: 0.3, speedMul: 0.8, killReward: 100, drawTime: 1.1, pattern: buildPattern(3.5, 0.6, 5, 2), kick: 2.2, scope: [40, 15] }),

    // --- Grenades (slot 4)
    he: W({ id: 'he', name: 'HE Bombası', cat: 'grenade', slot: 4, price: 300, grenade: 'he', rpm: 60, drawTime: 0.5 }),
    flash: W({ id: 'flash', name: 'Flaş Bombası', cat: 'grenade', slot: 4, price: 200, grenade: 'flash', rpm: 60, drawTime: 0.5 }),
    smoke: W({ id: 'smoke', name: 'Sis Bombası', cat: 'grenade', slot: 4, price: 300, grenade: 'smoke', rpm: 60, drawTime: 0.5 })
  };
  const GRENADE_ORDER = ['he', 'flash', 'smoke'];
  const BUY_LIST = {
    pistols: ['p9', 'p12', 'vex', 'hc50'],
    heavy: ['breacher', 'mauler', 'titan'],
    smg: ['viper', 'wasp', 'hornet'],
    rifles: ['falcon', 'lynx', 'krait', 'sentinel', 'ranger', 'longshot'],
    grenades: ['he', 'flash', 'smoke'],
    gear: ['kevlar', 'helmet', 'defuse']
  };
  const ITEMS = {
    kevlar: { id: 'kevlar', name: 'Kevlar Yelek', price: 650 },
    helmet: { id: 'helmet', name: 'Kevlar + Kask', price: 1000 },
    defuse: { id: 'defuse', name: 'İmha Kiti', price: 400, team: 'CT' }
  };

  function getRecoil(w, idx) {
    const pat = w.pattern;
    const max = pat.length - 1;
    const i = clamp(idx, 0, max);
    const i0 = Math.floor(i), i1 = Math.min(i0 + 1, max), f = i - i0;
    return [lerp(pat[i0][0], pat[i1][0], f), lerp(pat[i0][1], pat[i1][1], f)];
  }
  /** Recoil index after `sinceMs` without shooting (deterministic recovery). */
  function recoilIndexAt(idx, sinceMs, w) {
    const delay = (60000 / w.rpm) * 1.3;
    if (sinceMs <= delay) return idx;
    return Math.max(0, idx - (sinceMs - delay) / (w.recover * 1000));
  }
  function getSpread(w, speed, onGround, crouch, scoped) {
    if (w.melee || w.grenade) return 0;
    let s = w.spread;
    if (w.scope && !scoped) s += w.unscopedSpread;
    const moveFrac = clamp(speed / (CONFIG.MOVE.RUN_SPEED * w.speedMul), 0, 1.3);
    if (moveFrac > 0.34) s += w.moveSpread * (moveFrac - 0.34) / 0.66;
    if (!onGround) s += w.jumpSpread;
    if (crouch && onGround) s *= 0.75;
    return s;
  }
  function computeShotDirection(yaw, pitch, recoil, spreadDeg, seed) {
    const rng = mulberry32(seed);
    const a = rng() * Math.PI * 2;
    const r = rng() * spreadDeg;
    const offYaw = Math.cos(a) * r + recoil[0];
    const offPitch = Math.sin(a) * r + recoil[1];
    return anglesToDir(yaw - offYaw * DEG, clamp(pitch + offPitch * DEG, -1.55, 1.55));
  }
  /** All pellet directions of one trigger pull (1 for normal guns). Shotgun pellets use a uniform ring. */
  function shotDirections(w, yaw, pitch, recoil, spreadDeg, playerNum, seq) {
    if (w.pellets <= 1) return [computeShotDirection(yaw, pitch, recoil, spreadDeg, shotSeed(playerNum, seq))];
    const out = [];
    for (let k = 0; k < w.pellets; k++) {
      const rng = mulberry32(shotSeed(playerNum, seq * 16 + k));
      const a = (k / w.pellets) * Math.PI * 2 + rng() * 0.6;
      const r = spreadDeg * (0.35 + rng() * 0.65) * (k === 0 ? 0.2 : 1);
      out.push(anglesToDir(yaw - (Math.cos(a) * r + recoil[0]) * DEG, clamp(pitch + (Math.sin(a) * r + recoil[1]) * DEG, -1.55, 1.55)));
    }
    return out;
  }
  function weaponSpeedMul(weaponId, scoped) {
    const w = WEAPONS[weaponId] || WEAPONS.knife;
    return w.speedMul * (scoped ? CONFIG.MOVE.SCOPED_MUL : 1);
  }

  // ---------------------------------------------------------------------------
  // GRENADE PHYSICS (server authoritative; shared so bots/tests can predict)
  // ---------------------------------------------------------------------------
  function stepGrenade(g, dt, world) {
    const G = CONFIG.GRENADE;
    g.vy -= G.GRAVITY * dt;
    let bounced = false;
    const steps = Math.max(1, Math.ceil(Math.hypot(g.vx, g.vy, g.vz) * dt / 0.2));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      for (const ax of ['x', 'y', 'z']) {
        const vk = 'v' + ax;
        const old = g[ax];
        g[ax] += g[vk] * h;
        if (world.isSolid(Math.floor(g.x), Math.floor(g.y), Math.floor(g.z))) {
          g[ax] = old;
          g[vk] = -g[vk] * G.BOUNCE;
          if (ax === 'y') { g.vx *= G.FRICTION; g.vz *= G.FRICTION; }
          else { g.vy *= 0.9; }
          if (Math.abs(g[vk]) > 1.2) bounced = true;
        }
      }
    }
    g.rest = Math.hypot(g.vx, g.vy, g.vz) < 0.35 && world.isSolid(Math.floor(g.x), Math.floor(g.y - 0.15), Math.floor(g.z));
    if (g.rest) { g.vx = g.vy = g.vz = 0; }
    return bounced;
  }
  /** true if the straight segment a→b is not blocked by any solid voxel */
  function lineClear(world, a, b) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) return true;
    return !world.raycast(a, [d[0] / len, d[1] / len, d[2] / len], len - 0.05);
  }
  /** true if any smoke cloud intersects the segment a→b */
  function smokeBlocks(smokes, a, b, now) {
    if (!smokes || !smokes.length) return false;
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
    for (const s of smokes) {
      const age = (now - s.t0) / 1000;
      if (age < 0.6 || age > CONFIG.GRENADE.smoke.duration) continue;
      const r = CONFIG.GRENADE.smoke.radius * Math.min(1, age / 1.5) * (age > CONFIG.GRENADE.smoke.duration - 2 ? (CONFIG.GRENADE.smoke.duration - age) / 2 : 1);
      const t = clamp(((s.x - a[0]) * d[0] + (s.y - a[1]) * d[1] + (s.z - a[2]) * d[2]) / len2, 0, 1);
      const px = a[0] + d[0] * t - s.x, py = a[1] + d[1] * t - s.y, pz = a[2] + d[2] * t - s.z;
      if (px * px + py * py * 2.5 + pz * pz < r * r) return true;
    }
    return false;
  }

  return {
    CONFIG, DIFFICULTY, BTN, BLOCK, BLOCK_INFO, WEAPONS, ITEMS, BUY_LIST, GRENADE_ORDER, DEG,
    clamp, lerp, wrapAngle, lerpAngle, anglesToDir, dirToAngles, mulberry32, shotSeed, hash3,
    VoxelWorld, MAPS, MAP_ORDER, registerMap, getMap, nextMapId, generateMap, inZone, siteAt, siteCenter,
    buildNav, findPath, navPath, nearestWalkable, walkLineClear,
    playerHeight, eyeHeight, boxCollides, stepPlayer,
    getHitboxes, rayAABB,
    getRecoil, recoilIndexAt, getSpread, computeShotDirection, shotDirections, weaponSpeedMul,
    stepGrenade, lineClear, smokeBlocks
  };
});
