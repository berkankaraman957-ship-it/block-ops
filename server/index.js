'use strict';
/*
 * BLOCK OPS: TACTICAL DRIFT — game server entry
 * HTTP static hosting (no framework needed) + Socket.io realtime layer + room/lobby management.
 *
 *   PORT=3000 node server/index.js
 *   CORS_ORIGIN="capacitor://localhost,http://localhost,https://yourdomain.com"
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const Room = require('./Room');
const S = require('../shared/shared.js');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS || '200', 10);
if (process.env.BLOCKOPS_FAST === '1') {
  // Test mode: shorter phases so automated tests can run whole matches quickly.
  Object.assign(S.CONFIG.ROUND, { WARMUP: 2, FREEZE: 1, POST: 1, GAMEOVER: 2, LIVE: 60 });
}
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
// Static file server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};

function sendFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache && !file.endsWith('sw.js') ? 'public, max-age=3600' : 'no-cache',
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
    res.end(JSON.stringify({ ok: true, version: S.CONFIG.VERSION, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.humanCount(), 0) }));
    return;
  }
  if (url === '/vendor/socket.io.min.js') return sendFile(res, clientBundlePath, true);
  if (url.startsWith('/shared/')) {
    const f = safeJoin(SHARED_DIR, url.slice('/shared/'.length));
    return f ? sendFile(res, f, false) : (res.writeHead(403), res.end());
  }
  if (url === '/' || url === '') url = '/index.html';
  const f = safeJoin(PUBLIC_DIR, url);
  if (!f) { res.writeHead(403); res.end(); return; }
  sendFile(res, f, !url.endsWith('.html'));
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
  return {
    map: S.MAPS[data.map] ? data.map : S.MAP_ORDER[Math.floor(Math.random() * S.MAP_ORDER.length)],
    difficulty: S.DIFFICULTY[data.difficulty] ? data.difficulty : 'medium'
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
  console.log('[room] created', id, room.mapId, room.diff.id);
  return room;
}
function quickMatchRoom(data) {
  let best = null;
  for (const r of rooms.values()) {
    const humans = r.humanCount();
    if (r.isPrivate || humans >= CONFIG_MAX_HUMANS || r.phase === 'gameover') continue;
    if (data.difficulty && r.diff.id !== data.difficulty) continue;
    if (!best || humans > best.humanCount()) best = r;
  }
  return best || getRoom(null, data);
}
const CONFIG_MAX_HUMANS = S.CONFIG.MAX_PER_TEAM * 2;

// Simple per-socket rate limiter
function limiter(max, perMs) {
  let count = 0, start = Date.now();
  return () => {
    const now = Date.now();
    if (now - start > perMs) { start = now; count = 0; }
    return ++count <= max;
  };
}

io.on('connection', (socket) => {
  let room = null;
  let player = null;
  const inputLimit = limiter(120, 1000);
  const actionLimit = limiter(60, 1000);
  const shotLimit = limiter(40, 1000);

  socket.on('join', (data, ack) => {
    if (typeof ack !== 'function') return;
    if (player) return ack({ ok: false, err: 'Zaten bir odadasın' });
    data = data || {};
    const code = cleanRoomCode(data.room);
    const r = code ? getRoom(code, data) : quickMatchRoom(data);
    if (r && code) r.isPrivate = true;
    if (!r) return ack({ ok: false, err: 'Sunucu dolu' });
    if (r.humanCount() >= CONFIG_MAX_HUMANS) return ack({ ok: false, err: 'Oda dolu (10/10)' });
    room = r;
    player = room.addHuman(socket, cleanName(data.name));
    if (data.bots) {
      const n = Math.max(0, Math.min(9, data.bots | 0));
      for (let i = 0; i < n; i++) room.addBot();
    }
    ack({ ok: true, ...room.initPayload(player) });
    room.broadcastMsg(`${player.name} odaya katıldı`);
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
    const t = String(text || '').replace(/[<>]/g, '').slice(0, 120).trim();
    if (t) io.to(room.id).emit('chat', { n: player.name, t: player.team, m: t });
  });
  socket.on('tsync', (clientTime, ack) => {
    if (typeof ack !== 'function') return;
    ack(room ? room.now() : 0, clientTime);
  });
  socket.on('pingrep', (ms) => { if (player && Number.isFinite(ms)) player.ping = Math.round(Math.min(999, Math.max(0, ms))); });
  socket.on('disconnect', () => {
    if (room && player) {
      const name = player.name;
      room.removePlayer(player.id);
      room.broadcastMsg(`${name} oyundan ayrıldı`);
    }
    room = null; player = null;
  });
});

server.listen(PORT, () => {
  console.log(`BLOCK OPS server listening on http://localhost:${PORT}`);
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
  for (const r of rooms.values()) r.destroy();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server, rooms };
