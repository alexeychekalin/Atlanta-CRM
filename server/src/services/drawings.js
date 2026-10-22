/**
 * Расчёт цены чертежа для конкретного клиента.
 *
 * Один чертёж (BOM) может быть привязан к нескольким клиентам. Стоимость
 * отличается уровнем цен клиента и ручной наценкой связи (drawing_clients).
 * Формула повторяет SQL-выражение в списках чертежей, чтобы цифры совпадали.
 */

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * @param {object} params
 * @param {number} params.subtotal      сумма BOM с наценками позиций (без уровня и общей)
 * @param {number|null} params.fixedPrice
 * @param {number} params.levelMarkupPct наценка уровня цен клиента
 * @param {number} params.globalMarkupPct
 * @param {number} params.globalMarkupRub
 */
function calculateDrawingPrice({ subtotal, fixedPrice, levelMarkupPct, globalMarkupPct, globalMarkupRub }) {
  const base = round2(subtotal);

  if (fixedPrice !== null && fixedPrice !== undefined && Number(fixedPrice) > 0) {
    const fixed = round2(fixedPrice);
    return {
      subtotal: base,
      levelMarkupPct: 0,
      levelMarkupAmount: 0,
      globalMarkupPct: 0,
      globalMarkupRub: 0,
      fixedPrice: fixed,
      total: fixed,
    };
  }

  const levelPct = round2(levelMarkupPct);
  const levelAmount = round2(base * levelPct / 100);
  const afterLevel = round2(base + levelAmount);

  const globalPct = round2(globalMarkupPct);
  const globalPctAmount = round2(afterLevel * globalPct / 100);
  const globalRub = round2(globalMarkupRub);

  return {
    subtotal: base,
    levelMarkupPct: levelPct,
    levelMarkupAmount: levelAmount,
    globalMarkupPct: globalPct,
    globalMarkupRub: globalRub,
    globalMarkupPctAmount: globalPctAmount,
    fixedPrice: null,
    total: round2(afterLevel + globalPctAmount + globalRub),
  };
}

/** Наценка связи клиента: ручная переопределяет уровень цен. */
function resolveLevelMarkup({ linkMarkupPct, clientLevelPct, drawingLevelPct }) {
  for (const candidate of [linkMarkupPct, clientLevelPct, drawingLevelPct]) {
    if (candidate !== null && candidate !== undefined && candidate !== '') {
      return Number(candidate) || 0;
    }
  }
  return 0;
}

module.exports = { round2, calculateDrawingPrice, resolveLevelMarkup };
