"""Задние фонари: изделие без стороны + комплекты отдельными изделиями.

В каталоге АТЛАНТА-26 задний фонарь напечатан двумя позициями — левый и правый
(А.3776.008.1Л и А.3776.008.1П), а у А.3776.005 ещё и комплектами с
дополнительным габаритным фонарём (А.3776.005Л-01/А.3731.007). По факту сторона
и способ подключения — исполнения, а комплект — своё изделие: у него другой
состав и своё фото.

Скрипт перестраивает catalog.json:

  было:  А.3776.008.1Л, А.3776.008.1П              (по 2 исполнения)
  стало: А.3776.008.1 + 4 исполнения (Л/П × 01/03)

  было:  А.3776.005Л, А.3776.005П и 8 комплектов
  стало: А.3776.005 + 4 исполнения (Л/П × 01/05)
         А.3776.005/А.3731.007 + 4 исполнения (Л/П × 01/05)
         А.3776.005/А.3731.002.3 + 4 исполнения (Л/П × 01/05)

Код исполнения — то, что напечатано после артикула: «Л-01», «П-05». Полный
артикул записывается в full_article, потому что склейка «изделие-код» дала бы
А.3776.005-Л-01; у комплекта печатный артикул ещё и со слэшем:
А.3776.005Л-05/А.3731.007.

Сторона (Л/П) входит в код, поэтому коды различаются стороной.
Количество разъёмов подписано в названии исполнения: 01 — только 7-контактный,
05 — 7-контактный и четыре 2-контактных (всего 5), 03 — 7-контактный и два
2-контактных (всего 3).

Скрипт умеет и первый прогон (по плоским артикулам «Л»/«П» и комплектам),
и пересборку уже слитого каталога, где комплекты лежали исполнениями изделия:
их исполнения выносятся в отдельные изделия. Повторный запуск ничего не меняет.

Запуск из корня репозитория:

    python3 server/scripts/catalog/merge_rear_lights.py --dry-run
    python3 server/scripts/catalog/merge_rear_lights.py
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG_JSON = ROOT / 'src' / 'db' / 'catalog' / 'catalog.json'
FILES_DIR = ROOT / 'src' / 'db' / 'catalog' / 'files'

SIDES = {'Л': 'Левый', 'П': 'Правый'}
SIDE_ORDER = {'Л': 0, 'П': 1}

# (кратко — в составе комплекта, полностью — в исполнении, вводная строка описания)
CONNECTION_01 = ('7-контактный разъём', '7-контактный разъём', 'один 7-контактный')
CONNECTION_05 = ('7-контактный разъём и четыре 2-контактных',
                 '7-контактный разъём и четыре 2-контактных — всего 5 разъёмов',
                 '7-контактный и четыре 2-контактных (5 разъёмов)')
CONNECTION_03 = ('7-контактный разъём и два 2-контактных',
                 '7-контактный разъём и два 2-контактных — всего 3 разъёма',
                 '7-контактный и два 2-контактных (3 разъёма)')

FAMILIES = [
    {
        'article': 'А.3776.005',
        'name': 'Фонарь задний многофункциональный (ФОНАРЬ 005)',
        'connections': {'01': CONNECTION_01, '05': CONNECTION_05},
        'kits': {'А.3731.007': 'клюшка', 'А.3731.002.3': 'рожок'},
    },
    {
        'article': 'А.3776.008',
        'name': 'Фонарь задний комбинированный (ФОНАРЬ 008)',
        'connections': {'01': CONNECTION_01, '03': CONNECTION_03},
        'kits': {},
    },
    {
        'article': 'А.3776.008.1',
        'name': 'Фонарь задний комбинированный с центральной подсветкой номера (ФОНАРЬ 008 с ФОНЗ)',
        'connections': {'01': CONNECTION_01, '03': CONNECTION_03},
        'kits': {},
        'extra': 'Тот же фонарь 008 с центральной подсветкой номерного знака.',
    },
    {
        'article': 'А.3776.015',
        'name': 'Фонарь задний многофункциональный (ФОНАРЬ 015)',
        'connections': {'01': CONNECTION_01, '05': CONNECTION_05},
        'kits': {},
    },
]


def file_hash(name):
    path = FILES_DIR / name
    if not path.exists():
        return name
    return hashlib.md5(path.read_bytes()).hexdigest()


def unique_files(names):
    seen, out = set(), []
    for name in names:
        digest = file_hash(name)
        if digest in seen:
            continue
        seen.add(digest)
        out.append(name)
    return out


def clean_text(text):
    """Пробелы, запятая перед словом и заглавная в начале."""
    value = re.sub(r'\s+', ' ', text or '').strip()
    value = re.sub(r',\s*(?=[А-Яа-яЁёA-Za-z])', ', ', value)
    value = value.replace(' - ', ' — ')          # тире в тексте, дефисы в артикулах не трогаем
    if not value:
        return value
    return value[0].upper() + value[1:]


def connection_text(family, code, short=False):
    """Подпись способа подключения: кратко — где есть состав, полностью — в исполнении."""
    value = family['connections'].get(code)
    if not value:
        return ''
    if isinstance(value, (tuple, list)):
        return value[0] if short else value[1]
    return value


def connections_note(family):
    parts = []
    for code, value in sorted(family['connections'].items()):
        parts.append(f'{code} — {value[2] if len(value) > 2 else value[1]}')
    return ('Исполнение задаётся стороной (Л — левый, П — правый) и количеством '
            f'разъёмов: {"; ".join(parts)}.')


def family_note(family):
    parts = []
    if family.get('extra'):
        parts.append(family['extra'])
    parts.append(connections_note(family))
    return ' '.join(parts)


def kit_word(family, extra, *texts):
    """Как фонарь называют в каталоге: «клюшка», «рожок»."""
    word = (family.get('kits') or {}).get(extra)
    if word:
        return word
    for text in texts:
        match = re.search(r'«([^»]+)»', text or '')
        if match:
            return match.group(1)
    return ''


def kits_sentence(articles):
    if not articles:
        return ''
    return ('Комплекты с дополнительным габаритным фонарём — отдельные изделия: '
            + ', '.join(articles) + '.')


def family_description(texts, name, note):
    """Общее описание семьи: самый подробный текст без названия и служебных строк."""
    text = max(texts, key=len, default='')
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    kept = []
    for index, line in enumerate(lines):
        if index == 0:                                     # название варианта
            continue
        if line.startswith('Исполнение:') or line.startswith('Вариантов подключения:'):
            continue
        if line.startswith('На странице каталога несколько вариантов'):
            continue
        if line.startswith('Комплект:'):                   # следы прежнего комплекта
            continue
        kept.append(line)
    return f'{name}.\n{note}\n' + '\n'.join(kept).strip()


def kit_description(family, extra):
    """Название и описание изделия-комплекта: в названии оба артикула, состав — в описании."""
    word = kit_word(family, extra)
    label = f'{extra} «{word}»' if word else extra
    name = f'Комплект: {family["article"]} + {label}'
    text = (f'{name}.\n'
            f'В комплект входят {lower_first(family["name"])} и габаритный фонарь {label}; '
            f'артикул комплекта печатается через слэш — {family["article"]}Л-01/{extra}. '
            f'{connections_note(family)}')
    return name, text


def lower_first(text):
    return text[0].lower() + text[1:] if text else text


def kit_mod_name(family, side, conn):
    text = connection_text(family, conn, short=False) or ''
    return clean_text(f'{SIDES[side]}, {text}') if text else SIDES[side]


def kit_code(side, conn):
    return f'{side}-{conn}' if conn else side


def parse_code(family, code):
    """«Л-01» → ('Л', '01'); «Л» → ('Л', '')."""
    match = re.fullmatch(r'([ЛП])(?:-(\d+))?', code or '')
    if not match:
        return None
    return match.group(1), match.group(2) or ''


def collect(family, components):
    """Старые позиции семьи: стороны и комплекты (плоские артикулы каталога)."""
    base = family['article']
    sides, kits = {}, []
    for item in components:
        article = item['article']
        if not article.startswith(base):
            continue
        rest = article[len(base):]
        side = rest[:1]
        if side not in SIDES:
            continue
        if '/' in rest:
            kits.append(item)
        elif re.fullmatch(r'[ЛП]', rest):
            sides[side] = item
    return sides, kits


def kit_groups(kits, base):
    """Плоские комплекты по дополнительному фонарю: {'А.3731.007': [позиции]}."""
    groups = {}
    for item in sorted(kits, key=lambda entry: entry['article']):
        rest = item['article'][len(base):]                  # «Л-01/А.3731.007»
        extra = rest.split('/', 1)[1]
        groups.setdefault(extra, []).append(item)
    return groups


def append_body(entry, base_description):
    """Дописать комплекту характеристики изделия: функции, питание, мощность."""
    body = [line for line in (base_description or '').split('\n')[2:] if line.strip()]
    if body:
        entry['description'] = entry['description'].rstrip() + '\n' + '\n'.join(body)
    return entry


def build_kit_entry(family, extra, mods, template):
    """Изделие-комплект: исполнения — сторона + число разъёмов."""
    base = family['article']
    name, description = kit_description(family, extra)
    modifications, images = [], []
    for order, mod in enumerate(sorted(mods, key=lambda m: (SIDE_ORDER.get(m['_side'], 9),
                                                            m['code']))):
        modifications.append({
            'code': mod['code'],
            'full_article': mod['full_article'],
            'name': mod['name'],
            'sort_order': order,
            'images': list(mod.get('images') or []),
        })
        images.extend(mod.get('images') or [])
    images = unique_files(images)
    return {
        'category': template['category'],
        'article': f'{base}/{extra}',
        'name': name,
        'description': description,
        'specs': template.get('specs') or {},
        'image': images[0] if images else None,
        'source_page': template.get('source_page'),
        'supersedes': [mod['full_article'] for mod in modifications],
        'modifications': modifications,
        'images': images,
    }


def build_from_flats(family, sides, kits):
    """Первый прогон: из плоских «Л»/«П» и комплектов — изделие и изделия-комплекты."""
    base = family['article']
    if not sides:
        return None

    modifications = []
    seen = set()
    for side in sorted(sides, key=lambda s: SIDE_ORDER.get(s, 9)):
        member = sides[side]
        for mod in member.get('modifications') or []:
            conn = mod.get('code') or ''
            code = kit_code(side, conn)
            if code in seen:
                print(f'   ⚠️  код {code} повторяется — пропуск')
                continue
            seen.add(code)
            modifications.append({
                'code': code,
                'full_article': f'{base}{side}-{conn}' if conn else f'{base}{side}',
                'name': f'{SIDES[side]}, {connection_text(family, conn) or clean_text(mod.get("name"))}',
                'sort_order': len(modifications),
                'images': list(mod.get('images') or []),
            })

    first = next(iter(sides.values()))
    gallery = []
    for member in sides.values():
        gallery.extend(member.get('images') or [])
        if member.get('image'):
            gallery.append(member['image'])
    images = unique_files(gallery)

    # комплекты: код берём из печатного артикула комплекта
    groups = kit_groups(kits, base)
    kit_mods = {}
    for extra, items in groups.items():
        for item in items:
            rest = item['article'][len(base):]              # «Л-01/А.3731.007»
            side_conn = rest.split('/', 1)[0]               # «Л-01»
            parsed = parse_code(family, side_conn)
            if not parsed:
                print(f'   ⚠️  не разобрать код комплекта {item["article"]} — пропуск')
                continue
            side, conn = parsed
            kit_mods.setdefault(extra, []).append({
                'code': kit_code(side, conn),
                'full_article': item['article'],
                'name': kit_mod_name(family, side, conn),
                'images': ([item['image']] if item.get('image') else []) +
                          list(item.get('images') or []),
                '_side': side,
            })

    entries = []
    for extra in sorted(kit_mods):
        entries.append(build_kit_entry(family, extra, kit_mods[extra], first))

    description = family_description(
        [member.get('description') or '' for member in sides.values()],
        family['name'],
        family_note(family) + ' ' + kits_sentence([f'{e["article"]}' for e in entries]),
    )
    for entry in entries:
        append_body(entry, description)

    base_entry = {
        'category': first['category'],
        'article': base,
        'name': family['name'],
        'description': description.strip(),
        'specs': first.get('specs') or {},
        'image': images[0] if images else first.get('image'),
        'source_page': first.get('source_page'),
        'supersedes': [member['article'] for member in sides.values()],
        'modifications': modifications,
        'images': images,
    }
    return [base_entry] + entries


def split_merged(family, component):
    """Пересборка: комплекты лежали исполнениями изделия — выносим их в изделия."""
    base = family['article']
    plain = [mod for mod in component.get('modifications') or [] if '/' not in (mod.get('code') or '')]
    kit_mods = [mod for mod in component.get('modifications') or [] if '/' in (mod.get('code') or '')]
    if not kit_mods:
        return None

    groups = {}
    for mod in kit_mods:
        side_conn, extra = mod['code'].split('/', 1)
        parsed = parse_code(family, side_conn)
        if not parsed:
            print(f'   ⚠️  не разобрать код {mod["code"]} — пропуск')
            continue
        side, conn = parsed
        groups.setdefault(extra, []).append({
            'code': kit_code(side, conn),
            'full_article': mod.get('full_article') or f'{base}{side_conn}/{extra}',
            'name': kit_mod_name(family, side, conn),
            'images': list(mod.get('images') or []),
            '_side': side,
        })

    entries = [build_kit_entry(family, extra, mods, component) for extra, mods in
               sorted(groups.items())]

    # описание изделия: убираем абзац про комплекты и заново собираем вводную строку
    note = family_note(family) + ' ' + kits_sentence([entry['article'] for entry in entries])
    body = [line for line in (component.get('description') or '').split('\n')[1:]
            if line.strip() and 'Комплект' not in line]
    description = f'{component["name"]}.\n{note}\n' + '\n'.join(body)

    for entry in entries:
        append_body(entry, description)

    base_entry = dict(component)
    base_entry['description'] = description
    base_entry['modifications'] = [
        {**mod, 'sort_order': order} for order, mod in enumerate(plain)
    ]
    base_entry['supersedes'] = [old for old in component.get('supersedes') or []
                                if old not in {mod['full_article'] for mod in kit_mods}]
    return [base_entry] + entries


def apply_family(family, components):
    """Новые позиции семьи или None, если менять нечего."""
    sides, kits = collect(family, components)
    base = next((item for item in components if item['article'] == family['article']), None)

    if sides:
        return build_from_flats(family, sides, kits)
    if base and any('/' in (mod.get('code') or '') for mod in base.get('modifications') or []):
        return split_merged(family, base)
    return None


def plural(count, one, few, many):
    if count % 10 == 1 and count % 100 != 11:
        return one
    if 2 <= count % 10 <= 4 and not 12 <= count % 100 <= 14:
        return few
    return many


def main():
    parser = argparse.ArgumentParser(description='Собрать задние фонари «изделие + исполнения»')
    parser.add_argument('--dry-run', action='store_true', help='только показать, что изменится')
    args = parser.parse_args()

    config = json.loads(CATALOG_JSON.read_text(encoding='utf-8'))
    components = config['components']

    replace = {}                       # артикул новой позиции → позиция
    drop = set()                       # что уходит из каталога
    order = {}                         # после какого артикула вставить

    for family in FAMILIES:
        entries = apply_family(family, components)
        if not entries:
            continue
        base = family['article']
        old_sides = [item for item in components if item['article'] in
                     {entry['article'] for entry in entries} or
                     (item['article'].startswith(base) and
                      item['article'][len(base):][:1] in SIDES)]
        anchor = old_sides[0]['article'] if old_sides else base
        order[base] = anchor
        for item in old_sides:
            drop.add(item['article'])
        for entry in entries:
            replace[entry['article']] = entry
        mods = sum(len(entry['modifications']) for entry in entries)
        kits = len(entries) - 1
        print(f'{base}: {len(old_sides)} {plural(len(old_sides), "позиция", "позиции", "позиций")} → '
              f'1 изделие' + (f' + {kits} {plural(kits, "комплект", "комплекта", "комплектов")}' if kits else '')
              + f', {mods} исполнений, {len(entries[0]["images"])} фото')

    if not replace:
        print('ℹ️  Задние фонари уже собраны — менять нечего.')
        return

    result, placed = [], set()
    for item in components:
        article = item['article']
        for base, anchor in order.items():
            if article == anchor and base not in placed:
                result.extend(replace[key] for key in sorted(replace)
                              if key == base or key.startswith(f'{base}/'))
                placed.add(base)
        if article in drop:
            continue
        result.append(item)

    for base in order:
        if base in placed:
            continue
        result.extend(replace[key] for key in sorted(replace)
                      if key == base or key.startswith(f'{base}/'))

    print(f'позиций в каталоге: {len(components)} → {len(result)}')

    if args.dry_run:
        for family in FAMILIES:
            for entry in replace.values():
                if entry['article'] != family['article'] and \
                        not entry['article'].startswith(family['article'] + '/'):
                    continue
                print(f'\n── {entry["article"]} {entry["name"]}')
                print('   описание:', entry['description'].split('\n')[0], '…')
                for mod in entry['modifications']:
                    print(f'   {mod["full_article"]:<34} {mod["name"][:74]}')
        return

    config['components'] = result
    CATALOG_JSON.write_text(
        json.dumps(config, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'записано: {CATALOG_JSON}')


if __name__ == '__main__':
    main()
