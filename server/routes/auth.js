// server/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { load, save, withLock } = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts', message: 'Too many attempts. Try again later.' }
});

function isValidPin(pin) {
  return typeof pin === 'string' && /^[0-9]{4,8}$/.test(pin);
}

// GET /api/auth/status - tells the frontend which screen to show
router.get('/status', (req, res) => {
  const db = load();
  res.json({
    initialized: !!db.initialized,
    authenticated: !!(req.session && req.session.authenticated),
    displayName: (db.settings && db.settings.displayName) || 'My Budget'
  });
});

// POST /api/auth/setup - first run only, creates the PIN
router.post('/setup', async (req, res) => {
  const db = load();
  if (db.initialized) {
    return res.status(409).json({ error: 'already_initialized' });
  }
  const { pin } = req.body || {};
  if (!isValidPin(pin)) {
    return res.status(400).json({ error: 'invalid_pin', message: 'PIN must be 4-8 digits.' });
  }
  const pinHash = await bcrypt.hash(pin, 10);
  await withLock((data) => {
    data.initialized = true;
    data.pinHash = pinHash;
    save(data);
  });
  req.session.authenticated = true;
  res.json({ ok: true });
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const db = load();
  if (!db.initialized) {
    return res.status(409).json({ error: 'not_initialized' });
  }
  const { pin } = req.body || {};
  if (!isValidPin(pin)) {
    return res.status(400).json({ error: 'invalid_pin' });
  }
  const ok = await bcrypt.compare(pin, db.pinHash || '');
  if (!ok) {
    return res.status(401).json({ error: 'wrong_pin', message: 'Incorrect PIN.' });
  }
  req.session.authenticated = true;
  res.json({ ok: true });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// POST /api/auth/change-pin - requires being logged in + current pin
router.post('/change-pin', requireAuth, async (req, res) => {
  const db = load();
  const { currentPin, newPin } = req.body || {};
  if (!isValidPin(newPin)) {
    return res.status(400).json({ error: 'invalid_pin', message: 'New PIN must be 4-8 digits.' });
  }
  const ok = await bcrypt.compare(currentPin || '', db.pinHash || '');
  if (!ok) {
    return res.status(401).json({ error: 'wrong_pin', message: 'Current PIN is incorrect.' });
  }
  const pinHash = await bcrypt.hash(newPin, 10);
  await withLock((data) => {
    data.pinHash = pinHash;
    save(data);
  });
  res.json({ ok: true });
});

module.exports = router;
