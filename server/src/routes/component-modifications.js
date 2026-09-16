const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router({ mergeParams: true });

// GET /api/components/:id/modifications — список модификаций компонента
router.get('/', auth, async (req, res) => {
  try {
    const modsRes = await db.query(
      `SELECT cm.*, 
        COALESCE(
          (SELECT json_agg(json_build_object('id', cmi.id, 'image_path', cmi.image_path, 'sort_order', cmi.sort_order) ORDER BY cmi.sort_order, cmi.id)
           FROM component_modification_images cmi WHERE cmi.modification_id = cm.id
          ), '[]'::json
        ) as images
       FROM component_modifications cm
       WHERE cm.component_id = $1
       ORDER BY cm.sort_order, cm.code`,
      [req.params.id]
    );
    res.json({ data: modsRes.rows });
  } catch (err) {
    console.error('Ошибка загрузки модификаций:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/components/:id/modifications — создать модификацию
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { code, name, price_override, is_active, sort_order } = req.body;
    if (!code) return res.status(400).json({ error: 'Укажите код модификации' });

    const result = await db.query(
      `INSERT INTO component_modifications (component_id, code, name, price_override, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, code.trim(), name || null, price_override || null,
       is_active !== false, sort_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Модификация с таким кодом уже существует для этого компонента' });
    }
    console.error('Ошибка создания модификации:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/components/:id/modifications/:modId — обновить модификацию
router.put('/:modId', auth, adminOnly, async (req, res) => {
  try {
    const { code, name, price_override, is_active, sort_order } = req.body;
    const result = await db.query(
      `UPDATE component_modifications SET
        code = COALESCE($1, code),
        name = $2,
        price_override = $3,
        is_active = COALESCE($4, is_active),
        sort_order = COALESCE($5, sort_order)
       WHERE id = $6 AND component_id = $7 RETURNING *`,
      [code, name || null, price_override || null, is_active, sort_order, req.params.modId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Модификация не найдена' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Модификация с таким кодом уже существует' });
    }
    console.error('Ошибка обновления модификации:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/components/:id/modifications/:modId — удалить модификацию
router.delete('/:modId', auth, adminOnly, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM component_modifications WHERE id = $1 AND component_id = $2',
      [req.params.modId, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления модификации:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/components/:id/modifications/:modId/images — добавить фото
router.post('/:modId/images', auth, adminOnly, async (req, res) => {
  try {
    const { image_path, sort_order } = req.body;
    if (!image_path) return res.status(400).json({ error: 'Укажите путь к изображению' });

    const result = await db.query(
      `INSERT INTO component_modification_images (modification_id, image_path, sort_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.modId, image_path, sort_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка добавления фото:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/components/:id/modifications/:modId/images/:imgId — удалить фото
router.delete('/:modId/images/:imgId', auth, adminOnly, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM component_modification_images WHERE id = $1 AND modification_id = $2',
      [req.params.imgId, req.params.modId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления фото:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
