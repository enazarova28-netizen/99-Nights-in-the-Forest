'use strict';
// Pure-JS JSON file store — no native compilation needed.
// Works on Windows, Mac, Linux, and Railway out of the box.

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'gamedata.json');

// ── In-memory store ───────────────────────────────────────────────────────────
let _db = { users: [], saves: [] };

function _load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      _db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      _db.users = _db.users || [];
      _db.saves = _db.saves || [];
    }
  } catch(e) {
    console.error('DB load error:', e.message);
  }
}

function _save() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(_db, null, 2), 'utf8');
  } catch(e) {
    console.error('DB save error:', e.message);
  }
}

// Load on startup
_load();

// ── User helpers ──────────────────────────────────────────────────────────────
function createUser(username, passwordHash) {
  const user = {
    id:            crypto.randomUUID(),
    username,
    password_hash: passwordHash,
    created_at:    Date.now(),
  };
  _db.users.push(user);
  _save();
  return user;
}

function getUserByUsername(username) {
  return _db.users.find(u => u.username === username) || null;
}

function getUserById(id) {
  return _db.users.find(u => u.id === id) || null;
}

// ── Save helpers ──────────────────────────────────────────────────────────────
function getSave(userId) {
  const row = _db.saves
    .filter(s => s.user_id === userId)
    .sort((a, b) => b.saved_at - a.saved_at)[0];
  return row ? row.data : null;
}

function upsertSave(userId, data) {
  const existing = _db.saves.find(s => s.user_id === userId);
  if (existing) {
    existing.data     = data;
    existing.saved_at = Date.now();
  } else {
    _db.saves.push({ id: crypto.randomUUID(), user_id: userId, data, saved_at: Date.now() });
  }
  _save();
}

module.exports = { createUser, getUserByUsername, getUserById, getSave, upsertSave };
