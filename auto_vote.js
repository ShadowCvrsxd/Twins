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
  console.log(`[AutoVote] 🚀 Старт голосования за ник: ${nickname}`);

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // Шаг 1: Запрос страницы для получения JS-челленджа
  const res1 = await fetch('https://hotmc.ru/vote-240885', {
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(15000)
  });
  const html1 = await res1.text();

  const match = html1.match(/window\.bp_chl_vars\s*=\s*({[^}]+})/);
  if (!match) {
    console.error('[AutoVote] Не найдены параметры защиты bp_chl_vars');
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
  console.log(`[AutoVote] (${nickname}) Кука получена: ${cookieVal}`);

  // Шаг 2: Получаем страницу с формой
  const res2 = await fetch('https://hotmc.ru/vote-240885', {
    headers: {
      'User-Agent': userAgent,
      'Cookie': cookieVal
    },
    signal: AbortSignal.timeout(15000)
  });
  const voteHtml = await res2.text();

  if (!voteHtml.includes('Ник в Майнкрафт')) {
    console.error(`[AutoVote] (${nickname}) ❌ Форма голосования не найдена.`);
    return false;
  }

  if (voteHtml.includes('Вы уже голосовали недавно')) {
    console.log(`[AutoVote] ⚠️ (${nickname}) IP уже голосовал сегодня. Смените VPN.`);
    return false;
  }

  // Шаг 3: Скачиваем капчу
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

  // Шаг 4: Формируем точный POST-запрос с Yii-полями формы
  const params = new URLSearchParams();
  
  // Точные имена полей из формы HotMC
  params.append('PlayerCollector[nickname]', nickname);
  params.append('CaptchaCollector[captcha]', code);

  // Собираем CSRF и прочие скрытые поля формы
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

  console.log(`[AutoVote] (${nickname}) Отправка POST запроса на сервер...`);
  const postRes = await fetch('https://hotmc.ru/vote-240885', {
    method: 'POST',
    headers: {
      'User-Agent': userAgent,
      'Cookie': cookieVal,
      'Referer': 'https://hotmc.ru/vote-240885',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://hotmc.ru'
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15000)
  });

  const postText = await postRes.text();
  fs.writeFileSync(path.join(__dirname, `res_${nickname}.html`), postText);

  if (postRes.status === 200 && !postText.includes('field-captchacollector-captcha has-error') && !postText.includes('Неправильный проверочный код')) {
    console.log(`[AutoVote] 🎉 (${nickname}) Голос успешно отправлен и засчитан!`);
    return true;
  } else {
    console.log(`[AutoVote] ⚠️ (${nickname}) Ошибка отправки (возможно, неверная капча или лимит). Ответ сохранен в res_${nickname}.html`);
    return false;
  }
}

async function run() {
  const targetNick = process.argv[2] || getMainAccount();
  await voteForAccount(targetNick);
}

run();
