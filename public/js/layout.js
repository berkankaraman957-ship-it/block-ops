/*
 * Touch-control layout editor: drag any on-screen button, resize it, save per device.
 * Stored as % of the viewport so it works on every screen size / orientation.
 */
const $ = (id) => document.getElementById(id);
const KEY = 'blockops.layout';
export const TOUCH_BUTTONS = ['tFire', 'tFire2', 'tJump', 'tCrouch', 'tReload', 'tUse', 'tScope', 'tSwitch', 'tNade', 'tDrop', 'tChat', 'tMic', 'tBuy', 'tScore', 'tMenu'];
const LABEL = { tFire: 'Ateş', tFire2: 'Ateş 2', tJump: 'Zıpla', tCrouch: 'Eğil', tReload: 'Şarjör', tUse: 'Kur/Çöz/Al', tScope: 'Dürbün', tSwitch: 'Silah', tNade: 'Bomba', tDrop: 'Silahı at', tChat: 'Sohbet', tMic: 'Mikrofon', tBuy: 'Market', tScore: 'Skor', tMenu: 'Menü' };

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* ignore */ } }

export class LayoutEditor {
  constructor(game) {
    this.g = game;
    this.layout = load();
    this.editing = false;
    this.sel = null;
    this.apply();
    window.addEventListener('resize', () => this.apply());
    $('btnLayout').addEventListener('click', () => this.open());
    $('btnLayoutSave').addEventListener('click', () => { save(this.layout); this.close(); });
    $('btnLayoutReset').addEventListener('click', () => { this.layout = {}; this.apply(); this.select(null); });
    $('btnLayoutCancel').addEventListener('click', () => { this.layout = load(); this.apply(); this.close(); });
    $('inBtnSize').addEventListener('input', () => {
      if (!this.sel) return;
      const L = this.ensure(this.sel);
      L.s = parseFloat($('inBtnSize').value);
      this.applyOne(this.sel);
    });
    $('inBtnAlpha').value = this.layout._alpha || 1;
    $('inBtnAlpha').addEventListener('input', () => { this.layout._alpha = parseFloat($('inBtnAlpha').value); this.apply(); });
    for (const id of TOUCH_BUTTONS) this.bindDrag($(id), id);
  }

  ensure(id) {
    if (!this.layout[id]) {
      const r = $(id).getBoundingClientRect();
      this.layout[id] = { x: ((r.left + r.width / 2) / innerWidth) * 100, y: ((r.top + r.height / 2) / innerHeight) * 100, s: 1 };
    }
    return this.layout[id];
  }
  applyOne(id) {
    const el = $(id), L = this.layout[id];
    if (!el) return;
    if (!L) { el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.transform = ''; return; }
    el.style.left = L.x + '%'; el.style.top = L.y + '%';
    el.style.right = 'auto'; el.style.bottom = 'auto';
    el.style.transform = `translate(-50%, -50%) scale(${L.s || 1})`;
  }
  apply() {
    for (const id of TOUCH_BUTTONS) this.applyOne(id);
    $('touch').style.setProperty('--tb-alpha', this.layout._alpha || 1);
  }

  open() {
    this.editing = true;
    this.prevClasses = $('touch').className;
    $('touch').classList.add('active', 'ingame', 'editing');
    $('layoutEditor').classList.remove('hidden');
    $('menu').classList.add('hidden');
    this.select(null);
  }
  close() {
    this.editing = false;
    $('touch').classList.remove('editing');
    $('touch').className = this.prevClasses || '';
    if (this.g.isTouch) $('touch').classList.add('active');
    $('layoutEditor').classList.add('hidden');
    if (!this.g.inGame) $('menu').classList.remove('hidden');
    this.g.updateInputEnabled();
    this.select(null);
  }
  select(id) {
    this.sel = id;
    document.querySelectorAll('#touch .tb').forEach((b) => b.classList.toggle('sel', b.id === id));
    $('layoutSel').textContent = id ? `Seçili: ${LABEL[id] || id}` : 'Bir butona dokun ve sürükle';
    $('inBtnSize').disabled = !id;
    if (id) $('inBtnSize').value = (this.layout[id] && this.layout[id].s) || 1;
  }

  bindDrag(el, id) {
    if (!el) return;
    let dragging = false, ox = 0, oy = 0;
    const down = (e) => {
      if (!this.editing) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const pt = e.touches ? e.touches[0] : e;
      const L = this.ensure(id);
      this.select(id);
      dragging = true;
      ox = pt.clientX - (L.x / 100) * innerWidth;
      oy = pt.clientY - (L.y / 100) * innerHeight;
    };
    const move = (e) => {
      if (!dragging) return;
      e.preventDefault();
      const pt = e.touches ? e.touches[0] : e;
      const L = this.layout[id];
      L.x = Math.max(2, Math.min(98, ((pt.clientX - ox) / innerWidth) * 100));
      L.y = Math.max(3, Math.min(97, ((pt.clientY - oy) / innerHeight) * 100));
      this.applyOne(id);
    };
    const up = () => { dragging = false; };
    el.addEventListener('touchstart', down, { passive: false, capture: true });
    el.addEventListener('mousedown', down, true);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchend', up);
    window.addEventListener('mouseup', up);
  }
}
