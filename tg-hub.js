const fs = require('fs');
const path = require('path');
const { get, set } = require('./db.js');

require('dotenv').config();

const TOKEN = process.env.TG_BOT_TOKEN;
if (!TOKEN) {
  console.log('[Telegram] TG_BOT_TOKEN не задан в .env. Телеграм-хаб отключен.');
  process.exit(0);
}

const PENDING_FILE = 'links_pending';
const APPROVED_FILE = 'links_approved';
const STATUS_FILE = 'bots_status';
const CMDS_FILE = 'bot_commands';
const STREAMING_FILE = 'chat_streaming';
const ALIASES_FILE = 'bot_aliases';
const LOCK_FILE = 'registration_lock';
const MEOW_FILE = 'meow_settings';
const AUTORESPECT_FILE = 'autorespect_settings';
const reqFile = 'bot_requests';

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

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h} ч. ${m} мин.`;
  return `${m} мин.`;
}

function resolveBot(chatId, targetArg) {
  const approved = readJSON(APPROVED_FILE);
  const userBots = approved[chatId] || [];
  const aliases = readJSON(ALIASES_FILE)[chatId] || {};
  const searchKey = targetArg.toLowerCase();

  if (aliases[searchKey]) {
    return aliases[searchKey];
  }
  if (searchKey === 'bot1' && userBots[0]) {
    return userBots[0];
  }
  if (searchKey === 'bot2' && userBots[1]) {
    return userBots[1];
  }
  const found = userBots.find(b => b.toLowerCase() === searchKey);
  return found || null;
}

async function initBotMenu() {
  await telegramAPI('setMyCommands', {
    commands: [
      { command: 'start', description: 'Главное меню' },
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
      { command: 'autorepon', description: 'Вкл. авто-респекты (/autorepon <алиас>)' },
      { command: 'autorepoff', description: 'Выкл. авто-респекты (/autorepoff <алиас>)' },
      { command: 'status', description: 'Статус привязанных ботов' },
      { command: 'players', description: 'Список игроков онлайн (/players <бот>)' },
      { command: 'stopspam', description: 'Остановить весь спам' },
      { command: 'lock', description: 'Заблокировать регистрацию (админ)' },
      { command: 'unlock', description: 'Разблокировать регистрацию (админ)' },
      { command: 'users', description: 'Список пользователей (админ)' },
      { command: 'testserver', description: 'На тестовый сервер (админ)' },
      { command: 'mainserver', description: 'На основной сервер (админ)' },
      { command: 'setserver', description: 'Сменить сервер (админ) (/setserver <ip> <port>)' },
      { command: 'vote', description: 'Запустить автоголосование (админ)' }
    ]
  });
}

initBotMenu();
console.log('[Telegram] Хаб запущен и слушает сообщения...');

async function poll() {
  try {
    const updates = await telegramAPI('getUpdates', { offset, timeout: 30 });
    if (updates && Array.isArray(updates)) {
      for (const update of updates) {
        offset = update.update_id + 1;
        if (!update.message || !update.message.text) continue;

        const chatId = update.message.chat.id;
        const text = update.message.text.trim();
        const parts = text.split(' ');
        const cmd = parts[0].toLowerCase();

        if (cmd === '/start') {
          let msg = '🤖 *Twins Telegram Hub*\n\nТвой Telegram зарегистрирован как основной.\n\nКоманды управления:\n`/addtwin <ник>` - привязать твинка\n`/deltwin <ник>` - отвязать твинка\n`/alias <бот> <алиас>` - задать алиас\n`/unalias <алиас>` - удалить алиас\n`/starttwin <алиас>` - запустить твинка\n`/stoptwin <алиас>` - остановить твинка\n`/startmain` - запустить мейн-бота\n`/stopmain` - остановить мейн-бота\n`/status` - список и статус ботов\n`/players <бот>` - онлайн игроков\n`/chat <алиас> <текст>` - написать в чат\n`/meowon <алиас>` - вкл. мяуканье\n`/meowoff <алиас>` - выкл. мяуканье\n`/autorepon <алиас>` - вкл. авто-респекты\n`/autorepoff <алиас>` - выкл. авто-респекты\n`/stopspam` - остановить спам';
          if (isAdmin(chatId)) {
            msg += '\n\n👑 *Админ-панель:*\nСтатус регистрации: ' + (isRegistrationLocked() ? '🔴 Заблокирована' : '🟢 Открыта') + '\n`/lock` - заблокировать\n`/unlock` - разблокировать\n`/users` - список юзеров\n`/testserver` - на тестовый\n`/mainserver` - на основной\n`/setserver <ip> <port>` - сменить сервер\n`/vote` - автоголосование';
          }
          await sendMessage(chatId, msg);
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

           const enabled = cmd === '/autorepon';
           let settings = readJSON(AUTORESPECT_FILE);
           
           settings[targetBot] = { ...settings[targetBot], enabled: enabled };
           writeJSON(AUTORESPECT_FILE, settings);

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

           const enabled = cmd === '/meowon';
           let settings = readJSON(MEOW_FILE);
           
           settings[targetBot.toLowerCase()] = { ...settings[targetBot.toLowerCase()], enabled: enabled };
           writeJSON(MEOW_FILE, settings);

           await sendMessage(chatId, `✅ Режим "мяу" для твинка *${targetBot}* ${enabled ? 'ВКЛ' : 'ВЫКЛ'}.`);


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

          const reqFile = path.join(__dirname, 'bot_requests.json');
          const reqs = readJSONArray(reqFile);
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
            reqs.push({ username: botName, action: 'switchServer', host, port });
          });
          writeJSON(reqFile, reqs);

          await sendMessage(chatId, `🚀 Команда переключения на тестовый сервер (${host}:${port}) отправлена для всех ботов!`);
        }
        else if (cmd === '/mainserver' || cmd === '/prodserver') {
          if (!isAdmin(chatId)) {
            await sendMessage(chatId, '❌ У вас нет прав администратора.');
            continue;
          }
          const host = process.env.MAIN_SERVER_HOST || '5.83.140.251';
          const port = process.env.MAIN_SERVER_PORT || 25809;

          const reqFile = path.join(__dirname, 'bot_requests.json');
          const reqs = readJSONArray(reqFile);
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
            reqs.push({ username: botName, action: 'switchServer', host, port });
          });
          writeJSON(reqFile, reqs);

          await sendMessage(chatId, `🚀 Команда переключения на основной сервер (${host}:${port}) отправлена для всех ботов!`);
        }
        else if (cmd === '/vote') {
          if (!isAdmin(chatId)) {
            await sendMessage(chatId, '❌ У вас нет прав администратора.');
            continue;
          }
          await sendMessage(chatId, '🚀 Запускаю автоголосование:\n1. Мейн (без VPN)\n2. Твинки (с ротацией VPN)...');
          const { exec } = require('child_process');
          exec(`node ${path.join(__dirname, 'vote_vpn.js')}`, (err, stdout, stderr) => {
            if (err) {
              sendMessage(chatId, `❌ Ошибка голосования:\n\`\`\`\n${err.message.slice(-800)}\n\`\`\``);
            } else {
              const cleaned = stdout.replace(/\u001b\[\d+m/g, '');
              sendMessage(chatId, `✅ Автоголосование завершено!\n\`\`\`\n${cleaned.slice(-1000)}\n\`\`\``);
            }
          });
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

          const code = Math.floor(100000 + Math.random() * 900000).toString();
          const pending = readJSON(PENDING_FILE);
          pending[username.toLowerCase()] = { code, chatId };
          writeJSON(PENDING_FILE, pending);

          await sendMessage(chatId, `🔗 Запрос на привязку твинка *${username}* добавлен.\n\nЗапусти этого твинка локально — при входе в игру он автоматически привяжется к твоему Telegram!`);
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

              await sendMessage(chatId, `🗑 Твинк *${username}* успешно отвязан.`);
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

          const approved = readJSON(APPROVED_FILE);
          const userBots = approved[chatId] || [];
          const index = userBots.findIndex(b => b.toLowerCase() === targetBot.toLowerCase());
          const serviceName = index === 1 ? 'twins-bot2' : 'twins-bot1';

          const cmdStr = process.env.USER_SYSTEMD === 'true' ? `systemctl --user start ${serviceName}` : `sudo systemctl start ${serviceName}`;
          require('child_process').exec(cmdStr, (err) => {
            if (err) {
              sendMessage(chatId, `❌ Ошибка запуска твинка *${targetBot}*: ${err.message}`);
            } else {
              sendMessage(chatId, `🟢 Твинк *${targetBot}* запущен.`);
            }
          });
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

          const approved = readJSON(APPROVED_FILE);
          const userBots = approved[chatId] || [];
          const index = userBots.findIndex(b => b.toLowerCase() === targetBot.toLowerCase());
          const serviceName = index === 1 ? 'twins-bot2' : 'twins-bot1';

          const cmdStr = process.env.USER_SYSTEMD === 'true' ? `systemctl --user stop ${serviceName}` : `sudo systemctl stop ${serviceName}`;
          require('child_process').exec(cmdStr, (err) => {
            if (err) {
              sendMessage(chatId, `❌ Ошибка остановки твинка *${targetBot}*: ${err.message}`);
            } else {
              sendMessage(chatId, `🔴 Твинк *${targetBot}* остановлен.`);
            }
          });
        }
        else if (cmd === '/startmain' || cmd === '/mainon') {
          if (!isAdmin(chatId)) { await sendMessage(chatId, '❌ Нет прав.'); continue; }
          const cmdStr = process.env.USER_SYSTEMD === 'true' ? 'systemctl --user start twins-main' : 'sudo systemctl start twins-main';
          require('child_process').exec(cmdStr, (err) => {
            sendMessage(chatId, err ? `❌ Ошибка запуска мейн-бота: ${err.message}` : '🟢 Мейн-бот запущен.');
          });
        }
        else if (cmd === '/stopmain' || cmd === '/mainoff') {
          if (!isAdmin(chatId)) { await sendMessage(chatId, '❌ Нет прав.'); continue; }
          const cmdStr = process.env.USER_SYSTEMD === 'true' ? 'systemctl --user stop twins-main' : 'sudo systemctl stop twins-main';
          require('child_process').exec(cmdStr, (err) => {
            sendMessage(chatId, err ? `❌ Ошибка остановки мейн-бота: ${err.message}` : '🔴 Мейн-бот остановлен.');
          });
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

          const cmds = readJSONArray(CMDS_FILE);
          if (!Array.isArray(cmds)) {
            writeJSON(CMDS_FILE, [{ username: targetBot, text: messageText }]);
          } else {
            cmds.push({ username: targetBot, text: messageText });
            writeJSON(CMDS_FILE, cmds);
          }
        }
        else if (cmd === '/players' || cmd === '/tab') {
          const targetArg = parts[1] || 'bot1';
          const targetBot = resolveBot(chatId, targetArg);
          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден.`);
            continue;
          }

          const reqFile = path.join(__dirname, 'bot_requests.json');
          const reqs = readJSONArray(reqFile);
          if (!Array.isArray(reqs)) {
            writeJSON(reqFile, [{ username: targetBot, action: 'players' }]);
          } else {
            reqs.push({ username: targetBot, action: 'players' });
            writeJSON(reqFile, reqs);
          }

          await sendMessage(chatId, `🔍 Запрос списка игроков отправлен для *${targetBot}*... Ожидайте ответ в чате трансляций.`);
        }
      }
    }
  } catch (e) {
    console.error('[Telegram Polling Error]:', e.message);
  }
  setTimeout(poll, 1000);
}

poll();
