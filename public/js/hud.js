/*
 * DOM HUD: radar, vitals, money, ammo + weapon icon, grenades, round timer & score, killfeed
 * with weapon icons, dynamic crosshair, hit markers, damage direction, flash blindness,
 * buy menu, scoreboard and end-of-match screen.
 */
import { weaponIcon } from './models.js';

const S = window.SHARED;
const { WEAPONS, ITEMS, BUY_LIST } = S;

const $ = (id) => document.getElementById(id);
const PHASE_LABEL = { warmup: 'ISINMA', freeze: 'HAZIRLIK', live: 'RAUNT', post: 'RAUNT SONU', gameover: 'MAÇ BİTTİ' };
const REASON = { elim: 'Tüm düşmanlar etkisiz', bomb: 'Bomba patladı', defuse: 'Bomba imha edildi', time: 'Süre doldu' };
const SPECIAL = { bomb: '💥', fall: '⤓', suicide: '☠' };
const NADE_SHORT = { he: 'HE', flash: 'FLAŞ', smoke: 'SİS', molotov: 'MOLOTOF', breach: 'C4' };
const NADES = S.GRENADE_ORDER;
const SHORT = (id) => (WEAPONS[id] ? WEAPONS[id].name.split(' ')[0].toUpperCase() : id);

export class HUD {
  constructor(game) {
    this.g = game;
    this.cache = {};
    this.buyOpen = false;
    this.sbOpen = false;
    this.roster = [];
    this.bigUntil = 0;
    this.radarCtx = $('radar').getContext('2d');
    this.lastMoney = null;
    this.buildBuyMenu();
    document.querySelectorAll('[data-close="buy"]').forEach((b) => b.addEventListener('click', () => this.g.toggleBuy(false)));
  }

  set(id, value, prop) {
    const key = id + (prop || '');
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    const el = $(id);
    if (!el) return;
    if (prop === 'class') el.className = value;
    else if (prop === 'html') el.innerHTML = value;
    else if (prop === 'src') el.src = value;
    else if (prop === 'width') el.style.width = value;
    else el.textContent = value;
  }
  toggle(id, show) {
    const key = id + '#vis';
    if (this.cache[key] === show) return;
    this.cache[key] = show;
    $(id).classList.toggle('hidden', !show);
  }
  show(on) { $('hud').classList.toggle('hidden', !on); }

