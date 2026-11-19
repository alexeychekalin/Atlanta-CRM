const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/access');
const { hasValidSignature } = require('../utils/files');
const { adminOnly } = require('../middleware/role');
const { ALLOWED_EXTENSIONS: LIBRARY_EXTENSIONS } = require('../services/document-library');
const { isHeicExtension, convertHeicQueued } = require('../services/heic');

const router = express.Router();

// Декодер имени файла (multer передаёт originalname в latin1)
function decodeFilename(name) {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

// Директории для загрузок
const uploadsDir = path.join(__dirname, '../../uploads');
const imagesDir = path.join(uploadsDir, 'images');
const drawingsDir = path.join(uploadsDir, 'drawings');
const libraryDir = path.join(uploadsDir, 'library');

[uploadsDir, imagesDir, drawingsDir, libraryDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function buildStorage(directory, prefix) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, directory),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      cb(null, name);
    },
  });
}

function extensionFilter(allowed, message) {
  return (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(message));
  };
}

// SVG исключён: он исполняет скрипты при открытии файла напрямую.
// HEIC/HEIF принимаем: iPhone снимает в этом формате, конвертируем в JPEG.
const imageFilter = extensionFilter(
  ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'],
  'Допустимые форматы: JPG, PNG, WebP, GIF, HEIC'
);

const drawingFilter = extensionFilter(
  ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.heic', '.heif'],
  'Допустимые форматы: PDF, JPG, PNG, WebP, TIFF, HEIC'
);

const compDocFilter = extensionFilter(
  ['.pdf', '.jpg', '.jpeg', '.png', '.heic', '.heif'],
  'Допустимые форматы: PDF, JPG, PNG, HEIC'
);

// Админские файлы клиента: документы, таблицы, архивы, чертежи.
// HTML/SVG/JS и исполняемые файлы не принимаем — они исполняются в браузере.
const clientFileFilter = extensionFilter(
  ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.heic', '.heif',
    '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods',
    '.zip', '.rar', '.7z', '.txt', '.csv', '.md', '.dwg', '.dxf'],
  'Недопустимый формат файла. Разрешены документы, таблицы, изображения, архивы и чертежи'
);

