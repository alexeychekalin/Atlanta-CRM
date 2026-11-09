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

# 2. Установить зависимости (нужны для раннера миграций)
echo -e "${CYAN}━━━ 2/4 • npm install ━━━${NC}"
cd "$APP_DIR/server"
npm install --omit=dev 2>&1 | tail -3
cd "$APP_DIR"
log "Зависимости обновлены"

echo -e "${CYAN}━━━ 2.1 • Миграция БД ━━━${NC}"
cd "$APP_DIR/server"
if node src/db/migrate.js; then
  log "Миграции применены"
else
  err "Ошибка миграции БД"
fi

# Обновить роли (добавляет новые разделы, не сбрасывая настройки прав)
if [ -f "$APP_DIR/server/src/db/migrate_roles.js" ]; then
  node src/db/migrate_roles.js >/dev/null 2>&1 && log "Роли обновлены" || warn "Миграция ролей не выполнена"
fi

# Наполнение базы одним шагом (src/db/data.js): контрагенты из карточек
# предприятий + каталог АТЛАНТА-26. Оба импорта идемпотентны.
# Каталог обновляется, только если он был включён при установке
# (маркер server/.catalog-enabled) или передан WITH_CATALOG=1.
if [ -f "$APP_DIR/server/.catalog-enabled" ] || [ "${WITH_CATALOG:-0}" = "1" ]; then
  export WITH_CATALOG=1
  DATA_LABEL="контрагенты + каталог"
else
  export WITH_CATALOG=0
  DATA_LABEL="контрагенты"
fi
export SKIP_PRESEED="${SKIP_PRESEED:-0}"

if [ -f "$APP_DIR/server/src/db/data.js" ]; then
  if node src/db/data.js; then
    if [ "$WITH_CATALOG" = "1" ]; then
      touch "$APP_DIR/server/.catalog-enabled"
    fi
    log "Данные обновлены: ${DATA_LABEL}"
  else
    warn "Наполнение: часть данных не обновилась (см. сообщения выше)"
  fi
fi
cd "$APP_DIR"

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
