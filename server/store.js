'use strict';
/*
 * Account store: persistent player profiles (level, XP, Blok Coin, rank, stats,
 * cosmetics inventory, match history, reports).
 *
 *  - If SUPABASE_URL + SUPABASE_SERVICE_KEY are set → Supabase (PostgREST REST API, no SDK).
 *    The service key stays on the server; tables have RLS enabled with no public policies,
 *    so browsers can never read or write them directly.
 *  - Otherwise → local JSON file (data/accounts.json). Fine for local play / LAN.
 *
 * Accounts need no e-mail/password: an account = friend code (public id) + a random secret
 * token generated on the device. Only sha256(token) is stored. The pair (code-token) is the
 * "account key" players can copy to move their profile to another device.
 *
 * All rewards are computed HERE on the server from authoritative match stats — a client can
 * never grant itself XP, coins or skins.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const C = require('../shared/cosmetics.js');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const CODE_RE = /^[A-Z0-9]{6,8}$/;
const TOKEN_RE = /^[A-Za-z0-9]{16,64}$/;

function emptyStats() {
  return { matches: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0, hs: 0, mvps: 0, dmg: 0, ranked: 0, abandons: 0, bestKills: 0 };
}

function newProfile(code, tokenHash, name) {
  return {
    id: code, token_hash: tokenHash, name: name || 'Oyuncu', xp: 0, level: 1, coins: C.COINS.NEW_ACCOUNT, premium: false,
    rank_points: 1000, stats: emptyStats(), inventory: [], equipped: {}, created_at: new Date().toISOString()
  };
}

/** what we send to the owning client (never the token hash) */
function publicView(p) {
  const lv = C.levelFromXp(p.xp);
  const rank = C.rankOf(p.rank_points);
  return {
    id: p.id, name: p.name, xp: p.xp, level: lv.level, into: lv.into, need: lv.need, coins: p.coins,
    rank_points: p.rank_points, rank: { id: rank.id, name: rank.name, icon: rank.icon, color: rank.color },
    stats: p.stats, inventory: p.inventory, equipped: p.equipped, created_at: p.created_at
  };
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------
class SupabaseBackend {
  constructor(url, key) {
    this.base = url.replace(/\/$/, '') + '/rest/v1';
    this.headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
    this.name = 'supabase';
  }
  async req(method, p, body, extra) {
    const res = await fetch(this.base + p, { method, headers: Object.assign({}, this.headers, extra || {}), body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`supabase ${method} ${p.split('?')[0]} → ${res.status} ${t.slice(0, 200)}`);
    }
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }
  async load(code) {
    const rows = await this.req('GET', `/players?id=eq.${encodeURIComponent(code)}&select=*`);
    return rows && rows[0] ? rows[0] : null;
  }
  async save(p) {
    const row = {
      id: p.id, token_hash: p.token_hash, name: p.name, xp: p.xp, level: C.levelFromXp(p.xp).level, coins: p.coins,
      premium: !!p.premium, rank_points: p.rank_points, stats: p.stats, inventory: p.inventory, equipped: p.equipped,
      updated_at: new Date().toISOString()
    };
    await this.req('POST', '/players?on_conflict=id', row, { Prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  async addMatch(code, data) { await this.req('POST', '/matches', { player_id: code, data }, { Prefer: 'return=minimal' }); }
  async history(code, n) {
    const rows = await this.req('GET', `/matches?player_id=eq.${encodeURIComponent(code)}&select=data,created_at&order=created_at.desc&limit=${n}`);
    return (rows || []).map((r) => Object.assign({ at: r.created_at }, r.data));
  }
  async addReport(r) { await this.req('POST', '/reports', r, { Prefer: 'return=minimal' }); }
  async remove(code) {
    await this.req('DELETE', `/matches?player_id=eq.${encodeURIComponent(code)}`);
    await this.req('DELETE', `/players?id=eq.${encodeURIComponent(code)}`);
  }
}

class FileBackend {
  constructor(file) {
    this.file = file;
    this.name = 'file';
    this.db = { players: {}, matches: {}, reports: [] };
    try { this.db = Object.assign(this.db, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* new file */ }
    this.timer = null;
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.db));
        fs.renameSync(this.file + '.tmp', this.file);
      } catch (e) { console.warn('[store] yazılamadı:', e.message); }
    }, 500);
  }
  async load(code) { const p = this.db.players[code]; return p ? JSON.parse(JSON.stringify(p)) : null; }
  async save(p) { this.db.players[p.id] = JSON.parse(JSON.stringify(p)); this.flush(); }
  async addMatch(code, data) {
    const list = this.db.matches[code] || (this.db.matches[code] = []);
    list.unshift(Object.assign({ at: new Date().toISOString() }, data));
    if (list.length > 30) list.length = 30;
    this.flush();
  }
  async history(code, n) { return (this.db.matches[code] || []).slice(0, n); }
  async addReport(r) { this.db.reports.push(Object.assign({ created_at: new Date().toISOString() }, r)); if (this.db.reports.length > 2000) this.db.reports.shift(); this.flush(); }
  async remove(code) { delete this.db.players[code]; delete this.db.matches[code]; this.flush(); }
}

