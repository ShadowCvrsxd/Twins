// ponytail: используем базу из bot-base.js, чтобы не дублировать код обходов
const { startBot } = require('./bot-base.js');
const path = require('path');
const fs = require('fs');

// ponytail: принудительно загружаем .env.main перед запуском
const envMainPath = path.join(__dirname, '.env.main');
if (fs.existsSync(envMainPath)) {
    require('dotenv').config({ path: envMainPath, override: true });
}

// ponytail: старт через общую функцию старта
startBot(envMainPath, {
    username: process.env.USERNAME,
    isMain: true, // ponytail: помечаем явно, чтобы не слал уведомления об обновлениях сам себе
    tablist: true, // Включаем, так как обходы в bot-base зависят от него
    // ... любые специфичные оверрайды
}, { autoConnect: false });
