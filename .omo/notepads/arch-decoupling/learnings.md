# Learnings — arch-decoupling

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

- Decoupled `tg-hub.js` from `db.js` for command processing: replaced direct `bot_commands` file writes with `sendCommand` WebSocket communication in `/chat` command.
- Replaced polling-based command processing in `bot-base.js` with direct WebSocket connection to Hub, eliminating `bot_commands` and `bot_requests` polling in `db.js`.
- Confirmed `tg-hub.js` and `tg-chat-bot.js` use standard Telegram `getUpdates` API for telegram-based polling, not local file polling for `bot_commands`.
- Verification: `bot_requests` is no longer actively written to for command delivery.
- Verification: `bot_commands` is still actively written to by `tg-chat-bot.js` for chat message delivery, meaning the decoupling for chat messages is not complete.
- Verification: WebSocket command delivery (`sendCommand` in `tg-hub.js`) is confirmed as the mechanism for core bot commands.


- Refactored : replaced  file writes with direct HTTP POST to `http://localhost:8089/command` for chat streaming.
- Chat message delivery is now unified through the Hub's API gateway via HTTP POST, completing the decoupling of chat messages from `bot_commands` file polling.
- Refactored tg-chat-bot.js: replaced bot_commands file writes with direct HTTP POST to http://localhost:8089/command for chat streaming.
- Chat message delivery is now unified through the Hub's API gateway via HTTP POST, completing the decoupling of chat messages from bot_commands file polling.

- Verification: WebSocket command delivery (`sendCommand` in `tg-hub.js`) is confirmed as the mechanism for core bot commands.

- Verified: `tg-hub.js` port 8089 binds correctly - HTTP API gateway and WebSocket server both listen on 0.0.0.0:8089 (confirmed via `ss -tlnp`).
- Verified: WebSocket connections functional - bot1 successfully connects to `ws://localhost:8089?token=...&bot=bot1`, messages delivered via `sendCommand()`.
- Verified: HTTP POST to `http://localhost:8089/command` returns proper auth responses (401 unauthenticated, 403 forbidden, 200 OK with valid bot token).
- Verified: All main command categories deliver via WebSocket: start/stop twin (`/starttwin`/`/stoptwin`), spam (`/addspam`/`/delspam`), clicker (`/autoclickon`/`/autoclickoff`), and all other actions (`/chat`, `/setswing`, `/pos`, `/players`, `/testserver`, `/mainserver`).
- Enhanced `/pos` command routing: passes `chatId` in WebSocket payload from `tg-hub.js` to `bot-base.js`, enabling direct response delivery via `bot_response_<username>` DB key without requiring chat streaming to be enabled.
- World name detection in `/pos`: analyzes `lastTabHeader` and `lastTabFooter` to detect the current world (`Мир ферм`, `Мир построек`, `Мир артов`), reporting Overworld (X, Y, Z) and Nether (X/8, Z/8) coordinates.
