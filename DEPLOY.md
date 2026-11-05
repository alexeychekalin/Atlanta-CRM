# 🖥️ Разворачивание CRM «Атланта» на VPS (Ubuntu 22.04 / 24.04)

## Требования

| Параметр | Минимум | Рекомендуется |
|----------|---------|---------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Диск | 10 GB | 20 GB |
| ОС | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |

> 📘 Пошаговый сценарий «сервер + домен + сайт + поддомен crm + HTTPS»
> с чек-листом проверки — в [`docs/deploy-vps.md`](docs/deploy-vps.md).

---

## 🧩 Варианты наполнения базы

Одна и та же сборка разворачивается с разным набором данных. Выбирать нужно **на этапе
установки** — всё, что относится к структуре, создаётся в любом случае.

**Всегда создаётся:** таблицы, справочники (статусы клиентов, уровни цен, типы техники,
категории компонентов), роли и права, пользователи `admin` и `viewer`, принципал «Атланта».

Три переключателя задают, что добавить сверху:

| Переключатель | Что включает | По умолчанию |
|---|---|---|
| `WITH_CATALOG=1` | каталог АТЛАНТА-26: 11 категорий, 214 позиций, 867 модификаций, 504 фото в галереях и у исполнений (цены `0`), включая 124 семейства жгутов | выключен |
| `SEED_DEMO=0` | **выключает** демонстрационные записи: 3 клиента, 5 услуг, 4 заказа | демо включено |
| `SKIP_PRESEED=1` | **выключает** 8 реальных клиентов из предзаполнения с карточками предприятий | предзаполнение включено |

Отсюда четыре готовых рецепта:

| Вариант | Что в базе | Команда |
|---|---|---|
| **Полная витрина** — показать систему целиком | всё: клиенты, демо-заказы, каталог | `sudo WITH_CATALOG=1 ./deploy.sh` |
| **Рабочая** — запуск в производство | реальные клиенты и каталог, без демо-мусора | `sudo WITH_CATALOG=1 SEED_DEMO=0 ./deploy.sh` |
| **Пустая** — каталог заполнят вручную | клиенты и справочники, каталог пуст | `sudo SEED_DEMO=0 ./deploy.sh` |
| **Совсем чистая** — структура под свой импорт | только структура, справочники и `admin` | `sudo SEED_DEMO=0 SKIP_PRESEED=1 ./deploy.sh` |

Переключатели можно комбинировать свободно:

```bash
# всё, кроме каталога
sudo SEED_DEMO=0 ./deploy.sh

# каталог и клиенты, но и демо-заказы тоже (если нужна витрина на реальных клиентах)
sudo WITH_CATALOG=1 ./deploy.sh
```

### Как это устроено

Контрагентов и каталог загружает **один скрипт** — `server/src/db/data.js` (`npm run db:data`).
`deploy.sh` вызывает его один раз после миграций, поэтому данные приезжают вместе и одной сводкой:

| Переменная | Что делает |
|---|---|
| `WITH_CATALOG=1` | добавляет каталог АТЛАНТА-26 — жгуты входят в него (124 семейства, 581 исполнение) |
| `SKIP_PRESEED=1` | не загружает 8 контрагентов из карточек предприятий |

Оба импорта идемпотентны: контрагенты ищутся по ИНН (без ИНН — по названию), позиции каталога —
по артикулу, исполнения — по коду внутри семейства. Повторный запуск ничего не дублирует и не
перезаписывает правки из интерфейса. В конце печатается сводка по фактическим счётчикам:

```
📊 Итого в базе: клиенты 11, позиции каталога 214, модификации 867
```

Если после деплоя в логе есть «Наполнение: часть данных не загрузилась» — скрипт вернул
ненулевой код, причина напечатана выше (раньше ошибки предзаполнения скрывались).

### Догрузить данные позже

Пустую версию можно догнать до полной без переустановки: импорт идемпотентен, цены и правки
из интерфейса не затираются, у существующих позиций дозаполняются только пустые поля.

```bash
cd /opt/atlanta-crm/server
WITH_CATALOG=1 npm run db:data   # контрагенты + каталог (идемпотентно)
touch .catalog-enabled           # чтобы update.sh обновлял каталог и дальше
```

Точечно: `npm run db:catalog` — только каталог, `npm run db:preseed` — только контрагенты.
Контрагентов можно догрузить и в пустую версию: `npm run db:preseed`.

