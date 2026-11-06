const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { sectionAllowed } = require('../middleware/access');

const router = express.Router();

// «Без разделителей»: «а3776001» и «0201» должны находить «А.3776.001» и «02.01».
// Запрос с буквами — с двух символов, чисто числовой — с четырёх:
// иначе «15» совпадёт почти с любым артикулом.
function bareTerm(value) {
  const bare = String(value || '').toLowerCase().replace(/[\s.\-_/]+/g, '');
  if (bare.length < 2) return null;
  if (bare.length < 4 && !/[^\d]/.test(bare)) return null;
  return `%${bare}%`;
}

// GET /api/search?q=запрос — глобальный поиск по всем разделам
router.get('/', auth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json({ data: [] });

  const searchTerm = `%${q.trim()}%`;
  const bareSearch = bareTerm(q.trim());
  const results = [];
  const canView = (section) => sectionAllowed(req.user, section, 'view');

  try {
    // 1. Клиенты
    const clients = canView('clients') ? await db.query(
      `SELECT id, name, phone, email, 'client' AS type
       FROM clients
       WHERE name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1 OR inn ILIKE $1
       LIMIT 5`, [searchTerm]) : { rows: [] };
    clients.rows.forEach(r => results.push({
      type: 'client',
      icon: '👤',
      title: r.name,
      subtitle: [r.phone, r.email].filter(Boolean).join(' • '),
      url: `client-profile/${r.id}`,
    }));

    // 2. Заказы
    const orders = canView('orders') ? await db.query(
      `SELECT o.id, o.order_number, o.status, c.name AS client_name
       FROM orders o
       LEFT JOIN clients c ON o.client_id = c.id
       WHERE o.order_number ILIKE $1 OR o.comment ILIKE $1 OR c.name ILIKE $1
       LIMIT 5`, [searchTerm]) : { rows: [] };
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
    // ищем и по исполнениям: по коду, названию и полному артикулу «А.3776.001-02.02»
    const components = canView('components') ? await db.query(
      `SELECT c.id, c.article, c.name, c.price, cc.name AS category_name,
         (SELECT string_agg(hits.code, ', ') FROM (
            SELECT cm.code FROM component_modifications cm
            WHERE cm.component_id = c.id
              AND (cm.code ILIKE $1 OR cm.name ILIKE $1
                   OR COALESCE(cm.full_article, c.article || '-' || cm.code) ILIKE $1
                   OR ($2::text IS NOT NULL
                       AND translate(lower(COALESCE(cm.full_article, c.article || '-' || cm.code)), ' .-/_', '') LIKE $2))
            ORDER BY cm.sort_order, cm.code LIMIT 3
          ) hits) AS mod_hits
       FROM components c
       LEFT JOIN component_categories cc ON c.category_id = cc.id
       WHERE c.name ILIKE $1 OR c.article ILIKE $1 OR c.description ILIKE $1
         OR ($2::text IS NOT NULL AND translate(lower(c.article), ' .-/_', '') LIKE $2)
         OR EXISTS (
           SELECT 1 FROM component_modifications cm
           WHERE cm.component_id = c.id
             AND (cm.code ILIKE $1 OR cm.name ILIKE $1
                  OR COALESCE(cm.full_article, c.article || '-' || cm.code) ILIKE $1
                  OR ($2::text IS NOT NULL
                      AND translate(lower(COALESCE(cm.full_article, c.article || '-' || cm.code)), ' .-/_', '') LIKE $2))
         )
       ORDER BY CASE WHEN c.name ILIKE $1 OR c.article ILIKE $1 THEN 0 ELSE 1 END,
                cc.sort_order, c.name
       LIMIT 5`, [searchTerm, bareSearch]) : { rows: [] };
    components.rows.forEach(r => results.push({
      type: 'component',
      icon: '🔩',
      title: `${r.article} — ${r.name}`,
      subtitle: [
        r.category_name || '—',
        `${parseFloat(r.price).toLocaleString('ru-RU')} ₽`,
        r.mod_hits ? `мод. ${r.mod_hits}` : '',
      ].filter(Boolean).join(' • '),
      url: 'components',
      id: r.id,
    }));

    // 4. Чертежи
    const drawings = canView('drawings') ? await db.query(
      `SELECT d.id, d.name, c.name AS client_name
       FROM drawings d
       LEFT JOIN clients c ON d.client_id = c.id
       WHERE d.name ILIKE $1 OR d.description ILIKE $1 OR c.name ILIKE $1
       LIMIT 5`, [searchTerm]) : { rows: [] };
    drawings.rows.forEach(r => results.push({
      type: 'drawing',
      icon: '📐',
      title: r.name,
      subtitle: r.client_name || 'Без клиента',
      url: `calculator/${r.id}`,
    }));

    // 5. КП
    const proposals = canView('proposals') ? await db.query(
      `SELECT p.id, p.proposal_number, p.status, c.name AS client_name
       FROM proposals p
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.proposal_number ILIKE $1 OR c.name ILIKE $1
       LIMIT 5`, [searchTerm]) : { rows: [] };
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
    const manufacturers = canView('equipment') ? await db.query(
      `SELECT id, name, country
       FROM manufacturers
       WHERE name ILIKE $1 OR country ILIKE $1
       LIMIT 5`, [searchTerm]) : { rows: [] };
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
