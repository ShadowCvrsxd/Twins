const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'twins.db');
let db;

try {
  const Database = require('better-sqlite3');
  db = new Database(dbPath);
} catch (e) {
  // Если better-sqlite3 не установлен или не собрался,
  // используем встроенное SQLite-подобное хранилище на JSON без падений
  console.warn('[DB Warning] better-sqlite3 not available, using JSON store fallback.');
}

if (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

// Миграция старых JSON файлов
const migrationFiles = {
  'meow_settings.json': 'meow_settings',
  'autorespect_settings.json': 'autorespect_settings',
  'links_approved.json': 'links_approved',
  'links_pending.json': 'links_pending',
  'bots_status.json': 'bots_status',
  'bot_commands.json': 'bot_commands',
  'bot_requests.json': 'bot_requests',
  'chat_streaming.json': 'chat_streaming',
  'bot_aliases.json': 'bot_aliases',
  'chat_display_mode.json': 'chat_display_mode',
  'registration_lock.json': 'registration_lock',
  'traffic_stats.json': 'traffic_stats'
};

for (const [file, key] of Object.entries(migrationFiles)) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      if (db) {
        const existing = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
        if (!existing) {
          db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify(data));
        }
      }
      fs.unlinkSync(filePath);
    } catch (e) {}
  }
}

try {
  const files = fs.readdirSync(__dirname);
  for (const file of files) {
    if (file.startsWith('spam_tasks_') && file.endsWith('.json')) {
      const filePath = path.join(__dirname, file);
      const username = file.replace('spam_tasks_', '').replace('.json', '');
      const key = `spam_tasks_${username.toLowerCase()}`;
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      if (db) {
        const existing = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
        if (!existing) {
          db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify(data));
        }
      }
      fs.unlinkSync(filePath);
    }
  }
} catch (e) {}

// JSON fallback store если C++ бинарник недоступен
const jsonStoreFile = path.join(__dirname, 'twins_store.json');
function loadJsonStore() {
  if (!fs.existsSync(jsonStoreFile)) return {};
  try { return JSON.parse(fs.readFileSync(jsonStoreFile, 'utf8')); } catch(e) { return {}; }
}
function saveJsonStore(store) {
  try { fs.writeFileSync(jsonStoreFile, JSON.stringify(store, null, 2)); } catch(e) {}
}

function get(key, defaultValue = {}) {
  if (db) {
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
      if (!row) return defaultValue;
      return JSON.parse(row.value);
    } catch (e) {
      return defaultValue;
    }
  } else {
    const store = loadJsonStore();
    return store[key] !== undefined ? store[key] : defaultValue;
  }
}

function set(key, data) {
  if (db) {
    try {
      db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify(data));
    } catch (e) {}
  } else {
    const store = loadJsonStore();
    store[key] = data;
    saveJsonStore(store);
  }
}

module.exports = { db, get, set };
