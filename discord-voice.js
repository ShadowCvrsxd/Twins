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

const { Client } = require('discord.js-selfbot-v13')
const VoiceConnection = require('discord.js-selfbot-v13/src/client/voice/VoiceConnection')

VoiceConnection.prototype.selfMute = function(val) {
  return this.sendVoiceStateUpdate({ self_mute: val })
}
VoiceConnection.prototype.selfDeaf = function(val) {
  return this.sendVoiceStateUpdate({ self_deaf: val })
}

log('Подключение к Discord Gateway...')
const client = new Client({ checkUpdate: false })

client.on('error', e => log(`Ошибка клиента: ${e.message}`, true))

async function retryJoin() {
  log('Повторная попытка подключения к войсу через 10 сек...')
  setTimeout(joinVoice, 10000)
}

async function joinVoice() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID)
    if (!channel || !channel.isVoice()) {
      log(`Канал ${CHANNEL_ID} не является голосовым`, true)
      return retryJoin()
    }
    if (!channel.join) {
      channel.join = () => client.voice.joinChannel(channel, { selfMute: true, selfDeaf: true })
    }
    const connection = await channel.join()
    await connection.selfMute(true)
    await connection.selfDeaf(true)
    log('Успешно в войсе, полный мут.')

    connection.once('disconnect', () => {
      log('Потеряно соединение с войсом, переподключение...')
      retryJoin()
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

client.login(TOKEN).catch(err => {
  log(`Ошибка входа (login): ${err.message}`, true)
  process.exit(1)
})
