#!/usr/bin/env python3
"""Сборка сайта завода «Атланта» из каталога CRM.

Источник данных — один: server/src/db/catalog/catalog.json и папка с фото.
Поэтому сайт не расходится с CRM: обновили каталог — пересобрали сайт.

    python3 site/build.py                 # собрать в site/dist
    python3 site/build.py --skip-images   # без пережатия фото (быстро)
    python3 site/build.py --out /tmp/site # в другую папку

Структура:
    site/content.json         тексты (правятся руками)
    site/static/              css, js, логотип
    site/build.py             этот файл
    site/dist/                результат (в git не коммитится)
"""
import argparse
import hashlib
import html
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
CATALOG_DIR = ROOT / 'server' / 'src' / 'db' / 'catalog'
CATALOG_JSON = CATALOG_DIR / 'catalog.json'
FILES_DIR = CATALOG_DIR / 'files'

# ключ категории в каталоге → адрес раздела на сайте
CATEGORY_SLUGS = {
    'marker': 'gabaritnye-fonari',
    'rear': 'zadnie-fonari',
    'turn': 'ukazateli-povorota',
    'plate': 'fonz',
    'reverse': 'fzh',
    'fog': 'ptf',
    'brake': 'dst',
    'interior': 'plafony',
    'harness': 'zhguty',
    'connector': 'razemy',
    'accessory': 'prochee',
}
CATEGORY_ORDER = ['rear', 'marker', 'turn', 'plate', 'reverse', 'fog', 'brake',
                  'interior', 'harness', 'connector', 'accessory']

TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '',
    'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}

# ---------------------------------------------------------------- утилиты


def esc(text):
    return html.escape(str(text or ''), quote=True)


def slugify(text):
    text = (text or '').lower().replace('ё', 'e')
    out = []
    for char in text:
        if char in TRANSLIT:
            out.append(TRANSLIT[char])
        elif char.isalnum():
            out.append(char)
        else:
            out.append('-')
    slug = re.sub(r'-{2,}', '-', ''.join(out)).strip('-')
    return re.sub(r'-+$', '', slug)


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def icon(name, size=16):
    """Простые иконки, чтобы не тянуть библиотеку."""
    paths = {
        'arrow': '<path d="M4 12h15M13 6l6 6-6 6"/>',
        'phone': '<path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3A2 2 0 0 1 18.5 20 16 16 0 0 1 4 5.5 2 2 0 0 1 6.5 3.5Z"/>',
        'mail': '<path d="M3 6h18v12H3z"/><path d="m3 7 9 6 9-6"/>',
        'search': '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        'pin': '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    }
    return (f'<svg class="arrow" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
            f'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" '
            f'stroke-linejoin="round" aria-hidden="true">{paths.get(name, "")}</svg>')


# ---------------------------------------------------------------- тексты каталога

INTERNAL = [
    re.compile(r'\s*На странице каталога несколько вариантов исполнения[^.]*\.', re.I),
    re.compile(r'\s*Вариантов подключения:\s*\d+\.?', re.I),
    re.compile(r'\s*Потребител[ия][^\n]*', re.I),
]
PARAM_RE = re.compile(r'^(?P<key>[А-ЯЁA-Z][^:.]{2,44}?)\s*:\s*(?P<value>.+)$')

# ключи, которые в описаниях идут в одну строку: «… Основные: X. Дополнительные: Y. Длина: Z.»
INLINE_KEYS = ('Основные', 'Дополнительные', 'Длина', 'Питание', 'Мощность', 'Источник света',
               'Климатическое исполнение', 'Степень защиты', 'Напряжение питания', 'Габариты',
               'Материал', 'Цвет', 'Масса', 'Комплектация', 'Назначение')
INLINE_RE = re.compile(r'(?<=[.;])\s+(?=(?:' + '|'.join(INLINE_KEYS) + r')\s*:)')

# человеческие подписи для служебных ключей каталога
LABELS = {
    'основные': 'Разъём и контакты',
    'дополнительные': 'Кабель и комплектующие',
}
SENTENCE_SPLIT = re.compile(r'(?<=[.!?])\s+')


def clean_public(text):
    """Убрать из текста служебные пометки CRM, которые не для клиента."""
    text = text or ''
    for pattern in INTERNAL:
        text = pattern.sub('', text)
    return re.sub(r'\s{2,}', ' ', text).strip()


def clean_name(name):
    """Название позиции: типографика и расшифровка обрезанных слов из каталога."""
    name = ' '.join((name or '').split())
    name = re.sub(r'\.{2,}', '.', name)
    name = re.sub(r'\bроз\b', 'розеткой', name, flags=re.I)
    name = re.sub(r'(\d+)[- ]конт\.?$', r'\1-конт.', name)
    return name.strip()


def clean_mod_name(name):
    """Название исполнения без служебного «потребитель …» и прежнего артикула."""
    name = name or ''
    name = re.sub(r'^\s*арт\.?\s*[А-ЯA-Z]?\.?\d[\w./-]*\s*:\s*', '', name, flags=re.I)
    name = re.sub(r'[\s;,.]*потребител[ья].*$', '', name, flags=re.I | re.S)
    name = re.sub(r'\s{2,}', ' ', name).strip(' ;,.')
    if name and name[0].islower():
        name = name[0].upper() + name[1:]
    return name.rstrip('.')


def full_article(article, code, printed=None):
    """Полный артикул исполнения: «А.3776.001» + «02.02» → «А.3776.001-02.02».

    Если в каталоге записан печатный артикул (исполнения, где цвет входит в
    обозначение через точку — А.3731.023.1-01.00-150), он и берётся.
    """
    explicit = ' '.join((printed or '').split())
    if explicit:
        return explicit
    base = ' '.join((article or '').split())
    suffix = ' '.join((code or '').split())
    if not base:
        return suffix
    return f'{base}-{suffix}' if suffix else base


def parse_description(text):
    """Описание из каталога → блоки страницы товара."""
    blocks = {'lead': [], 'functions': [], 'features': [], 'params': [], 'notes': []}
    normalized = INLINE_RE.sub('\n', clean_public(text))
    for raw in normalized.split('\n'):
        line = raw.strip()
        if not line:
            continue
        if line.lower().startswith('функции:'):
            blocks['functions'] += [item.strip(' .') for item in
                                    re.split(r'[,;]', line.split(':', 1)[1]) if item.strip()]
            continue
        if line.lower().startswith('особенности:'):
            blocks['features'] += [item.strip(' .') for item in
                                   line.split(':', 1)[1].split(';') if item.strip()]
            continue
        match = PARAM_RE.match(line)
        if match:
            key = match.group('key').strip()
            blocks['params'].append([LABELS.get(key.lower(), key), match.group('value').strip()])
            continue
        blocks['notes'].append(line)
    return blocks


