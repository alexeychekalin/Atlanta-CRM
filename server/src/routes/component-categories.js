const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/component-categories
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM component_categories ORDER BY sort_order, name');
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/component-categories
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'Укажите название категории' });

    const result = await db.query(
      'INSERT INTO component_categories (name, sort_order) VALUES ($1, $2) RETURNING *',
      [name, sort_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/component-categories/:id
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, sort_order } = req.body;
    const result = await db.query(
      'UPDATE component_categories SET name = COALESCE($1, name), sort_order = COALESCE($2, sort_order) WHERE id = $3 RETURNING *',
      [name, sort_order, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Категория не найдена' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/component-categories/:id
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM component_categories WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
