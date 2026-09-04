const mineflayer = require('mineflayer');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const MEOW_FILE = path.join(__dirname, 'meow_settings.json');
const AUTORESPECT_FILE = path.join(__dirname, 'autorespect_settings.json');
const { getTwinks, getMainAccount, RESPECT_COOLDOWN, parseCooldown, sendResourcePackAck, dropAll, updateTraffic, getTraffic, updateBotStatus, sendTelegramNotification } = require('./utils.js');


function formatTabComponent(comp) {
  if (!comp) return '';
  if (typeof comp === 'string') return comp;
  // ponytail: если это Mineflayer ChatMessage или обертка с toString()
  if (typeof comp.toString === 'function') {
    const str = comp.toString();
    if (str && str !== '[object Object]') return str;
  }
  // ponytail: рекурсивно собираем весь текст из NBT/JSON структуры компонентов Minecraft
  let text = '';
  if (comp.text) {
    text += typeof comp.text === 'object' ? (comp.text.value || '') : comp.text;
  }
  if (comp.extra) {
    const extraList = Array.isArray(comp.extra) ? comp.extra : (comp.extra.value ? (comp.extra.value.value || comp.extra.value) : []);
    if (Array.isArray(extraList)) {
      extraList.forEach(child => {
        text += formatTabComponent(child);
      });
    }
  }
  if (!text && comp.value) {
    if (typeof comp.value === 'string') return comp.value;
    if (typeof comp.value === 'object') return formatTabComponent(comp.value);
  }
  return text;
}

function checkMeow(bot, message, sender) {
  const msg = message.toLowerCase();
  if (!msg.includes('мяу')) return;

  const now = Date.now();
  if (bot._lastMeowMsg === message && now - (bot._lastMeowTime || 0) < 3000) {
    return;
  }
  bot._lastMeowMsg = message;
  bot._lastMeowTime = now;

  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(MEOW_FILE, 'utf-8') || '{}'); } catch(e) {}
  
  const botNameLower = bot.username.toLowerCase();
  const botSettings = settings[botNameLower] || { enabled: false, lastMeowed: 0 };
  
  if (!botSettings.enabled) {
    return;
  }
  const timeSinceLast = now - botSettings.lastMeowed;
  const cooldownMs = 5 * 60 * 1000; // ponytail: КД 5 минут
  if (timeSinceLast < cooldownMs) {
    return;
  }

  botSettings.lastMeowed = now;
  settings[botNameLower] = botSettings;
  fs.writeFileSync(MEOW_FILE, JSON.stringify(settings));

  setTimeout(() => bot.chat('!мяу'), Math.random() * 2000 + 500);
}

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]:', reason);
});

