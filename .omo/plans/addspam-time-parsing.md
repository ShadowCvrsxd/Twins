# addspam-time-parsing - Work Plan

## Goal
Реализовать гибкий парсинг времени для команды `/addspam` в `tg-hub.js`: поддерживать суффиксы `s` (секунды), `m` (минуты), `h` (часы).

## Scope
- `tg-hub.js` — добавить `parseDuration(str)` и обновить логику `/addspam`.

## Todos
- [ ] 1. tg-hub.js: реализовать `parseDuration(str)` (регулярка `^(\d+)([smh]?)$`, суффиксы `s`→1, `m`→60, `h`→3600, fallback → 1).
- [ ] 2. tg-hub.js: обновить `/addspam` handler: заменить `parseInt` на `parseDuration`, валидация (результат > 0).
- [ ] 3. Верификация: `node --check`, пробник `/tmp/parse-probe.js` (тесты: `30s`→30, `5m`→300, `1h`→3600, `30`→30, `abc`→error), коммит + push.
