const DEFAULT_VAT = { enabled: true, rate: 22 };

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isDrawingItem(item) {
  if (item.is_drawing === true || item.is_drawing === 'true' || item.is_drawing === 1) return true;
  const type = item.metadata && item.metadata.type;
  return typeof type === 'string' && type.startsWith('calculator');
}

/**
 * Наценка уровня клиента берётся из БД — клиентское значение игнорируется.
 */
async function getClientLevelMarkup(clientId, runner = null) {
  const database = runner || require('../db');
  const result = await database.query(
    `SELECT c.id, cpl.markup_pct, cpl.name AS level_name
     FROM clients c
     LEFT JOIN client_pricing_levels cpl ON c.pricing_level_id = cpl.id
     WHERE c.id = $1`,
    [clientId]
  );
  if (result.rows.length === 0) return null;
  return {
    markupPct: Number(result.rows[0].markup_pct) || 0,
    levelName: result.rows[0].level_name || '',
  };
}

async function getVatSettings(runner = null) {
  const database = runner || require('../db');
  try {
    const result = await database.query("SELECT value FROM system_settings WHERE key = 'vat'");
    if (result.rows.length === 0) return { ...DEFAULT_VAT };
    const value = result.rows[0].value || {};
    return {
      enabled: value.enabled !== false,
      rate: Number(value.rate) >= 0 ? Number(value.rate) : DEFAULT_VAT.rate,
    };
  } catch {
    return { ...DEFAULT_VAT };
  }
}

/**
 * Считает позицию документа. Базовая цена и ручная наценка приходят с клиента,
 * наценка уровня клиента всегда берётся из БД.
 */
function normalizeItem(item, levelMarkupPct) {
  const quantity = Number(item.quantity) || 1;
  const isDrawing = isDrawingItem(item);

  const hasBasePrice = item.base_price !== undefined && item.base_price !== null && item.base_price !== '';
  const basePrice = hasBasePrice ? round2(item.base_price) : round2(item.unit_price);
  const markupPct = isDrawing ? 0 : (Number(item.markup_pct) || 0);
  const markupRub = isDrawing ? 0 : round2(item.markup_rub);

  // Для чертежей цена уже итоговая (внутри неё наценки калькулятора)
  const appliedLevel = isDrawing ? 0 : levelMarkupPct;
  const unitPrice = hasBasePrice
    ? round2(basePrice * (1 + appliedLevel / 100) * (1 + markupPct / 100) + markupRub)
    : round2(item.unit_price); // старый клиент/API: цена уже итоговая

  return {
    product_id: item.product_id || null,
    product_name: String(item.product_name || '').slice(0, 255),
    description: item.description || null,
    quantity,
    base_price: basePrice,
    markup_pct: markupPct,
    markup_rub: markupRub,
    level_markup_pct: appliedLevel,
    unit_price: unitPrice,
    line_total: round2(unitPrice * quantity),
    is_drawing: isDrawing,
    drawing_id: item.drawing_id || null,
    image_path: item.image_path || null,
    metadata: item.metadata || null,
  };
}

async function calculateItems(clientId, items, runner = null) {
  const level = await getClientLevelMarkup(clientId, runner);
  if (!level) {
    const error = new Error('Клиент не найден');
    error.status = 400;
    throw error;
  }

  const normalized = items.map(item => normalizeItem(item, level.markupPct));
  const subtotal = round2(normalized.reduce((sum, item) => sum + item.line_total, 0));
  return { level, items: normalized, subtotal };
}

/**
 * Цены в системе хранятся БЕЗ НДС. НДС начисляется сверху:
 *   vat_amount = subtotal × rate / 100
 *   total_with_vat = subtotal + vat_amount
 * Настройка `enabled` управляет только отображением («показывать с НДС»),
 * в документе ставка и сумма фиксируются всегда, когда ставка > 0.
 */
function calculateVat(subtotal, vatSettings) {
  const base = round2(subtotal);
  const rate = vatSettings ? (Number(vatSettings.rate) || 0) : 0;
  if (rate <= 0) {
    return { rate: 0, amount: 0, totalWithVat: base };
  }
  const amount = round2(base * rate / 100);
  return { rate, amount, totalWithVat: round2(base + amount) };
}

module.exports = {
  round2,
  isDrawingItem,
  getClientLevelMarkup,
  getVatSettings,
  calculateItems,
  calculateVat,
  normalizeItem,
};
