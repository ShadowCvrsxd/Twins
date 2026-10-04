# bot-autoclicker-dynamic — Work Plan

## Goal
Добавить твинку **ручное и автоматическое определение тайминга удара** для автокликера:
- **Автоматически**: интервал = `1000 / attack_speed` предмета в руке (`generic.attack_speed` из NBT предмета; фолбэк 1.6 — базовый меч). Динамический пересчёт каждый цикл (смена оружия → тайминг меняется без рестарта).
- **Вручную**: команда `/setswing <алиас> <мс>` (Telegram) и `setswing <мс>` (в игре) — жёсткий интервал, переопределяет автоматический; `setswing auto` (или 0) — возврат к автоматическому.

Текущий код: `setInterval(..., 700)` — фиксированные 700мс. Замена на рекурсивный `setTimeout`, чтобы задержка пересчитывалась каждый цикл.

## Scope
- `bot-base.js`: расширение `clicker_settings` (поле `manualCooldownMs`), перепись `startAutoClick` на рекурсивный `setTimeout` + чтение attack_speed из `bot.heldItem`, команда `setswing` в `handleCommand`, ветка `action === 'setswing'` в цикле `bot_requests`.
- `tg-hub.js`: команда `/setswing <алиас> <мс|auto>`, пункт в `initBotMenu()` и строка в `/start`.

## Todos
- [x] 1. bot-base.js: `setClickerState(bot, patch)` — мёржит `{ enabled, manualCooldownMs }` в `clicker_settings` (не затирает соседние поля). `startAutoClick`: рекурсивный `setTimeout` вместо `setInterval`; задержка цикла = `manualCooldownMs ?? (1000 / getAttackSpeed(bot))`; `getAttackSpeed` — парсит `bot.heldItem` NBT: `components['minecraft:attribute_modifiers'].modifiers[]` ищет `attribute_name` содержащий `attack_speed` (фолбэк `nbt.value.attributeModifiers`, фолбэк 1.6). Скан/атака/фильтр игроков-самого-бота без изменений. `stopAutoClick` очищает таймаут. Команда `setswing <мс|auto>` в `handleCommand` (валидация: целое >0, иначе 'auto'→null; ответ через replyCmd). Ветка `r.action === 'setswing'` в `bot_requests` → `setClickerState(bot, { manualCooldownMs: r.ms })`.
- [x] 2. tg-hub.js: команда `/setswing <алиас> <мс|auto>` — resolveBot, валидация `parseInt > 0` или 'auto'; push `{ username, action: 'setswing', ms: число|null }` в `bot_requests`; ответ `✅ Тайминг удара для <ник>: X мс / авто`. Пункт меню + строка /start.
- [x] 3. Верификация: `node --check bot-base.js tg-hub.js`; vm-пробник: (а) меч speed 1.6 → интервал ~625мс (атаки в окне), (б) топор speed 1.0 → интервал ~1000мс, (в) manualCooldownMs 300 → ~300мс, (г) 'auto'/null → снова скорость предмета, (д) игрок/сам бот по-прежнему пропускаются. Коммит `feat(tg,bot): manual + automatic attack timing for auto-clicker` → push.
- [x] 4. bot-base.js: Удалить радиальный скан энтити (триггер киков), заменить на `bot.entityAtCursor(4.5)` (бить только в crosshair).

## Acceptance
- [x] Кликер автоматически подстраивает интервал под оружие в руке (меч 625мс, топор 1000мс).
- [x] `/setswing bot1 300` → 300мс жёстко, пока не вернут `auto`.
- [x] Игроков и себя не бьёт. `/autoclickoff` выключает.
- [x] Бьёт только то, что в центре экрана (без поиска вокруг).