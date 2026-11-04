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


def page_grid(page):
    """Границы колонок и полосы блоков по векторным линиям."""
    matrix = page.rotation_matrix
    horiz, vert = [], []
    for path in page.get_drawings():
        for item in path['items']:
            if item[0] == 'l':
                a, b = pymupdf.Point(item[1]) * matrix, pymupdf.Point(item[2]) * matrix
                if abs(a.y - b.y) < 0.8:
                    horiz.append((a.y, min(a.x, b.x), max(a.x, b.x)))
                elif abs(a.x - b.x) < 0.8:
                    vert.append((a.x, min(a.y, b.y), max(a.y, b.y)))
            elif item[0] == 're':
                r = pymupdf.Rect(item[1]) * matrix
                horiz += [(r.y0, r.x0, r.x1), (r.y1, r.x0, r.x1)]
                vert += [(r.x0, r.y0, r.y1), (r.x1, r.y0, r.y1)]
    if not horiz or not vert:
        return None, []

    top = min(min(h[0] for h in horiz), min(v[1] for v in vert))
    bottom = max(max(h[0] for h in horiz), max(v[2] for v in vert))
    left = min(min(h[1] for h in horiz), min(v[0] for v in vert))
    right = max(max(h[2] for h in horiz), max(v[0] for v in vert))
    height = bottom - top or 1
    width = right - left or 1

    # колонки — вертикальные линии на всю высоту таблицы
    tall = {}
    for x, y0, y1 in vert:
        tall.setdefault(round(x, 1), []).append((y0, y1))
    columns = []
    for x in sorted(tall):
        covered = sum(max(0.0, b1 - b0) for b0, b1 in tall[x])
        if covered > height * 0.5 and (not columns or x - columns[-1] > 2.0):
            columns.append(x)

    # уровни горизонтальных линий: рамка ячейки — прямоугольник высотой 1 pt,
    # соседние отрезки на одном уровне по X не объединяются
    levels = []
    for y, x0, x1 in sorted(horiz):
        if levels and abs(levels[-1][0] - y) < 2.0:
            levels[-1][1].append((x0, x1))
        else:
            levels.append((y, [(x0, x1)]))

    blocks = [top]
    for y, segs in levels:
        segs.sort()
        merged = [list(segs[0])]
        for x0, x1 in segs[1:]:
            if x0 - merged[-1][1] < 3.0:
                merged[-1][1] = max(merged[-1][1], x1)
            else:
                merged.append([x0, x1])
        if any(x1 - x0 > width * 0.9 and x0 < left + width * 0.05
               for x0, x1 in merged) and y - blocks[-1] > 2.0:
            blocks.append(y)
    return columns, blocks


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


def column_index(spans, columns):
    """Смысл колонок по подписям шапки: 7 подписей — 7 колонок слева направо."""
    labels = []
    for key, label in HEADER_LABELS.items():
        xs = [sp['x'] for sp in spans
              if sp['text'].startswith(label) and sp['y'] < 100]
        if not xs:
            return None
        labels.append((sum(xs) / len(xs), key))
    if len(columns) - 1 != len(labels):
        return None
    return {key: i for i, (_, key) in enumerate(sorted(labels))}


def parse_page(page, columns, col_index):
    spans = page_spans(page)
    _, blocks = page_grid(page)
    if not blocks:
        return []

    def column_of(span):
        for i in range(len(columns) - 1):
            if columns[i] <= span['x'] < columns[i + 1]:
                return i
        return None

    rows = []
    for y0, y1 in zip(blocks, blocks[1:] + [page.rect.height]):
        inside = [sp for sp in spans if y0 + 1 < sp['y'] < y1 - 1]
        if not inside:
            continue
        cells = {}
        for sp in inside:
            idx = column_of(sp)
            if idx is not None:
                cells.setdefault(idx, []).append(sp)

        if col_index['article'] not in cells:
            text = ' '.join(sp['text'] for sp in cells.get(col_index['main'], []))
            if text.strip():
                rows.append({'section': re.sub(r'\s+', ' ', text).strip()})
            continue

        def values(key):
            items = sorted(cells.get(col_index[key], []),
                           key=lambda sp: (round(sp['y'], 1), sp['x']))
            return [re.sub(r'\s+', ' ', sp['text']).strip() for sp in items]

        arts = values('article')
        if arts and arts[0] == HEADER_LABELS['article']:
            continue                                  # шапка таблицы

        names, lengths = values('name'), values('length')
        mains, addls = values('main'), values('addl')
        consumers, formats = values('consumer'), values('format')

        for i, art in enumerate(arts):
            def pick(seq):
                """Значение колонки для исполнения i: ячейка своя или объединённая."""
                if len(seq) == len(arts):
                    return seq[i]
                return ' '.join(seq) if i == 0 else ''

            rows.append({
                'article': art,
                'name': pick(names),
                'length': lengths[i] if len(lengths) == len(arts) and i < len(lengths) else \
                    (' '.join(lengths) if i == 0 else ''),
                'main': pick(mains),
                'addl': pick(addls),
                'consumer': pick(consumers),
                'format': pick(formats),
            })
    return rows


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
    rows, columns, col_index = [], None, None

    for pno in range(doc.page_count):
        page = doc[pno]
        page_columns, _ = page_grid(page)
        if columns is None:
            columns = page_columns
        if col_index is None:
            col_index = column_index(page_spans(page), columns)
        if not columns or col_index is None:
            raise SystemExit('не удалось определить колонки таблицы')
        for row in parse_page(page, columns, col_index):
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
            prev['name'] = (prev['name'] + ' ' + row['name']).strip()
            continue
        if re.match(r'^\d{3}\.', art) and clean and clean[-1]['article'].endswith('-'):
            prev = clean[-1]
            prev['article'] += art
            prev['name'] = (prev['name'] + ' ' + row['name']).strip()
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
        merged = merge_names([v['name'] for v in variants])
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
