# bot-coords-command — Work Plan

## Goal
Добавить команду `/pos <алиас>` в Telegram, которая возвращает координаты твинка в обычном мире и расчётные координаты в аду (Overworld -> Nether: /8).

## Scope
- `tg-hub.js`: обработка `/pos <алиас>`, отправка команды `pos` в `bot_requests`.
- `bot-base.js`: обработка действия `pos`, получение `bot.entity.position`, ответ в чат с координатами.

## Todos
- [x] 1. tg-hub.js: обработка `/pos <алиас>`, валидация, push {action: 'pos'} в `bot_requests`.
- [x] 2. bot-base.js: обработка `r.action === 'pos'`, `bot.entity.position` (x, y, z), расчёт Nether (x/8, z/8), `botInstance.chat` с форматированием.
- [x] 3. Верификация: `node --check`, commit `feat(tg,bot): add /pos command`, push.

## Acceptance
- `/pos bot1` → "Координаты bot1: X Y Z | Nether: X/8 Y Z/8".
- Работает для валидного алиаса.