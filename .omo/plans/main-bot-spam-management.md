# main-bot-spam-management - Work Plan

## TL;DR
- **Goal:** Управлять спам-тасками твинков прямо из мейн ТГ-бота (`tg-hub.js`): просмотр списка (`/spamlist`) и добавление (`/addspam`). Изменения применяются на животе через новый action `reloadSpam` в `bot_requests`.

## Scope
- `bot-base.js` — вынести восстановление спама в переиспользуемую `reloadSpamTasks(initialDelayMs)`; обработать `action: 'reloadSpam'` в polling `bot_requests`.
- `tg-hub.js` — команды `/spamlist <алиас>` и `/addspam <алиас> <сек> <текст>` + записи в `initBotMenu` и /start-хелп.

## Факты из кода
- `spamKey = 'spam_tasks_' + config.username.toLowerCase()`; `loadSpamTasks()`/`saveSpamTasks()` уже есть (bot-base.js:120-129).
- Inline восстановление спама после спавна: bot-base.js ~485-502 (setTimeout 10s → clearInterval всех → загрузка из БД → пересоздание интервалов).
- Polling `bot_requests` (bot-base.js:158-197): `if (r.action === 'players') ... else if (r.action === 'switchServer') ...`, запросы удаляются после обработки.
- `tg-hub.js`: `resolveBot(chatId, arg)` → ник; `readJSONArray(reqFile)` для `bot_requests`; стиль `set`/`get` (SQLite).
- Формат вывода спам-листа (стиль bot-base `spamlist`): `1:/cookie - 310 сек`, разделитель ` | `.

## Todos
- [x] 1. bot-base.js: заменить inline-блок восстановления спама на `reloadSpamTasks(initialDelayMs = 10000)` — та же логика (clearInterval всех, loadSpamTasks, пересоздание интервалов, лог), но delay параметризован; вызвать из спавн-блока.
- [x] 2. bot-base.js: в polling `bot_requests` добавить ветку `else if (r.action === 'reloadSpam') { reloadSpamTasks(0); console.log('[...] Презагрузка спама из хаба'); }`.
- [x] 3. tg-hub.js: команда `/spamlist <алиас>` — `resolveBot`, `get('spam_tasks_' + ник-lower, [])`, ответ `📋 Спам-задачи <ник>: 1:/cookie - 310 сек` (пусто → `Нет активных задач`).
- [x] 4. tg-hub.js: команда `/addspam <алиас> <сек> <текст>` — `delay = parseInt(parts[2])` (валидация > 0, иначе ошибка), `msg = parts.slice(3).join(' ')` (непустой), push `{ msg, delay }` в `spam_tasks_<ник-lower>`, затем push `{ username: ник, action: 'reloadSpam' }` в `bot_requests` (readJSONArray/writeJSON reqFile), ответ `✅ Спам #N добавлен для <ник>: "<msg>" (каждые <delay>с)`.
- [x] 5. tg-hub.js: `initBotMenu` + /start-хелп: добавить `/spamlist` и `/addspam` (в хелпе `— список спама`, `— добавить спам (/addspam <алиас> <сек> <текст>)`).
- [x] 6. Верификация: `node --check bot-base.js tg-hub.js` (exit 0); логика-пробник для /addspam и reload-action в /tmp (мок get/set: добавление в массив задач + постановка reloadSpam в очередь); коммит `feat(tg): spamlist/addspam commands + live spam reload` → push.

## Acceptance
- `/spamlist 1` показывает текущие задачи бота.
- `/addspam 1 30 текст` → бот без перезапуска начинает слать «текст» каждые 30с.
- Легаси-поведение после спавна (восстановление через 10с) не изменилось.