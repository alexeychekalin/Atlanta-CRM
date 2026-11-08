"""Семейства А.3731.018 и А.3731.010: изделие + исполнения.

В каталоге АТЛАНТА-26 эти фонари напечатаны несколькими позициями: вариант
корпуса и кронштейна вынесен в артикул (А.3731.018-21, -41-У, -43-О;
А.3731.010-Т, -О), а способ подключения — в код в скобках. По факту это одно
изделие: в прайсе поставщики продают А.3731.018-41.24, А.3731.010-03.27 —
то есть «изделие-вариант.код».

Скрипт перестраивает catalog.json:

  было:  А.3731.018-21, -23, -41, -43, -21-У, -23-У, -41-У, -43-У, -23-О, -43-О
  стало: А.3731.018 + 14 исполнений (код «41.03», полный «А.3731.018-41.03»)

  было:  А.3731.010, А.3731.010-О, А.3731.010-Т
  стало: А.3731.010 + 28 исполнений (код «03.10-О», «А.3731.010-03.10-О»)

Правило кода: вариант корпуса, затем через точку код подключения из каталога,
затем буква кронштейна (-У универсальный, -О на обечайку, -Т на трубу).
Исполнения без кода (у вариантов 2x — разъём на корпусе) остаются с кодом
из одного варианта: «21», «23-О».

Прежние артикулы попадают в `supersedes` — импорт погасит/удалит их в базе.

Запуск из корня репозитория:

    python3 server/scripts/catalog/merge_marker_variants.py --dry-run
    python3 server/scripts/catalog/merge_marker_variants.py
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG_JSON = ROOT / 'src' / 'db' / 'catalog' / 'catalog.json'
FILES_DIR = ROOT / 'src' / 'db' / 'catalog' / 'files'

# (старый артикул, вариант корпуса, буква кронштейна, подпись для исполнения
#  без кодов в каталоге)
FAMILIES = [
    {
        'article': 'А.3731.018',
        'name': 'Фонарь габаритный со светоотражателем (маркер 18)',
        'members': [
            ('А.3731.018-21', '21', '', 'Передний, разъём на корпусе'),
            ('А.3731.018-23', '23', '', 'Боковой, разъём на корпусе'),
            ('А.3731.018-41', '41', '', 'Передний'),
            ('А.3731.018-43', '43', '', 'Боковой'),
            ('А.3731.018-21-У', '21', '-У', 'Передний, разъём на корпусе, универсальный кронштейн'),
            ('А.3731.018-23-У', '23', '-У', 'Боковой, разъём на корпусе, универсальный кронштейн'),
            ('А.3731.018-41-У', '41', '-У', 'Передний, универсальный кронштейн'),
            ('А.3731.018-43-У', '43', '-У', 'Боковой, универсальный кронштейн'),
            ('А.3731.018-23-О', '23', '-О', 'Боковой, разъём на корпусе, кронштейн на обечайку'),
            ('А.3731.018-43-О', '43', '-О', 'Боковой, кронштейн на обечайку'),
        ],
        'note': ('Исполнение задаётся вариантом корпуса и кронштейна, а после точки — '
                 'способом подключения: 03 — провод с открытым концом, 23 — соединитель '
                 'А.3723.001 (быстрый монтаж), 63 — вилка А.3723.006 (АМР 282104), кабель '
                 '0,5 м. Варианты -21/-23 — с разъёмом на корпусе, без кабеля (кода нет); '
                 '-41/-43 — с кабелем и разъёмом. Буква в артикуле: -У — универсальный '
                 'кронштейн, -О — кронштейн на обечайку.'),
    },
    {
        'article': 'А.3731.010',
        # базовый артикул уже несёт цвет и подключение в коде — варианта нет
        'name': 'Фонарь габаритный со светоотражателем (маркер 10)',
        'members': [
            ('А.3731.010', '', '', ''),
            ('А.3731.010-О', '', '-О', ''),
            ('А.3731.010-Т', '', '-Т', ''),
        ],
        'note': ('Исполнение задаётся цветом рассеивателя (01 белый/передний, 02 красный/'
                 'задний, 03 автожелтый/боковой) и способом подключения с длиной кабеля: '
                 '03/04 — провод с открытым концом, 23/24 — соединитель А.3723.001, '
                 '63/64 — вилка А.3723.006 (АМР 282104), 09/10 — разъём АМР 282104 на '
                 'корпусе; вторая цифра пары: с кронштейном / без кронштейна. Буква в '
                 'артикуле: -Т — кронштейн на трубу, -О — кронштейн на обечайку.'),
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


def clean_name(text):
    """Название исполнения: без двойных пробелов, «,с» → «, с», с заглавной."""
    value = re.sub(r'\s+', ' ', text or '').strip()
    # запятая перед словом — с пробелом («отражателем,с кабелем»), в числах не трогаем («0,5 м»)
    value = re.sub(r',\s*(?=[А-Яа-яЁёA-Za-z])', ', ', value)
    if not value:
        return value
    return value[0].upper() + value[1:]


def compose_code(variant, letter, old_code):
    """21 + '' + '' → «21»; 41 + '' + «03» → «41.03»; 41 + «-У» + «03» → «41.03-У»."""
    code = variant
    if old_code:
        code = f'{variant}.{old_code}' if variant else old_code
    return f'{code}{letter}'


def family_description(member_texts, name, note):
    """Общее описание семьи: самый подробный текст без «Исполнение:» и пометок."""
    text = max(member_texts, key=len, default='')
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    kept = []
    for index, line in enumerate(lines):
        if index == 0:                                  # первая строка — название варианта
            continue
        if line.startswith('Исполнение:') or line.startswith('Вариантов подключения:'):
            continue
        if line.startswith('На странице каталога несколько вариантов'):
            continue
        kept.append(line)
    body = '\n'.join(kept)
    header = f'{name}.\n{note}'
    return f'{header}\n{body}'.strip()


def build_family(family, components):
    by_article = {item['article']: item for item in components}
    members = [by_article[old] for old, _, _, _ in family['members'] if old in by_article]
    if not members:
        return None

    modifications = []
    seen_codes = set()
    sort_order = 0
    for old_article, variant, letter, qualifier in family['members']:
        member = by_article.get(old_article)
        if not member:
            print(f'   ⚠️  нет позиции {old_article} — пропуск')
            continue
        old_mods = member.get('modifications') or []
        if not old_mods:
            code = compose_code(variant, letter, '')
            if code in seen_codes:
                print(f'   ⚠️  код {code} уже есть — исполнение {old_article} пропущено')
                continue
            seen_codes.add(code)
            modifications.append({
                'code': code,
                'full_article': f"{family['article']}-{code}",
                'name': clean_name(qualifier or member['name']),
                'sort_order': sort_order,
            })
            sort_order += 1
            continue
        for mod in old_mods:
            code = compose_code(variant, letter, mod.get('code') or '')
            if code in seen_codes:
                print(f'   ⚠️  код {code} уже есть — {old_article} / {mod.get("code")} пропущен')
                continue
            seen_codes.add(code)
            modifications.append({
                'code': code,
                'full_article': f"{family['article']}-{code}",
                'name': clean_name(mod.get('name')),
                'sort_order': sort_order,
                'images': list(mod.get('images') or []),
            })
            sort_order += 1

    gallery = []
    for member in members:
        gallery.extend(member.get('images') or [])
        if member.get('image'):
            gallery.append(member['image'])
    images = unique_files(gallery)

    description = family_description(
        [member.get('description') or '' for member in members],
        family['name'],
        family['note'],
    )

    # обложка: первое настоящее фото семьи, а не скан страницы каталога
    cover = next((img for member in members for img in member.get('images') or []), None)
    return {
        'category': members[0]['category'],
        'article': family['article'],
        'name': family['name'],
        'description': description,
        'specs': members[0].get('specs') or {},
        'image': cover or members[0].get('image'),
        'source_page': members[0].get('source_page'),
        'supersedes': [old for old, _, _, _ in family['members']],
        'modifications': modifications,
        'images': images,
    }


def main():
    parser = argparse.ArgumentParser(description='Собрать семейства А.3731.018 и А.3731.010')
    parser.add_argument('--dry-run', action='store_true', help='только показать, что изменится')
    args = parser.parse_args()

    config = json.loads(CATALOG_JSON.read_text(encoding='utf-8'))
    components = config['components']

    replace = {}
    for family in FAMILIES:
        entry = build_family(family, components)
        if not entry:
            print(f'⚠️  {family["article"]}: позиции не найдены — пропуск')
            continue
        found = sum(1 for item in components if item['article'] in entry['supersedes'])
        print(f'{family["article"]}: {found} позиций → 1 изделие, '
              f'{len(entry["modifications"])} исполнений, {len(entry["images"])} фото')
        replace[family['article']] = entry

    merged_old = {old for family in FAMILIES for old, _, _, _ in family['members']}
    result, placed = [], set()
    for item in components:
        article = item['article']
        if article in merged_old:
            for family in FAMILIES:
                key = family['article']
                if article in [old for old, _, _, _ in family['members']] and key not in placed and key in replace:
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
                print(f'   {mod["full_article"]:<26} {mod["name"][:74]}')
            print('   фото:', ', '.join(entry['images']))
        return

    config['components'] = result
    CATALOG_JSON.write_text(
        json.dumps(config, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'записано: {CATALOG_JSON}')


if __name__ == '__main__':
    main()
