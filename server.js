const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const db = new Database('fut_orders.db');

// ======================
// CONFIG
// ======================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cambia-questa-password';

// ======================
// MIDDLEWARE
// ======================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ======================
// HELPERS
// ======================
function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  return cookies.fo_auth === '1';
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.status(401).json({ error: 'Non autorizzato' });
}

function setAuthCookie(res) {
  res.setHeader(
    'Set-Cookie',
    'fo_auth=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'
  );
}

function clearAuthCookie(res) {
  res.setHeader(
    'Set-Cookie',
    'fo_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  );
}

function generateOrderCode() {
  return 'ORD-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function columnExists(table, column) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === column);
  } catch {
    return false;
  }
}

function ensureColumn(table, definition) {
  const columnName = definition.split(' ')[0];
  if (!columnExists(table, columnName)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function logActivity(action, message) {
  db.prepare(`
    INSERT INTO activity_log (action, message)
    VALUES (?, ?)
  `).run(action, message);
}

function findBestAccount(platform, quantity) {
  return db.prepare(`
    SELECT *
    FROM accounts
    WHERE platform = ?
      AND is_active = 1
      AND coin_balance >= ?
    ORDER BY coin_balance DESC
    LIMIT 1
  `).get(platform, quantity);
}

// ======================
// STATIC ROUTES
// ======================
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/request', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'request.html'));
});

// ======================
// DATABASE INIT
// ======================
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
  customer_contact TEXT,
  platform TEXT NOT NULL,
  quantity INTEGER DEFAULT 0,
  price_eur REAL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  account_id INTEGER,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// Migrazioni leggere per installazioni precedenti
ensureColumn('orders', 'customer_contact TEXT');
ensureColumn('orders', 'quantity INTEGER DEFAULT 0');
ensureColumn('orders', 'notes TEXT');
ensureColumn('orders', 'account_id INTEGER');
ensureColumn('reservations', 'notes TEXT');
ensureColumn('reservations', 'status TEXT DEFAULT \'new\'');

// Compatibilità con vecchie colonne "coins" / "coins_requested"
if (columnExists('orders', 'coins')) {
  db.exec(`
    UPDATE orders
    SET quantity = CASE
      WHEN quantity IS NULL OR quantity = 0 THEN coins
      ELSE quantity
    END
  `);
}

if (columnExists('orders', 'coins_requested')) {
  db.exec(`
    UPDATE orders
    SET quantity = CASE
      WHEN quantity IS NULL OR quantity = 0 THEN coins_requested
      ELSE quantity
    END
  `);
}

// ======================
// AUTH
// ======================
app.get('/api/session', (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Password non valida' });
  }

  setAuthCookie(res);
  return res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
  clearAuthCookie(res);
  return res.json({ success: true });
});

// ======================
// PUBLIC API
// ======================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/reservations', (req, res) => {
  const { customer_name, contact, platform, quantity, notes } = req.body;

  if (!customer_name || !contact || !platform || !quantity) {
    return res.status(400).json({
      error: 'customer_name, contact, platform e quantity sono obbligatori'
    });
  }

  const info = db.prepare(`
    INSERT INTO reservations (customer_name, contact, platform, quantity, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    customer_name,
    contact,
    platform,
    Number(quantity),
    notes || ''
  );

  logActivity(
    'reservation_created',
    `Nuova richiesta #${info.lastInsertRowid} da ${customer_name} (${platform}, ${quantity})`
  );

  return res.json({
    success: true,
    id: info.lastInsertRowid
  });
});

// ======================
// ADMIN API: STATS
// ======================
app.get('/api/stats', requireAuth, (req, res) => {
  const activeAccounts = db.prepare(`
    SELECT COUNT(*) AS c
    FROM accounts
    WHERE is_active = 1
  `).get().c;

  const totalInventory = db.prepare(`
    SELECT COALESCE(SUM(coin_balance), 0) AS t
    FROM accounts
    WHERE is_active = 1
  `).get().t;

  const openOrders = db.prepare(`
    SELECT COUNT(*) AS c
    FROM orders
    WHERE status NOT IN ('completed', 'cancelled')
  `).get().c;

  const completedOrders = db.prepare(`
    SELECT COUNT(*) AS c
    FROM orders
    WHERE status = 'completed'
  `).get().c;

  const newReservations = db.prepare(`
    SELECT COUNT(*) AS c
    FROM reservations
    WHERE status = 'new'
  `).get().c;

  const revenue = db.prepare(`
    SELECT COALESCE(SUM(price_eur), 0) AS t
    FROM orders
    WHERE status = 'completed'
  `).get().t;

  const byPlatform = {
    ps: db.prepare(`
      SELECT COALESCE(SUM(coin_balance), 0) AS t
      FROM accounts
      WHERE is_active = 1 AND platform = 'ps'
    `).get().t,
    xbox: db.prepare(`
      SELECT COALESCE(SUM(coin_balance), 0) AS t
      FROM accounts
      WHERE is_active = 1 AND platform = 'xbox'
    `).get().t,
    pc: db.prepare(`
      SELECT COALESCE(SUM(coin_balance), 0) AS t
      FROM accounts
      WHERE is_active = 1 AND platform = 'pc'
    `).get().t
  };

  res.json({
    activeAccounts,
    totalInventory,
    openOrders,
    completedOrders,
    newReservations,
    revenue,
    byPlatform
  });
});

