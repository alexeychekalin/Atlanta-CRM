/**
 * Общее для заявок: разбор позиций и запись результата уведомлений.
 *
 * Логика лежит отдельно от маршрутов, потому что её используют и публичный
 * приёмник с сайта, и повторная отправка уведомления из карточки заявки.
 */
const db = require('../db');

/** Обрезка строки: в форму может прилететь что угодно, в том числе объект. */
function line(value, max = 255) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Разобрать позиции заявки.
 *
 * Сайт присылает массив items; старые сборки формы — только article.
 * Поддерживаем оба варианта, чтобы выкладка сайта и обновление CRM могли
 * разойтись во времени без потери заявок.
 */
function parseItems(body = {}) {
  const raw = body.items;
  let items = [];

  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }
  }

  const cleaned = items
    .map(item => ({
      article: line(item && (item.article || item.sku), 100),
      name: line(item && item.name, 255),
      quantity: Math.max(1, Math.min(9999, Number(item && item.quantity) || 1)),
    }))
    .filter(item => item.article || item.name)
    .slice(0, 100);

  // старый формат: артикул из атрибута формы
  if (cleaned.length === 0 && line(body.article, 100)) {
    cleaned.push({ article: line(body.article, 100), name: '', quantity: 1 });
  }
  return cleaned;
}

/**
 * Уведомить о заявке и записать результат в журнал.
 *
 * Ошибка записи журнала не должна отменять уведомление: сначала отправляем,
 * потом пытаемся сохранить след. В карточке заявки видно, дошло ли.
 */
async function notifyAboutLead(lead, items, files) {
  const { notifyLead } = require('../services/lead-notify');
  const outcome = await notifyLead({ lead, items, files });

  const channels = [
    ['telegram', outcome.telegram],
    ['mail', outcome.mail],
    ['auto_reply', outcome.autoReply],
  ].filter(([, result]) => result);

  for (const [channel, result] of channels) {
    await db.query(
      `INSERT INTO lead_notifications (lead_id, channel, ok, detail)
       VALUES ($1, $2, $3, $4)`,
      [lead.id, channel, Boolean(result.ok), JSON.stringify(result).slice(0, 2000)]
    ).catch(() => { /* журнал — не повод терять заявку */ });
  }
  return outcome;
}

/** Последние попытки уведомления для карточки: дошло ли и когда. */
async function notificationsFor(leadId) {
  const result = await db.query(
    `SELECT channel, ok, detail, created_at FROM lead_notifications
      WHERE lead_id = $1 ORDER BY id DESC LIMIT 12`,
    [leadId]
  );
  return result.rows;
}

module.exports = { line, parseItems, notifyAboutLead, notificationsFor };
