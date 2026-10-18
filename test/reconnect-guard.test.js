// T10: WS reconnect guard + auto-clicker teardown. Assert-only, no framework.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { failures++; console.log(`FAIL ${name}: ${e.message}`); }
}

// Isolate the DB before requiring bot-base (which requires db.js).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't10-'));
process.env.DB_PATH = path.join(tmp, 't10.db');
process.env.DB_JSON_PATH = path.join(tmp, 't10.json');

const { shouldScheduleReconnect } = require('../hub-util.js');

console.log('--- unit: shouldScheduleReconnect ---');
check('close + not manual + not scheduled + no open socket -> true', () => {
  assert.strictEqual(shouldScheduleReconnect({ hubSocketState: null, hasOpenSocket: false, isManualQuit: false, reconnectScheduled: false }), true);
});
check('reconnectScheduled -> false', () => {
  assert.strictEqual(shouldScheduleReconnect({ hubSocketState: null, hasOpenSocket: false, isManualQuit: false, reconnectScheduled: true }), false);
});
check('isManualQuit -> false', () => {
  assert.strictEqual(shouldScheduleReconnect({ hubSocketState: null, hasOpenSocket: false, isManualQuit: true, reconnectScheduled: false }), false);
});
check('hasOpenSocket -> false', () => {
  assert.strictEqual(shouldScheduleReconnect({ hubSocketState: 1, hasOpenSocket: true, isManualQuit: false, reconnectScheduled: false }), false);
});
check('hubSocketState OPEN (1) -> false', () => {
  assert.strictEqual(shouldScheduleReconnect({ hubSocketState: 1, hasOpenSocket: false, isManualQuit: false, reconnectScheduled: false }), false);
});
check('hubSocketState CONNECTING (0) -> false', () => {
  assert.strictEqual(shouldScheduleReconnect({ hubSocketState: 0, hasOpenSocket: false, isManualQuit: false, reconnectScheduled: false }), false);
});
check('hubSocketState CLOSED (3) -> true', () => {
  assert.strictEqual(shouldScheduleReconnect({ hubSocketState: 3, hasOpenSocket: false, isManualQuit: false, reconnectScheduled: false }), true);
});

console.log('--- no-ReferenceError: require bot-base without startBot ---');
check("require('./bot-base') + stopAutoClick() -> getAutoClickTimer() === null", () => {
  const base = require('../bot-base.js');
  assert.strictEqual(typeof base.stopAutoClick, 'function', 'stopAutoClick exported');
  assert.strictEqual(typeof base.getAutoClickTimer, 'function', 'getAutoClickTimer exported');
  base.stopAutoClick();
  assert.strictEqual(base.getAutoClickTimer(), null, 'timer must be null');
});

console.log('--- state machine: exactly one reschedule per break ---');
check('1st close schedules once; 2nd while scheduled schedules 0; open resets; later close schedules again', () => {
  const st = { isManualQuit: false, reconnectScheduled: false, hubSocketState: null };
  let schedules = 0;
  const onClose = () => {
    const hasOpenSocket = st.hubSocketState === 0 || st.hubSocketState === 1;
    if (shouldScheduleReconnect({ hubSocketState: st.hubSocketState, hasOpenSocket, isManualQuit: st.isManualQuit, reconnectScheduled: st.reconnectScheduled })) {
      schedules++;
      st.reconnectScheduled = true;
    }
  };
  const onOpen = () => { st.reconnectScheduled = false; st.hubSocketState = 1; };

  onClose();
  assert.strictEqual(schedules, 1, `after 1st close schedules=1, got ${schedules}`);
  onClose();
  assert.strictEqual(schedules, 1, `2nd close while scheduled must not schedule, got ${schedules}`);
  onOpen();
  st.hubSocketState = 3;
  onClose();
  assert.strictEqual(schedules, 2, `after open reset a later close schedules again, got ${schedules}`);
  console.log(`  state-machine schedules=${schedules} (1 then 0, then 1 after open)`);
});

