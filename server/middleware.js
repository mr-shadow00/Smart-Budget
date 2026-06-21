// server/middleware.js
const { load } = require('./db');

// Blocks access to API routes until the PIN has been set up.
function requireInitialized(req, res, next) {
  const db = load();
  if (!db.initialized) {
    return res.status(409).json({ error: 'not_initialized', message: 'Set up a PIN first.' });
  }
  next();
}

// Blocks access until the current session has logged in with the PIN.
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'unauthenticated', message: 'Log in first.' });
}

module.exports = { requireInitialized, requireAuth };
