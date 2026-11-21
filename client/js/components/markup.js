/* Цена позиции: базовая цена + наценка уровня клиента + ручная наценка.
 *
 * В интерфейсе менеджер видит ИТОГОВУЮ цену — ту, что уйдёт клиенту.
 * Хранится при этом базовая: сервер считает итог заново из неё, поэтому
 * округление не «уползает» от правки к правке, а наценку клиента можно
 * включить или выключить в любой момент, не теряя исходную цену.
 *
 * Уровень клиента берётся из карточки клиента (client_pricing_levels.markup_pct).
 * Если наценка отключена — множитель уровня равен 1.
 */
(function () {
  /** Число или 0: пустые строки и мусор не должны ломать расчёт. */
  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function round2(value) {
    return Math.round(num(value) * 100) / 100;
  }

  /** Общий множитель цены: уровень клиента × ручная наценка. */
  function factor(levelPct, manualPct, noLevelMarkup) {
    const level = noLevelMarkup ? 0 : num(levelPct);
    return (1 + level / 100) * (1 + num(manualPct) / 100);
  }

  /** Итоговая цена для клиента из базовой. */
  function toFinal(basePrice, levelPct, manualPct, noLevelMarkup) {
    return round2(num(basePrice) * factor(levelPct, manualPct, noLevelMarkup));
  }

  /** Базовая цена из введённой вручную итоговой. */
  function toBase(finalPrice, levelPct, manualPct, noLevelMarkup) {
    const k = factor(levelPct, manualPct, noLevelMarkup);
    if (!k) return 0;
    return round2(num(finalPrice) / k);
  }

  /** Размер наценки уровня в рублях на единицу — для подсказки в строке. */
  function levelAmount(basePrice, levelPct, noLevelMarkup) {
    const level = noLevelMarkup ? 0 : num(levelPct);
    return round2(num(basePrice) * level / 100);
  }

  window.MarkupMath = { num, round2, factor, toFinal, toBase, levelAmount };
})();
