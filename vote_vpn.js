const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { execSync } = require('child_process');
const fs = require('fs');
const { getMainAccount, getTwinks } = require('./utils.js');

function getOvpnFiles() {
  let dirs = [
    process.env.OPENVPN_DIR,
    path.join(__dirname, 'vpn'),
    path.join(__dirname, 'ovpn')
  ].filter(Boolean);

  let targetDir = null;
  for (const d of dirs) {
    if (fs.existsSync(d)) {
      const files = fs.readdirSync(d).filter(f => f.endsWith('.ovpn'));
      if (files.length > 0) {
        targetDir = d;
        break;
      }
    }
  }

  if (!targetDir) {
    // Если нигде нет, берем первую существующую или создаем vpn
    targetDir = dirs[0] || path.join(__dirname, 'vpn');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    console.log(`[VPN Vote] ❌ В папках (${dirs.join(', ')}) не найдено .ovpn файлов!`);
    return [];
  }

  return fs.readdirSync(targetDir)
    .filter(f => f.endsWith('.ovpn'))
    .map(f => path.join(targetDir, f));
}

function disconnectVpn() {
  try {
    execSync('sudo killall openvpn', { stdio: 'ignore' });
    console.log('[VPN Vote] OpenVPN отключен.');
  } catch (e) {}
}

function connectVpn(ovpnPath) {
  console.log(`[VPN Vote] Подключаюсь к VPN: ${path.basename(ovpnPath)}...`);
  let authArg = '';
  const tmpAuthFile = path.join(__dirname, '.ovpn_auth_tmp');

  if (process.env.OPENVPN_USER && process.env.OPENVPN_PASS) {
    fs.writeFileSync(tmpAuthFile, `${process.env.OPENVPN_USER}\n${process.env.OPENVPN_PASS}\n`);
    authArg = `--auth-user-pass "${tmpAuthFile}"`;
  } else if (process.env.OPENVPN_AUTH_FILE && fs.existsSync(process.env.OPENVPN_AUTH_FILE)) {
    authArg = `--auth-user-pass "${process.env.OPENVPN_AUTH_FILE}"`;
  }

  try {
    execSync(`sudo openvpn --config "${ovpnPath}" ${authArg} --daemon vpn_instance`, { stdio: 'inherit' });
  } catch (e) {
    console.error('[VPN Vote] Ошибка запуска openvpn:', e.message);
    if (fs.existsSync(tmpAuthFile)) try { fs.unlinkSync(tmpAuthFile); } catch(err){}
    return false;
  } finally {
    if (fs.existsSync(tmpAuthFile)) try { fs.unlinkSync(tmpAuthFile); } catch(err){}
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
    console.log('[VPN Vote] ❌ Нет .ovpn файлов для запуска голосования.');
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
