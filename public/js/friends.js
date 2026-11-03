/*
 * Friends: every device gets a permanent friend code (stored locally, no account needed).
 * A lightweight "lobby" socket stays connected to show online status, deliver friend
 * requests and match invites. Friend lists are stored on the device.
 */
const $ = (id) => document.getElementById(id);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function load(key, def) { try { return JSON.parse(localStorage.getItem(key)) || def; } catch (e) { return def; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ignore */ } }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Friends {
  constructor(game) {
    this.g = game;
    let id = load('blockops.identity', null);
    if (!id || !id.code) {
      const rnd = new Uint32Array(7);
      (window.crypto || window.msCrypto).getRandomValues(rnd);
      id = { code: Array.from(rnd, (n) => ALPHABET[n % ALPHABET.length]).join('') };
      save('blockops.identity', id);
    }
    this.code = id.code;
    this.list = load('blockops.friends', []);   // [{code, name}]
    this.status = {};
    this.socket = null;
    this.bindUI();
    this.render();
  }

  get myName() { return this.g.settings.name || 'Oyuncu'; }

  connect(url) {
    if (typeof window.io !== 'function') return;
    if (this.socket) { try { this.socket.disconnect(); } catch (e) { /* ignore */ } }
    try {
      this.socket = window.io(url || undefined, { transports: ['websocket'], reconnection: true, reconnectionDelay: 3000, forceNew: true });
    } catch (e) { return; }
    const s = this.socket;
    s.on('connect', () => { s.emit('hello', { code: this.code, name: this.myName }); this.refresh(); });
    s.on('friends:request', (m) => this.onRequest(m));
    s.on('friends:invite', (m) => this.onInvite(m));
    clearInterval(this._poll);
    this._poll = setInterval(() => this.refresh(), 10000);
  }
  rename() { if (this.socket && this.socket.connected) this.socket.emit('hello', { code: this.code, name: this.myName }); }

  refresh() {
    if (!this.socket || !this.socket.connected || !this.list.length) { this.render(); return; }
    this.socket.emit('friends:status', this.list.map((f) => f.code), (res) => {
      if (Array.isArray(res)) for (const r of res) this.status[r.code] = r;
      for (const f of this.list) { const st = this.status[f.code]; if (st && st.online && st.name) f.name = st.name; }
      save('blockops.friends', this.list);
      this.render();
    });
  }

  add(code, name) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 6) return 'Geçersiz kod';
    if (code === this.code) return 'Bu senin kendi kodun';
    if (this.list.some((f) => f.code === code)) return 'Zaten listende';
    this.list.push({ code, name: name || code });
    save('blockops.friends', this.list);
    if (this.socket && this.socket.connected) this.socket.emit('friends:request', code);
    this.refresh();
    return null;
  }
  remove(code) {
    this.list = this.list.filter((f) => f.code !== code);
    save('blockops.friends', this.list);
    this.render();
  }
  invite(code) {
    if (!this.g.inGame || !this.socket) return;
    this.socket.emit('friends:invite', { code, room: this.g.roomId });
    this.g.hud.centerMsg('Davet gönderildi', 2000);
  }

  // ---------------------------------------------------------------- incoming
  toast(html, actions) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<div class="tmsg">${html}</div>`;
    const row = document.createElement('div');
    row.className = 'tact';
    for (const [label, fn, cls] of actions) {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', () => { fn && fn(); t.remove(); });
      row.appendChild(b);
    }
    t.appendChild(row);
    $('toasts').appendChild(t);
    this.g.sfx.ui(true);
    setTimeout(() => t.remove(), 20000);
  }
  onRequest(m) {
    if (this.list.some((f) => f.code === m.code)) return;
    this.toast(`👥 <b>${esc(m.name || m.code)}</b> seni arkadaş olarak ekledi`, [
      ['EKLE', () => this.add(m.code, m.name), 'primary'], ['YOKSAY', null]
    ]);
  }
  onInvite(m) {
    this.toast(`🎮 <b>${esc(m.name || m.code)}</b> seni maça davet ediyor<br><small>Oda ${esc(m.room)}${m.map ? ' · ' + esc(m.map) : ''}</small>`, [
      ['KATIL', () => this.g.joinRoom(m.room), 'primary'], ['SONRA', null]
    ]);
  }

  // ---------------------------------------------------------------- UI
  bindUI() {
    $('myCode').textContent = this.code;
    $('btnCopyCode').addEventListener('click', async () => {
      const text = `BLOCK OPS arkadaş kodum: ${this.code}`;
      try { await navigator.clipboard.writeText(this.code); $('btnCopyCode').textContent = 'KOPYALANDI ✓'; }
      catch (e) { prompt('Kodun:', this.code); }
      setTimeout(() => { $('btnCopyCode').textContent = 'KOPYALA'; }, 1500);
      if (navigator.share && this.g.isTouch) navigator.share({ text }).catch(() => {});
    });
    const doAdd = () => {
      const err = this.add($('inFriend').value);
      $('friendErr').textContent = err || '';
      if (!err) $('inFriend').value = '';
    };
    $('btnAddFriend').addEventListener('click', doAdd);
    $('inFriend').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); e.stopPropagation(); });
  }

  render() {
    const box = $('friendList');
    const pbox = $('pauseFriends');
    if (!this.list.length) {
      box.innerHTML = '<div class="muted">Henüz arkadaşın yok. Arkadaşının kodunu yukarıya yazıp ekle — o da seni görecek.</div>';
      if (pbox) pbox.innerHTML = '<div class="muted">Arkadaş listen boş.</div>';
      return;
    }
    const sorted = this.list.slice().sort((a, b) => (this.status[b.code] && this.status[b.code].online ? 1 : 0) - (this.status[a.code] && this.status[a.code].online ? 1 : 0));
    const row = (f, inPause) => {
      const st = this.status[f.code] || {};
      const state = !st.online ? '<span class="off">● Çevrimdışı</span>' : st.room ? `<span class="game">● Maçta · ${esc(st.map || '')}</span>` : '<span class="on">● Çevrimiçi</span>';
      const join = st.online && st.room && st.room !== this.g.roomId ? `<button data-join="${esc(st.room)}">KATIL</button>` : '';
      const inv = this.g.inGame && st.online && st.room !== this.g.roomId ? `<button data-inv="${f.code}" class="primary">DAVET ET</button>` : '';
      const del = inPause ? '' : `<button data-del="${f.code}" class="del" title="Sil">✕</button>`;
      return `<div class="friend"><div><b>${esc(f.name)}</b><small>${f.code}</small><br>${state}</div><div class="fa">${join}${inv}${del}</div></div>`;
    };
    box.innerHTML = sorted.map((f) => row(f, false)).join('');
    if (pbox) pbox.innerHTML = sorted.map((f) => row(f, true)).join('');
    for (const root of [box, pbox]) {
      if (!root) continue;
      root.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', () => this.g.joinRoom(b.dataset.join)));
      root.querySelectorAll('[data-inv]').forEach((b) => b.addEventListener('click', () => this.invite(b.dataset.inv)));
      root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => this.remove(b.dataset.del)));
    }
  }
}
