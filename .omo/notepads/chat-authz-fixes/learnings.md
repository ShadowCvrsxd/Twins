# Learnings — chat-authz-fixes

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## T1: Three pure authz helpers in `hub-util.js`

**Signatures:**
- `isBotOwnedByChat(approved, mainsApproved, chatId, botName)` — returns true iff `approved[chatId]` OR `mainsApproved[chatId]` contains `botName` case-insensitively. Handles missing/undefined maps and missing chat keys safely (returns false).
- `isChatSenderAllowed(userBots, selectedLower, { isAdminChat, mainAccount })` — returns true iff `!selectedLower`, OR `userBots` contains `selectedLower` case-insensitively, OR (`isAdminChat && mainAccount && selectedLower === mainAccount.toLowerCase()`). Handles undefined options safely.
- `evictBotSocket(clients, socket, botName)` — if `clients.get(botName.toLowerCase())` exists, calls `clients.delete(botName.toLowerCase())` THEN `socket.close()` when socket provided, returns true; else returns false. **DELETE MUST happen BEFORE close()** — verified by test spy recording call order.

All helpers are dependency-free, no env reads, exported via `module.exports` alongside existing exports.

---

## T5: Doc/menu alignment — no new handlers

**Changes:**
- README: `/setchat` row updated from "Bind this chat for duplication output" → "Select the sender bot (/setchat <1|2|main>)"
- README: Removed `/setserver <ip> <port>` and `/setservice <ник> <сервис>` rows from hub commands table entirely
- README: Updated ADMIN_TG_ID description — now states it's read by BOTH hub and chat bot (chat bot needs it for admin-only main fallback) and must be in shared `.env` on hub host
- tg-hub.js `initBotMenu()`: Deleted two menu entries for `setserver` and `setservice`
- tg-hub.js admin panel text: Removed trailing `` `/setserver <ip> <port>` - сменить сервер`` fragment
- test/chat-authz.test.js: Appended 7 static-source guard assertions (README + tg-hub.js greps) using existing `check()` pattern

**Key principle:** Documentation/menu alignment only — NO new handlers implemented for removed commands. Static source tests act as wiring guards, not behavioral proof.

---

## T3: Hub re-checks owner on system-token chat commands

**Changes:**
- `tg-hub.js`: Added `isBotOwnedByChat` import from `./hub-util.js`.
- In `/command` POST handler (lines ~52-90), after `targetBot` is resolved via `resolveCommandTarget` and before `sendCommand`: if `isSystemToken && command.action === 'chat'`, require `command.ownerChatId` to be a string; read `APPROVED_FILE` and `MAINS_APPROVED_FILE` via `readJSON`; if `!isBotOwnedByChat(approved, mainsApproved, command.ownerChatId, targetBot)` respond HTTP 403 `Forbidden` and return.
- Applied ONLY to system token — bot tokens remain pinned by `resolveCommandTarget` (T4 behavior). Non-chat actions, 401/404/413 paths unchanged.

**Test strategy (T3):**
- Static-source assertions appended to `test/chat-authz.test.js`: 7 checks verifying the import, guard placement, `ownerChatId` type check, file reads, `isBotOwnedByChat` call with correct args, and 403 response on failure.
- The behavioral proof for `isBotOwnedByChat` (foreign-owner false / real-owner true) already exists from T1 — do not duplicate.
- Bot-token callers are unaffected; they never reach this guard.

**Key principle:** The guard sits AFTER `resolveCommandTarget` but BEFORE `sendCommand`, so the target bot is known and the ownership check applies to the exact bot that will receive the command. System token (held only by `tg-chat-bot.js`) is the only path that can target arbitrary bots; bot tokens are already scope-limited by `resolveCommandTarget`.

---

## T2: Sender selection restricted to owned bots; admin-only env-main; ownerChatId passed

**Changes:**
- `tg-chat-bot.js`: Added `ADMIN_ID` from `ADMIN_TG_ID` env and `isAdminChat(chatId)` mirroring `tg-hub.js:291-295`. Admin status derives from the REAL `chatId` of the authenticated Telegram update — NEVER from a request field.
- `tg-chat-bot.js`: Imported `isChatSenderAllowed` from `./hub-util.js` (T1 helper).
- `sendToGame`: After computing `selectedLower`, guard with `isChatSenderAllowed(userBots, selectedLower, { isAdminChat: isAdminChat(chatId), mainAccount: getMainAccount() })`. Non-owner selection → `❌ Отправитель не привязан к твоему аккаунту.` and return.
- `/setchat main` branch: Replaced bare `userMains[0] || getMainAccount()` with `userMains[0] || (isAdminChat(chatId) ? getMainAccount() : null)`. Admin-only fallback for env main account.
- `/setchat` all branches: Pass chosen `resolved` through same `isChatSenderAllowed` guard before storing into `chat_sender_selection`.
- `/command` POST body: Added `ownerChatId: String(chatId)` for downstream correlation.
- Exported `decideChatSender({ userBots, selectedLower, chatId, adminId, mainAccount })` pure decision helper wrapping `isChatSenderAllowed` — enables unit testing without HTTP/DB mocks.

**Test strategy (T2):**
- Runtime behavioral: 6 `decideChatSender` cases in `test/chat-authz.test.js` proving selection decision is failure-sensitive (non-admin denied for foreign bot, allowed for own; admin allowed for mainAccount only; empty selectedLower no-op; undefined adminId = non-admin).
- Static-source assertions: 3 greps in test file verifying bare fallback removed, admin fallback present, `ownerChatId` in command body — wiring guards only, not behavioral proof.

**Key principle:** Admin status MUST come from authenticated `chatId`, never from client-supplied data. The `decideChatSender` helper isolates the pure decision for testability; the real `sendToGame` uses `isChatSenderAllowed` directly with live `chatId`.
