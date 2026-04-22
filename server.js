const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database('app.db');

// Password admin semplice
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ---------------------
// Middleware
// ---------------------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------
// Auth middleware
// ---------------------
function auth(req, res, next) {
  const password = req.headers['x-admin-password'];

  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// ---------------------
// Database init
// ---------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    coins INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    contact TEXT NOT NULL,
    platform TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ---------------------
// Utility
// ---------------------
function generateOrderCode() {
  return 'ORD-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ---------------------
// Routes statiche
// ---------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------
// API login
// ---------------------
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};

  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true });
  }

  return res.status(401).json({ error: 'Password errata' });
});

// ---------------------
// API health
// ---------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ---------------------
// API stats
// ---------------------
app.get('/api/stats', auth, (req, res) => {
  const orders = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;
  const pending = db
    .prepare("SELECT COUNT(*) AS count FROM orders WHERE status = 'pending'")
    .get().count;
  const reservations = db
    .prepare("SELECT COUNT(*) AS count FROM reservations WHERE status = 'new'")
    .get().count;

  res.json({
    orders,
    pending,
    reservations
  });
});

// ---------------------
// API orders
// ---------------------
app.get('/api/orders', auth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM orders ORDER BY created_at DESC')
    .all();

  res.json(rows);
});

app.post('/api/orders', auth, (req, res) => {
  const { customer_name, platform, coins } = req.body || {};

  if (!customer_name || !platform || !coins) {
    return res.status(400).json({
      error: 'customer_name, platform e coins sono obbligatori'
    });
  }

  const orderCode = generateOrderCode();

  db.prepare(`
    INSERT INTO orders (order_code, customer_name, platform, coins, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(orderCode, customer_name, platform, Number(coins));

  res.json({ success: true, order_code: orderCode });
});

app.put('/api/orders/:id/status', auth, (req, res) => {
  const { status } = req.body || {};
  const { id } = req.params;

  if (!status) {
    return res.status(400).json({ error: 'Status obbligatorio' });
  }

  db.prepare(`
    UPDATE orders
    SET status = ?
    WHERE id = ?
  `).run(status, id);

  res.json({ success: true });
});

// ---------------------
// API reservations
// ---------------------
app.get('/api/reservations', auth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM reservations ORDER BY created_at DESC')
    .all();

  res.json(rows);
});

// Pubblica: crea richiesta
app.post('/api/reservations', (req, res) => {
  const { customer_name, contact, platform, quantity } = req.body || {};

  if (!customer_name || !contact || !platform || !quantity) {
    return res.status(400).json({
      error: 'customer_name, contact, platform e quantity sono obbligatori'
    });
  }

  db.prepare(`
    INSERT INTO reservations (customer_name, contact, platform, quantity, status)
    VALUES (?, ?, ?, ?, 'new')
  `).run(customer_name, contact, platform, Number(quantity));

  res.json({ success: true });
});

// Crea ordine da richiesta
app.post('/api/reservations/:id/create-order', auth, (req, res) => {
  const { id } = req.params;

  const reservation = db.prepare(`
    SELECT * FROM reservations
    WHERE id = ?
  `).get(id);

  if (!reservation) {
    return res.status(404).json({ error: 'Richiesta non trovata' });
  }

  const orderCode = generateOrderCode();

  db.prepare(`
    INSERT INTO orders (order_code, customer_name, platform, coins, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(
    orderCode,
    reservation.customer_name,
    reservation.platform,
    Number(reservation.quantity)
  );

  db.prepare(`
    UPDATE reservations
    SET status = 'confirmed'
    WHERE id = ?
  `).run(id);

  res.json({ success: true, order_code: orderCode });
});

// ---------------------
// Start server
// ---------------------
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
