# 🖥️ Разворачивание CRM «Атланта» на VPS (Ubuntu 22.04 / 24.04)

## Требования

| Параметр | Минимум | Рекомендуется |
|----------|---------|---------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Диск | 10 GB | 20 GB |
| ОС | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |

---

## Вариант 1: Быстрый запуск через скрипт

Скрипт `deploy.sh` автоматически установит всё необходимое и запустит приложение.

```bash
# 1. Загрузите проект на сервер (git clone или scp)
git clone https://github.com/alexeychekalin/AtlantaCRM-deploy.git /opt/atlanta-crm
cd /opt/atlanta-crm

# 2. Сделайте скрипт исполняемым и запустите
chmod +x deploy.sh
sudo ./deploy.sh
```

Скрипт выполнит:
- Установку Node.js 20, PostgreSQL 17, Nginx
- Создание базы данных и пользователя
- Применение схемы и всех миграций
- Заполнение тестовых данных (seed)
- Настройку Nginx (проксирование порт 80 → 3000)
- Создание systemd-сервиса для автозапуска
- Настройку UFW-файрвола

---

## Вариант 2: Пошаговое ручное развёртывание

### Шаг 1. Подготовка системы

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw
```

### Шаг 2. Установка Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v  # v20.x.x
npm -v
```

### Шаг 3. Установка PostgreSQL 17

```bash
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
sudo apt update
sudo apt install -y postgresql-17

# Проверить работу
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### Шаг 4. Создание базы данных

```bash
sudo -u postgres psql <<EOF
CREATE USER atlanta_user WITH PASSWORD 'ЗАМЕНИТЕ_НА_СВОЙ_ПАРОЛЬ';
CREATE DATABASE atlanta_crm OWNER atlanta_user;
GRANT ALL PRIVILEGES ON DATABASE atlanta_crm TO atlanta_user;
EOF
```

### Шаг 5. Загрузка и установка проекта

```bash
# Клонируйте проект
git clone https://github.com/alexeychekalin/AtlantaCRM-deploy.git /opt/atlanta-crm
cd /opt/atlanta-crm

# Установите зависимости
cd server && npm ci --omit=dev && cd ..
```

### Шаг 6. Настройка конфигурации

```bash
cat > /opt/atlanta-crm/server/.env <<EOF
DATABASE_URL=postgresql://atlanta_user:ЗАМЕНИТЕ_НА_СВОЙ_ПАРОЛЬ@localhost:5432/atlanta_crm
JWT_SECRET=$(openssl rand -hex 32)
PORT=3000
NODE_ENV=production
EOF
```

### Шаг 7. Инициализация базы данных

```bash
cd /opt/atlanta-crm

# Основная схема
PGPASSWORD=ЗАМЕНИТЕ_НА_СВОЙ_ПАРОЛЬ psql -h localhost -U atlanta_user -d atlanta_crm -f server/src/db/schema.sql

# Миграции (все безопасны для повторного запуска)
for migration in server/src/db/migration_*.sql; do
  echo "Applying: $migration"
  PGPASSWORD=ЗАМЕНИТЕ_НА_СВОЙ_ПАРОЛЬ psql -h localhost -U atlanta_user -d atlanta_crm -f "$migration"
done

# Тестовые данные (опционально)
cd server && node src/db/seed.js && cd ..
```

### Шаг 8. Проверка запуска

```bash
cd /opt/atlanta-crm
node server/src/index.js
# Должно вывести: 🚀 CRM «Атланта» запущена на http://localhost:3000
# Ctrl+C для остановки
```

### Шаг 9. Создание systemd-сервиса

```bash
sudo tee /etc/systemd/system/atlanta-crm.service > /dev/null <<EOF
[Unit]
Description=CRM Atlanta
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/atlanta-crm
ExecStart=/usr/bin/node server/src/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Установить владельца
sudo chown -R www-data:www-data /opt/atlanta-crm

# Запуск и автозагрузка
sudo systemctl daemon-reload
sudo systemctl enable atlanta-crm
sudo systemctl start atlanta-crm

# Проверить статус
sudo systemctl status atlanta-crm
```

### Шаг 10. Настройка Nginx (проксирование)

```bash
sudo apt install -y nginx

sudo tee /etc/nginx/sites-available/atlanta-crm > /dev/null <<'EOF'
server {
    listen 80;
    server_name ваш-домен.ru;  # Или IP сервера

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/atlanta-crm /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

### Шаг 11. Настройка файрвола

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS (для будущего SSL)
sudo ufw --force enable
```

### Шаг 12. SSL-сертификат (опционально, рекомендуется)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ваш-домен.ru
```

---

## Альтернатива: Docker Compose

Если на VPS установлен Docker, можно развернуть одной командой:

```bash
git clone https://github.com/alexeychekalin/AtlantaCRM-deploy.git /opt/atlanta-crm
cd /opt/atlanta-crm

# Запуск (PostgreSQL + App)
docker-compose up -d --build

# Инициализация данных
docker-compose exec app node server/src/db/seed.js
```

---

## 🔧 Управление сервисом

```bash
# Статус
sudo systemctl status atlanta-crm

# Перезапуск
sudo systemctl restart atlanta-crm

# Логи (последние 100 строк)
sudo journalctl -u atlanta-crm -n 100 --no-pager

# Логи в реальном времени
sudo journalctl -u atlanta-crm -f

# Остановка
sudo systemctl stop atlanta-crm
```

## 🔄 Обновление

```bash
cd /opt/atlanta-crm
git pull origin main

# Обновить зависимости
cd server && npm ci --omit=dev && cd ..

# Применить новые миграции
for migration in server/src/db/migration_*.sql; do
  PGPASSWORD=ваш_пароль psql -h localhost -U atlanta_user -d atlanta_crm -f "$migration"
done

# Перезапустить
sudo systemctl restart atlanta-crm
```

## 🛟 Резервное копирование

```bash
# Дамп базы
pg_dump -h localhost -U atlanta_user atlanta_crm > backup_$(date +%Y%m%d_%H%M%S).sql

# Бэкап загруженных файлов
tar czf uploads_backup_$(date +%Y%m%d).tar.gz /opt/atlanta-crm/server/uploads/

# Восстановление из дампа
psql -h localhost -U atlanta_user atlanta_crm < backup_XXXXXXXX.sql
```
