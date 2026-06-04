class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');

    // Always open on the main menu; restore any saved session silently
    this.state  = 'MENU';
    Net.restoreSession();

    // Phase
    this.phase       = 'day';
    this.nightNumber = 0;
    this.phaseTimer  = DAY_DURATION;

    // Mode: 'SOLO' | 'ONLINE'
    this.menuMode = 'SOLO';

    // ── Online state ──────────────────────────────────────────────────────
    this._loginFields  = { username:'', password:'', confirm:'', focus:'username' };
    this._loginMode    = 'login'; // 'login' | 'register'
    this._loginError   = '';
    this._lobbyList    = [];
    this._lobbyPlayers = []; // connected players in waiting room
    this._currentLobbyId = null;
    this._isHost       = false;
    this._onlineState  = null; // last tick from server
    this._onlineGameOver = false;
    this._onlineVictory  = false;

    // Systems
    this.map      = new TileMap();
    this.camera   = new Camera();
    this.player   = new Player(PLAYER_START.tx, PLAYER_START.ty);
    this.player2  = null;
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
    this._pendingWaves    = 0;
    this._waveTransitioning = false; // prevents setTimeout from firing every frame

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
    const MODES = ['SOLO', 'ONLINE'];
    window.addEventListener('keydown', e => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
      this.keys[e.code] = true;

      // ── LOGIN / REGISTER ──────────────────────────────────────────────────
      if (this.state === 'LOGIN') {
        this._handleLoginKey(e); return;
      }

      // ── LOBBY LIST ────────────────────────────────────────────────────────
      if (this.state === 'LOBBY_LIST') {
        if (e.code === 'Escape') { this.state = 'MENU'; return; }
        if (e.code === 'KeyR')   { this._refreshLobbies(); return; }
        if (e.code === 'KeyQ')   { Net.logout(); this.state = 'LOGIN'; this._loginFields = {username:'',password:'',confirm:'',focus:'username'}; return; }
        if (e.code === 'KeyC')   { this._promptCreateLobby(); return; }
        // 1-9 join a lobby
        const digit = parseInt(e.key);
        if (!isNaN(digit) && digit >= 1 && digit <= this._lobbyList.length) {
          this._joinLobby(this._lobbyList[digit-1].id); return;
        }
        return;
      }

      // ── LOBBY WAIT ────────────────────────────────────────────────────────
      if (this.state === 'LOBBY_WAIT') {
        if (e.code === 'Escape') { this._leaveLobby(); return; }
        if (e.code === 'Enter' && this._isHost) { this._startOnlineGame(); return; }
        return;
      }

      // ── ONLINE PLAYING ───────────────────────────────────────────────────
      if (this.state === 'ONLINE') {
        if (e.code === 'Escape') { this._leaveLobby(); return; }
        if (e.code === 'Space') { this._pendingOnlineAction = 'attack'; return; }
        if (e.code === 'KeyE')  { this._pendingOnlineAction = 'interact'; return; }
        for (let i = 1; i <= 6; i++) {
          if (e.code === `Digit${i}`) { this._pendingOnlineAction = `hotbar:${i-1}`; return; }
        }
        return;
      }

      // Menu mode selection
      if (this.state === 'MENU') {
        if (e.code === 'KeyQ') {
          if (Net.username) {
            Net.logout();
            this._loginFields = { username:'', password:'', confirm:'', focus:'username' };
            this._loginError  = '';
            this.state = 'LOGIN';
            this._syncLoginInputs();
          } else {
            this.state = 'LOGIN';
            this._syncLoginInputs();
          }
          return;
        }
        if (e.code === 'ArrowLeft'  || e.code === 'KeyA') {
          const i = MODES.indexOf(this.menuMode);
          this.menuMode = MODES[(i + MODES.length - 1) % MODES.length];
        }
        if (e.code === 'ArrowRight' || e.code === 'KeyD') {
          const i = MODES.indexOf(this.menuMode);
          this.menuMode = MODES[(i + 1) % MODES.length];
        }
        if (e.code === 'Digit1') this.menuMode = 'SOLO';
        if (e.code === 'Digit2') this.menuMode = this.onlineEnabled ? 'ONLINE' : 'SOLO';
        if (e.code === 'Enter') {
          if (this.menuMode === 'ONLINE') {
            if (!this.onlineEnabled) { this.menuMode = 'SOLO'; return; }
            this._goToLobbyList(); return;
          }
          this._startGame(); return;
        }
        return;
      }

      if ((this.state === 'GAME_OVER' || this.state === 'VICTORY') && e.code === 'Enter') {
        this._resetGame(); return;
      }
      if (e.code === 'Escape' && this.state === 'CRAFTING') { this.state = 'PLAYING'; return; }

      if (this.state !== 'PLAYING' && this.state !== 'CRAFTING') return;

      // P1 hotbar slots
      for (let i = 1; i <= 6; i++) {
        if (e.code === `Digit${i}`) {
          this.player.slot = i - 1;
          if (this.state === 'ONLINE') this._pendingOnlineAction = `hotbar:${i-1}`;
        }
      }

      if (e.code === 'Space' && this.state === 'PLAYING') {
        this._doAttack();
      } else if (e.code === 'Space' && this.state === 'ONLINE') {
        this._pendingOnlineAction = 'attack';
      } else if (e.code === 'KeyE' && this.state === 'ONLINE') {
        this._pendingOnlineAction = 'interact';
      } else if (e.code === 'KeyE') {
        if      (this.state === 'PLAYING')  this._doInteract();
        else if (this.state === 'CRAFTING') this.state = 'PLAYING';
      }

    });

    window.addEventListener('keyup', e => { this.keys[e.code] = false; });

    this.canvas.addEventListener('click', e => {
      if (this.state !== 'CRAFTING') return;
      const r  = this.canvas.getBoundingClientRect();
      const sx = (e.clientX - r.left) * (CANVAS_W / r.width);
      const sy = (e.clientY - r.top)  * (CANVAS_H / r.height);
      this.ui.handleCraftingClick(sx, sy, this.crafting);
    });

    // Hidden input listeners for tablet keyboard support
    const hiddenUsername = document.getElementById('hiddenUsername');
    const hiddenPassword = document.getElementById('hiddenPassword');
    const hiddenConfirm  = document.getElementById('hiddenConfirm');

    if (hiddenUsername) {
      hiddenUsername.addEventListener('input', e => {
        this._loginFields.username = e.target.value;
        this._loginError = '';
      });
      hiddenUsername.addEventListener('keydown', e => {
        if (e.code === 'Tab') {
          e.preventDefault();
          this._handleLoginKey(e);
        } else if (e.code === 'Enter') {
          e.preventDefault();
          this._submitLogin();
        }
      });
    }
    if (hiddenPassword) {
      hiddenPassword.addEventListener('input', e => {
        this._loginFields.password = e.target.value;
        this._loginError = '';
      });
      hiddenPassword.addEventListener('keydown', e => {
        if (e.code === 'Tab') {
          e.preventDefault();
          this._handleLoginKey(e);
        } else if (e.code === 'Enter') {
          e.preventDefault();
          this._submitLogin();
        }
      });
    }
    if (hiddenConfirm) {
      hiddenConfirm.addEventListener('input', e => {
        this._loginFields.confirm = e.target.value;
        this._loginError = '';
      });
      hiddenConfirm.addEventListener('keydown', e => {
        if (e.code === 'Tab') {
          e.preventDefault();
          this._handleLoginKey(e);
        } else if (e.code === 'Enter') {
          e.preventDefault();
          this._submitLogin();
        }
      });
    }
  }

  // ── Login / Register handling ─────────────────────────────────────────────
  _handleLoginKey(e) {
    const f = this._loginFields;

    // Left/Right: switch between Sign In and Sign Up tabs
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      this._loginMode  = this._loginMode === 'login' ? 'register' : 'login';
      this._loginError = '';
      f.focus = 'username';
      return;
    }

    // Tab: cycle fields
    if (e.code === 'Tab') {
      e.preventDefault();
      const order = this._loginMode === 'register'
        ? ['username','password','confirm']
        : ['username','password'];
      const idx = order.indexOf(f.focus);
      f.focus = order[(idx+1) % order.length];
      return;
    }

    if (e.code === 'Escape') { this.state = 'MENU'; this._loginError = ''; return; }
    if (e.code === 'Enter') { this._submitLogin(); return; }

    if (e.key === 'Backspace') {
      if (f.focus === 'username') f.username = f.username.slice(0,-1);
      else if (f.focus === 'password') f.password = f.password.slice(0,-1);
      else if (f.focus === 'confirm')  f.confirm  = f.confirm.slice(0,-1);
      this._loginError = ''; return;
    }

    // Printable characters
    if (e.key.length === 1) {
      if (f.focus === 'username' && f.username.length < 20) f.username += e.key;
      else if (f.focus === 'password' && f.password.length < 64) f.password += e.key;
      else if (f.focus === 'confirm'  && f.confirm.length  < 64) f.confirm  += e.key;
      this._loginError = '';
    }
  }

  _syncLoginInputs() {
    // When switching tabs, clear and sync hidden inputs to show focused field
    const hiddenUsername = document.getElementById('hiddenUsername');
    const hiddenPassword = document.getElementById('hiddenPassword');
    const hiddenConfirm  = document.getElementById('hiddenConfirm');
    const f = this._loginFields;

    if (hiddenUsername) {
      hiddenUsername.value = '';
      if (f.focus === 'username') hiddenUsername.focus();
    }
    if (hiddenPassword) {
      hiddenPassword.value = '';
      if (f.focus === 'password') hiddenPassword.focus();
    }
    if (hiddenConfirm) {
      hiddenConfirm.value = '';
      if (f.focus === 'confirm') hiddenConfirm.focus();
    }
  }

  async _submitLogin() {
    const f = this._loginFields;
    if (!f.username || !f.password) { this._loginError = 'Fill in all fields'; return; }

    if (this._loginMode === 'register') {
      if (f.password !== f.confirm) { this._loginError = 'Passwords do not match'; return; }
      try {
        await Net.register(f.username, f.password);
        this._loginError = '';
        this.state = 'LOBBY_LIST';
        this._refreshLobbies();
      } catch(err) { this._loginError = err.message; }
    } else {
      try {
        await Net.login(f.username, f.password);
        this._loginError = '';
        this.state = 'LOBBY_LIST';
        this._refreshLobbies();
      } catch(err) { this._loginError = err.message; }
    }
  }

  // ── Lobby management ──────────────────────────────────────────────────────
  async _goToLobbyList() {
    if (!Net.token) {
      // Not signed in yet — go to login, then come back here
      this._loginMode  = 'login';
      this._loginError = '';
      this._loginFields = { username:'', password:'', confirm:'', focus:'username' };
      this.state = 'LOGIN';
      this._syncLoginInputs();
      return;
    }
    this.state = 'LOBBY_LIST';
    await this._refreshLobbies();
  }

  async _refreshLobbies() {
    try { this._lobbyList = await Net.fetchLobbies(); }
    catch(e) { this._loginError = 'Could not reach server'; }
  }

  async _promptCreateLobby() {
    const name = prompt('Lobby name (max 32 chars):');
    if (!name) return;
    try {
      const id = await Net.createLobby(name);
      this._isHost = true;
      this._currentLobbyId = id;
      this._lobbyPlayers   = [];
      this.state = 'LOBBY_WAIT';
      this._connectWS(id);
    } catch(e) { this._loginError = e.message; }
  }

  async _joinLobby(lobbyId) {
    try {
      await Net.joinLobby(lobbyId);
      this._isHost = false;
      this._currentLobbyId = lobbyId;
      this._lobbyPlayers   = [];
      this.state = 'LOBBY_WAIT';
      this._connectWS(lobbyId);
    } catch(e) { this._loginError = e.message; }
  }

  _connectWS(lobbyId) {
    Net.connect(lobbyId, {
      onLobbyPlayers: players => { this._lobbyPlayers = players; },
      onTick: state => {
        this._onlineState = state;
        if (this.state === 'LOBBY_WAIT') this.state = 'ONLINE';
      },
      onVictory:  () => { this._onlineVictory = true; },
      onGameOver: () => { this._onlineGameOver = true; },
      onDisconnect: () => {
        if (this.state === 'ONLINE' || this.state === 'LOBBY_WAIT') {
          this.state = 'MENU';
          this._loginError = 'Disconnected from server';
        }
      },
    });
  }

  _startOnlineGame() {
    Net.sendStartGame();
    // State switches to ONLINE when first tick arrives from the server
  }

  _leaveLobby() {
    Net.disconnect();
    this._currentLobbyId = null;
    this._lobbyPlayers   = [];
    this._onlineState    = null;
    this._onlineGameOver = false;
    this._onlineVictory  = false;
    this.state = 'LOBBY_LIST';
    this._refreshLobbies();
  }

  // ── Online input sending ──────────────────────────────────────────────────
  _sendOnlineInput() {
    const k = this.keys;
    const keys = {
      up:    !!(k['KeyW']  || k['ArrowUp']),
      down:  !!(k['KeyS']  || k['ArrowDown']),
      left:  !!(k['KeyA']  || k['ArrowLeft']),
      right: !!(k['KeyD']  || k['ArrowRight']),
    };
    // Pending action (one-shot)
    const action = this._pendingOnlineAction || null;
    this._pendingOnlineAction = null;
    Net.sendInput(keys, action);
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
    this.player2  = null;
    this.crafting = new CraftingSystem(this.player);
    this.enemies  = [];
    this.projectiles = [];
    this.kids     = KID_POSITIONS.map((p, i) => new Kid(p.tx, p.ty, i));
    this.kidsRescued = 0;
    this.waveActive         = false;
    this.currentWave        = 0;
    this._pendingWaves      = 0;
    this._waveTransitioning = false;
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
    if (this.player2 && this.player2.alive)
      this.player2.hp = Math.min(this.player2.maxHp, this.player2.hp + 10);
    this.nightSurvivedBanner = 2000;
    this.map.onNightEnd(this.player);

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
    if (!this.waveActive || this._waveTransitioning) return;
    const villagers = this.enemies.filter(e => e instanceof Villager && e.alive);
    if (villagers.length === 0) {
      if (this._pendingWaves > 0) {
        this._waveTransitioning = true;
        setTimeout(() => {
          this._waveTransitioning = false;
          this._startWave();
        }, 2500);
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

    // Check hits on enemies (mark so _update doesn't double-hit)
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (rectOverlap(hb, e)) {
        e.takeDamage(hb.dmg);
        e._hitThisSwing = true;
        if (!e.alive && e instanceof BipedalDeer) this.deerDefeated = true;
      }
    }
  }

  _tryRevive(reviver, downed) {
    if (!downed || !downed.downed) return false;
    if (distance({ x: reviver.x, y: reviver.y }, { x: downed.x, y: downed.y }) > TILE_SIZE * 2) return false;
    if (!reviver.removeItem('bandage')) return false;
    downed.revive(25);
    this.announcementText  = 'Partner revived!';
    this.announcementTimer = 1500;
    return true;
  }

  _doInteract() {
    const p = this.player;

    // Priority 0: revive downed P2
    if (this.player2 && this.player2.downed && this._tryRevive(p, this.player2)) return;

    // Priority 1: crafting table — generous 4-tile range
    const ctx = CRAFTING_TABLE_POS.tx * TILE_SIZE + TILE_SIZE / 2;
    const cty = CRAFTING_TABLE_POS.ty * TILE_SIZE + TILE_SIZE / 2;
    const pdx = p.x + p.w / 2;
    const pdy = p.y + p.h / 2;
    if (distance({ x: pdx, y: pdy }, { x: ctx, y: cty }) < TILE_SIZE * 4) {
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
    const k = this.keys;
    p.update(dt, k['KeyW'], k['KeyS'], k['KeyA'], k['KeyD'], this.map);


    // Proximity to crafting table (keep in sync with _doInteract range)
    const ctx2 = CRAFTING_TABLE_POS.tx * TILE_SIZE + TILE_SIZE / 2;
    const cty2 = CRAFTING_TABLE_POS.ty * TILE_SIZE + TILE_SIZE / 2;
    this.nearCraftingTable = distance(
      { x: p.x + p.w / 2, y: p.y + p.h / 2 },
      { x: ctx2, y: cty2 }
    ) < TILE_SIZE * 4;

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

    // P2 contact damage from enemies
    if (this.player2 && !this.player2.downed) {
      const p2 = this.player2;
      for (const e of this.enemies) {
        if (!e.alive || e.dmgCooldown > 0 || p2.dmgCooldown > 0) continue;
        if (rectOverlap(e, p2)) {
          p2.takeDamage(e.damage);
          p2.dmgCooldown = 700;
        }
      }
    }

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
          p.takeDamage(proj.dmg); p.dmgCooldown = 500; proj.alive = false;
        } else if (this.player2 && this.player2.alive &&
                   this.player2.dmgCooldown <= 0 && rectOverlap(pbox, this.player2)) {
          this.player2.takeDamage(proj.dmg); this.player2.dmgCooldown = 500; proj.alive = false;
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

    // Game over
    if (p.downed) this.state = 'GAME_OVER';
  }

  // ── Draw ──────────────────────────────────────────────────────────────────
  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // ── Online-only screens ──────────────────────────────────────────────
    if (this.state === 'LOGIN') {
      this.ui.drawLoginScreen(ctx, this._loginFields, this._loginMode, this._loginError);
      return;
    }
    if (this.state === 'LOBBY_LIST') {
      this.ui.drawLobbyListScreen(ctx, this._lobbyList, this._loginError);
      return;
    }
    if (this.state === 'LOBBY_WAIT') {
      this.ui.drawLobbyWaitScreen(ctx, this._lobbyPlayers, this._isHost);
      return;
    }
    if (this.state === 'ONLINE') {
      this._drawOnline(ctx);
      return;
    }

    if (this.state === 'MENU') { this.ui.drawMenu(ctx, this.menuMode, this.onlineEnabled); return; }
    if (this.state === 'GAME_OVER') { this.ui.drawGameOver(ctx, this.nightNumber); return; }
    if (this.state === 'VICTORY')   { this.ui.drawVictory(ctx);   return; }

    const cam = this.camera;

    // Base fill so canvas is never transparent
    ctx.fillStyle = '#1a3a16';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

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

    // Mobile controls (tablet support)
    this.ui.drawMobileControls(ctx);

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

  // ── Online renderer ───────────────────────────────────────────────────────
  _drawOnline(ctx) {
    const s = this._onlineState;

    // Victory / game over overlays
    if (this._onlineVictory)  { this.ui.drawVictory(ctx); return; }
    if (this._onlineGameOver) { this.ui.drawGameOver(ctx, s?.nightNumber ?? 0); return; }

    if (!s) {
      // Waiting for first tick
      ctx.fillStyle = '#0a1a0a'; ctx.fillRect(0,0,CANVAS_W,CANVAS_H);
      ctx.fillStyle='#fff'; ctx.font='14px monospace'; ctx.textAlign='center';
      ctx.fillText('Connecting…', CANVAS_W/2, CANVAS_H/2);
      return;
    }

    // Base fill so canvas is never transparent
    ctx.fillStyle = '#1a3a16';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Night tint
    if (s.phase === 'night') { ctx.fillStyle='#000'; ctx.fillRect(0,0,CANVAS_W,CANVAS_H); }

    // Find own player in tick to center camera on them
    const me = s.players.find(p => p.username === Net.username) || s.players[0];
    const camX = me ? clamp(me.x + me.w/2 - CANVAS_W/2, 0, MAP_COLS*TILE_SIZE - CANVAS_W) : 0;
    const camY = me ? clamp(me.y + me.h/2 - CANVAS_H/2, 0, MAP_ROWS*TILE_SIZE - CANVAS_H) : 0;

    // World (reuse local map for display; server manages authoritative state)
    this.map.draw(ctx, { x: camX, y: camY, sx: 0, sy: 0 });

    if (s.phase === 'night') { ctx.fillStyle='rgba(0,0,20,0.38)'; ctx.fillRect(0,0,CANVAS_W,CANVAS_H); }

    // Projectiles
    for (const proj of s.projectiles) {
      const sx = proj.x - camX, sy = proj.y - camY;
      ctx.fillStyle = proj.type==='arrow' ? '#d4a830' : '#44bb44';
      ctx.fillRect(sx-proj.w/2, sy-proj.h/2, proj.w||10, proj.h||6);
    }

    // Kids
    for (const k of s.kids) {
      const sx=k.x-camX, sy=k.y-camY;
      if (!k.rescued) {
        ctx.fillStyle='#ff0'; ctx.font='bold 14px monospace'; ctx.textAlign='center';
        ctx.fillText('!', sx+k.w/2, sy-4);
      }
      ctx.fillStyle = KID_COLORS[k.idx];
      ctx.fillRect(sx, sy+8, k.w, k.h-8);
      ctx.fillStyle='#ffcc99'; ctx.beginPath(); ctx.arc(sx+k.w/2,sy+6,7,0,Math.PI*2); ctx.fill();
    }

    // Enemies (simple colored rects by type)
    const ENEMY_COLORS = { Goat:'#cccccc', Villager:'#884422', BipedalDeer:'#886644' };
    for (const e of s.enemies) {
      const sx=e.x-camX, sy=e.y-camY;
      if (sx<-100||sx>CANVAS_W+100||sy<-100||sy>CANVAS_H+100) continue;
      ctx.fillStyle = ENEMY_COLORS[e.type] || '#ff0000';
      ctx.fillRect(sx, sy, e.w||28, e.h||28);
      // HP bar
      ctx.fillStyle='#500'; ctx.fillRect(sx,sy-7,e.w,4);
      ctx.fillStyle='#0c0'; ctx.fillRect(sx,sy-7,(e.w||28)*(e.hp/e.maxHp),4);
    }

    // All players
    const PLAYER_COLORS_CLIENT = ['#4488ff','#ff8844','#44cc44','#cc44cc'];
    for (const p of s.players) {
      const sx=p.x-camX, sy=p.y-camY;
      if (p.downed) {
        ctx.globalAlpha=0.65;
        ctx.fillStyle=p.bodyColor||PLAYER_COLORS_CLIENT[p.playerIdx]||'#fff';
        ctx.fillRect(sx-4, sy+p.h/2-2, p.h, 10);
        ctx.fillStyle='#ffcc99'; ctx.beginPath(); ctx.arc(sx+p.h+2,sy+p.h/2+3,7,0,Math.PI*2); ctx.fill();
        ctx.fillStyle=Math.floor(Date.now()/400)%2===0?'#f00':'#f88';
        ctx.font='bold 14px monospace'; ctx.textAlign='center';
        ctx.fillText('+', sx+p.w/2, sy-4);
        ctx.globalAlpha=1;
      } else {
        ctx.fillStyle=p.bodyColor||PLAYER_COLORS_CLIENT[p.playerIdx]||'#fff';
        ctx.fillRect(sx, sy+6, p.w, p.h-6);
        ctx.fillStyle='#ffcc99'; ctx.fillRect(sx+6,sy,12,10);
      }
      // Name tag
      ctx.fillStyle='#fff'; ctx.font='9px monospace'; ctx.textAlign='center';
      ctx.fillText(p.username, sx+p.w/2, sy-8);
      // HP bar
      if (!p.downed) {
        ctx.fillStyle='#300'; ctx.fillRect(sx,sy-5,p.w,3);
        ctx.fillStyle='#f00'; ctx.fillRect(sx,sy-5,p.w*(p.hp/p.maxHp),3);
      }
    }

    // HUD — reuse existing drawHUD but substitute server data
    const fakeGame = {
      player:  me ? { hp:me.hp, maxHp:me.maxHp, res:me.res||{wood:0,stone:0,herb:0},
                      arrows:me.arrows||0, weapon:me.weapon||'fist',
                      hotbar:me.hotbar||[], slot:me.slot||0, items:me.items||{} } : this.player,
      player2: null,
      phase:   s.phase, nightNumber:s.nightNumber, phaseTimer:s.phaseTimer,
      kidsRescued:s.kidsRescued, waveActive:s.waveActive, currentWave:s.currentWave,
      nearCraftingTable:false,
      announcementText: s.announcement||'', announcementTimer: s.announcement ? 1 : 0,
      crafting: { feedbackTimer:0 },
      menuMode: 'ONLINE',
    };
    this.ui.drawHUD(ctx, fakeGame);

    // Mobile controls (tablet support)
    this.ui.drawMobileControls(ctx);

    // Server announcement
    if (s.announcement) this.ui.drawOnlineAnnouncement(ctx, s.announcement);

    // Esc hint
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(0,CANVAS_H-22,CANVAS_W,22);
    ctx.fillStyle='#888'; ctx.font='10px monospace'; ctx.textAlign='center';
    ctx.fillText('[Esc] Leave game   [Space] Attack   [E] Interact   [1-6] Hotbar', CANVAS_W/2, CANVAS_H-8);
  }

  // ── Loop ──────────────────────────────────────────────────────────────────
  _loop(ts) {
    const dt = Math.min(ts - this._lastTs, 100); // cap at 100ms
    this._lastTs = ts;

    try {
      if (this.state === 'PLAYING')  this._update(dt);
      if (this.state === 'CRAFTING') this.crafting.update(dt);
      if (this.state === 'ONLINE')   this._sendOnlineInput();
      this._draw();
    } catch(err) {
      console.error('[Game loop error]', err);
    }
    requestAnimationFrame(ts2 => this._loop(ts2));
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

// Canvas clicks — handle all interactive UI
document.getElementById('game').addEventListener('click', e => {
  if (!game) return;
  const r  = game.canvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (CANVAS_W / r.width);
  const my = (e.clientY - r.top)  * (CANVAS_H / r.height);

  // ── LOGIN ──────────────────────────────────────────────────────────────
  if (game.state === 'LOGIN') {
    const px = CANVAS_W/2-190, py = 96, pw = 380;
    const ph = game._loginMode === 'register' ? 300 : 260;
    const tabW = pw / 2;
    const bodyY = py + 40;

    // Tab buttons
    if (my >= py && my <= py+40) {
      if (mx >= px && mx <= px+tabW) {
        game._loginMode = 'login'; game._loginError = ''; game._loginFields.focus = 'username';
        game._syncLoginInputs();
      } else if (mx >= px+tabW && mx <= px+pw) {
        game._loginMode = 'register'; game._loginError = ''; game._loginFields.focus = 'username';
        game._syncLoginInputs();
      }
      return;
    }

    // Submit button (for tablets)
    const btnY = bodyY + ph - 40 - 30;
    if (mx >= px+60 && mx <= px+pw-60 && my >= btnY && my <= btnY+24) {
      game._submitLogin();
      return;
    }

    // Field clicks — focus hidden input to trigger tablet keyboard
    if (mx>=px+20&&mx<=px+pw-20&&my>=bodyY+22&&my<=bodyY+50) {
      game._loginFields.focus='username';
      document.getElementById('hiddenUsername').focus();
    }
    else if (mx>=px+20&&mx<=px+pw-20&&my>=bodyY+90&&my<=bodyY+118) {
      game._loginFields.focus='password';
      document.getElementById('hiddenPassword').focus();
    }
    else if (mx>=px+20&&mx<=px+pw-20&&my>=bodyY+158&&my<=bodyY+186) {
      game._loginFields.focus='confirm';
      document.getElementById('hiddenConfirm').focus();
    }
    return;
  }

  // ── MENU ───────────────────────────────────────────────────────────────
  if (game.state === 'MENU') {
    // Account panel (top-right)
    const apx = CANVAS_W - 178, apy = 8, apw = 170;
    if (mx >= apx && mx <= apx + apw && my >= apy && my <= apy + 68) {
      if (Net.username) {
        Net.logout();
        game.state = 'MENU';
      } else {
        game.state = 'LOGIN';
      }
      return;
    }

    const modes = [
      { id: 'SOLO', label: 'SINGLE PLAYER' },
      { id: 'ONLINE', label: 'MULTIPLAYER' },
    ];
    const bw = 220, bh = 80, gap = 24;
    const totalW = modes.length * bw + gap;
    const startX = (CANVAS_W - totalW) / 2;
    const by = 260;

    modes.forEach((m, i) => {
      const bx = startX + i * (bw + gap);
      if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
        game.menuMode = m.id;
        if (m.id === 'SOLO') {
          game.state = 'PLAYING';
          game._startGame();
        } else {
          if (!Net.token) game.state = 'LOGIN';
          else game._goToLobbyList();
        }
      }
    });
    return;
  }

  // ── LOBBY_LIST ────────────────────────────────────────────────────────
  if (game.state === 'LOBBY_LIST') {
    // Create button
    const cbx = CANVAS_W/2 - 80, cby = 84;
    if (mx >= cbx && mx <= cbx + 160 && my >= cby && my <= cby + 28) {
      game._promptCreateLobby();
      return;
    }

    // Lobby items
    const startY = 128;
    game._lobbyList.forEach((l, i) => {
      if (l.playerCount < 4) {
        const ry = startY + i * 52;
        if (mx >= CANVAS_W/2-240 && mx <= CANVAS_W/2+240 && my >= ry && my <= ry + 44) {
          game._joinLobby(l.id);
        }
      }
    });
    return;
  }

  // ── LOBBY_WAIT ────────────────────────────────────────────────────────
  if (game.state === 'LOBBY_WAIT') {
    if (game._isHost) {
      // Start button (approximate hitbox)
      if (mx >= CANVAS_W/2 - 150 && mx <= CANVAS_W/2 + 150 && my >= 295 && my <= 325) {
        game._startOnlineGame();
      }
    }
    return;
  }

  // ── CRAFTING ───────────────────────────────────────────────────────────
  if (game.state === 'CRAFTING') {
    game.ui.handleCraftingClick(mx, my, game.crafting);
    return;
  }

  // ── PLAYING (hotbar + mobile controls) ─────────────────────────────────
  if (game.state === 'PLAYING') {
    // Mobile D-pad (bottom-left)
    const padSize = 20;
    const padX = 16, padY = CANVAS_H - 80;
    const dirs = [
      { label: '↑', x: padX+padSize, y: padY, key: 'ArrowUp' },
      { label: '↓', x: padX+padSize, y: padY+padSize*2, key: 'ArrowDown' },
      { label: '←', x: padX, y: padY+padSize, key: 'ArrowLeft' },
      { label: '→', x: padX+padSize*2, y: padY+padSize, key: 'ArrowRight' },
    ];
    for (const d of dirs) {
      if (mx >= d.x && mx <= d.x+padSize && my >= d.y && my <= d.y+padSize) {
        game.keys[d.key] = true;
      }
    }

    // Action buttons
    const btnW = 44, btnH = 32, gap = 8;
    const attackX = CANVAS_W - btnW - 8;
    const attackY = CANVAS_H - btnH*2 - gap - 8;
    const interactX = CANVAS_W - btnW*2 - gap - 8;
    const interactY = CANVAS_H - btnH - 8;
    const craftX = CANVAS_W - btnW - 8;
    const craftY = CANVAS_H - btnH - 8;

    // Attack button
    if (mx >= attackX && mx <= attackX+btnW && my >= attackY && my <= attackY+btnH) {
      game._doAttack();
      return;
    }

    // Interact button
    if (mx >= interactX && mx <= interactX+btnW && my >= interactY && my <= interactY+btnH) {
      game._doInteract();
      return;
    }

    // Crafting button
    if (mx >= craftX && mx <= craftX+btnW && my >= craftY && my <= craftY+btnH) {
      game.state = 'CRAFTING';
      return;
    }

    // Hotbar clicks
    const hotbarY = CANVAS_H - 30;
    const hotbarX = CANVAS_W/2 - 90;
    for (let i = 0; i < 6; i++) {
      const x = hotbarX + i * 30;
      if (mx >= x && mx <= x + 28 && my >= hotbarY - 8 && my <= hotbarY + 18) {
        game._pendingAction = `hotbar:${i}`;
        game._doInteract();
      }
    }
    return;
  }

  // ── ONLINE (similar controls) ──────────────────────────────────────────
  if (game.state === 'ONLINE') {
    // Mobile D-pad (bottom-left)
    const padSize = 20;
    const padX = 16, padY = CANVAS_H - 80;
    const dirs = [
      { label: '↑', x: padX+padSize, y: padY, keys: { ArrowUp: true } },
      { label: '↓', x: padX+padSize, y: padY+padSize*2, keys: { ArrowDown: true } },
      { label: '←', x: padX, y: padY+padSize, keys: { ArrowLeft: true } },
      { label: '→', x: padX+padSize*2, y: padY+padSize, keys: { ArrowRight: true } },
    ];
    for (const d of dirs) {
      if (mx >= d.x && mx <= d.x+padSize && my >= d.y && my <= d.y+padSize) {
        game.keys = { ...game.keys, ...d.keys };
      }
    }

    // Action buttons
    const btnW = 44, btnH = 32, gap = 8;
    const attackX = CANVAS_W - btnW - 8;
    const attackY = CANVAS_H - btnH*2 - gap - 8;
    const interactX = CANVAS_W - btnW*2 - gap - 8;
    const interactY = CANVAS_H - btnH - 8;
    const craftX = CANVAS_W - btnW - 8;
    const craftY = CANVAS_H - btnH - 8;

    // Attack button
    if (mx >= attackX && mx <= attackX+btnW && my >= attackY && my <= attackY+btnH) {
      game._pendingOnlineAction = 'attack';
      game._sendOnlineInput();
      return;
    }

    // Interact button
    if (mx >= interactX && mx <= interactX+btnW && my >= interactY && my <= interactY+btnH) {
      game._pendingOnlineAction = 'interact';
      game._sendOnlineInput();
      return;
    }

    // Crafting button
    if (mx >= craftX && mx <= craftX+btnW && my >= craftY && my <= craftY+btnH) {
      game.state = 'CRAFTING';
      return;
    }

    // Hotbar clicks
    const hotbarY = CANVAS_H - 30;
    const hotbarX = CANVAS_W/2 - 90;
    for (let i = 0; i < 6; i++) {
      const x = hotbarX + i * 30;
      if (mx >= x && mx <= x + 28 && my >= hotbarY - 8 && my <= hotbarY + 18) {
        game._pendingOnlineAction = `hotbar:${i}`;
        game._sendOnlineInput();
      }
    }
    return;
  }
});

const game = new Game(document.getElementById('game'));
