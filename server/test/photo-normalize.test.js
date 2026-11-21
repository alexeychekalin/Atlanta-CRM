/* Нормализация фото изделий.
 *
 * Проверяем то, что видит менеджер в каталоге: фото с большими белыми полями
 * больше не теряется, прозрачный фон не проваливается в тёмную карточку,
 * а повторный запуск не портит уже приведённые файлы.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const {
  normalizeProductPhoto,
  isNormalizablePhoto,
  hasNormalizeMarker,
  MARKER,
  SIZE,
} = require('../src/services/photo-normalize');

const ROOT = path.resolve(__dirname, '../..');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlanta-normalize-'));
}

async function objectImage(dir, name, options = {}) {
  const {
    width = 1200, height = 900, background = '#ffffff', channels = 3,
    objectWidth = 300, objectHeight = 150, objectColor = '#c81e1e',
  } = options;
  const target = path.join(dir, name);
  const object = await sharp({
    create: { width: objectWidth, height: objectHeight, channels: 3, background: objectColor },
  }).png().toBuffer();

  let image = sharp({ create: { width, height, channels, background } })
    .composite([{
      input: object,
      left: Math.round((width - objectWidth) / 2),
      top: Math.round((height - objectHeight) / 2),
    }]);

  if (name.endsWith('.png')) await image.png().toFile(target);
  else if (name.endsWith('.webp')) await image.webp().toFile(target);
  else await image.jpeg({ quality: 95 }).toFile(target);
  return target;
}

/** Границы непустого (не белого) содержимого: сколько кадра занимает изделие. */
async function contentBox(file) {
  const { data, info } = await sharp(file).flatten({ background: '#ffffff' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, maxX = -1, minY = info.height, maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const white = data[offset] > 245 && data[offset + 1] > 245 && data[offset + 2] > 245;
      if (white) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1, minX, minY };
}

async function cornerPixel(file) {
  const { data } = await sharp(file).flatten({ background: '#ffffff' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('фото с белыми полями: поля обрезаются, изделие занимает ~86 % квадрата', async () => {
  const dir = tempDir();
  const file = await objectImage(dir, 'margins.jpg', { width: 1200, height: 900, objectWidth: 300, objectHeight: 150 });

  const result = await normalizeProductPhoto(file);
  assert.equal(result.changed, true);

  const meta = await sharp(file).metadata();
  assert.equal(meta.width, SIZE);
  assert.equal(meta.height, SIZE);

  const box = await contentBox(file);
  const share = Math.max(box.width, box.height) / SIZE;
  assert.ok(share >= 0.8 && share <= 0.92, `изделие занимает ${(share * 100).toFixed(0)} %, ожидали ~86 %`);

  // Поля сверху и снизу одинаковые — изделие по центру кадра
  const bottom = SIZE - (box.minY + box.height);
  assert.ok(Math.abs(box.minY - bottom) <= 2, 'изделие должно быть по центру по вертикали');
});

test('прозрачный PNG: фон заливается белым, формат сохраняется', async () => {
  const dir = tempDir();
  const file = await objectImage(dir, 'transparent.png', {
    width: 800, height: 800, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    objectWidth: 400, objectHeight: 200, objectColor: '#1e78c8',
  });

  const before = await sharp(file).metadata();
  assert.equal(before.hasAlpha, true);

  await normalizeProductPhoto(file);
  const after = await sharp(file).metadata();
  assert.equal(after.format, 'png', 'PNG остаётся PNG — путь в базе не меняется');
  assert.equal(after.hasAlpha, false, 'альфа-канал залит белым');
  assert.deepEqual(await cornerPixel(file), [255, 255, 255]);
});

test('тёмное фото на весь кадр вписывается в белый квадрат без обрезки', async () => {
  const dir = tempDir();
  const file = await objectImage(dir, 'dark.jpg', {
    width: 1200, height: 600, background: '#2b2b2b', objectWidth: 800, objectHeight: 300, objectColor: '#b45309',
  });

  await normalizeProductPhoto(file);
  const meta = await sharp(file).metadata();
  assert.equal(meta.width, SIZE);
  assert.equal(meta.height, SIZE);
  assert.deepEqual(await cornerPixel(file), [255, 255, 255], 'углы белые, а не тёмные');

  const box = await contentBox(file);
  assert.ok(box.width / SIZE >= 0.8, 'изделие не должно уменьшиться');
});

test('повторный запуск не перекодирует уже нормализованный файл', async () => {
  const dir = tempDir();
  const file = await objectImage(dir, 'repeat.jpg');

  const first = await normalizeProductPhoto(file);
  assert.equal(first.changed, true);
  const hash = fileHash(file);

  const second = await normalizeProductPhoto(file);
  assert.equal(second.changed, false);
  assert.equal(second.reason, 'already-normalized');
  assert.equal(fileHash(file), hash, 'файл не должен переписываться');
});

test('проверка (dry run) показывает изменения, но не трогает файл', async () => {
  const dir = tempDir();
  const file = await objectImage(dir, 'dry.jpg');
  const hash = fileHash(file);

  const result = await normalizeProductPhoto(file, { dryRun: true });
  assert.equal(result.changed, true);
  assert.equal(result.dryRun, true);
  assert.equal(fileHash(file), hash, 'в режиме проверки файл остаётся прежним');
  assert.equal((await sharp(file).metadata()).width, 1200);
});

test('мелкое фото тоже приводится к квадрату, но без мыла', async () => {
  const dir = tempDir();
  const file = await objectImage(dir, 'small.jpg', { width: 160, height: 120, objectWidth: 80, objectHeight: 60 });

  const result = await normalizeProductPhoto(file);
  assert.equal(result.changed, true);
  const meta = await sharp(file).metadata();
  assert.equal(meta.width, SIZE);
  // увеличение ограничено: изделие не растянуто на весь кадр
  const box = await contentBox(file);
  assert.ok(box.width / SIZE <= 0.75, `изделие занимает ${(box.width / SIZE * 100).toFixed(0)} % — слишком крупно для мелкого исходника`);

  // ...и повторный запуск его уже не трогает
  const again = await normalizeProductPhoto(file);
  assert.equal(again.changed, false);
  assert.equal(again.reason, 'already-normalized');
});

test('метка нормализации записывается в файл', async () => {
  const dir = tempDir();
  const jpeg = await objectImage(dir, 'marked.jpg');
  await normalizeProductPhoto(jpeg);
  assert.equal(hasNormalizeMarker(await sharp(jpeg).metadata()), true);

  const png = await objectImage(dir, 'marked.png', {
    channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 }, width: 600, height: 600,
  });
  await normalizeProductPhoto(png);
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, 'png');
  assert.ok(meta.exif.toString().includes(MARKER), 'PNG тоже получает метку');

  // У чужого фото метки нет
  const foreign = await objectImage(dir, 'foreign.jpg');
  assert.equal(hasNormalizeMarker(await sharp(foreign).metadata()), false);
});

test('совсем крошечные картинки не трогаем', async () => {
  const dir = tempDir();
  const file = await objectImage(dir, 'icon.jpg', { width: 40, height: 32, objectWidth: 20, objectHeight: 16 });

  const result = await normalizeProductPhoto(file);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'too-small');
  assert.equal((await sharp(file).metadata()).width, 40);
});

test('не фото не трогаем', async () => {
  assert.equal(isNormalizablePhoto('photo.gif'), false);
  assert.equal(isNormalizablePhoto('scan.pdf'), false);
  assert.equal(isNormalizablePhoto('photo.JPG'), true);
  assert.deepEqual(await normalizeProductPhoto('/tmp/whatever.gif'), { changed: false, reason: 'unsupported' });
});

test('загрузка фото компонента нормализуется, а документы — нет', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/upload.js'), 'utf8');
  const imageRoute = source.match(/router\.post\('\/image'[^\n]*/);
  assert.ok(imageRoute, 'нет маршрута /upload/image');
  assert.match(imageRoute[0], /fixPhotoOrientation,\s*normalizeUploadedPhoto/);
  assert.match(imageRoute[0], /normalizeUploadedPhoto/);

  // Сканы и чертежи не превращаем в квадраты — это документы, а не фото изделия
  for (const route of ['/drawing', '/client-doc', '/component-doc', '/library-file']) {
    const line = source.match(new RegExp(`router\\.post\\('${route}'[^\\n]*`));
    assert.ok(line, `нет маршрута ${route}`);
    assert.ok(!/normalizeUploadedPhoto/.test(line[0]), `${route} не должен нормализовать фото`);
  }
});

test('скрипт для старых фото: бэкап, проверка, повтор, восстановление', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.scripts['db:normalize-photos'], 'node scripts/normalize_photos.js');
  assert.ok(pkg.scripts['demo:normalize-photos'], 'нужен демо-запуск для проверки на PGlite');

  const script = fs.readFileSync(path.join(__dirname, '../scripts/normalize_photos.js'), 'utf8');
  assert.match(script, /--dry-run/);
  assert.match(script, /--restore/);
  assert.match(script, /--all/);
  // Бэкап должен сниматься до перезаписи файла
  const backupIndex = script.indexOf('await backupFile(urlPath, backupDir);');
  const normalizeIndex = script.indexOf('await normalizeProductPhoto(absolute');
  assert.ok(backupIndex > 0 && backupIndex < normalizeIndex, 'сначала бэкап, потом нормализация');
  assert.match(script, /photo-backup/);
});

