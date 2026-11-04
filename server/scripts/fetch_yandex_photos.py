"""Скачивание фотографий с публичного Яндекс.Диска (запускается на раннере GitHub).

Песочница разработки не имеет доступа к disk.yandex.ru, а раннер GitHub — имеет.
Скрипт обходит публичную папку по API, скачивает изображения и описания,
переводит HEIC/PNG/WEBP в JPEG (длинная сторона 1600 px, без EXIF) и
складывает результат в `server/src/db/catalog/files/incoming/`, сохраняя
структуру папок — по ней `import_photos.py` разложит фото по артикулам.

Запуск:
    python3 scripts/fetch_yandex_photos.py [публичная ссылка] [каталог назначения]
"""
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

PUBLIC_URL = sys.argv[1] if len(sys.argv) > 1 else 'https://disk.yandex.ru/d/qos0XLZpqddatA'
DEST = Path(sys.argv[2] if len(sys.argv) > 2 else
            Path(__file__).resolve().parents[1] / 'src/db/catalog/files/incoming')

API = 'https://cloud-api.yandex.net/v1/disk/public/resources'
MAX_SIDE = 1600
JPEG_QUALITY = 86
IMAGE_EXT = {'.heic', '.heif', '.jpg', '.jpeg', '.png', '.webp', '.bmp'}
KEEP_EXT = {'.docx', '.doc', '.pdf'}


def api(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.loads(response.read().decode('utf-8'))


def list_folder(path=''):
    params = {'public_key': PUBLIC_URL, 'limit': 1000, 'fields':
              '_embedded.total,_embedded.items.name,_embedded.items.type,_embedded.items.path,_embedded.items.size'}
    if path:
        params['path'] = path
    return api(API + '?' + urllib.parse.urlencode(params))['_embedded']['items']


def download(path, target):
    params = {'public_key': PUBLIC_URL, 'path': path}
    href = api(API + '/download?' + urllib.parse.urlencode(params))['href']
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(href, timeout=300) as response:
        target.write_bytes(response.read())
    return target.stat().st_size


def safe_name(name):
    name = re.sub(r'[\\/:*?"<>|]+', '-', name).strip(' .')
    return re.sub(r'\s+', ' ', name)


def to_jpeg(source, target):
    from PIL import Image, ImageOps
    import pillow_heif
    pillow_heif.register_heif_opener()

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
        target.parent.mkdir(parents=True, exist_ok=True)
        img.save(target, 'JPEG', quality=JPEG_QUALITY, optimize=True, progressive=True)
    return target.stat().st_size


def walk(path='', depth=0):
    for item in list_folder(path):
        yield item
        if item['type'] == 'dir' and depth < 4:
            yield from walk(item['path'], depth + 1)


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    manifest, failed = [], []
    total_bytes = 0

    for item in walk():
        if item['type'] != 'file':
            continue
        suffix = Path(item['name']).suffix.lower()
        if suffix not in IMAGE_EXT and suffix not in KEEP_EXT:
            continue

        relative = item['path'].lstrip('/')
        relative = '/'.join(safe_name(part) for part in relative.split('/'))
        stem = Path(relative).stem
        if suffix in IMAGE_EXT:
            target = DEST / Path(relative).parent / f'{stem}.jpg'
        else:
            target = DEST / relative

        try:
            raw = DEST / Path(relative).parent / f'__raw_{stem}{suffix}'
            size = download(item['path'], raw)
            if suffix in IMAGE_EXT:
                size = to_jpeg(raw, target)
                raw.unlink(missing_ok=True)
            total_bytes += size
            manifest.append({'source': item['path'], 'file': str(target.relative_to(DEST)),
                             'bytes': size})
            print(f"  {item['path'][:70]:70} {size / 1024:8.0f} КБ")
        except Exception as err:                      # noqa: BLE001 — отчёт важнее падения
            failed.append({'source': item['path'], 'error': str(err)})
            print(f'  ✗ {item["path"]}: {err}')

    (DEST / '_manifest.json').write_text(
        json.dumps({'source': PUBLIC_URL, 'files': manifest, 'failed': failed},
                   ensure_ascii=False, indent=1), encoding='utf-8')

    print(f'\nфайлов: {len(manifest)}, ошибок: {len(failed)}, '
          f'объём: {total_bytes / 1024 / 1024:.1f} МБ → {DEST}')
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
