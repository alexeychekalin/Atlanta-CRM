"""Разбор разделов «Указатели поворота» (стр. 48), «Фонари освещения номерного
знака» (стр. 50–54), «Фонари заднего хода» (стр. 55–57), «Фонари
противотуманные» (стр. 58–59) и «Фонари дополнительного сигнала торможения»
(стр. 60–62) и «Плафоны внутреннего освещения» (стр. 63–66)
каталога АТЛАНТА-26.

Эти разделы устроены проще габаритных: одна позиция на страницу, заголовок
с пометкой в скобках стоит внизу страницы, таблица артикулов — там же.

Запуск:
    python3 scripts/catalog/build_lights.py /path/to/Каталог-АТЛАНТА-26.pdf /tmp/out

На выходе /tmp/out/turn.json, /tmp/out/plate.json и /tmp/out/files/*.
"""
import pypdf
import pymupdf
import json
import os
import re
import sys

PDF = sys.argv[1] if len(sys.argv) > 1 else '/tmp/arena-coding-uploads/Каталог АТЛАНТА-26.pdf'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/cbuild3'
os.makedirs(OUT + '/files', exist_ok=True)

r = pypdf.PdfReader(PDF)
d = pymupdf.open(PDF)

TITLE_RE = re.compile(r'^(А\.[0-9]{4}\.[0-9]{3}[^\s]*)\s+([А-ЯЁ0-9][А-ЯЁ\s.\-/«»0-9]*?)\s*$')
ROW_RE = re.compile(r'^(А\.[0-9]{4}\.[0-9]{3}[^\s(]*)\s*(?:\(([^)]*)\))?\s+(.*)$')
STOP = ('ООО "АТЛАНТА"', 'Артикул Описание', 'Функции:', 'Параметры:', 'СДЕЛАНО В РОССИИ')

SECTIONS = [
    {'key': 'turn', 'category': 'turn', 'pages': [48]},
    {'key': 'plate', 'category': 'plate', 'pages': [50, 51, 52, 53, 54]},
    {'key': 'reverse', 'category': 'reverse', 'pages': [56, 57]},
    {'key': 'fog', 'category': 'fog', 'pages': [59]},
    {'key': 'brake', 'category': 'brake', 'pages': [61, 62]},
    {'key': 'interior', 'category': 'interior', 'pages': [64, 65, 66]},
]

# Опечатки каталога, которые в карточке товара читались бы как ошибка
NAME_FIXES = {
    'заднегорегистрационного': 'заднего регистрационного',
}

# Стр. 62: в таблице напечатан артикул предыдущей позиции (А.3716.003),
# хотя страница о А.3716.004 — коды модификаций одинаковые, поэтому строки
# берём с этим base, а результат пишем на артикул из заголовка.
ROW_BASE_OVERRIDE = {62: 'А.3716.003'}

TR = str.maketrans({'А': 'a', 'Б': 'b', 'Ж': 'zh', 'Л': 'l', 'П': 'p', 'Т': 't',
                    'О': 'o', 'У': 'u', '.': '-', '/': '-', ' ': '-'})


def slug(a):
    s = re.sub(r'[^a-z0-9-]+', '-', a.translate(TR).lower())
    return re.sub(r'-+', '-', s).strip('-')


def block(t, start, ends):
    i = t.find(start)
    if i < 0:
        return []
    rest = t[i + len(start):]
    cut = len(rest)
    for e in ends:
        j = rest.find(e)
        if j >= 0:
            cut = min(cut, j)
    return [x.strip() for x in rest[:cut].split('\n') if x.strip()]


def after_colon(line, prefix):
    return re.sub(r'^' + prefix + r'\s*:?\s*', '', line).strip()


def tidy(s):
    s = re.sub(r'(\d)\s*(Вт|В)\b', r'\1 \2', s)
    s = re.sub(r'(\d+) В/(\d+) В', r'\1/\2 В', s)
    s = re.sub(r'(\d+) Вт/(\d[\d,\.]*) Вт', r'\1/\2 Вт', s)
    s = s.replace('=', '—')
    s = re.sub(r'\s+-\s+', ' — ', s)
    return re.sub(r'\s+', ' ', s).strip()


def specs(t):
    f = block(t, 'Функции:', ['Параметры:'])
    merged = []
    for line in f:
        line = line.lstrip('• ').strip()
        if not line:
            continue
        if merged and (line.startswith('(') or line[0].islower()
                       or merged[-1].endswith(('+', ','))):
            merged[-1] = merged[-1] + ' ' + line
        else:
            merged.append(line)

    p = block(t, 'Параметры:', ['Артикул Описание', 'ООО "АТЛАНТА"'])
    out = {'functions': merged, 'voltage': None, 'temperature': None, 'protection': None,
           'power': [], 'color_temperature': None, 'luminous_flux': None}
    inp = False
    for line in p:
        if line.startswith('Напряжение питания'):
            out['voltage'] = tidy(after_colon(line, 'Напряжение питания'))
        elif line.startswith('Диапазон раб'):
            v = after_colon(line, r'Диапазон раб\.?\s*Темп\.?')
            out['temperature'] = re.sub(r'\s+', ' ', re.sub(r'от\s*[–-]\s*', 'от −', v).replace('°C', ' °C')).strip()
        elif line.startswith('Температура цвета'):
            out['color_temperature'] = tidy(after_colon(line, 'Температура цвета'))
        elif line.startswith('Световой поток'):
            out['luminous_flux'] = tidy(after_colon(line, 'Световой поток'))
        elif line.startswith('Степень защиты'):
            v = after_colon(line, 'Степень защиты')
            m = re.match(r'(IP\d+)\s*(ГОСТ\s*\d+)?', v)
            out['protection'] = f'{m.group(1)} ({m.group(2)})' if m and m.group(2) else v
        elif line.startswith('Потребляемая мощность'):
            inp = True
        elif inp:
            item = tidy(line)
            if re.search(r'\d', item) and not item.startswith('('):
                out['power'].append(item)
    return out


