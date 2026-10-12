# Gemini & AI Instructions for Twins Bot Framework

## Environment & Tech Stack
- **Runtime:** Node.js (CommonJS, `require`)
- **Minecraft Integration:** `mineflayer` & `minecraft-protocol`
- **Database:** SQLite via `better-sqlite3` (`db.js`, with JSON store fallback)
- **Communication:** Telegram Bot API (`fetch`) + Port 8089 HTTP/WebSocket API Gateway

## Core Commands
- Hub: `npm run hub` (`tg-hub.js`)
- Chat Bot: `npm run chat` (`tg-chat-bot.js`)
- Main Bot: `npm run main` (`bot-main.js`)
- Twin 1: `npm run bot1` (`bot.js`)
- Twin 2: `npm run bot2` (`bot-2.js`)
- Vote Pipeline: `npm run vote` (`vote_vpn.js`)

## Architecture Rules for AI & Developers
1. **Real-Time Communication**: Pass commands exclusively through the port 8089 WebSocket bridge / HTTP API gateway. Never use the database or file queues for real-time inter-process messaging.
2. **Authentication**: All client connections and API requests authenticate via bearer tokens validated against the Hub's registry.
3. **Isolation**: Keep Minecraft credentials strictly on client machines; Hub credentials are for bridge auth only.
4. **Code Quality & Commits**: Keep changes atomic, concise, and well-tested.
