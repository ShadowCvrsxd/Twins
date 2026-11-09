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

let warnedTw = false; // ponytail: warn-once per process
function getTwinks() {
  const v = process.env.TWINKS;
  if (!v) {
    if (!warnedTw) console.error('[Config] TWINKS env не задан — список твинов пуст');
    warnedTw = true;
    return [];
  }
  return v.split(',').map(s => s.trim()).filter(Boolean);
}
let warnedMain = false; // ponytail: warn-once per process
function getMainAccount() {
  const v = process.env.MAIN_ACCOUNT;
  if (!v) {
    if (!warnedMain) console.error('[Config] MAIN_ACCOUNT env не задан — мейн-флоу отключен');
    warnedMain = true;
  }
  return v;
}
// ponytail: pure KV merge, no write when unchanged — one read+set per private-chat message
function mergeTgUser(store, chatId, from, chatType) {
  if (chatType !== 'private' || !from || from.is_bot === true) return null;
  if (!Number.isInteger(from.id) || from.id <= 0) return null;
  const entry = { id: from.id, username: from.username || null, firstName: from.first_name || null };
  const prev = store && store[chatId];
  if (prev && prev.id === entry.id && prev.username === entry.username && prev.firstName === entry.firstName) return null;
  return { ...store, [chatId]: entry };
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
    const streamAll = get('main_chat_stream_all', {});
    const approved = get('links_approved', {});
    const mainsApproved = get('mains_approved', {});
    const mainNick = (getMainAccount() || '').toLowerCase();
    const cleanedText = cleanMinecraftText(text);
    if (!cleanedText) return;

    const cleanedLower = cleanedText.toLowerCase();
    // Извлекаем отправителя: токен перед '›' в формате '<префикс> |  Nick › текст'
    const senderMatch = cleanedLower.match(/(?:^|\|)\s*([^\s›|]+)\s*›/);
    const sender = senderMatch ? senderMatch[1] : '';
    const isTwinMsg = sender && getTwinks().some(t => t.toLowerCase() === sender);

    const token = process.env.TG_CHAT_BOT_TOKEN || process.env.TG_BOT_TOKEN;
    if (!token) return;

    const allApproved = { ...approved };
    for (const [chatId, mains] of Object.entries(mainsApproved)) {
      if (!allApproved[chatId]) allApproved[chatId] = [];
      allApproved[chatId].push(...mains);
    }

    for (const [chatId, bots] of Object.entries(allApproved)) {
      if (!streaming[chatId]) continue;
      if (!streamAll[chatId]) {
        const isMention = cleanedLower.includes(mainNick);
        if (!isMention || isTwinMsg) continue;
      }

      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `💬 [мейн] ${cleanedText}`
        })
      }).catch(() => {});
    }
  } catch(e){}
}

function escapeTelegramHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const failoverState = new Map();

