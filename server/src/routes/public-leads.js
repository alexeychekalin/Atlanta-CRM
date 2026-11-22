/**
 * Публичный приёмник заявок с сайта: POST /api/public/leads.
 *
 * Отдельный роутер, а не часть «Заявок» в CRM, — чтобы не было соблазна
 * смонтировать приёмник ещё где-нибудь и случайно открыть раздел без прав.
 * Здесь нет авторизации (посетитель сайта), поэтому всё, что защищает, —
 * лимит запросов, проверка полей и ловушка для ботов.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const db = require('../db');
const { parseItems, notifyAboutLead } = require('./leads-shared');

const router = express.Router();

// 20 заявок с IP за 10 минут: живой человек столько не отправит, а бот,
// перебирающий формы, упрётся.
const leadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Слишком много заявок. Позвоните или напишите в Telegram.' },
});

const leadFilesDir = path.join(__dirname, '../../uploads/leads');
if (!fs.existsSync(leadFilesDir)) fs.mkdirSync(leadFilesDir, { recursive: true });

// Фото детали и схема: то, что клиент снимает на телефон. PDF — если пришлют
// чертёж со сканера. SVG и исполняемые форматы не принимаем: файл открывают
// в браузере, а SVG умеет исполнять скрипты.
const leadFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'];
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Допустимые форматы: JPG, PNG, WebP, HEIC, PDF'));
};

const uploadLeadFiles = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, leadFilesDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  fileFilter: leadFileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

function line(value, max = 255) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function block(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

/** Телефон оставляем как ввели — менеджеру важен привычный формат клиента. */
function phone(value) {
  return String(value ?? '').trim().slice(0, 50);
}

/**
 * Удалить загруженные файлы: заявка не создана (бот или дубль), а мусор
 * в uploads/leads оставаться не должен.
 */
function removeUploaded(req) {
  for (const file of req.files || []) {
    try { fs.unlinkSync(file.path); } catch { /* файл мог не создаться */ }
  }
}

/**
 * Не дать спаму вырасти в базу: если с этого же телефона за последние
 * 10 минут уже была заявка с тем же текстом — это дубль (двойной клик,
 * повторная отправка после таймаута). Отвечаем «принято», новую не создаём.
 */
async function findRecentDuplicate({ phoneValue, message }) {
  if (!phoneValue) return null;
  const result = await db.query(
    `SELECT id FROM leads
      WHERE phone = $1 AND COALESCE(message, '') = $2
        AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY id DESC LIMIT 1`,
    [phoneValue, message || '']
  );
  return result.rows[0] || null;
}

// POST /api/public/leads — форма с сайта (без авторизации)
router.post('/', leadLimiter, uploadLeadFiles.array('files', 5), async (req, res) => {
  try {
    const body = req.body || {};

    // ловушка для ботов: поле company скрыто стилями, человек его не заполнит
    if (line(body.company)) {
      removeUploaded(req);
      return res.status(201).json({ ok: true, id: null });
    }

    const nameValue = line(body.name, 120);
    const phoneValue = phone(body.phone);
    if (!nameValue || phoneValue.replace(/\D/g, '').length < 6) {
      return res.status(400).json({ error: 'Укажите имя и телефон' });
    }

    const message = block(body.message);
    const items = parseItems(body);
    const files = (req.files || []).map(file => ({
      path: `/uploads/leads/${file.filename}`,
      name: file.originalname,
      size: file.size,
    }));

    const duplicate = await findRecentDuplicate({ phoneValue, message });
    if (duplicate) {
      removeUploaded(req);
      return res.status(200).json({ ok: true, id: duplicate.id, duplicate: true });
    }

    const inserted = await db.query(
      `INSERT INTO leads (name, phone, email, company, message, page, source,
                          article, item_count, file_count, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'new')
       RETURNING *`,
      [
        nameValue,
        phoneValue,
        line(body.email, 200) || null,
        line(body.company) || null,
        message || null,
        line(body.page, 500) || null,
        line(body.source, 50) || 'site',
        items[0] ? items[0].article || null : null,
        items.length,
        files.length,
      ]
    );
    const lead = inserted.rows[0];

    for (const [index, item] of items.entries()) {
      await db.query(
        `INSERT INTO lead_items (lead_id, article, name, quantity, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [lead.id, item.article || null, item.name || null, item.quantity, index]
      );
    }
    for (const file of files) {
      await db.query(
        `INSERT INTO lead_files (lead_id, file_path, name, file_size)
         VALUES ($1, $2, $3, $4)`,
        [lead.id, file.path, file.name, file.size]
      );
    }

    // Уведомления отправляем после ответа: клиент не должен ждать Telegram.
    // Ошибка отправки не ломает приём — она видна в карточке заявки.
    notifyAboutLead(lead, items, files).catch(err => {
      console.error('Заявка: уведомления не отправлены:', err.message);
    });

    res.status(201).json({ ok: true, id: lead.id });
  } catch (err) {
    console.error('Ошибка приёма заявки:', err);
    res.status(500).json({ error: 'Не удалось принять заявку. Позвоните или напишите в Telegram.' });
  }
});


module.exports = router;
