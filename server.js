const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database('fut_orders.db');

// Middleware
app.use(cors());
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Home route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --------------------
// DATABASE INIT
// --------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    platform TEXT NOT NULL CHECK(platform IN ('ps', 'xbox', 'pc')),
    coin_balance INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    daily_limit INTEGER DEFAULT 5000000,
    transferred_today INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_contact TEXT,
    customer_ea_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    coins_requested INTEGER NOT NULL,
    price_eur REAL,
    status TEXT DEFAULT 'pending',
    source_account_id INTEGER,
    transfer_card_name TEXT,
    listing_price INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Default prices
const priceExists = db
  .prepare("SELECT 1 FROM settings WHERE key = 'price_per_million_ps'")
  .get();

if (!priceExists) {
  db.exec(`
    INSERT INTO settings (key, value) VALUES
    ('price_per_million_ps', '4.50'),
    ('price_per_million_xbox', '4.00'),
    ('price_per_million_pc', '3.50');
  `);
}

// --------------------
// API
// --------------------
app.get('/api/stats', (req, res) => {
  const stats = {
    totalAccounts: db.prepare(
      "SELECT COUNT(*) AS c FROM accounts WHERE is_active = 1"
    ).get().c,
    totalCoins: {
      ps: db.prepare(
        "SELECT COALESCE(SUM(coin_balance),0) AS t FROM accounts WHERE platform='ps' AND is_active=1"
      ).get().t,
      xbox: db.prepare(
        "SELECT COALESCE(SUM(coin_balance),0) AS t FROM accounts WHERE platform='xbox' AND is_active=1"
      ).get().t,
      pc: db.prepare(
        "SELECT COALESCE(SUM(coin_balance),0) AS t FROM accounts WHERE platform='pc' AND is_active=1"
      ).get().t,
    }
  };

  res.json(stats);
});

// --------------------
// START SERVER
// --------------------
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});    order_code TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_contact TEXT,
    customer_ea_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    coins_requested INTEGER NOT NULL,
    price_eur REAL,
    status TEXT DEFAULT 'pending',
    source_account_id INTEGER,
    transfer_card_name TEXT,
    listing_price INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (source_account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS transfer_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    account_id INTEGER,
    coins_transferred INTEGER,
    card_used TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Inizializza prezzi default
const defaultPrices = db
  .prepare("SELECT * FROM settings WHERE key = 'price_per_million_ps'")
  .get();

if (!defaultPrices) {
  db.exec(`
    INSERT INTO settings (key, value) VALUES 
    ('price_per_million_ps', '4.50'),
    ('price_per_million_xbox', '4.00'),
    ('price_per_million_pc', '3.50');
  `);
}

// Genera codice ordine
function generateOrderCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'ORD-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// =======================
// API
// =======================

// Dashboard stats
app.get('/api/stats', (req, res) => {
  const stats = {
    totalAccounts: db.prepare(
      "SELECT COUNT(*) as count FROM accounts WHERE is_active = 1"
    ).get().count,
    totalCoins: {
      ps: db.prepare(
        "SELECT COALESCE(SUM(coin_balance), 0) as total FROM accounts WHERE platform = 'ps' AND is_active = 1"
      ).get().total,
      xbox: db.prepare(
        "SELECT COALESCE(SUM(coin_balance), 0) as total FROM accounts WHERE platform = 'xbox' AND is_active = 1"
      ).get().total,
      pc: db.prepare(
        "SELECT COALESCE(SUM(coin_balance), 0) as total FROM accounts WHERE platform = 'pc' AND is_active = 1"
      ).get().total
    },
    pendingOrders: db.prepare(
      "SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'processing')"
    ).get().count,
    completedToday: db.prepare(
      "SELECT COUNT(*) as count FROM orders WHERE status = 'completed' AND DATE(completed_at) = DATE('now')"
    ).get().count,
    revenueToday: db.prepare(
      "SELECT COALESCE(SUM(price_eur), 0) as total FROM orders WHERE status = 'completed' AND DATE(completed_at) = DATE('now')"
    ).get().total
  };

  res.json(stats);
});

// Account
app.get('/api/accounts', (req, res) => {
  const accounts = db
    .prepare("SELECT * FROM accounts ORDER BY platform, coin_balance DESC")
    .all();
  res.json(accounts);
});

app.post('/api/accounts', (req, res) => {
  const { name, email, platform, coin_balance, daily_limit } = req.body;
  try {
