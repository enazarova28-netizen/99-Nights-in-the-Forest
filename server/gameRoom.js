'use strict';

// ── Constants (mirrored from src/constants.js) ────────────────────────────────
const TILE_SIZE  = 32;
const MAP_COLS   = 80;
const MAP_ROWS   = 80;
const DAY_DURATION   = 90000;
const NIGHT_DURATION = 60000;
const TOTAL_NIGHTS   = 99;

const T = {
  GRASS:0, TREE:1, ROCK:2, STUMP:3,
  CRAFTING_TABLE:4, HERB:5,
  WOOD_WALL:6, STONE_WALL:7, DOOR:8,
  CAMPFIRE:9, TRAP:10, FARM:11,
  CHEST:12, MINE_ENTRANCE:13,
  CAVE_WALL:14, CAVE_FLOOR:15, BERRY_BUSH:16
};

// MINE_ENTRANCE is an open cave mouth — walkable, so mines can be entered.
const TILE_SOLID = new Set([T.TREE, T.ROCK, T.WOOD_WALL, T.STONE_WALL, T.CHEST, T.CAVE_WALL]);

// Hunger (mirrors src/constants.js)
const HUNGER_DRAIN_PER_MS = 100 / 240000;
const STARVE_INTERVAL_MS  = 3000;
const STARVE_DAMAGE       = 4;

const RECIPES = [
  { id:'wood_wall',  name:'Wood Wall',   cost:{wood:3},           type:'placeable', tile:T.WOOD_WALL  },
  { id:'stone_wall', name:'Stone Wall',  cost:{wood:3,stone:2},   type:'placeable', tile:T.STONE_WALL },
  { id:'door',       name:'Door',        cost:{wood:4},           type:'placeable', tile:T.DOOR       },
  { id:'campfire',   name:'Campfire',    cost:{wood:2,stone:1},   type:'placeable', tile:T.CAMPFIRE   },
  { id:'trap',       name:'Trap',        cost:{wood:2,herb:1},    type:'placeable', tile:T.TRAP       },
  { id:'farm',       name:'Farm',        cost:{wood:3,herb:2},    type:'placeable', tile:T.FARM       },
  { id:'spear',      name:'Spear',       cost:{wood:2,stone:1},   type:'weapon'   },
  { id:'axe',        name:'Stone Axe',   cost:{wood:2,stone:2},   type:'tool'     },
  { id:'bow',        name:'Bow',         cost:{wood:3,herb:2},    type:'weapon'   },
  { id:'arrow',      name:'Arrow x5',    cost:{wood:1,stone:1},   type:'ammo', gives:5 },
  { id:'bandage',    name:'Bandage',     cost:{herb:2},           type:'consumable', heal:25 },
  // gatherOnly items are found in the world, never crafted
  { id:'berry',      name:'Berries',     cost:{},                 type:'consumable', hunger:25, gatherOnly:true },
];

// Kid spawn positions come from the generated corner mines (map.kidSpawns).
const CRAFTING_TABLE_POS = { tx:38, ty:40 };
const PLAYER_START       = { tx:40, ty:40 };
const PLAYER_COLORS      = ['#4488ff','#ff8844','#44cc44','#cc44cc'];

// ── Utilities ─────────────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function randFloat(lo, hi) { return lo + Math.random() * (hi - lo); }
function normalize(dx, dy) {
  const m = Math.hypot(dx, dy);
  return m ? { x: dx/m, y: dy/m } : { x:0, y:0 };
}
function rectOverlap(a, b) {
  return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}

let _uidCounter = 0;
function uid() { return ++_uidCounter; }

// ── Tile map ──────────────────────────────────────────────────────────────────
class ServerTileMap {
  constructor(tilesBase64 = null) {
    this.stumpTimers = {};
    this.dirty = [];
    // Kid spawns are deterministic (corner-mine centres), so they can be
    // recomputed even when the tiles come from a save.
    this.kidSpawns = this._computeKidSpawns();
    if (tilesBase64) {
      const buf = Buffer.from(tilesBase64, 'base64');
      this.tiles = new Uint8Array(buf);
    } else {
      this.tiles = new Uint8Array(MAP_COLS * MAP_ROWS);
      this._generate();
    }
    this.dirty = []; // clear any dirty entries from map generation
  }

  // Deterministic placement of the mine in zone (zx, zy) — must stay
  // identical to src/world.js TileMap._mineSpec.
  _mineSpec(zx, zy) {
    const ZONES_X = 4, ZONES_Y = 4;
    const ZONE_W  = Math.floor(MAP_COLS / ZONES_X);
    const ZONE_H  = Math.floor(MAP_ROWS / ZONES_Y);
    const seed = zx * 13 + zy * 7;
    const frac = n => { const v = Math.sin(n * 47.3 + seed * 1.9) * 43758.5; return v - Math.floor(v); };
    let bx = Math.floor(zx * ZONE_W + 2 + frac(1) * (ZONE_W - 14));
    let by = Math.floor(zy * ZONE_H + 2 + frac(2) * (ZONE_H - 12));
    bx = Math.max(2, Math.min(bx, MAP_COLS - 12));
    by = Math.max(2, Math.min(by, MAP_ROWS - 10));
    const w = 11, h = 9;
    bx = Math.max(2, Math.min(bx, MAP_COLS - w - 3));
    by = Math.max(2, Math.min(by, MAP_ROWS - h - 4));
    return { bx, by, w, h, cx: bx + Math.floor(w / 2), cy: by + Math.floor(h / 2) };
  }

  _computeKidSpawns() {
    // Corner zones (NW, NE, SW, SE) — matches KID_COLORS order client-side
    return [[0, 0], [3, 0], [0, 3], [3, 3]].map(([zx, zy]) => {
      const s = this._mineSpec(zx, zy);
      return { tx: s.cx, ty: s.cy };
    });
  }

  idx(tx, ty) { return ty * MAP_COLS + tx; }

  get(tx, ty) {
    if (tx < 0 || tx >= MAP_COLS || ty < 0 || ty >= MAP_ROWS) return T.TREE;
    return this.tiles[this.idx(tx, ty)];
  }

  set(tx, ty, id) {
    if (tx < 0 || tx >= MAP_COLS || ty < 0 || ty >= MAP_ROWS) return;
    const i = this.idx(tx, ty);
    this.tiles[i] = id;
    this.dirty.push({ i, tile: id });
  }

  flushDirty() {
    const d = this.dirty;
    this.dirty = [];
    return d;
  }

  isSolid(tx, ty, isPlayer = false) {
    const t = this.get(tx, ty);
    if (t === T.DOOR) return !isPlayer;
    return TILE_SOLID.has(t);
  }

  chopTree(tx, ty) {
    this.set(tx, ty, T.STUMP);
    this.stumpTimers[this.idx(tx, ty)] = 3;
  }

