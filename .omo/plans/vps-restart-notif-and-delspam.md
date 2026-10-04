# vps-restart-notif-and-delspam - Work Plan

## Goal
1. **VPS Reboot Notification**: При старте хаба (`tg-hub.js`) отправлять уведомление о рестарте/запуске VPS в Telegram (админу и всем владельцам привязанных ботов из `links_approved`).
2. **Targeted Spam Task Deletion**: Добавить команду `/delspam <алиас> <номер>` в `tg-hub.js` для точечного удаления спам-задачи по её порядковому номеру (из `/spamlist`) с мгновенным сигналом боту на лету (`reloadSpam`).
3. **Menu & Help Update**: Обновить телеграм-меню (`initBotMenu`) и хелп `/start`.

## Scope
- `tg-hub.js` — добавление `notifyVpsRestart`, команды `/delspam`, обновление `/start` и `initBotMenu`.

## Todos
- [x] 1. tg-hub.js: добавить функцию `notifyVpsRestart()` и вызов при старте хаба.
- [x] 2. tg-hub.js: добавить обработчик команды `/delspam` (чтение `spam_tasks_<bot>`, splice по индексу `номер - 1`, запись, отправка сигнала `reloadSpam` в `bot_requests`, ответ в чат).
- [x] 3. tg-hub.js: добавить `{ command: 'delspam', description: 'Удалить спам-задачу (/delspam <алиас> <номер>)' }` в `initBotMenu()` и в описание `/start`.
- [x] 4. Верификация: `node --check tg-hub.js`, коммит `feat(tg): add VPS restart notification and /delspam command` -> push.

## Acceptance
- При перезапуске `tg-hub.js` в чаты приходит уведомление `🔄 *VPS / Twins Hub перезапущен*`.
- Команда `/delspam bot1 1` удаляет первую задачу из списка спама указанного бота и мгновенно применяет изменения в игре без рестарта бота.
