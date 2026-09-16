const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/manufacturer-products
router.get('/', auth, async (req, res) => {
  try {
    const { manufacturer_id, equipment_type_id, search } = req.query;
    const conditions = [];
    const params = [];

    if (manufacturer_id) {
      params.push(manufacturer_id);
      conditions.push(`mp.manufacturer_id = $${params.length}`);
    }
    if (equipment_type_id) {
      params.push(equipment_type_id);
      conditions.push(`mp.equipment_type_id = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(mp.name ILIKE $${params.length} OR mp.model ILIKE $${params.length})`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await db.query(`
      SELECT mp.*, m.name AS manufacturer_name, et.name AS equipment_type_name,
        (SELECT COUNT(*) FROM manufacturer_product_components mpc WHERE mpc.product_id = mp.id) AS components_count
      FROM manufacturer_products mp
      LEFT JOIN manufacturers m ON mp.manufacturer_id = m.id
      LEFT JOIN equipment_types et ON mp.equipment_type_id = et.id
      ${where}
      ORDER BY mp.sort_order, mp.name
    `, params);

    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/manufacturer-products/:id — деталь с компонентами
router.get('/:id', auth, async (req, res) => {
  try {
    const prodResult = await db.query(`
      SELECT mp.*, m.name AS manufacturer_name, et.name AS equipment_type_name
      FROM manufacturer_products mp
      LEFT JOIN manufacturers m ON mp.manufacturer_id = m.id
      LEFT JOIN equipment_types et ON mp.equipment_type_id = et.id
      WHERE mp.id = $1
    `, [req.params.id]);

    if (prodResult.rows.length === 0) return res.status(404).json({ error: 'Продукция не найдена' });

    const product = prodResult.rows[0];

    const compsResult = await db.query(`
      SELECT mpc.*, c.article, c.name AS component_name, c.price AS component_price,
             c.image_path AS component_image, c.category_id,
             cc.name AS category_name,
             cm.code AS modification_code, cm.name AS modification_name,
             cm.price_override AS modification_price
      FROM manufacturer_product_components mpc
      JOIN components c ON mpc.component_id = c.id
      LEFT JOIN component_categories cc ON c.category_id = cc.id
      LEFT JOIN component_modifications cm ON mpc.modification_id = cm.id
      WHERE mpc.product_id = $1
      ORDER BY c.article
    `, [req.params.id]);

    product.components = compsResult.rows;
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/manufacturer-products
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { manufacturer_id, equipment_type_id, name, model, description, image_path, drawing_id, sort_order } = req.body;
    if (!manufacturer_id || !name) return res.status(400).json({ error: 'Укажите производителя и название' });

    const result = await db.query(
      `INSERT INTO manufacturer_products (manufacturer_id, equipment_type_id, name, model, description, image_path, drawing_id, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [manufacturer_id, equipment_type_id || null, name, model || null, description || null, image_path || null, drawing_id || null, sort_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/manufacturer-products/:id
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { manufacturer_id, equipment_type_id, name, model, description, image_path, drawing_id, sort_order, is_active } = req.body;
    const result = await db.query(
      `UPDATE manufacturer_products SET
        manufacturer_id = COALESCE($1, manufacturer_id),
        equipment_type_id = $2,
        name = COALESCE($3, name),
        model = $4,
        description = $5,
        image_path = COALESCE($6, image_path),
        drawing_id = $7,
        sort_order = COALESCE($8, sort_order),
        is_active = COALESCE($9, is_active)
       WHERE id = $10 RETURNING *`,
      [manufacturer_id, equipment_type_id, name, model, description, image_path, drawing_id, sort_order, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдена' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/manufacturer-products/:id
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM manufacturer_products WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Управление компонентами продукции ===

// POST /api/manufacturer-products/:id/components — добавить компонент
router.post('/:id/components', auth, adminOnly, async (req, res) => {
  try {
    const { component_id, modification_id, quantity, notes } = req.body;
    if (!component_id) return res.status(400).json({ error: 'Укажите компонент' });

    const result = await db.query(
      `INSERT INTO manufacturer_product_components (product_id, component_id, modification_id, quantity, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (product_id, component_id, modification_id) DO UPDATE SET quantity = EXCLUDED.quantity, notes = EXCLUDED.notes
       RETURNING *`,
      [req.params.id, component_id, modification_id || null, quantity || 1, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/manufacturer-products/:id/components/:compId — обновить кол-во
router.put('/:id/components/:compId', auth, adminOnly, async (req, res) => {
  try {
    const { quantity, notes } = req.body;
    const result = await db.query(
      `UPDATE manufacturer_product_components SET quantity = COALESCE($1, quantity), notes = $2
       WHERE id = $3 AND product_id = $4 RETURNING *`,
      [quantity, notes, req.params.compId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/manufacturer-products/:id/components/:compId — удалить компонент
router.delete('/:id/components/:compId', auth, adminOnly, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM manufacturer_product_components WHERE id = $1 AND product_id = $2',
      [req.params.compId, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
