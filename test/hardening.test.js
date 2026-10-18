// T13: aggregate hardening harness. Proves T1-T7 end-to-end against a REAL spawned
// hub on a free port with an isolated temp store, plus `node --check` on the changed
// source files. Prints PASS/FAIL per case and exits non-zero if ANY case fails.
//
// HUB_ENTRY env overrides the hub entrypoint (default ./tg-hub.js) so the failure QA
// can point it at a deliberately broken copy in the repo root.
//
// Isolation: temp DB_PATH/DB_JSON_PATH + free HUB_PORT for every spawn; the real
// twins.db/twins_store.json are md5-sentinelled and never touched; abort if 8089 is
// already in use by a live hub.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const HUB_ENTRY = path.resolve(ROOT, process.env.HUB_ENTRY || 'tg-hub.js');
const HUB_API_TOKEN = 'testHub';
const TG_DUMMY = 'dummyTG';
const SEED_OWNER = 'seed';
const SEED_BOT = 'seed';
const SEED_TOK = 'tokH';
const CHANGED_FILES = ['tg-hub.js', 'bot-base.js', 'db.js', 'hub-util.js', 'tg-chat-bot.js'];

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => { s.destroy(); resolve(false); });
  });
}

function waitPort(port, timeout = 10000) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() > deadline) reject(new Error('hub did not listen on ' + port));
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

