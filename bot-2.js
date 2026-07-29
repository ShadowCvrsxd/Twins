const mineflayer = require('mineflayer');
const readline = require('readline');
const fs = require('fs');
require('dotenv').config({ path: '.env.twin2' });
const { TWINKS, RESPECT_COOLDOWN, parseCooldown, sendResourcePackAck, dropAll } = require('./utils.js');

const config = {
  host: '5.83.140.251',
  port: 25809,
  username: process.env.USERNAME,
  version: '1.21.1',
  brand: 'vanilla'
};

const PASSWORD = process.env.PASSWORD;
const MAIN_ACCOUNT = 'AlexZTI_'; // Ваш основной аккаунт

let bot;
let antiAfkInterval;
let spamInterval = null;
let isManualQuit = false; // флаг для ручного отключения
let schedulerInterval;
let lastRespectTime = 0;
let isRespectFailed = false; // Флаг ошибки респекта

function handleCommand(botInstance, input) {
  const parts = input.split(' ');
  const command = parts[0].toLowerCase();

  if (command === 'dropall') {
    dropAll(botInstance);
    return true;
  }
  if (command === 'stopspam') {
    if (spamInterval) { clearInterval(spamInterval); spamInterval = null; }
    return true;
  }
  if (command === 'spam') {
    const delay = parseInt(parts[1]) * 1000;
    const msg = parts.slice(2).join(' ');
    if (isNaN(delay) || delay <= 0) return false;
    if (spamInterval) clearInterval(spamInterval);
    spamInterval = setInterval(() => botInstance.chat(msg), delay);
    return true;
  }
  
  // ponytail: любой другой текст просто пишем в чат
  botInstance.chat(input);
  return true;
}

const RESOURCE_PACK_RESPONSE_NAMES = [
  'resource_pack_receive',
  'resource_pack_response',
  'resource_pack_status'
];
const RESULT_SUCCESS = 0;

