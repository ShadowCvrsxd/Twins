# fix-main-chat-mention-parsing - Work Plan

## Goal
В `sendMainTelegramNotification` (utils.js):
1. Режим `main_chat_stream_all[chatId]=ON` → стримить ВСЁ (фильтр упоминаний мейна автоматически отключён).
2. Режим `main_chat_stream_all[chatId]=OFF` (только упоминания) → слать только сообщения, содержащие ник мейна, НО исключать сообщения, начинающиеся с ника твинка (их ники содержат ник мейна → ложный триггер).

## Scope
- `utils.js` — только функция `sendMainTelegramNotification`.

## Факты из кода
- `sendMainTelegramNotification` (utils.js:127-152): цикл по `approved`, `if (!streaming[chatId]) continue; if (!streamAll[chatId] && !cleanedText.toLowerCase().includes(mainNick)) continue;` → fetch.
- `getTwinks()` возвращает массив ников твинков (utils.js:15-17), по умолчанию `['AlexZTI_Twin', 'AlexZTI_Twin1']`.
- Сообщение-сырец: `ᴅ |  AlexZTI_Twin › мяу` — sender в начале строки. `cleanedText` = результат `cleanMinecraftText`.
- Ложный триггер: `'ᴅ |  AlexZTI_Twin › мяу'.includes('alexzti_')` → true, т.к. ник твинка начинается с ника мейна.

## Todos
- [x] 1. utils.js: в `sendMainTelegramNotification` рассчитать `const isTwinMsg = getTwinks().some(t => cleanedText.toLowerCase().startsWith(t.toLowerCase()));` — и внутри цикла заменить условие на: `if (!streamAll[chatId]) { const isMention = cleanedText.toLowerCase().includes(mainNick); if (!isMention || isTwinMsg) continue; }`.
- [x] 2. Верификация: `node --check utils.js`, пробник (OFF: твинк-сообщение → игнор, мейн-упоминание → шлём; ON: твинк-сообщение → шлём), коммит `fix(tg): exclude twin messages from main mention stream` → push.

## Acceptance
- `streamAll=OFF`: `AlexZTI_Twin › мяу` НЕ уходит с тегом [мейн]; сообщение, где мейн реально упомянут — уходит.
- `streamAll=ON`: всё уходит (фулл-режим не тронут).