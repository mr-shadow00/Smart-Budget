// server/routes/backup.js
const express = require('express');
const { load, save, withLock } = require('../db');

const router = express.Router();

// GET /api/backup/export - downloads everything except the PIN hash
router.get('/export', (req, res) => {
  const db = load();
  const exportData = {
    exportedAt: new Date().toISOString(),
    settings: db.settings,
    categories: db.categories,
    transactions: db.transactions
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="smart-budget-backup-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.send(JSON.stringify(exportData, null, 2));
});

// POST /api/backup/import - replaces categories/transactions/settings.
// The PIN is never touched by import, so you can't lock yourself out.
router.post('/import', async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.transactions) || !Array.isArray(body.categories)) {
    return res.status(400).json({
      error: 'invalid_backup',
      message: 'File must contain "transactions" and "categories" arrays.'
    });
  }

  await withLock((data) => {
    data.transactions = body.transactions;
    data.categories = body.categories;
    if (body.settings && typeof body.settings === 'object') {
      data.settings = { ...data.settings, ...body.settings };
    }
    save(data);
  });

  res.json({ ok: true });
});

module.exports = router;
