require('dotenv').config();
const puppeteer = require('puppeteer');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('[AutoVote] ❌ GEMINI_API_KEY не задан в .env');
  process.exit(1);
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

async function vote(nickname) {
  console.log(`[AutoVote] Запуск голосования для ника: ${nickname}`);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('[AutoVote] Открываю страницу голосования...');
    await page.goto('https://hotmc.ru/vote-240885', { waitUntil: 'networkidle2' });

    // 1. Вводим ник
    console.log('[AutoVote] Ввожу ник...');
    await page.waitForSelector('input[placeholder="Ник в Майнкрафт"]', { timeout: 10000 });
    await page.type('input[placeholder="Ник в Майнкрафт"]', nickname);

    // 2. Находим картинку капчи и делаем её скриншот
    console.log('[AutoVote] Ищу капчу...');
    // На HotMC картинка капчи находится в блоке проверочного кода
    const captchaImg = await page.$('.form-group img, img[src*="captcha"], img');
    if (!captchaImg) {
      throw new Error('Не удалось найти изображение капчи на странице');
    }
    const captchaBuffer = await captchaImg.screenshot();

    console.log('[AutoVote] Распознаю капчу через Gemini...');
    const code = await solveCaptcha(captchaBuffer);
    console.log(`[AutoVote] Распознанный код: ${code}`);

    if (!code || code.length < 3) {
      throw new Error(`Не удалось корректно распознать капчу: "${code}"`);
    }

    // 3. Вводим код капчи
    console.log('[AutoVote] Ввожу код капчи...');
    await page.type('input[placeholder*="Введите код"]', code);

    // 4. Кликаем кнопку голосования ("Отдать серверу голос!")
    console.log('[AutoVote] Отправляю голос...');
    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('button, a, input, div'));
      const btn = elements.find(el => el.textContent.includes('Отдать серверу голос') || el.value?.includes('Отдать серверу голос'));
      if (btn) btn.click();
    });

    await new Promise(r => setTimeout(r, 5000));
    console.log('[AutoVote] Голос успешно отправлен!');
  } catch (err) {
    console.error('[AutoVote] ❌ Ошибка:', err.message);
  } finally {
    await browser.close();
  }
}

const nick = process.argv[2] || process.env.VOTE_NICKNAME || 'AlexZTI_';
vote(nick);
