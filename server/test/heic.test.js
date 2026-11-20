/* HEIC с iPhone: распознавание, проверка сигнатуры и конвертация в JPEG. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isHeicExtension,
  isHeicBuffer,
  heifBrand,
  readHeicSize,
  convertHeicFile,
  convertHeicQueued,
} = require('../src/services/heic');
const { hasValidSignature } = require('../src/utils/files');

const FIXTURE = path.join(__dirname, 'fixtures/sample.heic');

function tempCopy(name = 'photo.heic') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlanta-heic-'));
  const target = path.join(dir, name);
  fs.copyFileSync(FIXTURE, target);
  return { dir, target };
}

test('isHeicExtension узнаёт heic/heif в любом регистре', () => {
  assert.equal(isHeicExtension('.heic'), true);
  assert.equal(isHeicExtension('.HEIF'), true);
  assert.equal(isHeicExtension('.jpg'), false);
  assert.equal(isHeicExtension(''), false);
  assert.equal(isHeicExtension(null), false);
});

test('isHeicBuffer отличает HEIC от JPEG и PNG', () => {
  const heic = fs.readFileSync(FIXTURE);
  assert.equal(isHeicBuffer(heic), true);
  assert.equal(heifBrand(heic), 'heic');

  // JPEG
  assert.equal(isHeicBuffer(Buffer.from('ffd8ffe000104a464946', 'hex')), false);
  // PNG
  assert.equal(isHeicBuffer(Buffer.from('89504e470d0a1a0a0000000d', 'hex')), false);
  // Слишком короткий буфер
  assert.equal(isHeicBuffer(Buffer.from('ftypheic', 'ascii')), false);
  assert.equal(isHeicBuffer(null), false);
});

test('isHeicBuffer не принимает AVIF и прочие ISO BMFF', () => {
  const avif = Buffer.concat([
    Buffer.from('000000206674797061766966', 'hex'),
    Buffer.from('mif1avif', 'ascii'),
  ]);
  assert.equal(isHeicBuffer(avif), false);
  assert.equal(heifBrand(avif), 'avif');
});

test('readHeicSize читает размеры без декодирования пикселей', () => {
  const size = readHeicSize(fs.readFileSync(FIXTURE));
  assert.deepEqual(size, { width: 1200, height: 900 });
  assert.equal(readHeicSize(Buffer.from('ffd8ffe0', 'hex')), null);
});

test('hasValidSignature принимает HEIC и HEIF, но не подделку', () => {
  const { dir, target } = tempCopy('photo.heic');
  const heif = path.join(dir, 'photo.heif');
  fs.copyFileSync(target, heif);

  const fake = path.join(dir, 'fake.heic');
  fs.copyFileSync(path.join(__dirname, 'fixtures/sample.heic'), fake);
  fs.writeFileSync(fake, Buffer.from('ffd8ffe000104a464946', 'hex'));

  assert.equal(hasValidSignature(target, '.heic'), true);
  assert.equal(hasValidSignature(heif, '.heif'), true);
  assert.equal(hasValidSignature(fake, '.heic'), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('convertHeicFile делает JPEG рядом с исходником и убирает HEIC', async () => {
  const { dir, target } = tempCopy('IMG_0001.HEIC');
  const result = await convertHeicFile(target);

  assert.equal(result.filename, 'IMG_0001.jpg');
  assert.equal(result.path, path.join(dir, 'IMG_0001.jpg'));
  assert.equal(result.width, 1200);
  assert.equal(result.height, 900);
  assert.equal(fs.existsSync(target), false, 'исходный HEIC удалён');
  assert.equal(fs.existsSync(result.path), true);

  const jpeg = fs.readFileSync(result.path);
  assert.equal(jpeg.subarray(0, 3).toString('hex'), 'ffd8ff', 'это JPEG');
  assert.equal(result.size, jpeg.length);
  assert.ok(result.size > 1000);

  // Результат проходит проверку сигнатуры как обычный .jpg
  assert.equal(hasValidSignature(result.path, '.jpg'), true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('convertHeicFile отказывает не-HEIC файлу', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlanta-heic-'));
  const fake = path.join(dir, 'fake.heic');
  fs.writeFileSync(fake, Buffer.from('ffd8ffe000104a464946', 'hex'));

  await assert.rejects(convertHeicFile(fake), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /не похож на HEIC/);
    return true;
  });

  fs.rmSync(dir, { recursive: true, force: true });
});

test('convertHeicFile не даёт декодировать гигантские фото', async () => {
  const { dir, target } = tempCopy();
  await assert.rejects(convertHeicFile(target, { maxPixels: 1000 }), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /слишком большое/);
    return true;
  });
  // При отказе исходник остаётся на месте — пользователь видит файл в форме
  assert.equal(fs.existsSync(target), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('convertHeicQueued переживает ошибку и продолжает очередь', async () => {
  const first = tempCopy('first.heic');
  const second = tempCopy('second.heic');

  const failed = convertHeicQueued(path.join(first.dir, 'missing.heic')).catch((err) => err);
  const ok = convertHeicQueued(second.target);

  const err = await failed;
  assert.ok(err instanceof Error);

  const result = await ok;
  assert.equal(result.filename, 'second.jpg');
  assert.equal(fs.existsSync(result.path), true);

  fs.rmSync(first.dir, { recursive: true, force: true });
  fs.rmSync(second.dir, { recursive: true, force: true });
});

/* Структурная проверка: HEIC не должен «отвалиться» при будущей правке маршрутов.
 * Все точки загрузки фото обязаны пропускать .heic/.heif через фильтр и
 * конвертировать файл после проверки сигнатуры. */
