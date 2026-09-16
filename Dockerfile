# =============================================
# Dockerfile — CRM «Атланта»
# Node.js 20 Alpine
# =============================================

FROM node:20-alpine AS runner

WORKDIR /app

# Установка зависимостей сервера
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Копирование исходного кода
COPY client ./client
COPY server ./server

# Установка переменных окружения по умолчанию
ENV NODE_ENV=production
ENV PORT=3000

# Открытие порта
EXPOSE 3000

# Запуск сервера
CMD ["node", "server/src/index.js"]
