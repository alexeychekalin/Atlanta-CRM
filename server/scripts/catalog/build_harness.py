"""Разбор раздела «Электропровода (жгуты)» — стр. 68–73 каталога АТЛАНТА-26.

Раздел устроен иначе, чем фонари: на странице несколько таблиц, каждая со своим
синим заголовком («А.3724.* ЖГУТ ЦЕНТРАЛЬНЫЙ» + пометка «(КАБЕЛЬ ОСНОВНОЙ)»),
внутри — строки «ФОТО | ЧЕРТЁЖ | АРТИКУЛ | ОПИСАНИЕ». Артикул сразу полный
(А.3724.402-01.01), модификаций у жгутов нет.

Заголовок группы в PDF разбит на отдельные блоки, поэтому текст собирается по
координатам: сначала все блоки сортируются сверху вниз, затем «А.3724.*»
склеивается со следующим за ним названием, а «(пометка)» под ним — с ним же.

Запуск:
    python3 scripts/catalog/build_harness.py /path/to/Каталог-АТЛАНТА-26.pdf /tmp/out
"""
import json
import os
import re
import sys

import pymupdf

PDF = sys.argv[1] if len(sys.argv) > 1 else '/tmp/arena-coding-uploads/Каталог АТЛАНТА-26.pdf'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/cbuild4'
os.makedirs(OUT + '/files', exist_ok=True)

PAGES = [68, 69, 70, 71, 72, 73]
ART_RE = re.compile(r'^А\.3724\.\d{3}-\S+$')
GROUP_MARK = 'А.3724.*'

d = pymupdf.open(PDF)

TR = str.maketrans({'А': 'a', 'Б': 'b', 'Ж': 'zh', 'Л': 'l', 'П': 'p', 'Т': 't',
                    'О': 'o', 'У': 'u', '.': '-', '/': '-', ' ': '-'})


def slug(a):
    s = re.sub(r'[^a-z0-9-]+', '-', a.translate(TR).lower())
    return re.sub(r'-+', '-', s).strip('-')


def normalize_name(s):
    s = re.sub(r'\s+', ' ', s).strip()
    s = s.lower()
    s = re.sub(r'^([а-яё])', lambda m: m.group(1).upper(), s)
    for a in ('LED', 'IP', 'ТС', 'ФОНЗ', 'E28', 'ГОСТ', 'ГО', 'ЗХ', 'ПТФ', 'ЛП'):
        s = re.sub(r'(?<![а-яёa-z])' + a.lower() + r'(?![а-яёa-z])', a, s)
    return s


def clean_desc(lines):
    """Описание строки таблицы: убираем заголовки колонок и служебные строки."""
    skip = {'ФОТО', 'ЧЕРТЕЖ', 'АРТИКУЛ', 'ОПИСАНИЕ', 'СДЕЛАНО В РОССИИ', 'ООО "АТЛАНТА"'}
    out = [l for l in lines if l not in skip and not l.startswith('ООО "АТЛАНТА"')]
    return re.sub(r'\s+', ' ', ' '.join(out)).strip()


def page_items(page):
    """Текст и товарные фото страницы, отсортированные сверху вниз."""
    items = []
    for b in page.get_text('blocks'):
        text = b[4].strip()
        if text:
            items.append({'kind': 'text', 'y': b[1], 'y2': b[3], 'x': b[0], 'text': text})

    for img in page.get_images(full=True):
        info = d.extract_image(img[0])
        w, h = info['width'], info['height']
        if w < 120 or h < 30:
            continue
        for rc in page.get_image_rects(img[0]):
            # колонка «ФОТО» — левая треть страницы (правее идёт «ЧЕРТЕЖ»);
            # выше первой шапки таблицы — только логотипы и плашки сертификатов
            if rc.y0 < 75:
                continue
            if rc.x1 < page.rect.width * 0.34 and rc.height > 30:
                items.append({'kind': 'image', 'y': rc.y0, 'y2': rc.y1, 'x': rc.x0,
                          'x1': rc.x1, 'info': info})

    items.sort(key=lambda it: (round(it['y'], 1), it['x']))
    return items


