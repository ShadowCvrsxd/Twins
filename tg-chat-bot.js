const fs = require('fs');
const path = require('path');
const { getMainAccount } = require('./utils.js');

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
const MAINS_APPROVED_FILE = 'mains_approved';
const STATUS_FILE = 'bots_status';
const STREAMING_FILE = 'chat_streaming';
const ALIASES_FILE = 'bot_aliases';
const DISPLAY_MODE_FILE = 'chat_display_mode';

async function apiGet(key, defaultValue = {}) {
  try {
    const res = await fetch(`http://localhost:8089/state?key=${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TOKEN}`
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
  try {
    await fetch(`http://localhost:8089/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
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

async function initBotMenu() {
  await telegramAPI('setMyCommands', {
    commands: [
      { command: 'start', description: 'Главное меню чата' },
      { command: 'streamon', description: 'Включить дублирование чата (/streamon <бот>)' },
      { command: 'streamoff', description: 'Выключить дублирование чата (/streamoff <бот>)' },
      { command: 'display', description: 'Режим отображения имен (/display <mode>)' },
      { command: 'status', description: 'Статус потоков чата' },
      { command: 'setchat', description: 'Выбрать отправителя (/setchat <1|2|main>)' }
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
          const statuses = await readJSON(STATUS_FILE);
          const selection = await apiGet('chat_sender_selection', {});
          let targetBot = null;
          const selectedLower = selection[chatId];
          if (selectedLower) {
            const selStatus = statuses[selectedLower];
            if (!selStatus || !selStatus.online) {
              const nick = selectedLower === getMainAccount().toLowerCase() ? 'Мейн' : selectedLower;
              await sendMessage(chatId, `❌ Бот *${nick}* оффлайн.`);
              continue;
            }
            targetBot = selectedLower;
          } else {
            const onlineBots = userBots.filter(b => { const st = statuses[b.toLowerCase()]; return st && st.online; });
            if (onlineBots.length === 0) {
              await sendMessage(chatId, '❌ Сейчас нет онлайн твинков для отправки сообщения.');
              continue;
            }
            onlineBots.sort((a, b) => (statuses[a.toLowerCase()].onlineSince || 0) - (statuses[b.toLowerCase()].onlineSince || 0));
            targetBot = onlineBots[0];
          }
          const resp = await fetch('http://localhost:8089/command', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${TOKEN}`
            },
            body: JSON.stringify({ targetBot: targetBot.toLowerCase(), action: 'chat', text: messageToSend })
          });
          if (!resp.ok) {
            if (resp.status === 404) {
              await sendMessage(chatId, `❌ Бот *${targetBot}* офлайн.`);
            } else {
              await sendMessage(chatId, `❌ Ошибка отправки сообщения боту *${targetBot}* (статус ${resp.status}).`);
            }
            continue;
          }
          await sendMessage(chatId, `✉️ Отправлено от *${targetBot}*: ${messageToSend}`);
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
            resolved = userMains[0] || getMainAccount();
          } else {
            const index = parseInt(target) - 1;
            resolved = userTwins[index];
            if (!resolved) {
              await sendMessage(chatId, `❌ У тебя нет ${target}-го твинка.`);
              continue;
            }
          }
          const selection = await apiGet('chat_sender_selection', {});
          selection[chatId] = resolved.toLowerCase();
          await apiSet('chat_sender_selection', selection);
          await sendMessage(chatId, `✅ Сообщения будут отправляться с бота *${resolved}*.`);
        }
        else if (cmd === '/start') {
          await sendMessage(chatId, `💬 *Twins Chat Stream Bot*\n\nЭтот бот управляет дублированием игрового чата твинков.\n\nТвои привязанные твинки: ${userBots.length > 0 ? userBots.join(', ') : 'нет (привяжи через мейн-бота)'}\n\nКоманды:\n\`/streamon <алиас или ник>\` - вкл. трансляцию\n\`/streamoff <алиас или ник>\` - выкл. трансляцию\n\`/setchat <1|2|main>\` - выбрать отправителя\n\`/display <alias|nick|both|hidden>\` - режим отображения`);
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

          const targetBot = await resolveBot(chatId, targetArg);
          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден в твоем списке привязанных ботов.`);
            continue;
          }

          const streaming = await readJSON(STREAMING_FILE);
          if (!streaming[chatId]) streaming[chatId] = {};
          streaming[chatId][targetBot.toLowerCase()] = true;
          await writeJSON(STREAMING_FILE, streaming);

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

          const targetBot = await resolveBot(chatId, targetArg);
          if (!targetBot) {
            await sendMessage(chatId, `❌ Твинк '${targetArg}' не найден.`);
            continue;
          }

          const streaming = await readJSON(STREAMING_FILE);
          if (streaming[chatId]) {
            streaming[chatId][targetBot.toLowerCase()] = false;
            await writeJSON(STREAMING_FILE, streaming);
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

          const modes = await readJSON(DISPLAY_MODE_FILE);
          modes[chatId] = modeArg;
          await writeJSON(DISPLAY_MODE_FILE, modes);

          await sendMessage(chatId, `✅ Режим отображения имен в чате установлен на: *${modeArg}*`);
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
            
            let msg = `💬 *Статус трансляций чата (режим: ${currentMode}):*\n\n`;
            userMains.forEach((botName) => {
              const isStreaming = !!userStream[botName.toLowerCase()];
              msg += `• *${botName}* (мейн-бот)\n   Трансляция в ТГ: ${isStreaming ? '🟢 ВКЛ' : '🔴 ВЫКЛ'}\n\n`;
            });
            userTwins.forEach((botName, index) => {
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