function md5(file) {
  try { return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex'); }
  catch (_) { return null; }
}

function wsAttempt(query, msg, waitMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let opened = false, closed = false, done = false;
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${query}`);
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch (_) {}
      resolve({ opened, closed, elapsed: Date.now() - t0 });
    };
    const timer = setTimeout(finish, waitMs);
    ws.on('open', () => { opened = true; ws.send(JSON.stringify(msg)); });
    ws.on('close', () => { closed = true; finish(); });
    ws.on('error', () => {});
  });
}

function killHub(proc) {
  try { process.kill(-proc.pid, 'SIGKILL'); }
  catch (_) { try { proc.kill('SIGKILL'); } catch (e) {} }
}

let PORT = 0;
let tmpDir = null;
let hub = null;

(async () => {
  // --- Preconditions: never run against a live hub; sentinel the real stores ---
  if (await portOpen(8089)) {
    console.log('ABORT: port 8089 is in use by a live hub; refusing to run the harness.');
    process.exit(1);
  }
  const realDb = path.join(ROOT, 'twins.db');
  const realJson = path.join(ROOT, 'twins_store.json');
  const realDbMd5 = md5(realDb);
  const realJsonMd5 = md5(realJson);

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't13-'));
  const dbPath = path.join(tmpDir, 'twins.db');
  const jsonPath = path.join(tmpDir, 'twins_store.json');
  PORT = await freePort();

  const testEnv = {
    ...process.env,
    HUB_PORT: String(PORT),
    DB_PATH: dbPath,
    DB_JSON_PATH: jsonPath,
    HUB_API_TOKEN,
    TG_BOT_TOKEN: TG_DUMMY,
    TG_CHAT_BOT_TOKEN: 'dummyChat',
  };

  try {
    // --- T28: request body cap helper (pure, boundary-inclusive) ---
    const { MAX_BODY_BYTES, isOversizedBody } = require('../hub-util.js');
    check('T28 cap: empty body ok', isOversizedBody('') === false);
    check('T28 cap: just under cap ok', isOversizedBody('a'.repeat(MAX_BODY_BYTES - 1)) === false);
    check('T28 cap: exactly at cap ok', isOversizedBody('a'.repeat(MAX_BODY_BYTES)) === false);
    check('T28 cap: one over cap oversized', isOversizedBody('a'.repeat(MAX_BODY_BYTES + 1)) === true);
    check('T28 cap: far over cap oversized', isOversizedBody('a'.repeat(MAX_BODY_BYTES * 2)) === true);

    // --- node --check on changed source files ---
    for (const f of CHANGED_FILES) {
      const r = spawnSync('node', ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
      check(`node --check ${f}`, r.status === 0, (r.stderr || '').trim().split('\n')[0] || '');
    }

    // --- Seed the temp store BEFORE spawn (same DB_PATH/DB_JSON_PATH the hub gets) ---
    const seed = spawnSync('node', ['-e',
      `const{set}=require('./db');set('user_tokens',{${SEED_OWNER}:${JSON.stringify(SEED_TOK)}});set('links_approved',{${SEED_OWNER}:[${JSON.stringify(SEED_BOT)}]})`,
    ], { cwd: ROOT, env: testEnv, encoding: 'utf8' });
    check('seed temp store', seed.status === 0, (seed.stderr || '').trim().split('\n').pop() || '');
    check('seed wrote an isolated store (temp db or temp json)',
      fs.existsSync(dbPath) || fs.existsSync(jsonPath));

    // --- Spawn the real hub ---
    hub = spawn('node', [HUB_ENTRY], { cwd: ROOT, env: testEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = { s: '' };
    hub.stdout.on('data', (d) => { out.s += d; });
    hub.stderr.on('data', (d) => { out.s += d; });
    await waitPort(PORT);

    // --- HTTP cases (T1-T3) ---
    const base = `http://127.0.0.1:${PORT}`;
    const get = async (key, headers) => (await fetch(`${base}/state?key=${key}`, { headers })).status;
    const post = async (body, headers) => (await fetch(`${base}/state`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    })).status;
    const hubAuth = { Authorization: `Bearer ${HUB_API_TOKEN}` };

    check('GET allowlisted key (chat_sender_selection) -> 200',
      (await get('chat_sender_selection', hubAuth)) === 200);
    check('GET secret key (user_tokens) -> 403',
      (await get('user_tokens', hubAuth)) === 403);
    check('GET unknown key (nope) -> 403',
      (await get('nope', hubAuth)) === 403);
    check('GET no Authorization -> 401',
      (await get('chat_sender_selection')) === 401);
    check('GET with dummy TG_BOT_TOKEN bearer -> 403',
      (await get('chat_sender_selection', { Authorization: `Bearer ${TG_DUMMY}` })) === 403);
    check('POST secret key (user_tokens) -> 403',
      (await post({ key: 'user_tokens', value: { attacker: 'x' } }, hubAuth)) === 403);
    check('POST allowlisted key (chat_sender_selection) -> 200',
      (await post({ key: 'chat_sender_selection', value: {} }, hubAuth)) === 200);

    // --- WS cases (T5/T7) ---
    const happy = await wsAttempt(`?bot=${SEED_BOT}`, { type: 'auth', token: SEED_TOK }, 1500);
    check('WS happy: seeded token keeps socket open', happy.opened && !happy.closed,
      `closed=${happy.closed} elapsed=${happy.elapsed}ms`);

    const nosuch = await wsAttempt('?bot=nosuch', { type: 'auth' }, 5000);
    check('WS unknown bot + tokenless auth closes', nosuch.closed,
      `closed=${nosuch.closed} elapsed=${nosuch.elapsed}ms`);

    const tokenless = await wsAttempt(`?bot=${SEED_BOT}`, { type: 'auth' }, 5000);
    check('WS tokenless auth on a bot WITH a token closes (T5 bypass closed)', tokenless.closed,
      `closed=${tokenless.closed} elapsed=${tokenless.elapsed}ms`);

    const junkQuery = await wsAttempt(`?bot=${SEED_BOT}&token=junk`, { type: 'auth', token: SEED_TOK }, 1500);
    check('WS junk ?token= in URL ignored, correct auth message keeps socket open',
      junkQuery.opened && !junkQuery.closed,
      `closed=${junkQuery.closed} elapsed=${junkQuery.elapsed}ms`);

    console.log('--- hub log (tail) ---');
    console.log(out.s.trim().split('\n').slice(-12).join('\n'));
  } catch (e) {
    check('harness execution', false, e.message);
  } finally {
    // --- Teardown: kill hub, free port, remove temp dir ---
    if (hub) killHub(hub);
    await sleep(400);
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {} }

    check('real twins.db untouched (md5)', md5(realDb) === realDbMd5);
    check('real twins_store.json untouched (md5)', md5(realJson) === realJsonMd5);
    check('temp dir removed', !fs.existsSync(tmpDir));
  }

  console.log(failed === 0 ? '--- hardening harness: ALL PASS ---' : `--- ${failed} case(s) FAILED ---`);
  console.log(failed === 0 ? 'PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})();