// ======================
// ADMIN API: ACCOUNTS
// ======================
app.get('/api/accounts', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT *
    FROM accounts
    ORDER BY created_at DESC
  `).all();

  res.json(rows);
});

app.post('/api/accounts', requireAuth, (req, res) => {
  const { name, platform, coin_balance, is_active } = req.body;

  if (!name || !platform) {
    return res.status(400).json({
      error: 'name e platform sono obbligatori'
    });
  }

  const info = db.prepare(`
    INSERT INTO accounts (name, platform, coin_balance, is_active)
    VALUES (?, ?, ?, ?)
  `).run(
    name,
    platform,
    Number(coin_balance || 0),
    is_active === false || is_active === 0 ? 0 : 1
  );

  logActivity(
    'account_created',
    `Creato account "${name}" (${platform})`
  );

  res.json({
    success: true,
    id: info.lastInsertRowid
  });
});

app.put('/api/accounts/:id', requireAuth, (req, res) => {
  const { name, platform, coin_balance, is_active } = req.body;

  if (!name || !platform) {
    return res.status(400).json({
      error: 'name e platform sono obbligatori'
    });
  }

  db.prepare(`
    UPDATE accounts
    SET name = ?, platform = ?, coin_balance = ?, is_active = ?
    WHERE id = ?
  `).run(
    name,
    platform,
    Number(coin_balance || 0),
    is_active ? 1 : 0,
    req.params.id
  );

  logActivity(
    'account_updated',
    `Aggiornato account ID ${req.params.id}`
  );

  res.json({ success: true });
});

app.delete('/api/accounts/:id', requireAuth, (req, res) => {
  db.prepare(`DELETE FROM accounts WHERE id = ?`).run(req.params.id);

  logActivity(
    'account_deleted',
    `Eliminato account ID ${req.params.id}`
  );

  res.json({ success: true });
});

// ======================
// ADMIN API: ORDERS
// ======================
app.get('/api/orders', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, a.name AS account_name
    FROM orders o
    LEFT JOIN accounts a ON o.account_id = a.id
    ORDER BY o.created_at DESC
  `).all();

  res.json(rows);
});

app.post('/api/orders', requireAuth, (req, res) => {
  const {
    customer_name,
    customer_contact,
    platform,
    quantity,
    price_eur,
    notes
  } = req.body;

  if (!customer_name || !platform || !quantity) {
    return res.status(400).json({
      error: 'customer_name, platform e quantity sono obbligatori'
    });
  }

  const qty = Number(quantity);
  const account = findBestAccount(platform, qty);
  const status = account ? 'pending' : 'waiting_stock';
  const accountId = account ? account.id : null;
  const code = generateOrderCode();

  const info = db.prepare(`
    INSERT INTO orders (
      order_code,
      customer_name,
      customer_contact,
      platform,
      quantity,
      price_eur,
      status,
      account_id,
      notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code,
    customer_name,
    customer_contact || '',
    platform,
    qty,
    Number(price_eur || 0),
    status,
    accountId,
    notes || ''
  );

  logActivity(
    'order_created',
    `Creato ordine ${code} per ${customer_name} (${platform}, ${qty})`
  );

  res.json({
    success: true,
    id: info.lastInsertRowid,
    order_code: code,
    status,
    account_assigned: account ? account.name : null
  });
});

app.put('/api/orders/:id', requireAuth, (req, res) => {
  const {
    customer_name,
    customer_contact,
    platform,
    quantity,
    price_eur,
    status,
    account_id,
    notes
  } = req.body;

  const order = db.prepare(`
    SELECT *
    FROM orders
    WHERE id = ?
  `).get(req.params.id);

  if (!order) {
    return res.status(404).json({ error: 'Ordine non trovato' });
  }

  const nextStatus = status || order.status;
  const nextQuantity = Number(quantity ?? order.quantity);
  const nextAccountId = account_id ?? order.account_id;

  // Se passa a completed, scarica disponibilità
  if (order.status !== 'completed' && nextStatus === 'completed' && nextAccountId) {
    db.prepare(`
      UPDATE accounts
      SET coin_balance = coin_balance - ?
      WHERE id = ?
    `).run(nextQuantity, nextAccountId);
  }

  // Se da completed torna indietro, ripristina disponibilità
  if (order.status === 'completed' && nextStatus !== 'completed' && order.account_id) {
    db.prepare(`
      UPDATE accounts
      SET coin_balance = coin_balance + ?
      WHERE id = ?
    `).run(order.quantity, order.account_id);
  }

  db.prepare(`
    UPDATE orders
    SET customer_name = ?,
        customer_contact = ?,
        platform = ?,
        quantity = ?,
        price_eur = ?,
        status = ?,
        account_id = ?,
        notes = ?
    WHERE id = ?
  `).run(
    customer_name ?? order.customer_name,
    customer_contact ?? order.customer_contact,
    platform ?? order.platform,
    nextQuantity,
    Number(price_eur ?? order.price_eur),
    nextStatus,
    nextAccountId,
    notes ?? order.notes,
    req.params.id
  );

  logActivity(
    'order_updated',
    `Aggiornato ordine ID ${req.params.id} → stato ${nextStatus}`
  );

  res.json({ success: true });
});

app.post('/api/orders/:id/assign', requireAuth, (req, res) => {
  const order = db.prepare(`
    SELECT *
    FROM orders
    WHERE id = ?
  `).get(req.params.id);

  if (!order) {
    return res.status(404).json({ error: 'Ordine non trovato' });
  }

  const account = findBestAccount(order.platform, order.quantity);

  if (!account) {
    return res.status(400).json({
      error: 'Nessun account disponibile'
    });
  }

  db.prepare(`
    UPDATE orders
    SET account_id = ?, status = CASE WHEN status = 'waiting_stock' THEN 'pending' ELSE status END
    WHERE id = ?
  `).run(account.id, req.params.id);

  logActivity(
    'order_assigned',
    `Assegnato ordine ID ${req.params.id} all'account "${account.name}"`
  );

  res.json({
    success: true,
    account_name: account.name
  });
});

