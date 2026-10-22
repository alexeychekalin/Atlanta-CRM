const test = require('node:test');
const assert = require('node:assert');
const { calculateDrawingPrice, resolveLevelMarkup, resolveFixedPrice } = require('../src/services/drawings');

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
