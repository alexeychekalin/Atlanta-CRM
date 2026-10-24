const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Корень пользовательских файлов. Все пути из БД/запросов обязаны находиться внутри него.
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
const UPLOADS_URL_PREFIX = '/uploads/';

/**
 * Проверяет, что путь из запроса/БД указывает на файл внутри uploads.
 * Принимает только URL-пути вида "/uploads/<subdir>/<file>".
 * Возвращает абсолютный путь или null, если путь небезопасен.
 */
function safeUploadPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return null;
  if (value.includes('\0')) return null;

  const clean = value.split('?')[0].split('#')[0];
  if (!clean.startsWith(UPLOADS_URL_PREFIX)) return null;

  const relative = clean.slice(UPLOADS_URL_PREFIX.length);
  if (!relative) return null;

  const absolute = path.resolve(UPLOADS_DIR, relative);
  const rootWithSep = UPLOADS_DIR.endsWith(path.sep) ? UPLOADS_DIR : UPLOADS_DIR + path.sep;
  if (absolute !== UPLOADS_DIR && !absolute.startsWith(rootWithSep)) return null;

  return absolute;
}

/**
 * Нормализует путь к виду "/uploads/...". Возвращает null для небезопасных путей.
 */
function normalizeUploadPath(value) {
  const absolute = safeUploadPath(value);
  if (!absolute) return null;
  const relative = path.relative(UPLOADS_DIR, absolute).split(path.sep).join('/');
  return UPLOADS_URL_PREFIX + relative;
}

/**
 * SHA-256 загруженного файла по его URL-пути.
 * Нужен, чтобы не хранить один и тот же файл чертежа дважды.
 */
function fileSha256(value) {
  const absolute = safeUploadPath(value);
  if (!absolute || !fs.existsSync(absolute)) return null;
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Безопасное имя файла для записи в ZIP (защита от zip-slip и пустых имён).
 */
function safeArchiveName(name, fallback = 'file') {
  const base = path.basename(String(name || '').replace(/\\/g, '/')).trim();
  if (!base || base === '.' || base === '..') return fallback;
  return base.slice(0, 200);
}

/**
 * Проверяет сигнатуру файла (магические байты) для основных форматов.
 * Возвращает true, если содержимое соответствует заявленному расширению.
 */
function hasValidSignature(filePath, ext) {
  const fs = require('fs');
  let buffer;
  try {
    const fd = fs.openSync(filePath, 'r');
    buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
  } catch {
    return false;
  }

  const hex = buffer.toString('hex').toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return hex.startsWith('ffd8ff');
    case '.png':
      return hex.startsWith('89504e470d0a1a0a');
    case '.gif':
      return hex.startsWith('474946383761') || hex.startsWith('474946383961');
    case '.webp':
      return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    case '.pdf':
      return buffer.toString('ascii', 0, 5) === '%PDF-';
    case '.tif':
    case '.tiff':
      return hex.startsWith('49492a00') || hex.startsWith('4d4d002a');
    // ZIP-контейнеры: docx/xlsx/pptx/odt/ods и обычные архивы
    case '.zip':
    case '.docx':
    case '.xlsx':
    case '.pptx':
    case '.odt':
    case '.ods':
      return hex.startsWith('504b0304') || hex.startsWith('504b0506') || hex.startsWith('504b0708');
    // Старый формат Office (OLE2): doc/xls/ppt
    case '.doc':
    case '.xls':
    case '.ppt':
      return hex.startsWith('d0cf11e0a1b11ae1');
    case '.rar':
      return hex.startsWith('52617221');
    case '.7z':
      return hex.startsWith('377abcaf271c');
    // Все версии DWG начинаются с «AC10»
    case '.dwg':
      return buffer.toString('ascii', 0, 4) === 'AC10';
    // Текстовые форматы: сигнатуры нет, файлы отдаются как text/plain
    case '.txt':
    case '.csv':
    case '.md':
    case '.dxf':
      return true;
    default:
      return false;
  }
}

module.exports = {
  fileSha256,
  UPLOADS_DIR,
  UPLOADS_URL_PREFIX,
  safeUploadPath,
  normalizeUploadPath,
  safeArchiveName,
  hasValidSignature,
};
