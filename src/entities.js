class Entity {
  constructor(x, y, w, h) {
    this.x = x; this.y = y;
    this.w = w; this.h = h;
    this.hp = 100; this.maxHp = 100;
    this.alive = true;
    this.flashTimer = 0;
    this.isPlayer = false;
  }

  takeDamage(amt) {
    this.hp -= amt;
    this.flashTimer = 180;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    if (typeof Sfx !== 'undefined') Sfx.hit();
  }

  moveX(dx, map) {
    this.x += dx;
    const lx = Math.floor(this.x / TILE_SIZE);
    const rx = Math.floor((this.x + this.w - 1) / TILE_SIZE);
    const ty = Math.floor((this.y + 1) / TILE_SIZE);
    const by = Math.floor((this.y + this.h - 2) / TILE_SIZE);
    const hit = dx < 0
      ? (map.isSolid(lx, ty, this.isPlayer) || map.isSolid(lx, by, this.isPlayer))
      : (map.isSolid(rx, ty, this.isPlayer) || map.isSolid(rx, by, this.isPlayer));
    if (hit) this.x -= dx;
    this.x = clamp(this.x, TILE_SIZE, (MAP_COLS - 2) * TILE_SIZE - this.w);
  }

  moveY(dy, map) {
    this.y += dy;
    const tx = Math.floor((this.x + 1) / TILE_SIZE);
    const rx = Math.floor((this.x + this.w - 2) / TILE_SIZE);
    const ty = Math.floor(this.y / TILE_SIZE);
    const by = Math.floor((this.y + this.h - 1) / TILE_SIZE);
    const hit = dy < 0
      ? (map.isSolid(tx, ty, this.isPlayer) || map.isSolid(rx, ty, this.isPlayer))
      : (map.isSolid(tx, by, this.isPlayer) || map.isSolid(rx, by, this.isPlayer));
    if (hit) this.y -= dy;
    this.y = clamp(this.y, TILE_SIZE, (MAP_ROWS - 2) * TILE_SIZE - this.h);
  }

  // Push entity out of any solid tile it is overlapping
  unstuck(map) {
    const ts = TILE_SIZE;
    const x0 = Math.floor(this.x / ts);
    const x1 = Math.floor((this.x + this.w - 1) / ts);
    const y0 = Math.floor(this.y / ts);
    const y1 = Math.floor((this.y + this.h - 1) / ts);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!map.isSolid(tx, ty, this.isPlayer)) continue;
        const tl = tx * ts, tt = ty * ts;
        const ol = (this.x + this.w) - tl;   // overlap from left
        const or2 = (tl + ts) - this.x;       // overlap from right
        const ot = (this.y + this.h) - tt;    // overlap from top
        const ob = (tt + ts) - this.y;        // overlap from bottom
        const m = Math.min(ol, or2, ot, ob);
        if      (m === ol)  this.x = tl - this.w;
        else if (m === or2) this.x = tl + ts;
        else if (m === ot)  this.y = tt - this.h;
        else                this.y = tt + ts;
      }
    }
  }

  drawHpBar(ctx, sx, sy) {
    ctx.fillStyle = '#300';
    ctx.fillRect(sx, sy - 6, this.w, 4);
    ctx.fillStyle = '#f00';
    ctx.fillRect(sx, sy - 6, this.w * (this.hp / this.maxHp), 4);
  }
}

// ─── Player ───────────────────────────────────────────────────────────────────
class Player extends Entity {
  constructor(tx, ty) {
    super(tx * TILE_SIZE + 4, ty * TILE_SIZE + 4, 24, 24);
    this.isPlayer  = true;
    this.maxHp     = 100;
    this.hp        = 100;
    this.hunger    = 100;
    this.maxHunger = 100;
    this._starveTick = 0;
    this.speed     = 160;
    this.facing    = { x: 1, y: 0 };
    this.bodyColor = '#4488ff';
    this.downed    = false;

    // Combat
    this.weapon         = 'fist';
    this.atkCooldown    = 0;
    this.atkCooldownMax = 500;
    this.hitbox         = null; // { x,y,w,h,dmg,timer }
    this.dmgCooldown    = 0;    // immune while > 0
    this.arrows         = 0;

    // Inventory  resources + crafted items
    this.res   = { wood: 0, stone: 0, herb: 0 };
    this.items = {};              // id → count
    this.hotbar = Array(6).fill(null);
    this.slot   = 0;
    this.hasAxe = false;
  }

  // ── inventory helpers ──
  addRes(type, n) { this.res[type] = (this.res[type] || 0) + n; }

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

  selectedItem() { return this.hotbar[this.slot]; }

