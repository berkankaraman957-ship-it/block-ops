/*
 * First-person view model: procedural arms + gun with fully mathematical animation layers:
 * draw (ease-out-back), walk bob (figure-8), idle breathing, mouse sway (springs), recoil
 * kick (springs), jump/land offsets, crouch offset, reload keyframes (tilt → mag out → mag in
 * → slap → charge), knife swing, sniper bolt cycle, muzzle flash.
 */
import { Node, M4, Spring, Ease, window01, range01 } from './engine.js';
import { buildGun, TEAM_STYLE } from './models.js';

const S = window.SHARED;
const BASE = {
  rifle: { pos: [0.19, -0.2, -0.43], rot: [0.0, -0.05, 0] },
  smg: { pos: [0.18, -0.19, -0.4], rot: [0.0, -0.06, 0] },
  sniper: { pos: [0.2, -0.21, -0.45], rot: [0.0, -0.045, 0] },
  pistol: { pos: [0.17, -0.18, -0.42], rot: [0.03, -0.08, 0] },
  knife: { pos: [0.2, -0.19, -0.36], rot: [0.15, -0.25, -0.35] },
  shotgun: { pos: [0.19, -0.2, -0.42], rot: [0.0, -0.05, 0] },
  lmg: { pos: [0.2, -0.22, -0.44], rot: [0.0, -0.05, 0] },
  grenade: { pos: [0.18, -0.2, -0.4], rot: [0.2, -0.3, 0] }
};

export class ViewModel {
  constructor() {
    this.root = new Node('vm');
    this.holder = this.root.add(new Node('holder'));
    this.flashNode = new Node('flash');
    this.proj = M4.create();
    this.vp = M4.create();
    this.team = 'T';
    this.weaponId = null;
    this.kind = 'rifle';
    this.kickZ = new Spring(240, 20);
    this.kickRot = new Spring(200, 18);
    this.kickSide = new Spring(200, 18);
    this.swayX = new Spring(90, 14);
    this.swayY = new Spring(90, 14);
    this.land = new Spring(160, 14);
    this.bobPhase = 0;
    this.bobAmt = 0;
    this.crouchAmt = 0;
    this.drawStart = -1e9; this.drawDur = 0.5;
    this.reloadStart = -1e9; this.reloadDur = 0;
    this.swingStart = -1e9;
    this.lastShot = -1e9;
    this.flashUntil = 0;
    this.flashRot = 0;
    this.visible = true;
    this.time = 0;
    this.skin = '';
    this.inspectStart = -1e9;
  }

  setTeam(team) {
    if (team === this.team) return;
    this.team = team;
    const id = this.weaponId;
    this.weaponId = null;
    if (id) this.setWeapon(id, true, this.skin);
  }

  setWeapon(id, silent, skin) {
    skin = skin || '';
    if (this.weaponId === id && this.skin === skin) return;
    if (this.weaponId === id) silent = true;    // only the skin changed
    this.weaponId = id;
    this.skin = skin;
    this.inspectStart = -1e9;
    const gun = buildGun(id, skin);
    this.gun = gun;
    this.kind = gun.kind;
    this.holder.children = [];
    this.holder.add(gun.root);
    this.buildArms(gun);
    this.flashNode = new Node('flash');
    this.flashNode.pos = gun.muzzle.slice();
    const fc = [1.0, 0.82, 0.4];
    this.flashNode.box(0.05, 0.05, 0.14, 0, 0, -0.05, fc, 1, 0.95);
    this.flashNode.box(0.16, 0.025, 0.025, 0, 0, -0.02, fc, 1, 0.8);
    this.flashNode.box(0.025, 0.16, 0.025, 0, 0, -0.02, fc, 1, 0.8);
    this.flashNode.box(0.03, 0.03, 0.03, 0, 0, -0.14, [1, 1, 0.85], 1, 1);
    this.reloadStart = -1e9;
    this.throwStart = -1e9;
    this.pump = gun.root.find('pump');
    this.pin = gun.root.find('pin');
    if (!silent) this.drawStart = this.time;
    this.drawDur = (S.WEAPONS[id] || S.WEAPONS.knife).drawTime;
  }

