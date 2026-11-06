"""Импорт описаний изделий (docx / txt / ini) в каталог.

Поставщик кладёт описание рядом с фотографиями:

    Габаритные фонари/А.3731.010/01/описание А.3731.010-01.docx
    Габаритные фонари/А.3731.019/3731-019.txt
    Задние фонари/А.3776.001.1/3776-001.ini

Внутри один и тот же набор сведений: название, особенности (биполярный,
сертификат E28), функции (какой свет даёт), параметры (напряжение,
температура, степень защиты, мощность) и комплектация.

Что делает:

* разбирает документ на название, особенности, функции, параметры и
  комплектацию — структура у файлов разная, парсер терпимый;
* дописывает в описание позиции только то, чего в нём ещё нет: блок
  «Особенности», климатическое исполнение, источник света, комплектацию;
* если параметр в документе расходится с каталогом (например, диапазон
  температур), описание не трогает и выносит расхождение в отчёт: описание
  из PDF-каталога приоритетно, паспорт только дополняет его;
* заполняет пустые характеристики позиции (`specs`);
* если документ описывает конкретное исполнение, текст уходит в него.

Запуск:
    python3 scripts/catalog/import_descriptions.py /path/to/docs
    python3 scripts/catalog/import_descriptions.py /path/to/docs --dry-run
    python3 scripts/catalog/import_descriptions.py /path/to/docs --dry-run \
        --report-md docs/catalog-descriptions.md
"""
import configparser
import json
import re
import sys
import unicodedata
from pathlib import Path

CATALOG_DIR = Path(__file__).resolve().parents[2] / 'src' / 'db' / 'catalog'
CATALOG_JSON = CATALOG_DIR / 'catalog.json'

ARTICLE_RE = re.compile(
    r'[АA]\.\s*\d{4}\.\s*\d{3}(?:\.\d)?(?:-[А-ЯA-Z]{1,2})?'
    r'(?:\s*-\s*\d{1,2}(?:[.\-]\d{1,2}){0,3})?', re.IGNORECASE)
SECTION_RE = re.compile(r'^(функции|параметры|особенности|комплектация)\s*:?\s*$', re.IGNORECASE)
BULLET_RE = re.compile(r'^[•·▪●\-–—]\s*')
KEY_RE = re.compile(
    r'^(?P<key>[А-ЯЁA-Z][^:]{2,45}?)\s*(?::\s+|\s+[-–—]\s+)(?P<value>.+)$')
HEADER_RE = re.compile(r'^(?P<key>[А-ЯЁ][А-Яа-яЁё0-9 ()/.,-]{2,45}?)\s*:\s*$')
INLINE_KEY_RE = re.compile(r'(?<=[^\s:])\s+(?=[А-ЯЁ][А-Яа-яЁёA-Za-z0-9 ()\-]{2,40}:\s)')

# параметры без двоеточия: «Диаметр 186 мм», «Диапазон рабочих температур …»
BARE_PARAMS = (
    'Диапазон рабочих температур',
    'Диапазон температур',
    'Напряжение питания',
    'Диаметр',
    'Габаритные размеры',
    'Габариты',
    'Масса',
    'Вес',
    'Степень защиты',
)
# с этих слов начинается описание функции (что светит)
FUNCTION_PREFIXES = ('Свет ', 'Освещение ', 'Указатель поворота', 'Сигнал торможения',
                     'Габаритный огонь', 'Стоп-сигнал')
