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

// (f) main-stream twin filter and DM pings
const resetStore = () => {
  for (const k of ['main_chat_streaming', 'main_chat_stream_all', 'links_approved', 'mains_approved', 'chat_streaming', 'tg_users', 'bots_status']) delete store[k];
  calls.length = 0;
};

// 1. streamAll on, no twin flag -> one plain call
resetStore();
store.main_chat_streaming = { chat1: true };
store.main_chat_stream_all = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
relayChatToTelegram({ isMain: true, text: '| bot1 › hi' }, relayDeps);
assert.deepStrictEqual(calls, [['chat1', '💬 [мейн] | bot1 › hi', null]]);

// 2. streamAll on, sender's own twin flag on -> no call
resetStore();
store.main_chat_streaming = { chat1: true };
store.main_chat_stream_all = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
store.chat_streaming = { chat1: { bot1: true } };
relayChatToTelegram({ isMain: true, text: '| bot1 › hi' }, relayDeps);
assert.strictEqual(calls.length, 0);

// 3. mentions-only, twin stream on -> no call
resetStore();
store.main_chat_streaming = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
store.chat_streaming = { chat1: { bot1: true } };
relayChatToTelegram({ isMain: true, text: '| bot1 › main hi' }, relayDeps);
assert.strictEqual(calls.length, 0);

// 4. mentions-only, twin stream off -> one call
resetStore();
store.main_chat_streaming = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
store.chat_streaming = {};
relayChatToTelegram({ isMain: true, text: '| bot1 › main hi' }, relayDeps);
assert.strictEqual(calls.length, 1);

// 5. failover carrier: designated twin offline but streaming -> sender copy not duplicated
resetStore();
store.main_chat_streaming = { chat1: true };
store.main_chat_stream_all = { chat1: true };
store.links_approved = { chat1: ['bot1', 'bot2'] };
store.chat_streaming = { chat1: { bot1: true } };
store.bots_status = { bot1: { online: false } };
relayChatToTelegram({ isMain: true, text: '| bot2 › hi' }, relayDeps);
assert.strictEqual(calls.length, 0);

// 6. main sender is exempt -> one call
resetStore();
store.main_chat_streaming = { chat1: true };
store.main_chat_stream_all = { chat1: true };
store.links_approved = { chat1: ['main'] };
relayChatToTelegram({ isMain: true, text: '| main › hi' }, relayDeps);
assert.strictEqual(calls.length, 1);

// 7. twin copy already delivered in chat2 -> only chat1 gets the line
resetStore();
store.main_chat_streaming = { chat1: true, chat2: true };
store.main_chat_stream_all = { chat1: true, chat2: true };
store.links_approved = { chat1: ['bot1'], chat2: ['bot1'] };
store.chat_streaming = { chat2: { bot1: true } };
relayChatToTelegram({ isMain: true, text: '| bot1 › hi' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0][0], 'chat1');

// 8. incoming DM with username -> mention, plain mode
resetStore();
store.main_chat_streaming = { chat1: true };
store.main_chat_stream_all = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
store.tg_users = { chat1: { id: 42, username: 'owner', firstName: 'O' } };
relayChatToTelegram({ isMain: true, text: '✉️ |  serphut › main › hi' }, relayDeps);
assert.deepStrictEqual(calls, [['chat1', '💬 [мейн] @owner ✉️ |  serphut › main › hi', null]]);

// 9. incoming DM without username -> escaped HTML mention
resetStore();
store.main_chat_streaming = { chat1: true };
store.main_chat_stream_all = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
store.tg_users = { chat1: { id: 42, firstName: '<O&>' } };
relayChatToTelegram({ isMain: true, text: '✉️ | serphut › main › hi' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0][2], 'HTML');
assert.ok(calls[0][1].includes('<a href="tg://user?id=42">&lt;O&amp;&gt;</a>'));

