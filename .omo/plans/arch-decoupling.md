# Plan: Refactor to WebSocket-based Command Delivery

## Status
- Intent: CLEAR
- Status: Awaiting-approval
- Review required: false

## Goal
Decouple Hub and Bots by removing direct filesystem command queues (`bot_commands`, etc.) in favor of WebSocket messaging.

## Implementation Todos
- [x] 1. Identify all filesystem-based command queues in `tg-hub.js` and bot files.
- [x] 2. Update `tg-hub.js` to route all bot commands through the existing WebSocket `sendCommand` function.
- [x] 3. Update `bot-base.js` to handle commands received via WebSocket instead of polling `bot_commands` file.
- [x] 4. Remove filesystem polling logic from bot initialization.
- [x] 5. Verify that `bot_commands` file is no longer created/polled.
- [x] 6. Refactor `tg-chat-bot.js` to use WebSocket/HTTP API gateway (port 8089) for chat streaming instead of `bot_commands` file.
- [x] 7. Confirm command delivery works via WebSocket for all main functions (start/stop, spam, clicker).

## Final verification wave
- [ ] F1. Verify that `bot_commands` file is no longer created/polled.
- [ ] F2. Confirm command delivery works via WebSocket for all main functions (start/stop, spam, clicker).

## Approval Gate
- I am ready to begin implementation upon your explicit "start work".
- The implementation will be executed in a separate worker session.