# тип параметра → как звучит ключ в документе / как он выглядит в тексте описания
PARAM_TYPES = (
    ('voltage', 'напряжен|питани', 'напряжен|питани'),
    ('temperature', 'температур', 'температур'),
    ('protection', 'защит', r'\bIP\s?\d{2}'),
    ('power', 'мощност', 'мощност'),
    ('light', 'источник света|светодиод', 'светодиод|\\bLED\\b'),
    ('climate', 'климат', '15150'),
)
FIELD_LABEL = {
    'light': 'Источник света',
    'voltage': 'Напряжение питания',
    'power': 'Мощность',
    'temperature': 'Диапазон рабочих температур',
    'climate': 'Климатическое исполнение',
    'protection': 'Степень защиты',
    'color_temperature': 'Цветовая температура',
    'luminous_flux': 'Световой поток',
    'dimensions': 'Размер',
    'mass': 'Масса',
}
# артикулы, под которыми поставщик присылает документы, и позиции каталога
ARTICLE_ALIASES = {
    'А.3731.018-01': 'А.3731.018-21',                    # «передний»
    'А.3731.018-03': 'А.3731.018-23',                    # «боковой»
    # цвета габаритных фонарей — теперь исполнения одного изделия
    # (см. merge_marker_families.py), описание относится к семье целиком
    'А.3731.023.1': 'А.3731.023',
    'А.3731.023.2': 'А.3731.023',
    'А.3731.023.3': 'А.3731.023',
    'А.3731.025.1': 'А.3731.025',
    'А.3731.025.2': 'А.3731.025',
    'А.3731.025.3': 'А.3731.025',
    'А.3731.026.1': 'А.3731.026',
    'А.3731.026.2': 'А.3731.026',
}
STOPWORDS = {'для', 'или', 'при', 'без', 'если', 'того', 'этот', 'этом', 'всех'}


# ---------------------------------------------------------------- чтение

def normalize(text):
    text = unicodedata.normalize('NFC', text or '')
    text = text.replace('\u00ad', '').replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', text).strip()


def tidy_article(text):
    """«А. 3776.005 - Б» → «А.3776.005-Б»."""
    text = normalize(text)
    text = re.sub(r'^[Aa]', 'А', text)
    text = re.sub(r'\s*\.\s*', '.', text)
    text = re.sub(r'\s*-\s*', '-', text)
    return text


def read_docx(path):
    from docx import Document

    document = Document(path)
    lines = [normalize(p.text) for p in document.paragraphs if p.text.strip()]
    for table in document.tables:
        for row in table.rows:
            cells = [normalize(c.text) for c in row.cells if c.text.strip()]
            if len(cells) >= 2:
                lines.append(f'{cells[0]}: {cells[1]}')
            elif cells:
                lines.append(cells[0])
    return lines


def read_text_file(path):
    raw = path.read_bytes()
    for encoding in ('utf-8-sig', 'cp1251', 'koi8-r', 'utf-16'):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', errors='replace')


def read_ini(path):
    text = read_text_file(path)
    parser = configparser.ConfigParser()
    parser.optionxform = str
    try:
        parser.read_string(text)
    except configparser.Error:
        return [normalize(line) for line in text.splitlines() if line.strip()]

    name_keys = {'name', 'наименование', 'description', 'описание', 'title', 'заголовок'}
    lines = []
    for section in parser.sections():
        for key, value in parser.items(section):
            key, value = normalize(key), normalize(value)
            if not value:
                continue
            if key.lower() in name_keys:
                lines.append(value)
            elif value.lower() in ('да', 'yes', 'true'):
                lines.append(key)                       # флаг-особенность
            else:
                lines.append(f'{key}: {value}')
    return lines or [normalize(line) for line in text.splitlines() if line.strip()]


def read_document(path):
    suffix = path.suffix.lower()
    if suffix == '.docx':
        return read_docx(path)
    if suffix == '.ini':
        return read_ini(path)
    return [normalize(line) for line in read_text_file(path).splitlines() if line.strip()]


# ---------------------------------------------------------------- разбор

def param_kind(label):
    low = (label or '').lower()
    for field, label_pattern, _ in PARAM_TYPES:
        if re.search(label_pattern, low):
            return field
    for field, words in (('dimensions', 'диаметр габарит размер длина ширина высота'),
                         ('color_temperature', 'цветовая температур'),
                         ('luminous_flux', 'световой поток'),
                         ('mass', 'масса вес')):
        if any(word in low for word in words.split()):
            return field
    return None


