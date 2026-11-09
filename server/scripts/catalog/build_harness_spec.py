"""Разбор «Общей спецификации жгутов» (23 страницы, альбомная A4, поворот 90°).

Документ — одна таблица на весь файл:

    Обозначение | Наименование | Длина (L мм) | Основные характеристики |
    Дополнительные характеристики | Основной потребитель | Формат

Особенности, которые пришлось учесть:

* страница повёрнута, поэтому сетка читается из векторных линий
  (`get_drawings`) в координатах отображения; `find_tables` на этих страницах
  отдаёт вложенные строки и перемешивает знаки в артикулах;
* шапка напечатана только на первой странице, остальные продолжают таблицу;
* ячейки «Наименование», «Характеристики» и «Потребитель» объединены на
  несколько исполнений, а колонка «Обозначение» разбита построчно: между
  исполнениями одной семьи линия идёт только под артикулом и длиной, поэтому
  блок строки — это полоса между линиями во всю ширину таблицы;
* артикул бывает разорван: `А.3724.449-712 (А.3724.221-01)` (псевдоним во
  второй строке) и `А.3724.МД- 002.01495-00-09` (перенос внутри артикула).

На выходе — семьи: базовый артикул `А.3724.NNN` и исполнения `код → длина,
потребитель, характеристики`.

Запуск:
    python3 scripts/catalog/build_harness_spec.py "/path/Спецификация.pdf" /tmp/out
"""
import json
import os
import re
import sys
from collections import OrderedDict

import pymupdf

PDF = sys.argv[1] if len(sys.argv) > 1 else \
    '/tmp/arena-coding-uploads/Общая спецификация жгуты АТЛАНТА от 02.10.26.pdf'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/spec'
os.makedirs(OUT, exist_ok=True)

HEADER_LABELS = {
    'article': 'Обозначение',
    'name': 'Наименование',
    'length': 'Длина',
    'main': 'Основные',
    'addl': 'Дополнительные',
    'consumer': 'Основной',
    'format': 'Формат',
}
BASE_RE = re.compile(r'^(А\.3724\.\d{3}|А\.3724\.МД-\d{3}\.\d{5}-\d{2}-\d{2})(?:-(.+))?$')


def table_grid(page):
    """Ячейки таблицы в координатах отображения (модуль уже разворачивает поворот)."""
    try:
        tables = page.find_tables()
    except Exception:                                   # noqa: BLE001 — битый разбор
        return None
    if not tables.tables:
        return None
    table = tables.tables[0]
    cells = [pymupdf.Rect(c) for c in table.cells if c]
    if not cells:
        return None

    width = max(r.x1 for r in cells) - min(r.x0 for r in cells)
    borders = []
    for x in sorted({round(r.x0, 1) for r in cells} | {round(r.x1, 1) for r in cells}):
        if not borders or x - borders[-1] > 2.0:
            borders.append(x)
    wide = [r for r in cells if r.width > width * 0.9]
    narrow = [r for r in cells if r.width <= width * 0.9]
    return {'cells': narrow, 'sections': wide, 'borders': borders}


def page_spans(page):
    matrix = page.rotation_matrix
    spans = []
    for block in page.get_text('dict')['blocks']:
        if block['type'] != 0:
            continue
        for line in block.get('lines', []):
            for span in line['spans']:
                if not span['text'].strip():
                    continue
                rect = pymupdf.Rect(span['bbox']) * matrix
                spans.append({'x': (rect.x0 + rect.x1) / 2,
                              'y': (rect.y0 + rect.y1) / 2,
                              'text': span['text'].strip()})
    return spans


def column_index(spans, borders):
    """Смысл колонок по подписям шапки: 7 подписей — 7 колонок слева направо."""
    labels = []
    for key, label in HEADER_LABELS.items():
        xs = [sp['x'] for sp in spans
              if sp['text'].startswith(label) and sp['y'] < 100]
        if not xs:
            return None
        labels.append((sum(xs) / len(xs), key))
    if len(labels) != len(borders) - 1:
        return None
    return {key: i for i, (_, key) in enumerate(sorted(labels))}


def column_of(x, borders):
    for i in range(len(borders) - 1):
        if borders[i] <= x < borders[i + 1]:
            return i
    return None


