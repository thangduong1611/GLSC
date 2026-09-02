# Playwright-Basisimage bringt Chromium + alle Linux-Systemabhängigkeiten
# schon mit — Version muss zur "playwright"-Version in package.json passen.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/server.js"]
