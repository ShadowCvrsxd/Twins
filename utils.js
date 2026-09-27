const { get, set } = require('./db.js');

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

function updateBotStatus(username, online) {
  if (!username) return;
  const statuses = get('bots_status', {});
  statuses[username.toLowerCase()] = {
    online,
    onlineSince: online ? Date.now() : null,
    username
  };
  set('bots_status', statuses);
}

function getBotDisplayName(chatId, username) {
  let mode = 'alias';
  const modes = get('chat_display_mode', {});
  if (modes[chatId]) mode = modes[chatId];

  const aliases = get('bot_aliases', {});
  const userAliases = aliases[chatId] || {};
  
  let customAlias = null;
  for (const [al, realName] of Object.entries(userAliases)) {
    if (realName.toLowerCase() === username.toLowerCase()) {
      customAlias = al;
      break;
    }
  }

  const approved = get('links_approved', {});
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
    const approved = get('links_approved', {});
    let targetChatId = null;
    for (const [chatId, bots] of Object.entries(approved)) {
      if (bots.some(b => b.toLowerCase() === username.toLowerCase())) {
        targetChatId = chatId;
        break;
      }
    }
    if (!targetChatId) return;

    const streaming = get('chat_streaming', {});
    const userStream = streaming[targetChatId];
    if (!userStream || !userStream[username.toLowerCase()]) {
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

function sendMainTelegramNotification(text) {
  try {
    const streaming = get('main_chat_streaming', {});
    const approved = get('links_approved', {});
    const mainNick = getMainAccount().toLowerCase();
    const cleanedText = cleanMinecraftText(text);
    if (!cleanedText) return;
    if (!cleanedText.toLowerCase().includes(mainNick)) return;

    const token = process.env.TG_CHAT_BOT_TOKEN || process.env.TG_BOT_TOKEN;
    if (!token) return;

    for (const [chatId, bots] of Object.entries(approved)) {
      if (streaming[chatId]) {
        fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `💬 [мейн] ${cleanedText}`
          })
        }).catch(() => {});
      }
    }
  } catch(e){}
}

function updateTraffic(username, bytes) {
    const stats = get('traffic_stats', {});
    stats[username] = (stats[username] || 0) + bytes;
    set('traffic_stats', stats);
}

function getTraffic() {
    return get('traffic_stats', {});
}

module.exports = { getTwinks, getMainAccount, RESPECT_COOLDOWN, parseCooldown, sendResourcePackAck, dropAll, updateTraffic, getTraffic, updateBotStatus, sendTelegramNotification, sendMainTelegramNotification };
