const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getMainAccount } = require('./utils.js');
const { isChatSenderAllowed, escapeMarkdown } = require('./hub-util.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('[Telegram Chat Bot Uncaught Exception]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Telegram Chat Bot Unhandled Rejection]:', reason);
});

const TOKEN = process.env.TG_CHAT_BOT_TOKEN;
if (!TOKEN) {
  console.error('[Chat] TG_CHAT_BOT_TOKEN не задан — чат-бот не стартует (во избежание дубля getUpdates с хабом).');
  process.exit(0);
}

const HUB_API_TOKEN = process.env.HUB_API_TOKEN;
const HUB_PORT = parseInt(process.env.HUB_PORT || '8089', 10);

const ADMIN_ID = process.env.ADMIN_TG_ID ? process.env.ADMIN_TG_ID.trim() : '';

function isAdminChat(chatId) {
  return !!ADMIN_ID && chatId.toString() === ADMIN_ID;
}

function hubAuthHeader() {
  if (!HUB_API_TOKEN) {
    console.error('[API] HUB_API_TOKEN not set');
    return null;
  }
  return `Bearer ${HUB_API_TOKEN}`;
}

const APPROVED_FILE = 'links_approved';
const MAINS_APPROVED_FILE = 'mains_approved';
const STATUS_FILE = 'bots_status';
const STREAMING_FILE = 'chat_streaming';
const ALIASES_FILE = 'bot_aliases';
const DISPLAY_MODE_FILE = 'chat_display_mode';
const GLOBAL_MODE_FILE = 'chat_global_mode';

async function apiGet(key, defaultValue = {}) {
  const auth = hubAuthHeader();
  if (!auth) return defaultValue;
  try {
    const res = await fetch(`http://localhost:8089/state?key=${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: {
        'Authorization': auth
      }
    });
    if (!res.ok) return defaultValue;
    const data = await res.json();
    return data !== undefined && data !== null ? data : defaultValue;
  } catch (e) {
    console.error(`[API Get Error] key ${key}:`, e.message);
    return defaultValue;
  }
}

async function apiSet(key, value) {
  const auth = hubAuthHeader();
  if (!auth) return;
  try {
    await fetch(`http://localhost:8089/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth
      },
      body: JSON.stringify({ key, value })
    });
  } catch (e) {
    console.error(`[API Set Error] key ${key}:`, e.message);
  }
}

async function readJSON(key) {
  return await apiGet(key, {});
}

async function writeJSON(key, data) {
  await apiSet(key, data);
}

let offset = 0;

