/*
 * BLOCK OPS: TACTICAL DRIFT — client entry.
 * Fixed-step client-side prediction + server reconciliation, entity interpolation,
 * lag-compensated shooting (sends render time), recoil-driven camera, spectating,
 * menus and the full render pipeline.
 */
import { Renderer, BoxBatch, M4, Node } from './engine.js';
import { WorldRenderer } from './world.js';
import { ViewModel } from './viewmodel.js';
import { Avatar, buildBomb, buildGun } from './models.js';
import { Effects } from './effects.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Net } from './net.js';

const S = window.SHARED;
const { CONFIG, WEAPONS, BTN } = S;
const STEP = 1 / CONFIG.INPUT_RATE;
const $ = (id) => document.getElementById(id);

const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
if (isTouch) document.body.classList.add('touch');

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
const DEFAULTS = { name: '', room: '', bots: '9', server: '', sens: 1, tsens: 1, fov: 82, vol: 0.7, quality: 'auto', map: 'dustgrid', difficulty: 'medium', showFps: false };
function loadSettings() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('blockops.settings') || '{}')); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function saveSettings(s) { try { localStorage.setItem('blockops.settings', JSON.stringify(s)); } catch (e) { /* storage unavailable */ } }

// ---------------------------------------------------------------------------
// GAME
// ---------------------------------------------------------------------------
class Game {
  constructor() {
    this.settings = loadSettings();
    this.canvas = $('game');
    const q = this.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    // Render resolution: "auto" starts at a sane cap and adapts to the measured frame time.
    this.maxRatio = q === 'low' ? Math.min(dpr, 0.75) : q === 'medium' ? Math.min(dpr, 1.0) : q === 'high' ? Math.min(dpr, 2) : Math.min(dpr, isTouch ? 1.15 : 1.25);
    this.minRatio = q === 'auto' ? 0.5 : this.maxRatio;
    this.renderer = new Renderer(this.canvas, { antialias: q === 'high', pixelRatio: this.maxRatio });
    this.frameTimes = []; this.lastScaleCheck = performance.now();
    this.detectGpu();
    this.opaque = new BoxBatch(this.renderer, 2048);
    this.alphaBatch = new BoxBatch(this.renderer, 512);
    this.addBatch = new BoxBatch(this.renderer, 512);
    this.vmBatch = new BoxBatch(this.renderer, 256);
    this.vmAdd = new BoxBatch(this.renderer, 32);

    this.world = new S.VoxelWorld();
    this.worldR = new WorldRenderer(this.renderer, this.world);
    this.fx = new Effects(this.world);
    this.vm = new ViewModel();
    this.sfx = new Sfx();
    this.sfx.setVolume(this.settings.vol);
    this.input = new Input(this.canvas, $('touch'), isTouch);
    this.input.sens = this.settings.sens;
    this.input.touchSens = this.settings.tsens;
    this.hud = new HUD(this);
    this.net = null;
    this.nadeModels = { he: buildGun('he'), flash: buildGun('flash'), smoke: buildGun('smoke') };
    this.mapThumbs = {};
    this.loadWorld(S.MAPS[this.settings.map] ? this.settings.map : S.MAP_ORDER[0]);

    this.proj = M4.create(); this.view = M4.create(); this.vp = M4.create();
    this.camWorld = M4.create();
    this.bomb = buildBomb();
    this.clouds = this.makeClouds();
    this.tagEls = new Map();

    this.resetState();
    this.bindUI();
    this.bindInput();
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 200));
    this.last = performance.now();
    this.fpsAcc = 0; this.fpsFrames = 0; this.fps = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  resetState() {
    this.inGame = false;
    this.myId = null; this.myNum = 0; this.roomId = '';
    this.me = { x: 32.5, y: 1, z: 32.5, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false };
    this.smooth = [0, 0, 0];
    this.yaw = 0; this.pitch = 0;
    this.seq = 0; this.pending = []; this.sendBuf = []; this.lastSend = 0;
    this.accum = 0;
    this.you = null; this.myTeam = 'SPEC'; this.alive = false;
    this.phase = 'warmup'; this.phaseEnd = 0; this.round = 0; this.score = { T: 0, CT: 0 }; this.bombState = { s: 'none' };
    this.remotes = new Map();
    this.slot = 2; this.lastSwitchLocal = -1e9; this.drawUntil = 0; this.prevSlot = 3;
    this.reloadUntil = 0; this.reloadReqAt = -1e9;
    this.shotSeq = 0; this.lastFireLocal = -1e9; this.recoilIdx = 0; this.unacked = [];
    this.triggerHeld = false; this.dryClick = false;
    this.recoilView = [0, 0]; this.punch = [0, 0];
    this.scoped = 0;
    this.eyeH = CONFIG.PLAYER.EYE;
    this.stepDist = 0;
    this.specIdx = 0; this.specTarget = null; this.deathTime = 0; this.deathPos = null; this.killerId = null;
    this.lastBeep = 0;
    this.menuCam = 0;
    this.showStats = false;
    this.paused = false;
    this.chatOpen = false;
    this.nadesView = new Map();
    this.smokes = [];
    this.flashUntil = 0; this.flashDur = 1;
    this.interpDelay = CONFIG.INTERP_DELAY_MS; this.snapJitter = 0; this.lastSnapAt = 0;
    this.radarDots = []; this.radarBomb = null; this.radarCenter = [32, 32]; this.lastRadar = 0;
    this.seenEnemy = new Map();
    this.difficulty = this.settings ? this.settings.difficulty : 'medium';
    if (this.fx) { this.fx.particles = []; this.fx.decals = []; this.fx.tracers = []; }
  }

  makeClouds() {
    const rng = S.mulberry32(42);
    const out = [];
    for (let i = 0; i < 22; i++) out.push({ x: rng() * 200 - 70, y: 48 + rng() * 8, z: rng() * 200 - 70, sx: 8 + rng() * 14, sz: 6 + rng() * 10 });
    return out;
  }

  /**
   * Detect software rendering (browser hardware acceleration off / no GPU driver).
   * That is the #1 cause of extreme lag: the game is then drawn by the CPU at 1-10 FPS.
   */
  detectGpu() {
    const gl = this.renderer.gl;
    let name = '';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch (e) { name = ''; }
    this.gpuName = String(name || 'bilinmiyor');
    this.softwareGpu = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(this.gpuName);
    if (this.softwareGpu) {
      // keep it playable as much as possible
      this.maxRatio = 0.6; this.minRatio = 0.45;
      this.renderer.setPixelRatio(0.6);
      const w = $('gpuWarn');
      w.classList.remove('hidden');
      w.innerHTML = '⚠ <b>Ekran kartı kullanılmıyor</b> — oyun işlemcide çiziliyor, bu yüzden çok kasar.<br>' +
        'Chrome/Edge: <b>Ayarlar → Sistem → "Mümkün olduğunda grafik hızlandırmayı kullan"</b> seçeneğini AÇ ve tarayıcıyı yeniden başlat.<br>' +
        '<small>Algılanan: ' + this.gpuName.replace(/[<>&]/g, '') + '</small>';
    }
  }

  // -------------------------------------------------------------------------
  // WORLD / MAP LOADING
  // -------------------------------------------------------------------------
  loadWorld(mapId) {
    this.mapId = mapId;
    const map = S.getMap(mapId);
    S.generateMap(this.world, mapId);
    this.renderer.setTheme(map.theme);
    if (this.settings.quality === 'low') this.renderer.fog = [map.theme.fog[0] * 0.7, map.theme.fog[1] * 0.7];
    this.worldR.markAll();
    this.radarImg = WorldRenderer.topDownCanvas(this.world, map, 4, true);
    if (this.fx) { this.fx.particles = []; this.fx.decals = []; this.fx.tracers = []; }
    const rm = $('radarMap'); if (rm) rm.textContent = map.name.toUpperCase();
  }

  buildMenu() {
    const cards = $('mapCards');
    cards.innerHTML = '';
    const tmp = new S.VoxelWorld();
    for (const id of S.MAP_ORDER) {
      const m = S.getMap(id);
      S.generateMap(tmp, id);
      const card = document.createElement('div');
      card.className = 'map-card' + (id === this.settings.map ? ' on' : '');
      const thumb = WorldRenderer.topDownCanvas(tmp, m, 3);
      const cv = document.createElement('canvas');
      cv.width = 192; cv.height = 120;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(thumb, 0, (thumb.height - thumb.width * 120 / 192) / 2, thumb.width, thumb.width * 120 / 192, 0, 0, 192, 120);
      card.appendChild(cv);
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<div class="name">${m.name.toUpperCase()}</div><div class="desc">${m.desc}</div>`;
      card.appendChild(meta);
      card.addEventListener('click', () => {
        this.settings.map = id; saveSettings(this.settings);
        cards.querySelectorAll('.map-card').forEach((c) => c.classList.remove('on'));
        card.classList.add('on');
        if (!this.inGame) this.loadWorld(id);
      });
      cards.appendChild(card);
    }
    const db = $('diffBtns');
    db.innerHTML = '';
    for (const id of ['easy', 'medium', 'hard']) {
      const d = S.DIFFICULTY[id];
      const b = document.createElement('button');
      b.className = id + (id === this.settings.difficulty ? ' on' : '');
      b.textContent = d.label;
      b.addEventListener('click', () => {
        this.settings.difficulty = id; saveSettings(this.settings);
        db.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        $('diffDesc').textContent = d.desc;
      });
      db.appendChild(b);
    }
    $('diffDesc').textContent = (S.DIFFICULTY[this.settings.difficulty] || S.DIFFICULTY.medium).desc;
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
      document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === t.dataset.tab));
    }));
    $('verText').textContent = 'v' + CONFIG.VERSION + ' · ' + S.MAP_ORDER.length + ' harita · ' + Object.keys(WEAPONS).length + ' silah/bomba';
  }

  // -------------------------------------------------------------------------
  // UI BINDINGS
  // -------------------------------------------------------------------------
  bindUI() {
    this.buildMenu();
    const s = this.settings;
    $('inName').value = s.name || ('Oyuncu' + Math.floor(Math.random() * 900 + 100));
    $('inRoom').value = s.room || '';
    $('inBots').value = s.bots;
    $('inServer').value = s.server || (window.BLOCKOPS_CONFIG && window.BLOCKOPS_CONFIG.serverUrl) || '';
    const bindRange = (id, lbl, key, fmt, apply) => {
      const el = $(id);
      el.value = s[key];
      const upd = () => { s[key] = parseFloat(el.value); $(lbl).textContent = fmt(s[key]); apply && apply(s[key]); saveSettings(s); };
      el.addEventListener('input', upd); upd();
    };
    bindRange('inSens', 'sensVal', 'sens', (v) => v.toFixed(2), (v) => { this.input.sens = v; $('inSens2').value = v; $('sensVal2').textContent = v.toFixed(2); });
    bindRange('inSens2', 'sensVal2', 'sens', (v) => v.toFixed(2), (v) => { this.input.sens = v; $('inSens').value = v; $('sensVal').textContent = v.toFixed(2); });
    bindRange('inTSens', 'tsensVal', 'tsens', (v) => v.toFixed(2), (v) => { this.input.touchSens = v; });
    bindRange('inFov', 'fovVal', 'fov', (v) => v + '°');
    bindRange('inVol', 'volVal', 'vol', (v) => Math.round(v * 100) + '%', (v) => { this.sfx.setVolume(v); $('inVol2').value = v; $('volVal2').textContent = Math.round(v * 100) + '%'; });
    bindRange('inVol2', 'volVal2', 'vol', (v) => Math.round(v * 100) + '%', (v) => { this.sfx.setVolume(v); $('inVol').value = v; $('volVal').textContent = Math.round(v * 100) + '%'; });
    $('inQuality').value = s.quality;
    $('inQuality').addEventListener('change', () => { s.quality = $('inQuality').value; saveSettings(s); location.reload(); });
    $('inShowFps').checked = !!s.showFps;
    this.showStats = !!s.showFps; $('stats').classList.toggle('hidden', !this.showStats);
    $('inShowFps').addEventListener('change', () => { s.showFps = $('inShowFps').checked; saveSettings(s); this.showStats = s.showFps; $('stats').classList.toggle('hidden', !this.showStats); });

    $('btnQuick').addEventListener('click', () => this.start(''));
    $('btnJoin').addEventListener('click', () => {
      const code = $('inRoom').value.trim().toUpperCase() || Math.random().toString(36).slice(2, 7).toUpperCase();
      $('inRoom').value = code;
      this.start(code);
    });
    $('btnResume').addEventListener('click', () => this.setPaused(false));
    $('btnTeamT').addEventListener('click', () => { this.net.emit('team', 'T'); this.setPaused(false); });
    $('btnTeamCT').addEventListener('click', () => { this.net.emit('team', 'CT'); this.setPaused(false); });
    $('btnSpec').addEventListener('click', () => { this.net.emit('team', 'SPEC'); this.setPaused(false); });
    $('btnBotT').addEventListener('click', () => this.net.emit('addBot', 'T'));
    $('btnBotCT').addEventListener('click', () => this.net.emit('addBot', 'CT'));
    $('btnKick').addEventListener('click', () => this.net.emit('kickBots'));
    $('btnLeave').addEventListener('click', () => this.leave());
    $('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = e.target.value.trim();
        if (v && this.net) this.net.emit('chat', v);
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
      e.stopPropagation();
    });
  }

  bindInput() {
    const I = this.input;
    const unlockAudio = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('touchstart', unlockAudio, { passive: true });

    I.on('reload', () => this.requestReload());
    I.on('slot1', () => this.switchTo(1));
    I.on('slot2', () => this.switchTo(2));
    I.on('slot3', () => this.switchTo(3));
    I.on('slot4', () => this.switchTo(4));
    I.on('lastWeapon', () => this.switchTo(this.prevSlot));
    I.on('nextWeapon', () => this.cycleWeapon(1));
    I.on('prevWeapon', () => this.cycleWeapon(-1));
    I.on('scope', () => this.toggleScope());
    I.on('buy', () => this.toggleBuy());
    I.on('scoreboard', (on) => { if (this.inGame) this.hud.setScoreboard(on); });
    I.on('teamMenu', () => { if (this.inGame) this.setPaused(true); });
    I.on('stats', () => { this.showStats = !this.showStats; $('stats').classList.toggle('hidden', !this.showStats); });
    I.on('chat', () => { if (this.inGame && !this.chatOpen) this.openChat(); });
    I.on('nextSpec', () => this.nextSpectate());
    I.on('escape', () => {
      if (!this.inGame) return;
      if (this.hud.buyOpen) { this.toggleBuy(false); return; }
      if (this.chatOpen) { this.closeChat(); return; }
      if (isTouch) this.setPaused(!this.paused);
    });
    I.on('lockchange', (locked) => {
      if (!this.inGame || isTouch) return;
      if (!locked && !this.hud.buyOpen && !this.chatOpen) this.setPaused(true);
      if (locked) this.setPaused(false, true);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.inGame && !this.alive && e.button === 0 && I.locked) this.nextSpectate();
    });
  }

  setPaused(p, fromLock) {
    this.paused = p;
    $('pause').classList.toggle('hidden', !p);
    $('pauseRoom').textContent = 'Oda kodu: ' + this.roomId;
    this.updateInputEnabled();
    if (!p && !fromLock && !isTouch) this.input.requestLock();
  }
  updateInputEnabled() {
    this.input.enabled = this.inGame && !this.paused && !this.hud.buyOpen && !this.chatOpen;
    $('touch').classList.toggle('ingame', this.inGame && !this.paused && !this.hud.buyOpen);
  }
  openChat() {
    this.chatOpen = true;
    this.input.releaseLock();
    const c = $('chatInput');
    c.classList.remove('hidden'); c.value = ''; c.focus();
    this.updateInputEnabled();
  }
  closeChat() {
    this.chatOpen = false;
    const c = $('chatInput');
    c.blur(); c.classList.add('hidden');
    this.updateInputEnabled();
    if (!isTouch) this.input.requestLock();
  }
  toggleBuy(force) {
    if (!this.inGame) return;
    const open = force === undefined ? !this.hud.buyOpen : force;
    if (open && !(this.you && this.you.cb)) { this.hud.centerMsg('Şu an satın alma yapamazsın (bölge/süre)', 2000); return; }
    this.hud.setBuyOpen(open);
    if (open) this.input.releaseLock();
    else if (!isTouch) this.input.requestLock();
    this.updateInputEnabled();
  }
  buy(id) { if (this.net) this.net.emit('buy', id); }

  // -------------------------------------------------------------------------
  // CONNECT / JOIN / LEAVE
  // -------------------------------------------------------------------------
  async start(roomCode) {
    const s = this.settings;
    s.name = $('inName').value.trim().slice(0, 16);
    s.room = roomCode;
    s.bots = $('inBots').value;
    s.server = $('inServer').value.trim();
    saveSettings(s);
    this.sfx.unlock();
    $('menuErr').textContent = '';
    $('loading').classList.remove('hidden');
    $('loadingText').textContent = 'Sunucuya bağlanılıyor...';
    try {
      this.net = new Net();
      const url = s.server || (location.protocol.startsWith('http') ? location.origin : '');
      await this.net.connect(url);
      this.bindNet();
      $('loadingText').textContent = 'Odaya katılınıyor...';
      const res = await this.net.join({ name: s.name, room: roomCode, bots: parseInt(s.bots, 10) || 0, map: s.map, difficulty: s.difficulty });
      this.onJoined(res);
    } catch (err) {
      $('menuErr').textContent = err.message || String(err);
      if (this.net) this.net.close();
      this.net = null;
    } finally {
      $('loading').classList.add('hidden');
    }
  }

  onJoined(res) {
    this.resetState();
    this.myId = res.id; this.myNum = res.num; this.roomId = res.room;
    this.difficulty = res.difficulty || 'medium';
    this.loadWorld(res.map);
    for (const [x, y, z, t] of res.blocks) this.world.set(x, y, z, t);
    this.worldR.markAll();
    this.hud.setRoster(res.roster || []);
    this.net.startSync();
    this.inGame = true;
    $('menu').classList.add('hidden');
    this.hud.show(true);
    this.updateInputEnabled();
    if (!isTouch) this.input.requestLock();
    this.hud.centerMsg(`${S.getMap(this.mapId).name} · ${(S.DIFFICULTY[this.difficulty] || {}).label} · Oda kodu: ${this.roomId} — arkadaşlarını davet et!`, 7000);
    if (isTouch && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }

  leave() {
    if (this.net) this.net.close();
    this.net = null;
    this.input.releaseLock();
    this.resetState();
    $('pause').classList.add('hidden');
    this.hud.setBuyOpen(false);
    this.hud.setScoreboard(false);
    this.hud.show(false);
    $('menu').classList.remove('hidden');
    for (const el of this.tagEls.values()) el.remove();
    this.tagEls.clear();
    this.hud.endScreen(null, false);
    this.loadWorld(S.MAPS[this.settings.map] ? this.settings.map : S.MAP_ORDER[0]);
    this.updateInputEnabled();
  }

  bindNet() {
    const n = this.net;
    n.on('snap', (m) => this.onSnap(m));
    n.on('shot', (m) => this.onRemoteShot(m));
    n.on('hitc', (m) => { this.hud.hitmarker(m.hs); this.sfx.hit(m.hs); if (m.k) this.sfx.kill(); });
    n.on('dmg', (m) => {
      let ang = null;
      if (m.f) {
        const a = Math.atan2(-(m.f[0] - this.me.x), -(m.f[1] - this.me.z));
        ang = -S.wrapAngle(a - this.yaw);
      }
      this.hud.damage(ang);
      this.sfx.hurt();
      this.punch[1] -= Math.min(4, m.d * 0.06) * S.DEG;
      this.punch[0] += (Math.random() - 0.5) * 2 * S.DEG;
    });
    n.on('kill', (k) => {
      this.hud.killfeed(k, this.myId);
      if (k.v === this.myId) { this.deathTime = performance.now(); this.deathPos = [this.me.x, this.me.y, this.me.z]; this.killerId = k.k; this.scoped = 0; }
      const r = this.remotes.get(k.v);
      if (r) r.deadAt = performance.now();
    });
    n.on('blocks', (list) => {
      for (const [x, y, z, t, old] of list) {
        this.world.set(x, y, z, t);
        this.worldR.markBlock(x, y, z);
        if (t === 0 && old) this.fx.blockBreak(x, y, z, old);
      }
    });
    n.on('wreset', (m) => {
      const mapId = m && m.map ? m.map : this.mapId;
      if (mapId !== this.mapId) { this.loadWorld(mapId); this.hud.big(S.getMap(mapId).name.toUpperCase(), 'Yeni harita · ısınma', '', 4000); this.hud.endScreen(null, false); }
      else { S.generateMap(this.world, mapId); this.worldR.markAll(); this.fx.clearDecals(); }
      this.nadesView.clear(); this.smokes = [];
    });
    n.on('throw', (m) => {
      const r = this.remotes.get(m.i);
      if (r && r.state) { r.avatar.recoil = 1.5; this.sfx.throwNade([r.state.x, r.state.y + 1.5, r.state.z]); }
    });
    n.on('nadeb', (m) => this.sfx.nadeBounce([m.x, m.y, m.z]));
    n.on('nade', (m) => {
      const pos = [m.x, m.y, m.z];
      if (m.e === 'he') { this.fx.heBlast(m.x, m.y, m.z); this.sfx.heBlast(pos); }
      else if (m.e === 'flash') { this.fx.flashBurst(m.x, m.y, m.z); this.sfx.flashBang(pos, 0); }
      else if (m.e === 'smoke') this.sfx.smokeHiss(pos);
      this.nadesView.delete(m.id);
    });
    n.on('flashed', (m) => {
      this.flashUntil = performance.now() + m.d;
      this.flashDur = m.d;
      this.sfx.flashBang(null, Math.min(3, m.d / 1000));
    });
    n.on('rstart', (m) => {
      this.hud.big('RAUNT ' + m.rd, 'Hazırlık süresi — [B] ile market', '', 2600);
      this.sfx.roundStart();
      if (m.carrier === this.myId) this.hud.centerMsg('💣 Bomba sende! Bir bölgeye (A/B) git ve E tuşuna basılı tut.', 6000);
      this.unacked = []; this.recoilIdx = 0;
    });
    n.on('live', () => { this.hud.centerMsg('GİT GİT GİT!', 1500); if (this.hud.buyOpen && !(this.you && this.you.cb)) this.toggleBuy(false); });
    n.on('rend', (m) => { this.hud.roundEnd(m, this.myTeam); this.sfx.roundEnd(m.w === this.myTeam); });
    n.on('half', () => this.hud.big('DEVRE ARASI', 'Takımlar taraf değiştiriyor', '', 4000));
    n.on('over', (m) => {
      this.hud.endScreen(m, true);
      this.sfx.roundEnd(m.w === this.myTeam);
      setTimeout(() => this.hud.endScreen(null, false), (CONFIG.ROUND.GAMEOVER - 0.5) * 1000);
    });
    n.on('bomb', (m) => this.onBombEvent(m));
    n.on('buyr', (r) => { this.hud.buyResult(r); this.sfx.ui(r.ok); });
    n.on('msg', (m) => this.hud.centerMsg(m.text, 4000));
    n.on('chat', (m) => this.hud.chat(m));
    n.on('disconnect', () => {
      if (!this.inGame) return;
      this.leave();
      $('menuErr').textContent = 'Sunucu bağlantısı koptu.';
    });
  }

  onBombEvent(m) {
    const pos = m.x !== undefined ? [m.x, m.y + 0.3, m.z] : null;
    switch (m.e) {
      case 'planted': this.hud.big('BOMBA KURULDU', `${m.site} bölgesi · ${m.by}`, 'T', 3000); this.sfx.beep(pos, true); break;
      case 'defused': this.hud.big('BOMBA İMHA EDİLDİ', m.by, 'CT', 3000); break;
      case 'exploded': this.fx.explosion(m.x, m.y, m.z); this.sfx.explosion(pos); break;
      case 'dropped': if (this.myTeam === 'T') this.hud.centerMsg(`💣 ${m.by} bombayı düşürdü!`, 3000); break;
      case 'picked': if (this.myTeam === 'T') this.hud.centerMsg(`💣 ${m.by} bombayı aldı`, 2500); break;
      case 'defusing': this.hud.centerMsg(`${m.by} bombayı imha ediyor${m.kit ? ' (kitli)' : ''}...`, 2500); break;
    }
  }

  // -------------------------------------------------------------------------
  // SNAPSHOT + RECONCILIATION
  // -------------------------------------------------------------------------
  onSnap(m) {
    const arrival = performance.now();
    if (this.lastSnapAt) {
      const gap = arrival - this.lastSnapAt;
      this.snapJitter = this.snapJitter * 0.9 + Math.abs(gap - 1000 / CONFIG.TICK_RATE) * 0.1;
      const target = S.clamp(1000 / CONFIG.TICK_RATE * 2 + this.snapJitter * 3, 70, 260);
      this.interpDelay += (target - this.interpDelay) * 0.05;
    }
    this.lastSnapAt = arrival;
    // grenades in flight
    const liveIds = new Set();
    if (m.g) for (const [id, ty, x, y, z] of m.g) {
      liveIds.add(id);
      let v = this.nadesView.get(id);
      if (!v) { v = { ty, buf: [] }; this.nadesView.set(id, v); }
      v.buf.push({ t: m.t, x, y, z });
      if (v.buf.length > 8) v.buf.shift();
    }
    for (const id of [...this.nadesView.keys()]) if (!liveIds.has(id)) this.nadesView.delete(id);
    this.smokes = m.sm ? m.sm.map(([id, x, y, z, t0]) => ({ id, x, y, z, t0 })) : [];
    this.phase = m.ph; this.phaseEnd = m.pe; this.round = m.rd; this.score = m.sc; this.bombState = m.b;
    if (m.r) this.hud.setRoster(m.r);
    const y = m.y;
    const prevTeam = this.myTeam;
    this.you = y;
    this.myTeam = y.tm;
    if (prevTeam !== y.tm) this.vm.setTeam(y.tm === 'CT' ? 'CT' : 'T');
    const wasAlive = this.alive;
    this.alive = y.a === 1;

    // --- weapons
    const now = performance.now();
    if (y.sl !== this.slot && now - this.lastSwitchLocal > 450) {
      this.prevSlot = this.slot;
      this.slot = y.sl;
    }
    const ws = y.wp[this.slot];
    if (!ws) { this.slot = y.sl; }
    const curId = this.curWeaponId();
    if (this.vm.weaponId !== curId) { this.vm.setWeapon(curId); this.drawUntil = now + y.dr; this.scoped = 0; }
    this.unacked = this.unacked.filter((u) => u.seq > y.ss && now - u.t < 500);
    if (y.rl > 0 && !(this.reloadUntil > now)) {
      const w = WEAPONS[curId];
      this.reloadUntil = now + y.rl;
      this.vm.reloadStart = this.vm.time - (w.reload - y.rl / 1000);
      this.vm.reloadDur = w.reload;
    } else if (y.rl === 0 && this.reloadUntil > now && now - this.reloadReqAt > 400) {
      this.reloadUntil = 0; this.vm.cancelReload();
    }
    if (y.sc === 0 && this.scoped && now - (this.scopeAt || 0) > 400) this.scoped = 0;

    // --- movement reconciliation
    if (y.fs || !wasAlive && this.alive) {
      this.me = { x: y.x, y: y.y, z: y.z, vx: y.vx, vy: y.vy, vz: y.vz, onGround: !!y.og, crouch: !!y.c };
      if (y.fs) { this.yaw = y.yw; this.pitch = y.pt; }
      this.pending = this.pending.filter((i) => i.s > y.s);
      this.smooth = [0, 0, 0];
      this.recoilView = [0, 0];
    } else if (this.alive) {
      this.pending = this.pending.filter((i) => i.s > y.s);
      const before = [this.me.x, this.me.y, this.me.z];
      const st = { x: y.x, y: y.y, z: y.z, vx: y.vx, vy: y.vy, vz: y.vz, onGround: !!y.og, crouch: !!y.c };
      const opts = this.moveOpts();
      for (const inp of this.pending) S.stepPlayer(st, { mx: inp.x, mz: inp.z, yaw: inp.y, b: inp.b }, STEP, this.world, opts);
      const err = [before[0] - st.x, before[1] - st.y, before[2] - st.z];
      const el = Math.hypot(err[0], err[1], err[2]);
      if (el > 2) this.smooth = [0, 0, 0];
      else if (el > 0.001) { this.smooth[0] += err[0]; this.smooth[1] += err[1]; this.smooth[2] += err[2]; }
      this.me = st;
    } else {
      this.pending = [];
      this.me.x = y.x; this.me.y = y.y; this.me.z = y.z;
    }

    // --- remote entities
    const seen = new Set();
    for (const p of m.p) {
      if (p.i === this.myId) { this.myPub = p; continue; }
      seen.add(p.i);
      let r = this.remotes.get(p.i);
      if (!r) { r = { buf: [], avatar: new Avatar(p.t), team: p.t, stepT: 0, deadAt: 0 }; this.remotes.set(p.i, r); }
      if (r.team !== p.t) { r.avatar = new Avatar(p.t); r.team = p.t; }
      r.buf.push({ t: m.t, x: p.x, y: p.y, z: p.z, yw: p.yw, pt: p.pt, c: p.c, a: p.a, g: p.g, vx: p.vx, vz: p.vz, w: p.w, rl: p.rl, pl: p.pl || p.df });
      while (r.buf.length > 2 && r.buf[1].t < m.t - 1000) r.buf.shift();
    }
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.remotes.delete(id);
  }

  moveOpts() {
    const usingUse = !!(this.input.buttons() & BTN.USE);
    const busy = usingUse && ((this.you && this.you.pl > 0) || (this.myPub && this.myPub.df));
    return { speedMul: S.weaponSpeedMul(this.curWeaponId(), this.scoped > 0), frozen: this.phase === 'freeze' || this.phase === 'gameover' || busy };
  }

  // -------------------------------------------------------------------------
  // WEAPONS (client side prediction of actions)
  // -------------------------------------------------------------------------
  curWeaponId() { const ws = this.you && this.you.wp[this.slot]; return ws && WEAPONS[ws[0]] ? ws[0] : 'knife'; }
  ammoDisplay() {
    const ws = this.you && this.you.wp[this.slot];
    if (!ws) return [0, 0];
    if (this.slot === 4) return [ws[1], 0];
    return [Math.max(0, ws[1] - this.unacked.length), ws[2]];
  }
  switchTo(slot) {
    if (!this.inGame || !this.alive || !this.you) return;
    if (!this.you.wp[slot]) return;
    if (slot === this.slot) {
      if (slot === 4) { this.net.emit('switch', 4); this.sfx.draw(); }   // cycle grenade type
      return;
    }
    this.prevSlot = this.slot;
    this.slot = slot;
    this.lastSwitchLocal = performance.now();
    const id = this.you.wp[slot][0];
    this.vm.setWeapon(id);
    this.drawUntil = performance.now() + WEAPONS[id].drawTime * 1000;
    this.reloadUntil = 0;
    this.scoped = 0;
    this.recoilIdx = 0;
    this.sfx.draw();
    this.net.emit('switch', slot);
  }
  cycleWeapon(dir) {
    if (!this.you) return;
    const order = [1, 2, 3, 4];
    let i = order.indexOf(this.slot);
    for (let k = 0; k < 4; k++) {
      i = (i + dir + 4) % 4;
      if (this.you.wp[order[i]]) { this.switchTo(order[i]); return; }
    }
  }
  requestReload() {
    if (!this.inGame || !this.alive || !this.you) return;
    const id = this.curWeaponId(), w = WEAPONS[id];
    const [ammo, res] = this.ammoDisplay();
    const now = performance.now();
    if (w.melee || ammo >= w.mag || res <= 0 || this.reloadUntil > now || now < this.drawUntil) return;
    this.reloadUntil = now + w.reload * 1000;
    this.reloadReqAt = now;
    this.scoped = 0;
    this.vm.startReload(w.reload);
    this.sfx.reload(this.vm.kind);
    this.net.emit('reload');
  }
  toggleScope() {
    if (!this.inGame || !this.alive) return;
    const w = WEAPONS[this.curWeaponId()];
    if (w.grenade) { this.throwGrenade(performance.now(), true); return; }
    if (!w.scope || this.reloadUntil > performance.now()) return;
    this.scoped = (this.scoped + 1) % (w.scope.length + 1);
    this.scopeAt = performance.now();
    this.net.emit('scope', this.scoped);
  }

  handleFire(now) {
    if (!this.alive || !this.you) { this.triggerHeld = false; return; }
    const firing = this.input.firing();
    if (!firing) { this.triggerHeld = false; this.dryClick = false; return; }
    const id = this.curWeaponId(), w = WEAPONS[id];
    if (!w.auto && this.triggerHeld) return;
    if (!['live', 'warmup', 'post'].includes(this.phase)) return;
    if (w.grenade) { this.triggerHeld = true; this.throwGrenade(now, false); return; }
    if (now < this.drawUntil || this.reloadUntil > now) return;
    const [ammo] = this.ammoDisplay();
    if (!w.melee && ammo <= 0) {
      if (!this.dryClick) { this.sfx.dryFire(); this.dryClick = true; this.requestReload(); }
      this.triggerHeld = true;
      return;
    }
    if (now - this.lastFireLocal < 60000 / w.rpm) return;
    this.triggerHeld = true;
    this.fireShot(now, w);
  }

  throwGrenade(now, lob) {
    if (!this.alive || now < this.drawUntil || now - this.lastFireLocal < 700) return;
    if (!['live', 'warmup', 'post'].includes(this.phase)) return;
    const seq = ++this.shotSeq;
    this.net.emit('shoot', { seq, yaw: +this.yaw.toFixed(5), pitch: +this.pitch.toFixed(5), t: Math.round(this.net.serverNow()), lob: lob ? 1 : 0 });
    this.lastFireLocal = now;
    this.vm.throwNade();
    this.sfx.throwNade(null);
    this.drawUntil = now + 700;
  }

  fireShot(now, w) {
    const idx = S.recoilIndexAt(this.recoilIdx, now - this.lastFireLocal, w);
    const speed = Math.hypot(this.me.vx, this.me.vz);
    const spread = S.getSpread(w, speed, this.me.onGround, this.me.crouch, this.scoped > 0);
    const recoil = w.melee ? [0, 0] : S.getRecoil(w, idx);
    const seq = ++this.shotSeq;
    const dirs = S.shotDirections(w, this.yaw, this.pitch, recoil, spread, this.myNum, seq);
    const renderT = this.net.serverNow() - this.interpDelay;
    this.net.emit('shoot', { seq, yaw: +this.yaw.toFixed(5), pitch: +this.pitch.toFixed(5), ri: +idx.toFixed(3), t: Math.round(renderT) });
    this.recoilIdx = idx + 1;
    this.lastFireLocal = now;
    if (!w.melee) this.unacked.push({ seq, t: now });
    this.vm.fire(w);
    this.sfx.shot(w.id, null);
    if (!w.melee) {
      this.punch[1] += w.kick * 0.35 * S.DEG;
      this.punch[0] += (Math.random() - 0.5) * w.kick * 0.3 * S.DEG;
    }
    // local impact prediction (every pellet)
    const eye = [this.me.x, this.me.y + this.eyeH, this.me.z];
    const mz = this.cameraPoint(0.17, -0.11, -0.75);
    for (const dir of dirs) {
      const hit = this.world.raycast(eye, dir, w.range);
      let end = hit ? [eye[0] + dir[0] * hit.t, eye[1] + dir[1] * hit.t, eye[2] + dir[2] * hit.t] : [eye[0] + dir[0] * w.range, eye[1] + dir[1] * w.range, eye[2] + dir[2] * w.range];
      const renderPlayerHit = this.predictPlayerHit(eye, dir, hit ? hit.t : w.range);
      if (renderPlayerHit) { end = renderPlayerHit.point; this.fx.blood(end, dir); }
      else if (hit) this.fx.impact(end, hit.normal, hit.type);
      if (!w.melee && (w.pellets <= 1 || Math.random() < 0.5)) this.fx.tracer(mz, end);
    }
    if (w.id === 'breacher') this.sfx.pump();
    if (!w.melee) {
      this.fx.light(mz[0], mz[1], mz[2], 1.6, [1, 0.75, 0.4], 30);
      const right = this.cameraDir(1, 0, 0), up = this.cameraDir(0, 1, 0), fwd = this.cameraDir(0, 0, -1);
      if (w.id !== 'longshot') this.fx.shell(this.cameraPoint(0.14, -0.08, -0.35), right, up, fwd);
      this.fx.muzzleSmoke(mz);
    }
    if (w.scope && this.scoped) this.scoped = 0;
  }

  predictPlayerHit(eye, dir, maxT) {
    let best = null;
    for (const r of this.remotes.values()) {
      if (!r.state || !r.state.alive || r.team === this.myTeam) continue;
      const s = r.state;
      for (const hb of S.getHitboxes(s.x, s.y, s.z, s.crouch)) {
        const t = S.rayAABB(eye, dir, hb.min, hb.max);
        if (t >= 0 && t < maxT && (!best || t < best.t)) best = { t, point: [eye[0] + dir[0] * t, eye[1] + dir[1] * t, eye[2] + dir[2] * t] };
      }
    }
    return best;
  }

  cameraPoint(x, y, z) { return M4.transformPoint(this.camWorld, x, y, z).slice(0, 3); }
  cameraDir(x, y, z) {
    const m = this.camWorld;
    return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
  }

  onRemoteShot(m) {
    if (m.i === this.myId) return;
    const r = this.remotes.get(m.i);
    let origin = m.o;
    if (r && r.avatar) {
      r.avatar.recoil = 1;
      const mz = r.avatar.muzzleWorld();
      if (mz && Math.hypot(mz[0] - m.o[0], mz[2] - m.o[2]) < 2) origin = mz;
    }
    const w = WEAPONS[m.w];
    const ends = Array.isArray(m.e[0]) ? m.e : [m.e];
    if (w && !w.melee) this.fx.light(origin[0], origin[1], origin[2], 1.4, [1, 0.75, 0.4], 30);
    ends.forEach((e, i) => {
      if (w && !w.melee && (ends.length === 1 || i % 2 === 0)) this.fx.tracer(origin, e, [1, 0.8, 0.45]);
      if (m.hp) {
        const d = [e[0] - m.o[0], e[1] - m.o[1], e[2] - m.o[2]];
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        if (i === 0) this.fx.blood(e, [d[0] / l, d[1] / l, d[2] / l]);
      } else if (m.n && i < 3) this.fx.impact(e, m.n, m.bt);
    });
    if (r && r.state) this.seenEnemy.set(m.i, performance.now());
    this.sfx.shot(m.w, origin);
  }

  // -------------------------------------------------------------------------
  // SPECTATING
  // -------------------------------------------------------------------------
  spectateCandidates() {
    const list = [];
    for (const [id, r] of this.remotes) if (r.state && r.state.alive && (this.myTeam === 'SPEC' || r.team === this.myTeam)) list.push(id);
    if (!list.length) for (const [id, r] of this.remotes) if (r.state && r.state.alive) list.push(id);
    return list;
  }
  nextSpectate() {
    const list = this.spectateCandidates();
    if (!list.length) { this.specTarget = null; return; }
    this.specIdx = (this.specIdx + 1) % list.length;
    this.specTarget = list[this.specIdx];
  }

  // -------------------------------------------------------------------------
  // MAIN LOOP
  // -------------------------------------------------------------------------
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.1, Math.max(0.0005, (t - this.last) / 1000));
    this.last = t;
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) { this.fps = Math.round(this.fpsFrames / this.fpsAcc); this.fpsAcc = 0; this.fpsFrames = 0; }
    try {
      if (this.inGame) this.updateGame(dt, t); else this.updateMenu(dt);
      this.render(dt);
    } catch (err) {
      console.error(err);
      if (!this._errShown) { this._errShown = true; this.hud.centerMsg('Hata: ' + err.message, 8000); }
    }
  }

  updateMenu(dt) {
    this.adaptResolution(dt);
    this.menuCam += dt * 0.06;
    const r = 30;
    this.camPos = [32 + Math.cos(this.menuCam) * r, 18, 32 + Math.sin(this.menuCam) * r];
    const d = [32 - this.camPos[0], 2 - this.camPos[1], 32 - this.camPos[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    const a = S.dirToAngles([d[0] / l, d[1] / l, d[2] / l]);
    this.camYaw = a.yaw; this.camPitch = a.pitch; this.camRoll = 0;
    this.fov = 70;
    this.worldR.update(16, 12);
    this.fx.update(dt);
  }

  adaptResolution(dt) {
    if (this.minRatio >= this.maxRatio) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    const now = performance.now();
    if (now - this.lastScaleCheck < 1500 || this.frameTimes.length < 60) return;
    this.lastScaleCheck = now;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)] * 1000;
    let r = this.renderer.pixelRatio;
    if (p80 > 19) r = Math.max(this.minRatio, r * 0.85);
    else if (p80 < 13 && r < this.maxRatio) r = Math.min(this.maxRatio, r * 1.08);
    if (Math.abs(r - this.renderer.pixelRatio) > 0.01) { this.renderer.setPixelRatio(r); this.frameTimes.length = 0; }
  }

  updateGame(dt, nowMs) {
    this.adaptResolution(dt);
    const now = performance.now();
    const I = this.input;
    // --- look
    const [ldx, ldy] = I.consumeLook();
    const w = WEAPONS[this.curWeaponId()];
    const baseFov = this.settings.fov;
    const fov = this.scoped && w.scope ? w.scope[this.scoped - 1] : baseFov;
    const sensScale = Math.tan(fov * S.DEG / 2) / Math.tan(baseFov * S.DEG / 2);
    const k = 0.0022 * sensScale;
    this.yaw = S.wrapAngle(this.yaw - ldx * k);
    this.pitch = S.clamp(this.pitch - ldy * k, -1.55, 1.55);

    // --- fixed-step prediction
    this.accum += dt;
    let steps = 0;
    while (this.accum >= STEP && steps < 8) {
      this.accum -= STEP; steps++;
      this.simStep();
    }
    if (steps >= 8) this.accum = 0;
    if (this.sendBuf.length && (now - this.lastSend > 30 || this.sendBuf.length >= 3)) {
      this.net.emit('input', this.sendBuf);
      this.sendBuf = [];
      this.lastSend = now;
    }
    // smoothing offset decay
    const decay = Math.exp(-dt * 12);
    this.smooth[0] *= decay; this.smooth[1] *= decay; this.smooth[2] *= decay;

    this.handleFire(now);

    // --- recoil camera
    let target = [0, 0];
    if (!w.melee && !w.grenade) target = S.getRecoil(w, S.recoilIndexAt(this.recoilIdx, now - this.lastFireLocal, w));
    const rk = 1 - Math.exp(-dt * 35);
    this.recoilView[0] += (target[0] - this.recoilView[0]) * rk;
    this.recoilView[1] += (target[1] - this.recoilView[1]) * rk;
    const pk = Math.exp(-dt * 10);
    this.punch[0] *= pk; this.punch[1] *= pk;

    // --- remote interpolation
    const serverNow = this.net.serverNow();
    const renderT = serverNow - this.interpDelay;
    this.renderT = renderT;
    for (const [id, r] of this.remotes) this.updateRemote(r, renderT, dt, id);

    // --- camera
    const eyeTarget = this.me.crouch ? CONFIG.PLAYER.CROUCH_EYE : CONFIG.PLAYER.EYE;
    this.eyeH += (eyeTarget - this.eyeH) * (1 - Math.exp(-dt * 14));
    let spec = null;
    const shake = this.fx.shake;
    const sh = [(Math.random() - 0.5) * shake * 0.03, (Math.random() - 0.5) * shake * 0.03];
    if (this.alive) {
      this.camPos = [this.me.x + this.smooth[0], this.me.y + this.smooth[1] + this.eyeH, this.me.z + this.smooth[2]];
      this.camYaw = this.yaw - this.recoilView[0] * S.DEG + this.punch[0] + sh[0];
      this.camPitch = this.pitch + this.recoilView[1] * S.DEG + this.punch[1] + sh[1];
      this.camRoll = 0;
      this.specTarget = null;
    } else {
      const sinceDeath = now - this.deathTime;
      if (this.deathPos && sinceDeath < 2200 && this.myTeam !== 'SPEC') {
        const f = Math.min(1, sinceDeath / 600);
        this.camPos = [this.deathPos[0], this.deathPos[1] + CONFIG.PLAYER.EYE - f * 1.2, this.deathPos[2]];
        const killer = this.killerId && this.remotes.get(this.killerId);
        if (killer && killer.state) {
          const d = [killer.state.x - this.camPos[0], killer.state.y + 1.4 - this.camPos[1], killer.state.z - this.camPos[2]];
          const l = Math.hypot(d[0], d[1], d[2]) || 1;
          const a = S.dirToAngles([d[0] / l, d[1] / l, d[2] / l]);
          this.yaw = S.lerpAngle(this.yaw, a.yaw, 1 - Math.exp(-dt * 4));
          this.pitch += (a.pitch - this.pitch) * (1 - Math.exp(-dt * 4));
        }
        this.camYaw = this.yaw; this.camPitch = this.pitch; this.camRoll = f * 0.4;
        spec = 'Öldün';
      } else {
        const list = this.spectateCandidates();
        if (!this.specTarget || !list.includes(this.specTarget)) { this.specTarget = list[0] || null; this.specIdx = 0; }
        const r = this.specTarget && this.remotes.get(this.specTarget);
        if (r && r.state) {
          const s = r.state;
          this.camPos = [s.x, s.y + (s.crouch ? CONFIG.PLAYER.CROUCH_EYE : CONFIG.PLAYER.EYE), s.z];
          this.camYaw = s.yaw; this.camPitch = s.pitch; this.camRoll = 0;
          const name = (this.hud.roster.find((p) => p.i === this.specTarget) || {}).n || '';
          spec = `İZLENİYOR: ${name} · ${isTouch ? 'ekrana dokun' : 'Sol tık / N'} = sonraki`;
          if (this.vm.weaponId !== s.w) this.vm.setWeapon(s.w, true);
        } else {
          // free overview camera
          this.camPos = [32, 20, 4];
          this.camYaw = Math.PI; this.camPitch = -0.45; this.camRoll = 0;
          spec = this.myTeam === 'SPEC' ? 'İZLEYİCİ — [M] takım seç' : 'Bir sonraki raunt bekleniyor';
        }
      }
      if (this.phase === 'warmup' && this.myTeam !== 'SPEC') spec = (spec || '') + ' · Isınmada yeniden doğacaksın';
    }
    this.fov = this.alive ? fov : 78;
    this.worldR.focus = this.camPos;
    this.worldR.update(16, isTouch ? 3 : 5);
    this.fx.update(dt);

    // --- view model
    const speed = Math.hypot(this.me.vx, this.me.vz);
    const runSpeed = CONFIG.MOVE.RUN_SPEED * w.speedMul;
    this.vm.update(dt, {
      speedFrac: this.alive ? Math.min(1.2, speed / runSpeed) : 0, onGround: this.me.onGround, crouch: this.me.crouch,
      lookDX: I.frameDX, lookDY: I.frameDY, vy: this.me.vy, scoped: this.alive ? this.scoped > 0 : false
    });

    // --- bomb beeps
    const b = this.bombState;
    if (b && b.s === 'planted') {
      const left = (b.ex - serverNow) / 1000;
      const interval = S.clamp(0.12 + (left / CONFIG.BOMB.TIMER) * 0.9, 0.12, 1.0) * 1000;
      if (now - this.lastBeep > interval && left > 0) { this.lastBeep = now; this.sfx.beep([b.x, b.y + 0.3, b.z], left < 10); }
    }

    // --- audio listener
    this.sfx.setListener(this.camPos, S.anglesToDir(this.camYaw, 0));

    // --- HUD
    const [ammo, reserve] = this.ammoDisplay();
    const spreadDeg = this.alive ? S.getSpread(w, speed, this.me.onGround, this.me.crouch, this.scoped > 0) : 0;
    const recoilSpread = w.melee || w.grenade ? 0 : S.recoilIndexAt(this.recoilIdx, now - this.lastFireLocal, w) * 0.15;
    const pxPerDeg = this.canvas.clientHeight / fov;
    let aliveT = 0, aliveCT = 0, totalT = 0, totalCT = 0;
    for (const r of this.remotes.values()) {
      if (r.team === 'T') totalT++; else totalCT++;
      if (r.state && r.state.alive) { if (r.team === 'T') aliveT++; else aliveCT++; }
    }
    if (this.myTeam === 'T') totalT++; else if (this.myTeam === 'CT') totalCT++;
    if (this.alive) { if (this.myTeam === 'T') aliveT++; else if (this.myTeam === 'CT') aliveCT++; }
    // flash blindness (full white, then fades out over the last 60%)
    const flashLeft = this.flashUntil - now;
    const flash = flashLeft > 0 ? Math.min(1, flashLeft / (this.flashDur * 0.6)) : 0;
    // radar (20 Hz)
    if (now - this.lastRadar > 50) { this.lastRadar = now; this.updateRadar(now); }
    let progress = null;
    if (this.you && this.you.pl > 0) progress = { label: 'BOMBA KURULUYOR...', f: this.you.pl };
    else if (b && b.dp && this.myPub && this.myPub.df) progress = { label: 'BOMBA İMHA EDİLİYOR...', f: b.dp };
    this.hud.update({
      phase: this.phase, phaseEnd: this.phaseEnd, serverNow, round: this.round, score: this.score, you: this.you,
      ammo, reserve, weaponId: this.curWeaponId(), slots: this.you ? this.you.wp : {}, slot: this.slot,
      spreadPx: Math.min(60, (spreadDeg + recoilSpread) * pxPerDeg), scoped: this.alive && this.scoped > 0,
      showCrosshair: this.alive, bomb: b, myTeam: this.myTeam,
      iCarryBomb: !!(b && b.s === 'carried' && b.c === this.myId), aliveT, aliveCT, totalT, totalCT, progress, flash,
      spec: this.alive ? null : spec
    });
    if (this.fps && this.fps < 25 && this.phase !== 'gameover') {
      this.lowFpsTime = (this.lowFpsTime || 0) + dt;
      if (this.lowFpsTime > 6 && !this.lowFpsWarned) {
        this.lowFpsWarned = true;
        this.hud.centerMsg(this.softwareGpu ? '⚠ Ekran kartı kapalı: tarayıcı ayarlarından donanım hızlandırmayı aç' : `⚠ Düşük FPS (${this.fps}). Menü → Ayarlar → Kalite: Düşük deneyebilirsin`, 9000);
      }
    } else this.lowFpsTime = 0;
    if (this.showStats) {
      this.hud.stats(`GPU ${this.gpuName.slice(0, 48)}\nFPS ${this.fps}  ping ${Math.round(this.net.rtt)} ms  interp ${Math.round(this.interpDelay)} ms\nçözünürlük x${this.renderer.pixelRatio.toFixed(2)}  draws ${this.renderer.stats.draws}  inst ${this.renderer.stats.instances}\nüçgen ${Math.round(this.renderer.stats.tris)}  pos ${this.me.x.toFixed(1)} ${this.me.z.toFixed(1)}`);
    }
  }

  updateRadar(now) {
    const dots = [];
    const eye = this.camPos || [32, 2, 32];
    this.radarCenter = this.alive ? [this.me.x, this.me.z] : [eye[0], eye[2]];
    for (const [id, r] of this.remotes) {
      if (!r.state) continue;
      const s = r.state;
      const friendly = r.team === this.myTeam || this.myTeam === 'SPEC';
      let show = friendly;
      if (!friendly && s.alive) {
        // enemies appear when you (or the server-told shot) can see them
        const visible = S.lineClear(this.world, eye, [s.x, s.y + 1.4, s.z]) && !S.smokeBlocks(this.smokes, eye, [s.x, s.y + 1.4, s.z], this.net.serverNow());
        if (visible) this.seenEnemy.set(id, now);
        show = now - (this.seenEnemy.get(id) || -1e9) < 1500;
      }
      if (!show) continue;
      dots.push({ x: s.x, z: s.z, color: r.team === 'T' ? '#f0a640' : '#5fb0ff', dead: !s.alive });
    }
    this.radarDots = dots;
    const b = this.bombState;
    this.radarBomb = null;
    if (b && (b.s === 'planted' || (b.s === 'dropped' && this.myTeam === 'T'))) this.radarBomb = [b.x, b.z];
    else if (b && b.s === 'carried' && this.myTeam === 'T') {
      const r = this.remotes.get(b.c);
      if (r && r.state) this.radarBomb = [r.state.x, r.state.z];
      else if (b.c === this.myId) this.radarBomb = [this.me.x, this.me.z];
    }
    this.hud.drawRadar(this, this.radarImg);
  }

  simStep() {
    const mv = this.input.move();
    const b = this.input.buttons();
    const inp = { s: ++this.seq, x: mv.mx, z: mv.mz, y: +this.yaw.toFixed(4), p: +this.pitch.toFixed(4), b };
    this.sendBuf.push(inp);
    if (!this.alive || (this.myTeam !== 'T' && this.myTeam !== 'CT')) return;
    this.pending.push(inp);
    if (this.pending.length > 240) this.pending.shift();
    const wasGround = this.me.onGround;
    const ev = S.stepPlayer(this.me, { mx: inp.x, mz: inp.z, yaw: inp.y, b }, STEP, this.world, this.moveOpts());
    if (ev.landSpeed > 4 && !wasGround) { this.vm.landed(ev.landSpeed); this.sfx.land(Math.min(0.5, ev.landSpeed * 0.04)); }
    if (ev.jumped) this.sfx.footstep(null, 0.25);
    // footsteps (silent while walking/crouching like CS)
    const sp = Math.hypot(this.me.vx, this.me.vz);
    if (this.me.onGround && sp > CONFIG.MOVE.RUN_SPEED * 0.6) {
      this.stepDist += sp * STEP;
      if (this.stepDist > 2.1) { this.stepDist = 0; this.sfx.footstep(null, 0.13); }
    }
  }

  updateRemote(r, renderT, dt, id) {
    const buf = r.buf;
    if (!buf.length) return;
    let a = buf[0], b = buf[0];
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= renderT) { a = buf[i]; b = buf[i + 1] || buf[i]; break; }
    }
    if (renderT < buf[0].t) { a = b = buf[0]; }
    const f = b.t > a.t ? S.clamp((renderT - a.t) / (b.t - a.t), 0, 1) : 0;
    const st = {
      x: S.lerp(a.x, b.x, f), y: S.lerp(a.y, b.y, f), z: S.lerp(a.z, b.z, f),
      yaw: S.lerpAngle(a.yw, b.yw, f), pitch: S.lerp(a.pt, b.pt, f),
      crouch: !!(f < 0.5 ? a.c : b.c), alive: !!b.a, onGround: !!b.g,
      speed: Math.hypot(S.lerp(a.vx, b.vx, f), S.lerp(a.vz, b.vz, f)), reloading: !!b.rl, planting: !!b.pl,
      time: performance.now() / 1000, w: b.w
    };
    r.state = st;
    r.avatar.setWeapon(st.w);
    r.avatar.update(dt, st);
    // footsteps for running enemies/teammates
    if (st.alive && st.onGround && st.speed > CONFIG.MOVE.RUN_SPEED * 0.6) {
      r.stepT += dt * st.speed;
      if (r.stepT > 2.1) { r.stepT = 0; this.sfx.footstep([st.x, st.y, st.z], 0.35); }
    }
  }

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  render(dt) {
    const R = this.renderer;
    R.resize();
    const pos = this.camPos || [32, 20, 32];
    M4.perspective(this.proj, (this.fov || 78) * S.DEG, R.aspect, 0.05, 220);
    M4.compose(this.camWorld, pos[0], pos[1], pos[2], this.camPitch || 0, this.camYaw || 0, this.camRoll || 0, 1, 1, 1);
    M4.invertRigid(this.view, this.camWorld);
    M4.multiply(this.vp, this.proj, this.view);
    R.setLights(this.fx.activeLights(pos));
    R.beginFrame();
    R.drawSky(this.vp, pos);
    R.setBlend('none');
    this.worldR.draw(this.vp, pos);

    // ---- dynamic boxes
    const O = this.opaque, A = this.alphaBatch, D = this.addBatch;
    O.clear(); A.clear(); D.clear();
    // clouds + sun
    for (const c of this.clouds) {
      c.x += dt * 0.6; if (c.x > 130) c.x = -70;
      O.pushAABB(c.x, c.y, c.z, c.sx, 2, c.sz, 0.97, 0.98, 1, 1, 1);
    }
    // grenades in flight (interpolated)
    const rt = this.renderT || 0;
    for (const v of this.nadesView.values()) {
      const buf = v.buf;
      let a = buf[0], bb = buf[buf.length - 1];
      for (let i = buf.length - 1; i > 0; i--) if (buf[i - 1].t <= rt) { a = buf[i - 1]; bb = buf[i]; break; }
      const f = bb.t > a.t ? S.clamp((rt - a.t) / (bb.t - a.t), 0, 1.5) : 1;
      const model = this.nadeModels[v.ty];
      model.root.pos = [S.lerp(a.x, bb.x, f), S.lerp(a.y, bb.y, f), S.lerp(a.z, bb.z, f)];
      model.root.rot = [performance.now() / 90, performance.now() / 130, 0];
      model.root.scl = [1.4, 1.4, 1.4];
      model.root.update(null);
      model.root.render(O);
    }
    // avatars
    const me = this.myId;
    for (const [id, r] of this.remotes) {
      if (!r.state) continue;
      if (!this.alive && id === this.specTarget) continue;
      if (!r.state.alive && r.deadAt && performance.now() - r.deadAt > 8000) continue;
      r.avatar.root.render(O);
    }
    // bomb
    const b = this.bombState;
    if (b && (b.s === 'dropped' || b.s === 'planted' || b.s === 'defused')) {
      this.bomb.root.pos = [b.x, b.y, b.z];
      this.bomb.root.rot = [0, 0.6, 0];
      const blink = b.s === 'planted' && (performance.now() % 1000) < 120;
      this.bomb.led.visible = b.s !== 'planted' || blink || (b.ex - this.net.serverNow()) < 5000;
      this.bomb.root.update(null);
      this.bomb.root.render(O);
    } else if (b && b.s === 'carried' && this.myTeam === 'T' && b.c !== me) {
      const r = this.remotes.get(b.c);
      if (r && r.state && r.state.alive) {
        this.bomb.root.pos = [0, 0.18, 0.25]; this.bomb.root.rot = [-1.4, 0, 0];
        this.bomb.led.visible = true;
        this.bomb.root.update(r.avatar.torso.world);
        this.bomb.root.render(O);
      }
    }
    this.fx.render(O, A, D);
    if (this.smokes.length && this.net) this.fx.renderSmokes(A, this.smokes, this.net.serverNow());

    R.useBoxes(this.vp, pos);
    R.setBlend('none'); O.draw(R);
    R.setBlend('alpha'); A.draw(R);
    R.setBlend('add'); D.draw(R);
    R.setBlend('none');

    // ---- view model (separate depth range)
    const showVm = this.inGame && (this.alive || (this.specTarget && this.remotes.get(this.specTarget)));
    if (showVm) this.vm.render(R, this.vmBatch, this.vmAdd, this.view, 56);

    this.updateTags();
  }

  updateTags() {
    const used = new Set();
    if (this.inGame) {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      const place = (key, x, y, z, text, cls) => {
        const p = M4.transformPoint(this.vp, x, y, z);
        if (p[3] <= 0 || Math.abs(p[0]) > 1.1 || Math.abs(p[1]) > 1.1) return;
        let el = this.tagEls.get(key);
        if (!el) { el = document.createElement('div'); $('tags').appendChild(el); this.tagEls.set(key, el); }
        el.className = 'tag ' + cls;
        if (el.textContent !== text) el.textContent = text;
        el.style.left = ((p[0] * 0.5 + 0.5) * w).toFixed(1) + 'px';
        el.style.top = ((-p[1] * 0.5 + 0.5) * h).toFixed(1) + 'px';
        used.add(key);
      };
      for (const [id, r] of this.remotes) {
        if (!r.state || !r.state.alive || id === this.specTarget) continue;
        if (r.team !== this.myTeam && this.myTeam !== 'SPEC') continue;
        const name = (this.hud.roster.find((p) => p.i === id) || {}).n || '';
        place(id, r.state.x, r.state.y + 2.15, r.state.z, name, r.team);
      }
      const b = this.bombState;
      if (b && (b.s === 'planted' || (b.s === 'dropped' && this.myTeam === 'T'))) place('bomb', b.x, b.y + 0.9, b.z, '💣', 'bomb');
    }
    for (const [k, el] of this.tagEls) if (!used.has(k)) { el.remove(); this.tagEls.delete(k); }
  }
}

// ---------------------------------------------------------------------------
// INSTALLABLE APP (PWA): service worker + install button / iOS guide
// ---------------------------------------------------------------------------
const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) ||
  (window.matchMedia && matchMedia('(display-mode: fullscreen)').matches) || navigator.standalone === true;
const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !isNativeApp) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW kaydı başarısız', e)));
}
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  if (!standalone) $('btnInstall').classList.remove('hidden');
});
$('btnInstall').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  const choice = await installEvent.userChoice.catch(() => null);
  if (choice && choice.outcome === 'accepted') $('btnInstall').classList.add('hidden');
  installEvent = null;
});
window.addEventListener('appinstalled', () => $('btnInstall').classList.add('hidden'));
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS && !standalone && !isNativeApp) $('iosHint').classList.remove('hidden');
if (standalone && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});

// ---------------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------------
try {
  window.game = new Game();
} catch (err) {
  console.error(err);
  $('fatal').classList.remove('hidden');
  $('fatalText').textContent = 'Oyun başlatılamadı: ' + err.message + '. Cihazınız WebGL2 desteklemiyor olabilir.';
  $('menu').classList.add('hidden');
}
