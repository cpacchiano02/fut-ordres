const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database('app.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- AUTH ----------
function auth(req, res, next) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---------- DB ----------
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT,
  customer_name TEXT,
  platform TEXT,
  coins INTEGER,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT,
  contact TEXT,
  platform TEXT,
  quantity INTEGER,
  status TEXT DEFAULT 'new',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS balance_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount INTEGER NOT NULL,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// ---------- UTILS ----------
function genCode() {
  return 'ORD-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ---------- ROUTES ----------
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/login.html'))
);

app.get('/dashboard', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/dashboard.html'))
);

// ---------- LOGIN ----------
app.post('/api/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Password errata' });
});

// ---------- STATS ----------
app.get('/api/stats', auth, (req, res) => {
  const balance = db.prepare(
    'SELECT COALESCE(SUM(amount),0) AS total FROM balance_movements'
  ).get().total;

  res.json({
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    pending: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c,
    reservations: db.prepare("SELECT COUNT(*) c FROM reservations WHERE status='new'").get().c,
    balance
  });
});

// ---------- BALANCE ----------
app.get('/api/balance', auth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM balance_movements ORDER BY created_at DESC LIMIT 20'
  ).all();

  res.json(rows);
});

app.post('/api/balance', auth, (req, res) => {
  const { amount, note } = req.body;

  db.prepare(`
    INSERT INTO balance_movements (amount, note)
    VALUES (?, ?)
  `).run(Number(amount), note || '');

  res.json({ success: true });
});

// ---------- ORDERS ----------
app.get('/api/orders', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all());
});

app.post('/api/orders', auth, (req, res) => {
  const { customer_name, platform, coins } = req.body;

  db.prepare(`
    INSERT INTO orders (order_code, customer_name, platform, coins)
    VALUES (?, ?, ?, ?)
  `).run(genCode(), customer_name, platform, coins);

  res.json({ success: true });
});

app.put('/api/orders/:id/status', auth, (req, res) => {
  db.prepare('UPDATE orders SET status=? WHERE id=?')
    .run(req.body.status, req.params.id);

  res.json({ success: true });
});

app.delete('/api/orders/:id', auth, (req, res) => {
  const o = db.prepare('SELECT status FROM orders WHERE id=?').get(req.params.id);
  if (!o || o.status !== 'completed') {
    return res.status(400).json({ error: 'Solo ordini completati' });
  }
  db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

app.delete('/api/orders-completed', auth, (req, res) => {
  db.prepare("DELETE FROM orders WHERE status='completed'").run();
  res.json({ success: true });
});

// ---------- RESERVATIONS ----------
app.get('/api/reservations', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM reservations ORDER BY created_at DESC').all());
});

app.post('/api/reservations', (req, res) => {
  const { customer_name, contact, platform, quantity } = req.body;
  db.prepare(`
    INSERT INTO reservations (customer_name, contact, platform, quantity)
    VALUES (?, ?, ?, ?)
  `).run(customer_name, contact, platform, quantity);

  res.json({ success: true });
});

app.post('/api/reservations/:id/create-order', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM reservations WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    INSERT INTO orders (order_code, customer_name, platform, coins)
    VALUES (?, ?, ?, ?)
  `).run(genCode(), r.customer_name, r.platform, r.quantity);

  db.prepare("UPDATE reservations SET status='confirmed' WHERE id=?")
    .run(req.params.id);

  res.json({ success: true });
});

// ---------- START ----------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('✅ Server running on port', PORT);
});
``
