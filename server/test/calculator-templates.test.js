const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Калькулятор: список шаблонов фильтруется по клиенту и по «есть ли расчёт».
// Проверяем чистую логику построения <option>/<optgroup> без браузера.
function loadCalculator({ clientId = '', onlyClient = false, onlyNew = false, drawings = [], clientDrawings = [] } = {}) {
  const src = fs.readFileSync(path.join(__dirname, '../../client/js/pages/calculator.js'), 'utf8');

  const select = { innerHTML: '' };
  const elements = {
    'calc-template': select,
    'calc-client': { value: clientId },
    'calc-only-client': { checked: onlyClient },
    'calc-only-new': { checked: onlyNew },
  };

  const sandbox = {
    console,
    document: { getElementById: (id) => elements[id] || null },
    esc: (value) => String(value === undefined || value === null ? '' : value),
    Table: { formatMoney: (v) => String(v) },
    Modal: { open() {}, close() {} },
    Toast: { error() {}, success() {}, info() {} },
    App: {},
    API: {
      async get(url) {
        if (url.startsWith('/drawings?client_id=')) return { data: clientDrawings };
        return { data: drawings };
      },
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(`${src}\n;globalThis.__CalculatorPage = CalculatorPage;`, sandbox);
  return { page: sandbox.__CalculatorPage, select };
}

const allDrawings = [
  { id: 1, name: 'Общий BOM', client_id: 1, client_ids: [1, 2], components_count: 6, archived_at: null },
  { id: 2, name: 'Свой чертёж клиента', client_id: 2, client_ids: [2], components_count: 4, archived_at: null },
  { id: 3, name: 'Универсальный', client_id: null, client_ids: null, components_count: 8, archived_at: null },
  { id: 4, name: 'Чужой чертёж', client_id: 5, client_ids: [5], components_count: 3, archived_at: null },
];

const clientDrawings = [
  { ...allDrawings[0], is_calculated: true },
  { ...allDrawings[1], is_calculated: false },
];

test('калькулятор: без клиента показывает все чертежи, кроме архивных', async () => {
  const { page, select } = loadCalculator({ drawings: allDrawings });
  page.drawings = allDrawings;
  await page.refreshTemplateOptions();

  assert.match(select.innerHTML, /Общий BOM/);
  assert.match(select.innerHTML, /Чужой чертёж/);
});

test('калькулятор: для клиента — только его чертежи, если включён фильтр', async () => {
  const { page, select } = loadCalculator({
    clientId: '2', onlyClient: true, drawings: allDrawings, clientDrawings,
  });
  page.drawings = allDrawings;
  await page.refreshTemplateOptions();

  assert.match(select.innerHTML, /Общий BOM/);
  assert.match(select.innerHTML, /Свой чертёж клиента/);
  assert.doesNotMatch(select.innerHTML, /Чужой чертёж/);
  assert.match(select.innerHTML, /optgroup label="Чертежи клиента"/);
});

test('калькулятор: «без расчёта» скрывает чертежи с записью в журнале', async () => {
  const { page, select } = loadCalculator({
    clientId: '2', onlyClient: true, onlyNew: true, drawings: allDrawings, clientDrawings,
  });
  page.drawings = allDrawings;
  await page.refreshTemplateOptions();

  assert.doesNotMatch(select.innerHTML, /value="1"/);
  assert.match(select.innerHTML, /value="2"/);
});

test('калькулятор: универсальные выносятся в отдельную группу', async () => {
  const { page, select } = loadCalculator({ drawings: allDrawings });
  page.drawings = allDrawings;
  await page.refreshTemplateOptions();

  assert.match(select.innerHTML, /optgroup label="Универсальные \(общий BOM\)"/);
  assert.match(select.innerHTML, /value="3"/);
});

test('калькулятор: архивные чертежи не попадают в шаблоны', async () => {
  const withArchived = [...allDrawings, {
    id: 9, name: 'В архиве', client_id: 2, client_ids: [2], components_count: 1,
    archived_at: '2026-10-22T00:00:00.000Z',
  }];
  const { page, select } = loadCalculator({ drawings: withArchived });
  page.drawings = withArchived;
  await page.refreshTemplateOptions();

  assert.doesNotMatch(select.innerHTML, /В архиве/);
});
