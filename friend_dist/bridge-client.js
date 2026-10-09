const WebSocket = require('ws');
require('dotenv').config();
const { exec } = require('child_process');
const { set } = require('./db.js');

const bridgeUrl = process.env.SERVER_URL || process.env.BRIDGE_URL || 'ws://localhost:8088';
const token = process.env.BRIDGE_TOKEN;
const botName = process.env.BOT_NAME;

if (!token || !botName) {
  console.log('[Bridge Client] Ошибка: не задан BRIDGE_TOKEN или BOT_NAME в .env');
  process.exit(1);
}

let botProcess = null;
let ws = null;

function connect() {
    ws = new WebSocket(`${bridgeUrl}/bridge?token=${encodeURIComponent(token)}&bot=${encodeURIComponent(botName)}`);

    ws.on('open', () => {
        console.log('[Bridge] Подключено к серверу.');
    });

    ws.on('message', (data) => {
        try {
            const command = JSON.parse(data);
            console.log('[Bridge] Получена команда:', command);
            
            if (command.action === 'stoptwin') {
                if (botProcess) {
                    botProcess.kill();
                    botProcess = null;
                    console.log('[Bridge] Бот остановлен по команде из хаба.');
                }
            } else {
                set('bot_requests', [command]);
                
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

    ws.on('close', () => {
        console.log('[Bridge] Соединение закрыто. Реконнект через 3 сек...');
        setTimeout(connect, 3000);
    });

    ws.on('error', (e) => {
        console.log(`[Bridge] Ошибка: ${e.message}`);
        ws.close();
    });
}

connect();
