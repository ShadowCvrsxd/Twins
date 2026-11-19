# Twins Bot Architecture

## 1. Overview

Twins is a distributed Minecraft multi-account control framework. A central Hub runs on a VPS together with the Telegram interfaces and storage; the Minecraft processes may run on the same host or on a remote client machine (for example a Windows PC) that reaches the Hub over a WebSocket bridge. The optional remote client only needs outbound access to the Hub port and a valid token.

Hostnames, addresses and ports described below are deployment-specific. `HUB_PORT` defaults to `8089`, `HUB_HOST` defaults to `localhost` and `HUB_WS_URL` overrides the full WebSocket URL. A TLS-terminating reverse proxy in front of the Hub is optional and not enabled by the code itself: without a proxy, clients connect with `ws://`; with one, `HUB_WS_URL=wss://...`.

## 2. Key Components

### Hub and API gateway (`tg-hub.js`)

- One HTTP server and one WebSocket server share a single port, `HUB_PORT` (default `8089`) (`tg-hub.js:140`). Binding is controlled by `HUB_BIND` (`tg-hub.js:142`).
- HTTP surface:
  - `/command` — dispatch a JSON command to a bot (`tg-hub.js:52`).
  - `/state` — read/write hub state, restricted to an explicit key allowlist (`tg-hub.js:41`, `tg-hub.js:108`).
  - `/media-upload` and `/media/<name>` — optional media hosting (`tg-hub.js:48`, `tg-hub.js:50`).
- Request bodies are capped at 64 KiB by `isOversizedBody` (`hub-util.js:135`).
- WebSocket connections carry commands and telemetry with the remote bot processes. The connection handler requires a `?bot=<name>` query parameter and resolves the bot to an owner through `links_approved` / `mains_approved` (`tg-hub.js:164`). A heartbeat terminates unresponsive sockets.
- `sendCommand` writes a JSON command frame to the socket registered for the target bot (`tg-hub.js:271`).

The current `/state` allowlist is: `links_approved`, `mains_approved`, `bots_status`, `chat_streaming`, `bot_aliases`, `chat_display_mode`, `chat_global_mode`, `chat_sender_selection` (`tg-hub.js:41`).

### Telegram interfaces

- The Hub control bot (`tg-hub.js`) uses the main Telegram bot token (`TG_BOT_TOKEN`).
- The chat interface is a separate process, `tg-chat-bot.js`, with its own token (`TG_CHAT_BOT_TOKEN`). It refuses to start when that token is missing, specifically to avoid two processes consuming the same `getUpdates` stream (`tg-chat-bot.js:19`).
- The chat bot reads and writes Hub state over loopback HTTP. Its `/state` call targets the default port explicitly (`tg-chat-bot.js:46`), so non-default deployments must either keep the default port or provide a local proxy; `HUB_PORT` also controls its media-upload call (`tg-chat-bot.js:24`, `tg-chat-bot.js:271`).
- Chat duplication flags are toggled by `/streamon` and `/streamoff`, which write `chat_streaming[chatId][bot]` (`tg-chat-bot.js:539`, write at `tg-chat-bot.js:558`).

### Client bots (`bot.js`, `bot-2.js`, `bot-main.js`)

The three entry points are thin wrappers over the shared Mineflayer runtime in `bot-base.js` (`bot.js:1`, `bot-2.js:1`, `bot-main.js:2`). Each process loads its own environment file and runs one Minecraft account.

- The WebSocket URL is `HUB_WS_URL` when set, otherwise `ws://HUB_HOST:HUB_PORT?bot=<name>` (`bot-base.js:312`).
- On socket open the bot immediately sends the auth frame (`bot-base.js:340`).
- All Hub traffic goes through `sendToHub`, which drops frames when the socket is not open (`bot-base.js:283`).
- `bot-main.js` marks its chat frames with `isMain: true`; the twins send ordinary twin chat frames (`bot-base.js:908`).

### Storage (`db.js`)

State is a single key/value store backed by SQLite through the built-in `node:sqlite` module (`db.js:8`), stored in `twins.db` by default. If `node:sqlite` is unavailable, the module falls back to the JSON store `twins_store.json` (`db.js:13`). Hub, chat bot and clients all use the same `get`/`set` interface, so the storage engine is an implementation detail.

### Media hosting (optional)

`/media-upload` requires the `HUB_API_TOKEN` bearer token and a configured `MEDIA_BASE_URL`; without the latter it answers `500` (`hub-util.js:57`, `hub-util.js:68`). Uploaded files are returned as `${MEDIA_BASE_URL}/media/<name>` (`hub-util.js:102`), and downloads are restricted to safe names ending in `.gif` or `.mp4` (`hub-util.js:109`). This feature is environment-dependent, not part of the command path.

### Discord voice (`discord-voice.js`, auxiliary)

A standalone helper for Discord voice, outside the Hub/WS path. It is started as `node discord-voice.js <1|2>` and reads per-instance credentials from `.env.discord<instance>` (`discord-voice.js:16`, `discord-voice.js:24`). It shares only the database helper, not the Hub socket.

### Backups

A systemd timer triggers a daily database backup at 04:00 (`systemd/twins-backup.timer:5`) by running `scripts/backup-db.sh` (`systemd/twins-backup.service:6`). The `ExecStart` path is deploy-specific and must match the installation directory.

## 3. WebSocket Protocol

All frames are JSON text. The connection URL is `ws://<host>:<port>?bot=<name>` (or `wss://` behind an external TLS proxy); the bot name must already be bound to a Telegram owner in `links_approved` or `mains_approved` (`tg-hub.js:164`).

### Authentication handshake

The first frame from a client must be:

