require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация директорий для загрузок
const uploadsBaseDir = path.join(__dirname, '../uploads');
['images', 'drawings', 'avatars', 'documents'].forEach(subDir => {
  const p = path.join(uploadsBaseDir, subDir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Middleware
app.use(cors());
app.use(express.json());

// Статические файлы клиента
app.use(express.static(path.join(__dirname, '../../client')));

// Статические файлы загрузок (изображения компонентов, чертежи, аватары, документы)
app.use('/uploads', express.static(uploadsBaseDir));

// API-маршруты
const { optionalAuth } = require('./middleware/auth');

// Маршруты без гостевого доступа (только авторизованные)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/roles', require('./routes/roles'));
app.use('/api/users', require('./routes/users'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/client-statuses', optionalAuth, require('./routes/client-statuses'));
app.use('/api/clients/:id/timeline', optionalAuth, require('./routes/client-timeline'));
app.use('/api/clients/:clientId/contacts', optionalAuth, require('./routes/client-contacts'));
app.use('/api/clients/:id/documents', optionalAuth, require('./routes/client-documents'));

// Маршруты с гостевым доступом (GET — optionalAuth, POST/PUT/DELETE — auth внутри)
app.use('/api/dashboard', optionalAuth, require('./routes/dashboard'));
app.use('/api/clients', optionalAuth, require('./routes/clients'));
app.use('/api/products', optionalAuth, require('./routes/products'));
app.use('/api/principals', optionalAuth, require('./routes/principals'));
app.use('/api/orders', optionalAuth, require('./routes/orders'));
app.use('/api/reports', optionalAuth, require('./routes/reports'));
app.use('/api/component-categories', optionalAuth, require('./routes/component-categories'));
app.use('/api/components', optionalAuth, require('./routes/comp-catalog'));
app.use('/api/components/:id/modifications', optionalAuth, require('./routes/component-modifications'));
app.use('/api/components/:id/documents', optionalAuth, require('./routes/component-documents'));
app.use('/api/drawings', optionalAuth, require('./routes/drawings'));
app.use('/api/proposals', optionalAuth, require('./routes/proposals'));
app.use('/api/equipment-types', optionalAuth, require('./routes/equipment-types'));
app.use('/api/pricing-levels', optionalAuth, require('./routes/pricing-levels'));
app.use('/api/manufacturers', optionalAuth, require('./routes/manufacturers'));
app.use('/api/manufacturer-products', optionalAuth, require('./routes/manufacturer-products'));

// ZIP-скачивание документов по списку компонентов (для заказов/калькулятора)
const archiverPkg = require('archiver');
const db = require('./db');
app.get('/api/component-documents/download-zip', require('./middleware/auth'), async (req, res) => {
  try {
    const ids = (req.query.ids || '').split(',').map(Number).filter(n => n > 0);
    if (ids.length === 0) return res.status(400).json({ error: 'Укажите ids компонентов' });
    const result = await db.query(
      `SELECT cd.*, c.article, c.name AS component_name
       FROM component_documents cd
       JOIN components c ON c.id = cd.component_id
       WHERE cd.component_id = ANY($1)
       ORDER BY c.article, cd.doc_type, cd.original_name`,
      [ids]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Нет документов' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="documents.zip"');
    const archive = archiverPkg('zip', { zlib: { level: 5 } });
    archive.pipe(res);
    for (const doc of result.rows) {
      const filePath = path.join(__dirname, '../', doc.file_path);
      if (fs.existsSync(filePath)) {
        const folder = doc.doc_type === 'certificate' ? 'Сертификаты' : 'Информация';
        const compFolder = `${doc.article || 'comp'} - ${doc.component_name || 'Без названия'}`;
        archive.file(filePath, { name: `${compFolder}/${folder}/${doc.original_name}` });
      }
    }
    await archive.finalize();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback: всё остальное → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/index.html'));
});

// Обработчик ошибок
app.use((err, req, res, next) => {
  console.error('Серверная ошибка:', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 CRM «Атланта» запущена на http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api`);
  console.log(`   Режим: ${process.env.NODE_ENV || 'development'}\n`);
});
