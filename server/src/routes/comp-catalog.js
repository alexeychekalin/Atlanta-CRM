const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/components
router.get('/', auth, async (req, res) => {
  try {
    const { category_id, search, active } = req.query;
    let sql = `
      SELECT c.*, cc.name AS category_name,
        (SELECT COUNT(*) FROM component_modifications cm WHERE cm.component_id = c.id) AS modifications_count,
        (SELECT COUNT(*) FROM component_documents cd WHERE cd.component_id = c.id) AS doc_count
      FROM components c
      LEFT JOIN component_categories cc ON c.category_id = cc.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (category_id) {
      sql += ` AND c.category_id = $${idx++}`;
      params.push(category_id);
    }
    if (search) {
      sql += ` AND (c.article ILIKE $${idx} OR c.name ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (active === 'true') {
      sql += ` AND c.is_active = true`;
    }

    sql += ' ORDER BY cc.sort_order, cc.name, c.name';

    const result = await db.query(sql, params);
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/components/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, cc.name AS category_name
       FROM components c
       LEFT JOIN component_categories cc ON c.category_id = cc.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Компонент не найден' });

    const comp = result.rows[0];

    // Загрузить модификации с фото
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
    comp.modifications = modsRes.rows;

    res.json(comp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/components
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { category_id, article, name, price, image_path, description, comment, is_active } = req.body;
    if (!article || !name) return res.status(400).json({ error: 'Укажите артикул и название' });

    const result = await db.query(
      `INSERT INTO components (category_id, article, name, price, image_path, description, comment, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [category_id || null, article, name, price || 0, image_path || null, description || null, comment || null, is_active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Артикул уже существует' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/components/:id
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { category_id, article, name, price, image_path, description, comment, is_active } = req.body;
    const result = await db.query(
      `UPDATE components SET
        category_id = COALESCE($1, category_id),
        article = COALESCE($2, article),
        name = COALESCE($3, name),
        price = COALESCE($4, price),
        image_path = COALESCE($5, image_path),
        description = $6,
        comment = $7,
        is_active = COALESCE($8, is_active)
       WHERE id = $9
       RETURNING *`,
      [category_id, article, name, price, image_path, description, comment, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Компонент не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Артикул уже существует' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/components/:id
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM components WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
