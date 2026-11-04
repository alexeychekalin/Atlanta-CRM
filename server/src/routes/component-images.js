const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { normalizeUploadPath } = require('../utils/files');

const router = express.Router({ mergeParams: true });

// GET /api/components/:id/images — галерея позиции
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM component_images WHERE component_id = $1 ORDER BY sort_order, id`,
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка загрузки фото позиции:', err);
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
      'SELECT 1 FROM component_images WHERE component_id = $1 AND image_path = $2 LIMIT 1',
      [req.params.id, normalizedImage]
    );
    if (exists.rows.length > 0) {
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
      'SELECT image_path FROM component_images WHERE id = $1 AND component_id = $2',
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
router.delete('/:imgId', auth, async (req, res) => {
  try {
    const removed = await db.query(
      'DELETE FROM component_images WHERE id = $1 AND component_id = $2 RETURNING image_path',
      [req.params.imgId, req.params.id]
    );
    if (removed.rows.length === 0) return res.status(404).json({ error: 'Фото не найдено' });

    // обложка не должна ссылаться на удалённое фото
    await db.query(
      `UPDATE components SET image_path = (
         SELECT image_path FROM component_images WHERE component_id = $1 ORDER BY sort_order, id LIMIT 1
       ) WHERE id = $1 AND image_path = $2`,
      [req.params.id, removed.rows[0].image_path]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления фото позиции:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
