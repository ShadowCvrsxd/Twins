#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

check_and_start() {
    local screen_name="$1"
    local script_name="$2"
    
    # Очищаем мертвые сокеты screen
    screen -wipe >/dev/null 2>&1
    
    # Проверяем, есть ли живой screen с таким точным именем
    if ! screen -list 2>/dev/null | grep -q "\.$screen_name\b"; then
        echo "[$(date)] Screen '$screen_name' не найден. Запуск..."
        screen -S "$screen_name" -dm bash -c "cd $DIR && node $script_name; exec bash"
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
