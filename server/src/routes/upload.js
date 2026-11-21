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
const {
  isRotatablePath,
  rotatePhotoFile,
  autoOrientPhoto,
} = require('../services/photo');
const { normalizeProductPhoto } = require('../services/photo-normalize');
const { sectionAllowed } = require('../middleware/access');
const { normalizeUploadPath, safeUploadPath } = require('../utils/files');

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
const documentsDir = path.join(uploadsDir, 'documents');
const libraryDir = path.join(uploadsDir, 'library');

[uploadsDir, imagesDir, drawingsDir, documentsDir, libraryDir].forEach(dir => {
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

// Документы в карточку клиента: договоры, счета, письма, презентации и фото.
// Раздел «Документы» карточки — не только сканы: люди кладут туда Word, Excel,
// PowerPoint и обычный текст, поэтому формат не сужаем до PDF и картинок.
const clientDocFilter = extensionFilter(
  ['.pdf', '.txt', '.csv', '.md', '.rtf',
    '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods',
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.heic', '.heif'],
  'Допустимые форматы: PDF, Word, Excel, PowerPoint, текст, JPG, PNG, HEIC'
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

const uploadClientDoc = multer({
  storage: buildStorage(documentsDir, 'doc'),
  fileFilter: clientDocFilter,
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
const uploadCompDoc = multer({
  storage: buildStorage(documentsDir, 'doc'),
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

/**
 * EXIF-ориентация → пиксели. После HEIC-конвертации метаданные теряются,
 * поэтому фото с телефона иначе показывается лёжа. Перекодируем только
 * файлы, у которых ориентация действительно задана.
 */
async function fixPhotoOrientation(req, res, next) {
  if (!req.file) return next();
  try {
    const changed = await autoOrientPhoto(req.file.path);
    if (changed) {
      const stat = await fs.promises.stat(req.file.path);
      req.file.size = stat.size;
      req.file.orientationFixed = true;
    }
    return next();
  } catch {
    // Ориентация — не критично: файл уже принят и проверен
    return next();
  }
}

/**
 * Фото изделия приводим к одному виду: белый квадрат, изделие по центру.
 * Так сетка каталога не «пляшет» из-за разных размеров и белых полей.
 * Ошибка нормализации не должна отклонять загрузку: файл уже принят
 * и проверен, максимум — останется как есть.
 */
async function normalizeUploadedPhoto(req, res, next) {
  if (!req.file) return next();
  try {
    const result = await normalizeProductPhoto(req.file.path);
    if (result.changed) {
      const stat = await fs.promises.stat(req.file.path);
      req.file.size = stat.size;
      req.file.normalized = true;
    }
    return next();
  } catch (err) {
    console.error('Не удалось нормализовать фото:', err.message);
    return next();
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
    normalized: Boolean(req.file.normalized),
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
router.post('/image', auth, canEditComponents, uploadImage.single('file'), verifyUploadedFile, convertHeicUpload, fixPhotoOrientation, normalizeUploadedPhoto, (req, res) => {
  return fileResponse(req, res, 'images');
});

// POST /api/upload/avatar — аватар клиента
router.post('/avatar', auth, canEditClients, uploadAvatar.single('file'), verifyUploadedFile, convertHeicUpload, fixPhotoOrientation, (req, res) => {
  return fileResponse(req, res, 'avatars');
});

// POST /api/upload/drawing — чертежи, версии согласований, счета
router.post('/drawing', auth, canUploadDrawing, uploadDrawing.single('file'), verifyUploadedFile, convertHeicUpload, fixPhotoOrientation, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  return fileResponse(req, res, 'drawings', { file_type: uploadedFileType(req) });
});

// POST /api/upload/component-doc — сертификаты и информационные документы
router.post('/component-doc', auth, canEditComponents, uploadCompDoc.single('file'), verifyUploadedFile, convertHeicUpload, fixPhotoOrientation, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  return fileResponse(req, res, 'documents', { file_type: uploadedFileType(req) });
});

// POST /api/upload/client-file — произвольные файлы в карточку клиента (только админ)
router.post('/client-file', auth, adminOnly, uploadClientFile.single('file'), verifyUploadedFile, convertHeicUpload, fixPhotoOrientation, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  return fileResponse(req, res, 'files', { file_type: uploadedFileType(req) });
});

// POST /api/upload/library-file — файл в библиотеку документов (папки админа)
router.post('/library-file', auth, canEditDocuments, uploadLibraryFile.single('file'), verifyUploadedFile, convertHeicUpload, fixPhotoOrientation, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  return fileResponse(req, res, 'library', { file_type: uploadedFileType(req) });
});

// POST /api/upload/client-doc — документы в карточку клиента (Word, Excel, текст…)
router.post('/client-doc', auth, canEditClients, uploadClientDoc.single('file'), verifyUploadedFile, convertHeicUpload, fixPhotoOrientation, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  return fileResponse(req, res, 'documents', { file_type: uploadedFileType(req) });
});

/**
 * Кто может менять фото в каждой папке загрузок. Поворот перезаписывает
 * файл на месте, поэтому права те же, что и на загрузку в этот раздел.
 * В одной папке лежат файлы разных разделов (uploads/documents — и
 * сертификаты компонентов, и договоры клиентов), поэтому правил может быть
 * несколько: достаточно любого.
 */
const ROTATE_RULES = [
  { prefix: '/uploads/images/', sections: [['components', 'edit']] },
  { prefix: '/uploads/documents/', sections: [['components', 'edit'], ['clients', 'edit']] },
  { prefix: '/uploads/avatars/', sections: [['clients', 'edit']] },
  { prefix: '/uploads/drawings/', sections: [['calculator', 'edit'], ['clients', 'edit'], ['orders', 'edit'], ['drawings', 'edit']] },
  { prefix: '/uploads/library/', sections: [['documents', 'edit']] },
  { prefix: '/uploads/files/', adminOnly: true },
];

function canRotatePath(user, filePath) {
  const rule = ROTATE_RULES.find(item => filePath.startsWith(item.prefix));
  if (!rule || !user) return false;
  if (rule.adminOnly) return user.role === 'admin';
  return rule.sections.some(([section, action]) => sectionAllowed(user, section, action));
}

// POST /api/upload/rotate — повернуть фото на 90° и сохранить положение
router.post('/rotate', auth, async (req, res) => {
  try {
    const { path: rawPath, degrees } = req.body || {};

    const filePath = normalizeUploadPath(rawPath);
    if (!filePath) return res.status(400).json({ error: 'Недопустимый путь к файлу' });
    if (!canRotatePath(req.user, filePath)) {
      return res.status(403).json({ error: 'Недостаточно прав для изменения этого файла' });
    }
    if (!isRotatablePath(filePath)) {
      return res.status(400).json({ error: 'Этот формат нельзя повернуть' });
    }

    const absolute = safeUploadPath(filePath);
    if (!absolute || !fs.existsSync(absolute)) {
      return res.status(404).json({ error: 'Файл не найден' });
    }

    const result = await rotatePhotoFile(absolute, degrees);
    return res.json({
      path: filePath,
      width: result.width,
      height: result.height,
      size: result.size,
      rotated_at: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
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
