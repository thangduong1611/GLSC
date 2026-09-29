# Playwright-Basisimage bringt Chromium + alle Linux-Systemabhängigkeiten
# schon mit — Version muss zur "playwright"-Version in package.json passen.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
# Ohne dies läuft der Container in UTC — alle Skripte berechnen "heute"/
# "gestern" über new Date() (lokale Getter), was rund um Mitternacht deutscher
# Zeit auf das falsche Kalenderdatum schreibt (Auftrag t.duong 29.09.2026,
# live bestätigt: Lauf um 00:04 Berlin = 22:04 UTC schrieb noch datum
# "gestern", weil UTC dort erst 2 Std. später umschlägt).
ENV TZ=Europe/Berlin
EXPOSE 8080

CMD ["node", "src/server.js"]
