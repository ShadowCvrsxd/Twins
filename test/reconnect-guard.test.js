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

console.log('--- bot-independent hub socket ---');
check('source: connectToHub() takes no bot instance, no hubSocketBot, close clears only hubSocket', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bot-base.js'), 'utf8');
  assert.ok(/function connectToHub\s*\(\s*\)/.test(src), 'connectToHub has no parameter');
  assert.ok(!/function connectToHub\s*\(\s*botInstance\s*\)/.test(src), 'connectToHub parameter removed');
  assert.ok(!src.includes('hubSocketBot'), 'no hubSocketBot state remains');
  const connBlock = src.match(/function connectToHub[\s\S]*?\n    const botName/)[0];
  assert.ok(/readyState === WebSocket\.(OPEN|CONNECTING)/.test(connBlock), 'connectToHub reuses OPEN/CONNECTING socket');
  assert.ok(!/botInstance/.test(connBlock), 'connectToHub does not bind to a bot instance');
  const closeBlock = src.match(/ws\.on\('close'[\s\S]*?\n    \}\);/)[0];
  assert.ok(/if \(hubSocket === ws\) hubSocket = null;/.test(closeBlock), 'close clears only hubSocket');
  assert.ok(!closeBlock.includes('hubSocketBot'), 'close does not touch hubSocketBot');
});
check('logic simulation: no-arg OPEN/CONNECTING reuse; closed socket replaced; close clears hubSocket', () => {
  // Honest model of connectToHub's reuse branch (connectToHub itself is closure-bound).
  const OPEN = 1, CONNECTING = 0, CLOSED = 3;
  let created = 0, closed = 0;
  let hubSocket = null;
  const makeSocket = () => { created++; return { readyState: OPEN, close() { this.readyState = CLOSED; closed++; } }; };
  const connect = () => {
    if (hubSocket && (hubSocket.readyState === OPEN || hubSocket.readyState === CONNECTING)) return hubSocket;
    const ws = makeSocket();
    hubSocket = ws;
    return ws;
  };

  const s1 = connect();
  assert.strictEqual(created, 1, 'first connect creates 1 socket');
  assert.strictEqual(connect(), s1, 'OPEN socket is reused without a bot instance');
  assert.strictEqual(created, 1, 'reuse does not create a new socket');

  s1.readyState = CONNECTING;
  assert.strictEqual(connect(), s1, 'CONNECTING socket is reused');
  s1.readyState = CLOSED;

  const s2 = connect();
  assert.notStrictEqual(s2, s1, 'closed socket is not reused');
  assert.strictEqual(created, 2, 'fresh socket created after close');

  if (hubSocket === s2) hubSocket = null;
  assert.strictEqual(hubSocket, null, 'close handler clears only hubSocket');
  assert.strictEqual(closed, 0, 'no socket is force-closed for a stale bot instance');
});

console.log('\nNOTE: live fake-ws process smoke NOT reachable: connectToHub lives inside the startBot closure and needs a mineflayer botInstance + dotenv env; the guard unit + state-machine + source-wiring assertions above are the evidence.');

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
