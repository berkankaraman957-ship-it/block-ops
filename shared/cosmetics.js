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
   * Weapon skins — every weapon has its OWN collection (5 skins each, unique names and looks).
   * A skin belongs to exactly one weapon: buying "Krait | Ejderha Nefesi" only skins the Krait.
   * mode: how the palette is applied to the voxel gun model (public/js/models.js applySkin)
   *   tint     – whole gun tinted with pal[0], keeps the model's light/dark shading
   *   camo     – each part picks a colour from pal (deterministic pattern)
   *   stripes  – parts alternate through pal in order (bands)
   *   two      – body pal[0], every 3rd part accent pal[1]
   *   split    – front half pal[0], rear half pal[1]
   *   metal    – shiny metal (pal[0]) with a subtle glow; metal2 adds pal[1] accents
   *   neon     – dark body pal[0], glowing accent parts pal[1]
   *   gradient – front-to-back gradient pal[0] → pal[1] (optional glow)
   */
  // [slug, name, rarity, mode, palette, glow?]
  const COLLECTIONS = {
    knife: [
      ['urban', 'Şehir Avcısı', 'common', 'camo', [0x6a6e74, 0x3a3e44, 0x9aa0a8]],
      ['ocean', 'Okyanus Dalgası', 'rare', 'gradient', [0x2a8aff, 0x0a2a5a]],
      ['damascus', 'Şam Çeliği', 'epic', 'stripes', [0xc8ccd4, 0x5a5e66, 0x9a9ea6, 0x3a3e46]],
      ['plasma', 'Plazma', 'epic', 'neon', [0x140a24, 0xd040ff]],
      ['dragon', 'Ejder Pulu', 'legendary', 'gradient', [0xff3a10, 0xffd040], 0.35]
    ],
    p9: [
      ['sand', 'Kum Fırtınası', 'common', 'camo', [0xc9a46a, 0x9b7a4a, 0xe0c890]],
      ['candy', 'Şekerleme', 'rare', 'stripes', [0xff6ab0, 0xfff0f6]],
      ['ruby', 'Yakut', 'rare', 'tint', [0xd0203a]],
      ['circuit', 'Devre Kartı', 'epic', 'neon', [0x10241a, 0x30ff90]],
      ['pharaoh', 'Firavun', 'legendary', 'metal2', [0xffc83a, 0x1a3aa0]]
    ],
    p12: [
      ['police', 'Devriye', 'common', 'two', [0x1c2a4a, 0xe8eef4]],
      ['olive', 'Zeytin', 'common', 'tint', [0x6a7a3a]],
      ['glacier', 'Buzul', 'rare', 'gradient', [0xe8f8ff, 0x5ab0e0]],
      ['siren', 'Siren', 'epic', 'split', [0xff2a3a, 0x2a6aff]],
      ['royal', 'Kraliyet Mühürü', 'legendary', 'metal2', [0xe0e4ea, 0x8a2ad0]]
    ],
    vex: [
      ['rust', 'Pas', 'common', 'camo', [0x8a4a2a, 0x5a3020, 0xb06a3a]],
      ['lemon', 'Limon', 'rare', 'two', [0xffe040, 0x2a2a2a]],
      ['hornet', 'Eşek Arısı', 'rare', 'stripes', [0xffc020, 0x1a1a1a]],
      ['glitch', 'Bozuk Sinyal', 'epic', 'neon', [0x1a1a2a, 0xff3af0]],
      ['inferno', 'Cehennem', 'legendary', 'gradient', [0xffe060, 0xb01a0a], 0.4]
    ],
    hc50: [
      ['gunmetal', 'Namlu Çeliği', 'common', 'tint', [0x5a6068]],
      ['marble', 'Mermer', 'rare', 'camo', [0xf0f0ec, 0xc8c8c4, 0x9a9a98]],
      ['cobra', 'Kobra', 'rare', 'two', [0x2a5a2a, 0xe0c040]],
      ['eclipse', 'Tutulma', 'epic', 'split', [0x101014, 0xffb030]],
      ['emperor', 'İmparator', 'legendary', 'metal', [0xffd84a]]
    ],
    viper: [
      ['swamp', 'Bataklık', 'common', 'camo', [0x3a4a2a, 0x5a6a3a, 0x2a3020]],
      ['bubblegum', 'Sakız', 'rare', 'tint', [0xff8ad0]],
      ['scale', 'Yılan Derisi', 'rare', 'stripes', [0x2e8b57, 0x9ad04a, 0x1a3a20]],
      ['venom', 'Zehir', 'epic', 'neon', [0x1a2414, 0xa0ff2a]],
      ['basilisk', 'Basilisk', 'legendary', 'gradient', [0x3aff9a, 0x0a3a2a], 0.3]
    ],
    wasp: [
      ['concrete', 'Beton', 'common', 'camo', [0x8a8a88, 0x6a6a68, 0xaaaaa8]],
      ['coral', 'Mercan', 'rare', 'two', [0xff7a5a, 0xfff0e0]],
      ['nightshift', 'Gece Vardiyası', 'rare', 'tint', [0x2a2a5a]],
      ['laser', 'Lazer', 'epic', 'neon', [0x0a0a14, 0xff2a2a]],
      ['aurora', 'Kuzey Işıkları', 'legendary', 'gradient', [0x3affc0, 0x7a2aff], 0.3]
    ],
    hornet: [
      ['tactical', 'Taktik Gri', 'common', 'tint', [0x6a6e6a]],
      ['safari', 'Safari', 'common', 'camo', [0xd0b070, 0x8a6a3a, 0x5a4a2a]],
      ['wasabi', 'Vasabi', 'rare', 'two', [0x8ad04a, 0x1a1a1a]],
      ['hive', 'Kovan', 'epic', 'stripes', [0xffb020, 0x2a1a0a, 0xffe080]],
      ['queen', 'Arı Kraliçesi', 'legendary', 'metal2', [0xffc83a, 0x1a1a1a]]
    ],
    breacher: [
      ['barn', 'Ahır Kapısı', 'common', 'tint', [0x8a3a2a]],
      ['woodland', 'Koru', 'common', 'camo', [0x4a5a2a, 0x6a4a2a, 0x2a3a1a]],
      ['harlequin', 'Soytarı', 'rare', 'stripes', [0xd02a3a, 0xf0f0f0, 0x1a1a1a]],
      ['thunder', 'Gök Gürültüsü', 'epic', 'neon', [0x1a1a2a, 0x6ab0ff]],
      ['magma', 'Magma Çekirdeği', 'legendary', 'gradient', [0xff6a10, 0x1a0a06], 0.45]
    ],
    mauler: [
      ['steel', 'Çelik Pençe', 'common', 'tint', [0x7a8088]],
      ['jungle', 'Cangıl', 'common', 'camo', [0x2a5a2a, 0x4a7a3a, 0x1a3a1a]],
      ['warning', 'Tehlike Bandı', 'rare', 'stripes', [0xffc020, 0x1a1a1a]],
      ['phantom', 'Hayalet', 'epic', 'split', [0xf0f4f8, 0x3a3e44]],
      ['titanfall', 'Kızıl Çekiç', 'legendary', 'metal2', [0xd0303a, 0xffd84a]]
    ],
    titan: [
      ['desert_storm', 'Çöl Harekâtı', 'common', 'camo', [0xc9a46a, 0x9b7a4a, 0x7a5f3a]],
      ['tundra', 'Tundra', 'rare', 'camo', [0xe8eef4, 0xa0b0c0, 0x6a7a8a]],
      ['warlord', 'Savaş Ağası', 'rare', 'two', [0x3a2a1a, 0xc04a2a]],
      ['overcharge', 'Aşırı Yük', 'epic', 'neon', [0x14181e, 0x3ac0ff]],
      ['colossus', 'Kolos', 'legendary', 'metal', [0xc8d0dc]]
    ],
    falcon: [
      ['savanna', 'Savan', 'common', 'camo', [0xd0b070, 0xa08040, 0x6a5a30]],
      ['skyline', 'Ufuk', 'rare', 'gradient', [0x8ad0ff, 0xff9a6a]],
      ['peregrine', 'Gökdoğan', 'rare', 'two', [0x4a3a2a, 0xe0e0d8]],
      ['stormbird', 'Fırtına Kuşu', 'epic', 'neon', [0x1a1e2a, 0xffe040]],
      ['phoenix', 'Anka Kuşu', 'legendary', 'gradient', [0xffd040, 0xd0200a], 0.4]
    ],
    lynx: [
      ['snowcat', 'Kar Kedisi', 'common', 'camo', [0xf0f4f8, 0xc0c8d0, 0x8a96a2]],
      ['midnight', 'Gece Yarısı', 'rare', 'tint', [0x1a2a5a]],
      ['tabby', 'Tekir', 'rare', 'stripes', [0xd08a3a, 0x5a3a1a]],
      ['cyber', 'Siber Pençe', 'epic', 'neon', [0x10141e, 0x3affe0]],
      ['sphinx', 'Sfenks', 'legendary', 'metal2', [0xffd84a, 0x3a8aff]]
    ],
    krait: [
      ['desert', 'Çöl Kamuflaj', 'common', 'camo', [0xc9a46a, 0x9b7a4a, 0xe0c890, 0x7a5f3a]],
      ['redline', 'Kırmızı Çizgi', 'rare', 'two', [0x2a2a2e, 0xe0303a]],
      ['jade', 'Yeşim', 'rare', 'tint', [0x2aa07a]],
      ['neon_drift', 'Neon Drift', 'epic', 'neon', [0x1a1a24, 0x37f0ff]],
      ['dragon_breath', 'Ejderha Nefesi', 'legendary', 'gradient', [0xff3a10, 0x2a0a06], 0.4]
    ],
    sentinel: [
      ['urban_digital', 'Şehir Dijital', 'common', 'camo', [0x6a6e74, 0x3a3e44, 0x9aa0a8, 0x2a2c30]],
      ['cobalt', 'Kobalt', 'rare', 'tint', [0x2f6fe0]],
      ['guardian', 'Muhafız', 'rare', 'split', [0xe8eef4, 0x2a4a8a]],
      ['nova', 'Süpernova', 'epic', 'neon', [0x141428, 0xff8a2a]],
      ['diamond', 'Elmas', 'legendary', 'metal', [0x9ef0ff]]
    ],
    ranger: [
      ['forest', 'Orman Kamuflaj', 'common', 'camo', [0x4f6b3a, 0x2f4a2a, 0x7a8a50]],
      ['hunter', 'Avcı Turuncusu', 'rare', 'two', [0x5a4a2a, 0xff7a1a]],
      ['carbon', 'Karbon Fiber', 'rare', 'stripes', [0x2a2a2e, 0x1a1a1c, 0x3a3a40]],
      ['frost', 'Kırağı', 'epic', 'gradient', [0xffffff, 0x3a8aca], 0.15],
      ['galaxy', 'Galaksi', 'legendary', 'neon', [0x241a48, 0xff6af0]]
    ],
    longshot: [
      ['ghillie', 'Pusu', 'common', 'camo', [0x4a5a2a, 0x6a7a3a, 0x3a3a20, 0x5a4a2a]],
      ['arctic', 'Kutup', 'rare', 'camo', [0xe8eef4, 0xb8c6d4, 0xd0dae4, 0x8a9aaa]],
      ['sunset', 'Gün Batımı', 'rare', 'gradient', [0xff5a7a, 0xffc040]],
      ['dragon_lore', 'Ejder Efsanesi', 'epic', 'metal2', [0xd0b070, 0xc0302a]],
      ['gold', 'Saf Altın', 'legendary', 'metal', [0xffc83a]]
    ]
  };
  const SKINS = {};
  const BY_WEAPON = {};
  for (const [weapon, list] of Object.entries(COLLECTIONS)) {
    BY_WEAPON[weapon] = [];
    for (const [slug, name, rarity, mode, pal, glow] of list) {
      const id = weapon + '_' + slug;
      SKINS[id] = { id, weapon, name, rarity, mode, pal, glow: glow || 0 };
      BY_WEAPON[weapon].push(id);
    }
  }
  for (const id of Object.keys(SKINS)) SKINS[id].price = RARITY[SKINS[id].rarity].price;
  /** the skin ids of one weapon's collection */
  function skinsFor(weapon) { return (BY_WEAPON[weapon] || []).map((id) => SKINS[id]); }

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
  function skinnable(WEAPONS) { return Object.keys(WEAPONS).filter((id) => !WEAPONS[id].grenade && BY_WEAPON[id]); }

  return { RARITY, SKINS, COLLECTIONS, skinsFor, AGENTS, COIN_PACKS, XP, COINS, RANKS, xpForLevel, levelFromXp, rankOf, rankDelta, skinnable };
});
