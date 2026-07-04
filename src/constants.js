const TILE_SIZE = 32;
const CANVAS_W = 800;
const CANVAS_H = 600;
const MAP_COLS = 80;
const MAP_ROWS = 80;

const T = {
  GRASS: 0, TREE: 1, ROCK: 2, STUMP: 3,
  CRAFTING_TABLE: 4, HERB: 5,
  WOOD_WALL: 6, STONE_WALL: 7, DOOR: 8,
  CAMPFIRE: 9, TRAP: 10, FARM: 11,
  CHEST: 12, MINE_ENTRANCE: 13,
  CAVE_WALL: 14, CAVE_FLOOR: 15, BERRY_BUSH: 16
};

// MINE_ENTRANCE is an open cave mouth — walkable, so mines can be entered.
const TILE_SOLID = new Set([T.TREE, T.ROCK, T.WOOD_WALL, T.STONE_WALL, T.CHEST, T.CAVE_WALL]);

const DAY_DURATION   = 90000;
const NIGHT_DURATION = 60000;
const TOTAL_NIGHTS   = 99;

// Hunger: a full bar lasts 240s (~1.5 day/night cycles); starving chips HP.
const HUNGER_DRAIN_PER_MS = 100 / 240000;
const STARVE_INTERVAL_MS  = 3000;
const STARVE_DAMAGE       = 4;

const RECIPES = [
  { id: 'wood_wall',  name: 'Wood Wall',   cost: { wood: 3 },           type: 'placeable', tile: T.WOOD_WALL  },
  { id: 'stone_wall', name: 'Stone Wall',  cost: { wood: 3, stone: 2 }, type: 'placeable', tile: T.STONE_WALL },
  { id: 'door',       name: 'Wooden Door', cost: { wood: 4 },           type: 'placeable', tile: T.DOOR       },
  { id: 'campfire',   name: 'Campfire',    cost: { wood: 2, stone: 1 }, type: 'placeable', tile: T.CAMPFIRE   },
  { id: 'trap',       name: 'Trap',        cost: { wood: 2, herb: 1 },  type: 'placeable', tile: T.TRAP       },
  { id: 'farm',       name: 'Farm',        cost: { wood: 3, herb: 2 },  type: 'placeable', tile: T.FARM       },
  { id: 'spear',      name: 'Spear',       cost: { wood: 2, stone: 1 }, type: 'weapon'  },
  { id: 'axe',        name: 'Stone Axe',   cost: { wood: 2, stone: 2 }, type: 'tool'    },
  { id: 'bow',        name: 'Bow',         cost: { wood: 3, herb: 2 },  type: 'weapon'  },
  { id: 'arrow',      name: 'Arrow x5',    cost: { wood: 1, stone: 1 }, type: 'ammo',   gives: 5 },
  { id: 'bandage',    name: 'Bandage',     cost: { herb: 2 },           type: 'consumable', heal: 25 },
  // gatherOnly items are found in the world, never crafted (hidden from the menu)
  { id: 'berry',      name: 'Berries',     cost: {},                    type: 'consumable', hunger: 25, gatherOnly: true },
];

// Touch-control layout — shared by ui.js (drawing) and main.js (hit-testing)
const DPAD      = { x: 16, y: CANVAS_H - 170, size: 20 };
const TOUCH_BTN = { w: 44, h: 32, gap: 8 };
// Hotbar layout — shared by ui.js (drawing) and main.js (click hit-testing)
const HOTBAR = { slotW: 48, slotH: 48, count: 6,
                 x: CANVAS_W / 2 - (6 * 48) / 2, y: CANVAS_H - 48 - 4 };

const KID_COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff'];
// Kid spawn positions come from the generated corner mines (map.kidSpawns).
const CRAFTING_TABLE_POS = { tx: 38, ty: 40 };
const PLAYER_START       = { tx: 40, ty: 40 };
