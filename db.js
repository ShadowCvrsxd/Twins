const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'twins.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

function get(key, defaultValue = {}) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value);
  } catch (e) {
    return defaultValue;
  }
}

function set(key, data) {
  db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify(data));
}

module.exports = { db, get, set };
