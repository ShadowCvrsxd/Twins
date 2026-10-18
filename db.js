const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'twins.db');
let db;

try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000'); // ponytail: 'database is locked' уходит — операции ждут до 5с
} catch (e) {
  // node:sqlite недоступен (старый Node) — используем JSON-хранилище без падений
  console.warn('[DB] node:sqlite unavailable, JSON fallback');
}

if (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

// JSON fallback store. Объявлено ДО миграции: миграция использует load/saveJsonStore
// в fallback-режиме (иначе TDZ ReferenceError).
const jsonStoreFile = process.env.DB_JSON_PATH || path.join(__dirname, 'twins_store.json');
function loadJsonStore() {
  if (!fs.existsSync(jsonStoreFile)) return {};
  try { return JSON.parse(fs.readFileSync(jsonStoreFile, 'utf8')); }
  catch (e) {
    console.error('[DB] loadJsonStore:', e.message);
    return {};
  }
}
function saveJsonStore(store) {
  try { fs.writeFileSync(jsonStoreFile, JSON.stringify(store, null, 2)); }
  catch (e) { console.error('[DB] saveJsonStore:', e.message); }
}

// Миграция старых JSON файлов. Источник удаляем ТОЛЬКО после подтверждённого переноса
// в активный стор. В SQLite — строка есть/вставлена. В fallback (db пуст) данные
// копируются в twins_store.json, но исходный файл остаётся (без потери данных).
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
  if (!fs.existsSync(filePath)) continue;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (db) {
      const existing = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
      if (!existing) {
        db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify(data));
      }
      // строка подтверждена в активном SQLite — теперь файл можно удалить
      fs.unlinkSync(filePath);
    } else {
      const store = loadJsonStore();
      if (store[key] === undefined) {
        store[key] = data;
        saveJsonStore(store);
      }
    }
  } catch (e) {
    console.error('[DB] migration', file, e.message);
  }
}

try {
  const files = fs.readdirSync(__dirname);
  for (const file of files) {
    if (!file.startsWith('spam_tasks_') || !file.endsWith('.json')) continue;
    const filePath = path.join(__dirname, file);
    const username = file.replace('spam_tasks_', '').replace('.json', '');
    const key = `spam_tasks_${username.toLowerCase()}`;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (db) {
        const existing = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
        if (!existing) {
          db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify(data));
        }
        fs.unlinkSync(filePath);
      } else {
        const store = loadJsonStore();
        if (store[key] === undefined) {
          store[key] = data;
          saveJsonStore(store);
        }
      }
    } catch (e) {
      console.error('[DB] migration', file, e.message);
    }
  }
} catch (e) {
  console.error('[DB] readdir', e.message);
}

function get(key, defaultValue = {}) {
  if (db) {
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
      if (!row) return defaultValue;
      return JSON.parse(row.value);
    } catch (e) {
      console.error('[DB] get', key, e.message);
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
    } catch (e) {
      console.error('[DB] set', key, e.message);
    }
  } else {
    const store = loadJsonStore();
    store[key] = data;
    saveJsonStore(store);
  }
}

module.exports = { db, get, set };
