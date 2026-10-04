# db-based-players-routing - Work Plan

## TL;DR (For humans)
- **Goal:** Route `/players` response from Twins to the Main Bot via a new DB-based response queue (`bot_responses`), bypassing the chat stream/Chat Bot.
- **Approach:** 
    - Twins write player list result (msg + chatId) to `bot_responses` DB key.
    - Main Bot (tg-hub) polls `bot_responses`, delivers the result to the requesting `chatId` via Main Bot Telegram API.
- **Effort:** Small.
- **Risk:** Low.

## Scope
- `tg-hub.js`: 
    - Update `/players` request handler to pass `chatId` in the request payload.
    - Add interval polling for `bot_responses` DB key to deliver answers.
- `bot-base.js`:
    - Update `players` response logic: write to `bot_responses` instead of using `sendTelegramNotification`.

## Verification strategy
- `node --check tg-hub.js`
- `node --check bot-base.js`
- Test: `/players` from main bot chat -> confirmation -> answer arrives in main bot chat.

## Todos
- [x] 1. tg-hub.js: Include `chatId` in `/players` request payload.
- [x] 2. tg-hub.js: Add polling interval for `bot_responses` DB key, send via `sendMessage(chatId, msg)`.
- [x] 3. bot-base.js: Update `players` response: write `{ msg, chatId }` to `bot_responses` key (updated to per-bot keys `bot_response_<username>`).
- [x] 4. F1. Final verification: Verify `/players` delivers to the Main Bot.