def cell_lines(spans, rect):
    """Строки текста внутри ячейки, сверху вниз."""
    inside = sorted((sp for sp in spans
                     if rect.y0 <= sp['y'] <= rect.y1 and rect.x0 - 1 <= sp['x'] <= rect.x1 + 1),
                    key=lambda sp: (round(sp['y'], 1), sp['x']))
    lines, current = [], None
    for sp in inside:
        if current is None or abs(sp['y'] - current) > 4.0:
            lines.append([sp['text']])
            current = sp['y']
        else:
            lines[-1].append(sp['text'])
    return [re.sub(r'\s+', ' ', ' '.join(parts)).strip() for parts in lines]


def join_lines(lines):
    """Склейка строк одной ячейки: перенос артикула, перечисление через запятую."""
    out = ''
    for line in lines:
        if not out:
            out = line
        elif out.endswith(('-', '/', ',', '(')):
            out += line
        else:
            out += ' ' + line
    return re.sub(r'\s+', ' ', out).strip()


def parse_page(page, borders, col_index):
    grid = table_grid(page)
    if not grid:
        return []
    spans = page_spans(page)
    cells = grid['cells']
    width = max(r.x1 for r in cells) - min(r.x0 for r in cells)

    art_col = col_index['article']
    by_column = {}
    for rect in cells:
        idx = column_of((rect.x0 + rect.x1) / 2, borders)
        if idx is not None:
            by_column.setdefault(idx, []).append(rect)

    art_cells = sorted(by_column.get(art_col, []), key=lambda r: r.y0)
    art_texts = [join_lines(cell_lines(spans, r)) for r in art_cells]
    keep = [i for i, text in enumerate(art_texts)
            if text and not text.startswith(HEADER_LABELS['article'])]
    art_cells = [art_cells[i] for i in keep]
    art_texts = [art_texts[i] for i in keep]

    rows = [{'article': text, 'y0': r.y0, 'y1': r.y1}
            for r, text in zip(art_cells, art_texts)]
    if not rows:
        return []

    def spanned(rect):
        return [i for i, row in enumerate(rows)
                if rect.y0 < row['y1'] - 1 and rect.y1 > row['y0'] + 1]

    for key, idx in col_index.items():
        if key == 'article':
            continue
        for rect in sorted(by_column.get(idx, []), key=lambda r: r.y0):
            targets = spanned(rect)
            if not targets:
                continue                                # ячейка шапки
            lines = [ln for ln in cell_lines(spans, rect) if ln]
            if not lines:
                continue
            if len(lines) == len(targets) > 1:
                for row_idx, line in zip(targets, lines):
                    rows[row_idx][key] = line if not rows[row_idx].get(key) \
                        else rows[row_idx][key] + ' ' + line
            else:
                rows[targets[0]][key] = join_lines(lines)

    for key in ('name', 'length', 'main', 'addl', 'consumer', 'format'):
        for row in rows:
            row.setdefault(key, '')

    parsed = []
    sections = sorted((r for r in grid['sections'] if r.width > width * 0.9),
                      key=lambda r: r.y0)
    events = [(r.y0, 's', r) for r in sections] + [(r['y0'], 'r', r) for r in rows]
    for _, kind, item in sorted(events, key=lambda e: e[0]):
        if kind == 's':
            text = join_lines(cell_lines(spans, item))
            if text and not text.startswith(HEADER_LABELS['article']):
                parsed.append({'section': text})
            continue
        item = dict(item)
        item.pop('y0', None)
        item.pop('y1', None)
        parsed.append(item)
    return parsed


def split_alias(article):
    """`А.3724.449-712 (А.3724.221-01)` → артикул и псевдоним из скобок."""
    m = re.match(r'^([^()]+?)\s*\(([^()]+)\)$', article)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return article, ''


def tidy_article(text):
    text = text.replace('\u00ad', '')
    text = re.sub(r'\s*-\s*', '-', text)
    return re.sub(r'\s+', ' ', text).strip()


