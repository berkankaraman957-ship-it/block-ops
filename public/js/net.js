/*
 * Network layer: Socket.io connection, clock synchronisation (NTP-style, min-RTT filtered).
 */
export class Net {
  constructor() {
    this.socket = null;
    this.offset = 0;
    this.rtt = 80;
    this.samples = [];
    this.synced = false;
    this.syncTimer = null;
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      if (typeof window.io !== 'function') { reject(new Error('Socket.io istemcisi yüklenemedi')); return; }
      const socket = window.io(url || undefined, {
        transports: ['websocket'], reconnection: false, timeout: 8000, forceNew: true
      });
      this.socket = socket;
      const to = setTimeout(() => reject(new Error('Sunucuya bağlanılamadı (zaman aşımı)')), 9000);
      socket.on('connect', () => { clearTimeout(to); resolve(); });
      socket.on('connect_error', (e) => { clearTimeout(to); reject(new Error('Sunucuya bağlanılamadı: ' + (e && e.message ? e.message : ''))); });
    });
  }

  on(ev, fn) { this.socket.on(ev, fn); }
  emit(...args) { if (this.socket) this.socket.emit(...args); }

  join(data) {
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('Odaya katılım zaman aşımı')), 8000);
      this.socket.emit('join', data, (res) => {
        clearTimeout(to);
        if (!res || !res.ok) reject(new Error((res && res.err) || 'Katılım reddedildi'));
        else resolve(res);
      });
    });
  }

  startSync() {
    const burst = (n) => { for (let i = 0; i < n; i++) setTimeout(() => this.ping(), i * 120); };
    burst(6);
    this.syncTimer = setInterval(() => { this.ping(); this.emit('pingrep', this.rtt); }, 2000);
  }

  ping() {
    if (!this.socket) return;
    const c = performance.now();
    this.socket.emit('tsync', c, (serverTime) => {
      const now = performance.now();
      const rtt = now - c;
      this.samples.push({ rtt, off: serverTime + rtt / 2 - now });
      if (this.samples.length > 10) this.samples.shift();
      const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      this.rtt = this.rtt * 0.7 + rtt * 0.3;
      if (!this.synced || Math.abs(best.off - this.offset) > 60) this.offset = best.off;
      else this.offset += (best.off - this.offset) * 0.15;
      this.synced = true;
    });
  }

  serverNow() { return performance.now() + this.offset; }

  close() {
    clearInterval(this.syncTimer);
    if (this.socket) { this.socket.disconnect(); this.socket = null; }
    this.samples = [];
    this.synced = false;
  }
}
