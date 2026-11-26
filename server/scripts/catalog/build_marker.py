"""Разбор раздела «Фонари габаритные» (стр. 19–46) каталога АТЛАНТА-26.

Готовит фрагмент catalog.json для раздела: названия, описания, характеристики,
фото и модификации. Результат затем вручную просматривается и вливается в
server/src/db/catalog/catalog.json.

Запуск (нужны Python 3, pypdf, pymupdf; PDF каталога — вне репозитория):

    pip install --break-system-packages pypdf pymupdf
    python3 scripts/catalog/build_marker.py /path/to/Каталог-АТЛАНТА-26.pdf /tmp/out

На выходе: /tmp/out/marker.json и /tmp/out/files/*.{jpeg,png}.
"""
import pypdf, pymupdf, re, json, os, sys

PDF = sys.argv[1] if len(sys.argv) > 1 else '/tmp/arena-coding-uploads/Каталог АТЛАНТА-26.pdf'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/cbuild2'
os.makedirs(OUT + '/files', exist_ok=True)

r = pypdf.PdfReader(PDF)
d = pymupdf.open(PDF)

TITLE_RE = re.compile(r'^(А\.[0-9]{4}\.\d{3}[^\s]*)\s+([А-ЯЁ0-9][А-ЯЁ\s.\-/«»0-9]*?)\s*$')
ROW_FULL = re.compile(r'^(А\.373\d\.[0-9]{3}[^\s(]*)\s*(?:\(([^)]*)\))?\s*(-\S*)?\s+(.+)$')
ROW_ART = re.compile(r'^(А\.373\d\.[0-9]{3}[^\s(]*)\s*(?:\(([^)]*)\))?\s*(-\S*)?$')
STOP = ('ООО "АТЛАНТА"', 'Артикул Описание', 'Функции:', 'Параметры:', 'СДЕЛАНО В РОССИИ')


def family(a):
    m = re.match(r'^(А\.\d{4}\.\d{3})', a)
    return m.group(1) if m else a


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
    s = s.replace('Указ. поворота', 'Указатель поворота')
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
        if merged and (line.startswith('(') or merged[-1].endswith('+') or (line[0].islower() and len(line) < 40)):
            merged[-1] = merged[-1] + ' ' + line
        else:
            merged.append(line)
    p = block(t, 'Параметры:', ['Артикул Описание', 'ООО "АТЛАНТА"'])
    out = {'functions': merged, 'voltage': None, 'temperature': None, 'protection': None, 'power': []}
    inp = False
    for line in p:
        if line.startswith('Напряжение питания'):
            out['voltage'] = tidy(after_colon(line, 'Напряжение питания'))
        elif line.startswith('Диапазон раб'):
            v = after_colon(line, r'Диапазон раб\.?\s*Темп\.?')
            out['temperature'] = re.sub(r'\s+', ' ', re.sub(r'от\s*[–-]\s*', 'от −', v).replace('°C', ' °C')).strip()
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


def page_images(pg):
    out = []
    for img in d[pg - 1].get_images(full=True):
        info = d.extract_image(img[0])
        w, h = info['width'], info['height']
        if w >= 300 and h < 1100 and w / h > 0.5:
            out.append(info)
    return out


TR = str.maketrans({'А': 'a', 'Б': 'b', 'Ж': 'zh', 'Л': 'l', 'П': 'p', 'Т': 't', 'О': 'o',
                    'У': 'u', '.': '-', '/': '-', ' ': '-'})


def slug(a):
    s = re.sub(r'[^a-z0-9-]+', '-', a.translate(TR).lower())
    return re.sub(r'-+', '-', s).strip('-')


def save_img(info, article):
    name = slug(article) + '.' + info['ext']
    with open(OUT + '/files/' + name, 'wb') as f:
        f.write(info['image'])
    return name


ctx = {'title': None, 'specs': None}
items, order = {}, []
family_images = {}
family_titles = {}

for pg in range(19, 47):
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
            if re.search(r'ФОНАРЬ|ГАБАРИТ|УКАЗАТЕЛЬ|ПЛАФОН', cand[1]):
                title = cand
    sp = specs(t)
    if title:
        prev = ctx['title'][1] if ctx['title'] else None
        cand = title[1]
        # На странице таблицы тот же заголовок повторяется без пометки «(МАРКЕР 10)» —
        # не даём короткой версии затереть полную.
        if prev is None or not (prev.startswith(cand) or cand.startswith(prev)):
            ctx['title'] = title
    if sp['voltage'] or sp['power']:
        ctx['specs'] = sp

    rows = []
    i = 0
    while i < len(lines):
        l = lines[i]
        mf = ROW_FULL.match(l)
        ma = ROW_ART.match(l) if not mf else None
        if mf:
            base, code, suffix, desc = mf.group(1), mf.group(2), mf.group(3) or '', mf.group(4).strip()
            if re.search(r'[а-яё]', desc):
                rows.append((base, code, suffix, desc))
                i += 1
                continue
        if ma:
            base, code, suffix = ma.group(1), ma.group(2), ma.group(3) or ''
            j = i + 1
            parts = []
            while j < len(lines) and not ROW_FULL.match(lines[j]) and not ROW_ART.match(lines[j]) \
                    and not lines[j].startswith(STOP) and lines[j] not in ('Функции:', 'Параметры:'):
                parts.append(lines[j])
                j += 1
            desc = re.sub(r'\s+', ' ', ' '.join(parts)).strip()
            if desc and not re.match(r'^[А-ЯЁ\s]+$', desc):
                rows.append((base, code, suffix, desc))
            i = j
            continue
        i += 1

    page_bases = []
    for base, code, suffix, desc in rows:
        art = base + suffix
        if art not in items:
            items[art] = {'article': art, 'codes': [], 'descs': [], 'pages': [],
                          'title': ctx['title'], 'specs': ctx['specs'], 'images': []}
            order.append(art)
            page_bases.append(art)
        if code and all(c != code for c, _ in items[art]['codes']):
            items[art]['codes'].append((code, desc))
        items[art]['descs'].append(desc)
        if pg not in items[art]['pages']:
            items[art]['pages'].append(pg)

    imgs = page_images(pg)
    fam_key = family(title[0]) if title else None
    if imgs and fam_key and fam_key not in family_images:
        family_images[fam_key] = imgs
    # Привязываем фото по индексу только если число фото совпадает с числом позиций
    # на странице. Иначе (напр. три варианта кронштейна и два артикула) фото
    # относится к семейству целиком — его получит каждая позиция семьи.
    if imgs and page_bases:
        if len(imgs) == len(page_bases):
            for idx, art in enumerate(page_bases):
                items[art]['images'].append(imgs[idx])
        else:
            for art in page_bases:
                items[art]['images'].append(imgs[0])
                items[art]['photo_variants'] = True

