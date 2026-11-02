'use strict';
/*
 * Automated server-side tests (no browser needed):
 *  1. Physics determinism (client prediction == server)
 *  2. Hitscan: chest / headshot / armour / wall-block / crate penetration / lag-compensation rewind
 *  3. Economy: buy rules, kill rewards, loss bonus
 *  4. Bomb: plant → defuse with kit
 *  5. Full bot-vs-bot match runs to completion with halftime
 * Run: node scripts/smoke-test.js
 */
const assert = require('assert');
const S = require('../shared/shared.js');
const Room = require('../server/Room.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
}
function fakeSocket(id) {
  const s = { id, events: [], join() {}, leave() {}, emit(ev, d) { s.events.push([ev, d]); } };
  s.volatile = { emit: s.emit };
  return s;
}
function makeRoom() {
  const io = { to: () => ({ emit() {} }) };
  const r = new Room(io, 'TEST', () => {});
  clearInterval(r.timer);
  return r;
}
function aim(from, to) {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const l = Math.hypot(...d);
  return S.dirToAngles([d[0] / l, d[1] / l, d[2] / l]);
}
function place(p, x, y, z) { p.x = x; p.y = y; p.z = z; p.vx = p.vy = p.vz = 0; p.onGround = true; p.history = []; }

console.log('BLOCK OPS smoke tests');

test('physics is deterministic between two simulations', () => {
  const w = new S.VoxelWorld(); S.generateMap(w);
  const a = { x: 32.5, y: 1, z: 5.5, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false };
  const b = Object.assign({}, a);
  const rng = S.mulberry32(7);
  for (let i = 0; i < 600; i++) {
    const inp = { mx: Math.round((rng() * 2 - 1) * 100) / 100, mz: 1, yaw: Math.PI + (rng() - 0.5), b: rng() < 0.05 ? S.BTN.JUMP : 0 };
    S.stepPlayer(a, inp, 1 / 60, w, { speedMul: 0.86 });
    S.stepPlayer(b, inp, 1 / 60, w, { speedMul: 0.86 });
  }
  assert.strictEqual(a.x, b.x); assert.strictEqual(a.z, b.z); assert.strictEqual(a.y, b.y);
});

test('player cannot walk through walls', () => {
  const w = new S.VoxelWorld(); S.generateMap(w);
  const s = { x: 13.5, y: 1, z: 20.5, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false };
  for (let i = 0; i < 300; i++) S.stepPlayer(s, { mx: 0, mz: 1, yaw: -Math.PI / 2, b: 0 }, 1 / 60, w, {}); // walk +x into B1 wall (x=15)
  assert.ok(s.x < 15 - S.CONFIG.PLAYER.RADIUS + 0.01, 'x=' + s.x);
});

function duel(weapon, victimArmor, helmet, targetPart) {
  const r = makeRoom();
  r.phase = 'live';
  const sa = fakeSocket('a'), sv = fakeSocket('v');
  const a = r.addHuman(sa, 'A'); const v = r.addHuman(sv, 'V');
  r.assignTeam(a, 'T'); r.assignTeam(v, 'CT');
  a.alive = v.alive = true; a.hp = v.hp = 100;
  place(a, 32.5, 1, 15); place(v, 32.5, 1, 25);
  v.armor = victimArmor; v.helmet = helmet;
  a.weapons[1] = { id: weapon, ammo: S.WEAPONS[weapon].mag, reserve: 90 }; a.slot = 1; a.drawEnd = 0;
  const eye = [a.x, a.y + S.CONFIG.PLAYER.EYE, a.z];
  const ty = targetPart === 'head' ? v.y + 1.7 : v.y + 1.1;
  const ang = aim(eye, [v.x, ty, v.z]);
  r.onShoot(a, { seq: 1, yaw: ang.yaw, pitch: ang.pitch, ri: 0, t: r.now() });
  return { r, a, v, sa, sv };
}

