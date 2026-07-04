// Shared humanoid sprite: body + skin head + hat, used by all human-type enemies
function drawHumanoid(ctx, sx, sy, w, h, bodyColor, hatColor, flash) {
  const hx = sx + Math.floor(w / 2) - 6; // head x offset
  // Body
  ctx.fillStyle = bodyColor;
  ctx.fillRect(sx + 2, sy + Math.floor(h * 0.42), w - 4, Math.floor(h * 0.58));
  // Head
  ctx.fillStyle = flash ? '#fff' : '#ffcc99';
  ctx.fillRect(hx, sy + Math.floor(h * 0.1), 12, 11);
  // Hat brim
  ctx.fillStyle = flash ? '#fff' : hatColor;
  ctx.fillRect(hx - 2, sy + Math.floor(h * 0.1) - 1, 16, 3);
  // Hat top
  ctx.fillRect(hx, sy + Math.floor(h * 0.1) - 7, 12, 7);
  // Eyes
  if (!flash) {
    ctx.fillStyle = '#222';
    ctx.fillRect(hx + 2, sy + Math.floor(h * 0.1) + 3, 2, 2);
    ctx.fillRect(hx + 8, sy + Math.floor(h * 0.1) + 3, 2, 2);
  }
}

class Enemy extends Entity {
  constructor(x, y, w, h) {
    super(x, y, w, h);
    this.isPlayer    = false;
    this.dmgCooldown = 0;
    this.speed       = 100;
    this.damage      = 10;
    this.wanderTimer = randFloat(800, 2400);
    this.wanderDx    = 0;
    this.wanderDy    = 0;
  }

  wander(dt, map) {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = randFloat(800, 2400);
      const a = randFloat(0, Math.PI * 2);
      this.wanderDx = Math.cos(a);
      this.wanderDy = Math.sin(a);
    }
    this.moveX(this.wanderDx * 36 * dt / 1000, map);
    this.moveY(this.wanderDy * 36 * dt / 1000, map);
  }

  seek(target, spd, dt, map) {
    const dx = target.x + target.w / 2 - (this.x + this.w / 2);
    const dy = target.y + target.h / 2 - (this.y + this.h / 2);
    const n  = normalize(dx, dy);
    this.moveX(n.x * spd * dt / 1000, map);
    this.moveY(n.y * spd * dt / 1000, map);
  }

  tryHit(player) {
    if (this.dmgCooldown > 0 || player.dmgCooldown > 0) return;
    if (rectOverlap(this, player)) {
      player.takeDamage(this.damage);
      player.dmgCooldown = 700;
      this.dmgCooldown   = 600;
    }
  }

  baseUpdate(dt) {
    if (this.flashTimer  > 0) this.flashTimer  -= dt;
    if (this.dmgCooldown > 0) this.dmgCooldown -= dt;
  }
}

// ─── Goat ─────────────────────────────────────────────────────────────────────
class Goat extends Enemy {
  constructor(x, y) {
    super(x, y, 28, 20);
    this.maxHp = 30; this.hp = 30;
    this.damage = 8; this.speed = 118;
    this.alertRange  = 300;
    this.state       = 'wander';
    this.chargeTele  = 0;
    this.chargeDur   = 0;
    this.chargeCd    = 0;
    this.chargeDir   = { x: 1, y: 0 };
  }

