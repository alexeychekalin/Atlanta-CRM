/* Рендер клиентских страниц в песочнице: ловим ошибки, которые не видит
   проверка синтаксиса, — например обращение к const до её объявления.

   Регрессия: `const fullArticle = fullArticle(...)` в списке модификаций
   роняло просмотр компонента с «can't access lexical declaration
   'fullArticle' before initialization». */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const clientDir = path.join(__dirname, '../../client/js');

/** Песочница с заглушками браузерного окружения. */
function makeSandbox(overrides = {}) {
  const sandbox = {
    window: {},
    console,
    document: { getElementById: () => null },
    localStorage: { getItem: () => null, setItem: () => {} },
    Table: {
      formatMoney: v => `${Number(v).toFixed(2)} ₽`,
      formatMoneyRaw: v => Number(v).toFixed(2),
      loading: () => '',
      emptyState: () => '',
      editIcon: '',
      deleteIcon: '',
      actionBtn: () => '',
    },
    API: {
      can: () => true,
      isAdmin: () => true,
      get: async () => ({}),
      post: async () => ({}),
      del: async () => ({}),
      ...overrides.api,
    },
    Toast: { error: () => {}, success: () => {}, info: () => {} },
    Modal: { open: () => {}, close: () => {} },
    Lightbox: { open: () => {}, close: () => {} },
    ConfirmDialog: { delete: async () => true },
    App: { navigateTo: () => {} },
    ...overrides.globals,
  };
  vm.createContext(sandbox);
  for (const helper of ['components/escape.js', 'components/article.js']) {
    vm.runInContext(fs.readFileSync(path.join(clientDir, helper), 'utf8'), sandbox);
  }
  // в браузере helpers лежат на window и видны как глобальные
  sandbox.esc = sandbox.window.esc;
  sandbox.safeUrl = sandbox.window.safeUrl;
  sandbox.fullArticle = sandbox.window.fullArticle;
  return sandbox;
}

/** Загружает модуль страницы и отдаёт её объект.
 *  file — имя файла в pages/, objectName — переменная внутри модуля. */
function loadPage(file, objectName, overrides = {}) {
  const sandbox = makeSandbox(overrides);
  const full = path.join(clientDir, `pages/${file}.js`);
  // const на верхнем уровне скрипта не попадает в объект песочницы — выносим сами
  const code = fs.readFileSync(full, 'utf8') + `\n;globalThis.${objectName} = ${objectName};`;
  vm.runInContext(code, sandbox);
  return { page: sandbox[objectName], sandbox };
}

test('модификации: карточка компонента рендерится с полным артикулом', async () => {
  const component = {
    id: 7,
    article: 'А.3776.001',
    name: 'Фонарь задний (квадрат)',
    description: '',
    price: 1200,
    images: [],
    is_active: true,
    modifications: [
      { id: 1, code: '01', name: 'с 7-контактным разъёмом', price_override: null, images: [] },
      { id: 2, code: '02.02', name: 'под быстрый обжим', price_override: 1350, images: [] },
    ],
  };
  let modal = null;
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: {
      get: async url => (url.endsWith('/documents') ? { data: [] } : component),
    },
    globals: { Modal: { open: options => { modal = options; }, close: () => {} } },
  });

  await page.viewComponent(7);

  assert.ok(modal, 'модальное окно должно открыться');
  assert.match(modal.body, /Модификации \(2\)/);
  // базовый артикул + код модификации через дефис
  assert.match(modal.body, /А\.3776\.001-01/);
  assert.match(modal.body, /А\.3776\.001-02\.02/);
  assert.match(modal.body, /1350\.00/);
});

test('модификации: код подставляется и когда модификаций нет', async () => {
  const component = {
    id: 8, article: 'А.3716.002', name: 'Фонарь противотуманный',
    price: 990, images: [], is_active: true, description: '', modifications: [],
  };
  let modal = null;
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: { get: async url => (url.endsWith('/documents') ? { data: [] } : component) },
    globals: { Modal: { open: options => { modal = options; }, close: () => {} } },
  });

  await page.viewComponent(8);

  assert.match(modal.body, /А\.3716\.002/);
  assert.match(modal.body, /Нет модификаций/);
});

test('галерея: просмотр листает все фото карточки, начиная с выбранного', async () => {
  const component = {
    id: 9,
    article: 'А.3731.013',
    name: 'Фонарь габаритный',
    price: 1200,
    is_active: true,
    image_path: '/uploads/cover.jpg',
    // обложка повторяется в галерее — в просмотре она должна быть один раз
    images: [
      { id: 1, image_path: '/uploads/cover.jpg' },
      { id: 2, image_path: '/uploads/second.jpg' },
      { id: 3, image_path: '/uploads/third.jpg' },
    ],
    modifications: [],
  };
  let opened = null;
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: { get: async url => (url.endsWith('/documents') ? { data: [] } : component) },
    globals: { Lightbox: { open: options => { opened = options; }, close: () => {} } },
  });

  await page.viewComponent(9);
  page.viewComponentImage(2);

  assert.deepEqual(opened.images, ['/uploads/cover.jpg', '/uploads/second.jpg', '/uploads/third.jpg']);
  assert.equal(opened.index, 2, 'открывается то фото, по которому кликнули');
  assert.equal(opened.title, 'Фонарь габаритный');

  // закрытие просмотра не трогает карточку: Modal остаётся как был
  assert.ok(!Object.prototype.hasOwnProperty.call(opened, 'footer'));
});

