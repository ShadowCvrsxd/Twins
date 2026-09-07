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
  console.log(`[AutoVote] 🚀 Голосуем за ник: ${nickname} через прокси: ${proxyLine || 'без прокси (прямой IP / VPN)'}`);

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
    
    console.log('[AutoVote] Переходим на страницу HotMC...');
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

    // Скриншот перед отправкой
    await page.screenshot({ path: path.join(__dirname, `debug_${nickname}_before_submit.png`) });

    // 5. Кликаем кнопку отправки
    console.log('[AutoVote] Нажимаю кнопку отправки голоса...');
    const clicked = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('button, a, input, div'));
      const btn = elements.find(el => el.textContent.includes('Отдать серверу голос') || el.value?.includes('Отдать серверу голос'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      // Попробуем нажать через клик по селектору или submit формы
      await page.click('button[type="submit"], input[type="submit"], .btn-primary, .btn');
    }

    // Ждем реакции страницы (навигации или появления сообщения)
    await new Promise(r => setTimeout(r, 6000));

    // Скриншот после отправки
    await page.screenshot({ path: path.join(__dirname, `debug_${nickname}_after_submit.png`) });

    // Проверяем текст на странице на наличие ошибок или успеха
    const pageText = await page.evaluate(() => document.body.innerText);
    console.log(`[AutoVote] Текст на странице после отправки (первые 300 символов):`, pageText.replace(/\s+/g, ' ').substring(0, 300));

    console.log(`[AutoVote] ✅ Процесс для ${nickname} завершен.`);
    return true;
  } catch (err) {
    console.error(`[AutoVote] ❌ Ошибка для ${nickname}:`, err.message);
    return false;
  } finally {
    await browser.close();
  }
}

async function run() {
  const targetNick = process.argv[2];
  if (targetNick) {
    await voteForAccount(targetNick, null);
  } else {
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
}

run();