  update(dt, player, map) {
    if (!this.alive) return;
    this.baseUpdate(dt);
    if (this.chargeCd > 0) this.chargeCd -= dt;

    const d = distance(
      { x: this.x + this.w/2, y: this.y + this.h/2 },
      { x: player.x + player.w/2, y: player.y + player.h/2 }
    );

    if (this.state === 'charge') {
      this.chargeDur -= dt;
      this.moveX(this.chargeDir.x * 240 * dt / 1000, map);
      this.moveY(this.chargeDir.y * 240 * dt / 1000, map);
      if (this.chargeDur <= 0) { this.state = 'wander'; this.chargeCd = 3000; }
    } else if (this.state === 'telegraph') {
      this.chargeTele -= dt;
      if (this.chargeTele <= 0) {
        this.state = 'charge';
        this.chargeDur = 650;
        const dx = player.x - this.x; const dy = player.y - this.y;
        this.chargeDir = normalize(dx, dy);
      }
    } else {
      if (d < this.alertRange && this.chargeCd <= 0) {
        this.state = 'telegraph'; this.chargeTele = 480;
      } else if (d < this.alertRange) {
        this.seek(player, this.speed, dt, map);
      } else {
        this.wander(dt, map);
      }
    }

    this.tryHit(player);
  }

  draw(ctx, sx, sy) {
    const flash = this.flashTimer > 0 && Math.floor(this.flashTimer / 50) % 2 === 0;
    const tele  = this.state === 'telegraph';
    const body  = flash ? '#fff' : (tele ? '#ffbbbb' : '#909090');
    drawHumanoid(ctx, sx, sy, this.w, this.h, body, '#555555', flash);
    // Club
    if (!flash) {
      ctx.strokeStyle = '#6b4226'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx + this.w, sy + this.h / 2);
      ctx.lineTo(sx + this.w + 10, sy + this.h / 2 - 10);
      ctx.stroke();
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(sx + this.w + 10, sy + this.h / 2 - 12, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawHpBar(ctx, sx, sy - 10);
  }
}

// ─── Villager ─────────────────────────────────────────────────────────────────
class Villager extends Enemy {
  constructor(x, y) {
    super(x, y, 20, 30);
    this.maxHp = 50; this.hp = 50;
    this.damage = 12; this.speed = 100;
  }

  update(dt, player, map) {
    if (!this.alive) return;
    this.baseUpdate(dt);
    this.seek(player, this.speed, dt, map);
    this.tryHit(player);
  }

