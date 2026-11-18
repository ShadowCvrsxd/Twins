// T1: chat authz — three pure helpers.
const { isBotOwnedByChat, isChatSenderAllowed, evictBotSocket } = require('../hub-util');

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// isBotOwnedByChat - approved/mainsApproved are { chatId: [botNames] }
check('owned twin in approved', isBotOwnedByChat({ victim: ['MyBot'] }, {}, 'victim', 'MyBot'), true);
check('owned twin in mainsApproved', isBotOwnedByChat({}, { victim: ['MainBot'] }, 'victim', 'MainBot'), true);
check('foreign bot not in either map', isBotOwnedByChat({ other: ['victim'] }, {}, 'me', 'victim'), false);
check('case-insensitive match', isBotOwnedByChat({ victim: ['MYBOT'] }, {}, 'victim', 'mybot'), true);
check('missing chat key returns false', isBotOwnedByChat({}, {}, 'victim', 'bot'), false);
check('undefined approved but mainsApproved has bot -> true', isBotOwnedByChat(undefined, { victim: ['bot'] }, 'victim', 'bot'), true);
check('undefined mainsApproved but approved has bot -> true', isBotOwnedByChat({ victim: ['bot'] }, undefined, 'victim', 'bot'), true);
check('both maps undefined returns false', isBotOwnedByChat(undefined, undefined, 'victim', 'bot'), false);
check('botName undefined returns false', isBotOwnedByChat({ victim: ['bot'] }, {}, 'victim', undefined), false);

// isChatSenderAllowed
check('empty selectedLower allowed', isChatSenderAllowed(['victim'], '', { isAdminChat: false, mainAccount: 'owner' }), true);
check('empty selectedLower allowed (undefined)', isChatSenderAllowed(['victim'], undefined, { isAdminChat: false, mainAccount: 'owner' }), true);
check('selectedLower in userBots case-insensitive', isChatSenderAllowed(['VICTIM'], 'victim', { isAdminChat: false, mainAccount: 'owner' }), true);
check('attacker not in userBots denied', isChatSenderAllowed(['victim'], 'attacker', { isAdminChat: false, mainAccount: 'owner' }), false);
check('admin chat with mainAccount allowed', isChatSenderAllowed([], 'owner', { isAdminChat: true, mainAccount: 'owner' }), true);
check('admin chat with different mainAccount denied', isChatSenderAllowed([], 'owner', { isAdminChat: true, mainAccount: 'other' }), false);
check('non-admin chat with mainAccount denied', isChatSenderAllowed([], 'owner', { isAdminChat: false, mainAccount: 'owner' }), false);
check('userBots undefined treated as empty', isChatSenderAllowed(undefined, 'owner', { isAdminChat: true, mainAccount: 'owner' }), true);
check('options undefined safe', isChatSenderAllowed(['bot'], 'bot', undefined), true);
check('mainAccount case-insensitive', isChatSenderAllowed([], 'OWNER', { isAdminChat: true, mainAccount: 'owner' }), true);

// evictBotSocket
check('eviction deletes then closes', (() => {
  const calls = [];
  const clients = new Map([['victim', {}]]);
  const socket = { close: () => calls.push('close') };
  const res = evictBotSocket(clients, socket, 'victim');
  return res === true && calls[0] === 'close' && !clients.has('victim');
})(), true);
check('eviction absent is no-op', (() => {
  const calls = [];
  const clients = new Map([['other', {}]]);
  const socket = { close: () => calls.push('close') };
  const res = evictBotSocket(clients, socket, 'victim');
  return res === false && calls.length === 0 && clients.has('other');
})(), true);
check('eviction with no socket still deletes', (() => {
  const clients = new Map([['victim', {}]]);
  const res = evictBotSocket(clients, null, 'victim');
  return res === true && !clients.has('victim');
})(), true);
check('eviction with undefined socket still deletes', (() => {
  const clients = new Map([['victim', {}]]);
  const res = evictBotSocket(clients, undefined, 'victim');
  return res === true && !clients.has('victim');
})(), true);
check('botName undefined returns false', (() => {
  const clients = new Map([['victim', {}]]);
  const res = evictBotSocket(clients, {}, undefined);
  return res === false && clients.has('victim');
})(), true);
check('clients missing get returns false', (() => {
  const res = evictBotSocket({}, {}, 'victim');
  return res === false;
})(), true);

const fs = require('fs');

const readme = fs.readFileSync('README.md', 'utf8');
const hubJs = fs.readFileSync('tg-hub.js', 'utf8');

check('README: no setserver string', readme.includes('setserver'), false);
check('README: no setservice string', readme.includes('setservice'), false);
check('README: /setchat row updated', readme.includes('Select the sender bot (/setchat <1|2|main>)'), true);
check('README: ADMIN_TG_ID for both hub and chat bot', readme.includes('read by BOTH the hub and the chat bot'), true);

check('tg-hub.js: no setserver in menu', hubJs.includes('setserver'), false);
check('tg-hub.js: no setservice in menu', hubJs.includes('setservice'), false);
check('tg-hub.js: no setserver in admin panel text', hubJs.includes('/setserver <ip> <port>'), false);

console.log(failed === 0 ? '--- All tests passed ---' : `--- ${failed} test(s) failed ---`);
process.exit(failed === 0 ? 0 : 1);