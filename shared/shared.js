/*
 * BLOCK OPS: TACTICAL DRIFT — Shared deterministic core
 * Used by BOTH the Node.js server (require) and the browser client (window.SHARED).
 * Everything that must give identical results on both sides lives here:
 * config, voxel world + DDA raycast, player physics, weapons, recoil, spread, hitboxes, map.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SHARED = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIG
  // ---------------------------------------------------------------------------
  const CONFIG = {
    VERSION: '1.0.0',
    TICK_RATE: 30,            // server simulation + snapshot rate (Hz)
    INPUT_RATE: 60,           // client fixed input/physics step (Hz)
    INTERP_DELAY_MS: 100,     // remote entity interpolation delay
    MAX_REWIND_MS: 300,       // lag compensation cap
    MAX_PER_TEAM: 5,
    FRIENDLY_FIRE: false,
    WORLD: { X: 64, Y: 16, Z: 64, CHUNK: 16 },
    PLAYER: { RADIUS: 0.3, HEIGHT: 1.8, CROUCH_HEIGHT: 1.3, EYE: 1.62, CROUCH_EYE: 1.15, MAX_HP: 100 },
    MOVE: {
      RUN_SPEED: 5.6, WALK_MUL: 0.52, CROUCH_MUL: 0.34, SCOPED_MUL: 0.55,
      GROUND_ACCEL: 7.0, AIR_ACCEL: 12.0, AIR_WISH_CAP: 0.8, MAX_AIR_SPEED: 7.2,
      FRICTION: 6.0, STOP_SPEED: 2.0, GRAVITY: 22.0, JUMP_VEL: 7.4, MAX_FALL: 30.0
    },
    ROUND: {
      WARMUP: 12, FREEZE: 12, LIVE: 115, POST: 6, BUY_WINDOW: 20,
      HALF: 12, WIN: 13, MAX_ROUNDS: 24, GAMEOVER: 12, WARMUP_RESPAWN: 2.5
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
    FALL: { SAFE_SPEED: 11.0, DMG_PER: 8.0 },
    PART_MUL: { head: 4.0, chest: 1.0, legs: 0.75 }
  };

  // Input buttons (bitmask)
  const BTN = { JUMP: 1, CROUCH: 2, WALK: 4, USE: 8, FIRE: 16 };

  // ---------------------------------------------------------------------------
  // BLOCKS
  // ---------------------------------------------------------------------------
  const BLOCK = { AIR: 0, GROUND: 1, WALL: 2, CRATE: 3, PLANK: 4, SAND: 5, SITE_A: 6, SITE_B: 7, METAL: 8, BRICK: 9 };
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
    { name: 'brick', hp: 0, color: [0.66, 0.38, 0.30] }
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
  // MAP  — "Dustgrid": T spawn south (low z), CT spawn north (high z),
  // A site west, B site east, mid lane, two tunnels, breakable plank walls.
  // ---------------------------------------------------------------------------
  const MAP = {
    name: 'Dustgrid',
    spawns: {
      T: [[26.5, 1, 4.5], [29.5, 1, 4.5], [32.5, 1, 4.5], [35.5, 1, 4.5], [38.5, 1, 4.5],
          [26.5, 1, 8.5], [29.5, 1, 8.5], [32.5, 1, 8.5], [35.5, 1, 8.5], [38.5, 1, 8.5]],
      CT: [[26.5, 1, 60.5], [29.5, 1, 60.5], [32.5, 1, 60.5], [35.5, 1, 60.5], [38.5, 1, 60.5],
           [26.5, 1, 57.5], [29.5, 1, 57.5], [32.5, 1, 57.5], [35.5, 1, 57.5], [38.5, 1, 57.5]]
    },
    spawnYaw: { T: Math.PI, CT: 0 },
    buyZones: { T: { x0: 1, x1: 63, z0: 1, z1: 12 }, CT: { x0: 1, x1: 63, z0: 53, z1: 63 } },
    sites: { A: { x0: 4, x1: 18, z0: 40, z1: 52 }, B: { x0: 46, x1: 60, z0: 40, z1: 52 } },
    waypoints: {
      TS: [32.5, 5.5], TA: [10.5, 9.5], TB: [53.5, 9.5],
      MID1: [32.5, 14.5], MID2: [31.5, 26.5], MIDB: [35.5, 21.5], MID3: [32.5, 37.5], MID4: [32.5, 46.5], CTS: [32.5, 56.5],
      AL1: [12.5, 26.5], AL2: [10.5, 37.5], ASITE: [11.5, 46.5], TUNA: [20.5, 26.5],
      TUNB: [43.5, 21.5], BL1: [55.5, 21.5], BL2: [52.5, 37.5], BSITE: [52.5, 46.5],
      CTA: [11.5, 56.5], CTB: [53.5, 56.5]
    },
    edges: [
      ['TS', 'TA'], ['TS', 'TB'], ['TS', 'MID1'], ['TA', 'AL1'], ['AL1', 'AL2'], ['AL2', 'ASITE'],
      ['AL1', 'TUNA'], ['TUNA', 'MID2'], ['MID1', 'MID2'], ['MID2', 'MIDB'], ['MIDB', 'TUNB'], ['TUNB', 'BL1'],
      ['MID2', 'MID3'], ['MID3', 'MID4'], ['MID4', 'CTS'], ['TB', 'BL1'], ['BL1', 'BL2'], ['BL2', 'BSITE'],
      ['ASITE', 'CTA'], ['CTA', 'CTS'], ['CTS', 'CTB'], ['CTB', 'BSITE']
    ]
  };

  function generateMap(world) {
    const W = world;
    W.data.fill(0);
    const box = (x0, y0, z0, x1, y1, z1, t) => {
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) W.set(x, y, z, t);
    };
    const B = BLOCK;
    // Floor + border
    box(0, 0, 0, 63, 0, 63, B.GROUND);
    box(0, 1, 0, 63, 9, 0, B.WALL); box(0, 1, 63, 63, 9, 63, B.WALL);
    box(0, 1, 0, 0, 9, 63, B.WALL); box(63, 1, 0, 63, 9, 63, B.WALL);
    // Bombsite floors
    box(5, 0, 42, 16, 0, 50, B.SITE_A);
    box(47, 0, 42, 58, 0, 50, B.SITE_B);
    // Big blocks between lanes
    box(15, 1, 12, 26, 6, 38, B.WALL);
    box(38, 1, 12, 49, 6, 38, B.WALL);
    // Brick trims (decor, indestructible)
    box(15, 6, 12, 26, 6, 12, B.BRICK); box(38, 6, 12, 49, 6, 12, B.BRICK);
    // Tunnels
    box(15, 1, 25, 26, 3, 27, B.AIR);
    box(38, 1, 20, 49, 3, 22, B.AIR);
    box(15, 4, 24, 15, 4, 28, B.METAL); box(26, 4, 24, 26, 4, 28, B.METAL);
    box(38, 4, 19, 38, 4, 23, B.METAL); box(49, 4, 19, 49, 4, 23, B.METAL);
    // Lane narrowing walls
    box(1, 1, 14, 6, 6, 32, B.WALL);
    box(57, 1, 14, 62, 6, 32, B.WALL);
    // Mid doors
    box(27, 1, 37, 30, 6, 38, B.WALL);
    box(34, 1, 37, 37, 6, 38, B.WALL);
    box(31, 4, 37, 33, 6, 38, B.WALL);
    // Mid → site side walls with breakable plank windows
    box(27, 1, 39, 28, 6, 43, B.WALL); box(36, 1, 39, 37, 6, 43, B.WALL);
    box(27, 1, 40, 28, 2, 42, B.PLANK); box(36, 1, 40, 37, 2, 42, B.PLANK);
    // CT-side blocks
    box(21, 1, 44, 28, 6, 52, B.WALL); box(36, 1, 44, 43, 6, 52, B.WALL);
    box(21, 6, 44, 28, 6, 44, B.BRICK); box(36, 6, 44, 43, 6, 44, B.BRICK);
    // A site cover
    box(8, 1, 44, 9, 2, 45, B.CRATE);
    box(13, 1, 47, 14, 1, 48, B.CRATE);
    box(4, 1, 40, 7, 1, 40, B.SAND);
    box(15, 1, 50, 16, 1, 51, B.CRATE);
    // B site cover
    box(54, 1, 44, 55, 2, 45, B.CRATE);
    box(49, 1, 47, 50, 1, 48, B.CRATE);
    box(56, 1, 40, 59, 1, 40, B.SAND);
    box(47, 1, 50, 48, 1, 51, B.CRATE);
    // Lane cover
    box(7, 1, 19, 8, 1, 20, B.CRATE); box(8, 1, 33, 9, 2, 34, B.CRATE);
    box(34, 1, 17, 35, 2, 18, B.CRATE); box(33, 1, 28, 34, 1, 29, B.CRATE);
    box(52, 1, 22, 53, 1, 23, B.CRATE); box(54, 1, 34, 55, 2, 35, B.CRATE);
    // Spawns
    box(40, 1, 2, 41, 1, 3, B.CRATE);
    box(18, 1, 57, 19, 1, 58, B.CRATE);
    box(16, 1, 58, 16, 4, 58, B.METAL); box(48, 1, 58, 48, 4, 58, B.METAL);
    // Sand bag lines in lanes (destructible)
    box(12, 1, 11, 14, 1, 11, B.SAND); box(50, 1, 11, 52, 1, 11, B.SAND);
    return W;
  }

  function inZone(zone, x, z) { return x >= zone.x0 && x <= zone.x1 && z >= zone.z0 && z <= zone.z1; }
  function siteAt(x, z) {
    if (inZone(MAP.sites.A, x, z)) return 'A';
    if (inZone(MAP.sites.B, x, z)) return 'B';
    return null;
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

  const WEAPONS = {
    knife: {
      id: 'knife', name: 'Taktik Bıçak', slot: 3, price: 0, damage: 45, armorPen: 0.85, rpm: 110, auto: true,
      mag: 0, reserve: 0, reload: 0, range: 2.1, rangeMod: 1, penetration: 0, melee: true,
      spread: 0, moveSpread: 0, jumpSpread: 0, recover: 0.1, speedMul: 1.0, killReward: 1500, drawTime: 0.4,
      pattern: [[0, 0]], kick: 0
    },
    p9: {
      id: 'p9', name: 'P-9 Striker', slot: 2, team: 'T', price: 200, damage: 28, armorPen: 0.47, rpm: 400, auto: false,
      mag: 20, reserve: 120, reload: 2.2, range: 80, rangeMod: 0.85, penetration: 1,
      spread: 0.45, moveSpread: 2.6, jumpSpread: 6, recover: 0.08, speedMul: 0.96, killReward: 300, drawTime: 0.5,
      pattern: buildPattern(1.0, 0.4, 20, 6), kick: 0.6
    },
    p12: {
      id: 'p12', name: 'P-12 Warden', slot: 2, team: 'CT', price: 200, damage: 35, armorPen: 0.5, rpm: 352, auto: false,
      mag: 12, reserve: 24, reload: 2.2, range: 80, rangeMod: 0.88, penetration: 1,
      spread: 0.35, moveSpread: 2.4, jumpSpread: 6, recover: 0.08, speedMul: 0.96, killReward: 300, drawTime: 0.5,
      pattern: buildPattern(1.1, 0.4, 12, 6), kick: 0.65
    },
    hc50: {
      id: 'hc50', name: 'HC-50 Hand Cannon', slot: 2, price: 700, damage: 53, armorPen: 0.93, rpm: 267, auto: false,
      mag: 7, reserve: 35, reload: 2.2, range: 90, rangeMod: 0.86, penetration: 2,
      spread: 0.55, moveSpread: 5, jumpSpread: 9, recover: 0.13, speedMul: 0.92, killReward: 300, drawTime: 0.6,
      pattern: buildPattern(2.6, 0.8, 7, 4), kick: 1.4
    },
    viper: {
      id: 'viper', name: 'Viper SMG', slot: 1, price: 1250, damage: 26, armorPen: 0.6, rpm: 857, auto: true,
      mag: 30, reserve: 120, reload: 2.1, range: 60, rangeMod: 0.87, penetration: 1,
      spread: 0.9, moveSpread: 1.6, jumpSpread: 5, recover: 0.04, speedMul: 0.96, killReward: 600, drawTime: 0.6,
      pattern: buildPattern(0.38, 1.6, 30, 10), kick: 0.35
    },
    krait: {
      id: 'krait', name: 'Krait AR-7', slot: 1, team: 'T', price: 2700, damage: 36, armorPen: 0.775, rpm: 600, auto: true,
      mag: 30, reserve: 90, reload: 2.45, range: 120, rangeMod: 0.98, penetration: 2,
      spread: 0.3, moveSpread: 6, jumpSpread: 10, recover: 0.05, speedMul: 0.86, killReward: 300, drawTime: 0.9,
      pattern: buildPattern(0.6, 2.6, 30, 9), kick: 0.55
    },
    sentinel: {
      id: 'sentinel', name: 'Sentinel M4', slot: 1, team: 'CT', price: 2900, damage: 33, armorPen: 0.7, rpm: 666, auto: true,
      mag: 30, reserve: 90, reload: 3.1, range: 120, rangeMod: 0.97, penetration: 2,
      spread: 0.28, moveSpread: 5.5, jumpSpread: 10, recover: 0.05, speedMul: 0.88, killReward: 300, drawTime: 0.9,
      pattern: buildPattern(0.5, 2.2, 30, 9), kick: 0.48
    },
    longshot: {
      id: 'longshot', name: 'Longshot .338', slot: 1, price: 4750, damage: 115, armorPen: 0.97, rpm: 41, auto: false,
      mag: 5, reserve: 30, reload: 3.7, range: 200, rangeMod: 0.99, penetration: 3,
      spread: 0.04, unscopedSpread: 7, moveSpread: 12, jumpSpread: 16, recover: 0.3, speedMul: 0.8, killReward: 100,
      drawTime: 1.1, pattern: buildPattern(3.5, 0.6, 5, 2), kick: 2.2, scope: [40, 15]
    }
  };
  const BUY_LIST = {
    pistols: ['p9', 'p12', 'hc50'],
    smg: ['viper'],
    rifles: ['krait', 'sentinel', 'longshot'],
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
    if (w.melee) return 0;
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
  function weaponSpeedMul(weaponId, scoped) {
    const w = WEAPONS[weaponId] || WEAPONS.knife;
    return w.speedMul * (scoped ? CONFIG.MOVE.SCOPED_MUL : 1);
  }

  return {
    CONFIG, BTN, BLOCK, BLOCK_INFO, MAP, WEAPONS, ITEMS, BUY_LIST, DEG,
    clamp, lerp, wrapAngle, lerpAngle, anglesToDir, dirToAngles, mulberry32, shotSeed, hash3,
    VoxelWorld, generateMap, inZone, siteAt,
    playerHeight, eyeHeight, boxCollides, stepPlayer,
    getHitboxes, rayAABB,
    getRecoil, recoilIndexAt, getSpread, computeShotDirection, weaponSpeedMul
  };
});
