const assert = require('node:assert');
const { shouldSend, forwardResponse, applyBotStatus, relayChatToTelegram } = require('../utils');

// --- Mocks ---
const store = { bots_status: {} };
const get = (k, d) => store[k] ?? d;
const set = (k, v) => { store[k] = v; };
const calls = [];
const sendChatMessage = (...a) => calls.push(a);
const getBotDisplayName = (o, b) => b;
const cleanMinecraftText = (t) => (t || '').trim();
const getMainAccount = () => 'main';
const getTwinks = () => [];

// --- Tests ---

// (a) shouldSend
assert.strictEqual(shouldSend({ readyState: 1 }), true);
assert.strictEqual(shouldSend(null), false);
assert.strictEqual(shouldSend(undefined), false);
assert.strictEqual(shouldSend({ readyState: 0 }), false);
assert.strictEqual(shouldSend({ readyState: 3 }), false);
console.log('✓ shouldSend passed');

// (b) relayChatToTelegram
// Streaming ON
store.chat_streaming = { chat1: { bot1: true } };
calls.length = 0;
relayChatToTelegram({ ownerId: 'chat1', botName: 'bot1', text: 'hello' }, { get, set, sendChatMessage, getBotDisplayName, cleanMinecraftText, getMainAccount, getTwinks });
assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0][0], 'chat1');
assert.strictEqual(calls[0][1], '💬 [bot1] hello');

// Streaming OFF
store.chat_streaming = { chat1: { bot1: false } };
calls.length = 0;
relayChatToTelegram({ ownerId: 'chat1', botName: 'bot1', text: 'hello' }, { get, set, sendChatMessage, getBotDisplayName, cleanMinecraftText, getMainAccount, getTwinks });
assert.strictEqual(calls.length, 0);

// Empty text
store.chat_streaming = { chat1: { bot1: true } };
calls.length = 0;
relayChatToTelegram({ ownerId: 'chat1', botName: 'bot1', text: '   ' }, { get, set, sendChatMessage, getBotDisplayName, cleanMinecraftText, getMainAccount, getTwinks });
assert.strictEqual(calls.length, 0);

// isMain path
store.main_chat_streaming = { chat1: true };
store.main_chat_stream_all = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
calls.length = 0;
relayChatToTelegram({ isMain: true, text: 'main msg' }, { get, set, sendChatMessage, getBotDisplayName, cleanMinecraftText, getMainAccount, getTwinks });
assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0][0], 'chat1');
assert.strictEqual(calls[0][1], '💬 [мейн] main msg');
console.log('✓ relayChatToTelegram passed');

// (c) forwardResponse
const sendMessageCalls = [];
const sendMessage = (...a) => sendMessageCalls.push(a);
forwardResponse({ type: 'response', text: 'hi', chatId: 'c9' }, null, { sendMessage });
assert.strictEqual(sendMessageCalls.length, 1);
assert.deepStrictEqual(sendMessageCalls[0], ['c9', 'hi', null]);

sendMessageCalls.length = 0;
forwardResponse({ type: 'response', text: 'hi' }, { ownerId: 'c7' }, { sendMessage });
assert.strictEqual(sendMessageCalls.length, 1);
assert.deepStrictEqual(sendMessageCalls[0], ['c7', 'hi', null]);

sendMessageCalls.length = 0;
const res = forwardResponse({ type: 'response' }, null, { sendMessage });
assert.strictEqual(res, false);
assert.strictEqual(sendMessageCalls.length, 0);
console.log('✓ forwardResponse passed');

// (d) applyBotStatus
store.bots_status = {};
applyBotStatus({ online: true }, { botName: 'bot1' }, { get, set });
assert.strictEqual(store.bots_status.bot1.online, true);

applyBotStatus({ online: false }, { botName: 'bot1' }, { get, set });
assert.strictEqual(store.bots_status.bot1.online, false);
console.log('✓ applyBotStatus passed');

// (e) twin chat failover
store.links_approved = { chat1: ['bot1', 'bot2'], chat2: ['bot1', 'bot2'] };
const relayDeps = { get, set, sendChatMessage, getBotDisplayName, cleanMinecraftText, getMainAccount, getTwinks };

// 1. designated twin online, its own flag on
store.chat_streaming = { chat2: { bot1: true } };
store.bots_status = { bot1: { online: true } };
calls.length = 0;
relayChatToTelegram({ ownerId: 'chat2', botName: 'bot1', text: 'hello' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0][1], '💬 [bot1] hello');

// 2. designated twin offline -> approved sender takes over
store.chat_streaming = { chat2: { bot1: true } };
store.bots_status = { bot1: { online: false } };
calls.length = 0;
relayChatToTelegram({ ownerId: 'chat2', botName: 'bot2', text: 'hello' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0][1], '💬 [bot2] hello');

// 3. designated twin online -> no failover
store.chat_streaming = { chat2: { bot1: true } };
store.bots_status = { bot1: { online: true } };
calls.length = 0;
relayChatToTelegram({ ownerId: 'chat2', botName: 'bot2', text: 'hello' }, relayDeps);
assert.strictEqual(calls.length, 0);

// 4. nobody streams -> no failover
store.chat_streaming = { chat2: { bot1: false, bot2: false } };
store.bots_status = { bot1: { online: false } };
calls.length = 0;
relayChatToTelegram({ ownerId: 'chat2', botName: 'bot2', text: 'hello' }, relayDeps);
assert.strictEqual(calls.length, 0);

// 5. unapproved sender -> no failover
store.chat_streaming = { chat2: { bot1: true } };
store.bots_status = { bot1: { online: false } };
calls.length = 0;
relayChatToTelegram({ ownerId: 'chat2', botName: 'bot3', text: 'hello' }, relayDeps);
assert.strictEqual(calls.length, 0);
console.log('✓ failover scenarios passed');

// 6. transition logging (fresh module = clean failover state)
delete require.cache[require.resolve('../utils')];
const freshUtils = require('../utils');
store.chat_streaming = { chat2: { bot1: true } };
store.bots_status = { bot1: { online: false } };
const logs = [];
const origLog = console.log;
console.log = (...a) => logs.push(a.join(' '));
try {
  calls.length = 0;
  for (let i = 0; i < 3; i++) {
    freshUtils.relayChatToTelegram({ ownerId: 'chat2', botName: 'bot2', text: 'hello' }, relayDeps);
  }
  assert.strictEqual(logs.filter(l => l.includes('дупликация переключена')).length, 1);
  assert.ok(logs.some(l => l.includes('переключена') && l.includes('bot1') && l.includes('bot2')));
  store.bots_status.bot1.online = true;
  logs.length = 0;
  freshUtils.relayChatToTelegram({ ownerId: 'chat2', botName: 'bot1', text: 'hello' }, relayDeps);
  assert.strictEqual(logs.filter(l => l.includes('дупликация вернулась')).length, 1);
  assert.ok(logs.some(l => l.includes('вернулась') && l.includes('bot1')));
} finally {
  console.log = origLog;
}
console.log('✓ failover transition logging passed');

console.log('--- All tests passed ---');
