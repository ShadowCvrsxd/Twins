# players-uptime-auto - Work Plan

## TL;DR (For humans)
- **Goal:** Automatically select the online twin with the highest uptime (earliest `onlineSince`) for `/players` (and `/tab`) commands in `tg-hub.js`, and route the response directly to Telegram.
- **Scope:** `tg-hub.js` command handler for `/players`.
- **Effort:** Small (1 file change).
- **Risk:** Low.

## Scope
- Modify `/players` and `/tab` handler in `tg-hub.js` to query `bots_status`, filter online bots belonging to the user, sort by `onlineSince`, select the one with the longest uptime, and queue `action: 'players'` request.

## Verification strategy
- Syntax check: `node --check tg-hub.js`
- Test command flow in Telegram bot.