def looks_like_complectation(line):
    return line.count(',') >= 2 and not re.search(r'\d\s*(мм|в|вт|°c)', line.lower()) \
        and len(line) < 160


def clean_item(text):
    return normalize(text).strip(' .,;:')

def parse_description(paragraphs):
    """Плоский список строк → структура описания."""
    parsed = {'title': '', 'features': [], 'functions': [], 'params': [], 'extra': []}
    section = None
    pending = None                                       # ключ, ждущий значений

    def flush():
        nonlocal pending
        if pending and pending[1]:
            parsed['params'].append([pending[0], '; '.join(pending[1])])
        pending = None

    def last_param():
        return parsed['params'][-1] if parsed['params'] else None

    for index, raw in enumerate(paragraphs):
        for line in INLINE_KEY_RE.split(normalize(raw)):
            line = normalize(line)
            if not line:
                continue

            if SECTION_RE.match(line) and len(line) < 40:
                flush()
                name = SECTION_RE.match(line).group(1).lower()
                section = 'functions' if name.startswith('функц') else \
                    'features' if name.startswith('особен') else 'params'
                continue

            if BULLET_RE.match(line):
                text = clean_item(BULLET_RE.sub('', line))
                if pending is not None and section == 'params':
                    pending[1].append(text)              # список значений под заголовком
                    continue
                flush()
                parsed['functions' if section == 'functions' else 'features'].append(text)
                continue

            header = HEADER_RE.match(line)
            if header:                                   # «Потребляемая мощность:» — значения ниже
                flush()
                pending = [normalize(header.group('key')), []]
                section = 'params'
                continue

            bare = next((word for word in BARE_PARAMS
                         if line.lower().startswith(word.lower())), None)
            if bare:
                flush()
                rest = normalize(line[len(bare):].strip(' :–—-'))
                rest = re.sub(r'^окружающей среды\s*', '', rest)
                parsed['params'].append([bare, rest])
                continue

            if pending is not None and section == 'params' and not KEY_RE.match(line):
                pending[1].append(line)                  # строки-значения под заголовком
                continue

            # продолжение предыдущего параметра: «от – 40°C до +55°C»
            if last_param() and re.match(r'^(от|до|при|не более|не менее)\b', line, re.IGNORECASE):
                param = last_param()
                param[1] = normalize(f'{param[1]} {line}')
                continue

            match = KEY_RE.match(line)
            if match and not ARTICLE_RE.search(match.group('key')):
                key, value = normalize(match.group('key')), normalize(match.group('value'))
                if len(value) > 80:                      # «Плафон предназначен для — …»,
                    flush()                              # такое уже есть в описании из PDF
                elif key.lower() not in ('от', 'до', 'при'):
                    flush()
                    parsed['params'].append([key, value])
                continue

            if index == 0 and not parsed['title'] and (len(line) > 20 or ARTICLE_RE.search(line)):
                parsed['title'] = line
                continue

            if ARTICLE_RE.search(line):
                continue                                 # «А.3731.005 (клюшка малая)»
            if line.startswith(FUNCTION_PREFIXES):
                parsed['functions'].append(clean_item(line))
                continue
            if looks_like_complectation(line):
                parsed['params'].append(['Комплектация', clean_item(line)])
                continue
            if len(line) > 12:
                parsed['features' if len(line) < 70 else 'extra'].append(clean_item(line))

    flush()
    return parsed


# ---------------------------------------------------------------- сравнение

