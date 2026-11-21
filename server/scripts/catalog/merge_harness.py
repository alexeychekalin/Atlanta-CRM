"""Слияние спецификации жгутов (build_harness_spec.py) в catalog.json.

Модель каталога — «семейство + исполнения»:

* компонент — базовый артикул семейства (`А.3724.304`);
* модификация — код исполнения (`03.01`), полный артикул собирается
  штатным `fullArticle()` → `А.3724.304-03.01`;
* длина и потребитель уходят в описание исполнения, основные и
  дополнительные характеристики — в описание семейства.

Старые плоские записи жгутов (`А.3724.304-03.01` как компонент) заменяются
семейством; фото и описания переезжают на своё исполнение.

Запуск:
    python3 scripts/catalog/build_harness_spec.py "<pdf>" /tmp/spec
    python3 scripts/catalog/merge_harness.py /tmp/spec/harness_spec.json \
        src/db/catalog/catalog.json
"""
import json
import re
import sys

SPEC_PATH = sys.argv[1] if len(sys.argv) > 1 else '/tmp/spec/harness_spec.json'
CATALOG_PATH = sys.argv[2] if len(sys.argv) > 2 else 'src/db/catalog/catalog.json'

# Названия, которые в спецификации записаны сокращениями или с опечатками.
NAME_FIXES = {
    'А.3724.055': 'Кабель с гайкой и клюшкой',
    'А.3724.104': 'Кабель с адаптором Hella',
    'А.3724.105': 'Кабель с адаптером TE 282104',
    'А.3724.217': 'Кабель с розеткой переносной лампы',
    'А.3724.304': 'Жгут фонарей задних',
    'А.3724.404': 'Жгут основной с розеткой 12-конт.',
    'А.3724.406': 'Жгут основной с вилками 7-конт.',
    'А.3724.415': 'Кабель круглый (2 розетки АМР + 2 свободных конца)',
    'А.3724.704': 'Жгут проводов универсальный (гирлянда 7 точек)',
    'А.3724.989': 'Кабель подъёмной оси ТОНАР',
}

WORD_FIXES = [
    (r'\bЖгуть\b', 'Жгут'),
    (r'\bКабельт\b', 'Кабель'),
    (r'\bподьем', 'подъём'),
    (r'\bКаб\.?\s+', 'Кабель '),
    (r'(\d+)\s*к\b', r'\1-конт.'),
    (r'(\d+)-конт\.\s+конт\.', r'\1-конт.'),
    (r'-\s+(?=[а-яё])', '-'),
    (r'\bнаконеч\b', 'наконечниками'),
    (r'\s+([,.;)])', r'\1'),
]

JUNK_VALUES = ('см. черт.', 'см. черт', 'см.черт.', 'см. кд', 'см. кд.')
SOURCE_TITLE = 'Общая спецификация жгуты АТЛАНТА от 02.10.26'


def clean_value(text):
    text = re.sub(r'\s+', ' ', str(text or '')).strip()
    return text.strip('.').strip()


def normalize_name(name):
    out = clean_value(name)
    for pattern, repl in WORD_FIXES:
        out = re.sub(pattern, repl, out)
    out = out.strip(' -/(,')
    if out:
        out = out[0].upper() + out[1:]
    return re.sub(r'\s+', ' ', out).strip()


def is_junk(text):
    return clean_value(text).lower() in JUNK_VALUES


def tidy_consumer(text):
    """«4FE065.ET01 4FE065.ET01 ОВ, 3FE.01 ТСМ ТСМ» → без повторов."""
    value = clean_value(text)
    if not value or is_junk(value):
        return ''
    parts = []
    for chunk in re.split(r'[;,]', value):
        words = chunk.split()
        deduped = [w for i, w in enumerate(words) if i == 0 or w != words[i - 1]]
        chunk = ' '.join(deduped).strip()
        if chunk and chunk not in parts:
            parts.append(chunk)
    return ', '.join(parts)


def fmt_number(text):
    return f"{int(text):,}".replace(',', ' ')


def length_value(text):
    value = clean_value(text)
    if not value or is_junk(value):
        return ''
    value = value.replace('х', '×')
    return value


