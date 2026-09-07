require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { getMainAccount, getTwinks } = require('./utils.js');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('[AutoVote] ❌ GEMINI_API_KEY не задан в .env');
  process.exit(1);
}

function loadProxies() {
  const proxyFile = path.join(__dirname, 'proxies.txt');
  if (!fs.existsSync(proxyFile)) return [];
  return fs.readFileSync(proxyFile, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

async function solveCaptcha(imageBuffer) {
  const base64Image = imageBuffer.toString('base64');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: "На картинке изображены цифры капчи. Верни только эти цифры слитно, без пробелов и любого лишнего текста." },
          { inline_data: { mime_type: "image/png", data: base64Image } }
        ]
      }]
    })
  });
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? text.trim().replace(/[^0-9]/g, '') : null;
}

async function voteForAccount(nickname, proxyLine) {
  console.log(`[AutoVote] 🚀 Голосуем за ник: ${nickname} через прокси: ${proxyLine || 'без прокси (прямой IP)'}`);

  const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  let proxyAuth = null;

  if (proxyLine) {
    const parts = proxyLine.split(':');
    if (parts.length >= 2) {
      const hostPort = `${parts[0]}:${parts[1]}`;
      launchArgs.push(`--proxy-server=${hostPort}`);
      if (parts.length >= 4) {
        proxyAuth = { username: parts[2], password: parts[3] };
      }
    }
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: launchArgs
  });

  try {
    const page = await browser.newPage();
    if (proxyAuth) {
      await page.authenticate(proxyAuth);
    }

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto('https://hotmc.ru/vote-240885', { waitUntil: 'networkidle2', timeout: 30000 });

    // 1. Вводим ник
    await page.waitForSelector('input[placeholder="Ник в Майнкрафт"]', { timeout: 10000 });
    await page.type('input[placeholder="Ник в Майнкрафт"]', nickname);

    // 2. Делаем скриншот капчи
    const captchaImg = await page.$('.form-group img, img[src*="captcha"], img');
    if (!captchaImg) {
      throw new Error('Не удалось найти изображение капчи');
    }
    const captchaBuffer = await captchaImg.screenshot();

    // 3. Распознаем через Gemini
    const code = await solveCaptcha(captchaBuffer);
    console.log(`[AutoVote] (${nickname}) Распознанный код капчи: ${code}`);

    if (!code || code.length < 3) {
      throw new Error(`Не удалось распознать капчу: "${code}"`);
    }

    // 4. Вводим код
    await page.type('input[placeholder*="Введите код"]', code);

    // 5. Кликаем кнопку
    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('button, a, input, div'));
      const btn = elements.find(el => el.textContent.includes('Отдать серверу голос') || el.value?.includes('Отдать серверу голос'));
      if (btn) btn.click();
    });

    await new Promise(r => setTimeout(r, 5000));
    console.log(`[AutoVote] ✅ Голос за ${nickname} успешно отправлен!`);
    return true;
  } catch (err) {
    console.error(`[AutoVote] ❌ Ошибка для ${nickname}:`, err.message);
    return false;
  } finally {
    await browser.close();
  }
}

async function runAll() {
  const accounts = [getMainAccount(), ...getTwinks()];
  const proxies = loadProxies();

  console.log(`[AutoVote] Аккаунты для голосования: ${accounts.join(', ')}`);
  console.log(`[AutoVote] Загружено прокси: ${proxies.length}`);

  for (let i = 0; i < accounts.length; i++) {
    const nick = accounts[i];
    const proxy = proxies.length > 0 ? proxies[i % proxies.length] : null;
    
    await voteForAccount(nick, proxy);
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('[AutoVote] Все голосования завершены.');
}

runAll();
