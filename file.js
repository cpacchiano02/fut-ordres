const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database('fut_orders.db');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Inizializza database
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
const defaultPrices = db.prepare("SELECT * FROM settings WHERE key = 'price_per_million_ps'").get();
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

// API: Dashboard stats
app.get('/api/stats', (req, res) => {
  const stats = {
    totalAccounts: db.prepare("SELECT COUNT(*) as count FROM accounts WHERE is_active = 1").get().count,
    totalCoins: {
      ps: db.prepare("SELECT COALESCE(SUM(coin_balance), 0) as total FROM accounts WHERE platform = 'ps' AND is_active = 1").get().total,
      xbox: db.prepare("SELECT COALESCE(SUM(coin_balance), 0) as total FROM accounts WHERE platform = 'xbox' AND is_active = 1").get().total,
      pc: db.prepare("SELECT COALESCE(SUM(coin_balance), 0) as total FROM accounts WHERE platform = 'pc' AND is_active = 1").get().total
    },
    pendingOrders: db.prepare("SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'processing')").get().count,
    completedToday: db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'completed' AND DATE(completed_at) = DATE('now')").get().count,
    revenueToday: db.prepare("SELECT COALESCE(SUM(price_eur), 0) as total FROM orders WHERE status = 'completed' AND DATE(completed_at) = DATE('now')").get().total
  };
  res.json(stats);
});

// API: Account
app.get('/api/accounts', (req, res) => {
  const accounts = db.prepare("SELECT * FROM accounts ORDER BY platform, coin_balance DESC").all();
  res.json(accounts);
});

app.post('/api/accounts', (req, res) => {
  const { name, email, platform, coin_balance, daily_limit } = req.body;
  try {
    const result = db.prepare(
      "INSERT INTO accounts (name, email, platform, coin_balance, daily_limit) VALUES (?, ?, ?, ?, ?)"
    ).run(name, email || null, platform, coin_balance || 0, daily_limit || 5000000);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/accounts/:id', (req, res) => {
  const { name, email, platform, coin_balance, is_active, daily_limit } = req.body;
  try {
    db.prepare(
      "UPDATE accounts SET name = ?, email = ?, platform = ?, coin_balance = ?, is_active = ?, daily_limit = ? WHERE id = ?"
    ).run(name, email, platform, coin_balance, is_active ? 1 : 0, daily_limit, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/accounts/:id', (req, res) => {
  db.prepare("DELETE FROM accounts WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// API: Verifica disponibilità
app.get('/api/availability/:platform/:coins', (req, res) => {
  const { platform, coins } = req.params;
  const coinsNum = parseInt(coins);
  
  const available = db.prepare(`
    SELECT COALESCE(SUM(coin_balance - transferred_today), 0) as available 
    FROM accounts 
    WHERE platform = ? AND is_active = 1 AND (coin_balance - transferred_today) > 0
  `).get(platform).available;
  
  const priceKey = `price_per_million_${platform}`;
  const pricePerMillion = parseFloat(db.prepare("SELECT value FROM settings WHERE key = ?").get(priceKey)?.value || 4);
  const totalPrice = (coinsNum / 1000000) * pricePerMillion;
  
  res.json({
    available: available >= coinsNum,
    totalAvailable: available,
    requested: coinsNum,
    priceEur: Math.round(totalPrice * 100) / 100
  });
});

// API: Ordini
app.get('/api/orders', (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, a.name as account_name 
    FROM orders o 
    LEFT JOIN accounts a ON o.source_account_id = a.id 
    ORDER BY o.created_at DESC
  `).all();
  res.json(orders);
});

app.post('/api/orders', (req, res) => {
  const { customer_name, customer_contact, customer_ea_id, platform, coins_requested, notes } = req.body;
  
  // Verifica disponibilità
  const available = db.prepare(`
    SELECT COALESCE(SUM(coin_balance - transferred_today), 0) as available 
    FROM accounts 
    WHERE platform = ? AND is_active = 1
  `).get(platform).available;
  
  if (available < coins_requested) {
    return res.status(400).json({ error: 'Crediti non disponibili' });
  }
  
  // Calcola prezzo
  const priceKey = `price_per_million_${platform}`;
  const pricePerMillion = parseFloat(db.prepare("SELECT value FROM settings WHERE key = ?").get(priceKey)?.value || 4);
  const totalPrice = (coins_requested / 1000000) * pricePerMillion;
  
  // Trova account migliore
  const bestAccount = db.prepare(`
    SELECT * FROM accounts 
    WHERE platform = ? AND is_active = 1 AND (coin_balance - transferred_today) >= ?
    ORDER BY coin_balance DESC
    LIMIT 1
  `).get(platform, coins_requested);
  
  const orderCode = generateOrderCode();
  
  try {
    const result = db.prepare(`
      INSERT INTO orders (order_code, customer_name, customer_contact, customer_ea_id, platform, coins_requested, price_eur, source_account_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderCode, customer_name, customer_contact || null, customer_ea_id, platform, coins_requested, totalPrice, bestAccount?.id || null, notes || null);
    
    res.json({ 
      success: true, 
      order_code: orderCode,
      price_eur: Math.round(totalPrice * 100) / 100,
      account_assigned: bestAccount?.name || 'Da assegnare'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/orders/:id/status', (req, res) => {
  const { status, transfer_card_name, listing_price } = req.body;
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  
  if (!order) {
    return res.status(404).json({ error: 'Ordine non trovato' });
  }
  
  if (status === 'completed' && order.status !== 'completed') {
    // Aggiorna saldo account e log
    if (order.source_account_id) {
      db.prepare("UPDATE accounts SET transferred_today = transferred_today + ?, coin_balance = coin_balance - ? WHERE id = ?")
        .run(order.coins_requested, order.coins_requested, order.source_account_id);
      
      db.prepare("INSERT INTO transfer_log (order_id, account_id, coins_transferred, card_used) VALUES (?, ?, ?, ?)")
        .run(order.id, order.source_account_id, order.coins_requested, transfer_card_name || order.transfer_card_name);
    }
    
    db.prepare("UPDATE orders SET status = ?, transfer_card_name = ?, listing_price = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status, transfer_card_name || order.transfer_card_name, listing_price || order.listing_price, req.params.id);
  } else {
    db.prepare("UPDATE orders SET status = ?, transfer_card_name = ?, listing_price = ? WHERE id = ?")
      .run(status, transfer_card_name || order.transfer_card_name, listing_price || order.listing_price, req.params.id);
  }
  
  res.json({ success: true });
});

app.delete('/api/orders/:id', (req, res) => {
  db.prepare("DELETE FROM orders WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// API: Settings
app.get('/api/settings', (req, res) => {
  const settings = {};
  db.prepare("SELECT * FROM settings").all().forEach(row => {
    settings[row.key] = row.value;
  });
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const settings = req.body;
  for (const [key, value] of Object.entries(settings)) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, String(value));
  }
  res.json({ success: true });
});

// API: Reset transferred_today (da chiamare ogni giorno)
app.post('/api/reset-daily', (req, res) => {
  db.prepare("UPDATE accounts SET transferred_today = 0").run();
  res.json({ success: true });
});

// API: Log trasferimenti
app.get('/api/logs', (req, res) => {
  const logs = db.prepare(`
    SELECT l.*, o.order_code, o.customer_name, a.name as account_name
    FROM transfer_log l
    LEFT JOIN orders o ON l.order_id = o.id
    LEFT JOIN accounts a ON l.account_id = a.id
    ORDER BY l.timestamp DESC
    LIMIT 100
  `).all();
  res.json(logs);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
