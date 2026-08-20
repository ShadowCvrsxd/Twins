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
          await sendMessage(chatId, '🤖 *Twins Telegram Hub*\n\nКоманды:\n`/link <ник>` - привязать аккаунт майнкрафт\n`/status` - статус твоих ботов\n`/stopspam` - остановить спам всех твоих ботов');
        } 
        else if (cmd === '/link') {
          const username = parts[1];
          if (!username) {
            await sendMessage(chatId, '❌ Укажи ник: `/link ИмяБота`');
            continue;
          }
          const code = Math.floor(100000 + Math.random() * 900000).toString();
          const pending = readJSON(PENDING_FILE);
          pending[username.toLowerCase()] = { code, chatId };
          writeJSON(PENDING_FILE, pending);

          await sendMessage(chatId, `🔑 Запрос на привязку для *${username} создален.*\n\nКод подтверждения: \`${code}\`\n\nЗапусти бота локально с этим ником — в консоли появится инструкция или код автоматически подтвердится!`);
        }
        else if (text.length === 6 && /^\d+$/.test(text)) {
          // Проверяем, не ввел ли пользователь код подтверждения
          const pending = readJSON(PENDING_FILE);
          let foundKey = null;
          for (const [uname, data] of Object.entries(pending)) {
            if (data.chatId === chatId && data.code === text) {
              foundKey = uname;
              break;
            }
          }

          if (foundKey) {
            const pendingData = pending[foundKey];
            delete pending[foundKey];
            writeJSON(PENDING_FILE, pending);

            const approved = readJSON(APPROVED_FILE);
            if (!approved[chatId]) approved[chatId] = [];
            if (!approved[chatId].includes(pendingData.username || foundKey)) {
              approved[chatId].push(foundKey);
              writeJSON(APPROVED_FILE, approved);
            }

            await sendMessage(chatId, `✅ Аккаунт *${foundKey}* успешно привязан к твоему Telegram!`);
          } else {
            await sendMessage(chatId, '❌ Неверный или устаревший код привязки.');
          }
        }
        else if (cmd === '/status') {
          const approved = readJSON(APPROVED_FILE);
          const userBots = approved[chatId] || [];
          if (userBots.length === 0) {
            await sendMessage(chatId, '📭 У тебя нет привязанных ботов. Используй `/link <ник>`.');
          } else {
            await sendMessage(chatId, `📋 Твои боты:\n- ${userBots.join('\n- ')}`);
          }
        }
      }
    }
  } catch (e) {
    console.error('[Telegram Polling Error]:', e.message);
  }
  setTimeout(poll, 1000);
}

poll();