def normalize_name(s):
    s = re.sub(r'\s+', ' ', s).strip()
    s = s.lower()
    for wrong, right in NAME_FIXES.items():
        s = s.replace(wrong, right)
    s = re.sub(r'^([а-яё])', lambda m: m.group(1).upper(), s)
    for a in ('LED', 'IP', 'ТС', 'ФОНЗ', 'ФЗХ', 'ПТФ', 'ДСТ', 'E28'):
        s = re.sub(r'(?<![а-яёa-z])' + a.lower() + r'(?![а-яёa-z])', a, s)
    return s


def description(name, sp):
    parts = [name + '.']
    if sp['functions']:
        parts.append('Функции: ' + ', '.join(f[0].lower() + f[1:] for f in sp['functions']) + '.')
    tech = []
    if sp['voltage']:
        tech.append('питание ' + sp['voltage'])
    if sp['protection']:
        tech.append('защита ' + sp['protection'])
    if sp['temperature']:
        tech.append('рабочая температура ' + sp['temperature'])
    if sp['color_temperature']:
        tech.append('цветовая температура ' + sp['color_temperature'])
    if sp['luminous_flux']:
        tech.append('световой поток ' + sp['luminous_flux'].replace('Лм', 'лм').replace('ЛМ', 'лм'))
    if tech:
        s = ', '.join(tech)
        parts.append(s[0].upper() + s[1:] + '.')
    if sp['power']:
        parts.append('Мощность: ' + '; '.join(p.lower()[:1] + p[1:] for p in sp['power']) + '.')
    return '\n'.join(parts)


def product_image(pg):
    """Фото товара — самое верхнее изображение страницы.

    Порядок картинок внутри PDF произвольный (на стр. 48 фото лежит первым по
    потоку, на стр. 54 — последним), а вот на листе фото всегда стоит выше
    чертежа. Поэтому берём изображение с минимальной координатой y0 среди
    «товарных» картинок: отсекаем логотипы сертификатов (мелкие) и чертёж
    (он ниже по странице и крупнее по высоте).
    """
    page = d[pg - 1]
    best, best_y = None, None
    for img in page.get_images(full=True):
        info = d.extract_image(img[0])
        w, h = info['width'], info['height']
        if w < 300 or h >= 1100 or w / h <= 0.5:
            continue
        rects = page.get_image_rects(img[0])
        if not rects:
            continue
        y0 = min(rc.y0 for rc in rects)
        if best_y is None or y0 < best_y:
            best, best_y = info, y0
    return best


def parse_page(pg, category):
    t = (r.pages[pg - 1].extract_text() or '')
    lines = [l.strip() for l in t.split('\n')]

    title = None
    for i, l in enumerate(lines):
        m = TITLE_RE.match(l)
        if m:
            extra = ''
            if i + 1 < len(lines) and lines[i + 1].startswith('('):
                extra = ' ' + lines[i + 1]
            cand = (m.group(1), (m.group(2) + extra).strip())
            if re.search(r'ФОНАРЬ|УКАЗАТЕЛЬ|ПЛАФОН', cand[1]):
                title = cand
    if not title:
        return None

    sp = specs(t)
    row_base = ROW_BASE_OVERRIDE.get(pg, title[0])
    mods = []
    for l in lines:
        m = ROW_RE.match(l)
        if not m:
            continue
        base, code, desc = m.group(1), m.group(2), m.group(3).strip()
        if base != row_base or not code:
            continue
        if re.match(r'^[А-ЯЁ\s]+$', desc):
            continue
        if all(code != c for c, _ in mods):
            mods.append((code, desc))

    art = title[0]
    name = normalize_name(title[1])
    img = product_image(pg)
    file_name = None
    if img:
        file_name = slug(art) + '.' + img['ext']
        with open(os.path.join(OUT, 'files', file_name), 'wb') as f:
            f.write(img['image'])

    return {
        'category': category,
        'article': art,
        'name': name,
        'description': description(name, sp),
        'specs': dict(sp, dimensions=None),
        'image': file_name,
        'source_page': pg,
        'modifications': [{'code': c, 'name': desc} for c, desc in mods],
    }


result = {}
for section in SECTIONS:
    items = []
    for pg in section['pages']:
        item = parse_page(pg, section['category'])
        if item:
            items.append(item)
    result[section['key']] = items
    print(f"\n=== {section['key']} ({section['category']}) ===")
    for c in items:
        print(f"  {c['article']:16} мод={len(c['modifications'])} фото={'да' if c['image'] else 'НЕТ'} | {c['name']}")
    print(f"  итого: {len(items)} позиций, {sum(len(c['modifications']) for c in items)} модификаций")

for key, items in result.items():
    with open(os.path.join(OUT, key + '.json'), 'w') as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
