/*
 * Code-generated voxel models (no external 3D files).
 * Guns are built in metres, origin at the grip/trigger, forward = -Z.
 */
import { Node } from './engine.js';

export const TEAM_STYLE = {
  T: { shirt: 0xa8622c, vest: 0x5b4a33, pants: 0x4d4436, skin: 0xd8a06a, mask: 0x2b2b2b, accent: 0xe0a040, sleeve: 0x8f5428, glove: 0x2a2520 },
  CT: { shirt: 0x34548c, vest: 0x2c3a4c, pants: 0x2a3343, skin: 0xd8a06a, mask: 0x3a4a5c, accent: 0x6fb6ff, sleeve: 0x2f4b7c, glove: 0x1e2228 }
};

/**
 * @returns {{root: Node, mag: Node|null, muzzle: number[], grip: number[], fore: number[], kind: string}}
 */
export function buildGun(id) {
  const g = new Node('gun');
  let mag = null, muzzle = [0, 0.04, -0.6], fore = [0, -0.02, -0.3], kind = 'rifle';
  const grip = (color, z) => {
    const n = g.add(new Node('grip'));
    n.pos = [0, -0.05, z || 0.03]; n.rot = [0.3, 0, 0];
    n.box(0.04, 0.11, 0.05, 0, -0.02, 0, color);
    return n;
  };
  switch (id) {
    case 'krait': {
      g.box(0.06, 0.08, 0.34, 0, 0.02, -0.08, 0x3a3a3a);
      g.box(0.05, 0.022, 0.28, 0, 0.07, -0.06, 0x2c2c2c);
      g.box(0.024, 0.024, 0.34, 0, 0.04, -0.42, 0x1f1f1f);
      g.box(0.026, 0.026, 0.2, 0, 0.075, -0.33, 0x2a2a2a);
      g.box(0.066, 0.064, 0.17, 0, 0.03, -0.32, 0x8a5a2b);
      g.box(0.012, 0.045, 0.012, 0, 0.08, -0.55, 0x1f1f1f);
      g.box(0.03, 0.03, 0.04, 0, 0.04, -0.6, 0x151515);
      g.box(0.05, 0.075, 0.26, 0, 0.0, 0.21, 0x8a5a2b);
      g.box(0.052, 0.1, 0.02, 0, -0.01, 0.34, 0x2b2016);
      grip(0x5b3a1e);
      mag = g.add(new Node('mag')); mag.pos = [0, -0.04, -0.13]; mag.rot = [0.35, 0, 0];
      mag.box(0.045, 0.18, 0.07, 0, -0.08, 0, 0xb3632a);
      mag.box(0.047, 0.02, 0.072, 0, -0.165, 0, 0x7a4a1a);
      muzzle = [0, 0.04, -0.63]; fore = [0, -0.005, -0.32];
      break;
    }
    case 'sentinel': {
      g.box(0.055, 0.07, 0.3, 0, 0.04, -0.06, 0x2b2d30);
      g.box(0.05, 0.05, 0.18, 0, -0.01, -0.04, 0x3a3d42);
      g.box(0.03, 0.016, 0.3, 0, 0.083, -0.1, 0x16181a);
      g.box(0.03, 0.045, 0.03, 0, 0.11, 0.05, 0x16181a);
      g.box(0.072, 0.072, 0.22, 0, 0.04, -0.32, 0x34383c);
      g.box(0.022, 0.022, 0.22, 0, 0.04, -0.52, 0x1a1a1a);
      g.box(0.034, 0.034, 0.05, 0, 0.04, -0.64, 0x101010);
      g.box(0.012, 0.05, 0.012, 0, 0.09, -0.42, 0x16181a);
      g.box(0.03, 0.03, 0.14, 0, 0.03, 0.11, 0x1d1f22);
      g.box(0.05, 0.085, 0.16, 0, 0.0, 0.22, 0x2b2d30);
      grip(0x1d1f22);
      mag = g.add(new Node('mag')); mag.pos = [0, -0.03, -0.11]; mag.rot = [0.12, 0, 0];
      mag.box(0.04, 0.17, 0.07, 0, -0.08, 0, 0x45484c);
      muzzle = [0, 0.04, -0.67]; fore = [0, 0.0, -0.32];
      break;
    }
    case 'viper': {
      g.box(0.055, 0.09, 0.3, 0, 0.03, -0.08, 0x252728);
      g.box(0.058, 0.03, 0.2, 0, 0.09, -0.1, 0x2e8b7a);
      g.box(0.026, 0.026, 0.12, 0, 0.04, -0.29, 0x161616);
      g.box(0.036, 0.036, 0.04, 0, 0.04, -0.36, 0x101010);
      g.box(0.03, 0.06, 0.16, 0, 0.0, 0.12, 0x1b1b1b);
      g.box(0.04, 0.09, 0.03, 0, -0.04, 0.2, 0x1b1b1b);
      grip(0x1b1b1b);
      mag = g.add(new Node('mag')); mag.pos = [0, -0.03, -0.14]; mag.rot = [0.05, 0, 0];
      mag.box(0.036, 0.19, 0.05, 0, -0.09, 0, 0x2a2a2a);
      muzzle = [0, 0.04, -0.39]; fore = [0, -0.06, -0.16]; kind = 'smg';
      break;
    }
    case 'longshot': {
      g.box(0.06, 0.08, 0.42, 0, 0.03, -0.06, 0x3e5a3a);
      g.box(0.03, 0.03, 0.55, 0, 0.045, -0.53, 0x1d1f1d);
      g.box(0.045, 0.045, 0.07, 0, 0.045, -0.82, 0x111111);
      g.box(0.05, 0.05, 0.28, 0, 0.125, -0.06, 0x121212);
      g.box(0.062, 0.062, 0.05, 0, 0.125, -0.21, 0x121212);
      g.box(0.062, 0.062, 0.05, 0, 0.125, 0.09, 0x121212);
      g.box(0.04, 0.04, 0.005, 0, 0.125, -0.236, 0x3a7bd5, 0.9);
      g.box(0.02, 0.04, 0.02, 0, 0.09, -0.06, 0x121212);
      g.box(0.07, 0.016, 0.016, 0.05, 0.05, 0.05, 0x8a8a8a);
      g.box(0.024, 0.024, 0.024, 0.085, 0.05, 0.05, 0x8a8a8a);
      g.box(0.06, 0.12, 0.28, 0, -0.01, 0.27, 0x3e5a3a);
      g.box(0.062, 0.13, 0.02, 0, -0.01, 0.41, 0x1d1f1d);
      grip(0x2c3a2a, 0.07);
      mag = g.add(new Node('mag')); mag.pos = [0, -0.02, -0.05];
      mag.box(0.045, 0.08, 0.08, 0, -0.04, 0, 0x1d1f1d);
      muzzle = [0, 0.045, -0.86]; fore = [0, -0.0, -0.3]; kind = 'sniper';
      break;
    }
    case 'p9':
    case 'p12':
    case 'hc50': {
      const big = id === 'hc50';
      const slideCol = id === 'hc50' ? 0xb8bcc2 : id === 'p12' ? 0x30343a : 0x2a2a2a;
      const frameCol = id === 'p9' ? 0x6b5d45 : id === 'hc50' ? 0x8c9096 : 0x22252a;
      const sw = big ? 0.045 : 0.035, sh = big ? 0.05 : 0.04, sl = big ? 0.24 : 0.19;
      g.box(sw, sh, sl, 0, 0.045, -0.06, slideCol);
      g.box(sw - 0.004, 0.025, sl - 0.03, 0, 0.012, -0.05, frameCol);
      g.box(0.01, 0.012, 0.01, 0, 0.072, -0.06 - sl / 2 + 0.01, 0x111111);
      g.box(0.022, 0.012, 0.01, 0, 0.072, -0.06 + sl / 2 - 0.01, 0x111111);
      g.box(0.012, 0.025, 0.035, 0, -0.008, -0.01, 0x111111);
      const gr = g.add(new Node('grip')); gr.pos = [0, -0.0, 0.025]; gr.rot = [0.25, 0, 0];
      gr.box(sw - 0.004, 0.1, 0.05, 0, -0.055, 0, frameCol);
      mag = gr.add(new Node('mag')); mag.pos = [0, -0.1, 0];
      mag.box(sw - 0.008, 0.035, 0.044, 0, -0.012, 0, 0x151515);
      muzzle = [0, 0.045, -0.06 - sl / 2 - 0.01];
      if (id === 'p12') {
        g.box(0.03, 0.03, 0.13, 0, 0.045, -0.06 - sl / 2 - 0.065, 0x1a1a1a);
        muzzle = [0, 0.045, -0.06 - sl / 2 - 0.135];
      }
      fore = [0, -0.07, 0.02]; kind = 'pistol';
      break;
    }
    case 'falcon': case 'lynx': {
      const lynx = id === 'lynx';
      const body = lynx ? 0x3b4048 : 0x5a5136, dark = 0x1f1f1f;
      if (lynx) {
        // bullpup: mag behind the grip, carry handle on top
        g.box(0.06, 0.1, 0.5, 0, 0.03, 0.0, body);
        g.box(0.03, 0.05, 0.32, 0, 0.11, -0.04, dark);
        g.box(0.022, 0.022, 0.2, 0, 0.045, -0.36, dark);
        g.box(0.035, 0.035, 0.05, 0, 0.045, -0.47, 0x111111);
        g.box(0.07, 0.03, 0.12, 0, -0.03, -0.18, dark);
        grip(dark, -0.05);
        mag = g.add(new Node('mag')); mag.pos = [0, -0.03, 0.12]; mag.rot = [0.1, 0, 0];
        mag.box(0.04, 0.13, 0.065, 0, -0.06, 0, 0x2b2b2b);
        muzzle = [0, 0.045, -0.5]; fore = [0, -0.04, -0.2];
      } else {
        g.box(0.06, 0.08, 0.36, 0, 0.02, -0.08, body);
        g.box(0.024, 0.024, 0.3, 0, 0.045, -0.4, dark);
        g.box(0.068, 0.066, 0.18, 0, 0.03, -0.3, 0x6b5b3a);
        g.box(0.012, 0.05, 0.012, 0, 0.085, -0.52, dark);
        g.box(0.03, 0.06, 0.24, 0, 0.0, 0.2, 0x3a3428);
        g.box(0.05, 0.1, 0.03, 0, -0.01, 0.32, 0x2a2620);
        grip(dark);
        mag = g.add(new Node('mag')); mag.pos = [0, -0.04, -0.12]; mag.rot = [0.28, 0, 0];
        mag.box(0.045, 0.2, 0.07, 0, -0.09, 0, 0x2b2b2b);
        muzzle = [0, 0.045, -0.58]; fore = [0, -0.005, -0.3];
      }
      break;
    }
    case 'ranger': {
      g.box(0.055, 0.075, 0.42, 0, 0.03, -0.05, 0x2e3a4a);
      g.box(0.026, 0.026, 0.5, 0, 0.045, -0.5, 0x1a1a1a);
      g.box(0.04, 0.04, 0.24, 0, 0.12, -0.06, 0x101010);
      g.box(0.052, 0.052, 0.04, 0, 0.12, -0.19, 0x101010); g.box(0.052, 0.052, 0.04, 0, 0.12, 0.07, 0x101010);
      g.box(0.036, 0.036, 0.004, 0, 0.12, -0.212, 0x3a7bd5, 0.9);
      g.box(0.06, 0.016, 0.016, 0.045, 0.05, 0.06, 0x9a9a9a);
      g.box(0.055, 0.11, 0.26, 0, -0.01, 0.26, 0x2e3a4a);
      grip(0x1d1f22, 0.07);
      mag = g.add(new Node('mag')); mag.pos = [0, -0.02, -0.06];
      mag.box(0.04, 0.07, 0.07, 0, -0.035, 0, 0x1d1f22);
      muzzle = [0, 0.045, -0.76]; fore = [0, -0.0, -0.28]; kind = 'sniper';
      break;
    }
    case 'wasp': case 'hornet': {
      const hornet = id === 'hornet';
      if (hornet) {
        g.box(0.07, 0.12, 0.44, 0, 0.02, -0.02, 0x30352e);
        g.box(0.05, 0.03, 0.34, 0, 0.1, -0.04, 0x1f1f1f);          // top mag
        g.box(0.03, 0.03, 0.08, 0, 0.04, -0.27, 0x151515);
        g.box(0.06, 0.05, 0.05, 0, -0.06, -0.12, 0x30352e);
        g.box(0.04, 0.09, 0.05, 0, -0.06, 0.02, 0x1f1f1f);
        mag = g.add(new Node('mag')); mag.pos = [0, 0.12, -0.04];
        mag.box(0.048, 0.025, 0.3, 0, 0, 0, 0x2a3a2a);
        muzzle = [0, 0.04, -0.31]; fore = [0, -0.06, -0.12];
      } else {
        g.box(0.05, 0.08, 0.28, 0, 0.03, -0.06, 0x2a2c2e);
        g.box(0.02, 0.02, 0.1, 0, 0.045, -0.25, 0x151515);
        g.box(0.03, 0.015, 0.2, 0, 0.08, -0.06, 0x111111);
        g.box(0.025, 0.04, 0.2, 0, 0.02, 0.15, 0x1b1b1b);
        g.box(0.03, 0.05, 0.04, 0, -0.03, -0.2, 0x1b1b1b);
        const gr = g.add(new Node('grip')); gr.pos = [0, -0.02, 0.0]; gr.rot = [0.18, 0, 0];
        gr.box(0.04, 0.11, 0.05, 0, -0.05, 0, 0x1b1b1b);
        mag = gr.add(new Node('mag')); mag.pos = [0, -0.1, 0];
        mag.box(0.034, 0.08, 0.044, 0, -0.03, 0, 0x2b2b2b);
        muzzle = [0, 0.045, -0.31]; fore = [0, -0.04, -0.2];
      }
      kind = 'smg';
      break;
    }
    case 'breacher': case 'mauler': {
      const auto = id === 'mauler';
      g.box(0.06, 0.08, 0.3, 0, 0.03, -0.02, auto ? 0x2a2a2a : 0x3a3a3a);
      g.box(0.03, 0.03, 0.46, 0, 0.06, -0.38, 0x1d1d1d);
      g.box(0.032, 0.032, 0.4, 0, 0.025, -0.34, 0x2a2a2a);              // tube
      const pump = g.add(new Node('pump')); pump.pos = [0, 0.02, -0.34];
      pump.box(0.06, 0.055, 0.14, 0, 0, 0, auto ? 0x3a3a3a : 0x6b4a2a);
      g.box(0.055, 0.085, 0.26, 0, 0.0, 0.22, auto ? 0x222222 : 0x6b4a2a);
      grip(auto ? 0x1b1b1b : 0x4a3220);
      if (auto) { mag = g.add(new Node('mag')); mag.pos = [0, -0.04, -0.1]; mag.box(0.05, 0.11, 0.08, 0, -0.04, 0, 0x2b2b2b); }
      muzzle = [0, 0.06, -0.62]; fore = [0, -0.02, -0.34]; kind = 'shotgun';
      break;
    }
    case 'titan': {
      g.box(0.08, 0.1, 0.42, 0, 0.03, -0.05, 0x3b3f36);
      g.box(0.035, 0.035, 0.42, 0, 0.05, -0.47, 0x1a1a1a);
      g.box(0.05, 0.05, 0.08, 0, 0.05, -0.7, 0x111111);
      g.box(0.06, 0.03, 0.3, 0, 0.1, -0.08, 0x23251f);
      g.box(0.07, 0.07, 0.2, 0, 0.03, -0.32, 0x23251f);
      g.box(0.01, 0.12, 0.01, 0.03, -0.06, -0.55, 0x222222); g.box(0.01, 0.12, 0.01, -0.03, -0.06, -0.55, 0x222222);
      g.box(0.055, 0.1, 0.24, 0, 0.0, 0.25, 0x3b3f36);
      grip(0x1b1b1b);
      mag = g.add(new Node('mag')); mag.pos = [0, -0.04, -0.08];
      mag.box(0.12, 0.13, 0.12, -0.03, -0.07, 0, 0x4a5a3a);
      mag.box(0.02, 0.04, 0.08, 0.04, 0.02, 0, 0xb08a3a);   // belt
      muzzle = [0, 0.05, -0.75]; fore = [0, -0.02, -0.3]; kind = 'lmg';
      break;
    }
    case 'vex': {
      g.box(0.036, 0.045, 0.2, 0, 0.045, -0.06, 0x2d3036);
      g.box(0.032, 0.025, 0.17, 0, 0.012, -0.05, 0x3d4a3a);
      const gr = g.add(new Node('grip')); gr.pos = [0, 0, 0.025]; gr.rot = [0.25, 0, 0];
      gr.box(0.032, 0.1, 0.05, 0, -0.055, 0, 0x3d4a3a);
      mag = gr.add(new Node('mag')); mag.pos = [0, -0.1, 0];
      mag.box(0.028, 0.06, 0.044, 0, -0.02, 0, 0x151515);
      muzzle = [0, 0.045, -0.17]; fore = [0, -0.07, 0.02]; kind = 'pistol';
      break;
    }
    case 'he': case 'flash': case 'smoke': {
      const col = id === 'he' ? 0x3c4a2e : id === 'flash' ? 0x8a8f96 : 0x5a6a7a;
      if (id === 'he') g.box(0.075, 0.08, 0.075, 0, 0.0, 0, col);
      else g.box(0.06, 0.12, 0.06, 0, 0.02, 0, col);
      g.box(0.035, 0.025, 0.035, 0, id === 'he' ? 0.05 : 0.09, 0, 0x777777);
      g.box(0.012, 0.06, 0.018, 0.03, id === 'he' ? 0.03 : 0.06, 0.0, 0x999999);   // spoon
      const pin = g.add(new Node('pin')); pin.pos = [-0.025, id === 'he' ? 0.065 : 0.105, 0];
      pin.box(0.03, 0.03, 0.006, 0, 0, 0, 0xc0c0c0);
      if (id !== 'he') g.box(0.062, 0.02, 0.062, 0, -0.02, 0, id === 'flash' ? 0xe0e0e0 : 0x8aa0b0);
      muzzle = [0, 0, 0]; fore = [0, -0.03, 0.02]; kind = 'grenade';
      break;
    }
    default: { // knife
      g.box(0.03, 0.035, 0.12, 0, 0, 0.03, 0x1b1b1b);
      g.box(0.032, 0.008, 0.11, 0, 0.0, 0.03, 0x3a3a3a);
      g.box(0.055, 0.045, 0.014, 0, 0, -0.035, 0x555555);
      g.box(0.008, 0.042, 0.2, 0, 0.004, -0.14, 0xc8ccd2);
      g.box(0.009, 0.01, 0.2, 0, 0.026, -0.14, 0x8f949b);
      g.box(0.008, 0.02, 0.04, 0, 0.012, -0.255, 0xdfe3e8);
      muzzle = [0, 0, -0.27]; fore = [0, -0.05, 0.03]; kind = 'knife';
    }
  }
  return { root: g, mag, muzzle, grip: [0, -0.06, 0.04], fore, kind, id };
}

