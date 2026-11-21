/**
 * Библиотека документов — правила, общие для маршрутов, интерфейса и тестов.
 *
 * Здесь нет запросов к базе: только чистые функции. Так проще проверять
 * то, что ломается чаще всего, — имена папок и файлов, вложенность,
 * имена внутри ZIP и заголовок Content-Disposition для кириллицы.
 */
const path = require('path');

/** Предел на один файл — как у файлов клиента в карточке. */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Что принимаем в библиотеку. HTML, SVG, JS и исполняемые файлы не входят:
 * они исполняются в браузере при открытии.
 */
const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.doc', '.docx', '.odt',
  '.xls', '.xlsx', '.ods',
  '.ppt', '.pptx',
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff',
  '.txt', '.csv', '.md',
  '.zip', '.rar', '.7z',
  '.dwg', '.dxf',
];

const ALLOWED_EXTENSION_SET = new Set(ALLOWED_EXTENSIONS);

/** Подписи форматов для интерфейса: иконка и короткое название. */
const FILE_KINDS = {
  pdf: { icon: '📕', label: 'PDF' },
  doc: { icon: '📝', label: 'Word' },
  docx: { icon: '📝', label: 'Word' },
  odt: { icon: '📝', label: 'Writer' },
  xls: { icon: '📊', label: 'Excel' },
  xlsx: { icon: '📊', label: 'Excel' },
  ods: { icon: '📊', label: 'Calc' },
  ppt: { icon: '📽️', label: 'PowerPoint' },
  pptx: { icon: '📽️', label: 'PowerPoint' },
  jpg: { icon: '🖼️', label: 'Фото' },
  jpeg: { icon: '🖼️', label: 'Фото' },
  png: { icon: '🖼️', label: 'Фото' },
  webp: { icon: '🖼️', label: 'Фото' },
  gif: { icon: '🖼️', label: 'Фото' },
  tif: { icon: '🖼️', label: 'Скан' },
  tiff: { icon: '🖼️', label: 'Скан' },
  txt: { icon: '📃', label: 'Текст' },
  csv: { icon: '📃', label: 'CSV' },
  md: { icon: '📃', label: 'Текст' },
  zip: { icon: '🗜️', label: 'Архив' },
  rar: { icon: '🗜️', label: 'Архив' },
  '7z': { icon: '🗜️', label: 'Архив' },
  dwg: { icon: '📐', label: 'Чертёж' },
  dxf: { icon: '📐', label: 'Чертёж' },
};

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.dwg': 'image/vnd.dwg',
  '.dxf': 'image/vnd.dxf',
};

const MAX_NAME_LENGTH = 120;
// В имени папки не должно быть разделителей пути и символов, недопустимых в Windows
const FORBIDDEN_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Расширение в нижнем регистре: «Скан.PDF» → «.pdf».
 *  Точка без букв после неё («файл.») расширением не считается. */
function extensionOf(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return ext === '.' ? '' : ext;
}

/** Можно ли такой файл положить в библиотеку. */
function isAllowedFile(name) {
  return ALLOWED_EXTENSION_SET.has(extensionOf(name));
}

/**
 * Имя папки: обрезаем, схлопываем пробелы, убираем запрещённые символы.
 * Возвращает null, если после чистки ничего не осталось.
 */
