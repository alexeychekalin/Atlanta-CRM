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
import time
import urllib.parse
import urllib.request
from pathlib import Path

PUBLIC_URL = sys.argv[1] if len(sys.argv) > 1 else 'https://disk.yandex.ru/d/qos0XLZpqddatA'
DEST = Path(sys.argv[2] if len(sys.argv) > 2 else
            Path(__file__).resolve().parents[1] / 'src/db/catalog/files/incoming')
MAX_FILE_BYTES = 40 * 1024 * 1024        # фото с телефона — до 10 МБ, остальное не нужно
MAX_TOTAL_BYTES = 400 * 1024 * 1024     # чтобы не раздувать репозиторий и время сборки

API = 'https://cloud-api.yandex.net/v1/disk/public/resources'
MAX_SIDE = 1600
JPEG_QUALITY = 86
IMAGE_EXT = {'.heic', '.heif', '.jpg', '.jpeg', '.png', '.webp', '.bmp'}
KEEP_EXT = {'.docx', '.doc', '.pdf', '.txt', '.ini', '.rtf'}
DOCS_ONLY = '--docs' in sys.argv


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
    with urllib.request.urlopen(href, timeout=120) as response:
        data = response.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise ValueError(f'файл больше {MAX_FILE_BYTES // 1024 // 1024} МБ — пропущен')
    target.write_bytes(data)
    return len(data)


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


def write_report(manifest, failed, total_bytes, skipped):
    (DEST / '_manifest.json').write_text(
        json.dumps({'source': PUBLIC_URL, 'total_bytes': total_bytes,
                    'files': manifest, 'failed': failed, 'skipped': skipped},
                   ensure_ascii=False, indent=1), encoding='utf-8')


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    manifest, failed, skipped = [], [], []
    total_bytes = 0

    for item in walk():
        if item['type'] != 'file':
            continue
        suffix = Path(item['name']).suffix.lower()
        if DOCS_ONLY and suffix in IMAGE_EXT:
            continue
        if suffix not in IMAGE_EXT and suffix not in KEEP_EXT:
            skipped.append({'source': item['path'], 'reason': f'формат {suffix}'})
            continue
        if total_bytes > MAX_TOTAL_BYTES:
            skipped.append({'source': item['path'], 'reason': 'лимит объёма'})
            continue

        relative = item['path'].lstrip('/')
        relative = '/'.join(safe_name(part) for part in relative.split('/'))
        stem = Path(relative).stem
        if suffix in IMAGE_EXT:
            target = DEST / Path(relative).parent / f'{stem}.jpg'
        else:
            target = DEST / relative                      # документ — под своим именем

        raw = DEST / Path(relative).parent / f'.download{suffix}'
        error = None
        for attempt in range(1, 4):                   # Яндекс отдаёт по одному файлу,
            try:                                      # сеть на раннере тоже моргает
                size = download(item['path'], raw)
                if suffix in IMAGE_EXT:
                    size = to_jpeg(raw, target)
                    raw.unlink(missing_ok=True)
                else:
                    raw.replace(target)               # документ — под своим именем
                manifest.append({'source': item['path'], 'file': str(target.relative_to(DEST)),
                                 'bytes': size})
                total_bytes += size
                print(f"  {item['path'][:70]:70} {size / 1024:8.0f} КБ", flush=True)
                error = None
                break
            except Exception as err:                  # noqa: BLE001 — отчёт важнее падения
                error = err
                raw.unlink(missing_ok=True)
                time.sleep(2 * attempt)
        if error is not None:
            failed.append({'source': item['path'], 'error': str(error)})
            print(f'  ✗ {item["path"]}: {error}', flush=True)

        write_report(manifest, failed, total_bytes, skipped)   # отчёт после каждого файла

    write_report(manifest, failed, total_bytes, skipped)
    print(f'\nфайлов: {len(manifest)}, ошибок: {len(failed)}, пропущено: {len(skipped)}, '
          f'объём: {total_bytes / 1024 / 1024:.1f} МБ → {DEST}')


if __name__ == '__main__':
    main()
