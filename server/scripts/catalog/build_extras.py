"""Разбор разделов «Соединители электропроводов (разъёмы)» (стр. 74–75) и
«Устройства дополнительные прочие» (стр. 76–79) каталога АТЛАНТА-26.

Устроены как жгуты (таблицы «ФОТО | ЧЕРТЕЖ | АРТИКУЛ | ОПИСАНИЕ»), но с тремя
отличиями:

- артикул не всегда вида `А.3723.xxx`: встречаются заводские номера
  (`97461Н-3716021-01`, `9540-3716450-50`), номер с пробелом
  (`ЗИСС 02.3713.000-10`) и артикул, разорванный переносом строки;
- название позиции напечатано в чёрной плашке сверху, а в таблице стоит только
  артикул с описанием; плашек на странице несколько, они отличаются от текста
  таблицы крупным кеглем (≈14 pt);
- на стр. 75 под одной плашкой-группой (`А.3723.*`) идут пять позиций, и
  название каждой задаёт синяя пометка «(…)» над подтаблицей.

Запуск:
    python3 scripts/catalog/build_extras.py /path/to/Каталог-АТЛАНТА-26.pdf /tmp/out

На выходе /tmp/out/connector.json, /tmp/out/accessory.json и /tmp/out/files/*.
"""
import json
import os
import re
import sys

import pymupdf

PDF = sys.argv[1] if len(sys.argv) > 1 else '/tmp/arena-coding-uploads/Каталог АТЛАНТА-26.pdf'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/cbuild8'
os.makedirs(OUT + '/files', exist_ok=True)

SECTIONS = [
    {'key': 'connector', 'category': 'connector', 'pages': [75]},
    {'key': 'accessory', 'category': 'accessory', 'pages': [77, 78, 79]},
]

ART_RE = re.compile(
    r'^(А\.\d{4}\.\d{3}(?:-\d{1,2})?'       # А.3723.001, А.4739.009-01
    r'|ЗИСС\s?\d{2}\.\d{4}\.\d{3}-\d{2}'    # ЗИСС 02.3713.000-10
    r'|\d{5}[А-ЯA-Z]?-\d{6,8}-\d{2}'        # 97461Н-3716021-01
    r'|\d{4}-\d{6,8}-\d{2}'                 # 9540-3716450-50
    r')\s*(.*)$'
)
HEADERS = {'ФОТО', 'ЧЕРТЕЖ', 'АРТИКУЛ', 'ОПИСАНИЕ'}
GROUP_MARK = re.compile(r'^А\.\d{4}\.\*$')
HEADING_SIZE = 13.5

# Названия, которые из плашки и пометок не собираются: пометка дублирует
# название, а различие исполнений (цвет, одинарная/двойная) напечатано только
# в описании. Решения зафиксированы здесь, чтобы их было видно при сверке.
NAME_OVERRIDES = {
    'А.3723.001': 'Соединитель универсальный (быстрый обжим)',
    'А.3723.006': 'Вилка типа 282104',
    'А.3723.007': 'Розетка типа 282080',
    'А.3723.015': 'Вилка байонет 5-конт. жёлтая',
    'А.3723.016': 'Вилка байонет 5-конт. зелёная',
    'А.4739.001': 'Кронштейн на трубу',
    '97461Н-3716021-01': 'Кронштейн на обечайку',
    'ЗИСС 02.3713.000-10': 'Универсальный кронштейн',
    'А.4739.002': 'Чехол защитный большой',
    '9540-3716450-50': 'Чехол защитный средний',
    'А.4739.006': 'Колпачок на гайку 32',
    'А.4739.009-01': 'Коробка распределительная электрическая (одинарная)',
    'А.4739.009-02': 'Коробка распределительная электрическая (двойная)',
}

# Опечатки вёрстки: в таблице напечатан артикул соседней позиции
ARTICLE_OVERRIDES = {
    77: {'А.4739.002': 'А.4739.001'},
}

TR = str.maketrans({'А': 'a', 'Б': 'b', 'Ж': 'zh', 'Л': 'l', 'П': 'p', 'Т': 't',
                    'О': 'o', 'У': 'u', 'Н': 'n', 'З': 'z', 'И': 'i', 'С': 's',
                    'Ф': 'f', 'ф': 'f', '.': '-', '/': '-', ' ': '-'})
NAME_FIXES = {
    'кронтшейн': 'кронштейн',
    'колпачек': 'колпачок',
}


def slug(a):
    s = re.sub(r'[^a-z0-9-]+', '-', a.translate(TR).lower())
    return re.sub(r'-+', '-', s).strip('-')


def normalize_name(s):
    s = re.sub(r'\s+', ' ', s).strip().lower()
    for wrong, right in NAME_FIXES.items():
        s = s.replace(wrong, right)
    s = re.sub(r'^([а-яё])', lambda m: m.group(1).upper(), s)
    for a in ('LED', 'IP', 'ТС', 'ФОНЗ', 'ПТФ', 'ДСТ', 'ЗИСС', 'ABS', 'ПВХ'):
        s = re.sub(r'(?<![а-яёa-z])' + a.lower() + r'(?![а-яёa-z])', a, s)
    return s


def tidy(s):
    s = re.sub(r'-\s+(\d)', r'-\1', s)          # разрыв артикула переносом
    s = re.sub(r'\s+', ' ', s).strip()
    return s.replace('–', '-').replace(' - ', ' — ')


