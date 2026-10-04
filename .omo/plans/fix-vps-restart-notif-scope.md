# fix-vps-restart-notif-scope — Work Plan

## Goal
Ограничить рассылку уведомлений о рестарте VPS (`notifyVpsRestart`) только для администратора (`ADMIN_ID`), исключив рассылку всем пользователям.

## Scope
- `tg-hub.js` — функция `notifyVpsRestart`.

## Todos
- [x] 1. tg-hub.js: обновить `notifyVpsRestart()`, чтобы отправка сообщения `🔄 *VPS / Twins Hub перезапущен*` происходила только по `ADMIN_ID` (если `ADMIN_ID` существует), без итерации по `approved` чатам.
- [x] 2. Верификация: `node --check tg-hub.js` (синтаксис), ревью кода (отправка строго одному админу), ручная проверка (запуск и проверка логов/отправки).
- [x] 3. Коммит `fix(tg): limit restart notification to admin only` → push.

## Acceptance
- После рестарта сообщение об этом приходит ТОЛЬКО админу.
- Обычные пользователи не получают сообщений о рестарте.
