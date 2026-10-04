# fix-players-routing-race - Work Plan

## TL;DR (For humans)
- **Goal:** Fix the race condition in the `/players` response delivery queue by replacing the global `bot_responses` array with isolated per-bot keys (`bot_response_<username>`).
- **Approach:** 
    - Twins write their `/players` responses to their own exclusive key: `bot_response_<username>`.
    - Main Bot (tg-hub) checks these per-bot keys, immediately clears them, and delivers the message to the user.
- **Effort:** Small.
- **Risk:** Low.

## Scope
- `bot-base.js`: Update `/players` response to write to `bot_response_<username>` instead of global array.
- `tg-hub.js`: Update polling interval to check per-bot response keys for all approved bots.

## Verification strategy
- `node --check tg-hub.js`
- `node --check bot-base.js`
- Test: `/players` with both bots online -> responses delivered reliably without omission.

## Todos
- [ ] 1. bot-base.js: Write `/players` response to `bot_response_<username>` as a single object, replacing the global array push.
- [ ] 2. tg-hub.js: Replace global `bot_responses` polling with checking `bot_response_<botName>` for all approved bots, immediately nullifying the key before sending.
- [ ] 3. Run syntax checks on both files.
