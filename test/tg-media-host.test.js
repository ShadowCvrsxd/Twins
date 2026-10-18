const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

// Isolate env BEFORE requiring hub-util (handlers read process.env at call time).
process.env.HUB_API_TOKEN = 'qa-token-123';
process.env.MEDIA_BASE_URL = 'http://127.0.0.1:18089';

const { handleMediaUpload, handleMediaGet } = require('../hub-util.js');

const MEDIA_DIR = path.join(__dirname, '..', 'media');

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

function makeRes(resolve) {
  return {
    statusCode: 0,
    headers: null,
    body: undefined,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(data) { this.body = data; resolve(this); }
  };
}

// Feed a mock request stream into handleMediaUpload and resolve with the res.
function upload({ headers, chunks }) {
  return new Promise((resolve) => {
    const res = makeRes(resolve);
    const req = Readable.from(chunks);
    req.headers = headers;
    req.method = 'POST';
    handleMediaUpload(req, res);
  });
}

function get(pathname) {
  return new Promise((resolve) => {
    const res = makeRes(resolve);
    handleMediaGet({ headers: {}, method: 'GET' }, res, pathname);
  });
}

const AUTH = 'Bearer qa-token-123';
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(24, 7)]);

let uploadedName = null;

(async () => {
  // --- upload auth / mime / size / magic ---
  await check('upload without token -> 401', async () => {
    const r = await upload({ headers: { 'content-type': 'image/gif' }, chunks: [GIF] });
    assert.strictEqual(r.statusCode, 401);
  });

  await check('upload wrong mime (text/plain) -> 415', async () => {
    const r = await upload({ headers: { authorization: AUTH, 'content-type': 'text/plain' }, chunks: [Buffer.from('notmedia')] });
    assert.strictEqual(r.statusCode, 415);
  });

  await check('upload >25MB -> 413', async () => {
    const big = Buffer.alloc(25 * 1024 * 1024 + 10, 0);
    const r = await upload({ headers: { authorization: AUTH, 'content-type': 'image/gif' }, chunks: [big] });
    assert.strictEqual(r.statusCode, 413);
  });

  await check('upload forged magic bytes (gif mime, png bytes) -> 415', async () => {
    const forged = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 0)]);
    const r = await upload({ headers: { authorization: AUTH, 'content-type': 'image/gif' }, chunks: [forged] });
    assert.strictEqual(r.statusCode, 415);
  });

  await check('upload valid GIF -> 200 + {url} starting with MEDIA_BASE_URL', async () => {
    const r = await upload({ headers: { authorization: AUTH, 'content-type': 'image/gif' }, chunks: [GIF] });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.headers['Content-Type'], 'application/json');
    const body = JSON.parse(r.body.toString());
    assert.ok(body.url.startsWith('http://127.0.0.1:18089/media/'), `unexpected url: ${body.url}`);
    assert.match(body.url, /\/media\/[A-Za-z0-9._-]+\.gif$/);
    uploadedName = body.url.split('/').pop();
  });

  // --- GET path traversal / validation ---
  await check('GET ../.. -> 404', async () => {
    const r = await get('/media/../../twins_store.json');
    assert.strictEqual(r.statusCode, 404);
  });

  await check('GET %2e%2e%2f encoded traversal -> 404', async () => {
    const r = await get('/media/%2e%2e%2f%2e%2e%2f.twins_store.json');
    assert.strictEqual(r.statusCode, 404);
  });

  await check('GET no extension -> 404', async () => {
    const r = await get('/media/nope');
    assert.strictEqual(r.statusCode, 404);
  });

  await check('GET existing -> 200 image/gif + nosniff', async () => {
    assert.ok(uploadedName, 'no uploaded file name from previous check');
    const r = await get(`/media/${uploadedName}`);
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.headers['Content-Type'], 'image/gif');
    assert.strictEqual(r.headers['X-Content-Type-Options'], 'nosniff');
    assert.strictEqual(r.headers['Content-Disposition'], 'inline');
    assert.ok(Buffer.isBuffer(r.body) && r.body.length === GIF.length);
  });

  // cleanup the file this test created (keep media/ tidy)
  if (uploadedName) { try { fs.rmSync(path.join(MEDIA_DIR, uploadedName), { force: true }); } catch (e) {} }
  try { fs.rmdirSync(MEDIA_DIR); } catch (e) {}

  console.log(failed === 0 ? '--- All tests passed ---' : `--- ${failed} test(s) failed ---`);
  process.exit(failed === 0 ? 0 : 1);
})();
