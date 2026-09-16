const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// GET /api/reports/summary — сводный отчёт
router.get('/summary', auth, async (req, res) => {
  try {
    const { date_from, date_to, principal_id } = req.query;
    const conditions = [];
    const params = [];

    if (date_from) {
      params.push(date_from);
      conditions.push(`o.order_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`o.order_date <= $${params.length}`);
    }
    if (principal_id) {
      params.push(principal_id);
      conditions.push(`o.principal_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Общая сводка
    const summaryQuery = `
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(o.subtotal), 0) as total_subtotal,
        COALESCE(SUM(o.commission_amount), 0) as total_commission,
        COALESCE(SUM(o.total), 0) as total_amount,
        COUNT(CASE WHEN o.status = 'new' THEN 1 END) as new_count,
        COUNT(CASE WHEN o.status = 'in_progress' THEN 1 END) as in_progress_count,
        COUNT(CASE WHEN o.status = 'paid' THEN 1 END) as paid_count,
        COUNT(CASE WHEN o.status = 'completed' THEN 1 END) as completed_count,
        COUNT(CASE WHEN o.status = 'cancelled' THEN 1 END) as cancelled_count
      FROM orders o
      ${where}
    `;

    // По месяцам
    const monthlyQuery = `
      SELECT
        TO_CHAR(o.order_date, 'YYYY-MM') as month,
        COUNT(*) as orders_count,
        COALESCE(SUM(o.subtotal), 0) as subtotal,
        COALESCE(SUM(o.commission_amount), 0) as commission,
        COALESCE(SUM(o.total), 0) as total
      FROM orders o
      ${where}
      GROUP BY TO_CHAR(o.order_date, 'YYYY-MM')
      ORDER BY month
    `;

    const [summaryResult, monthlyResult] = await Promise.all([
      db.query(summaryQuery, params),
      db.query(monthlyQuery, params),
    ]);

    res.json({
      summary: summaryResult.rows[0],
      monthly: monthlyResult.rows,
    });
  } catch (err) {
    console.error('Ошибка формирования сводного отчёта:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/reports/by-client
router.get('/by-client', auth, async (req, res) => {
  try {
    const { date_from, date_to, principal_id } = req.query;
    const conditions = [];
    const params = [];

    if (date_from) {
      params.push(date_from);
      conditions.push(`o.order_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`o.order_date <= $${params.length}`);
    }
    if (principal_id) {
      params.push(principal_id);
      conditions.push(`o.principal_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT
        c.id as client_id,
        c.name as client_name,
        COUNT(o.id) as orders_count,
        COALESCE(SUM(o.subtotal), 0) as total_subtotal,
        COALESCE(SUM(o.commission_amount), 0) as total_commission,
        COALESCE(SUM(o.total), 0) as total_amount
      FROM orders o
      LEFT JOIN clients c ON o.client_id = c.id
      ${where}
      GROUP BY c.id, c.name
      ORDER BY total_amount DESC
    `;

    const result = await db.query(query, params);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка отчёта по клиентам:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/reports/by-principal
router.get('/by-principal', auth, async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const conditions = [];
    const params = [];

    if (date_from) {
      params.push(date_from);
      conditions.push(`o.order_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`o.order_date <= $${params.length}`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT
        p.id as principal_id,
        p.name as principal_name,
        p.agent_commission_pct,
        COUNT(o.id) as orders_count,
        COALESCE(SUM(o.subtotal), 0) as total_subtotal,
        COALESCE(SUM(o.commission_amount), 0) as total_commission,
        COALESCE(SUM(o.total), 0) as total_amount
      FROM orders o
      LEFT JOIN principals p ON o.principal_id = p.id
      ${where}
      GROUP BY p.id, p.name, p.agent_commission_pct
      ORDER BY total_amount DESC
    `;

    const result = await db.query(query, params);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка отчёта по принципалам:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/reports/orders-detail — детализация заказов для отчёта
router.get('/orders-detail', auth, async (req, res) => {
  try {
    const { date_from, date_to, principal_id, status, client_id } = req.query;
    const conditions = [];
    const params = [];

    if (date_from) {
      params.push(date_from);
      conditions.push(`o.order_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`o.order_date <= $${params.length}`);
    }
    if (principal_id) {
      params.push(principal_id);
      conditions.push(`o.principal_id = $${params.length}`);
    }
    if (client_id) {
      params.push(client_id);
      conditions.push(`o.client_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT o.*, c.name as client_name, p.name as principal_name
      FROM orders o
      LEFT JOIN clients c ON o.client_id = c.id
      LEFT JOIN principals p ON o.principal_id = p.id
      ${where}
      ORDER BY o.order_date DESC
    `;

    const result = await db.query(query, params);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Ошибка детализации заказов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/reports/export/excel
router.get('/export/excel', auth, async (req, res) => {
  try {
    const { date_from, date_to, principal_id } = req.query;
    const conditions = [];
    const params = [];

    if (date_from) {
      params.push(date_from);
      conditions.push(`o.order_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`o.order_date <= $${params.length}`);
    }
    if (principal_id) {
      params.push(principal_id);
      conditions.push(`o.principal_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT o.order_number, o.order_date, c.name as client_name, p.name as principal_name,
             o.status, o.subtotal, o.commission_pct, o.commission_amount, o.total, o.comment
      FROM orders o
      LEFT JOIN clients c ON o.client_id = c.id
      LEFT JOIN principals p ON o.principal_id = p.id
      ${where}
      ORDER BY o.order_date DESC
    `;

    const result = await db.query(query, params);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CRM Атланта';
    const sheet = workbook.addWorksheet('Отчёт по заказам');

    // Заголовок
    sheet.mergeCells('A1:I1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'Отчёт по заказам — CRM «Атланта»';
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center' };

    // Период
    sheet.mergeCells('A2:I2');
    const periodCell = sheet.getCell('A2');
    const periodParts = [];
    if (date_from) periodParts.push(`с ${date_from}`);
    if (date_to) periodParts.push(`по ${date_to}`);
    periodCell.value = periodParts.length > 0 ? `Период: ${periodParts.join(' ')}` : 'Все даты';
    periodCell.font = { size: 11, italic: true };
    periodCell.alignment = { horizontal: 'center' };

    // Заголовки столбцов
    const headers = ['№ заказа', 'Дата', 'Клиент', 'Принципал', 'Статус', 'Сумма без комиссии', '% комиссии', 'Комиссия', 'Итого'];
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.alignment = { horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    const statusMap = {
      'new': 'Новый', 'in_progress': 'В работе', 'paid': 'Оплачен',
      'completed': 'Выполнен', 'cancelled': 'Отменён',
    };

    // Данные
    let totalSubtotal = 0, totalCommission = 0, totalAmount = 0;
    for (const row of result.rows) {
      totalSubtotal += parseFloat(row.subtotal);
      totalCommission += parseFloat(row.commission_amount);
      totalAmount += parseFloat(row.total);

      const dataRow = sheet.addRow([
        row.order_number,
        new Date(row.order_date).toLocaleDateString('ru-RU'),
        row.client_name,
        row.principal_name,
        statusMap[row.status] || row.status,
        parseFloat(row.subtotal),
        parseFloat(row.commission_pct) + '%',
        parseFloat(row.commission_amount),
        parseFloat(row.total),
      ]);

      dataRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
      });
    }

    // Итоги
    sheet.addRow([]);
    const totalsRow = sheet.addRow(['', '', '', '', 'ИТОГО:', totalSubtotal, '', totalCommission, totalAmount]);
    totalsRow.eachCell((cell) => {
      cell.font = { bold: true };
    });

    // Ширина столбцов
    sheet.columns = [
      { width: 15 }, { width: 12 }, { width: 25 }, { width: 20 }, { width: 14 },
      { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 },
    ];

    // Формат числовых столбцов
    sheet.getColumn(6).numFmt = '#,##0.00 ₽';
    sheet.getColumn(8).numFmt = '#,##0.00 ₽';
    sheet.getColumn(9).numFmt = '#,##0.00 ₽';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('Отчёт_' + Date.now() + '.xlsx')}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Ошибка экспорта Excel:', err);
    res.status(500).json({ error: 'Ошибка экспорта' });
  }
});

// GET /api/reports/export/pdf
router.get('/export/pdf', auth, async (req, res) => {
  try {
    const { date_from, date_to, principal_id } = req.query;
    const conditions = [];
    const params = [];

    if (date_from) {
      params.push(date_from);
      conditions.push(`o.order_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`o.order_date <= $${params.length}`);
    }
    if (principal_id) {
      params.push(principal_id);
      conditions.push(`o.principal_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT o.order_number, o.order_date, c.name as client_name, p.name as principal_name,
             o.status, o.subtotal, o.commission_pct, o.commission_amount, o.total
      FROM orders o
      LEFT JOIN clients c ON o.client_id = c.id
      LEFT JOIN principals p ON o.principal_id = p.id
      ${where}
      ORDER BY o.order_date DESC
    `;

    const result = await db.query(query, params);

    const statusMap = {
      'new': 'Новый', 'in_progress': 'В работе', 'paid': 'Оплачен',
      'completed': 'Выполнен', 'cancelled': 'Отменён',
    };

    const fontPath = path.join(__dirname, '../../assets/fonts');
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });

    // Регистрация шрифтов с поддержкой кириллицы
    doc.registerFont('Roboto', path.join(fontPath, 'Roboto-Regular.ttf'));
    doc.registerFont('Roboto-Bold', path.join(fontPath, 'Roboto-Bold.ttf'));
    doc.font('Roboto');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('Отчёт_' + Date.now() + '.pdf')}`);
    doc.pipe(res);

    // Заголовок
    doc.font('Roboto-Bold').fontSize(18).text('Отчёт по заказам — CRM «Атланта»', { align: 'center' });
    doc.moveDown(0.5);

    const periodParts = [];
    if (date_from) periodParts.push(`с ${date_from}`);
    if (date_to) periodParts.push(`по ${date_to}`);
    doc.font('Roboto').fontSize(10).text(periodParts.length > 0 ? `Период: ${periodParts.join(' ')}` : 'Все даты', { align: 'center' });
    doc.moveDown(1);

    // Таблица
    const tableTop = doc.y;
    const colWidths = [70, 65, 140, 100, 70, 85, 55, 75, 80];
    const headers = ['№ заказа', 'Дата', 'Клиент', 'Принципал', 'Статус', 'Сумма', '%', 'Комиссия', 'Итого'];
    const rowHeight = 20;

    // Заголовок таблицы
    let x = 40;
    doc.font('Roboto-Bold').fontSize(8).fillColor('#ffffff');
    headers.forEach((header, i) => {
      doc.rect(x, tableTop, colWidths[i], rowHeight).fill('#2563eb');
      doc.fillColor('#ffffff').text(header, x + 3, tableTop + 5, { width: colWidths[i] - 6, align: 'center' });
      x += colWidths[i];
    });

    // Данные
    let y = tableTop + rowHeight;
    let totalSubtotal = 0, totalCommission = 0, totalAmount = 0;

    doc.font('Roboto').fillColor('#000000');
    for (const row of result.rows) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 40;
      }

      totalSubtotal += parseFloat(row.subtotal);
      totalCommission += parseFloat(row.commission_amount);
      totalAmount += parseFloat(row.total);

      const bgColor = result.rows.indexOf(row) % 2 === 0 ? '#f8fafc' : '#ffffff';
      x = 40;
      const values = [
        row.order_number,
        new Date(row.order_date).toLocaleDateString('ru-RU'),
        row.client_name || '-',
        row.principal_name || '-',
        statusMap[row.status] || row.status,
        parseFloat(row.subtotal).toLocaleString('ru-RU', { minimumFractionDigits: 2 }),
        row.commission_pct + '%',
        parseFloat(row.commission_amount).toLocaleString('ru-RU', { minimumFractionDigits: 2 }),
        parseFloat(row.total).toLocaleString('ru-RU', { minimumFractionDigits: 2 }),
      ];

      values.forEach((val, i) => {
        doc.rect(x, y, colWidths[i], rowHeight).fill(bgColor).stroke('#e2e8f0');
        doc.fillColor('#1e293b').fontSize(7).text(String(val), x + 3, y + 5, { width: colWidths[i] - 6, align: 'center' });
        x += colWidths[i];
      });

      y += rowHeight;
    }

    // Итоги
    y += 10;
    doc.font('Roboto-Bold').fontSize(10).fillColor('#000000');
    doc.text(`Всего заказов: ${result.rows.length}`, 40, y);
    doc.font('Roboto').text(`Сумма без комиссии: ${totalSubtotal.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.`, 40, y + 15);
    doc.text(`Комиссия агента: ${totalCommission.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.`, 40, y + 30);
    doc.font('Roboto-Bold').text(`Итого: ${totalAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.`, 40, y + 45);

    // Дата формирования
    doc.moveDown(3);
    doc.font('Roboto').fontSize(8).fillColor('#94a3b8').text(`Отчёт сформирован: ${new Date().toLocaleString('ru-RU')}`, { align: 'right' });

    doc.end();
  } catch (err) {
    console.error('Ошибка экспорта PDF:', err);
    res.status(500).json({ error: 'Ошибка экспорта' });
  }
});

module.exports = router;
