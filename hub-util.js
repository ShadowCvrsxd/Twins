// Pure, dependency-free helpers shared by the hub and its tests.
//
// T4: /command scope — a non-system (bot) token can only ever command its own
// authorized bot; command.targetBot is honored exclusively for the system token.
function resolveCommandTarget({ isSystemToken, authorizedBot, command }) {
  return isSystemToken ? command.targetBot : authorizedBot;
}

module.exports = { resolveCommandTarget };
