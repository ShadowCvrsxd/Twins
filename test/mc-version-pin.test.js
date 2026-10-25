// T3: protocol pin, view distance, and desync fast-fail. Assert-only, no framework.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { failures++; console.log(`FAIL ${name}: ${e.message}`); }
}

// Isolate the DB before requiring bot-base (which requires db.js).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-t3-'));
process.env.DB_PATH = path.join(tmp, 'mcp-t3.db');
process.env.DB_JSON_PATH = path.join(tmp, 'mcp-t3.json');

const src = fs.readFileSync(path.join(__dirname, '..', 'bot-base.js'), 'utf8');
const { isProtocolDesyncError } = require('../bot-base.js');

console.log('--- source: pinned version and view distance ---');
check("source pins version: '26.1' and has no version: false", () => {
  assert.ok(src.includes("version: '26.1'"), 'version 26.1 pinned');
  assert.ok(!src.includes('version: false'), 'version: false removed');
});
check("source sets viewDistance: 'short'", () => {
  assert.ok(src.includes("viewDistance: 'short'"), "viewDistance 'short'");
});
check('source has no numeric config.viewDistance = 7', () => {
  assert.ok(!src.includes('config.viewDistance = 7'), 'numeric 7 override removed');
});
check('source keeps base loadInternalChunks: false and twins config.loadInternalChunks = true', () => {
  assert.ok(src.includes('loadInternalChunks: false'), 'base loadInternalChunks false');
  assert.ok(src.includes('config.loadInternalChunks = true'), 'twins loadInternalChunks true');
});

console.log('--- source: desync fast-fail ---');
check("source ends the socket with _client.end('protocol-desync') and guards once", () => {
  assert.ok(src.includes("_client.end('protocol-desync')"), 'socket ended on desync');
  assert.ok(src.includes('protocolDesyncEnded'), 'one-shot guard present');
});
check('failFastOnProtocolDesync(err) is called from exactly two error handlers', () => {
  const calls = src.split('failFastOnProtocolDesync(err)').length - 1;
  assert.strictEqual(calls, 2, `expected 2 calls, got ${calls}`);
});

console.log('--- predicate: isProtocolDesyncError ---');
check('crash string -> true', () => {
  assert.strictEqual(isProtocolDesyncError('Read error ... array size is abnormally large, not reading: 590820163'), true);
});
check('unsupported protocol version -> true', () => {
  assert.strictEqual(isProtocolDesyncError({ message: 'Unsupported protocol version' }), true);
});
check('ECONNRESET -> false', () => {
  assert.strictEqual(isProtocolDesyncError('ECONNRESET'), false);
});
check('null -> false', () => {
  assert.strictEqual(isProtocolDesyncError(null), false);
});
check('undefined -> false', () => {
  assert.strictEqual(isProtocolDesyncError(undefined), false);
});

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
