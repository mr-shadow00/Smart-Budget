// server/routes/categories.js
const express = require('express');
const { load, save, withLock, genId } = require('../db');

const router = express.Router();

function sanitizeCategory(body) {
  const { name, type, color, icon } = body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return { error: 'name is required' };
  }
  if (type !== 'income' && type !== 'expense') {
    return { error: 'type must be "income" or "expense"' };
  }
  return {
    value: {
      name: name.trim().slice(0, 50),
      type,
      color: typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#d98e4a',
      icon: (icon || '🏷️').toString().slice(0, 8)
    }
  };
}

router.get('/', (req, res) => {
  const db = load();
  res.json({ categories: db.categories });
});

router.post('/', async (req, res) => {
  const { error, value } = sanitizeCategory(req.body);
  if (error) return res.status(400).json({ error: 'invalid_category', message: error });

  const category = { id: genId('cat'), ...value };
  await withLock((data) => {
    data.categories.push(category);
    save(data);
  });
  res.status(201).json({ category });
});

router.put('/:id', async (req, res) => {
  const { error, value } = sanitizeCategory(req.body);
  if (error) return res.status(400).json({ error: 'invalid_category', message: error });

  let updated = null;
  await withLock((data) => {
    const idx = data.categories.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return;
    updated = { ...data.categories[idx], ...value };
    data.categories[idx] = updated;
    save(data);
  });

  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json({ category: updated });
});

router.delete('/:id', async (req, res) => {
  let found = false;
  await withLock((data) => {
    const before = data.categories.length;
    data.categories = data.categories.filter((c) => c.id !== req.params.id);
    found = data.categories.length < before;
    if (found) save(data);
  });
  if (!found) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

module.exports = router;
