/*
 * Unified input: keyboard + mouse (pointer lock) on PC, multi-touch virtual controls on mobile.
 */
const S = window.SHARED;
const BTN = S.BTN;

export class Input {
  constructor(canvas, touchRoot, isTouch) {
    this.canvas = canvas;
    this.isTouch = isTouch;
    this.keys = new Set();
    this.mouseFire = false;
    this.lookDX = 0; this.lookDY = 0;
    this.frameDX = 0; this.frameDY = 0;
    this.handlers = {};
    this.enabled = false;  // false while menus are open
    this.joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.lookTouches = new Map();
    this.touchFire = false;
    this.touchHeld = { jump: false, use: false, walk: false };
    this.crouchToggle = false;
    this.sens = 1; this.touchSens = 1;
    this.bindKeyboard();
    if (isTouch) this.bindTouch(touchRoot);
  }

  on(action, fn) { (this.handlers[action] = this.handlers[action] || []).push(fn); }
  emit(action, arg) { for (const fn of this.handlers[action] || []) fn(arg); }

  get locked() { return document.pointerLockElement === this.canvas; }
  requestLock() {
    if (this.isTouch || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) { /* ignore */ } });
    } catch (e) { try { this.canvas.requestPointerLock(); } catch (e2) { /* ignore */ } }
  }
  releaseLock() { if (this.locked) document.exitPointerLock(); }

  bindKeyboard() {
    const discrete = {
      KeyR: 'reload', Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4', Digit5: 'slot4', KeyG: 'dropWeapon', KeyE: 'usePress', KeyU: 'teamChat', KeyQ: 'lastWeapon',
      KeyB: 'buy', KeyM: 'teamMenu', KeyY: 'chat', Enter: 'chat', F3: 'stats', KeyN: 'nextSpec'
    };
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab') { e.preventDefault(); this.emit('scoreboard', true); return; }
      if (e.code === 'Escape') { this.emit('escape'); return; }
      if (['Space', 'ControlLeft', 'KeyC', 'F3'].includes(e.code)) e.preventDefault();
      if (!e.repeat && discrete[e.code]) this.emit(discrete[e.code]);
      if (!e.repeat && e.code === 'KeyV') this.emit('ptt', true);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); this.emit('scoreboard', false); }
      if (e.code === 'KeyV') this.emit('ptt', false);
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseFire = false; });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.emit('scope');
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseFire = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      // clamp absurd spikes some browsers produce on lock
      const dx = S.clamp(e.movementX, -300, 300), dy = S.clamp(e.movementY, -300, 300);
      this.lookDX += dx * this.sens; this.lookDY += dy * this.sens;
    });
    window.addEventListener('wheel', (e) => { if (this.locked && this.enabled) this.emit(e.deltaY > 0 ? 'nextWeapon' : 'prevWeapon'); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.emit('lockchange', this.locked); if (!this.locked) this.mouseFire = false; });
  }

  bindTouch(root) {
    root.classList.add('active');
    const joyZone = root.querySelector('#joyZone');
    const joyBase = root.querySelector('#joyBase');
    const joyKnob = root.querySelector('#joyKnob');
    const lookZone = root.querySelector('#lookZone');
    const R = 60;
    const prevent = (e) => { if (e.cancelable) e.preventDefault(); };

    joyZone.addEventListener('touchstart', (e) => {
      prevent(e);
      if (this.joy.id !== null) return;
      const t = e.changedTouches[0];
      this.joy.id = t.identifier; this.joy.ox = t.clientX; this.joy.oy = t.clientY;
      joyBase.style.left = (t.clientX - 70) + 'px'; joyBase.style.top = (t.clientY - 70) + 'px';
      joyBase.classList.add('on');
      joyKnob.style.transform = 'translate(0px,0px)';
    }, { passive: false });
    const joyMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joy.id) continue;
        prevent(e);
        let dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
        const l = Math.hypot(dx, dy);
        if (l > R) { dx *= R / l; dy *= R / l; }
        this.joy.x = dx / R; this.joy.y = -dy / R;
        joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
      }
    };
    const joyEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joy.id) continue;
        this.joy.id = null; this.joy.x = 0; this.joy.y = 0;
        joyBase.classList.remove('on');
      }
    };
    joyZone.addEventListener('touchmove', joyMove, { passive: false });
    joyZone.addEventListener('touchend', joyEnd);
    joyZone.addEventListener('touchcancel', joyEnd);

    // Look: any touch in look zone or on the fire button drags the camera
    const lookStart = (e, fire) => {
      prevent(e);
      for (const t of e.changedTouches) this.lookTouches.set(t.identifier, { x: t.clientX, y: t.clientY, fire });
      if (fire) this.touchFire = true;
    };
    const lookMove = (e) => {
      for (const t of e.changedTouches) {
        const lt = this.lookTouches.get(t.identifier);
        if (!lt) continue;
        prevent(e);
        this.lookDX += (t.clientX - lt.x) * 2.2 * this.touchSens;
        this.lookDY += (t.clientY - lt.y) * 2.2 * this.touchSens;
        lt.x = t.clientX; lt.y = t.clientY;
      }
    };
    const lookEnd = (e) => {
      for (const t of e.changedTouches) {
        const lt = this.lookTouches.get(t.identifier);
        if (lt && lt.fire) this.touchFire = [...this.lookTouches.values()].some((o) => o !== lt && o.fire);
        this.lookTouches.delete(t.identifier);
      }
    };
    lookZone.addEventListener('touchstart', (e) => lookStart(e, false), { passive: false });
    for (const id of ['tFire', 'tFire2']) {
      const el = root.querySelector('#' + id);
      el.addEventListener('touchstart', (e) => { e.stopPropagation(); lookStart(e, true); }, { passive: false });
    }
    window.addEventListener('touchmove', lookMove, { passive: false });
    window.addEventListener('touchend', lookEnd);
    window.addEventListener('touchcancel', lookEnd);

    const hold = (id, key) => {
      const el = root.querySelector('#' + id);
      el.addEventListener('touchstart', (e) => { prevent(e); e.stopPropagation(); this.touchHeld[key] = true; el.classList.add('down'); }, { passive: false });
      const up = (e) => { this.touchHeld[key] = false; el.classList.remove('down'); };
      el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    };
    const tap = (id, action, arg) => {
      const el = root.querySelector('#' + id);
      el.addEventListener('touchstart', (e) => {
        prevent(e); e.stopPropagation(); el.classList.add('down');
        this.emit(action, arg);
      }, { passive: false });
      const up = () => { el.classList.remove('down'); if (action === 'scoreboard') this.emit('scoreboard', false); };
      el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    };
    hold('tJump', 'jump');
    hold('tUse', 'use');
    root.querySelector('#tUse').addEventListener('touchstart', () => this.emit('usePress'), { passive: true });
    const mic = root.querySelector('#tMic');
    mic.addEventListener('touchstart', (e) => { prevent(e); e.stopPropagation(); mic.classList.add('down'); this.emit('ptt', true); }, { passive: false });
    const micUp = () => { mic.classList.remove('down'); this.emit('ptt', false); };
    mic.addEventListener('touchend', micUp); mic.addEventListener('touchcancel', micUp);
    tap('tReload', 'reload');
    tap('tScope', 'scope');
    tap('tSwitch', 'nextWeapon');
    tap('tNade', 'slot4');
    tap('tDrop', 'dropWeapon');
    tap('tChat', 'chat');
    tap('tBuy', 'buy');
    tap('tScore', 'scoreboard', true);
    tap('tMenu', 'escape');
    const crouchEl = root.querySelector('#tCrouch');
    crouchEl.addEventListener('touchstart', (e) => {
      prevent(e); e.stopPropagation();
      this.crouchToggle = !this.crouchToggle;
      crouchEl.classList.toggle('down', this.crouchToggle);
    }, { passive: false });
  }

  move() {
    if (!this.enabled) return { mx: 0, mz: 0 };
    let mx = 0, mz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.isTouch && (this.joy.x || this.joy.y)) {
      mx = this.joy.x; mz = this.joy.y;
      const l = Math.hypot(mx, mz);
      if (l < 0.15) { mx = 0; mz = 0; }
    }
    return { mx: Math.round(mx * 100) / 100, mz: Math.round(mz * 100) / 100 };
  }

  buttons() {
    if (!this.enabled) return 0;
    let b = 0;
    if (this.keys.has('Space') || this.touchHeld.jump) b |= BTN.JUMP;
    if (this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.crouchToggle) b |= BTN.CROUCH;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) b |= BTN.WALK;
    if (this.isTouch && this.joy.id !== null && Math.hypot(this.joy.x, this.joy.y) < 0.55) b |= BTN.WALK;
    if (this.keys.has('KeyE') || this.touchHeld.use) b |= BTN.USE;
    return b;
  }

  firing() { return this.enabled && (this.mouseFire || this.touchFire); }

  consumeLook() {
    const r = [this.lookDX, this.lookDY];
    this.lookDX = 0; this.lookDY = 0;
    this.frameDX = r[0]; this.frameDY = r[1];
    return r;
  }
}