console.log('--- source wiring ---');
check('close consults guard, open resets flag, end stops auto-click, connectToHub guards readyState', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bot-base.js'), 'utf8');
  const closeBlock = src.match(/ws\.on\('close'[\s\S]*?\n    \}\);/)[0];
  assert.ok(closeBlock.includes('shouldScheduleReconnect'), 'close handler consults shouldScheduleReconnect');
  const openBlock = src.match(/ws\.on\('open'[\s\S]*?\n    \}\);/)[0];
  assert.ok(openBlock.includes('reconnectScheduled = false'), 'open handler resets reconnectScheduled');
  const endBlock = src.match(/bot\.on\('end'[\s\S]*?\n    \}\);/)[0];
  assert.ok(endBlock.includes('stopAutoClick()'), 'bot.on(end) calls stopAutoClick()');
  const connBlock = src.match(/function connectToHub[\s\S]*?const url =/)[0];
  assert.ok(/readyState === WebSocket\.(OPEN|CONNECTING)/.test(connBlock), 'connectToHub guards OPEN/CONNECTING');
});

console.log('--- stale-instance rebind ---');
check('source: connectToHub rebinds hubSocketBot (compare + set + clear), close clears it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bot-base.js'), 'utf8');
  const conn = src.match(/function connectToHub[\s\S]*?hubSocketBot = botInstance;/)[0];
  assert.ok(conn.includes('hubSocketBot === botInstance'), 'reuse branch compares hubSocketBot === botInstance');
  assert.ok(conn.includes('hubSocketBot = botInstance'), 'connectToHub binds hubSocketBot on create');
  assert.ok(conn.includes('hubSocketBot = null'), 'connectToHub clears stale hubSocketBot');
  const closeBlock = src.match(/ws\.on\('close'[\s\S]*?\n    \}\);/)[0];
  assert.ok(/if \(hubSocket === ws\) \{ hubSocket = null; hubSocketBot = null; \}/.test(closeBlock), 'close handler clears hubSocketBot');
});
check('logic simulation: same-instance OPEN reuses; stale instance closes+recreates; close clears hubSocketBot', () => {
  // Honest model of connectToHub's rebind branch (connectToHub itself is closure-bound).
  const OPEN = 1, CLOSED = 3;
  let created = 0, closed = 0;
  let hubSocket = null, hubSocketBot = null;
  const makeSocket = () => { created++; return { readyState: OPEN, close() { this.readyState = CLOSED; closed++; } }; };
  const connect = (botInstance) => {
    if (hubSocket && (hubSocket.readyState === OPEN || hubSocket.readyState === 0)) {
      if (hubSocketBot === botInstance) return hubSocket;
      try { hubSocket.close(); } catch (e) {}
      hubSocket = null; hubSocketBot = null;
    }
    const ws = makeSocket();
    hubSocket = ws; hubSocketBot = botInstance;
    return ws;
  };
  const botA = { name: 'A' }, botB = { name: 'B' };

  const s1 = connect(botA);
  assert.strictEqual(created, 1, 'first connect creates 1 socket');
  assert.strictEqual(connect(botA), s1, 'same instance + OPEN reuses the socket');
  assert.strictEqual(created, 1, 'same-instance reuse does not create a new socket');

  const s2 = connect(botB);
  assert.notStrictEqual(s2, s1, 'stale instance does NOT reuse');
  assert.strictEqual(closed, 1, 'stale socket was closed');
  assert.strictEqual(created, 2, 'fresh socket created for new instance');
  assert.strictEqual(hubSocketBot, botB, 'hubSocketBot rebound to new instance');

  if (hubSocket === s2) { hubSocket = null; hubSocketBot = null; }
  assert.strictEqual(hubSocketBot, null, 'close handler clears hubSocketBot');
});

console.log('\nNOTE: live fake-ws process smoke NOT reachable: connectToHub lives inside the startBot closure and needs a mineflayer botInstance + dotenv env; the guard unit + state-machine + source-wiring assertions above are the evidence.');

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
