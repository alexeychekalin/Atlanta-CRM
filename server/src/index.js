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
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/products', require('./routes/products'));
app.use('/api/principals', require('./routes/principals'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/component-categories', require('./routes/component-categories'));
app.use('/api/components', require('./routes/comp-catalog'));
app.use('/api/components/:id/modifications', require('./routes/component-modifications'));
app.use('/api/drawings', require('./routes/drawings'));
app.use('/api/client-statuses', require('./routes/client-statuses'));
app.use('/api/clients/:id/timeline', require('./routes/client-timeline'));
app.use('/api/clients/:clientId/contacts', require('./routes/client-contacts'));
app.use('/api/clients/:id/documents', require('./routes/client-documents'));
app.use('/api/roles', require('./routes/roles'));
app.use('/api/users', require('./routes/users'));
app.use('/api/proposals', require('./routes/proposals'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/equipment-types', require('./routes/equipment-types'));
app.use('/api/pricing-levels', require('./routes/pricing-levels'));
app.use('/api/manufacturers', require('./routes/manufacturers'));
app.use('/api/manufacturer-products', require('./routes/manufacturer-products'));
app.use('/api/components/:id/documents', require('./routes/component-documents'));

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
