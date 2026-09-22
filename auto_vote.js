const { Agent, setGlobalDispatcher, ProxyAgent } = require('undici');
const puppeteer = require('puppeteer-core');
const proxyUrl = process.env.PROXY_URL;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[AutoVote] Использование прокси: ${proxyUrl}`);
} else {
  setGlobalDispatcher(new Agent({ connectTimeout: 180000 }));
}

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
https.globalAgent.options.timeout = 180000;
const { getMainAccount, getTwinks } = require('./utils.js');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('[AutoVote] ❌ GEMINI_API_KEY не задан в .env');
  process.exit(1);
}

async function solveCaptcha(imageBuffer) {
  const base64Image = imageBuffer.toString('base64');
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "На картинке изображены цифры капчи. Верни только эти цифры слитно, без пробелов и любого лишнего текста." },
            { inline_data: { mime_type: "image/jpeg", data: base64Image } }
          ]
        }]
      }),
      signal: AbortSignal.timeout(90000)
    });
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('[AutoVote] 🤖 Gemini сырой ответ:', JSON.stringify(text));
    return text ? text.trim().replace(/[^0-9]/g, '') : null;
  } catch (err) {
    console.error('[AutoVote] ❌ Ошибка запроса к Gemini API (возможно, нет доступа/таймаут):', err.message);
    return null;
  }
}

function extractCookies(res, existingCookies = '') {
  const cookiesMap = new Map();
  existingCookies.split(';').forEach(c => {
    const [name, ...val] = c.trim().split('=');
    if (name && val.length) cookiesMap.set(name, val.join('='));
  });

  const setCookieHeaders = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  console.log('[AutoVote] Полученные Set-Cookie заголовки:', setCookieHeaders);
  setCookieHeaders.forEach(sc => {
    if (!sc) return;
    const cookiePart = sc.split(';')[0];
    const [name, ...val] = cookiePart.trim().split('=');
    if (name && val.length) cookiesMap.set(name, val.join('='));
  });

  return Array.from(cookiesMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function voteWithBrowser(nickname) {
  console.log(`[AutoVote] 🌐 Старт голосования через браузер за ник: ${nickname}`);
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:9222' });
  const page = await browser.newPage();
  try {
    await page.goto('https://hotmc.ru/vote-240885', { waitUntil: 'networkidle2' });
    // Minimal interaction logic to mirror fetch
    const voteInput = await page.$('input[name="PlayerCollector[nickname]"]');
    if (!voteInput) throw new Error('Форма не найдена');
    await voteInput.type(nickname);

    const captchaImg = await page.$('img[src*="captcha"]');
    if (!captchaImg) throw new Error('Капча не найдена');

    const screenshot = await captchaImg.screenshot();
    const code = await solveCaptcha(screenshot);
    if (!code) throw new Error('Капча не решена');

    await page.type('input[name="CaptchaCollector[captcha]"]', code);
    await page.click('button[type="submit"]');

    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes('Спасибо за голосование') || text.includes('начислен 1 голос')) {
      console.log(`[AutoVote] 🎉 (${nickname}) Голос успешно отправлен через браузер!`);
      return true;
    }
    throw new Error('Не удалось подтвердить голосование');
  } finally {
    await page.close();
    await browser.disconnect();
  }
}

async function voteWithFetch(nickname) {
  console.log(`[AutoVote] 🚀 Старт голосования через fetch за ник: ${nickname}`);

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const browserHeaders = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"'
  };
  let cookieJar = '';

  console.log(`[AutoVote] (${nickname}) Инициализация сессии (GET)...`);
  const res1 = await fetch('https://hotmc.ru/vote-240885', {
    headers: { ...browserHeaders, 'User-Agent': userAgent },
    signal: AbortSignal.timeout(180000)
  });
  cookieJar = extractCookies(res1, cookieJar);
  const html1 = await res1.text();

  const match = html1.match(/window\.bp_chl_vars\s*=\s*({[^}]+})/);
  if (match) {
    try {
      const vars = eval("(" + match[1] + ")");
      if (vars.sec && vars.name) {
        cookieJar = extractCookies({ headers: { getSetCookie: () => [`${vars.name}=${vars.sec}; Path=/; Domain=.hotmc.ru`] } }, cookieJar);
        console.log(`[AutoVote] (${nickname}) ✅ Cloudflare bp_chl кука установлена напрямую: ${vars.name}=${vars.sec}`);
      }
    } catch (e) {
      console.error('[AutoVote] Ошибка парсинга bp_chl_vars:', e.message);
    }
  }

  console.log(`[AutoVote] (${nickname}) Куки после инициализации: ${cookieJar}`);

  const res2 = await fetch('https://hotmc.ru/vote-240885', {
    headers: {
      ...browserHeaders,
      'User-Agent': userAgent,
      'Cookie': cookieJar,
      'Referer': 'https://hotmc.ru/vote-240885'
    },
    signal: AbortSignal.timeout(180000)
  });
  cookieJar = extractCookies(res2, cookieJar);
  const voteHtml = await res2.text();
  fs.writeFileSync(path.join(__dirname, `form_${nickname}.html`), voteHtml);

  if (!voteHtml.includes('Ник в Майнкрафт')) {
    console.error(`[AutoVote] (${nickname}) ❌ Форма голосования не найдена (проверь form_${nickname}.html).`);
    return false;
  }

  if (voteHtml.includes('Вы уже голосовали недавно')) {
    console.log(`[AutoVote] ⚠️ (${nickname}) IP уже голосовал недавно.`);
    return true;
  }

  let success = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[AutoVote] (${nickname}) Попытка ввода капчи №${attempt}...`);

    const imgMatch = voteHtml.match(/src="([^"]*captcha[^"]*)"/i) || voteHtml.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    if (!imgMatch) {
      console.error(`[AutoVote] (${nickname}) ❌ Картинка капчи не найдена.`);
      return false;
    }

    let captchaImgUrl = imgMatch[1];
    if (captchaImgUrl.startsWith('/')) {
      captchaImgUrl = 'https://hotmc.ru' + captchaImgUrl;
    } else if (!captchaImgUrl.startsWith('http')) {
      captchaImgUrl = 'https://hotmc.ru/' + captchaImgUrl;
    }

    console.log(`[AutoVote] (${nickname}) CookieJar перед скачиванием капчи: ${cookieJar}`);
    const imgRes = await fetch(captchaImgUrl, {
      headers: {
        ...browserHeaders,
        'User-Agent': userAgent,
        'Cookie': cookieJar,
        'Referer': 'https://hotmc.ru/vote-240885'
      },
      signal: AbortSignal.timeout(180000)
    });
    cookieJar = extractCookies(imgRes, cookieJar);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    fs.writeFileSync('captcha_debug.jpeg', imgBuffer);

    console.log(`[AutoVote] (${nickname}) Распознаем капчу через Gemini...`);
    const code = await solveCaptcha(imgBuffer);
    console.log(`[AutoVote] (${nickname}) ✅ Код капчи: ${code}`);

    if (!code || code.length < 3) {
      console.error(`[AutoVote] (${nickname}) ❌ Капча не распознана, пробуем еще раз...`);
      continue;
    }

    const params = new URLSearchParams();
    params.append('PlayerCollector[nickname]', nickname);
    params.append('CaptchaCollector[captcha]', code);

    const inputs = voteHtml.match(/<input[^>]+>/g) || [];
    inputs.forEach(input => {
      const nameMatch = input.match(/name="([^"]+)"/i);
      const valMatch = input.match(/value="([^"]*)"/i);
      if (nameMatch && valMatch) {
        const name = nameMatch[1];
        const val = valMatch[1];
        if (!name.includes('PlayerCollector') && !name.includes('CaptchaCollector')) {
          params.append(name, val);
        }
      }
    });

    const metaToken = voteHtml.match(/name="csrf-token"\s+content="([^"]+)"/i);
    if (metaToken) {
      params.append('_csrf', metaToken[1]);
    }

    const csrfParamMatch = voteHtml.match(/name="csrf-param"\s+content="([^"]+)"/i);
    const csrfTokenMatch = voteHtml.match(/name="csrf-token"\s+content="([^"]+)"/i);
    if (csrfParamMatch && csrfTokenMatch) {
      params.append(csrfParamMatch[1], csrfTokenMatch[1]);
    }

    console.log(`[AutoVote] (${nickname}) CookieJar перед POST запросом: ${cookieJar}`);
    console.log(`[AutoVote] (${nickname}) Отправка POST запроса...`);
    const postRes = await fetch('https://hotmc.ru/vote-240885', {
      method: 'POST',
      headers: {
        ...browserHeaders,
        'User-Agent': userAgent,
        'Cookie': cookieJar,
        'Referer': 'https://hotmc.ru/vote-240885',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://hotmc.ru',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: params.toString(),
      signal: AbortSignal.timeout(180000)
    });

    const postText = await postRes.text();
    fs.writeFileSync(path.join(__dirname, `res_${nickname}.html`), postText);

    if (postRes.status === 200 && (postText.includes('Спасибо за голосование') || postText.includes('начислен 1 голос') || !postText.includes('has-error'))) {
      console.log(`[AutoVote] 🎉 (${nickname}) Голос успешно отправлен и засчитан!`);
      success = true;
      break;
    } else {
      console.log(`[AutoVote] ⚠️ (${nickname}) Неверный код капчи или ошибка, повторная попытка...`);
    }
  }
  return success;
}

async function voteForAccount(nickname) {
  try {
    return await voteWithBrowser(nickname);
  } catch (e) {
    console.warn('[AutoVote] Браузер недоступен или ошибка, фоллбэк на fetch...', e.message);
    return await voteWithFetch(nickname);
  }
}

async function run() {
  const targetNick = process.argv[2] || getMainAccount();
  await voteForAccount(targetNick);
}

run();
