# Twins Bot Framework

A distributed Minecraft multi-account ("twins") framework controlled entirely from Telegram. A central hub on a VPS relays commands and chat to Mineflayer-based client bots running on local machines, so every account can be driven, watched and duplicated from one chat window.

## Features

- **Telegram command control** — bind twins and the main account, start/stop them, chat, spam, autoclick and more, all via hub commands (see the command reference below).
- **Per-twin chat duplication with auto-failover** — when a twin's streaming flag is on but that twin goes offline, the hub automatically streams the chat through an approved sibling twin of the same owner whose own streaming flag is off (the sender must be in `links_approved`). When the original twin reconnects, duplication reverts to it. No configuration needed; the switch is logged to the hub console only. Implemented hub-side in `relayChatToTelegram` (`utils.js`).
- **Main-account streaming** — duplicate the main account's chat (mentions only, or the whole chat with `/mainstreamallon`). Incoming DMs (`✉️`) also mention the chat owner (`@username`, or a `tg://user?id=` link when no username is available), and twin-authored lines are not duplicated when that twin's own stream already delivers them.
- **Auto-respect** — `/autorepon` / `/autorepoff` per twin; its cooldown is parsed automatically from server messages (`parseCooldown`), not set manually.
- **Spam scheduler** — timed repeating chat tasks per alias (`/addspam`, `/delspam`, `/spamlist`, `/stopspam`).
- **Telegram media relay** — GIFs from Telegram are uploaded to uguu.se (live ~3 h, embeddable in Discord); if uguu is unavailable, the hub serves the file itself via `MEDIA_BASE_URL/media/<name>.<ext>`. mp4 "animations" are converted to real GIFs with ffmpeg (15 s / 480 px / 15 fps caps); without ffmpeg installed the mp4 is sent as is.
- **Reconnect watchdog** — client bots keep watch on the WebSocket bridge and re-join the server after drops.
- **`/status`** — one command lists every bound bot and whether it is online.

## Architecture

Mirrors [TWINS_ARCHITECTURE.md](TWINS_ARCHITECTURE.md):

- **Hub & API Gateway (port 8089)** — `tg-hub.js` exposes an HTTP API and WebSocket server, routing between Telegram users and remote Minecraft client bots.
- **Telegram interfaces** — `tg-hub.js` (central control + gateway) and `tg-chat-bot.js` (chat bot, forwards user commands to `http://localhost:8089/command`).
- **Remote client bots** — `bot.js`, `bot-2.js`, `bot-main.js`: Mineflayer instances connected to the hub's WebSocket bridge.
- **Authentication & security** — client connections and API endpoints authenticate via bearer tokens validated against the hub's registry; credentials stay isolated on the client machines.
- **Decoupling** — no file queues or database polling for real-time commands; everything flows through the port 8089 WebSocket/HTTP bridge.

## Requirements

- **Node.js ≥ 22.5 recommended** — storage uses the built-in `node:sqlite` (`db.js`); on older Node versions the framework automatically falls back to a JSON store.
- **ffmpeg** (optional) — needed on the hub host for mp4 → GIF conversion of Telegram media.

## Install

```
npm install
```

## Configuration

Copy the templates and fill in your credentials:

```
cp .env.client .env          # client machine (bot)
cp .env.twin.example .env    # hub-side twin config template
```

Never commit real `.env*` files; the committed templates (`.env.example`, `.env.twin.example`, `.env.client`) are the reference.

### Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `TG_BOT_TOKEN` | hub, client bots | Telegram bot token for the hub. |
| `TG_CHAT_BOT_TOKEN` | chat bot, hub | Separate Telegram bot token for `tg-chat-bot.js`, so it does not share `getUpdates` with the hub. |
| `HUB_API_TOKEN` | hub, chat bot | Dedicated bearer token for the hub's HTTP API on port 8089 (`/state`, `/command`). The only HTTP credential; Telegram tokens are not accepted as HTTP bearers. If unset, the chat bot logs `[API] HUB_API_TOKEN not set` and skips its HTTP calls. |
| `HUB_PORT` | hub, client bots | Port of the hub's HTTP/WebSocket gateway (default `8089`). |
| `HUB_WS_URL` | client bots | Full WebSocket URL of the hub (e.g. `ws://<ip>:8089` or `wss://<ip>.nip.io`); overrides `HUB_HOST`/`HUB_PORT` when set. |
| `HUB_BIND` | hub | Bind address of the gateway. Set to `127.0.0.1` when proxying through nginx/TLS. |
| `MEDIA_BASE_URL` | hub | Public base URL of the hub (e.g. `http://<VPS_IP>:8089`). Without it, GIF uploads are disabled (HTTP 500); files are served at `MEDIA_BASE_URL/media/<name>.<ext>`. |
| `TWINKS` | client bots | Comma-separated list of twin nicknames this client controls. |
| `MAIN_ACCOUNT` | client bots | Nickname of the main account. |
| `DEBUG_WS` | client bots | Set to `1` for verbose WebSocket command dumps in the log (off by default). |
| `DB_PATH` | `db.js` | Path to the SQLite KV database (default `twins.db`). |
| `DB_JSON_PATH` | `db.js` | Path to the JSON fallback store (default `twins_store.json`). |
| `USER_SYSTEMD` | hub | Set to `true` so `/startmain`/`/stopmain` use `systemctl --user` instead of `sudo systemctl`. |

Client-only variables from the templates: `USERNAME`, `PASSWORD` (Minecraft credentials), `MINECRAFT_HOST`, `MINECRAFT_PORT` (server to join), `HUB_HOST` (hub IP/domain), `BOT_TOKEN` (per-bot bearer token issued by the hub), plus `HUB_PORT`, `MAIN_ACCOUNT`, `TWINKS` above. The hub-side template also carries `ADMIN_TG_ID` (admin Telegram ID).

**Warn-once behavior:** if `TWINKS` or `MAIN_ACCOUNT` is unset, the affected feature disables itself with a one-time console warning (warn-once getters in `utils.js`). Nick defaults are intentionally gone — configuration comes from the environment only.

## Startup commands

| Command | What it does |
|---|---|
| `npm run hub` | Start the central Telegram hub and the port 8089 API/WebSocket gateway (`tg-hub.js`). |
| `npm run chat` | Start the Telegram chat bot interface (`tg-chat-bot.js`). |
| `npm run main` | Start the main-account bot (`bot-main.js`). |
| `npm run bot1` | Start Twin 1 (`bot.js`). |
| `npm run bot2` | Start Twin 2 (`bot-2.js`). |
| `npm run vote` | Run the Gemini captcha worker (`vote.js`): watches the working folder for captcha screenshots (`*captcha*.png/jpg`) and solves them via the Gemini API. Requires `GEMINI_API_KEY` in the environment. |
| `node auto_vote.js` | Direct-invocation extra (not an npm script): standalone auto-voting pipeline with Cloudflare cookie handling and Gemini captcha entry, per nickname. |

## Telegram command reference

### Hub commands (`tg-hub.js`)

