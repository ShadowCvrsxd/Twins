# meow-cooldown-command - Work Plan

## Goal
Добавить команду `/meowcd <алиас> <время>` в Telegram-хаб для гибкой настройки кулдауна (КД) функции «мяу» для каждого твинка.

## Scope
- `tg-hub.js` — добавить команду `/meowcd`, обработку аргументов (минуты или формат времени через `parseDuration`), обновление `meow_settings` в БД, регистрацию в меню и хелпе `/start`.
- `bot-base.js` — в функции `checkMeow` считывать `cooldownMs` из настроек бота (`botSettings.cooldownMs`), с фолбэком на 5 минут (`5 * 60 * 1000`).

## Todos
- [ ] 1. tg-hub.js: реализовать обработчик команды `/meowcd <алиас> <время>` (разрешить парсинг минут/секунд с помощью `parseDuration` или числа, обновить `meow_settings` для нужного бота).
- [ ] 2. tg-hub.js: добавить команду `/meowcd` в `initBotMenu()` и в описание `/start`.
- [ ] 3. bot-base.js: обновить `checkMeow()`: `const cooldownMs = botSettings.cooldownMs || (5 * 60 * 1000);`.
- [ ] 4. Верификация: `node --check tg-hub.js bot-base.js`, коммит `feat(tg,bot): add /meowcd command for meow cooldown configuration` -> push.

## Acceptance
- Пользователь может отправить `/meowcd bot1 1m` или `/meowcd bot1 2` (2 минуты).
- Бот сохраняет настройку в `meow_settings` и применяет новый КД при проверке сообщений с «мяу».
