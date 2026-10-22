/**
 * SQL-фрагменты для сумм по составу чертежа.
 * Используются только для получения базы (subtotal); сама цена считается
 * в `services/drawings.js`, чтобы списки, карточка и журнал совпадали до копейки.
 */

const BOM_SUBTOTAL_SQL = `COALESCE(SUM(
  (COALESCE(cm.price_override, comp.price) * dc.quantity) * (1 + COALESCE(dc.item_markup_pct, 0)/100)
  + COALESCE(dc.item_markup_rub, 0)
), 0)`;

const RAW_BASE_SQL = `COALESCE(SUM(COALESCE(cm.price_override, comp.price) * dc.quantity), 0)`;

module.exports = { BOM_SUBTOTAL_SQL, RAW_BASE_SQL };
