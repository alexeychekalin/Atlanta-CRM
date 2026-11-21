/* Нормализация фото изделий.
 *
 * Зачем: фото приходят из разных источников — студийные снимки поставщика,
 * фото с телефона, картинки без фона. У них разный размер, разное количество
 * белых полей и разный фон, поэтому в сетке каталога изделия «пляшут»:
 * одно занимает весь кадр, другое теряется в белом поле.
 *
 * Что делаем при загрузке (и разово для уже загруженных фото):
 *   1. прозрачность заливаем белым — карточка каталога тёмная, иначе
 *      «дырки» просвечивают фоном;
 *   2. обрезаем однотонные поля по краям (обычно белые);
 *   3. вписываем изделие в белый квадрат 1000×1000 с полем ~7 %,
 *      не увеличивая больше чем в 2,5 раза, чтобы не мылить мелкие фото;
 *   4. сохраняем в тот же формат и перезаписываем файл атомарно —
 *      путь в базе не меняется.
 *
 * Уже нормализованные файлы повторно не кодируются: квадрат 1000×1000
 * с белыми полями ~7 % считается готовым. Это важно для скрипта, который
 * можно запускать повторно, и чтобы не терять качество JPEG.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SIZE = 1000;
// Поле вокруг изделия с каждой стороны: 7 % — изделие занимает 86 % кадра.
const PADDING = 0.07;
const QUALITY = 88;
// Порог «это фон, а не товар»: насколько пиксель должен отличаться от белого.
const TRIM_THRESHOLD = 16;
// Совсем крошечные картинки (иконки, превью) не трогаем: растягивать нечего.
const MIN_SIDE = 64;
// Максимальное увеличение при вписывании в квадрат (по длинной стороне).
const MAX_SCALE = 3;
const MAX_PIXELS = 40 * 1000 * 1000;

const NORMALIZABLE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

// Метка в EXIF: по ней узнаём своё фото и не перекодируем его повторно.
// Без метки небольшие фото (их увеличение ограничено) каждый запуск
// растягивались бы заново и теряли качество.
const MARKER = 'atlanta-normalized-v1';

function hasNormalizeMarker(metadata) {
  return Boolean(metadata && metadata.exif && metadata.exif.includes(Buffer.from(MARKER)));
}

function extensionOf(filePath) {
  return path.extname(String(filePath || '')).toLowerCase();
}

function isNormalizablePhoto(filePath) {
  return NORMALIZABLE_EXTENSIONS.includes(extensionOf(filePath));
}

function loadSharp() {
  return require('sharp');
}

function outputFormat(extension) {
  if (extension === '.png') return { type: 'png', options: { compressionLevel: 9 } };
  if (extension === '.webp') return { type: 'webp', options: { quality: QUALITY } };
  return { type: 'jpeg', options: { quality: QUALITY, mozjpeg: true, progressive: true } };
}

/**
 * Цвет и «однородность» четырёх углов. По ним понимаем, можно ли обрезать
 * поля: если углы белые и похожи друг на друга — фон белый.
 */
