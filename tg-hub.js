const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { get, set } = require('./db.js');

const clients = new Map();

require('dotenv').config();

const TOKEN = process.env.TG_BOT_TOKEN;
if (!TOKEN) {
  console.log('[Telegram] TG_BOT_TOKEN не задан в .env. Телеграм-хаб отключен.');
  process.exit(0);
}

const http = require('http');

// API Server (Port 8089) - initialized explicitly for visibility
const apiServer = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/command' && req.method === 'POST') {
        const auth = req.headers['authorization'];
        if (!auth || !auth.startsWith('Bearer ')) {
            res.writeHead(401); res.end('Unauthorized'); return;
        }
        const token = auth.split(' ')[1];
        const tokens = get('bot_tokens', {});
        let authorizedBot = null;
        for (const [name, t] of Object.entries(tokens)) {
            if (t === token) { authorizedBot = name; break; }
        }
        const isSystemToken = (token === process.env.TG_BOT_TOKEN || token === process.env.TG_CHAT_BOT_TOKEN || token === TOKEN);
        console.log(`[API] /command auth check: authorizedBot=${authorizedBot}, isSystemToken=${isSystemToken}`);

        if (!authorizedBot && !isSystemToken) {
            res.writeHead(403); res.end('Forbidden'); return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const command = JSON.parse(body);
                const targetBot = isSystemToken ? command.targetBot : (command.targetBot || authorizedBot);
                if (!targetBot) {
                    res.writeHead(400); res.end('Missing targetBot'); return;
                }
                if (sendCommand(targetBot, command)) {
                    res.writeHead(200); res.end('OK');
                } else {
                    res.writeHead(404); res.end('Bot offline');
                }
            } catch (e) {
                res.writeHead(400); res.end('Invalid JSON');
            }
        });
    } else if (pathname === '/state') {
        const auth = req.headers['authorization'];
        if (!auth || !auth.startsWith('Bearer ')) {
            res.writeHead(401); res.end('Unauthorized'); return;
        }
        const token = auth.split(' ')[1];
        const tokens = get('bot_tokens', {});
        const isValidToken = Object.values(tokens).includes(token) || token === process.env.TG_BOT_TOKEN || token === process.env.TG_CHAT_BOT_TOKEN || token === TOKEN;

        if (!isValidToken) {
            res.writeHead(403); res.end('Forbidden'); return;
        }

        if (req.method === 'GET') {
            const key = parsedUrl.searchParams.get('key');
            if (!key) {
                res.writeHead(400); res.end('Missing key'); return;
            }
            const value = get(key, {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(value));
        } else if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { key, value } = JSON.parse(body);
                    if (!key) {
                        res.writeHead(400); res.end('Missing key'); return;
                    }
                    set(key, value);
                    res.writeHead(200); res.end('OK');
                } catch (e) {
                    res.writeHead(400); res.end('Invalid JSON');
                }
            });
        } else {
            res.writeHead(405); res.end('Method Not Allowed');
        }
    } else {
        res.writeHead(404); res.end();
    }
});

apiServer.listen(8089, '0.0.0.0', () => {
    console.log('[API] Шлюз запущен на порту 8089');
});

const wss = new WebSocket.Server({ server: apiServer });
console.log('[Bridge] WebSocket-сервер запущен на порту 8089 (через API Server)');

const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log(`[Bridge] Клиент ${ws.botName || 'unknown'} не ответил на ping, обрываем соединение.`);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

wss.on('connection', (socket, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const botName = url.searchParams.get('bot');

    if (!botName) {
        socket.close();
        return;
    }

    const approved = readJSON(APPROVED_FILE);
    const mainsApproved = readJSON(MAINS_APPROVED_FILE);
    let ownerId = null;
    for (const [chatId, bots] of Object.entries(approved)) {
        if (bots.some(b => b.toLowerCase() === botName.toLowerCase())) {
            ownerId = chatId;
            break;
        }
    }
    if (!ownerId) {
        for (const [chatId, bots] of Object.entries(mainsApproved)) {
            if (bots.some(b => b.toLowerCase() === botName.toLowerCase())) {
                ownerId = chatId;
                break;
            }
        }
    }

    if (!ownerId) {
        console.log(`[Bridge] Отклонено: бот ${botName} не привязан.`);
        socket.close();
        return;
    }

    socket.botName = botName.toLowerCase();
    socket.ownerId = ownerId;
    socket.isAuthed = false;
    socket.isAlive = true;

    socket.on('pong', () => {
        socket.isAlive = true;
    });

    const authTimeout = setTimeout(() => {
        if (!socket.isAuthed) {
            console.log(`[Bridge] Таймаут авторизации для бота ${socket.botName}.`);
            socket.close();
        }
    }, 5000);

    socket.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            if (!socket.isAuthed) {
                if (message.type === 'auth') {
                    const userTokens = get('user_tokens', {});
                    if (message.token !== userTokens[ownerId]) {
                        console.log(`[AUTH DEBUG] Получен токен: ${message.token}, Ожидался: ${userTokens[ownerId]}, OwnerId: ${ownerId}`);
                        console.log(`[Bridge] Отклонено: неверный токен для бота ${socket.botName}.`);
                        clearTimeout(authTimeout);
                        socket.close();
                        return;
                    }
                    socket.isAuthed = true;
                    clearTimeout(authTimeout);
                    clients.set(socket.botName, socket);
                    console.log(`[Bridge] Бот ${socket.botName} авторизован и подключен.`);
                    return;
                } else {
                    console.log(`[Bridge] Ожидалось сообщение авторизации от ${socket.botName}, получено:`, message);
                    clearTimeout(authTimeout);
                    socket.close();
                    return;
                }
            }

            if (message.action === 'response') {
                console.log(`[Bridge Debug] Received 'response' action from bot ${socket.botName}:`, message);
                const chatId = message.chatId || socket.ownerId;
                if (chatId && message.text) {
                    sendMessage(chatId, message.text, message.parseMode || null);
                } else {
                    console.log(`[Bridge] Warning: 'response' action missing chatId or text. socket.ownerId=${socket.ownerId}, message:`, message);
                }
                return;
            }
        } catch (e) {
            console.error('[Bridge] Ошибка обработки сообщения:', e);
        }
    });

    socket.on('close', () => {
        clearTimeout(authTimeout);
        if (clients.get(socket.botName) === socket) {
            clients.delete(socket.botName);
            console.log(`[Bridge] Бот ${socket.botName} отключен.`);
        } else {
            console.log(`[Bridge] Устаревшее соединение бота ${socket.botName} закрыто.`);
        }
    });
});

