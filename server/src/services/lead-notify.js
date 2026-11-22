/**
 * Уведомления о заявке с сайта: Telegram и почта.
 *
 * Заявку видят в трёх местах, и у каждого своя роль:
 *   • Telegram (личка + группа) — чтобы её заметили через минуту, а не через день;
 *   • письмо администратору — копия на случай, если бот заблокирован или упал;
 *   • автоответ клиенту — чтобы он знал, что заявка принята, и меньше звонил.
 *
 * Ни один канал не должен ломать приём заявки: она уже сохранена в базе,
 * а результат отправки пишется в lead_notifications и виден в карточке.
 */
const { sendToAll, escapeHtml } = require('./telegram');
const { sendMail, isConfigured: mailConfigured } = require('./mail');

function adminRecipients() {
  return String(process.env.LEAD_EMAIL_TO || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

/** Текст для Telegram: HTML, поэтому значения экранируем. */
function telegramText({ lead, items, files }) {
  const rows = [
    `🆕 <b>Заявка с сайта №${lead.id}</b>`,
    '',
    `👤 ${escapeHtml(lead.name)}`,
    `📞 ${escapeHtml(lead.phone)}`,
  ];
  if (lead.email) rows.push(`✉️ ${escapeHtml(lead.email)}`);
  if (lead.company) rows.push(`🏢 ${escapeHtml(lead.company)}`);

  const list = (items || []).filter(item => item.article || item.name);
  if (list.length > 0) {
    rows.push('', `📦 <b>Позиции (${list.length}):</b>`);
    for (const item of list) {
      const parts = [item.article, item.name].filter(Boolean).map(escapeHtml).join(' — ');
      rows.push(`• ${parts}${Number(item.quantity) > 1 ? ` × ${item.quantity}` : ''}`);
    }
  }
  if (lead.message) rows.push('', `💬 ${escapeHtml(lead.message)}`);
  if (lead.page) rows.push('', `🔗 ${escapeHtml(lead.page)}`);
  if ((files || []).length > 0) {
    rows.push(`📎 Файлов: ${files.length} — открыть в CRM`);
  }
  // Ссылка прямо на карточку заявки: менеджер открывает её из Telegram
  const crmUrl = String(process.env.CRM_PUBLIC_URL || '').replace(/\/+$/, '');
  if (crmUrl) {
    rows.push('', `<a href="${crmUrl}/#leads/${lead.id}">Открыть заявку в CRM</a>`);
  } else {
    rows.push('', '<i>Раздел «Заявки» в CRM</i>');
  }
  return rows.join('\n');
}

/** Текст письма администратору: обычный текст, без разметки. */
function mailText({ lead, items, files }) {
  const rows = [
    `Заявка с сайта №${lead.id}`,
    '',
    `Имя: ${lead.name}`,
    `Телефон: ${lead.phone}`,
  ];
  if (lead.email) rows.push(`Почта: ${lead.email}`);
  if (lead.company) rows.push(`Компания: ${lead.company}`);
  if (lead.page) rows.push(`Страница: ${lead.page}`);
  rows.push('');
  const list = (items || []).filter(item => item.article || item.name);
  if (list.length > 0) {
    rows.push(`Позиции (${list.length}):`);
    for (const item of list) {
      const parts = [item.article, item.name].filter(Boolean).join(' — ');
      rows.push(`  • ${parts}${Number(item.quantity) > 1 ? ` × ${item.quantity}` : ''}`);
    }
    rows.push('');
  }
  if (lead.message) rows.push('Сообщение:', lead.message, '');
  if ((files || []).length > 0) rows.push(`Файлов: ${files.length} — смотрите в карточке заявки.`, '');
  rows.push('Открыть: раздел «Заявки» в CRM.');
  return rows.join('\n');
}

/** Автоответ клиенту: коротко, по делу, с контактами. */
function autoReplyText(lead) {
  const name = String(lead.name || '').trim();
  return [
    `${name}, здравствуйте!`,
    '',
    `Ваша заявка №${lead.id} получена. Менеджер свяжется с вами в рабочее время:`,
    'Пн–Пт, 9:00–18:00 (МСК).',
    '',
    'Если вопрос срочный — позвоните: +7 985 964-11-23.',
    '',
    'ООО «Атланта» — светотехника и электрожгуты для прицепов.',
  ].join('\n');
}

/**
 * Отправить уведомления по заявке.
 *
 * @returns {Promise<{ telegram: object, mail: object|null, autoReply: object|null }>}
 */
async function notifyLead({ lead, items = [], files = [] }) {
  const telegram = await sendToAll(telegramText({ lead, items, files }));

  let mail = null;
  const recipients = adminRecipients();
  if (recipients.length > 0) {
    mail = await sendMail({
      to: recipients,
      subject: `Заявка с сайта №${lead.id} — ${lead.name}`,
      text: mailText({ lead, items, files }),
      replyTo: lead.email || undefined,
    });
  } else if (mailConfigured()) {
    mail = { ok: false, error: 'не задан LEAD_EMAIL_TO' };
  }

  // Автоответ — только если клиент оставил почту и она похожа на адрес
  let autoReply = null;
  const email = String(lead.email || '').trim();
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && mailConfigured()) {
    autoReply = await sendMail({
      to: [email],
      subject: `Заявка №${lead.id} получена — Атланта`,
      text: autoReplyText(lead),
    });
  }

  return { telegram, mail, autoReply };
}

module.exports = { notifyLead, telegramText, mailText, autoReplyText, adminRecipients };
