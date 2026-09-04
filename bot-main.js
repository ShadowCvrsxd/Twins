// ponytail: используем базу из bot-base.js, чтобы не дублировать код обходов
const { startBot } = require('./bot-base.js');
const path = require('path');

// ponytail: старт через общую функцию старта
startBot(path.join(__dirname, '.env.main'), {
    username: process.env.MAIN_USERNAME || 'MainAccount',
    isMain: true, // ponytail: помечаем явно, чтобы не слал уведомления об обновлениях сам себе
    tablist: true, // Включаем, так как обходы в bot-base зависят от него
    // ... любые специфичные оверрайды
});
