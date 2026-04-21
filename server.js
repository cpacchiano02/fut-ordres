const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const db = new Database('service.db');

// =====================
// CONFIG
// =====================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';

// =====================
// MIDDLEWARE
// =====================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =====================
// SIMPLE AUTH
// =====================
function auth(req, res, next) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// =====================
// ROUTES STATIC
// =====================
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'login.html'))
);

app.get('/dashboard', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))
);

app.get('/request', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'request.html'))
);

// =====================
// DATABASE
// =====================
db.exec(`
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT,
  contact TEXT,
  platform TEXT,
  quantity INTEGER,
  status TEXT DEFAULT 'new',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  reference TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// =====================
// LOG HELPER
// =====================
function logAction(type, reference) {
  db.prepare(
    'INSERT INTO operations (type, reference) VALUES (?, ?)'
  ).run(type, reference);
}

// =====================
// API
// =====================
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---- REQUESTS (PUBLIC)
app.post('/api/requests', (req, res) => {
  const { customer_name, contact, platform, quantity } = req.body;
  const info = db.prepare(`
    INSERT INTO requests (customer_name, contact, platform, quantity)
    VALUES (?, ?, ?, ?)
  `).run(customer_name, contact, platform, quantity);

  logAction('NEW_REQUEST', `request:${info.lastInsertRowid}`);
  res.json({ success: true });
});

// ---- ADMIN
app.get('/api/requests', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all());
});

app.put('/api/requests/:id/status', auth, (req, res) => {
  db.prepare('UPDATE requests SET status = ? WHERE id = ?')
    .run(req.body.status, req.params.id);

  logAction('UPDATE_STATUS', `request:${req.params.id}`);
  res.json({ success: true });
});

// ---- STATS
app.get('/api/stats', auth, (req, res) => {
  res.json({
    totalRequests: db.prepare('SELECT COUNT(*) c FROM requests').get().c,
    newRequests: db.prepare("SELECT COUNT(*) c FROM requests WHERE status='new'").get().c
  });
});

// ---- LOGS
app.get('/api/logs', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM operations ORDER BY created_at DESC').all());
});

// ---- EXPORT CSV
app.get('/api/export/requests', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM requests').all();
  let csv = 'id,name,contact,platform,quantity,status,created_at\n';
  rows.forEach(r => {
    csv += `${r.id},${r.customer_name},${r.contact},${r.platform},${r.quantity},${r.status},${r.created_at}\n`;
  });
  res.header('Content-Type', 'text/csv');
  res.attachment('requests.csv');
  res.send(csv);
});

// =====================
// START
// =====================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('✅ Server running on port', PORT));
