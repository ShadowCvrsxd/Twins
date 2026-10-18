// T11: /delmain must clear aliases that pointed at the deleted main, like /deltwin.
const fs = require('fs');
const path = require('path');
const { removeAliasesForBot } = require('../hub-util');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// happy: every alias of the deleted bot is dropped
check('single alias removed', removeAliasesForBot({ chatId: { a: 'X' } }, 'chatId', 'X'), { chatId: {} });

// failure: aliases of other bots survive
check('other alias kept', removeAliasesForBot({ chatId: { a: 'X', b: 'Y' } }, 'chatId', 'X'), { chatId: { b: 'Y' } });

// case-insensitive match
check('case-insensitive', removeAliasesForBot({ chatId: { a: 'x' } }, 'chatId', 'X'), { chatId: {} });

// missing chatId key: must not throw, returns input unchanged
let threw = false;
let missing;
try { missing = removeAliasesForBot({ other: { a: 'X' } }, 'chatId', 'X'); } catch { threw = true; }
check('missing chatId no throw', threw, false);
check('missing chatId unchanged', missing, { other: { a: 'X' } });

// chatId present but empty
check('empty chatId', removeAliasesForBot({ chatId: {} }, 'chatId', 'X'), { chatId: {} });

// static wiring: /delmain branch reuses the helper and writes ALIASES_FILE, like /deltwin
const hubSrc = fs.readFileSync(path.join(__dirname, '..', 'tg-hub.js'), 'utf8');
const delmainStart = hubSrc.indexOf("cmd === '/delmain'");
const delmainEnd = hubSrc.indexOf("else if", delmainStart + 10);
const delmainBranch = delmainStart === -1 ? '' : hubSrc.slice(delmainStart, delmainEnd);
check('delmain calls removeAliasesForBot', /removeAliasesForBot\(aliases, chatId, username\)/.test(delmainBranch), true);
check('delmain writes ALIASES_FILE', delmainBranch.includes('writeJSON(ALIASES_FILE'), true);

fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
const happy = { chatId: { a: 'X' } };
fs.writeFileSync(path.join(__dirname, 'artifacts', 't11-delmain.txt'),
  `input: ${JSON.stringify(happy)}\nafter removeAliasesForBot(..., 'X'): ${JSON.stringify(removeAliasesForBot(happy, 'chatId', 'X'))}\n`);
const other = { chatId: { a: 'X', b: 'Y' } };
fs.writeFileSync(path.join(__dirname, 'artifacts', 't11-delmain-other.txt'),
  `input: ${JSON.stringify(other)}\nafter removeAliasesForBot(..., 'X'): ${JSON.stringify(removeAliasesForBot(other, 'chatId', 'X'))}\n`);

console.log(failed === 0 ? '--- All tests passed ---' : `--- ${failed} test(s) failed ---`);
process.exit(failed === 0 ? 0 : 1);
