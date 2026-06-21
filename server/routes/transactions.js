// server/routes/transactions.js
const express = require('express');
const { load, save, withLock, genId } = require('../db');

const router = express.Router();

function isValidAmount(n) {
  return typeof n === 'number' && isFinite(n) && n > 0;
}

function isValidType(t) {
  return t === 'income' || t === 'expense';
}

function isValidDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d).getTime());
}

function sanitizeTransaction(body) {
  const { type, amount, description, category, date, note } = body || {};
  if (!isValidType(type)) return { error: 'type must be "income" or "expense"' };
  if (!isValidAmount(amount)) return { error: 'amount must be a positive number' };
  if (!isValidDate(date)) return { error: 'date must be in YYYY-MM-DD format' };
  return {
    value: {
      type,
      amount: Math.round(amount * 100) / 100,
      description: (description || '').toString().slice(0, 200),
      category: (category || '').toString().slice(0, 100),
      date,
      note: (note || '').toString().slice(0, 1000)
    }
  };
}

// GET /api/transactions?month=YYYY-MM&type=&category=&q=
router.get('/', (req, res) => {
  const db = load();
  let items = db.transactions.slice();

  const { month, from, to, type, category, q } = req.query;

  if (month) {
    items = items.filter((t) => t.date.startsWith(month));
  }
  if (from) {
    items = items.filter((t) => t.date >= from);
  }
  if (to) {
    items = items.filter((t) => t.date <= to);
  }
  if (type) {
    items = items.filter((t) => t.type === type);
  }
  if (category) {
    items = items.filter((t) => t.category === category);
  }
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter(
      (t) =>
        (t.description || '').toLowerCase().includes(needle) ||
        (t.note || '').toLowerCase().includes(needle)
    );
  }

  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
  res.json({ transactions: items });
});

// GET /api/transactions/summary?month=YYYY-MM  (omit month for all-time)
router.get('/summary', (req, res) => {
  const db = load();
  const { month } = req.query;
  let items = db.transactions;
  if (month) items = items.filter((t) => t.date.startsWith(month));

  let income = 0;
  let expense = 0;
  const byCategory = {};

  for (const t of items) {
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;

    const key = t.category || 'Uncategorized';
    if (!byCategory[key]) byCategory[key] = { income: 0, expense: 0 };
    byCategory[key][t.type] += t.amount;
  }

  // All-time running balance always uses the full transaction set
  const allTimeBalance = db.transactions.reduce(
    (sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount),
    0
  );

  res.json({
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
    balance: Math.round((income - expense) * 100) / 100,
    allTimeBalance: Math.round(allTimeBalance * 100) / 100,
    byCategory
  });
});

// POST /api/transactions
router.post('/', async (req, res) => {
  const { error, value } = sanitizeTransaction(req.body);
  if (error) return res.status(400).json({ error: 'invalid_transaction', message: error });

  const tx = {
    id: genId('tx'),
    ...value,
    createdAt: Date.now()
  };

  await withLock((data) => {
    data.transactions.push(tx);
    save(data);
  });

  res.status(201).json({ transaction: tx });
});

// PUT /api/transactions/:id
router.put('/:id', async (req, res) => {
  const { error, value } = sanitizeTransaction(req.body);
  if (error) return res.status(400).json({ error: 'invalid_transaction', message: error });

  let updated = null;
  await withLock((data) => {
    const idx = data.transactions.findIndex((t) => t.id === req.params.id);
    if (idx === -1) return;
    updated = { ...data.transactions[idx], ...value };
    data.transactions[idx] = updated;
    save(data);
  });

  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json({ transaction: updated });
});

// DELETE /api/transactions/:id
router.delete('/:id', async (req, res) => {
  let found = false;
  await withLock((data) => {
    const before = data.transactions.length;
    data.transactions = data.transactions.filter((t) => t.id !== req.params.id);
    found = data.transactions.length < before;
    if (found) save(data);
  });
  if (!found) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

module.exports = router;