def spec_rows(component):
    """Пары «параметр — значение» для таблицы характеристик."""
    specs = component.get('specs') or {}
    parsed = parse_description(component.get('description') or '')
    rows, seen, seen_values = [], set(), set()

    def add(label, value):
        if not value:
            return
        value = ' '.join(str(value).split()).strip(' .')
        key = label.lower()
        normalized = re.sub(r'[^0-9a-zа-яё]', '', value.lower())
        if key in seen or not value:
            return
        if normalized in seen_values:
            return
        # «длина 20 000–34 000 мм» и «20 000–34 000 мм» — одно и то же
        if any(len(normalized) > 5 and len(item) > 5 and normalized in item for item in seen_values):
            return
        seen.add(key)
        seen_values.add(normalized)
        rows.append((label, value))

    params = {key.lower(): (key, value) for key, value in parsed['params']}
    priority = [
        ('источник света', 'Источник света'),
        ('напряжение питания', 'Напряжение питания'),
        ('потребляемая мощность', 'Мощность'),
        ('мощность', 'Мощность'),
        ('степень защиты', 'Степень защиты'),
        ('диапазон рабочих температур', 'Диапазон рабочих температур'),
        ('климатическое исполнение', 'Климатическое исполнение'),
        ('цветовая температура', 'Цветовая температура'),
        ('световой поток', 'Световой поток'),
        ('диаметр', 'Диаметр'),
        ('габариты', 'Габариты'),
        ('масса', 'Масса'),
        ('комплектация', 'Комплектация'),
    ]
    for key, label in priority:
        if key in params:
            add(label, params[key][1])

    if not any(label == 'Напряжение питания' for label, _ in rows):
        add('Напряжение питания', specs.get('voltage'))
    if not any(label == 'Степень защиты' for label, _ in rows):
        add('Степень защиты', specs.get('protection'))
    if not any(label == 'Диапазон рабочих температур' for label, _ in rows):
        add('Диапазон рабочих температур', specs.get('temperature'))
    if not any(label == 'Мощность' for label, _ in rows):
        power = specs.get('power') or []
        add('Мощность', '; '.join(power) if isinstance(power, list) else power)
    add('Цветовая температура', specs.get('color_temperature'))
    add('Световой поток', specs.get('luminous_flux'))
    if not any(key.lower() == 'длина' for key, _ in parsed['params']):
        add('Габариты', specs.get('dimensions'))

    for key, value in parsed['params']:
        if key.lower() in {item[0].lower() for item in priority}:
            continue
        add(key, value)

    return rows


def plural(count, forms):
    """Русская форма слова для числа: plural(3, ('позиция', 'позиции', 'позиций'))."""
    rest100 = count % 100
    rest10 = count % 10
    if 11 <= rest100 <= 14:
        return forms[2]
    if rest10 == 1:
        return forms[0]
    if 2 <= rest10 <= 4:
        return forms[1]
    return forms[2]


def counts(component_count, modification_count):
    """«187 позиций, 964 исполнения» — формы слов по числам."""
    return (f'{component_count} {plural(component_count, ("позиция", "позиции", "позиций"))}, '
            f'{modification_count} '
            f'{plural(modification_count, ("исполнение", "исполнения", "исполнений"))}')


def localize_counts(value, component_count, modification_count):
    """Заменить зашитые в текстах «214 позиций» / «867 исполнений» на фактические числа."""
    if isinstance(value, dict):
        result = {key: localize_counts(item, component_count, modification_count)
                  for key, item in value.items()}
        # плитки «214 позиций» / «867 исполнений»: число лежит отдельным полем
        if result.get('value') == '214':
            result['value'] = str(component_count)
        if result.get('value') == '867':
            result['value'] = str(modification_count)
        return result
    if isinstance(value, list):
        return [localize_counts(item, component_count, modification_count) for item in value]
    if isinstance(value, str):
        return (value.replace('214 позиц', counts(component_count, modification_count).split(', ')[0])
                     .replace('867 исполнен', counts(component_count, modification_count).split(', ')[1]))
    return value


def clip(text, limit):
    """Обрезать по границе слова, чтобы заголовок влезал в выдачу."""
    text = ' '.join((text or '').split())
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(' ', 1)[0].rstrip(' ,;:.—-(')
    return cut + '…'


def lead_text(component):
    """Короткий лид карточки: описание без повтора названия и служебных строк."""
    parsed = parse_description(component.get('description') or '')
    name = (component.get('name') or '').strip()
    parts = [line for line in parsed['notes']
             if line.lower().rstrip('.') != name.lower().rstrip('.')
             and not line.lower().startswith('питание ')]
    text = clean_name(' '.join(parts).strip())
    if text.lower().startswith(name.lower()):
        text = text[len(name):].lstrip(' .—–,;-')
    if text.lower().rstrip('.') == name.lower().rstrip('.'):
        text = ''
    return text


# ---------------------------------------------------------------- фото

IMAGE_SIZES = (640, 1280)


def build_images(components, out_dir, skip=False):
    """Пережать фото в два размера: карточки и галерея."""
    from PIL import Image, ImageOps

    img_dir = out_dir / 'img'
    img_dir.mkdir(parents=True, exist_ok=True)
    names = set()
    for component in components:
        names.update(component.get('images') or [])
        for mod in component.get('modifications') or []:
            names.update(mod.get('images') or [])

    made = 0
    dims = {}
    if skip:
        # без пережатия — отдаём оригиналы под теми же именами
        for name in sorted(names):
            source = FILES_DIR / name
            if source.exists():
                shutil.copy2(source, img_dir / name)
                made += 1
        return made, names, dims

    for name in sorted(names):
        source = FILES_DIR / name
        if not source.exists():
            continue
        for width in IMAGE_SIZES:
            target = img_dir / f'{Path(name).stem}-{width}.jpg'
            if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
                continue
            try:
                with Image.open(source) as image:
                    image = ImageOps.exif_transpose(image).convert('RGB')
                    ratio = width / image.width
                    if ratio < 1:
                        image = image.resize((width, max(1, round(image.height * ratio))),
                                             Image.LANCZOS)
                    elif width == IMAGE_SIZES[0] and image.width < width:
                        pass
                    image.save(target, 'JPEG', quality=82, optimize=True, progressive=True)
                    dims[target.name] = image.size
                made += 1
            except Exception as error:                    # noqa: BLE001 — фото не критично
                print(f'  ! {name} ({width}): {error}')
    return made, names, dims


def gallery_images(component, files_dir=None):
    """Фото карточки: галерея изделия + снимки исполнений (комплектов) без повторов.

    Повторы ловим и по имени, и по содержимому: у вариантов одного исполнения
    поставщик кладёт один и тот же снимок под разными именами.
    """
    images, names, digests = [], set(), set()

    def add(name):
        if not name or name in names:
            return
        names.add(name)
        if files_dir:
            path = files_dir / name
            try:
                digest = hashlib.md5(path.read_bytes()).hexdigest()
            except OSError:
                digest = None
            if digest:
                if digest in digests:
                    return
                digests.add(digest)
        images.append(name)

    for name in component.get('images') or []:
        add(name)
    for mod in component.get('modifications') or []:
        for name in mod.get('images') or []:
            add(name)
    return images


def image_src(name, width=640):
    return f'/img/{Path(name).stem}-{width}.jpg'


def size_attrs(dims, name, width):
    """width/height из реального файла — чтобы страница не дёргалась при загрузке."""
    dims_for_file = dims.get(f'{Path(name).stem}-{width}.jpg')
    return f' width="{dims_for_file[0]}" height="{dims_for_file[1]}"' if dims_for_file else ''


# ---------------------------------------------------------------- каркас

