#!/bin/bash
DOMAIN=${DOMAIN}
EMAIL="mikrolux@gmail.com"
CERT_PATH="/etc/letsencrypt/live/$DOMAIN"

# Заменяем переменные в конфигурации
sed -i "s/\${DOMAIN}/$DOMAIN/g" /etc/nginx/nginx.conf

# Запускаем nginx с базовой конфигурацией
cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.ssl
sed -i 's/listen 443 ssl/listen 80/g' /etc/nginx/nginx.conf
sed -i 's/ssl_certificate/# ssl_certificate/g' /etc/nginx/nginx.conf
nginx

# Генерируем/обновляем сертификат
if [ -d "$CERT_PATH" ]; then
    certbot renew --nginx --quiet
else
    certbot --nginx --non-interactive --agree-tos --email $EMAIL -d $DOMAIN
fi

# Восстанавливаем SSL конфигурацию
cp /etc/nginx/nginx.conf.ssl /etc/nginx/nginx.conf
nginx -s stop

while :; do
    sleep 48h
    certbot renew --quiet
done &
# Запускаем nginx с SSL
exec nginx -g 'daemon off;'