test('галерея: фото модификации листаются отдельным набором', async () => {
  const component = {
    id: 10,
    article: 'А.3776.005Л',
    name: 'Фонарь задний',
    price: 2500,
    is_active: true,
    images: [],
    modifications: [
      { id: 4, code: '01', name: 'левый', images: [{ image_path: '/uploads/m1-1.jpg' }, { image_path: '/uploads/m1-2.jpg' }] },
      { id: 5, code: '05', name: 'левый расширенный', images: [{ image_path: '/uploads/m2-1.jpg' }] },
    ],
  };
  let opened = null;
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    api: { get: async url => (url.endsWith('/documents') ? { data: [] } : component) },
    globals: { Lightbox: { open: options => { opened = options; }, close: () => {} } },
  });

  await page.viewComponent(10);
  page.viewModImage(4, 1);

  assert.deepEqual(opened.images, ['/uploads/m1-1.jpg', '/uploads/m1-2.jpg']);
  assert.equal(opened.index, 1);
  assert.match(opened.title, /01/);

  // у второй модификации свой набор
  page.viewModImage(5, 0);
  assert.deepEqual(opened.images, ['/uploads/m2-1.jpg']);
});

// === Поиск по модификациям ===

/** Мини-DOM: элементы, которые читает filterAndRender. */
function makeFakeDocument(values = {}) {
  const nodes = {
    'comp-search': { value: values.search || '', addEventListener() {} },
    'comp-category-filter': { value: values.category || '', addEventListener() {} },
    'comp-sort': { value: values.sort || 'name', addEventListener() {} },
    'comp-count': { textContent: '' },
    'components-table': { innerHTML: '' },
    'comp-category-chips': { innerHTML: '' },
  };
  return {
    nodes,
    getElementById: id => nodes[id] || null,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
}

test('поиск: находит компонент по коду модификации', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = {
    id: 1, article: 'А.3776.001', name: 'Фонарь задний', description: '', modifications: [
      { id: 11, code: '01', name: 'с 7-контактным разъёмом' },
      { id: 12, code: '02.02', name: 'под быстрый обжим' },
    ],
  };
  const query = page._buildSearchQuery('02.02');
  const hit = page._searchHit(component, query);

  assert.ok(hit, 'компонент должен найтись по коду модификации');
  assert.equal(hit.direct, false, 'совпадение не по основному артикулу');
  assert.deepEqual(hit.mods.map(m => m.code), ['02.02']);
});

test('поиск: находит по полному артикулу модификации и по её названию', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = {
    id: 1, article: 'А.3776.001', name: 'Фонарь задний', description: '', modifications: [
      { id: 11, code: '01', name: 'с 7-контактным разъёмом' },
      { id: 12, code: '02.02', name: 'под быстрый обжим' },
    ],
  };

  assert.deepEqual(page._searchHit(component, page._buildSearchQuery('А.3776.001-02.02')).mods.map(m => m.code), ['02.02']);
  assert.deepEqual(page._searchHit(component, page._buildSearchQuery('быстрый обжим')).mods.map(m => m.code), ['02.02']);
  // пробелы в артикуле не мешают
  assert.deepEqual(page._searchHit(component, page._buildSearchQuery('а.3776.001 - 02.02')).mods.map(m => m.code), ['02.02']);
});

test('поиск: прощает латиницу и разделители в артикуле', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = {
    id: 1, article: 'БК-101', name: 'Блок коммутации', description: '', modifications: [],
  };
  const other = {
    id: 2, article: 'А.3724.106', name: 'Жгут плоский', description: '', modifications: [
      { id: 21, code: '02.01', name: 'Кабель с адаптером' },
    ],
  };

  // латинские B и K вместо кириллических (частая опечатка при наборе)
  assert.equal(page._searchHit(component, page._buildSearchQuery('BK-101')).direct, true);
  // артикул набран без дефиса
  assert.equal(page._searchHit(component, page._buildSearchQuery('бк101')).direct, true);
  // полный артикул модификации без точек
  assert.deepEqual(page._searchHit(other, page._buildSearchQuery('а3724.106-02.01')).mods.map(m => m.code), ['02.01']);
});

test('поиск: точку в артикуле можно не ставить', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = {
    id: 1, article: 'А.3724.106', name: 'Жгут плоский', description: '',
    modifications: [{ id: 21, code: '02.01', name: 'Кабель с адаптером' }],
  };

  // «а37» — короткий запрос, но с буквой: точку после «А» ставить не нужно
  assert.equal(page._searchHit(component, page._buildSearchQuery('а37')).direct, true);
  // код исполнения без точки
  assert.deepEqual(page._searchHit(component, page._buildSearchQuery('0201')).mods.map(m => m.code), ['02.01']);
  // короткий числовой запрос без разделителей не расширяем — иначе «15» цепляет полкаталога
  assert.equal(page._bareSearchable('15'), false);
  assert.equal(page._bareSearchable('а3'), true);
  assert.equal(page._searchHit(component, page._buildSearchQuery('15')), null);
});