def stem(word):
    for suffix in ('ами', 'ями', 'ого', 'его', 'ыми', 'ими', 'ий', 'ый', 'ая', 'ое',
                   'ые', 'ых', 'ам', 'ям', 'ах', 'ях', 'ов', 'ей', 'ой', 'ом', 'ем',
                   'ую', 'юю', 'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о', 'ь'):
        if len(word) - len(suffix) >= 4 and word.endswith(suffix):
            return word[:-len(suffix)]
    return word


def tokens(text):
    text = re.sub(r'[−–—]', '-', (text or '').lower()).replace('ё', 'е')
    return {stem(word) for word in re.findall(r'[a-zа-я0-9]{4,}', text)} - STOPWORDS


def overlap(text, candidate, threshold=0.6):
    """Насколько кандидат уже присутствует в тексте."""
    wanted = tokens(candidate)
    if not wanted:
        return True
    return len(wanted & tokens(text)) / len(wanted) >= threshold


def numbers(text):
    return set(re.findall(r'\d+(?:[.,]\d+)?', text or ''))


def numbers_present(text, value):
    ips = re.findall(r'\bIP\s?(\d{2})', value or '', re.IGNORECASE)
    if ips:
        return all(re.search(rf'\bIP\s?{ip}\b', text or '', re.IGNORECASE) for ip in ips)
    wanted = numbers(value)
    return not wanted or wanted <= numbers(text)


def has_field(text, field):
    entry = next((item for item in PARAM_TYPES if item[0] == field), None)
    return bool(entry and re.search(entry[2], text or '', re.IGNORECASE))


def units(text):
    """«12-24 V», «0,42W», «– 40°C» → «12-24 В», «0,42 Вт», «−40 °C»."""
    text = normalize(text)
    text = re.sub(r'(\d)\s*[Vv](?![а-яa-z])', r'\1 В', text)
    text = re.sub(r'(\d)\s*[Ww](?![а-яa-z])', r'\1 Вт', text)
    text = re.sub(r'[−–—]\s*(\d)', r'−\1', text)
    text = re.sub(r'(\d)\s*°\s*[Cc]', r'\1 °C', text)
    return text


def sentence(text):
    text = units(text).rstrip(' .,;:')
    return text + '.' if text else ''


# ---------------------------------------------------------------- каталог

class Catalog:
    def __init__(self, path=CATALOG_JSON):
        self.path = Path(path)
        self.data = json.loads(self.path.read_text(encoding='utf-8'))
        self.components = self.data['components']
        self.by_key = {self.key(entry['article']): entry for entry in self.components}

    @staticmethod
    def key(article):
        return tidy_article(article).lower().replace('a', 'а')

    def find(self, article):
        return self.by_key.get(self.key(article))

    def variants(self, article):
        prefix = self.key(article)
        found = []
        for entry in self.components:
            low = self.key(entry['article'])
            if low.startswith(prefix) and low[len(prefix):][:1] in ('-', '.', '/', 'л', 'п'):
                found.append(entry)
        return [entry for entry in found if '/' not in entry['article']]

    def resolve(self, article, hint=''):
        """Артикул документа → (позиции, исполнение, способ сопоставления)."""
        article = tidy_article(article)
        if not article:
            return [], None, 'нет артикула'
        if article in ARTICLE_ALIASES:
            article = ARTICLE_ALIASES[article]
        article = re.sub(r'^([АA]\.\d{4}\.\d{3})-(\d)$', r'\1-0\2', article)

        exact = self.find(article)
        if exact:
            return [exact], None, 'точное совпадение'

        match = re.match(r'^(.*?)-(\d{1,2}(?:[.\-]\d{1,2}){0,3})$', article)
        if match:
            base, code = match.group(1), match.group(2).replace('-', '.')
            entry = self.find(base)
            if entry:
                mods = entry.get('modifications') or []
                same = [m for m in mods if m['code'] == code]
                group = [m for m in mods if m['code'].startswith(code + '.')]
                if len(same) == 1:
                    return [entry], same[0], 'исполнение'
                if len(group) == 1:
                    return [entry], group[0], 'исполнение по группе'
                if group:
                    return [entry], None, f'общее описание {len(group)} исполнений'
                return [entry], None, 'позиция по базе артикула'

        detail = re.match(r'^(.*?)-[ДD]$', article)
        if detail:                                       # А.3723.015-Д → деталировка позиции
            entry = self.find(detail.group(1))
            if entry:
                return [entry], None, 'деталировка'

        variants = self.variants(article)
        if len(variants) == 1:
            return variants, None, 'единственный вариант серии'
        if variants:
            if hint:
                narrowed = [e for e in variants if hint.lower() in e['name'].lower()]
                if len(narrowed) == 1:
                    return narrowed, None, f'вариант по «{hint}»'
            return variants, None, 'варианты серии'

        return [], None, 'нет в каталоге'


