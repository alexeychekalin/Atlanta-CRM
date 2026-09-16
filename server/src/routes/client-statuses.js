const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/client-statuses — список статусов
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM client_work_statuses ORDER BY sort_order, id'
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/client-statuses — создать статус
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, color, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'Укажите название статуса' });

    const result = await db.query(
      `INSERT INTO client_work_statuses (name, color, sort_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, color || '#64748b', sort_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/client-statuses/:id — обновить статус
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, color, sort_order, is_active } = req.body;
    const result = await db.query(
      `UPDATE client_work_statuses 
       SET name = COALESCE($1, name), color = COALESCE($2, color), 
           sort_order = COALESCE($3, sort_order), is_active = COALESCE($4, is_active)
       WHERE id = $5 RETURNING *`,
      [name, color, sort_order, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Статус не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/client-statuses/:id
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM client_work_statuses WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
