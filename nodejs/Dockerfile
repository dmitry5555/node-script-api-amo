
FROM node:lts-alpine3.22
WORKDIR /usr/src/app
COPY ./nodejs/package*.json ./
RUN npm install
COPY ./nodejs/. .
EXPOSE 3000
CMD ["node", "app.js"]