test('rifle body shot deals expected damage (no armour)', () => {
  const { v } = duel('krait', 0, false, 'chest');
  const expected = Math.round(36 * Math.pow(0.98, 10 / 10));
  assert.strictEqual(100 - v.hp, expected);
});
test('armour reduces body damage', () => {
  const { v } = duel('krait', 100, false, 'chest');
  assert.ok(100 - v.hp < 36 && 100 - v.hp >= 26, 'dmg ' + (100 - v.hp));
  assert.ok(v.armor < 100);
});
test('Krait headshot kills through helmet (one-tap)', () => {
  const { v, a } = duel('krait', 100, true, 'head');
  assert.strictEqual(v.alive, false);
  assert.strictEqual(a.kills, 1);
  assert.strictEqual(a.money, 800 + 300);
});
test('Sentinel headshot vs helmet does NOT one-tap', () => {
  const { v } = duel('sentinel', 100, true, 'head');
  assert.strictEqual(v.alive, true);
});
test('indestructible wall blocks bullets', () => {
  const r = makeRoom(); r.phase = 'live';
  const a = r.addHuman(fakeSocket('a'), 'A'), v = r.addHuman(fakeSocket('v'), 'V');
  r.assignTeam(a, 'T'); r.assignTeam(v, 'CT');
  a.alive = v.alive = true;
  place(a, 12.5, 1, 20.5); place(v, 30.5, 1, 20.5); // B1 wall between (x 15..26)
  a.weapons[1] = { id: 'longshot', ammo: 5, reserve: 30 }; a.slot = 1; a.drawEnd = 0; a.scoped = 1;
  const eye = [a.x, a.y + 1.62, a.z];
  const ang = aim(eye, [v.x, v.y + 1.1, v.z]);
  r.onShoot(a, { seq: 1, yaw: ang.yaw, pitch: ang.pitch, ri: 0, t: r.now() });
  assert.strictEqual(v.hp, 100);
});
test('bullets penetrate a crate with reduced damage and damage the crate', () => {
  const r = makeRoom(); r.phase = 'live';
  const a = r.addHuman(fakeSocket('a'), 'A'), v = r.addHuman(fakeSocket('v'), 'V');
  r.assignTeam(a, 'T'); r.assignTeam(v, 'CT');
  a.alive = v.alive = true;
  // crate at x 34..35, z 17..18, y 1..2  → shoot along z through it at x=34.5
  place(a, 34.5, 1, 13.5); place(v, 34.5, 1, 21.5);
  a.weapons[1] = { id: 'krait', ammo: 30, reserve: 90 }; a.slot = 1; a.drawEnd = 0;
  const eye = [a.x, a.y + 1.62, a.z];
  const ang = aim(eye, [v.x, v.y + 1.1, v.z]);
  r.onShoot(a, { seq: 1, yaw: ang.yaw, pitch: ang.pitch, ri: 0, t: r.now() });
  const dmg = 100 - v.hp;
  assert.ok(dmg > 0 && dmg < 30, 'wallbang dmg ' + dmg);
  assert.ok(r.blockHp.size > 0, 'crate took damage');
});
test('crate is destroyed after enough damage and broadcast', () => {
  const r = makeRoom();
  for (let i = 0; i < 10; i++) r.damageBlock(34, 1, 17, 30);
  assert.strictEqual(r.world.get(34, 1, 17), 0);
  assert.ok(r.pendingBlocks.some((b) => b[0] === 34 && b[2] === 17));
});
test('lag compensation: shot hits where victim WAS at client render time', () => {
  const r = makeRoom(); r.phase = 'live';
  const a = r.addHuman(fakeSocket('a'), 'A'), v = r.addHuman(fakeSocket('v'), 'V');
  r.assignTeam(a, 'T'); r.assignTeam(v, 'CT');
  a.alive = v.alive = true;
  place(a, 32.5, 1, 15); place(v, 32.5, 1, 25);
  const now = r.now();
  v.history = [{ t: now - 200, x: 32.5, y: 1, z: 25, crouch: false }, { t: now - 50, x: 34.5, y: 1, z: 25, crouch: false }, { t: now, x: 35.5, y: 1, z: 25, crouch: false }];
  v.x = 35.5;
  a.weapons[1] = { id: 'krait', ammo: 30, reserve: 90 }; a.slot = 1; a.drawEnd = 0;
  const eye = [a.x, a.y + 1.62, a.z];
  const ang = aim(eye, [32.5, 2.1, 25]);
  r.onShoot(a, { seq: 1, yaw: ang.yaw, pitch: ang.pitch, ri: 0, t: now - 200 });
  assert.ok(v.hp < 100, 'rewound hit registered');
});
test('fire-rate limit rejects too-fast shots', () => {
  const { r, a, v } = duel('krait', 0, false, 'chest');
  const hp = v.hp;
  const eye = [a.x, a.y + 1.62, a.z];
  const ang = aim(eye, [v.x, v.y + 1.1, v.z]);
  r.onShoot(a, { seq: 2, yaw: ang.yaw, pitch: ang.pitch, ri: 1, t: r.now() });
  assert.strictEqual(v.hp, hp);
});
test('buy: rifle restricted by team and money', () => {
  const r = makeRoom(); r.phase = 'freeze'; r.buyEnd = r.now() + 10000;
  const s = fakeSocket('a'); const a = r.addHuman(s, 'A'); r.assignTeam(a, 'CT');
  r.spawn(a, 0); a.money = 3000;
  r.onBuy(a, 'krait');
  assert.strictEqual(a.weapons[1], null);
  r.onBuy(a, 'sentinel');
  assert.strictEqual(a.weapons[1].id, 'sentinel'); assert.strictEqual(a.money, 100);
  r.onBuy(a, 'helmet');
  assert.strictEqual(a.armor, 0, 'not enough money for helmet');
});
test('bomb: plant in site then defuse with kit → CT win + money', () => {
  const r = makeRoom();
  const t = r.addHuman(fakeSocket('t'), 'T1'), c = r.addHuman(fakeSocket('c'), 'C1');
  r.assignTeam(t, 'T'); r.assignTeam(c, 'CT');
  r.startMatch();
  t.alive = c.alive = true;
  r.bomb = { state: 'carried', carrier: t.id };
  r.phase = 'live'; r.phaseEnd = r.now() + 100000;
  place(t, 11.5, 1, 46.5);
  t.useHeld = true;
  const realNow = r.now.bind(r);
  let fake = realNow();
  r.now = () => fake;
  r.updateBomb(fake);
  fake += 3300; r.updateBomb(fake);
  assert.strictEqual(r.bomb.state, 'planted');
  t.useHeld = false;
  c.kit = true; place(c, 12, 1, 46.5); c.useHeld = true;
  r.updateBomb(fake);
  fake += 5100; r.updateBomb(fake);
  assert.strictEqual(r.bomb.state, 'defused');
  assert.strictEqual(r.phase, 'post');
  assert.strictEqual(r.score.CT, 1);
  assert.ok(t.money >= 800 + 300 + 1400 + 800 - 1, 'T got plant + loss + plant bonus: ' + t.money);
});