class Site:
    def __init__(self, content, catalog, out_dir, dims=None):
        self.content = content
        self.dims = dims or {}
        self.catalog = catalog
        self.out = out_dir
        self.files_dir = FILES_DIR
        self.site = content['site']
        self.components = catalog['components']
        self.categories = {item['key']: item for item in catalog['categories']}
        self.by_slug = {}
        for component in self.components:
            component['name'] = clean_name(component.get('name'))
            component['_slug'] = slugify(component['article'])
            component['_cat_slug'] = CATEGORY_SLUGS.get(component['category'], 'prochee')
            component['_url'] = f"/catalog/{component['_cat_slug']}/{component['_slug']}/"
            self.by_slug[component['_slug']] = component
        self.counts_text = counts(len(self.components),
                                  sum(len(item.get('modifications') or []) for item in self.components))
        self.category_counts = {}
        for component in self.components:
            key = component['category']
            self.category_counts[key] = self.category_counts.get(key, 0) + 1

    # ------------------------------------------------------------ общий каркас
    def head(self, title, description, canonical, og_image='', extra=''):
        full_title = title if 'АТЛАНТА' in title else f'{title} — АТЛАНТА'
        image = og_image or '/static/img/logo.svg'
        robots = '<meta name="robots" content="noindex">' if canonical == '/404.html' else ''
        return f'''<!doctype html>
<html lang="ru" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(full_title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(self.site['domain'] + canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="АТЛАНТА">
<meta property="og:title" content="{esc(full_title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(self.site['domain'] + canonical)}">
<meta property="og:image" content="{esc(self.site['domain'] + image)}">
<meta name="theme-color" content="#0f1216">
{robots}
<link rel="icon" href="/static/img/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/css/site.css">
<script>document.documentElement.className = "js";</script>
{extra}
</head>
<body>
<a class="skip" href="#main">Перейти к содержанию</a>
'''

    def logo(self, href='/'):
        return f'''<a class="logo" href="{href}" aria-label="АТЛАНТА — на главную">
  <svg class="logo__mark" viewBox="0 0 40 40" aria-hidden="true">
    <rect width="40" height="40" rx="10" fill="#0f1216"/>
    <circle cx="20" cy="10.2" r="2.05" fill="#f5a524"/>
    <path d="M20 14.4 11.1 30.2" stroke="#f5a524" stroke-width="3.1" stroke-linecap="round"/>
    <path d="M20 14.4 28.9 30.2" stroke="#ffffff" stroke-width="3.1" stroke-linecap="round" opacity="0.92"/>
    <path d="M14.7 24.6h10.6" stroke="#f5a524" stroke-width="3.1" stroke-linecap="round"/>
  </svg>
  <span class="logo__text">
    <span class="logo__name">АТЛАНТА</span>
    <span class="logo__sub">светотехника и жгуты</span>
  </span>
</a>'''

    @staticmethod
    def active(key, current):
        return ' aria-current="true"' if key == current else ''

    def header(self, current=''):
        nav_items = [
            ('/catalog/', 'Каталог', 'catalog'),
            ('/about/', 'О компании', 'about'),
            ('/certificates/', 'Сертификаты', 'certificates'),
            ('/delivery/', 'Условия работы', 'delivery'),
            ('/contacts/', 'Контакты', 'contacts'),
        ]
        links = ''.join(
            f'<a href="{href}"{self.active(key, current)}>{label}</a>'
            for href, label, key in nav_items)
        office = self.content['contacts']['offices'][0]
        return f'''<header class="site-header">
  <div class="wrap site-header__inner">
    {self.logo()}
    <nav class="nav" data-open="false" aria-label="Основная навигация">{links}</nav>
    <div class="header-actions">
      <a class="header-phone" href="tel:{esc(office['phone_href'])}">{esc(office['phone'])}
        <span>{esc(office['city'])} · Пн–Пт 9–18</span></a>
      <a class="btn btn--primary btn--sm" href="/#request">Запросить цену</a>
      <button class="burger" type="button" aria-label="Меню" aria-expanded="false"><span></span></button>
    </div>
  </div>
</header>
'''

    def footer(self):
        contacts = self.content['contacts']
        offices = ''.join(
            f'<div><a href="tel:{esc(item["phone_href"])}">{esc(item["phone"])}</a>'
            f'<div style="margin-top:2px">{esc(item["city"])}</div></div>'
            for item in contacts['offices'])
        catalog_links = ''.join(
            f'<a href="/catalog/{CATEGORY_SLUGS[key]}/">{esc(self.categories[key]["name"])}</a>'
            for key in CATEGORY_ORDER if key in self.categories)
        requisites = ''
        if self.site.get('requisites'):
            requisites = f'<div>{esc(self.site["requisites"])}</div>'
        return f'''<footer class="site-footer">
  <div class="wrap">
    <div class="footer__grid">
      <div class="footer__brand">
        {self.logo()}
        <p class="footer__about">Российский производитель автомобильной светотехники,
          электрожгутовой продукции и разъёмов. С {esc(self.site['founded'])} года.
          Производство — Липецкая область.</p>
      </div>
      <div>
        <div class="footer__title">Каталог</div>
        <div class="footer__list">{catalog_links}</div>
      </div>
      <div>
        <div class="footer__title">Контакты</div>
        <div class="footer__list">{offices}
          <a href="mailto:{esc(contacts['offices'][0]['email'])}">{esc(contacts['offices'][0]['email'])}</a>
        </div>
      </div>
      <div>
        <div class="footer__title">Производство</div>
        <div class="footer__list">
          <span>{esc(contacts['production']['address'])}</span>
          <a href="{esc(contacts['telegram'])}" rel="noopener">Telegram</a>
          <a href="{esc(contacts['whatsapp'])}" rel="noopener">WhatsApp</a>
        </div>
      </div>
    </div>
    <div class="footer__bottom">
      <div>© {esc(self.site['legal_name'])}. Все права защищены.</div>
      {requisites}
      <div><a href="/privacy/">Политика обработки персональных данных</a></div>
    </div>
  </div>
</footer>
<script src="/static/js/site.js" defer></script>
</body>
</html>
'''

    def redirect_page(self, component, old_article):
        """Заглушка на прежний артикул: он стал исполнением изделия.

        Старые ссылки (каталоги дилеров, распечатки) ведут сюда; страница
        ведёт на карточку изделия и не попадает в sitemap.
        """
        target = component['_url']
        title = f'{old_article} — теперь {component["article"]}'
        body = f"""<section class="section">
  <div class="container">
    <h1>{esc(old_article)}</h1>
    <p class="lead">Артикул стал исполнением изделия
       <a href="{target}"><strong>{esc(component['article'])}</strong> — {esc(component['name'])}</a>.</p>
    <p><a class="btn" href="{target}">Перейти к изделию и списку исполнений</a></p>
  </div>
</section>"""
        html = self.page(title, f'{old_article} — исполнение изделия {component["article"]}.',
                         target, body, current='catalog')
        meta = f'<meta http-equiv="refresh" content="0; url={target}">'
        return html.replace('</head>', f'  {meta}\n</head>', 1)

    def page(self, title, description, canonical, body, current='', schemas=None, og_image=''):
        extra = ''.join(self.ld(item) for item in (schemas or []))
        return (self.head(title, description, canonical, og_image=og_image, extra=extra) + self.header(current) +
                f'<main id="main">{body}</main>\n' + self.footer())

    # ------------------------------------------------------------ микроразметка
    @staticmethod
    def ld(data):
        payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        return f'<script type="application/ld+json">{payload}</script>'

    def schema_breadcrumbs(self, items):
        return {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            'itemListElement': [
                {'@type': 'ListItem', 'position': index + 1, 'name': label,
                 'item': self.site['domain'] + (href or '')}
                for index, (label, href) in enumerate(items)],
        }

    def schema_organization(self):
        contacts = self.content['contacts']
        production = contacts['production']['address']
        return {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            'name': self.site['legal_name'],
            'alternateName': self.site['name'],
            'url': self.site['domain'],
            'logo': self.site['domain'] + '/static/img/logo.svg',
            'foundingDate': str(self.site['founded']),
            'description': self.content['about']['paragraphs'][0],
            'address': {'@type': 'PostalAddress', 'addressCountry': 'RU',
                        'addressRegion': 'Липецкая область', 'addressLocality': 'с. Московка',
                        'streetAddress': 'ул. Центральная, 53'},
            'contactPoint': [
                {'@type': 'ContactPoint', 'contactType': 'sales',
                 'telephone': office['phone'], 'email': office['email'],
                 'areaServed': 'RU', 'availableLanguage': 'ru'}
                for office in contacts['offices']],
        }

    def schema_product(self, component):
        images = gallery_images(component, self.files_dir)
        category = self.categories.get(component['category'], {})
        data = {
            '@context': 'https://schema.org',
            '@type': 'Product',
            'name': component['name'],
            'sku': component['article'],
            'mpn': component['article'],
            'url': self.site['domain'] + component['_url'],
            'brand': {'@type': 'Brand', 'name': self.site['name']},
            'manufacturer': {'@type': 'Organization', 'name': self.site['legal_name']},
        }
        description = ' '.join(lead_text(component).split())[:300]
        if description:
            data['description'] = description
        if category:
            data['category'] = category['name']
        if images:
            data['image'] = [self.site['domain'] + image_src(name, 1280) for name in images[:6]]
        return data

    def schema_faq(self):
        return {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            'mainEntity': [{'@type': 'Question', 'name': item['q'],
                            'acceptedAnswer': {'@type': 'Answer', 'text': item['a']}}
                           for item in self.content['faq']],
        }

    def write(self, path, html_text):
        target = self.out / path.lstrip('/')
        if path.endswith('/'):
            target = target / 'index.html'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html_text, encoding='utf-8')

    # ------------------------------------------------------------ общие блоки
    def request_block(self, article=''):
        data = self.content['request']
        office = self.content['contacts']['offices'][0]
        fields = data['fields']
        input_html = []
        for field in fields:
            if field['type'] == 'textarea':
                input_html.append(
                    f'<div class="field"><label for="f-{field["name"]}">{esc(field["label"])}</label>'
                    f'<textarea id="f-{field["name"]}" name="{field["name"]}" '
                    f'placeholder="Например: нужен фонарь под прицеп, 5-контактный разъём"></textarea></div>')
            else:
                required = ' required' if field.get('required') else ''
                input_html.append(
                    f'<div class="field"><label for="f-{field["name"]}">{esc(field["label"])}</label>'
                    f'<input id="f-{field["name"]}" name="{field["name"]}" '
                    f'type="{field["type"]}"{required}></div>')
        fields_html = input_html[0] if input_html else ''
        rest = ''.join(input_html[1:])
        return f'''<section class="section" id="request">
  <div class="wrap">
    <div class="request">
      <div>
        <h2>{esc(data['title'])}</h2>
        <p>{esc(data['text'])}</p>
        <div class="request__contacts">
          <div><span>Телефон</span><a href="tel:{esc(office['phone_href'])}">{esc(office['phone'])}</a></div>
          <div><span>Почта</span><a href="mailto:{esc(office['email'])}">{esc(office['email'])}</a></div>
          <div><span>Telegram</span><a href="{esc(self.content['contacts']['telegram'])}" rel="noopener">@edchek</a></div>
        </div>
      </div>
      <form class="form" data-request-form data-endpoint="{esc(self.site.get('form_endpoint') or '')}"
            data-mailto="{esc(office['email'])}" data-article="{esc(article)}" novalidate>
        <div class="form__row">{fields_html}</div>
        {rest}
        <div class="honeypot"><label>Компания<input name="company" tabindex="-1" autocomplete="off"></label></div>
        <button class="btn btn--accent" type="submit">{esc(data['button'])} {icon('arrow')}</button>
        <div class="form__note" data-form-note></div>
        <p class="form__consent">{esc(data['consent']).replace('политикой обработки персональных данных', '<a href="/privacy/">политикой обработки персональных данных</a>')}</p>
      </form>
    </div>
  </div>
</section>
'''

    def product_card(self, component, lazy=True):
        images = component.get('images') or []
        if images:
            media = (f'<img src="{image_src(images[0], 640)}" alt="{esc(component["name"])}" '
                     f'loading="{"lazy" if lazy else "eager"}"'
                     f'{size_attrs(self.dims, images[0], 640)}>')
        else:
            media = '<span class="product-card__noimg">Фото по запросу</span>'
        chips = []
        specs = component.get('specs') or {}
        if specs.get('protection'):
            chips.append(f'<span class="chip chip--accent">{esc(specs["protection"].split()[0])}</span>')
        if specs.get('voltage'):
            chips.append(f'<span class="chip">{esc(specs["voltage"])}</span>')
        mods = len(component.get('modifications') or [])
        if mods:
            chips.append(f'<span class="chip">{mods} исполн.</span>')
        # поиск по карточке: артикул и название изделия + коды и названия исполнений,
        # иначе «А.3776.001-02.02» с прайса на сайте не находится
        mods_text = []
        for mod in component.get('modifications') or []:
            mods_text.append(full_article(component['article'], mod.get('code'), mod.get('full_article')))
            # длинные описания в поисковом атрибуте не нужны — только начало
            mods_text.append(clean_mod_name(mod.get('name'))[:80])
        search_text = re.sub(r'\s+', ' ', ' '.join([
            component['article'], component['name'], clean_public(component.get('description')),
            ' '.join(text for text in mods_text if text)]))
        return f'''<a class="product-card" href="{component['_url']}"
   data-search-text="{esc(search_text)}">
  <div class="product-card__media">{media}</div>
  <div class="product-card__body">
    <div class="product-card__article">{esc(component['article'])}</div>
    <div class="product-card__name">{esc(component['name'])}</div>
    <div class="product-card__meta">{''.join(chips)}</div>
  </div>
</a>'''

    def category_card(self, key):
        category = self.categories.get(key)
        if not category:
            return ''
        slug = CATEGORY_SLUGS.get(key, 'prochee')
        count = self.category_counts.get(key, 0)
        photo = next((item['images'][0] for item in self.components
                      if item['category'] == key and item.get('images')), None)
        media = (f'<img src="{image_src(photo, 640)}" alt="" loading="lazy"'
                 f'{size_attrs(self.dims, photo, 640)}>'
                 if photo else '')
        empty = '' if photo else ' cat-card__media--empty'
        ending = plural(count, ('позиция', 'позиции', 'позиций'))
        return f'''<a class="cat-card" href="/catalog/{slug}/">
  <div class="cat-card__media{empty}">{media}</div>
  <div class="cat-card__body">
    <div>
      <div class="cat-card__title">{esc(category['name'])}</div>
      <div class="cat-card__count">{count} {ending}</div>
    </div>
    <span class="cat-card__arrow">{icon('arrow', 15)}</span>
  </div>
</a>'''

    def crumbs(self, items):
        parts = []
        for index, (label, href) in enumerate(items):
            if href and index < len(items) - 1:
                parts.append(f'<a href="{href}">{esc(label)}</a>')
            else:
                parts.append(f'<span aria-current="page">{esc(label)}</span>')
        return f'<nav class="crumbs wrap" aria-label="Хлебные крошки">{"<span>/</span>".join(parts)}</nav>'

    def toolbar(self, categories, current, total):
        tabs = ''.join(
            f'<a href="/catalog/{CATEGORY_SLUGS[key]}/"{self.active(key, current)}>'
            f'{esc(self.categories[key]["name"])}</a>'
            for key in CATEGORY_ORDER if key in self.categories)
        return f'''<div class="catalog-toolbar">
  <div class="wrap catalog-toolbar__inner">
    <label class="search">{icon('search')}
      <span class="sr-only">Поиск по артикулу или названию</span>
      <input type="search" placeholder="Артикул или название — например, 3776.005" data-catalog-search>
    </label>
    <div class="cat-tabs">
      <a href="/catalog/"{self.active("", current or "")}>Все разделы</a>
      {tabs}
    </div>
    <div class="result-count" data-result-count>Всего: {total}</div>
  </div>
</div>'''

    # ------------------------------------------------------------ страницы
    def index(self):
        content = self.content
        hero = content['hero']

        hero_image = self.by_slug.get('a-3776-005l')
        if not hero_image or not hero_image.get('images'):
            hero_image = next((item for item in self.components if item.get('images')), None)
        hero_html = ''
        if hero_image:
            hero_photo = hero_image['images'][0]
            hero_html = (f'<img src="{image_src(hero_photo, 1280)}" '
                         f'alt="{esc(hero_image["name"])}"'
                         f'{size_attrs(self.dims, hero_photo, 1280)}>')

        stats = ''.join(f'<div class="stat"><div class="stat__value">{esc(item["value"])}</div>'
                        f'<div class="stat__label">{esc(item["label"])}</div></div>'
                        for item in content['stats'])

        badges = ''.join(f'<span class="badge">{esc(item)}</span>' for item in hero['badges'])

        categories = ''.join(self.category_card(key) for key in CATEGORY_ORDER)

        advantages = ''.join(
            f'<div class="adv" data-reveal><div class="adv__num">0{index + 1}</div>'
            f'<h3>{esc(item["title"])}</h3><p>{esc(item["text"])}</p></div>'
            for index, item in enumerate(content['advantages']))

        apps = ''.join(f'<div class="app-card" data-reveal><h3>{esc(item["title"])}</h3>'
                       f'<p>{esc(item["text"])}</p></div>'
                       for item in content['applications'])

        featured = [item for item in self.components
                    if item.get('images') and item['category'] != 'harness']
        featured.sort(key=lambda item: (-len(item.get('images') or []), -len(item.get('modifications') or [])))
        featured = featured[:8]
        featured_html = ''.join(self.product_card(item) for item in featured)

        about = content['about']
        about_paragraphs = ''.join(f'<p>{esc(text)}</p>' for text in about['paragraphs'])
        facts = ''.join(f'<div class="fact"><div class="fact__value">{esc(item["value"])}</div>'
                        f'<div class="fact__label">{esc(item["label"])}</div></div>'
                        for item in about['facts'])

        certs = ''.join(
            f'<div class="cert"><div class="cert__title">{esc(item["title"])}</div>'
            f'<div class="cert__number">{esc(item["number"])}</div>'
            f'<p class="cert__text">{esc(item["text"])}</p></div>'
            for item in content['certificates'])

        faq = ''.join(f'<details><summary>{esc(item["q"])}</summary><p>{esc(item["a"])}</p></details>'
                      for item in content['faq'])

        body = f'''
<section class="hero">
  <div class="wrap hero__grid">
    <div>
      <div class="eyebrow">{esc(hero['eyebrow'])}</div>
      <h1>{esc(hero['title'])}</h1>
      <p class="hero__lead">{esc(hero['lead'])}</p>
      <div class="hero__cta">
        <a class="btn btn--primary" href="{esc(hero['primary']['href'])}">{esc(hero['primary']['label'])} {icon('arrow')}</a>
        <a class="btn btn--ghost" href="{esc(hero['secondary']['href'])}">{esc(hero['secondary']['label'])}</a>
      </div>
      <div class="badges">{badges}</div>
    </div>
    <div class="hero__media">
      <div class="hero__visual">
        {hero_html}
      </div>
      <div class="hero__caption"><b>{esc(hero['image_caption'])}</b><span>Своё производство</span></div>
    </div>
  </div>
</section>

<section class="stat-band">
  <div class="wrap stat-band__grid">{stats}</div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <div>
        <div class="eyebrow">Продукция</div>
        <h2>11 разделов: от габаритного огня до жгута</h2>
        <p>Светотехника, электрожгуты и разъёмы для прицепов, грузовиков, автобусов
           и спецтехники. Внутри каждого раздела — исполнения под разные разъёмы,
           длину кабеля и сторону установки.</p>
      </div>
      <a class="section__link" href="/catalog/">Весь каталог {icon('arrow', 14)}</a>
    </div>
    <div class="cat-grid">{categories}</div>
  </div>
</section>

<section class="section section--soft">
  <div class="wrap">
    <div class="section__head">
      <div>
        <div class="eyebrow">Почему нас выбирают</div>
        <h2>Своё производство, а не перепродажа</h2>
      </div>
    </div>
    <div class="adv-grid">{advantages}</div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <div>
        <div class="eyebrow">Популярное</div>
        <h2>Часто заказывают</h2>
        <p>Позиции с фотографиями и полными характеристиками. Всего в каталоге {self.counts_text}.</p>
      </div>
      <a class="section__link" href="/catalog/">Смотреть все {icon('arrow', 14)}</a>
    </div>
    <div class="product-grid">{featured_html}</div>
  </div>
</section>

<section class="section section--soft">
  <div class="wrap">
    <div class="section__head">
      <div>
        <div class="eyebrow">Применение</div>
        <h2>Где работает наша светотехника</h2>
      </div>
    </div>
    <div class="apps">{apps}</div>
  </div>
</section>

<section class="section">
  <div class="wrap about">
    <div class="about__text">
      <div class="eyebrow">О компании</div>
      <h2 style="margin-top:14px;font-size:clamp(26px,3.2vw,38px)">{esc(about['title'])}</h2>
      {about_paragraphs}
    </div>
    <div class="about__facts">{facts}</div>
  </div>
</section>

<section class="section section--soft">
  <div class="wrap">
    <div class="section__head">
      <div>
        <div class="eyebrow">Документы</div>
        <h2>Сертификаты и соответствие</h2>
      </div>
      <a class="section__link" href="/certificates/">Подробнее {icon('arrow', 14)}</a>
    </div>
    <div class="certs">{certs}</div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head">
      <div>
        <div class="eyebrow">Вопросы</div>
        <h2>Коротко о главном</h2>
      </div>
    </div>
    <div class="faq">{faq}</div>
  </div>
</section>
'''
        body += self.request_block()
        return self.page(
            'Светотехника и электрожгуты для грузового транспорта',
            'Производство автомобильной светотехники, электрожгутов и разъёмов: '
            f'{self.counts_text}. Сертификаты ТР ТС 018/2011 и E28, защита до IP69.',
            '/', body,
            schemas=[self.schema_organization(), self.schema_faq()])

    def catalog_index(self):
        cards = ''.join(self.product_card(item) for item in self.components)
        body = f'''
<div class="page-head">
  <div class="wrap">
    <div class="eyebrow">Каталог</div>
    <h1 style="margin-top:14px">Вся продукция завода</h1>
    <p>{len(self.components)} позиций в 11 разделах: фонари, плафоны, жгуты, разъёмы и прочие изделия.
       Фильтруйте по названию или артикулу — поиск работает без перезагрузки страницы.</p>
  </div>
</div>
{self.toolbar(None, None, len(self.components))}
<section class="section section--tight">
  <div class="wrap">
    <div class="product-grid" data-catalog-grid>{cards}</div>
    <div class="empty" data-empty hidden>
      <h3>Ничего не нашлось</h3>
      <p>Уточните артикул или пришлите фото детали — подберём аналог.</p>
      <div style="margin-top:18px"><a class="btn btn--primary" href="/#request">Отправить фото</a></div>
    </div>
  </div>
</section>
'''
        body += self.request_block()
        return self.page('Каталог продукции', 
                         f'Каталог светотехники и электрожгутов: {self.counts_text}, '
                         'фото и характеристики каждой позиции.',
                         '/catalog/', body, current='catalog',
                         schemas=[self.schema_breadcrumbs([('Главная', '/'), ('Каталог', '/catalog/')])])

    def category_page(self, key):
        category = self.categories[key]
        slug = CATEGORY_SLUGS.get(key, 'prochee')
        items = [item for item in self.components if item['category'] == key]
        items.sort(key=lambda item: (-len(item.get('images') or []), item['article']))
        cards = ''.join(self.product_card(item) for item in items)
        body = f'''
{self.crumbs([('Главная', '/'), ('Каталог', '/catalog/'), (category['name'], None)])}
<div class="page-head">
  <div class="wrap">
    <div class="eyebrow">Раздел каталога</div>
    <h1 style="margin-top:14px">{esc(category['name'])}</h1>
    <p>{len(items)} {plural(len(items), ('позиция', 'позиции', 'позиций'))} с характеристиками.
       Не нашли нужное исполнение — соберём под задачу.</p>
  </div>
</div>
{self.toolbar(None, key, len(items))}
<section class="section section--tight">
  <div class="wrap">
    <div class="product-grid">{cards}</div>
    <div class="empty" data-empty hidden>
      <h3>Ничего не нашлось</h3>
      <p>Пришлите артикул или фото — подберём аналог из каталога.</p>
    </div>
  </div>
</section>
'''
        body += self.request_block()
        return self.page(category['name'],
                         f"{category['name']}: {len(items)} "
                         f"{plural(len(items), ('позиция', 'позиции', 'позиций'))} с фото и характеристиками. "
                         f"Производство АТЛАНТА.",
                         f'/catalog/{slug}/', body, current='catalog',
                         schemas=[self.schema_breadcrumbs(
                             [('Главная', '/'), ('Каталог', '/catalog/'), (category['name'], f'/catalog/{slug}/')])])

    def product_page(self, component):
        category = self.categories.get(component['category'], {'name': 'Каталог'})
        cat_slug = component['_cat_slug']
        images = gallery_images(component, self.files_dir)
        parsed = parse_description(component.get('description') or '')

        if images:
            main = (f'<img data-gallery-main src="{image_src(images[0], 1280)}" '
                    f'alt="{esc(component["name"])}"'
                    f'{size_attrs(self.dims, images[0], 1280)}>')
            badge = f'<span class="gallery__badge">{len(images)} фото</span>'
        else:
            main = '<span>Фото по запросу</span>'
            badge = ''

        thumbs = ''
        if len(images) > 1:
            buttons = ''.join(
                f'<button type="button" data-gallery-thumb data-src="{image_src(name, 1280)}" '
                f'data-alt="{esc(component["name"])}" aria-current="{"true" if index == 0 else "false"}">'
                f'<img src="{image_src(name, 640)}" alt="Фото {index + 1}" loading="lazy"></button>'
                for index, name in enumerate(images))
            thumbs = f'<div class="gallery__thumbs" role="group" aria-label="Фотографии">{buttons}</div>'

        functions_html = ''
        functions = parsed['functions'] or (component.get('specs') or {}).get('functions') or []
        if functions:
            items = ''.join(f'<li>{esc(item)}</li>' for item in functions)
            functions_html = f'<div class="block"><h2>Функции</h2><ul class="feature-list">{items}</ul></div>'

        features_html = ''
        if parsed['features']:
            items = ''.join(f'<li>{esc(item)}</li>' for item in parsed['features'])
            features_html = f'<div class="block"><h2>Особенности</h2><ul class="feature-list">{items}</ul></div>'

        rows = spec_rows(component)
        specs_html = ''
        if rows:
            body_rows = ''.join(f'<tr><th scope="row">{esc(key)}</th><td>{esc(value)}</td></tr>'
                                for key, value in rows)
            specs_html = f'<div class="block"><h2>Характеристики</h2><table class="specs">{body_rows}</table></div>'

        mods = component.get('modifications') or []
        mods_html = ''
        # если у всех исполнений в каталоге только служебная пометка — таблицу не показываем
        if mods and any(clean_mod_name(mod.get('name')) for mod in mods):
            rows = ''.join(
                f'<tr><td>{esc(full_article(component["article"], mod.get("code"), mod.get("full_article")))}</td>'
                f'<td>{esc(clean_mod_name(mod.get("name")) or "Стандартное исполнение")}</td></tr>'
                for mod in mods)
            mods_html = f'''<div class="block"><h2>Исполнения ({len(mods)})</h2>
<div class="mods__scroll"><table class="mods">
<thead><tr><th>Артикул</th><th>Описание</th></tr></thead>
<tbody>{rows}</tbody></table></div></div>'''

        related = [item for item in self.components
                   if item['category'] == component['category'] and item is not component]
        # сначала родня по изделию: у «А.3776.005» — его комплекты «А.3776.005/А.3731.007»
        root = component['article'].split('/')[0]
        related.sort(key=lambda item: (item['article'].split('/')[0] != root,
                                       not item.get('images'), -len(item.get('images') or [])))
        related_html = ''.join(self.product_card(item) for item in related[:4])

        lead = lead_text(component)
        lead_html = f'<p class="product__lead">{esc(lead)}</p>' if lead else ''
        article = component['article']

        body = f'''
{self.crumbs([('Главная', '/'), ('Каталог', '/catalog/'), (category['name'], f'/catalog/{cat_slug}/'),
              (article, None)])}
<section class="wrap product">
  <div class="gallery" data-gallery>
    <div class="gallery__main{' gallery__main--empty' if not images else ''}">{main}{badge}</div>
    {thumbs}
  </div>
  <div>
    <div class="product__head">
      <div class="product__article">{esc(article)}</div>
      <h1>{esc(component['name'])}</h1>
      {lead_html}
      <div class="product__actions">
        <a class="btn btn--primary" href="#request">Запросить цену {icon('arrow')}</a>
        <a class="btn btn--ghost" href="#docs">Документы</a>
      </div>
      <p class="product__note">Цены не публикуем: стоимость зависит от исполнения и объёма партии.</p>
    </div>
    {specs_html}
    {functions_html}
    {features_html}
    {mods_html}
    <div class="block" id="docs">
      <h2>Документы</h2>
      <p style="color:var(--muted);font-size:14.5px">
        Сертификат соответствия ТР ТС 018/2011 и протоколы испытаний прикладываем к отгрузке.
        Копии — по запросу: <a href="#request" style="border-bottom:1px solid var(--line-strong)">оставить заявку</a>.
      </p>
    </div>
  </div>
</section>
'''
        if related_html:
            body += f'''
<section class="section section--soft section--tight">
  <div class="wrap">
    <div class="section__head"><div><div class="eyebrow">Из этого же раздела</div>
      <h2 style="font-size:26px">Похожие позиции</h2></div>
      <a class="section__link" href="/catalog/{cat_slug}/">Весь раздел {icon('arrow', 14)}</a>
    </div>
    <div class="product-grid">{related_html}</div>
  </div>
</section>
'''
        body += self.request_block(article)

        description = clip(f"{component['name']} ({article}). {lead}".strip(), 165)
        if len(description) < 110:
            description = clip(description.rstrip('. ') +
                               '. Светотехника и электрожгуты собственного производства, '
                               'цена по запросу, отгрузка по России.', 165)
        name_limit = max(24, 58 - len(article) - 1)
        parts = [part for part in article.split('/') if part]
        if len(parts) > 1 and all(part in component['name'] for part in parts):
            # артикул уже в названии (изделие-комплект: «Комплект: А.3776.005 + А.3731.007 «клюшка»»)
            title = clip(component['name'], 70)
        else:
            title = (f"{component['name']} {article}" if len(component['name']) + len(article) <= 58
                     else f"{clip(component['name'], name_limit)} {article}")
        og_image = image_src(images[0], 1280) if images else ''
        return self.page(title, description, component['_url'], body,
                         current='catalog', og_image=og_image,
                         schemas=[self.schema_product(component), self.schema_breadcrumbs(
                             [('Главная', '/'), ('Каталог', '/catalog/'),
                              (category['name'], f'/catalog/{cat_slug}/'), (article, component['_url'])])])

    def about_page(self):
        content = self.content['about']
        paragraphs = ''.join(f'<p>{esc(text)}</p>' for text in content['paragraphs'])
        facts = ''.join(f'<div class="fact"><div class="fact__value">{esc(item["value"])}</div>'
                        f'<div class="fact__label">{esc(item["label"])}</div></div>'
                        for item in content['facts'])
        production = self.content['contacts']['production']
        body = f'''
{self.crumbs([('Главная', '/'), ('О компании', None)])}
<div class="wrap prose">
  <h1>{esc(content['title'])}</h1>
  {paragraphs}
  <div class="about__facts" style="margin-top:32px">{facts}</div>

  <h2>Производство</h2>
  <p>{esc(production['address'])}. Полный цикл: конструкция и оснастка, сборка,
     герметизация, проверка на стенде, упаковка и отгрузка.</p>

  <h2>Что мы делаем</h2>
  <ul>
    <li>Автомобильная светотехника: габаритные и задние фонари, указатели поворота,
        фонари освещения номерного знака, заднего хода, противотуманные,
        сигнал торможения, плафоны.</li>
    <li>Электрожгутовая продукция: 124 семейства и 581 исполнение под конкретные
        модели техники и заказчиков.</li>
    <li>Соединители и разъёмы: байонетные вилки и розетки, AMP, комплектующие.</li>
    <li>Изделия под заказ: меняем длину кабеля, разъёмы, сторону установки и кронштейн.</li>
  </ul>

  <h2>Как мы работаем</h2>
  <ul>
    <li>Заявка: присылаете артикулы, фото детали или описание задачи.</li>
    <li>Подбор: предлагаем готовое исполнение из каталога или собираем новое.</li>
    <li>Производство: изготавливаем партию, проводим проверку.</li>
    <li>Отгрузка: документы, сертификаты, доставка транспортной компанией.</li>
  </ul>
</div>
'''
        body += self.request_block()
        return self.page('О компании', 'АТЛАНТА — российский производитель автомобильной светотехники, '
                         'электрожгутов и разъёмов с 2000 года. Производство в Липецкой области.',
                         '/about/', body, current='about',
                         schemas=[self.schema_breadcrumbs([('Главная', '/'), ('О компании', '/about/')])])

    def certificates_page(self):
        certs = ''.join(
            f'<div class="cert"><div class="cert__title">{esc(item["title"])}</div>'
            f'<div class="cert__number">{esc(item["number"])}</div>'
            f'<p class="cert__text">{esc(item["text"])}</p></div>'
            for item in self.content['certificates'])
        body = f'''
{self.crumbs([('Главная', '/'), ('Сертификаты', None)])}
<div class="wrap prose">
  <h1>Сертификаты и соответствие</h1>
  <p>Вся продукция проходит испытания и имеет документы соответствия. Копии
     прикладываем к отгрузке, по запросу присылаем сканы.</p>
</div>
<section class="section section--tight">
  <div class="wrap"><div class="certs">{certs}</div></div>
</section>
<div class="wrap prose" style="padding-top:0">
  <h2>Как проверить</h2>
  <p>Номер сертификата можно проверить в реестре Федеральной службы по аккредитации
     и в реестре технических регламентов ЕАЭС. Если нужен скан или протокол испытаний —
     напишите, пришлём.</p>
</div>
'''
        body += self.request_block()
        return self.page('Сертификаты', 'Сертификат ТР ТС 018/2011, E28, ГОСТ 14254 и ГОСТ 15150 — '
                         'документы на светотехнику и жгуты АТЛАНТА.',
                         '/certificates/', body, current='certificates',
                         schemas=[self.schema_breadcrumbs(
                             [('Главная', '/'), ('Сертификаты', '/certificates/')])])

    def delivery_page(self):
        terms = ''.join(f'<div class="term"><h3>{esc(item["title"])}</h3>'
                        f'<p>{esc(item["text"])}</p></div>'
                        for item in self.content['terms'])
        body = f'''
{self.crumbs([('Главная', '/'), ('Условия работы', None)])}
<div class="wrap prose">
  <h1>Условия работы</h1>
  <p>Работаем с конвейерами, автопарками, магазинами и небольшими мастерскими.
     Ниже — базовые условия, точные согласуем в договоре.</p>
</div>
<section class="section section--tight">
  <div class="wrap"><div class="terms">{terms}</div></div>
</section>
'''
        body += self.request_block()
        return self.page('Условия работы', 'Цена по запросу, отгрузка партиями и поштучно, '
                         'полный пакет документов, доставка по России.',
                         '/delivery/', body, current='delivery',
                         schemas=[self.schema_breadcrumbs(
                             [('Главная', '/'), ('Условия работы', '/delivery/')])])

    def contacts_page(self):
        contacts = self.content['contacts']
        cards = ''.join(
            f'<div class="contact-card"><h3>{esc(item["city"])}</h3>'
            f'<a href="tel:{esc(item["phone_href"])}">{esc(item["phone"])}</a>'
            f'<a class="muted" href="mailto:{esc(item["email"])}">{esc(item["email"])}</a></div>'
            for item in contacts['offices'])
        body = f'''
{self.crumbs([('Главная', '/'), ('Контакты', None)])}
<div class="wrap prose" style="padding-bottom:0">
  <h1>Контакты</h1>
  <p>Позвоните, напишите в Telegram или оставьте заявку — ответим в рабочее время.
     {esc(contacts['hours'])}</p>
</div>
<section class="section section--tight">
  <div class="wrap"><div class="contacts-grid">{cards}</div></div>
</section>
<div class="wrap prose" style="padding-top:0">
  <h2>Производство</h2>
  <p>{esc(contacts['production']['address'])}</p>
  <h2>Как добраться</h2>
  <p>Площадка находится в Липецкой области, Усманский район, село Московка.
     Визит согласуйте заранее — встретим и покажем производство.</p>
</div>
'''
        body += self.request_block()
        return self.page('Контакты', 'Телефоны, почта и адрес производства АТЛАНТА. '
                         'Москва, Санкт-Петербург, регионы.',
                         '/contacts/', body, current='contacts',
                         schemas=[self.schema_breadcrumbs([('Главная', '/'), ('Контакты', '/contacts/')])])

    def privacy_page(self):
        body = f'''
{self.crumbs([('Главная', '/'), ('Политика обработки персональных данных', None)])}
<div class="wrap prose">
  <h1>Политика обработки персональных данных</h1>
  <p>Настоящая политика определяет порядок обработки персональных данных посетителей
     сайта {esc(self.site['domain'])}.</p>

  <h2>Какие данные мы собираем</h2>
  <p>Только те, которые посетитель указывает сам в форме заявки: имя, телефон,
     адрес электронной почты и текст сообщения.</p>

  <h2>Зачем</h2>
  <p>Чтобы ответить на заявку, подготовить коммерческое предложение и согласовать
     условия поставки. Данные не передаются третьим лицам, кроме случаев,
     предусмотренных законом.</p>

  <h2>Согласие</h2>
  <p>Отправляя форму, посетитель соглашается на обработку указанных данных.
     Согласие можно отозвать письмом на почту из раздела «Контакты» — данные удалим
     в течение рабочего дня.</p>

  <h2>Хранение</h2>
  <p>Данные хранятся на серверах в России и не дольше, чем нужно для работы с заявкой
     и исполнения договора.</p>

  <h2>Cookie</h2>
  <p>Сайт использует технические cookie для работы интерфейса. Аналитика
     подключается только с согласия посетителя.</p>
</div>
'''
        return self.page('Политика обработки персональных данных',
                         'Как АТЛАНТА обрабатывает персональные данные посетителей сайта.',
                         '/privacy/', body,
                         schemas=[self.schema_breadcrumbs(
                             [('Главная', '/'),
                              ('Политика обработки персональных данных', '/privacy/')])])

    def not_found(self):
        body = f'''
<div class="wrap prose" style="text-align:center;padding-top:90px">
  <div class="eyebrow" style="justify-content:center">404</div>
  <h1 style="margin-top:16px">Страница не найдена</h1>
  <p style="margin-top:14px">Возможно, позиция переехала. Посмотрите каталог — там все {self.counts_text}.</p>
  <div style="margin-top:26px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
    <a class="btn btn--primary" href="/catalog/">В каталог</a>
    <a class="btn btn--ghost" href="/">На главную</a>
  </div>
</div>
'''
        return self.page('Страница не найдена', 'Страница не найдена — АТЛАНТА.', '/404.html', body)

    # ------------------------------------------------------------ сборка
    def build(self):
        pages = {
            '/': self.index(),
            '/catalog/': self.catalog_index(),
            '/about/': self.about_page(),
            '/certificates/': self.certificates_page(),
            '/delivery/': self.delivery_page(),
            '/contacts/': self.contacts_page(),
            '/privacy/': self.privacy_page(),
            '/404.html': self.not_found(),
        }

        for key in CATEGORY_ORDER:
            if key in self.categories:
                pages[f'/catalog/{CATEGORY_SLUGS[key]}/'] = self.category_page(key)

        for component in self.components:
            pages[component['_url']] = self.product_page(component)

        # прежние артикулы слитых семейств: А.3731.027-01 → А.3731.027
        redirects = set()
        for component in self.components:
            for old_article in component.get('supersedes') or []:
                path = f"/catalog/{component['_cat_slug']}/{slugify(old_article)}/"
                if path in pages:
                    continue
                pages[path] = self.redirect_page(component, old_article)
                redirects.add(path)

        for path, html_text in pages.items():
            self.write(path, html_text)

        # служебные файлы
        def sitemap_entry(path):
            depth = path.strip('/').count('/')
            if path == '/':
                freq, priority = 'weekly', '1.0'
            elif path == '/catalog/':
                freq, priority = 'weekly', '0.9'
            elif path.startswith('/catalog/') and depth == 1:
                freq, priority = 'weekly', '0.8'
            elif path.startswith('/catalog/'):
                freq, priority = 'monthly', '0.6'
            else:
                freq, priority = 'monthly', '0.4'
            return (f'<url><loc>{esc(self.site["domain"] + path)}</loc>'
                    f'<changefreq>{freq}</changefreq><priority>{priority}</priority></url>')

        urls = ''.join(sitemap_entry(path) for path in pages
                       if path != '/404.html' and path not in redirects)
        (self.out / 'sitemap.xml').write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            f'{urls}</urlset>\n', encoding='utf-8')
        (self.out / 'robots.txt').write_text(
            f'User-agent: *\nAllow: /\nSitemap: {self.site["domain"]}/sitemap.xml\n',
            encoding='utf-8')

        # поисковый индекс — на случай внешней интеграции и быстрых ссылок
        index = [{'article': item['article'], 'name': item['name'], 'url': item['_url'],
                  'category': self.categories.get(item['category'], {}).get('name', ''),
                  'modifications': [{'article': full_article(item['article'], mod.get('code'), mod.get('full_article')),
                                     'code': mod.get('code') or '',
                                     'name': clean_mod_name(mod.get('name'))}
                                    for mod in item.get('modifications') or []]}
                 for item in self.components]
        (self.out / 'search.json').write_text(
            json.dumps(index, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

        return len(pages)


def main():
    parser = argparse.ArgumentParser(description='Сборка сайта АТЛАНТА')
    parser.add_argument('--out', default=str(SITE / 'dist'))
    parser.add_argument('--skip-images', action='store_true', help='не пережимать фото')
    parser.add_argument('--domain', default='', help='домен сайта, например https://atlanta.ru '
                                                    '(перебивает site.domain из content.json)')
    args = parser.parse_args()

    out_dir = Path(args.out)
    content = read_json(SITE / 'content.json')
    catalog = read_json(CATALOG_JSON)

    content = localize_counts(content,
                              len(catalog['components']),
                              sum(len(item.get('modifications') or [])
                                  for item in catalog['components']))

    if args.domain:
        domain = args.domain.strip().rstrip('/')
        if '://' not in domain:
            domain = 'https://' + domain
        content['site']['domain'] = domain

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    static_src = SITE / 'static'
    shutil.copytree(static_src, out_dir / 'static')

    print(f'фото: {sum(1 for _ in FILES_DIR.iterdir())} файлов в источнике')
    made, names, dims = build_images(catalog['components'], out_dir, skip=args.skip_images)
    print(f'  подготовлено файлов: {made}')

    site = Site(content, catalog, out_dir, dims)
    pages = site.build()
    print(f'страниц: {pages}')
    print(f'готово → {out_dir}')


if __name__ == '__main__':
    sys.exit(main())