  onNightEnd(players = []) {
    for (const [k, v] of Object.entries(this.stumpTimers)) {
      const nights = v - 1;
      if (nights <= 0) {
        const idx = parseInt(k);
        const tx = idx % MAP_COLS;
        const ty = Math.floor(idx / MAP_COLS);
        // Don't regrow if any player is standing on or adjacent to this tile
        const blocked = players.some(p => {
          const ptx = Math.floor((p.x + p.w / 2) / TILE_SIZE);
          const pty = Math.floor((p.y + p.h / 2) / TILE_SIZE);
          return Math.abs(tx - ptx) <= 1 && Math.abs(ty - pty) <= 1;
        });
        if (blocked) { this.stumpTimers[k] = 1; continue; }
        this.tiles[idx] = T.TREE;
        this.dirty.push({ i: idx, tile: T.TREE });
        delete this.stumpTimers[k];
      } else {
        this.stumpTimers[k] = nights;
      }
    }
  }

  toBase64() {
    return Buffer.from(this.tiles).toString('base64');
  }

  _generate() {
    // Simple deterministic world — grass base
    for (let ty = 0; ty < MAP_ROWS; ty++) {
      for (let tx = 0; tx < MAP_COLS; tx++) {
        this.tiles[this.idx(tx, ty)] = T.GRASS;
      }
    }
    // Border trees
    for (let tx = 0; tx < MAP_COLS; tx++) {
      this.set(tx, 0, T.TREE); this.set(tx, MAP_ROWS-1, T.TREE);
    }
    for (let ty = 0; ty < MAP_ROWS; ty++) {
      this.set(0, ty, T.TREE); this.set(MAP_COLS-1, ty, T.TREE);
    }
    // Interior trees (seeded pattern)
    for (let ty = 2; ty < MAP_ROWS-2; ty++) {
      for (let tx = 2; tx < MAP_COLS-2; tx++) {
        const dist = Math.hypot(tx - PLAYER_START.tx, ty - PLAYER_START.ty);
        if (dist < 5) continue; // clear space near spawn
        // Pseudo-random but deterministic
        const v = Math.sin(tx * 127.1 + ty * 311.7) * 43758.5;
        if ((v - Math.floor(v)) < 0.12) this.set(tx, ty, T.TREE);
      }
    }
    // Rocks
    for (let ty = 2; ty < MAP_ROWS-2; ty++) {
      for (let tx = 2; tx < MAP_COLS-2; tx++) {
        if (this.get(tx, ty) !== T.GRASS) continue;
        const dist = Math.hypot(tx - PLAYER_START.tx, ty - PLAYER_START.ty);
        if (dist < 4) continue;
        const v = Math.sin(tx * 231.7 + ty * 97.3) * 13579.4;
        if ((v - Math.floor(v)) < 0.04) this.set(tx, ty, T.ROCK);
      }
    }
    // Herbs
    for (let ty = 2; ty < MAP_ROWS-2; ty++) {
      for (let tx = 2; tx < MAP_COLS-2; tx++) {
        if (this.get(tx, ty) !== T.GRASS) continue;
        const v = Math.sin(tx * 53.3 + ty * 179.1) * 27183.9;
        if ((v - Math.floor(v)) < 0.03) this.set(tx, ty, T.HERB);
      }
    }
    // Berry bushes (~1.5%) — the food source
    for (let ty = 2; ty < MAP_ROWS-2; ty++) {
      for (let tx = 2; tx < MAP_COLS-2; tx++) {
        if (this.get(tx, ty) !== T.GRASS) continue;
        const v = Math.sin(tx * 311.9 + ty * 67.3) * 51987.3;
        if ((v - Math.floor(v)) < 0.015) this.set(tx, ty, T.BERRY_BUSH);
      }
    }
    // Crafting table
    this.set(CRAFTING_TABLE_POS.tx, CRAFTING_TABLE_POS.ty, T.CRAFTING_TABLE);

    // Houses and mines — zone grid (matches client world.js generation).
    // The 4 corner zones always hold a mine with a kid inside.
    const ZONES_X = 4, ZONES_Y = 4;
    const ZONE_W  = Math.floor(MAP_COLS / ZONES_X);
    const ZONE_H  = Math.floor(MAP_ROWS / ZONES_Y);
    for (let zy = 0; zy < ZONES_Y; zy++) {
      for (let zx = 0; zx < ZONES_X; zx++) {
        const corner = (zx === 0 || zx === ZONES_X - 1) && (zy === 0 || zy === ZONES_Y - 1);
        if (corner) { this._genMine(zx, zy); continue; }

        const zoneCx = zx * ZONE_W + Math.floor(ZONE_W / 2);
        const zoneCy = zy * ZONE_H + Math.floor(ZONE_H / 2);
        if (Math.hypot(zoneCx - PLAYER_START.tx, zoneCy - PLAYER_START.ty) < 14) continue;

        const seed = zx * 13 + zy * 7;
        const frac = n => { const v = Math.sin(n * 47.3 + seed * 1.9) * 43758.5; return v - Math.floor(v); };

        let bx = Math.floor(zx * ZONE_W + 2 + frac(1) * (ZONE_W - 14));
        let by = Math.floor(zy * ZONE_H + 2 + frac(2) * (ZONE_H - 12));
        bx = Math.max(2, Math.min(bx, MAP_COLS - 12));
        by = Math.max(2, Math.min(by, MAP_ROWS - 10));

        if (frac(3) < 0.65) this._genHouse(bx, by, seed);
        else                 this._genMine(zx, zy);
      }
    }
  }

  _genHouse(bx, by, seed) {
    const frac = n => { const v = Math.sin(n * 53.3 + seed * 2.7) * 43758.5; return v - Math.floor(v); };
    const sizes = [[6,5],[8,4],[5,7],[7,6]];
    const [w, h] = sizes[Math.floor(frac(1) * 4)];

    bx = Math.max(2, Math.min(bx, MAP_COLS - w - 2));
    by = Math.max(2, Math.min(by, MAP_ROWS - h - 3));

    // Clear surroundings
    for (let dy = -1; dy <= h; dy++) {
      for (let dx = -1; dx <= w; dx++) {
        const tx = bx+dx, ty = by+dy;
        if (tx<0||ty<0||tx>=MAP_COLS||ty>=MAP_ROWS) continue;
        if (dx>=0&&dx<w&&dy>=0&&dy<h) continue;
        const t = this.get(tx, ty);
        if (t===T.TREE||t===T.ROCK||t===T.HERB) this.set(tx, ty, T.GRASS);
      }
    }

    // Walls and interior
    for (let ty = by; ty < by+h; ty++) {
      for (let tx = bx; tx < bx+w; tx++) {
        const wall = tx===bx||tx===bx+w-1||ty===by||ty===by+h-1;
        this.set(tx, ty, wall ? T.WOOD_WALL : T.GRASS);
      }
    }

    // Door at south-center
    const doorTx = bx + Math.floor(w / 2);
    this.set(doorTx, by+h-1, T.DOOR);
    if (by+h < MAP_ROWS) this.set(doorTx, by+h, T.GRASS);

    // Chest at interior center
    this.set(bx + Math.floor(w/2), by + Math.floor(h/2), T.CHEST);
  }

