"""Импорт фотографий изделий в каталог.

Источник — дерево каталогов от поставщика (выгрузка с диска):

    Габаритные фонари/А.3731.010/01/А.3731.010-01 один.HEIC
    Габаритные фонари/А.3731.010/А.3731.010-01.02.03 маркер на 75.png
    Задние фонари/А.3731.015/А.3731.015-02/фото.jpg

Правила разбора пути:

* опорная папка — ближайшая к файлу папка, совпадающая с артикулом каталога;
* если точного артикула нет (`А.3731.018`), фото достаются всем позициям,
  начинающимся с него (`А.3731.018-21`, `А.3731.018-23`), но не больше
  четырёх — иначе это уже не уточнение, а совпадение по префиксу;
* подпапка, совпадающая с кодом исполнения (`01.02`), кладёт фото в это
  исполнение; любая другая подпапка — просто набор снимков изделия;
* снимки изделия идут в галерею позиции (`images`), первый становится
  обложкой; прежний скан из PDF при этом сохраняется у исполнения.

Что делает с файлами:

* переводит HEIC (снимки с iPhone), PNG, WEBP в JPEG — браузеры HEIC не умеют;
* ужимает длинную сторону до 1600 px и убирает EXIF (в телефоне там координаты);
* кладёт файлы в `src/db/catalog/files/` под стабильным именем (хэш содержимого),
  поэтому повторный прогон не создаёт копий.

Запуск:
    python3 scripts/catalog/import_photos.py /path/to/photos            # записать
    python3 scripts/catalog/import_photos.py /path/to/photos --dry-run  # только отчёт
"""
import hashlib
import io
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:                                   # pragma: no cover
    sys.exit('нужны pillow и pillow-heif: pip install pillow pillow-heif')

CATALOG_DIR = Path(__file__).resolve().parents[2] / 'src' / 'db' / 'catalog'
FILES_DIR = CATALOG_DIR / 'files'
CATALOG_JSON = CATALOG_DIR / 'catalog.json'

IMAGE_EXT = {'.heic', '.heif', '.jpg', '.jpeg', '.png', '.webp', '.bmp'}
MAX_SIDE = 1600
JPEG_QUALITY = 86
MAX_PHOTOS = 10                       # больше десяти снимков одной позиции не нужно

ARTICLE_RE = re.compile(
    r'[АA]\.\s*\d{4}\.\s*\d{3}(?:\.\d)?(?:-[А-ЯA-Z]{1,2})?', re.IGNORECASE)
CODE_RE = re.compile(r'^\d{1,2}(?:[.\-]\d{1,2}){0,3}$')


def normalize_article(text):
    """«A.3731.010» (латинская A, пробелы) → «А.3731.010» как в каталоге."""
    text = re.sub(r'\s+', '', text or '')
    text = re.sub(r'^[Aa]', 'А', text)
    return text


def key(text):
    """Ключ сверки: без регистра, латинская A приравнена к кириллической."""
    return normalize_article(text).lower().replace('a', 'а')


def slug(article, code=''):
    out = article.lower().replace('а', 'a').replace('.', '-')
    out = re.sub(r'[^a-z0-9\-]+', '-', out).strip('-')
    if code:
        out += '-' + re.sub(r'[^0-9a-zA-Z]+', '-', code).strip('-').lower()
    return out


