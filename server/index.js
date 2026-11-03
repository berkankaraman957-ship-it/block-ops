'use strict';
/*
 * BLOCK OPS: TACTICAL DRIFT — game server entry
 * HTTP static hosting (no framework needed) + Socket.io realtime layer + room/lobby management.
 *
 *   PORT=3000 node server/index.js
 *   CORS_ORIGIN="capacitor://localhost,http://localhost,https://yourdomain.com"
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Room = require('./Room');
const S = require('../shared/shared.js');
const { Store } = require('./store');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS || '200', 10);
if (process.env.BLOCKOPS_FAST === '1') {
  // Test mode: shorter phases so automated tests can run whole matches quickly.
  Object.assign(S.CONFIG.ROUND, { WARMUP: 2, FREEZE: 1, POST: 1, GAMEOVER: 2, LIVE: 60 });
}
const store = new Store();
const CORS = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : '*';

// ---------------------------------------------------------------------------
// Socket.io (production) — falls back to a tiny ws-based shim ONLY when
// BLOCKOPS_DEV_SHIM=1 is set (offline CI / sandbox testing).
// ---------------------------------------------------------------------------
let createIO, clientBundlePath;
// socket.io's package "exports" map blocks deep require() paths, so locate client-dist
// relative to the package's main entry (…/socket.io/dist/index.js → …/socket.io/client-dist).
function socketIoClientBundle() {
  const main = require.resolve('socket.io');
  let dir = path.dirname(main);
  for (let i = 0; i < 4; i++) {
    const f = path.join(dir, 'client-dist', 'socket.io.min.js');
    if (fs.existsSync(f)) return f;
    dir = path.dirname(dir);
  }
  throw new Error('socket.io client bundle not found');
}
try {
  const { Server } = require('socket.io');
  createIO = (server) => new Server(server, {
    cors: { origin: CORS, methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
    pingInterval: 5000,
    pingTimeout: 10000,
    perMessageDeflate: false,
    maxHttpBufferSize: 64 * 1024
  });
  clientBundlePath = socketIoClientBundle();
} catch (e) {
  if (process.env.BLOCKOPS_DEV_SHIM !== '1') {
    console.error('socket.io yüklenemedi. Önce "npm install" çalıştırın.', e.message);
    process.exit(1);
  }
  const shim = require('../scripts/devshim/shim-server.js');
  createIO = (server) => shim.createServer(server);
  clientBundlePath = path.join(ROOT, 'scripts', 'devshim', 'shim-client.js');
  console.warn('[dev] Socket.io DEV SHIM kullanılıyor (sadece test amaçlı).');
}

// ---------------------------------------------------------------------------
// Build id: hash of every client file. Clients poll /version and show an
// "update available" button as soon as a new deploy is live.
// ---------------------------------------------------------------------------
function hashDir(dir, h) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) hashDir(f, h);
    else { h.update(e.name); h.update(fs.readFileSync(f)); }
  }
  return h;
}
const BUILD_ID = hashDir(SHARED_DIR, hashDir(PUBLIC_DIR, crypto.createHash('sha1'))).digest('hex').slice(0, 12);
const BUILD_TIME = new Date().toISOString();

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};

function sendFile(res, file, cache, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
    // Always revalidate (ETag): updates reach players immediately, unchanged files cost a tiny 304.
    const etag = '"' + BUILD_ID + '-' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
    if (req && req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(base, reqPath) {
  const p = path.normalize(path.join(base, reqPath));
  return p.startsWith(base) ? p : null;
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); res.end(); return; }
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: S.CONFIG.VERSION, db: store.backend.name, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.humanCount(), 0) }));
    return;
  }
  if (url === '/version') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ build: BUILD_ID, version: S.CONFIG.VERSION, time: BUILD_TIME }));
    return;
  }
  if (url === '/vendor/socket.io.min.js') return sendFile(res, clientBundlePath, true, req);
  if (url.startsWith('/shared/')) {
    const f = safeJoin(SHARED_DIR, url.slice('/shared/'.length));
    return f ? sendFile(res, f, false, req) : (res.writeHead(403), res.end());
  }
  if (url === '/' || url === '') url = '/index.html';
  const f = safeJoin(PUBLIC_DIR, url);
  if (!f) { res.writeHead(403); res.end(); return; }
  sendFile(res, f, !url.endsWith('.html'), req);
});

// ---------------------------------------------------------------------------
// Lobby / rooms
// ---------------------------------------------------------------------------
const io = createIO(server);
const rooms = new Map();

function cleanRoomCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
function cleanName(name) {
  const n = String(name || '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return n || 'Oyuncu' + Math.floor(Math.random() * 900 + 100);
}
function newRoomCode() {
  let c;
  do { c = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (rooms.has(c));
  return c;
}
function roomOpts(data) {
  const mode = S.MODES[data.mode] ? data.mode : 'comp';
  return {
    map: S.MAPS[data.map] ? data.map : S.MAP_ORDER[Math.floor(Math.random() * S.MAP_ORDER.length)],
    // ranked always uses the hardest bots
    difficulty: mode === 'ranked' ? 'hard' : (S.DIFFICULTY[data.difficulty] ? data.difficulty : 'medium'),
    mode, store
  };
}
function getRoom(code, data) {
  if (code && rooms.has(code)) return rooms.get(code);
  if (rooms.size >= MAX_ROOMS) return null;
  const id = code || newRoomCode();
  const room = new Room(io, id, (r) => {
    // destroy shortly after last human leaves (allows quick reconnects)
    setTimeout(() => {
      if (r.humanCount() === 0 && rooms.get(r.id) === r) { r.destroy(); rooms.delete(r.id); console.log('[room] closed', r.id); }
    }, 15000);
  }, roomOpts(data || {}));
  rooms.set(id, room);
  console.log('[room] created', id, room.mode.id, room.mapId, room.diff.id);
  return room;
}
function quickMatchRoom(data) {
  let best = null;
  for (const r of rooms.values()) {
    const humans = r.humanCount();
    if (r.isPrivate || humans >= r.perTeam * 2 || r.phase === 'gameover') continue;
    if (r.mode.id !== (S.MODES[data.mode] ? data.mode : 'comp')) continue;
    if (r.mode.id !== 'ranked' && data.difficulty && r.diff.id !== data.difficulty) continue;
    if (!best || humans > best.humanCount()) best = r;
  }
  return best || getRoom(null, data);
}

// Simple per-socket rate limiter
function limiter(max, perMs) {
  let count = 0, start = Date.now();
  return () => {
    const now = Date.now();
    if (now - start > perMs) { start = now; count = 0; }
    return ++count <= max;
  };
}

// ---------------------------------------------------------------------------
// Friends & presence. No database needed: every device has a permanent friend code
// (generated client-side, stored in localStorage). The server only knows who is online
// right now (lobby sockets) and which room they're playing in.
// ---------------------------------------------------------------------------
const presence = new Map();   // code -> { sid, name, room, since }
// Parties: a leader + friends who follow the leader into matches automatically
const parties = new Map();    // partyId -> { id, leader, members: Set<code> }
const partyOf = new Map();    // code -> partyId
let partyCounter = 1;
const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
function presenceOf(code) {
  const pr = presence.get(code);
  if (!pr) return { code, online: false };
  const r = pr.room && rooms.get(pr.room);
  return { code, online: true, name: pr.name, room: r ? r.id : null, map: r ? r.map.name : null, players: r ? r.humanCount() : 0 };
}
function sendToCode(code, ev, data) {
  const pr = presence.get(code);
  if (!pr) return false;
  const sock = io.sockets && io.sockets.sockets ? io.sockets.sockets.get(pr.sid) : null;
  if (sock) { sock.emit(ev, data); return true; }
  return false;
}

function partyState(pt) {
  return { id: pt.id, leader: pt.leader, members: [...pt.members].map((c) => { const pr = presence.get(c); return { code: c, name: pr ? pr.name : c, online: !!pr }; }) };
}
function partyBroadcast(pt) { const st = partyState(pt); for (const c of pt.members) sendToCode(c, 'party:update', st); }
function leaveParty(code) {
  const id = partyOf.get(code);
  if (!id) return;
  partyOf.delete(code);
  const pt = parties.get(id);
  if (!pt) return;
  pt.members.delete(code);
  sendToCode(code, 'party:update', null);
  if (pt.members.size <= 1) { for (const c of pt.members) { partyOf.delete(c); sendToCode(c, 'party:update', null); } parties.delete(id); return; }
  if (pt.leader === code) pt.leader = [...pt.members][0];
  partyBroadcast(pt);
}
/** keep the account's cosmetics in sync in every room it is playing in */
function refreshEquip(code, profile) {
  for (const r of rooms.values()) for (const p of r.players.values()) if (p.acct === code) { p.equip = Object.assign({}, profile.equipped); }
}

