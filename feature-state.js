const { get, set } = require('./db.js');

const featureKeys = {
  state: (username) => `feature_state_${username.toLowerCase()}`
};

function loadFeatureState(username) {
  return get(featureKeys.state(username), {
    clicker: { enabled: false, manualCooldownMs: null },
    meow: { enabled: false, cooldownMs: 300000 }, // 5 min default
    autoRespectEnabled: false
  });
}

function saveFeatureState(username, state) {
  set(featureKeys.state(username), state);
}

function sanitizeSpamTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter(t => t && typeof t.msg === 'string' && t.msg.trim() !== '' && typeof t.delay === 'number' && t.delay > 0)
    .slice(0, 20);
}

function formatSpamList(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return "Спам не запущен.";
  return `Спам: ${tasks.map((t, i) => `${i+1}:${t.msg} - ${t.delay} сек`).join(' | ')}`;
}

module.exports = { featureKeys, loadFeatureState, saveFeatureState, sanitizeSpamTasks, formatSpamList };
