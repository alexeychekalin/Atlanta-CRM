require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// За nginx/прокси нужно включать TRUST_PROXY=true, чтобы лимиты считались по IP клиента
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.disable('x-powered-by');

// Инициализация директорий для загрузок
const uploadsBaseDir = path.join(__dirname, '../uploads');
['images', 'drawings', 'avatars', 'documents'].forEach(subDir => {
  const p = path.join(uploadsBaseDir, subDir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// --- Заголовки безопасности ---
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      // SPA использует inline-обработчики и inline-тему; выносить их — отдельная задача
      scriptSrc: ["'self'", "'unsafe-inline'"],
      // SPA построен на inline onclick-атрибутах (см. отдельную задачу по их выносу)
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      // Приложение открывается в live-preview внутри iframe
      frameAncestors: ["'self'", 'https://*.e2b.app', 'https://*.arena.ai'],
      // Не форсируем https: локальный запуск и preview работают по http
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  frameguard: false,
}));

// --- CORS: только свой origin (или явно разрешённые в CORS_ORIGINS) ---
const extraOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors((req, callback) => {
  const origin = req.headers.origin;
  if (!origin) return callback(null, { origin: true, credentials: true });

  let sameHost = false;
  try {
    sameHost = new URL(origin).host === req.headers.host;
  } catch {
    sameHost = false;
  }

  if (sameHost || extraOrigins.includes(origin)) {
    return callback(null, { origin: true, credentials: true });
  }
  return callback(null, { origin: false });
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const { attachUser, requirePermission, requireAuth, requireAnyPermission, requireAuthenticatedOrGuest, hasAnyViewPermission, tokenFromRequest, getGuestPermissions } = require('./middleware/access');

// --- Пользовательские файлы: только для авторизованных (cookie/Bearer) ---
async function uploadsAuth(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");

  // SVG может исполнять скрипты при открытии напрямую — такие файлы не отдаём
  if (path.extname(req.path).toLowerCase() === '.svg') {
    return res.status(403).json({ error: 'Просмотр SVG-файлов запрещён' });
  }

  const token = tokenFromRequest(req);
  if (!token) {
    try {
      const guestPermissions = await getGuestPermissions();
      if (guestPermissions && hasAnyViewPermission(guestPermissions)) return next();
    } catch {
      /* ignore */
    }
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

app.use('/uploads', uploadsAuth, express.static(uploadsBaseDir, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'private, max-age=3600');
  },
}));
app.use('/uploads', (req, res) => {
  res.status(404).json({ error: 'Файл не найден' });
});

// Статические файлы клиента
app.use(express.static(path.join(__dirname, '../../client'), {
  index: false,
  maxAge: '1h',
}));

// --- Публичные API (без пользователя) ---
app.use('/api/auth', require('./routes/auth'));

// Дальше все API получают актуального пользователя из токена/cookie
app.use('/api', attachUser);

// Проверка живости (для docker healthcheck и мониторинга)
app.get('/api/health', async (req, res) => {
  try {
    const db = require('./db');
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'База данных недоступна' });
  }
});

// --- API с проверкой прав по разделам ---
app.use('/api/dashboard', requirePermission('dashboard'), require('./routes/dashboard'));
app.use('/api/clients/:id/timeline', requirePermission('clients'), require('./routes/client-timeline'));
app.use('/api/clients/:clientId/contacts', requirePermission('clients'), require('./routes/client-contacts'));
app.use('/api/clients/:id/documents', requirePermission('clients'), require('./routes/client-documents'));
app.use('/api/clients/:clientId/approvals', requirePermission('clients'), require('./routes/drawing-approvals'));
app.use('/api/client-statuses', requirePermission('clients'), require('./routes/client-statuses'));
app.use('/api/clients', requirePermission('clients'), require('./routes/clients'));

app.use('/api/orders', requirePermission('orders'), require('./routes/orders'));
app.use('/api/proposals', requirePermission('proposals'), require('./routes/proposals'));
app.use('/api/principals', requirePermission('orders'), require('./routes/principals'));