// ---------------------------------------------------------------------------
// Store (cache + debounced writes in front of a backend)
// ---------------------------------------------------------------------------
class Store {
  constructor(opts) {
    opts = opts || {};
    const url = opts.url !== undefined ? opts.url : process.env.SUPABASE_URL;
    const key = opts.key !== undefined ? opts.key : (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (url && key) this.backend = new SupabaseBackend(url, key);
    else this.backend = new FileBackend(opts.file || path.join(__dirname, '..', 'data', 'accounts.json'));
    this.cache = new Map();     // code -> profile
    this.dirty = new Set();
    this.loading = new Map();   // code -> promise (dedupe concurrent loads)
    this.saveTimer = setInterval(() => this.flushDirty(), opts.flushMs || 4000);
    if (this.saveTimer.unref) this.saveTimer.unref();
    console.log('[store] hesap deposu:', this.backend.name === 'supabase' ? 'Supabase' : 'yerel dosya (SUPABASE_URL ayarlı değil)');
  }

  async get(code) {
    if (this.cache.has(code)) return this.cache.get(code);
    if (this.loading.has(code)) return this.loading.get(code);
    const pr = this.backend.load(code).then((p) => {
      if (p) {
        p.stats = Object.assign(emptyStats(), p.stats || {});
        p.inventory = Array.isArray(p.inventory) ? p.inventory : [];
        p.equipped = p.equipped && typeof p.equipped === 'object' ? p.equipped : {};
        this.cache.set(code, p);
      }
      this.loading.delete(code);
      return p;
    }, (e) => { this.loading.delete(code); throw e; });
    this.loading.set(code, pr);
    return pr;
  }
  touch(p) { this.dirty.add(p.id); }
  async flushDirty() {
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) {
      const p = this.cache.get(id);
      if (!p) continue;
      try { await this.backend.save(p); }
      catch (e) { console.warn('[store] kayıt hatası', id, e.message); this.dirty.add(id); }
    }
    // keep the cache bounded
    if (this.cache.size > 5000) for (const id of [...this.cache.keys()].slice(0, 1000)) if (!this.dirty.has(id)) this.cache.delete(id);
  }

  /** Log in or create. Returns {ok, profile} or {ok:false, err} */
  async auth(code, token, name) {
    code = String(code || '').toUpperCase();
    token = String(token || '');
    if (!CODE_RE.test(code) || !TOKEN_RE.test(token)) return { ok: false, err: 'bad' };
    let p;
    try { p = await this.get(code); }
    catch (e) { console.warn('[store] auth yüklenemedi', e.message); return { ok: false, err: 'db' }; }
    const h = sha(token);
    if (!p) {
      p = newProfile(code, h, name);
      this.cache.set(code, p);
      try { await this.backend.save(p); } catch (e) { console.warn('[store] yeni hesap kaydedilemedi', e.message); this.touch(p); }
      return { ok: true, profile: publicView(p), created: true };
    }
    if (p.token_hash !== h) return { ok: false, err: 'auth' };
    if (name && name !== p.name) { p.name = name; this.touch(p); }
    return { ok: true, profile: publicView(p) };
  }

  /** Synchronous lookup for already-authenticated accounts */
  cached(code) { return this.cache.get(code) || null; }
  view(code) { const p = this.cache.get(code); return p ? publicView(p) : null; }

  buySkin(code, skinId) {
    const p = this.cache.get(code);
    if (!p) return { ok: false, err: 'Giriş yapılmamış' };
    const sk = C.SKINS[skinId];
    if (!sk) return { ok: false, err: 'Bilinmeyen kaplama' };
    if (p.inventory.includes(skinId)) return { ok: false, err: 'Bu kaplama zaten sende' };
    if (p.coins < sk.price) return { ok: false, err: 'Yetersiz Blok Coin' };
    p.coins -= sk.price;
    p.inventory.push(skinId);
    this.touch(p);
    return { ok: true, profile: publicView(p) };
  }
  buyAgent(code, agentId) {
    const p = this.cache.get(code);
    if (!p) return { ok: false, err: 'Giriş yapılmamış' };
    const ag = C.AGENTS[agentId];
    if (!ag) return { ok: false, err: 'Bilinmeyen ajan rozeti' };
    const key = 'agent:' + agentId;
    if (agentId === 'default' || p.inventory.includes(key)) return { ok: false, err: 'Zaten sende' };
    if (p.coins < ag.price) return { ok: false, err: 'Yetersiz Blok Coin' };
    p.coins -= ag.price;
    p.inventory.push(key);
    this.touch(p);
    return { ok: true, profile: publicView(p) };
  }
  /** weaponId = a skinnable weapon id or 'agent'; itemId = skin/agent id or '' to unequip */
  equip(code, weaponId, itemId, WEAPONS) {
    const p = this.cache.get(code);
    if (!p) return { ok: false, err: 'Giriş yapılmamış' };
    if (weaponId === 'agent') {
      if (itemId && itemId !== 'default' && (!C.AGENTS[itemId] || !p.inventory.includes('agent:' + itemId))) return { ok: false, err: 'Bu rozet sende yok' };
      if (!itemId || itemId === 'default') delete p.equipped.agent; else p.equipped.agent = itemId;
    } else {
      if (!WEAPONS[weaponId] || WEAPONS[weaponId].grenade) return { ok: false, err: 'Geçersiz silah' };
      if (itemId && (!C.SKINS[itemId] || !p.inventory.includes(itemId))) return { ok: false, err: 'Bu kaplama sende yok' };
      if (!itemId) delete p.equipped[weaponId]; else p.equipped[weaponId] = itemId;
    }
    this.touch(p);
    return { ok: true, profile: publicView(p) };
  }

