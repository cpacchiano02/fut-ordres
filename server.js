const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database('app.db');

// 🔐 CONFIG
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ------------------
// MIDDLEWARE
// ------------------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ------------------
// AUTH
// ------------------
function auth(req, res, next) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ------------------
// ROUTES STATIC
// ------------------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/request', (req, res) => res.sendFile(path.join(__dirname, 'public/request.html')));

// ------------------
// DATABASE
// ------------------
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
`);

// ------------------
// API
// ------------------
app.get('/api/stats', auth, (req, res) => {
  res.json({
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    pending: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c,
    reservations: db.prepare("SELECT COUNT(*) c FROM reservations WHERE status='new'").get().c
  });
});

// ORDERS
app.get('/api/orders', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all());
});

app.put('/api/orders/:id/status', auth, (req, res) => {
  db.prepare('UPDATE orders SET status=? WHERE id=?')
    .run(req.body.status, req.params.id);
  res.json({ success: true });
});

// RESERVATIONS
app.get('/api/reservations', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM reservations ORDER BY created_at DESC').all());
});

app.put('/api/reservations/:id/status', auth, (req, res) => {
  db.prepare('UPDATE reservations SET status=? WHERE id=?')
    .run(req.body.status, req.params.id);
  res.json({ success: true });
});

// PUBLIC REQUEST
app.post('/api/reservations', (req, res) => {
  const { customer_name, contact, platform, quantity } = req.body;
  db.prepare(`
    INSERT INTO reservations (customer_name, contact, platform, quantity)
    VALUES (?, ?, ?, ?)
  `).run(customer_name, contact, platform, quantity);
  res.json({ success: true });
});

// ------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('✅ Server running on', PORT));