async function telegramAPI(method, body = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[Telegram API Error] Method ${method}:`, data.description);
      return null;
    }
    return data.result;
  } catch (e) {
    console.error(`[Telegram Network Error] Method ${method}:`, e.message);
    return null;
  }
}

async function sendMessage(chatId, text) {
  await telegramAPI('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown'
  });
}

async function resolveBot(chatId, targetArg) {
  const approved = await readJSON(APPROVED_FILE);
  const userTwins = approved[chatId] || [];
  const mainsApproved = await readJSON(MAINS_APPROVED_FILE);
  const userMains = mainsApproved[chatId] || [];
  const aliases = (await readJSON(ALIASES_FILE))[chatId] || {};
  const searchKey = targetArg.toLowerCase();

  if (aliases[searchKey]) {
    return aliases[searchKey];
  }
  if (searchKey === 'main' && userMains[0]) {
    return userMains[0];
  }
  if (searchKey === 'bot1' && userTwins[0]) {
    return userTwins[0];
  }
  if (searchKey === 'bot2' && userTwins[1]) {
    return userTwins[1];
  }
  const foundTwin = userTwins.find(b => b.toLowerCase() === searchKey);
  if (foundTwin) return foundTwin;
  const foundMain = userMains.find(b => b.toLowerCase() === searchKey);
  if (foundMain) return foundMain;
  return null;
}

function extractReplyNick(replyText) {
  if (!replyText) return null;
  let text = replyText.trim();
  if (text.startsWith('💬')) {
    text = text.substring(1).trim();
  }
  while (text.startsWith('[')) {
    const endIdx = text.indexOf(']');
    if (endIdx !== -1) {
      text = text.substring(endIdx + 1).trim();
    } else {
      break;
    }
  }

  const angleMatch = text.match(/^<([^>]+)>/);
  if (angleMatch) {
    let nick = angleMatch[1].trim();
    nick = nick.replace(/^\[.*?\]\s*/, '').trim();
    return nick || null;
  }

  if (text.includes('›')) {
    const parts = text.split('›');
    let senderPart = parts[0].trim();
    while (senderPart.startsWith('[')) {
      const endIdx = senderPart.indexOf(']');
      if (endIdx !== -1) {
        senderPart = senderPart.substring(endIdx + 1).trim();
      } else {
        break;
      }
    }
    if (senderPart.includes('|')) {
      const subParts = senderPart.split('|');
      senderPart = subParts[subParts.length - 1].trim();
    }
    senderPart = senderPart.replace(/^\[.*?\]\s*/, '').trim();
    const tokens = senderPart.split(/\s+/);
    if (tokens.length > 0) {
      const nick = tokens[tokens.length - 1];
      return nick || null;
    }
  }

  const match = text.match(/(?:^|\||\])\s*([^\s›|]+)\s*›/);
  if (match) {
    return match[1].trim() || null;
  }

  return null;
}

const MAX_MEDIA_BYTES = 20 * 1024 * 1024; // Telegram Bot API getFile hard limit

function mediaExt(mime) {
  if (mime === 'video/mp4') return 'mp4';
  if (mime === 'image/gif') return 'gif';
  return null;
}

function detectMedia(message) {
  if (!message) return null;
  if (message.animation) {
    return { fileId: message.animation.file_id, ext: mediaExt(message.animation.mime_type) || 'mp4' };
  }
  if (message.document) {
    const ext = mediaExt(message.document.mime_type);
    return ext ? { fileId: message.document.file_id, ext } : null;
  }
  return null;
}

function buildCaption(caption, replyNick, isGlobal) {
  let out = caption || '';
  if (out && replyNick) out = `${out} (отвечая "${replyNick}")`;
  if (out && isGlobal) out = `!${out}`;
  return out;
}

async function downloadTelegramMedia(fileId) {
  const file = await telegramAPI('getFile', { file_id: fileId });
  if (!file || !file.file_path) return null;
  if (file.file_size && file.file_size > MAX_MEDIA_BYTES) return null;
  try {
    // TOKEN-bearing URL — must never be logged or forwarded.
    const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`, {
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.error('[Chat] telegram media download failed');
    return null;
  }
}

function isRealGif(buffer) {
  return buffer.length >= 6 && (buffer.slice(0, 6).toString('latin1') === 'GIF87a' || buffer.slice(0, 6).toString('latin1') === 'GIF89a');
}

// ponytail: ffmpeg subprocess, 60s ceiling — big mp4 → native mp4 link (cleaner than a giant GIF).
// Ceilings: 15s (-t) + 480px + 12fps keep TG mp4-animations under ~15MB at typical sizes,
// staying well below uguu's 128MB and hub's 25MB caps, and capping CPU. Fail → null → caller keeps mp4.
async function mp4ToGif(buffer) {
  const tmpIn = `/tmp/tg-media-${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`;
  const tmpOut = tmpIn.replace(/\.mp4$/, '.gif');
  try {
    await fs.promises.writeFile(tmpIn, buffer);
    await new Promise((res, rej) => execFile('ffmpeg', [
      '-y', '-i', tmpIn,
      '-vf', 'fps=12,scale=480:-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
      '-loop', '0', '-an', '-t', '15',
      tmpOut
    ], { timeout: 60000, killSignal: 'SIGKILL' }, (err) => err ? rej(err) : res()));
    const out = await fs.promises.readFile(tmpOut);
    if (!out || out.length === 0 || out.length > 20 * 1024 * 1024) return null;
    return out;
  } catch (e) {
    if (e.code === 'ENOENT') console.error('[Chat] ffmpeg not installed — mp4 passthrough');
    else console.error('[Chat] media convert failed:', e.code || e.message);
    return null;
  } finally {
    for (const f of [tmpIn, tmpOut]) { try { fs.unlinkSync(f); } catch {} }
  }
}

