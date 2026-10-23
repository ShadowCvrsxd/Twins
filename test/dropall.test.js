const assert = require('node:assert');
const { formatDropResult } = require('../utils.js');

// Test 1: Empty inventory
assert.strictEqual(formatDropResult('yalex', []), '🧹 Инвентарь yalex пуст.');
console.log('ok 1 - empty inventory');

// Test 2: Non-empty inventory
const s = formatDropResult('yalex', [{name:'stone',count:64},{name:'dirt',count:3}]);
assert(s.includes('stone×64, dirt×3'), 'Should include items');
assert(s.includes('2 стаков'), 'Should include count');
assert(s.startsWith('🧹 yalex:'), 'Should start with username');
console.log('ok 2 - non-empty inventory');

process.exit(0);
