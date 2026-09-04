#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_PATH="$(which node)"

IS_ROOT=false
if [ "$1" == "--root" ] || [ "$EUID" -eq 0 ]; then
    IS_ROOT=true
fi

echo "=== Установка зависимостей (npm install) ==="
cd "$DIR" && npm install

if [ "$IS_ROOT" = true ]; then
    SERVICE_DIR="/etc/systemd/system"
    SYSTEMCTL_CMD="systemctl"
    echo "USER_SYSTEMD=false" >> .env
    echo "=== Настройка systemd для Twins (ROOT / Системный режим) ==="
else
    SERVICE_DIR="$HOME/.config/systemd/user"
    SYSTEMCTL_CMD="systemctl --user"
    echo "USER_SYSTEMD=true" >> .env
    echo "=== Настройка systemd для Twins (Пользовательский режим) ==="
    mkdir -p "$SERVICE_DIR"
fi

create_service() {
    local name="$1"
    local script="$2"
    local desc="$3"
    
    cat << EOF > "$SERVICE_DIR/$name.service"
[Unit]
Description=$desc
After=network.target

[Service]
WorkingDirectory=$DIR
ExecStart=$NODE_PATH $DIR/$script
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=$([ "$IS_ROOT" = true ] && echo "multi-user.target" || echo "default.target")
EOF
    echo "Создан сервис: $SERVICE_DIR/$name.service"
}

create_service "twins-bot1" "bot.js" "Twins Bot 1"
create_service "twins-bot2" "bot-2.js" "Twins Bot 2"
create_service "twins-main" "bot-main.js" "Twins Main Bot"
create_service "twins-tghub" "tg-hub.js" "Twins Telegram Hub"
create_service "twins-tgchat" "tg-chat-bot.js" "Twins Telegram Chat Bot"

$SYSTEMCTL_CMD daemon-reload
$SYSTEMCTL_CMD enable twins-bot1 twins-bot2 twins-tghub twins-tgchat
$SYSTEMCTL_CMD start twins-bot1 twins-bot2 twins-tghub twins-tgchat

echo "=== Готово! Сервисы systemd настроены и запущены ==="
if [ "$IS_ROOT" = true ]; then
    echo "Управление (root):"
    echo "Статус: systemctl status twins-bot1"
    echo "Логи:   journalctl -u twins-bot1 -f"
    echo "Стоп:   systemctl stop twins-bot1"
else
    echo "Управление (user):"
    echo "Статус: systemctl --user status twins-bot1"
    echo "Логи:   journalctl --user -u twins-bot1 -f"
    echo "Стоп:   systemctl --user stop twins-bot1"
fi
