const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/manufacturers — список с фильтром
router.get('/', auth, async (req, res) => {
  try {
    const { search, equipment_type_id } = req.query;
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(LOWER(m.name) LIKE $${params.length} OR LOWER(m.country) LIKE $${params.length})`);
    }

    if (equipment_type_id) {
      params.push(equipment_type_id);
      conditions.push(`EXISTS (SELECT 1 FROM manufacturer_products mp WHERE mp.manufacturer_id = m.id AND mp.equipment_type_id = $${params.length})`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await db.query(`
      SELECT m.*,
        (SELECT COUNT(*) FROM manufacturer_products mp WHERE mp.manufacturer_id = m.id) AS products_count
      FROM manufacturers m
      ${where}
      ORDER BY m.name
    `, params);

    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/manufacturers/:id — карточка + продукция + компоненты
router.get('/:id', auth, async (req, res) => {
  try {
    const mfrResult = await db.query('SELECT * FROM manufacturers WHERE id = $1', [req.params.id]);
    if (mfrResult.rows.length === 0) return res.status(404).json({ error: 'Производитель не найден' });

    const mfr = mfrResult.rows[0];

    // Продукция
    const productsResult = await db.query(`
      SELECT mp.*, et.name AS equipment_type_name
      FROM manufacturer_products mp
      LEFT JOIN equipment_types et ON mp.equipment_type_id = et.id
      WHERE mp.manufacturer_id = $1
      ORDER BY mp.sort_order, mp.name
    `, [req.params.id]);

    // Компоненты каждой продукции
    for (const product of productsResult.rows) {
      const compsResult = await db.query(`
        SELECT mpc.*, c.article, c.name AS component_name, c.price AS component_price,
               c.image_path AS component_image,
               cm.code AS modification_code, cm.name AS modification_name,
               cm.price_override AS modification_price
        FROM manufacturer_product_components mpc
        JOIN components c ON mpc.component_id = c.id
        LEFT JOIN component_modifications cm ON mpc.modification_id = cm.id
        WHERE mpc.product_id = $1
        ORDER BY c.article
      `, [product.id]);
      product.components = compsResult.rows;
    }

    mfr.products = productsResult.rows;
    res.json(mfr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/manufacturers
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, address, website, phone, email, logo_path, description, contact_person, country } = req.body;
    if (!name) return res.status(400).json({ error: 'Укажите название' });

    const result = await db.query(
      `INSERT INTO manufacturers (name, address, website, phone, email, logo_path, description, contact_person, country)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name, address || null, website || null, phone || null, email || null, logo_path || null, description || null, contact_person || null, country || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/manufacturers/:id
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, address, website, phone, email, logo_path, description, contact_person, country, is_active } = req.body;
    const result = await db.query(
      `UPDATE manufacturers SET
        name = COALESCE($1, name),
        address = $2,
        website = $3,
        phone = $4,
        email = $5,
        logo_path = COALESCE($6, logo_path),
        description = $7,
        contact_person = $8,
        country = $9,
        is_active = COALESCE($10, is_active)
       WHERE id = $11 RETURNING *`,
      [name, address, website, phone, email, logo_path, description, contact_person, country, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/manufacturers/:id
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM manufacturers WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
