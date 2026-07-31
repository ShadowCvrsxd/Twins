
const TWINKS = process.env.TWINKS ? process.env.TWINKS.split(',') : ['AlexZTI_Twin', 'AlexZTI_Twin1'];
const MAIN_ACCOUNT = process.env.MAIN_ACCOUNT || 'AlexZTI_';
const RESPECT_COOLDOWN = 60 * 60 * 1000;

function parseCooldown(msg) {
  const match = msg.match(/через (\d+) minutes/);
  if (match) return parseInt(match[1]) * 60 * 1000;
  return RESPECT_COOLDOWN;
}

function sendResourcePackAck(client, uuid, RESOURCE_PACK_RESPONSE_NAMES, RESULT_SUCCESS) {
  for (const name of RESOURCE_PACK_RESPONSE_NAMES) {
    try {
      client.write(name, { uuid, result: RESULT_SUCCESS });
      return true;
    } catch (e) {}
  }
  return false;
}

const fs = require('fs');
const STATS_FILE = 'traffic_stats.json';

function updateTraffic(username, bytes) {
    let stats = {};
    if (fs.existsSync(STATS_FILE)) {
        try {
            stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
        } catch (e) { stats = {}; }
    }
    stats[username] = (stats[username] || 0) + bytes;
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats));
}

function getTraffic() {
    if (!fs.existsSync(STATS_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    } catch (e) { return {}; }
}

module.exports = { TWINKS, MAIN_ACCOUNT, RESPECT_COOLDOWN, parseCooldown, sendResourcePackAck, dropAll, updateTraffic, getTraffic };

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