async function uploadToHub(buffer, ext) {
  try {
    const res = await fetch(`http://localhost:${HUB_PORT}/media-upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUB_API_TOKEN}`,
        'Content-Type': ext === 'mp4' ? 'video/mp4' : 'image/gif'
      },
      body: buffer,
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      console.error('[Chat] media upload failed: HTTP', res.status);
      return null;
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      console.error('[Chat] media upload: bad response body');
      return null;
    }
    const url = data && data.url;
    try {
      const parsed = new URL(url);
      if (!/^\/media\/[A-Za-z0-9._-]+\.(gif|mp4)$/.test(parsed.pathname)) {
        console.error('[Chat] media upload: bad response body');
        return null;
      }
    } catch (e) {
      console.error('[Chat] media upload: bad response body');
      return null;
    }
    return url;
  } catch (e) {
    console.error('[Chat] media upload failed:', e.cause?.code || e.cause || e.message);
    return null;
  }
}

// ponytail: uguu удалить файл ~через 3ч — для пермалинков есть загрузка на хуб (fallback ниже).
async function uploadToUguu(buffer, ext) {
  try {
    const form = new FormData();
    form.append('files[]', new Blob([buffer]), `file.${ext}`);
    const res = await fetch('https://uguu.se/upload?output=json', { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
    if (!res.ok) { console.error('[Chat] media upload failed: HTTP', res.status); return null; }
    let data;
    try { data = await res.json(); } catch (e) { console.error('[Chat] media upload: bad response body'); return null; }
    const url = data.files && data.files[0] && data.files[0].url;
    if (typeof url !== 'string' || !/^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+\.(gif|mp4)$/.test(url)) { console.error('[Chat] media upload: bad response body'); return null; }
    return url;
  } catch (e) { console.error('[Chat] media upload failed:', e.cause?.code || e.cause || e.message); return null; }
}

async function sendToGame(chatId, text) {
  const approved = await readJSON(APPROVED_FILE);
  const userTwins = approved[chatId] || [];
  const mainsApproved = await readJSON(MAINS_APPROVED_FILE);
  const userMains = mainsApproved[chatId] || [];
  const userBots = [...userMains, ...userTwins];

  const statuses = await readJSON(STATUS_FILE);
  const selection = await apiGet('chat_sender_selection', {});
  let targetBot = null;
  const selectedLower = selection[chatId];
  if (selectedLower) {
    const selStatus = statuses[selectedLower];
    if (!selStatus || !selStatus.online) {
      const mainAccount = getMainAccount();
      const nick = mainAccount && selectedLower === mainAccount.toLowerCase() ? 'Мейн' : selectedLower;
      await sendMessage(chatId, `❌ Бот *${escapeMarkdown(nick)}* оффлайн.`);
      return;
    }
    targetBot = selectedLower;
    if (!isChatSenderAllowed(userBots, selectedLower, { isAdminChat: isAdminChat(chatId), mainAccount: getMainAccount() })) {
      await sendMessage(chatId, '❌ Отправитель не привязан к твоему аккаунту.');
      return;
    }
  } else {
    const onlineBots = userBots.filter(b => { const st = statuses[b.toLowerCase()]; return st && st.online; });
    if (onlineBots.length === 0) {
      await sendMessage(chatId, '❌ Сейчас нет онлайн твинков для отправки сообщения.');
      return;
    }
    onlineBots.sort((a, b) => (statuses[a.toLowerCase()].onlineSince || 0) - (statuses[b.toLowerCase()].onlineSince || 0));
    targetBot = onlineBots[0];
  }
  const hubAuth = hubAuthHeader();
  if (!hubAuth) {
    await sendMessage(chatId, '❌ HUB_API_TOKEN не задан.');
    return;
  }
  const resp = await fetch('http://localhost:8089/command', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': hubAuth
    },
    body: JSON.stringify({ targetBot: targetBot.toLowerCase(), action: 'chat', text, ownerChatId: String(chatId) })
  });
  if (!resp.ok) {
    if (resp.status === 404) {
      await sendMessage(chatId, `❌ Бот *${escapeMarkdown(targetBot)}* офлайн.`);
    } else {
      await sendMessage(chatId, `❌ Ошибка отправки сообщения боту *${escapeMarkdown(targetBot)}* (статус ${resp.status}).`);
    }
    return;
  }
  await sendMessage(chatId, `✉️ Отправлено от *${escapeMarkdown(targetBot)}*: ${escapeMarkdown(text)}`);
}

