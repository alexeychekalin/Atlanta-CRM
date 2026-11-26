"""Габаритные фонари: изделие по стороне установки (перед / зад / бок).

Менеджеры просят искать фонарь по стороне: раньше «А.3731.010» — это одно
изделие с 28 исполнениями, где сторона спрятана в первой цифре кода
(01 — перед, 02 — зад, 03 — бок). Скрипт делит такие семейства на отдельные
изделия, артикулы — как в печатном каталоге АТЛАНТА-26:

    было:  А.3731.010 + 28 исполнений (01.09, 02.09, 03.09, … 03.04-Т)
    стало: А.3731.010-01 (8), А.3731.010-02 (8), А.3731.010-03 (12)

У семейств, где сторона уже была отдельным артикулом, она становится
изделием с тем же печатным номером: А.3731.023.1 / .2 / .3,
А.3731.027-01 / -02 / -03, А.3731.018-21 (перед) и -23 (бок).

Что важно сохранить:

* исполнения не пересобираются: код исполнения остаётся прежним, печатный
  артикул пишется в full_article (склейка «изделие-код» дала бы лишний дефис:
  А.3731.010-01 + 01.09 = А.3731.010-01-01.09);
* число исполнений не меняется — 1003 (у А.3731.018 базовые варианты -21/-23
  остаются строкой в таблице исполнений, иначе их артикулы пропали бы);
* прежний артикул семейства уходит в families[] — сайт строит по нему
  обзорную страницу со ссылками на три стороны, старые ссылки не дают 404;
* прежние плоские артикулы попадают в supersedes той стороны, которой они
  принадлежат (А.3731.010-О → А.3731.010-03), импорт их погасит;
* фотографии семейства раскладываются по сторонам: снимки с явной пометкой
  в имени (a-3731-023-1 — перед) идут на свою сторону первой группой, фото
  без пометки остаются у всех — ничего не теряется.

Стороны: только перед/зад/бок. Левый/правый (задние фонари) не трогаем,
А.3731.006 не делим, .002.1/.005 (01/02/04 — подключение) и .007 — тоже.

Запуск из корня репозитория:

    python3 server/scripts/catalog/split_marker_sides.py --dry-run
    python3 server/scripts/catalog/split_marker_sides.py
"""
import argparse
import json
import re
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG_JSON = ROOT / 'src' / 'db' / 'catalog' / 'catalog.json'

SIDE_WORDS = {'front': 'передний', 'rear': 'задний', 'side': 'боковой'}
SIDE_COLORS = {'front': 'белый', 'rear': 'красный', 'side': 'автожелтый'}
SIDE_ORDER = ('front', 'rear', 'side')

# подключение — из печатного каталога, одинаково для всех сторон семейства
CONNECT_FULL = ('Способы подключения: 03/04 — провод с открытым концом, 23/24 — '
                'соединитель А.3723.001, 63/64 — вилка А.3723.006 (АМР 282104), '
                '09/10 — разъём АМР 282104 на корпусе; вторая цифра пары: '
                'с кронштейном / без кронштейна.')
CONNECT_6 = ('Способы подключения: 04 — провод с открытым концом, 24 — соединитель '
             'А.3723.001, 64 — вилка А.3723.006 (АМР 282104), кабель 0,5 м.')
CONNECT_3 = ('Способы подключения: 03 — провод с открытым концом, 23 — соединитель '
             'А.3723.001, 63 — вилка А.3723.006 (АМР 282104), кабель 0,5 м.')

