/* Работа с растровыми фото на сервере: ориентация и поворот.
 *
 * Зачем это нужно:
 *   • телефон пишет в EXIF, как повёрнут снимок, а сами пиксели хранит боком.
 *     Если EXIF потерять (например, при конвертации HEIC → JPEG), фото
 *     показывается лёжа. Поэтому ориентацию «запекаем» в пиксели при загрузке.
 *   • кнопка «повернуть» в просмотре фото должна сохранять положение:
 *     файл перезаписывается на месте, путь в базе не меняется, поэтому
 *     поворот сразу виден везде — в галерее, обложке, миниатюрах.
 *
 * Перезапись атомарная: sharp пишет во временный файл рядом, затем rename.
 * Так читатель никогда не увидит недописанный JPEG.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Форматы, которые умеет поворачивать sharp и которые мы храним как есть.
// GIF не трогаем: анимация при перекодировании рассыпается на первый кадр.
const ROTATABLE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

// Защита от «бомб»: 40 Мп — тот же предел, что и для HEIC.
const MAX_PIXELS = 40 * 1000 * 1000;

function extensionOf(filePath) {
  return path.extname(String(filePath || '')).toLowerCase();
}

function isRotatablePath(filePath) {
  return ROTATABLE_EXTENSIONS.includes(extensionOf(filePath));
}

/** Любое число градусов → 0/90/180/270. Всё остальное — null (не поворот). */
function normalizeDegrees(value) {
  if (value === null || value === undefined || value === '') return null;
  const degrees = Number(value);
  if (!Number.isFinite(degrees) || degrees % 90 !== 0) return null;
  return ((degrees % 360) + 360) % 360;
}

function formatOf(extension) {
  if (extension === '.png') return { type: 'png', options: {} };
  if (extension === '.webp') return { type: 'webp', options: { quality: 90 } };
  return { type: 'jpeg', options: { quality: 90, mozjpeg: true } };
}

function loadSharp() {
  // sharp грузится лениво: без него сервер работает, просто без поворота
  return require('sharp');
}

/**
 * Поворачивает файл на месте. degrees — 90/180/270 (0 — без изменений).
 * Возвращает { width, height, size } итогового файла.
 */
async function rotatePhotoFile(filePath, degrees) {
  const angle = normalizeDegrees(degrees);
  if (angle === null) {
    const error = new Error('Угол поворота должен быть кратен 90°');
    error.status = 400;
    throw error;
  }
  if (!isRotatablePath(filePath)) {
    const error = new Error('Этот формат нельзя повернуть');
    error.status = 400;
    throw error;
  }
  if (angle === 0) {
    return photoSize(filePath);
  }

  const sharp = loadSharp();
  const extension = extensionOf(filePath);
  const { type, options } = formatOf(extension);

  const tempPath = path.join(
    path.dirname(filePath),
    `.rot-${crypto.randomBytes(6).toString('hex')}${extension}`
  );

  try {
    // autoOrient() первым: сначала фото ставится ровно по EXIF, потом поворот
    const result = await sharp(filePath, { limitInputPixels: MAX_PIXELS })
      .autoOrient()
      .rotate(angle)
      .toFormat(type, options)
      .toFile(tempPath);

    await fs.promises.rename(tempPath, filePath);
    const stat = await fs.promises.stat(filePath);
    return { width: result.width, height: result.height, size: stat.size };
  } catch (err) {
    await fs.promises.unlink(tempPath).catch(() => {});
    if (err.status) throw err;
    const error = new Error(`Не удалось повернуть фото: ${err.message}`);
    error.status = err.code === 'Input file is missing' ? 404 : 400;
    throw error;
  }
}

/**
 * «Запекает» EXIF-ориентацию в пиксели. Перекодирует файл только если
 * orientation действительно задан (обычно 1 у фото без поворота),
 * чтобы не терять качество и не тратить время впустую.
 * Возвращает true, если файл был переписан.
 */
async function autoOrientPhoto(filePath) {
  if (!isRotatablePath(filePath)) return false;

  const sharp = loadSharp();
  let metadata;
  try {
    metadata = await sharp(filePath, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    return false;
  }
  const orientation = Number(metadata.orientation) || 1;
  if (orientation <= 1) return false;

  const extension = extensionOf(filePath);
  const { type, options } = formatOf(extension);
  const tempPath = path.join(
    path.dirname(filePath),
    `.orient-${crypto.randomBytes(6).toString('hex')}${extension}`
  );

  try {
    await sharp(filePath, { limitInputPixels: MAX_PIXELS })
      .autoOrient()
      .toFormat(type, options)
      .toFile(tempPath);
    await fs.promises.rename(tempPath, filePath);
    return true;
  } catch {
    await fs.promises.unlink(tempPath).catch(() => {});
    // Не смогли — оставляем файл как есть: это не повод отклонять загрузку
    return false;
  }
}

/** Размеры хранимого файла (без учёта EXIF). */
async function photoSize(filePath) {
  const sharp = loadSharp();
  const metadata = await sharp(filePath, { limitInputPixels: MAX_PIXELS }).metadata();
  const stat = await fs.promises.stat(filePath);
  return { width: metadata.width, height: metadata.height, size: stat.size };
}

module.exports = {
  ROTATABLE_EXTENSIONS,
  MAX_PIXELS,
  isRotatablePath,
  normalizeDegrees,
  rotatePhotoFile,
  autoOrientPhoto,
  photoSize,
};
