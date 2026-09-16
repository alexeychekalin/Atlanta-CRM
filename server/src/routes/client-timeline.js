const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');

const router = express.Router({ mergeParams: true });

const eventIcons = {
  call: '📞', negotiation: '💬', price_change: '💰', deferral: '⏳',
  order: '📋', document: '📎', payment: '✅', issue: '⚠️', note: '📝',
};

// GET /api/clients/:id/timeline
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT t.*, u.full_name AS author_name
       FROM client_timeline t
       LEFT JOIN users u ON t.created_by = u.id
       WHERE t.client_id = $1
       ORDER BY t.event_date DESC, t.created_at DESC`,
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/timeline
router.post('/', auth, async (req, res) => {
  try {
    const { event_type, title, description, event_date } = req.body;
    if (!title) return res.status(400).json({ error: 'Укажите заголовок' });

    const result = await db.query(
      `INSERT INTO client_timeline (client_id, event_type, title, description, event_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.params.id, event_type || 'note', title, description || null, event_date || new Date(), req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:id/timeline/:eventId
router.put('/:eventId', auth, async (req, res) => {
  try {
    const { event_type, title, description, event_date } = req.body;
    const result = await db.query(
      `UPDATE client_timeline SET
        event_type = COALESCE($1, event_type),
        title = COALESCE($2, title),
        description = $3,
        event_date = COALESCE($4, event_date)
       WHERE id = $5 AND client_id = $6
       RETURNING *`,
      [event_type, title, description, event_date, req.params.eventId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Событие не найдено' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id/timeline/:eventId
router.delete('/:eventId', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM client_timeline WHERE id = $1 AND client_id = $2', [req.params.eventId, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
