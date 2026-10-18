// T4: /command scope. A non-system (bot) token must NEVER be able to redirect
// a command via command.targetBot; only HUB_API_TOKEN (system) may choose the target.
const { resolveCommandTarget } = require('../hub-util');

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// bot token must go to its own authorized bot, ignoring command.targetBot
check('bot absent targetBot', resolveCommandTarget({ isSystemToken: false, authorizedBot: 'A', command: { targetBot: null } }), 'A');
// bot token with a spoofed targetBot is still pinned to authorizedBot
check('bot override targetBot', resolveCommandTarget({ isSystemToken: false, authorizedBot: 'A', command: { targetBot: 'B' } }), 'A');
// system token honors command.targetBot
check('system targetBot', resolveCommandTarget({ isSystemToken: true, authorizedBot: null, command: { targetBot: 'B' } }), 'B');
// system token with no targetBot yields undefined -> caller responds 400
check('system absent targetBot', resolveCommandTarget({ isSystemToken: true, authorizedBot: null, command: { targetBot: null } }), null);

console.log(failed === 0 ? '--- All tests passed ---' : `--- ${failed} test(s) failed ---`);
process.exit(failed === 0 ? 0 : 1);
