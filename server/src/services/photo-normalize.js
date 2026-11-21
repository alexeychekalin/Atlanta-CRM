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
 *   3. вписываем изделие в белый квадрат с полем ~7 % — так все карточки
 *      выглядят одинаково. Размер квадрата подбирается по самому изделию:
 *      крупное фото → 1000×1000, мелкое → меньше, чтобы не растягивать
 *      пиксели и не раздувать файл;
 *   4. сохраняем фотографией JPEG (прогрессивный) и перезаписываем файл
 *      атомарно. PNG/WebP-фото становятся `.jpg`: PNG на фотографиях
 *      в разы тяжелее (снимок фонаря — 436 КБ против 90 КБ), а браузер
 *      показывает такой файл «полосами» по мере загрузки.
 *
 * Уже нормализованные файлы повторно не кодируются: в EXIF стоит метка
 * atlanta-normalized-*. Это важно для скрипта, который можно запускать
 * повторно, и чтобы не терять качество JPEG при каждом прогоне.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Максимальная сторона квадрата. Меньше — только если фото мелкое.
const SIZE = 1000;
// Минимальная сторона квадрата: совсем крошечные фото растягиваем умеренно.
const MIN_CANVAS = 320;
// Поле вокруг изделия с каждой стороны: 7 % — изделие занимает 86 % кадра.
const PADDING = 0.07;
// Насколько можно увеличить изделие: мелкое фото не должно стать мылом.
const MAX_SCALE = 1.6;
const QUALITY = 88;
// Порог «это фон, а не товар»: насколько пиксель должен отличаться от белого.
const TRIM_THRESHOLD = 16;
// Совсем крошечные картинки (иконки, превью) не трогаем.
const MIN_SIDE = 64;
const MAX_PIXELS = 40 * 1000 * 1000;

// Метка нормализации в EXIF: по ней узнаём своё фото и не кодируем его снова.
const MARKER = 'atlanta-normalized-v2';
// Первая версия метки: файлы, обработанные до перехода на JPEG.
const LEGACY_MARKER = 'atlanta-normalized-v1';

const NORMALIZABLE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const JPEG_EXTENSIONS = ['.jpg', '.jpeg'];

function extensionOf(filePath) {
  return path.extname(String(filePath || '')).toLowerCase();
}

function isNormalizablePhoto(filePath) {
  return NORMALIZABLE_EXTENSIONS.includes(extensionOf(filePath));
}

function loadSharp() {
  return require('sharp');
}

