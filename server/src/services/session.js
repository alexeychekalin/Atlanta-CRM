/**
 * Срок жизни сессии: сколько живёт токен и когда он продлевается.
 *
 * Раньше срок был зашит в auth.js константой `12h`, и сессия умирала ровно
 * через 12 часов после входа — даже если человек всё это время работал в CRM.
 * Менеджер открывал карточку утром, к вечеру ловил «сессия истекла» посреди
 * работы, а на следующий день начинал с экрана входа.
 *
 * Теперь срок задаётся переменной окружения SESSION_TTL (часы или строка
 * jsonwebtoken: `12h`, `7d`, `30m`) и по умолчанию — 7 суток. Токен продлевается
 * при активности: `/api/auth/me` (клиент зовёт его при каждом открытии CRM,
 * после сна вкладки и при возврате в окно) выдаёт новый со свежим сроком,
 * а cookie при этом остаётся httpOnly — XSS токен не прочитает.
 *
 * Значение проверяем строго: опечатка в .env не должна молча превращаться
 * в «сессия живёт вечно» или в исключение на каждом входе.
 */

const DEFAULT_TTL = '7d';

// jsonwebtoken принимает «число + единица»: 12h, 7d, 30m, 45s. Секунды без
// единицы он трактует как секунды — их тоже допускаем.
const TTL_PATTERN = /^\d+(s|m|h|d|w)?$/i;

/**
 * Разобрать срок из переменной окружения.
 *
 * @param {string} [raw]  значение SESSION_TTL
 * @returns {{ value: string, seconds: number, source: 'env' | 'default' }}
 *          value — для jsonwebtoken, seconds — для cookie maxAge
 * @throws {Error} если значение задано, но не разбирается
 */
function parseSessionTtl(raw = process.env.SESSION_TTL) {
  const text = String(raw ?? '').trim();
  if (!text) {
    return { value: DEFAULT_TTL, seconds: ttlToSeconds(DEFAULT_TTL), source: 'default' };
  }
  if (!TTL_PATTERN.test(text)) {
    throw new Error(
      `SESSION_TTL: «${text}» не разбирается. Укажите часы (12) или срок вида 12h, 7d, 30m.`
    );
  }
  const value = text.toLowerCase();
  const seconds = ttlToSeconds(value);
  if (!(seconds > 0)) {
    throw new Error('SESSION_TTL: срок сессии должен быть больше нуля');
  }
  return { value, seconds, source: 'env' };
}

/** «12h» / «7d» / «30m» / «45» → секунды. Число без единицы — часы. */
function ttlToSeconds(value) {
  const match = /^(\d+)(s|m|h|d|w)?$/i.exec(String(value).trim());
  if (!match) throw new Error(`не разобрать срок «${value}»`);
  const amount = Number(match[1]);
  const unit = (match[2] || 'h').toLowerCase();
  const factors = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60, w: 7 * 24 * 60 * 60 };
  return amount * factors[unit];
}

/** Срок для cookie в миллисекундах — он должен совпадать с TTL токена. */
function cookieMaxAgeMs(seconds) {
  return seconds * 1000;
}

/**
 * Когда продлевать токен: только если с последней выдачи прошло больше
 * SESSION_RENEW_AFTER (по умолчанию — полсрока). Иначе каждый запрос
 * перевыпускал бы токен, и `token_version` переставал бы что-либо значить
 * в глазах пользователя.
 */
function renewThresholdSeconds(ttlSeconds) {
  const raw = String(process.env.SESSION_RENEW_AFTER ?? '').trim();
  if (raw && TTL_PATTERN.test(raw)) {
    const seconds = ttlToSeconds(raw);
    if (seconds > 0 && seconds < ttlSeconds) return seconds;
  }
  return Math.floor(ttlSeconds / 2);
}

module.exports = {
  DEFAULT_TTL,
  parseSessionTtl,
  ttlToSeconds,
  cookieMaxAgeMs,
  renewThresholdSeconds,
};
