# Multi-bot Chat Selection (Scaffold)

## Overview
Enable granular control over which bot receives chat messages from Telegram, moving away from "all online bots" to a selective model.

## Requirements
1.  **Command:** `/setchat <1|2|main>` to set the active chat target for a user.
2.  **Status:** Verify target bot status using the `bots_status` file.
3.  **Logic:** Update `tg-chat-bot.js` polling loop:
    *   Parse messages as commands (`/setchat`).
    *   Persist selection (`chat_chat_target` or similar).
    *   Validate bot online status before queuing to `bot_commands`.

## Implementation Plan

### 1. Persistence
*   Define a new key in `db.js` (e.g., `chat_chat_targets`) to store `chatId -> targetBot`.
*   Initialize `chat_chat_targets` via `readJSON` function if needed.

### 2. Command Processing (`tg-chat-bot.js`)
*   Add `/setchat <target>` command handler.
    *   `target` can be `1`, `2`, or `main`.
    *   Map `target` to actual bot name.
    *   Validate target bot belongs to user.
    *   Save mapping to `chat_chat_targets`.
    *   Inform user of change.

### 3. Polling Loop Update (`tg-chat-bot.js`)
*   In the non-command message processing block:
    *   Retrieve `targetBot` from `chat_chat_targets` for the `chatId`.
    *   If no target set, default to existing behavior (first online bot) or ask to set one.
    *   Check `STATUS_FILE` for `targetBot` status.
    *   If offline, inform user and *do not queue*.
    *   If online, queue message to `bot_commands` specifically for `targetBot`.

## Intent Routing
- **Status:** CLEAR
- **Action:** No peer review required.

## Tasks
- [ ] Implement `chat_chat_targets` storage in `db.js` (or `tg-chat-bot.js`).
- [ ] Add `/setchat` handler in `tg-chat-bot.js`.
- [ ] Update message processing logic in `poll()` to use stored target.
- [ ] Add online check for target bot in `poll()`.
