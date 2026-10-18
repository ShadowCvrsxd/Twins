const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let failed = 0;
function assert(name, condition, msg) {
  if (!condition) {
    failed++;
    console.log(`FAIL ${name}: ${msg}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

const artifactsDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });

// 1. No tokens at all (set to empty string so dotenv.config() doesn't load them from .env)
const res1 = spawnSync(process.execPath, [path.join(__dirname, '../tg-chat-bot.js')], {
  env: { ...process.env, TG_CHAT_BOT_TOKEN: '', TG_BOT_TOKEN: '', HUB_API_TOKEN: '' },
  encoding: 'utf8',
  timeout: 3000
});
const out1 = (res1.stdout || '') + (res1.stderr || '');
fs.writeFileSync(path.join(artifactsDir, 't12-no-token.txt'), out1);
assert('Case 1: No tokens exits 0', res1.status === 0, `status=${res1.status}`);
assert('Case 1: No tokens prints message', out1.includes('TG_CHAT_BOT_TOKEN не задан'), `output=${JSON.stringify(out1)}`);

// 2. Only TG_BOT_TOKEN=B (TG_CHAT_BOT_TOKEN = '')
const res2 = spawnSync(process.execPath, [path.join(__dirname, '../tg-chat-bot.js')], {
  env: { ...process.env, TG_CHAT_BOT_TOKEN: '', TG_BOT_TOKEN: 'B', HUB_API_TOKEN: '' },
  encoding: 'utf8',
  timeout: 3000
});
const out2 = (res2.stdout || '') + (res2.stderr || '');
fs.writeFileSync(path.join(artifactsDir, 't12-no-token.txt'), out1 + '\n---\n' + out2);
assert('Case 2: TG_BOT_TOKEN alone exits 0', res2.status === 0, `status=${res2.status}`);
assert('Case 2: TG_BOT_TOKEN alone prints message (fallback removed)', out2.includes('TG_CHAT_BOT_TOKEN не задан'), `output=${JSON.stringify(out2)}`);

// 3. Only TG_CHAT_BOT_TOKEN=A
const res3 = spawnSync(process.execPath, [path.join(__dirname, '../tg-chat-bot.js')], {
  env: { ...process.env, TG_CHAT_BOT_TOKEN: 'A', TG_BOT_TOKEN: '', HUB_API_TOKEN: 'hubTok' },
  encoding: 'utf8',
  timeout: 1000
});
const out3 = (res3.stdout || '') + (res3.stderr || '');
fs.writeFileSync(path.join(artifactsDir, 't12-separate.txt'), out3);
assert('Case 3: TG_CHAT_BOT_TOKEN present does not print unconfigured message', !out3.includes('TG_CHAT_BOT_TOKEN не задан'), `output=${JSON.stringify(out3)}`);

// 4. Source code assertion
const source = fs.readFileSync(path.join(__dirname, '../tg-chat-bot.js'), 'utf8');
const tokenLineMatch = source.match(/const TOKEN = [^\n]+/);
assert('Case 4: TOKEN assignment exists', !!tokenLineMatch, 'TOKEN line found');
if (tokenLineMatch) {
  const line = tokenLineMatch[0];
  assert('Case 4: TOKEN uses TG_CHAT_BOT_TOKEN', line.includes('TG_CHAT_BOT_TOKEN'), `line=${line}`);
  assert('Case 4: TOKEN does NOT use TG_BOT_TOKEN', !line.includes('TG_BOT_TOKEN'), `line=${line}`);
}

console.log(failed === 0 ? '--- All tests passed ---' : `--- ${failed} test(s) failed ---`);
process.exit(failed === 0 ? 0 : 1);
