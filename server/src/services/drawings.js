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

function toPositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return round2(number);
}

/**
 * Разбор фикс-цены из тела запроса.
 * `provided` — поле вообще пришло (нужно, чтобы отличить «не трогать» от «очистить»).
 * `error` — значение задано, но некорректно (0, отрицательное, не число).
 */
function parseFixedPriceInput(value) {
  if (value === undefined) return { provided: false, value: null };
  if (value === null || value === '') return { provided: true, value: null };
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return { provided: true, value: null, error: 'Фиксированная цена должна быть больше нуля' };
  }
  return { provided: true, value: round2(number) };
}

/**
 * Фиксированная цена: у клиента своя, если задана; иначе — общая у чертежа.
 * `null` означает «считать по BOM».
 */
function resolveFixedPrice({ linkFixedPrice, drawingFixedPrice }) {
  const link = toPositiveNumber(linkFixedPrice);
  if (link !== null) return link;
  return toPositiveNumber(drawingFixedPrice);
}

/**
 * Цена чертежа для конкретного клиента — единственная точка расчёта для API.
 * Приоритет: фикс-цена связи → фикс-цена чертежа (legacy) → уровень/наценка связи → общая наценка.
 */
function priceForClient({ drawing = {}, link = null, subtotal = 0, fixedPrice }) {
  return calculateDrawingPrice({
    subtotal,
    fixedPrice: fixedPrice !== undefined
      ? toPositiveNumber(fixedPrice)
      : resolveFixedPrice({
        linkFixedPrice: link ? link.fixed_price : null,
        drawingFixedPrice: drawing.fixed_price,
      }),
    levelMarkupPct: resolveLevelMarkup({
      linkMarkupPct: link ? link.markup_pct : null,
      clientLevelPct: link ? link.level_markup_pct : null,
      drawingLevelPct: drawing.level_markup_pct,
    }),
    globalMarkupPct: drawing.global_markup_pct,
    globalMarkupRub: drawing.global_markup_rub,
  });
}

/** Сумма BOM с наценками позиций по строкам состава. */
function bomSubtotalFromRows(rows = []) {
  return round2(rows.reduce((sum, row) => {
    const price = row.modification_price !== null && row.modification_price !== undefined
      ? parseFloat(row.modification_price) : parseFloat(row.price);
    const base = price * parseFloat(row.quantity);
    return sum + base + base * (parseFloat(row.item_markup_pct) || 0) / 100
      + (parseFloat(row.item_markup_rub) || 0);
  }, 0));
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

module.exports = {
  round2,
  calculateDrawingPrice,
  resolveLevelMarkup,
  resolveFixedPrice,
  priceForClient,
  bomSubtotalFromRows,
  parseFixedPriceInput,
};
