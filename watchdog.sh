#!/bin/bash
cd "$(dirname "$0")"

check_and_start() {
    local screen_name="$1"
    local cmd="$2"
    
    # Очищаем мертвые сокеты screen, чтобы не зависать на статусе (Remote or dead)
    screen -wipe >/dev/null 2>&1
    
    if ! screen -list 2>/dev/null | grep -q "\.$screen_name"; then
        echo "[$(date)] Screen '$screen_name' не найден. Запуск..."
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
