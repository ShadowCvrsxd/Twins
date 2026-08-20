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

        const approved = readJSON(APPROVED_FILE);
        const userBots = approved[chatId] || [];

        if (cmd === '/start') {
          await sendMessage(chatId, `💬 *Twins Chat Stream Bot*\n\nЭтот бот управляет дублированием игрового чата твинков.\n\nТвои привязанные твинки: ${userBots.length > 0 ? userBots.join(', ') : 'нет (привяжи через мейн-бота)'}\n\nКоманды:\n\`/streamon <алиас или ник>\` - включить трансляцию чата\n\`/streamoff <алиас или ник>\` - выключить трансляцию\n\`/status\` - статус потоков`);
        }
        else if (cmd === '/streamon' || cmd === '/chaton') {
          if (userBots.length === 0) {
            await sendMessage(chatId, '❌ У тебя нет привязанных твинков. Сначала привяжи их через главного бота.');
            continue;
          }
          const targetArg = parts[1];
          if (!targetArg) {
            await sendMessage(chatId, `❌ Укажи твинка: \`/streamon <алиас или ник>\`\nДоступные: ${userBots.join(', ')}`);
            continue;
          }

          const targetBot = resolveBot(chatId, targetArg);
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
            await sendMessage(chatId, `❌ Укажи твинка: \`/streamoff <алиас или ник>\``);
            continue;
          }

          const targetBot = resolveBot(chatId, targetArg);
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
            const aliases = readJSON(ALIASES_FILE)[chatId] || {};
            
            let msg = `💬 *Статус трансляций чата:*\n\n`;
            userBots.forEach((botName, index) => {
              const isStreaming = !!userStream[botName.toLowerCase()];
              const alias = `bot${index + 1}`;
              const customAliases = Object.entries(aliases)
                .filter(([al, rb]) => rb.toLowerCase() === botName.toLowerCase())
                .map(([al]) => al);

              msg += `• *${botName}* (системный: \`${alias}\``;
              if (customAliases.length > 0) {
                msg += `, алиасы: \`${customAliases.join(', ')}\``;
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

poll();