  equip(id) {
    const rec = RECIPES.find(r => r.id === id);
    if (!rec) return;
    if (rec.type === 'weapon') { this.weapon = id; }
    if (rec.type === 'tool' && id === 'axe') { this.hasAxe = true; }
  }

  // ── actions ──
  swing() {
    if (this.atkCooldown > 0) return null;
    this.atkCooldown = this.atkCooldownMax;
    const reach = this.weapon === 'spear' ? 52 : 36;
    const hw    = this.weapon === 'spear' ? 12 : 22;
    const cx = this.x + this.w / 2 + this.facing.x * reach;
    const cy = this.y + this.h / 2 + this.facing.y * reach;
    const dmg = this.weapon === 'spear' ? 25 : 15;
    this.hitbox = { x: cx - hw / 2, y: cy - hw / 2, w: hw, h: hw, dmg, timer: 200 };
    if (typeof Sfx !== 'undefined') Sfx.swing();
    return this.hitbox;
  }

  shootArrow() {
    if (this.weapon !== 'bow' || this.arrows <= 0 || this.atkCooldown > 0) return null;
    this.atkCooldown = 700;
    this.arrows--;
    if (typeof Sfx !== 'undefined') Sfx.arrow();
    return {
      type: 'arrow',
      x: this.x + this.w / 2, y: this.y + this.h / 2,
      dx: this.facing.x, dy: this.facing.y,
      speed: 420, dmg: 22, w: 10, h: 6, alive: true
    };
  }

  useItem(id) {
    const rec = RECIPES.find(r => r.id === id);
    if (!rec) return false;
    if (rec.type === 'consumable') {
      if (!this.removeItem(id)) return false;
      if (rec.heal)   this.hp     = Math.min(this.maxHp,     this.hp     + rec.heal);
      if (rec.hunger) this.hunger = Math.min(this.maxHunger, this.hunger + rec.hunger);
      if (typeof Sfx !== 'undefined') Sfx.eat();
      return true;
    }
    if (rec.type === 'weapon' || rec.type === 'tool') {
      this.equip(id);
      return true;
    }
    return false;
  }

  takeDamage(amt) {
    if (this.downed) return;
    this.hp -= amt;
    this.flashTimer = 180;
    if (this.hp <= 0) { this.hp = 0; this.downed = true; }
    if (typeof Sfx !== 'undefined') Sfx.hurt();
  }

  revive(hp = 25) {
    this.downed = false;
    this.hp = hp;
    this.flashTimer = 0;
    this.dmgCooldown = 1000;
  }

  update(dt, up, down, left, right, map) {
    if (this.downed) {
      if (this.dmgCooldown > 0) this.dmgCooldown -= dt;
      return;
    }
    let dx = 0, dy = 0;
    if (up)    dy -= 1;
    if (down)  dy += 1;
    if (left)  dx -= 1;
    if (right) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const n = normalize(dx, dy);
      this.facing = { x: n.x, y: n.y };
      this.moveX(n.x * this.speed * dt / 1000, map);
      this.moveY(n.y * this.speed * dt / 1000, map);
    }

    if (this.atkCooldown > 0) this.atkCooldown -= dt;
    if (this.dmgCooldown  > 0) this.dmgCooldown  -= dt;
    if (this.flashTimer   > 0) this.flashTimer   -= dt;
    if (this.hitbox) {
      this.hitbox.timer -= dt;
      if (this.hitbox.timer <= 0) this.hitbox = null;
    }

    // Hunger drains over time; starving chips HP
    this.hunger = Math.max(0, this.hunger - dt * HUNGER_DRAIN_PER_MS);
    if (this.hunger <= 0) {
      this._starveTick += dt;
      if (this._starveTick >= STARVE_INTERVAL_MS) {
        this._starveTick = 0;
        this.takeDamage(STARVE_DAMAGE);
        if (typeof Sfx !== 'undefined') Sfx.starve();
      }
    } else {
      this._starveTick = 0;
    }

