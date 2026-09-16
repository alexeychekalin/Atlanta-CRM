const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router({ mergeParams: true });

// GET /api/clients/:clientId/contacts — список контактов клиента
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM client_contacts WHERE client_id = $1 ORDER BY full_name',
      [req.params.clientId]
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка получения контактов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/clients/:clientId/contacts — добавить контакт
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { full_name, position, email, phone, notes } = req.body;
    if (!full_name) {
      return res.status(400).json({ error: 'ФИО обязательно' });
    }
    const result = await db.query(
      `INSERT INTO client_contacts (client_id, full_name, position, email, phone, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.clientId, full_name, position || null, email || null, phone || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка создания контакта:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/clients/:clientId/contacts/:id — обновить контакт
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { full_name, position, email, phone, notes } = req.body;
    if (!full_name) {
      return res.status(400).json({ error: 'ФИО обязательно' });
    }
    const result = await db.query(
      `UPDATE client_contacts SET full_name = $1, position = $2, email = $3, phone = $4, notes = $5
       WHERE id = $6 AND client_id = $7 RETURNING *`,
      [full_name, position || null, email || null, phone || null, notes || null, req.params.id, req.params.clientId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Контакт не найден' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка обновления контакта:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/clients/:clientId/contacts/:id — удалить контакт
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM client_contacts WHERE id = $1 AND client_id = $2 RETURNING id',
      [req.params.id, req.params.clientId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Контакт не найден' });
    }
    res.json({ message: 'Контакт удалён' });
  } catch (err) {
    console.error('Ошибка удаления контакта:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
