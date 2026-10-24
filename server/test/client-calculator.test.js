const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { calculateDrawingPrice } = require('../src/services/drawings');

const calculators = new Map();

function element(value = '') {
  return {
    value,
    checked: false,
    innerHTML: '',
    style: {},
    parentElement: null,
    insertAdjacentElement(position, node) { this.parentElement = this; return node; },
  };
}

/** Мини-DOM: только те id, которые трогает калькулятор. */
function createDocument(initial = {}) {
  const nodes = { ...initial };
  return {
    nodes,
    getElementById(id) { return nodes[id] || null; },
    createElement() { return element(); },
  };
}

function loadCalculator({ document, api }) {
  const sandbox = {
    window: {},
    console,
    document,
    API: api,
    Table: { formatMoney: v => `${Number(v).toFixed(2)} ₽`, formatMoneyRaw: v => Number(v).toFixed(2) },
    Toast: { error: msg => { sandbox.lastError = msg; }, success: () => {}, info: () => {} },
    Modal: { open: () => {}, close: () => {} },
    ConfirmDialog: { delete: async () => true },
    App: { navigateTo: () => {} },
    prompt: () => 'Тест',
    lastError: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../../client/js/pages/calculator.js'), 'utf8') + '\n;globalThis.CalculatorPage = CalculatorPage;',
    sandbox
  );
  calculators.set('page', sandbox.CalculatorPage);
  return sandbox;
}

test('калькулятор: фикс-цена берётся из связи выбранного клиента', async () => {
  const document = createDocument({
    'calc-fixed-price-toggle': element(),
    'calc-fixed-price': element(''),
    'calc-fixed-price-block': element(),
    'calc-bom-totals': element(),
    'calc-total': element(),
    'calc-client': element('5'),
  });
  const drawing = {
    id: 2,
    clients: [
      { client_id: 3, price: { total: 10402.6, fixedPrice: null } },
      { client_id: 5, price: { total: 12345, fixedPrice: 12345 } },
    ],
  };
  const sandbox = loadCalculator({ document, api: { get: async () => drawing } });
  const page = sandbox.CalculatorPage;
  page.currentDrawingId = 2;

  await page.applyClientPricing(5, drawing);

  assert.equal(page.currentClientPrice.total, 12345);
  assert.equal(document.getElementById('calc-fixed-price-toggle').checked, true);
  assert.equal(document.getElementById('calc-fixed-price').value, 12345);
});

test('калькулятор: без клиента чертёж не сохраняется', async () => {
  const document = createDocument({
    'calc-client': element(''),
    'calc-fixed-price-toggle': element(),
  });
  const sandbox = loadCalculator({ document, api: { get: async () => ({}) } });
  sandbox.CalculatorPage.bomItems = [{ price: 100, quantity: 1, item_markup_pct: 0, item_markup_rub: 0 }];
  const result = await sandbox.CalculatorPage.saveAsDrawing('Тест');

  assert.equal(result, null);
  assert.match(sandbox.lastError, /без клиента/);
});

test('калькулятор: итог совпадает с серверным расчётом до копейки', () => {
  const document = createDocument({
    'calc-client': element('3'),
    'calc-fixed-price-toggle': element(),
    'calc-bom-totals': element(),
    'calc-base': element(),
    'calc-item-markup': element(),
    'calc-subtotal': element(),
    'calc-total': element(),
    'calc-markup-pct': element('5'),
    'calc-markup-rub': element('100'),
    'calc-client-level': element(),
    'calc-level-markup': element(),
  });
  document.getElementById('calc-client').selectedOptions = [{ dataset: { markup: '30', level: 'Розница' } }];

  const { CalculatorPage: page } = loadCalculator({ document, api: { get: async () => ({}) } });
  page.bomItems = [
    { price: 1850.55, quantity: 3, item_markup_pct: 7.5, item_markup_rub: 25 },
    { price: 999.99, quantity: 1, item_markup_pct: 0, item_markup_rub: 0 },
  ];

  page.recalc();

  const server = calculateDrawingPrice({
    subtotal: 1850.55 * 3 * 1.075 + 25 + 999.99,
    fixedPrice: null,
    levelMarkupPct: 30,
    globalMarkupPct: 5,
    globalMarkupRub: 100,
  });

  assert.equal(document.getElementById('calc-total').innerHTML, `${server.total.toFixed(2)} ₽`);
});

test('калькулятор: загрузка общего BOM не перетирает выбранного клиента', async () => {
  const document = createDocument({
    'calc-client': element('5'),
    'calc-template': element(),
    'calc-drawing-path': element(),
    'calc-drawing-type': element(),
    'calc-drawing-preview': element(),
    'calc-markup-pct': element('0'),
    'calc-markup-rub': element('0'),
    'calc-fixed-price-toggle': element(),
    'calc-fixed-price': element(''),
    'calc-fixed-price-block': element(),
    'calc-bom-totals': element(),
    'calc-total': element(),
    'calc-client-level': element(),
  });
  const drawing = {
    id: 2,
    name: 'Общий BOM',
    client_id: 2,
    file_path: null,
    components: [],
    clients: [
      { client_id: 2, price: { total: 10402.6, fixedPrice: null } },
      { client_id: 5, price: { total: 12345, fixedPrice: 12345 } },
    ],
  };
  const sandbox = loadCalculator({ document, api: { get: async () => drawing } });
  const page = sandbox.CalculatorPage;
  page.renderBom = () => {};
  page.recalc = () => {};

  await page.loadTemplate(2);

  assert.equal(document.getElementById('calc-client').value, '5');
  assert.equal(page.currentClientPrice.total, 12345);
  assert.equal(document.getElementById('calc-fixed-price').value, 12345);
});

test('калькулятор: заказ создаётся по цене клиента, а не по локальному расчёту', async () => {
  const document = createDocument({
    'calc-client': element('5'),
    'calc-principal': element('1'),
    'calc-markup-pct': element('5'),
    'calc-markup-rub': element('100'),
    'calc-fixed-price-toggle': element(),
  });
  let orderPayload = null;
  const api = {
    get: async url => {
      if (url.startsWith('/drawings/2/price')) return { total: 12345, fixedPrice: 12345 };
      return {};
    },
    post: async (url, body) => {
      if (url === '/orders') orderPayload = body;
      return {};
    },
  };
  document.getElementById('calc-client').selectedOptions = [{ dataset: { markup: '0' } }];
  const sandbox = loadCalculator({ document, api });
  const page = sandbox.CalculatorPage;
  page.bomItems = [{ price: 100, quantity: 1, item_markup_pct: 0, item_markup_rub: 0 }];
  page.saveAsDrawing = async () => ({ id: 2 });

  await page.saveAsOrder();

  assert.ok(orderPayload);
  assert.equal(orderPayload.items[0].unit_price, 12345);
  assert.equal(orderPayload.items[0].metadata.grand_total, 12345);
  assert.equal(orderPayload.items[0].metadata.client_id, 5);
});
