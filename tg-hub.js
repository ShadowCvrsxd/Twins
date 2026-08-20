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

function readJSON(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
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
  await telegramAPI('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
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
  const aliases = readJSON(ALIASES_FILE)[chatId] || {}; // { alias: realUsername }
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
          await sendMessage(chatId, '🤖 *Twins Telegram Hub*\n\nТвой Telegram зарегистрирован как основной.\n\nКоманды управления:\n`/addtwin <ник>` - добавить твинка (макс. 2)\n`/deltwin <ник>` - отвязать твинка\n`/alias <бот> <алиас>` - задать алиас твинку\n`/unalias <алиас>` - удалить алиас\n`/status` - статус твинков\n`/chat <алиас/ник> <текст>` - написать в чат от имени бота\n`/stopspam` - остановить спам');
        } 
        else if (cmd === '/addtwin' || cmd === '/link') {
          const username = parts[1];
          if (!username) {
            await sendMessage(chatId, '❌ Укажи ник твинка: `/addtwin ИмяБота`');
            continue;
          }

          const approved = readJSON(APPROVED_FILE);
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
              
              // Также удаляем алиасы, связанные с этим ботом
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
          
          // Удаляем старый алиас если этот бот уже имел другой алиас
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
              const userStream = streaming[chatId] || {};
              const isStreaming = !!userStream[botName.toLowerCase()];
              const alias = `bot${index + 1}`;
              
              // Ищем кастомные алиасы для этого бота
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
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден среди твоих привязанных ботов.`);
            continue;
          }

          const cmds = readJSON(CMDS_FILE);
          if (!Array.isArray(cmds)) {
            writeJSON(CMDS_FILE, [{ username: targetBot, text: messageText }]);
          } else {
            cmds.push({ username: targetBot, text: messageText });
            writeJSON(CMDS_FILE, cmds);
          }

          await sendMessage(chatId, `📤 Команда отправлена в чат для *${targetBot}*: \`${messageText}\``);
        }
      }
    }
  } catch (e) {
    console.error('[Telegram Polling Error]:', e.message);
  }
  setTimeout(poll, 1000);
}

poll();
