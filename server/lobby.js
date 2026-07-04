const express = require('express');
const { authMiddleware } = require('./auth');
const { GameRoom } = require('./gameRoom');
const { getUserByUsername, getSave } = require('./db');

const router  = express.Router();
const lobbies = new Map(); // id → LobbyObj

let _lobbyCounter = 1;

function createLobby(name, hostUsername) {
  const id = String(_lobbyCounter++);

  // Restore the host's last save (if any) so the room continues their run.
  // Finished runs start fresh.
  let saveData = null;
  const host = getUserByUsername(hostUsername);
  if (host) saveData = getSave(host.id) || null;
  if (saveData && (saveData.nightNumber ?? 0) >= 99) saveData = null;

  lobbies.set(id, {
    id,
    name,
    hostUsername,
    players:   [],   // { username, ws, playerIdx }
    roomState: null, // GameRoom | null
    saveData,        // save to load when the room is created
  });
  return id;
}

// GET /api/lobbies — list open lobbies
router.get('/lobbies', (req, res) => {
  const list = [];
  for (const [id, lobby] of lobbies) {
    list.push({
      id,
      name:        lobby.name,
      host:        lobby.hostUsername,
      playerCount: lobby.players.length,
      maxPlayers:  4,
      started:     !!lobby.roomState,
    });
  }
  res.json({ lobbies: list });
});

// POST /api/lobbies — create a lobby
router.post('/lobbies', authMiddleware, (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length < 1)
    return res.status(400).json({ error: 'Lobby name required' });

  const id = createLobby(name.trim().slice(0,32), req.user.username);
  res.json({ id });
});

// POST /api/lobbies/:id/join — mark intent to join (WS connection does the actual join)
router.post('/lobbies/:id/join', authMiddleware, (req, res) => {
  const lobby = lobbies.get(req.params.id);
  if (!lobby)              return res.status(404).json({ error: 'Lobby not found' });
  if (lobby.players.length >= 4) return res.status(409).json({ error: 'Lobby full' });
  res.json({ lobbyId: lobby.id });
});

// DELETE /api/lobbies/:id — close lobby (host only)
router.delete('/lobbies/:id', authMiddleware, (req, res) => {
  const lobby = lobbies.get(req.params.id);
  if (!lobby) return res.status(404).json({ error: 'Not found' });
  if (lobby.hostUsername !== req.user.username)
    return res.status(403).json({ error: 'Not the host' });
  if (lobby.roomState) lobby.roomState.stop();
  lobbies.delete(req.params.id);
  res.json({ ok: true });
});

module.exports = { router, lobbies, createLobby };
