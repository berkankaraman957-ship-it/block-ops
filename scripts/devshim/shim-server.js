'use strict';
/*
 * DEV/TEST ONLY — minimal Socket.io-compatible server over `ws`.
 * Used only when BLOCKOPS_DEV_SHIM=1 and socket.io is not installed (offline CI).
 * Supports: connection, on/emit with acks, volatile.emit, join/leave rooms, io.to(room).emit.
 */
const { WebSocketServer } = require('ws');

function createServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/shim-ws' });
  const rooms = new Map();
  const handlers = {};
  let idc = 0;

  function makeSocket(ws) {
    const listeners = {};
    const acks = new Map();
    let ackId = 0;
    const socket = {
      id: 's' + (++idc) + Math.random().toString(36).slice(2, 8),
      rooms: new Set(),
      on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      emit(ev, ...args) {
        if (ws.readyState !== 1) return;
        let id = null;
        if (typeof args[args.length - 1] === 'function') { id = ++ackId; acks.set(id, args.pop()); }
        ws.send(JSON.stringify(['e', ev, args, id]));
      },
      join(r) { socket.rooms.add(r); if (!rooms.has(r)) rooms.set(r, new Set()); rooms.get(r).add(socket); },
      leave(r) { socket.rooms.delete(r); const s = rooms.get(r); if (s) { s.delete(socket); if (!s.size) rooms.delete(r); } },
      disconnect() { ws.close(); },
      _fire(ev, args) { for (const fn of listeners[ev] || []) { try { fn(...args); } catch (e) { console.error(e); } } }
    };
    socket.volatile = { emit: (...a) => { if (ws.bufferedAmount < 256 * 1024) socket.emit(...a); } };
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m[0] === 'e') {
        const args = m[2] || [];
        if (m[3] != null) args.push((...res) => { if (ws.readyState === 1) ws.send(JSON.stringify(['a', m[3], res])); });
        socket._fire(m[1], args);
      } else if (m[0] === 'a') {
        const fn = acks.get(m[1]); if (fn) { acks.delete(m[1]); fn(...(m[2] || [])); }
      }
    });
    ws.on('close', () => { for (const r of [...socket.rooms]) socket.leave(r); socket._fire('disconnect', ['transport close']); });
    return socket;
  }

  wss.on('connection', (ws) => {
    const s = makeSocket(ws);
    for (const fn of handlers.connection || []) fn(s);
  });

  return {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    to(room) {
      return { emit(ev, ...args) { const set = rooms.get(room); if (set) for (const s of set) s.emit(ev, ...args); } };
    },
    close() { wss.close(); }
  };
}
module.exports = { createServer };