  // Enterable mine cave (mirrors src/world.js TileMap._genMine)
  _genMine(zx, zy) {
    const { bx, by, w, h } = this._mineSpec(zx, zy);

    // Clear surroundings so the cave is reachable
    for (let dy = -1; dy <= h+2; dy++) {
      for (let dx = -1; dx <= w; dx++) {
        const tx = bx+dx, ty = by+dy;
        if (tx<0||ty<0||tx>=MAP_COLS||ty>=MAP_ROWS) continue;
        if (dx>=0&&dx<w&&dy>=0&&dy<h) continue;
        const t = this.get(tx, ty);
        if (t===T.TREE||t===T.ROCK||t===T.HERB||t===T.BERRY_BUSH) this.set(tx, ty, T.GRASS);
      }
    }

    // Rock shell with dark cave floor inside
    for (let ty = by; ty < by+h; ty++) {
      for (let tx = bx; tx < bx+w; tx++) {
        const wall = tx===bx||tx===bx+w-1||ty===by||ty===by+h-1;
        this.set(tx, ty, wall ? T.CAVE_WALL : T.CAVE_FLOOR);
      }
    }

    // 3-tile-wide opening at south-centre (marker tile in the middle)
    const entrTx = bx + Math.floor(w / 2);
    const southY = by + h - 1;
    this.set(entrTx-1, southY, T.CAVE_FLOOR);
    this.set(entrTx,   southY, T.MINE_ENTRANCE);
    this.set(entrTx+1, southY, T.CAVE_FLOOR);

    // Chest in the north-west corner of the cave
    this.set(bx+2, by+2, T.CHEST);
  }
}

// ── Server Player ─────────────────────────────────────────────────────────────
class ServerPlayer {
  constructor(username, playerIdx, ws, saveData = null) {
    this.id         = uid();
    this.username   = username;
    this.playerIdx  = playerIdx;
    this.bodyColor  = PLAYER_COLORS[playerIdx] || '#ffffff';
    this.ws         = ws;

    // Position
    this.x = PLAYER_START.tx * TILE_SIZE + 4 + playerIdx * 32;
    this.y = PLAYER_START.ty * TILE_SIZE + 4;
    this.w = 24; this.h = 24;
    this.facing = { x: 1, y: 0 };

    // Stats
    this.hp        = saveData?.hp    ?? 100;
    this.maxHp     = 100;
    this.hunger    = saveData?.hunger ?? 100;
    this.maxHunger = 100;
    this._starveTick = 0;
    this.speed     = 160;
    this.downed    = false;
    this.dmgCooldown  = 0;
    this.atkCooldown  = 0;
    this.atkCooldownMax = 500;
    this.hitbox    = null;

    // Inventory
    this.weapon  = saveData?.weapon ?? 'fist';
    this.arrows  = saveData?.arrows ?? 0;
    this.hasAxe  = saveData?.hasAxe ?? false;
    this.res     = saveData?.res    ?? { wood:0, stone:0, herb:0 };
    this.items   = saveData?.items  ?? {};
    this.hotbar  = saveData?.hotbar ?? Array(6).fill(null);
    this.slot    = 0;

    // Buffered input (updated each incoming message)
    this._input = { up:false, down:false, left:false, right:false, action:null };
  }

  applyInput(keys, action) {
    this._input = { ...keys, action };
  }

  countItem(id) { return this.items[id] || 0; }

  addItem(id, n = 1) {
    this.items[id] = (this.items[id] || 0) + n;
    if (!this.hotbar.includes(id)) {
      const e = this.hotbar.indexOf(null);
      if (e !== -1) this.hotbar[e] = id;
    }
  }

  removeItem(id, n = 1) {
    if ((this.items[id] || 0) < n) return false;
    this.items[id] -= n;
    if (this.items[id] <= 0) {
      delete this.items[id];
      const s = this.hotbar.indexOf(id);
      if (s !== -1) this.hotbar[s] = null;
    }
    return true;
  }

  addRes(type, n) { this.res[type] = (this.res[type] || 0) + n; }

  selectedItem() { return this.hotbar[this.slot]; }

  swing() {
    if (this.atkCooldown > 0) return null;
    this.atkCooldown = this.atkCooldownMax;
    const reach = this.weapon === 'spear' ? 52 : 36;
    const hw    = this.weapon === 'spear' ? 12 : 22;
    const cx    = this.x + this.w/2 + this.facing.x * reach;
    const cy    = this.y + this.h/2 + this.facing.y * reach;
    const dmg   = this.weapon === 'spear' ? 25 : 15;
    this.hitbox = { x:cx-hw/2, y:cy-hw/2, w:hw, h:hw, dmg, timer:200 };
    return this.hitbox;
  }

  shootArrow() {
    if (this.weapon !== 'bow' || this.arrows <= 0 || this.atkCooldown > 0) return null;
    this.atkCooldown = 700;
    this.arrows--;
    return { id:uid(), type:'arrow', x:this.x+this.w/2, y:this.y+this.h/2,
             dx:this.facing.x, dy:this.facing.y, speed:420, dmg:22, w:10, h:6, alive:true };
  }

  takeDamage(amt) {
    if (this.downed || this.dmgCooldown > 0) return;
    this.hp -= amt;
    if (this.hp <= 0) { this.hp = 0; this.downed = true; }
  }

  revive(hp = 25) {
    this.downed = false;
    this.hp = hp;
    this.dmgCooldown = 1000;
  }

  moveX(dx, map) {
    this.x += dx;
    const lx = Math.floor(this.x / TILE_SIZE);
    const rx = Math.floor((this.x + this.w - 1) / TILE_SIZE);
    const ty = Math.floor((this.y + 1) / TILE_SIZE);
    const by = Math.floor((this.y + this.h - 2) / TILE_SIZE);
    const hit = dx < 0
      ? (map.isSolid(lx,ty,true) || map.isSolid(lx,by,true))
      : (map.isSolid(rx,ty,true) || map.isSolid(rx,by,true));
    if (hit) this.x -= dx;
    this.x = clamp(this.x, TILE_SIZE, (MAP_COLS-2)*TILE_SIZE - this.w);
  }

  moveY(dy, map) {
    this.y += dy;
    const tx = Math.floor((this.x + 1) / TILE_SIZE);
    const rx = Math.floor((this.x + this.w - 2) / TILE_SIZE);
    const ty = Math.floor(this.y / TILE_SIZE);
    const by = Math.floor((this.y + this.h - 1) / TILE_SIZE);
    const hit = dy < 0
      ? (map.isSolid(tx,ty,true) || map.isSolid(rx,ty,true))
      : (map.isSolid(tx,by,true) || map.isSolid(rx,by,true));
    if (hit) this.y -= dy;
    this.y = clamp(this.y, TILE_SIZE, (MAP_ROWS-2)*TILE_SIZE - this.h);
  }

  update(dt, map) {
    if (this.downed) { if (this.dmgCooldown > 0) this.dmgCooldown -= dt; return; }

    const { up, down, left, right } = this._input;
    let dx = 0, dy = 0;
    if (up)    dy -= 1;
    if (down)  dy += 1;
    if (left)  dx -= 1;
    if (right) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const n = normalize(dx, dy);
      this.facing = { x:n.x, y:n.y };
      this.moveX(n.x * this.speed * dt / 1000, map);
      this.moveY(n.y * this.speed * dt / 1000, map);
    }

    if (this.atkCooldown > 0) this.atkCooldown -= dt;
    if (this.dmgCooldown  > 0) this.dmgCooldown  -= dt;
    if (this.hitbox) {
      this.hitbox.timer -= dt;
      if (this.hitbox.timer <= 0) this.hitbox = null;
    }