  /**
   * Apply the result of one match. m = {result:'win'|'loss'|'draw'|'abandon', mode, ranked, map,
   *   kills, deaths, assists, hs, mvps, dmg, roundsWon, score:[my,their]}
   */
  recordMatch(code, m) {
    const p = this.cache.get(code);
    if (!p) return null;
    const X = C.XP, K = C.COINS;
    let xp = X.PLAYED + m.kills * X.KILL + m.hs * X.HEADSHOT + m.assists * X.ASSIST + m.mvps * X.MVP + (m.roundsWon || 0) * X.ROUND_WIN;
    if (m.result === 'win') xp += X.MATCH_WIN;
    if (m.result === 'abandon') xp = Math.round(xp * X.ABANDON_MUL);
    xp = Math.max(0, Math.round(xp));
    let coins = m.result === 'abandon' ? 0 : Math.min(K.MAX_PER_MATCH, K.BASE + m.kills * K.PER_KILL + (m.result === 'win' ? K.WIN : 0));
    const before = C.levelFromXp(p.xp).level;
    p.xp += xp;
    const after = C.levelFromXp(p.xp).level;
    const levelUps = Math.max(0, after - before);
    coins += levelUps * K.LEVEL_UP;
    p.coins += coins;
    let rankDelta = 0;
    const rankBefore = C.rankOf(p.rank_points).id;
    if (m.ranked) {
      rankDelta = C.rankDelta(m.result, m.kills, m.deaths, m.mvps);
      p.rank_points = Math.max(0, p.rank_points + rankDelta);
      p.stats.ranked++;
    }
    const s = p.stats;
    s.matches++;
    if (m.result === 'win') s.wins++; else if (m.result === 'loss') s.losses++; else if (m.result === 'abandon') s.abandons++;
    s.kills += m.kills; s.deaths += m.deaths; s.assists += m.assists; s.hs += m.hs; s.mvps += m.mvps; s.dmg += m.dmg;
    s.bestKills = Math.max(s.bestKills, m.kills);
    this.touch(p);
    const entry = { r: m.result, mode: m.mode, map: m.map, k: m.kills, d: m.deaths, a: m.assists, hs: m.hs, sc: m.score, xp, coins, rk: rankDelta };
    this.backend.addMatch(code, entry).catch((e) => console.warn('[store] maç geçmişi yazılamadı', e.message));
    return {
      xp, coins, levelUps, level: after, rankDelta, rankUp: C.rankOf(p.rank_points).id !== rankBefore ? C.rankOf(p.rank_points).name : null,
      profile: publicView(p), entry
    };
  }

  async history(code, n) {
    try { return await this.backend.history(code, Math.min(20, n || 10)); }
    catch (e) { console.warn('[store] geçmiş okunamadı', e.message); return []; }
  }

  report(r) {
    const row = {
      reporter: String(r.reporter || '').slice(0, 16), target: String(r.target || '').slice(0, 16), target_name: String(r.targetName || '').slice(0, 24),
      reason: String(r.reason || '').slice(0, 40), room: String(r.room || '').slice(0, 12)
    };
    return this.backend.addReport(row).catch((e) => console.warn('[store] şikayet yazılamadı', e.message));
  }

  /** Store requirement (Google Play / App Store): players can delete their account in-app. */
  async deleteAccount(code, token) {
    const p = await this.get(code).catch(() => null);
    if (!p || p.token_hash !== sha(token)) return { ok: false, err: 'Yetkisiz' };
    this.cache.delete(code); this.dirty.delete(code);
    try { await this.backend.remove(code); } catch (e) { return { ok: false, err: 'Silinemedi, tekrar dene' }; }
    return { ok: true };
  }

  /**
   * Hook for real-money coin packs once store billing is live: call ONLY after the purchase
   * receipt has been validated server-side with Google Play / App Store.
   */
  grantCoins(code, amount, reason) {
    const p = this.cache.get(code);
    if (!p || !(amount > 0)) return false;
    p.coins += Math.floor(amount);
    this.touch(p);
    console.log('[store] coin verildi', code, amount, reason || '');
    return true;
  }

  async close() { clearInterval(this.saveTimer); await this.flushDirty(); }
}

module.exports = { Store, publicView, sha };