export function buildBomb() {
  const b = new Node('bomb');
  b.box(0.36, 0.13, 0.24, 0, 0.065, 0, 0x5c5a3a);
  for (let i = 0; i < 4; i++) b.box(0.07, 0.07, 0.26, -0.13 + i * 0.087, 0.16, 0, 0xb3322a);
  b.box(0.14, 0.03, 0.1, 0.06, 0.2, 0.02, 0x1d1d1d);
  b.box(0.1, 0.02, 0.04, 0.06, 0.218, -0.02, 0x2e5f2a, 0.6);
  b.box(0.02, 0.1, 0.02, -0.15, 0.24, 0.1, 0x7a7a7a);
  const led = new Node('led');
  led.box(0.03, 0.03, 0.03, 0.12, 0.22, 0.06, 0xff2a2a, 1);
  b.add(led);
  return { root: b, led };
}

export class Avatar {
  constructor(team) {
    this.team = team;
    this.root = new Node('avatar');
    this.walkPhase = 0;
    this.walkAmt = 0;
    this.crouchAmt = 0;
    this.deathT = 0;
    this.gunId = null;
    this.gun = null;
    this.recoil = 0;
    this.build(team);
  }
  build(team) {
    const st = TEAM_STYLE[team] || TEAM_STYLE.T;
    const ct = team === 'CT';
    const r = this.root;
    r.children = []; r.boxes = [];
    this.hips = r.add(new Node('hips'));
    this.hips.pos = [0, 0.75, 0];
    this.legL = this.hips.add(new Node('legL')); this.legL.pos = [-0.12, 0, 0];
    this.legR = this.hips.add(new Node('legR')); this.legR.pos = [0.12, 0, 0];
    for (const l of [this.legL, this.legR]) {
      l.box(0.21, 0.36, 0.23, 0, -0.18, 0, st.pants);                 // thigh
      l.box(0.2, 0.28, 0.21, 0, -0.5, 0, st.pants);                   // shin
      l.box(0.22, 0.12, 0.08, 0, -0.38, -0.12, ct ? 0x2a2f36 : 0x3b3127); // knee pad
      l.box(0.23, 0.14, 0.29, 0, -0.68, -0.03, 0x231e19);              // boot
      l.box(0.235, 0.03, 0.3, 0, -0.745, -0.03, 0x151210);             // sole
    }
    this.legR.box(0.06, 0.16, 0.12, 0.13, -0.16, 0.02, 0x2a2420);       // thigh holster
    this.torso = this.hips.add(new Node('torso'));
    this.torso.box(0.5, 0.6, 0.28, 0, 0.3, 0, st.shirt);
    this.torso.box(0.53, 0.4, 0.32, 0, 0.32, 0, st.vest);
    this.torso.box(0.54, 0.07, 0.31, 0, 0.04, 0, 0x2a2420);              // belt
    this.torso.box(0.08, 0.06, 0.04, 0, 0.04, -0.16, 0x9a8a5a);          // buckle
    for (const x of [-0.17, -0.06, 0.05]) this.torso.box(0.09, 0.12, 0.05, x, 0.28, -0.18, ct ? 0x2a3540 : 0x4a3d2c); // mag pouches
    this.torso.box(0.12, 0.1, 0.04, 0.17, 0.42, -0.17, st.accent, 0.15); // patch
    this.torso.box(0.2, 0.06, 0.32, -0.16, 0.56, 0, st.vest);            // shoulder straps
    this.torso.box(0.2, 0.06, 0.32, 0.16, 0.56, 0, st.vest);
    // backpack: CT radio with antenna, T satchel
    if (ct) {
      this.torso.box(0.36, 0.38, 0.14, 0, 0.32, 0.22, 0x2b3440);
      this.torso.box(0.1, 0.08, 0.04, 0.1, 0.42, 0.3, 0x46c070, 0.8);
      this.torso.box(0.02, 0.42, 0.02, -0.12, 0.7, 0.25, 0x111111);
    } else {
      this.torso.box(0.38, 0.34, 0.16, 0, 0.3, 0.23, 0x6a5232);
      this.torso.box(0.38, 0.06, 0.17, 0, 0.42, 0.23, 0x4a3a24);
    }
    this.head = this.torso.add(new Node('head')); this.head.pos = [0, 0.6, 0];
    this.head.box(0.4, 0.4, 0.4, 0, 0.21, 0, st.skin);
    this.head.box(0.07, 0.05, 0.02, -0.09, 0.25, -0.205, 0x1b1b1b);      // eyes
    this.head.box(0.07, 0.05, 0.02, 0.09, 0.25, -0.205, 0x1b1b1b);
    this.head.box(0.06, 0.07, 0.04, 0, 0.18, -0.215, st.skin);            // nose
    if (!ct) {
      this.head.box(0.42, 0.2, 0.42, 0, 0.1, 0, st.mask);                 // balaclava lower
      this.head.box(0.42, 0.12, 0.42, 0, 0.37, 0, st.mask);               // balaclava top
      this.head.box(0.32, 0.02, 0.02, 0, 0.3, -0.212, 0x111111);
      this.head.box(0.12, 0.06, 0.03, 0, 0.42, -0.2, 0xb33a2a);            // headband knot
    } else {
      this.head.box(0.46, 0.16, 0.46, 0, 0.38, 0, 0x3d4a3a);              // helmet
      this.head.box(0.48, 0.04, 0.48, 0, 0.3, 0, 0x2f3a2c);               // helmet rim
      this.head.box(0.34, 0.08, 0.04, 0, 0.36, -0.225, 0x1a1a1a);         // goggles strap/frame
      this.head.box(0.3, 0.06, 0.02, 0, 0.36, -0.245, st.accent, 0.6);     // lens
      this.head.box(0.32, 0.12, 0.03, 0, 0.09, -0.205, st.mask);           // face mask
      this.head.box(0.06, 0.1, 0.06, -0.24, 0.24, 0, 0x1a1a1a);            // headset
    }
    this.armR = this.torso.add(new Node('armR')); this.armR.pos = [0.32, 0.55, 0];
    this.armL = this.torso.add(new Node('armL')); this.armL.pos = [-0.32, 0.55, 0];
    for (const a of [this.armR, this.armL]) {
      a.box(0.16, 0.2, 0.16, 0, -0.08, 0, st.vest);                       // shoulder pad
      a.box(0.15, 0.36, 0.15, 0, -0.2, 0, st.sleeve);
      a.box(0.14, 0.24, 0.14, 0, -0.46, 0, ct ? st.sleeve : st.skin);
      a.box(0.16, 0.06, 0.16, 0, -0.36, 0, ct ? 0x23282e : st.sleeve);    // rolled sleeve / elbow pad
      a.box(0.15, 0.11, 0.15, 0, -0.61, 0, st.glove);
    }
    this.gunMount = this.armR.add(new Node('gunMount'));
    this.gunMount.pos = [0, -0.62, 0.02];
    this.gunMount.rot = [-Math.PI / 2, 0, 0];
    this.gunId = null;
  }
  setWeapon(id) {
    if (this.gunId === id) return;
    this.gunId = id;
    this.gunMount.children = [];
    this.gun = buildGun(id);
    this.gunMount.add(this.gun.root);
  }
  /** world-space muzzle position (after update) */
  muzzleWorld() {
    if (!this.gun) return null;
    const m = this.gun.root.world, p = this.gun.muzzle;
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  }
  /**
   * st: {x,y,z,yaw,pitch,crouch,alive,speed,onGround,reloading,planting,time}
   */
  update(dt, st) {
    const r = this.root;
    r.pos = [st.x, st.y, st.z];
    r.rot = [0, st.yaw, 0];
    // death fall
    if (!st.alive) {
      this.deathT = Math.min(1, this.deathT + dt * 2.4);
      const t = this.deathT;
      r.rot[0] = (Math.PI / 2) * (t * t);
      r.pos = [st.x, st.y + 0.1 * Math.sin(t * Math.PI), st.z];
      this.armR.rot = [Math.PI * 0.9 * t, 0, 0.3 * t];
      this.armL.rot = [Math.PI * 0.9 * t, 0, -0.3 * t];
      r.update(null);
      return;
    }
    this.deathT = 0;
    const speed = st.speed || 0;
    const moving = st.onGround ? Math.min(1, speed / 6.5) : 0.2;
    this.walkAmt += (moving - this.walkAmt) * Math.min(1, dt * 10);
    this.walkPhase += dt * (3 + speed * 1.75);
    const crouchTarget = st.crouch || st.planting ? 1 : 0;
    this.crouchAmt += (crouchTarget - this.crouchAmt) * Math.min(1, dt * 12);
    const sw = Math.sin(this.walkPhase) * 0.85 * this.walkAmt;
    const c = this.crouchAmt;
    this.hips.pos = [0, 0.75 - 0.4 * c + Math.abs(Math.cos(this.walkPhase)) * 0.04 * this.walkAmt, 0];
    this.legL.rot = [sw - 1.0 * c, 0, 0];
    this.legR.rot = [-sw - 0.6 * c, 0, 0];
    this.torso.rot = [-0.12 * c - 0.08 * this.walkAmt + (st.onGround ? 0 : -0.1), Math.sin(this.walkPhase) * 0.06 * this.walkAmt, Math.sin(this.walkPhase) * 0.035 * this.walkAmt];
    this.head.rot = [st.pitch * 0.55, 0, 0];
    this.recoil = Math.max(0, this.recoil - dt * 8);
    const aim = Math.PI / 2 + st.pitch * 0.85 + this.recoil * 0.25;
    const kind = this.gun ? this.gun.kind : 'rifle';
    if (st.planting) {
      this.armR.rot = [0.8, 0, 0.1];
      this.armL.rot = [0.8, 0, -0.1];
    } else if (kind === 'knife') {
      this.armR.rot = [aim * 0.6 + sw * 0.2, 0, 0.1];
      this.armL.rot = [-sw * 0.6, 0, -0.08];
    } else if (kind === 'pistol') {
      this.armR.rot = [aim, -0.2, 0];
      this.armL.rot = [aim, 0.45, 0];
    } else {
      this.armR.rot = [aim, -0.1, 0];
      const reloadWobble = st.reloading ? Math.sin(st.time * 9) * 0.5 - 0.5 : 0;
      this.armL.rot = [aim - 0.15 + reloadWobble, 0.6, 0];
    }
    r.update(null);
  }
}