function sendCommand(botName, command) {
  const client = clients.get(botName.toLowerCase());
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(command));
    return true;
  }
  return false;
}

const APPROVED_FILE = 'links_approved';
const MAINS_PENDING_FILE = 'mains_pending';
const MAINS_APPROVED_FILE = 'mains_approved';
const STATUS_FILE = 'bots_status';
const STREAMING_FILE = 'chat_streaming';
const ALIASES_FILE = 'bot_aliases';
const LOCK_FILE = 'registration_lock';
const MEOW_FILE = 'meow_settings';
const AUTORESPECT_FILE = 'autorespect_settings';


const ADMIN_ID = process.env.ADMIN_TG_ID ? process.env.ADMIN_TG_ID.trim() : '';

function isAdmin(chatId) {
  return ADMIN_ID && chatId.toString() === ADMIN_ID;
}

function isRegistrationLocked() {
  const data = get(LOCK_FILE, { locked: false });
  return !!data.locked;
}

function readJSON(key) {
  return get(key, {});
}

function readJSONArray(key) {
  const data = get(key, []);
  return Array.isArray(data) ? data : [];
}

function writeJSON(key, data) {
  set(key, data);
}

function generateToken(chatId) {
  try {
    const token = execSync('openssl rand -hex 32').toString().trim();
    const userTokens = get('user_tokens', {});
    userTokens[chatId] = token;
    set('user_tokens', userTokens);
    return token;
  } catch (e) {
    const token = crypto.randomBytes(32).toString('hex');
    const userTokens = get('user_tokens', {});
    userTokens[chatId] = token;
    set('user_tokens', userTokens);
    return token;
  }
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
    console.log('[Bridge Debug] telegramAPI вернул null для метода', method);
    return null;
  }
}

