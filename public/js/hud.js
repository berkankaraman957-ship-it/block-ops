/*
 * DOM HUD: health/armor/money/ammo, round timer & score, killfeed, crosshair (dynamic spread),
 * hit markers, damage direction indicators, buy menu (economy), scoreboard, progress bars.
 */
const S = window.SHARED;
const { WEAPONS, ITEMS, BUY_LIST } = S;

const $ = (id) => document.getElementById(id);
const PHASE_LABEL = { warmup: 'ISINMA', freeze: 'HAZIRLIK', live: 'RAUNT', post: 'RAUNT SONU', gameover: 'MAÇ BİTTİ' };
const REASON = {
  elim: 'Tüm düşmanlar etkisiz', bomb: 'Bomba patladı', defuse: 'Bomba imha edildi', time: 'Süre doldu'
};
const WEAPON_SHORT = { knife: 'BIÇAK', p9: 'P-9', p12: 'P-12', hc50: 'HC-50', viper: 'VIPER', krait: 'KRAIT', sentinel: 'SENTINEL', longshot: 'LONGSHOT', bomb: '💥 BOMBA', fall: 'DÜŞME', suicide: '☠' };

export class HUD {
  constructor(game) {
    this.g = game;
    this.cache = {};
    this.buyOpen = false;
    this.sbOpen = false;
    this.roster = [];
    this.bigUntil = 0;
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
    // st: {phase, phaseEnd, serverNow, round, score, you, ammo, reserve, weaponId, slots, spread, bomb, alive counts, ...}
    const left = st.phaseEnd ? Math.max(0, (st.phaseEnd - st.serverNow) / 1000) : 0;
    let timerText;
    if (st.bomb && st.bomb.s === 'planted' && st.phase === 'live') timerText = '💣';
    else if (st.phase === 'warmup' && !st.phaseEnd) timerText = '—';
    else timerText = Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0');
    this.set('timer', timerText);
    this.set('timer', left < 10 && st.phase === 'live' ? 'urgent' : '', 'class');
    let info = PHASE_LABEL[st.phase] || '';
    if (st.phase === 'warmup') info = st.phaseEnd ? 'MAÇ BAŞLIYOR' : 'OYUNCU BEKLENİYOR';
    else if (st.round) info += ' ' + st.round + '/' + S.CONFIG.ROUND.MAX_ROUNDS;
    this.set('roundInfo', info);
    this.set('scT', String(st.score.T));
    this.set('scCT', String(st.score.CT));
    this.set('aliveT', '● '.repeat(st.aliveT).trim());
    this.set('aliveCT', '● '.repeat(st.aliveCT).trim());

    const y = st.you;
    if (y) {
      this.set('hp', String(y.hp));
      this.set('armor', String(y.ar));
      this.set('armorIco', y.hm ? '⛑' : '⛨');
      this.set('money', '$' + y.m);
      this.toggle('kitIco', !!y.kt && y.a === 1);
      this.toggle('bombIco', st.iCarryBomb);
      $('hp').parentElement.classList.toggle('low', y.hp <= 25);
    }
    const w = WEAPONS[st.weaponId] || WEAPONS.knife;
    this.set('weaponName', w.name.toUpperCase());
    if (w.melee) { this.set('ammoMag', '∞'); this.set('ammoRes', '—'); }
    else { this.set('ammoMag', String(st.ammo)); this.set('ammoRes', String(st.reserve)); }
    this.set('ammo', !w.melee && st.ammo <= Math.ceil(w.mag * 0.2) ? 'low' : '', 'class');
    const slots = [1, 2, 3].map((s) => {
      const ws = st.slots[s];
      return ws ? `<span class="${s === st.slot ? 'on' : ''}">${s} ${WEAPON_SHORT[ws[0]] || ws[0]}</span>` : '';
    }).join('');
    this.set('slots', slots, 'html');

    // crosshair gap from spread (degrees → pixels)
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

    // bomb status
    let bs = '';
    if (st.bomb) {
      if (st.bomb.s === 'planted') {
        const t = Math.max(0, (st.bomb.ex - st.serverNow) / 1000);
        bs = `💣 BOMBA ${st.bomb.site} BÖLGESİNE KURULDU — ${t.toFixed(1)} sn`;
        if (st.bomb.dp) bs += ' · İMHA EDİLİYOR';
      } else if (st.bomb.s === 'dropped' && st.myTeam === 'T') bs = '⚠ BOMBA YERDE';
    }
    this.set('bombStatus', bs);

    // progress (plant / defuse)
    const pr = $('progress');
    if (st.progress) {
      pr.classList.add('on');
      this.set('progLabel', st.progress.label);
      pr.querySelector('.label').textContent = st.progress.label;
      pr.querySelector('.bar i').style.width = (st.progress.f * 100).toFixed(1) + '%';
    } else pr.classList.remove('on');

    // spectator bar
    this.toggle('specBar', !!st.spec);
    if (st.spec) this.set('specBar', st.spec);

    if (this.bigUntil && performance.now() > this.bigUntil) { this.bigUntil = 0; $('bigMsg').innerHTML = ''; }
    if (this.buyOpen) this.refreshBuy();
  }

