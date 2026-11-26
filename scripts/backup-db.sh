#!/bin/bash
# =============================================
# Бэкап CRM «Атланта» перед заливкой каталога
#
# Снимает дамп базы (вместе с ролями и владельцами) и архив загруженных файлов,
# затем проверяет, что дамп читается и содержит таблицы каталога. Битый бэкап
# хуже отсутствующего: он создаёт уверенность, что откат есть.
#
# Запуск на сервере (там, где крутится CRM):
#   cd /opt/atlanta-crm && sudo ./scripts/backup-db.sh
#   sudo ./scripts/backup-db.sh --no-uploads          # только база
#   sudo ./scripts/backup-db.sh --dir /mnt/backups    # другой каталог
#
# Что важно знать про восстановление:
#   • дамп в формате custom (-Fc) — восстанавливается через pg_restore,
#     с --clean --if-exists: старые таблицы удаляются, данные заменяются;
#   • заводские фото и вложения клиентов лежат не в базе, а в
#     server/uploads/ — без них каталог восстановится без картинок.
#
# Файлы: <dir>/atlanta_crm_<дата>.dump и <dir>/uploads_<дата>.tar.gz,
# рядом .sha256 для проверки целостности при переносе.
# =============================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$APP_DIR/server/.env"
OUT_DIR="$APP_DIR/backups"
WITH_UPLOADS=1
KEEP=7

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) OUT_DIR="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    --no-uploads) WITH_UPLOADS=0; shift ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) err "неизвестный аргумент: $1 (см. --help)" ;;
  esac
done

[ -f "$ENV_FILE" ] || err "нет $ENV_FILE — укажите DATABASE_URL в server/.env"

# DATABASE_URL берём из server/.env: тем же адресом пользуется CRM.
DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)"
[ -n "$DB_URL" ] || err "в $ENV_FILE нет DATABASE_URL"

# В DATABASE_URL спецсимволы пароля закодированы (%40 = @) — разворачиваем
# обратно, иначе PGPASSWORD уйдёт с процентами и сервер ответит «пароль неверен».
urldecode() {
  local s="${1//+/ }"
  # Обратный слэш экранируем первым, затем %XX -> \xXX: printf %b соберёт символ
  s="${s//\\/\\\\}"
  s="${s//%/\\x}"
  printf '%b' "$s"
}

# pg_dump не понимает URL вида postgresql://… — раскладываем на части.
# Пароль передаётся только через PGPASSWORD: в командной строке его видно в ps.
parse_url() {
  local url="$1"
  local rest="${url#*://}"
  local creds="${rest%%@*}"
  local hostpart="${rest#*@}"
  local user="${creds%%:*}"
  local pass="${creds#*:}"
  if [ "$pass" = "$creds" ]; then pass=""; fi        # пароля нет
  DB_USER="$(urldecode "$user")"
  DB_PASS="$(urldecode "$pass")"
  DB_HOST="${hostpart%%/*}"
  DB_NAME="${hostpart#*/}"
  DB_NAME="${DB_NAME%%\?*}"
  DB_HOST="${DB_HOST%%:*}"
  DB_PORT="${hostpart%%/*}"; DB_PORT="${DB_PORT##*:}"
  case "$DB_PORT" in
    ''|*[!0-9]*) DB_PORT=5432 ;;
  esac
  if [ -z "$DB_HOST" ]; then DB_HOST=localhost; fi
}
parse_url "$DB_URL"

command -v pg_dump >/dev/null 2>&1 || err "нет pg_dump. Установите: sudo apt install postgresql-client"

STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
mkdir -p "$OUT_DIR"
DUMP="$OUT_DIR/atlanta_crm_${STAMP}.dump"

echo -e "${CYAN}━━━ Бэкап базы ${DB_NAME}@${DB_HOST}:${DB_PORT} ━━━${NC}"

# 1. Дамп. -Fc — сжатый custom-формат: восстанавливается выборочно и проверяется
#    на месте через pg_restore --list. Владельцы и права сохраняются (это
#    поведение по умолчанию), чтобы после восстановления таблицы не оказались
#    за другим пользователем.
export PGPASSWORD="$DB_PASS"
PG_ARGS=(-h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -Fc)

