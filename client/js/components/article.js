/* Полный артикул = базовый артикул + код модификации через дефис.
 *
 * По каталогу АТЛАНТА-26:
 *   А.3776.001 + 01     → А.3776.001-01
 *   А.3776.001 + 02.02  → А.3776.001-02.02
 *   А.3776.001.1-Б + 01 → А.3776.001.1-Б-01
 *
 * Цвет рассеивателя (-Б, -БЖ) и сторона (Л/П) входят в базовый артикул,
 * код модификации — только то, что в каталоге стоит в скобках.
 * Комплекты (А.3776.005Л-01/А.3731.007) хранятся как есть, без кода.
 *
 * Использование: fullArticle(component.article, modification.code)
 */
(function () {
  function fullArticle(article, code) {
    const base = String(article === null || article === undefined ? '' : article).trim();
    const suffix = String(code === null || code === undefined ? '' : code).trim();
    if (!base) return suffix;
    return suffix ? base + '-' + suffix : base;
  }

  window.fullArticle = fullArticle;
})();
