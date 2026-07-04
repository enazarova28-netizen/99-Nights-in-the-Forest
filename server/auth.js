const express  = require('express');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const { createUser, getUserByUsername, getUserById, getSave, upsertSave } = require('./db');

const router = express.Router();
// In production a real secret is required — refusing to start beats silently
// signing every token with a publicly known string.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'forest-dev-secret';
const SALT_ROUNDS = 10;

// ── Middleware ────────────────────────────────────────────────────────────────
function verifyJWT(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '');
  const user   = verifyJWT(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

// ── Register ─────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (username.length < 2 || username.length > 20)
    return res.status(400).json({ error: 'Username must be 2–20 characters' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Password must be at least 4 characters' });

  if (getUserByUsername(username))
    return res.status(409).json({ error: 'Username already taken' });

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = createUser(username, hash);
  const token  = jwt.sign({ id: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  const user = getUserByUsername(username);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username });
});

// ── Save: load ────────────────────────────────────────────────────────────────
router.get('/save', authMiddleware, (req, res) => {
  const save = getSave(req.user.id);
  res.json({ save });
});

// ── Save: write ───────────────────────────────────────────────────────────────
router.post('/save', authMiddleware, (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid save data' });
  upsertSave(req.user.id, data);
  res.json({ ok: true });
});

module.exports = { router, verifyJWT, authMiddleware };