    // Hunger drains over time; starving chips HP (bypasses damage cooldown)
    this.hunger = Math.max(0, this.hunger - dt * HUNGER_DRAIN_PER_MS);
    if (this.hunger <= 0) {
      this._starveTick += dt;
      if (this._starveTick >= STARVE_INTERVAL_MS) {
        this._starveTick = 0;
        this.hp -= STARVE_DAMAGE;
        if (this.hp <= 0) { this.hp = 0; this.downed = true; }
      }
    } else {
      this._starveTick = 0;
    }

    // Unstuck from solid tiles — multi-pass so pushing out of one tile doesn't
    // leave the player inside an adjacent tile outside the original scan range.
    const ts = TILE_SIZE;
    for (let pass = 0; pass < 4; pass++) {
      const x0 = Math.floor(this.x / ts);
      const x1 = Math.floor((this.x + this.w - 1) / ts);
      const y0 = Math.floor(this.y / ts);
      const y1 = Math.floor((this.y + this.h - 1) / ts);
      let anyOverlap = false;
      for (let ty2 = y0; ty2 <= y1; ty2++) {
        for (let tx2 = x0; tx2 <= x1; tx2++) {
          if (!map.isSolid(tx2, ty2, true)) continue;
          anyOverlap = true;
          const tl = tx2*ts, tt = ty2*ts;
          const ol = (this.x+this.w)-tl, or2 = (tl+ts)-this.x;
          const ot = (this.y+this.h)-tt, ob = (tt+ts)-this.y;
          const m = Math.min(ol, or2, ot, ob);
          if      (m===ol)  this.x = tl - this.w;
          else if (m===or2) this.x = tl + ts;
          else if (m===ot)  this.y = tt - this.h;
          else              this.y = tt + ts;
        }
      }
      if (!anyOverlap) break;
    }
  }

  toNet() {
    return {
      username:   this.username,
      playerIdx:  this.playerIdx,
      bodyColor:  this.bodyColor,
      x:    Math.round(this.x),
      y:    Math.round(this.y),
      w:    this.w, h: this.h,
      hp:   this.hp, maxHp: this.maxHp,
      hunger: Math.round(this.hunger), maxHunger: this.maxHunger,
      downed: this.downed,
      facing: this.facing,
      weapon: this.weapon,
      arrows: this.arrows,
      res:    this.res,
      items:  this.items,
      hotbar: this.hotbar,
      slot:   this.slot,
      hasAxe: this.hasAxe,
    };
  }

  toSave() {
    return {
      username: this.username,
      hp:    this.hp,
      hunger: Math.round(this.hunger),
      weapon: this.weapon,
      arrows: this.arrows,
      hasAxe: this.hasAxe,
      res:    { ...this.res },
      items:  { ...this.items },
      hotbar: [...this.hotbar],
    };
  }
}

// ── Server Kid ─────────────────────────────────────────────────────────────────
class ServerKid {
  constructor(tx, ty, idx) {
    this.id       = uid();
    this.kidIdx   = idx;
    this.x = tx * TILE_SIZE + 8;
    this.y = ty * TILE_SIZE + 6;
    this.w = 16; this.h = 22;
    this.rescued  = false;
    this.safe     = false;
    this.knockedOut  = false;
    this.koTimer     = 0;
    this.hp = 60; this.maxHp = 60;
  }

  takeDamage(amt) {
    if (this.knockedOut) return;
    this.hp -= amt;
    if (this.hp <= 0) {
      this.hp = 10; this.alive = true;
      this.knockedOut = true; this.koTimer = 8000;
    }
  }

  update(dt, players, map) {
    if (this.koTimer > 0) {
      this.koTimer -= dt;
      if (this.koTimer <= 0) this.knockedOut = false;
    }
    if (!this.rescued || this.safe || this.knockedOut) return;

    const bx = CRAFTING_TABLE_POS.tx * TILE_SIZE;
    const by = CRAFTING_TABLE_POS.ty * TILE_SIZE;
    const d  = dist({ x:this.x, y:this.y }, { x:bx, y:by });
    if (d < TILE_SIZE * 2) { this.safe = true; return; }

    // Follow nearest player
    let nearest = null, nd = Infinity;
    for (const p of players) {
      if (p.downed) continue;
      const pd = dist({ x:this.x,y:this.y }, { x:p.x,y:p.y });
      if (pd < nd) { nd = pd; nearest = p; }
    }
    if (!nearest || nd < 48) return;
    const n = normalize(nearest.x - this.x, nearest.y - this.y);
    this._moveX(n.x * 80 * dt / 1000, map);
    this._moveY(n.y * 80 * dt / 1000, map);
  }

  _moveX(dx, map) {
    this.x += dx;
    const lx = Math.floor(this.x / TILE_SIZE);
    const rx = Math.floor((this.x + this.w - 1) / TILE_SIZE);
    const ty = Math.floor(this.y / TILE_SIZE);
    const by = Math.floor((this.y + this.h - 1) / TILE_SIZE);
    if (map.isSolid(lx,ty)||map.isSolid(lx,by)||map.isSolid(rx,ty)||map.isSolid(rx,by)) this.x -= dx;
    this.x = clamp(this.x, TILE_SIZE, (MAP_COLS-2)*TILE_SIZE - this.w);
  }

  _moveY(dy, map) {
    this.y += dy;
    const tx = Math.floor(this.x / TILE_SIZE);
    const rx = Math.floor((this.x + this.w - 1) / TILE_SIZE);
    const ty = Math.floor(this.y / TILE_SIZE);
    const by = Math.floor((this.y + this.h - 1) / TILE_SIZE);
    if (map.isSolid(tx,ty)||map.isSolid(rx,ty)||map.isSolid(tx,by)||map.isSolid(rx,by)) this.y -= dy;
    this.y = clamp(this.y, TILE_SIZE, (MAP_ROWS-2)*TILE_SIZE - this.h);
  }

  toNet() {
    return { idx:this.kidIdx, x:Math.round(this.x), y:Math.round(this.y),
             w:this.w, h:this.h, rescued:this.rescued, safe:this.safe,
             knockedOut:this.knockedOut, hp:this.hp, maxHp:this.maxHp };
  }
}

// ── Enemies ───────────────────────────────────────────────────────────────────
class ServerEnemy {
  constructor(x, y) {
    this.id = uid();
    this.x = x; this.y = y;
    this.w = 28; this.h = 28;
    this.hp = 30; this.maxHp = 30;
    this.speed = 80; this.damage = 8;
    this.alive = true;
    this.dmgCooldown = 0;
    this.wanderTimer = 0;
    this.wanderDx = 0; this.wanderDy = 0;
    this.facing = { x:1, y:0 };
    this._hitThisSwing = false;
  }

  takeDamage(amt) {
    this.hp -= amt;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
  }

