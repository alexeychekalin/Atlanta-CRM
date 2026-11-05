#!/bin/bash
# =============================================
# Развёртывание CRM «Атланта» на чистом VPS
#
# Скрипт запускается на самом сервере от root. Его приносит
# .github/workflows/vps-deploy.yml (SSH из GitHub Actions) или человек
# копирует вручную. Всё, что делает скрипт: ставит git, забирает ветку
# в /opt/atlanta-crm и вызывает deploy.sh с нужным набором данных.
#
# Переменные (все необязательные):
#   BRANCH       ветка репозитория (по умолчанию main)
#   REPO         адрес репозитория
#   APP_DIR      куда ставить (по умолчанию /opt/atlanta-crm)
#   DOMAIN       домен или IP для nginx (по умолчанию — первый IP сервера)
#   WITH_CATALOG 1 — каталог АТЛАНТА-26 (полное наполнение)
#   SEED_DEMO    0 — без демо-записей
#   SKIP_PRESEED 1 — без клиентов из предзаполнения
# =============================================
set -euo pipefail

BRANCH="${BRANCH:-main}"
REPO="${REPO:-https://github.com/alexeychekalin/Atlanta-CRM.git}"
APP_DIR="${APP_DIR:-/opt/atlanta-crm}"
export WITH_CATALOG="${WITH_CATALOG:-0}"
export SEED_DEMO="${SEED_DEMO:-1}"
export SKIP_PRESEED="${SKIP_PRESEED:-0}"
export DEBIAN_FRONTEND=noninteractive

log() { echo -e "\n\033[1;36m━━━ $* ━━━\033[0m"; }

# копия журнала на сервере: скрипт запускается отвязанным от SSH-канала,
# а раннер потом дочитывает этот файл короткими запросами
exec > >(tee -a /root/vps-provision.log) 2>&1
# маркер окончания — по нему мост понимает, что работа закончена
trap 'rc=$?; sleep 1; echo "__PROVISION_DONE__ $rc" >> /root/vps-provision.log' EXIT

[ "$EUID" -eq 0 ] || { echo "нужен root"; exit 1; }

export DOMAIN="${DOMAIN:-$(hostname -I 2>/dev/null | awk '{print $1}')}"

log "Сервер"
echo "  host:      $(hostname)"
echo "  ОС:        $(. /etc/os-release && echo "$PRETTY_NAME")"
echo "  ядро:      $(uname -r)"
echo "  CPU/RAM:   $(nproc) ядер / $(free -m | awk '/Mem:/ {print $2}') МБ"
echo "  диск:      $(df -h / | awk 'NR==2 {print $4}') свободно"
echo "  ветка:     $BRANCH"
echo "  каталог:   $APP_DIR"
echo "  каталог АТЛАНТА-26: $WITH_CATALOG (0 — без каталога)"

log "git"
if ! command -v git >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq git ca-certificates
fi
echo "  $(git --version)"

log "Код"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git remote set-url origin "$REPO"
  git fetch --prune origin
  git checkout -f -B "$BRANCH" "origin/$BRANCH"
  echo "  обновлено до $(git log --oneline -1)"
else
  mkdir -p "$(dirname "$APP_DIR")"
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$APP_DIR"
  cd "$APP_DIR"
  echo "  склонировано: $(git log --oneline -1)"
fi

chmod +x "$APP_DIR/deploy.sh" "$APP_DIR/update.sh" 2>/dev/null || true

# если прошлый запуск оборвался посреди apt — доводим пакеты до консистентного вида
if dpkg --audit 2>/dev/null | grep -q .; then
  echo "  обнаружены незавершённые пакеты — исправляю"
  dpkg --configure -a || true
fi
rm -f /var/lib/apt/lists/lock /var/cache/apt/archives/lock 2>/dev/null || true

log "Установка (deploy.sh)"
cd "$APP_DIR"
./deploy.sh

log "Проверка"
sleep 3
code=$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1/api/health" || true)
echo "  nginx → /api/health: ${code:-нет ответа}"
code=$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000/api/health" || true)
echo "  приложение → :3000/api/health: ${code:-нет ответа}"

cd "$APP_DIR/server"
node -e "
const db = require('./src/db');
(async () => {
  for (const t of ['clients', 'orders', 'components', 'component_modifications',
                   'component_categories', 'component_images'])
    console.log('  ' + t.padEnd(24), (await db.query('SELECT count(*)::int c FROM ' + t)).rows[0].c);
  const harness = await db.query(
    \"SELECT count(DISTINCT c.id)::int AS families, count(cm.id)::int AS executions \" +
    \"FROM components c JOIN component_categories cc ON cc.id = c.category_id \" +
    \"LEFT JOIN component_modifications cm ON cm.component_id = c.id \" +
    \"WHERE cc.name = 'Электропровода (жгуты)'\");
  console.log('  жгуты'.padEnd(26), harness.rows[0].families + ' семейств / ' + harness.rows[0].executions + ' исполнений');
  const withPhotos = await db.query('SELECT count(*)::int c FROM component_images');
  console.log('  фото в галереях'.padEnd(26), withPhotos.rows[0].c);
  await db.close();
})().catch(err => { console.error(err.message); process.exit(1); });
"

login=$(curl -fsS -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  -o /dev/null -w '%{http_code}' || true)
echo "  вход admin/admin123: ${login:-нет ответа}"

echo
echo "  🌐 http://$DOMAIN"
echo "  📦 $APP_DIR"
echo "  👤 admin / admin123 (сменить после первого входа)"
