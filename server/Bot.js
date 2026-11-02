'use strict';
/*
 * BotBrain — server-side AI that produces the SAME input stream a human client sends
 * (identical physics, fire-rate, recoil and lag-comp rules apply).
 * - A* navigation on the map's walk grid (works on every map, re-plans when walls break)
 * - Difficulty-driven skill: reaction time, aim error, turn speed, head-shot rate,
 *   spray control, burst length, field of view, spotting distance
 * - Respects flash blindness and smoke clouds; throws HE grenades at enemies
 * - Bomb logic: carry/plant, pick up dropped bomb, retake & defuse, guard planted bomb
 * - Buy logic scaled to economy
 */
const S = require('../shared/shared.js');
const { CONFIG, WEAPONS, BTN } = S;

function approachAngle(cur, target, maxStep) {
  const d = S.wrapAngle(target - cur);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}
const rand = (a, b) => a + Math.random() * (b - a);

class BotBrain {
  constructor(room, player) {
    this.room = room;
    this.p = player;
    this.seq = 0;
    this.shotSeq = 0;
    this.path = [];
    this.goalKey = null;
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
    this.lookAround = Math.random() * 6;
    this.jitter = Math.random() * 0.2 - 0.1;   // per-bot personality
    this.lastThreat = null;
    this.lastThreatTime = 0;
    this.lastSeenPos = null;
    this.lastSeenTime = 0;
    this.bought = false;
    this.nadeCooldown = 0;
  }

  get skill() { return this.room.diff.bot; }

  onSpawn() {
    this.path = [];
    this.goalKey = null;
    this.target = null;
    this.defendSpot = null;
    this.stuckCount = 0;
    this.lastSeenPos = null;
  }

  onRoundStart() {
    this.onSpawn();
    this.bought = false;
    this.buyAt = this.room.now() + 800 + Math.random() * 3000;
  }

  onDamaged(attacker) {
    this.lastThreat = attacker.id;
    this.lastThreatTime = this.room.now();
    this.lastSeenPos = [attacker.x, attacker.z];
    this.lastSeenTime = this.room.now();
  }

  buy() {
    const p = this.p, room = this.room;
    this.bought = true;
    const m = () => p.money;
    const rifle = p.team === 'T' ? (Math.random() < 0.75 ? 'krait' : 'falcon') : (Math.random() < 0.75 ? 'sentinel' : 'lynx');
    if (!p.weapons[1]) {
      if (m() >= 4750 + 1000 && Math.random() < 0.15) room.onBuy(p, 'longshot');
      else if (m() >= WEAPONS[rifle].price + 650) room.onBuy(p, rifle);
      else if (m() >= 2350 + 650 && Math.random() < 0.3) room.onBuy(p, 'hornet');
      else if (m() >= 1250 + 650 && room.round !== 1) room.onBuy(p, ['viper', 'wasp', 'breacher'][Math.floor(Math.random() * 3)]);
      else if (m() >= 1700 && Math.random() < 0.15) room.onBuy(p, 'ranger');
    }
    if (p.armor < 100 || !p.helmet) {
      if (m() >= 1000) room.onBuy(p, 'helmet');
      else if (m() >= 650 && p.armor < 100) room.onBuy(p, 'kevlar');
    }
    if (p.team === 'CT' && !p.kit && m() >= 400 && Math.random() < 0.6) room.onBuy(p, 'defuse');
    if (m() >= 300 && Math.random() < 0.6) room.onBuy(p, 'he');
    if (m() >= 200 && Math.random() < 0.4) room.onBuy(p, 'flash');
    if (!p.weapons[1] && m() >= 700 && room.round > 1 && Math.random() < 0.5) room.onBuy(p, Math.random() < 0.5 ? 'hc50' : 'vex');
    room.switchSlot(p, p.weapons[1] ? 1 : 2, true);
  }

  eye(q) { return [q.x, q.y + S.eyeHeight(q), q.z]; }

