# websocket-bridge-migration - Work Plan

## Goal
Перевести управление твинком на WebSockets для стабильной и мгновенной передачи команд, избавившись от polling-костылей.

## Scope
- tg-hub.js: добавить WebSocket-сервер (`ws`), убрать старую логику опроса файлов.
- bridge-client.js: заменить polling-клиент на WebSocket-клиент.
- package.json: добавить зависимость `ws`.

## Todos
- [x] 1. Установить `ws` на сервере: `npm install ws`.
- [x] 2. tg-hub.js: заменить старый HTTP-мост на `new WebSocket.Server({ port: 8088 })`, хранить активные сокеты твинков.
- [x] 3. bridge-client.js: реализовать `new WebSocket('ws://...')`, при получении команды запускать `bot-base.js`.
- [x] 4. Убрать старую логику polling из `tg-hub.js`.
- [x] 5. Подготовить архив `friend_dist/` для кента (с зависимостью `ws`).
- [x] 6. Верификация: `node --check` tg-hub, bridge-client, тестовый запуск.
