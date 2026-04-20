const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database('fut_orders.db');

app.use(cors());
app.use(express.json());

// static files
app.use(express.static(path.join(__dirname, 'public')));

// home route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// DATABASE INIT (UNA SOLA TABELLA, NIENTE DI PIÙ)
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// test API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('✅ Server running on port', PORT);
});
