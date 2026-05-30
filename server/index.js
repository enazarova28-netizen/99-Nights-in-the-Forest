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

// Serve the game's static files from the parent directory (works locally and on Railway)
const staticRoot = path.join(__dirname, '..');
app.use(express.static(staticRoot));

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

  // Create or resume game room
  if (!lobby.roomState) {
    lobby.roomState = new GameRoom(lobbyId, lobby.saveData ?? null);

    // Auto-save on each night end
    lobby.roomState.on('save', async (saveData) => {
      for (const entry of lobby.players) {
        const dbUser = getUserByUsername(entry.username);
        if (dbUser) upsertSave(dbUser.id, saveData);
      }
    });

    lobby.roomState.start();
  }

  const room = lobby.roomState;

  // Register player in the room
  const ok = room.addPlayer(user.username, ws);
  if (!ok) { ws.close(4003, 'Room full'); return; }

  // Track this connection for cleanup
  lobby.players.push({ username: user.username, ws });

  console.log(`[room ${lobbyId}] ${user.username} connected (${lobby.players.length}/4)`);

  // ── Incoming messages from client ───────────────────────────────────────
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'input') {
      const sp = room.players.find(p => p.username === user.username);
      if (sp) sp.applyInput(msg.keys || {}, msg.action || null);
    }
  });

  // ── Disconnection ───────────────────────────────────────────────────────
  ws.on('close', () => {
    console.log(`[room ${lobbyId}] ${user.username} disconnected`);

    room.removePlayer(user.username);
    lobby.players = lobby.players.filter(p => p.username !== user.username);

    if (lobby.players.length === 0) {
      // Save and tear down
      const saveData = room.toSaveData();
      room.stop();
      // Persist save for everyone who was in the room
      // (we only have the last set of players saved in saveData.players)
      for (const sp of saveData.players) {
        const dbUser = getUserByUsername(sp.username);
        if (dbUser) upsertSave(dbUser.id, saveData);
      }
      console.log(`[room ${lobbyId}] empty — saved and stopped`);
    }
  });

  ws.on('error', err => {
    console.error(`[room ${lobbyId}] WS error for ${user.username}:`, err.message);
  });
});