  moveX(dx, map) {
    this.x += dx;
    const lx=Math.floor(this.x/TILE_SIZE), rx=Math.floor((this.x+this.w-1)/TILE_SIZE);
    const ty=Math.floor(this.y/TILE_SIZE), by=Math.floor((this.y+this.h-1)/TILE_SIZE);
    if (map.isSolid(lx,ty)||map.isSolid(lx,by)||map.isSolid(rx,ty)||map.isSolid(rx,by)) this.x-=dx;
    this.x=clamp(this.x,TILE_SIZE,(MAP_COLS-2)*TILE_SIZE-this.w);
  }
  moveY(dy, map) {
    this.y += dy;
    const tx=Math.floor(this.x/TILE_SIZE), rx=Math.floor((this.x+this.w-1)/TILE_SIZE);
    const ty=Math.floor(this.y/TILE_SIZE), by=Math.floor((this.y+this.h-1)/TILE_SIZE);
    if (map.isSolid(tx,ty)||map.isSolid(rx,ty)||map.isSolid(tx,by)||map.isSolid(rx,by)) this.y-=dy;
    this.y=clamp(this.y,TILE_SIZE,(MAP_ROWS-2)*TILE_SIZE-this.h);
  }

  seek(target, spd, dt, map) {
    const dx = target.x + target.w/2 - (this.x + this.w/2);
    const dy = target.y + target.h/2 - (this.y + this.h/2);
    const n  = normalize(dx, dy);
    if (n.x||n.y) this.facing = n;
    this.moveX(n.x * spd * dt / 1000, map);
    this.moveY(n.y * spd * dt / 1000, map);
  }

  wander(dt, map) {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      const a = Math.random() * Math.PI * 2;
      this.wanderDx = Math.cos(a); this.wanderDy = Math.sin(a);
      this.wanderTimer = randFloat(800, 1800);
    }
    this.moveX(this.wanderDx * 40 * dt / 1000, map);
    this.moveY(this.wanderDy * 40 * dt / 1000, map);
  }

  tryHit(players) {
    if (this.dmgCooldown > 0) return;
    for (const p of players) {
      if (p.downed || p.dmgCooldown > 0) continue;
      if (rectOverlap(this, p)) {
        p.takeDamage(this.damage);
        p.dmgCooldown = 700;
        this.dmgCooldown = 800;
        return;
      }
    }
  }

  toNet() {
    return { id:this.id, type:this.constructor.name,
             x:Math.round(this.x), y:Math.round(this.y), w:this.w, h:this.h,
             hp:this.hp, maxHp:this.maxHp, facing:this.facing };
  }
}

class Goat extends ServerEnemy {
  constructor(x, y) {
    super(x, y);
    this.hp = 30; this.maxHp = 30;
    this.speed = 80; this.damage = 8;
    this.alertRange = 300;
    this._state = 'wander'; // wander | telegraph | charge
    this._chargeTele = 0;
    this._chargeDur  = 0;
    this._chargeCd   = 0;
    this._chargeDir  = { x:0, y:0 };
  }

  update(dt, players, map) {
    if (!this.alive) return;
    if (this.dmgCooldown > 0) this.dmgCooldown -= dt;

    const nearestPlayer = this._nearest(players);

    if (this._state === 'wander') {
      if (nearestPlayer && dist(this, nearestPlayer) < this.alertRange) {
        this._state = 'telegraph'; this._chargeTele = 600;
      } else {
        this.wander(dt, map);
      }
    } else if (this._state === 'telegraph') {
      this._chargeTele -= dt;
      if (this._chargeTele <= 0 && nearestPlayer) {
        const dx = nearestPlayer.x - this.x, dy = nearestPlayer.y - this.y;
        this._chargeDir = normalize(dx, dy);
        this._state = 'charge'; this._chargeDur = 700;
      }
    } else if (this._state === 'charge') {
      this._chargeDur -= dt;
      this.moveX(this._chargeDir.x * 220 * dt / 1000, map);
      this.moveY(this._chargeDir.y * 220 * dt / 1000, map);
      this.tryHit(players);
      if (this._chargeDur <= 0) {
        this._state = 'wander'; this._chargeCd = 2000;
      }
    }
  }

