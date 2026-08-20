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
          await sendMessage(chatId, '🤖 *Twins Telegram Hub*\n\nТвой Telegram зарегистрирован как основной.\n\nКоманды управления:\n`/addtwin <ник>` - добавить твинка (макс. 2)\n`/deltwin <ник>` - отвязать твинка\n`/status` - статус твинков (онлайн / время / чат в ТГ)\n`/chaton <бот>` - включить дублирование чата в ТГ\n`/chatoff <бот>` - выключить дублирование чата\n`/chat <бот/ник> <текст>` - написать в чат от имени бота\n`/stopspam` - остановить спам');
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
              await sendMessage(chatId, `🗑 Твинк *${username}* успешно отвязан.`);
            } else {
              await sendMessage(chatId, `❌ Твинк *${username}* не найден в твоем списке.`);
            }
          } else {
            await sendMessage(chatId, `❌ У тебя нет привязанных твинков.`);
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
            let msg = `📋 *Твои привязанные твинки (${userBots.length}/2):*\n\n`;
            userBots.forEach((botName, index) => {
              const st = statuses[botName.toLowerCase()];
              const userStream = streaming[chatId] || {};
              const isStreaming = !!userStream[botName.toLowerCase()];
              const alias = `bot${index + 1}`;
              const onlineStr = (st && st.online) ? `🟢 Онлайн (в сети ${st.onlineSince ? formatUptime(Date.now() - st.onlineSince) : 'недавно'})` : `🔴 Офлайн`;
              const chatStreamStr = isStreaming ? `🟢 ВКЛ` : `🔴 ВЫКЛ`;
              msg += `• *${botName}* (алиас: \`${alias}\`)\n   Статус: ${onlineStr}\n   Дублирование чата: ${chatStreamStr}\n\n`;
            });
            await sendMessage(chatId, msg);
          }
        }
        else if (cmd === '/chaton' || cmd === '/streamon') {
          const targetArg = parts[1];
          if (!targetArg) {
            await sendMessage(chatId, '❌ Укажи бота: `/chaton <bot1/bot2 или ник>`');
            continue;
          }
          const approved = readJSON(APPROVED_FILE);
          const userBots = approved[chatId] || [];
          let targetBot = null;
          if (targetArg.toLowerCase() === 'bot1' && userBots[0]) targetBot = userBots[0];
          else if (targetArg.toLowerCase() === 'bot2' && userBots[1]) targetBot = userBots[1];
          else {
            const found = userBots.find(b => b.toLowerCase() === targetArg.toLowerCase());
            if (found) targetBot = found;
          }

          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден среди твоих привязанных ботов.`);
            continue;
          }

          const streaming = readJSON(STREAMING_FILE);
          if (!streaming[chatId]) streaming[chatId] = {};
          streaming[chatId][targetBot.toLowerCase()] = true;
          writeJSON(STREAMING_FILE, streaming);

          await sendMessage(chatId, `🟢 Дублирование чата для *${targetBot}* включено.`);
        }
        else if (cmd === '/chatoff' || cmd === '/streamoff') {
          const targetArg = parts[1];
          if (!targetArg) {
            await sendMessage(chatId, '❌ Укажи бота: `/chatoff <bot1/bot2 или ник>`');
            continue;
          }
          const approved = readJSON(APPROVED_FILE);
          const userBots = approved[chatId] || [];
          let targetBot = null;
          if (targetArg.toLowerCase() === 'bot1' && userBots[0]) targetBot = userBots[0];
          else if (targetArg.toLowerCase() === 'bot2' && userBots[1]) targetBot = userBots[1];
          else {
            const found = userBots.find(b => b.toLowerCase() === targetArg.toLowerCase());
            if (found) targetBot = found;
          }

          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден среди твоих привязанных ботов.`);
            continue;
          }

          const streaming = readJSON(STREAMING_FILE);
          if (streaming[chatId]) {
            streaming[chatId][targetBot.toLowerCase()] = false;
            writeJSON(STREAMING_FILE, streaming);
          }

          await sendMessage(chatId, `🔴 Дублирование чата для *${targetBot}* выключено.`);
        }
        else if (cmd === '/chat') {
          const targetArg = parts[1];
          const messageText = parts.slice(2).join(' ');
          if (!targetArg || !messageText) {
            await sendMessage(chatId, '❌ Использование: `/chat <bot1/bot2 или ник> <текст>`');
            continue;
          }

          const approved = readJSON(APPROVED_FILE);
          const userBots = approved[chatId] || [];
          let targetBot = null;

          if (targetArg.toLowerCase() === 'bot1' && userBots[0]) targetBot = userBots[0];
          else if (targetArg.toLowerCase() === 'bot2' && userBots[1]) targetBot = userBots[1];
          else {
            const found = userBots.find(b => b.toLowerCase() === targetArg.toLowerCase());
            if (found) targetBot = found;
          }

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
