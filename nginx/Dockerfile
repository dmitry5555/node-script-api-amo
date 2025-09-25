FROM nginx:1.27

RUN apt-get update && apt-get install -y certbot python3-certbot-nginx

COPY ./nginx/nginx.conf /etc/nginx/nginx.conf

COPY ./nginx/init-letsencrypt.sh /init-letsencrypt.sh
RUN chmod +x /init-letsencrypt.sh

VOLUME ["/etc/letsencrypt", "/var/lib/letsencrypt"]

# RUN mkdir -p /var/www/certbot
# RUN mkdir -p ./certbot/www
# RUN mkdir -p ./certbot/conf

EXPOSE 80 443

CMD ["/bin/bash", "-c", "/init-letsencrypt.sh && nginx -g 'daemon off;'"]
# CMD ["nginx", "-g", "daemon off;"]