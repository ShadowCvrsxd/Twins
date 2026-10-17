// Pure, dependency-free helpers shared by the hub and its tests.
//
// T4: /command scope — a non-system (bot) token can only ever command its own
// authorized bot; command.targetBot is honored exclusively for the system token.
function resolveCommandTarget({ isSystemToken, authorizedBot, command }) {
  return isSystemToken ? command.targetBot : authorizedBot;
}

// T10: WS reconnect guard — at most one reconnect scheduled, never while a
// socket is already open/connecting or the quit was manual.
// hubSocketState is a ws readyState: 0=CONNECTING, 1=OPEN.
function shouldScheduleReconnect({ hubSocketState, hasOpenSocket, isManualQuit, reconnectScheduled } = {}) {
  if (isManualQuit || reconnectScheduled || hasOpenSocket) return false;
  return hubSocketState !== 1 && hubSocketState !== 0;
}

// T11: drop every alias of chatId pointing (case-insensitively) at username so a
// deleted bot cannot resolve through a stale alias; mutates and returns aliases.
function removeAliasesForBot(aliases, chatId, username) {
  if (aliases[chatId]) {
    for (const [alias, realName] of Object.entries(aliases[chatId])) {
      if (realName.toLowerCase() === username.toLowerCase()) delete aliases[chatId][alias];
    }
  }
  return aliases;
}

module.exports = { resolveCommandTarget, shouldScheduleReconnect, removeAliasesForBot };
