const path = require('path')
const dotenv = require('dotenv')

const instance = process.argv[2]
if (instance !== '1' && instance !== '2') {
  console.error(`[Discord Bot ?] ${new Date().toISOString()} Ошибка: аргумент экземпляра должен быть 1 или 2 (пример: node discord-voice.js 1)`)
  process.exit(2)
}

function log(msg, isError = false) {
  const prefix = `[Discord Bot ${instance}] ${new Date().toISOString()}`
  if (isError) console.error(prefix, msg)
  else console.log(prefix, msg)
}

const envPath = path.resolve(__dirname, `.env.discord${instance}`)
const config = dotenv.config({ path: envPath })

if (config.error) {
  log(`Ошибка: файл .env.discord${instance} не найден. Создай его с DISCORD_TOKEN и DISCORD_CHANNEL_ID.`, true)
  process.exit(3)
}

const TOKEN = process.env.DISCORD_TOKEN
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID

if (!TOKEN || !CHANNEL_ID) {
  log(`Ошибка: DISCORD_TOKEN или DISCORD_CHANNEL_ID не заданы в .env.discord${instance}`, true)
  process.exit(3)
}

const { get } = require('./db.js')
const { Client } = require('discord.js-selfbot-v13')
const VoiceConnection = require('discord.js-selfbot-v13/src/client/voice/VoiceConnection')

VoiceConnection.prototype.selfMute = function(val) {
  return this.sendVoiceStateUpdate({ self_mute: val })
}
VoiceConnection.prototype.selfDeaf = function(val) {
  return this.sendVoiceStateUpdate({ self_deaf: val })
}

let currentConnection = null
let connectedChannelId = null

function getSettings() {
  const dbSettings = get(`discord_voice_${instance}`, {})
  return {
    enabled: dbSettings.enabled !== undefined ? dbSettings.enabled : true,
    reconnect: dbSettings.reconnect !== undefined ? dbSettings.reconnect : true,
    channel_id: dbSettings.channel_id || CHANNEL_ID
  }
}

function leaveVoice(reason) {
  if (currentConnection) {
    try {
      currentConnection.disconnect()
    } catch (e) {}
    currentConnection = null
    connectedChannelId = null
    log(`Выход из войса (${reason}).`)
  }
}

log('Подключение к Discord Gateway...')
const client = new Client({ checkUpdate: false })

client.on('error', e => log(`Ошибка клиента: ${e.message}`, true))

async function retryJoin() {
  const settings = getSettings()
  if (!settings.enabled || !settings.reconnect) {
    log('Автореконнект отключен, останавливаюсь.')
    return
  }
  log('Повторная попытка подключения к войсу через 10 сек...')
  setTimeout(joinVoice, 10000)
}

async function joinVoice() {
  const settings = getSettings()
  if (!settings.enabled) {
    log('Войс отключен, пропускаю подключение.')
    return
  }
  try {
    const targetChannelId = settings.channel_id
    const channel = await client.channels.fetch(targetChannelId)
    if (!channel || !channel.isVoice()) {
      log(`Канал ${targetChannelId} не является голосовым`, true)
      return retryJoin()
    }
    if (!channel.join) {
      channel.join = () => client.voice.joinChannel(channel, { selfMute: true, selfDeaf: true })
    }
    const connection = await channel.join()
    await connection.selfMute(true)
    await connection.selfDeaf(true)
    currentConnection = connection
    connectedChannelId = targetChannelId
    log('Успешно в войсе, полный мут.')

    connection.once('disconnect', () => {
      currentConnection = null
      connectedChannelId = null
      log('Потеряно соединение с войсом, переподключение...')
      const curSettings = getSettings()
      if (curSettings.enabled && curSettings.reconnect) {
        retryJoin()
      } else {
        log('Автореконнект отключен, останавливаюсь.')
      }
    })
  } catch (err) {
    log(`Ошибка входа в войс: ${err.message}`, true)
    retryJoin()
  }
}

client.on('ready', async () => {
  log(`Авторизован как ${client.user.tag}`)
  await joinVoice()
})

setInterval(async () => {
  if (!client.user) return
  const settings = getSettings()
  if (settings.enabled && !currentConnection) {
    await joinVoice()
  } else if (settings.enabled && currentConnection && settings.channel_id !== connectedChannelId) {
    leaveVoice('Смена канала')
    await joinVoice()
  } else if (!settings.enabled && currentConnection) {
    leaveVoice('Отключено через Telegram')
  }
}, 5000)

client.login(TOKEN).catch(err => {
  log(`Ошибка входа (login): ${err.message}`, true)
  process.exit(1)
})
