const mineflayer = require('mineflayer');
const readline = require('readline');
const fs = require('fs');
const { getTwinks, getMainAccount, RESPECT_COOLDOWN, parseCooldown, sendResourcePackAck, dropAll, updateTraffic, getTraffic } = require('./utils.js');

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
    viewDistance: 'tiny',          // ponytail: самый минимум чанков
    loadInternalChunks: false,     // ponytail: не качаем мир вообще
    checkTimeoutInterval: 120000,  // ponytail: 2 минуты
    hideErrors: true,
    disableChatSigning: true,
    // ponytail: оставляем базу для откидывания и инвентаря
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
    },
    ...configOverrides
  };

  const PASSWORD = process.env.PASSWORD;

  let bot;
  let isManualQuit = false;
  let isScheduledOffline = false; // ponytail: флаг планового отключения
  let schedulerInterval;
  let spamTasks = [];
  const spamFile = `spam_tasks_${config.username}.json`;

  function loadSpamTasks() {
    if (!fs.existsSync(spamFile)) return [];
    try {
      return JSON.parse(fs.readFileSync(spamFile, 'utf8')) || [];
    } catch (e) {
      return [];
    }
  }

  function saveSpamTasks(tasks) {
    try {
      const data = tasks.map(t => ({ msg: t.msg, delay: t.delay }));
      fs.writeFileSync(spamFile, JSON.stringify(data));
    } catch (e) {}
  }
  let nextRespectTime = 0;
  let isRespectFailed = false;
  let sessionBytes = 0; // ponytail: счетчик сессии

  const RESOURCE_PACK_RESPONSE_NAMES = ['resource_pack_receive', 'resource_pack_response', 'resource_pack_status'];
  const RESULT_SUCCESS = 0;

  // ponytail: раз в 10 секунд сбрасываем стату в общий файл
  setInterval(() => {
      if (sessionBytes > 0) {
          updateTraffic(config.username, sessionBytes);
          sessionBytes = 0;
      }
  }, 10000);
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
        saveSpamTasks([]);
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
      saveSpamTasks(spamTasks);
      console.log(`[Команда] Успешно выполнено: ${command} с задержкой ${parts[1]}с`);
      return true;
    }
    if (command === 'spamlist') {
        let textToSend = "Спам не запущен.";
        if (spamTasks.length > 0) {
            // ponytail: формат с тире: 1:/cookie - 310 сек
            const list = spamTasks.map((t, i) => `${i+1}:${t.msg} - ${t.delay} сек`).join(' | ');
            textToSend = `Спам: ${list}`;
        }
        
        console.log(`[DEBUG] Пытаюсь ответить мейну через /r: ${textToSend}`);
        botInstance.chat(`/r ${textToSend}`);
        return true;
    }
    if (command === 'traffic') {
        const stats = getTraffic();
        const total = Object.entries(stats).map(([name, bytes]) => 
            `${name}:${(bytes / 1024 / 1024).toFixed(2)}МБ`
        ).join(' | ');
        botInstance.chat(`/r Трафик ботов: ${total}`);
        return true;
    }
    
    // ponytail: любой другой текст просто пишем в чат
    botInstance.chat(input);
    console.log(`[Команда] Сообщение в чат: "${input}"`);
    return true;
  }

  function tryRespect(username = getMainAccount(), isAuto = false) {
    const now = Date.now();
    isRespectFailed = false;
    if (now < nextRespectTime) {
      if (!isAuto) {
        const remaining = Math.ceil((nextRespectTime - now) / 1000 / 60);
        bot.chat(`/r КД на респект: ${remaining} мин.`);
      }
    } else {
      try {
        bot.chat(`/respect ${username}`);
        setTimeout(() => {
          if (bot && !isRespectFailed) {
            bot.chat(`!успешно выдан респект игроку:${username}`);
            nextRespectTime = Date.now() + RESPECT_COOLDOWN;
            getTwinks().forEach(name => { if (bot && name !== bot.username) bot.chat(`/msg ${name} respect`); });
          }
        }, 3000); 
      } catch (err) { bot.chat(`/msg ${getMainAccount()} Ошибка при авто-респекте: ${err.message}`); }
    }
  }

  // ponytail: точный планировщик перезагрузки по МСК
  function scheduleNextRestart() {
    const now = new Date();
    const msk = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + 10800000);
    const target = new Date(msk);
    target.setHours(11, 58, 0, 0);
    if (msk >= target) target.setDate(target.getDate() + 1);

    setTimeout(() => {
      console.log('[Scheduler] Время 11:58 МСК. Выполняю плановый выход.');
      isManualQuit = true;
      if (bot) {
        try { bot.quit(); } catch (e) {}
        bot = null;
      }
      setTimeout(() => {
        console.log('[Scheduler] Время 12:12 МСК. Выполняю плановое подключение.');
        isManualQuit = false;
        createBotInstance();
        scheduleNextRestart();
      }, 14 * 60 * 1000); // 14 минут (12:12 МСК)
    }, target.getTime() - msk.getTime());
  }

  scheduleNextRestart();

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
      
      // ponytail: ловим абсолютно всё, что происходит с сокетом
      bot._client.on('error', (err) => console.log('[DEBUG] Socket error:', err));
      
      // ponytail: дебаг пакетов для поиска "обжоры" трафика
      let packetStats = {};
      bot._client.on('packet', (data, meta, buffer) => {
          if (buffer) sessionBytes += buffer.length;
          
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

    bot._client.on('add_resource_pack', (packet) => {
        setTimeout(() => {
            if (bot && bot._client) {
                sendResourcePackAck(bot._client, packet.uuid, RESOURCE_PACK_RESPONSE_NAMES, RESULT_SUCCESS);
            }
        }, 1000);
    });

    bot.on('spawn', () => {
      clearTimeout(spawnTimeout); // ponytail: вход успешный, watchdog не нужен
      console.log(`[Система] Бот ${bot.username} заспавнился!`);

      // ponytail: восстановление спама из файла
      spamTasks.forEach(t => clearInterval(t.interval));
      spamTasks = [];
      const savedTasks = loadSpamTasks();
      savedTasks.forEach(st => {
        const delayMs = parseInt(st.delay) * 1000;
        const interval = setInterval(() => {
          if (bot) {
            try { bot.chat(st.msg); } catch (e) {}
          }
        }, delayMs);
        spamTasks.push({ msg: st.msg, interval, delay: st.delay });
      });
      if (savedTasks.length > 0) {
        console.log(`[Спам] Восстановлено активных задач: ${savedTasks.length}`);
      }
    });

    bot.on('messagestr', (message) => {
      const msg = message.trim().toLowerCase();
      if (msg.includes('/login') || msg.includes('авторизуйтесь')) bot.chat(`/login ${PASSWORD}`);
      else if (msg.includes('/register') || msg.includes('зарегистрируйтесь')) bot.chat(`/register ${PASSWORD} ${PASSWORD}`);
      else if (
        msg === 'вы сможете отправить следующий /respect' ||
        /^через \d+/.test(msg)
      ) {
        const cdMs = parseCooldown(message);
        nextRespectTime = Date.now() + cdMs;
        isRespectFailed = true;
      }
    });

    bot.on('end', (reason) => {
      // ponytail: принудительно убиваем сокет, чтобы сервер не держал соединение
      if (bot && bot._client) {
          try { bot._client.end(); } catch (e) {}
      }
      clearTimeout(spawnTimeout);
      bot = null;
      console.log(`[Система] Соединение закрыто. Причина: ${reason}`);
      if (!isManualQuit) {
        console.log('[Система] Запуск реконнекта через 30 сек...');
        setTimeout(() => { try { createBotInstance(); } catch (e) {} }, 30000);
      }
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
          const isFromMain = senderFull.includes(getMainAccount());
          const isFromTwin = getTwinks().some(t => senderFull.includes(t));
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