app.use('/api/drawings', requirePermission('drawings'), require('./routes/drawings'));

app.use('/api/components/:id/modifications', requirePermission('components'), require('./routes/component-modifications'));
app.use('/api/components/:id/documents', requirePermission('components'), require('./routes/component-documents'));
app.use('/api/component-categories', requirePermission('components'), require('./routes/component-categories'));
app.use('/api/components', requirePermission('components'), require('./routes/comp-catalog'));
app.use('/api/products', requirePermission('components'), require('./routes/products'));

app.use('/api/reports', requirePermission('reports'), require('./routes/reports'));

app.use('/api/pricing-levels', requirePermission('clients'), require('./routes/pricing-levels'));
app.use('/api/search', requireAuthenticatedOrGuest, require('./routes/search'));

app.use('/api/settings', requireAuth, require('./routes/settings'));
app.use('/api/users', requirePermission('settings'), require('./routes/users'));
app.use('/api/roles', requirePermission('settings'), require('./routes/roles'));

app.use('/api/equipment-types', requirePermission('equipment'), require('./routes/equipment-types'));
app.use('/api/manufacturers', requirePermission('equipment'), require('./routes/manufacturers'));
app.use('/api/manufacturer-products', requirePermission('equipment'), require('./routes/manufacturer-products'));

// Загрузка файлов: внутри маршрутов проверяется право на конкретный раздел
app.use('/api/upload', requireAuth, require('./routes/upload'));

// ZIP-скачивание документов по списку компонентов (для заказов/калькулятора)
const archiverPkg = require('archiver');
const db = require('./db');
const { safeUploadPath, safeArchiveName } = require('./utils/files');

app.get(
  '/api/component-documents/download-zip',
  requireAnyPermission([['components', 'view'], ['orders', 'view']]),
  async (req, res) => {
    try {
      const ids = (req.query.ids || '').split(',').map(Number).filter(n => n > 0);
      if (ids.length === 0) return res.status(400).json({ error: 'Укажите ids компонентов' });
      if (ids.length > 200) return res.status(400).json({ error: 'Слишком много компонентов за раз' });

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
      archive.on('error', (err) => {
        console.error('Ошибка архивации документов:', err);
        res.destroy(err);
      });
      archive.pipe(res);

      for (const doc of result.rows) {
        const filePath = safeUploadPath(doc.file_path);
        if (!filePath || !fs.existsSync(filePath)) continue;
        const folder = doc.doc_type === 'certificate' ? 'Сертификаты' : 'Информация';
        const compFolder = `${safeArchiveName(doc.article, 'comp')} - ${safeArchiveName(doc.component_name, 'Без названия')}`;
        archive.file(filePath, { name: `${compFolder}/${folder}/${safeArchiveName(doc.original_name)}` });
      }
      await archive.finalize();
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: 'Не удалось сформировать архив' });
    }
  }
);

// Неизвестный API-метод → JSON 404 (а не index.html)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API-метод не найден' });
});

// SPA fallback: всё остальное → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/index.html'));
});

// Обработчик ошибок
app.use((err, req, res, next) => {
  console.error('Серверная ошибка:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const server = app.listen(PORT, () => {
  console.log(`\n🚀 CRM «Атланта» запущена на http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api`);
  console.log(`   Режим: ${process.env.NODE_ENV || 'development'}\n`);
});

// Корректное завершение: дождаться закрытия соединений и пула БД
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal}: завершаю работу...`);
  const timer = setTimeout(() => process.exit(1), 10000);
  timer.unref();

  server.close(async () => {
    try {
      if (typeof db.close === 'function') await db.close();
      else if (db.pool && typeof db.pool.end === 'function') await db.pool.end();
    } catch (err) {
      console.error('Ошибка при закрытии БД:', err);
    }
    process.exit(0);
  });
}

['SIGTERM', 'SIGINT'].forEach(signal => {
  process.on(signal, () => shutdown(signal));
});

module.exports = app;
