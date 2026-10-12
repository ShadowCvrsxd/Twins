# Twins Bot Framework

Framework for managing Minecraft accounts ("twins") via Telegram with a distributed architecture.

## Architecture

- **Hub & Chat Bot**: Central Telegram interface (`tg-hub.js`, `tg-chat-bot.js`) deployed on VPS.
- **API Gateway & WebSocket Bridge**: Operates on port 8089 (`tg-hub.js`) for real-time command dispatch and telemetry.
- **Client Bots**: Mineflayer-based bots (`bot.js`, `bot-2.js`, `bot-main.js`) running on local client machines connecting to the Hub via WebSocket.
- **Storage**: SQLite via `better-sqlite3` (`db.js`) with fallback to JSON store.

## Startup Commands

- `npm run hub` — Start central Telegram hub & port 8089 API/WebSocket gateway
- `npm run chat` — Start Telegram chat bot interface
- `npm run main` — Start main bot instance
- `npm run bot1` — Start Twin 1 bot (`bot.js`)
- `npm run bot2` — Start Twin 2 bot (`bot-2.js`)
- `npm run vote` — Run auto-vote / VPN pipeline (`vote_vpn.js`)

## Configuration

Copy environment template files (e.g., `.env.main.example`, `.env.twin1`, `.env.twin2`) and configure your Telegram tokens, server endpoints, and authentication tokens.