'use strict';
/*
 * Room — one authoritative 5v5 match.
 * - Fixed-rate tick (CONFIG.TICK_RATE): consumes queued client inputs with a real-time
 *   budget (anti speed-hack), runs shared physics, records position history.
 * - Lag-compensated hit detection: shooter's view angles + seeded spread/recoil/pellets are
 *   re-simulated on the server; victims are rewound to the client's render time.
 * - CS-style competitive loop: warmup → freeze/buy → live → post, MR12, halftime swap,
 *   economy with loss bonus, bomb plant/defuse, destructible voxels.
 * - Grenades (HE / flash / smoke) simulated server-side with voxel bouncing.
 * - Per-room map (rotates after every match) and difficulty preset.
 */
const S = require('../shared/shared.js');
const BotBrain = require('./Bot');

const { CONFIG, WEAPONS, ITEMS, BLOCK, BLOCK_INFO, BTN, DIFFICULTY, GRENADE_ORDER } = S;
const R = CONFIG.ROUND, E = CONFIG.ECON, BB = CONFIG.BOMB, GN = CONFIG.GRENADE;

const BOT_NAMES = ['Ayaz', 'Kartal', 'Bora', 'Toprak', 'Demir', 'Atlas', 'Poyraz', 'Tuna', 'Yiğit', 'Arda', 'Kaya', 'Alp', 'Doruk', 'Efe'];
let numCounter = 1;
let nadeCounter = 1;
let dropCounter = 1;
const MAX_DROPS = 30;
const PICKUP_RANGE = 1.25;

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

class Room {
  constructor(io, id, onEmpty, opts) {
    opts = opts || {};
    this.io = io;
    this.id = id;
    this.onEmpty = onEmpty;
    this.players = new Map();
    this.bots = new Map();
    this.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.medium;
    this.world = new S.VoxelWorld();
    this.loadMap(S.MAPS[opts.map] ? opts.map : S.MAP_ORDER[0]);
    this.startTime = Date.now();
    this.phase = 'warmup';
    this.phaseEnd = 0;
    this.roundStart = 0;
    this.buyEnd = 0;
    this.round = 0;
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.bomb = { state: 'none' };
    this.botPlan = { site: 'A' };
    this.nades = [];
    this.smokes = [];
    this.drops = [];
    this.tickCount = 0;
    this.lastTickReal = Date.now();
    this.timer = setInterval(() => this.safeTick(), 1000 / CONFIG.TICK_RATE);
  }

  now() { return Date.now() - this.startTime; }

  destroy() {
    clearInterval(this.timer);
    this.players.clear();
    this.bots.clear();
  }

  loadMap(id) {
    this.mapId = id;
    this.map = S.getMap(id);
    S.generateMap(this.world, id);
    this.baseData = this.world.data.slice();
    this.blockHp = new Map();
    this.pendingBlocks = [];
    this.nav = S.buildNav(this.world);
    this.navVersion = (this.navVersion || 0) + 1;
  }

  // -------------------------------------------------------------------------
  // PLAYER MANAGEMENT
  // -------------------------------------------------------------------------
  humanCount() { let n = 0; for (const p of this.players.values()) if (!p.isBot) n++; return n; }
  teamCount(team) { let n = 0; for (const p of this.players.values()) if (p.team === team) n++; return n; }
  aliveCount(team) { let n = 0; for (const p of this.players.values()) if (p.team === team && p.alive) n++; return n; }

  createPlayer(id, name, isBot, socket) {
    return {
      id, num: numCounter++, name, isBot, socket, team: 'SPEC',
      x: 32.5, y: 1, z: 32.5, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false, yaw: 0, pitch: 0,
      alive: false, hp: 100, armor: 0, helmet: false, kit: false, money: this.diff.startMoney,
      weapons: { 1: null, 2: null, 3: { id: 'knife', ammo: 0, reserve: 0 } },
      nades: { he: 0, flash: 0, smoke: 0 }, nadeSel: 'he',
      slot: 3, prevSlot: 2, drawEnd: 0, reloadEnd: 0, lastShot: -1e9, recoilIdx: 0, lastShotSeq: 0, scoped: 0,
      inputQueue: [], lastSeq: 0, budget: 0, buttons: 0, useHeld: false, history: [],
      kills: 0, deaths: 0, assists: 0, mvps: 0, roundKills: 0, dmgBy: new Map(), damageDealt: 0, headshots: 0,
      respawnAt: 0, ping: 0, lastAttacker: null, lastAttackTime: 0, blindUntil: 0
    };
  }

  addHuman(socket, name) {
    const p = this.createPlayer(socket.id, name, false, socket);
    this.players.set(p.id, p);
    socket.join(this.id);
    this.assignTeam(p, this.autoTeam());
    return p;
  }

  addBot(team) {
    const t = team === 'T' || team === 'CT' ? team : this.autoTeam();
    if (!t || t === 'SPEC' || this.teamCount(t) >= CONFIG.MAX_PER_TEAM) return null;
    const used = new Set([...this.players.values()].map((p) => p.name));
    const base = BOT_NAMES.find((n) => !used.has('BOT ' + n)) || ('X' + numCounter);
    const id = 'bot_' + numCounter + '_' + Math.random().toString(36).slice(2, 6);
    const p = this.createPlayer(id, 'BOT ' + base, true, null);
    this.players.set(id, p);
    this.bots.set(id, new BotBrain(this, p));
    this.assignTeam(p, t);
    this.broadcastMsg(`${p.name} ${t === 'T' ? 'Saldırı' : 'Savunma'} takımına katıldı`);
    return p;
  }

  kickBots() { for (const id of [...this.bots.keys()]) this.removePlayer(id); }

  autoTeam() {
    const t = this.teamCount('T'), ct = this.teamCount('CT');
    if (t >= CONFIG.MAX_PER_TEAM && ct >= CONFIG.MAX_PER_TEAM) return 'SPEC';
    if (t === ct) return Math.random() < 0.5 ? 'T' : 'CT';
    return t < ct ? 'T' : 'CT';
  }

