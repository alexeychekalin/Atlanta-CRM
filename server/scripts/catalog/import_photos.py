"""Импорт фотографий изделий в каталог.

Источник — дерево каталогов от поставщика (выгрузка с диска):

    Габаритные фонари/А.3731.010/01/А.3731.010-01 один.HEIC
    Габаритные фонари/А.3731.010/А.3731.010-01.02.03 маркер на 75.png
    Задние фонари/А.3736.001-Б/фото.jpg

Артикул берётся из имени файла, если он там есть, иначе — из ближайшей папки,
совпадающей с позицией каталога; код исполнения — из подпапки (`01`) или из
имени файла (`-01.02.03`).

Что делает:

* переводит HEIC (снимки с iPhone), PNG, WEBP в JPEG — браузеры HEIC не умеют;
* ужимает длинную сторону до 1600 px и убирает EXIF (в телефоне там координаты);
* кладёт файлы в `src/db/catalog/files/` под стабильным именем;
* прописывает фото позиции в `image`, исполнения — в `modifications[].images`.

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

ARTICLE_RE = re.compile(
    r'[АA]\.\s*\d{4}\.\s*\d{3}(?:\.\d)?(?:-[А-ЯA-Z]{1,2})?', re.IGNORECASE)
CODE_TAIL_RE = re.compile(r'-\s*(\d{1,2}(?:[.\-]\d{1,2}){0,3})$')


def normalize_article(text):
    """«A.3731.010» (латинская A, пробелы) → «А.3731.010» как в каталоге."""
    text = re.sub(r'\s+', '', text or '')
    text = re.sub(r'^[Aa]', 'А', text)
    return text


def article_variants(article):
    """Ключи для сверки: с кириллицей и с латиницей в начале."""
    return {article, article.replace('А', 'A', 1), article.replace('А', 'a', 1)}


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
        self.by_article = {}
        for entry in self.data['components']:
            for key in article_variants(entry['article']):
                self.by_article[key] = entry

    def find(self, article):
        for key in article_variants(article):
            if key in self.by_article:
                return self.by_article[key]
        return None

    def find_modification(self, entry, code):
        """Точный код исполнения. Короткий код группы («01») исполнением не считается."""
        code = (code or '').strip().lower()
        if not code:
            return None
        for mod in entry.get('modifications') or []:
            if mod['code'].lower() == code:
                return mod
        return None

    def find_variants(self, article):
        """Позиции, начинающиеся с артикула: «А.3776.005» → «А.3776.005Л»/«005П»."""
        if not article:
            return []
        prefix = article.lower()
        found = []
        for entry in self.data['components']:
            low = entry['article'].lower()
            if low.startswith(prefix + '.') or low.startswith(prefix + '-'):
                found.append(entry)
        return found[:4]

    def save(self):
        self.path.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def parse_path(file_path, root):
    """Артикул и код исполнения из имени файла или из папок вокруг него."""
    article, code = None, ''
    stem = file_path.stem

    match = ARTICLE_RE.search(stem)
    if match:
        raw = normalize_article(match.group(0))
        tail = stem[match.end():]
        code_match = CODE_TAIL_RE.search(tail.strip()) or re.match(
            r'^\s*(\d{1,2}(?:[.\-]\d{1,2}){0,3})', tail.strip())
        if code_match:
            code = code_match.group(1).replace('-', '.')
        article = raw

    parts = file_path.relative_to(root).parts[:-1]
    if not article:
        for part in reversed(parts):
            found = ARTICLE_RE.search(part)
            if found:
                article = normalize_article(found.group(0))
                tail = part[found.end():]
                code_match = CODE_TAIL_RE.search(tail.strip())
                if code_match:
                    code = code_match.group(1).replace('-', '.')
                break
    if not code:
        for part in reversed(parts):
            if re.fullmatch(r'\d{1,2}(?:[.\-]\d{1,2}){0,3}', part.strip()):
                code = part.strip().replace('-', '.')
                break
    return article, code


def convert(source, target_dir, base_name, dry_run=False):
    """HEIC/PNG/WEBP → JPEG без EXIF; имя — по содержимому, чтобы не плодить дубли."""
    source = Path(source)
    already = source.suffix.lower() in ('.jpg', '.jpeg') and source.stat().st_size <= 400 * 1024
    if already:
        with Image.open(source) as probe:              # размер уже ужат при выгрузке
            already = max(probe.size) <= MAX_SIDE

    if already:
        payload = source.read_bytes()
    else:
        payload = reencode(source)

    digest = hashlib.sha256(payload).hexdigest()[:12]
    name = f'{base_name}_{digest}.jpg'
    target = Path(target_dir) / name
    if not dry_run and not target.exists():
        target.write_bytes(payload)
    return name, len(payload)


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


def build_plan(root):
    plan, unmatched = [], []
    for path in sorted(Path(root).rglob('*')):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXT:
            continue
        if any(part.startswith('.') for part in path.relative_to(root).parts):
            continue
        article, code = parse_path(path, root)
        plan.append({'file': path, 'article': article, 'code': code})
    return plan, unmatched


def run(root, catalog_path=CATALOG_JSON, dry_run=False):
    root = Path(root)
    catalog = Catalog(catalog_path)
    attachments = []
    unmatched = []

    skipped = []
    for item in build_plan(root)[0]:
        entry = catalog.find(item['article']) if item['article'] else None
        entries = [entry] if entry else catalog.find_variants(item['article'])
        if not entries:
            unmatched.append(item)
            continue
        for candidate in entries:
            mod = catalog.find_modification(candidate, item['code'])
            attachments.append({**item, 'entry': candidate, 'mod': mod,
                                'guessed': entry is None})

    counters = {'components': 0, 'modifications': 0, 'files': 0, 'bytes': 0}
    replaced = 0
    touched = set()                       # позиции, которым уже дали фото в этом прогоне
    for item in attachments:
        entry, mod = item['entry'], item['mod']
        base = slug(entry['article'], mod['code'] if mod else '')
        name, size = convert(item['file'], FILES_DIR, base, dry_run=dry_run)
        counters['files'] += 1
        counters['bytes'] += size

        if mod is not None:
            images = mod.setdefault('images', [])
            if name in images:
                continue
            images.append(name)
            counters['modifications'] += 1
            print(f"  {item['file'].name[:52]:52} → {entry['article']}-{mod['code']}")
            continue

        mods = entry.get('modifications') or []
        article = entry['article']
        if article not in touched:
            # первое фото поставщика становится главным; прежний скан из PDF
            # не теряем — он уезжает к единственному исполнению
            previous = entry.get('image')
            touched.add(article)
            if previous == name:
                continue
            entry['image'] = name
            counters['components'] += 1
            note = ''
            if previous:
                replaced += 1
                note = ' (заменил скан из PDF)'
                if len(mods) == 1:
                    images = mods[0].setdefault('images', [])
                    if previous not in images:
                        images.append(previous)
            print(f"  {item['file'].name[:52]:52} → {article}{note}")
            continue

        if entry.get('image') == name:
            continue

        if len(mods) == 1:
            images = mods[0].setdefault('images', [])
            if name not in images:
                images.append(name)
                counters['modifications'] += 1
            print(f"  {item['file'].name[:52]:52} → {entry['article']}-{mods[0]['code']}")
            continue

        skipped.append(item)

    if not dry_run:
        catalog.save()

    print(f"\nфайлов обработано: {counters['files']} "
          f"({counters['bytes'] / 1024 / 1024:.1f} МБ), "
          f"позиций с новым фото: {counters['components']} "
          f"(из них заменили скан из PDF: {replaced}), "
          f"исполнений: {counters['modifications']}")
    if unmatched:
        print(f'\nне найдено в каталоге ({len(unmatched)}):')
        for item in unmatched:
            print(f"  {item['file'].relative_to(root)}")
    if skipped:
        print(f'\nнекуда приложить ({len(skipped)}):')
        for item in skipped:
            print(f"  {item['file'].relative_to(root)}")
    return counters, unmatched


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    run(args[0], dry_run='--dry-run' in sys.argv)
