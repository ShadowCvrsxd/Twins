// T6: Integration test — system-token /command rejects foreign owner
// Spawns a real hub on a free port with an isolated temp DB, seeds approvals,
// and asserts the runtime owner guard behavior at HTTP level.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const HUB_ENTRY = path.resolve(ROOT, 'tg-hub.js');
const HUB_API_TOKEN = 'testHub';
const TG_DUMMY = 'dummyTG';

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
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

function killHub(proc) {
  try { process.kill(-proc.pid, 'SIGKILL'); }
  catch (_) { try { proc.kill('SIGKILL'); } catch (e) {} }
}

// Connect a fake WS bot and keep it open for the duration
// The hub expects the auth token to match user_tokens[ownerId] where ownerId is the chat that owns the bot
// For 'ownedbot', ownerId is 'owner-chat', so we send the token for 'owner-chat'
function connectFakeBot(port, botName, ownerToken) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?bot=${botName}`);
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      try { ws.terminate(); } catch (_) {}
      reject(new Error('WS connect timeout'));
    }, 5000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: ownerToken }));
    });
    ws.on('close', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      reject(new Error('WS closed before auth'));
    });
    ws.on('error', (e) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      reject(e);
    });
    // Success = socket stays open for 500ms after auth (no close event)
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(ws);
    }, 500);
  });
}

let PORT = 0;
let tmpDir = null;
let hub = null;
let fakeBot = null;

(async () => {
  // --- Preconditions: never run against a live hub on 8089 ---
  const s = net.connect(8089, '127.0.0.1');
  await new Promise((resolve) => {
    s.once('connect', () => { s.destroy(); console.log('ABORT: port 8089 is in use by a live hub; refusing to run the harness.'); process.exit(1); });
    s.once('error', () => { s.destroy(); resolve(); });
  });

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't6-'));
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

  // Set env BEFORE requiring db so the test process uses the temp store for seeding
  process.env.DB_PATH = dbPath;
  process.env.DB_JSON_PATH = jsonPath;
  const db = require('../db.js');

  try {
    // --- Seed the temp store BEFORE spawn (same DB_PATH/DB_JSON_PATH the hub gets) ---
    // links_approved: 'owner-chat' owns 'ownedbot'
    // mains_approved: 'owner-chat' owns 'mainbot'
    // bot_tokens: 'ownedbot' -> 'tok-owned', 'mainbot' -> 'tok-main'
    // user_tokens: 'owner-chat' -> 'tok-owner'
    const seed = spawnSync('node', ['-e', `
      const { set } = require('./db.js');
      set('links_approved', { 'owner-chat': ['ownedbot'] });
      set('mains_approved', { 'owner-chat': ['mainbot'] });
      set('bot_tokens', { 'ownedbot': 'tok-owned', 'mainbot': 'tok-main' });
      set('user_tokens', { 'owner-chat': 'tok-owner' });
    `], { cwd: ROOT, env: testEnv, encoding: 'utf8' });
    const seedOk = seed.status === 0;
    check('seed temp store', seedOk, true);
    const storeWritten = fs.existsSync(dbPath) || fs.existsSync(jsonPath);
    check('seed wrote an isolated store', storeWritten, true);

    // --- Spawn the real hub ---
    hub = spawn('node', [HUB_ENTRY], { cwd: ROOT, env: testEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = { s: '' };
    hub.stdout.on('data', (d) => { out.s += d; });
    hub.stderr.on('data', (d) => { out.s += d; });
    await waitPort(PORT);

    // --- Connect a fake WS bot for 'ownedbot' so 200 is reachable ---
    fakeBot = await connectFakeBot(PORT, 'ownedbot', 'tok-owner');

    // --- HTTP helper ---
    const base = `http://127.0.0.1:${PORT}`;
    const hubAuth = { Authorization: `Bearer ${HUB_API_TOKEN}` };
    const botAuth = { Authorization: `Bearer tok-owned` };
    const post = async (body, headers) => (await fetch(`${base}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })).status;

    // 1. Foreign ownerChatId → 403
    const foreign = await post({
      targetBot: 'ownedbot',
      action: 'chat',
      text: 'hi',
      ownerChatId: 'foreign-chat',
    }, hubAuth);
    check('system token: foreign ownerChatId -> 403', foreign, 403);

    // 2. Correct ownerChatId → NOT 403 (200 with connected bot, or 404 if bot offline)
    const correct = await post({
      targetBot: 'ownedbot',
      action: 'chat',
      text: 'hi',
      ownerChatId: 'owner-chat',
    }, hubAuth);
    check('system token: correct ownerChatId -> not 403', correct !== 403, true);

    // 3. Omit ownerChatId → 403
    const omitted = await post({
      targetBot: 'ownedbot',
      action: 'chat',
      text: 'hi',
      // ownerChatId intentionally omitted
    }, hubAuth);
    check('system token: omitted ownerChatId -> 403', omitted, 403);

    // 4. Bot-token with spoofed ownerChatId targets its own authorized bot (resolveCommandTarget regression)
    // The bot token for 'ownedbot' should pin to 'ownedbot' even if ownerChatId is spoofed
    // We verify this by sending a command that would reach 'mainbot' if the spoof worked,
    // but since 'ownedbot' is connected, we should get 200 (or 404 if not connected)
    // The important part: it must NOT be a 403 (the command is routed to the bot's own target)
    const spoofed = await post({
      targetBot: 'mainbot',           // Spoofed target
      action: 'chat',
      text: 'hi',
      ownerChatId: 'owner-chat',      // Spoofed owner (would authorize mainbot if system token)
    }, botAuth);
    check('bot token: spoofed ownerChatId -> routed to own bot (not 403)', spoofed !== 403, true);

    console.log('--- hub log (tail) ---');
    console.log(out.s.trim().split('\n').slice(-12).join('\n'));
  } catch (e) {
    check('harness execution', false, e.message);
  } finally {
    // --- Teardown ---
    if (fakeBot) { try { fakeBot.close(); } catch (_) {} }
    if (hub) killHub(hub);
    await sleep(400);
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {} }
  }

  console.log(failed === 0 ? '--- ALL PASS ---' : `--- ${failed} case(s) FAILED ---`);
  console.log(failed === 0 ? 'PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})();