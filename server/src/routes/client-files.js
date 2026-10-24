/**
 * Файлы клиента — вложения администратора (вкладка «Файлы» в карточке клиента).
 *
 * Доступ только у роли admin: и список, и загрузка, и удаление.
 * Менеджеры и другие роли этих файлов не видят — для обычных документов
 * клиента есть /api/clients/:id/documents.
 */
const express = require('express');
const fs = require('fs');
const db = require('../db');
const auth = require('../middleware/auth');
const { adminOnly } = require('../middleware/role');
const { normalizeUploadPath, safeUploadPath } = require('../utils/files');

const router = express.Router({ mergeParams: true });

router.use(auth, adminOnly);

function clientIdFrom(req) {
  return /^\d+$/.test(String(req.params.clientId)) ? Number(req.params.clientId) : null;
}

async function clientExists(clientId) {
  const res = await db.query('SELECT 1 FROM clients WHERE id = $1', [clientId]);
  return res.rows.length > 0;
}

function normalizeName(value) {
  return String(value || '').trim().slice(0, 255);
}

// GET /api/clients/:clientId/files — список файлов клиента
router.get('/', async (req, res) => {
  const clientId = clientIdFrom(req);
  if (!clientId) return res.status(404).json({ error: 'Клиент не найден' });
  try {
    const result = await db.query(
      `SELECT f.*, u.full_name AS uploaded_by_name
         FROM client_files f
         LEFT JOIN users u ON u.id = f.uploaded_by
        WHERE f.client_id = $1
        ORDER BY f.created_at DESC, f.id DESC`,
      [clientId]
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:clientId/files — добавить загруженный файл в карточку
router.post('/', async (req, res) => {
  const clientId = clientIdFrom(req);
  if (!clientId) return res.status(404).json({ error: 'Клиент не найден' });

  const name = normalizeName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Укажите название файла' });

  const filePath = normalizeUploadPath(req.body.file_path);
  if (!filePath) return res.status(400).json({ error: 'Недопустимый путь к файлу' });
  if (!safeUploadPath(filePath) || !fs.existsSync(safeUploadPath(filePath))) {
    return res.status(400).json({ error: 'Файл не найден в хранилище' });
  }

  try {
    if (!await clientExists(clientId)) {
      return res.status(404).json({ error: 'Клиент не найден' });
    }
    const fileType = String(req.body.file_type || '').replace(/^\./, '').slice(0, 20) || null;
    const fileSize = Number(req.body.file_size) > 0 ? Number(req.body.file_size) : null;

    const result = await db.query(
      `INSERT INTO client_files (client_id, name, file_path, file_type, file_size, comment, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [clientId, name, filePath, fileType, fileSize, req.body.comment || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/clients/:clientId/files/:fileId — переименовать / изменить комментарий
router.patch('/:fileId', async (req, res) => {
  const clientId = clientIdFrom(req);
  const fileId = /^\d+$/.test(String(req.params.fileId)) ? Number(req.params.fileId) : null;
  if (!clientId || !fileId) return res.status(404).json({ error: 'Файл не найден' });

  const has = key => Object.prototype.hasOwnProperty.call(req.body, key);
  const name = has('name') ? normalizeName(req.body.name) : null;
  if (has('name') && !name) return res.status(400).json({ error: 'Укажите название файла' });

  try {
    const result = await db.query(
      `UPDATE client_files
          SET name = CASE WHEN $1 THEN $2 ELSE name END,
              comment = CASE WHEN $3 THEN $4 ELSE comment END
        WHERE id = $5 AND client_id = $6
        RETURNING *`,
      [has('name'), name, has('comment'), req.body.comment || null, fileId, clientId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Файл не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:clientId/files/:fileId — удалить запись и сам файл
router.delete('/:fileId', async (req, res) => {
  const clientId = clientIdFrom(req);
  const fileId = /^\d+$/.test(String(req.params.fileId)) ? Number(req.params.fileId) : null;
  if (!clientId || !fileId) return res.status(404).json({ error: 'Файл не найден' });

  try {
    const result = await db.query(
      'DELETE FROM client_files WHERE id = $1 AND client_id = $2 RETURNING file_path',
      [fileId, clientId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Файл не найден' });

    const filePath = result.rows[0].file_path;
    const absolute = safeUploadPath(filePath);
    if (absolute) {
      // Файл мог быть привязан к другой записи — тогда не удаляем с диска
      const used = await db.query('SELECT 1 FROM client_files WHERE file_path = $1 LIMIT 1', [filePath]);
      if (used.rows.length === 0 && fs.existsSync(absolute)) {
        try { fs.unlinkSync(absolute); } catch { /* файл занят — оставим как есть */ }
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
