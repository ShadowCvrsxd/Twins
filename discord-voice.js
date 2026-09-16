const puppeteer = require('puppeteer')

function log(msg, isError = false) {
  const prefix = `[Discord Bot ${process.argv[2]}] ${new Date().toISOString()}`
  if (isError) console.error(prefix, msg)
  else console.log(prefix, msg)
}

async function main() {
  const instance = process.argv[2]
  if (instance !== '1' && instance !== '2') {
    log('Ошибка: аргумент экземпляра должен быть 1 или 2 (пример: node discord-voice.js 1)', true)
    process.exit(2)
  }

  const envPath = require('path').resolve(__dirname, `.env.discord${instance}`)
  const dotenv = require('dotenv')
  const config = dotenv.config({ path: envPath })

  if (config.error) {
    log(`Ошибка: файл .env.discord${instance} не найден. Создай его с DISCORD_TOKEN и DISCORD_VOICE_URL.`, true)
    process.exit(3)
  }

  if (!config.parsed.DISCORD_TOKEN || !config.parsed.DISCORD_VOICE_URL) {
    log(`Ошибка: DISCORD_TOKEN или DISCORD_VOICE_URL не заданы в .env.discord${instance}`, true)
    process.exit(3)
  }

  const TOKEN = config.parsed.DISCORD_TOKEN
  const CHANNEL_URL = config.parsed.DISCORD_VOICE_URL

  log('Подключение к Lightpanda CDP (http://127.0.0.1:9222)...')
  let browser
  try {
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' })
  } catch (err) {
    log(`Ошибка подключения к CDP: ${err.message}`, true)
    process.exit(1)
  }

  const page = await browser.newPage()
  await page.evaluateOnNewDocument((token) => {
    localStorage.setItem('token', '"' + token + '"')
  }, TOKEN)

  log('Открываю голосовой канал...')
  await page.goto(CHANNEL_URL, { waitUntil: 'networkidle2' })

  log('Успешно в войсе. Ожидание...')
  setInterval(() => {}, 60000)
}

main().catch((err) => {
  log(`Неожиданная ошибка: ${err.message}`, true)
  process.exit(1)
})