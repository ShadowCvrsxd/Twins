require('dotenv').config();
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getMainAccount, getTwinks } = require('./utils.js');

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

async function voteForAccount(nickname) {
  console.log(`[AutoVote] 🚀 Голосуем за ник: ${nickname}`);

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  let html1;
  try {
    const res1 = await fetch('https://hotmc.ru/vote-240885', {
      headers: { 'User-Agent': userAgent },
      signal: AbortSignal.timeout(15000)
    });
    html1 = await res1.text();
  } catch (e) {
    console.error(`[AutoVote] (${nickname}) ❌ Ошибка соединения с HotMC:`, e.message);
    return false;
  }

  const match = html1.match(/window\.bp_chl_vars\s*=\s*({[^}]+})/);
  if (!match) {
    console.error('[AutoVote] Не удалось найти параметры защиты bp_chl_vars');
    return false;
  }

  const vars = eval("(" + match[1] + ")");
  let jsCode;
  try {
    const jsRes = await fetch('https://hotmc.ru/bp_chl.js', { signal: AbortSignal.timeout(15000) });
    jsCode = await jsRes.text();
  } catch (e) {
    console.error(`[AutoVote] (${nickname}) ❌ Ошибка загрузки bp_chl.js:`, e.message);
    return false;
  }

  let solvedCookie = "";
  const mockWindow = {
    bp_chl_vars: vars,
    location: { href: 'https://hotmc.ru/vote-240885', replace() {} }
  };
  const mockDoc = {
    readyState: 'complete',
    set cookie(val) { solvedCookie = val; },
    get cookie() { return solvedCookie; },
    addEventListener() {}
  };

  const sandbox = {
    window: mockWindow,
    document: mockDoc,
    location: mockWindow.location,
    URL: URL,
    console: { log() {}, error() {}, warn() {} },
    parseInt: parseInt,
    Math: Math,
    String: String,
    Array: Array,
    Function: Function,
    RegExp: RegExp,
    Boolean: Boolean,
    decodeURIComponent: decodeURIComponent
  };

  try {
    vm.runInContext(jsCode, vm.createContext(sandbox));
  } catch (e) {}

  const cookieVal = solvedCookie ? solvedCookie.split(';')[0] : '';
  console.log(`[AutoVote] (${nickname}) Получена обходная кука: ${cookieVal}`);

  let voteHtml;
  try {
    const res2 = await fetch('https://hotmc.ru/vote-240885', {
      headers: {
        'User-Agent': userAgent,
        'Cookie': cookieVal
      },
      signal: AbortSignal.timeout(15000)
    });
    voteHtml = await res2.text();
  } catch (e) {
    console.error(`[AutoVote] (${nickname}) ❌ Ошибка запроса формы голосования:`, e.message);
    return false;
  }

  if (!voteHtml.includes('Ник в Майнкрафт')) {
    console.error(`[AutoVote] (${nickname}) ❌ Форма голосования не найдена.`);
    return false;
  }

  const imgMatch = voteHtml.match(/src="([^"]*captcha[^"]*)"/i) || voteHtml.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
  if (!imgMatch) {
    console.error(`[AutoVote] (${nickname}) ❌ Не найдена ссылка на капчу в HTML.`);
    return false;
  }

  let captchaImgUrl = imgMatch[1];
  if (captchaImgUrl.startsWith('/')) {
    captchaImgUrl = 'https://hotmc.ru' + captchaImgUrl;
  } else if (!captchaImgUrl.startsWith('http')) {
    captchaImgUrl = 'https://hotmc.ru/' + captchaImgUrl;
  }

  let imgBuffer;
  try {
    const imgRes = await fetch(captchaImgUrl, {
      headers: {
        'User-Agent': userAgent,
        'Cookie': cookieVal,
        'Referer': 'https://hotmc.ru/vote-240885'
      },
      signal: AbortSignal.timeout(15000)
    });
    imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  } catch (e) {
    console.error(`[AutoVote] (${nickname}) ❌ Ошибка скачивания капчи:`, e.message);
    return false;
  }

  const code = await solveCaptcha(imgBuffer);
  console.log(`[AutoVote] (${nickname}) ✅ Распознанный код капчи: ${code}`);

  if (!code || code.length < 3) {
    console.error(`[AutoVote] (${nickname}) ❌ Не удалось распознать капчу.`);
    return false;
  }

  const params = new URLSearchParams();
  params.append('username', nickname);
  params.append('captcha', code);

  const inputs = voteHtml.match(/<input[^>]+>/g) || [];
  inputs.forEach(input => {
    const nameMatch = input.match(/name="([^"]+)"/i);
    const valMatch = input.match(/value="([^"]*)"/i);
    if (nameMatch && valMatch && nameMatch[1] !== 'username' && nameMatch[1] !== 'captcha') {
      params.append(nameMatch[1], valMatch[1]);
    }
  });

  try {
    const postRes = await fetch('https://hotmc.ru/vote-240885', {
      method: 'POST',
      headers: {
        'User-Agent': userAgent,
        'Cookie': cookieVal,
        'Referer': 'https://hotmc.ru/vote-240885',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString(),
      signal: AbortSignal.timeout(15000)
    });

    const postHtml = await postRes.text();
    if (postHtml.includes('успешно') || postHtml.includes('спасибо') || postHtml.includes('голос') || postRes.status === 200) {
      console.log(`[AutoVote] 🎉 (${nickname}) Голос успешно отправлен!`);
      return true;
    } else {
      console.log(`[AutoVote] ⚠️ (${nickname}) Ответ сервера:`, postHtml.replace(/\s+/g, ' ').substring(0, 200));
      return false;
    }
  } catch (e) {
    console.error(`[AutoVote] (${nickname}) ❌ Ошибка отправки POST запроса:`, e.message);
    return false;
  }
}

async function run() {
  const targetNick = process.argv[2] || getMainAccount();
  await voteForAccount(targetNick);
}

run();
