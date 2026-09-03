const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');
const { sendResourcePackAck, updateBotStatus } = require('./utils.js');

// Загрузка переменных окружения: сначала .env, затем .env.main
require('dotenv').config();
const envMainPath = path.join(__dirname, '.env.main');
if (fs.existsSync(envMainPath)) {
  require('dotenv').config({ path: envMainPath, override: true });
}

process.on('uncaughtException', (err) => console.error('[Main Bot Uncaught Exception]:', err.message));
process.on('unhandledRejection', (reason) => console.error('[Main Bot Unhandled Rejection]:', reason));

const config = {
  host: process.env.MAIN_BOT_HOST || process.env.MAIN_SERVER_HOST || '5.83.140.251',
  port: parseInt(process.env.MAIN_BOT_PORT || process.env.MAIN_SERVER_PORT || 25809),
  username: process.env.MAIN_USERNAME || process.env.USERNAME || 'MainAccount',
  version: process.env.MINECRAFT_VERSION || '1.21.1',
  brand: 'Гися няшка 󰂑',
  viewDistance: 'tiny',          // минимальная нагрузка
  loadInternalChunks: false,
  checkTimeoutInterval: 30000,
  hideErrors: true,
  disableChatSigning: true,
  plugins: {
    entities: true,
    physics: true,
    pathfinder: false,
    beds: false,
    rain: false,
    book: false,
    experience: false,
    genericPVP: false,
    tablist: false
  }
};

const PASSWORD = process.env.MAIN_PASSWORD || process.env.PASSWORD;
let bot = null;
let isManualQuit = false;

const RESOURCE_PACK_RESPONSE_NAMES = ['resource_pack_receive', 'resource_pack_response', 'resource_pack_status'];
const RESULT_SUCCESS = 0;

function createMainBot() {
  console.log(`[Main AFK Bot] Подключение к ${config.host}:${config.port} под ником ${config.username}...`);

  const spawnTimeout = setTimeout(() => {
    if (bot) {
      console.log('[Main AFK Bot] Таймаут входа. Перезапуск...');
      try { bot.quit(); } catch(e){}
      bot = null;
    }
  }, 60000);

  try {
    bot = mineflayer.createBot(config);
  } catch (err) {
    clearTimeout(spawnTimeout);
    console.error('[Main AFK Bot] Ошибка создания бота:', err.message);
    setTimeout(createMainBot, 15000);
    return;
  }

  bot.on('login', () => {
    console.log('[Main AFK Bot] Успешный логин.');
  });

  bot.on('spawn', () => {
    clearTimeout(spawnTimeout);
    console.log(`[Main AFK Bot] Бот ${bot.username} успешно заспавнился и перешел в режим AFK!`);
    updateBotStatus(config.username, true);
    updateBotStatus('mainbot', true);
  });

  bot._client.on('add_resource_pack', (packet) => {
    setTimeout(() => {
      if (bot && bot._client) {
        sendResourcePackAck(bot._client, packet.uuid, RESOURCE_PACK_RESPONSE_NAMES, RESULT_SUCCESS);
      }
    }, 1000);
  });

  bot.on('messagestr', (message) => {
    const msg = message.trim().toLowerCase();
    if (PASSWORD) {
      if (msg.includes('/login') || msg.includes('авторизуйтесь')) {
        bot.chat(`/login ${PASSWORD}`);
      } else if (msg.includes('/register') || msg.includes('зарегистрируйтесь')) {
        bot.chat(`/register ${PASSWORD} ${PASSWORD}`);
      }
    }
  });

  bot.on('end', (reason) => {
    clearTimeout(spawnTimeout);
    if (bot && bot._client) {
      try { bot._client.end(); } catch (e) {}
    }
    updateBotStatus(config.username, false);
    updateBotStatus('mainbot', false);
    bot = null;
    console.log(`[Main AFK Bot] Соединение закрыто (${reason}).`);
    if (!isManualQuit) {
      console.log('[Main AFK Bot] Реконнект через 15 секунд...');
      setTimeout(createMainBot, 15000);
    }
  });

  bot.on('error', (err) => {
    console.error('[Main AFK Bot] Ошибка:', err.message);
  });
}

createMainBot();