  // ---------------------------------------------------------------- events
  killfeed(k, myId) {
    const el = document.createElement('div');
    el.className = 'kf' + (k.k === myId || k.v === myId ? ' mine' : '');
    const killer = k.kn ? `<span class="${k.kt}">${esc(k.kn)}</span>` : '';
    el.innerHTML = `${killer}<span class="w">${WEAPON_SHORT[k.w] || k.w}${k.hs ? ' <span class="hs">◎</span>' : ''}</span><span class="${k.vt}">${esc(k.vn)}</span>`;
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
  roundEnd(m, myTeam) {
    const name = m.w === 'T' ? 'SALDIRI TAKIMI KAZANDI' : 'SAVUNMA TAKIMI KAZANDI';
    this.big(name, (REASON[m.r] || '') + (m.mvp ? ` · MVP: ${m.mvp}` : ''), m.w, 4500);
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
    el.className = m.t;
    el.textContent = `${m.n}: ${m.m}`;
    const log = $('chatLog');
    log.appendChild(el);
    while (log.children.length > 7) log.firstChild.remove();
  }
  stats(text) { $('stats').textContent = text; }

  // ---------------------------------------------------------------- buy menu
  buildBuyMenu() {
    const cols = $('buyCols');
    const cats = [['TABANCALAR', BUY_LIST.pistols], ['HAFİF MAKİNELİ', BUY_LIST.smg], ['TÜFEKLER', BUY_LIST.rifles], ['EKİPMAN', BUY_LIST.gear]];
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
        b.innerHTML = `<span>${it.name}${tag}</span><span class="p">$${it.price}</span>`;
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
    const team = y.tm;
    document.querySelectorAll('.buyitem').forEach((b) => {
      const id = b.dataset.id;
      const it = WEAPONS[id] || ITEMS[id];
      let price = it.price;
      if (id === 'helmet' && y.ar >= 100 && !y.hm) price = 350;
      const wrongTeam = it.team && it.team !== team;
      let owned = false;
      if (WEAPONS[id]) owned = !!(y.wp[it.slot] && y.wp[it.slot][0] === id);
      else if (id === 'kevlar') owned = y.ar >= 100;
      else if (id === 'helmet') owned = y.ar >= 100 && !!y.hm;
      else if (id === 'defuse') owned = !!y.kt;
      b.classList.toggle('no', wrongTeam || y.m < price || !y.cb);
      b.classList.toggle('owned', owned);
      b.querySelector('.p').textContent = '$' + price;
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
      return `<tr class="${p.i === g.myId ? 'me' : ''} ${p.al ? '' : 'dead'}"><td>${p.bt ? '🤖 ' : ''}${esc(p.n)}</td><td>${showMoney ? '$' + p.m : ''}</td><td>${p.k}</td><td>${p.a}</td><td>${p.d}</td><td>${p.mv || 0}</td><td>${p.bt ? 'BOT' : p.pg}</td></tr>`;
    };
    const sort = (a, b) => b.k - a.k || a.d - b.d;
    $('sbT').innerHTML = this.roster.filter((p) => p.t === 'T').sort(sort).map(row).join('');
    $('sbCT').innerHTML = this.roster.filter((p) => p.t === 'CT').sort(sort).map(row).join('');
    $('sbScT').textContent = g.score ? g.score.T : 0;
    $('sbScCT').textContent = g.score ? g.score.CT : 0;
    const spec = this.roster.filter((p) => p.t === 'SPEC').map((p) => esc(p.n));
    $('sbSpec').textContent = spec.length ? 'İzleyiciler: ' + spec.join(', ') : '';
    $('sbRoom').textContent = 'Oda: ' + (g.roomId || '') + ' · Harita: ' + S.MAP.name;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
