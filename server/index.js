// server/index.js
const path = require('path');
const express = require('express');
const session = require('express-session');

const { load, save } = require('./db');
const { requireInitialized, requireAuth } = require('./middleware');

const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const categoryRoutes = require('./routes/categories');
const settingsRoutes = require('./routes/settings');
const backupRoutes = require('./routes/backup');

const PORT = process.env.PORT || 3000;

// Make sure the data file (and its session secret) exists before the server
// starts handling requests, so the session secret is stable across restarts.
const db = load();
if (!db.sessionSecret) {
  db.sessionSecret = require('crypto').randomBytes(32).toString('hex');
  save(db);
}

const app = express();
app.set('trust proxy', 1); // play nicely behind a reverse proxy on the NAS

app.use(express.json({ limit: '2mb' }));

app.use(
  session({
    name: 'smartbudget.sid',
    secret: process.env.SESSION_SECRET || db.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days - re-enter PIN after a month
    }
  })
);

// ---- API routes ----
app.use('/api/auth', authRoutes);
app.use('/api/transactions', requireInitialized, requireAuth, transactionRoutes);
app.use('/api/categories', requireInitialized, requireAuth, categoryRoutes);
app.use('/api/settings', requireInitialized, requireAuth, settingsRoutes);
app.use('/api/backup', requireInitialized, requireAuth, backupRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Static frontend ----
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// SPA fallback for any non-API route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// JSON 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// Generic error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`Smart Budget listening on port ${PORT}`);
});