function relayChatToTelegram({ ownerId, botName, text, isMain }, deps) {
  const { get, set, sendChatMessage, getBotDisplayName, cleanMinecraftText, getMainAccount, getTwinks } = deps;
  try {
    const cleanedText = cleanMinecraftText(text);
    if (!cleanedText) return;

    if (isMain) {
      const streaming = get('main_chat_streaming', {});
      const streamAll = get('main_chat_stream_all', {});
      const approved = get('links_approved', {});
      const mainsApproved = get('mains_approved', {});
      const botsStatus = get('bots_status', {}) || {};
      const twinStreaming = get('chat_streaming', {}) || {};
      const mainNick = (getMainAccount() || '').toLowerCase();
      const cleanedLower = cleanedText.toLowerCase();
      const senderMatch = cleanedLower.match(/(?:^|\|)\s*([^\s›|]+)\s*›/);
      const sender = senderMatch ? senderMatch[1] : '';
      const tgUsers = get('tg_users', {}) || {};
      const dmSenderMatch = cleanedLower.match(/^✉️\s*\|\s*([^\s›|]+)\s*›/);
      const dmSender = dmSenderMatch ? dmSenderMatch[1] : '';
      const isIncomingDm = cleanedText.startsWith('✉️') && !!dmSender && dmSender !== mainNick;

      const allApproved = { ...approved };
      for (const [chatId, mains] of Object.entries(mainsApproved)) {
        if (!allApproved[chatId]) allApproved[chatId] = [];
        allApproved[chatId].push(...mains);
      }
      for (const [chatId, bots] of Object.entries(allApproved)) {
        if (!streaming[chatId]) continue;
        if (!streamAll[chatId]) {
          const isMention = cleanedLower.includes(mainNick);
          if (!isMention) continue;
        }
        const approvedTwins = (approved[chatId] || []).map(b => String(b).toLowerCase());
        const senderIsTwin = !!sender && sender !== mainNick && approvedTwins.includes(sender);
        const twinCopyDelivered = senderIsTwin && (!!(twinStreaming[chatId] && twinStreaming[chatId][sender]) || Object.keys(twinStreaming[chatId] || {}).some(k => twinStreaming[chatId][k] && k !== sender && !(botsStatus[k] && botsStatus[k].online)));
        if (twinCopyDelivered) continue;
        let mention = '';
        let parseMode = null;
        let textPart = cleanedText;
        if (isIncomingDm) {
          const u = tgUsers[chatId];
          if (u && u.username) {
            mention = '@' + u.username;
          } else if (u && u.id) {
            mention = '<a href="tg://user?id=' + u.id + '">' + escapeTelegramHtml(u.firstName || 'владелец') + '</a>';
            parseMode = 'HTML';
            textPart = escapeTelegramHtml(cleanedText);
          } else if (Number(chatId) > 0) {
            mention = '<a href="tg://user?id=' + Number(chatId) + '">' + escapeTelegramHtml('владелец') + '</a>';
            parseMode = 'HTML';
            textPart = escapeTelegramHtml(cleanedText);
          }
        }
        const composed = '💬 [мейн] ' + (mention ? mention + ' ' : '') + textPart;
        sendChatMessage(chatId, composed, parseMode);
      }
      return;
    }

    const mainNick = (getMainAccount() || '').toLowerCase();
    const senderMatch = cleanedText.toLowerCase().match(/(?:^|\|)\s*([^\s›|]+)\s*›/);
    const sender = senderMatch ? senderMatch[1] : '';
    const mainStreaming = get('main_chat_streaming', {}) || {};
    const mainStreamAll = get('main_chat_stream_all', {}) || {};
    const mainCopyDelivered = !!sender && sender === mainNick && !!mainStreaming[ownerId] && (!!mainStreamAll[ownerId] || cleanedText.toLowerCase().includes(mainNick));
    if (mainCopyDelivered) return;

    const streaming = get('chat_streaming', {});
    const userStream = streaming[ownerId] || {};
    const botKey = botName.toLowerCase();
    let failoverFrom = null;
    let allow = !!userStream[botKey];
    if (!allow) {
      const enabled = Object.keys(userStream).filter(k => userStream[k]);
      if (enabled.length > 0) {
        const statuses = get('bots_status', {}) || {};
        const approved = (get('links_approved', {}) || {})[ownerId] || [];
        const senderApproved = approved.some(b => String(b).toLowerCase() === botKey);
        const offlineTwin = enabled.find(k => k !== botKey && (!statuses[k] || !statuses[k].online));
        if (senderApproved && offlineTwin) {
          allow = true;
          failoverFrom = offlineTwin;
        }
      }
    }
    if (!allow) {
      return;
    }
    const prevFailover = failoverState.get(ownerId);
    if (failoverFrom && prevFailover !== failoverFrom) {
      console.log(`[Chat] failover: дупликация переключена ${failoverFrom} → ${botName}`);
    } else if (!failoverFrom && prevFailover) {
      console.log(`[Chat] failover: дупликация вернулась на ${botName}`);
    }
    failoverState.set(ownerId, failoverFrom);
    const displayName = getBotDisplayName(ownerId, botName);
    const prefix = displayName ? `[${displayName}] ` : '';
    sendChatMessage(ownerId, `💬 ${prefix}${cleanedText}`);
  } catch (e) {}
}

function updateTraffic(username, bytes) {
    const stats = get('traffic_stats', {});
    stats[username] = (stats[username] || 0) + bytes;
    set('traffic_stats', stats);
}

function getTraffic() {
    return get('traffic_stats', {});
}

function shouldSend(socket) {
  return !!(socket && socket.readyState === 1);
}

function forwardResponse(message, socket, deps) {
  const { sendMessage } = deps;
  const chatId = message.chatId || (socket && socket.ownerId);
  const text = message.text || message.msg;
  if (!chatId || !text) return false;
  sendMessage(chatId, text, message.parseMode || null);
  return true;
}

function applyBotStatus(message, socket, deps) {
  const { get, set } = deps;
  const botName = (socket && socket.botName) || message.botName;
  const statuses = get('bots_status', {});
  statuses[botName] = {
    online: !!message.online,
    onlineSince: message.online ? Date.now() : null,
    username: message.username || botName
  };
  set('bots_status', statuses);
}

function formatDropResult(username, items) {
  if (items.length === 0) return `🧹 Инвентарь ${username} пуст.`;
  return `🧹 ${username}: выброшено ${items.length} стаков\n${items.map(i => `${i.name}×${i.count}`).join(', ')}`;
}

module.exports = { getTwinks, getMainAccount, getBotDisplayName, cleanMinecraftText, mergeTgUser, RESPECT_COOLDOWN, parseCooldown, sendResourcePackAck, dropAll, formatDropResult, updateTraffic, getTraffic, updateBotStatus, sendTelegramNotification, sendMainTelegramNotification, relayChatToTelegram, shouldSend, forwardResponse, applyBotStatus };
