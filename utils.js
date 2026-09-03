
async function dropAll(bot) {
  const items = bot.inventory.items();
  if (items.length === 0) return;
  for (const item of items) {
    try {
      await bot.tossStack(item);
    } catch (err) {
      console.log(`[Ошибка] Не удалось выбросить ${item.name}: ${err.message}`);
    }
  }
}

function getTwinks() {
  return process.env.TWINKS ? process.env.TWINKS.split(',') : ['AlexZTI_Twin', 'AlexZTI_Twin1'];
}
function getMainAccount() {
  return process.env.MAIN_ACCOUNT || 'AlexZTI_';
}
const RESPECT_COOLDOWN = 60 * 60 * 1000;

function parseCooldown(msg) {
  const minMatch = msg.match(/(\d+)\s*(?:minutes|минут|мин)/i);
  const secMatch = msg.match(/(\d+(?:\.\d+)?)\s*(?:seconds|секунд|сек)/i);
  let totalMs = 0;
  if (minMatch) totalMs += parseInt(minMatch[1]) * 60 * 1000;
  if (secMatch) totalMs += Math.ceil(parseFloat(secMatch[1])) * 1000;
  return totalMs > 0 ? totalMs : RESPECT_COOLDOWN;
}

function sendResourcePackAck(client, uuid, RESOURCE_PACK_RESPONSE_NAMES, RESULT_SUCCESS) {
  return RESOURCE_PACK_RESPONSE_NAMES.some(name => {
    try { client.write(name, { uuid, result: RESULT_SUCCESS }); return true; } catch (e) { return false; }
  });
}

const fs = require('fs');
const path = require('path');
const STATS_FILE = 'traffic_stats.json';
const STATUS_FILE = path.join(__dirname, 'bots_status.json');
const APPROVED_FILE = path.join(__dirname, 'links_approved.json');

function writeJSONAtomic(file, data) {
  const tempFile = file + '.' + Math.random().toString(36).substring(2) + '.tmp';
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, file);
  } catch (e) {
    try { fs.unlinkSync(tempFile); } catch(err){}
  }
}

function updateBotStatus(username, online) {
  if (!username) return;
  let statuses = {};
  try { statuses = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')) || {}; } catch(e){}
  statuses[username.toLowerCase()] = {
    online,
    onlineSince: online ? Date.now() : null,
    username
  };
  writeJSONAtomic(STATUS_FILE, statuses);
}

const STREAMING_FILE = path.join(__dirname, 'chat_streaming.json');
const ALIASES_FILE = path.join(__dirname, 'bot_aliases.json');
const DISPLAY_MODE_FILE = path.join(__dirname, 'chat_display_mode.json');

function getBotDisplayName(chatId, username) {
  let mode = 'alias';
  if (fs.existsSync(DISPLAY_MODE_FILE)) {
    try {
      const modes = JSON.parse(fs.readFileSync(DISPLAY_MODE_FILE, 'utf8')) || {};
      if (modes[chatId]) mode = modes[chatId];
    } catch(e){}
  }

  const aliases = fs.existsSync(ALIASES_FILE) ? JSON.parse(fs.readFileSync(ALIASES_FILE, 'utf8')) || {} : {};
  const userAliases = aliases[chatId] || {};
  
  let customAlias = null;
  for (const [al, realName] of Object.entries(userAliases)) {
    if (realName.toLowerCase() === username.toLowerCase()) {
      customAlias = al;
      break;
    }
  }

  const approved = fs.existsSync(APPROVED_FILE) ? JSON.parse(fs.readFileSync(APPROVED_FILE, 'utf8')) || {} : {};
  const userBots = approved[chatId] || [];
  const index = userBots.findIndex(b => b.toLowerCase() === username.toLowerCase());
  const systemAlias = index !== -1 ? `bot${index + 1}` : null;

  const primaryAlias = customAlias || systemAlias;

  if (mode === 'hidden') return '';
  if (mode === 'nick') return username;
  if (mode === 'both') {
    return primaryAlias ? `${primaryAlias} / ${username}` : username;
  }
  
  return primaryAlias || username;
}

function cleanMinecraftText(text) {
  if (!text) return '';
  return text
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\ufffd/g, '')
    .trim();
}

function sendTelegramNotification(username, text) {
  try {
    if (!fs.existsSync(APPROVED_FILE)) return;
    const approved = JSON.parse(fs.readFileSync(APPROVED_FILE, 'utf8')) || {};
    let targetChatId = null;
    for (const [chatId, bots] of Object.entries(approved)) {
      if (bots.some(b => b.toLowerCase() === username.toLowerCase())) {
        targetChatId = chatId;
        break;
      }
    }
    if (!targetChatId) return;

    if (fs.existsSync(STREAMING_FILE)) {
      const streaming = JSON.parse(fs.readFileSync(STREAMING_FILE, 'utf8')) || {};
      const userStream = streaming[targetChatId];
      if (!userStream || !userStream[username.toLowerCase()]) {
        return;
      }
    } else {
      return;
    }

    const cleanedText = cleanMinecraftText(text);
    if (!cleanedText) return;

    const displayName = getBotDisplayName(targetChatId, username);
    const prefix = displayName ? `[${displayName}] ` : '';
    const token = process.env.TG_CHAT_BOT_TOKEN || process.env.TG_BOT_TOKEN;
    if (token) {
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: `💬 ${prefix}${cleanedText}`
        })
      }).catch(() => {});
    }
  } catch(e){}
}

function updateTraffic(username, bytes) {
    let stats = {};
    try { stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) || {}; } catch (e) {}
    stats[username] = (stats[username] || 0) + bytes;
    writeJSONAtomic(STATS_FILE, stats);
}

function getTraffic() {
    if (!fs.existsSync(STATS_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    } catch (e) { return {}; }
}

module.exports = { getTwinks, getMainAccount, RESPECT_COOLDOWN, parseCooldown, sendResourcePackAck, dropAll, updateTraffic, getTraffic, updateBotStatus, sendTelegramNotification };
