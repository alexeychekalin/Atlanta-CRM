const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { calculateItems, getVatSettings, calculateVat } = require('../services/pricing');
const { normalizeUploadPath } = require('../utils/files');

const router = express.Router();

// GET /api/orders — список заказов
router.get('/', auth, async (req, res) => {
  try {
    const { status, client_id, principal_id, date_from, date_to, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }
    if (client_id) {
      params.push(client_id);
      conditions.push(`o.client_id = $${params.length}`);
    }
    if (principal_id) {
      params.push(principal_id);
      conditions.push(`o.principal_id = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conditions.push(`o.order_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`o.order_date <= $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(o.order_number ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT o.*, c.name as client_name, p.name as principal_name, u.full_name as created_by_name
      FROM orders o
      LEFT JOIN clients c ON o.client_id = c.id
      LEFT JOIN principals p ON o.principal_id = p.id
      LEFT JOIN users u ON o.created_by = u.id
      ${where}
      ORDER BY o.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) FROM orders o
      LEFT JOIN clients c ON o.client_id = c.id
      ${where}
    `;

    const [result, countResult] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, params.slice(0, -2)),
    ]);

    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('Ошибка получения заказов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/orders/:id — детали заказа
router.get('/:id', auth, async (req, res) => {
  try {
    const orderResult = await db.query(
      `SELECT o.*, c.name as client_name, c.phone as client_phone, c.email as client_email,
              p.name as principal_name, p.agent_commission_pct as principal_commission_pct,
              u.full_name as created_by_name
       FROM orders o
       LEFT JOIN clients c ON o.client_id = c.id
       LEFT JOIN principals p ON o.principal_id = p.id
       LEFT JOIN users u ON o.created_by = u.id
       WHERE o.id = $1`,
      [req.params.id]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    const itemsResult = await db.query(
      `SELECT oi.*, c.article
       FROM order_items oi
       LEFT JOIN components c ON c.id = oi.product_id
       WHERE oi.order_id = $1 ORDER BY oi.id`,
      [req.params.id]
    );

    res.json({
      ...orderResult.rows[0],
      items: itemsResult.rows,
    });
  } catch (err) {
    console.error('Ошибка получения заказа:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Генерация номера заказа
async function generateOrderNumber() {
  const result = await db.query("SELECT MAX(id) as max_id FROM orders");
  const nextId = (result.rows[0].max_id || 0) + 1;
  return `ORD-${String(nextId).padStart(4, '0')}`;
}

// POST /api/orders — создать заказ
router.post('/', auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { client_id, principal_id, order_date, status, items, comment,
            invoice_number, payment_date, tracking_number } = req.body;
    const invoice_path = req.body.invoice_path ? normalizeUploadPath(req.body.invoice_path) : null;
    if (req.body.invoice_path && !invoice_path) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Недопустимый путь к счёту' });
    }

    if (!client_id || !principal_id || !Array.isArray(items) || items.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Клиент, принципал и позиции обязательны' });
    }

    const principalResult = await client.query(
      'SELECT agent_commission_pct FROM principals WHERE id = $1',
      [principal_id]
    );
    if (principalResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Принципал не найден' });
    }
    const commPct = parseFloat(principalResult.rows[0].agent_commission_pct) || 0;

    // Все цены и наценки считает сервер; наценка уровня берётся из БД
    let calculation;
    try {
      calculation = await calculateItems(client_id, items, client);
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(err.status || 400).json({ error: err.message });
    }

    const vatSettings = await getVatSettings(client);
    const vat = calculateVat(calculation.subtotal, vatSettings);
    const commissionAmount = Math.round(calculation.subtotal * commPct) / 100;
    const total = calculation.subtotal;
    const orderNumber = await generateOrderNumber();

    const orderResult = await client.query(
      `INSERT INTO orders (order_number, client_id, principal_id, order_date, status, subtotal, commission_pct, commission_amount, total,
       level_markup_pct, vat_rate, vat_amount, comment, invoice_path, invoice_number, payment_date, tracking_number, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
      [orderNumber, client_id, principal_id, order_date || new Date(), status || 'new',
       calculation.subtotal, commPct, commissionAmount, total, calculation.level.markupPct,
       vat.rate, vat.amount, comment || null, invoice_path || null, invoice_number || null,
       payment_date || null, tracking_number || null, req.user.id]
    );
    const order = orderResult.rows[0];

    for (const item of calculation.items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total,
         base_price, markup_pct, markup_rub, level_markup_pct, is_drawing, drawing_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [order.id, item.product_id, item.product_name, item.unit_price, item.quantity, item.line_total,
         item.base_price, item.markup_pct, item.markup_rub, item.level_markup_pct,
         item.is_drawing, item.drawing_id, item.metadata ? JSON.stringify(item.metadata) : null]
      );
    }

    await client.query('COMMIT');

    const fullOrder = await db.query(
      `SELECT o.*, c.name as client_name, p.name as principal_name
       FROM orders o
       LEFT JOIN clients c ON o.client_id = c.id
       LEFT JOIN principals p ON o.principal_id = p.id
       WHERE o.id = $1`,
      [order.id]
    );

    res.status(201).json(fullOrder.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Ошибка создания заказа:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  } finally {
    client.release();
  }
});

// PUT /api/orders/:id — обновить заказ
router.put('/:id', auth, async (req, res) => {
  const pgClient = await db.pool.connect();
  try {
    await pgClient.query('BEGIN');

    const { client_id, principal_id, order_date, status, items, comment,
            invoice_number, payment_date, tracking_number } = req.body;
    // Путь к счёту принимаем только из /uploads; иначе сохраняем прежнее значение
    const invoice_path = req.body.invoice_path
      ? normalizeUploadPath(req.body.invoice_path)
      : undefined;
    if (req.body.invoice_path && !invoice_path) {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Недопустимый путь к счёту' });
    }

    if (status && !items) {
      const result = await pgClient.query(
        `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [status, req.params.id]
      );
      if (result.rows.length === 0) {
        await pgClient.query('ROLLBACK');
        return res.status(404).json({ error: 'Заказ не найден' });
      }
      await pgClient.query('COMMIT');
      return res.json(result.rows[0]);
    }

    if (!client_id || !principal_id || !Array.isArray(items) || items.length === 0) {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Клиент, принципал и позиции обязательны' });
    }

    const existing = await pgClient.query('SELECT id, invoice_path, order_date FROM orders WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      await pgClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    const principalResult = await pgClient.query(
      'SELECT agent_commission_pct FROM principals WHERE id = $1',
      [principal_id]
    );
    if (principalResult.rows.length === 0) {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({ error: 'Принципал не найден' });
    }
    const commPct = parseFloat(principalResult.rows[0].agent_commission_pct) || 0;

    let calculation;
    try {
      calculation = await calculateItems(client_id, items, pgClient);
    } catch (err) {
      await pgClient.query('ROLLBACK');
      return res.status(err.status || 400).json({ error: err.message });
    }

    const vatSettings = await getVatSettings(pgClient);
    const vat = calculateVat(calculation.subtotal, vatSettings);
    const commissionAmount = Math.round(calculation.subtotal * commPct) / 100;
    const total = calculation.subtotal;
    const nextInvoicePath = invoice_path !== undefined ? invoice_path : existing.rows[0].invoice_path;

    const orderResult = await pgClient.query(
      `UPDATE orders SET client_id = $1, principal_id = $2, order_date = $3, status = $4,
       subtotal = $5, commission_pct = $6, commission_amount = $7, total = $8,
       level_markup_pct = $9, vat_rate = $10, vat_amount = $11, comment = $12,
       invoice_path = $13, invoice_number = $14, payment_date = $15, tracking_number = $16,
       updated_at = NOW()
       WHERE id = $17 RETURNING *`,
      [client_id, principal_id, order_date || existing.rows[0].order_date, status || 'new',
       calculation.subtotal, commPct, commissionAmount, total,
       calculation.level.markupPct, vat.rate, vat.amount, comment || null,
       nextInvoicePath, invoice_number || null, payment_date || null, tracking_number || null,
       req.params.id]
    );

    // Сохраняем metadata старых позиций (состав чертежа), если клиент её не прислал
    const oldItems = await pgClient.query(
      'SELECT product_id, product_name, drawing_id, metadata FROM order_items WHERE order_id = $1',
      [req.params.id]
    );
    const oldMetadata = new Map();
    for (const row of oldItems.rows) {
      oldMetadata.set(`${row.product_id || ''}|${row.drawing_id || ''}|${row.product_name}`, row.metadata);
    }

    await pgClient.query('DELETE FROM order_items WHERE order_id = $1', [req.params.id]);

    for (const item of calculation.items) {
      const key = `${item.product_id || ''}|${item.drawing_id || ''}|${item.product_name}`;
      const metadata = item.metadata || oldMetadata.get(key) || null;
      await pgClient.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total,
         base_price, markup_pct, markup_rub, level_markup_pct, is_drawing, drawing_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [req.params.id, item.product_id, item.product_name, item.unit_price, item.quantity, item.line_total,
         item.base_price, item.markup_pct, item.markup_rub, item.level_markup_pct,
         item.is_drawing, item.drawing_id, metadata ? JSON.stringify(metadata) : null]
      );
    }

    await pgClient.query('COMMIT');
    res.json(orderResult.rows[0]);
  } catch (err) {
    await pgClient.query('ROLLBACK');
    console.error('Ошибка обновления заказа:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  } finally {
    pgClient.release();
  }
});

// DELETE /api/orders/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM orders WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }
    res.json({ message: 'Заказ удалён' });
  } catch (err) {
    console.error('Ошибка удаления заказа:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PATCH /api/orders/:id/invoice — обновить данные счёта/оплаты/трека
router.patch('/:id/invoice', auth, async (req, res) => {
  try {
    const { invoice_number, payment_date, tracking_number } = req.body;
    const invoice_path = req.body.invoice_path ? normalizeUploadPath(req.body.invoice_path) : null;
    if (req.body.invoice_path && !invoice_path) {
      return res.status(400).json({ error: 'Недопустимый путь к счёту' });
    }
    const result = await db.query(
      `UPDATE orders SET
       invoice_path = COALESCE($1, invoice_path),
       invoice_number = COALESCE($2, invoice_number),
       payment_date = COALESCE($3, payment_date),
       tracking_number = COALESCE($4, tracking_number),
       updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [invoice_path || null, invoice_number || null, payment_date || null, tracking_number || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Заказ не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка обновления счёта:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
