const { Agent, setGlobalDispatcher } = require('undici');
setGlobalDispatcher(new Agent({ connectTimeout: 300000 }));

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
https.globalAgent.options.timeout = 300000;
const { getMainAccount } = require('./utils.js');

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
      signal: AbortSignal.timeout(300000)
    });
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('[AutoVote] 🤖 Gemini сырой ответ:', JSON.stringify(text));
    return text ? text.trim().replace(/[^0-9]/g, '') : null;
  } catch (err) {
    console.error('[AutoVote] ❌ Ошибка запроса к Gemini API:', err.message);
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
  setCookieHeaders.forEach(sc => {
    if (!sc) return;
    const cookiePart = sc.split(';')[0];
    const [name, ...val] = cookiePart.trim().split('=');
    if (name && val.length) cookiesMap.set(name, val.join('='));
  });

  return Array.from(cookiesMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function voteWithFetch(nickname) {
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
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  for (let networkAttempt = 1; networkAttempt <= 5; networkAttempt++) {
    try {
      console.log(`[AutoVote] 🚀 (${nickname}) Старт голосования (попытка сети №${networkAttempt}/5)...`);
      let cookieJar = '';

      const res1 = await fetch('https://hotmc.ru/vote-240885', {
        headers: { ...browserHeaders, 'User-Agent': userAgent },
        signal: AbortSignal.timeout(300000)
      });
      cookieJar = extractCookies(res1, cookieJar);
      const html1 = await res1.text();

      const match = html1.match(/window\.bp_chl_vars\s*=\s*({[^}]+})/);
      if (match) {
        try {
          const vars = eval("(" + match[1] + ")");
          if (vars.sec && vars.name) {
            cookieJar = extractCookies({ headers: { getSetCookie: () => [`${vars.name}=${vars.sec}; Path=/; Domain=.hotmc.ru`] } }, cookieJar);
            console.log(`[AutoVote] (${nickname}) ✅ Cloudflare bp_chl кука установлена: ${vars.name}=${vars.sec}`);
          }
        } catch (e) {
          console.error('[AutoVote] Ошибка парсинга bp_chl_vars:', e.message);
        }
      }

      const res2 = await fetch('https://hotmc.ru/vote-240885', {
        headers: {
          ...browserHeaders,
          'User-Agent': userAgent,
          'Cookie': cookieJar,
          'Referer': 'https://hotmc.ru/vote-240885'
        },
        signal: AbortSignal.timeout(300000)
      });
      cookieJar = extractCookies(res2, cookieJar);
      const voteHtml = await res2.text();
      fs.writeFileSync(path.join(__dirname, `form_${nickname}.html`), voteHtml);

      if (!voteHtml.includes('Ник в Майнкрафт')) {
        console.error(`[AutoVote] (${nickname}) ❌ Форма голосования не найдена.`);
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

        const imgRes = await fetch(captchaImgUrl, {
          headers: {
            ...browserHeaders,
            'User-Agent': userAgent,
            'Cookie': cookieJar,
            'Referer': 'https://hotmc.ru/vote-240885'
          },
          signal: AbortSignal.timeout(300000)
        });
        cookieJar = extractCookies(imgRes, cookieJar);
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        fs.writeFileSync('captcha_debug.jpeg', imgBuffer);

        const code = await solveCaptcha(imgBuffer);
        console.log(`[AutoVote] (${nickname}) ✅ Код капчи: ${code}`);

        if (!code || code.length < 3) {
          console.error(`[AutoVote] (${nickname}) ❌ Капча не распознана, повтор...`);
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
          signal: AbortSignal.timeout(300000)
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

    } catch (err) {
      const isNetworkError = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' ||
        err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT') || err.message.includes('timeout') || err.message.includes('fetch failed');

      console.error(`[AutoVote] ❌ (${nickname}) Ошибка в попытке сети #${networkAttempt}:`, err.message);

      if (isNetworkError && networkAttempt < 5) {
        console.log(`[AutoVote] 🔄 (${nickname}) Сетевая ошибка/таймаут, повтор через 5с (${networkAttempt + 1}/5)...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      } else {
        throw err;
      }
    }
  }
  return false;
}

async function run() {
  const targetNick = process.argv[2] || getMainAccount();
  await voteWithFetch(targetNick);
}

run();
