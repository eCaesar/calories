#!/usr/bin/env bash
# Установка «Калорий» на VPS без Docker: PocketBase под systemd + nginx с HTTPS.
# Запуск из корня репозитория на сервере:
#   sudo DOMAIN=kalorii.example.ru HTTPS_PORT=8443 EMAIL=you@example.com bash server/install-native.sh
# Повторный запуск обновляет приложение и сервер, данные (pb_data) не трогает.
set -euo pipefail

DOMAIN="${DOMAIN:?Укажите DOMAIN, например 1-2-3-4.sslip.io}"
HTTPS_PORT="${HTTPS_PORT:-8443}"
PB_PORT="${PB_PORT:-8090}"
PB_VERSION="${PB_VERSION:-0.22.21}"
EMAIL="${EMAIL:-}"
DIR=/opt/kalorii
REPO="$(cd "$(dirname "$0")/.." && pwd)"

[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }
apt-get install -y -q unzip curl nginx >/dev/null
# Если certbot уже стоит (например свой в /opt), используем его: тогда сертификат продлит уже настроенный таймер
for c in "${CERTBOT:-}" /opt/certbot-ip/bin/certbot "$(command -v certbot || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && { CERTBOT="$c"; break; }
done
if [ -z "${CERTBOT:-}" ] || [ ! -x "$CERTBOT" ]; then apt-get install -y -q certbot >/dev/null; CERTBOT="$(command -v certbot)"; fi

# 1. PocketBase
case "$(uname -m)" in x86_64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "Неизвестная архитектура"; exit 1 ;; esac
id kalorii >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin kalorii
mkdir -p "$DIR/pb_data" "$DIR/pb_public/data" "$DIR/pb_migrations"
if [ ! -x "$DIR/pocketbase" ] || ! "$DIR/pocketbase" --version | grep -q "$PB_VERSION"; then
  curl -fsSL -o /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip"
  unzip -oq /tmp/pb.zip pocketbase -d "$DIR" && rm /tmp/pb.zip
fi

# 2. Приложение и схема базы
cp "$REPO"/server/pb_migrations/*.js "$DIR/pb_migrations/"
cp "$REPO"/{index.html,app.js,sync.js,foods.js,foods-extra.js,foods-dishes.js,manifest.json,sw.js,icon.svg,icon-192.png,icon-512.png} "$DIR/pb_public/"
cp -r "$REPO/fonts" "$DIR/pb_public/"
curl -fsSL -o "$DIR/pb_public/data/off-ru.json.tmp" https://raw.githubusercontent.com/eCaesar/calories/gh-pages/data/off-ru.json \
  && mv "$DIR/pb_public/data/off-ru.json.tmp" "$DIR/pb_public/data/off-ru.json" \
  || { [ -f "$DIR/pb_public/data/off-ru.json" ] || echo '[]' > "$DIR/pb_public/data/off-ru.json"; }
chown -R kalorii:kalorii "$DIR"

cat > /etc/systemd/system/kalorii.service <<EOF
[Unit]
Description=Kalorii (PocketBase)
After=network.target

[Service]
User=kalorii
WorkingDirectory=$DIR
ExecStart=$DIR/pocketbase serve --http=127.0.0.1:$PB_PORT --dir=$DIR/pb_data --migrationsDir=$DIR/pb_migrations --publicDir=$DIR/pb_public
Restart=on-failure
MemoryMax=300M

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now kalorii >/dev/null
systemctl restart kalorii

# 3. HTTPS: сертификат Let's Encrypt через существующий nginx на :80
mkdir -p /var/www/kalorii-acme
cat > /etc/nginx/sites-available/kalorii-acme.conf <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/kalorii-acme; }
    location / { return 301 https://\$host:$HTTPS_PORT\$request_uri; }
}
EOF
ln -sf /etc/nginx/sites-available/kalorii-acme.conf /etc/nginx/sites-enabled/kalorii-acme.conf
nginx -t && systemctl reload nginx

if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  "$CERTBOT" certonly --webroot -w /var/www/kalorii-acme -d "$DOMAIN" --non-interactive --agree-tos \
    ${EMAIL:+--email "$EMAIL"} ${EMAIL:---register-unsafely-without-email}
fi

cat > /etc/nginx/sites-available/kalorii.conf <<EOF
server {
    listen $HTTPS_PORT ssl http2;
    server_name $DOMAIN;
    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    client_max_body_size 10m;
    gzip on;
    gzip_types application/json application/javascript text/css image/svg+xml;
    location / {
        proxy_pass http://127.0.0.1:$PB_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
EOF
ln -sf /etc/nginx/sites-available/kalorii.conf /etc/nginx/sites-enabled/kalorii.conf
nginx -t && systemctl reload nginx
# certbot продлевает сертификат сам; после продления перечитываем nginx
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

echo
echo "Готово: https://$DOMAIN:$HTTPS_PORT"
echo "Панель администратора: https://$DOMAIN:$HTTPS_PORT/_/ — при первом входе создайте администратора."
