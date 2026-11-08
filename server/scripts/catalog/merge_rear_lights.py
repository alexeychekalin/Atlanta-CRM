"""Задние фонари: одно изделие вместо пары «левый/правый».

В каталоге АТЛАНТА-26 задний фонарь напечатан двумя позициями — левый и правый
(А.3776.008.1Л и А.3776.008.1П), а у А.3776.005 ещё и комплектами с
дополнительным габаритным фонарём (А.3776.005Л-01/А.3731.007). По факту это
одно изделие: сторона и способ подключения — исполнения.

Скрипт перестраивает catalog.json:

  было:  А.3776.008.1Л, А.3776.008.1П              (по 2 исполнения)
  стало: А.3776.008.1 + 4 исполнения (Л/П × 01/03)

  было:  А.3776.005Л, А.3776.005П и 8 комплектов
  стало: А.3776.005 + 12 исполнений: Л/П × 01/05 и 8 комплектов

Код исполнения — то, что напечатано после артикула изделия: «Л-01», «П-05»,
у комплекта — «Л-01/А.3731.007». Полный артикул записывается в full_article,
потому что склейка «изделие-код» дала бы А.3776.005-Л-01.

Сторона (Л/П) входит в артикул, поэтому коды различаются стороной.
Количество разъёмов подписано в названии исполнения: 01 — только 7-контактный,
05 — 7-контактный и четыре 2-контактных (всего 5), 03 — 7-контактный и два
2-контактных (всего 3).

Прежние артикулы попадают в `supersedes` — импорт погасит/удалит их в базе.

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
SIDE_WORD = {'Л': 'левый', 'П': 'правый'}

# (кратко — для комплектов, полностью — для обычных исполнений с итогом)
CONNECTION_01 = ('7-контактный разъём', '7-контактный разъём')
CONNECTION_05 = ('7-контактный разъём и четыре 2-контактных',
                 '7-контактный разъём и четыре 2-контактных — всего 5 разъёмов')
CONNECTION_03 = ('7-контактный разъём и два 2-контактных',
                 '7-контактный разъём и два 2-контактных — всего 3 разъёма')

FAMILIES = [
    {
        'article': 'А.3776.005',
        'name': 'Фонарь задний многофункциональный (ФОНАРЬ 005)',
        'connections': {'01': CONNECTION_01, '05': CONNECTION_05},
        'kits': True,
        'note': ('Исполнение задаётся стороной (Л — левый, П — правый) и количеством '
                 'разъёмов: 01 — один 7-контактный, 05 — 7-контактный и четыре '
                 '2-контактных (5 разъёмов). Комплекты — тот же фонарь с дополнительным '
                 'габаритным фонарём А.3731.007 «клюшка» или А.3731.002.3 «рожок»; '
                 'артикул комплекта печатается через слэш.'),
    },
    {
        'article': 'А.3776.008',
        'name': 'Фонарь задний комбинированный (ФОНАРЬ 008)',
        'connections': {'01': CONNECTION_01, '03': CONNECTION_03},
        'kits': False,
        'note': ('Исполнение задаётся стороной (Л — левый, П — правый) и количеством '
                 'разъёмов: 01 — один 7-контактный, 03 — 7-контактный и два '
                 '2-контактных (3 разъёма).'),
    },
    {
        'article': 'А.3776.008.1',
        'name': 'Фонарь задний комбинированный с центральной подсветкой номера (ФОНАРЬ 008 с ФОНЗ)',
        'connections': {'01': CONNECTION_01, '03': CONNECTION_03},
        'kits': False,
        'note': ('Тот же фонарь 008 с центральной подсветкой номерного знака. Исполнение '
                 'задаётся стороной (Л — левый, П — правый) и количеством разъёмов: '
                 '01 — один 7-контактный, 03 — 7-контактный и два 2-контактных (3 разъёма).'),
    },
    {
        'article': 'А.3776.015',
        'name': 'Фонарь задний многофункциональный (ФОНАРЬ 015)',
        'connections': {'01': CONNECTION_01, '05': CONNECTION_05},
        'kits': False,
        'note': ('Исполнение задаётся стороной (Л — левый, П — правый) и количеством '
                 'разъёмов: 01 — один 7-контактный, 05 — 7-контактный и четыре '
                 '2-контактных (5 разъёмов).'),
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
    """Подпись способа подключения: кратко — для комплекта, полностью — для исполнения."""
    value = family['connections'].get(code)
    if not value:
        return ''
    if isinstance(value, (tuple, list)):
        return value[0] if short else value[1]
    return value


def kit_extra(name):
    """Из названия комплекта: «+ габаритный фонарь А.3731.007 «клюшка»» → текст после +."""
    parts = re.split(r'\s*\+\s*', name or '', maxsplit=1)
    return parts[1].strip() if len(parts) > 1 else ''


def family_note(family):
    return family['note']


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


def collect(family, components):
    """Старые позиции семьи: стороны и комплекты."""
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


def already_merged(family, components):
    base = next((item for item in components if item['article'] == family['article']), None)
    if not base:
        return False
    supersedes = set(base.get('supersedes') or [])
    sides, kits = collect(family, components)
    old = [item['article'] for item in sides.values()] + [item['article'] for item in kits]
    return bool(old) and all(article in supersedes for article in old)


def build_family(family, components):
    base = family['article']
    sides, kits = collect(family, components)
    if not sides:
        return None

    modifications = []
    seen, sort_order = set(), 0

    for side in ('Л', 'П'):
        member = sides.get(side)
        if not member:
            print(f'   ⚠️  нет позиции {base}{side}')
            continue
        for mod in member.get('modifications') or []:
            conn = mod.get('code') or ''
            code = f'{side}-{conn}' if conn else side
            if code in seen:
                print(f'   ⚠️  код {code} повторяется — пропуск')
                continue
            seen.add(code)
            text = connection_text(family, conn, short=False) or clean_text(mod.get('name'))
            modifications.append({
                'code': code,
                'full_article': f'{base}{side}-{conn}' if conn else f'{base}{side}',
                'name': f'{SIDES[side]}, {text}',
                'sort_order': sort_order,
                'images': list(mod.get('images') or []),
            })
            sort_order += 1

    if family.get('kits'):
        for kit in sorted(kits, key=lambda item: item['article']):
            rest = kit['article'][len(base):]                 # «Л-01/А.3731.007»
            side = rest[:1]
            code = rest
            conn = re.search(r'-(\d+)', rest)
            conn_text = connection_text(family, conn.group(1), short=True) if conn else ''
            extra = kit_extra(kit.get('name'))
            if code in seen:
                print(f'   ⚠️  код {code} повторяется — пропуск')
                continue
            seen.add(code)
            title = f'Комплект: {SIDE_WORD[side]} + {extra}' if extra else f'Комплект: {SIDE_WORD[side]}'
            if conn_text:
                title += f', {conn_text}'
            modifications.append({
                'code': code,
                'full_article': kit['article'],
                'name': clean_text(title),
                'sort_order': sort_order,
                'images': ([kit['image']] if kit.get('image') else []) + list(kit.get('images') or []),
            })
            sort_order += 1

    gallery = []
    for member in sides.values():
        gallery.extend(member.get('images') or [])
        if member.get('image'):
            gallery.append(member['image'])
    images = unique_files(gallery)
    cover = next((img for member in sides.values() for img in member.get('images') or []), None)

    first = next(iter(sides.values()))
    description = family_description(
        [member.get('description') or '' for member in sides.values()],
        family['name'],
        family_note(family),
    )

    return {
        'category': first['category'],
        'article': base,
        'name': family['name'],
        'description': description,
        'specs': first.get('specs') or {},
        'image': cover or first.get('image'),
        'source_page': first.get('source_page'),
        'supersedes': [member['article'] for member in sides.values()] +
                      [kit['article'] for kit in kits],
        'modifications': modifications,
        'images': images,
    }


def main():
    parser = argparse.ArgumentParser(description='Собрать задние фонари «изделие + исполнения»')
    parser.add_argument('--dry-run', action='store_true', help='только показать, что изменится')
    args = parser.parse_args()

    config = json.loads(CATALOG_JSON.read_text(encoding='utf-8'))
    components = config['components']

    if all(already_merged(family, components) for family in FAMILIES):
        print('ℹ️  Семейства уже собраны — менять нечего. '
              'Для пересборки верните пары «левый/правый» в catalog.json.')
        return

    replace = {}
    for family in FAMILIES:
        if already_merged(family, components):
            print(f'{family["article"]}: уже собрано — пропуск')
            continue
        entry = build_family(family, components)
        if not entry:
            print(f'⚠️  {family["article"]}: позиции не найдены — пропуск')
            continue
        found = sum(1 for item in components if item['article'] in entry['supersedes'])
        print(f'{family["article"]}: {found} позиций → 1 изделие, '
              f'{len(entry["modifications"])} исполнений, {len(entry["images"])} фото')
        replace[family['article']] = entry

    merged_old = {item['article'] for item in components
                  if any(item['article'] in entry['supersedes'] for entry in replace.values())}
    result, placed = [], set()
    for item in components:
        if item['article'] in merged_old:
            for key, entry in list(replace.items()):
                if item['article'] in entry['supersedes'] and key not in placed:
                    result.append(replace.pop(key))
                    placed.add(key)
                    break
            continue
        result.append(item)

    if replace:
        print('⚠️  не найдено место для:', ', '.join(replace))
        result.extend(replace.values())

    print(f'позиций в каталоге: {len(components)} → {len(result)}')

    if args.dry_run:
        for family in FAMILIES:
            entry = next((x for x in result if x['article'] == family['article']), None)
            if not entry:
                continue
            print(f'\n── {entry["article"]} {entry["name"]}')
            print('   описание:', entry['description'].split('\n')[0], '…')
            for mod in entry['modifications']:
                print(f'   {mod["full_article"]:<34} {mod["name"][:70]}')
        return

    config['components'] = result
    CATALOG_JSON.write_text(
        json.dumps(config, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'записано: {CATALOG_JSON}')


if __name__ == '__main__':
    main()
