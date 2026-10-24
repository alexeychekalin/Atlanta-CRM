const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const clientDir = path.join(__dirname, '../../client/js');

/** Загружает клиентский модуль в песочницу с минимальными заглушками. */
function loadDrawingsPage(overrides = {}) {
  const sandbox = {
    window: {},
    console,
    document: { getElementById: () => null },
    Table: {
      formatMoney: v => `${Number(v).toFixed(2)} ₽`,
      formatMoneyRaw: v => Number(v).toFixed(2),
      loading: () => '',
      emptyState: () => '',
    },
    API: { can: () => true, isAdmin: () => true, get: async () => ({}), ...overrides.api },
    Toast: { error: () => {}, success: () => {}, info: () => {} },
    Modal: { open: () => {}, close: () => {} },
    ConfirmDialog: { delete: async () => true },
    App: { navigateTo: () => {} },
    ...overrides.globals,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(clientDir, 'components/escape.js'), 'utf8'), sandbox);
  // В браузере helpers висят на window и доступны как глобальные
  sandbox.esc = sandbox.window.esc;
  sandbox.safeUrl = sandbox.window.safeUrl;
  vm.runInContext(
    fs.readFileSync(path.join(clientDir, 'pages/drawings.js'), 'utf8') + '\n;globalThis.DrawingsPage = DrawingsPage;',
    sandbox
  );
  return { page: sandbox.DrawingsPage, sandbox, esc: sandbox.window.esc };
}

test('группировка: общий BOM попадает к каждому клиенту со своей ценой', () => {
  const { page } = loadDrawingsPage();
  page.clients = [{ id: 3, name: 'Ромашка' }, { id: 5, name: 'АгроТрак' }];
  page.viewMode = 'grid';

  const drawings = [
    {
      id: 1, name: 'Общий BOM', client_id: 3, client_ids: [3, 5], components_count: 2,
      base_cost: 1000, total_cost: 1150, client_prices: [
        { client_id: 3, price: { total: 1150 } },
        { client_id: 5, price: { total: 1300 } },
      ],
    },
    {
      id: 2, name: 'Только Ромашка', client_id: 3, client_ids: [3], components_count: 1,
      base_cost: 500, total_cost: 575, client_prices: [{ client_id: 3, price: { total: 575 } }],
    },
  ];

  const container = { innerHTML: '' };
  page.renderGrouped(drawings, container);

  assert.match(container.innerHTML, /Ромашка/);
  assert.match(container.innerHTML, /АгроТрак/);
  // Суммы групп: 1150 + 575 у Ромашки, 1300 у АгроТрака
  assert.match(container.innerHTML, /1725\.00/);
  assert.match(container.innerHTML, /1300\.00/);
});

test('карточка: имя клиента с кавычками не попадает в inline-onclick', async () => {
  const evilName = "ООО 'Ромашка'); alert(document.cookie);//";
  const drawing = {
    id: 2,
    name: 'BOM',
    description: '',
    client_id: 3,
    client_name: evilName,
    fixed_price: null,
    level_markup_pct: 0,
    global_markup_pct: 0,
    global_markup_rub: 0,
    archived_at: null,
    components: [],
    clients: [{
      id: 1, client_id: 3, client_name: evilName, markup_pct: null, markup_rub: 0,
      fixed_price: null, pricing_level_name: null, price: { total: 100, fixedPrice: null },
    }],
    price: { total: 100 },
  };

  let modal = null;
  const { page } = loadDrawingsPage({
    api: { get: async () => drawing },
    globals: { Modal: { open: options => { modal = options; }, close: () => {} } },
  });
  page.clients = [{ id: 3, name: evilName }];

  await page.openDrawingModal(2);

  // В обработчике остаются только числа: никаких пользовательских строк
  const unlinkCall = modal.body.match(/unlinkClient\([^)]*\)/)[0];
  assert.equal(unlinkCall, 'unlinkClient(2, 3)');
  assert.doesNotMatch(unlinkCall, /Ромашка|alert/);

  // Строка имени всё равно экранируется для текста
  assert.match(modal.body, /&#39;Ромашка&#39;/);
});

test('карточка: цена каждого клиента берётся из своей связи', async () => {
  const drawing = {
    id: 2, name: 'BOM', description: '', client_id: 3, client_name: 'A', fixed_price: null,
    level_markup_pct: 0, global_markup_pct: 0, global_markup_rub: 0, archived_at: null, components: [],
    clients: [
      { id: 1, client_id: 3, client_name: 'A', markup_pct: null, markup_rub: 0, fixed_price: null, price: { total: 10402.6, fixedPrice: null } },
      { id: 2, client_id: 5, client_name: 'B', markup_pct: 7.5, markup_rub: 0, fixed_price: 12345, price: { total: 12345, fixedPrice: 12345 } },
    ],
    price: { total: 10402.6 },
  };

  let modal = null;
  const { page } = loadDrawingsPage({
    api: { get: async () => drawing },
    globals: { Modal: { open: options => { modal = options; }, close: () => {} } },
  });
  page.clients = [{ id: 3, name: 'A' }, { id: 5, name: 'B' }];

  await page.openDrawingModal(2);

  assert.match(modal.body, /Цены по клиентам \(2\)/);
  assert.match(modal.body, /10402\.60/);
  assert.match(modal.body, /12345\.00/);
  assert.match(modal.body, /фикс\./);
});

test('карточка: итог берётся из серверной цены владельца, а не пересчитывается в браузере', async () => {
  const drawing = {
    id: 4, name: 'BOM', description: '', client_id: 2, client_name: 'Опт', fixed_price: 1500,
    level_markup_pct: 15, global_markup_pct: 0, global_markup_rub: 0, archived_at: null,
    // Состав даёт 1000 + 15 % = 1150, но у владельца фикс-цена 1500 — её и должен показать сервер
    components: [{ id: 1, name: 'Компонент', price: 1000, quantity: 1, item_markup_pct: 0, item_markup_rub: 0 }],
    clients: [{
      id: 1, client_id: 2, client_name: 'Опт', markup_pct: null, markup_rub: 0, fixed_price: 1500,
      pricing_level_name: null, price: { total: 1500, fixedPrice: 1500 },
    }],
    price: { total: 1500 },
  };

  let modal = null;
  const { page } = loadDrawingsPage({
    api: { get: async () => drawing },
    globals: { Modal: { open: options => { modal = options; }, close: () => {} } },
  });
  page.clients = [{ id: 2, name: 'Опт' }];

  await page.openDrawingModal(4);

  assert.match(modal.body, /Цена владельца/);
  assert.match(modal.body, /1500\.00/);
  assert.doesNotMatch(modal.body, /1150\.00/);
});
