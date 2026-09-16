const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/products
router.get('/', auth, async (req, res) => {
  try {
    const { search, active } = req.query;
    let query = 'SELECT * FROM products';
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }
    if (active !== undefined) {
      params.push(active === 'true');
      conditions.push(`is_active = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY name ASC';

    const result = await db.query(query, params);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка получения товаров:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/products/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Товар не найден' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка получения товара:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/products
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, base_price, unit, description, is_active } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Название товара обязательно' });
    }

    const result = await db.query(
      `INSERT INTO products (name, base_price, unit, description, is_active)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, base_price || 0, unit || 'шт.', description || null, is_active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка создания товара:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/products/:id
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, base_price, unit, description, is_active } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Название товара обязательно' });
    }

    const result = await db.query(
      `UPDATE products SET name = $1, base_price = $2, unit = $3, description = $4, is_active = $5
       WHERE id = $6 RETURNING *`,
      [name, base_price || 0, unit || 'шт.', description || null, is_active !== false, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Товар не найден' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка обновления товара:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM products WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Товар не найден' });
    }
    res.json({ message: 'Товар удалён' });
  } catch (err) {
    console.error('Ошибка удаления товара:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
