#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="$(whoami)"
NODE_PATH="$(which node)"

echo "=== Настройка systemd для Twins (пользователь: $USER_NAME, путь: $DIR) ==="

mkdir -p ~/.config/systemd/user

create_service() {
    local name="$1"
    local script="$2"
    local desc="$3"
    
    cat << EOF > ~/.config/systemd/user/$name.service
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
WantedBy=default.target
EOF
    echo "Создан сервис: $name ($script)"
}

create_service "twins-bot1" "bot.js" "Twins Bot 1"
create_service "twins-bot2" "bot-2.js" "Twins Bot 2"
create_service "twins-tghub" "tg-hub.js" "Twins Telegram Hub"
create_service "twins-tgchat" "tg-chat-bot.js" "Twins Telegram Chat Bot"

systemctl --user daemon-reload
systemctl --user enable twins-bot1 twins-bot2 twins-tghub twins-tgchat
systemctl --user start twins-bot1 twins-bot2 twins-tghub twins-tgchat

echo "=== Готово! Сервисы systemd настроены и запущены ==="
echo "Команды управления:"
echo "Статус: systemctl --user status twins-bot1"
echo "Логи:   journalctl --user -u twins-bot1 -f"
echo "Стоп:   systemctl --user stop twins-bot1"