function normalizeFolderName(value) {
  const cleaned = String(value === null || value === undefined ? '' : value)
    .replace(FORBIDDEN_NAME, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return cleaned || null;
}

/**
 * Имя файла: сохраняем расширение, чистим запрещённые символы.
 * Пустое имя заменяем запасным — файл без имени в списке бесполезен.
 */
function normalizeFileName(value, fallback = 'Документ') {
  const raw = String(value === null || value === undefined ? '' : value)
    .replace(/[\\/\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const ext = extensionOf(raw);
  let base = ext ? raw.slice(0, -ext.length) : raw;
  // В Windows имя не может заканчиваться точкой или пробелом
  base = base.replace(/[.:\s]+$/, '').replace(/[*:?"<>|]/g, '').trim();
  if (!base) base = fallback;
  base = base.slice(0, MAX_NAME_LENGTH - ext.length);
  return `${base}${ext}`;
}

/** Иконка и подпись формата для интерфейса. */
function fileKind(name) {
  const ext = extensionOf(name).replace('.', '');
  return FILE_KINDS[ext] || { icon: '📄', label: ext ? ext.toUpperCase() : 'Файл' };
}

/** Картинку показываем в просмотрщике, остальное — скачиваем. */
function isPreviewable(name) {
  return IMAGE_EXTENSIONS.has(extensionOf(name)) || extensionOf(name) === '.pdf';
}

function isImage(name) {
  return IMAGE_EXTENSIONS.has(extensionOf(name));
}

function mimeType(name) {
  return MIME_TYPES[extensionOf(name)] || 'application/octet-stream';
}

/**
 * Цепочка папок от корня до указанной включительно.
 * folders — плоский список { id, name, parent_id }.
 */
function breadcrumbs(folders, folderId) {
  const byId = new Map(folders.map(folder => [Number(folder.id), folder]));
  const chain = [];
  let current = byId.get(Number(folderId));
  let guard = 0;

  while (current && guard < 100) {
    chain.unshift({ id: Number(current.id), name: current.name });
    current = current.parent_id ? byId.get(Number(current.parent_id)) : null;
    guard += 1;
  }
  return chain;
}

/**
 * Пути папок внутри архива.
 *
 * rootId = null — весь архив: «Сертификаты/2026».
 * rootId = 7   — архив папки 7: сама папка тоже становится верхним уровнем,
 *                чтобы распакованный архив не рассыпался файлами в текущую папку.
 */
function folderPaths(folders, rootId = null) {
  const byId = new Map(folders.map(folder => [Number(folder.id), folder]));
  const cache = new Map();
  const root = rootId === null || rootId === undefined ? null : Number(rootId);

  function build(id, guard = 0) {
    const key = Number(id);
    if (cache.has(key)) return cache.get(key);
    const folder = byId.get(key);
    if (!folder || guard > 100) return '';

    let result;
    if (root !== null && key === root) {
      result = folder.name;
    } else {
      const parentPath = folder.parent_id ? build(folder.parent_id, guard + 1) : '';
      result = parentPath ? `${parentPath}/${folder.name}` : folder.name;
    }
    cache.set(key, result);
    return result;
  }

  const paths = new Map();
  for (const folder of folders) paths.set(Number(folder.id), build(folder.id));
  return paths;
}

/**
 * Имена файлов внутри ZIP с учётом вложенности и совпадающих имён.
 * Одинаковые имена в одной папке получают « (2)», « (3)» — распаковка
 * не должна затирать файлы.
 */
function archiveEntries(folders, files, rootId = null) {
  const paths = folderPaths(folders, rootId);
  const used = new Set();

  return files.map(file => {
    const folderPath = file.folder_id ? (paths.get(Number(file.folder_id)) || '') : '';
    // Имя из базы может быть любым (старые записи) — в ZIP не должно быть
    // разделителей пути и символов, которые запрещены в Windows.
    const baseName = String(file.name || 'file')
      .replace(/[\\/\u0000-\u001f]/g, ' ')
      .replace(/[*:?"<>|]/g, '')
      .trim() || 'file';
    const ext = path.extname(baseName);
    const stem = ext ? baseName.slice(0, -ext.length) : baseName;
    let candidate = baseName;
    let counter = 2;
    let key = `${folderPath}/${candidate}`.toLowerCase();

    while (used.has(key)) {
      candidate = `${stem} (${counter})${ext}`;
      key = `${folderPath}/${candidate}`.toLowerCase();
      counter += 1;
    }
    used.add(key);

    return {
      file,
      name: folderPath ? `${folderPath}/${candidate}` : candidate,
    };
  });
}

/** Безопасное ASCII-имя для запасного filename= в заголовке. */
function asciiFallback(name) {
  const cleaned = String(name || 'file')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .trim();
  return cleaned || 'file';
}

/**
 * Content-Disposition с поддержкой кириллицы: ASCII-запасное имя для старых
 * клиентов и filename* по RFC 5987 для остальных.
 */
function contentDisposition(type, name) {
  const encoded = encodeURIComponent(String(name || 'file'))
    .replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${asciiFallback(name)}"; filename*=UTF-8''${encoded}`;
}

/** Имя ZIP-архива по названию папки: «Договоры» → «Договоры.zip». */
function archiveName(folderName) {
  const base = folderName ? normalizeFolderName(folderName) : null;
  return `${base || 'Документы'}.zip`;
}

/** Размер для интерфейса: 1,4 МБ / 320 КБ / 15 Б. */
function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`;
  if (value >= 1024) return `${Math.round(value / 1024)} КБ`;
  return `${value} Б`;
}

module.exports = {
  MAX_FILE_SIZE,
  MAX_NAME_LENGTH,
  ALLOWED_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MIME_TYPES,
  extensionOf,
  isAllowedFile,
  normalizeFolderName,
  normalizeFileName,
  fileKind,
  isPreviewable,
  isImage,
  mimeType,
  breadcrumbs,
  folderPaths,
  archiveEntries,
  asciiFallback,
  contentDisposition,
  archiveName,
  formatSize,
};