class Catalog:
    def __init__(self, path=CATALOG_JSON):
        self.path = Path(path)
        self.data = json.loads(self.path.read_text(encoding='utf-8'))
        self.components = self.data['components']
        self.by_key = {}
        for entry in self.components:
            self.by_key[key(entry['article'])] = entry

    def resolve(self, folder, hint=''):
        """Артикул папки → позиции каталога.

        Точное совпадение — одна позиция. Если такого артикула нет
        (А.3731.018, А.3776.005), фото достаются вариантам серии: подпапка
        с номером уточняет вариант (А.3731.002/1 → А.3731.002.1), а
        производные с лишним суффиксом (А.3731.018-21-У) не дублируются,
        если есть их базовый артикул.
        """
        article = normalize_article(folder)
        exact = self.by_key.get(key(article))
        if exact:
            return [exact]

        prefix = key(article)
        variants = []
        for entry in self.components:
            rest = key(entry['article'])[len(prefix):]
            if not key(entry['article']).startswith(prefix):
                continue
            # продолжение артикула: «.1», «-21», «Л» — но не «.123» и не «10»
            if rest and (rest[0] in '.-/лп' or not rest[0].isdigit()):
                variants.append(entry)
        singles = [entry for entry in variants if '/' not in entry['article']]
        if singles:                                    # комплекты оставляем в стороне
            variants = singles
        if not variants:
            return []

        hint = (hint or '').strip().lower()
        if hint:
            narrowed = [entry for entry in variants
                        if key(entry['article']).split(prefix, 1)[-1].lstrip('.-') == hint]
            if narrowed:
                variants = narrowed

        by_base = {}
        for entry in variants:
            base = re.sub(r'-[А-ЯA-Z]{1,2}(-У)?$', '', entry['article'])
            by_base.setdefault(key(base), []).append(entry)
        picked = [min(group, key=lambda e: (len(e['article']), e['article']))
                  for group in by_base.values()]
        return picked if 0 < len(picked) <= 4 else []

    def resolve_modification_article(self, article):
        """Артикул с кодом исполнения → (позиция, код), если такая связка есть."""
        article = normalize_article(article)
        best = None
        for entry in self.components:
            base = entry['article']
            if not article.lower().startswith(base.lower() + '-'):
                continue
            if best is not None and len(base) <= len(best['article']):
                continue
            code = article[len(base) + 1:]
            mod = self.modification(entry, code)
            if mod is None:
                # код группы: «-01» при исполнениях «01.01», «01.02» — берём первое
                group = [m for m in entry.get('modifications') or []
                         if m['code'].lower().startswith(code.lower() + '.')]
                mod = group[0] if group else None
            if mod is not None:
                best, best_code = entry, mod['code']
        return (best, best_code) if best else (None, '')

    def modification(self, entry, code):
        code = (code or '').strip().lower()
        if not code:
            return None
        for mod in entry.get('modifications') or []:
            if mod['code'].lower() == code:
                return mod
        return None

    def save(self):
        self.path.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def parse_name(stem):
    """Артикул и код исполнения из имени файла: «А.3731.018-01 два.jpg»."""
    match = ARTICLE_RE.search(stem)
    if not match:
        return '', ''
    article = normalize_article(match.group(0))
    tail = stem[match.end():]
    code_match = re.match(r'\s*-\s*(\d{1,2}(?:[.\-]\d{1,2}){0,3})', tail)
    code = code_match.group(1).replace('-', '.') if code_match else ''
    return article, code


def parse_path(file_path, root, catalog):
    """Позиции каталога, к которым относится файл, и код исполнения из пути."""
    parts = list(file_path.relative_to(root).parts[:-1])
    for index in range(len(parts) - 1, -1, -1):
        rest = parts[index + 1:]
        hint = rest[0] if len(rest) == 1 else ''
        entries = catalog.resolve(parts[index], hint)
        if not entries:
            continue
        code = ''
        for part in reversed(rest):
            if CODE_RE.fullmatch(part.strip()):
                code = part.strip().replace('-', '.')
                break
        return entries, code
    return [], ''


def ink_ratio(source):
    """Доля тёмных пикселей: у чертежа на белом это единицы процентов, у фото — десятки."""
    try:
        with Image.open(source) as img:
            small = img.convert('L')
            small.thumbnail((160, 160))
            pixels = list(small.getdata())
    except Exception:                                  # noqa: BLE001 — не критично
        return 0.5
    if not pixels:
        return 0.5
    return sum(1 for value in pixels if value < 200) / len(pixels)


def reencode(source):
    with Image.open(source) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            rgba = img.convert('RGBA')
            background.paste(rgba, mask=rgba.split()[-1])
            img = background
        else:
            img = img.convert('RGB')
        if max(img.size) > MAX_SIDE:
            img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        buffer = io.BytesIO()
        img.save(buffer, 'JPEG', quality=JPEG_QUALITY, optimize=True, progressive=True)
        return buffer.getvalue()


def convert(source, target_dir, base_name, dry_run=False):
    """HEIC/PNG/WEBP → JPEG без EXIF; имя — по содержимому, чтобы не плодить дубли."""
    source = Path(source)
    ready = source.suffix.lower() in ('.jpg', '.jpeg') and source.stat().st_size <= 400 * 1024
    if ready:
        with Image.open(source) as probe:              # уже ужато при выгрузке
            ready = max(probe.size) <= MAX_SIDE

    payload = source.read_bytes() if ready else reencode(source)
    digest = hashlib.sha256(payload).hexdigest()[:12]
    name = f'{base_name}_{digest}.jpg'
    target = Path(target_dir) / name
    if not dry_run and not target.exists():
        target.write_bytes(payload)
    return name, len(payload)


