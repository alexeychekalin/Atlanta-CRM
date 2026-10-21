#!/bin/bash
# =============================================
# CRM «Атланта» — Обновление на сервере
# Запускать с sudo из директории проекта
# =============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_NAME="atlanta_crm"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║    CRM «Атланта» — Обновление           ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# 1. Остановить сервис
echo -e "${CYAN}━━━ 1/4 • Остановка сервиса ━━━${NC}"
systemctl stop atlanta-crm 2>/dev/null || warn "Сервис не был запущен"
log "Сервис остановлен"

# 2. Применить миграцию БД
echo -e "${CYAN}━━━ 2/4 • Миграция БД ━━━${NC}"
sudo -u postgres psql -d $DB_NAME -f "$APP_DIR/server/src/db/migration_sync_v2.sql" 2>&1 | tail -10
log "Миграция применена"

# 3. Установить зависимости (если изменились)
echo -e "${CYAN}━━━ 3/4 • npm install ━━━${NC}"
cd "$APP_DIR/server"
npm install --omit=dev 2>&1 | tail -3
cd "$APP_DIR"
log "Зависимости обновлены"

# 4. Запустить сервис
echo -e "${CYAN}━━━ 4/4 • Запуск сервиса ━━━${NC}"
systemctl start atlanta-crm
sleep 2

if systemctl is-active --quiet atlanta-crm; then
  log "Сервис atlanta-crm запущен ✓"
else
  err "Сервис не запустился! journalctl -u atlanta-crm -n 50"
fi

# Выдать права на новые таблицы
DB_USER=$(grep DATABASE_URL "$APP_DIR/server/.env" | sed 's|.*://||' | sed 's|:.*||')
if [ -n "$DB_USER" ]; then
  sudo -u postgres psql -d $DB_NAME -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO $DB_USER;" 2>/dev/null
  sudo -u postgres psql -d $DB_NAME -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;" 2>/dev/null
  log "Права выданы для $DB_USER"
fi

echo ""
echo -e "${GREEN}✅ Обновление завершено!${NC}"
echo ""