test('все точки загрузки фото принимают HEIC и конвертируют его', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/upload.js'), 'utf8');

  // Фильтры форматов
  const filters = {
    imageFilter: source.match(/const imageFilter = extensionFilter\(\s*\[([^\]]+)\]/),
    drawingFilter: source.match(/const drawingFilter = extensionFilter\(\s*\[([^\]]+)\]/),
    compDocFilter: source.match(/const compDocFilter = extensionFilter\(\s*\[([^\]]+)\]/),
    clientFileFilter: source.match(/const clientFileFilter = extensionFilter\(\s*\[([^\]]+)\]/),
  };
  for (const [name, match] of Object.entries(filters)) {
    assert.ok(match, `не найден ${name}`);
    assert.match(match[1], /\.heic/, `${name}: нет .heic`);
    assert.match(match[1], /\.heif/, `${name}: нет .heif`);
  }
  assert.match(source, /LIBRARY_EXTENSIONS[^\]]*\.heic/, 'библиотека не принимает .heic');

  // Каждый маршрут загрузки: сигнатура проверяется до конвертации
  const routes = [...source.matchAll(/router\.post\('\/[a-z-]+',[^\n]*, \(req, res\)/g)]
    .map((m) => m[0])
    .filter((route) => route.includes('verifyUploadedFile'));
  assert.ok(routes.length >= 6, 'маршруты загрузки не найдены');
  for (const route of routes) {
    assert.match(route, /verifyUploadedFile, convertHeicUpload/, `${route}: нет конвертации HEIC`);
  }
});

test('file_type в ответе берётся по фактическому файлу, а не по имени с телефона', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/upload.js'), 'utf8');
  assert.match(source, /function uploadedFileType\(req\)/);
  assert.equal(
    (source.match(/file_type: uploadedFileType\(req\)/g) || []).length,
    5,
    'file_type должен считаться по файлу на диске во всех четырёх маршрутах'
  );
  // originalname допустим только в проверке сигнатуры — там он ещё .heic
  assert.equal(
    (source.match(/path\.extname\(req\.file\.originalname\)/g) || []).length,
    1,
    'тип файла нельзя брать из originalname: после конвертации он уже неверный'
  );
});
