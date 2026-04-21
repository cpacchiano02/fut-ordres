const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database('fut_orders.db');

// ----------------------
// MIDDLEWARE
// ----------------------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------
// ROUTES STATICHE
// ----------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/request', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'request.html'));
});

// ----------------------
// DATABASE INIT
// ----------------------
db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  coin_balance INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  coins INTEGER NOT NULL,
  price_eur REAL,
  status TEXT DEFAULT 'pending',
  account_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  contact TEXT NOT NULL,
  platform TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'new',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// ----------------------
// UTILS
// ----------------------
function generateOrderCode() {
  return 'ORD-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ----------------------
// API HEALTH
// ----------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ----------------------
// API STATS
// ----------------------
app.get('/api/stats', (req, res) => {
  const accounts = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  const orders = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  const pending = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'pending'")
    .get().c;
  const reservationsNew = db
    .prepare("SELECT COUNT(*) AS c FROM reservations WHERE status = 'new'")
    .get().c;

  res.json({
    accounts,
    orders,
    pending,
    reservationsNew
  });
});

// ----------------------
// API ACCOUNTS
// ----------------------
app.get('/api/accounts', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM accounts ORDER BY created_at DESC')
    .all();

  res.json(rows);
});

app.post('/api/accounts', (req, res) => {
  const { name, platform, coin_balance } = req.body;

  if (!name || !platform) {
    return res.status(400).json({ error: 'Nome e piattaforma sono obbligatori' });
  }

  const info = db
    .prepare(`
      INSERT INTO accounts (name, platform, coin_balance)
      VALUES (?, ?, ?)
    `)
    .run(name, platform, coin_balance || 0);

  res.json({
    success: true,
    id: info.lastInsertRowid
  });
});

app.put('/api/accounts/:id', (req, res) => {
  const { name, platform, coin_balance, is_active } = req.body;

  if (!name || !platform) {
    return res.status(400).json({ error: 'Nome e piattaforma sono obbligatori' });
  }

  db.prepare(`
    UPDATE accounts
    SET name = ?, platform = ?, coin_balance = ?, is_active = ?
    WHERE id = ?
  `).run(
    name,
    platform,
    coin_balance || 0,
    is_active ? 1 : 0,
    req.params.id
  );

  res.json({ success: true });
});

app.delete('/api/accounts/:id', (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ----------------------
// API ORDERS
// ----------------------
app.get('/api/orders', (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, a.name AS account_name
