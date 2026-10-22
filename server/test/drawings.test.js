const test = require('node:test');
const assert = require('node:assert');
const { calculateDrawingPrice, resolveLevelMarkup } = require('../src/services/drawings');

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
