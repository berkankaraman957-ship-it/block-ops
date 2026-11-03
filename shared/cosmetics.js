/*
 * BLOCK OPS — cosmetics + progression rules (shared by server and client).
 *
 * IMPORTANT DESIGN RULE: everything in this file is PURELY VISUAL. Skins never change
 * damage, recoil, speed, sound or hitboxes, and never make a player harder to see
 * (no dark/foliage camouflage on agents; team colours always stay readable).
 *
 * Currency: "Blok Coin" (BC). Earned by playing. Real-money coin packs are listed in
 * COIN_PACKS for the future store release (server-side receipt validation hooks in
 * server/store.js -> grantCoins) but are NOT purchasable yet.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.COSMETICS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RARITY = {
    common: { label: 'SIRADAN', color: '#9fb0c0', price: 300 },
    rare: { label: 'NADİR', color: '#4b9bff', price: 800 },
    epic: { label: 'EPİK', color: '#b05cff', price: 1800 },
    legendary: { label: 'EFSANEVİ', color: '#ffb02e', price: 4000 }
  };

  /*
   * Weapon skins. A skin is bought ONCE and can then be equipped on ANY weapon.
   * mode: how the palette is applied to the voxel gun model (see public/js/models.js applySkin)
   *   tint     – whole gun tinted with pal[0], keeps the model's light/dark shading
   *   camo     – each part picks a colour from pal (deterministic pattern)
   *   two      – body pal[0], every 3rd part accent pal[1]
   *   metal    – shiny metal (pal[0]) with a subtle glow
   *   neon     – dark body pal[0], glowing accent parts pal[1]
   *   gradient – front-to-back gradient pal[0] → pal[1]
   */
  const SKINS = {
    desert_camo: { name: 'Çöl Kamuflaj', rarity: 'common', mode: 'camo', pal: [0xc9a46a, 0x9b7a4a, 0xe0c890, 0x7a5f3a] },
    forest_camo: { name: 'Orman Kamuflaj', rarity: 'common', mode: 'camo', pal: [0x4f6b3a, 0x2f4a2a, 0x7a8a50, 0x5a4a32] },
    urban_digital: { name: 'Şehir Dijital', rarity: 'common', mode: 'camo', pal: [0x6a6e74, 0x3a3e44, 0x9aa0a8, 0x2a2c30] },
    arctic: { name: 'Kutup', rarity: 'common', mode: 'camo', pal: [0xe8eef4, 0xb8c6d4, 0xd0dae4, 0x8a9aaa] },
    crimson: { name: 'Kızıl Gece', rarity: 'rare', mode: 'tint', pal: [0xc0303a] },
    cobalt: { name: 'Kobalt', rarity: 'rare', mode: 'tint', pal: [0x2f6fe0] },
    tiger: { name: 'Kaplan', rarity: 'rare', mode: 'two', pal: [0xf08a1c, 0x1a1410] },
    mint: { name: 'Nane', rarity: 'rare', mode: 'two', pal: [0x7fe0c0, 0xf4f4f4] },
    neon_drift: { name: 'Neon Drift', rarity: 'epic', mode: 'neon', pal: [0x1a1a24, 0x37f0ff] },
    toxic: { name: 'Toksik', rarity: 'epic', mode: 'neon', pal: [0x1c2418, 0x8aff3a] },
    carbon: { name: 'Karbon Fiber', rarity: 'epic', mode: 'camo', pal: [0x2a2a2e, 0x1a1a1c, 0x3a3a40, 0x222226] },
    sunset: { name: 'Gün Batımı', rarity: 'epic', mode: 'gradient', pal: [0xff5a7a, 0xffc040] },
    gold: { name: 'Saf Altın', rarity: 'legendary', mode: 'metal', pal: [0xffc83a] },
    diamond: { name: 'Elmas', rarity: 'legendary', mode: 'metal', pal: [0x9ef0ff] },
    lava: { name: 'Lav Akışı', rarity: 'legendary', mode: 'gradient', pal: [0xff3a10, 0x2a0a06], glow: 0.35 },
    galaxy: { name: 'Galaksi', rarity: 'legendary', mode: 'neon', pal: [0x241a48, 0xff6af0] }
  };
  for (const id of Object.keys(SKINS)) { SKINS[id].id = id; SKINS[id].price = RARITY[SKINS[id].rarity].price; }

  /*
   * Agent accents: small colour details (shoulder patch, goggles lens, headband).
   * Team shirt/vest colours are NEVER changed, so teams stay instantly readable.
   */
  const AGENTS = {
    default: { name: 'Standart', price: 0, color: null },
    ember: { name: 'Kor', price: 500, color: 0xff5a2a },
    viper: { name: 'Engerek', price: 500, color: 0x3aff7a },
    royal: { name: 'Kraliyet', price: 900, color: 0xa05aff },
    ice: { name: 'Buz', price: 900, color: 0x8af0ff },
    gold: { name: 'Altın Rozet', price: 2000, color: 0xffd23a }
  };
  for (const id of Object.keys(AGENTS)) AGENTS[id].id = id;

  /* Future real-money packs (shown as "yakında" until store billing is connected). */
  const COIN_PACKS = [
    { id: 'bc_500', coins: 500, bonus: 0, label: '₺29,99' },
    { id: 'bc_1200', coins: 1200, bonus: 100, label: '₺59,99' },
    { id: 'bc_2600', coins: 2600, bonus: 400, label: '₺119,99' },
    { id: 'bc_6000', coins: 6000, bonus: 1500, label: '₺249,99' }
  ];

  // ---------------------------------------------------------------- progression
  /** XP needed to go from level L to L+1 */
  function xpForLevel(l) { return 500 + (l - 1) * 150; }
  function levelFromXp(xp) {
    let l = 1, need = xpForLevel(1);
    while (xp >= need && l < 200) { xp -= need; l++; need = xpForLevel(l); }
    return { level: l, into: xp, need };
  }
  const XP = { PLAYED: 100, KILL: 20, HEADSHOT: 5, ASSIST: 8, MVP: 25, ROUND_WIN: 15, MATCH_WIN: 200, ABANDON_MUL: 0.3 };
  const COINS = { BASE: 20, PER_KILL: 2, WIN: 40, MAX_PER_MATCH: 120, LEVEL_UP: 100, NEW_ACCOUNT: 300 };

  const RANKS = [
    { id: 'bronze', name: 'Bronz', min: 0, color: '#c9824a', icon: '🥉' },
    { id: 'silver', name: 'Gümüş', min: 1100, color: '#c0c8d4', icon: '🥈' },
    { id: 'gold', name: 'Altın', min: 1300, color: '#ffc83a', icon: '🥇' },
    { id: 'platinum', name: 'Platin', min: 1500, color: '#5fe0d0', icon: '💠' },
    { id: 'diamond', name: 'Elmas', min: 1700, color: '#7ab8ff', icon: '💎' },
    { id: 'master', name: 'Usta', min: 1900, color: '#ff6a8a', icon: '👑' }
  ];
  function rankOf(points) {
    let r = RANKS[0];
    for (const x of RANKS) if (points >= x.min) r = x;
    return r;
  }
  /** rank-point change for one ranked match */
  function rankDelta(result, kills, deaths, mvps) {
    if (result === 'abandon') return -25;
    const perf = Math.max(-5, Math.min(8, kills - deaths)) + mvps * 2;
    if (result === 'win') return Math.round(22 + perf);
    if (result === 'loss') return Math.round(-18 + perf * 0.5);
    return Math.round(perf * 0.5);
  }

  /** weapons that can carry a skin (all guns + knife) */
  function skinnable(WEAPONS) { return Object.keys(WEAPONS).filter((id) => !WEAPONS[id].grenade); }

  return { RARITY, SKINS, AGENTS, COIN_PACKS, XP, COINS, RANKS, xpForLevel, levelFromXp, rankOf, rankDelta, skinnable };
});
