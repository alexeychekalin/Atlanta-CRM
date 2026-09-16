const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard
router.get('/', auth, async (req, res) => {
  try {
    // KPI: общие показатели
    const kpiQuery = `
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(subtotal), 0) as total_subtotal,
        COALESCE(SUM(commission_amount), 0) as total_commission,
        COALESCE(SUM(total), 0) as total_amount,
        COUNT(CASE WHEN status = 'new' THEN 1 END) as new_orders,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_orders,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_orders,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders
      FROM orders
    `;

    // Количество клиентов
    const clientsQuery = 'SELECT COUNT(*) as total_clients FROM clients';

    // Заказы по месяцам (последние 12 месяцев)
    const monthlyQuery = `
      SELECT
        TO_CHAR(order_date, 'YYYY-MM') as month,
        TO_CHAR(order_date, 'Mon YYYY') as month_label,
        COUNT(*) as count,
        COALESCE(SUM(total), 0) as amount
      FROM orders
      WHERE order_date >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(order_date, 'YYYY-MM'), TO_CHAR(order_date, 'Mon YYYY')
      ORDER BY month
    `;

    // Последние 5 заказов
    const recentQuery = `
      SELECT o.id, o.order_number, o.order_date, o.status, o.total,
             c.name as client_name
      FROM orders o
      LEFT JOIN clients c ON o.client_id = c.id
      ORDER BY o.created_at DESC
      LIMIT 5
    `;

    const [kpiResult, clientsResult, monthlyResult, recentResult] = await Promise.all([
      db.query(kpiQuery),
      db.query(clientsQuery),
      db.query(monthlyQuery),
      db.query(recentQuery),
    ]);

    res.json({
      kpi: {
        ...kpiResult.rows[0],
        total_clients: clientsResult.rows[0].total_clients,
      },
      monthly: monthlyResult.rows,
      recent_orders: recentResult.rows,
    });
  } catch (err) {
    console.error('Ошибка получения дашборда:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/dashboard/clients — дашборд руководителя (клиенты со статистикой)
router.get('/clients', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.id, c.name, c.phone, c.email, c.avatar_path, c.status_id, c.created_at,
        cws.name AS status_name, cws.color AS status_color,
        COUNT(o.id) AS total_orders,
        COALESCE(SUM(o.total), 0) AS total_amount,
        COALESCE(SUM(o.commission_amount), 0) AS total_commission,
        COUNT(CASE WHEN o.status = 'new' THEN 1 END) AS new_orders,
        COUNT(CASE WHEN o.status = 'in_progress' THEN 1 END) AS in_progress_orders,
        COUNT(CASE WHEN o.status = 'paid' THEN 1 END) AS paid_orders,
        COUNT(CASE WHEN o.status = 'completed' THEN 1 END) AS completed_orders,
        MAX(o.order_date) AS last_order_date
      FROM clients c
      LEFT JOIN client_work_statuses cws ON c.status_id = cws.id
      LEFT JOIN orders o ON c.id = o.client_id
      GROUP BY c.id, c.name, c.phone, c.email, c.avatar_path, c.status_id, c.created_at,
               cws.name, cws.color
      ORDER BY total_amount DESC
    `);

    // Статистика по статусам клиентов
    const statusStats = await db.query(`
      SELECT cws.name, cws.color, COUNT(c.id) AS count
      FROM client_work_statuses cws
      LEFT JOIN clients c ON c.status_id = cws.id
      GROUP BY cws.id, cws.name, cws.color
      ORDER BY cws.sort_order
    `);

    res.json({
      clients: result.rows,
      status_stats: statusStats.rows,
      total_clients: result.rows.length,
    });
  } catch (err) {
    console.error('Ошибка дашборда клиентов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
