// Pure, dependency-free helpers shared by the hub and its tests.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// T4: /command scope — a non-system (bot) token can only ever command its own
// authorized bot; command.targetBot is honored exclusively for the system token.
function resolveCommandTarget({ isSystemToken, authorizedBot, command }) {
  return isSystemToken ? command.targetBot : authorizedBot;
}

// T10: WS reconnect guard — at most one reconnect scheduled, never while a
// socket is already open/connecting or the quit was manual.
// hubSocketState is a ws readyState: 0=CONNECTING, 1=OPEN.
function shouldScheduleReconnect({ hubSocketState, hasOpenSocket, isManualQuit, reconnectScheduled } = {}) {
  if (isManualQuit || reconnectScheduled || hasOpenSocket) return false;
  return hubSocketState !== 1 && hubSocketState !== 0;
}

// T11: drop every alias of chatId pointing (case-insensitively) at username so a
// deleted bot cannot resolve through a stale alias; mutates and returns aliases.
function removeAliasesForBot(aliases, chatId, username) {
  if (aliases[chatId]) {
    for (const [alias, realName] of Object.entries(aliases[chatId])) {
      if (realName.toLowerCase() === username.toLowerCase()) delete aliases[chatId][alias];
    }
  }
  return aliases;
}

// T24: self-hosted TG media hosting. Files live on the VPS itself and are served
// by the already-public hub (:8089); upload is bearer-gated, GET is public.
// ponytail: авто-чистки нет — диск растёт с юзером; прикрутить TTL-чистку, когда заболит.
const MEDIA_DIR = path.join(__dirname, 'media');
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

function mediaContentType(ext) {
  return ext === 'mp4' ? 'video/mp4' : 'image/gif';
}

// Request Content-Type must be exactly image/gif or video/mp4 (empty if unsupported).
function mediaExtFromMime(mime) {
  const type = (mime || '').split(';')[0].trim().toLowerCase();
  if (type === 'image/gif') return 'gif';
  if (type === 'video/mp4') return 'mp4';
  return null;
}

// Magic-byte sniff: GIF87a/GIF89a header, or MP4 'ftyp' box at bytes 4..8.
function hasMediaMagic(buf, ext) {
  if (ext === 'gif') {
    return buf.length >= 6 && (buf.slice(0, 6).toString('latin1') === 'GIF87a' || buf.slice(0, 6).toString('latin1') === 'GIF89a');
  }
  return buf.length >= 8 && buf.slice(4, 8).toString('latin1') === 'ftyp';
}

async function handleMediaUpload(req, res) {
  const auth = req.headers['authorization'];
  const token = process.env.HUB_API_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    res.writeHead(401); res.end('Unauthorized'); return;
  }
  const ext = mediaExtFromMime(req.headers['content-type']);
  if (!ext) {
    res.writeHead(415); res.end('Unsupported Media Type'); return;
  }
  if (!process.env.MEDIA_BASE_URL) {
    res.writeHead(500); res.end('MEDIA_BASE_URL not set'); return;
  }

  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (chunk) => {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_MEDIA_BYTES) {
      aborted = true;
      req.destroy();
      res.writeHead(413); res.end('Payload Too Large');
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', () => {
    if (aborted) return;
    aborted = true;
    try { res.writeHead(400); res.end('Bad Request'); } catch (e) {}
  });
  req.on('end', () => {
    if (aborted) return;
    const buf = Buffer.concat(chunks);
    if (!hasMediaMagic(buf, ext)) {
      res.writeHead(415); res.end('Unsupported Media Type'); return;
    }
    try {
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
      const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(MEDIA_DIR, name), buf);
      const base = process.env.MEDIA_BASE_URL.replace(/\/+$/, '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: `${base}/media/${name}` }));
    } catch (e) {
      res.writeHead(500); res.end('Media write failed');
    }
  });
}

function handleMediaGet(req, res, pathname) {
  let name;
  try {
    name = decodeURIComponent(pathname.slice('/media/'.length));
  } catch (e) {
    res.writeHead(404); res.end(); return;
  }
  // Strict name rule after decode kills '..', '%2F' and any '/'.
  if (!/^[A-Za-z0-9._-]+\.(gif|mp4)$/.test(name)) {
    res.writeHead(404); res.end(); return;
  }
  // ponytail: readFile ok for ≤25МБ files; stream when we outgrow it.
  fs.readFile(path.join(MEDIA_DIR, name), (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': mediaContentType(name.endsWith('.mp4') ? 'mp4' : 'gif'),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=86400'
    });
    res.end(buf);
  });
}

// T28: cap the JSON bodies accepted by /command and /state (POST) so the public
// :8089 API cannot accumulate an unbounded request body.
const MAX_BODY_BYTES = 64 * 1024;
function isOversizedBody(str) { return str.length > MAX_BODY_BYTES; }

// T1: chat authz — three pure helpers, no deps, no env reads.
// (a) isBotOwnedByChat: true iff approved[chatId] OR mainsApproved[chatId] contains botName (case-insensitive). Safe on missing maps/keys.
function isBotOwnedByChat(approved, mainsApproved, chatId, botName) {
  const bn = (botName || '').toLowerCase();
  if (!bn) return false;
  const a = approved && approved[chatId];
  const m = mainsApproved && mainsApproved[chatId];
  if (Array.isArray(a) && a.some(x => (x || '').toLowerCase() === bn)) return true;
  if (Array.isArray(m) && m.some(x => (x || '').toLowerCase() === bn)) return true;
  return false;
}

// (b) isChatSenderAllowed: true iff !selectedLower, OR userBots contains selectedLower (ci), OR (isAdminChat && mainAccount && selectedLower === mainAccount.toLowerCase()).
function isChatSenderAllowed(userBots, selectedLower, { isAdminChat, mainAccount } = {}) {
  if (!selectedLower) return true;
  const sl = selectedLower.toLowerCase();
  const bots = Array.isArray(userBots) ? userBots : [];
  if (bots.some(x => (x || '').toLowerCase() === sl)) return true;
  const adminChat = Boolean(isAdminChat);
  const main = mainAccount ? String(mainAccount).toLowerCase() : null;
  if (adminChat && main && sl === main) return true;
  return false;
}

// (c) evictBotSocket: if clients.get(botName.toLowerCase()) exists, delete it THEN close socket. Returns true if evicted.
function evictBotSocket(clients, socket, botName) {
  const key = (botName || '').toLowerCase();
  if (!key || !clients || typeof clients.get !== 'function' || !clients.has(key)) return false;
  clients.delete(key);
  if (socket && typeof socket.close === 'function') socket.close();
  return true;
}

// T1: escape for Telegram legacy-Markdown (parse_mode 'Markdown').
// Escapes ONLY _ * ` [ with a backslash. Does NOT escape backslash itself.
function escapeMarkdown(s) {
  if (s == null) return '';
  return String(s).replace(/([_*`\[\]])/g, '\\$1');
}

module.exports = { resolveCommandTarget, shouldScheduleReconnect, removeAliasesForBot, handleMediaUpload, handleMediaGet, MAX_BODY_BYTES, isOversizedBody, isBotOwnedByChat, isChatSenderAllowed, evictBotSocket, escapeMarkdown };
