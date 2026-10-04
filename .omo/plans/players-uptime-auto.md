# players-uptime-auto - Work Plan

## TL;DR (For humans)
- **Goal:** Automatically select the online twin with the highest uptime (earliest `onlineSince`) for `/players` (and `/tab`) commands in `tg-hub.js`, and route the response directly to Telegram.
- **Approach:** Update `tg-hub.js` so `/players` inspects `bots_status`, filters user's online bots, sorts by `onlineSince`, picks the longest-running twin, and queues `action: 'players'`.
- **Effort:** Small.
- **Risk:** Low.

## Scope
- `tg-hub.js`: Update `/players` and `/tab` command handler.

## Verification strategy
- `node --check tg-hub.js`

## Todos
- [x] 1. tg-hub.js: Update /players command handler to automatically select online twin with highest uptime - expect correct target bot selection and direct Telegram response via bot_requests.

## Final verification wave
- [x] F1. Verify tg-hub.js syntax - expect node --check to pass with 0 errors.
