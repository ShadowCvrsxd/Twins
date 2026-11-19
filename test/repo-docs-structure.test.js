// T3: agent-executed docs structure/link checks for README.md + README-WINDOWS.md.
// Node built-ins only. Structure checks always run; live URL checks run unless DOCS_NETWORK=0.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const readmeWindows = fs.readFileSync(path.join(ROOT, 'README-WINDOWS.md'), 'utf8');

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// --- (a) frozen H2 headings still present (failure-sensitive: exact line match) ---
const FROZEN_H2 = Object.freeze([
  'Features', 'Architecture', 'Requirements', 'Install', 'Configuration',
  'Startup commands', 'Telegram command reference', 'Testing', 'Backups',
  'TLS (optional, nginx + nip.io)', 'License', 'Quick start',
]);
const readmeLines = readme.split(/\r?\n/);
for (const h of FROZEN_H2) {
  check(`H2 present: ${h}`, readmeLines.includes('## ' + h), true);
}

// --- (b) every ](#anchor) resolves to a slugified H2/H3 heading ---
// GitHub slug: lowercase, strip punctuation (keep word chars/space/hyphen), spaces -> hyphens.
// " + " -> two spaces -> "--" (TLS heading -> tls-optional-nginx--nipio).
function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/ /g, '-');
}
const headingSlugs = new Set(
  readmeLines
    .filter((l) => /^#{2,3}\s/.test(l))
    .map((l) => slugify(l.replace(/^#{2,3}\s+/, '')))
);
const anchors = [...readme.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
check('README has anchor links to validate', anchors.length > 0, true);
for (const a of anchors) {
  check(`anchor resolves: #${a}`, headingSlugs.has(a), true);
}

// --- (c) relative file links exist on disk ---
function relativeTargets(text) {
  const out = new Set();
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    const t = m[1].split('#')[0].trim();
    if (!t || /^(https?:|mailto:|\/\/)/i.test(t) || t.startsWith('#')) continue;
    out.add(t);
  }
  return [...out];
}
for (const [label, text] of [['README.md', readme], ['README-WINDOWS.md', readmeWindows]]) {
  for (const t of relativeTargets(text)) {
    check(`${label} relative link exists: ${t}`, fs.existsSync(path.join(ROOT, t)), true);
  }
}

// --- (d) exactly one balanced ```mermaid fence in README.md (README content only) ---
const mermaidOpens = readmeLines.filter((l) => l.startsWith('```mermaid')).length;
const allFences = readmeLines.filter((l) => l.startsWith('```')).length;
check('exactly one ```mermaid opener', mermaidOpens, 1);
check('all README fences balanced (even count)', allFences % 2, 0);

// --- (e) test-count strings ---
check('no stale "13 test files"', readme.includes('13 test files'), false);
check('"20 test files" present', readme.includes('20 test files'), true);

// --- (f) README-WINDOWS.md badges + main link ---
check('WINDOWS license badge', readmeWindows.includes('img.shields.io/badge/License'), true);
check('WINDOWS deploy badge', readmeWindows.includes('deploy.yml/badge.svg'), true);
check('WINDOWS main README link', readmeWindows.includes('[Main README](README.md)'), true);

// --- live URL checks (skip with DOCS_NETWORK=0) ---
const URLS = [
  ['license badge', 'https://img.shields.io/badge/License-GPLv3-blue.svg'],
  ['node badge', 'https://img.shields.io/badge/Node-%E2%89%A522.5-brightgreen.svg'],
  ['deploy badge', 'https://github.com/ShadowCvrsxd/Twins/actions/workflows/deploy.yml/badge.svg'],
  ['portable zip', 'https://github.com/ShadowCvrsxd/Twins/releases/download/windows-latest/twins-windows-portable.zip'],
  ['node zip', 'https://github.com/ShadowCvrsxd/Twins/releases/download/windows-latest/twins-windows-node.zip'],
];

async function main() {
  if (process.env.DOCS_NETWORK === '0') {
    console.log('SKIP live URL checks (DOCS_NETWORK=0)');
  } else {
    for (const [name, url] of URLS) {
      try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
        check(`HTTP 200 ${name}`, res.status, 200);
      } catch (e) {
        check(`HTTP 200 ${name}`, e.message, 'no error');
      }
    }
  }
  console.log(failed === 0 ? '--- All tests passed ---' : `--- ${failed} test(s) failed ---`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
