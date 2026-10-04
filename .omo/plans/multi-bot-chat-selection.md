# multi-bot-chat-selection - Work Plan

## TL;DR (For humans)
- **Goal 1:** Дублировать чат мейн-аккаунта в Telegram, но только сообщения, содержащие ник мейна. Включение/выключение — командами через мейн-бота (`tg-hub.js`).
- **Goal 2:** В чат-боте (`tg-chat-bot.js`) выбирать, с какого бота отправится сообщение (`/setchat <1|2|main>`), с проверкой «бот запущен» через `bots_status` (НЕ playerlist).
- **Хранилище:** Всё через `db.js` `get`/`set` → SQLite (`twins.db`, таблица `kv`). JSON — только аварийный фоллбэк (`twins_store.json`), новых `.json`-файлов НЕ создавать.

## Scope
- `utils.js` — новая функция `sendMainTelegramNotification`.
- `bot-base.js` — вызов для мейна в `messagestr`.
- `tg-hub.js` — команды `/mainstreamon` и `/mainstreamoff`.
- `tg-chat-bot.js` — команда `/setchat` + переработка не-командного сообщения.

## Соглашения (факты из кода)
- Мейн-бот: `bot-main.js` → `startBot('.env.main', { isMain: true })`. Ник мейна = `config.username` из `.env.main`; хелпер `getMainAccount()` = `process.env.MAIN_ACCOUNT || 'AlexZTI_'`.
- `bots_status`: ключи = `username.toLowerCase()` → `{ online, onlineSince, username }`. Пишется `updateBotStatus()` на spawn/end. Проверка «бот запущен» = `statuses[nickLower]?.online`.
- Отправка в ТГ: токен `process.env.TG_CHAT_BOT_TOKEN || process.env.TG_BOT_TOKEN`, напрямую через `fetch` (паттерн `sendTelegramNotification`).
- `tg-chat-bot.js` уже импортирует `get`/`set` из `db.js` и хранит выборы пользователя в `kv` (SQLite).

## Todos
- [x] 1. utils.js: добавить `sendMainTelegramNotification(text)` — для каждого chatId из `links_approved`, где `main_chat_streaming[chatId]` истинно: чистит текст (`cleanMinecraftText`), фильтрует case-insensitive по нику мейна (`textLower.includes(getMainAccount().toLowerCase())`), шлёт `💬 [<ник>] <text>` через токен `TG_CHAT_BOT_TOKEN || TG_BOT_TOKEN` в этот chatId. Экспорт функции.
- [x] 2. bot-base.js: в обработчике `messagestr` (ветка `else`, строка ~552) — если `config.isMain`, вызывать `sendMainTelegramNotification(message)` вместо `sendTelegramNotification(bot.username, message)`. Добавить импорт новой функции из `utils.js`.
- [x] 3. tg-hub.js: добавить команды `/mainstreamon` и `/mainstreamoff` — `main_chat_streaming[chatId] = true|false` через `set('main_chat_streaming', ...)`, ответ `✅ Трансляция чата мейна: ВКЛ/ВЫКЛ`. Добавить обе в `initBotMenu` (setMyCommands).
- [x] 4. tg-chat-bot.js: команда `/setchat <1|2|main>` — `1` → `userBots[0]`, `2` → `userBots[1]`, `main` → `getMainAccount()`. Для 1/2 проверить владение (`userBots.length > index`), иначе ошибка. Сохранить `chat_sender_selection[chatId] = <ник-lower>` через `set`. Для `main` валидации владения нет. Добавить в `initBotMenu`.
- [x] 5. tg-chat-bot.js: в не-командной ветке `poll()` — взять `targetLower = chat_sender_selection[chatId]`; если задан: проверка `bots_status[targetLower]?.online`; оффлайн → `❌ Бот <ник> оффлайн.` и НЕ ставить в очередь; онлайн → очередь `bot_commands` для этого ника. Если не задан — сохранить текущее поведение (первый онлайн-твинк из `userBots`).
- [x] 6. Финальная проверка: `node --check` на `utils.js`, `bot-base.js`, `tg-hub.js`, `tg-chat-bot.js` → exit 0. Коммит `feat(chat): main chat streaming + /setchat sender selection` и push в `origin main`.

## Verification strategy
- `node --check utils.js bot-base.js tg-hub.js tg-chat-bot.js`
- Логика фильтра ника и выбора отправителя — юнит-проверка в `/tmp`: `node -e` с моками `get`/`set` (assert: сообщение без ника не проходит, с ником проходит; выбор оффлайн-бота отклоняется).
- Ручной QA на VPS: `/mainstreamon` → написать в игре сообщение с ником мейна → проверка доставки в ТГ; `/setchat 1` → сообщение в чат-боте уходит с твинка 1.