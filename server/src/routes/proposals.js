const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/role');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// =================== Номер КП ===================
async function generateProposalNumber() {
  const result = await db.query("SELECT proposal_number FROM proposals ORDER BY id DESC LIMIT 1");
  if (result.rows.length === 0) return 'КП-0001';
  const last = result.rows[0].proposal_number;
  const num = parseInt(last.replace(/\D/g, '')) || 0;
  return `КП-${String(num + 1).padStart(4, '0')}`;
}

// =================== GET /api/proposals ===================
router.get('/', auth, async (req, res) => {
  try {
    const { client_id, status, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    let where = [];
    let params = [];
    let idx = 1;

    if (client_id) { where.push(`p.client_id = $${idx++}`); params.push(client_id); }
    if (status) { where.push(`p.status = $${idx++}`); params.push(status); }
    if (search) { where.push(`(p.proposal_number ILIKE $${idx} OR c.name ILIKE $${idx})`); params.push(`%${search}%`); idx++; }

    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const countResult = await db.query(
      `SELECT COUNT(*) FROM proposals p JOIN clients c ON c.id = p.client_id ${whereStr}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await db.query(
      `SELECT p.*, c.name as client_name, pr.name as principal_name, u.full_name as created_by_name,
       (SELECT COALESCE(SUM(line_total), 0) FROM proposal_items WHERE proposal_id = p.id) as total
       FROM proposals p
       LEFT JOIN clients c ON c.id = p.client_id
       LEFT JOIN principals pr ON pr.id = p.principal_id
       LEFT JOIN users u ON u.id = p.created_by
       ${whereStr}
       ORDER BY p.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('Ошибка получения КП:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// =================== GET /api/proposals/:id ===================
router.get('/:id', auth, async (req, res) => {
  try {
    const proposal = await db.query(
      `SELECT p.*, c.name as client_name, c.phone as client_phone, c.email as client_email,
       c.address as client_address, c.inn as client_inn, c.kpp as client_kpp,
       c.legal_address as client_legal_address, c.bank_details as client_bank_details,
       pr.name as principal_name, pr.agent_commission_pct,
       u.full_name as created_by_name
       FROM proposals p
       LEFT JOIN clients c ON c.id = p.client_id
       LEFT JOIN principals pr ON pr.id = p.principal_id
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.id = $1`, [req.params.id]
    );
    if (proposal.rows.length === 0) return res.status(404).json({ error: 'КП не найдено' });

    const items = await db.query(
      `SELECT pi.*, c.article
       FROM proposal_items pi
       LEFT JOIN components c ON c.id = pi.product_id
       WHERE pi.proposal_id = $1 ORDER BY pi.id`, [req.params.id]
    );

    const data = proposal.rows[0];
    data.items = items.rows;
    data.total = items.rows.reduce((s, i) => s + parseFloat(i.line_total), 0);
    res.json(data);
  } catch (err) {
    console.error('Ошибка получения КП:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// =================== POST /api/proposals ===================
router.post('/', auth, adminOnly, async (req, res) => {
  const pgClient = await db.pool.connect();
  try {
    await pgClient.query('BEGIN');
    const { client_id, principal_id, valid_until, status, items, comment } = req.body;

    if (!client_id || !items || items.length === 0) {
      return res.status(400).json({ error: 'Клиент и позиции обязательны' });
    }

    const proposalNumber = await generateProposalNumber();

    const proposalResult = await pgClient.query(
      `INSERT INTO proposals (proposal_number, client_id, principal_id, valid_until, status, comment, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [proposalNumber, client_id, principal_id || null, valid_until || null, status || 'draft', comment || null, req.user.id]
    );
    const proposal = proposalResult.rows[0];

    for (const item of items) {
      const lineTotal = (parseFloat(item.unit_price) || 0) * (parseInt(item.quantity) || 1);
      await pgClient.query(
        `INSERT INTO proposal_items (proposal_id, product_id, product_name, description, unit_price, quantity, line_total, is_drawing, drawing_id, image_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [proposal.id, item.product_id || null, item.product_name, item.description || null,
         item.unit_price || 0, item.quantity || 1, lineTotal, item.is_drawing || false,
         item.drawing_id || null, item.image_path || null]
      );
    }

    await pgClient.query('COMMIT');
    res.status(201).json(proposal);
  } catch (err) {
    await pgClient.query('ROLLBACK');
    console.error('Ошибка создания КП:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  } finally {
    pgClient.release();
  }
});

// =================== PUT /api/proposals/:id ===================
router.put('/:id', auth, adminOnly, async (req, res) => {
  const pgClient = await db.pool.connect();
  try {
    await pgClient.query('BEGIN');
    const { client_id, principal_id, valid_until, status, items, comment } = req.body;

    const proposalResult = await pgClient.query(
      `UPDATE proposals SET client_id = $1, principal_id = $2, valid_until = $3, status = $4,
       comment = $5, updated_at = NOW() WHERE id = $6 RETURNING *`,
      [client_id, principal_id || null, valid_until || null, status || 'draft', comment || null, req.params.id]
    );

    if (proposalResult.rows.length === 0) {
      await pgClient.query('ROLLBACK');
      return res.status(404).json({ error: 'КП не найдено' });
    }

    // Пересоздаём позиции
    await pgClient.query('DELETE FROM proposal_items WHERE proposal_id = $1', [req.params.id]);
    if (items && items.length > 0) {
      for (const item of items) {
        const lineTotal = (parseFloat(item.unit_price) || 0) * (parseInt(item.quantity) || 1);
        await pgClient.query(
          `INSERT INTO proposal_items (proposal_id, product_id, product_name, description, unit_price, quantity, line_total, is_drawing, drawing_id, image_path)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [req.params.id, item.product_id || null, item.product_name, item.description || null,
           item.unit_price || 0, item.quantity || 1, lineTotal, item.is_drawing || false,
           item.drawing_id || null, item.image_path || null]
        );
      }
    }

    await pgClient.query('COMMIT');
    res.json(proposalResult.rows[0]);
  } catch (err) {
    await pgClient.query('ROLLBACK');
    console.error('Ошибка обновления КП:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  } finally {
    pgClient.release();
  }
});

// =================== DELETE /api/proposals/:id ===================
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM proposals WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'КП не найдено' });
    res.json({ message: 'КП удалено' });
  } catch (err) {
    console.error('Ошибка удаления КП:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// =================== POST /api/proposals/:id/convert — перевод в заказ ===================
router.post('/:id/convert', auth, adminOnly, async (req, res) => {
  const pgClient = await db.pool.connect();
  try {
    await pgClient.query('BEGIN');

    // Получаем КП с позициями
    const proposalRes = await pgClient.query('SELECT * FROM proposals WHERE id = $1', [req.params.id]);
    if (proposalRes.rows.length === 0) {
      await pgClient.query('ROLLBACK');
      return res.status(404).json({ error: 'КП не найдено' });
    }
    const proposal = proposalRes.rows[0];
    if (proposal.order_id) {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({ error: 'КП уже переведено в заказ' });
    }

    const itemsRes = await pgClient.query('SELECT * FROM proposal_items WHERE proposal_id = $1', [req.params.id]);
    const items = itemsRes.rows;

    // Считаем суммы
    const subtotal = items.reduce((s, i) => s + parseFloat(i.line_total), 0);
    let commPct = 0;
    if (proposal.principal_id) {
      const pRes = await pgClient.query('SELECT agent_commission_pct FROM principals WHERE id = $1', [proposal.principal_id]);
      if (pRes.rows.length) commPct = parseFloat(pRes.rows[0].agent_commission_pct) || 0;
    }
    const commissionAmount = subtotal * commPct / 100;

    // Генерируем номер заказа
    const lastOrder = await pgClient.query("SELECT order_number FROM orders ORDER BY id DESC LIMIT 1");
    let orderNum = 'ORD-0001';
    if (lastOrder.rows.length) {
      const n = parseInt(lastOrder.rows[0].order_number.replace(/\D/g, '')) || 0;
      orderNum = `ORD-${String(n + 1).padStart(4, '0')}`;
    }

    // Создаём заказ
    const orderResult = await pgClient.query(
      `INSERT INTO orders (order_number, client_id, principal_id, order_date, status, subtotal,
       commission_pct, commission_amount, total, comment, created_by)
       VALUES ($1, $2, $3, NOW(), 'new', $4, $5, $6, $7, $8, $9) RETURNING *`,
      [orderNum, proposal.client_id, proposal.principal_id, subtotal, commPct, commissionAmount, subtotal,
       `Создан из КП ${proposal.proposal_number}`, req.user.id]
    );
    const order = orderResult.rows[0];

    // Копируем позиции
    for (const item of items) {
      let metadata = null;

      if (item.is_drawing && item.drawing_id) {
        // Загружаем компоненты чертежа для полных метаданных
        const dcRes = await pgClient.query(
          `SELECT dc.*, c.name as component_name, c.article, c.price, c.image_path,
                  cm.code AS modification_code, cm.name AS modification_name, cm.price_override AS modification_price
           FROM drawing_components dc
           LEFT JOIN components c ON c.id = dc.component_id
           LEFT JOIN component_modifications cm ON cm.id = dc.modification_id
           WHERE dc.drawing_id = $1`,
          [item.drawing_id]
        );
        const drawingComps = dcRes.rows;

        const componentsData = drawingComps.map(c => {
          const effectivePrice = c.modification_price !== null && c.modification_price !== undefined
            ? parseFloat(c.modification_price) : (parseFloat(c.price) || 0);
          const qty = parseFloat(c.quantity) || 1;
          const baseTotal = effectivePrice * qty;
          const markupPct = parseFloat(c.item_markup_pct) || 0;
          const markupRub = parseFloat(c.item_markup_rub) || 0;
          const markupPctAmount = baseTotal * markupPct / 100;
          const lineTotal = baseTotal + markupPctAmount + markupRub;
          return {
            name: c.component_name || 'Компонент',
            article: c.modification_code ? (c.article || '') + '.' + c.modification_code : (c.article || ''),
            modification_name: c.modification_name || null,
            price: effectivePrice,
            quantity: qty,
            base_total: baseTotal,
            markup_pct: markupPct,
            markup_rub: markupRub,
            markup_pct_amount: markupPctAmount,
            line_total: lineTotal,
            image_path: c.image_path || null,
          };
        });

        const componentsTotal = componentsData.reduce((s, c) => s + c.base_total, 0);
        const itemMarkupsTotal = componentsData.reduce((s, c) => s + c.markup_pct_amount + c.markup_rub, 0);
        const grandTotal = parseFloat(item.line_total) || (componentsTotal + itemMarkupsTotal);

        metadata = {
          type: 'calculator_drawing',
          drawing_id: item.drawing_id,
          components: componentsData,
          components_total: componentsTotal,
          item_markups_total: itemMarkupsTotal,
          global_markup_pct: 0,
          global_markup_rub: 0,
          global_markup_pct_amount: 0,
          grand_total: grandTotal,
        };
      }

      await pgClient.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [order.id, item.product_id, item.product_name, item.unit_price, item.quantity, item.line_total,
         metadata ? JSON.stringify(metadata) : null]
      );
    }

    // Обновляем КП
    await pgClient.query(
      "UPDATE proposals SET status = 'converted', order_id = $1, updated_at = NOW() WHERE id = $2",
      [order.id, req.params.id]
    );

    await pgClient.query('COMMIT');
    res.json({ message: 'КП переведено в заказ', order_id: order.id, order_number: order.order_number });
  } catch (err) {
    await pgClient.query('ROLLBACK');
    console.error('Ошибка конвертации КП:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  } finally {
    pgClient.release();
  }
});

// =================== GET /api/proposals/:id/pdf — генерация PDF ===================
router.get('/:id/pdf', auth, async (req, res) => {
  try {
    // Получаем данные КП
    const proposalRes = await db.query(
      `SELECT p.*, c.name as client_name, c.phone as client_phone, c.email as client_email,
       c.address as client_address, c.inn as client_inn, c.kpp as client_kpp,
       c.legal_address as client_legal_address, c.bank_details as client_bank_details,
       pr.name as principal_name
       FROM proposals p
       LEFT JOIN clients c ON c.id = p.client_id
       LEFT JOIN principals pr ON pr.id = p.principal_id
       WHERE p.id = $1`, [req.params.id]
    );
    if (proposalRes.rows.length === 0) return res.status(404).json({ error: 'КП не найдено' });
    const proposal = proposalRes.rows[0];

    const itemsRes = await db.query(
      `SELECT pi.*, c.article
       FROM proposal_items pi
       LEFT JOIN components c ON c.id = pi.product_id
       WHERE pi.proposal_id = $1 ORDER BY pi.id`, [req.params.id]
    );
    const items = itemsRes.rows;
    const totalWithoutVAT = items.reduce((s, i) => s + parseFloat(i.line_total), 0);

    // НДС — из системных настроек в БД
    let vatRate = 22;
    try {
      const vatRes = await db.query("SELECT value FROM system_settings WHERE key = 'vat'");
      if (vatRes.rows.length > 0) {
        vatRate = parseFloat(vatRes.rows[0].value.rate) || 22;
      }
    } catch (e) {
      // fallback: из query-параметра или 22% по умолчанию
      vatRate = parseFloat(req.query.vat_rate) || 22;
    }
    const vatAmount = totalWithoutVAT * vatRate / 100;
    const totalWithVAT = totalWithoutVAT + vatAmount;

    // Создаём PDF
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
      Title: `Коммерческое предложение ${proposal.proposal_number}`,
      Author: 'ООО «Атланта»',
    }});

    // Регистрируем шрифты для кириллицы
    const fontDir = path.join(__dirname, '..', '..', 'assets', 'fonts');
    const hasCustomFonts = fs.existsSync(path.join(fontDir, 'Roboto-Regular.ttf'));
    
    if (hasCustomFonts) {
      doc.registerFont('Regular', path.join(fontDir, 'Roboto-Regular.ttf'));
      doc.registerFont('Bold', path.join(fontDir, 'Roboto-Bold.ttf'));
    } else {
      // Fallback — встроенные шрифты (без кириллицы, поэтому скачаем)
      doc.registerFont('Regular', 'Helvetica');
      doc.registerFont('Bold', 'Helvetica-Bold');
    }

    const fontRegular = hasCustomFonts ? 'Regular' : 'Helvetica';
    const fontBold = hasCustomFonts ? 'Bold' : 'Helvetica-Bold';

    const pageWidth = doc.page.width - 80; // margin 40 * 2

    // === ШАПКА ===
    const logoPath = path.join(__dirname, '..', '..', 'assets', 'logo.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 40, 30, { width: 80 });
    }

    // Реквизиты компании — правая сторона
    doc.font(fontBold).fontSize(11).text('ООО «Атланта»', 140, 35, { width: pageWidth - 100 });
    doc.font(fontRegular).fontSize(7.5);
    doc.text('ИНН 4816005385 / КПП 481601001', 140, 50);
    doc.text('399334, Липецкая обл., Усманский р-н, с. Московка, ул. Центральная, зд. 53', 140, 60);
    doc.text('Р/С 40702810835180100303 ПАО Сбербанк, БИК 044206604', 140, 70);
    doc.text('Тел. (47472) 3-64-12, 3-63-84', 140, 80);

    // Линия-разделитель
    doc.moveTo(40, 100).lineTo(555, 100).strokeColor('#4a90a4').lineWidth(2).stroke();

    // === ЗАГОЛОВОК ===
    doc.font(fontBold).fontSize(16).fillColor('#1a1a2e')
       .text(`КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ`, 40, 115, { align: 'center', width: pageWidth });
    doc.font(fontBold).fontSize(12).fillColor('#4a90a4')
       .text(`№ ${proposal.proposal_number} от ${new Date(proposal.created_at).toLocaleDateString('ru-RU')}`, 40, 137, { align: 'center', width: pageWidth });

    let y = 160;

    // === РЕКВИЗИТЫ КЛИЕНТА ===
    doc.font(fontBold).fontSize(9).fillColor('#333')
       .text('Заказчик:', 40, y);
    y += 14;
    doc.font(fontRegular).fontSize(9).fillColor('#333');
    doc.text(proposal.client_name, 40, y); y += 12;
    if (proposal.client_inn) { doc.text(`ИНН ${proposal.client_inn}${proposal.client_kpp ? ' / КПП ' + proposal.client_kpp : ''}`, 40, y); y += 12; }
    if (proposal.client_legal_address) { doc.text(proposal.client_legal_address, 40, y); y += 12; }
    else if (proposal.client_address) { doc.text(proposal.client_address, 40, y); y += 12; }
    if (proposal.client_bank_details) { doc.text(proposal.client_bank_details, 40, y); y += 12; }
    if (proposal.client_phone) { doc.text(`Тел.: ${proposal.client_phone}`, 40, y); y += 12; }
    if (proposal.client_email) { doc.text(`Email: ${proposal.client_email}`, 40, y); y += 12; }

    y += 8;

    // === ТАБЛИЦА ПОЗИЦИЙ ===
    // Колонки: №, Артикул, Наименование, Кол-во, Цена с НДС, Сумма с НДС
    const colW = [25, 65, 195, 45, 90, 95];

    const fmtMoney = (v) => parseFloat(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const drawTableHeader = (rowY) => {
      const headerCols = ['№', 'Артикул', 'Наименование', 'Кол-во', `Цена с НДС, ₽`, `Сумма с НДС, ₽`];
      let x = 40;
      doc.rect(x, rowY, pageWidth, 22).fill('#4a90a4');
      doc.font(fontBold).fontSize(7.5).fillColor('#fff');
      headerCols.forEach((text, i) => {
        const align = (i >= 3) ? 'right' : 'left';
        doc.text(text, x + 3, rowY + 6, { width: colW[i] - 6, align });
        x += colW[i];
      });
    };

    // Шапка
    drawTableHeader(y);
    y += 24;

    // Строки
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowHeight = 20;

      // Проверяем, нужна ли новая страница
      if (y + rowHeight > doc.page.height - 100) {
        doc.addPage();
        y = 40;
        drawTableHeader(y);
        y += 24;
      }

      // Полоска для чётных строк
      if (i % 2 === 0) {
        doc.rect(40, y, pageWidth, rowHeight).fill('#f8f9fa');
      }

      const unitPriceVAT = parseFloat(item.unit_price) * (1 + vatRate / 100);
      const lineTotalVAT = parseFloat(item.line_total) * (1 + vatRate / 100);
      const article = item.article || (item.is_drawing ? '📐' : '—');

      let x = 40;
      doc.font(fontRegular).fontSize(8).fillColor('#333');

      // №
      doc.text(String(i + 1), x + 3, y + 5, { width: colW[0] - 6, align: 'center' });
      x += colW[0];

      // Артикул
      doc.font(fontRegular).fontSize(7).fillColor('#4a90a4');
      doc.text(article, x + 3, y + 6, { width: colW[1] - 6 });
      x += colW[1];

      // Наименование
      doc.font(fontRegular).fontSize(8).fillColor('#333');
      doc.text(item.product_name, x + 3, y + 5, { width: colW[2] - 6 });
      x += colW[2];

      // Кол-во
      doc.text(String(item.quantity), x + 3, y + 5, { width: colW[3] - 6, align: 'right' });
      x += colW[3];

      // Цена с НДС
      doc.text(fmtMoney(unitPriceVAT), x + 3, y + 5, { width: colW[4] - 6, align: 'right' });
      x += colW[4];

      // Сумма с НДС
      doc.font(fontBold).fontSize(8).fillColor('#333');
      doc.text(fmtMoney(lineTotalVAT), x + 3, y + 5, { width: colW[5] - 6, align: 'right' });

      // Нижняя линия
      doc.moveTo(40, y + rowHeight).lineTo(40 + pageWidth, y + rowHeight).strokeColor('#e0e0e0').lineWidth(0.5).stroke();
      y += rowHeight;
    }

    // === ИТОГО ===
    y += 8;
    const totalsX = 40 + pageWidth - 250;
    const totalsW = 250;

    // Стоимость без НДС
    doc.font(fontRegular).fontSize(9).fillColor('#333');
    doc.text('Итого без НДС:', totalsX, y, { width: 130 });
    doc.font(fontRegular).fontSize(9).fillColor('#333');
    doc.text(fmtMoney(totalWithoutVAT) + ' ₽', totalsX + 130, y, { width: totalsW - 130, align: 'right' });
    y += 16;

    // Сумма НДС
    doc.font(fontRegular).fontSize(9).fillColor('#333');
    doc.text(`НДС (${vatRate}%):`, totalsX, y, { width: 130 });
    doc.text(fmtMoney(vatAmount) + ' ₽', totalsX + 130, y, { width: totalsW - 130, align: 'right' });
    y += 18;

    // Итого с НДС — выделенный блок
    doc.rect(totalsX - 5, y - 2, totalsW + 10, 26).fill('#4a90a4');
    doc.font(fontBold).fontSize(11).fillColor('#fff');
    doc.text('ИТОГО с НДС:', totalsX, y + 4, { width: 130 });
    doc.text(fmtMoney(totalWithVAT) + ' ₽', totalsX + 130, y + 4, { width: totalsW - 130, align: 'right' });
    y += 35;

    // === Комментарий ===
    if (proposal.comment) {
      doc.font(fontBold).fontSize(8.5).fillColor('#333').text('Примечание:', 40, y);
      y += 12;
      doc.font(fontRegular).fontSize(8.5).fillColor('#555').text(proposal.comment, 40, y, { width: pageWidth });
      y += 20;
    }

    // === Срок действия ===
    if (proposal.valid_until) {
      y += 5;
      doc.font(fontRegular).fontSize(8.5).fillColor('#666')
         .text(`Предложение действительно до: ${new Date(proposal.valid_until).toLocaleDateString('ru-RU')}`, 40, y);
      y += 20;
    }

    // === Подпись ===
    y += 10;
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#ccc').lineWidth(0.5).stroke();
    y += 10;
    doc.font(fontRegular).fontSize(8).fillColor('#666');
    doc.text('Директор ООО «Атланта»', 40, y);
    doc.text('_________________ Мешков В.Н.', 350, y);

    // === Отправка ===
    const safeFilename = proposal.proposal_number.replace(/[^\w\d-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}.pdf"; filename*=UTF-8''${encodeURIComponent(proposal.proposal_number + '.pdf')}`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('Ошибка генерации PDF:', err);
    res.status(500).json({ error: 'Ошибка генерации PDF' });
  }
});

module.exports = router;
