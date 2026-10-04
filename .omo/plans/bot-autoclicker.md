# bot-autoclicker — Work Plan

Заменяет устаревший план `bot-farm-mobs` (пользователь уточнил ТЗ: не скан мобов в радиусе, а **автокликер по направлению взгляда**).

## Goal
Добавить автокликер для твинков: бот автоматически бьёт цель, на которую смотрит, с идеальным таймингом (полный заряд атаки меча ≈ 0.625с при attack speed 1.6).

- Команды управления:
  - В игре (`/msg` / реле хаба → `handleCommand` в `bot-base.js`): `autoclickon`, `autoclickoff`.
  - В Telegram (`tg-hub.js`): `/autoclickon <алиас>`, `/autoclickoff <алиас>` через `bot_requests` + меню `initBotMenu()` и хелп `/start`.
- Логика (`bot-base.js`):
  - `setInterval` ~700мс (идеальный тайминг полного заряда меча).
  - Каждый тик: `bot.entityAtCursor(4.5)` — если цель есть и это не игрок и не сам бот → `bot.lookAt(цель)` уже не нужен (бот уже смотрит) → `bot.attack(entity)`.
  - Ограничение: не атаковать `entity.type === 'player'` и `entity === bot.entity` (безопасность: только мобов/животных).
- Персистентность: `clicker_settings` в SQLite (`get`/`set`, формат как `meow_settings`): `{ [botNameLower]: { enabled: true } }`. Авто-возобновление при спавне бота.

## Scope
- `bot-base.js` — состояние кликера, таймер, обработка `autoclickon`/`autoclickoff` в `handleCommand`, восстановление из БД при спавне, обработка actions `autoclickon`/`autoclickoff` в цикле `bot_requests`.
- `tg-hub.js` — команды `/autoclickon`/`/autoclickoff` (валидация алиаса через `resolveBot`, push в `bot_requests`), запись в `initBotMenu()` и `/start`.

## Todos
- [x] 1. `bot-base.js`: добавить `clicker_settings` (БД), `startAutoClick(bot)` (интервал 700мс: `entityAtCursor(4.5)` → пропуск игроков/себя → `bot.attack`), функции `autoclickon`/`autoclickoff` в `handleCommand` + ветки `action === 'autoclickon'/'autoclickoff'` в цикле `bot_requests`, авто-восстановление в `bot.on('spawn')`.
- [x] 2. `tg-hub.js`: команды `/autoclickon <алиас>` и `/autoclickoff <алиас>` (+ в `initBotMenu()` и хелпе `/start`).
- [x] 3. Верификация: `node --check bot-base.js tg-hub.js`, пробник логики таймера/фильтра цели в `/tmp`, ревью диффа, коммит `feat(tg,bot): add auto-clicker with gaze targeting` → push.

## Acceptance
- `/autoclickon bot1` в Telegram включает кликер bot1; бот бьёт моба в прицеле каждые ~700мс.
- Игроков не трогает. При отсутствии цели в прицеле — бездействует.
- `/autoclickoff bot1` выключает. Состояние переживает рестарт/реконнект боtа.