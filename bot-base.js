const mineflayer = require('mineflayer');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { get, set } = require('./db.js');
const { loadFeatureState, saveFeatureState, sanitizeSpamTasks, formatSpamList } = require('./feature-state.js');

// ponytail: автокликер
function getAttackSpeed(bot) {
  try {
    if (!bot.heldItem) return 1.6;
    const item = bot.heldItem;
    
    // Path (a): Modern NBT (1.21.x components)
    const mods = item.nbt?.value?.components?.value?.['minecraft:attribute_modifiers']?.value?.modifiers?.value;
    if (Array.isArray(mods)) {
      for (const mod of mods) {
        const an = mod.value?.attribute_name?.value;
        if (typeof an === 'string' && an.toLowerCase().replace(/[_-]/g, '').includes('attackspeed')) {
          const amt = parseFloat(mod.value?.amount?.value);
          if (!isNaN(amt)) return amt;
        }
      }
    }
    // Path (b): Old NBT (attributeModifiers list)
    const oldMods = item.nbt?.value?.attributeModifiers?.value;
    if (Array.isArray(oldMods)) {
      for (const mod of oldMods) {
        const an = mod.value?.AttributeName?.value;
        if (typeof an === 'string' && an.toLowerCase().replace(/[_-]/g, '').includes('attackspeed')) {
          const amt = parseFloat(mod.value?.Amount?.value);
          if (!isNaN(amt)) return amt;
        }
      }
    }
    // Path (c): Attributes
    if (item.attributes) {
      const speed = item.attributes['minecraft:generic.attack_speed'];
      if (speed !== undefined) return parseFloat(speed);
    }
  } catch (e) {
  }
  return 1.6;
}
const { getTwinks, getMainAccount, RESPECT_COOLDOWN, parseCooldown, sendResourcePackAck, dropAll, getTraffic, shouldSend } = require('./utils.js');
const { shouldScheduleReconnect } = require('./hub-util.js');

// ponytail: one bot instance per process (documented), so timer state lives at
// module scope — testable via require('./bot-base') without calling startBot.
let autoClickTimer = null;
let autoClickBot = null;
let reconnectScheduled = false;

function stopAutoClick() {
  if (autoClickTimer) {
    clearTimeout(autoClickTimer);
    autoClickTimer = null;
    autoClickBot = null;
  }
}


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



process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]:', reason);
});

