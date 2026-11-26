const test = require('node:test');
const assert = require('node:assert');
const {
  calculateDrawingPrice,
  drawingListCosts,
  resolveLevelMarkup,
  resolveFixedPrice,
  priceForClient,
  parseFixedPriceInput,
  bomSubtotalFromRows,
} = require('../src/services/drawings');

test('цена чертежа: наценка уровня клиента считается сверху', () => {
  const price = calculateDrawingPrice({
    subtotal: 13610,
    fixedPrice: null,
    levelMarkupPct: 30,
    globalMarkupPct: 5,
    globalMarkupRub: 100,
  });

  assert.equal(price.levelMarkupAmount, 4083);
  assert.equal(price.globalMarkupPctAmount, 884.65);
  assert.equal(price.total, 18677.65);
});

test('цена чертежа: один BOM — разная цена у клиентов разных уровней', () => {
  const base = { subtotal: 13610, fixedPrice: null, globalMarkupPct: 0, globalMarkupRub: 0 };
  const opt = calculateDrawingPrice({ ...base, levelMarkupPct: 15 });
  const retail = calculateDrawingPrice({ ...base, levelMarkupPct: 30 });
  const wholesale = calculateDrawingPrice({ ...base, levelMarkupPct: 5 });

  assert.equal(opt.total, 15651.5);
  assert.equal(retail.total, 17693);
  assert.equal(wholesale.total, 14290.5);
});

test('цена чертежа: фиксированная цена важнее наценок', () => {
  const price = calculateDrawingPrice({
    subtotal: 5000,
    fixedPrice: 48500,
    levelMarkupPct: 30,
    globalMarkupPct: 10,
    globalMarkupRub: 1000,
  });

  assert.equal(price.total, 48500);
  assert.equal(price.levelMarkupPct, 0);
});

test('цена без BOM: фикс-цена становится базовой, наценок нет', () => {
  // Состав пуст — база и итог совпадают, иначе в списке чертежей «Базовая цена»
  // показывала бы 0, а вся сумма висела в колонке «Стоимость с наценкой».
  const price = calculateDrawingPrice({
    subtotal: 0,
    fixedPrice: 48500,
    levelMarkupPct: 30,
    globalMarkupPct: 10,
    globalMarkupRub: 1000,
  });

  assert.equal(price.subtotal, 48500, 'база — это фикс-цена');
  assert.equal(price.total, 48500);
  assert.equal(price.fixedPrice, 48500);
  assert.equal(price.fixedWithoutBom, true);
  assert.equal(price.levelMarkupPct, 0);
  assert.equal(price.globalMarkupPct, 0);
  assert.equal(price.globalMarkupRub, 0);
});

test('цена с составом: база остаётся суммой BOM, фикс-цена не попадает в базу', () => {
  const price = calculateDrawingPrice({ subtotal: 5000, fixedPrice: 48500 });

  assert.equal(price.subtotal, 5000);
  assert.equal(price.total, 48500);
  assert.equal(price.fixedWithoutBom, false);
});

test('расчёт по BOM помечает fixedWithoutBom = false', () => {
  const price = calculateDrawingPrice({ subtotal: 13610, fixedPrice: null, levelMarkupPct: 15 });

  assert.equal(price.fixedWithoutBom, false);
  assert.equal(price.subtotal, 13610);
});

test('priceForClient: клиент с ценой без BOM получает базу = фикс-цене', () => {
  const drawing = { id: 1, client_id: 7, fixed_price: null, global_markup_pct: 0, global_markup_rub: 0 };
  const link = { client_id: 7, fixed_price: 12000, markup_pct: 20, level_markup_pct: 30 };

  const price = priceForClient({ drawing, link, subtotal: 0 });

  assert.equal(price.subtotal, 12000);
  assert.equal(price.total, 12000);
  assert.equal(price.fixedWithoutBom, true);
});

test('наценка связи клиента переопределяет уровень цен и снимок чертежа', () => {
  const base = { clientLevelPct: 30, drawingLevelPct: 15 };

  assert.equal(resolveLevelMarkup({ linkMarkupPct: 12, ...base }), 12);
  assert.equal(resolveLevelMarkup({ linkMarkupPct: null, ...base }), 30);
  assert.equal(resolveLevelMarkup({ linkMarkupPct: null, clientLevelPct: null, drawingLevelPct: 15 }), 15);
  assert.equal(resolveLevelMarkup({ linkMarkupPct: null, clientLevelPct: null, drawingLevelPct: null }), 0);
});

test('фикс-цена: у клиента своя, иначе действует общая цена чертежа', () => {
  assert.equal(resolveFixedPrice({ linkFixedPrice: 52000, drawingFixedPrice: 48500 }), 52000);
  assert.equal(resolveFixedPrice({ linkFixedPrice: null, drawingFixedPrice: 48500 }), 48500);
  assert.equal(resolveFixedPrice({ linkFixedPrice: '', drawingFixedPrice: '48500' }), 48500);
  assert.equal(resolveFixedPrice({ linkFixedPrice: 0, drawingFixedPrice: null }), null);
  assert.equal(resolveFixedPrice({}), null);
});