async function relayMediaMessage(message) {
  const chatId = message.chat.id;
  const approved = await readJSON(APPROVED_FILE);
  const userTwins = approved[chatId] || [];
  const mainsApproved = await readJSON(MAINS_APPROVED_FILE);
  const userMains = mainsApproved[chatId] || [];
  if (userTwins.length === 0 && userMains.length === 0) {
    await sendMessage(chatId, '❌ У тебя нет привязанных твинков.');
    return;
  }

  const media = detectMedia(message);
  if (!media) return;

  const captionRaw = message.caption || '';
  let replyNick = null;
  if (message.reply_to_message && message.reply_to_message.text) {
    replyNick = extractReplyNick(message.reply_to_message.text);
  }
  const globalModes = await readJSON(GLOBAL_MODE_FILE);
  const isGlobal = !!globalModes[chatId];
  const caption = buildCaption(captionRaw, replyNick, isGlobal);

  let buffer = await downloadTelegramMedia(media.fileId);
  if (!buffer) {
    await sendMessage(chatId, '❌ Не удалось скачать гифку.');
    return;
  }
  let ext = media.ext;
  if (ext !== 'gif' && isRealGif(buffer)) ext = 'gif';          // TG mislabeled a real gif as mp4
  if (ext === 'mp4' && !isRealGif(buffer)) {                    // mp4 masquerade → convert to real gif
    const gif = await mp4ToGif(buffer);
    if (gif) { buffer = gif; ext = 'gif'; }                     // else: keep mp4 — still works
  }
  const url = await uploadToUguu(buffer, ext) || await uploadToHub(buffer, ext);
  if (!url) {
    await sendMessage(chatId, '❌ Хостинг гифок недоступен, попробуй позже.');
    return;
  }

  let out;
  if (caption) {
    await sendToGame(chatId, caption);
    await sleep(1100);                       // dodge 'Wait 1 sec.' throttle between two sends
    out = isGlobal ? `!${url}` : url;
  } else {
    const marker = replyNick ? ` (отвечая "${replyNick}")` : '';
    out = `${isGlobal ? '!' : ''}${url}${marker}`;
  }
  await sendToGame(chatId, out);
}

async function initBotMenu() {
  await telegramAPI('setMyCommands', {
    commands: [
      { command: 'start', description: 'Главное меню чата' },
      { command: 'streamon', description: 'Включить дублирование чата (/streamon <бот>)' },
      { command: 'streamoff', description: 'Выключить дублирование чата (/streamoff <бот>)' },
      { command: 'display', description: 'Режим отображения имен (/display <mode>)' },
      { command: 'status', description: 'Статус потоков чата' },
      { command: 'setchat', description: 'Выбрать отправителя (/setchat <1|2|main>)' },
      { command: 'globalon', description: 'Включить глобальный чат (!)' },
      { command: 'globaloff', description: 'Выключить глобальный чат (!)' }
    ]
  });
}

if (require.main === module) {
  initBotMenu();
  console.log('[Telegram Chat Bot] Запущен и слушает чат-потоки...');
}

