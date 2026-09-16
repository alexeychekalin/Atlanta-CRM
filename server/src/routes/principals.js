const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/principals
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM principals ORDER BY name ASC');
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка получения принципалов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/principals/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM principals WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Принципал не найден' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка получения принципала:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/principals
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, agent_commission_pct, phone, email, notes } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Название принципала обязательно' });
    }

    const result = await db.query(
      `INSERT INTO principals (name, agent_commission_pct, phone, email, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, agent_commission_pct || 10, phone || null, email || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка создания принципала:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/principals/:id
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, agent_commission_pct, phone, email, notes, is_active } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Название принципала обязательно' });
    }

    const result = await db.query(
      `UPDATE principals SET name = $1, agent_commission_pct = $2, phone = $3, email = $4, notes = $5, is_active = $6
       WHERE id = $7 RETURNING *`,
      [name, agent_commission_pct || 10, phone || null, email || null, notes || null, is_active !== false, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Принципал не найден' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка обновления принципала:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/principals/:id
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM principals WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Принципал не найден' });
    }
    res.json({ message: 'Принципал удалён' });
  } catch (err) {
    console.error('Ошибка удаления принципала:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
