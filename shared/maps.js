/*
 * BLOCK OPS — map layouts. Each map is generated from code (no asset files) and is
 * identical on server and client. Bots navigate automatically via A* (shared.js).
 * Coordinate system: x → east, z → north (T spawn south / low z, CT spawn north / high z).
 */
(function (root, def) {
  if (typeof module === 'object' && module.exports) module.exports = def;
  else def(root.SHARED);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';
  const B = S.BLOCK;

  const SPAWNS = {
    T: [[26.5, 1, 4.5], [29.5, 1, 4.5], [32.5, 1, 4.5], [35.5, 1, 4.5], [38.5, 1, 4.5],
        [26.5, 1, 8.5], [29.5, 1, 8.5], [32.5, 1, 8.5], [35.5, 1, 8.5], [38.5, 1, 8.5]],
    CT: [[26.5, 1, 60.5], [29.5, 1, 60.5], [32.5, 1, 60.5], [35.5, 1, 60.5], [38.5, 1, 60.5],
         [26.5, 1, 57.5], [29.5, 1, 57.5], [32.5, 1, 57.5], [35.5, 1, 57.5], [38.5, 1, 57.5]]
  };
  const SPAWN_YAW = { T: Math.PI, CT: 0 };
  const BUY_ZONES = { T: { x0: 1, x1: 63, z0: 1, z1: 12 }, CT: { x0: 1, x1: 63, z0: 53, z1: 63 } };

  function border(box, floor, wall) {
    box(0, 0, 0, 63, 0, 63, floor);
    box(0, 1, 0, 63, 9, 0, wall); box(0, 1, 63, 63, 9, 63, wall);
    box(0, 1, 0, 0, 9, 63, wall); box(63, 1, 0, 63, 9, 63, wall);
  }
  function tree(box, x, z, h) {
    box(x, 1, z, x, h, z, B.WOOD);
    box(x - 1, h, z - 1, x + 1, h + 1, z + 1, B.LEAVES);
    box(x, h + 2, z, x, h + 2, z, B.LEAVES);
    box(x, h, z, x, h, z, B.WOOD);
  }
  /** hollow building with walls `wall`, roof `roof` (null = open) */
  function shell(box, x0, z0, x1, z1, h, wall, roof) {
    box(x0, 1, z0, x1, h, z1, wall);
    box(x0 + 1, 1, z0 + 1, x1 - 1, h, z1 - 1, B.AIR);
    if (roof) box(x0, h + 1, z0, x1, h + 1, z1, roof);
  }

  // =========================================================================
  // 1) DUSTGRID — desert town, two big blocks, mid doors, breakable plank windows
  // =========================================================================
  S.registerMap({
    id: 'dustgrid', name: 'Dustgrid', desc: 'Çöl kasabası · klasik üç koridor · kırılabilir ahşap pencereler',
    theme: { zenith: [0.36, 0.58, 0.88], horizon: [0.88, 0.85, 0.76], fog: [34, 100], sun: [0.45, 0.8, 0.35], ambient: 0.56, sunColor: [1.0, 0.95, 0.82] },
    spawns: SPAWNS, spawnYaw: SPAWN_YAW, buyZones: BUY_ZONES,
    sites: { A: { x0: 4, x1: 18, z0: 40, z1: 52 }, B: { x0: 46, x1: 60, z0: 40, z1: 52 } },
    build(W, box) {
      border(box, B.GROUND, B.WALL);
      box(5, 0, 42, 16, 0, 50, B.SITE_A);
      box(47, 0, 42, 58, 0, 50, B.SITE_B);
      box(15, 1, 12, 26, 6, 38, B.WALL);
      box(38, 1, 12, 49, 6, 38, B.WALL);
      box(15, 6, 12, 26, 6, 12, B.BRICK); box(38, 6, 12, 49, 6, 12, B.BRICK);
      box(15, 1, 25, 26, 3, 27, B.AIR);
      box(38, 1, 20, 49, 3, 22, B.AIR);
      box(15, 4, 24, 15, 4, 28, B.METAL); box(26, 4, 24, 26, 4, 28, B.METAL);
      box(38, 4, 19, 38, 4, 23, B.METAL); box(49, 4, 19, 49, 4, 23, B.METAL);
      box(1, 1, 14, 6, 6, 32, B.WALL);
      box(57, 1, 14, 62, 6, 32, B.WALL);
      box(27, 1, 37, 30, 6, 38, B.WALL);
      box(34, 1, 37, 37, 6, 38, B.WALL);
      box(31, 4, 37, 33, 6, 38, B.WALL);
      box(27, 1, 39, 28, 6, 43, B.WALL); box(36, 1, 39, 37, 6, 43, B.WALL);
      box(27, 1, 40, 28, 2, 42, B.PLANK); box(36, 1, 40, 37, 2, 42, B.PLANK);
      box(21, 1, 44, 28, 6, 52, B.WALL); box(36, 1, 44, 43, 6, 52, B.WALL);
      box(21, 6, 44, 28, 6, 44, B.BRICK); box(36, 6, 44, 43, 6, 44, B.BRICK);
      box(8, 1, 44, 9, 2, 45, B.CRATE);
      box(13, 1, 47, 14, 1, 48, B.CRATE);
      box(4, 1, 40, 7, 1, 40, B.SAND);
      box(15, 1, 50, 16, 1, 51, B.CRATE);
      box(54, 1, 44, 55, 2, 45, B.CRATE);
      box(49, 1, 47, 50, 1, 48, B.CRATE);
      box(56, 1, 40, 59, 1, 40, B.SAND);
      box(47, 1, 50, 48, 1, 51, B.CRATE);
      box(7, 1, 19, 8, 1, 20, B.CRATE); box(8, 1, 33, 9, 2, 34, B.CRATE);
      box(34, 1, 17, 35, 2, 18, B.CRATE); box(33, 1, 28, 34, 1, 29, B.CRATE);
      box(52, 1, 22, 53, 1, 23, B.CRATE); box(54, 1, 34, 55, 2, 35, B.CRATE);
      box(40, 1, 2, 41, 1, 3, B.CRATE);
      box(18, 1, 57, 19, 1, 58, B.CRATE);
      box(16, 1, 58, 16, 4, 58, B.METAL); box(48, 1, 58, 48, 4, 58, B.METAL);
      box(12, 1, 11, 14, 1, 11, B.SAND); box(50, 1, 11, 52, 1, 11, B.SAND);
      // awnings / decor
      box(14, 7, 24, 14, 7, 28, B.PLANK); box(50, 7, 19, 50, 7, 23, B.PLANK);
    }
  });

  // =========================================================================
  // 2) HARBOR — container port, B site inside a roofed warehouse
  // =========================================================================
  S.registerMap({
    id: 'harbor', name: 'Harbor', desc: 'Liman · konteyner labirenti · B bölgesi kapalı depo içinde',
    theme: { zenith: [0.42, 0.52, 0.66], horizon: [0.78, 0.8, 0.82], fog: [30, 92], sun: [-0.4, 0.75, 0.5], ambient: 0.6, sunColor: [0.95, 0.95, 1.0] },
    spawns: SPAWNS, spawnYaw: SPAWN_YAW, buyZones: BUY_ZONES,
    sites: { A: { x0: 4, x1: 19, z0: 40, z1: 51 }, B: { x0: 43, x1: 58, z0: 37, z1: 50 } },
    build(W, box) {
      border(box, B.ASPHALT, B.CONCRETE);
      // lane walls with connectors
      box(22, 1, 12, 23, 5, 36, B.CONCRETE); box(22, 1, 24, 23, 3, 26, B.AIR);
      box(39, 1, 12, 40, 5, 33, B.CONCRETE); box(39, 1, 19, 40, 3, 21, B.AIR);
      // warehouse (B site)
      shell(box, 40, 34, 61, 52, 6, B.BRICK, B.METAL);
      box(48, 1, 34, 51, 3, 34, B.AIR);        // south door
      box(40, 1, 41, 40, 3, 43, B.AIR);        // west door (mid)
      box(52, 1, 52, 55, 3, 52, B.AIR);        // north door (CT)
      box(40, 2, 46, 40, 3, 48, B.PLANK);      // breakable window
      box(47, 0, 40, 55, 0, 47, B.SITE_B);
      for (const [x, z] of [[45, 40], [56, 40], [45, 47], [56, 47]]) box(x, 1, z, x, 6, z, B.METAL);
      box(48, 1, 43, 49, 2, 44, B.CRATE); box(52, 1, 38, 53, 1, 39, B.CRATE); box(56, 1, 49, 57, 2, 50, B.CRATE);
      box(42, 1, 36, 43, 1, 37, B.SAND);
      // roof skylights for light shafts
      box(46, 7, 39, 47, 7, 41, B.AIR); box(54, 7, 45, 55, 7, 47, B.AIR);
      // B lane containers
      box(44, 1, 16, 49, 2, 18, B.CONT_B);
      box(54, 1, 22, 56, 2, 27, B.CONT_R);
      box(46, 1, 27, 51, 2, 29, B.CONT_G); box(47, 3, 27, 50, 4, 29, B.CONT_R);
      box(57, 1, 30, 60, 1, 30, B.SAND);
      box(59, 1, 14, 60, 1, 15, B.CRATE);
      // mid yard
      box(27, 1, 17, 29, 2, 22, B.CONT_R);
      box(33, 1, 25, 35, 2, 30, B.CONT_B); box(33, 3, 26, 35, 4, 29, B.CONT_G);
      box(30, 1, 33, 31, 1, 34, B.CRATE);
      box(36, 1, 14, 36, 9, 14, B.METAL); box(35, 9, 14, 37, 9, 14, B.METAL);
      // office block between mid and CT with a covered corridor
      box(24, 1, 44, 38, 6, 50, B.CONCRETE);
      box(30, 1, 44, 32, 3, 50, B.AIR);
      box(24, 6, 44, 38, 6, 44, B.BRICK);
      // A dock
      box(6, 0, 42, 17, 0, 49, B.SITE_A);
      box(6, 1, 44, 10, 2, 46, B.CONT_G);
      box(14, 1, 47, 15, 1, 48, B.CRATE);
      box(15, 1, 40, 17, 2, 42, B.CONT_R);
      box(3, 1, 50, 6, 1, 50, B.SAND);
      // A lane
      box(5, 1, 15, 7, 2, 20, B.CONT_B);
      box(10, 1, 29, 15, 2, 31, B.CONT_G);
      box(3, 1, 33, 4, 1, 34, B.CRATE);
      box(16, 1, 18, 17, 2, 19, B.CRATE);
      // spawns
      box(10, 1, 4, 15, 2, 6, B.CONT_B); box(48, 1, 3, 53, 2, 5, B.CONT_G);
      box(10, 1, 56, 15, 2, 58, B.CONT_R); box(44, 1, 57, 45, 1, 58, B.CRATE);
      // bollards on the dock edge
      for (let z = 14; z <= 50; z += 6) box(1, 1, z, 1, 1, z, B.METAL);
    }
  });

  // =========================================================================
  // 3) FROSTBITE — snowy village, rocky massif with a mid cave, cabins & pines
  // =========================================================================
  S.registerMap({
    id: 'frostbite', name: 'Frostbite', desc: 'Karlı köy · ortada mağara geçidi · kulübeler ve çam ağaçları',
    theme: { zenith: [0.52, 0.66, 0.84], horizon: [0.9, 0.93, 0.97], fog: [26, 86], sun: [0.3, 0.6, -0.5], ambient: 0.62, sunColor: [0.95, 0.97, 1.0] },
    spawns: SPAWNS, spawnYaw: SPAWN_YAW, buyZones: BUY_ZONES,
    sites: { A: { x0: 3, x1: 21, z0: 40, z1: 52 }, B: { x0: 43, x1: 60, z0: 40, z1: 52 } },
    build(W, box) {
      border(box, B.SNOW, B.STONE);
      // central massif with varied heights
      for (let z = 18; z <= 44; z++) for (let x = 24; x <= 40; x++) {
        const edge = Math.min(x - 24, 40 - x, z - 18, 44 - z);
        const h = 4 + Math.floor(S.hash3(x >> 1, 7, z >> 1) * 3) + Math.min(2, edge >> 1);
        box(x, 1, z, x, h, z, B.STONE);
        if (S.hash3(x, 9, z) > 0.55) box(x, h + 1, z, x, h + 1, z, B.SNOW);
      }
      box(30, 1, 18, 33, 3, 44, B.AIR);                 // mid cave
      box(29, 1, 30, 29, 2, 31, B.AIR); box(34, 1, 26, 34, 2, 27, B.AIR); // cave alcoves
      box(30, 4, 18, 33, 4, 18, B.WOOD); box(30, 4, 44, 33, 4, 44, B.WOOD); // timber frames
      // west lane: cabin + trees + rocks
      shell(box, 6, 18, 12, 24, 4, B.WOOD, B.PLANK);
      box(9, 1, 18, 9, 2, 18, B.AIR); box(9, 1, 24, 9, 2, 24, B.AIR);
      box(6, 2, 20, 6, 3, 21, B.ICE); box(12, 2, 21, 12, 3, 22, B.ICE);
      tree(box, 17, 28, 4); tree(box, 4, 35, 5); tree(box, 19, 14, 4);
      box(14, 1, 31, 16, 2, 33, B.STONE);
      // east lane: cabin + trees + rocks
      shell(box, 50, 22, 56, 28, 4, B.WOOD, B.PLANK);
      box(53, 1, 22, 53, 2, 22, B.AIR); box(53, 1, 28, 53, 2, 28, B.AIR);
      box(56, 2, 24, 56, 3, 25, B.ICE);
      tree(box, 45, 15, 4); tree(box, 59, 35, 5); tree(box, 44, 33, 4);
      box(52, 1, 33, 54, 1, 34, B.STONE);
      // courtyard north of the massif + lodge to CT
      shell(box, 24, 47, 40, 53, 5, B.WOOD, B.PLANK);
      box(31, 1, 47, 32, 2, 47, B.AIR); box(31, 1, 53, 32, 2, 53, B.AIR);
      box(24, 2, 49, 24, 3, 51, B.ICE); box(40, 2, 49, 40, 3, 51, B.ICE);
      box(27, 1, 49, 28, 1, 50, B.CRATE); box(36, 1, 50, 37, 2, 51, B.CRATE);
      // A site
      box(6, 0, 42, 17, 0, 49, B.SITE_A);
      box(10, 1, 44, 11, 2, 45, B.CRATE);
      box(14, 1, 47, 16, 1, 48, B.SAND);
      box(5, 1, 41, 6, 2, 42, B.STONE);
      box(4, 1, 49, 5, 1, 50, B.CRATE);
      tree(box, 19, 51, 4);
      // B site ruins
      box(47, 0, 42, 57, 0, 49, B.SITE_B);
      box(46, 1, 44, 46, 3, 47, B.STONE); box(46, 4, 44, 46, 4, 45, B.STONE);
      box(52, 1, 41, 55, 1, 41, B.SAND);
      box(55, 1, 46, 56, 2, 47, B.CRATE);
      box(50, 1, 49, 51, 2, 49, B.STONE);
      tree(box, 59, 51, 5);
      // spawns
      tree(box, 20, 5, 4); tree(box, 45, 7, 5); box(14, 1, 3, 15, 1, 4, B.CRATE);
      tree(box, 20, 58, 4); tree(box, 46, 59, 4); box(50, 1, 56, 51, 1, 57, B.CRATE);
    }
  });
});
