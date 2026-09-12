// server/routes/savings.js
const express = require('express');
const { load, save, withLock, genId } = require('../db');

const router = express.Router();

function isValidAmount(n) {
  return typeof n === 'number' && isFinite(n) && n > 0;
}

// Deposits and withdrawals move money between a goal and the person's
// spendable balance, so each one is mirrored as a real transaction.
// Lazily creates a "Savings" category (once per type) instead of
// requiring every install to already have one. Uses a color outside
// the app's usual green-income/red-expense scheme so these transfers
// are visually distinguishable from ordinary spending and earning at a
// glance, everywhere categories are shown.
function ensureSavingsCategory(data, type) {
  if (!Array.isArray(data.categories)) data.categories = [];
  let cat = data.categories.find((c) => c.name === 'Savings' && c.type === type);
  if (!cat) {
    cat = {
      id: genId('cat'),
      name: 'Savings',
      type,
      color: '#5b7fa8',
      icon: type === 'expense' ? '🏦' : '💰'
    };
    data.categories.push(cat);
  }
  return cat;
}

// A saving jar always needs a name and a target amount — that target is the
// "set amount" the person commits to before they can start dropping money in.
function sanitizeGoal(body) {
  const { name, purpose, targetAmount, icon, color } = body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return { error: 'name is required' };
  }
  if (!isValidAmount(targetAmount)) {
    return { error: 'targetAmount must be a positive number' };
  }
  return {
    value: {
      name: name.trim().slice(0, 50),
      purpose: (purpose || '').toString().trim().slice(0, 300),
      targetAmount: Math.round(targetAmount * 100) / 100,
      icon: (icon || '🏺').toString().slice(0, 8),
      color: typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#d98e4a'
    }
  };
}

// GET /api/savings
router.get('/', (req, res) => {
  const db = load();
  res.json({ goals: db.savings || [] });
});

// POST /api/savings  - create a new jar (starts empty, at $0 saved)
router.post('/', async (req, res) => {
  const { error, value } = sanitizeGoal(req.body);
  if (error) return res.status(400).json({ error: 'invalid_goal', message: error });

  const goal = {
    id: genId('jar'),
    ...value,
    currentAmount: 0,
    contributions: [],
    createdAt: Date.now()
  };

  await withLock((data) => {
    if (!Array.isArray(data.savings)) data.savings = [];
    data.savings.push(goal);
    save(data);
  });

  res.status(201).json({ goal });
});

// PUT /api/savings/:id - edit a jar's name/purpose/target/icon/color.
// Never touches currentAmount or contribution history.
router.put('/:id', async (req, res) => {
  const { error, value } = sanitizeGoal(req.body);
  if (error) return res.status(400).json({ error: 'invalid_goal', message: error });

  let updated = null;
  await withLock((data) => {
    const list = data.savings || [];
    const idx = list.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return;
    updated = { ...list[idx], ...value };
    list[idx] = updated;
    data.savings = list;
    save(data);
  });

  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json({ goal: updated });
});

// POST /api/savings/:id/deposit  { amount, note? } - drop money into the jar.
// This is mirrored as an expense against the all-time balance, since the
// money is leaving spendable funds and going into this goal.
router.post('/:id/deposit', async (req, res) => {
  const { amount, note } = req.body || {};
  if (!isValidAmount(amount)) {
    return res.status(400).json({ error: 'invalid_amount', message: 'amount must be a positive number' });
  }
  const rounded = Math.round(amount * 100) / 100;

  let updated = null;
  await withLock((data) => {
    const list = data.savings || [];
    const idx = list.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return;
    const goal = list[idx];
    goal.currentAmount = Math.round(((goal.currentAmount || 0) + rounded) * 100) / 100;
    goal.contributions = Array.isArray(goal.contributions) ? goal.contributions : [];
    goal.contributions.push({
      id: genId('dep'),
      amount: rounded,
      note: (note || '').toString().slice(0, 200),
      date: new Date().toISOString().slice(0, 10),
      createdAt: Date.now()
    });
    updated = goal;

    if (!Array.isArray(data.transactions)) data.transactions = [];
    const cat = ensureSavingsCategory(data, 'expense');
    data.transactions.push({
      id: genId('tx'),
      type: 'expense',
      amount: rounded,
      description: `Added to "${goal.name}"`,
      category: cat.name,
      date: new Date().toISOString().slice(0, 10),
      note: (note || '').toString().slice(0, 200),
      source: 'savings',
      goalId: goal.id,
      createdAt: Date.now()
    });

    data.savings = list;
    save(data);
  });

  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json({ goal: updated });
});

// POST /api/savings/:id/withdraw  { amount, note? } - take money back out of
// the jar. Mirrored as income against the all-time balance, since the money
// is coming back into spendable funds. Can't withdraw more than is saved.
router.post('/:id/withdraw', async (req, res) => {
  const { amount, note } = req.body || {};
  if (!isValidAmount(amount)) {
    return res.status(400).json({ error: 'invalid_amount', message: 'amount must be a positive number' });
  }
  const rounded = Math.round(amount * 100) / 100;

  let updated = null;
  let insufficientFunds = false;
  await withLock((data) => {
    const list = data.savings || [];
    const idx = list.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return;
    const goal = list[idx];
    if (rounded > (goal.currentAmount || 0) + 1e-9) {
      insufficientFunds = true;
      return;
    }
    goal.currentAmount = Math.round(((goal.currentAmount || 0) - rounded) * 100) / 100;
    updated = goal;

    if (!Array.isArray(data.transactions)) data.transactions = [];
    const cat = ensureSavingsCategory(data, 'income');
    data.transactions.push({
      id: genId('tx'),
      type: 'income',
      amount: rounded,
      description: `Withdrawn from "${goal.name}"`,
      category: cat.name,
      date: new Date().toISOString().slice(0, 10),
      note: (note || '').toString().slice(0, 200),
      source: 'savings',
      goalId: goal.id,
      createdAt: Date.now()
    });

    data.savings = list;
    save(data);
  });

  if (insufficientFunds) {
    return res.status(400).json({ error: 'insufficient_funds', message: "Can't withdraw more than what's saved in this goal." });
  }
  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json({ goal: updated });
});

// DELETE /api/savings/:id
// Two different flows share this route, controlled by `refund` in the
// request body:
//   - "Complete" (refund not set): the goal is finished, so its deposits
//     already did their job — just remove the goal, leave the ledger alone.
//   - "Delete" / abandon (refund: true): the goal is being given up on
//     before it's done, so every deposit/withdrawal transaction tied to it
//     is removed too. Since the balance is just the sum of all
//     transactions, removing them automatically gives that money back.
router.delete('/:id', async (req, res) => {
  const refund = !!(req.body && req.body.refund);
  let found = false;
  await withLock((data) => {
    const before = (data.savings || []).length;
    data.savings = (data.savings || []).filter((g) => g.id !== req.params.id);
    found = data.savings.length < before;
    if (!found) return;

    if (refund && Array.isArray(data.transactions)) {
      data.transactions = data.transactions.filter(
        (t) => !(t.source === 'savings' && t.goalId === req.params.id)
      );
    }

    save(data);
  });
  if (!found) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

module.exports = router;
