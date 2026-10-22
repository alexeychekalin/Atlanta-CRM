const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { normalizeUploadPath, fileSha256 } = require('../utils/files');
const { round2, priceForClient, resolveFixedPrice, bomSubtotalFromRows, parseFixedPriceInput } = require('../services/drawings');

const router = express.Router();

// --- SQL-фрагменты ---------------------------------------------------------
// Суммы по составу — из общего модуля, цена считается в services/drawings.js.
const { BOM_SUBTOTAL_SQL, RAW_BASE_SQL } = require('../services/drawings-sql');

function normalizeId(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function clientExists(runner, clientId) {
  const res = await runner.query('SELECT 1 FROM clients WHERE id = $1', [clientId]);
  return res.rows.length > 0;
}

/**
 * Связь «чертёж ↔ клиент».
 * `setFixedPrice` отличает «оставить как есть» (undefined) от «очистить» (null).
 */
async function ensureClientLink(runner, drawingId, clientId, options = {}) {
  if (!clientId) return;
  const { markupPct, markupRub, fixedPrice, setFixedPrice } = options;
  await runner.query(
    `INSERT INTO drawing_clients (drawing_id, client_id, markup_pct, markup_rub, fixed_price)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (drawing_id, client_id) DO UPDATE
       SET markup_pct = COALESCE(EXCLUDED.markup_pct, drawing_clients.markup_pct),
           markup_rub = CASE WHEN $6 THEN COALESCE(EXCLUDED.markup_rub, 0) ELSE drawing_clients.markup_rub END,
           fixed_price = CASE WHEN $7 THEN EXCLUDED.fixed_price ELSE drawing_clients.fixed_price END`,
    [drawingId, clientId,
      nullableNumber(markupPct),
      parseFloat(markupRub) || 0,
      parseFixedPriceInput(fixedPrice).value,
      markupRub !== undefined,
      Boolean(setFixedPrice)]
  );
}

/** Строки привязок для набора чертежей: цена каждого клиента считается в JS. */
async function loadLinksByDrawing(drawingIds) {
  if (!drawingIds.length) return {};
  const res = await db.query(`
    SELECT dcl.drawing_id, dcl.client_id, dcl.markup_pct, dcl.markup_rub, dcl.fixed_price,
           c.name AS client_name, cpl.markup_pct AS level_markup_pct, cpl.name AS pricing_level_name
    FROM drawing_clients dcl
    JOIN clients c ON c.id = dcl.client_id
    LEFT JOIN client_pricing_levels cpl ON cpl.id = c.pricing_level_id
    WHERE dcl.drawing_id = ANY($1::int[])
    ORDER BY c.name`, [drawingIds]);

  const byDrawing = {};
  res.rows.forEach(link => {
    (byDrawing[link.drawing_id] = byDrawing[link.drawing_id] || []).push(link);
  });
  return byDrawing;
}

/** Прикрепляет к строкам цену для каждого клиента и итог для выбранного/владельца. */
function attachClientPrices(rows, linksByDrawing, preferredClientId) {
  rows.forEach(row => {
    const subtotal = round2(row.bom_subtotal);
    const links = linksByDrawing[row.id] || [];
    row.base_cost = round2(row.raw_base);
    row.client_prices = links.map(link => ({
      client_id: link.client_id,
      fixed_price: resolveFixedPrice({
        linkFixedPrice: link.fixed_price,
        drawingFixedPrice: row.fixed_price,
      }),
      price: priceForClient({ drawing: row, link, subtotal }),
    }));

    const preferred = preferredClientId
      ? row.client_prices.find(p => p.client_id === preferredClientId)
      : row.client_prices.find(p => p.client_id === row.client_id) || row.client_prices[0];

    const price = preferred ? preferred.price : priceForClient({ drawing: row, subtotal });
    row.total_cost = price.total;
    row.client_fixed_price = preferred ? preferred.fixed_price : price.fixedPrice;
  });
  return rows;
}

// =================== Списки и поиск ===================

// GET /api/drawings — каталог чертежей
// ?client_id= — чертежи клиента (владелец или привязанные), цены по его уровню
// ?archived=1|all — архив
// ?not_calculated=1 — только те, по которым не было расчёта для клиента
router.get('/', auth, async (req, res) => {
  try {
    const { client_id, search, archived, not_calculated } = req.query;
    const conditions = [];
    const params = [];
    let joins = '';
    let clientParam = null;

    const clientId = normalizeId(client_id);
    if (clientId) {
      params.push(clientId);
      clientParam = `$${params.length}`;
      joins = `LEFT JOIN drawing_clients dl_f ON dl_f.drawing_id = d.id AND dl_f.client_id = ${clientParam}
               LEFT JOIN clients fcl ON fcl.id = ${clientParam}
               LEFT JOIN client_pricing_levels fcpl ON fcpl.id = fcl.pricing_level_id`;
      conditions.push(`(d.client_id = ${clientParam} OR dl_f.id IS NOT NULL)`);

      if (not_calculated === '1' || not_calculated === 'true') {
        conditions.push(`NOT EXISTS (
          SELECT 1 FROM drawing_calculations calc
          WHERE calc.drawing_id = d.id AND calc.client_id = ${clientParam})`);
      }
    }

    if (archived === '1' || archived === 'true') {
      conditions.push('d.archived_at IS NOT NULL');
    } else if (archived !== 'all') {
      conditions.push('d.archived_at IS NULL');
    }

    if (search) {
      params.push(`%${search}%`);
      const p = `$${params.length}`;
      conditions.push(`(d.name ILIKE ${p} OR d.description ILIKE ${p} OR c.name ILIKE ${p}
        OR EXISTS (SELECT 1 FROM drawing_clients dcs JOIN clients cs ON cs.id = dcs.client_id
                   WHERE dcs.drawing_id = d.id AND cs.name ILIKE ${p}))`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const clientSelects = clientParam
      ? `EXISTS (SELECT 1 FROM drawing_calculations calc
                 WHERE calc.drawing_id = d.id AND calc.client_id = ${clientParam}) AS is_calculated,
         (SELECT MAX(calc.created_at) FROM drawing_calculations calc
          WHERE calc.drawing_id = d.id AND calc.client_id = ${clientParam}) AS last_calculated_at,`
      : 'false AS is_calculated, NULL AS last_calculated_at,';

    const result = await db.query(`
      SELECT d.*,
        u.full_name AS author_name,
        c.name AS client_name,
        c.phone AS client_phone,
        COUNT(dc.id) AS components_count,
        (SELECT array_agg(dcl.client_id) FROM drawing_clients dcl
          WHERE dcl.drawing_id = d.id) AS client_ids,
        (SELECT string_agg(c2.name, ', ' ORDER BY c2.name)
           FROM drawing_clients dcl2 JOIN clients c2 ON c2.id = dcl2.client_id
          WHERE dcl2.drawing_id = d.id) AS client_names,
        ${clientSelects}
        ${RAW_BASE_SQL} AS raw_base,
        ${BOM_SUBTOTAL_SQL} AS bom_subtotal
      FROM drawings d
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN clients c ON d.client_id = c.id
      LEFT JOIN drawing_components dc ON d.id = dc.drawing_id
      LEFT JOIN components comp ON dc.component_id = comp.id
      LEFT JOIN component_modifications cm ON cm.id = dc.modification_id
      ${joins}
      ${where}
      GROUP BY d.id, u.full_name, c.name, c.phone
      ORDER BY d.archived_at NULLS FIRST, d.created_at DESC
    `, params);

    // Цена для каждого привязанного клиента: у одного BOM цены разные
    const linksByDrawing = await loadLinksByDrawing(result.rows.map(row => row.id));
    attachClientPrices(result.rows, linksByDrawing, clientId);

    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка списка чертежей:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/drawings/check-duplicate?name=...&file_hash=...
// ВАЖНО: объявлен до '/:id', иначе Express примет "check-duplicate" за id.
router.get('/check-duplicate', auth, async (req, res) => {
  try {
    const { name, file_hash, file_path } = req.query;
    const conditions = [];
    const params = [];

    if (name) {
      params.push(`%${name}%`);
      conditions.push(`(d.name ILIKE $${params.length} OR d.description ILIKE $${params.length})`);
    }
    if (file_path) {
      params.push(file_path);
      conditions.push(`d.file_path = $${params.length}`);
    }
    if (file_hash) {
      params.push(file_hash);
      conditions.push(`d.file_hash = $${params.length}`);
    }
    if (conditions.length === 0) return res.json({ data: [] });

    const result = await db.query(
      `SELECT d.id, d.name, d.file_path, d.file_type, d.client_id, d.archived_at,
              c.name AS client_name,
              (SELECT string_agg(c2.name, ', ' ORDER BY c2.name)
                 FROM drawing_clients dcl JOIN clients c2 ON c2.id = dcl.client_id
                WHERE dcl.drawing_id = d.id) AS client_names,
              COUNT(dc.id) AS components_count
       FROM drawings d
       LEFT JOIN clients c ON d.client_id = c.id
       LEFT JOIN drawing_components dc ON d.id = dc.drawing_id
       WHERE (${conditions.join(' OR ')})
       GROUP BY d.id, c.name
       ORDER BY d.archived_at NULLS FIRST, d.created_at DESC
       LIMIT 10`,
      params
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =================== Журнал расчётов ===================

// GET /api/drawings/calculations — журнал расчётов
router.get('/calculations', auth, async (req, res) => {
  try {
    const { client_id, drawing_id, date_from, date_to } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const conditions = [];
    const params = [];

    if (normalizeId(client_id)) {
      params.push(Number(client_id));
      conditions.push(`calc.client_id = $${params.length}`);
    }
    if (normalizeId(drawing_id)) {
      params.push(Number(drawing_id));
      conditions.push(`calc.drawing_id = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conditions.push(`calc.created_at >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`calc.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);
    const result = await db.query(
      `SELECT calc.*,
              c.name AS client_name,
              p.name AS principal_name,
              u.full_name AS author_name,
              d.archived_at AS drawing_archived_at
         FROM drawing_calculations calc
         LEFT JOIN clients c ON c.id = calc.client_id
         LEFT JOIN principals p ON p.id = calc.principal_id
         LEFT JOIN users u ON u.id = calc.created_by
         LEFT JOIN drawings d ON d.id = calc.drawing_id
         ${where}
         ORDER BY calc.created_at DESC, calc.id DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, params.length - 2);
    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM drawing_calculations calc ${where}`,
      countParams
    );

    res.json({ data: result.rows, total: countRes.rows[0].total });
  } catch (err) {
    console.error('Ошибка журнала расчётов:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/drawings/calculations — записать расчёт в журнал.
// Суммы считает сервер по BOM и уровню цен клиента, а не клиент.
router.post('/calculations', auth, async (req, res) => {
  try {
    const { drawing_id, client_id, principal_id, global_markup_pct, global_markup_rub, fixed_price } = req.body;
    const drawingId = normalizeId(drawing_id);
    const clientId = normalizeId(client_id);
    if (!drawingId) return res.status(400).json({ error: 'Укажите чертёж' });

    const drawingRes = await db.query('SELECT * FROM drawings WHERE id = $1', [drawingId]);
    if (drawingRes.rows.length === 0) return res.status(404).json({ error: 'Чертёж не найден' });
    const drawing = drawingRes.rows[0];

    const bomRes = await db.query(`
      SELECT dc.*, c.price, c.name AS component_name, c.article,
             cm.code AS modification_code, cm.price_override AS modification_price
        FROM drawing_components dc
        JOIN components c ON dc.component_id = c.id
        LEFT JOIN component_modifications cm ON cm.id = dc.modification_id
       WHERE dc.drawing_id = $1
       ORDER BY dc.id`, [drawingId]);

    const lines = bomRes.rows.map(item => {
      const price = item.modification_price !== null && item.modification_price !== undefined
        ? parseFloat(item.modification_price) : parseFloat(item.price);
      const quantity = parseFloat(item.quantity);
      const base = round2(price * quantity);
      const markupPctAmount = round2(base * (parseFloat(item.item_markup_pct) || 0) / 100);
      const markupRub = round2(item.item_markup_rub);
      return {
        component_id: item.component_id,
        article: item.modification_code ? `${item.article}.${item.modification_code}` : item.article,
        name: item.component_name,
        price: round2(price),
        quantity,
        markup_pct: parseFloat(item.item_markup_pct) || 0,
        markup_rub: markupRub,
        line_total: round2(base + markupPctAmount + markupRub),
      };
    });

    // Сумму считаем до округления строк — так она совпадает с ценой в списке и карточке
    const subtotal = bomSubtotalFromRows(bomRes.rows);

    const requestFixed = parseFixedPriceInput(fixed_price);
    if (requestFixed.error) return res.status(400).json({ error: requestFixed.error });

    let link = null;
    if (clientId) {
      const linkRes = await db.query(
        `SELECT dcl.markup_pct, dcl.fixed_price, cpl.markup_pct AS level_markup_pct
           FROM clients c
           LEFT JOIN drawing_clients dcl ON dcl.client_id = c.id AND dcl.drawing_id = $1
           LEFT JOIN client_pricing_levels cpl ON cpl.id = c.pricing_level_id
          WHERE c.id = $2`, [drawingId, clientId]);
      if (linkRes.rows.length === 0) return res.status(404).json({ error: 'Клиент не найден' });
      link = linkRes.rows[0];
    }

    // Снимок общих наценок: из запроса, иначе — из чертежа
    const drawingForPrice = {
      ...drawing,
      global_markup_pct: global_markup_pct !== undefined ? round2(global_markup_pct) : drawing.global_markup_pct,
      global_markup_rub: global_markup_rub !== undefined ? round2(global_markup_rub) : drawing.global_markup_rub,
    };

    // Приоритет: явно переданная цена → фикс-цена клиента → общая фикс-цена чертежа
    const price = priceForClient({
      drawing: drawingForPrice,
      link,
      subtotal,
      fixedPrice: requestFixed.value !== null ? requestFixed.value : undefined,
    });

    const result = await db.query(
      `INSERT INTO drawing_calculations
         (drawing_id, client_id, principal_id, drawing_name, subtotal, level_markup_pct,
          global_markup_pct, global_markup_rub, fixed_price, total, lines, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [drawingId, clientId || null, normalizeId(principal_id) || null, drawing.name,
        price.subtotal, price.levelMarkupPct, price.globalMarkupPct || 0, price.globalMarkupRub || 0,
        price.fixedPrice, price.total, JSON.stringify(lines), req.user.id]
    );

    res.status(201).json({ ...result.rows[0], price });
  } catch (err) {
    console.error('Ошибка записи расчёта:', err);
    res.status(500).json({ error: err.message });
  }
});

// =================== Карточка чертежа ===================

// GET /api/drawings/:id — детали чертежа с BOM и привязанными клиентами
router.get('/:id', auth, async (req, res) => {
  const id = normalizeId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Чертёж не найден' });
  try {
    const drawingRes = await db.query(
      `SELECT d.*, u.full_name AS author_name, c.name AS client_name, c.phone AS client_phone,
              c.email AS client_email, da.title AS approval_title, da.status AS approval_status
       FROM drawings d
       LEFT JOIN users u ON d.created_by = u.id
       LEFT JOIN clients c ON d.client_id = c.id
       LEFT JOIN drawing_approvals da ON da.id = d.approval_id
       WHERE d.id = $1`,
      [id]
    );
    if (drawingRes.rows.length === 0) return res.status(404).json({ error: 'Чертёж не найден' });

    const drawing = drawingRes.rows[0];

    const [bomRes, clientsRes] = await Promise.all([
      db.query(`
        SELECT dc.*, c.article, c.name AS component_name, c.price, c.image_path,
               cc.name AS category_name,
               cm.code AS modification_code, cm.name AS modification_name,
               cm.price_override AS modification_price
        FROM drawing_components dc
        JOIN components c ON dc.component_id = c.id
        LEFT JOIN component_categories cc ON c.category_id = cc.id
        LEFT JOIN component_modifications cm ON dc.modification_id = cm.id
        WHERE dc.drawing_id = $1
        ORDER BY cc.sort_order NULLS LAST, c.name`, [id]),
      db.query(`
        SELECT dcl.id, dcl.client_id, dcl.markup_pct, dcl.markup_rub, dcl.fixed_price,
               c.name AS client_name,
               c.phone AS client_phone, cpl.name AS pricing_level_name, cpl.markup_pct AS level_markup_pct
        FROM drawing_clients dcl
        JOIN clients c ON c.id = dcl.client_id
        LEFT JOIN client_pricing_levels cpl ON cpl.id = c.pricing_level_id
        WHERE dcl.drawing_id = $1
        ORDER BY c.name`, [id]),
    ]);

    drawing.components = bomRes.rows;

    // Цена для каждого привязанного клиента: своя фикс-цена / уровень цен / наценка связи
    const subtotal = bomSubtotalFromRows(bomRes.rows);
    drawing.clients = clientsRes.rows.map(linkRow => ({
      ...linkRow,
      price: priceForClient({ drawing, link: linkRow, subtotal }),
    }));

    // Цена «по умолчанию» — для владельца чертежа (у него всегда есть связь)
    const ownerLink = drawing.clients.find(link => link.client_id === drawing.client_id);
    drawing.price = ownerLink ? ownerLink.price : priceForClient({ drawing, subtotal });

    res.json(drawing);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/drawings/:id/price?client_id= — цена чертежа для клиента
router.get('/:id/price', auth, async (req, res) => {
  const id = normalizeId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Чертёж не найден' });
  try {
    const drawingRes = await db.query('SELECT * FROM drawings WHERE id = $1', [id]);
    if (drawingRes.rows.length === 0) return res.status(404).json({ error: 'Чертёж не найден' });
    const drawing = drawingRes.rows[0];

    const bomRes = await db.query(`
      SELECT COALESCE(cm.price_override, c.price) AS price, dc.quantity,
             dc.item_markup_pct, dc.item_markup_rub
        FROM drawing_components dc
        JOIN components c ON c.id = dc.component_id
        LEFT JOIN component_modifications cm ON cm.id = dc.modification_id
       WHERE dc.drawing_id = $1`, [id]);

    const subtotal = bomSubtotalFromRows(bomRes.rows);
    const clientId = normalizeId(req.query.client_id);

    let link = null;
    if (clientId) {
      const linkRes = await db.query(
        `SELECT dcl.markup_pct, dcl.fixed_price, cpl.markup_pct AS level_markup_pct
           FROM clients c
           LEFT JOIN drawing_clients dcl ON dcl.client_id = c.id AND dcl.drawing_id = $1
           LEFT JOIN client_pricing_levels cpl ON cpl.id = c.pricing_level_id
          WHERE c.id = $2`, [id, clientId]);
      if (linkRes.rows.length === 0) return res.status(404).json({ error: 'Клиент не найден' });
      link = linkRes.rows[0];
    }

    const price = priceForClient({ drawing, link, subtotal });
    res.json({ drawing_id: id, client_id: clientId, ...price });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =================== CRUD ===================

// POST /api/drawings — создать чертёж
router.post('/', auth, async (req, res) => {
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');

    const { name, file_path, file_type, description, components, client_id, client_ids, fixed_price,
      level_markup_pct, global_markup_pct, global_markup_rub, force } = req.body;
    if (!name) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Укажите название чертежа' });
    }

    let normalizedFilePath = null;
    if (file_path) {
      normalizedFilePath = normalizeUploadPath(file_path);
      if (!normalizedFilePath) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Недопустимый путь к файлу чертежа' });
      }
    }

    const hash = fileSha256(normalizedFilePath);
    if (hash && !force) {
      const dup = await client.query(
        `SELECT d.id, d.name, d.client_id, d.archived_at,
                (SELECT string_agg(c.name, ', ' ORDER BY c.name)
                   FROM drawing_clients dcl JOIN clients c ON c.id = dcl.client_id
                  WHERE dcl.drawing_id = d.id) AS client_names
           FROM drawings d
          WHERE d.file_hash = $1 AND d.archived_at IS NULL
          LIMIT 1`, [hash]);
      if (dup.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Такой файл уже загружен — привяжите существующий чертёж к клиенту',
          duplicate: dup.rows[0],
        });
      }
    }

    const ownerId = normalizeId(client_id);
    // Чертёж всегда принадлежит клиенту: общий BOM без владельца не создаём
    if (!ownerId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Выберите клиента — чертёж без клиента сохранить нельзя' });
    }
    if (!await clientExists(client, ownerId)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Клиент не найден' });
    }

    const fixed = parseFixedPriceInput(fixed_price);
    if (fixed.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: fixed.error });
    }

    const drawingRes = await client.query(
      `INSERT INTO drawings (name, file_path, file_type, description, created_by, client_id,
         level_markup_pct, global_markup_pct, global_markup_rub, file_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [String(name).slice(0, 255), normalizedFilePath, file_type || null, description || null, req.user.id,
        ownerId,
        parseFloat(level_markup_pct) || 0, parseFloat(global_markup_pct) || 0, parseFloat(global_markup_rub) || 0,
        hash]
    );
    const drawing = drawingRes.rows[0];

    // Фикс-цена принадлежит клиенту и живёт на связи, а не на общем BOM
    await ensureClientLink(client, drawing.id, ownerId, {
      fixedPrice: fixed.value,
      setFixedPrice: fixed.provided,
    });
    if (Array.isArray(client_ids)) {
      for (const cid of client_ids) {
        const linkClientId = normalizeId(cid);
        if (!linkClientId) continue;
        if (!await clientExists(client, linkClientId)) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `Клиент #${linkClientId} не найден` });
        }
        await ensureClientLink(client, drawing.id, linkClientId);
      }
    }

    if (components && components.length > 0) {
      for (const comp of components) {
        await client.query(
          `INSERT INTO drawing_components (drawing_id, component_id, quantity, item_markup_pct, item_markup_rub, modification_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [drawing.id, comp.component_id, comp.quantity || 1, comp.item_markup_pct || 0,
            comp.item_markup_rub || 0, comp.modification_id || null]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(drawing);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
});

// PUT /api/drawings/:id — обновить чертёж (в т.ч. переиспользовать шаблон)
router.put('/:id', auth, async (req, res) => {
  const id = normalizeId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Чертёж не найден' });
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');

    const { name, file_path, file_type, description, components, client_id, client_ids, fixed_price,
      level_markup_pct, global_markup_pct, global_markup_rub } = req.body;

    let normalizedFilePath = file_path;
    if (file_path !== undefined && file_path !== null) {
      normalizedFilePath = normalizeUploadPath(file_path);
      if (!normalizedFilePath) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Недопустимый путь к файлу чертежа' });
      }
    }

    const existingRes = await client.query('SELECT client_id FROM drawings WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Чертёж не найден' });
    }

    const ownerId = normalizeId(existingRes.rows[0].client_id);
    // Владелец чертежа не меняется при сохранении из калькулятора:
    // новый клиент получает связь, а не перехватывает чертёж.
    const requestedClientId = normalizeId(client_id);
    const priceClientId = requestedClientId || ownerId;

    if (!priceClientId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'У чертежа нет клиента — укажите client_id' });
    }
    if (!await clientExists(client, priceClientId)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Клиент не найден' });
    }

    const fixed = parseFixedPriceInput(fixed_price);
    if (fixed.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: fixed.error });
    }

    const drawingRes = await client.query(
      `UPDATE drawings SET
        name = COALESCE($1, name),
        file_path = COALESCE($2, file_path),
        file_type = COALESCE($3, file_type),
        description = COALESCE($4, description),
        level_markup_pct = COALESCE($5, level_markup_pct),
        global_markup_pct = COALESCE($6, global_markup_pct),
        global_markup_rub = COALESCE($7, global_markup_rub),
        file_hash = COALESCE($8, file_hash)
       WHERE id = $9
       RETURNING *`,
      [name, normalizedFilePath, file_type, description,
        level_markup_pct !== undefined ? (parseFloat(level_markup_pct) || 0) : null,
        global_markup_pct !== undefined ? (parseFloat(global_markup_pct) || 0) : null,
        global_markup_rub !== undefined ? (parseFloat(global_markup_rub) || 0) : null,
        normalizedFilePath ? fileSha256(normalizedFilePath) : null,
        id]
    );

    if (requestedClientId || fixed.provided) {
      await ensureClientLink(client, id, priceClientId, {
        fixedPrice: fixed.value,
        setFixedPrice: fixed.provided,
      });
    }
    if (Array.isArray(client_ids)) {
      for (const cid of client_ids) {
        const linkClientId = normalizeId(cid);
        if (!linkClientId) continue;
        if (!await clientExists(client, linkClientId)) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `Клиент #${linkClientId} не найден` });
        }
        await ensureClientLink(client, id, linkClientId);
      }
    }

    if (components !== undefined) {
      await client.query('DELETE FROM drawing_components WHERE drawing_id = $1', [id]);
      for (const comp of (components || [])) {
        await client.query(
          `INSERT INTO drawing_components (drawing_id, component_id, quantity, item_markup_pct, item_markup_rub, modification_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, comp.component_id, comp.quantity || 1, comp.item_markup_pct || 0,
            comp.item_markup_rub || 0, comp.modification_id || null]
        );
      }
    }

    await client.query('COMMIT');
    res.json(drawingRes.rows[0]);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
});

// DELETE /api/drawings/:id — в архив (чертежи храним всегда)
router.delete('/:id', auth, async (req, res) => {
  const id = normalizeId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Чертёж не найден' });
  try {
    const result = await db.query(
      'UPDATE drawings SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      const exists = await db.query('SELECT archived_at FROM drawings WHERE id = $1', [id]);
      if (exists.rows.length === 0) return res.status(404).json({ error: 'Чертёж не найден' });
      return res.json({ success: true, archived_at: exists.rows[0].archived_at });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/drawings/:id/restore — вернуть из архива
router.post('/:id/restore', auth, async (req, res) => {
  const id = normalizeId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Чертёж не найден' });
  try {
    const result = await db.query(
      'UPDATE drawings SET archived_at = NULL WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Чертёж не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =================== Привязки к клиентам ===================

// POST /api/drawings/:id/clients — привязать клиента к общему BOM
router.post('/:id/clients', auth, async (req, res) => {
  const id = normalizeId(req.params.id);
  const clientId = normalizeId(req.body.client_id);
  if (!id || !clientId) return res.status(400).json({ error: 'Укажите чертёж и клиента' });
  try {
    const fixed = parseFixedPriceInput(req.body.fixed_price);
    if (fixed.error) return res.status(400).json({ error: fixed.error });

    const drawingRes = await db.query('SELECT 1 FROM drawings WHERE id = $1', [id]);
    if (drawingRes.rows.length === 0) return res.status(404).json({ error: 'Чертёж не найден' });
    if (!await clientExists(db, clientId)) return res.status(404).json({ error: 'Клиент не найден' });

    await ensureClientLink(db, id, clientId, {
      markupPct: req.body.markup_pct,
      markupRub: req.body.markup_rub,
      fixedPrice: fixed.value,
      setFixedPrice: fixed.provided,
    });
    const link = await db.query(
      'SELECT * FROM drawing_clients WHERE drawing_id = $1 AND client_id = $2', [id, clientId]);
    res.status(201).json(link.rows[0] || { success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/drawings/:id/clients/:clientId — наценка для конкретного клиента
router.put('/:id/clients/:clientId', auth, async (req, res) => {
  const id = normalizeId(req.params.id);
  const clientId = normalizeId(req.params.clientId);
  if (!id || !clientId) return res.status(400).json({ error: 'Укажите чертёж и клиента' });
  try {
    const has = key => Object.prototype.hasOwnProperty.call(req.body, key);
    const fixed = parseFixedPriceInput(req.body.fixed_price);
    if (fixed.error) return res.status(400).json({ error: fixed.error });

    const result = await db.query(
      `UPDATE drawing_clients
          SET markup_pct = CASE WHEN $1 THEN $2 ELSE markup_pct END,
              markup_rub = CASE WHEN $3 THEN $4 ELSE markup_rub END,
              fixed_price = CASE WHEN $5 THEN $6 ELSE fixed_price END
        WHERE drawing_id = $7 AND client_id = $8 RETURNING *`,
      [has('markup_pct'), nullableNumber(req.body.markup_pct),
        has('markup_rub'), parseFloat(req.body.markup_rub) || 0,
        fixed.provided, fixed.value,
        id, clientId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Связь не найдена' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/drawings/:id/clients/:clientId — отвязать клиента
router.delete('/:id/clients/:clientId', auth, async (req, res) => {
  const id = normalizeId(req.params.id);
  const clientId = normalizeId(req.params.clientId);
  if (!id || !clientId) return res.status(400).json({ error: 'Укажите чертёж и клиента' });
  try {
    const deleted = await db.query(
      'DELETE FROM drawing_clients WHERE drawing_id = $1 AND client_id = $2 RETURNING id', [id, clientId]);
    if (deleted.rows.length === 0) return res.status(404).json({ error: 'Связь не найдена' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/drawings/:id/calculate — быстрый расчёт по BOM (без сохранения)
router.post('/:id/calculate', auth, async (req, res) => {
  const id = normalizeId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Чертёж не найден' });
  try {
    const { total_markup_pct, total_markup_rub } = req.body;

    const bomRes = await db.query(`
      SELECT dc.*, c.price, c.name AS component_name, c.article,
             cm.code AS modification_code, cm.name AS modification_name, cm.price_override AS modification_price
      FROM drawing_components dc
      JOIN components c ON dc.component_id = c.id
      LEFT JOIN component_modifications cm ON dc.modification_id = cm.id
      WHERE dc.drawing_id = $1`, [id]);

    let subtotal = 0;
    const lines = bomRes.rows.map(item => {
      const effectivePrice = item.modification_price !== null && item.modification_price !== undefined
        ? parseFloat(item.modification_price) : parseFloat(item.price);
      const base = effectivePrice * parseFloat(item.quantity);
      const markupPct = base * (parseFloat(item.item_markup_pct) || 0) / 100;
      const markupRub = parseFloat(item.item_markup_rub) || 0;
      const lineTotal = base + markupPct + markupRub;
      subtotal += lineTotal;

      return {
        component_name: item.component_name,
        article: item.modification_code ? `${item.article}.${item.modification_code}` : item.article,
        modification_name: item.modification_name || null,
        price: effectivePrice,
        quantity: parseFloat(item.quantity),
        base,
        item_markup_pct: parseFloat(item.item_markup_pct),
        item_markup_rub: parseFloat(item.item_markup_rub),
        markup_amount: markupPct + markupRub,
        line_total: lineTotal,
      };
    });

    const tMarkupPct = subtotal * (parseFloat(total_markup_pct) || 0) / 100;
    const tMarkupRub = parseFloat(total_markup_rub) || 0;

    res.json({
      lines,
      subtotal,
      total_markup_pct: parseFloat(total_markup_pct) || 0,
      total_markup_rub: tMarkupRub,
      total_markup_amount: tMarkupPct + tMarkupRub,
      total: subtotal + tMarkupPct + tMarkupRub,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
