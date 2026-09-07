require('dotenv').config();
const fs = require('fs');
const path = require('path');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('[Gemini Captcha] ❌ GEMINI_API_KEY не задан в .env');
  process.exit(1);
}

async function solveCaptcha(imageBuffer) {
  const base64Image = imageBuffer.toString('base64');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
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

console.log('[Gemini Captcha Worker] Запущен и следит за картинками капчи в папке...');

setInterval(async () => {
  try {
    const files = fs.readdirSync(__dirname);
    for (const file of files) {
      if (file.toLowerCase().includes('captcha') && /\.(png|jpg|jpeg)$/i.test(file)) {
        const filePath = path.join(__dirname, file);
        try {
          const stats = fs.statSync(filePath);
          if (Date.now() - stats.mtimeMs < 1000) continue;
        } catch(e) { continue; }

        console.log(`[Gemini Captcha Worker] Найдена капча: ${file}. Распознаю...`);
        try {
          const buffer = fs.readFileSync(filePath);
          const code = await solveCaptcha(buffer);
          if (code) {
            console.log(`[Gemini Captcha Worker] ✅ Успешно распознано: "${code}" для ${file}`);
            fs.writeFileSync(filePath + '.txt', code);
          } else {
            console.log(`[Gemini Captcha Worker] ⚠️ Не удалось распознать цифры на ${file}`);
          }
          fs.renameSync(filePath, filePath + '.done');
        } catch (err) {
          console.error(`[Gemini Captcha Worker] ❌ Ошибка обработки ${file}:`, err.message);
        }
      }
    }
  } catch (e) {}
}, 2000);
