
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
  const match = msg.match(/(\d+)\s*(?:minutes|минут|мин)/i);
  if (match) return parseInt(match[1]) * 60 * 1000;
  return RESPECT_COOLDOWN;
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

function updateBotStatus(username, online) {
  if (!username) return;
  let statuses = {};
  try { statuses = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')) || {}; } catch(e){}
  statuses[username.toLowerCase()] = {
    online,
    onlineSince: online ? Date.now() : null,
    username
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(statuses, null, 2));
}

const STREAMING_FILE = path.join(__dirname, 'chat_streaming.json');

function cleanMinecraftText(text) {
  if (!text) return '';
  return text
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(//g, '')
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

    const token = process.env.TG_CHAT_BOT_TOKEN || process.env.TG_BOT_TOKEN;
    if (token) {
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: `💬 *[${username}]* ${cleanedText}`,
          parse_mode: 'Markdown'
        })
      }).catch(() => {});
    }
  } catch(e){}
}

function updateTraffic(username, bytes) {
    let stats = {};
    try { stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) || {}; } catch (e) {}
    stats[username] = (stats[username] || 0) + bytes;
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats));
}

function getTraffic() {
    if (!fs.existsSync(STATS_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    } catch (e) { return {}; }
}

module.exports = { getTwinks, getMainAccount, RESPECT_COOLDOWN, parseCooldown, sendResourcePackAck, dropAll, updateTraffic, getTraffic, updateBotStatus, sendTelegramNotification };