    // Always push out of any solid tile (handles enemy shoves, regrown trees, etc.)
    this.unstuck(map);
  }

  draw(ctx, sx, sy) {
    // Downed: draw lying sideways
    if (this.downed) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = this.bodyColor;
      ctx.fillRect(sx - 4, sy + 14, this.h, 10); // body lying flat
      ctx.fillStyle = '#ffcc99';
      ctx.beginPath();
      ctx.arc(sx - 4 + this.h + 6, sy + 19, 7, 0, Math.PI * 2); // head at side
      ctx.fill();
      // Pulsing red cross to show they need help
      const pulse = Math.floor(Date.now() / 400) % 2 === 0;
      ctx.fillStyle = pulse ? '#ff2222' : '#ff8888';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('+', sx + this.w / 2, sy - 4);
      ctx.globalAlpha = 1;
      return;
    }

    // Flash white when hurt
    if (this.flashTimer > 0 && Math.floor(this.flashTimer / 50) % 2 === 0) {
      ctx.fillStyle = '#fff';
    } else {
      ctx.fillStyle = this.bodyColor;
    }
    ctx.fillRect(sx, sy + 6, this.w, this.h - 6);

    // Head
    ctx.fillStyle = '#ffcc99';
    ctx.fillRect(sx + 6, sy, 12, 10);

    // Eyes
    ctx.fillStyle = '#222';
    if (this.facing.x > 0.3) {
      ctx.fillRect(sx + 15, sy + 2, 2, 3);
    } else if (this.facing.x < -0.3) {
      ctx.fillRect(sx + 7, sy + 2, 2, 3);
    } else {
      ctx.fillRect(sx + 8, sy + 2, 2, 3);
      ctx.fillRect(sx + 14, sy + 2, 2, 3);
    }

    // Weapon visual
    if (this.weapon === 'spear') {
      ctx.strokeStyle = '#8b4513';
      ctx.lineWidth = 3;
      ctx.beginPath();
      const ex = sx + this.w / 2 + this.facing.x * 22;
      const ey = sy + this.h / 2 + this.facing.y * 22;
      ctx.moveTo(sx + this.w / 2, sy + this.h / 2);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = '#aaa';
      ctx.beginPath();
      ctx.arc(ex, ey, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon === 'bow') {
      ctx.strokeStyle = '#8b4513';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx + this.w / 2 + this.facing.x * 14,
              sy + this.h / 2 + this.facing.y * 14, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// ─── Kid ──────────────────────────────────────────────────────────────────────
class Kid extends Entity {
  constructor(tx, ty, idx) {
    super(tx * TILE_SIZE + 8, ty * TILE_SIZE + 6, 16, 22);
    this.kidIdx   = idx;
    this.color    = KID_COLORS[idx];
    this.rescued  = false;
    this.safe     = false;       // reached base
    this.knockedOut  = false;
    this.koTimer     = 0;
    this.isPlayer = false;
    this.hp = 60; this.maxHp = 60;
  }

  takeDamage(amt) {
    if (this.knockedOut) return;
    super.takeDamage(amt);
    if (!this.alive) {
      this.alive = true;
      this.hp = 10;
      this.knockedOut = true;
      this.koTimer = 8000;
    }
  }

  update(dt, player, map) {
    if (this.flashTimer > 0) this.flashTimer -= dt;
    if (this.koTimer > 0) {
      this.koTimer -= dt;
      if (this.koTimer <= 0) { this.knockedOut = false; }
    }
    if (!this.rescued || this.safe || this.knockedOut) return;

    // Walk toward base (crafting table)
    const bx = CRAFTING_TABLE_POS.tx * TILE_SIZE;
    const by = CRAFTING_TABLE_POS.ty * TILE_SIZE;
    const d  = distance({ x: this.x, y: this.y }, { x: bx, y: by });
    if (d < TILE_SIZE * 2) { this.safe = true; return; }

    // Follow player
    const px = player.x + player.w / 2;
    const py = player.y + player.h / 2;
    const dp = distance({ x: this.x + this.w / 2, y: this.y + this.h / 2 }, { x: px, y: py });
    if (dp > 48) {
      const n = normalize(px - this.x - this.w / 2, py - this.y - this.h / 2);
      this.moveX(n.x * 80 * dt / 1000, map);
      this.moveY(n.y * 80 * dt / 1000, map);
    }
  }

  draw(ctx, sx, sy) {
    if (!this.rescued) {
      // Exclamation mark to show kid needs help
      ctx.fillStyle = '#ffff00';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('!', sx + this.w / 2, sy - 4);
    }

    if (this.knockedOut) {
      ctx.fillStyle = '#666';
      ctx.fillRect(sx, sy + this.h / 2, this.w, this.h / 2);
      ctx.fillStyle = '#ffcc99';
      ctx.beginPath();
      ctx.arc(sx + this.w / 2, sy + this.h / 2 - 2, 6, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Flash
    if (this.flashTimer > 0 && Math.floor(this.flashTimer / 50) % 2 === 0) {
      ctx.fillStyle = '#fff';
    } else {
      ctx.fillStyle = this.color;
    }
    ctx.fillRect(sx, sy + 8, this.w, this.h - 8);

    // Head
    ctx.fillStyle = '#ffcc99';
    ctx.beginPath();
    ctx.arc(sx + this.w / 2, sy + 6, 7, 0, Math.PI * 2);
    ctx.fill();

    if (this.rescued) this.drawHpBar(ctx, sx, sy);
  }
}
