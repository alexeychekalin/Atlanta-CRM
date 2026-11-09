# Развёртывание на VPS 103.80.87.197

Схема: **один сервер, два хоста**.

| Адрес | Что отдаёт | Откуда |
|---|---|---|
| `ваш-домен.ru`, `www.ваш-домен.ru` | сайт завода | статика из `/var/www/atlanta` (`site/dist`) |
| `crm.ваш-домен.ru` | CRM «Атланта» | Node.js на `127.0.0.1:3000` через nginx |

Пока DNS не настроен, сервер работает в режиме без домена: сайт на `http://IP/`,
CRM на `http://IP:8080/`. Как только появятся A-записи — одна команда переключает на домены.

> ⚠️ Пока изменения по сайту и двух хостам не влиты в `main`, сервер нужно ставить
> с ветки `arena/65030bab-atlanta-crm`: `git clone -b arena/65030bab-atlanta-crm ...`.
> После мержа ветка не нужна — всё работает с `main`.

## Коротко: шесть команд

```bash
# 1. на сервере — CRM, nginx и оба хоста
ssh root@103.80.87.197
git clone -b arena/65030bab-atlanta-crm https://github.com/alexeychekalin/Atlanta-CRM.git /opt/atlanta-crm
cd /opt/atlanta-crm && sudo DOMAIN=ваш-домен.ru WITH_CATALOG=1 SEED_DEMO=0 ./deploy.sh

# 2. на своей машине — сайт
./scripts/deploy-site.sh root@103.80.87.197 --domain https://ваш-домен.ru

# 3. на сервере — HTTPS на все три имени
sudo certbot --nginx -d ваш-домен.ru -d www.ваш-домен.ru -d crm.ваш-домен.ru
sudo sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' /opt/atlanta-crm/server/.env
sudo systemctl restart atlanta-crm
```

**Домена ещё нет?** Это не блокирует запуск: выполните шаг 1 без `DOMAIN`, и сервер
поднимется в режиме без домена — сайт на `http://103.80.87.197/`, CRM на
`http://103.80.87.197:8080/`. Сайт собирайте без `--domain` (в canonical попадёт
заглушка из `content.json`), а когда домен появится — одна команда:

```bash
sudo DOMAIN=ваш-домен.ru ./scripts/setup-nginx.sh
./scripts/deploy-site.sh root@103.80.87.197 --domain https://ваш-домен.ru
```

---

## 0. Что нужно до начала

- Доступ по SSH к `103.80.87.197` (root или пользователь с sudo).
- Домен, у которого можно менять DNS. Записей нужно три:

| Тип | Имя | Значение | TTL |
|---|---|---|---|
| A | `@` | `103.80.87.197` | 300 |
| A | `www` | `103.80.87.197` | 300 |
| A | `crm` | `103.80.87.197` | 300 |

Проверить, что DNS уже разошёлся:

```bash
dig +short ваш-домен.ru
dig +short crm.ваш-домен.ru
# оба должны вернуть 103.80.87.197
```

> Домен в примерах ниже заменяйте на свой. Дальше он везде обозначен как `DOMAIN`.

---

## 1. CRM на поддомене

```bash
ssh root@103.80.87.197

git clone -b arena/65030bab-atlanta-crm https://github.com/alexeychekalin/Atlanta-CRM.git /opt/atlanta-crm
cd /opt/atlanta-crm

# полная витрина: каталог + реальные клиенты, без демо-записей
sudo DOMAIN=ваш-домен.ru WITH_CATALOG=1 SEED_DEMO=0 ./deploy.sh
```

`deploy.sh` ставит Node.js 20, PostgreSQL 17, nginx, создаёт сервис `atlanta-crm`,
раскладывает два конфига nginx (`сайт` и `CRM`) и настраивает файрвол.
Каталог разделов и позиций тот же, что на сайте — один источник `catalog.json`.

Если домена ещё нет — запускайте без `DOMAIN`, тогда CRM поднимется на `:8080`:

```bash
sudo WITH_CATALOG=1 SEED_DEMO=0 ./deploy.sh
```

Позже, когда DNS появится:

```bash
cd /opt/atlanta-crm
sudo DOMAIN=ваш-домен.ru ./scripts/setup-nginx.sh
```

---

## 2. Сайт завода

Сайт — статика, собирается из того же каталога. Два способа.

### Способ А: собрать локально и залить (рекомендую)

Сборка требует Pillow (пережатие фото), на сервере его держать не обязательно.

```bash
# на своей машине, в папке проекта
pip install --break-system-packages pillow
python3 site/build.py --domain https://ваш-домен.ru

./scripts/deploy-site.sh root@103.80.87.197 --no-build
# или одной командой со сборкой:
./scripts/deploy-site.sh root@103.80.87.197 --domain https://ваш-домен.ru
```

Скрипт создаёт `/var/www/atlanta` и заливает туда `site/dist` (rsync с `--delete`,
поэтому в этом каталоге не должно быть ничего лишнего).

### Способ Б: собрать прямо на сервере

```bash
ssh root@103.80.87.197
apt install -y python3-pip
pip3 install --break-system-packages pillow

cd /opt/atlanta-crm
git pull
python3 site/build.py --domain https://ваш-домен.ru --publish /var/www/atlanta --prune
```