```json
{ "type": "auth", "token": "<user_token>" }
```

The Hub compares it with `user_tokens[ownerId]`, where `ownerId` was resolved from the bot name on connect. A mismatch or a non-auth first frame closes the socket; an authenticated socket that does not complete this within 5 seconds is also closed (`tg-hub.js:216`).

### Client-to-Hub messages

| Frame | Shape | Hub behavior |
|---|---|---|
| Chat | `{ "type": "chat", "text": "<line>", "isMain": false }` | Routed to the chat duplication pipeline (`tg-hub.js:237`). `action: "chat"` is accepted as an alias. |
| Response | `{ "type": "response", "text": "<text>", "chatId": "<id>" }` | Forwarded to Telegram; `chatId` falls back to the socket owner (`tg-hub.js:245`, `utils.js:267`). |
| Status | `{ "type": "status", "online": true, "username": "<nick>" }` | Written to `bots_status` (`tg-hub.js:250`). |

`action: "response"` is also accepted.

### Hub-to-client

Commands are arbitrary JSON objects sent by `sendCommand` to the socket of the named bot (`tg-hub.js:271`). The client runtime interprets them; the Hub does not persist them.

### Authorization model

- WebSocket: one token per Telegram owner, matched against `user_tokens` at handshake (`tg-hub.js:217`). The bot name, and therefore the owner scope, is fixed for the life of the socket.
- HTTP `/command`: `HUB_API_TOKEN` acts as the system token and may address any bot. Per-bot `bot_tokens` are scoped: `resolveCommandTarget` forces a bot token to its own bot and only honors `command.targetBot` for the system token (`hub-util.js:8`, `tg-hub.js:78`).
- HTTP `/state`: only `HUB_API_TOKEN` is accepted (`tg-hub.js:97`), followed by the key allowlist. Telegram bot tokens are not HTTP credentials.
- Media upload: `HUB_API_TOKEN` bearer (`hub-util.js:57`).

Minecraft credentials never reach the Hub; clients hold them locally and send only their bridge token (`user_tokens` entry) over WS.

## 4. Chat Duplication Pipeline

1. The Minecraft runtime sees a chat line and sends it to the Hub as a chat frame; login/register prompts are filtered out (`bot-base.js:908`).
2. The Hub routes the frame to `relayChatToTelegram` with `ownerId`, `botName`, `text` and `isMain` (`tg-hub.js:237`).
3. The relay cleans the text and discards empty lines, then branches on `isMain` (`utils.js:186`).
4. For a twin message, the gate reads `chat_streaming[ownerId]`. The bot's own flag enables streaming. If it is off, the gate looks for another enabled twin of the same owner that is offline according to `bots_status`; if the sender is listed in `links_approved[ownerId]`, the sender streams on the offline twin's behalf (`utils.js:219`).
5. On success the line is sent to the owner's Telegram chat with the configured `[display]` prefix (`utils.js:247`, `utils.js:249`, `tg-hub.js:28`).
6. Main-account chat uses a separate path (`main_chat_streaming` / `main_chat_stream_all`) and never participates in twin failover (`utils.js:192`).
7. With no enabled flag and no applicable failover, the line is dropped.

### Failover semantics

Chat failover keeps a single visible stream when the designated twin is offline:

- The decision is derived per message from two state keys: `chat_streaming` and `bots_status`. It is stateless; there is no persisted "failover active" key.
- Failover only applies among siblings of the same Telegram owner. The sender must be in that owner's `links_approved` list.
- It activates only when the sender's own flag is off, at least one sibling flag is on, and that enabled sibling is offline (`utils.js:230`).
- When the designated twin reconnects, `bots_status` flips online, the next message fails to satisfy the offline condition, and streaming automatically returns to the designated twin. No explicit revert command is needed.
- Exactly one bot relays per message under the normal single-designated-twin setup: the flagged-but-offline twin is not connected, and the approved sender takes over. (With 3+ twins streaming-enabled and one offline, an approved third twin may relay as well.)
- The module-level `failoverState` map only remembers the last mode per owner to emit transition logs; it does not drive the decision (`utils.js:184`, `utils.js:246`). Transitions are logged as `[Chat] failover: ...` (`utils.js:242`, `utils.js:244`).
- Failover never applies to main-account streaming, which is governed only by `main_chat_streaming` and `main_chat_stream_all` (`utils.js:192`).

## 5. Status Flow

1. On spawn/login the bot sends `{ type: 'status', online: true, username }` (`bot-base.js:788`).
2. On quit or disconnect it sends `online: false` (`bot-base.js:922`).
3. The Hub's `applyBotStatus` stores `bots_status[botName] = { online, onlineSince, username }` (`utils.js:276`), reached from the WS handler (`tg-hub.js:250`).
4. If the socket closes without a status frame, the close handler removes the current socket and records the bot offline as a fallback (`tg-hub.js:259`).
5. `/status` reads `bots_status` and renders the online/offline view for the owner (`tg-hub.js:1084`).
6. The same `bots_status` snapshot is the failover input, which is why reconnect/leave transitions restore normal streaming without extra bookkeeping (`utils.js:227`).

Status is advisory last-write-wins state. Stale entries remain in the map until the next status frame or socket close overwrites them.

## 6. Decoupling Principles

- No file-queue mechanisms or direct database polling for real-time commands.
- All real-time coordination flows through the port 8089 WebSocket/HTTP bridge.
- Chat-streaming decisions, including failover, live only Hub-side in `relayChatToTelegram`; client bots never send Telegram messages directly.
- Credentials stay separated: Minecraft accounts and their tokens remain on client machines, while the Hub only validates bridge tokens.
