'use strict';
/*
 * Automated server-side tests (no browser needed):
 *  1. Physics determinism (client prediction == server)
 *  2. Hitscan: chest / headshot / armour / wall-block / crate penetration / lag-compensation rewind
 *  3. Economy: buy rules, kill rewards, loss bonus
 *  4. Bomb: plant → defuse with kit
 *  5. Maps: every map valid (spawns free, both sites reachable by A* from both spawns)
 *  6. Grenades (HE damage + voxel destruction, flash blinding, smoke blocks bot vision), shotgun pellets
 *  7. Difficulty presets change bot damage
 *  8. Full bot-vs-bot match on EVERY map completes with halftime
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
function makeRoom(opts) {
  const io = { to: () => ({ emit() {} }) };
  const r = new Room(io, 'TEST', () => {}, Object.assign({ map: 'dustgrid', difficulty: 'medium' }, opts || {}));
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
  const w = new S.VoxelWorld(); S.generateMap(w, 'dustgrid');
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
  const w = new S.VoxelWorld(); S.generateMap(w, 'dustgrid');
  const s = { x: 13.5, y: 1, z: 20.5, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false };
  for (let i = 0; i < 300; i++) S.stepPlayer(s, { mx: 0, mz: 1, yaw: -Math.PI / 2, b: 0 }, 1 / 60, w, {}); // walk +x into B1 wall (x=15)
  assert.ok(s.x < 15 - S.CONFIG.PLAYER.RADIUS + 0.01, 'x=' + s.x);
});

function duel(weapon, victimArmor, helmet, targetPart, dist) {
  const r = makeRoom();
  r.phase = 'live';
  const sa = fakeSocket('a'), sv = fakeSocket('v');
  const a = r.addHuman(sa, 'A'); const v = r.addHuman(sv, 'V');
  r.assignTeam(a, 'T'); r.assignTeam(v, 'CT');
  a.alive = v.alive = true; a.hp = v.hp = 100;
  place(a, 32.5, 1, 15); place(v, 32.5, 1, 15 + (dist || 10));
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
  assert.strictEqual(a.money, S.DIFFICULTY.medium.startMoney + 300);
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
  assert.ok(t.money >= S.DIFFICULTY.medium.startMoney + 300 + 1400 + 800 - 1, 'T got plant + loss + plant bonus: ' + t.money);
});

for (const id of S.MAP_ORDER) {
  test(`map "${id}": spawns free, both sites reachable from both spawns`, () => {
    const m = S.getMap(id);
    const w = new S.VoxelWorld(); S.generateMap(w, id);
    const nav = S.buildNav(w);
    for (const t of ['T', 'CT']) for (const sp of m.spawns[t]) assert.ok(!S.boxCollides(w, sp[0], sp[1], sp[2], 1.8), `spawn ${t} ${sp}`);
    for (const site of ['A', 'B']) {
      const c = S.siteCenter(m, site);
      for (const t of ['T', 'CT']) assert.ok(S.navPath(nav, w, m.spawns[t][0][0], m.spawns[t][0][2], c[0], c[1]), `${t} → ${site}`);
    }
  });
}

test('HE grenade damages players behind it and destroys crates; walls block it', () => {
  const r = makeRoom(); r.phase = 'live';
  const a = r.addHuman(fakeSocket('a'), 'A'), v = r.addHuman(fakeSocket('v'), 'V'), hidden = r.addHuman(fakeSocket('h'), 'H');
  r.assignTeam(a, 'T'); r.assignTeam(v, 'CT'); r.assignTeam(hidden, 'CT');
  a.alive = v.alive = hidden.alive = true;
  place(a, 32.5, 1, 10); place(v, 34.5, 1, 15.5); place(hidden, 12.5, 1, 20.5);   // hidden is behind the B1 wall
  r.detonate({ id: 1, type: 'he', owner: a.id, x: 34.5, y: 1.2, z: 17.5, t0: 0 }, r.now());   // next to crate (34..35,17..18)
  assert.ok(v.hp < 100 && v.hp > 0, 'victim hurt: ' + v.hp);
  assert.strictEqual(hidden.hp, 100);
  assert.ok(r.pendingBlocks.length > 0, 'crate destroyed');
});
test('flashbang blinds a player looking at it, not one looking away', () => {
  const r = makeRoom(); r.phase = 'live';
  const a = r.addHuman(fakeSocket('a'), 'A'), b = r.addHuman(fakeSocket('b'), 'B');
  r.assignTeam(a, 'T'); r.assignTeam(b, 'CT');
  a.alive = b.alive = true;
  place(a, 32.5, 1, 10); place(b, 32.5, 1, 20);
  a.yaw = Math.PI;  // a looks +z (towards the flash)
  b.yaw = Math.PI;  // b looks +z (away from the flash behind him)
  r.detonate({ id: 2, type: 'flash', owner: a.id, x: 32.5, y: 2, z: 14, t0: 0 }, r.now());
  const now = r.now();
  assert.ok(a.blindUntil - now > 2500, 'facing player fully blind');
  assert.ok(b.blindUntil - now < 1200, 'player looking away barely blind');
});
test('smoke cloud blocks line of sight', () => {
  const now = 10000;
  const smokes = [{ x: 32.5, y: 2, z: 20, t0: now - 3000 }];
  assert.strictEqual(S.smokeBlocks(smokes, [32.5, 2.6, 10], [32.5, 2.6, 30], now), true);
  assert.strictEqual(S.smokeBlocks(smokes, [20, 2.6, 10], [20, 2.6, 30], now), false);
});
test('shotgun fires 9 pellets and is deadly up close', () => {
  const { v } = duel('breacher', 0, false, 'chest', 4);
  assert.strictEqual(S.shotDirections(S.WEAPONS.breacher, 0, 0, [0, 0], 4, 1, 1).length, 9);
  assert.ok(100 - v.hp > 60 || !v.alive, 'close-range pump damage ' + (100 - v.hp));
});
test('difficulty: easy bots deal much less damage to humans than hard bots', () => {
  const dmgFor = (diff) => {
    const r = makeRoom({ difficulty: diff }); r.phase = 'live';
    const bot = r.addBot('T'), h = r.addHuman(fakeSocket('h'), 'H');
    r.assignTeam(h, 'CT'); bot.alive = h.alive = true;
    r.dealDamage(h, bot, 40, 'chest', 'krait');
    return 100 - h.hp;
  };
  assert.ok(dmgFor('easy') < dmgFor('hard') * 0.7, `easy ${dmgFor('easy')} vs hard ${dmgFor('hard')}`);
});

test('dropped weapons: death drops rifle, walking over picks it into an empty slot, E swaps', () => {
  const r = makeRoom(); r.phase = 'live';
  const a = r.addHuman(fakeSocket('a'), 'A'), v = r.addHuman(fakeSocket('v'), 'V'), c = r.addHuman(fakeSocket('c'), 'C');
  r.assignTeam(a, 'T'); r.assignTeam(v, 'CT'); r.assignTeam(c, 'T');
  a.alive = v.alive = c.alive = true;
  place(v, 32.5, 1, 20); place(a, 32.5, 1, 10); place(c, 40.5, 1, 8);
  v.weapons[1] = { id: 'sentinel', ammo: 17, reserve: 60 };
  r.killPlayer(v, a, 'krait', false);
  assert.strictEqual(r.drops.length, 1, 'rifle dropped');
  assert.strictEqual(r.drops[0].wid, 'sentinel');
  // let it fall, then walk A (empty slot 1) onto it
  for (let i = 0; i < 40; i++) r.updateDrops(r.now() + 2000, 1 / 30);
  place(a, r.drops[0].x, 1, r.drops[0].z);
  r.updateDrops(r.now() + 2000, 1 / 30);
  assert.ok(a.weapons[1] && a.weapons[1].id === 'sentinel' && a.weapons[1].ammo === 17, 'picked up with its ammo');
  assert.strictEqual(r.drops.length, 0);
  // A throws it (G), C has a krait and swaps with E
  r.onDropWeapon(a);
  assert.strictEqual(a.weapons[1], null);
  for (let i = 0; i < 40; i++) r.updateDrops(r.now() - 5000, 1 / 30);
  c.weapons[1] = { id: 'krait', ammo: 30, reserve: 90 };
  place(c, r.drops[0].x, 1, r.drops[0].z);
  r.onPickup(c, r.drops[0].id);
  assert.strictEqual(c.weapons[1].id, 'sentinel');
  assert.ok(r.drops.some((d) => d.wid === 'krait'), 'old weapon dropped on swap');
});
test('buying a weapon into an occupied slot drops the old one', () => {
  const r = makeRoom(); r.phase = 'freeze'; r.buyEnd = r.now() + 10000;
  const a = r.addHuman(fakeSocket('a'), 'A'); r.assignTeam(a, 'T'); r.spawn(a, 0); a.money = 9000;
  r.onBuy(a, 'viper'); r.onBuy(a, 'krait');
  assert.strictEqual(a.weapons[1].id, 'krait');
  assert.ok(r.drops.some((d) => d.wid === 'viper'));
});

for (const mapId of S.MAP_ORDER) {
  test(`full 10-bot match on ${mapId} completes with a winner`, () => {
    Object.assign(S.CONFIG.ROUND, { WARMUP: 1, FREEZE: 1, POST: 1, GAMEOVER: 1, LIVE: 90 });
    const events = [];
    const io = { to: () => ({ emit: (ev, d) => events.push([ev, d]) }) };
    const r = new Room(io, 'SIM', () => {}, { map: mapId, difficulty: 'medium' });
    clearInterval(r.timer);
    const watcher = r.addHuman(fakeSocket('w'), 'W'); r.assignTeam(watcher, 'SPEC');
    for (let i = 0; i < 5; i++) { r.addBot('T'); r.addBot('CT'); }
    let virtual = Date.now();
    const realDate = Date.now;
    Date.now = () => virtual;
    try {
      for (let i = 0; i < 30 * 60 * 75 && !events.some((e) => e[0] === 'over'); i++) { virtual += 1000 / 30; r.tick(); }
    } finally { Date.now = realDate; }
    const over = events.find((e) => e[0] === 'over');
    assert.ok(over, 'match ended (phase ' + r.phase + ', score ' + JSON.stringify(r.score) + ')');
    const ends = events.filter((e) => e[0] === 'rend').map((e) => e[1].r);
    console.log('     final', JSON.stringify(over[1].sc), 'rounds', ends.length, 'halftime', events.some((e) => e[0] === 'half'),
      JSON.stringify(ends.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {})), 'grenades', events.filter((e) => e[0] === 'nade').length);
  });
}

console.log(`\n${passed} test geçti${process.exitCode ? ', bazı testler BAŞARISIZ' : ''}.`);