test('поиск: по основному артикулу модификации не засоряют выдачу', () => {
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage');
  const component = {
    id: 1, article: 'А.3776.001', name: 'Фонарь задний', description: '', modifications: [
      { id: 11, code: '01', name: 'с 7-контактным разъёмом' },
    ],
  };
  const hit = page._searchHit(component, page._buildSearchQuery('А.3776.001'));

  assert.equal(hit.direct, true);
  assert.deepEqual(hit.mods, [], 'подсказки по модификациям не нужны');
  assert.equal(page._searchHit(component, page._buildSearchQuery('нет-такого')), null);
});

test('поиск: выдача фильтруется, сортируется и показывает совпавшую модификацию', () => {
  const components = [
    { id: 1, article: 'А.3776.001', name: 'Фонарь задний', description: '', price: 100, category_id: 1,
      modifications_count: 1, modifications: [{ id: 11, code: '02.02', name: 'под быстрый обжим' }] },
    { id: 2, article: 'А.3776.001-02.02', name: 'Фонарь с обжимом', description: '', price: 200, category_id: 1,
      modifications_count: 0, modifications: [] },
    { id: 3, article: 'А.3700.500', name: 'Фонарь габаритный', description: '', price: 300, category_id: 1,
      modifications_count: 0, modifications: [] },
  ];
  const doc = makeFakeDocument({ search: '02.02' });
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    globals: { document: doc },
  });
  page.allComponents = components;
  page.categories = [];
  page.filterAndRender();

  assert.match(doc.nodes['comp-count'].textContent, /Найдено: 2/);
  assert.match(doc.nodes['comp-count'].textContent, /по модификациям: 1/);

  const grid = doc.nodes['components-table'].innerHTML;
  assert.ok(!grid.includes('Фонарь габаритный'), 'несовпавшие не показываем');
  assert.match(grid, /comp-mod-hit/, 'у найденного по модификации есть подсказка');
  assert.match(grid, /мод\. 02\.02/);
  // прямое совпадение по артикулу — выше найденного по модификации
  assert.ok(grid.indexOf('Фонарь с обжимом') < grid.indexOf('Фонарь задний'));
});

test('фильтры: в чипсах категорий видно, сколько позиций найдено', () => {
  const components = [
    { id: 1, article: 'А.3776.001', name: 'Фонарь задний', description: '', price: 100,
      category_id: 1, category_name: 'Фонари задние', modifications: [] },
    { id: 2, article: 'А.3700.500', name: 'Фонарь габаритный', description: '', price: 300,
      category_id: 1, category_name: 'Фонари задние', modifications: [] },
    { id: 3, article: 'БК-101', name: 'Блок коммутации', description: '', price: 400,
      category_id: 2, category_name: 'Блоки', modifications: [] },
  ];
  const doc = makeFakeDocument();
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    globals: { document: doc },
  });
  page.allComponents = components;
  page.categories = [{ id: 1, name: 'Фонари задние' }, { id: 2, name: 'Блоки' }, { id: 3, name: 'Разъёмы' }];
  page.filterAndRender();

  const chips = doc.nodes['comp-category-chips'].innerHTML;
  assert.match(chips, /Все \(3\)/);
  assert.match(chips, /Фонари задние \(2\)/);
  assert.match(chips, /Блоки \(1\)/);
  assert.match(chips, /Разъёмы \(0\)/);
  // пустая категория приглушена: видно, что фильтр никуда не ведёт
  assert.match(chips, /chip-filter\s+chip-filter--empty"[^>]*>Разъёмы/);
  assert.ok(!/chip-filter\s+chip-filter--empty"[^>]*>Блоки/.test(chips),
    'непустая категория не должна считаться пустой');
});

test('фильтры: счётчики пересчитываются с учётом поиска', () => {
  const components = [
    { id: 1, article: 'А.3776.001', name: 'Фонарь задний', description: '', price: 100,
      category_id: 1, category_name: 'Фонари задние', modifications: [] },
    { id: 2, article: 'БК-101', name: 'Блок коммутации', description: '', price: 400,
      category_id: 2, category_name: 'Блоки', modifications: [] },
  ];
  const doc = makeFakeDocument({ search: 'А.3776' });
  const { page } = loadPage('components-catalog', 'ComponentsCatalogPage', {
    globals: { document: doc },
  });
  page.allComponents = components;
  page.categories = [{ id: 1, name: 'Фонари задние' }, { id: 2, name: 'Блоки' }];
  page.filterAndRender();

  const chips = doc.nodes['comp-category-chips'].innerHTML;
  assert.match(chips, /Все \(1\)/);
  assert.match(chips, /Фонари задние \(1\)/);
  assert.match(chips, /Блоки \(0\)/);
});
