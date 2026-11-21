/* Поворот фото и EXIF-ориентация (серверная часть).
 *
 * Проверяем то, что видит пользователь: после «повернуть» файл на месте
 * действительно повёрнут, размеры меняются местами, а фото с телефона
 * не приезжает лёжа из-за потерянного EXIF. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const {
  isRotatablePath,
  normalizeDegrees,
  rotatePhotoFile,
  autoOrientPhoto,
  photoSize,
} = require('../src/services/photo');

const COLORS = { left: '#dc1e1e', right: '#1e78c8' };

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlanta-photo-'));
}

/** 200×100: левая половина красная, правая синяя. */
async function makeImage(dir, name = 'photo.jpg', options = {}) {
  const target = path.join(dir, name);
  const left = await sharp({ create: { width: 100, height: 100, channels: 3, background: COLORS.left } })
    .png().toBuffer();
  const right = await sharp({ create: { width: 100, height: 100, channels: 3, background: COLORS.right } })
    .png().toBuffer();

  let image = sharp({ create: { width: 200, height: 100, channels: 3, background: '#ffffff' } })
    .composite([{ input: left, top: 0, left: 0 }, { input: right, top: 0, left: 100 }]);

  if (options.format === 'png') await image.png().toFile(target);
  else if (options.format === 'webp') await image.webp().toFile(target);
  else if (options.orientation) await image.withMetadata({ orientation: options.orientation }).jpeg({ quality: 95 }).toFile(target);
  else await image.jpeg({ quality: 95 }).toFile(target);

  return target;
}

async function pixelAt(file, x, y) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return Array.from(data.subarray(offset, offset + 3));
}

function isRed(pixel) {
  return pixel[0] > 150 && pixel[1] < 90;
}

function isBlue(pixel) {
  return pixel[2] > 150 && pixel[0] < 90;
}

test('normalizeDegrees: только кратные 90, отрицательные и большие приводятся к 0–270', () => {
  assert.equal(normalizeDegrees(90), 90);
  assert.equal(normalizeDegrees(-90), 270);
  assert.equal(normalizeDegrees(450), 90);
  assert.equal(normalizeDegrees(180), 180);
  assert.equal(normalizeDegrees(0), 0);

  assert.equal(normalizeDegrees(45), null);
  assert.equal(normalizeDegrees('abc'), null);
  assert.equal(normalizeDegrees(null), null);
  assert.equal(normalizeDegrees(undefined), null);
  assert.equal(normalizeDegrees(''), null);
});

test('isRotatablePath: JPEG, PNG и WebP можно, GIF и PDF — нет', () => {
  assert.equal(isRotatablePath('/uploads/images/a.jpg'), true);
  assert.equal(isRotatablePath('/uploads/images/a.JPEG'), true);
  assert.equal(isRotatablePath('/uploads/images/a.png'), true);
  assert.equal(isRotatablePath('/uploads/images/a.webp'), true);

  assert.equal(isRotatablePath('/uploads/images/a.gif'), false);
  assert.equal(isRotatablePath('/uploads/drawings/a.pdf'), false);
  assert.equal(isRotatablePath(''), false);
  assert.equal(isRotatablePath(null), false);
});

test('rotatePhotoFile на 90°: размеры меняются местами, левая половина уходит наверх', async () => {
  const dir = tempDir();
  const file = await makeImage(dir);
  const before = await photoSize(file);
  assert.deepEqual({ width: before.width, height: before.height }, { width: 200, height: 100 });

  const result = await rotatePhotoFile(file, 90);
  assert.deepEqual({ width: result.width, height: result.height }, { width: 100, height: 200 });

  // после поворота по часовой стрелке красная (левая) половина оказывается сверху
  assert.ok(isRed(await pixelAt(file, 50, 20)), 'верх должен быть красным');
  assert.ok(isBlue(await pixelAt(file, 50, 180)), 'низ должен быть синим');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('rotatePhotoFile на -90° (270°): левая половина уходит вниз', async () => {
  const dir = tempDir();
  const file = await makeImage(dir);

  const result = await rotatePhotoFile(file, -90);
  assert.deepEqual({ width: result.width, height: result.height }, { width: 100, height: 200 });

  assert.ok(isBlue(await pixelAt(file, 50, 20)), 'верх должен быть синим');
  assert.ok(isRed(await pixelAt(file, 50, 180)), 'низ должен быть красным');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('четыре поворота по 90° возвращают исходное фото', async () => {
  const dir = tempDir();
  const file = await makeImage(dir);

  for (let i = 0; i < 4; i += 1) await rotatePhotoFile(file, 90);

  const size = await photoSize(file);
  assert.deepEqual({ width: size.width, height: size.height }, { width: 200, height: 100 });
  assert.ok(isRed(await pixelAt(file, 20, 50)), 'левая половина снова красная');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('поворот сохраняет формат PNG и WebP', async () => {
  const dir = tempDir();
  const png = await makeImage(dir, 'photo.png', { format: 'png' });
  const webp = await makeImage(dir, 'photo.webp', { format: 'webp' });

  await rotatePhotoFile(png, 180);
  await rotatePhotoFile(webp, 180);

  assert.equal((await sharp(png).metadata()).format, 'png');
  assert.equal((await sharp(webp).metadata()).format, 'webp');
  assert.deepEqual(
    { width: (await sharp(png).metadata()).width, height: (await sharp(png).metadata()).height },
    { width: 200, height: 100 }
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('поворот не оставляет временных файлов рядом с фото', async () => {
  const dir = tempDir();
  const file = await makeImage(dir);

  await rotatePhotoFile(file, 90);
  await rotatePhotoFile(file, 270);

  const leftovers = fs.readdirSync(dir).filter(name => name.startsWith('.rot-') || name.startsWith('.orient-'));
  assert.deepEqual(leftovers, []);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('неподдерживаемый формат и кривой угол — 400 без изменения файла', async () => {
  const dir = tempDir();
  const gif = path.join(dir, 'photo.gif');
  fs.writeFileSync(gif, Buffer.from('474946383961', 'hex'));
  const file = await makeImage(dir);
  const before = fs.statSync(file).size;

  await assert.rejects(rotatePhotoFile(gif, 90), (err) => err.status === 400 && /нельзя повернуть/.test(err.message));
  await assert.rejects(rotatePhotoFile(file, 45), (err) => err.status === 400 && /кратен 90/.test(err.message));

  assert.equal(fs.statSync(file).size, before, 'файл не переписан при отказе');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('autoOrientPhoto запекает EXIF-ориентацию в пиксели', async () => {
  const dir = tempDir();
  // хранится 200×100, EXIF orientation=6 → показывать как 100×200
  const file = await makeImage(dir, 'exif.jpg', { orientation: 6 });
  assert.equal((await sharp(file).metadata()).orientation, 6);

  const changed = await autoOrientPhoto(file);
  assert.equal(changed, true);

  const metadata = await sharp(file).metadata();
  assert.deepEqual({ width: metadata.width, height: metadata.height }, { width: 100, height: 200 });
  assert.equal(metadata.orientation, undefined, 'метка ориентации больше не нужна');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('autoOrientPhoto не трогает фото без поворота', async () => {
  const dir = tempDir();
  const file = await makeImage(dir);
  const before = fs.statSync(file).size;

  assert.equal(await autoOrientPhoto(file), false);
  assert.equal(fs.statSync(file).size, before, 'файл не перекодирован');

  fs.rmSync(dir, { recursive: true, force: true });
});
