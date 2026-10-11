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

const axios = require('axios'); // ponytail: используем fetch (уже есть в ноде) или http

async function sendToApi(command) {
    try {
        const response = await fetch(`${bridgeUrl.replace('ws', 'http')}/command`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(command)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        console.log('[Bridge] Команда успешно отправлена через API.');
    } catch (e) {
        console.log('[Bridge] Ошибка API:', e.message);
    }
}

ws.on('message', (data) => {
    try {
        const command = JSON.parse(data);
        if (command.action === 'stoptwin') {
            if (botProcess) { botProcess.kill(); botProcess = null; }
        } else {
            // Переход на API вместо прямой записи в БД
            sendToApi(command);
        }
    } catch (e) { console.log('[Bridge] Ошибка:', e.message); }
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
