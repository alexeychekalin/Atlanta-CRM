#!/bin/bash
# =============================================
# nginx для двух хостов: сайт завода + CRM
#
#   сайт  → основной домен (статика из site/dist)
#   CRM   → поддомен crm.<домен> (прокси на 127.0.0.1:3000)
#
# Запуск (от root, из папки проекта):
#   sudo DOMAIN=atlanta.ru ./scripts/setup-nginx.sh
#   sudo DOMAIN=atlanta.ru CRM_HOST=crm.atlanta.ru ./scripts/setup-nginx.sh
#   sudo ./scripts/setup-nginx.sh          # без домена: сайт на :80 (IP),
#                                          # CRM на :8080
#
# Переменные:
#   DOMAIN      основной домен без схемы (atlanta.ru). Пусто или IP —
#               режим «без домена»: сайт на :80, CRM на :8080
#   CRM_HOST    хост CRM (по умолчанию crm.$DOMAIN; в режиме без домена — _)
#   SITE_ROOT   корень сайта (по умолчанию /var/www/atlanta)
#   APP_PORT    порт Node.js (по умолчанию 3000)
#   NO_SITE=1   не ставить конфиг сайта
#   NO_CRM=1    не ставить конфиг CRM
#
# Скрипт идемпотентен: конфиги перезаписываются, симлинки обновляются,
# nginx перезагружается только после успешного nginx -t.
# =============================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# переменные ниже нужны для тестового прогона без root и без nginx;
# в обычной работе их не задают
if [ "$EUID" -ne 0 ] && [ "${ALLOW_NONROOT:-0}" != "1" ]; then
  err "Запустите с sudo"
fi
if ! command -v nginx >/dev/null 2>&1 && [ "${ALLOW_NONROOT:-0}" != "1" ]; then
  err "nginx не установлен: apt install -y nginx"
fi

NGINX_ROOT="${NGINX_ROOT:-/etc/nginx}"
SITES_AVAILABLE="$NGINX_ROOT/sites-available"
SITES_ENABLED="$NGINX_ROOT/sites-enabled"

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATES="$APP_DIR/deploy/nginx"
[ -f "$TEMPLATES/site.conf" ] || err "нет шаблона $TEMPLATES/site.conf"

DOMAIN="${DOMAIN:-}"
CRM_HOST="${CRM_HOST:-}"
SITE_ROOT="${SITE_ROOT:-/var/www/atlanta}"
APP_PORT="${APP_PORT:-3000}"

# домен считаем настоящим, если это не пусто, не «_» и не IP
is_domain() {
  local value="$1"
  [ -n "$value" ] && [ "$value" != "_" ] || return 1
  [[ "$value" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] && return 1
  [[ "$value" == *.* ]] || return 1
  return 0
}

if is_domain "$DOMAIN"; then
  MODE="domain"
  WWW="www.$DOMAIN"
  CRM_HOST="${CRM_HOST:-crm.$DOMAIN}"
  SITE_SERVER_NAME="$DOMAIN $WWW"
  CRM_LISTEN="80"
else
  MODE="ip"
  CRM_HOST="${CRM_HOST:-_}"
  SITE_SERVER_NAME="_"
  CRM_LISTEN="8080"
  [ -n "$DOMAIN" ] && [ "$DOMAIN" != "_" ] && warn "«$DOMAIN» не похож на домен — режим без домена"
fi

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
SERVER_IP=${SERVER_IP:-127.0.0.1}

render() {
  # render <шаблон> <файл назначения>
  sed -e "s|__SERVER_NAME__|$SITE_SERVER_NAME|g" \
      -e "s|__CRM_HOST__|$CRM_HOST|g" \
      -e "s|__SITE_ROOT__|$SITE_ROOT|g" \
      -e "s|__LISTEN__|$CRM_LISTEN|g" \
      -e "s|__APP_PORT__|$APP_PORT|g" \
      "$1" > "$2"
}

step "1/3 • Конфиги"
mkdir -p "$SITE_ROOT" "$SITES_AVAILABLE" "$SITES_ENABLED"

if [ "${NO_SITE:-0}" != "1" ]; then
  render "$TEMPLATES/site.conf" "$SITES_AVAILABLE/atlanta-site"
  # имя с префиксом 00-: конфиг читается первым и становится сервером
  # по умолчанию для :80, поэтому голый IP открывает сайт, а не CRM
  rm -f "$SITES_ENABLED/atlanta-site"
  ln -sf "$SITES_AVAILABLE/atlanta-site" "$SITES_ENABLED/00-atlanta-site"
  log "сайт: server_name $SITE_SERVER_NAME → $SITE_ROOT"
fi

if [ "${NO_CRM:-0}" != "1" ]; then
  render "$TEMPLATES/crm.conf" "$SITES_AVAILABLE/atlanta-crm"
  ln -sf "$SITES_AVAILABLE/atlanta-crm" "$SITES_ENABLED/atlanta-crm"
  log "CRM: server_name $CRM_HOST → 127.0.0.1:$APP_PORT"
fi

# конфиг прежней версии deploy.sh (один server block на CRM) убираем
if [ -e "$SITES_ENABLED/atlanta" ] || [ -e "$SITES_AVAILABLE/atlanta" ]; then
  rm -f "$SITES_ENABLED/atlanta" "$SITES_AVAILABLE/atlanta"
  log "удалён старый конфиг atlanta"
fi

step "2/3 • Проверка"
rm -f "$SITES_ENABLED/default"

if [ "${NGINX_RELOAD:-1}" = "1" ]; then
  nginx -t || err "nginx -t не прошёл — конфиги не применены"
  log "синтаксис в порядке"

  step "3/3 • Перезагрузка"
  systemctl reload nginx 2>/dev/null || systemctl restart nginx
  log "nginx перезагружен"
else
  log "проверка и перезагрузка пропущены (NGINX_RELOAD=0)"
fi

echo ""
if [ "$MODE" = "domain" ]; then
  echo -e "  ${CYAN}Сайт:${NC}  http://$DOMAIN  (и http://$WWW)"
  echo -e "  ${CYAN}CRM:${NC}   http://$CRM_HOST"
  echo ""
  echo "  HTTPS одной командой:"
  echo "    sudo apt install -y certbot python3-certbot-nginx"
  echo "    sudo certbot --nginx -d $DOMAIN -d $WWW -d $CRM_HOST"
else
  echo -e "  ${CYAN}Сайт:${NC}  http://$SERVER_IP"
  echo -e "  ${CYAN}CRM:${NC}   http://$SERVER_IP:$CRM_LISTEN"
  echo ""
  echo "  Домена нет — после появления DNS запустите заново:"
  echo "    sudo DOMAIN=ваш-домен.ru ./scripts/setup-nginx.sh"
fi
echo ""
echo "  Проверить:"
echo "    curl -I http://127.0.0.1/            # сайт"
echo "    curl -I http://127.0.0.1:$CRM_LISTEN/api/health   # CRM"
echo ""