# ---------------------------------------------------------------- слияние

def build_modification_text(parsed):
    parts = []
    if parsed['features']:
        parts.append('Особенности: ' + '; '.join(parsed['features']) + '.')
    if parsed['functions']:
        parts.append('Функции: ' + '; '.join(parsed['functions']) + '.')
    if parsed['params']:
        pairs = [f'{key} — {value}' for key, value in parsed['params']]
        parts.append('Параметры: ' + '; '.join(pairs) + '.')
    return ' '.join(parts)


# ---------------------------------------------------------------- запуск

def articles_in(text):
    return list(dict.fromkeys(
        tidy_article(m.group(0)) for m in ARTICLE_RE.finditer(normalize(text))))


def collect(root):
    root = Path(root)
    return sorted(p for p in root.rglob('*') if p.is_file()
                  and p.suffix.lower() in ('.docx', '.txt', '.ini')
                  and not p.name.startswith(('.', '~$')))


def functions_count(text):
    """«3-х функциональный» → 3: различает документы одного семейства."""
    found = re.findall(r'(\d)\s*-?\s*х?\s*функциональн', (text or '').lower())
    return found[-1] if found else None


def linked_docs(items, entry):
    """Документы семейства, относящиеся именно к этой позиции."""
    wanted = functions_count(entry.get('name'))
    if wanted:
        narrowed = [item for item in items if functions_count(item[1]['title']) in (None, wanted)]
        if narrowed:
            return narrowed
    return items


