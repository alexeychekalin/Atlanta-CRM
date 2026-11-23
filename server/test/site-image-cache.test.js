/**
 * Кэш пережатых фото сайта.
 *
 * Раньше сборка пропускала пережатие, если готовая картинка новее исходника.
 * После выкладки на сервер исходники приезжают с git checkout / rsync со
 * старым временем файла — условие выполнялось, и на сайте под тем же именем
 * оставалась СТАРАЯ картинка. Теперь рядом с картинкой лежит отпечаток
 * исходника (размер + mtime), и без его совпадения пережатие делается заново.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BUILD = fs.readFileSync(path.join(ROOT, 'site/build.py'), 'utf8');

test('сайт: пережатие не пропускается из-за старого mtime исходника', (t) => {
  // Работаем во временной папке: реальные фото каталога тест менять не должен.
  const script = `
import os, sys, time, hashlib, shutil
from pathlib import Path
sys.path.insert(0, 'site')
import build
from PIL import Image

out = Path(sys.argv[1])
work = Path(sys.argv[2])
work.mkdir(parents=True, exist_ok=True)
name = 'sample.jpg'
Image.new('RGB', (900, 600), (20, 80, 160)).save(work / name, 'JPEG')
build.FILES_DIR = work
components = [{'images': [name], 'modifications': []}]

build.build_images(components, out)
target = out / 'img' / (Path(name).stem + '-640.jpg')
first = hashlib.sha1(target.read_bytes()).hexdigest()

# исходник «постарел» — как после git checkout / rsync / распаковки
past = time.time() - 3600
os.utime(work / name, (past, past))
# и содержимое поменялось: подменяем пиксели, оставляя имя
img = Image.open(work / name).convert('RGB')
img.putpixel((0, 0), (255, 0, 255))
img.save(work / name, 'JPEG', quality=90)
os.utime(work / name, (past, past))

build.build_images(components, out)
second = hashlib.sha1(target.read_bytes()).hexdigest()
print('changed' if first != second else 'stale')
`;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'atlanta-cache-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'atlanta-src-'));
  const result = spawnSync('/tmp/venv/bin/python', ['-c', script, out, work], { cwd: ROOT, encoding: 'utf8' });
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
  if (result.error || !result.stdout.includes('changed') && /No module named 'PIL'/.test(result.stderr || '')) {
    t.skip('нет Pillow — проверка пережатия недоступна');
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /changed/,
    'после смены содержимого исходника картинка должна пережаться заново');
});

test('сайт: отпечатки кэша не попадают в папку сборки', () => {
  assert.match(BUILD, /\.image-cache/, 'кэш отпечатков лежит в site/.image-cache');
  assert.doesNotMatch(BUILD, /target\.with_name\(f'\.\{[^}]*\}\.src'\)/,
    'отпечатки не должны лежать рядом с картинками в сборке');
});
