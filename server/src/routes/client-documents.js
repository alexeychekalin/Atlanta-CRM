const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

// GET /api/clients/:id/documents
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT d.*, u.full_name AS uploaded_by_name
       FROM client_documents d
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.client_id = $1
       ORDER BY d.created_at DESC`,
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/documents
router.post('/', auth, async (req, res) => {
  try {
    const { name, file_path, file_type, description } = req.body;
    if (!name || !file_path) return res.status(400).json({ error: 'Укажите название и файл' });

    const result = await db.query(
      `INSERT INTO client_documents (client_id, name, file_path, file_type, description, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, name, file_path, file_type || null, description || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id/documents/:docId
router.delete('/:docId', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM client_documents WHERE id = $1 AND client_id = $2', [req.params.docId, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Чертежи клиента (отдельные от калькулятора) ===

// GET /api/clients/:id/drawings
router.get('/drawings', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT d.*, u.full_name AS uploaded_by_name
       FROM client_drawings d
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.client_id = $1
       ORDER BY d.created_at DESC`,
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/drawings
router.post('/drawings', auth, async (req, res) => {
  try {
    const { name, file_path, file_type, description } = req.body;
    if (!name || !file_path) return res.status(400).json({ error: 'Укажите название и файл' });

    const result = await db.query(
      `INSERT INTO client_drawings (client_id, name, file_path, file_type, description, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, name, file_path, file_type || null, description || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id/drawings/:drawingId
router.delete('/drawings/:drawingId', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM client_drawings WHERE id = $1 AND client_id = $2', [req.params.drawingId, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Статистика клиента ===

// GET /api/clients/:id/stats
router.get('/stats', auth, async (req, res) => {
  try {
    const statsRes = await db.query(`
      SELECT
        COUNT(o.id) AS total_orders,
        COALESCE(SUM(o.subtotal), 0) AS total_subtotal,
        COALESCE(SUM(o.commission_amount), 0) AS total_commission,
        COALESCE(SUM(o.total), 0) AS total_amount,
        COUNT(CASE WHEN o.status = 'new' THEN 1 END) AS new_orders,
        COUNT(CASE WHEN o.status = 'in_progress' THEN 1 END) AS in_progress_orders,
        COUNT(CASE WHEN o.status = 'paid' THEN 1 END) AS paid_orders,
        COUNT(CASE WHEN o.status = 'completed' THEN 1 END) AS completed_orders
      FROM orders o
      WHERE o.client_id = $1
    `, [req.params.id]);

    const drawingsCount = await db.query(
      'SELECT COUNT(*) AS count FROM client_drawings WHERE client_id = $1',
      [req.params.id]
    );

    const calcsCount = await db.query(
      'SELECT COUNT(*) AS count FROM drawings WHERE client_id = $1',
      [req.params.id]
    );

    const timelineCount = await db.query(
      'SELECT COUNT(*) AS count FROM client_timeline WHERE client_id = $1',
      [req.params.id]
    );

    res.json({
      ...statsRes.rows[0],
      drawings_count: parseInt(drawingsCount.rows[0].count),
      calcs_count: parseInt(calcsCount.rows[0].count),
      timeline_count: parseInt(timelineCount.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Расчёты (шаблоны калькулятора связанные с клиентом) ===

// GET /api/clients/:id/calculations
router.get('/calculations', auth, async (req, res) => {
  try {
    // Заказы клиента из калькулятора + шаблоны drawings привязанные к клиенту
    const drawings = await db.query(`
      SELECT d.*, u.full_name AS author_name,
        COUNT(dc.id) AS components_count,
        COALESCE(SUM(comp.price * dc.quantity), 0) AS base_cost
      FROM drawings d
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN drawing_components dc ON d.id = dc.drawing_id
      LEFT JOIN components comp ON dc.component_id = comp.id
      WHERE d.client_id = $1
      GROUP BY d.id, u.full_name
      ORDER BY d.created_at DESC
    `, [req.params.id]);

    res.json({ data: drawings.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