GROUP_MARK = 'А.3724.*'
HEADERS = {'ФОТО', 'ЧЕРТЕЖ', 'АРТИКУЛ', 'ОПИСАНИЕ', 'СДЕЛАНО В РОССИИ'}

results = []
group = None        # название группы без пометки («Жгут переходник»)
variant = None      # пометка варианта («розетка-вилка»), своя у каждой подтаблицы


def is_label(line):
    return line.startswith('(') and line.endswith(')')


for pg in PAGES:
    page = d[pg - 1]
    width = page.rect.width
    rows = []        # позиции страницы: артикул + контекст
    loose = []       # подписи и фото, ждущие привязки к строке

    for item in page_items(page):
        if item['kind'] == 'image':
            loose.append(item)
            continue

        lines = [l.strip() for l in item['text'].split('\n') if l.strip()]

        if lines and lines[0] == GROUP_MARK:
            name_lines = lines[1:]
            if name_lines:
                group = ' '.join(name_lines).strip()
            variant = None
            continue

        # «(КАБЕЛЬ ОСНОВНОЙ)» — пометка подтаблицы, стоит отдельным блоком
        if len(lines) == 1 and is_label(lines[0]):
            variant = lines[0].strip('()').lower()
            continue

        if lines and lines[0] in HEADERS:
            continue

        arts = [l for l in lines if ART_RE.match(l)]
        if arts:
            for a in arts:
                rows.append({'article': a, 'y': (item['y'] + item['y2']) / 2,
                             'group': group, 'variant': variant,
                             'desc': [], 'image': None})
            continue

        loose.append(item)

    # фото и описание стоят в таблице выше артикула, но по центру блока
    # попадают точно в свою строку — привязываем к ближайшему артикулу
    for item in loose:
        if not rows:
            continue
        cy = (item['y'] + item['y2']) / 2
        best = min(rows, key=lambda r: abs(r['y'] - cy))
        if abs(best['y'] - cy) > 70:
            continue
        if item['kind'] == 'image':
            if item['x1'] < width * 0.34 and best['image'] is None:
                best['image'] = item['info']
            continue
        if item['x'] < width * 0.7:
            continue    # не колонка «ОПИСАНИЕ»
        text = ' '.join(item['text'].split())
        if text and text not in best['desc']:
            best['desc'].append(text)

    for row in rows:
        name = row['group'] or 'Жгут'
        if row['variant']:
            variant = (row['variant'].replace('2хго', '2х ГО')
                       .replace('2хзх', '2х ЗХ')
                       .replace('стоп+зх', 'стоп+ЗХ'))
            name = f"{name} ({variant})"
        desc = clean_desc(row['desc'])
        file_name = None
        if row['image']:
            file_name = slug(row['article']) + '.' + row['image']['ext']
            with open(os.path.join(OUT, 'files', file_name), 'wb') as f:
                f.write(row['image']['image'])
        results.append({
            'category': 'harness',
            'article': row['article'],
            'name': normalize_name(name),
            'description': normalize_name(name) + ('. ' + desc if desc else '.'),
            'specs': {'functions': [], 'voltage': None, 'temperature': None,
                      'protection': None, 'power': [], 'dimensions': None},
            'image': file_name,
            'source_page': pg,
            'modifications': [],
            '_group': row['group'],
            '_variant': row['variant'],
            '_desc': desc,
        })

json.dump(results, open(os.path.join(OUT, 'harness.json'), 'w'), ensure_ascii=False, indent=2)
print(f'позиций: {len(results)}, с фото: {sum(1 for c in results if c["image"])}')
for c in results:
    print(f"  p{c['source_page']} {c['article']:22} фото={'да' if c['image'] else 'НЕТ'} | {c['_group']}")
