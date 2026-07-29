const mineflayer = require('mineflayer');
const readline = require('readline');
const fs = require('fs');
const { TWINKS, MAIN_ACCOUNT, RESPECT_COOLDOWN, parseCooldown, sendResourcePackAck, dropAll } = require('./utils.js');

function startBot(envPath, configOverrides) {
  require('dotenv').config({ path: envPath });
  
  const config = {
    host: '5.83.140.251',
    port: 25809,
    username: process.env.USERNAME,
    version: '1.21.1',
    brand: 'vanilla',
    viewDistance: 'tiny', // ponytail: минимум чанков
    loadInternalChunks: false, // ponytail: не качаем мир
    ...configOverrides
  };

  const PASSWORD = process.env.PASSWORD;

  let bot;
  let antiAfkInterval;
  let spamInterval = null;
  let isManualQuit = false;
  let schedulerInterval;
  let lastRespectTime = 0;
  let isRespectFailed = false;

  const RESOURCE_PACK_RESPONSE_NAMES = ['resource_pack_receive', 'resource_pack_response', 'resource_pack_status'];
  const RESULT_SUCCESS = 0;

  function handleCommand(botInstance, input) {
    const parts = input.split(' ');
    const command = parts[0].toLowerCase();

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
      if (spamInterval) { 
        clearInterval(spamInterval); 
        spamInterval = null; 
        console.log(`[Команда] Успешно выполнено: ${command}`);
        return true;
      }
      console.log(`[Команда] Ошибка выполнения ${command}: спам не запущен`);
      return false;
    }
    if (command === 'spam') {
      const delay = parseInt(parts[1]) * 1000;
      const msg = parts.slice(2).join(' ');
      if (isNaN(delay) || delay <= 0) {
        console.log(`[Команда] Ошибка выполнения ${command}: неверные аргументы`);
        return false;
      }
      if (spamInterval) clearInterval(spamInterval);
      spamInterval = setInterval(() => botInstance.chat(msg), delay);
      console.log(`[Команда] Успешно выполнено: ${command} с задержкой ${parts[1]}с`);
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
    bot = mineflayer.createBot(config);

    if (!schedulerInterval) {
      schedulerInterval = setInterval(() => {
        const now = new Date();
        const mskTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (3600000 * 3));
        const h = mskTime.getHours();
        const m = mskTime.getMinutes();
        if (h === 11 && m === 58 && bot) { isManualQuit = true; bot.quit(); }
        else if (h === 12 && m === 10 && !bot) { isManualQuit = false; createBotInstance(); }
      }, 30000);
    }

    bot._client.on('add_resource_pack', (packet) => {
        setTimeout(() => {
            sendResourcePackAck(bot._client, packet.uuid, RESOURCE_PACK_RESPONSE_NAMES, RESULT_SUCCESS);
        }, 1000);
    });

    bot.on('spawn', () => {
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
      if (spamInterval) { clearInterval(spamInterval); spamInterval = null; }
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
