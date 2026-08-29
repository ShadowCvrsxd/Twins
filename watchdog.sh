#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

check_and_start() {
    local screen_name="$1"
    local script_name="$2"
    
    # Проверяем по системным процессам (pgrep), запущен ли уже этот бот/хаб
    if ! pgrep -f "node $script_name" > /dev/null; then
        echo "[$(date)] Процесс для '$script_name' не найден. Запуск в screen '$screen_name'..."
        screen -wipe >/dev/null 2>&1
        # Убиваем старый зависший screen с таким именем на всякий случай
        screen -S "$screen_name" -X quit 2>/dev/null || true
        screen -S "$screen_name" -dm bash -c "cd $DIR && node $script_name; exec bash"
    fi
}

echo "=== Watchdog запущен. Мониторинг ботов и ТГ-хабов каждые 30 секунд ==="

while true; do
    screen -wipe >/dev/null 2>&1
    
    check_and_start "twin1" "bot.js"
    check_and_start "twin2" "bot-2.js"
    check_and_start "tghub" "tg-hub.js"
    check_and_start "tgchat" "tg-chat-bot.js"
    
    sleep 30
done
