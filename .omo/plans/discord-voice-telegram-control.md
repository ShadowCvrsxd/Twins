# Plan: Telegram Control for Discord Voice Bots

## Objective
Enable runtime management of the 2 Discord voice bots via Telegram (`tg-hub.js`) and database state synchronization (`db.js` + `discord-voice.js`). Admins or approved users can turn voice presence on/off, toggle auto-reconnect, and set the active voice channel ID dynamically without restarting systemd services.

## Scope
- `tg-hub.js`: Add `/voice <1|2> <on|off|reconnect|channel> [value]` command handler. Validates instance (1 or 2), updates `discord_voice_<instance>` KV store in `db.js`, and replies to the user.
- `discord-voice.js`: Implement periodic polling (every 5 seconds) of the database for `discord_voice_<instance>` settings (`enabled`, `reconnect`, `channel_id`). Dynamically join/leave voice channels, respect enabled state, and handle channel ID changes.
- Verification: Run static checks, smoke tests, and ensure smooth runtime state toggling.

## Todos
- [x] 1. `tg-hub.js`: Add `/voice` command handler for managing Discord voice bot settings (`enabled`, `reconnect`, `channel_id`) in `db.js` KV store - tested via message routing.
- [x] 2. `discord-voice.js`: Add database polling loop and dynamic state handler (`enabled`, `channel_id`, `reconnect`) - handles live join/leave/reconnect.
- [x] 3. QA verification: node --check, hub command parsing check, smoke test settings update - all pass.

## Final verification wave
- [x] F1. node --check tg-hub.js and discord-voice.js - exit 0.
- [x] F2. git status / diff clean of unexpected edits.
