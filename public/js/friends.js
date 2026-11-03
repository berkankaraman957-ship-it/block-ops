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
    const rand = (n, abc) => { const r = new Uint32Array(n); (window.crypto || window.msCrypto).getRandomValues(r); return Array.from(r, (x) => abc[x % abc.length]).join(''); };
    if (!id || !id.code) id = { code: rand(7, ALPHABET) };
    // secret account token (never shown to others): makes the code a real, persistent account
    if (!id.token) { id.token = rand(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'); }
    save('blockops.identity', id);
    this.code = id.code;
    this.token = id.token;
    this.party = null;
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
    s.on('connect', () => { s.emit('hello', { code: this.code, name: this.myName }); this.refresh(); if (this.g.account) this.g.account.auth(); });
    s.on('disconnect', () => { if (this.g.account) this.g.account.onDisconnect(); this.party = null; this.renderParty(); });
    s.on('friends:request', (m) => this.onRequest(m));
    s.on('friends:invite', (m) => this.onInvite(m));
    s.on('party:invite', (m) => this.toast(`🎉 <b>${esc(m.name || m.code)}</b> seni partisine çağırıyor<br><small>Parti lideri maça girince otomatik olarak aynı odaya gelirsin</small>`, [
      ['KATIL', () => s.emit('party:accept', m.party), 'primary'], ['HAYIR', null]]));
    s.on('party:update', (st) => { this.party = st; this.renderParty(); this.render(); });
    s.on('party:error', (t) => this.g.hud.centerMsg(String(t), 3000));
    s.on('party:follow', (m) => {
      if (this.g.inGame && this.g.roomId === m.room) return;
      if (!this.g.inGame) {
        this.g.hud.centerMsg(`Parti lideri ${m.leader} maça girdi — sen de katılıyorsun…`, 3000);
        this.g.joinRoom(m.room);
      } else this.toast(`🎉 Parti lideri <b>${esc(m.leader)}</b> başka bir maça girdi<br><small>Oda ${esc(m.room)} · ${esc(m.map || '')}</small>`, [['GİT', () => this.g.joinRoom(m.room), 'primary'], ['KAL', null]]);
    });
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
  partyInvite(code) {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('party:invite', code);
    this.g.hud.centerMsg('Parti daveti gönderildi', 2000);
    this.g.sfx.ui(true);
  }
  partyLeave() { if (this.socket) this.socket.emit('party:leave'); }
  renderParty() {
    const box = $('partyBox'), bar = $('partyBar');
    const pt = this.party;
    if (!pt) {
      box.innerHTML = '<div class="muted">Bir arkadaşını partiye çağır (🎉 butonu): sen maça girdiğinde parti üyeleri otomatik olarak aynı odaya gelir.</div>';
      bar.classList.add('hidden');
      return;
    }
    const lead = pt.leader === this.code;
    const chips = pt.members.map((m) => `<span class="pm ${m.online ? '' : 'off'}">${m.code === pt.leader ? '👑 ' : ''}${esc(m.code === this.code ? 'Sen' : m.name)}</span>`).join('');
    box.innerHTML = `<div class="party-row">${chips}</div><div class="muted">${lead ? 'Partinin lideri sensin: HIZLI OYNA ya da ODA KUR dediğinde herkes seninle gelir.' : 'Lider maça girdiğinde otomatik katılacaksın.'}</div><button id="btnPartyLeave" class="danger mini">PARTİDEN AYRIL</button>`;
    bar.innerHTML = `🎉 PARTİ (${pt.members.length}/5): ${chips}`;
    bar.classList.remove('hidden');
    $('btnPartyLeave').addEventListener('click', () => this.partyLeave());
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
      const inParty = this.party && this.party.members.some((m) => m.code === f.code);
      const party = !inPause && st.online && !inParty ? `<button data-party="${f.code}" title="Partiye çağır">🎉 PARTİ</button>` : '';
      return `<div class="friend"><div><b>${esc(f.name)}</b><small>${f.code}</small><br>${state}</div><div class="fa">${join}${inv}${party}${del}</div></div>`;
    };
    box.innerHTML = sorted.map((f) => row(f, false)).join('');
    if (pbox) pbox.innerHTML = sorted.map((f) => row(f, true)).join('');
    for (const root of [box, pbox]) {
      if (!root) continue;
      root.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', () => this.g.joinRoom(b.dataset.join)));
      root.querySelectorAll('[data-inv]').forEach((b) => b.addEventListener('click', () => this.invite(b.dataset.inv)));
      root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => this.remove(b.dataset.del)));
      root.querySelectorAll('[data-party]').forEach((b) => b.addEventListener('click', () => this.partyInvite(b.dataset.party)));
    }
  }
}
