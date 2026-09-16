const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/pricing-levels — список уровней
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM client_pricing_levels ORDER BY sort_order, id'
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pricing-levels/:id — обновить уровень
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, markup_pct, sort_order } = req.body;
    const result = await db.query(
      `UPDATE client_pricing_levels 
       SET name = COALESCE($1, name),
           markup_pct = COALESCE($2, markup_pct),
           sort_order = COALESCE($3, sort_order)
       WHERE id = $4 RETURNING *`,
      [name, markup_pct, sort_order, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
