"""Сборка семейств габаритных фонарей: изделие + исполнения.

В каталоге АТЛАНТА-26 часть габаритных фонарей напечатана как отдельные
позиции по цвету: А.3731.027-01 (передний), -02 (задний), -03 (боковой).
По факту А.3731.027 — это изделие, а 01/02/03 — цвет рассеивателя, дальше
идут варианты подключения и длины кабеля (файл конструкторов
«modification FG.pdf»). В CRM такое семейство должно быть одной позицией
с исполнениями: иначе в прайсе три карточки, а поиск по полному артикулу
«А.3731.027-01.21» ведёт в одну из них.

Скрипт перестраивает catalog.json:

  было:  А.3731.027-01, А.3731.027-02, А.3731.027-03  (у каждой 3 исполнения)
  стало: А.3731.027 + 78 исполнений (3 цвета × 26 вариантов)

Запуск из корня репозитория:

    python3 server/scripts/catalog/merge_marker_families.py --dry-run
    python3 server/scripts/catalog/merge_marker_families.py

Фото переносятся: галерея семьи = объединение галерей старого семейства без
повторов (сравнение по содержимому файла), фото исполнения — по коду.
Прежние артикулы попадают в `supersedes` — импорт погасит/удалит их в базе.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG_JSON = ROOT / 'src' / 'db' / 'catalog' / 'catalog.json'
FILES_DIR = ROOT / 'src' / 'db' / 'catalog' / 'files'

# Цвет рассеивателя и назначение — по файлу конструкторов
COLORS = {
    '01': ('бесцветный', 'Передний'),
    '02': ('красный', 'Задний'),
    '03': ('автожелтый', 'Боковой'),
    '1': ('бесцветный', 'Передний'),
    '2': ('красный', 'Задний'),
    '3': ('автожелтый', 'Боковой'),
}

# Способы подключения к бортовой сети и длина кабеля
WIRE = 'провод без разъёма'
CONNECTOR_A = 'соединитель А.3723.001 (большая клипса, быстрый монтаж)'
CONNECTOR_B = 'соединитель А.3723.002 (малая клипса, быстрый монтаж)'
PLUG = 'вилка А.3723.006 (АМР 282104)'
SOCKET = 'розетка А.3723.007 (АМР 282080)'

LENGTHS = [('1', '50 мм'), ('2', '200 мм'), ('3', '500 мм'), ('4', '1200 мм'), ('5', '1500 мм')]


def with_cable(text, length):
    return f'{text}, кабель {length}'


def family_027():
    """А.3731.027 — маркер 27: 3 цвета × (6 + 5 + 5 + 5 + 5) вариантов."""
    groups = [
        ('0', WIRE, LENGTHS + [('6', '100 мм и прокладка EPDM 3 мм')]),
        ('2', CONNECTOR_A, LENGTHS),
        ('4', CONNECTOR_B, LENGTHS),
        ('6', PLUG, LENGTHS),
        ('8', SOCKET, LENGTHS),
    ]
    variants = []
    for prefix, connection, lengths in groups:
        for suffix, length in lengths:
            variants.append((prefix + suffix, with_cable(connection, length)))
    return variants, '{color}.{variant}', None


def family_023():
    """А.3731.023 — маркер 23: 3 цвета × 3 кронштейна × 3 подключения, кабель 1,5 м."""
    brackets = [('01', 'кронштейн стандартная рама'), ('02', 'кронштейн прямой'), ('03', 'кронштейн угловой')]
    connections = [('00', WIRE), ('01', CONNECTOR_A), ('06', PLUG)]
    variants = []
    for bracket_code, bracket in brackets:
        for conn_code, connection in connections:
            variants.append((f'{bracket_code}.{conn_code}-150',
                             f'{bracket}, {with_cable(connection, "1,5 м")}'))
    return variants, '{color}-{variant}', 'dash-color'


def family_025():
    """А.3731.025 — маркер 25: 3 цвета × 2 кронштейна × 3 подключения, кабель 1,5 м."""
    brackets = [('01', 'кронштейн стандартная рама'), ('02', 'кронштейн угловой')]
    connections = [('00', WIRE), ('01', CONNECTOR_A), ('02', PLUG)]
    variants = []
    for bracket_code, bracket in brackets:
        for conn_code, connection in connections:
            variants.append((f'{bracket_code}.{conn_code}-150',
                             f'{bracket}, {with_cable(connection, "1,5 м")}'))
    return variants, '{color}-{variant}', 'dash-color'


def family_026():
    """А.3731.026 — «пуговка»: 2 цвета × 3 подключения × 2 длины."""
    connections = [('00', WIRE), ('01', CONNECTOR_A), ('02', PLUG)]
    variants = []
    for conn_code, connection in connections:
        for length_code, length in [('050', '0,5 м'), ('150', '1,5 м')]:
            variants.append((f'{conn_code}-{length_code}', with_cable(connection, length)))
    return variants, '{color}-{variant}', 'dash-color'


FAMILIES = [
    {
        'article': 'А.3731.027',
        'name': 'Фонарь габаритный со светоотражателем (маркер 27)',
        'colors': ['01', '02', '03'],
        'build': family_027,
        'supersedes': ['А.3731.027-01', 'А.3731.027-02', 'А.3731.027-03'],
        'note': ('Исполнение задаётся цветом рассеивателя (-01 белый/передний, '
                 '-02 красный/задний, -03 автожелтый/боковой) и способом подключения: '
                 'провод без разъёма, соединитель А.3723.001 или А.3723.002, '
                 'вилка А.3723.006 (АМР 282104) или розетка А.3723.007 (АМР 282080); '
                 'длина кабеля 50–1500 мм.'),
    },
    {
        'article': 'А.3731.023',
        'name': 'Фонарь габаритный со светоотражателем (маркер 23)',
        'colors': ['1', '2', '3'],
        'build': family_023,
        'supersedes': ['А.3731.023.1', 'А.3731.023.2', 'А.3731.023.3'],
        'note': ('Исполнение задаётся цветом рассеивателя (.1 белый/передний, '
                 '.2 красный/задний, .3 автожелтый/боковой), кронштейном '
                 '(стандартная рама, прямой, угловой) и способом подключения '
                 '(провод без разъёма, соединитель А.3723.001, вилка А.3723.006).'),
    },
    {
        'article': 'А.3731.025',
        'name': 'Фонарь габаритный со светоотражателем (маркер 25)',
        'colors': ['1', '2', '3'],
        'build': family_025,
        'supersedes': ['А.3731.025.1', 'А.3731.025.2', 'А.3731.025.3'],
        'note': ('Исполнение задаётся цветом рассеивателя (.1 белый/передний, '
                 '.2 красный/задний, .3 автожелтый/боковой), кронштейном '
                 '(стандартная рама, угловой) и способом подключения '
                 '(провод без разъёма, соединитель А.3723.001, вилка А.3723.006).'),
    },
    {
        'article': 'А.3731.026',
        'name': 'Фонарь габаритный (пуговка)',
        'colors': ['1', '2'],
        'build': family_026,
        'supersedes': ['А.3731.026.1', 'А.3731.026.2'],
        'note': ('Исполнение задаётся цветом рассеивателя (.1 белый/передний, '
                 '.2 красный/задний) и способом подключения (провод без разъёма, '
                 'соединитель А.3723.001, вилка А.3723.006); длина кабеля 0,5 или 1,5 м.'),
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


def family_description(member_texts, name, note):
    """Описание семьи: общее из прежних карточек + какие бывают исполнения."""
    text = max(member_texts, key=len, default='')
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    kept = []
    for index, line in enumerate(lines):
        if index == 0:                       # первая строка — название с цветом
            continue
        if line.startswith('Исполнение:'):    # «Исполнение: передний. Вариантов…»
            continue
        kept.append(line)
    body = '\n'.join(kept)
    return f'{name}.\n{note}\n{body}'.strip()


def build_family(family, components):
    """Новая позиция: артикул изделия, исполнения и объединённые фото."""
    members = [item for item in components if item['article'] in family['supersedes']]
    if not members:
        return None

    variants, code_template, mode = family['build']()
    modifications = []
    sort_order = 0
    for color in family['colors']:
        lens, function_word = COLORS[color]
        for variant, variant_text in variants:
            code = code_template.format(article=family['article'], color=color, variant=variant)
            if mode == 'dash-color':
                full = f"{family['article']}.{color}-{variant}"
            else:
                full = f"{family['article']}-{code}"
            modifications.append({
                'code': code,
                'full_article': full,
                'name': f'{function_word} габаритный огонь ({lens} рассеиватель), {variant_text}',
                'sort_order': sort_order,
            })
            sort_order += 1

    # фото исполнений переезжают по коду: старый код «03» у А.3731.027-01 → «01.03»
    old_images = {}
    for member in members:
        suffix = member['article'][len(family['article']):]   # '-01', '.1'
        color = suffix.lstrip('-.').strip()
        for mod in member.get('modifications') or []:
            images = mod.get('images') or []
            if not images:
                continue
            if mode == 'dash-color':
                new_code = f'{color}-{mod["code"]}'
            else:
                new_code = f'{color}.{mod["code"]}'
            old_images[new_code] = images

    for mod in modifications:
        mod['images'] = old_images.get(mod['code'], [])

    images = unique_files([img for member in members for img in member.get('images') or []])
    legacy_articles = {}
    for member in members:
        legacy_articles[member['article']] = [m['code'] for m in member.get('modifications') or []]

    description = family_description(
        [member.get('description') or '' for member in members],
        family['name'],
        family['note'],
    )

    return {
        'category': members[0]['category'],
        'article': family['article'],
        'name': family['name'],
        'description': description,
        'specs': members[0].get('specs') or {},
        'image': images[0] if images else members[0].get('image'),
        'source_page': members[0].get('source_page'),
        'supersedes': list(family['supersedes']),
        'modifications': modifications,
        'images': images,
    }, legacy_articles


def main():
    parser = argparse.ArgumentParser(description='Собрать семейства габаритных фонарей')
    parser.add_argument('--dry-run', action='store_true', help='только показать, что изменится')
    args = parser.parse_args()

    config = json.loads(CATALOG_JSON.read_text(encoding='utf-8'))
    components = config['components']

    by_article = {item['article']: item for item in components}
    replace = {}
    for family in FAMILIES:
        built = build_family(family, components)
        if not built:
            print(f'⚠️  {family["article"]}: позиции {", ".join(family["supersedes"])} не найдены — пропуск')
            continue
        entry, legacy = built
        replace[family['article']] = entry
        print(f'{family["article"]}: {len(legacy)} позиций → 1 изделие, '
              f'{len(entry["modifications"])} исполнений, {len(entry["images"])} фото')

    result = []
    placed = set()
    for item in components:
        article = item['article']
        # новая позиция встаёт на место первой из вошедших в семейство
        for family in FAMILIES:
            if article in family['supersedes'] and family['article'] in replace:
                if family['article'] not in placed:
                    result.append(replace.pop(family['article']))
                    placed.add(family['article'])
                break
        if any(article in family['supersedes'] for family in FAMILIES):
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
            for mod in entry['modifications'][:3] + entry['modifications'][-2:]:
                print(f'   {mod["full_article"]:<24} {mod["name"][:76]}')
        return

    config['components'] = result
    CATALOG_JSON.write_text(
        json.dumps(config, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'записано: {CATALOG_JSON}')


if __name__ == '__main__':
    main()