io.on('connection', (socket) => {
  let room = null;
  let player = null;
  let myCode = null;          // set on the lobby socket via 'hello'
  let gameCode = null;        // set on the game socket via join
  let acct = null;            // authenticated account code (lobby or game socket)
  const inputLimit = limiter(120, 1000);
  const actionLimit = limiter(60, 1000);
  const shotLimit = limiter(40, 1000);
  const voiceLimit = limiter(200, 1000);

  socket.on('join', async (data, ack) => {
    if (typeof ack !== 'function') return;
    if (player || socket._joining) return ack({ ok: false, err: 'Zaten bir odadasın' });
    socket._joining = true;
    data = data || {};
    // optional account login for persistent progress (never blocks playing if the DB is down)
    let profile = null;
    if (data.code && data.token) {
      const a = await store.auth(cleanCode(data.code), data.token, cleanName(data.name)).catch(() => null);
      if (a && a.ok) { acct = cleanCode(data.code); profile = a.profile; }
    }
    socket._joining = false;
    if (socket.disconnected) return;   // left while we were loading the account
    if (data.mode === 'ranked' && !acct) return ack({ ok: false, err: 'Dereceli için hesap gerekli (sunucuya bağlanılamadı, tekrar dene)' });
    const code = cleanRoomCode(data.room);
    const r = code ? getRoom(code, data) : quickMatchRoom(data);
    if (r && code) r.isPrivate = true;
    if (!r) return ack({ ok: false, err: 'Sunucu dolu' });
    if (r.humanCount() >= r.perTeam * 2) return ack({ ok: false, err: `Oda dolu (${r.perTeam * 2}/${r.perTeam * 2})` });
    room = r;
    player = room.addHuman(socket, cleanName(data.name));
    if (profile) {
      player.acct = acct;
      player.equip = Object.assign({}, profile.equipped);
      player.level = profile.level;
      player.rankId = profile.rank.id;
    }
    if (data.bots) {
      const n = Math.max(0, Math.min(9, data.bots | 0));
      for (let i = 0; i < n; i++) room.addBot();
    }
    gameCode = cleanCode(data.code);
    if (gameCode && presence.has(gameCode)) presence.get(gameCode).room = room.id;
    ack({ ok: true, ...room.initPayload(player), account: !!profile });
    room.broadcastMsg(`${player.name} odaya katıldı`);
    // party leader joined a match → bring the party along
    const pid = gameCode && partyOf.get(gameCode);
    const pt = pid && parties.get(pid);
    if (pt && pt.leader === gameCode) for (const c of pt.members) if (c !== gameCode) sendToCode(c, 'party:follow', { room: room.id, mode: room.mode.id, map: room.map.name, leader: player.name });
  });
  socket.on('vote', (mapId) => { if (player && actionLimit()) room.onVote(player, String(mapId || '')); });

  // ---- accounts / progression / cosmetics store
  socket.on('auth', async (data, ack) => {
    if (typeof ack !== 'function' || !data || !actionLimit()) return;
    const code = cleanCode(data.code);
    const res = await store.auth(code, data.token, data.name ? cleanName(data.name) : '').catch(() => ({ ok: false, err: 'db' }));
    if (res.ok) acct = code;
    ack(res);
  });
  const needAcct = (ack) => { if (typeof ack !== 'function') return false; if (!acct || !store.cached(acct)) { ack({ ok: false, err: 'Önce hesaba bağlan' }); return false; } return true; };
  socket.on('store:buy', (data, ack) => {
    if (!needAcct(ack) || !actionLimit()) return;
    const res = data && data.kind === 'agent' ? store.buyAgent(acct, String(data.id || '')) : store.buySkin(acct, String((data && data.id) || ''));
    ack(res);
  });
  socket.on('store:equip', (data, ack) => {
    if (!needAcct(ack) || !actionLimit() || !data) return;
    const res = store.equip(acct, String(data.weapon || ''), String(data.id || ''), S.WEAPONS);
    if (res.ok) refreshEquip(acct, res.profile);
    ack(res);
  });
  socket.on('profile:get', (x, ack) => { if (needAcct(ack)) ack({ ok: true, profile: store.view(acct) }); });
  socket.on('profile:history', async (x, ack) => {
    if (!needAcct(ack) || !actionLimit()) return;
    ack({ ok: true, list: await store.history(acct, 10) });
  });
  socket.on('account:delete', async (data, ack) => {
    if (typeof ack !== 'function' || !data || !actionLimit()) return;
    const code = cleanCode(data.code);
    const res = await store.deleteAccount(code, String(data.token || ''));
    if (res.ok && acct === code) acct = null;
    ack(res);
  });
  // ---- report a player (stored for moderation)
  const reportLimit = limiter(5, 60000);
  socket.on('report', (data) => {
    if (!player || !data || !reportLimit()) return;
    const target = room.players.get(String(data.id || ''));
    if (!target || target === player || target.isBot) return;
    store.report({ reporter: acct || gameCode || player.name, target: target.acct || '', targetName: target.name, reason: data.reason, room: room.id });
    socket.emit('msg', { text: `${target.name} bildirildi. Teşekkürler — moderasyon inceleyecek.` });
  });

  socket.on('input', (arr) => { if (player && inputLimit()) room.onInputs(player, arr); });
  socket.on('shoot', (msg) => { if (player && shotLimit()) room.onShoot(player, msg); });
  socket.on('reload', () => { if (player && actionLimit()) room.onReload(player); });
  socket.on('switch', (slot) => { if (player && actionLimit() && player.alive) room.switchSlot(player, slot); });
  socket.on('scope', (lvl) => { if (player && actionLimit()) room.onScope(player, lvl); });
  socket.on('buy', (item) => { if (player && actionLimit()) room.onBuy(player, item); });
  socket.on('team', (team) => {
    if (!player || !actionLimit()) return;
    if (team === player.team) return;
    if (!room.assignTeam(player, team)) socket.emit('msg', { text: 'Takım dolu' });
  });
  socket.on('addBot', (team) => {
    if (!player || !actionLimit()) return;
    if (!room.addBot(team)) socket.emit('msg', { text: 'Takım dolu, bot eklenemedi' });
  });
  socket.on('kickBots', () => { if (player && actionLimit()) room.kickBots(); });
  socket.on('chat', (text) => {
    if (!player || !actionLimit()) return;
    const isTeam = text && typeof text === 'object' && text.team;
    const raw = text && typeof text === 'object' ? text.m : text;
    const t = String(raw || '').replace(/[<>]/g, '').slice(0, 120).trim();
    if (!t) return;
    const msg = { n: player.name, t: player.team, m: t, tm: isTeam ? 1 : 0 };
    if (isTeam) { socket.emit('chat', msg); for (const s2 of room.teamSockets(player.team, player.id)) s2.emit('chat', msg); }
    else io.to(room.id).emit('chat', msg);
  });
  // ---- presence / friends (lobby socket)
  socket.on('hello', (data) => {
    const code = cleanCode(data && data.code);
    if (code.length < 6) return;
    myCode = code;
    const prev = presence.get(code);
    presence.set(code, { sid: socket.id, name: cleanName(data.name), room: prev ? prev.room : null, since: Date.now() });
  });
  socket.on('friends:status', (codes, ack) => {
    if (typeof ack !== 'function' || !Array.isArray(codes) || !actionLimit()) return;
    ack(codes.slice(0, 100).map((c) => presenceOf(cleanCode(c))));
  });
  socket.on('friends:request', (code) => {
    code = cleanCode(code);
    if (!myCode || !actionLimit() || code === myCode) return;
    const me = presence.get(myCode);
    sendToCode(code, 'friends:request', { code: myCode, name: me ? me.name : '' });
  });
  socket.on('friends:invite', (data) => {
    const code = cleanCode(data && data.code), roomCode = cleanRoomCode(data && data.room);
    if (!myCode || !actionLimit() || !roomCode) return;
    const me = presence.get(myCode);
    const r = rooms.get(roomCode);
    sendToCode(code, 'friends:invite', { code: myCode, name: me ? me.name : '', room: roomCode, map: r ? r.map.name : '' });
  });

  // ---- parties (lobby socket)
  socket.on('party:invite', (code) => {
    code = cleanCode(code);
    if (!myCode || !actionLimit() || code === myCode || !presence.has(code)) return;
    let pid = partyOf.get(myCode);
    if (!pid) {
      pid = 'P' + (partyCounter++);
      parties.set(pid, { id: pid, leader: myCode, members: new Set([myCode]) });
      partyOf.set(myCode, pid);
      partyBroadcast(parties.get(pid));
    }
    const pt = parties.get(pid);
    if (pt.members.size >= 5) { socket.emit('party:error', 'Parti dolu (5/5)'); return; }
    const me = presence.get(myCode);
    sendToCode(code, 'party:invite', { party: pid, code: myCode, name: me ? me.name : '' });
  });
  socket.on('party:accept', (pid) => {
    pid = String(pid || '');
    const pt = parties.get(pid);
    if (!myCode || !pt || !actionLimit()) return;
    if (pt.members.size >= 5) { socket.emit('party:error', 'Parti dolu'); return; }
    if (partyOf.get(myCode) && partyOf.get(myCode) !== pid) leaveParty(myCode);
    pt.members.add(myCode);
    partyOf.set(myCode, pid);
    partyBroadcast(pt);
  });
  socket.on('party:leave', () => { if (myCode && actionLimit()) leaveParty(myCode); });

  // ---- weapons on the ground
  socket.on('drop', () => { if (player && actionLimit()) room.onDropWeapon(player); });
  socket.on('pickup', (id) => { if (player && actionLimit()) room.onPickup(player, id | 0); });

  // ---- voice chat signalling (WebRTC, team only) + talking indicator
  socket.on('rtc', (msg) => {
    if (!player || !msg || !voiceLimit()) return;
    const payload = { from: player.id, name: player.name, sig: msg.sig };
    if (msg.to === 'team') { for (const s2 of room.teamSockets(player.team, player.id)) s2.emit('rtc', payload); return; }
    const target = room.players.get(msg.to);
    if (target && target.socket && target.team === player.team) target.socket.emit('rtc', payload);
  });
  socket.on('talk', (on) => {
    if (!player || !actionLimit()) return;
    for (const s2 of room.teamSockets(player.team, player.id)) s2.emit('talk', { i: player.id, n: player.name, on: !!on });
  });

  socket.on('tsync', (clientTime, ack) => {
    if (typeof ack !== 'function') return;
    ack(room ? room.now() : 0, clientTime);
  });
  socket.on('pingrep', (ms) => { if (player && Number.isFinite(ms)) player.ping = Math.round(Math.min(999, Math.max(0, ms))); });
  socket.on('disconnect', () => {
    if (myCode && presence.get(myCode) && presence.get(myCode).sid === socket.id) { presence.delete(myCode); leaveParty(myCode); }
    if (gameCode && presence.has(gameCode) && presence.get(gameCode).room === (room && room.id)) presence.get(gameCode).room = null;
    if (room && player) {
      const name = player.name;
      room.removePlayer(player.id);
      room.broadcastMsg(`${name} oyundan ayrıldı`);
    }
    room = null; player = null;
  });
});

server.listen(PORT, () => {
  console.log(`BLOCK OPS server listening on http://localhost:${PORT}  (build ${BUILD_ID})`);
  // Print LAN addresses so friends on the same Wi-Fi can join
  const nets = require('os').networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  Aynı Wi-Fi'deki arkadaşlar için: http://${n.address}:${PORT}`);
    }
  }
});

function shutdown() {
  console.log('Kapatılıyor...');
  for (const r of rooms.values()) {
    // a deploy/restart is not the players' fault: give everyone a normal result instead of an abandon
    for (const p of r.players.values()) p.recorded = true;
    r.destroy();
  }
  io.close();
  store.close().finally(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server, rooms, store };
