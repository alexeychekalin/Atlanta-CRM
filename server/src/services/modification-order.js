/**
 * Порядок исполнений в карточке компонента и калькуляторе.
 *
 * Менеджеру нужны ходовые исполнения наверху: у габаритного фонаря их 69,
 * и искать «тот самый» в алфавитном списке долго. Частота берётся из
 * фактического применения — сколько раз исполнение стоит в чертежах клиентов
 * и в изделиях изготовителя. Фотографии исполнения применением не считаются.
 *
 * Порядок такой:
 *   1) usage_count — кто чаще применяется;
 *   2) sort_order — ручной порядок из карточки;
 *   3) код — чтобы список был устойчивым при равных частоте и порядке.
 *
 * Частота первична намеренно. Ручной sort_order у импортированных исполнений
 * идёт подряд (0, 1, 2, …), и если поставить его первым, он перекрыл бы
 * частоту целиком — «ходовые наверх» перестало бы работать. А как раз
 * у подавляющего большинства исполнений применение нулевое, и там порядок
 * задаёт именно sort_order: исполнения из чертежа идут в порядке таблицы,
 * а не по алфавиту кодов.
 *
 * Запрос один на список: агрегат по двум таблицам считается по индексу
 * modification_id (миграция migration_component_modifications_usage.sql),
 * а не по всей таблице чертежей.
 */

/** Считает применённое количество по двум источникам: чертежи и изделия. */
const USAGE_SUBQUERY = `
  (
    (SELECT COALESCE(SUM(dc.quantity), 0)
       FROM drawing_components dc
      WHERE dc.modification_id = cm.id)
    +
    (SELECT COALESCE(SUM(mpc.quantity), 0)
       FROM manufacturer_product_components mpc
      WHERE mpc.modification_id = cm.id)
  )`;

/** Выражение «сколько раз применено» для конкретного алиаса. */
function usageExpr(alias = 'cm') {
  return `(${USAGE_SUBQUERY.replace(/\bcm\b/g, alias)})::int`;
}

/**
 * Колонка usage_count для SELECT списка модификаций.
 * @param {string} alias алиас таблицы component_modifications
 */
function usageColumn(alias = 'cm') {
  return `${usageExpr(alias)} AS usage_count`;
}

/**
 * ORDER BY для списка модификаций — ходовые выше, ручной порядок главнее.
 *
 * Выражение, а не ссылка на псевдоним usage_count: тот же порядок нужен
 * и внутри json_agg, где колонки usage_count в выборке нет.
 * @param {string} alias алиас таблицы component_modifications
 */
function usageOrder(alias = 'cm') {
  return `${usageExpr(alias)} DESC, ${alias}.sort_order, ${alias}.code`;
}

module.exports = { usageColumn, usageOrder, usageExpr, USAGE_SUBQUERY };
