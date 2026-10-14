# Plan: Refactor Bot Commands to Use WebSocket State Transfer

## Goal
Eliminate dependency on local SQLite/JSON database on the bot client side for commands like `/meow`, `/autorep`, `/autoclick`. Instead, transfer the state directly over WebSocket from `tg-hub.js` to the bot.

## Steps
- [x] 1. Modify `tg-hub.js` command handlers to send JSON state objects (e.g., `{ action: 'meow', enabled: true }`) instead of relying on file/db state.
- [x] 2. Update `bot-base.js` command handlers to update bot state in memory when WebSocket messages are received.
- [x] 3. Ensure `/pos` and `/players` (request-response) remain operational via WebSocket.
- [x] 4. Remove all direct file/db access in bot client logic for these commands.
- [x] 5. Commit and push to `origin main`.