  _nearest(players) {
    let best = null, bd = Infinity;
    for (const p of players) {
      if (p.downed) continue;
      const d = dist(this, p);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}

class Villager extends ServerEnemy {
  constructor(x, y) {
    super(x, y);
    this.hp = 50; this.maxHp = 50;
    this.speed = 100; this.damage = 12;
  }

  update(dt, players, map) {
    if (!this.alive) return;
    if (this.dmgCooldown > 0) this.dmgCooldown -= dt;
    const target = this._nearest(players);
    if (target) { this.seek(target, this.speed, dt, map); this.tryHit(players); }
    else this.wander(dt, map);
  }

  _nearest(players) {
    let best = null, bd = Infinity;
    for (const p of players) {
      if (p.downed) continue;
      const d = dist(this, p);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}

class BipedalDeer extends ServerEnemy {
  constructor(x, y) {
    super(x, y);
    this.hp = 400; this.maxHp = 400;
    this.w = 40; this.h = 48;
    this.speed = 140; this.damage = 25;
    this.phase = 1;
    this.retreated = false;
    this.returnNight = 0;
    this.hasReturned = false; // true after coming back from its retreat
    this._chargeTimer = 3500;
    this._goatTimer   = 30000;
    this._thornTimer  = 3000;
  }

  // First defeat makes the Warden retreat (it returns 3 nights later,
  // enraged); only the second defeat is final.
  takeDamage(amt) {
    if (this.retreated) return;
    super.takeDamage(amt);
    if (!this.alive && !this.hasReturned) {
      this.alive = true;
      this.retreated = true;
      this.hp = 0;
    }
  }

  update(dt, players, map, projectiles, nightNumber, spawnGoatsCb) {
    if (!this.alive || this.retreated) return;
    if (this.dmgCooldown > 0) this.dmgCooldown -= dt;

    if (this.hp <= 200 && this.phase === 1) this.phase = 2;

    const target = this._nearest(players);
    if (!target) return;

    // Charge
    this._chargeTimer -= dt;
    if (this._chargeTimer <= 0) {
      this.seek(target, 240, dt, map);
      this.tryHit(players);
      if (this._chargeTimer <= -800) this._chargeTimer = 3500;
    } else {
      this.seek(target, this.speed, dt, map);
      this.tryHit(players);
    }

    // Phase 1: summon goats
    if (this.phase === 1) {
      this._goatTimer -= dt;
      if (this._goatTimer <= 0) { spawnGoatsCb(2); this._goatTimer = 30000; }
    }

    // Phase 2: thorns
    if (this.phase === 2) {
      this._thornTimer -= dt;
      if (this._thornTimer <= 0) {
        this._thornTimer = 3000;
        const angles = [-0.35, 0, 0.35];
        const dx0 = target.x - this.x, dy0 = target.y - this.y;
        const base = Math.atan2(dy0, dx0);
        for (const a of angles) {
          const ang = base + a;
          projectiles.push({ id:uid(), type:'thorn', x:this.x+this.w/2, y:this.y+this.h/2,
            dx:Math.cos(ang), dy:Math.sin(ang), speed:200, dmg:15, w:10, h:6, alive:true });
        }
      }
    }

    // (Retreat is handled in takeDamage; return in GameRoom._startNight.)
  }

  _nearest(players) {
    let best = null, bd = Infinity;
    for (const p of players) {
      if (p.downed) continue;
      const d = dist(this, p);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}

// ── Game Room ─────────────────────────────────────────────────────────────────
class GameRoom {
  constructor(lobbyId, hostUsername = '', saveData = null) {
    this.lobbyId     = lobbyId;
    this.hostUsername = hostUsername;
    this.map         = new ServerTileMap(saveData?.tiles ?? null);
    if (saveData?.stumpTimers) this.map.stumpTimers = saveData.stumpTimers;

    this.players     = [];
    this.enemies     = [];
    this.projectiles = [];
    this.kids        = this.map.kidSpawns.map((p, i) => new ServerKid(p.tx, p.ty, i));
    if (saveData?.kids) {
      saveData.kids.forEach((k, i) => {
        if (this.kids[i]) {
          this.kids[i].rescued = !!k.rescued;
          this.kids[i].safe    = !!k.safe;
        }
      });
    }
    // Each unrescued kid's mine is guarded by two goats
    this._spawnMineGuards();

    this.phase       = saveData?.phase       ?? 'day';
    this.nightNumber = saveData?.nightNumber ?? 0;
    this.phaseTimer  = saveData?.phaseTimerMs ?? DAY_DURATION;
    this.kidsRescued = saveData?.kidsRescued ?? 0;

    this.waveActive         = false;
    this.currentWave        = 0;
    this.waveMax            = 0;
    this._pendingWaves      = 0;
    this._waveTransitioning = false;

    this.deer         = null;
    this.deerDefeated = false;

    this.announcementText  = '';
    this.announcementTimer = 0;

    this._tickInterval = null;
    this._savedPlayerData = saveData?.players ?? [];
  }

  // ── Player management ─────────────────────────────────────────────────────
  addPlayer(username, ws) {
    if (this.players.length >= 4) return false;
    const idx = this.players.length;
    const saved = this._savedPlayerData.find(p => p.username === username);
    const sp = new ServerPlayer(username, idx, ws, saved ?? null);
    this.players.push(sp);
    // Send authoritative map so client matches server layout
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'map_init', tiles: this.map.toBase64() }));
    }
    this._broadcastLobbyList();
    return true;
  }

  // Re-attach a fresh socket to an existing ServerPlayer (page refresh),
  // preserving inventory and position.
  reconnectPlayer(username, ws) {
    const sp = this.players.find(p => p.username === username);
    if (!sp) return false;
    sp.ws = ws;
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'map_init', tiles: this.map.toBase64() }));
    }
    this._broadcastLobbyList();
    return true;
  }

  removePlayer(username) {
    this.players = this.players.filter(p => p.username !== username);
    if (this.players.length > 0) this._broadcastLobbyList();
  }

  start() {
    if (this.nightNumber === 0) {
      this.announcementText  = 'The kids are trapped in the mines…';
      this.announcementTimer = 4000;
    }
    this._tickInterval = setInterval(() => this._tick(), 50); // 20 TPS
  }

  stop() {
    if (this._tickInterval) { clearInterval(this._tickInterval); this._tickInterval = null; }
  }

  // ── Tick ──────────────────────────────────────────────────────────────────
  _tick() {
    const dt = 50;

    this._processInputs(dt);
    this._updateEnemies(dt);
    this._updateProjectiles(dt);
    this._updateKids(dt);
    this._updateEnemyPlayerCollisions();
    this._checkPhaseTimer(dt);
    this._checkWaveCleared();

    if (this.announcementTimer > 0) this.announcementTimer -= dt;

    this._broadcast();
  }

  // ── Inputs ────────────────────────────────────────────────────────────────
  _processInputs(dt) {
    for (const p of this.players) {
      p.update(dt, this.map);
      const action = p._input.action;
      if (action) {
        this._handleAction(p, action);
        p._input.action = null;
      }
    }
  }

  _handleAction(p, action) {
    if (p.downed) {
      if (action === 'revive') this._tryReviveAction(p);
      return;
    }

    if (action === 'attack') {
      this._doAttack(p);
    } else if (action === 'interact') {
      this._doInteract(p);
    } else if (action === 'revive') {
      this._tryReviveAction(p);
    } else if (action === 'use_door') {
      this._doUseDoor(p);
    } else if (action.startsWith('craft:')) {
      const recId = action.slice(6);
      this._doCraft(p, recId);
    } else if (action.startsWith('hotbar:')) {
      const s = parseInt(action.slice(7));
      if (!isNaN(s) && s >= 0 && s < 6) p.slot = s;
    }
  }

  _doAttack(p) {
    // Selected consumable / equip takes priority (so a bandage still works
    // with a bow equipped). Already-equipped gear falls through to attack.
    const selId = p.selectedItem();
    if (selId) {
      const rec = RECIPES.find(r => r.id === selId);
      if (rec) {
        if (rec.type === 'consumable') { this._useConsumable(p, selId, rec); return; }
        if (rec.type === 'weapon' && p.weapon !== selId)         { this._equip(p, selId, rec); return; }
        if (rec.type === 'tool' && selId === 'axe' && !p.hasAxe) { this._equip(p, selId, rec); return; }
      }
    }
    // Bow shoots only while arrows remain — otherwise fall back to melee
    if (p.weapon === 'bow' && p.arrows > 0) {
      const proj = p.shootArrow();
      if (proj) this.projectiles.push(proj);
      return;
    }
    const hb = p.swing();
    if (!hb) return;
    for (const e of this.enemies) {
      if (!e.alive || e._hitThisSwing) continue;
      if (rectOverlap(hb, e)) {
        e.takeDamage(hb.dmg);
        e._hitThisSwing = true;
      }
    }
  }

  _doInteract(p) {
    // 1. Revive downed partner
    for (const other of this.players) {
      if (other === p || !other.downed) continue;
      if (dist(p, other) < TILE_SIZE * 2 && p.removeItem('bandage')) {
        other.revive(25);
        this.announcementText  = `${other.username} was revived!`;
        this.announcementTimer = 2000;
        return;
      }
    }

    // 2. Rescue kid
    for (const kid of this.kids) {
      if (!kid.rescued && dist(p, kid) < TILE_SIZE * 2) {
        kid.rescued = true;
        this.kidsRescued++;
        this.announcementText  = `Kid ${this.kidsRescued}/4 rescued!`;
        this.announcementTimer = 2000;
        this._onKidRescued();
        return;
      }
    }

    // 3. Place item
    const selId = p.selectedItem();
    if (selId) {
      const rec = RECIPES.find(r => r.id === selId && r.type === 'placeable');
      if (rec && p.countItem(selId) > 0) {
        // Place at tile in front of player
        const tx = Math.floor((p.x + p.w/2 + p.facing.x * TILE_SIZE) / TILE_SIZE);
        const ty = Math.floor((p.y + p.h/2 + p.facing.y * TILE_SIZE) / TILE_SIZE);
        const nearSpawn = tx === PLAYER_START.tx && ty === PLAYER_START.ty;
        if (this.map.get(tx, ty) === T.GRASS && !nearSpawn) {
          this.map.set(tx, ty, rec.tile);
          p.removeItem(selId);
          return;
        }
      }
    }

    // 4. Gather
    const pcx = Math.floor((p.x + p.w/2) / TILE_SIZE);
    const pcy = Math.floor((p.y + p.h/2) / TILE_SIZE);
    const faceTx = Math.floor((p.x + p.w/2 + p.facing.x * TILE_SIZE * 0.9) / TILE_SIZE);
    const faceTy = Math.floor((p.y + p.h/2 + p.facing.y * TILE_SIZE * 0.9) / TILE_SIZE);
    const candidates = [
      { tx:faceTx, ty:faceTy },
      { tx:pcx, ty:pcy-1 }, { tx:pcx, ty:pcy+1 },
      { tx:pcx-1, ty:pcy }, { tx:pcx+1, ty:pcy },
    ];
    for (const c of candidates) {
      const tile = this.map.get(c.tx, c.ty);
      if (tile === T.TREE)  { const n = p.hasAxe?2:1; p.addRes('wood', n);  this.map.chopTree(c.tx, c.ty); return; }
      if (tile === T.ROCK)  { p.addRes('stone', 1); this.map.set(c.tx, c.ty, T.GRASS); return; }
      if (tile === T.HERB)  { p.addRes('herb', randInt(1,2)); this.map.set(c.tx, c.ty, T.GRASS); return; }
      if (tile === T.BERRY_BUSH) { p.addItem('berry', randInt(2,3)); this.map.set(c.tx, c.ty, T.GRASS); return; }
      if (tile === T.CHEST) {
        const loot = this._chestLoot(c.tx, c.ty);
        for (const [res, amt] of Object.entries(loot)) {
          if (res === 'berry') p.addItem('berry', amt);
          else                 p.addRes(res, amt);
        }
        this.map.set(c.tx, c.ty, T.GRASS);
        const lootStr = Object.entries(loot).map(([r,n]) => `+${n} ${r}`).join(', ');
        this.announcementText  = `${p.username} found: ${lootStr}!`;
        this.announcementTimer = 3000;
        return;
      }
    }
  }

  _chestLoot(tx, ty) {
    const h = n => { const v = Math.sin(n) * 43758.5; return v - Math.floor(v); };
    const s = tx * 100 + ty;
    const loot = { wood: 3 + Math.floor(h(s * 13.7) * 6) };
    if (h(s * 27.3) > 0.4)  loot.stone = 1 + Math.floor(h(s * 53.1) * 4);
    if (h(s * 41.7) > 0.6)  loot.herb  = 1 + Math.floor(h(s * 71.9) * 3);
    if (h(s * 33.3) > 0.45) loot.berry = 2 + Math.floor(h(s * 91.7) * 2);
    return loot;
  }

  _doUseDoor(p) {
    const pcx = Math.floor((p.x + p.w/2) / TILE_SIZE);
    const pcy = Math.floor((p.y + p.h/2) / TILE_SIZE);
    const checks = [
      { tx:pcx, ty:pcy-1 }, { tx:pcx, ty:pcy+1 },
      { tx:pcx-1, ty:pcy }, { tx:pcx+1, ty:pcy },
    ];
    for (const c of checks) {
      if (this.map.get(c.tx, c.ty) !== T.DOOR) continue;
      const ddx = c.tx - pcx, ddy = c.ty - pcy;
      const dtx = c.tx + ddx, dty = c.ty + ddy;
      if (!this.map.isSolid(dtx, dty, true)) {
        p.x = dtx * TILE_SIZE + (TILE_SIZE - p.w) / 2;
        p.y = dty * TILE_SIZE + (TILE_SIZE - p.h) / 2;
      }
      return;
    }
  }

  _doCraft(p, recId) {
    const rec = RECIPES.find(r => r.id === recId);
    if (!rec || rec.gatherOnly) return; // gather-only items can't be crafted (they'd be free)
    for (const [res, cnt] of Object.entries(rec.cost)) {
      if ((p.res[res] || 0) < cnt) return;
    }
    for (const [res, cnt] of Object.entries(rec.cost)) p.res[res] -= cnt;
    if (rec.type === 'ammo')       { p.arrows += rec.gives; }
    else if (rec.type !== 'placeable') { p.addItem(recId); }
    else                           { p.addItem(recId); }
  }

  _useConsumable(p, id, rec) {
    if (!p.removeItem(id)) return;
    if (rec.heal)   p.hp     = Math.min(p.maxHp,     p.hp     + rec.heal);
    if (rec.hunger) p.hunger = Math.min(p.maxHunger, p.hunger + rec.hunger);
  }

  _equip(p, id, rec) {
    if (rec.type === 'weapon')           p.weapon = id;
    else if (rec.type === 'tool' && id === 'axe') p.hasAxe = true;
  }

  _tryReviveAction(p) {
    for (const other of this.players) {
      if (other === p || !other.downed) continue;
      if (dist(p, other) < TILE_SIZE * 2 && p.removeItem('bandage')) {
        other.revive(25);
        this.announcementText  = `${other.username} was revived!`;
        this.announcementTimer = 2000;
        return;
      }
    }
  }

  // ── Enemies ───────────────────────────────────────────────────────────────
  _updateEnemies(dt) {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e instanceof BipedalDeer) {
        e.update(dt, this.players, this.map, this.projectiles, this.nightNumber,
          n => this._spawnGoats(n));
      } else {
        e.update(dt, this.players, this.map);
      }

      // Trap check
      const etx = Math.floor((e.x+e.w/2)/TILE_SIZE);
      const ety = Math.floor((e.y+e.h/2)/TILE_SIZE);
      if (this.map.get(etx, ety) === T.TRAP) {
        e.takeDamage(20);
        this.map.set(etx, ety, T.GRASS);
      }
    }
    // Reset swing flags once no player has an active swing hitbox
    const anySwing = this.players.some(p => p.hitbox);
    if (!anySwing) {
      for (const e of this.enemies) e._hitThisSwing = false;
    }
    this.enemies = this.enemies.filter(e => e.alive);

    // Warden retreat bookkeeping (works for melee, arrows and traps)
    if (this.deer && this.deer.retreated && this.deer.returnNight === 0) {
      this.deer.returnNight = this.nightNumber + 3;
      this.announcementText  = 'THE WARDEN RETREATS… FOR NOW';
      this.announcementTimer = 3000;
    }
    if (this.deer && !this.deer.alive) this.deerDefeated = true;
  }

  _updateEnemyPlayerCollisions() {
    // Already handled inside each enemy's update via tryHit()
  }

  _updateProjectiles(dt) {
    for (const proj of this.projectiles) {
      if (!proj.alive) continue;
      proj.x += proj.dx * proj.speed * dt / 1000;
      proj.y += proj.dy * proj.speed * dt / 1000;
      if (proj.x<0||proj.y<0||proj.x>MAP_COLS*TILE_SIZE||proj.y>MAP_ROWS*TILE_SIZE) {
        proj.alive = false; continue;
      }
      const ptx = Math.floor(proj.x/TILE_SIZE), pty = Math.floor(proj.y/TILE_SIZE);
      if (this.map.isSolid(ptx, pty)) { proj.alive = false; continue; }
      const pbox = { x:proj.x-proj.w/2, y:proj.y-proj.h/2, w:proj.w, h:proj.h };
      if (proj.type === 'arrow') {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (rectOverlap(pbox, e)) { e.takeDamage(proj.dmg); proj.alive = false; break; }
        }
      } else if (proj.type === 'thorn') {
        for (const p of this.players) {
          if (p.downed || p.dmgCooldown > 0) continue;
          if (rectOverlap(pbox, p)) { p.takeDamage(proj.dmg); p.dmgCooldown = 500; proj.alive = false; break; }
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => p.alive);
  }

  _updateKids(dt) {
    for (const kid of this.kids) kid.update(dt, this.players, this.map);
  }

  // ── Phase transitions ─────────────────────────────────────────────────────
  _checkPhaseTimer(dt) {
    this.phaseTimer -= dt;
    if (this.phaseTimer <= 0) {
      if (this.phase === 'day') this._startNight();
      else                      this._startDay();
    }
  }

  _startNight() {
    this.phase      = 'night';
    this.phaseTimer = NIGHT_DURATION;
    this.nightNumber++;

    this._spawnGoats(2 + Math.floor(this.nightNumber / 10));

    if (this.nightNumber === 50 && !this.deer) {
      const cx = MAP_COLS/2 * TILE_SIZE, cy = MAP_ROWS/2 * TILE_SIZE;
      this.deer = new BipedalDeer(cx, cy);
      this.enemies.push(this.deer);
      this.announcementText  = 'THE WARDEN AWAKENS';
      this.announcementTimer = 4000;
    } else if (this.deer && this.deer.retreated && this.deer.returnNight > 0 &&
               this.nightNumber >= this.deer.returnNight) {
      this.deer.retreated   = false;
      this.deer.hasReturned = true;
      this.deer.hp = 200; this.deer.maxHp = 200; this.deer.phase = 2;
      this.announcementText  = 'THE WARDEN RETURNS — ENRAGED';
      this.announcementTimer = 4000;
    }

    if (!this.waveActive && this._pendingWaves > 0) this._startWave();
  }

  _startDay() {
    this.phase      = 'day';
    this.phaseTimer = DAY_DURATION;

    // Night enemies despawn at dawn — but not the boss or mine guards
    this.enemies = this.enemies.filter(e => e instanceof BipedalDeer || e.guard);
    this.map.onNightEnd(this.players);

    // Heal living players
    for (const p of this.players) {
      if (!p.downed) p.hp = Math.min(p.maxHp, p.hp + 10);
    }

    // Farm harvest — +1 herb and +1 berry per farm tile, for each living player
    const farmCount = this.map.tiles.filter(t => t === T.FARM).length;
    if (farmCount > 0) {
      const living = this.players.filter(p => !p.downed);
      for (const p of living) {
        p.addRes('herb', farmCount);
        p.addItem('berry', farmCount);
      }
      this.announcementText  = `Farm harvest: +${farmCount} Herb, +${farmCount} Berries`;
      this.announcementTimer = 2000;
    }

    // Auto-save
    this.emit('save', this.toSaveData());

    if (this.nightNumber >= TOTAL_NIGHTS) {
      const won = this.kidsRescued >= 4;
      this._broadcastGameEnd(won);
      this.stop(); // game is over — no need to keep ticking
    }
  }

  // ── Waves ─────────────────────────────────────────────────────────────────
  _onKidRescued() {
    this._pendingWaves += 10;
    this.waveMax = this.currentWave + this._pendingWaves;
    if (!this.waveActive) this._startWave();
  }

  _startWave() {
    if (this._pendingWaves <= 0) { this.waveActive = false; return; }
    this._pendingWaves--;
    this.currentWave++;
    this.waveActive = true;
    // wave 1 → 4 enemies … capped at 13 even when rescues stack extra waves
    this._spawnVillagers(3 + Math.min(this.currentWave, 10));
  }

  _checkWaveCleared() {
    if (!this.waveActive || this._waveTransitioning) return;
    const alive = this.enemies.filter(e => e instanceof Villager && e.alive);
    if (alive.length === 0) {
      if (this._pendingWaves > 0) {
        this._waveTransitioning = true;
        setTimeout(() => { this._waveTransitioning = false; this._startWave(); }, 2500);
      } else {
        this.waveActive = false;
      }
    }
  }

  // ── Spawn helpers ─────────────────────────────────────────────────────────
  _edgeSpawnPos() {
    const side = randInt(0,3);
    const m = TILE_SIZE * 2;
    const W = MAP_COLS*TILE_SIZE, H = MAP_ROWS*TILE_SIZE;
    if (side===0) return { x:randInt(m,W-m), y:m };
    if (side===1) return { x:randInt(m,W-m), y:H-m };
    if (side===2) return { x:m,              y:randInt(m,H-m) };
                  return { x:W-m,            y:randInt(m,H-m) };
  }

  _spawnGoats(n) {
    for (let i=0;i<n;i++) { const p=this._edgeSpawnPos(); this.enemies.push(new Goat(p.x,p.y)); }
  }

  // Two goat guards inside each unrescued kid's mine. Guards are flagged so
  // the dawn cleanup doesn't remove them.
  _spawnMineGuards() {
    for (const kid of this.kids) {
      if (kid.rescued) continue;
      for (const off of [-2, 2]) {
        const g = new Goat(kid.x + off * TILE_SIZE, kid.y);
        g.guard = true;
        this.enemies.push(g);
      }
    }
  }

  _spawnVillagers(n) {
    for (let i=0;i<n;i++) { const p=this._edgeSpawnPos(); this.enemies.push(new Villager(p.x,p.y)); }
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────
  _broadcast() {
    const msg = JSON.stringify({
      type:         'tick',
      players:      this.players.map(p => p.toNet()),
      enemies:      this.enemies.filter(e => e.alive && !e.retreated).map(e => e.toNet()),
      projectiles:  this.projectiles.map(p => ({ id:p.id,type:p.type,x:Math.round(p.x),y:Math.round(p.y),w:p.w,h:p.h })),
      kids:         this.kids.map(k => k.toNet()),
      phase:        this.phase,
      nightNumber:  this.nightNumber,
      phaseTimer:   Math.round(this.phaseTimer),
      kidsRescued:  this.kidsRescued,
      waveActive:   this.waveActive,
      currentWave:  this.currentWave,
      waveMax:      this.waveMax,
      announcement: this.announcementTimer > 0 ? this.announcementText : '',
      tileDiffs:    this.map.flushDirty(),
    });
    for (const p of this.players) {
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }

  _broadcastLobbyList() {
    const msg = JSON.stringify({
      type:         'lobby_players',
      hostUsername: this.hostUsername,
      players:      this.players.map(p => ({ username:p.username, playerIdx:p.playerIdx, bodyColor:p.bodyColor })),
    });
    for (const p of this.players) {
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }

  _broadcastGameEnd(won) {
    const msg = JSON.stringify({ type: won ? 'victory' : 'game_over', nightNumber: this.nightNumber });
    for (const p of this.players) {
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }

  // ── Event emitter (for save callbacks) ───────────────────────────────────
  emit(event, data) {
    if (this._listeners && this._listeners[event]) {
      for (const fn of this._listeners[event]) fn(data);
    }
  }
  on(event, fn) {
    this._listeners = this._listeners || {};
    this._listeners[event] = this._listeners[event] || [];
    this._listeners[event].push(fn);
  }

  // ── Serialization ─────────────────────────────────────────────────────────
  toSaveData() {
    return {
      nightNumber:  this.nightNumber,
      kidsRescued:  this.kidsRescued,
      phase:        this.phase,
      phaseTimerMs: Math.round(this.phaseTimer),
      tiles:        this.map.toBase64(),
      stumpTimers:  { ...this.map.stumpTimers },
      kids:         this.kids.map(k => ({ rescued: k.rescued, safe: k.safe })),
      players:      this.players.map(p => p.toSave()),
    };
  }
}

module.exports = { GameRoom };
