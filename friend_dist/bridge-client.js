const { get, set } = require('./db.js');
require('dotenv').config();

const bridgeUrl = process.env.SERVER_URL || process.env.BRIDGE_URL || 'http://localhost:8088';
const token = process.env.BRIDGE_TOKEN;
const botName = process.env.USERNAME;

if (!token || !botName) {
  console.log('[Bridge Client] Ошибка: не задан BRIDGE_TOKEN или USERNAME в .env');
  process.exit(1);
}

console.log(`[Bridge Client] Запущен для бота ${botName}, подключение к ${bridgeUrl}`);

setInterval(async () => {
  try {
    const url = `${bridgeUrl}?token=${encodeURIComponent(token)}&bot=${encodeURIComponent(botName)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const reqs = await res.json();
    if (Array.isArray(reqs) && reqs.length > 0) {
      const currentReqs = get('bot_requests', []);
      const merged = [...currentReqs, ...reqs];
      set('bot_requests', merged);
      console.log(`[Bridge Client] Получено новых запросов от хаба: ${reqs.length}`);
    }
  } catch (e) {
    // Тихо игнорируем сетевые ошибки при недоступности хаба
  }
}, 2000);
