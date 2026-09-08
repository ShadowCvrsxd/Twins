require('dotenv').config();
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getMainAccount, getTwinks } = require('./utils.js');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey && !process.argv.includes('--mock')) {
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

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
];

async function voteForAccount(nickname) {
  console.log(`[AutoVote] 🚀 Старт голосования за ник: ${nickname}`);
  const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

  // Шаг 1: Запрос страницы для получения свежего JS-челленджа (с абсолютно чистой сессией)
  console.log(`[AutoVote] (${nickname}) Запрос свежей сессии...`);
  const res1 = await fetch('https://hotmc.ru/vote-240885', {
    headers: { 
      'User-Agent': userAgent,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    },
    signal: AbortSignal.timeout(15000)
  });
  const html1 = await res1.text();

  const match = html1.match(/window\.bp_chl_vars\s*=\s*({[^}]+})/);
  if (!match) {
    console.error('[AutoVote] Не найдены параметры защиты bp_chl_vars. Возможно, IP в бане.');
    fs.writeFileSync(path.join(__dirname, `blocked_${nickname}.html`), html1);
    return false;
  }

  const vars = eval("(" + match[1] + ")");
  const jsRes = await fetch('https://hotmc.ru/bp_chl.js', { signal: AbortSignal.timeout(15000) });
  const jsCode = await jsRes.text();

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
  console.log(`[AutoVote] (${nickname}) Новая обходная кука получена: ${cookieVal}`);

  // Шаг 2: Запрос формы голосования с чистой кукой
  const res2 = await fetch('https://hotmc.ru/vote-240885', {
    headers: {
      'User-Agent': userAgent,
      'Cookie': cookieVal
    },
    signal: AbortSignal.timeout(15000)
  });
  const voteHtml = await res2.text();
  fs.writeFileSync(path.join(__dirname, `form_${nickname}.html`), voteHtml);

  if (!voteHtml.includes('Ник в Майнкрафт')) {
    console.error(`[AutoVote] (${nickname}) ❌ Форма голосования не найдена (возможно, кука не прошла защиту).`);
    return false;
  }

  // Если на странице пишет "Вы уже голосовали недавно"
  if (voteHtml.includes('Вы уже голосовали недавно')) {
    console.log(`[AutoVote] ⚠️ (${nickname}) IP или сессия уже голосовали. Требуется смена VPN-профиля.`);
    return false;
  }

  // Шаг 3: Ищем картинку капчи
  const imgMatch = voteHtml.match(/src="([^"]*captcha[^"]*)"/i) || voteHtml.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
  if (!imgMatch) {
    console.error(`[AutoVote] (${nickname}) ❌ Картинка капчи не найдена в HTML.`);
    return false;
  }

  let captchaImgUrl = imgMatch[1];
  if (captchaImgUrl.startsWith('/')) {
    captchaImgUrl = 'https://hotmc.ru' + captchaImgUrl;
  } else if (!captchaImgUrl.startsWith('http')) {
    captchaImgUrl = 'https://hotmc.ru/' + captchaImgUrl;
  }

  console.log(`[AutoVote] (${nickname}) Скачиваем капчу...`);
  const imgRes = await fetch(captchaImgUrl, {
    headers: {
      'User-Agent': userAgent,
      'Cookie': cookieVal,
      'Referer': 'https://hotmc.ru/vote-240885'
    },
    signal: AbortSignal.timeout(15000)
  });
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

  console.log(`[AutoVote] (${nickname}) Распознаем капчу через Gemini...`);
  const code = await solveCaptcha(imgBuffer);
  console.log(`[AutoVote] (${nickname}) ✅ Код капчи: ${code}`);

  if (!code || code.length < 3) {
    console.error(`[AutoVote] (${nickname}) ❌ Капча не распознана.`);
    return false;
  }

  // Шаг 4: Собираем параметры формы для отправки голоса
  const params = new URLSearchParams();
  params.append('username', nickname);
  params.append('captcha', code);

  const inputs = voteHtml.match(/<input[^>]+>/g) || [];
  inputs.forEach(input => {
    const nameMatch = input.match(/name="([^"]+)"/i);
    const valMatch = input.match(/value="([^"]*)"/i);
    if (nameMatch && valMatch) {
      const name = nameMatch[1];
      const val = valMatch[1];
      if (name !== 'username' && name !== 'captcha') {
        params.append(name, val);
      }
    }
  });

  const metaToken = voteHtml.match(/name="csrf-token"\s+content="([^"]+)"/i);
  if (metaToken) {
    params.append('_csrf', metaToken[1]);
  }

  console.log(`[AutoVote] (${nickname}) Отправка POST запроса с ником и капчей...`);
  const postRes = await fetch('https://hotmc.ru/vote-240885', {
    method: 'POST',
    headers: {
      'User-Agent': userAgent,
      'Cookie': cookieVal,
      'Referer': 'https://hotmc.ru/vote-240885',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://hotmc.ru',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15000)
  });

  const postText = await postRes.text();
  fs.writeFileSync(path.join(__dirname, `res_${nickname}.html`), postText);

  if (postText.includes('успешно') || postText.includes('спасибо') || postText.includes('голос') || postRes.status === 200) {
    console.log(`[AutoVote] 🎉 (${nickname}) Голос успешно отправлен и засчитан!`);
    return true;
  } else {
    console.log(`[AutoVote] ⚠️ (${nickname}) Ответ сервера после отправки:`, postText.replace(/\s+/g, ' ').substring(0, 250));
    return false;
  }
}

async function run() {
  const targetNick = process.argv[2] || getMainAccount();
  await voteForAccount(targetNick);
}

run();