def parse_document(path):
    doc = pymupdf.open(path)
    rows, borders, col_index = [], None, None

    for pno in range(doc.page_count):
        page = doc[pno]
        if borders is None:
            grid = table_grid(page)
            if not grid:
                raise SystemExit(f'таблица не найдена (стр. {pno + 1})')
            borders = grid['borders']
            col_index = column_index(page_spans(page), borders)
            if col_index is None:
                raise SystemExit('не удалось прочитать шапку таблицы')

        for row in parse_page(page, borders, col_index):
            row['page'] = pno + 1
            rows.append(row)

    # склейка разорванных артикулов
    clean = []
    for row in rows:
        if 'section' in row:
            clean.append(row)
            continue
        art = tidy_article(row['article'])

        if art.startswith('(') and clean and BASE_RE.match(clean[-1]['article']):
            prev = clean[-1]
            prev['article'] = f"{prev['article']} {art}"
            continue
        if re.match(r'^\d{3}\.', art) and clean and clean[-1]['article'].endswith('-'):
            prev = clean[-1]
            prev['article'] += art
            continue

        row['article'], row['alias'] = split_alias(art)
        clean.append(row)
    return clean


def merge_names(names):
    """Склейка названия, разорванного между исполнениями.

    «Жгут переходник (розетка-» + «вилка)» — продолжение видно по дефису,
    открывающей скобке или строчной букве в начале.
    """
    merged = []
    for name in names:
        if not name:
            continue
        if merged and (merged[-1].endswith(('-', '(', '/', ',')) or name[:1].islower()):
            merged[-1] = merged[-1] + ' ' + name
        else:
            merged.append(name)
    return merged


def assign_names(variants):
    """Раскладывает объединённую ячейку «Наименование» по исполнениям.

    Возвращает список названий по группам строк; каждому исполнению достаётся
    название его группы (у объединённой ячейки — одно на несколько строк).
    """
    groups = []
    for i, variant in enumerate(variants):
        name = (variant.get('name') or '').strip()
        if not name:
            continue
        if groups and (groups[-1][1].endswith(('-', '(', '/', ',')) or name[:1].islower()):
            groups[-1][1] += ' ' + name
        else:
            groups.append([i, name])

    group_idx = -1
    for i, variant in enumerate(variants):
        if group_idx + 1 < len(groups) and groups[group_idx + 1][0] == i:
            group_idx += 1
        variant['label'] = groups[group_idx][1] if group_idx >= 0 else ''
    return [name for _, name in groups]


def build_families(rows):
    """Семья: базовый артикул + исполнения. Название и характеристики — по семье."""
    families = OrderedDict()
    section = None

    for row in rows:
        if 'section' in row:
            section = row['section']
            continue
        match = BASE_RE.match(row['article'])
        if not match:
            continue
        base, code = match.group(1), match.group(2) or ''

        fam = families.setdefault(base, {'base': base, 'section': section, 'variants': []})
        if any(v['code'] == code for v in fam['variants'] if code):
            continue                                   # повтор после чистки

        fam['variants'].append({
            'code': code,
            'article': row['article'],
            'name': row['name'],
            'length': row['length'],
            'main': row['main'],
            'addl': row['addl'],
            'consumer': row['consumer'],
            'format': row['format'],
            'alias': row.get('alias', ''),
            'page': row['page'],
        })

    for fam in families.values():
        variants = fam['variants']
        merged = assign_names(variants)
        fam['names'] = merged
        names = [n for n in merged if len(n) > 3]
        fam['name'] = max(names, key=len) if names else ''
        fam['main'] = next((v['main'] for v in variants if v['main']), '')
        fam['addl'] = next((v['addl'] for v in variants if v['addl']), '')
        fam['page'] = variants[0]['page']
        fam['consumers'] = sorted({v['consumer'] for v in variants if v['consumer']})
        for v in variants:
            v.pop('name', None)
    return list(families.values())


def main():
    rows = parse_document(PDF)
    families = build_families(rows)
    skipped = [r for r in rows if 'article' in r and not BASE_RE.match(r['article'])]

    json.dump({'families': families, 'skipped': skipped, 'rows': len(rows)},
              open(os.path.join(OUT, 'harness_spec.json'), 'w'), ensure_ascii=False, indent=1)

    total = sum(len(f['variants']) for f in families)
    print(f'строк: {len(rows)}, семейств: {len(families)}, исполнений: {total}, '
          f'не разобрано: {len(skipped)}')
    for fam in families:
        print(f"  {fam['base']:12} {len(fam['variants']):2} исп. | {fam['name'][:58]}")
    for row in skipped:
        print('  ПРОПУСК:', row['page'], row['article'], row['name'][:40])


if __name__ == '__main__':
    main()