Без маркера `server/.catalog-enabled` скрипт обновления каталог не трогает. Обратная
операция (убрать каталог) не предусмотрена — позиции удаляются только вручную.

### Проверить, что получилось

```bash
cd /opt/atlanta-crm/server
node -e "
const db = require('./src/db');
(async () => {
  for (const t of ['clients','orders','components','component_modifications','component_categories'])
    console.log(t, (await db.query('SELECT count(*)::int c FROM ' + t)).rows[0].c);
  const sql = \"SELECT count(DISTINCT c.id)::int AS families, count(cm.id)::int AS executions \" +
    \"FROM components c JOIN component_categories cc ON cc.id = c.category_id \" +
    \"LEFT JOIN component_modifications cm ON cm.component_id = c.id \" +
    \"WHERE cc.name = 'Электропровода (жгуты)'\";
  console.log('жгуты', (await db.query(sql)).rows[0]);
  await db.close();
})();
"
```

Ожидаемые числа для полной витрины: клиенты 11 (3 демо + 8 из предзаполнения), заказы 4,
позиции каталога 214, модификации 867, жгуты — 124 семейства и 581 исполнение.
Для рабочей версии — клиенты 8, заказы 0, каталог 214, жгуты те же 124 / 581.

> Пароли `admin/admin123` и `viewer/viewer123` — стартовые. Смените их сразу после установки.
> Повторный `./deploy.sh` пересоздаёт пользователей и **сбрасывает пароль `admin` на
> `admin123`** (так устроен `seed.js`); `update.sh` этого не делает.
>
> Цены в каталоге не публикуются: после импорта `price = 0`, их заполняют в интерфейсе.

---

## Вариант 1: Быстрый запуск через скрипт

Скрипт `deploy.sh` автоматически установит всё необходимое и запустит приложение.

```bash
# 1. Загрузите проект на сервер (git clone или scp)
git clone https://github.com/alexeychekalin/Atlanta-CRM.git /opt/atlanta-crm
cd /opt/atlanta-crm

# 2. Сделайте скрипт исполняемым и запустите
chmod +x deploy.sh
sudo WITH_CATALOG=1 SEED_DEMO=0 ./deploy.sh     # любой рецепт из таблицы выше
```

Скрипт выполнит:
- Установку Node.js 20, PostgreSQL 17, Nginx
- Создание базы данных и пользователя
- Применение схемы и всех миграций
- Наполнение базы по выбранному варианту одним шагом: контрагенты и каталог (см. раздел выше); выбранный набор печатается в шапке
- Настройку Nginx (проксирование порт 80 → 3000)
- Создание systemd-сервиса для автозапуска
- Настройку UFW-файрвола

Переменные окружения передаются перед `./deploy.sh` — `sudo` их пробрасывает:
`sudo WITH_CATALOG=1 SEED_DEMO=0 SKIP_PRESEED=1 ./deploy.sh`.

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
git clone https://github.com/alexeychekalin/Atlanta-CRM.git /opt/atlanta-crm
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

### Шаг 7. Инициализация базы данных под выбранный вариант

Схему, миграции, роли и справочники накатывают npm-скрипты — тот же путь, что и в `deploy.sh`:

```bash
cd /opt/atlanta-crm/server

# пустая версия: структура, справочники, пользователи, клиенты из предзаполнения
npm run db:init

# полная версия: то же + каталог компонентов (включая жгуты)
npm run db:init:full

# данные одним шагом после структуры: контрагенты + каталог
WITH_CATALOG=1 npm run db:data

# без демо-записей (3 клиента, 5 услуг, 4 заказа) и/или без предзаполнения клиентов
SEED_DEMO=0 npm run db:init
SKIP_PRESEED=1 SEED_DEMO=0 npm run db:init
```

`db:init` = `seed.js` (схема, пользователи, принципал, демо-данные) → `migrate.js` (миграции по
реестру `schema_migrations`) → `migrate_roles.js` → `preseed.js` (8 контрагентов), плюс `db:catalog`
в полной версии. `db:data` делает то же наполнение одним шагом (контрагенты → каталог → сводка).
Все шаги безопасно запускать повторно: существующие записи не дублируются.

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

Прокси на CRM и статику сайта раскладывает один скрипт — два `server`-блока:

```bash
sudo apt install -y nginx

# сайт на основном домене, CRM на поддомене crm.<домен>
sudo DOMAIN=ваш-домен.ru ./scripts/setup-nginx.sh

# CRM на произвольном поддомене
sudo DOMAIN=ваш-домен.ru CRM_HOST=system.ваш-домен.ru ./scripts/setup-nginx.sh

# без домена: сайт на :80 (по IP), CRM на :8080
sudo ./scripts/setup-nginx.sh
```

Скрипт берёт шаблоны из `deploy/nginx/` (`site.conf`, `crm.conf`), подставляет домен
и корень сайта, проверяет `nginx -t` и перезагружает nginx. Запускать повторно безопасно.

Ручной вариант того же конфига для CRM:

```bash
sudo tee /etc/nginx/sites-available/atlanta-crm > /dev/null <<'EOF'
server {
    listen 80;
    server_name crm.ваш-домен.ru;  # или IP сервера

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
# только если домена нет и CRM живёт на :8080
sudo ufw allow 8080/tcp
sudo ufw --force enable
```

### Шаг 12. SSL-сертификат (опционально, рекомендуется)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ваш-домен.ru -d www.ваш-домен.ru -d crm.ваш-домен.ru

# после HTTPS сессия CRM должна идти только по защищённой cookie
sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' /opt/atlanta-crm/server/.env
sudo systemctl restart atlanta-crm
```

---

## Демо без PostgreSQL (PGlite)

Для показа системы на ноутбуке ставить PostgreSQL не нужно: база собирается в WASM и лежит
в `.pglite` в корне проекта.

```bash
cd server

npm run demo:init          # демо-данные без каталога
npm run demo:init:full     # демо-данные + каталог АТЛАНТА-26
npm run demo               # http://localhost:3000

npm run demo:catalog       # догрузить каталог в уже созданную демо-базу
```

Учётные записи те же: `admin/admin123`, `manager/manager123`, `viewer/viewer123`.
Каталог данных переопределяется `PGLITE_DIR=/path/to/data npm run demo`.
Демо-база — только для разработки и показа, для боевой установки она не подходит.

---

## Альтернатива: Docker Compose

```bash
git clone https://github.com/alexeychekalin/Atlanta-CRM.git /opt/atlanta-crm
cd /opt/atlanta-crm

cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
EOF

docker-compose up -d --build
```

`docker-compose` монтирует только `schema.sql`. Миграции и наполнение выполняются в контейнере
после старта — по тем же рецептам:

```bash
# пустая версия
docker-compose exec app sh -c "cd server && node src/db/migrate.js && SEED_DEMO=0 node src/db/seed.js && node src/db/migrate_roles.js && node src/db/preseed.js"

# полная версия (добавить каталог)
docker-compose exec app sh -c "cd server && node src/db/catalog.js"
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
sudo ./update.sh
```

`update.sh` делает `git pull`, обновляет зависимости, применяет новые миграции, догружает
клиентов из предзаполнения (существующие не дублируются) и обновляет каталог, **только если
он был включён при установке** (маркер `server/.catalog-enabled`). Демо-записи и пароли
пользователей обновление не трогает.

Догрузить каталог на установке, где его не было:

```bash
cd /opt/atlanta-crm && sudo WITH_CATALOG=1 ./update.sh
```

Вручную, без обновления кода:

```bash
cd /opt/atlanta-crm/server
node src/db/migrate.js      # новые миграции
node src/db/preseed.js      # новые клиенты из предзаполнения
node src/db/catalog.js      # новые позиции каталога (цены сохраняются)
sudo systemctl restart atlanta-crm
```

## 🛟 Резервное копирование

```bash
# Дамп базы
pg_dump -h localhost -U atlanta_user atlanta_crm > backup_$(date +%Y%m%d_%H%M%S).sql

# Бэкап загруженных файлов: фото каталога, чертежи, документы, вложения клиентов
tar czf uploads_backup_$(date +%Y%m%d).tar.gz /opt/atlanta-crm/server/uploads/

# Восстановление из дампа
psql -h localhost -U atlanta_user atlanta_crm < backup_XXXXXXXX.sql
```

Фото каталога после импорта лежат в `server/uploads/images/` под именами
`catalog_<sha256:16>.<ext>`. Если их нет в бэкапе, каталог восстановится без картинок —
повторный `npm run db:catalog` дозальёт только пустые `image_path`.
