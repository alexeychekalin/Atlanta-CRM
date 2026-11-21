const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { normalizeUploadPath } = require('../utils/files');
const { coverSync } = require('../services/component-photos');

const router = express.Router({ mergeParams: true });

// GET /api/components/:id/images — галерея позиции
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM component_images
        WHERE component_id = $1 AND deleted_at IS NULL
        ORDER BY sort_order, id`,
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка загрузки фото позиции:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/components/:id/images/removed — снимки, убранные в карточке
// Импорт каталога их больше не возвращает, поэтому нужен список, чтобы
// вернуть случайно удалённое.
router.get('/removed', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, image_path, sort_order, deleted_at
         FROM component_images
        WHERE component_id = $1 AND deleted_at IS NOT NULL
        ORDER BY deleted_at DESC, id`,
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка загрузки убранных фото:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/components/:id/images — добавить фото в галерею
router.post('/', auth, async (req, res) => {
  try {
    const { image_path, sort_order } = req.body;
    if (!image_path) return res.status(400).json({ error: 'Укажите путь к изображению' });

    const normalizedImage = normalizeUploadPath(image_path);
    if (!normalizedImage) {
      return res.status(400).json({ error: 'Недопустимый путь к изображению' });
    }

    const exists = await db.query(
      `SELECT id, deleted_at FROM component_images
        WHERE component_id = $1 AND image_path = $2
        ORDER BY deleted_at NULLS FIRST LIMIT 1`,
      [req.params.id, normalizedImage]
    );
    if (exists.rows.length > 0) {
      const row = exists.rows[0];
      // Фото было убрано — добавление вручную означает «вернуть»
      if (row.deleted_at) {
        await db.query('UPDATE component_images SET deleted_at = NULL WHERE id = $1', [row.id]);
        await coverSync(db, req.params.id, { fallback: normalizedImage });
        return res.status(201).json({ ...row, deleted_at: null, restored: true });
      }
      return res.status(400).json({ error: 'Это фото уже есть в галерее' });
    }

    const result = await db.query(
      `INSERT INTO component_images (component_id, image_path, sort_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, normalizedImage, sort_order || 0]
    );

    // пустая обложка заполняется первым фото галереи
    await db.query(
      'UPDATE components SET image_path = $2 WHERE id = $1 AND image_path IS NULL',
      [req.params.id, normalizedImage]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка добавления фото позиции:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/components/:id/images/:imgId/cover — сделать фото обложкой
router.put('/:imgId/cover', auth, async (req, res) => {
  try {
    const image = await db.query(
      'SELECT image_path FROM component_images WHERE id = $1 AND component_id = $2 AND deleted_at IS NULL',
      [req.params.imgId, req.params.id]
    );
    if (image.rows.length === 0) return res.status(404).json({ error: 'Фото не найдено' });

    await db.query(
      'UPDATE components SET image_path = $2 WHERE id = $1',
      [req.params.id, image.rows[0].image_path]
    );
    res.json({ success: true, image_path: image.rows[0].image_path });
  } catch (err) {
    console.error('Ошибка смены обложки:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/components/:id/images/:imgId — убрать фото из галереи
//
// Строку не стираем, а помечаем deleted_at: импорт каталога видит отметку и не
// прикладывает снимок заново. Вернуть можно через POST .../images/:imgId/restore.
router.delete('/:imgId', auth, async (req, res) => {
  try {
    const removed = await db.query(
      `UPDATE component_images SET deleted_at = now()
        WHERE id = $1 AND component_id = $2 AND deleted_at IS NULL
        RETURNING image_path`,
      [req.params.imgId, req.params.id]
    );
    if (removed.rows.length === 0) return res.status(404).json({ error: 'Фото не найдено' });

    // обложка не должна ссылаться на удалённое фото
    await coverSync(db, req.params.id, { onlyPath: removed.rows[0].image_path });

    res.json({ success: true, hidden: true });
  } catch (err) {
    console.error('Ошибка удаления фото позиции:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/components/:id/images/:imgId/restore — вернуть убранное фото
router.post('/:imgId/restore', auth, async (req, res) => {
  try {
    const restored = await db.query(
      `UPDATE component_images SET deleted_at = NULL
        WHERE id = $1 AND component_id = $2 AND deleted_at IS NOT NULL
        RETURNING image_path`,
      [req.params.imgId, req.params.id]
    );
    if (restored.rows.length === 0) return res.status(404).json({ error: 'Убранное фото не найдено' });

    await coverSync(db, req.params.id, { fallback: restored.rows[0].image_path });
    res.json({ success: true, restored: true });
  } catch (err) {
    console.error('Ошибка возврата фото:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
