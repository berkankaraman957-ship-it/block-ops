/*
 * Account / profile / cosmetics store (client side).
 * The account is created automatically on first launch: friend code (public id) + random
 * secret token stored on this device. All rewards and purchases are decided by the server.
 * Skins are purely visual (see shared/cosmetics.js).
 */
import { skinPreview } from './models.js';

const $ = (id) => document.getElementById(id);
const C = window.COSMETICS;
const S = window.SHARED;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function load(key, def) { try { return JSON.parse(localStorage.getItem(key)) || def; } catch (e) { return def; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ignore */ } }
const MODE_LABEL = () => Object.fromEntries(Object.values(S.MODES).map((m) => [m.id, m.label]));
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class Account {
  constructor(game) {
    this.g = game;
    this.profile = load('blockops.profile', null);   // last known (shown instantly, refreshed on connect)
    this.online = false;
    this.err = '';
    this.weapon = 'krait';
    this.filter = 'all';
    this.historyList = null;
    this.bindUI();
    this.render();
  }

  get code() { return this.g.friends.code; }
  get token() { return this.g.friends.token; }
  get socket() { return this.g.friends.socket; }
  equippedFor(weaponId) { const e = this.profile && this.profile.equipped; return (e && e[weaponId]) || ''; }
  agentColor() { const a = this.profile && this.profile.equipped && this.profile.equipped.agent; return a && C.AGENTS[a] ? C.AGENTS[a].color : null; }
  owns(id) { return !!(this.profile && this.profile.inventory.includes(id)); }

  // ---------------------------------------------------------------- server
  auth() {
    const s = this.socket;
    if (!s || !s.connected) return;
    s.emit('auth', { code: this.code, token: this.token, name: this.g.settings.name || '' }, (res) => {
      if (res && res.ok) {
        this.online = true; this.err = '';
        if (res.created) this.g.hud.centerMsg && setTimeout(() => this.toast(`🎁 Hoş geldin! Başlangıç hediyesi: <b>${C.COINS.NEW_ACCOUNT} Blok Coin</b>`), 1500);
        this.setProfile(res.profile);
        this.loadHistory();
      } else {
        this.online = false;
        this.err = res && res.err === 'auth' ? 'Bu cihazdaki hesap anahtarı sunucudakiyle eşleşmiyor. Doğru hesap anahtarını aşağıdan yükle.'
          : 'Hesap sunucusuna şu an ulaşılamıyor — maçlar yine oynanır, ilerleme bağlantı gelince kaydedilir.';
        this.render();
      }
    });
  }
  onDisconnect() { this.online = false; this.render(); }
  setProfile(p) {
    const prevCoins = this.profile ? this.profile.coins : null;
    this.profile = p;
    save('blockops.profile', p);
    this.render();
    this.g.onCosmeticsChanged && this.g.onCosmeticsChanged();
    if (prevCoins !== null && p.coins > prevCoins) this.g.sfx.coin();
  }
  loadHistory() {
    const s = this.socket;
    if (!s || !s.connected) return;
    s.emit('profile:history', 0, (res) => { if (res && res.ok) { this.historyList = res.list; this.renderHistory(); } });
  }
  buy(id, kind) {
    const s = this.socket;
    if (!s || !s.connected || !this.online) { this.msg('Sunucuya bağlı değilsin', false); return; }
    s.emit('store:buy', { id, kind }, (res) => {
      if (res && res.ok) { this.setProfile(res.profile); this.msg('Satın alındı! Şimdi kuşanabilirsin.', true); this.g.sfx.ui(true); }
      else this.msg((res && res.err) || 'Satın alınamadı', false);
    });
  }
  equip(weapon, id) {
    const s = this.socket;
    if (!s || !s.connected || !this.online) { this.msg('Sunucuya bağlı değilsin', false); return; }
    s.emit('store:equip', { weapon, id }, (res) => {
      if (res && res.ok) { this.setProfile(res.profile); this.msg(id ? 'Kuşanıldı ✓' : 'Varsayılan görünüme dönüldü', true); }
      else this.msg((res && res.err) || 'Kuşanılamadı', false);
    });
  }

  /** end-of-match rewards from the game socket */
  onProgress(res) {
    if (!res || !res.profile) return;
    this.setProfile(res.profile);
    const box = $('endProgress');
    const lines = [`<span class="xp">+${res.xp} XP</span>`, `<span class="coin">+${res.coins} ◆</span>`];
    if (res.rankDelta) lines.push(`<span class="${res.rankDelta > 0 ? 'up' : 'down'}">${res.rankDelta > 0 ? '+' : ''}${res.rankDelta} RP</span>`);
    if (res.levelUps) lines.push(`<span class="lvl">SEVİYE ${res.level}!</span>`);
    if (res.rankUp) lines.push(`<span class="lvl">${esc(res.rankUp)} RÜTBESİ!</span>`);
    box.innerHTML = lines.join('');
    box.classList.remove('hidden');
    if (res.levelUps) { this.g.sfx.levelUp(); this.toast(`⭐ <b>Seviye ${res.level}</b> oldun! +${res.levelUps * C.COINS.LEVEL_UP} Blok Coin bonus`); }
    if (this.historyList) { this.historyList.unshift(Object.assign({ at: new Date().toISOString() }, res.entry)); this.historyList.length = Math.min(10, this.historyList.length); this.renderHistory(); }
  }

  // ---------------------------------------------------------------- account key / deletion
  key() { return `${this.code}-${this.token}`; }
  useKey(raw) {
    const m = String(raw || '').trim().match(/^([A-Z0-9]{6,8})-([A-Za-z0-9]{16,64})$/i);
    if (!m) return 'Geçersiz anahtar. Biçim: KOD-UZUNANAHTAR';
    save('blockops.identity', { code: m[1].toUpperCase(), token: m[2] });
    localStorage.removeItem('blockops.profile');
    location.reload();
    return null;
  }
  deleteAccount() {
    if (!confirm('Hesabın, seviyen, Blok Coin\'lerin ve kaplamaların KALICI olarak silinecek. Emin misin?')) return;
    if (!confirm('Son kez soruyorum: bu işlem geri alınamaz. Silinsin mi?')) return;
    const s = this.socket;
    if (!s || !s.connected) { alert('Sunucuya bağlı değilsin, sonra tekrar dene.'); return; }
    s.emit('account:delete', { code: this.code, token: this.token }, (res) => {
      if (res && res.ok) {
        for (const k of ['blockops.identity', 'blockops.profile', 'blockops.friends']) localStorage.removeItem(k);
        alert('Hesabın silindi.');
        location.reload();
      } else alert((res && res.err) || 'Silinemedi');
    });
  }

  // ---------------------------------------------------------------- UI
  toast(html) { this.g.friends.toast(html, [['TAMAM', null, 'primary']]); }
  msg(text, ok) { const el = $('storeMsg'); el.textContent = text; el.style.color = ok ? 'var(--ok)' : 'var(--bad)'; clearTimeout(this._m); this._m = setTimeout(() => { el.textContent = ''; }, 3500); }

  bindUI() {
    const sel = $('storeWeapon');
    const order = C.skinnable(S.WEAPONS).sort((a, b) => (S.WEAPONS[a].slot - S.WEAPONS[b].slot) || a.localeCompare(b));
    sel.innerHTML = order.map((id) => { return `<option value="${id}">${esc(S.WEAPONS[id].name)} — ${C.skinsFor(id).length} kaplama</option>`; }).join('');
    sel.value = this.weapon;
    sel.addEventListener('change', () => { this.weapon = sel.value; this.renderStore(); });
    const filters = [['all', 'HEPSİ'], ['owned', 'SENDE OLANLAR'], ['common', 'SIRADAN'], ['rare', 'NADİR'], ['epic', 'EPİK'], ['legendary', 'EFSANEVİ']];
    $('storeFilter').innerHTML = filters.map(([id, l]) => `<button data-f="${id}" class="${id === this.filter ? 'on' : ''}">${l}</button>`).join('');
    $('storeFilter').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      this.filter = b.dataset.f;
      $('storeFilter').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this.renderStore();
    }));
    $('btnShowKey').addEventListener('click', () => { $('keyBox').textContent = this.key(); $('keyBox').classList.remove('hidden'); $('btnCopyKey').classList.remove('hidden'); });
    $('btnCopyKey').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(this.key()); $('btnCopyKey').textContent = 'KOPYALANDI ✓'; } catch (e) { prompt('Hesap anahtarın:', this.key()); }
      setTimeout(() => { $('btnCopyKey').textContent = 'KOPYALA'; }, 1500);
    });
    $('btnUseKey').addEventListener('click', () => { $('keyErr').textContent = this.useKey($('inKey').value) || ''; });
    $('inKey').addEventListener('keydown', (e) => e.stopPropagation());
    $('btnDeleteAcct').addEventListener('click', () => this.deleteAccount());
    $('coinPacks').innerHTML = C.COIN_PACKS.map((p) => `<div class="pack"><div class="amt">◆ ${p.coins.toLocaleString('tr-TR')}${p.bonus ? `<small>+${p.bonus} bonus</small>` : ''}</div><div class="price">${p.label}</div><button disabled>YAKINDA</button></div>`).join('');
  }

  render() { this.renderCard(); this.renderProfile(); this.renderStore(); }

  renderCard() {
    const p = this.profile;
    $('playerCard').classList.toggle('hidden', !p);
    if (!p) return;
    $('pcLevel').textContent = p.level;
    $('pcName').textContent = this.g.settings.name || p.name || 'Oyuncu';
    $('pcXp').style.width = Math.round(100 * p.into / p.need) + '%';
    $('pcSub').innerHTML = `<span style="color:${p.rank.color}">${p.rank.icon} ${esc(p.rank.name)}</span> · ${p.rank_points} RP`;
    $('pcCoins').textContent = '◆ ' + p.coins.toLocaleString('tr-TR');
    $('coinBadge').textContent = '◆ ' + p.coins.toLocaleString('tr-TR');
    $('coinBadge').classList.remove('hidden');
  }

  renderProfile() {
    const p = this.profile;
    const off = $('profOffline');
    off.classList.toggle('hidden', !this.err);
    off.textContent = this.err;
    $('storeOffline').classList.toggle('hidden', this.online);
    $('storeOffline').textContent = this.err || 'Sunucuya bağlanılıyor… (satın alma ve kuşanma için bağlantı gerekir)';
    if (!p) { $('profName').textContent = 'Hesap yükleniyor…'; return; }
    $('profLevel').textContent = p.level;
    $('profName').textContent = this.g.settings.name || p.name || 'Oyuncu';
    $('profXp').style.width = Math.round(100 * p.into / p.need) + '%';
    $('profXpText').textContent = `${p.into} / ${p.need} XP · toplam ${p.xp.toLocaleString('tr-TR')} XP`;
    const next = C.RANKS.find((r) => r.min > p.rank_points);
    $('profRank').innerHTML = `<div class="ri" style="color:${p.rank.color}">${p.rank.icon}</div><b style="color:${p.rank.color}">${esc(p.rank.name)}</b><small>${p.rank_points} RP${next ? ` · ${next.name}: ${next.min}` : ' · zirve'}</small>`;
    const st = p.stats;
    const kd = (st.kills / Math.max(1, st.deaths)).toFixed(2);
    const wr = st.matches ? Math.round(100 * st.wins / st.matches) : 0;
    const hs = st.kills ? Math.round(100 * st.hs / st.kills) : 0;
    const cells = [['MAÇ', st.matches], ['GALİBİYET', `${st.wins} · %${wr}`], ['LEŞ', st.kills], ['K/Ö', kd], ['KAFADAN', `%${hs}`], ['ASİST', st.assists],
      ['MVP', st.mvps], ['HASAR', st.dmg.toLocaleString('tr-TR')], ['EN İYİ MAÇ', `${st.bestKills} leş`], ['DERECELİ', st.ranked]];
    $('profStats').innerHTML = cells.map(([l, v]) => `<div><small>${l}</small><b>${v}</b></div>`).join('');
  }

  renderHistory() {
    const list = this.historyList || [];
    const box = $('profHistory');
    if (!list.length) { box.innerHTML = '<div class="muted">Henüz kayıtlı maç yok — bir maç bitir, burada görünsün.</div>'; return; }
    const ML = MODE_LABEL();
    const R = { win: ['G', 'win', 'Galibiyet'], loss: ['M', 'loss', 'Mağlubiyet'], draw: ['B', 'draw', 'Berabere'], abandon: ['T', 'loss', 'Terk'] };
    box.innerHTML = list.map((m) => {
      const r = R[m.r] || R.draw;
      const when = m.at ? new Date(m.at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      const map = S.MAPS[m.map] ? S.MAPS[m.map].name : (m.map || '');
      const sc = Array.isArray(m.sc) ? `${m.sc[0]}–${m.sc[1]}` : '';
      return `<div class="hrow ${r[1]}"><span class="res" title="${r[2]}">${r[0]}</span><span class="hm">${esc(ML[m.mode] || m.mode || '')}<small>${esc(map)} · ${when}</small></span>` +
        `<span class="hs">${sc}</span><span class="hk">${m.k}/${m.d}/${m.a || 0}<small>L/Ö/A</small></span><span class="hx">+${m.xp} XP${m.rk ? ` · ${m.rk > 0 ? '+' : ''}${m.rk} RP` : ''}</span></div>`;
    }).join('');
  }

  renderStore() {
    const p = this.profile;
    $('storeCoins').textContent = p ? p.coins.toLocaleString('tr-TR') : '—';
    const wid = this.weapon;
    const equipped = this.equippedFor(wid);
    skinPreview($('storePreview'), wid, this.previewSkin !== undefined ? this.previewSkin : equipped);
    const items = [{ id: '', name: 'Varsayılan', rarity: 'common', price: 0 }].concat(C.skinsFor(wid))
      .filter((sk) => {
        if (this.filter === 'all') return true;
        if (this.filter === 'owned') return sk.id === '' || this.owns(sk.id);
        return sk.id !== '' && sk.rarity === this.filter;
      });
    const grid = $('skinGrid');
    grid.innerHTML = '';
    for (const sk of items) {
      const owned = sk.id === '' || this.owns(sk.id);
      const isEq = equipped === sk.id;
      const rar = C.RARITY[sk.rarity];
      const card = document.createElement('div');
      card.className = 'skin-card' + (isEq ? ' eq' : '') + (owned ? ' owned' : '');
      card.style.setProperty('--rar', rar.color);
      const cv = document.createElement('canvas'); cv.width = 180; cv.height = 64;
      card.appendChild(cv);
      skinPreview(cv, wid, sk.id);
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<b>${esc(sk.name)}</b><small style="color:${rar.color}">${sk.id ? rar.label : 'STANDART'}</small>`;
      card.appendChild(meta);
      const btn = document.createElement('button');
      if (isEq) { btn.textContent = 'KUŞANILDI'; btn.disabled = true; }
      else if (owned) { btn.textContent = 'KUŞAN'; btn.className = 'primary'; btn.addEventListener('click', (e) => { e.stopPropagation(); this.equip(wid, sk.id); }); }
      else {
        const can = p && p.coins >= sk.price;
        btn.innerHTML = `◆ ${sk.price.toLocaleString('tr-TR')}`;
        btn.className = can ? 'buy' : 'buy no';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!can) { this.msg(`Yetersiz Blok Coin (${sk.price} gerekli). Maç oynayarak kazanabilirsin!`, false); return; }
          if (confirm(`${S.WEAPONS[wid].name} | "${sk.name}" kaplamasını ${sk.price} Blok Coin'e satın al?`)) this.buy(sk.id, 'skin');
        });
      }
      card.appendChild(btn);
      card.addEventListener('mouseenter', () => { this.previewSkin = sk.id; skinPreview($('storePreview'), wid, sk.id); });
      card.addEventListener('mouseleave', () => { this.previewSkin = undefined; skinPreview($('storePreview'), wid, this.equippedFor(wid)); });
      card.addEventListener('click', () => { this.previewSkin = sk.id; skinPreview($('storePreview'), wid, sk.id); });
      grid.appendChild(card);
    }
    // agent accents
    const ag = $('agentGrid');
    ag.innerHTML = '';
    const curAgent = (p && p.equipped && p.equipped.agent) || 'default';
    for (const a of Object.values(C.AGENTS)) {
      const owned = a.id === 'default' || this.owns('agent:' + a.id);
      const isEq = curAgent === a.id;
      const card = document.createElement('div');
      card.className = 'skin-card agent' + (isEq ? ' eq' : '');
      card.innerHTML = `<div class="swatch" style="background:${a.color ? hex(a.color) : 'linear-gradient(135deg,#e0a040,#6fb6ff)'}"></div><div class="meta"><b>${esc(a.name)}</b><small>${a.price ? '◆ ' + a.price : 'ÜCRETSİZ'}</small></div>`;
      const btn = document.createElement('button');
      if (isEq) { btn.textContent = 'KUŞANILDI'; btn.disabled = true; }
      else if (owned) { btn.textContent = 'KUŞAN'; btn.className = 'primary'; btn.addEventListener('click', () => this.equip('agent', a.id)); }
      else {
        btn.innerHTML = `◆ ${a.price}`; btn.className = 'buy';
        btn.addEventListener('click', () => { if (confirm(`"${a.name}" rozetini ${a.price} Blok Coin'e al?`)) this.buy(a.id, 'agent'); });
      }
      card.appendChild(btn);
      ag.appendChild(card);
    }
  }
}