  buildArms(gun) {
    const st = TEAM_STYLE[this.team] || TEAM_STYLE.T;
    const h = this.holder;
    // right arm: shoulder off-screen bottom-right to grip
    const rHand = [gun.grip[0] + 0.01, gun.grip[1] - 0.02, gun.grip[2] + 0.02];
    const rShoulder = [0.16, -0.32, 0.42];
    const rArm = h.add(new Node('armR'));
    rArm.limb(rShoulder, [rHand[0] + 0.03, rHand[1] - 0.04, rHand[2] + 0.12], 0.085, st.sleeve);
    rArm.limb([rHand[0] + 0.03, rHand[1] - 0.04, rHand[2] + 0.12], rHand, 0.075, st.skin);
    rArm.box(0.07, 0.09, 0.09, rHand[0], rHand[1], rHand[2], st.glove);
    // left arm: pivot at shoulder so reload can move the hand
    this.lPivot = h.add(new Node('armLPivot'));
    const lShoulder = gun.kind === 'pistol' ? [-0.12, -0.34, 0.36] : [-0.2, -0.3, 0.3];
    this.lPivot.pos = lShoulder;
    const f = gun.fore;
    const lHand = [f[0] - lShoulder[0] - 0.005, f[1] - lShoulder[1] - 0.025, f[2] - lShoulder[2]];
    const elbow = [lHand[0] * 0.55 - 0.05, lHand[1] * 0.55 - 0.06, lHand[2] * 0.55 + 0.02];
    this.lPivot.limb([0, 0, 0], elbow, 0.085, st.sleeve);
    this.lPivot.limb(elbow, lHand, 0.075, st.skin);
    this.lPivot.box(0.08, 0.06, 0.09, lHand[0], lHand[1], lHand[2], st.glove);
  }

  // ---- triggers ----
  /** F: show the weapon off (purely cosmetic animation) */
  inspect() {
    if (this.kind === 'grenade') return;
    if (this.time - this.inspectStart < 2.6) return;
    if (this.time - this.drawStart < this.drawDur || (this.reloadDur > 0 && this.time - this.reloadStart < this.reloadDur)) return;
    this.inspectStart = this.time;
  }
  cancelInspect() { this.inspectStart = -1e9; }

  fire(weapon) {
    this.inspectStart = -1e9;
    const k = weapon.kick || 0.4;
    this.lastShot = this.time;
    if (weapon.melee) { this.swingStart = this.time; return; }
    this.kickZ.impulse(k * 1.6);
    this.kickRot.impulse(k * 7);
    this.kickSide.impulse((Math.random() - 0.5) * k * 4);
    this.flashUntil = this.time + 0.045;
    this.flashRot = Math.random() * Math.PI;
  }
  throwNade() { this.throwStart = this.time; }
  startReload(duration) { this.reloadStart = this.time; this.reloadDur = duration; this.inspectStart = -1e9; }
  cancelReload() { this.reloadStart = -1e9; }
  landed(speed) { this.land.impulse(-Math.min(speed, 14) * 0.035); }

