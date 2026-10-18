const assert = require('node:assert');
const { shouldSend, forwardResponse, applyBotStatus, relayChatToTelegram } = require('../utils');

// --- Mocks ---
const store = { bots_status: {} };
const get = (k, d) => store[k] ?? d;
const set = (k, v) => { store[k] = v; };
const calls = [];
const sendChatMessage = (...a) => calls.push(a);
const getBotDisplayName = () => 'bot1';
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

console.log('--- All tests passed ---');