def join_spans(spans):
    """Склейка спанов блока в строку с пробелами на месте разрыва.

    PDF хранит «кабелем» и «КАВТ» разными спанами без пробела между ними,
    поэтому при наивной склейке получается «кабелемКАВТ».
    """
    out = ''
    for s in spans:
        t = s['text']
        if out and t and not out.endswith((' ', '-', '/', '(', '«')) \
                and t[0] not in ' ,.;:!?)]»%':
            out += ' '
        out += t
    return out


def page_blocks(page):
    """Текстовые блоки с максимальным кеглем и картинками в одном списке."""
    items = []
    for b in page.get_text('dict')['blocks']:
        if b['type'] != 0:
            continue
        spans = [s for l in b['lines'] for s in l['spans']]
        text = tidy(join_spans(spans))
        if not text:
            continue
        items.append({'kind': 'text', 'y': b['bbox'][1], 'y2': b['bbox'][3],
                      'x': b['bbox'][0], 'text': text,
                      'size': max(s['size'] for s in spans)})

    for img in page.get_images(full=True):
        info = d.extract_image(img[0])
        if info['width'] < 70 or info['height'] < 40:
            continue        # значки сертификатов и мелкие пиктограммы
        for rc in page.get_image_rects(img[0]):
            if rc.y0 < 60 or rc.x1 > page.rect.width * 0.34:
                continue    # колонка «ФОТО» — левая треть страницы
            items.append({'kind': 'image', 'y': rc.y0, 'y2': rc.y1, 'x': rc.x0,
                          'info': info})

    items.sort(key=lambda it: (round(it['y'], 1), it['x']))
    return items


def parse_page(pg, category):
    page = d[pg - 1]
    header_art = header_name = None
    variant = None
    rows, loose = [], []
    waiting_tail = False     # предыдущий заголовок ждёт продолжения в верхнем регистре

    for item in page_blocks(page):
        if item['kind'] == 'image':
            loose.append(item)
            continue

        text = item['text']

        if item['size'] >= HEADING_SIZE:
            if text.startswith('(') and text.endswith(')'):
                variant = text.strip('()')
                waiting_tail = False
                continue
            if text.startswith(('ООО "АТЛАНТА"', 'СДЕЛАНО В РОССИИ')):
                continue
            m = ART_RE.match(text)
            if m and not waiting_tail:
                header_art, header_name = m.group(1), (m.group(2) or None)
            elif waiting_tail and header_name and re.fullmatch(r'[А-ЯЁ .-]+', text):
                header_name = header_name + ' ' + text          # «ЭЛЕКТРИЧЕСКАЯ»
            else:
                header_art, header_name = text, None
            waiting_tail = bool(header_name) and m is not None
            continue

        if sum(1 for w in text.split(' ') if w in HEADERS) >= 3:
            continue        # шапка «ФОТО ЧЕРТЕЖ АРТИКУЛ ОПИСАНИЕ»
        if text.startswith(('ООО "АТЛАНТА"', 'СДЕЛАНО В РОССИИ')) or re.fullmatch(r'\d{2}', text):
            continue

        m = ART_RE.match(text)
        if m:
            rows.append({'article': m.group(1), 'y': (item['y'] + item['y2']) / 2,
                         'desc': [m.group(2)] if m.group(2) else [], 'image': None})
            continue

        loose.append(item)

    if not rows:
        return []

    for item in loose:
        cy = (item['y'] + item['y2']) / 2
        best = min(rows, key=lambda r: abs(r['y'] - cy))
        if abs(best['y'] - cy) > 90:
            continue
        if item['kind'] == 'image':
            if best['image'] is None:
                best['image'] = item['info']
            continue
        if item['text'] not in best['desc']:
            best['desc'].append(item['text'])

    is_group = bool(header_art and GROUP_MARK.match(header_art))
    fixes = ARTICLE_OVERRIDES.get(pg, {})

    result = []
    for row in rows:
        art = fixes.get(row['article'], row['article'])
        if art.startswith('ЗИСС') and ' ' not in art:
            art = art[:4] + ' ' + art[4:]

        if is_group:
            name = variant or header_name or art
        else:
            name = header_name or variant or art
            if variant and not header_name:
                name = variant

        name = NAME_OVERRIDES.get(art, name)
        desc = '. '.join(x for x in row['desc'] if x)
        file_name = None
        if row['image']:
            file_name = slug(art) + '.' + row['image']['ext']
            with open(os.path.join(OUT, 'files', file_name), 'wb') as f:
                f.write(row['image']['image'])

        result.append({
            'category': category,
            'article': art,
            'name': normalize_name(name),
            'description': normalize_name(name) + ('. ' + desc if desc else '.'),
            'specs': {'functions': [], 'voltage': None, 'temperature': None,
                      'protection': None, 'power': [], 'dimensions': None},
            'image': file_name,
            'source_page': pg,
            'modifications': [],
            '_variant': variant,
            '_desc': desc,
        })
    return result


d = pymupdf.open(PDF)
for section in SECTIONS:
    items = []
    for pg in section['pages']:
        items.extend(parse_page(pg, section['category']))
    with open(os.path.join(OUT, section['key'] + '.json'), 'w') as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"\n=== {section['key']} ({section['category']}) ===")
    for c in items:
        print(f"  p{c['source_page']} {c['article']:22} фото={'да' if c['image'] else 'НЕТ'} | {c['name']}")
    print(f"  итого: {len(items)} позиций")
