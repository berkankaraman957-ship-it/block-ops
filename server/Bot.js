'use strict';
/*
 * BotBrain — server-side AI that produces the SAME input stream a human client sends
 * (so bots obey identical physics, fire-rate, recoil and lag-comp rules).
 * Waypoint-graph navigation (Dijkstra), line-of-sight target acquisition with human-like
 * reaction time, aim error, burst control with partial recoil compensation,
 * bomb planting / defusing / pickup and a basic buy logic.
 */
const S = require('../shared/shared.js');
const { CONFIG, WEAPONS, MAP, BTN } = S;

const NODES = MAP.waypoints;
const ADJ = {};
for (const k of Object.keys(NODES)) ADJ[k] = [];
for (const [a, b] of MAP.edges) { ADJ[a].push(b); ADJ[b].push(a); }

function nodeDist(a, b) { return Math.hypot(NODES[a][0] - NODES[b][0], NODES[a][1] - NODES[b][1]); }

function shortestPath(from, to) {
  if (from === to) return [to];
  const dist = {}, prev = {}, open = new Set(Object.keys(NODES));
  for (const k of open) dist[k] = Infinity;
  dist[from] = 0;
  while (open.size) {
    let u = null;
    for (const k of open) if (u === null || dist[k] < dist[u]) u = k;
    if (u === null || dist[u] === Infinity) break;
    open.delete(u);
    if (u === to) break;
    for (const v of ADJ[u]) {
      const alt = dist[u] + nodeDist(u, v) * (0.85 + Math.random() * 0.3);
      if (alt < dist[v]) { dist[v] = alt; prev[v] = u; }
    }
  }
  const path = [];
  let c = to;
  while (c) { path.unshift(c); if (c === from) break; c = prev[c]; }
  return path[0] === from ? path : [to];
}

function nearestNode(x, z, world, y) {
  let best = null, bd = Infinity;
  for (const [k, [nx, nz]] of Object.entries(NODES)) {
    const d = Math.hypot(nx - x, nz - z);
    if (d >= bd) continue;
    // prefer nodes with line of sight
    const eye = [x, (y || 1) + 1.5, z];
    const dir = [nx - x, 0, nz - z];
    const len = Math.hypot(dir[0], dir[2]) || 1;
    const hit = world.raycast(eye, [dir[0] / len, 0, dir[2] / len], len);
    const penalty = hit ? 30 : 0;
    if (d + penalty < bd) { bd = d + penalty; best = k; }
  }
  return best;
}