def collect(root, catalog):
    """Файл → позиции каталога; дубли по содержимому отбрасываются."""
    attachments, unmatched, seen = [], [], set()

    # поставщик нумерует ракурсы словами: «один» — лицевая сторона, она и в обложку
    FRAME_ORDER = ('один', 'два', 'три', 'чет', 'пять')

    def order(item):
        name = item.stem.lower()
        frame = next((i for i, word in enumerate(FRAME_ORDER) if word in name), len(FRAME_ORDER))
        root_level = len(item.relative_to(root).parts)
        return (root_level, frame, str(item))

    for path in sorted(Path(root).rglob('*'), key=order):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXT:
            continue
        if any(part.startswith(('.', '__')) for part in path.relative_to(root).parts):
            continue

        # имя файла точнее папки: в папке «А.3736.001-Б» лежат снимки А.3776.001-Б
        article, code = parse_name(path.stem)
        entries = catalog.resolve(article) if article else []
        if not entries and article:
            entry, mod_code = catalog.resolve_modification_article(article)
            if entry:
                entries, code = [entry], mod_code
        if not entries:
            entries, code = parse_path(path, root, catalog)
        if not entries:
            entry, mod_code = catalog.resolve_modification_article(
                normalize_article(Path(root).joinpath(*path.relative_to(root).parts[1:-1]).name))
            if entry:
                entries, code = [entry], mod_code
        if not entries:
            unmatched.append(path)
            continue

        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)

        for entry in entries:
            attachments.append({'file': path, 'entry': entry,
                                'mod': catalog.modification(entry, code)})
    return attachments, unmatched


def run(root, catalog_path=CATALOG_JSON, dry_run=False):
    root = Path(root)
    catalog = Catalog(catalog_path)
    attachments, unmatched = collect(root, catalog)

    counters = {'files': 0, 'bytes': 0, 'covers': 0, 'replaced': 0, 'gallery': 0, 'mods': 0}
    skipped = []
    touched = set()
    drawing = {}                       # имя файла → похоже на чертёж, а не на фото
    scans = set()                      # прежняя обложка — скан страницы PDF-каталога

    for item in attachments:
        entry, mod = item['entry'], item['mod']
        base = slug(entry['article'], mod['code'] if mod else '')
        name, size = convert(item['file'], FILES_DIR, base, dry_run=dry_run)
        counters['files'] += 1
        counters['bytes'] += size
        drawing[name] = ink_ratio(item['file']) < 0.12

        if mod is not None:
            images = mod.setdefault('images', [])
            if name not in images:
                images.append(name)
                counters['mods'] += 1
            print(f"  {item['file'].name[:46]:46} → {entry['article']}-{mod['code']}")
            continue

        images = entry.setdefault('images', [])
        if name not in images:
            if len(images) >= MAX_PHOTOS:
                skipped.append(item)
                continue
            images.append(name)
            counters['gallery'] += 1

        article = entry['article']
        previous = entry.get('image')
        if article not in touched and previous != name:
            if previous and previous not in images:
                images.append(previous)                # скан из PDF остаётся в галерее
                scans.add(previous)
            entry['image'] = name
            touched.add(article)
            counters['covers'] += 1
            if previous:
                counters['replaced'] += 1
            note = ' (обложка, скан из PDF — в галерею)' if previous else ' (обложка)'
            print(f"  {item['file'].name[:46]:46} → {article}{note}")

    # фото изделия — вперёд, чертежи и схемы — в конец галереи; обложка из первых
    for entry in catalog.components:
        images = entry.get('images') or []
        if not images:
            continue
        order = {name: index for index, name in enumerate(images)}

        def rank(name):
            if drawing.get(name, False):
                return 2                               # чертёж
            return 1 if name in scans else 0           # скан страницы каталога

        images.sort(key=lambda name: (rank(name), order[name]))
        entry['images'] = images
        photos = [name for name in images if rank(name) == 0]
        if photos:
            entry['image'] = photos[0]

    if not dry_run:
        catalog.save()

    print(f"\nфайлов: {counters['files']} ({counters['bytes'] / 1024 / 1024:.1f} МБ), "
          f"обложек: {counters['covers']} (заменили скан из PDF: {counters['replaced']}), "
          f"в галерею: {counters['gallery']}, в исполнения: {counters['mods']}")
    if unmatched:
        print(f'\nне найдено в каталоге ({len(unmatched)}):')
        for path in unmatched[:20]:
            print(f'  {path.relative_to(root)}')
        if len(unmatched) > 20:
            print(f'  … и ещё {len(unmatched) - 20}')
    if skipped:
        print(f'\nсверх лимита {MAX_PHOTOS} фото ({len(skipped)}):')
        for item in skipped[:10]:
            print(f"  {item['file'].relative_to(root)}")
    return counters, unmatched


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    run(args[0], dry_run='--dry-run' in sys.argv)
