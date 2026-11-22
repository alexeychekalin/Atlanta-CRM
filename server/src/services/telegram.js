/**
 * Telegram-уведомления: заявки с сайта приходят администратору в мессенджер.
 *
 * Почему свой HTTP-клиент, а не библиотека. Нужен один запрос — sendMessage
 * к Bot API. Библиотеки telegram-ботов тянут long polling, webhook-сервер и
 * собственный цикл событий: для «отправить текст и картинку» это лишние
 * зависимости, обновления и права в контейнере PM2.
 *
 * Настройка — только через окружение (токен не должен попасть в git):
 *
 *   TELEGRAM_BOT_TOKEN=123456:AA…          токен от @BotFather
 *   TELEGRAM_CHAT_IDS=-1001234567890,1234  через запятую: группа и личка
 *   TELEGRAM_PARSE_MODE=HTML                необязательно, по умолчанию HTML
 *
 * Пустой токен — уведомления выключены: заявка всё равно сохраняется в CRM,
 * в карточке заявки видно «уведомление не отправлено». На стендах и в тестах
 * это нормальное состояние, ронять приём заявок из-за него нельзя.
 */

const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
const TIMEOUT_MS = Number(process.env.TELEGRAM_TIMEOUT_MS) || 8000;
const MAX_LEN = 3800; // у Telegram ограничение 4096, оставляем запас на разметку

/** Список получателей: группа отдела продаж + личка администратора. */
function chatIds(raw = process.env.TELEGRAM_CHAT_IDS) {
  return String(raw || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function isConfigured() {
  return Boolean(String(process.env.TELEGRAM_BOT_TOKEN || '').trim()) && chatIds().length > 0;
}

/** Экранирование для parse_mode=HTML: в тексте заявки бывают < и &. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function trimMessage(text) {
  const value = String(text || '');
  return value.length > MAX_LEN ? `${value.slice(0, MAX_LEN - 1)}…` : value;
}

/**
 * Отправить текст одному получателю.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function sendMessage(chatId, text, options = {}) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' };
  if (!chatId) return { ok: false, error: 'не указан chat_id' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: trimMessage(text),
        parse_mode: options.parseMode || process.env.TELEGRAM_PARSE_MODE || 'HTML',
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      // описание от Telegram («chat not found», «bot was blocked») полезно в логе
      return { ok: false, error: data.description || `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'таймаут' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Отправить всем получателям. Один недоступный чат не должен мешать остальным:
 * админ может выйти из группы, а личка продолжит работать.
 *
 * @returns {Promise<{ ok: boolean, sent: number, failed: Array<{chatId: string, error: string}> }>}
 */
async function sendToAll(text, options = {}) {
  const ids = options.chatIds || chatIds();
  if (!process.env.TELEGRAM_BOT_TOKEN || ids.length === 0) {
    return { ok: false, sent: 0, failed: [], disabled: true };
  }

  const failed = [];
  let sent = 0;
  for (const chatId of ids) {
    const result = await sendMessage(chatId, text, options);
    if (result.ok) sent += 1;
    else failed.push({ chatId, error: result.error });
  }
  return { ok: sent > 0, sent, failed };
}

/** Проверка настроек при старте: в логе сразу видно, уведомления включены или нет. */
function describeConfig() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return 'Telegram: уведомления выключены (нет TELEGRAM_BOT_TOKEN)';
  }
  const ids = chatIds();
  if (ids.length === 0) return 'Telegram: токен есть, но не задан TELEGRAM_CHAT_IDS';
  return `Telegram: уведомления включены, получателей ${ids.length}`;
}

module.exports = {
  chatIds, isConfigured, escapeHtml, trimMessage, sendMessage, sendToAll, describeConfig,
};
