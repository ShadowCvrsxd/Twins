# Twins Bot Framework

Framework for managing Minecraft accounts ("twins") via Telegram with a distributed architecture.

## Architecture

- **Hub & Chat Bot**: Central Telegram interface (`tg-hub.js`, `tg-chat-bot.js`) deployed on VPS.
- **API Gateway & WebSocket Bridge**: Operates on port 8089 (`tg-hub.js`) for real-time command dispatch and telemetry.
- **Client Bots**: Mineflayer-based bots (`bot.js`, `bot-2.js`, `bot-main.js`) running on local client machines connecting to the Hub via WebSocket.
- **Storage**: SQLite via the builtin `node:sqlite` (`db.js`) with fallback to a JSON store.

## Backups

Daily backup of the SQLite KV DB (`twins.db`) and JSON fallback (`twins_store.json`),
keeping the last 14 `twins.db.*` copies in `backups/`.

```
cp systemd/twins-backup.service systemd/twins-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now twins-backup.timer
```

The `ExecStart` path in `twins-backup.service` must match the deploy directory (e.g. `/root/Twins`).

## Startup Commands

- `npm run hub` — Start central Telegram hub & port 8089 API/WebSocket gateway
- `npm run chat` — Start Telegram chat bot interface
- `npm run main` — Start main bot instance
- `npm run bot1` — Start Twin 1 bot (`bot.js`)
- `npm run bot2` — Start Twin 2 bot (`bot-2.js`)
- `npm run vote` — Run auto-vote / VPN pipeline (`vote_vpn.js`)

## Configuration

Copy environment template files (e.g., `.env.main.example`, `.env.twin1`, `.env.twin2`) and configure your Telegram tokens, server endpoints, and authentication tokens.

### Environment variables

- `TG_BOT_TOKEN` — Telegram bot token used by the Hub. Required to start the Hub.
- `TG_CHAT_BOT_TOKEN` — separate Telegram bot token for the chat bot (`tg-chat-bot.js`), so it does not share `getUpdates` with the Hub.
- `HUB_API_TOKEN` — **dedicated bearer token for the Hub's HTTP API on port 8089** (`/state`, `/command`). This is the only HTTP credential: Telegram tokens are no longer accepted as HTTP bearers. If unset, the chat bot logs `[API] HUB_API_TOKEN not set` and skips its HTTP calls.
- `MEDIA_BASE_URL` — публичная база вида `http://<VPS_IP>:8089`; без неё аплоад гифок выключен (500). Файлы отдаются хабом по `MEDIA_BASE_URL/media/<name>.<ext>`.
- `bot_tokens` (stored via `db.js`, not env) — per-bot tokens accepted only on `/command`, scoping the caller to its own bot.
- `DEBUG_WS=1` — подробный дамп WS-команд в лог (по умолчанию выкл).

### Chat Bot Features

- Гифки из ТГ → ссылка uguu.se (живёт ~3 ч, эмбеддится в ДС); при недоступности uguu — вечная ссылка с нашего хаба (`MEDIA_BASE_URL/media/…`).
- mp4-«анимации» автоматически конвертируются в настоящий GIF (ffmpeg, 15s/480px/15fps потолки); для конвертации пакет `ffmpeg` должен быть установлен на хосте — без него mp4 уходит как есть.