  assignTeam(p, team) {
    if (team !== 'T' && team !== 'CT') team = 'SPEC';
    if (team !== 'SPEC' && p.team !== team && this.teamCount(team) >= CONFIG.MAX_PER_TEAM) {
      const bot = [...this.players.values()].find((q) => q.isBot && q.team === team);
      if (bot) this.removePlayer(bot.id); else return false;
    }
    if (p.alive && this.phase !== 'warmup') this.killPlayer(p, null, 'suicide', false);
    p.team = team;
    p.alive = false;
    this.giveDefaults(p);
    if (this.phase === 'warmup' && team !== 'SPEC') { p.money = E.WARMUP_MONEY; this.spawn(p, -1); }
    return true;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.alive) this.dropBombIfCarrier(p);
    this.players.delete(id);
    this.bots.delete(id);
    if (p.socket) p.socket.leave(this.id);
    if (this.humanCount() === 0) this.onEmpty(this);
  }

  giveDefaults(p) {
    const pistol = p.team === 'CT' ? 'p12' : 'p9';
    const w = WEAPONS[pistol];
    p.weapons = { 1: null, 2: { id: pistol, ammo: w.mag, reserve: w.reserve }, 3: { id: 'knife', ammo: 0, reserve: 0 } };
    p.nades = { he: 0, flash: 0, smoke: 0 };
    p.slot = 2; p.prevSlot = 3;
    p.armor = 0; p.helmet = false; p.kit = false;
    p.reloadEnd = 0; p.scoped = 0; p.recoilIdx = 0;
  }

  nadeCount(p) { return p.nades.he + p.nades.flash + p.nades.smoke; }
  hasSlot(p, slot) { return slot === 4 ? this.nadeCount(p) > 0 : !!p.weapons[slot]; }
  currentWeaponId(p) {
    if (p.slot === 4) return this.nadeCount(p) > 0 ? p.nadeSel : 'knife';
    return p.weapons[p.slot] ? p.weapons[p.slot].id : 'knife';
  }

  spawn(p, index) {
    if (p.team !== 'T' && p.team !== 'CT') return;
    const list = this.map.spawns[p.team];
    let sp;
    if (index >= 0) sp = list[index % list.length];
    else {
      const shuffled = list.slice().sort(() => Math.random() - 0.5);
      sp = shuffled.find((c) => ![...this.players.values()].some((q) => q !== p && q.alive && Math.hypot(q.x - c[0], q.z - c[2]) < 0.8)) || shuffled[0];
    }
    p.x = sp[0]; p.y = sp[1]; p.z = sp[2];
    p.vx = p.vy = p.vz = 0; p.onGround = true; p.crouch = false;
    p.yaw = this.map.spawnYaw[p.team]; p.pitch = 0;
    p.alive = true; p.hp = 100;
    p.dmgBy = new Map();
    p.history = [];
    p.reloadEnd = 0; p.scoped = 0; p.planting = 0; p.defusing = 0; p.blindUntil = 0;
    p.inputQueue.length = 0;
    p.drawEnd = this.now() + 300;
    if (!this.hasSlot(p, p.slot)) p.slot = p.weapons[1] ? 1 : 2;
    p.forceSync = true;
    const bot = this.bots.get(p.id);
    if (bot) { bot.onSpawn(); if (this.phase === 'warmup') { bot.bought = false; bot.buyAt = this.now() + 500; } }
  }

  // -------------------------------------------------------------------------
  // NETWORK INPUT HANDLERS
  // -------------------------------------------------------------------------
  onInputs(p, arr) {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length && i < 40; i++) {
      const inp = arr[i];
      if (!inp || !finite(inp.s) || inp.s <= p.lastSeq) continue;
      if (!finite(inp.y) || !finite(inp.p)) continue;
      p.inputQueue.push({
        seq: inp.s | 0,
        mx: S.clamp(+inp.x || 0, -1, 1),
        mz: S.clamp(+inp.z || 0, -1, 1),
        yaw: S.wrapAngle(inp.y),
        pitch: S.clamp(inp.p, -1.55, 1.55),
        b: inp.b | 0
      });
    }
    if (p.inputQueue.length > 120) p.inputQueue.splice(0, p.inputQueue.length - 120);
  }

  queueBotInput(p, inp) { p.inputQueue.push(inp); }

  canBuy(p) {
    if (!p.alive || (p.team !== 'T' && p.team !== 'CT')) return false;
    if (!S.inZone(this.map.buyZones[p.team], p.x, p.z)) return false;
    if (this.phase === 'warmup' || this.phase === 'freeze') return true;
    if (this.phase === 'live') return this.now() < this.buyEnd;
    return false;
  }

  onBuy(p, item) {
    const reply = (ok, msg) => { if (p.socket) p.socket.emit('buyr', { ok, msg, item }); return ok; };
    if (typeof item !== 'string') return false;
    if (!this.canBuy(p)) return reply(false, 'Satın alma bölgesinde/süresinde değilsin');
    const w = WEAPONS[item];
    if (w && w.grenade) {
      if (p.nades[item] >= GN.MAX[item]) return reply(false, 'Bu bombadan daha fazla taşıyamazsın');
      if (this.nadeCount(p) >= GN.MAX_TOTAL) return reply(false, `En fazla ${GN.MAX_TOTAL} bomba taşıyabilirsin`);
      if (p.money < w.price) return reply(false, 'Yetersiz bakiye');
      p.money -= w.price;
      p.nades[item]++;
      if (p.slot !== 4) p.nadeSel = item;
      return reply(true, `${w.name} alındı`);
    }
    if (w && !w.melee) {
      if (w.team && w.team !== p.team) return reply(false, 'Bu silah karşı takıma ait');
      const cur = p.weapons[w.slot];
      if (cur && cur.id === item) return reply(false, 'Zaten sende var');
      if (p.money < w.price) return reply(false, 'Yetersiz bakiye');
      p.money -= w.price;
      if (cur) this.spawnDrop(p, cur, false);
      p.weapons[w.slot] = { id: item, ammo: w.mag, reserve: w.reserve };
      this.switchSlot(p, w.slot, true);
      return reply(true, `${w.name} satın alındı`);
    }
    const it = ITEMS[item];
    if (!it) return reply(false, 'Bilinmeyen eşya');
    if (it.team && it.team !== p.team) return reply(false, 'Bu ekipman sadece CT içindir');
    if (item === 'kevlar') {
      if (p.armor >= 100) return reply(false, 'Zırhın zaten tam');
      if (p.money < it.price) return reply(false, 'Yetersiz bakiye');
      p.money -= it.price; p.armor = 100;
      return reply(true, 'Kevlar alındı');
    }
    if (item === 'helmet') {
      if (p.armor >= 100 && p.helmet) return reply(false, 'Zırh ve kask zaten var');
      const price = p.armor >= 100 ? 350 : it.price;
      if (p.money < price) return reply(false, 'Yetersiz bakiye');
      p.money -= price; p.armor = 100; p.helmet = true;
      return reply(true, 'Kevlar + Kask alındı');
    }
    if (item === 'defuse') {
      if (p.kit) return reply(false, 'İmha kitin zaten var');
      if (p.money < it.price) return reply(false, 'Yetersiz bakiye');
      p.money -= it.price; p.kit = true;
      return reply(true, 'İmha kiti alındı');
    }
    return reply(false, 'Geçersiz');
  }

  switchSlot(p, slot, force) {
    slot = slot | 0;
    if (slot < 1 || slot > 4 || !this.hasSlot(p, slot)) return;
    if (slot === 4 && p.slot === 4 && !force) {
      // cycle grenade type
      const i = GRENADE_ORDER.indexOf(p.nadeSel);
      for (let k = 1; k <= 3; k++) {
        const n = GRENADE_ORDER[(i + k) % 3];
        if (p.nades[n] > 0) { p.nadeSel = n; break; }
      }
      p.drawEnd = this.now() + 300;
      return;
    }
    if (slot === p.slot && !force) return;
    if (slot === 4 && !p.nades[p.nadeSel]) p.nadeSel = GRENADE_ORDER.find((n) => p.nades[n] > 0);
    if (slot !== p.slot) p.prevSlot = p.slot;
    p.slot = slot;
    p.reloadEnd = 0;
    p.scoped = 0;
    p.recoilIdx = 0;
    p.drawEnd = this.now() + WEAPONS[this.currentWeaponId(p)].drawTime * 1000;
  }

  onReload(p) {
    if (!p.alive || p.slot === 4) return;
    const ws = p.weapons[p.slot];
    if (!ws) return;
    const w = WEAPONS[ws.id];
    if (w.melee || p.reloadEnd || ws.ammo >= w.mag || ws.reserve <= 0) return;
    p.reloadEnd = this.now() + w.reload * 1000;
    p.scoped = 0;
  }

  onScope(p, level) {
    const ws = p.weapons[p.slot];
    if (!p.alive || !ws || p.slot === 4) return;
    const w = WEAPONS[ws.id];
    if (!w.scope || p.reloadEnd) { p.scoped = 0; return; }
    p.scoped = S.clamp(level | 0, 0, w.scope.length);
  }

  onShoot(p, msg) {
    const now = this.now();
    if (!p.alive || !msg || (this.phase !== 'live' && this.phase !== 'warmup' && this.phase !== 'post')) return;
    if (!finite(msg.seq) || msg.seq <= p.lastShotSeq) return;
    if (!finite(msg.yaw) || !finite(msg.pitch)) return;
    if (now < p.drawEnd - 60 || p.reloadEnd) return;
    const yaw = S.wrapAngle(msg.yaw), pitch = S.clamp(msg.pitch, -1.55, 1.55);
    if (p.slot === 4) { p.lastShotSeq = msg.seq | 0; this.throwGrenade(p, yaw, pitch, !!msg.lob); return; }
    const ws = p.weapons[p.slot];
    if (!ws) return;
    const w = WEAPONS[ws.id];
    const interval = 60000 / w.rpm;
    if (now - p.lastShot < interval * 0.8) return;
    if (!w.melee) {
      if (ws.ammo <= 0) return;
      ws.ammo--;
    }
    const serverIdx = S.recoilIndexAt(p.recoilIdx, now - p.lastShot, w);
    const idx = finite(msg.ri) && Math.abs(msg.ri - serverIdx) < 1.6 ? Math.max(0, msg.ri) : serverIdx;
    const speed = Math.hypot(p.vx, p.vz);
    const spread = S.getSpread(w, speed, p.onGround, p.crouch, p.scoped > 0);
    const recoil = w.melee ? [0, 0] : S.getRecoil(w, idx);
    const dirs = S.shotDirections(w, yaw, pitch, recoil, spread, p.num, msg.seq | 0);
    p.recoilIdx = idx + 1;
    p.lastShot = now;
    p.lastShotSeq = msg.seq | 0;
    if (w.scope && p.scoped) p.scoped = 0;
    const eye = [p.x, p.y + S.eyeHeight(p), p.z];
    const rewindT = finite(msg.t) ? S.clamp(msg.t, now - CONFIG.MAX_REWIND_MS, now) : now;
    const summary = { dealt: 0, head: false, killed: false, victims: new Set() };
    const ends = [];
    let hitAny = false, normal = null, bt = 0;
    for (const dir of dirs) {
      const res = this.traceShot(p, eye, dir, w, rewindT, summary);
      ends.push([r2(res.end[0]), r2(res.end[1]), r2(res.end[2])]);
      if (res.hitPlayer) hitAny = true;
      if (!normal && res.normal) { normal = res.normal; bt = res.blockType; }
    }
    if (summary.dealt > 0 && p.socket) p.socket.emit('hitc', { d: Math.round(summary.dealt), hs: summary.head ? 1 : 0, k: summary.killed ? 1 : 0 });
    this.io.to(this.id).emit('shot', {
      i: p.id, w: w.id, o: [r2(eye[0]), r2(eye[1]), r2(eye[2])], e: ends.length === 1 ? ends[0] : ends,
      n: normal, bt, hp: hitAny ? 1 : 0
    });
    if (ws.ammo === 0 && ws.reserve > 0 && !w.melee) p.reloadEnd = now + w.reload * 1000 + 250;
  }

  // -------------------------------------------------------------------------
  // DROPPED WEAPONS (CS-style: drop on death, G to throw, walk over / E to pick up)
  // -------------------------------------------------------------------------
  spawnDrop(p, ws, thrown) {
    if (!ws || !WEAPONS[ws.id] || WEAPONS[ws.id].melee) return null;
    const dir = S.anglesToDir(p.yaw, thrown ? 0.25 : 0);
    const sp = thrown ? 5.5 : 1.2;
    const d = {
      id: dropCounter++, wid: ws.id, ammo: ws.ammo, reserve: ws.reserve, by: p.id, t0: this.now(),
      x: p.x + dir[0] * 0.3, y: p.y + (thrown ? 1.4 : 0.9), z: p.z + dir[2] * 0.3,
      vx: dir[0] * sp + p.vx * 0.5, vy: thrown ? 2.5 : 1.5, vz: dir[2] * sp + p.vz * 0.5, yaw: p.yaw + (Math.random() - 0.5)
    };
    if (this.world.isSolid(Math.floor(d.x), Math.floor(d.y), Math.floor(d.z))) { d.x = p.x; d.z = p.z; }
    this.drops.push(d);
    if (this.drops.length > MAX_DROPS) this.drops.shift();
    return d;
  }
  onDropWeapon(p) {
    if (!p.alive || (p.slot !== 1 && p.slot !== 2)) return;
    const ws = p.weapons[p.slot];
    if (!ws) return;
    this.spawnDrop(p, ws, true);
    p.weapons[p.slot] = null;
    p.reloadEnd = 0; p.scoped = 0;
    this.switchSlot(p, p.weapons[1] ? 1 : p.weapons[2] ? 2 : 3, true);
  }
  canTake(p, d, now) {
    if (!p.alive || p.team === 'SPEC') return false;
    if (d.by === p.id && now - d.t0 < 1200) return false;   // don't instantly re-grab what you threw
    return Math.hypot(p.x - d.x, p.z - d.z) < PICKUP_RANGE && Math.abs(p.y + 0.3 - d.y) < 1.6;
  }
  takeDrop(p, d) {
    const w = WEAPONS[d.wid];
    const slot = w.slot;
    if (p.weapons[slot]) this.spawnDrop(p, p.weapons[slot], false);    // swap: drop what we hold in that slot
    p.weapons[slot] = { id: d.wid, ammo: d.ammo, reserve: d.reserve };
    this.drops.splice(this.drops.indexOf(d), 1);
    this.switchSlot(p, slot, true);
    if (p.socket) p.socket.emit('picked', { w: d.wid });
  }
  /** E near a weapon: swap with the one in the same slot */
  onPickup(p, id) {
    const now = this.now();
    const d = this.drops.find((x) => x.id === id) || this.drops.find((x) => this.canTake(p, x, now));
    if (d && this.canTake(p, d, now)) this.takeDrop(p, d);
  }
  updateDrops(now, dt) {
    for (const d of this.drops) {
      if (d.rest) continue;
      S.stepGrenade(d, dt, this.world);
    }
    // auto pick-up into EMPTY slots (walking over a weapon)
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        if (!this.canTake(p, d, now)) continue;
        if (!p.weapons[WEAPONS[d.wid].slot]) { this.takeDrop(p, d); break; }
      }
    }
  }

  // -------------------------------------------------------------------------
  // GRENADES
  // -------------------------------------------------------------------------
  throwGrenade(p, yaw, pitch, lob) {
    const type = p.nadeSel;
    if (!type || p.nades[type] <= 0) return;
    const now = this.now();
    if (now - p.lastShot < 600) return;
    p.lastShot = now;
    p.nades[type]--;
    const dir = S.anglesToDir(yaw, Math.min(1.4, pitch + 0.08));
    const sp = lob ? GN.LOB_SPEED : GN.THROW_SPEED;
    const eye = [p.x, p.y + S.eyeHeight(p) - 0.1, p.z];
    const g = {
      id: nadeCounter++, type, owner: p.id, team: p.team, t0: now,
      x: eye[0] + dir[0] * 0.4, y: eye[1] + dir[1] * 0.4, z: eye[2] + dir[2] * 0.4,
      vx: dir[0] * sp + p.vx * 0.6, vy: dir[1] * sp + (lob ? 1.5 : 2.2), vz: dir[2] * sp + p.vz * 0.6
    };
    if (this.world.isSolid(Math.floor(g.x), Math.floor(g.y), Math.floor(g.z))) { g.x = eye[0]; g.y = eye[1]; g.z = eye[2]; }
    this.nades.push(g);
    this.io.to(this.id).emit('throw', { i: p.id, ty: type });
    if (this.nadeCount(p) === 0) this.switchSlot(p, p.weapons[1] ? 1 : 2, true);
    else if (!p.nades[type]) this.switchSlot(p, 4, false);
    p.drawEnd = now + 450;
  }

  updateGrenades(now, dt) {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const g = this.nades[i];
      const bounced = S.stepGrenade(g, dt, this.world);
      if (bounced) this.io.to(this.id).emit('nadeb', { x: r2(g.x), y: r2(g.y), z: r2(g.z) });
      const age = (now - g.t0) / 1000;
      let det = false;
      if (g.type === 'he') det = age >= GN.he.fuse;
      else if (g.type === 'flash') det = age >= GN.flash.fuse;
      else if (g.type === 'smoke') det = (g.rest && age >= GN.smoke.minFuse) || age >= GN.smoke.maxFuse;
      if (!det) continue;
      this.nades.splice(i, 1);
      this.detonate(g, now);
    }
    this.smokes = this.smokes.filter((s) => now - s.t0 < GN.smoke.duration * 1000);
  }

  detonate(g, now) {
    const pos = [g.x, g.y + 0.1, g.z];
    const owner = this.players.get(g.owner) || null;
    this.io.to(this.id).emit('nade', { e: g.type, x: r2(pos[0]), y: r2(pos[1]), z: r2(pos[2]), id: g.id });
    if (g.type === 'he') {
      const cfg = GN.he;
      for (const q of this.players.values()) {
        if (!q.alive) continue;
        if (owner && q !== owner && q.team === owner.team && !CONFIG.FRIENDLY_FIRE) continue;
        const chest = [q.x, q.y + 1.1, q.z];
        const d = Math.hypot(chest[0] - pos[0], chest[1] - pos[1], chest[2] - pos[2]);
        if (d > cfg.radius || !S.lineClear(this.world, pos, chest)) continue;
        let dmg = cfg.damage * Math.pow(1 - d / cfg.radius, 1.3);
        if (q.armor > 0) { const a = Math.min(q.armor, dmg * 0.25); q.armor = Math.max(0, Math.round(q.armor - a)); dmg *= 0.55; }
        if (dmg < 1) continue;
        const r = this.dealDamage(q, owner, dmg, 'chest', 'he');
        if (owner && owner.socket && q !== owner && r.dealt > 0) owner.socket.emit('hitc', { d: Math.round(r.dealt), hs: 0, k: r.killed ? 1 : 0 });
      }
      const rr = cfg.blockRadius;
      for (let y = Math.floor(pos[1] - rr); y <= pos[1] + rr; y++)
        for (let z = Math.floor(pos[2] - rr); z <= pos[2] + rr; z++)
          for (let x = Math.floor(pos[0] - rr); x <= pos[0] + rr; x++)
            if (Math.hypot(x + 0.5 - pos[0], y + 0.5 - pos[1], z + 0.5 - pos[2]) <= rr) this.damageBlock(x, y, z, 220);
    } else if (g.type === 'flash') {
      const cfg = GN.flash;
      for (const q of this.players.values()) {
        if (!q.alive) continue;
        const eye = [q.x, q.y + S.eyeHeight(q), q.z];
        const d = Math.hypot(eye[0] - pos[0], eye[1] - pos[1], eye[2] - pos[2]);
        if (d > cfg.range || !S.lineClear(this.world, pos, eye) || S.smokeBlocks(this.smokes, eye, pos, now)) continue;
        const view = S.anglesToDir(q.yaw, q.pitch);
        const to = [(pos[0] - eye[0]) / (d || 1), (pos[1] - eye[1]) / (d || 1), (pos[2] - eye[2]) / (d || 1)];
        const facing = view[0] * to[0] + view[1] * to[1] + view[2] * to[2];
        const f = facing > 0.55 ? 1 : facing > 0.05 ? 0.55 : 0.2;
        const ms = Math.round(cfg.maxBlind * 1000 * f * S.clamp(1.15 - d / cfg.range, 0.3, 1));
        if (ms < 150) continue;
        q.blindUntil = Math.max(q.blindUntil, now + ms);
        if (q.socket) q.socket.emit('flashed', { d: ms });
        if (owner && owner.socket && q !== owner && q.team !== owner.team) owner.socket.emit('msg', { text: `${q.name} kör oldu (${(ms / 1000).toFixed(1)} sn)` });
      }
    } else if (g.type === 'smoke') {
      this.smokes.push({ id: g.id, x: pos[0], y: pos[1] + 0.8, z: pos[2], t0: now });
    }
  }

  // -------------------------------------------------------------------------
  // HIT DETECTION (lag compensated)
  // -------------------------------------------------------------------------
  positionAt(q, t) {
    const h = q.history;
    if (!h.length) return { x: q.x, y: q.y, z: q.z, crouch: q.crouch };
    if (t >= h[h.length - 1].t) return h[h.length - 1];
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (t >= a.t && t <= b.t) {
        const f = (t - a.t) / Math.max(1, b.t - a.t);
        return { x: S.lerp(a.x, b.x, f), y: S.lerp(a.y, b.y, f), z: S.lerp(a.z, b.z, f), crouch: f < 0.5 ? a.crouch : b.crouch };
      }
    }
    return h[0];
  }

  traceShot(p, eye, dir, w, rewindT, summary) {
    const range = w.range;
    const blockHits = [];
    let tStop = range;
    let penLeft = w.penetration;
    let stopNormal = null, stopType = 0;
    this.world.traverse(eye, dir, range, (x, y, z, t, n, type) => {
      const info = BLOCK_INFO[type];
      blockHits.push({ x, y, z, t, n, type });
      if (info.hp > 0 && penLeft > 0) { penLeft--; return false; }
      tStop = t; stopNormal = n; stopType = type;
      return true;
    });
    let best = null;
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      const pos = this.positionAt(q, rewindT);
      for (const hb of S.getHitboxes(pos.x, pos.y, pos.z, pos.crouch)) {
        const t = S.rayAABB(eye, dir, hb.min, hb.max);
        if (t >= 0 && t < tStop && t <= range && (!best || t < best.t)) best = { q, part: hb.part, t };
      }
    }
    let dmgMul = 1;
    const blockDmg = w.pellets > 1 ? w.damage * 0.5 : w.damage * (w.melee ? 1.2 : 0.6);
    for (const bh of blockHits) {
      if (best && bh.t > best.t) break;
      if (BLOCK_INFO[bh.type].hp > 0) {
        this.damageBlock(bh.x, bh.y, bh.z, blockDmg * dmgMul);
        if (bh.t < tStop) dmgMul *= 0.5;
      }
    }
    if (best) {
      const dist = best.t;
      const dmg = w.damage * dmgMul * Math.pow(w.rangeMod, dist / 10) * CONFIG.PART_MUL[best.part];
      const r = this.dealDamage(best.q, p, dmg, best.part, w.id);
      if (summary) {
        summary.dealt += r.dealt;
        if (best.part === 'head' && r.dealt > 0) summary.head = true;
        if (r.killed) summary.killed = true;
      }
      return { end: [eye[0] + dir[0] * dist, eye[1] + dir[1] * dist, eye[2] + dir[2] * dist], normal: null, blockType: 0, hitPlayer: true };
    }
    const tEnd = Math.min(tStop, range);
    return { end: [eye[0] + dir[0] * tEnd, eye[1] + dir[1] * tEnd, eye[2] + dir[2] * tEnd], normal: stopNormal, blockType: stopType, hitPlayer: false };
  }

  damageBlock(x, y, z, amount) {
    if (y <= 0) return;   // never open holes in the floor
    const type = this.world.get(x, y, z);
    const info = BLOCK_INFO[type];
    if (!info || info.hp <= 0) return;
    const key = x + ',' + y + ',' + z;
    const hp = (this.blockHp.has(key) ? this.blockHp.get(key) : info.hp) - amount;
    if (hp <= 0) {
      this.blockHp.delete(key);
      this.world.set(x, y, z, BLOCK.AIR);
      this.pendingBlocks.push([x, y, z, BLOCK.AIR, type]);
      if (y <= 2) this.navDirty = true;
    } else this.blockHp.set(key, hp);
  }

  /** Applies armour + difficulty modifiers. Returns {dealt, killed}. */
  dealDamage(victim, attacker, rawDmg, part, weaponId) {
    if (!victim.alive) return { dealt: 0, killed: false };
    if (attacker && attacker !== victim && attacker.team === victim.team && !CONFIG.FRIENDLY_FIRE) return { dealt: 0, killed: false };
    if (attacker && attacker.isBot && !victim.isBot) rawDmg *= this.diff.botDamageMul;
    const w = WEAPONS[weaponId] || { armorPen: 1 };
    let health = rawDmg;
    if (weaponId !== 'he') {
      const armored = victim.armor > 0 && (part === 'chest' || (part === 'head' && victim.helmet));
      if (armored) {
        health = rawDmg * w.armorPen;
        let armorDmg = (rawDmg - health) * 0.5;
        if (armorDmg > victim.armor) { health += (armorDmg - victim.armor) * 2; armorDmg = victim.armor; }
        victim.armor = Math.max(0, Math.round(victim.armor - armorDmg));
      }
    }
    health = Math.max(1, Math.round(health));
    const dealt = Math.min(health, victim.hp);
    victim.hp -= health;
    if (attacker) {
      victim.dmgBy.set(attacker.id, (victim.dmgBy.get(attacker.id) || 0) + dealt);
      victim.lastAttacker = attacker.id;
      victim.lastAttackTime = this.now();
      if (attacker !== victim) attacker.damageDealt += dealt;
    }
    const killed = victim.hp <= 0;
    if (victim.socket) {
      const from = attacker && attacker !== victim ? [r2(attacker.x), r2(attacker.z)] : null;
      victim.socket.emit('dmg', { d: dealt, f: from, hs: part === 'head' ? 1 : 0 });
    }
    const bot = this.bots.get(victim.id);
    if (bot && attacker) bot.onDamaged(attacker);
    if (killed) {
      victim.hp = 0;
      if (attacker && part === 'head') attacker.headshots++;
      this.killPlayer(victim, attacker, weaponId, part === 'head');
    }
    return { dealt, killed };
  }

  killPlayer(victim, killer, weaponId, headshot) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.scoped = 0;
    this.dropBombIfCarrier(victim);
    victim.respawnAt = this.now() + R.WARMUP_RESPAWN * 1000;
    const warm = this.phase === 'warmup';
    if (killer && killer !== victim) {
      if (killer.team === victim.team) {
        killer.kills--;
        if (!warm) killer.money = Math.max(0, killer.money - 300);
      } else {
        killer.kills++;
        killer.roundKills++;
        const reward = (WEAPONS[weaponId] || WEAPONS.knife).killReward;
        if (!warm) killer.money = Math.min(E.MAX, killer.money + reward);
      }
    }
    for (const [aid, dmg] of victim.dmgBy) {
      if (killer && aid === killer.id) continue;
      const a = this.players.get(aid);
      if (a && dmg >= 41 && a.team !== victim.team) a.assists++;
    }
    const best = victim.weapons[1] || victim.weapons[2];
    if (best) this.spawnDrop(victim, best, false);
    victim.weapons = { 1: null, 2: null, 3: { id: 'knife', ammo: 0, reserve: 0 } };
    victim.nades = { he: 0, flash: 0, smoke: 0 };
    victim.armor = 0; victim.helmet = false; victim.kit = false;
    victim.needsDefaults = true;
    this.io.to(this.id).emit('kill', {
      k: killer ? killer.id : null, kn: killer ? killer.name : '', kt: killer ? killer.team : '',
      v: victim.id, vn: victim.name, vt: victim.team, w: weaponId, hs: headshot ? 1 : 0
    });
  }

  dropBombIfCarrier(p) {
    if (this.bomb.state === 'carried' && this.bomb.carrier === p.id) {
      this.bomb = { state: 'dropped', x: p.x, y: p.y, z: p.z };
      this.io.to(this.id).emit('bomb', { e: 'dropped', x: r2(p.x), y: r2(p.y), z: r2(p.z), by: p.name });
    }
  }

  // -------------------------------------------------------------------------
  // WORLD
  // -------------------------------------------------------------------------
  resetWorld() {
    this.world.data.set(this.baseData);
    this.blockHp.clear();
    this.pendingBlocks = [];
    this.nades = [];
    this.smokes = [];
    this.drops = [];
    this.nav = S.buildNav(this.world);
    this.navVersion++;
    this.io.to(this.id).emit('wreset', { map: this.mapId });
  }

  worldDiff() {
    const out = [];
    const d = this.world.data, b = this.baseData, w = this.world;
    for (let i = 0; i < d.length; i++) {
      if (d[i] !== b[i]) {
        const x = i % w.sx, z = Math.floor(i / w.sx) % w.sz, y = Math.floor(i / (w.sx * w.sz));
        out.push([x, y, z, d[i]]);
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // ROUND FLOW
  // -------------------------------------------------------------------------
  startMatch() {
    this.round = 0;
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    for (const p of this.players.values()) {
      p.kills = p.deaths = p.assists = p.mvps = p.damageDealt = p.headshots = 0;
      p.money = this.diff.startMoney;
      p.alive = false;
      this.giveDefaults(p);
    }
    this.broadcastMsg(`MAÇ BAŞLIYOR · ${this.map.name} · ${this.diff.label} · İlk 13 raunt kazanan takım galip gelir.`);
    this.startRound();
  }

  startRound() {
    this.round++;
    this.resetWorld();
    const now = this.now();
    let ti = 0, ci = 0;
    for (const p of this.players.values()) {
      p.roundKills = 0;
      if (p.team !== 'T' && p.team !== 'CT') continue;
      if (!p.alive || p.needsDefaults) {
        const keepMoney = p.money;
        this.giveDefaults(p);
        p.money = keepMoney;
        p.needsDefaults = false;
      }
      this.spawn(p, p.team === 'T' ? ti++ : ci++);
      // every round starts with full magazines and full reserve ammo
      for (const slot of [1, 2]) {
        const ws = p.weapons[slot];
        if (ws && WEAPONS[ws.id]) { ws.ammo = WEAPONS[ws.id].mag; ws.reserve = WEAPONS[ws.id].reserve; }
      }
      p.reloadEnd = 0;
      if (!p.weapons[2]) {
        const pistol = p.team === 'CT' ? 'p12' : 'p9';
        p.weapons[2] = { id: pistol, ammo: WEAPONS[pistol].mag, reserve: WEAPONS[pistol].reserve };
      }
    }
    const ts = [...this.players.values()].filter((p) => p.team === 'T' && p.alive);
    const humansT = ts.filter((p) => !p.isBot);
    const pool = humansT.length ? humansT : ts;
    const carrier = pool[Math.floor(Math.random() * pool.length)];
    this.bomb = carrier ? { state: 'carried', carrier: carrier.id } : { state: 'none' };
    this.botPlan = { site: Math.random() < 0.5 ? 'A' : 'B' };
    this.phase = 'freeze';
    this.roundStart = now;
    this.phaseEnd = now + R.FREEZE * 1000;
    this.buyEnd = now + (R.FREEZE + R.BUY_WINDOW) * 1000;
    for (const b of this.bots.values()) b.onRoundStart();
    this.io.to(this.id).emit('rstart', { rd: this.round, carrier: carrier ? carrier.id : null });
  }

  endRound(winner, reason) {
    if (this.phase !== 'live') return;
    const now = this.now();
    const loser = winner === 'T' ? 'CT' : 'T';
    this.score[winner]++;
    let winMoney = E.WIN_ELIM;
    if (reason === 'bomb') winMoney = E.WIN_BOMB;
    else if (reason === 'defuse') winMoney = E.WIN_DEFUSE;
    else if (reason === 'time') winMoney = E.WIN_TIME;
    const lossMoney = Math.round(Math.min(E.LOSS_BASE + E.LOSS_STEP * this.lossStreak[loser], E.LOSS_MAX) * this.diff.lossBonusMul);
    this.lossStreak[loser] = Math.min(this.lossStreak[loser] + 1, 4);
    this.lossStreak[winner] = Math.max(0, this.lossStreak[winner] - 1);
    const planted = this.bomb.state === 'planted' || this.bomb.state === 'exploded' || this.bomb.state === 'defused';
    let mvp = null;
    for (const p of this.players.values()) {
      if (p.team === winner) {
        p.money = Math.min(E.MAX, p.money + winMoney);
        if (!mvp || p.roundKills > mvp.roundKills) mvp = p;
      } else if (p.team === loser) {
        const noBonus = loser === 'T' && reason === 'time' && p.alive;
        let m = noBonus ? 0 : lossMoney;
        if (loser === 'T' && planted) m += E.PLANT_TEAM_BONUS;
        p.money = Math.min(E.MAX, p.money + m);
      }
    }
    if (mvp) mvp.mvps++;
    this.phase = 'post';
    this.phaseEnd = now + R.POST * 1000;
    this.io.to(this.id).emit('rend', { w: winner, r: reason, sc: this.score, mvp: mvp ? mvp.name : null });
  }

  afterPost() {
    const total = this.score.T + this.score.CT;
    if (this.score.T >= R.WIN || this.score.CT >= R.WIN || total >= R.MAX_ROUNDS) {
      const winner = this.score.T > this.score.CT ? 'T' : this.score.CT > this.score.T ? 'CT' : 'DRAW';
      this.phase = 'gameover';
      this.phaseEnd = this.now() + R.GAMEOVER * 1000;
      const next = S.nextMapId(this.mapId);
      const stats = [...this.players.values()].filter((p) => p.team !== 'SPEC').map((p) => ({
        n: p.name, t: p.team, k: p.kills, d: p.deaths, a: p.assists, mv: p.mvps, dmg: p.damageDealt, hs: p.headshots, bt: p.isBot ? 1 : 0
      }));
      this.io.to(this.id).emit('over', { w: winner, sc: this.score, next, nextName: S.getMap(next).name, stats });
      return;
    }
    if (total === R.HALF) {
      for (const p of this.players.values()) {
        if (p.team === 'T') p.team = 'CT'; else if (p.team === 'CT') p.team = 'T';
        p.money = this.diff.startMoney;
        p.alive = false;
        this.giveDefaults(p);
      }
      this.score = { T: this.score.CT, CT: this.score.T };
      this.lossStreak = { T: 0, CT: 0 };
      this.io.to(this.id).emit('half', { sc: this.score });
      this.broadcastMsg('DEVRE ARASI — Takımlar taraf değiştirdi!');
    }
    this.startRound();
  }

  plantBomb(p, site) {
    const now = this.now();
    this.bomb = { state: 'planted', x: p.x, y: p.y, z: p.z, site, plantedAt: now, explodeAt: now + BB.TIMER * 1000, defuser: null, defuseStart: 0, defuseDur: 0 };
    p.money = Math.min(E.MAX, p.money + E.PLANT_REWARD);
    p.planting = 0;
    this.io.to(this.id).emit('bomb', { e: 'planted', x: r2(p.x), y: r2(p.y), z: r2(p.z), site, by: p.name, ex: this.bomb.explodeAt });
  }

  explodeBomb() {
    const b = this.bomb;
    b.state = 'exploded';
    const c = [b.x, b.y + 0.5, b.z];
    const sigma = BB.RADIUS / 3;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - c[0], p.y + 0.9 - c[1], p.z - c[2]);
      if (d > BB.RADIUS * 1.2) continue;
      let dmg = BB.DAMAGE * Math.exp(-(d * d) / (2 * sigma * sigma));
      if (p.armor > 0) { const a = Math.min(p.armor, dmg * 0.25); p.armor -= Math.round(a); dmg -= a * 2; }
      if (dmg >= 1) {
        p.hp -= Math.round(dmg);
        if (p.socket) p.socket.emit('dmg', { d: Math.round(dmg), f: [r2(c[0]), r2(c[2])], hs: 0 });
        if (p.hp <= 0) this.killPlayer(p, null, 'bomb', false);
      }
    }
    const rr = BB.BLOCK_RADIUS;
    for (let y = Math.floor(c[1] - rr); y <= c[1] + rr; y++)
      for (let z = Math.floor(c[2] - rr); z <= c[2] + rr; z++)
        for (let x = Math.floor(c[0] - rr); x <= c[0] + rr; x++)
          if (Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1], z + 0.5 - c[2]) <= rr) this.damageBlock(x, y, z, 9999);
    this.io.to(this.id).emit('bomb', { e: 'exploded', x: r2(b.x), y: r2(b.y), z: r2(b.z) });
  }

  updateGame(now) {
    switch (this.phase) {
      case 'warmup': {
        for (const p of this.players.values()) {
          if ((p.team === 'T' || p.team === 'CT') && !p.alive && now >= p.respawnAt) {
            this.giveDefaults(p);
            p.money = E.WARMUP_MONEY;
            this.spawn(p, -1);
          }
        }
        const ready = this.teamCount('T') > 0 && this.teamCount('CT') > 0;
        if (!ready) { this.phaseEnd = 0; break; }
        if (!this.phaseEnd) this.phaseEnd = now + R.WARMUP * 1000;
        if (now >= this.phaseEnd) this.startMatch();
        break;
      }
      case 'freeze':
        if (now >= this.phaseEnd) {
          this.phase = 'live';
          this.phaseEnd = now + R.LIVE * 1000;
          this.io.to(this.id).emit('live', {});
        }
        break;
      case 'live':
        this.updateBomb(now);
        if (this.phase !== 'live') break;
        this.checkRoundEnd(now);
        break;
      case 'post':
        this.updateBomb(now);
        if (now >= this.phaseEnd) this.afterPost();
        break;
      case 'gameover':
        if (now >= this.phaseEnd) {
          this.loadMap(S.nextMapId(this.mapId));
          this.phase = 'warmup';
          this.phaseEnd = 0;
          this.round = 0;
          this.score = { T: 0, CT: 0 };
          this.bomb = { state: 'none' };
          this.nades = []; this.smokes = [];
          this.io.to(this.id).emit('wreset', { map: this.mapId });
          for (const p of this.players.values()) { p.alive = false; p.respawnAt = 0; p.kills = p.deaths = p.assists = p.mvps = 0; }
        }
        break;
    }
  }

  updateBomb(now) {
    const b = this.bomb;
    if (b.state === 'carried') {
      const c = this.players.get(b.carrier);
      if (!c || !c.alive || c.team !== 'T') {
        if (c) this.dropBombIfCarrier(c);
        else this.bomb = { state: 'none' };
        return;
      }
      const site = S.siteAt(this.map, c.x, c.z);
      if (this.phase === 'live' && c.useHeld && site && c.onGround) {
        if (!c.planting) c.planting = Math.max(1, now);
        if (now - c.planting >= BB.PLANT * 1000) this.plantBomb(c, site);
      } else c.planting = 0;
    } else if (b.state === 'dropped') {
      for (const p of this.players.values()) {
        if (p.alive && p.team === 'T' && Math.hypot(p.x - b.x, p.z - b.z) < BB.PICKUP_RANGE && Math.abs(p.y - b.y) < 2) {
          this.bomb = { state: 'carried', carrier: p.id };
          this.io.to(this.id).emit('bomb', { e: 'picked', by: p.name, id: p.id });
          break;
        }
      }
    } else if (b.state === 'planted') {
      if (now >= b.explodeAt) {
        this.explodeBomb();
        if (this.phase === 'live') this.endRound('T', 'bomb');
        return;
      }
      if (this.phase !== 'live') return;
      let def = b.defuser ? this.players.get(b.defuser) : null;
      const inRange = (p) => p && p.alive && p.team === 'CT' && p.useHeld && p.onGround &&
        Math.hypot(p.x - b.x, p.z - b.z) < BB.DEFUSE_RANGE && Math.abs(p.y - b.y) < 2;
      if (!inRange(def)) {
        if (def) def.defusing = 0;
        def = null; b.defuser = null;
        for (const p of this.players.values()) if (inRange(p)) { def = p; break; }
        if (def) {
          b.defuser = def.id; b.defuseStart = now; b.defuseDur = (def.kit ? BB.DEFUSE_KIT : BB.DEFUSE) * 1000;
          def.defusing = Math.max(1, now);
          this.io.to(this.id).emit('bomb', { e: 'defusing', by: def.name, kit: def.kit ? 1 : 0 });
        }
      }
      if (def && now - b.defuseStart >= b.defuseDur) {
        b.state = 'defused';
        def.defusing = 0;
        def.money = Math.min(E.MAX, def.money + E.DEFUSE_REWARD);
        this.io.to(this.id).emit('bomb', { e: 'defused', by: def.name, x: r2(b.x), y: r2(b.y), z: r2(b.z) });
        this.endRound('CT', 'defuse');
      }
    }
  }

  checkRoundEnd(now) {
    const tCount = this.teamCount('T'), ctCount = this.teamCount('CT');
    const tAlive = this.aliveCount('T'), ctAlive = this.aliveCount('CT');
    const planted = this.bomb.state === 'planted';
    if (ctCount > 0 && ctAlive === 0) return this.endRound('T', 'elim');
    if (ctCount === 0) return this.endRound('T', 'elim');
    if (!planted && (tCount === 0 || tAlive === 0)) return this.endRound('CT', 'elim');
    if (!planted && now >= this.phaseEnd) return this.endRound('CT', 'time');
  }

  // -------------------------------------------------------------------------
  // TICK
  // -------------------------------------------------------------------------
  safeTick() {
    try { this.tick(); } catch (err) { console.error('[room ' + this.id + '] tick error', err); }
  }

  tick() {
    const real = Date.now();
    // Real elapsed time (not the nominal 33 ms): keeps movement speed correct even when
    // the host CPU is throttled and timers fire late (e.g. free cloud tiers).
    const elapsed = Math.min(0.5, Math.max(0, (real - this.lastTickReal) / 1000));
    this.lastTickReal = real;
    const now = this.now();
    this.tickCount++;

    if (this.navDirty) { this.nav = S.buildNav(this.world); this.navVersion++; this.navDirty = false; }

    // Bots think at 15 Hz (staggered) — plenty for human-like reactions, halves CPU cost
    let bi = 0;
    for (const b of this.bots.values()) {
      if ((this.tickCount + bi++) % 2 === 0) b.think(now, 2);
    }

    const stepDt = 1 / CONFIG.INPUT_RATE;
    for (const p of this.players.values()) {
      p.budget = Math.min(p.budget + elapsed * 1.03, 0.5);
      if (p.reloadEnd && now >= p.reloadEnd) {
        const ws = p.weapons[p.slot];
        if (ws && p.slot !== 4) {
          const w = WEAPONS[ws.id];
          const take = Math.min(w.mag - ws.ammo, ws.reserve);
          ws.ammo += take; ws.reserve -= take;
        }
        p.reloadEnd = 0;
      }
      while (p.inputQueue.length && p.budget >= stepDt * 0.999) {
        const inp = p.inputQueue.shift();
        p.budget -= stepDt;
        this.applyInput(p, inp, stepDt);
      }
      if (p.alive) {
        p.history.push({ t: now, x: p.x, y: p.y, z: p.z, crouch: p.crouch });
        while (p.history.length && p.history[0].t < now - 1000) p.history.shift();
      }
    }

    this.updateGrenades(now, elapsed || 1 / CONFIG.TICK_RATE);
    if (this.drops.length) this.updateDrops(now, elapsed || 1 / CONFIG.TICK_RATE);
    this.updateGame(this.now());

    if (this.pendingBlocks.length) {
      this.io.to(this.id).emit('blocks', this.pendingBlocks);
      this.pendingBlocks = [];
    }
    this.sendSnapshots(now);
  }

  applyInput(p, inp, dt) {
    p.lastSeq = inp.seq;
    p.yaw = inp.yaw; p.pitch = inp.pitch;
    p.buttons = inp.b;
    if (!p.alive) { p.useHeld = false; return; }
    p.useHeld = !!(inp.b & BTN.USE);
    const frozen = this.phase === 'freeze' || this.phase === 'gameover' || !!p.planting || !!p.defusing;
    const ev = S.stepPlayer(p, inp, dt, this.world, { speedMul: S.weaponSpeedMul(this.currentWeaponId(p), p.scoped > 0), frozen });
    if (ev.landSpeed > CONFIG.FALL.SAFE_SPEED) {
      const dmg = Math.round((ev.landSpeed - CONFIG.FALL.SAFE_SPEED) * CONFIG.FALL.DMG_PER);
      if (dmg > 0) {
        p.hp -= dmg;
        if (p.socket) p.socket.emit('dmg', { d: dmg, f: null, hs: 0 });
        if (p.hp <= 0) this.killPlayer(p, null, 'fall', false);
      }
    }
  }

  // -------------------------------------------------------------------------
  // SNAPSHOTS
  // -------------------------------------------------------------------------
  bombPublic(now) {
    const b = this.bomb;
    const o = { s: b.state };
    if (b.state === 'carried') o.c = b.carrier;
    if (b.state === 'dropped' || b.state === 'planted' || b.state === 'defused' || b.state === 'exploded') { o.x = r2(b.x); o.y = r2(b.y); o.z = r2(b.z); }
    if (b.state === 'planted') {
      o.ex = b.explodeAt; o.site = b.site;
      if (b.defuser) o.dp = r3(Math.min(1, (now - b.defuseStart) / b.defuseDur));
    }
    return o;
  }

  roster() {
    return [...this.players.values()].map((p) => ({
      i: p.id, n: p.name, t: p.team, k: p.kills, d: p.deaths, a: p.assists, mv: p.mvps,
      m: p.money, pg: p.isBot ? 0 : p.ping, bt: p.isBot ? 1 : 0, al: p.alive ? 1 : 0, nu: p.num,
      ar: p.armor > 0 ? (p.helmet ? 2 : 1) : 0, wp: p.alive ? this.currentWeaponId(p) : ''
    }));
  }

  youState(p, now) {
    const wp = {};
    for (const s of [1, 2, 3]) { const ws = p.weapons[s]; wp[s] = ws ? [ws.id, ws.ammo, ws.reserve] : null; }
    const nc = this.nadeCount(p);
    wp[4] = nc > 0 ? [p.nadeSel && p.nades[p.nadeSel] ? p.nadeSel : GRENADE_ORDER.find((n) => p.nades[n] > 0), nc, 0] : null;
    const y = {
      s: p.lastSeq, x: r3(p.x), y: r3(p.y), z: r3(p.z), vx: r3(p.vx), vy: r3(p.vy), vz: r3(p.vz),
      og: p.onGround ? 1 : 0, c: p.crouch ? 1 : 0, a: p.alive ? 1 : 0, tm: p.team,
      hp: Math.max(0, p.hp), ar: p.armor, hm: p.helmet ? 1 : 0, kt: p.kit ? 1 : 0, m: p.money,
      sl: p.slot, wp, nd: [p.nades.he, p.nades.flash, p.nades.smoke],
      rl: p.reloadEnd ? Math.max(0, p.reloadEnd - now) : 0, dr: Math.max(0, p.drawEnd - now),
      ss: p.lastShotSeq, sc: p.scoped, cb: this.canBuy(p) ? 1 : 0
    };
    if (p.planting) y.pl = r3(Math.min(1, (now - p.planting) / (BB.PLANT * 1000)));
    if (p.forceSync) { y.fs = 1; y.yw = r3(p.yaw); y.pt = r3(p.pitch); p.forceSync = false; }
    return y;
  }

  sendSnapshots(now) {
    const pubs = [];
    for (const p of this.players.values()) {
      if (p.team !== 'T' && p.team !== 'CT') continue;
      // compact wire format (≈45% smaller than named objects):
      // [id, x, y, z, yaw, pitch, vx, vz, flags, team(0=T,1=CT), weapon, hp]
      const flags = (p.crouch ? 1 : 0) | (p.alive ? 2 : 0) | (p.onGround ? 4 : 0) | (p.reloadEnd ? 8 : 0) | (p.planting ? 16 : 0) | (p.defusing ? 32 : 0);
      pubs.push([p.id, r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(p.pitch), Math.round(p.vx * 10) / 10, Math.round(p.vz * 10) / 10,
        flags, p.team === 'CT' ? 1 : 0, this.currentWeaponId(p), Math.max(0, p.hp)]);
    }
    const base = {
      t: now, ph: this.phase, pe: this.phaseEnd, rd: this.round, sc: this.score, be: this.buyEnd,
      b: this.bombPublic(now), p: pubs
    };
    if (this.nades.length) base.g = this.nades.map((g) => [g.id, g.type, r2(g.x), r2(g.y), r2(g.z)]);
    if (this.drops.length) base.d = this.drops.map((d) => [d.id, d.wid, r2(d.x), r2(d.y), r2(d.z), r2(d.yaw)]);
    if (this.smokes.length) base.sm = this.smokes.map((s) => [s.id, r2(s.x), r2(s.y), r2(s.z), s.t0]);
    if (this.tickCount % 15 === 1) base.r = this.roster();
    for (const p of this.players.values()) {
      if (!p.socket) continue;
      p.socket.volatile.emit('snap', Object.assign({}, base, { y: this.youState(p, now) }));
    }
  }

  broadcastMsg(text) { this.io.to(this.id).emit('msg', { text }); }
  /** send to every human socket of a team (team chat / voice signalling) */
  teamSockets(team, exceptId) {
    const out = [];
    for (const q of this.players.values()) if (q.socket && q.team === team && q.id !== exceptId) out.push(q.socket);
    return out;
  }

  initPayload(p) {
    return {
      id: p.id, num: p.num, room: this.id, t: this.now(), blocks: this.worldDiff(), roster: this.roster(),
      version: CONFIG.VERSION, map: this.mapId, difficulty: this.diff.id
    };
  }
}

module.exports = Room;
