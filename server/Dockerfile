# Сервер «Калорий»: PocketBase (аккаунты + база) и само приложение в pb_public
FROM alpine:3.20
ARG PB_VERSION=0.22.21
ARG TARGETARCH=amd64
RUN apk add --no-cache ca-certificates unzip wget \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" -O /tmp/pb.zip \
 && unzip -q /tmp/pb.zip -d /pb && rm /tmp/pb.zip
COPY server/pb_migrations /pb/pb_migrations
COPY index.html app.js sync.js foods.js foods-extra.js foods-dishes.js foods-usda.js manifest.json sw.js icon.svg icon-192.png icon-512.png /pb/pb_public/
COPY fonts /pb/pb_public/fonts
# Готовая выгрузка магазинных товаров из публикации на GitHub (если недоступна — приложение ищет онлайн)
RUN mkdir -p /pb/pb_public/data \
 && (wget -q -O /pb/pb_public/data/off-ru.json https://raw.githubusercontent.com/eCaesar/calories/gh-pages/data/off-ru.json || echo '[]' > /pb/pb_public/data/off-ru.json)
EXPOSE 8090
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--migrationsDir=/pb/pb_migrations", "--publicDir=/pb/pb_public"]
