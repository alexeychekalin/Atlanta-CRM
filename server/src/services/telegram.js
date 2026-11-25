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

/**
 * Значение переменной без кавычек и пробелов.
 *
 * Самая частая причина «вписал токен, а уведомления не приходят» — токен
 * скопирован в .env вместе с кавычками (`TELEGRAM_BOT_TOKEN="123:AA…"`):
 * dotenv оставляет кавычки частью значения, и Telegram отвечает 404.
 */
function clean(value) {
  return String(value ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

/** Токен бота: чистим от кавычек и пробелов. */
function botToken() {
  return clean(process.env.TELEGRAM_BOT_TOKEN);
}

/** Список получателей: группа отдела продаж + личка администратора. */
function chatIds(raw = process.env.TELEGRAM_CHAT_IDS) {
  return String(raw || '')
    .split(',')
    .map(value => clean(value))
    .filter(Boolean);
}

function isConfigured() {
  return Boolean(botToken()) && chatIds().length > 0;
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
  const token = botToken();
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
      return { ok: false, error: explainError(data.description, chatId, response.status) };
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
  if (!botToken() || ids.length === 0) {
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

/**
 * Подсказка к ответу Telegram: администратор видит её в карточке заявки,
 * поэтому «chat not found» расшифровываем действием, а не кодом ошибки.
 */
function explainError(description, chatId = '', status = 0) {
  const text = String(description || '');
  if (/chat not found/i.test(text)) {
    return `чат ${chatId} не найден: бот не добавлен в группу или chat_id указан `
      + 'неверно (у супергруппы id начинается с -100, у личного чата — просто число)';
  }
  if (/bot was blocked|user is deactivated|bot can't initiate/i.test(text)) {
    return `бот заблокирован получателем ${chatId}: напишите боту /start`;
  }
  if (/not enough rights|have no rights/i.test(text)) {
    return `у бота нет прав писать в чат ${chatId}: сделайте его участником или админом`;
  }
  if (/unauthorized/i.test(text) || status === 404) {
    return 'неверный TELEGRAM_BOT_TOKEN: скопируйте токен заново у @BotFather';
  }
  return text || `HTTP ${status}`;
}

/**
 * Проблемы в настройках, которые видно ещё до отправки заявки.
 * Пустой массив — настройки в порядке.
 */
function configProblems() {
  const problems = [];
  const raw = String(process.env.TELEGRAM_BOT_TOKEN ?? '');
  const token = botToken();

  if (!token) {
    problems.push('не задан TELEGRAM_BOT_TOKEN — уведомления выключены');
    return problems;
  }
  if (raw !== raw.trim() || raw !== token) {
    problems.push('в TELEGRAM_BOT_TOKEN попали кавычки или пробелы — уберите их');
  }
  if (!/^\d{6,}:[\w-]{30,}$/.test(token)) {
    problems.push('TELEGRAM_BOT_TOKEN не похож на токен от @BotFather (вида 123456789:AA…)');
  }

  const ids = chatIds();
  if (ids.length === 0) {
    problems.push('не задан TELEGRAM_CHAT_IDS — некуда отправлять заявки');
    return problems;
  }
  for (const id of ids) {
    if (/^-\d+$/.test(id)) continue; // группа/супергруппа
    if (/^\d+$/.test(id)) continue; // личный чат
    problems.push(`TELEGRAM_CHAT_IDS: «${id}» не похож на chat_id — нужно число, у группы с -100`);
  }
  return problems;
}

/** Проверка настроек при старте: в логе сразу видно, уведомления включены или нет. */
function describeConfig() {
  if (!botToken()) {
    return 'Telegram: уведомления выключены (нет TELEGRAM_BOT_TOKEN)';
  }
  const ids = chatIds();
  if (ids.length === 0) return 'Telegram: токен есть, но не задан TELEGRAM_CHAT_IDS';
  const problems = configProblems();
  if (problems.length > 0) {
    return `Telegram: настройки с ошибкой — ${problems.join('; ')}`;
  }
  return `Telegram: уведомления включены, получателей ${ids.length}`;
}

module.exports = {
  chatIds, botToken, isConfigured, escapeHtml, trimMessage, sendMessage, sendToAll,
  describeConfig, configProblems, explainError,
};
