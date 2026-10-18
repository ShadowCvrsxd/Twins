// T9: legacy-JSON migration must not drop source data before a confirmed import.
// Fallback mode (no node:sqlite): keep the source file, copy data into twins_store.json,
// and the data survives a "restart" (second process).
//
// The migration reads fixtures from db.js's __dirname (the repo root), so the fixture
// MUST live in the repo root and is removed unconditionally in `finally`.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const repo = path.join(__dirname, '..');
const legacy = path.join(repo, 'meow_settings.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't9-mig-'));
const dbPath = path.join(tmp, 't9.db');
const jsonPath = path.join(tmp, 't9.json');
const seeded = { foo: 'bar', n: 42 };

const md5 = (p) => (fs.existsSync(p) ? crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex') : null);
const sentinels = ['twins.db', 'twins_store.json'].map((f) => ({ f, sum: md5(path.join(repo, f)) }));

let failures = 0;
function check(fn, msg) {
  try { fn(); console.log('ok:', msg); }
  catch (e) { failures++; console.error('FAIL:', msg, '-', e.message); }
}

function runChild(label) {
  const script = "const m=require('./db'); console.log('READ', JSON.stringify(m.get('meow_settings', null)));";
  const r = spawnSync(process.execPath, ['-r', './test/force-no-sqlite.js', '-e', script], {
    cwd: repo,
    env: Object.assign({}, process.env, { DB_PATH: dbPath, DB_JSON_PATH: jsonPath }),
    encoding: 'utf8',
  });
  console.log(`--- child: ${label} (exit ${r.status}) ---`);
  process.stdout.write(r.stdout || '');
  if (r.stderr) process.stdout.write(r.stderr);
  return r;
}

try {
  console.log('node:', process.version, '| fallback via -r ./test/force-no-sqlite.js');
  console.log('DB_PATH=' + dbPath + '  DB_JSON_PATH=' + jsonPath);
  fs.writeFileSync(legacy, JSON.stringify(seeded));
  console.log('seeded legacy ' + path.basename(legacy) + ' = ' + JSON.stringify(seeded));

  const c1 = runChild('child1 (fallback migrate)');
  check(() => assert.strictEqual(c1.status, 0), 'child1 exit 0');
  const m1 = /READ (.*)/.exec(c1.stdout || '');
  check(() => assert.ok(m1), 'child1 printed READ');
  check(() => assert.deepStrictEqual(m1 && JSON.parse(m1[1]), seeded), "child1 get('meow_settings') === seeded (copied into JSON store)");

  check(() => assert.ok(fs.existsSync(legacy)), 'legacy meow_settings.json still EXISTS after fallback child (not unlinked)');

  const c2 = runChild('child2 (restart)');
  check(() => assert.strictEqual(c2.status, 0), 'child2 exit 0');
  const m2 = /READ (.*)/.exec(c2.stdout || '');
  check(() => assert.ok(m2), 'child2 printed READ');
  check(() => assert.deepStrictEqual(m2 && JSON.parse(m2[1]), seeded), "child2 restart get('meow_settings') === seeded (persisted via twins_store.json)");

  for (const s of sentinels) {
    check(() => assert.strictEqual(md5(path.join(repo, s.f)), s.sum), `real ${s.f} untouched (md5)`);
  }
} finally {
  try { fs.unlinkSync(legacy); } catch (e) {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}

console.log(failures === 0 ? 'PASS' : 'FAIL');
process.exit(failures === 0 ? 0 : 1);