async function poll() {
  try {
    const updates = await telegramAPI('getUpdates', { offset, timeout: 30 });
    if (updates && Array.isArray(updates)) {
      for (const update of updates) {
        offset = update.update_id + 1;
        if (!update.message) continue;
        if (!update.message.text) {
          if (detectMedia(update.message)) {
            try {
              await relayMediaMessage(update.message);
            } catch (e) {
              console.error('[Telegram Chat Bot Media Error]:', e.message);
            }
          }
          continue;
        }

        const chatId = update.message.chat.id;
        const text = update.message.text.trim();
        const parts = text.split(' ');
        const cmd = parts[0].toLowerCase();

        const approved = await readJSON(APPROVED_FILE);
        const userTwins = approved[chatId] || [];
        const mainsApproved = await readJSON(MAINS_APPROVED_FILE);
        const userMains = mainsApproved[chatId] || [];
        const userBots = [...userMains, ...userTwins];

        if (!text.startsWith('/')) {
          if (userBots.length === 0) {
            await sendMessage(chatId, '❌ У тебя нет привязанных твинков.');
            continue;
          }
          let messageToSend = text;
          if (update.message.reply_to_message && update.message.reply_to_message.text) {
            const replyNick = extractReplyNick(update.message.reply_to_message.text);
            if (replyNick) {
              messageToSend = `${text} (отвечая "${replyNick}")`;
            }
          }
          const globalModes = await readJSON(GLOBAL_MODE_FILE);
          if (globalModes[chatId]) {
            messageToSend = `!${messageToSend}`;
          }
          await sendToGame(chatId, messageToSend);
          continue;
        }

        if (cmd === '/setchat') {
          const target = parts[1] ? parts[1].toLowerCase() : null;
          if (!target || !['1', '2', 'main'].includes(target)) {
            await sendMessage(chatId, '❌ Использование: /setchat <1|2|main>');
            continue;
          }
          let resolved = null;
          if (target === 'main') {
            resolved = userMains[0] || (isAdminChat(chatId) ? getMainAccount() : null);
          } else {
            const index = parseInt(target) - 1;
            resolved = userTwins[index];
            if (!resolved) {
              await sendMessage(chatId, `❌ У тебя нет ${target}-го твинка.`);
              continue;
            }
          }
          if (!resolved) {
            await sendMessage(chatId, '❌ Мейн не настроен (MAIN_ACCOUNT пуст).');
            continue;
          }
          if (!isChatSenderAllowed(userBots, resolved.toLowerCase(), { isAdminChat: isAdminChat(chatId), mainAccount: getMainAccount() })) {
            await sendMessage(chatId, '❌ Отправитель не привязан к твоему аккаунту.');
            continue;
          }
          const selection = await apiGet('chat_sender_selection', {});
          selection[chatId] = resolved.toLowerCase();
          await apiSet('chat_sender_selection', selection);
          await sendMessage(chatId, `✅ Сообщения будут отправляться с бота *${escapeMarkdown(resolved)}*.`);
        }
        else if (cmd === '/start') {
          await sendMessage(chatId, `💬 *Twins Chat Stream Bot*\n\nЭтот бот управляет дублированием игрового чата твинков.\n\nТвои привязанные твинки: ${userBots.length > 0 ? userBots.map(escapeMarkdown).join(', ') : 'нет (привяжи через мейн-бота)'}\n\nКоманды:\n\`/streamon <алиас или ник>\` - вкл. трансляцию\n\`/streamoff <алиас или ник>\` - выкл. трансляцию\n\`/setchat <1|2|main>\` - выбрать отправителя\n\`/display <alias|nick|both|hidden>\` - режим отображения\n\`/globalon\` - вкл. глобальный чат (!)\n\`/globaloff\` - выкл. глобальный чат (!)`);
        }
        else if (cmd === '/globalon') {
          const globalModes = await readJSON(GLOBAL_MODE_FILE);
          globalModes[chatId] = true;
          await writeJSON(GLOBAL_MODE_FILE, globalModes);
          await sendMessage(chatId, '✅ Режим глобального чата (`!`) включен.');
        }
        else if (cmd === '/globaloff') {
          const globalModes = await readJSON(GLOBAL_MODE_FILE);
          globalModes[chatId] = false;
          await writeJSON(GLOBAL_MODE_FILE, globalModes);
          await sendMessage(chatId, '✅ Режим глобального чата (`!`) выключен.');
        }
        else if (cmd === '/streamon' || cmd === '/chaton') {
          if (userBots.length === 0) {
            await sendMessage(chatId, '❌ У тебя нет привязанных твинков. Сначала привяжи их через главного бота.');
            continue;
          }
          const targetArg = parts[1];
          if (!targetArg) {
            await sendMessage(chatId, `❌ Укажи твинка: \`/streamon <алиас или ник>\`\nДоступные: ${userBots.map(escapeMarkdown).join(', ')}`);
            continue;
          }

          const targetBot = await resolveBot(chatId, targetArg);
          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${escapeMarkdown(targetArg)}' не найден в твоем списке привязанных ботов.`);
            continue;
          }

          const streaming = await readJSON(STREAMING_FILE);
          if (!streaming[chatId]) streaming[chatId] = {};
          streaming[chatId][targetBot.toLowerCase()] = true;
          await writeJSON(STREAMING_FILE, streaming);

          await sendMessage(chatId, `🟢 Трансляция чата для твинка *${escapeMarkdown(targetBot)}* включена в этот чат.`);
        }
        else if (cmd === '/streamoff' || cmd === '/chatoff') {
          if (userBots.length === 0) {
            await sendMessage(chatId, '❌ У тебя нет привязанных твинков.');
            continue;
          }
          const targetArg = parts[1];
          if (!targetArg) {
            await sendMessage(chatId, `❌ Укажи твинка: \`/streamoff <алиас или ник>\``);
            continue;
          }

          const targetBot = await resolveBot(chatId, targetArg);
          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${escapeMarkdown(targetArg)}' не найден.`);
            continue;
          }

          const streaming = await readJSON(STREAMING_FILE);
          if (streaming[chatId]) {
            streaming[chatId][targetBot.toLowerCase()] = false;
            await writeJSON(STREAMING_FILE, streaming);
          }

          await sendMessage(chatId, `🔴 Трансляция чата для твинка *${escapeMarkdown(targetBot)}* выключена.`);
        }
        else if (cmd === '/display' || cmd === '/mode') {
          const modeArg = parts[1] ? parts[1].toLowerCase() : '';
          const validModes = ['alias', 'nick', 'both', 'hidden'];

          if (!validModes.includes(modeArg)) {
            await sendMessage(chatId, '❌ Использование: `/display <alias | nick | both | hidden>`\n- `alias` — алиас (если нет, то ник)\n- `nick` — только ник\n- `both` — алиас / ник\n- `hidden` — скрывать ник/алиас');
            continue;
          }

          const modes = await readJSON(DISPLAY_MODE_FILE);
          modes[chatId] = modeArg;
          await writeJSON(DISPLAY_MODE_FILE, modes);

          await sendMessage(chatId, `✅ Режим отображения имен в чате установлен на: *${escapeMarkdown(modeArg)}*`);
        }
        else if (cmd === '/status' || cmd === '/list') {
          if (userBots.length === 0) {
            await sendMessage(chatId, '📭 У тебя нет привязанных ботов. Привяжи их через мейн-бота.');
          } else {
            const streaming = await readJSON(STREAMING_FILE);
            const userStream = streaming[chatId] || {};
            const aliases = (await readJSON(ALIASES_FILE))[chatId] || {};
            const modes = await readJSON(DISPLAY_MODE_FILE);
            const currentMode = modes[chatId] || 'alias';
            const globalModes = await readJSON(GLOBAL_MODE_FILE);
            const isGlobal = !!globalModes[chatId];
            
            let msg = `💬 *Статус трансляций чата (режим: ${escapeMarkdown(currentMode)}, глобальный чат: ${isGlobal ? '🟢 ВКЛ' : '🔴 ВЫКЛ'}):*\n\n`;
            userMains.forEach((botName) => {
              const isStreaming = !!userStream[botName.toLowerCase()];
              msg += `• *${escapeMarkdown(botName)}* (мейн-бот)\n   Трансляция в ТГ: ${isStreaming ? '🟢 ВКЛ' : '🔴 ВЫКЛ'}\n\n`;
            });
            userTwins.forEach((botName, index) => {
              const isStreaming = !!userStream[botName.toLowerCase()];
              const alias = `bot${index + 1}`;
              const customAliases = Object.entries(aliases)
                .filter(([al, rb]) => rb.toLowerCase() === botName.toLowerCase())
                .map(([al]) => al);

              msg += `• *${escapeMarkdown(botName)}* (системный: \`${alias}\``;
              if (customAliases.length > 0) {
                msg += `, алиасы: \`${customAliases.map(escapeMarkdown).join(', ')}\``;
              }
              msg += `)\n   Трансляция в ТГ: ${isStreaming ? '🟢 ВКЛ' : '🔴 ВЫКЛ'}\n\n`;
            });
            await sendMessage(chatId, msg);
          }
        }
      }
    }
  } catch (e) {
    console.error('[Telegram Chat Bot Polling Error]:', e.message);
  }
  setTimeout(poll, 1000);
}

if (require.main === module) poll();

function decideChatSender({ userBots, selectedLower, chatId, adminId, mainAccount }) {
  const isAdmin = !!adminId && chatId.toString() === adminId;
  const allowed = isChatSenderAllowed(userBots, selectedLower, { isAdminChat: isAdmin, mainAccount });
  const targetBot = allowed ? selectedLower : null;
  return { allowed, targetBot };
}

module.exports = { detectMedia, mediaExt, buildCaption, uploadToHub, uploadToUguu, isRealGif, mp4ToGif, decideChatSender };
