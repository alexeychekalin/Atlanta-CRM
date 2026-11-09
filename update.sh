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

# 0. Версия кода в папке
# update.sh не делает git pull — это отдельный шаг. Но если репозиторий стоит
# не на той ветке, `git pull` пишет «Already up to date», и обновления молча
# не приезжают. Поэтому печатаем ветку, коммит и все ветки origin.
echo -e "${CYAN}━━━ 0/5 • Версия кода ━━━${NC}"
cd "$APP_DIR"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '—')"
  COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo '—')"
  SUBJECT="$(git log -1 --pretty=%s 2>/dev/null | cut -c1-60)"
  echo "    ветка ${BRANCH} · коммит ${COMMIT} · ${SUBJECT}"

  git fetch --quiet origin 2>/dev/null || warn "git fetch не удался (сеть или доступ к origin)"

  echo "    ветки в origin:"
  git for-each-ref --format='%(refname:short) %(objectname:short) %(contents:subject)' refs/remotes/origin \
    | grep -v '^origin/HEAD ' | sed 's|origin/|      |' | cut -c1-100

  UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [ -z "$UPSTREAM" ]; then
    if git rev-parse --verify --quiet "origin/${BRANCH}" >/dev/null; then
      warn "Ветка ${BRANCH} не следит за origin/${BRANCH} — git pull ничего не притянет"
      warn "  git branch --set-upstream-to=origin/${BRANCH} ${BRANCH}"
    else
      warn "Ветка ${BRANCH} не следит за origin, и такой ветки в origin нет"
      warn "  git fetch origin && git branch -r   # на какой ветке должен стоять сервер"
    fi
  else
    BEHIND="$(git rev-list --count "HEAD..${UPSTREAM}" 2>/dev/null || echo 0)"
    AHEAD="$(git rev-list --count "${UPSTREAM}..HEAD" 2>/dev/null || echo 0)"
    if [ "$BEHIND" != "0" ]; then
      warn "Позади ${UPSTREAM} на ${BEHIND} коммит(ов) — сначала git pull, потом update.sh"
    else
      log "Код свежий: ${UPSTREAM} не впереди"
    fi
    if [ "$AHEAD" != "0" ]; then
      warn "В ${BRANCH} есть ${AHEAD} коммит(ов), которых нет в ${UPSTREAM}"
      warn "  так бывает после git reset --hard на другую ветку: git pull молчит, обновления не едут"
    fi
  fi

  DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  [ "$DIRTY" != "0" ] && warn "Незакоммиченных изменений: ${DIRTY} — git reset --hard их сотрёт (update.sh — нет)"
fi

# 1. Остановить сервис
echo -e "${CYAN}━━━ 1/5 • Остановка сервиса ━━━${NC}"
systemctl stop atlanta-crm 2>/dev/null || warn "Сервис не был запущен"
log "Сервис остановлен"

# 2. Установить зависимости (нужны для раннера миграций)
echo -e "${CYAN}━━━ 2/5 • Зависимости ━━━${NC}"
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

echo -e "${CYAN}━━━ 3/5 • Данные ━━━${NC}"
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
echo -e "${CYAN}━━━ 4/5 • Запуск сервиса ━━━${NC}"
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

# 5. Сайт завода: собрать и выложить в веб-корень.
# Включается сам, если в SITE_ROOT уже лежит наш сайт (index.html + search.json),
# или флагом WITH_SITE=1; выключается WITH_SITE=0. FTP не нужен: копирование
# идёт по локальным путям, а в приёмник уходит только изменившееся.
SITE_ROOT="${SITE_ROOT:-/var/www/atlanta}"
SITE_MODE="${WITH_SITE:-auto}"
SITE_AUTO=0
if [ -f "$SITE_ROOT/index.html" ] && [ -f "$SITE_ROOT/search.json" ]; then
  SITE_AUTO=1
fi
if [ -f "$APP_DIR/server/.site-enabled" ]; then
  SITE_AUTO=1
fi

if [ "$SITE_MODE" = "0" ]; then
  echo -e "${CYAN}━━━ 5/5 • Сайт завода ━━━${NC}"
  log "пропущен: WITH_SITE=0"
elif [ "$SITE_MODE" = "1" ] || [ "$SITE_AUTO" = "1" ]; then
  echo -e "${CYAN}━━━ 5/5 • Сайт завода ━━━${NC}"
  cd "$APP_DIR"
  if ! python3 -c "import PIL" >/dev/null 2>&1; then
    warn "нет Pillow — сайт не собран: pip3 install --break-system-packages pillow"
    warn "CRM обновлена, сайт остался прежним"
  elif python3 site/build.py ${SITE_DOMAIN:+--domain="$SITE_DOMAIN"} --publish "$SITE_ROOT" --prune; then
    touch "$APP_DIR/server/.site-enabled"
    log "Сайт собран и выложен в $SITE_ROOT"
  else
    warn "Сайт не выложен (см. сообщения выше) — CRM при этом работает"
  fi
else
  echo -e "${CYAN}━━━ 5/5 • Сайт завода ━━━${NC}"
  warn "сайта нет в $SITE_ROOT — выкладка пропущена"
  warn "  разово: WITH_SITE=1 ./update.sh   или   ./scripts/deploy-site.sh root@host"
fi

echo ""
echo -e "${GREEN}✅ Обновление завершено!${NC}"
echo ""