if ! pg_dump "${PG_ARGS[@]}" -f "$DUMP" "$DB_NAME" 2>/tmp/pg_dump_err; then
  if grep -qi 'server version mismatch' /tmp/pg_dump_err; then
    cat /tmp/pg_dump_err >&2
    warn "pg_dump старее сервера. Обновите клиент: sudo apt install postgresql-client"
  else
    cat /tmp/pg_dump_err >&2
  fi
  rm -f "$DUMP"
  err "pg_dump завершился с ошибкой — бэкапа нет, ничего не заливайте"
fi
[ -s "$DUMP" ] || { rm -f "$DUMP"; err "дамп пустой"; }
log "дамп: $DUMP ($(du -h "$DUMP" | cut -f1))"

# 2. Проверка, что дамп читается и в нём есть то, что мы боимся потерять.
if pg_restore --list "$DUMP" > /tmp/pg_list.txt 2>/dev/null; then
  TABLES=$(grep -c 'TABLE DATA' /tmp/pg_list.txt || true)
  log "в дампе таблиц с данными: $TABLES"
  for t in components component_modifications clients drawings leads; do
    if ! grep -q "TABLE DATA public $t " /tmp/pg_list.txt; then
      warn "в дампе нет таблицы $t — проверьте $DB_NAME"
    fi
  done
else
  err "pg_restore не смог прочитать дамп — файл повреждён"
fi

# 3. Загрузки: фото каталога, чертежи, документы клиентов.
if [ "$WITH_UPLOADS" = "1" ]; then
  UP_DIR="$APP_DIR/server/uploads"
  if [ -d "$UP_DIR" ] && [ -n "$(ls -A "$UP_DIR" 2>/dev/null)" ]; then
    TAR="$OUT_DIR/uploads_${STAMP}.tar.gz"
    if ! tar czf "$TAR" -C "$APP_DIR/server" uploads 2>/dev/null; then
      err "не удалось упаковать uploads"
    fi
    log "загрузки: $TAR ($(du -h "$TAR" | cut -f1))"
    tar tzf "$TAR" >/dev/null 2>&1 || err "архив загрузок не читается"
  else
    warn "server/uploads пуст — архива загрузок нет"
  fi
fi

# 4. Контрольные суммы: при переносе на другую машину видно, что доехало целым.
( cd "$OUT_DIR" && sha256sum atlanta_crm_${STAMP}.dump > atlanta_crm_${STAMP}.dump.sha256 2>/dev/null || true
  [ -f "uploads_${STAMP}.tar.gz" ] && sha256sum uploads_${STAMP}.tar.gz > uploads_${STAMP}.tar.gz.sha256 2>/dev/null || true )

# 5. Старые бэкапы: держим последние N, иначе диск кончится молча.
if [ "$KEEP" -gt 0 ]; then
  # в while с set -e последняя команда должна завершаться успешно,
  # иначе цикл «упадёт» на пустом выводе ls
  ls -1t "$OUT_DIR"/atlanta_crm_*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old" "${old}.sha256"
    warn "удалён старый дамп: $(basename "$old")"
    true
  done || true
  ls -1t "$OUT_DIR"/uploads_*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old" "${old}.sha256"
    warn "удалён старый архив: $(basename "$old")"
    true
  done || true
fi

echo ""
echo -e "${GREEN}✅ Бэкап готов${NC}"
echo "   каталог: $OUT_DIR"
echo ""
echo "Восстановление, если после заливки что-то пошло не так:"
echo "   cd $APP_DIR"
echo "   sudo systemctl stop atlanta-crm"
echo "   PGPASSWORD='<пароль из server/.env>' pg_restore -h $DB_HOST -U $DB_USER -d $DB_NAME \\"
echo "     --clean --if-exists --single-transaction \"$DUMP\""
echo "   [ -f \"${OUT_DIR}/uploads_${STAMP}.tar.gz\" ] && tar xzf \"${OUT_DIR}/uploads_${STAMP}.tar.gz\" -C $APP_DIR/server"
echo "   sudo systemctl start atlanta-crm"
echo ""
echo "Целостность перед восстановлением:"
echo "   cd $OUT_DIR && sha256sum -c atlanta_crm_${STAMP}.dump.sha256"
