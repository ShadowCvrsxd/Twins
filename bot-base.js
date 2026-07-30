const mineflayer = require('mineflayer');
const readline = require('readline');
const fs = require('fs');
const { TWINKS, MAIN_ACCOUNT, RESPECT_COOLDOWN, parseCooldown, sendResourcePackAck, dropAll } = require('./utils.js');

function startBot(envPath, configOverrides) {
  console.log('--- [DEBUG] Запуск инициализации startBot ---');
  require('dotenv').config({ path: envPath });
  
  if (!process.env.USERNAME || !process.env.PASSWORD) {
    console.error('--- [DEBUG] ОШИБКА: Не найдены USERNAME или PASSWORD в .env ---');
    return;
  }

  const config = {
    host: '5.83.140.251',
    port: 25809,
    username: process.env.USERNAME,
    version: '1.21.1',
    brand: 'vanilla',
    viewDistance: 'tiny',
    loadInternalChunks: false,
    checkTimeoutInterval: 60000, // ponytail: увеличиваем тайм-аут ожидания пакетов
    ...configOverrides
  };

  const PASSWORD = process.env.PASSWORD;

  let bot;
  let antiAfkInterval;
  let spamTasks = [];
  let isManualQuit = false;
  let schedulerInterval;
  let lastRespectTime = 0;
  let isRespectFailed = false;

  const RESOURCE_PACK_RESPONSE_NAMES = ['resource_pack_receive', 'resource_pack_response', 'resource_pack_status'];
  const RESULT_SUCCESS = 0;
  function handleCommand(botInstance, input) {
    const parts = input.split(' ');
    const command = parts[0].toLowerCase();
    if (command === 'debugquit') { isManualQuit = true; botInstance.quit(); botInstance = null; return true; }
    if (command === 'dropall') {
      try {
        dropAll(botInstance);
        console.log(`[Команда] Успешно выполнено: ${command}`);
        return true;
      } catch (err) {
        console.log(`[Команда] Ошибка выполнения ${command}: ${err.message}`);
        return false;
      }
    }
    if (command === 'stopspam') {
        spamTasks.forEach(task => clearInterval(task.interval));
        spamTasks = []; 
        console.log(`[Команда] Успешно выполнено: ${command} (остановлено всё)`);
        return true;
    }
    if (command === 'spam') {
      const delay = parseInt(parts[1]) * 1000;
      const msg = parts.slice(2).join(' ');
      if (isNaN(delay) || delay <= 0) {
        console.log(`[Команда] Ошибка выполнения ${command}: неверные аргументы`);
        return false;
      }
      const interval = setInterval(() => botInstance.chat(msg), delay);
      spamTasks.push({ msg, interval, delay: parts[1] });
      console.log(`[Команда] Успешно выполнено: ${command} с задержкой ${parts[1]}с`);
      return true;
    }
    if (command === 'spamlist') {
        let textToSend = "Спам не запущен.";
        if (spamTasks.length > 0) {
            // ponytail: максимально компактный формат для надежной отправки через /r
            const list = spamTasks.map((t, i) => `${i+1}:${t.msg}`).join(' | ');
            textToSend = `Спам: ${list}`;
        }
        
        console.log(`[DEBUG] Пытаюсь ответить мейну через /r: ${textToSend}`);
        botInstance.chat(`/r ${textToSend}`);
        return true;
    }
    
    // ponytail: любой другой текст просто пишем в чат
    botInstance.chat(input);
    console.log(`[Команда] Сообщение в чат: "${input}"`);
    return true;
  }

  function tryRespect(username = MAIN_ACCOUNT, isAuto = false) {
    const now = Date.now();
    isRespectFailed = false;
    if (now - lastRespectTime < RESPECT_COOLDOWN) {
      if (!isAuto) {
        const remaining = Math.ceil((RESPECT_COOLDOWN - (now - lastRespectTime)) / 1000 / 60);
        bot.chat(`/r КД на респект: ${remaining} мин.`);
      }
    } else {
      try {
        bot.chat(`/respect ${username}`);
        setTimeout(() => {
          if (bot && !isRespectFailed) {
            bot.chat(`!успешно выдан респект игроку:${username}`);
            lastRespectTime = Date.now();
            TWINKS.forEach(name => { if (bot && name !== bot.username) bot.chat(`/msg ${name} respect`); });
          }
        }, 3000); 
      } catch (err) { bot.chat(`/msg ${MAIN_ACCOUNT} Ошибка при авто-респекте: ${err.message}`); }
    }
  }

  function createBotInstance() {
    console.log(`[Система] Попытка создания бота для ${config.username}...`);
    
    // ponytail: Watchdog таймер
    const spawnTimeout = setTimeout(() => {
        if (bot) {
            console.log('[Watchdog] Бот завис при входе. Принудительный перезапуск.');
            bot.quit();
            bot = null;
        }
    }, 60000); // 1 минута на вход

    try {
      bot = mineflayer.createBot(config);
      bot._client.keepAlive = false; // ponytail: отключаем самоубийство при лагах
      
      // ponytail: ловим абсолютно всё, что происходит с сокетом
      bot._client.on('error', (err) => console.log('[DEBUG] Socket error:', err));
      bot._client.on('packet', (data, meta) => {
          if (meta.name === 'disconnect') {
              console.log('[DEBUG] Сервер прислал пакет disconnect!');
              try {
                  const reason = typeof data.reason === 'string' ? JSON.parse(data.reason) : data.reason;
                  console.log('[DEBUG] ПРИЧИНА КИКА:', JSON.stringify(reason, null, 2));
              } catch (e) {
                  console.log('[DEBUG] ПРИЧИНА КИКА (сырая):', data.reason);
              }
          }
      });
    } catch (err) {
      clearTimeout(spawnTimeout);
      console.error('[Система] КРИТИЧЕСКАЯ ОШИБКА при создании бота:', err);
      return;
    }

    bot.on('error', (err) => {
        console.error('[Система] Ошибка mineflayer:', err);
    });

    bot.on('login', () => {
        console.log('[Система] Успешный логин.');
    });

    if (!schedulerInterval) {
      schedulerInterval = setInterval(() => {
        const now = new Date();
        const mskTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (3600000 * 3));
        const h = mskTime.getHours();
        const m = mskTime.getMinutes();

        if (h === 11 && m === 58) {
          if (bot) {
            console.log('[Scheduler] Время 11:58 МСК. Выполняю плановый выход.');
            isManualQuit = true;
            bot.quit();
            bot = null;
          }
        } else if (h === 12 && m >= 10 && !bot) {
          console.log('[Scheduler] Время 12:10 МСК. Выполняю плановое подключение.');
          isManualQuit = false;
          createBotInstance();
        }
      }, 30000);
    }

    bot._client.on('add_resource_pack', (packet) => {
        setTimeout(() => {
            sendResourcePackAck(bot._client, packet.uuid, RESOURCE_PACK_RESPONSE_NAMES, RESULT_SUCCESS);
        }, 1000);
    });

    bot.on('spawn', () => {
      clearTimeout(spawnTimeout); // ponytail: вход успешный, watchdog не нужен
      console.log(`[Система] Бот ${bot.username} заспавнился!`);
      clearInterval(antiAfkInterval);
      antiAfkInterval = setInterval(() => {
        if (!bot || !bot.entity) return;
        bot.look(bot.entity.yaw + 0.1, bot.entity.pitch, true);
      }, 25000);
    });

    bot.on('messagestr', (message) => {
      const msg = message.toLowerCase();
      if (msg.includes('/login') || msg.includes('авторизуйтесь')) bot.chat(`/login ${PASSWORD}`);
      else if (msg.includes('/register') || msg.includes('зарегистрируйтесь')) bot.chat(`/register ${PASSWORD} ${PASSWORD}`);
      else if ((msg.includes('через') && msg.includes('minutes')) || msg.includes('вы сможете отправить следующий')) {
        lastRespectTime = Date.now() - (RESPECT_COOLDOWN - parseCooldown(msg));
        isRespectFailed = true;
      }
    });

    bot.on('end', (reason) => {
      clearInterval(antiAfkInterval);
      spamTasks.forEach(task => clearInterval(task.interval));
      spamTasks = [];
      if (schedulerInterval) clearInterval(schedulerInterval);
      bot = null;
      if (!isManualQuit) setTimeout(() => { try { createBotInstance(); } catch (e) {} }, 30000);
    });

    bot.on('message', (jsonMsg) => {
      const text = jsonMsg.toString();
      if (!text.trim()) return;
      // console.log(`[Чат] ${text}`); // ponytail: лог чата выключен для экономии ресурсов

      if (text.includes(' › ')) {
        const parts = text.split(' › ');
        if (parts.length >= 3 && parts[1].trim() === bot.username) {
          const senderFull = parts[0].trim();
          const content = parts[2].trim();
          const isFromMain = senderFull.includes(MAIN_ACCOUNT);
          const isFromTwin = TWINKS.some(t => senderFull.includes(t));
          if (content.toLowerCase().includes('respect') && (isFromMain || isFromTwin)) tryRespect();
          else if (isFromMain) handleCommand(bot, content);
        }
      }
    });
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', (line) => {
    const input = line.trim().toLowerCase();
    if (input === 'disconnect') { isManualQuit = true; if(bot) bot.quit(); }
    else if (input === 'connect') { isManualQuit = false; createBotInstance(); }
    else if (bot && handleCommand(bot, input)) console.log(`[Терминал] Команда выполнена: "${input}"`);
  });

  createBotInstance();
}

module.exports = { startBot };