function hasNormalizeMarker(metadata) {
  if (!metadata || !metadata.exif) return false;
  const exif = metadata.exif;
  return exif.includes(Buffer.from(MARKER)) || exif.includes(Buffer.from(LEGACY_MARKER));
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
 * Размер квадрата под конкретное фото: изделие занимает 86 % кадра,
 * но увеличиваем не больше чем в MAX_SCALE раз и не больше SIZE.
 */
function canvasFor(width, height, size = SIZE, padding = PADDING) {
  const longest = Math.max(width, height);
  const maxObject = Math.round(size * (1 - padding * 2));
  const object = Math.min(maxObject, Math.round(longest * MAX_SCALE));
  const canvas = Math.min(size, Math.max(MIN_CANVAS, Math.round(object / (1 - padding * 2))));
  return { canvas, object: Math.round(canvas * (1 - padding * 2)) };
}

/** Имя файла с расширением .jpg (или .jpeg, если так было). */
function jpegName(filePath) {
  const extension = extensionOf(filePath);
  const target = JPEG_EXTENSIONS.includes(extension) ? extension : '.jpg';
  return path.join(
    path.dirname(filePath),
    `${path.basename(filePath, extension)}${target}`
  );
}

/**
 * Нормализует фото на месте.
 * Возвращает { changed, reason, path, width, height, size }.
 *   changed=false + reason='already-normalized' — файл уже в нужном виде;
 *   changed=false + reason='too-small'         — меньше 64 px по стороне;
 *   changed=false + reason='unsupported'       — не фото (gif, pdf и т. п.).
 * `path` — итоговый путь: у PNG/WebP он меняется на `.jpg`.
 * Ошибки чтения/записи пробрасываются: вызывающий сам решает, критично ли это.
 */
async function normalizeProductPhoto(filePath, options = {}) {
  const size = options.size || SIZE;
  const padding = options.padding === undefined ? PADDING : options.padding;
  const extension = extensionOf(filePath);

  if (!isNormalizablePhoto(filePath)) {
    return { changed: false, reason: 'unsupported', path: filePath };
  }

  const sharp = loadSharp();
  const metadata = await sharp(filePath, { limitInputPixels: MAX_PIXELS }).metadata();
  if (!metadata.width || !metadata.height) {
    return { changed: false, reason: 'no-size', path: filePath };
  }
  if (Math.min(metadata.width, metadata.height) < MIN_SIDE) {
    return { changed: false, reason: 'too-small', path: filePath, width: metadata.width, height: metadata.height };
  }

  // Своё фото узнаём по метке: раскладывать его по квадрату второй раз
  // нельзя — каждое перекодирование съедает качество.
  if (hasNormalizeMarker(metadata) && JPEG_EXTENSIONS.includes(extension)) {
    return { changed: false, reason: 'already-normalized', path: filePath, width: metadata.width, height: metadata.height };
  }

  const corners = await cornerStats(sharp, filePath);

  const trimmedBuffer = corners.uniform
    ? await trimMargins(sharp, filePath, formatBackground(corners.color), metadata.hasAlpha)
    : await trimMargins(sharp, filePath, '#ffffff', metadata.hasAlpha);

  const trimmed = await sharp(trimmedBuffer).metadata();
  const { canvas, object } = canvasFor(trimmed.width, trimmed.height, size, padding);

  const { data: body, info: bodyInfo } = await sharp(trimmedBuffer)
    .resize({ width: object, height: object, fit: 'inside' })
    .toBuffer({ resolveWithObject: true });

  const targetPath = jpegName(filePath);
  const tempPath = path.join(
    path.dirname(targetPath),
    `.norm-${crypto.randomBytes(6).toString('hex')}.jpg`
  );

  const pipeline = () => sharp({
    create: { width: canvas, height: canvas, channels: 3, background: '#ffffff' },
  })
    .composite([{
      input: body,
      left: Math.max(0, Math.round((canvas - bodyInfo.width) / 2)),
      top: Math.max(0, Math.round((canvas - bodyInfo.height) / 2)),
    }])
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    // 4:4:4 — без «мыла» на мелких надписях и кромках, как у схем и чертежей
    .jpeg({ quality: QUALITY, mozjpeg: true, progressive: true, chromaSubsampling: '4:4:4' })
    .withMetadata({ exif: { IFD0: { ImageDescription: MARKER } } });

  try {
    // Проверка «что изменится» не должна трогать файлы — только считаем результат
    if (options.dryRun) {
      const { info } = await pipeline().toBuffer({ resolveWithObject: true });
      return {
        changed: true, reason: 'normalized', path: targetPath,
        width: canvas, height: canvas, size: info.size, dryRun: true,
        renamed: targetPath !== filePath,
      };
    }

    await pipeline().toFile(tempPath);
    await fs.promises.rename(tempPath, targetPath);
    // PNG/WebP-оригинал больше не нужен: на его место встал JPEG
    if (targetPath !== filePath) {
      await fs.promises.unlink(filePath).catch(() => {});
    }
    const stat = await fs.promises.stat(targetPath);
    return {
      changed: true,
      reason: 'normalized',
      path: targetPath,
      width: canvas,
      height: canvas,
      size: stat.size,
      renamed: targetPath !== filePath,
      trimmed: bodyInfo.width < trimmed.width || bodyInfo.height < trimmed.height,
    };
  } catch (err) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw err;
  }
}

module.exports = {
  SIZE,
  MIN_CANVAS,
  PADDING,
  MAX_SCALE,
  MARKER,
  LEGACY_MARKER,
  NORMALIZABLE_EXTENSIONS,
  isNormalizablePhoto,
  hasNormalizeMarker,
  canvasFor,
  normalizeProductPhoto,
};
