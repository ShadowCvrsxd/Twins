
# Twins API Fix Plan

## Todos
- [ ] 1. Scaffold API infrastructure in tg-hub.js (port 8089) with token auth check. Recommended task executor category: unspecified-low
- [ ] 2. Implement /gentoken <botName> command in tg-hub.js. Recommended task executor category: quick
- [ ] 3. Refactor friend_dist/bridge-client.js to use HTTP POST instead of direct DB writes. Recommended task executor category: unspecified-low

## Final verification wave
- [ ] F1. Hub API (8089) auth validation logic.
- [ ] F2. Bridge client communication via HTTP POST.
