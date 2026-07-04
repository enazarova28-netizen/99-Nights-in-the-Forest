'use strict';

const express           = require('express');
const { WebSocketServer } = require('ws');
const path              = require('path');
const { router: authRouter, verifyJWT } = require('./auth');
const { router: lobbyRouter, lobbies }  = require('./lobby');
const { GameRoom }      = require('./gameRoom');
const { upsertSave, getUserByUsername } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// Serve ONLY the client files. Serving the whole project root would expose
// server source and server/gamedata.json (user credentials) to anyone.
const clientRoot = path.join(__dirname, '..');
app.use('/src', express.static(path.join(clientRoot, 'src')));
app.get('/',           (req, res) => res.sendFile(path.join(clientRoot, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(clientRoot, 'index.html')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(clientRoot, 'styles.css')));

// ── REST routes ───────────────────────────────────────────────────────────────
app.use('/api', authRouter);
app.use('/api', lobbyRouter);

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`99 Nights server running at http://localhost:${PORT}`);
});

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/game' });

wss.on('connection', (ws, req) => {
  // Parse query params: ?token=JWT&lobby=ID
  const params   = new URLSearchParams((req.url.split('?')[1]) || '');
  const token    = params.get('token');
  const lobbyId  = params.get('lobby');

  // Auth
  const user = verifyJWT(token);
  if (!user) { ws.close(4001, 'Unauthorized'); return; }

  // Find lobby
  const lobby = lobbies.get(lobbyId);
  if (!lobby)            { ws.close(4004, 'Lobby not found'); return; }
  if (lobby.players.length >= 4) { ws.close(4003, 'Lobby full');       return; }

  // Create room on first connection (but don't start ticking yet)
  if (!lobby.roomState) {
    lobby.roomState = new GameRoom(lobbyId, lobby.hostUsername, lobby.saveData ?? null);

    // Auto-save on each night end
    lobby.roomState.on('save', async (saveData) => {
      for (const entry of lobby.players) {
        const dbUser = getUserByUsername(entry.username);
        if (dbUser) upsertSave(dbUser.id, saveData);
      }
    });
    // Room starts only when host sends 'start_game'
  }

  const room = lobby.roomState;

  // Evict stale connection for same username (page-refresh / reconnect).
  // Keep the existing ServerPlayer so a refresh doesn't wipe inventory/position.
  const stale = lobby.players.find(p => p.username === user.username);
  let ok;
  if (stale) {
    try { stale.ws.close(4000, 'Replaced by new connection'); } catch {}
    lobby.players = lobby.players.filter(p => p.username !== user.username);
    console.log(`[room ${lobbyId}] evicted stale connection for ${user.username}`);
    ok = room.reconnectPlayer(user.username, ws) || room.addPlayer(user.username, ws);
  } else {
    ok = room.addPlayer(user.username, ws);
  }
  if (!ok) { ws.close(4003, 'Room full'); return; }

  // Track this connection for cleanup
  lobby.players.push({ username: user.username, ws });

  console.log(`[room ${lobbyId}] ${user.username} connected (${lobby.players.length}/4)`);

  // ── Incoming messages from client ───────────────────────────────────────
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Host starts the game
    if (msg.type === 'start_game') {
      if (user.username === lobby.hostUsername && !room._tickInterval) {
        console.log(`[room ${lobbyId}] host ${user.username} started the game`);
        room.start();
      }
      return;
    }

    if (msg.type === 'input') {
      const sp = room.players.find(p => p.username === user.username);
      if (sp) sp.applyInput(msg.keys || {}, msg.action || null);
    }
  });

  // ── Disconnection ───────────────────────────────────────────────────────
  ws.on('close', () => {
    // Ignore close events from sockets that were already replaced by a
    // newer connection (page refresh) — cleaning up here would remove the
    // reconnected player.
    const entry = lobby.players.find(p => p.username === user.username);
    if (!entry || entry.ws !== ws) return;

    console.log(`[room ${lobbyId}] ${user.username} disconnected`);

    // Save for the leaving player BEFORE removing them — the snapshot must
    // still contain their inventory. Only save once the game has started,
    // otherwise a lobby-screen exit would overwrite real progress.
    if (room._tickInterval) {
      const saveData = room.toSaveData();
      const dbUser = getUserByUsername(user.username);
      if (dbUser) upsertSave(dbUser.id, saveData);
    }

    room.removePlayer(user.username);
    lobby.players = lobby.players.filter(p => p.username !== user.username);

    if (lobby.players.length === 0) {
      room.stop();
      lobbies.delete(lobbyId);
      console.log(`[room ${lobbyId}] empty — saved, stopped, and removed`);
    }
  });

  ws.on('error', err => {
    console.error(`[room ${lobbyId}] WS error for ${user.username}:`, err.message);
  });
});
