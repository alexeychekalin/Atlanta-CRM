const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router();

// GET /api/clients
router.get('/', auth, async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    let query = `
      SELECT c.*, 
        cws.name AS status_name, cws.color AS status_color,
        cpl.name AS pricing_level_name, cpl.code AS pricing_level_code, cpl.markup_pct AS pricing_markup_pct
      FROM clients c
      LEFT JOIN client_work_statuses cws ON c.status_id = cws.id
      LEFT JOIN client_pricing_levels cpl ON c.pricing_level_id = cpl.id
    `;
    let countQuery = 'SELECT COUNT(*) FROM clients c';
    const params = [];
    const countParams = [];

    if (search) {
      const where = ' WHERE c.name ILIKE $1 OR c.phone ILIKE $1 OR c.email ILIKE $1';
      query += where;
      countQuery += where;
      params.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }

    query += ` ORDER BY c.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [result, countResult] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, countParams),
    ]);

    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('Ошибка получения клиентов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/clients/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, 
        cws.name AS status_name, cws.color AS status_color,
        cpl.name AS pricing_level_name, cpl.code AS pricing_level_code, cpl.markup_pct AS pricing_markup_pct
       FROM clients c
       LEFT JOIN client_work_statuses cws ON c.status_id = cws.id
       LEFT JOIN client_pricing_levels cpl ON c.pricing_level_id = cpl.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Клиент не найден' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка получения клиента:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/clients
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, phone, email, address, notes, avatar_path, status_id, pricing_level_id,
            delivery_address, delivery_contact_name, delivery_contact_phone,
            inn, kpp, legal_address, bank_details, ogrnip } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Название клиента обязательно' });
    }

    const result = await db.query(
      `INSERT INTO clients (name, phone, email, address, notes, avatar_path, status_id, pricing_level_id,
       delivery_address, delivery_contact_name, delivery_contact_phone,
       inn, kpp, legal_address, bank_details, ogrnip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [name, phone || null, email || null, address || null, notes || null,
       avatar_path || null, status_id || null, pricing_level_id || null,
       delivery_address || null, delivery_contact_name || null, delivery_contact_phone || null,
       inn || null, kpp || null, legal_address || null, bank_details || null, ogrnip || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка создания клиента:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/clients/:id
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, phone, email, address, notes, avatar_path, status_id, pricing_level_id,
            delivery_address, delivery_contact_name, delivery_contact_phone,
            inn, kpp, legal_address, bank_details, ogrnip } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Название клиента обязательно' });
    }

    const result = await db.query(
      `UPDATE clients SET name = $1, phone = $2, email = $3, address = $4, notes = $5, 
       avatar_path = $6, status_id = $7, pricing_level_id = $8,
       delivery_address = $9, delivery_contact_name = $10, delivery_contact_phone = $11,
       inn = $12, kpp = $13, legal_address = $14, bank_details = $15, ogrnip = $16
       WHERE id = $17 RETURNING *`,
      [name, phone || null, email || null, address || null, notes || null, 
       avatar_path !== undefined ? avatar_path : null, status_id || null, pricing_level_id || null,
       delivery_address || null, delivery_contact_name || null, delivery_contact_phone || null,
       inn || null, kpp || null, legal_address || null, bank_details || null, ogrnip || null,
       req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Клиент не найден' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка обновления клиента:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PATCH /api/clients/:id/avatar — обновить только аватар
router.patch('/:id/avatar', auth, adminOnly, async (req, res) => {
  try {
    const { avatar_path } = req.body;
    const result = await db.query(
      'UPDATE clients SET avatar_path = $1 WHERE id = $2 RETURNING *',
      [avatar_path || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Клиент не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/clients/:id/status — обновить только статус
router.patch('/:id/status', auth, adminOnly, async (req, res) => {
  try {
    const { status_id } = req.body;
    const result = await db.query(
      'UPDATE clients SET status_id = $1 WHERE id = $2 RETURNING *',
      [status_id || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Клиент не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM clients WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Клиент не найден' });
    }
    res.json({ message: 'Клиент удалён' });
  } catch (err) {
    console.error('Ошибка удаления клиента:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
