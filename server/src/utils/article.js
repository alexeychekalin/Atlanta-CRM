/**
 * Полный артикул = базовый артикул + код модификации через дефис.
 *
 * По каталогу АТЛАНТА-26:
 *   А.3776.001 + 01     → А.3776.001-01
 *   А.3776.001 + 02.02  → А.3776.001-02.02
 *   А.3776.001.1-Б + 01 → А.3776.001.1-Б-01
 *
 * Цвет рассеивателя (-Б, -БЖ) и сторона (Л/П) входят в базовый артикул.
 * Комплекты (А.3776.005Л-01/А.3731.007) хранятся как есть, без кода.
 *
 * У семейств, где цвет входит в обозначение через точку (А.3731.023.1-01.00-150),
 * склейка через дефис даст неверный артикул — там печатный артикул приходит
 * третьим аргументом (modification.full_article) и имеет приоритет.
 */
function fullArticle(article, code, printed) {
  const explicit = String(printed === null || printed === undefined ? '' : printed).trim();
  if (explicit) return explicit;

  const base = String(article === null || article === undefined ? '' : article).trim();
  const suffix = String(code === null || code === undefined ? '' : code).trim();
  if (!base) return suffix;
  return suffix ? `${base}-${suffix}` : base;
}

module.exports = { fullArticle };
