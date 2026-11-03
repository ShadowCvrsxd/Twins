// T3: deploy workflow shape. Assert-only, no framework.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { failures++; console.log(`FAIL ${name}: ${e.message}`); }
}

const wf = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'),
  'utf8'
);

check('workflow triggers on pull_request to main', () => {
  assert.ok(wf.includes('pull_request:'), 'pull_request trigger present');
});

check('workflow uses checkout@v5 and setup-node@v5', () => {
  assert.ok(wf.includes('actions/checkout@v5'), 'checkout v5');
  assert.ok(wf.includes('actions/setup-node@v5'), 'setup-node v5');
});

check('deploy job is guarded to push on main only', () => {
  assert.ok(
    wf.includes("github.event_name == 'push' && github.ref == 'refs/heads/main'"),
    'deploy if guard present'
  );
});

check('deploy pulls fast-forward only', () => {
  assert.ok(wf.includes('git pull --ff-only origin main'), 'ff-only pull');
});

check('deploy restarts twins-main with the other services', () => {
  assert.ok(
    /systemctl restart[^\n]*twins-main/.test(wf),
    'twins-main in restart list'
  );
});

check('workflow never stops twins-main', () => {
  assert.ok(!wf.includes('systemctl stop twins-main'), 'no systemctl stop twins-main');
});

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
