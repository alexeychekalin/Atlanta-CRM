const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');

const router = express.Router();

// Директории для загрузок
const uploadsDir = path.join(__dirname, '../../uploads');
const imagesDir = path.join(uploadsDir, 'images');
const drawingsDir = path.join(uploadsDir, 'drawings');

// Создаём папки если нет
[uploadsDir, imagesDir, drawingsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Конфигурация multer для изображений компонентов
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, imagesDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `comp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

// Конфигурация multer для чертежей
const drawingStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, drawingsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `drw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

const imageFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Допустимые форматы: JPG, PNG, WebP, GIF, SVG'));
  }
};

const drawingFilter = (req, file, cb) => {
  const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Допустимые форматы: PDF, JPG, PNG, WebP, TIFF'));
  }
};

const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const uploadDrawing = multer({
  storage: drawingStorage,
  fileFilter: drawingFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// POST /api/upload/image
router.post('/image', auth, uploadImage.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }
  res.json({
    path: `/uploads/images/${req.file.filename}`,
    filename: req.file.filename,
    originalname: req.file.originalname,
    size: req.file.size,
  });
});

// --- Аватар клиента ---
const avatarsDir = path.join(uploadsDir, 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// POST /api/upload/avatar
router.post('/avatar', auth, uploadAvatar.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }
  res.json({
    path: `/uploads/avatars/${req.file.filename}`,
    filename: req.file.filename,
    originalname: req.file.originalname,
    size: req.file.size,
  });
});

// POST /api/upload/drawing
router.post('/drawing', auth, uploadDrawing.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  res.json({
    path: `/uploads/drawings/${req.file.filename}`,
    filename: req.file.filename,
    originalname: req.file.originalname,
    file_type: ext,
    size: req.file.size,
  });
});

// --- Документы компонентов (сертификаты, инфо) ---
const compDocsDir = path.join(uploadsDir, 'documents');
if (!fs.existsSync(compDocsDir)) fs.mkdirSync(compDocsDir, { recursive: true });

const compDocStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, compDocsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

const compDocFilter = (req, file, cb) => {
  const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Допустимые форматы: PDF, JPG, PNG'));
  }
};

const uploadCompDoc = multer({
  storage: compDocStorage,
  fileFilter: compDocFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// POST /api/upload/component-doc
router.post('/component-doc', auth, uploadCompDoc.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  res.json({
    path: `/uploads/documents/${req.file.filename}`,
    filename: req.file.filename,
    originalname: req.file.originalname,
    file_type: ext,
    size: req.file.size,
  });
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
