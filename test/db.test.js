const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ownTmp = !process.env.DB_PATH;
const tmp = ownTmp ? fs.mkdtempSync(path.join(os.tmpdir(), 't8-db-')) : '';
const dbPath = process.env.DB_PATH || path.join(tmp, 't8.db');
const jsonPath = process.env.DB_JSON_PATH || path.join(tmp, 't8.json');
process.env.DB_PATH = dbPath;
process.env.DB_JSON_PATH = jsonPath;

const dbmod = require('../db');

let failures = 0;
function check(fn, msg) {
  try { fn(); console.log('ok:', msg); }
  catch (e) { failures++; console.error('FAIL:', msg, '-', e.message); }
}

const sqliteMode = !!dbmod.db;
console.log('mode:', sqliteMode ? 'sqlite (node:sqlite)' : 'json-fallback');

if (sqliteMode) {
  check(() => assert.ok(fs.existsSync(dbPath)), 'DB_PATH file exists after init');
} else {
  check(() => assert.ok(!dbmod.db), 'db is falsy in fallback mode');
}

dbmod.set('k', { a: 1 });
check(() => assert.deepStrictEqual(dbmod.get('k'), { a: 1 }), "get('k') deep-equals {a:1}");

if (!sqliteMode) {
  check(() => assert.ok(fs.existsSync(jsonPath)), 'DB_JSON_PATH file was created');
}

if (ownTmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }

console.log(failures === 0 ? 'PASS' : 'FAIL');
process.exit(failures === 0 ? 0 : 1);
