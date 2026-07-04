class TileMap {
  constructor() {
    this.cols  = MAP_COLS;
    this.rows  = MAP_ROWS;
    this.tiles = new Uint8Array(this.cols * this.rows);
    this.stumpTimers = {};
    // Kid spawns are the interior centres of the 4 corner mines — computed
    // from the same deterministic math as generation, so solo and
    // multiplayer agree.
    this.kidSpawns = this._computeKidSpawns();
    this.generate();
  }

  // Deterministic placement of the mine in zone (zx, zy) — must stay
  // identical to server/gameRoom.js ServerTileMap._mineSpec.
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
    // Corner zones (NW, NE, SW, SE) — matches KID_COLORS order
    return [[0, 0], [3, 0], [0, 3], [3, 3]].map(([zx, zy]) => {
      const s = this._mineSpec(zx, zy);
      return { tx: s.cx, ty: s.cy };
    });
  }

  idx(tx, ty) { return ty * this.cols + tx; }

  get(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return T.TREE;
    return this.tiles[this.idx(tx, ty)];
  }

  set(tx, ty, type) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return;
    this.tiles[this.idx(tx, ty)] = type;
  }

  isSolid(tx, ty, isPlayer) {
    const t = this.get(tx, ty);
    if (t === T.DOOR) return !isPlayer;
    return TILE_SOLID.has(t);
  }

  generate() {
    this.tiles.fill(T.GRASS);

    // Border wall of trees
    for (let x = 0; x < this.cols; x++) {
      this.set(x, 0, T.TREE); this.set(x, this.rows - 1, T.TREE);
    }
    for (let y = 0; y < this.rows; y++) {
      this.set(0, y, T.TREE); this.set(this.cols - 1, y, T.TREE);
    }

    // Scatter trees
    for (let y = 2; y < this.rows - 2; y++) {
      for (let x = 2; x < this.cols - 2; x++) {
        if (Math.random() < 0.22) this.set(x, y, T.TREE);
      }
    }

    // Scatter rocks (~5%)
    for (let y = 2; y < this.rows - 2; y++) {
      for (let x = 2; x < this.cols - 2; x++) {
        if (this.get(x, y) === T.GRASS && Math.random() < 0.05) this.set(x, y, T.ROCK);
      }
    }

    // Scatter herbs (~3%)
    for (let y = 2; y < this.rows - 2; y++) {
      for (let x = 2; x < this.cols - 2; x++) {
        if (this.get(x, y) === T.GRASS && Math.random() < 0.03) this.set(x, y, T.HERB);
      }
    }

    // Scatter berry bushes (~1.5%) — the food source
    for (let y = 2; y < this.rows - 2; y++) {
      for (let x = 2; x < this.cols - 2; x++) {
        if (this.get(x, y) === T.GRASS && Math.random() < 0.015) this.set(x, y, T.BERRY_BUSH);
      }
    }

    // Clear starting area
    this._clearArea(PLAYER_START.tx, PLAYER_START.ty, 5);
    this.set(CRAFTING_TABLE_POS.tx, CRAFTING_TABLE_POS.ty, T.CRAFTING_TABLE);
    // Pre-placed campfire so the player can see one immediately
    this.set(PLAYER_START.tx + 2, PLAYER_START.ty - 2, T.CAMPFIRE);

    // Houses and mines — deterministic zone grid so solo matches multiplayer
    // layout. The 4 corner zones always hold a mine with a kid inside.
    const ZONES_X = 4, ZONES_Y = 4;
    const ZONE_W  = Math.floor(this.cols / ZONES_X);
    const ZONE_H  = Math.floor(this.rows / ZONES_Y);
    for (let zy = 0; zy < ZONES_Y; zy++) {
      for (let zx = 0; zx < ZONES_X; zx++) {
        const corner = (zx === 0 || zx === ZONES_X - 1) && (zy === 0 || zy === ZONES_Y - 1);
        if (corner) { this._genMine(zx, zy); continue; }

        const zoneCx = zx * ZONE_W + Math.floor(ZONE_W / 2);
        const zoneCy = zy * ZONE_H + Math.floor(ZONE_H / 2);
        if (Math.hypot(zoneCx - PLAYER_START.tx, zoneCy - PLAYER_START.ty) < 14) continue;

        const seed  = zx * 13 + zy * 7;
        const frac  = n => { const v = Math.sin(n * 47.3 + seed * 1.9) * 43758.5; return v - Math.floor(v); };

        let bx = Math.floor(zx * ZONE_W + 2 + frac(1) * (ZONE_W - 14));
        let by = Math.floor(zy * ZONE_H + 2 + frac(2) * (ZONE_H - 12));
        bx = Math.max(2, Math.min(bx, this.cols - 12));
        by = Math.max(2, Math.min(by, this.rows - 10));

        if (frac(3) < 0.65) this._genHouse(bx, by, seed);
        else                 this._genMine(zx, zy);
      }
    }
  }

  _genHouse(bx, by, seed) {
    const frac = n => { const v = Math.sin(n * 53.3 + seed * 2.7) * 43758.5; return v - Math.floor(v); };
    const sizes = [[6,5],[8,4],[5,7],[7,6]];
    const [w, h] = sizes[Math.floor(frac(1) * 4)];

    bx = Math.max(2, Math.min(bx, this.cols - w - 2));
    by = Math.max(2, Math.min(by, this.rows - h - 3));

    // Clear surroundings so house is accessible
    for (let dy = -1; dy <= h; dy++) {
      for (let dx = -1; dx <= w; dx++) {
        const tx = bx + dx, ty = by + dy;
        if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) continue;
        if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue;
        const t = this.get(tx, ty);
        if (t === T.TREE || t === T.ROCK || t === T.HERB) this.set(tx, ty, T.GRASS);
      }
    }

    // Walls and interior
    for (let ty = by; ty < by + h; ty++) {
      for (let tx = bx; tx < bx + w; tx++) {
        const wall = tx === bx || tx === bx+w-1 || ty === by || ty === by+h-1;
        this.set(tx, ty, wall ? T.WOOD_WALL : T.GRASS);
      }
    }

    // Door at south-center
    const doorTx = bx + Math.floor(w / 2);
    this.set(doorTx, by + h - 1, T.DOOR);
    if (by + h < this.rows) this.set(doorTx, by + h, T.GRASS);

    // Chest at interior center
    this.set(bx + Math.floor(w / 2), by + Math.floor(h / 2), T.CHEST);
  }

  // Enterable mine cave: rock shell, dark floor, 3-tile opening at the
  // south side, a chest inside. Corner-zone mines hold a kidnapped kid.
  _genMine(zx, zy) {
    const { bx, by, w, h } = this._mineSpec(zx, zy);

    // Clear surroundings so the cave is reachable
    for (let dy = -1; dy <= h + 2; dy++) {
      for (let dx = -1; dx <= w; dx++) {
        const tx = bx + dx, ty = by + dy;
        if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) continue;
        if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue;
        const t = this.get(tx, ty);
        if (t === T.TREE || t === T.ROCK || t === T.HERB || t === T.BERRY_BUSH) this.set(tx, ty, T.GRASS);
      }
    }

    // Rock shell with dark cave floor inside
    for (let ty = by; ty < by + h; ty++) {
      for (let tx = bx; tx < bx + w; tx++) {
        const wall = tx === bx || tx === bx + w - 1 || ty === by || ty === by + h - 1;
        this.set(tx, ty, wall ? T.CAVE_WALL : T.CAVE_FLOOR);
      }
    }

    // 3-tile-wide opening at south-centre (marker tile in the middle)
    const entrTx = bx + Math.floor(w / 2);
    const southY = by + h - 1;
    this.set(entrTx - 1, southY, T.CAVE_FLOOR);
    this.set(entrTx,     southY, T.MINE_ENTRANCE);
    this.set(entrTx + 1, southY, T.CAVE_FLOOR);

    // Chest in the north-west corner of the cave
    this.set(bx + 2, by + 2, T.CHEST);
  }

  _clearArea(cx, cy, r) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const t = this.get(cx + dx, cy + dy);
        if (t !== T.CRAFTING_TABLE) this.set(cx + dx, cy + dy, T.GRASS);
      }
    }
  }

  chopTree(tx, ty) {
    this.set(tx, ty, T.STUMP);
    this.stumpTimers[this.idx(tx, ty)] = 2;
  }

  onNightEnd(player) {
    const ptx = Math.floor((player.x + player.w / 2) / TILE_SIZE);
    const pty = Math.floor((player.y + player.h / 2) / TILE_SIZE);
    for (const key of Object.keys(this.stumpTimers)) {
      this.stumpTimers[key]--;
      if (this.stumpTimers[key] <= 0) {
        const idx = parseInt(key);
        const tx = idx % this.cols;
        const ty = Math.floor(idx / this.cols);
        // Don't regrow if player is standing on or adjacent to this tile
        if (Math.abs(tx - ptx) <= 1 && Math.abs(ty - pty) <= 1) {
          this.stumpTimers[key] = 1; // delay one more night
          continue;
        }
        this.tiles[idx] = T.TREE;
        delete this.stumpTimers[key];
      }
    }
  }

  draw(ctx, camera) {
    const sx0 = Math.max(0, Math.floor(camera.x / TILE_SIZE));
    const sy0 = Math.max(0, Math.floor(camera.y / TILE_SIZE));
    const sx1 = Math.min(this.cols - 1, Math.ceil((camera.x + CANVAS_W) / TILE_SIZE));
    const sy1 = Math.min(this.rows - 1, Math.ceil((camera.y + CANVAS_H) / TILE_SIZE));

    for (let ty = sy0; ty <= sy1; ty++) {
      for (let tx = sx0; tx <= sx1; tx++) {
        const t = this.get(tx, ty);
        const px = Math.round(tx * TILE_SIZE - camera.x + camera.sx);
        const py = Math.round(ty * TILE_SIZE - camera.y + camera.sy);
        this._drawTile(ctx, t, px, py, tx, ty);
      }
    }
  }

  _drawTile(ctx, type, x, y, tx, ty) {
    const s = TILE_SIZE;
    switch (type) {
      case T.GRASS:
        ctx.fillStyle = (tx + ty) % 2 === 0 ? '#2d5a27' : '#2a5525';
        ctx.fillRect(x, y, s, s);
        break;

      case T.TREE:
        ctx.fillStyle = '#1a3a16';
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = '#2a5a20';
        ctx.beginPath();
        ctx.arc(x + s / 2, y + s / 2, s / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3a7a28';
        ctx.beginPath();
        ctx.arc(x + s / 2 - 4, y + s / 2 - 4, s / 4, 0, Math.PI * 2);
        ctx.fill();
        break;

      case T.ROCK:
        ctx.fillStyle = '#2d5a27';
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = '#888';
        ctx.beginPath();
        ctx.ellipse(x + s / 2, y + s / 2 + 4, s / 2 - 4, s / 2 - 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#aaa';
        ctx.beginPath();
        ctx.ellipse(x + s / 2 - 3, y + s / 2, s / 4, s / 5, 0, 0, Math.PI * 2);
        ctx.fill();
        break;

      case T.STUMP:
        ctx.fillStyle = '#2d5a27';
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = '#6b4226';
        ctx.fillRect(x + 8, y + 10, s - 16, s - 16);
        ctx.fillStyle = '#8b5e3c';
        ctx.fillRect(x + 10, y + 12, s - 20, s - 20);
        break;

      case T.CRAFTING_TABLE:
        ctx.fillStyle = '#2d5a27';
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = '#8b4513';
        ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
        ctx.fillStyle = '#a0522d';
        ctx.fillRect(x + 5, y + 5, s - 10, s - 10);
        ctx.strokeStyle = '#5c2e00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + s / 2, y + 5); ctx.lineTo(x + s / 2, y + s - 5);
        ctx.moveTo(x + 5, y + s / 2); ctx.lineTo(x + s - 5, y + s / 2);
        ctx.stroke();
        break;

      case T.HERB:
        ctx.fillStyle = '#2d5a27';
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = '#6dc54a';
        ctx.beginPath();
        ctx.ellipse(x + 12, y + 12, 7, 4, -0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + 18, y + 17, 6, 3.5, 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + 10, y + 18, 5, 3, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4fa030';
        ctx.fillRect(x + 14, y + 14, 3, 10);
        break;

      case T.WOOD_WALL:
        ctx.fillStyle = '#6b4226';
        ctx.fillRect(x, y, s, s);
        ctx.strokeStyle = '#4a2d12';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
        ctx.strokeStyle = '#8b5e3c';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y + s / 2); ctx.lineTo(x + s, y + s / 2);
        ctx.stroke();
        break;

      case T.STONE_WALL:
        ctx.fillStyle = '#777';
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = '#999';
        ctx.fillRect(x + 3, y + 3, s - 6, 10);
        ctx.fillRect(x + 3, y + 18, s - 6, 10);
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
        break;

      case T.DOOR:
        ctx.fillStyle = '#2d5a27';
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = '#a0522d';
        ctx.fillRect(x + 6, y + 2, s - 12, s - 4);
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.arc(x + s - 10, y + s / 2, 3, 0, Math.PI * 2);
        ctx.fill();
        break;

      case T.CAMPFIRE:
        ctx.fillStyle = '#2d5a27';
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = '#6b4226';
        ctx.fillRect(x + 10, y + 20, 12, 6);
        ctx.fillStyle = '#ff4400';
        ctx.beginPath();
        ctx.moveTo(x + 16, y + 8); ctx.lineTo(x + 10, y + 22); ctx.lineTo(x + 22, y + 22);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffa500';
        ctx.beginPath();
        ctx.moveTo(x + 16, y + 13); ctx.lineTo(x + 12, y + 22); ctx.lineTo(x + 20, y + 22);
        ctx.closePath(); ctx.fill();
        break;

      case T.TRAP:
        ctx.fillStyle = '#2d5a27';
        ctx.fillRect(x, y, s, s);
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 6, y + 6, s - 12, s - 12);
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + s - 6, y + s - 6);
        ctx.moveTo(x + s - 6, y + 6); ctx.lineTo(x + 6, y + s - 6);
        ctx.stroke();
        break;

      case T.FARM:
        ctx.fillStyle = '#4a3a1a';
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = '#6b5a2a';
        for (let row = 0; row < 3; row++) {
          ctx.fillRect(x + 3, y + 4 + row * 9, s - 6, 4);
        }
        ctx.fillStyle = '#5db83a';
        ctx.fillRect(x + 7,  y + 3,  3, 6);
        ctx.fillRect(x + 14, y + 3,  3, 6);
        ctx.fillRect(x + 21, y + 3,  3, 6);
        ctx.fillRect(x + 7,  y + 12, 3, 6);
        ctx.fillRect(x + 14, y + 12, 3, 6);
        ctx.fillRect(x + 21, y + 12, 3, 6);
        break;

      case T.CHEST:
        ctx.fillStyle = (tx + ty) % 2 === 0 ? '#2d5a27' : '#2a5525';
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = '#7a4a20';
        ctx.fillRect(x + 4, y + 9, s - 8, s - 13);
        ctx.fillStyle = '#a0602a';
        ctx.fillRect(x + 4, y + 9, s - 8, 7);
        ctx.strokeStyle = '#3a1f00';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 4, y + 9, s - 8, s - 13);
        ctx.strokeRect(x + 4, y + 9, s - 8, 7);
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(x + s / 2 - 3, y + 13, 6, 5);
        ctx.fillRect(x + s / 2 - 1, y + 14, 2, 3);
        break;

      case T.MINE_ENTRANCE:
        ctx.fillStyle = '#111';
        ctx.fillRect(x, y, s, s);
        ctx.strokeStyle = '#7a4a20';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 4); ctx.lineTo(x + s - 3, y + s - 4);
        ctx.moveTo(x + s - 3, y + 4); ctx.lineTo(x + 3, y + s - 4);
        ctx.stroke();
        ctx.fillStyle = '#ff8800';
        ctx.beginPath();
        ctx.moveTo(x + s / 2, y + 4);
        ctx.lineTo(x + s - 5, y + s - 6);
        ctx.lineTo(x + 5, y + s - 6);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#111';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('!', x + s / 2, y + s - 10);
        ctx.textAlign = 'left';
        break;

      default:
        ctx.fillStyle = '#2d5a27';
        ctx.fillRect(x, y, s, s);
    }
  }
}
