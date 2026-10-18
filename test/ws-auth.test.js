// T5: WebSocket auth. Pre-fix bypass: a tokenless {type:'auth'} on a bot whose
// owner has NO user_tokens entry left `undefined !== undefined` false, so the
// message AUTHENTICATED the socket (isAuthed=true, authTimeout cancelled).
// This test spawns the real hub and asserts:
//   happy   -> correct token in user_tokens authorizes (socket stays open, "авторизован")
//   wrong   -> wrong token closes, and NO "[AUTH DEBUG]" token line is printed
//   failure -> tokenless {type:'auth'} when user_tokens is empty must CLOSE, not authenticate
// T7 (same file): the WS token must travel ONLY in the {type:'auth'} message:
//   source  -> connectToHub's URL template has ?bot= and NO token= substring
//   happy   -> ws://...?bot=X (no token in URL) + correct auth message -> authorized
//   ignored -> ws://...?bot=X&token=junk + correct auth message -> still authorized
//             (proves the hub never reads ?token), and no token value in hub stdout
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

// Global test-isolation rule: never read/write the operator's real twins.db /
// twins_store.json. db.js reads these env vars at require time, so set BEFORE
// requiring ../db; the spawned hub spreads process.env and inherits them.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'twinks-test-'));
process.env.DB_PATH = path.join(TMP, 'db.sqlite');
process.env.DB_JSON_PATH = path.join(TMP, 'store.json');

const db = require('../db');

const HUB = path.join(__dirname, '..', 'tg-hub.js');
const BOT_SRC = path.join(__dirname, '..', 'bot-base.js');
let PORT = 8089;
const OWNER = '5555';
const BOT = 't5bot';
const TOK = 'tok5';
const BOT7 = 't7bot';
const TOK7 = 'tok7';

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

function waitPort(timeout = 8000) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const s = net.connect(PORT, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() > deadline) reject(new Error('hub did not listen on ' + PORT));
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

function startHub() {
  const proc = spawn('node', [HUB], {
    env: { ...process.env, TG_BOT_TOKEN: 'dummy', HUB_PORT: String(PORT) },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { out: '' };
  proc.stdout.on('data', (d) => { state.out += d; });
  proc.stderr.on('data', (d) => { state.out += d; });
  return { proc, state };
}

function killHub(proc) {
  try { process.kill(-proc.pid, 'SIGKILL'); }
  catch (e) { try { proc.kill('SIGKILL'); } catch (_) {} }
}

// Sends one auth message and resolves when the socket closes or waitMs elapses.
function authAttempt(msg, waitMs, query = `?bot=${BOT}`) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let opened = false;
    let closed = false;
    let done = false;
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

(async () => {
  PORT = await freePort();
  const origTokens = db.get('user_tokens', {});
  const origApproved = db.get('links_approved', {});
  const hubs = [];
  try {
    // ---- Hub A: owner has a token (happy + wrong-token) ----
    db.set('links_approved', { ...origApproved, [OWNER]: [BOT] });
    db.set('user_tokens', { ...origTokens, [OWNER]: TOK });
    const a = startHub();
    hubs.push(a);
    await waitPort();

    const happy = await authAttempt({ type: 'auth', token: TOK }, 3000);
    check('happy: correct token keeps socket open', happy.opened && !happy.closed,
      `closed=${happy.closed} elapsed=${happy.elapsed}ms`);
    check('happy: hub logs авторизован', a.state.out.includes('авторизован'));

    const wrong = await authAttempt({ type: 'auth', token: 'WRONG-TOKEN' }, 3000);
    check('wrong: wrong token closes socket', wrong.opened && wrong.closed,
      `closed=${wrong.closed} elapsed=${wrong.elapsed}ms`);
    check('wrong: no [AUTH DEBUG] token line printed', !a.state.out.includes('[AUTH DEBUG]'));

    killHub(a.proc);
    await sleep(400);

    // ---- Hub B: owner has NO token -> tokenless auth must not authenticate ----
    db.set('user_tokens', {});
    const b = startHub();
    hubs.push(b);
    await waitPort();

    const bypass = await authAttempt({ type: 'auth' }, 6000);
    check('failure: tokenless auth CLOSES socket (bypass closed)', bypass.opened && bypass.closed,
      `closed=${bypass.closed} elapsed=${bypass.elapsed}ms`);
    check('failure: tokenless auth does NOT log авторизован', !b.state.out.includes('авторизован'));
    check('failure: no [AUTH DEBUG] token line printed', !b.state.out.includes('[AUTH DEBUG]'));

    console.log('--- hub log: tokenless attempt ---');
    console.log(b.state.out.trim());

    killHub(b.proc);
    await sleep(400);

    // ---- T7: token travels only in the auth message, never in the WS URL ----
    const src = fs.readFileSync(BOT_SRC, 'utf8');
    const urlLine = (src.match(/const url = base \? [^;]+;/) || [])[0];
    check('source: connectToHub URL template found', !!urlLine, urlLine);
    check('source: URL template has ?bot=', !!urlLine && urlLine.includes('?bot='));
    check('source: URL template has NO token=', !!urlLine && !urlLine.includes('token='),
      urlLine);

    db.set('links_approved', { ...origApproved, [OWNER]: [BOT, BOT7] });
    db.set('user_tokens', { ...origTokens, [OWNER]: TOK7 });
    const c = startHub();
    hubs.push(c);
    await waitPort();

    const noUrlToken = await authAttempt({ type: 'auth', token: TOK7 }, 3000, `?bot=${BOT7}`);
    check('t7 happy: URL without token authorizes via auth message',
      noUrlToken.opened && !noUrlToken.closed,
      `opened=${noUrlToken.opened} closed=${noUrlToken.closed} elapsed=${noUrlToken.elapsed}ms`);
    check('t7 happy: hub logs авторизован', c.state.out.includes('авторизован'));

    const junkQueryToken = await authAttempt({ type: 'auth', token: TOK7 }, 3000,
      `?bot=${BOT7}&token=junk`);
    check('t7 ignored: junk ?token= in URL still authorizes (query token unused)',
      junkQueryToken.opened && !junkQueryToken.closed,
      `opened=${junkQueryToken.opened} closed=${junkQueryToken.closed} elapsed=${junkQueryToken.elapsed}ms`);
    check('t7: no token value in hub stdout', !c.state.out.includes(TOK7));

    console.log('--- hub log: T7 URL token cases ---');
    console.log(c.state.out.trim());

    killHub(c.proc);
    await sleep(400);
  } finally {
    for (const h of hubs) killHub(h.proc);
    db.set('user_tokens', origTokens);
    db.set('links_approved', origApproved);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(failed === 0 ? '--- All tests passed ---' : `--- ${failed} test(s) failed ---`);
  process.exit(failed === 0 ? 0 : 1);
})();