  // ---------------------------------------------------------------- per-frame
  update(st) {
    const left = st.phaseEnd ? Math.max(0, (st.phaseEnd - st.serverNow) / 1000) : 0;
    let timerText;
    if (st.bomb && st.bomb.s === 'planted' && st.phase === 'live') timerText = '💣';
    else if (st.phase === 'warmup' && !st.phaseEnd) timerText = '—';
    else timerText = Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0');
    this.set('timer', timerText);
    this.set('timer', left < 10 && st.phase === 'live' ? 'urgent' : '', 'class');
    const M = S.MODES[st.mode] || S.MODES.comp;
    let info = PHASE_LABEL[st.phase] || '';
    if (st.phase === 'warmup') info = st.phaseEnd ? 'MAÇ BAŞLIYOR' : 'OYUNCU BEKLENİYOR';
    else if (M.respawn && st.phase === 'live') info = M.killLimit ? `${M.label} · ${M.killLimit} LEŞ` : `${M.label}`;
    else if (st.round) info = `RAUNT ${st.round}/${M.maxRounds || S.CONFIG.ROUND.MAX_ROUNDS}`;
    this.set('roundInfo', info);
    const showGG = !!M.ladder && st.phase === 'live';
    this.toggle('ggBox', showGG);
    if (showGG) {
      const cur = M.ladder[Math.min(st.gg, M.ladder.length - 1)], nxt = M.ladder[st.gg + 1];
      this.set('ggBox', `<b>SİLAH ${st.gg + 1}/${M.ladder.length}</b><img src="${weaponIcon(cur)}" alt="">${nxt ? `<small>sonraki: ${SHORT(nxt)}</small>` : '<small>SON SİLAH!</small>'}`, 'html');
    }
    this.toggle('protectBar', !!st.protect);
    this.toggle('moneyBox', !!(M.buy || M.freeBuy));
    this.set('scT', String(st.score.T));
    this.set('scCT', String(st.score.CT));
    const pips = (alive, total) => { let h = ''; for (let i = 0; i < total; i++) h += `<i class="${i < alive ? '' : 'dead'}"></i>`; return h; };
    this.set('aliveT', pips(st.aliveT, st.totalT), 'html');
    this.set('aliveCT', pips(st.aliveCT, st.totalCT), 'html');

    const y = st.you;
    if (y) {
      this.set('hp', String(y.hp));
      this.set('hpBar', y.hp + '%', 'width');
      this.set('armor', String(y.ar));
      this.set('arBar', y.ar + '%', 'width');
      this.set('armorIco', y.hm ? '⛑' : '⛨');
      this.set('money', '$' + y.m);
      if (this.lastMoney !== null && y.m !== this.lastMoney && Math.abs(y.m - this.lastMoney) <= 6000) {
        const d = y.m - this.lastMoney, el = $('moneyDelta');
        el.textContent = (d > 0 ? '+$' : '-$') + Math.abs(d);
        el.style.color = d > 0 ? 'var(--money)' : 'var(--bad)';
        el.classList.add('on'); clearTimeout(this._md); this._md = setTimeout(() => el.classList.remove('on'), 1600);
      }
      this.lastMoney = y.m;
      this.toggle('kitIco', !!y.kt && y.a === 1);
      this.toggle('bombIco', st.iCarryBomb);
      const hpLow = y.hp <= 25;
      if (this.cache.hpLow !== hpLow) { this.cache.hpLow = hpLow; $('hp').parentElement.classList.toggle('low', hpLow); }
      // grenades
      const nd = y.nd || [];
      const sel = y.wp[4] ? y.wp[4][0] : null;
      const nadeHtml = NADES.map((n, i) => nd[i] ? `<span class="${st.slot === 4 && sel === n ? 'sel' : ''}">${NADE_SHORT[n]}${nd[i] > 1 ? '×' + nd[i] : ''}</span>` : '').join('');
      this.set('nadeRow', nadeHtml, 'html');
    }
    const w = WEAPONS[st.weaponId] || WEAPONS.knife;
    this.set('weaponName', w.name.toUpperCase());
    this.set('weaponIcon', weaponIcon(w.id), 'src');
    if (w.melee) { this.set('ammoMag', '∞'); this.set('ammoRes', '—'); }
    else if (w.grenade) { this.set('ammoMag', String(st.ammo)); this.set('ammoRes', 'BOMBA'); }
    else { this.set('ammoMag', String(st.ammo)); this.set('ammoRes', String(st.reserve)); }
    this.set('ammo', !w.melee && !w.grenade && st.ammo <= Math.ceil(w.mag * 0.2) ? 'low' : '', 'class');
    const slots = [1, 2, 3, 4].map((s) => {
      const ws = st.slots[s];
      if (!ws) return '';
      const label = s === 4 ? 'BOMBA' : SHORT(ws[0]);
      return `<span class="${s === st.slot ? 'on' : ''}">${s} ${label}</span>`;
    }).join('');
    this.set('slots', slots, 'html');

    const px = Math.round(4 + st.spreadPx);
    if (this.cache.gap !== px) {
      this.cache.gap = px;
      const ch = $('crosshair');
      ch.querySelector('.l').style.left = (-px - 8) + 'px';
      ch.querySelector('.r').style.left = px + 'px';
      ch.querySelector('.u').style.top = (-px - 8) + 'px';
      ch.querySelector('.d').style.top = px + 'px';
    }
    this.toggle('crosshair', !st.scoped && st.showCrosshair);
    $('scope').classList.toggle('on', !!st.scoped);
    this.toggle('buyHint', !!(y && y.cb) && !this.buyOpen);
    this.set('buyHint', M.freeBuy ? '<kbd>B</kbd> SİLAH SEÇ (BEDAVA)' : '<kbd>B</kbd> MARKET', 'html');

    let bs = '';
    if (st.bomb) {
      if (st.bomb.s === 'planted') {
        const t = Math.max(0, (st.bomb.ex - st.serverNow) / 1000);
        bs = `💣 BOMBA ${st.bomb.site} BÖLGESİNDE — ${t.toFixed(1)} sn` + (st.bomb.dp ? ' · İMHA EDİLİYOR' : '');
      } else if (st.bomb.s === 'dropped' && st.myTeam === 'T') bs = '⚠ BOMBA YERDE';
    }
    this.set('bombStatus', bs);

    const pr = $('progress');
    if (st.progress) {
      pr.classList.add('on');
      pr.querySelector('.label').textContent = st.progress.label;
      pr.querySelector('.bar i').style.width = (st.progress.f * 100).toFixed(1) + '%';
    } else pr.classList.remove('on');

    $('flashOverlay').style.opacity = st.flash.toFixed(3);
    this.toggle('specBar', !!st.spec);
    if (st.spec) this.set('specBar', st.spec);
    if (this.bigUntil && performance.now() > this.bigUntil) { this.bigUntil = 0; $('bigMsg').innerHTML = ''; }
    if (this.buyOpen) this.refreshBuy();
  }