  canSee(from, q, now) {
    const pts = [[q.x, q.y + S.playerHeight(q) - 0.2, q.z], [q.x, q.y + S.playerHeight(q) * 0.6, q.z]];
    for (const t of pts) {
      const d = [t[0] - from[0], t[1] - from[1], t[2] - from[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len > this.skill.spot) return false;
      if (S.lineClear(this.room.world, from, t) && !S.smokeBlocks(this.room.smokes, from, t, now)) return { point: t, dist: len };
    }
    return false;
  }

  findTarget(now) {
    const p = this.p;
    if (now < p.blindUntil) return null;
    const eye = this.eye(p);
    const fwd = S.anglesToDir(p.yaw, 0);
    let best = null;
    for (const q of this.room.players.values()) {
      if (!q.alive || q.team === p.team || (q.team !== 'T' && q.team !== 'CT')) continue;
      const dx = q.x - p.x, dz = q.z - p.z;
      const hd = Math.hypot(dx, dz) || 1;
      const facing = (fwd[0] * dx + fwd[2] * dz) / hd;
      const threatened = this.lastThreat === q.id && now - this.lastThreatTime < 2500;
      if (facing < this.skill.fovDot && !threatened && !(this.target && this.target.id === q.id)) continue;
      const vis = this.canSee(eye, q, now);
      if (!vis) continue;
      if (!best || vis.dist < best.dist) best = { q, dist: vis.dist, point: vis.point };
    }
    return best;
  }

  /** ticks = how many server ticks until next think (inputs are emitted to cover them) */
  think(now, ticks) {
    const p = this.p, room = this.room;
    if (!p.alive) return;
    const sk = this.skill;
    const dt = ticks / CONFIG.TICK_RATE;
    let mx = 0, mz = 0, b = 0;
    let yaw = p.yaw, pitch = p.pitch;

    if (room.phase === 'freeze' || room.phase === 'warmup' || room.phase === 'live') {
      if (!this.bought && now >= (this.buyAt || 0) && room.canBuy(p)) this.buy();
    }
    if (room.phase === 'freeze' || room.phase === 'gameover') {
      this.emitInputs(0, 0, yaw, pitch, 0, ticks);
      return;
    }
    const blind = now < p.blindUntil;

    // ammo management
    if (p.slot !== 4) {
      const ws = p.weapons[p.slot];
      if (ws) {
        const w = WEAPONS[ws.id];
        if (!w.melee && ws.ammo === 0) {
          if (ws.reserve > 0) room.onReload(p);
          else if (p.slot === 1 && p.weapons[2]) room.switchSlot(p, 2);
          else room.switchSlot(p, 3);
        }
      }
    } else if (!room.nadeCount(p)) room.switchSlot(p, p.weapons[1] ? 1 : 2, true);

    const seen = blind ? null : this.findTarget(now);
    if (seen) {
      const q = seen.q;
      this.lastSeenPos = [q.x, q.z];
      this.lastSeenTime = now;
      if (!this.target || this.target.id !== q.id) {
        this.target = q;
        this.reactAt = now + rand(sk.react[0], sk.react[1]);
        this.aimErr = [(Math.random() - 0.5) * sk.aimErr * 2, (Math.random() - 0.5) * sk.aimErr];
        this.aimHead = Math.random() < sk.head;
      }
      // HE grenade at medium range
      if (room.nadeCount(p) && p.nades.he > 0 && seen.dist > 9 && seen.dist < 24 && now > this.nadeCooldown && Math.random() < 0.04 * sk.smart) {
        this.nadeCooldown = now + 8000;
        if (p.slot !== 4) { p.nadeSel = 'he'; room.switchSlot(p, 4, true); }
      }
      const eye = this.eye(p);
      const tp = this.aimHead ? [q.x, q.y + S.playerHeight(q) - 0.2, q.z] : [q.x, q.y + S.playerHeight(q) * (0.46 + Math.random() * 0.08), q.z];
      const d = [tp[0] - eye[0], tp[1] - eye[1], tp[2] - eye[2]];
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      const ang = S.dirToAngles([d[0] / len, d[1] / len, d[2] / len]);
      if (p.slot === 4) ang.pitch += 0.12 + seen.dist * 0.006; // lob arc
      const turn = (sk.turn + this.jitter * 2) * dt;
      yaw = approachAngle(p.yaw, ang.yaw + this.aimErr[0], turn);
      pitch = S.clamp(p.pitch + S.clamp(ang.pitch + this.aimErr[1] - p.pitch, -turn, turn), -1.4, 1.4);
      const decay = Math.pow(0.9, ticks);
      this.aimErr[0] *= decay; this.aimErr[1] *= decay;
      const err = Math.abs(S.wrapAngle(ang.yaw - yaw)) + Math.abs(ang.pitch - pitch);

      if (now > this.strafeUntil) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeUntil = now + rand(300, 900); }
      const cw = WEAPONS[room.currentWeaponId(p)];
      if (cw.melee) mz = 1;
      const shooting = now >= this.reactAt && now >= this.burstPauseUntil && err < 0.12 + (cw.melee ? 0.5 : 0);
      if (!shooting && !cw.melee && Math.random() < sk.strafe) mx = this.strafeDir;
      if (cw.pellets > 1 && seen.dist > 8) mz = 1;                 // shotguns close the gap
      if (seen.dist > 25 && !cw.melee && sk.smart > 0.7) b |= BTN.CROUCH;
      if (shooting && (!cw.melee || seen.dist < 2.2)) this.fire(now, yaw, pitch);
    } else {
      this.target = null;
      const nav = this.navigate(now, blind);
      mx = nav.mx; mz = nav.mz; b |= nav.b;
      if (nav.yaw !== undefined) yaw = approachAngle(p.yaw, nav.yaw, 6 * dt);
      pitch = p.pitch + (0 - p.pitch) * 0.2;
      if (p.slot === 4 && room.nadeCount(p)) room.switchSlot(p, p.weapons[1] ? 1 : 2, true);
      const w2 = p.weapons[p.slot];
      if (p.slot !== 4 && w2 && !WEAPONS[w2.id].melee && w2.ammo < WEAPONS[w2.id].mag * 0.5 && w2.reserve > 0) room.onReload(p);
    }
    this.emitInputs(mx, mz, yaw, pitch, b, ticks);
  }