def length_summary(values):
    """«500+2×300 мм», «14 000–34 000 мм» — по числовым и составным длинам."""
    unique = []
    for value in values:
        if value and value not in unique:
            unique.append(value)
    if not unique:
        return ''
    numbers = [int(v) for v in unique if v.isdigit()]
    if len(numbers) == len(unique):
        if len(numbers) == 1:
            return f'{fmt_number(numbers[0])} мм'
        return f'{fmt_number(min(numbers))}–{fmt_number(max(numbers))} мм'
    return '; '.join(unique[:6]) + (' …' if len(unique) > 6 else '')


def build_description(name, main, addl, lengths, consumers):
    parts = [name if name.endswith(('.', '!', '?')) else name + '.']
    main = clean_value(main)
    if main and not is_junk(main):
        parts.append(f'Основные: {main}.')
    addl = clean_value(addl)
    if addl and not is_junk(addl):
        parts.append(f'Дополнительные: {addl}.')
    if lengths:
        parts.append(f'Длина: {lengths}.')
    else:
        parts.append('Длина и комплектация — по чертежу.')
    consumers = clean_value(consumers)
    if consumers:
        parts.append(f'Потребители: {consumers}.')
    return ' '.join(parts)


def variant_label(family_name, variant, family_main=''):
    """Строка описания исполнения: своё название, длина, потребитель."""
    parts = []
    label = normalize_name(variant.get('label') or '')
    if label and label != family_name:
        parts.append(label)

    length = length_value(variant.get('length'))
    if length:
        suffix = '' if length.endswith('м') else ' мм'
        parts.append(f'длина {length}{suffix}')

    consumer = tidy_consumer(variant.get('consumer'))
    if consumer:
        parts.append(f'потребитель {consumer}')

    if not parts:
        # исполнение совпадает с названием семьи — описываем его разъём
        main = clean_value(variant.get('main'))
        if main and main != clean_value(family_main):
            parts.append(main)
    return '; '.join(parts)


def append_missing(text, length, consumer):
    """К старому описанию из каталога дописываем длину и потребителя, если их нет."""
    out = clean_value(text)
    if not out.endswith(('.', '!', '?')):
        out += '.'
    low = out.lower()
    has_length = 'длина' in low or 'кабель –' in low or 'мм' in low
    if length and not has_length:
        suffix = '' if length.endswith('м') else ' мм'
        out += f' Длина {length}{suffix}.'
    if consumer and consumer.split()[0] not in out:
        out += f' Потребитель {consumer}.'
    return out


def sort_key(base):
    match = re.match(r'^А\.3724\.(\d{3})$', base)
    if match:
        return (0, int(match.group(1)), '')
    return (1, 0, base)