test('фикс-цена клиента важнее уровня цен и наценок', () => {
  const common = { subtotal: 13610, globalMarkupPct: 5, globalMarkupRub: 100 };

  const clientA = calculateDrawingPrice({
    ...common,
    fixedPrice: resolveFixedPrice({ linkFixedPrice: 52000, drawingFixedPrice: 48500 }),
    levelMarkupPct: 30,
  });
  const clientB = calculateDrawingPrice({
    ...common,
    fixedPrice: resolveFixedPrice({ linkFixedPrice: null, drawingFixedPrice: 48500 }),
    levelMarkupPct: 15,
  });
  const clientC = calculateDrawingPrice({
    subtotal: 13610,
    fixedPrice: resolveFixedPrice({}),
    levelMarkupPct: 5,
    globalMarkupPct: 0,
    globalMarkupRub: 0,
  });

  assert.equal(clientA.total, 52000);
  assert.equal(clientB.total, 48500);
  assert.equal(clientC.total, 14290.5);
});

test('priceForClient: цена связи важнее цены чертежа и уровня', () => {
  const drawing = { fixed_price: 40000, level_markup_pct: 10, global_markup_pct: 0, global_markup_rub: 0 };

  const ownFixed = priceForClient({
    drawing,
    link: { fixed_price: 52000, markup_pct: null, level_markup_pct: 30 },
    subtotal: 13610,
  });
  const fallbackToDrawing = priceForClient({
    drawing,
    link: { fixed_price: null, markup_pct: null, level_markup_pct: 30 },
    subtotal: 13610,
  });
  const byLevel = priceForClient({
    drawing: { ...drawing, fixed_price: null },
    link: { fixed_price: null, markup_pct: null, level_markup_pct: 15 },
    subtotal: 13610,
  });

  assert.equal(ownFixed.total, 52000);
  assert.equal(fallbackToDrawing.total, 40000);
  assert.equal(byLevel.total, 15651.5);
});

test('parseFixedPriceInput: отличает «не трогать», «очистить» и ошибку', () => {
  assert.deepEqual(parseFixedPriceInput(undefined), { provided: false, value: null });
  assert.deepEqual(parseFixedPriceInput(null), { provided: true, value: null });
  assert.deepEqual(parseFixedPriceInput(''), { provided: true, value: null });
  assert.deepEqual(parseFixedPriceInput('12345.678'), { provided: true, value: 12345.68 });
  assert.equal(parseFixedPriceInput(0).error, 'Фиксированная цена должна быть больше нуля');
  assert.equal(parseFixedPriceInput(-5).error, 'Фиксированная цена должна быть больше нуля');
  assert.ok(parseFixedPriceInput('abc').error);
});

test('bomSubtotalFromRows: сумма строк с наценками совпадает с расчётом в SQL', () => {
  const subtotal = bomSubtotalFromRows([
    { price: '1850', quantity: '2', item_markup_pct: '10', item_markup_rub: '100' },
    { modification_price: '500', price: '400', quantity: '1', item_markup_pct: '0', item_markup_rub: '0' },
  ]);

  // 1850*2*1.1 + 100 + 500 = 4670
  assert.equal(subtotal, 4670);
});

test('списки чертежей: база и итог для чертежа с составом', () => {
  const price = calculateDrawingPrice({ subtotal: 4670, fixedPrice: null, levelMarkupPct: 15 });
  const costs = drawingListCosts({ rawBase: 4200, subtotal: 4670, price });

  assert.equal(costs.base_cost, 4200, 'база — сумма компонентов без наценок');
  assert.equal(costs.total_cost, price.total);
  assert.equal(costs.fixed_without_bom, false);
});

test('списки чертежей: цена без BOM лежит в базовой колонке, наценка нулевая', () => {
  const price = calculateDrawingPrice({ subtotal: 0, fixedPrice: 48500, levelMarkupPct: 30 });
  const costs = drawingListCosts({ rawBase: 0, subtotal: 0, price });

  assert.equal(costs.base_cost, 48500, 'базовая цена = фикс-цена');
  assert.equal(costs.total_cost, 48500, 'стоимость с наценкой = та же сумма');
  assert.equal(costs.base_cost, costs.total_cost, 'наценки нет');
  assert.equal(costs.fixed_without_bom, true);
});

test('списки чертежей: чертёж без состава и без цены остаётся нулевым', () => {
  const price = calculateDrawingPrice({ subtotal: 0, fixedPrice: null });
  const costs = drawingListCosts({ rawBase: 0, subtotal: 0, price });

  assert.equal(costs.base_cost, 0);
  assert.equal(costs.total_cost, 0);
  assert.equal(costs.fixed_without_bom, false);
});