function approachAngle(cur, target, maxStep) {
  const d = S.wrapAngle(target - cur);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

class BotBrain {
  constructor(room, player) {
    this.room = room;
    this.p = player;
    this.seq = 0;
    this.shotSeq = 0;
    this.path = [];
    this.goal = null;
    this.target = null;
    this.reactAt = 0;
    this.aimErr = [0, 0];
    this.burst = 0;
    this.burstPauseUntil = 0;
    this.strafeDir = 1;
    this.strafeUntil = 0;
    this.stuckCheckAt = 0;
    this.stuckPos = [0, 0];
    this.unstickUntil = 0;
    this.unstickDir = 1;
    this.lookAround = 0;
    this.skill = 0.55 + Math.random() * 0.35;
    this.lastThreat = null;
    this.lastThreatTime = 0;
    this.bought = false;
  }

  onSpawn() {
    this.path = [];
    this.goal = null;
    this.goalKey = null;
    this.target = null;
    this.defendSite = null;
    this.stuckCount = 0;
  }

  onRoundStart() {
    this.onSpawn();
    this.bought = false;
    this.buyAt = this.room.now() + 1500 + Math.random() * 3000;
  }

  onDamaged(attacker) {
    this.lastThreat = attacker.id;
    this.lastThreatTime = this.room.now();
  }

  buy() {
    const p = this.p, room = this.room;
    this.bought = true;
    const rifle = p.team === 'T' ? 'krait' : 'sentinel';
    const has1 = p.weapons[1];
    if (!has1) {
      if (p.money >= WEAPONS[rifle].price + 650) room.onBuy(p, rifle);
      else if (p.money >= 4750 + 1000 && Math.random() < 0.15) room.onBuy(p, 'longshot');
      else if (p.money >= WEAPONS.viper.price + 650 && room.round !== 1) room.onBuy(p, 'viper');
    }
    if (p.armor < 100 || !p.helmet) {
      if (p.money >= 1000) room.onBuy(p, 'helmet');
      else if (p.money >= 650 && p.armor < 100) room.onBuy(p, 'kevlar');
    }
    if (p.team === 'CT' && !p.kit && p.money >= 400 && Math.random() < 0.6) room.onBuy(p, 'defuse');
    if (!p.weapons[1] && p.money >= 700 && room.round > 1 && Math.random() < 0.5) room.onBuy(p, 'hc50');
    // equip best
    if (p.weapons[1]) room.switchSlot(p, 1);
    else room.switchSlot(p, 2);
  }

  eye(q) { return [q.x, q.y + S.eyeHeight(q), q.z]; }

  canSee(from, q) {
    const pts = [[q.x, q.y + S.playerHeight(q) - 0.2, q.z], [q.x, q.y + S.playerHeight(q) * 0.6, q.z]];
    for (const t of pts) {
      const d = [t[0] - from[0], t[1] - from[1], t[2] - from[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len > 60) return false;
      const dir = [d[0] / len, d[1] / len, d[2] / len];
      if (!this.room.world.raycast(from, dir, len)) return { point: t, dist: len };
    }
    return false;
  }

  findTarget(now) {
    const p = this.p;
    const eye = this.eye(p);
    const fwd = S.anglesToDir(p.yaw, 0);
    let best = null;
    for (const q of this.room.players.values()) {
      if (!q.alive || q.team === p.team || (q.team !== 'T' && q.team !== 'CT')) continue;
      const dx = q.x - p.x, dz = q.z - p.z;
      const hd = Math.hypot(dx, dz) || 1;
      const facing = (fwd[0] * dx + fwd[2] * dz) / hd;
      const threatened = this.lastThreat === q.id && now - this.lastThreatTime < 2500;
      if (facing < -0.2 && !threatened && !(this.target && this.target.id === q.id)) continue;
      const vis = this.canSee(eye, q);
      if (!vis) continue;
      if (!best || vis.dist < best.dist) best = { q, dist: vis.dist, point: vis.point };
    }
    return best;
  }

  think(now) {
    const p = this.p, room = this.room;
    if (!p.alive) return;
    let mx = 0, mz = 0, b = 0;
    let yaw = p.yaw, pitch = p.pitch;
    const dt = 1 / CONFIG.TICK_RATE;

    if (room.phase === 'freeze' || room.phase === 'warmup' || room.phase === 'live') {
      if (!this.bought && now >= (this.buyAt || 0) && room.canBuy(p)) this.buy();
    }
    if (room.phase === 'freeze' || room.phase === 'gameover') {
      this.emitInputs(0, 0, yaw, pitch, 0);
      return;
    }

    // ammo management
    const ws = p.weapons[p.slot];
    if (ws) {
      const w = WEAPONS[ws.id];
      if (!w.melee && ws.ammo === 0) {
        if (ws.reserve > 0) room.onReload(p);
        else if (p.slot === 1 && p.weapons[2]) room.switchSlot(p, 2);
        else room.switchSlot(p, 3);
      }
    }

    const seen = this.findTarget(now);
    if (seen) {
      const q = seen.q;
      if (!this.target || this.target.id !== q.id) {
        this.target = q;
        this.reactAt = now + (420 - this.skill * 220) + Math.random() * 180;
        const err = (1.2 - this.skill) * 0.22;
        this.aimErr = [(Math.random() - 0.5) * err, (Math.random() - 0.5) * err * 0.6];
        this.aimHead = Math.random() < this.skill * 0.3;
      }
      const eye = this.eye(p);
      const tp = this.aimHead ? [q.x, q.y + S.playerHeight(q) - 0.2, q.z] : [q.x, q.y + S.playerHeight(q) * 0.62, q.z];
      const d = [tp[0] - eye[0], tp[1] - eye[1], tp[2] - eye[2]];
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      const ang = S.dirToAngles([d[0] / len, d[1] / len, d[2] / len]);
      const turn = (4.5 + this.skill * 5) * dt;
      yaw = approachAngle(p.yaw, ang.yaw + this.aimErr[0], turn);
      pitch = S.clamp(p.pitch + S.clamp(ang.pitch + this.aimErr[1] - p.pitch, -turn, turn), -1.4, 1.4);
      this.aimErr[0] *= 0.93; this.aimErr[1] *= 0.93;
      const err = Math.abs(S.wrapAngle(ang.yaw - yaw)) + Math.abs(ang.pitch - pitch);

      // movement during fight: strafe between bursts, stand still while shooting
      if (now > this.strafeUntil) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeUntil = now + 300 + Math.random() * 700; }
      const cw = p.weapons[p.slot] ? WEAPONS[p.weapons[p.slot].id] : WEAPONS.knife;
      if (cw.melee) { mz = 1; }
      const shooting = now >= this.reactAt && now >= this.burstPauseUntil && err < 0.12 + (cw.melee ? 0.5 : 0);
      if (!shooting && !cw.melee) mx = this.strafeDir;
      if (seen.dist > 25 && !cw.melee) b |= BTN.CROUCH * (this.skill > 0.7 ? 1 : 0);
      if (shooting && (!cw.melee || seen.dist < 2.2)) this.fire(now, yaw, pitch);
    } else {
      this.target = null;
      const nav = this.navigate(now);
      mx = nav.mx; mz = nav.mz; b |= nav.b;
      if (nav.yaw !== undefined) yaw = approachAngle(p.yaw, nav.yaw, 6 * dt);
      pitch = p.pitch + (0 - p.pitch) * 0.1;
      // reload when idle
      const w2 = p.weapons[p.slot];
      if (w2 && !WEAPONS[w2.id].melee && w2.ammo < WEAPONS[w2.id].mag * 0.5 && w2.reserve > 0) room.onReload(p);
    }
    this.emitInputs(mx, mz, yaw, pitch, b);
  }

  fire(now, yaw, pitch) {
    const p = this.p, room = this.room;
    const ws = p.weapons[p.slot];
    if (!ws) return;
    const w = WEAPONS[ws.id];
    const interval = 60000 / w.rpm;
    if (now - p.lastShot < interval || p.reloadEnd || now < p.drawEnd) return;
    if (!w.melee && ws.ammo <= 0) return;
    // partial recoil compensation
    const ri = S.recoilIndexAt(p.recoilIdx, now - p.lastShot, w);
    const rc = S.getRecoil(w, ri);
    const comp = 0.55 + this.skill * 0.35;
    const sYaw = yaw + rc[0] * S.DEG * comp;
    const sPitch = pitch - rc[1] * S.DEG * comp;
    room.onShoot(p, { seq: ++this.shotSeq, yaw: sYaw, pitch: sPitch, ri, t: now });
    this.burst++;
    const maxBurst = w.auto ? 3 + Math.floor(this.skill * 5) : 1;
    if (this.burst >= maxBurst) {
      this.burst = 0;
      this.burstPauseUntil = now + (w.auto ? 180 + Math.random() * 220 : 220 + Math.random() * 300);
    }
  }

  emitInputs(mx, mz, yaw, pitch, b) {
    const perTick = CONFIG.INPUT_RATE / CONFIG.TICK_RATE;
    for (let i = 0; i < perTick; i++) {
      this.room.queueBotInput(this.p, { seq: ++this.seq, mx, mz, yaw: S.wrapAngle(yaw), pitch, b });
    }
  }

  chooseGoal() {
    const room = this.room, p = this.p, bomb = room.bomb;
    if (p.team === 'T') {
      if (bomb.state === 'dropped') return { pos: [bomb.x, bomb.z], node: null };
      if (bomb.state === 'planted') return { node: bomb.site === 'A' ? 'ASITE' : 'BSITE', guard: true };
      return { node: room.botPlan.site === 'A' ? 'ASITE' : 'BSITE', plant: bomb.state === 'carried' && bomb.carrier === p.id };
    }
    if (bomb.state === 'planted') return { node: bomb.site === 'A' ? 'ASITE' : 'BSITE', defuse: true, pos: [bomb.x, bomb.z] };
    if (!this.defendSite) this.defendSite = Math.random() < 0.5 ? 'ASITE' : 'BSITE';
    return { node: this.defendSite, guard: true };
  }

  navigate(now) {
    const p = this.p, room = this.room;
    const goal = this.chooseGoal();
    const key = (goal.node || '') + (goal.pos ? goal.pos.join(',') : '') + (goal.plant ? 'P' : '') + (goal.defuse ? 'D' : '');
    if (this.goalKey !== key) {
      this.goalKey = key;
      const start = nearestNode(p.x, p.z, room.world, p.y);
      const end = goal.node || nearestNode(goal.pos[0], goal.pos[1], room.world, 1);
      this.path = start ? shortestPath(start, end) : [end];
    }

    let tx, tz;
    let b = 0;
    if (this.path.length) {
      const n = NODES[this.path[0]];
      tx = n[0]; tz = n[1];
      if (Math.hypot(tx - p.x, tz - p.z) < 0.9) { this.path.shift(); }
    } else if (goal.pos) {
      tx = goal.pos[0]; tz = goal.pos[1];
    }

    // Goal behaviours once there
    const atEnd = this.path.length === 0;
    if (atEnd && goal.plant && S.siteAt(p.x, p.z)) {
      return { mx: 0, mz: 0, b: BTN.USE };
    }
    if (atEnd && goal.defuse && goal.pos) {
      const d = Math.hypot(goal.pos[0] - p.x, goal.pos[1] - p.z);
      if (d < CONFIG.BOMB.DEFUSE_RANGE * 0.7) return { mx: 0, mz: 0, b: BTN.USE | BTN.CROUCH };
      tx = goal.pos[0]; tz = goal.pos[1];
    }
    if (tx === undefined) {
      // guard: slowly look around
      this.lookAround += 0.02;
      return { mx: 0, mz: 0, b: 0, yaw: p.yaw + Math.sin(this.lookAround) * 0.05 };
    }

    const dx = tx - p.x, dz = tz - p.z;
    const yaw = Math.atan2(-dx, -dz);
    let mx = 0, mz = 1;

    // stuck detection
    if (now > this.stuckCheckAt) {
      const moved = Math.hypot(p.x - this.stuckPos[0], p.z - this.stuckPos[1]);
      if (moved < 0.4 && Math.hypot(dx, dz) > 1) {
        this.unstickUntil = now + 600;
        this.unstickDir = Math.random() < 0.5 ? -1 : 1;
        this.stuckCount = (this.stuckCount || 0) + 1;
        if (this.stuckCount > 3) { this.goalKey = null; this.stuckCount = 0; }
      } else this.stuckCount = 0;
      this.stuckPos = [p.x, p.z];
      this.stuckCheckAt = now + 1000;
    }
    if (now < this.unstickUntil) { mx = this.unstickDir; b |= BTN.JUMP; }
    return { mx, mz, b, yaw };
  }
}

module.exports = BotBrain;
