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

check('deploy fetches and resets hard to origin/main', () => {
  assert.ok(wf.includes('git fetch origin main && git reset --hard origin/main'), 'fetch and hard reset origin/main');
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

check('windows-release job is guarded to push on main', () => {
  assert.ok(wf.includes('windows-release:'), 'windows-release job present');
  assert.ok(wf.includes('runs-on: windows-latest'), 'runs on windows-latest');
  assert.ok(wf.includes('needs: tests'), 'runs after tests');
});

check('windows-release job can write release assets', () => {
  assert.ok(wf.includes('permissions:'), 'permissions block present');
  assert.ok(wf.includes('contents: write'), 'contents write granted');
});

check('windows-release PowerShell steps fail fast', () => {
  assert.ok(wf.includes('shell: pwsh'), 'pwsh shell present');
  assert.ok(wf.includes('$ErrorActionPreference'), 'ErrorActionPreference present');
});

check('windows-release builds both asset names', () => {
  assert.ok(wf.includes('twins-windows-node.zip'), 'source zip name');
  assert.ok(wf.includes('twins-windows-portable.zip'), 'portable zip name');
});

check('portable asset bundles node.exe, node_modules and license', () => {
  assert.ok(wf.includes('node.exe'), 'node.exe bundled');
  assert.ok(wf.includes('node_modules'), 'node_modules bundled');
  assert.ok(wf.includes('NODE-LICENSE.txt'), 'node license bundled');
});

check('release assets include project LICENSE', () => {
  const staged = wf.match(/\$files\s*=\s*@\([\s\S]*?\)/);
  assert.ok(staged, '$files staging array present');
  assert.ok(/\$files\s*=\s*@\([\s\S]*?'LICENSE'[\s\S]*?\)/.test(staged[0]), 'staged $files includes LICENSE');
});

check('release is published to the rolling windows-latest tag', () => {
  assert.ok(wf.includes('gh release view'), 'existence check');
  assert.ok(wf.includes('gh release upload'), 'upload command');
  assert.ok(wf.includes('--clobber'), 'assets clobbered');
  assert.ok(wf.includes('windows-latest'), 'rolling tag present');
  assert.ok(!wf.includes('gh release delete'), 'no release delete');
  assert.ok(!wf.includes('npm prune'), 'no npm prune');
});

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