  fire(now, yaw, pitch) {
    const p = this.p, room = this.room, sk = this.skill;
    if (p.slot === 4) {
      room.onShoot(p, { seq: ++this.shotSeq, yaw, pitch, t: now });
      return;
    }
    const ws = p.weapons[p.slot];
    if (!ws) return;
    const w = WEAPONS[ws.id];
    if (now - p.lastShot < 60000 / w.rpm || p.reloadEnd || now < p.drawEnd) return;
    if (!w.melee && ws.ammo <= 0) return;
    const ri = S.recoilIndexAt(p.recoilIdx, now - p.lastShot, w);
    const rc = S.getRecoil(w, ri);
    const comp = sk.comp;
    room.onShoot(p, { seq: ++this.shotSeq, yaw: yaw + rc[0] * S.DEG * comp, pitch: pitch - rc[1] * S.DEG * comp, ri, t: now });
    this.burst++;
    const maxBurst = w.auto ? Math.round(rand(sk.burst[0], sk.burst[1])) : 1;
    if (this.burst >= maxBurst) {
      this.burst = 0;
      this.burstPauseUntil = now + rand(sk.pause[0], sk.pause[1]) * (w.auto ? 1 : 1.3);
    }
  }

  emitInputs(mx, mz, yaw, pitch, b, ticks) {
    const n = (CONFIG.INPUT_RATE / CONFIG.TICK_RATE) * ticks;
    for (let i = 0; i < n; i++) this.room.queueBotInput(this.p, { seq: ++this.seq, mx, mz, yaw: S.wrapAngle(yaw), pitch, b });
  }

