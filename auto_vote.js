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

  // Шаг 1: Запрос страницы для получения JS-челленджа
  const res1 = await fetch('https://hotmc.ru/vote-240885', {
    headers: { 'User-Agent': userAgent }
  });
  const html1 = await res1.text();

  const match = html1.match(/window\.bp_chl_vars\s*=\s*({[^}]+})/);
  if (!match) {
    console.error('[AutoVote] Не удалось найти параметры защиты bp_chl_vars');
    return false;
  }

  const vars = eval("(" + match[1] + ")");
  const jsRes = await fetch('https://hotmc.ru/bp_chl.js');
  const jsCode = await jsRes.text();

  // Эмулируем выполнение JS-челленджа для получения куки
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

  // Шаг 2: Запрос самой страницы голосования с решенной кукой
  const res2 = await fetch('https://hotmc.ru/vote-240885', {
    headers: {
      'User-Agent': userAgent,
      'Cookie': cookieVal
    }
  });
  const voteHtml = await res2.text();

  if (!voteHtml.includes('Ник в Майнкрафт')) {
    console.error(`[AutoVote] (${nickname}) ❌ Не удалось пройти защиту или загрузить форму голосования.`);
    fs.writeFileSync(path.join(__dirname, `error_${nickname}.html`), voteHtml);
    return false;
  }

  console.log(`[AutoVote] (${nickname}) ✅ Защита успешно пройдена, форма доступна!`);
  fs.writeFileSync(path.join(__dirname, `success_${nickname}.html`), voteHtml);
  return true;
}

async function run() {
  const targetNick = process.argv[2];
  if (targetNick) {
    await voteForAccount(targetNick);
  } else {
    const accounts = [getMainAccount(), ...getTwinks()];
    console.log(`[AutoVote] Аккаунты для голосования: ${accounts.join(', ')}`);
    for (const nick of accounts) {
      await voteForAccount(nick);
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log('[AutoVote] Все голосования завершены.');
  }
}

run();