// ----------------------------------------------------------------------------
// Full match simulation (accelerated: ticks run as fast as possible)
// ----------------------------------------------------------------------------
test('full 10-bot match completes with a winner', () => {
  Object.assign(S.CONFIG.ROUND, { WARMUP: 1, FREEZE: 1, POST: 1, GAMEOVER: 1, LIVE: 90 });
  const events = [];
  const io = { to: () => ({ emit: (ev, d) => events.push([ev, d]) }) };
  const r = new Room(io, 'SIM', () => {});
  clearInterval(r.timer);
  const watcher = r.addHuman(fakeSocket('w'), 'W'); r.assignTeam(watcher, 'SPEC');
  for (let i = 0; i < 5; i++) { r.addBot('T'); r.addBot('CT'); }
  let virtual = Date.now();
  const realDate = Date.now;
  Date.now = () => virtual;
  try {
    for (let i = 0; i < 30 * 60 * 40 && r.phase !== 'gameover'; i++) { virtual += 1000 / 30; r.tick(); }
  } finally { Date.now = realDate; }
  const over = events.find((e) => e[0] === 'over');
  assert.ok(over, 'match ended (phase ' + r.phase + ', score ' + JSON.stringify(r.score) + ')');
  const ends = events.filter((e) => e[0] === 'rend').map((e) => e[1].r);
  const half = events.some((e) => e[0] === 'half');
  console.log('     final', JSON.stringify(over[1].sc), 'rounds', ends.length, 'halftime', half, 'reasons', JSON.stringify(ends.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {})));
});

console.log(`\n${passed} test geçti${process.exitCode ? ', bazı testler BAŞARISIZ' : ''}.`);
