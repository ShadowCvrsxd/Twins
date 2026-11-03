// T-main-idle: hub socket must outlive the mineflayer bot. Assert-only, no framework.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { failures++; console.log(`FAIL ${name}: ${e.message}`); }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'bot-base.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'bot-main.js'), 'utf8');

console.log('--- hub socket independent of bot instance ---');
check('no hubSocketBot state anywhere', () => {
  assert.ok(!src.includes('hubSocketBot'), 'hubSocketBot must be fully removed');
});
check('no connectToHub(botInstance) parameter', () => {
  assert.ok(!/function\s+connectToHub\s*\(\s*botInstance\s*\)/.test(src), 'connectToHub must take no botInstance');
});
check('no connectToHub(botInstance) call', () => {
  assert.ok(!/connectToHub\s*\(\s*botInstance\s*\)/.test(src), 'connectToHub must be called with no argument');
});
check('function connectToHub() exists', () => {
  assert.ok(/function\s+connectToHub\s*\(\s*\)/.test(src), 'connectToHub() present');
});
check('connectToHub must not early-return without a bot', () => {
  const body = src.match(/function\s+connectToHub\s*\(\s*\)\s*\{([\s\S]*?)\n    const botName/);
  assert.ok(body, 'connectToHub body up to const botName found');
  assert.ok(!/if\s*\(\s*!\s*(?:bot|botInstance)\s*\)\s*return/.test(body[1]), 'connectToHub must not early-return without a bot');
});

console.log('--- idle-safe command handlers ---');
check('dropAll calls handleDropAll(bot, chatId)', () => {
  assert.ok(/handleDropAll\s*\(\s*bot\s*,/.test(src), 'handleDropAll(bot, ...) present');
});
check('stoptwin guarded by a live-bot check', () => {
  const block = src.match(/command\.action\s*===\s*'stoptwin'[\s\S]{0,400}/);
  assert.ok(block, "stoptwin branch present");
  assert.ok(/if\s*\(\s*bot\s*\)[\s\S]{0,200}?bot\.quit\s*\(/.test(block[0]), 'stoptwin does if (bot) { ... bot.quit() }');
  assert.ok(!/botInstance\s*\.\s*quit/.test(block[0]), 'stoptwin must not dereference a captured instance');
});
check('setAutoClick guards on enabled && bot and never starts with null', () => {
  const block = src.match(/command\.action\s*===\s*'setAutoClick'[\s\S]{0,900}/);
  assert.ok(block, 'setAutoClick branch present');
  assert.ok(/if\s*\(\s*enabled\s*&&\s*bot\s*\)[\s\S]{0,160}?startAutoClick\s*\(\s*bot\s*\)/.test(block[0]), 'startAutoClick only when enabled && bot');
  assert.ok(!/startAutoClick\s*\(\s*null\s*\)/.test(src), 'never calls startAutoClick(null)');
});
check('processChatQueue guards on a live bot', () => {
  const body = src.match(/function\s+processChatQueue\s*\(\s*\)\s*\{[\s\S]{0,400}/);
  assert.ok(body, 'processChatQueue present');
  assert.ok(/if\s*\(\s*!\s*bot\s*\)\s*return/.test(body[0]), 'processChatQueue contains if (!bot) return');
});
check('chat branch guards on a live bot', () => {
  const block = src.match(/command\.action\s*===\s*'chat'[\s\S]{0,400}/);
  assert.ok(block, 'chat branch present');
  assert.ok(/if\s*\(\s*!\s*bot\s*\)[\s\S]{0,200}?sendToHub\s*\(/.test(block[0]), 'chat replies when no bot');
});
check('players branch guards on a live bot', () => {
  const block = src.match(/command\.action\s*===\s*'players'[\s\S]{0,400}/);
  assert.ok(block, 'players branch present');
  assert.ok(/if\s*\(\s*!\s*bot\s*\)[\s\S]{0,200}?sendToHub\s*\(/.test(block[0]), 'players replies when no bot');
});
check('pos branch guards on bot.entity', () => {
  const block = src.match(/command\.action\s*===\s*'pos'[\s\S]{0,300}/);
  assert.ok(block, 'pos branch present');
  assert.ok(/if\s*\(\s*bot\s*&&\s*bot\.entity/.test(block[0]), 'pos requires bot and bot.entity');
});

console.log('--- idle start: third startOptions argument ---');
check('startBot signature accepts startOptions = {}', () => {
  assert.ok(/function\s+startBot\s*\(\s*envPath\s*,\s*configOverrides\s*,\s*startOptions\s*=\s*\{\}\s*\)/.test(src), 'startBot(envPath, configOverrides, startOptions = {})');
});
check('startOptions is not merged into mineflayer config', () => {
  assert.ok(!/\.\.\.startOptions/.test(src), 'startOptions must not be spread into config');
});
check('idle branch calls connectToHub() instead of createBotInstance()', () => {
  const idle = src.match(/if\s*\(\s*startOptions\.autoConnect\s*===\s*false\s*\)\s*\{([\s\S]{0,300}?)\}\s*else\s*\{/);
  assert.ok(idle, 'autoConnect === false branch present');
  assert.ok(/connectToHub\s*\(\s*\)/.test(idle[1]), 'idle branch calls connectToHub()');
  assert.ok(!/createBotInstance\s*\(\s*\)/.test(idle[1]), 'idle branch must not create a bot');
  const elseBlock = src.match(/\}\s*else\s*\{\s*createBotInstance\s*\(\s*\)\s*;\s*\}/);
  assert.ok(elseBlock, 'else branch creates the bot');
});
check('bot-main.js passes { autoConnect: false }', () => {
  assert.ok(/autoConnect\s*:\s*false/.test(mainSrc), 'bot-main.js must opt out of autoConnect');
  assert.ok(/startBot\s*\(\s*envMainPath\s*,[\s\S]{0,400}\{\s*autoConnect\s*:\s*false\s*\}\s*\)/.test(mainSrc), 'third argument on startBot call');
});

console.log('--- scheduler: skip idle reconnect ---');
check('scheduler captures wasOnline before the 11:58 quit', () => {
  const block = src.match(/function\s+scheduleNextRestart\s*\(\s*\)\s*\{[\s\S]{0,1600}/);
  assert.ok(block, 'scheduleNextRestart present');
  const wasIdx = block[0].indexOf('wasOnline');
  const quitIdx = block[0].indexOf('isManualQuit = true;');
  assert.ok(wasIdx !== -1, 'wasOnline captured');
  assert.ok(quitIdx !== -1 && wasIdx < quitIdx, 'wasOnline must be captured before the quit');
  assert.ok(/const\s+wasOnline\s*=\s*!!\s*bot\s*;/.test(block[0]), 'const wasOnline = !!bot');
});
check('scheduler guard reconnects only when wasOnline or autoConnect', () => {
  const block = src.match(/function\s+scheduleNextRestart\s*\(\s*\)\s*\{[\s\S]{0,1600}/);
  assert.ok(/const\s+shouldReconnect\s*=\s*wasOnline\s*\|\|\s*startOptions\.autoConnect\s*!==\s*false\s*;/.test(block[0]), 'shouldReconnect = wasOnline || startOptions.autoConnect !== false');
  assert.ok(/if\s*\(\s*shouldReconnect\s*\)\s*\{[\s\S]{0,80}?createBotInstance\s*\(\s*\)/.test(block[0]), 'createBotInstance only when shouldReconnect');
  assert.ok(/\[Scheduler\]\s*main idle[^\n]*reconnect skipped/.test(block[0]), 'logs idle reconnect skip');
});

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
