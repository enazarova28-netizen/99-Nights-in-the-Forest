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
    // Multiplayer is always selectable — network.js falls back to
    // localhost:3000 when the game is opened as a plain file.
    this.onlineEnabled = true;

    // ── Online state ──────────────────────────────────────────────────────
    this._loginFields  = { username:'', password:'', confirm:'', focus:'username' };
    this._loginMode    = 'login'; // 'login' | 'register'
    this._loginError   = '';
    this._lobbyList    = [];
    this._lobbyPlayers = [];
    this._currentLobbyId = null;
    this._isHost       = false;
    this._onlineState  = null; // last tick from server
    this._onlineGameOver = false;
    this._onlineVictory  = false;

    // Systems
    this.map      = new TileMap();
    this.camera   = new Camera();
    this.player   = new Player(PLAYER_START.tx, PLAYER_START.ty);
    this.player2  = null; // reserved for local co-op — never assigned yet
    this.crafting = new CraftingSystem(this.player);
    this.ui       = new UI(this);
    this.r3d      = new Renderer3D();
    this._enemyIdCounter = 0;
    this._patchMap();

    // Entities — kids are held inside the 4 corner mines, each guarded
    this.enemies     = [];
    this.projectiles = [];
    this.kids        = this.map.kidSpawns.map((p, i) => new Kid(p.tx, p.ty, i));
    this.kidsRescued = 0;
    this._spawnMineGuards();

    // Wave system
    this.waveActive  = false;
    this.currentWave = 0;
    this.waveMax     = 0; // total waves queued for the current assault

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
    this._setupTouchControls();

    this._lastTs = 0;
    requestAnimationFrame(ts => this._loop(ts));
  }

  _patchMap() {
    const origSet = this.map.set.bind(this.map);
    this.map.set = (tx, ty, tile) => {
      origSet(tx, ty, tile);
      this.r3d.updateTile(ty * MAP_COLS + tx, tile);
    };
  }

  _setupEvents() {
    const MODES = ['SOLO', 'ONLINE'];

    // Browsers only allow audio after a user gesture — unlock on first input
    const unlockAudio = () => { if (typeof Sfx !== 'undefined') Sfx.unlock(); };
    window.addEventListener('keydown', unlockAudio, { once: true });
    window.addEventListener('pointerdown', unlockAudio, { once: true });
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
        if (e.code === 'Tab')   { e.preventDefault(); this.state = 'CRAFTING'; return; }
        if (e.code === 'Space') { this._pendingOnlineAction = 'attack'; return; }
        if (e.code === 'KeyE')  { this._pendingOnlineAction = 'interact'; return; }
        if (e.code === 'Enter') { this._pendingOnlineAction = 'use_door'; return; }
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
      if (e.code === 'Escape' && this.state === 'CRAFTING') { this.state = this.menuMode === 'ONLINE' ? 'ONLINE' : 'PLAYING'; return; }

      if (this.state !== 'PLAYING' && this.state !== 'CRAFTING') return;
      // (ONLINE input is handled in its own branch above — only solo
      // PLAYING/CRAFTING reaches this point.)

      // P1 hotbar slots
      for (let i = 1; i <= 6; i++) {
        if (e.code === `Digit${i}`) this.player.slot = i - 1;
      }

      if (e.code === 'Space' && this.state === 'PLAYING') {
        this._doAttack();
      } else if (e.code === 'KeyE') {
        if      (this.state === 'PLAYING')  this._doInteract();
        else if (this.state === 'CRAFTING') this.state = 'PLAYING';
      } else if (e.code === 'KeyO' && this.state === 'PLAYING') {
        this._doOpenCrafting();
      } else if (e.code === 'KeyP' && this.state === 'PLAYING') {
        this._doPlaceItem();
      } else if (e.code === 'KeyC' && this.state === 'PLAYING') {
        this._doCutTree();
      } else if (e.code === 'KeyR' && this.state === 'PLAYING') {
        this._doRescueKid();
      } else if (e.code === 'KeyH' && this.state === 'PLAYING') {
        this._doOpenChest();
      } else if (e.code === 'Enter' && this.state === 'PLAYING') {
        this._doUseDoor();
      }

    });

    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    // Safety: if the tab loses focus, release everything so no key sticks
    window.addEventListener('blur', () => { this.keys = {}; });

    // (Crafting clicks are handled by the single canvas click listener in the
    // bootstrap section below — registering a second one here caused every
    // craft click to fire twice.)

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

    const lobbyNameInput   = document.getElementById('lobbyNameInput');
    const lobbyConfirmBtn  = document.getElementById('lobbyConfirmBtn');
    const lobbyCancelBtn   = document.getElementById('lobbyCancelBtn');
    if (lobbyConfirmBtn)  lobbyConfirmBtn.addEventListener('click', () => this._submitCreateLobby());
    if (lobbyCancelBtn)   lobbyCancelBtn.addEventListener('click',  () => this._cancelCreateLobby());
    if (lobbyNameInput) {
      lobbyNameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); this._submitCreateLobby(); }
        if (e.key === 'Escape') { e.preventDefault(); this._cancelCreateLobby(); }
      });
    }
  }

  // Mobile/tablet support — pointer events so movement lasts exactly as long
  // as the finger is held down (click events fire after release, which used
  // to leave the player walking forever).
  _setupTouchControls() {
    this._dpadPointers = new Map(); // pointerId → key code
    const canvas = this.canvas;

    const dpadKeyAt = (mx, my) => {
      const s = DPAD.size;
      const dirs = [
        { x: DPAD.x + s,     y: DPAD.y,         key: 'KeyW' },
        { x: DPAD.x + s,     y: DPAD.y + s * 2, key: 'KeyS' },
        { x: DPAD.x,         y: DPAD.y + s,     key: 'KeyA' },
        { x: DPAD.x + s * 2, y: DPAD.y + s,     key: 'KeyD' },
      ];
      for (const d of dirs) {
        if (mx >= d.x && mx <= d.x + s && my >= d.y && my <= d.y + s) return d.key;
      }
      return null;
    };

    canvas.addEventListener('pointerdown', e => {
      if (this.state !== 'PLAYING' && this.state !== 'ONLINE') return;
      const r  = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (CANVAS_W / r.width);
      const my = (e.clientY - r.top)  * (CANVAS_H / r.height);
      const key = dpadKeyAt(mx, my);
      if (key) {
        this._dpadPointers.set(e.pointerId, key);
        this.keys[key] = true;
        try { canvas.setPointerCapture(e.pointerId); } catch {}
      }
    });

    const release = e => {
      const key = this._dpadPointers.get(e.pointerId);
      if (!key) return;
      this._dpadPointers.delete(e.pointerId);
      // Only clear if no other finger still holds the same direction
      if (![...this._dpadPointers.values()].includes(key)) this.keys[key] = false;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
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

  _promptCreateLobby() {
    const modal = document.getElementById('lobbyModal');
    const input = document.getElementById('lobbyNameInput');
    if (!modal) return;
    modal.style.display = 'flex';
    if (input) { input.value = ''; input.focus(); }
  }

  _cancelCreateLobby() {
    const modal = document.getElementById('lobbyModal');
    if (modal) modal.style.display = 'none';
  }

  async _submitCreateLobby() {
    const input    = document.getElementById('lobbyNameInput');
    const errEl    = document.getElementById('lobbyModalError');
    const name     = input ? input.value.trim() : '';
    if (!name) {
      if (errEl) errEl.textContent = 'Please enter a lobby name.';
      return;
    }
    if (errEl) errEl.textContent = 'Creating…';
    try {
      const id = await Net.createLobby(name);
      this._cancelCreateLobby();
      this._isHost = true;
      this._currentLobbyId = id;
      this._lobbyPlayers   = [];
      this.state = 'LOBBY_WAIT';
      this._connectWS(id);
    } catch(e) {
      if (errEl) errEl.textContent = e.message || 'Failed to create lobby.';
    }
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
      onMapInit: tilesB64 => {
        const bin = atob(tilesB64);
        for (let i = 0; i < bin.length; i++) this.map.tiles[i] = bin.charCodeAt(i);
        this.r3d.initTiles(this.map.tiles);
      },
      onLobbyPlayers: (players, hostUsername) => {
        this._lobbyPlayers = players;
        this._isHost = (Net.username === hostUsername);
      },
      onTick: state => {
        this._onlineState = state;
        if (state.tileDiffs && state.tileDiffs.length) {
          for (const { i, tile } of state.tileDiffs) {
            this.map.tiles[i] = tile;
            this.r3d.updateTile(i, tile);
          }
        }
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
    this.r3d.initTiles(this.map.tiles);
    this.announcementText  = 'The kids are trapped in the mines…';
    this.announcementTimer = 3500;
  }

  _resetGame() {
    this.map      = new TileMap();
    this._enemyIdCounter = 0;
    this._patchMap();
    this.player   = new Player(PLAYER_START.tx, PLAYER_START.ty);
    this.player2  = null;
    this.crafting = new CraftingSystem(this.player);
    this.enemies  = [];
    this.projectiles = [];
    this.kids     = this.map.kidSpawns.map((p, i) => new Kid(p.tx, p.ty, i));
    this.kidsRescued = 0;
    this._spawnMineGuards();
    this.waveActive         = false;
    this.currentWave        = 0;
    this.waveMax            = 0;
    this._pendingWaves      = 0;
    this._waveTransitioning = false;
    this.deer = null;
    this.deerDefeated = false;
    this.phase       = 'day';
    this.nightNumber = 0;
    this.phaseTimer  = DAY_DURATION;
    this.state = 'PLAYING';
    this.nightSurvivedBanner = 0;
    this.r3d.initTiles(this.map.tiles);
  }

  // ── Phase transitions ──────────────────────────────────────────────────────
  _startNight() {
    this.phase      = 'night';
    this.phaseTimer = NIGHT_DURATION;
    this.nightNumber++;
    if (typeof Sfx !== 'undefined') Sfx.night();

    // Goat spawns: 2 + floor(night/10)
    const goatCount = 2 + Math.floor(this.nightNumber / 10);
    this._spawnGoats(goatCount);

    // Night 50: The Warden appears
    if (this.nightNumber === 50 && !this.deer) {
      this._spawnDeer();
    } else if (this.deer && this.deer.retreated && this.deer.returnNight > 0 &&
               this.nightNumber >= this.deer.returnNight) {
      // The Warden returns — enraged
      this.deer.retreated   = false;
      this.deer.hasReturned = true;
      this.deer.maxHp = 200;
      this.deer.hp    = 200;
      this.deer.phase = 2;
      this.announcementText  = '⚠ THE WARDEN RETURNS — ENRAGED ⚠';
      this.announcementTimer = 4000;
      this.camera.shake(1200, 10);
    }

    // If waves pending from kid rescue, start next wave
    if (!this.waveActive && this._pendingWaves > 0) {
      this._startWave();
    }
  }

  _startDay() {
    this.phase      = 'day';
    this.phaseTimer = DAY_DURATION;
    if (typeof Sfx !== 'undefined') Sfx.day();

    // Remove remaining night enemies (but not the boss or mine guards)
    this.enemies = this.enemies.filter(e => e instanceof BipedalDeer || e.guard);

    // Night survived bonus
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 10);
    if (this.player2 && this.player2.alive)
      this.player2.hp = Math.min(this.player2.maxHp, this.player2.hp + 10);
    this.nightSurvivedBanner = 2000;
    this.map.onNightEnd(this.player);

    // Farm harvest — +1 herb per farm tile
    let farmCount = 0;
    for (let i = 0; i < this.map.tiles.length; i++) {
      if (this.map.tiles[i] === T.FARM) farmCount++;
    }
    if (farmCount > 0) {
      this.player.addRes('herb', farmCount);
      this.player.addItem('berry', farmCount);
      this.announcementText  = `Farm harvest: +${farmCount} Herb, +${farmCount} Berries`;
      this.announcementTimer = 2000;
    }

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
    if (typeof Sfx !== 'undefined') Sfx.boss();
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
    this.waveMax = this.currentWave + this._pendingWaves;
    this.announcementText  = '⚡ THEY ARE COMING! ⚡';
    this.announcementTimer = 2500;
    if (typeof Sfx !== 'undefined') Sfx.rescue();
    if (!this.waveActive) this._startWave();
  }

  _startWave() {
    if (this._pendingWaves <= 0) { this.waveActive = false; return; }
    this._pendingWaves--;
    this.currentWave++;
    this.waveActive = true;
    // wave 1 → 4 enemies … capped at 13 even when rescues stack extra waves
    const count = 3 + Math.min(this.currentWave, 10);
    this._spawnVillagers(count);
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

    // Selected consumable / equip takes priority (so a bandage still works
    // with a bow equipped). Already-equipped gear falls through to attack.
    if (id) {
      const rec = RECIPES.find(r => r.id === id);
      if (rec) {
        if (rec.type === 'consumable') { p.useItem(id); return; }
        if (rec.type === 'weapon' && p.weapon !== id)        { p.useItem(id); return; }
        if (rec.type === 'tool' && id === 'axe' && !p.hasAxe) { p.useItem(id); return; }
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

  // Harvest whatever sits on (tx, ty). Returns true if something was gathered.
  _gatherTile(p, tx, ty) {
    const tile = this.map.get(tx, ty);
    const feedback = (msg, t = 1400) => {
      this.crafting.feedback = msg;
      this.crafting.feedbackTimer = t;
    };

    if (tile === T.TREE) {
      const count = p.hasAxe ? 2 : 1;
      p.addRes('wood', count);
      this.map.chopTree(tx, ty);
      feedback(`+${count} Wood`);
      if (typeof Sfx !== 'undefined') Sfx.chop();
      return true;
    }
    if (tile === T.ROCK) {
      p.addRes('stone', 1);
      this.map.set(tx, ty, T.GRASS);
      feedback('+1 Stone');
      if (typeof Sfx !== 'undefined') Sfx.stone();
      return true;
    }
    if (tile === T.HERB) {
      const count = randInt(1, 2);
      p.addRes('herb', count);
      this.map.set(tx, ty, T.GRASS);
      feedback(`+${count} Herb`);
      if (typeof Sfx !== 'undefined') Sfx.gather();
      return true;
    }
    if (tile === T.BERRY_BUSH) {
      const count = randInt(2, 3);
      p.addItem('berry', count);
      this.map.set(tx, ty, T.GRASS);
      feedback(`+${count} Berries`);
      if (typeof Sfx !== 'undefined') Sfx.gather();
      return true;
    }
    if (tile === T.CHEST) {
      const h = n => { const v = Math.sin(n) * 43758.5; return v - Math.floor(v); };
      const s = tx * 100 + ty;
      const wood  = 3 + Math.floor(h(s * 13.7) * 6);
      const stone = h(s * 27.3) > 0.4  ? 1 + Math.floor(h(s * 53.1) * 4) : 0;
      const herb  = h(s * 41.7) > 0.6  ? 1 + Math.floor(h(s * 71.9) * 3) : 0;
      const berry = h(s * 33.3) > 0.45 ? 2 + Math.floor(h(s * 91.7) * 2) : 0;
      p.addRes('wood', wood);
      if (stone) p.addRes('stone', stone);
      if (herb)  p.addRes('herb',  herb);
      if (berry) p.addItem('berry', berry);
      this.map.set(tx, ty, T.GRASS);
      let msg = `+${wood} Wood`;
      if (stone) msg += `, +${stone} Stone`;
      if (herb)  msg += `, +${herb} Herb`;
      if (berry) msg += `, +${berry} Berries`;
      feedback(msg, 2000);
      if (typeof Sfx !== 'undefined') Sfx.gather();
      return true;
    }
    return false;
  }

  _doInteract() {
    const p = this.player;

    // Priority 0: revive downed P2
    if (this.player2 && this.player2.downed && this._tryRevive(p, this.player2)) return;

    // Priority 1: rescue kid
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

    // Priority 2: place item
    const selId = p.selectedItem();
    if (selId) {
      const rec = RECIPES.find(r => r.id === selId && r.type === 'placeable');
      if (rec && (p.items[selId] || 0) > 0) {
        if (this.crafting.placeItem(p, this.map)) return;
      }
    }

    // Priority 3: gather — scan facing tile + all 4 cardinal neighbours
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
      if (this._gatherTile(p, c.tx, c.ty)) return;
    }

    // Priority 4: crafting table — open if nearby and nothing else to do
    const ctx = CRAFTING_TABLE_POS.tx * TILE_SIZE + TILE_SIZE / 2;
    const cty = CRAFTING_TABLE_POS.ty * TILE_SIZE + TILE_SIZE / 2;
    const pdx = p.x + p.w / 2;
    const pdy = p.y + p.h / 2;
    if (distance({ x: pdx, y: pdy }, { x: ctx, y: cty }) < TILE_SIZE * 4) {
      this.state = 'CRAFTING';
    }
  }

  _doOpenCrafting() {
    const p = this.player;
    const ctx2 = CRAFTING_TABLE_POS.tx * TILE_SIZE + TILE_SIZE / 2;
    const cty2 = CRAFTING_TABLE_POS.ty * TILE_SIZE + TILE_SIZE / 2;
    if (distance({ x: p.x + p.w / 2, y: p.y + p.h / 2 }, { x: ctx2, y: cty2 }) < TILE_SIZE * 4) {
      this.state = 'CRAFTING';
    } else {
      this.crafting.feedback = 'Too far from crafting table';
      this.crafting.feedbackTimer = 1200;
    }
  }

  _doPlaceItem() {
    const p = this.player;
    const selId = p.selectedItem();
    if (!selId) return;
    const rec = RECIPES.find(r => r.id === selId && r.type === 'placeable');
    if (rec && (p.items[selId] || 0) > 0) {
      this.crafting.placeItem(p, this.map);
    }
  }

  _doCutTree() {
    const p = this.player;
    const pcx = Math.floor((p.x + p.w / 2) / TILE_SIZE);
    const pcy = Math.floor((p.y + p.h / 2) / TILE_SIZE);
    const faceTx = Math.floor((p.x + p.w / 2 + p.facing.x * TILE_SIZE * 0.9) / TILE_SIZE);
    const faceTy = Math.floor((p.y + p.h / 2 + p.facing.y * TILE_SIZE * 0.9) / TILE_SIZE);
    const candidates = [
      { tx: faceTx, ty: faceTy },
      { tx: pcx, ty: pcy - 1 },
      { tx: pcx, ty: pcy + 1 },
      { tx: pcx - 1, ty: pcy },
      { tx: pcx + 1, ty: pcy },
    ];
    for (const c of candidates) {
      if (this.map.get(c.tx, c.ty) === T.TREE && this._gatherTile(p, c.tx, c.ty)) return;
    }
  }

  _doRescueKid() {
    const p = this.player;
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
  }

  _doOpenChest() {
    const p = this.player;
    const pcx = Math.floor((p.x + p.w / 2) / TILE_SIZE);
    const pcy = Math.floor((p.y + p.h / 2) / TILE_SIZE);
    const faceTx = Math.floor((p.x + p.w / 2 + p.facing.x * TILE_SIZE * 0.9) / TILE_SIZE);
    const faceTy = Math.floor((p.y + p.h / 2 + p.facing.y * TILE_SIZE * 0.9) / TILE_SIZE);
    const candidates = [
      { tx: faceTx, ty: faceTy },
      { tx: pcx, ty: pcy - 1 },
      { tx: pcx, ty: pcy + 1 },
      { tx: pcx - 1, ty: pcy },
      { tx: pcx + 1, ty: pcy },
    ];
    for (const c of candidates) {
      if (this.map.get(c.tx, c.ty) === T.CHEST && this._gatherTile(p, c.tx, c.ty)) return;
    }
  }

  _drawPlacementHighlight(ctx, player) {
    const selId = typeof player.selectedItem === 'function'
      ? player.selectedItem()
      : (player.hotbar || [])[player.slot || 0];
    if (!selId) return;
    const rec = RECIPES.find(r => r.id === selId && r.type === 'placeable');
    if (!rec || (player.items[selId] || 0) <= 0) return;

    const cx = player.x + player.w / 2 + player.facing.x * TILE_SIZE;
    const cy = player.y + player.h / 2 + player.facing.y * TILE_SIZE;
    const tx = Math.floor(cx / TILE_SIZE);
    const ty = Math.floor(cy / TILE_SIZE);

    const canPlace = this.map.get(tx, ty) === T.GRASS;

    // Project the tile's 4 ground corners through the 3D camera
    const ts = TILE_SIZE;
    const corners = [
      [tx * ts, ty * ts], [(tx + 1) * ts, ty * ts],
      [(tx + 1) * ts, (ty + 1) * ts], [tx * ts, (ty + 1) * ts],
    ].map(([wx, wy]) => this.r3d.worldToScreen(wx, wy, 0.02));
    if (corners.some(c => !c)) return;

    ctx.save();
    ctx.strokeStyle = canPlace ? 'rgba(80,160,255,0.9)' : 'rgba(255,80,80,0.9)';
    ctx.fillStyle   = canPlace ? 'rgba(80,160,255,0.25)' : 'rgba(255,80,80,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _drawMineLabels(ctx, player) {
    if (!player) return;
    // Screen position comes from projecting the tile centre through the 3D
    // camera — the old top-down 2D math put labels in the wrong place.
    const label = (tx, ty, height, text, color, boxW) => {
      const s = this.r3d.worldToScreen((tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE, height);
      if (!s) return;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(s.x - boxW / 2, s.y - 11, boxW, 14);
      ctx.fillStyle = color;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(text, s.x, s.y);
    };

    const ptx = Math.floor((player.x + (player.w || 24) / 2) / TILE_SIZE);
    const pty = Math.floor((player.y + (player.h || 24) / 2) / TILE_SIZE);
    for (let ty = pty - 5; ty <= pty + 5; ty++) {
      for (let tx = ptx - 5; tx <= ptx + 5; tx++) {
        const tile = this.map.get(tx, ty);
        if (tile === T.MINE_ENTRANCE) {
          label(tx, ty, 1.4, 'DO NOT ENTER', '#ff4444', 74);
        } else if (tile === T.DOOR && Math.abs(tx - ptx) <= 1 && Math.abs(ty - pty) <= 1) {
          label(tx, ty, 1.5, '[Enter] Door', '#ffd700', 66);
        } else if (tile === T.CHEST && Math.abs(tx - ptx) <= 2 && Math.abs(ty - pty) <= 2) {
          label(tx, ty, 0.9, '[E] Open', '#ffd700', 50);
        }
      }
    }
    ctx.textAlign = 'left';
  }

  _doUseDoor() {
    const p = this.player;
    const pcx = Math.floor((p.x + p.w / 2) / TILE_SIZE);
    const pcy = Math.floor((p.y + p.h / 2) / TILE_SIZE);
    const checks = [
      { tx: pcx, ty: pcy - 1 }, { tx: pcx, ty: pcy + 1 },
      { tx: pcx - 1, ty: pcy }, { tx: pcx + 1, ty: pcy },
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

  // ── Update ────────────────────────────────────────────────────────────────
  _update(dt) {
    const p = this.player;

    // Phase timer
    this.phaseTimer -= dt;
    if (this.phaseTimer <= 0) {
      if (this.phase === 'day')   this._startNight();
      else                         this._startDay();
    }

    // Player update (WASD or arrow keys)
    const k = this.keys;
    p.update(dt,
      k['KeyW'] || k['ArrowUp'],
      k['KeyS'] || k['ArrowDown'],
      k['KeyA'] || k['ArrowLeft'],
      k['KeyD'] || k['ArrowRight'],
      this.map);


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

    // Warden retreat/defeat bookkeeping (works for melee, arrows and traps)
    if (this.deer) {
      if (this.deer.retreated && this.deer.returnNight === 0) {
        this.deer.returnNight = this.nightNumber + 3;
        this.announcementText  = 'THE WARDEN RETREATS… FOR NOW';
        this.announcementTimer = 3000;
        this.camera.shake(800, 6);
      }
      if (!this.deer.alive) this.deerDefeated = true;
    }

    // Wave cleared check
    this._checkWaveCleared();

    // Crafting system
    this.crafting.update(dt);

    // Camera
    this.camera.update(p, dt);

    // Night survived banner + announcement (dt-based, not per-frame)
    if (this.nightSurvivedBanner > 0) this.nightSurvivedBanner -= dt;
    if (this.announcementTimer  > 0) this.announcementTimer  -= dt;

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
    if (this.state === 'ONLINE' || (this.state === 'CRAFTING' && this.menuMode === 'ONLINE')) {
      this._drawOnline(ctx);
      return;
    }

    if (this.state === 'MENU') { this.ui.drawMenu(ctx, this.menuMode, this.onlineEnabled); return; }
    if (this.state === 'GAME_OVER') { this.ui.drawGameOver(ctx, this.nightNumber); return; }
    if (this.state === 'VICTORY')   { this.ui.drawVictory(ctx);   return; }

    const cam = this.camera;

    // 3D world rendering — 2D canvas is a transparent HUD overlay
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.r3d.setPhase(this.phase);
    this.r3d.updateCamera(this.player.x, this.player.y, this.player.w, this.player.h);
    this.r3d.updatePlayers([{
      username: Net.username || 'you',
      x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h,
      bodyColor: this.player.bodyColor, downed: this.player.downed
    }]);
    this.r3d.updateEnemies(this.enemies.filter(e => e.alive && !e.retreated).map(e => {
      if (!e._r3dId) e._r3dId = ++this._enemyIdCounter;
      return {
        id: e._r3dId,
        type: e instanceof BipedalDeer ? 'BipedalDeer' : e instanceof Villager ? 'Villager' : 'Goat',
        x: e.x, y: e.y, w: e.w, h: e.h
      };
    }));
    this.r3d.updateKids(this.kids.map(k => ({
      idx: k.kidIdx, x: k.x, y: k.y, w: k.w, h: k.h
    })));
    this.r3d.updateProjectiles(this.projectiles.filter(p => p.alive));
    this.r3d.render();

    // 2D HUD overlay
    this._drawMineLabels(ctx, this.player);
    this._drawPlacementHighlight(ctx, this.player);
    this.ui.drawHUD(ctx, this);
    this.ui.drawMobileControls(ctx);

    if (this.nightSurvivedBanner > 0) {
      ctx.fillStyle = `rgba(170,170,255,${this.nightSurvivedBanner / 2000})`;
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Night survived! +10 HP', CANVAS_W / 2, CANVAS_H / 2 - 20);
    }

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

    // 3D world rendering — 2D canvas is a transparent HUD overlay
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    const me = s.players.find(p => p.username === Net.username) || s.players[0];

    this.r3d.setPhase(s.phase);
    if (me) this.r3d.updateCamera(me.x, me.y, me.w, me.h);
    this.r3d.updatePlayers(s.players);
    this.r3d.updateEnemies(s.enemies);
    this.r3d.updateKids(s.kids);
    this.r3d.updateProjectiles(s.projectiles);
    this.r3d.render();

    // 2D HUD overlay
    this._drawMineLabels(ctx, me);
    if (me) {
      const meWithFacing = Object.assign({}, me, { facing: me.facing || this.player.facing, items: me.items || {} });
      this._drawPlacementHighlight(ctx, meWithFacing);
    }

    // Day/night chime when the server phase flips
    if (this._prevOnlinePhase && this._prevOnlinePhase !== s.phase && typeof Sfx !== 'undefined') {
      if (s.phase === 'night') Sfx.night(); else Sfx.day();
    }
    this._prevOnlinePhase = s.phase;

    // HUD — reuse existing drawHUD but substitute server data
    const fakeGame = {
      player:  me ? { hp:me.hp, maxHp:me.maxHp,
                      hunger:me.hunger ?? 100, maxHunger:me.maxHunger ?? 100,
                      res:me.res||{wood:0,stone:0,herb:0},
                      arrows:me.arrows||0, weapon:me.weapon||'fist',
                      hotbar:me.hotbar||[], slot:me.slot||0, items:me.items||{} } : this.player,
      player2: null,
      phase:   s.phase, nightNumber:s.nightNumber, phaseTimer:s.phaseTimer,
      kidsRescued:s.kidsRescued, waveActive:s.waveActive,
      currentWave:s.currentWave, waveMax:s.waveMax,
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

    // Crafting overlay (uses real server resources)
    if (this.state === 'CRAFTING') {
      const me = s.players.find(p => p.username === Net.username) || s.players[0];
      if (me) {
        const fakePlayer = { res: me.res, arrows: me.arrows };
        this.ui.drawCraftingMenu(ctx, this.crafting, fakePlayer);
      }
      return;
    }

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
      if (this.state === 'ONLINE' || (this.state === 'CRAFTING' && this.menuMode === 'ONLINE')) this._sendOnlineInput();
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
    game.ui.handleCraftingClick(mx, my, game.crafting, game);
    return;
  }

  // ── PLAYING / ONLINE (action buttons + hotbar; D-pad uses pointer events) ─
  if (game.state === 'PLAYING' || game.state === 'ONLINE') {
    const online = game.state === 'ONLINE';

    // Action buttons — positions shared with ui.drawMobileControls
    const { w: btnW, h: btnH, gap } = TOUCH_BTN;
    const attackX = CANVAS_W - btnW - 8;
    const attackY = CANVAS_H - btnH*3 - gap*2 - 8;
    const interactX = CANVAS_W - btnW*2 - gap - 8;
    const interactY = CANVAS_H - btnH*2 - gap - 8;
    const craftX = CANVAS_W - btnW - 8;
    const craftY = CANVAS_H - btnH - 8;

    // Attack button
    if (mx >= attackX && mx <= attackX+btnW && my >= attackY && my <= attackY+btnH) {
      if (online) { game._pendingOnlineAction = 'attack'; game._sendOnlineInput(); }
      else        { game._doAttack(); }
      return;
    }

    // Interact button
    if (mx >= interactX && mx <= interactX+btnW && my >= interactY && my <= interactY+btnH) {
      if (online) { game._pendingOnlineAction = 'interact'; game._sendOnlineInput(); }
      else        { game._doInteract(); }
      return;
    }

    // Crafting button
    if (mx >= craftX && mx <= craftX+btnW && my >= craftY && my <= craftY+btnH) {
      game.state = 'CRAFTING';
      return;
    }

    // Hotbar clicks — geometry shared with ui.drawHotbar
    for (let i = 0; i < HOTBAR.count; i++) {
      const x = HOTBAR.x + i * HOTBAR.slotW;
      if (mx >= x && mx <= x + HOTBAR.slotW - 2 &&
          my >= HOTBAR.y && my <= HOTBAR.y + HOTBAR.slotH - 2) {
        if (online) { game._pendingOnlineAction = `hotbar:${i}`; game._sendOnlineInput(); }
        else        { game.player.slot = i; }
        return;
      }
    }
    return;
  }
});

const game = new Game(document.getElementById('game'));