async function sendMessage(chatId, text, parseMode = null) {
  const body = {
    chat_id: chatId,
    text
  };
  if (parseMode) {
    body.parse_mode = parseMode;
  }
  await telegramAPI('sendMessage', body);
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h} ч. ${m} мин.`;
  return `${m} мин.`;
}

function parseDuration(str) {
  const match = str.toLowerCase().match(/^(\d+)([smh]?)$/);
  if (!match) return NaN;
  const val = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'm') return val * 60;
  if (unit === 'h') return val * 3600;
  return val; // s or none
}

function resolveBot(chatId, targetArg) {
  const approved = readJSON(APPROVED_FILE);
  const userTwins = approved[chatId] || [];
  const mainsApproved = readJSON(MAINS_APPROVED_FILE);
  const userMains = mainsApproved[chatId] || [];
  const aliases = readJSON(ALIASES_FILE)[chatId] || {};
  const searchKey = targetArg.toLowerCase();

  if (aliases[searchKey]) {
    return aliases[searchKey];
  }
  if (searchKey === 'main' && userMains[0]) {
    return userMains[0];
  }
  if ((searchKey === 'bot1' || searchKey === '1') && userTwins[0]) {
    return userTwins[0];
  }
  if ((searchKey === 'bot2' || searchKey === '2') && userTwins[1]) {
    return userTwins[1];
  }
  const foundTwin = userTwins.find(b => b.toLowerCase() === searchKey);
  if (foundTwin) return foundTwin;
  const foundMain = userMains.find(b => b.toLowerCase() === searchKey);
  if (foundMain) return foundMain;
  return null;
}

async function initBotMenu() {
  await telegramAPI('setMyCommands', {
    commands: [
      { command: 'start', description: 'Главное меню' },
      { command: 'gettoken', description: 'Получить токен' },
      { command: 'addmain', description: 'Привязать мейн-бота (/addmain <ник>)' },
      { command: 'delmain', description: 'Отвязать мейн-бота (/delmain <ник>)' },
      { command: 'addtwin', description: 'Привязать твинка (/addtwin <ник>)' },
      { command: 'deltwin', description: 'Отвязать твинка (/deltwin <ник>)' },
      { command: 'alias', description: 'Задать алиас (/alias <бот> <алиас>)' },
      { command: 'unalias', description: 'Удалить алиас (/unalias <алиас>)' },
      { command: 'starttwin', description: 'Запустить твинка (/starttwin <алиас>)' },
      { command: 'stoptwin', description: 'Остановить твинка (/stoptwin <алиас>)' },
      { command: 'startmain', description: 'Запустить мейн-бота (/startmain)' },
      { command: 'stopmain', description: 'Остановить мейн-бота (/stopmain)' },
      { command: 'chat', description: 'Написать в чат (/chat <алиас> <текст>)' },
       { command: 'meowon', description: 'Вкл. мяуканье (/meowon <алиас>)' },
       { command: 'meowoff', description: 'Выкл. мяуканье (/meowoff <алиас>)' },
       { command: 'meowcd', description: 'Кулдаун мяуканья (/meowcd <алиас> <время>)' },
      { command: 'autorepon', description: 'Вкл. авто-респекты (/autorepon <алиас>)' },
      { command: 'autorepoff', description: 'Выкл. авто-респекты (/autorepoff <алиас>)' },
      { command: 'status', description: 'Статус привязанных ботов' },
      { command: 'players', description: 'Список игроков онлайн (/players <бот>)' },
      { command: 'spamlist', description: 'Список спам-задач' },
      { command: 'addspam', description: 'Добавить спам (/addspam <алиас> <сек> <текст>)' },
      { command: 'delspam', description: 'Удалить спам-задачу (/delspam <алиас> <номер>)' },
      { command: 'autoclickon', description: 'Вкл. автокликер (/autoclickon <алиас>)' },
      { command: 'autoclickoff', description: 'Выкл. автокликер (/autoclickoff <алиас>)' },
      { command: 'setswing', description: 'Тайминг удара (/setswing <алиас> <мс|auto>)' },
      { command: 'pos', description: 'Координаты (/pos <алиас>)' },
      { command: 'stopspam', description: 'Остановить весь спам' },
      { command: 'lock', description: 'Заблокировать регистрацию (админ)' },
      { command: 'unlock', description: 'Разблокировать регистрацию (админ)' },
      { command: 'users', description: 'Список пользователей (админ)' },
      { command: 'testserver', description: 'На тестовый сервер (админ)' },
      { command: 'mainserver', description: 'На основной сервер (админ)' },
       { command: 'setserver', description: 'Сменить сервер (админ) (/setserver <ip> <port>)' },
        { command: 'voice', description: 'Управление Discord-войсом (/voice <1|2> <on|off|reconnect|channel|status>)' },
        { command: 'mainstreamon', description: 'Вкл. дублирование чата мейна (/mainstreamon)' },
        { command: 'mainstreamoff', description: 'Выкл. дублирование чата мейна (/mainstreamoff)' },
        { command: 'mainstreamallon', description: 'Вкл. дублирование ВСЕГО чата мейна (/mainstreamallon)' },
        { command: 'mainstreamalloff', description: 'Выкл. дублирование ВСЕГО чата мейна (/mainstreamalloff)' },
      { command: 'setservice', description: 'Привязать бота к сервису (/setservice <ник> <сервис>)' }
      ]
    });
  }

initBotMenu();
setTimeout(() => { notifyVpsRestart(); }, 2000);

async function notifyVpsRestart() {
  try {
    if (!ADMIN_ID) return;
    const text = '🔄 *VPS / Twins Hub перезапущен* (сервис возобновлен)';
    await sendMessage(ADMIN_ID, text, 'Markdown');
  } catch (e) {}
}

console.log('[Telegram] Хаб запущен и слушает сообщения...');

async function poll() {
  console.log('[Bridge Debug] Функция poll() начала выполнение.');
  try {
    console.log('[Bridge Debug] Запрос обновлений (offset:', offset, ')');
    const updates = await telegramAPI('getUpdates', { offset, timeout: 30 });
    console.log('[Bridge Debug] Ответ API (кол-во обновлений):', updates ? updates.length : 'null');
    if (updates && Array.isArray(updates)) {
      for (const update of updates) {
        offset = update.update_id + 1;
        if (!update.message || !update.message.text) continue;

        const chatId = update.message.chat.id;
        const text = update.message.text.trim();
        console.log('[Bridge Debug] Получено сообщение:', text);
        const parts = text.split(' ');
        const cmd = parts[0].toLowerCase();

        if (cmd === '/start') {
          let msg = '🤖 *Twins Telegram Hub*\n\nТвой Telegram зарегистрирован как основной.\n\nКоманды управления:\n`/gettoken` - получить токен для подключения\n`/addtwin <ник>` - привязать твинка\n`/deltwin <ник>` - отвязать твинка\n`/alias <бот> <алиас>` - задать алиас\n`/unalias <алиас>` - удалить алиас\n`/starttwin <алиас>` - запустить твинка\n`/stoptwin <алиас>` - остановить твинка\n`/startmain` - запустить мейн-бота\n`/stopmain` - остановить мейн-бота\n`/status` - список и статус ботов\n`/players <бот>` - онлайн игроков\n`/chat <алиас> <текст>` - написать в чат\n`/meowon <алиас>` - вкл. мяуканье\n`/meowoff <алиас>` - выкл. мяуканье\n`/meowcd <алиас> <время>` - кулдаун мяуканья\n`/autorepon <алиас>` - вкл. авто-респекты\n`/autorepoff <алиас>` - выкл. авто-респекты\n`/spamlist <алиас>` - список спам-задач\n`/addspam <алиас> <сек> <текст>` - добавить спам-задачу\n`/delspam <алиас> <номер>` - удалить спам-задачу\n`/autoclickon <алиас>` - вкл. автокликер\n`/autoclickoff <алиас>` - выкл. автокликер\n`/setswing <алиас> <мс|auto>` - тайминг удара\n`/pos <алиас>` - координаты твинка\n`/mainstreamallon` - дублировать ВЕСЬ чат мейна\n`/mainstreamalloff` - только сообщения с ником мейна\n`/stopspam` - остановить спам';
          if (isAdmin(chatId)) {
            msg += '\n\n👑 *Админ-панель:*\nСтатус регистрации: ' + (isRegistrationLocked() ? '🔴 Заблокирована' : '🟢 Открыта') + '\n`/lock` - заблокировать\n`/unlock` - разблокировать\n`/users` - список юзеров\n`/testserver` - на тестовый\n`/mainserver` - на основной\n`/setserver <ip> <port>` - сменить сервер';
          }
          await sendMessage(chatId, msg);
        }
        else if (cmd === '/gettoken') {
            try {
                console.log('[TokenDebug] Команда /gettoken вызвана для:', chatId);
                const token = generateToken(chatId);
                console.log('[TokenDebug] Токен сохранен:', token);
                await sendMessage(chatId, `🔑 Твой токен: \`${token}\``);
            } catch (e) {
                console.error('[TokenDebug] Ошибка:', e);
                await sendMessage(chatId, '❌ Ошибка при генерации токена.');
            }
        }
        else if (cmd === '/autorepon' || cmd === '/autorepoff') {
          const userBots = (readJSON(APPROVED_FILE)[chatId] || []);
          if (userBots.length === 0) {
            await sendMessage(chatId, '❌ У тебя нет привязанных твинков.');
            continue;
          }
          const targetArg = parts[1];
          if (!targetArg) {
            await sendMessage(chatId, `❌ Укажи твинка: \`${cmd} <алиас или ник>\`\nДоступные: ${userBots.join(', ')}`);
            continue;
          }

          const targetBot = resolveBot(chatId, targetArg);
          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден.`);
            continue;
          }

          if (!clients.has(targetBot.toLowerCase())) {
            await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
            continue;
          }

           const enabled = cmd === '/autorepon';
           sendCommand(targetBot, { action: 'setAutoRespect', enabled });

           await sendMessage(chatId, `✅ Авто-выдача респектов для твинка *${targetBot}* ${enabled ? 'ВКЛ' : 'ВЫКЛ'}.`);
        }
        else if (cmd === '/meowon' || cmd === '/meowoff') {
          const userBots = (readJSON(APPROVED_FILE)[chatId] || []);
          if (userBots.length === 0) {
            await sendMessage(chatId, '❌ У тебя нет привязанных твинков.');
            continue;
          }
          const targetArg = parts[1];
          if (!targetArg) {
            await sendMessage(chatId, `❌ Укажи твинка: \`${cmd} <алиас или ник>\`\nДоступные: ${userBots.join(', ')}`);
            continue;
          }

          const targetBot = resolveBot(chatId, targetArg);
          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден.`);
            continue;
          }

          if (!clients.has(targetBot.toLowerCase())) {
            await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
            continue;
          }

           const enabled = cmd === '/meowon';
           sendCommand(targetBot, { action: 'setMeow', enabled });

           await sendMessage(chatId, `✅ Режим "мяу" для твинка *${targetBot}* ${enabled ? 'ВКЛ' : 'ВЫКЛ'}.`);


        }
        else if (cmd === '/meowcd') {
          const userBots = (readJSON(APPROVED_FILE)[chatId] || []);
          if (userBots.length === 0) {
            await sendMessage(chatId, '❌ У тебя нет привязанных твинков.');
            continue;
          }
          const targetArg = parts[1];
          const timeArg = parts[2];
          if (!targetArg || !timeArg) {
            await sendMessage(chatId, '❌ Использование: `/meowcd <алиас или ник> <время>` (например, `/meowcd bot1 2` или `/meowcd bot1 30s`)');
            continue;
          }

          const targetBot = resolveBot(chatId, targetArg);
          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден.`);
            continue;
          }

          if (!clients.has(targetBot.toLowerCase())) {
            await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
            continue;
          }

          const seconds = /[smh]$/i.test(timeArg) ? parseDuration(timeArg) : parseInt(timeArg, 10) * 60;
          if (isNaN(seconds) || seconds <= 0) {
            await sendMessage(chatId, '❌ Неверный формат времени. Используйте минуты (например, `2`) или с суффиксом (`30s`, `2m`, `1h`).');
            continue;
          }

          const cooldownMs = seconds * 1000;
          sendCommand(targetBot, { action: 'setMeow', cooldownMs });

          await sendMessage(chatId, `✅ Кулдаун "мяу" для твинка *${targetBot}* установлен на ${timeArg} (${seconds} сек).`);
        }
        else if (cmd === '/mainstreamon' || cmd === '/mainstreamoff') {
          const enabled = cmd === '/mainstreamon';
          const streaming = readJSON('main_chat_streaming');
          streaming[chatId] = enabled;
          writeJSON('main_chat_streaming', streaming);
          await sendMessage(chatId, `✅ Трансляция чата мейна ${enabled ? 'ВКЛ' : 'ВЫКЛ'}.`);
        }
        else if (cmd === '/mainstreamallon' || cmd === '/mainstreamalloff') {
          const enabled = cmd === '/mainstreamallon';
          const streamAll = readJSON('main_chat_stream_all');
          streamAll[chatId] = enabled;
          writeJSON('main_chat_stream_all', streamAll);
          const twinStream = readJSON('chat_streaming');
          const backup = readJSON('main_chat_stream_backup');
          if (enabled) {
            if (!backup[chatId]) {
              backup[chatId] = JSON.parse(JSON.stringify(twinStream[chatId] || {}));
            }
            twinStream[chatId] = {};
            writeJSON('main_chat_stream_backup', backup);
            writeJSON('chat_streaming', twinStream);
            await sendMessage(chatId, '✅ Дублирование ВСЕГО чата мейна ВКЛ. Стриминг твинков выключен.');
          } else {
            if (backup[chatId]) {
              twinStream[chatId] = backup[chatId];
              delete backup[chatId];
              writeJSON('main_chat_stream_backup', backup);
              writeJSON('chat_streaming', twinStream);
              await sendMessage(chatId, '✅ Дублирование ВСЕГО чата мейна ВЫКЛ. Стриминг твинков восстановлен.');
            } else {
              await sendMessage(chatId, '✅ Дублирование ВСЕГО чата мейна ВЫКЛ.');
            }
          }
        }
        else if (cmd === '/gentoken') {
          if (!isAdmin(chatId)) { await sendMessage(chatId, '❌ Нет прав.'); continue; }
          const botNick = parts[1] ? parts[1].toLowerCase() : null;
          if (!botNick) { await sendMessage(chatId, '❌ Использование: /gentoken <ник>'); continue; }
          
          const token = crypto.randomBytes(32).toString('hex');
          const tokens = get('bot_tokens', {});
          tokens[botNick] = token;
          set('bot_tokens', tokens);
          await sendMessage(chatId, `🔑 Токен для *${botNick}*: \`${token}\``);
        }
        else if (cmd === '/lock' || cmd === '/adminlock') {
          if (!isAdmin(chatId)) {
            await sendMessage(chatId, '❌ У вас нет прав администратора.');
            continue;
          }
          writeJSON(LOCK_FILE, { locked: true });
          await sendMessage(chatId, '🔒 Регистрация новых твинков заблокирована для пользователей.');
        }
        else if (cmd === '/unlock' || cmd === '/adminunlock') {
          if (!isAdmin(chatId)) {
            await sendMessage(chatId, '❌ У вас нет прав администратора.');
            continue;
          }
          writeJSON(LOCK_FILE, { locked: false });
          await sendMessage(chatId, '🔓 Регистрация новых твинков разблокирована.');
        }
        else if (cmd === '/adminusers' || cmd === '/users') {
          if (!isAdmin(chatId)) {
            await sendMessage(chatId, '❌ У вас нет прав администратора.');
            continue;
          }
          const approved = readJSON(APPROVED_FILE);
          const entries = Object.entries(approved);
          if (entries.length === 0) {
            await sendMessage(chatId, '📭 Нет зарегистрированных пользователей с привязанными твинками.');
          } else {
            let msg = `👑 *Админ-панель: Список пользователей*\n\n`;
            entries.forEach(([uid, bots]) => {
              msg += `• Чат ID: \`${uid}\`\n  Твинки: ${bots.join(', ')}\n\n`;
            });
            await sendMessage(chatId, msg);
          }
        }
        else if (cmd === '/testserver' || cmd === '/movetest') {
          if (!isAdmin(chatId)) {
            await sendMessage(chatId, '❌ У вас нет прав администратора.');
            continue;
          }
          const host = process.env.TEST_SERVER_HOST;
          const port = process.env.TEST_SERVER_PORT;
          if (!host || !port) {
            await sendMessage(chatId, '❌ TEST_SERVER_HOST или TEST_SERVER_PORT не заданы в .env.');
            continue;
          }

          const approved = readJSON(APPROVED_FILE);
          let allBots = [];
          for (const bots of Object.values(approved)) {
            allBots.push(...bots);
          }

          if (allBots.length === 0) {
            await sendMessage(chatId, '📭 Нет активных привязанных ботов для переключения.');
            continue;
          }

          allBots.forEach(botName => {
            sendCommand(botName, { action: 'switchServer', host, port });
          });

          await sendMessage(chatId, `🚀 Команда переключения на тестовый сервер (${host}:${port}) отправлена для всех ботов!`);
        }
        else if (cmd === '/mainserver' || cmd === '/prodserver') {
          if (!isAdmin(chatId)) {
            await sendMessage(chatId, '❌ У вас нет прав администратора.');
            continue;
          }
          const host = process.env.MAIN_SERVER_HOST || '5.83.140.251';
          const port = process.env.MAIN_SERVER_PORT || 25809;

          const approved = readJSON(APPROVED_FILE);
          let allBots = [];
          for (const bots of Object.values(approved)) {
            allBots.push(...bots);
          }

          if (allBots.length === 0) {
            await sendMessage(chatId, '📭 Нет активных привязанных ботов для переключения.');
            continue;
          }

          allBots.forEach(botName => {
            sendCommand(botName, { action: 'switchServer', host, port });
          });

          await sendMessage(chatId, `🚀 Команда переключения на основной сервер (${host}:${port}) отправлена для всех ботов!`);
        }

        else if (cmd === '/voice') {
          if (!isAdmin(chatId)) {
            await sendMessage(chatId, '❌ Нет прав.');
            continue;
          }
          const instance = parts[1];
          if (instance !== '1' && instance !== '2') {
            await sendMessage(chatId, '❌ Использование: /voice <1|2> <on|off|reconnect|channel|status>');
            continue;
          }
          const settings = get('discord_voice_' + instance, {});
          const action = parts[2] ? parts[2].toLowerCase() : '';

          if (action === 'on') {
            settings.enabled = true;
            set('discord_voice_' + instance, settings);
            await sendMessage(chatId, `✅ Discord-бот ${instance}: войс ВКЛ`);
          } else if (action === 'off') {
            settings.enabled = false;
            set('discord_voice_' + instance, settings);
            await sendMessage(chatId, `✅ Discord-бот ${instance}: войс ВЫКЛ`);
          } else if (action === 'reconnect') {
            const val = parts[3] ? parts[3].toLowerCase() : '';
            if (val !== 'on' && val !== 'off') {
              await sendMessage(chatId, '❌ Использование: /voice <1|2> reconnect <on|off>');
              continue;
            }
            settings.reconnect = (val === 'on');
            set('discord_voice_' + instance, settings);
            await sendMessage(chatId, `✅ Discord-бот ${instance}: автореконнект ${settings.reconnect ? 'ВКЛ' : 'ВЫКЛ'}`);
          } else if (action === 'channel') {
            const channelId = parts[3];
            if (!channelId || !/^\d{15,20}$/.test(channelId)) {
              await sendMessage(chatId, '❌ ID канала должен быть числом (15-20 цифр).');
              continue;
            }
            settings.channel_id = channelId;
            set('discord_voice_' + instance, settings);
            await sendMessage(chatId, `✅ Discord-бот ${instance}: канал ${channelId}`);
          } else if (action === 'status') {
            const statusMsg = `📋 *Discord-бот ${instance}:*\nСтатус: ${settings.enabled === false ? '🔴 Выключен' : '🟢 Включен'}\nАвтореконнект: ${settings.reconnect === false ? '❌ Выкл' : '✅ Вкл'}\nКанал: ${settings.channel_id || 'не задан'}`;
            await sendMessage(chatId, statusMsg);
            continue;
          } else {
            await sendMessage(chatId, '❌ Использование: /voice <1|2> <on|off|reconnect|channel|status>');
            continue;
          }
        }
        else if (cmd === '/addmain') {
          if (isRegistrationLocked() && !isAdmin(chatId)) {
            await sendMessage(chatId, '❌ Регистрация новых ботов временно заблокирована администратором.');
            continue;
          }

          const username = parts[1];
          if (!username) {
            await sendMessage(chatId, '❌ Укажи ник мейн-бота: `/addmain ИмяБота`');
            continue;
          }

          const mainsApproved = readJSON(MAINS_APPROVED_FILE);
          const approved = readJSON(APPROVED_FILE);

          let alreadyOwnedBy = null;
          for (const [ownerChatId, bots] of Object.entries(mainsApproved)) {
            if (bots.some(b => b.toLowerCase() === username.toLowerCase())) {
              alreadyOwnedBy = ownerChatId;
              break;
            }
          }
          if (!alreadyOwnedBy) {
            for (const [ownerChatId, bots] of Object.entries(approved)) {
              if (bots.some(b => b.toLowerCase() === username.toLowerCase())) {
                alreadyOwnedBy = ownerChatId;
                break;
              }
            }
          }

          if (alreadyOwnedBy && alreadyOwnedBy !== chatId.toString()) {
            await sendMessage(chatId, `❌ Этот мейн-аккаунт уже привязан к другому Telegram аккаунту.`);
            continue;
          }

          const userMains = mainsApproved[chatId] || [];
          const alreadyLinked = userMains.some(b => b.toLowerCase() === username.toLowerCase());
          if (!alreadyLinked && userMains.length >= 1) {
            await sendMessage(chatId, '❌ Достигнут лимит: можно привязать максимум 1 мейн-аккаунт.');
            continue;
          }

          const pending = readJSON(MAINS_PENDING_FILE);
          pending[username.toLowerCase()] = { chatId };
          writeJSON(MAINS_PENDING_FILE, pending);

          await sendMessage(chatId, `🔗 Запрос на привязку мейн-бота *${username}* добавлен.\n\nЗапусти этого мейн-бота локально — при входе в игру он автоматически привяжется к твоему Telegram!`);
        }
        else if (cmd === '/delmain') {
          const username = parts[1];
          if (!username) {
            await sendMessage(chatId, '❌ Укажи ник мейн-бота для отвязки: `/delmain ИмяБота`');
            continue;
          }
          const mainsApproved = readJSON(MAINS_APPROVED_FILE);
          if (mainsApproved[chatId]) {
            const index = mainsApproved[chatId].findIndex(b => b.toLowerCase() === username.toLowerCase());
            if (index !== -1) {
              mainsApproved[chatId].splice(index, 1);
              writeJSON(MAINS_APPROVED_FILE, mainsApproved);
              await sendMessage(chatId, `🗑 Мейн-бот *${username}* успешно отвязан.`);
            } else {
              await sendMessage(chatId, `❌ Мейн-бот *${username}* не найден в твоем списке.`);
            }
          } else {
            await sendMessage(chatId, `❌ У тебя нет привязанных мейн-ботов.`);
          }
        }
        else if (cmd === '/addtwin' || cmd === '/link') {
          if (isRegistrationLocked() && !isAdmin(chatId)) {
            await sendMessage(chatId, '❌ Регистрация новых твинков временно заблокирована администратором.');
            continue;
          }

          const username = parts[1];
          if (!username) {
            await sendMessage(chatId, '❌ Укажи ник твинка: `/addtwin ИмяБота`');
            continue;
          }

          const approved = readJSON(APPROVED_FILE);
          
          let alreadyOwnedBy = null;
          for (const [ownerChatId, bots] of Object.entries(approved)) {
            if (bots.some(b => b.toLowerCase() === username.toLowerCase())) {
              alreadyOwnedBy = ownerChatId;
              break;
            }
          }

          if (alreadyOwnedBy && alreadyOwnedBy !== chatId.toString()) {
            await sendMessage(chatId, `❌ Этот твинк уже привязан к другому Telegram аккаунту.`);
            continue;
          }

          const userBots = approved[chatId] || [];
          const alreadyLinked = userBots.some(b => b.toLowerCase() === username.toLowerCase());
          if (!alreadyLinked && userBots.length >= 2) {
            await sendMessage(chatId, '❌ Достигнут лимит: можно привязать максимум 2 твинка. Используй `/deltwin <ник>`.');
            continue;
          }

          if (!alreadyLinked) {
            if (!approved[chatId]) approved[chatId] = [];
            approved[chatId].push(username);
            writeJSON(APPROVED_FILE, approved);
            const token = generateToken(chatId);
            await sendMessage(chatId, `✅ Твинк *${username}* успешно привязан!\n\n🔑 Твой новый токен для .env: \`${token}\``);
          } else {
            await sendMessage(chatId, `ℹ️ Твинк *${username}* уже привязан к твоему аккаунту.`);
          }
        }
        else if (cmd === '/deltwin' || cmd === '/removetwin') {
          const username = parts[1];
          if (!username) {
            await sendMessage(chatId, '❌ Укажи ник твинка для отвязки: `/deltwin ИмяБота`');
            continue;
          }
          const approved = readJSON(APPROVED_FILE);
          if (approved[chatId]) {
            const index = approved[chatId].findIndex(b => b.toLowerCase() === username.toLowerCase());
            if (index !== -1) {
              approved[chatId].splice(index, 1);
              writeJSON(APPROVED_FILE, approved);
              
              const aliases = readJSON(ALIASES_FILE);
              if (aliases[chatId]) {
                for (const [alias, realName] of Object.entries(aliases[chatId])) {
                  if (realName.toLowerCase() === username.toLowerCase()) {
                    delete aliases[chatId][alias];
                  }
                }
                writeJSON(ALIASES_FILE, aliases);
              }

              const token = generateToken(chatId);
              await sendMessage(chatId, `🗑 Твинк *${username}* успешно отвязан.\n\n🔑 Твой новый токен для .env: \`${token}\``);
            } else {
              await sendMessage(chatId, `❌ Твинк *${username}* не найден в твоем списке.`);
            }
          } else {
            await sendMessage(chatId, `❌ У тебя нет привязанных твинков.`);
          }
        }
        else if (cmd === '/alias') {
          const targetArg = parts[1];
          const newAlias = parts[2];
          if (!targetArg || !newAlias) {
            await sendMessage(chatId, '❌ Использование: `/alias <бот1/бот2 или ник> <новый_алиас>`');
            continue;
          }

          const realBot = resolveBot(chatId, targetArg);
          if (!realBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден среди твоих привязанных ботов.`);
            continue;
          }

          const aliases = readJSON(ALIASES_FILE);
          if (!aliases[chatId]) aliases[chatId] = {};
          
          for (const [al, rb] of Object.entries(aliases[chatId])) {
            if (rb.toLowerCase() === realBot.toLowerCase()) {
              delete aliases[chatId][al];
            }
          }

          aliases[chatId][newAlias.toLowerCase()] = realBot;
          writeJSON(ALIASES_FILE, aliases);

          await sendMessage(chatId, `🏷 Алиас \`${newAlias}\` успешно закреплен за твинком *${realBot}*!`);
        }
        else if (cmd === '/unalias') {
          const aliasArg = parts[1];
          if (!aliasArg) {
            await sendMessage(chatId, '❌ Укажи алиас для удаления: `/unalias <алиас>`');
            continue;
          }
          const aliases = readJSON(ALIASES_FILE);
          if (aliases[chatId] && aliases[chatId][aliasArg.toLowerCase()]) {
            delete aliases[chatId][aliasArg.toLowerCase()];
            writeJSON(ALIASES_FILE, aliases);
            await sendMessage(chatId, `🗑 Алиас \`${aliasArg}\` удален.`);
          } else {
            await sendMessage(chatId, `❌ Алиас \`${aliasArg}\` не найден.`);
          }
        }
        else if (cmd === '/starttwin' || cmd === '/on') {
          const targetArg = parts[1];
          if (!targetArg) {
            await sendMessage(chatId, '❌ Укажи твинка: `/starttwin <алиас или ник>`');
            continue;
          }
          const targetBot = resolveBot(chatId, targetArg);
          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден среди твоих привязанных ботов.`);
            continue;
          }

          if (!clients.has(targetBot.toLowerCase())) {
            await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
            continue;
          }

          console.log(`[Bridge Debug] Попытка отправить команду боту ${targetBot.toLowerCase()}. Активные сокеты:`, Array.from(clients.keys()));
          if (sendCommand(targetBot, { action: 'start' })) {
            await sendMessage(chatId, `🟢 Команда запуска отправлена твинку *${targetBot}* через WebSocket.`);
          } else {
            await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
          }
        }
        else if (cmd === '/stoptwin' || cmd === '/off') {
          const targetArg = parts[1];
          if (!targetArg) {
            await sendMessage(chatId, '❌ Укажи твинка: `/stoptwin <алиас или ник>`');
            continue;
          }
          const targetBot = resolveBot(chatId, targetArg);
          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден.`);
            continue;
          }

          if (!clients.has(targetBot.toLowerCase())) {
            await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
            continue;
          }

          console.log(`[Bridge Debug] Попытка отправить команду боту ${targetBot.toLowerCase()}. Активные сокеты:`, Array.from(clients.keys()));
          if (sendCommand(targetBot, { action: 'stoptwin' })) {
            await sendMessage(chatId, `🔴 Команда остановки отправлена твинку *${targetBot}* через WebSocket.`);
          } else {
            await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
          }
        }
        else if (cmd === '/startmain' || cmd === '/mainon') {
          if (!isAdmin(chatId)) { await sendMessage(chatId, '❌ Нет прав.'); continue; }
          const mainsApproved = readJSON(MAINS_APPROVED_FILE);
          const targetBot = (mainsApproved[chatId]?.[0]) || 'main';
          if (clients.has(targetBot.toLowerCase())) {
            sendCommand(targetBot, { action: 'start' });
            await sendMessage(chatId, `🟢 Команда запуска отправлена мейн-боту *${targetBot}* через WebSocket.`);
          } else {
            const cmdStr = process.env.USER_SYSTEMD === 'true' ? 'systemctl --user start twins-main' : 'sudo systemctl start twins-main';
            require('child_process').exec(cmdStr, (err) => {
              sendMessage(chatId, err ? `❌ Ошибка запуска мейн-бота: ${err.message}` : '🟢 Мейн-бот запущен.');
            });
          }
        }
        else if (cmd === '/stopmain' || cmd === '/mainoff') {
          if (!isAdmin(chatId)) { await sendMessage(chatId, '❌ Нет прав.'); continue; }
          const mainsApproved = readJSON(MAINS_APPROVED_FILE);
          const targetBot = (mainsApproved[chatId]?.[0]) || 'main';
          if (clients.has(targetBot.toLowerCase())) {
            sendCommand(targetBot, { action: 'stoptwin' });
            await sendMessage(chatId, `🔴 Команда остановки отправлена мейн-боту *${targetBot}* через WebSocket.`);
          } else {
            const cmdStr = process.env.USER_SYSTEMD === 'true' ? 'systemctl --user stop twins-main' : 'sudo systemctl stop twins-main';
            require('child_process').exec(cmdStr, (err) => {
              sendMessage(chatId, err ? `❌ Ошибка остановки мейн-бота: ${err.message}` : '🔴 Мейн-бот остановлен.');
            });
          }
        }
        else if (cmd === '/status' || cmd === '/list') {
          const approved = readJSON(APPROVED_FILE);
          const userBots = approved[chatId] || [];
          if (userBots.length === 0) {
            await sendMessage(chatId, '📭 У тебя нет привязанных твинков. Используй `/addtwin <ник>`.');
          } else {
            const statuses = readJSON(STATUS_FILE);
            const streaming = readJSON(STREAMING_FILE);
            const aliases = readJSON(ALIASES_FILE)[chatId] || {};
            
            let msg = `📋 *Твои привязанные твинки (${userBots.length}/2):*\n\n`;
            userBots.forEach((botName, index) => {
              const st = statuses[botName.toLowerCase()];
              const alias = `bot${index + 1}`;
              
              const customAliases = Object.entries(aliases)
                .filter(([al, rb]) => rb.toLowerCase() === botName.toLowerCase())
                .map(([al]) => al);

              const onlineStr = (st && st.online) ? `🟢 Онлайн (в сети ${st.onlineSince ? formatUptime(Date.now() - st.onlineSince) : 'недавно'})` : `🔴 Офлайн`;
              
              msg += `• *${botName}* (системный: \`${alias}\``;
              if (customAliases.length > 0) {
                msg += `, алиасы: \`${customAliases.join(', ')}\``;
              }
              msg += `)\n   Статус: ${onlineStr}\n\n`;
            });
            await sendMessage(chatId, msg);
          }
        }
        else if (cmd === '/chat') {
          const targetArg = parts[1];
          const messageText = parts.slice(2).join(' ');
          if (!targetArg || !messageText) {
            await sendMessage(chatId, '❌ Использование: `/chat <алиас или ник> <текст>`');
            continue;
          }

          const targetBot = resolveBot(chatId, targetArg);
          if (!targetBot) {
            await sendMessage(chatId, '❌ Твинк \'' + targetArg + '\' не найден среди твоих привязанных ботов.');
            continue;
          }

          if (!clients.has(targetBot.toLowerCase())) {
            await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
            continue;
          }

           if (sendCommand(targetBot, { action: 'chat', text: messageText })) {
             await sendMessage(chatId, `✅ Сообщение отправлено боту *${targetBot}*.`);
           } else {
             await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
           }
       }

        else if (cmd === '/spamlist') {
          const targetBot = resolveBot(chatId, parts[1]);
          if (!targetBot) { await sendMessage(chatId, '❌ Неизвестный бот. /spamlist <алиас>'); continue; }
          if (!clients.has(targetBot.toLowerCase())) {
            await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
            continue;
          }
          const tasks = get('spam_tasks_' + targetBot.toLowerCase(), []);
          if (!tasks.length) { await sendMessage(chatId, `📋 У бота *${targetBot}* нет активных спам-задач.`); continue; }
          const lines = tasks.map((t, i) => `${i + 1}:${t.msg} - ${t.delay} сек`);
          await sendMessage(chatId, `📋 Спам-задачи *${targetBot}*:\n${lines.join('\n')}`);
        }
        else if (cmd === '/addspam') {
          const targetBot = resolveBot(chatId, parts[1]);
          const delay = parseDuration(parts[2]);
          const msg = parts.slice(3).join(' ').trim();
          
          if (!targetBot || isNaN(delay) || delay <= 0 || !msg) {
            await sendMessage(chatId, '❌ Использование: /addspam <алиас> <время> <текст> (время: 30, 30s, 5m, 1h)');
            continue;
          }
          if (!clients.has(targetBot.toLowerCase())) {
            await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
            continue;
          }
          const key = 'spam_tasks_' + targetBot.toLowerCase();
          const tasks = get(key, []);
          if (tasks.length >= 20) { await sendMessage(chatId, `❌ У бота *${targetBot}* уже 20 задач. Удали лишние.`); continue; }
          tasks.push({ msg, delay });
          set(key, tasks);
          // сигнал боту перечитать список на лету
          sendCommand(targetBot, { action: 'reloadSpam' });
      await sendMessage(chatId, `✅ Спам #${tasks.length} добавлен для *${targetBot}*: "${msg}" (каждые ${delay} с)`);
    }
    else if (cmd === '/delspam') {
      const targetBot = resolveBot(chatId, parts[1]);
      const taskNum = parseInt(parts[2], 10);
      if (!targetBot || isNaN(taskNum) || taskNum <= 0) {
        await sendMessage(chatId, '❌ Использование: /delspam <алиас> <номер> (номер из /spamlist)');
        continue;
      }
      if (!clients.has(targetBot.toLowerCase())) {
        await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
        continue;
      }
      const key = 'spam_tasks_' + targetBot.toLowerCase();
      const tasks = get(key, []);
      const index = taskNum - 1;
      if (index < 0 || index >= tasks.length) {
        await sendMessage(chatId, `❌ У бота *${targetBot}* нет задачи #${taskNum}. Список: /spamlist <алиас>`);
        continue;
      }
      const removed = tasks.splice(index, 1)[0];
      set(key, tasks);
      sendCommand(targetBot, { action: 'reloadSpam' });
      await sendMessage(chatId, `🗑 Спам-задача #${taskNum} ("${removed.msg}") удалена у *${targetBot}*`);
    }
    else if (cmd === '/autoclickon' || cmd === '/autoclickoff') {
      const targetBot = resolveBot(chatId, parts[1]);
      if (!targetBot) {
        await sendMessage(chatId, `❌ Укажи твинка: \`${cmd} <алиас или ник>\``);
        continue;
      }
      if (!clients.has(targetBot.toLowerCase())) {
        await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
        continue;
      }
      const enabled = cmd === '/autoclickon';
      sendCommand(targetBot, { action: 'setAutoClick', enabled });
      await sendMessage(chatId, `✅ Автокликер ${enabled ? 'включен' : 'выключен'} для *${targetBot}*`);
    }
    else if (cmd === '/setswing') {
      const targetBot = resolveBot(chatId, parts[1]);
      if (!parts[1]) {
        await sendMessage(chatId, '❌ Укажи твинка: /setswing <алиас или ник>');
        continue;
      }
      if (!targetBot) {
        await sendMessage(chatId, `❌ Твинк '${parts[1]}' не найден.`);
        continue;
      }
      if (!clients.has(targetBot.toLowerCase())) {
        await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
        continue;
      }
      let manualCooldownMs = null;
      if (parts[2] && parts[2].toLowerCase() !== 'auto' && parts[2] !== '0') {
        const ms = parseInt(parts[2], 10);
        if (isNaN(ms) || ms <= 0) {
          await sendMessage(chatId, '❌ Укажи интервал в мс (число > 0) или auto');
          continue;
        }
        manualCooldownMs = ms;
      }
      sendCommand(targetBot, { action: 'setSwing', manualCooldownMs });
      if (manualCooldownMs === null) {
        await sendMessage(chatId, `✅ Тайминг удара для *${targetBot}*: авто (по оружию)`);
      } else {
        await sendMessage(chatId, `✅ Тайминг удара для *${targetBot}*: ${manualCooldownMs} мс (вручную)`);
      }
    }
    else if (cmd === '/pos') {
      const targetBot = resolveBot(chatId, parts[1]);
      if (!parts[1]) {
        await sendMessage(chatId, '❌ Укажи твинка: /pos <алиас или ник>');
        continue;
      }
      if (!targetBot) {
        await sendMessage(chatId, `❌ Твинк '${parts[1]}' не найден.`);
        continue;
      }
      if (!clients.has(targetBot.toLowerCase())) {
        await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
        continue;
      }
      sendCommand(targetBot, { action: 'pos', chatId: chatId });
      await sendMessage(chatId, `✅ Запрашиваю координаты *${targetBot}*...`);
    }
    else if (cmd === '/players' || cmd === '/tab') {
          let targetBot;
          if (parts[1]) {
            targetBot = resolveBot(chatId, parts[1]);
            if (!targetBot) {
              await sendMessage(chatId, `❌ Твинк '${parts[1]}' не найден.`);
              continue;
            }
          } else {
            const approved = readJSON(APPROVED_FILE);
            const userBots = approved[chatId] || [];
            if (userBots.length === 0) {
              await sendMessage(chatId, `❌ У тебя нет привязанных твинков.`);
              continue;
            }
            const connectedBots = userBots.filter(b => clients.has(b.toLowerCase()));
            if (connectedBots.length > 0) {
              targetBot = connectedBots[0];
            } else {
              const statuses = readJSON(STATUS_FILE);
              const onlineBots = userBots.filter(b => statuses[b.toLowerCase()] && statuses[b.toLowerCase()].online);
              if (onlineBots.length > 0) {
                // ponytail: sort by onlineSince to find highest uptime
                onlineBots.sort((a, b) => (statuses[a.toLowerCase()].onlineSince || 0) - (statuses[b.toLowerCase()].onlineSince || 0));
                targetBot = onlineBots[0];
              } else {
                targetBot = resolveBot(chatId, 'bot1') || userBots[0];
              }
            }
          }

          if (!clients.has(targetBot.toLowerCase())) {
            await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
            continue;
          }

          sendCommand(targetBot, { action: 'players', chatId: chatId });

          await sendMessage(chatId, `🔍 Запрос списка игроков отправлен для *${targetBot}*... Ожидайте ответ.`);
        }
      }
    }
  } catch (e) {
    console.error('[Telegram Polling Error]:', e.message);
  }
  setTimeout(poll, 1000);
}

setInterval(async () => {
  const approved = readJSON(APPROVED_FILE);
  for (const [chatId, bots] of Object.entries(approved)) {
    for (const botName of bots) {
      const respKey = `bot_response_${botName.toLowerCase()}`;
      const response = get(respKey, null);
      if (response && response.msg && response.chatId) {
        set(respKey, null); // Clear immediately to avoid re-sending
        await sendMessage(response.chatId, response.msg, null);
      }
    }
  }
}, 1000);

console.log('[Bridge Debug] Вызываю функцию poll()...');
poll();
console.log('[Bridge Debug] Конец файла достигнут.');