  draw(ctx, sx, sy) {
    const flash = this.flashTimer > 0 && Math.floor(this.flashTimer / 50) % 2 === 0;
    const body  = flash ? '#fff' : '#5a3080';
    drawHumanoid(ctx, sx, sy, this.w, this.h, body, '#3a1a60', flash);
    // Torch
    if (!flash) {
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(sx + this.w, sy + 8, 3, 16);
      ctx.fillStyle = '#ff8800';
      ctx.beginPath();
      ctx.arc(sx + this.w + 1, sy + 7, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,180,0,0.4)';
      ctx.beginPath();
      ctx.arc(sx + this.w + 1, sy + 7, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawHpBar(ctx, sx, sy - 10);
  }
}

// ─── BipedalDeer ──────────────────────────────────────────────────────────────
class BipedalDeer extends Enemy {
  constructor(x, y) {
    super(x, y, 42, 56);
    this.maxHp = 400; this.hp = 400;
    this.damage = 25; this.speed = 140;
    this.phase = 1;

    this.state     = 'approach';
    this.chargeCd  = 0;
    this.chargeDur = 0;
    this.chargeDir = { x: 0, y: 1 };

    this.thornCd   = 0;
    this.summonCd  = 0;

    this.retreated    = false;
    this.returnNight  = 0;
    this.hasReturned  = false; // true after coming back from its retreat
  }

  getPhase() { return (this.hasReturned || this.hp <= this.maxHp * 0.5) ? 2 : 1; }

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

  update(dt, player, map, projectiles, nightNum, spawnGoatFn) {
    if (!this.alive || this.retreated) return;
    this.baseUpdate(dt);
    if (this.chargeCd  > 0) this.chargeCd  -= dt;
    if (this.thornCd   > 0) this.thornCd   -= dt;
    if (this.summonCd  > 0) this.summonCd  -= dt;
    this.phase = this.getPhase();

    const d = distance(
      { x: this.x + this.w/2, y: this.y + this.h/2 },
      { x: player.x + player.w/2, y: player.y + player.h/2 }
    );

    if (this.state === 'charge') {
      this.chargeDur -= dt;
      this.moveX(this.chargeDir.x * 300 * dt / 1000, map);
      this.moveY(this.chargeDir.y * 300 * dt / 1000, map);
      if (this.chargeDur <= 0) { this.state = 'approach'; this.chargeCd = 3500; }
    } else {
      if (d > 50) this.seek(player, this.speed + (this.phase === 2 ? 30 : 0), dt, map);

      if (d < 260 && this.chargeCd <= 0) {
        this.state = 'charge'; this.chargeDur = 750;
        const dx = player.x - this.x; const dy = player.y - this.y;
        this.chargeDir = normalize(dx, dy);
        this.chargeCd = 4000;
      }

      // Phase 2: thorn burst
      if (this.phase === 2 && this.thornCd <= 0) {
        this._shootThorns(player, projectiles);
        this.thornCd = 2800;
      }

      // Phase 1: summon goats every 30s
      if (this.phase === 1 && this.summonCd <= 0) {
        spawnGoatFn(2);
        this.summonCd = 30000;
      }
    }

    this.tryHit(player);
  }

  _shootThorns(player, projectiles) {
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const dx = player.x - cx; const dy = player.y - cy;
    const base = Math.atan2(dy, dx);
    for (const off of [-0.35, 0, 0.35]) {
      projectiles.push({
        type: 'thorn', alive: true,
        x: cx, y: cy,
        dx: Math.cos(base + off), dy: Math.sin(base + off),
        speed: 240, dmg: 15, w: 8, h: 8
      });
    }
  }

  draw(ctx, sx, sy) {
    if (this.retreated) return;
    const p2    = this.phase === 2;
    const flash = this.flashTimer > 0 && Math.floor(this.flashTimer / 50) % 2 === 0;

    // Legs
    ctx.fillStyle = flash ? '#fff' : (p2 ? '#6a2e00' : '#7a5030');
    ctx.fillRect(sx + 8,           sy + this.h - 14, 10, 14);
    ctx.fillRect(sx + this.w - 18, sy + this.h - 14, 10, 14);

    // Torso
    ctx.fillStyle = flash ? '#fff' : (p2 ? '#8b3a00' : '#8b5e3c');
    ctx.fillRect(sx + 6, sy + 22, this.w - 12, this.h - 30);

    // Head
    ctx.fillStyle = flash ? '#fff' : (p2 ? '#a04820' : '#a07040');
    ctx.fillRect(sx + 10, sy + 8, 22, 16);

    // Snout
    ctx.fillStyle = flash ? '#fff' : '#c09070';
    ctx.fillRect(sx + 13, sy + 17, 10, 7);

    // Eyes
    ctx.fillStyle = p2 ? '#ff2200' : '#200800';
    ctx.fillRect(sx + 13, sy + 10, 4, 5);
    ctx.fillRect(sx + 23, sy + 10, 4, 5);

    // Antlers (left)
    ctx.strokeStyle = flash ? '#fff' : (p2 ? '#ff4400' : '#5c3a1a');
    ctx.lineWidth = p2 ? 3.5 : 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx + 14, sy + 8);
    ctx.lineTo(sx + 8,  sy - 4);
    ctx.lineTo(sx + 3,  sy + 4);
    ctx.moveTo(sx + 8,  sy - 4);
    ctx.lineTo(sx + 12, sy - 12);
    ctx.stroke();
    // (right)
    ctx.beginPath();
    ctx.moveTo(sx + 28, sy + 8);
    ctx.lineTo(sx + 34, sy - 4);
    ctx.lineTo(sx + 39, sy + 4);
    ctx.moveTo(sx + 34, sy - 4);
    ctx.lineTo(sx + 30, sy - 12);
    ctx.stroke();

    this.drawHpBar(ctx, sx, sy - 6);

    if (p2) {
      ctx.fillStyle = '#ff4400';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ENRAGED', sx + this.w / 2, sy - 10);
    }
  }
}
