const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/search?q=запрос — глобальный поиск по всем разделам
router.get('/', auth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json({ data: [] });

  const searchTerm = `%${q.trim()}%`;
  const results = [];

  try {
    // 1. Клиенты
    const clients = await db.query(
      `SELECT id, name, phone, email, 'client' AS type
       FROM clients
       WHERE name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1 OR inn ILIKE $1
       LIMIT 5`, [searchTerm]
    );
    clients.rows.forEach(r => results.push({
      type: 'client',
      icon: '👤',
      title: r.name,
      subtitle: [r.phone, r.email].filter(Boolean).join(' • '),
      url: `client-profile/${r.id}`,
    }));

    // 2. Заказы
    const orders = await db.query(
      `SELECT o.id, o.order_number, o.status, c.name AS client_name
       FROM orders o
       LEFT JOIN clients c ON o.client_id = c.id
       WHERE o.order_number ILIKE $1 OR o.comment ILIKE $1 OR c.name ILIKE $1
       LIMIT 5`, [searchTerm]
    );
    const statusLabels = { new: 'Новый', in_progress: 'В работе', paid: 'Оплачен', completed: 'Выполнен', cancelled: 'Отменён' };
    orders.rows.forEach(r => results.push({
      type: 'order',
      icon: '📋',
      title: `Заказ ${r.order_number}`,
      subtitle: `${r.client_name || '—'} • ${statusLabels[r.status] || r.status}`,
      url: 'orders',
      id: r.id,
    }));

    // 3. Компоненты
    const components = await db.query(
      `SELECT c.id, c.article, c.name, c.price, cc.name AS category_name
       FROM components c
       LEFT JOIN component_categories cc ON c.category_id = cc.id
       WHERE c.name ILIKE $1 OR c.article ILIKE $1 OR c.description ILIKE $1
       LIMIT 5`, [searchTerm]
    );
    components.rows.forEach(r => results.push({
      type: 'component',
      icon: '🔩',
      title: `${r.article} — ${r.name}`,
      subtitle: `${r.category_name || '—'} • ${parseFloat(r.price).toLocaleString('ru-RU')} ₽`,
      url: 'components',
      id: r.id,
    }));

    // 4. Чертежи
    const drawings = await db.query(
      `SELECT d.id, d.name, c.name AS client_name
       FROM drawings d
       LEFT JOIN clients c ON d.client_id = c.id
       WHERE d.name ILIKE $1 OR d.description ILIKE $1 OR c.name ILIKE $1
       LIMIT 5`, [searchTerm]
    );
    drawings.rows.forEach(r => results.push({
      type: 'drawing',
      icon: '📐',
      title: r.name,
      subtitle: r.client_name || 'Без клиента',
      url: `calculator/${r.id}`,
    }));

    // 5. КП
    const proposals = await db.query(
      `SELECT p.id, p.proposal_number, p.status, c.name AS client_name
       FROM proposals p
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.proposal_number ILIKE $1 OR c.name ILIKE $1
       LIMIT 5`, [searchTerm]
    );
    const propStatuses = { draft: 'Черновик', sent: 'Отправлено', accepted: 'Принято', rejected: 'Отклонено' };
    proposals.rows.forEach(r => results.push({
      type: 'proposal',
      icon: '📑',
      title: `КП ${r.proposal_number}`,
      subtitle: `${r.client_name || '—'} • ${propStatuses[r.status] || r.status}`,
      url: 'proposals',
      id: r.id,
    }));

    // 6. Производители
    const manufacturers = await db.query(
      `SELECT id, name, country
       FROM manufacturers
       WHERE name ILIKE $1 OR country ILIKE $1
       LIMIT 5`, [searchTerm]
    );
    manufacturers.rows.forEach(r => results.push({
      type: 'manufacturer',
      icon: '🏭',
      title: r.name,
      subtitle: r.country || '',
      url: 'equipment',
    }));

    res.json({ data: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
