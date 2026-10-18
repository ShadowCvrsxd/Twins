const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// Isolate DB + dummy creds BEFORE requiring the bot (module reads env at load).
const TMP = os.tmpdir();
process.env.DB_PATH = path.join(TMP, `t-gifrelay-${process.pid}.db`);
process.env.DB_JSON_PATH = path.join(TMP, `t-gifrelay-${process.pid}.json`);
process.env.TG_CHAT_BOT_TOKEN = 'TESTTOKEN';
process.env.HUB_API_TOKEN = 'TESTHUB';

const mod = require('../tg-chat-bot.js') || {};
const { detectMedia, mediaExt, buildCaption } = mod;

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

// --- Baseline: today's text-path composition rules (pure equivalent) ---
check('text + reply nick -> suffix (отвечая "ник")', () => {
  assert.strictEqual(buildCaption('hi there', 'ник', false), 'hi there (отвечая "ник")');
});
check('text + global mode -> "!" prefix', () => {
  assert.strictEqual(buildCaption('hi', null, true), '!hi');
});
check('text plain -> unchanged', () => {
  assert.strictEqual(buildCaption('hi', null, false), 'hi');
});
check('text reply + global -> prefix wraps suffix', () => {
  assert.strictEqual(buildCaption('hi', 'ник', true), '!hi (отвечая "ник")');
});

// --- New media behavior ---
check('mediaExt video/mp4 -> mp4', () => assert.strictEqual(mediaExt('video/mp4'), 'mp4'));
check('mediaExt image/gif -> gif', () => assert.strictEqual(mediaExt('image/gif'), 'gif'));
check('mediaExt text/plain -> null', () => assert.strictEqual(mediaExt('text/plain'), null));
check('mediaExt undefined -> null', () => assert.strictEqual(mediaExt(undefined), null));

check('detectMedia animation(mp4) -> mp4 fileId', () => {
  const m = detectMedia({ animation: { file_id: 'A1', mime_type: 'video/mp4', file_size: 100 } });
  assert.deepStrictEqual(m, { fileId: 'A1', ext: 'mp4' });
});
check('detectMedia animation(gif) -> gif', () => {
  const m = detectMedia({ animation: { file_id: 'A2', mime_type: 'image/gif' } });
  assert.deepStrictEqual(m, { fileId: 'A2', ext: 'gif' });
});
check('detectMedia animation without mime -> mp4 (TG animations are mp4)', () => {
  const m = detectMedia({ animation: { file_id: 'A3' } });
  assert.deepStrictEqual(m, { fileId: 'A3', ext: 'mp4' });
});
check('detectMedia document(image/gif) -> gif', () => {
  const m = detectMedia({ document: { file_id: 'D1', mime_type: 'image/gif', file_name: 'x.gif' } });
  assert.deepStrictEqual(m, { fileId: 'D1', ext: 'gif' });
});
check('detectMedia document(video/mp4) -> mp4', () => {
  const m = detectMedia({ document: { file_id: 'D2', mime_type: 'video/mp4' } });
  assert.deepStrictEqual(m, { fileId: 'D2', ext: 'mp4' });
});
check('detectMedia document(text/plain) -> null (dropped)', () => {
  assert.strictEqual(detectMedia({ document: { file_id: 'D3', mime_type: 'text/plain' } }), null);
});
check('detectMedia document without mime -> null (dropped)', () => {
  assert.strictEqual(detectMedia({ document: { file_id: 'D4' } }), null);
});
check('detectMedia photo -> null (dropped)', () => {
  assert.strictEqual(detectMedia({ photo: [{ file_id: 'P1' }] }), null);
});
check('detectMedia no media -> null', () => assert.strictEqual(detectMedia({ text: 'hi' }), null));

check('buildCaption empty -> "" (URL still relayed separately)', () => {
  assert.strictEqual(buildCaption('', 'ник', false), '');
});
check('buildCaption empty + global -> "" (no stray "!")', () => {
  assert.strictEqual(buildCaption('', null, true), '');
});

// cleanup tmp db/json if created by module load
try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch (e) {}
try { fs.rmSync(process.env.DB_JSON_PATH, { force: true }); } catch (e) {}

console.log(failed === 0 ? '--- All tests passed ---' : `--- ${failed} test(s) failed ---`);
process.exit(failed === 0 ? 0 : 1);