function createBotInstance() {
  console.log(`[Система] Логинюсь под версией ${config.version}...`);
  bot = mineflayer.createBot(config);

  // Функции помощники
  function tryRespect(username = MAIN_ACCOUNT, isAuto = false) {
    const now = Date.now();
    isRespectFailed = false; // сбрасываем флаг перед попыткой

    if (now - lastRespectTime < RESPECT_COOLDOWN) {
      if (!isAuto) {
        const remaining = Math.ceil((RESPECT_COOLDOWN - (now - lastRespectTime)) / 1000 / 60);
        // ponytail: используем /r вместо /msg, чтобы не указывать ник
        bot.chat(`/r КД на респект: ${remaining} мин.`);
        console.log(`[Чат] Отказано в респекте: КД ${remaining} мин.`);
      }
    } else {
      try {
        bot.chat(`/respect ${username}`);
        // Ждем 3 сек, чтобы увидеть ответ сервера
        setTimeout(() => {
          if (bot && !isRespectFailed) {
            bot.chat(`!успешно выдан респект игроку:${username}`);
            lastRespectTime = Date.now();
            
            // ponytail: рассылаем другим ТОЛЬКО если успех
            TWINKS.forEach(name => {
              if (bot && name !== bot.username) {
                bot.chat(`/msg ${name} respect`);
              }
            });
          }
        }, 3000); 
      } catch (err) {
        bot.chat(`/msg ${MAIN_ACCOUNT} Ошибка при авто-респекте: ${err.message}`);
      }
    }
  }

  // ponytail: проверка времени по МСК (UTC+3)
  if (!schedulerInterval) {
    schedulerInterval = setInterval(() => {
      const now = new Date();
      const mskTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (3600000 * 3));
      const h = mskTime.getHours();
      const m = mskTime.getMinutes();

      if (h === 11 && m === 58 && bot) {
        console.log('[Scheduler] Время отключения (11:58 МСК)');
        isManualQuit = true;
        bot.quit();
      } else if (h === 12 && m === 10 && !bot) {
        console.log('[Scheduler] Время подключения (12:10 МСК)');
        isManualQuit = false;
        createBotInstance();
      }
    }, 30000);
  }

  // ponytail: hook напрямую в bot._client, чтобы перехватить всё
  const originalWrite = bot._client.write;
  bot._client.write = function(name, params) {
    if (!bot || !bot._client) return originalWrite.call(bot._client, name, params);
    if (bot._client.state === 'configuration' && (name === 'position' || name === 'flying' || name === 'look' || name === 'teleport_confirm' || name === 'accept_teleportation')) {
        return;
    }
    return originalWrite.call(bot._client, name, params);
  };

  bot._client.on('state', (state) => {
    console.log(`[State Change] ${state}`);
    if (state === 'configuration') {
        setTimeout(() => {
          if (bot._client.state === 'configuration') {
            try {
              originalWrite.call(bot._client, 'finish_configuration', {});
            } catch(e) {}
          }
        }, 1000);
    }
  });

  bot._client.on('add_resource_pack', (packet) => {
    console.log('[Ресурспак] Обход конфигурации...');
    sendResourcePackAck(bot._client, packet.uuid, RESOURCE_PACK_RESPONSE_NAMES, RESULT_SUCCESS);
  });

  bot.on('login', () => {
    console.log('[Успех] Прокси пройдена. Вход в лобби...');
  });

  bot.on('spawn', () => {
    console.log(`[МЕГА УСПЕХ] Бот ${bot.username} заспавнился! Стою АФК на ферме.`);

    clearInterval(antiAfkInterval);
    antiAfkInterval = setInterval(() => {
      if (!bot || !bot.entity) return; // не мешаем анти-афк во время движения
      const yaw = bot.entity.yaw + 0.1;
      bot.look(yaw, bot.entity.pitch, true);
    }, 25000);
  });

  bot.on('messagestr', (message) => {
    const msg = message.toLowerCase();
    
    // Авто-логин
    if (msg.includes('/login') || msg.includes('введите /login') || msg.includes('авторизуйтесь')) {
      console.log('[Авто-Логин] Отправляю пароль...');
      bot.chat(`/login ${PASSWORD}`);
    } else if (msg.includes('/register') || msg.includes('зарегистрируйтесь')) {
      console.log('[Авто-Логин] Регистрируюсь...');
      bot.chat(`/register ${PASSWORD} ${PASSWORD}`);
    } 
    // Если сервер пишет про КД, обновляем время
    else if ((msg.includes('через') && msg.includes('minutes')) || msg.includes('вы сможете отправить следующий')) {
        lastRespectTime = Date.now() - (RESPECT_COOLDOWN - parseCooldown(msg));
        isRespectFailed = true;
    }
  });

  bot.on('kicked', (reason) => {
    let cleanReason = reason;
    try {
      const parsed = typeof reason === 'string' ? JSON.parse(reason) : reason;
      if (parsed.text) cleanReason = parsed.text;
      else if (parsed.extra) cleanReason = parsed.extra.map(e => e.text).join('');
      else cleanReason = JSON.stringify(parsed);
    } catch (e) {}
    console.log(`[Кик] Причина: ${cleanReason}`);
  });

  bot.on('end', (reason) => {
    clearInterval(antiAfkInterval);
    if (spamInterval) { clearInterval(spamInterval); spamInterval = null; }
    if (schedulerInterval) { clearInterval(schedulerInterval); }
    isMoving = false;
    bot = null; // сброс ссылки
    console.log(`[Внимание] Соединение закрыто (${reason}).`);
    if (!isManualQuit) {
      console.log('Реконнект через 30 сек...');
      setTimeout(() => {
        try {
          createBotInstance();
        } catch (e) {
          console.log('[Ошибка] Реконнект не удался:', e.message);
        }
      }, 30000);
    }
  });

  bot.on('error', (err) => {
    console.log(`[Ошибка] Сетевой сбой: ${err.message}`);
  });

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString();
    if (!text.trim()) return;
    console.log(`[Чат] ${text}`);

    if (text.includes(' › ')) {
      const parts = text.split(' › ');
      if (parts.length >= 3) {
        const senderFull = parts[0].trim();
        const receiver = parts[1].trim();
        const content = parts[2].trim();

        if (receiver === bot.username) {
          const isFromMain = senderFull.includes(MAIN_ACCOUNT);
          const isFromTwin = TWINKS.some(t => senderFull.includes(t));

          if (content.toLowerCase().includes('respect')) {
            if (isFromMain || isFromTwin) tryRespect();
          } else if (isFromMain) {
            handleCommand(bot, content);
          }
        }
      }
    }
  });
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.on('line', (line) => {
    const input = line.trim().toLowerCase();
  
    if (input === 'disconnect') {
      if (!bot) { console.log('[Терминал] Бот не подключен.'); return; }
      isManualQuit = true;
      bot.quit();
      console.log('[Терминал] Отключаюсь...');
      return;
    }
  
    if (input === 'connect') {
      isManualQuit = false;
      createBotInstance();
      console.log('[Терминал] Подключаюсь...');
      return;
    }
  
    if (!bot) {
      console.log('[Терминал] Бот ещё не создан.');
      return;
    }

    if (handleCommand(bot, input)) {
        console.log(`[Терминал] Команда выполнена: "${input}"`);
        return;
    }
  
    console.log(`[Терминал] Неизвестная команда: "${input}"`);
  });

process.on('uncaughtException', (err) => {
  console.log(`[Пакетный лог]: ${err.message}`);
});

createBotInstance();