const uploadImage = multer({
  storage: buildStorage(imagesDir, 'comp'),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadDrawing = multer({
  storage: buildStorage(drawingsDir, 'drw'),
  fileFilter: drawingFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// --- Аватар клиента ---
const avatarsDir = path.join(uploadsDir, 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

const uploadAvatar = multer({
  storage: buildStorage(avatarsDir, 'avatar'),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// --- Документы компонентов (сертификаты, инфо) ---
const compDocsDir = path.join(uploadsDir, 'documents');
if (!fs.existsSync(compDocsDir)) fs.mkdirSync(compDocsDir, { recursive: true });

const uploadCompDoc = multer({
  storage: buildStorage(compDocsDir, 'doc'),
  fileFilter: compDocFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// --- Файлы клиента (только администратор) ---
const clientFilesDir = path.join(uploadsDir, 'files');
if (!fs.existsSync(clientFilesDir)) fs.mkdirSync(clientFilesDir, { recursive: true });

const uploadClientFile = multer({
  storage: buildStorage(clientFilesDir, 'file'),
  fileFilter: clientFileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// --- Библиотека документов: папки раздела «Документы» ---
// Набор форматов задан в services/document-library.js, чтобы проверка на
// клиенте, в загрузке и при регистрации файла была одинаковой.
const libraryFilter = extensionFilter(
  // HEIC кладём рядом с остальными изображениями: он придёт уже как JPEG
  [...new Set([...LIBRARY_EXTENSIONS, '.heic', '.heif'])],
  'Недопустимый формат файла. Разрешены PDF, Word, таблицы, изображения, архивы и чертежи'
);

const uploadLibraryFile = multer({
  storage: buildStorage(libraryDir, 'lib'),
  fileFilter: libraryFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * Проверяет содержимое загруженного файла по сигнатуре и удаляет его при несовпадении.
 */
function verifyUploadedFile(req, res, next) {
  if (!req.file) return next();
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!hasValidSignature(req.file.path, ext)) {
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      /* ignore */
    }
    return res.status(400).json({ error: 'Содержимое файла не соответствует его расширению' });
  }
  return next();
}

/**
 * HEIC/HEIF → JPEG после загрузки. Работает для всех «фотографических»
 * маршрутов: фото компонентов, аватары, сертификаты, чертежи, файлы клиента
 * и библиотеки. Так в CRM не остаётся файлов, которые не открывает браузер.
 */
async function convertHeicUpload(req, res, next) {
  if (!req.file) return next();
  const ext = path.extname(req.file.filename).toLowerCase();
  if (!isHeicExtension(ext)) return next();

  try {
    const result = await convertHeicQueued(req.file.path);
    req.file.path = result.path;
    req.file.filename = result.filename;
    req.file.size = result.size;
    req.file.mimetype = 'image/jpeg';
    req.file.convertedFromHeic = true;
    return next();
  } catch (err) {
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      /* файла уже нет */
    }
    return res.status(err.status || 400).json({
      error: err.status ? err.message : `Не удалось обработать HEIC-фото: ${err.message}`,
    });
  }
}

const canEditComponents = requireAnyPermission([['components', 'edit']]);
const canEditClients = requireAnyPermission([['clients', 'edit']]);
const canEditDocuments = requireAnyPermission([['documents', 'edit']]);
const canUploadDrawing = requireAnyPermission([
  ['calculator', 'edit'],
  ['clients', 'edit'],
  ['orders', 'edit'],
  ['drawings', 'edit'],
]);

function fileResponse(req, res, subdir, extra = {}) {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }
  const originalname = decodeFilename(req.file.originalname);
  return res.json({
    path: `/uploads/${subdir}/${req.file.filename}`,
    filename: req.file.filename,
    originalname,
    size: req.file.size,
    // HEIC с iPhone приходит как .heic, а хранится уже JPEG: клиенту честнее
    // отдать имя с новым расширением, иначе тип документа не сойдётся с файлом
    converted_from_heic: Boolean(req.file.convertedFromHeic),
    ...extra,
    ...(req.file.convertedFromHeic ? { originalname: originalname.replace(/\.(heic|heif)$/i, '.jpg') } : {}),
  });
}

/**
 * Тип файла для БД — по фактическому имени на диске, а не по имени с телефона.
 * HEIC приходит как .heic, но хранится уже как .jpg: иконка и предпросмотр
 * должны ориентироваться на то, что реально лежит в uploads.
 */
function uploadedFileType(req) {
  if (!req.file) return null;
  return path.extname(req.file.filename).toLowerCase().replace('.', '');
}

// POST /api/upload/image — фото компонентов и модификаций
router.post('/image', auth, canEditComponents, uploadImage.single('file'), verifyUploadedFile, convertHeicUpload, (req, res) => {
  return fileResponse(req, res, 'images');
});

// POST /api/upload/avatar — аватар клиента
router.post('/avatar', auth, canEditClients, uploadAvatar.single('file'), verifyUploadedFile, convertHeicUpload, (req, res) => {
  return fileResponse(req, res, 'avatars');
});

// POST /api/upload/drawing — чертежи, версии согласований, счета
router.post('/drawing', auth, canUploadDrawing, uploadDrawing.single('file'), verifyUploadedFile, convertHeicUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  return fileResponse(req, res, 'drawings', { file_type: uploadedFileType(req) });
});

// POST /api/upload/component-doc — сертификаты и информационные документы
router.post('/component-doc', auth, canEditComponents, uploadCompDoc.single('file'), verifyUploadedFile, convertHeicUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  return fileResponse(req, res, 'documents', { file_type: uploadedFileType(req) });
});

// POST /api/upload/client-file — произвольные файлы в карточку клиента (только админ)
router.post('/client-file', auth, adminOnly, uploadClientFile.single('file'), verifyUploadedFile, convertHeicUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  return fileResponse(req, res, 'files', { file_type: uploadedFileType(req) });
});

// POST /api/upload/library-file — файл в библиотеку документов (папки админа)
router.post('/library-file', auth, canEditDocuments, uploadLibraryFile.single('file'), verifyUploadedFile, convertHeicUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  return fileResponse(req, res, 'library', { file_type: uploadedFileType(req) });
});

// Middleware обработки ошибок multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Файл слишком большой' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
