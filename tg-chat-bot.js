const fs = require('fs');
const path = require('path');
const { get, set } = require('./db.js');

require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('[Telegram Chat Bot Uncaught Exception]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Telegram Chat Bot Unhandled Rejection]:', reason);
});

const TOKEN = process.env.TG_CHAT_BOT_TOKEN || process.env.TG_BOT_TOKEN;
if (!TOKEN) {
  console.log('[Telegram Chat Bot] Токен не задан. Чат-бот отключен.');
  process.exit(0);
}

const APPROVED_FILE = 'links_approved';
const STATUS_FILE = 'bots_status';
const STREAMING_FILE = 'chat_streaming';
const ALIASES_FILE = 'bot_aliases';
const DISPLAY_MODE_FILE = 'chat_display_mode';

function readJSON(key) {
  return get(key, {});
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
      { command: 'start', description: 'Главное меню чата' },
      { command: 'streamon', description: 'Включить дублирование чата (/streamon <бот>)' },
      { command: 'streamoff', description: 'Выключить дублирование чата (/streamoff <бот>)' },
      { command: 'display', description: 'Режим отображения имен (/display <mode>)' },
      { command: 'status', description: 'Статус потоков чата' }
    ]
  });
}

initBotMenu();
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

        if (!text.startsWith('/')) {
          if (userBots.length === 0) {
            await sendMessage(chatId, '❌ У тебя нет привязанных твинков.');
            continue;
          }
          const statuses = readJSON(STATUS_FILE);
          const onlineBots = userBots.filter(b => {
            const st = statuses[b.toLowerCase()];
            return st && st.online;
          });

          if (onlineBots.length === 0) {
            await sendMessage(chatId, '❌ Сейчас нет онлайн твинков для отправки сообщения.');
            continue;
          }

          onlineBots.sort((a, b) => {
            const timeA = statuses[a.toLowerCase()].onlineSince || 0;
            const timeB = statuses[b.toLowerCase()].onlineSince || 0;
            return timeA - timeB;
          });

          const targetBot = onlineBots[0];

          let cmds = get('bot_commands', []);
          cmds.push({ username: targetBot, text: text });
          set('bot_commands', cmds);

          await sendMessage(chatId, `✉️ Отправлено от *${targetBot}*: ${text}`);
          continue;
        }

        if (cmd === '/start') {
          await sendMessage(chatId, `💬 *Twins Chat Stream Bot*\n\nЭтот бот управляет дублированием игрового чата твинков.\n\nТвои привязанные твинки: ${userBots.length > 0 ? userBots.join(', ') : 'нет (привяжи через мейн-бота)'}\n\nКоманды:\n\`/streamon <алиас или ник>\` - вкл. трансляцию\n\`/streamoff <алиас или ник>\` - выкл. трансляцию\n\`/display <alias|nick|both|hidden>\` - режим отображения`);
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
        else if (cmd === '/display' || cmd === '/mode') {
          const modeArg = parts[1] ? parts[1].toLowerCase() : '';
          const validModes = ['alias', 'nick', 'both', 'hidden'];

          if (!validModes.includes(modeArg)) {
            await sendMessage(chatId, '❌ Использование: `/display <alias | nick | both | hidden>`\n- `alias` — алиас (если нет, то ник)\n- `nick` — только ник\n- `both` — алиас / ник\n- `hidden` — скрывать ник/алиас');
            continue;
          }

          const modes = readJSON(DISPLAY_MODE_FILE);
          modes[chatId] = modeArg;
          writeJSON(DISPLAY_MODE_FILE, modes);

          await sendMessage(chatId, `✅ Режим отображения имен в чате установлен на: *${modeArg}*`);
        }
        else if (cmd === '/status' || cmd === '/list') {
          if (userBots.length === 0) {
            await sendMessage(chatId, '📭 У тебя нет привязанных твинков. Привяжи их через мейн-бота.');
          } else {
            const streaming = readJSON(STREAMING_FILE);
            const userStream = streaming[chatId] || {};
            const aliases = readJSON(ALIASES_FILE)[chatId] || {};
            const modes = readJSON(DISPLAY_MODE_FILE);
            const currentMode = modes[chatId] || 'alias';
            
            let msg = `💬 *Статус трансляций чата (режим: ${currentMode}):*\n\n`;
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
