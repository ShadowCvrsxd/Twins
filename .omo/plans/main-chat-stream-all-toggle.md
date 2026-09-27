# main-chat-stream-all-toggle - Work Plan

## Goal
При включении дублирования ВСЕГО чата мейна (`/mainstreamallon`) автоматически ОТКЛЮЧАТЬ стриминг чатов твинков для этого чата; при выключении (`/mainstreamalloff`) — восстанавливать прежнее состояние стриминга твинков.

## Scope
- `tg-hub.js` — обновить ветки `/mainstreamallon` и `/mainstreamalloff`.

## Факты из кода
- Стриминг твинков: ключ `chat_streaming`, форма `{ [chatId]: { [botNickLower]: true } }` — utils.js `sendTelegramNotification`: `const userStream = streaming[targetChatId]; if (!userStream || !userStream[username.toLowerCase()]) return;`. Т.е. `chat_streaming[chatId]` — объект с флагами на каждого бота.
- Ветка `/mainstreamallon`/`/mainstreamalloff` (tg-hub.js ~240-246): читает/пишет `main_chat_stream_all[chatId]`.
- Бэкап-ключ (новый): `main_chat_stream_backup`, форма `{ [chatId]: <слепок chat_streaming[chatId]> }`.

## Todos
- [ ] 1. tg-hub.js: `/mainstreamallon` — перед включением дублирования мейна: сохранить текущий `chat_streaming[chatId]` в `main_chat_stream_backup[chatId]` (если бэкапа ещё нет), затем установить `chat_streaming[chatId] = {}` (все твинки для чата выключены). В ответ добавить `Стриминг твинков выключен.`.
- [ ] 2. tg-hub.js: `/mainstreamalloff` — восстановить `chat_streaming[chatId]` из `main_chat_stream_backup[chatId]` (удалить запись бэкапа), если бэкапа нет — не трогать chat_streaming. В ответ добавить `Стриминг твинков восстановлен.`.
- [ ] 3. Верификация: `node --check tg-hub.js`, пробник логики (мок get/set: вкл → твинки выкл + бэкап сохранён; выкл → восстановлено), коммит `feat(tg): auto-toggle twin streaming with main stream-all` → push.

## Acceptance
- `/mainstreamallon` → мейн дублируется весь, твинки молчат.
- `/mainstreamalloff` → мейн снова только с ником, твинки шлют как до включения.
- Повторный `/mainstreamallon` не затирает бэкап (идемпотентно), повторный `/mainstreamalloff` без бэкапа не ломает chat_streaming.