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
    transactions: db.transactions,
    savings: db.savings || []
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="smart-budget-backup-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.send(JSON.stringify(exportData, null, 2));
});

// Wraps a CSV field in quotes and escapes any quotes inside it, but only
// when it actually needs it — keeps plain numbers and short words readable
// in the raw file instead of every cell being quoted.
function csvField(value) {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// GET /api/backup/export.csv - a spreadsheet-friendly export of every
// transaction, for opening in Excel/Sheets rather than restoring into
// this app. The JSON export above remains the one to use for restoring.
router.get('/export.csv', (req, res) => {
  const db = load();
  const transactions = (db.transactions || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const header = ['Date', 'Type', 'Category', 'Description', 'Amount', 'Note', 'Source'];
  const rows = transactions.map((t) => [
    t.date || '',
    t.type || '',
    t.category || '',
    t.description || '',
    (t.amount || 0).toFixed(2),
    t.note || '',
    t.source === 'savings' ? 'Savings transfer' : ''
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="smart-budget-transactions-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  // A BOM so Excel opens it as UTF-8 instead of guessing wrong on accented
  // or non-Latin characters in descriptions/notes.
  res.send('\uFEFF' + csv);
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
    // Older backups won't have a "savings" array — default to empty rather
    // than wiping out jars that already exist for no reason.
    data.savings = Array.isArray(body.savings) ? body.savings : (data.savings || []);
    if (body.settings && typeof body.settings === 'object') {
      data.settings = { ...data.settings, ...body.settings };
    }
    save(data);
  });

  res.json({ ok: true });
});

module.exports = router;
