class TileMap {
  constructor() {
    this.cols  = MAP_COLS;
    this.rows  = MAP_ROWS;
    this.tiles = new Uint8Array(this.cols * this.rows);
    this.stumpTimers = {};
    this.generate();
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
    if (TILE_SOLID.has(t)) return true;
    if (!isPlayer && t === T.DOOR) return true;
    return false;
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

    // Clear starting area
    this._clearArea(PLAYER_START.tx, PLAYER_START.ty, 5);
    this.set(CRAFTING_TABLE_POS.tx, CRAFTING_TABLE_POS.ty, T.CRAFTING_TABLE);
    // Pre-placed campfire so the player can see one immediately
    this.set(PLAYER_START.tx + 2, PLAYER_START.ty - 2, T.CAMPFIRE);

    // Clear around each kid
    for (const p of KID_POSITIONS) this._clearArea(p.tx, p.ty, 3);
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

      default:
        ctx.fillStyle = '#2d5a27';
        ctx.fillRect(x, y, s, s);
    }
  }
}
