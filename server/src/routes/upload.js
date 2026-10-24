const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/access');
const { hasValidSignature } = require('../utils/files');
const { adminOnly } = require('../middleware/role');

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

[uploadsDir, imagesDir, drawingsDir].forEach(dir => {
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

// SVG исключён: он исполняет скрипты при открытии файла напрямую
const imageFilter = extensionFilter(
  ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
  'Допустимые форматы: JPG, PNG, WebP, GIF'
);

const drawingFilter = extensionFilter(
  ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif'],
  'Допустимые форматы: PDF, JPG, PNG, WebP, TIFF'
);

const compDocFilter = extensionFilter(
  ['.pdf', '.jpg', '.jpeg', '.png'],
  'Допустимые форматы: PDF, JPG, PNG'
);

// Админские файлы клиента: документы, таблицы, архивы, чертежи.
// HTML/SVG/JS и исполняемые файлы не принимаем — они исполняются в браузере.
const clientFileFilter = extensionFilter(
  ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff',
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

const canEditComponents = requireAnyPermission([['components', 'edit']]);
const canEditClients = requireAnyPermission([['clients', 'edit']]);
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
  return res.json({
    path: `/uploads/${subdir}/${req.file.filename}`,
    filename: req.file.filename,
    originalname: decodeFilename(req.file.originalname),
    size: req.file.size,
    ...extra,
  });
}

// POST /api/upload/image — фото компонентов и модификаций
router.post('/image', auth, canEditComponents, uploadImage.single('file'), verifyUploadedFile, (req, res) => {
  return fileResponse(req, res, 'images');
});

// POST /api/upload/avatar — аватар клиента
router.post('/avatar', auth, canEditClients, uploadAvatar.single('file'), verifyUploadedFile, (req, res) => {
  return fileResponse(req, res, 'avatars');
});

// POST /api/upload/drawing — чертежи, версии согласований, счета
router.post('/drawing', auth, canUploadDrawing, uploadDrawing.single('file'), verifyUploadedFile, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  return fileResponse(req, res, 'drawings', { file_type: ext });
});

// POST /api/upload/component-doc — сертификаты и информационные документы
router.post('/component-doc', auth, canEditComponents, uploadCompDoc.single('file'), verifyUploadedFile, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  return fileResponse(req, res, 'documents', { file_type: ext });
});

// POST /api/upload/client-file — произвольные файлы в карточку клиента (только админ)
router.post('/client-file', auth, adminOnly, uploadClientFile.single('file'), verifyUploadedFile, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  return fileResponse(req, res, 'files', { file_type: ext });
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
