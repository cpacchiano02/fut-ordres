const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database('fut_orders.db');

// middleware
app.use(cors());
app.use(express.json());

// static files
app.use(express.static(path.join(__dirname, 'public')));

// home
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ----------------------
// DATABASE
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

// ----------------------
// UTIL
// ----------------------
function generateOrderCode() {
  return 'ORD-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ----------------------
// API ACCOUNTS
// ----------------------

// lista account
app.get('/api/accounts', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM accounts ORDER BY created_at DESC'
  ).all();
  res.json(rows);
});

// crea account
app.post('/api/accounts', (req, res) => {
  const { name, platform, coin_balance } = req.body;

  const info = db.prepare(
    'INSERT INTO accounts (name, platform, coin_balance) VALUES (?, ?, ?)'
  ).run(name, platform, coin_balance || 0);

  res.json({ success: true, id: info.lastInsertRowid });
});

// aggiorna account
app.put('/api/accounts/:id', (req, res) => {
  const { name, coin_balance, is_active } = req.body;

  db.prepare(`
    UPDATE accounts
    SET name = ?, coin_balance = ?, is_active = ?
    WHERE id = ?
  `).run(name, coin_balance, is_active ? 1 : 0, req.params.id);

  res.json({ success: true });
});

// ----------------------
// API ORDERS
// ----------------------

// lista ordini
app.get('/api/orders', (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, a.name AS account_name
    FROM orders o
    LEFT JOIN accounts a ON o.account_id = a.id
    ORDER BY o.created_at DESC
  `).all();

  res.json(rows);
});

// crea ordine
app.post('/api/orders', (req, res) => {
  const { customer_name, platform, coins, price_eur } = req.body;

  const account = db.prepare(`
    SELECT * FROM accounts
    WHERE platform = ? AND is_active = 1 AND coin_balance >= ?
    ORDER BY coin_balance DESC
    LIMIT 1
  `).get(platform, coins);

  if (!account) {
    return res.status(400).json({ error: 'Crediti insufficienti' });
  }

  const code = generateOrderCode();

  db.prepare(`
    INSERT INTO orders (order_code, customer_name, platform, coins, price_eur, account_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(code, customer_name, platform, coins, price_eur, account.id);

  res.json({ success: true, order_code: code });
});

// aggiorna stato ordine
app.put('/api/orders/:id/status', (req, res) => {
  const { status } = req.body;

  db.prepare(`
    UPDATE orders SET status = ?
    WHERE id = ?
  `).run(status, req.params.id);

  res.json({ success: true });
});

// ----------------------
// DASHBOARD
// ----------------------
app.get('/api/stats', (req, res) => {
  const stats = {
    accounts: db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c,
    orders: db.prepare('SELECT COUNT(*) AS c FROM orders').get().c,
    pending: db.prepare(
      "SELECT COUNT(*) AS c FROM orders WHERE status = 'pending'"
    ).get().c
  };

  res.json(stats);
});

// ----------------------
// HEALTH
// ----------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ----------------------
// START
// ----------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('✅ Server running on port', PORT);
});