def main():
    spec = json.load(open(SPEC_PATH, encoding='utf-8'))
    catalog = json.load(open(CATALOG_PATH, encoding='utf-8'))
    components = catalog['components']

    legacy = {}
    for entry in components:
        if entry.get('category') == 'harness':
            legacy[entry['article']] = entry

    def match_legacy(base, variants):
        """Старые плоские артикулы → исполнения семьи.

        Точное совпадение кода — прямое попадание; артикул без последней пары
        цифр (`А.3724.217-02`) — заголовок группы исполнений, он достаётся
        первому исполнению группы; остальные переносятся отдельной модификацией.
        """
        matched, extras = {}, []
        codes = [(v.get('code') or '').strip() for v in variants]
        for article, entry in legacy.items():
            if not article.startswith(base + '-'):
                continue
            code = article[len(base) + 1:]
            if code in codes:
                matched[codes.index(code)] = (article, entry)
                continue
            group = [i for i, c in enumerate(codes) if c.startswith(code + '.')]
            if group:
                matched.setdefault(group[0], (article, entry))
                continue
            # обратное направление: в спецификации код короче, чем в каталоге
            short = [i for i, c in enumerate(codes) if c and code.startswith(c + '.')]
            if short:
                matched.setdefault(short[0], (article, entry))
                continue
            extras.append((code, entry))
        return matched, extras

    families = sorted(spec['families'], key=lambda f: sort_key(f['base']))
    merged_entries = []
    stats = {'families': 0, 'modifications': 0, 'with_image': 0, 'legacy': 0, 'kept_desc': 0}

    for family in families:
        base = family['base']
        name = NAME_FIXES.get(base) or normalize_name(family['name'])
        variants = family['variants']

        lengths = length_summary([length_value(v.get('length')) for v in variants])
        consumers = []
        for variant in variants:
            value = tidy_consumer(variant.get('consumer'))
            if value and value not in consumers:
                consumers.append(value)
        consumers_text = ', '.join(consumers)
        if len(consumers_text) > 220:
            consumers_text = consumers_text[:220].rsplit(',', 1)[0] + ' и др.'

        description = build_description(
            name, family.get('main'), family.get('addl'), lengths, consumers_text)

        numbers = [int(v) for v in (length_value(x.get('length')) for x in variants) if v.isdigit()]
        dimensions = None
        if numbers and len(numbers) == len(variants):
            dimensions = f'длина {fmt_number(min(numbers))}–{fmt_number(max(numbers))} мм' \
                if len(numbers) > 1 else f'длина {fmt_number(numbers[0])} мм'

        matched, extras = match_legacy(base, variants)

        modifications = []
        image = None
        for index, variant in enumerate(variants):
            code = (variant.get('code') or '').strip()
            old_article, old = matched.get(index, ('', None))

            length = length_value(variant.get('length'))
            consumer = tidy_consumer(variant.get('consumer'))

            if old:
                stats['legacy'] += 1
                label = append_missing(old.get('description') or '', length, consumer)
                stats['kept_desc'] += 1
                if old_article != f"{base}-{code}":
                    # старый артикул был заголовком группы исполнений
                    label = f'арт. {old_article}: {label}'
            else:
                label = variant_label(name, variant, family.get('main'))

            if not code:
                continue                                    # базовая позиция без кода

            modification = {'code': code, 'name': label}
            if old_article and old_article != f"{base}-{code}":
                modification['legacy_article'] = old_article
            if old and old.get('image'):
                modification['images'] = [old['image']]
                if not image:
                    image = old['image']
                    stats['with_image'] += 1
            modifications.append(modification)

        taken = {m['code'] for m in modifications}
        for code, old in sorted(extras, key=lambda item: item[0]):
            if not code or code in taken:
                continue
            stats['legacy'] += 1
            label = append_missing(old.get('description') or '',
                                   '', tidy_consumer(''))
            extra = {'code': code, 'name': label, 'legacy_article': f'{base}-{code}'}
            if old.get('image'):
                extra['images'] = [old['image']]
            modifications.append(extra)
            if old.get('image') and not image:
                image = old['image']
                stats['with_image'] += 1

        entry = {
            'category': 'harness',
            'article': base,
            'name': name,
            'description': description,
            'specs': {
                'functions': [],
                'voltage': None,
                'temperature': None,
                'protection': None,
                'power': [],
                'dimensions': dimensions,
            },
            'image': image,
            'source': SOURCE_TITLE,
            'source_page': family.get('page'),
            'modifications': modifications,
        }
        merged_entries.append(entry)
        stats['families'] += 1
        stats['modifications'] += len(modifications)

    # заменяем плоские жгуты на семьи, остальные категории не трогаем
    result = []
    inserted = False
    for entry in components:
        if entry.get('category') == 'harness':
            if not inserted:
                result.extend(merged_entries)
                inserted = True
            continue
        result.append(entry)
    if not inserted:
        result.extend(merged_entries)

    catalog['components'] = result
    catalog.setdefault('catalog', {})
    sources = catalog['catalog'].setdefault('sources', [])
    if not any(item.get('title') == SOURCE_TITLE for item in sources):
        sources.append({'title': SOURCE_TITLE, 'pages': '1-23', 'kind': 'spec'})
    json.dump(catalog, open(CATALOG_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    open(CATALOG_PATH, 'a', encoding='utf-8').write('\n')

    print(f"жгутов-семейств: {stats['families']}, исполнений: {stats['modifications']}, "
          f"фото: {stats['with_image']}, перенесено старых позиций: {stats['legacy']}")
    print(f"всего позиций каталога: {len(result)}")


if __name__ == '__main__':
    main()