| Command | Description |
|---|---|
| `/start` | Main menu: registration + full command list. |
| `/addmain <ник>` / `/delmain <ник>` | Bind / unbind the main-account bot. |
| `/addtwin <ник>` (alias `/link`) / `/deltwin <ник>` (alias `/removetwin`) | Bind / unbind a twin. |
| `/resettoken` | Re-issue the bot token. |
| `/alias <бот> <алиас>` / `/unalias <алиас>` | Set / remove an alias. |
| `/starttwin <алиас>` (alias `/on`) / `/stoptwin <алиас>` (alias `/off`) | Start / stop a twin. |
| `/startmain` (alias `/mainon`) / `/stopmain` (alias `/mainoff`) | Start / stop the main bot. |
| `/status` (alias `/list`) | List bound bots and their status. |
| `/chat <алиас> <текст>` | Send a chat message in game. |
| `/players <бот>` (alias `/tab`) | List players online. |
| `/pos <алиас>` | Coordinates of a twin. |
| `/meowon <алиас>` / `/meowoff <алиас>` / `/meowcd <алиас> <время>` | Meowing on/off and its cooldown. |
| `/autorepon <алиас>` / `/autorepoff <алиас>` | Auto-respect on/off. |
| `/autoclickon <алиас>` / `/autoclickoff <алиас>` | Autoclicker on/off. |
| `/setswing <алиас> <мс\|auto>` | Swing timing. |
| `/spamlist <алиас>` / `/addspam <алиас> <сек> <текст>` / `/delspam <алиас> <номер>` / `/stopspam` | Spam scheduler management. |
| `/mainstreamon` / `/mainstreamoff` | Main-chat duplication (mentions only) on/off. |
| `/mainstreamallon` / `/mainstreamalloff` | Duplicate the ENTIRE main chat on/off. |
| `/voice <1\|2> <on\|off\|reconnect\|channel\|status>` | Discord voice control. |
| `/dropall <ник\|алиас>` | Throw away the twin's entire inventory (tosses every stack); replies with the list of dropped items. |
| `/gentoken` | Generate a token (handler; not in the menu). |
| `/lock` (alias `/adminlock`) / `/unlock` (alias `/adminunlock`) | Lock / unlock registration (admin). |
| `/users` (alias `/adminusers`) | List users (admin). |
| `/testserver` (alias `/movetest`) / `/mainserver` (alias `/prodserver`) | Switch to the test / main server (admin). |
| `/setserver <ip> <port>` | Change the server (admin; advertised in the menu). |
| `/setservice <ник> <сервис>` | Bind a bot to a service. |

### Chat-bot commands (`tg-chat-bot.js`)

| Command | Description |
|---|---|
| `/setchat` | Bind this chat for duplication output. |
| `/start` | Menu / help. |
| `/globalon` / `/globaloff` | Global duplication on/off. |
| `/streamon` (alias `/chaton`) / `/streamoff` (alias `/chatoff`) | Per-twin chat streaming on/off (the flag the failover logic reads). |
| `/display` (alias `/mode`) | Toggle display mode. |
| `/status` (alias `/list`) | Current streaming status. |

## Testing

Run the full suite (13 test files) before every commit and keep it green:

```
for f in test/*.test.js; do DB_PATH=/tmp/x-$f.db node "$f"; done
```

## Backups

Daily backup of the SQLite KV DB (`twins.db`) and JSON fallback (`twins_store.json`),
keeping the last 14 `twins.db.*` copies in `backups/`.

```
cp systemd/twins-backup.service systemd/twins-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now twins-backup.timer
```

The `ExecStart` path in `twins-backup.service` must match the deploy directory (e.g. `/root/Twins`).

## TLS (optional, nginx + nip.io)

Serve the public API/WS over HTTPS/WSS without buying a domain. `nip.io`/`sslip.io` is a free wildcard DNS that resolves your IP from the hostname.

1. `apt-get install -y nginx certbot python3-certbot-nginx`
2. nginx: server with `server_name <IP>.nip.io`; `nginx -s reload`
3. Certificate: `certbot --nginx -d <IP>.nip.io`
4. In the 443 block, proxy to the local hub (`Upgrade`/`Connection` are required for wss):
   ```
   proxy_pass http://127.0.0.1:8089;
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   proxy_set_header Host $host;
   ```
5. Flip the env: hub gets `HUB_BIND=127.0.0.1` and `MEDIA_BASE_URL=https://<IP>.nip.io`; clients get `HUB_WS_URL=wss://<IP>.nip.io`
6. `ufw deny 8089; ufw allow 443,80/tcp` (if ufw is in use)
7. Restart the hub and client bots AT THE SAME TIME — clients on plain `ws://<IP>:8089` will drop after `HUB_BIND`

Rollback: unset `HUB_BIND` → port 8089 is exposed again, as before.

Discord embeds are unchanged — uguu.se stays the primary source (the hub's raw domain does not embed); HTTPS here is for WS/API and token security.
