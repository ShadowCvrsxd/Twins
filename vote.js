require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function solveCaptcha(imageBuffer, apiKey) {
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

// Пример использования / теста
async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ Укажи GEMINI_API_KEY в .env');
    return;
  }

  // Тест на скачанной картинке капчи (если есть локально)
  const testImagePath = path.join(__dirname, 'captcha_test.png');
  if (fs.existsSync(testImagePath)) {
    console.log('🧪 Тестируем распознавание капчи через Gemini...');
    const buffer = fs.readFileSync(testImagePath);
    const code = await solveCaptcha(buffer, apiKey);
    console.log(`✅ Распознанный код капчи: "${code}"`);
  } else {
    console.log('ℹ️ Положи картинку капчи как `captcha_test.png` для теста, или используй функцию в своем скрипте голосования.');
  }
}

if (require.main === module) {
  test();
}

module.exports = { solveCaptcha };
