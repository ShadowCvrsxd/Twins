// T3: deploy workflow shape. Assert-only, no framework.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { failures++; console.log(`FAIL ${name}: ${e.message}`); }
}

const root = process.env.WINDOWS_RELEASE_ROOT || path.join(__dirname, '..');

function readText(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

const wf = readText(path.join('.github', 'workflows', 'deploy.yml'));

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

check('windows launcher files and docs exist', () => {
  ['install.bat', 'run_bot1.bat', 'run_bot2.bat', 'README-WINDOWS.md'].forEach((f) => {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} exists`);
  });
});

check('client env templates are present', () => {
  assert.ok(fs.existsSync(path.join(root, '.env.client')), '.env.client exists');
  assert.ok(fs.existsSync(path.join(root, '.env.example')), '.env.example exists');
});

check('install.bat installs production deps without puppeteer download', () => {
  const bat = readText('install.bat');
  assert.ok(bat.includes('npm install'), 'npm install present');
  assert.ok(bat.includes('PUPPETEER_SKIP_DOWNLOAD=1'), 'puppeteer skip flag present');
  assert.ok(bat.includes('node_modules'), 'node_modules check present');
});

check('run_bot1.bat prefers bundled node.exe and runs bot.js', () => {
  const bat = readText('run_bot1.bat');
  assert.ok(bat.includes('node.exe'), 'node.exe present');
  assert.ok(bat.includes('bot.js'), 'bot.js present');
});

check('run_bot2.bat runs bot-2.js', () => {
  assert.ok(readText('run_bot2.bat').includes('bot-2.js'), 'bot-2.js present');
});

check('README-WINDOWS.md covers templates, token and Node.js', () => {
  const doc = readText('README-WINDOWS.md');
  assert.ok(doc.includes('.env.client'), '.env.client documented');
  assert.ok(doc.includes('BOT_TOKEN'), 'BOT_TOKEN documented');
  assert.ok(doc.includes('Node.js'), 'Node.js documented');
});

check('.gitignore unignores launchers and env templates', () => {
  const gi = readText('.gitignore');
  ['!install.bat', '!run_bot1.bat', '!run_bot2.bat', '!.env.client', '!.env.example'].forEach(
    (line) => assert.ok(gi.includes(line), `${line} present`)
  );
});

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
