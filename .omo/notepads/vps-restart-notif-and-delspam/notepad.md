
## Learning (2026-09-29)
- notifyVpsRestart() добавлена в tg-hub.js: читает links_approved + ADMIN_ID, шлёт '🔄 *VPS / Twins Hub перезапущен*' всем чатам, вызов setTimeout 2000ms после initBotMenu().
- /delspam <алиас> <номер>: ветка после /addspam (строка ~715), validate resolveBot + int + границы массива, splice(num-1), set, push reloadSpam в bot_requests — бот применяет без рестарта (в bot-base.js action reloadSpam уже есть).
- Меню initBotMenu + /start help — команда delspam добавлена.
- Верификация: node --check OK; probe 3 asserts (notifyVpsRestart defined/ordered, /delspam после /addspam, menu+help) PASS.
- Коммит 680cc31 feat(tg): add VPS restart notification and /delspam command → push.
- Деплой: cd /root/Twins && git pull && sudo systemctl restart twins-tghub.
