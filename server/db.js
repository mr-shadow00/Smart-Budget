// server/db.js
// Tiny file-based data store. No native modules required, so the Docker
// image builds cleanly on any architecture (Intel NAS boxes, ARM, etc).
// Data lives in one JSON file inside the mounted volume, written atomically
// (write to temp file, then rename) so a crash mid-write can't corrupt it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_CATEGORIES = [
  { id: 'cat_salary', name: 'Salary', type: 'income', color: '#4f7a5c', icon: '💼' },
  { id: 'cat_gift', name: 'Gift', type: 'income', color: '#4f7a5c', icon: '🎁' },
  { id: 'cat_other_income', name: 'Other income', type: 'income', color: '#4f7a5c', icon: '➕' },
  { id: 'cat_groceries', name: 'Groceries', type: 'expense', color: '#a24b3f', icon: '🛒' },
  { id: 'cat_rent', name: 'Rent / Mortgage', type: 'expense', color: '#a24b3f', icon: '🏠' },
  { id: 'cat_utilities', name: 'Utilities', type: 'expense', color: '#a24b3f', icon: '💡' },
  { id: 'cat_transport', name: 'Transport', type: 'expense', color: '#a24b3f', icon: '🚗' },
  { id: 'cat_dining', name: 'Dining out', type: 'expense', color: '#a24b3f', icon: '🍔' },
  { id: 'cat_health', name: 'Health', type: 'expense', color: '#a24b3f', icon: '💊' },
  { id: 'cat_fun', name: 'Fun & entertainment', type: 'expense', color: '#a24b3f', icon: '🎮' },
  { id: 'cat_other_expense', name: 'Other expense', type: 'expense', color: '#a24b3f', icon: '🧾' }
];

function defaultData() {
  return {
    initialized: false,
    pinHash: null,
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    settings: {
      currency: 'USD',
      theme: 'dark',
      displayName: 'My Budget'
    },
    categories: DEFAULT_CATEGORIES,
    transactions: []
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    const fresh = defaultData();
    save(fresh);
    return fresh;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Corrupted file - back it up rather than silently eating the user's data.
    const backupPath = DB_FILE + '.corrupt.' + Date.now();
    fs.copyFileSync(DB_FILE, backupPath);
    console.error(`[db] db.json was corrupt. Backed up to ${backupPath} and starting fresh.`);
    const fresh = defaultData();
    save(fresh);
    return fresh;
  }
}

function save(data) {
  ensureDataDir();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// Serializes read-modify-write operations so two near-simultaneous requests
// (e.g. two devices saving at once) can't stomp on each other.
let queue = Promise.resolve();
function withLock(fn) {
  const run = queue.then(() => {
    const db = load();
    return fn(db);
  });
  queue = run.then(() => {}, () => {});
  return run;
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

module.exports = { load, save, withLock, genId, DATA_DIR, DB_FILE };
