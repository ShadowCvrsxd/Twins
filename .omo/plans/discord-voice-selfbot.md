# Plan: Discord Voice via selfbot-v13 (Lightpanda swap)

## Objective
Replace the Lightpanda+Puppeteer Discord voice approach (fails: Lightpanda has no WebRTC) with `discord.js-selfbot-v13` running directly in Node.js (no browser, ~30-50MB RAM per account, fits 1.5GB VPS). Keep 2 accounts (twins-discord1/2), auto-start on reboot, debug logging.

## Root cause
Lightpanda has no WebRTC engine -> Discord voice join cannot establish. Logs showed "Успешно в войсе" but user not actually in channel.

## Scope
- `package.json`: add deps `discord.js-selfbot-v13`, `@discordjs/voice`, `opusscript` (pure-JS opus, no native build). Keep puppeteer (pre-existing, not asked to remove).
- `discord-voice.js`: full rewrite. Contract:
  - argv[2] = instance `1|2`, else log error + `process.exit(2)`
  - loads `__dirname/.env.discord<instance>` via dotenv; missing file -> exit 3
  - requires `DISCORD_TOKEN` and `DISCORD_CHANNEL_ID` (channel ID, NOT url); missing -> exit 3
  - validation/exit happens BEFORE requiring discord.js-selfbot-v13 (so smokes work without login)
  - on `client.on('ready')`: log `[Discord Bot N] Авторизован как <tag>`, `channels.fetch(DISCORD_CHANNEL_ID)`, if voice channel -> `channel.join()` -> `connection.selfMute(true)` + `connection.selfDeaf(true)` -> log success
  - reconnect: on voice connection `disconnect`/error -> log + rejoin after 10s (simple retry), so long-term presence survives Discord drops
  - all logs prefixed `[Discord Bot N] <ISO timestamp>`
- `setup-systemd.sh`: remove Lightpanda download block, remove `lightpanda` service + `$5 binary` flag from create_service (restore original 3-param function), keep `twins-discord1`/`twins-discord2` (ExecStart `discord-voice.js 1|2`), enable/start lines drop `lightpanda` (keep all twins/tg services), echo lines drop lightpanda-journal mention (keep `journalctl -u twins-discord1 -f`).

## Todos
- [x] 1. `package.json`: install deps discord.js-selfbot-v13 @discordjs/voice opusscript (npm install --save) - lockfile updated, require resolves
- [x] 2. `discord-voice.js`: rewrite to selfbot-v13 per contract above - smokes pass without deps
- [x] 3. `setup-systemd.sh`: cleanup Lightpanda, keep twins-discord1/2 + full auto-start - bash -n clean
- [x] 4. QA verification: node --check, smokes (no-arg exit 2, arg 3 exit 2, fake-token config -> login attempt, NOT exit 0 before login), bash -n, grep no-lightpanda, deps present - all pass

## Final verification wave
- [x] F1. node --check discord-voice.js independent re-run - exit 0
- [x] F2. bash -n setup-systemd.sh independent re-run - exit 0
- [x] F3. git log shows commits on main; working tree has no unexpected modified tracked files