function startBot(envPath, configOverrides) {
  console.log('--- [DEBUG] Запуск инициализации startBot ---');
  require('dotenv').config();
  require('dotenv').config({ path: envPath, override: true });
  
  if (!process.env.USERNAME || !process.env.PASSWORD) {
    console.error('--- [DEBUG] ОШИБКА: Не найдены USERNAME или PASSWORD в .env ---');
    return;
  }

  const config = {
    host: '5.83.140.251',
    port: 25809,
    username: configOverrides.username || process.env.USERNAME,
    version: '1.21.1',
    brand: 'Гися няшка 󰂑',
    viewDistance: 'tiny',          // ponytail: самый минимум чанков
    loadInternalChunks: false,     // ponytail: не качаем мир вообще
    checkTimeoutInterval: 30000, 
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
        tablist: true
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
  let respectTarget = null;
  let isRespectFailed = false;
  let lastTabHeader = null;
  let lastTabFooter = null;
  let sessionBytes = 0; // ponytail: счетчик сессии

  const RESOURCE_PACK_RESPONSE_NAMES = ['resource_pack_receive', 'resource_pack_response', 'resource_pack_status'];
  const RESULT_SUCCESS = 0;

  // ponytail: раз в 1 секунду проверяем команды чата из Telegram-хаба
  const path = require('path');
  const cmdFile = path.join(__dirname, 'bot_commands.json');
  setInterval(() => {
    if (!bot) return;
    try {
      if (fs.existsSync(cmdFile)) {
        let cmds = JSON.parse(fs.readFileSync(cmdFile, 'utf8')) || [];
        const myCmds = cmds.filter(c => c.username.toLowerCase() === config.username.toLowerCase());
        if (myCmds.length > 0) {
          myCmds.forEach(c => {
            bot.chat(c.text);
            console.log(`[Telegram Chat] Отправлено в игру: "${c.text}"`);
          });
          cmds = cmds.filter(c => c.username.toLowerCase() !== config.username.toLowerCase());
          fs.writeFileSync(cmdFile, JSON.stringify(cmds, null, 2));
        }
      }
    } catch(e){}
  }, 1000);

  // ponytail: проверка запросов (например /players) из Telegram-хаба
  const reqFile = path.join(__dirname, 'bot_requests.json');
  setInterval(() => {
    if (!bot) return;
    try {
      if (fs.existsSync(reqFile)) {
        let reqs = JSON.parse(fs.readFileSync(reqFile, 'utf8')) || [];
        const myReqs = reqs.filter(r => r.username.toLowerCase() === config.username.toLowerCase());
        if (myReqs.length > 0) {
          myReqs.forEach(r => {
            if (r.action === 'players') {
              const players = Object.keys(bot.players || {});
              let msg = `👥 Игроки онлайн (${players.length}): ${players.join(', ')}`;
              if (lastTabHeader) {
                msg = `📌 Header: ${lastTabHeader}\n\n` + msg;
              }
              if (lastTabFooter) {
                msg = msg + `\n\n📌 Footer: ${lastTabFooter}`;
              }
              sendTelegramNotification(bot.username, msg);
            } else if (r.action === 'switchServer') {
              const { host, port } = r;
              if (host && port) {
                console.log(`[Система] Переключение на тестовый сервер: ${host}:${port}`);
                config.host = host;
                config.port = parseInt(port);
                isManualQuit = false;
                if (bot) {
                  bot.quit();
                } else {
                  createBotInstance();
                }
              }
            }
          });
          reqs = reqs.filter(r => r.username.toLowerCase() !== config.username.toLowerCase());
          const tempFile = reqFile + '.' + Math.random().toString(36).substring(2) + '.tmp';
          fs.writeFileSync(tempFile, JSON.stringify(reqs, null, 2));
          fs.renameSync(tempFile, reqFile);
        }
      }
    } catch(e){}
  }, 1000);

  // ponytail: проверка авто-респекта с рандомным интервалом от 5 до 10 минут
  function scheduleAutoRespectCheck() {
    const delayMs = 5 * 60 * 1000; // фиксированные 5 минут
    setTimeout(() => {
      if (bot) {
        try {
          let autoSettings = {};
          try { autoSettings = JSON.parse(fs.readFileSync('autorespect_settings.json', 'utf-8') || '{}'); } catch(e) {}
          const isAuto = autoSettings[config.username]?.enabled || false;
          if (isAuto && Date.now() >= nextRespectTime) {
            tryRespect(getMainAccount(), true);
          }
        } catch(e){}
      }
      scheduleAutoRespectCheck();
    }, delayMs);
  }
  scheduleAutoRespectCheck();

  function handleCommand(botInstance, input, replyTarget = null) {
    const parts = input.split(' ');
    const command = parts[0].toLowerCase();
    const replyCmd = replyTarget ? `/m ${replyTarget}` : '/r';
    if (command === 'respect') {
      tryRespect(getMainAccount(), false);
      return true;
    }
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
    if (command === 'time') {
      let timeText = "Время в игре не найдено";
      if (lastTabFooter) {
        // ponytail: ищем строку вида "наигᴘᴀʜᴏ: Xч." или извлекаем наигранные часы
        const match = lastTabFooter.match(/ʜᴀигᴘᴀʜᴏ:\s*([^\s|]+)/i) || lastTabFooter.match(/наиграно:\s*([^\s|]+)/i) || lastTabFooter.match(/([0-9]+\s*ч\.[^|]*)/i);
        if (match) {
          timeText = `Наиграно: ${match[1].trim()}`;
        } else {
          timeText = `Footer: ${lastTabFooter}`;
        }
      }
      botInstance.chat(`${replyCmd} ${timeText}`);
      return true;
    }
    if (command === 'spamlist') {
        let textToSend = "Спам не запущен.";
        if (spamTasks.length > 0) {
            // ponytail: формат с тире: 1:/cookie - 310 сек
            const list = spamTasks.map((t, i) => `${i+1}:${t.msg} - ${t.delay} сек`).join(' | ');
            textToSend = `Спам: ${list}`;
        }
        
        console.log(`[DEBUG] Пытаюсь ответить через ${replyCmd}: ${textToSend}`);
        botInstance.chat(`${replyCmd} ${textToSend}`);
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
    if (now < nextRespectTime) {
      if (!isAuto) {
        const remaining = Math.ceil((nextRespectTime - now) / 1000 / 60);
        bot.chat(`/r КД на респект: ${remaining} мин.`);
      }
      return;
    }

    try {
      respectTarget = { username, isAuto };
      bot.chat(`/respect ${username}`);
    } catch (err) { 
      bot.chat(`/msg ${getMainAccount()} Ошибка при отправке респекта: ${err.message}`); 
      respectTarget = null;
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

    bot.on('whisper', (username, message) => {
        console.log(`[ЛС от ${username}]: ${message}`);
        handleCommand(bot, message, username);
    });

    bot.on('tabHeader', (header, footer) => {
      try {
        lastTabHeader = header ? formatTabComponent(header) : null;
        lastTabFooter = footer ? formatTabComponent(footer) : null;
      } catch(e){}
    });

    bot._client.on('playerlist_header', (packet) => {
      try {
        if (packet.header) lastTabHeader = formatTabComponent(packet.header);
        if (packet.footer) lastTabFooter = formatTabComponent(packet.footer);
      } catch(e){}
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
      updateBotStatus(config.username, true);

      // ponytail: проверка и автопривязка к Telegram
      try {
        const path = require('path');
        const pendingFile = path.join(__dirname, 'links_pending.json');
        const approvedFile = path.join(__dirname, 'links_approved.json');
        if (fs.existsSync(pendingFile)) {
          const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
          const uname = config.username.toLowerCase();
          if (pending[uname]) {
            const { chatId } = pending[uname];
            delete pending[uname];
            fs.writeFileSync(pendingFile, JSON.stringify(pending, null, 2));

            let approved = {};
            if (fs.existsSync(approvedFile)) {
              approved = JSON.parse(fs.readFileSync(approvedFile, 'utf8')) || {};
            }

            let isOwnedElsewhere = false;
            for (const [ownerChatId, bots] of Object.entries(approved)) {
              if (bots.some(b => b.toLowerCase() === config.username.toLowerCase()) && ownerChatId !== chatId.toString()) {
                isOwnedElsewhere = true;
                break;
              }
            }

            if (isOwnedElsewhere) {
              console.log(`[Telegram] Бот ${config.username} уже привязан к другому Telegram аккаунту. Привязка отклонена.`);
              return;
            }

            if (!approved[chatId]) approved[chatId] = [];
            const alreadyLinked = approved[chatId].some(b => b.toLowerCase() === config.username.toLowerCase());
            if (!alreadyLinked && approved[chatId].length >= 2) {
              console.log(`[Telegram] Лимит (2 твинка) исчерпан для чата ${chatId}. Привязка отклонена.`);
              return;
            }
            if (!alreadyLinked) {
              approved[chatId].push(config.username);
              fs.writeFileSync(approvedFile, JSON.stringify(approved, null, 2));
            }

            console.log(`[Telegram] Бот ${config.username} успешно привязан к Telegram Chat ID: ${chatId}`);

            if (process.env.TG_BOT_TOKEN) {
              fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: `✅ Бот *${config.username}* успешно запущен и привязан!`,
                  parse_mode: 'Markdown'
                })
              }).catch(() => {});
            }
          }
        }
      } catch (e) {}

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

      // ponytail: уведомление об обновлении
      const updateFlag = path.join(__dirname, '.just_updated');
      if (fs.existsSync(updateFlag)) {
          setTimeout(() => {
              if (!config.isMain) {
                  bot.chat(`/msg ${getMainAccount()} Я обновился!`);
              }
              try { fs.unlinkSync(updateFlag); } catch(e) {}
          }, 5000);
      }
    });

    bot.on('messagestr', (message) => {
      const msg = message.trim().toLowerCase();
      if (msg.includes('/login') || msg.includes('авторизуйтесь')) {
        bot.chat(`/login ${PASSWORD}`);
      } else if (msg.includes('/register') || msg.includes('зарегистрируйтесь')) {
        bot.chat(`/register ${PASSWORD} ${PASSWORD}`);
      } else if (msg.includes('ʀ | отлично! вы отправили респект')) {
        if (respectTarget) {
          const { username, isAuto } = respectTarget;
          if (!isAuto) {
            bot.chat(`!успешно выдан респект игроку:${username}`);
            getTwinks().forEach(name => { if (bot && name !== bot.username) bot.chat(`/msg ${name} respect`); });
          }
          respectTarget = null;
        }
        nextRespectTime = Date.now() + RESPECT_COOLDOWN;
      } else if (
        msg.includes('ʀ | вы сможете отправить следующий /respect') ||
        msg.includes('ʀ | через')
      ) {
        const cdMs = parseCooldown(message);
        nextRespectTime = Date.now() + (cdMs || RESPECT_COOLDOWN);
        respectTarget = null;
      } else {
        if (!msg.startsWith('/login') && !msg.startsWith('/register')) {
          sendTelegramNotification(bot.username, message);
        }
      }
    });

    bot.on('end', (reason) => {
      // ponytail: принудительно убиваем сокет, чтобы сервер не держал соединение
      if (bot && bot._client) {
          try { bot._client.end(); } catch (e) {}
      }
      clearTimeout(spawnTimeout);
      if (bot) {
          updateBotStatus(bot.username || config.username, false);
      }
      bot = null;
      console.log(`[Система] Соединение закрыто. Причина: ${reason}`);
      if (!isManualQuit) {
        console.log('[Система] Запуск реконнекта через 15 сек...');
        setTimeout(() => { try { createBotInstance(); } catch (e) {} }, 15000);
      }
    });

    bot.on('message', (jsonMsg) => {
      const text = jsonMsg.toString();
      if (!text.trim()) return;

      console.log(`[Debug] Raw message: ${text}`);
      if (text.includes(' › ')) {
        const parts = text.split(' › ');
        checkMeow(bot, parts.slice(1).join(' › '), parts[0].trim());
        if (parts.length >= 3 && parts[1].trim() === bot.username) {
          const senderFull = parts[0].trim();
          const content = parts[2].trim();
          const isFromMain = senderFull.includes(getMainAccount());
          const isFromTwin = getTwinks().some(t => senderFull.includes(t));
          if (content.toLowerCase().includes('respect') && (isFromMain || isFromTwin)) tryRespect();
          else if (isFromMain) handleCommand(bot, content);
        }
      } else if (text.startsWith('<') && text.includes('> ')) {
        // ponytail: формат "<Имя> Сообщение"
        const parts = text.split('> ');
        const sender = parts[0].substring(1); // убираем <
        const content = parts.slice(1).join('> ');
        console.log(`[Debug] Чат (формат угловые скобки): "${content}" от "${sender}"`);
        checkMeow(bot, content, sender);
      } else if (text.includes(': ')) {
        // ... (previous logic)
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
