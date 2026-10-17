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

module.exports = { resolveCommandTarget, shouldScheduleReconnect };