app.delete('/api/orders/:id', requireAuth, (req, res) => {
  const order = db.prepare(`
    SELECT *
    FROM orders
    WHERE id = ?
  `).get(req.params.id);

  if (order && order.status === 'completed' && order.account_id) {
    db.prepare(`
      UPDATE accounts
      SET coin_balance = coin_balance + ?
      WHERE id = ?
    `).run(order.quantity, order.account_id);
  }

  db.prepare(`DELETE FROM orders WHERE id = ?`).run(req.params.id);

  logActivity(
    'order_deleted',
    `Eliminato ordine ID ${req.params.id}`
  );

  res.json({ success: true });
});

// ======================
// ADMIN API: RESERVATIONS
// ======================
app.get('/api/reservations', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT *
    FROM reservations
    ORDER BY created_at DESC
  `).all();

  res.json(rows);
});

app.put('/api/reservations/:id', requireAuth, (req, res) => {
  const { status, notes } = req.body;

  const reservation = db.prepare(`
    SELECT *
    FROM reservations
    WHERE id = ?
  `).get(req.params.id);

  if (!reservation) {
    return res.status(404).json({ error: 'Richiesta non trovata' });
  }

  db.prepare(`
    UPDATE reservations
    SET status = ?, notes = ?
    WHERE id = ?
  `).run(
    status || reservation.status,
    notes ?? reservation.notes,
    req.params.id
  );

  logActivity(
    'reservation_updated',
    `Aggiornata richiesta ID ${req.params.id} → stato ${status || reservation.status}`
  );

  res.json({ success: true });
});

app.post('/api/reservations/:id/convert', requireAuth, (req, res) => {
  const reservation = db.prepare(`
    SELECT *
    FROM reservations
    WHERE id = ?
  `).get(req.params.id);

  if (!reservation) {
    return res.status(404).json({ error: 'Richiesta non trovata' });
  }

  const account = findBestAccount(reservation.platform, reservation.quantity);
  const status = account ? 'pending' : 'waiting_stock';
  const code = generateOrderCode();

  const info = db.prepare(`
    INSERT INTO orders (
      order_code,
      customer_name,
      customer_contact,
      platform,
      quantity,
      price_eur,
      status,
      account_id,
      notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code,
    reservation.customer_name,
    reservation.contact,
    reservation.platform,
    reservation.quantity,
    0,
    status,
    account ? account.id : null,
    reservation.notes || ''
  );

  db.prepare(`
    UPDATE reservations
    SET status = 'converted'
    WHERE id = ?
  `).run(req.params.id);

  logActivity(
    'reservation_converted',
    `Convertita richiesta ID ${req.params.id} in ordine ${code}`
  );

  res.json({
    success: true,
    order_id: info.lastInsertRowid,
    order_code: code,
    status
  });
});

app.delete('/api/reservations/:id', requireAuth, (req, res) => {
  db.prepare(`DELETE FROM reservations WHERE id = ?`).run(req.params.id);

  logActivity(
    'reservation_deleted',
    `Eliminata richiesta ID ${req.params.id}`
  );

  res.json({ success: true });
});

// ======================
// ADMIN API: ACTIVITY
// ======================
app.get('/api/activity', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT *
    FROM activity_log
    ORDER BY created_at DESC
    LIMIT 100
  `).all();

  res.json(rows);
});

// ======================
// START
// ======================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
