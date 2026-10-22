const test = require('node:test');
const assert = require('node:assert/strict');

const {
  round2,
  isDrawingItem,
  normalizeItem,
  calculateItems,
  calculateVat,
} = require('../src/services/pricing');

test('round2 округляет до копеек', () => {
  assert.equal(round2(1234.567), 1234.57);
  assert.equal(round2('100.5'), 100.5);
  assert.equal(round2(0), 0);
  assert.equal(round2('не число'), 0);
});

test('isDrawingItem распознаёт чертёж по флагу и metadata', () => {
  assert.equal(isDrawingItem({ is_drawing: true }), true);
  assert.equal(isDrawingItem({ is_drawing: 1 }), true);
  assert.equal(isDrawingItem({ metadata: { type: 'calculator_drawing' } }), true);
  assert.equal(isDrawingItem({ metadata: { type: 'product' } }), false);
  assert.equal(isDrawingItem({}), false);
});

test('обычная позиция: базовая цена + уровень клиента + ручная наценка', () => {
  const item = normalizeItem(
    { product_name: 'БК-101', base_price: 1000, markup_pct: 10, quantity: 2 },
    30
  );

  assert.equal(item.base_price, 1000);
  assert.equal(item.level_markup_pct, 30);
  assert.equal(item.markup_pct, 10);
  assert.equal(item.unit_price, 1430); // 1000 * 1.3 * 1.1
  assert.equal(item.line_total, 2860);
  assert.equal(item.quantity, 2);
});

test('чертёж: итоговая цена не облагается наценками', () => {
  const item = normalizeItem(
    {
      product_name: 'Чертёж',
      base_price: 5000,
      markup_pct: 25,
      markup_rub: 300,
      quantity: 1,
      is_drawing: true,
      drawing_id: 7,
      metadata: { type: 'calculator_drawing', grand_total: 5000 },
    },
    30
  );

  assert.equal(item.unit_price, 5000);
  assert.equal(item.level_markup_pct, 0);
  assert.equal(item.markup_pct, 0);
  assert.equal(item.markup_rub, 0);
  assert.equal(item.is_drawing, true);
  assert.equal(item.drawing_id, 7);
});

test('старый клиент без base_price: цена сохраняется как есть', () => {
  const item = normalizeItem({ product_name: 'Старое', unit_price: 999.99, quantity: 3 }, 50);
  assert.equal(item.base_price, 999.99);
  assert.equal(item.unit_price, 999.99);
  assert.equal(item.line_total, 2999.97);
});

test('НДС выделяется из суммы, включающей налог', () => {
  assert.deepEqual(calculateVat(122000, { enabled: true, rate: 22 }), { rate: 22, amount: 22000 });
  assert.deepEqual(calculateVat(1000, { enabled: false, rate: 22 }), { rate: 0, amount: 0 });
  assert.deepEqual(calculateVat(1000, { enabled: true, rate: 0 }), { rate: 0, amount: 0 });
});

test('calculateItems берёт наценку уровня из БД, а не из запроса', async () => {
  const runner = {
    query: async (sql) => {
      assert.match(sql, /FROM clients/);
      return { rows: [{ id: 1, markup_pct: '15.00', level_name: 'Опт' }] };
    },
  };

  const result = await calculateItems(
    1,
    [{ product_name: 'X', base_price: 1000, markup_pct: 10, quantity: 1, level_markup_pct: 999 }],
    runner
  );

  assert.equal(result.level.markupPct, 15);
  assert.equal(result.items[0].level_markup_pct, 15);
  assert.equal(result.items[0].unit_price, 1265); // 1000 * 1.15 * 1.10
  assert.equal(result.subtotal, 1265);
});

test('calculateItems: неизвестный клиент — ошибка 400', async () => {
  const runner = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    () => calculateItems(999, [{ base_price: 1, quantity: 1 }], runner),
    (err) => err.status === 400 && /Клиент не найден/.test(err.message)
  );
});
