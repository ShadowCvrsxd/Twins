
const TWINKS = ['AlexZTI_Twin', 'AlexZTI_Twin1'];
const RESPECT_COOLDOWN = 60 * 60 * 1000;

function parseCooldown(msg) {
  const match = msg.match(/через (\d+) minutes/);
  if (match) return parseInt(match[1]) * 60 * 1000;
  return RESPECT_COOLDOWN;
}

function sendResourcePackAck(client, uuid, RESOURCE_PACK_RESPONSE_NAMES, RESULT_SUCCESS) {
  for (const name of RESOURCE_PACK_RESPONSE_NAMES) {
    try {
      client.write(name, { uuid, result: RESULT_SUCCESS });
      console.log(`[Ресурспак] Фейк-успех отправлен через "${name}"`);
      return true;
    } catch (e) {}
  }
  return false;
}

module.exports = { TWINKS, RESPECT_COOLDOWN, parseCooldown, sendResourcePackAck, dropAll };

async function dropAll(bot) {
  const items = bot.inventory.items();
  if (items.length === 0) return;
  for (const item of items) {
    try {
      await bot.tossStack(item);
    } catch (err) {
      console.log(`[Ошибка] Не удалось выбросить ${item.name}: ${err.message}`);
    }
  }
}
