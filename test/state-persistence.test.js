// Global test-isolation rule: never read/write the operator's real twins.db /
// twins_store.json. db.js reads these env vars at require time, so set BEFORE
// requiring feature-state.js / ../db.
const os = require('os'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'twinks-test-'));
process.env.DB_PATH = path.join(TMP, 'db.sqlite');
process.env.DB_JSON_PATH = path.join(TMP, 'store.json');
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

const assert = require('node:assert');
const { loadFeatureState, saveFeatureState, sanitizeSpamTasks } = require('../feature-state.js');
const { get, set } = require('../db.js');

// --- Tests ---

// (a) Round-trip: saveFeatureState / loadFeatureState
const testUser = '__test_state__';
const testState = { 
  clicker: { enabled: true, manualCooldownMs: 250 }, 
  meow: { enabled: true, cooldownMs: 120000 }, 
  autoRespectEnabled: true 
};
saveFeatureState(testUser, testState);
const loadedState = loadFeatureState(testUser);
assert.deepStrictEqual(loadedState, testState);
console.log('✓ Round-trip passed');

// (b) Defaults: loadFeatureState
const defaultState = loadFeatureState('__test_none__');
const expectedDefaults = {
  clicker: { enabled: false, manualCooldownMs: null },
  meow: { enabled: false, cooldownMs: 300000 },
  autoRespectEnabled: false
};
assert.deepStrictEqual(defaultState, expectedDefaults);
console.log('✓ Defaults passed');

// (c) Spam persist: db.get / db.set
const spamKey = 'spam_tasks___test_state__';
const spamTasks = [{ msg: 'x', delay: 9 }];
set(spamKey, spamTasks);
assert.deepStrictEqual(get(spamKey, []), spamTasks);
console.log('✓ Spam persist passed');

// (d) Sanitize: sanitizeSpamTasks
assert.deepStrictEqual(sanitizeSpamTasks('not an array'), []);

const mixed = [
  { msg: 'a', delay: 5 },
  { msg: '', delay: 5 },     // empty msg    -> dropped
  { msg: '   ', delay: 5 },  // whitespace   -> dropped
  { msg: 'b', delay: 0 },    // zero delay   -> dropped
  { msg: 'c', delay: -3 },   // negative     -> dropped
  { msg: 'd', delay: 'x' }   // non-numeric  -> dropped
];
assert.deepStrictEqual(sanitizeSpamTasks(mixed), [{ msg: 'a', delay: 5 }]);

const manyTasks = Array.from({ length: 25 }, (_, i) => ({ msg: `msg${i}`, delay: i + 1 }));
assert.strictEqual(sanitizeSpamTasks(manyTasks).length, 20); // capped at 20
console.log('✓ Sanitize passed');

console.log('--- All tests passed ---');
