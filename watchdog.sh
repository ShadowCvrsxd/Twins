#!/bin/bash
cd "$(dirname "$0")"

check_and_start() {
    local screen_name="$1"
    local cmd="$2"
    
    # Очищаем мертвые сокеты
    screen -wipe >/dev/null 2>&1
    
    # Проверяем, есть ли живой screen с таким именем (исключая (Remote or dead))
    local active_screen
    active_screen=$(screen -list 2>/dev/null | grep "\.$screen_name" | grep -v "Remote or dead" || true)
    
    if [ -z "$active_screen" ]; then
        echo "[$(date)] Screen '$screen_name' мертв или отсутствует. Запуск..."
        screen -wipe >/dev/null 2>&1
        screen -S "$screen_name" -dm bash -c "$cmd; exec bash"
    fi
}

echo "=== Watchdog запущен. Мониторинг ботов и ТГ-хабов каждые 30 секунд ==="

while true; do
    check_and_start "twin1" "node bot.js"
    check_and_start "twin2" "node bot-2.js"
    check_and_start "tghub" "node tg-hub.js"
    check_and_start "tgchat" "node tg-chat-bot.js"
    
    sleep 30
done