async function cornerStats(sharp, filePath) {
  const { data, info } = await sharp(filePath, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(24, 24, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixel = (x, y) => {
    const offset = (y * info.width + x) * info.channels;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
  const corners = [
    pixel(1, 1),
    pixel(info.width - 2, 1),
    pixel(1, info.height - 2),
    pixel(info.width - 2, info.height - 2),
  ];
  const luminance = rgb => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const values = corners.map(luminance);
  const ownLightness = corners.map(rgb => Math.max(...rgb) - Math.min(...rgb));

  return {
    white: Math.min(...values) >= 232 && Math.max(...values) - Math.min(...values) <= 20,
    // Углы одного цвета: фон однотонный (серый, синий и т. п.) — поля тоже можно убрать
    uniform: Math.max(...values) - Math.min(...values) <= 12 && Math.max(...ownLightness) <= 12,
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    color: corners[0],
  };
}

/**
 * Обрезает однотонные поля. Если обрезать нечего или фон неоднородный,
 * возвращает исходный буфер — фото всё равно попадёт в квадрат.
 */
async function trimMargins(sharp, filePath, background, hasAlpha) {
  const open = () => sharp(filePath, { limitInputPixels: MAX_PIXELS }).rotate();

  // У прозрачных PNG flatten и trim в одном конвейере не срабатывают:
  // trim читает исходные пиксели, а не залитые белым. Поэтому сначала
  // заливаем прозрачность в буфер, потом обрезаем его.
  if (hasAlpha) {
    const flattened = await open().flatten({ background: '#ffffff' }).png().toBuffer();
    try {
      return await sharp(flattened).trim({ background, threshold: TRIM_THRESHOLD }).toBuffer();
    } catch {
      return flattened;
    }
  }

  const base = open().flatten({ background: '#ffffff' });
  try {
    return await base.trim({ background, threshold: TRIM_THRESHOLD }).toBuffer();
  } catch {
    return base.toBuffer();
  }
}

function formatBackground(color) {
  const [r, g, b] = color;
  return { r, g, b };
}

/**
 * Нормализует фото на месте.
 * Возвращает { changed, reason, width, height, size }.
 *   changed=false + reason='already-normalized' — файл уже в нужном виде;
 *   changed=false + reason='too-small'         — меньше 64 px по стороне (иконка, а не фото);
 *   changed=false + reason='unsupported'       — не фото (gif, pdf и т. п.).
 * Ошибки чтения/записи пробрасываются: вызывающий сам решает, критично ли это.
 */
async function normalizeProductPhoto(filePath, options = {}) {
  const size = options.size || SIZE;
  const padding = options.padding === undefined ? PADDING : options.padding;
  const extension = extensionOf(filePath);

  if (!isNormalizablePhoto(filePath)) {
    return { changed: false, reason: 'unsupported' };
  }

  const sharp = loadSharp();
  const metadata = await sharp(filePath, { limitInputPixels: MAX_PIXELS }).metadata();
  if (!metadata.width || !metadata.height) {
    return { changed: false, reason: 'no-size' };
  }
  if (Math.min(metadata.width, metadata.height) < MIN_SIDE) {
    return { changed: false, reason: 'too-small', width: metadata.width, height: metadata.height };
  }

  // Своё фото узнаём по метке: раскладывать его по квадрату второй раз
  // нельзя — каждое перекодирование съедает качество.
  if (metadata.width === size && metadata.height === size && hasNormalizeMarker(metadata)) {
    return { changed: false, reason: 'already-normalized', width: size, height: size };
  }

  const corners = await cornerStats(sharp, filePath);

  const trimmedBuffer = corners.uniform
    ? await trimMargins(sharp, filePath, formatBackground(corners.color), metadata.hasAlpha)
    : await trimMargins(sharp, filePath, '#ffffff', metadata.hasAlpha);

  const trimmed = await sharp(trimmedBuffer).metadata();
  const inner = Math.max(1, Math.round(size * (1 - padding * 2)));
  // Не увеличиваем больше MAX_SCALE: мелкое фото лучше оставить мелким в кадре,
  // чем растянуть его до мыла на весь квадрат.
  const limit = Math.round(Math.max(trimmed.width, trimmed.height) * MAX_SCALE);
  const box = Math.min(inner, Math.max(limit, 1));

  const { data: body, info: bodyInfo } = await sharp(trimmedBuffer)
    .resize({ width: box, height: box, fit: 'inside' })
    .toBuffer({ resolveWithObject: true });

  const { type, options: encodeOptions } = outputFormat(extension);
  const tempPath = path.join(
    path.dirname(filePath),
    `.norm-${crypto.randomBytes(6).toString('hex')}${extension}`
  );

  const pipeline = () => sharp({
    create: { width: size, height: size, channels: 3, background: '#ffffff' },
  })
    .composite([{
      input: body,
      left: Math.max(0, Math.round((size - bodyInfo.width) / 2)),
      top: Math.max(0, Math.round((size - bodyInfo.height) / 2)),
    }])
    // прозрачность исходника залита белым: PNG остаётся PNG, но без альфы
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .withMetadata({ exif: { IFD0: { ImageDescription: MARKER } } })
    .toFormat(type, encodeOptions);

  try {
    // Проверка «что изменится» не должна трогать файлы — только считаем результат
    if (options.dryRun) {
      const { info } = await pipeline().toBuffer({ resolveWithObject: true });
      return { changed: true, reason: 'normalized', width: size, height: size, size: info.size, dryRun: true };
    }

    await pipeline().toFile(tempPath);
    await fs.promises.rename(tempPath, filePath);
    const stat = await fs.promises.stat(filePath);
    return {
      changed: true,
      reason: 'normalized',
      width: size,
      height: size,
      size: stat.size,
      trimmed: bodyInfo.width < trimmed.width || bodyInfo.height < trimmed.height,
    };
  } catch (err) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw err;
  }
}

module.exports = {
  SIZE,
  MARKER,
  hasNormalizeMarker,
  PADDING,
  MIN_SIDE,
  MAX_SCALE,
  NORMALIZABLE_EXTENSIONS,
  isNormalizablePhoto,
  normalizeProductPhoto,
};
