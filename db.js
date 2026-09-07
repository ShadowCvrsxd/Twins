const fs = require('fs');
const path = require('path');

const dbFile = path.join(__dirname, 'twins_store.json');

function loadStore() {
  if (!fs.existsSync(dbFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveStore(store) {
  const tempFile = dbFile + '.' + Math.random().toString(36).substring(2) + '.tmp';
  try {
    fs.writeFileSync(tempFile, JSON.stringify(store, null, 2));
    fs.renameSync(tempFile, dbFile);
  } catch (e) {
    try { fs.unlinkSync(tempFile); } catch(err){}
  }
}

function get(key, defaultValue = {}) {
  const store = loadStore();
  return store[key] !== undefined ? store[key] : defaultValue;
}

function set(key, data) {
  const store = loadStore();
  store[key] = data;
  saveStore(store);
}

module.exports = { get, set };
