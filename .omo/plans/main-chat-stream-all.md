# main-chat-stream-all - Work Plan

## Goal
Дублировать ВЕСЬ чат мейн-акка (не только сообщения с ником мейна) в мейн ТГ-бот через новые команды `/mainstreamallon` и `/mainstreamalloff`.

## Scope
- `tg-hub.js` — команды `/mainstreamallon`/`/mainstreamalloff` (состояние `main_chat_stream_all[chatId]` в БД), записи в меню и /start-хелп.
- `utils.js` — в `sendMainTelegramNotification` при включённой настройке для чата пропускать фильтр `includes(mainNick)` и слать ВСЁ.

## Факты из кода
- `sendMainTelegramNotification(text)` (utils.js:127-152): фильтр `if (!cleanedText.toLowerCase().includes(mainNick)) return;` (строка 134); цикл по `approved`, отправляет только в чаты с `streaming[chatId]`; текст: `💬 [мейн] ${cleanedText}`.
- `/mainstreamon`/`/mainstreamoff` (tg-hub.js:231-232): `const enabled = cmd === '/mainstreamon';` → `set('main_chat_streaming', ...)`. Новые команды делаются рядом.
- `get`/`set` — SQLite (JSON фоллбэк), как везде.

## Todos
- [ ] 1. tg-hub.js: команды `/mainstreamallon`/`/mainstreamalloff` — `set('main_chat_stream_all', { ...map, [chatId]: enabled })`, ответы `✅ Дублирование всего чата мейна включено/выключено`, добавление в `initBotMenu` и /start-хелп.
- [ ] 2. utils.js: `sendMainTelegramNotification` — перед фильтром ника проверять `get('main_chat_stream_all', {})[chatId]`, тогда НЕ применять `includes(mainNick)` (слать всё).
- [ ] 3. Верификация: `node --check tg-hub.js utils.js`, пробник фильтра (мок get/set: выкл → только ник; вкл → всё), коммит `feat(tg): stream full main chat toggle` → push.

## Acceptance
- `/mainstreamallon` → любое сообщение чата мейна уходит в ТГ; `/mainstreamalloff` → снова только с ником мейна.
- Настройка переживает рестарт (хранится в БД).