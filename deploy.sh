#!/bin/bash
# =============================================
# CRM «Атланта» — Автоматическое развёртывание
# Ubuntu 22.04 / 24.04 LTS
# =============================================

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# Проверка root
if [ "$EUID" -ne 0 ]; then
  err "Запустите скрипт с sudo: sudo ./deploy.sh"
fi

# Конфигурация
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_USER="www-data"
DB_NAME="atlanta_crm"
DB_USER="atlanta_user"
DB_PASS=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
PORT=3000

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║      CRM «Атланта» — Установка           ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "  Директория: $APP_DIR"
echo "  БД:         $DB_NAME"
echo "  Пользователь БД: $DB_USER"
echo ""

# Интерактивный ввод домена
read -p "Введите домен или IP сервера (или Enter для пропуска): " DOMAIN
DOMAIN=${DOMAIN:-_}

# ─────────────────────────────────────────────
step "1/8 • Обновление системы"
# ─────────────────────────────────────────────
apt update && apt upgrade -y
apt install -y curl git ufw lsb-release gnupg2 ca-certificates
log "Система обновлена"

# ─────────────────────────────────────────────
step "2/8 • Установка Node.js 20"
# ─────────────────────────────────────────────
if command -v node &>/dev/null && node -v | grep -q "v20"; then
  log "Node.js $(node -v) уже установлен"
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
  log "Node.js $(node -v) установлен"
fi

# ─────────────────────────────────────────────
step "3/8 • Установка PostgreSQL 17"
# ─────────────────────────────────────────────
if command -v psql &>/dev/null; then
  log "PostgreSQL уже установлен: $(psql --version)"
else
  sh -c "echo 'deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main' > /etc/apt/sources.list.d/pgdg.list"
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
  apt update
  apt install -y postgresql-17
  log "PostgreSQL 17 установлен"
fi
systemctl enable postgresql
systemctl start postgresql
log "PostgreSQL запущен"

# ─────────────────────────────────────────────
step "4/8 • Настройка базы данных"
# ─────────────────────────────────────────────
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  warn "Пользователь $DB_USER уже существует — обновляю пароль"
  sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';"
else
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
  log "Пользователь $DB_USER создан"
fi

# Создать БД если не существует
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  warn "База $DB_NAME уже существует"
else
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  log "База $DB_NAME создана"
fi

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -d $DB_NAME -c "GRANT ALL ON SCHEMA public TO $DB_USER;"
log "Права выданы"

# Применить схему (через peer auth — без пароля)
log "Применяю схему БД..."
sudo -u postgres psql -d $DB_NAME -f "$APP_DIR/server/src/db/schema.sql" 2>&1 | tail -5
log "Схема применена"

# Применить миграции
log "Применяю миграции..."
for migration in "$APP_DIR"/server/src/db/migration_*.sql; do
  if [ -f "$migration" ]; then
    sudo -u postgres psql -d $DB_NAME -f "$migration" 2>&1 | tail -2
    log "  $(basename $migration)"
  fi
done
log "Все миграции применены"

# ─────────────────────────────────────────────
step "5/8 • Установка зависимостей и настройка"
# ─────────────────────────────────────────────
cd "$APP_DIR/server"
npm install --omit=dev
cd "$APP_DIR"
log "npm-зависимости установлены"

# Создать .env
cat > "$APP_DIR/server/.env" <<EOF
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
JWT_SECRET=$JWT_SECRET
PORT=$PORT
NODE_ENV=production
EOF
log ".env создан"

# Создать директории uploads
mkdir -p "$APP_DIR/server/uploads"/{images,drawings,avatars,documents}
log "Директории uploads созданы"

# Заполнить тестовые данные
log "Заполняю тестовые данные (seed)..."
cd "$APP_DIR/server"
node src/db/seed.js 2>/dev/null || warn "Seed уже был применён или произошла ошибка"
cd "$APP_DIR"
log "Данные загружены"

# Права
chown -R $APP_USER:$APP_USER "$APP_DIR"
log "Права установлены ($APP_USER)"

# ─────────────────────────────────────────────
step "6/8 • Создание systemd-сервиса"
# ─────────────────────────────────────────────
cat > /etc/systemd/system/atlanta-crm.service <<EOF
[Unit]
Description=CRM Atlanta
After=network.target postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server/src/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable atlanta-crm
systemctl start atlanta-crm
sleep 2

if systemctl is-active --quiet atlanta-crm; then
  log "Сервис atlanta-crm запущен ✓"
else
  err "Сервис не запустился! Проверьте: journalctl -u atlanta-crm -n 50"
fi

# ─────────────────────────────────────────────
step "7/8 • Настройка Nginx"
# ─────────────────────────────────────────────
apt install -y nginx

SERVER_NAME="$DOMAIN"
if [ "$DOMAIN" = "_" ]; then
  SERVER_NAME="_"
fi

cat > /etc/nginx/sites-available/atlanta-crm <<NGINX
server {
    listen 80;
    server_name $SERVER_NAME;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/atlanta-crm /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
log "Nginx настроен"

# ─────────────────────────────────────────────
step "8/8 • Настройка файрвола"
# ─────────────────────────────────────────────
ufw allow 22/tcp   >/dev/null 2>&1
ufw allow 80/tcp   >/dev/null 2>&1
ufw allow 443/tcp  >/dev/null 2>&1
ufw --force enable >/dev/null 2>&1
log "UFW настроен (22, 80, 443)"

# ─────────────────────────────────────────────
# Итоги
# ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     ✅ Установка завершена успешно!       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "  🌐 Сайт:     http://${DOMAIN//_/$(hostname -I | awk '{print $1}')}"
echo "  📦 Директория: $APP_DIR"
echo "  🗄️  БД:        $DB_NAME"
echo ""
echo "  👤 Логин:     admin"
echo "  🔑 Пароль:    admin123"
echo ""
echo -e "  ${YELLOW}⚠️  Сохраните эти данные:${NC}"
echo "  DB_USER:     $DB_USER"
echo "  DB_PASS:     $DB_PASS"
echo "  JWT_SECRET:  $JWT_SECRET"
echo ""
echo "  Управление сервисом:"
echo "    sudo systemctl status atlanta-crm"
echo "    sudo systemctl restart atlanta-crm"
echo "    sudo journalctl -u atlanta-crm -f"
echo ""

if [ "$DOMAIN" != "_" ]; then
  echo -e "  ${CYAN}💡 Для SSL (HTTPS):${NC}"
  echo "    sudo apt install -y certbot python3-certbot-nginx"
  echo "    sudo certbot --nginx -d $DOMAIN"
  echo ""
fi
