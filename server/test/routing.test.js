const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Загружаем клиентский app.js в песочницу и проверяем разбор hash-маршрутов
function loadApp() {
  const src = fs.readFileSync(path.join(__dirname, '../../client/js/app.js'), 'utf8');
  const sandbox = {
    document: { addEventListener() {} },
    window: { addEventListener() {} },
    location: { hash: '' },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    URLSearchParams,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${src}\n;globalThis.__App = App;`, sandbox);
  return sandbox.__App;
}

// Объекты из VM-контекста имеют другой прототип — сравниваем через JSON
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('_parseRoute: карточка клиента с id', () => {
  const App = loadApp();
  assert.deepEqual(plain(App._parseRoute('client-profile/5')), { page: 'client-profile', param: '5' });
});

test('_parseRoute: query-параметры калькулятора', () => {
  const App = loadApp();
  assert.deepEqual(
    plain(App._parseRoute('#calculator?drawing=3&client=2')),
    { page: 'calculator', param: { drawing: '3', client: '2' } }
  );
});

test('_parseRoute: страница без параметров', () => {
  const App = loadApp();
  assert.deepEqual(plain(App._parseRoute('#orders')), { page: 'orders', param: null });
});

test('_buildHash: обратное преобразование', () => {
  const App = loadApp();
  assert.equal(App._buildHash('client-profile', '5'), 'client-profile/5');
  assert.equal(App._buildHash('calculator', { drawing: '3', client: '2' }), 'calculator?drawing=3&client=2');
  assert.equal(App._buildHash('orders', null), 'orders');
});
