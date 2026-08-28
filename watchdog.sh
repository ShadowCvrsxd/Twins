#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_PATH="$(which node)"

check_and_start() {
    local screen_name="$1"
    local script_name="$2"
    
    # Очищаем мертвые сокеты
    screen -wipe >/dev/null 2>&1
    
    # Проверяем, есть ли живой screen с таким именем (исключая (Remote or dead))
    local active_screen
    active_screen=$(screen -list 2>/dev/null | grep "\.$screen_name" | grep -v "Remote or dead" || true)
    
    if [ -z "$active_screen" ]; then
        echo "[$(date)] Screen '$screen_name' не найден. Запуск..."
        screen -wipe >/dev/null 2>&1
        screen -S "$screen_name" -dm bash -c "cd '$DIR' && '$NODE_PATH' '$script_name'; exec bash"
    fi
}

echo "=== Watchdog запущен. Мониторинг ботов и ТГ-хабов каждые 30 секунд ==="

while true; do
    check_and_start "twin1" "bot.js"
    check_and_start "twin2" "bot-2.js"
    check_and_start "tghub" "tg-hub.js"
    check_and_start "tgchat" "tg-chat-bot.js"
    
    sleep 30
done
