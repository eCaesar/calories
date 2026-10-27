#!/usr/bin/env sh
# Установка на VPS одной командой:
#   DOMAIN=kalorii.example.ru sh server/install.sh
# Если на сервере уже есть свой nginx/Caddy на 80/443, запустите без HTTPS:
#   NO_CADDY=1 sh server/install.sh   (приложение будет на 127.0.0.1:8090, проксируйте на него)
set -eu
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo "Нужен Docker: https://docs.docker.com/engine/install/"; exit 1; }
if [ "${NO_CADDY:-}" = "1" ]; then
  docker compose up -d --build pocketbase
  echo "Готово: приложение на http://127.0.0.1:${PB_PORT:-8090}"
else
  : "${DOMAIN:?Укажите домен: DOMAIN=kalorii.example.ru sh server/install.sh}"
  printf 'DOMAIN=%s\n' "$DOMAIN" > .env
  docker compose --profile https up -d --build
  echo "Готово: https://$DOMAIN"
fi
echo "Панель администратора: /_/ (при первом входе создайте администратора)."
