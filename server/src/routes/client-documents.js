const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const fs = require('fs');
const { normalizeUploadPath, safeUploadPath, fileSha256 } = require('../utils/files');

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

    const normalizedPath = normalizeUploadPath(file_path);
    if (!normalizedPath || !fs.existsSync(safeUploadPath(normalizedPath))) {
      return res.status(400).json({ error: 'Недопустимый путь к файлу' });
    }

    const result = await db.query(
      `INSERT INTO client_documents (client_id, name, file_path, file_type, description, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, String(name).slice(0, 300), normalizedPath, file_type || null, description || null, req.user.id]
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

// === Чертежи клиента (единая таблица drawings) ===

// GET /api/clients/:id/drawings — чертежи клиента (владелец или привязанные)
router.get('/drawings', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT d.*, u.full_name AS author_name,
        COUNT(dc.id) AS components_count,
        (SELECT array_agg(dcl.client_id) FROM drawing_clients dcl
          WHERE dcl.drawing_id = d.id) AS client_ids,
        CASE WHEN d.fixed_price IS NOT NULL THEN d.fixed_price
          ELSE COALESCE(SUM(COALESCE(cm.price_override, comp.price) * dc.quantity), 0)
        END AS base_cost,
        CASE WHEN COALESCE(dlc.fixed_price, d.fixed_price) IS NOT NULL
          THEN COALESCE(dlc.fixed_price, d.fixed_price)
          ELSE ROUND(
            COALESCE(SUM(
              (COALESCE(cm.price_override, comp.price) * dc.quantity) * (1 + COALESCE(dc.item_markup_pct, 0)/100)
              + COALESCE(dc.item_markup_rub, 0)
            ), 0)
            * (1 + COALESCE(dlc.markup_pct, cpl.markup_pct, d.level_markup_pct, 0)/100)
            * (1 + COALESCE(d.global_markup_pct, 0)/100)
            + COALESCE(d.global_markup_rub, 0)
          , 2)
        END AS total_cost,
        COALESCE(dlc.fixed_price, d.fixed_price) AS client_fixed_price,
        EXISTS (SELECT 1 FROM drawing_calculations calc
                 WHERE calc.drawing_id = d.id AND calc.client_id = $1) AS is_calculated
       FROM drawings d
       LEFT JOIN users u ON d.created_by = u.id
       LEFT JOIN drawing_components dc ON d.id = dc.drawing_id
       LEFT JOIN components comp ON dc.component_id = comp.id
       LEFT JOIN component_modifications cm ON cm.id = dc.modification_id
       LEFT JOIN drawing_clients dlc ON dlc.drawing_id = d.id AND dlc.client_id = $1
       LEFT JOIN clients cl ON cl.id = $1
       LEFT JOIN client_pricing_levels cpl ON cpl.id = cl.pricing_level_id
       WHERE (d.client_id = $1 OR dlc.id IS NOT NULL)
         AND d.archived_at IS NULL
       GROUP BY d.id, u.full_name, dlc.markup_pct, cpl.markup_pct, dlc.fixed_price
       ORDER BY d.created_at DESC`,
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/drawings — загрузить чертёж (файл без BOM)
router.post('/drawings', auth, async (req, res) => {
  try {
    const { name, file_path, file_type, description } = req.body;
    if (!name || !file_path) return res.status(400).json({ error: 'Укажите название и файл' });

    const normalizedPath = normalizeUploadPath(file_path);
    if (!normalizedPath || !fs.existsSync(safeUploadPath(normalizedPath))) {
      return res.status(400).json({ error: 'Недопустимый путь к файлу' });
    }

    const hash = fileSha256(normalizedPath);
    if (hash) {
      const dup = await db.query(
        'SELECT id, name FROM drawings WHERE file_hash = $1 AND archived_at IS NULL LIMIT 1', [hash]);
      if (dup.rows.length > 0) {
        return res.status(409).json({
          error: 'Такой файл уже загружен — привяжите существующий чертёж к клиенту',
          duplicate: dup.rows[0],
        });
      }
    }

    const result = await db.query(
      `INSERT INTO drawings (name, file_path, file_type, description, client_id, file_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [String(name).slice(0, 300), normalizedPath, file_type || null, description || null,
        req.params.id, hash, req.user.id]
    );

    await db.query(
      `INSERT INTO drawing_clients (drawing_id, client_id) VALUES ($1, $2)
       ON CONFLICT (drawing_id, client_id) DO NOTHING`,
      [result.rows[0].id, req.params.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id/drawings/:drawingId — в архив (не удаляем)
router.delete('/drawings/:drawingId', auth, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE drawings SET archived_at = now()
        WHERE id = $1 AND (client_id = $2 OR EXISTS (
          SELECT 1 FROM drawing_clients dcl WHERE dcl.drawing_id = drawings.id AND dcl.client_id = $2))
        RETURNING id`,
      [req.params.drawingId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Чертёж не найден' });
    res.json({ success: true, archived: true });
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
      'SELECT COUNT(*) AS count FROM drawings WHERE client_id = $1',
      [req.params.id]
    );

    const calcsCount = await db.query(
      `SELECT COUNT(*) AS count FROM drawings d
       WHERE d.client_id = $1
         AND (d.fixed_price IS NOT NULL OR EXISTS (SELECT 1 FROM drawing_components dc WHERE dc.drawing_id = d.id))`,
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

// === Расчёты (чертежи с BOM или фикс. ценой) ===

// GET /api/clients/:id/calculations
router.get('/calculations', auth, async (req, res) => {
  try {
    const drawings = await db.query(`
      SELECT d.*, u.full_name AS author_name,
        COUNT(dc.id) AS components_count,
        CASE WHEN d.fixed_price IS NOT NULL THEN d.fixed_price
          ELSE COALESCE(SUM(COALESCE(cm.price_override, comp.price) * dc.quantity), 0)
        END AS base_cost,
        CASE WHEN COALESCE(dlc.fixed_price, d.fixed_price) IS NOT NULL
          THEN COALESCE(dlc.fixed_price, d.fixed_price)
          ELSE ROUND(
            COALESCE(SUM(
              (COALESCE(cm.price_override, comp.price) * dc.quantity) * (1 + COALESCE(dc.item_markup_pct, 0)/100)
              + COALESCE(dc.item_markup_rub, 0)
            ), 0)
            * (1 + COALESCE(dlc.markup_pct, cpl.markup_pct, d.level_markup_pct, 0)/100)
            * (1 + COALESCE(d.global_markup_pct, 0)/100)
            + COALESCE(d.global_markup_rub, 0)
          , 2)
        END AS total_cost
      FROM drawings d
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN drawing_components dc ON d.id = dc.drawing_id
      LEFT JOIN components comp ON dc.component_id = comp.id
      LEFT JOIN component_modifications cm ON cm.id = dc.modification_id
      LEFT JOIN drawing_clients dlc ON dlc.drawing_id = d.id AND dlc.client_id = $1
      LEFT JOIN clients cl ON cl.id = $1
      LEFT JOIN client_pricing_levels cpl ON cpl.id = cl.pricing_level_id
      WHERE (d.client_id = $1 OR dlc.id IS NOT NULL)
        AND d.archived_at IS NULL
        AND (d.fixed_price IS NOT NULL OR EXISTS (SELECT 1 FROM drawing_components dc2 WHERE dc2.drawing_id = d.id))
      GROUP BY d.id, u.full_name, dlc.markup_pct, cpl.markup_pct, dlc.fixed_price
      ORDER BY d.created_at DESC
    `, [req.params.id]);

    res.json({ data: drawings.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Журнал расчётов клиента ===

// GET /api/clients/:id/calculation-journal
router.get('/calculation-journal', auth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const result = await db.query(
      `SELECT calc.*, p.name AS principal_name, u.full_name AS author_name,
              d.archived_at AS drawing_archived_at
         FROM drawing_calculations calc
         LEFT JOIN principals p ON p.id = calc.principal_id
         LEFT JOIN users u ON u.id = calc.created_by
         LEFT JOIN drawings d ON d.id = calc.drawing_id
        WHERE calc.client_id = $1
        ORDER BY calc.created_at DESC, calc.id DESC
        LIMIT $2`,
      [req.params.id, limit]
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
