#!/bin/bash
# =============================================
# Выгрузка сайта завода на сервер
#
# Собирает site/dist локально и заливает по rsync в SITE_ROOT на VPS.
# На сервере должны быть nginx и конфиг сайта (deploy/nginx/site.conf —
# его раскладывает scripts/setup-nginx.sh).
#
# Запуск с машины разработчика, из папки проекта:
#   ./scripts/deploy-site.sh root@103.80.87.197 --domain https://atlanta.ru
#   ./scripts/deploy-site.sh root@103.80.87.197            # домен из content.json
#   ./scripts/deploy-site.sh root@103.80.87.197 --no-build # залить готовый site/dist
#   ./scripts/deploy-site.sh root@host --root /srv/site --dry-run
#
# Флаг --delete у rsync стирает на сервере всё, чего нет в сборке, —
# поэтому root сайта не должен совпадать с папкой проекта.
# =============================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET=""
DOMAIN=""
ROOT="/var/www/atlanta"
BUILD=1
DRY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)   DOMAIN="$2"; shift 2 ;;
    --root)     ROOT="$2"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --dry-run)  DRY="--dry-run"; shift ;;
    -h|--help)  awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "$0"; exit 0 ;;
    -*)         err "неизвестный флаг: $1" ;;
    *)          TARGET="$1"; shift ;;
  esac
done

[ -n "$TARGET" ] || err "укажите сервер: ./scripts/deploy-site.sh root@IP --domain https://домен"

command -v rsync >/dev/null 2>&1 || err "нет rsync: apt install -y rsync (или brew install rsync)"

cd "$APP_DIR"

if [ "$BUILD" = "1" ]; then
  echo -e "${CYAN}━━━ Сборка сайта ━━━${NC}"
  python3 -c "import PIL" 2>/dev/null || {
    warn "нет Pillow — фото не пережмутся, ставлю подсказку:"
    warn "  pip install --break-system-packages pillow"
    err  "установите Pillow или запустите с --no-build"
  }
  python3 site/build.py ${DOMAIN:+--domain "$DOMAIN"}
  log "собрано: $(find site/dist -type f | wc -l) файлов, $(du -sh site/dist | cut -f1)"
fi

[ -f site/dist/index.html ] || err "нет site/dist/index.html — сначала соберите сайт"

# root на сервере — обычный rsync; другой пользователь — через sudo
REMOTE_PATH="rsync"
case "$TARGET" in
  root@*) ;;
  *) REMOTE_PATH="sudo rsync" ;;
esac

echo -e "${CYAN}━━━ Выгрузка на $TARGET:$ROOT ━━━${NC}"
if [ -n "$DRY" ]; then
  rsync -az --delete --dry-run --itemize-changes \
        --rsync-path="$REMOTE_PATH" site/dist/ "$TARGET:$ROOT/"
  warn "это был пробный прогон, файлы не отправлены"
  exit 0
fi

# сначала создаём каталог и права, потом заливаем
ssh "$TARGET" "mkdir -p '$ROOT' && chmod 755 '$ROOT'"
rsync -az --delete --rsync-path="$REMOTE_PATH" site/dist/ "$TARGET:$ROOT/"
log "сайт выгружен"

echo -e "${CYAN}━━━ Проверка ━━━${NC}"
ssh "$TARGET" "test -f '$ROOT/index.html' && echo '  index.html на месте'" \
  || warn "index.html не найден в $ROOT"
echo ""
echo "  Открыть:  http://$(echo "$TARGET" | cut -d@ -f2)/"
echo "  Если домен уже указывает на сервер:"
echo "    sudo DOMAIN=ваш-домен.ru ./scripts/setup-nginx.sh   # на сервере"
echo ""