function startBot(envPath, configOverrides) {
  console.log('--- [DEBUG] Запуск инициализации startBot ---');
  require('dotenv').config();
  require('dotenv').config({ path: fs.existsSync(envPath) ? envPath : '.env', override: true });
  
  if (!process.env.USERNAME || !process.env.PASSWORD) {
    console.error('--- [DEBUG] ОШИБКА: Не найдены USERNAME или PASSWORD в .env ---');
    return;
  }

  const config = {
    host: process.env.MINECRAFT_HOST || process.env.MAIN_SERVER_HOST || '5.83.140.251',
    port: parseInt(process.env.MINECRAFT_PORT || process.env.MAIN_SERVER_PORT || 25809),
    username: configOverrides.username || process.env.USERNAME,
    version: false,
    brand: 'Гися няшка 󰂑',
    viewDistance: 'tiny',          // ponytail: самый минимум чанков (избегаем таймаутов в лобби)
    loadInternalChunks: false,     // ponytail: не качаем мир вообще (избегаем таймаутов)
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
  let hubSocket = null;
  let hubSocketBot = null;
  let isManualQuit = false;
  let isScheduledOffline = false; // ponytail: флаг планового отключения
  let reconnectDelayMs = 30000; // ponytail: backoff реконнекта, сброс на успешном спавне
  let schedulerInterval;
  let spamTasks = [];
  const spamKey = `spam_tasks_${config.username.toLowerCase()}`;

  function loadSpamTasks() {
    return get(spamKey, []);
  }

  function saveSpamTasks(tasks) {
    try {
      const data = tasks.map(t => ({ msg: t.msg, delay: t.delay }));
      set(spamKey, data);
    } catch (e) {}
  }

  // ponytail: общий перезапуск спам-интервалов
  function reloadSpamTasks(initialDelayMs = 10000) {
    setTimeout(() => {
      if (!bot) return;
      spamTasks.forEach(t => clearInterval(t.interval));
      spamTasks = [];
      const savedTasks = loadSpamTasks();
      savedTasks.forEach(st => {
        const delayMs = parseInt(st.delay) * 1000;
        const interval = setInterval(() => {
          if (bot) { try { bot.chat(st.msg); } catch (e) {} }
        }, delayMs);
        spamTasks.push({ msg: st.msg, interval, delay: st.delay });
      });
      if (savedTasks.length > 0) {
        console.log(`[Спам] Восстановлено активных задач: ${savedTasks.length}`);
      }
    }, initialDelayMs);
  }

  function replaceSpamTasks(list) {
    spamTasks.forEach(t => clearInterval(t.interval));
    spamTasks = [];
    const clean = sanitizeSpamTasks(list);
    clean.forEach(st => {
      const delayMs = Math.max(1000, parseInt(st.delay) * 1000);
      const interval = setInterval(() => { if (bot) { try { bot.chat(st.msg); } catch (e) {} } }, delayMs);
      spamTasks.push({ msg: st.msg, interval, delay: st.delay });
    });
    saveSpamTasks(spamTasks);
  }


  let nextRespectTime = 0;
  let respectTarget = null;
  let isRespectFailed = false;
  let lastTabHeader = null;
  let lastTabFooter = null;
  let sessionBytes = 0; // ponytail: счетчик сессии

  const RESOURCE_PACK_RESPONSE_NAMES = ['resource_pack_receive', 'resource_pack_response', 'resource_pack_status'];
  const RESULT_SUCCESS = 0;

  const featureState = loadFeatureState(config.username);
  let clickerState = featureState.clicker;
  let meowState = { ...featureState.meow, lastMeowed: 0 };
  let autoRespectEnabled = featureState.autoRespectEnabled;

  function startAutoClick(botInstance) {
    if (autoClickTimer && autoClickBot === botInstance) return;
    if (autoClickTimer) stopAutoClick();
    autoClickBot = botInstance;
    const tick = () => {
      if (!botInstance || !botInstance.entity) { autoClickTimer = setTimeout(tick, 500); return; }
      if (!clickerState.enabled) { stopAutoClick(); return; }
      const baseDelay = clickerState.manualCooldownMs || Math.round(1000 / getAttackSpeed(botInstance));
      const jitter = Math.floor(Math.random() * 200) - 100;
      const delay = Math.max(200, baseDelay + jitter);
      try {
        const target = botInstance.nearestEntity((e) => {
          if (!e || !e.position) return false;
          if (e.name !== 'armor_stand') return false;
          return botInstance.entity.position.distanceTo(e.position) <= 3.0;
        });
        if (target) {
          botInstance.attack(target);
        }
      } catch (e) {}
      autoClickTimer = setTimeout(tick, delay);
    };
    const baseDelay = clickerState.manualCooldownMs || Math.round(1000 / getAttackSpeed(botInstance));
    autoClickTimer = setTimeout(tick, baseDelay);
  }

  function checkMeow(botInstance, message, sender) {
    const msg = message.toLowerCase();
    if (!msg.includes('мяу')) return;

    const now = Date.now();
    if (botInstance._lastMeowMsg === message && now - (botInstance._lastMeowTime || 0) < 3000) {
      return;
    }
    botInstance._lastMeowMsg = message;
    botInstance._lastMeowTime = now;

    if (!meowState.enabled) {
      return;
    }
    const timeSinceLast = now - meowState.lastMeowed;
    const cooldownMs = meowState.cooldownMs || (5 * 60 * 1000);
    if (timeSinceLast < cooldownMs) {
      return;
    }

    meowState.lastMeowed = now;
    setTimeout(() => botInstance.chat('!мяу'), Math.random() * 2000 + 500);
  }

  function sendToHub(payload) {
    if (!shouldSend(hubSocket)) return;
    try {
      hubSocket.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    } catch (e) {
      console.error('[WebSocket] Ошибка отправки в хаб:', e);
    }
  }

  // ponytail: WebSocket соединение для получения команд из хаба
  function connectToHub(botInstance) {
    // ponytail: всегда привязываем сокет к ЖИВОМУ инстансу — таймер реконнекта (ниже) замыкается
    // на старый botInstance и иначе закрывает здоровый сокет ради мёртвого бота.
    botInstance = bot;
    if (!botInstance) return null;
    if (hubSocket && (hubSocket.readyState === WebSocket.OPEN || hubSocket.readyState === WebSocket.CONNECTING)) {
      if (hubSocketBot === botInstance) {
        console.log(`[WebSocket] Соединение с Hub уже активно (readyState=${hubSocket.readyState}). Новый сокет не создаётся.`);
        return hubSocket;
      }
      // ponytail: stale socket bound to a previous botInstance — its handlers would operate on a dead bot
      try { hubSocket.close(); } catch (e) {}
      hubSocket = null;
      hubSocketBot = null;
    }
    const botName = config.username.toLowerCase();
    const token = process.env.BOT_TOKEN || '';
    const host = process.env.HUB_HOST || 'localhost';
    const port = process.env.HUB_PORT || '8089';
    const url = `ws://${host}:${port}?bot=${botName}`;
    const ws = new WebSocket(url);
    hubSocket = ws;
    hubSocketBot = botInstance;

    let chatQueue = [];
    let isSendingChat = false;

    function processChatQueue() {
      if (isSendingChat || chatQueue.length === 0) return;
      isSendingChat = true;
      const text = chatQueue.shift();
      try {
        botInstance.chat(text);
        console.log(`[Telegram Chat] Отправлено в игру: "${text}"`);
      } catch (e) {
        console.error(`[Telegram Chat] ОШИБКА отправки в игру "${text}": ${e.message}`);
      }
      setTimeout(() => {
        isSendingChat = false;
        processChatQueue();
      }, 700);
    }

    ws.on('open', () => {
      reconnectScheduled = false;
      console.log(`[WebSocket] Бот ${botName} подключен к Hub.`);
      ws.send(JSON.stringify({ type: 'auth', token }));
    });

    ws.on('message', (data) => {
      try {
        const rawStr = data.toString();
        const command = JSON.parse(rawStr);
        // ponytail: по умолчанию молчим — сырые дампы WS только при DEBUG_WS=1
        if (process.env.DEBUG_WS) {
          console.log(`[WebSocket Debug] [${config.username}] Received raw WS message:`, rawStr);
          console.log(`[WebSocket Debug] [${config.username}] Parsed command object:`, JSON.stringify(command, null, 2));
        }

        if (command.action === 'chat') {
          chatQueue.push(command.text);
          processChatQueue();
        } else if (command.action === 'players') {
            const players = Object.keys(botInstance.players || {});
            let msg = `👥 Игроки онлайн (${players.length}): ${players.join(', ')}`;
            if (lastTabHeader) {
              const cleanHeader = lastTabHeader.replace(/[\ufffd\uFFFD]/g, '');
              msg = `📌 Header: ${cleanHeader}\n\n` + msg;
            }
            if (lastTabFooter) {
              const cleanFooter = lastTabFooter.replace(/[\ufffd\uFFFD]/g, '');
              msg = msg + `\n\n📌 Footer: ${cleanFooter}`;
            }
            sendToHub({ type: 'response', text: msg, chatId: command.chatId });
        } else if (command.action === 'switchServer') {
            const { host, port } = command;
            if (host && port) {
              console.log(`[Система] Переключение на сервер: ${host}:${port}`);
              config.host = host;
              config.port = parseInt(port);
              isManualQuit = false;
              if (botInstance) {
                botInstance.quit();
              } else {
                createBotInstance();
              }
            }
        } else if (command.action === 'reloadSpam') {
            reloadSpamTasks(1000);
            console.log(`[${config.username}] Перезагрузка спама из хаба`);
        } else if (command.action === 'addSpam') {
            if (spamTasks.length >= 20) {
                sendToHub({ type: 'response', text: '❌ Лимит спама: 20 задач.', chatId: command.chatId });
            } else {
                const interval = setInterval(()=>{if(bot){try{bot.chat(command.msg)}catch(e){}}}, Math.max(1000, parseInt(command.delay||10)*1000));
                spamTasks.push({ msg: command.msg, interval, delay: command.delay||10 });
                saveSpamTasks(spamTasks);
                sendToHub({ type: 'response', text: formatSpamList(spamTasks), chatId: command.chatId });
            }
        } else if (command.action === 'delSpam') {
            const index = parseInt(command.index);
            if (isNaN(index) || index < 1 || index > spamTasks.length) {
                sendToHub({ type: 'response', text: '❌ Неверный номер задачи.', chatId: command.chatId });
            } else {
                clearInterval(spamTasks[index-1].interval);
                spamTasks.splice(index-1,1);
                saveSpamTasks(spamTasks);
                sendToHub({ type: 'response', text: formatSpamList(spamTasks), chatId: command.chatId });
            }
        } else if (command.action === 'setSpamTasks') {
            replaceSpamTasks(command.tasks);
            sendToHub({ type: 'response', text: formatSpamList(spamTasks), chatId: command.chatId });
        } else if (command.action === 'getSpamList') {
            sendToHub({ type: 'response', text: formatSpamList(spamTasks), chatId: command.chatId });
        } else if (command.action === 'stopSpam') {
            spamTasks.forEach(t=>clearInterval(t.interval));
            spamTasks=[];
            saveSpamTasks([]);
            sendToHub({ type: 'response', text: '✅ Спам остановлен.', chatId: command.chatId });
        } else if (command.action === 'setSwing' || command.action === 'setswing') {
            const manualCooldownMs = command.manualCooldownMs !== undefined ? command.manualCooldownMs : (command.ms !== undefined ? command.ms : null);
            clickerState.manualCooldownMs = manualCooldownMs;
            saveFeatureState(config.username, { clicker: clickerState, meow: { enabled: meowState.enabled, cooldownMs: meowState.cooldownMs }, autoRespectEnabled });
            console.log(`[${config.username}] [Command Received] setSwing / setswing: manualCooldownMs=${manualCooldownMs}`);
        } else if (command.action === 'setMeow') {
            if (command.enabled !== undefined) {
              meowState.enabled = command.enabled;
            }
            if (command.cooldownMs !== undefined) {
              meowState.cooldownMs = command.cooldownMs;
            }
            saveFeatureState(config.username, { clicker: clickerState, meow: { enabled: meowState.enabled, cooldownMs: meowState.cooldownMs }, autoRespectEnabled });
            console.log(`[${config.username}] [Command Received] setMeow: enabled=${meowState.enabled}, cooldownMs=${meowState.cooldownMs}`);
        } else if (command.action === 'setAutoRespect') {
            if (command.enabled !== undefined) {
              autoRespectEnabled = command.enabled;
            }
            saveFeatureState(config.username, { clicker: clickerState, meow: { enabled: meowState.enabled, cooldownMs: meowState.cooldownMs }, autoRespectEnabled });
            console.log(`[${config.username}] [Command Received] setAutoRespect: enabled=${autoRespectEnabled}`);
        } else if (command.action === 'setAutoClick' || command.action === 'autoclickon' || command.action === 'autoclickoff') {
            const enabled = command.enabled !== undefined ? command.enabled : (command.action === 'autoclickon');
            clickerState.enabled = enabled;
            saveFeatureState(config.username, { clicker: clickerState, meow: { enabled: meowState.enabled, cooldownMs: meowState.cooldownMs }, autoRespectEnabled });
            if (enabled) {
              startAutoClick(botInstance);
            } else {
              stopAutoClick();
            }
            console.log(`[${config.username}] [Command Received] setAutoClick: enabled=${clickerState.enabled}`);
        } else if (command.action === 'pos') {
            if (botInstance && botInstance.entity && botInstance.entity.position) {
              const p = botInstance.entity.position;
              const f = (n) => Math.floor(n);
              const x = f(p.x);
              const y = f(p.y);
              const z = f(p.z);
              const netherX = f(p.x / 8);
              const netherZ = f(p.z / 8);

              const cleanHeader = lastTabHeader ? lastTabHeader.replace(/§[0-9a-fk-or]/gi, '').replace(/[\ufffd\uFFFD]/g, '') : '';
              const cleanFooter = lastTabFooter ? lastTabFooter.replace(/§[0-9a-fk-or]/gi, '').replace(/[\ufffd\uFFFD]/g, '') : '';
              const tabText = `${cleanHeader} ${cleanFooter}`;
              let worldName = 'Неизвестный мир';
              if (tabText.includes('Мир ферм')) worldName = 'Мир ферм';
              else if (tabText.includes('Мир построек')) worldName = 'Мир построек';
              else if (tabText.includes('Мир артов')) worldName = 'Мир артов';

              const msg = `📍 *Координаты твинка ${config.username}*\nМир: ${worldName}\n\n🌍 Обычный мир: X: ${x}, Y: ${y}, Z: ${z}\n🔥 Ад (Nether): X: ${netherX}, Z: ${netherZ}`;

              if (command.chatId) {
                sendToHub({ type: 'response', text: msg, chatId: command.chatId });
              } else {
                sendToHub({ type: 'response', text: msg });
              }
              console.log(`[${config.username}] Координаты отправлены`);
            } else {
              const msg = `❌ Твинк ${config.username} не спавнился или координаты недоступны.`;
              if (command.chatId) {
                sendToHub({ type: 'response', text: msg, chatId: command.chatId });
              } else {
                sendToHub({ type: 'response', text: msg });
              }
            }

        } else if (command.action === 'start') {
            if (!bot) {
                isManualQuit = false;
                createBotInstance();
                console.log(`[Command] Received start command, creating bot instance.`);
            } else {
                console.log(`[Command] Received start command, already running.`);
            }
        } else if (command.action === 'stoptwin') {
            isManualQuit = true;
            botInstance.quit();
        }
      } catch (e) {
        console.error('[WebSocket] Ошибка обработки команды:', e);
      }
    });

    ws.on('close', () => {
      if (hubSocket === ws) { hubSocket = null; hubSocketBot = null; }
      const hasOpenSocket = !!(hubSocket && (hubSocket.readyState === WebSocket.OPEN || hubSocket.readyState === WebSocket.CONNECTING));
      if (!shouldScheduleReconnect({ hubSocketState: hubSocket && hubSocket.readyState, hasOpenSocket, isManualQuit, reconnectScheduled })) {
        console.log(`[WebSocket] Бот ${botName} отключен. Реконнект не требуется.`);
        return;
      }
      reconnectScheduled = true;
      console.log(`[WebSocket] Бот ${botName} отключен. Реконнект через 5 сек...`);
      setTimeout(() => {
        reconnectScheduled = false;
        connectToHub(botInstance);
      }, 5000);
    });

    ws.on('error', (e) => {
        console.error('[WebSocket] Ошибка:', e);
    });

    return ws;
  }


  // ponytail: проверка авто-респекта с рандомным интервалом от 5 до 10 минут
  function scheduleAutoRespectCheck() {
    const delayMs = 5 * 60 * 1000; // фиксированные 5 минут
    setTimeout(() => {
      if (bot) {
        try {
          if (autoRespectEnabled && Date.now() >= nextRespectTime) {
            tryRespect(getMainAccount(), true);
          }
        } catch(e){}
      }
      scheduleAutoRespectCheck();
    }, delayMs);
  }
  scheduleAutoRespectCheck();

  function handleCommand(botInstance, input) {
    const parts = input.split(' ');
    const command = parts[0].toLowerCase();
    const replyCmd = '/r'; // ponytail: после T16 команды только с терминала — ответ в последний ЛС
    if (command === 'autoclickon') {
      if (clickerState.enabled) {
        botInstance.chat(`${replyCmd} Автокликер уже включен`);
      } else {
        clickerState.enabled = true;
        saveFeatureState(config.username, { clicker: clickerState, meow: { enabled: meowState.enabled, cooldownMs: meowState.cooldownMs }, autoRespectEnabled });
        startAutoClick(botInstance);
        botInstance.chat(`${replyCmd} Автокликер включен`);
      }
      return true;
    }
    if (command === 'autoclickoff') {
      clickerState.enabled = false;
      saveFeatureState(config.username, { clicker: clickerState, meow: { enabled: meowState.enabled, cooldownMs: meowState.cooldownMs }, autoRespectEnabled });
      stopAutoClick();
      botInstance.chat(`${replyCmd} Автокликер выключен`);
      return true;
    }
    if (command === 'setswing') {
      const val = parts[1];
      if (!val || val.toLowerCase() === 'auto' || val === '0') {
        clickerState.manualCooldownMs = null;
        saveFeatureState(config.username, { clicker: clickerState, meow: { enabled: meowState.enabled, cooldownMs: meowState.cooldownMs }, autoRespectEnabled });
        botInstance.chat(`${replyCmd} Тайминг удара: авто (по оружию)`);
      } else {
        const ms = parseInt(val, 10);
        if (isNaN(ms) || ms <= 0) {
          botInstance.chat(`${replyCmd} Ошибка: укажи мс > 0 или auto`);
          return false;
        }
        clickerState.manualCooldownMs = ms;
        saveFeatureState(config.username, { clicker: clickerState, meow: { enabled: meowState.enabled, cooldownMs: meowState.cooldownMs }, autoRespectEnabled });
        botInstance.chat(`${replyCmd} Тайминг удара: ${ms} мс (вручную)`);
      }
      return true;
    }
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
    // ponytail: старый живой инстанс должен закончиться до создания нового — иначе
    // сервер кикает новый ("You are already connected to this proxy!").
    if (bot) {
      isManualQuit = true;
      try { bot.quit(); } catch (e) {}
      bot = null;
      isManualQuit = false;
    }
    let self = null; // ponytail: идентичность своего инстанса — для догорающих 'end' и watchdog'а
    
    // ponytail: Watchdog таймер
    const spawnTimeout = setTimeout(() => {
        if (bot && bot === self) { // ponytail: свой подвисший инстанс убиваем только если он всё ещё текущий
            console.log('[Watchdog] Бот завис при входе. Принудительный перезапуск.');
            bot.quit();
            bot = null;
        }
    }, 60000); // 1 минута на вход

    try {
      bot = mineflayer.createBot(config);
      self = bot;
      connectToHub(bot);
      bot.physicsEnabled = false; // ponytail: отключаем физику до спавна (1.21 config phase)
      
      // ponytail: ловим абсолютно всё, что происходит с сокетом
      bot._client.on('error', (err) => console.log('[DEBUG] Socket error:', err));
      
      // ponytail: дебаг пакетов для поиска "обжоры" трафика
      let packetStats = {};
      let recentPackets = [];
      bot._client.on('packet', (data, meta, buffer) => {
          if (buffer) sessionBytes += buffer.length;
          recentPackets.push(meta.name);
          if (recentPackets.length > 20) recentPackets.shift();
          
          if (meta.name === 'disconnect') {
              console.log('[DEBUG] Последние пакеты перед киком:', recentPackets);
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
      reconnectDelayMs = 30000;
      sendToHub({ type: 'status', online: true, username: config.username });

      // ponytail: проверка состояния кликера
      if (clickerState.enabled) {
        startAutoClick(bot);
      }

      // ponytail: включаем физику через 3 секунды после спавна (1.21 config phase)
      setTimeout(() => {
        if (bot) {
          bot.physicsEnabled = true;
        }
      }, 3000);



      // ponytail: проверка и автопривязка мейн-бота к Telegram через БД
      try {
        const mainsPending = get('mains_pending', {});
        const uname = config.username.toLowerCase();
        if (mainsPending[uname]) {
          const { chatId } = mainsPending[uname];
          delete mainsPending[uname];
          set('mains_pending', mainsPending);

          const mainsApproved = get('mains_approved', {});

          let isOwnedElsewhere = false;
          for (const [ownerChatId, bots] of Object.entries(mainsApproved)) {
            if (bots.some(b => b.toLowerCase() === config.username.toLowerCase()) && ownerChatId !== chatId.toString()) {
              isOwnedElsewhere = true;
              break;
            }
          }

          if (isOwnedElsewhere) {
            console.log(`[Telegram] Мейн-бот ${config.username} уже привязан к другому Telegram аккаунту. Привязка отклонена.`);
            return;
          }

          if (!mainsApproved[chatId]) mainsApproved[chatId] = [];
          if (mainsApproved[chatId].length >= 1) {
            console.log(`[Telegram] Лимит (1 мейн-аккаунт) исчерпан для чата ${chatId}. Привязка отклонена.`);
            return;
          }

          const alreadyLinked = mainsApproved[chatId].some(b => b.toLowerCase() === config.username.toLowerCase());
          if (!alreadyLinked) {
            mainsApproved[chatId].push(config.username);
            set('mains_approved', mainsApproved);
          }

          console.log(`[Telegram] Мейн-бот ${config.username} успешно привязан к Telegram Chat ID: ${chatId}`);

          if (process.env.TG_BOT_TOKEN) {
            fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: `✅ Мейн-бот *${config.username}* успешно запущен и привязан!`,
                parse_mode: 'Markdown'
              })
            }).catch(() => {});
          }
        }
      } catch (e) {}

      // ponytail: восстановление спама из файла с задержкой 10с (после логина)
      reloadSpamTasks(10000);
      
      setTimeout(() => {
        if (bot && clickerState.enabled) startAutoClick(bot);
      }, 10000);

      // ponytail: уведомление об обновлении (если файл обновлен менее 2 минут назад)
      const updateFlag = path.join(__dirname, '.just_updated');
      if (fs.existsSync(updateFlag)) {
          try {
              const stats = fs.statSync(updateFlag);
              const fileAge = Date.now() - stats.mtimeMs;
              if (fileAge < 120000 && !bot._hasNotifiedUpdate) {
                  bot._hasNotifiedUpdate = true;
                  setTimeout(() => {
                      if (!config.isMain && bot) {
                          bot.chat(`/msg ${getMainAccount()} Я обновился!`);
                      }
                  }, 5000);
              }
          } catch(e) {}
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
            // ponytail: задержка 15 секунд между респектами
            let delay = 15000;
            getTwinks().forEach(name => { 
              if (bot && name !== bot.username) {
                setTimeout(() => bot.chat(`/msg ${name} respect`), delay);
                delay += 15000;
              }
            });
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
          sendToHub({ type: 'chat', isMain: !!config.isMain, text: message });
        }
      }
    });

    bot.on('end', (reason) => {
      if (bot !== null && self !== bot) return; // ponytail: 'end' от устаревшего инстанса — новый уже живёт
      stopAutoClick();
      // ponytail: принудительно убиваем сокет, чтобы сервер не держал соединение
      if (bot && bot._client) {
          try { bot._client.end(); } catch (e) {}
      }
      clearTimeout(spawnTimeout);
      if (bot) {
          sendToHub({ type: 'status', online: false, username: bot.username || config.username });
      }
      bot = null;
      console.log(`[Система] Соединение закрыто. Причина: ${reason}`);
      if (!isManualQuit) {
        console.log(`[Система] Запуск реконнекта через ${reconnectDelayMs / 1000} сек...`);
        setTimeout(() => { if (!bot) { try { createBotInstance(); } catch (e) {} } }, reconnectDelayMs);
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, 240000);
      }
    });

    bot.on('message', (jsonMsg) => {
      const text = jsonMsg.toString();
      if (!text.trim()) return;

      console.log(`[Debug] Raw message: ${text}`);
      if (text.includes(' › ')) {
        const parts = text.split(' › ');
        checkMeow(bot, parts.slice(1).join(' › '), parts[0].trim());
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

module.exports = { startBot, stopAutoClick, getAutoClickTimer: () => autoClickTimer };
