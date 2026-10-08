require('dotenv').config();
const { exec } = require('child_process');
const http = require('http'); // Используем встроенный модуль
const { set } = require('./db.js');

const bridgeUrl = process.env.SERVER_URL || process.env.BRIDGE_URL || 'http://localhost:8088';
const url = new URL(bridgeUrl);
const token = process.env.BRIDGE_TOKEN;
const botName = process.env.USERNAME;

if (!token || !botName) {
  console.log('[Bridge Client] Ошибка: не задан BRIDGE_TOKEN или USERNAME в .env');
  process.exit(1);
}

let botProcess = null;

function poll() {
    console.log('--- Опрос сервера...');
    const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: `/bridge?token=${encodeURIComponent(token)}&bot=${encodeURIComponent(botName)}`,
        method: 'GET'
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            try {
                const reqs = JSON.parse(data);
                if (Array.isArray(reqs) && reqs.length > 0) {
                    set('bot_requests', reqs);
                    if (reqs.some(r => r.action === 'stoptwin')) {
                        if (botProcess) {
                            botProcess.kill();
                            botProcess = null;
                            console.log('[Bridge] Бот остановлен по команде из хаба.');
                        }
                    }
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
            } catch (e) { console.log('[Bridge] Ошибка JSON:', e.message); }
        });
    });

    req.setTimeout(3000, () => { req.destroy(); console.log('[Bridge] Ошибка: Таймаут соединения'); });
    req.on('error', (e) => console.log(`[Bridge] Ошибка сети: ${e.code || 'UNKNOWN'} ${e.message}`));
    req.end();
}

setInterval(poll, 3000);
