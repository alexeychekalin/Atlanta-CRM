# =============================================
# Dockerfile — CRM «Атланта»
# Node.js 20 Alpine
# =============================================

FROM node:20-alpine AS runner

WORKDIR /app

# Установка зависимостей сервера (отдельным слоем — кэш)
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev && npm cache clean --force

# Копирование исходного кода
COPY client ./client
COPY server ./server

# Каталог загрузок и права непривилегированного пользователя
RUN mkdir -p server/uploads/{images,drawings,avatars,documents} \
    && chown -R node:node /app

# Установка переменных окружения по умолчанию
ENV NODE_ENV=production
ENV PORT=3000

USER node

# Открытие порта
EXPOSE 3000

# Проверка живости приложения
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# Запуск сервера
CMD ["node", "server/src/index.js"]
