const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/equipment-types
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM equipment_types ORDER BY sort_order, name'
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/equipment-types
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, icon, sort_order, is_active } = req.body;
    if (!name) return res.status(400).json({ error: 'Укажите название' });
    const result = await db.query(
      `INSERT INTO equipment_types (name, icon, sort_order, is_active)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, icon || null, sort_order || 0, is_active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/equipment-types/:id
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, icon, sort_order, is_active } = req.body;
    const result = await db.query(
      `UPDATE equipment_types SET
        name = COALESCE($1, name),
        icon = COALESCE($2, icon),
        sort_order = COALESCE($3, sort_order),
        is_active = COALESCE($4, is_active)
       WHERE id = $5 RETURNING *`,
      [name, icon, sort_order, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/equipment-types/:id
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM equipment_types WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
