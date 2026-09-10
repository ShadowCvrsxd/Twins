# Gemini & AI Instructions for Twins Bot Framework

## Environment
- **Execution:** Current Opencode agent session runs **locally / outside the VPS**, while deployment targets remote VPS instances via Git/SSH/Actions.
- **Runtime:** Node.js (CommonJS, `require`)
- **Minecraft:** `mineflayer`
- **Database:** `db.js` (SQLite via `better-sqlite3`, fallback to `twins_store.json`)
- **Telegram:** Direct Telegram Bot API via `fetch`

## Core Commands
- Hub: `npm run hub`
- Chat Bot: `npm run chat`
- Main Bot: `npm run main`
- Twin 1/2: `npm run bot1` / `npm run bot2`
- Vote Pipeline: `npm run vote`