  // ---------------------------------------------------------------- radar
  drawRadar(g, mapImg) {
    const ctx = this.radarCtx, W = ctx.canvas.width, H = ctx.canvas.height;
    const scale = 2.6;                     // pixels per block
    const me = g.radarCenter;
    const rot = Math.PI - (g.camYaw || 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(rot);
    if (mapImg) {
      const k = scale / (mapImg.width / g.world.sx);
      ctx.globalAlpha = 0.92;
      ctx.drawImage(mapImg, -me[0] * scale, -(g.world.sz - me[1]) * scale, mapImg.width * k, mapImg.height * k);
      ctx.globalAlpha = 1;
    }
    const toR = (x, z) => [(x - me[0]) * scale, -(z - me[1]) * scale];
    const dot = (x, z, col, r, ring) => {
      const [px, py] = toR(x, z);
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      if (ring) { ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke(); }
    };
    for (const p of g.radarDots) {
      if (p.dead) {
        const [px, py] = toR(p.x, p.z);
        ctx.strokeStyle = p.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px - 3, py - 3); ctx.lineTo(px + 3, py + 3); ctx.moveTo(px + 3, py - 3); ctx.lineTo(px - 3, py + 3); ctx.stroke();
      } else dot(p.x, p.z, p.color, 3.6, true);
    }
    if (g.radarBomb) dot(g.radarBomb[0], g.radarBomb[1], (performance.now() % 600) < 300 ? '#ff3030' : '#ffaaaa', 4.5, true);
    for (const s of g.smokes) { const [px, py] = toR(s.x, s.z); ctx.beginPath(); ctx.arc(px, py, 3.8 * scale, 0, Math.PI * 2); ctx.fillStyle = 'rgba(200,200,200,.45)'; ctx.fill(); }
    ctx.restore();
    // site letters stay upright while the radar rotates
    const map = S.getMap(g.mapId);
    ctx.font = '800 15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const s of ['A', 'B']) {
      const c = S.siteCenter(map, s);
      const dx = (c[0] - me[0]) * scale, dy = -(c[1] - me[1]) * scale;
      const x = W / 2 + dx * Math.cos(rot) - dy * Math.sin(rot), y = H / 2 + dx * Math.sin(rot) + dy * Math.cos(rot);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText(s, x + 1, y + 1);
      ctx.fillStyle = s === 'A' ? '#ff8a7a' : '#8ab8ff'; ctx.fillText(s, x, y);
    }
    // me (always centred, pointing up)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(W / 2, H / 2 - 7); ctx.lineTo(W / 2 - 5, H / 2 + 5); ctx.lineTo(W / 2 + 5, H / 2 + 5); ctx.closePath(); ctx.fill();
  }

  // ---------------------------------------------------------------- events
  killfeed(k, myId) {
    const el = document.createElement('div');
    el.className = 'kf' + (k.k === myId || k.v === myId ? ' mine' : '');
    const killer = k.kn ? `<span class="${k.kt}">${esc(k.kn)}</span>` : '';
    const icon = WEAPONS[k.w] ? `<img src="${weaponIcon(k.w)}" alt="">` : `<span>${SPECIAL[k.w] || k.w}</span>`;
    el.innerHTML = `${killer}${icon}${k.hs ? '<span class="hs">◎</span>' : ''}<span class="${k.vt}">${esc(k.vn)}</span>`;
    const feed = $('killfeed');
    feed.appendChild(el);
    while (feed.children.length > 6) feed.firstChild.remove();
    setTimeout(() => el.remove(), 7000);
  }
  centerMsg(text, ms) {
    const el = document.createElement('div');
    el.textContent = text;
    const c = $('center');
    c.appendChild(el);
    while (c.children.length > 4) c.firstChild.remove();
    setTimeout(() => el.remove(), ms || 3500);
  }
  big(text, sub, cls, ms) {
    const b = $('bigMsg');
    b.className = cls || '';
    b.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
    this.bigUntil = performance.now() + (ms || 3000);
  }
  roundEnd(m) {
    this.big(m.w === 'T' ? 'SALDIRI TAKIMI KAZANDI' : 'SAVUNMA TAKIMI KAZANDI', (REASON[m.r] || '') + (m.mvp ? ` · MVP: ${m.mvp}` : ''), m.w, 4500);
  }
  /** play of the round: clutch / multi-kill card */
  highlight(hl) {
    const el = $('highlight');
    el.className = hl.t || '';
    el.innerHTML = `<small>RAUNDUN ANI</small><b>${esc(hl.txt)}</b><span>${esc(hl.n)}${hl.k ? ` · ${hl.k} leş` : ''}</span>`;
    el.classList.remove('hidden'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(this._hl); this._hl = setTimeout(() => { el.classList.remove('show'); el.classList.add('hidden'); }, 4200);
  }
  hitmarker(head) {
    const h = $('hitmarker');
    h.classList.toggle('hs', !!head);
    h.classList.remove('show'); void h.offsetWidth; h.classList.add('show');
    clearTimeout(this._hm); this._hm = setTimeout(() => h.classList.remove('show'), 80);
  }
  damage(angle) {
    if (angle !== null) {
      const a = document.createElement('div');
      a.className = 'dmgArrow';
      a.style.transform = `rotate(${angle}rad)`;
      $('dmgRing').appendChild(a);
      setTimeout(() => a.remove(), 1500);
    }
    const r = $('redFlash');
    r.classList.add('on');
    clearTimeout(this._rf); this._rf = setTimeout(() => r.classList.remove('on'), 60);
  }
  chat(m) {
    const el = document.createElement('div');
    el.className = m.t + (m.tm ? ' tm' : '');
    el.textContent = `${m.n}: ${m.m}`;
    const log = $('chatLog');
    log.appendChild(el);
    while (log.children.length > 7) log.firstChild.remove();
  }
  stats(text) { $('stats').textContent = text; }
  endScreen(m, show) {
    const el = $('endScreen');
    if (!show) { el.classList.add('hidden'); return; }
    const title = m.w === 'DRAW' ? 'BERABERE' : (m.w === 'T' ? 'SALDIRI' : 'SAVUNMA') + ' TAKIMI MAÇI KAZANDI';
    const M = S.MODES[m.mode] || S.MODES.comp;
    const mine = this.g.myTeam;
    $('endTitle').textContent = (m.w === mine ? '🏆 ZAFER · ' : m.w === 'DRAW' || mine === 'SPEC' ? '' : 'YENİLGİ · ') + title;
    $('endTitle').className = m.w;
    $('endScore').textContent = `${M.icon} ${M.label}   ${m.sc.T}  —  ${m.sc.CT}`;
    $('endHl').innerHTML = m.hl ? `⭐ ${esc(m.hl.txt)}` : '';
    $('endProgress').classList.add('hidden');
    $('endProgress').innerHTML = '';
    const vb = $('voteBox');
    vb.innerHTML = '';
    this.myVote = null;
    for (const [id, name] of m.vote || []) {
      const b = document.createElement('button');
      b.dataset.id = id;
      b.innerHTML = `<b>${esc(name.toUpperCase())}</b><span class="vn">0</span>`;
      b.addEventListener('click', () => {
        this.myVote = id;
        if (this.g.net) this.g.net.emit('vote', id);
        vb.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        this.g.sfx.ui(true);
      });
      vb.appendChild(b);
    }
    const rows = (m.stats || []).slice().sort((a, b) => b.k - a.k || b.dmg - a.dmg).map((p) =>
      `<tr><td>${p.bt ? '🤖 ' : ''}${esc(p.n)}</td><td style="color:var(--${p.t === 'T' ? 't' : 'ct'})">${p.t}</td><td>${p.k}</td><td>${p.a}</td><td>${p.d}</td>` +
      `<td>${(p.k / Math.max(1, p.d)).toFixed(2)}</td><td>${p.dmg}</td><td>${p.k ? Math.round(100 * p.hs / p.k) : 0}%</td><td>${p.mv || 0}</td></tr>`).join('');
    $('endRows').innerHTML = rows;
    $('endNext').textContent = 'En çok oyu alan harita oynanır (eşitlikte ilk seçenek) — ısınma birazdan başlıyor';
    el.classList.remove('hidden');
  }

  voteTally(t) {
    document.querySelectorAll('#voteBox button').forEach((b) => { const n = b.querySelector('.vn'); if (n) n.textContent = t[b.dataset.id] || 0; });
  }

  // ---------------------------------------------------------------- buy menu
  buildBuyMenu() {
    const cols = $('buyCols');
    const cats = [['TABANCA', BUY_LIST.pistols], ['AĞIR', BUY_LIST.heavy], ['SMG', BUY_LIST.smg], ['TÜFEK', BUY_LIST.rifles], ['BOMBA', BUY_LIST.grenades], ['EKİPMAN', BUY_LIST.gear]];
    cols.innerHTML = '';
    for (const [title, list] of cats) {
      const c = document.createElement('div');
      c.className = 'buycat';
      c.innerHTML = `<h3>${title}</h3>`;
      for (const id of list) {
        const it = WEAPONS[id] || ITEMS[id];
        const b = document.createElement('button');
        b.className = 'buyitem';
        b.dataset.id = id;
        const tag = it.team ? ` <small style="color:${it.team === 'T' ? 'var(--t)' : 'var(--ct)'}">${it.team}</small>` : '';
        const img = WEAPONS[id] ? `<img src="${weaponIcon(id)}" alt="">` : `<img alt="" style="visibility:hidden">`;
        b.innerHTML = `${img}<span class="nm">${it.name}${tag}</span><span class="p">$${it.price}</span>`;
        b.addEventListener('click', () => this.g.buy(id));
        c.appendChild(b);
      }
      cols.appendChild(c);
    }
  }
  refreshBuy() {
    const y = this.g.you;
    if (!y) return;
    this.set('buyMoney', '$' + y.m);
    const nd = y.nd || [];
    const nadeIdx = Object.fromEntries(NADES.map((n, i) => [n, i]));
    const free = !!(S.MODES[this.g.mode] || {}).freeBuy;
    document.querySelectorAll('.buyitem').forEach((b) => {
      const id = b.dataset.id;
      const it = WEAPONS[id] || ITEMS[id];
      let price = it.price;
      if (id === 'helmet' && y.ar >= 100 && !y.hm) price = 350;
      if (free) price = 0;
      const wrongTeam = it.team && it.team !== y.tm;
      let owned = false;
      if (WEAPONS[id] && WEAPONS[id].grenade) owned = nd[nadeIdx[id]] >= S.CONFIG.GRENADE.MAX[id];
      else if (WEAPONS[id]) owned = !!(y.wp[it.slot] && y.wp[it.slot][0] === id);
      else if (id === 'kevlar') owned = y.ar >= 100;
      else if (id === 'helmet') owned = y.ar >= 100 && !!y.hm;
      else if (id === 'defuse') owned = !!y.kt;
      b.classList.toggle('no', wrongTeam || y.m < price || !y.cb);
      b.classList.toggle('owned', owned);
      const p = b.querySelector('.p');
      const label = free ? 'BEDAVA' : '$' + price;
      if (p.textContent !== label) p.textContent = label;
    });
    if (!y.cb) this.set('buyMsg', 'Satın alma bölgesi/süresi dışındasın');
  }
  buyResult(r) {
    this.set('buyMsg', r.msg);
    $('buyMsg').style.color = r.ok ? 'var(--ok)' : 'var(--bad)';
  }
  setBuyOpen(open) {
    this.buyOpen = open;
    $('buyMenu').classList.toggle('hidden', !open);
    if (open) { this.set('buyMsg', ''); this.refreshBuy(); }
  }

  // ---------------------------------------------------------------- scoreboard
  setRoster(r) { this.roster = r; if (this.sbOpen) this.renderScoreboard(); }
  setScoreboard(open) {
    this.sbOpen = open;
    $('scoreboard').classList.toggle('hidden', !open);
    if (open) this.renderScoreboard();
  }
  renderScoreboard() {
    const g = this.g;
    const myTeam = g.you ? g.you.tm : 'SPEC';
    const row = (p) => {
      const showMoney = p.t === myTeam;
      const wicon = p.wp && WEAPONS[p.wp] && p.t === myTeam ? `<img src="${weaponIcon(p.wp)}" alt="">` : '';
      const armor = p.ar === 2 ? '⛑' : p.ar === 1 ? '⛨' : '';
      const rk = p.rk ? (window.COSMETICS.RANKS.find((r) => r.id === p.rk) || {}).icon || '' : '';
      const lv = p.lv ? `<small class="lvchip">${p.lv}</small>` : '';
      const ggc = p.gg !== undefined ? ` <small class="lvchip">🔫${p.gg + 1}</small>` : '';
      return `<tr class="${p.i === g.myId ? 'me' : ''} ${p.al ? '' : 'dead'}"><td>${p.bt ? '🤖 ' : ''}${rk}${lv}${esc(p.n)}${ggc}</td><td>${armor} ${wicon}</td><td>${showMoney ? '$' + p.m : ''}</td><td>${p.k}</td><td>${p.a}</td><td>${p.d}</td><td>${p.mv || 0}</td><td>${p.bt ? 'BOT' : p.pg}</td></tr>`;
    };
    const sort = (a, b) => b.k - a.k || a.d - b.d;
    $('sbT').innerHTML = this.roster.filter((p) => p.t === 'T').sort(sort).map(row).join('');
    $('sbCT').innerHTML = this.roster.filter((p) => p.t === 'CT').sort(sort).map(row).join('');
    $('sbScT').textContent = g.score ? g.score.T : 0;
    $('sbScCT').textContent = g.score ? g.score.CT : 0;
    const spec = this.roster.filter((p) => p.t === 'SPEC').map((p) => esc(p.n));
    $('sbSpec').textContent = spec.length ? 'İzleyiciler: ' + spec.join(', ') : '';
    $('sbRoom').textContent = `Oda ${g.roomId || ''} · ${(S.MODES[g.mode] || S.MODES.comp).label} · ${S.getMap(g.mapId).name} · ${(S.DIFFICULTY[g.difficulty] || {}).label || ''}`;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