/**
 * Side-view silhouette icon of a weapon (PNG data URL) generated from its voxel model.
 * Used in the kill feed, buy menu and HUD.
 */
const iconCache = {};
export function weaponIcon(id, color) {
  const key = id + (color || '');
  if (iconCache[key]) return iconCache[key];
  const gun = buildGun(id);
  gun.root.update(null);
  const rects = [];
  const walk = (n) => {
    if (n.visible === false) return;
    for (const b of n.boxes) {
      const m = n.world;
      // project the 4 side corners (z → x axis, y → y axis)
      const pts = [];
      for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
        const lx = b.o[0], ly = b.o[1] + sy * b.s[1], lz = b.o[2] + sz * b.s[2];
        pts.push([m[2] * lx + m[6] * ly + m[10] * lz + m[14], m[1] * lx + m[5] * ly + m[9] * lz + m[13]]);
      }
      rects.push(pts);
    }
    for (const c of n.children) walk(c);
  };
  walk(gun.root);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of rects) for (const [x, y] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const W = 120, H = 44, pad = 3;
  const sc = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxY - minY || 1));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = color || '#ffffff';
  const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
  for (const r of rects) {
    ctx.beginPath();
    // order corners to a quad: (0,0),(0,1),(1,1),(1,0)
    const q = [r[0], r[1], r[3], r[2]];
    q.forEach(([x, y], i) => {
      const px = W - (ox + (x - minX) * sc), py = H - (oy + (y - minY) * sc);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath(); ctx.fill();
  }
  return (iconCache[key] = cv.toDataURL());
}
