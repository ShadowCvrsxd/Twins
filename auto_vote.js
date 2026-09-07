require('dotenv').config();
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getMainAccount, getTwinks } = require('./utils.js');

const apiKey = process.env.GEMINI_API_KEY;

async function solveCaptcha(imageBuffer) {
  if (!apiKey) {
    console.log('[AutoVote Mock] ⚠️ GEMINI_API_KEY не задан, возвращаем фейк-код "1234"');
    return '1234';
  }
  try {
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
    return text ? text.trim().replace(/[^0-9]/g, '') : '1234';
  } catch (e) {
    console.log('[AutoVote Mock] ⚠️ Ошибка Gemini API, используем "1234":', e.message);
    return '1234';
  }
}

async function voteForAccount(nickname, isMock = false) {
  console.log(`[AutoVote${isMock ? ' MOCK' : ''}] 🚀 Старт голосования за ник: ${nickname}`);

  if (isMock) {
    console.log(`[AutoVote MOCK] ⏳ Имитируем загрузку страницы HotMC...`);
    await new Promise(r => setTimeout(r, 1000));
    console.log(`[AutoVote MOCK] ⏳ Имитируем обход Cloudflare челленджа...`);
    await new Promise(r => setTimeout(r, 1000));
    console.log(`[AutoVote MOCK] ⏳ Распознаем тестовую капчу через Gemini...`);
    const fakeCaptchaBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const code = await solveCaptcha(fakeCaptchaBuffer);
    console.log(`[AutoVote MOCK] ✅ Распознан код: ${code}`);
    await new Promise(r => setTimeout(r, 1000));
    console.log(`[AutoVote MOCK] 🎉 Голос за ${nickname} успешно имитирован и засчитан!`);
    return true;
  }

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  try {
    console.log(`[AutoVote] (${nickname}) Запрос страницы HotMC...`);
    const res1 = await fetch('https://hotmc.ru/vote-240885', {
      headers: { 'User-Agent': userAgent },
      signal: AbortSignal.timeout(10000)
    });
    const html1 = await res1.text();

    const match = html1.match(/window\.bp_chl_vars\s*=\s*({[^}]+})/);
    if (!match) {
      console.error('[AutoVote] Не найдены параметры bp_chl_vars (возможно, сайт заблокирован или недоступен)');
      return false;
    }

    const vars = eval("(" + match[1] + ")");
    const jsRes = await fetch('https://hotmc.ru/bp_chl.js', { signal: AbortSignal.timeout(10000) });
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

    const res2 = await fetch('https://hotmc.ru/vote-240885', {
      headers: {
        'User-Agent': userAgent,
        'Cookie': cookieVal
      },
      signal: AbortSignal.timeout(10000)
    });
    const voteHtml = await res2.text();

    if (!voteHtml.includes('Ник в Майнкрафт')) {
      console.error(`[AutoVote] (${nickname}) ❌ Форма не найдена.`);
      fs.writeFileSync(path.join(__dirname, `fail_${nickname}.html`), voteHtml);
      return false;
    }

    const imgMatch = voteHtml.match(/src="([^"]*captcha[^"]*)"/i) || voteHtml.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    if (!imgMatch) {
      console.error(`[AutoVote] (${nickname}) ❌ Капча не найдена.`);
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
      signal: AbortSignal.timeout(10000)
    });
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    const code = await solveCaptcha(imgBuffer);
    console.log(`[AutoVote] (${nickname}) ✅ Распознанный код: ${code}`);

    if (!code || code.length < 3) {
      console.error(`[AutoVote] (${nickname}) ❌ Капча не распознана.`);
      return false;
    }

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
      signal: AbortSignal.timeout(10000)
    });

    const postText = await postRes.text();
    if (postText.includes('успешно') || postText.includes('спасибо') || postText.includes('голос') || postRes.status === 200) {
      console.log(`[AutoVote] 🎉 (${nickname}) Голос отправлен успешно!`);
      return true;
    } else {
      console.log(`[AutoVote] ⚠️ (${nickname}) Ответ сервера:`, postText.replace(/\s+/g, ' ').substring(0, 250));
      return false;
    }
  } catch (e) {
    console.error(`[AutoVote] (${nickname}) ❌ Ошибка:`, e.message);
    return false;
  }
}

async function run() {
  const isMock = process.argv.includes('--mock');
  const targetNick = process.argv.find(arg => arg !== '--mock' && arg !== process.argv[0] && arg !== process.argv[1]) || getMainAccount();
  await voteForAccount(targetNick, isMock);
}

run();
