const fs = require('fs');
const path = require('path');

require('dotenv').config();

const TOKEN = process.env.TG_CHAT_BOT_TOKEN || process.env.TG_BOT_TOKEN;
if (!TOKEN) {
  console.log('[Telegram Chat Bot] Токен не задан. Чат-бот отключен.');
  process.exit(0);
}

const APPROVED_FILE = path.join(__dirname, 'links_approved.json');
const STATUS_FILE = path.join(__dirname, 'bots_status.json');
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

console.log('[Telegram Chat Bot] Запущен и слушает чат-потоки...');

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

        // Проверяем, привязаны ли твинки к этому чату через мейн-бота
        const approved = readJSON(APPROVED_FILE);
        const userBots = approved[chatId] || [];

        if (cmd === '/start') {
          await sendMessage(chatId, `💬 *Twins Chat Stream Bot*\n\nЭтот бот управляет дублированием игрового чата твинков.\n\nТвои привязанные твинки: ${userBots.length > 0 ? userBots.join(', ') : 'нет (привяжи через мейн-бота)'}\n\nКоманды:\n\`/streamon <бот1/бот2 или ник>\` - включить трансляцию чата\n\`/streamoff <бот1/бот2 или ник>\` - выключить трансляцию\n\`/status\` - статус потоков`);
        }
        else if (cmd === '/streamon' || cmd === '/chaton') {
          if (userBots.length === 0) {
            await sendMessage(chatId, '❌ У тебя нет привязанных твинков. Сначала привяжи их через главного бота.');
            continue;
          }
          const targetArg = parts[1];
          if (!targetArg) {
            await sendMessage(chatId, `❌ Укажи твинка: \`/streamon <bot1/bot2 или ник>\`\nДоступные: ${userBots.join(', ')}`);
            continue;
          }

          let targetBot = null;
          if (targetArg.toLowerCase() === 'bot1' && userBots[0]) targetBot = userBots[0];
          else if (targetArg.toLowerCase() === 'bot2' && userBots[1]) targetBot = userBots[1];
          else {
            const found = userBots.find(b => b.toLowerCase() === targetArg.toLowerCase());
            if (found) targetBot = found;
          }

          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден в твоем списке привязанных ботов.`);
            continue;
          }

          const streaming = readJSON(STREAMING_FILE);
          if (!streaming[chatId]) streaming[chatId] = {};
          streaming[chatId][targetBot.toLowerCase()] = true;
          writeJSON(STREAMING_FILE, streaming);

          await sendMessage(chatId, `🟢 Трансляция чата для твинка *${targetBot}* включена в этот чат.`);
        }
        else if (cmd === '/streamoff' || cmd === '/chatoff') {
          if (userBots.length === 0) {
            await sendMessage(chatId, '❌ У тебя нет привязанных твинков.');
            continue;
          }
          const targetArg = parts[1];
          if (!targetArg) {
            await sendMessage(chatId, `❌ Укажи твинка: \`/streamoff <bot1/bot2 или ник>\``);
            continue;
          }

          let targetBot = null;
          if (targetArg.toLowerCase() === 'bot1' && userBots[0]) targetBot = userBots[0];
          else if (targetArg.toLowerCase() === 'bot2' && userBots[1]) targetBot = userBots[1];
          else {
            const found = userBots.find(b => b.toLowerCase() === targetArg.toLowerCase());
            if (found) targetBot = found;
          }

          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден.`);
            continue;
          }

          const streaming = readJSON(STREAMING_FILE);
          if (streaming[chatId]) {
            streaming[chatId][targetBot.toLowerCase()] = false;
            writeJSON(STREAMING_FILE, streaming);
          }

          await sendMessage(chatId, `🔴 Трансляция чата для твинка *${targetBot}* выключена.`);
        }
        else if (cmd === '/status' || cmd === '/list') {
          if (userBots.length === 0) {
            await sendMessage(chatId, '📭 У тебя нет привязанных твинков. Привяжи их через мейн-бота.');
          } else {
            const streaming = readJSON(STREAMING_FILE);
            const userStream = streaming[chatId] || {};
            let msg = `💬 *Статус трансляций чата:*\n\n`;
            userBots.forEach((botName, index) => {
              const isStreaming = !!userStream[botName.toLowerCase()];
              const alias = `bot${index + 1}`;
              msg += `• *${botName}* (алиас: \`${alias}\`)\n   Трансляция в ТГ: ${isStreaming ? '🟢 ВКЛ' : '🔴 ВЫКЛ'}\n\n`;
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

poll();
