const fs = require('fs');
const path = require('path');

require('dotenv').config();

const TOKEN = process.env.TG_BOT_TOKEN;
if (!TOKEN) {
  console.log('[Telegram] TG_BOT_TOKEN не задан в .env. Телеграм-хаб отключен.');
  process.exit(0);
}

const PENDING_FILE = path.join(__dirname, 'links_pending.json');
const APPROVED_FILE = path.join(__dirname, 'links_approved.json');
const STATUS_FILE = path.join(__dirname, 'bots_status.json');
const CMDS_FILE = path.join(__dirname, 'bot_commands.json');
const STREAMING_FILE = path.join(__dirname, 'chat_streaming.json');
const ALIASES_FILE = path.join(__dirname, 'bot_aliases.json');
const LOCK_FILE = path.join(__dirname, 'registration_lock.json');

const ADMIN_ID = process.env.ADMIN_TG_ID ? process.env.ADMIN_TG_ID.trim() : '';

function isAdmin(chatId) {
  return ADMIN_ID && chatId.toString() === ADMIN_ID;
}

function isRegistrationLocked() {
  if (!fs.existsSync(LOCK_FILE)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    return !!data.locked;
  } catch (e) {
    return false;
  }
}

function readJSON(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; }
}

function writeJSON(file, data) {
  const tempFile = file + '.' + Math.random().toString(36).substring(2) + '.tmp';
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, file);
  } catch (e) {
    try { fs.unlinkSync(tempFile); } catch(err){}
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
    return data.ok ? data.result : null;
  } catch (e) {
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
      { command: 'status', description: 'Статус привязанных ботов' },
      { command: 'players', description: 'Список игроков онлайн (/players <бот>)' },
      { command: 'testserver', description: 'Переключить ботов на тестовый сервер (админ)' },
      { command: 'stopspam', description: 'Остановить весь спам' }
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
          let msg = '🤖 *Twins Telegram Hub*\n\nТвой Telegram зарегистрирован как основной.\n\nКоманды управления:\n`/addtwin <ник>` - привязать твинка\n`/deltwin <ник>` - отвязать твинка\n`/alias <бот> <алиас>` - задать алиас\n`/status` - список и статус ботов\n`/chat <алиас> <текст>` - написать в чат';
          if (isAdmin(chatId)) {
            msg += `\n\n👑 *Админ-панель:*\nСтатус регистрации: ${isRegistrationLocked() ? '🔴 Заблокирована' : '🟢 Открыта'}\n`/lock` - заблокировать добавление\n`/unlock` - разблокировать\n`/users` - список пользователей\n`/testserver` - переключить ботов на тестовый сервер`;
          }
          await sendMessage(chatId, msg);
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
          const reqs = readJSON(reqFile);
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

          const { exec } = require('child_process');
          exec(`screen -S ${targetBot} -dm node -e "require('./bot-base.js').startBot('.env', { username: '${targetBot}' })"`, (err) => {
            if (err) {
              sendMessage(chatId, `❌ Ошибка запуска твинка *${targetBot}*.`);
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

          const { exec } = require('child_process');
          exec(`screen -S ${targetBot} -X quit`, (err) => {
            sendMessage(chatId, `🔴 Твинк *${targetBot}* остановлен.`);
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

          const cmds = readJSON(CMDS_FILE);
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
          const reqs = readJSON(reqFile);
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
