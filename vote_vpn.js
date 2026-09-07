require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getMainAccount, getTwinks } = require('./utils.js');

const ovpnDir = path.join(__dirname, 'ovpn');

function getOvpnFiles() {
  if (!fs.existsSync(ovpnDir)) {
    fs.mkdirSync(ovpnDir, { recursive: true });
    console.log('[VPN Vote] Создана папка ./ovpn. Закинь туда свои .ovpn профили!');
    return [];
  }
  return fs.readdirSync(ovpnDir)
    .filter(f => f.endsWith('.ovpn'))
    .map(f => path.join(ovpnDir, f));
}

function disconnectVpn() {
  try {
    execSync('sudo killall openvpn', { stdio: 'ignore' });
    console.log('[VPN Vote] OpenVPN отключен.');
  } catch (e) {}
}

function connectVpn(ovpnPath) {
  console.log(`[VPN Vote] Подключаюсь к VPN: ${path.basename(ovpnPath)}...`);
  try {
    execSync(`sudo openvpn --config "${ovpnPath}" --daemon vpn_instance`, { stdio: 'inherit' });
  } catch (e) {
    console.error('[VPN Vote] Ошибка запуска openvpn:', e.message);
    return false;
  }
  
  console.log('[VPN Vote] Жду установления соединения (10 сек)...');
  execSync('sleep 10');

  try {
    const ip = execSync('curl -s --connect-timeout 5 ifconfig.me').toString().trim();
    console.log(`[VPN Vote] Успешно! Текущий внешний IP: ${ip}`);
    return true;
  } catch (e) {
    console.error('[VPN Vote] ❌ Не удалось проверить IP после подключения VPN.');
    return false;
  }
}

async function run() {
  const accounts = [getMainAccount(), ...getTwinks()];
  const ovpnFiles = getOvpnFiles();

  if (ovpnFiles.length === 0) {
    console.log('[VPN Vote] ❌ В папке ./ovpn нет ни одного .ovpn файла!');
    return;
  }

  console.log(`[VPN Vote] Аккаунты (${accounts.length}): ${accounts.join(', ')}`);
  console.log(`[VPN Vote] Доступные .ovpn профили (${ovpnFiles.length}): ${ovpnFiles.map(f => path.basename(f)).join(', ')}`);

  for (let i = 0; i < accounts.length; i++) {
    const nick = accounts[i];
    const ovpn = ovpnFiles[i % ovpnFiles.length];

    disconnectVpn();
    const connected = connectVpn(ovpn);
    if (!connected) {
      console.log(`[VPN Vote] Пропускаем аккаунт ${nick} из-за ошибки VPN.`);
      continue;
    }

    console.log(`[VPN Vote] Запуск голосования для ${nick}...`);
    try {
      execSync(`node auto_vote.js "${nick}"`, { stdio: 'inherit' });
    } catch (err) {
      console.error(`[VPN Vote] Ошибка при голосовании за ${nick}:`, err.message);
    }

    disconnectVpn();
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('[VPN Vote] Все аккаунты проголосовали через VPN!');
}

run();
