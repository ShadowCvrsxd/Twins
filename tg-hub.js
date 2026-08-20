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
          await sendMessage(chatId, '🤖 *Twins Telegram Hub*\n\nТвой Telegram зарегистрирован как основной.\n\nКоманды управления:\n`/addtwin <ник>` - добавить твинка (макс. 2)\n`/deltwin <ник>` - отвязать твинка\n`/status` - список твоих привязанных ботов\n`/stopspam` - остановить спам всех твоих ботов');
        } 
        else if (cmd === '/addtwin' || cmd === '/link') {
          const username = parts[1];
          if (!username) {
            await sendMessage(chatId, '❌ Укажи ник твинка: `/addtwin ИмяБота`');
            continue;
          }

          const approved = readJSON(APPROVED_FILE);
          const userBots = approved[chatId] || [];
          // Проверяем, не привязан ли уже этот бот или не превышен ли лимит (2)
          const alreadyLinked = userBots.some(b => b.toLowerCase() === username.toLowerCase());
          if (!alreadyLinked && userBots.length >= 2) {
            await sendMessage(chatId, '❌ Достигнут лимит: можно привязать максимум 2 твинка. Используйте `/deltwin <ник>` для удаления.');
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
            await sendMessage(chatId, `📋 Твои привязанные твинки (${userBots.length}/2):\n- ${userBots.join('\n- ')}`);
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