  /**
   * ctx: {speedFrac, onGround, crouch, lookDX, lookDY, vy, scoped}
   */
  update(dt, ctx) {
    this.time += dt;
    const t = this.time;
    const base = BASE[this.kind] || BASE.rifle;
    let px = base.pos[0], py = base.pos[1], pz = base.pos[2];
    let rx = base.rot[0], ry = base.rot[1], rz = base.rot[2];

    // walk bob (figure-8) + idle breathing
    const walk = ctx.onGround ? Math.min(1, ctx.speedFrac) : 0;
    this.bobAmt += (walk - this.bobAmt) * Math.min(1, dt * 8);
    this.bobPhase += dt * (5 + 6 * ctx.speedFrac);
    const b = this.bobAmt;
    px += Math.sin(this.bobPhase) * 0.011 * b;
    py += Math.sin(this.bobPhase * 2) * 0.0065 * b - 0.004 * b;
    rz += Math.sin(this.bobPhase) * 0.025 * b;
    rx += Math.sin(this.bobPhase * 2) * 0.01 * b;
    py += Math.sin(t * 1.6) * 0.0018;
    rx += Math.sin(t * 1.6) * 0.004;

    // mouse sway (lags behind the view)
    this.swayX.target = S.clamp(-ctx.lookDX * 0.0004, -0.045, 0.045);
    this.swayY.target = S.clamp(ctx.lookDY * 0.0004, -0.035, 0.035);
    const sx = this.swayX.update(dt), sy = this.swayY.update(dt);
    px += sx; py += sy;
    ry += sx * 1.6; rx += -sy * 1.2; rz += sx * 1.2;

    // air / landing
    py += S.clamp(-ctx.vy * 0.0025, -0.025, 0.02);
    py += this.land.update(dt);

    // crouch
    this.crouchAmt += ((ctx.crouch ? 1 : 0) - this.crouchAmt) * Math.min(1, dt * 10);
    px -= 0.012 * this.crouchAmt; py -= 0.006 * this.crouchAmt; rz -= 0.04 * this.crouchAmt;

    // recoil springs
    const kz = this.kickZ.update(dt), kr = this.kickRot.update(dt), ks = this.kickSide.update(dt);
    pz += kz * 0.045; py += kr * 0.0012;
    rx += kr * 0.018; ry += ks * 0.01; rz += ks * 0.012;

    // knife swing
    const sw = range01(t - this.swingStart, 0, 0.32);
    if (sw > 0 && sw < 1) {
      const e = Math.sin(sw * Math.PI);
      ry += e * 1.1; rx -= e * 0.35; px -= e * 0.12; pz -= e * 0.06; rz += e * 0.4;
    }

    // sniper bolt cycle
    if (this.kind === 'sniper') {
      const bt = window01(t - this.lastShot, 0.25, 1.2, 0.2);
      rz += bt * 0.35; py -= bt * 0.025; rx += bt * 0.08;
    }

    // pump-action cycle
    if (this.kind === 'shotgun' && this.pump && this.weaponId === 'breacher') {
      const pc = window01(t - this.lastShot, 0.12, 0.62, 0.12);
      this.pump.pos = [0, 0.02, -0.34 + 0.09 * pc];
      rx += pc * 0.08; pz += pc * 0.015;
    }
    // grenade: pin pull during draw, wind-up + throw
    let thrown = false;
    if (this.kind === 'grenade') {
      if (this.pin) { const pp = range01(t - this.drawStart, 0.15, 0.45); this.pin.pos = [-0.025 - pp * 0.12, 0.07 + pp * 0.05, pp * 0.05]; this.pin.visible = pp < 0.95; }
      const tt = t - this.throwStart;
      if (tt >= 0 && tt < 0.7) {
        const back = Ease.outCubic(range01(tt, 0, 0.14)), fwd = Ease.inOutQuad(range01(tt, 0.14, 0.3));
        pz += back * 0.1 - fwd * 0.28; py += back * 0.05 + fwd * 0.04; rx -= back * 0.7 - fwd * 1.2;
        if (tt > 0.3) thrown = true;
      }
    }

    // reload keyframes
    let magOffset = 0, magVisible = true, lArm = 0;
    if (this.reloadDur > 0) {
      const p = (t - this.reloadStart) / this.reloadDur;
      if (p >= 0 && p <= 1) {
        const pistol = this.kind === 'pistol';
        const tilt = window01(p, 0, 1, 0.16);
        rz += (pistol ? 0.25 : 0.5) * tilt;
        rx += (pistol ? 0.35 : 0.2) * tilt;
        py -= 0.03 * tilt; px -= 0.02 * tilt;
        // mag out
        const out = Ease.inOutQuad(range01(p, 0.14, 0.34));
        const inn = Ease.outCubic(range01(p, 0.5, 0.68));
        if (p < 0.36) magOffset = -0.4 * out;
        else if (p < 0.5) { magVisible = false; magOffset = -0.4; }
        else magOffset = -0.4 * (1 - inn);
        lArm = Math.min(1, out * 1.4) * (1 - inn);
        // slap
        py += 0.014 * window01(p, 0.68, 0.76, 0.03);
        // charging handle / slide
        const ch = window01(p, 0.78, 0.9, 0.04);
        ry += 0.12 * ch; px += 0.012 * ch; pz += (pistol ? 0.02 : 0.01) * ch;
      }
    }
    if (this.gun && this.gun.mag) {
      this.gun.mag.visible = magVisible;
      if (!this.gun.mag._base) this.gun.mag._base = this.gun.mag.pos.slice();
      this.gun.mag.pos = [this.gun.mag._base[0], this.gun.mag._base[1] + magOffset, this.gun.mag._base[2]];
    }
    if (this.lPivot) this.lPivot.rot = [-0.9 * lArm, 0.2 * lArm, 0];

    // weapon inspect: bring it in, turn it to show the side (and the skin), flip, return
    const it = t - this.inspectStart;
    if (it >= 0 && it < 2.6) {
      const inn = Ease.inOutQuad(range01(it, 0, 0.45)), out = Ease.inOutQuad(range01(it, 2.15, 2.6));
      const a = inn * (1 - out);
      const turn = Math.sin(range01(it, 0.45, 2.15) * Math.PI * 2) * 0.35;
      px -= 0.09 * a; py += 0.03 * a; pz += 0.06 * a;
      ry += (0.95 + turn) * a; rz += (0.55 - turn * 0.6) * a; rx += 0.18 * a;
      if (this.kind === 'knife') { rz += Math.sin(range01(it, 0.8, 1.6) * Math.PI) * 2.6 * a; }
    }

    // draw / deploy
    const d = range01(t - this.drawStart, 0, this.drawDur);
    if (d < 1) {
      const e = Ease.outBack(d);
      py -= (1 - e) * 0.26; rx -= (1 - e) * 0.9; rz += (1 - e) * 0.3;
    }

    if (this.gun) this.gun.root.visible = !thrown;
    this.holder.pos = [px, py, pz];
    this.holder.rot = [rx, ry, rz];
    this.visible = !ctx.scoped;
    // muzzle flash tint
    if (this.gun) this.gun.root.tint = t < this.flashUntil ? [1, 0.8, 0.45, 0.35] : null;
    this.root.update(null);
    this.flashNode.rot = [0, 0, this.flashRot];
    const fs = 0.8 + Math.random() * 0.5;
    this.flashNode.scl = [fs, fs, fs];
    this.flashNode.update(this.gun ? this.gun.root.world : null);
  }

  render(renderer, batch, addBatch, viewMatrix, fovDeg) {
    if (!this.visible) return;
    const gl = renderer.gl;
    M4.perspective(this.proj, (fovDeg || 56) * Math.PI / 180, renderer.aspect, 0.01, 10);
    // light direction into view space
    const s = renderer.sun, v = viewMatrix;
    const sun = [v[0] * s[0] + v[4] * s[1] + v[8] * s[2], v[1] * s[0] + v[5] * s[1] + v[9] * s[2], v[2] * s[0] + v[6] * s[1] + v[10] * s[2]];
    gl.clear(gl.DEPTH_BUFFER_BIT);
    batch.clear();
    this.root.render(batch);
    renderer.useBoxes(this.proj, [0, 0, 0], { sun, fog: [100, 200], ambient: 0.6, noLights: true });
    renderer.setBlend('none');
    batch.draw(renderer);
    if (this.time < this.flashUntil) {
      addBatch.clear();
      this.flashNode.render(addBatch);
      renderer.setBlend('add');
      addBatch.draw(renderer);
      renderer.setBlend('none');
    }
  }
}
