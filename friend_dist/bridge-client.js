require('dotenv').config();
const { exec } = require('child_process');
const fetch = require('node-fetch');
const { set } = require('./db.js');

const bridgeUrl = process.env.SERVER_URL || process.env.BRIDGE_URL || 'http://localhost:8088';
const token = process.env.BRIDGE_TOKEN;
const botName = process.env.USERNAME;

if (!token || !botName) {
  console.log('[Bridge Client] Ошибка: не задан BRIDGE_TOKEN или USERNAME в .env');
  process.exit(1);
}

console.log(`[Bridge Client] Запущен для бота ${botName}, подключение к ${bridgeUrl}`);

let botProcess = null;

setInterval(async () => {
    try {
        const url = `${bridgeUrl}/bridge?token=${encodeURIComponent(token)}&bot=${encodeURIComponent(botName)}`;
        console.log('--- Опрос сервера...');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return;
        const reqs = await res.json();
        
        if (Array.isArray(reqs) && reqs.length > 0) {
            set('bot_requests', reqs);
            
            if (!botProcess) {
                console.log(`[Bridge] Запуск бота ${botName}...`);
                botProcess = exec('node bot-base.js');
                botProcess.stdout.pipe(process.stdout);
                botProcess.stderr.pipe(process.stderr);
                botProcess.on('close', () => {
                    console.log('[Bridge] Бот остановлен.');
                    botProcess = null;
                });
            }
        }
    } catch (e) { 
        if (e.name === 'AbortError') {
            console.log('[Bridge] Запрос отменен по таймауту');
        } else {
            console.error('[Bridge Error]', e.message); 
        }
    }
}, 3000);
