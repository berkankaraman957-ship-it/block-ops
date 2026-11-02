/* DEV/TEST ONLY — minimal Socket.io-compatible browser client (pairs with shim-server.js). */
(function (root) {
  function io(url, opts) {
    var base = (url || location.origin).replace(/^http/, 'ws').replace(/\/$/, '');
    var listeners = {}, acks = {}, ackId = 0, queue = [];
    var ws = new WebSocket(base + '/shim-ws');
    var socket = {
      connected: false,
      on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return socket; },
      off: function (ev) { delete listeners[ev]; },
      emit: function (ev) {
        var args = Array.prototype.slice.call(arguments, 1), id = null;
        if (typeof args[args.length - 1] === 'function') { id = ++ackId; acks[id] = args.pop(); }
        var msg = JSON.stringify(['e', ev, args, id]);
        if (ws.readyState === 1) ws.send(msg); else queue.push(msg);
        return socket;
      },
      disconnect: function () { ws.close(); }
    };
    socket.volatile = { emit: function () { if (ws.readyState === 1) socket.emit.apply(socket, arguments); } };
    function fire(ev, args) { (listeners[ev] || []).forEach(function (fn) { fn.apply(null, args); }); }
    ws.onopen = function () { socket.connected = true; queue.forEach(function (m) { ws.send(m); }); queue = []; fire('connect', []); };
    ws.onclose = function () { socket.connected = false; fire('disconnect', ['transport close']); };
    ws.onerror = function () { fire('connect_error', [new Error('ws error')]); };
    ws.onmessage = function (e) {
      var m = JSON.parse(e.data);
      if (m[0] === 'e') {
        var args = m[2] || [];
        if (m[3] != null) args.push(function () { ws.send(JSON.stringify(['a', m[3], Array.prototype.slice.call(arguments)])); });
        fire(m[1], args);
      } else if (m[0] === 'a') { var fn = acks[m[1]]; if (fn) { delete acks[m[1]]; fn.apply(null, m[2] || []); } }
    };
    return socket;
  }
  if (typeof module === 'object' && module.exports) module.exports = io; else root.io = io;
})(typeof self !== 'undefined' ? self : this);
