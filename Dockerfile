FROM node:18 AS build
WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build


FROM node:18
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
COPY --from=build /app/dist ./dist

ENV DATA_ROOT=/app/server/runtime-data
ENV PORT=8080

EXPOSE 8080

CMD ["sh", "-c", "node server/db/migrate.js && node server/server.js"]
