const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { normalizeUploadPath, fileSha256 } = require('../utils/files');

const router = express.Router({ mergeParams: true });

// Допустимые статусы и их переходы
const STATUSES = {
  waiting: { label: 'Ожидание от клиента', next: ['new'] },
  new: { label: 'Получен образец', next: ['in_progress'] },
  in_progress: { label: 'В работе', next: ['review'] },
  review: { label: 'На согласовании', next: ['approved', 'revision'] },
  revision: { label: 'На доработку', next: ['in_progress'] },
  approved: { label: 'Утверждён', next: [] },
};

// GET /api/clients/:clientId/approvals — список согласований клиента
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT da.*, u.full_name AS created_by_name,
        (SELECT COUNT(*) FROM drawing_approval_versions WHERE approval_id = da.id) AS versions_count,
        (SELECT COUNT(*) FROM drawing_approval_comments WHERE approval_id = da.id) AS comments_count,
        (SELECT d.id FROM drawings d WHERE d.approval_id = da.id) AS drawing_id
       FROM drawing_approvals da
       LEFT JOIN users u ON da.created_by = u.id
       WHERE da.client_id = $1
       ORDER BY da.updated_at DESC`,
      [req.params.clientId]
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка получения согласований:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:clientId/approvals/:id — детали согласования
router.get('/:id', auth, async (req, res) => {
  try {
    const [approval, versions, comments] = await Promise.all([
      db.query(
        `SELECT da.*, u.full_name AS created_by_name,
                (SELECT d.id FROM drawings d WHERE d.approval_id = da.id) AS drawing_id
         FROM drawing_approvals da
         LEFT JOIN users u ON da.created_by = u.id
         WHERE da.id = $1 AND da.client_id = $2`,
        [req.params.id, req.params.clientId]
      ),
      db.query(
        `SELECT v.*, u.full_name AS uploaded_by_name
         FROM drawing_approval_versions v
         LEFT JOIN users u ON v.uploaded_by = u.id
         WHERE v.approval_id = $1
         ORDER BY v.version_number ASC, v.created_at ASC`,
        [req.params.id]
      ),
      db.query(
        `SELECT c.*, u.full_name AS user_name
         FROM drawing_approval_comments c
         LEFT JOIN users u ON c.user_id = u.id
         WHERE c.approval_id = $1
         ORDER BY c.created_at ASC`,
        [req.params.id]
      ),
    ]);

    if (approval.rows.length === 0) {
      return res.status(404).json({ error: 'Согласование не найдено' });
    }

    res.json({
      ...approval.rows[0],
      versions: versions.rows,
      comments: comments.rows,
    });
  } catch (err) {
    console.error('Ошибка получения согласования:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:clientId/approvals — создать согласование
router.post('/', auth, async (req, res) => {
  try {
    const { title, description, status } = req.body;
    if (!title) return res.status(400).json({ error: 'Укажите название' });

    const result = await db.query(
      `INSERT INTO drawing_approvals (client_id, title, description, status, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.clientId, title, description || null, status || 'waiting', req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка создания согласования:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:clientId/approvals/:id — обновить
router.put('/:id', auth, async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Укажите название' });

    const result = await db.query(
      `UPDATE drawing_approvals SET title = $1, description = $2, updated_at = now()
       WHERE id = $3 AND client_id = $4 RETURNING *`,
      [title, description || null, req.params.id, req.params.clientId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдено' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/clients/:clientId/approvals/:id/status — сменить статус
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!STATUSES[status]) return res.status(400).json({ error: 'Недопустимый статус' });

    const result = await db.query(
      `UPDATE drawing_approvals SET status = $1, updated_at = now()
       WHERE id = $2 AND client_id = $3 RETURNING *`,
      [status, req.params.id, req.params.clientId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдено' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:clientId/approvals/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM drawing_approvals WHERE id = $1 AND client_id = $2 RETURNING id',
      [req.params.id, req.params.clientId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдено' });
    res.json({ message: 'Согласование удалено' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:clientId/approvals/:id/to-drawing
// Согласование завершено (approved) → переносим файл в чертежи.
// Идемпотентно: повторный вызов возвращает уже созданный чертёж.
router.post('/:id/to-drawing', auth, async (req, res) => {
  const pgClient = await db.pool.connect();
  try {
    const canEditDrawings = req.user.role === 'admin'
      || (req.user.permissions && req.user.permissions.drawings && req.user.permissions.drawings.edit === true);
    if (!canEditDrawings) {
      return res.status(403).json({ error: 'Недостаточно прав для работы с чертежами' });
    }

    await pgClient.query('BEGIN');

    const approvalRes = await pgClient.query(
      'SELECT * FROM drawing_approvals WHERE id = $1 AND client_id = $2',
      [req.params.id, req.params.clientId]
    );
    if (approvalRes.rows.length === 0) {
      await pgClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Согласование не найдено' });
    }
    const approval = approvalRes.rows[0];

    const existing = await pgClient.query('SELECT * FROM drawings WHERE approval_id = $1', [approval.id]);
    if (existing.rows.length > 0) {
      await pgClient.query('COMMIT');
      return res.json({ ...existing.rows[0], already_exists: true });
    }

    if (approval.status !== 'approved') {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Сначала подтвердите согласование' });
    }

    const versionRes = await pgClient.query(
      `SELECT * FROM drawing_approval_versions
        WHERE approval_id = $1 ORDER BY version_number DESC, id DESC LIMIT 1`,
      [approval.id]
    );
    if (versionRes.rows.length === 0) {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({ error: 'В согласовании нет файлов' });
    }
    const version = versionRes.rows[0];

    const drawingRes = await pgClient.query(
      `INSERT INTO drawings (name, file_path, file_type, description, client_id, approval_id, file_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [approval.title, version.file_path, version.file_type || null,
        approval.description || `Согласованный чертёж (согласование #${approval.id})`,
        approval.client_id, approval.id, fileSha256(version.file_path), req.user.id]
    );
    const drawing = drawingRes.rows[0];

    await pgClient.query(
      `INSERT INTO drawing_clients (drawing_id, client_id) VALUES ($1, $2)
       ON CONFLICT (drawing_id, client_id) DO NOTHING`,
      [drawing.id, approval.client_id]
    );

    await pgClient.query('COMMIT');
    res.status(201).json(drawing);
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    console.error('Ошибка переноса согласования в чертёж:', err);
    res.status(500).json({ error: err.message });
  } finally {
    pgClient.release();
  }
});

// === Версии файлов ===

// POST /api/clients/:clientId/approvals/:id/versions — загрузить версию
router.post('/:id/versions', auth, async (req, res) => {
  try {
    const { file_path, file_type, source, comment } = req.body;
    if (!file_path) return res.status(400).json({ error: 'Укажите файл' });

    const normalizedFilePath = normalizeUploadPath(file_path);
    if (!normalizedFilePath) {
      return res.status(400).json({ error: 'Недопустимый путь к файлу' });
    }

    // Определяем номер версии
    const countRes = await db.query(
      'SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM drawing_approval_versions WHERE approval_id = $1',
      [req.params.id]
    );
    const versionNumber = countRes.rows[0].max_ver + 1;

    const result = await db.query(
      `INSERT INTO drawing_approval_versions (approval_id, version_number, file_path, file_type, source, comment, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.id, versionNumber, normalizedFilePath, file_type || null, source || 'client', comment || null, req.user.id]
    );

    // Обновить updated_at у согласования
    await db.query('UPDATE drawing_approvals SET updated_at = now() WHERE id = $1', [req.params.id]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка добавления версии:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:clientId/approvals/:approvalId/versions/:id
router.delete('/:approvalId/versions/:id', auth, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM drawing_approval_versions WHERE id = $1 AND approval_id = $2 RETURNING id',
      [req.params.id, req.params.approvalId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдено' });
    res.json({ message: 'Версия удалена' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Комментарии ===

// POST /api/clients/:clientId/approvals/:id/comments
router.post('/:id/comments', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Введите комментарий' });

    const result = await db.query(
      `INSERT INTO drawing_approval_comments (approval_id, user_id, text)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, req.user.id, text.trim()]
    );

    // Получаем имя пользователя
    const userRes = await db.query('SELECT full_name FROM users WHERE id = $1', [req.user.id]);

    await db.query('UPDATE drawing_approvals SET updated_at = now() WHERE id = $1', [req.params.id]);

    res.status(201).json({
      ...result.rows[0],
      user_name: userRes.rows[0]?.full_name || 'Система',
    });
  } catch (err) {
    console.error('Ошибка добавления комментария:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:clientId/approvals/:approvalId/comments/:id
router.delete('/:approvalId/comments/:id', auth, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM drawing_approval_comments WHERE id = $1 AND approval_id = $2 RETURNING id',
      [req.params.id, req.params.approvalId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдено' });
    res.json({ message: 'Комментарий удалён' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