// 10. outgoing DM -> no mention, plain mode
resetStore();
store.main_chat_streaming = { chat1: true };
store.main_chat_stream_all = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
store.tg_users = { chat1: { id: 42, username: 'owner', firstName: 'O' } };
relayChatToTelegram({ isMain: true, text: '✉️ | main › serphut › hi' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.ok(!calls[0][1].includes('@owner'));
assert.strictEqual(calls[0][2], null);

// 11. no tg_users -> private incoming DM mentions the chat owner via tg://
// (private chat: chat.id === user.id, so the positive chatId itself is the user id)
resetStore();
store.main_chat_streaming = { 123: true };
store.main_chat_stream_all = { 123: true };
store.links_approved = { 123: ['bot1'] };
relayChatToTelegram({ isMain: true, text: '✉️ | serphut › main › hi' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.ok(calls[0][1].includes('<a href="tg://user?id=123">владелец</a>'));
assert.strictEqual(calls[0][2], 'HTML');

// 12. public line containing ✉️ mid-text -> no mention
resetStore();
store.main_chat_streaming = { chat1: true };
store.main_chat_stream_all = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
store.tg_users = { chat1: { id: 42, username: 'owner', firstName: 'O' } };
relayChatToTelegram({ isMain: true, text: 'hi ✉️ there' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.ok(!calls[0][1].includes('@owner'));
assert.strictEqual(calls[0][2], null);

// 13. mentions-only mode still pings the owner on an incoming DM
resetStore();
store.main_chat_streaming = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
store.tg_users = { chat1: { id: 42, username: 'owner', firstName: 'O' } };
relayChatToTelegram({ isMain: true, text: '✉️ |  serphut › main › hi' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.ok(calls[0][1].includes('@owner'));

// 13a. no tg_users, group chat -> no fallback mention, plain mode
resetStore();
store.main_chat_streaming = { '-100123': true };
store.main_chat_stream_all = { '-100123': true };
store.links_approved = { '-100123': ['bot1'] };
relayChatToTelegram({ isMain: true, text: '✉️ | serphut › main › hi' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.ok(!calls[0][1].includes('tg://'));
assert.strictEqual(calls[0][2], null);

// 13b. no tg_users, private chat -> fallback link and text are HTML-escaped
resetStore();
store.main_chat_streaming = { 123: true };
store.main_chat_stream_all = { 123: true };
store.links_approved = { 123: ['bot1'] };
relayChatToTelegram({ isMain: true, text: '✉️ | serphut › main › <&>' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0][2], 'HTML');
assert.ok(calls[0][1].includes('<a href="tg://user?id=123">владелец</a>'));
assert.ok(calls[0][1].includes('&lt;&amp;&gt;'));

// 13c. no tg_users, mentions-only mode -> fallback mention still happens
resetStore();
store.main_chat_streaming = { 123: true };
store.links_approved = { 123: ['bot1'] };
relayChatToTelegram({ isMain: true, text: '✉️ | serphut › main › hi' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.ok(calls[0][1].includes('<a href="tg://user?id=123">владелец</a>'));

// 14. main all-stream on + twin stream on -> twin copy suppressed
resetStore();
store.main_chat_streaming = { chat1: true };
store.main_chat_stream_all = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
store.chat_streaming = { chat1: { bot1: true } };
relayChatToTelegram({ isMain: true, text: '| main › мяу' }, relayDeps);
relayChatToTelegram({ ownerId: 'chat1', botName: 'bot1', text: '| main › мяу' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.deepStrictEqual(calls[0], ['chat1', '💬 [мейн] | main › мяу', null]);

// 15. hidden display (empty prefix) still suppresses the twin copy
resetStore();
store.main_chat_streaming = { chat1: true };
store.main_chat_stream_all = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
store.chat_streaming = { chat1: { bot1: true } };
relayChatToTelegram({ isMain: true, text: '| main › мяу' }, relayDeps);
relayChatToTelegram({ ownerId: 'chat1', botName: 'bot1', text: '| main › мяу' }, { ...relayDeps, getBotDisplayName: () => '' });
assert.strictEqual(calls.length, 1);

// 16. mentions-only on + text mentions main -> twin copy suppressed
resetStore();
store.main_chat_streaming = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
store.chat_streaming = { chat1: { bot1: true } };
relayChatToTelegram({ isMain: true, text: '| main › main hi' }, relayDeps);
relayChatToTelegram({ ownerId: 'chat1', botName: 'bot1', text: '| main › main hi' }, relayDeps);
assert.strictEqual(calls.length, 1);

// 17. mentions-only on + text does not mention main -> main silent, twin delivers
resetStore();
store.main_chat_streaming = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
store.chat_streaming = { chat1: { bot1: true } };
relayChatToTelegram({ isMain: true, text: '| bot1 › hi' }, relayDeps);
assert.strictEqual(calls.length, 0);
relayChatToTelegram({ ownerId: 'chat1', botName: 'bot1', text: '| bot1 › hi' }, relayDeps);
assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0][1], '💬 [bot1] | bot1 › hi');

// 18. main stream off + twin stream on -> twin delivers
resetStore();
store.links_approved = { chat1: ['bot1'] };
store.chat_streaming = { chat1: { bot1: true } };
relayChatToTelegram({ ownerId: 'chat1', botName: 'bot1', text: '| main › hi' }, relayDeps);
assert.strictEqual(calls.length, 1);

// 19. two identical main calls -> two calls (no text cache)
resetStore();
store.main_chat_streaming = { chat1: true };
store.main_chat_stream_all = { chat1: true };
store.links_approved = { chat1: ['bot1'] };
relayChatToTelegram({ isMain: true, text: '| main › мяу' }, relayDeps);
relayChatToTelegram({ isMain: true, text: '| main › мяу' }, relayDeps);
assert.strictEqual(calls.length, 2);
console.log('✓ main-stream twin filter and DM pings passed');

console.log('--- All tests passed ---');
