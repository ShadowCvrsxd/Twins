# rollback-players-cmd - Work Plan

## TL;DR (For humans)
- **Goal:** Revert recent changes to `/players` command in `tg-hub.js` and `bot-base.js` to restore the original functionality where it required a target argument and used the chat stream for notifications.
- **Approach:** Revert `tg-hub.js` and `bot-base.js` to the previous state.
- **Effort:** Small.
- **Risk:** Low.

## Scope
- `tg-hub.js`: Revert `/players` / `/tab` command handler.
- `bot-base.js`: Revert `players` action response handler.

## Verification strategy
- `node --check tg-hub.js`
- `node --check bot-base.js`

## Todos
- [x] 1. tg-hub.js: Revert /players handler to original state (require targetArg, resolveBot call).
- [x] 2. bot-base.js: Revert `players` action response to use `sendTelegramNotification` instead of direct Telegram API `fetch`.

## Final verification wave
- [x] F1. Verify syntax - expect node --check to pass with 0 errors.
