/* HEIC/HEIF → JPEG: фото с iPhone и iPad.
 *
 * iPhone по умолчанию снимает в HEIC (HEVC внутри контейнера HEIF). Браузеры
 * на Windows и Android такие файлы не показывают, а `sharp` в готовых сборках
 * HEVC не декодирует, поэтому конвертируем чистым WASM-декодером libheif
 * (пакет `heic-convert`) — без системных библиотек и без правки прав на сервере.
 *
 * Конвертация идёт в JPEG: он открывается везде и совпадает с тем, что CRM
 * уже принимает. Ориентацию (irot/imir) libheif применяет сам — фото с телефона
 * не приезжает повёрнутым.
 *
 * Декодирование 12 Мп занимает около секунды и до ~250 МБ памяти, поэтому
 * конвертации выполняются по очереди: несколько одновременных загрузок с
 * телефона не положат сервер.
 */
const fs = require('fs');
const path = require('path');

// Контейнер HEIF может содержать HEVC (iPhone), AV1 (AVIF) и другие кодеки.
// Нас интересуют только HEIC-бренды, которые умеет декодировать libheif-js.
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'];
const HEIC_EXTENSIONS = ['.heic', '.heif'];

// Ограничение на размер картинки: 40 Мп — это уже очень много для фото товара,
// а декодирование такого снимка может занять гигабайт памяти.
const MAX_PIXELS = 40 * 1000 * 1000;

// Качество JPEG: 0.85 — размер в разы меньше, на глаз отличий не видно.
const DEFAULT_QUALITY = 0.85;

function isHeicExtension(ext) {
  return HEIC_EXTENSIONS.includes(String(ext || '').toLowerCase());
}

/** HEIC/HEIF определяем по сигнатуре, а не по расширению: имя файла врёт. */
function isHeicBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brand = buffer.toString('ascii', 8, 12).toLowerCase();
  return HEIF_BRANDS.includes(brand);
}

/** Основной бренд контейнера: 'heic', 'mif1', 'avif'… — для сообщений. */
function heifBrand(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (buffer.toString('ascii', 4, 8) !== 'ftyp') return '';
  return buffer.toString('ascii', 8, 12).toLowerCase();
}

/** Размеры картинки из контейнера, без декодирования пикселей. */
function readHeicSize(buffer) {
  if (!isHeicBuffer(buffer)) return null;
  const libheif = require('libheif-js/wasm-bundle');
  const decoder = new libheif.HeifDecoder();
  let images = [];
  try {
    images = decoder.decode(buffer) || [];
    if (images.length === 0) return null;
    return { width: images[0].get_width(), height: images[0].get_height() };
  } catch {
    return null;
  } finally {
    for (const image of images) image.free();
    try {
      if (decoder.decoder) decoder.decoder.delete();
    } catch {
      /* внутренний объект мог быть уже освобождён */
    }
  }
}

// Очередь: одна конвертация за раз, чтобы не съесть память параллельными.
let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task, task);
  // Хвост очереди не должен ломаться от ошибки отдельного файла
  queue = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Конвертирует HEIC-файл на диске в JPEG рядом с ним.
 * Исходник удаляется: в CRM должен остаться один рабочий файл.
 * Возвращает { path, filename, size, width, height }.
 */
async function convertHeicFile(filePath, options = {}) {
  const quality = Number(options.quality) > 0 ? Number(options.quality) : DEFAULT_QUALITY;
  const maxPixels = Number(options.maxPixels) > 0 ? Number(options.maxPixels) : MAX_PIXELS;

  const buffer = await fs.promises.readFile(filePath);
  if (!isHeicBuffer(buffer)) {
    const error = new Error('Файл не похож на HEIC/HEIF');
    error.status = 400;
    throw error;
  }

  const size = readHeicSize(buffer);
  if (size && size.width * size.height > maxPixels) {
    const mp = Math.round(size.width * size.height / 1e6);
    const error = new Error(
      `Фото слишком большое: ${size.width}×${size.height} (${mp} Мп). `
      + 'Максимум 40 Мп — снимите обычное фото или уменьшите снимок'
    );
    error.status = 400;
    throw error;
  }

  // Тяжёлый WASM подгружаем только когда действительно пришёл HEIC
  const convert = require('heic-convert');
  const output = await convert({ buffer, format: 'JPEG', quality });

  const target = filePath.replace(/\.(heic|heif)$/i, '') + '.jpg';
  const jpeg = Buffer.from(output);
  await fs.promises.writeFile(target, jpeg);

  if (path.resolve(target) !== path.resolve(filePath)) {
    try {
      await fs.promises.unlink(filePath);
    } catch {
      /* исходник мог уже исчезнуть — не мешает результату */
    }
  }

  return {
    path: target,
    filename: path.basename(target),
    size: jpeg.length,
    width: size ? size.width : null,
    height: size ? size.height : null,
  };
}

/** То же, но через очередь — так вызывают маршруты загрузки. */
function convertHeicQueued(filePath, options = {}) {
  return enqueue(() => convertHeicFile(filePath, options));
}

module.exports = {
  HEIC_EXTENSIONS,
  HEIF_BRANDS,
  MAX_PIXELS,
  DEFAULT_QUALITY,
  isHeicExtension,
  isHeicBuffer,
  heifBrand,
  readHeicSize,
  convertHeicFile,
  convertHeicQueued,
};