def run(root, catalog_path=CATALOG_JSON, dry_run=False, quiet=False):
    root = Path(root)
    catalog = Catalog(catalog_path)
    report = {'added': [], 'conflicts': [], 'unmatched': [], 'modifications': []}
    grouped = {}

    for path in collect(root):
        paragraphs = read_document(path)
        if not paragraphs:
            continue
        parsed = parse_description(paragraphs)

        articles = articles_in(path.stem) or articles_in(path.parent.name) \
            or articles_in(' '.join(paragraphs[:2]))
        hint = ''
        title_hint = re.search(r'\(([^)]+)\)', ' '.join(paragraphs[:3]))
        if title_hint:
            hint = normalize(title_hint.group(1))

        entries, mods, hows = [], [], []
        for article in articles:
            found, found_mod, found_how = catalog.resolve(article, hint)
            if found:
                entries += [e for e in found if e not in entries]
                mods.append(found_mod)
                hows.append(found_how)
        mod = next((m for m in mods if m), None)
        how = ', '.join(dict.fromkeys(hows))
        if not entries:
            report['unmatched'].append(
                (path, ', '.join(articles) or path.stem, how or 'нет в каталоге'))
            continue

        if not quiet:
            print(f"  {path.name[:44]:44} → {', '.join(e['article'] for e in entries)[:42]:42} [{how}]")
        for entry in entries:
            grouped.setdefault(entry['article'], (entry, []))[1].append((path, parsed, mod))

    for article, (entry, items) in grouped.items():
        docs = linked_docs(items, entry)
        merge_group(entry, docs, report)
        for mod in {m['code']: m for _, _, m in docs if m}.values():
            text = build_modification_text(
                next(parsed for _, parsed, m in docs if m and m['code'] == mod['code']))
            if text and not overlap(mod.get('description') or '', text, 0.75):
                mod['description'] = text
                report['modifications'].append((article, mod['code']))

    report['conflicts'] = list(dict.fromkeys(report['conflicts']))
    report['added'] = list(dict.fromkeys(report['added']))

    if not dry_run:
        catalog.path.write_text(
            json.dumps(catalog.data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    if not quiet:
        print(f"\nпозиций дополнено: {len({a for a, _ in report['added']})}, "
              f"строк добавлено: {len(report['added'])}, "
              f"исполнений: {len(report['modifications'])}, "
              f"расхождений: {len(report['conflicts'])}, "
              f"не сопоставлено: {len(report['unmatched'])}")
    return report


def repeats_name(line, name):
    """Строка начинается так же, как название позиции — это её дубль, не особенность."""
    head = normalize(line).lower().split()[:2]
    title = normalize(name).lower().split()[:2]
    return bool(head) and head == title


def merge_group(entry, docs, report):
    """Слить все документы одной позиции: общее — добавляем, разное — в отчёт."""
    text = entry.get('description') or ''
    features, extras = [], []
    values = {}

    for _, parsed, _ in docs:
        features += parsed['features']
        extras += parsed['extra']
        for key, value in parsed['params']:
            field = param_kind(key)
            if not field:
                continue
            values.setdefault(field, {})[normalize(value).lower()] = (key, value)

    fresh = []
    for feature in dict.fromkeys(features):
        if len(feature) > 3 and not overlap(text, feature) \
                and not repeats_name(feature, entry.get('name')):
            fresh.append(feature)
    if fresh:
        line = sentence('Особенности: ' + '; '.join(fresh))
        entry['description'] = (text.rstrip() + '\n' + line).strip()
        report['added'].append((entry['article'], line))

    for field, variants in values.items():
        if len(variants) > 1:
            report['conflicts'].append(
                (entry['article'], 'разные значения: ' + ' / '.join(v for _, v in variants.values()),
                 field))
            continue
        key, value = next(iter(variants.values()))
        add_param(entry, field, value, report)

    for line in dict.fromkeys(extras):
        if overlap(text, line):
            continue
        entry['description'] = entry['description'].rstrip() + '\n' + sentence(line)
        report['added'].append((entry['article'], sentence(line)))

    merge_specs_from(entry, docs)


def add_param(entry, field, value, report):
    text = entry.get('description') or ''
    if has_field(text, field):
        if field in ('voltage', 'temperature', 'protection', 'power') \
                and not numbers_present(text, value):
            report['conflicts'].append(
                (entry['article'], f'{FIELD_LABEL.get(field, field)}: {value}', field))
        return 0
    if numbers(value) and numbers(value) <= numbers(text):
        return 0
    line = sentence(f'{FIELD_LABEL.get(field, field)}: {value}')
    entry['description'] = (text.rstrip() + '\n' + line).strip() if text else line
    report['added'].append((entry['article'], line))
    return 1


def merge_specs_from(entry, docs):
    """Дозаполнить характеристики позиции — только там, где нет расхождения с описанием."""
    specs = entry.setdefault('specs', {})
    text = entry.get('description') or ''
    for _, parsed, _ in docs:
        for key, value in parsed['params']:
            field = param_kind(key)
            if not field or field in ('climate', 'light', 'mass'):
                continue
            if has_field(text, field) and not numbers_present(text, value):
                continue                                  # в описании другое значение
            value = sentence(value).rstrip('.')
            if field == 'power':
                if not specs.get('power'):
                    specs['power'] = [f'{key}: {value}']
            elif not specs.get(field):
                specs[field] = value
        if parsed['functions'] and not specs.get('functions'):
            specs['functions'] = parsed['functions']


def catalog_value(entry, field):
    """Строка описания, где в каталоге записан этот параметр."""
    entry_pattern = next((item[2] for item in PARAM_TYPES if item[0] == field), None)
    if not entry_pattern:
        return ''
    for line in (entry.get('description') or '').split('\n'):
        if re.search(entry_pattern, line, re.IGNORECASE):
            return normalize(line).rstrip('.')
    return ''


def write_markdown_report(result, root, path, catalog, dry_run=True):
    """Отчёт импорта в markdown: что добавлено, что разошлось, что не нашли."""
    root = Path(root)
    lines = ['# Описания изделий из документов поставщика', '']
    lines.append('Отчёт собирает `server/scripts/catalog/import_descriptions.py` '
                 'по папке с документами поставщика. Повторный запуск отчёт перезаписывает.')
    lines.append('')

    lines.append('**Политика слияния.** Описание из PDF-каталога приоритетно: паспорт только '
                 'дописывает то, чего в нём нет (особенности, источник света, климатическое '
                 'исполнение, комплектация). Если значение в паспорте расходится с каталогом, '
                 'описание не меняется — расхождение попадает в таблицу ниже.')
    lines.append('')

    added = result['added']
    conflicts = result['conflicts']
    unmatched = result['unmatched']
    lines.append(f'**Итог прогона:** расхождений — {len(conflicts)}, документов без позиции — '
                 f'{len(unmatched)}, дополнений в этом прогоне — {len(added)} '
                 f'(позиций {len({a for a, _ in added})}).')
    lines.append('')

    if not added:
        lines.append('_Повторный запуск: всё, что есть в документах, уже перенесено в каталог._')
        lines.append('')

    if added:
        lines.append('## Что добавлено')
        lines.append('')
        lines.append('| Позиция | Добавленный текст |')
        lines.append('|---|---|')
        for article, line in added:
            lines.append(f'| `{article}` | {line.replace("|", "/")} |')
        lines.append('')

    if conflicts:
        lines.append('## Расхождения с PDF-каталогом (не перезаписаны)')
        lines.append('')
        lines.append('| Позиция | В паспорте | В каталоге (PDF) |')
        lines.append('|---|---|---|')
        for article, line, field in conflicts:
            entry = catalog.by_key.get(Catalog.key(article)) or {}
            current = catalog_value(entry, field) or '—'
            lines.append(f'| `{article}` | {units(line).replace("|", "/")} | '
                         f'{current.replace("|", "/")} |')
        lines.append('')

    if unmatched:
        lines.append('## Документы без позиции в каталоге')
        lines.append('')
        lines.append('Позиции не заводим: документы остаются в этом отчёте, пока артикул '
                     'не появится в каталоге.')
        lines.append('')
        lines.append('| Документ | Артикул | Почему |')
        lines.append('|---|---|---|')
        for item, article, why in unmatched:
            rel = Path(item).relative_to(root) if root in Path(item).parents else Path(item).name
            lines.append(f'| `{normalize(str(rel))}` | {normalize(article) or "—"} | {why} |')
        lines.append('')

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return Path(path)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    report_md = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--report-md=')), '')
    result = run(args[0], dry_run='--dry-run' in sys.argv,
                 quiet='--report' in sys.argv or bool(report_md))

    if report_md:
        written = write_markdown_report(result, args[0], report_md, Catalog())
        print(f'отчёт: {written}')

    if '--report' in sys.argv:
        print('ДОБАВЛЕНО')
        for article, line in result['added']:
            print(f'  {article}: {line}')
        print('\nРАСХОЖДЕНИЯ')
        for article, line, _ in result['conflicts']:
            print(f'  {article}: {line}')
        print('\nНЕ СОПОСТАВЛЕНО')
        for path, article, why in result['unmatched']:
            print(f'  {path.parent.name}/{path.name} — {article or "без артикула"} ({why})')
