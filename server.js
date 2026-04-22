const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database('app.db');

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
