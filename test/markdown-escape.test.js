// T1: pure escapeMarkdown for Telegram legacy-Markdown (parse_mode 'Markdown').
// Escapes ONLY _ * ` [ with a backslash. Does NOT escape backslash itself.
const { escapeMarkdown } = require('../hub-util');

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

console.log(failed === 0 ? '--- All tests passed ---' : `--- ${failed} test(s) failed ---`);
process.exit(failed === 0 ? 0 : 1);