`--publish` копирует только изменившиеся файлы (обычно 5–20 вместо всей сборки) и
убирает старые, `--prune`. Ни FTP, ни rsync для этого не нужны. Дальше `update.sh`
делает то же самое пятым шагом: сайт собирается и выкладывается в `SITE_ROOT`
сам, если в нём уже лежит наш сайт (есть `index.html` и `search.json`). Выключить —
`WITH_SITE=0`, включить принудительно — `WITH_SITE=1`.

После первой выгрузки проверьте права — nginx читает файлы как `www-data`:

```bash
chmod -R a+rX /var/www/atlanta
```

---

## 3. HTTPS

Один сертификат на все три имени сразу:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d ваш-домен.ru -d www.ваш-домен.ru -d crm.ваш-домен.ru
```

certbot сам перепишет конфиги (добавит `listen 443 ssl` и редирект с 80).
Дальше включите защищённую cookie в CRM — иначе сессия не закрепится на HTTPS:

```bash
sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' /opt/atlanta-crm/server/.env
systemctl restart atlanta-crm
```

Продление проверяется само (`systemctl list-timers | grep certbot`), можно прогнать
`certbot renew --dry-run`.

> ⚠️ После `certbot --nginx` шаблоны в `deploy/nginx/` уже не описывают фактические
> конфиги (там появятся ssl-блоки). Повторный `setup-nginx.sh` перезапишет их и
> снимет HTTPS. Если нужно перезапустить скрипт после SSL — сначала добавьте
> `listen 443 ssl` в шаблоны или запускайте `certbot --nginx` снова после него.

---

## 4. Проверка

```bash
# на сервере: :80 по умолчанию — сайт, CRM проверяем через Host
curl -I http://127.0.0.1/                                            # сайт: 200, text/html
curl -s -H "Host: crm.ваш-домен.ru" http://127.0.0.1/api/health      # CRM: {"status":"ok"}

# без домена (CRM на :8080)
curl -I http://127.0.0.1:8080/api/health

systemctl status atlanta-crm --no-pager
nginx -t

# снаружи
curl -I https://ваш-домен.ru/
curl -I https://crm.ваш-домен.ru/
curl -s https://ваш-домен.ru/sitemap.xml | head -3
```

Чек-лист:

- [ ] `http://ваш-домен.ru/` — главная сайта, картинки видны
- [ ] `https://crm.ваш-домен.ru/` — экран входа CRM, вход `admin` работает
- [ ] `https://ваш-домен.ru/catalog/` — 192 позиции, поиск фильтрует
- [ ] `https://ваш-домен.ru/sitemap.xml` и `/robots.txt` открываются
- [ ] `https://ваш-домен.ru/несуществующая-страница` — страница 404 в оформлении сайта
- [ ] голый IP `http://103.80.87.197/` открывает **сайт**, а не CRM
- [ ] в CRM фото каталога и загрузка файлов работают (проверить лимит 50 МБ)

---

## 5. Обновления

CRM:

```bash
ssh root@103.80.87.197
cd /opt/atlanta-crm && git pull && sudo ./update.sh
```

Сайт (после правок в каталоге CRM или текстах):

```bash
./scripts/deploy-site.sh root@103.80.87.197 --domain https://ваш-домен.ru
```

`update.sh` конфиги nginx не трогает. Если менялась схема хостов — запускайте
`sudo DOMAIN=ваш-домен.ru ./scripts/setup-nginx.sh` вручную.

---

## 6. Если что-то не так

| Симптом | Причина и что делать |
|---|---|
| `502 Bad Gateway` на `crm.` | сервис не запущен: `systemctl status atlanta-crm`, `journalctl -u atlanta-crm -n 50` |
| Голый IP показывает CRM | конфиг сайта не попал в `sites-enabled` или nginx не перезагружен: `ls -l /etc/nginx/sites-enabled/`, `nginx -t`, `systemctl reload nginx` |
| Сайт отдаёт 403/404 на всех страницах | нет `index.html` в `/var/www/atlanta` или права: `ls -la /var/www/atlanta`, `chmod -R a+rX` |
| Сайт открывается, но без стилей | статика не доехала: `ls /var/www/atlanta/static/css/site.css` |
| После SSL не пускает в CRM | `COOKIE_SECURE=true` при http → вернуть `false` или перейти на https |
| `duplicate default server` в `nginx -t` | остался старый конфиг: `rm /etc/nginx/sites-enabled/default` |
| `sudo: ./update.sh: command not found` | у скрипта нет права на исполнение: `sudo chmod +x update.sh` (или `sudo WITH_CATALOG=1 bash update.sh`); если файла нет — `git pull` не забрал его: `git log --oneline -1`, `git status` |
| Домен не резолвится | подождать TTL, проверить `dig +short crm.ваш-домен.ru` |

---

## 7. Что ещё стоит сделать после запуска

1. Сменить пароли `admin` и `viewer` в CRM (стартовые `admin123` / `viewer123`).
2. Вписать ИНН/ОГРН в футер сайта: `site/content.json` → `site.requisites`.
3. Приём заявок с сайта в CRM: сейчас форма открывает почту (`form_endpoint` пуст).
   Нужен публичный эндпоинт `POST /api/public/lead` и `CORS_ORIGINS=https://ваш-домен.ru`
   в `server/.env` — отдельная задача.
4. Загрузить недостающие фото каталога (116 позиций из 192 без фото).
5. Резервные копии БД: `pg_dump` по cron в `/var/backups` (отдельная задача).
