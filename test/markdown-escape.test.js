// T1: pure escapeMarkdown for Telegram legacy-Markdown (parse_mode 'Markdown').
// Escapes ONLY _ * ` [ with a backslash. Does NOT escape backslash itself.
const { escapeMarkdown } = require('../hub-util');
const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

check('underscore', escapeMarkdown('dark_king'), 'dark\\_king');
check('mixed specials', escapeMarkdown('a*b_c[d]'), 'a\\*b\\_c\\[d\\]');
check('backtick', escapeMarkdown('a`b'), 'a\\`b');
check('null returns empty', escapeMarkdown(null), '');
check('number to string', escapeMarkdown(123), '123');
check('plain text unchanged', escapeMarkdown('plain'), 'plain');
check('backslash preserved', escapeMarkdown('a\\b'), 'a\\b');

// T2: static wiring assertions — confirm tg-chat-bot.js sendToGame-path lines use escapeMarkdown
const chatBotPath = path.resolve(__dirname, '../tg-chat-bot.js');
const chatBotSrc = fs.readFileSync(chatBotPath, 'utf8');

function checkSource(name, pattern, shouldExist, description) {
  const exists = pattern.test(chatBotSrc);
  const ok = shouldExist ? exists : !exists;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${description}`);
}

// Lines where raw *${...}* should be GONE (replaced with escapeMarkdown):
checkSource('nick escaped', /\*\$\{escapeMarkdown\(nick\)\}\*/, true, 'line ~347: *${escapeMarkdown(nick)}* present');
checkSource('nick raw gone', /\*\$\{nick\}\*/, false, 'line ~347: raw *${nick}* removed');

// sendToGame-path lines ~379, ~381, ~385: escape targetBot and text (confirmation only)
// Use context-specific patterns to avoid matching T3's /streamon|/streamoff lines
checkSource('targetBot escaped at 379', /Бот \*\$\{escapeMarkdown\(targetBot\)\}\* офлайн\./, true, 'line ~379: *${escapeMarkdown(targetBot)}* present');
checkSource('targetBot raw gone at 379', /Бот \*\$\{targetBot\}\* офлайн\./, false, 'line ~379: raw *${targetBot}* removed');

checkSource('targetBot escaped at 381', /Ошибка отправки сообщения боту \*\$\{escapeMarkdown\(targetBot\)\}\* \(статус/, true, 'line ~381: *${escapeMarkdown(targetBot)}* present');
checkSource('targetBot raw gone at 381', /Ошибка отправки сообщения боту \*\$\{targetBot\}\* \(статус/, false, 'line ~381: raw *${targetBot}* removed');

checkSource('targetBot escaped at 385', /Отправлено от \*\$\{escapeMarkdown\(targetBot\)\}\*/, true, 'line ~385: *${escapeMarkdown(targetBot)}* present');
checkSource('targetBot raw gone at 385', /Отправлено от \*\$\{targetBot\}\*/, false, 'line ~385: raw *${targetBot}* removed');
checkSource('text escaped at 385', /Отправлено от \*\$\{escapeMarkdown\(targetBot\)\}\*: \$\{escapeMarkdown\(text\)\}/, true, 'line ~385: ${escapeMarkdown(text)} present');
checkSource('text raw gone at 385', /Отправлено от \*\$\{escapeMarkdown\(targetBot\)\}\*: \$\{text\}/, false, 'line ~385: raw ${text} removed in confirmation');

// Confirm /command POST body (line ~375) still has RAW text (no escapeMarkdown):
checkSource('command body text raw', /text, ownerChatId: String\(chatId\)/, true, 'line ~375: raw text in POST body preserved');
checkSource('command body text not escaped', /JSON\.stringify\(\{ [^}]*escapeMarkdown\(text\)/, false, 'line ~375: escapeMarkdown(text) NOT in POST body');

checkSource('resolved escaped', /\*\$\{escapeMarkdown\(resolved\)\}\*/, true, 'line ~537: *${escapeMarkdown(resolved)}* present');
checkSource('resolved raw gone', /\*\$\{resolved\}\*/, false, 'line ~537: raw *${resolved}* removed');

console.log(failed === 0 ? '--- All tests passed ---' : `--- ${failed} test(s) failed ---`);
process.exit(failed === 0 ? 0 : 1);