FAMILIES = [
    {
        'article': 'А.3731.010',
        'sides': {'front': '-01', 'rear': '-02', 'side': '-03'},
        'lead': 'с отражателем',
        'connect': CONNECT_FULL,
        'side_note': {'side': 'Буква в артикуле: -Т — кронштейн на трубу, '
                              '-О — кронштейн на обечайку.'},
        'markers': {},
        'supersedes': {
            'front': [],
            'rear': [],
            'side': ['А.3731.010-О', 'А.3731.010-Т'],
        },
    },
    {
        'article': 'А.3731.012',
        'sides': {'front': '-01', 'rear': '-02', 'side': '-03'},
        'lead': '',
        'connect': CONNECT_FULL,
        'markers': {},
        'supersedes': {},
    },
    {
        'article': 'А.3731.013',
        'sides': {'front': '-01', 'rear': '-02', 'side': '-03'},
        'lead': '',
        'connect': CONNECT_FULL,
        'markers': {},
        'supersedes': {},
    },
    {
        'article': 'А.3731.014',
        'sides': {'front': '-01', 'rear': '-02', 'side': '-03'},
        'lead': '',
        'connect': CONNECT_6,
        'markers': {},
        'supersedes': {},
    },
    {
        'article': 'А.3731.015',
        'sides': {'front': '-01', 'rear': '-02', 'side': '-03'},
        'lead': '',
        'connect': CONNECT_6,
        'markers': {},
        'supersedes': {},
    },
    {
        'article': 'А.3731.016',
        'sides': {'front': '-01', 'rear': '-02'},
        'lead': '',
        'connect': CONNECT_6,
        'markers': {},
        'supersedes': {},
    },
    {
        'article': 'А.3731.017',
        'sides': {'front': '-01', 'rear': '-02'},
        'lead': '',
        'connect': CONNECT_6,
        'markers': {},
        'supersedes': {},
    },
    {
        'article': 'А.3731.019',
        'sides': {'front': '-01', 'rear': '-02', 'side': '-03'},
        'lead': '',
        'connect': CONNECT_FULL,
        'markers': {},
        'supersedes': {},
    },
    {
        'article': 'А.3731.020',
        'sides': {'front': '-01', 'side': '-03'},
        'lead': 'с отражателем',
        'connect': CONNECT_3,
        'markers': {},
        'supersedes': {},
    },
    {
        'article': 'А.3731.023',
        'sides': {'front': '.1', 'rear': '.2', 'side': '.3'},
        'lead': 'с отражателем',
        'connect': ('Кронштейн — стандартная рама, прямой или угловой. Способы '
                    'подключения: провод без разъёма, соединитель А.3723.001 '
                    '(быстрый обжим), вилка А.3723.006 (АМР 282104).'),
        'markers': {'front': ['a-3731-023-1'], 'rear': ['a-3731-023-2'], 'side': ['a-3731-023-3']},
        'supersedes': {},
    },
    {
        'article': 'А.3731.025',
        'sides': {'front': '.1', 'rear': '.2', 'side': '.3'},
        'lead': 'с отражателем',
        'connect': ('Кронштейн — стандартная рама или угловой. Способы подключения: '
                    'провод без разъёма, соединитель А.3723.001, вилка А.3723.006 '
                    '(АМР 282104).'),
        'markers': {'front': ['a-3731-025-1'], 'rear': ['a-3731-025-2'], 'side': ['a-3731-025-3']},
        'supersedes': {},
    },
    {
        'article': 'А.3731.026',
        'sides': {'front': '.1', 'rear': '.2'},
        'lead': '',
        'connect': ('Способы подключения: провод без разъёма, соединитель А.3723.001, '
                    'вилка А.3723.006 (АМР 282104); длина кабеля 0,5 или 1,5 м.'),
        'markers': {'front': ['a-3731-026-1'], 'rear': ['a-3731-026-2']},
        'supersedes': {},
    },
    {
        'article': 'А.3731.027',
        'sides': {'front': '-01', 'rear': '-02', 'side': '-03'},
        'lead': 'с отражателем',
        'connect': ('Способы подключения: провод без разъёма, соединитель А.3723.001 '
                    'или А.3723.002, вилка А.3723.006 (АМР 282104) или розетка '
                    'А.3723.007 (АМР 282080); длина кабеля 50–1500 мм.'),
        'markers': {'front': ['a-3731-027-01'], 'rear': ['a-3731-027-02'],
                    'side': ['a-3731-027-03']},
        'supersedes': {},
    },
    {
        'article': 'А.3731.018',
        'sides': {'front': '-21', 'side': '-23'},
        'lead': 'с отражателем',
        'connect': {
            'front': ('Вариант -21 — разъём на корпусе, -41 — с кабелем. Способы подключения '
                      'после точки: 03 — провод с открытым концом, 23 — соединитель А.3723.001 '
                      '(быстрый монтаж), 63 — вилка А.3723.006 (АМР 282104), кабель 0,5 м.'),
            'side': ('Вариант -23 — разъём на корпусе, -43 — с кабелем. Способы подключения '
                     'после точки: 03 — провод с открытым концом, 23 — соединитель А.3723.001 '
                     '(быстрый монтаж), 63 — вилка А.3723.006 (АМР 282104), кабель 0,5 м.'),
        },
        'side_note': {'front': 'Буква в артикуле: -У — универсальный кронштейн.',
                      'side': 'Буквы в артикуле: -У — универсальный кронштейн, '
                              '-О — кронштейн на обечайку.'},
        'markers': {
            'front': ['a-3731-018-21', 'a-3731-018-41'],
            'side': ['a-3731-018-23', 'a-3731-018-43'],
        },
        # базовый вариант стороны остаётся строкой исполнений: без него
        # артикул А.3731.018-21 / -23 пропал бы из таблицы
        'base_rows': {'front': '21', 'side': '23'},
        'code_sides': {'21': 'front', '41': 'front', '23': 'side', '43': 'side'},
        'supersedes': {
            'front': ['А.3731.018-41', 'А.3731.018-41-У'],
            'side': ['А.3731.018-43', 'А.3731.018-43-У', 'А.3731.018-23-О', 'А.3731.018-43-О'],
        },
    },
]

