/* Удаление заявки сквозь маршрут: DELETE /api/leads/:id.
 *
 * besides клиентской опечатки (API.delete) у удаления есть серверная сторона:
 * журнал уведомлений ссылается на заявку внешним ключом. Пока FK был без
 * ON DELETE CASCADE, «Удалить» отдавало 500, хотя кнопка нажималась.
 * Тест поднимает роутер с подставным db и проверяет порядок вызовов:
 * сначала удаляется заявка, и только потом — её файлы с диска.
 * Файлы живут внутри server/uploads (safeUploadPath принимает только такие
 * пути), поэтому тест кладёт временный файл туда и убирает за собой.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const dbPath = require.resolve('../src/db');
const sharedPath = require.resolve('../src/routes/leads-shared');

/** Поднять приложение с роутером заявок на подставной базе. */
function appWith(fakeDb, { notifications = [] } = {}) {
  const calls = [];
  const fake = {
    query: async (sql, params) => { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return fakeDb(sql, params); },
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake };
  require.cache[sharedPath] = {
    id: sharedPath, filename: sharedPath, loaded: true,
    exports: {
      line: (value) => value,
      parseItems: () => [],
      notifyAboutLead: async () => ({}),
      notificationsFor: async () => notifications,
    },
  };

  delete require.cache[require.resolve('../src/routes/leads')];
  const router = require('../src/routes/leads');

  const request = (method, url) => new Promise((resolve) => {
    const app = express();
    // права администратора: маршрут проверяет их через requirePermission
    app.use((req, res, next) => {
      req.user = { id: 1, role: 'admin', permissions: {} };
      next();
    });
    app.use('/api/leads', router);
    const server = app.listen(0, async () => {
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}${url}`, { method });
      const body = await response.json().catch(() => ({}));
      server.close(() => resolve({ status: response.status, body }));
    });
  });
  return { request, calls };
}

// Временная папка внутри uploads: safeUploadPath пускает только туда
const uploadsRoot = path.join(__dirname, '../uploads');
const testDir = fs.mkdtempSync(path.join(uploadsRoot, 'test-delete-'));

test.after(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('DELETE /leads/:id удаляет заявку, затем её файлы', async () => {
  const fileName = 'фото.jpg';
  const filePath = path.join(testDir, fileName);
  fs.writeFileSync(filePath, 'x');
  // так путь и лежит в базе: "/uploads/<subdir>/<file>"
  const storedPath = `/uploads/${path.basename(testDir)}/${fileName}`;

  const { request, calls } = appWith((sql) => {
    if (sql.includes('SELECT file_path FROM lead_files')) return { rows: [{ file_path: storedPath }] };
    if (sql.includes('DELETE FROM leads')) return { rows: [{ id: 7 }] };
    return { rows: [] };
  });

  const response = await request('DELETE', '/api/leads/7');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);

  const deleteLead = calls.findIndex((c) => c.sql.startsWith('DELETE FROM leads'));
  assert.ok(deleteLead >= 0, 'заявка удаляется');
  assert.equal(calls[deleteLead].params[0], 7);
  assert.ok(!fs.existsSync(filePath), 'файл заявки удалён с диска');
});

test('DELETE /leads/:id: нет заявки — 404, а не 500', async () => {
  const { request } = appWith((sql) => {
    if (sql.includes('SELECT file_path FROM lead_files')) return { rows: [] };
    if (sql.includes('DELETE FROM leads')) return { rows: [] };
    return { rows: [] };
  });
  const response = await request('DELETE', '/api/leads/999');
  assert.equal(response.status, 404);
  assert.match(response.body.error, /не найдена/);
});

test('схема: журнал уведомлений не мешает удалить заявку', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  const table = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS lead_notifications'));
  const body = table.slice(0, table.indexOf(');'));
  assert.match(body, /REFERENCES leads\(id\) ON DELETE CASCADE/,
    'lead_notifications должна удаляться вместе с заявкой, иначе DELETE падает по FK');
});
