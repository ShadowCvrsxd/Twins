# multi-bot-chat-selection — learnings

- `db.js` уже SQLite-first (`better-sqlite3`, таблица `kv`), JSON-фоллбэк только при падении нативного бинарника. Любое новое состояние — через `get`/`set`, не плодить `.json`.
- Мейн-бот определяется флагом `isMain: true` из `bot-main.js`; ник — `config.username` из `.env.main` (хелпер `getMainAccount()` = `MAIN_ACCOUNT || 'AlexZTI_'`).
- Проверка «бот запущен» — `bots_status[<ник-lower>].online`, пишется `updateBotStatus()` на spawn/end. Playerlist для этого НЕ нужен.
- `chat_sender_selection` хранит РЕЗОЛВНУТЫЙ ник-lower, а не сырой селектор 1/2/main — переживает переупорядочивание/алиасы.
- Легаси-фоллбэк (без выбора): первый онлайн-твинк по `onlineSince` — сохранён, чтобы не ломать существующее поведение.
- Параллельная делегация по независимым файлам работает: utils+bot-base / tg-hub / tg-chat-bot без конфликтов, итоговая верификация + коммит одним воркером.
