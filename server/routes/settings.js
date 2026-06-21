// server/routes/settings.js
const express = require('express');
const { load, save, withLock } = require('../db');

const router = express.Router();

const ALLOWED_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR', 'BDT', 'CNY', 'CHF', 'SEK', 'NZD', 'SGD', 'AED'
]);

router.get('/', (req, res) => {
  const db = load();
  res.json({ settings: db.settings });
});

router.put('/', async (req, res) => {
  const { currency, theme, displayName } = req.body || {};
  const patch = {};

  if (currency !== undefined) {
    if (!ALLOWED_CURRENCIES.has(currency)) {
      return res.status(400).json({ error: 'invalid_currency' });
    }
    patch.currency = currency;
  }
  if (theme !== undefined) {
    if (theme !== 'dark' && theme !== 'light') {
      return res.status(400).json({ error: 'invalid_theme' });
    }
    patch.theme = theme;
  }
  if (displayName !== undefined) {
    patch.displayName = displayName.toString().slice(0, 40) || 'My Budget';
  }

  let settings = null;
  await withLock((data) => {
    data.settings = { ...data.settings, ...patch };
    settings = data.settings;
    save(data);
  });

  res.json({ settings });
});

module.exports = router;
