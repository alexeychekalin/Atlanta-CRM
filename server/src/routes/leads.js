/**
 * Раздел «Заявки» в CRM: список, карточка, превращение в клиента.
 *
 * Заявка — не клиент. Пока менеджер не взял её в работу, это лид с сайта:
 * половина заявок — «а есть ли в наличии», половина — спам. Отдельная
 * таблица leads держит базу контрагентов чистой, а мусор удаляется вместе
 * с историей, не оставляя следа в справочнике клиентов.
 *
 * Цен в заявке нет: на сайте их не публикуем, смета считается в калькуляторе
 * после разговора с клиентом.
 */
const express = require('express');
const fs = require('fs');
const db = require('../db');
const auth = require('../middleware/auth');
const { requirePermission } = require('../middleware/access');
const { safeUploadPath } = require('../utils/files');
const { line, notifyAboutLead, notificationsFor } = require('./leads-shared');

const router = express.Router();

const STATUSES = ['new', 'in_progress', 'converted', 'rejected'];
const STATUS_LABELS = {
  new: 'Новая',
  in_progress: 'В работе',
  converted: 'Стала клиентом',
  rejected: 'Отказ',
};

// GET /api/leads — список заявок с фильтрами и счётчиками по статусам
router.get('/', auth, requirePermission('leads', 'view'), async (req, res) => {
  try {
    const { status, search } = req.query;
    const conditions = [];
    const params = [];

    if (status && STATUSES.includes(status)) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      conditions.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length}
        OR COALESCE(email, '') ILIKE $${params.length}
        OR COALESCE(company, '') ILIKE $${params.length}
        OR COALESCE(message, '') ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT l.*, c.name AS client_name
         FROM leads l
         LEFT JOIN clients c ON c.id = l.client_id
         ${where.replace(/\b(status|name|phone|email|company|message)\b/g, 'l.$1')}
        ORDER BY l.created_at DESC, l.id DESC LIMIT 300`,
      params
    );
    const counts = await db.query(
      'SELECT status, count(*)::int AS n FROM leads GROUP BY status'
    );
    res.json({
      data: result.rows,
      counts: Object.fromEntries(counts.rows.map(row => [row.status, row.n])),
      statuses: STATUS_LABELS,
    });
  } catch (err) {
    console.error('Ошибка списка заявок:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/leads/:id — карточка: позиции, файлы, журнал уведомлений
router.get('/:id', auth, requirePermission('leads', 'view'), async (req, res) => {
  try {
    const lead = await db.query(
      `SELECT l.*, c.name AS client_name FROM leads l
         LEFT JOIN clients c ON c.id = l.client_id
        WHERE l.id = $1`,
      [req.params.id]
    );
    if (lead.rows.length === 0) return res.status(404).json({ error: 'Заявка не найдена' });

    const [items, files, notifications] = await Promise.all([
      db.query('SELECT * FROM lead_items WHERE lead_id = $1 ORDER BY sort_order, id', [req.params.id]),
      db.query('SELECT * FROM lead_files WHERE lead_id = $1 ORDER BY id', [req.params.id]),
      notificationsFor(req.params.id),
    ]);
    res.json({
      ...lead.rows[0],
      items: items.rows,
      files: files.rows,
      notifications,
      statuses: STATUS_LABELS,
    });
  } catch (err) {
    console.error('Ошибка карточки заявки:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/leads/:id — сменить статус, дописать заметку менеджера
router.put('/:id', auth, requirePermission('leads', 'edit'), async (req, res) => {
  try {
    const { status, manager_note } = req.body || {};
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Неизвестный статус заявки' });
    }
    const result = await db.query(
      `UPDATE leads SET
         status = COALESCE($2, status),
         manager_note = CASE WHEN $3::text IS NULL THEN manager_note ELSE $3 END,
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, status || null, manager_note === undefined ? null : line(manager_note, 2000)]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Заявка не найдена' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка обновления заявки:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/leads/:id/convert — превратить заявку в клиента
router.post('/:id/convert', auth, requirePermission('clients', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const leadRow = await client.query('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (leadRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    const lead = leadRow.rows[0];
    if (lead.client_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Заявка уже превращена в клиента', client_id: lead.client_id });
    }

    // Постоянный клиент мог написать с сайта под тем же телефоном или ИНН:
    // заявка должна прилипнуть к его карточке, а не создать дубль
    const existing = await client.query(
      `SELECT id FROM clients
        WHERE ($1 <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g'))
           OR ($2 <> '' AND COALESCE(inn, '') = $2)
        LIMIT 1`,
      [lead.phone || '', lead.inn || '']
    );

    let clientId;
    let created = false;
    if (existing.rows.length > 0) {
      clientId = existing.rows[0].id;
    } else {
      const statusRow = await client.query(
        "SELECT id FROM client_work_statuses WHERE name = 'Новый' LIMIT 1"
      );
      const inserted = await client.query(
        `INSERT INTO clients (name, phone, email, inn, address, notes, client_type, status_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'ooo', $7) RETURNING id`,
        [
          lead.company || lead.name,
          lead.phone,
          lead.email,
          lead.inn || null,
          lead.address || null,
          `Заявка с сайта №${lead.id}`,
          statusRow.rows[0] ? statusRow.rows[0].id : null,
        ]
      );
      clientId = inserted.rows[0].id;
      created = true;
    }

    // Событие в карточке клиента: менеджер увидит, откуда пришёл контакт
    await client.query(
      `INSERT INTO client_timeline (client_id, event_type, title, description)
       VALUES ($1, 'lead', $2, $3)`,
      [clientId, `Заявка с сайта №${lead.id}`, lead.message || 'Заявка из формы на сайте']
    );

    await client.query(
      "UPDATE leads SET status = 'converted', client_id = $2, updated_at = NOW() WHERE id = $1",
      [lead.id, clientId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, client_id: clientId, created });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Ошибка превращения заявки в клиента:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  } finally {
    client.release();
  }
});

// POST /api/leads/:id/notify — повторить уведомление (чинили бота, меняли чат)
router.post('/:id/notify', auth, requirePermission('leads', 'edit'), async (req, res) => {
  try {
    const leadRow = await db.query('SELECT * FROM leads WHERE id = $1', [req.params.id]);
    if (leadRow.rows.length === 0) return res.status(404).json({ error: 'Заявка не найдена' });

    const [items, files] = await Promise.all([
      db.query('SELECT * FROM lead_items WHERE lead_id = $1 ORDER BY sort_order, id', [req.params.id]),
      db.query('SELECT * FROM lead_files WHERE lead_id = $1 ORDER BY id', [req.params.id]),
    ]);
    const outcome = await notifyAboutLead(leadRow.rows[0], items.rows, files.rows);
    res.json(outcome);
  } catch (err) {
    console.error('Ошибка повторного уведомления:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/leads/:id — удалить заявку (спам, дубль) вместе с файлами
router.delete('/:id', auth, requirePermission('leads', 'delete'), async (req, res) => {
  try {
    const files = await db.query('SELECT file_path FROM lead_files WHERE lead_id = $1', [req.params.id]);
    const result = await db.query('DELETE FROM leads WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Заявка не найдена' });

    for (const row of files.rows) {
      const target = safeUploadPath(row.file_path);
      if (target && fs.existsSync(target)) {
        try { fs.unlinkSync(target); } catch { /* файл могли убрать вручную */ }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка удаления заявки:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
module.exports.STATUSES = STATUSES;
module.exports.STATUS_LABELS = STATUS_LABELS;