test('карточка каталога: белая подложка и вписанное фото вместо обрезки', () => {
  const catalog = fs.readFileSync(path.join(ROOT, 'client/js/pages/components-catalog.js'), 'utf8');
  const card = catalog.match(/\.comp-card-img \{[\s\S]*?\n {8}\}/);
  assert.ok(card, 'нет стилей .comp-card-img');
  assert.match(card[0], /background:#fff/);

  const img = catalog.match(/\.comp-card-img img \{[\s\S]*?\n {8}\}/);
  assert.ok(img, 'нет стилей .comp-card-img img');
  assert.match(img[0], /object-fit:contain/);

  const styles = fs.readFileSync(path.join(ROOT, 'client/css/styles.css'), 'utf8');
  const thumb = styles.match(/\.comp-photo img \{[\s\S]*?\n\}/);
  assert.ok(thumb, 'нет стилей миниатюр .comp-photo img');
  assert.match(thumb[0], /object-fit: contain/);

  // Версии статики подняты — иначе браузер покажет старый CSS из кэша
  const index = fs.readFileSync(path.join(ROOT, 'client/index.html'), 'utf8');
  assert.match(index, /styles\.css\?v=(\d+)/);
  const version = Number(index.match(/styles\.css\?v=(\d+)/)[1]);
  assert.ok(version >= 12, 'нужно поднять ?v= у styles.css');
  const sw = fs.readFileSync(path.join(ROOT, 'client/sw.js'), 'utf8');
  assert.match(sw, /atlanta-crm-v20|atlanta-crm-v2\d/);
});