  // ---------------------------------------------------------------- goals
  siteSpot(site) {
    const room = this.room;
    const c = S.siteCenter(room.map, site);
    const n = S.nearestWalkable(room.nav, c[0], c[1]);
    return n ? [n[0] + 0.5, n[1] + 0.5] : c;
  }
  randomSpotIn(zone) {
    const nav = this.room.nav;
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(rand(zone.x0, zone.x1 + 1)), z = Math.floor(rand(zone.z0, zone.z1 + 1));
      if (nav.walk[z * nav.sx + x]) return [x + 0.5, z + 0.5];
    }
    return S.siteCenter(this.room.map, 'A');
  }
  chooseGoal() {
    const room = this.room, p = this.p, bomb = room.bomb, now = room.now();
    if (p.team === 'T') {
      if (bomb.state === 'dropped') return { pos: [bomb.x, bomb.z], key: 'drop' };
      if (bomb.state === 'planted') {
        if (!this.defendSpot) this.defendSpot = this.randomSpotIn(room.map.sites[bomb.site]);
        return { pos: this.defendSpot, key: 'guard' + bomb.site, guard: true };
      }
      const carrier = bomb.state === 'carried' && bomb.carrier === p.id;
      // after a while, hunt the last known enemy position (prevents stalemates)
      if (!carrier && this.lastSeenPos && now - this.lastSeenTime < 6000 && this.skill.smart > 0.4) return { pos: this.lastSeenPos, key: 'hunt' + Math.round(this.lastSeenPos[0]) + ',' + Math.round(this.lastSeenPos[1]) };
      return { pos: this.siteSpot(room.botPlan.site), key: 'site' + room.botPlan.site + (carrier ? 'P' : ''), plant: carrier };
    }
    if (bomb.state === 'planted') return { pos: [bomb.x, bomb.z], key: 'defuse', defuse: true };
    if (this.lastSeenPos && now - this.lastSeenTime < 5000 && this.skill.smart > 0.5) return { pos: this.lastSeenPos, key: 'hunt' + Math.round(this.lastSeenPos[0]) + ',' + Math.round(this.lastSeenPos[1]) };
    if (!this.defendSpot) {
      const site = Math.random() < 0.5 ? 'A' : 'B';
      this.defendSpot = this.randomSpotIn(room.map.sites[site]);
    }
    return { pos: this.defendSpot, key: 'defend', guard: true };
  }

  navigate(now, blind) {
    const p = this.p, room = this.room;
    const goal = this.chooseGoal();
    if (this.goalKey !== goal.key || this.navVersion !== room.navVersion || (now > (this.repathAt || 0) && !this.path.length && !goal.guard)) {
      this.goalKey = goal.key;
      this.navVersion = room.navVersion;
      this.repathAt = now + 2500;
      this.path = S.navPath(room.nav, room.world, p.x, p.z, goal.pos[0], goal.pos[1]) || [];
    }
    if (blind) return { mx: (Math.random() - 0.5) * 2, mz: -0.5, b: 0 };

    let tx, tz;
    while (this.path.length && Math.hypot(this.path[0][0] - p.x, this.path[0][1] - p.z) < 0.7) this.path.shift();
    if (this.path.length) { tx = this.path[0][0]; tz = this.path[0][1]; }

    const distGoal = Math.hypot(goal.pos[0] - p.x, goal.pos[1] - p.z);
    if (goal.plant && S.siteAt(room.map, p.x, p.z) && (distGoal < 2.5 || !this.path.length)) return { mx: 0, mz: 0, b: BTN.USE };
    if (goal.defuse && distGoal < CONFIG.BOMB.DEFUSE_RANGE * 0.7) return { mx: 0, mz: 0, b: BTN.USE | BTN.CROUCH };
    if (tx === undefined) {
      if (distGoal > 0.6 && !goal.guard) { tx = goal.pos[0]; tz = goal.pos[1]; }
      else {
        // hold an angle: look around towards the enemy side of the map
        this.lookAround += 0.03;
        const base = p.team === 'CT' ? Math.PI : 0;
        return { mx: 0, mz: 0, b: 0, yaw: base + Math.sin(this.lookAround) * 1.1 };
      }
    }
    const dx = tx - p.x, dz = tz - p.z;
    const yaw = Math.atan2(-dx, -dz);
    let mx = 0, mz = 1, b = 0;
    if (now > this.stuckCheckAt) {
      const moved = Math.hypot(p.x - this.stuckPos[0], p.z - this.stuckPos[1]);
      if (moved < 0.4) {
        this.unstickUntil = now + 600;
        this.unstickDir = Math.random() < 0.5 ? -1 : 1;
        this.stuckCount = (this.stuckCount || 0) + 1;
        if (this.stuckCount > 2) { this.goalKey = null; this.stuckCount = 0; }
      } else this.stuckCount = 0;
      this.stuckPos = [p.x, p.z];
      this.stuckCheckAt = now + 1000;
    }
    if (now < this.unstickUntil) { mx = this.unstickDir; b |= BTN.JUMP; }
    return { mx, mz, b, yaw };
  }
}

module.exports = BotBrain;