# Обложка по стороне: в выгрузке поставщика снимки не подписаны стороной,
# поэтому нужный кадр выбирается по цвету рассеивателя — белый/передний,
# красный/задний, автожелтый/боковой. Если кадра нужного цвета нет,
# обложкой остаётся первый снимок семейства (галерея при этом полная).
COVERS = {
    'А.3731.010': {'front': 'a-3731-010_745e0da9e57d.jpg',
                   'rear': 'a-3731-010_5964b8eaa427.jpg',
                   'side': 'a-3731-010_139cad71556e.jpg'},
    'А.3731.012': {'front': 'a-3731-012_ab9aa076b513.jpg',
                   'rear': 'a-3731-012_881a9fa779b4.jpg',
                   'side': 'a-3731-012_47d7e1a74303.jpg'},
    'А.3731.013': {'front': 'a-3731-013_991133da0a76.jpg',
                   'rear': 'a-3731-013_a15b2d18ad61.jpg'},
    'А.3731.014': {'front': 'a-3731-014_7dc708655d71.jpg',
                   'rear': 'a-3731-014_f3ce8d4b9521.jpg',
                   'side': 'a-3731-014_47826334ba72.jpg'},
    'А.3731.015': {'front': 'a-3731-015_b79f8146110d.jpg'},
    'А.3731.016': {'front': 'a-3731-016_a6a853a5e4eb.jpg',
                   'rear': 'a-3731-016_1f288bd0ded1.jpg'},
    'А.3731.017': {'front': 'a-3731-017_75eb9128deb0.jpg',
                   'rear': 'a-3731-017.jpeg'},
    'А.3731.019': {'front': 'a-3731-019_8534307b3d30.jpg',
                   'rear': 'a-3731-019_2eca7087e4d6.jpg',
                   'side': 'a-3731-019_60f49ce95b70.jpg'},
    'А.3731.020': {'front': 'a-3731-020_aa7aa79d71f6.jpg',
                   'side': 'a-3731-020_003ab3c5a4fb.jpg'},
    'А.3731.027': {'front': 'a-3731-027-01_fb97a70fbd33.jpg',
                   'rear': 'a-3731-027-01_52363d13e7e5.jpg',
                   'side': 'a-3731-027-01_2f0daac25d19.jpg'},
    'А.3731.023': {'front': 'a-3731-023-1_099f62d1e384.jpg',
                   'rear': 'a-3731-023-3_8e703d10a3dc.jpg',
                   'side': 'a-3731-023-1_c2db25b931e0.jpg'},
    'А.3731.018': {'front': 'a-3731-018-21_89b2d2be33e8.jpg',
                   'side': 'a-3731-018-43-o.jpeg'},
}


