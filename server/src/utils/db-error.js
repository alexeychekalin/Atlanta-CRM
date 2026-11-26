/* Текст ошибки БД для консоли.
 *
 * У драйвера `pg` недоступный сервер приходит как AggregateError с пустым
 * message, и в логе остаётся «Ошибка импорта каталога: » без причины.
 * Здесь подставляем понятное объяснение вместо пустой строки.
 */
function describeDbError(err) {
  if (!err) return 'неизвестная ошибка';

  const message = String(err.message || '').trim();
  if (message) return message;

  const code = err.code || (err.errors && err.errors[0] && err.errors[0].code);
  switch (code) {
    case 'ECONNREFUSED':
      return 'PostgreSQL не отвечает — проверьте, что служба запущена, и DATABASE_URL в server/.env';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'хост базы данных не найден — проверьте DATABASE_URL в server/.env';
    case '28P01':
      return 'неверный пароль пользователя БД — проверьте DATABASE_URL в server/.env';
    case '3D000':
      return 'базы данных нет — создайте её и повторите миграции';
    default:
      break;
  }

  if (code) return `код ошибки ${code}`;
  return String(err);
}

module.exports = { describeDbError };
