// ── Network / Auth client ──────────────────────────────────────────────────────
// Handles REST API calls (auth, lobby, save) and WebSocket connection.
// SERVER_URL auto-detects: same origin when served by the Node server,
// or localhost:3000 for direct file:// usage.
const SERVER_URL = (location.protocol === 'file:')
  ? 'http://localhost:3000'
  : (location.origin);

const Net = {
  token:       null,
  username:    null,
  ws:          null,
  latestState: null,  // last tick from server
  connected:   false,
  onDisconnect: null, // callback set by Game

  // ── REST helpers ───────────────────────────────────────────────────────────
  async _post(path, body, auth = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth && this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`${SERVER_URL}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  async _get(path, auth = false) {
    const headers = {};
    if (auth && this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`${SERVER_URL}${path}`, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  async _delete(path, auth = false) {
    const headers = {};
    if (auth && this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`${SERVER_URL}${path}`, { method: 'DELETE', headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  // ── Auth ───────────────────────────────────────────────────────────────────
  async register(username, password) {
    const data = await this._post('/api/register', { username, password });
    this.token    = data.token;
    this.username = data.username;
    this._saveSession();
    return data;
  },

  async login(username, password) {
    const data = await this._post('/api/login', { username, password });
    this.token    = data.token;
    this.username = data.username;
    this._saveSession();
    return data;
  },

  logout() {
    this.token = null; this.username = null;
    localStorage.removeItem('99nights_token');
    localStorage.removeItem('99nights_user');
    if (this.ws) { this.ws.close(); this.ws = null; }
  },

  _saveSession() {
    localStorage.setItem('99nights_token',    this.token);
    localStorage.setItem('99nights_user',     this.username);
  },

  restoreSession() {
    this.token    = localStorage.getItem('99nights_token');
    this.username = localStorage.getItem('99nights_user');
    return !!(this.token && this.username);
  },

  // ── Saves ──────────────────────────────────────────────────────────────────
  async loadSave() {
    try {
      const data = await this._get('/api/save', true);
      return data.save; // null if no save exists
    } catch { return null; }
  },

  async pushSave(saveData) {
    try { await this._post('/api/save', saveData, true); } catch(e) { console.warn('Save failed', e); }
  },

  // ── Lobbies ────────────────────────────────────────────────────────────────
  async fetchLobbies() {
    const data = await this._get('/api/lobbies');
    return data.lobbies;
  },

  async createLobby(name) {
    const data = await this._post('/api/lobbies', { name }, true);
    return data.id;
  },

  async joinLobby(lobbyId) {
    const data = await this._post(`/api/lobbies/${lobbyId}/join`, {}, true);
    return data.lobbyId;
  },

  // ── WebSocket ──────────────────────────────────────────────────────────────
  connect(lobbyId, { onTick, onLobbyPlayers, onVictory, onGameOver, onDisconnect }) {
    const wsUrl = SERVER_URL.replace(/^http/, 'ws');
    this.ws = new WebSocket(`${wsUrl}/game?token=${this.token}&lobby=${lobbyId}`);

    this.ws.onopen = () => {
      this.connected = true;
      console.log('[Net] WS connected');
    };

    this.ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if      (msg.type === 'tick')          { this.latestState = msg; if (onTick)         onTick(msg); }
      else if (msg.type === 'lobby_players') { if (onLobbyPlayers) onLobbyPlayers(msg.players); }
      else if (msg.type === 'victory')       { if (onVictory)      onVictory(msg); }
      else if (msg.type === 'game_over')     { if (onGameOver)     onGameOver(msg); }
    };

    this.ws.onclose = e => {
      this.connected = false;
      console.log('[Net] WS closed', e.code, e.reason);
      if (onDisconnect) onDisconnect(e);
    };

    this.ws.onerror = e => { console.error('[Net] WS error', e); };
  },

  disconnect() {
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.connected  = false;
    this.latestState = null;
  },

  sendInput(keys, action = null) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', keys, action }));
    }
  },
};