# обычная нумерация каталога: 01 — перед, 02 — зад, 03 — бок (01.09, 2-01.00-150)
DEFAULT_CODE_SIDES = {'01': 'front', '1': 'front',
                      '02': 'rear', '2': 'rear',
                      '03': 'side', '3': 'side'}


def code_side(code, family=None):
    """Сторона по коду исполнения. У А.3731.018 своя нумерация: 21/41 — перед, 23/43 — бок."""
    head = re.split(r'[.\-]', str(code or '').strip())[0]
    table = (family or {}).get('code_sides') or DEFAULT_CODE_SIDES
    return table.get(head)


def split_description(component, mods, side, family):
    """Описание изделия по стороне: без «исполнение задаётся цветом…», с легендой подключения."""
    lines = [line for line in (component.get('description') or '').split('\n') if line.strip()]
    name = f"{component['name']} — {SIDE_WORDS[side]}"
    head = f'{name}.'
    lead = f"{SIDE_WORDS[side].capitalize()} габаритный огонь{(' ' + family['lead']) if family.get('lead') else ''}, " \
           f"{SIDE_COLORS[side]} рассеиватель."
    connect = family['connect'][side] if isinstance(family.get('connect'), dict) else family.get('connect')
    side_paragraph = f'{lead} {connect or ""}'.strip()
    note = family.get('side_note')
    if isinstance(note, dict):
        note = note.get(side)
    if note:
        side_paragraph += ' ' + note

    out = [head, side_paragraph]
    for line in lines[1:]:
        if line.startswith('Исполнение задаётся'):
            continue
        if line.startswith('Функции:'):
            out.append(side_functions_line(component, side))
            continue
        if line.startswith('Мощность:'):
            filtered = side_power_line(component, side)
            if filtered:
                out.append(filtered)
            continue
        if line.startswith('Вариантов подключения:'):
            out.append(f'Вариантов подключения: {len(mods)}.')
            continue
        out.append(line)
    return '\n'.join(out)


def _side_ok(text, side):
    """Строка про свою сторону или общая (без упоминания сторон)."""
    low = str(text or '').lower()
    mentioned = [key for key, word in SIDE_WORDS.items() if word in low]
    return not mentioned or side in mentioned


def side_functions_line(component, side):
    functions = (component.get('specs') or {}).get('functions') or []
    kept = [item for item in functions if _side_ok(item, side)]
    if not kept:
        kept = [f'Свет {SIDE_WORDS[side]} габаритный']
    return 'Функции: ' + ', '.join(kept) + '.'


def side_power_line(component, side):
    power = (component.get('specs') or {}).get('power') or []
    if not isinstance(power, list) or not power:
        return None
    kept = [item for item in power if _side_ok(item, side)]
    if not kept:
        return None
    return 'Мощность: ' + '; '.join(kept) + '.'


def side_specs(component, side):
    specs = deepcopy(component.get('specs') or {})
    if isinstance(specs.get('functions'), list):
        specs['functions'] = [item for item in specs['functions'] if _side_ok(item, side)]
    if isinstance(specs.get('power'), list):
        specs['power'] = [item for item in specs['power'] if _side_ok(item, side)]
    return specs


def build_gallery(component, side, family, article):
    """Фото стороны: свои (по пометке в имени) → без пометки → чужие, но ничего не теряем."""
    images = list(component.get('images') or [])
    if not images and component.get('image'):
        images = [component['image']]
    markers = family.get('markers') or {}
    own, common, other = [], [], []
    for name in images:
        low = name.lower()
        owner = next((key for key in SIDE_ORDER
                      if any(low.startswith(marker) for marker in markers.get(key, []))), None)
        if owner == side:
            own.append(name)
        elif owner is None:
            common.append(name)
        else:
            other.append(name)
    gallery = own + common + other
    if not gallery:
        return [], None
    cover = (COVERS.get(component['article']) or {}).get(side)
    if cover not in gallery:
        cover = gallery[0]
    # выбранный кадр — первым: по нему строится обложка карточки
    gallery = [cover] + [name for name in gallery if name != cover]
    return gallery, cover


