class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.state  = 'MENU';

    // Phase
    this.phase       = 'day';
    this.nightNumber = 0;
    this.phaseTimer  = DAY_DURATION;

    // Systems
    this.map      = new TileMap();
    this.camera   = new Camera();
    this.player   = new Player(PLAYER_START.tx, PLAYER_START.ty);
    this.crafting = new CraftingSystem(this.player);
    this.ui       = new UI(this);

    // Entities
    this.enemies     = [];
    this.projectiles = [];
    this.kids        = KID_POSITIONS.map((p, i) => new Kid(p.tx, p.ty, i));
    this.kidsRescued = 0;

    // Wave system
    this.waveActive  = false;
    this.currentWave = 0;
    this.waveEnemiesLeft = 0;

    // Deer boss
    this.deer         = null;
    this.deerDefeated = false;

    // Wave pending count
    this._pendingWaves = 0;

    // UI state
    this.nearCraftingTable = false;
    this.announcementText  = '';
    this.announcementTimer = 0;
    this.nightSurvivedBanner = 0;

    // Keys
    this.keys = {};
    this._setupEvents();

    this._lastTs = 0;
    requestAnimationFrame(ts => this._loop(ts));
  }

  _setupEvents() {
    window.addEventListener('keydown', e => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
      this.keys[e.code] = true;

      if (this.state === 'MENU' && e.code === 'Enter') { this._startGame(); return; }
      if ((this.state === 'GAME_OVER' || this.state === 'VICTORY') && e.code === 'Enter') {
        this._resetGame(); return;
      }
      if (e.code === 'Escape' && this.state === 'CRAFTING') { this.state = 'PLAYING'; return; }

      if (this.state !== 'PLAYING' && this.state !== 'CRAFTING') return;

      // Hotbar slot
      for (let i = 1; i <= 6; i++) {
        if (e.code === `Digit${i}`) this.player.slot = i - 1;
      }

      if (e.code === 'Space' && this.state === 'PLAYING') this._doAttack();
      if (e.code === 'KeyE'  && this.state === 'PLAYING') this._doInteract();
      if (e.code === 'KeyE'  && this.state === 'CRAFTING') { this.state = 'PLAYING'; }
    });

    window.addEventListener('keyup', e => { this.keys[e.code] = false; });

    this.canvas.addEventListener('click', e => {
      if (this.state !== 'CRAFTING') return;
      const r  = this.canvas.getBoundingClientRect();
      const sx = (e.clientX - r.left) * (CANVAS_W / r.width);
      const sy = (e.clientY - r.top)  * (CANVAS_H / r.height);
      this.ui.handleCraftingClick(sx, sy, this.crafting);
    });
  }

  _startGame() {
    this.state       = 'PLAYING';
    this.phase       = 'day';
    this.nightNumber = 0;
    this.phaseTimer  = DAY_DURATION;
  }

  _resetGame() {
    this.map      = new TileMap();
    this.player   = new Player(PLAYER_START.tx, PLAYER_START.ty);
    this.crafting = new CraftingSystem(this.player);
    this.enemies  = [];
    this.projectiles = [];
    this.kids     = KID_POSITIONS.map((p, i) => new Kid(p.tx, p.ty, i));
    this.kidsRescued = 0;
    this.waveActive    = false;
    this.currentWave   = 0;
    this._pendingWaves = 0;
    this.deer = null;
    this.deerDefeated = false;
    this.phase       = 'day';
    this.nightNumber = 0;
    this.phaseTimer  = DAY_DURATION;
    this.state = 'PLAYING';
    this.nightSurvivedBanner = 0;
  }

  // ── Phase transitions ──────────────────────────────────────────────────────
  _startNight() {
    this.phase      = 'night';
    this.phaseTimer = NIGHT_DURATION;
    this.nightNumber++;

    // Goat spawns: 2 + floor(night/10)
    const goatCount = 2 + Math.floor(this.nightNumber / 10);
    this._spawnGoats(goatCount);

    // Night 50: The Warden appears
    if (this.nightNumber === 50 && !this.deer) {
      this._spawnDeer();
    } else if (this.deer && this.deer.retreated && this.nightNumber >= this.deer.returnNight) {
      // Deer returns
      this.deer.retreated = false;
      this.deer.maxHp = 200;
      this.deer.hp    = 200;
      this.deer.phase = 2;
    }

    // If waves pending from kid rescue, start next wave
    if (!this.waveActive && this._pendingWaves > 0) {
      this._startWave();
    }
  }

  _startDay() {
    this.phase      = 'day';
    this.phaseTimer = DAY_DURATION;

    // Remove remaining night enemies (but not deer)
    this.enemies = this.enemies.filter(e => e instanceof BipedalDeer);

    // Night survived bonus
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 10);
    this.nightSurvivedBanner = 2000;
    this.map.onNightEnd();

    if (this.nightNumber >= TOTAL_NIGHTS) {
      if (this.kidsRescued >= 4) {
        this.state = 'VICTORY';
      } else {
        this.announcementText  = 'You survived 99 nights but the kids are lost…';
        this.announcementTimer = 3000;
        setTimeout(() => { this.state = 'GAME_OVER'; }, 3500);
      }
    }
  }

  // ── Spawn helpers ─────────────────────────────────────────────────────────
  _spawnGoats(n) {
    for (let i = 0; i < n; i++) {
      const pos = this._edgeSpawnPos();
      this.enemies.push(new Goat(pos.x, pos.y));
    }
  }

  _spawnVillagers(n) {
    for (let i = 0; i < n; i++) {
      const pos = this._edgeSpawnPos();
      this.enemies.push(new Villager(pos.x, pos.y));
    }
  }

  _spawnDeer() {
    const cx = (MAP_COLS / 2) * TILE_SIZE;
    const cy = (MAP_ROWS / 2) * TILE_SIZE;
    this.deer = new BipedalDeer(cx, cy);
    this.enemies.push(this.deer);
    this.announcementText  = '⚠ THE WARDEN AWAKENS ⚠';
    this.announcementTimer = 4000;
    this.camera.shake(1200, 10);
  }

  _edgeSpawnPos() {
    const side = randInt(0, 3);
    const margin = TILE_SIZE * 2;
    const mapW = MAP_COLS * TILE_SIZE;
    const mapH = MAP_ROWS * TILE_SIZE;
    let x, y;
    if (side === 0)      { x = randInt(margin, mapW - margin); y = margin; }
    else if (side === 1) { x = randInt(margin, mapW - margin); y = mapH - margin; }
    else if (side === 2) { x = margin;          y = randInt(margin, mapH - margin); }
    else                 { x = mapW - margin;   y = randInt(margin, mapH - margin); }
    return { x, y };
  }

  // ── Wave system ───────────────────────────────────────────────────────────
  _onKidRescued() {
    this._pendingWaves += 10;
    this.announcementText  = '⚡ THEY ARE COMING! ⚡';
    this.announcementTimer = 2500;
    if (!this.waveActive) this._startWave();
  }

  _startWave() {
    if (this._pendingWaves <= 0) { this.waveActive = false; return; }
    this._pendingWaves--;
    this.currentWave = 10 - this._pendingWaves;
    this.waveActive  = true;
    const count = 3 + this.currentWave; // wave 1 → 4 enemies … wave 10 → 13
    this._spawnVillagers(count);
    this.waveEnemiesLeft = count;
  }

  _checkWaveCleared() {
    const villagers = this.enemies.filter(e => e instanceof Villager && e.alive);
    if (this.waveActive && villagers.length === 0) {
      if (this._pendingWaves > 0) {
        setTimeout(() => this._startWave(), 2000);
      } else {
        this.waveActive = false;
      }
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  _doAttack() {
    const p  = this.player;
    const id = p.selectedItem();

    if (p.weapon === 'bow') {
      const proj = p.shootArrow();
      if (proj) this.projectiles.push(proj);
      return;
    }

    // Consumable / equip
    if (id) {
      const rec = RECIPES.find(r => r.id === id);
      if (rec && (rec.type === 'consumable' || rec.type === 'weapon' || rec.type === 'tool')) {
        p.useItem(id);
        return;
      }
    }

    const hb = p.swing();
    if (!hb) return;

    // Check hits on enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (rectOverlap(hb, e)) {
        e.takeDamage(hb.dmg);
        if (!e.alive && e instanceof BipedalDeer) {
          this.deerDefeated = true;
        }
      }
    }
  }

  _doInteract() {
    const p = this.player;

    // Priority 1: crafting table
    const ctx = CRAFTING_TABLE_POS.tx * TILE_SIZE;
    const cty = CRAFTING_TABLE_POS.ty * TILE_SIZE;
    if (distance({ x: p.x, y: p.y }, { x: ctx, y: cty }) < TILE_SIZE * 2.5) {
      this.state = 'CRAFTING'; return;
    }

    // Priority 2: rescue kid
    for (const kid of this.kids) {
      if (!kid.rescued && distance({ x: p.x, y: p.y }, kid) < TILE_SIZE * 2) {
        kid.rescued = true;
        this.kidsRescued++;
        this.announcementText  = `Kid ${this.kidsRescued}/4 rescued!`;
        this.announcementTimer = 2000;
        this._onKidRescued();
        return;
      }
    }

    // Priority 3: place item
    const selId = p.selectedItem();
    if (selId) {
      const rec = RECIPES.find(r => r.id === selId && r.type === 'placeable');
      if (rec && (p.items[selId] || 0) > 0) {
        if (this.crafting.placeItem(p, this.map)) return;
      }
    }

    // Priority 4: gather — scan facing tile + all 4 cardinal neighbours
    const pcx = Math.floor((p.x + p.w / 2) / TILE_SIZE);
    const pcy = Math.floor((p.y + p.h / 2) / TILE_SIZE);
    // Facing tile first, then cardinal tiles so nearest always wins
    const faceTx = Math.floor((p.x + p.w / 2 + p.facing.x * TILE_SIZE * 0.9) / TILE_SIZE);
    const faceTy = Math.floor((p.y + p.h / 2 + p.facing.y * TILE_SIZE * 0.9) / TILE_SIZE);
    const gatherCandidates = [
      { tx: faceTx, ty: faceTy },
      { tx: pcx,     ty: pcy - 1 },
      { tx: pcx,     ty: pcy + 1 },
      { tx: pcx - 1, ty: pcy     },
      { tx: pcx + 1, ty: pcy     },
    ];

    for (const c of gatherCandidates) {
      const tile = this.map.get(c.tx, c.ty);
      if (tile === T.TREE) {
        const count = p.hasAxe ? 2 : 1;
        p.addRes('wood', count);
        this.map.chopTree(c.tx, c.ty);
        this.crafting.feedback = `+${count} Wood`;
        this.crafting.feedbackTimer = 1400;
        return;
      } else if (tile === T.ROCK) {
        p.addRes('stone', 1);
        this.map.set(c.tx, c.ty, T.GRASS);
        this.crafting.feedback = '+1 Stone';
        this.crafting.feedbackTimer = 1400;
        return;
      } else if (tile === T.HERB) {
        const count = randInt(1, 2);
        p.addRes('herb', count);
        this.map.set(c.tx, c.ty, T.GRASS);
        this.crafting.feedback = `+${count} Herb`;
        this.crafting.feedbackTimer = 1400;
        return;
      }
    }
  }

  // ── Update ────────────────────────────────────────────────────────────────
  _update(dt) {
    const p = this.player;

    // Phase timer
    this.phaseTimer -= dt;
    if (this.phaseTimer <= 0) {
      if (this.phase === 'day')   this._startNight();
      else                         this._startDay();
    }

    // Player update
    p.update(dt, this.keys, this.map);

    // Proximity to crafting table
    const ctx2 = CRAFTING_TABLE_POS.tx * TILE_SIZE;
    const cty2 = CRAFTING_TABLE_POS.ty * TILE_SIZE;
    this.nearCraftingTable = distance({ x: p.x, y: p.y }, { x: ctx2, y: cty2 }) < TILE_SIZE * 2.5;

    // Enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e instanceof BipedalDeer) {
        e.update(dt, p, this.map, this.projectiles, this.nightNumber,
          (n) => this._spawnGoats(n));
      } else {
        e.update(dt, p, this.map);
      }

      // Trap damage
      const etx = Math.floor((e.x + e.w / 2) / TILE_SIZE);
      const ety = Math.floor((e.y + e.h / 2) / TILE_SIZE);
      if (this.map.get(etx, ety) === T.TRAP) {
        e.takeDamage(20);
        this.map.set(etx, ety, T.GRASS); // trap consumed
      }
    }
    this.enemies = this.enemies.filter(e => e.alive);

    // Player attack hitbox vs enemies (handled in _doAttack for melee,
    // but also check if hitbox is still active after the key press)
    if (p.hitbox) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (e._hitThisSwing) continue;
        if (rectOverlap(p.hitbox, e)) {
          e.takeDamage(p.hitbox.dmg);
          e._hitThisSwing = true;
          if (!e.alive && e instanceof BipedalDeer) this.deerDefeated = true;
        }
      }
    }
    // Reset hit flag when hitbox expires
    if (!p.hitbox) { for (const e of this.enemies) delete e._hitThisSwing; }

    // Kids
    for (const kid of this.kids) kid.update(dt, p, this.map);

    // Projectiles
    for (const proj of this.projectiles) {
      if (!proj.alive) continue;
      proj.x += proj.dx * proj.speed * dt / 1000;
      proj.y += proj.dy * proj.speed * dt / 1000;

      // Out of bounds
      if (proj.x < 0 || proj.y < 0 ||
          proj.x > MAP_COLS * TILE_SIZE || proj.y > MAP_ROWS * TILE_SIZE) {
        proj.alive = false; continue;
      }
      // Hit solid tile
      const ptx = Math.floor(proj.x / TILE_SIZE);
      const pty = Math.floor(proj.y / TILE_SIZE);
      if (this.map.isSolid(ptx, pty, false)) { proj.alive = false; continue; }

      const pbox = { x: proj.x - proj.w / 2, y: proj.y - proj.h / 2, w: proj.w, h: proj.h };

      if (proj.type === 'arrow') {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (rectOverlap(pbox, e)) { e.takeDamage(proj.dmg); proj.alive = false; break; }
        }
      } else if (proj.type === 'thorn') {
        if (p.dmgCooldown <= 0 && rectOverlap(pbox, p)) {
          p.takeDamage(proj.dmg);
          p.dmgCooldown = 500;
          proj.alive = false;
        }
      }
    }
    this.projectiles = this.projectiles.filter(pr => pr.alive);

    // Wave cleared check
    this._checkWaveCleared();

    // Crafting system
    this.crafting.update(dt);

    // Camera
    this.camera.update(p, dt);

    // Night survived banner
    if (this.nightSurvivedBanner > 0) this.nightSurvivedBanner -= dt;

    // Player dead?
    if (!p.alive) this.state = 'GAME_OVER';
  }

  // ── Draw ──────────────────────────────────────────────────────────────────
  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    if (this.state === 'MENU') { this.ui.drawMenu(ctx); return; }
    if (this.state === 'GAME_OVER') { this.ui.drawGameOver(ctx, this.nightNumber); return; }
    if (this.state === 'VICTORY')   { this.ui.drawVictory(ctx);   return; }

    const cam = this.camera;

    // Night tint
    if (this.phase === 'night') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // World
    this.map.draw(ctx, cam);

    // Night darkness overlay
    if (this.phase === 'night') {
      ctx.fillStyle = 'rgba(0,0,20,0.38)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // Projectiles
    for (const proj of this.projectiles) {
      if (!proj.alive) continue;
      const s = cam.toScreen(proj.x, proj.y);
      ctx.fillStyle = proj.type === 'arrow' ? '#d4a830' : '#44bb44';
      ctx.fillRect(s.x - proj.w / 2, s.y - proj.h / 2, proj.w, proj.h);
    }

    // Kids
    for (const kid of this.kids) {
      const s = cam.toScreen(kid.x, kid.y);
      if (s.x > -50 && s.x < CANVAS_W + 50 && s.y > -50 && s.y < CANVAS_H + 50) {
        kid.draw(ctx, s.x, s.y);
      }
    }

    // Enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const s = cam.toScreen(e.x, e.y);
      if (s.x > -100 && s.x < CANVAS_W + 100 && s.y > -100 && s.y < CANVAS_H + 100) {
        e.draw(ctx, s.x, s.y);
      }
    }

    // Player attack hitbox (debug visual)
    if (this.player.hitbox) {
      const hb = this.player.hitbox;
      const s  = cam.toScreen(hb.x, hb.y);
      ctx.fillStyle = 'rgba(255,255,100,0.3)';
      ctx.fillRect(s.x, s.y, hb.w, hb.h);
    }

    // Player
    {
      const s = cam.toScreen(this.player.x, this.player.y);
      this.player.draw(ctx, s.x, s.y);
    }

    // HUD
    this.ui.drawHUD(ctx, this);

    // Night survived banner
    if (this.nightSurvivedBanner > 0) {
      ctx.fillStyle = `rgba(170,170,255,${this.nightSurvivedBanner / 2000})`;
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Night survived! +10 HP', CANVAS_W / 2, CANVAS_H / 2 - 20);
    }

    // Crafting overlay
    if (this.state === 'CRAFTING') {
      this.ui.drawCraftingMenu(ctx, this.crafting, this.player);
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────────
  _loop(ts) {
    const dt = Math.min(ts - this._lastTs, 100); // cap at 100ms
    this._lastTs = ts;

    if (this.state === 'PLAYING') this._update(dt);
    // CRAFTING: partial update (crafting timers, no movement)
    if (this.state === 'CRAFTING') this.crafting.update(dt);

    this._draw();
    requestAnimationFrame(ts2 => this._loop(ts2));
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const game = new Game(document.getElementById('game'));