# позиции из таблиц без картинок — берём фото страницы-описания той же семьи
for art, v in items.items():
    if v['images']:
        continue
    fam = family(art)
    fam_imgs = family_images.get(fam, [])
    fam_bases = [a for a in order if family(a) == fam]
    if not fam_imgs:
        continue
    if len(fam_imgs) == len(fam_bases):
        v['images'] = [fam_imgs[fam_bases.index(art)]]
    else:
        v['images'] = [fam_imgs[0]]
        v['photo_variants'] = True

POS = ('передний', 'задний', 'боковой', 'левый', 'правый')


ACRONYMS = ('LED', 'IP', 'ТС', 'ФОНЗ', 'E28')


def normalize_name(s):
    s = re.sub(r'\s+', ' ', s).strip()
    s = s.replace(' - ', '-').replace('- ', '-')      # «2 И 3 - ФУНКЦИОНАЛЬНЫЙ» → «2 И 3-ФУНКЦИОНАЛЬНЫЙ»
    s = s.lower()
    s = re.sub(r'^([а-яё])', lambda m: m.group(1).upper(), s)
    for a in ACRONYMS:
        s = re.sub(r'(?<![а-яёa-z])' + a.lower() + r'(?![а-яёa-z])', a, s)
    return s


def qualifier(v):
    descs = ' '.join(v['descs']).lower()
    found = [p for p in POS if re.search(r'\b' + p, descs)]
    pos = [p for p in found if p in ('передний', 'задний', 'боковой')]
    side = [p for p in found if p in ('левый', 'правый')]
    func = re.search(r'\d-х функциональн\w+', descs)
    bits = []
    if func:
        bits.append(func.group(0).replace('-х ', '-'))
    if len(pos) == 1:
        bits.append(pos[0])
    codes = ' '.join(c for c, _ in v['codes']).upper()
    side_in_code = '.Л' in codes or '.П' in codes
    if side_in_code:
        side = []
    if len(side) == 2:
        bits.append('левый/правый')
    elif len(side) == 1:
        bits.append(side[0])
    return bits


def description(name, sp, extra):
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
    if tech:
        s = ', '.join(tech)
        parts.append(s[0].upper() + s[1:] + '.')
    if sp['power']:
        parts.append('Мощность: ' + '; '.join(p.lower()[:1] + p[1:] for p in sp['power']) + '.')
    if extra:
        parts.append(extra)
    return '\n'.join(parts)


components = []
for art in order:
    v = items[art]
    sp = v['specs'] or {'functions': [], 'voltage': None, 'temperature': None, 'protection': None, 'power': []}
    base_name = normalize_name(v['title'][1]) if v['title'] else 'Фонарь габаритный'
    bits = qualifier(v)
    name = base_name + (', ' + ', '.join(bits) if bits else '')

    extra_bits = []
    if bits:
        extra_bits.append('Исполнение: ' + ', '.join(bits) + '.')
    extras = []
    if len(v['codes']) > 1:
        extras.append(f'Вариантов подключения: {len(v["codes"])}.')
    if v.get('photo_variants') and len([a for a in order if family(a) == family(art)]) > 1:
        extras.append('На странице каталога несколько вариантов исполнения — фото общее для семейства.')
    extra = ' '.join(extra_bits + extras) or None

    img = v['images'][0] if v['images'] else None
    components.append({
        'category': 'marker',
        'article': art,
        'name': name,
        'description': description(name, sp, extra),
        'specs': dict(sp, dimensions=None),
        'image': save_img(img, art) if img else None,
        'source_page': min(v['pages']),
        'modifications': [{'code': c, 'name': d} for c, d in v['codes']],
    })

json.dump(components, open(OUT + '/marker.json', 'w'), ensure_ascii=False, indent=2)
print('позиций:', len(components), '| модификаций:', sum(len(c['modifications']) for c in components),
      '| с фото:', sum(1 for c in components if c['image']))
for c in components:
    print(f"{c['article']:24} код={len(c['modifications']):>2} фото={'да' if c['image'] else 'НЕТ'} | {c['name'][:70]}")