def split_family(component, family, children_by_side):
    """Новые компоненты семьи: по одному на сторону."""
    result = []
    images = list(component.get('images') or [])
    mods = list(component.get('modifications') or [])
    for side, article in children_by_side.items():
        own_mods = [mod for mod in mods if code_side(mod.get('code'), family) == side]
        base_code = (family.get('base_rows') or {}).get(side)
        if base_code:
            # строка «разъём на корпусе»: печатный артикул совпадает с изделием
            base = next(mod for mod in mods if mod.get('code') == base_code)
            own_mods = [base] + [mod for mod in own_mods if mod is not base]
        if not own_mods:
            raise SystemExit(f'{component["article"]}: нет исполнений для стороны {side}')
        for mod in own_mods:
            mod['full_article'] = mod.get('full_article') or f'{component["article"]}-{mod["code"]}'
        gallery, cover = build_gallery(component, side, family, article)
        child = {
            'category': component['category'],
            'article': article,
            'name': f"{component['name']} — {SIDE_WORDS[side]}",
            'description': split_description(component, own_mods, side, family),
            'specs': side_specs(component, side),
            'image': cover,
            'source_page': component.get('source_page'),
            'modifications': own_mods,
            'images': gallery,
            'side': side,
            'split_from': component['article'],
            'supersedes': list((family.get('supersedes') or {}).get(side) or []),
        }
        if component.get('gisp_url'):
            child['gisp_url'] = component['gisp_url']
        result.append(child)
    return result


def main():
    parser = argparse.ArgumentParser(description='Габаритные фонари: изделие на каждую сторону')
    parser.add_argument('--dry-run', action='store_true', help='только отчёт, файл не менять')
    args = parser.parse_args()

    data = json.loads(CATALOG_JSON.read_text(encoding='utf-8'))
    components = data['components']
    by_article = {item['article']: item for item in components}

    families = data.setdefault('families', [])
    known = {item['article'] for item in families}
    total_children = 0
    total_mods_before, total_mods_after = 0, 0

    out = []
    for component in components:
        family = next((item for item in FAMILIES if item['article'] == component['article']), None)
        if family is None:
            out.append(component)
            continue

        if component['article'] in known:
            # скрипт уже отработал: семейство разделено, дети на месте
            out.append(component)
            continue

        total_mods_before += len(component.get('modifications') or [])
        children_by_side = {}
        for side, suffix in family['sides'].items():
            article = component['article'] + suffix
            if article in by_article:
                raise SystemExit(f'{article}: такой артикул уже есть в каталоге')
            children_by_side[side] = article
        children = split_family(component, family, children_by_side)
        total_children += len(children)
        total_mods_after += sum(len(child['modifications']) for child in children)

        # прежний артикул семейства объявляем первым изделием: импорт погасит
        # его и подпишет, что позиция разделена по стороне
        children[0].setdefault('supersedes', [])
        if component['article'] not in children[0]['supersedes']:
            children[0]['supersedes'].insert(0, component['article'])
        children[0]['supersedes_note'] = 'разделён по стороне'

        if component['article'] not in known:
            record = {key: deepcopy(value) for key, value in component.items()
                      if key not in ('modifications',)}
            record['children'] = [child['article'] for child in children]
            # какие исполнения ушли какой стороне: по этой карте миграция
            # переносит цены и правки из прежнего изделия в базе
            record['codes'] = {child['article']: [mod['code'] for mod in child['modifications']]
                               for child in children}
            record['sides'] = list(family['sides'])
            families.append(record)
            known.add(component['article'])

        print(f"{component['article']}: {len(component.get('modifications') or [])} исп. → "
              + ', '.join(f"{child['article']} ({len(child['modifications'])})" for child in children))
        out.extend(children)

    data['components'] = out

    print(f'\nпозиций: {len(components)} → {len(out)} (новых изделий {total_children})')
    print(f'исполнений: {total_mods_before} → {total_mods_after} '
          f'{"✅" if total_mods_before == total_mods_after else "❌ число изменилось"}')
    print(f'семейств в families: {len(families)}')

    if args.dry_run:
        print('\nпробный прогон: catalog.json не изменён')
        return

    CATALOG_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'\nзаписано: {CATALOG_JSON.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
